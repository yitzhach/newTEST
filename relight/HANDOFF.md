# Relight Engine — Handoff

A photorealistic relighting engine for photographs of textured artwork. Standalone
browser tool, no build step, no dependencies, no model of any kind. Load an image,
place virtual lights, export a finished render.

**Repo:** `yitzhach/newTEST` · **Branch:** `claude/relighting-engine-feasibility-g8v71j` · **Path:** `relight/`

Everything below was **measured, not argued**. Where a number appears, it is
reproducible from `relight/tools/`. Section 7 lists what has been built and deleted;
that section exists because a fresh session reaches for those things in the first
hour, and every one of them was tried and failed against ground truth.

---

## 1. Start here

### Kickoff prompt for a new session

> I'm continuing work on a photorealistic relighting engine for photographs of
> textured artwork — cast cement and plaster, heavily grained, largely achromatic.
> It's a standalone browser tool that exports a finished image.
>
> The code is in this repo under `relight/` on branch
> `claude/relighting-engine-feasibility-g8v71j`. **Read `relight/HANDOFF.md` in full
> before responding.** Read §3 twice — it is the finding that decides what the tool
> can and cannot be — and §7, which lists six diagnostics that were built,
> calibrated against ground truth, and deleted.
>
> Everything in that document was measured. Don't re-derive it, don't rebuild
> anything §7 says was tried, and don't trust a plausible statistic until it has
> been run against the bench's known cases.
>
> Pick up from §9 "What's next", or tell me if something else should jump the queue.

### Files to bring

**None.** Everything is committed on the branch above — code, docs, test harnesses,
and the real photographs in `relight/captures/test/`. A new session only needs the
repo and the branch name.

If the session cannot reach the repo, the four files that carry the argument are
`HANDOFF.md`, `README.md`, `src/gbuffer.js`, and `tools/validate.mjs`.

### Known environment problems

- **Image attachments do not reliably reach disk.** In the last session, five
  separate attempts put nothing in `/root/.claude/uploads/` (the directory did not
  exist). The model can see attached images in conversation but cannot open them as
  files, so no measurement is possible. **Verify a file exists before promising
  analysis of it**, and never fall back on judging an image by eye — §10.
- **`--preflight` runs after the shoot, not before it.** It decodes every exposure,
  so it cannot check a rig that has not been photographed yet. README once said "run
  it before you strike the lights", meaning before the set comes down — one word from
  being read as "before you shoot". `tools/plan.mjs` is the pre-shoot half.
- **Outbound fetches are restricted by egress policy.** `isaacandersonart.com` and
  `github.io` were both refused at the CONNECT stage (403 from the proxy). Do not
  retry or route around a policy denial; report the blocked host.
- **The route that works is committing images to the repo.** That is also the
  storage format the project wants — see `README.md`, "Capture bundles".
- **HEIC cannot be decoded.** Chromium ships no HEVC. Convert on macOS with
  `sips -s format png in.HEIC --out out.png`, or set the phone to
  Settings → Camera → Formats → **Most Compatible** to shoot JPEG.

---

## 2. Product decisions (settled — do not reopen)

- **Standalone tool, not a feature.** It loads an image, lights it, exports a file.
  Integration into the "See It On Your Wall" app in `yitzhach/dm-t1` is **dropped,
  not deferred**.
- **Personal tool first.** No accounts, billing, or multi-user anything.
- **No learned model.** Reaffirmed explicitly after the trade-off was put plainly:
  §3.1 means one photograph constrains only the slope *along* the light azimuth, and
  a learned prior is the only thing that can fill the other half. **"No model" and
  "works on any photograph you upload" cannot both hold.** The owner chose the
  constraint, to be revisited once the physics-only path is mature. Build for
  excellence where the physics reaches and refusal where it does not. Do not quietly
  reopen this to chase generality.
- **Eventually** the owner wants to fold this into a separate 35mm film project. Not
  scoped. Note that film grain is fine achromatic high-frequency detail — precisely
  what §3.2 shows the single-image path cannot separate from relief.

---

## 3. The finding that decides what this tool is

Read this section twice.

### 3.1 One photograph constrains half the surface, as a matter of algebra

Under a light with azimuth **â**, Lambertian shading of a height field *h* is

```
I ≈ N·L ≈ Lz − (∂h/∂x·Lx + ∂h/∂y·Ly) = Lz − |Lxy|·(∂h/∂â)
```

