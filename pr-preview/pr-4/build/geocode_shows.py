#!/usr/bin/env python3
"""
Geocode the show list from an offline gazetteer, and write build/geocode.json.

WHY A SEPARATE SCRIPT AND A COMMITTED FILE

The container has no web egress, so this cannot call a geocoding service, and
it should not: a coordinate that changes silently between builds is exactly
the kind of number this project refuses to ship. So the lookup runs here,
against a dataset installed from PyPI, and its output is committed. Anyone can
read build/geocode.json and see which coordinate came from which city. The
build itself then has no new dependency — `build_fit_data.py` reads the JSON.

WHICH GAZETTEER, AND WHY NOT geonamescache

`geonamescache` was the obvious first choice and it is not good enough here.
It ships GeoNames cities with population over 15,000, which is fine for a
dataset about cities and wrong for a dataset about art fairs: Crested Butte,
Carefree, Cave Creek, Gold Canyon, Boca Grande and Mill Valley are all real
show towns and all below the floor. Measured against these 236 shows it
matched 170 and missed 66 — a 28% miss rate, concentrated exactly on the
small resort towns the good shows are in.

`zipcodes` (PyPI, 3.0.0) bundles the full US ZIP dataset — 42,789 records with
city, state and a coordinate — offline, and matches 234 of 236. The two it
misses are not cities: "Tampa Bay Area" and, in one row, the state name in the
city column. Those stay null, which is the correct answer.

WHAT THE COORDINATE ACTUALLY IS

The mean of the centroids of every ZIP belonging to that city. It locates the
CITY, not the venue — good enough to pull a weather history or identify a tax
jurisdiction, and not good enough to navigate to a booth. The provenance text
says so, and the UI repeats it, because a coordinate printed to four decimal
places looks like a surveyed point and is not one.

Usage:
    pip install zipcodes
    python3 build/build_fit_data.py      # so tracker/fit-data.json is current
    python3 build/geocode_shows.py       # rewrites build/geocode.json
    python3 build/build_fit_data.py      # folds the coordinates in

Only the first and last steps are needed on an ordinary data edit; re-run this
one when the show list itself changes.
"""

import json
import os
import re
import sys
import unicodedata
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIT_DATA = os.path.join(ROOT, "tracker", "fit-data.json")
OUT = os.path.join(ROOT, "build", "geocode.json")

# Bumped by hand when the dataset is upgraded, and written into every
# provenance entry. A coordinate that cannot name its source is not a fact.
GAZETTEER = {
    "package": "zipcodes",
    "version": "3.0.0",
    "name": "US ZIP Code dataset (zipcodes 3.0.0, PyPI)",
    "note": "City-level: the mean centroid of the city's ZIP codes, not the "
            "show venue.",
}

# Postal abbreviations the export and the gazetteer spell differently.
ABBREVIATIONS = [
    (r"\bst\b", "saint"), (r"\bste\b", "sainte"),
    (r"\bft\b", "fort"), (r"\bmt\b", "mount"),
]

STATE_NAMES = {
    "alabama", "alaska", "arizona", "arkansas", "california", "colorado",
    "connecticut", "delaware", "florida", "georgia", "hawaii", "idaho",
    "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana", "maine",
    "maryland", "massachusetts", "michigan", "minnesota", "mississippi",
    "missouri", "montana", "nebraska", "nevada", "new hampshire", "new jersey",
    "new mexico", "new york", "north carolina", "north dakota", "ohio",
    "oklahoma", "oregon", "pennsylvania", "rhode island", "south carolina",
    "south dakota", "tennessee", "texas", "utah", "vermont", "virginia",
    "washington", "west virginia", "wisconsin", "wyoming",
    "district of columbia",
}


