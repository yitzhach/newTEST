#!/usr/bin/env python3
"""
Merge a batch of research findings into build/research-overrides.json.

Reads a JSON batch on stdin, shaped { "<show id>": { ...override... } }, and
merges it field-by-field so successive research passes accumulate rather than
overwrite each other.

The provenance rule this enforces, because it is the whole point of the file:
every fact that lands in `facts` must have a matching entry in `provenance`
carrying a `status` and, for anything not marked `editorial`, a `source` URL.
A batch that fails that check is rejected rather than silently written.

Status vocabulary, weakest to strongest:
  editorial     an informed estimate. No source, and the UI says so.
  search        one search-derived source. Plausible, unconfirmed.
  corroborated  two or more independent sources agree.
  verified      read directly from the show's own prospectus or application.

`verified` is reserved for a page actually opened. Search results do not earn
it, however confident they read.

Usage:  python3 build/record_research.py < batch.json
"""

import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATH = os.path.join(ROOT, "build", "research-overrides.json")

VALID_STATUS = {"editorial", "search", "corroborated", "verified"}
NEEDS_SOURCE = {"search", "corroborated", "verified"}


def main():
    batch = json.load(sys.stdin)
    current = {}
    if os.path.exists(PATH):
        with open(PATH) as fh:
            current = json.load(fh)

    problems = []
    for show_id, ov in batch.items():
        prov = ov.get("provenance") or {}
        for field, value in (ov.get("facts") or {}).items():
            if value is None:
                continue  # explicitly "not known" needs no source
            if field not in prov:
                problems.append("%s: fact %r has no provenance entry" % (show_id, field))
        # A factor score is a claim too, and an unattributed one is exactly the
        # kind of number this whole file exists to prevent. Even an editorial
        # estimate has to say it is one.
        for field in (ov.get("factors") or {}):
            if field not in prov:
                problems.append("%s: factor %r has no provenance entry" % (show_id, field))
        for disc, vals in (ov.get("byDiscipline") or {}).items():
            for field in vals:
                if field not in prov:
                    problems.append("%s: byDiscipline[%s].%s has no provenance entry"
                                    % (show_id, disc, field))
        for field, entry in prov.items():
            status = entry.get("status")
            if status not in VALID_STATUS:
                problems.append("%s: %r has status %r" % (show_id, field, status))
            elif status in NEEDS_SOURCE and not entry.get("source"):
                problems.append("%s: %r is %r but carries no source" % (show_id, field, status))
            if not entry.get("checked") and status in NEEDS_SOURCE:
                problems.append("%s: %r has no checked-on date" % (show_id, field))

    if problems:
        print("rejected — %d provenance problem(s):" % len(problems), file=sys.stderr)
        for p in problems[:40]:
            print("  " + p, file=sys.stderr)
        sys.exit(1)

    for show_id, ov in batch.items():
        cur = current.setdefault(show_id, {})
        for section in ("facts", "factors", "provenance"):
            if section in ov:
                cur.setdefault(section, {}).update(ov[section])
        for disc, vals in (ov.get("byDiscipline") or {}).items():
            cur.setdefault("byDiscipline", {}).setdefault(disc, {}).update(vals)
        for key in ("confidence", "editorialNote", "researchStatus",
                    "researchedAt", "datesEstimated"):
            if key in ov:
                cur[key] = ov[key]

    with open(PATH, "w") as fh:
        json.dump(current, fh, indent=1, sort_keys=True)
        fh.write("\n")

    deep = sum(1 for v in current.values() if v.get("researchStatus") == "deep")
    print("merged %d show(s); overrides now cover %d show(s), %d researched deeply"
          % (len(batch), len(current), deep))


if __name__ == "__main__":
    main()