Only the slope **along â** appears. The perpendicular component is unconstrained —
the shape-from-shading ambiguity, appearing at relief scale rather than form scale.
This is not a limitation of the implementation. It is what one photograph contains.

Two consequences fall out of the same algebra:

- **Integrate, do not differentiate.** The high-passed luminance is a *derivative*
  of the surface, not the surface. Treating it as a height field and differentiating
  again correlates with truth at **r = 0.00** — while producing relief that traces
  brushwork convincingly enough to fool anyone looking at it. Walking back along â
  accumulating −slope gets **r = 0.76**. Implemented in `src/gbuffer.js`.
- **A good archival copy shot recovers nothing.** Two matched lights at equal and
  opposite angles is a geometry that exists specifically to *suppress* texture, and
  it cancels the first-order term almost exactly. Measured: **r = 0.00**. The better
  the repro photography, the less relief survives.

### 3.2 Achromatic grain is indistinguishable from relief in one photograph

The synthetic bench's high-frequency adversary is chromatic *by construction*, which
is what lets `chroma reject` find it. Cement shifts no hue:

| light | grain | single image (along) | photometric (nx/ny) | high-pass contrast |
|---|---|---|---|---|
| raking 20° | 0.00 | 0.767 | 0.9970 / 0.9990 | 0.292 |
| raking 20° | 0.20 | **0.743** | 0.9975 / 0.9989 | 0.301 |
| frontal 89° | 0.00 | 0.092 | 0.9970 / 0.9990 | 0.029 |
| frontal 89° | 0.20 | **0.033** | 0.9975 / 0.9989 | 0.075 |

Two things to take from this table.

**Lighting direction dominates, not grain.** Raking with grain is 0.743; frontal
with grain is 0.033. A 22× difference from the lamp position alone. Grain on its own
barely hurts a raked shot.

**Photometric stereo does not care about grain at all**, because grain is albedo and
albedo is what the solve separates out. On achromatic grainy material the multi-shot
path is not an upgrade — it is the only sound option, and that is a fact about the
material rather than a tuning problem.

### 3.3 Measured on the owner's actual material

`relight/captures/test/3.jpg`, 9.3MP, cast cement, outdoors under overcast sky.
Measure any photograph the same way with `node relight/tools/spectrum.mjs <file>`.

**Chroma is dead.** Fine-scale chroma against fine-scale luma, four crops:
0.023, 0.015, 0.024, 0.016 — **mean 0.019**. The mechanism that separates pigment
from relief is arbitrating with a signal fifty times weaker than the thing it
judges. `chroma reject` is inert on this material and no setting changes that.

**The spectrum is broadband with no characteristic scale.** Energy added by each
band peaks at the *finest* (1–1.5px) in every crop and decays monotonically outward,
with no bump at the scale of the trowel marks. **No relief-scale setting isolates
relief from grain here** — they overlap continuously rather than occupying separate
bands. Retuning the default cannot fix this material, only change which mixture is
read.

**JPEG was not the problem.** A reasonable suspicion, and wrong: luma quantisation
sums to 463 with a maximum coefficient of 13 (light), and the 8×8 blocking test
finds no excess gradient energy on the grid (ratios 0.93–1.00).

### 3.4 Exposure barely matters — do not send anyone back to reshoot for it

Four raking-lit shots (`captures/test/25-28.png`, 12MP, one lamp in a dark room)
clip much harder than the flat-lit frame:

| file | clipped high | clipped low | share in codes 0–25 | shadow/mid noise |
|---|---|---|---|---|
| 25 | 2.75% | 1.38% | 13.0% | 2.20× |
| 26 | 2.53% | 1.57% | 14.8% | 2.24× |
| 27 | 2.66% | 1.11% | 12.8% | 2.19× |
| 28 | 1.63% | 0.76% | 10.1% | 2.32× |
| 3.jpg | 1.65% | 0.00% | 0.1% | 1.40× |

An eighth of the frame sits where 8-bit quantisation is a large fraction of the
value and `log(L/blur(L))` amplifies it to an sd of 1.64 against a midtone 0.27.
It looks like it must be corrupting the integrator. **It is not.** On the bench,
clipping 10% of the frame costs 0.7625 → 0.7573, and underexposing until **98%** of
pixels fall in codes 0–25 costs 0.7625 → 0.7516.

The pipeline is far more robust to exposure than to lighting direction. Chase the
lamp position, not the histogram.

---

## 4. What exists

~6,500 lines, plain ES modules, **no build step**, no dependencies.

