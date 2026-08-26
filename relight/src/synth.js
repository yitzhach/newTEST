// synth.js — a procedurally generated "flat-lit photograph of a painting" whose
// physical relief is known exactly.
//
// Why this exists. The brief flags one genuine blocker: if the test image has no
// physical relief in it, there is nothing for Phase 1 to find, and correct code
// will look like broken code. That risk cuts both ways — a plausible-looking
// result on an unknown photo also cannot tell you the extractor is *right*.
//
// So we synthesise a surface with a height field we control, render it the way a
// copy-stand shot would record it (broad, near-frontal, low-contrast light), and
// hand the extractor only that render. Because the true normals are known, the
// bench can show recovered-vs-truth side by side, which separates "is the maths
// correct" from "does this particular photograph contain any relief".
//
// The pigment layer is deliberately uncorrelated with the height field. That is
// the adversarial part: colour edges that are not relief are exactly what a naive
// high-pass turns into fake geometry, so the chroma-reject term has something
// real to be tested against.

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth value noise, used for the pigment field only — never for the height. */
function valueNoise(w, h, cells, rnd) {
  const gw = cells + 1;
  const g = new Float32Array(gw * gw);
  for (let i = 0; i < g.length; i++) g[i] = rnd();
  const out = new Float32Array(w * h);
  const smooth = (t) => t * t * (3 - 2 * t);
  for (let y = 0; y < h; y++) {
    const fy = (y / h) * cells, y0 = Math.floor(fy), ty = smooth(fy - y0);
    for (let x = 0; x < w; x++) {
      const fx = (x / w) * cells, x0 = Math.floor(fx), tx = smooth(fx - x0);
      const a = g[y0 * gw + x0], b = g[y0 * gw + x0 + 1];
      const c = g[(y0 + 1) * gw + x0], d = g[(y0 + 1) * gw + x0 + 1];
      out[y * w + x] = (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * ty;
    }
  }
  return out;
}

/**
 * Build the height field: canvas weave underneath, loaded brushstrokes on top.
 * Heights are in arbitrary units; only their ratios matter to the shading.
 */
function buildHeight(w, h, seed) {
  const rnd = mulberry32(seed);
  const H = new Float32Array(w * h);

  // Canvas weave — two crossed gratings. Real linen is not a pure sine, so the
  // threads get a slight squaring to give the ridges a flat top.
  const period = 7.0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const warp = Math.sin((x / period) * Math.PI * 2);
      const weft = Math.sin((y / period) * Math.PI * 2);
      H[y * w + x] = 0.16 * (Math.sign(warp) * Math.pow(Math.abs(warp), 0.7)
                           + Math.sign(weft) * Math.pow(Math.abs(weft), 0.7));
    }
  }

  // Brushstrokes. Each is a capsule with a rounded ridge profile — paint pushed
  // up at the centre of the stroke and dragged thin at the edges, plus bristle
  // furrows running along its length.
  const strokes = 120;
  for (let s = 0; s < strokes; s++) {
    const cx = rnd() * w, cy = rnd() * h;
    const ang = rnd() * Math.PI * 2;
    const len = (0.06 + rnd() * 0.20) * Math.min(w, h);
    const wid = (0.008 + rnd() * 0.022) * Math.min(w, h);
    const amp = 0.5 + rnd() * 1.4;
    const bristles = 3 + Math.floor(rnd() * 5);
    const ca = Math.cos(ang), sa = Math.sin(ang);

    const x0 = Math.max(0, Math.floor(cx - len - wid));
    const x1 = Math.min(w, Math.ceil(cx + len + wid));
    const y0 = Math.max(0, Math.floor(cy - len - wid));
    const y1 = Math.min(h, Math.ceil(cy + len + wid));

    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const dx = x - cx, dy = y - cy;
        //             along the stroke        across it
        const t = dx * ca + dy * sa, u = -dx * sa + dy * ca;
        const half = len * 0.5;
        const over = Math.abs(t) - half;
        const dist = Math.hypot(Math.max(over, 0), u);
        if (dist > wid) continue;
        const r = dist / wid;
        // Rounded ridge: high in the middle, feathered to nothing at the edge.
        let prof = Math.cos(r * Math.PI * 0.5);
        prof *= prof;
        // Bristle furrows across the stroke width.
        const furrow = 0.22 * Math.cos(u / wid * Math.PI * bristles);
        // Paint runs out toward the end of the stroke.
        const load = 0.55 + 0.45 * Math.cos((t / half) * Math.PI * 0.5);
        H[y * w + x] += amp * load * (prof + furrow * prof);
      }
    }
  }
  return H;
}

