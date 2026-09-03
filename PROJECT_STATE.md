# Art Show Tracker — project state

_Last updated: 2026-09-03_

## What this is
A tracker for Isaac Anderson's art show season: upcoming shows, a route map
in date order, and easy add/edit. Later: pull shows from Zapplication,
deadline tracking, and travel (lodging/rentals/flights) tie-ins.

## Where things stand
- **Design concepts (done).** Three homepage directions on a canvas:
  https://claude.ai/code/artifact/f9a1a8a5-ba14-4dcd-a1f7-ff06b18f0121
  - **A — Show Ledger** (`design/Main.dc.html`): editable table + right rail
    with map and deadlines. Closest to the existing road-trip HTML.
  - **B — Season Board** (`design/SeasonBoard.dc.html`): dark dashboard,
    season gantt with apply-by markers, apply queue.
  - **C — Route First** (`design/RouteFirst.dc.html`): map is the page,
    itinerary beside it, edit panel on the right.
  - Layout: `design/canvas.json`. Re-seed with the `/design` skill helper
    after editing any `.dc.html`; then republish the same file path.
- **Phase 1 built and working** — `tracker/index.html`, one file, no build
  step. Open it by double-click. Contains:
  - `Store` adapter with async `list/get/upsert/remove/replaceAll`;
    `LocalStore` (localStorage key `artShowTracker.db`) is the only code that
    touches storage. `schemaVersion` 1 with a `migrate()` hook already wired.
  - Show list in date order: stop number, name, city, dates, apply-by with a
    days-remaining warning, status pill, rating. Sort by date / apply-by /
    rating; filter chips by status with counts.
  - Add/edit drawer with every model field, inline validation, autosaved
    notes and rating, delete with undo.
  - Rating 0-10 as five half-stars; mouse, arrow keys, number keys,
    Home/End/Delete.
  - Deadline panel (next 5 open apply-by dates, colour-coded) and a season
    stats panel.
  - Light/dark via `data-theme` + tokens, system default, toggle persisted.
  - JSON export / import (import replaces all, with undo).
  - Responsive: two columns >=1024px, stacked below, cards <768px.
- **Seeded with stops 1-7 of the 2027 Florida season** (9 records including
  alternates 2a/2b, 6a/6b), taken from the signed-off `design/Main.dc.html`.
  **Stops 8-12 (through Apr 18) are still missing** — they were never written
  into the repo, only into the xlsx. Add them in the drawer or via the Phase 4
  CSV import.
- `/` still holds an unrelated Vite/React art portfolio (Isaac Anderson Art);
  the tracker is self-contained under `tracker/`.

## Source material
- `Isaac_Anderson_2027_Art_Show_Application_Calendar.xlsx` — source of truth
  (tabs: Application Calendar, By Deadline, Notes). Not in this repo.
- Two static views built earlier: a stacked road-trip list and a schematic
  Florida route map (both uploaded to chat, not in repo).
- 2027 Florida season: 12 stops, Jan 2 – Apr 18, with lettered alternates
  (2a/2b, 6a–6c, 7/7b, 9a/9b, 10a/10b) for overlapping weekends.

## Decisions made
- **Direction A — Show Ledger** is the one being built.
- **One file: `tracker/index.html`.** No build step, vanilla JS.
- **Storage behind a `Store` adapter.** localStorage in Phase 1, Supabase in
  Phase 3, same interface.
- **Responsive single file** — no separate mobile file. Light + dark mode.
- **Map: Leaflet + OpenStreetMap tiles**, no API key. Numbered markers, hover
  sync with the list, hand-off to Google/Apple Maps, plus a full-page
  `tracker/map.html`.
- **Zapplication: paste-and-parse + CSV import.** No scraping.
- **Sharing: canvas-rendered PNG card** (IG has no web post API) plus a
  copyable caption and an embed snippet.

## Verified
Seed loads, add / edit / rate / note / delete + undo all work, survives a
reload, no console errors (the Google Fonts request fails offline and falls
back to the system stack), no horizontal overflow at 1280 / 900 / 390px.

## Next step
Start a fresh chat and run `docs/BUILD_PROMPT.md`, **Phase 2 — Map**
(Leaflet in the right rail, two-way hover with the list, Google/Apple Maps
hand-off, `tracker/map.html`). The rail already has a placeholder panel where
the map goes. Backfill stops 8-12 when the xlsx is at hand.
