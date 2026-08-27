// selftest-real.mjs — end-to-end regression test for the real-capture harness.
//
//   node relight/tools/selftest-real.mjs
//
// tools/validate.mjs scores the *maths* against a known surface. This scores the
// *plumbing*: writing a capture to disk, decoding it back, registering it, reading
// a sphere off it, solving, and scoring the single-image path against the result.
// None of that is exercised by validate.mjs, which hands arrays straight to the
// algorithms, and all of it sits between a real photograph and a number.
//
// The assertions are deliberately about behaviour that has already cost this
// project a wrong answer once:
//
//   * a rank-deficient rig must be REFUSED, not solved into something plausible
//   * registration must be judged on a residual with the sphere's disc excluded,
//     because a mirror's pixels otherwise swamp the very fault it is checking for
//   * achromatic grain must leave the photometric path alone while it degrades the
//     single-image one, and the high-pass contrast statistic must move the WRONG
//     WAY while that happens — the reason no shot-quality gate is shipped
//
// That last one is the important one. It is the finding a future session is most
// likely to un-learn by rebuilding the gate, so it is pinned here as a test.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'relight-selftest-'));

let failures = 0, checks = 0;
const check = (name, ok, detail) => {
  checks++;
  if (ok) { console.log(`  pass  ${name}`); return; }
  failures++;
  console.log(`  FAIL  ${name}${detail ? `\n          ${detail}` : ''}`);
};
const near = (v, lo, hi) => Number.isFinite(v) && v >= lo && v <= hi;

const fixture = (name, args) => {
  const out = join(root, name);
  execFileSync(process.execPath, [join(HERE, 'fixture.mjs'), out, ...args], { stdio: 'pipe' });
  return out;
};
const score = (dir, args = []) => {
  const out = execFileSync(process.execPath,
    [join(HERE, 'score-real.mjs'), dir, '--json', ...args], { stdio: 'pipe', encoding: 'utf8' });
  return JSON.parse(out);
};

console.log('\nEnd-to-end: capture bundle on disk -> scored surface\n');

