// validate.mjs — ground-truth check on the surface-recovery maths.
//
//   node relight/tools/validate.mjs
//
// The bench renders something plausible from almost any input, which makes
// eyeballing it a poor test: invented relief and recovered relief look alike.
// This harness sidesteps that by generating a surface whose height field is
// known exactly, rendering it the way a repro shot would, and then measuring how
// well the recovered gradient correlates with the truth.
//
// It is the test that told us the obvious pipeline (high-pass -> treat as height
// -> differentiate) recovers nothing at all: r = -0.01.

globalThis.ImageData = class {
  constructor(w, h) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(w * h * 4); }
};
const { synthesizePainting } = await import(new URL('../src/synth.js', import.meta.url));

const srgbToLin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };

function pearson(a, b) {
  const n = a.length;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let sa = 0, sb = 0, sab = 0;
  for (let i = 0; i < n; i++) { const u = a[i] - ma, v = b[i] - mb; sa += u * u; sb += v * v; sab += u * v; }
  return sab / Math.sqrt(sa * sb + 1e-20);
}

function makeBlur(w, h) {
  return (src, sigma) => {
    const rad = Math.ceil(sigma * 3), k = [];
    let ks = 0;
    for (let i = -rad; i <= rad; i++) { const v = Math.exp(-i * i / (2 * sigma * sigma)); k.push(v); ks += v; }
    const t = new Float32Array(w * h), o = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -rad; i <= rad; i++) { const xx = Math.min(w - 1, Math.max(0, x + i)); s += src[y * w + xx] * k[i + rad]; }
      t[y * w + x] = s / ks;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -rad; i <= rad; i++) { const yy = Math.min(h - 1, Math.max(0, y + i)); s += t[yy * w + x] * k[i + rad]; }
      o[y * w + x] = s / ks;
    }
    return o;
  };
}

const AZ = { symmetric: [-0.55, 0.45], single: [-0.55, 0.45], raking: [-0.90, 0.20] };

function prepare(lighting, pigmentDetail, size = 400) {
  const S = synthesizePainting({ width: size, height: size, seed: 7, lighting, pigmentDetail });
  const w = S.width, h = S.rows;
  const L = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    L[i] = 0.2126 * srgbToLin(S.image.data[i * 4])
         + 0.7152 * srgbToLin(S.image.data[i * 4 + 1])
         + 0.0722 * srgbToLin(S.image.data[i * 4 + 2]);
  }
  const blur = makeBlur(w, h);
  const Lb = blur(L, 3);
  const slope = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) slope[i] = Math.log(Math.max(L[i], 1e-4) / Math.max(Lb[i], 1e-4));
  return { S, w, h, slope };
}

function scoreAgainstTruth(H, normals, w, h) {
  const rx = [], ry = [], tx = [], ty = [];
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    rx.push(H[i - 1] - H[i + 1]);
    ry.push(H[(y - 1) * w + x] - H[(y + 1) * w + x]);
    tx.push(normals[i * 3]); ty.push(normals[i * 3 + 1]);
  }
  return { x: pearson(rx, tx), y: pearson(ry, ty) };
}

/** The pipeline as commonly described: high-pass IS the height. */
function naive({ slope }) { return slope; }

/** Corrected: the high-pass is a slope, so integrate it along the source azimuth. */
function corrected({ slope, w, h }, ax, ay, taps = 8) {
  const H = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let t = 1; t <= taps; t++) {
      const sx = Math.round(x - ax * t), sy = Math.round(y - ay * t);
      if (sx < 0 || sx >= w || sy < 0 || sy >= h) break;
      acc += -slope[sy * w + sx] * (1 - (t - 1) / taps);
    }
    H[y * w + x] = acc;
  }
  return H;
}

const bar = (r) => '#'.repeat(Math.max(0, Math.round(r * 30)));

