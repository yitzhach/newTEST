# START HERE

**Live:** https://yitzhach.github.io/newTEST/tracker/browse.html
**Repo:** `yitzhach/newTEST` · deploys from `main` · **Phase 1 is done and shipped.**

`CLAUDE.md` at the repo root loads automatically every session and carries the
short version — stack, commands, critical rules, the traps. This file is the
detail behind it, and the two are split so neither repeats the other: counts and
coverage live *here*, because they go stale and CLAUDE.md is loaded every time.

`docs/handoff.md` is the deep reference (the model, the three data layers, the
honesty constraints, the file map); `docs/build-phases.md` is the roadmap and the
26-idea numbering. Open either only when you need it.

---

## Paste this into a new chat

`CLAUDE.md` loads on its own, so the prompt does not repeat the stack, the
commands or the rules. Keep it this short:

> Read `docs/START-HERE.md`, then work on: **…**
>
> Don't re-read the codebase — open only the files you're changing, and only
> open `docs/build-phases.md` or `docs/handoff.md` if the task needs them.
>
> Before finishing: run the four suites, then commit, push and merge to `main`.

Add a line naming a file or feature if you already know where the work lives —
that saves a search. Everything else is already loaded.

---

## How to tell what is live — read this before debugging anything

A huge amount of time went into "is the site updated?" during Phase 1, and the
answer was almost always **a cached script**, not a broken feature. Two things
now make that unmissable:

**1. The version stamp.** Every page shows a line at the bottom of its list:

```
v2026.09.07-1456 · bac2d25 · published Sep 7, 2026, 2:58 PM · details
```

The same thing lives at a stable URL, so you can check without loading the app
(which is the thing under suspicion):

**https://yitzhach.github.io/newTEST/tracker/version.json**

| field | meaning |
|---|---|
| `version` | the build, `YYYY.MM.DD-HHMM` |
| `builtAt` | when `build_fit_data.py` ran |
| `commit` / `deployedAt` | written **by the deploy**. Null means built but never published |
| `assetVersion` | the content hash on every script tag |

`commit` is the authoritative answer to "what is on GitHub right now".

**2. Cache busting.** `build_fit_data.py` stamps `?v=<hash>` onto every local
script and stylesheet, where the hash is derived from those files' contents.
Change one, the token changes, browsers refetch. Nobody bumps anything by hand.

If a change still seems missing, compare `version.json`'s `commit` against
`main`. If they match, it is deployed and the problem is elsewhere.

---

## Deploying

Push to `main`. `.github/workflows/static.yml` uploads the repo and deploys it
through the Pages **Actions** source. ~1 minute, then refresh.

> **Do not switch Pages to a branch source.** It was tried in order to give
> every PR a preview URL at `/pr-preview/pr-<n>/`, and it worked — but a Pages
> site has exactly one source, so it silently stopped `main` from publishing
> until the repo owner changed a setting by hand. Reverted. The machinery is in
> git history at `2a7e6bf` if it is ever wanted, and it needs that settings
> change made deliberately first.

---

## What exists

**Two pages, and the difference matters.**

- **`tracker/browse.html`** — the catalogue. 237 shows, fit scores, and the
  intel drawer with everything below.
- **`tracker/index.html`** — the ledger: your own shows, the map, the route,
  the Edit Show pane. Clicking a show's **name** (or the `i` button) opens the
  same drawer the catalogue shows; clicking anywhere else on the row opens the
  edit pane.

**The drawer**, in order: the fit breakdown · The facts · Booth fees ·
Getting in · Weather · Sales tax and permits · Reports.

| Feature | What it is |
|---|---|
| **Booth fees** | Single / double / corner in one box, `n/a` where unknown. A corner quoted as a surcharge is resolved to a total. Full schedule one click away |
| **Getting in** | Applicants · accepted · how many skipped the jury · **your odds applying cold**. A show taking 65 of 100 with 20 exempt is a 45% show |
| **Weather** | One card per show day: high, low, wind, sky, glyph. **Inside a fortnight it is the real forecast**; beyond that, what those calendar dates did over 10 years, each day averaged against the same date each year. The panel says which |
| **Sales tax** | State rate only, and it says so. Local surtaxes named but never added. Links to the state's own address lookup and permit page. Not tax advice |
| **Closed deadlines** | `gates()` has a `closed` level; closed shows sink in the ranking instead of reading as live opportunities |

**Data coverage** (of 237):

| | |
|---|---|
| coordinates | 235 |
| booth fee — single / double / corner | 198 / 97 / 92 |
| jury statistics | 203 |
| jury odds scored | 220 |

