# Show Ledger — members' intel network

Pick-it-up-cold notes. This supersedes the original `HANDOFF.md` for the fit
model, and carries its honesty constraints forward unchanged.

---

## 1. What this is

A members-only tool for a network of professional fine artists, layered onto
the existing show tracker at `yitzhach.github.io/newTEST/tracker/`.

It does three things:

1. **Ranks 236 shows by fit** for a specific artist — their medium, their price
   range, what they want out of the season — rather than by whose gross sales
   were biggest.
2. **Records what artists actually found there.** Sales, costs, load-in,
   who was in the aisle. Private, anonymous, or signed.
3. **Never lets an estimate pass itself off as a fact.** Every number on screen
   says where it came from.

The public tracker is unchanged and still works for anyone. The intel layer is
invite-only.

---

## 2. Why it exists

Sunshine Artist's *200 Best* ranks on artist-reported gross, pooled across
every price point. The Art Fair SourceBook ranks on net average sales. Both are
paywalled, neither publishes per-show figures openly, and both answer a
question most fine artists are not asking: *where did the most money change
hands?* A show that moves 4,000 pieces at $150 outranks one where forty people
buy at $4,000.

For a sculptor selling at $8,000 that ranking is not merely unhelpful, it is
backwards. This model asks instead: **which shows are the best business
opportunity for the work I actually make?**

---

## 3. The three layers, and why they never mix

This is the load-bearing design decision. Everything else follows from it.

| Layer | What it is | How the UI shows it |
|---|---|---|
| **Facts** | Dates, fees, booth counts, media juried. Sourced and dated, or null. | `verified` / `corroborated` / `unconfirmed` chips, each linking to its source |
| **Editorial** | The ten factor scores. Informed estimates, never audited data. | dotted `estimate` chip |
| **Intel** | What members reported. The only layer that ever becomes precise. | solid `reported` chip |

A fact with no source is **null**, and renders as *"not known"* — never as a
number. A factor nobody has scored **drops out of the weighted average** and
renders as *"not scored — drops out of your average"*; it never defaults to 5,
because defaulting would pull every under-researched show toward the middle and
make the model look more confident than it is.

The drawer header always states what share of your weighting was actually
covered: *"scored on 91% of your weighting."*

---

## 4. The model

### Ten factors. 10 is always good for the artist.

Where the underlying quantity runs the other way — cost, competition, difficulty
getting in — the factor is named and scored so higher still means better. Never
add a factor that breaks this.

| # | Factor | Note |
|---|---|---|
| 1 | Buyer wealth | |
| 2 | Fine art orientation | vs craft, gift and production work |
| 3 | High price tolerance | is your top-of-range sale realistic here |
| 4 | Sales track record | reported, not audited |
| 5 | Prestige & standing | |
| 6 | Qualified traffic | buyers, not band-goers. **Not** raw headcount |
| 7 | Cost efficiency | higher = cheaper |
| 8 | Thin field in your medium | higher = fewer rivals. Per-discipline |
| 9 | **Logistics & booth fit** | higher = easier. Per-discipline. **New** |
| 10 | **Jury odds** | higher = more realistic to get in. **New** |

Factors 1–7 carry over from the original eight-factor model unchanged. The old
factor 8 was *Low 2D Competition*, which only made sense for a painter; it
generalises to the artist's own medium, and the 2D value is retained in
`byDiscipline` for the 2D disciplines with the generalisation flagged in
provenance.

Factors 9 and 10 are new and **start null on every show**. The original handoff
named jury odds as the missing ninth factor; it is here now, populated from
published acceptance rates where they exist. Three shows publish one:

| Show | Places | Applicants | Rate |
|---|---|---|---|
| Saint Louis Art Fair | 145 | ~1,000+ | ~14% |
| Plaza Art Fair | 240 | 1,400+ | ~17% |
| Des Moines Arts Festival | 195 | 953 | ~20% |
| Gasparilla Festival of the Arts | 233 | 1,000+ | ~23% |

Laumeier publishes its jury *method* rather than a rate: two rounds, top third
advance. The effective acceptance is well under a third.

### Ten disciplines. Fine art only.

Painting (oil & acrylic) · Works on paper & drawing · Printmaking ·
Mixed media · Sculpture · Glass · Ceramics (fine art) · Photography & digital ·
Wood (sculptural & turned) · Fiber (non-wearable).

No jewellery, nothing wearable, no craft or production work. Each carries its
own weights over the ten factors, plus a written explanation of *why* those
weights, shown in the "Why this order?" panel.

