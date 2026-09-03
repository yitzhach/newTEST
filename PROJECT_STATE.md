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
- **Phase 3 built and working** — Supabase sync behind the same adapter.
  - `docs/supabase-schema.sql` — `shows` table mirroring the model, RLS on,
    owner-only policies, plus a trigger that stamps `owner_id` from the JWT so
    a forged `owner_id` in a request body cannot land on someone else's row.
    Run it once in the Supabase SQL editor.
  - Magic-link sign-in. The session is stored locally and the tokens are
    scrubbed out of the URL on return. A refresh token the server rejects
    signs out cleanly rather than looking like an outage.
  - `SyncStore` (`tracker/store-supabase.js`) implements the same
    `list/get/upsert/remove/replaceAll` surface, and `AST.useStore()` swaps it
    in. **No render or UI code knows which backend is live.**
  - Writes land locally first and push after, so the app works with no
    network, says "offline — changes are saved locally", and catches up by
    itself on the `online` event.
  - Last-write-wins on `updatedAt`. **Deletes are tombstones** (`deletedAt`,
    schemaVersion 2) — a hard delete would just be pushed back by the other
    device on its next sync. Tombstones never reach the UI.
  - A device holding nothing but the untouched demo seed **adopts** the
    account's season instead of pushing the seed up; otherwise signing in on a
    second device duplicates all nine shows. Genuine local data still migrates
    up on first sign-in, which is the case the phase asks for.
  - Account panel behind the sync pill in the header: project URL, anon key,
    magic link, sync now, sign out, forget project. A pasted **service key is
    refused** with a reason — only the anon key belongs in a browser.
  - No `supabase-js`: it would be another CDN script whose exact build path
    could not be verified from here, and this needs five REST endpoints, not a
    library. Plain `fetch` against GoTrue and PostgREST, so still no build step.

