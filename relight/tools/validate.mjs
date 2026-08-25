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
