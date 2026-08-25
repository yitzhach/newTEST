// register.js — align the frames of a photometric capture set.
//
// Photometric stereo solves I_k = albedo·(N·L_k) *per pixel*, which assumes every
// exposure sees the same pixel. Until now that assumption was carried entirely by
// the tripod: `loadUploadedCapture` checked that the frames were the same size and
// then trusted them. They are not always the same framing. A mirror slap, a cable
// tug, a floorboard — a few pixels of drift is normal, and it corrupts the solve
// silently, because a wrong per-pixel system still returns a normal.
//
// The Fit view made this measurable (3px on one frame of six reads 3.39% where a
// clean capture reads 0.16%), which is what made correcting it worth building:
// there is now an objective number that says whether the correction helped.
//
// ---------------------------------------------------------------------------
// Why not correlate the photographs directly
//
// The exposures are lit *differently* — that is the entire point of the capture —
// so the raw images disagree wherever there is relief. A brushstroke ridge lit
// from the left is bright-then-dark across its width; lit from the right it is
// dark-then-bright. Cross-correlating those two directly is being asked to match
// a feature against its own negative, and the shading difference is larger than
// the misalignment being looked for.
//
// The obvious repair is the gradient *magnitude* of log luminance: a ridge is an
// edge under any light even though the sign of that edge flips. Measured over the
// 15 frame pairs of a six-shot capture that recovers the right answer on 12 of
// them and lands 3px out on the other three, because |grad log L| is not actually
// light-invariant — it is strongest across the light azimuth, so two frames lit
// 120deg apart emphasise different edges and correlate weakly and off-centre.
//
// What IS invariant is **chromaticity**. Under the Lambertian model this tool
// already assumes, I_c = albedo_c * (n·l + ambient): the shading term is one
// scalar multiplying all three channels, so
//
//     r / (r + g + b)
//
// cancels it exactly. Not approximately, not to first order — the lamp divides
// out. Registering on the gradient of chromaticity gets all 15 pairs right at
// r = 0.999, and it ignores the canvas weave for free, the weave being achromatic
// relief and therefore invisible to it.
//
// The catch is a subject with no colour in it — a grisaille, a charcoal drawing,
// an underexposed frame where chromaticity is mostly sensor noise. So the feature
// is the sum of both, at a FIXED gain rather than normalised:
//
//     feature = |grad log L| + K * |grad chromaticity|
//
// Fixed gain is what makes it degrade correctly. Normalising each term to unit
// variance would give an achromatic frame's chroma noise the same weight as real
// structure and actively poison the result; at fixed gain an achromatic frame's
// chroma term is simply small, and the measurement falls back to luminance with
// no switch to get wrong. Measured on a desaturated copy of the bench painting,
// every K from 0 to 16 gives bit-identical output.
//
// ---------------------------------------------------------------------------
// Why a pyramid, specifically
//
// A canvas weave is periodic — the synthetic one has a 7px pitch — so the
// correlation surface has a rival peak every 7px, and a plain search can lock onto
// the wrong one and be confidently wrong by exactly one weave period. Coarse
// pyramid levels have the weave averaged away and only the brushwork left, which
// is aperiodic, so the coarse level picks the right basin and the fine levels
// refine inside it. `ambiguity` is reported so a lock-on that was *not* clean says
// so rather than being applied quietly.
//
// Nothing here touches the DOM: it runs on typed arrays so the same code path can
// be scored against known shifts in tools/validate.mjs without a browser.

/** Search this far, in pixels of the source, unless told otherwise. */
export const DEFAULT_MAX_SHIFT = 32;

/** Measure the drift at no more than this on the long edge. See registerFrames. */
export const DEFAULT_MAX_SIDE = 1600;

/** Samples per correlation evaluation. Cost is fixed regardless of image size. */
const SAMPLE_BUDGET = 240000;

// ------------------------------------------------------------------ luminance

const SRGB_TO_LINEAR = (() => {
  const t = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const v = i / 255;
    t[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }
  return t;
})();

const LINEAR_TO_SRGB = (v) => {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055;
  return c < 0 ? 0 : c > 1 ? 255 : Math.round(c * 255);
};

