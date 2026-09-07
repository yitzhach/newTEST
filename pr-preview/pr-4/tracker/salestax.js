/* ==========================================================================
   Show Ledger — sales tax and vendor permits by jurisdiction

   THIS IS THE ONE FEATURE ON THE SITE THAT CAN COST SOMEBODY MONEY.

   Every other number here fails by being unhelpful. A wrong sales tax rate
   fails by an artist under-collecting at the booth and owing the difference
   out of their own pocket months later, with interest. So this file is built
   to a different standard from the rest of the site, and the differences are
   deliberate:

   1. IT NEVER PUBLISHES A COMBINED RATE. The number an artist actually
      collects is state + county + city + special district, and the local part
      cannot be sourced honestly from here — there is no keyless,
      CORS-permitting national rate API, and no offline dataset of local rates
      that would still be right next quarter. So this file carries the STATE
      rate only, says so in those words, and sends the artist to the state's
      own address lookup for the real number. A rate that is 6% when the till
      needs 7.5% is worse than no rate at all, and the UI is built so that the
      state figure can never be mistaken for the answer.

   2. EVERY ROW CARRIES ITS CAPTURE DATE AND ITS ISSUING AUTHORITY. Rates
      change by legislature and by ballot. A row older than STALE_AFTER_DAYS
      renders as stale rather than as fact.

   3. A RATE THAT COULD NOT BE SOURCED IS NULL. Three states here have a null
      rate — Ohio, Utah and Wyoming — not because their rates are secret but
      because the research pass could not read them off the authority's own
      page with confidence. Utah is the instructive one: the search summary
      blended the reduced grocery rate into the general rate, which is exactly
      the failure this project's honesty rules exist to catch. Null renders as
      "not known" and the lookup link still works, which is the honest state.

   4. IT IS NOT TAX ADVICE, and the UI says so where the artist reads it, not
      in a footer.

   PROVENANCE. Captured 2026-09-07 through web search restricted to each
   state's own revenue department domain. That earns `search` — nobody opened
   the page — so the chips render as "unconfirmed" and link to the authority.
   A session with open egress should read each page and upgrade the grade.

   Classic script (see core.js). Publishes window.ASTSalesTax.
   ========================================================================== */
