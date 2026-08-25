# Relight Engine — Handoff

**Read this before `RELIGHT-BRIEF.md`.** The original brief is still the best
statement of *why* this project exists, but several of its load-bearing technical
claims were tested during the build and turned out to be wrong. Those corrections
are in §3 below. A session that follows the brief's §4, §7.1 or §8 #7 as written
will rebuild something that does not work and looks like it does.

**Status:** working, deployable, validated against ground truth.
**Repo:** `yitzhach/newTEST` · **Branch:** `claude/getting-started-jf5cub` · **Path:** `relight/`
**Predecessor brief:** `yitzhach/dm-t1`, branch `claude/photo-relighting-app-ge73k7`, file `RELIGHT-BRIEF.md`

---

## 1. Kickoff prompt

> I'm continuing work on a photorealistic relighting engine for photographs of
> artwork. It's a standalone browser tool that exports a finished image — not a
> feature inside another app.
>
> The code is in this repo under `relight/` on branch
> `claude/getting-started-jf5cub`. **Read `relight/HANDOFF.md` in full before
> responding.** It supersedes the older `RELIGHT-BRIEF.md` (which lives in a
> different repo, `yitzhach/dm-t1`) on every technical point where they disagree —
> §3 of the handoff lists exactly what the old brief got wrong and why, all of it
> measured rather than argued.
>
> Don't re-derive those findings and don't trust the old brief's algorithm. Pick
> up from "What's next" at the end of the handoff, or tell me if you think
> something else deserves to jump the queue.

---

## 2. Product decisions (settled — don't reopen)

- **Standalone tool, not a feature.** It exists to load an image, light it, and
  export a file. The original brief's Phase 5 — integrating into the
  "See It On Your Wall" app in `yitzhach/dm-t1` — is **dropped, not deferred.**
- **Personal tool first.** No accounts, billing, or multi-user anything.
- **Eventually** the owner wants to fold this into a separate 35mm project. Not
  scoped yet. One technical note for when it happens: film grain is fine
  achromatic high-frequency detail, which is exactly what the single-image
  extractor reads as relief. That path will need different defaults.
- **Minimise generative AI** remains the constraint, and it has been met
  completely: there is no model of any kind in this codebase. Nothing here needs
  one, because the geometry is either measured or recovered classically.

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

| source lighting | along azimuth | perpendicular |
|---|---|---|
| raking | 0.74 | −0.13 |
| single soft light | 0.45 | 0.26 |

"Relief is free" is really "half of relief is free." This is what promoted
photometric stereo from differentiator to load-bearing.

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

~4,000 lines, plain ES modules, **no build step**, no dependencies.

| file | role |
|---|---|
| `src/gl.js` | WebGL2 scaffolding, float render targets, fullscreen-triangle passes |
| `src/gbuffer.js` | Single-image surface recovery — the corrected integrate-then-differentiate pipeline, chroma reject, ratio-based albedo de-lighting |
| `src/photometric.js` | Multi-shot measured surface — least-squares solve, ambient fit, Poisson height, fit residual |
| `src/register.js` | Capture-frame alignment — chromaticity matching, all-pairs robust fit, Lanczos-3 correction. DOM-free, so the harness scores it without a browser |
| `src/shade.js` | Cook-Torrance GGX, spot cones, inverse-square falloff, horizon-march cast shadows, occlusion, ACES |
| `src/kelvin.js` | Colour temperature via the Planckian locus (Kim et al.) → CIE xy → XYZ → linear sRGB |
| `src/export.js` | Tiled full-resolution render with overlap margin, for both surface paths |
| `src/synth.js` | Procedural painting with known height field; single shots and capture sets |
| `src/app.js` | UI, light rig, state, export wiring |
| `tools/validate.mjs` | Ground-truth correlation harness (Node, no browser) |
| `tools/smoke.mjs` | End-to-end browser suite via Playwright — 9 checks |
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
node relight/tools/validate.mjs      # ground-truth maths + registration check, no browser
node relight/tools/smoke.mjs         # end-to-end browser suite, 15 checks (needs playwright)
```

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
| 1 — Relief | done, algorithm corrected and the correction measured |
| 2 — Light rig | done — N lights, canvas handles, Power/Distance/Cone/Kelvin |
| 3 — Shadows & AO | done — horizon march + height-derived occlusion |
| 4 — Albedo recovery | partial single-image; **superseded** on the photometric path |
| 5 — Host integration | **dropped** — standalone product |
| 6 — Export | done, both paths |
| 7 — Photometric stereo | done, and the strongest part of the tool; capture frames are now registered rather than trusted |
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
- **Light directions for uploaded shots are typed in by hand.** Estimating them
  from a chrome sphere in frame is the standard trick and is not implemented.
- **Defaults are tuned to the synthetic canvas**, whose weave is coarser than real
  linen. The prominent dotted texture in every screenshot so far is that synthetic
  weave, not a real painting.
- **Tiled photometric export is not bit-exact** against an untiled render (mean
  0.026/765, max 21, no coherent seam). Cause is Jacobi convergence, not margin:
  after N sweeps only features up to ~N texels have settled. The mean-removal blur
  is cut at exactly that reach to discard the unconverged band. Zero needs
  multigrid.
- **Single-image auto-azimuth is unreliable** in the presence of a regular weave.
  Shipped as a dial.
- No preset system, no save/load of light rigs, no undo.

---

## 8. What's next

Ranked, with reasons rather than a bare list:

1. **Estimate light directions from a chrome sphere** placed in frame. Now the
   most error-prone manual step left, and the one remaining input that is typed in
   rather than measured — a light angle 40° out reads only 1.70% on the Fit view,
   which is well inside the range a merely-imperfect capture produces, so a wrong
   angle is not reliably visible. The sphere makes it measurable.
2. **Retune defaults against a real photograph.** Blocked on the owner supplying a
   single-source raking-light shot of a painting with real impasto. Everything
   downstream is calibrated against the synthetic weave until then. This is the
   only item blocked on something other than time, and it gates the honesty of
   every default in the tool.
3. **A resample-free correction path.** §4.1 established that registration's
   estimate is essentially exact and the whole remaining loss is interpolation
   (fit 0.78% against a 0.17% floor on the sub-pixel case). Rather than a better
   kernel, the real fix is not to resample at all: fold each frame's sub-pixel
   offset into the solve, by sampling the shot array at the shifted UV in the
   solve shader instead of pre-shifting the pixels. That moves the interpolation
   onto the GPU's sampler and out of the data, and it makes alignment free to
   apply and free to undo. Worth measuring before assuming it wins — bilinear is
   all a GPU sampler gives, and §4.1 measured bilinear as the worst option.
4. **Register rotation as well as translation.** Only worth it if a real capture
   turns out to need it; a tripod that rotated is usually a re-shoot.
5. Preset/save system for light rigs — the first thing that will be missed in
   sustained real use.

## 9. How this project has been worked, and why it matters

Every significant finding here was something that **looked right and was wrong**:
a relief pipeline that traced brushwork beautifully and recovered nothing; an
acceptance test that passed hardest on the capture that recovered nothing; a fit
residual that read a perfect 0.00% precisely when it had no information; a frame
matcher built on the textbook light-invariant feature that was confidently 3px out
on a fifth of its comparisons.

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
