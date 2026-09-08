/* ============================================================================
   jury.js — mock jury review. Publishes `ASTJury`. DOM-free.

   An artist assembles a submission, a juror scores it and writes back. What
   this file mostly does is refuse to overstate any of that, because every
   part of the feature is currently unbuilt plumbing:

     - THERE IS NO IMAGE STORAGE. The Worker that would hold R2 is undeployed,
       so an image is described, never uploaded. `canUpload()` says false and
       nothing in the app claims a file was sent.
     - THERE IS NO TRANSPORT. A request cannot reach a juror, so `canSubmit()`
       says false and a request stays a draft on this device. Nothing claims
       to have been sent — the same rule the calendar's reminders follow.
     - THERE IS NO BILLING. Nothing is owed until a juror has claimed a
       request, which is what `chargeableAt()` encodes so the rule survives
       being forgotten later.

   And one honesty rule that outlives the plumbing:

     A JUROR'S SCORE IS NOT A SHOW'S JURY ODDS. One is an opinion about your
     images; the other is the show's own published data. They must never be
     shown as comparable numbers, and a review score never enters the fit
     model. `SCORE_IS_NOT_ODDS` is the sentence the UI uses to say so.
   ==========================================================================*/
var ASTJury = (function () {
  'use strict';

  /* Most shows ask for five works and a booth shot. It is a default, not a
     fact about any particular show — nothing has opened their pages. */
  var TYPICAL_WORKS = 5;
  var TYPICAL_BOOTH = 1;

  var SCORE_IS_NOT_ODDS =
    "A juror's score is an opinion about your images. It is not the show's " +
    'acceptance rate and does not predict whether you will get in.';

  var NO_TRANSPORT =
    'Requests cannot reach a juror yet — the review service is not running. ' +
    'This is saved on your device only. Nothing has been sent.';

  var NO_STORAGE =
    'Images cannot be uploaded yet. Describe them here; the files stay with you.';

  /* Both false until the Worker is deployed. They are functions rather than
     constants so that deploying it is a one-line change here, not a hunt. */
  function canUpload() { return false; }
  function canSubmit() { return false; }

  function live(rows) {
    return (rows || []).filter(function (r) { return r && !r.deletedAt; });
  }

  function countKind(review, kind) {
    return ((review && review.images) || []).filter(function (i) { return i.kind === kind; }).length;
  }

  /**
   * What is still missing before a submission is worth sending. Returns the
   * gaps rather than a boolean, so the UI can say what to do next instead of
   * just refusing.
   */
  function readiness(review, opts) {
    opts = opts || {};
    var wantWorks = opts.works == null ? TYPICAL_WORKS : opts.works;
    var wantBooth = opts.booth == null ? TYPICAL_BOOTH : opts.booth;
    var works = countKind(review, 'work');
    var booth = countKind(review, 'booth');
    var missing = [];
    if (works < wantWorks) missing.push((wantWorks - works) + ' more work image' +
      (wantWorks - works === 1 ? '' : 's'));
    if (booth < wantBooth) missing.push('a booth shot');
    if (!String((review && review.askedAbout) || '').trim()) {
      missing.push('what you want looked at');
    }
    return {
      works: works, booth: booth,
      wantWorks: wantWorks, wantBooth: wantBooth,
      missing: missing,
      ready: missing.length === 0
    };
  }

  /**
   * The money rule, in code so it cannot be quietly lost: nothing is owed
   * until a juror has claimed the request. Returns the timestamp a charge
   * could honestly be made at, or null if that has not happened.
   */
  function chargeableAt(review) {
    if (!review) return null;
    return review.claimedAt || null;
  }

  /** True only once a juror has actually written something back. */
  function isReturned(review) {
    return !!(review && review.stage === 'returned' && review.returnedAt);
  }

  /**
   * The score, or null. Deliberately not defaulted: a review nobody has
   * scored is unscored, which is neither a 5 nor a 0.
   */
  function scoreOf(review) {
    if (!isReturned(review)) return null;
    var s = review.score;
    return (typeof s === 'number' && isFinite(s)) ? s : null;
  }

  /** Reviews for one show, newest first. */
  function forShow(reviews, showId) {
    return live(reviews)
      .filter(function (r) { return r.showId === showId; })
      .sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
  }

  /** Counts for the header. Nothing here is money. */
  function summary(reviews) {
    var rows = live(reviews);
    var scored = rows.map(scoreOf).filter(function (s) { return s != null; });
    return {
      total: rows.length,
      drafts: rows.filter(function (r) { return r.stage === 'draft'; }).length,
      waiting: rows.filter(function (r) { return r.stage === 'requested' || r.stage === 'claimed'; }).length,
      returned: rows.filter(isReturned).length,
      /* Null, not 0, with nothing scored yet. */
      averageScore: scored.length
        ? Math.round((scored.reduce(function (t, s) { return t + s; }, 0) / scored.length) * 10) / 10
        : null
    };
  }

  return {
    TYPICAL_WORKS: TYPICAL_WORKS,
    TYPICAL_BOOTH: TYPICAL_BOOTH,
    SCORE_IS_NOT_ODDS: SCORE_IS_NOT_ODDS,
    NO_TRANSPORT: NO_TRANSPORT,
    NO_STORAGE: NO_STORAGE,
    canUpload: canUpload,
    canSubmit: canSubmit,
    readiness: readiness,
    chargeableAt: chargeableAt,
    isReturned: isReturned,
    scoreOf: scoreOf,
    forShow: forShow,
    summary: summary
  };
})();
