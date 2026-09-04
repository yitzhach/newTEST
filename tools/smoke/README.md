# Smoke harness — tracker over real HTTP

Dev-only. Nothing in `tracker/` references these files; they are not part of
the app and deleting the directory costs nothing.

## Why this exists
Every earlier phase was tested over `file://` against local stubs. The app is
now served from GitHub Pages at a **subpath** (`/newTEST/tracker/`) over
**https**, which is a shape it had never run in. These harnesses serve the
repo at that exact path over real HTTP and drive it in headless Chromium.

## What they cover (41 checks)
- `01-pages-and-map.cjs` (15) — `index.html` and `map.html` load with no
  uncaught errors at the subpath, Leaflet initialises, tile URLs are
  well-formed and paint, 9 markers render, the `#stop=6a` deep link selects
  stop 6a and round-trips through the hash.
- `02-geocode-export-png.cjs` (19) — the real `Geocoder` module against a
  stub serving Nominatim's `jsonv2` shape: the request URL, the ≥1s rate
  gate, cache hits, cached misses (3 network calls for 6 lookups). Then
  Export JSON (valid JSON, 9 shows) and Download PNG (real PNG signature,
  1080×1080).
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
