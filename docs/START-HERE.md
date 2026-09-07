# START HERE

**Live:** https://yitzhach.github.io/newTEST/tracker/browse.html
**Repo:** `yitzhach/newTEST` · deploys from `main` · **Phase 1 is done and shipped.**

Read this file and nothing else to get going. `docs/handoff.md` is the deep
reference (the model, the three data layers, the honesty constraints, the file
map); `docs/build-phases.md` is the roadmap and the 26-idea numbering. Open
either only when you need it.

---

## Paste this into a new chat

> Working on the art show tracker in `yitzhach/newTEST`.
>
> Read `docs/START-HERE.md` — it is current and self-contained. Only open
> `docs/handoff.md` (the model and honesty rules) or `docs/build-phases.md`
> (the roadmap) if the task actually needs them. Don't re-read the codebase;
> open only the files you're changing.
>
> Deploys: push to `main` → GitHub Pages rebuilds → refresh. Nothing else.
> Check what's live at https://yitzhach.github.io/newTEST/tracker/version.json
>
> Before finishing: run the four suites listed in START-HERE, then commit,
> push, and merge to `main` so it deploys.
>
> What I want to work on: …

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
| booth fee — single / double / corner | 179 / 87 / 88 |
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

- **136 → 23 shows still lack booth fee text** in the research spreadsheet.
  No parser reaches those; they need another enrichment pass on the source.
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
