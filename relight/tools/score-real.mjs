// score-real.mjs — point the ground-truth harness at real photographs.
//
//   node relight/tools/score-real.mjs <capture-dir> --preflight
//   node relight/tools/score-real.mjs <capture-dir>
//   node relight/tools/score-real.mjs <capture-dir> --sweep
//
// tools/validate.mjs scores surface recovery against a surface it synthesised, so
// the truth is exact and free. A real painting comes with no truth at all. This
// harness manufactures one: a six-exposure photometric capture solves to normals
// at r ~ 0.9995 (HANDOFF.md §4), and each individual exposure of that same capture
// is also a valid single-photo input. So one shoot yields six (photograph -> known
// normals) pairs, and the single-image path can finally be scored on real material
// instead of on synth.js.
//
// That matters because every single-image number in this project is synthetic, and
// §4.3 recorded that the one real photograph the project has seen behaved unlike
// every synthetic case — its high-pass contrast read 0.67-0.86, above every bench
// value, while returning speckle. Numbers from the bench do not transfer.
//
// The recovery maths is imported from tools/recover.js, the same module the
// synthetic bench uses. Not for tidiness: a second copy of `integrate` living here
// would drift from the bench's silently, and then the real column and the
// synthetic column in the same table would no longer be measuring the same thing.
//
// WHAT THIS CANNOT DO, stated up front because §4.2 is unintuitive: the photometric
// normals are ground truth only as far as the light directions are. Rotate the
// whole rig by one angle and the solve reproduces every photograph perfectly — the
// fit residual reads an identical 0.17% at every angle — while handing back a
// surface rotated off the painting. Nothing computed from the exposures alone can
// see it. A chrome sphere in frame can, because it measures each direction against
// the room. Without one, every number below is conditional on typed-in angles being
// right, and this tool says so loudly rather than printing a confident table.

import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { decodeImage, closeDecoder } from './decode.js';
import {
  LIN, HP_SIGMA, scoreShot, cpuSolve, pearson,
} from './recover.js';

// synth.js and register.js construct ImageData; node has no DOM.
globalThis.ImageData = class {
  constructor(w, h) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(w * h * 4); }
};

const { registerFrames, applyShifts } = await import(new URL('../src/register.js', import.meta.url));
const { estimateLight } = await import(new URL('../src/sphere.js', import.meta.url));
const { buildSolver } = await import(new URL('../src/photometric.js', import.meta.url));

// ---------------------------------------------------------------- arguments

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const positional = argv.filter((a) => !a.startsWith('--'));
const numFlag = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split('=')[1]) : dflt;
};

const DIR = positional[0];
const PREFLIGHT_ONLY = flags.has('--preflight');
const SWEEP = flags.has('--sweep');
const NO_REGISTER = flags.has('--no-register');
// --json emits the results as one JSON object instead of the human report, so a
// script can consume them without parsing prose. The prose is the primary output:
// this harness exists to be read by a person deciding whether a capture is sound.
const JSON_MODE = flags.has('--json');
// A measurement, not an export. §7 records what measuring at reduced resolution
// costs on the photometric path: 0.9994/0.9990 at half scale against 0.9997/0.9996
// at full — far smaller than the effects being looked for here, and the difference
// between a solve that finishes in seconds and one that does not finish.
const MAX_DIM = numFlag('max-dim', 1100);

if (!DIR) {
  console.error(`
score-real.mjs — score surface recovery against a real photometric capture

  node relight/tools/score-real.mjs <capture-dir> [options]

  --preflight     check the capture is solvable, then stop. Run this before you
                  strike the lights: it catches the two faults that cannot be
                  fixed afterwards (a rank-deficient rig, an undersized sphere).
  --sweep         also sweep the relief scale, to find which spatial band of this
                  material actually carries relief (§4.3: real material is
                  broadband, and the 3px default was tuned on a synthetic weave).
  --no-register   skip frame alignment.
  --max-dim=N     long edge for the measurement (default ${MAX_DIM}).

The capture directory needs a capture.json — see README.md, "Capture bundles".
`);
  process.exit(2);
}

