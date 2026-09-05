/* ==========================================================================
   Show Ledger — Fit Model (members' edition)

   Ranks shows by how well each one fits a particular artist's business,
   rather than by whose gross sales were biggest.

   Why this exists: Sunshine Artist's *200 Best* ranks on artist-reported
   gross, pooled across every price point, and the Art Fair SourceBook on net
   average sales. A show that moves 4,000 pieces at $150 outranks a show where
   forty people buy at $4,000. For expensive originals that ranking is close
   to useless. This model asks a different question — which shows are the best
   business opportunities for the work I actually make?

   Three things are kept strictly apart, and the UI never blurs them:

     FACTS      dates, fees, booth counts, media juried. Sourced, link-cited,
                dated. Either verified or explicitly not.
     EDITORIAL  the ten factor scores. Informed estimates, never audited data,
                always carrying a confidence grade.
     INTEL      what members actually report. The only genuinely precise
                layer, and it arrives over time rather than on day one.

   Classic script, no build step, publishes window.ASTFit. See core.js for
   why this codebase avoids ES modules.
   ========================================================================== */
window.ASTFit = (function () {
  'use strict';

  /* ---- 1. FACTORS --------------------------------------------------------
     Ten sub-scores per show, 1-10. The invariant that makes the whole model
     readable: 10 is ALWAYS good for the artist. Where the underlying quantity
     runs the other way (cost, competition, difficulty getting in) the factor
     is named and scored so that higher still means better. Never add a factor
     that breaks this.

     Factors 1-7 carry over from the original eight-factor model and are the
     artist-calibrated ones. Factor 8 was 'Low 2D Competition', which only
     made sense for a painter; it generalises here to the artist's own medium.
     Factors 9 and 10 are new and DELIBERATELY START NULL — see scoreShow().  */
  var FACTORS = [
    { key:'buyerWealth', label:'Buyer wealth', short:'Wealth',
      help:'Disposable wealth in the room. Second-home markets, private-client towns, ticketed gates.' },
    { key:'fineArtOrientation', label:'Fine art orientation', short:'Fine art',
      help:'How far the field leans to original fine art rather than craft, gift and production work.' },
    { key:'priceTolerance', label:'High price tolerance', short:'Price',
      help:'How realistic your top-of-range sale is here. Low means the crowd buys, but at $200.' },
    { key:'salesTrackRecord', label:'Sales track record', short:'Sales',
      help:'Reputation for artists actually making money. Reported, not audited.' },
    { key:'prestige', label:'Prestige & standing', short:'Prestige',
      help:'Jury difficulty and national standing. What the show does for your resume.' },
    { key:'qualifiedTraffic', label:'Qualified traffic', short:'Traffic',
      help:'Attendees who came to buy art, not to hear a band. Not raw headcount.' },
    { key:'costEfficiency', label:'Cost efficiency', short:'Cost',
      help:'How cheap the show is all-in — booth, jury, travel, lodging. Higher means cheaper.',
      inverted:true },
    { key:'lowCompetition', label:'Thin field in your medium', short:'Field',
      help:'How few artists you are competing against in your own category. Higher means fewer rivals.',
      inverted:true, perDiscipline:true },
    { key:'logistics', label:'Logistics & booth fit', short:'Logistics',
      help:'Load-in, vehicle access, power, weather exposure, weight limits. Higher means easier.',
      inverted:true, perDiscipline:true },
    { key:'juryOdds', label:'Jury odds', short:'Odds',
      help:'How realistic acceptance is. A 9.4 fit you will never get into is worth less than an 8.1 you will.',
      inverted:true }
  ];
  var FACTOR_KEYS = FACTORS.map(function (f) { return f.key; });
  var FACTOR_BY_KEY = {};
  FACTORS.forEach(function (f, i) { FACTOR_BY_KEY[f.key] = f; f.index = i; });

  /* ---- 2. DISCIPLINES ----------------------------------------------------
     Fine art only. No craft, no production work, nothing wearable.

     Each discipline carries its own weights over the ten factors, because the
     same show is a different business proposition depending on what you make.
     A glass artist and an oil painter standing in the same booth space have
     genuinely different problems: one is worried about dedicated power and a
     gust of wind, the other about wall run and how many other painters got in.

     Weights are relative and need not sum to anything in particular.         */
  var DISCIPLINES = [
    {
      key:'painting', label:'Painting (oil & acrylic)',
      blurb:'Original wall work at the top of the price range, in the most crowded category on the circuit.',
      /*      wealth fineart price sales prestige traffic cost field logist odds */
      weights:[  20,    16,    20,   12,     8,      8,     4,    8,    2,    2 ],
      /* Which factors this discipline is unusually sensitive to, surfaced in
         the UI as "why these weights" rather than left as bare numbers. */
      drivers:['Price tolerance and buyer wealth carry the score — a painting priced for a collector does not sell to a crowd that came for lunch.',
               'Competition is weighted heavily because painting is the largest accepted category at nearly every show.']
    },
    {
      key:'works_on_paper', label:'Works on paper & drawing',
      blurb:'Watercolour, gouache, pastel, drawing. Connoisseur work with a lower ceiling than oil and a thinner tolerance for a bad crowd.',
      weights:[  16,    20,    14,   12,    12,     10,     6,    6,    2,    2 ],
      drivers:['Fine art orientation outranks buyer wealth: works on paper are invisible at a show that leans to craft and gift.',
               'Prestige matters more than for oil — the standing of the show does a lot of the arguing for the medium.']
    },
    {
      key:'printmaking', label:'Printmaking',
      blurb:'Original editioned work — intaglio, relief, litho, screen. Distinct from reproduction, and juries are the first thing to test that.',
      weights:[  10,    20,     6,   18,    12,     12,    10,    6,    2,    4 ],
      drivers:['Volume and cost efficiency replace price tolerance: the model is many sales at a lower ceiling, so a cheap show that sells is a good show.',
               'Jury odds are weighted up because a real share of shows restrict or bar editioned work outright.']
    },
    {
      key:'mixed_media', label:'Mixed media',
      blurb:'Original mixed media at $2,000-$10,000. The calibration this model was originally built around.',
      weights:[  20,    17,    20,   14,     8,      7,     4,    6,    2,    2 ],
      drivers:['The default high-end originals profile: wealth and price tolerance dominate, cost barely registers.',
               'A show that cannot support a $4,000 sale is not cheap, it is a loss.']
    },
    {
      key:'sculpture', label:'Sculpture',
      blurb:'Three-dimensional original work. Highest ceiling on the circuit and the hardest to physically get there.',
      weights:[  22,    14,    22,   10,     8,      6,     6,    2,    8,    2 ],
      drivers:['The highest price-tolerance weighting of any discipline — the ceiling is real, but only in the right room.',
               'Logistics is weighted up and competition down: freight, weight limits and vehicle access are the binding constraints, and the field is naturally thin.']
    },
    {
      key:'glass', label:'Glass',
      blurb:'Blown, cast, fused and kiln-formed work as fine art. Small field, strong collector base, brutal physics.',
      weights:[  20,    14,    18,   10,     8,      6,     4,    4,   14,    2 ],
      drivers:['Logistics carries more weight here than in any other discipline. Dedicated power and controlled lighting are not comforts — unlit glass does not sell.',
               'Outdoor wind exposure and load-in surface are a direct financial risk, not an inconvenience.']
    },
    {
      key:'ceramics', label:'Ceramics (fine art)',
      blurb:'Sculptural and vessel-as-sculpture work. Explicitly not functional pottery or production ware.',
      weights:[  16,    22,    14,   12,    10,      8,     6,    4,    6,    2 ],
      drivers:['Fine art orientation is the single heaviest factor: at a craft-leaning show, fine art ceramics gets read as expensive tableware.',
               'Fragility and weight put logistics above the 2D disciplines without reaching glass.']
    },
    {
      key:'photography', label:'Photography & digital',
      blurb:'Fine art photography and digital work. The most crowded and most price-suppressed of the fine art categories.',
      weights:[  14,    18,    12,   14,    14,     10,     6,   10,    2,    4 ],
      drivers:['Competition and prestige are both weighted up — the medium fights a permanent "it is just a print" discount, and the standing of the show is the counter-argument.',
               'Price tolerance is weighted down against the 2D originals, because the realistic ceiling is lower whatever the room.']
    },
    {
      key:'wood', label:'Wood (sculptural & turned)',
      blurb:'Sculptural, carved and turned work as fine art. Not furniture, not production woodwork.',
      weights:[  16,    20,    14,   14,     8,      8,     8,    4,    6,    2 ],
      drivers:['Orientation is weighted high for the same reason as ceramics: the category is constantly misread as craft, and the jury language tells you which show does that.',
               'Weight and freight put logistics mid-table; the field is small enough that competition rarely decides anything.']
    },
    {
      key:'fiber', label:'Fiber (non-wearable)',
      blurb:'Sculptural and wall-hung fiber as fine art. Nothing wearable, nothing functional.',
      weights:[  16,    24,    14,   12,    10,      8,     6,    4,    4,    2 ],
      drivers:['The heaviest fine art orientation weighting in the model. No category on the circuit is more dependent on whether the show treats it as art or as craft.',
               'Humidity and weather exposure matter more than the low logistics weight suggests — check the per-show notes, not just the score.']
    }
  ];
  var DISCIPLINE_BY_KEY = {};
  DISCIPLINES.forEach(function (d) { DISCIPLINE_BY_KEY[d.key] = d; });

  /* ---- 3. PRICE BANDS ----------------------------------------------------
     The second axis, and the one the original model conflated with medium.
     Two oil painters, one selling at $600 and one at $12,000, want almost
     opposite things from the same calendar. Discipline sets the shape of the
     weights; price band tilts it.

     Applied as multipliers so a band never overrides the discipline's
     character, it leans on it. Normalised afterwards, so the totals stay
     comparable across bands.                                                 */
  var PRICE_BANDS = [
    { key:'under_500', label:'Under $500',
      note:'Volume business. A cheap show that sells beats a prestigious one that does not.',
      /*  wealth fineart price sales prestige traffic cost field logist odds */
      mult:[ 0.55,  0.9,  0.30, 1.30,  0.7,   1.45,  1.9,  1.0,  1.0, 1.15 ] },
    { key:'500_2000', label:'$500 – $2,000',
      note:'Mid-range originals. Still needs traffic, but the room has to be able to say yes to four figures.',
      mult:[ 0.85,  1.0,  0.75, 1.15,  0.9,   1.15,  1.3,  1.0,  1.0, 1.05 ] },
    { key:'2000_10000', label:'$2,000 – $10,000', baseline:true,
      note:'High-end originals. The model\'s baseline calibration.',
      mult:[ 1.0,   1.0,  1.0,  1.0,   1.0,   1.0,   1.0,  1.0,  1.0, 1.0  ] },
    { key:'over_10000', label:'Over $10,000',
      note:'You need forty right people, not four thousand people. Traffic stops being an asset and prestige starts doing the work.',
      mult:[ 1.35,  1.1,  1.40, 0.85,  1.45,  0.55,  0.6,  0.9,  1.0, 0.95 ] }
  ];
  var BAND_BY_KEY = {};
  PRICE_BANDS.forEach(function (b) { BAND_BY_KEY[b.key] = b; });

  /* ---- 4. STRATEGY PRESETS -----------------------------------------------
     Cross-cutting, and deliberately kept separate from discipline. These
     answer "what am I optimising for this season?" rather than "what do I
     make?" — a sculptor having a cash-flow year and a sculptor chasing a
     resume want different calendars out of identical work.                   */
  var STRATEGIES = [
    { key:'balanced',  label:'Balanced', note:'Your discipline and price band, untilted.',
      mult:[1,1,1,1,1,1,1,1,1,1] },
    { key:'prestige',  label:'Build the resume',
      note:'Weight standing and jury difficulty. Take the harder show at the lower margin.',
      mult:[1.0, 1.3, 1.0, 0.8, 2.6, 0.9, 0.6, 1.0, 0.9, 0.7] },
    { key:'revenue',   label:'Maximise gross',
      note:'Chase the money. Reputation and jury difficulty stop mattering.',
      mult:[1.1, 0.8, 1.1, 2.2, 0.5, 1.4, 1.2, 1.0, 1.0, 1.1] },
    { key:'low_risk',  label:'Budget & low risk',
      note:'Protect the downside. Cheap to enter, cheap to reach, realistic to get into.',
      mult:[0.8, 1.0, 0.8, 1.2, 0.5, 1.1, 3.0, 1.0, 1.3, 1.8] },
    { key:'proven',    label:'Only what is proven',
      note:'Lean on member-reported results and confirmed facts. Penalises thin data hard.',
      mult:[1.0, 1.0, 1.1, 1.8, 0.9, 1.0, 1.0, 1.0, 1.0, 1.0], demandsEvidence:true }
  ];
  var STRATEGY_BY_KEY = {};
  STRATEGIES.forEach(function (s) { STRATEGY_BY_KEY[s.key] = s; });

  /* ---- 5. PROFILE --------------------------------------------------------
     What the artist is. Everything the model does flows from these three
     choices plus any manual override of the weights.                         */
  function makeProfile(input) {
    input = input || {};
    var d = DISCIPLINE_BY_KEY[input.discipline] ? input.discipline : 'painting';
    var b = BAND_BY_KEY[input.priceBand] ? input.priceBand : '2000_10000';
    var s = STRATEGY_BY_KEY[input.strategy] ? input.strategy : 'balanced';
    return {
      discipline: d,
      priceBand: b,
      strategy: s,
      /* A manual weight array overrides the computed one entirely. Null means
         "keep following the presets", which is what most artists should do. */
      customWeights: Array.isArray(input.customWeights) && input.customWeights.length === FACTORS.length
        ? input.customWeights.map(function (n) { return Math.max(0, Number(n) || 0); })
        : null
    };
  }

  /**
   * Discipline shape x price-band tilt x strategy tilt, normalised to sum 100
   * so two profiles produce comparable numbers.
   */
  function weightsFor(profile) {
    profile = makeProfile(profile);
    if (profile.customWeights) return normalise(profile.customWeights);
    var base = DISCIPLINE_BY_KEY[profile.discipline].weights;
    var band = BAND_BY_KEY[profile.priceBand].mult;
    var strat = STRATEGY_BY_KEY[profile.strategy].mult;
    return normalise(base.map(function (w, i) { return w * band[i] * strat[i]; }));
  }

  function normalise(ws) {
    var total = ws.reduce(function (a, b) { return a + b; }, 0);
    if (!total) return ws.map(function () { return 100 / ws.length; });
    return ws.map(function (w) { return w * 100 / total; });
  }

  /* ---- 6. SCORING --------------------------------------------------------
     The one rule that keeps this honest: a factor with no data does not get a
     made-up value. It drops out, and the weighted average renormalises over
     the factors that ARE scored. A show scored on eight factors and a show
     scored on ten both produce a number out of 10, and `coverage` tells you
     which you are looking at.

     The alternative — defaulting missing factors to 5 — would silently pull
     every under-researched show toward the middle and make the model look
     more confident than it is. Do not do that.                               */
  function scoreShow(show, profile, opts) {
    opts = opts || {};
    var weights = weightsFor(profile);
    var disciplineKey = makeProfile(profile).discipline;
    var scores = resolveScores(show, disciplineKey, opts);

    var sum = 0, used = 0, missing = [];
    FACTOR_KEYS.forEach(function (key, i) {
      var v = scores[key];
      if (v == null || !isFinite(v)) { missing.push(key); return; }
      sum += v * weights[i];
      used += weights[i];
    });

    if (!used) return { fit: null, coverage: 0, missing: missing, weights: weights, scores: scores };

    var fit = sum / used;

    /* "Only what is proven" is not a weighting, it is a discount. A show can
       score 9.2 on editorial estimate alone; under this strategy that is not
       the same claim as 9.2 with a dozen member reports behind it, and the
       ranking should say so out loud rather than in a footnote. */
    var strategy = makeProfile(profile).strategy;
    /* Scoring from reports IS the evidence, so it never takes the discount —
       the discount exists to mark estimates, and there is no estimate here. */
    var evidence = opts.factorsOnly ? 'reported' : evidenceLevel(show);
    if (!opts.factorsOnly && STRATEGY_BY_KEY[strategy].demandsEvidence) {
      fit = fit * EVIDENCE_DISCOUNT[evidence];
    }

    return {
      fit: Math.round(fit * 100) / 100,
      coverage: Math.round(used) / 100,   /* share of total weight actually scored */
      missing: missing,
      weights: weights,
      scores: scores,
      evidence: evidence,
      confidence: show.confidence || 'Low'
    };
  }

  /* How much of the score rests on something other than an estimate. */
  var EVIDENCE_DISCOUNT = { reported: 1.0, verified: 0.97, estimated: 0.85, placeholder: 0.72 };
  function evidenceLevel(show) {
    var n = (show.intel && show.intel.reportCount) || 0;
    if (n >= 3) return 'reported';
    if (show.confidence === 'High') return 'verified';
    if (show.confidence === 'Medium') return 'estimated';
    return 'placeholder';
  }

  /**
   * Resolve the ten factor values for a show under one discipline.
   *
   * Precedence, highest first:
   *   1. member consensus  — what artists in THIS discipline actually reported
   *   2. per-discipline editorial — where the show is known to differ by medium
   *   3. shared editorial — the base estimate
   * Nulls fall through rather than defaulting, per scoreShow's contract.
   */
  function resolveScores(show, disciplineKey, opts) {
    opts = opts || {};

    /* `factorsOnly` switches the model from "best available estimate" to
       "this source and nothing else". It is how the reported lenses work:
       ranking by what artists actually found has to mean ONLY that, or an
       editorial guess quietly fills the gaps and the lens stops being an
       answer to the question it was asked. A show with no reports scores
       null here, and null sinks to the bottom rather than inventing a
       middle. */
    if (opts.factorsOnly) {
      var only = {};
      FACTOR_KEYS.forEach(function (k) {
        var v = opts.factorsOnly[k];
        only[k] = v == null ? null : clamp10(v);
      });
      return only;
    }

    var base = show.factors || {};
    var perDisc = (show.byDiscipline && show.byDiscipline[disciplineKey]) || {};
    var member = opts.memberConsensus || (show.intel && show.intel.byDiscipline
                 && show.intel.byDiscipline[disciplineKey]) || {};
    var out = {};
    FACTOR_KEYS.forEach(function (k) {
      var v = null;
      if (opts.useMemberData !== false && member[k] != null) v = member[k];
      else if (perDisc[k] != null) v = perDisc[k];
      else if (base[k] != null) v = base[k];
      out[k] = v == null ? null : clamp10(v);
    });
    return out;
  }

  function clamp10(v) {
    var n = Number(v);
    if (!isFinite(n)) return null;
    return Math.max(1, Math.min(10, n));
  }

  /* ---- 7. HARD GATES -----------------------------------------------------
     Not everything is a score. Some things are yes or no, and burying them in
     a weighted average is how an artist ends up applying to a show that does
     not jury their medium at all. These are facts, so they only fire when the
     fact is actually known.                                                  */
  function gates(show, profile) {
    var p = makeProfile(profile);
    var out = [];
    var media = show.facts && show.facts.mediaCategories;

    /* A blocking gate is only honest on a COMPLETE category list. Half a list
       says nothing about what is missing from it, and telling a sculptor a
       show does not take sculpture — because the research only captured seven
       of seventeen categories — is worse than saying nothing. So the gate
       fires on completeness, and a partial list downgrades to a hint. */
    if (Array.isArray(media) && media.length) {
      var listed = media.indexOf(p.discipline) !== -1;
      var complete = show.facts.mediaCategoriesComplete === true;
      if (!listed && complete) {
        out.push({ level:'blocking', code:'medium_not_juried',
          text:'This show does not list a category for ' + DISCIPLINE_BY_KEY[p.discipline].label.toLowerCase() + '.' });
      } else if (!listed) {
        out.push({ level:'hint', code:'medium_unconfirmed',
          text:'We have only a partial category list for this show, and ' +
               DISCIPLINE_BY_KEY[p.discipline].label.toLowerCase() + ' is not among the categories captured. Confirm before applying.' });
      }
    }
    if (show.facts && show.facts.editionedWorkAllowed === false && p.discipline === 'printmaking') {
      out.push({ level:'blocking', code:'no_editions',
        text:'Editioned work is not accepted here.' });
    }
    if (show.facts && show.facts.powerAvailable === false && (p.discipline === 'glass')) {
      out.push({ level:'warning', code:'no_power',
        text:'No booth power. Glass does not sell unlit — budget for battery lighting or skip.' });
    }
    if (show.facts && show.facts.vehicleAccessToBooth === false &&
        ['sculpture','glass','ceramics','wood'].indexOf(p.discipline) !== -1) {
      out.push({ level:'warning', code:'no_vehicle_access',
        text:'No vehicle access to the booth. Heavy or fragile work means a long hand-carry both ways.' });
    }

    /* Commission is the one cost the fit score genuinely cannot carry. The
       price band tilts cost efficiency DOWN as work gets dearer, which is right
       for a fixed booth fee — $900 is noise against a $40,000 weekend — and
       exactly backwards for a percentage. A 15% commission is a rounding error
       at $300 a piece and $1,200 on a single $8,000 sale.

       Rather than bend the weighting into something that is wrong half the
       time, the commission is stated plainly with the arithmetic done. */
    var pct = show.facts && show.facts.commissionPct;
    if (pct != null && pct > 0) {
      var midpoint = { under_500: 300, '500_2000': 1200, '2000_10000': 6000, over_10000: 15000 }[p.priceBand];
      var perSale = Math.round(midpoint * pct / 100);
      out.push({
        level: (p.priceBand === 'over_10000' || p.priceBand === '2000_10000') && pct >= 10
          ? 'warning' : 'hint',
        code: 'commission',
        text: pct + '% commission on sales — about $' + perSale.toLocaleString('en-US') +
              ' on a typical sale at your price point, on top of any booth fee. ' +
              'A low booth fee here is not the whole cost.'
      });
    }
    return out;
  }

  /* ---- 8. RANKING --------------------------------------------------------- */
  function rank(shows, profile, opts) {
    var scored = shows.map(function (s) {
      var r = scoreShow(s, profile, opts);
      return { show:s, fit:r.fit, detail:r, gates:gates(s, profile) };
    });
    /* Blocking gates sink to the bottom rather than vanishing — an artist is
       entitled to see that a show they have heard of does not take their
       medium, instead of wondering why it never appears. */
    scored.sort(function (a, b) {
      var ab = a.gates.some(isBlocking) ? 1 : 0;
      var bb = b.gates.some(isBlocking) ? 1 : 0;
      if (ab !== bb) return ab - bb;
      if (a.fit == null) return 1;
      if (b.fit == null) return -1;
      return b.fit - a.fit;
    });
    scored.forEach(function (r, i) { r.rank = i + 1; });
    return scored;
  }
  function isBlocking(g) { return g.level === 'blocking'; }

  /* ---- 9. BUYER TYPE (derived, never authored) ---------------------------- */
  function buyerType(show, disciplineKey) {
    var s = resolveScores(show, disciplineKey || 'painting', {});
    var f1 = s.buyerWealth, f2 = s.fineArtOrientation, f3 = s.priceTolerance;
    if (f2 == null) return 'Unknown';
    if (f2 >= 8 && f3 >= 8 && f1 >= 8) return 'Collector';
    if (f2 >= 7 && f3 >= 6) return 'Fine art';
    if (f2 >= 5) return 'Mixed';
    if (f2 >= 4) return 'Craft / design';
    return 'Marketplace';
  }

  return {
    FACTORS: FACTORS,
    FACTOR_KEYS: FACTOR_KEYS,
    FACTOR_BY_KEY: FACTOR_BY_KEY,
    DISCIPLINES: DISCIPLINES,
    DISCIPLINE_BY_KEY: DISCIPLINE_BY_KEY,
    PRICE_BANDS: PRICE_BANDS,
    STRATEGIES: STRATEGIES,
    makeProfile: makeProfile,
    weightsFor: weightsFor,
    scoreShow: scoreShow,
    resolveScores: resolveScores,
    evidenceLevel: evidenceLevel,
    gates: gates,
    rank: rank,
    buyerType: buyerType
  };
})();
