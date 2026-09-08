/* ============================================================================
   ranker.js — saved, named rankings. Publishes `ASTRanker`.

   The fit model already answers "which shows suit a painter selling at
   $2-10k". This answers a narrower and more useful question: which shows suit
   THIS artist, by their own reckoning, saved under a name they chose.

   It is deliberately a thin layer. fit.js already accepts `customWeights` and
   already knows how to drop an unscored factor out of a weighted average, so
   a ranking here compiles down to a normal fit profile and goes through the
   same audited scoring path. Nothing in this file scores a show. A second
   scorer would be a second set of bugs and a second set of honesty rules.

   What this file does own:
     - the record shape and its defaults
     - compiling a saved ranking into a fit profile
     - export and import, including validating a list somebody else wrote

   PRIVACY IS THE DEFAULT. Artists guard their show lists, and a ranking is a
   map of where somebody intends to be all year. Nothing leaves the device
   unless it is deliberately exported: `shared` starts false, export is an
   explicit act, and there is no background transport at all yet.

   AI REFINEMENT SEAM: `explain()` returns the ranking as plain structured
   text — which factors are up, which are down, against the preset baseline.
   That is the input an assistant would need to suggest changes, and
   `applySuggestion()` is the one place a suggestion would be merged back,
   through the same clamping every other write goes through. Neither calls a
   model today, and no network transport exists here.
   ==========================================================================*/
