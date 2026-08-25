# Relight Bench — Phase 0/1

An isolated WebGL2 bench for the relighting engine described in `RELIGHT-BRIEF.md`.
No build step: serve this directory and open `index.html`.

```
python3 -m http.server 8080      # then open http://localhost:8080/relight/
node relight/tools/validate.mjs  # ground-truth check on the surface maths
node relight/tools/smoke.mjs     # end-to-end browser check (needs playwright)
```

Deploying it anywhere — Cloudflare Pages included — is covered in `DEPLOY.md`.
There is no build step; it needs a static host and nothing else.

Built per §8 #1 (standalone bench before touching shipping code) so that surface
response can be judged before anything is wired into a host app.

---

## What this phase was supposed to answer

> Does high-pass relief extraction look convincing on a real painting?

That question turned out to be the wrong one, and the reason is the main result
below. "Looks convincing" and "is correct" come apart here — sharply.

---

## Findings

### 1. The stated Phase 1 algorithm recovers nothing. Measured: r = 0.00

The brief's §4 pipeline is: high-pass the luminance, treat the result as a height
field, take its gradient, get normals.

Under a light with azimuth **â**, Lambertian shading of a height field *h* is

```
I  ≈  N·L  ≈  Lz − (∂h/∂x·Lx + ∂h/∂y·Ly)  =  Lz − |Lxy|·(∂h/∂â)
```

so the high-passed luminance is proportional to a **derivative** of the surface,
not to the surface. Treating it as a height and differentiating again yields
something like a second derivative. Correlation with the true normals:

| pipeline | r vs ground truth |
|---|---|
| high-pass as height, then differentiate (as briefed) | **0.00** |
| integrate along the source azimuth, then differentiate | **0.74** |

The dangerous part is that the naive version still *looks* like relief — it traces
brushwork convincingly. It produces plausible geometry that is not the geometry in
front of it. This is why the bench ships with a ground-truth harness rather than
relying on judgement by eye.

**Fix: integrate, don't differentiate.** Implemented in `src/gbuffer.js`.

### 2. One photograph buys half the surface

Only the slope component *along* the source azimuth is recoverable. Perpendicular
is unconstrained — the shape-from-shading ambiguity the brief correctly identifies
for *form*, appearing at *relief* scale too:

| source lighting | along azimuth | perpendicular |
|---|---|---|
| raking | 0.74 | −0.13 |
| single soft light | 0.45 | 0.26 |

This weakens "relief is free". Relief is *half* free, from one image. A second shot
with the light moved recovers both components — which is the real argument for the
photometric-stereo path, and moves it from "differentiator" toward "load-bearing".

### 3. A good repro photograph is the worst input

A proper archival copy shot uses two matched lights at equal and opposite angles.
That geometry cancels the first-order shading term almost exactly — it exists
precisely to suppress texture. Measured recovery: **r = 0.00**, indistinguishable
from noise.

This inverts the brief's §0.2 gathering instruction. "Flat-lit, evenly lit, no
glare" describes the one lighting setup that destroys the signal. What Phase 1
needs is a *single*-source shot, ideally a raking one.

Compare the two recovered normal maps in the bench: switch **Shot with** between
*Raking* and *Archival copy-stand* and select **View → Normals**.

### 4. A four-shot capture recovers the surface essentially exactly

Photometric stereo — the same painting shot N times from a fixed camera with the
light moved — solves `I_k = albedo·(N·L_k)` per pixel for known `L_k`. Measured
against the same ground truth:

| method | nx | ny |
|---|---|---|
| single photograph, corrected pipeline | 0.74 | −0.13 |
| 4-shot photometric stereo (GPU path) | **0.9995** | **0.9994** |

True albedo falls out of the same solve, which also disposes of the separate
intrinsic-decomposition step the brief scoped as Phase 4 — there is nothing left
to estimate.

Two capture rules came out of the measurements and are enforced in code rather
than left to be discovered:

