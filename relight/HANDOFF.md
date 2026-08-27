# Relight Engine — Handoff

**Read this before `RELIGHT-BRIEF.md`.** The original brief is still the best
statement of *why* this project exists, but several of its load-bearing technical
claims were tested during the build and turned out to be wrong. Those corrections
are in §3 below. A session that follows the brief's §4, §7.1 or §8 #7 as written
will rebuild something that does not work and looks like it does.

**Status:** working, deployable, validated against ground truth. The photometric
path is sound and now measures everything it used to assume. The single-image path
has met real material and does not survive it — see §4.3, which is the most
important thing in this document.

**Repo:** `yitzhach/newTEST` · **Branch:** `claude/artwork-relighting-engine-ak4yae` · **Path:** `relight/`
**Predecessor brief:** `yitzhach/dm-t1`, branch `claude/photo-relighting-app-ge73k7`, file `RELIGHT-BRIEF.md`
**Earlier branch:** `claude/getting-started-jf5cub` — superseded; its history is contained
in the current branch, so there is nothing to merge and no reason to check it out.

---

## 1. Kickoff prompt

> I'm continuing work on a photorealistic relighting engine for photographs of
> artwork. It's a standalone browser tool that exports a finished image — not a
> feature inside another app.
>
> The code is in this repo under `relight/` on branch
> `claude/artwork-relighting-engine-ak4yae`. **Read `relight/HANDOFF.md` in full
> before responding**, and §4.3 twice — it is the finding that changes what the
> tool is for. The handoff supersedes the older `RELIGHT-BRIEF.md` (which lives in
> a different repo, `yitzhach/dm-t1`) on every technical point where they disagree.
>
> Everything in there was measured, not argued, and several entries record things
> that were built and then deliberately removed. Don't re-derive them, don't trust
> the old brief's algorithm, and don't rebuild anything the handoff says was tried.
>
> Pick up from "What's next" at the end, or tell me if you think something else
> deserves to jump the queue.

### What the owner needs to supply, and why it is item #1

The project is no longer blocked on code. It is blocked on **one six-exposure
photometric capture of a real piece.**

The owner makes cast cement and plaster work: heavily textured, almost achromatic,
relief at centimetre scale. §4.3 established by measurement that this is precisely
the material the single-image path cannot handle *and cannot self-check on*, while
photometric stereo is completely unaffected by the thing that breaks it. So a real
capture is worth more than any amount of further tuning, and it exercises frame
registration (§4.1) and the sphere reader (§4.2) at the same time.

The protocol is in `README.md` under **Capture protocol**. The short version:
fixed camera on a tripod, one light moved between **six** exposures, light height
varied by ~15° between them (constant elevation makes the ambient term
unrecoverable and the solve refuses), manual exposure/WB/focus, room light killed,
and a chrome sphere in frame — large, 300px radius or more — read before cropping.

A note on this session's environment: image uploads did not reliably reach disk.
Only the first attachment of the conversation was written to
`/root/.claude/uploads/…`; later ones were visible to the model but not present as
files, so no pixel measurement was possible on them. If that recurs, ask for one
attachment per message, or a fetchable link, and **verify the file exists before
promising analysis.** Do not fall back to judging images by eye — §9.

---

## 2. Product decisions (settled — don't reopen)

- **Standalone tool, not a feature.** It exists to load an image, light it, and
  export a file. The original brief's Phase 5 — integrating into the
  "See It On Your Wall" app in `yitzhach/dm-t1` — is **dropped, not deferred.**
- **Personal tool first.** No accounts, billing, or multi-user anything.
- **Eventually** the owner wants to fold this into a separate 35mm project. Not
  scoped yet. The technical note filed here speculatively — that film grain is fine
  achromatic high-frequency detail, exactly what the single-image extractor reads as
  relief — has since been **measured and confirmed** on real cement (§4.3). It is not
  a defaults problem. On grainy achromatic material the single-image path is unsound
  and no image-only test will tell you so.
- **Minimise generative AI** remains the constraint, and it has been met
  completely: there is no model of any kind in this codebase. Nothing here needs
  one, because the geometry is either measured or recovered classically.
  **Reaffirmed explicitly** after the trade-off was put plainly: §3.2 means one
  photograph constrains only the slope along the light azimuth, and a learned prior
  is the only thing that fills the other half, so this constraint and
  "works on any photograph you upload" cannot both hold. The owner chose the
  constraint, to be revisited once the physics-only path is mature. Build for
  excellence where the physics reaches and refusal where it does not — do not
  quietly reopen this to chase generality.

---

## 3. What the original brief got wrong

All four were measured against a synthetic surface whose true height field is
known. Reproduce any of them with `node relight/tools/validate.mjs`.

### 3.1 The Phase 1 algorithm recovers nothing (r = 0.00)

The brief's §4 says: high-pass the luminance, treat it as a height field,
differentiate for normals. Under a light with azimuth **â**, Lambertian shading
of a height field *h* is

