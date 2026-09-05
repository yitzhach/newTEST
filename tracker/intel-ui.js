/* ==========================================================================
   Show Ledger — members' intel UI

   Three surfaces:
     the profile bar    what you make, what it sells for, what you want
     the show drawer    the fit breakdown, the facts and where they came from,
                        and what the network has reported
     the report form    what you put in

   The design rule running through all of it: a number is never shown without
   saying where it came from. An editorial estimate, a fact off a show's own
   site and a median of nine artists' reported gross are three different kinds
   of claim, and the page has to look different for each or it is lying by
   typography.

   Classic script (see core.js). Publishes window.ASTIntelUI.
   ========================================================================== */
window.ASTIntelUI = (function () {
  'use strict';

  var A = window.AST;
  var F = window.ASTFit;
  var I = window.ASTIntel;
  var M = window.ASTMembers;
  var esc = A.esc;

  var host = null;          /* the drawer element, created once */
  var onProfileChange = null;
  var reportsCache = {};    /* showId -> [report] */

  /* ---- Small helpers ------------------------------------------------------ */
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function money(v) {
    if (v == null || !isFinite(v)) return '—';
    return '$' + Math.round(v).toLocaleString('en-US');
  }
  function scoreClass(v) {
    if (v == null) return 'sc-none';
    if (v >= 8.5) return 'sc-top';
    if (v >= 7.5) return 'sc-high';
    if (v >= 6.5) return 'sc-mid';
    if (v >= 5) return 'sc-low';
    return 'sc-poor';
  }

  /* A provenance chip. The whole honesty argument of the tool lives in this
     function: four visually distinct states, and `editorial` never gets to
     look like `verified`. */
  var PROV_LABEL = {
    verified:     { text:'verified',     title:'Read directly from the show\'s own prospectus or application page.' },
    corroborated: { text:'corroborated', title:'Two or more independent sources agree on this.' },
    search:       { text:'unconfirmed',  title:'Found in a search result and not yet confirmed against the source page. Open the link before you rely on it.' },
    editorial:    { text:'estimate',     title:'An informed editorial estimate, not sourced data.' },
    member:       { text:'reported',     title:'Reported by artists in the network.' }
  };
  function provChip(entry) {
    if (!entry) return '';
    var meta = PROV_LABEL[entry.status] || PROV_LABEL.editorial;
    var tip = meta.title + (entry.basis ? '\n\n' + entry.basis : '') +
              (entry.checked ? '\n\nChecked ' + entry.checked : '');
    var inner = esc(meta.text);
    if (entry.source) {
      return '<a class="prov prov-' + esc(entry.status) + '" href="' + esc(entry.source) +
             '" target="_blank" rel="noopener noreferrer" title="' + esc(tip) + '">' + inner + ' &#8599;</a>';
    }
    return '<span class="prov prov-' + esc(entry.status) + '" title="' + esc(tip) + '">' + inner + '</span>';
  }

  /* ---- 1. PROFILE BAR ----------------------------------------------------- */
  function mountProfileBar(mount, onChange) {
    onProfileChange = onChange;
    var p = I.getProfile();

    mount.innerHTML =
      '<div class="pf-row">' +
        '<div class="pf-field">' +
          '<label class="label" for="pfDiscipline">I make</label>' +
          '<select class="control" id="pfDiscipline">' +
            F.DISCIPLINES.map(function (d) {
              return '<option value="' + esc(d.key) + '"' + (d.key === p.discipline ? ' selected' : '') +
                     '>' + esc(d.label) + '</option>';
            }).join('') +
          '</select>' +
        '</div>' +
        '<div class="pf-field">' +
          '<label class="label" for="pfBand">It sells for</label>' +
          '<select class="control" id="pfBand">' +
            F.PRICE_BANDS.map(function (b) {
              return '<option value="' + esc(b.key) + '"' + (b.key === p.priceBand ? ' selected' : '') +
                     '>' + esc(b.label) + '</option>';
            }).join('') +
          '</select>' +
        '</div>' +
        '<div class="pf-field">' +
          '<label class="label" for="pfStrategy">This season I want</label>' +
          '<select class="control" id="pfStrategy">' +
            F.STRATEGIES.map(function (s) {
              return '<option value="' + esc(s.key) + '"' + (s.key === p.strategy ? ' selected' : '') +
                     '>' + esc(s.label) + '</option>';
            }).join('') +
          '</select>' +
        '</div>' +
        '<div class="pf-field">' +
          '<label class="label" for="pfLens">Score shows by</label>' +
          '<select class="control" id="pfLens">' +
            I.LENSES.map(function (l) {
              return '<option value="' + esc(l.key) + '"' + (l.key === p.lens ? ' selected' : '') +
                     '>' + esc(l.label) + '</option>';
            }).join('') +
          '</select>' +
        '</div>' +
        '<button class="btn-mini pf-why" id="pfWhy" type="button" ' +
          'title="What these settings do to the ranking">Why this order?</button>' +
      '</div>' +
      '<p class="pf-note" id="pfNote"></p>';

    function pushProfile() {
      var next = I.setProfile({
        discipline: mount.querySelector('#pfDiscipline').value,
        priceBand: mount.querySelector('#pfBand').value,
        strategy: mount.querySelector('#pfStrategy').value,
        lens: mount.querySelector('#pfLens').value
      });
      renderNote(mount, next);
      if (onProfileChange) onProfileChange(next);
    }
    ['#pfDiscipline', '#pfBand', '#pfStrategy', '#pfLens'].forEach(function (sel) {
      mount.querySelector(sel).addEventListener('change', pushProfile);
    });
    mount.querySelector('#pfWhy').addEventListener('click', function () { openWeights(); });
    renderNote(mount, p);
    return p;
  }

  function renderNote(mount, p) {
    var d = F.DISCIPLINE_BY_KEY[p.discipline];
    var b = F.PRICE_BANDS.filter(function (x) { return x.key === p.priceBand; })[0];
    var l = I.LENSES.filter(function (x) { return x.key === p.lens; })[0];
    mount.querySelector('#pfNote').innerHTML =
      esc(d.blurb) + ' <span class="pf-sep">·</span> ' + esc(b.note) +
      (l && l.key !== 'model'
        ? ' <span class="pf-sep">·</span> <strong>' + esc(l.note) + '</strong>'
        : '');
  }

  /* The weights panel. An artist who cannot see why a show ranks where it
     does has no reason to trust the ranking, so the arithmetic is on display
     rather than behind a "methodology" link nobody opens. */
  function openWeights() {
    var p = I.getProfile();
    var w = F.weightsFor(p);
    var d = F.DISCIPLINE_BY_KEY[p.discipline];
    var rows = F.FACTORS.map(function (f, i) {
      return '<tr><th scope="row">' + esc(f.label) + '</th>' +
             '<td class="w-bar"><span style="width:' + (w[i] / Math.max.apply(null, w) * 100).toFixed(1) + '%"></span></td>' +
             '<td class="w-num">' + w[i].toFixed(1) + '%</td></tr>';
    }).join('');
    drawer('How your ranking is built',
      '<p class="lede">' + esc(d.label) + ' at ' +
        esc(F.PRICE_BANDS.filter(function (x) { return x.key === p.priceBand; })[0].label) + '.</p>' +
      '<ul class="drivers">' + d.drivers.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>' +
      '<table class="wtable"><tbody>' + rows + '</tbody></table>' +
      '<p class="fine">Weights come from your discipline, tilted by your price band and what you want out of the season. ' +
      'A factor no one has scored for a show drops out of that show\'s average rather than counting as a five — ' +
      'so a thinly researched show cannot borrow confidence it has not earned.</p>');
  }

  /* ---- 2. SHOW DRAWER ----------------------------------------------------- */
  function openShow(show, opts) {
    opts = opts || {};
    var p = I.getProfile();
    I.store.list(show.id).then(function (reports) {
      reportsCache[show.id] = reports;
      var cons = I.consensus(reports, p.discipline);
      var active = I.lens(reports, p.lens, p.discipline);

      /* Under a reported lens the score comes only from reports. Under the
         model lens it comes from the estimate, corrected by consensus. */
      var scored = p.lens === 'model'
        ? F.scoreShow(show, p, { memberConsensus: cons.ready ? cons.factors : null })
        : F.scoreShow(show, p, { factorsOnly: active.ready ? active.factors : {} });

      var gates = F.gates(show, p);

      drawer(show.name,
             showBody(show, p, scored, gates, cons, reports, active),
             function (root) { wireShow(root, show, p); });
    });
  }

  /* Which report tab the drawer opens on. Sticky within a session, because an
     artist comparing their own results across shows should not have to click
     the same tab on every one. */
  var reportTab = 'mine';

  function wireShow(root, show, p) {
    var add = root.querySelector('#btnAddIntel');
    if (add) add.addEventListener('click', function () { openReport(show); });

    root.querySelectorAll('[data-edit-report]').forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-edit-report');
        var rec = (reportsCache[show.id] || []).filter(function (r) { return r.id === id; })[0];
        if (rec) openReport(show, rec);
      });
    });

    /* Jump from the header straight to the reports, which is where an artist
       who has worked a show actually wants to land. */
    var jump = root.querySelector('#btnReadReport');
    if (jump) jump.addEventListener('click', function (e) {
      e.preventDefault();
      var target = root.querySelector('#reportSection');
      if (target) target.scrollIntoView({ behavior:'smooth', block:'start' });
    });

    root.querySelectorAll('[data-report-tab]').forEach(function (b) {
      b.addEventListener('click', function () {
        reportTab = b.getAttribute('data-report-tab');
        openShow(show);
      });
    });
  }

  function showBody(show, p, scored, gates, cons, reports, active) {
    var f = show.facts || {};
    var place = [show.city, show.state].filter(Boolean).join(', ');

    /* --- header --- */
    var head =
      '<div class="sd-head">' +
        '<div class="sd-score ' + scoreClass(scored.fit) + '">' +
          '<span class="sd-num">' + (scored.fit == null ? '—' : scored.fit.toFixed(2)) + '</span>' +
          '<span class="sd-cap">fit</span>' +
        '</div>' +
        '<div class="sd-headmeta">' +
          '<p class="sd-place">' + esc(place) + '</p>' +
          '<p class="sd-dates">' + esc(A.fmtRange(f.startDate, f.endDate) || 'dates not published') +
            (show.datesEstimated ? ' <span class="tag tag-warn" title="This sits in the show\'s usual slot rather than a published 2027 calendar.">estimated</span>' : '') +
          '</p>' +
          '<p class="sd-conf">' +
            'for ' + esc(F.DISCIPLINE_BY_KEY[p.discipline].label.toLowerCase()) +
            ' · scored on ' + Math.round(scored.coverage * 100) + '% of your weighting' +
            ' · ' + esc(evidenceLabel(scored.evidence)) +
          '</p>' +
          readReportLink(reports, p) +
        '</div>' +
      '</div>';

    /* --- gates --- */
    var gateHtml = gates.length
      ? '<ul class="gates">' + gates.map(function (g) {
          return '<li class="gate gate-' + esc(g.level) + '">' + esc(g.text) + '</li>';
        }).join('') + '</ul>'
      : '';

    /* --- factor bars --- */
    var maxW = Math.max.apply(null, scored.weights);
    var bars = F.FACTORS.map(function (fac, i) {
      var v = scored.scores[fac.key];

      /* Where the number on this row actually came from. Under a reported
         lens it is a report and must say so — an estimate chip over an
         artist's own figure is exactly the mislabelling this whole layer
         exists to prevent. */
      var prov;
      if (p.lens === 'mine' && active && active.ready && active.factors[fac.key] != null) {
        prov = { status:'member',
                 basis:'Your own rating' + (active.count > 1 ? ', median of ' + active.count + ' reports' : '') };
      } else if (p.lens === 'network' && active && active.ready && active.factors[fac.key] != null) {
        prov = { status:'member',
                 basis:'Median of ' + active.count + ' member report' + (active.count === 1 ? '' : 's') };
      } else if (p.lens === 'model' && cons.ready && cons.factors[fac.key] != null) {
        prov = { status:'member',
                 basis:'Median of ' + cons.count + ' member report' + (cons.count === 1 ? '' : 's') +
                       ', replacing the estimate' };
      } else {
        prov = (show.provenance || {})[fac.key];
      }
      return '<tr class="' + (v == null ? 'is-unscored' : '') + '">' +
        '<th scope="row"><span class="fac-name">' + esc(fac.label) + '</span>' +
          '<span class="fac-help" title="' + esc(fac.help) + '">?</span></th>' +
        '<td class="fac-bar">' +
          (v == null
            ? '<span class="fac-missing">not scored — drops out of your average</span>'
            : '<span class="fb"><i style="width:' + (v * 10) + '%"></i></span>') +
        '</td>' +
        '<td class="fac-val">' + (v == null ? '—' : v) + '</td>' +
        '<td class="fac-w" title="This factor is ' + scored.weights[i].toFixed(1) +
          '% of your ranking">' +
          '<span class="wdot" style="opacity:' + (0.25 + 0.75 * scored.weights[i] / maxW).toFixed(2) + '"></span>' +
          scored.weights[i].toFixed(0) + '%</td>' +
        '<td class="fac-prov">' + provChip(prov) + '</td>' +
      '</tr>';
    }).join('');

    /* --- facts --- */
    var factRows = [
      ['Application deadline', f.applyBy ? A.fmtDay(f.applyBy) : null, 'applyBy'],
      ['Jury fee', f.juryFee == null ? null : money(f.juryFee), 'juryFee'],
      ['Booth fee', f.boothFee == null ? null : money(f.boothFee) +
        (f.boothFeeNote ? ' <span class="muted-inline">' + esc(f.boothFeeNote) + '</span>' : ''), 'boothFee'],
      ['Artists accepted', f.boothCount, 'boothCount'],
      ['Acceptance rate', f.acceptanceRatePct == null ? null : f.acceptanceRatePct + '%', 'acceptanceRatePct'],
      ['Attendance', f.attendance == null ? null : Number(f.attendance).toLocaleString('en-US'), 'attendance'],
      ['Venue', f.venue, 'venue'],
      ['Setting', f.indoorOutdoor, 'indoorOutdoor'],
      ['Vehicle access to booth', f.vehicleAccessToBooth == null ? null : (f.vehicleAccessToBooth ? 'Yes' : 'No'), 'vehicleAccessToBooth'],
      ['Booth power', f.powerAvailable == null ? null : (f.powerAvailable ? 'Yes' : 'No'), 'powerAvailable']
    ].map(function (row) {
      var known = row[1] != null && row[1] !== '';
      return '<tr' + (known ? '' : ' class="is-unknown"') + '>' +
        '<th scope="row">' + esc(row[0]) + '</th>' +
        '<td>' + (known ? row[1] : '<span class="unknown">not known</span>') + '</td>' +
        '<td>' + (known ? provChip((show.provenance || {})[row[2]]) : '') + '</td></tr>';
    }).join('');

    var links = [];
    if (f.officialUrl) links.push('<a class="btn-mini" href="' + esc(f.officialUrl) +
      '" target="_blank" rel="noopener noreferrer">Show site &#8599;</a>');
    if (f.applicationUrl) links.push('<a class="btn-mini" href="' + esc(f.applicationUrl) +
      '" target="_blank" rel="noopener noreferrer">Application &#8599;</a>');

    /* --- network intel --- */
    var intel = intelSection(show, cons, reports, p);

    return head + gateHtml +
      (show.editorialNote
        ? '<p class="sd-note">' + esc(show.editorialNote) +
          ' <span class="prov prov-editorial" title="Editorial read, not sourced data.">estimate</span></p>'
        : '') +
      '<h3 class="sd-h">Why it scores what it scores</h3>' +
      '<table class="factable"><tbody>' + bars + '</tbody></table>' +
      '<h3 class="sd-h">The facts</h3>' +
      '<table class="facttable"><tbody>' + factRows + '</tbody></table>' +
      (links.length ? '<p class="sd-links">' + links.join(' ') + '</p>' : '') +
      intel;
  }

  /* The top-of-drawer shortcut. Only appears when there is something to read,
     and says whose report it is rather than a generic label. */
  function readReportLink(reports, p) {
    var mine = I.mineOf(reports).length;
    var shared = reports.filter(function (r) {
      return r.visibility !== 'private' && !r.deletedAt;
    }).length;
    if (!mine && !shared) return '';
    var bits = [];
    if (mine) bits.push('your report' + (mine === 1 ? '' : 's'));
    if (shared) bits.push(shared + ' from the network');
    return '<p class="sd-read"><a href="#reportSection" id="btnReadReport">' +
           'Read ' + esc(bits.join(' · ')) + ' &darr;</a></p>';
  }

  function evidenceLabel(e) {
    return { reported:'backed by member reports', verified:'high-confidence estimate',
             estimated:'medium-confidence estimate',
             placeholder:'placeholder — treat as a starting point' }[e] || 'estimate';
  }

  /* Two tabs over the same show: what YOU found, and what the network found.
     They are different claims and the page never merges them — your own
     weekend is not evidence about the show in general, and the network median
     is not what happened to you. */
  function intelSection(show, cons, reports, p) {
    var mine = I.mineOf(reports);
    var shared = reports.filter(function (r) {
      return r.visibility !== 'private' && !r.deletedAt;
    });
    var tab = reportTab === 'network' ? 'network' : 'mine';

    var out = '<h3 class="sd-h" id="reportSection">Reports</h3>' +
      '<div class="rtabs" role="tablist">' +
        '<button type="button" class="rtab' + (tab === 'mine' ? ' on' : '') + '" ' +
          'data-report-tab="mine" role="tab" aria-selected="' + (tab === 'mine') + '">' +
          'Yours <span class="rtab-n">' + mine.length + '</span></button>' +
        '<button type="button" class="rtab' + (tab === 'network' ? ' on' : '') + '" ' +
          'data-report-tab="network" role="tab" aria-selected="' + (tab === 'network') + '">' +
          'The network <span class="rtab-n">' + shared.length + '</span></button>' +
      '</div>';

    out += tab === 'mine' ? minePanel(mine, p) : networkPanel(cons, shared, p);

    out += '<p class="sd-cta"><button class="btn btn-primary" id="btnAddIntel" type="button">' +
      (mine.length ? 'Add another report' : 'Add a report') + '</button></p>';
    return out;
  }

  function minePanel(mine, p) {
    if (!mine.length) {
      return '<p class="intel-empty">You have not reported on this show. ' +
        'Your own numbers are the only ones that tell you whether it works for ' +
        'your work specifically — the network median is a different question.</p>';
    }
    var money = mineMoney(mine);
    var out = '';
    if (money) {
      out += '<div class="intel-stats">' +
        statTile('Gross', money.gross == null ? '—' : money.gross, '') +
        statTile('Net', money.net == null ? '—' : money.net, '') +
        statTile('Avg sale', money.avg == null ? '—' : money.avg, '') +
        statTile('Pieces', money.pieces == null ? '—' : money.pieces, '') +
        '</div>';
    }
    out += '<ul class="reports">' + mine.map(reportCard).join('') + '</ul>';
    return out;
  }

  function mineMoney(mine) {
    var g = [], n = [], pc = [], av = [];
    mine.forEach(function (r) {
      if (r.results.grossSales != null) g.push(r.results.grossSales);
      var net = I.netOf(r);
      if (net != null) n.push(net);
      if (r.results.piecesSold != null) pc.push(r.results.piecesSold);
      if (r.results.grossSales != null && r.results.piecesSold) {
        av.push(r.results.grossSales / r.results.piecesSold);
      }
    });
    if (!g.length && !n.length) return null;
    var avgOf = function (a) {
      if (!a.length) return null;
      return a.reduce(function (x, y) { return x + y; }, 0) / a.length;
    };
    return {
      gross: g.length ? money(avgOf(g)) : null,
      net: n.length ? money(avgOf(n)) : null,
      avg: av.length ? money(avgOf(av)) : null,
      pieces: pc.length ? Math.round(avgOf(pc)) : null
    };
  }

  function networkPanel(cons, shared, p) {
    var out = '';
    if (!cons.ready) {
      out += '<p class="intel-empty">' +
        (shared.length
          ? esc(shared.length + ' report' + (shared.length === 1 ? '' : 's') + ' so far. ') +
            'Numbers stay private until there are ' + I.MIN_REPORTS +
            ', so one weekend cannot pass itself off as the network\'s view.'
          : 'Nothing reported yet. The first report on a show is the most valuable one there is.') +
        '</p>';
    } else {
      var m = cons.money;
      out += '<p class="intel-scope">Median of ' + cons.count + ' report' + (cons.count === 1 ? '' : 's') +
        (cons.scope === 'discipline'
          ? ' from ' + esc(F.DISCIPLINE_BY_KEY[p.discipline].label.toLowerCase()) + ' artists'
          : ' across all disciplines <span class="muted-inline">(too few in yours yet)</span>') + '.</p>';
      if (m) {
        out += '<div class="intel-stats">' +
          statTile('Gross', money(m.grossMedian), m.grossRange ? money(m.grossRange.low) + '–' + money(m.grossRange.high) : '') +
          statTile('Net', money(m.netMedian), m.netRange ? money(m.netRange.low) + '–' + money(m.netRange.high) : '') +
          statTile('Avg sale', money(m.avgSaleMedian), '') +
          statTile('Pieces', m.piecesMedian == null ? '—' : m.piecesMedian, '') +
          statTile('Best sale', money(m.highestSaleMedian), '') +
          '</div>';
      }
      var wr = cons.wouldReturn;
      out += '<p class="intel-return">Would go back: <strong>' + wr.yes + '</strong> yes · ' +
        wr.maybe + ' depends · <strong>' + wr.no + '</strong> no</p>';
    }
    if (shared.length) out += '<ul class="reports">' + shared.map(reportCard).join('') + '</ul>';
    return out;
  }

  function statTile(label, value, sub) {
    return '<div class="stile"><span class="stile-l">' + esc(label) + '</span>' +
      '<span class="stile-v">' + esc(String(value)) + '</span>' +
      (sub ? '<span class="stile-s">' + esc(sub) + '</span>' : '') + '</div>';
  }

  function reportCard(r) {
    var who = r.visibility === 'attributed'
      ? esc(r.authorName || 'A member')
      : (r.visibility === 'private' ? 'You' : 'Anonymous');
    var disc = r.discipline ? F.DISCIPLINE_BY_KEY[r.discipline] : null;
    var net = I.netOf(r);
    var bits = [];
    if (r.results.grossSales != null) bits.push('gross ' + money(r.results.grossSales));
    if (net != null) bits.push('net ' + money(net));
    if (r.results.piecesSold != null) bits.push(r.results.piecesSold + ' pieces');
    if (r.wouldReturn) bits.push('would return: ' + r.wouldReturn);
    return '<li class="report">' +
      '<p class="rep-head"><strong>' + who + '</strong>' +
        (disc ? ' <span class="muted-inline">' + esc(disc.label) + '</span>' : '') +
        ' <span class="muted-inline">' + r.year + '</span>' +
        (r.visibility === 'private' ? ' <span class="tag tag-priv">private</span>' : '') +
        '<button class="btn-mini rep-edit" type="button" data-edit-report="' + esc(r.id) + '">Edit</button>' +
      '</p>' +
      (bits.length ? '<p class="rep-nums">' + esc(bits.join(' · ')) + '</p>' : '') +
      (r.notes ? '<p class="rep-notes">' + esc(r.notes) + '</p>' : '') +
    '</li>';
  }

  /* ---- 3. REPORT FORM ----------------------------------------------------- */
  function openReport(show, existing) {
    var p = I.getProfile();
    var r = existing || I.makeReport({
      showId: show.id, discipline: p.discipline, priceBand: p.priceBand,
      year: guessYear(show)
    });
    var canShare = M.canShare();

    drawer((existing ? 'Edit your report' : 'Report on ') + (existing ? '' : show.name),
      reportForm(show, r, canShare), function (root) { wireForm(root, show, r, canShare); },
      'wide');
  }

  function guessYear(show) {
    var d = show.facts && show.facts.startDate;
    var y = d ? Number(String(d).slice(0, 4)) : new Date().getFullYear();
    return isFinite(y) ? y : new Date().getFullYear();
  }

  function reportForm(show, r, canShare) {
    var conduct =
      '<section class="conduct">' +
        '<h4>' + esc(I.CONDUCT.title) + '</h4>' +
        '<ul>' + I.CONDUCT.lines.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul>' +
      '</section>';

    var visibility =
      '<section class="fgroup">' +
        '<h4>Who sees this</h4>' +
        '<div class="vis-opts">' +
          I.VISIBILITIES.map(function (v) {
            var disabled = !canShare && v.value !== 'private';
            return '<label class="vis' + (disabled ? ' is-disabled' : '') + '">' +
              '<input type="radio" name="vis" value="' + esc(v.value) + '"' +
                (r.visibility === v.value ? ' checked' : '') + (disabled ? ' disabled' : '') + '>' +
              '<span class="vis-l">' + esc(v.label) + '</span>' +
              '<span class="vis-n">' + esc(v.note) + '</span>' +
            '</label>';
          }).join('') +
        '</div>' +
        (canShare ? '' :
          '<p class="hint hint-warn">No network is connected, so everything you write stays on this ' +
          'device. Sharing tiers switch on once the network is configured.</p>') +
      '</section>';

    var money =
      '<section class="fgroup">' +
        '<h4>The numbers</h4>' +
        '<p class="hint">The reason the network exists. Report a bad weekend as readily as a good one — ' +
          'a median built only from wins is worse than no median at all.</p>' +
        '<div class="grid-3">' +
          numField('grossSales', 'Gross sales', r.results.grossSales, '$') +
          numField('piecesSold', 'Pieces sold', r.results.piecesSold, '') +
          numField('highestSale', 'Best single sale', r.results.highestSale, '$') +
        '</div>' +
        '<div class="grid-3">' +
          numField('boothFeePaid', 'Booth fee paid', r.results.boothFeePaid, '$') +
          numField('juryFeePaid', 'Jury fee paid', r.results.juryFeePaid, '$') +
          numField('travelCost', 'Travel', r.results.travelCost, '$') +
        '</div>' +
        '<div class="grid-3">' +
          numField('lodgingCost', 'Lodging', r.results.lodgingCost, '$') +
          numField('otherCost', 'Other costs', r.results.otherCost, '$') +
          '<div class="field net-preview"><span class="label">Net</span>' +
            '<output id="netOut" class="net-val">—</output></div>' +
        '</div>' +
      '</section>';

    var logistics =
      '<section class="fgroup">' +
        '<h4>How it actually ran</h4>' +
        '<p class="hint">The part a prospectus never tells you, and the part that differs most between ' +
          'a painter and someone hauling glass.</p>' +
        '<div class="grid-2">' +
          rateField('loadIn', 'Load-in', r.logistics.loadIn) +
          rateField('loadOut', 'Load-out', r.logistics.loadOut) +
          rateField('boothLocation', 'Booth placement', r.logistics.boothLocation) +
          rateField('parking', 'Parking', r.logistics.parking) +
          rateField('security', 'Overnight security', r.logistics.security) +
          rateField('staffResponse', 'Staff responsiveness', r.logistics.staffResponse) +
        '</div>' +
        '<div class="grid-3">' +
          triField('powerAvailable', 'Booth power', r.logistics.powerAvailable) +
          triField('vehicleAccess', 'Vehicle to booth', r.logistics.vehicleAccess) +
          selField('weatherImpact', 'Weather', I.WEATHER, r.logistics.weatherImpact) +
        '</div>' +
        '<div class="grid-3">' +
          numField('juryTurnaroundDays', 'Days to jury result', r.logistics.juryTurnaroundDays, '') +
        '</div>' +
      '</section>';

    var crowd =
      '<section class="fgroup">' +
        '<h4>Who was in the aisle</h4>' +
        '<div class="grid-2">' +
          rateField('buyingIntent', 'Came to buy', r.crowd.buyingIntent) +
          rateField('collectorMix', 'Collector presence', r.crowd.collectorMix) +
          rateField('tradeTraffic', 'Gallery / designer traffic', r.crowd.tradeTraffic) +
        '</div>' +
        '<div class="grid-3">' +
          numField('pricePointMoved', 'Price point that moved', r.crowd.pricePointMoved, '$') +
          triField('repeatBuyers', 'Repeat buyers found you', r.crowd.repeatBuyers) +
          triField('gateMatchedClaim', 'Gate matched the claim', r.crowd.gateMatchedClaim) +
        '</div>' +
      '</section>';

    var factors =
      '<section class="fgroup">' +
        '<h4>Score the show yourself</h4>' +
        '<p class="hint">The same ten factors the model estimates. Where enough of you agree, ' +
          'your numbers replace the estimate outright. Leave blank what you cannot judge.</p>' +
        '<div class="facgrid">' +
          F.FACTORS.map(function (f) {
            return '<label class="facin" title="' + esc(f.help) + '">' +
              '<span>' + esc(f.short) + '</span>' +
              '<input type="number" min="1" max="10" step="1" data-factor="' + esc(f.key) + '" ' +
                'value="' + (r.factors[f.key] == null ? '' : r.factors[f.key]) + '">' +
            '</label>';
          }).join('') +
        '</div>' +
      '</section>';

    var prose =
      '<section class="fgroup">' +
        '<h4>Anything else a peer should know</h4>' +
        '<textarea class="control" id="repNotes" rows="6" maxlength="4000" ' +
          'placeholder="What would you tell someone deciding whether to apply? Keep it to what happened and what it cost you.">' +
          esc(r.notes) + '</textarea>' +
        '<div class="tone" id="toneBox" hidden></div>' +
      '</section>';

    var meta =
      '<div class="grid-3">' +
        '<div class="field"><label class="label" for="repYear">Year</label>' +
          '<input class="control" id="repYear" type="number" min="2000" max="' +
            (new Date().getFullYear() + 3) + '" value="' + r.year + '"></div>' +
        '<div class="field"><label class="label" for="repDisc">Your medium at this show</label>' +
          '<select class="control" id="repDisc">' +
            F.DISCIPLINES.map(function (d) {
              return '<option value="' + esc(d.key) + '"' + (d.key === r.discipline ? ' selected' : '') +
                '>' + esc(d.label) + '</option>';
            }).join('') + '</select></div>' +
        '<div class="field"><label class="label" for="repName">Name on it (if signed)</label>' +
          '<input class="control" id="repName" type="text" value="' + esc(r.authorName) + '" ' +
            'placeholder="Your name"></div>' +
      '</div>';

    return conduct + meta + visibility + money + logistics + crowd + factors + prose +
      '<p class="err" id="repErr" hidden></p>' +
      '<div class="form-foot">' +
        (r.createdAt && r.id && reportExists(r) ?
          '<button class="btn btn-quiet danger" id="btnRepDelete" type="button">Delete</button>' : '<span></span>') +
        '<span class="foot-right">' +
          '<button class="btn btn-quiet" id="btnRepCancel" type="button">Cancel</button>' +
          '<button class="btn btn-primary" id="btnRepSave" type="button">Save report</button>' +
        '</span>' +
      '</div>';
  }

  function reportExists(r) {
    var rows = reportsCache[r.showId] || [];
    return rows.some(function (x) { return x.id === r.id; });
  }

  function numField(key, label, val, prefix) {
    return '<div class="field"><label class="label" for="f_' + key + '">' + esc(label) + '</label>' +
      '<div class="inwrap' + (prefix ? ' has-pre' : '') + '">' +
        (prefix ? '<span class="inpre">' + esc(prefix) + '</span>' : '') +
        '<input class="control" id="f_' + key + '" data-num="' + key + '" type="number" min="0" step="any" ' +
          'value="' + (val == null ? '' : val) + '"></div></div>';
  }
  function rateField(key, label, val) {
    var opts = [1,2,3,4,5].map(function (n) {
      return '<button type="button" class="r5' + (val === n ? ' on' : '') + '" data-rate="' + key +
        '" data-v="' + n + '" aria-pressed="' + (val === n ? 'true' : 'false') + '">' + n + '</button>';
    }).join('');
    return '<div class="field rfield"><span class="label">' + esc(label) +
      ' <span class="muted-inline">1 bad · 5 good</span></span>' +
      '<div class="r5row" data-rate-group="' + key + '">' + opts +
        '<button type="button" class="r5 clear" data-rate="' + key + '" data-v="0" title="Clear">×</button>' +
      '</div></div>';
  }
  function triField(key, label, val) {
    return '<div class="field"><span class="label">' + esc(label) + '</span>' +
      '<div class="trirow" data-tri-group="' + key + '">' +
        ['yes','no','—'].map(function (t, i) {
          var v = i === 0 ? 'true' : (i === 1 ? 'false' : '');
          var on = (val === true && i === 0) || (val === false && i === 1) || (val == null && i === 2);
          return '<button type="button" class="tri' + (on ? ' on' : '') + '" data-tri="' + key +
            '" data-v="' + v + '" aria-pressed="' + (on ? 'true' : 'false') + '">' + t + '</button>';
        }).join('') +
      '</div></div>';
  }
  function selField(key, label, list, val) {
    return '<div class="field"><label class="label" for="f_' + key + '">' + esc(label) + '</label>' +
      '<select class="control" id="f_' + key + '" data-sel="' + key + '">' +
        '<option value="">—</option>' +
        list.map(function (o) {
          return '<option value="' + esc(o.value) + '"' + (o.value === val ? ' selected' : '') +
            '>' + esc(o.label) + '</option>';
        }).join('') +
      '</select></div>';
  }

  function wireForm(root, show, r, canShare) {
    var draft = JSON.parse(JSON.stringify(r));

    function recalcNet() {
      var n = I.netOf(I.makeReport(draft));
      root.querySelector('#netOut').textContent = n == null ? '—' : money(n);
    }

    root.querySelectorAll('[data-num]').forEach(function (input) {
      input.addEventListener('input', function () {
        var key = input.getAttribute('data-num');
        var target = key in draft.results ? draft.results
                   : (key in draft.logistics ? draft.logistics : draft.crowd);
        target[key] = input.value === '' ? null : Number(input.value);
        recalcNet();
      });
    });

    root.querySelectorAll('[data-rate]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-rate');
        var v = Number(btn.getAttribute('data-v'));
        var target = key in draft.logistics ? draft.logistics : draft.crowd;
        target[key] = v === 0 ? null : v;
        root.querySelectorAll('[data-rate-group="' + key + '"] .r5').forEach(function (b) {
          var on = Number(b.getAttribute('data-v')) === v && v !== 0;
          b.classList.toggle('on', on);
          b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
      });
    });

    root.querySelectorAll('[data-tri]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-tri');
        var raw = btn.getAttribute('data-v');
        var v = raw === 'true' ? true : (raw === 'false' ? false : null);
        var target = key in draft.logistics ? draft.logistics : draft.crowd;
        target[key] = v;
        root.querySelectorAll('[data-tri-group="' + key + '"] .tri').forEach(function (b) {
          var on = b === btn;
          b.classList.toggle('on', on);
          b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
      });
    });

    root.querySelectorAll('[data-sel]').forEach(function (sel) {
      sel.addEventListener('change', function () {
        draft.logistics[sel.getAttribute('data-sel')] = sel.value || null;
      });
    });

    root.querySelectorAll('[data-factor]').forEach(function (input) {
      input.addEventListener('input', function () {
        draft.factors[input.getAttribute('data-factor')] =
          input.value === '' ? null : Number(input.value);
      });
    });

    root.querySelectorAll('input[name="vis"]').forEach(function (radio) {
      radio.addEventListener('change', function () {
        draft.visibility = radio.value;
        runTone();
      });
    });

    var notes = root.querySelector('#repNotes');
    var toneBox = root.querySelector('#toneBox');
    var toneTimer = null;

    /* The conduct check. Advisory, never blocking — it shows the artist what
       it caught and why, and leaves the decision with them. */
    function runTone() {
      var res = I.reviewTone(notes.value, draft.visibility);
      if (res.level === 'clear') { toneBox.hidden = true; toneBox.innerHTML = ''; return; }
      toneBox.hidden = false;
      toneBox.className = 'tone tone-' + res.level;
      toneBox.innerHTML =
        '<p class="tone-h">' +
          (res.level === 'strong'
            ? 'This reads as a complaint rather than a report.'
            : 'One phrase here might read as heat rather than intel.') +
        '</p>' +
        '<ul>' + res.flags.map(function (f) {
          return '<li><q>' + esc(f.matched) + '</q> — ' + esc(f.why) + '</li>';
        }).join('') + '</ul>' +
        '<p class="tone-f">' +
          (draft.visibility === 'anonymous'
            ? 'Anonymous reports are held to a higher bar, because a name is what keeps a report honest. '
            : '') +
          'Say what happened and what it cost you. You can save it as it stands — nothing is blocked.' +
        '</p>';
    }
    notes.addEventListener('input', function () {
      draft.notes = notes.value;
      clearTimeout(toneTimer);
      toneTimer = setTimeout(runTone, 350);
    });
    runTone();
    recalcNet();

    root.querySelector('#repYear').addEventListener('input', function (e) {
      draft.year = Number(e.target.value);
    });
    root.querySelector('#repDisc').addEventListener('change', function (e) {
      draft.discipline = e.target.value;
    });
    root.querySelector('#repName').addEventListener('input', function (e) {
      draft.authorName = e.target.value;
    });

    root.querySelector('#btnRepCancel').addEventListener('click', function () { closeDrawer(); });

    var del = root.querySelector('#btnRepDelete');
    if (del) del.addEventListener('click', function () {
      if (!window.confirm('Delete this report? This cannot be undone.')) return;
      I.store.remove(draft.id).then(function () {
        delete reportsCache[show.id];
        closeDrawer();
        if (onProfileChange) onProfileChange(I.getProfile());
      });
    });

    root.querySelector('#btnRepSave').addEventListener('click', function () {
      draft.notes = notes.value;
      if (!canShare) draft.visibility = 'private';
      if (draft.visibility === 'attributed' && !String(draft.authorName || '').trim()) {
        var err = root.querySelector('#repErr');
        err.hidden = false;
        err.textContent = 'A signed report needs a name on it. Add one, or switch to anonymous.';
        return;
      }
      I.store.upsert(draft).then(function () {
        delete reportsCache[show.id];
        closeDrawer();
        if (onProfileChange) onProfileChange(I.getProfile());
      }).catch(function (e) {
        var err = root.querySelector('#repErr');
        err.hidden = false;
        err.textContent = e && e.message ? e.message : 'Could not save that report.';
      });
    });
  }

  /* ---- 4. NETWORK PANEL --------------------------------------------------- */
  function openNetwork() {
    var st = M.state();
    drawer('The network',
      '<p class="lede">' +
        (st.mode === 'solo'
          ? 'Running solo. Everything you write stays in this browser, and no report can be shared.'
          : (st.signedIn
              ? 'Signed in to ' + esc(st.url) + ' as ' + esc((st.member && st.member.displayName) || 'a member') + '.'
              : 'Configured for ' + esc(st.url) + ', not signed in.')) +
      '</p>' +
      '<section class="fgroup">' +
        '<h4>Network address</h4>' +
        '<p class="hint">The Cloudflare Worker that holds the shared intel. Leave it empty to stay solo.</p>' +
        '<input class="control" id="netUrl" type="url" placeholder="https://intel.example.workers.dev" ' +
          'value="' + esc(st.url) + '">' +
        '<p class="form-foot"><button class="btn btn-quiet" id="btnNetSave" type="button">Save address</button></p>' +
      '</section>' +
      (st.mode === 'network' && !st.signedIn ?
        '<section class="fgroup">' +
          '<h4>Sign in</h4>' +
          '<p class="hint">Membership is invite-only. Your code is single-use and is burned when redeemed.</p>' +
          '<div class="grid-2">' +
            '<div class="field"><label class="label" for="netCode">Invite code</label>' +
              '<input class="control" id="netCode" type="text" autocomplete="one-time-code"></div>' +
            '<div class="field"><label class="label" for="netName">Display name</label>' +
              '<input class="control" id="netName" type="text" placeholder="How signed reports are credited"></div>' +
          '</div>' +
          '<p class="err" id="netErr" hidden></p>' +
          '<p class="form-foot"><button class="btn btn-primary" id="btnNetIn" type="button">Redeem and sign in</button></p>' +
        '</section>' : '') +
      (st.signedIn ?
        '<p class="form-foot"><button class="btn btn-quiet" id="btnNetOut" type="button">Sign out</button></p>' : '') +
      '<p class="fine">Private reports never leave this device in either mode. Shared reports are ' +
        'held by the Worker and scoped to the network — the server decides what you can read, ' +
        'not the browser.</p>',
      function (root) {
        root.querySelector('#btnNetSave').addEventListener('click', function () {
          M.setConfig({ url: root.querySelector('#netUrl').value.trim() });
          openNetwork();
        });
        var inBtn = root.querySelector('#btnNetIn');
        if (inBtn) inBtn.addEventListener('click', function () {
          var err = root.querySelector('#netErr');
          err.hidden = true;
          M.redeem(root.querySelector('#netCode').value, root.querySelector('#netName').value)
            .then(function () { openNetwork(); })
            .catch(function (e) { err.hidden = false; err.textContent = e.message; });
        });
        var outBtn = root.querySelector('#btnNetOut');
        if (outBtn) outBtn.addEventListener('click', function () { M.signOut(); openNetwork(); });
      });
  }

  /* ---- 5. DRAWER PLUMBING ------------------------------------------------- */
  function ensureHost() {
    if (host) return host;
    var overlay = el('div', 'idr-overlay');
    overlay.id = 'idrOverlay';
    overlay.addEventListener('click', closeDrawer);
    host = el('section', 'idr');
    host.setAttribute('role', 'dialog');
    host.setAttribute('aria-modal', 'true');
    host.hidden = true;
    overlay.hidden = true;
    document.body.appendChild(overlay);
    document.body.appendChild(host);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !host.hidden) closeDrawer();
    });
    return host;
  }

  function drawer(title, bodyHtml, wire, size) {
    var h = ensureHost();
    h.className = 'idr' + (size === 'wide' ? ' idr-wide' : '');
    h.innerHTML =
      '<div class="idr-head">' +
        '<h2>' + esc(title) + '</h2>' +
        '<button class="btn btn-icon" type="button" id="idrClose" aria-label="Close">' +
          '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" ' +
          'stroke-width="1.3" stroke-linecap="round"><path d="M5 5l10 10M15 5L5 15"/></svg>' +
        '</button>' +
      '</div>' +
      '<div class="idr-body" id="idrBody"></div>';
    h.querySelector('#idrBody').innerHTML = bodyHtml;
    h.querySelector('#idrClose').addEventListener('click', closeDrawer);
    h.hidden = false;
    document.getElementById('idrOverlay').hidden = false;
    document.body.classList.add('idr-open');
    h.querySelector('.idr-body').scrollTop = 0;
    if (wire) wire(h);
    var focusable = h.querySelector('input, select, textarea, button');
    if (focusable) focusable.focus();
  }

  function closeDrawer() {
    if (!host) return;
    host.hidden = true;
    var o = document.getElementById('idrOverlay');
    if (o) o.hidden = true;
    document.body.classList.remove('idr-open');
  }

  return {
    mountProfileBar: mountProfileBar,
    openShow: openShow,
    openReport: openReport,
    openNetwork: openNetwork,
    openWeights: openWeights,
    closeDrawer: closeDrawer,
    provChip: provChip,
    scoreClass: scoreClass,
    invalidate: function (showId) { if (showId) delete reportsCache[showId]; else reportsCache = {}; }
  };
})();
