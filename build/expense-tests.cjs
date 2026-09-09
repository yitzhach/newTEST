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

  // ---- did it pay for itself (§7 Stage 1) ---------------------------------
  console.log('\n-- the post-show number --');
  const rec2 = await p.evaluate(() => window.AST.makeShow({ name: 'x' }).grossSales);
  check('a show with no takings recorded stores null, not 0', rec2 === null, JSON.stringify(rec2));
  const mig9 = await p.evaluate(() => {
    const A = window.AST;
    const up = A.migrate({ schemaVersion: 8, shows: [
      { id:'s1', name:'Old show', startDate:'2026-05-01', boothFee: 600 }
    ], events: [], applications: [], rankers: [], expenses: [], reviews: [] });
    return { v: up.schemaVersion, current: A.SCHEMA_VERSION, gross: up.shows[0].grossSales };
  });
  check('a v8 database migrates to the current schema',
        mig9.v === mig9.current, String(mig9.v));
  /* The app has never had anywhere to put this number, so it cannot know it. */
  check('an existing show is "not recorded", never $0 of sales',
        mig9.gross === null, JSON.stringify(mig9.gross));

  const result = await p.evaluate(() => {
    const X = window.ASTExpenses;
    const rows = [
      { category:'booth_fee', amount:600, showId:'s1' },
      { category:'fuel',      amount:80,  showId:'s1' },
      { category:'booth_fee', amount:400, showId:'s2' },
      { category:'meals',     amount:null, showId:'s2' }
    ];
    return {
      noGross:   X.showResult(rows, 's1', {}),
      cleared:   X.showResult(rows, 's1', { grossSales: 2000 }),
      lost:      X.showResult(rows, 's1', { grossSales: 500 }),
      comm:      X.showResult(rows, 's1', { grossSales: 2000, commissionPct: 10 }),
      partial:   X.showResult(rows, 's2', { grossSales: 1000 }),
      noSpend:   X.showResult(rows, 'nope', { grossSales: 1000 }),
      season:    X.seasonResult(rows, [
                   { id:'s1', name:'A', grossSales: 2000 },
                   { id:'s2', name:'B', grossSales: 1000 },
                   { id:'s3', name:'C', grossSales: null }
                 ])
    };
  });
  /* Without the artist's own figure there is no answer, and a zero would
     turn every unrecorded weekend into a loss. */
  check('no gross figure means no answer, not a loss',
        result.noGross.net === null &&
        result.noGross.missing.some(m => /gross sales/.test(m)),
        JSON.stringify(result.noGross.missing));
  check('a show that cleared its costs reports what is left',
        result.cleared.net === 1320 && result.cleared.cleared === true,
        JSON.stringify(result.cleared.net));
  check('a show that did not is negative, not hidden',
        result.lost.net === -180 && result.lost.cleared === false, String(result.lost.net));
  check('a known commission comes off the top',
        result.comm.net === 1120 && result.comm.commissionKnown === true, String(result.comm.net));
  /* "Not mentioned" is not zero: nothing is subtracted, and the caller has to
     say the figure is before whatever the show takes. */
  check('an unknown commission subtracts nothing and says so',
        result.cleared.commissionCut === null && result.cleared.commissionKnown === false,
        JSON.stringify(result.cleared.commissionCut));
  /* Uncosted rows can only push the real net down, so it is a ceiling. */
  check('a net over a partial expense total is marked provisional and unsettled',
        result.partial.net === 600 && result.partial.provisional === true &&
        result.partial.cleared === null, JSON.stringify(result.partial));
  check('a show with no costed expenses has no net either',
        result.noSpend.net === null, JSON.stringify(result.noSpend.net));
  check('the season nets the shows it can answer',
        result.season.net === 1920 && result.season.known === 2 && result.season.total === 3,
        JSON.stringify(result.season.net));
  check('and a show with no gross is left out rather than counted as zero',
        result.season.complete === false &&
        !result.season.shows.some(s => s.showId === 's3'),
        JSON.stringify(result.season.shows.map(s => s.showId)));

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
    stats: document.getElementById('expStats').textContent.replace(/\s+/g, ' '),
    result: document.getElementById('expResult').textContent.replace(/\s+/g, ' ')
  }));
  check('the log lists the rows', /Booth fee/.test(page.list) && /Lodging/.test(page.list), page.list.slice(0, 120));
  /* The single most important line on the page. */
  check('an uncosted row shows "not costed", not $0',
        /not costed/.test(page.list) && !/\$0\b/.test(page.list), page.list.slice(0, 160));
  check('the money page answers "did it pay for itself" only when it can',
        /gross total goes on the show|No show has a gross sales figure/.test(page.result),
        page.result.slice(0, 160));
  check('the season total says it is partial',
        /Known figures only/.test(page.partial), page.partial);
  check('the lodging find is listed with how it was got',
        /Fairground lot/.test(page.lodging) && /Free/i.test(page.lodging), page.lodging.slice(0, 140));
  check('and it is marked private, because nothing was shared',
        /private/.test(page.lodging), page.lodging.slice(0, 140));

  // ---- §7 Stage 3: individual sales ---------------------------------------
  console.log('\n-- the sale record --');
  const sale = await p.evaluate(() => window.AST.makeSale({ piece: 'Untitled #4' }));
  /* Same rule as an uncosted expense row, for the same reason: a piece
     nobody typed a price for is not a piece that was given away. */
  check('an unpriced sale stores null, not 0', sale.price === null, JSON.stringify(sale.price));
  check('a sale with no date stays blank rather than being dated today',
        sale.date === '', JSON.stringify(sale.date));
  check('payment method defaults to "not recorded", never a guess',
        sale.paymentMethod === '', JSON.stringify(sale.paymentMethod));
  check('a hand-entered sale is marked as its own, not as imported',
        sale.source === 'manual', sale.source);
  check('a sale is a child record with its own id and timestamp',
        !!sale.id && !!sale.updatedAt && sale.deletedAt === null, JSON.stringify(sale.id));

  const mig10 = await p.evaluate(() => {
    const A = window.AST;
    const up = A.migrate({ schemaVersion: 9, shows: [
      { id:'s1', name:'A sold-out weekend', startDate:'2026-05-01', grossSales: 4200 }
    ], events: [], applications: [], rankers: [], expenses: [], reviews: [] });
    return { v: up.schemaVersion, current: A.SCHEMA_VERSION,
             sales: up.sales, gross: up.shows[0].grossSales };
  });
  check('a v9 database migrates to the current schema',
        mig10.v === mig10.current && mig10.current === 10, String(mig10.v));
  /* Splitting one stated total into rows would have to invent pieces, prices,
     sizes and dates, in the one collection that has to survive an audit. */
  check('a stated gross total is NOT split into invented sale rows',
        Array.isArray(mig10.sales) && mig10.sales.length === 0, JSON.stringify(mig10.sales));
  check('and the stated total is left exactly where it was',
        mig10.gross === 4200, String(mig10.gross));

  console.log('\n-- the mix --');
  const mix = await p.evaluate(() => {
    const S = window.ASTSales;
    const rows = [
      { id:'a', showId:'s1', piece:'Small one',  price:80,   quantity:1 },
      { id:'b', showId:'s1', piece:'Mid',        price:300,  quantity:2 },
      { id:'c', showId:'s1', piece:'Big',        price:1200, quantity:1 },
      { id:'d', showId:'s2', piece:'Other',      price:300,  quantity:1 },
      { id:'e', showId:'s1', piece:'Not priced', price:null, quantity:1 },
      { id:'f', showId:'s1', piece:'Deleted',    price:500, deletedAt:'2027-01-01T00:00:00Z' }
    ];
    const shows = [{ id:'s1', name:'A', state:'WA' }, { id:'s2', name:'B', state:'OR' }];
    return {
      sum: S.sum(rows),
      band: S.bandOf(300),
      noBand: S.bandOf(null),
      bands: S.byBand(rows),
      regions: S.byRegion(rows, shows),
      orphanRegion: S.byRegion([{ id:'z', showId:'', price:100 }], shows),
      through: S.sellThrough(rows, shows),
      counted: S.sellThrough(rows, shows, { piecesBrought: 20 })
    };
  });
  check('a sale of two prints is two pieces at the full price',
        mix.sum.amount === 2180 && mix.sum.pieces === 6, JSON.stringify(mix.sum));
  check('the total says how many rows carried a price',
        mix.sum.known === 4 && mix.sum.total === 5 && mix.sum.complete === false,
        JSON.stringify(mix.sum));
  /* Null price means null band. An unpriced piece is not a cheap one. */
  check('an unpriced sale falls in no band rather than the bottom one',
        mix.band === '250_499' && mix.noBand === null, JSON.stringify([mix.band, mix.noBand]));
  check('the mix reports revenue and share per price band',
        mix.bands.bands.length === 3 &&
        mix.bands.bands.every(b => b.shareOfRevenue > 0 && b.shareOfRevenue <= 1),
        JSON.stringify(mix.bands.bands.map(b => [b.key, b.sum.amount])));
  check('and it counts the unpriced rows rather than dropping them',
        mix.bands.unpriced === 1 && mix.bands.complete === false, String(mix.bands.unpriced));
  check('sales are grouped by the state of the show they were made at',
        mix.regions.map(r => r.key).join(',') === 'WA,OR',
        JSON.stringify(mix.regions.map(r => [r.key, r.sum.amount])));
  /* Filing a sale under a state it might not have happened in is exactly the
     kind of quiet wrong number this app exists not to print. */
  check('a sale with no show lands in an explicit "not known" bucket',
        mix.orphanRegion.length === 1 && mix.orphanRegion[0].known === false &&
        mix.orphanRegion[0].label === 'Not known', JSON.stringify(mix.orphanRegion[0]));
  /* Sell-through is sold divided by brought, and nothing records what went in
     the van. A percentage of a made-up denominator is worse than no figure. */
  check('sell-through refuses a rate and names the input it is missing',
        mix.through.rate === null && /brought/.test(mix.through.missing.join(' ')),
        JSON.stringify(mix.through.missing));
  check('given a real count of pieces brought, it does quote a rate',
        Math.abs(mix.counted.rate - 0.3) < 1e-9, String(mix.counted.rate));

  console.log('\n-- the stated total vs. the rows --');
  const rec3 = await p.evaluate(() => {
    const S = window.ASTSales, X = window.ASTExpenses;
    const rows = [
      { id:'a', showId:'s1', price:1000 },
      { id:'b', showId:'s1', price:500 },
      { id:'c', showId:'s2', price:900 },
      { id:'d', showId:'s3', price:null }
    ];
    const exp = [{ category:'booth_fee', amount:400, showId:'s1' },
                 { category:'booth_fee', amount:400, showId:'s2' }];
    const agreeShow    = { id:'s1', name:'Agrees',  grossSales: 1500 };
    const disagreeShow = { id:'s1', name:'Differs', grossSales: 1800 };
    const noTotalShow  = { id:'s2', name:'Rows only', grossSales: null };
    const noRowsShow   = { id:'s9', name:'Total only', grossSales: 700 };
    return {
      agree:    S.reconcile(rows, agreeShow),
      disagree: S.reconcile(rows, disagreeShow),
      rowsOnly: S.reconcile(rows, noTotalShow),
      totalOnly: S.reconcile(rows, noRowsShow),
      neither:  S.reconcile(rows, { id:'s8', grossSales: null }),
      note:     S.reconcileNote(S.reconcile(rows, disagreeShow)),
      rowsNote: S.reconcileNote(S.reconcile(rows, noTotalShow)),
      resStated: X.showResult(exp, 's1', { grossSales: 1800, salesSummary: S.sum(S.forShow(rows, 's1')) }),
      resRows:   X.showResult(exp, 's2', { grossSales: null, salesSummary: S.sum(S.forShow(rows, 's2')) }),
      season:    X.seasonResult(exp, [{ id:'s1', name:'A', grossSales: 1800 },
                                      { id:'s2', name:'B', grossSales: null }],
                                { salesFor: id => S.sum(S.forShow(rows, id)) })
    };
  });
  check('a stated total that matches the rows is reported as agreeing',
        rec3.agree.agree === true && rec3.agree.difference === 0, JSON.stringify(rec3.agree.difference));
  /* Neither record is authoritative. Both are the artist's own evidence,
     taken at different moments, and one is not a correction of the other. */
  check('when they disagree BOTH figures are kept, with the difference',
        rec3.disagree.agree === false && rec3.disagree.stated === 1800 &&
        rec3.disagree.rowsTotal === 1500 && rec3.disagree.difference === 300,
        JSON.stringify(rec3.disagree));
  check('and it names which figure it is showing rather than picking silently',
        rec3.disagree.showing === 'stated' && rec3.disagree.both === true,
        rec3.disagree.showing);
  check('the note says both numbers out loud',
        /1,500/.test(rec3.note) && /stated gross/.test(rec3.note) &&
        /neither is corrected from the other/.test(rec3.note), rec3.note);
  check('with no stated total the rows answer, and the note says so',
        rec3.rowsOnly.showing === 'rows' && rec3.rowsOnly.amount === 900 &&
        /not stated a gross total/.test(rec3.rowsNote), rec3.rowsNote);
  check('with no rows the stated total answers alone',
        rec3.totalOnly.showing === 'stated' && rec3.totalOnly.both === false,
        JSON.stringify(rec3.totalOnly.showing));
  check('with neither, there is no figure at all',
        rec3.neither.showing === null && rec3.neither.amount === null,
        JSON.stringify(rec3.neither.amount));
  check('the net is built on the stated total and says which one that was',
        rec3.resStated.net === 1400 && rec3.resStated.grossSource === 'stated' &&
        rec3.resStated.grossFromRows === 1500 && rec3.resStated.grossAgrees === false,
        JSON.stringify([rec3.resStated.net, rec3.resStated.grossSource]));
  /* Stage 3 makes a show answerable that Stage 1 could not answer at all. */
  check('a show with no stated total is now answered from its sale rows',
        rec3.resRows.net === 500 && rec3.resRows.grossSource === 'rows',
        JSON.stringify([rec3.resRows.net, rec3.resRows.grossSource]));
  check('the season counts how many shows disagree and how many came from rows',
        rec3.season.disagreeing === 1 && rec3.season.fromRows === 1 && rec3.season.known === 2,
        JSON.stringify(rec3.season));

  console.log('\n-- the Square / Stripe import --');
  const imp = await p.evaluate(() => {
    const S = window.ASTSales;
    const square = [
      'Date,Time,Item,Qty,Gross Sales,Discounts,Net Sales,Card Brand,Transaction ID',
      '05/02/2027,11:04 AM,"Marsh, morning",1,$450.00,$0.00,$450.00,Visa,sq-1',
      '05/02/2027,02:15 PM,Small study,2,$160.00,$0.00,$160.00,Cash,sq-2',
      '05/03/2027,10:00 AM,Refunded piece,1,-$450.00,$0.00,-$450.00,Visa,sq-3',
      '05/03/2027,11:00 AM,No amount,1,,,,Visa,sq-4'
    ].join('\n');
    const stripe = [
      'id,Created (UTC),Amount,Currency,Description,Status,Payment Method Type',
      'ch_1,2027-05-02 11:04:00,900.00,usd,Large canvas,Paid,card',
      'ch_2,2027-05-02 12:00:00,120.00,usd,Print,Failed,card'
    ].join('\n');
    const junk = 'Name,Email,Phone\nA,a@b.c,555';
    const sq = S.importCsv(square, { showId: 's1' });
    return {
      sq: sq,
      stripe: S.importCsv(stripe, { showId: 's1' }),
      junk: S.importCsv(junk, { showId: 's1' }),
      empty: S.importCsv('Date,Item,Gross Sales', {}),
      merged: S.mergeImported(
        [{ id:'existing', source:'square', externalId:'sq-1', price:450 }], sq.rows),
      quoted: S.parseCsv('a,"b,c",d')[0]
    };
  });
  check('a Square export is recognised and read',
        imp.sq.ok === true && imp.sq.format === 'square', JSON.stringify(imp.sq.format));
  check('a Stripe export is recognised too',
        imp.stripe.ok === true && imp.stripe.format === 'stripe', JSON.stringify(imp.stripe.format));
  check('the parser handles quoted fields containing commas',
        imp.quoted.length === 3 && imp.quoted[1] === 'b,c', JSON.stringify(imp.quoted));
  check('prices, dates, quantities and payment methods come across',
        imp.sq.rows[0].price === 450 && imp.sq.rows[0].date === '2027-05-02' &&
        imp.sq.rows[1].quantity === 2 && imp.sq.rows[1].paymentMethod === 'cash' &&
        imp.sq.rows[0].paymentMethod === 'card',
        JSON.stringify(imp.sq.rows[0]));
  /* A refund is not a sale, and subtracting it from a season it was never
     added to would be worse than leaving it out. */
  check('a refund is skipped and the reason is given, not silently dropped',
        imp.sq.skipped.some(k => /refund/.test(k.reason)), JSON.stringify(imp.sq.skipped));
  check('a Stripe row that never completed is skipped with its status',
        imp.stripe.rows.length === 1 &&
        imp.stripe.skipped.some(k => /failed/.test(k.reason)),
        JSON.stringify(imp.stripe.skipped));
  check('a row with no readable amount imports unpriced, NOT as $0',
        imp.sq.rows[2].price === null &&
        imp.sq.warnings.some(w => /unpriced rather than as \$0/.test(w)),
        JSON.stringify(imp.sq.warnings));
  /* Untrusted input: an unknown file is refused whole rather than column-guessed. */
  check('a file that is neither export is refused, and nothing is imported',
        imp.junk.ok === false && imp.junk.rows.length === 0 &&
        /Square or Stripe/.test(imp.junk.error), imp.junk.error);
  check('a header with no rows under it is refused too',
        imp.empty.ok === false && /no rows/.test(imp.empty.error), imp.empty.error);
  check('an imported row keeps the processor it came from',
        imp.sq.rows[0].source === 'square', imp.sq.rows[0].source);
  /* Re-importing the same export must not double a season's takings. */
  check('re-importing matches on the transaction id and updates in place',
        imp.merged.updated.length === 1 && imp.merged.updated[0].id === 'existing' &&
        imp.merged.added.length === 2,
        JSON.stringify([imp.merged.updated.length, imp.merged.added.length]));

  console.log('\n-- the sales panels --');
  const seeded = await p.evaluate(async () => {
    const St = window.AST.Store;
    const shows = await St.list();
    const show = shows.find(x => x.name === 'Expense test show');
    /* A stated gross that deliberately does NOT match the rows, which is the
       case the page has to handle out loud. */
    await St.upsert({ ...show, grossSales: 2000 });
    await St.upsertSale({ showId: show.id, piece: 'Harbour light', price: 900,
                          size:'24 x 36 in', medium:'oil', date:'2027-04-01',
                          paymentMethod:'card' });
    await St.upsertSale({ showId: show.id, piece: 'Study', price: null,
                          date:'2027-04-02' });
    return show.id;
  });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  const sp = await p.evaluate(id => {
    document.getElementById('expShow').value = id;
    document.getElementById('expShow').dispatchEvent(new Event('change'));
    const t = el => document.getElementById(el).textContent.replace(/\s+/g, ' ');
    return { list: t('saleList'), bands: t('saleBands'), bandNote: t('saleBandNote'),
             regions: t('saleRegions'), result: t('expResult') };
  }, seeded);
  check('the sales panel lists each sale with its piece and price',
        /Harbour light/.test(sp.list) && /\$900/.test(sp.list), sp.list.slice(0, 140));
  check('an unpriced sale shows "not priced", not $0',
        /not priced/.test(sp.list) && !/\$0\b/.test(sp.list), sp.list.slice(0, 200));
  check('the price band mix is shown', /\$500|\$999/.test(sp.bands), sp.bands.slice(0, 140));
  /* The refusal, on the page and not only in the module. */
  check('the page says this is the mix and not sell-through, and why',
        /not sell-through/.test(sp.bandNote) && /brought/.test(sp.bandNote),
        sp.bandNote.slice(0, 200));
  check('sales are placed by state', sp.regions.length > 0, sp.regions.slice(0, 120));
  /* The whole point of Stage 3 meeting Stage 1: two records, both shown. */
  check('the page names which gross figure it is showing when they disagree',
        /stated gross/.test(sp.result) && /\$900/.test(sp.result) &&
        /neither is corrected from the other/.test(sp.result),
        sp.result.slice(-260));

  // ---- the phone -----------------------------------------------------------
  /* The bug this covers: the modals were built without the .modal-card
     wrapper the stylesheet expects, so .modal's own `pointer-events:none`
     stayed in force and the dialog could not be typed into AT ALL — with no
     background and no width, it rendered as a transparent skinny column over
     the page. It looked like a mobile problem and was not. */
  console.log('\n-- the editors are usable --');
  const cards = await p.evaluate(() => {
    const out = {};
    for (const id of ['exModal', 'saModal', 'imModal']) {
      const m = document.getElementById(id);
      const card = m.querySelector(':scope > .modal-card');
      out[id] = {
        hasCard: !!card,
        events: card ? getComputedStyle(card).pointerEvents : getComputedStyle(m).pointerEvents
      };
    }
    return out;
  });
  check('every editor has the card wrapper the stylesheet expects',
        Object.values(cards).every(c => c.hasCard), JSON.stringify(cards));
  check('and it accepts pointer input rather than being inert',
        Object.values(cards).every(c => c.events === 'auto'), JSON.stringify(cards));

  const typed = await p.evaluate(async () => {
    document.getElementById('saleAdd').click();
    const el = document.getElementById('saPiece');
    el.focus();
    return { open: !document.getElementById('saModal').hidden,
             focused: document.activeElement === el };
  });
  check('the Add sale editor opens and its first field takes focus',
        typed.open && typed.focused, JSON.stringify(typed));

  await p.setViewportSize({ width: 390, height: 844 });   // a phone, portrait
  await p.waitForTimeout(200);
  const phone = await p.evaluate(() => {
    const card = document.querySelector('#saModal > .modal-card');
    const r = card.getBoundingClientRect();
    const input = document.getElementById('saPiece').getBoundingClientRect();
    const save = document.getElementById('saSave').getBoundingClientRect();
    return {
      cardWidth: Math.round(r.width), viewport: window.innerWidth,
      inputWidth: Math.round(input.width),
      fontSize: parseFloat(getComputedStyle(document.getElementById('saPiece')).fontSize),
      saveVisible: save.bottom <= window.innerHeight && save.width > 0,
      bodyScrollsSideways: document.documentElement.scrollWidth > window.innerWidth + 1
    };
  });
  check('on a phone the editor fills the screen instead of a skinny column',
        phone.cardWidth === phone.viewport, JSON.stringify(phone));
  check('and its fields are full width, not a few characters wide',
        phone.inputWidth > phone.viewport * 0.7, String(phone.inputWidth));
  /* Under 16px, iOS zooms the page in on focus and never zooms back out. */
  check('text inputs are 16px so iOS does not zoom the page on focus',
        phone.fontSize >= 16, String(phone.fontSize));
  check('Save is reachable without scrolling the dialog off screen',
        phone.saveVisible === true, JSON.stringify(phone.saveVisible));
  check('and the page never scrolls sideways',
        phone.bodyScrollsSideways === false, String(phone.bodyScrollsSideways));

  await p.evaluate(() => document.getElementById('saCancel').click());

  // ---- the page menu -------------------------------------------------------
  console.log('\n-- the menu --');
  const nav = await p.evaluate(() => {
    const btn = document.getElementById('navMenuBtn');
    const before = document.getElementById('navMenuList').hidden;
    btn.click();
    const list = document.getElementById('navMenuList');
    const items = [...list.querySelectorAll('.nav-item')];
    return {
      exists: !!btn,
      closedFirst: before,
      opens: !list.hidden,
      expanded: btn.getAttribute('aria-expanded'),
      links: items.map(a => a.getAttribute('href')),
      labels: list.textContent.replace(/\s+/g, ' '),
      here: items.filter(a => a.getAttribute('aria-current') === 'page')
                 .map(a => a.getAttribute('href')),
      firstInHeader: document.querySelector('.header-actions').firstElementChild
                       .classList.contains('nav-menu')
    };
  });
  check('every page carries the menu button', nav.exists === true);
  check('it starts closed and opens on a click',
        nav.closedFirst === true && nav.opens === true && nav.expanded === 'true',
        JSON.stringify([nav.closedFirst, nav.opens]));
  check('it reaches the money page, the mock jury and the rest',
        ['index.html','browse.html','calendar.html','expenses.html','jury.html','map.html']
          .every(f => nav.links.includes(f)), JSON.stringify(nav.links));
  check('each entry says what the page is for, not just its name',
        /Expenses, sales/.test(nav.labels) && /Practice review/.test(nav.labels),
        nav.labels.slice(0, 160));
  /* Being told where you already are is the difference between a menu and a
     list of links. */
  check('and it marks the page you are already on',
        nav.here.length === 1 && nav.here[0] === 'expenses.html', JSON.stringify(nav.here));
  check('the menu is the first control in the header, so a thumb finds it',
        nav.firstInHeader === true, String(nav.firstInHeader));

  const closes = await p.evaluate(() => {
    document.body.click();
    const afterClick = document.getElementById('navMenuList').hidden;
    document.getElementById('navMenuBtn').click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return { afterClick, afterEsc: document.getElementById('navMenuList').hidden };
  });
  check('it closes on an outside tap and on Escape',
        closes.afterClick === true && closes.afterEsc === true, JSON.stringify(closes));

  await p.setViewportSize({ width: 1480, height: 1000 });
  await p.waitForTimeout(150);

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
