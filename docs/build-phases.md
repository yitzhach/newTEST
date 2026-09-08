# Build phases

The multi-phase plan for turning the show ledger into a business tool artists
pay for. `docs/handoff.md` remains authoritative for the model, the three data
layers and the honesty constraints; this file is only the roadmap and the
numbering behind it.

Each phase is meant to be one session. Start a session by pasting the phase
prompt (§5), not by re-deriving the plan.

---

## 1. The idea numbering — stable, cite it by number

These numbers are referenced across sessions. Do not renumber them; append.

### A. Show-record stats — public data, no members required

| # | Idea | Notes |
|---|---|---|
| 1 | Geocode all 236 shows | `facts.lat/lng` are 0/236. Unlocks 2, 3, 4, 9, 17 |
| 2 | Weather history for the show's actual dates | P(rain), mean high, wind |
| 3 | Census buyer demographics for the metro | Median income, households >$200k |
| 4 | Tourism seasonality | Resort town in peak week ≠ same town in October |
| 5 | Field composition from published exhibitor lists | Turns factor 8 into data |
| 6 | Show stability signals | Years running, organizer type, venue changes |
| 7 | Prospectus year-over-year diff | Fee up, dates moved, new rules |
| 8 | True landed cost | Booth + jury + mileage + lodging + commission |
| 9 | Sales tax rate + permit requirement by jurisdiction | See the risk note in §4 |
| 10 | Wait-list movement | Members only — how often the list actually calls |

### B. Business tools — the sellable core, weekly use

| # | Idea | Notes |
|---|---|---|
| 11 | Application pipeline | Applied → juried → accepted → paid → done |
| 12 | Jury fee spend tracker | "$840 across 22 applications, 9 in, $93 each" |
| 13 | Break-even calculator per show | "Sell $2,340 — six pieces — to clear zero" |
| 14 | Expected value on applying | P(accept) × E[net] − jury fee |
| 15 | Square/Stripe import tagged by show | Kills manual data entry |
| 16 | Cash flow calendar | Booth fees fall due months before the season earns |
| 17 | Route and season planner | Drive time, back-to-back feasibility, dead weeks |
| 18 | Mileage and expense log | Schedule C shaped |
| 19 | Inventory and sell-through | Which sizes and price points move where |
| 20 | Collector CRM tied to the show | Post-show follow-up is real revenue |
| 21 | Image sets per application | Five images + booth shot, specs differ per show |
| 22 | 90-second post-show debrief | Feeds intel; artist gets their own P&L back |

### C. Network-only — the moat, worthless below ~20 members

| # | Idea | Notes |
|---|---|---|
| 23 | Booth-level results | Booth number + outcome. Exists nowhere else |
| 24 | Peer benchmarking by discipline and price band | The SourceBook question, answered properly |
| 25 | Weather-adjusted results | Normalise against what the weather did |
| 26 | Load-in reality reports | Factor 9 as data instead of estimate |

---

## 2. Phase map

| Phase | Contains | Blocked on |
|---|---|---|
| **1** | ~~Data hygiene, geocode (1), weather (2), sales tax (9)~~ **done** | — |
| **2** | Landed cost (8), break-even (13), cash flow (16), expense log (18) | ~~booth fees~~ — unblocked, see §7 |
| **3** | ~~Application pipeline (11), jury fee tracker (12), expected value (14)~~ **done** · image sets (21) still open | image sets: R2, so a deployed Worker |
| **4** | Square import (15), sell-through (19), debrief (22), collector CRM (20) | nothing |
| **5** | Route planner (17), demographics (3), tourism (4) | ~~Phase 1 geocode~~ — unblocked |
| **6** | Booth-level (23), benchmarking (24), weather-adjusted (25), load-in (26), wait-list (10) | **Worker deployed + ~20 members** |
| **7** | Field composition (5), stability signals (6), prospectus diff (7) | saved ZAPP pages — the container cannot fetch them |

Phase 3 is the commercial keystone: the tracker is a research tool people open
once a year, and the application pipeline is the first thing that earns a
weekly open. Phases 2 and 4 are worth more once 3 exists.

---

## 3. Environment facts — verified 2026-09-07, don't rediscover them

- **No general web egress from the container.** `curl` and `WebFetch` are both
  blocked for every domain tested: `zapplication.org`, `en.wikipedia.org`,
  `api.census.gov`, `ncei.noaa.gov`, `cherryarts.org`, `entrythingy.com`,
  `artfaircalendar.com`. Nothing may fetch from the network at build time.
- **WebSearch works.** It returns synthesised summaries that silently blend
  years and listings — a search for our `zapp-14594` returned figures for a
  different ZAPP id and a different year, stated confidently. It earns
  `search`, never `verified`.
- **PyPI and npm are reachable.** This is how Phase 1 geocoded with no
  network. Note that `geonamescache` was **not** good enough: it ships only
  GeoNames cities above population 15,000 and missed 66 of these 236 shows —
  a 28% miss rate concentrated on exactly the small resort towns the good
  shows are in. The `zipcodes` package (42,789 US ZIP records, offline)
  matched 234 of 236 and is what shipped.
