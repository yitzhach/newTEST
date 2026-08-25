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

/**
 * Render the height field as a copy-stand photograph would record it, and return
 * both that render and the ground-truth normals.
 */
/**
 * @param {object}  opts
 * @param {'symmetric'|'single'|'raking'} opts.lighting  How the repro shot was lit.
 *   'symmetric' models a proper archival copy-stand: two matched lights at equal
 *   and opposite angles. That geometry cancels first-order relief shading almost
 *   exactly — it is *designed* to suppress texture — so it is the hardest case,
 *   not the easiest. 'single' models an ordinary one-light shot. 'raking' is the
 *   easy case and is included mainly as an upper bound.
 * @param {number}  opts.pigmentDetail  How much fine-scale colour variation the
 *   paint itself carries, independent of relief. This is the adversary: it is
 *   high-frequency luminance that is *not* geometry.
 */
export function synthesizePainting({ width = 900, height = 1100, seed = 7,
                                     lighting = 'single', pigmentDetail = 0.35 } = {}) {
  const w = width, h = height;
  const H = buildHeight(w, h, seed);
  const rnd = mulberry32(seed + 991);

  // Pigment field, uncorrelated with relief. Three broad colour zones plus a
  // finer mottling, so there are strong colour edges sitting on flat surface.
  const nA = valueNoise(w, h, 5, rnd);
  const nB = valueNoise(w, h, 13, rnd);
  const nC = valueNoise(w, h, 31, rnd);

  const img = new ImageData(w, h);
  const px = img.data;
  const normals = new Float32Array(w * h * 3);

  // Copy-stand lighting: two broad sources at ~45 degrees from opposite sides,
  // which is what a flat repro shot uses to *suppress* relief. Deliberately a
  // weak signal — if the extractor needs dramatic input lighting to work, it
  // would be useless on exactly the photographs this tool targets.
  const RIGS = {
    symmetric: { dirs: [[-0.55, 0.45, 0.70], [0.55, -0.45, 0.70]], weights: [0.5, 0.5] },
    single:    { dirs: [[-0.55, 0.45, 0.70]],                      weights: [1.0] },
    raking:    { dirs: [[-0.90, 0.20, 0.35]],                      weights: [1.0] },
  };
  const rig = RIGS[lighting] || RIGS.single;
  const dirs = rig.dirs.map((d) => {
    const n = Math.hypot(d[0], d[1], d[2]);
    return [d[0] / n, d[1] / n, d[2] / n];
  });

  // Tuned so typical brushstroke flanks land around 15-25 degrees off normal, which
  // is the range real impasto occupies. Too shallow and the ground truth is
  // indistinguishable from a flat plane, which makes the comparison meaningless.
  const HEIGHT_TO_SLOPE = 1.2;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const xm = x > 0 ? x - 1 : x, xp = x < w - 1 ? x + 1 : x;
      const ym = y > 0 ? y - 1 : y, yp = y < h - 1 ? y + 1 : y;
      const dhdx = (H[y * w + xp] - H[y * w + xm]) * 0.5;
      const dhdy = (H[yp * w + x] - H[ym * w + x]) * 0.5;

      let nx = -dhdx * HEIGHT_TO_SLOPE, ny = dhdy * HEIGHT_TO_SLOPE, nz = 1;
      const inv = 1 / Math.hypot(nx, ny, nz);
      nx *= inv; ny *= inv; nz *= inv;
      normals[i * 3] = nx; normals[i * 3 + 1] = ny; normals[i * 3 + 2] = nz;

      let shade = 0.18;
      for (let k = 0; k < dirs.length; k++) {
        const d = dirs[k];
        shade += rig.weights[k] * Math.max(0, nx * d[0] + ny * d[1] + nz * d[2]);
      }

      // Pigment: warm ochre ground, a cool blue passage, a red accent.
      const a = nA[i], b = nB[i], c = nC[i];
      const mix = Math.min(1, Math.max(0, a * 1.4 - 0.2));
      let r = (0.72 * mix + 0.18 * (1 - mix)) + 0.16 * (b - 0.5);
      let g = (0.55 * mix + 0.26 * (1 - mix)) + 0.13 * (b - 0.5);
      let bl = (0.24 * mix + 0.52 * (1 - mix)) + 0.15 * (b - 0.5);
      if (a > 0.72) { r += 0.22; g -= 0.08; bl -= 0.10; }   // hard pigment edge
      // Fine-scale pigment mottle. Chromatic by construction: a pigment change
      // moves hue, whereas relief shading scales all three channels together.
      // That difference is the only thing separating them, and it is what the
      // extractor's chroma-reject term keys on.
      const fine = (c - 0.5) * pigmentDetail;
      r += fine * 0.30; g -= fine * 0.10; bl -= fine * 0.26;

      const enc = (lin) => {
        const v = Math.min(1, Math.max(0, lin));
        const s = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
        return Math.round(s * 255);
      };
      const o = i * 4;
      px[o]     = enc(r * shade);
      px[o + 1] = enc(g * shade);
      px[o + 2] = enc(bl * shade);
      px[o + 3] = 255;
    }
  }

  return { image: img, normals, height: H, width: w, rows: h };
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