/**
 * Decode packed sRGB bytes to linear R/G/B planes, box-reducing by an integer
 * factor on the way through.
 *
 * Reducing here rather than after decoding is what keeps a full-resolution capture
 * affordable: the reduced planes are all that is ever held, so a 12MP frame costs
 * 9MB at factor 4 instead of 144MB at factor 1, and the expensive parts downstream
 * — two Gaussian blurs and the gradient — run on 1/16 of the pixels.
 *
 * The averaging is in linear light, which is not fussiness: chromaticity is the
 * load-bearing part of the feature and it is only shading-invariant on linear
 * values. Averaging gamma-encoded bytes and calling the result a colour ratio
 * would give away the one exact thing this measurement has.
 */
export function reduceToLinearPlanes(rgba, w, h, factor = 1) {
  const f = Math.max(1, Math.round(factor));
  const nw = Math.max(1, Math.floor(w / f)), nh = Math.max(1, Math.floor(h / f));
  const r = new Float32Array(nw * nh), g = new Float32Array(nw * nh), b = new Float32Array(nw * nh);
  const inv = 1 / (f * f);
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      let ar = 0, ag = 0, ab = 0;
      for (let j = 0; j < f; j++) {
        const sy = (y * f + j) * w;
        for (let i = 0; i < f; i++) {
          const p = (sy + x * f + i) * 4;
          ar += SRGB_TO_LINEAR[rgba[p]];
          ag += SRGB_TO_LINEAR[rgba[p + 1]];
          ab += SRGB_TO_LINEAR[rgba[p + 2]];
        }
      }
      const o = y * nw + x;
      r[o] = ar * inv; g[o] = ag * inv; b[o] = ab * inv;
    }
  }
  return { r, g, b, w: nw, h: nh };
}

// ------------------------------------------------------------------- filtering

/** Separable Gaussian with clamped edges. */
export function blur(src, w, h, sigma) {
  if (sigma <= 0.02) return src;
  const rad = Math.max(1, Math.ceil(sigma * 3));
  const k = new Float32Array(rad * 2 + 1);
  let ks = 0;
  for (let i = -rad; i <= rad; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    k[i + rad] = v; ks += v;
  }
  for (let i = 0; i < k.length; i++) k[i] /= ks;

  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -rad; i <= rad; i++) {
        let xx = x + i;
        xx = xx < 0 ? 0 : xx >= w ? w - 1 : xx;
        s += src[row + xx] * k[i + rad];
      }
      tmp[row + x] = s;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -rad; i <= rad; i++) {
        let yy = y + i;
        yy = yy < 0 ? 0 : yy >= h ? h - 1 : yy;
        s += tmp[yy * w + x] * k[i + rad];
      }
      out[y * w + x] = s;
    }
  }
  return out;
}

/** 2x2 box downsample. Odd sizes drop the last row/column. */
export function halve(src, w, h) {
  const nw = w >> 1, nh = h >> 1;
  const out = new Float32Array(nw * nh);
  for (let y = 0; y < nh; y++) {
    const r0 = (y * 2) * w, r1 = (y * 2 + 1) * w, o = y * nw;
    for (let x = 0; x < nw; x++) {
      const x0 = x * 2;
      out[o + x] = (src[r0 + x0] + src[r0 + x0 + 1] + src[r1 + x0] + src[r1 + x0 + 1]) * 0.25;
    }
  }
  return { data: out, w: nw, h: nh };
}

/** Weight on the chromaticity term. See the header: fixed, deliberately not
 *  normalised, so an achromatic subject falls back to luminance on its own. */
export const CHROMA_GAIN = 8;

/**
 * The registration feature: |grad log L| + K·|grad chromaticity|, lightly smoothed.
 *
 * Smoothing first matters for the sub-pixel step, not for robustness — a raw
 * one-pixel difference gives a correlation peak one sample wide, and a parabola
 * fitted to three samples of that has nothing to work with.
 *
 * @param planes linear-light R/G/B planes from reduceToLinearPlanes()
 */
