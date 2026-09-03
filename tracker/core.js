/* ==========================================================================
   Art Show Tracker — shared core
   Model, Store adapter, date/format helpers and theme, used by both
   tracker/index.html (the ledger) and tracker/map.html (full-page map).

   Deliberately a CLASSIC script, not an ES module: `type="module"` is
   blocked by CORS on file:// URLs, and the whole point of this app is that
   it opens by double-click with no build step. It publishes one global,
   `window.AST`.
   ========================================================================== */
window.AST = (function () {
  'use strict';

  /* ---- 1. MODEL + CONSTANTS --------------------------------------------- */
  var SCHEMA_VERSION = 1;
  var DB_KEY = 'artShowTracker.db';
  var THEME_KEY = 'artShowTracker.theme';

  var STATUSES = [
    { value:'interested',   label:'Interested' },
    { value:'applied',      label:'Applied' },
    { value:'accepted',     label:'Accepted' },
    { value:'waitlist',     label:'Waitlist' },
    { value:'declined',     label:'Declined' },
    { value:'not_applying', label:'Not applying' }
  ];
  var STATUS_LABEL = Object.fromEntries(STATUSES.map(function (s) { return [s.value, s.label]; }));

  function newId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  /** Every record that enters the app goes through here, so the shape is one thing. */
  function makeShow(input) {
    input = input || {};
    var now = new Date().toISOString();
    return {
      id: input.id || newId(),
      name: input.name || '',
      city: input.city || '',
      state: input.state || '',
      lat: numOrNull(input.lat),
      lng: numOrNull(input.lng),
      startDate: input.startDate || '',
      endDate: input.endDate || '',
      applyBy: input.applyBy || '',
      status: STATUS_LABEL[input.status] ? input.status : 'interested',
      rating: clampRating(input.rating),
      juryFee: numOrNull(input.juryFee),
      boothFee: numOrNull(input.boothFee),
      routeNumber: input.routeNumber == null ? '' : String(input.routeNumber),
      isAlternate: !!input.isAlternate,
      notes: input.notes || '',
      url: input.url || '',
      source: ['manual','zapp_paste','csv'].indexOf(input.source) !== -1 ? input.source : 'manual',
      createdAt: input.createdAt || now,
      updatedAt: input.updatedAt || now
    };
  }
  function numOrNull(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  function clampRating(v) {
    var n = Math.round(Number(v));
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.min(10, n);
  }

  /* ---- 2. SEED — Isaac's 2027 Florida season ----------------------------
     Stops 1-7 as signed off in design/Main.dc.html. Later stops (8-12,
     through Apr 18) are not in the repo docs yet; add them in the drawer.  */
  var SEED = [
    ['1',  "Naples New Year's Art Fair",        'Naples','FL',          26.1420,-81.7948,'2027-01-02','2027-01-03','',           'accepted',   false],
    ['2a', 'Bonita Springs National — Show 1',  'Bonita Springs','FL',  26.3398,-81.7787,'2027-01-09','2027-01-10','2026-09-15','applied',    false],
    ['2b', 'Las Olas Art Fair Part I',          'Fort Lauderdale','FL', 26.1224,-80.1373,'2027-01-09','2027-01-10','2026-10-01','not_applying',true],
    ['3',  'Beaux Arts Festival of Art',        'Coral Gables','FL',    25.7215,-80.2684,'2027-01-16','2027-01-17','2026-09-30','applied',    false],
    ['4',  'IMAGES: A Festival of the Arts',    'New Smyrna Beach','FL',29.0258,-80.9270,'2027-01-22','2027-01-24','2026-10-12','interested', false],
    ['5',  'St. Armands Circle Art Festival',   'Sarasota','FL',        27.3206,-82.5760,'2027-01-30','2027-01-31','2026-11-03','interested', false],
    ['6a', 'Boca Raton Museum Art Festival',    'Boca Raton','FL',      26.3683,-80.1289,'2027-02-06','2027-02-07','2026-09-23','waitlist',   false],
    ['6b', 'ArtiGras Fine Arts Festival',       'Palm Beach Gardens','FL',26.8234,-80.1387,'2027-02-06','2027-02-07','2026-09-23','interested',true],
    ['7',  'Coconut Grove Arts Festival',       'Coconut Grove, Miami','FL',25.7282,-80.2434,'2027-02-13','2027-02-15','2026-09-08','applied', false]
  ].map(function (r) {
    return makeShow({ routeNumber:r[0], name:r[1], city:r[2], state:r[3], lat:r[4], lng:r[5],
                      startDate:r[6], endDate:r[7], applyBy:r[8], status:r[9], isAlternate:r[10],
                      source:'manual' });
  });

  /* ---- 3. STORE ADAPTER --------------------------------------------------
     Nothing outside this block touches storage. Phase 3 adds SupabaseStore
     with the same async surface: list/get/upsert/remove/replaceAll.        */
  var notify = function (msg) { console.warn(msg); };

  function migrate(db) {
    var d = db;
    if (!d || typeof d !== 'object') d = { schemaVersion: SCHEMA_VERSION, shows: [] };
    if (!Array.isArray(d.shows)) d.shows = [];
    // v0 (pre-versioning: a bare array or no version) -> v1
    if (!d.schemaVersion) d.schemaVersion = 1;
    // Future: if (d.schemaVersion < 2) { ...; d.schemaVersion = 2; }
    d.shows = d.shows.map(makeShow);
    d.schemaVersion = SCHEMA_VERSION;
    return d;
  }

  var LocalStore = (function () {
    function read() {
      var raw = null;
      try { raw = localStorage.getItem(DB_KEY); }
      catch (_) { return { schemaVersion: SCHEMA_VERSION, shows: [] }; }
      if (raw === null) return null;
      var parsed;
      try { parsed = JSON.parse(raw); } catch (_) { parsed = null; }
      if (Array.isArray(parsed)) parsed = { shows: parsed };
      return migrate(parsed);
    }
    function write(db) {
      db.schemaVersion = SCHEMA_VERSION;
      try { localStorage.setItem(DB_KEY, JSON.stringify(db)); }
      catch (err) { notify('Could not save — storage is unavailable or full.'); throw err; }
      return db;
    }
    function load() {
      var db = read();
      if (db) return db;
      return write({ schemaVersion: SCHEMA_VERSION, shows: SEED });
    }
    return {
      list: function () { return Promise.resolve(load().shows.slice()); },
      get: function (id) {
        return Promise.resolve(load().shows.filter(function (s) { return s.id === id; })[0] || null);
      },
      upsert: function (show) {
        var db = load();
        var rec = makeShow(show);
        rec.updatedAt = new Date().toISOString();
        var i = db.shows.findIndex(function (s) { return s.id === rec.id; });
        if (i === -1) db.shows.push(rec); else db.shows[i] = Object.assign({}, db.shows[i], rec);
        write(db);
        return Promise.resolve(rec);
      },
      remove: function (id) {
        var db = load();
        var i = db.shows.findIndex(function (s) { return s.id === id; });
        if (i === -1) return Promise.resolve(null);
        var gone = db.shows.splice(i, 1)[0];
        write(db);
        return Promise.resolve(gone);
      },
      replaceAll: function (shows) {
        var db = { schemaVersion: SCHEMA_VERSION, shows: shows.map(makeShow) };
        write(db);
        return Promise.resolve(db.shows.slice());
      }
    };
  })();

  var Store = LocalStore;

  /* ---- 4. DATES + FORMATTING -------------------------------------------- */
  var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
  var FAR = '9999-12-31';

  function parseISO(s) {
    if (!s || !ISO_RE.test(s)) return null;
    var p = s.split('-').map(Number), y = p[0], m = p[1], d = p[2];
    var dt = new Date(y, m - 1, d);
    return (dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d) ? dt : null;
  }
  function today() { var t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()); }
  function daysUntil(iso) {
    var d = parseISO(iso);
    if (!d) return null;
    return Math.round((d - today()) / 86400000);
  }
  function fmtDay(iso) { var d = parseISO(iso); return d ? MONTHS[d.getMonth()] + ' ' + d.getDate() : ''; }
  function fmtRange(startISO, endISO) {
    var a = parseISO(startISO), b = parseISO(endISO);
    if (!a) return '—';
    var year = a.getFullYear();
    if (!b || +a === +b) return MONTHS[a.getMonth()] + ' ' + a.getDate() + ', ' + year;
    if (a.getMonth() === b.getMonth()) {
      return MONTHS[a.getMonth()] + ' ' + a.getDate() + '–' + b.getDate() + ', ' + year;
    }
    return MONTHS[a.getMonth()] + ' ' + a.getDate() + ' – ' + MONTHS[b.getMonth()] + ' ' + b.getDate() + ', ' + year;
  }
  function fmtCountdown(n) {
    if (n === null) return '';
    if (n < 0) return 'closed';
    if (n === 0) return 'today';
    if (n === 1) return '1 day';
    return n + ' days';
  }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function place(show) {
    var p = [show.city, show.state].filter(Boolean).join(', ');
    return show.isAlternate ? (p ? p + ' — alternate' : 'alternate') : p;
  }

  /** Date order, ties broken by stop number — the canonical route order. */
  function byDate(shows) {
    return shows.slice().sort(function (a, b) {
      return (a.startDate || FAR).localeCompare(b.startDate || FAR) ||
             a.routeNumber.localeCompare(b.routeNumber, undefined, { numeric: true });
    });
  }
  function hasCoords(s) { return typeof s.lat === 'number' && typeof s.lng === 'number'; }

  /* ---- 5. RATING GLYPHS -------------------------------------------------- */
  var STAR_PATH = 'M10 1.8l2.47 5.01 5.53.8-4 3.9.94 5.5L10 14.42l-4.94 2.6.94-5.5-4-3.9 5.53-.8z';
  var starUid = 0;

  /** rating is 0-10; each star is worth 2 (so 10 half-star steps). */
  function starsSVG(rating, size) {
    var r = clampRating(rating), out = '';
    for (var i = 0; i < 5; i++) {
      var frac = Math.max(0, Math.min(2, r - i * 2)) / 2;
      var id = 'star' + (++starUid);
      out += '<svg width="' + size + '" height="' + size + '" viewBox="0 0 20 20" aria-hidden="true">' +
        (frac > 0 ? '<defs><clipPath id="' + id + '"><rect x="0" y="0" width="' + (frac * 20) + '" height="20"/></clipPath></defs>' : '') +
        '<path d="' + STAR_PATH + '" fill="none" stroke="currentColor" stroke-width="1.1" opacity="' + (frac > 0 ? '.85' : '.4') + '"/>' +
        (frac > 0 ? '<path d="' + STAR_PATH + '" fill="currentColor" clip-path="url(#' + id + ')"/>' : '') +
        '</svg>';
    }
    return '<span class="stars">' + out + '</span>';
  }
  function ratingText(r) { return r ? (r + ' / 10') : 'Unrated'; }

  /* ---- 6. THEME ----------------------------------------------------------
     Shared so both pages read the same persisted preference. Pages register
     an onChange listener to swap their own icons.                          */
  var themeListeners = [];
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    themeListeners.forEach(function (fn) { fn(theme); });
  }
  var Theme = {
    current: function () { return document.documentElement.getAttribute('data-theme') || 'light'; },
    onChange: function (fn) { themeListeners.push(fn); },
    init: function () {
      var saved = null;
      try { saved = localStorage.getItem(THEME_KEY); } catch (_) {}
      var system = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      applyTheme(saved === 'dark' || saved === 'light' ? saved : system);
    },
    set: function (theme) {
      applyTheme(theme);
      try { localStorage.setItem(THEME_KEY, theme); } catch (_) {}
    },
    toggle: function () { Theme.set(Theme.current() === 'dark' ? 'light' : 'dark'); }
  };

  return {
    SCHEMA_VERSION: SCHEMA_VERSION,
    STATUSES: STATUSES, STATUS_LABEL: STATUS_LABEL,
    makeShow: makeShow, numOrNull: numOrNull, clampRating: clampRating, migrate: migrate,
    SEED: SEED, Store: Store,
    setNotifier: function (fn) { notify = fn; },
    parseISO: parseISO, today: today, daysUntil: daysUntil,
    fmtDay: fmtDay, fmtRange: fmtRange, fmtCountdown: fmtCountdown,
    esc: esc, place: place, byDate: byDate, hasCoords: hasCoords, FAR: FAR,
    starsSVG: starsSVG, ratingText: ratingText,
    Theme: Theme
  };
})();
