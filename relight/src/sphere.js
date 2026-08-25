// sphere.js — read a light's direction off a mirror sphere photographed in frame.
//
// The photometric solve takes the light directions as GIVEN. On the synthetic path
// they are known because the bench generated them; on an uploaded capture they were
// typed in by hand from memory of where the lamp was standing. That is the last
// input to this tool that is guessed rather than measured.
//
// And there is one error the rest of the tool is structurally blind to.
//
// Turn the whole rig by the same angle — mistake which wall you called zero, or
// type a nominal rig in at the wrong reference azimuth — and the Fit view reads
// **0.17% at every angle**, identical to a flawless capture, while the recovered
// surface rotates off the painting (normals 0.9997 -> 0.78 at 40 degrees). That is
// exact, not a tuning artefact: rotate every L_k by R and g' = Rg satisfies
// g'·(R L_k) = g·L_k = I_k, so the model reproduces the photographs perfectly and
// returns a rotated surface. The relit result then looks entirely convincing with
// its impasto shadows falling at the wrong angle to the brushwork.
//
// Errors that are *not* uniform do show up — each light off its own way by 10
// degrees reads 6.29% — but the uniform case is the one a remembered rig actually
// produces, and it is invisible. A sphere measures each direction against the room
// rather than against the other lights, which is the only thing that breaks the
// symmetry.
//
// A chrome sphere in the corner of the frame fixes it, and it is the standard trick
// precisely because the geometry is exact rather than fitted.
//
// ---------------------------------------------------------------------------
// The geometry
//
// Under orthographic projection the viewer direction is V = (0, 0, 1). A mirror
// reflects L into the eye only where the surface normal bisects them, so the
// highlight sits at the one point on the sphere whose normal is N = normalise(L + V).
// Read that point's position off the image and the relation inverts:
//
//     N  = ((hx - cx)/r, (hy - cy)/r, sqrt(1 - nx^2 - ny^2))
//     L  = 2 (N·V) N - V  =  (2 nz nx,  2 nz ny,  2 nz^2 - 1)
//
// No fitting, no model, no iteration — one square root and a reflection. Which is
// the whole appeal: everything else about a light angle is somebody's recollection.
//
// ---------------------------------------------------------------------------
// Where it stops being exact
//
// Two places, and both are reported rather than smoothed over.
//
// Near the silhouette nz goes to zero and the mapping from image position to
// direction becomes singular: one pixel of error in locating the highlight swings
// the recovered direction by an unbounded amount. `sensitivity` is that derivative,
// in degrees of light direction per pixel of highlight position, so a reading taken
// too close to the rim can be seen to be worthless instead of merely looking
// precise. It is also why lights are best kept off the extreme grazing angles the
// rim represents.
//
// And a chrome sphere reflects the whole room, not just the lamp. A window, a
// laptop screen, a white wall all appear on it. The brightest connected blob is
// taken as the lamp and the next brightest disconnected one is reported as `rival`:
// where that is close to the peak, the sphere is looking at two lights and the
// answer is a coin toss between them.

/** Reject a highlight this far out toward the rim; the geometry is too sensitive. */
export const RIM_LIMIT = 0.90;

const SRGB_TO_LINEAR = (() => {
  const t = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const v = i / 255;
    t[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }
  return t;
})();

/**
 * Light direction from a point on the sphere, both in the same right-handed frame
 * (x right, y up, z toward the viewer).
 *
 * @param nx,ny highlight position relative to the centre, in radii
 */
export function lightFromSpherePoint(nx, ny) {
  const rr = nx * nx + ny * ny;
  const nz = Math.sqrt(Math.max(0, 1 - rr));
  return [2 * nz * nx, 2 * nz * ny, 2 * nz * nz - 1];
}

/** The inverse, for generating test data and for drawing back onto the image. */
export function spherePointFromLight(L) {
  const m = Math.hypot(L[0], L[1], L[2]) || 1;
  // The normal that reflects L to the viewer is the half-vector with V = (0,0,1).
  const hx = L[0] / m, hy = L[1] / m, hz = L[2] / m + 1;
  const hm = Math.hypot(hx, hy, hz) || 1;
  return [hx / hm, hy / hm];
}

