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
- Bookmarklet that grabs a show off the Zapp page you're viewing, using your
  own logged-in session. Lower risk than a crawler, much faster than pasting.
- Watch for a real Zapp/WESTAF API or data partnership before ever building
  an automated scraper — a crawler likely breaks their terms and will break
  on any redesign.
- Other platforms once Zapp works: EntryThingy, JurorPro, ShowClix, direct
  show sites.

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
  will actually hurt.
