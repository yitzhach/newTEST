# Starting a fresh session on this project

The point of this file is to let a new chat pick the project up **without
re-reading the codebase or re-deriving decisions that are already made**. Every
question a new session would otherwise burn tokens rediscovering is answered
either here or in `handoff.md`.

---

## The prompt to paste

Copy everything between the lines into a new Claude Code session on this repo.

---

> Working on the members' intel network in `yitzhach/newTEST`, branch
> `claude/fine-art-show-tracker-6vtn52` (merged to `main`; PRs #1 and #2).
>
> **Read `docs/handoff.md` first and treat it as authoritative.** It covers the
> model, the three data layers, the honesty constraints, the file map and the
> open threads. Do not re-derive any of it, and do not re-read the whole
> codebase — open only the files you actually need to change.
>
> Live site: https://yitzhach.github.io/newTEST/tracker/browse.html
> (GitHub Pages deploys from `main` only.)
>
> Ground rules that are already settled — do not relitigate:
> - Ten factors, ten fine-art disciplines. No jewellery, nothing wearable.
> - A factor with no data is **null** and drops out of the weighted average.
>   It never defaults to 5.
> - Facts / editorial estimates / member intel are three separate layers with
>   per-field provenance. Nothing marked `verified` unless a real page was read.
> - Private reports never leave the device. The Worker refuses to store one.
> - The conduct standard is built into the form, not a terms page.
>
> Before you finish: run the three test suites (below) and push.
>
> What I want to work on: **[SAY WHAT YOU WANT HERE]**

---

## Running the tests

```bash
python3 -m http.server 8765          # from the repo root, leave running
node build/browser-tests.cjs         # 37 checks — model, drawer, provenance
node build/ledger-view-tests.cjs     # 21 checks — details/link, badges, lenses
cd worker && npm test                # 45 checks — the API and its invariants
```

Playwright is needed for the two browser suites: `npm i -D playwright`.

## Rebuilding the data

```bash
python3 build/build_fit_data.py      # rewrites tracker/fit-data.json AND catalogue.json
```

`build/catalogue-source.json` is the pristine input and is never written to.
Research goes in through `build/record_research.py`, which **rejects any batch
where a fact or a factor arrives without a provenance entry**.

---

## Where things stand

**Done and deployed:**
- The ten-factor model, ten disciplines, price bands, season strategies
- Three scoring lenses: Model fit / My results / The network
- Member reports with three visibility tiers and the conduct check
- 37 of the top 50 shows deep-researched with sourced provenance
- Cloudflare Worker + D1, complete and tested, **not deployed**

**Not done:**
1. **Deploy the Worker.** `worker/README.md` has the sequence. Until then the
   site runs in solo mode and nothing is shared between artists. This is the
   single biggest unlock — everything else is refinement.
2. **Finish the research.** 13 of the top 50, then a fast sweep of the other
   186. A session with open network egress should also re-verify the 37 already
   done and upgrade `search` provenance to `verified`.
3. **Confirm 32 estimated dates** against ZAPP and show sites.
4. **A net-based lens.** The reported lenses rank on factor ratings; ranking on
   reported net is the obvious next step.
5. **Route planning.** Called the natural next tool in the original handoff and
   still is. Ranking has hit diminishing returns; scheduling has not.
6. **The community layer.** Specified in `community-build.md`. Not worth
   building below ~20 active members.

---

## Things a fresh session will get wrong unless told

**The sandbox blocks art-show websites.** `zapplication.org`, `cherryarts.org`
and every other show domain are refused by the egress proxy. WebSearch works.
This is why nothing from the research pass is marked `verified` — do not
"upgrade" those grades without actually opening the page.

**`github.io` is blocked too**, so a session cannot verify the live site by
fetching it. Check the deploy through the GitHub Actions API instead.

**Pages deploys from `main` only.** Work on a branch is not live. Merging is
what publishes.

**Playwright needs a pinned Chromium** at
`/opt/pw-browsers/chromium-*/chrome-linux/chrome`; the test files fall back to
Playwright's own resolution when that path does not exist.

**The tracker is a no-build-step, classic-script codebase.** No ES modules, no
bundler, no framework. `type="module"` is blocked over `file://` and the whole
point is that it opens by double-click. Keep it that way.
