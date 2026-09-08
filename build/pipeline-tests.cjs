/* ==========================================================================
   Browser tests for the application pipeline — ideas 11, 12 and 14.

   Kept separate from the other suites for the reason build/ledger-view-tests
   gives: this one WRITES RECORDS and asserts on what the arithmetic makes of
   them afterwards. Most of what follows is not testing that a number is
   right — it is testing that a number the app cannot honestly know stays
   absent. Those are the checks that matter here, because the failure mode of
   an application tracker is a confident total built on half the fees.

   Usage:
     python3 -m http.server 8765     # from the repo root
     node build/pipeline-tests.cjs
   ========================================================================== */
const { chromium } = require('playwright');

const EXECUTABLE = process.env.PW_CHROMIUM ||
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = 'http://127.0.0.1:8765/tracker/index.html';
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

  // ---- the migration ------------------------------------------------------
  console.log('\n-- v4 -> v5 migration --');
  const mig = await p.evaluate(() => {
    const A = window.AST;
    const old = { schemaVersion: 4, events: [], shows: [
      { id:'a', name:'Accepted show', startDate:'2027-04-10', status:'accepted', juryFee:45 },
      { id:'b', name:'Applied show',  startDate:'2027-05-01', status:'applied',  juryFee:35 },
      { id:'c', name:'Just curious',  startDate:'2027-06-01', status:'interested', juryFee:30 },
      { id:'d', name:'Passed on it',  startDate:'2027-07-01', status:'not_applying' }
    ]};
    const up = A.migrate(old);
    return {
      v: up.schemaVersion, current: A.SCHEMA_VERSION,
      rows: up.applications.map(x => ({
        showId:x.showId, stage:x.stage, cycle:x.cycle,
        fee:x.juryFee, applied:x.appliedOn, notified:x.notifiedOn
      }))
    };
  });
  check('a v4 database migrates to the current schema',
        mig.v === mig.current, JSON.stringify(mig.v));
  check('a show already past "interested" gains an application',
        mig.rows.length === 2 && mig.rows.some(r => r.showId === 'a') &&
        mig.rows.some(r => r.showId === 'b'),
        JSON.stringify(mig.rows.map(r => r.showId)));
  check('a show you never applied to does NOT gain one',
        !mig.rows.some(r => r.showId === 'c' || r.showId === 'd'),
        JSON.stringify(mig.rows.map(r => r.showId)));
  check('the backfilled stage matches the status it came from',
        mig.rows.find(r => r.showId === 'a').stage === 'accepted' &&
        mig.rows.find(r => r.showId === 'b').stage === 'applied');
  check('the cycle is taken from the show year',
        mig.rows.every(r => r.cycle === '2027'), JSON.stringify(mig.rows.map(r => r.cycle)));
  check('the jury fee carries over, because the artist entered it',
        mig.rows.find(r => r.showId === 'a').fee === 45);
  /* The point of the whole migration. We know an application happened; we do
     not know when. A plausible date here would be a fabrication in the one
     collection that has to survive an audit. */
  check('backfilled dates stay EMPTY rather than being invented',
        mig.rows.every(r => r.applied === '' && r.notified === ''),
        JSON.stringify(mig.rows.map(r => [r.applied, r.notified])));

  // ---- the jury fee arithmetic (idea 12) ---------------------------------
  console.log('\n-- jury fee spend --');
  const spend = await p.evaluate(() => {
    const P = window.ASTPipeline;
    const rows = [
      { stage:'accepted',  juryFee:45 }, { stage:'accepted', juryFee:50 },
      { stage:'declined',  juryFee:40 }, { stage:'declined', juryFee:35 },
      { stage:'declined',  juryFee:null },
      { stage:'withdrawn', juryFee:25 },
      { stage:'applied',   juryFee:30 },
      { stage:'declined',  juryFee:20, deletedAt:'2027-01-01T00:00:00Z' }
    ];
    return { s: P.spend(rows), empty: P.spend([]),
             small: P.personalAcceptanceRate(rows) };
  });
  check('a tombstoned application is not counted',
        spend.s.total === 7, String(spend.s.total));
  check('it totals only the fees actually recorded',
        spend.s.spent === 225 && spend.s.feesKnown === 6,
        spend.s.spent + ' across ' + spend.s.feesKnown);
  check('and says how many of the applications that was',
        spend.s.feesKnown < spend.s.total);
  /* Withdrawing is the artist's doing. Counting it as a rejection would
     quietly worsen the odds they are shown. */
  check('a withdrawn application leaves the acceptance denominator',
        spend.s.judged === 5 && spend.s.acceptanceRatePct === 40,
        spend.s.judged + ' judged, ' + spend.s.acceptanceRatePct + '%');
  check('cost per acceptance divides spend by acceptances',
        spend.s.costPerAcceptance === 112.5, String(spend.s.costPerAcceptance));
  check('an empty season reports null spend, not $0',
        spend.empty.spent === null && spend.empty.costPerAcceptance === null,
        JSON.stringify(spend.empty.spent));
  check('a small sample refuses to quote a personal acceptance rate',
        spend.small === null, String(spend.small));

  // ---- expected value (idea 14) ------------------------------------------
  console.log('\n-- expected value --');
  const ev = await p.evaluate(() => {
    const P = window.ASTPipeline;
    return {
      full: P.expectedValue({ acceptanceRatePct:45, expectedGross:4000, boothFee:600, juryFee:45 }),
      noGross: P.expectedValue({ acceptanceRatePct:45, boothFee:600, juryFee:45 }),
      noOdds: P.expectedValue({ expectedGross:4000, boothFee:600, juryFee:45 }),
      mine: P.expectedValue({ personalRatePct:20, acceptanceRatePct:45,
                              expectedGross:4000, boothFee:600, juryFee:45 })
    };
  });
  check('EV is P(accept) x (gross - booth) - jury fee',
        ev.full.value === 1485, String(ev.full.value));
  /* Nothing in the catalogue knows what an artist would gross. Without their
     estimate this must not fall back to anything at all. */
  check('with no gross estimate it returns null, not a guess',
        ev.noGross.value === null, JSON.stringify(ev.noGross.value));
  check('and names the input it is missing',
        ev.noGross.missing.includes('your expected gross'),
        JSON.stringify(ev.noGross.missing));
  check('with no odds it is null and says so',
        ev.noOdds.value === null && ev.noOdds.missing.includes('acceptance odds'));
  check("the artist's own rate outranks the published one",
        ev.mine.basis === 'yours' && ev.mine.value === 635,
        ev.mine.basis + ' ' + ev.mine.value);

  // ---- the store round-trip ----------------------------------------------
  console.log('\n-- storage --');
  const stored = await p.evaluate(async () => {
    const S = window.AST.Store;
    const show = await S.upsert({ name:'Pipeline test show', startDate:'2027-03-01' });
    const app = await S.upsertApplication({
      showId: show.id, cycle:'2027', stage:'applied', appliedOn:'2027-01-15', juryFee:55
    });
    const back = await S.listApplications();
    return { showId: show.id, appId: app.id,
             mine: back.filter(a => a.showId === show.id).length,
             stage: app.stage, fee: app.juryFee };
  });
  check('an application saves against its show', stored.mine === 1 && stored.fee === 55);

  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(400);
  const survived = await p.evaluate(async (id) =>
    (await window.AST.Store.listApplications()).filter(a => a.showId === id).length,
    stored.showId);
  check('and survives a reload', survived === 1, String(survived));

  /* A re-import replaces the season. It must not take the application history
     with it, for the same reason it does not take the calendar. */
  const afterReimport = await p.evaluate(async () => {
    const S = window.AST.Store;
    const before = (await S.listApplications()).length;
    await S.replaceAll([{ name:'A fresh import', startDate:'2028-01-01' }]);
    return { before, after: (await S.listApplications()).length };
  });
  check('a re-import of the season keeps the application history',
        afterReimport.after === afterReimport.before && afterReimport.after > 0,
        JSON.stringify(afterReimport));

  const removed = await p.evaluate(async (id) => {
    const S = window.AST.Store;
    await S.removeApplication(id);
    const live = await S.listApplications();
    const all = await window.AST.LocalStore.listAllApplications();
    return { live: live.some(a => a.id === id), tomb: all.some(a => a.id === id && a.deletedAt) };
  }, stored.appId);
  check('removing an application hides it but leaves a tombstone for sync',
        removed.live === false && removed.tomb === true, JSON.stringify(removed));

  // ---- the UI -------------------------------------------------------------
  console.log('\n-- the panel and the drawer --');
  await p.goto(BASE, { waitUntil: 'networkidle' });
  await p.waitForTimeout(500);
  const panel = await p.evaluate(() => {
    const el = document.getElementById('pipePanel');
    return { present: !!el, text: el ? el.textContent.replace(/\s+/g, ' ').trim() : '',
             note: (document.getElementById('pipeNote') || {}).textContent || '' };
  });
  check('the ledger shows a jury fee panel', panel.present, panel.text);
  /* The line that stops a partial total reading as a complete one. */
  check('a partially-recorded season says the total is partial',
        /Known fees only/.test(panel.note) || !/\$/.test(panel.text),
        panel.note || panel.text);

  const drawer = await p.evaluate(async () => {
    const S = window.AST.Store;
    const undated = await S.upsert({ name:'No dates yet' });
    const shows = await S.list();
    return { undatedId: undated.id, count: shows.length };
  });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(500);
  const block = await p.evaluate((id) => {
    const row = document.querySelector('[data-id="' + id + '"]');
    if (row) row.click();
    const el = document.getElementById('appBlock');
    return { exists: !!el, hidden: el ? el.hidden : null };
  }, drawer.undatedId);
  /* A show with no dates belongs to no season, so it cannot hold an
     application. Hiding the block beats filing one under a blank year. */
  check('a show with no dates hides the application block',
        block.exists && block.hidden === true, JSON.stringify(block));

  console.log('\nerrors: ' + (errs.length ? errs.join(' | ') : 'none'));
  await b.close();
  console.log('\n' + pass + '/' + (pass + fails.length) + ' checks passed');
  if (fails.length) { console.log('FAILED:'); fails.forEach(f => console.log('  - ' + f)); process.exit(1); }
})();