console.log('\nSurface recovery vs known ground truth (Pearson r of recovered gradient)\n');
console.log('                          naive          corrected: along-azimuth / perpendicular');
console.log('  lighting     pigment   (as height)     nx r      ny r     avg');
console.log('  ' + '-'.repeat(74));
for (const lighting of ['raking', 'single', 'symmetric']) {
  for (const pd of [0.0, 0.35]) {
    const ctx = prepare(lighting, pd);
    const a = AZ[lighting], an = Math.hypot(a[0], a[1]);
    const nv = scoreAgainstTruth(naive(ctx), ctx.S.normals, ctx.w, ctx.h);
    const cr = scoreAgainstTruth(corrected(ctx, a[0] / an, a[1] / an), ctx.S.normals, ctx.w, ctx.h);
    const nAvg = (nv.x + nv.y) / 2, cAvg = (cr.x + cr.y) / 2;
    console.log(`  ${lighting.padEnd(11)}  ${pd.toFixed(2)}       ${nAvg.toFixed(3).padStart(6)}       `
      + `${cr.x.toFixed(3).padStart(6)}   ${cr.y.toFixed(3).padStart(6)}   ${cAvg.toFixed(3).padStart(6)} ${bar(cAvg)}`);
  }
}

console.log('\nReading:');
console.log('  * The naive pipeline recovers essentially nothing. It still LOOKS like relief,');
console.log('    which is what makes it worth measuring rather than judging by eye.');
console.log('  * Corrected recovery is strong along the source azimuth and absent perpendicular');
console.log('    to it — shape-from-shading ambiguity, at relief scale. One photograph buys');
console.log('    half the surface; a second light direction buys the other half.');
console.log('  * A proper archival copy-stand shot (two matched opposing lights) cancels the');
console.log('    first-order term by design, so almost nothing survives to recover.\n');

// ===========================================================================
// Frame registration
// ===========================================================================
//
// Photometric stereo assumes every exposure sees the same pixel. Uploaded capture
// sets were checked for matching dimensions and then trusted, which is a tripod
// held on faith. This scores the correction against a drift whose value is known
// exactly.
//
// Getting an exact *sub-pixel* ground truth needs care: shifting a rendered frame
// with an interpolator and then correcting it with an interpolator largely tests
// the round trip. So the painting is synthesised at 3x and each frame is box-
// downsampled from a different integer offset on that fine grid. A one-texel
// offset upstairs is exactly one third of a pixel downstairs, produced by
// averaging real samples the way a sensor would — no interpolation anywhere in
// the ground truth.

const { registerFrames, applyShifts } = await import(new URL('../src/register.js', import.meta.url));
const { buildSolver } = await import(new URL('../src/photometric.js', import.meta.url));
const { synthesizeCaptureSet } = await import(new URL('../src/synth.js', import.meta.url));

const SUB = 3;
const LIN = (() => { const t = new Float32Array(256); for (let i = 0; i < 256; i++) t[i] = srgbToLin(i); return t; })();
const encSrgb = (v) => {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(c * 255)));
};

/** Box-downsample by SUB from a given integer offset on the fine grid. Averaging
 *  happens in linear light, which is where a sensor does it. */
function boxDown(hi, hw, hh, ox, oy, w, h) {
  const out = new Uint8ClampedArray(w * h * 4);
  const inv = 1 / (SUB * SUB);
  const cl = (v, n) => (v < 0 ? 0 : v >= n ? n - 1 : v);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0;
      for (let j = 0; j < SUB; j++) {
        const sy = cl(y * SUB + oy + j, hh) * hw;
        for (let i = 0; i < SUB; i++) {
          const p = (sy + cl(x * SUB + ox + i, hw)) * 4;
          r += LIN[hi[p]]; g += LIN[hi[p + 1]]; b += LIN[hi[p + 2]];
        }
      }
      const d = (y * w + x) * 4;
      out[d] = encSrgb(r * inv); out[d + 1] = encSrgb(g * inv);
      out[d + 2] = encSrgb(b * inv); out[d + 3] = 255;
    }
  }
  return out;
}

