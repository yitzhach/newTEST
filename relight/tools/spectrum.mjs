// spectrum.mjs — what is in this photograph, at what scale, and in what colour.
//
//   node relight/tools/spectrum.mjs <image> [--crops=5] [--size=768]
//
// This DESCRIBES a photograph. It does not predict whether relief recovery will
// work on it, and the distinction is the whole point: §4.3 records a shot-quality
// gate that was built, measured and deleted because its statistic moved the wrong
// way, and two further candidates were built and killed the same way afterwards
// (§4.4). Nothing here is a gate. Every number below is a property of the image
// that can be checked directly, with no claim about recovery attached.
//
// Two things it answers that are worth knowing before touching a slider:
//
//   1. WHICH BAND the material's texture occupies. The relief-scale default of 3px
//      was tuned on a synthetic weave with a clean 7px period. Real material was
//      found to be broadband (§4.3) and there is no single right default, so the
//      honest move is to look at the actual distribution rather than guess.
//
//   2. WHETHER CHROMA REJECT CAN DO ANYTHING. It separates pigment from relief by
//      noticing that a pigment change shifts hue while shading does not. On
//      material whose fine detail carries no chroma at all, it is inert — and then
//      grain and relief are genuinely indistinguishable in one photograph, which is
//      a fact about the material rather than a tuning problem.
//
// Sampled as native-resolution crops rather than a downscaled whole, because a
// resample would low-pass precisely the band in question.

import { basename } from 'node:path';
import { decodeImage, imageSize, closeDecoder } from './decode.js';
import { blurF, sdOf, linPlanes } from './recover.js';

const argv = process.argv.slice(2);
const src = argv.find((a) => !a.startsWith('--'));
const num = (n, d) => { const h = argv.find((a) => a.startsWith(`--${n}=`)); return h ? Number(h.split('=')[1]) : d; };

if (!src) {
  console.error('usage: node relight/tools/spectrum.mjs <image> [--crops=5] [--size=768]');
  process.exit(2);
}

const S = num('size', 768);
const NCROPS = num('crops', 5);
const SIGMAS = [1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32];
const pad = (v, n = 4) => v.toFixed(n).padStart(n + 3);

const size = await imageSize(src);
console.log(`\n${basename(src)} — ${size.width}x${size.height} (${(size.width * size.height / 1e6).toFixed(1)} MP)`);
console.log(`Sampling ${NCROPS} crops of ${S}x${S} at native resolution.\n`);

// Spread the crops over the frame rather than clustering in the middle: a painting
// is not uniform, and a single central sample would miss that.
const spots = [];
for (let i = 0; i < NCROPS; i++) {
  const t = (i + 0.5) / NCROPS;
  spots.push([
    `crop-${i}`,
    Math.round(Math.max(0, Math.min(size.width - S, (0.15 + 0.7 * ((i * 0.618) % 1)) * size.width - S / 2))),
    Math.round(Math.max(0, Math.min(size.height - S, (0.12 + 0.76 * t) * size.height - S / 2))),
  ]);
}

const rows = [];
for (const [name, x, y] of spots) {
  const { data, width: w, height: h } = await decodeImage(src, { region: { x, y, w: S, h: S } });
  const { r, g, b } = linPlanes(data, w, h);
  const L = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) L[i] = 0.2126 * r[i] + 0.7152 * g[i] + 0.0722 * b[i];
  rows.push({ name, x, y, w, h, L, r, g, b });
}
await closeDecoder();

// --- band energy ------------------------------------------------------------

console.log('Band energy — sd of the high-passed log luminance at each relief scale');
console.log('(this is the `slope` field gbuffer.js integrates, in its own units)\n');
console.log('  crop  at            ' + SIGMAS.map((s) => String(s).padStart(7)).join(''));
console.log('  ' + '-'.repeat(20 + 7 * SIGMAS.length));
for (const row of rows) {
  row.per = SIGMAS.map((sig) => {
    const lo = blurF(row.L, row.w, row.h, sig);
    const hp = new Float32Array(row.w * row.h);
    for (let i = 0; i < hp.length; i++) {
      hp[i] = Math.log(Math.max(row.L[i], 1e-4)) - Math.log(Math.max(lo[i], 1e-4));
    }
    return sdOf(hp);
  });
  console.log(`  ${String(row.x).padStart(5)},${String(row.y).padEnd(6)}  `
    + row.per.map((v) => pad(v)).join(''));
}

