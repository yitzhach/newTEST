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
  var SCHEMA_VERSION = 6;
  var DB_KEY = 'artShowTracker.db';
  var THEME_KEY = 'artShowTracker.theme';
  var CONFIG_KEY = 'artShowTracker.supabase';
  var SESSION_KEY = 'artShowTracker.session';
  var GEOCACHE_KEY = 'artShowTracker.geocache';
  var SHARE_KEY = 'artShowTracker.share';
  var LAYOUT_KEY = 'artShowTracker.layout';
  var CATALOGUE_KEY = 'artShowTracker.catalogue';
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

  /* ---- the application pipeline (idea 11) --------------------------------
     A show's `status` is where it stands right now. An application is what
     you DID, and when: one record per show per cycle, so applying to the same
     show again next season is a second row rather than an overwrite. That is
     what makes the jury fee tracker (12) able to add anything up.

     These are deliberately NOT the same list as STATUSES. `interested` and
     `not_applying` describe a show you have not applied to, so they can never
     be an application; `withdrawn` describes an application but never a show. */
  var STAGES = [
    { value:'draft',     label:'Started' },
    { value:'applied',   label:'Applied' },
    { value:'accepted',  label:'Accepted' },
    { value:'waitlist',  label:'Waitlist' },
    { value:'declined',  label:'Declined' },
    { value:'withdrawn', label:'Withdrawn' }
  ];
  var STAGE_LABEL = Object.fromEntries(STAGES.map(function (s) { return [s.value, s.label]; }));
  /* Decided one way or the other — the jury is done with it. `withdrawn` is
     settled too, but it is the artist's doing, so it never counts as a
     rejection in any rate. */
  var STAGE_SETTLED = ['accepted','waitlist','declined','withdrawn'];

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
      /* Phase 7: temporarily out of the plan. A hidden show greys out in the
         list and drops out of the map and the route, so a route can be tried
         without it — but it is still yours: exports, the share card and the
         season stats all still count it. Hiding is a lens, not a delete. */
      hidden: !!input.hidden,
      notes: input.notes || '',
      url: input.url || '',
      source: ['manual','zapp_paste','csv','catalogue'].indexOf(input.source) !== -1 ? input.source : 'manual',
      /* Which catalogue record this came from, so All shows can tell you it
         is already in the ledger without matching on name. */
      catalogueId: input.catalogueId || '',
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

  /* ---- 1b. CALENDAR EVENTS ----------------------------------------------
     Anything on the calendar that is NOT a show: a travel day, a studio
     block, a deadline you set yourself, a plain reminder. Shows are never
     duplicated in here — the calendar reads them from the ledger and from
     the catalogue, so a show's dates have exactly one home.

     Same discipline as a show: a stable id, updatedAt, and a tombstone
     rather than a delete, so this shape can ride the existing
     last-write-wins sync the moment an `events` table exists.             */
  var EVENT_KINDS = [
    { value:'event',    label:'Event' },
    { value:'travel',   label:'Travel' },
    { value:'deadline', label:'Deadline' },
    { value:'reminder', label:'Reminder' },
    { value:'personal', label:'Personal' }
  ];
  var EVENT_KIND_LABEL = Object.fromEntries(EVENT_KINDS.map(function (k) { return [k.value, k.label]; }));

  var TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
  function timeOrEmpty(v) { return TIME_RE.test(String(v || '')) ? String(v) : ''; }

  /**
   * Reminders are stored now and delivered by nobody yet. That is deliberate
   * and it is the same rule as a null fact: the record says what it wants,
   * the UI says plainly that no channel is connected, and neither pretends a
   * message went out. When a channel is wired, these rows are already here.
   */
  function makeReminder(input) {
    input = input || {};
    var mins = Number(input.minutesBefore);
    return {
      minutesBefore: Number.isFinite(mins) ? Math.max(0, Math.round(mins)) : 60,
      channel: ['email','sms','push'].indexOf(input.channel) !== -1 ? input.channel : 'email',
      // Never delivered, only ever recorded. Set by a delivery channel later.
      deliveredAt: input.deliveredAt || null
    };
  }

  /** 'YYYY-MM-DD' or '' — anything else is not a date we will store. */
  function dateOrEmpty(v) {
    return (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) ? v : '';
  }
  /** A cycle is a four-digit year string. Anything unparseable is ''. */
  function cycleOf(v) {
    if (v == null || v === '') return '';
    var m = String(v).match(/^(\d{4})/);
    return m ? m[1] : '';
  }

  /**
   * A saved ranking — "Lisa's list". The criteria themselves belong to
   * ranker.js, which owns the factor list; core.js only guarantees the
   * envelope every stored record shares, so sync and tombstones work the
   * same way here as everywhere else.
   *
   * `weights` is left exactly as given: a null means "follow the presets",
   * and ranker.js is the only thing allowed to interpret or clamp it.
   */
  function makeRanker(input) {
    input = input || {};
    var now = new Date().toISOString();
    return {
      id: input.id || newId(),
      name: String(input.name || '').trim(),
      /* Whose list this is, for a shared one. Free text the artist typed,
         never an identity the app asserts. */
      ownerName: String(input.ownerName || '').trim(),
      discipline: input.discipline || '',
      priceBand: input.priceBand || '',
      strategy: input.strategy || '',
      weights: Array.isArray(input.weights) ? input.weights.slice() : null,
      notes: input.notes || '',
      /* Where it came from. An imported list stays marked as imported for as
         long as it exists: a ranking someone else built is not your judgment,
         and the UI has to keep being able to say so. */
      origin: input.origin === 'imported' ? 'imported' : 'mine',
      sourceName: String(input.sourceName || '').trim(),
      /* Sharing is opt-in, per record, and false is the only default. Artists
         protect their show lists; nothing here leaves the device unless it is
         deliberately exported. */
      shared: !!input.shared,
      deletedAt: input.deletedAt || null,
      createdAt: input.createdAt || now,
      updatedAt: input.updatedAt || now
    };
  }

  /**
   * One application, to one show, in one cycle. A child record: it has its own
   * id and updatedAt so two devices adding different applications merge as a
   * union instead of one overwriting the other. Money must not be lost to
   * last-write-wins the way a status change safely can be.
   */
  function makeApplication(input) {
    input = input || {};
    var now = new Date().toISOString();
    return {
      id: input.id || newId(),
      /* Which ledger show this belongs to. An application with no show is
         orphaned, not global — the UI drops it rather than inventing a parent. */
      showId: input.showId || '',
      catalogueId: input.catalogueId || '',
      /* The season, as a four-digit year string. Two applications to the same
         show in different years are two rows; in the SAME year they are one,
         because that is what re-applying to a single jury means. */
      cycle: cycleOf(input.cycle),
      stage: STAGE_LABEL[input.stage] ? input.stage : 'draft',
      /* Dates you actually did the thing. Empty means unknown, never today —
         a backfilled row genuinely does not know when it was submitted. */
      appliedOn: dateOrEmpty(input.appliedOn),
      notifiedOn: dateOrEmpty(input.notifiedOn),
      /* What the jury fee ACTUALLY cost, which is not always the show's listed
         fee — early-bird and late rates differ. Null is "not recorded"; it is
         never 0, because a fee nobody entered is not a free show. */
      juryFee: numOrNull(input.juryFee),
      feePaidOn: dateOrEmpty(input.feePaidOn),
      /* The artist's own estimate of what they would gross at this show. The
         only honest input to expected value (14): nothing in the catalogue
         knows it, so with no estimate EV stays null and renders "not known". */
      expectedGross: numOrNull(input.expectedGross),
      notes: input.notes || '',
      deletedAt: input.deletedAt || null,
      createdAt: input.createdAt || now,
      updatedAt: input.updatedAt || now
    };
  }

  function makeEvent(input) {
    input = input || {};
    var now = new Date().toISOString();
    var start = input.startDate || '';
    return {
      id: input.id || newId(),
      kind: EVENT_KIND_LABEL[input.kind] ? input.kind : 'event',
      title: String(input.title || '').trim(),
      notes: input.notes || '',
      location: String(input.location || '').trim(),
      startDate: start,
      // A one-day event ends the day it starts; an empty end is not "forever".
      endDate: input.endDate || start,
      allDay: input.allDay === undefined ? true : !!input.allDay,
      startTime: timeOrEmpty(input.startTime),
      endTime: timeOrEmpty(input.endTime),
      /* Optional tie back to a show, so "drive to Naples" can sit under the
         Naples show and open its drawer. Never a copy of the show. */
      showId: input.showId || '',
      catalogueId: input.catalogueId || '',
      reminders: Array.isArray(input.reminders) ? input.reminders.map(makeReminder) : [],
      deletedAt: input.deletedAt || null,
      createdAt: input.createdAt || now,
      updatedAt: input.updatedAt || now
    };
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
    if (!d || typeof d !== 'object') d = { schemaVersion: SCHEMA_VERSION, shows: [], events: [], applications: [], rankers: [] };
    if (!Array.isArray(d.shows)) d.shows = [];
    if (!Array.isArray(d.applications)) d.applications = [];
    if (!Array.isArray(d.rankers)) d.rankers = [];
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
    // v2 -> v3: the hide-from-plan flag. Everything existing starts visible.
    if (d.schemaVersion < 3) {
      d.shows = d.shows.map(function (row) {
        if (row && row.hidden === undefined) row.hidden = false;
        return row;
      });
      d.schemaVersion = 3;
    }
    // v3 -> v4: the calendar. Existing databases simply gain an empty list;
    // nothing about a show moves, because the calendar never copies one.
    if (d.schemaVersion < 4) {
      if (!Array.isArray(d.events)) d.events = [];
      d.schemaVersion = 4;
    }
    /* v4 -> v5: the application pipeline. Existing databases gain a row for
       every show already past "interested", because a show marked Accepted is
       evidence an application happened even though nothing recorded it. The
       dates stay EMPTY: we know it happened, we do not know when, and a
       plausible date here would be a fabrication in the one collection that
       has to survive an audit. The jury fee carries over from the show, which
       is the figure the artist entered themselves. */
    if (d.schemaVersion < 5) {
      if (!Array.isArray(d.applications)) d.applications = [];
      var STAGE_FROM_STATUS = {
        applied: 'applied', accepted: 'accepted',
        waitlist: 'waitlist', declined: 'declined'
      };
      d.shows.forEach(function (row) {
        if (!row || row.deletedAt) return;
        var stage = STAGE_FROM_STATUS[row.status];
        if (!stage) return;
        d.applications.push(makeApplication({
          showId: row.id,
          catalogueId: row.catalogueId,
          cycle: cycleOf(row.startDate),
          stage: stage,
          juryFee: row.juryFee,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt
        }));
      });
      d.schemaVersion = 5;
    }
    /* v5 -> v6: saved rankings. Nothing is seeded — an artist who has not
       built one is not given somebody else's idea of a good show, and the
       preset profile keeps working exactly as before until they do. */
    if (d.schemaVersion < 6) {
      if (!Array.isArray(d.rankers)) d.rankers = [];
      d.schemaVersion = 6;
    }
    d.shows = d.shows.map(makeShow);
    d.events = (Array.isArray(d.events) ? d.events : []).map(makeEvent);
    d.applications = (Array.isArray(d.applications) ? d.applications : []).map(makeApplication);
    d.rankers = (Array.isArray(d.rankers) ? d.rankers : []).map(makeRanker);
    d.schemaVersion = SCHEMA_VERSION;
    return d;
  }

  var LocalStore = (function () {
    function read() {
      var raw = null;
      try { raw = localStorage.getItem(DB_KEY); }
      catch (_) { return { schemaVersion: SCHEMA_VERSION, shows: [], events: [], applications: [], rankers: [] }; }
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
      return write({ schemaVersion: SCHEMA_VERSION, shows: SEED, events: [], applications: [], rankers: [], pristineSeed: true });
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
        // Replaces the season, NOT the calendar. Your travel days and
        // reminders are not shows and must survive a re-import.
        var prev = load();
        var db = { schemaVersion: SCHEMA_VERSION, shows: shows.map(makeShow),
                   events: prev.events, applications: prev.applications,
                   rankers: prev.rankers, pristineSeed: false };
        write(db);
        return Promise.resolve(db.shows.slice());
      },
      /** True while this device still holds nothing but the untouched seed. */
      isPristineSeed: function () { return !!load().pristineSeed; },
      /** Throws away the seed and takes the account's season verbatim. */
      adoptRemote: function (rows) {
        var prev = load();
        var db = { schemaVersion: SCHEMA_VERSION, shows: rows.map(makeShow),
                   events: prev.events, applications: prev.applications,
                   rankers: prev.rankers, pristineSeed: false };
        write(db);
        return Promise.resolve(db.shows.slice());
      },
      /* ---- calendar events -------------------------------------------
         Deliberately the same surface as the show methods above, tombstones
         and all, so the sync store can adopt them without a new pattern. */
      listEvents: function () {
        return Promise.resolve(live(load().events));
      },
      listAllEvents: function () { return Promise.resolve(load().events.slice()); },
      getEvent: function (id) {
        return Promise.resolve(live(load().events).filter(function (e) { return e.id === id; })[0] || null);
      },
      upsertEvent: function (evt) {
        var db = load();
        var rec = makeEvent(evt);
        rec.updatedAt = new Date().toISOString();
        var i = db.events.findIndex(function (e) { return e.id === rec.id; });
        if (i === -1) db.events.push(rec); else db.events[i] = Object.assign({}, db.events[i], rec);
        write(touch(db));
        return Promise.resolve(rec);
      },
      /** Soft delete, returning the record as it was, so undo is one upsert. */
      removeEvent: function (id) {
        var db = load();
        var i = db.events.findIndex(function (e) { return e.id === id; });
        if (i === -1) return Promise.resolve(null);
        var before = Object.assign({}, db.events[i]);
        db.events[i] = Object.assign({}, db.events[i], {
          deletedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
        write(touch(db));
        return Promise.resolve(before);
      },
      /* ---- applications ----------------------------------------------
         The same surface again, for the same reason: when the pipeline does
         get a remote table, the sync store adopts it without learning a new
         shape. Local-only today, exactly like events. */
      listApplications: function () { return Promise.resolve(live(load().applications)); },
      listAllApplications: function () { return Promise.resolve(load().applications.slice()); },
      getApplication: function (id) {
        return Promise.resolve(live(load().applications).filter(function (a) { return a.id === id; })[0] || null);
      },
      upsertApplication: function (app) {
        var db = load();
        var rec = makeApplication(app);
        rec.updatedAt = new Date().toISOString();
        var i = db.applications.findIndex(function (a) { return a.id === rec.id; });
        if (i === -1) db.applications.push(rec);
        else db.applications[i] = Object.assign({}, db.applications[i], rec);
        write(touch(db));
        return Promise.resolve(rec);
      },
      /** Soft delete, returning the record as it was, so undo is one upsert. */
      removeApplication: function (id) {
        var db = load();
        var i = db.applications.findIndex(function (a) { return a.id === id; });
        if (i === -1) return Promise.resolve(null);
        var before = Object.assign({}, db.applications[i]);
        db.applications[i] = Object.assign({}, db.applications[i], {
          deletedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
        write(touch(db));
        return Promise.resolve(before);
      },
      /* ---- saved rankings --------------------------------------------- */
      listRankers: function () { return Promise.resolve(live(load().rankers)); },
      listAllRankers: function () { return Promise.resolve(load().rankers.slice()); },
      getRanker: function (id) {
        return Promise.resolve(live(load().rankers).filter(function (r) { return r.id === id; })[0] || null);
      },
      upsertRanker: function (rk) {
        var db = load();
        var rec = makeRanker(rk);
        rec.updatedAt = new Date().toISOString();
        var i = db.rankers.findIndex(function (r) { return r.id === rec.id; });
        if (i === -1) db.rankers.push(rec);
        else db.rankers[i] = Object.assign({}, db.rankers[i], rec);
        write(touch(db));
        return Promise.resolve(rec);
      },
      removeRanker: function (id) {
        var db = load();
        var i = db.rankers.findIndex(function (r) { return r.id === id; });
        if (i === -1) return Promise.resolve(null);
        var before = Object.assign({}, db.rankers[i]);
        db.rankers[i] = Object.assign({}, db.rankers[i], {
          deletedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
        write(touch(db));
        return Promise.resolve(before);
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
    setRouteCache: function (cache) { return writeJSON(ROUTECACHE_KEY, cache); },
    /* Phase 7: what you have done to the shows catalogue — likes, ratings,
       which ones you have already pulled into the ledger, and any rows you
       added yourself. Keyed by catalogue id, kept apart from catalogue.json
       so re-importing a fresher export never costs you your picks. */
    getCatalogue: function () { return readJSON(CATALOGUE_KEY) || {}; },
    setCatalogue: function (state) { return writeJSON(CATALOGUE_KEY, state); }
  };

  var backend = LocalStore;
  var Store = {
    list:       function ()      { return backend.list(); },
    get:        function (id)    { return backend.get(id); },
    upsert:     function (show)  { return backend.upsert(show); },
    remove:     function (id)    { return backend.remove(id); },
    replaceAll: function (shows) { return backend.replaceAll(shows); },
    /* The calendar. A backend that has not implemented events yet degrades to
       the local one rather than throwing, which is what keeps the calendar
       working while the remote `events` table does not exist. */
    listEvents:  function ()    { return (backend.listEvents  || LocalStore.listEvents).call(backend); },
    getEvent:    function (id)  { return (backend.getEvent    || LocalStore.getEvent).call(backend, id); },
    upsertEvent: function (evt) { return (backend.upsertEvent || LocalStore.upsertEvent).call(backend, evt); },
    removeEvent: function (id)  { return (backend.removeEvent || LocalStore.removeEvent).call(backend, id); },
    /* The pipeline. Same degrade-to-local fallback as events, which is what
       lets applications work today against a Supabase backend that has no
       `applications` table yet. */
    listApplications:  function ()    { return (backend.listApplications  || LocalStore.listApplications).call(backend); },
    getApplication:    function (id)  { return (backend.getApplication    || LocalStore.getApplication).call(backend, id); },
    upsertApplication: function (app) { return (backend.upsertApplication || LocalStore.upsertApplication).call(backend, app); },
    removeApplication: function (id)  { return (backend.removeApplication || LocalStore.removeApplication).call(backend, id); },
    /* Saved rankings, same degrade-to-local fallback again. */
    listRankers:  function ()   { return (backend.listRankers  || LocalStore.listRankers).call(backend); },
    getRanker:    function (id) { return (backend.getRanker    || LocalStore.getRanker).call(backend, id); },
    upsertRanker: function (rk) { return (backend.upsertRanker || LocalStore.upsertRanker).call(backend, rk); },
    removeRanker: function (id) { return (backend.removeRanker || LocalStore.removeRanker).call(backend, id); }
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
    /** The width the rail should open at, falling back to a per-key default. */
    stored: function (key, fallback) {
      var w = Splitter.get(key);
      if (typeof w === 'number') return w;
      return typeof fallback === 'number' ? fallback : Splitter.DEFAULT;
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

      function openAt(k) {
        key = k;
        var fb = o.defaultFor ? o.defaultFor(k, box.getBoundingClientRect().width) : undefined;
        apply(Splitter.stored(k, fb), false);
      }

      // Opening width, and keep it legal when the window is resized.
      openAt(key);
      window.addEventListener('resize', function () { apply(width(), false); });
      /* setKey lets one divider serve two layouts — the ledger's list view and
         its map view remember different proportions under different keys,
         without a second element or a second set of listeners. */
      return { apply: apply, width: width, setKey: openAt };
    }
  };

  /* Same idea, one axis over: drags the bottom edge of the map to make it
     taller or shorter. Writes --map-h on the element you give it. */
  var SplitterV = {
    MIN: 180,
    DEFAULT: 320,
    max: function () { return Math.max(SplitterV.MIN, Math.round(window.innerHeight * 0.78)); },
    clamp: function (h) { return Math.max(SplitterV.MIN, Math.min(h, SplitterV.max())); },

    attach: function (el, o) {
      if (!el || !o || !o.target) return null;
      var box = o.target, key = o.key || 'mapH';
      var onResize = o.onResize || function () {};
      var raf = 0, pending = null, dragging = false;

      function height() {
        var v = parseFloat(getComputedStyle(box).getPropertyValue('--map-h'));
        return isFinite(v) ? v : SplitterV.DEFAULT;
      }
      function paint(h) {
        box.style.setProperty('--map-h', h + 'px');
        el.setAttribute('aria-valuenow', String(Math.round(h)));
      }
      function schedule(h) {
        pending = h;
        if (raf) return;
        raf = requestAnimationFrame(function () {
          raf = 0;
          if (pending == null) return;
          paint(pending); pending = null;
          onResize();
        });
      }
      function apply(h, persist) {
        var c = SplitterV.clamp(h);
        schedule(c);
        if (persist) Splitter.set(key, c);
        return c;
      }

      el.setAttribute('role', 'separator');
      el.setAttribute('aria-orientation', 'horizontal');
      el.setAttribute('aria-label', 'Resize the map height');
      el.setAttribute('aria-valuemin', String(SplitterV.MIN));
      el.setAttribute('tabindex', '0');

      el.addEventListener('pointerdown', function (e) {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        dragging = true;
        el.classList.add('is-dragging');
        document.body.classList.add('is-splitting-v');
        try { el.setPointerCapture(e.pointerId); } catch (_) {}
        e.preventDefault();
      });
      el.addEventListener('pointermove', function (e) {
        if (!dragging) return;
        // Height is the pointer's distance from the top of the map box.
        apply(e.clientY - box.getBoundingClientRect().top, false);
        e.preventDefault();
      });
      function end(e) {
        if (!dragging) return;
        dragging = false;
        el.classList.remove('is-dragging');
        document.body.classList.remove('is-splitting-v');
        try { el.releasePointerCapture(e.pointerId); } catch (_) {}
        Splitter.set(key, height());
        onResize();
      }
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
      el.addEventListener('keydown', function (e) {
        var step = e.shiftKey ? 48 : 16, h = height();
        if (e.key === 'ArrowUp')        apply(h - step, true);
        else if (e.key === 'ArrowDown') apply(h + step, true);
        else return;
        e.preventDefault();
      });

      apply(Splitter.stored(key, SplitterV.DEFAULT), false);
      window.addEventListener('resize', function () { apply(height(), false); });
      return { apply: apply, height: height };
    }
  };

  return {
    SCHEMA_VERSION: SCHEMA_VERSION,
    STATUSES: STATUSES, STATUS_LABEL: STATUS_LABEL,
    makeShow: makeShow, makeEvent: makeEvent, makeReminder: makeReminder,
    makeApplication: makeApplication, makeRanker: makeRanker,
    STAGES: STAGES, STAGE_LABEL: STAGE_LABEL, STAGE_SETTLED: STAGE_SETTLED,
    EVENT_KINDS: EVENT_KINDS, EVENT_KIND_LABEL: EVENT_KIND_LABEL,
    numOrNull: numOrNull, clampRating: clampRating, migrate: migrate,
    SEED: SEED, Store: Store, LocalStore: LocalStore,
    useStore: useStore, currentStore: currentStore, Settings: Settings,
    setNotifier: function (fn) { notify = fn; },
    parseISO: parseISO, today: today, daysUntil: daysUntil,
    fmtDay: fmtDay, fmtRange: fmtRange, fmtCountdown: fmtCountdown,
    esc: esc, place: place, byDate: byDate, hasCoords: hasCoords, FAR: FAR,
    starsSVG: starsSVG, ratingText: ratingText,
    Theme: Theme, Splitter: Splitter, SplitterV: SplitterV
  };
})();
