/* ==========================================================================
   Browser tests for the calendar.

   Two halves, deliberately:
     1. The MODEL (calendar.js) — evaluated directly in the page. Grid shape,
        lane packing, clash detection, the day layout, the .ics text. This is
        the half a phone app would reuse, so it is tested without the DOM.
     2. The PAGE — that the views render, that a bar opens a popover, that an
        event round-trips through the store and survives a reload.

   Usage:
     python3 -m http.server 8765     # from the repo root
     node build/calendar-tests.cjs
   ========================================================================== */
const { chromium } = require('playwright');

const EXECUTABLE = process.env.PW_CHROMIUM ||
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const BASE = 'http://127.0.0.1:8765/tracker/calendar.html';
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
  await p.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(500);
  check('page boots clean', errs.length === 0, errs.slice(0, 2).join(' | '));

  /* ======================================================================
     1. THE MODEL
     ====================================================================== */

  // ---- grid shape ------------------------------------------------------
  const grid = await p.evaluate(() => {
    const g = window.ASTCalendar.monthGrid(2027, 0);   // January 2027
    return { rows: g.length, cols: g[0].length, first: g[0][0].iso,
             firstDow: g[0][0].dow, last: g[5][6].iso,
             inMonth: g.flat().filter(c => c.inMonth).length };
  });
  check('month grid is always six weeks', grid.rows === 6 && grid.cols === 7,
        grid.rows + 'x' + grid.cols);
  check('grid starts on a Sunday', grid.firstDow === 0, String(grid.firstDow));
  check('Jan 2027 grid starts Dec 27 and holds 31 days of the month',
        grid.first === '2026-12-27' && grid.inMonth === 31,
        grid.first + ' / ' + grid.inMonth);

  // ---- date arithmetic across a month and a year boundary --------------
  const dates = await p.evaluate(() => {
    const C = window.ASTCalendar;
    return { over: C.addDays('2027-01-31', 1), back: C.addDays('2027-01-01', -1),
             span: C.daysBetween('2027-01-09', '2027-01-11'),
             leap: C.addDays('2028-02-28', 1) };
  });
  check('addDays crosses a month boundary', dates.over === '2027-02-01', dates.over);
  check('addDays crosses a year boundary backwards', dates.back === '2026-12-31', dates.back);
  check('daysBetween is inclusive-exclusive as documented', dates.span === 2, String(dates.span));
  check('leap year is respected', dates.leap === '2028-02-29', dates.leap);

  // ---- multi-day shows become ONE bar ----------------------------------
  const packed = await p.evaluate(() => {
    const C = window.ASTCalendar;
    const items = [
      { id:'a', layer:'ledger', title:'Three-day show', start:'2027-01-08', end:'2027-01-10',
        allDay:true, startTime:'', status:'accepted', committed:true },
      { id:'b', layer:'ledger', title:'Same weekend',   start:'2027-01-09', end:'2027-01-09',
        allDay:true, startTime:'', status:'applied', committed:true }
    ];
    const week = C.monthGrid(2027, 0)[1];              // Jan 3-9
    const r = C.packWeek(items, week);
    return { n: r.segments.length, lanes: r.lanes,
             spans: r.segments.map(s => [s.item.id, s.col, s.span, s.lane,
                                         s.continuesRight]) };
  });
  check('a three-day show is one segment, not three chips', packed.n === 2, String(packed.n));
  check('a show running past the week edge is clipped and flagged',
        JSON.stringify(packed.spans[0]) === JSON.stringify(['a', 5, 2, 0, true]),
        JSON.stringify(packed.spans[0]));
  check('overlapping bars land in different lanes',
        packed.lanes === 2 && packed.spans[1][3] === 1, JSON.stringify(packed.spans));

  // ---- your own schedule outranks catalogue context for the top lane ----
  const laneOrder = await p.evaluate(() => {
    const C = window.ASTCalendar;
    const items = [
      { id:'res', layer:'catalogue', title:'Month-long residency', start:'2027-01-01',
        end:'2027-01-31', allDay:true, startTime:'', status:'' },
      { id:'mine', layer:'ledger', title:'My show', start:'2027-01-09', end:'2027-01-09',
        allDay:true, startTime:'', status:'accepted', committed:true }
    ];
    const r = C.packWeek(items, C.monthGrid(2027, 0)[1]);
    return r.segments.map(s => [s.item.id, s.lane]);
  });
  check('a long catalogue bar never outranks a show you are doing',
        JSON.stringify(laneOrder) === '[["mine",0],["res",1]]', JSON.stringify(laneOrder));

  // ---- clash detection --------------------------------------------------
  const clash = await p.evaluate(() => {
    const C = window.ASTCalendar;
    const mk = (id, s, e, status) => ({ id, layer:'ledger', title:id, start:s, end:e,
      allDay:true, startTime:'', status, committed: C.COMMITTED.indexOf(status) !== -1 });
    const both = C.clashes([mk('x','2027-01-09','2027-01-10','accepted'),
                            mk('y','2027-01-10','2027-01-11','applied')]);
    const idle = C.clashes([mk('x','2027-01-09','2027-01-10','accepted'),
                            mk('y','2027-01-10','2027-01-11','interested')]);
    const apart = C.clashes([mk('x','2027-01-09','2027-01-09','accepted'),
                             mk('y','2027-01-10','2027-01-10','accepted')]);
    const days = Object.keys(C.clashDays([mk('x','2027-01-09','2027-01-11','accepted'),
                                          mk('y','2027-01-10','2027-01-12','accepted')])).sort();
    return { both: both.length, idle: idle.length, apart: apart.length, days };
  });
  check('two committed shows on one day clash', clash.both === 1, String(clash.both));
  check('an "interested" show is not a clash', clash.idle === 0, String(clash.idle));
  check('adjacent shows do not clash', clash.apart === 0, String(clash.apart));
  check('a clash marks only the days actually shared',
        JSON.stringify(clash.days) === '["2027-01-10","2027-01-11"]', JSON.stringify(clash.days));

  // ---- the catalogue layer never duplicates a show you already have -----
  const dedupe = await p.evaluate(() => {
    const C = window.ASTCalendar;
    const items = C.build({
      shows: [{ id:'s1', name:'Naples', startDate:'2027-01-02', endDate:'2027-01-03',
                status:'accepted', catalogueId:'zapp-1', city:'Naples', state:'FL' }],
      catalogue: [{ id:'zapp-1', name:'Naples', startDate:'2027-01-02', endDate:'2027-01-03' },
                  { id:'zapp-2', name:'Other',  startDate:'2027-01-02', endDate:'2027-01-02' }],
      events: [],
      layers: { ledger:true, catalogue:true, personal:true }
    });
    return items.map(i => i.id);
  });
  check('a show in your ledger is not drawn twice from the catalogue',
        dedupe.length === 2 && dedupe.indexOf('catalogue:zapp-1') === -1, dedupe.join(','));

  // ---- undated rows are dropped, never parked on today ------------------
  const undated = await p.evaluate(() => window.ASTCalendar.build({
    shows: [{ id:'s', name:'No date', startDate:'', status:'interested' }],
    catalogue: [], events: [], layers:{ ledger:true, catalogue:false, personal:true }
  }).length);
  check('a show with no date does not appear on any day', undated === 0, String(undated));

  // ---- day layout -------------------------------------------------------
  const day = await p.evaluate(() => {
    const C = window.ASTCalendar;
    const items = [
      { id:'ad', layer:'ledger',   title:'Show', start:'2027-01-09', end:'2027-01-09',
        allDay:true, startTime:'' },
      { id:'t1', layer:'personal', title:'Load in', start:'2027-01-09', end:'2027-01-09',
        allDay:false, startTime:'09:00', endTime:'11:00' },
      { id:'t2', layer:'personal', title:'Overlap', start:'2027-01-09', end:'2027-01-09',
        allDay:false, startTime:'10:00', endTime:'12:00' },
      { id:'t3', layer:'personal', title:'No end', start:'2027-01-09', end:'2027-01-09',
        allDay:false, startTime:'15:00', endTime:'' }
    ];
    const l = C.dayLayout(items, '2027-01-09');
    return { allDay: l.allDay.length, timed: l.timed.length,
             lanes: l.timed.map(t => [t.item.id, t.lane, t.lanes]),
             noEnd: l.timed.filter(t => t.item.id === 't3')[0] };
  });
  check('all-day items go to the band, not the hour grid',
        day.allDay === 1 && day.timed === 3, day.allDay + '/' + day.timed);
  check('overlapping timed blocks sit side by side',
        JSON.stringify(day.lanes[0]) === '["t1",0,2]' && JSON.stringify(day.lanes[1]) === '["t2",1,2]',
        JSON.stringify(day.lanes));
  check('a timed event with no end gets a usable 60-minute block',
        day.noEnd.endMin - day.noEnd.startMin === 60,
        String(day.noEnd.endMin - day.noEnd.startMin));

  // ---- ICS --------------------------------------------------------------
  const ics = await p.evaluate(() => {
    const C = window.ASTCalendar;
    const items = C.build({
      shows: [{ id:'s1', name:'Naples; Art, Fair', city:'Naples', state:'FL',
                startDate:'2027-01-02', endDate:'2027-01-03', status:'accepted' }],
      catalogue: [],
      events: [{ id:'e1', kind:'travel', title:'Drive down', startDate:'2027-01-01',
                 endDate:'2027-01-01', allDay:false, startTime:'08:00', endTime:'14:00',
                 location:'I-75', notes:'', reminders:[{ minutesBefore:1440, channel:'email' }],
                 deletedAt:null }],
      layers:{ ledger:true, catalogue:false, personal:true }
    });
    return C.toICS(items, { name: 'Test' });
  });
  check('ics is a well-formed calendar with CRLF endings',
        ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.trim().endsWith('END:VCALENDAR'),
        JSON.stringify(ics.slice(0, 24)));
  check('ics holds one VEVENT per item',
        (ics.match(/BEGIN:VEVENT/g) || []).length === 2,
        String((ics.match(/BEGIN:VEVENT/g) || []).length));
  check('an all-day DTEND is exclusive, so a 2-day show ends on the 4th',
        /DTSTART;VALUE=DATE:20270102/.test(ics) && /DTEND;VALUE=DATE:20270104/.test(ics));
  check('a timed event writes real times',
        /DTSTART:20270101T080000/.test(ics) && /DTEND:20270101T140000/.test(ics));
  check('semicolons and commas in a title are escaped',
        ics.indexOf('SUMMARY:Naples\\; Art\\, Fair') !== -1,
        (ics.match(/SUMMARY:Naples.*/) || [''])[0]);
  check('a stored reminder becomes a VALARM the importing app can fire',
        /BEGIN:VALARM/.test(ics) && /TRIGGER:-PT1440M/.test(ics));
  check('no ics line exceeds the 75-octet fold limit',
        ics.split('\r\n').every(l => l.length <= 75),
        String(Math.max(...ics.split('\r\n').map(l => l.length))));

  /* ======================================================================
     2. THE PAGE
     ====================================================================== */

  /* The seed season is Jan-Apr 2027 and today is not, so go where the shows
     are — through the URL, which is also the deep-link the page supports. */
  await p.goto(BASE + '#2027-01-09/month', { waitUntil: 'networkidle' });
  // A hash-only change does not re-run the page, so make it a real load.
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(600);
  check('a date in the URL opens that month',
        /January/.test(await p.textContent('#calTitle')),
        await p.textContent('#calTitle'));

  await p.click('.cal-views [data-view="year"]');
  await p.waitForTimeout(200);
  check('year view draws twelve months',
        (await p.$$('.cal-ycard')).length === 12);

  await p.click('.cal-views [data-view="month"]');
  await p.waitForTimeout(200);
  check('month view draws a six-week grid',
        (await p.$$('.cal-week')).length === 6);
  check('the weekday header is present', (await p.$$('.cal-dows div')).length === 7);

  // ---- layer switches ----------------------------------------------------
  const layerBoxes = await p.$$eval('.cal-layer input', els =>
    els.map(e => [e.dataset.layer, e.checked]));
  check('three layers, catalogue off by default',
        JSON.stringify(layerBoxes) === '[["ledger",true],["catalogue",false],["personal",true]]',
        JSON.stringify(layerBoxes));

  // The checkbox itself is visually hidden behind a custom switch, so drive
  // the label — which is also what a real pointer or a screen reader does.
  await p.click('[data-layer-row="catalogue"]');
  await p.waitForTimeout(1200);      // catalogue.json has to load
  const catBars = await p.$$eval('.cal-bar.l-catalogue', els => els.length);
  check('switching the catalogue on draws catalogue bars', catBars > 0, String(catBars));
  check('catalogue bars stay visually distinct from your own',
        await p.$eval('.cal-bar.l-catalogue',
          el => getComputedStyle(el).borderStyle === 'dashed'));
  await p.click('[data-layer-row="catalogue"]');
  await p.waitForTimeout(400);
  check('switching it off removes them',
        (await p.$$('.cal-bar.l-catalogue')).length === 0);

  // ---- creating an event round-trips ------------------------------------
  await p.click('#btnNew');
  await p.waitForTimeout(200);
  check('the + opens a compose sheet', await p.isVisible('.cal-sheet'));
  await p.fill('#evTitle', 'Load in at dawn');
  await p.fill('#evStart', '2027-01-09');
  await p.fill('#evEnd', '2027-01-09');
  await p.uncheck('#evAllDay');
  await p.fill('#evFrom', '06:30');
  await p.fill('#evTo', '08:00');
  await p.selectOption('#evRemind', '1440');
  await p.click('[data-sheet="save"]');
  await p.waitForTimeout(400);
  check('the sheet closes on save', (await p.$$('.cal-sheet')).length === 0);

  const stored = await p.evaluate(async () => {
    const rows = await window.AST.Store.listEvents();
    return rows.map(r => ({ t:r.title, s:r.startDate, at:r.startTime,
                            allDay:r.allDay, rem:r.reminders.length }));
  });
  check('the event is stored with its time and reminder',
        stored.length === 1 && stored[0].t === 'Load in at dawn' &&
        stored[0].at === '06:30' && stored[0].allDay === false && stored[0].rem === 1,
        JSON.stringify(stored));

  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(500);
  const survived = await p.evaluate(async () =>
    (await window.AST.Store.listEvents()).length);
  check('it survives a reload', survived === 1, String(survived));

  // ---- the schema migration keeps existing databases intact --------------
  const migrated = await p.evaluate(() => {
    const A = window.AST;
    const old = { schemaVersion: 3, shows: [{ id:'x', name:'Old show', startDate:'2027-01-02' }] };
    const up = A.migrate(old);
    return { v: up.schemaVersion, shows: up.shows.length, events: Array.isArray(up.events) };
  });
  check('a v3 database migrates to v4 and gains an empty calendar',
        migrated.v === 4 && migrated.shows === 1 && migrated.events === true,
        JSON.stringify(migrated));

  // ---- clicking a bar opens the quick look ------------------------------
  await p.click('.cal-views [data-view="day"]');
  await p.waitForTimeout(200);
  check('day view draws 24 hours', (await p.$$('.cal-hour')).length === 24);

  await p.click('.cal-views [data-view="month"]');
  await p.waitForTimeout(300);
  const anyBar = await p.$('.cal-bar');
  if (anyBar) {
    await anyBar.click();
    await p.waitForTimeout(250);
    check('clicking a bar opens the quick look', await p.isVisible('.cal-pop'));
    check('the quick look names which layer it came from',
          /My schedule|Catalogue|Personal/.test(await p.textContent('.cal-pop .layer-tag')));
    await p.keyboard.press('Escape');
    await p.waitForTimeout(150);
    check('Escape closes it', (await p.$$('.cal-pop')).length === 0);
  } else {
    check('clicking a bar opens the quick look', false, 'no bar rendered to click');
  }

  // ---- the honesty rules -------------------------------------------------
  await p.click('#btnConnect');
  await p.waitForTimeout(250);
  const stubs = await p.$$eval('.cal-stub .btn', els =>
    els.map(e => [e.textContent.trim(), e.disabled]));
  check('every connect control is visibly disabled, and the export is not',
        stubs.filter(s => s[1]).length === 7 && stubs.filter(s => !s[1]).length === 1,
        JSON.stringify(stubs));
  check('the panel says plainly that nothing is connected',
        /Nothing here is connected yet/i.test(await p.textContent('.cal-sheet .body')));
  check('it points at the export as the path that does work',
        /Export \.ics works today/i.test(await p.textContent('.cal-sheet .body')));
  await p.keyboard.press('Escape');

  // ---- no reminder is ever claimed to have been sent ---------------------
  const remindWording = await p.evaluate(() => {
    const C = window.ASTCalendar;
    return { channels: C.CHANNELS.every(c => c.connected === false),
             providers: C.PROVIDERS.every(pr => pr.connected === false),
             any: C.anyConnected() };
  });
  check('no channel or provider claims to be connected',
        remindWording.channels && remindWording.providers && remindWording.any === false,
        JSON.stringify(remindWording));

  check('no page errors through the whole run', errs.length === 0, errs.slice(0, 3).join(' | '));

  console.log('\n  ' + pass + ' passed, ' + fails.length + ' failed');
  if (fails.length) { fails.forEach(f => console.log('   - ' + f)); }
  await b.close();
  process.exit(fails.length ? 1 : 0);
})();