console.log('\n\nEnergy ADDED by each band — where the texture actually lives\n');
console.log('  crop  at            ' + SIGMAS.slice(1).map((s, i) => `${SIGMAS[i]}-${s}`.padStart(8)).join(''));
console.log('  ' + '-'.repeat(20 + 8 * (SIGMAS.length - 1)));
const peaks = [];
for (const row of rows) {
  const d = row.per.slice(1).map((v, i) => v - row.per[i]);
  const pk = d.indexOf(Math.max(...d));
  peaks.push(pk);
  console.log(`  ${String(row.x).padStart(5)},${String(row.y).padEnd(6)}  `
    + d.map((v, i) => (i === pk ? '*' : ' ') + v.toFixed(4).padStart(7)).join(''));
}
const modal = peaks.sort((a, b) => peaks.filter((v) => v === a).length - peaks.filter((v) => v === b).length).pop();
console.log(`\n  * = band contributing most energy. Modal peak: ${SIGMAS[modal]}-${SIGMAS[modal + 1]}px.`);
console.log('  A spectrum that only decays, with its peak at the finest band, has no');
console.log('  characteristic scale — that is what "broadband" means in §4.3, and it means');
console.log('  no choice of relief scale isolates relief from grain, because they overlap');
console.log('  continuously rather than sitting in different bands.');

// --- chroma -----------------------------------------------------------------

console.log('\n\nCan chroma reject do anything here?\n');
console.log('  crop  at             luma sd   chroma sd    ratio');
console.log('  ' + '-'.repeat(52));
let ratios = [];
for (const row of rows) {
  const { r, g, b, w, h, L } = row;
  const SIG = 3;
  const lo = blurF(L, w, h, SIG);
  const hp = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) hp[i] = Math.log(Math.max(L[i], 1e-4)) - Math.log(Math.max(lo[i], 1e-4));
  const c1 = new Float32Array(w * h), c2 = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const s = Math.max(r[i] + g[i] + b[i], 1e-6);
    c1[i] = r[i] / s; c2[i] = b[i] / s;
  }
  const b1 = blurF(c1, w, h, SIG), b2 = blurF(c2, w, h, SIG);
  const ch = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) ch[i] = Math.hypot(c1[i] - b1[i], c2[i] - b2[i]);
  const ls = sdOf(hp), cs = sdOf(ch), ratio = cs / Math.max(ls, 1e-9);
  ratios.push(ratio);
  console.log(`  ${String(row.x).padStart(5)},${String(row.y).padEnd(6)}   ${pad(ls)}    ${pad(cs)}   ${pad(ratio, 3)}`);
}
const mean = ratios.reduce((a, v) => a + v, 0) / ratios.length;
console.log(`\n  mean ratio ${mean.toFixed(3)} — `
  + (mean < 0.05
    ? 'ACHROMATIC. Chroma reject is inert on this material: the fine detail\n'
      + '  shifts no hue, so nothing distinguishes pigment grain from relief in one\n'
      + '  photograph. This is the §4.3 case, and it is a property of the material.'
    : mean < 0.15
      ? 'nearly achromatic — chroma reject has little to work with.'
      : 'there is usable chroma; chroma reject can separate pigment from shading.'));

// --- JPEG blocking ----------------------------------------------------------

console.log('\n\nJPEG 8x8 blocking\n');
console.log('  Mean |d log L| across 8px block boundaries against everywhere else.');
console.log('  A ratio near 1.0 means no visible blocking.\n');
console.log('  crop  at             on-grid   off-grid    ratio');
console.log('  ' + '-'.repeat(52));
for (const row of rows) {
  const { L, w, h } = row;
  let on = 0, onN = 0, off = 0, offN = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const g = Math.abs(Math.log(Math.max(L[y * w + x], 1e-4)) - Math.log(Math.max(L[y * w + x - 1], 1e-4)));
    if (x % 8 === 0) { on += g; onN++; } else { off += g; offN++; }
  }
  const a = on / onN, bb = off / offN;
  console.log(`  ${String(row.x).padStart(5)},${String(row.y).padEnd(6)}   ${pad(a, 5)}   ${pad(bb, 5)}   ${pad(a / bb, 3)}`
    + (a / bb > 1.15 ? '  <- blocking' : ''));
}
console.log('');