| file | role |
|---|---|
| `src/gl.js` | WebGL2 scaffolding, float render targets, fullscreen-triangle passes |
| `src/gbuffer.js` | Single-image surface recovery — integrate-then-differentiate, chroma reject, ratio-based albedo de-lighting |
| `src/photometric.js` | Multi-shot measured surface — least-squares solve, ambient fit, Poisson height, fit residual |
| `src/register.js` | Capture-frame alignment — chromaticity matching, all-pairs robust fit, Lanczos-3 correction. DOM-free |
| `src/sphere.js` | Light directions read off a chrome sphere — exact reflection geometry, no fit. DOM-free |
| `src/shade.js` | Cook-Torrance GGX, spot cones, inverse-square falloff, horizon-march cast shadows, occlusion, ACES |
| `src/kelvin.js` | Colour temperature via the Planckian locus → CIE xy → XYZ → linear sRGB |
| `src/export.js` | Tiled full-resolution render with overlap margin, both surface paths |
| `src/measure.js` | Descriptive measurement of the loaded photograph. Predicts nothing. DOM-free |
| `src/synth.js` | Procedural painting with known height field; single shots, capture sets, chrome sphere, achromatic `grain` |
| `src/app.js` | UI, light rig, state, export wiring |
| `tools/recover.js` | CPU reference implementations of both surface paths, **shared** by the benches |
| `tools/validate.mjs` | Ground-truth harness — relief, registration, sphere, grain (~65s, no browser) |
| `tools/score-real.mjs` | Scores recovery against a **real** photometric capture; preflight, sphere read, relief sweep, `--json` |
| `tools/spectrum.mjs` | Describes a photograph: band structure, chroma signal, JPEG blocking |
| `tools/plan.mjs` | Pre-shoot rig planning and checking — runs with **no photographs**; shot list, geometry check, chrome-sphere sizing |
| `tools/fixture.mjs` | Writes a synthetic capture to disk as a real bundle — worked example and test input |
| `tools/selftest-real.mjs` | The real-capture chain end to end, 20 checks, no browser |
| `tools/smoke.mjs` | End-to-end browser suite, 18 checks (needs playwright) |
| `tools/decode.js` | Image input — PNG in-process, JPEG/WebP via headless Chromium |
| `tools/png.js` | PNG encode/decode on `node:zlib`, no dependencies |

`tools/recover.js` is shared **deliberately**: a second copy of `integrate` in the
real harness would drift from the bench's silently, and then the real column and the
synthetic column would stop measuring the same thing while still appearing in one
table.

### The two surface paths

**Single image.** Corrected pipeline (§3.1). Needs the source azimuth, which is a
dial the user sets — automatic estimation was built and deleted (§7). A wrong
azimuth degrades gracefully: relief resolves along the wrong axis rather than
producing garbage.

Recovery across azimuths 0–160° and elevations 10–60° sits between **0.66 and 0.85**
and barely moves. It falls at 75° and collapses only at 89°. Advise a single source
and a correct azimuth; do not insist on a grazing angle.

**Photometric stereo.** N exposures, fixed camera, light moved. Solves
`I_k = albedo·(N·L_k)` per pixel. **0.9995 / 0.9994** against ground truth, and true
albedo falls out of the same solve. Nothing is estimated.

---

## 5. The photometric path, and the error nothing else can see

**Read this before touching the photometric path.** It is the sharpest result in the
project and it is not intuitive.

The solve takes light directions as *given*. Turn the whole rig by one angle — a
nominal template typed in, a remembered setup — and:

| rig turned by | 0° | 2° | 10° | 20° | 40° |
|---|---|---|---|---|---|
| normals nx / ny | .9997/.9997 | .9992/.9991 | .9856/.9834 | .9437/.9349 | **.7810/.7498** |
| fit residual | 0.17% | 0.17% | 0.17% | 0.17% | **0.17%** |

Exact, not a tuning artefact: rotate every `L_k` by `R` and `g' = Rg` satisfies
`g'·(R L_k) = g·L_k = I_k`. **The model reproduces every photograph perfectly and
returns a surface rotated off the painting.** The relit output is entirely
convincing with its impasto shadows falling at the wrong angle to the brushwork.

Errors that are *not* uniform do show (each light off its own way by 10° reads
6.29%) — but the uniform case is what a remembered rig produces, and every
diagnostic in this tool compares the lights against **each other**, so none can break
the symmetry.