function normalsDown(N, hw, hh, w, h, ox = 0, oy = 0) {
  const out = new Float32Array(w * h * 3);
  const cl = (v, n) => (v < 0 ? 0 : v >= n ? n - 1 : v);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let a = 0, b = 0, c = 0;
      for (let j = 0; j < SUB; j++) {
        const sy = cl(y * SUB + oy + j, hh);
        for (let i = 0; i < SUB; i++) {
          const p = (sy * hw + cl(x * SUB + ox + i, hw)) * 3;
          a += N[p]; b += N[p + 1]; c += N[p + 2];
        }
      }
      const m = Math.hypot(a, b, c) || 1;
      const o = (y * w + x) * 3;
      out[o] = a / m; out[o + 1] = b / m; out[o + 2] = c / m;
    }
  }
  return out;
}

/** The app's default rig: N azimuths, elevation alternating so ambient separates. */
function rig(n, elev = 45, spread = 15) {
  const dirs = [];
  for (let i = 0; i < n; i++) {
    const az = ((i * 360) / n) * Math.PI / 180;
    const e = (elev + (i % 2 ? spread : -spread) * 0.5) * Math.PI / 180;
    dirs.push([Math.cos(az) * Math.cos(e), Math.sin(az) * Math.cos(e), Math.sin(e)]);
  }
  return dirs;
}

/**
 * A capture set with a known per-frame drift.
 * @param driftsHi per-frame offset in FINE-grid texels; divide by SUB for pixels.
 */
function driftedCapture(driftsHi, { size = 300, pigmentDetail = 0.35, seed = 7, desaturate = false } = {}) {
  const dirs = rig(driftsHi.length);
  const S = synthesizeCaptureSet({
    width: size * SUB, height: size * SUB, seed, pigmentDetail, lightDirs: dirs,
  });
  // A grisaille, a charcoal drawing, a black-and-white scan: the chromaticity term
  // has nothing to work with and the measurement is thrown back on luminance alone,
  // which is the case it is weakest on. Included precisely because it is the one
  // that fails.
  const src = desaturate ? S.images.map((im) => {
    const d = new Uint8ClampedArray(im.data.length);
    for (let i = 0, p = 0; i < S.width * S.rows; i++, p += 4) {
      const y = encSrgb(0.2126 * LIN[im.data[p]] + 0.7152 * LIN[im.data[p + 1]] + 0.0722 * LIN[im.data[p + 2]]);
      d[p] = y; d[p + 1] = y; d[p + 2] = y; d[p + 3] = 255;
    }
    return { data: d };
  }) : S.images;
  const frames = src.map((im, k) => ({
    data: boxDown(im.data, S.width, S.rows, driftsHi[k][0], driftsHi[k][1], size, size),
    width: size, height: size,
  }));
  const med = (xs) => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const mx = med(driftsHi.map((d) => d[0])), my = med(driftsHi.map((d) => d[1]));
  // Registration anchors the set on its median position, so THAT is the grid the
  // corrected frames land on and the grid the ground truth has to be sampled on.
  // Scoring a median-anchored result against an offset-zero truth costs most of a
  // pixel of misalignment and reads as a catastrophic failure of the registration
  // — which is what it did, until this line.
  if (mx !== Math.round(mx) || my !== Math.round(my)) {
    throw new Error(`case median (${mx}, ${my}) is not a whole fine-grid texel, so no `
      + 'exact ground truth exists for it — pick drifts whose two middle values match.');
  }
  // A frame cut from offset ox reads out(x) = ref(x + ox/SUB), so the correction
  // that carries it back is -ox/SUB, re-anchored on the median like the register
  // does.
  const trueShifts = driftsHi.map((d) => [-(d[0] - mx) / SUB, -(d[1] - my) / SUB]);
  return {
    frames, dirs, trueShifts, w: size, h: size,
    truth: normalsDown(S.normals, S.width, S.rows, size, size, mx, my),
  };
}