// Tuned so typical brushstroke flanks land around 15-25 degrees off normal, which
// is the range real impasto occupies. Too shallow and the ground truth is
// indistinguishable from a flat plane, which makes the comparison meaningless.
const HEIGHT_TO_SLOPE = 1.2;

const RIGS = {
  // A proper archival copy-stand: two matched lights at equal and opposite
  // angles. That geometry cancels first-order relief shading almost exactly —
  // suppressing texture is what it is *for* — so it is the hardest case here,
  // not the easiest.
  symmetric: { dirs: [[-0.55, 0.45, 0.70], [0.55, -0.45, 0.70]], weights: [0.5, 0.5] },
  single:    { dirs: [[-0.55, 0.45, 0.70]],                      weights: [1.0] },
  raking:    { dirs: [[-0.90, 0.20, 0.35]],                      weights: [1.0] },
};

const AMBIENT = 0.18;

function normalize3(d) {
  const n = Math.hypot(d[0], d[1], d[2]) || 1;
  return [d[0] / n, d[1] / n, d[2] / n];
}

function encodeSrgb(lin) {
  const v = Math.min(1, Math.max(0, lin));
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return Math.round(c * 255);
}

/**
 * Build the surface once: height field, true normals, and a pigment field that is
 * deliberately uncorrelated with the relief. Shared by the single-shot and
 * multi-shot generators so both describe the same physical painting.
 */
function buildSurface(w, h, seed, pigmentDetail, grain = 0) {
  const H = buildHeight(w, h, seed);
  const rnd = mulberry32(seed + 991);
  const nA = valueNoise(w, h, 5, rnd);
  const nB = valueNoise(w, h, 13, rnd);
  const nC = valueNoise(w, h, 31, rnd);
  // Grey grain: fine ACHROMATIC albedo variation, the kind cement, plaster, sand
  // and paper have. It belongs to the albedo rather than to any one exposure, so a
  // capture set sees the same grain in every shot — which is what makes the
  // photometric path able to solve it away and the single-image path unable to.
  //
  // This is the adversary the bench was missing. The chromatic pigment field above
  // is deliberately hue-shifting, so chroma reject can find it; grain shifts no hue
  // at all, which by construction makes it indistinguishable from relief shading in
  // one photograph. Every high-frequency statistic reads it as texture.
  const gr = grain > 0 ? valueNoise(w, h, Math.max(2, Math.round(Math.min(w, h) / 3)), rnd) : null;

  const normals = new Float32Array(w * h * 3);
  const albedo = new Float32Array(w * h * 3);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const xm = x > 0 ? x - 1 : x, xp = x < w - 1 ? x + 1 : x;
      const ym = y > 0 ? y - 1 : y, yp = y < h - 1 ? y + 1 : y;
      const dhdx = (H[y * w + xp] - H[y * w + xm]) * 0.5;
      const dhdy = (H[yp * w + x] - H[ym * w + x]) * 0.5;

      let nx = -dhdx * HEIGHT_TO_SLOPE, ny = dhdy * HEIGHT_TO_SLOPE, nz = 1;
      const inv = 1 / Math.hypot(nx, ny, nz);
      normals[i * 3] = nx * inv; normals[i * 3 + 1] = ny * inv; normals[i * 3 + 2] = nz * inv;

      // Pigment: warm ochre ground, a cool blue passage, a red accent.
      const a = nA[i], b = nB[i], c = nC[i];
      const mix = Math.min(1, Math.max(0, a * 1.4 - 0.2));
      let r = (0.72 * mix + 0.18 * (1 - mix)) + 0.16 * (b - 0.5);
      let g = (0.55 * mix + 0.26 * (1 - mix)) + 0.13 * (b - 0.5);
      let bl = (0.24 * mix + 0.52 * (1 - mix)) + 0.15 * (b - 0.5);
      if (a > 0.72) { r += 0.22; g -= 0.08; bl -= 0.10; }   // hard pigment edge
      // Fine-scale mottle, chromatic by construction: a pigment change moves hue,
      // whereas relief shading scales all three channels together. That
      // difference is the only thing separating them in a single image.
      const fine = (c - 0.5) * pigmentDetail;
      r += fine * 0.30; g -= fine * 0.10; bl -= fine * 0.26;

      if (gr) {
        // One multiplier on all three channels: no hue shift, by construction.
        const k = 1 + grain * (gr[i] - 0.5) * 2;
        r *= k; g *= k; bl *= k;
      }
      albedo[i * 3] = r; albedo[i * 3 + 1] = g; albedo[i * 3 + 2] = bl;
    }
  }
  return { H, normals, albedo };
}