```
I ≈ N·L ≈ Lz − (∂h/∂x·Lx + ∂h/∂y·Ly) = Lz − |Lxy|·(∂h/∂â)
```

so the high-pass is a **derivative** of the surface, not the surface.
Differentiating it again compounds the error.

| pipeline | r vs ground truth |
|---|---|
| high-pass as height → differentiate (as briefed) | **0.00** |
| integrate along the source azimuth → differentiate | **0.74** |

The trap is that the wrong version still *looks* like relief — it traces
brushwork convincingly. **Fix: integrate, don't differentiate.** Implemented in
`src/gbuffer.js`.

### 3.2 One photograph buys half the surface

Only the slope *along* the source azimuth is recoverable; perpendicular is
unconstrained. This is the shape-from-shading ambiguity the brief correctly
identifies for *form*, appearing at *relief* scale too.

| source lighting | nx | ny |
|---|---|---|
| raking | 0.74 | −0.13 |
| single soft light | 0.45 | 0.26 |

"Relief is free" is really "half of relief is free." This is what promoted
photometric stereo from differentiator to load-bearing.

**Corrected — see §4.3.** Those columns are `nx` and `ny`, image axes, and they are
the along/across-azimuth decomposition only when the azimuth lies on an image axis.
That holds for the raking rig (167°) and not for the single one (141°). Scored along
each rig's own azimuth: **0.76 / −0.09** and **0.67 / 0.26**. The conclusion stands,
but the elevation penalty is 0.76 → 0.67, not 0.74 → 0.45. Do not repeat the
0.74/0.45 comparison as evidence that a raking light is essential — it is not what
the bench says.

### 3.3 The brief asks you to gather the worst possible reference photo

§0.2 says to source a "flat-lit, evenly lit, no glare" photograph. A proper
archival copy shot uses two matched lights at equal and opposite angles — a
geometry that exists specifically to *suppress* texture, and which cancels the
first-order shading term almost exactly. Measured recovery: **r = 0.00**.

**Ask for a single-source shot, ideally raking.** The better the repro
photography, the less relief survives to be found.

### 3.4 The proposed v1 acceptance test passes when the geometry is wrong

§8 #7 proposes: brushstroke shadowing must invert when a raking light crosses to
the other side. Run against the bench:

| source lighting | inversion test | actual recovery |
|---|---|---|
| raking | PASS (r = −0.80) | 0.74 |
| single | PASS (r = −0.87) | 0.45 |
| copy-stand | **PASS (r = −0.77)** | **0.00** |

Any normal field inverts when the light crosses, including one invented from
albedo noise. Keep it as a smoke test; use ground-truth correlation as the gate.

### 3.5 Two smaller corrections about the old host app

Only relevant if Phase 5 is ever revived, which it should not be:

- `heckbertH()` is a pure 2D→2D projective map with no camera intrinsics
  (`matrix3dCss` hardcodes the Z row to `0,0,1,0`). There is **no 3D plane
  orientation** sitting in it to harvest, and recovered it would be one constant
  normal across the piece — contributing no intra-image shading variation.
- That app's live stage composites through a **≤1100px JPEG data URL** under a
  CSS `matrix3d` transform. JPEG at that size destroys precisely the 2–7px detail
  this engine produces, so "image in, image out, behind one call site" was
  spatially right but temporally fatal.

---

## 4. What exists

~5,000 lines, plain ES modules, **no build step**, no dependencies.

| file | role |
|---|---|
| `src/gl.js` | WebGL2 scaffolding, float render targets, fullscreen-triangle passes |
| `src/gbuffer.js` | Single-image surface recovery — the corrected integrate-then-differentiate pipeline, chroma reject, ratio-based albedo de-lighting |
| `src/photometric.js` | Multi-shot measured surface — least-squares solve, ambient fit, Poisson height, fit residual |
| `src/register.js` | Capture-frame alignment — chromaticity matching, all-pairs robust fit, Lanczos-3 correction. DOM-free, so the harness scores it without a browser |
| `src/sphere.js` | Light directions read off a chrome sphere in frame — exact reflection geometry, no fit. Also DOM-free |
| `src/shade.js` | Cook-Torrance GGX, spot cones, inverse-square falloff, horizon-march cast shadows, occlusion, ACES |
| `src/kelvin.js` | Colour temperature via the Planckian locus (Kim et al.) → CIE xy → XYZ → linear sRGB |
| `src/export.js` | Tiled full-resolution render with overlap margin, for both surface paths |
| `src/synth.js` | Procedural painting with known height field; single shots, capture sets, optional chrome sphere and achromatic `grain` |
| `src/app.js` | UI, light rig, state, export wiring |
| `tools/recover.js` | CPU reference implementations of both surface paths, shared by the benches so real and synthetic numbers come from identical code |
| `tools/validate.mjs` | Ground-truth harness — relief, registration, sphere, grain (Node, no browser, ~65s) |
| `tools/decode.js` | Image input — PNG in-process, JPEG/WebP via headless Chromium, native resolution and optional native-res crop |
| `tools/spectrum.mjs` | Describes a photograph: which band its texture occupies, whether chroma reject can work, JPEG blocking. Descriptive only — predicts nothing |
| `tools/score-real.mjs` | Scores recovery against a **real** photometric capture; preflight, sphere read, relief-scale sweep, `--json` |
| `tools/fixture.mjs` | Writes a synthetic capture to disk as a real bundle — the worked example, and the self-test's input |
| `tools/selftest-real.mjs` | The real-capture chain end to end, 20 checks, no browser |
| `tools/png.js` | PNG encode/decode on `node:zlib`, no dependencies |
| `tools/smoke.mjs` | End-to-end browser suite via Playwright — 18 checks |
| `DEPLOY.md` | Cloudflare Pages and alternatives |