export function gradientFeature(planes, { sigma = 1.0, chromaGain = CHROMA_GAIN } = {}) {
  const { r, g, b, w, h } = planes;
  const n = w * h;
  const L = new Float32Array(n), c1 = new Float32Array(n), c2 = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    L[i] = 0.2126 * r[i] + 0.7152 * g[i] + 0.0722 * b[i];
    // Floored: where there is no light there is no colour either, only read noise,
    // and dividing it by itself would make the darkest passage the loudest feature.
    const sum = r[i] + g[i] + b[i] + 1e-4;
    c1[i] = r[i] / sum; c2[i] = g[i] / sum;
  }
  const Lb = blur(L, w, h, sigma), C1 = blur(c1, w, h, sigma), C2 = blur(c2, w, h, sigma);

  const out = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    const ym = (y > 0 ? y - 1 : y) * w, yp = (y < h - 1 ? y + 1 : y) * w, row = y * w;
    for (let x = 0; x < w; x++) {
      const xm = x > 0 ? x - 1 : x, xp = x < w - 1 ? x + 1 : x;
      const lx = Math.log(Math.max(Lb[row + xp], 1e-4)) - Math.log(Math.max(Lb[row + xm], 1e-4));
      const ly = Math.log(Math.max(Lb[yp + x], 1e-4)) - Math.log(Math.max(Lb[ym + x], 1e-4));
      const ax = C1[row + xp] - C1[row + xm], ay = C1[yp + x] - C1[ym + x];
      const bx = C2[row + xp] - C2[row + xm], by = C2[yp + x] - C2[ym + x];
      out[row + x] = 0.5 * Math.hypot(lx, ly)
                   + chromaGain * Math.sqrt(ax * ax + ay * ay + bx * bx + by * by);
    }
  }
  return out;
}

// ----------------------------------------------------------------- correlation

/**
 * Normalised cross-correlation of `a` against `b` displaced by (dx, dy).
 *
 * The sample window is fixed by `inset` rather than by what happens to be in
 * range for this particular displacement. Letting the window follow the
 * displacement makes the scores incomparable — larger shifts get an easier,
 * smaller overlap — and biases the peak outward.
 */
function nccAt(a, b, w, h, dx, dy, inset, stride) {
  const x0 = inset, x1 = w - inset, y0 = inset, y1 = h - inset;
  let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0, n = 0;
  for (let y = y0; y < y1; y += stride) {
    const ra = y * w, rb = (y + dy) * w + dx;
    for (let x = x0; x < x1; x += stride) {
      const u = a[ra + x], v = b[rb + x];
      sa += u; sb += v; saa += u * u; sbb += v * v; sab += u * v; n++;
    }
  }
  if (n < 32) return -1;
  const ma = sa / n, mb = sb / n;
  const va = saa / n - ma * ma, vb = sbb / n - mb * mb;
  const den = Math.sqrt(Math.max(va, 0) * Math.max(vb, 0));
  return den > 1e-12 ? (sab / n - ma * mb) / den : 0;
}

function strideFor(w, h, inset) {
  const usable = Math.max(1, (w - 2 * inset)) * Math.max(1, (h - 2 * inset));
  return Math.max(1, Math.round(Math.sqrt(usable / SAMPLE_BUDGET)));
}

/** Peak offset from three correlation samples. Clamped: a fit that wants to move
 *  more than half a sample is a fit that disagrees with its own integer peak. */
function parabola(rm, r0, rp) {
  const den = rm - 2 * r0 + rp;
  if (!(Math.abs(den) > 1e-12)) return 0;
  const d = (0.5 * (rm - rp)) / den;
  return d < -0.5 ? -0.5 : d > 0.5 ? 0.5 : d;
}

/**
 * Estimate how far `mov` has drifted relative to `ref`.
 *
 * Both are feature *pyramids* — arrays of {data, w, h}, finest first — because the
 * coarse levels are what stop a periodic canvas weave from capturing the search.
 *
 * @returns {{dx, dy, peak, zero, ambiguity, rival}}
 *   dx, dy    displacement of mov's content, in pixels of the finest level:
 *             mov(x, y) ~= ref(x - dx, y - dy)
 *   peak      correlation at the recovered displacement — how alike the frames are
 *   zero      correlation with no correction applied, for comparison
 *   ambiguity best rival peak / best peak, at the coarsest level. Near 1 means the
 *             correlation surface has a second answer that is nearly as good, which
 *             is what a periodic weave looks like.
 *   rival     that rival's displacement, in finest-level pixels
 */
