# Future build — parked ideas

Anything deliberately out of the current phase lands here instead of
half-built in the code. Add to the top of each section as it comes up.

## Multi-artist / SaaS
- Accounts, per-artist workspaces, billing. Supabase RLS from Phase 3 is
  already the right shape for this.
- A shared, community-maintained show database: one canonical record per
  show per year that everyone's tracker points at, with per-artist private
  overlay (status, rating, notes). This is the real product moat.
- Fit scoring: rank shows by medium, price point, past sales, jury history,
  drive distance from home, and prior acceptance rate.

## Zapplication
- **Read .xlsx directly** instead of asking for a CSV export. Needs SheetJS
  or similar from a CDN, which is a dependency whose build path can't be
  verified from the sandbox — and the CSV path already covers the case. Park
  it until the app has a build step.
- **Remember a column mapping** per file shape, so re-importing next year's
  calendar skips the mapping step. Trivial once there's somewhere sensible to
  keep named profiles.
- **Geocode the venue, not the city.** Right now Nominatim is asked for
  "city, state, USA", which puts the pin in the middle of town rather than at
  the park the show is in. Wants a street-address field on the model first.
- **Auto-assign stop numbers on import.** Deliberately not done: imported
  shows land with a blank stop number because the route order is a decision,
  not a derivation, and guessing it would quietly reorder the season.
- Bookmarklet that grabs a show off the Zapp page you're viewing, using your
  own logged-in session. Lower risk than a crawler, much faster than pasting.
- Watch for a real Zapp/WESTAF API or data partnership before ever building
  an automated scraper — a crawler likely breaks their terms and will break
  on any redesign.
- Other platforms once Zapp works: EntryThingy, JurorPro, ShowClix, direct
  show sites.

## Share and export
- **A public read path in Supabase** so the iframe embed follows the tracker
  by itself. Phase 3's RLS is owner-only, which is correct for the ledger but
  means an anonymous embed cannot read the table — hence `shows.json`, which
  has to be re-uploaded when the season changes. Wants a `public_shows` view
  (or a per-artist share token) plus a policy allowing anon select on it.
- **A carousel of cards** — one slide per show instead of one card for the
  season, which is what most artists actually post.
- **A poster per show** (venue, booth number, hours) for the week of a show.
- **The route map on the card.** Leaflet tiles cannot be drawn into a canvas
  without a tile-side CORS header, so this needs a static map image service,
  which needs an API key — the first paid dependency in the project.
- **A QR code** on the story card pointing at the schedule page.
- **.ics export** — already parked under Tracker features; the share panel is
  where it belongs when it happens.
- **Remember more than one share preset** (a caption voice for Instagram, a
  drier one for email), rather than one set of preferences.

## Travel and money (the monetizable layer)
- Per-leg lodging, van/truck rental, and flight lookups with affiliate links.
- Cost model per show: booth + jury + travel + lodging + estimated hours,
  against recorded sales, giving a real profit-per-show ranking.
- Multi-year history so "worth reapplying?" is answered by your own numbers.
- Shared-booth / caravan matching with other artists on the same route.

## Tracker features
- Route optimizer (shortest drive that hits the accepted shows) rather than
  strict date order.
- Calendar export (.ics) for show dates and application deadlines.
- Email/SMS deadline reminders.
- Inventory: which pieces travelled to which show, what sold, what came home.
- Photo per show; booth-layout notes.
- Weather history for each show weekend.
- Public artist page with the upcoming schedule (extends the Phase 5 embed).

## Technical
- Move off the single file to a real app (Vite/React) once the file splits.
- Offline-first with a service worker; the app is used in fields with bad
  signal.
- Tests: the Zapp parser and the date/deadline logic are the two places bugs
  will actually hurt. Phase 4 has 232 checks (Node + headless Chromium) but
  they live in the build sandbox, not the repo — commit a runner once there
  is a build step to hang it off.