def norm(value):
    """Fold a place name to something two spellings of it agree on."""
    text = unicodedata.normalize("NFKD", str(value)).encode("ascii", "ignore").decode()
    text = text.lower().replace(".", " ").replace("-", " ")
    text = re.sub(r"[^a-z0-9 ]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    for pattern, replacement in ABBREVIATIONS:
        text = re.sub(pattern, replacement, text)
    return re.sub(r"\s+", " ", text).strip()


def candidates(city, state):
    """The names worth trying for one show's city field, best guess first.

    The export's city column is not always a city. It carries parentheticals
    ("Lakewood Ranch (Sarasota County)"), trailing states ("Stuart, Florida"),
    and hyphenated pairs ("Jupiter-Juno Beach"). Each of those has an obvious
    reading, and trying them in order is honest — unlike, say, matching
    "Tampa Bay Area" to Tampa, which would invent a location the row does not
    claim.
    """
    raw = re.sub(r"\([^)]*\)", " ", str(city or ""))
    parts = [p.strip() for p in raw.split(",") if p.strip()]
    if len(parts) > 1 and (norm(parts[-1]) in STATE_NAMES
                           or parts[-1].strip().upper() == state):
        parts = parts[:-1]

    base = parts[0] if parts else raw
    tries = [base]
    for separator in ("-", "/"):
        if separator in base:
            tries += [p.strip() for p in base.split(separator)]

    seen, out = set(), []
    for candidate in tries:
        key = norm(candidate)
        if key and key not in seen:
            seen.add(key)
            out.append(key)
    return out


def build_index():
    """(normalised city, state) -> list of (lat, lng) for its ZIP centroids."""
    try:
        import zipcodes
    except ImportError:
        sys.exit("geocode needs the `zipcodes` package: pip install zipcodes")

    index = defaultdict(list)
    for row in zipcodes.list_all():
        if row.get("country") != "US" or not row.get("lat") or not row.get("long"):
            continue
        state = row.get("state") or ""
        # `acceptable_cities` carries the alternate names the Postal Service
        # will deliver to, which is where "Ft. Lauderdale" and the like live.
        names = [row.get("city") or ""] + list(row.get("acceptable_cities") or [])
        point = (float(row["lat"]), float(row["long"]))
        for name in names:
            key = (norm(name), state)
            if key[0]:
                index[key].append(point)
    return index


def main():
    if not os.path.exists(FIT_DATA):
        sys.exit("run build_fit_data.py first: %s is missing" % FIT_DATA)

    shows = json.load(open(FIT_DATA))["shows"]
    index = build_index()

    located, misses = {}, []
    for show in shows:
        state = show.get("state") or ""
        matched = None
        for name in candidates(show.get("city"), state):
            points = index.get((name, state))
            if points:
                matched = (name, points)
                break

        if not matched:
            misses.append({
                "id": show["id"],
                "city": show.get("city") or "",
                "state": state,
                # Said plainly rather than as a code. Every miss so far is the
                # same thing: the column does not hold a city.
                "why": "no city of that name in %s in the gazetteer" % (state or "—"),
            })
            continue

        name, points = matched
        located[show["id"]] = {
            "lat": round(sum(p[0] for p in points) / len(points), 4),
            "lng": round(sum(p[1] for p in points) / len(points), 4),
            "city": show.get("city") or "",
            "state": state,
            "matchedOn": name,
            "zipCount": len(points),
        }

    payload = {
        "generatedAt": __import__("datetime").date.today().isoformat(),
        "gazetteer": GAZETTEER,
        "count": len(shows),
        "located": len(located),
        "missed": len(misses),
        "misses": misses,
        "shows": dict(sorted(located.items())),
    }
    with open(OUT, "w") as fh:
        json.dump(payload, fh, indent=1, sort_keys=False)
        fh.write("\n")

    print("wrote %s" % os.path.relpath(OUT, ROOT))
    print("  %d of %d shows located  (%.1f%%)  from %s"
          % (len(located), len(shows), 100.0 * len(located) / max(len(shows), 1),
             GAZETTEER["name"]))
    print("  %d not located, left null:" % len(misses))
    for miss in misses:
        print("    - %s  %r, %s" % (miss["id"], miss["city"], miss["state"]))


if __name__ == "__main__":
    main()
