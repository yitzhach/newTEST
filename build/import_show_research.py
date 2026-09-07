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
# `Booth Fees (raw)` is a whole fee schedule in free text, and an artist wants
# three numbers out of it: what a single booth costs, what a double costs, and
# what a corner costs. Those are the three decisions — take the cheap space,
# take twice the frontage, or pay for the corner traffic.
#
# The awkward part is that shows quote corners two different ways:
#
#     10 X 10' Corner Booth: $700        a total
#     Corner upgrade: $100               an increment on top of the single
#
# Both are common and they differ by a factor of seven, so the parser has to
# tell them apart rather than average them. An increment is added to the single
# to give a total, because the number an artist compares between shows is what
# leaves their bank account.
#
# Everything here is written to fail closed. A line it cannot classify does not
# become a guess; the field stays null and the drawer prints "n/a" next to the
# ones it does know, with the full schedule one click away.
# ---------------------------------------------------------------------------

# Never a booth rate at all, whatever else the line says.
HARD_SKIP = re.compile(
    r"foods?|concessions?|electric|power|\bamps?\b|plugs?|generators?|storage|"
    r"parking|trailers?|\brv\b|tents?|tables?|camping|sponsor|advertis|"
    r"\bprogram\b|membership|application fee|jury fee|non-?profit|valet|"
    r"emerging|student|refunds?|cancel|deposits?|late payment|late fee|"
    r"penalt|processing fee|"
    # Rates a visiting artist cannot have. A local-resident or alumni discount
    # is a real price for somebody, just never for the person this tool is
    # for, and it is always the cheapest line on the schedule — so "cheapest
    # wins" walks straight into it. One show quoted $495 standard and $250
    # resident, and the parser took the $250.
    r"\bresidents?\b|discount|\bseniors?\b|veterans?|alumni|\blocal\b",
    re.I)

# The line is about renting space rather than about something else entirely.
# Without this the parser reads "Ad in Event Program: Add $75", a $60
# membership, and a sentence about pricing artwork under $100 as booth fees —
# all of which it did before this existed.
IS_A_BOOTH = re.compile(
    r"booth|space|exhibit|stall|\bsite\b|\d\s*['’]?\s*x\s*\d|wide\s+by|"
    r"\bcorners?\b|\bdoubles?\b", re.I)

IS_STANDARD = re.compile(r"standard|single|regular|\bbasic\b", re.I)
IS_CORNER = re.compile(r"\bcorners?\b", re.I)
IS_DOUBLE = re.compile(r"\bdoubles?\b", re.I)

# "Corner upgrade", "Corners $125 extra", "Additional $100" — a surcharge on
# the single rather than a price of its own.
IS_INCREMENT = re.compile(r"upgrade|additional|\bextra\b|\badd\b|^\s*\+", re.I)

# "10 x 10", "10'x10'", "11' Wide by 10' Deep" — the first number is the
# frontage, and 15 feet or more is a multiple space.
WIDTH = re.compile(r"(\d{1,2})\s*['’]?\s*(?:x|×|wide\s+by)", re.I)

MONEY = re.compile(r"\$\s*([\d,]+(?:\.\d{1,2})?)")

BOOTH_FEE_MIN = 50        # below this a standalone price is an add-on
INCREMENT_MIN = 10        # a corner surcharge can legitimately be small
BOOTH_FEE_MAX = 10000     # above this it is a sponsorship or a typo


