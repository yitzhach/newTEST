/* ==========================================================================
   Browser tests for the expense log and the lodging finds.

   The interesting checks here are all about what the page REFUSES to do:
   a row with no amount is not a $0 row, a total that cannot see every row
   says so, a show nobody has stayed at is not "expensive", and no federal
   mileage rate ships with the app. Those are the ways an expense log lies.

   Also asserted: the Pro previews are inert. There is no billing in this
   project, so a Pro control that looked clickable would be a false offer.

   Usage:
     python3 -m http.server 8765     # from the repo root
     node build/expense-tests.cjs
   ========================================================================== */
const { chromium } = require('playwright');

const EXECUTABLE = process.env.PW_CHROMIUM ||
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = 'http://127.0.0.1:8765/tracker/expenses.html';
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
  await p.waitForTimeout(500);

  // ---- the record ---------------------------------------------------------
  console.log('\n-- the record --');
  const rec = await p.evaluate(() => window.AST.makeExpense({ category: 'lodging' }));
  check('an uncosted row stores null, not 0', rec.amount === null, JSON.stringify(rec.amount));
  /* "No overnight parking" and "nobody checked" are different answers, and
     one of them gets an artist moved on at 2am. */
  check('overnight parking is tri-state, defaulting to "not checked"',
        rec.overnightParking === null, JSON.stringify(rec.overnightParking));
  check('a lodging find is private unless marked shareable',
        rec.shareable === false, String(rec.shareable));
  const cat = await p.evaluate(() =>
    ({ junk: window.AST.makeExpense({ category: 'not_a_category' }).category,
       good: window.AST.makeExpense({ category: 'fuel' }).category }));
  check('an unknown category falls back to "other" rather than being invented',
        cat.junk === 'other' && cat.good === 'fuel', JSON.stringify(cat));

  const mig = await p.evaluate(() => {
    const A = window.AST;
    const up = A.migrate({ schemaVersion: 6, shows: [
      { id:'s1', name:'Paid show', startDate:'2027-05-01', boothFee: 600, juryFee: 45 }
    ], events: [], applications: [], rankers: [] });
    return { v: up.schemaVersion, current: A.SCHEMA_VERSION, expenses: up.expenses };
  });
  check('a v6 database migrates to the current schema', mig.v === mig.current, String(mig.v));
  /* A show's boothFee is what the artist EXPECTS to pay. Turning it into an
     expense row would invent a payment that may never have happened. */
  check('listed fees are NOT backfilled as money that was spent',
        Array.isArray(mig.expenses) && mig.expenses.length === 0, JSON.stringify(mig.expenses));

  // ---- the arithmetic -----------------------------------------------------
  console.log('\n-- totals --');
  const maths = await p.evaluate(() => {
    const X = window.ASTExpenses;
    const rows = [
      { category:'booth_fee', amount:600, showId:'s1' },
      { category:'mileage',   miles:400, mileageRate:0.67, showId:'s1' },
      { category:'fuel',      amount:80, showId:'s1' },
      { category:'lodging',   amount:null, showId:'s1', lodgingKind:'free',
        overnightParking:true, rvFriendly:true, nights:2 },
      { category:'meals',     amount:45, showId:'s1' },
      { category:'supplies',  amount:20, deletedAt:'2027-01-01T00:00:00Z' }
    ];
    return {
      sum: X.sum(rows),
      mileage: X.costOf(rows[1]),
      noRate: X.costOf({ category:'mileage', miles:400, mileageRate:null }),
      override: X.costOf({ category:'mileage', miles:400, mileageRate:0.67, amount:500 }),
      empty: X.sum([]),
      both: X.hasBothDrivingMethods(rows, 's1'),
      be: X.breakEven(rows, 's1', null),
      beComm: X.breakEven(rows, 's1', 15),
      lodging: X.lodgingAffordability(rows, 's1'),
      never: X.lodgingAffordability(rows, 'nope')
    };
  });
  check('a tombstoned row is not counted', maths.sum.total === 5, String(maths.sum.total));
  check('mileage costs miles x the artist’s own rate', maths.mileage === 268, String(maths.mileage));
  /* No rate means no figure. The app ships no federal rate to fall back on. */
  check('mileage with no rate set has NO cost, rather than a guessed one',
        maths.noRate === null, JSON.stringify(maths.noRate));
  check('a typed amount overrides the mileage calculation',
        maths.override === 500, String(maths.override));
  check('the total adds only rows that carry a figure',
        maths.sum.amount === 993 && maths.sum.known === 4 && maths.sum.total === 5,
        JSON.stringify(maths.sum));
  check('and it reports itself incomplete', maths.sum.complete === false);
  check('an empty log totals null, not $0',
        maths.empty.amount === null, JSON.stringify(maths.empty.amount));
  check('mileage and fuel are both kept, never merged', maths.both === true);
  check('break-even is what has been spent when no commission is known',
        maths.be.value === 993 && maths.be.commissionKnown === false, String(maths.be.value));
  check('a known commission raises the figure you must sell',
        Math.round(maths.beComm.value) === 1168 && maths.beComm.commissionKnown === true,
        String(maths.beComm.value));

  console.log('\n-- lodging --');
  check('a free stay with parking is recorded as such',
        maths.lodging.free === true && maths.lodging.overnightParking === true &&
        maths.lodging.rvFriendly === true && maths.lodging.nights === 2,
        JSON.stringify(maths.lodging));
  /* A show the artist has never stayed at must not be scored as expensive. */
  check('a show never stayed at returns null, NOT a bad score',
        maths.never === null, JSON.stringify(maths.never));

  const sharing = await p.evaluate(() => {
    const X = window.ASTExpenses;
    const rows = [
      { category:'lodging', lodgingKind:'free', shareable:false, vendor:'Church lot' },
      { category:'lodging', lodgingKind:'discount', shareable:true, vendor:'Motel' }
    ];
    return { finds: X.lodgingFinds(rows).length, shared: X.shareableFinds(rows).length };
  });
  check('both finds are kept locally', sharing.finds === 2, String(sharing.finds));
  check('only the one marked shareable is offered for sharing',
        sharing.shared === 1, String(sharing.shared));

  // ---- the page -----------------------------------------------------------
  console.log('\n-- the page --');
  const ui = await p.evaluate(async () => {
    const S = window.AST.Store;
    const show = await S.upsert({ name: 'Expense test show', startDate: '2027-04-01' });
    await S.upsertExpense({ category:'booth_fee', amount:600, showId:show.id, date:'2027-03-01' });
    await S.upsertExpense({ category:'lodging', amount:null, showId:show.id,
                            lodgingKind:'free', overnightParking:true, vendor:'Fairground lot' });
    return show.id;
  });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  const page = await p.evaluate(() => ({
    list: document.getElementById('expList').textContent.replace(/\s+/g, ' '),
    partial: document.getElementById('expPartial').textContent,
    lodging: document.getElementById('expLodging').textContent.replace(/\s+/g, ' '),
    stats: document.getElementById('expStats').textContent.replace(/\s+/g, ' ')
  }));
  check('the log lists the rows', /Booth fee/.test(page.list) && /Lodging/.test(page.list), page.list.slice(0, 120));
  /* The single most important line on the page. */
  check('an uncosted row shows "not costed", not $0',
        /not costed/.test(page.list) && !/\$0\b/.test(page.list), page.list.slice(0, 160));
  check('the season total says it is partial',
        /Known figures only/.test(page.partial), page.partial);
  check('the lodging find is listed with how it was got',
        /Fairground lot/.test(page.lodging) && /Free/i.test(page.lodging), page.lodging.slice(0, 140));
  check('and it is marked private, because nothing was shared',
        /private/.test(page.lodging), page.lodging.slice(0, 140));

  // ---- Pro previews are inert ---------------------------------------------
  console.log('\n-- Pro previews --');
  const pro = await p.evaluate(() => {
    const cards = [...document.querySelectorAll('.pro-card')];
    const btns = [...document.querySelectorAll('.pro-card button')];
    return {
      count: cards.length,
      allDisabled: btns.length > 0 && btns.every(b => b.disabled),
      text: document.getElementById('expPro').textContent,
      title: btns.length ? btns[0].title : ''
    };
  });
  check('the planned features are shown', pro.count >= 3, String(pro.count));
  check('every Pro control is disabled', pro.allDisabled === true, String(pro.allDisabled));
  /* There is no billing here. A price or a sign-up would be a false offer. */
  check('no price, plan name, trial or sign-up is shown',
        !/\$\d|per month|\/mo|free trial|sign up|subscribe|upgrade/i.test(pro.text),
        pro.text.slice(0, 160));
  check('and it says plainly that none of it is buyable yet',
        /no plans to buy|not built yet/i.test(pro.title), pro.title);

  // ---- no tax advice, anywhere on the page --------------------------------
  const body = await p.evaluate(() => document.body.textContent);
  /* Categorising a row is bookkeeping. Telling somebody it is deductible is
     advice, and it is not ours to give. */
  check('the page never uses the word "deductible" or offers tax advice',
        !/deductib|write.?off|tax advice(?! )|claim this on/i.test(body) ||
        /not tax advice/i.test(body),
        (body.match(/.{0,40}deductib.{0,40}/i) || ['none'])[0]);

  console.log('\nerrors: ' + (errs.length ? errs.join(' | ') : 'none'));
  await b.close();
  console.log('\n' + pass + '/' + (pass + fails.length) + ' checks passed');
  if (fails.length) { console.log('FAILED:'); fails.forEach(f => console.log('  - ' + f)); process.exit(1); }
})();
