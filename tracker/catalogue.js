/* ==========================================================================
   Art Show Tracker — shows catalogue
   The browsable master list of shows you might apply to. Deliberately NOT
   the ledger: the ledger is your season, this is the pool you draw it from.

   Two halves, kept apart on purpose:
   - catalogue.json — the shipped reference data, replaceable wholesale.
   - AST.Settings.getCatalogue() — what YOU did to it: likes, ratings, which
     records you have already pulled into the ledger, and any rows you added
     yourself. Keyed by catalogue id, so dropping in a fresher export never
     costs you your picks.

   Classic script (see the note at the top of core.js). Publishes
   window.ASTCatalogue and depends on window.AST.
   ========================================================================== */
window.ASTCatalogue = (function () {
  'use strict';

  var A = window.AST;

  var SOURCE_URL = 'catalogue.json';

  /* Loaded reference records, by id. Filled by load(). */
  var base = {};
  var order = [];
  var meta = { count: 0, importedAt: '', source: '' };
  var loaded = false;

  /* ---- Your side of it --------------------------------------------------- */

  /**
   * The saved state, shaped { picks: { id: {liked, rating, addedShowId} },
   * added: [record, ...] }. Read through here so the shape is one thing.
   */
  function state() {
    var s = A.Settings.getCatalogue() || {};
    if (!s.picks || typeof s.picks !== 'object') s.picks = {};
    if (!Array.isArray(s.added)) s.added = [];
    return s;
  }
  function save(s) { return A.Settings.setCatalogue(s); }

  function pick(id) {
    var p = state().picks[id];
    return {
      liked: !!(p && p.liked),
      rating: A.clampRating(p && p.rating),
      addedShowId: (p && p.addedShowId) || ''
    };
  }

  function setPick(id, patch) {
    var s = state();
    var cur = s.picks[id] || {};
    Object.keys(patch).forEach(function (k) { cur[k] = patch[k]; });
    /* Drop a record that carries nothing rather than growing the store with
       empty objects every time something is liked and unliked. */
    if (!cur.liked && !cur.rating && !cur.addedShowId) delete s.picks[id];
    else s.picks[id] = cur;
    save(s);
    return pick(id);
  }

  function like(id, on) { return setPick(id, { liked: !!on }); }
  function rate(id, r) { return setPick(id, { rating: A.clampRating(r) }); }
  function markAdded(id, showId) { return setPick(id, { addedShowId: showId || '' }); }

  /* ---- The records ------------------------------------------------------- */

  /** Normalises anything claiming to be a catalogue record. */
  function makeRecord(input) {
    input = input || {};
    var name = String(input.name || '').trim();
    return {
      id: String(input.id || ('cust-' + Date.now().toString(36) + '-' +
            Math.random().toString(36).slice(2, 8))),
      name: name,
      city: String(input.city || '').trim(),
      state: String(input.state || '').trim().toUpperCase().slice(0, 2),
      stateName: String(input.stateName || '').trim(),
      startDate: input.startDate || '',
      endDate: input.endDate || input.startDate || '',
      applyBy: input.applyBy || '',
      deadlineNote: String(input.deadlineNote || '').trim(),
      earlyBird: input.earlyBird || '',
      notifyDate: input.notifyDate || '',
      fee: A.numOrNull(input.fee),
      feeLabel: String(input.feeLabel || '').trim(),
      url: String(input.url || '').trim(),
      custom: !!input.custom
    };
  }

  /**
   * Fetches catalogue.json. Best-effort: a catalogue that will not load is
   * reported to the caller rather than thrown, because the rows you added
   * yourself are still perfectly usable without it.
   * @returns Promise<{ ok, error }>
   */
  function load(opts) {
    opts = opts || {};
    var url = opts.url || SOURCE_URL;
    return fetch(url, { cache: 'no-cache' })
      .then(function (res) {
        if (!res.ok) throw new Error('catalogue answered ' + res.status);
        return res.json();
      })
      .then(function (data) {
        var rows = (data && data.shows) || [];
        base = {}; order = [];
        rows.forEach(function (r) {
          var rec = makeRecord(r);
          if (!rec.name) return;
          base[rec.id] = rec; order.push(rec.id);
        });
        meta = {
          count: order.length,
          importedAt: (data && data.importedAt) || '',
          source: (data && data.source) || ''
        };
        loaded = true;
        return { ok: true };
      })
      .catch(function (e) {
        loaded = false;
        return { ok: false, error: e.message || String(e) };
      });
  }

  /** Every record: the shipped ones plus the ones you added, with your picks. */
  function all() {
    var s = state();
    var out = order.map(function (id) { return base[id]; });
    s.added.forEach(function (r) {
      var rec = makeRecord(r); rec.custom = true;
      if (!base[rec.id]) out.push(rec);
    });
    return out.map(function (r) {
      var p = pick(r.id);
      return Object.assign({}, r, {
        liked: p.liked, rating: p.rating, addedShowId: p.addedShowId
      });
    });
  }

  function get(id) {
    var hit = all().filter(function (r) { return r.id === id; });
    return hit.length ? hit[0] : null;
  }

  /** Adds a show of your own to the catalogue. */
  function addRecord(input) {
    var rec = makeRecord(input); rec.custom = true;
    if (!rec.name) return null;
    var s = state();
    s.added.push(rec);
    save(s);
    return rec;
  }

  function removeRecord(id) {
    var s = state();
    var before = s.added.length;
    s.added = s.added.filter(function (r) { return r.id !== id; });
    delete s.picks[id];
    save(s);
    return s.added.length !== before;
  }

  /* ---- Filtering and sorting --------------------------------------------- */

  /* Every comparator is written ASCENDING in its own natural sense — earliest
     date, A to Z, cheapest, lowest rating — and `dir:'desc'` flips it. That is
     what makes "newest to oldest" the same control as "oldest to newest"
     rather than a separate sort key. Rows with nothing to sort on sink to the
     bottom of an ascending sort; they are not evidence of anything. */
  var SORTS = {
    date:     function (a, b) { return cmpStr(a.startDate, b.startDate); },
    deadline: function (a, b) { return cmpStr(a.applyBy, b.applyBy); },
    name:     function (a, b) { return a.name.localeCompare(b.name); },
    /* "Where" is city first, then state, so the same town stays together. */
    place:    function (a, b) {
                return (a.city || '\uffff').localeCompare(b.city || '\uffff') ||
                       (a.state || '\uffff').localeCompare(b.state || '\uffff');
              },
    fee:      function (a, b) { return cmpNum(a.fee, b.fee); },
    rating:   function (a, b) { return cmpNum(a.rating || 0, b.rating || 0); }
  };

  /** Which way round each sort is most useful when you first pick it. */
  var SORT_DEFAULT_DIR = {
    date: 'asc', deadline: 'asc', name: 'asc', place: 'asc', fee: 'asc', rating: 'desc'
  };

  /* Empty sorts last in an ascending order, so a missing date does not
     masquerade as the earliest one. */
  function cmpStr(a, b) {
    a = a || ''; b = b || '';
    if (!a && !b) return 0;
    if (!a) return 1;
    if (!b) return -1;
    return a < b ? -1 : (a > b ? 1 : 0);
  }
  function cmpNum(a, b) {
    var an = (a == null), bn = (b == null);
    if (an && bn) return 0;
    if (an) return 1;
    if (bn) return -1;
    return a - b;
  }

  /**
   * @param q.text     name / city substring
   * @param q.states   array of two-letter codes; empty means all
   * @param q.liked    true -> only liked
   * @param q.added    'hide' -> drop what is already in the ledger, 'only' -> just those
   * @param q.deadline 'open' -> only deadlines that have not passed
   * @param q.from,q.to  event-date window (ISO)
   * @param q.maxFee   number
   * @param q.sort     key of SORTS
   * @param q.dir      'asc' (default) or 'desc' — reverses whichever sort
   */
  function query(rows, q) {
    q = q || {};
    var text = String(q.text || '').trim().toLowerCase();
    var words = text ? text.split(/\s+/) : [];
    var states = (q.states && q.states.length) ? q.states : null;

    var out = rows.filter(function (r) {
      if (text) {
        /* Keyword search across name, city and both forms of the state, so
           "florida" and "FL" both work. Every word has to match somewhere,
           which makes "naples art" behave the way people expect. */
        var hay = (r.name + ' ' + r.city + ' ' + r.state + ' ' + r.stateName).toLowerCase();
        for (var w = 0; w < words.length; w++) {
          if (hay.indexOf(words[w]) === -1) return false;
        }
      }
      if (states && states.indexOf(r.state) === -1) return false;
      if (q.liked && !r.liked) return false;
      if (q.added === 'hide' && r.addedShowId) return false;
      if (q.added === 'only' && !r.addedShowId) return false;
      /* A.today() is a Date, not an ISO string, so ask daysUntil rather than
         comparing a string against it. Today itself still counts as open. */
      if (q.deadline === 'open' && r.applyBy && A.daysUntil(r.applyBy) < 0) return false;
      if (q.from && r.startDate && r.startDate < q.from) return false;
      if (q.to && r.startDate && r.startDate > q.to) return false;
      if (q.maxFee != null && r.fee != null && r.fee > q.maxFee) return false;
      return true;
    });

    var cmp = SORTS[q.sort] || SORTS.date;
    var sign = q.dir === 'desc' ? -1 : 1;
    /* Name breaks every tie, so equal rows keep a stable, readable order
       instead of shuffling between renders. */
    return out.sort(function (a, b) {
      return sign * cmp(a, b) || a.name.localeCompare(b.name);
    });
  }

  /** The states present, with counts, for the filter UI. */
  function states(rows) {
    var by = {};
    rows.forEach(function (r) {
      if (!r.state) return;
      by[r.state] = by[r.state] || { state: r.state, name: r.stateName || r.state, n: 0 };
      by[r.state].n++;
    });
    return Object.keys(by).sort().map(function (k) { return by[k]; });
  }

  /* ---- Handing a record to the ledger ------------------------------------ */

  /**
   * Catalogue record -> a ledger show. Coordinates are deliberately left
   * empty: the catalogue carries city and state, and geocoding is the import
   * modal's job, so a show added here gets pinned the same way an imported
   * one does rather than through a second, parallel path.
   */
  function toShow(rec, opts) {
    opts = opts || {};
    return A.makeShow({
      name: rec.name,
      city: rec.city,
      state: rec.state,
      startDate: rec.startDate,
      endDate: rec.endDate,
      applyBy: rec.applyBy,
      status: opts.status || 'interested',
      rating: rec.rating || 0,
      juryFee: rec.fee,
      url: rec.url,
      notes: rec.deadlineNote ? ('Deadline ' + rec.deadlineNote + '.') : '',
      source: 'catalogue',
      catalogueId: rec.id
    });
  }

  return {
    SOURCE_URL: SOURCE_URL,
    SORTS: SORTS,
    SORT_DEFAULT_DIR: SORT_DEFAULT_DIR,
    load: load,
    isLoaded: function () { return loaded; },
    meta: function () { return Object.assign({}, meta); },
    all: all,
    get: get,
    query: query,
    states: states,
    pick: pick,
    like: like,
    rate: rate,
    markAdded: markAdded,
    addRecord: addRecord,
    removeRecord: removeRecord,
    makeRecord: makeRecord,
    toShow: toShow
  };
})();