def parse_booth_fees(raw):
    """Read single, double and corner out of a fee schedule.

    @returns {"single": n|None, "double": n|None, "corner": n|None,
              "line": the segment the single came from}
    """
    out = {"single": None, "double": None, "corner": None, "line": None}
    if not raw:
        return out

    singles, doubles, corners = [], [], []

    for line in str(raw).splitlines():
        # Some shows put the whole schedule on one line separated by pipes or
        # slashes: "Single 5x8 ($225) | Double 8x16 ($495)". Split those, or
        # one "double" disqualifies the single sitting beside it.
        for segment in re.split(r"\s*\|\s*|\s+/\s+", line):
            segment = segment.strip()
            if not segment:
                continue

            # Filter with parentheticals removed: "$720 Single Booth Space Fee
            # (Subject to refund policy)" is a booth price, and the word
            # "refund" in the aside should not disqualify it.
            # A fee line is short. Anything longer is prose describing the
            # site, and prose mentions several prices at once — one show's
            # paragraph put "the single booth fee is $200" and "doubles are
            # $400" in the same sentence, and reading a number out of that
            # gets it wrong in a way no amount of pattern-matching fixes.
            if len(segment) > 120:
                continue

            testable = re.sub(r"\([^)]*\)", " ", segment)
            if HARD_SKIP.search(testable) or not IS_A_BOOTH.search(testable):
                continue

            corner = bool(IS_CORNER.search(testable))
            width = WIDTH.search(testable)
            double = bool(IS_DOUBLE.search(testable)) or \
                (width is not None and int(width.group(1)) >= 15)

            # "Double Corner Booth" is a fourth thing and belongs in neither
            # column. Skipping it is better than filing it under either.
            if corner and double:
                continue
            # "the single booth fee is $200, doubles are $400" in one segment
            # names two rates, and taking either is a coin flip.
            if double and IS_STANDARD.search(testable):
                continue

            amounts = [float(m.replace(",", "")) for m in MONEY.findall(segment)]
            # Tested against the raw segment, not the parenthetical-stripped
            # one: "Corner Fee (Additional): $100" hides the only word that
            # says it is a surcharge inside the brackets this strips out.
            increment = bool(IS_INCREMENT.search(segment))
            floor = INCREMENT_MIN if (corner and increment) else BOOTH_FEE_MIN
            amounts = [a for a in amounts if floor <= a <= BOOTH_FEE_MAX]
            if not amounts:
                continue
            amount = min(amounts)

            if corner:
                corners.append((amount, increment))
            elif double:
                doubles.append(amount)
            else:
                singles.append((amount, segment, bool(IS_STANDARD.search(testable))))

    if singles:
        # A line that calls itself standard beats one that merely survived the
        # filters. Among equals the cheapest, since a schedule reads low to
        # high and the base rate is what is being quoted.
        named = [c for c in singles if c[2]]
        amount, segment, _ = min(named or singles, key=lambda c: c[0])
        out["single"] = amount
        out["line"] = segment

    if doubles:
        out["double"] = min(doubles)

    if corners:
        amount, is_increment = min(corners, key=lambda c: c[0])
        # A corner that costs LESS than a plain booth is not a corner price,
        # whatever words the line used. It is a surcharge that failed to
        # announce itself, and the arithmetic says so more reliably than the
        # vocabulary does. This is the backstop for every phrasing nobody
        # thought of.
        if out["single"] and amount < out["single"]:
            is_increment = True
        if is_increment:
            # A surcharge is only meaningful added to something. With no
            # single to add it to, report nothing rather than the surcharge.
            out["corner"] = out["single"] + amount if out["single"] else None
        else:
            out["corner"] = amount

    # Same reasoning the other way: a double that does not cost more than a
    # single is a misread, and a wrong number is worse than none.
    if out["double"] and out["single"] and out["double"] <= out["single"]:
        out["double"] = None

    return out


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
                        "boothFee": 0, "boothDouble": 0, "boothCorner": 0,
                        "juryStats": 0, "juryOdds": 0}
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

        # --- booth fees, the field that was 24/236 ------------------------
        raw_fees = as_text(cell(row, "Booth Fees (raw)"))
        fees = parse_booth_fees(raw_fees)
        if fees["single"] is not None:
            stats["boothFee"] += 1
            record("boothFee", fees["single"],
                   "read from the fee schedule line: " + fees["line"])
            facts["boothFeeNote"] = "standard single booth"
        if fees["double"] is not None:
            stats["boothDouble"] += 1
            record("boothFeeDouble", fees["double"], "from the fee schedule")
        if fees["corner"] is not None:
            stats["boothCorner"] += 1
            record("boothFeeCorner", fees["corner"], "from the fee schedule")
        if raw_fees:
            record("boothFeeDetail", raw_fees,
                   "the show's full fee schedule, verbatim")
            if fees["single"] is None:
                unparsed_fees.append((show_id, raw_fees[:90]))

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
    print("  booth fees read out of the schedules: %d single, %d double, %d corner"
          % (stats["boothFee"], stats["boothDouble"], stats["boothCorner"]))
    print("  %d shows with jury statistics, %d scored for jury odds"
          % (stats["juryStats"], stats["juryOdds"]))
    if unparsed_fees:
        print("  %d fee schedules had no readable standard rate "
              "(kept verbatim, no fee claimed):" % len(unparsed_fees))
        for show_id, sample in unparsed_fees:
            print("    - %s  %s" % (show_id, sample.replace("\n", " / ")))


if __name__ == "__main__":
    main()
