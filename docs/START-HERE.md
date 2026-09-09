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
> Before finishing: run the nine suites, then commit, push and merge to `main`.

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

**Three pages, and the differences matter.**

- **`tracker/browse.html`** — the catalogue. 237 shows, fit scores, and the
  intel drawer with everything below.
- **`tracker/calendar.html`** — the calendar. Year, month and an iOS-style day
  view over four switchable layers: your ledger, your **hearted** shortlist,
  the whole catalogue (off by default — 237 shows over your nine is a wall,
  not a calendar) and your own events. Multi-day shows draw as one bar, not a
  chip per day; two shows you are committed to on one weekend raise a clash
  banner. Clicking a day drops into it, an hour there opens an event already
  set to that time, and double-clicking blank space adds one outright.
  A bar opens the same drawer, `#2027-01-09/day` deep-links a date, and
  **Export .ics** is the working half of "connect your calendar" — the Google /
  Apple / Outlook and email / text buttons are present and visibly disabled,
  because a control that does nothing must look like it does nothing.
- **`tracker/index.html`** — the ledger: your own shows, the map, the route,
  the Edit Show pane. Clicking a show's **name** (or the `i` button) opens the
  same drawer the catalogue shows; clicking anywhere else on the row opens the
  edit pane.

**The heart is one shortlist, in three places.** Heart a show in All shows or
from the calendar's quick look; it lands under the **Hearted** quick filter in
`browse.html` (which carries a live count, and which the calendar links
straight to with `browse.html#hearted`), and it draws on the calendar's own
Hearted layer without needing the whole catalogue switched on. Hearts are
stored per catalogue record in `artShowTracker.catalogue`, so a show added to
the ledger stays hearted and a re-import never costs you your picks. A
hand-added show has no catalogue record and therefore cannot be hearted.

**The application pipeline is a child collection, not fields on a show.**
A show's `status` is where it stands now; an application is what you *did*, and
when — one record per show per season, so applying again next year is a second
row rather than an overwrite. That shape is what lets the jury fee tracker add
anything up, and it is the pattern the expense log and the sales records in
`build-phases.md` §7 are meant to reuse. Applications are **local-only**, exactly
like calendar events: `store-supabase.js` still syncs only the `shows` table, and
`AST.Store` degrades to the local backend for anything a backend does not
implement, so the pipeline works today against a Supabase account that has no
`applications` table.

Three numbers come out of it, and each one refuses to guess:

| | |
|---|---|
| **Jury fee spend** | Total, acceptances, and what one acceptance cost. Counts only fees actually recorded, and says "known fees only, 9 of 22" whenever those disagree — a partial total that does not admit it is partial is how somebody budgets on a wrong number |
| **Your acceptance rate** | Withdrawing is not the jury saying no, so withdrawn applications leave the denominator. Below eight judged applications it declines to quote a rate at all |
| **Expected value** | P(accept) × (your gross estimate − booth) − jury fee. Nothing in the catalogue knows what you would gross, so with no estimate it renders what it is *missing* rather than a number. Your own rate overrides the published one once there is enough history |

The v4 → v5 migration backfills an application for every show already past
"interested", because a show marked Accepted is evidence one happened. The
**dates stay empty**: we know it happened, we do not know when, and a plausible
date would be a fabrication in the one collection that has to survive an audit.

**Saved rankings — "Lisa's list".** The profile bar is one implicit set of
criteria; a *ranking* makes them named, plural and portable. An artist weights
the ten factors themselves, saves it under a name, and switches between them
from the catalogue's Rank-by picker. It compiles down to a normal fit profile
and goes through `FIT.scoreShow` — there is no second scorer, because a second
scorer would be a second set of honesty rules to keep in step.

- **Private is the only default.** `shared` starts false, nothing leaves the
  device unless deliberately exported, and the exported payload carries the
  criteria *only* — no shows, calendar, applications or fees. A ranking says
  what somebody values; it must not say where they will be standing in June.
- **Sharing to the network has no transport yet** — it needs the Worker. The
  control ships visibly disabled and says so, the way the calendar's Google and
  Apple buttons do. Export/import a file is the half that works today.
- **An import is untrusted input.** The payload names the factor list its
  weights were written against, and a mismatch is *refused* rather than
  applied: weights are positional, so a quiet mismatch would produce a ranking
  that looks plausible and is wrong. Wrong format, wrong version, wrong length
  and junk are all refused with a message. Out-of-range weights clamp.
- **An imported ranking stays marked imported**, with whose it was, for as long
  as it exists. Somebody else's judgment does not quietly become yours.
- **A factor dragged to zero drops out of the average** — it does not score 5.
  That is the existing model rule, and the editor shows a zeroed factor struck
  through so it reads as *out*, not merely unimportant.
- **"Back to the presets" stores null**, not a frozen copy of today's preset
  numbers, so a later change to the model still reaches the ranking.

`ranker.js` also carries the **AI-refinement seam**: `explain()` returns the
ranking as structured deltas against the preset baseline — which factors are up,
which are down — and `applySuggestion()` is the single place a suggestion would
be merged back, through the same clamping as every other write. Neither calls a
model today and there is no network transport in that file.

