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
# Pristine ZAPP export. Read-only input: the build WRITES tracker/catalogue.json,
# so it must never also read it, or a second run would treat its own output as
# source and quietly upgrade the provenance of rows it invented itself.
CATALOGUE_SRC = os.path.join(ROOT, "build", "catalogue-source.json")
CATALOGUE_OUT = os.path.join(ROOT, "tracker", "catalogue.json")
FIT_SOURCE = os.path.join(ROOT, "build", "fit-source.json")
OVERRIDES = os.path.join(ROOT, "build", "research-overrides.json")
# Written by build/geocode_shows.py from an offline gazetteer. Committed, so
# the build needs no geocoding dependency and every coordinate is auditable.
GEOCODE = os.path.join(ROOT, "build", "geocode.json")
# Written by build/import_show_research.py from the ZAPPlication research
# spreadsheet. 100 shows deep: booth fees, jury statistics, what applying
# actually involves.
SHOW_RESEARCH = os.path.join(ROOT, "build", "show-research.json")
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

# ---------------------------------------------------------------------------
# Date hygiene
#
# The ZAPP export ships two defects that the build used to pass straight
# through, and they fail in different ways, so they are handled differently.
#
# REPAIRABLE — a notify date EARLIER than the deadline it belongs to. That is
# not a close call; it is impossible, and it happens because a listing carries
# its previous edition's notify date forward. Nine of the twelve are almost
# exactly a year early, which is the giveaway. There is no honest way to
# recover the real date from the row — the previous edition's deadline is not
# in the export either — so the value is dropped and renders as "not known".
# Dropping is the repair. Guessing a year forward would put a fabricated date
# in front of an artist planning around it.
#
# FATAL — anything the build cannot repair honestly: a date it cannot parse, a
# show that ends before it starts, a deadline after the show is over. These
# stop the build, because shipping them means shipping a lie about a real
# date and there is nothing sensible to substitute.
#
# NOT FATAL, deliberately — a deadline in the past. That is not a defect in
# the data; it is what a real deadline does when the calendar moves. Making it
# fatal would mean the repo stops building in October unless somebody edits
# the data, which trains people to disable the check. It is reported here and
# surfaced at runtime instead, where the browser knows what day it is:
# fit.js gates() raises it in the drawer and the list already renders "closed".
# ---------------------------------------------------------------------------

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def check_dates(label, row, today):
    """Inspect and repair one row's dates in place.

    `row` is any mapping carrying startDate / endDate / applyBy / notifyDate —
    a raw catalogue record or a built `facts` block, since both use these
    names. Returns (repairs, fatals, expired) as lists of readable strings.
    """
    repairs, fatals, expired = [], [], []

    def get(k):
        v = clean(row.get(k))
        return str(v) if v is not None else None

    for k in ("startDate", "endDate", "applyBy", "notifyDate"):
        v = get(k)
        if v is not None and not DATE_RE.match(v):
            fatals.append("%s: %s is not a date: %r" % (label, k, v))

    start, end = get("startDate"), get("endDate")
    apply_by, notify = get("applyBy"), get("notifyDate")

    if start and end and DATE_RE.match(start) and DATE_RE.match(end) and end < start:
        fatals.append("%s: ends %s but starts %s" % (label, end, start))
    if apply_by and end and DATE_RE.match(apply_by) and DATE_RE.match(end) and apply_by > end:
        fatals.append("%s: deadline %s falls after the show ends %s" % (label, apply_by, end))

    if apply_by and notify and DATE_RE.match(apply_by) and DATE_RE.match(notify) and notify < apply_by:
        repairs.append("%s: notify %s precedes deadline %s — dropped" % (label, notify, apply_by))
        # Written back in the shape it arrived: a raw catalogue row spells
        # not-known as "", a built facts block spells it None. Both render as
        # "not known"; mixing them would make the catalogue schema lumpy.
        row["notifyDate"] = "" if isinstance(row.get("notifyDate"), str) else None

    if apply_by and DATE_RE.match(apply_by) and apply_by < today:
        expired.append("%s: deadline closed %s" % (label, apply_by))

    return repairs, fatals, expired


