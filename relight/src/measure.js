// measure.js — descriptive measurements of a loaded photograph.
//
// DESCRIPTIVE, and the distinction is load-bearing. Five statistics that claimed
// to predict whether relief recovery would succeed have been built, calibrated
// against bench cases with known recovery, and deleted because they could not
// separate the good from the bad (README findings 10; HANDOFF §7 (the graveyard), §7
// (the graveyard)). Nothing
// here predicts recovery. Everything here is a property of the pixels that can be
// checked directly against tools/spectrum.mjs.
//
// The one shipped so far answers a question the UI could not otherwise answer:
// *is the Chroma reject control doing anything at all?* On the owner's cast cement
// the fine-scale chroma signal measures 0.019 of the luma signal — the mechanism
// that separates pigment from relief is arbitrating with a signal fifty times
// weaker than the thing it judges, and the slider is inert. Without this readout
// there is no way to know that from inside the tool, and dragging an inert control
// feels exactly like tuning.
//
// DOM-free so the Node harness can score the same function the browser runs.

/** Separable Gaussian on a single plane. Reflect-free clamp at the edges. */
function blur(src, w, h, sigma) {
  const rad = Math.max(1, Math.ceil(sigma * 3));
  const k = new Float32Array(rad * 2 + 1);
  let ks = 0;
  for (let i = -rad; i <= rad; i++) { const v = Math.exp(-i * i / (2 * sigma * sigma)); k[i + rad] = v; ks += v; }
  const t = new Float32Array(w * h), o = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let i = -rad; i <= rad; i++) s += src[y * w + Math.min(w - 1, Math.max(0, x + i))] * k[i + rad];
    t[y * w + x] = s / ks;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let i = -rad; i <= rad; i++) s += t[Math.min(h - 1, Math.max(0, y + i)) * w + x] * k[i + rad];
    o[y * w + x] = s / ks;
  }
  return o;
}

const sd = (a) => {
  let s1 = 0, s2 = 0;
  for (const v of a) { s1 += v; s2 += v * v; }
  const m = s1 / a.length;
  return Math.sqrt(Math.max(s2 / a.length - m * m, 1e-14));
};

const LIN = (() => {
  const t = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const v = i / 255;
    t[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }
  return t;
})();

/**
 * Fine-scale chroma signal against fine-scale luma signal, on one RGBA block.
 *
 * Chroma reject works by noticing that a pigment change moves hue while shading
 * does not (src/gbuffer.js). Where this ratio is near zero the two are
 * indistinguishable in one photograph, and no setting of the control changes that
 * — it is a property of the material, not a tuning problem.
 */
function ratioOfBlock(rgba, w, h, sigma) {
  const n = w * h;
  const r = new Float32Array(n), g = new Float32Array(n), b = new Float32Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) { r[i] = LIN[rgba[p]]; g[i] = LIN[rgba[p + 1]]; b[i] = LIN[rgba[p + 2]]; }

  const L = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = 0.2126 * r[i] + 0.7152 * g[i] + 0.0722 * b[i];
  const Lb = blur(L, w, h, sigma);
  const hp = new Float32Array(n);
  for (let i = 0; i < n; i++) hp[i] = Math.log(Math.max(L[i], 1e-4)) - Math.log(Math.max(Lb[i], 1e-4));

  // Chromaticity r/(r+g+b) and b/(r+g+b): shading is one scalar on all three
  // channels, so dividing by the sum removes it and leaves only pigment.
  const c1 = new Float32Array(n), c2 = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const s = Math.max(r[i] + g[i] + b[i], 1e-6);
    c1[i] = r[i] / s; c2[i] = b[i] / s;
  }
  const b1 = blur(c1, w, h, sigma), b2 = blur(c2, w, h, sigma);
  const ch = new Float32Array(n);
  for (let i = 0; i < n; i++) ch[i] = Math.hypot(c1[i] - b1[i], c2[i] - b2[i]);

  const luma = sd(hp), chroma = sd(ch);
  return { luma, chroma };
}

/**
 * Sample several blocks across an image and return the mean chroma:luma ratio.
 *
 * Blocks rather than the whole frame because the cost is linear in pixels and this
 * runs on load; spread across the frame rather than one central sample because a
 * painting is not uniform.
 *
 * @param rgba  RGBA bytes of the WORKING image — the one actually being processed,
 *   so the number describes what the shader will see rather than the original file.
 */
export function chromaSignal(rgba, w, h, { sigma = 3, block = 320, blocks = 4 } = {}) {
  const bw = Math.min(block, w), bh = Math.min(block, h);
  const spots = [[0.28, 0.28], [0.72, 0.33], [0.32, 0.7], [0.7, 0.72]].slice(0, blocks);
  let luma = 0, chroma = 0, n = 0;
  for (const [fx, fy] of spots) {
    const x0 = Math.max(0, Math.min(w - bw, Math.round(fx * w - bw / 2)));
    const y0 = Math.max(0, Math.min(h - bh, Math.round(fy * h - bh / 2)));
    const sub = new Uint8ClampedArray(bw * bh * 4);
    for (let y = 0; y < bh; y++) {
      const s = ((y0 + y) * w + x0) * 4;
      sub.set(rgba.subarray(s, s + bw * 4), y * bw * 4);
    }
    const r = ratioOfBlock(sub, bw, bh, sigma);
    luma += r.luma; chroma += r.chroma; n++;
  }
  luma /= n; chroma /= n;
  const ratio = chroma / Math.max(luma, 1e-9);
  return {
    ratio, luma, chroma,
    // Thresholds are descriptive bands, not a pass/fail on the photograph.
    verdict: ratio < 0.05 ? 'inert' : ratio < 0.15 ? 'weak' : 'usable',
  };
}
