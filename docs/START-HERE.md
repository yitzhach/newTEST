# START HERE

Read `docs/handoff.md` first — it is authoritative for the model, the three
data layers, the honesty constraints, the file map and the open threads. This
file is the shorter thing: what is done, what to do next, and what the
environment will get wrong if nobody warns it.

Live: https://yitzhach.github.io/newTEST/tracker/browse.html

---

## Fresh-chat prompt

Paste this at the top of a new session, then say what you want:

> Working on the members' intel network in `yitzhach/newTEST`.
>
> Read `docs/handoff.md` first and treat it as authoritative — it covers the
> model, the three data layers, the honesty constraints, the file map and the
> open threads. Don't re-derive any of it, and don't re-read the whole
> codebase; open only the files you need to change. Then read
> `docs/START-HERE.md` for what's done, what's next, and the environment
> gotchas.
>
> Live site: https://yitzhach.github.io/newTEST/tracker/browse.html
>
> Run the three test suites before you finish, and push.
>
> What I want to work on: …

That points a cold session at two files instead of forty.

---

## What is done

Both merged to `main` and live:

- **PR #1** — members' intel network: fit ranking by discipline, artist
  reports, the Cloudflare backend.
- **PR #2** — ledger view: details on the name, three scoring lenses, report
  badges.

So: ten factors, ten disciplines, four price bands, five season strategies,
three scoring lenses, 236 shows, member reports with three privacy tiers and a
tone check, and a complete Worker + D1 backend.

The site runs in **solo mode**. Everything works, nothing is shared — every
report stays in the browser and behaves as private.

## What is next

**Deploy the Worker.** Nothing is shared between artists yet, and that is the
whole premise. `worker/README.md` has the full sequence: create D1 + KV + R2,
paste the two ids into `wrangler.toml`, set `SESSION_SECRET`, `IP_SALT` and
`BOOTSTRAP_CODE` as secrets, apply migrations, set `ALLOWED_ORIGINS`, deploy,
then paste the Worker URL into **Network** on the site. The first steward gets
in through `BOOTSTRAP_CODE`, which stops working the moment one member exists.

After that, `docs/handoff.md` §10 has the rest: finishing the research pass,
confirming the 33 estimated dates, per-discipline factor scores, route
planning, images on reports, ranking a lens on reported net.

---

## Environment gotchas

**The sandbox blocks every art-show domain.** `zapplication.org`,
`cherryarts.org`, `naplesart.org` and the rest are refused by the egress
policy. Research runs through web search, which synthesises from results
rather than reading pages. So: **never upgrade a provenance grade to
`verified` without opening the actual page.** `verified` is reserved for
prospectus and application pages read directly, and only the ZAPPlication
export fields have earned it. Search-derived facts are `search`, and render as
*"unconfirmed"*. `record_research.py` rejects any batch missing provenance —
do not route around it.

**Pages deploys from `main` only.** `.github/workflows/static.yml` triggers on
push to `main` (or manual dispatch) and uploads the whole repo. Work lands on
the live site when it merges, not when it is pushed to a branch.

**No build step, deliberately.** `tracker/` is plain HTML, CSS and JS served
as-is; the Worker is plain modules. The Vite/React app at the repo root
(`App.tsx`, `index.tsx`, `vite.config.ts`) is the separate artist site and is
not part of the tracker — do not wire the two together.

**One build script, and it writes two files.** After any data edit:

```bash
python3 build/build_fit_data.py     # rewrites tracker/fit-data.json AND tracker/catalogue.json
```

`build/catalogue-source.json` is the pristine ZAPP export. Read-only input,
never written to.

---

## The three test suites

Run all three before pushing.

A fresh container has no `node_modules`, so install first. Keep Playwright out
of `package.json` — it is a test-only dependency and the repo has no build step
to justify carrying it:

```bash
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install --no-save playwright
cd worker && npm install && cd ..
```

Then:

```bash
python3 -m http.server 8765          # from the repo root, leave running
node build/browser-tests.cjs         # 37 checks — the model, the drawer, provenance
node build/ledger-view-tests.cjs     # 21 checks — details/link split, badges, lenses
cd worker && npm test                # 45 API checks — manages its own worker
```

All three pass on `main` as of the last session: 37/37, 21/21, 45/45.

`ledger-view-tests.cjs` files a report, so it clears `localStorage` first and
runs standalone. The worker suite starts and stops its own `wrangler dev`.
Chromium is preinstalled at `/opt/pw-browsers` — do not run
`playwright install`.