The differences are real, not cosmetic. Glass weights logistics at 14% — power
and wind are financial risks, and unlit glass does not sell. Sculpture weights
price tolerance at 22% and competition at 2%, because the ceiling is high and
the field is naturally thin. Fiber carries the heaviest fine-art-orientation
weighting in the model, because no category is more dependent on whether a show
treats it as art or as craft.

### Two more axes

**Price band** — under $500 / $500–2k / $2k–10k / over $10k. Applied as a
multiplicative tilt on the discipline's weights, then renormalised. Two oil
painters selling at $600 and $12,000 want opposite calendars out of the same
list.

**Scoring lens** — the third axis, and the one that changes what the number
*means* rather than how it is weighted:

| Lens | Scored from | Shows with no data |
|---|---|---|
| **Model fit** | the editorial estimate, with member consensus replacing it wherever three or more artists have reported | every show scores |
| **My results** | only your own reports | score null, sink to the bottom, render a dash |
| **The network** | only member consensus, and only past the three-report threshold | same |

A lens never falls back to the layer beneath it. A reported lens that quietly
borrows an estimate is not a reported lens, and the whole point of asking
"which shows have actually paid me" is that it is a different question from
"which shows suit work like mine". The factor provenance chips follow the lens
too — under a reported lens they read `reported`, not `estimate`.

**Season strategy** — balanced, build the resume, maximise gross, budget & low
risk, only what is proven. The last one is a discount rather than a weighting:
it multiplies the fit by an evidence factor, so a 9.2 resting on estimate alone
does not outrank an 8.9 with a dozen member reports behind it.

---

## 5. Honesty constraints — carried forward, do not quietly drop

The original handoff flagged that a previous chat produced specific figures that
could not be verified: *"#5 in the 2026 Sunshine Artist ranking," "a $40,000
painting sale at La Quinta," "AFSB 2025: Park City #1."* Both publications are
paywalled and neither publishes a per-show list openly. **None of that has been
reintroduced.** Do not reintroduce it.

**This session's research could not open show websites.** The environment's
egress policy blocked `zapplication.org`, `cherryarts.org`, `naplesart.org` and
every other show domain. Research therefore ran through web search, which
returns facts synthesised from search results rather than pages actually read.

The provenance vocabulary reflects that honestly:

- `verified` — read directly from a prospectus or application page.
  **Reserved. Nothing from this session's research earned it.** Only the
  ZAPPlication export fields carry it.
- `corroborated` — two or more independent sources agree.
- `search` — one search-derived source. Renders as **"unconfirmed"** and links
  out so it can be checked in one click.
- `editorial` — an informed estimate, no source.

A future session with open egress should re-run the research pass and upgrade
`search` to `verified` where the source page confirms it.

**37 of the top 50 shows** have been through the deep pass. The rest keep their
original data, flagged. **32 shows** still sit on estimated rather than
published dates.

Three findings worth acting on before anyone plans a season:

- **Sausalito Art Festival** has been suspended over problems at its Marinship
  Park site. Its Labor Day slot competes with Long's Park and Kings Mountain.
- **Uptown Art Fair** has moved ~4.5 miles out of the Uptown neighbourhood to a
  car park and now runs as **SoMi Art Fair**. Its scores still describe the old
  site and are stale until members report from the new one.

- **Northern Virginia Fine Arts Festival is now the Tephra ICA Arts Festival.**
  Same show, same Reston Town Center site; searching the old name will not find
  the current application.

Also: **"Ann Arbor Art Fair" is not one show.** It is several independently
juried fairs running concurrently across 30 blocks, each with its own jury,
deadline and fee.

### Commission is not in the fit score, on purpose

Kings Mountain charges $20 to jury, $100 for the weekend, and **15% of
everything you sell**. On an $8,000 piece that is $1,200 — against $600 for a
booth at Art in the High Desert, which takes no commission and sits in a state
with no sales tax.

The price band tilts cost efficiency *down* as work gets dearer, which is
correct for a fixed booth fee and exactly backwards for a percentage. Rather
than bend the weighting into something wrong half the time, `gates()` states
the commission plainly with the arithmetic already done for your price band: a
hint at $45 for cheap work, a warning at $2,250 for expensive.

---

## 6. Conduct — built in, not written down

The network is for business intelligence, not grievances. That standard is
enforced by design rather than by a terms page nobody reads:

1. **Structured fields dominate the form.** Numbers, logistics and crowd read
   come first; prose is last and optional. The default output of the form is
   intel, not opinion.
2. **The standard appears at the point of entry**, in the form itself, ending
   with the line it needs to end with: *save the drama for drama class.*
3. **A tone check runs as you type.** It flags personal attacks, accusations of
   dishonesty, calls for someone to be fired, and shouting. It shows you the
   exact phrase it caught and why. It is **advisory and never blocks** — it
   cannot read intent and does not pretend to.