/**
 * Paint a mirror sphere into a rendered exposure.
 *
 * A chrome sphere in the corner of the frame is how a real capture measures its
 * light directions instead of recalling them. Modelled the way the reading works:
 * the sphere reflects a small bright source, so the highlight lands at the point
 * whose normal bisects L and the viewer, and its angular size is what gives the
 * blob a few pixels to find a centroid in.
 *
 * `sigmaDeg` is the source's angular radius as the sphere sees it — 5 degrees is
 * about a 30cm softbox at two metres, which is a realistic copy-stand rig.
 *
 * @param sphere {cx, cy, r} in pixels, cy DOWN the image, matching the pixel grid
 */
function drawSphere(px, w, h, sphere, dirs, weights, { sigmaDeg = 5, body = 0.05, rim = 0.35 } = {}) {
  const { cx, cy, r } = sphere;
  const sig = (sigmaDeg * Math.PI) / 180;
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(w, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(h, Math.ceil(cy + r));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const dx = (x - cx) / r;
      // Image rows run down, the light frame's y runs up.
      const dy = -(y - cy) / r;
      const rr = dx * dx + dy * dy;
      if (rr > 1) continue;
      const nz = Math.sqrt(1 - rr);
      // Mirror: reflect the viewer direction (0,0,1) about the normal.
      const d = 2 * nz;
      const rx = d * dx, ry = d * dy, rz = d * nz - 1;
      let v = body + rim * Math.pow(1 - nz, 3);   // dark body, brighter at the edge
      for (let k = 0; k < dirs.length; k++) {
        const L = dirs[k];
        const dot = Math.max(-1, Math.min(1, rx * L[0] + ry * L[1] + rz * L[2]));
        const ang = Math.acos(dot);
        v += weights[k] * 12 * Math.exp(-(ang * ang) / (2 * sig * sig));
      }
      const o = (y * w + x) * 4;
      px[o] = encodeSrgb(v); px[o + 1] = encodeSrgb(v); px[o + 2] = encodeSrgb(v);
      px[o + 3] = 255;
    }
  }
}

/** Render one exposure of a prepared surface under the given light directions. */
function renderUnder(surface, w, h, dirs, weights, ambient = AMBIENT) {
  const { normals, albedo } = surface;
  const img = new ImageData(w, h);
  const px = img.data;
  for (let i = 0; i < w * h; i++) {
    const nx = normals[i * 3], ny = normals[i * 3 + 1], nz = normals[i * 3 + 2];
    let shade = ambient;
    for (let k = 0; k < dirs.length; k++) {
      const d = dirs[k];
      shade += weights[k] * Math.max(0, nx * d[0] + ny * d[1] + nz * d[2]);
    }
    const o = i * 4;
    px[o]     = encodeSrgb(albedo[i * 3] * shade);
    px[o + 1] = encodeSrgb(albedo[i * 3 + 1] * shade);
    px[o + 2] = encodeSrgb(albedo[i * 3 + 2] * shade);
    px[o + 3] = 255;
  }
  return img;
}

