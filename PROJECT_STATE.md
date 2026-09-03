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
- **Phase 2 built and working** — the route map. Added `tracker/map.html`,
  and split the shared code out of the single file (see "Why the file split"
  below):
  - Leaflet 1.9.4 + OpenStreetMap tiles from cdnjs, no API key. Numbered
    markers matching the list; alternates are dashed outlines in the warn
    colour.
  - Two-way highlight: hover **or keyboard-focus** a row and its pin lights
    up and the map pans to it; hover or focus a pin and its row lights up and
    scrolls into view.
  - Route line through the main stops in date order, plus a dashed spur from
    each alternate to the stop it stands in for (nearest by start date).
  - "Open route in Google Maps" / "Open in Apple Maps": waypoints in date
    order, alternates excluded. Google's URL API takes 9 waypoints, so past
    11 stops the route splits into legs that overlap by one stop, each
    offered as its own Google/Apple link, with a note saying it was split.
    Shows with no lat/lng are named in the note, not dropped in silence.
  - The map shows the whole season even when the list is filtered — a route
    line through a filtered subset would be a different, misleading route.
    It only re-fits the viewport when the pins actually move, so an edit does
    not throw away the pan and zoom you set.
  - Responsive as decided: rail map >=1024, collapsible 768–1023, full-screen
    sheet below 768 (Escape closes it). The map node is never reparented, so
    Leaflet keeps its state; it just gets `invalidateSize()`.
  - `tracker/map.html` — full-page map with an itinerary rail, deep-linkable
    to a stop (`#stop=6a`, matched on stop number then id). Selecting a stop
    updates the hash; editing the hash re-selects. Same Store, same map
    module, no forked code.

- **Seeded with stops 1-7 of the 2027 Florida season** (9 records including
  alternates 2a/2b, 6a/6b), taken from the signed-off `design/Main.dc.html`.
  **Stops 8-12 (through Apr 18) are still missing** — they were never written
  into the repo, only into the xlsx. Add them in the drawer or via the Phase 4
  CSV import.
- `/` still holds an unrelated Vite/React art portfolio (Isaac Anderson Art);
  the tracker is self-contained under `tracker/`.

## Why the file split
Phase 1's "one file" rule ran into Phase 2's "`map.html` reuses the same
module, do not fork the code". Two pages cannot share inline script, so:
- `tracker/core.js` — model, `Store` adapter, seed, dates/formatting, rating
  glyphs, theme. **Still the only code that touches storage.**
- `tracker/map.js` — every line of Leaflet work, plus the Google/Apple
  hand-off builder. Neither page contains map code.
- `tracker/app.css` — all styling for both pages.
- `tracker/index.html` — the ledger; `tracker/map.html` — the full-page map.

These are **classic scripts on purpose, not ES modules**: `type="module"`
cannot be fetched over `file://`, and the app has to keep opening by
double-click. Verified that it still does. `core.js` publishes `window.AST`,
`map.js` publishes `window.ASTMap`.

## Source material
- `Isaac_Anderson_2027_Art_Show_Application_Calendar.xlsx` — source of truth
  (tabs: Application Calendar, By Deadline, Notes). Not in this repo.
- Two static views built earlier: a stacked road-trip list and a schematic
  Florida route map (both uploaded to chat, not in repo).
- 2027 Florida season: 12 stops, Jan 2 – Apr 18, with lettered alternates
  (2a/2b, 6a–6c, 7/7b, 9a/9b, 10a/10b) for overlapping weekends.

## Decisions made
- **Direction A — Show Ledger** is the one being built.
- **No build step, vanilla JS.** Was "one file: `tracker/index.html`" through
  Phase 1; Phase 2 split it into `index.html` + `map.html` + `core.js` +
  `map.js` + `app.css` so the two pages share one map module, as Phase 2
  requires. Still no bundler, still opens by double-click.
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
**Phase 1:** seed loads, add / edit / rate / note / delete + undo all work,
survives a reload, no console errors (the Google Fonts request fails offline
and falls back to the system stack), no horizontal overflow at 1280 / 900 /
390px.

**Phase 2:** driven in headless Chromium against a local copy of Leaflet
1.9.4 — 46 checks, all passing: the 9 markers and their labels, alternates
styled as alternates, one solid route line and two dashed spurs, both
highlight directions (mouse and keyboard), Google/Apple waypoint order with
alternates excluded, leg splitting at 14 stops (2 legs, overlapping 1→11 and
11→14, 9 waypoints in leg 1), the phone sheet opening and closing, dark mode
recolouring the route line, the `#stop=6a` deep link and hash round-trip,
missing-coordinate reporting, and no horizontal overflow at 1280 / 900 /
390px. Also loaded both pages over `file://` to confirm double-click still
works.

**Not verified from here:** the cdnjs and OpenStreetMap tile requests
themselves — both hosts are blocked from the build sandbox, so the map was
tested with a locally vendored Leaflet and no tiles. Open `tracker/index.html`
on a real connection to confirm tiles paint. For the same reason Leaflet
carries no Subresource Integrity hash; adding verified hashes is a small
follow-up.

## Next step
Start a fresh chat and run `docs/BUILD_PROMPT.md`, **Phase 3 — Supabase**
(`shows` table with RLS, magic-link auth, `SupabaseStore` behind the existing
adapter, settings panel for project URL + anon key, last-write-wins sync with
a visible offline state).

Still outstanding, independent of Phase 3:
- **Backfill stops 8-12** (through Apr 18) when the xlsx is at hand — or wait
  for the Phase 4 CSV import.
- Add verified Subresource Integrity hashes to the two Leaflet tags.
