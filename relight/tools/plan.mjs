// plan.mjs — everything about a capture that can be checked BEFORE it is shot.
//
//   node relight/tools/plan.mjs                       # the recommended rig, as a shot list
//   node relight/tools/plan.mjs --write <dir>         # write a capture.json to shoot into
//   node relight/tools/plan.mjs --check <dir>         # validate a plan, no photographs needed
//   node relight/tools/plan.mjs --sphere --frame-width=600 --image-width=4032
//
// WHY THIS EXISTS, since score-real.mjs --preflight looks like it already does the job.
//
// It does not, and the gap is a day's drive and a rebuilt rig wide. --preflight
// loads every exposure before it checks anything, so it cannot run until the shoot
// is over. README.md said "run it before you strike the lights", meaning before the
// set comes down — correct, and one word away from being read as "before you shoot",
// which was impossible.
//
// Every fault that "cannot be repaired afterwards" (HANDOFF.md §9) is geometric: a
// rank-deficient rig, an undersized sphere, azimuths bunched into one quadrant.
// None of them needs a photograph to detect. All of them need a re-shoot to fix.
// So they belong in a tool that runs while the lamp is still in its box.
//
// WHAT THIS DELIBERATELY DOES NOT DO. It does not score a rig, rank one, or predict
// recovery. HANDOFF.md §7 is six diagnostics that looked like verdicts and were not,
// and the seventh is recorded there because it was built here: buildSolver already
// computes a condition number, it is the obvious thing to rank rigs by, and against
// bench cases with known recovery it correlates with angular error at r = -0.06 —
// no signal, and the sign backwards. It is reported below as a number with its
// meaning stated, never as a grade.
//
// The recommendation is measured, not reasoned: see rigFindings() and README.md,
// "Capture protocol".

import { writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

globalThis.ImageData = class {
  constructor(w, h) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(w * h * 4); }
};
const { buildSolver } = await import(new URL('../src/photometric.js', import.meta.url));

// ---------------------------------------------------------------- arguments

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const num = (n, d) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`));
  return hit === undefined ? d : Number(hit.split('=')[1]);
};
const str = (n, d) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`));
  return hit === undefined ? d : hit.split('=').slice(1).join('=');
};
const flagValue = (n) => {
  const hit = argv.find((a) => a === `--${n}` || a.startsWith(`--${n}=`));
  if (!hit) return null;
  if (hit.includes('=')) return hit.split('=').slice(1).join('=');
  const i = argv.indexOf(hit);
  const next = argv[i + 1];
  return next && !next.startsWith('--') ? next : '';
};

const SHOTS = num('shots', 6);
const LOW = num('low', 30);
const HIGH = num('high', 60);
const d2r = Math.PI / 180;
const dirFrom = (az, el) => [Math.cos(az * d2r) * Math.cos(el * d2r),
                             Math.sin(az * d2r) * Math.cos(el * d2r),
                             Math.sin(el * d2r)];
const line = (n = 78) => '-'.repeat(n);

if (flags.has('--help') || flags.has('-h')) {
  console.log(`
plan.mjs — check a capture before you shoot it

  node relight/tools/plan.mjs                    print the recommended rig as a shot list
  node relight/tools/plan.mjs --write <dir>      write a capture.json ready to shoot into
  node relight/tools/plan.mjs --check <dir>      validate a plan's geometry, no images needed
  node relight/tools/plan.mjs --sphere ...       how big the chrome sphere has to be

  --shots=N        exposures in the rig (default ${SHOTS})
  --low=D          lower elevation, degrees (default ${LOW})
  --high=D         upper elevation, degrees (default ${HIGH})

  Sphere sizing (all lengths in mm):
  --frame-width=N    width of the scene the frame covers, i.e. the piece if it fills it
  --image-width=N    the camera's image width in pixels
  --sphere-mm=N      diameter of a sphere you already have
  --lamp-distance=N  lamp-to-piece distance, to cost out moving the sphere forward
`);
  process.exit(0);
}

// ------------------------------------------------ what the bench actually said

/**
 * The measured basis for the default rig. Numbers here are reproducible from
 * tools/validate.mjs (`rig geometry` group) and were taken on the synthetic bench
 * at grain 0.20 — the achromatic adversary of §3.2 — across four seeds.
 */