window.ASTSalesTax = (function () {
  'use strict';

  var CAPTURED = '2026-09-07';

  /* Half a year. Long enough that the table is not perpetually shouting,
     short enough that nobody plans a season on a rate nobody has re-read. */
  var STALE_AFTER_DAYS = 180;

  var NOT_ADVICE =
    'This is not tax advice. It is a starting point for your own check with ' +
    'the state.';

  /* Said at every call site that shows a rate. The single most important
     sentence in this file. */
  var STATE_ONLY =
    'State rate only. County, city and special-district taxes are charged on ' +
    'top of this and are not included here — look up the venue address before ' +
    'you set your till.';

  /* ---- The table ---------------------------------------------------------
     One row per state that has a show in the catalogue. Fields:

       rate        the STATE rate, or null when it could not be sourced
       localAdded  what local jurisdictions may add, as a readable string,
                   or null when unknown. Never arithmetic — a range is a
                   warning, not a number to add up.
       authority   who issues the rate. Named, because "the state" is not a
                   citation.
       rateUrl     the authority's own rate page
       lookupUrl   address-based lookup, where the state runs one. This is
                   the link that actually answers the question.
       permitUrl   how a visiting artist registers to collect
       note        the trap. Written for someone loading in on a Friday.     */
  var STATES = {
    AL: {
      rate: 4.0, localAdded: '0.10% to 5% by county and city',
      authority: 'Alabama Department of Revenue',
      rateUrl: 'https://www.revenue.alabama.gov/sales-use/state-sales-use-tax-rates/',
      lookupUrl: 'https://www.revenue.alabama.gov/sales-use/view-listing/',
      permitUrl: 'https://www.revenue.alabama.gov/tax-types/sales-tax/',
      note: 'Some Alabama localities collect their own tax rather than going through the state, so one filing may not cover you.'
    },
    AZ: {
      rate: 5.6, localAdded: 'city and county rates on top, varying widely',
      authority: 'Arizona Department of Revenue',
      rateUrl: 'https://azdor.gov/business/transaction-privilege-tax',
      lookupUrl: 'https://azdor.gov/business/transaction-privilege-tax/tpt-license',
      permitUrl: 'https://azdor.gov/business/transaction-privilege-tax/special-events-craft-shows-trade-shows',
      note: 'Arizona levies a transaction privilege tax on the seller, not a sales tax on the buyer. It is your liability whether or not you add it to the price. Arizona runs a dedicated page for craft and art shows.'
    },
    CA: {
      rate: 7.25, localAdded: 'district taxes of 0.10% to 2.00%',
      authority: 'California Department of Tax and Fee Administration',
      rateUrl: 'https://cdtfa.ca.gov/taxes-and-fees/sales-use-tax-rates.htm',
      lookupUrl: 'https://cdtfa.ca.gov/taxes-and-fees/sales-use-tax-rates.htm',
      permitUrl: 'https://cdtfa.ca.gov/industry/temporary-sellers/',
      note: 'The 7.25% already includes 1.25% of local tax. Selling at one location for under 90 days makes you a temporary seller: the permit is free, and you register each location.'
    },
    CO: {
      rate: 2.9, localAdded: 'county, city and district taxes, often several at once',
      authority: 'Colorado Department of Revenue',
      rateUrl: 'https://tax.colorado.gov/DR1002',
      lookupUrl: 'https://tax.colorado.gov/sales-use-tax',
      permitUrl: 'https://tax.colorado.gov/special-event-license',
      note: 'The worst trap on this list. Colorado home-rule cities collect their own sales tax and are NOT administered by the state, so a state special-event licence may not cover the city you are standing in — that can be a second licence and a second return.'
    },
    CT: {
      rate: 6.35, localAdded: 'none — Connecticut has no local sales tax',
      authority: 'Connecticut Department of Revenue Services',
      rateUrl: 'https://portal.ct.gov/drs/sales-tax/tax-information',
      lookupUrl: null,
      permitUrl: 'https://portal.ct.gov/DRS/Sales-Tax',
      note: 'One rate statewide, which makes Connecticut simple. The permit carries a $100 registration fee.'
    },
    FL: {
      rate: 6.0, localAdded: 'county discretionary sales surtax of 0.5% to 2.5%',
      authority: 'Florida Department of Revenue',
      rateUrl: 'https://floridarevenue.com/taxes/taxesfees/Pages/sales_tax.aspx',
      lookupUrl: 'https://pointmatch.floridarevenue.com/General/DiscretionarySalesSurtaxRates.aspx',
      permitUrl: 'https://floridarevenue.com/taxes/taxesfees/Pages/sales_tax.aspx',
      note: 'The surtax follows the county the goods are delivered in, which at a fair is the county you are standing in. Not every county levies one.'
    },
    GA: {
      rate: 4.0, localAdded: 'local taxes commonly bringing the total to 7–9%',
      authority: 'Georgia Department of Revenue',
      rateUrl: 'https://dor.georgia.gov/taxes/business-taxes/sales-use-tax/tax-rates',
      lookupUrl: 'https://dor.georgia.gov/sales-tax-rates-general',
      permitUrl: 'https://dor.georgia.gov/taxes/sales-use-tax',
      note: 'Georgia stacks several 1% local taxes, and the total varies county by county. The state publishes a fresh rate chart every quarter.'
    },
    IA: {
      rate: 6.0, localAdded: 'a 1% local option tax in many cities and counties',
      authority: 'Iowa Department of Revenue',
      rateUrl: 'https://revenue.iowa.gov/taxes/tax-guidance/general/iowa-taxfee-descriptions-and-rates',
      lookupUrl: 'https://revenue.iowa.gov/taxes/tax-guidance/sales-use-excise-tax/permits-filing-requirements-local-option-sales-tax-lost',
      permitUrl: 'https://revenue.iowa.gov/permits-licensing/frequently-asked-questions/permits',
      note: 'Iowa stopped issuing temporary permits in 2016 — you need the ordinary state sales tax permit. The local option is remitted with the state tax, not to the town.'
    },
    ID: {
      rate: 6.0, localAdded: 'resort city local option taxes in some towns',
      authority: 'Idaho State Tax Commission',
      rateUrl: 'https://tax.idaho.gov/taxes/sales-use/sales-tax/local-sales-tax/',
      lookupUrl: 'https://tax.idaho.gov/taxes/sales-use/sales-tax/local-sales-tax/city-sales-tax/',
      permitUrl: 'https://tax.idaho.gov/taxes/sales-use/guides-for-certain-groups/promoter-sponsored-events/',
      note: 'Resort cities — which is most of the ones worth showing in — can add a local option tax. At a promoter-sponsored event you register with the promoter’s event ID, and can get a temporary permit that way if you have no other.'
    },
    IL: {
      rate: 6.25, localAdded: 'home rule and district taxes, often several',
      authority: 'Illinois Department of Revenue',
      rateUrl: 'https://tax.illinois.gov/research/taxinformation/sales/rot.html',
      lookupUrl: 'https://tax.illinois.gov/questionsandanswers/answer.139.html',
      permitUrl: 'https://tax.illinois.gov/individuals/fairs.html',
      note: 'Illinois runs a Special Events Coordinator: if the show is registered with them you get a reporting form for the event, and if it is not you register and file ST-1 yourself. The state has a page written specifically for craft shows and festivals.'
    },
    KS: {
      rate: 6.5, localAdded: '0.10% to 3% by city, county and district',
      authority: 'Kansas Department of Revenue',
      rateUrl: 'https://www.ksrevenue.gov/taxrates.html',
      lookupUrl: 'https://www.ksrevenue.gov/atrl.html',
      permitUrl: 'https://www.ksrevenue.gov/specialsalesevents.html',
      note: 'Kansas is explicit that selling once a year still means collecting and remitting. It runs a page for craft and trade shows.'
    },
    ME: {
      rate: 5.5, localAdded: 'none — Maine has no local sales tax',
      authority: 'Maine Revenue Services',
      rateUrl: 'https://www.maine.gov/revenue/taxes/sales-use-service-provider-tax/rates-due-dates',
      lookupUrl: null,
      permitUrl: 'https://www.maine.gov/revenue/taxes/sales-use-service-provider-tax',
      note: 'One rate statewide on ordinary goods.'
    },
    MI: {
      rate: 6.0, localAdded: 'none — Michigan does not allow local sales tax',
      authority: 'Michigan Department of Treasury',
      rateUrl: 'https://www.michigan.gov/taxes/business-taxes/sales-use-tax',
      lookupUrl: null,
      permitUrl: 'https://www.michigan.gov/taxes/business-taxes/sales-use-tax/resources/who-needs-a-sales-tax-license',
      note: 'Simple: 6% everywhere. One or two Michigan events a year can be filed on the concessionaire form 5089 instead of holding a licence; three or more means a sales tax licence.'
    },
    MN: {
      rate: 6.875, localAdded: 'local and special local taxes on top',
      authority: 'Minnesota Department of Revenue',
      rateUrl: 'https://www.revenue.state.mn.us/guide/taxes-and-rates',
      lookupUrl: 'https://www.revenue.state.mn.us/sales-tax-rate-calculator',
      permitUrl: 'https://www.revenue.state.mn.us/sales-and-use-tax',
      note: 'You must be registered BEFORE the event begins — Minnesota states this for craft and art shows specifically.'
    },
    MO: {
      rate: 4.225, localAdded: 'city, county and special district taxes',
      authority: 'Missouri Department of Revenue',
      rateUrl: 'https://dor.mo.gov/taxation/business/tax-types/sales-use/rate-tables/',
      lookupUrl: 'https://dor.mo.gov/taxation/business/tax-types/sales-use/rate-map.html',
      permitUrl: 'https://dor.mo.gov/faq/taxation/business/special-event-sales.html',
      note: 'Fire and other special districts levy on top of city and county here, so the map is worth checking rather than assuming the county rate. Missouri asks unregistered vendors to make contact three to four weeks before the event.'
    },
    NJ: {
      rate: 6.625, localAdded: 'none except Atlantic City and Cape May County',
      authority: 'New Jersey Division of Taxation',
      rateUrl: 'https://www.nj.gov/treasury/taxation/salestax.shtml',
      lookupUrl: null,
      permitUrl: 'https://www.nj.gov/treasury/taxation/vendorpromoter.shtml',
      note: 'New Jersey has no temporary vendor provision — even a one-time seller registers, at least 15 business days ahead, and keeps filing until the registration is closed. The state publishes a guide written for arts and crafts businesses.'
    },
    NY: {
      rate: 4.0, localAdded: 'local rates of 3% to 4.75%, plus 0.375% in the MCTD',
      authority: 'New York State Department of Taxation and Finance',
      rateUrl: 'https://www.tax.ny.gov/bus/st/rates.htm',
      lookupUrl: 'https://www.tax.ny.gov/bus/st/rates.htm',
      permitUrl: 'https://www.tax.ny.gov/bus/doingbus/sell.htm',
      note: 'The state rate is only 4% and the local part is bigger than it — never collect 4% here. Apply for the Certificate of Authority at least 20 days before you sell.'
    },
    OH: {
      rate: null, localAdded: 'county permissive tax on top of the state rate',
      authority: 'Ohio Department of Taxation',
      rateUrl: 'https://tax.ohio.gov/business/sales-and-use-tax/rate-tables',
      lookupUrl: 'https://thefinder.tax.ohio.gov/',
      permitUrl: 'https://tax.ohio.gov/help-center/resources/tax-education/entrepreneurs',
      note: 'The state rate is not recorded here because the research pass could not read it off the authority’s own page. Ohio’s own tool, The Finder, gives the full rate for an address. The vendor licence fee is $25. You charge the rate of the county the sale is made in.'
    },
    OK: {
      rate: 4.5, localAdded: 'county and municipal taxes on top',
      authority: 'Oklahoma Tax Commission',
      rateUrl: 'https://oklahoma.gov/tax/businesses/sales-use-tax.html',
      lookupUrl: 'https://oklahoma.gov/tax/businesses/sales-use-tax.html',
      permitUrl: 'https://oklahoma.gov/business/operate/licenses-and-permits.html',
      note: 'Oklahoma names art shows and craft shows in its special-event rules. The promoter applies for the special-event permit at least 20 days ahead and may collect and remit on the vendors’ behalf — ask the show which arrangement it is running.'
    },
    OR: {
      rate: 0, localAdded: 'none — Oregon has no general sales tax',
      authority: 'Oregon Department of Revenue',
      rateUrl: 'https://www.oregon.gov/dor/programs/businesses/pages/sales-tax.aspx',
      lookupUrl: null,
      permitUrl: 'https://www.oregon.gov/dor/programs/businesses/pages/sales-tax.aspx',
      note: 'No general sales or use tax to collect. That is a real margin difference against a neighbouring state, and worth weighing next to the booth fee.'
    },
    PA: {
      rate: 6.0, localAdded: '+1% in Allegheny County, +2% in Philadelphia',
      authority: 'Pennsylvania Department of Revenue',
      rateUrl: 'https://www.pa.gov/agencies/revenue/resources/tax-types-and-information/sales-use-and-hotel-occupancy-tax',
      lookupUrl: 'https://www.pa.gov/agencies/revenue/resources/tax-types-and-information/sales-use-and-hotel-occupancy-tax/local-sales-tax',
      permitUrl: 'https://www.pa.gov/agencies/revenue/resources/tax-types-and-information/sales-use-and-hotel-occupancy-tax',
      note: 'Only two local rates in the state, and both are places with big shows. An out-of-state artist with no Pennsylvania premises needs a Transient Vendor Certificate.'
    },
    SC: {
      rate: 6.0, localAdded: 'county local option taxes where voters approved them',
      authority: 'South Carolina Department of Revenue',
      rateUrl: 'https://dor.sc.gov/sales-use-tax-index/local-sales-taxes',
      lookupUrl: 'https://dor.sc.gov/sales-use-tax-index/local-sales-taxes',
      permitUrl: 'https://dor.sc.gov/sales-use-tax-index/arts-crafts',
      note: 'South Carolina issues an Artist & Craftsman License ($20) for selling your own work at shows and festivals, as against the $50 Retail License you need to sell anywhere else, online included. The state has a page for arts and crafts and another for events and festivals.'
    },
    TN: {
      rate: 7.0, localAdded: 'local option up to 2.75%, and everywhere has one',
      authority: 'Tennessee Department of Revenue',
      rateUrl: 'https://www.tn.gov/revenue/taxes/sales-and-use-tax/local-sales-tax.html',
      lookupUrl: 'https://www.tn.gov/revenue/taxes/sales-and-use-tax/local-sales-tax/local-sales-tax-rates-map.html',
      permitUrl: 'https://www.tn.gov/revenue/taxes/sales-and-use-tax.html',
      note: 'Every jurisdiction in Tennessee levies a local rate, so the state figure is never the whole answer here.'
    },
    TX: {
      rate: 6.25, localAdded: 'up to 2%, capped at 8.25% combined',
      authority: 'Texas Comptroller of Public Accounts',
      rateUrl: 'https://comptroller.texas.gov/taxes/sales/',
      lookupUrl: 'https://comptroller.texas.gov/taxes/sales/',
      permitUrl: 'https://comptroller.texas.gov/taxes/publications/94-105.php',
      note: 'Texas caps the combined rate at 8.25%, so the arithmetic has a ceiling even where several jurisdictions overlap.'
    },
    UT: {
      rate: null, localAdded: 'local and county option taxes on top',
      authority: 'Utah State Tax Commission',
      rateUrl: 'https://tax.utah.gov/sales/ratechanges',
      lookupUrl: 'https://tax.utah.gov/sales/ratechanges',
      permitUrl: 'https://tax.utah.gov/business/sales-tax/other-sales-tax/specialevents/',
      note: 'The state rate is not recorded here: the research pass came back with the reduced grocery rate blended into the general rate, and a wrong rate is worse than none. Use the commission’s rate tables. Utah requires a temporary sales tax licence (TC-790C) and a special-event taxpayer ID for every vendor at a special event.'
    },
    VA: {
      rate: 5.3, localAdded: '+0.7% in Northern Virginia, Hampton Roads and Central Virginia; +1% in the Historic Triangle',
      authority: 'Virginia Department of Taxation',
      rateUrl: 'https://www.tax.virginia.gov/retail-sales-and-use-tax',
      lookupUrl: 'https://www.tax.virginia.gov/sales-tax-rate-and-locality-code-lookup',
      permitUrl: 'https://www.tax.virginia.gov/retail-sales-and-use-tax',
      note: 'The 5.3% is 4.3% state plus 1% local and already includes the local part. Three or more Virginia shows a year means registering properly; below that there is a temporary certificate, form ST-50.'
    },
    WA: {
      rate: 6.5, localAdded: 'local rates on top, varying by address',
      authority: 'Washington Department of Revenue',
      rateUrl: 'https://dor.wa.gov/taxes-rates/sales-use-tax-rates',
      lookupUrl: 'https://dor.wa.gov/taxes-rates/sales-use-tax-rates/tax-rate-lookup-tool',
      permitUrl: 'https://dor.wa.gov/taxes-rates/retail-sales-tax',
      note: 'Washington is destination-based and the local rates are among the highest in the country, so the address lookup matters more here than almost anywhere.'
    },
    WI: {
      rate: 5.0, localAdded: 'county and resort taxes, commonly to 5.5–5.6%',
      authority: 'Wisconsin Department of Revenue',
      rateUrl: 'https://www.revenue.wi.gov/Pages/SalesAndUse/Home.aspx',
      lookupUrl: 'https://www.revenue.wi.gov/DOR%20Publications/pb201.pdf',
      permitUrl: 'https://www.revenue.wi.gov/DOR%20Publications/pb228.pdf',
      note: 'Wisconsin publishes a booklet specifically about temporary events, Publication 228, which is the clearest state guidance on this list.'
    },
    WV: {
      rate: 6.0, localAdded: 'municipal sales tax of up to 1% in some towns',
      authority: 'West Virginia Tax Division',
      rateUrl: 'https://tax.wv.gov/business/salesandusetax/pages/salesandusetax.aspx',
      lookupUrl: 'https://tax.wv.gov/business/salesandusetax/municipalsalesandusetax/pages/municipalsalesandusetax.aspx',
      permitUrl: 'https://tax.wv.gov/Documents/TSD/tsd317.pdf',
      note: 'Only some municipalities levy, and the state publishes the list. West Virginia has guidance written for transient vendors specifically.'
    },
    WY: {
      rate: null, localAdded: 'county optional taxes on top',
      authority: 'Wyoming Department of Revenue',
      rateUrl: 'https://revenue.wyo.gov/',
      lookupUrl: null,
      permitUrl: 'https://revenue.wyo.gov/',
      note: 'The state rate is not recorded here: the research pass could not retrieve it from the department’s own site, and guessing is not an option on this particular number. Check with the Excise Tax Division before the show.'
    }
  };

  /* ---- Lookup ------------------------------------------------------------- */

  function daysSince(iso) {
    var then = Date.parse(iso);
    if (!isFinite(then)) return Infinity;
    return Math.floor((Date.now() - then) / 86400000);
  }

  /**
   * @param code   two-letter state code
   * @returns null when the state is not in the table, else a record with
   *          `stale` computed and the standing warnings attached.
   */
  function forState(code) {
    var row = STATES[String(code || '').toUpperCase()];
    if (!row) return null;
    var age = daysSince(CAPTURED);
    return {
      state: String(code).toUpperCase(),
      /* Named `stateRatePct` rather than `rate` on purpose. Anything reading
         this object is forced to say "state" in the variable name, which is
         one more place the state-only caveat cannot quietly fall off. */
      stateRatePct: row.rate,
      localAdded: row.localAdded,
      authority: row.authority,
      rateUrl: row.rateUrl,
      lookupUrl: row.lookupUrl,
      permitUrl: row.permitUrl,
      note: row.note,
      capturedAt: CAPTURED,
      ageDays: age,
      stale: age > STALE_AFTER_DAYS,
      stateOnly: STATE_ONLY,
      notAdvice: NOT_ADVICE
    };
  }

  function has(code) { return !!STATES[String(code || '').toUpperCase()]; }

  /** The provenance entry for a state's rate. `search` — a page was found,
      not opened — and the source is the authority, so one click checks it. */
  function provenanceFor(code) {
    var row = forState(code);
    if (!row) return null;
    return {
      status: 'search',
      source: row.rateUrl,
      basis: row.authority + ' — state rate only, local taxes not included. ' +
             (row.stale ? 'Captured over ' + STALE_AFTER_DAYS + ' days ago; re-check before relying on it.'
                        : 'Confirm against the authority before you rely on it.'),
      checked: row.capturedAt
    };
  }

  return {
    forState: forState,
    has: has,
    provenanceFor: provenanceFor,
    STATES: STATES,
    CAPTURED: CAPTURED,
    STALE_AFTER_DAYS: STALE_AFTER_DAYS,
    STATE_ONLY: STATE_ONLY,
    NOT_ADVICE: NOT_ADVICE
  };
})();
