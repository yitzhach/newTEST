/* ============================================================================
   expenses.js — the expense log's arithmetic. Publishes `ASTExpenses`.

   DOM-free like pipeline.js and calendar.js.

   This is idea 8 (true landed cost) and idea 18 (the expense log) from
   build-phases.md §7 Stage 2. Two rules govern the whole file, and they pull
   in opposite directions from the rest of the app:

   1. THE NUMBERS ARE THE ARTIST'S OWN and are the most reliable data in the
      system. But a row nobody costed is still unknown, not zero. A total that
      quietly absorbs blank amounts is how somebody budgets on a wrong figure,
      so every total says how many rows it could actually see.

   2. NOTHING HERE SAYS ANYTHING IS DEDUCTIBLE. A Schedule C-shaped log invites
      the question and the answer is not ours to give. Categorising a row is
      bookkeeping; telling somebody it is deductible is tax advice. The
      categories exist so a year of rows does not need re-sorting in April,
      and that is the whole of it.

   Mileage and fuel are deliberately both supported and never merged. They are
   two ways of accounting for the same driving, an artist's accountant will
   want one of them, and picking for them would be both wrong and advice.
   ==========================================================================*/
var ASTExpenses = (function () {
  'use strict';

  function live(rows) {
    return (rows || []).filter(function (r) { return r && !r.deletedAt; });
  }
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }

  /**
   * What one row cost. Mileage rows are miles x the artist's own rate; if
   * either is missing the row has no cost yet, which is not the same as a
   * free trip. Everything else uses the amount as entered.
   */
  function costOf(row) {
    if (!row) return null;
    if (row.category === 'mileage') {
      var m = num(row.miles), r = num(row.mileageRate);
      /* An explicit amount wins: an artist who typed a figure has overridden
         the calculation, and second-guessing them would be rude and wrong. */
      if (num(row.amount) != null) return row.amount;
      return (m != null && r != null) ? m * r : null;
    }
    return num(row.amount);
  }

  /**
   * Add up a set of rows. `known` and `total` are both returned, always, so
   * the caller can say "9 of 22 rows costed" rather than presenting a partial
   * sum as a complete one.
   */
  function sum(rows) {
    var list = live(rows);
    var costed = list.map(costOf).filter(function (c) { return c != null; });
    return {
      total: list.length,
      known: costed.length,
      /* Null, not 0, when nothing is costed: "nothing entered" and "spent
         nothing" are different statements. */
      amount: costed.length ? costed.reduce(function (t, c) { return t + c; }, 0) : null,
      complete: list.length > 0 && costed.length === list.length
    };
  }

  /** Totals per category, in the order the categories are declared. */
  function byCategory(rows, categories) {
    var list = live(rows);
    return (categories || []).map(function (c) {
      var mine = list.filter(function (r) { return r.category === c.value; });
      return { key: c.value, label: c.label, rows: mine.length, sum: sum(mine) };
    }).filter(function (c) { return c.rows > 0; });
  }

  /** Every row belonging to one show. */
  function forShow(rows, showId) {
    return live(rows).filter(function (r) { return r.showId === showId; });
  }

  /**
   * Idea 8 — what a show actually cost, all in. Expenses only: this is money
   * that left, not what the show's listed fees said it would be.
   */
  function landedCost(rows, showId) {
    return sum(forShow(rows, showId));
  }

  /**
   * True when a show has BOTH mileage and fuel rows. Not an error and not a
   * warning — the log is right to hold both — but the artist should know the
   * two are there so nobody double-counts the same driving downstream.
   */
  function hasBothDrivingMethods(rows, showId) {
    var mine = showId ? forShow(rows, showId) : live(rows);
    return mine.some(function (r) { return r.category === 'mileage'; }) &&
           mine.some(function (r) { return r.category === 'fuel'; });
  }

  /**
   * Idea 13 — break-even. What must be sold to clear the money already spent.
   * Null while nothing is costed, because "sell $0" is a claim, not a blank.
   *
   * `commissionPct` follows the catalogue rule: not mentioned is not zero. A
   * null commission means the figure is what the artist must SELL before the
   * show takes its cut, and the caller must say so rather than implying the
   * artist keeps all of it.
   */
  function breakEven(rows, showId, commissionPct) {
    var spent = landedCost(rows, showId);
    if (spent.amount == null) return { value: null, spent: spent, commissionKnown: false };
    var pct = num(commissionPct);
    if (pct == null || pct <= 0 || pct >= 100) {
      return { value: spent.amount, spent: spent, commissionKnown: false };
    }
    return { value: spent.amount / (1 - pct / 100), spent: spent, commissionKnown: true };
  }

  /**
   * §7 Stage 1 — did the weekend pay for itself?
   *
   * Gross is the artist's own figure for what the show took. The show's cut
   * comes off it, then everything the expense log knows they spent, and what
   * is left is the net. Three refusals hold this together:
   *
   *  - No gross, no answer. `null` is "not recorded", and inventing a zero
   *    would turn every unrecorded show into a loss.
   *  - A partial expense total makes the net PROVISIONAL, and it is returned
   *    as such: uncosted rows can only push the real number down, so a net
   *    computed over 3 of 9 rows is a ceiling, not a result.
   *  - "Not mentioned" is not zero. A null commission means no cut is
   *    subtracted and `commissionKnown` is false, so the caller says the
   *    figure is before whatever the show takes rather than implying nothing.
   */
  function showResult(rows, showId, opts) {
    opts = opts || {};
    var spent = landedCost(rows, showId);
    var gross = num(opts.grossSales);
    var pct = num(opts.commissionPct);
    var commissionKnown = pct != null && pct > 0 && pct < 100;
    var cut = (gross != null && commissionKnown) ? gross * (pct / 100) : null;

    var missing = [];
    if (gross == null) missing.push('gross sales');
    if (spent.amount == null) missing.push('at least one costed expense');

    var net = null;
    if (gross != null && spent.amount != null) {
      net = gross - (cut || 0) - spent.amount;
    }
    return {
      gross: gross,
      commissionKnown: commissionKnown,
      commissionCut: cut,
      spent: spent,
      net: net,
      /* Only a complete expense total settles the question. Anything else is
         a best case, and `cleared` says so by staying null. */
      cleared: (net == null || !spent.complete) ? null : net >= 0,
      provisional: net != null && !spent.complete,
      missing: missing
    };
  }

  /**
   * The same question across a season: how many shows can actually be
   * answered, and what the answered ones came to. Shows with no gross are
   * counted as unanswered rather than as zeroes.
   */
  function seasonResult(rows, shows) {
    var list = (shows || []).filter(function (s) { return s && !s.deletedAt; });
    var answered = [], provisional = 0, net = null;
    list.forEach(function (s) {
      var r = showResult(rows, s.id, { grossSales: s.grossSales, commissionPct: s.commissionPct });
      if (r.net == null) return;
      answered.push({ showId: s.id, name: s.name, result: r });
      if (r.provisional) provisional++;
      net = (net == null ? 0 : net) + r.net;
    });
    return {
      total: list.length,
      known: answered.length,
      provisional: provisional,
      net: net,
      shows: answered,
      complete: list.length > 0 && answered.length === list.length && provisional === 0
    };
  }

  /* ---- lodging finds -----------------------------------------------------
     Where an artist could park or stay cheaply is worth real money, is
     knowledge artists already trade between themselves, and is published
     nowhere. It rides on the expense row so nobody types the place twice. */

  /** Lodging rows that record something useful about how they got the bed. */
  function lodgingFinds(rows) {
    return live(rows).filter(function (r) {
      return r.category === 'lodging' &&
        (r.lodgingKind === 'free' || r.lodgingKind === 'discount' ||
         r.overnightParking === true || r.rvFriendly === true);
    });
  }

  /** Only the finds the artist explicitly marked shareable. Opt-in, always. */
  function shareableFinds(rows) {
    return lodgingFinds(rows).filter(function (r) { return r.shareable === true; });
  }

  /**
   * How affordable a show looked on lodging, from what this artist recorded.
   * Returns null rather than a score when they have not stayed there — the
   * ranking must not treat "never been" as "expensive".
   */
  function lodgingAffordability(rows, showId) {
    var stays = forShow(rows, showId).filter(function (r) { return r.category === 'lodging'; });
    if (!stays.length) return null;
    var free = stays.some(function (r) { return r.lodgingKind === 'free'; });
    var disc = stays.some(function (r) { return r.lodgingKind === 'discount'; });
    var s = sum(stays);
    return {
      nights: stays.reduce(function (t, r) { return t + (num(r.nights) || 0); }, 0),
      spent: s.amount,
      free: free,
      discounted: disc,
      overnightParking: stays.some(function (r) { return r.overnightParking === true; }),
      rvFriendly: stays.some(function (r) { return r.rvFriendly === true; })
    };
  }

  return {
    costOf: costOf,
    sum: sum,
    byCategory: byCategory,
    forShow: forShow,
    landedCost: landedCost,
    hasBothDrivingMethods: hasBothDrivingMethods,
    breakEven: breakEven,
    showResult: showResult,
    seasonResult: seasonResult,
    lodgingFinds: lodgingFinds,
    shareableFinds: shareableFinds,
    lodgingAffordability: lodgingAffordability
  };
})();
