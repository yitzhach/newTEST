/* ==========================================================================
   Browser tests for the ledger-view rework and the three scoring lenses.

   Kept separate from build/browser-tests.cjs because this suite FILES A
   REPORT and then asserts on what changes as a result — the badge, the
   "My results" lens, the drawer tabs, the provenance chips. That is stateful
   in a way the model tests are not, and mixing the two would make each one
   harder to read and to debug.

   Usage:
     npm i -D playwright             # once
     python3 -m http.server 8765     # from the repo root
     node build/ledger-view-tests.cjs
   ========================================================================== */
const { chromium } = require('playwright');

/* This sandbox pins Chromium and blocks Playwright's download. Delete that
   path or set PW_CHROMIUM and it falls back to Playwright's own resolution. */
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
  /* Sandbox-blocked hosts. open-meteo serves the weather lookup, whose
     failure here is expected and is asserted on directly in browser-tests.cjs;
     filtering it keeps a genuine error visible in this suite. */
  p.on('requestfailed', r => {
    if (!/fonts\.|favicon|cdnjs|open-meteo/.test(r.url())) errs.push('reqfail ' + r.url());
  });

  await p.goto(BASE, { waitUntil: 'networkidle' });
  /* The suite files a report and asserts on the consequences, so it has to
     start from a browser that has none. */
  await p.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  check('page boots clean', errs.length === 0, errs.slice(0,2).join(' | '));

  // ---- lens selector -----------------------------------------------------
  const lenses = await p.$$eval('#pfLens option', e => e.map(o => o.value));
  check('three lenses offered', JSON.stringify(lenses) === '["model","mine","network"]', lenses.join(','));

  // ---- name opens details, not an external page --------------------------
  await p.click('#btnViewRows'); await p.waitForTimeout(300);
  const nameIsButton = await p.$eval('.crow .c-name .namebtn', el => el.tagName);
  check('show name is a button, not a link', nameIsButton === 'BUTTON', nameIsButton);
  await p.click('.crow .c-name .namebtn');
  await p.waitForTimeout(400);
  check('clicking the name opens the drawer', await p.isVisible('.idr'));
  const drawerTitle = await p.textContent('.idr-head h2');
  await p.click('#idrClose');

  // ---- external link is separate and opens a new tab ---------------------
  const ext = await p.$eval('.crow .c-name .extlink', el => ({
    href: el.getAttribute('href'), target: el.getAttribute('target'), rel: el.getAttribute('rel') }));
  check('external link points off-site', /^https?:/.test(ext.href || ''), ext.href);
  check('external link opens a new tab safely',
        ext.target === '_blank' && /noopener/.test(ext.rel || ''), JSON.stringify(ext));

  // clicking it must NOT open the drawer
  const [popup] = await Promise.all([
    p.waitForEvent('popup', { timeout: 5000 }).catch(() => null),
    p.click('.crow .c-name .extlink')
  ]);
  await p.waitForTimeout(300);
  check('the external link does not also open the drawer', !(await p.isVisible('.idr')));
  if (popup) await popup.close();

  // ---- no report yet -> lens shows dashes --------------------------------
  await p.selectOption('#pfLens', 'mine');
  await p.waitForTimeout(500);
  const dashes = await p.$$eval('.crow .fitchip', e => e.filter(x => x.textContent.trim() === '—').length);
  const total = await p.$$eval('.crow .fitchip', e => e.length);
  check('with no reports, "My results" scores nothing rather than guessing',
        dashes === total && total > 100, dashes + ' of ' + total + ' dashes');
  const dashTitle = await p.$eval('.crow .fitchip', e => e.getAttribute('title'));
  check('the dash explains itself', /have not reported/i.test(dashTitle || ''), dashTitle);

  // ---- file a report -----------------------------------------------------
  await p.selectOption('#pfLens', 'model');
  await p.waitForTimeout(400);
  await p.uncheck('#fOpen');
  await p.fill('#fText', 'La Quinta');
  await p.waitForTimeout(400);
  await p.click('.crow .btn-detail');
  await p.waitForTimeout(400);
  const tabsBefore = await p.$$eval('.rtab', e => e.map(x => x.textContent.trim()));
  check('drawer shows Yours / The network tabs', tabsBefore.length === 2, tabsBefore.join(' | '));
  await p.click('#btnAddIntel');
  await p.waitForTimeout(400);
  await p.fill('#f_grossSales', '24000');
  await p.fill('#f_piecesSold', '6');
  await p.fill('#f_boothFeePaid', '900');
  for (const [k, v] of [['buyerWealth',10],['fineArtOrientation',9],['priceTolerance',9],
                        ['salesTrackRecord',9],['prestige',8],['qualifiedTraffic',9],
                        ['costEfficiency',6],['lowCompetition',7],['logistics',7],['juryOdds',4]]) {
    await p.fill('[data-factor="' + k + '"]', String(v));
  }
  await p.click('#btnRepSave');
  await p.waitForTimeout(700);

  // ---- the badge shows on the row ----------------------------------------
  const badge = await p.$('.crow .rbadge.is-mine');
  check('the ledger row marks that you reported', !!badge);
  const badgeTitle = badge ? await badge.getAttribute('title') : '';
  check('the badge says whose report it is', /You have 1 report/i.test(badgeTitle || ''), badgeTitle);

  // ---- "My results" lens now scores it ------------------------------------
  await p.selectOption('#pfLens', 'mine');
  await p.waitForTimeout(500);
  const myFit = await p.$eval('.crow .fitchip', e => e.textContent.trim());
  check('"My results" scores a show you reported on', /^\d\.\d$/.test(myFit), myFit);

  // and other shows still show a dash
  await p.fill('#fText', '');
  await p.waitForTimeout(500);
  const scored = await p.$$eval('.crow .fitchip', e => e.filter(x => /^\d/.test(x.textContent.trim())).length);
  check('only the reported show scores under "My results"', scored === 1, 'scored: ' + scored);

  // ---- read-your-report link ---------------------------------------------
  await p.fill('#fText', 'La Quinta');
  await p.waitForTimeout(400);
  await p.click('.crow .btn-detail');
  await p.waitForTimeout(500);
  const readLink = await p.textContent('.sd-read');
  check('drawer header links to your report', /Read your report/i.test(readLink || ''), (readLink||'').trim());
  await p.click('#btnReadReport');
  await p.waitForTimeout(400);
  const yoursOn = await p.$eval('.rtab[data-report-tab="mine"]', e => e.classList.contains('on'));
  check('the Yours tab is the default', yoursOn);
  const mineBody = await p.textContent('.idr-body');
  check('your own numbers show under Yours', /24,000/.test(mineBody), '');

  await p.click('.rtab[data-report-tab="network"]');
  await p.waitForTimeout(500);
  const netBody = await p.textContent('.idr-body');
  check('the network tab holds the line at one report',
        /Nothing reported yet|report so far/i.test(netBody), netBody.slice(0, 80));

  // ---- provenance must follow the lens ------------------------------------
  await p.click('.rtab[data-report-tab="mine"]');
  await p.waitForTimeout(400);
  const provUnderMine = await p.$$eval('.factable .prov', e => e.map(x => x.textContent.trim()));
  check('under "My results" the factors are labelled reported, not estimate',
        provUnderMine.length > 0 && provUnderMine.every(t => t === 'reported'),
        provUnderMine.slice(0, 4).join(','));
  const provTitle = await p.$eval('.factable .prov', e => e.getAttribute('title'));
  check('the chip says it is your own rating', /your own rating/i.test(provTitle || ''), provTitle);

  await p.click('#idrClose');
  await p.selectOption('#pfLens', 'model');
  await p.waitForTimeout(400);
  await p.click('.crow .btn-detail');
  await p.waitForTimeout(500);
  const provUnderModel = await p.$$eval('.factable .prov', e => e.map(x => x.textContent.trim()));
  check('under the model lens they go back to estimate',
        provUnderModel.filter(t => t === 'estimate').length >= 8,
        provUnderModel.slice(0, 4).join(','));

  await p.screenshot({ path: '/tmp/claude-0/-home-user-newTEST/d15e00e5-4a49-5a7f-8c3c-b0ad374c9e94/scratchpad/shot-tabs.png' });

  /* ---- The ledger's own sortable headings --------------------------------
     Same contract as the catalogue's: one sort state, reachable from the
     toolbar menu and from the headings, and the two never drift. */
  const LEDGER = 'http://127.0.0.1:8765/tracker/index.html';
  await p.goto(LEDGER, { waitUntil: 'networkidle' });
  await p.waitForTimeout(600);

  const marked = () => p.$eval('#listHead [data-sort].is-sorted',
                               n => n.dataset.sort + ':' + n.getAttribute('aria-sort'));
  const dayCells = () => p.$$eval('.show-row',
    n => n.map(x => (x.textContent.match(/[A-Z][a-z]{2}\s+\d{1,2}/) || [''])[0]));

  const keys = await p.$$eval('#listHead [data-sort]', n => n.map(x => x.dataset.sort));
  check('the ledger headings sort by date, deadline, status and rating',
        JSON.stringify(keys) === JSON.stringify(['date','deadline','status','rating']),
        keys.join(','));

  check('the sorted heading is marked on load', await marked() === 'date:ascending',
        await marked());

  /* Reversing has to move the list, not just the arrow. */
  const asc = await dayCells();
  await p.click('#listHead [data-sort="date"]');
  const desc = await dayCells();
  check('clicking the sorted heading reverses the list',
        await marked() === 'date:descending' && desc[0] === asc[asc.length - 1],
        asc[0] + ' -> ' + desc[0]);

  /* The direction each key opens in is chosen per key: earliest show first,
     but highest rating first. Opening rating ascending would put the work you
     rate worst at the top, which nobody wants to see. */
  await p.click('#listHead [data-sort="rating"]');
  check('rating opens highest-first rather than ascending',
        await marked() === 'rating:descending', await marked());
  check('the toolbar menu follows the headings',
        await p.$eval('#sortBy', n => n.value) === 'rating');

  await p.selectOption('#sortBy', 'status');
  check('and the headings follow the toolbar menu',
        await marked() === 'status:ascending', await marked());

  /* Alphabetically "accepted" precedes "applied", which is backwards for a
     pipeline. This asserts the order is the pipeline's, not the alphabet's. */
  const order = await p.evaluate(() => Array.from(document.querySelectorAll('.show-row'))
    .map(r => (r.textContent.match(/Interested|Applied|Accepted|Waitlist|Declined|Not applying/) || [''])[0])
    .filter(Boolean));
  const rank = { Interested:0, Applied:1, Accepted:2, Waitlist:3, Declined:4, 'Not applying':5 };
  check('status sorts down the pipeline, not the alphabet',
        order.length > 1 && order.every((v, i) => i === 0 || rank[order[i-1]] <= rank[v]),
        order.slice(0, 6).join(' > '));

  /* ---- Dark mode must not flash white between pages ----------------------
     data-theme is applied by an inline script in <head>. Before that existed
     Theme.init() ran after the body had painted with the light :root
     defaults, so every navigation flashed. Sampling from the first
     millisecond of the document is the only way to catch a regression: by
     load the attribute is correct either way. */
  await p.evaluate(() => localStorage.setItem('artShowTracker.theme', 'dark'));
  await p.addInitScript(() => {
    window.__themeSamples = [];
    const t = setInterval(() => {
      window.__themeSamples.push(document.documentElement.getAttribute('data-theme'));
      if (window.__themeSamples.length > 30) clearInterval(t);
    }, 1);
  });
  for (const page of ['browse.html', 'index.html', 'map.html']) {
    await p.goto('http://127.0.0.1:8765/tracker/' + page, { waitUntil: 'domcontentloaded' });
    const seen = await p.evaluate(() => window.__themeSamples || []);
    check('no flash of light mode on ' + page,
          seen.length > 0 && seen.every(v => v === 'dark'),
          [...new Set(seen)].join(',') + ' over ' + seen.length + ' samples');
  }

  console.log('\nerrors: ' + (errs.length ? errs.join(' | ') : 'none'));
  await b.close();
  console.log('\n' + pass + '/' + (pass + fails.length) + ' checks passed');
  if (fails.length) { console.log('FAILED:'); fails.forEach(f => console.log('  - ' + f)); process.exit(1); }
})();