- **The deployed site runs in a visitor's browser, which has egress.** Anything
  needing live external data belongs in a client-side fetch, not the build.
  This is what makes weather (2) buildable despite the block.
- **GitHub Pages deploys from `main` only.** Work is not live until merged.

### Where the existing data actually came from

Worth knowing before trusting any field. `build/catalogue-source.json` is a
**ZAPPlication export** — 202 records, and only these 14 columns:

```
id  name  city  state  stateName  startDate  endDate
applyBy  deadlineNote  earlyBird  notifyDate  fee  feeLabel  url
```

That explains the entire coverage pattern: dates, deadline and jury fee are
236/236 because they are export columns; booth fee, booth count, commission,
media categories, power and vehicle access are near-empty because they exist
only on the event page, which nothing has ever opened. The remaining 34 shows
were folded in from the fit model by hand.

Provenance across the catalogue: **953 entries rest on the export, 287 on
WebSearch, and 2,079 are editorial judgment.** Roughly two-thirds of the
numbers on the site are authored estimates. The UI is built to say so, and
must keep saying so.

---

## 4. Standing constraints

Carried from `docs/handoff.md`, repeated because they are easy to erode:

- `verified` means a page was **actually opened**. WebSearch never earns it.
  An offline dataset shipped in the repo is cited to the dataset and version.
- A fact with no source is **null** and renders "not known" — never a number.
- A factor nobody scored **drops out of the weighted average**; it never
  defaults to 5.
- `build/record_research.py` rejects any batch missing provenance. Do not route
  around it.
- 10 is always good for the artist. Where the underlying quantity runs the
  other way, the factor is named so higher still means better.

### The one idea with real downside risk

**Sales tax (9) is different from everything else on this list.** Every other
idea fails by being unhelpful. This one fails by causing an artist to
under-collect and owe money later. So:

- It is **not tax advice**, and the UI must say so plainly.
- Every rate carries the date it was captured and a link to the issuing
  authority. A stale rate renders as stale.
- State rate is the easy part. City, county and special-district rates are the
  hard part, and are why geocoding comes first.
- If local rates cannot be sourced honestly, ship state-only and **label it
  state-only**. Never silently under-report.
- If no keyless, CORS-permitting source exists, say so and propose the
  alternative rather than inventing numbers.

---

## 5. Phase 1 — SHIPPED

Delivered on `claude/phase-1-build-134uv0`. What changed is summarised in
`docs/START-HERE.md`; the original spec is kept below unaltered, because the
next phase's session should be able to see what was asked for as well as what
was done.

Three things the phase settled that later phases need:

- **Coordinates exist**, 234/236, city-level, in `facts.lat/lng` and in
  `catalogue.json`. Idea 17 (route planner) and ideas 3 and 4 are unblocked.
- **The weather API question (§6) is answered** — Open-Meteo's historical
  archive — but **not verified**, because this container cannot reach it.
  Someone on the live site needs to confirm the panel shows numbers.
- **Sales tax shipped without a combined rate, deliberately.** There is no
  keyless, CORS-permitting national rate source, so the panel carries the
  state rate, says "state rate only" in those words, and links to each
  state's own address lookup. Ohio, Utah and Wyoming ship with a null rate
  rather than a guessed one.

---

## 5a. Phase 1 — the original spec

### 0. Data hygiene, first because it is a live bug

- **11 shows have `applyBy` in the past** and are still ranked as live
  opportunities.
- **12 shows have `notifyDate` before `applyBy`**, which is impossible — stale
  notify dates carried over from an earlier edition of the listing.

Fix both, add validation to `build/build_fit_data.py` so a build fails rather
than shipping them again, and surface expired deadlines in the UI.

### 1. Geocode all 236 shows

`facts.lat/lng` are 0/236. Use `geonamescache` or an equivalent offline
gazetteer — no network. Match on city + state. Report the miss rate honestly
and leave unmatched shows null rather than guessing. Provenance cites the
dataset and its version.

### 2. Weather history (idea 2)

For the show's coordinates and its calendar window: probability of rain, mean
high, wind. NOAA is unreachable from the container, so this is a **client-side
runtime fetch** from a free, keyless, CORS-permitting historical or climate
API. Verify those three properties before committing to one. Handle the
failure case so a dead API degrades to "not known" rather than a broken panel.
Cache in the browser. Render as a fact with its source.

### 3. Sales tax and permits (idea 9)

Per §4. The combined rate an artist collects at that location, plus a link to
the state's temporary-vendor registration page.

### Definition of done

- All three shipped, provenance on every new fact.
- New tests in the existing suites for the validation rules and geocode
  coverage.
- Three suites green: `node build/browser-tests.cjs` (37),
  `node build/ledger-view-tests.cjs` (21), `cd worker && npm test` (45).
  A fresh container needs deps first:
  `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --no-save playwright`, and
  `npm install` in `worker/`.
- Committed and pushed, and `docs/START-HERE.md` updated with what changed.

---

