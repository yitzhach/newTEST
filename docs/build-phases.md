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
| 27 | Ask about this show — AI answers grounded in the show record | See §8. Not built |
| 28 | Dinero handoff — the tracker feeds a real accounting app | See §9. Not built |

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

## 6a. Saved rankings — shipped

Not one of the 26 numbered ideas; it came out of a later conversation and is
recorded here because it changes what several of them mean.

An artist builds their own weighting over the ten factors, names it, and ranks
the catalogue by it. It is a thin layer over `fit.js` — `customWeights` already
existed and already overrode the presets, so a ranking compiles to a normal fit
profile and goes through the audited scoring path. Nothing in `ranker.js`
scores a show.

Three decisions worth not relitigating:

- **Private by default, per record.** Artists guard their show lists. `shared`
  starts false and the export payload carries criteria only — never shows,
  calendar, applications or fees.
- **Sharing is a file today.** The network transport needs the Worker; the
  control is present and visibly disabled. Export/import is the working half.
- **An import is untrusted input and is validated as such.** The payload names
  the factor list its weights were written against, and a mismatch is refused.
  Weights are positional: a quiet mismatch produces a plausible wrong ranking,
  which is worse than a refusal.

This is also where idea 24 (peer benchmarking) starts looking different. A
shared ranking is the thing members would compare *through* — "shows that rank
well on Lisa's list" is a more useful network query than a global average, and
it needs no reported results to be interesting. Worth weighing when Phase 6 is
specified.

The **AI-refinement seam** is `explain()` and `applySuggestion()` in
`ranker.js`. `explain()` already returns the ranking as structured deltas
against the preset baseline, which is the input an assistant needs; nothing
calls a model, and no network egress exists in that file. If refinement is
built, note that §3's finding still holds — a model's suggestion about *this
artist's preferences* is fine, but a model's claim about *a show's facts* earns
`search` at best and never `verified`.

---

## 6b. Mock jury review — scaffolded, plumbing absent

Not one of the 26 ideas. A paid review: the artist submits images and a
question, a recruited juror scores and writes back.

Decided with the owner and worth not relitigating:

- **Real jurors**, recruited and paid — not AI, and not a self-scoring rubric.
- **Nothing is owed until a juror claims the request.** The status flow
  (draft -> requested -> claimed -> returned) exists to carry that rule, and
  `chargeableAt()` encodes it so it survives being forgotten.
- **Written feedback plus a score out of 10.** No live calls, no annotation
  tool; both were considered and deferred as disproportionate.
- **A juror's score never sits beside a show's published jury odds** and never
  enters the fit model. Same layer discipline as facts/editorial/intel.

Three things block it, all the same block: **the Worker is undeployed**, so
there is no image storage (R2), no transport to reach a juror, and no billing.
The page is built and honest about all three. `canUpload()` and `canSubmit()`
return false from one place each.

This is now the third feature waiting on that deployment, alongside Phase 6 and
network sharing of rankings. Deploying it has become the highest-leverage
infrastructure task in the project.

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

> **Stage 1 shipped.** Gross sales are a scalar on the show record
> (`grossSales`, null = not recorded), which answers the open question below:
> one figure per show per season already has a scalar's shape, and sales one at
> a time are Stage 3's child records, not this. When Stage 3 lands, this field
> stays the artist's stated total and the rows are the detail; if the two
> disagree the page must say which it is showing rather than picking one.
> It is local-only — see `store-supabase.js` for why.
>
> **Stage 3 shipped** (`tracker/sales.js`, on the same page). The open question
> at the top of this section — child records or denormalised — is now answered
> in code for the fifth time: child records, local-only, same envelope.
>
> **Stage 2 shipped** (`tracker/expenses.html`). The sync question below was
> answered by the pipeline, not here: child records, local-only, same envelope.
> Stage 1's gross-sales field is still open and is what trending waits on.

**Stage 1 — the post-show number. SHIPPED.** One field per show: gross sales. Delivers
landed cost (8) and break-even (13) immediately, since booth and jury fees are
already in the model. No new record types, no migration risk. The smallest thing
that answers "did that show pay for itself".

**Stage 2 — the expense log (18).** Mileage, lodging, food, materials. Schedule C
categories from the start — retrofitting tax categories onto a year of
uncategorised rows is miserable. First child-record collection, so this is where
the sync question above has to actually be answered.

**Stage 3 — individual sales (15, 19). SHIPPED.** Piece, price, size, medium, date,
payment method, quantity — one row per sale per show, the fifth child collection
(`sales`, v9 → v10). Square/Stripe CSV import is in `sales.js` and is treated as
untrusted input: an unrecognised file is refused whole rather than
column-guessed, a refund is skipped with its reason, a row with no readable
amount imports unpriced instead of as $0, and the processor's transaction id is
kept so re-importing the same export updates rows instead of doubling a season.

