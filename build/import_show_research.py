#!/usr/bin/env python3
"""
Fold the enriched show research spreadsheet into build/show-research.json.

WHERE THIS DATA COMES FROM

`build/show-research-source.xlsx` is a ZAPPlication research pass: 236 rows,
34 columns, of which 100 carry `Research Status: Enriched`. The enriched rows
hold things that exist only on a show's own event page and that nothing in
this repository has ever had — booth fee schedules verbatim, jury statistics,
image requirements, refund policies. The other 136 rows are the same baseline
export the catalogue already carries, and are skipped.

Every enriched row carries its ZAPPlication URL, and the event id inside that
URL is the same id the catalogue uses. So the join is exact — 100 of 100, no
name matching and no guessing.

WHAT IT DOES NOT DO

It does not invent a booth fee. `Booth Fees (raw)` is a block of free text
listing every rate a show charges — singles, corners, doubles, food stalls,
electrical hookups, late payment penalties. Picking "the" booth fee out of
that is an interpretation, so the parser explains itself: it records the
number, the line it came from, and the whole schedule, and the drawer shows
all three. An artist can see the reasoning and disagree with it.

It also leaves `commissionPct` null. Every enriched row says "No commission
mentioned - booth-fee model", and *not mentioned* is not the same as *zero* —
an artist who reads "0%" and then loses 15% at the door has been misled by
this file. The note is recorded instead, in those words.

Usage:
    pip install openpyxl
    python3 build/import_show_research.py [path/to/spreadsheet.xlsx]
    python3 build/build_fit_data.py
"""

import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_SRC = os.path.join(ROOT, "build", "show-research-source.xlsx")
OUT = os.path.join(ROOT, "build", "show-research.json")

# Named in every provenance entry this script writes, so a reader can trace a
# number back to the row it came from.
SOURCE_NAME = "ZAPPlication event page research pass (show-research-source.xlsx)"

# ---------------------------------------------------------------------------
# Booth fee parsing
#
# The raw text is a fee schedule, not a number. These patterns decide which
# line of it describes the ordinary single booth an artist would actually be
# quoted, and the winning line is recorded alongside the number so the choice
# is visible rather than implied.
# ---------------------------------------------------------------------------

# Lines about something other than renting the standard space.
# Plurals matter here: "Corners $125 extra" is an add-on, and a pattern that
# only matched the singular let $125 outrank a show's real $495 booth.
NOT_A_BOOTH = re.compile(
    r"\bdoubles?\b|\bcorners?\b|foods?|concessions?|electric|power|"
    r"\bamps?\b|plugs?|upgrades?|valet|emerging|generators?|storage|"
    r"parking|trailers?|\brv\b|tents?|tables?|\bextra\b|add-?on|"
    r"advertis|program|membership|application fee|non-?profit|camping|sponsor|"
    r"refunds?|cancel|deposits?|late payment|late fee|penalt|processing fee",
    re.I)

# A segment must actually be about renting a space. Without this the parser
# happily reads "Ad in Event Program: Add $75", a $60 membership, and a
# sentence about pricing artwork under $100 as though they were booth fees —
# all of which it did, until this was added.
IS_A_BOOTH = re.compile(
    r"booth|space|exhibit|stall|\bsite\b|\d\s*['’]?\s*x\s*\d|wide\s+by", re.I)

# Lines that say in so many words that this is the standard single space.
IS_STANDARD = re.compile(r"standard|single|regular|\bbasic\b", re.I)

# "10 x 10", "10'x10'", "11' Wide by 10' Deep" — the first number is the width,
# and anything 15 feet or wider is a multiple space rather than a single.
WIDTH = re.compile(r"(\d{1,2})\s*['’]?\s*(?:x|×|wide\s+by)", re.I)

MONEY = re.compile(r"\$\s*([\d,]+(?:\.\d{1,2})?)")

BOOTH_FEE_MIN = 50        # below this it is an add-on, not a booth
BOOTH_FEE_MAX = 10000     # above this it is a sponsorship or a typo