**The practice show.** `Seattle "This is a Test" Festival` — fictitious,
downtown Seattle, Jan 1–2. Every field carries a `fixture` provenance status
rendering as a loud TEST DATA chip; it is tagged in the list and banners itself
above its own score. Lives in `build/test-show.json`, deletable in one step.

---

## Rebuilding after a data edit

```bash
python3 build/build_fit_data.py     # rewrites fit-data.json + catalogue.json + version.json,
                                    # runs the date rules, stamps asset versions
```

Occasional, only when their sources change:

```bash
pip install openpyxl && python3 build/import_show_research.py   # the research spreadsheet
pip install zipcodes && python3 build/geocode_shows.py          # the gazetteer
```

`build/catalogue-source.json` is the pristine ZAPP export — read-only, never
written.

---

## The four suites — run all of them before pushing

```bash
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --no-save playwright   # once
cd worker && npm install && cd ..                                     # once

python3 -m http.server 8765          # leave running
node build/browser-tests.cjs         # 79 — model, drawer, provenance, data hygiene,
                                     #      geocode, tax guard rails, fees, weather, version
node build/ledger-view-tests.cjs     # 21 — details/link split, badges, lenses
cd worker && npm test                # 45 — API; manages its own worker
python3 build/build_fit_data.py --selftest   # 11 — the date rules themselves
```

All green as of this handoff: **79 / 21 / 45 / 11**.

Two things worth knowing about the tests:

- The sandbox has **no web egress**, so the weather checks assert the *failure*
  path (degrades to "not known") and a second set **stubs Open-Meteo** with its
  real response shape to test rendering. Both browser suites filter open-meteo
  and font hosts out of their request-failure check so a genuine error stands out.
- If the worker suite fails with `Something went wrong`, a stale `wrangler dev`
  is holding the local D1. `pkill -f "wrangler dev"; pkill -f workerd` and re-run.

---

## The rules that must not erode

From `docs/handoff.md`, and Phase 1 held to all of them:

- `verified` means a page was **actually opened**. WebSearch never earns it.
- A fact with no source is **null** and renders "not known" — never a number.
- A factor nobody scored **drops out of the weighted average**; never defaults to 5.
- 10 is always good for the artist.
- **Sales tax is the one feature that can cost somebody money.** State rate
  only, labelled as such, never a combined figure. Ohio, Utah and Wyoming ship
  with a null rate rather than a guessed one.
- **"Not mentioned" is not "zero".** All the research rows say "No commission
  mentioned"; `commissionPct` stays null and the wording is passed through.

### Provenance grades

`verified` · `corroborated` · `search` (renders "unconfirmed") · `dataset`
(a reference dataset, nobody opened the show's page) · `editorial` ·
`member` · `fixture` (the practice show — the absence of evidence, not a weak
grade of it).

---

## What is next

**Phase 3** — see `docs/build-phases.md`. The application pipeline is the
commercial keystone: the first thing that earns a weekly open. Phase 2 is
*no longer blocked* — booth fee coverage went 24 → 179, which was the blocker.
Phase 5's route planner is unblocked too, since the geocode landed.

Smaller things left over:

- **16 shows have no booth fee, and each one is deliberate.** The coverage
  audit went through all 38 the parser had left null and filled 22 by hand
  into `research-overrides.json`, quoting the line each number came from. The
  16 that remain state no rate a visiting artist could pay: nine say "NOT
  LISTED on ZAPP page", two quote only a corner surcharge with no base to add
  it to, two quote only an application or late fee, one is a residency with no
  booth, one prices only students and alumni, and one quotes only a reduced
  emerging-artist rate beside tent rentals. They need the organiser, not a
  better parser.
- **Do not make the fee parser split on runs of whitespace.** It looks like it
  should work — the spreadsheet pads columns with spaces — and it gains one
  show while corrupting six that already parse correctly (`zapp-14601` reads
  $75 instead of $375, `zapp-14302` reads $1,250 instead of $625). Tried and
  reverted during the coverage audit.
- **Per-discipline factor scores** are structurally present and empty.
- **The Worker is complete and undeployed.** It blocks only Phase 6.
  `worker/README.md` has the sequence.

### A note on the booth fee parser

`build/import_show_research.py` reads free-text fee schedules, and every bug in
it was found by **auditing its output against the raw text**, never by reading
the code. It has misread a resident discount, an advertising rate, a
membership, a late fee, a saving, a corner surcharge, and a sentence about
pricing artwork. If you change it, re-run the audit: no corner below its
single, no double at or below it, no fee of zero, and eyeball anything under
$150. Three tests assert those invariants but they cannot catch a plausible
wrong number.
