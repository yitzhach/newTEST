/* ==========================================================================
   Browser tests for the members' intel layer.

   Drives the real page in Chromium rather than asserting on functions in
   isolation: the things worth proving here — that changing discipline re-ranks
   the list, that an unscored factor says so instead of showing a five, that the
   tone check catches a rant and lets factual criticism through — only exist
   once the model, the data and the DOM are all in play.

   .cjs because the repo root is an ES module package and this is plain
   CommonJS.

   Usage:
     npm i -D playwright             # once
     python3 -m http.server 8765     # from the repo root
     node build/browser-tests.cjs
   ========================================================================== */
const { chromium } = require('playwright');

/* This sandbox ships Chromium at a pinned path and blocks the download
   Playwright would otherwise attempt. Unset PW_CHROMIUM and delete the file at
   that path and it falls back to Playwright's own resolution. */
const EXECUTABLE = process.env.PW_CHROMIUM ||
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = 'http://127.0.0.1:8765/tracker/browse.html';

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log((pass ? '  PASS  ' : '  FAIL  ') + name + (detail ? '  — ' + detail : ''));
}

(async () => {
  const browser = await chromium.launch(
    require('fs').existsSync(EXECUTABLE) ? { executablePath: EXECUTABLE } : {});
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });

  const errors = [];
  // Google Fonts and the favicon are blocked by this sandbox's egress proxy;
  // both resolve on the live site. Filter them so a real error stands out.
  const IGNORE = /fonts\.googleapis|fonts\.gstatic|favicon/;
  page.on('requestfailed', r => { if (!IGNORE.test(r.url())) errors.push('reqfail: ' + r.url()); });
  page.on('console', m => {
    if (m.type() !== 'error') return;
    if (/Failed to load resource/.test(m.text())) return;  // covered by requestfailed
    errors.push(m.text());
  });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  // ---- 1. boot clean -----------------------------------------------------
  check('page loads with no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  // ---- 2. catalogue size -------------------------------------------------
  const count = await page.textContent('#catCount');
  check('catalogue shows 236', /236/.test(count || ''), 'got: ' + count);

  // ---- 3. profile bar present -------------------------------------------
  const discOpts = await page.$$eval('#pfDiscipline option', els => els.map(e => e.value));
  check('ten disciplines in the picker', discOpts.length === 10, discOpts.join(','));
  check('no jewelry discipline', !discOpts.some(v => /jewel/i.test(v)));
  check('printmaking is its own discipline', discOpts.includes('printmaking'));
  check('wood and fiber present', discOpts.includes('wood') && discOpts.includes('fiber'));

  // ---- 4. default sort is fit -------------------------------------------
  const sortVal = await page.inputValue('#fSort');
  check('defaults to the fit ranking', sortVal === 'fit', 'got: ' + sortVal);

  // ---- 5. cards carry a fit chip ----------------------------------------
  const chips = await page.$$eval('.card .fitchip', els => els.slice(0, 5).map(e => e.textContent.trim()));
  check('cards render a fit score', chips.length === 5 && chips.every(c => /^\d\.\d$/.test(c)), chips.join(','));

  // ---- 6. top of the ranking matches the artist's calibration ------------
  const topNames = await page.$$eval('.card .card-name', els => els.slice(0, 4).map(e => e.textContent.trim()));
  check('La Quinta ranks first for painting', /La Quinta/i.test(topNames[0] || ''), topNames.join(' / '));

  // ---- 7. switching discipline re-ranks ---------------------------------
  const beforeChips = await page.$$eval('.card .fitchip', els => els.slice(0, 8).map(e => e.textContent.trim()));
  await page.selectOption('#pfDiscipline', 'glass');
  await page.waitForTimeout(400);
  const afterChips = await page.$$eval('.card .fitchip', els => els.slice(0, 8).map(e => e.textContent.trim()));
  check('changing discipline changes the scores',
        JSON.stringify(beforeChips) !== JSON.stringify(afterChips),
        'painting ' + beforeChips.slice(0,3) + ' -> glass ' + afterChips.slice(0,3));

  // ---- 8. price band re-ranks (Winter Park should climb at low prices) ---
  await page.selectOption('#pfDiscipline', 'printmaking');
  await page.selectOption('#pfBand', 'under_500');
  await page.waitForTimeout(400);
  const cheapTop = await page.$$eval('.card .card-name', els => els.slice(0, 12).map(e => e.textContent.trim()));
  const wpRankCheap = cheapTop.findIndex(n => /Winter Park/i.test(n));
  await page.selectOption('#pfDiscipline', 'sculpture');
  await page.selectOption('#pfBand', 'over_10000');
  await page.waitForTimeout(400);
  const richTop = await page.$$eval('.card .card-name', els => els.slice(0, 25).map(e => e.textContent.trim()));
  const wpRankRich = richTop.findIndex(n => /Winter Park/i.test(n));
  check('Winter Park ranks higher for cheap prints than dear sculpture',
        wpRankCheap !== -1 && (wpRankRich === -1 || wpRankCheap < wpRankRich),
        'prints/under-500 idx ' + wpRankCheap + ' vs sculpture/over-10k idx ' + wpRankRich);

  // ---- 9. list view + fit column ----------------------------------------
  await page.click('#btnViewRows');
  await page.waitForTimeout(300);
  const hasFitCol = await page.$('.rowhead.with-fit [data-sort="fit"]');
  check('list view has a sortable Fit column', !!hasFitCol);
  const rowChips = await page.$$eval('.crow .c-fit .fitchip', els => els.length);
  check('list rows carry fit chips', rowChips > 100, 'chips: ' + rowChips);

  // ---- 10. detail drawer -------------------------------------------------
  // Open a show that has NOT been through the research pass, so the
  // unscored-factor handling is actually exercised. Clear the open-deadline
  // filter first: many 2027 shows closed their 2026 applications already.
  await page.uncheck('#fOpen');
  await page.waitForTimeout(200);
  await page.fill('#fText', 'Bar Harbor');
  await page.waitForTimeout(300);
  await page.click('.crow .btn-detail');
  await page.waitForTimeout(400);
  const drawerOpen = await page.isVisible('.idr');
  check('detail drawer opens', drawerOpen);
  const drawerTitle = await page.textContent('.idr-head h2');
  const factorRows = await page.$$eval('.factable tbody tr', els => els.length);
  check('drawer lists all ten factors', factorRows === 10, 'rows: ' + factorRows);
  const unscored = await page.$$eval('.factable tr.is-unscored', els => els.length);
  check('unscored factors are marked, not faked', unscored > 0, 'unscored rows: ' + unscored);
  const provChips = await page.$$eval('.idr .prov', els => els.map(e => e.className));
  check('provenance chips render', provChips.length > 5, provChips.length + ' chips');
  const coverage = await page.textContent('.sd-conf');
  check('drawer states the coverage honestly', /% of your weighting/.test(coverage || ''), coverage);
  const notKnown = await page.$$eval('.facttable .unknown', els => els.length);
  check('unknown facts say so rather than showing a number', notKnown > 0, 'unknown fields: ' + notKnown);

  // A researched show should be scored on materially more of the weighting.
  await page.click('#idrClose');
  await page.fill('#fText', 'La Quinta');
  await page.waitForTimeout(300);
  await page.click('.crow .btn-detail');
  await page.waitForTimeout(400);
  const richConf = await page.textContent('.sd-conf');
  const richUnscored = await page.$$eval('.factable tr.is-unscored', els => els.length);
  check('a researched show is scored on all ten factors', richUnscored === 0, richConf);
  const srcLinks = await page.$$eval('.idr a.prov', els => els.length);
  check('researched facts carry clickable sources', srcLinks > 3, srcLinks + ' source links');
  await page.click('#idrClose');
  await page.fill('#fText', 'Bar Harbor');
  await page.waitForTimeout(300);
  await page.click('.crow .btn-detail');
  await page.waitForTimeout(400);

  // ---- 11. report form ---------------------------------------------------
  await page.click('#btnAddIntel');
  await page.waitForTimeout(400);
  const conduct = await page.textContent('.conduct');
  check('conduct standard shows at point of entry', /drama class/i.test(conduct || ''));
  const visOpts = await page.$$eval('.vis input[name="vis"]', els =>
    els.map(e => ({ v: e.value, disabled: e.disabled })));
  check('three visibility tiers offered', visOpts.length === 3, JSON.stringify(visOpts));
  check('sharing tiers disabled in solo mode',
        visOpts.filter(o => o.disabled).length === 2, JSON.stringify(visOpts));

  // ---- 12. net calculation ----------------------------------------------
  await page.fill('#f_grossSales', '12000');
  await page.fill('#f_boothFeePaid', '900');
  await page.fill('#f_travelCost', '600');
  await page.waitForTimeout(200);
  const net = await page.textContent('#netOut');
  check('net is computed from gross minus costs', /10,500/.test(net || ''), 'got: ' + net);

  // ---- 13. tone review ---------------------------------------------------
  await page.fill('#repNotes', 'The director is a crook and a liar. Absolute disgrace!!');
  await page.waitForTimeout(600);
  const toneVisible = await page.isVisible('#toneBox');
  const toneText = toneVisible ? await page.textContent('#toneBox') : '';
  check('conduct check flags a rant', toneVisible && /complaint/i.test(toneText), toneText.slice(0, 80));

  await page.fill('#repNotes', 'Jury results came three weeks after the published date, which made booking flights expensive. Load-in was on grass and it rained.');
  await page.waitForTimeout(600);
  const toneAfter = await page.isVisible('#toneBox');
  check('factual criticism passes clean', !toneAfter);

  // ---- 14. save a report and see it come back ---------------------------
  await page.fill('#f_piecesSold', '4');
  await page.click('#btnRepSave');
  await page.waitForTimeout(600);
  const savedOk = !(await page.isVisible('.idr'));
  check('report saves and closes the drawer', savedOk);

  const stored = await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('artShowTracker.intel') || '{}');
    return (db.reports || []).map(r => ({ gross: r.results.grossSales, vis: r.visibility, notes: !!r.notes }));
  });
  check('report persisted with the numbers', stored.length === 1 && stored[0].gross === 12000,
        JSON.stringify(stored));
  check('solo-mode report forced to private', stored[0] && stored[0].vis === 'private',
        stored[0] && stored[0].vis);

  // ---- 15. the saved report shows on the show ---------------------------
  await page.click('.crow .btn-detail');
  await page.waitForTimeout(500);
  const privSection = await page.textContent('.idr-body');
  check('private report listed under "your private notes"',
        /Your private notes/i.test(privSection) && /12,000/.test(privSection));
  check('a single report does not publish a consensus',
        /Nothing reported yet|report.? so far/i.test(privSection) || !/Median of/.test(privSection));

  // ---- 16. dark theme ----------------------------------------------------
  await page.click('#idrClose');
  await page.click('#btnTheme');
  await page.waitForTimeout(300);
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check('dark theme applies to the page', bg === 'rgb(15, 15, 15)', bg);
  await page.click('.crow .btn-detail');
  await page.waitForTimeout(400);
  const drawerBg = await page.evaluate(() => getComputedStyle(document.querySelector('.idr')).backgroundColor);
  check('drawer follows the dark theme', drawerBg === 'rgb(15, 15, 15)', drawerBg);
  await page.screenshot({ path: '/tmp/claude-0/-home-user-newTEST/d15e00e5-4a49-5a7f-8c3c-b0ad374c9e94/scratchpad/shot-dark-drawer.png' });
  await page.click('#idrClose');
  await page.click('#btnTheme');
  await page.waitForTimeout(300);
  await page.click('#btnViewCards');
  await page.waitForTimeout(300);
  await page.screenshot({ path: '/tmp/claude-0/-home-user-newTEST/d15e00e5-4a49-5a7f-8c3c-b0ad374c9e94/scratchpad/shot-light-list.png', fullPage: false });

  // ---- 17. network panel -------------------------------------------------
  await page.click('#btnNetwork');
  await page.waitForTimeout(300);
  const netTxt = await page.textContent('.idr-body');
  check('network panel explains solo mode', /Running solo/i.test(netTxt));

  console.log('\nlate console errors: ' + (errors.length ? errors.join(' | ') : 'none'));
  await browser.close();

  const failed = results.filter(r => !r.pass);
  console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed');
  if (failed.length) { console.log('FAILED:'); failed.forEach(f => console.log('  - ' + f.name + ' — ' + f.detail)); process.exit(1); }
})();