/**
 * The photometric solve on the CPU — the same normal equations the shader runs,
 * so the effect of registration can be scored without a GPU.
 */
function cpuSolve(frames, dirs, w, h, { fitAmbient = true, margin = 14 } = {}) {
  const solver = buildSolver(dirs, { fitAmbient });
  if (!solver.ok) throw new Error(solver.reason);
  const n = frames.length;
  const lum = frames.map((f) => {
    const L = new Float32Array(w * h);
    for (let i = 0, p = 0; i < w * h; i++, p += 4) {
      L[i] = 0.2126 * LIN[f.data[p]] + 0.7152 * LIN[f.data[p + 1]] + 0.0722 * LIN[f.data[p + 2]];
    }
    return L;
  });
  const Ln = dirs.map((d) => { const m = Math.hypot(d[0], d[1], d[2]) || 1; return [d[0] / m, d[1] / m, d[2] / m]; });
  const N = new Float32Array(w * h * 3);
  let resSum = 0, resN = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let gx = 0, gy = 0, gz = 0, amb = 0, mean = 0;
      for (let k = 0; k < n; k++) {
        const v = lum[k][i];
        gx += solver.P[k * 4] * v; gy += solver.P[k * 4 + 1] * v;
        gz += solver.P[k * 4 + 2] * v; amb += solver.P[k * 4 + 3] * v;
        mean += v;
      }
      mean /= n;
      const m = Math.hypot(gx, gy, gz);
      let a = 0, b = 0, c = 1;
      if (m > 1e-5) { a = gx / m; b = gy / m; c = gz / m; }
      if (c < 0) { a = -a; b = -b; c = -c; }
      N[i * 3] = a; N[i * 3 + 1] = b; N[i * 3 + 2] = c;
      // Interior only: after a shift the border rows are clamped copies, and
      // scoring them would mix a resampling edge artefact into the verdict.
      if (x >= margin && y >= margin && x < w - margin && y < h - margin) {
        let sse = 0;
        for (let k = 0; k < n; k++) {
          const pred = gx * Ln[k][0] + gy * Ln[k][1] + gz * Ln[k][2] + (fitAmbient ? amb : 0);
          const e = lum[k][i] - pred;
          sse += e * e;
        }
        resSum += Math.sqrt(sse / n) / Math.max(mean, 1e-3);
        resN++;
      }
    }
  }
  return { N, residual: resSum / Math.max(resN, 1), solver };
}

function scoreNormals(N, truth, w, h, margin = 14) {
  const ax = [], bx = [], ay = [], by = [];
  let angSum = 0, angN = 0;
  for (let y = margin; y < h - margin; y++) {
    for (let x = margin; x < w - margin; x++) {
      const i = y * w + x;
      ax.push(N[i * 3]); bx.push(truth[i * 3]);
      ay.push(N[i * 3 + 1]); by.push(truth[i * 3 + 1]);
      const d = N[i * 3] * truth[i * 3] + N[i * 3 + 1] * truth[i * 3 + 1] + N[i * 3 + 2] * truth[i * 3 + 2];
      angSum += Math.acos(Math.max(-1, Math.min(1, d))); angN++;
    }
  }
  return { x: pearson(ax, bx), y: pearson(ay, by), ang: (angSum / angN) * 180 / Math.PI };
}