- **Ambient light flattens the result.** It biases recovered tilt to 9.7° against
  a true 12.2°. It can be fitted as a fourth unknown, but only if the lights
  differ in **elevation**. At one elevation the `Lz` column is a constant multiple
  of the ambient column, the system is rank-deficient, and the solve collapses to
  zero. `buildSolver` detects this and refuses with that explanation instead of
  returning a plausible-looking wrong surface. Vary elevation ~15° and recovered
  tilt lands exactly on truth.
- **Do not drop extreme samples to reject glints.** It costs two equations; with
  the ambient unknown that leaves no redundancy and recovery degrades from 1.000
  to 0.23. Highlights are handled by clamping sample values instead, which leaves
  the design matrix — and the precomputed inverse — intact.

Height for the shadow march and occlusion comes from a Poisson solve over the
measured gradients (Jacobi relaxation, ~48 sweeps, built once per capture). Only
features up to roughly the sweep count have converged, so the mean-removal blur
that follows is cut at that same reach and the unconverged remainder is
discarded rather than carried into the shading.

### 5. A capture with no spare shots cannot be checked, and reports a perfect fit

Photometric stereo is normally over-determined, so re-projecting the solved `g`
through each light direction and comparing against what was photographed gives a
per-pixel fit residual — the one diagnostic a real capture can have, since it
comes with no ground truth. It works:

| capture | mean residual | worst |
|---|---|---|
| clean, 6 shots | 0.16% | 4.1% |
| one frame displaced 3px | **3.39%** | 49.9% |
| one light angle wrong by 40° | **1.70%** | 46.3% |

But the residual only carries information when there are degrees of freedom left
over. Three shots solve for a normal; four solve for a normal plus ambient.
Either way **the system is then exactly determined, the model reproduces the data
perfectly by construction, and the residual is identically zero however wrong the
capture is.** The same 3px misalignment that reads 3.39% on six shots reads
exactly 0.00% on four.

That makes the museum four-shot convention a solve with no way to validate
itself. The bench now defaults to six exposures, reports `shots / unknowns /
spare` on every rebuild, and says **"fit unmeasurable"** rather than printing a
reassuring zero when nothing is spare.

### 6. Frame drift is correctable, and the thing that corrects it is colour

The per-pixel solve assumes every exposure sees the same pixel. Uploaded capture
sets were checked for matching dimensions and then trusted — a tripod held on
faith. It is now measured and corrected, scored against a drift that is exact by
construction: the painting is synthesised at 3x and each frame box-downsampled
from a different integer offset on that fine grid, so one texel upstairs is
exactly one third of a pixel downstairs with no interpolation anywhere in the
ground truth.

| case | | shift err | normals nx / ny | fit |
|---|---|---|---|---|
| clean | as shot | — | 0.9997 / 0.9997 | 0.17% |
| | registered | 0.003 | 0.9997 / 0.9997 | 0.17% |
| one frame 1.3px | as shot | — | 0.930 / 0.836 | 2.32% |
| | registered | 0.020 | **0.993 / 0.984** | **0.78%** |
| one frame 3px | as shot | — | 0.965 / 0.926 | 1.51% |
| | registered | 0.003 | **0.9997 / 0.9997** | **0.17%** |
| creep, 0-2px | as shot | — | 0.203 / 0.902 | 4.01% |
| | registered | 0.005 | **0.985 / 0.976** | **1.14%** |

Three things came out of building it that were not obvious going in.

**Gradient magnitude is not light-invariant enough.** The exposures are lit
differently by design, so the raw images disagree wherever there is relief. The
standard repair is to match on the gradient *magnitude* of log luminance, on the
grounds that a ridge is an edge under any light even though the sign of that edge
flips. Over the 15 frame pairs of a six-shot capture that gets 12 right and lands
3px out on the other three: |grad log L| is strongest *across* the light azimuth,
so two frames lit 120 degrees apart emphasise different edges and correlate
weakly and off-centre.

What is invariant is **chromaticity**. Under the Lambertian model the solve
already assumes, `I_c = albedo_c * (n·l + ambient)` — the shading is one scalar
multiplying all three channels, so `r / (r+g+b)` cancels it exactly. Not
approximately: the lamp divides out. Matching on the gradient of chromaticity
gets all 15 pairs right at r = 0.999, and ignores the canvas weave for free,
the weave being achromatic relief and so invisible to it.