// ----------------------------------------------------------------- manifest

const dir = resolve(DIR);
const manifestPath = join(dir, 'capture.json');
if (!existsSync(manifestPath)) {
  console.error(`No capture.json in ${dir}\nSee README.md, "Capture bundles", for the format.`);
  process.exit(2);
}

let M;
try {
  M = JSON.parse(readFileSync(manifestPath, 'utf8'));
} catch (e) {
  console.error(`capture.json is not valid JSON: ${e.message}`);
  process.exit(2);
}
if (!Array.isArray(M.exposures) || M.exposures.length === 0) {
  console.error('capture.json has no "exposures" array.');
  process.exit(2);
}
for (const [i, e] of M.exposures.entries()) {
  if (!e.file) { console.error(`exposure ${i} has no "file".`); process.exit(2); }
  if (typeof e.azimuth !== 'number' || typeof e.elevation !== 'number') {
    console.error(`exposure ${i} (${e.file}) needs numeric "azimuth" and "elevation" in degrees.`);
    process.exit(2);
  }
}

const dirFrom = (azDeg, elDeg) => {
  const a = azDeg * Math.PI / 180, e = elDeg * Math.PI / 180;
  return [Math.cos(a) * Math.cos(e), Math.sin(a) * Math.cos(e), Math.sin(e)];
};

/** Human report goes through here so --json can silence it. Errors never do. */
const say = (...a) => { if (!JSON_MODE) console.log(...a); };
/** Machine-readable accumulator, printed at the end under --json. */
const RESULT = { painting: M.painting || null, dir, preflight: {}, exposures: [] };

// -------------------------------------------------------------- image input

/**
 * Read every exposure. Sequential rather than parallel: six 24MP frames as RGBA is
 * 576MB held at once, and the decoder shares one browser page anyway.
 */
async function loadAll(files) {
  const out = [];
  for (const f of files) out.push(await decodeImage(f));
  return out;
}

/**
 * Area-average downscale in LINEAR light.
 *
 * In linear light because that is where a sensor averages; averaging sRGB code
 * values darkens texture asymmetrically, which on a fine achromatic surface is
 * precisely the signal being measured.
 */
function downscale(img, maxDim) {
  const { width: w, height: h, data } = img;
  const scale = Math.max(w, h) / maxDim;
  if (scale <= 1) return img;
  const nw = Math.max(1, Math.round(w / scale)), nh = Math.max(1, Math.round(h / scale));
  const out = new Uint8ClampedArray(nw * nh * 4);
  const enc = (v) => {
    const c = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, Math.round(c * 255)));
  };
  for (let y = 0; y < nh; y++) {
    const y0 = Math.floor(y * scale), y1 = Math.min(h, Math.max(y0 + 1, Math.floor((y + 1) * scale)));
    for (let x = 0; x < nw; x++) {
      const x0 = Math.floor(x * scale), x1 = Math.min(w, Math.max(x0 + 1, Math.floor((x + 1) * scale)));
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
        const p = (yy * w + xx) * 4;
        r += LIN[data[p]]; g += LIN[data[p + 1]]; b += LIN[data[p + 2]]; n++;
      }
      const d = (y * nw + x) * 4;
      out[d] = enc(r / n); out[d + 1] = enc(g / n); out[d + 2] = enc(b / n); out[d + 3] = 255;
    }
  }
  return { data: out, width: nw, height: nh };
}

// ---------------------------------------------------------------- preflight

const fmt = (v, n = 4) => (Number.isFinite(v) ? v.toFixed(n) : '  --  ');
const line = (n = 78) => '-'.repeat(n);