export function estimateShift(refPyr, movPyr, { maxShift = DEFAULT_MAX_SHIFT, refine = 3 } = {}) {
  const levels = Math.min(refPyr.length, movPyr.length);
  const top = levels - 1;
  const scale = 1 << top;

  // Coarsest level: exhaustive. Everything below is a refinement of this answer,
  // so this is the level that has to pick the right basin.
  const L = refPyr[top], M = movPyr[top];
  const radius = Math.max(2, Math.min(24, Math.ceil(maxShift / scale) + 1));
  const inset = radius + 2;
  if (L.w <= 2 * inset + 8 || L.h <= 2 * inset + 8) {
    return { dx: 0, dy: 0, peak: 0, zero: 0, ambiguity: 1, rival: [0, 0], ok: false,
      reason: 'image too small to register' };
  }
  const stride = strideFor(L.w, L.h, inset);

  let best = -2, bx = 0, by = 0;
  const grid = new Float32Array((radius * 2 + 1) * (radius * 2 + 1));
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const r = nccAt(L.data, M.data, L.w, L.h, dx, dy, inset, stride);
      grid[(dy + radius) * (radius * 2 + 1) + (dx + radius)] = r;
      if (r > best) { best = r; bx = dx; by = dy; }
    }
  }

  // How lonely is that peak? A rival of nearly the same height, a weave period
  // away, means the answer is a coin toss between them.
  let rival = -2, rx = 0, ry = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (Math.abs(dx - bx) <= 1 && Math.abs(dy - by) <= 1) continue;
      const r = grid[(dy + radius) * (radius * 2 + 1) + (dx + radius)];
      if (r > rival) { rival = r; rx = dx; ry = dy; }
    }
  }
  const ambiguity = best > 1e-6 ? Math.max(0, rival) / best : 1;

  // Down the pyramid: double the estimate and look in a small window around it.
  // The window has to be wider than the parent's own error once doubled. Coarse
  // levels still run about a texel off — the light-invariance of the feature is
  // good, not perfect — so a doubled seed can be two texels out and a +/-2 window
  // would only just reach it.
  let cx = bx, cy = by;
  for (let lv = top - 1; lv >= 0; lv--) {
    const A = refPyr[lv], B = movPyr[lv];
    cx *= 2; cy *= 2;
    const ins = Math.abs(cx) + Math.abs(cy) + refine + 2;
    if (A.w <= 2 * ins + 8 || A.h <= 2 * ins + 8) break;
    const st = strideFor(A.w, A.h, ins);
    let b2 = -2, nx = cx, ny = cy;
    for (let dy = cy - refine; dy <= cy + refine; dy++) {
      for (let dx = cx - refine; dx <= cx + refine; dx++) {
        const r = nccAt(A.data, B.data, A.w, A.h, dx, dy, ins, st);
        if (r > b2) { b2 = r; nx = dx; ny = dy; }
      }
    }
    cx = nx; cy = ny; best = b2;
  }

  // Sub-pixel, at the finest level. Sub-pixel is the whole point: a per-pixel
  // solve is corrupted by a half-pixel error just as surely as by a whole one.
  const F = refPyr[0], G = movPyr[0];
  const ins = Math.abs(cx) + Math.abs(cy) + 3;
  let sx = 0, sy = 0, zero = 0, curvature = 0;
  if (F.w > 2 * ins + 8 && F.h > 2 * ins + 8) {
    const st = strideFor(F.w, F.h, ins);
    const at = (dx, dy) => nccAt(F.data, G.data, F.w, F.h, dx, dy, ins, st);
    const c = at(cx, cy);
    const mx0 = at(cx - 1, cy), px0 = at(cx + 1, cy);
    const my0 = at(cx, cy - 1), py0 = at(cx, cy + 1);
    sx = parabola(mx0, c, px0);
    sy = parabola(my0, c, py0);
    // Curvature of the correlation peak. This is the honest measure of how much
    // this pair has to say: a tall but broad peak means the two frames agree
    // about *where* roughly, and a flat ridge can be a whole pixel out without
    // its score changing. It is what weights the pair in the solve below.
    curvature = Math.max(0, -((mx0 - 2 * c + px0) + (my0 - 2 * c + py0)) / 2);
    best = c;
    zero = at(0, 0);
  }

  return {
    dx: cx + sx, dy: cy + sy,
    peak: best, zero, ambiguity, curvature,
    rival: [rx * scale, ry * scale],
    ok: true,
  };
}

// -------------------------------------------------------------------- pyramids

