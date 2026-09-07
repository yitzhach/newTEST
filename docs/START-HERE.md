# START HERE

Read `docs/handoff.md` first — it is authoritative for the model, the three
data layers, the honesty constraints, the file map and the open threads. This
file is the shorter thing: what is done, what to do next, and what the
environment will get wrong if nobody warns it.

Live: https://yitzhach.github.io/newTEST/tracker/browse.html

---

## Fresh-chat prompt

Paste this at the top of a new session, then say what you want:

> Working on the members' intel network in `yitzhach/newTEST`.
>
> Read `docs/handoff.md` first and treat it as authoritative — it covers the
> model, the three data layers, the honesty constraints, the file map and the
> open threads. Don't re-derive any of it, and don't re-read the whole
> codebase; open only the files you need to change. Then read
> `docs/START-HERE.md` for what's done, what's next, and the environment
> gotchas.
>
> For buildout work, `docs/build-phases.md` has the phase map and the
> per-phase prompt.
>
> Live site: https://yitzhach.github.io/newTEST/tracker/browse.html
>
> Run the three test suites before you finish, and push.
>
> What I want to work on: …

That points a cold session at two files instead of forty.

---

## What is done

Merged to `main` and live:

- **PR #1** — members' intel network: fit ranking by discipline, artist
  reports, the Cloudflare backend.
- **PR #2** — ledger view: details on the name, three scoring lenses, report
  badges.

So: ten factors, ten disciplines, four price bands, five season strategies,
three scoring lenses, 236 shows, member reports with three privacy tiers and a
tone check, and a complete Worker + D1 backend.

The site runs in **solo mode**. Everything works, nothing is shared — every
report stays in the browser and behaves as private.

### The practice show

`build/test-show.json` is one fictitious record — Seattle "This is a Test"
Festival — so an artist can file a report, try the lenses and open every panel
without touching notes on a show they might really apply to. It is kept in its
own input file so it can never be confused with a real one and can be deleted
in a single step, and every field on it carries a `fixture` provenance status
that renders as a loud TEST DATA chip. It is tagged in the list and banners
itself at the top of its drawer. A fabricated row in a database whose whole
premise is "never let an estimate pass as a fact" has to be unmistakable.

### The ledger opens the same drawer

Clicking a show's **name** in the ledger (or the `i` button beside the eye)
opens the fit/intel breakdown the catalogue shows; clicking anywhere else on
the row still opens the edit pane, which is where the personal fields live. A
show typed in by hand has no catalogue record, and says so rather than
guessing from the name.

### Phase 1 of the buildout — done, on `claude/phase-1-build-134uv0`

**Data hygiene.** 12 shows carried a jury notification date earlier than their
own application deadline, which is impossible — a previous edition's date
carried forward. The build now drops those to "not known" rather than guessing
a year forward, and stops outright on anything it cannot repair honestly (a
date it cannot parse, a show that ends before it starts, a deadline after the
show is over). A deadline that has merely *passed* is not a build error — the
calendar moves on its own — so it is reported at build time and raised at
runtime instead: `fit.js gates()` has a new `closed` level, and closed shows
sink in the fit ranking rather than being offered as live opportunities.

**Geocoding.** 234 of 236 shows now carry coordinates, up from 0. The two
without are rows whose city column holds a region rather than a city, and are
left null. `geonamescache` turned out to be the wrong tool — it floors at
population 15,001 and missed 28% of these shows, because art fairs happen in
small resort towns — so the gazetteer is the `zipcodes` package instead. The
lookup runs in `build/geocode_shows.py` and its output is committed as
`build/geocode.json`, so the build has no geocoding dependency. Coordinates
reach `catalogue.json` too, which means a show added to the ledger now arrives
pinned on the map.

**Weather.** A drawer panel with one card per show day: high, low, wind, and
what the sky was doing. Which question it answers depends on how far away the
show is — inside a fortnight it is the **real forecast**, and beyond that it is
**what these same calendar dates have done over ten years**, each day averaged
against the same date in every year. The panel says which of the two it got,
because "76 on Saturday" and "76 on an average Saturday in early March" are
different claims and only one is about this year. Fetched at runtime from the
visitor's browser — the container has no egress and the deployed site does —
cached per show, and it fails closed to "not known".

**Sales tax and permits.** A drawer panel per state: the state rate, what
local jurisdictions add on top, the state's own address lookup, how a visiting
artist registers, and the trap specific to that state. It **never publishes a
combined rate** — see the note below.

