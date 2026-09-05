#!/usr/bin/env python3
"""
Build tracker/fit-data.json — the members' fit layer.

Two inputs, deliberately kept as separate files:

  tracker/catalogue.json   the shipped reference list (202 ZAPP-sourced shows,
                           real ids and application URLs). Replaceable wholesale.
  build/fit-source.json    the 236-row editorial scoring pass carried over from
                           the original eight-factor model.

The join is on a normalised show name. 203 of the 236 fit rows land on a
catalogue row; the ~33 that do not are the marquee national shows that were
added to the model by hand and never existed in the ZAPP export. Those keep a
synthetic `fit-` id and are emitted alongside, so the members' universe is the
union rather than the intersection.

Every value that lands in the output carries a provenance entry saying where it
came from and how far it can be trusted. Nothing is invented to fill a gap: a
field with no source is null, and the front end renders that as "not known"
rather than as a number.

Usage:  python3 build/build_fit_data.py
"""

import json
import os
import re
import sys
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CATALOGUE = os.path.join(ROOT, "tracker", "catalogue.json")
FIT_SOURCE = os.path.join(ROOT, "build", "fit-source.json")
OVERRIDES = os.path.join(ROOT, "build", "research-overrides.json")
OUT = os.path.join(ROOT, "tracker", "fit-data.json")

SCHEMA_VERSION = 1

# The ten factors, in model order. Must match FACTOR_KEYS in tracker/fit.js.
FACTOR_KEYS = [
    "buyerWealth", "fineArtOrientation", "priceTolerance", "salesTrackRecord",
    "prestige", "qualifiedTraffic", "costEfficiency", "lowCompetition",
    "logistics", "juryOdds",
]

# The original model scored eight factors in this order. The first seven map
# straight across. The eighth was "Low 2D Competition" — see note below.
LEGACY_ORDER = [
    "buyerWealth", "fineArtOrientation", "priceTolerance", "salesTrackRecord",
    "prestige", "qualifiedTraffic", "costEfficiency", "lowCompetition",
]

# Disciplines whose competitive field the legacy factor 8 actually measured.
TWO_D = ["painting", "works_on_paper", "printmaking", "mixed_media", "photography"]

STATE_ABBR = {
    "Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR",
    "California": "CA", "Colorado": "CO", "Connecticut": "CT", "Delaware": "DE",
    "Florida": "FL", "Georgia": "GA", "Hawaii": "HI", "Idaho": "ID",
    "Illinois": "IL", "Indiana": "IN", "Iowa": "IA", "Kansas": "KS",
    "Kentucky": "KY", "Louisiana": "LA", "Maine": "ME", "Maryland": "MD",
    "Massachusetts": "MA", "Michigan": "MI", "Minnesota": "MN",
    "Mississippi": "MS", "Missouri": "MO", "Montana": "MT", "Nebraska": "NE",
    "Nevada": "NV", "New Hampshire": "NH", "New Jersey": "NJ",
    "New Mexico": "NM", "New York": "NY", "North Carolina": "NC",
    "North Dakota": "ND", "Ohio": "OH", "Oklahoma": "OK", "Oregon": "OR",
    "Pennsylvania": "PA", "Rhode Island": "RI", "South Carolina": "SC",
    "South Dakota": "SD", "Tennessee": "TN", "Texas": "TX", "Utah": "UT",
    "Vermont": "VT", "Virginia": "VA", "Washington": "WA",
    "West Virginia": "WV", "Wisconsin": "WI", "Wyoming": "WY",
    "District of Columbia": "DC",
}

NOISE = re.compile(r"\b(festival|fine|art|arts|show|fair|the|of|a|an|and|annual)\b")