function rigFindings() {
  return [
    ['Lamp elevation, photometric solve', [
      'mean 17.5deg -> 1.27deg angular error;  27.5 -> 0.65;  37.5 -> 0.32;',
      '47.5 -> 0.25;  52.5 -> 0.28;  67.5 -> 0.46.  Best near 45-55deg.',
      'Low lamps break the Lambertian model with their own cast shadows.',
    ]],
    ['Lamp elevation, single-image path (the other job this capture does)', [
      'along-azimuth r: 20deg -> 0.668;  30 -> 0.655;  40 -> 0.628;  50 -> 0.585;',
      '60 -> 0.516;  70 -> 0.405;  80 -> 0.240.  Monotonic, and it wants the opposite.',
    ]],
    ['So the two jobs pull against each other, and the split rig serves both', [
      'alternating 30/60:  photometric 0.205deg (best measured), best single frame 0.799',
      'fixture default:    photometric 0.241deg,                 best single frame 0.769',
      'all raking 20/30:   photometric 1.16deg  <- destroys the truth it is measured against',
    ]],
    ['Do not let elevation track azimuth as you walk the lamp round', [
      'ramp 25->65 paired in azimuth order: 0.546deg.  The SAME six elevations,',
      'reassigned to different azimuths:    0.281deg.  Only the pairing changed.',
      'Alternate high/low between neighbours instead.',
    ]],
    ['Chrome-sphere reading also prefers height (independent of the above)', [
      'reading error vs lamp elevation, r=180px: 10deg -> 0.61deg;  30 -> 0.39;',
      '50 -> 0.24;  70 -> 0.11.  Near the rim the image->direction map is singular.',
    ]],
    ['What does NOT predict anything, recorded so it is not tried again', [
      'buildSolver\'s condition number against recovery error: r = -0.06 across 11 rigs.',
      'No signal, sign backwards. The best-conditioned rig tested (cond 26) scored',
      'WORSE than one at cond 340. See HANDOFF.md §7.',
    ]],
  ];
}

// ------------------------------------------------------------ the default rig

/**
 * Azimuths right round the circle; elevation alternating between two values so
 * that no elevation correlates with azimuth (finding 4 above). With an odd shot
 * count the alternation cannot close, so the last exposure takes the mean and the
 * caller is told.
 */
function buildRig(shots = SHOTS, low = LOW, high = HIGH) {
  const rig = [];
  for (let i = 0; i < shots; i++) {
    const az = Math.round((i * 360) / shots * 10) / 10;
    let el = i % 2 ? high : low;
    if (shots % 2 === 1 && i === shots - 1) el = Math.round((low + high) / 2 * 10) / 10;
    rig.push({ azimuth: az, elevation: el });
  }
  return rig;
}

/** Azimuth 0 is the 3 o'clock position; +y is up the image, so it runs anticlockwise. */
function clockOf(az) {
  const h = ((3 - az / 30) % 12 + 12) % 12;
  const hour = Math.floor(h) === 0 ? 12 : Math.floor(h);
  const mins = Math.round((h - Math.floor(h)) * 60);
  return mins ? `${hour}:${String(mins).padStart(2, '0')}` : `${hour} o'clock`;
}

function describeRig(rig) {
  console.log(`\nRecommended rig — ${rig.length} exposures\n`);
  console.log('  Azimuth 0 is the 3 o\'clock position as the camera sees it, running');
  console.log('  anticlockwise. Elevation is the lamp\'s height above the plane of the piece.\n');
  console.log('  shot   azimuth   elevation   lamp goes');
  console.log('  ' + line(58));
  rig.forEach((e, i) => {
    console.log(`  ${String(i + 1).padStart(4)}   ${String(e.azimuth + '°').padStart(7)}`
      + `   ${String(e.elevation + '°').padStart(9)}   ${clockOf(e.azimuth)}`
      + `, ${e.elevation >= (LOW + HIGH) / 2 ? 'high' : 'low'}`);
  });
}

// ------------------------------------------------------- geometry-only checks

/**
 * Every check here runs on the manifest alone. It is deliberately the same set
 * score-real.mjs's preflight applies to the geometry, and it calls the same
 * buildSolver, for the reason tools/recover.js is shared: a second copy of the
 * rank test would drift from the one that actually gates the solve.
 */