def run_hygiene(labelled_rows, today):
    """Apply check_dates across a list of (label, row) pairs."""
    repairs, fatals, expired = [], [], []
    for label, row in labelled_rows:
        r, f, e = check_dates(label, row, today)
        repairs += r
        fatals += f
        expired += e
    return repairs, fatals, expired


def report_hygiene(repairs, fatals, expired):
    """Say what was found, loudly, and stop the build on anything unrepairable.

    Printed in full rather than counted. A repair that only shows up as a
    number is a repair nobody reads, and these are edits to real dates that a
    real artist plans around.

    Deduplicated, because a show whose stale notify date sits in BOTH the ZAPP
    export and the fit-source pass gets repaired in both places and is still
    one show with one bad date.
    """
    def unique(lines):
        seen, out = set(), []
        for line in lines:
            if line not in seen:
                seen.add(line)
                out.append(line)
        return out

    repairs, fatals, expired = unique(repairs), unique(fatals), unique(expired)

    print("date hygiene:")
    if repairs:
        print("  %d impossible notify date%s dropped to 'not known':"
              % (len(repairs), "" if len(repairs) == 1 else "s"))
        for line in repairs:
            print("    - %s" % line)
    else:
        print("  no impossible notify dates")

    if expired:
        # Not an error. See the note at the top of this section: the browser
        # is what knows today's date, and fit.js gates() raises this in the
        # drawer so a closed show stops reading as a live opportunity.
        print("  %d deadline%s already closed (surfaced in the UI, not an error):"
              % (len(expired), "" if len(expired) == 1 else "s"))
        for line in expired:
            print("    - %s" % line)

    if fatals:
        print("  %d unrepairable date error%s:"
              % (len(fatals), "" if len(fatals) == 1 else "s"))
        for line in fatals:
            print("    - %s" % line)
        sys.exit("build stopped: fix the dates above rather than shipping them")


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
    catalogue = load(CATALOGUE_SRC)["shows"]
    fit_rows = load(FIT_SOURCE)
    overrides = load(OVERRIDES, default={})
    geocode = load(GEOCODE, default={"shows": {}, "gazetteer": {}})
    research = load(SHOW_RESEARCH, default={"shows": {}})

    today = __import__("datetime").date.today().isoformat()

    # Pass one, on the raw export rows. This has to happen before build_record
    # reads them, because write_catalogue emits these same objects — repairing
    # only the fit layer would leave catalogue.json still shipping the defect
    # to the browser, the map and the ledger, which all read it.
    cat_repairs, cat_fatals, _ = run_hygiene(
        [(row.get("id") or row.get("name") or "?", row) for row in catalogue], today)

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
        apply_research(rec, (research.get("shows") or {}).get(rec["id"]))
        apply_override(rec, overrides.get(rec["id"]))
        apply_geocode(rec, geocode)
        out.append(rec)

    # Any catalogue row the fit pass never scored still belongs in the members'
    # list — it is a real show with real dates, it simply has no estimate yet.
    for row in catalogue:
        if row["id"] in used_catalogue_ids:
            continue
        stats["catalogue_only"] += 1
        rec = build_record(None, row)
        apply_research(rec, (research.get("shows") or {}).get(rec["id"]))
        apply_override(rec, overrides.get(rec["id"]))
        apply_geocode(rec, geocode)
        out.append(rec)

    out.sort(key=lambda r: (r["name"] or "").lower())

    # Pass two, on the built records. Catches the fit-only shows, whose dates
    # come from fit-source rather than the export, and catches a research
    # override that reintroduces a defect the first pass had already cleared.
    rec_repairs, rec_fatals, expired = run_hygiene(
        [(r["id"], r["facts"]) for r in out], today)
    for rec in out:
        if rec["facts"].get("notifyDate") is None:
            rec["provenance"].pop("notifyDate", None)

    report_hygiene(cat_repairs + rec_repairs, cat_fatals + rec_fatals, expired)

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

    write_catalogue(out, catalogue)

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