/**
 * Feature pyramid from packed RGBA. Finest level first.
 *
 * The feature is computed ONCE at full resolution and the pyramid is built by
 * downsampling *it* — not by downsampling the photograph and taking a gradient at
 * each level. That distinction was measured, and it is the difference between
 * working and not:
 *
 *   coarse level built from re-gradienting a downsampled photograph:
 *     peak lands 2-4px off zero on frames that never moved
 *   coarse level built by downsampling the fine-scale feature:
 *     peak lands on zero
 *
 * The reason is that |grad log L| is light-invariant at the scale of an *edge* and
 * not at the scale of a *stroke*. Take the gradient at 1/4 resolution and the pixel
 * differences no longer straddle a ridge flank; they straddle the whole brushstroke,
 * whose broad shading lobe leans toward whichever side the lamp is on and moves when
 * the lamp moves. Taking the gradient at full resolution first fixes the edges to
 * the painting, and averaging that map down carries fixed structure — edge density —
 * into the coarse levels instead of a movable shading lobe.
 */
export function buildFeaturePyramid(rgba, w, h, opts = {}) {
  const { minSide = 48, maxLevels = 6, reduce = 1 } = opts;
  const pyr = [];
  const planes = reduceToLinearPlanes(rgba, w, h, reduce);
  let cur = { data: gradientFeature(planes, opts), w: planes.w, h: planes.h };
  for (let i = 0; i < maxLevels; i++) {
    pyr.push(cur);
    if (Math.min(cur.w, cur.h) >> 1 < minSide || i === maxLevels - 1) break;
    cur = halve(cur.data, cur.w, cur.h);
  }
  return pyr;
}

// ------------------------------------------------------------------ resampling

/** Lanczos-3 taps for a fractional offset, normalised so flat areas keep their level. */
function lanczos3(t) {
  const w = new Float64Array(6);
  let sum = 0;
  for (let i = 0; i < 6; i++) {
    const x = (i - 2) - t;
    let v;
    if (Math.abs(x) < 1e-8) v = 1;
    else if (Math.abs(x) >= 3) v = 0;
    else v = (3 * Math.sin(Math.PI * x) * Math.sin((Math.PI * x) / 3)) / (Math.PI * Math.PI * x * x);
    w[i] = v; sum += v;
  }
  for (let i = 0; i < 6; i++) w[i] /= sum;
  return w;
}

/**
 * Resample so that out(x, y) = src(x + ox, y + oy) — pass a frame's measured drift
 * straight in and get the corrected frame back.
 *
 * **Lanczos-3, not bilinear.** Every resample is a low-pass filter, and this engine
 * works at 2-7px, which is exactly the band a cheap filter eats. Measured on the
 * validate bench by correcting a drifted capture with the drift that was actually
 * applied, so the only variable is the kernel:
 *
 *   | kernel       | normals nx / ny  | fit residual |
 *   |--------------|------------------|--------------|
 *   | uncorrected  | 0.203 / 0.902    | 4.01%        |
 *   | bilinear     | 0.939 / 0.885    | 3.10%        |
 *   | Catmull-Rom  | 0.964 / 0.932    | 1.78%        |
 *   | Lanczos-3    | 0.985 / 0.976    | 1.13%        |
 *
 * Bilinear recovers barely half of what is available. Lanczos-3 rings slightly at
 * hard edges, which is the trade taken: a little overshoot on a boundary against
 * keeping the brushwork the whole tool exists to measure.
 *
 * Three things keep it affordable on a full-resolution capture:
 *   - an exact integer displacement skips interpolation altogether, which after
 *     median anchoring is the common case — usually only the frame that actually
 *     moved needs filtering at all;
 *   - the filter is separable, so it costs 12 taps per pixel and not 36;
 *   - horizontally-filtered rows go through a six-row ring buffer, so each source
 *     row is filtered once and the intermediate never exists at full size. A
 *     24MP frame as float RGBA would be 384MB; the ring is a few hundred KB.
 *
 * `linear = true` interpolates in linear light. The solve is linear, so samples
 * should be averaged where the solve will read them; averaging sRGB code values
 * across a bright edge lands too dark.
 */