New provenance grade: `dataset`, for a value looked up in a reference dataset
rather than read off a show's page. Coordinates and weather carry it.

### The ZAPPlication research pass — 100 shows deep

`build/show-research-source.xlsx` is a research spreadsheet: 236 rows, 34
columns, 213 of them carrying research with things that exist only on a show's
own event page. Every enriched row carries its ZAPP URL, and the event id in
that URL is the id the catalogue already uses — so the join is exact, 100 of
100. `build/import_show_research.py` parses it into `build/show-research.json`,
which the build folds in.

What it moved:

| | before | after |
|---|---|---|
| booth fee (single) | 24/236 | **179/237** |
| booth fee (double) | 0/236 | **87/237** |
| booth fee (corner) | 0/236 | **88/237** |
| jury odds scored | 37/236 | **220/237** |
| jury statistics | 0/236 | **203/237** |

Booth fee coverage was what blocked Phase 2 costing. It is no longer the
blocker.

Two decisions inside the importer worth knowing about, both about not
overclaiming:

- **It leaves `commissionPct` null.** All 100 enriched rows say "No commission
  mentioned — booth-fee model", and *not mentioned* is not *zero*. The wording
  is passed through as `commissionNote` instead. An artist who reads "0%" and
  then loses 15% at the door has been misled by this repository.
- **A corner quoted as a surcharge becomes a total.** Shows write corners two
  ways — `Corner Booth: $700` and `Corner upgrade: $100` — and they differ by a
  factor of seven. The importer tells them apart and adds a surcharge to the
  single, because the number an artist compares between shows is what leaves
  their bank account. A corner that comes out cheaper than a plain booth is
  treated as a surcharge whatever the wording said; that arithmetic backstop
  catches phrasings nobody anticipated.
- **A booth fee cites the line it came from.** The raw field is a whole fee
  schedule — singles, corners, doubles, food stalls, electrical hookups, late
  penalties — so picking "the" fee is an interpretation. The parser records the
  number, the schedule line it read it from, and the full schedule, and the
  drawer shows all three. 84 of 100 schedules yielded a confident standard
  rate; the rest keep the text and claim no number. An audit pass while writing
  it caught the parser reading "Ad in Event Program: Add $75" and a $60
  membership as booth fees, which is why the tests assert the coverage numbers.

**Getting in**, a new drawer section, is the payoff: how many apply, how many
are accepted, how many of those places never faced the jury, and what that
leaves. A show that accepts 65 of 100 looks generous until you learn 20 of
those places went to exempt artists — applying cold you are competing for 45,
not 65. `effectiveAcceptanceRatePct` is what feeds the jury-odds factor.

### The one thing to know about the sales tax panel

It carries the **state rate only** and says so in those words, because the
number an artist actually collects is state + county + city + special district
and the local part cannot be sourced honestly from here. There is no keyless,
CORS-permitting national rate API, and no offline dataset of local rates that
would still be right next quarter. So the panel leads with the caveat, links
to the state's own address lookup, and says plainly that it is not tax advice.

Three states — **Ohio, Utah and Wyoming** — ship with a null rate. Utah is the
instructive one: the search summary blended the reduced grocery rate into the
general rate. That is exactly the failure the honesty rules exist to catch, and
null was the right answer.

## What is next

**Phase 3** — see `docs/build-phases.md`. Phase 2 is blocked on booth fee
coverage; Phase 3 is not blocked and is the commercial keystone (the
application pipeline is the first thing that earns a weekly open). Phase 5's
route planner is now unblocked too, since the geocode landed.

The Worker deploy is separate and blocks only Phase 6. **Deploy it when the
network layer matters.** Nothing is shared between artists yet, and that is the
whole premise. `worker/README.md` has the full sequence: create D1 + KV + R2,
paste the two ids into `wrangler.toml`, set `SESSION_SECRET`, `IP_SALT` and
`BOOTSTRAP_CODE` as secrets, apply migrations, set `ALLOWED_ORIGINS`, deploy,
then paste the Worker URL into **Network** on the site. The first steward gets
in through `BOOTSTRAP_CODE`, which stops working the moment one member exists.

After that, `docs/handoff.md` §10 has the rest: finishing the research pass,
confirming the 33 estimated dates, per-discipline factor scores, route
planning, images on reports, ranking a lens on reported net.

---

## Environment gotchas