The feature is the sum of both at a **fixed** gain, not normalised. That is what
makes it degrade correctly on a subject with no colour — a grisaille, a charcoal
drawing, an underexposed frame. Normalising each term to unit variance would hand
an achromatic frame's chroma *noise* the same authority as real structure;
at fixed gain the term is simply small. Measured on a desaturated copy of the
bench painting, every gain from 0 to 16 gives bit-identical output.

**A coarse pyramid level has to be built by downsampling the feature, not by
re-gradienting a downsampled photograph.** Both are one line and they behave
completely differently: the second lands 2-4px off zero on frames that never
moved. Take the gradient at quarter resolution and the pixel differences no
longer straddle a ridge flank, they straddle the whole brushstroke, whose broad
shading lobe leans toward whichever side the lamp is on and *moves when the lamp
moves*.

**What is left to improve is the resampler, not the measurement.** The harness
corrects a third time by the drift that was actually applied, which separates the
two: registered lands on that floor in every case, so the estimate is essentially
exact and the remaining shortfall is interpolation. That made the kernel worth
measuring rather than defaulting:

| kernel | normals nx / ny | fit |
|---|---|---|
| uncorrected | 0.203 / 0.902 | 4.01% |
| bilinear | 0.939 / 0.885 | 3.10% |
| Catmull-Rom | 0.964 / 0.932 | 1.78% |
| **Lanczos-3** | **0.985 / 0.976** | **1.13%** |

Bilinear recovers barely half of what is available — a half-pixel bilinear shift
is a low-pass filter whose knee sits inside the 2-7px band this whole engine works
in. Lanczos-3 rings slightly at hard edges; that is the trade taken.

Two consequences shape the implementation. Every pair is measured rather than
every frame against frame 0, and the per-frame positions come out of a weighted
least-squares fit over all of them — 15 measurements of 5 unknowns, so a pair that
cannot see its partner can be outvoted rather than carrying its frame off alone,
and the leftover disagreement is a confidence number that needs no ground truth.
And anchoring is on the **median** position, so in the usual case — one frame
knocked out of line while the rest held — the frames that held keep exact integer
offsets, and an exact integer offset is a copy rather than a filter. That is why
registering a clean set costs nothing measurable, which is the control row above.

The verdict in the UI is the fit residual before against after. If it does not
improve, the frames are put back and it says so: registration only corrects
translation, and a rotated frame or a wrong light angle will not be fixed by
shifting it.

### 7. A rig turned as a whole fits perfectly and returns the wrong surface

The solve takes light directions as **given**. On the synthetic path they are known;
on an uploaded capture they were typed in from memory of where the lamp was
standing. That was the last guessed input in the tool, and it turns out to hide the
worst-behaved error in it.

Rotate every light by the same angle — mistake which wall you called zero, or type
a nominal rig ("four at 90 degrees, 45 up") in at the wrong reference azimuth — and:

| rig error | each light off its own way | | whole rig turned together | |
|---|---|---|---|---|
| | normals nx / ny | fit | normals nx / ny | fit |
| 0° | 0.9997 / 0.9997 | 0.17% | 0.9997 / 0.9997 | 0.17% |
| 2° | 0.9994 / 0.9996 | 1.21% | 0.9992 / 0.9991 | **0.17%** |
| 10° | 0.9860 / 0.9903 | 6.29% | 0.9856 / 0.9834 | **0.17%** |
| 20° | 0.4673 / 0.7812 | 9.57% | 0.9437 / 0.9349 | **0.17%** |
| 40° | −0.3890 / 0.0833 | 10.43% | 0.7810 / 0.7498 | **0.17%** |

The right-hand fit column never moves. That is not a threshold to tune — it is
exact. Rotate every `L_k` by `R` and `g' = Rg` gives `g'·(R L_k) = g·L_k = I_k`, so
the model reproduces every photograph perfectly and hands back a surface rotated off
the painting. The relit result looks completely convincing, with its impasto
shadows falling at the wrong angle to the brushwork.

