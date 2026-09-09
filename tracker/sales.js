/* ============================================================================
   sales.js — individual sales: the record set, the mix, and the CSV import.
   Publishes `ASTSales`. DOM-free like pipeline.js, calendar.js and expenses.js.

   This is §7 Stage 3 (ideas 15 and 19), and it is the stage the whole
   accounting suite was staged toward: Stages 1 and 2 are bookkeeping a
   spreadsheet already does, and this is where the artist's own numbers start
   saying something the catalogue cannot — which price band actually sells,
   and where.

   Four rules govern the file.

   1. A SALE IS A CHILD RECORD. Many per show, each with its own id and
      updatedAt, exactly like an application or an expense. Two devices each
      selling a different piece on the same Saturday must merge as a union.

   2. THE STATED TOTAL AND THE ROWS ARE TWO RECORDS, NOT ONE. A show's
      `grossSales` (Stage 1) is what the artist said the weekend took. The
      rows are what they wrote down piece by piece. Both are real evidence and
      they will disagree — a cash sale nobody logged, a refund, a correction.
      `reconcile` reports BOTH and names which one a figure came from. It
      never overwrites one with the other and never quietly picks.

   3. AN UNPRICED ROW IS NULL, NEVER $0, and every total says how many rows it
      could see. Same rule as the expense log, for the same reason.

   4. SELL-THROUGH NEEDS A DENOMINATOR NOBODY HAS ENTERED. The real figure is
      sold ÷ brought, and nothing in this app knows how many pieces went in
      the van. So the mix is reported as counts and revenue per band, and the
      RATE STAYS NULL with the missing input named, rather than a percentage
      of something we made up.

   Nothing here says anything is deductible, and nothing here is tax advice.
   ==========================================================================*/