function preflight(imgs) {
  const problems = [], warnings = [], notes = [];
  const n = M.exposures.length;

  // 1. Same framing. The solve is per pixel and assumes every exposure sees the
  //    same one; registration corrects translation only, never a size change.
  const w = imgs[0].width, h = imgs[0].height;
  const odd = imgs.map((im, i) => (im.width !== w || im.height !== h ? i : -1)).filter((i) => i >= 0);
  if (odd.length) {
    problems.push(`exposures differ in size: ${odd.map((i) => `${M.exposures[i].file} `
      + `(${imgs[i].width}x${imgs[i].height})`).join(', ')} against ${w}x${h}. `
      + 'A reframe or a zoom change between shots is a re-shoot.');
  }

  // 2. Enough exposures to leave something spare. §4.4 rule 2: an exactly
  //    determined system fits perfectly by construction, so the fit residual
  //    reads 0.00% however wrong the capture is.
  const unknowns = 4; // three for the normal, one for ambient
  if (n < unknowns) {
    problems.push(`${n} exposures cannot solve for ${unknowns} unknowns.`);
  } else if (n === unknowns) {
    warnings.push(`${n} exposures is exactly determined — the fit residual will read `
      + '0.00% whatever is wrong with the capture, and means nothing. Six is the default '
      + 'for this reason (§4.4).');
  } else {
    notes.push(`${n} exposures, ${n - unknowns} spare — the fit residual carries information.`);
  }

  // 3. Elevation must vary or the ambient column is collinear with Lz and the
  //    solve is rank-deficient. buildSolver detects this and refuses; ask it
  //    rather than reimplementing the test.
  const dirs = M.exposures.map((e) => dirFrom(e.azimuth, e.elevation));
  const solver = buildSolver(dirs, { fitAmbient: true });
  if (!solver.ok) {
    problems.push(`the rig will not solve: ${solver.reason}`);
  }
  const elevs = M.exposures.map((e) => e.elevation);
  const spread = Math.max(...elevs) - Math.min(...elevs);
  if (spread < 10) {
    problems.push(`light elevation varies by only ${spread.toFixed(1)}° across the capture. `
      + 'Constant elevation makes the ambient term unrecoverable (README capture protocol, '
      + 'rule 3). Aim for ~15° of variation between exposures.');
  } else {
    notes.push(`elevation spread ${spread.toFixed(1)}° — enough to fit ambient.`);
  }

  // 4. Azimuths should actually go round. Six lights bunched into one quadrant
  //    constrain the surface along one axis and leave the other soft.
  const biggestGap = (() => {
    const a = M.exposures.map((e) => ((e.azimuth % 360) + 360) % 360).sort((x, y) => x - y);
    let biggest = (a[0] + 360) - a[a.length - 1];
    for (let i = 1; i < a.length; i++) biggest = Math.max(biggest, a[i] - a[i - 1]);
    return biggest;
  })();
  if (biggestGap > 180) {
    warnings.push(`the light azimuths leave a ${biggestGap.toFixed(0)}° gap. Slopes facing into `
      + 'that gap are lit obliquely by every lamp and come out poorly constrained.');
  } else {
    notes.push(`largest azimuth gap ${biggestGap.toFixed(0)}° — the lights go round the piece.`);
  }

  // 5. The sphere. §4.2 — the one fault nothing else in this tool can see is a
  //    rig that is uniformly wrong, and only a sphere measures against the room.
  if (!M.sphere) {
    warnings.push('NO CHROME SPHERE in this capture. The light directions are whatever was '
      + 'typed into capture.json. A rig uniformly rotated by 40° reproduces every '
      + 'photograph at an identical 0.17% fit residual while returning a surface rotated '
      + 'off the painting (§4.2), and nothing computed from the exposures can detect it. '
      + 'Every number this tool prints is conditional on those angles being right.');
  } else {
    const { r } = M.sphere;
    // Error scales with circle-error / radius, not with pixels: 3px of centre
    // error costs 9.63° at r=40 and 1.60° at r=300 (§4.2). Never a hard failure —
    // a small sphere degrades the reading, it does not stop the capture solving,
    // and the reading is cross-checked against the nominal angles below anyway.
    if (r < 60) {
      warnings.push(`the sphere is only ${r}px in radius, where 3px of hand-placement error `
        + `costs about ${(9.63 * 40 / r).toFixed(1)}° — the same order as simply recalling the `
        + 'angle, so it buys little over typing one in. The protocol asks for 300px or more.');
    } else if (r < 300) {
      warnings.push(`sphere radius ${r}px — usable, but below the 300px the protocol asks for. `
        + `3px of hand-placement error is about ${(9.63 * 40 / r).toFixed(2)}° here.`);
    } else {
      notes.push(`sphere radius ${r}px — 3px of placement error costs about `
        + `${(9.63 * 40 / r).toFixed(2)}°.`);
    }
    if (!odd.length) {
      const { cx, cy } = M.sphere;
      if (cx - r < 0 || cy - r < 0 || cx + r > w || cy + r > h) {
        problems.push(`the sphere disc at (${cx}, ${cy}) r=${r} is not fully inside the `
          + `${w}x${h} frame. Take the reading before cropping.`);
      }
    }
  }

  return { problems, warnings, notes };
}

