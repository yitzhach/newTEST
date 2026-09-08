/* ==========================================================================
   Browser tests for saved rankings — "Lisa's list".

   Two things are under test here and they are not equally interesting.

   The first is that a named ranking reorders the catalogue, which is the
   feature. The second is that a ranking file somebody ELSE wrote cannot do
   anything except be a ranking — wrong factor list, wrong length, wrong
   format, junk, all refused with a message rather than applied. Weights are
   positional, so a file that quietly mismatches would produce a ranking that
   looks plausible and is wrong, which is worse than one that fails.

   Usage:
     python3 -m http.server 8765     # from the repo root
     node build/ranker-tests.cjs
   ========================================================================== */
const { chromium } = require('playwright');

const EXECUTABLE = process.env.PW_CHROMIUM ||
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = 'http://127.0.0.1:8765/tracker/browse.html';
let pass = 0; const fails = [];
const check = (n, ok, d) => { if (ok) { pass++; console.log('  PASS  ' + n); }
  else { fails.push(n + (d ? ' — ' + d : '')); console.log('  FAIL  ' + n + (d ? '  — ' + d : '')); } };

(async () => {
  const b = await chromium.launch(
    require('fs').existsSync(EXECUTABLE) ? { executablePath: EXECUTABLE } : {});
  const p = await b.newPage({ viewport: { width: 1480, height: 1000 } });
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => { if (m.type()==='error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
  p.on('requestfailed', r => {
    if (!/fonts\.|favicon|cdnjs|open-meteo/.test(r.url())) errs.push('reqfail ' + r.url());
  });

  await p.goto(BASE, { waitUntil: 'networkidle' });
  await p.waitForTimeout(600);

  // ---- the record and its defaults ---------------------------------------
  console.log('\n-- the record --');
  const rec = await p.evaluate(() => window.AST.makeRanker({ name: '  Lisa’s list  ' }));
  check('a new ranking trims its name', rec.name === 'Lisa’s list', rec.name);
  /* Artists guard their show lists. Sharing is opt-in, and there is exactly
     one safe default. */
  check('a new ranking is NOT shared', rec.shared === false, String(rec.shared));
  check('a new ranking is marked as the artist’s own', rec.origin === 'mine', rec.origin);
  check('weights start null, meaning "follow the presets"', rec.weights === null,
        JSON.stringify(rec.weights));

  const mig = await p.evaluate(() => {
    const A = window.AST;
    const up = A.migrate({ schemaVersion: 5, shows: [], events: [], applications: [] });
    return { v: up.schemaVersion, current: A.SCHEMA_VERSION, rankers: up.rankers };
  });
  check('a v5 database migrates to the current schema',
        mig.v === mig.current, String(mig.v));
  /* An artist who has not built a ranking is not handed somebody else's idea
     of a good show. */
  check('and is seeded with NO rankings at all',
        Array.isArray(mig.rankers) && mig.rankers.length === 0, JSON.stringify(mig.rankers));

  // ---- weights, and what they mean ---------------------------------------
  console.log('\n-- weights --');
  const w = await p.evaluate(() => {
    const R = window.ASTRanker, F = window.ASTFit;
    const preset = R.editableWeights({ discipline: 'painting', priceBand: '2000_10000', strategy: 'balanced' });
    const custom = new Array(F.FACTORS.length).fill(5);
    custom[F.FACTOR_KEYS.indexOf('costEfficiency')] = 10;
    custom[F.FACTOR_KEYS.indexOf('prestige')] = 0;
    return {
      presetLen: preset.length, factors: F.FACTORS.length,
      clampHigh: R.clampWeight(999), clampLow: R.clampWeight(-4), clampJunk: R.clampWeight('abc'),
      explain: R.explain({ weights: custom, discipline:'painting', priceBand:'2000_10000', strategy:'balanced' }),
      profile: R.toProfile({ weights: custom }),
      presetProfile: R.toProfile({ weights: null })
    };
  });
  check('an unedited ranking offers one weight per factor',
        w.presetLen === w.factors, w.presetLen + ' of ' + w.factors);
  check('weights clamp to the 0-10 range',
        w.clampHigh === 10 && w.clampLow === 0 && w.clampJunk === 0,
        [w.clampHigh, w.clampLow, w.clampJunk].join(','));
  check('it can say which factors were weighted up',
        w.explain.up.some(f => f.key === 'costEfficiency'), JSON.stringify(w.explain.up));
  check('and which were weighted down',
        w.explain.down.some(f => f.key === 'prestige'), JSON.stringify(w.explain.down));
  check('custom weights reach the fit profile',
        Array.isArray(w.profile.customWeights) && w.profile.customWeights.length === w.factors);
  /* Null must stay null. Freezing today's preset numbers into the record
     would quietly detach the ranking from later model changes. */
  check('"follow the presets" stays null rather than a frozen copy',
        w.presetProfile.customWeights === null, JSON.stringify(w.presetProfile.customWeights));

  // ---- a zeroed factor drops out, it does not score 5 ---------------------
  const zeroed = await p.evaluate(() => {
    const F = window.ASTFit;
    const show = { id:'t', factors:{}, confidence:'Low' };
    F.FACTOR_KEYS.forEach((k, i) => { show.factors[k] = (i === 0 ? 10 : 2); });
    const only = new Array(F.FACTORS.length).fill(0); only[0] = 10;
    return F.scoreShow(show, { customWeights: only }).fit;
  });
  check('a factor weighted to zero leaves the average entirely',
        zeroed === 10, String(zeroed));

  // ---- sharing: export, and importing what somebody else wrote ------------
  console.log('\n-- export and import --');
  const payload = await p.evaluate(() => {
    const R = window.ASTRanker, F = window.ASTFit;
    return R.toPayload({
      name:'Lisa’s list', ownerName:'Lisa Baldwin', discipline:'painting',
      priceBand:'2000_10000', strategy:'balanced',
      weights: new Array(F.FACTORS.length).fill(6), notes:'Cost matters most.'
    });
  });
  check('an export names its format and version',
        payload.format === 'art-show-tracker/ranking' && payload.version === 1,
        payload.format + ' v' + payload.version);
  check('it records which factors the weights were written against',
        Array.isArray(payload.ranking.factors) && payload.ranking.factors.length === 10);
  /* A ranking says what somebody values. It must not say where they will be
     standing in June. */
  const leak = JSON.stringify(payload).toLowerCase();
  check('the payload carries NO shows, calendar, applications or fees',
        !/"shows"|"events"|"applications"|"juryfee"|"boothfee"|"startdate"/.test(leak));

  const imported = await p.evaluate((pl) => {
    const R = window.ASTRanker;
    const F = window.ASTFit;
    const bad = k => { const c = JSON.parse(JSON.stringify(pl)); k(c); return R.fromPayload(c); };
    return {
      good: R.fromPayload(pl),
      junk: R.fromPayload('not json at all'),
      empty: R.fromPayload({}),
      wrongKind: bad(c => { c.format = 'something/else'; }),
      wrongVersion: bad(c => { c.version = 99; }),
      wrongFactors: bad(c => { c.ranking.factors = c.ranking.factors.slice().reverse(); }),
      wrongLength: bad(c => { c.ranking.weights = [1, 2, 3]; }),
      overRange: bad(c => { c.ranking.weights = new Array(F.FACTORS.length).fill(9999); })
    };
  }, payload);

  check('a valid ranking imports', imported.good.ok === true, JSON.stringify(imported.good.error));
  check('an imported ranking is marked imported, not yours',
        imported.good.ranking.origin === 'imported', imported.good.ranking.origin);
  check('and it does NOT arrive pre-shared',
        imported.good.ranking.shared === false, String(imported.good.ranking.shared));
  check('it remembers whose list it was',
        imported.good.ranking.sourceName === 'Lisa Baldwin', imported.good.ranking.sourceName);

  check('junk is refused with a message, not a crash',
        imported.junk.ok === false && !!imported.junk.error, JSON.stringify(imported.junk));
  check('a file that is not a ranking is refused', imported.empty.ok === false);
  check('a foreign format is refused', imported.wrongKind.ok === false);
  check('a future format version is refused rather than guessed at',
        imported.wrongVersion.ok === false, JSON.stringify(imported.wrongVersion.error));
  /* The important one. Weights are positional: applying them against a
     different factor order produces a plausible, wrong ranking. */
  check('a ranking built against different factors is REFUSED',
        imported.wrongFactors.ok === false, JSON.stringify(imported.wrongFactors.error));
  check('a wrong number of weights is refused', imported.wrongLength.ok === false);
  check('out-of-range weights are clamped, not trusted',
        imported.overRange.ok === true &&
        imported.overRange.ranking.weights.every(v => v === 10),
        JSON.stringify(imported.overRange.ranking && imported.overRange.ranking.weights));

  // ---- the ranking actually reorders the catalogue ------------------------
  console.log('\n-- it changes the order --');
  const reorder = await p.evaluate(async () => {
    const S = window.AST.Store, F = window.ASTFit;
    const before = [...document.querySelectorAll('#cards [data-id]')].slice(0, 8).map(el => el.dataset.id);
    /* Rank on cost efficiency alone — a deliberately lopsided list, which is
       exactly what a saved ranking is allowed to be. */
    const only = new Array(F.FACTORS.length).fill(0);
    only[F.FACTOR_KEYS.indexOf('costEfficiency')] = 10;
    const rk = await S.upsertRanker({ name: 'Cheap shows only', weights: only });
    return { before, id: rk.id };
  });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(700);
  const applied = await p.evaluate(async (id) => {
    const sel = document.getElementById('rkPick');
    sel.value = id;
    sel.dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 500));
    return {
      options: [...sel.options].map(o => o.text),
      after: [...document.querySelectorAll('#cards [data-id]')].slice(0, 8).map(el => el.dataset.id),
      note: document.getElementById('rkNote').textContent
    };
  }, reorder.id);

  check('the saved ranking appears in the picker',
        applied.options.some(t => /Cheap shows only/.test(t)), applied.options.join(' | '));
  check('choosing it reorders the catalogue',
        applied.after.join(',') !== reorder.before.join(','),
        reorder.before.slice(0,3) + '  ->  ' + applied.after.slice(0,3));
  check('and the page says what the ranking is doing',
        /Weighted (up|down)|presets/i.test(applied.note), applied.note);

  // ---- the share control tells the truth ---------------------------------
  const share = await p.evaluate(() => {
    const el = document.getElementById('rkShare');
    return { disabled: el.disabled, title: el.title };
  });
  /* A control that does nothing must look like it does nothing. */
  check('"Share to network" is visibly disabled, because there is no transport',
        share.disabled === true, String(share.disabled));
  check('and it says why, and what does work today',
        /not deployed/i.test(share.title) && /export/i.test(share.title), share.title);

  console.log('\nerrors: ' + (errs.length ? errs.join(' | ') : 'none'));
  await b.close();
  console.log('\n' + pass + '/' + (pass + fails.length) + ' checks passed');
  if (fails.length) { console.log('FAILED:'); fails.forEach(f => console.log('  - ' + f)); process.exit(1); }
})();