This is the third time this shape of thing has turned up here — a diagnostic reading
perfect precisely where it has nothing to say — after the exactly-determined fit
residual (finding 5) and the inversion test that passed hardest on the capture that
recovered nothing (finding 8). Nothing already in the tool can see it, because every
diagnostic here compares the lights against **each other**.

**A chrome sphere in frame breaks the symmetry**, by measuring each direction
against the room instead. It is exact geometry rather than a fit: a mirror reflects
the lamp into the eye only where the surface normal bisects them, so the highlight
sits at `N = normalise(L + V)`, and with `V = (0,0,1)` under orthographic projection
that inverts in one square root:

```
N = ((hx-cx)/r, (hy-cy)/r, sqrt(1 - nx² - ny²))
L = 2(N·V)N - V = (2·nz·nx, 2·nz·ny, 2·nz² - 1)
```

Measured against a rig whose angles are known, on a 200px-radius sphere: **worst
0.33°** across six exposures, azimuth exact, the residual being the centroid of an
asymmetric blob — a source of constant angular size maps to an image-space spot
that is wider on the side toward the middle of the sphere.

#### The circle is placed by hand, and that is not free

| sphere radius | centre 3px out | centre 8px out | radius 5% out |
|---|---|---|---|
| 40px | 9.63° | 25.00° | 2.90° |
| 80px | 5.07° | 12.79° | 2.99° |
| 160px | 2.71° | 6.63° | 2.98° |
| 300px | **1.60°** | 3.70° | 2.98° |

Three pixels of centre error on a small sphere costs as much as simply recalling
the angle. What rescues it is the scaling: the error depends on circle error
**relative to the radius**, so the requirement is a *big sphere* — one line in the
capture protocol — rather than a steady hand, which is not enforceable. Radius error
is scale-free, as it should be. The reading reports its own `sensitivity` in degrees
per pixel, so what a given placement is worth is on screen rather than assumed.

The obvious repair — snap the circle to the sphere's silhouette automatically — was
built and then removed. The bench cannot judge it: a silhouette detector tested
against a synthetic sphere is being tested against `synth.js`'s own model of what a
sphere looks like at its edge. And that model is not even favourable, since a mirror
near its silhouette reflects the room at grazing angles: on the bench's render the
luminance just inside the rim (~0.26) is indistinguishable from the painting just
outside it (0.23–0.40). There is no step there to find, and a fitter tuned until it
worked on that would be tuned to a fiction. The validatable route — optimising the
circle against the fit residual, the same objective that made registration checkable
— is in the queue instead.

#### Two things that must be caught rather than obeyed

A circle sitting on paint rather than on a sphere still finds a brightest spot and
still returns six confident directions. Two checks catch it, and both fire on the
bench:

- **The lamp moved between exposures, so readings that all agree are not readings
  of a mirror.** A circle placed on the painting returns six directions within 4.2°
  of each other — physically impossible for a six-azimuth rig.
- **The fit residual before against after.** The same objective the alignment uses:
  0.16% → 6.35% says plainly that those directions describe the photographs worse
  than the ones they replaced.

#### A sphere in frame also has to be kept out of the fit

A mirror is not Lambertian and never will be, so its pixels paint the loudest red in
the Fit view and drag the headline number with them: a clean capture reads **1.49%**
with the sphere left in and **0.16%** with its disc excluded. Left alone that is
enough to hide a real fault behind the diagnostic meant to reveal it. The disc is
excluded from the measurement and drawn flat grey in the view — visibly excluded,
rather than quietly dropped.

### 8. The proposed v1 acceptance test passes when the geometry is wrong

§8 #7 proposes: a raking light must produce brushstroke shadowing that inverts when
the light crosses to the other side. Run against the bench:

| source lighting | inversion test | actual recovery |
|---|---|---|
| raking | PASS (r = −0.80) | 0.74 |
| single | PASS (r = −0.87) | 0.45 |
| copy-stand | **PASS (r = −0.77)** | **0.00** |