**The expense log — `tracker/expenses.html`, reached from the ledger.** §7 Stage 2.
Mileage, fuel, lodging, meals, booth and jury fees, supplies, shipping,
commission. Fourth use of the child-record pattern, so the shape is now settled.

- **An uncosted row is `null`, never `$0`**, and it renders "not costed". Every
  total reports `known` of `total` and says "known figures only — 3 rows have no
  amount yet" whenever those differ.
- **No mileage rate ships with the app.** The artist enters their own, stored
  per row. A hardcoded federal rate goes stale the moment the year turns, and
  this is a number that costs money when it is wrong.
- **Mileage and fuel are both kept and never merged.** They are two ways of
  accounting for the same driving; the page says both are present and leaves
  the choice to the artist's bookkeeper.
- **Nothing is ever called deductible.** Categorising a row is bookkeeping;
  the other thing is advice. There is a test asserting the word never appears.
- **Listed fees are not backfilled.** A show's `boothFee` is what the artist
  *expects* to pay; an expense row is money that *left*. Converting one to the
  other would invent a payment.

**The post-show number — gross sales.** §7 Stage 1. One field on the show
itself, in the ledger's edit pane: what the weekend actually took, before any
commission. The Money page turns it into "did it pay for itself" — per show and
across the season.

- **Blank is "not recorded", never $0.** A show that took nothing and a show
  nobody has added up are different weekends, and a zero would turn every
  unrecorded show into a loss. Nothing is backfilled by the v8 → v9 migration.
- **A net over a partial expense total is provisional and says so.** Uncosted
  rows can only push the real figure down, so it is a ceiling, not a result;
  `cleared` stays null until every row carries an amount.
- **A show with no gross drops out of the season net** rather than being added
  in as zero, exactly like an unscored factor dropping out of the average.
- **It is local-only.** The Supabase `shows` table has no `gross_sales`
  column, and sending one would break every upsert — costing somebody their
  sync to gain a field. `store-supabase.js` says where to add it if the column
  is ever created.
- **Commission still follows the catalogue rule.** No commission recorded means
  none is subtracted and the page says the figure is *before* whatever the show
  takes.

**Individual sales — the same Money page.** §7 Stage 3, ideas 15 and 19. One row
per sale per show: piece, price, size, medium, date, payment method, quantity.
Fifth use of the child-record pattern, and the one it was chosen for — two
devices each selling a different piece on the same Saturday must merge as a
union, because last-write-wins here loses somebody a sale.

- **An unpriced sale is `null`, never `$0`**, and it renders "not priced". Every
  total says how many rows carried a price, exactly like the expense log.
- **The stated gross and the sale rows are two records, not one.** Stage 1's
  `grossSales` is what the artist said the weekend took; the rows are what they
  wrote down piece by piece. They are collected at different moments and they
  *will* disagree — a cash sale nobody logged, a refund, a correction. Neither
  is authoritative. `reconcile` returns both plus the difference, and the page
  **says which figure it is showing** rather than picking one silently. A show
  with no stated total is now answerable from its rows, and says that too.
- **Nothing is backfilled by the v9 → v10 migration.** Splitting one stated
  total into rows would invent pieces, prices, sizes and dates in the one
  collection that has to survive an audit.
- **Sell-through quotes no rate.** The figure everybody means is sold ÷ brought,
  and nothing here records how many pieces went in the van. The mix by price
  band and by state is reported in full; the rate stays null and names what it
  is missing. Hand it a real `piecesBrought` and it will quote one.
- **A sale with no show is still a sale** — a studio sale in February — and it
  lands in an explicit "Not known" region bucket rather than being filed under
  a weekend it did not happen at.

**Square / Stripe CSV import.** Manual entry at a booth is a thing nobody does,
so the card reader's export is how rows realistically arrive. It is **untrusted
input** and is treated the way the ranking importer treats one:

- **An unrecognised file is refused whole**, not column-guessed. Guessing at the
  columns of an unknown file puts wrong prices in a sales log.
- **A refund is skipped with its reason**, and so is a Stripe row that never
  completed. A refund is not a sale, and subtracting it from a season it was
  never added to would be worse.
- **A row with no readable amount imports unpriced**, not as $0, and the report
  says how many did.
- **The processor's transaction id is kept**, so re-importing the same export
  updates the rows it already made instead of doubling the season's takings.
  Rows with no id are counted and the artist is told they cannot be matched.
- **An imported row stays marked as imported**, with which processor, for as
  long as it exists. The file is read on the device; nothing is uploaded.

**Lodging finds.** Where an artist parked or stayed free or cheap, recorded on
the lodging expense row itself so nobody types the place twice. Free /
discounted / paid, nights, and two tri-state flags — overnight parking and
van-or-RV room — where `null` means *nobody checked*, because "no overnight
parking" and "we don't know" are different answers and one of them gets somebody
moved on at 2am. Each find is **private unless explicitly marked shareable**,
and sharing has no transport yet, so the flag only marks the row. A show the
artist has never stayed at scores `null`, not "expensive".