const CASES = [
  ['clean', [[0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0]],
    'nothing moved — does registering anyway cost anything?'],
  ['one frame, 1.3px', [[0, 0], [0, 0], [4, -2], [0, 0], [0, 0], [0, 0]],
    'sub-pixel drift on a single exposure'],
  ['one frame, 3px', [[0, 0], [0, 0], [9, 0], [0, 0], [0, 0], [0, 0]],
    'the displacement the Fit view was calibrated against'],
  ['one frame, 7px', [[0, 0], [0, 0], [21, 0], [0, 0], [0, 0], [0, 0]],
    'exactly one canvas-weave period — the lock-on trap'],
  ['creep, 0-2px', [[0, 0], [1, 0], [2, 1], [4, 1], [5, 2], [6, 2]],
    'every frame off, none of them by a whole pixel — a tripod settling'],
  ['3px, achromatic', [[0, 0], [0, 0], [9, 0], [0, 0], [0, 0], [0, 0]],
    'no colour to register on — does it say so, or just get it wrong quietly?',
    { desaturate: true }],
];

console.log('\n\nFrame registration vs known drift (6 shots, 300px, drift exact to 1/3 px)\n');
console.log('                        shift err (px)   normals r        mean angular   fit');
console.log('  case            state  mean    worst   nx      ny       error (deg)    residual');
console.log('  ' + '-'.repeat(82));

const regSummary = [];
for (const [name, drifts, note, capOpts] of CASES) {
  const cap = driftedCapture(drifts, capOpts);
  const before = cpuSolve(cap.frames, cap.dirs, cap.w, cap.h);
  const sBefore = scoreNormals(before.N, cap.truth, cap.w, cap.h);

  const reg = await registerFrames(cap.frames, { maxShift: 24 });
  if (!reg.ok) { console.log(`  ${name.padEnd(16)} REFUSED — ${reg.reason}`); continue; }

  const errs = reg.shifts.map((s, k) =>
    Math.hypot(s.dx - cap.trueShifts[k][0], s.dy - cap.trueShifts[k][1]));
  const errMean = errs.reduce((a, b) => a + b, 0) / errs.length;
  const errWorst = Math.max(...errs);

  const fixed = await applyShifts(cap.frames, reg.shifts);
  const after = cpuSolve(fixed, cap.dirs, cap.w, cap.h);
  const sAfter = scoreNormals(after.N, cap.truth, cap.w, cap.h);

  // Correct by the drift that was actually applied. Anything this row loses is
  // the price of resampling itself, not of measuring the shift wrong — worth
  // separating, because only one of the two is worth trying to improve.
  const ideal = cpuSolve(await applyShifts(cap.frames, cap.trueShifts.map(([dx, dy]) => ({ dx, dy }))),
    cap.dirs, cap.w, cap.h);
  const sIdeal = scoreNormals(ideal.N, cap.truth, cap.w, cap.h);

  const row = (label, err, s, res) => `  ${label.padEnd(16)}${''.padEnd(0)}`
    + `${err}  ${s.x.toFixed(4).padStart(7)} ${s.y.toFixed(4).padStart(7)}`
    + `    ${s.ang.toFixed(2).padStart(6)}       ${(res * 100).toFixed(2).padStart(5)}%`;
  console.log(row(name, ' as shot  ' + '   —      —  ', sBefore, before.residual));
  console.log(row('', 'registered ' + `${errMean.toFixed(3).padStart(5)}  ${errWorst.toFixed(3).padStart(5)} `, sAfter, after.residual));
  console.log(row('', ' by truth ' + '   0      0  ', sIdeal, ideal.residual));
  console.log(`  ${''.padEnd(16)}${note}\n  ${''.padEnd(16)}`
    + `[trusted pairs agree to ${reg.consistency.toFixed(3)}px; `
    + `${reg.outliers}/${reg.pairs} discounted${reg.reliable ? '' : '; FLAGGED UNRELIABLE'}]`);
  regSummary.push({ name, sBefore, sAfter, before: before.residual, after: after.residual, errWorst, consistency: reg.consistency });
}