Any normal field inverts when the light crosses, including one invented from
albedo noise. The test is necessary but not sufficient, and it passes most
convincingly in the case where nothing real was recovered.

**Proposed replacement:** keep the inversion test as a smoke test, and add the
ground-truth correlation (`tools/validate.mjs`) as the gate, with a threshold on
the along-azimuth component.

---

## What's in the bench

| Control group | Covers |
|---|---|
| Source | synthetic painting with known relief, or upload a photograph |
| Surface recovery | relief scale, source azimuth, integration length, strength, chroma reject, albedo de-lighting |
| Material | relief amount, depth, roughness, specular, cast shadow, occlusion, ambient, exposure |
| Lights | N lights, drag on canvas for X/Y, Distance for Z, Kelvin or custom colour, Power, Cone |
| View | relit / fit / normals / height / albedo / original |
| Photometric | N exposures, per-shot azimuth/elevation, ambient fit, highlight clamp, truth compare |
| Alignment | measure and correct inter-frame drift, per-frame shift readout, revert to as-shot |
| Chrome sphere | place a circle, read every exposure's light direction off it, per-shot sensitivity readout |
| Fit view | per-pixel residual between the model and the photographs, false-coloured, with a headline percentage |
| Export | format, scale, tiled full-resolution render with progress; honours whichever surface path is active |

Shading is Cook-Torrance GGX in linear light with height-correlated Smith
visibility, inverse-square falloff, real spot cones, a horizon-march cast shadow
against the height field, height-derived occlusion, and an ACES tonemap.

Colour temperature goes through the Planckian locus (Kim et al. cubic) → CIE xy →
XYZ → linear sRGB, luminance-normalised so temperature changes hue without also
changing exposure.

### The synthetic source

`src/synth.js` builds a canvas weave plus ~120 loaded brushstrokes with rounded
ridge profiles and bristle furrows, then renders it under a chosen lighting rig.
Pigment colour is deliberately **uncorrelated** with relief and chromatic by
construction — that is the adversary, since fine colour detail is exactly what a
naive high-pass converts into invented geometry.

Because the height field is known, recovery can be scored rather than admired.

---

## Capture protocol

For the photometric path, shooting for the solver rather than for the eye:

1. Fixed camera. A tripod, no reframing, no zoom change between exposures. The
   solve is per pixel and assumes every exposure sees the same pixel. **Align
   frames** measures what the tripod actually did and corrects it, but it only
   corrects translation — a bumped tripod that rotated is a re-shoot.
2. One light, moved. **Six exposures**, not four. Four is the museum convention
   and solves fine, but leaves nothing spare to check the answer with — see
   finding 5. The extra two exposures cost a minute and are what make the Fit
   view mean anything.
3. **Vary the light height** between exposures by ~15°. Constant elevation makes
   the ambient term unrecoverable.
5. Fixed exposure, white balance, and focus. Shoot raw or at least uncompressed;
   the solve is linear and JPEG at fine detail is not.
6. Kill the room light if you can. What you cannot kill, fit — see rule 3.

## Why the two paths rescale differently on export

Single-image recovery is parameterised in **pixels** of the working image, so its
features shrink as resolution rises. On export the blur, integration length and
slope gain are all rescaled by the resolution ratio, and shadow reach is tied to
the relief scale so the two stay in step.

The photometric path measures geometry directly, at its true physical scale
whatever the resolution, so none of that applies. There, shadow reach is a plain
fraction of image width, and only the Poisson height needs normalising — it is
integrated in texels, so it grows with resolution and is divided back down
against a reference width.

Getting this backwards is what makes a preview stop matching its export, so both
are computed in one place (`updateDerived`) rather than at each call site.

## Known limits

- Auto-estimating the source azimuth is unreliable when a regular canvas weave is
  present — the weave's own periodicity dominates the cue. Shipped as a dial with
  the estimate as a hint. A wrong azimuth degrades gracefully (relief resolves
  along the wrong axis) rather than producing garbage.
