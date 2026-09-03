# Build prompt — Art Show Tracker (paste this into a fresh chat)

You are building the Art Show Tracker. Read `CLAUDE.md`, `PROJECT_STATE.md`
and `docs/FUTURE_BUILD.md` first. Work on branch
`claude/artist-show-tracker-5pavpl`. Commit at the end of each phase and
update `PROJECT_STATE.md` before the chat ends. Be brief in chat.

## The product
A tracker for one artist's show season: upcoming shows in date order, a real
map of the route, ratings and notes per show, deadline tracking, import from
Zapplication by paste, and export for posting to a website / Instagram.
Design direction **A — Show Ledger** (already approved; see
`design/Main.dc.html` for the layout that was signed off).

## Fixed decisions — do not relitigate
- **One file: `tracker/index.html`.** No build step, no bundler. Opens by
  double-click, hostable anywhere. Vanilla JS (ES modules inline), no React.
- **Storage goes through one adapter** (`Store`) with methods
  `list/get/upsert/remove/replaceAll`. Phase 1 implements `LocalStore`
  (localStorage). Phase 3 adds `SupabaseStore` behind the same interface.
  Nothing outside the adapter may touch storage directly.
- **Map: Leaflet 1.9.4 + OpenStreetMap tiles** from cdnjs. No API key.
  Numbered markers matching the list. Hover a row → its marker highlights and
  the map pans; hover a marker → its row highlights.
- **Responsive single file, no separate mobile file.** Desktop ≥1024px:
  list + right rail (map, deadlines). 768–1023: list + collapsible map.
  <768: list only, map opens as a full-screen sheet. Touch targets ≥44px.
- **Light and dark mode**, `data-theme` on `<html>`, tokens in `:root`,
  system default with a manual toggle persisted in localStorage.
- **No scraping of Zapplication.** Import is paste-and-parse plus CSV.

## Visual language (from isaacandersonart.com)
Montserrat (300/400/600) via Google Fonts, with a system fallback stack.
Uppercase, wide letter-spacing (0.15–0.2em) for headers and labels; light
weights for display type; generous whitespace; near-black/near-white ground,
almost no chrome. One accent only. Suggested tokens — confirm against the
live site if reachable:

```
light:  --bg #ffffff  --surface #fafaf9  --ink #171717  --muted #737373
        --line #e5e5e5  --accent #2f5d4f
dark:   --bg #0f0f0f  --surface #171717  --ink #f5f5f4  --muted #a3a3a3
        --line #262626  --accent #7fb09c
status: applied #6366f1  accepted #2f5d4f  waitlist #b45309  declined #737373
```
No gradients, no emoji, no rounded-corner-with-left-border-accent cards.
Icons: inline stroke SVG on a 20px grid.

## Data model (`Show`)
```
id, name, city, state, lat, lng,
startDate, endDate, applyBy,          // ISO yyyy-mm-dd
status: 'interested'|'applied'|'accepted'|'waitlist'|'declined'|'not_applying',
rating: 0-10,                          // 10 half-stars; 0 = unrated
juryFee, boothFee,                     // numbers, nullable
routeNumber,                           // "1", "2a", "6c" — display + map label
isAlternate: bool,                     // lettered alternates
notes,                                 // free markdown-ish text
url, source: 'manual'|'zapp_paste'|'csv',
createdAt, updatedAt
```
Seed from the 2027 Florida list in `PROJECT_STATE.md` / the handoff doc.
Persist a `schemaVersion` and write a migration hook from day one.

---

## Phase 1 — Core tracker (ship this first)
1. `tracker/index.html` shell: header, theme toggle, light/dark tokens.
2. `LocalStore` + `Show` model + seed data + JSON export/import buttons.
3. Show list in date order: route number, name, city, dates, apply-by,
   status pill, rating. Sort by date / deadline / rating. Filter by status.
4. Add/edit drawer: every field above, inline validation, delete with undo.
5. Rating control: 1–10, keyboard accessible, clears to unrated.
6. Notes field per show, autosaved.
7. Deadline panel: next 5 apply-by dates, days remaining, colour-coded.
**Done when:** you can add, edit, rate, note, delete and reorder your real
2027 season, close the browser, reopen, and it is all still there.

## Phase 2 — Map
1. Leaflet map in the right rail with numbered markers.
2. Two-way hover/focus highlight between list and map.
3. "Open route in Google Maps" and "Open in Apple Maps" — waypoints in date
   order, alternates excluded. Google caps at ~10 waypoints; split into legs
   and say so in the UI rather than silently truncating.
4. Draw the route line between stops in date order; dashed line to alternates.
5. `tracker/map.html` — full-page map view, same data, deep-linkable to a
   stop (`#stop=6a`). Reuse the same module; do not fork the code.
**Done when:** hovering a row lights its pin, and one click hands the whole
route to Google or Apple Maps.

## Phase 3 — Supabase
1. `shows` table mirroring the model, RLS on, `owner_id = auth.uid()`.
2. Magic-link auth; anon key in the file is fine, service key never is.
3. `SupabaseStore` implementing the adapter; a settings panel to enter
   project URL + anon key, stored locally.
4. Sync strategy: last-write-wins on `updatedAt`, with a visible "offline —
   changes saved locally" state. Local data migrates up on first sign-in.
**Done when:** the same season shows up on phone and laptop.

## Phase 4 — Zapplication import
1. Paste box: accepts text copied from a Zapp search-results or
   My-Applications page.
2. Parser → candidate rows (name, city/state, show dates, deadline, fees)
   with a confidence flag per field.
3. Review table before commit: fix any field, tick which to import, dedupe
   against existing shows by name+year.
4. CSV import for the existing xlsx (map columns in the UI, don't hardcode).
5. Geocode new shows via Nominatim (respect the 1 req/sec policy, cache
   results, fall back to a manual lat/lng field).
**Done when:** a Zapp page becomes ten reviewed show records in under a minute.

## Phase 5 — Share and export
1. Canvas-rendered share card: 1080×1080 and 1080×1920, artist name, next
   N shows, dates, cities, in the site's type. Download as PNG.
2. Copyable text block of upcoming shows for captions and email.
3. `<iframe>`/script embed snippet for isaacandersonart.com that renders the
   upcoming list read-only.
4. Share buttons: Facebook share URL, X intent, "copy link", and for
   Instagram download-the-image plus copy-the-caption (there is no web API
   to post to IG — do not pretend otherwise in the UI).
**Done when:** one click gives a postable image and a matching caption.

## Rules while building
- After each phase: commit, update `PROJECT_STATE.md`, and tell me to start
  a fresh chat.
- Anything deferred goes in `docs/FUTURE_BUILD.md`, not into the code as a
  half-feature.
- Keep the single file readable: section banners, one concern per module
  block. If it passes ~2500 lines, split into `tracker/app.js` +
  `tracker/app.css` and say so.