## 6. Open decisions

Not blocking Phase 1, but they need an answer before the phase that needs them:

- ~~**Which weather API.**~~ Answered: Open-Meteo's historical archive
  (`archive-api.open-meteo.com`, ERA5 reanalysis), for the three reasons the
  decision required — no key, cross-origin permitted, daily data back to 1940.
  **Still unverified against a live response**, because the container cannot
  reach it. `tracker/weather.js` fails closed and the panel reads "not known",
  so a wrong choice is visible rather than silent. Confirm on the live site.
- ~~**Where booth fees come from.**~~ Answered: the research spreadsheet plus a
  hand audit into `research-overrides.json`. Coverage is well past the bar Phase 2
  needed — current numbers are in `START-HERE.md`, not here, because they move.
  The shows still lacking a fee state no rate a visiting artist could pay, so
  they need the organiser rather than a better parser.
- **What "the network" lens ranks on.** Currently the ten factor ratings.
  Ranking on reported net is the obvious next lens and needs a decision about
  comparing a $900 booth weekend against a $2,400 one fairly.
- **Whether the Worker gets deployed before Phase 6.** Nothing in phases 1–5
  needs it; everything in Phase 6 does.

- **Whether local sales tax rates are worth buying.** Phase 1 established that
  no free, keyless, CORS-permitting source for combined local rates exists. The
  options are: leave it as it is (state rate plus a link to the state's own
  lookup, which is honest and is what shipped), pay for a rate API and proxy it
  through the Worker so the key stays server-side, or capture rates per show
  once a year by hand. The middle option is the only one that gets an artist a
  number they can collect, and it needs the Worker deployed first.

---

## 7. The accounting suite — mapped, not started

Asked for as "sales detail per show, and ways to follow up with clients". Not new
territory: it is ideas 8, 12–16, 18–20 and 22 pulled out of Phases 2 and 4 into
one coherent build. This section is a working document — add to it.

### The structural decision that governs everything else

A show is one flat record (`makeShow` in `core.js`) with `juryFee` and `boothFee`
as scalars, in one array under one localStorage key, synced last-write-wins on
`updatedAt`.

A sale is not a property of a show. It is a **child record** — many per show, each
independently editable, each with its own timestamp. Adding those breaks three
things that currently work:

1. **Last-write-wins sync becomes lossy.** Two devices each add a different sale
   to the same show; the second push wins and the first sale is gone. Acceptable
   for a status change. Not for money.
2. **localStorage has no eviction story.** A season of shows is a few KB. A season
   of individual sales, contacts and mileage entries is a different order.
3. **Migrations stop being cheap.** The existing ones reshape a small flat array.
   A bad migration over financial records costs someone their tax year, not their
   preferences.

**Decide before writing any of Stage 2+:** do sales become child records with
their own ids and `updatedAt`, in sibling collections keyed by `showId`?
Recommendation: yes — more work up front, and the only shape that survives sync,
export and an audit.

### Staging — each stage is useful on its own

**Stage 1 — the post-show number.** One field per show: gross sales. Delivers
landed cost (8) and break-even (13) immediately, since booth and jury fees are
already in the model. No new record types, no migration risk. The smallest thing
that answers "did that show pay for itself".

**Stage 2 — the expense log (18).** Mileage, lodging, food, materials. Schedule C
categories from the start — retrofitting tax categories onto a year of
uncategorised rows is miserable. First child-record collection, so this is where
the sync question above has to actually be answered.

**Stage 3 — individual sales (15, 19).** Piece, price, size, medium, date, payment
method. Sell-through becomes real and feeds back into the fit model. Square/Stripe
CSV import belongs here; manual entry at a show is a thing nobody does.

**Stage 4 — contacts and follow-up (20, 22).** Name, email, what they looked at,
what they bought or did not, when to follow up. Deliberately last: a CRM with no
sales history behind it is an address book.

### Why Stage 3 is the one that matters

Stages 1–2 are bookkeeping a spreadsheet already does. Stage 3 is where the
artist's own numbers start improving the recommendations — sell-through by price
band and region beats any editorial fit score at predicting the next show. That
loop is what earns a weekly open, and it becomes idea 24 once there are members.

### Two constraints specific to this suite

- **The honesty rules invert.** Elsewhere the rule is "never show a number we do
  not have". Here the numbers are the artist's own and are the most reliable data
  in the system — but derived figures (break-even, expected value, projected net)
  are model output wearing a currency sign, and need the same provenance
  discipline the fit scores get.
- **Never answer "is this deductible?"** A Schedule C-shaped log invites the
  question. Categorising a row is not tax advice; telling someone it is deductible
  is. Draw that line in the UI before writing the log.

### Open questions for this suite

- Child records vs denormalised. Blocks Stages 2–4.
- Does the expense log need multi-year scoping, or is one season enough?
- If the Worker is deployed, do contacts sync or stay device-only? Other people's
  contact details raise a higher bar than show notes.
- Does Stage 1's gross-sales field belong on the show record or wait for Stage 3
  so there is only ever one place a sales figure lives?