4. **Anonymous reports trip it one flag sooner** than signed ones, because
   anonymity is where the drama hides.
5. **Individuals may be described factually, never characterised.** "The jury
   ran three weeks late and I had booked flights" is intel. "The director is
   incompetent" is not.
6. **Flags go to a human steward.** Nothing is auto-removed.

---

## 7. Privacy

Three tiers, and the difference is real:

- **Private** — yours alone. **Never sent to the server in either mode.** The
  Worker refuses `visibility: "private"` outright and the D1 `CHECK` constraint
  does not permit the value. A server that never receives a private report
  cannot leak one.
- **Anonymous** — visible to members, author withheld. Enforced by *not
  selecting the column* in `shapeForReader()`, the single choke point every
  read passes through.
- **Signed** — with your name, and weighted slightly higher in consensus
  (1.25× against 1.0×). Not enough to let three friends outvote the field;
  enough that a name means something.

**Consensus needs three reports before it publishes anything**, so one weekend
cannot present itself as the network's view. Medians, not means — one artist's
career weekend should not move the number everyone else plans against.

---

## 8. Files

```
tracker/
  fit.js            the model: ten factors, ten disciplines, bands, strategies, gates
  fit-data.json     236 shows: factors, facts, provenance, per-discipline overrides
  intel.js          member report model, consensus, tone check, split store
  intel-ui.js       profile bar, show drawer, report form, network panel
  members.js        invite-only auth client; solo mode when no network configured
  intel.css         the intel layer's styles, on app.css's tokens
  browse.html       integrated: fit chips, fit sort, discipline filters, drawer
  catalogue.json    236 shows (202 from ZAPP + 34 folded in from the fit model)

build/
  build_fit_data.py     catalogue-source + fit-source + overrides -> fit-data.json
  record_research.py    merges a research batch, REJECTS anything missing provenance
  research-overrides.json  the research pass output, 29 shows deep
  catalogue-source.json    pristine ZAPP export. Read-only input, never written
  browser-tests.cjs     37 Playwright checks: the model, the drawer, provenance
  ledger-view-tests.cjs 21 checks: details/link split, report badge, the lenses

worker/               Cloudflare Worker + D1. Complete, NOT deployed. See its README
docs/
  handoff.md          this file
  community-build.md  the future discussion layer, specified not built
```

### Rebuilding after a data edit

```bash
python3 build/build_fit_data.py      # rewrites tracker/fit-data.json AND catalogue.json
```

`catalogue-source.json` is the pristine input and is never written to. The build
folds the 34 fit-only shows into `catalogue.json` as output, so the browser, the
map and the ledger all read one list.

### Testing

```bash
python3 -m http.server 8765          # from the repo root
node build/browser-tests.cjs        # 37 checks — needs the server running
node build/ledger-view-tests.cjs   # 21 checks — files a report, so it clears
                                   # localStorage first and runs standalone

cd worker && npm test                # 45 API checks, manages its own worker
```

---

## 9. Deploying

The front end is static and already live on GitHub Pages. It runs in **solo
mode** with no backend: everything works, everything stays in the browser, every
report behaves as private.

To make it a network, deploy the Worker (`worker/README.md` has the full
sequence) and paste its URL into **Network** on the site. Nothing about the
front end changes; the store swaps behind it.

Membership is invite-only. The first steward gets in via a one-time
`BOOTSTRAP_CODE`, which stops working the moment a single member exists.

---

## 10. Open threads

- **Finish the research.** 13 of the top 50 remain, then the fast sweep of the
  other 186. A session with open egress should also re-verify the 29 already
  done and upgrade `search` to `verified`.
- **Confirm the 33 estimated dates** on ZAPP, EntryThingy and show sites.
- **Per-discipline factor scores.** The structure is built and empty. Right now
  disciplines differ only through their weights; the scores themselves are
  shared. Member reports fill `byDiscipline` over time, and that is when the
  per-discipline ranking becomes genuinely precise rather than merely
  differently weighted.
- **Route planning.** The original handoff called this the natural next tool and
  that has not changed. Labor Day has three strong competing entries;
  Aug 6–15 is a pick-one between Park City, Crested Butte and Sun Valley.
  Ranking has hit diminishing returns; scheduling has not.
- **Images on reports.** The R2 binding exists, the API does not write to it yet.
- **Money in the lenses.** "My results" and "The network" currently rank on the
  ten factor ratings. Ranking directly on reported net — the number an artist
  actually cares about — is the obvious next lens, and needs a decision about
  how to compare a $900 booth weekend against a $2,400 one fairly.
- **The community layer.** Specified in `community-build.md`. Not worth building
  below ~20 active members — a discussion layer on an empty database is a
  Facebook group with extra steps.
