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
  //
  // Both open-meteo hosts are blocked for the same reason, and their failure
  // is a tested behaviour rather than a defect — see the weather check below,
  // which asserts that the panel degrades to "not known" precisely because
  // these requests fail here. Filtering it keeps a real error visible.
  const IGNORE = /fonts\.googleapis|fonts\.gstatic|favicon|open-meteo/;
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
  /* 236 real shows plus the practice show, which is deliberately in the list
     rather than hidden behind a flag: an artist has to be able to find it. */
  check('catalogue shows 237', /237/.test(count || ''), 'got: ' + count);

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

  // ---- 10b. the commission gate scales with the price band ----------------
  // Kings Mountain is $100 to enter and takes 15% of everything you sell. A
  // model that only looks at booth fee calls that the cheapest show on the
  // circuit; for expensive work it is one of the dearest.
  await page.click('#idrClose');
  await page.fill('#fText', 'Kings Mountain');
  await page.waitForTimeout(300);
  await page.selectOption('#pfBand', 'under_500');
  await page.waitForTimeout(300);
  await page.click('.crow .btn-detail');
  await page.waitForTimeout(400);
  const cheapGate = await page.textContent('.gates');
  check('commission reads as a hint for cheap work',
        /15% commission/.test(cheapGate) && !!(await page.$('.gate-hint')),
        (cheapGate || '').trim().slice(0, 90));

  await page.click('#idrClose');
  await page.selectOption('#pfBand', 'over_10000');
  await page.waitForTimeout(300);
  await page.click('.crow .btn-detail');
  await page.waitForTimeout(400);
  const richGate = await page.textContent('.gates');
  check('commission escalates to a warning for expensive work',
        !!(await page.$('.gate-warning')) && /\$2,250/.test(richGate),
        (richGate || '').trim().slice(0, 90));

  await page.click('#idrClose');
  await page.selectOption('#pfBand', '2000_10000');
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
  /* Reports now live under a Yours / The network tab pair rather than a
     separate "your private notes" heading. Same guarantee, different shape:
     your own report is the default view and the network tab is empty. */
  const privSection = await page.textContent('.idr-body');
  check('your own report shows on the Yours tab',
        /Yours/.test(privSection) && /12,000/.test(privSection),
        (privSection || '').slice(0, 60));
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

  // ---- 18. date hygiene actually ships clean -----------------------------
  /* The build repairs impossible notify dates and stops on anything it cannot
     repair. These assert on the SHIPPED artifacts, which is the thing that
     matters — a rule that runs in the build but leaks into the JSON has not
     done its job. Both files are checked: catalogue.json is what the browser,
     the map and the ledger read, and it used to carry the defect too. */
  const hygiene = await page.evaluate(async () => {
    const bad = { fit: [], catalogue: [] };
    const fit = await (await fetch('fit-data.json')).json();
    for (const s of fit.shows) {
      const f = s.facts;
      if (f.applyBy && f.notifyDate && f.notifyDate < f.applyBy) bad.fit.push(s.id);
    }
    const cat = await (await fetch('catalogue.json')).json();
    for (const s of cat.shows) {
      if (s.applyBy && s.notifyDate && s.notifyDate < s.applyBy) bad.catalogue.push(s.id);
    }
    return {
      bad,
      total: fit.shows.length,
      located: fit.shows.filter(s => typeof s.facts.lat === 'number' &&
                                     typeof s.facts.lng === 'number').length,
      catalogueLocated: cat.shows.filter(s => typeof s.lat === 'number').length,
      provenance: fit.shows.filter(s => s.provenance && s.provenance.coordinates).length,
      boothFee: fit.shows.filter(s => s.facts.boothFee != null).length,
      boothDouble: fit.shows.filter(s => s.facts.boothFeeDouble != null).length,
      boothCorner: fit.shows.filter(s => s.facts.boothFeeCorner != null).length,
      // Structural nonsense the parser must never ship. A corner cheaper than
      // a plain booth is a surcharge that was read as a total; a double that
      // costs no more than a single is a misread. Both were real bugs.
      feeNonsense: fit.shows.filter(s => {
        const f = s.facts;
        return (f.boothFee && f.boothFeeCorner && f.boothFeeCorner < f.boothFee) ||
               (f.boothFee && f.boothFeeDouble && f.boothFeeDouble <= f.boothFee) ||
               // A free booth is a missing number, not a cheap show.
               [f.boothFee, f.boothFeeDouble, f.boothFeeCorner]
                 .some(v => v !== null && v !== undefined && v <= 0);
      }).length,
      jurySubs: fit.shows.filter(s => s.facts.avgSubmissionsPerYear != null).length,
      juryOdds: fit.shows.filter(s => s.factors.juryOdds != null).length,
      // Not mentioned is not zero. If this ever stops being 0, the importer
      // has started asserting a commission rate nobody published.
      fakeZeroCommission: fit.shows.filter(
        s => s.facts.commissionPct === 0 && s.facts.commissionNote).length,
      // Every booth fee has to be traceable to something a reader can check:
      // the fee-schedule line it was parsed out of, or the page it was read
      // from. Which of the two depends on which research pass found it.
      boothFeeUntraceable: fit.shows.filter(
        s => s.facts.boothFee != null &&
             !(s.provenance.boothFee &&
               (s.provenance.boothFee.basis || s.provenance.boothFee.source))).length
    };
  });
  check('no notify date precedes its own deadline in fit-data',
        hygiene.bad.fit.length === 0, hygiene.bad.fit.join(','));
  check('no notify date precedes its own deadline in catalogue.json',
        hygiene.bad.catalogue.length === 0, hygiene.bad.catalogue.join(','));

  // ---- 19. geocode coverage ----------------------------------------------
  /* 234 of 236. The two without coordinates hold a region rather than a city
     in their city column, and are deliberately left null rather than guessed;
     if that number moves, the gazetteer pass needs re-reading, not silencing. */
  check('all but two shows carry coordinates',
        hygiene.located >= 235 && hygiene.total === 237,
        hygiene.located + '/' + hygiene.total);
  check('coordinates reach catalogue.json too',
        hygiene.catalogueLocated === hygiene.located,
        hygiene.catalogueLocated + ' vs ' + hygiene.located);
  check('every coordinate carries provenance',
        hygiene.provenance === hygiene.located,
        hygiene.provenance + ' provenance entries for ' + hygiene.located + ' coordinates');

  // ---- 19b. the ZAPPlication research pass ------------------------------
  /* Booth fee coverage was 24/236 before this import and blocks the whole of
     Phase 2 costing, so it is worth asserting rather than assuming. */
  check('booth fee coverage is at least 175 shows',
        hygiene.boothFee >= 175, hygiene.boothFee + '/236');
  check('jury statistics landed on 200 shows',
        hygiene.jurySubs >= 200, hygiene.jurySubs + '/236');
  check('jury odds are scored from those statistics',
        hygiene.juryOdds >= 215, hygiene.juryOdds + '/236');
  check('every booth fee is traceable to a line or a page',
        hygiene.boothFeeUntraceable === 0, hygiene.boothFeeUntraceable + ' untraceable');
  check('"no commission mentioned" is never recorded as 0%',
        hygiene.fakeZeroCommission === 0, hygiene.fakeZeroCommission + ' shows');
  check('double and corner rates were read too',
        hygiene.boothDouble >= 80 && hygiene.boothCorner >= 80,
        hygiene.boothDouble + ' double, ' + hygiene.boothCorner + ' corner');
  check('no corner cheaper than its single, no double at or below it',
        hygiene.feeNonsense === 0, hygiene.feeNonsense + ' impossible fee sets');

  // ---- 20. a closed deadline is surfaced, not ranked as live -------------
  await page.click('#idrClose');
  await page.uncheck('#fOpen');            // closed shows are hidden by default
  await page.fill('#fText', 'Bar Harbor Fine Arts Festival II');
  await page.waitForTimeout(400);
  const closed = await page.evaluate(() => {
    const el = document.querySelector('.card[data-id="zapp-13837"], .crow[data-id="zapp-13837"]');
    return el ? { found: true, isClosed: el.classList.contains('is-closed') } : { found: false };
  });
  check('a show whose deadline has passed is marked closed in the list',
        closed.found && closed.isClosed, JSON.stringify(closed));

  await page.click('[data-detail="zapp-13837"]');
  await page.waitForTimeout(500);
  const closedDrawer = await page.textContent('.idr-body');
  check('the drawer says the application window has closed',
        /Applications closed on/i.test(closedDrawer) || /This edition is over/i.test(closedDrawer),
        (closedDrawer || '').slice(0, 80));

  // ---- 21. the show's coordinates are shown with their source ------------
  check('the drawer shows coordinates with a dataset chip',
        /Coordinates/.test(closedDrawer) && /city centre/.test(closedDrawer));

  // ---- 22. sales tax: state-only, never a combined rate ------------------
  /* The whole risk of this feature is an artist reading one number and
     collecting it. These assert the guard rails rather than the rate. */
  const taxPanel = await page.evaluate(() => {
    const heads = [...document.querySelectorAll('.idr-body .sd-h')];
    const h = heads.find(x => /Sales tax/i.test(x.textContent));
    const box = h && h.nextElementSibling;
    return box ? { text: box.textContent, links: [...box.querySelectorAll('a')].map(a => a.href) } : null;
  });
  check('the sales tax panel renders for a state in the table', !!taxPanel);
  check('it says the rate is state-only',
        !!taxPanel && /State rate only/i.test(taxPanel.text));
  check('it names local taxes as extra and not included',
        !!taxPanel && /not included here/i.test(taxPanel.text));
  check('it says plainly that it is not tax advice',
        !!taxPanel && /not tax advice/i.test(taxPanel.text));
  check('it links out to the issuing authority',
        !!taxPanel && taxPanel.links.some(u => /maine\.gov/.test(u)),
        taxPanel && taxPanel.links.join(' '));

  // ---- 23. weather degrades to "not known" when the API is unreachable ---
  /* This sandbox blocks both open-meteo hosts, which makes it the ideal
     place to prove the failure path: a dead provider must read as "not known",
     never as a broken panel or a fabricated average. */
  await page.waitForTimeout(1200);
  const wx = await page.evaluate(() => {
    const el = document.querySelector('#wxPanel');
    return el ? el.textContent.trim() : null;
  });
  check('the weather panel exists', wx !== null);
  check('an unreachable weather API degrades to "not known"',
        !!wx && /not known/i.test(wx), wx);
  check('it does not invent a number when the lookup failed',
        !!wx && !/\d+%/.test(wx) && !/\u00b0F/.test(wx), wx);

  // ---- 24. the jury numbers reach the drawer ----------------------------
  await page.click('#idrClose');
  await page.fill('#fText', 'Art on the Fox Algonquin');
  await page.waitForTimeout(400);
  await page.click('[data-detail="zapp-13982"]');
  await page.waitForTimeout(500);
  const gettingIn = await page.evaluate(() => {
    const heads = [...document.querySelectorAll('.idr-body .sd-h')];
    const h = heads.find(x => /Getting in/i.test(x.textContent));
    if (!h) return null;
    let text = '', node = h.nextElementSibling;
    while (node && node.tagName !== 'H3') { text += ' ' + node.textContent; node = node.nextElementSibling; }
    return text;
  });
  check('the drawer has a "Getting in" section', gettingIn !== null);
  check('it shows how many apply and how many get in',
        !!gettingIn && /100/.test(gettingIn) && /65/.test(gettingIn),
        (gettingIn || '').slice(0, 90));
  /* The number that makes the exempt count worth collecting: 65 of 100 looks
     generous until you learn 20 of those places never faced the jury. */
  check('it discounts places that never faced the jury',
        !!gettingIn && /exempt from the jury/i.test(gettingIn) && /45/.test(gettingIn),
        (gettingIn || '').slice(0, 140));

  const drawerText = await page.textContent('.idr-body');
  check('the full fee schedule is available verbatim',
        /full fee schedule/i.test(drawerText));

  // ---- 25. the booth fee box -------------------------------------------
  await page.click('#idrClose');
  await page.fill('#fText', '');
  await page.waitForTimeout(300);
  const feeBox = async (id) => {
    await page.evaluate(i => document.querySelector(`[data-detail="${i}"]`)?.click(), id);
    await page.waitForTimeout(600);
    const t = await page.evaluate(() => {
      const h = [...document.querySelectorAll('.idr-body .sd-h')]
        .find(x => /Booth fees/i.test(x.textContent));
      if (!h) return null;
      let out = '', n = h.nextElementSibling;
      while (n && n.tagName !== 'H3') { out += ' ' + n.textContent.replace(/\s+/g, ' '); n = n.nextElementSibling; }
      return out;
    });
    await page.click('#idrClose');
    await page.waitForTimeout(200);
    return t;
  };

  const allThree = await feeBox('zapp-13866');
  check('the booth fee box shows single, double and corner',
        !!allThree && /\$600.*single/.test(allThree) && /\$1,200.*double/.test(allThree) &&
        /\$700.*corner/.test(allThree), (allThree || '').slice(0, 80));

  /* This show quotes the corner as "Corner upgrade: $100" on a $300 booth.
     The box must show $400 — what actually leaves your bank account — not
     the surcharge on its own. */
  const upgrade = await feeBox('zapp-13825');
  check('a corner quoted as a surcharge is shown as a total',
        !!upgrade && /\$400.*corner/.test(upgrade), (upgrade || '').slice(0, 80));

  /* This show quotes $550 for a 10' space and $1,100 for a 20' one, plus two
     unlabelled tiers the page never calls corners — so the corner is the rate
     that stays unknown, and it has to say so rather than render an empty slot. */
  const partial = await feeBox('zapp-14594');
  check('unknown rates read n/a rather than blank',
        !!partial && /n\/a.*corner/.test(partial), (partial || '').slice(0, 80));
  check('commission shows what the page said, not a fabricated 0%',
        /No commission mentioned/i.test(drawerText) && !/\b0% of sales/.test(drawerText));

  // ---- 26. weather renders a card per show day --------------------------
  /* This sandbox has no egress, which is why the checks above assert the
     failure path. To exercise the success path the provider is stubbed: the
     stub answers with the shape Open-Meteo actually returns, so what is
     tested is this code's reading and rendering of it, not the network. */
  await page.route('**/*open-meteo.com/**', route => {
    const u = new URL(route.request().url());
    const from = u.searchParams.get('start_date');
    const to = u.searchParams.get('end_date');
    const time = [];
    for (let d = new Date(from + 'T00:00:00'); d <= new Date(to + 'T00:00:00');
         d.setDate(d.getDate() + 1)) {
      time.push(d.toISOString().slice(0, 10));
    }
    const n = time.length;
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ daily: {
        time,
        weather_code: time.map(() => 0),          // clear
        temperature_2m_max: time.map(() => 76),
        temperature_2m_min: time.map(() => 50),
        wind_speed_10m_max: time.map(() => 22),   // over the canopy threshold
        precipitation_sum: time.map(() => 0)
      }})
    });
  });

  const weatherFor = async (id) => {
    await page.evaluate(() => {
      Object.keys(localStorage)
        .filter(k => k.startsWith('artShowTracker.weather'))
        .forEach(k => localStorage.removeItem(k));
    });
    await page.evaluate(i => document.querySelector(`[data-detail="${i}"]`)?.click(), id);
    await page.waitForTimeout(1800);
    const t = await page.evaluate(() => {
      const el = document.querySelector('#wxPanel');
      return el ? el.textContent.replace(/\s+/g, ' ').trim() : null;
    });
    const cards = await page.evaluate(() => document.querySelectorAll('.wx-day').length);
    await page.click('#idrClose');
    await page.waitForTimeout(200);
    return { t, cards };
  };

  await page.click('#idrClose').catch(() => {});
  await page.fill('#fText', '');
  await page.waitForTimeout(300);

  /* Bar Harbor runs 11-13 September 2026 — inside the forecast horizon from
     the date this data was built, so it must take the forecast path. */
  const soon = await weatherFor('zapp-13837');
  check('weather renders one card per show day',
        soon.cards === 3, soon.cards + ' cards');
  check('each card carries a high, a low and a wind speed',
        !!soon.t && /76/.test(soon.t) && /50/.test(soon.t) && /22 mph/.test(soon.t),
        (soon.t || '').slice(0, 90));
  check('a windy day is called out',
        !!soon.t && /canopy weather/i.test(soon.t), (soon.t || '').slice(0, 90));
  check('a near show says it is the real forecast',
        !!soon.t && /actual forecast/i.test(soon.t), (soon.t || '').slice(0, 70));

  /* The practice show is in January 2027, far outside the horizon, so it must
     fall back to the ten-year record and say so. */
  const far = await weatherFor('test-seattle');
  check('a distant show falls back to the historical record',
        !!far.t && /not a forecast/i.test(far.t), (far.t || '').slice(0, 90));
  check('and still renders a card per day', far.cards === 2, far.cards + ' cards');

  await page.unroute('**/*open-meteo.com/**');

  // ---- 27. which build is this ------------------------------------------
  /* The question that cost more time on this project than any feature. The
     page must be able to answer it without anybody reading behaviour. */
  const stamp = await page.evaluate(() => {
    const el = document.querySelector('#buildStamp');
    return el ? el.textContent.trim() : null;
  });
  check('the page states which build it is',
        !!stamp && /^v\d{4}\.\d{2}\.\d{2}-\d{4}/.test(stamp), stamp);
  /* Built and published are different states, and a build that has not been
     deployed has to say so rather than implying it is live. */
  check('it distinguishes built from published',
        !!stamp && /(published|not published yet)/.test(stamp), stamp);

  const version = await page.evaluate(async () => {
    const r = await fetch('version.json', { cache: 'no-cache' });
    return r.ok ? r.json() : null;
  });
  check('version.json is readable without opening the app', !!version);
  check('it records the build, the assets and the show count',
        !!version && !!version.version && !!version.assetVersion && version.shows > 0,
        JSON.stringify(version && { v: version.version, shows: version.shows }));
  /* The keys the deploy fills in must exist even before it runs, so their
     absence is never mistaken for an older file that lacks the feature. */
  check('the deploy fields are present before deployment',
        !!version && 'commit' in version && 'deployedAt' in version);

  console.log('\nlate console errors: ' + (errors.length ? errors.join(' | ') : 'none'));
  await browser.close();

  const failed = results.filter(r => !r.pass);
  console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed');
  if (failed.length) { console.log('FAILED:'); failed.forEach(f => console.log('  - ' + f.name + ' — ' + f.detail)); process.exit(1); }
})();