export function resample(src, w, h, ox, oy, { linear = true } = {}) {
  const out = new Uint8ClampedArray(w * h * 4);
  const ix = Math.round(ox), iy = Math.round(oy);
  const fx = ox - ix, fy = oy - iy;
  const cx = (v) => (v < 0 ? 0 : v >= w ? w - 1 : v);
  const cy = (v) => (v < 0 ? 0 : v >= h ? h - 1 : v);

  if (Math.abs(fx) < 1e-6 && Math.abs(fy) < 1e-6) {
    for (let y = 0; y < h; y++) {
      const sy = cy(y + iy) * w;
      for (let x = 0; x < w; x++) {
        const s = (sy + cx(x + ix)) * 4, d = (y * w + x) * 4;
        out[d] = src[s]; out[d + 1] = src[s + 1]; out[d + 2] = src[s + 2]; out[d + 3] = src[s + 3];
      }
    }
    return out;
  }

  const kx = lanczos3(fx), ky = lanczos3(fy);
  const dec = linear ? SRGB_TO_LINEAR : null;
  const enc = linear ? LINEAR_TO_SRGB : (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

  // Ring of horizontally-filtered rows, indexed by source row mod 6.
  const ring = [];
  for (let i = 0; i < 6; i++) ring.push(new Float32Array(w * 4));
  const loaded = new Int32Array(6).fill(-1 << 30);

  const rowAt = (sy) => {
    const slot = ((sy % 6) + 6) % 6;
    if (loaded[slot] === sy) return ring[slot];
    const buf = ring[slot];
    const base = cy(sy) * w;
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let i = 0; i < 6; i++) {
        const wt = kx[i];
        if (!wt) continue;
        const s = (base + cx(x + ix + i - 2)) * 4;
        if (dec) { r += wt * dec[src[s]]; g += wt * dec[src[s + 1]]; b += wt * dec[src[s + 2]]; }
        else { r += wt * src[s]; g += wt * src[s + 1]; b += wt * src[s + 2]; }
        a += wt * src[s + 3];
      }
      const o = x * 4;
      buf[o] = r; buf[o + 1] = g; buf[o + 2] = b; buf[o + 3] = a;
    }
    loaded[slot] = sy;
    return buf;
  };

  for (let y = 0; y < h; y++) {
    const rows = [];
    for (let j = 0; j < 6; j++) rows.push(rowAt(y + iy + j - 2));
    const d0 = y * w * 4;
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      const o = x * 4;
      for (let j = 0; j < 6; j++) {
        const wt = ky[j];
        if (!wt) continue;
        const rw = rows[j];
        r += wt * rw[o]; g += wt * rw[o + 1]; b += wt * rw[o + 2]; a += wt * rw[o + 3];
      }
      const d = d0 + o;
      out[d] = enc(r); out[d + 1] = enc(g); out[d + 2] = enc(b);
      out[d + 3] = a < 0 ? 0 : a > 255 ? 255 : Math.round(a);
    }
  }
  return out;
}

// --------------------------------------------------------------------- the set

/** A frame's pixels, fetched now if the caller handed over a reader instead. */
function frameData(f) {
  return typeof f.read === 'function' ? f.read() : f.data;
}

/**
 * Solve A x = b for a small dense symmetric system. Gaussian elimination with
 * partial pivoting; n here is at most MAX_SHOTS - 1.
 */
function solveDense(A, b, n) {
  const M = [];
  for (let i = 0; i < n; i++) {
    const row = new Float64Array(n + 1);
    for (let j = 0; j < n; j++) row[j] = A[i * n + j];
    row[n] = b[i];
    M.push(row);
  }
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    const d = M[c][c];
    for (let k = c; k <= n; k++) M[c][k] /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c];
      if (!f) continue;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = M[i][n];
  return x;
}

/**
 * Least-squares frame positions from pairwise displacements.
 *
 * Each pair contributes p_j - p_i ~= d_ij, weighted by how much that pair has to
 * say. That is a weighted graph Laplacian; frame 0 is pinned to fix the free
 * constant, and the whole set is re-anchored on the median afterwards.
 */
function solvePositions(n, pairs, axis) {
  const m = n - 1;                       // frame 0 pinned at 0
  const A = new Float64Array(m * m);
  const b = new Float64Array(m);
  for (const { i, j, d, w } of pairs) {
    const dv = d[axis];
    if (i > 0) { A[(i - 1) * m + (i - 1)] += w; b[i - 1] -= w * dv; }
    if (j > 0) { A[(j - 1) * m + (j - 1)] += w; b[j - 1] += w * dv; }
    if (i > 0 && j > 0) { A[(i - 1) * m + (j - 1)] -= w; A[(j - 1) * m + (i - 1)] -= w; }
  }
  const x = solveDense(A, b, m);
  if (!x) return null;
  const p = new Float64Array(n);
  for (let k = 1; k < n; k++) p[k] = x[k - 1];
  return p;
}