Two things came out differently from the plan:

- **Sell-through quotes no rate.** The figure everybody means is sold ÷ brought,
  and nothing in the app records how many pieces went in the van. So the mix by
  price band and by state is reported in full, and `rate` stays null with the
  missing input named. `sellThrough` takes a `piecesBrought` for the day
  something records it.
- **The stated total and the rows are two records, not one.** Stage 1's
  `grossSales` is never recomputed from the rows and the rows are never derived
  from it. `ASTSales.reconcile` returns both, plus `showing`, which names the
  figure a headline came from; where both exist a net is built on the stated
  total (the artist's assertion about the whole weekend) and the page reports
  the pair and the difference. The v9 → v10 migration backfills nothing at all:
  splitting one stated total into rows would invent pieces, prices, sizes and
  dates in the collection that has to survive an audit.

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

- ~~Child records vs denormalised. Blocks Stages 2–4.~~ Answered: child records,
  and Stages 2 and 3 both shipped on that shape.
- Does the expense log need multi-year scoping, or is one season enough?
- If the Worker is deployed, do contacts sync or stay device-only? Other people's
  contact details raise a higher bar than show notes.
- ~~Does Stage 1's gross-sales field belong on the show record or wait for
  Stage 3?~~ Answered: on the show record. See the Stage 1 note above.

---

## 8. "Ask about this show" — an AI answer in the drawer. NOT BUILT.

Asked for as: an artist opens a show, taps a chat control in the drawer, and
asks a question about *that show* — "how many images does this one want?",
"if I take a double, is the corner included or is that a separate add-on?",
"what does the prospectus say about tents?" — and gets a straight answer
instead of reading four screens.

Parked deliberately. Nothing below is a commitment to build it, and none of it
is started. This section exists so the next session does not re-derive it.

### Why it fits here, and why it is dangerous

It fits because the drawer already holds the answer to most of those questions
and the artist still has to go and find it. Booth fees, jury statistics, the fee
schedule, sales tax, the dates, the weather — all of it is loaded on the page
when they open it. The gap is retrieval, not knowledge.

It is dangerous because it is the first feature in this app where a **confident
sentence can be produced with no source behind it**, which is the exact failure
every rule in `CLAUDE.md` was written to prevent. A wrong booth fee costs money.
A wrong image count costs an application. "The double includes the corner" is a
sentence a language model will happily write about a show whose prospectus says
the opposite, and the artist has no way to tell the two apart.

So the constraint is not "add a chat box". It is:

**The model may only answer from the show record, and every answer carries the
same provenance grade the underlying fact carries.** If `boothFeeCorner` is
null, the answer is "not known" — the same words the drawer already uses — and
the model is not permitted to reach for a plausible number. If the fact came in
at `search` grade, the answer says "unconfirmed" the way the drawer does. A
`verified` fact is the only kind that gets stated flatly.

That means the useful shape is **retrieval over the record we already have**,
not a general question-answering model let loose on the topic of art shows.
The show's own JSON, its research row, its fee schedule text and its intel go
in as context; the answer comes back citing which field it used; anything not
in that context is answered "the record does not say", with a link to the
show's own page so the artist can go and read it.

### What it would take

- **A server.** An API key cannot ship in `tracker/`, which is classic scripts
  a browser hands the user in plain text. The Cloudflare Worker is already
  built, already holds D1/KV/R2, and is **undeployed** — it is the obvious
  home, and this feature is a second reason to deploy it. See
  `worker/README.md`. Nothing about this can be done client-side.
- **A context builder.** Almost certainly DOM-free in `tracker/`, alongside
  `fit.js` and `sales.js`: given a show, assemble exactly the facts, their
  provenance grades and their source URLs, and hand back a bounded payload.
  This is the honest half of the feature and it is testable without any model
  at all — which is where it should start.
- **An answer contract.** Cited field, provenance grade, and an explicit "not
  in the record" path. Tests assert the refusals, the way `jury-tests.cjs` and
  `expense-tests.cjs` already do: a null fact must not come back as a number,
  and a `search`-grade fact must not come back stated flatly.
- **A model, and what it costs.** Undecided on purpose. Both are moving
  targets and writing today's answer into this file guarantees it is wrong by
  the time somebody reads it. Decide it when it is built, from current docs.

### The paid-tier part

The request was for this to sit behind the full feature set. **There is still no
billing in this project** — no accounts, no entitlement, no payment — and that
does not change by adding an AI feature. So the first thing that ships is a
`plan.js` preview card, disabled, saying what it would do, with no price, no
plan name and no sign-up, exactly like the other five. The entitlement check is
a later, separate piece of work, and until it exists a control that looked
purchasable would be a false offer.

### The "own database" idea

Also raised: eventually building our own question-and-answer set over the shows
rather than answering from the record each time.

That is worth writing down and worth leaving alone for now. Its real value is
the same as the network ideas (23–26) — it becomes worth something once there
are members generating answers nobody else has. Before then it is a cache of
answers derived from the same catalogue the app already ships, with a second
copy of every provenance decision to keep in step, and staleness that nobody
would notice: a show changes its image requirement and the stored answer keeps
confidently giving last year's. Answering from the live record has none of
those problems. Revisit it when there are members and the answers start coming
from artists rather than from the prospectus.

---

## 9. The Dinero handoff — the tracker feeds a real accounting app. NOT BUILT.

**The app:** https://dinero-art.bobdylan2000.workers.dev/ — a separate
Cloudflare Worker, owned by the same person, and **not in this repo**.

Asked for as two things, and they are two very different sizes of job:

1. **Go there to do the actual accounting.** The Money page covers a season:
   what a show cost, what it took, whether it paid for itself. Real
   bookkeeping — a chart of accounts, a tax year, invoices, reconciliation —
   is a different application, and the tracker should hand off to it rather
   than grow into it.
2. **Eventually, what is entered here builds up over there automatically**, as
   an upgrade for clients doing more than the basic tier.

### What is known, and what is not

Nothing about the Dinero app has been inspected from this repo — the sandbox
has no web egress, so its pages, its data model and whether it has an API at
all are **unverified**. Do not write code against an assumed shape. The first
job in any session picking this up is to open it and write down what is
actually there.

Open, and blocking the interesting half:

- Does it have an HTTP API, or only a UI? If only a UI, the handoff is an
  export file the artist uploads, not a sync.
- Does it have accounts? Sync needs a way to say *whose* books these are, and
  the tracker has no accounts at all today.
- What are its records called? Ours are `expenses` and `sales` with a
  `showId`. A show is not an accounting concept, and something has to decide
  whether a show becomes a class, a job, a project or a tag.

### Stage 1 — the link. Small, and worth doing first.

Add it to `nav.js`'s `PAGES` array with a note saying what it is, and to the
Money page. That is the whole change: one array entry plus a link. It is an
**external site**, so it must look like one — `rel="noopener"` and say where it
goes, because a menu that silently leaves the app is a menu that lost you.

No data moves in Stage 1, and the menu must not imply any does.

### Stage 2 — the export handoff. The honest middle step.

The Money page already exports expenses and sales as CSV. If Dinero can import
a CSV, most of the value lands with no integration at all: the artist exports,
uploads, done. Worth checking before building anything, because a working
manual handoff beats a broken automatic one.

### Stage 3 — the sync. The upgrade, and where the care goes.

This is the first time data in this app would leave the device, and that
crosses the line the whole project is built on: **local-first, private by
default, nothing sent unless deliberately exported.** So:

- **Opt-in, explicit, per-artist.** Not a setting that defaults on. The tracker
  has never sent a row anywhere; the first time it does, the artist must have
  said so in words.
- **One direction to start: tracker → Dinero.** Two-way sync means conflict
  resolution over financial records, and last-write-wins is already ruled out
  for money in §7. Push only, until there is a reason not to.
- **Every row keeps its origin.** A row that arrived from the tracker says so,
  the way an imported sale already says it came from Square. Re-pushing must
  update the row it already made, not add a second one — the same
  `externalId` discipline `sales.js` already uses for Square and Stripe.
- **Nothing is derived on the way over.** Send what the artist entered. Net,
  break-even and expected value are model output wearing a currency sign, and
  they must not land in a ledger as if they were transactions.
- **A failed push says so.** No silent queue that looks like it worked. Same
  rule as the calendar's reminders: nothing claims to have been sent.
- **Credentials cannot ship in `tracker/`.** Classic scripts the browser hands
  over as plain text. Anything holding a key runs in a Worker.

### The tier question

"An upgrade for clients who do more than the basic tier" — **there is still no
billing in this project.** No accounts, no entitlement check, no payment. So
Stage 3 lands first as a disabled `plan.js` card, no price, no plan name, no
sign-up, like the other five. `accountant_export` is already in that list and
is arguably this feature's placeholder — decide whether it becomes this or
stays separate.

Stages 1 and 2 are **not** paid features and should not be gated. A link is a
link.
