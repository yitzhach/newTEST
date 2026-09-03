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
- **No app built yet.** `/` currently holds an unrelated Vite/React art
  portfolio (Isaac Anderson Art).

## Source material
- `Isaac_Anderson_2027_Art_Show_Application_Calendar.xlsx` — source of truth
  (tabs: Application Calendar, By Deadline, Notes). Not in this repo.
- Two static views built earlier: a stacked road-trip list and a schematic
  Florida route map (both uploaded to chat, not in repo).
- 2027 Florida season: 12 stops, Jan 2 – Apr 18, with lettered alternates
  (2a/2b, 6a–6c, 7/7b, 9a/9b, 10a/10b) for overlapping weekends.

## Open decisions
- Which of A / B / C to build (or a mix).
- Data store: a JSON file to start, or a real DB.
- Zapplication has no public API — likely scrape or manual import first.

## Next step
Pick a direction, then build the simple version: local JSON of shows +
list + map + add/edit form.