var ASTSales = (function () {
  'use strict';

  function live(rows) {
    return (rows || []).filter(function (r) { return r && !r.deletedAt; });
  }
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }

  /* ---- price bands -------------------------------------------------------
     A bucketing of the artist's own prices, not a judgment about them. The
     bands are wide on purpose: narrow ones over a season of a few dozen sales
     produce buckets of one, and a bucket of one looks like a trend. */
  var PRICE_BANDS = [
    { key:'under_100', label:'Under $100',      min:0,    max:100 },
    { key:'100_249',   label:'$100 – $249', min:100,  max:250 },
    { key:'250_499',   label:'$250 – $499', min:250,  max:500 },
    { key:'500_999',   label:'$500 – $999', min:500,  max:1000 },
    { key:'1000_2499', label:'$1,000 – $2,499', min:1000, max:2500 },
    { key:'2500_plus', label:'$2,500 and up',   min:2500, max:Infinity }
  ];

  /** Which band a price falls in. Null price means null band — not "cheap". */
  function bandOf(price) {
    var p = num(price);
    if (p == null || p < 0) return null;
    for (var i = 0; i < PRICE_BANDS.length; i++) {
      if (p >= PRICE_BANDS[i].min && p < PRICE_BANDS[i].max) return PRICE_BANDS[i].key;
    }
    return null;
  }
  function bandLabel(key) {
    var b = PRICE_BANDS.filter(function (x) { return x.key === key; })[0];
    return b ? b.label : 'Not priced';
  }

  /* ---- totals ------------------------------------------------------------ */

  /** What one row brought in. Price x quantity, or null if unpriced. */
  function valueOf(row) {
    if (!row) return null;
    var p = num(row.price);
    if (p == null) return null;
    var q = num(row.quantity);
    return p * (q != null && q > 0 ? q : 1);
  }

  /**
   * Add up a set of sales. `known` and `total` are always both returned, so a
   * caller can say "8 of 11 rows priced" rather than presenting a partial sum
   * as a season's takings.
   */
  function sum(rows) {
    var list = live(rows);
    var vals = list.map(valueOf).filter(function (v) { return v != null; });
    var pieces = list.reduce(function (t, r) {
      var q = num(r.quantity); return t + (q != null && q > 0 ? q : 1);
    }, 0);
    return {
      total: list.length,
      known: vals.length,
      pieces: pieces,
      /* Null, not 0, when nothing is priced: "nothing entered" and "sold
         nothing" are different statements about a weekend. */
      amount: vals.length ? vals.reduce(function (t, v) { return t + v; }, 0) : null,
      complete: list.length > 0 && vals.length === list.length
    };
  }

  /** Every sale belonging to one show. */
  function forShow(rows, showId) {
    return live(rows).filter(function (r) { return r.showId === showId; });
  }

  /** Sales with no show attached — a studio or online sale, still a real one. */
  function unattached(rows) {
    return live(rows).filter(function (r) { return !r.showId; });
  }

  /* ---- the mix ----------------------------------------------------------- */

  /**
   * Idea 15 — what sells. Counts and revenue per price band, plus the share
   * of revenue each band accounts for. Unpriced rows are reported as their own
   * bucket rather than being dropped, because a season with six unpriced rows
   * has a mix nobody can read yet and the page has to be able to say so.
   */
  function byBand(rows) {
    var list = live(rows);
    var whole = sum(list);
    var out = PRICE_BANDS.map(function (b) {
      var mine = list.filter(function (r) { return bandOf(r.price) === b.key; });
      var s = sum(mine);
      return {
        key: b.key, label: b.label, rows: mine.length, sum: s,
        /* Share of the revenue we can actually see. Null when there is no
           revenue to take a share of. */
        shareOfRevenue: (whole.amount && s.amount != null) ? s.amount / whole.amount : null
      };
    }).filter(function (b) { return b.rows > 0; });
    var unpriced = list.filter(function (r) { return num(r.price) == null; });
    return {
      bands: out,
      unpriced: unpriced.length,
      revenue: whole.amount,
      complete: whole.complete
    };
  }

  /**
   * Idea 19 — where it sells. Grouped by the show's state, because that is
   * the geography the app actually knows; a sale whose show has no state, or
   * no show at all, lands in an explicit "not known" bucket instead of being
   * quietly filed under somewhere.
   */
  function byRegion(rows, shows) {
    var list = live(rows);
    var index = {};
    (shows || []).forEach(function (s) { if (s && s.id) index[s.id] = s; });
    var groups = {}, order = [];
    list.forEach(function (r) {
      var show = index[r.showId];
      var key = (show && show.state) ? String(show.state).toUpperCase() : '';
      if (!groups[key]) { groups[key] = []; order.push(key); }
      groups[key].push(r);
    });
    order.sort(function (a, b) {
      if (!a) return 1; if (!b) return -1;
      return (sum(groups[b]).amount || 0) - (sum(groups[a]).amount || 0);
    });
    return order.map(function (key) {
      var mine = groups[key];
      var s = sum(mine);
      return {
        key: key,
        label: key || 'Not known',
        known: !!key,
        rows: mine.length,
        shows: uniq(mine.map(function (r) { return r.showId; }).filter(Boolean)).length,
        sum: s,
        /* What one show in this state has been worth, over the shows that
           have at least one row. Null rather than a figure while nothing in
           the state is priced. */
        perShow: (s.amount != null && uniq(mine.map(function (r) { return r.showId; }).filter(Boolean)).length)
          ? s.amount / uniq(mine.map(function (r) { return r.showId; }).filter(Boolean)).length
          : null
      };
    });
  }
  function uniq(list) {
    return list.filter(function (v, i, a) { return a.indexOf(v) === i; });
  }

  /**
   * Sell-through, honestly. The figure everybody means by the word is
   * sold ÷ brought, and NOTHING IN THIS APP KNOWS HOW MANY PIECES WENT IN THE
   * VAN. So `rate` is null and `missing` names what it would take, while the
   * parts we do know — how many sold, at what, in which band, in which state —
   * are returned in full.
   *
   * `piecesBrought` is accepted as an optional caller-supplied count for the
   * day somebody records it. Given one, the rate is real; without one, there
   * is no rate, and a made-up denominator is exactly the kind of number this
   * app exists not to print.
   */
  function sellThrough(rows, shows, opts) {
    opts = opts || {};
    var list = live(rows);
    var brought = num(opts.piecesBrought);
    var s = sum(list);
    return {
      sold: s.pieces,
      revenue: s.amount,
      priced: s.known,
      rows: s.total,
      brought: brought,
      rate: (brought != null && brought > 0) ? s.pieces / brought : null,
      missing: (brought != null && brought > 0) ? [] : ['how many pieces you brought'],
      bands: byBand(list),
      regions: byRegion(list, shows)
    };
  }

  /* ---- the stated total vs. the rows -------------------------------------- */

  /**
   * The Stage 1 field and the Stage 3 rows, side by side.
   *
   * `grossSales` on the show is the artist's own stated total for the
   * weekend. The rows are the piece-by-piece record. Both are the artist's
   * own evidence, they are collected at different moments, and they will
   * disagree — a cash sale that never got written down, a refund, a typo
   * being corrected. Neither is authoritative over the other.
   *
   * So this returns both, plus `showing`, which names the one a headline
   * figure came from, and `agree`. It NEVER writes one from the other. The
   * UI's whole job here is to say which number it is putting on screen.
   *
   *   showing: 'stated'  — only the show's field exists, or both do
   *            'rows'    — only the sale rows exist
   *            null      — neither
   *
   * When both exist the stated total is what a headline shows, because it is
   * the figure the artist asserted for the whole weekend and the rows are
   * explicitly allowed to be incomplete — but `agree` is false and the
   * difference is returned, so the page reports the pair rather than the pick.
   */
  function reconcile(sales, show) {
    var rows = forShow(sales, show && show.id);
    var s = sum(rows);
    var stated = num(show && show.grossSales);
    var rowsTotal = s.amount;

    if (stated == null && rowsTotal == null) {
      return { stated: null, rows: s, rowsTotal: null, showing: null, amount: null,
               agree: null, difference: null, both: false };
    }
    if (stated == null) {
      return { stated: null, rows: s, rowsTotal: rowsTotal, showing: 'rows',
               amount: rowsTotal, agree: null, difference: null, both: false };
    }
    if (rowsTotal == null) {
      return { stated: stated, rows: s, rowsTotal: null, showing: 'stated',
               amount: stated, agree: null, difference: null, both: false };
    }
    /* Both. Rounded to the cent before comparing, so floating point does not
       manufacture a disagreement out of 0.30000000000000004. */
    var diff = Math.round((stated - rowsTotal) * 100) / 100;
    return {
      stated: stated,
      rows: s,
      rowsTotal: rowsTotal,
      showing: 'stated',
      amount: stated,
      agree: diff === 0,
      difference: diff,
      both: true
    };
  }

  /** The sentence the UI uses, so the wording is one thing and testable. */
  function reconcileNote(rec) {
    if (!rec || rec.showing == null) return 'No sales recorded for this show — neither a total nor any rows.';
    if (rec.showing === 'rows') {
      return 'From ' + rec.rows.known + ' priced sale row' + (rec.rows.known === 1 ? '' : 's') +
        '. You have not stated a gross total for this show, so this is the rows added up.';
    }
    if (!rec.both) {
      return 'Your stated gross for the show. No individual sale rows are logged against it yet.';
    }
    if (rec.agree) {
      return 'Your stated gross for the show, and the ' + rec.rows.known +
        ' priced sale row' + (rec.rows.known === 1 ? '' : 's') + ' add up to the same figure.';
    }
    var more = rec.difference > 0;
    return 'Your stated gross for the show. The ' + rec.rows.known + ' priced sale row' +
      (rec.rows.known === 1 ? '' : 's') + ' come to ' + fmt(rec.rowsTotal) + ', ' +
      fmt(Math.abs(rec.difference)) + (more ? ' less' : ' more') +
      '. Both are kept — neither is corrected from the other.' +
      (rec.rows.total > rec.rows.known
        ? ' ' + (rec.rows.total - rec.rows.known) + ' row' +
          (rec.rows.total - rec.rows.known === 1 ? ' has' : 's have') + ' no price yet.'
        : '');
  }
  function fmt(n) { return n == null ? '—' : '$' + Math.round(n).toLocaleString(); }

  /* ---- CSV import (Square / Stripe) --------------------------------------
     Manual entry at a booth is a thing nobody does, so the card reader's own
     export is the realistic way rows get here. An export is UNTRUSTED INPUT
     and is treated like the ranking importer treats one: a row that cannot be
     read is REFUSED with a reason, never guessed into shape. */

  /** RFC4180-ish. Handles quoted fields, embedded commas, doubled quotes. */
  function parseCsv(text) {
    var rows = [], row = [], field = '', quoted = false, i = 0;
    var src = String(text == null ? '' : text).replace(/^﻿/, '');
    while (i < src.length) {
      var c = src[i];
      if (quoted) {
        if (c === '"') {
          if (src[i + 1] === '"') { field += '"'; i += 2; continue; }
          quoted = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"') { quoted = true; i++; continue; }
      if (c === ',') { row.push(field); field = ''; i++; continue; }
      if (c === '\r') { i++; continue; }
      if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      field += c; i++;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (v) { return String(v).trim() !== ''; }); });
  }

  /* Header names each processor uses, lowercased. Several alternatives per
     field because both exports have changed their column names over the
     years and an artist's file is whatever they downloaded. */
  var COLUMNS = {
    square: {
      signature: ['gross sales', 'net sales'],
      date:    ['date'],
      piece:   ['item', 'description', 'item name'],
      price:   ['gross sales', 'net sales', 'total collected'],
      qty:     ['qty', 'quantity'],
      payment: ['card brand', 'card', 'payment method', 'entry method'],
      id:      ['transaction id', 'payment id', 'token'],
      notes:   ['notes', 'category']
    },
    stripe: {
      signature: ['created (utc)', 'converted amount', 'amount refunded'],
      date:    ['created (utc)', 'created', 'created date (utc)'],
      piece:   ['description', 'statement descriptor'],
      price:   ['amount', 'converted amount'],
      qty:     ['quantity'],
      payment: ['payment method type', 'card brand', 'payment_method_type'],
      id:      ['id', 'payment intent id', 'charge id'],
      notes:   ['status', 'currency']
    }
  };

  /** Which export this is, from its header row. Null when it is neither. */
  function detectFormat(header) {
    var lower = (header || []).map(function (h) { return String(h).trim().toLowerCase(); });
    var hit = function (names) { return names.some(function (n) { return lower.indexOf(n) !== -1; }); };
    if (hit(COLUMNS.stripe.signature) && hit(COLUMNS.stripe.id)) return 'stripe';
    if (hit(COLUMNS.square.signature)) return 'square';
    /* Stripe files without the converted-amount column still look like Stripe
       if they carry both an id and an amount and nothing Square-shaped. */
    if (hit(['amount']) && hit(['id']) && !hit(['item', 'qty'])) return 'stripe';
    return null;
  }

  function indexOfAny(lower, names) {
    for (var i = 0; i < names.length; i++) {
      var at = lower.indexOf(names[i]);
      if (at !== -1) return at;
    }
    return -1;
  }

  /** "$1,234.56", "(12.00)", "1234.56 USD" -> a number, or null if unreadable. */
  function money(v) {
    var s = String(v == null ? '' : v).trim();
    if (!s) return null;
    var neg = /^\(.*\)$/.test(s) || /^-/.test(s);
    s = s.replace(/[()]/g, '').replace(/[^0-9.\-]/g, '').replace(/(?!^)-/g, '');
    if (s === '' || s === '-' || s === '.') return null;
    var n = Number(s);
    if (!isFinite(n)) return null;
    return neg && n > 0 ? -n : n;
  }

  /** Whatever the processor wrote -> ISO, or '' if it is not a readable date. */
  function isoDate(v) {
    var s = String(v == null ? '' : v).trim();
    if (!s) return '';
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[1] + '-' + m[2] + '-' + m[3];
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);   // US order, as both exports write it
    if (m) return m[3] + '-' + pad(m[1]) + '-' + pad(m[2]);
    return '';
  }
  function pad(n) { return ('0' + String(n)).slice(-2); }

  /* Card brands and processor codes, mapped onto the app's own short list.
     Anything unrecognised becomes 'card' only when the column was a card
     column at all; otherwise it stays blank, because inventing a payment
     method makes the by-method mix wrong in a way nobody would notice. */
  function paymentOf(raw) {
    var s = String(raw == null ? '' : raw).trim().toLowerCase();
    if (!s) return '';
    if (/cash/.test(s)) return 'cash';
    if (/check|cheque/.test(s)) return 'check';
    if (/visa|master|amex|american express|discover|card|credit|debit|contactless|swipe|chip|tap|apple|google/.test(s)) return 'card';
    if (/link|invoice|online|paypal|ach|bank|transfer|sepa/.test(s)) return 'online';
    return 'other';
  }

  /**
   * Read a Square or Stripe export into sale-shaped objects.
   *
   * Nothing is written to storage here: the caller gets rows, refusals and
   * warnings and decides. Refusals are the point of the function —
   *
   *  - an unrecognised file is refused whole, rather than column-guessed;
   *  - a refund (a negative amount, or a Stripe status that is not paid) is
   *    skipped and counted, because a refund is not a sale and subtracting it
   *    from a season it was never added to would be worse;
   *  - a row with no readable amount imports with `price: null`, not $0;
   *  - `externalId` carries the processor's own id, so re-importing the same
   *    export updates rows instead of doubling the season.
   *
   * `showId` is the caller's: the export knows a date, not which weekend it
   * was. Attaching every row to the show the artist picked is an assertion
   * they made, not one the file made.
   */
  function importCsv(text, opts) {
    opts = opts || {};
    var table = parseCsv(text);
    if (table.length < 2) {
      return { ok: false, format: null, rows: [], skipped: [], warnings: [],
               error: 'That file has no rows under its header, so there is nothing to read.' };
    }
    var header = table[0];
    var lower = header.map(function (h) { return String(h).trim().toLowerCase(); });
    var format = opts.format || detectFormat(header);
    if (!format) {
      return { ok: false, format: null, rows: [], skipped: [], warnings: [],
               error: 'This does not look like a Square or Stripe export. ' +
                      'Nothing was imported — guessing at the columns of an ' +
                      'unknown file would put wrong prices in your sales log.' };
    }
    var map = COLUMNS[format];
    var at = {};
    Object.keys(map).forEach(function (k) {
      if (k !== 'signature') at[k] = indexOfAny(lower, map[k]);
    });
    if (at.price === -1) {
      return { ok: false, format: format, rows: [], skipped: [], warnings: [],
               error: 'That ' + format + ' export has no amount column, so no ' +
                      'sale in it has a price. Nothing was imported.' };
    }

    var statusAt = lower.indexOf('status');
    var rows = [], skipped = [], warnings = [];
    var unpriced = 0, undated = 0;

    table.slice(1).forEach(function (r, n) {
      var line = n + 2;
      var cell = function (i) { return i >= 0 && i < r.length ? r[i] : ''; };
      var amount = money(cell(at.price));

      if (statusAt !== -1) {
        var status = String(cell(statusAt)).trim().toLowerCase();
        if (status && !/paid|succeed|complete|captur/.test(status)) {
          skipped.push({ line: line, reason: 'not a completed payment (' + status + ')' });
          return;
        }
      }
      if (amount != null && amount < 0) {
        skipped.push({ line: line, reason: 'a refund, not a sale' });
        return;
      }
      var date = isoDate(cell(at.date));
      if (!date) undated++;
      if (amount == null) unpriced++;

      var qty = Number(String(cell(at.qty)).trim());
      rows.push({
        showId: opts.showId || '',
        piece: String(cell(at.piece)).trim(),
        /* Null, not 0. A row the export left blank is a sale nobody priced. */
        price: amount,
        date: date,
        paymentMethod: paymentOf(cell(at.payment)),
        quantity: isFinite(qty) && qty > 0 ? Math.round(qty) : 1,
        source: format,
        externalId: String(cell(at.id)).trim(),
        notes: ''
      });
    });

    if (unpriced) {
      warnings.push(unpriced + ' row' + (unpriced === 1 ? '' : 's') +
        ' had no readable amount and came in unpriced rather than as $0.');
    }
    if (undated) {
      warnings.push(undated + ' row' + (undated === 1 ? '' : 's') +
        ' had no readable date and came in with the date left blank.');
    }
    if (at.piece === -1) {
      warnings.push('That export has no item or description column, so no row ' +
        'carries a piece name. Add them yourself — nothing was invented.');
    }
    return { ok: true, format: format, rows: rows, skipped: skipped,
             warnings: warnings, error: null };
  }

  /**
   * Fold imported rows against what is already stored, matching on the
   * processor's own id. A row already imported comes back as an update
   * carrying its existing record's id; a row with no external id can never be
   * matched and is always new, which is stated rather than hidden.
   */
  function mergeImported(existing, incoming) {
    var have = {};
    live(existing).forEach(function (r) {
      if (r.externalId) have[r.source + ':' + r.externalId] = r;
    });
    var added = [], updated = [], unmatchable = 0;
    (incoming || []).forEach(function (r) {
      var key = r.source + ':' + r.externalId;
      if (!r.externalId) { unmatchable++; added.push(r); return; }
      if (have[key]) updated.push(Object.assign({}, r, { id: have[key].id }));
      else added.push(r);
    });
    return { added: added, updated: updated, unmatchable: unmatchable };
  }

  return {
    PRICE_BANDS: PRICE_BANDS,
    bandOf: bandOf,
    bandLabel: bandLabel,
    valueOf: valueOf,
    sum: sum,
    forShow: forShow,
    unattached: unattached,
    byBand: byBand,
    byRegion: byRegion,
    sellThrough: sellThrough,
    reconcile: reconcile,
    reconcileNote: reconcileNote,
    parseCsv: parseCsv,
    detectFormat: detectFormat,
    importCsv: importCsv,
    mergeImported: mergeImported
  };
})();
