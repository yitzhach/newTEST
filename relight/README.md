# Relight Bench — Phase 0/1

An isolated WebGL2 bench for the relighting engine described in `RELIGHT-BRIEF.md`.
No build step: serve this directory and open `index.html`.

```
python3 -m http.server 8080     # then open http://localhost:8080/relight/
node relight/tools/validate.mjs # ground-truth check on the surface maths
```

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

### 6. The proposed v1 acceptance test passes when the geometry is wrong

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
   solve is per pixel and assumes every exposure sees the same pixel.
2. One light, moved. **Six exposures**, not four. Four is the museum convention
   and solves fine, but leaves nothing spare to check the answer with — see
   finding 5. The extra two exposures cost a minute and are what make the Fit
   view mean anything.
3. **Vary the light height** between exposures by ~15°. Constant elevation makes
   the ambient term unrecoverable.
4. Fixed exposure, white balance, and focus. Shoot raw or at least uncompressed;
   the solve is linear and JPEG at fine detail is not.
5. Kill the room light if you can. What you cannot kill, fit — see rule 3.

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
- Uploaded capture sets are assumed pre-aligned; the tool checks that dimensions
  match but does not register the frames. A tripod is doing that work.
- Light directions for uploaded shots are entered by hand. Estimating them from a
  chrome sphere in frame is the standard trick and is not implemented.
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