function checkPlan(M) {
  const problems = [], warnings = [], notes = [];
  const exposures = M.exposures || [];
  const n = exposures.length;

  for (const [i, e] of exposures.entries()) {
    if (typeof e.azimuth !== 'number' || typeof e.elevation !== 'number') {
      problems.push(`exposure ${i}${e.file ? ` (${e.file})` : ''} needs numeric `
        + '"azimuth" and "elevation" in degrees.');
    }
  }
  if (problems.length) return { problems, warnings, notes };

  const unknowns = 4; // three for the normal, one for ambient
  if (n < unknowns) {
    problems.push(`${n} exposures cannot solve for ${unknowns} unknowns.`);
  } else if (n === unknowns) {
    warnings.push(`${n} exposures is exactly determined — the fit residual will read `
      + '0.00% whatever is wrong with the capture, and means nothing (§5). Six is the default.');
  } else {
    notes.push(`${n} exposures, ${n - unknowns} spare — the fit residual carries information.`);
  }

  const dirs = exposures.map((e) => dirFrom(e.azimuth, e.elevation));
  const solver = buildSolver(dirs, { fitAmbient: true });
  if (!solver.ok) problems.push(`the rig will not solve: ${solver.reason}`);

  const elevs = exposures.map((e) => e.elevation);
  const spread = Math.max(...elevs) - Math.min(...elevs);
  if (spread < 10) {
    problems.push(`light elevation varies by only ${spread.toFixed(1)}° across the capture. `
      + 'Constant elevation makes the ambient term unrecoverable. Aim for 30°.');
  } else if (spread < 20) {
    warnings.push(`elevation spread ${spread.toFixed(1)}° — solvable, but the bench improves `
      + 'from 0.31° angular error at 10° of spread to 0.21° at 30°.');
  } else {
    notes.push(`elevation spread ${spread.toFixed(1)}° — enough to fit ambient comfortably.`);
  }

  const meanEl = elevs.reduce((a, b) => a + b, 0) / n;
  if (meanEl < 30) {
    warnings.push(`mean lamp elevation ${meanEl.toFixed(1)}° is low. Measured on the bench, a `
      + 'rig averaging 17.5° recovers normals at 1.27° angular error against 0.25° at 47.5° — '
      + 'low lamps cast their own shadows and the Lambertian model does not describe them. '
      + 'Raking light helps the SINGLE-IMAGE path, not this one.');
  } else if (meanEl > 62) {
    warnings.push(`mean lamp elevation ${meanEl.toFixed(1)}° is high. The photometric solve is `
      + 'happy, but each frame is also a single-image test case, and that path decays from '
      + 'r = 0.655 at 30° to 0.405 at 70°. Keep some exposures low.');
  } else {
    notes.push(`mean lamp elevation ${meanEl.toFixed(1)}° — inside the 30-60° band that serves `
      + 'the photometric solve and the single-image scoring at once.');
  }

  // Elevation must not track azimuth: the same six elevations re-paired to
  // different azimuths recover at 0.281° against 0.546°.
  //
  // CALIBRATION, because §7 is a graveyard of thresholds that did not separate the
  // cases they claimed to. All 720 pairings of six fixed elevations were generated
  // and 41 sampled across the tracking range, each solved against known normals:
  // correlation against angular error is r = 0.646, positive, so unlike the
  // condition number this statistic carries real signal. It is not clean, though.
  // At a 0.70 cut the two classes overlap by 0.137° — cases at 0.72 score anywhere
  // from 0.312° to 0.573°. The threshold is set at 0.85, which is where the sampled
  // classes separate with no overlap at all: below it mean 0.358° / worst 0.704°,
  // above it mean 1.057° / best 0.837°. Between 0.6 and 0.85 the effect is real on
  // average and unreliable case by case, so nothing is said. A rig that alternates
  // reads 0.00 and never comes near this.
  if (n >= 4) {
    const cx = dirs.map((d, i) => Math.cos(exposures[i].azimuth * d2r));
    const cy = dirs.map((d, i) => Math.sin(exposures[i].azimuth * d2r));
    const pear = (a, b) => {
      const ma = a.reduce((s, v) => s + v, 0) / a.length;
      const mb = b.reduce((s, v) => s + v, 0) / b.length;
      let p = 0, da = 0, db = 0;
      for (let i = 0; i < a.length; i++) {
        const u = a[i] - ma, v = b[i] - mb; p += u * v; da += u * u; db += v * v;
      }
      return da && db ? p / Math.sqrt(da * db) : 0;
    };
    const track = Math.max(Math.abs(pear(cx, elevs)), Math.abs(pear(cy, elevs)));
    if (track > 0.85) {
      warnings.push(`the lamp's height tracks its azimuth (correlation ${track.toFixed(2)}). `
        + 'Every sampled rig past 0.85 recovered worse than every rig below it — mean 1.06° '
        + 'angular error against 0.36°, on the same six elevations merely re-paired. '
        + 'Alternate high and low between neighbouring positions instead of raising the '
        + 'lamp as you walk round the piece.');
    } else if (track > 0.6) {
      notes.push(`elevation partly tracks azimuth (correlation ${track.toFixed(2)}). Measured, `
        + 'that is mildly harmful on average and unreliable case by case, so it is reported '
        + 'rather than warned about. Alternating neighbours would read 0.00.');
    } else {
      notes.push(`elevation does not track azimuth (correlation ${track.toFixed(2)}) — the two `
        + 'are independent, as they must be.');
    }
  }

  const biggestGap = (() => {
    const a = exposures.map((e) => ((e.azimuth % 360) + 360) % 360).sort((x, y) => x - y);
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

  if (!M.sphere) {
    warnings.push('no "sphere" in the plan. Without one the light directions are whatever '
      + 'gets typed in, and a rig uniformly rotated by 40° reproduces every photograph at an '
      + 'identical 0.17% fit residual while handing back a surface rotated off the painting '
      + '(§5). Nothing computed from the exposures can detect it. Put a sphere in the frame.');
  } else if (typeof M.sphere.r === 'number') {
    const r = M.sphere.r;
    // --write emits {0,0,0} on purpose: a placeholder that is obviously wrong beats
    // a plausible guess, and it is the one field that can only be filled in from a
    // frame that does not exist yet. Say that, rather than dividing by it.
    if (!(r > 0)) {
      notes.push('the sphere is still a placeholder (r = 0). Measure the circle in the '
        + 'uncropped frame after the shoot and write {cx, cy, r} in pixels, y down. '
        + 'Size the ball itself now, though — that part cannot wait: run --sphere.');
    } else if (r < 60) {
      warnings.push(`planned sphere radius ${r}px — 3px of hand placement costs about `
        + `${(9.63 * 40 / r).toFixed(1)}°, the same order as simply recalling the angle.`);
    } else if (r < 300) {
      warnings.push(`planned sphere radius ${r}px — usable, below the 300px the protocol asks `
        + `for. 3px of placement error is about ${(9.63 * 40 / r).toFixed(2)}° here. `
        + 'Run --sphere to size it before you shoot; afterwards it cannot be fixed.');
    } else {
      notes.push(`planned sphere radius ${r}px — 3px of placement error costs about `
        + `${(9.63 * 40 / r).toFixed(2)}°.`);
    }
  }

  if (solver.ok) {
    notes.push(`solver condition number ${solver.cond.toFixed(1)}, dof ${solver.dof}. `
      + 'The condition number is reported because it is cheap, NOT as a quality score: '
      + 'against known recovery it correlates at r = -0.06 (§7). Only its refusal means anything.');
  }
  return { problems, warnings, notes };
}

function report(res) {
  console.log('');
  for (const s of res.notes) console.log(`  ok    ${s}`);
  for (const s of res.warnings) console.log(`  WARN  ${s}`);
  for (const s of res.problems) console.log(`  FAIL  ${s}`);
  console.log('');
  return res.problems.length === 0;
}

// -------------------------------------------------------------- sphere sizing

/**
 * How big does the chrome sphere have to be?
 *
 * §5 makes the sphere's radius in pixels load-bearing: direction error scales as
 * circle-error / radius, so 3px of hand placement costs 9.63° at r=40 and 1.60° at
 * r=300. That is a purchasing decision, and it has to be made before the shoot.
 *
 * If the sphere sits in the plane of the piece and the piece fills the frame, no
 * lens data is needed — it is one proportion:
 *
 *     radius_px / image_width_px = (diameter_mm / 2) / frame_width_mm
 */
function sphereSizing() {
  const frameW = num('frame-width', NaN);
  const imageW = num('image-width', NaN);
  const haveMm = num('sphere-mm', NaN);
  const lampD = num('lamp-distance', NaN);

  console.log('\nChrome sphere sizing\n');
  if (!Number.isFinite(frameW) || !Number.isFinite(imageW)) {
    console.log('  Needs --frame-width=<mm> and --image-width=<px>.\n');
    console.log('  frame-width is the width of the scene the camera actually covers —');
    console.log('  if the piece fills the frame, that is the width of the piece.');
    console.log('  image-width is the camera\'s pixel width (a 12MP 4:3 phone frame is 4032).\n');
    console.log('  Example:  --sphere --frame-width=600 --image-width=4032 --sphere-mm=50\n');
    return;
  }
  const pxPerMm = imageW / frameW;
  console.log(`  ${imageW}px across ${frameW}mm of scene = ${pxPerMm.toFixed(2)} px/mm\n`);
  console.log('  target r     sphere diameter needed (in the plane of the piece)');
  console.log('  ' + line(58));
  for (const target of [300, 200, 150, 100, 60]) {
    const dia = 2 * target / pxPerMm;
    const note = target === 300 ? '  <- what the protocol asks for'
      : (target === 60 ? '  <- below this it buys little over typing the angle in' : '');
    console.log(`  ${String(target + 'px').padStart(8)}     ${dia.toFixed(0).padStart(5)} mm`
      + `   (3px of placement error = ${(9.63 * 40 / target).toFixed(2)}°)${note}`);
  }

  if (Number.isFinite(haveMm)) {
    const r = pxPerMm * haveMm / 2;
    console.log(`\n  A ${haveMm}mm sphere in that plane reads r = ${r.toFixed(0)}px`
      + `, so 3px of placement error costs ${(9.63 * 40 / r).toFixed(2)}°.`);
    if (r < 300) {
      const closer = 300 / r;
      // The sphere does not have to sit in the plane of the piece. Moving it
      // toward the camera makes it bigger in pixels, which is exactly what §5
      // asks for — but the lamp direction AT THE SPHERE is then not the lamp
      // direction at the piece, and that error goes straight into every solved
      // normal. Both halves are geometry, so both can be stated as numbers.
      //
      // Camera distance is needed to say how far "toward the camera" is. Without
      // a focal length it is estimated from a typical phone's ~70° horizontal
      // field, C = frameW / (2 tan 35°); --camera-distance overrides it.
      const camGuess = frameW / (2 * Math.tan(35 * Math.PI / 180));
      const cam = num('camera-distance', camGuess);
      const estimated = !Number.isFinite(num('camera-distance', NaN));
      const forward = cam * (1 - 1 / closer);
      console.log(`  To reach 300px it must sit ${closer.toFixed(2)}x nearer the camera than`);
      console.log(`  the piece: about ${forward.toFixed(0)}mm forward, with the camera`);
      console.log(`  ${cam.toFixed(0)}mm away${estimated ? ' (estimated from a ~70° field; pass --camera-distance)' : ''}.`);
      if (Number.isFinite(lampD)) {
        console.log('');
        console.log('  What that costs, per lamp elevation — the angle between the lamp');
        console.log(`  direction at the sphere and at the piece, with the lamp ${lampD}mm out:`);
        console.log('');
        console.log('    elevation   direction error');
        console.log('    ' + line(34));
        for (const el of [30, 45, 60]) {
          // Displacement is along the camera axis; the component perpendicular to
          // the lamp direction is forward*cos(elevation). Small-angle, so atan.
          const err = Math.atan2(forward * Math.cos(el * d2r), lampD) * 180 / Math.PI;
          console.log(`    ${String(el + '°').padStart(9)}   ${err.toFixed(2)}°`
            + (err > 1.5 ? '   <- worse than the placement error it was meant to fix' : ''));
        }
        console.log('');
        console.log('  A sphere moved forward wants a lamp that is far away. If that error');
        console.log('  beats the placement error above, the bigger sphere is the wrong trade.');
      } else {
        console.log('  Pass --lamp-distance=<mm> to see what that parallax costs.');
      }
    }
  }
  console.log('');
  console.log('  Whatever the size: record {cx, cy, r} in pixels of the UNCROPPED frame,');
  console.log('  y measured down, and take the reading before cropping the sphere out.\n');
}

// --------------------------------------------------------------------- modes

const CHECK = flagValue('check');
const WRITE = flagValue('write');

if (flags.has('--sphere')) {
  sphereSizing();
  process.exit(0);
}

if (CHECK !== null) {
  if (!CHECK) { console.error('--check needs a directory containing capture.json'); process.exit(2); }
  const p = join(resolve(CHECK), 'capture.json');
  if (!existsSync(p)) {
    console.error(`No capture.json in ${resolve(CHECK)}\nSee README.md, "Capture bundles".`);
    process.exit(2);
  }
  let M;
  try { M = JSON.parse(readFileSync(p, 'utf8')); }
  catch (e) { console.error(`capture.json is not valid JSON: ${e.message}`); process.exit(2); }
  if (!Array.isArray(M.exposures) || !M.exposures.length) {
    console.error('capture.json has no "exposures" array.'); process.exit(2);
  }
  console.log(`\nPlan check: ${M.painting || '(unnamed)'}`);
  console.log(`Source:     ${resolve(CHECK)}`);
  console.log(`            ${M.exposures.length} exposures planned`);
  const present = M.exposures.filter((e) => e.file && existsSync(join(resolve(CHECK), e.file))).length;
  console.log(`            ${present} of ${M.exposures.length} exposure files on disk`
    + (present === 0 ? '  (a plan, not yet a capture — which is the point)' : ''));
  const ok = report(checkPlan(M));
  if (!ok) {
    console.log(line());
    console.log('This rig will not produce a trustworthy surface. Fix it before the shoot —');
    console.log('every fault above needs the lamp moved, not the file edited.\n');
    process.exit(1);
  }
  console.log('The geometry is sound. What this CANNOT check is anything in the photographs:');
  console.log('framing drift, focus, exposure, whether the circle is really on the sphere.');
  console.log('Run score-real.mjs --preflight once the frames exist, before striking the set.\n');
  process.exit(0);
}

if (WRITE !== null) {
  if (!WRITE) { console.error('--write needs a directory'); process.exit(2); }
  const dir = resolve(WRITE);
  const p = join(dir, 'capture.json');
  if (existsSync(p) && !flags.has('--force')) {
    console.error(`${p} already exists. Pass --force to overwrite.`);
    process.exit(2);
  }
  const rig = buildRig();
  const manifest = {
    painting: str('painting', 'untitled'),
    material: str('material', 'cast cement and plaster'),
    shot: new Date().toISOString().slice(0, 10),
    notes: str('notes', 'one lamp moved between exposures; room light off; '
      + 'elevation alternating so that height does not track azimuth'),
    exposures: rig.map((e, i) => ({
      file: `shot-${String(i + 1).padStart(2, '0')}.png`,
      azimuth: e.azimuth,
      elevation: e.elevation,
    })),
    sphere: { cx: 0, cy: 0, r: 0 },
  };
  mkdirSync(dir, { recursive: true });
  writeFileSync(p, JSON.stringify(manifest, null, 2) + '\n');
  describeRig(rig);
  console.log(`\nWrote ${p}\n`);
  console.log('  Shoot into this directory using the file names above, then fill in');
  console.log('  "sphere" with the circle in pixels of the uncropped frame. The zeros are');
  console.log('  deliberate: they are wrong, and a wrong sphere is caught, where a missing');
  console.log('  one is silently tolerated.\n');
  console.log('  Then:  node relight/tools/plan.mjs --check ' + WRITE);
  console.log('         node relight/tools/score-real.mjs ' + WRITE + ' --preflight\n');
  process.exit(0);
}

// Default: print the rig, the findings behind it, and the checklist.
const rig = buildRig();
describeRig(rig);
if (SHOTS % 2 === 1) {
  console.log(`\n  NOTE: ${SHOTS} is odd, so the alternation cannot close evenly; the last`);
  console.log('  exposure takes the mean elevation. An even count is preferred.');
}

console.log('\n\nWhy this rig — measured, not reasoned\n');
for (const [title, lines] of rigFindings()) {
  console.log(`  ${title}`);
  for (const l of lines) console.log(`    ${l}`);
  console.log('');
}

const plan = { exposures: rig, sphere: null };
console.log(line());
console.log('Checking that rig with the same code that gates the solve:');
report(checkPlan(plan));

console.log(line());
console.log(`
On the day

  1. Camera on a tripod. Fixed focus, fixed white balance, fixed exposure, in
     manual. Nothing about the camera changes between the six frames.
  2. Chrome sphere in the frame, as big as you can get it, fully inside the edges.
     Run --sphere to size it. Take the reading before cropping.
  3. Room light off. What you cannot kill is fitted, which is what the elevation
     spread above is for.
  4. One lamp. Move it to each of the six positions in turn. Nothing else moves —
     not the camera, not the piece, not the sphere, not anything resting on it.
  5. Shoot lossless if you can. HEIC cannot be decoded here: set the phone to
     Settings > Camera > Formats > Most Compatible, or convert with
     sips -s format png in.HEIC --out out.png
  6. Before the set comes down, run score-real.mjs --preflight. It reads the
     actual frames and catches what a plan cannot: reframing, an undersized or
     clipped sphere, a circle that is not on the sphere.

  A re-shoot is cheap while the rig is standing and impossible once it is not.
`);