**A chrome sphere can**, by measuring each direction against the room. A mirror
reflects the lamp into the eye only where the normal bisects them, so
`N = normalise(L + V)`, and with `V = (0,0,1)` that inverts as
`L = 2 nz (nx, ny, nz) − V`. Measured against a known rig on a 200px-radius sphere:
**worst 0.33°**, azimuth exact.

Three things worth not re-deriving:

- **Error scales with circle-error / radius, not with pixels.** 3px of centre error
  costs **9.63° at r=40** and **1.60° at r=300**. The requirement is a *big sphere* —
  a line in the capture protocol — rather than a steady hand, which is unenforceable.
- **A sphere must be excluded from the fit.** A mirror is not Lambertian, so its
  pixels dominate the residual: a clean capture reads **1.49%** with the sphere left
  in and **0.16%** with its disc excluded — enough to hide a real fault behind the
  diagnostic meant to reveal it. This applies to *every* residual, including the one
  registration is judged by, where leaving it in reads 3.70% against 0.17%.
- **A circle that is not on a sphere still returns six confident directions.** Two
  checks catch it: readings that all agree cannot be readings of a mirror (the lamp
  moved between exposures — a circle on paint returns six directions within 4.2° of
  each other), and the fit residual before against after (0.16% → 6.35%).

### Four capture rules enforced in code

1. **Ambient must be fitted, and that needs varied light elevation.** Ambient biases
   recovered tilt to 9.7° against a true 12.2°. Fitting it as a fourth unknown fixes
   that exactly — but at uniform elevation the `Lz` column is a constant multiple of
   the ambient column, the system is rank-deficient, and the solve collapses to zero.
   `buildSolver` detects the collinearity and **refuses with that explanation**.
2. **Shoot more exposures than there are unknowns.** Three solve for a normal, four
   for a normal plus ambient — but then the system is exactly determined, the model
   fits perfectly by construction, and the residual is identically zero *however
   wrong the capture is*. A 3px misalignment reads **3.39% on six shots and 0.00% on
   four**. The default rig is six.

3. **Alternate the lamp between 30° and 60°, and do not raise it as you walk it
   round.** Both halves are measured, and the first is counter-intuitive.

   | mean lamp elevation | 22.5° | 32.5° | 45° | 52.5° | 62.5° |
   |---|---|---|---|---|---|
   | photometric angular error | 0.93° | 0.45° | **0.25°** | 0.28° | 0.37° |
   | best single-image frame | 0.822 | 0.814 | 0.769 | 0.731 | 0.657 |

   **The photometric solve wants height; the single-image path wants raking.** They
   are monotonic and opposed. Low lamps cast their own shadows and nothing in a
   Lambertian solve represents a shadow, so an all-raking rig (20/30°) recovers
   normals at **1.16°** — it degrades the very ground truth its frames would then be
   scored against. Alternating 30/60 measures **0.21°** while still leaving a 0.799
   raking frame, and is the shipped default in `tools/fixture.mjs` and `plan.mjs`.

   §3.1 says raking light is right for *one* photograph. It is the wrong instinct
   for a capture, and that is the trap this rule exists to disarm.

   Separately: elevation must not correlate with azimuth. The same six elevations
   ramped in azimuth order recover at **0.546°**; re-paired, **0.281°**. Only the
   pairing changed. `plan.mjs` warns past a correlation of 0.85, calibrated on 41
   sampled pairings — that is where the classes separate with no overlap. Below 0.6
   nothing is said, because between 0.6 and 0.85 the effect is real on average and
   unreliable case by case.
4. **The sphere is sized before the shoot or not at all.** Radius in pixels is a
   proportion of the framing, not a lens property: for a sphere in the plane of the
   piece, `radius_px / image_width_px = (diameter_mm/2) / frame_width_mm`. A 600mm
   piece at 4032px needs an **89mm sphere** for the 300px the protocol asks for; a
   50mm ball reads r = 168px. Moving a small sphere toward the camera to enlarge it
   is a **bad trade** — reaching 300px that way puts it ~190mm forward, where a lamp
   1.5m out subtends a direction 3.6–6.2° away from the one at the piece, which is
   larger than the placement error it was meant to fix. `plan.mjs --sphere` prints
   both sides.

### The Fit view

The diagnostic a real capture can have, since it comes with no ground truth.
Re-projects the solved `g` through each light direction and compares against what was
photographed. Blue = the model matches. Clean 0.16%; one frame off by 3px → 3.39%;
one light angle 40° out → 1.70%.

---

