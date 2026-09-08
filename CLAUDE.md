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

## Stack
- **`tracker/`** — vanilla classic scripts. No build, no modules, no framework.
  Each publishes one global (`AST`, `ASTCatalogue`, `ASTIntel`, `ASTMembers`,
  `ASTVersion`, `ASTSupabase`). Opens via `file://` by design.
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
- `browse.html` / `index.html` — catalogue / ledger, same drawer.
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