/**
 * How much the recovered direction moves for one pixel of error in locating the
 * highlight — degrees per pixel. Rises without bound at the rim.
 */
export function sensitivity(nx, ny, radiusPx) {
  const eps = 1e-3;
  const a = lightFromSpherePoint(nx, ny);
  const b = lightFromSpherePoint(nx + eps, ny);
  const c = lightFromSpherePoint(nx, ny + eps);
  const ang = (u, v) => {
    const d = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    return Math.acos(Math.max(-1, Math.min(1, d)));
  };
  // Per unit of normalised offset, converted to per pixel.
  const per = Math.max(ang(a, b), ang(a, c)) / eps;
  return (per / Math.max(radiusPx, 1)) * 180 / Math.PI;
}

// ---------------------------------------------------------------------------
// Why there is no automatic circle fitter here
//
// The circle is placed by hand, and hand-placing it is not free: measured on the
// bench with a 80px-radius sphere, a centre 3px out costs 5.07 degrees of light
// direction and 8px costs 12.79 — the same order as simply recalling where the
// lamp was standing. So the obvious next move is to snap the circle to the
// sphere's silhouette automatically.
//
// That was built, and then removed, for a reason worth recording so it is not
// rebuilt: **the bench cannot judge it.** A silhouette detector tested against a
// synthetic sphere is being tested against this file's own model of what a sphere
// looks like at its edge, which says nothing about a real one. And the model is
// not even favourable — a mirror sphere near its silhouette reflects the room at
// grazing angles, so its rim can be any brightness at all, and on the bench's own
// render the luminance just inside the rim (~0.26) is indistinguishable from the
// painting just outside it (0.23-0.40). There is no step there to find. A fitter
// tuned until it worked on that would be tuned to a fiction.
//
// What the bench CAN establish is the geometry, and the geometry is forgiving in
// the way that matters: the error depends on the circle error **relative to the
// radius**, not in pixels. See tools/validate.mjs — the same absolute misplacement
// costs four times less on a sphere twice as wide. So the requirement is not
// "place the circle precisely", which is unenforceable, but "shoot a big sphere",
// which is a sentence in the capture protocol. `sensitivity` reports degrees per
// pixel for the reading actually taken, so what a given placement is worth is on
// screen rather than assumed.
//
// The validatable way to make placement forgiving is to optimise the circle
// against the photometric fit residual — the same objective that made frame
// registration checkable. That is in the handoff's queue, not here.

/**
 * Locate the lamp's reflection inside the sphere's disc.
 *
 * Takes the brightest connected region above a fraction of the peak, and returns
 * its intensity-weighted centroid — which is sub-pixel, and is also the right
 * answer when the highlight is clipped, since the centroid of a saturated blob is
 * still its centre.
 *
 * @param sphere {cx, cy, r} in pixels, cy measured DOWN the image like the pixels
 * @returns {{ x, y, peak, rival, area }} x/y in image pixels, or null if the disc
 *   holds nothing bright enough to be a light.
 */
