# Smoke harness — tracker over real HTTP

Dev-only. Nothing in `tracker/` references these files; they are not part of
the app and deleting the directory costs nothing.

## Why this exists
Every earlier phase was tested over `file://` against local stubs. The app is
now served from GitHub Pages at a **subpath** (`/newTEST/tracker/`) over
**https**, which is a shape it had never run in. These harnesses serve the
repo at that exact path over real HTTP and drive it in headless Chromium.

## What they cover (158 checks)
- `01-pages-and-map.cjs` (15) — `index.html` and `map.html` load with no
  uncaught errors at the subpath, Leaflet initialises, tile URLs are
  well-formed and paint, 9 markers render, the `#stop=6a` deep link selects
  stop 6a and round-trips through the hash.
- `02-geocode-export-png.cjs` (19) — the real `Geocoder` module against a
  stub serving Nominatim's `jsonv2` shape: the request URL, the ≥1s rate
  gate, cache hits, cached misses (3 network calls for 6 lookups). Then
  Export JSON (valid JSON, 9 shows) and Download PNG (real PNG signature,
  1080×1080).
- `04-splitter-view-roads.cjs` (56) — Phase 6: the draggable divider
  (drag, clamp, persist, keyboard, hidden when stacked, separate width per
  page), the List/Map view (same DOM node before and after, so Leaflet keeps
  its state), the hover pan (`.85s`, and one `panTo` for an eight-row sweep),
  and the road-following route (request shape, cached geometry, cache hit on
  reload, and a provably different line from the straight fallback) plus its
  failure and timeout paths.
- `05-hide-vsplit-catalogue.cjs` (53) — Phase 7: the vertical map resize,
  hiding a show from the route (greys out, leaves the map, stays in the ledger
  and the exports, survives a reload), and the All shows catalogue (202 cards,
  Zapp links, filters, like, rate, Add to ledger through the Store, automatic
  geocoding, and two checks that the catalogue never leaks into the ledger).
- `03-degradation.cjs` (7) — the failure modes a visitor can actually hit:
  cdnjs blocked by an adblocker (ledger and drawer still work, no uncaught
  errors) and tiles refused while Leaflet loads (markers still drawn).

## What they cannot cover
The four hosts the build sandbox is denied by egress policy —
`yitzhach.github.io`, `cdnjs.cloudflare.com`, `tile.openstreetmap.org`,
`nominatim.openstreetmap.org` — are all intercepted and served locally. These
prove the **app's** side of each contract; they cannot prove those services
answer as expected. That still needs one pass in a real browser.

## Run
    ./run.sh

Files are `.cjs` because the repo root's `package.json` (the unrelated
portfolio's) sets `"type": "module"`.
