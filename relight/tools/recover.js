// recover.js — the CPU reference implementations of both surface paths.
//
// Extracted from validate.mjs so that the synthetic bench and the real-capture
// harness (score-real.mjs) run *the same code*. That is not tidiness; it is what
// makes the two comparable. A real number and a synthetic number are only worth
// putting in the same table if the thing that produced them is identical, and a
// second copy of `integrate` living in the real harness would drift from this one
// silently — which is exactly the class of error HANDOFF.md §9 is about.
//
// Everything here is DOM-free and dependency-free so it runs under plain node.
// Nothing in here is GPU code: these mirror the shaders in src/gbuffer.js and
// src/photometric.js closely enough to score, and score-real.mjs can optionally
// cross-check the shipped shaders against them in a headless browser.

import { buildSolver } from '../src/photometric.js';

export const srgbToLin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };

/** 8-bit sRGB -> linear, precomputed. The per-pixel loops below are hot. */
export const LIN = (() => {
  const t = new Float32Array(256);
  for (let i = 0; i < 256; i++) t[i] = srgbToLin(i);
  return t;
})();

export function pearson(a, b) {
  const n = a.length;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let sa = 0, sb = 0, sab = 0;
  for (let i = 0; i < n; i++) { const u = a[i] - ma, v = b[i] - mb; sa += u * u; sb += v * v; sab += u * v; }
  return sab / Math.sqrt(sa * sb + 1e-20);
}

export function makeBlur(w, h) {
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

/** Size-agnostic Gaussian. Rebuilds the kernel per call; fine at bench sizes. */
export const blurF = (src, w, h, sigma) => makeBlur(w, h)(src, sigma);

export const HP_SIGMA = 3;

export function linPlanes(d, w, h) {
  const r = new Float32Array(w * h), g = new Float32Array(w * h), b = new Float32Array(w * h);
  for (let i = 0, p = 0; i < w * h; i++, p += 4) { r[i] = LIN[d[p]]; g[i] = LIN[d[p + 1]]; b[i] = LIN[d[p + 2]]; }
  return { r, g, b };
}

/**
 * Fine-scale achromatic residual of log luminance.
 *
 * The log ratio rather than the difference, because relief shading is
 * multiplicative on albedo — see src/gbuffer.js. This is the `slope` field: by
 * I ≈ Lz − |Lxy|·(∂h/∂â) it is proportional to a *derivative* of the surface.
 */
export function highpassLog(d, w, h, sigma = HP_SIGMA) {
  const { r, g, b } = linPlanes(d, w, h);
  const L = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) L[i] = 0.2126 * r[i] + 0.7152 * g[i] + 0.0722 * b[i];
  const lo = blurF(L, w, h, sigma), hp = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) hp[i] = Math.log(Math.max(L[i], 1e-4)) - Math.log(Math.max(lo[i], 1e-4));
  return hp;
}

export function sdOf(a) {
  let s1 = 0, s2 = 0;
  for (const v of a) { s1 += v; s2 += v * v; }
  const m = s1 / a.length;
  return Math.sqrt(Math.max(s2 / a.length - m * m, 1e-14));
}

/**
 * Reconstruct height by walking back along the source azimuth accumulating
 * −slope. Integrate, do not differentiate — HANDOFF.md §3.1. The linear taper
 * band-limits the integral so it does not accumulate unbounded DC drift.
 */
export function integrate(hp, w, h, ax, ay, taps = 8) {
  const H = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let t = 1; t <= taps; t++) {
      const sx = Math.round(x - ax * t), sy = Math.round(y - ay * t);
      if (sx < 0 || sx >= w || sy < 0 || sy >= h) break;
      acc += -hp[sy * w + sx] * (1 - (t - 1) / taps);
    }
    H[y * w + x] = acc;
  }
  return H;
}

/**
 * Recovery resolved ALONG and ACROSS the light azimuth.
 *
 * Not along x and y. HANDOFF.md §3.2 originally scored two rigs as nx / ny under
 * headings that said "along azimuth / perpendicular", which is only the same
 * thing when the azimuth lies on an image axis. It does not for the 141° rig, and
 * that mislabelling made a modest elevation effect look like a large one.
 */
export function alongAcross(H, N, w, h, ax, ay) {
  const P = [], PT = [], Q = [], QT = [];
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const gx = H[i - 1] - H[i + 1], gy = H[(y - 1) * w + x] - H[(y + 1) * w + x];
    const tx = N[i * 3], ty = N[i * 3 + 1];
    P.push(gx * ax + gy * ay); PT.push(tx * ax + ty * ay);
    Q.push(-gx * ay + gy * ax); QT.push(-tx * ay + ty * ax);
  }
  return { along: pearson(P, PT), across: pearson(Q, QT) };
}

/**
 * Score one exposure whose light direction is known, against known normals.
 *
 * Takes w and h separately: the synthetic bench is square, real photographs are
 * not, and a harness that silently assumed square would score a rectangle's
 * pixels against the wrong ground-truth texels.
 */
export function scoreShot(data, normals, w, h, dir, { sigma = HP_SIGMA, taps = 8 } = {}) {
  const hp = highpassLog(data, w, h, sigma);
  const an = Math.hypot(dir[0], dir[1]) || 1;
  const ax = dir[0] / an, ay = dir[1] / an;
  return {
    ...alongAcross(integrate(hp, w, h, ax, ay, taps), normals, w, h, ax, ay),
    contrast: sdOf(hp),
  };
}

/**
 * Photometric solve on the CPU. Least squares for g = albedo·N per pixel, plus
 * an ambient term when the rig's elevations vary enough to support one.
 *
 * `residual` is the Fit view's number: how well the Lambertian model reproduces
 * the photographs that produced it. HANDOFF.md §4.2 — it is blind to a *uniform*
 * rotation of the whole rig, which is why a sphere reading is not optional.
 */
export function cpuSolve(frames, dirs, w, h, { fitAmbient = true, margin = 14, exclude = null } = {}) {
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
      // `exclude` additionally drops a chrome sphere's disc — a mirror is not
      // Lambertian and its pixels otherwise dominate the residual (§4.2).
      const inside = x >= margin && y >= margin && x < w - margin && y < h - margin;
      if (inside && !(exclude && exclude(x, y))) {
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

export function scoreNormals(N, truth, w, h, margin = 14) {
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