export function findHighlight(rgba, w, h, sphere, { threshold = 0.5, inset = 0.97 } = {}) {
  const { cx, cy, r } = sphere;
  const rIn = r * inset;
  const x0 = Math.max(0, Math.floor(cx - rIn)), x1 = Math.min(w, Math.ceil(cx + rIn));
  const y0 = Math.max(0, Math.floor(cy - rIn)), y1 = Math.min(h, Math.ceil(cy + rIn));
  if (x1 - x0 < 3 || y1 - y0 < 3) return null;

  const bw = x1 - x0, bh = y1 - y0;
  const lum = new Float32Array(bw * bh);
  let peak = 0, pi = -1;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const dx = x - cx, dy = y - cy;
      const i = (y - y0) * bw + (x - x0);
      if (dx * dx + dy * dy > rIn * rIn) { lum[i] = -1; continue; }
      const p = (y * w + x) * 4;
      const v = 0.2126 * SRGB_TO_LINEAR[rgba[p]]
              + 0.7152 * SRGB_TO_LINEAR[rgba[p + 1]]
              + 0.0722 * SRGB_TO_LINEAR[rgba[p + 2]];
      lum[i] = v;
      if (v > peak) { peak = v; pi = i; }
    }
  }
  if (pi < 0 || peak <= 0) return null;

  // Flood the connected region above the threshold, and take its weighted centroid.
  const cut = peak * threshold;
  const seen = new Uint8Array(bw * bh);
  const stack = [pi];
  seen[pi] = 1;
  let sx = 0, sy = 0, sw = 0, area = 0;
  while (stack.length) {
    const i = stack.pop();
    const x = i % bw, y = (i / bw) | 0;
    // Weight by how far above the threshold the pixel is, so the centroid follows
    // the lobe's peak rather than the arbitrary shape of the cut.
    const wgt = lum[i] - cut;
    sx += (x + x0) * wgt; sy += (y + y0) * wgt; sw += wgt; area++;
    const push = (nxi, nyi) => {
      if (nxi < 0 || nyi < 0 || nxi >= bw || nyi >= bh) return;
      const j = nyi * bw + nxi;
      if (seen[j] || lum[j] < cut) return;
      seen[j] = 1; stack.push(j);
    };
    push(x - 1, y); push(x + 1, y); push(x, y - 1); push(x, y + 1);
  }
  if (sw <= 0) return null;

  // The next brightest thing on the sphere that is NOT part of this blob. A room
  // light, a window, a monitor — the sphere shows all of them, and if one is nearly
  // as bright as the lamp then which is "the" light is not a decision this code
  // should be making silently.
  let rival = 0;
  for (let i = 0; i < lum.length; i++) if (!seen[i] && lum[i] > rival) rival = lum[i];

  return { x: sx / sw, y: sy / sw, peak, rival: peak > 0 ? rival / peak : 0, area };
}

/**
 * Recover one exposure's light direction from the sphere in it.
 *
 * @param sphere {cx, cy, r} in pixels, in image coordinates (y down)
 * @param flipY  image rows run down; the light frame's y runs up. True by default
 *   because that is the convention the rest of the tool uses — see shotDir() in
 *   app.js, where +y azimuth is up the image.
 * @returns {{ ok, dir, az, elev, sensitivity, rim, rival, highlight, reason }}
 */
export function estimateLight(rgba, w, h, sphere, opts = {}) {
  const { flipY = true, rimLimit = RIM_LIMIT } = opts;
  const hit = findHighlight(rgba, w, h, sphere, opts);
  if (!hit) {
    return { ok: false, reason: 'no highlight found inside the sphere — check the circle is on it.' };
  }
  const nx = (hit.x - sphere.cx) / sphere.r;
  const nyImg = (hit.y - sphere.cy) / sphere.r;
  const ny = flipY ? -nyImg : nyImg;
  const rim = Math.hypot(nx, ny);
  if (rim >= 1) {
    return { ok: false, reason: 'highlight fell outside the sphere — the circle is too small or off-centre.' };
  }
  const dir = lightFromSpherePoint(nx, ny);
  const az = (Math.atan2(dir[1], dir[0]) * 180 / Math.PI + 360) % 360;
  const elev = Math.asin(Math.max(-1, Math.min(1, dir[2]))) * 180 / Math.PI;
  return {
    ok: true,
    dir, az, elev,
    highlight: { x: hit.x, y: hit.y },
    rim,
    rival: hit.rival,
    area: hit.area,
    sensitivity: sensitivity(nx, ny, sphere.r),
    // Not a refusal. The number is returned and the reading is usable with care;
    // what is refused is presenting it as if it carried the same weight as one
    // taken near the middle of a big sphere. `sensitivity` carries both the radius
    // and how far out the highlight landed, so it is the single number that says
    // what this particular reading is worth: above ~1.5 deg/px, a few pixels of
    // hand-placement is already costing more than the reading gains.
    reliable: rim < rimLimit && hit.rival < 0.75 && elev > 0
      && sensitivity(nx, ny, sphere.r) < 1.5,
  };
}