// --------------------------------------------------------------------- main

say(`\nCapture: ${M.painting || '(unnamed)'}${M.material ? `  —  ${M.material}` : ''}`);
if (M.shot) say(`Shot:    ${M.shot}`);
say(`Source:  ${dir}`);
say(`         ${M.exposures.length} exposures\n`);

const files = M.exposures.map((e) => join(dir, e.file));
for (const f of files) {
  if (!existsSync(f)) { console.error(`missing exposure file: ${f}`); process.exit(2); }
  if (statSync(f).size === 0) { console.error(`empty exposure file: ${f}`); process.exit(2); }
}

let raw;
try {
  raw = await loadAll(files);
} catch (e) {
  console.error(`\n${e.message}\n`);
  await closeDecoder();
  process.exit(2);
}

const pf = preflight(raw);

say('Preflight\n');
for (const s of pf.notes) say(`  ok    ${s}`);
for (const s of pf.warnings) say(`  WARN  ${s}`);
for (const s of pf.problems) say(`  FAIL  ${s}`);
say('');

RESULT.preflight = { problems: pf.problems, warnings: pf.warnings, notes: pf.notes,
                     ok: pf.problems.length === 0 };

if (pf.problems.length) {
  if (JSON_MODE) console.log(JSON.stringify(RESULT, null, 2));
  say(line());
  say('This capture will not produce a trustworthy surface. Nothing below would');
  say('mean anything, so it is not computed. Refusing rather than approximating is');
  say('the convention here (HANDOFF.md §9) — every one of these faults otherwise');
  say('yields confident, plausible, wrong output.\n');
  await closeDecoder();
  process.exit(1);
}

if (PREFLIGHT_ONLY) {
  if (JSON_MODE) console.log(JSON.stringify(RESULT, null, 2));
  say('Preflight only. The capture is solvable.\n');
  await closeDecoder();
  process.exit(0);
}

// Downscale for measurement.
const full = raw[0];
const imgs = raw.map((im) => downscale(im, MAX_DIM));
const W = imgs[0].width, H = imgs[0].height;
const scaleFactor = full.width / W;
say(`Measuring at ${W}x${H}`
  + (scaleFactor > 1.001 ? ` (from ${full.width}x${full.height}, ÷${scaleFactor.toFixed(2)})` : '')
  + '\n');

// --- light directions -------------------------------------------------------

const nominal = M.exposures.map((e) => dirFrom(e.azimuth, e.elevation));
let dirs = nominal;
let sphereRead = null;