STATE_NAME = {v: k for k, v in STATE_ABBR.items()}


def write_catalogue(records, original):
    """Fold the fit-only shows back into catalogue.json.

    The 34 marquee national shows — Cherry Creek, Park City, Saint Louis, Ann
    Arbor and the rest — were added to the scoring model by hand and never
    existed in the ZAPP export. Without this they would carry a fit score that
    nothing ever displays, because the browser, the map and the ledger all read
    the catalogue rather than the fit layer.

    Rather than teach three surfaces about a second list, the union is written
    back to the one file they already read. Rows keep their `fit-` ids, so a
    later ZAPP export that does contain them joins on name and replaces them
    rather than duplicating.
    """
    have = {row["id"] for row in original}
    by_id = {rec["id"]: rec for rec in records}
    rows = list(original)
    added = 0

    # Coordinates travel with the catalogue, not just the fit layer. The map,
    # the route planner and the ledger all read catalogue.json, and a show
    # added to the ledger used to arrive unpinned — geocoding was the import
    # modal's job because nothing else knew where the show was. Now something
    # does.
    for row in rows:
        rec = by_id.get(row["id"])
        if rec:
            row["lat"] = rec["facts"].get("lat")
            row["lng"] = rec["facts"].get("lng")

    for rec in records:
        if rec["id"] in have:
            continue
        f = rec["facts"]
        rows.append({
            "id": rec["id"],
            "name": rec["name"],
            "city": rec["city"],
            "state": rec["state"],
            "stateName": STATE_NAME.get(rec["state"], rec["state"]),
            "startDate": f["startDate"] or "",
            "endDate": f["endDate"] or "",
            "applyBy": f["applyBy"] or "",
            "deadlineNote": f["deadlineNote"] or "",
            "earlyBird": "",
            "notifyDate": f["notifyDate"] or "",
            "fee": f["juryFee"],
            "feeLabel": f["juryFeeLabel"] or "",
            "url": f["officialUrl"] or "",
            "lat": f.get("lat"),
            "lng": f.get("lng"),
        })
        added += 1

    rows.sort(key=lambda r: (r.get("name") or "").lower())
    payload = {
        "schemaVersion": 1,
        "source": "Art_Show_Tracker.xlsx + fit model additions",
        "importedAt": __import__("datetime").date.today().isoformat(),
        "count": len(rows),
        "shows": rows,
    }
    with open(CATALOGUE_OUT, "w") as fh:
        json.dump(payload, fh, indent=1)
        fh.write("\n")
    print("  catalogue.json rewritten: %d shows (%d folded in from the fit model)"
          % (len(rows), added))


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
        # Filled by the ZAPPlication research pass. See import_show_research.py.
        "boothFeeDetail": None,        # the fee schedule verbatim
        "commissionNote": None,        # what the page says, which is not the same
                                       # as a percentage — see the importer
        "avgSubmissionsPerYear": None,
        "avgAccepted": None,
        "avgExemptFromJury": None,
        "effectiveAcceptanceRatePct": None,   # accepted less exempt, over submitted
        "imagesRequired": None,
        "boothShotRequired": None,
        "applicationsAllowed": None,
        "emergingArtistProgram": None,
        "jurorCount": None,
        "juryScoringScale": None,
        "refundPolicy": None,
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


def apply_research(rec, entry):
    """Merge one show's row from the ZAPPlication research pass.

    Applied BEFORE apply_override on purpose. This is a bulk import of a
    hundred shows; research-overrides.json is a hand-curated pass over
    twenty-nine of them. Where the two disagree, a person who looked at one
    show closely should beat a parser that looked at a hundred quickly, so
    the hand-curated layer lands last and wins.
    """
    if not entry:
        return
    for key, value in (entry.get("facts") or {}).items():
        rec["facts"][key] = value
    for key, value in (entry.get("factors") or {}).items():
        rec["factors"][key] = value
    rec["provenance"].update(entry.get("provenance") or {})
    if entry.get("researchStatus"):
        rec["researchStatus"] = entry["researchStatus"]