- Chroma reject helps only where pigment changes shift hue. Achromatic paint
  texture is indistinguishable from relief in a single image, by construction.
- The preview works at up to 1400px. Export goes back to the native source and
  renders in tiles, rescaling the pixel-domain surface settings so the export
  matches what the preview showed. Very large ratios between preview and export
  can push the blur past its 16px shader cap or the integration past 32 taps;
  when that happens the status line says so rather than silently differing.
- The synthetic source's canvas weave is coarse relative to the image, so it
  reads more strongly than a real linen would. Defaults are tuned around it and
  will want revisiting against real photographs.
- Uploaded capture sets are registered on demand, not automatically, and only for
  **translation**. Rotation, scale and lens breathing are not corrected. The fit
  residual will show them; nothing here will fix them — a 0.6-degree rotation on one
  frame of six reads 2.78% against a clean 0.16%, and correcting it by translation
  makes it 2.82%, so the attempt is detected and reverted rather than kept.
- Registration is measured at up to 1600px on the long edge and applied at full
  resolution, because building the feature costs ~0.4s/megapixel and six 12MP
  frames would otherwise spend half a minute before the first correlation. The
  cost of that cap is measured: at 1/2 scale, recovery 0.9994/0.9990 against
  0.9997/0.9996 at full; at 1/4, 0.9918/0.9860. Both still far ahead of the
  0.914/0.829 of leaving the drift in.
- Registering an achromatic subject falls back to luminance alone, where 2 of 15
  frame pairs go wrong. The fit still lands because the other 13 outvote them, and
  the discounted count is reported — but that is the weak case.
- Light directions come from a chrome sphere if one was shot, and by hand otherwise.
  The sphere's circle is placed by hand and there is no automatic silhouette fit —
  see finding 7 for why one was removed rather than shipped.
- A sphere reading assumes a neutral light and orthographic projection. A strongly
  coloured lamp or a very short lens will bias it; neither is measured here.
- Tiled photometric export is not bit-exact against an untiled render (mean
  0.026/765, max 21, no coherent seam). Jacobi propagates one texel per sweep, so
  only features up to ~N texels have converged after N sweeps and anything larger
  stays domain-dependent. The mean-removal blur is cut at exactly that reach
  (3·sigma = iterations) to discard the unconverged band, which brought the worst
  interior difference from 79 to 21. Driving it to zero needs a multigrid solve
  rather than more Jacobi sweeps.

## Status against the brief's phase skeleton

- **Phase 0 — Bench.** Done.
- **Phase 1 — Relief.** Done, with the algorithm corrected and the correction
  measured.
- **Phase 2 — Light rig.** Done: N lights, canvas handles, Power / Distance /
  Cone / Kelvin.
- **Phase 3 — Shadows & AO.** Done in the shader (horizon march + height-derived
  occlusion).
- **Phase 4 — Albedo recovery.** Partial: ratio-based base/detail split. Retinex
  not attempted.
- **Phase 5 — Host integration.** **Dropped.** The engine is a standalone tool,
  not a feature inside the wall-preview app, so there is nothing to integrate
  into. (For the record, had it gone ahead: the live stage there composites
  through a ≤1100px JPEG data URL under a CSS `matrix3d` transform, which would
  have destroyed exactly the fine detail this engine produces.)
- **Phase 6 — Export.** Done, for both surface paths. Tiled full-resolution
  render with an overlap margin; the single-image path matches a one-tile render
  to 3.4e-6 on the channel sum, and the photometric path reproduces its own
  preview **bit-identically** (mean |d| 0.000, max 0). A rig that cannot be
  solved blocks export with the reason rather than writing a wrong file. PNG or
  JPEG, with a scale control.
- **Phase 7 — Photometric stereo.** Done, and it is the strongest part of the
  tool: 0.9995 / 0.9994 against ground truth, versus 0.74 / −0.13 from one
  photograph. Supersedes Phase 4, since true albedo comes out of the same solve.
- **Phase 8 — Tier 3 depth model.** Not started, and unnecessary for the stated
  use case.