## 6. Frame registration

"A tripod is doing that work on trust" is no longer true. Scored against a drift that
is exact by construction — the painting synthesised at 3× and each frame
box-downsampled from a different integer offset, so one texel upstairs is exactly ⅓px
downstairs with no interpolation in the ground truth:

| case | as shot (nx/ny, fit) | registered | shift err |
|---|---|---|---|
| clean | 0.9997 / 0.9997, 0.17% | 0.9997 / 0.9997, 0.17% | 0.003px |
| one frame 1.3px | 0.930 / 0.836, 2.32% | **0.993 / 0.984, 0.78%** | 0.020px |
| one frame 3px | 0.965 / 0.926, 1.51% | **0.9997 / 0.9997, 0.17%** | 0.003px |
| creep 0–2px | 0.203 / 0.902, 4.01% | **0.985 / 0.976, 1.14%** | 0.005px |

**Match on chromaticity, not on gradient magnitude.** The obvious light-invariant
feature is `|∇ log L|` — a ridge is an edge under any light. It gets 12 of the 15
frame pairs right and lands 3px out on the other three, because `|∇ log L|` is
strongest *across* the light azimuth: two frames lit 120° apart emphasise different
edges. Chromaticity is *exactly* invariant instead — under
`I_c = albedo_c·(n·L + ambient)` the shading is one scalar on all three channels, so
`r/(r+g+b)` divides the lamp out. All 15 pairs, r = 0.999. It ignores an achromatic
canvas weave for free.

The feature is `|∇ log L| + 8·|∇ chromaticity|` at **fixed** gain, deliberately not
normalised: that is what makes an achromatic subject fall back to luminance instead
of having its chroma *noise* promoted to equal authority.

Three more, each of which cost a wrong result first:

- **Build coarse pyramid levels by downsampling the feature**, never by
  re-gradienting a downsampled photograph. The second lands 2–4px off zero on frames
  that never moved.
- **Anchor on the median frame position**, not the mean and not frame 0. The median
  leaves undisturbed frames on exact integer offsets, and an integer offset is a copy,
  not a filter.
- **Lanczos-3, not bilinear.** Correcting by the *known* drift isolates the resampler
  from the estimate: uncorrected 0.203/0.902, bilinear 0.939/0.885, Catmull-Rom
  0.964/0.932, Lanczos-3 0.985/0.976. A half-pixel bilinear shift is a low-pass whose
  knee is inside the 2–7px band this engine works in.

Every pair is measured rather than every frame against frame 0, and positions come
from a weighted least-squares fit over all of them — 15 measurements of 5 unknowns,
so a pair that cannot see its partner is outvoted rather than carrying its frame off
alone. The verdict shown is the fit residual **before against after**; if it does not
improve, the frames are put back and it says so.

Measured at up to 1600px on the long edge and applied at full resolution. The cost:
full 0.9997/0.9996, ½ 0.9994/0.9990, ¼ 0.9918/0.9860 — all far ahead of the
0.9142/0.8293 of leaving the drift in.

---

## 7. The graveyard — do not rebuild these

Six diagnostics, two repairs, and one rig statistic — each built, calibrated against bench cases with
**known** recovery, and deleted. This is the most valuable section for a fresh
session, because every one of them is what you reach for in the first hour.

### Diagnostics that could not tell the cases apart

**1. A silhouette fitter for the chrome sphere's circle.** Hand placement genuinely
costs accuracy, so snapping to the outline is the obvious repair. The bench cannot
judge one — it would score an edge detector against `synth.js`'s own model of an
edge — and on that render there is no edge to find: luminance just inside the rim
(~0.26) is indistinguishable from the painting just outside (0.23–0.40), because a
mirror near its silhouette reflects the room at grazing angles. What rescues
placement is a **big sphere** (§5).

**2. A contrast-based "is this photograph usable?" gate.** Contrast of the
high-passed log luminance tracks how raking the light was, cleanly, on a fixed
surface. Achromatic grain breaks it: under frontal light it takes contrast **up**
0.027 → 0.075 while recovery goes **down** 0.096 → 0.035. It moves the wrong way, so
no threshold separates the cases. The real photograph reads 0.67–0.86, above every
synthetic case, and returns speckle.

**3. An automatic source-azimuth estimator.** A bump is dark on the side away from
the lamp, so the directional derivative of the high-pass should have maximum skew
along the light azimuth. Sound reasoning, does not work:

