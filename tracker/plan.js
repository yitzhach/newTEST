/* ============================================================================
   plan.js — Pro previews. Publishes `ASTPlan`.

   There is NO billing in this project, no accounts, no entitlement check and
   no payment of any kind. This file does exactly one honest thing: it marks a
   feature that is planned but not built, so an artist can see what is coming
   without being lied to about what they have.

   The rules it exists to enforce:

     - A Pro feature is ALWAYS shown disabled. It never half-works, and it
       never collects anything.
     - It never shows a price, a plan name, a trial, or a sign-up. Quoting a
       price for something that cannot be bought is a false offer.
     - It says what the feature would do and that plans do not exist yet.
       "Upgrade to unlock" implies an upgrade exists. It does not.

   When billing is real, the disabled state is the only thing that changes.
   ==========================================================================*/
var ASTPlan = (function () {
  'use strict';

  /* Everything here is a plan, not a product. Nothing in this list works. */
  var PRO = {
    art_rep: {
      label: 'Art representative',
      blurb: 'Hand a difficult sale to a representative who negotiates on your behalf.'
    },
    negotiation: {
      label: 'Negotiating help',
      blurb: 'Guidance on pushing back on booth rates, corner charges and load-in terms.'
    },
    logistics: {
      label: 'Shared logistics',
      blurb: 'Find an artist heading your way with trailer space, or a vetted white-glove shipper.'
    },
    accountant_export: {
      label: 'Accountant export',
      blurb: 'Hand your bookkeeper a clean year of categorised rows.'
    },
    jury_review: {
      label: 'Mock jury review',
      blurb: 'Professional jurors score your images and booth shot before you apply.'
    }
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
  }

  /** The one sentence every Pro preview ends with. Said the same way everywhere. */
  var NOT_YET = 'Not built yet, and there are no plans to buy — this is a preview of what is coming.';

  /**
   * A disabled preview card. Returns HTML; renders nothing at all for an
   * unknown key rather than inventing a feature.
   */
  function card(key) {
    var f = PRO[key];
    if (!f) return '';
    return '<div class="pro-card" data-pro="' + esc(key) + '">' +
      '<div class="pro-head"><span class="pro-tag">Pro</span>' +
      '<strong>' + esc(f.label) + '</strong></div>' +
      '<p class="pro-blurb">' + esc(f.blurb) + '</p>' +
      '<button class="btn-mini" type="button" disabled ' +
        'title="' + esc(NOT_YET) + '">Not available</button>' +
    '</div>';
  }

  /** Several, in one row. */
  function cards(keys) {
    return '<div class="pro-grid">' +
      (keys || []).map(card).join('') +
    '</div>';
  }

  return { PRO: PRO, NOT_YET: NOT_YET, card: card, cards: cards };
})();
