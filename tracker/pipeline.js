/* ============================================================================
   pipeline.js — the application pipeline's arithmetic. Publishes `ASTPipeline`.

   DOM-free on purpose, the same way calendar.js is: every number here is one a
   phone app would need too, and none of it should have to be re-derived from
   markup.

   Two ideas live here:

     12 — jury fee spend. "$840 across 22 applications, 9 in, $93 each."
     14 — expected value on applying. P(accept) x E[net] - jury fee.

   The honesty rules invert slightly in this file, per docs/build-phases.md §7.
   Elsewhere the rule is "never show a number we do not have". Here most inputs
   ARE the artist's own and are the best data in the system — but every figure
   below is model output wearing a currency sign, so each one that cannot be
   computed returns null with a `missing` list saying which input was absent.
   Nothing here ever falls back to a default, and nothing rounds a gap to zero.
   ==========================================================================*/
var ASTPipeline = (function () {
  'use strict';

  var SETTLED = ['accepted', 'waitlist', 'declined', 'withdrawn'];
  /* Below this many settled applications, the artist's own acceptance rate is
     noise. Four decisions cannot tell you your odds, and a "25%" drawn from
     one acceptance in four would be quoted back as if it meant something. */
  var MIN_PERSONAL_SAMPLE = 8;

  function live(apps) {
    return (apps || []).filter(function (a) { return a && !a.deletedAt; });
  }
  function isSettled(app) { return SETTLED.indexOf(app.stage) !== -1; }
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }

  /**
   * Idea 12 — what the jury fees actually cost, and what they bought.
   *
   * `spent` counts only applications with a recorded fee, and `feesKnown` /
   * `total` say how many that was. A season where half the fees were never
   * entered must not report a total that reads as complete: the caller is
   * expected to render "known fees only, 9 of 22 recorded" whenever those
   * two disagree.
   */
  function spend(apps) {
    var rows = live(apps);
    var withFee = rows.filter(function (a) { return num(a.juryFee) != null; });
    var spent = withFee.reduce(function (t, a) { return t + a.juryFee; }, 0);
    var settled = rows.filter(isSettled);
    var accepted = rows.filter(function (a) { return a.stage === 'accepted'; });
    /* Withdrawn applications are settled but were never judged, so they leave
       the denominator of any rate. You withdrawing is not the jury saying no. */
    var judged = settled.filter(function (a) { return a.stage !== 'withdrawn'; });

    return {
      total: rows.length,
      feesKnown: withFee.length,
      /* Null rather than 0 when nothing has a recorded fee: "no fees entered"
         and "spent nothing" are different statements. */
      spent: withFee.length ? spent : null,
      accepted: accepted.length,
      judged: judged.length,
      pending: rows.length - settled.length,
      /* Only meaningful once something has been judged. */
      acceptanceRatePct: judged.length ? (accepted.length / judged.length) * 100 : null,
      /* The number the tracker exists to show: what one acceptance cost in
         jury fees. Null with nothing accepted — dividing by zero acceptances
         is not "infinite cost", it is a season still in progress. */
      costPerAcceptance: (withFee.length && accepted.length) ? spent / accepted.length : null
    };
  }

  /**
   * The artist's own cold-acceptance rate, or null while the sample is too
   * small to mean anything. This is the first number in the whole tracker
   * derived purely from what the artist did, and it is the seed the trending
   * feature grows from.
   */
  function personalAcceptanceRate(apps) {
    var s = spend(apps);
    if (s.judged < MIN_PERSONAL_SAMPLE) return null;
    return s.acceptanceRatePct;
  }

  /**
   * Idea 14 — expected value of applying.
   *
   *     EV = P(accept) x (expectedGross - boothFee) - juryFee
   *
   * P comes from the show's cold odds; the artist's own rate overrides it once
   * there is enough history, because their real hit rate beats a published
   * average. `expectedGross` has no source anywhere in the catalogue — only
   * the artist knows what they would sell — so with no estimate this returns
   * null and the UI says "not known" rather than inventing a revenue figure.
   *
   * Returns { value, missing, basis } — `missing` names every absent input so
   * the UI can say what it would need, and `basis` says whose odds were used.
   */
  function expectedValue(opts) {
    opts = opts || {};
    var missing = [];

    var pct = num(opts.personalRatePct);
    var basis = 'yours';
    if (pct == null) { pct = num(opts.acceptanceRatePct); basis = 'published'; }
    if (pct == null) { missing.push('acceptance odds'); basis = null; }

    var gross = num(opts.expectedGross);
    if (gross == null) missing.push('your expected gross');
    var booth = num(opts.boothFee);
    if (booth == null) missing.push('booth fee');
    var jury = num(opts.juryFee);
    if (jury == null) missing.push('jury fee');

    if (missing.length) return { value: null, missing: missing, basis: basis };
    return { value: (pct / 100) * (gross - booth) - jury, missing: [], basis: basis };
  }

  /** Applications for one show, newest cycle first. */
  function forShow(apps, showId) {
    return live(apps)
      .filter(function (a) { return a.showId === showId; })
      .sort(function (a, b) { return String(b.cycle).localeCompare(String(a.cycle)); });
  }

  /** The one application for a show in a given cycle, or null. */
  function forCycle(apps, showId, cycle) {
    return forShow(apps, showId).filter(function (a) {
      return String(a.cycle) === String(cycle);
    })[0] || null;
  }

  return {
    SETTLED: SETTLED,
    MIN_PERSONAL_SAMPLE: MIN_PERSONAL_SAMPLE,
    spend: spend,
    personalAcceptanceRate: personalAcceptanceRate,
    expectedValue: expectedValue,
    forShow: forShow,
    forCycle: forCycle
  };
})();