// --- what the working-resolution cap costs ---------------------------------
//
// registerFrames measures the drift at a capped resolution because the feature
// costs ~0.4s/megapixel and a six-shot 12MP capture would otherwise spend half a
// minute before the first correlation. The claim that this is affordable needs a
// number, not an assurance: sub-pixel precision is in units of the reduced pixel,
// so at 1/4 scale an estimate good to 0.02 there is good to 0.08 where it is
// applied.

console.log('\n\nWhat measuring at reduced resolution costs (600px capture, one frame 2px out)\n');
console.log('  measured at   reduce   shift err (px, full-res)   normals nx / ny    fit');
console.log('  ' + '-'.repeat(74));
{
  const cap = driftedCapture([[0, 0], [0, 0], [6, 3], [0, 0], [0, 0], [0, 0]], { size: 600 });
  for (const maxSide of [600, 300, 150]) {
    const reg = await registerFrames(cap.frames, { maxShift: 24, maxSide });
    if (!reg.ok) { console.log(`  ${String(maxSide).padEnd(13)} REFUSED — ${reg.reason}`); continue; }
    const errs = reg.shifts.map((sh, k) =>
      Math.hypot(sh.dx - cap.trueShifts[k][0], sh.dy - cap.trueShifts[k][1]));
    const after = cpuSolve(await applyShifts(cap.frames, reg.shifts), cap.dirs, cap.w, cap.h);
    const sc = scoreNormals(after.N, cap.truth, cap.w, cap.h);
    console.log(`  ${String(600 / reg.reduce + 'px').padEnd(13)} ${String(reg.reduce).padStart(4)}     `
      + `mean ${(errs.reduce((a, b) => a + b, 0) / errs.length).toFixed(3)}  worst ${Math.max(...errs).toFixed(3)}      `
      + `${sc.x.toFixed(4)} / ${sc.y.toFixed(4)}   ${(after.residual * 100).toFixed(2)}%`);
  }
  const raw = cpuSolve(cap.frames, cap.dirs, cap.w, cap.h);
  const sr = scoreNormals(raw.N, cap.truth, cap.w, cap.h);
  console.log(`  ${'(uncorrected)'.padEnd(13)}    —     ${' '.repeat(24)}`
    + `${sr.x.toFixed(4)} / ${sr.y.toFixed(4)}   ${(raw.residual * 100).toFixed(2)}%`);
}

console.log('\nReading:');
console.log('  * "shift err" is against a drift that is exact by construction, not against');
console.log('    another estimate. Sub-pixel accuracy is the point: a per-pixel solve is');
console.log('    corrupted by half a pixel of drift as surely as by a whole one.');
console.log('  * The "by truth" row corrects by the drift that was actually applied. It is');
console.log('    the floor: whatever separates it from "as shot" is what registration can');
console.log('    win, and whatever separates it from perfect is the resampler, not the');
console.log('    measurement. Registered lands on it in every case, so what is left to');
console.log('    improve is interpolation — which is why the kernel was worth measuring.');
console.log('  * The clean row is the control. Registration resamples and resampling costs');
console.log('    sharpness, so the question is not only "does it fix drift" but "what does');
console.log('    it cost when there was none". Answer: nothing measurable, because median');
console.log('    anchoring leaves an undisturbed set on exact integer offsets and an exact');
console.log('    integer offset is a copy, not a filter.');
console.log('  * The 7px case is one full canvas-weave period, where a correlation lock can');
console.log('    land one period out and be confidently wrong. Chromaticity does not see an');
console.log('    achromatic weave at all, so the trap is not sprung.');
console.log('  * The achromatic row is the hard one: with no colour, the measurement falls');
console.log('    back on luminance alone and two of the fifteen pairs go wrong. It still');
console.log('    lands, because fifteen measurements of five unknowns can outvote two of');
console.log('    them — which is the argument for measuring every pair rather than every');
console.log('    frame against frame 0, where a bad pair would have carried its frame off');
console.log('    on its own. The discounted count is what reports that it happened.\n');