/**
 * A single flat-lit photograph, for testing single-image relief recovery.
 *
 * @param {'symmetric'|'single'|'raking'} opts.lighting  How the repro shot was lit.
 * @param {number} opts.pigmentDetail  Fine colour variation carried by the paint
 *   itself — high-frequency detail that is not geometry, but which shifts hue and
 *   so can at least be separated from shading in principle.
 * @param {number} opts.grain  Fine ACHROMATIC albedo variation — cement, plaster,
 *   sand. The harder adversary, because nothing in a single photograph can tell it
 *   apart from relief shading. See tools/validate.mjs.
 */
export function synthesizePainting({ width = 900, height = 1100, seed = 7,
                                     lighting = 'single', pigmentDetail = 0.35,
                                     grain = 0 } = {}) {
  const w = width, h = height;
  const surface = buildSurface(w, h, seed, pigmentDetail, grain);
  const rig = RIGS[lighting] || RIGS.single;
  const image = renderUnder(surface, w, h, rig.dirs.map(normalize3), rig.weights);
  return { image, normals: surface.normals, height: surface.H, width: w, rows: h };
}

/**
 * A photometric-stereo capture set: the same painting shot N times from a fixed
 * camera with the light moved between exposures.
 *
 * This is the capture a single photograph cannot substitute for. One image
 * constrains only the slope along its own light azimuth; N images with spread
 * azimuths constrain both in-plane components, and solving the resulting system
 * yields true albedo as a by-product — which removes the need to guess at an
 * intrinsic decomposition later.
 *
 * @param {number[][]} opts.lightDirs  Unnormalised light directions. The default
 *   is the museum convention: four exposures at 90-degree azimuth spacing and
 *   roughly 45-degree elevation.
 */
export function synthesizeCaptureSet({ width = 700, height = 800, seed = 7,
                                       pigmentDetail = 0.35, lightDirs = null,
                                       ambient = AMBIENT, sphere = null,
                                       sphereOpts = {}, grain = 0 } = {}) {
  const w = width, h = height;
  const surface = buildSurface(w, h, seed, pigmentDetail, grain);
  const dirs = (lightDirs || [
    [ 1, 0, 1], [0,  1, 1], [-1, 0, 1], [0, -1, 1],
  ]).map(normalize3);
  const images = dirs.map((d) => {
    const img = renderUnder(surface, w, h, [d], [1.0], ambient);
    // Painted over the painting, as it would be in the frame — the sphere sits in
    // the shot, so its pixels are not paint and the solve will make nonsense of
    // them. That is true of a real capture too, and is why the reading is taken
    // before the crop.
    if (sphere) drawSphere(img.data, w, h, sphere, [d], [1.0], sphereOpts);
    return img;
  });
  return {
    images, lightDirs: dirs, ambient, sphere,
    normals: surface.normals, albedo: surface.albedo, height: surface.H,
    width: w, rows: h,
  };
}

/** Ground-truth normals as a viewable image, for side-by-side comparison. */
export function normalsToImageData(normals, w, h) {
  const img = new ImageData(w, h);
  const px = img.data;
  for (let i = 0; i < w * h; i++) {
    px[i * 4]     = Math.round((normals[i * 3] * 0.5 + 0.5) * 255);
    px[i * 4 + 1] = Math.round((normals[i * 3 + 1] * 0.5 + 0.5) * 255);
    px[i * 4 + 2] = Math.round((normals[i * 3 + 2] * 0.5 + 0.5) * 255);
    px[i * 4 + 3] = 255;
  }
  return img;
}