**The sandbox blocks every art-show domain.** `zapplication.org`,
`cherryarts.org`, `naplesart.org` and the rest are refused by the egress
policy. Research runs through web search, which synthesises from results
rather than reading pages. So: **never upgrade a provenance grade to
`verified` without opening the actual page.** `verified` is reserved for
prospectus and application pages read directly, and only the ZAPPlication
export fields have earned it. Search-derived facts are `search`, and render as
*"unconfirmed"*. `record_research.py` rejects any batch missing provenance —
do not route around it.

**Pages deploys from `main` only.** `.github/workflows/static.yml` triggers on
push to `main` (or manual dispatch), uploads the whole repo, and deploys it
through the Pages Actions source. Work lands on the live site when it merges —
push to `main`, wait about a minute, refresh. No repository settings involved.

*A note for the next session, so nobody repeats it:* this was briefly replaced
with a `gh-pages` branch deploy in order to give every pull request its own
preview URL under `/pr-preview/pr-<n>/`. It worked, and the cost was not worth
paying: a Pages site has exactly one source, so switching to branch-based
previews meant the live site stopped updating until somebody changed
**Settings → Pages** by hand. Reverted. The preview machinery is in git
history at `2a7e6bf` if it is ever wanted — but it needs that settings change,
and it should not be reintroduced without the repo owner making it first.

**No build step, deliberately.** `tracker/` is plain HTML, CSS and JS served
as-is; the Worker is plain modules. The Vite/React app at the repo root
(`App.tsx`, `index.tsx`, `vite.config.ts`) is the separate artist site and is
not part of the tracker — do not wire the two together.

**One build script, and it writes two files.** After any data edit:

```bash
python3 build/build_fit_data.py     # rewrites tracker/fit-data.json AND tracker/catalogue.json
```

`build/catalogue-source.json` is the pristine ZAPP export. Read-only input,
never written to.

The build also runs the date rules on every row, prints what it repaired, and
exits non-zero on anything it cannot repair. `python3 build/build_fit_data.py
--selftest` exercises those rules against constructed inputs without touching
the data.

**The research import is a separate, occasional step**, like the geocode.
`build/show-research.json` is committed and the build just reads it. Re-run it
only when the spreadsheet changes:

```bash
pip install openpyxl
python3 build/import_show_research.py    # rewrites build/show-research.json
python3 build/build_fit_data.py          # folds it in
```

**Geocoding is a separate, occasional step.** `build/geocode.json` is committed
and the build just reads it, so an ordinary data edit needs nothing extra. Only
when the *show list itself* changes:

```bash
pip install zipcodes
python3 build/build_fit_data.py     # so fit-data.json is current
python3 build/geocode_shows.py      # rewrites build/geocode.json
python3 build/build_fit_data.py     # folds the coordinates in
```

**The weather panel is verified working** on the deployed site — Open-Meteo
needs no key and permits cross-origin requests, confirmed from a browser. The
note below is kept because the reasoning still applies to anything similar.

**The weather API cannot be verified from a container.** `tracker/weather.js`
calls Open-Meteo's historical archive, chosen because it needs no key, permits
cross-origin browser requests and serves daily data back to 1940. None of those
three could be confirmed here, because this environment cannot reach it. The
first person to open the live site should check the panel shows numbers rather
than "not known". If the service turns out to need a key or to refuse the
origin, every call fails closed and swapping providers means changing
`ENDPOINT` and `readDaily()` and nothing else.

---

## The three test suites

Run all three before pushing.

A fresh container has no `node_modules`, so install first. Keep Playwright out
of `package.json` — it is a test-only dependency and the repo has no build step
to justify carrying it:

```bash
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --no-save playwright
cd worker && npm install && cd ..
```

Then:

```bash
python3 -m http.server 8765          # from the repo root, leave running
node build/browser-tests.cjs         # 74 checks — the model, the drawer, provenance,
                                     #   date hygiene, geocode coverage, tax guard
                                     #   rails, the research import
node build/ledger-view-tests.cjs     # 21 checks — details/link split, badges, lenses
cd worker && npm test                # 45 API checks — manages its own worker
python3 build/build_fit_data.py --selftest   # 11 checks — the date rules themselves
```

All pass as of the Phase 1 session: 74/74, 21/21, 45/45, 11/11.

`browser-tests.cjs` deliberately asserts that the weather panel degrades to
"not known": this sandbox blocks the weather API, which makes it the ideal
place to prove the failure path. Both browser suites filter that host out of
their request-failure check so a genuine error still stands out.

`ledger-view-tests.cjs` files a report, so it clears `localStorage` first and
runs standalone. The worker suite starts and stops its own `wrangler dev`.
Chromium is preinstalled at `/opt/pw-browsers` — do not run
`playwright install`.