def apply_geocode(rec, geocode):
    """Fill lat/lng from the committed gazetteer output.

    Only ever fills a null. A research pass that found the venue's own
    coordinates has better information than a city centroid, and this must not
    overwrite it — the same rule the whole provenance model runs on: certainty
    only ever goes up.
    """
    if rec["facts"].get("lat") is not None or rec["facts"].get("lng") is not None:
        return
    entry = (geocode.get("shows") or {}).get(rec["id"])
    if not entry:
        return

    rec["facts"]["lat"] = entry["lat"]
    rec["facts"]["lng"] = entry["lng"]

    gaz = geocode.get("gazetteer") or {}
    rec["provenance"]["coordinates"] = {
        # Its own status. Not `verified` — nobody opened a page — and not
        # `search`, which renders "unconfirmed" and would understate a
        # deterministic lookup in a shipped dataset. A dataset is a third
        # kind of claim and the chip says which one it is.
        "status": "dataset",
        "basis": "%s for %s, %s (mean of %d ZIP centroid%s). %s" % (
            gaz.get("name", "offline gazetteer"),
            entry.get("city") or "?", entry.get("state") or "?",
            entry.get("zipCount", 0), "" if entry.get("zipCount") == 1 else "s",
            gaz.get("note", "")),
        "checked": geocode.get("generatedAt") or "",
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


def selftest():
    """Prove the date rules, without needing the real data to be broken.

    The shipped artifacts are asserted on by build/browser-tests.cjs, which is
    the right place for "does the defect reach the browser". This is the other
    half: does the rule itself fire, on inputs constructed to trip it. Run with
        python3 build/build_fit_data.py --selftest
    """
    failures = []

    def case(name, row, expect_repair=False, expect_fatal=False, expect_expired=False,
             today="2026-09-07"):
        repairs, fatals, expired = check_dates(name, row, today)
        got = (bool(repairs), bool(fatals), bool(expired))
        want = (expect_repair, expect_fatal, expect_expired)
        if got != want:
            failures.append("%s: expected %s, got %s %r" % (name, want, got, row))
        return row

    # The defect this whole pass exists for: a notify date a year stale.
    row = case("stale notify", {"applyBy": "2026-09-18", "notifyDate": "2025-09-22"},
               expect_repair=True)
    if row.get("notifyDate") not in (None, ""):
        failures.append("stale notify: value was not dropped, got %r" % row["notifyDate"])

    # Same defect in a raw catalogue row, which spells not-known as "".
    row = case("stale notify, catalogue shape",
               {"applyBy": "2026-09-18", "notifyDate": "2025-09-22", "startDate": ""},
               expect_repair=True)
    if row["notifyDate"] != "":
        failures.append("catalogue shape: expected '', got %r" % row["notifyDate"])

    # A notify date on the deadline itself is legal — juries do announce same-day.
    case("notify on the deadline", {"applyBy": "2026-09-18", "notifyDate": "2026-09-18"})

    # Unrepairable: nothing sensible to substitute, so the build must stop.
    case("ends before it starts",
         {"startDate": "2026-09-13", "endDate": "2026-09-11"}, expect_fatal=True)
    case("deadline after the show ends",
         {"startDate": "2026-09-11", "endDate": "2026-09-13", "applyBy": "2026-10-01"},
         expect_fatal=True)
    case("not a date", {"applyBy": "September 4th"}, expect_fatal=True)

    # A passed deadline is reported, never fatal — the calendar moves on its own.
    case("closed deadline", {"applyBy": "2026-09-04"}, expect_expired=True)
    case("open deadline", {"applyBy": "2026-12-04"})

    # Empty and absent both mean not known, and neither is an error.
    case("nothing known", {})
    case("all blank", {"startDate": "", "endDate": "", "applyBy": "", "notifyDate": ""})

    for line in failures:
        print("  FAIL  " + line)
    if failures:
        sys.exit("%d date-rule check%s failed" % (len(failures), "" if len(failures) == 1 else "s"))
    print("date rules: 11/11 checks passed")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
    else:
        main()