| rig | true azimuth | estimated | error | its own confidence |
|---|---|---|---|---|
| raking | 167° | 170° | 3° | 1.64 |
| single | 141° | 185° | **44°** | 1.82 |
| copy-stand | 141° | 115° | 26° | **2.24** |

It reports its *highest* confidence on the shot that has no recoverable direction at
all. The azimuth stays a dial the user sets.

**4. Anisotropy of the recovered height field.** Integrating an isotropic field along
â turns it into a 1-D random walk along â, so across/along gradient energy should
separate "read a surface" from "smeared noise". Controls: raking no-grain 1.175
(r=0.771), raking grain 1.228 (r=0.748), 45° single 2.248 (r=0.594), frontal 2.000
(r=0.131), frontal+grain 1.807 (r=0.041), **pure achromatic noise 1.236**. Noise
lands *between* two recovering cases.

**5. Cross-azimuth agreement.** Integrating one photograph along several azimuths
recovers partial views of one height field, so they should agree for real relief and
not for noise. Recovering cases 0.046–0.119; non-recovering −0.046–0.103. Overlapping.

**6. Mid-band against fine-band energy.** Grain is scale-invariant while relief
shading appears at the scale of the relief, so mid/fine should rise when the light
starts raking. It orders the bench **backwards**: frontal 89° (recovery 0.052) scores
the highest at 0.999 while raking 20° (recovery 0.7625) scores the lowest at 0.380,
and it is not monotonic. **The trap worth recording:** the real shots read 0.77–0.79,
which *looks* like a verdict and would have been reported as one had the controls not
been run first.

### A rig statistic that looked like a grade

**7. `buildSolver`'s condition number, as a way to rank capture rigs.** A different
class from the six above — it judges the *lighting geometry*, not a photograph — and
it fails the same way, which is why it belongs here. The number is already computed
and sitting unused in the solver, ranking rigs by it is the obvious next move, and
against eleven rigs with known recovery it correlates with angular error at
**r = −0.06**: no signal, and the sign backwards.

| rig | cond | angular error |
|---|---|---|
| alternating 15/60 | **26** (best conditioned) | 0.59° |
| alternating 30/60 | 85 | **0.21°** (best recovery) |
| alternating 37.5/52.5 | 340 | 0.25° |
| alternating 55/70 | **972** (worst conditioned) | 0.37° |

The best-conditioned rig tested recovers *worse* than one thirteen times more
ill-conditioned. `buildSolver` is a **refusal test** — when it cannot invert the
system it says so, and that is the only thing its output means. `tools/plan.mjs`
prints the condition number with that sentence attached, deliberately, so the next
session does not rediscover it as a metric.

What *does* predict recovery, on the same cases: lamp elevation, monotonically
(§5), and whether elevation tracks azimuth (r = 0.646, positive, and calibrated to a
0.85 threshold where the sampled classes separate cleanly).

### Repairs that made recovery worse

**8. Masking clipped pixels out of the slope field.** Worse in every case: raking at
as-shot clipping 0.7626 → 0.7505, and 0.7195 with weight renormalisation. Removing
pixels removes signal along with the damage, and the integration is a running sum
whose chain the mask breaks.

**9. Down-weighting dark pixels** by an 8-bit knee. Best case +0.0004 (noise) at knee
26; harmful above — −0.0106 at 40, −0.0331 at 64.

### The rule this establishes

**Nothing computed from a single photograph has been able to say whether that
photograph will yield relief.** Six independent attempts, three of them reporting
their highest confidence exactly where they knew least.

Treat any new candidate as guilty. Run the bench controls **before** looking at real
material — every failure above would have been reported as a finding otherwise.
Expect to throw it away.

The consequence is not pessimism, it is prioritisation: since no statistic can
adjudicate, the only instrument that can is a photometric capture, which
`tools/score-real.mjs` turns into a real number. Everything else is guessing with
extra steps.

### What passes the test instead

`src/measure.js` reports fine-scale chroma against fine-scale luma under the Chroma
reject slider. It survives because it is **descriptive**: it says whether that control
has any signal to act on, never whether recovery will succeed. Measured 0.020 on the
flat-lit shot, 0.037–0.052 on the raking ones. Cross-checked against
`tools/spectrum.mjs` on identical pixels: agreement to 0.000%.

The app and the harness must never tell the user different things about one image.

---

## 8. Running it