### The two surface paths

**Single image.** Corrected pipeline. Needs the source azimuth (a dial; auto-
estimation is unreliable when a regular canvas weave is present, because the
weave's own periodicity dominates the cue). A wrong azimuth degrades gracefully —
relief resolves along the wrong axis rather than producing garbage.

**Photometric stereo.** N exposures, fixed camera, light moved. Solves
`I_k = albedo·(N·L_k)` per pixel. **0.9995 / 0.9994** against ground truth versus
0.74 / −0.13 from one photograph, and true albedo falls out of the same solve —
which is why the brief's Phase 4 (intrinsic decomposition) no longer needs to
exist. Nothing is estimated.

Frames are now **registered** rather than trusted — see §4.1.

### 4.1 Frame registration, and the one thing that makes it work

"A tripod is doing that work on trust" is no longer true: **Align frames**
measures the drift between exposures and corrects it. Scored against a drift that
is exact by construction — the painting is synthesised at 3× and each frame
box-downsampled from a different integer offset on that fine grid, so one texel
upstairs is exactly ⅓ px downstairs with no interpolation in the ground truth:

| case | as shot (nx/ny, fit) | registered | shift err |
|---|---|---|---|
| clean | 0.9997 / 0.9997, 0.17% | 0.9997 / 0.9997, 0.17% | 0.003px |
| one frame 1.3px | 0.930 / 0.836, 2.32% | **0.993 / 0.984, 0.78%** | 0.020px |
| one frame 3px | 0.965 / 0.926, 1.51% | **0.9997 / 0.9997, 0.17%** | 0.003px |
| creep 0–2px | 0.203 / 0.902, 4.01% | **0.985 / 0.976, 1.14%** | 0.005px |

The load-bearing finding, and the one worth not re-deriving:

**Match on chromaticity, not on gradient magnitude.** The obvious light-invariant
feature is |∇ log L| — a ridge is an edge under any light, even though the sign of
that edge flips. It gets 12 of the 15 frame pairs of a six-shot capture right and
lands 3px out on the other three, because |∇ log L| is strongest *across* the
light azimuth: two frames lit 120° apart emphasise different edges. Chromaticity
is *exactly* invariant instead — under `I_c = albedo_c·(n·L + ambient)` the shading
is one scalar on all three channels, so `r/(r+g+b)` divides the lamp out. All 15
pairs, r = 0.999. It ignores the canvas weave for free, the weave being achromatic.

The feature is `|∇ log L| + 8·|∇ chromaticity|` at **fixed** gain, deliberately not
normalised: that is what makes an achromatic subject fall back to luminance
instead of having its chroma *noise* promoted to equal authority. On a desaturated
copy of the bench painting every gain from 0 to 16 is bit-identical.

Three more, briefly, each of which cost a wrong result first:

- **Build coarse pyramid levels by downsampling the feature**, never by
  re-gradienting a downsampled photograph. The second lands 2–4px off zero on
  frames that never moved: at ¼ scale the pixel differences straddle a whole
  brushstroke rather than a ridge flank, and a brushstroke's shading lobe leans
  toward the lamp and moves with it.
- **Anchor on the median frame position**, not the mean and not frame 0. In the
  usual case — one frame knocked out, the rest held — the median leaves the ones
  that held on exact integer offsets, and an integer offset is a copy, not a
  filter. That is why the clean row above costs nothing.
- **Lanczos-3, not bilinear.** Correcting by the *known* drift isolates the
  resampler from the estimate: uncorrected 0.203/0.902, bilinear 0.939/0.885,
  Catmull-Rom 0.964/0.932, Lanczos-3 0.985/0.976. Bilinear throws away half of
  what registration wins, because a half-pixel bilinear shift is a low-pass whose
  knee is inside the 2–7px band this engine works in.

Because registered lands on the correct-by-truth floor in every case, **the
estimate is essentially exact and what remains to improve is interpolation.**

Every pair is measured rather than every frame against frame 0, and positions come
from a weighted least-squares fit over all of them — 15 measurements of 5 unknowns,
so a pair that cannot see its partner is outvoted rather than carrying its frame
off alone, and the leftover disagreement is a confidence number needing no ground
truth. The verdict shown to the user is the **fit residual before against after**;
if it does not improve, the frames are put back and it says so.

### 4.2 The error nothing else in this tool can see

**Read this before touching the photometric path.** It is the sharpest result of
the project so far and it is not intuitive.

The solve takes light directions as *given*. Turn the whole rig by one angle — the
wrong reference azimuth, a nominal template typed in — and the Fit view reads
**0.17% at every angle, identical to a flawless capture**, while the surface rotates
off the painting:

| rig turned by | 0° | 2° | 10° | 20° | 40° |
|---|---|---|---|---|---|
| normals nx / ny | .9997/.9997 | .9992/.9991 | .9856/.9834 | .9437/.9349 | **.7810/.7498** |
| fit residual | 0.17% | 0.17% | 0.17% | 0.17% | **0.17%** |

Exact, not a tuning artefact: rotate every `L_k` by `R` and `g' = Rg` satisfies
`g'·(R L_k) = g·L_k = I_k`. The model reproduces every photograph perfectly and
returns a rotated surface. The relit output is entirely convincing with its impasto
shadows falling at the wrong angle to the brushwork.

Errors that are *not* uniform do show (each light off its own way by 10° reads
6.29%) — but the uniform case is what a remembered rig actually produces, and every
diagnostic in this tool compares the lights against **each other**, so none of them
can break the symmetry.

**A chrome sphere can**, by measuring each direction against the room. `src/sphere.js`.
It is exact geometry — a mirror reflects the lamp into the eye only where the normal
bisects them, so `N = normalise(L + V)` and with `V = (0,0,1)` that inverts as
`L = 2 nz (nx, ny, nz) - V`. Measured against a known rig on a 200px-radius sphere:
**worst 0.33°**, azimuth exact.

Three things worth not re-deriving:

- **The circle is placed by hand and the error scales with circle-error / radius,
  not with pixels.** 3px of centre error costs 9.63° at r=40 and 1.60° at r=300. So
  the requirement is a *big sphere* — a line in the capture protocol — rather than a
  steady hand, which is unenforceable. The reading reports `sensitivity` in degrees
  per pixel so a given placement's worth is on screen.
- **The obvious repair was built and removed.** Snapping the circle to the sphere's
  silhouette cannot be judged by this bench: it would be tested against `synth.js`'s
  own model of a sphere's edge. And on that render there is no edge to find — the
  luminance just inside the rim (~0.26) is indistinguishable from the painting just
  outside (0.23–0.40), because a mirror near its silhouette reflects the room at
  grazing angles. The validatable route is optimising the circle against the fit
  residual; it is in §8.
- **A sphere in frame must be excluded from the fit.** A mirror is not Lambertian, so
  its pixels dominate the residual: a clean capture reads 1.49% with the sphere left
  in and 0.16% with its disc excluded — enough to hide a real fault behind the
  diagnostic meant to reveal it. Excluded from the measurement, and drawn flat grey
  in the Fit view rather than silently dropped.

A circle that is not on a sphere still returns six confident directions, so two
checks catch that: readings that all agree cannot be readings of a mirror (the lamp
moved between exposures — a circle on paint returns six directions within 4.2° of
each other), and the fit residual before against after (0.16% → 6.35%).

### 4.3 What the first real photograph changed

The first real material the project has seen: cast cement and plaster, heavily
textured, largely achromatic, in soft light. At the shipped defaults the recovered
normals were **speckle** and the relit render looked entirely convincing — §3.1
again, on real material rather than on a synthetic bench built to demonstrate it.

**Grey grain is the adversary the bench did not have.** The synthetic painting's
high-frequency adversary is chromatic *by construction*, which is what makes chroma
reject able to find it. Cement shifts no hue:

| light | grain | single image (along/across) | photometric (nx/ny) | contrast |
|---|---|---|---|---|
| raking 20° | 0.00 | 0.773 / 0.157 | 0.9970 / 0.9990 | 0.286 |
| frontal 89° | 0.00 | 0.096 / −0.011 | 0.9970 / 0.9990 | 0.027 |
| frontal 89° | 0.20 | **0.035** | **0.9975** / 0.9989 | **0.075** |

`synth.js` has a `grain` parameter now. Two consequences, both load-bearing:

- **No image-only "is this shot usable?" gate exists, and one was tried.** The
  obvious statistic — contrast of the high-passed log-luminance — tracks rakingness
  cleanly on a fixed surface, and grain breaks it: under frontal light contrast goes
  *up* 0.027 → 0.075 while recovery goes *down* 0.096 → 0.035. It moves the wrong
  way, so no threshold separates the cases. The real photograph reads 0.67–0.86,
  above every synthetic case, and returns speckle. Do not rebuild this.
- **Photometric stereo does not care about grain at all** (0.9975 at every level),
  because grain is albedo and albedo is what the solve separates out. For achromatic
  grainy material the multi-shot path is not an upgrade — it is the only sound
  option, and that is a fact about the material, not a tuning problem.

**Elevation matters much less than §3.2 implied**, once recovery is scored along the
azimuth rather than along x. Across azimuths 0–160° and elevations 10–60° the
along-azimuth recovery sits between 0.66 and 0.85 and barely moves; it falls at 75°
and collapses only at 89°. Advise a single source and a correctly-set azimuth dial;
do not insist on a grazing angle.

**Real material is broadband.** The photograph carries texture energy from 2px to
190px with no dominant scale, where the synthetic weave has a clear 7px period. The
default `relief scale` of 3px reads a band that on cement is grain. There is no
single right default across materials, which is why this is still open.

### 4.4 Built, measured, and deliberately removed — do not rebuild these

Three plausible features were implemented, scored against ground truth, and then
deleted. Each is the kind of thing a fresh session reaches for in the first hour.

**A silhouette fitter for the chrome sphere's circle.** Hand-placing the circle
genuinely costs accuracy (3px of centre error on an 80px sphere is 5.07°), so
snapping it to the sphere's outline is the obvious repair. The bench cannot judge
one: it would be scoring an edge detector against `synth.js`'s own model of a
sphere's edge. And on that render there is no edge — luminance just inside the rim
(~0.26) is indistinguishable from the painting just outside (0.23–0.40), because a
mirror near its silhouette reflects the room at grazing angles. What rescues
placement instead is that error scales with circle-error / **radius**, so the fix is
a big sphere. §4.2.

**A contrast-based "is this photograph usable?" gate.** The statistic — contrast of
the high-passed log-luminance — tracks how raking the light was, cleanly, on a fixed
surface. Achromatic grain breaks it: under frontal light it takes contrast *up*
0.027 → 0.075 while recovery goes *down* 0.096 → 0.035. It moves the wrong way, so
no threshold separates the cases. §4.3.

**An automatic source-azimuth estimator.** Under `I ≈ Lz − |Lxy|·∂h/∂â` a bump is
dark on the side away from the lamp and bright toward it, so the directional
derivative of the high-pass should have maximum skew along the light azimuth. It is
sound reasoning and it does not work. Validated against the bench's known rigs:

| rig | true azimuth | estimated | error | its own confidence |
|---|---|---|---|---|
| raking | 167° | 170° | 3° | 1.64 |
| single | 141° | 185° | **44°** | 1.82 |
| copy-stand | 141° | 115° | 26° | **2.24** |

It reports its *highest* confidence on the copy-stand shot, which by finding 3 has
no recoverable direction at all. Same shape as §3.4 and §4.3: the diagnostic is
loudest where it knows least. The azimuth stays a dial the user sets.

### 4.5 The real-capture harness

Every single-image number above this line was measured on `synth.js`. §4.3 is the
record of what that is worth: the one real photograph the project has seen behaved
unlike every synthetic case, reading a high-pass contrast of 0.67–0.86 — above every
bench value — while returning speckle. Bench numbers do not transfer to real
material, and until now there was no way to get a real one.

`tools/score-real.mjs` is that way. It reads a capture bundle off disk, registers
the frames, reads the sphere, solves — and then runs the **single-image** path on
each individual exposure and scores it against the normals that solve measured. One
six-exposure shoot yields six (photograph → known normals) pairs on real material.

The recovery maths lives in `tools/recover.js` and is imported by **both**
`validate.mjs` and `score-real.mjs`. That is not tidiness. A second copy of
`integrate` in the real harness would drift from the bench's silently, and the real
column and the synthetic column would stop measuring the same thing while still
appearing in the same table. The extraction was verified by diffing `validate.mjs`'s
full output before and against after: bit-identical, same md5.

Three things worth not re-deriving:

- **The registration verdict must exclude the sphere's disc.** Registration is
  judged on the fit residual before against after (§4.1), and a mirror is not
  Lambertian: with the disc left in, a clean capture reads **3.70%** where the same
  capture reads **0.17%** with it excluded. That is §4.2's finding applied to a
  second diagnostic — large enough to swamp the improvement the comparison exists to
  detect. Both ends of the comparison now use the same exclusion the solve does.
- **Preflight is separate from scoring, and runs before the lights come down.** Two
  faults cannot be repaired afterwards: a rig at constant elevation, which
  `buildSolver` refuses outright, and a sphere too small or clipped by the frame. The
  check asks `buildSolver` rather than reimplementing its test, so it cannot disagree
  with the thing that will actually run.
- **A sphere-less capture is scored but flagged three times over.** Without a sphere,
  "ground truth" means "the surface implied by the angles typed into the manifest",
  and §4.2 is exactly the argument that a low fit residual does not establish those
  angles. The harness says so at preflight, at the solve, and under the results
  table rather than printing a confident number.

`tools/selftest-real.mjs` runs the whole chain against `tools/fixture.mjs`, which
writes a synthetic capture out as real PNG files with the true height field known —
20 checks, no browser, ~90s. Two of its assertions are pinned findings rather than
plumbing tests: that grain leaves photometric stereo alone while degrading the
single-image path, and that **high-pass contrast rises while recovery falls**. That
second one is the statistic §4.4's deleted gate was built on, and it is the finding a
fresh session is most likely to un-learn by rebuilding it.

Confirmed independently by the new harness, on file-based data rather than in-memory
arrays: grain 0.35 leaves the photometric fit at 0.20% against 0.17% clean, drops
single-image recovery 0.615 → 0.459, and takes contrast 0.131 → 0.170 — up, while
recovery falls.

### 4.6 The first real photograph, measured rather than looked at

A 9.3MP JPEG of a cast cement piece (`relight/captures/test/3.jpg`), shot outdoors
under overcast sky. `tools/spectrum.mjs` describes it; nothing here predicts
recovery, for reasons that become clear below.

**The JPEG was not the problem.** A reasonable first suspicion — the file is a JPEG
and the user had relief scale at 2px, right where 8×8 block ringing lives — is
wrong, and measurably so. Luma quantisation table sums to 463 with a maximum
coefficient of 13 (light compression), and the blocking test finds **no excess
gradient energy on the 8px grid**: ratios 0.93–1.00 across four crops. Chroma is
4:2:0, which halves chroma resolution, but see below — there is no chroma to lose.

**The material is achromatic to a degree the bench never modelled.** Fine-scale
chroma against fine-scale luma:

| crop | luma sd | chroma sd | ratio |
|---|---|---|---|
| 179,149 | 0.338 | 0.0077 | **0.023** |
| 1801,619 | 0.480 | 0.0071 | **0.015** |
| 798,1090 | 0.327 | 0.0077 | **0.024** |
| 2421,1560 | 0.434 | 0.0068 | **0.016** |

Mean 0.019. **Chroma reject is inert on this material** — the mechanism that
separates pigment from relief has a signal thirty to seventy times weaker than the
thing it is meant to arbitrate. §4.3 said grain "shifts no hue"; this is the number.

**The spectrum is broadband with no characteristic scale.** Energy added by each
band peaks at the *finest* one (1–1.5px) in every crop and decays monotonically
outward. There is no bump at the scale of the trowel marks. That is what §4.3 meant
by broadband, and it has a consequence worth stating plainly: **no choice of relief
scale isolates relief from grain here, because they overlap continuously rather
than occupying different bands.** Retuning the default (§8) cannot fix this material
— it can only trade which mixture you read.

### 4.7 Two more diagnostics built, calibrated, and thrown away

§4.4 records three. Two more were tried against this photograph and killed by the
same method: compute the statistic on bench cases whose true recovery is known
*first*, and only interpret real material if the controls separate. Neither did.

**Anisotropy of the recovered height field.** Integrating an isotropic field along â
turns it into a 1-D random walk along â, so across/along gradient energy should
distinguish "read a surface" from "smeared noise". Controls:

| case | true r | across/along |
|---|---|---|
| raking 20°, no grain | 0.771 | 1.175 |
| raking 20°, grain 0.20 | 0.748 | 1.228 |
| 45° single, grain 0.20 | 0.594 | 2.248 |
| frontal 89°, no grain | 0.131 | 2.000 |
| frontal 89°, grain 0.20 | 0.041 | 1.807 |
| **pure achromatic noise** | — | **1.236** |

Pure noise lands *between* two recovering cases. No threshold separates them.

**Cross-azimuth agreement.** One photograph constrains only the along-azimuth slope,
so integrating the same image along several azimuths recovers partial views of one
height field — they should agree for real relief and not for noise. Controls give
0.046–0.119 for the recovering cases and −0.046–0.103 for the non-recovering ones.
Overlapping. Discarded.

That is five diagnostics built and deleted across the project — §4.4's three plus
these two, of which four were attempts to judge a capture or a shot from the data
alone. The pattern is stable enough to state as a rule: *nothing computed from a single photograph has
yet been able to say whether that photograph will yield relief.* Treat any new
candidate as guilty until it separates bench controls, and expect it not to.

### Two capture rules enforced in code, not just documented

1. **Ambient light must be fitted, and that needs varied light elevation.**
   Ambient biases recovered tilt to 9.7° against a true 12.2°. Fitting it as a
   fourth unknown fixes that exactly — but at uniform elevation the `Lz` column is
   a constant multiple of the ambient column, the system is rank-deficient, and
   the solve collapses to zero. `buildSolver` detects the collinearity and
   **refuses with that explanation** rather than returning a plausible wrong
   surface.
2. **Shoot more exposures than there are unknowns.** Three shots solve for a
   normal, four for a normal plus ambient — but either way the system is then
   exactly determined, the model fits perfectly by construction, and the fit
   residual is identically zero *however wrong the capture is*. A 3px
   misalignment reads 3.39% on six shots and **0.00% on four**. The default rig is
   six, and where nothing is spare the UI says "fit unmeasurable" instead of
   printing a reassuring zero.

### The Fit view

The diagnostic a real capture can have, since it comes with no ground truth.
Re-projects the solved `g` through each light direction and compares against what
was photographed. Blue = the model matches. Clean capture 0.16%; one frame off by
3px → 3.39%; one light angle 40° out → 1.70%.

---

## 5. Running it

```bash
python3 -m http.server 8080          # then http://localhost:8080/relight/
node relight/tools/validate.mjs      # ground-truth maths, registration and sphere, no browser
node relight/tools/smoke.mjs         # end-to-end browser suite, 18 checks (needs playwright)
node relight/tools/selftest-real.mjs # real-capture harness end to end, 20 checks, no browser

node relight/tools/fixture.mjs /tmp/cap --sphere        # a worked capture bundle
node relight/tools/score-real.mjs /tmp/cap --preflight  # is this capture solvable?
node relight/tools/score-real.mjs /tmp/cap              # score single-image against truth
node relight/tools/score-real.mjs /tmp/cap --sweep      # which band carries the relief
node relight/tools/score-real.mjs /tmp/cap --json       # same, machine-readable
```

The capture bundle format is in `README.md` under **Capture bundles**. PNG is read
with no dependencies; JPEG and WebP need `playwright` installed to decode.

Must be served over http(s) — ES modules will not load from `file://`.
Deployment (Cloudflare Pages included) is in `DEPLOY.md`. Build output directory
is `relight`, build command **empty** — this repo's root holds an unrelated Vite
site and a framework preset will try to build that instead.

Requires WebGL2 with `EXT_color_buffer_float`. Without it the signed height field
clamps to [0,1] and relief goes wrong while still looking like relief, so the
bench refuses to start and says why.

---

## 6. Status against the original phase plan

| phase | state |
|---|---|
| 0 — Bench | done |
| 1 — Relief | algorithm corrected and the correction measured — but **unsound on achromatic grainy material** (§4.3), which is what the owner makes |
| 2 — Light rig | done — N lights, canvas handles, Power/Distance/Cone/Kelvin |
| 3 — Shadows & AO | done — horizon march + height-derived occlusion |
| 4 — Albedo recovery | partial single-image; **superseded** on the photometric path |
| 5 — Host integration | **dropped** — standalone product |
| 6 — Export | done, both paths |
| 7 — Photometric stereo | done, and the strongest part of the tool; frames are now registered rather than trusted, and light directions measured rather than recalled |
| 8 — Tier 3 depth model | not started, and unnecessary for the stated use case |

---

## 7. Known limits

- **Registration corrects translation only.** Rotation, scale and lens breathing
  are not corrected; the Fit view will show them, nothing here will fix them.
  It also runs on demand rather than automatically — a 12MP six-shot set takes
  ~15s, which is not something to spend without being asked.
- **Registration is measured at up to 1600px on the long edge** and applied at full
  resolution. The cost of that cap is measured: 0.9994/0.9990 at ½ scale against
  0.9997/0.9996 at full, and 0.9918/0.9860 at ¼ — all still far ahead of the
  0.914/0.829 of leaving the drift in.
- **An achromatic subject is the weak case for registration.** With no colour it
  falls back on luminance alone and 2 of 15 frame pairs go wrong. The other 13
  outvote them and the answer still lands, but the discounted count is reported
  for a reason.
- **The sphere's circle is placed by hand**, and there is no automatic silhouette
  fit — §4.2 records why one was removed rather than shipped. Without a sphere in
  the capture, light directions are still typed in, and §4.2 is what that costs.
- **A sphere reading assumes a neutral lamp and orthographic projection.** A
  strongly coloured light or a very short lens biases it; neither is measured.
- **Defaults are tuned to the synthetic canvas**, whose weave is coarser than real
  linen. The prominent dotted texture in every screenshot so far is that synthetic
  weave, not a real painting. Measured against real cement (§4.3) the default relief
  scale reads grain rather than relief; real material is broadband and no single
  default fits both.
- **Single-image recovery is unsound on achromatic grainy material** — cement,
  plaster, sand, paper — and there is no image-only test that will tell you so. §4.3.
- **Tiled photometric export is not bit-exact** against an untiled render (mean
  0.026/765, max 21, no coherent seam). Cause is Jacobi convergence, not margin:
  after N sweeps only features up to ~N texels have settled. The mean-removal blur
  is cut at exactly that reach to discard the unconverged band. Zero needs
  multigrid.
- **Single-image auto-azimuth is unreliable**, and now measurably so — an estimator
  was built and scored 44° out on a plain single-light shot while reporting its
  highest confidence on the copy-stand shot that has no direction at all (§4.4).
  Shipped as a dial the user sets.
- No preset system, no save/load of light rigs, no undo.

---

## 8. What's next

**A decision was taken this session and is not open:** the "minimise generative AI"
constraint of §2 stays. No learned model, for now, to be revisited once the
physics-only path is mature. That settles a tension worth naming — §3.2 is the
mathematical fact that one photograph constrains only the slope *along* the light
azimuth, and a learned prior is the only thing that fills the other half. A tool
that takes any photograph and returns something plausible (ClipDrop and similar)
buys its generality that way. This one will be excellent where the physics reaches
and will refuse where it does not, and that is now a chosen position rather than an
accident.

The owner's order, with what each is actually worth:

1. **Run the single-image path on a real painting, by hand.** Zero code; the tool
   ships this as its default mode. It answers the one question that governs
   everything else: is this material in the 0.77 bucket or the 0.03 bucket? Note the
   bound, which is §9's whole lesson — **this test can falsify but it cannot
   confirm.** Speckle is real signal. A convincing render is "not obviously broken",
   which is much weaker than it will feel, because §3.1, §3.4 and §4.3 are all cases
   where the wrong answer looked entirely right.
2. **Shoot the six-exposure capture.** Its purpose has changed and the change
   matters: not to make the photometric path better, but to produce the project's
   first non-synthetic score for the *single-image* path. `tools/score-real.mjs`
   (§4.5) is what converts the shoot into that number, and it exists now — run
   `--preflight` before striking the lights, because a rank-deficient rig and an
   undersized sphere are the two faults that cannot be repaired afterwards.
   Nothing here trains anything: the capture makes the single-image path *measured*,
   not smarter. It will behave identically afterwards.
3. **Retune the single-image defaults against that capture.** `--sweep` is the tool.
   §4.3 left this open because real material is broadband where the synthetic weave
   has a clean 7px period; the sweep asks the ground truth which band to read. It
   returns 3px on the bench — the shipped default, and the bench's own weave period —
   which is the check that it measures what it claims.
4. **A shot-quality warning, approached honestly.** §4.3 killed a gate built on
   high-pass contrast, and §4.5 now pins that failure as a regression test. Do not
   rebuild it. But note precisely what was established: that *statistic* fails, and
   the bench could not validate any gate because it lacked the adversary. Whether
   *some* image-only gate exists is not settled — though the honest prior is poor,
   since grain and relief are genuinely indistinguishable in one photograph. Real
   (photograph → truth) pairs from step 2 are what would let a candidate be tested
   against truth rather than guessed at. Effort belongs on the conditions that
   already work (raking, 45°), not on rescuing frontal or copy-stand input, which
   §3.3 measured at r = 0.00 and which no amount of tuning reaches.
5. **Keep every capture as a labelled bundle** (`README.md`, Capture bundles).
   Cheap now, impossible to reconstruct once the paint has been rephotographed. And
   if the model decision is ever revisited, a solved bundle is exactly the training
   pair a single-image estimator needs — at r ≈ 0.9995 per pair, with §4.1 and §4.2
   being what make the labels trustworthy rather than silently rotated.

Still open from before, unchanged in priority:

6. **Fit the sphere's circle against the photometric residual.** §4.2 leaves circle
   placement as the one hand-set number that still costs real accuracy. Three
   parameters, an objective the tool already computes, ground truth in the bench.
   The residual is blind to a *uniform* rotation of the rig, so this refines a circle
   but never replaces the sphere.
7. **A resample-free correction path for registration.** §4.1: the estimate is
   essentially exact and the remaining loss is interpolation. Fold each frame's
   sub-pixel offset into the solve shader's UV rather than pre-shifting pixels.
   Measure first — a GPU sampler gives bilinear, the worst kernel measured.
8. **Register rotation as well as translation.** Only if a real capture needs it.
9. Preset/save system for light rigs.

### A note on getting images into a session

Two delivery routes failed outright this session and cost real time, so: image
attachments did not reach disk on any of three attempts (`/root/.claude/uploads/`
did not exist), and `isaacandersonart.com` is refused by the sandbox's egress policy
at the CONNECT stage — a 403 from the proxy, not a network error, and not something
to route around.

**Commit the photographs to the repository instead.** That path is known to work, it
versions the capture alongside the manifest that explains it, and it is the same
`captures/<painting>/` layout `score-real.mjs` already reads. A bundle in git is not
a workaround for the upload problem; it is the storage format the project wanted
anyway.

## 9. How this project has been worked, and why it matters

Every significant finding here was something that **looked right and was wrong**:
a relief pipeline that traced brushwork beautifully and recovered nothing; an
acceptance test that passed hardest on the capture that recovered nothing; a fit
residual that read a perfect 0.00% precisely when it had no information; a frame
matcher built on the textbook light-invariant feature that was confidently 3px out
on a fifth of its comparisons; a rig rotated bodily off the painting that fits every
photograph perfectly at 0.17% while returning the wrong surface; and a shot-quality
gate whose statistic rose while the thing it was meant to measure fell.

The practice that caught all of them: **synthesise a surface whose truth you
know, feed the tool only the render, and score the recovery numerically.** Do not
judge relief by eye — it is the one thing that cannot be judged by eye. If you add
a surface-recovery feature, add it to `tools/validate.mjs` too.

Two conventions worth keeping:

- **Refuse rather than approximate.** Where the maths is degenerate — a singular
  light rig, a missing GPU extension, a fit with no degrees of freedom — say so
  and stop. Every one of those would otherwise produce confident, plausible,
  wrong output.
- **State the measurement, not the impression.** Commit messages and this document
  carry the numbers because "looks better" has been wrong repeatedly here.