if (M.sphere) {
  // The sphere lives at full resolution; read it there, before any downscale.
  const s = M.sphere;
  const reads = raw.map((im) => estimateLight(im.data, im.width, im.height, s));
  const okAll = reads.every((r) => r && r.ok);
  say('Light directions read off the chrome sphere\n');
  say('  shot   nominal az/elev     measured az/elev    delta    deg/px');
  say('  ' + line(66));
  reads.forEach((r, i) => {
    const e = M.exposures[i];
    if (!r || !r.ok) {
      say(`  ${String(i).padStart(4)}   ${fmt(e.azimuth, 1).padStart(6)} / ${fmt(e.elevation, 1).padStart(5)}`
        + `      failed: ${r ? r.reason : 'no reading'}`);
      return;
    }
    const d = Math.acos(Math.max(-1, Math.min(1,
      r.dir[0] * nominal[i][0] + r.dir[1] * nominal[i][1] + r.dir[2] * nominal[i][2]))) * 180 / Math.PI;
    say(`  ${String(i).padStart(4)}   ${fmt(e.azimuth, 1).padStart(6)} / ${fmt(e.elevation, 1).padStart(5)}`
      + `      ${fmt(r.az, 1).padStart(6)} / ${fmt(r.elev, 1).padStart(5)}`
      + `     ${fmt(d, 2).padStart(5)}   ${fmt(r.sensitivity, 2).padStart(5)}`);
    (RESULT.sphere ||= []).push({ shot: i, nominalAz: e.azimuth, nominalElev: e.elevation,
                                  readAz: r.az, readElev: r.elev, deltaDeg: d,
                                  degPerPx: r.sensitivity });
  });
  if (okAll) {
    sphereRead = reads;
    dirs = reads.map((r) => r.dir);
    // A circle that is not on a sphere still returns confident directions. The
    // check that catches it: the lamp moved between exposures, so readings that
    // all agree cannot be readings of a mirror (§4.2).
    let maxPair = 0;
    for (let i = 0; i < dirs.length; i++) for (let j = i + 1; j < dirs.length; j++) {
      const d = Math.acos(Math.max(-1, Math.min(1,
        dirs[i][0] * dirs[j][0] + dirs[i][1] * dirs[j][1] + dirs[i][2] * dirs[j][2]))) * 180 / Math.PI;
      maxPair = Math.max(maxPair, d);
    }
    say('');
    if (maxPair < 5) {
      say(`  REFUSING the sphere reading: all six directions agree to within `
        + `${maxPair.toFixed(1)}°.`);
      say('  The lamp moved between exposures, so a real mirror cannot return six');
      say('  near-identical directions — the circle is almost certainly not on the');
      say('  sphere. Falling back to the nominal angles from capture.json. (§4.2)');
      dirs = nominal;
      sphereRead = null;
    } else {
      say(`  Using the measured directions. Widest pair ${maxPair.toFixed(1)}° — consistent`);
      say('  with a lamp that actually moved.');
    }
  } else {
    say('\n  Some readings failed; falling back to the nominal angles.');
  }
  say('');
}

// --- registration -----------------------------------------------------------

let frames = imgs.map((im) => ({ width: im.width, height: im.height, data: im.data }));