def parse_booth_fee(raw):
    """
    @returns (amount, the line it came from) or (None, None).
    """
    if not raw:
        return None, None

    candidates = []          # (amount, segment, is_standard)
    for line in str(raw).splitlines():
        # Some shows put the whole schedule on one line, separated by pipes or
        # slashes: "Single 5x8 ($225) | Double 8x16 ($495)". Split those, or a
        # single "double" anywhere disqualifies the single sitting next to it.
        for segment in re.split(r"\s*\|\s*|\s+/\s+", line):
            segment = segment.strip()
            if not segment:
                continue

            # Filter on the segment with parentheticals removed. "$720 Single
            # Booth Space Fee (Subject to refund policy)" is a booth price;
            # the word "refund" in the aside should not disqualify it.
            testable = re.sub(r"\([^)]*\)", " ", segment)
            if NOT_A_BOOTH.search(testable) or not IS_A_BOOTH.search(testable):
                continue

            width = WIDTH.search(testable)
            if width and int(width.group(1)) >= 15:
                continue     # a 20-foot frontage is two spaces

            # Every price in the segment, not just the first: a line reading
            # "Jury Fee - $25 Standard Booth Fee - $180" leads with a number
            # that is not the booth fee. Out-of-range amounts drop out, and
            # the cheapest of what remains is the base rate.
            amounts = [float(m.replace(",", "")) for m in MONEY.findall(segment)]
            amounts = [a for a in amounts if BOOTH_FEE_MIN <= a <= BOOTH_FEE_MAX]
            if not amounts:
                continue
            candidates.append((min(amounts), segment,
                               bool(IS_STANDARD.search(testable))))

    if not candidates:
        return None, None

    # A line that names itself standard beats one that merely survived the
    # filters. Among equals, the cheapest — a fee schedule reads low to high,
    # and the base rate is the one being quoted.
    named = [c for c in candidates if c[2]]
    pick = min(named or candidates, key=lambda c: c[0])
    return pick[0], pick[1]


# ---------------------------------------------------------------------------
# Small parsers
# ---------------------------------------------------------------------------

def blank(v):
    if v is None:
        return True
    s = str(v).strip()
    return s == "" or s.lower() in ("none", "n/a", "na", "-")


def as_int(v, lo=0, hi=100000):
    if blank(v):
        return None
    m = re.search(r"\d[\d,]*", str(v))
    if not m:
        return None
    n = int(m.group(0).replace(",", ""))
    return n if lo <= n <= hi else None


def as_text(v, limit=4000):
    if blank(v):
        return None
    return re.sub(r"[ \t]+", " ", str(v).strip())[:limit]


def clean_venue(v, city):
    """The address column trails the city, the state and a phone number.

    "701 W. Burlington Ave. La Grange, Illinois (Midwest)" is a useful venue;
    "Bar Harbor Bar Harbor, Maine 207 266-5884" is not, and returns None
    rather than repeating the city back at the reader.
    """
    if blank(v):
        return None
    text = str(v).strip()
    text = re.sub(r"\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}", " ", text)   # phone
    text = re.sub(r"\([^)]*\)", " ", text)                            # (Midwest)
    if city:
        # Cut at the city name, which is where the address stops and the
        # postal tail begins.
        at = text.lower().rfind(str(city).lower())
        if at > 0:
            text = text[:at]
    text = re.sub(r"[\s,.-]+$", "", re.sub(r"\s+", " ", text)).strip()
    if len(text) < 4 or (city and text.lower() == str(city).lower()):
        return None
    return text[:200]


def jury_odds_from_rate(pct):
    """Map an acceptance rate onto the ten-point jury-odds factor.

    10 is always good for the artist, so a show that takes most applicants
    scores high and one that takes a handful scores low. The bands are
    editorial — the rate underneath them is not, and the provenance entry
    written alongside says which is which.
    """
    if pct is None:
        return None
    for threshold, score in ((60, 9), (45, 8), (35, 7), (25, 6),
                             (18, 5), (12, 4), (8, 3), (4, 2)):
        if pct >= threshold:
            return score
    return 1


# ---------------------------------------------------------------------------

