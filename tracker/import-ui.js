/* ==========================================================================
   Art Show Tracker — import modal (Phase 4)

   Drives the three-step import: choose a source (Zapp paste or CSV), map the
   columns when the source is delimited, then review and commit. All parsing,
   deduping and geocoding is in tracker/import.js; the markup is in
   tracker/index.html. This file is the wiring between them, exactly as
   tracker/map.js is wired by the ledger page.

   Every write goes through AST.Store, so an import lands in whichever backend
   is live — LocalStore or the Supabase SyncStore — and syncs like any edit.

   Classic script (see the note in core.js). Publishes window.ASTImportUI.
   ========================================================================== */
window.ASTImportUI = (function () {
  'use strict';

  var A = window.AST;
  var I = window.ASTImport;
  var $ = function (sel) { return document.querySelector(sel); };
  var esc = function (s) { return A.esc(s); };

  var host = {                        // filled by init()
    getShows: function () { return []; },
    onDone: function () {},
    toast: function (m) { console.log(m); }
  };

  var ui = {
    step: 1,
    mode: 'paste',
    table: null,                      // { headers, rows, delimiter, skipped }
    mapping: null,
    rows: [],                         // candidates under review
    fileName: '',
    geoRunning: false,
    geoStop: false,
    lastFocus: null
  };

  /* ======================================================================
     1. STEP CHROME
     ====================================================================== */
  function stepsFor() {
    return ui.table ? [1, 2, 3] : [1, 3];
  }
  function stepTitle(n) {
    return n === 1 ? 'Source' : n === 2 ? 'Columns' : 'Review';
  }

  function paintChrome() {
    var steps = stepsFor();
    $('#impSteps').innerHTML = steps.map(function (n, i) {
      return '<span class="imp-step' + (n === ui.step ? ' is-now' : (steps.indexOf(ui.step) > i ? ' is-done' : '')) +
             '">' + (i + 1) + '. ' + stepTitle(n) + '</span>';
    }).join('');

    $('#impStep1').hidden = ui.step !== 1;
    $('#impStep2').hidden = ui.step !== 2;
    $('#impStep3').hidden = ui.step !== 3;

    var atFirst = steps.indexOf(ui.step) === 0;
    $('#impBack').hidden = atFirst;
    $('#impNext').hidden = ui.step === 3;
    $('#impCommit').hidden = ui.step !== 3;
    $('#impNext').textContent = ui.step === 2 ? 'Preview rows' : 'Read the text';
    paintCommitLabel();
  }

  function paintCommitLabel() {
    var n = ui.rows.filter(function (r) { return r.include; }).length;
    var btn = $('#impCommit');
    btn.textContent = n === 1 ? 'Import 1 show' : 'Import ' + n + ' shows';
    btn.disabled = n === 0 || ui.geoRunning;
  }

  /* ======================================================================
     2. STEP 1 — SOURCE
     ====================================================================== */
  function setMode(mode) {
    ui.mode = mode;
    $('#impTabPaste').setAttribute('aria-selected', String(mode === 'paste'));
    $('#impTabCsv').setAttribute('aria-selected', String(mode === 'csv'));
    $('#impPanePaste').hidden = mode !== 'paste';
    $('#impPaneCsv').hidden = mode !== 'csv';
    $('#impNext').textContent = mode === 'csv' ? 'Read the columns' : 'Read the text';
  }

  function readSource() {
    if (ui.mode === 'paste') return readPaste();
    return readCSV();
  }

  function readPaste() {
    var text = $('#impPasteText').value;
    if (!text.trim()) { note('#impParseNote', 'Paste the text from the Zapp page first.', true); return; }
    var out = I.parseZapp(text);
    if (!out.rows.length) {
      note('#impParseNote', 'Nothing in that text looked like a show. Copy the whole results list — ' +
           'show name, city, dates and deadline — and try again.', true);
      return;
    }
    if (out.table && out.mapping) {
      // The paste was a real table: give it the same column mapping a CSV gets.
      ui.table = out.table;
      ui.mapping = out.mapping;
      ui.fileName = 'pasted table';
      renderMapping('zapp_paste');
      go(2);
      return;
    }
    ui.table = null; ui.mapping = null;
    startReview(out.rows, out.rows.length + ' show' + (out.rows.length === 1 ? '' : 's') +
      ' read from the paste. Anything flagged amber is a guess — fix it here.');
  }

  var csvText = '';
  function readCSV() {
    var text = csvText || $('#impCsvText').value;
    if (!text.trim()) { note('#impCsvNote', 'Choose a CSV file, or paste its contents.', true); return; }
    var table = I.parseDelimited(text);
    if (!table.headers.length || !table.rows.length) {
      note('#impCsvNote', 'No rows found. Save the spreadsheet as CSV and try again.', true);
      return;
    }
    ui.table = table;
    ui.mapping = I.guessMapping(table.headers);
    renderMapping('csv');
    go(2);
  }

  /* ======================================================================
     3. STEP 2 — COLUMN MAPPING

     Nothing about the spreadsheet's layout is baked in: every tracker field
     gets a dropdown of the file's actual columns, pre-selected by a header
     guess the user can override, with the first row's value shown so it is
     obvious which column is which.
     ====================================================================== */
  var pendingSource = 'csv';

  function sampleFor(idx) {
    if (idx === -1) return '';
    for (var i = 0; i < Math.min(ui.table.rows.length, 5); i++) {
      var v = ui.table.rows[i][idx];
      if (v !== undefined && String(v).trim()) return String(v).trim();
    }
    return '';
  }

  function renderMapping(source) {
    pendingSource = source;
    var opts = function (sel) {
      return '<option value="-1"' + (sel === -1 ? ' selected' : '') + '>— not in this file —</option>' +
        ui.table.headers.map(function (h, i) {
          return '<option value="' + i + '"' + (sel === i ? ' selected' : '') + '>' +
                 esc(h || 'Column ' + (i + 1)) + '</option>';
        }).join('');
    };
    $('#impMapTable').innerHTML =
      '<table class="map-table"><thead><tr><th>Tracker field</th><th>Column in your file</th><th>First value</th></tr></thead><tbody>' +
      I.FIELDS.map(function (f) {
        return '<tr><th scope="row">' + esc(f.label) + '</th>' +
          '<td><select class="control" data-field="' + f.key + '">' + opts(ui.mapping[f.key]) + '</select></td>' +
          '<td class="map-sample" data-sample="' + f.key + '">' + esc(sampleFor(ui.mapping[f.key])) + '</td></tr>';
      }).join('') +
      '</tbody></table>';

    var bits = [ui.table.rows.length + ' data row' + (ui.table.rows.length === 1 ? '' : 's'),
                ui.table.headers.length + ' columns',
                'delimiter ' + (ui.table.delimiter === '\t' ? 'tab' : '"' + ui.table.delimiter + '"')];
    if (ui.table.skipped) bits.push(ui.table.skipped + ' row' + (ui.table.skipped === 1 ? '' : 's') + ' above the header ignored');
    note('#impMapNote', bits.join(' · ') + '. A show needs at least a name and a start date.');
  }

  function buildFromMapping() {
    var rows = I.rowsFromTable(ui.table, ui.mapping, pendingSource);
    if (!rows.length) {
      note('#impMapNote', 'Those columns produced no usable rows — every row was missing both a name and a start date. ' +
           'Check the Show name and Start date mappings.', true);
      return;
    }
    startReview(rows, rows.length + ' row' + (rows.length === 1 ? '' : 's') + ' read from ' +
      (ui.fileName ? esc(ui.fileName) : 'the file') + '.');
  }

  /* ======================================================================
     4. STEP 3 — REVIEW

     Every field is editable, every field carries its confidence, duplicates
     are flagged against the existing season by name + year, and nothing is
     written until the Import button.
     ====================================================================== */
  function startReview(rows, msg) {
    ui.rows = I.markDuplicates(rows, host.getShows());
    // Anything the parser could not make sense of is unticked, not silently
    // imported broken.
    ui.rows.forEach(function (c) {
      if (Object.keys(I.validate(c)).length) c.include = false;
    });
    note('#impReviewNote', msg);
    renderReview();
    go(3);
  }

  function confClass(c) { return c.confidence === 'low' ? 'c-low' : c.confidence === 'med' ? 'c-med' : ''; }

  function cellHTML(cand, f) {
    var c = cand.fields[f.key];
    var errs = I.validate(cand);
    var err = errs[f.key];
    var title = (I.CONFIDENCE_LABEL[c.confidence] || '') + (c.note ? ' — ' + c.note : '') + (err ? ' — ' + err : '');
    var common = 'data-key="' + cand.key + '" data-field="' + f.key + '" ' +
      'class="rev-input ' + confClass(c) + (err ? ' is-bad' : '') + '" ' +
      'style="width:' + f.width + '" title="' + esc(title) + '"' + (err ? ' aria-invalid="true"' : '');
    if (f.type === 'status') {
      return '<select ' + common + '><option value="">—</option>' +
        A.STATUSES.map(function (s) {
          return '<option value="' + s.value + '"' + (s.value === c.value ? ' selected' : '') + '>' + esc(s.label) + '</option>';
        }).join('') + '</select>';
    }
    return '<input ' + common + ' value="' + esc(c.value) + '"' +
      (f.type === 'date' ? ' placeholder="yyyy-mm-dd" inputmode="numeric"' : '') +
      (f.type === 'num' ? ' inputmode="decimal"' : '') + '>';
  }

  function dupeHTML(cand) {
    if (!cand.dupe) return '<span class="dupe-new">New</span>';
    if (cand.dupe.kind === 'batch') {
      return '<span class="dupe-flag" title="Another row in this same paste has the same name and year.">Repeat in paste</span>';
    }
    var word = cand.dupe.kind === 'exact' ? 'Already have' : 'Similar to';
    return '<span class="dupe-flag" title="' + esc(word + ' “' + cand.dupe.name + '” in this season.') + '">' +
      word + '</span>' +
      '<select class="rev-action" data-key="' + cand.key + '" aria-label="What to do with this duplicate">' +
        '<option value="update"' + (cand.dupe.action === 'update' ? ' selected' : '') + '>Update it</option>' +
        '<option value="add"' + (cand.dupe.action === 'add' ? ' selected' : '') + '>Add as new</option>' +
      '</select>';
  }

  function geoHTML(cand) {
    if (!cand.geo) return '';
    var map = { ok:'Geocoded', cached:'Cached', miss:'No match', error:'Lookup failed' };
    return '<span class="geo-flag geo-' + cand.geo.state + '" title="' + esc(cand.geo.note || '') + '">' +
      (map[cand.geo.state] || '') + '</span>';
  }

  function renderReview() {
    var head = '<tr><th class="col-tick"><span class="sr">Import</span></th><th class="col-flag">Row</th>' +
      I.FIELDS.map(function (f) { return '<th>' + esc(f.label) + '</th>'; }).join('') + '</tr>';

    var body = ui.rows.map(function (c, i) {
      var errs = I.validate(c);
      var bad = Object.keys(errs).length;
      return '<tr data-key="' + c.key + '"' + (c.include ? '' : ' class="is-off"') + '>' +
        '<td class="col-tick"><input type="checkbox" class="rev-tick" data-key="' + c.key + '"' +
          (c.include ? ' checked' : '') + ' aria-label="Import row ' + (i + 1) + '"></td>' +
        '<td class="col-flag">' + dupeHTML(c) + geoHTML(c) +
          (bad ? '<span class="dupe-flag is-bad-flag" title="' + esc(Object.keys(errs).map(function (k) { return errs[k]; }).join(' ')) +
                 '">Needs a fix</span>' : '') + '</td>' +
        I.FIELDS.map(function (f) { return '<td>' + cellHTML(c, f) + '</td>'; }).join('') +
        '</tr>';
    }).join('');

    $('#impReviewHost').innerHTML = '<table class="rev-table"><thead>' + head + '</thead><tbody>' + body + '</tbody></table>';
    paintSummary();
  }

  function paintSummary() {
    var inc = ui.rows.filter(function (r) { return r.include; });
    var dupes = ui.rows.filter(function (r) { return r.dupe; }).length;
    var bad = ui.rows.filter(function (r) { return Object.keys(I.validate(r)).length; }).length;
    var needGeo = ui.rows.filter(function (r) {
      return r.include && r.fields.city.value && !r.fields.lat.value && !r.fields.lng.value;
    }).length;
    var bits = [inc.length + ' of ' + ui.rows.length + ' ticked'];
    if (dupes) bits.push(dupes + ' already in the season');
    if (bad) bits.push(bad + ' need a fix before they can be imported');
    if (needGeo) bits.push(needGeo + ' without coordinates');
    $('#impSummary').textContent = bits.join(' · ');
    $('#impGeocode').disabled = ui.geoRunning || !needGeo;
    $('#impGeocode').textContent = needGeo ? 'Find coordinates (' + needGeo + ')' : 'Find coordinates';
    paintCommitLabel();
  }

  /** Re-paints one row in place, so typing does not rebuild the whole table. */
  function repaintRow(cand) {
    var tr = $('#impReviewHost tr[data-key="' + cand.key + '"]');
    if (!tr) return;
    var errs = I.validate(cand);
    I.FIELDS.forEach(function (f) {
      var el = tr.querySelector('[data-field="' + f.key + '"]');
      if (!el) return;
      var c = cand.fields[f.key];
      el.className = 'rev-input ' + confClass(c) + (errs[f.key] ? ' is-bad' : '');
      el.title = (I.CONFIDENCE_LABEL[c.confidence] || '') + (c.note ? ' — ' + c.note : '') +
                 (errs[f.key] ? ' — ' + errs[f.key] : '');
      if (errs[f.key]) el.setAttribute('aria-invalid', 'true'); else el.removeAttribute('aria-invalid');
      if (el.value !== c.value) el.value = c.value;
    });
    tr.classList.toggle('is-off', !cand.include);
    var flags = tr.querySelector('.col-flag');
    if (flags) flags.innerHTML = dupeHTML(cand) + geoHTML(cand) +
      (Object.keys(errs).length ? '<span class="dupe-flag is-bad-flag" title="' +
        esc(Object.keys(errs).map(function (k) { return errs[k]; }).join(' ')) + '">Needs a fix</span>' : '');
    paintSummary();
  }

  function candFor(key) {
    return ui.rows.filter(function (r) { return r.key === key; })[0] || null;
  }

  /* Typed edits are trusted: a value the user set is high confidence, and the
     amber flag on that cell goes away. */
  function editField(cand, key, raw) {
    var f = I.FIELDS.filter(function (x) { return x.key === key; })[0];
    var value = raw;
    if (f && f.type === 'date' && raw.trim()) {
      value = I.coerceDate(raw, Number(cand.fields.startDate.value.slice(0, 4)) || 0) || raw.trim();
    }
    if (f && f.type === 'num' && raw.trim()) {
      var m = I.coerceMoney(raw);
      if (key === 'lat' || key === 'lng') { m = Number.isFinite(Number(raw)) ? String(Number(raw)) : raw.trim(); }
      value = m === '' ? raw.trim() : m;
    }
    cand.fields[key] = I.cell(value, 'high', 'You typed this.');
    if (key === 'name' || key === 'startDate') {
      cand.dupe = I.findDuplicate(cand, host.getShows());
    }
  }

  /* ======================================================================
     5. GEOCODING

     Nominatim, one request a second, cached, with the manual lat/lng columns
     right there for anything it cannot place.
     ====================================================================== */
  function runGeocode() {
    if (ui.geoRunning) return;
    ui.geoRunning = true;
    ui.geoStop = false;
    $('#impGeoCancel').hidden = false;
    $('#impGeocode').disabled = true;
    paintCommitLabel();

    var startedCache = I.Geocoder.cacheSize();
    note('#impGeoProgress', 'Looking up places — one a second, as Nominatim asks.');

    I.Geocoder.fillCoords(ui.rows, function (p) {
      note('#impGeoProgress', 'Looked up ' + p.done + ' of ' + p.total + '…');
      repaintRow(p.cand);
    }, function () { return ui.geoStop; })
      .then(function (res) {
        var fromCache = I.Geocoder.cacheSize() === startedCache && res.done > 0;
        note('#impGeoProgress', res.stopped
          ? 'Stopped after ' + res.done + ' of ' + res.total + '. The rest keep their blank coordinates.'
          : res.total === 0
            ? 'Nothing to look up.'
            : 'Looked up ' + res.done + ' place' + (res.done === 1 ? '' : 's') +
              (fromCache ? ', all from the cache.' : '.') +
              ' Anything still blank can be typed into the Lat and Lng columns.');
      })
      .catch(function (err) {
        note('#impGeoProgress', 'Geocoding stopped: ' + ((err && err.message) || 'lookup failed') +
             '. Type coordinates into the Lat and Lng columns instead.', true);
      })
      .then(function () {
        ui.geoRunning = false;
        $('#impGeoCancel').hidden = true;
        renderReview();
      });
  }

  /* ======================================================================
     6. COMMIT

     Sequential upserts through AST.Store — which may be LocalStore or the
     Supabase SyncStore — so imports sync exactly like a hand edit. Undo puts
     the season back: added rows are deleted, updated rows are restored.
     ====================================================================== */
  function commit() {
    var picked = ui.rows.filter(function (r) { return r.include; });
    if (!picked.length) return;

    var blocked = picked.filter(function (r) { return Object.keys(I.validate(r)).length; });
    if (blocked.length) {
      host.toast(blocked.length + ' ticked row' + (blocked.length === 1 ? ' still needs' : 's still need') +
                 ' a fix — see the amber cells.');
      renderReview();
      return;
    }

    var shows = host.getShows();
    var added = [], restored = [];
    var chain = Promise.resolve();

    picked.forEach(function (c) {
      chain = chain.then(function () {
        var existing = (c.dupe && c.dupe.id && c.dupe.action === 'update')
          ? shows.filter(function (s) { return s.id === c.dupe.id; })[0] : null;
        if (existing) restored.push(existing);
        var rec = I.toShow(c, existing);
        if (!existing) added.push(rec.id);
        return A.Store.upsert(rec);
      });
    });

    $('#impCommit').disabled = true;
    return chain
      .then(function () {
        close();
        return host.onDone();
      })
      .then(function () {
        var parts = [];
        if (added.length) parts.push(added.length + ' added');
        if (restored.length) parts.push(restored.length + ' updated');
        host.toast('Imported: ' + parts.join(', ') + '.', 'Undo', function () {
          var back = Promise.resolve();
          added.forEach(function (id) { back = back.then(function () { return A.Store.remove(id); }); });
          restored.forEach(function (s) { back = back.then(function () { return A.Store.upsert(s); }); });
          back.then(function () { return host.onDone(); })
              .then(function () { host.toast('Import undone.', null, null, 2400); });
        }, 12000);
      })
      .catch(function (err) {
        console.error(err);
        $('#impCommit').disabled = false;
        host.toast('Import failed: ' + ((err && err.message) || 'could not save') + '.');
      });
  }

  /* ======================================================================
     7. OPEN / CLOSE / EVENTS
     ====================================================================== */
  function note(sel, msg, bad) {
    var el = $(sel);
    if (!el) return;
    el.textContent = msg || '';
    el.classList.toggle('is-bad-note', !!bad);
  }

  function go(step) { ui.step = step; paintChrome(); }

  function reset() {
    ui.step = 1; ui.mode = 'paste'; ui.table = null; ui.mapping = null;
    ui.rows = []; ui.fileName = ''; ui.geoRunning = false; ui.geoStop = false;
    csvText = '';
    $('#impPasteText').value = '';
    $('#impCsvText').value = '';
    $('#impFile').value = '';
    $('#impFileName').textContent = '';
    $('#impReviewHost').innerHTML = '';
    ['#impParseNote','#impCsvNote','#impMapNote','#impReviewNote','#impGeoProgress'].forEach(function (s) { note(s, ''); });
    $('#impSummary').textContent = '';
    $('#impGeoCancel').hidden = true;
    setMode('paste');
    paintChrome();
  }

  function open() {
    ui.lastFocus = document.activeElement;
    reset();
    $('#overlay').hidden = false;
    $('#importModal').hidden = false;
    var cached = I.Geocoder.cacheSize();
    note('#impParseNote', cached ? cached + ' place' + (cached === 1 ? '' : 's') + ' already cached for geocoding.' : '');
    $('#impPasteText').focus();
  }

  function close() {
    ui.geoStop = true;
    $('#importModal').hidden = true;
    $('#overlay').hidden = true;
    if (ui.lastFocus && ui.lastFocus.focus) ui.lastFocus.focus();
  }
  function isOpen() { return !$('#importModal').hidden; }

  function init(opts) {
    opts = opts || {};
    host.getShows = opts.getShows || host.getShows;
    host.onDone = opts.onDone || host.onDone;
    host.toast = opts.toast || host.toast;

    $('#impTabPaste').addEventListener('click', function () { setMode('paste'); });
    $('#impTabCsv').addEventListener('click', function () { setMode('csv'); });
    $('#impClose').addEventListener('click', close);
    $('#impCancel').addEventListener('click', close);
    $('#impBack').addEventListener('click', function () {
      go(ui.step === 3 && ui.table ? 2 : 1);
    });
    $('#impNext').addEventListener('click', function () {
      if (ui.step === 1) readSource();
      else if (ui.step === 2) buildFromMapping();
    });
    $('#impCommit').addEventListener('click', commit);

    $('#impFile').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      ui.fileName = f.name;
      $('#impFileName').textContent = f.name;
      f.text().then(function (t) {
        csvText = t;
        note('#impCsvNote', 'Read ' + f.name + '. Choose "Read the columns" to map them.');
      }).catch(function () { note('#impCsvNote', 'Could not read that file.', true); });
    });
    $('#impCsvText').addEventListener('input', function () { csvText = ''; });

    /* Mapping dropdowns: a column can only feed one field, so picking a column
       that is already taken frees it from the other field rather than
       silently duplicating it. */
    $('#impMapTable').addEventListener('change', function (e) {
      var sel = e.target.closest('select[data-field]');
      if (!sel) return;
      var idx = Number(sel.value);
      var field = sel.dataset.field;
      if (idx !== -1) {
        Object.keys(ui.mapping).forEach(function (k) {
          if (k !== field && ui.mapping[k] === idx) ui.mapping[k] = -1;
        });
      }
      ui.mapping[field] = idx;
      renderMapping(pendingSource);
    });

    /* Review table. */
    var review = $('#impReviewHost');
    review.addEventListener('input', function (e) {
      var el = e.target.closest('.rev-input');
      if (!el || el.tagName === 'SELECT') return;
      var cand = candFor(el.dataset.key);
      if (!cand) return;
      cand.fields[el.dataset.field] = I.cell(el.value, 'high', 'You typed this.');
      paintSummary();
    });
    review.addEventListener('change', function (e) {
      var tick = e.target.closest('.rev-tick');
      if (tick) {
        var c1 = candFor(tick.dataset.key);
        if (c1) { c1.include = tick.checked; repaintRow(c1); }
        return;
      }
      var act = e.target.closest('.rev-action');
      if (act) {
        var c2 = candFor(act.dataset.key);
        if (c2 && c2.dupe) c2.dupe.action = act.value;
        return;
      }
      var el2 = e.target.closest('.rev-input');
      if (!el2) return;
      var c3 = candFor(el2.dataset.key);
      if (!c3) return;
      editField(c3, el2.dataset.field, el2.value);
      repaintRow(c3);
    });

    $('#impSelectAll').addEventListener('click', function () {
      ui.rows.forEach(function (c) { if (!Object.keys(I.validate(c)).length) c.include = true; });
      renderReview();
    });
    $('#impSelectNone').addEventListener('click', function () {
      ui.rows.forEach(function (c) { c.include = false; });
      renderReview();
    });
    $('#impSelectNew').addEventListener('click', function () {
      ui.rows.forEach(function (c) { c.include = !c.dupe && !Object.keys(I.validate(c)).length; });
      renderReview();
    });
    $('#impGeocode').addEventListener('click', runGeocode);
    $('#impGeoCancel').addEventListener('click', function () { ui.geoStop = true; });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isOpen()) close();
    });

    setMode('paste');
    paintChrome();
  }

  return {
    init: init, open: open, close: close, isOpen: isOpen,
    _ui: ui                 // for the test harness only
  };
})();
