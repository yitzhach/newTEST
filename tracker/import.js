/* ==========================================================================
   Art Show Tracker — import engine (Phase 4)

   Pure logic, no DOM: the Zapplication paste parser, the CSV/TSV reader and
   column mapper, duplicate detection, and the Nominatim geocoder with its
   rate limit and cache. The modal that drives all this lives in
   tracker/import-ui.js; the markup lives in tracker/index.html.

   No scraping. Nothing here fetches a Zapplication page — the text arrives
   from the user's clipboard, which is the whole point of the phase.

   Classic script, like every other file here (see the note in core.js).
   Publishes window.ASTImport.
   ========================================================================== */
window.ASTImport = (function () {
  'use strict';

  var A = window.AST;

  /* ======================================================================
     1. CANDIDATE FIELDS + CONFIDENCE

     Every value a parser produces is wrapped as { value, confidence, note }.
     Confidence is the phase's "flag per field" and drives the review table:
       high — read from an explicit label ("Application Deadline: 9/15/2026")
              or a column the user mapped by hand.
       med  — recognised by shape alone (a "City, ST" line, a date range on
              its own line), which is usually right but is a guess.
       low  — inferred: a year we had to pick, a fee we assigned by position,
              a name that was just the leftover line.
       none — not found. Empty cell in the review table.
     ====================================================================== */
  var HIGH = 'high', MED = 'med', LOW = 'low', NONE = 'none';

  var CONFIDENCE_LABEL = {
    high: 'Read from a label',
    med:  'Recognised by shape — check it',
    low:  'Inferred — check it',
    none: 'Not found'
  };

  /** Fields a candidate row can carry, in review-table order. */
  var FIELDS = [
    { key:'name',        label:'Show name', width:'22ch' },
    { key:'city',        label:'City',      width:'14ch' },
    { key:'state',       label:'ST',        width:'4ch'  },
    { key:'startDate',   label:'Start',     width:'12ch', type:'date' },
    { key:'endDate',     label:'End',       width:'12ch', type:'date' },
    { key:'applyBy',     label:'Apply by',  width:'12ch', type:'date' },
    { key:'juryFee',     label:'Jury $',    width:'7ch',  type:'num'  },
    { key:'boothFee',    label:'Booth $',   width:'7ch',  type:'num'  },
    { key:'status',      label:'Status',    width:'12ch', type:'status' },
    { key:'lat',         label:'Lat',       width:'9ch',  type:'num'  },
    { key:'lng',         label:'Lng',       width:'9ch',  type:'num'  },
    { key:'routeNumber', label:'Stop',      width:'5ch'  },
    { key:'url',         label:'Link',      width:'16ch' },
    { key:'notes',       label:'Notes',     width:'18ch' }
  ];
  var FIELD_KEYS = FIELDS.map(function (f) { return f.key; });

  function cell(value, confidence, note) {
    return {
      value: value === null || value === undefined ? '' : String(value),
      confidence: value === '' || value === null || value === undefined ? NONE : (confidence || MED),
      note: note || ''
    };
  }
  function blankFields() {
    var out = {};
    FIELD_KEYS.forEach(function (k) { out[k] = cell(''); });
    return out;
  }

  /* ======================================================================
     2. DATES

     Zapp shows dates every way a web page can: "1/2/2027 - 1/3/2027",
     "January 2 - 3, 2027", "Jan 2, 2027", "2027-01-02". Deadlines often drop
     the year entirely, and the year they mean is usually the one *before*
     the show. Everything a year had to be guessed for comes back low.
     ====================================================================== */
  var MON = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9,
              sept:9, oct:10, nov:11, dec:12 };

  function monthNum(word) {
    var k = String(word || '').toLowerCase().replace(/\./g, '').slice(0, 4);
    if (MON[k] !== undefined) return MON[k];
    return MON[k.slice(0, 3)] !== undefined ? MON[k.slice(0, 3)] : 0;
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function fullYear(y) {
    y = Number(y);
    if (!Number.isFinite(y)) return 0;
    if (y < 100) return y + (y < 70 ? 2000 : 1900);
    return y;
  }
  /** Only real calendar dates come back — Feb 31 is not a date. */
  function toISO(y, m, d) {
    if (!y || !m || !d) return '';
    var dt = new Date(y, m - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return '';
    return y + '-' + pad2(m) + '-' + pad2(d);
  }

  /* A loose token scanner: ISO, m/d/y, and "Mon D[, YYYY]". The month-word
     branch is only accepted when the word really is a month, so "Booth 550"
     is not a date. */
  var DATE_TOKEN = new RegExp(
    '(\\d{4})-(\\d{1,2})-(\\d{1,2})' +                                  // 2027-01-02
    '|(\\d{1,2})\\/(\\d{1,2})\\/(\\d{2,4})' +                           // 1/2/2027
    '|([A-Za-z]{3,9})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*,?\\s*(\\d{4}))?', // Jan 2, 2027
    'gi');

  /** All dates in a string, in order, each { m, d, y, hasYear }. */
  function scanDates(str) {
    var out = [], m;
    DATE_TOKEN.lastIndex = 0;
    while ((m = DATE_TOKEN.exec(str)) !== null) {
      if (m[1]) out.push({ y: Number(m[1]), m: Number(m[2]), d: Number(m[3]), hasYear: true });
      else if (m[4]) out.push({ y: fullYear(m[6]), m: Number(m[4]), d: Number(m[5]), hasYear: true });
      else {
        var mo = monthNum(m[7]);
        if (!mo) continue;
        out.push({ y: m[9] ? Number(m[9]) : 0, m: mo, d: Number(m[8]), hasYear: !!m[9] });
      }
    }
    return out;
  }

  /* "January 2 - 3, 2027" and "1/2 - 1/3/2027" hide their second date from the
     token scanner, because the tail is not a date on its own. */
  var SAME_MONTH_WORD = /\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\s*(?:-|–|—|to|through|thru)\s*(\d{1,2})(?:st|nd|rd|th)?\s*,?\s*(\d{4})?/i;
  var SHORT_NUMERIC   = /\b(\d{1,2})\/(\d{1,2})\s*(?:-|–|—|to|through|thru)\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})/;

  /**
   * A show's date range out of arbitrary text.
   * @returns { start, end } of tokens, or null.
   */
  function scanRange(str) {
    var m = SHORT_NUMERIC.exec(str);
    if (m) {
      var y = fullYear(m[5]);
      return { start: { y:y, m:Number(m[1]), d:Number(m[2]), hasYear:true },
               end:   { y:y, m:Number(m[3]), d:Number(m[4]), hasYear:true } };
    }
    m = SAME_MONTH_WORD.exec(str);
    if (m && monthNum(m[1])) {
      var mo = monthNum(m[1]), yy = m[4] ? Number(m[4]) : 0;
      return { start: { y:yy, m:mo, d:Number(m[2]), hasYear:!!m[4] },
               end:   { y:yy, m:mo, d:Number(m[3]), hasYear:!!m[4] } };
    }
    var toks = scanDates(str);
    if (!toks.length) return null;
    return { start: toks[0], end: toks[1] || null };
  }

  /**
   * Fill in a missing year and render ISO.
   * @param hint  a year to prefer when the token carries none.
   * @returns { iso, confidence }
   */
  function settle(tok, hint) {
    if (!tok) return { iso: '', confidence: NONE };
    var y = tok.y;
    var guessed = false;
    if (!tok.hasYear || !y) {
      guessed = true;
      y = hint || new Date().getFullYear();
      // With no hint at all, a date already well past is next year's.
      if (!hint) {
        var probe = new Date(y, tok.m - 1, tok.d);
        if (probe < new Date(Date.now() - 120 * 86400000)) y += 1;
      }
    }
    var iso = toISO(y, tok.m, tok.d);
    return { iso: iso, confidence: iso ? (guessed ? LOW : HIGH) : NONE };
  }

  /**
   * Deadlines usually fall in the year before the show and always before it.
   * Given a show start, pick the year that puts the deadline just ahead of it.
   */
  function settleDeadline(tok, startISO) {
    if (!tok) return { iso: '', confidence: NONE };
    if (tok.hasYear && tok.y) {
      var direct = toISO(tok.y, tok.m, tok.d);
      return { iso: direct, confidence: direct ? HIGH : NONE };
    }
    if (!startISO) return settle(tok, 0);
    var showYear = Number(startISO.slice(0, 4));
    for (var y = showYear; y >= showYear - 1; y--) {
      var iso = toISO(y, tok.m, tok.d);
      if (iso && iso <= startISO) return { iso: iso, confidence: LOW };
    }
    return settle(tok, showYear - 1);
  }

  /** Anything the user types into a date cell, back to ISO (or ''). */
  function coerceDate(text, hint) {
    var s = String(text || '').trim();
    if (!s) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return A.parseISO(s) ? s : '';
    var toks = scanDates(s);
    return toks.length ? settle(toks[0], hint).iso : '';
  }

  /* ======================================================================
     3. MONEY, PLACES, STATUS
     ====================================================================== */
  var MONEY = /\$?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/;
  /* Commas are allowed inside the city so "Coconut Grove, Miami, FL" keeps its
     whole place name instead of falling through to the notes. */
  var CITY_STATE = /^\s*([A-Za-z][A-Za-z .,'’\-]{1,60}?)\s*,\s*([A-Za-z]{2})\s*(?:,\s*(?:USA|US|United States))?\.?\s*$/;
  var URL_RE = /https?:\/\/\S+/i;

  function coerceMoney(text) {
    var m = MONEY.exec(String(text || ''));
    if (!m) return '';
    var n = Number(m[1].replace(/,/g, ''));
    return Number.isFinite(n) ? String(n) : '';
  }
  function looksLikeMoney(line) {
    return /\$\s*\d/.test(line) || /^\s*\d{1,5}(\.\d{2})?\s*$/.test(line);
  }

  /* Zapp's own application states, mapped onto the tracker's. Anything not
     recognised is left for the user rather than guessed at. */
  var ZAPP_STATUS = [
    [/invited to participate|^invited|^accepted|acceptance/i,          'accepted'],
    [/wait\s*list|alternate/i,                                          'waitlist'],
    [/not invited|not accepted|declined|rejected|unsuccessful/i,        'declined'],
    [/submitted|applied|pending|under jury|jurying|in jury|paid/i,      'applied'],
    [/saved|in progress|draft|incomplete|not applied|started/i,         'interested']
  ];
  function coerceStatus(text) {
    var s = String(text || '').trim();
    if (!s) return '';
    if (A.STATUS_LABEL[s]) return s;
    for (var i = 0; i < ZAPP_STATUS.length; i++) if (ZAPP_STATUS[i][0].test(s)) return ZAPP_STATUS[i][1];
    var byLabel = A.STATUSES.filter(function (o) { return o.label.toLowerCase() === s.toLowerCase(); })[0];
    return byLabel ? byLabel.value : '';
  }

  /* ======================================================================
     4. ZAPPLICATION PASTE PARSER

     Copying a Zapp search-results or My-Applications page gives one of two
     shapes, and this handles both:
       - a real table (tab-separated cells, usually with a header row), which
         is routed through the same column mapper the CSV import uses;
       - a stack of text blocks, one per show, either separated by blank
         lines or run together, which is segmented here.
     ====================================================================== */
  var LABELS = [
    { key:'name',     re:/^(?:event|show|exhibit(?:ion)?|festival)\s*(?:name|title)$/i },
    { key:'dates',    re:/^(?:event|show|festival)?\s*dates?$/i },
    { key:'applyBy',  re:/^(?:application|entry|app)?\s*deadline(?:\s*date)?$|^apply\s*by$|^applications?\s*(?:close|due)$|^due\s*date$/i },
    { key:'juryFee',  re:/^(?:application|jury|entry|app)\s*fee$/i },
    { key:'boothFee', re:/^(?:booth|space|exhibitor)\s*(?:fee|rate|cost|price)$/i },
    { key:'location', re:/^(?:location|venue|city\s*\/?,?\s*state|place)$/i },
    { key:'city',     re:/^city$/i },
    { key:'state',    re:/^state$/i },
    { key:'status',   re:/^(?:application\s*)?status$/i },
    { key:'url',      re:/^(?:url|link|web\s*site|website)$/i },
    { key:'notes',    re:/^(?:notes?|comments?|description)$/i }
  ];

  function labelFor(text) {
    var t = String(text || '').trim().replace(/\s+/g, ' ').replace(/[:*]+$/, '');
    for (var i = 0; i < LABELS.length; i++) if (LABELS[i].re.test(t)) return LABELS[i].key;
    return null;
  }

  function normalizeText(text) {
    return String(text || '')
      .replace(/\r\n?/g, '\n')
      .replace(/[   ]/g, ' ')
      .replace(/[ \t]+$/gm, '');
  }

  /**
   * Does a line look like the start of a new show? Used to break a run-on
   * paste into records: a show name is the line that is not a labelled field,
   * not a place, not a date and not a fee.
   */
  function looksLikeTitle(line) {
    var t = line.trim();
    if (t.length < 4 || t.length > 140) return false;
    if (t.indexOf(':') !== -1 && labelFor(t.split(':')[0])) return false;
    if (CITY_STATE.test(t)) return false;
    if (looksLikeMoney(t)) return false;
    if (URL_RE.test(t)) return false;
    if (scanDates(t).length) return false;
    return /[A-Za-z]{3}/.test(t);
  }

  /** A block with no title line is a continuation of the one before it. */
  function mergeOrphans(chunks) {
    var out = [];
    chunks.forEach(function (c) {
      var hasTitle = c.split('\n').some(looksLikeTitle);
      if (!hasTitle && out.length) out[out.length - 1] += '\n' + c;
      else out.push(c);
    });
    return out;
  }

  /** Break a run-on paste apart: a new title once the record already has a date. */
  function segment(lines) {
    var chunks = [], cur = [], sawDate = false, sawTitle = false;
    lines.forEach(function (line) {
      if (!line.trim()) return;
      var title = looksLikeTitle(line);
      if (title && sawTitle && sawDate) {
        chunks.push(cur.join('\n'));
        cur = []; sawDate = false; sawTitle = false;
      }
      if (title) sawTitle = true;
      if (scanDates(line).length) sawDate = true;
      cur.push(line);
    });
    if (cur.length) chunks.push(cur.join('\n'));
    return chunks;
  }

  /** One text block -> one candidate's fields. */
  function parseChunk(text) {
    var fields = blankFields();
    var lines = text.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
    var leftovers = [], moneyLoose = [], labelled = {}, notes = [];

    lines.forEach(function (line) {
      var idx = line.indexOf(':');
      if (idx > 0) {
        var key = labelFor(line.slice(0, idx));
        if (key) {
          var val = line.slice(idx + 1).trim();
          if (val) { labelled[key] = labelled[key] ? labelled[key] + ' ' + val : val; return; }
          return;                                    // "Deadline:" with the value on the next line
        }
      }
      var pending = Object.keys(labelled).filter(function (k) { return labelled[k] === ''; })[0];
      if (pending) { labelled[pending] = line; return; }
      leftovers.push(line);
    });

    /* --- labelled values are the trustworthy ones --- */
    if (labelled.name) fields.name = cell(labelled.name, HIGH);
    if (labelled.city) fields.city = cell(labelled.city, HIGH);
    if (labelled.state) fields.state = cell(labelled.state.toUpperCase().slice(0, 2), HIGH);
    if (labelled.location) {
      var cs = CITY_STATE.exec(labelled.location);
      if (cs) {
        if (!fields.city.value) fields.city = cell(cs[1].trim(), HIGH);
        if (!fields.state.value) fields.state = cell(cs[2].toUpperCase(), HIGH);
      } else if (!fields.city.value) {
        fields.city = cell(labelled.location, MED, 'Location did not split into city and state.');
      }
    }
    if (labelled.juryFee) fields.juryFee = cell(coerceMoney(labelled.juryFee), HIGH);
    if (labelled.boothFee) fields.boothFee = cell(coerceMoney(labelled.boothFee), HIGH);
    if (labelled.url) {
      var u = URL_RE.exec(labelled.url);
      if (u) fields.url = cell(u[0], HIGH);
    }
    if (labelled.status) {
      var st = coerceStatus(labelled.status);
      if (st) fields.status = cell(st, HIGH, 'Zapp status "' + labelled.status + '".');
      else notes.push('Zapp status: ' + labelled.status);
    }
    if (labelled.notes) notes.push(labelled.notes);

    /* --- dates --- */
    var dateSource = labelled.dates || '';
    if (!dateSource) {
      var dateLine = leftovers.filter(function (l) { return scanRange(l) && !/deadline|apply|due/i.test(l); })[0];
      if (dateLine) {
        dateSource = dateLine;
        leftovers.splice(leftovers.indexOf(dateLine), 1);
      }
    }
    var range = dateSource ? scanRange(dateSource) : null;
    if (range) {
      var conf = labelled.dates ? HIGH : MED;
      var start = settle(range.start, range.start.hasYear ? range.start.y : (range.end && range.end.hasYear ? range.end.y : 0));
      if (start.iso) {
        fields.startDate = cell(start.iso, start.confidence === LOW ? LOW : conf,
          start.confidence === LOW ? 'Year was not in the text — check it.' : '');
      }
      if (range.end) {
        var end = settle(range.end, range.end.hasYear ? range.end.y : Number((start.iso || '').slice(0, 4)) || 0);
        if (end.iso) {
          fields.endDate = cell(end.iso, end.confidence === LOW ? LOW : conf,
            end.confidence === LOW ? 'Year was not in the text — check it.' : '');
        }
      } else if (start.iso) {
        fields.endDate = cell(start.iso, LOW, 'Only one date was given; end assumed the same day.');
      }
    }

    /* --- deadline --- */
    var dlSource = labelled.applyBy || '';
    if (!dlSource) {
      var dlLine = leftovers.filter(function (l) { return /deadline|apply\s*by|due/i.test(l) && scanDates(l).length; })[0];
      if (dlLine) { dlSource = dlLine; leftovers.splice(leftovers.indexOf(dlLine), 1); }
    }
    if (dlSource) {
      var dlTok = scanDates(dlSource)[0];
      var dl = settleDeadline(dlTok, fields.startDate.value);
      if (dl.iso) {
        fields.applyBy = cell(dl.iso, dl.confidence === LOW ? LOW : (labelled.applyBy ? HIGH : MED),
          dl.confidence === LOW ? 'Deadline year was not in the text — assumed the season before the show.' : '');
      }
    }

    /* --- place, link, fees and name from what is left --- */
    leftovers = leftovers.filter(function (line) {
      var cs2 = CITY_STATE.exec(line);
      if (cs2 && !fields.city.value) {
        fields.city = cell(cs2[1].trim(), MED);
        fields.state = cell(cs2[2].toUpperCase(), MED);
        return false;
      }
      var u2 = URL_RE.exec(line);
      if (u2 && !fields.url.value) { fields.url = cell(u2[0], MED); return false; }
      if (looksLikeMoney(line)) { moneyLoose.push(line); return false; }
      return true;
    });

    /* Unlabelled money is assigned by position — Zapp lists the application
       fee before the booth fee — but that is a guess, so it comes back low. */
    if (!fields.juryFee.value && moneyLoose.length) {
      fields.juryFee = cell(coerceMoney(moneyLoose.shift()), LOW, 'Fee had no label; taken as the jury fee.');
    }
    if (!fields.boothFee.value && moneyLoose.length) {
      fields.boothFee = cell(coerceMoney(moneyLoose.shift()), LOW, 'Fee had no label; taken as the booth fee.');
    }

    if (!fields.name.value && leftovers.length) {
      fields.name = cell(leftovers.shift(), MED);
    }
    if (leftovers.length) notes.push(leftovers.join('\n'));
    if (notes.length) fields.notes = cell(notes.join('\n'), MED);

    return fields;
  }

  /**
   * Text off a Zapp page -> candidate rows.
   * @returns { rows, shape } — shape is 'table' | 'blocks', for the UI's note.
   */
  function parseZapp(text) {
    var norm = normalizeText(text);
    var lines = norm.split('\n');
    var nonEmpty = lines.filter(function (l) { return l.trim(); });
    if (!nonEmpty.length) return { rows: [], shape: 'blocks' };

    /* A copied HTML table arrives tab-separated. If it has a header row we can
       map, it is really delimited data — hand it to the CSV path so the user
       gets the same column mapping instead of a worse guess. */
    var tabbed = nonEmpty.filter(function (l) { return l.indexOf('\t') !== -1; });
    if (tabbed.length >= 2 && tabbed.length >= nonEmpty.length * 0.6) {
      var table = parseDelimited(tabbed.join('\n'), '\t');
      var mapping = guessMapping(table.headers);
      var mapped = Object.keys(mapping).filter(function (k) { return mapping[k] !== -1; });
      if (mapped.length >= 2) {
        return { rows: rowsFromTable(table, mapping, 'zapp_paste'), shape: 'table', table: table, mapping: mapping };
      }
      // No usable header: treat every cell as its own line of a block.
      var chunks = tabbed.map(function (l) { return l.split('\t').map(function (c) { return c.trim(); }).filter(Boolean).join('\n'); });
      return { rows: chunks.map(function (c) { return makeCandidate(parseChunk(c), c, 'zapp_paste'); }), shape: 'table' };
    }

    var groups = norm.split(/\n\s*\n+/).map(function (g) { return g.trim(); }).filter(Boolean);
    var blocks = groups.length >= 2 ? mergeOrphans(groups) : segment(lines);
    return {
      /* A block only counts as a show if it carries a date or at least a name
         plus one other real field. Without that, any stray paragraph of text
         would come back as a candidate row with nothing but a name in it. */
      rows: blocks.map(function (c) { return makeCandidate(parseChunk(c), c, 'zapp_paste'); })
                  .filter(function (r) {
                    var f = r.fields;
                    if (f.startDate.value) return true;
                    return !!f.name.value &&
                      !!(f.city.value || f.applyBy.value || f.juryFee.value || f.boothFee.value || f.url.value);
                  }),
      shape: 'blocks'
    };
  }

  /* ======================================================================
     5. CSV / TSV

     RFC4180-ish: quoted fields, embedded delimiters and newlines, doubled
     quotes. The delimiter is sniffed, and every column mapping is chosen in
     the UI — nothing about the xlsx's layout is hardcoded here.
     ====================================================================== */
  /* Sniffed across the first several lines, not just the first: a spreadsheet
     export often leads with a title row that contains no delimiter at all.
     The winner is the character that splits the most lines into the same
     number of columns — a real delimiter is consistent, stray punctuation is
     not. */
  function sniffDelimiter(text) {
    var lines = text.split('\n').filter(function (l) { return l.trim(); }).slice(0, 12);
    var best = ',', bestScore = 0;
    [',', '\t', ';', '|'].forEach(function (d) {
      var byCount = {};
      lines.forEach(function (l) {
        var n = l.split(d).length - 1;
        if (n > 0) byCount[n] = (byCount[n] || 0) + 1;
      });
      Object.keys(byCount).forEach(function (n) {
        var score = Number(n) * byCount[n];
        if (score > bestScore) { bestScore = score; best = d; }
      });
    });
    return best;
  }

  function parseDelimited(text, delim) {
    var s = normalizeText(text).replace(/^﻿/, '');
    if (!delim) delim = sniffDelimiter(s);
    var rows = [], row = [], field = '', inQuotes = false;
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (inQuotes) {
        if (ch === '"') {
          if (s[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += ch;
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === delim) {
        row.push(field); field = '';
      } else if (ch === '\n') {
        row.push(field); rows.push(row); row = []; field = '';
      } else {
        field += ch;
      }
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    rows = rows.filter(function (r) { return r.some(function (c) { return String(c).trim() !== ''; }); })
               .map(function (r) { return r.map(function (c) { return String(c).trim(); }); });
    if (!rows.length) return { headers: [], rows: [], delimiter: delim };

    /* Spreadsheet exports often lead with a title row above the real header.
       The header is the first row whose cells are mostly short, non-numeric
       labels and which is at least as wide as the row under it. */
    var headerIdx = 0;
    for (var h = 0; h < Math.min(rows.length - 1, 8); h++) {
      var r = rows[h].filter(Boolean);
      if (r.length >= 2 && r.length >= rows[h + 1].filter(Boolean).length - 1 &&
          r.every(function (c) { return c.length <= 40 && !/^\$?\d+(\.\d+)?$/.test(c); })) {
        headerIdx = h; break;
      }
    }
    return {
      headers: rows[headerIdx],
      rows: rows.slice(headerIdx + 1),
      delimiter: delim,
      skipped: headerIdx
    };
  }

  /* Header synonyms. Only used to pre-select the dropdowns — every one of them
     is overridable in the mapping step, which is what "not hardcoded" means. */
  var SYNONYMS = {
    name:        ['name','show','show name','event','event name','title','show title','festival','festival name','event title'],
    city:        ['city','town','city state','location','place','city st'],
    state:       ['state','st','province','state abbr'],
    startDate:   ['start','start date','show start','begin','begins','opens','open','from','date','dates','show dates','event dates','show date','event date','first day'],
    endDate:     ['end','end date','show end','ends','closes','close','to','through','thru','last day'],
    applyBy:     ['apply by','applyby','application deadline','app deadline','entry deadline','deadline','deadline date','due date','due','apply','close date'],
    juryFee:     ['jury fee','application fee','app fee','entry fee','jury','fee','juryfee'],
    boothFee:    ['booth fee','booth','space fee','booth cost','booth price','boothfee','space'],
    status:      ['status','application status','app status','result'],
    lat:         ['lat','latitude'],
    lng:         ['lng','lon','long','longitude'],
    routeNumber: ['stop','stop number','route','route number','order','seq','no','num','#'],
    url:         ['url','link','website','web','web site','site'],
    notes:       ['notes','note','comments','comment','remarks']
  };

  function normHeader(h) {
    return String(h || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  /** headers -> { fieldKey: columnIndex | -1 }, best guess, all overridable. */
  function guessMapping(headers) {
    var norm = headers.map(normHeader);
    var used = {}, out = {};
    FIELD_KEYS.forEach(function (k) { out[k] = -1; });

    function claim(key, idx) {
      if (idx === -1 || used[idx]) return false;
      out[key] = idx; used[idx] = true; return true;
    }
    /* Each field's synonyms are listed most-specific-first, and they are tried
       in that order rather than in the file's column order: a sheet with both
       "Apply By" and "Closes" must not hand the deadline to whichever of them
       happens to come first. Exact header matches run before loose ones, so
       "Booth Fee" does not lose its column to a bare "Fee". */
    function scan(test) {
      FIELD_KEYS.forEach(function (key) {
        var syn = SYNONYMS[key] || [];
        for (var i = 0; i < syn.length && out[key] === -1; i++) {
          var want = syn[i];
          claim(key, norm.findIndex(function (h, j) { return !used[j] && !!h && test(h, want); }));
        }
      });
    }
    scan(function (h, want) { return h === want; });
    scan(function (h, want) {
      return h === want || h.indexOf(want + ' ') === 0 || h.indexOf(' ' + want) !== -1;
    });
    return out;
  }

  /**
   * Mapped columns -> candidate rows. Values that came through a column the
   * user chose are high confidence; anything this had to reinterpret (a range
   * split out of one "Dates" column, a city split off a "Location" column, a
   * date that would not parse) is downgraded and annotated.
   */
  function rowsFromTable(table, mapping, source) {
    return table.rows.map(function (r) {
      var fields = blankFields();
      var raw = table.headers.map(function (h, i) { return h + ': ' + (r[i] || ''); }).filter(function (l) {
        return l.split(': ').slice(1).join(': ').trim();
      }).join('\n');

      function val(key) {
        var i = mapping[key];
        return i === -1 || i === undefined ? '' : String(r[i] === undefined ? '' : r[i]).trim();
      }

      var name = val('name');
      if (name) fields.name = cell(name, HIGH);

      var city = val('city');
      if (city) {
        var cs = CITY_STATE.exec(city);
        if (cs) {
          fields.city = cell(cs[1].trim(), HIGH);
          fields.state = cell(cs[2].toUpperCase(), MED, 'State split out of the city column.');
        } else fields.city = cell(city, HIGH);
      }
      var st = val('state');
      if (st) fields.state = cell(st.toUpperCase().slice(0, 2), HIGH);

      /* One "Dates" column often holds the whole range. */
      var startRaw = val('startDate'), endRaw = val('endDate');
      if (startRaw) {
        var range = scanRange(startRaw);
        if (range) {
          var s = settle(range.start, 0);
          if (s.iso) fields.startDate = cell(s.iso, s.confidence === LOW ? LOW : HIGH,
            s.confidence === LOW ? 'Year was not in the cell — check it.' : '');
          if (!endRaw && range.end) {
            var e = settle(range.end, Number((s.iso || '').slice(0, 4)) || 0);
            if (e.iso) fields.endDate = cell(e.iso, MED, 'End date split out of the same cell as the start.');
          }
        } else {
          fields.startDate = cell(startRaw, LOW, 'Could not read this as a date.');
        }
      }
      if (endRaw) {
        var ed = coerceDate(endRaw, Number(fields.startDate.value.slice(0, 4)) || 0);
        fields.endDate = ed ? cell(ed, HIGH) : cell(endRaw, LOW, 'Could not read this as a date.');
      }
      var dlRaw = val('applyBy');
      if (dlRaw) {
        var tok = scanDates(dlRaw)[0];
        var dl = settleDeadline(tok, fields.startDate.value);
        fields.applyBy = dl.iso
          ? cell(dl.iso, dl.confidence === LOW ? LOW : HIGH,
                 dl.confidence === LOW ? 'Deadline year was not in the cell — assumed the season before the show.' : '')
          : cell(dlRaw, LOW, 'Could not read this as a date.');
      }

      ['juryFee','boothFee'].forEach(function (k) {
        var raw2 = val(k);
        if (!raw2) return;
        var m = coerceMoney(raw2);
        fields[k] = m === '' ? cell(raw2, LOW, 'Could not read this as an amount.') : cell(m, HIGH);
      });
      ['lat','lng'].forEach(function (k) {
        var raw3 = val(k);
        if (!raw3) return;
        var n = Number(raw3);
        fields[k] = Number.isFinite(n) ? cell(String(n), HIGH) : cell(raw3, LOW, 'Not a number.');
      });
      var stat = val('status');
      if (stat) {
        var mapped = coerceStatus(stat);
        fields.status = mapped ? cell(mapped, HIGH) : cell('', NONE, 'Status "' + stat + '" is not one of the tracker\'s.');
      }
      ['routeNumber','url','notes'].forEach(function (k) {
        var v = val(k);
        if (v) fields[k] = cell(v, HIGH);
      });
      return makeCandidate(fields, raw, source || 'csv');
    }).filter(function (c) {
      return c.fields.name.value || c.fields.startDate.value;
    });
  }

  /* ======================================================================
     6. CANDIDATES + DUPLICATE DETECTION
     ====================================================================== */
  var candSeq = 0;

  function makeCandidate(fields, raw, source) {
    return {
      key: 'cand-' + (++candSeq),
      fields: fields,
      raw: raw || '',
      source: source || 'zapp_paste',
      include: true,
      dupe: null,          // { kind, id, name, action }
      geo: null            // { state:'ok'|'miss'|'error'|'cached', note }
    };
  }

  /** Name as it compares: case, punctuation, "44th", "annual" and "the" out. */
  function normName(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/\b\d{1,3}(?:st|nd|rd|th)\b/g, ' ')
      .replace(/\bannual\b/g, ' ')
      .replace(/^\s*the\b/, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }
  function yearOf(iso) { return String(iso || '').slice(0, 4); }

  /**
   * Dedupe by name + year, as the phase asks: same normalised name in the
   * same season is the same show. A name that merely contains the other is
   * flagged as "similar" rather than treated as certain, because "Las Olas
   * Art Fair Part I" and "Part II" must not collapse into one row.
   */
  function findDuplicate(cand, shows) {
    var n = normName(cand.fields.name.value);
    var y = yearOf(cand.fields.startDate.value);
    if (!n) return null;
    var exact = null, similar = null;
    shows.forEach(function (s) {
      var sn = normName(s.name), sy = yearOf(s.startDate);
      if (!sn) return;
      if (sn === n && (!y || !sy || sy === y)) { if (!exact) exact = s; return; }
      if (y && sy && sy !== y) return;
      if (sn.indexOf(n) === 0 || n.indexOf(sn) === 0) { if (!similar) similar = s; }
    });
    if (exact) return { kind:'exact', id:exact.id, name:exact.name, action:'update' };
    if (similar) return { kind:'similar', id:similar.id, name:similar.name, action:'add' };
    return null;
  }

  /**
   * Flags every candidate against the existing season and against the rest of
   * the batch, and unticks the certain duplicates.
   */
  function markDuplicates(rows, shows) {
    var seen = {};
    rows.forEach(function (c) {
      c.dupe = findDuplicate(c, shows);
      var sig = normName(c.fields.name.value) + '|' + yearOf(c.fields.startDate.value);
      if (!c.dupe && seen[sig] && normName(c.fields.name.value)) {
        c.dupe = { kind:'batch', id:null, name:'another row in this paste', action:'skip' };
      }
      seen[sig] = true;
      if (c.dupe && c.dupe.kind !== 'similar') c.include = false;
    });
    return rows;
  }

  /** A reviewed candidate -> a Show ready for AST.Store.upsert. */
  function toShow(cand, existing) {
    var f = cand.fields;
    var base = existing || {};
    return A.makeShow({
      id: existing ? existing.id : undefined,
      createdAt: existing ? existing.createdAt : undefined,
      name: f.name.value,
      city: f.city.value,
      state: f.state.value.toUpperCase().slice(0, 2),
      lat: f.lat.value === '' ? null : Number(f.lat.value),
      lng: f.lng.value === '' ? null : Number(f.lng.value),
      startDate: f.startDate.value,
      endDate: f.endDate.value,
      applyBy: f.applyBy.value,
      status: f.status.value || base.status || 'interested',
      rating: base.rating || 0,
      juryFee: f.juryFee.value === '' ? null : Number(f.juryFee.value),
      boothFee: f.boothFee.value === '' ? null : Number(f.boothFee.value),
      routeNumber: f.routeNumber.value,
      isAlternate: existing ? existing.isAlternate : /\b(?:alt|alternate|backup)\b/i.test(f.notes.value),
      notes: f.notes.value || base.notes || '',
      url: f.url.value,
      source: cand.source
    });
  }

  /** Blocking problems, shown per row so a bad row cannot be committed blind. */
  function validate(cand) {
    var f = cand.fields, errs = {};
    if (!f.name.value.trim()) errs.name = 'A show needs a name.';
    if (!f.startDate.value) errs.startDate = 'A start date is required.';
    else if (!A.parseISO(f.startDate.value)) errs.startDate = 'Not a real date.';
    if (f.endDate.value && !A.parseISO(f.endDate.value)) errs.endDate = 'Not a real date.';
    else if (f.endDate.value && f.startDate.value && f.endDate.value < f.startDate.value) {
      errs.endDate = 'Ends before it starts.';
    }
    if (f.applyBy.value && !A.parseISO(f.applyBy.value)) errs.applyBy = 'Not a real date.';
    else if (f.applyBy.value && f.startDate.value && f.applyBy.value > f.startDate.value) {
      errs.applyBy = 'Falls after the show starts.';
    }
    ['juryFee','boothFee'].forEach(function (k) {
      if (f[k].value !== '' && !Number.isFinite(Number(f[k].value))) errs[k] = 'Numbers only.';
    });
    if (f.lat.value !== '' && !(Math.abs(Number(f.lat.value)) <= 90)) errs.lat = 'Runs −90 to 90.';
    if (f.lng.value !== '' && !(Math.abs(Number(f.lng.value)) <= 180)) errs.lng = 'Runs −180 to 180.';
    if (f.url.value && !/^https?:\/\/\S+$/i.test(f.url.value)) errs.url = 'Start with http:// or https://';
    return errs;
  }

  /* ======================================================================
     7. GEOCODING — Nominatim

     Nominatim's usage policy caps this at one request per second and asks
     that results be cached rather than re-requested. Both are enforced here,
     not left to the caller: the rate gate is module-level, so two callers
     cannot each think they are the only one running. Anything that fails
     just leaves lat/lng empty for the manual fields in the review table and
     the edit drawer.
     ====================================================================== */
  var GAP_MS = 1100;                      // a little over 1s, for clock skew
  var nextSlot = 0;

  function rateGate() {
    var now = Date.now();
    var at = Math.max(now, nextSlot);
    nextSlot = at + GAP_MS;
    return new Promise(function (res) { setTimeout(res, at - now); });
  }

  function geoKey(city, state) {
    return (String(city || '').toLowerCase().trim() + '|' + String(state || '').toLowerCase().trim())
      .replace(/\s+/g, ' ');
  }

  var Geocoder = {
    /* Overridable so the test harness can point at a local stub instead of
       hitting the real service. */
    endpoint: 'https://nominatim.openstreetmap.org/search',
    gapMs: GAP_MS,

    cacheSize: function () {
      var c = A.Settings.getGeoCache() || {};
      return Object.keys(c).length;
    },
    clearCache: function () { A.Settings.setGeoCache({}); },

    /** Cached answer only — no request. null when nothing is cached. */
    peek: function (city, state) {
      var c = A.Settings.getGeoCache() || {};
      var hit = c[geoKey(city, state)];
      return hit === undefined ? null : hit;
    },

    /**
     * One place -> { lat, lng } or null, cached either way so a second import
     * of the same season does not hit the service at all.
     * @returns Promise<{ lat, lng, cached } | { miss:true, cached }>
     */
    lookup: function (city, state, opts) {
      opts = opts || {};
      var key = geoKey(city, state);
      if (!key.replace('|', '').trim()) return Promise.resolve({ miss: true, cached: false });

      var cache = A.Settings.getGeoCache() || {};
      if (!opts.force && cache[key] !== undefined) {
        var hit = cache[key];
        return Promise.resolve(hit ? { lat: hit.lat, lng: hit.lng, cached: true } : { miss: true, cached: true });
      }

      var q = [city, state, 'USA'].filter(Boolean).join(', ');
      var url = Geocoder.endpoint + '?format=jsonv2&limit=1&addressdetails=0&q=' + encodeURIComponent(q);

      return rateGate()
        .then(function () { return fetch(url, { headers: { Accept: 'application/json' } }); })
        .then(function (res) {
          if (!res.ok) throw new Error('Nominatim answered ' + res.status);
          return res.json();
        })
        .then(function (data) {
          var top = Array.isArray(data) ? data[0] : null;
          var out = null;
          if (top && top.lat && top.lon) {
            out = { lat: Math.round(Number(top.lat) * 1e6) / 1e6, lng: Math.round(Number(top.lon) * 1e6) / 1e6 };
          }
          var c2 = A.Settings.getGeoCache() || {};
          c2[key] = out;                  // a miss is cached too, so it is asked once
          A.Settings.setGeoCache(c2);
          return out ? { lat: out.lat, lng: out.lng, cached: false } : { miss: true, cached: false };
        });
    },

    /**
     * Every candidate that has a place but no coordinates, one at a time.
     * @param onProgress ({ done, total, cand, result, error })
     * @param shouldStop () => bool, checked between requests so Cancel is real
     */
    fillCoords: function (cands, onProgress, shouldStop) {
      var todo = cands.filter(function (c) {
        return c.include && c.fields.city.value && c.fields.lat.value === '' && c.fields.lng.value === '';
      });
      var done = 0;
      function step(i) {
        if (i >= todo.length || (shouldStop && shouldStop())) {
          return Promise.resolve({ done: done, total: todo.length, stopped: i < todo.length });
        }
        var c = todo[i];
        return Geocoder.lookup(c.fields.city.value, c.fields.state.value)
          .then(function (res) {
            done++;
            if (res.miss) {
              c.geo = { state: 'miss', note: 'Nominatim had no match — type the coordinates in, or leave them blank.' };
            } else {
              c.fields.lat = cell(String(res.lat), MED, 'From Nominatim — check it if the city name is ambiguous.');
              c.fields.lng = cell(String(res.lng), MED, 'From Nominatim — check it if the city name is ambiguous.');
              c.geo = { state: res.cached ? 'cached' : 'ok', note: '' };
            }
            if (onProgress) onProgress({ done: done, total: todo.length, cand: c, result: res });
          })
          .catch(function (err) {
            done++;
            c.geo = { state: 'error', note: (err && err.message) || 'Lookup failed.' };
            if (onProgress) onProgress({ done: done, total: todo.length, cand: c, error: err });
          })
          .then(function () { return step(i + 1); });
      }
      return step(0);
    }
  };

  /* ======================================================================
     8. EXPORTS
     ====================================================================== */
  return {
    FIELDS: FIELDS, FIELD_KEYS: FIELD_KEYS,
    CONFIDENCE_LABEL: CONFIDENCE_LABEL,
    cell: cell, blankFields: blankFields, makeCandidate: makeCandidate,
    parseZapp: parseZapp,
    parseDelimited: parseDelimited, guessMapping: guessMapping, rowsFromTable: rowsFromTable,
    SYNONYMS: SYNONYMS,
    scanDates: scanDates, scanRange: scanRange, coerceDate: coerceDate,
    coerceMoney: coerceMoney, coerceStatus: coerceStatus,
    normName: normName, findDuplicate: findDuplicate, markDuplicates: markDuplicates,
    toShow: toShow, validate: validate,
    Geocoder: Geocoder, geoKey: geoKey
  };
})();