/**
 * Register a whole capture set.
 *
 * Every pair is measured, not just every frame against frame 0, and the per-frame
 * positions come out of a weighted least-squares fit over all of them. Three
 * reasons, in order of how much they matter:
 *
 *   1. Some pairs genuinely cannot see each other. Two exposures lit 120deg apart
 *      emphasise different edges; on an achromatic subject, where the chromaticity
 *      term contributes nothing, such a pair is a broad flat ridge with no
 *      well-defined peak. Weighting by peak curvature lets those pairs contribute
 *      almost nothing instead of contributing a wrong number with full authority.
 *   2. It produces a diagnostic that needs no ground truth. Fifteen measurements
 *      determine five unknowns, so the leftover disagreement — `consistency` — says
 *      whether the estimates agree with each other. A real capture has no truth to
 *      check against; this is the same argument that made the Fit view worth having.
 *   3. One bad pair cannot carry the answer. A single outlier against frame 0 would
 *      move that frame on its own; here it is outvoted, and then down-weighted by
 *      the robust pass.
 *
 * Anchoring is on the **median** position, not the mean and not frame 0. The usual
 * failure is one frame knocked out of line while the rest held, and the median
 * leaves the ones that held on exactly integer offsets — no interpolation, no
 * softening. A mean would smear a fractional resample across every good frame to
 * accommodate the bad one.
 *
 * @param frames [{ width, height, data }] or [{ width, height, read() }]. The
 *   lazy form matters on a real capture: six 24MP frames as RGBA is 576MB held at
 *   once, where reading one at a time and letting each go peaks at one.
 * @returns {{ ok, shifts, worst, consistency, outliers, pairs, reduce, reliable, reason }}
 */
