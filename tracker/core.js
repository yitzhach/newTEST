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
  var SCHEMA_VERSION = 2;
  var DB_KEY = 'artShowTracker.db';
  var THEME_KEY = 'artShowTracker.theme';
  var CONFIG_KEY = 'artShowTracker.supabase';
  var SESSION_KEY = 'artShowTracker.session';
  var GEOCACHE_KEY = 'artShowTracker.geocache';
  var SHARE_KEY = 'artShowTracker.share';
  var LAYOUT_KEY = 'artShowTracker.layout';
  var ROUTECACHE_KEY = 'artShowTracker.routecache';

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
      // Tombstone. Sync is last-write-wins on updatedAt, so a delete has to
      // stay as a row or the other device simply pushes the show back.
      deletedAt: input.deletedAt || null,
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
    // v1 -> v2: soft deletes, so cross-device sync can carry a deletion.
    if (d.schemaVersion < 2) {
      d.shows = d.shows.map(function (row) {
        if (row && row.deletedAt === undefined) row.deletedAt = null;
        return row;
      });
      d.schemaVersion = 2;
    }
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
      var was = parsed && parsed.schemaVersion;
      var db = migrate(parsed);
      // Persist the upgrade now rather than waiting for the next write, so a
      // stale version cannot sit on disk being re-migrated on every read.
      if (was !== SCHEMA_VERSION) { try { write(db); } catch (_) {} }
      return db;
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
      // A brand-new device gets the demo season. Flag it: the seed is not the
      // user's data, so on first sign-in it must not be pushed up as if it
      // were — a second device would duplicate the whole season.
      return write({ schemaVersion: SCHEMA_VERSION, shows: SEED, pristineSeed: true });
    }
    /** Any real write means this device's data is no longer the untouched seed. */
    function touch(db) { db.pristineSeed = false; return db; }
    function live(rows) { return rows.filter(function (s) { return !s.deletedAt; }); }

    return {
      /** The app's view of the data: tombstones never reach the UI. */
      list: function () { return Promise.resolve(live(load().shows)); },
      /** Everything including tombstones — for sync only. */
      listAll: function () { return Promise.resolve(load().shows.slice()); },
      get: function (id) {
        return Promise.resolve(live(load().shows).filter(function (s) { return s.id === id; })[0] || null);
      },
      upsert: function (show) {
        var db = load();
        var rec = makeShow(show);
        rec.updatedAt = new Date().toISOString();
        var i = db.shows.findIndex(function (s) { return s.id === rec.id; });
        if (i === -1) db.shows.push(rec); else db.shows[i] = Object.assign({}, db.shows[i], rec);
        write(touch(db));
        return Promise.resolve(rec);
      },
      /**
       * Soft delete. Returns the record as it was BEFORE the tombstone, so
       * an undo can simply upsert it back.
       */
      remove: function (id) {
        var db = load();
        var i = db.shows.findIndex(function (s) { return s.id === id; });
        if (i === -1) return Promise.resolve(null);
        var before = Object.assign({}, db.shows[i]);
        db.shows[i] = Object.assign({}, db.shows[i], {
          deletedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
        write(touch(db));
        return Promise.resolve(before);
      },
      /** Sync writes rows verbatim — no updatedAt stamping, no tombstone filter. */
      putRaw: function (rows) {
        var db = load();
        rows.forEach(function (rec) {
          var i = db.shows.findIndex(function (s) { return s.id === rec.id; });
          if (i === -1) db.shows.push(makeShow(rec));
          else db.shows[i] = makeShow(rec);
        });
        write(touch(db));
        return Promise.resolve(db.shows.slice());
      },
      replaceAll: function (shows) {
        var db = { schemaVersion: SCHEMA_VERSION, shows: shows.map(makeShow), pristineSeed: false };
        write(db);
        return Promise.resolve(db.shows.slice());
      },
      /** True while this device still holds nothing but the untouched seed. */
      isPristineSeed: function () { return !!load().pristineSeed; },
      /** Throws away the seed and takes the account's season verbatim. */
      adoptRemote: function (rows) {
        var db = { schemaVersion: SCHEMA_VERSION, shows: rows.map(makeShow), pristineSeed: false };
        write(db);
        return Promise.resolve(db.shows.slice());
      },
      markUsed: function () { var db = load(); write(touch(db)); }
    };
  })();


  /* ---- 3b. SETTINGS + STORE FACADE ---------------------------------------
     `AST.Store` is a stable object the pages hold on to; `useStore` swaps the
     backend underneath it, so Phase 3 can move from LocalStore to the
     Supabase-backed sync store without any page re-binding its reference.
     Settings are small key/value prefs (Supabase URL, anon key, session) and
     live here for the same reason the show data does: one place touches
     localStorage.                                                          */
  function readJSON(key) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }
  function writeJSON(key, value) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (_) { return false; }
  }

  var Settings = {
    /** { url, anonKey } — the anon key is public by design; a service key is not. */
    getConfig: function () { return readJSON(CONFIG_KEY); },
    setConfig: function (cfg) { return writeJSON(CONFIG_KEY, cfg); },
    clearConfig: function () { return writeJSON(CONFIG_KEY, null); },
    getSession: function () { return readJSON(SESSION_KEY); },
    setSession: function (sess) { return writeJSON(SESSION_KEY, sess); },
    clearSession: function () { return writeJSON(SESSION_KEY, null); },
    /* Phase 4: geocoded places, keyed 'city|state'. Nominatim asks that
       results be cached rather than looked up again, and a miss is cached as
       null so a place with no match is asked about once, not once per import. */
    getGeoCache: function () { return readJSON(GEOCACHE_KEY) || {}; },
    setGeoCache: function (cache) { return writeJSON(GEOCACHE_KEY, cache); },
    /* Phase 5: the share panel's remembered choices (artist name, link, card
       size, how many shows, which statuses are public). Prefs only — never
       show data. */
    getShare: function () { return readJSON(SHARE_KEY) || {}; },
    setShare: function (prefs) { return writeJSON(SHARE_KEY, prefs); },
    /* Phase 6: the width you dragged the list/map divider to, per page, plus
       whether the ledger was left in map view. Layout only — never show data. */
    getLayout: function () { return readJSON(LAYOUT_KEY) || {}; },
    setLayout: function (prefs) { return writeJSON(LAYOUT_KEY, prefs); },
    /* Phase 6: road-following route geometry, keyed by the ordered stop
       coordinates. The routing service asks that results be reused rather
       than re-requested, and this lets the drawn route survive a reload with
       no network at all. A failure is NOT cached — unlike a geocode miss it
       is usually the network, not the answer. */
    getRouteCache: function () { return readJSON(ROUTECACHE_KEY) || {}; },
    setRouteCache: function (cache) { return writeJSON(ROUTECACHE_KEY, cache); }
  };

  var backend = LocalStore;
  var Store = {
    list:       function ()      { return backend.list(); },
    get:        function (id)    { return backend.get(id); },
    upsert:     function (show)  { return backend.upsert(show); },
    remove:     function (id)    { return backend.remove(id); },
    replaceAll: function (shows) { return backend.replaceAll(shows); }
  };
  function useStore(next) { backend = next || LocalStore; return Store; }
  function currentStore() { return backend; }

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

  /* ==========================================================================
     SPLITTER — the draggable divider between the list and the map
     Lives here for the same reason Theme does: both pages need it, and one
     file owns the localStorage write. It knows nothing about maps; the host
     page passes an onResize callback, which is where invalidateSize() goes.
     ========================================================================== */
  var Splitter = {
    MIN_RAIL: 280,      // below this the map is too small to read
    MIN_LIST: 420,      // and above it the list stops being a list
    DEFAULT: 392,

    get: function (key) {
      var l = Settings.getLayout();
      var w = l && l[key];
      return (typeof w === 'number' && isFinite(w)) ? w : null;
    },
    set: function (key, w) {
      var l = Settings.getLayout();
      l[key] = Math.round(w);
      return Settings.setLayout(l);
    },
    /** The width the rail should open at. */
    stored: function (key) {
      var w = Splitter.get(key);
      return typeof w === 'number' ? w : Splitter.DEFAULT;
    },
    /** Clamps a desired rail width against the space actually available. */
    clamp: function (w, containerWidth) {
      var max = Math.max(Splitter.MIN_RAIL, containerWidth - Splitter.MIN_LIST);
      return Math.max(Splitter.MIN_RAIL, Math.min(w, max));
    },

    /**
     * Wires a divider element up to a grid container.
     * @param el          the .splitter element
     * @param o.container the grid whose --rail-w is written
     * @param o.key       Settings.layout key to remember the width under
     * @param o.onResize  called (throttled) while dragging and once after
     */
    attach: function (el, o) {
      if (!el || !o || !o.container) return null;
      var box = o.container, key = o.key || 'rail';
      var onResize = o.onResize || function () {};
      var raf = 0, pending = null, dragging = false;

      function width() {
        var v = parseFloat(getComputedStyle(box).getPropertyValue('--rail-w'));
        return isFinite(v) ? v : Splitter.DEFAULT;
      }
      function paint(w) {
        box.style.setProperty('--rail-w', w + 'px');
        el.setAttribute('aria-valuenow', String(Math.round(w)));
      }
      /* One write per frame. Dragging fires pointermove far faster than the
         map can redraw, and calling invalidateSize() on every event is what
         makes a resizable map feel like treacle. */
      function schedule(w) {
        pending = w;
        if (raf) return;
        raf = requestAnimationFrame(function () {
          raf = 0;
          if (pending == null) return;
          paint(pending); pending = null;
          onResize();
        });
      }
      function apply(w, persist) {
        var c = Splitter.clamp(w, box.getBoundingClientRect().width);
        schedule(c);
        if (persist) Splitter.set(key, c);
        return c;
      }

      el.setAttribute('role', 'separator');
      el.setAttribute('aria-orientation', 'vertical');
      el.setAttribute('aria-label', 'Resize the map');
      el.setAttribute('aria-valuemin', String(Splitter.MIN_RAIL));
      el.setAttribute('tabindex', '0');

      el.addEventListener('pointerdown', function (e) {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        dragging = true;
        el.classList.add('is-dragging');
        document.body.classList.add('is-splitting');
        try { el.setPointerCapture(e.pointerId); } catch (_) {}
        e.preventDefault();
      });
      el.addEventListener('pointermove', function (e) {
        if (!dragging) return;
        // The rail is whatever is left between the pointer and the right edge.
        apply(box.getBoundingClientRect().right - e.clientX, false);
        e.preventDefault();
      });
      function end(e) {
        if (!dragging) return;
        dragging = false;
        el.classList.remove('is-dragging');
        document.body.classList.remove('is-splitting');
        try { el.releasePointerCapture(e.pointerId); } catch (_) {}
        Splitter.set(key, width());
        onResize();
      }
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);

      // A divider you can only drag is a divider some people cannot move.
      el.addEventListener('keydown', function (e) {
        var step = e.shiftKey ? 48 : 16, w = width();
        if (e.key === 'ArrowLeft')       apply(w + step, true);
        else if (e.key === 'ArrowRight') apply(w - step, true);
        else return;
        e.preventDefault();
      });

      // Opening width, and keep it legal when the window is resized.
      apply(Splitter.stored(key), false);
      window.addEventListener('resize', function () { apply(width(), false); });
      return { apply: apply, width: width };
    }
  };

  return {
    SCHEMA_VERSION: SCHEMA_VERSION,
    STATUSES: STATUSES, STATUS_LABEL: STATUS_LABEL,
    makeShow: makeShow, numOrNull: numOrNull, clampRating: clampRating, migrate: migrate,
    SEED: SEED, Store: Store, LocalStore: LocalStore,
    useStore: useStore, currentStore: currentStore, Settings: Settings,
    setNotifier: function (fn) { notify = fn; },
    parseISO: parseISO, today: today, daysUntil: daysUntil,
    fmtDay: fmtDay, fmtRange: fmtRange, fmtCountdown: fmtCountdown,
    esc: esc, place: place, byDate: byDate, hasCoords: hasCoords, FAR: FAR,
    starsSVG: starsSVG, ratingText: ratingText,
    Theme: Theme, Splitter: Splitter
  };
})();
