# CLAUDE.md

Art show tracker for one working artist choosing which shows to apply to. Wrong
numbers cost real money, so unknowns stay unknown.

**Read `docs/START-HERE.md` first.** `docs/build-phases.md` is the roadmap.

## Critical rules
- `verified` = a page was actually opened. Search never earns it.
- A fact with no source is `null` and renders "not known" — never a number.
- An unscored factor drops out of the weighted average; never defaults to 5.
- Sales tax: state rate only, labelled. Never a combined figure.
- "Not mentioned" ≠ zero (`commissionPct` stays null).
- 10 is always good for the artist.
- Facts / editorial / member intel are three layers the UI never blurs.
- Calendar layers (ledger / catalogue / personal) are never blurred either, and
  the calendar never copies a show — it reads the ledger and the catalogue.
- A reminder with no delivery channel says so. Nothing claims to have been sent.
- The heart is one shortlist shared by the catalogue and the calendar, stored
  per catalogue record. No catalogue record, no heart.
- An application is a child record, one per show per season — never fields on
  the show. A partial fee total must say it is partial.
- A saved ranking is private by default and never carries shows, calendar,
  applications or fees. An imported one stays marked imported.
- Expenses: an uncosted row is null, never $0, and a total says how many rows
  it could see. No mileage rate ships with the app — the artist sets it.
- Gross sales are one field on the show, null = not recorded, never $0. A net
  over a partial expense total is provisional, and a show with no gross drops
  out of the season net instead of counting as zero.
- A sale is a child record, one row per sale per show, and it never rewrites
  the show's stated gross. Where both exist the page shows both and names which
  figure it is displaying. An unpriced sale is null, never $0. Sell-through
  quotes no rate, because nothing records how many pieces were brought.
- A CSV import is untrusted input: an unknown file is refused whole, refunds
  are skipped, and an imported row stays marked as imported.
- Never say anything is deductible. Categorising a row is bookkeeping.
- A Pro feature is always disabled and never shows a price, plan or sign-up.
  There is no billing in this project.
- Mock jury: a juror's score is never shown as a show's acceptance odds and
  never enters the fit model. Nothing is owed until a juror claims a request.
  No uploads and no transport exist, and the page says so before you start.

## How to report back
Write the summary at the end of a task **80% shorter** than feels natural, and
in **plain language** — assume a beginner engineer. Aim for under ~150 words.

- Lead with what now works, in one sentence.
- Say what broke or was skipped. Never hide it to stay short.
- Cut: restating the ask, design rationale, anything the code comments say,
  anything already said earlier in the session.
- Define a term the first time, or pick a simpler one.
- Detail belongs in the commit message and the docs, not the chat reply.

## Stack
- **`tracker/`** — vanilla classic scripts. No build, no modules, no framework.
  Each publishes one global (`AST`, `ASTCalendar`, `ASTCatalogue`, `ASTIntel`,
  `ASTMembers`, `ASTVersion`, `ASTSupabase`). Opens via `file://` by design.
- **`build/`** — Python 3, stdlib + `openpyxl`/`zipcodes`. Writes JSON to `tracker/`.
- **`worker/`** — Cloudflare Worker, D1 + KV + R2, wrangler 4. Complete, undeployed.
- **Root `App.tsx`, `components/`, `vite.config.ts`** — a *separate* React + Vite
  portfolio site, unrelated to the tracker.

## Architecture
`build/*.py` turns pristine sources (`catalogue-source.json`, the xlsx, overrides)
into `tracker/fit-data.json`, `catalogue.json`, `version.json`. The browser reads
those flat files — no server in the read path. State is `localStorage` under
`artShowTracker.*`, versioned by `SCHEMA_VERSION`; migrations and the only store
adapter both live in `core.js`. Optional sync: Supabase (last-write-wins on
`updatedAt`) and the Worker (member intel). Solo mode works fully without either.

## Key files
- `core.js` — model (`makeShow`), store adapter, migrations, theme.
- `fit.js` — the scoring model.
- `pipeline.js` — the application pipeline's arithmetic (spend, expected value).
  DOM-free like `calendar.js`, so a phone app can reuse it.
- `ranker.js` — saved named rankings; compiles to a fit profile, never scores.
  Owns import validation, which is untrusted input.
- `expenses.js` / `expenses.html` — the expense log, landed cost, break-even,
  lodging finds. DOM-free maths, same as `pipeline.js`.
- `sales.js` — individual sales: the mix by price band and state, the stated
  gross vs. the rows, and the Square/Stripe CSV import. DOM-free.
- `plan.js` — Pro previews. Renders disabled cards only; no billing exists.
- `jury.js` / `jury.html` — mock jury review. Mostly refusals: no storage, no
  transport, no billing, and it says so up front.
- `browse.html` / `index.html` — catalogue / ledger, same drawer.
- `calendar.html` / `calendar.js` — the calendar. All the date maths, lane
  packing, clash detection and the .ics live in the js, DOM-free, so a phone
  app can reuse them; the html only renders.
- `build/build_fit_data.py` — the build; also date rules and cache-busting.
- `build/import_show_research.py` — booth fee parser. Fails closed on purpose.
- `build/research-overrides.json` — hand-audited facts, each with provenance.

## Commands
```bash
python3 build/build_fit_data.py             # after any data edit
python3 build/build_fit_data.py --selftest
python3 -m http.server 8765                 # leave up for the two below
node build/browser-tests.cjs
node build/ledger-view-tests.cjs
node build/calendar-tests.cjs
node build/pipeline-tests.cjs
node build/ranker-tests.cjs
node build/expense-tests.cjs
node build/jury-tests.cjs
cd worker && npm test
```
Deploy: push to `main`; Pages rebuilds in ~1 min.

## Gotchas
- Page looks stale? Check `version.json`'s `commit` against `main` — almost always
  a cached script, never a broken feature.
- Audit the fee parser against the **raw xlsx text**, never by reading the code.
  Every bug in it was found that way.
- No web egress: weather tests assert the failure path plus a stubbed one.
- Worker suite saying `Something went wrong` = stale `wrangler dev` holding D1.
- Pages set `data-theme` inline in `<head>` before paint, or dark mode flashes
  white on navigation. New pages need that snippet.

## Do NOT
- Assume React/TS — root `package.json` is the portfolio site.
- Add a build step, bundler, or `type="module"` to `tracker/`.
- Write to `build/catalogue-source.json` — pristine export, read-only.
- Split the fee parser on whitespace runs: gains 1 show, corrupts 6
  (`zapp-14601` $375→$75). Tried, reverted.
- Switch Pages to a branch source — it silently stops `main` publishing.
- Put counts or stats in this file. They rot, and it loads every session.