**Pro previews — `plan.js`.** There is **no billing in this project**: no
accounts, no entitlement, no payment. A planned feature renders as a disabled
card saying what it would do and that plans do not exist yet. It never shows a
price, plan name, trial or sign-up, because quoting a price for something that
cannot be bought is a false offer. Currently previewed: accountant export,
negotiating help, art representative, shared logistics, mock jury review.

**Mock jury — `tracker/jury.html`.** An artist assembles a submission (five
works and a booth shot by default, plus what they want looked at), a juror
scores it out of 10 and writes back. **The scaffolding is built; none of the
plumbing exists**, and the page says so in a banner before anybody spends time
on it:

- **No image storage.** The Worker holding R2 is undeployed, so an image is
  *described*, never uploaded. `makeReviewImage` forces `stored: false` even if
  handed `true`, so no record can claim a file exists.
- **No transport.** A request cannot reach a juror. "Send to a juror" is
  disabled and submissions stay drafts. Nothing claims to have been sent — the
  same rule the calendar's reminders follow.
- **No billing.** `chargeableAt()` returns null until `claimedAt` is set, so
  **nothing is owed until a juror has claimed the request**. That was a
  deliberate choice: an artist is never charged for work that has not started.

Two rules that outlive the plumbing:

- **A juror's score is not a show's jury odds.** One is an opinion about your
  images, the other is the show's published data. `SCORE_IS_NOT_ODDS` is the
  sentence the UI uses, `fit.js` is not even loaded on the page, and a review
  score never enters the ranking.
- **An unscored review is null, not 0 and not 5.** A review that came back
  without a number is left out of the average rather than dragging it down.

`canUpload()` and `canSubmit()` are functions, not constants, so deploying the
Worker is a one-line change rather than a hunt.

**Times are picked, not typed.** Fifteen-minute menus labelled the way people
say them, duration chips, and a start that drags the end along keeping the gap.
`<input type="time">` was the wrong control: a format to get wrong, half-typed
values that look valid, and a keyboard on a phone.

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

## The nine suites — run all of them before pushing

```bash
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --no-save playwright   # once
cd worker && npm install && cd ..                                     # once

python3 -m http.server 8765          # leave running
node build/browser-tests.cjs         # 79 — model, drawer, provenance, data hygiene,
                                     #      geocode, tax guard rails, fees, weather, version
node build/ledger-view-tests.cjs     # 31 — details/link split, badges, lenses
node build/calendar-tests.cjs        # 77 — grid, lane packing, clashes, day
                                     #      layout, ics, layers, hearts, the
                                     #      time picker, the stub rules
node build/pipeline-tests.cjs        # 26 — the migration and its backfill, jury
                                     #      fee arithmetic, expected value, the
                                     #      application store, the drawer block
node build/ranker-tests.cjs           # 32 — saved rankings, the weight editor,
                                     #      export, and refusing a bad import
node build/expense-tests.cjs          # 87 — the expense log, mileage, landed
                                     #      cost, lodging finds, individual sales,
                                     #      the price-band and region mix, the
                                     #      stated-gross-vs-rows rule, the
                                     #      Square/Stripe import, Pro previews
node build/jury-tests.cjs             # 33 — mock jury: the money rule, the
                                     #      missing plumbing, score-is-not-odds
cd worker && npm test                # 45 — API; manages its own worker
python3 build/build_fit_data.py --selftest   # 11 — the date rules themselves
```

All green as of this handoff: **79 / 31 / 77 / 26 / 32 / 87 / 33 / 45 / 11**.

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

**§7 Stages 1–3 are shipped.** Sales are now individual rows, so the mix by
price band and by state is real data rather than an editorial guess. What it
does *not* yet do is feed back into `fit.js` — the loop that idea 24 needs is
one function call away and deliberately not wired, because a scorer that quietly
started using the artist's own history would be a second set of honesty rules to
keep in step with the first.

**Parked, and asked for explicitly: "Ask about this show" (idea 27)** — an AI
chat in the drawer answering questions about the show in front of you. Not
built, deliberately. `docs/build-phases.md` §8 is the whole note; the short
version is that it is the first feature here where a confident sentence can be
produced with no source behind it, so it has to answer *from the show record*
with the same provenance grades the drawer already uses, it needs the Worker
deployed because an API key cannot ship in `tracker/`, and it lands first as a
disabled `plan.js` card because there is still no billing in this project.

**Stage 4 (contacts and follow-up, ideas 20 and 22) is next** and is no longer
premature: it now has sales history behind it, which is the whole reason it was
staged last. Other people's contact details raise a higher bar than show notes
— that open question is still open.

**Phase 3 shipped its first three ideas** — the application pipeline (11), the
jury fee spend tracker (12) and expected value on applying (14). Image sets (21)
were deferred: they need file storage, and the Worker holding R2 is undeployed.

Phase 2 is *no longer blocked* — booth fee coverage went 24 → 179, which was the
blocker. Phase 5's route planner is unblocked too, since the geocode landed.

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