try {
  // --- 1. a clean, sound capture ------------------------------------------
  console.log('A clean six-exposure capture with a sphere\n');
  const clean = fixture('clean', ['--sphere']);
  const c = score(clean);

  check('preflight passes', c.preflight.ok, JSON.stringify(c.preflight.problems));
  check('sphere read to better than 1 degree',
    Math.max(...c.sphere.map((s) => s.deltaDeg)) < 1.0,
    `worst ${Math.max(...c.sphere.map((s) => s.deltaDeg)).toFixed(3)} deg`);
  check('sphere directions are actually used', c.solve.sphereMeasured === true);
  check('fit residual is low (<1%)', c.solve.residual < 0.01,
    `${(c.solve.residual * 100).toFixed(2)}%`);
  // The sphere's disc must be excluded from the residual that registration is
  // judged by. With the mirror left in, a clean capture reads ~3.7% instead of
  // ~0.17% — enough to hide a real fault behind the diagnostic meant to reveal it
  // (finding 7). Both ends of the before/after comparison must therefore sit on
  // the solve's scale, and the solve must adopt whichever of them won.
  check('registration is judged on the sphere-excluded residual',
    c.registration.residualBefore < 0.01 && c.registration.residualAfter < 0.01,
    `before ${(c.registration.residualBefore * 100).toFixed(2)}%, `
    + `after ${(c.registration.residualAfter * 100).toFixed(2)}% — `
    + 'one of these looks like the sphere was left in the fit');
  check('the solve keeps whichever set of frames scored better',
    Math.abs(Math.min(c.registration.residualBefore, c.registration.residualAfter)
      - c.solve.residual) < 1e-9,
    `min(before, after) = ${Math.min(c.registration.residualBefore, c.registration.residualAfter).toFixed(6)}, `
    + `solve = ${c.solve.residual.toFixed(6)}`);
  check('single-image recovery is in the expected band on the bench surface',
    near(c.mean.along, 0.50, 0.75), `mean along ${c.mean.along.toFixed(4)}`);
  check('every exposure scored', c.exposures.length === 6);

  // --- 2. a rig that cannot be solved -------------------------------------
  console.log('\nA rig at constant elevation — must refuse, not approximate\n');
  const flat = fixture('flat', ['--sphere', '--flat']);
  let refused = false, msg = '';
  try {
    score(flat);
  } catch (e) {
    refused = e.status === 1;
    msg = String(e.stdout || '');
  }
  check('exits non-zero rather than returning a surface', refused);
  const parsed = (() => { try { return JSON.parse(msg); } catch { return null; } })();
  check('reports the rank deficiency by name',
    !!parsed && parsed.preflight.problems.some((p) => /collinear|elevation/i.test(p)),
    parsed ? JSON.stringify(parsed.preflight.problems) : 'no JSON emitted');

  // --- 3. a drifted frame --------------------------------------------------
  console.log('\nOne exposure knocked 2.4/-1.3px out of line\n');
  const drift = fixture('drift', ['--sphere', '--drift']);
  const d = score(drift);
  check('registration improves the fit',
    d.registration.residualAfter < d.registration.residualBefore,
    `${(d.registration.residualBefore * 100).toFixed(2)}% -> ${(d.registration.residualAfter * 100).toFixed(2)}%`);
  const s2 = d.registration.shifts[2];
  check('the drifted frame is located to better than 0.2px',
    Math.hypot(s2.dx + 2.4, s2.dy - 1.3) < 0.2,
    `estimated ${s2.dx.toFixed(3)}/${s2.dy.toFixed(3)}, expected -2.400/1.300`);
  check('the undisturbed frames are left alone',
    d.registration.shifts.filter((_, i) => i !== 2).every((s) => Math.hypot(s.dx, s.dy) < 0.1));

  // --- 4. achromatic grain, and the statistic that moves the wrong way -----
  console.log('\nAchromatic grain — the adversary the synthetic bench did not have\n');
  const grain = fixture('grain', ['--sphere', '--grain=0.35']);
  const g = score(grain);

  check('photometric stereo is essentially unaffected by grain',
    Math.abs(g.solve.residual - c.solve.residual) < 0.005,
    `clean ${(c.solve.residual * 100).toFixed(2)}%, grainy ${(g.solve.residual * 100).toFixed(2)}%`);
  check('single-image recovery degrades under grain',
    g.mean.along < c.mean.along - 0.05,
    `clean ${c.mean.along.toFixed(4)} -> grainy ${g.mean.along.toFixed(4)}`);
  // The one to keep. A shot-quality gate on this statistic was built, measured,
  // and deleted: it rises while the thing it is meant to measure falls, so no
  // threshold on it separates a good capture from a bad one (finding 10).
  check('high-pass contrast moves the WRONG WAY (rises as recovery falls)',
    g.mean.contrast > c.mean.contrast && g.mean.along < c.mean.along,
    `contrast ${c.mean.contrast.toFixed(4)} -> ${g.mean.contrast.toFixed(4)}, `
    + `recovery ${c.mean.along.toFixed(4)} -> ${g.mean.along.toFixed(4)}`);

  // --- 5. no sphere --------------------------------------------------------
  console.log('\nA capture with no chrome sphere\n');
  const nos = fixture('nosphere', []);
  const n = score(nos);
  check('still solves', n.solve.residual < 0.02);
  check('records that the geometry is unverified', n.solve.sphereMeasured === false);
  check('warns that the rig is unverifiable',
    n.preflight.warnings.some((w) => /SPHERE/i.test(w)));

  // --- 6. the sweep recovers the bench's own band --------------------------
  console.log('\nRelief-scale sweep against a surface whose band is known\n');
  const sw = score(clean, ['--sweep']);
  check('sweep returns the shipped default on the surface it was tuned for',
    sw.sweep.best === sw.sweep.shippedDefault,
    `best ${sw.sweep.best}px, shipped default ${sw.sweep.shippedDefault}px`);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log(`\n${checks - failures}/${checks} checks passed\n`);
process.exit(failures ? 1 : 0);
