# Art Show Tracker — project state

_Last updated: 2026-09-05 (Phase 8)_

## What this is
A tracker for Isaac Anderson's art show season: upcoming shows, a route map
in date order, and easy add/edit. Later: pull shows from Zapplication,
deadline tracking, and travel (lodging/rentals/flights) tie-ins.

## Branches
One line of history, now on **`claude/art-show-tracker-smoke-18dbj6`** — which
is `claude/artist-show-tracker-5pavpl` plus the Phase 6 and smoke-harness
commits, a strict fast-forward with no divergence. `CLAUDE.md` was updated to
name it, and 5pavpl is redundant and can be deleted. The deployed tracker
ships from **`main`**, whose `tracker/` is byte-identical to this branch's, so
Phase 6 is live and there is nothing waiting to be published.

Everything before it was consolidated the same way. Phases 4 and 5 were built
on branches stacked off 5pavpl (`claude/art-show-tracker-phase-4-38h09w`, then
`claude/art-show-tracker-phase-5-u99p8m`); because the stack was strictly
linear — each branch was the one below it plus its own commit, with no
divergence — folding them in on 2026-09-03 was a fast-forward, not a merge: no
merge commits, and every phase commit kept intact. Those two, and now 5pavpl,
are redundant and can be deleted whenever you like.

## Live demo
Deployed to GitHub Pages on 2026-09-03 — **https://yitzhach.github.io/newTEST/tracker/**
(route map at `tracker/map.html`). The existing Pages workflow
(`.github/workflows/static.yml`) uploads the repository root from `main`, so
publishing was one additive commit putting `tracker/` on `main`; nothing
outside `tracker/` was touched and the site at the root is unchanged. No
Cloudflare or other host is involved — the tracker has no build step, so being
uploaded is all it needs. Re-deploy by pushing `tracker/` changes to `main`.

Note the root site is a Vite/React source tree that the workflow uploads
**unbuilt** — `index.html` there loads `/index.tsx` and an `/index.css` that is
not in the repo — so the portfolio at the root will not run as deployed. That
predates this work and is untouched by it; it needs a build step in the
workflow if it is ever meant to work.