var ASTRanker = (function () {
  'use strict';

  var F = window.ASTFit;
  /* Bumped only when the payload shape changes incompatibly. An importer
     that does not recognise the version refuses the file rather than
     guessing at what the fields used to mean. */
  var FORMAT = 1;
  var FORMAT_KIND = 'art-show-tracker/ranking';
  var MAX_WEIGHT = 10;
  var NAME_MAX = 60;

  function clampWeight(n) {
    var v = Number(n);
    if (!isFinite(v) || v < 0) return 0;
    return Math.min(v, MAX_WEIGHT);
  }
  /** Text from a file somebody else wrote. Length-capped; never HTML. */
  function cleanText(v, max) {
    return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max || NAME_MAX);
  }

  /** The preset weights this ranking started from, for showing a delta. */
  function baselineFor(rk) {
    return F.weightsFor({
      discipline: rk.discipline, priceBand: rk.priceBand, strategy: rk.strategy
    });
  }

  /**
   * A saved ranking as a fit profile. `weights: null` means the artist has
   * not overridden anything, so the presets still drive — which is what most
   * people should be doing, and what a brand-new ranking does.
   */
  function toProfile(rk, extra) {
    rk = rk || {};
    var p = {
      discipline: rk.discipline, priceBand: rk.priceBand, strategy: rk.strategy,
      customWeights: Array.isArray(rk.weights) ? rk.weights.map(clampWeight) : null
    };
    if (extra && extra.lens) p.lens = extra.lens;
    return p;
  }

  /** Weights to show in an editor: the saved ones, or the presets they'd start from. */
  function editableWeights(rk) {
    if (rk && Array.isArray(rk.weights)) return rk.weights.map(clampWeight);
    /* weightsFor normalises to percentages; rescale so the editor's numbers
       sit on the same 0-10 scale the artist is dragging. */
    var base = baselineFor(rk || {});
    var max = Math.max.apply(null, base);
    return base.map(function (w) { return max ? Math.round((w / max) * 10 * 10) / 10 : 0; });
  }

  /**
   * What makes this ranking distinctive, as structured data rather than a
   * sentence — the UI phrases it, and an assistant refining the ranking reads
   * the same thing. Compares against the preset baseline, so "cares about
   * cost more than most painters do" is expressible.
   */
  function explain(rk) {
    if (!rk || !Array.isArray(rk.weights)) return { custom: false, up: [], down: [] };
    var base = baselineFor(rk);
    var maxB = Math.max.apply(null, base) || 1;
    var norm = base.map(function (w) { return (w / maxB) * 10; });
    var up = [], down = [];
    rk.weights.forEach(function (w, i) {
      var f = F.FACTORS[i];
      if (!f) return;
      var d = clampWeight(w) - norm[i];
      if (d >= 1.5) up.push({ key: f.key, label: f.label, delta: Math.round(d * 10) / 10 });
      else if (d <= -1.5) down.push({ key: f.key, label: f.label, delta: Math.round(d * 10) / 10 });
    });
    var by = function (a, b) { return Math.abs(b.delta) - Math.abs(a.delta); };
    return { custom: true, up: up.sort(by), down: down.sort(by) };
  }

  /**
   * Merge a suggested set of weights in. The single place a refinement — from
   * an assistant, or from an imported list the artist wants to borrow — is
   * allowed to change a ranking, so the clamping happens once. Returns a new
   * record; it never writes.
   */
  function applySuggestion(rk, weights) {
    if (!Array.isArray(weights) || weights.length !== F.FACTORS.length) return rk;
    return Object.assign({}, rk, { weights: weights.map(clampWeight) });
  }

  /* ---- sharing ----------------------------------------------------------
     A file, today. The artist exports it and sends it however they like; the
     network transport it is shaped for does not exist until the Worker is
     deployed. The payload carries only the criteria — never the artist's
     shows, calendar, applications or fees. A ranking says what somebody
     values, not where they will be standing in June.                       */

  function toPayload(rk) {
    return {
      format: FORMAT_KIND,
      version: FORMAT,
      exportedAt: new Date().toISOString(),
      ranking: {
        name: cleanText(rk.name, NAME_MAX),
        ownerName: cleanText(rk.ownerName, NAME_MAX),
        discipline: rk.discipline || '',
        priceBand: rk.priceBand || '',
        strategy: rk.strategy || '',
        weights: Array.isArray(rk.weights) ? rk.weights.map(clampWeight) : null,
        notes: cleanText(rk.notes, 600),
        /* The factor keys the weights were written against. An importer that
           sees a list it does not recognise refuses rather than silently
           applying somebody's "cost" weight to a factor that has since been
           renamed or reordered. */
        factors: F.FACTOR_KEYS.slice()
      }
    };
  }

  /**
   * Read a ranking somebody else wrote. Everything here is untrusted: it
   * arrived as a file. Returns { ok, ranking, error } and never throws —
   * a malformed file is a message to the artist, not a broken page.
   */
  function fromPayload(raw) {
    var data = raw;
    if (typeof raw === 'string') {
      try { data = JSON.parse(raw); }
      catch (_) { return { ok: false, error: 'That file is not a ranking — it is not readable JSON.' }; }
    }
    if (!data || typeof data !== 'object' || data.format !== FORMAT_KIND) {
      return { ok: false, error: 'That file is not an art show ranking.' };
    }
    if (Number(data.version) !== FORMAT) {
      return { ok: false, error: 'That ranking was saved by a different version and cannot be read safely.' };
    }
    var r = data.ranking;
    if (!r || typeof r !== 'object') return { ok: false, error: 'That ranking file is empty.' };

    /* The factor list must match ours exactly, in order. Weights are
       positional, so a mismatch would apply the wrong number to the wrong
       factor and produce a ranking that looks plausible and is wrong. */
    if (Array.isArray(r.factors)) {
      var same = r.factors.length === F.FACTOR_KEYS.length &&
                 r.factors.every(function (k, i) { return k === F.FACTOR_KEYS[i]; });
      if (!same) {
        return { ok: false, error: 'That ranking was built against a different set of factors.' };
      }
    }
    var weights = null;
    if (Array.isArray(r.weights)) {
      if (r.weights.length !== F.FACTORS.length) {
        return { ok: false, error: 'That ranking has the wrong number of weights.' };
      }
      weights = r.weights.map(clampWeight);
    }
    var name = cleanText(r.name, NAME_MAX);
    return {
      ok: true,
      ranking: {
        name: name || 'Untitled ranking',
        ownerName: cleanText(r.ownerName, NAME_MAX),
        discipline: r.discipline || '',
        priceBand: r.priceBand || '',
        strategy: r.strategy || '',
        weights: weights,
        notes: cleanText(r.notes, 600),
        /* Imported stays imported. Somebody else's judgment does not quietly
           become yours because it now sits in your list. */
        origin: 'imported',
        sourceName: cleanText(r.ownerName, NAME_MAX),
        shared: false
      }
    };
  }

  return {
    FORMAT: FORMAT,
    FORMAT_KIND: FORMAT_KIND,
    MAX_WEIGHT: MAX_WEIGHT,
    NAME_MAX: NAME_MAX,
    clampWeight: clampWeight,
    cleanText: cleanText,
    baselineFor: baselineFor,
    editableWeights: editableWeights,
    toProfile: toProfile,
    explain: explain,
    applySuggestion: applySuggestion,
    toPayload: toPayload,
    fromPayload: fromPayload
  };
})();