def norm_name(s):
    """Normalise a show name enough to join on. Year, punctuation and the
    generic vocabulary of art-fair naming all drop out; what is left is the
    part that actually identifies the show."""
    s = s.lower()
    s = re.sub(r"\b(19|20)\d\d\b", "", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    s = NOISE.sub(" ", s)
    return re.sub(r"\s+", "", s)


def slug(s):
    s = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return re.sub(r"-(19|20)\d\d$", "", s)


def state_code(v):
    if not v or v == "nan":
        return ""
    v = str(v).strip()
    if len(v) == 2:
        return v.upper()
    return STATE_ABBR.get(v, "")


def clean(v):
    """Empty string, NaN and None all mean the same thing here: not known."""
    if v is None:
        return None
    if isinstance(v, float) and v != v:  # NaN
        return None
    if isinstance(v, str) and (not v.strip() or v.strip().lower() == "nan"):
        return None
    return v


def load(path, default=None):
    if not os.path.exists(path):
        if default is not None:
            return default
        sys.exit("missing input: %s" % path)
    with open(path) as fh:
        return json.load(fh)


def main():
    catalogue = load(CATALOGUE)["shows"]
    fit_rows = load(FIT_SOURCE)
    overrides = load(OVERRIDES, default={})

    by_norm = defaultdict(list)
    for row in catalogue:
        by_norm[norm_name(row["name"])].append(row)

    used_catalogue_ids = set()
    out = []
    stats = defaultdict(int)

    for fit in fit_rows:
        key = norm_name(fit["name"])
        hits = [c for c in by_norm.get(key, []) if c["id"] not in used_catalogue_ids]
        cat = hits[0] if hits else None
        if cat:
            used_catalogue_ids.add(cat["id"])
            stats["joined"] += 1
        else:
            stats["fit_only"] += 1

        rec = build_record(fit, cat)
        apply_override(rec, overrides.get(rec["id"]))
        out.append(rec)

    # Any catalogue row the fit pass never scored still belongs in the members'
    # list — it is a real show with real dates, it simply has no estimate yet.
    for row in catalogue:
        if row["id"] in used_catalogue_ids:
            continue
        stats["catalogue_only"] += 1
        rec = build_record(None, row)
        apply_override(rec, overrides.get(rec["id"]))
        out.append(rec)

    out.sort(key=lambda r: (r["name"] or "").lower())

    payload = {
        "schemaVersion": SCHEMA_VERSION,
        "builtAt": __import__("datetime").date.today().isoformat(),
        "count": len(out),
        "factorOrder": FACTOR_KEYS,
        "notice": (
            "Factor scores are informed editorial estimates, not audited data. "
            "Facts carry a source and a checked-on date, or they are null. "
            "Member-reported intel is stored separately and never merged into "
            "this file."
        ),
        "shows": out,
    }

    with open(OUT, "w") as fh:
        json.dump(payload, fh, indent=1, sort_keys=False)
        fh.write("\n")

    verified = sum(1 for r in out if r["confidence"] == "High")
    scored = sum(1 for r in out if any(v is not None for v in r["factors"].values()))
    est_dates = sum(1 for r in out if r["datesEstimated"])
    print("wrote %s" % os.path.relpath(OUT, ROOT))
    print("  %d shows  (%d joined, %d fit-only, %d catalogue-only)"
          % (len(out), stats["joined"], stats["fit_only"], stats["catalogue_only"]))
    print("  %d carry factor scores, %d graded High confidence" % (scored, verified))
    print("  %d still sitting on estimated rather than published dates" % est_dates)
    missing_logistics = sum(1 for r in out if r["factors"]["logistics"] is None)
    missing_odds = sum(1 for r in out if r["factors"]["juryOdds"] is None)
    print("  unscored: logistics %d, juryOdds %d  (renormalised, never defaulted)"
          % (missing_logistics, missing_odds))


def build_record(fit, cat):
    """One merged show. `fit` or `cat` may be None; at least one is present."""
    name = (fit or cat)["name"]
    scores = (fit or {}).get("scores") or []

    factors = {k: None for k in FACTOR_KEYS}
    by_discipline = {}
    provenance = {}

    if len(scores) >= 8:
        for i, key in enumerate(LEGACY_ORDER):
            factors[key] = scores[i]
        for key in LEGACY_ORDER:
            provenance[key] = {
                "status": "estimated",
                "basis": "editorial model, carried over from the eight-factor pass",
            }
        # The legacy factor measured the crowding of the 2D/mixed-media field
        # specifically. It is the best available estimate of category crowding
        # generally, so it seeds the shared value — but for three-dimensional
        # media that is a generalisation, and the record has to say so rather
        # than let a painter's number pass itself off as a sculptor's.
        for d in TWO_D:
            by_discipline.setdefault(d, {})["lowCompetition"] = scores[7]
        provenance["lowCompetition"] = {
            "status": "estimated",
            "basis": "authored as a 2D/mixed-media field estimate; approximate "
                     "for three-dimensional media until member data replaces it",
        }

    # logistics and juryOdds are intentionally absent. See scoreShow() in
    # tracker/fit.js: a missing factor renormalises out, it never defaults to 5.

    cat = cat or {}
    fit = fit or {}

    facts = {
        "startDate": clean(cat.get("startDate")) or clean(fit.get("start")),
        "endDate": clean(cat.get("endDate")) or clean(fit.get("end")),
        "applyBy": clean(cat.get("applyBy")) or clean(fit.get("deadline")),
        "deadlineNote": clean(cat.get("deadlineNote")),
        "notifyDate": clean(cat.get("notifyDate")) or clean(fit.get("notify")),
        "juryFee": clean(cat.get("fee")) if clean(cat.get("fee")) is not None else clean(fit.get("fee")),
        "juryFeeLabel": clean(cat.get("feeLabel")) or clean(fit.get("feelabel")),
        "applicationUrl": clean(cat.get("url")),
        # Everything below is what the research pass fills in. Null is a real
        # answer here and the UI renders it as one.
        "officialUrl": None,
        "boothFee": None,
        "boothFeeNote": None,
        "commissionPct": None,
        "boothCount": None,
        "attendance": None,
        "acceptanceRatePct": None,
        "mediaCategories": None,
        "editionedWorkAllowed": None,
        "powerAvailable": None,
        "vehicleAccessToBooth": None,
        "venue": None,
        "indoorOutdoor": None,
        "lat": None,
        "lng": None,
    }

    if facts["applicationUrl"]:
        provenance["applicationUrl"] = {"status": "verified", "source": facts["applicationUrl"]}
    for k in ("startDate", "endDate", "applyBy", "juryFee"):
        if facts[k] is not None:
            provenance[k] = {
                "status": "verified" if cat.get("id") else "estimated",
                "basis": "ZAPPlication export" if cat.get("id")
                         else "inferred from the show's usual calendar slot",
            }

    cid = cat.get("id")
    return {
        "id": cid or ("fit-" + slug(name)),
        "catalogueId": cid or None,
        "name": name,
        "city": clean(cat.get("city")) or clean(fit.get("city")) or "",
        "state": state_code(cat.get("state") or fit.get("state")),
        "factors": factors,
        "byDiscipline": by_discipline,
        "facts": facts,
        "provenance": provenance,
        "confidence": fit.get("confidence") or "Low",
        "datesEstimated": bool(fit.get("est")),
        "editorialNote": clean(fit.get("note")) or "",
        "researchStatus": "none",
        "researchedAt": None,
    }


def apply_override(rec, ov):
    """Research output, merged in. Overrides only ever ADD certainty: they can
    fill a null, correct a value, or raise a confidence grade, and each field
    they touch has to bring a source with it."""
    if not ov:
        return
    for k, v in (ov.get("facts") or {}).items():
        rec["facts"][k] = v
    for k, v in (ov.get("factors") or {}).items():
        rec["factors"][k] = v
    for d, vals in (ov.get("byDiscipline") or {}).items():
        rec["byDiscipline"].setdefault(d, {}).update(vals)
    rec["provenance"].update(ov.get("provenance") or {})
    for k in ("confidence", "editorialNote", "researchStatus", "researchedAt", "datesEstimated"):
        if k in ov:
            rec[k] = ov[k]


if __name__ == "__main__":
    main()