A single-file preview of the ledger (no map — the artifact sandbox blocks
OpenStreetMap tiles and Leaflet's stylesheet) is also published at
https://claude.ai/code/artifact/a1fcd724-d87d-4c62-83fc-66ddf1f2494a

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

- **Phase 5 built and working** — share and export. Two new modules,
  `tracker/share.js` (selection, card, text, snippet — no DOM) and
  `tracker/share-ui.js` (the panel), plus `tracker/embed.html` and the modal
  markup in `tracker/index.html`. A **Share** button sits in the header.
  - **One selection feeds all three outputs**, so the card, the caption and
    the embed can never disagree about what is public: which statuses go out
    (accepted only / accepted + waitlist / everything but declined), how many
    shows, and whether alternates are included. **Declined and not-applying
    shows are never publishable at all**, and alternates are off by default —
    they are shows you have not committed to. A show that has started but not
    finished still counts as upcoming; a finished one drops out.
  - **Canvas share card at 1080×1080 and 1080×1920**, drawn in the site's own
    type: Montserrat via the page's webfont, uppercase wide-tracked kicker and
    meta lines, light display weight for the name, one hairline, one accent.
    Light or dark, following the app or forced. Tracking is drawn glyph by
    glyph rather than relying on `ctx.letterSpacing`, which not every browser
    has. Long festival names are ellipsised inside the margin — checked by
    reading the pixels in the right-hand margin, not by eye.
  - The card **waits for the webfont** before drawing (canvas silently falls
    back to Helvetica if you draw too early) and says so on the rare occasion
    Montserrat did not load. Rows shrink to fit before any row is dropped, the
    list block is centred in the space left, and **a row that still will not
    fit is counted into the "+ N more shows" line and reported in the UI**
    rather than vanishing.
  - **Download PNG** (a real 1080×1080 PNG, verified by reading the file
    header) and **Copy image** where the browser has `ClipboardItem`.
  - **Copyable text block** in two shapes: a caption (one line per show —
    `Jan 2–3 — Naples New Year's Art Fair, Naples, FL`) and an email block (a
    block per show, with the year). Both name the artist, count what is not
    listed, and carry the link. The character count is shown against
    Instagram's 2,200 and X's 280, counting a link as X counts it.
  - **Embed for isaacandersonart.com, two ways.** *Script* is self-contained:
    the list is baked into the snippet, so it needs no hosting and makes no
    requests — paste it again when the season changes. *iframe* points at a
    hosted `tracker/embed.html` and stays current, at the cost of hosting that
    file (with `core.js` and `share.js`) plus a `shows.json` you re-upload.
    The iframe posts its height to the host page and the snippet resizes it.
  - **One renderer, three homes.** The pasted snippet is `ASTShare.mountEmbed`
    serialised — literally the same function the panel previews with and
    `embed.html` calls — so the two embeds cannot drift. It builds DOM with
    `textContent`, so a show name containing `</script><img onerror=…>`
    renders as text and cannot break out of the snippet (checked by pasting
    exactly that into a foreign page).
  - **`shows.json` carries only what is public** — name, city, state, dates,
    status, alternate flag, url. Never notes, fees, ratings, apply-by dates or
    coordinates. `embed.html` reads the tracker's own storage **only over
    `file://`** (the local double-click preview); on a real host a missing
    `shows.json` says so rather than seeding a visitor's browser with the demo
    season.
  - **Share buttons, honestly labelled.** Facebook takes a URL and nothing
    else — its prefill parameter has been gone for years — so clicking it
    copies the caption to the clipboard and says so. X uses the intent URL
    with the caption and link. Copy link. And **Instagram: there is no web API
    to post**, so the button saves the PNG and copies the caption in one
    click, and the panel says to post it from the phone app. Nothing in the UI
    claims otherwise.
  - The panel **writes nothing but its own preferences** (`AST.Settings`, key
    `artShowTracker.share` — name, link, counts, sizes, never show data);
    verified by comparing the stored season before and after. It reads shows
    through the ledger's own state, so it works the same on LocalStore or the
    Supabase SyncStore.

- **Phase 6 built and working** — the four layout/map asks from 2026-09-04.
  No new files; `core.js`, `map.js`, `app.css`, `index.html` and `map.html`.
  - **A draggable divider between the list and the map.** The rail's width is
    a CSS custom property (`--rail-w`) on the grid, so a drag is one variable
    write rather than a layout rewrite. `AST.Splitter` lives in `core.js` for
    the same reason `Theme` does — both pages need it and one file owns the
    localStorage write. It knows nothing about maps: the page passes an
    `onResize`, which is where `invalidateSize()` goes. Writes are throttled
    to one per animation frame, because calling `invalidateSize()` on every
    `pointermove` is exactly what makes a resizable map feel like treacle.
    Clamped so neither pane can be squeezed out (rail ≥280px, list ≥420px),
    re-clamped on window resize, and keyboard-operable with the arrow keys
    (`role="separator"`, labelled) — a divider you can only drag is a divider
    some people cannot move. The width is remembered per page
    (`artShowTracker.layout`, keys `ledgerRail` and `mapPageRail`) — **no
    double-click reset, as asked.** It deliberately does **not** re-fit the
    map: resizing should give you more of the view you had, not silently
    re-frame the season and throw away your pan and zoom.
  - **Slower, smoother hover pan.** The map used to snap to the next city in
    `.35s`, which reads as a jump. Now `.85s` with a gentler `easeLinearity`.
    The real fix was the second half: a 90ms settle delay before the pan
    starts, so running the pointer down eight rows animates **once**, to
    where you stopped, instead of queueing eight interrupted pans. The pin
    still lights up instantly — only the pan waits.
  - **List / Map view in the header**, plus a **Full map** link to the
    standalone page (both, as asked). Map view is CSS only: the ledger and
    the divider stand down, and so do the deadline and stats panels, so the
    map gets the whole page rather than being pushed below the fold by them.
    **The map node is never reparented**, so Leaflet keeps its zoom, pan and
    layers — it just gets `invalidateSize()`. This one *does* re-fit, unlike
    the divider: switching view changes the viewport's shape completely, and
    without a fit the season sits squashed in one corner. The chosen view is
    remembered.
  - **The route follows roads.** The straight line between two stops was
    never the drive. `ASTMap.Road` asks OSRM's public demo server for the
    real geometry and swaps it into the existing polyline. Everything about
    it is best-effort and nothing is load-bearing: the straight line is drawn
    **first** and only then upgraded, so the route is never missing while a
    request is in flight and never lost if one fails; there is a hard 9s
    abort so a hung router cannot leave it pending; a stale reply landing
    after the season changed is discarded by token; and a failure is silent,
    because a missing road route is a cosmetic difference, not an error worth
    putting in front of anyone. Geometry is cached
    (`artShowTracker.routecache`, keyed by the ordered coordinates) so a
    reload redraws the roads with no request at all. **A failure is not
    cached** — unlike a geocode miss it is usually the network, not the
    answer.

  **Why not an embedded Google map.** The URL the hand-off buttons build
  cannot be framed: Google serves `google.com/maps/dir/...` with
  `X-Frame-Options: SAMEORIGIN` and the browser refuses. The supported route
  is the **Maps Embed API**, which is built for iframes and free of charge,
  but needs a key from a billing-enabled Google Cloud project, and on a
  static public site that key ships in the page source and must be
  referrer-locked. That would be the project's first API key, so the no-key
  road route was built first and the Embed API is parked in
  `docs/FUTURE_BUILD.md` for when a key exists.

  **The one thing to watch:** `router.project-osrm.org` is a *demo* server,
  not a production service. One cached request per season is well within
  neighbourly use, but it carries no uptime promise — which is precisely why
  the fallback is silent and the straight line always draws first.

- **Phase 7 built and working** — the catalogue, hiding, and the view rework.
  One new module and one new page (`tracker/catalogue.js`,
  `tracker/browse.html`), plus `tracker/catalogue.json`.
  - **The map stretches vertically too.** `AST.SplitterV` drags the bottom
    edge of the map in ledger view, writing `--map-h`. Same throttling and
    keyboard support as the horizontal one, clamped so it cannot be collapsed
    to nothing (min 180px) or grow past 78% of the window. Remembered under
    `ledgerMapH`.
  - **Map view was backwards and is now the right way round.** *Map* keeps the
    show list as a narrow companion on the **left** with the map taking most
    of the width; **Full screen** is the browser Fullscreen API on the map
    shell, with Escape to come back. The grid is unchanged between the two
    views — only the remembered proportion differs (`ledgerRail` vs
    `ledgerRailMap`, one divider serving both via `setKey`), so the divider
    keeps working and each view remembers its own split.
    - The narrow list re-uses the phone layout's stacking, but keyed to **the
      width of its own column** via an `@container` query rather than the
      window. This bit twice: the rule did nothing at first because it sat
      *above* the base `.row-grid` rule, and at equal specificity the later
      rule wins. There is now a check asserting the row really collapses.
  - **Hide a show from the plan.** An eye on each row. Hidden shows grey out
    and strike through, and drop out of the map, the route line and the
    Google/Apple hand-off — the filtering happens once, inside
    `routeStops()`, so those three can never disagree. It is a **lens, not a
    delete**: exports, the share card and the season stats all still count a
    hidden show. `hidden` is a real field on the model (schemaVersion **3**,
    with a migration backfilling `false`) so it survives a reload and syncs
    like any other edit. Clicking the eye is caught before the row handler,
    so it does not also open the drawer, and every toggle offers an undo.
  - **All shows — the catalogue** (`tracker/browse.html`). 202 shows read out
    of `Art_Show_Tracker.xlsx`, **kept firmly out of the ledger**: it is the
    pool you draw a season from, not part of one.
    - Filter by text, state (built from the data, with counts), fee, and
      whether the deadline is still open — **on by default**, since 63 of the
      202 are 2026 shows whose deadlines have largely passed. Sort by event
      date, deadline, name, fee or your own rating.
    - **Like first, then rate**, as asked: a one-click heart to shortlist
      while skimming, then the ledger's own 0–10 half-star rating on the
      shortlist. Ratings work by click and by keyboard.
    - **Add to ledger**, one show or every liked show at once, through
      `AST.Store` like any other write, carrying the name, city, state,
      dates, deadline, fee and **the Zapplication link**. Undo removes them
      again.
    - Added shows are **geocoded automatically** through the import module's
      existing `Geocoder` — same 1.1s rate limit, same shared cache — because
      a catalogue record has a city but no coordinates, and without this a
      show added here would never appear on the map. It runs in the
      background with progress, and an undo cancels it.
    - **Your picks live apart from the data.** `catalogue.json` is replaceable
      wholesale; likes, ratings, which records you have pulled across, and any
      show you add yourself live in `AST.Settings.getCatalogue()`, keyed by
      catalogue id. So a fresher export can be dropped in without losing
      anything. Ids come from the Zapp event id in the link where there is
      one, which is what makes that stable.
    - A record whose ledger show has since been deleted stops claiming to be
      "In ledger", or the Add button would never come back.

  **On the data.** The 202 rows converted cleanly: every one has a
  Zapplication link, 25 states (99 of them Florida), events across 2026–27,
  fees $25–135. One row — a statewide South Carolina residency — had a blank
  State with the state name sitting in the City column; that was read across
  rather than invented. Nothing else was inferred.

- **Phase 8 built and working** — a list view and real sorting for All shows.
  No new files; `catalogue.js`, `browse.html`, `app.css`.
  - **Cards or List**, toggled top-right of the results and remembered. Cards
    are for browsing; the list is for comparing 202 of them at once — one row
    per show with Show / Where / Dates / Deadline / Fee / Rating columns, and
    the like, the rating and Add all still live in the row. The Zapplication
    link is the show name itself, still opening in a new tab. Below 900px the
    row folds to a name plus a stacked summary rather than scrolling sideways.
  - **One sort control, both directions.** Every comparator is written
    *ascending in its own natural sense* — earliest date, A to Z, cheapest,
    lowest rating — and an arrow button reverses it. That is the whole reason
    "newest to oldest" is not a separate menu entry: it is Event date,
    reversed. Keys are Event date, Application deadline, Name (A–Z), My
    rating and Fee. Picking a key snaps the arrow to whatever is most useful
    for it (soonest deadline first, but *highest* rating first), and the arrow
    then flips whichever is chosen. Both the key and the direction are
    remembered, and the arrow carries a written label ("Z to A", "Newest
    first") so the direction is never conveyed by a glyph alone.
  - **Empty values sink.** A show with no date or no fee sorts to the bottom
    of an ascending order rather than masquerading as the earliest or the
    cheapest, and **name breaks every tie**, so equal rows keep a stable order
    instead of shuffling between renders.
  - **Keyword search now takes several words and matches the state.** Every
    word has to appear somewhere in the name, city or state, so "art naples"
    behaves the way people expect, and both "florida" and "FL" work.

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
- `tracker/share.js` — Phase 5: which shows are public, the canvas card, the
  caption/email blocks, the embed snippet and the share URLs. **No DOM
  reads.** Its `mountEmbed` is the function the pasted snippet carries.
- `tracker/share-ui.js` — Phase 5: the share panel's wiring. Writes nothing
  but the panel's own preferences.
- `tracker/embed.html` — Phase 5: the read-only upcoming list, for an
  `<iframe>` on isaacandersonart.com. Standalone but not forked — it draws
  with `ASTShare.mountEmbed`.
- `tracker/index.html` — the ledger; `tracker/map.html` — the full-page map.

Phase 6 added no files. `AST.Splitter` (the draggable divider) went into
`core.js` beside `Theme`, and `ASTMap.Road` (the road-following route) into
`map.js` beside the rest of the Leaflet work, because both pages use both and
neither is a new concern.

Phase 7 added:
- `tracker/catalogue.js` — the shows catalogue: loading, your likes and
  ratings, filtering and sorting, and turning a record into a ledger show.
  **No DOM.**
- `tracker/browse.html` — the All shows page. Wiring only; every decision it
  makes lives in `catalogue.js`, and every write to the season goes through
  `AST.Store`.
- `tracker/catalogue.json` — the 202-show reference list, generated from the
  xlsx. Replaceable wholesale without touching your picks.
`AST.SplitterV` (the vertical divider) sits beside `AST.Splitter` in
`core.js`, for the same reason.

`tools/smoke/` sits outside `tracker/` and is **not part of the app** —
nothing in `tracker/` references it and deleting it costs nothing. It is the
headless harness that serves the repo at the deployed subpath; see its README.

The geocode cache and the share panel's preferences are the two new pieces of
stored state (`AST.Settings`, keys `artShowTracker.geocache` and
`artShowTracker.share`) and they live in `core.js` for the same reason
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
  copyable caption and an embed snippet. Built in Phase 5. The embed ships in
  two shapes because Phase 3's RLS is owner-only: a self-contained snippet
  with the list baked in (no hosting, does not update itself) and an iframe
  onto a hosted `embed.html` reading a `shows.json` you re-upload. A public
  read path in Supabase would remove that re-upload; it is parked in
  `docs/FUTURE_BUILD.md`.
- **Nothing private is publishable.** The share panel's outputs carry name,
  city, state, dates, status and url — never notes, fees, ratings, apply-by
  dates or coordinates — and declined / not-applying shows never go out.

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

**Phase 5:** 99 checks in headless Chromium driving the real panel over
`file://`, all passing. They cover the selection rules (declined and
not-applying never published, alternates off by default and still excluded
when a not-applying show is one, a show mid-run still upcoming, the count cap
and the "+ N more" remainder, the default status mode), the card (1080×1080
and 1080×1920 canvases, the light and dark grounds sampled as pixels, that
type was actually drawn, a long name ellipsised with the right-hand margin
provably empty, rows dropped rather than overprinted and the drop reported,
the story size fitting at least as many rows as the square), the caption and
email blocks (line shapes, the year, the link, the remainder line, a declined
show absent, the character count), copy through a stubbed clipboard, the
script snippet (mount point, baked data, exactly one closing tag, rendering to
five rows when pasted into a foreign page, read-only, and an injected
`</script><img onerror>` neither escaping nor firing), the iframe snippet
(src, count, height listener), `shows.json` holding no private fields, the
Facebook and X URLs, the Instagram button downloading the PNG *and* copying
the caption and saying to post from the app, a real 1080×1080 PNG download
read back from disk, sharing never touching the stored season, preferences
surviving a reload, the empty-season state, Escape and focus return, and no
horizontal overflow at 1280 / 900 / 390px on every tab. A further five checks
serve `tracker/embed.html` over real HTTP: a missing `shows.json` says so and
leaves the visitor's storage untouched, a served `shows.json` renders, and the
iframe reports its height to the host page. A nine-check regression pass
confirms Phases 1-4 still work with the panel in place (ledger, import modal,
drawer, JSON export, the map page).

**Served over real HTTP at the live path shape (2026-09-04).** Every earlier
phase was driven over `file://` against local stubs. The deployed site is a
**subpath over https** (`/newTEST/tracker/`), a shape the app had never run in,
so `tools/smoke/` now serves the repo at exactly that path in headless Chromium
— **41 checks, all passing** (`tools/smoke/run.sh`):
- *Pages and map (15).* `index.html` and `map.html` both load at the subpath
  with no uncaught errors, Leaflet initialises, the tile URLs it builds are
  well-formed `z/x/y.png`, tiles paint, all 9 seeded markers render, and
  `#stop=6a` selects stop 6a and round-trips through the hash.
- *Geocode / export / PNG (19).* The real `Geocoder` against a stub serving
  Nominatim's actual `jsonv2` shape: the request is
  `…/search?format=jsonv2&limit=1&addressdetails=0&q=Naples%2C%20FL%2C%20USA`,
  the ≥1s gate holds (1107ms measured), and six lookups cost three network
  calls because hits *and* misses cache. Export JSON downloads valid JSON with
  all 9 shows; Download PNG downloads a real 1080×1080 PNG (signature and
  dimensions read back off disk).
- *Degradation (7).* The two failure modes a visitor can actually hit. With
  cdnjs blocked as an adblocker would block it, `window.L` is absent and the
  ledger, its rows and the add-show drawer all still work with no uncaught
  errors; with Leaflet loaded but tiles refused, the markers still draw. **A
  CDN or tile failure cannot take the ledger down** — which also means a
  fault on the live site will be visibly local to the map.

What this does *not* prove is the other half of each contract: the harness
intercepts the blocked hosts and answers for them, so it verifies what the app
asks for and does with the answer, not that cdnjs, OpenStreetMap or Nominatim
answer that way. That still needs one pass in a real browser.

**Phase 6 (2026-09-04).** 56 checks in `tools/smoke/04-splitter-view-roads.cjs`,
all passing, bringing the harness to **97**. The divider: dragging widens the
map and the canvas with it, the width is written to the layout setting and
comes back on reload, dragging past either edge still leaves a usable list and
a usable map, the arrow keys move it, it is a labelled `separator`, it
disappears when the layout stacks below 1024px, and the map page remembers its
own width separately from the ledger. The view toggle: Map hides the list and
gives the map the full width, **the map node is the same DOM node before and
after** (so Leaflet keeps its state), the markers survive, the choice is
remembered, and the full-map link is in the header. The hover pan: the
duration really is `.85s`, and sweeping eight rows quickly calls `panTo`
**once**, verified by instrumenting `L.Map.prototype.panTo`. The road route:
the request is lon,lat pairs asking for geojson, the cached geometry is the
router's 40-point line rather than the 6 stops, the points are `[lat,lng]`
pairs in Florida, a reload serves it from cache with **no second request**,
and the drawn path is provably different from the straight one — the same
season and viewport drawn with the router failing gives a different `d`, which
is what proves the reply reached the screen. Failure modes: a refused router
leaves the straight line, the markers and the ledger untouched with no
uncaught error and nothing cached; a router that hangs for 4s does not stop
the route appearing. Plus no horizontal overflow at 1280 / 900 / 390px, and in
map view.

Removed while in there: `upgradeToRoads()` briefly set an `is-road` class via
`mainLine.getElement()`, which **Leaflet does not define on paths** — only on
markers and overlays. It was dead code of exactly the kind the
`document.fonts.check()` bug had already cost this project once, so it and its
CSS went rather than reaching into Leaflet's private `_path` for a cosmetic
opacity change.

**Re-run 2026-09-04 (later session).** `tools/smoke/run.sh` still passes
**97/97** (15 + 19 + 7 + 56) on this branch with no code changes, and
`git diff origin/main HEAD -- tracker/` is empty, so what the harness drove is
what is deployed. The five external hosts were re-checked once more and the
proxy still answers **403 to CONNECT** for `yitzhach.github.io`,
`cdnjs.cloudflare.com`, `tile.openstreetmap.org`, `nominatim.openstreetmap.org`
and — newly confirmed, it had not been probed directly before —
`router.project-osrm.org`. `fonts.googleapis.com` and `fonts.gstatic.com`
remain reachable. So the real-browser checks below are still open and nothing
was changed on speculation: the legacy `{s}.` tile URL in `tracker/map.js` is
deliberately left alone until a browser says tiles are missing, and the
straight-line route fallback stays as designed.

**Phase 7 (2026-09-04, re-run green 2026-09-05).** 54 checks in
`tools/smoke/05-hide-vsplit-catalogue.cjs` plus 3 added to the Phase 6 file,
taking the harness to **159**, all passing. The vertical divider: dragging
makes the map taller, the height is remembered and returns on reload, arrow
keys work, and it cannot be collapsed to nothing. Hiding: the row greys, the
pin leaves the map, the show stays in the ledger and in the season stats,
Export data still carries it (`hidden:true`), the state survives a reload, the
eye does not open the drawer, and unhiding puts the pin back. The catalogue:
202 cards render, each carries its Zapplication link opening in a new tab with
`rel="noopener noreferrer"`, search and the deadline and state filters narrow
it, a like is saved, a keyboard rating is saved, Add to ledger writes through
`AST.Store` keeping the link and the catalogue id, **the added show is
geocoded and appears as a tenth pin on the ledger's map**, "hide what's
already in the ledger" works, and a show you add yourself is stored apart from
the shipped file. Two checks confirm the catalogue does **not** leak into the
ledger: a fresh ledger still has exactly the 9 seeded shows, and liking adds
nothing. Plus no horizontal overflow at 1280 / 900 / 390px on the new page.

Two bugs were found this way and fixed. The `@container` rule that collapses
the show row in a narrow column **did nothing**, because it sat above the base
`.row-grid` rule and at equal specificity the later rule wins — map view
rendered the six columns squeezed to one word per line. There is now a check
asserting the row really collapses to two columns. And `.card-acts` was
`flex:none`, so the Zapp link and Add button together overflowed a narrow
card by 5px; they now wrap.

**A date-dependent flake in the harness, fixed 2026-09-05.** The catalogue
test added *whichever card was first*, but the "deadline still open" filter is
relative to today, so the first card changes as deadlines pass: on 2026-09-04
it was Bar Harbor, a city the Nominatim stub knows, and by 2026-09-05 it was
Algonquin, which the stub correctly answers with no match — so the two
geocoding checks failed on a test that had aged, not on anything the app does.
It now pins a fixed record (West End Arts Festival, La Grange IL) by search
with the deadline filter off, and asserts it found exactly that one card, so
the run no longer depends on the date. **No app code changed.** That is the
54th check.

**Phase 8 (2026-09-05).** 46 checks in `tools/smoke/06-list-view-sorts.cjs`,
taking the harness to **205**, all passing. The list view: 202 rows and no
cards, the column headings appear and go again when the list is empty, the
row keeps its Zapp link (new tab, `rel="noopener noreferrer"`), its like, its
rating and its Add button, liking and rating both work *from a row*, and the
choice is remembered across a reload. The sorting: A–Z and its exact reverse,
event date oldest-first with **every adjacent pair checked against the ISO
dates in the model** rather than the rendered text, "newest to oldest" proved
to be the same list reversed end for end, deadline soonest-first, rating
defaulting to highest-first with the unrated sinking when reversed, the arrow
carrying a written label, picking a key resetting the direction to its natural
one, and the key and direction both surviving a reload. Search: a city, a full
state name, the two-letter code, two words that must both match, and a miss
saying so rather than silently showing everything. Plus no horizontal overflow
at 1400 / 1280 / 900 / 390px in list view.

**Not verified from here:** the cdnjs, OpenStreetMap tile and Nominatim
requests themselves, and the live Pages URL. Re-checked 2026-09-04 and all
four hosts are still refused by the sandbox's egress policy — the proxy
answers 403 to CONNECT for `yitzhach.github.io`, `cdnjs.cloudflare.com`,
`tile.openstreetmap.org` and `nominatim.openstreetmap.org`. That is an
organization policy denial, not a transient failure, so it cannot be retried
or routed around from here. `fonts.googleapis.com` remains reachable (it
opened up on 2026-09-03, which is how Montserrat got verified). For the same
reason Leaflet still carries no Subresource Integrity hash.

**Montserrat now verified (2026-09-03).** Google Fonts had been blocked from
the build sandbox; `fonts.googleapis.com` and `fonts.gstatic.com` are now
reachable, so the real webfont was fetched and the card was drawn in it at
last — square and story, light and dark. It looks right: the wide-tracked
kicker, the light-weight display name and the hairline all read as intended.

Getting there exposed a real bug, now fixed. `ensureFonts()` decided whether
the webfont had arrived with `document.fonts.check('400 100px Montserrat')`,
**which is always true.** Per the CSS Font Loading spec `check()` reports
whether the text could be rendered *at all*, and an unmatched family simply
resolves down the fallback stack — so it returns true for a family that is
entirely absent, on a blank page with no `@font-face` rule anywhere. (Checked
directly: it returns true for a randomly generated family name.) The card was
therefore drawing in Helvetica while reporting that Montserrat was in, and the
"Montserrat did not load" message in the share panel could never fire — the
one safeguard this was supposed to have.

`ensureFonts()` now measures instead: it draws a mixed-glyph probe in
Montserrat and in a family guaranteed not to exist, over each of the three
generic tails (`serif`, `sans-serif`, `monospace`), and calls the font present
only when it displaces all three. Verified in both directions against the real
woff2 — served, `ensureFonts()` is true and the panel shows no warning;
blocked, it is false and the warning appears. The old code returned true in
both cases.

Phase 3 has never touched a **real** Supabase project — only a mock
implementing the same endpoints. Before trusting it: create a project, run
`docs/supabase-schema.sql`, paste the URL and anon key into the account panel,
and sign in on two devices. Two things only a real project can confirm are
that the magic-link redirect URL is allow-listed in Supabase's auth settings
(Authentication → URL Configuration), and that the RLS policies behave as
written.

## Next step
All five phases in `docs/BUILD_PROMPT.md` are built, and Phase 6 is live. What
is left is real-data and real-service work, not new phases. **Both of the top
two items are blocked on something only you can supply** — the xlsx, and one
pass in a real browser — and neither was unblocked on 2026-09-04:

- **Backfill stops 8-12** (through Apr 18) — *still the first thing to do, and
  still blocked on the source file.* The CSV import exists: save the xlsx's
  Application Calendar tab as CSV, open **Import shows → CSV file**, map the
  columns, and commit. Attempted 2026-09-03 and could not be started:
  `Isaac_Anderson_2027_Art_Show_Application_Calendar.xlsx` is not in the repo
  and was not available to the session, and stops 8-12 exist nowhere in the
  repo either (`tracker/core.js` seeds 1-7 and says so). The data cannot be
  reconstructed — inventing show names, dates, deadlines and fees would put
  fiction into the source of truth. **Attach the xlsx (or a CSV of the
  Application Calendar tab) and this is a ten-minute job.** The share card is
  thin until it is done: it currently shows six stops ending Feb 6.
- **Point Phase 3 at a real Supabase project** and sign in on two devices —
  see the caveat under Verified. Two things only a real project can confirm:
  the magic-link redirect URL is allow-listed (Authentication → URL
  Configuration), and the RLS policies behave as written.
- **Smoke-test the live deploy** (https://yitzhach.github.io/newTEST/tracker/)
  — *the app's side is now verified; what is left needs a real browser.*
  Attempted 2026-09-04 and the live URL could not be opened from the session:
  `yitzhach.github.io` is refused by the egress policy along with cdnjs, the
  OSM tiles and Nominatim (see Verified). What was done instead was to serve
  the repo locally at the same subpath over https and drive it — 41 checks,
  all passing, so the page wiring, the tile URL construction, the Nominatim
  request, Export JSON and Download PNG are all known good on the app's side.
  Three things still need one pass in a real browser, and only these:
  - **Do OSM tiles actually paint?** If they do not, suspect number one is
    the tile URL: `map.js` uses the legacy subdomain form
    `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`, while OSM's current
    tile usage policy documents `https://tile.openstreetmap.org/{z}/{x}/{y}.png`
    with no subdomain. The `a`/`b`/`c` subdomains are believed to still
    resolve, so this was **deliberately not changed blind** — it is a
    one-line fix in `tracker/map.js` the moment a real browser says tiles are
    missing. Check `map.html` and `#stop=6a` while there.
  - **Does Nominatim answer for these Florida city names?** The request shape
    is verified; what is not is the service's replies. Nominatim sends
    permissive CORS, so a browser call should work.
  - **Download PNG / Export JSON in a real browser.** Both verified headless;
    this is confirming the browser's own download path.
  A failure in any of these is local to that feature — the degradation checks
  show a dead CDN or dead tiles cannot take the ledger down with them.
- **Add verified Subresource Integrity hashes** to the two Leaflet tags. Still
  blocked, re-checked 2026-09-04 — `cdnjs.cloudflare.com`, `api.cdnjs.com`,
  jsDelivr and unpkg are all still refused. `registry.npmjs.org` *is* reachable
  now, but the npm tarball is not evidence of the bytes cdnjs serves, so
  hashing it would be the same guess by another route. Original note
  (2026-09-03): `cdnjs.cloudflare.com`, `api.cdnjs.com` (which
  serves the official hashes), jsDelivr and unpkg are all refused by the
  sandbox gateway, so no hash can be computed against the bytes cdnjs will
  actually serve. Deliberately not guessed from the npm tarball — a wrong SRI
  hash does not degrade, it stops Leaflet loading altogether, and the map
  works today.
- ~~Look at one share card with Montserrat actually loaded~~ — **done
  2026-09-03**, and it turned up a bug in the webfont detection that is now
  fixed. See "Montserrat now verified" under Verified.
- **Publish the embed**: paste the self-contained snippet into
  isaacandersonart.com, or upload `embed.html`, `core.js`, `share.js` and
  `shows.json` and use the iframe snippet.
- The 331 Phase 4 + Phase 5 checks still live in the build sandbox rather than
  the repo — committing a runner is parked in `docs/FUTURE_BUILD.md` under
  Technical.
- **The root site does not run as deployed**, and never did — the Pages
  workflow uploads the repo unbuilt, so `index.html` at the root asks the
  browser for `/index.tsx` (raw TypeScript) and an `/index.css` that is not in
  the repo. Untouched by the tracker work and out of its scope, but it is the
  first thing anyone opening the bare Pages URL will hit. Fixing it means
  giving the workflow a real Vite build step, or leaving the root to the
  portfolio's own hosting.