export async function registerFrames(frames, opts = {}) {
  const {
    maxShift = DEFAULT_MAX_SHIFT, consistencyLimit = 0.5, robustPasses = 2,
    maxSide = DEFAULT_MAX_SIDE, onProgress = null,
  } = opts;
  if (!frames || frames.length < 2) {
    return { ok: false, reason: 'need at least two frames to register.' };
  }
  const w = frames[0].width, h = frames[0].height;
  if (frames.some((f) => f.width !== w || f.height !== h)) {
    return { ok: false, reason: 'frames differ in size; registration only corrects translation.' };
  }
  const n = frames.length;

  // Measure at a capped resolution, correct at full resolution.
  //
  // Building the feature costs about 0.4s per megapixel, so a six-shot 12MP
  // capture would spend half a minute on it before a single correlation ran. The
  // drift being looked for is global translation — one number for the whole frame
  // — so it does not need every pixel to find it, and the cost of measuring at 1/4
  // scale was measured rather than assumed (see tools/validate.mjs: it is smaller
  // than what the resampler gives up regardless). The correction itself is always
  // applied to the untouched full-resolution frame.
  let reduce = 1;
  while (Math.max(w, h) / (reduce * 2) >= maxSide) reduce *= 2;

  // Async so a caller can yield to the event loop between frames: a 12MP capture
  // spends about a second per frame here, and a browser that cannot repaint for
  // eight of them looks broken rather than busy.
  const pyr = [];
  for (let i = 0; i < n; i++) {
    if (onProgress) await onProgress(i / (n + 1), `reading frame ${i + 1} of ${n}`);
    pyr.push(buildFeaturePyramid(frameData(frames[i]), w, h, { ...opts, reduce }));
  }
  if (onProgress) await onProgress(n / (n + 1), 'matching frames');

  const pairs = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const e = estimateShift(pyr[i], pyr[j], { maxShift: maxShift / reduce });
      if (!e.ok) return { ok: false, reason: e.reason };
      pairs.push({
        i, j, d: [e.dx, e.dy],
        w0: Math.max(0, e.curvature) * Math.max(0, e.peak),
        w: Math.max(0, e.curvature) * Math.max(0, e.peak),
        peak: e.peak, ambiguity: e.ambiguity,
      });
    }
  }
  if (!pairs.some((p) => p.w > 0)) {
    return { ok: false, reason: 'no frame pair produced a usable correlation peak — the exposures may share no visible detail.' };
  }

  let px = solvePositions(n, pairs, 0);
  let py = solvePositions(n, pairs, 1);
  if (!px || !py) return { ok: false, reason: 'pairwise measurements do not determine the frame positions.' };

  // Robust reweighting. A pair that disagrees with the consensus is more likely to
  // have locked onto the wrong feature than to be right against all the others, so
  // give it less say and re-solve. Cauchy weights: down-weighted, never dropped —
  // the same reasoning that makes the solver clamp highlights instead of discarding
  // the samples, since throwing equations away is what costs a fit its redundancy.
  let residuals = [];
  for (let pass = 0; pass < robustPasses; pass++) {
    residuals = pairs.map((p) => Math.hypot(
      (px[p.j] - px[p.i]) - p.d[0], (py[p.j] - py[p.i]) - p.d[1]));
    const sorted = [...residuals].sort((a, b) => a - b);
    const scale = Math.max(0.25, sorted[sorted.length >> 1] || 0.25);
    pairs.forEach((p, k) => {
      const t = residuals[k] / scale;
      p.w = p.w0 / (1 + t * t);
    });
    const nx = solvePositions(n, pairs, 0), ny = solvePositions(n, pairs, 1);
    if (!nx || !ny) break;
    px = nx; py = ny;
  }

  const med = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const mx = med([...px]), my = med([...py]);

  const shifts = [];
  for (let k = 0; k < n; k++) shifts.push({ dx: (px[k] - mx) * reduce, dy: (py[k] - my) * reduce });

  // Two different questions, and conflating them gives a wrong answer to both:
  //
  //   consistency — do the measurements this answer actually RESTS on agree?
  //                 Weighted by the final robust weights, so a pair that was
  //                 outvoted and discounted does not also get to condemn the
  //                 result it had no part in.
  //   outliers    — how many pairs had to be discounted to get there? A capture
  //                 where a third of the pairs contradict the consensus is one to
  //                 look at, even if what survives is self-consistent.
  //
  // Measured on an achromatic capture — the case with no colour to register on,
  // where the fallback to luminance alone is weakest — the raw spread over all
  // pairs reads 0.65px while the recovered shifts are in fact good to 0.03px. The
  // robust fit had already outvoted the bad pairs; scoring it on their dissent
  // condemned an answer that was right.
  let sse = 0, wsum = 0, outliers = 0;
  pairs.forEach((p) => {
    const r = Math.hypot((px[p.j] - px[p.i]) - p.d[0], (py[p.j] - py[p.i]) - p.d[1]);
    sse += p.w * r * r; wsum += p.w;
    if (p.w0 > 0 && p.w < 0.5 * p.w0) outliers++;
  });
  const consistency = (wsum > 0 ? Math.sqrt(sse / wsum) : Infinity) * reduce;
  const worst = Math.max(...shifts.map((s2) => Math.hypot(s2.dx, s2.dy)));

  return {
    ok: true,
    shifts,
    worst,
    consistency,
    // The scale the drift was measured at. Sub-pixel precision is in units of
    // THIS, so at reduce = 4 an estimate good to 0.02 measured pixels is good to
    // 0.08 of the pixels it gets applied in. Reported rather than buried.
    reduce,
    outliers,
    pairs: pairs.length,
    ambiguity: Math.max(...pairs.map((p) => p.ambiguity || 0)),
    // Not a refusal — the shifts are returned either way and the caller decides.
    // The decisive test is downstream anyway: the fit residual before against
    // after says whether this helped, needs no ground truth, and is the objective
    // function that made registration worth building in the first place.
    reliable: consistency <= consistencyLimit && outliers <= pairs.length * 0.4,
  };
}

/**
 * Apply a registration result to the frames it was measured from.
 *
 * Also async, and for the same reason: a fractional resample of a 24MP frame is
 * about ten seconds of straight-line arithmetic. Frames whose shift came out on an
 * exact integer — after median anchoring, usually most of them — take the copy
 * path inside resample() and cost almost nothing.
 */
export async function applyShifts(frames, shifts, opts = {}) {
  const { onProgress = null } = opts;
  const out = [];
  for (let i = 0; i < frames.length; i++) {
    if (onProgress) await onProgress(i / frames.length, `correcting frame ${i + 1} of ${frames.length}`);
    const f = frames[i];
    out.push({
      width: f.width,
      height: f.height,
      data: resample(frameData(f), f.width, f.height, shifts[i].dx, shifts[i].dy, opts),
    });
  }
  return out;
}