```bash
python3 -m http.server 8080          # then http://localhost:8080/relight/

node relight/tools/validate.mjs      # ground-truth maths, ~65s, no browser
node relight/tools/selftest-real.mjs # real-capture chain, 20 checks, no browser
node relight/tools/smoke.mjs         # browser suite, 18 checks (needs playwright)

node relight/tools/plan.mjs                             # the recommended rig, as a shot list
node relight/tools/plan.mjs --write <dir>              # a capture.json to shoot into
node relight/tools/plan.mjs --check <dir>              # check a rig with NO photographs
node relight/tools/plan.mjs --sphere --frame-width=600 --image-width=4032

node relight/tools/spectrum.mjs <image>                 # describe a photograph
node relight/tools/fixture.mjs /tmp/cap --sphere        # a worked capture bundle
node relight/tools/score-real.mjs /tmp/cap --preflight  # is this capture solvable?
node relight/tools/score-real.mjs /tmp/cap              # score single-image vs truth
node relight/tools/score-real.mjs /tmp/cap --sweep      # which band carries relief
node relight/tools/score-real.mjs /tmp/cap --json       # machine-readable
```

Must be served over http(s) — ES modules will not load from `file://`. Requires
WebGL2 with `EXT_color_buffer_float`; without it the signed height field clamps to
[0,1] and relief goes wrong while still looking like relief, so the bench refuses to
start and says why.

**Deploying:** build output directory `relight`, build command **empty** — the repo
root holds an unrelated Vite site and a framework preset will try to build that
instead. `DEPLOY.md` has the details. For Cloudflare Pages direct upload, zip
`index.html`, `_headers` and `src/` only; the `.md` files and Node harnesses are repo
content, not things to publish.

**If playwright's browser build does not match the machine's**, set `CHROME` to the
chrome binary rather than reinstalling.

---

## 9. What's next

> **Note on the existing raking shots.** `captures/test/25-28.png` cannot be pressed
> into service as a photometric capture. The LEGO reference was added and removed
> between 25, 26 and 27, so the *subject* changed between exposures, and 28 is a
> different light position. Photometric stereo requires that **nothing move between
> frames except the lamp** — not the camera, not the piece, not anything sitting on
> it. They remain useful as single-image inputs.

1. **A six-exposure photometric capture of a real piece.** This is no longer one
   option among several — §7 established over six independent attempts that nothing
   computed from a single photograph can say whether recovery worked. A capture is
   the only instrument that can. It also yields six (photograph → known normals)
   pairs on real material, which is the first non-synthetic score the single-image
   path would ever have.

   **Before the shoot**, `node relight/tools/plan.mjs` prints the rig as a shot list
   and `--check` validates one with no photographs on disk; `--sphere` sizes the
   chrome ball, which is a purchasing decision and cannot be fixed afterwards. The
   rig is alternating 30/60° elevation, six azimuths 60° apart — §5 rule 3 for why,
   and note that it is deliberately *not* the raking light §3.1 recommends for a
   single photograph.

   **After the shoot, before the set comes down**, `tools/score-real.mjs --preflight`
   reads the actual frames and catches what a plan cannot: reframing, an undersized
   or clipped sphere, a circle that is not on the sphere. It cannot run earlier — it
   decodes every exposure — and it now says so and points at `plan.mjs` rather than
   failing on a missing file. Protocol in `README.md`.
2. **Retune single-image defaults against that capture.** `--sweep` is the tool. It
   returns 3px on the bench — the shipped default, and the bench's own weave period —
   which is the check that it measures what it claims. §3.3 says real material is
   broadband and no single default fits, so expect a control that shows which band is
   being read rather than a better constant.
3. **Fit the sphere's circle against the photometric residual.** The one hand-set
   number that still costs real accuracy. Three parameters, an objective the tool
   already computes, ground truth in the bench. Note the residual is blind to a
   *uniform* rotation of the rig, so this refines a circle but never replaces the
   sphere.
4. **Keep every capture as a labelled bundle** (`README.md`, "Capture bundles").
   Cheap now, impossible to reconstruct once the paint has been rephotographed. If
   the no-model decision is ever revisited, a solved bundle is exactly the training
   pair a single-image estimator needs — at r ≈ 0.9995 per pair, with §5 and §6 being
   what make the labels trustworthy rather than silently rotated.
5. **A resample-free correction path for registration.** The estimate is essentially
   exact and the remaining loss is interpolation. Fold each frame's sub-pixel offset
   into the solve shader's UV rather than pre-shifting pixels. Measure first — a GPU
   sampler gives bilinear, the worst kernel measured.