- **Phase 4 built and working** — Zapplication import. Two new files,
  `tracker/import.js` (all the logic, no DOM) and `tracker/import-ui.js` (the
  modal), plus the modal markup in `tracker/index.html`. **No scraping** —
  nothing fetches a Zapp page; the text arrives from the clipboard.
  - **Paste box** takes a copied Zapp **search-results** or **My-Applications**
    page. Two shapes are handled: a copied HTML table (tab-separated, usually
    with a header row) is routed through the same column mapper the CSV import
    uses, so you get to fix its columns; a stack of text blocks is split on
    blank lines, or segmented by heuristic when the paste runs together with
    no blank lines at all.
  - **Parser** reads name, city/state, show dates, deadline and both fees, and
    maps Zapp's own application states ("Invited to Participate", "Wait List",
    "Not Invited") onto the tracker's statuses. It copes with `1/2/2027 -
    1/3/2027`, `January 2 - 3, 2027`, `Jan 22 – Jan 24, 2027`, `2027-02-13 to
    2027-02-15` and `1/2 - 1/3/2027`.
  - **Confidence flag per field**, which is the phase's real requirement:
    `high` (read from an explicit label, or a column you mapped), `med`
    (recognised by shape — a "City, ST" line, a bare date range), `low`
    (inferred — a year that was not in the text, a fee assigned by position,
    an end date assumed equal to the start). Med and low get a coloured
    underline in the review table, and **every flagged cell's tooltip says
    why**, so colour is never the only cue. A deadline with no year is put in
    the season *before* the show, which is what Zapp means, and flagged low.
  - **Review table before anything is written.** Fourteen editable columns, a
    tick per row, per-row validation (end before start, deadline after the
    show, unparseable dates) that unticks a broken row rather than importing
    it, and Tick all / Only new / Tick none. Typing in a cell re-reads it — a
    typed `7/4/2027` normalises to ISO — and clears its guess flag.
  - **Dedupe by name + year**, as specified. Names normalise past case,
    punctuation, `&`, a leading "The" and "44th Annual", so an exact match in
    the same season is flagged **Already have** and unticked, with a per-row
    choice of **Update it** (writes onto the existing record, keeping its id,
    rating, status and createdAt) or **Add as new**. A name that merely
    *contains* the other is only flagged **Similar to** and stays ticked —
    "Las Olas Art Fair Part I" and "Part II" must not collapse into one row.
    Repeats inside a single paste are caught too.
  - **CSV import with the mapping done in the UI.** Delimiter is sniffed
    across the first dozen lines (not just the first, which is often a title
    row above the real header); quoted fields, embedded commas and doubled
    quotes are handled; a title row above the header is skipped and reported.
    Every tracker field gets a dropdown of the file's actual columns,
    pre-selected from header synonyms and freely overridable, with the first
    real value shown beside it. A column can only feed one field — picking a
    taken column releases it from the other. Synonyms are tried
    most-specific-first, so a sheet with both "Apply By" and "Closes" does not
    hand the deadline to whichever happens to come first. One "Dates" column
    holding a range fills both start and end.
  - **Geocoding via Nominatim**, one request every 1.1s enforced at module
    level (so two callers cannot each think they are alone), results cached in
    localStorage through `AST.Settings` — **misses cached too**, so a place
    with no match is asked about once, not once per import. Progress is shown,
    Stop actually stops between requests, and anything it cannot place keeps
    empty Lat/Lng columns that are editable right there, plus the drawer's
    existing manual fields. Coordinates that came from Nominatim are flagged
    `med`, not `high` — an ambiguous city name deserves a look.
  - **Every write goes through `AST.Store`**, so an import lands in whichever
    backend is live (LocalStore or the Supabase SyncStore) and syncs like a
    hand edit. Undo removes what was added and restores what was updated,
    also through the adapter.
  - Also fixed while in the file: `exportJSON` referenced `SCHEMA_VERSION`
    without binding it from `window.AST`, so Export JSON threw.

## Why the file split
Phase 1's "one file" rule ran into Phase 2's "`map.html` reuses the same
module, do not fork the code". Two pages cannot share inline script, so:
- `tracker/core.js` — model, `Store` adapter, seed, dates/formatting, rating
  glyphs, theme. **Still the only code that touches storage.**
- `tracker/map.js` — every line of Leaflet work, plus the Google/Apple
  hand-off builder. Neither page contains map code.
- `tracker/app.css` — all styling for both pages.
- `tracker/store-supabase.js` — Phase 3: auth, the remote table, the sync
  store. Also only reaches storage through `core.js`.
- `tracker/import.js` — Phase 4: the Zapp paste parser, the CSV reader and
  column mapper, duplicate detection, and the Nominatim geocoder. **No DOM.**
- `tracker/import-ui.js` — Phase 4: the import modal's wiring, the review
  table, and the commit. Writes only through `AST.Store`.
- `tracker/index.html` — the ledger; `tracker/map.html` — the full-page map.

The geocode cache is the one new piece of stored state (`AST.Settings`,
key `artShowTracker.geocache`) and it lives in `core.js` for the same reason
everything else does: one file touches localStorage.

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
  Phase 3, same interface. `AST.Store` is a stable façade; `AST.useStore()`
  swaps the backend under it so no page re-binds its reference.
- **Responsive single file** — no separate mobile file. Light + dark mode.
- **Map: Leaflet + OpenStreetMap tiles**, no API key. Numbered markers, hover
  sync with the list, hand-off to Google/Apple Maps, plus a full-page
  `tracker/map.html`.
- **Zapplication: paste-and-parse + CSV import.** No scraping. Built in
  Phase 4; a copied Zapp *table* is routed through the CSV column mapper
  rather than guessed at separately.
- **Import is a wide modal, not the right-hand drawer.** The review table
  carries fourteen editable columns; a 460px drawer cannot show them. It
  scrolls sideways inside its own box, so the page body never does.
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

**Phase 3:** driven in headless Chromium against a mock GoTrue/PostgREST,
using separate browser contexts as separate devices — 42 checks, all passing:
first-sign-in migration up, a second device pulling the same season without
duplicating it, edits crossing devices, last-write-wins against a stale local
edit, deletes propagating instead of resurrecting, one user not seeing
another's rows, offline editing plus automatic catch-up when the connection
returns, sign-out leaving the data on the device, service-key and bad-URL
rejection, magic-link dispatch and redirect, and recovery from an expired
session. A further 9 checks cover the v1 to v2 migration (existing data
preserved, `deletedAt` backfilled, the upgrade persisted) and delete/undo
clearing the tombstone.

**Phase 4:** 139 checks in Node against the parsing/geocoding module plus 93
in headless Chromium driving the real modal over `file://`, all passing.
Node covers the date shapes (slash, ISO, "January 2 - 3, 2027", "Jan 22 – Jan
24, 2027", "1/2 - 1/3/2027"), a word that is not a month not being read as a
date, Feb 31 rejected, the labelled and unlabelled paste paths, the run-on
paste with no blank lines, the deadline-year inference, positional fee
assignment, every Zapp status mapping, the tabbed-paste-to-column-mapper
route, CSV quoting and delimiter sniffing, a title row above the header, one
column feeding only one field, "Apply By" beating "Closes" for the deadline,
a range in a single "Dates" column, dedupe (exact, case/punctuation, "44th
Annual", different year, Part I vs Part II, repeats inside one paste),
validation, and `toShow` preserving an updated record's id, rating and
createdAt. The geocoder is driven against a stub: requests measured ≥1s
apart, a second pass served entirely from the cache with no request at all,
a cached miss staying a miss, a failed lookup flagged per row without
stopping the run, Stop actually stopping, and rows that already have
coordinates or are unticked never being looked up.

Chromium covers the whole flow end to end: the modal opening, a three-record
Zapp paste parsed into the review table with the right values, the
confidence classes and their explanatory tooltips, the duplicate flagged and
unticked against the seeded season, editing a cell clearing its flag and
re-running validation, geocoding filling coordinates with the manual columns
still editable, commit writing through `AST.Store` and the ledger growing,
the undo, the cache serving a second import, the CSV path including
hand-mapping a column the guesser missed and the release-on-reuse rule,
update-an-existing instead of adding a second copy, unparseable text
refusing to invent rows, and no horizontal page overflow at 1280 / 900 /
390px with the review table open. One further check swaps a recording store
in via `AST.useStore` and confirms both the import and its undo write
through the adapter rather than around it. A ten-record paste parses and
commits in about **0.3s**, well inside the phase's "under a minute".

**Not verified from here:** the cdnjs and OpenStreetMap tile requests
themselves — both hosts are blocked from the build sandbox, so the map was
tested with a locally vendored Leaflet and no tiles. Open `tracker/index.html`
on a real connection to confirm tiles paint. For the same reason Leaflet
carries no Subresource Integrity hash; adding verified hashes is a small
follow-up.

The **real Nominatim service** has also never been called from here — the
host is blocked from the build sandbox, so the geocoder was driven against a
stub implementing the same response shape. The rate limit, the cache and the
failure handling are all verified; what is not is that
`nominatim.openstreetmap.org` returns what is expected for these particular
city names. Run one import on a real connection to confirm.

Phase 3 has never touched a **real** Supabase project — only a mock
implementing the same endpoints. Before trusting it: create a project, run
`docs/supabase-schema.sql`, paste the URL and anon key into the account panel,
and sign in on two devices. Two things only a real project can confirm are
that the magic-link redirect URL is allow-listed in Supabase's auth settings
(Authentication → URL Configuration), and that the RLS policies behave as
written.

## Next step
Start a fresh chat and run `docs/BUILD_PROMPT.md`, **Phase 5 — Share and
export** (canvas share card at 1080×1080 and 1080×1920, copyable caption and
email block, an embed snippet for isaacandersonart.com, and share buttons —
with Instagram honestly presented as download-the-image-and-copy-the-caption,
because there is no web API to post to it).

Still outstanding, independent of Phase 5:
- **Backfill stops 8-12** (through Apr 18). The CSV import now exists: save
  the xlsx's Application Calendar tab as CSV, open **Import shows → CSV
  file**, map the columns, and commit. This is the first thing to do with
  Phase 4 on real data.
- **Point Phase 3 at a real Supabase project** and sign in on two devices —
  see the caveat under Verified.
- **Run one import on a real connection** to confirm Nominatim answers as
  expected — see the caveat under Verified.
- Add verified Subresource Integrity hashes to the two Leaflet tags.