def main():
    try:
        import openpyxl
    except ImportError:
        sys.exit("this importer needs openpyxl: pip install openpyxl")

    src = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SRC
    if not os.path.exists(src):
        sys.exit("missing spreadsheet: %s" % src)

    sheet = openpyxl.load_workbook(src, data_only=True)["Shows"]
    rows = list(sheet.iter_rows(values_only=True))
    col = {name: i for i, name in enumerate(rows[0])}

    def cell(row, name):
        i = col.get(name)
        return None if i is None else row[i]

    shows, stats = {}, {"rows": 0, "enriched": 0, "matched": 0,
                        "boothFee": 0, "juryStats": 0, "juryOdds": 0}
    unparsed_fees = []

    for row in rows[1:]:
        stats["rows"] += 1
        if str(cell(row, "Research Status") or "").strip() != "Enriched":
            continue
        stats["enriched"] += 1

        found = re.search(r"ID=(\d+)", str(cell(row, "URL") or ""))
        if not found:
            continue
        show_id = "zapp-" + found.group(1)
        stats["matched"] += 1

        url = as_text(cell(row, "URL"))
        page = {"status": "verified", "source": url,
                "basis": SOURCE_NAME}

        facts, factors, provenance = {}, {}, {}

        def record(key, value, basis=None):
            if value is None:
                return
            facts[key] = value
            entry = dict(page)
            if basis:
                entry["basis"] = SOURCE_NAME + " — " + basis
            provenance[key] = entry

        # --- booth fee, the field that was 24/236 -------------------------
        raw_fees = as_text(cell(row, "Booth Fees (raw)"))
        amount, line = parse_booth_fee(raw_fees)
        if amount is not None:
            stats["boothFee"] += 1
            record("boothFee", amount, "read from the fee schedule line: " + line)
            facts["boothFeeNote"] = "standard single booth"
            record("boothFeeDetail", raw_fees,
                   "the show's full fee schedule, verbatim")
        elif raw_fees:
            unparsed_fees.append((show_id, raw_fees[:90]))
            record("boothFeeDetail", raw_fees,
                   "the show's full fee schedule, verbatim. No single standard "
                   "rate could be read out of it, so no booth fee is claimed")

        # --- the jury numbers ---------------------------------------------
        submissions = as_int(cell(row, "Avg # Submissions/Year"))
        accepted = as_int(cell(row, "Avg # Accepted"))
        exempt = as_int(cell(row, "Avg # Exempt from Jury"))
        record("avgSubmissionsPerYear", submissions)
        record("avgAccepted", accepted)
        record("avgExemptFromJury", exempt)

        if submissions and accepted is not None and submissions > 0:
            stats["juryStats"] += 1
            nominal = round(100.0 * accepted / submissions, 1)
            record("acceptanceRatePct", nominal,
                   "%d accepted of %d submitted" % (accepted, submissions))

            # The number that actually decides an artist's odds. Exempt
            # artists take places without competing for them, so a show that
            # accepts 65 of 100 but exempts 20 of those is not a 65% show for
            # anybody applying cold — it is a 45% show.
            if exempt is not None and exempt > 0:
                effective = round(100.0 * max(accepted - exempt, 0) / submissions, 1)
                record("effectiveAcceptanceRatePct", effective,
                       "%d accepted less %d exempt from jury, of %d submitted"
                       % (accepted, exempt, submissions))
            else:
                effective = nominal

            score = jury_odds_from_rate(effective)
            if score is not None:
                stats["juryOdds"] += 1
                factors["juryOdds"] = score
                provenance["juryOdds"] = {
                    "status": "estimated",
                    "source": url,
                    "basis": "editorial ten-point banding of this show's own "
                             "reported odds: %.1f%% of applicants are accepted "
                             "through the jury. The rate is the show's; the "
                             "band is ours." % effective,
                }

        # --- what applying actually involves -------------------------------
        record("imagesRequired", as_int(cell(row, "Images Required"), 1, 30))
        booth_shot = as_text(cell(row, "Booth Shot Required"))
        if booth_shot:
            record("boothShotRequired", booth_shot.lower().startswith("y"))
        record("applicationsAllowed", as_int(cell(row, "Apps Allowed"), 1, 50))
        record("emergingArtistProgram", as_text(cell(row, "Emerging Artist Program"), 400))
        record("jurorCount", as_int(cell(row, "# Jurors"), 1, 100))
        record("juryScoringScale", as_text(cell(row, "Jury Scoring Scale"), 80))
        record("refundPolicy", as_text(cell(row, "Cancellation/Refund Policy")))
        record("venue", clean_venue(cell(row, "Location/Address"), cell(row, "City")))

        # See the module docstring: "not mentioned" is not "zero", and the
        # difference is 15% of an artist's weekend.
        commission = as_text(cell(row, "Commission Taken"), 200)
        if commission:
            record("commissionNote", commission)

        shows[show_id] = {"facts": facts, "factors": factors,
                          "provenance": provenance,
                          "researchStatus": "enriched"}

    payload = {
        "generatedAt": __import__("datetime").date.today().isoformat(),
        "source": SOURCE_NAME,
        "note": "Enriched rows only. Baseline rows repeat the catalogue export "
                "and are skipped.",
        "count": len(shows),
        "shows": dict(sorted(shows.items())),
    }
    with open(OUT, "w") as fh:
        json.dump(payload, fh, indent=1, sort_keys=False)
        fh.write("\n")

    print("wrote %s" % os.path.relpath(OUT, ROOT))
    print("  %d rows read, %d enriched, %d joined on their ZAPP id"
          % (stats["rows"], stats["enriched"], stats["matched"]))
    print("  %d booth fees read out of the fee schedules" % stats["boothFee"])
    print("  %d shows with jury statistics, %d scored for jury odds"
          % (stats["juryStats"], stats["juryOdds"]))
    if unparsed_fees:
        print("  %d fee schedules had no readable standard rate "
              "(kept verbatim, no fee claimed):" % len(unparsed_fees))
        for show_id, sample in unparsed_fees:
            print("    - %s  %s" % (show_id, sample.replace("\n", " / ")))


if __name__ == "__main__":
    main()