6. **Register rotation as well as translation.** Only if a real capture needs it.
7. Preset/save system for light rigs.

### One observation, reported by the owner

After the raking shots were taken, the owner tried them in the tool across several
pieces and reported the effect "quite good" and markedly better than the
overcast-lit input. That is an impression, not a measurement, and §11 (how this is
worked) is a list of impressions that were wrong.

It is recorded anyway, for one reason: **the prediction preceded it.** §3.2
(achromatic grain) says raking should beat diffuse by roughly 22× on this material,
and that was measured on the bench before any raking photograph existed. Every
earlier "looks right" in this project arrived *before* a number and was then killed
by one. This is the first time an observation has confirmed a standing prediction
rather than substituted for one. Weak evidence, pointing the same way as the theory.

Worth separating two questions a fresh session should not conflate:

- **Is the recovered geometry veridical?** Unknown, and only a capture answers it.
- **Does the tool produce images the owner wants?** For a personal tool whose stated
  purpose is "load an image, light it, export a file", the owner's judgement of
  their own work is a legitimate acceptance signal. Geometric rigour is what stops
  the tool fooling anyone and what would let it generalise; it is not the only thing
  that makes the product worth having.

### Open question worth stating plainly

Whether the single-image path is usable on cast cement **is still unknown.** The
raking shots exist and are well exposed, the lighting is finally right, and nothing
in the tool can score them. That is not a gap in the analysis — it is §7's rule. The
capture in item 1 is what answers it, in either direction, and a clear negative would
be as valuable as a positive.

---

## 10. Known limits

- **Single-image recovery is unsound on achromatic grainy material** — cement,
  plaster, sand, paper — and no image-only test will tell you so. §3.2, §7.
- **Registration corrects translation only.** Rotation, scale and lens breathing are
  not corrected; the Fit view will show them, nothing here will fix them. It runs on
  demand — a 12MP six-shot set takes ~15s.
- **An achromatic subject is the weak case for registration.** With no colour it
  falls back on luminance alone and 2 of 15 frame pairs go wrong. The other 13
  outvote them, and the discounted count is reported for a reason.
- **The sphere's circle is placed by hand.** Without a sphere, light directions are
  typed in, and §5 is what that costs.
- **A sphere reading assumes a neutral lamp and orthographic projection.** A strongly
  coloured light or a very short lens biases it; neither is measured.
- **Defaults are tuned to the synthetic canvas**, whose weave is coarser than real
  linen and has a clean 7px period that real material does not.
- **Tiled photometric export is not bit-exact** against an untiled render (mean
  0.026/765, max 21, no coherent seam). Cause is Jacobi convergence, not margin. Zero
  needs multigrid.
- **Single-image auto-azimuth is unreliable** and shipped as a dial. §7.
- No preset system, no save/load of light rigs, no undo.

---

## 11. How this project has been worked, and why it matters

Every significant finding here was something that **looked right and was wrong**: a
relief pipeline that traced brushwork beautifully and recovered nothing; an
acceptance test that passed hardest on the capture that recovered nothing; a fit
residual reading a perfect 0.00% precisely when it had no information; a frame
matcher built on the textbook light-invariant feature that was confidently 3px out on
a fifth of its comparisons; a rig rotated bodily off the painting that fits every
photograph at 0.17% while returning the wrong surface; a shot-quality gate whose
statistic rose while the thing it measured fell; and a band-energy ratio that ordered
the known cases backwards while looking like a verdict on the real ones.

The practice that caught all of them:

> **Synthesise a surface whose truth you know, feed the tool only the render, and
> score the recovery numerically.**

Do not judge relief by eye — it is the one thing that cannot be judged by eye. If you
add a surface-recovery feature, add it to `tools/validate.mjs` too. If you invent a
statistic, run it against the bench's known cases **before** you look at real
material; §7 is six demonstrations of why.

Three conventions worth keeping:

- **Refuse rather than approximate.** Where the maths is degenerate — a singular
  light rig, a missing GPU extension, a fit with no degrees of freedom — say so and
  stop. Every one of those would otherwise produce confident, plausible, wrong output.
- **State the measurement, not the impression.** Commit messages and this document
  carry numbers because "looks better" has been wrong repeatedly here.
- **Correct your own claims in writing when they fail.** This document records that
  JPEG artefacts were suspected and cleared, that a clipping warning was issued and
  then measured away, and that six diagnostics were built and deleted. A handoff that
  only lists successes teaches the next session nothing about the failure modes.