// Exclude the sphere's disc from every residual, including the one registration
// is judged by. A mirror is not Lambertian and its pixels dominate the fit: a
// clean capture reads 1.49% with the sphere left in against 0.16% with it
// excluded (§4.2), which is more than enough to hide the improvement — or the
// fault — that the before/after comparison exists to reveal.
const excl = M.sphere ? (() => {
  const cx = M.sphere.cx / scaleFactor, cy = M.sphere.cy / scaleFactor;
  const r = (M.sphere.r / scaleFactor) * 1.08;
  return (x, y) => (x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r;
})() : null;

if (!NO_REGISTER && frames.length >= 2) {
  const reg = await registerFrames(frames);
  if (reg.ok) {
    say('Frame registration\n');
    say(`  worst drift ${reg.worst.toFixed(3)}px   consistency ${reg.consistency.toFixed(3)}`
      + `   outliers ${reg.outliers}/${reg.pairs}   measured ÷${reg.reduce}`);
    reg.shifts.forEach((s, i) => {
      say(`    ${M.exposures[i].file.padEnd(24)} dx ${s.dx.toFixed(3).padStart(8)}  `
        + `dy ${s.dy.toFixed(3).padStart(8)}`);
    });
    if (!reg.reliable) {
      say('\n  Registration reports itself UNRELIABLE. An achromatic subject is the weak');
      say('  case (§7): with no colour the matcher falls back on luminance alone. The');
      say('  decisive test is the fit residual before against after, below.');
    }
    const corrected = await applyShifts(frames, reg.shifts);
    const before = cpuSolve(frames, dirs, W, H, { exclude: excl }).residual;
    const after = cpuSolve(corrected, dirs, W, H, { exclude: excl }).residual;
    say(`\n  fit residual  ${(before * 100).toFixed(2)}%  ->  ${(after * 100).toFixed(2)}%`);
    RESULT.registration = { worst: reg.worst, consistency: reg.consistency,
                            outliers: reg.outliers, pairs: reg.pairs, reduce: reg.reduce,
                            reliable: reg.reliable, residualBefore: before, residualAfter: after,
                            shifts: reg.shifts.map((s2) => ({ dx: s2.dx, dy: s2.dy })) };
    if (after <= before) {
      frames = corrected;
      say('  Registration helped; keeping the corrected frames.');
    } else {
      say('  Registration did not help; putting the frames back as shot. (§4.1)');
    }
    say('');
  } else {
    say(`Frame registration skipped: ${reg.reason}\n`);
  }
}

// --- the solve, which is the ground truth -----------------------------------

const solved = cpuSolve(frames, dirs, W, H, { exclude: excl });

RESULT.solve = { residual: solved.residual, sphereMeasured: !!sphereRead,
                 width: W, height: H, scaleFactor };
say('Photometric solve — this is the ground truth everything below is scored against\n');
say(`  fit residual  ${(solved.residual * 100).toFixed(2)}%`);
say('  ' + (solved.residual < 0.01
  ? 'Low. The Lambertian model reproduces the photographs well.'
  : solved.residual < 0.04
    ? 'Moderate. Specularity, a moved tripod, or a light angle out by some degrees.'
    : 'HIGH. Something is wrong with this capture — the model does not reproduce'
      + '\n  the photographs, so the normals below are not trustworthy.'));
if (!sphereRead) {
  say('');
  say('  CAVEAT, and it is not a small one: without a sphere reading this residual is');
  say('  blind to a uniform rotation of the whole rig. It reads an identical 0.17% at');
  say('  0° and at 40° of rig rotation while the recovered surface rots from 0.9997 to');
  say('  0.78 (§4.2). A low number here does NOT establish the geometry is right.');
}
say('');

// --- what we actually came for ----------------------------------------------

say(line());
say('\nSingle-image recovery, scored against that ground truth\n');
say('  Each row takes ONE exposure — one ordinary photograph of this painting — runs');
say('  the shipped single-image pipeline on it, and correlates the result against the');
say('  normals the six-shot solve measured. This is the number the project has never');
say('  had on real material.\n');
say('  exposure                 az     along    across   contrast');
say('  ' + line(64));

const rows = [];
for (let k = 0; k < frames.length; k++) {
  const s = scoreShot(frames[k].data, solved.N, W, H, dirs[k]);
  rows.push(s);
  const azDeg = Math.atan2(dirs[k][1], dirs[k][0]) * 180 / Math.PI;
  RESULT.exposures.push({ file: M.exposures[k].file, azimuthDeg: azDeg,
                          along: s.along, across: s.across, contrast: s.contrast });
  say(`  ${M.exposures[k].file.padEnd(22)} ${fmt(azDeg, 1).padStart(6)}   `
    + `${fmt(s.along).padStart(7)}  ${fmt(s.across).padStart(7)}   ${fmt(s.contrast).padStart(7)}`);
}
const meanAlong = rows.reduce((a, r) => a + r.along, 0) / rows.length;
const meanAcross = rows.reduce((a, r) => a + r.across, 0) / rows.length;
const meanContrast = rows.reduce((a, r) => a + r.contrast, 0) / rows.length;
RESULT.mean = { along: meanAlong, across: meanAcross, contrast: meanContrast };
say('  ' + line(64));
say(`  ${'mean'.padEnd(22)} ${''.padStart(6)}   ${fmt(meanAlong).padStart(7)}  `
  + `${fmt(meanAcross).padStart(7)}   ${fmt(meanContrast).padStart(7)}`);

say(`
Reading:

  * "along" is recovery of the slope component ALONG the light azimuth, which is
    the component one photograph actually constrains. "across" is the
    perpendicular, which is only weakly constrained: the bench measures 0.14 for a
    raking rig and 0.26 for a 45° single source, and its sign is not meaningful.
    A small or negative "across" is normal, not a fault (§3.2, §4.3). Scoring
    along the azimuth rather than along x is the correction §4.3 made.

  * For scale, the synthetic bench gets 0.77 along under a 20° raking light and
    0.67 under a 45° single source, falling to 0.09 under frontal light and 0.00
    on an archival copy-stand pair. Against achromatic grain under frontal light
    it reaches 0.03.

  * If these rows land near the bench's raking figure, the single-image path
    works on this material and the tool can take one photograph. If they land
    near 0.1, it does not, and no amount of tuning the existing algorithm will
    change that — the information is not in the photograph (§4.3).

  * Contrast is the statistic that a shot-quality gate was built on and failed:
    grain drives it UP while recovery goes DOWN, so it moves the wrong way and no
    threshold separates the cases (§4.4). It is printed to accumulate real
    evidence about whether that holds off the bench, NOT as a quality score.`);

if (!sphereRead) {
  say(`
  * NO SPHERE in this capture, so "ground truth" above means "the surface implied
    by the angles typed into capture.json". If those are uniformly out, the
    single-image scores are being compared against a rotated truth and will read
    low for a reason that has nothing to do with the single-image path.`);
}
say('');

// --- relief-scale sweep ------------------------------------------------------

if (SWEEP) {
  say(line());
  say('\nWhich spatial band carries the relief\n');
  say('  §4.3: the default relief scale of 3px was tuned against a synthetic weave with');
  say('  a clean 7px period, while real material carries texture energy from 2px to');
  say('  190px with no dominant scale. On cement the default reads grain. This sweep');
  say('  asks the ground truth which band to read instead.\n');
  const SIGMAS = [1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24];
  say('  sigma(px)  ' + M.exposures.map((_, i) => `sh${i}`.padStart(7)).join('') + '     mean');
  say('  ' + line(20 + 7 * frames.length));
  let best = { sigma: null, mean: -2 };
  for (const sig of SIGMAS) {
    const per = frames.map((f, k) => scoreShot(f.data, solved.N, W, H, dirs[k], { sigma: sig }).along);
    const mean = per.reduce((a, b) => a + b, 0) / per.length;
    if (mean > best.mean) best = { sigma: sig, mean };
    const mark = sig === HP_SIGMA ? ' <- shipped default' : '';
    say(`  ${String(sig).padStart(7)}    ` + per.map((v) => fmt(v, 3).padStart(7)).join('')
      + `   ${fmt(mean, 3).padStart(6)}${mark}`);
  }
  RESULT.sweep = { best: best.sigma, bestMean: best.mean, shippedDefault: HP_SIGMA };
  say(`\n  Best band on this material: sigma = ${best.sigma}px (mean along ${fmt(best.mean, 3)}),`);
  say(`  against ${fmt(rows.reduce((a, r) => a + r.along, 0) / rows.length, 3)} at the shipped ${HP_SIGMA}px default.`);
  say('  Measured at the reduced resolution above, so multiply by the divisor to get');
  say('  the equivalent band in original pixels.\n');
}

if (JSON_MODE) console.log(JSON.stringify(RESULT, null, 2));
await closeDecoder();
