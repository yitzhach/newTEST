/* ==========================================================================
   Show Ledger — member intel

   What artists in the network actually report about a show: what they sold,
   what the load-in was really like, who walked the aisles, and whether they
   would go back. This is the layer the editorial estimates are trying to
   approximate, and every report moves a show closer to the truth.

   THREE VISIBILITY TIERS, and the difference matters:

     private     yours alone. Never leaves your account. Not counted in any
                 consensus, not visible to the network, not visible to us.
     anonymous   visible to members, author withheld. Counted in consensus.
     attributed  visible to members with your name on it. Counted, and
                 weighted slightly higher, because a name is accountability.

   Enforcement is server-side. This file decides what to SEND; the Worker
   decides what you may READ, and a private report is never in a response.
   Nothing here is a security boundary — see worker/src/index.js.

   Classic script (see core.js). Publishes window.ASTIntel.
   ========================================================================== */
window.ASTIntel = (function () {
  'use strict';

  var A = window.AST;
  var F = window.ASTFit;

  var DB_KEY = 'artShowTracker.intel';
  var PROFILE_KEY = 'artShowTracker.artistProfile';
  var SCHEMA_VERSION = 1;

  var VISIBILITIES = [
    { value:'private', label:'Private',
      note:'Yours alone. Never shared, never counted in the network numbers.' },
    { value:'anonymous', label:'Anonymous to the network',
      note:'Members see the report. Nobody sees it was you.' },
    { value:'attributed', label:'Signed',
      note:'Members see the report with your name on it. Carries the most weight.' }
  ];

  var WOULD_RETURN = [
    { value:'yes', label:'Yes' },
    { value:'maybe', label:'Depends' },
    { value:'no', label:'No' }
  ];

  var WEATHER = [
    { value:'none', label:'No impact' },
    { value:'minor', label:'Minor' },
    { value:'significant', label:'Significant' },
    { value:'severe', label:'Lost a day or more' }
  ];

  /* ---- 1. THE RECORD -----------------------------------------------------
     One artist, one show, one year. Everything optional: a report that only
     says "load-in was a nightmare, 4 out of 5 collectors, would go back" is
     still worth having. Empty sections are dropped on save rather than
     stored as a wall of nulls.                                              */
  function makeReport(input) {
    input = input || {};
    var now = new Date().toISOString();
    return {
      id: input.id || newId(),
      showId: input.showId || '',
      year: clampYear(input.year),
      authorId: input.authorId || '',
      authorName: input.authorName || '',
      discipline: F.DISCIPLINE_BY_KEY[input.discipline] ? input.discipline : '',
      priceBand: input.priceBand || '',
      visibility: ['private','anonymous','attributed'].indexOf(input.visibility) !== -1
        ? input.visibility : 'private',

      /* Hard numbers. The reason artists join, and the reason the privacy
         model has to hold. Nulls throughout — a blank is not a zero. */
      results: {
        grossSales:    num(input.results && input.results.grossSales),
        piecesSold:    num(input.results && input.results.piecesSold),
        highestSale:   num(input.results && input.results.highestSale),
        boothFeePaid:  num(input.results && input.results.boothFeePaid),
        juryFeePaid:   num(input.results && input.results.juryFeePaid),
        travelCost:    num(input.results && input.results.travelCost),
        lodgingCost:   num(input.results && input.results.lodgingCost),
        otherCost:     num(input.results && input.results.otherCost)
      },

      /* Operational reality. Low-sensitivity, high-utility, and the section
         where a glass artist's needs diverge hardest from a painter's. */
      logistics: {
        loadIn:            rate5(input.logistics && input.logistics.loadIn),
        loadOut:           rate5(input.logistics && input.logistics.loadOut),
        boothLocation:     rate5(input.logistics && input.logistics.boothLocation),
        parking:           rate5(input.logistics && input.logistics.parking),
        security:          rate5(input.logistics && input.logistics.security),
        staffResponse:     rate5(input.logistics && input.logistics.staffResponse),
        powerAvailable:    tri(input.logistics && input.logistics.powerAvailable),
        vehicleAccess:     tri(input.logistics && input.logistics.vehicleAccess),
        weatherImpact:     pick(WEATHER, input.logistics && input.logistics.weatherImpact),
        juryTurnaroundDays: num(input.logistics && input.logistics.juryTurnaroundDays)
      },

      /* Who was actually in the aisle. */
      crowd: {
        buyingIntent:    rate5(input.crowd && input.crowd.buyingIntent),
        collectorMix:    rate5(input.crowd && input.crowd.collectorMix),
        tradeTraffic:    rate5(input.crowd && input.crowd.tradeTraffic),
        pricePointMoved: num(input.crowd && input.crowd.pricePointMoved),
        repeatBuyers:    tri(input.crowd && input.crowd.repeatBuyers),
        gateMatchedClaim: tri(input.crowd && input.crowd.gateMatchedClaim)
      },

      /* The same ten factors the editorial model scores, so consensus can be
         held against the estimate rather than living in a separate silo. */
      factors: pickFactors(input.factors),

      wouldReturn: pick(WOULD_RETURN, input.wouldReturn),
      notes: String(input.notes || '').slice(0, 4000),
      images: Array.isArray(input.images) ? input.images.slice(0, 8) : [],

      deletedAt: input.deletedAt || null,
      createdAt: input.createdAt || now,
      updatedAt: input.updatedAt || now
    };
  }

  function newId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'in-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }
  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return isFinite(n) && n >= 0 ? n : null;
  }
  function rate5(v) {
    var n = Math.round(Number(v));
    return isFinite(n) && n >= 1 && n <= 5 ? n : null;
  }
  function tri(v) { return v === true || v === false ? v : null; }
  function pick(list, v) {
    for (var i = 0; i < list.length; i++) if (list[i].value === v) return v;
    return null;
  }
  function clampYear(v) {
    var n = Math.round(Number(v));
    var thisYear = new Date().getFullYear();
    if (!isFinite(n) || n < 2000 || n > thisYear + 3) return thisYear;
    return n;
  }
  function pickFactors(f) {
    var out = {};
    F.FACTOR_KEYS.forEach(function (k) {
      var n = Math.round(Number(f && f[k]));
      out[k] = isFinite(n) && n >= 1 && n <= 10 ? n : null;
    });
    return out;
  }

  /** Net, computed rather than asked for — artists disagree about what counts,
      and a derived figure is comparable across reports. Null unless there is a
      gross to net down from. */
  function netOf(report) {
    var r = report.results || {};
    if (r.grossSales == null) return null;
    var costs = ['boothFeePaid','juryFeePaid','travelCost','lodgingCost','otherCost']
      .reduce(function (a, k) { return a + (r[k] || 0); }, 0);
    return Math.round((r.grossSales - costs) * 100) / 100;
  }

  /* ---- 2. THE CONDUCT STANDARD -------------------------------------------
     This is a professional intelligence network, not a complaints board. A
     show director who ran a bad jury is a fact worth recording; a show
     director who is "a liar and a crook" is a lawsuit and a dead network.

     The check below is advisory by design. It cannot read intent and it will
     not pretend to — it flags the shapes that rants take, shows the artist
     what it caught, and asks them to put it in business terms. They can send
     it anyway. What it does do is make the standard impossible to miss at the
     one moment it matters, which is more than a terms-of-service page ever
     achieves.

     Anonymous reports are held to a stricter bar than signed ones, because
     anonymity is where the drama hides.                                     */
  var TONE_PATTERNS = [
    { re: /\b(liar|lying|crook|thief|stole|scam|fraud|corrupt|crooked)\b/i,
      why: 'accuses someone of dishonesty or a crime' },
    { re: /\b(idiot|moron|stupid|incompetent|clueless|useless|pathetic|clown)\b/i,
      why: 'attacks a person rather than describing what happened' },
    { re: /\b(never\s+(?:apply|go|do|trust)|avoid\s+(?:this|at\s+all))\b/i,
      why: 'reads as a verdict rather than a report — give the numbers and let the reader decide' },
    { re: /\b(hates?|despise|disgusting|disgrace|joke of a|worst\s+\w+\s+ever)\b/i,
      why: 'is written in heat' },
    { re: /\b(rude|nasty|condescending|dismissive|arrogant)\b.{0,40}\b(director|staff|jury|organiser|organizer|promoter)\b/i,
      why: 'characterises a person; say what they did or failed to do instead' },
    { re: /\b(?:director|promoter|organiser|organizer)\b.{0,30}\b(?:should be|needs to be)\b.{0,20}\b(?:fired|removed|replaced|sued)\b/i,
      why: 'calls for consequences against an individual' },
    { re: /!{2,}/, why: 'is shouting' },
    { re: /\b[A-Z]{5,}\b(?!\s*(?:LLC|USA|ZAPP|NFS|POS))/, why: 'is shouting' }
  ];

  /**
   * Look at prose before it is sent. Returns { flags: [...], level }.
   * `level` is 'clear', 'review' or 'strong' — nothing here blocks a save.
   */
  function reviewTone(text, visibility) {
    var t = String(text || '');
    if (!t.trim()) return { flags: [], level: 'clear' };
    var flags = [];
    TONE_PATTERNS.forEach(function (p) {
      var m = t.match(p.re);
      if (m) flags.push({ matched: m[0], why: p.why });
    });
    if (!flags.length) return { flags: [], level: 'clear' };
    /* An anonymous report trips into the stronger warning one flag sooner. */
    var threshold = visibility === 'anonymous' ? 1 : 2;
    return { flags: flags, level: flags.length >= threshold ? 'strong' : 'review' };
  }

  var CONDUCT = {
    title: 'What belongs in a report',
    lines: [
      'This is business intelligence for working artists. Write what a peer needs in order to decide whether to apply.',
      'Numbers, logistics and what the crowd actually bought are the whole point. Put them in even when the weekend went badly — a bad result reported plainly is worth more to the network than a good one left out.',
      'You can say a jury ran three weeks late, that load-in was chaotic, or that the gate was nothing like the claim. Those are facts and they are useful.',
      'Do not use this to go after a person. If you had a bad exchange with a director, describe what happened to your business, not what you think of them. No reputations get destroyed here.',
      'Save the drama for drama class. This is business, not emotion.'
    ]
  };

  /* ---- 3. CONSENSUS ------------------------------------------------------
     What the network collectively says about a show. Private reports are
     excluded at every stage, and a consensus is only offered once enough
     reports exist that it means something.

     MIN_REPORTS exists so a single strong opinion cannot present itself as
     the network's view. Below it, reports are readable individually but no
     aggregate is published and the editorial estimate keeps the floor.      */
  var MIN_REPORTS = 3;

  /* A signed report counts for slightly more than an anonymous one. Not
     enough to let three friends outvote the field — enough that putting your
     name to a number means something. */
  var WEIGHT = { attributed: 1.25, anonymous: 1.0 };

  function consensus(reports, disciplineKey) {
    var shared = (reports || []).filter(function (r) {
      return r.visibility !== 'private' && !r.deletedAt;
    });
    var scoped = disciplineKey
      ? shared.filter(function (r) { return r.discipline === disciplineKey; })
      : shared;

    /* Fall back to the whole field when one discipline is too thin on its
       own. The caller is told which happened so the UI can say so. */
    var used = scoped.length >= MIN_REPORTS ? scoped : shared;
    var scope = scoped.length >= MIN_REPORTS ? 'discipline' : 'all';

    if (used.length < MIN_REPORTS) {
      return { ready: false, count: shared.length, need: MIN_REPORTS,
               inDiscipline: scoped.length, scope: scope, factors: {}, money: null };
    }

    var factors = {};
    F.FACTOR_KEYS.forEach(function (k) {
      var sum = 0, w = 0;
      used.forEach(function (r) {
        var v = r.factors && r.factors[k];
        if (v == null) return;
        var weight = WEIGHT[r.visibility] || 1;
        sum += v * weight; w += weight;
      });
      factors[k] = w ? Math.round(sum / w * 10) / 10 : null;
    });

    return {
      ready: true,
      count: used.length,
      inDiscipline: scoped.length,
      scope: scope,
      factors: factors,
      money: moneyStats(used),
      logistics: logisticsStats(used),
      wouldReturn: returnSplit(used)
    };
  }

  /* Medians, not means. One artist having a career weekend should not move
     the number everyone else plans against. */
  function moneyStats(reports) {
    var gross = compact(reports.map(function (r) { return r.results.grossSales; }));
    var net = compact(reports.map(netOf));
    var high = compact(reports.map(function (r) { return r.results.highestSale; }));
    var pieces = compact(reports.map(function (r) { return r.results.piecesSold; }));
    if (!gross.length && !net.length) return null;
    return {
      n: reports.length,
      grossMedian: median(gross), grossRange: range(gross),
      netMedian: median(net), netRange: range(net),
      highestSaleMedian: median(high),
      piecesMedian: median(pieces),
      /* Average sale price is derived per report and then medianed, rather
         than gross-median over pieces-median, which would be meaningless. */
      avgSaleMedian: median(compact(reports.map(function (r) {
        if (!r.results.grossSales || !r.results.piecesSold) return null;
        return r.results.grossSales / r.results.piecesSold;
      })))
    };
  }

  function logisticsStats(reports) {
    var out = {};
    ['loadIn','loadOut','boothLocation','parking','security','staffResponse'].forEach(function (k) {
      out[k] = median(compact(reports.map(function (r) { return r.logistics[k]; })));
    });
    out.powerAvailable = majority(reports.map(function (r) { return r.logistics.powerAvailable; }));
    out.vehicleAccess = majority(reports.map(function (r) { return r.logistics.vehicleAccess; }));
    return out;
  }

  function returnSplit(reports) {
    var t = { yes:0, maybe:0, no:0 };
    reports.forEach(function (r) { if (t[r.wouldReturn] != null) t[r.wouldReturn]++; });
    return t;
  }

  function compact(a) { return a.filter(function (v) { return v != null && isFinite(v); }); }
  function median(a) {
    if (!a.length) return null;
    var s = a.slice().sort(function (x, y) { return x - y; });
    var m = Math.floor(s.length / 2);
    var v = s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    return Math.round(v * 100) / 100;
  }
  function range(a) {
    if (!a.length) return null;
    var s = a.slice().sort(function (x, y) { return x - y; });
    return { low: s[0], high: s[s.length - 1] };
  }
  function majority(vals) {
    var t = 0, f = 0;
    vals.forEach(function (v) { if (v === true) t++; else if (v === false) f++; });
    if (!t && !f) return null;
    return t === f ? null : t > f;
  }

  /** Shape the consensus so ASTFit.scoreShow can consume it directly. */
  function consensusForScoring(reports, disciplineKey) {
    var c = consensus(reports, disciplineKey);
    return c.ready ? c.factors : null;
  }

  /* ---- 3b. LENSES --------------------------------------------------------
     Three ways to rank the same 236 shows:

       model    the editorial estimate, with member consensus replacing it
                wherever enough artists have reported. Every show has a score.
       mine     only what YOU found. Shows you have never worked score null.
       network  only what the network found, and only where the consensus
                threshold is met.

     The point of separating them is that they answer different questions.
     "Which shows suit work like mine" is a different question from "which
     shows have actually paid me", and a season is planned with both.

     A lens never falls back to the layer beneath it. A reported lens that
     quietly borrows an estimate is not a reported lens.                     */
  var LENSES = [
    { key:'model', label:'Model fit',
      note:'The estimate, corrected by member reports wherever there are enough of them.' },
    { key:'mine', label:'My results',
      note:'Only shows you have reported on, scored from your own numbers.' },
    { key:'network', label:'The network',
      note:'Only shows the network has reported on, scored from members\' numbers.' }
  ];

  /** Reports this artist wrote. In solo mode that is all of them by
      definition — they are on this device. Over the network the server
      stamps `mine`, and a private report is always the reader's own. */
  function mineOf(reports) {
    return (reports || []).filter(function (r) {
      if (r.deletedAt) return false;
      if (r.visibility === 'private') return true;
      if (r.mine === true) return true;
      return store.kind === 'local';
    });
  }

  /**
   * Factors and money for one show under one lens.
   * Returns { ready, factors, count, money, reason } — `reason` says why a
   * lens has nothing to show, so the UI can be specific instead of blank.
   */
  function lens(reports, mode, disciplineKey) {
    reports = (reports || []).filter(function (r) { return !r.deletedAt; });

    if (mode === 'mine') {
      var mine = mineOf(reports);
      if (!mine.length) {
        return { ready:false, factors:{}, count:0, money:null,
                 reason:'You have not reported on this show.' };
      }
      var f = {};
      F.FACTOR_KEYS.forEach(function (k) {
        f[k] = median(compact(mine.map(function (r) { return r.factors && r.factors[k]; })));
      });
      return { ready:true, factors:f, count:mine.length, money:moneyStats(mine),
               logistics:logisticsStats(mine), wouldReturn:returnSplit(mine) };
    }

    if (mode === 'network') {
      var c = consensus(reports, disciplineKey);
      if (!c.ready) {
        var shared = reports.filter(function (r) { return r.visibility !== 'private'; }).length;
        return { ready:false, factors:{}, count:shared, money:null,
                 reason: shared
                   ? shared + ' report' + (shared === 1 ? '' : 's') + ' so far — ' +
                     MIN_REPORTS + ' are needed before the network publishes a number.'
                   : 'Nobody has reported on this show yet.' };
      }
      return c;
    }

    /* model — always ready; the editorial layer covers every show. */
    var cons = consensus(reports, disciplineKey);
    return { ready:true, factors: cons.ready ? cons.factors : {},
             count: cons.ready ? cons.count : 0,
             money: cons.money || null, blended:true };
  }

  /* ---- 4. STORE ----------------------------------------------------------
     Same shape as core.js's Store so the two behave alike: local is the
     immediate read/write path and stays authoritative offline, and a remote
     is reconciled behind it. Until a Worker URL is configured, local IS the
     whole system and the app is fully usable solo.                          */
  function readDb() {
    var raw = null;
    try { raw = JSON.parse(localStorage.getItem(DB_KEY) || 'null'); } catch (e) { raw = null; }
    if (!raw || typeof raw !== 'object') raw = { schemaVersion: SCHEMA_VERSION, reports: [] };
    if (!Array.isArray(raw.reports)) raw.reports = [];
    return raw;
  }
  function writeDb(db) {
    try { localStorage.setItem(DB_KEY, JSON.stringify(db)); return true; }
    catch (e) { return false; }
  }

  var LocalStore = {
    kind: 'local',
    list: function (showId) {
      var rows = readDb().reports.filter(function (r) { return !r.deletedAt; });
      return Promise.resolve(showId
        ? rows.filter(function (r) { return r.showId === showId; })
        : rows);
    },
    upsert: function (report) {
      var db = readDb();
      var rec = makeReport(report);
      rec.updatedAt = new Date().toISOString();
      var i = db.reports.findIndex(function (r) { return r.id === rec.id; });
      if (i === -1) db.reports.push(rec); else db.reports[i] = rec;
      writeDb(db);
      return Promise.resolve(rec);
    },
    remove: function (id) {
      var db = readDb();
      var i = db.reports.findIndex(function (r) { return r.id === id; });
      if (i !== -1) {
        db.reports[i].deletedAt = new Date().toISOString();
        db.reports[i].updatedAt = db.reports[i].deletedAt;
        writeDb(db);
      }
      return Promise.resolve();
    },
    stats: function () {
      var rows = readDb().reports.filter(function (r) { return !r.deletedAt; });
      var shows = {};
      rows.forEach(function (r) { shows[r.showId] = 1; });
      return Promise.resolve({ reports: rows.length, shows: Object.keys(shows).length });
    }
  };

  /* The network store. Every call is authenticated and the server decides
     what comes back — a private report belonging to someone else is not
     filtered out on this side, it is never sent. */
  function NetworkStore(client) {
    return {
      kind: 'network',
      list: function (showId) {
        return client.get('/api/intel' + (showId ? '?show=' + encodeURIComponent(showId) : ''))
          .then(function (rows) { return (rows || []).map(makeReport); });
      },
      upsert: function (report) {
        var rec = makeReport(report);
        return client.post('/api/intel', rec).then(function (row) { return makeReport(row || rec); });
      },
      remove: function (id) { return client.del('/api/intel/' + encodeURIComponent(id)); },
      stats: function () { return client.get('/api/intel/stats'); }
    };
  }

  /* A private report is the artist's own business and never leaves the
     device, whatever store is live. This wrapper is belt-and-braces on top of
     the server rule, so a bug in one place cannot leak a private report. */
  function SplitStore(remote) {
    return {
      kind: 'split',
      list: function (showId) {
        return Promise.all([LocalStore.list(showId), remote.list(showId)])
          .then(function (both) {
            var mine = both[0].filter(function (r) { return r.visibility === 'private'; });
            var theirs = both[1].filter(function (r) { return r.visibility !== 'private'; });
            var seen = {};
            return mine.concat(theirs).filter(function (r) {
              if (seen[r.id]) return false;
              seen[r.id] = 1; return true;
            });
          });
      },
      upsert: function (report) {
        var rec = makeReport(report);
        return rec.visibility === 'private'
          ? LocalStore.upsert(rec)
          : LocalStore.upsert(rec).then(function () { return remote.upsert(rec); });
      },
      remove: function (id) {
        return LocalStore.remove(id).then(function () {
          return remote.remove(id).catch(function () { /* local delete stands */ });
        });
      },
      stats: function () { return remote.stats().catch(function () { return LocalStore.stats(); }); }
    };
  }

  var store = LocalStore;
  function useNetwork(client) { store = client ? SplitStore(NetworkStore(client)) : LocalStore; }

  /* ---- 5. ARTIST PROFILE -------------------------------------------------- */
  /* The lens lives here rather than in fit.js: which data source you are
     ranking by is a property of the intel layer, and the model has no reason
     to know the concept exists. F.makeProfile drops keys it does not own, so
     it is reattached after. */
  function withLens(clean, raw) {
    var keys = LENSES.map(function (l) { return l.key; });
    clean.lens = keys.indexOf(raw && raw.lens) !== -1 ? raw.lens : 'model';
    return clean;
  }
  function getProfile() {
    var raw = null;
    try { raw = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null'); } catch (e) {}
    raw = raw || {};
    return withLens(F.makeProfile(raw), raw);
  }
  function setProfile(p) {
    var clean = withLens(F.makeProfile(p), p);
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(clean)); } catch (e) {}
    return clean;
  }

  return {
    VISIBILITIES: VISIBILITIES,
    WOULD_RETURN: WOULD_RETURN,
    WEATHER: WEATHER,
    CONDUCT: CONDUCT,
    MIN_REPORTS: MIN_REPORTS,
    makeReport: makeReport,
    netOf: netOf,
    reviewTone: reviewTone,
    consensus: consensus,
    consensusForScoring: consensusForScoring,
    LENSES: LENSES,
    lens: lens,
    mineOf: mineOf,
    getProfile: getProfile,
    setProfile: setProfile,
    useNetwork: useNetwork,
    get store() { return store; }
  };
})();
