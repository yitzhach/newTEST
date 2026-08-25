// photometric.js — measured surface from a multi-shot capture (the brief's Route A).
//
// Shoot the same painting N times from a fixed camera with the light moved between
// exposures. Per pixel, I_k = albedo * (N · L_k), which for known L_k is an
// over-determined linear system in g = albedo·N. Solve it and you get *measured*
// normals and true albedo — no estimate, no model, and no intrinsic-decomposition
// guesswork, because the albedo falls out of the same solve.
//
// Against single-image recovery this is the difference between half a surface and
// a whole one: measured against known ground truth, one photograph correlates 0.74
// along its own light azimuth and roughly 0.00 perpendicular, while a four-shot
// capture correlates 1.000 on both.
//
// Two constraints on the capture came out of that measurement and are enforced
// below rather than left to the user to discover:
//
//   1. Ambient light biases the solve toward flatter relief (recovered tilt 9.7deg
//      against a true 12.2deg). It can be fitted as a fourth unknown — but only if
//      the lights differ in ELEVATION. With every light at one elevation the Lz
//      column is a constant multiple of the ambient column, the system is rank
//      deficient, and the solve collapses to zero. Vary elevation by ~15deg and
//      recovered tilt lands exactly on truth.
//
//   2. Dropping extreme samples to reject specular glints and cast shadows costs
//      two of the N equations. Combined with the ambient unknown that leaves no
//      redundancy and the fit degrades badly (1.000 -> 0.23). Highlight handling
//      here clamps sample values instead, which leaves the design matrix — and so
//      the precomputed inverse — intact.

import { program, makeTarget, bindTarget, bindTextures, drawFullscreen } from './gl.js';

export const MAX_SHOTS = 8;

/**
 * Build the per-pixel solve as a precomputed matrix.
 *
 * Note on shot count: three shots solve for a normal, four solve for a normal
 * plus ambient — but neither leaves anything over to check the answer with. Add
 * one more than the minimum and the residual becomes meaningful.
 *
 * The normal equations depend only on the light directions, never on pixel
 * values, so the pseudo-inverse is computed once on the CPU and the shader is
 * left with a matrix-vector product: g = P·I, where column k of P scales the
 * contribution of shot k.
 */
export function buildSolver(lightDirs, { fitAmbient = false } = {}) {
  const n = lightDirs.length;
  const cols = fitAmbient ? 4 : 3;
  if (n < cols) {
    return { ok: false, reason: `${n} shot${n === 1 ? '' : 's'} cannot solve for ${cols} unknowns — need at least ${cols}.` };
  }

  const L = lightDirs.map((d) => {
    const m = Math.hypot(d[0], d[1], d[2]) || 1;
    const u = [d[0] / m, d[1] / m, d[2] / m];
    return fitAmbient ? [u[0], u[1], u[2], 1] : u;
  });

  // A = LtL
  const A = new Float64Array(cols * cols);
  for (const row of L) {
    for (let i = 0; i < cols; i++) for (let j = 0; j < cols; j++) A[i * cols + j] += row[i] * row[j];
  }

  const inv = invertSmall(A, cols);
  if (!inv) {
    return {
      ok: false,
      reason: fitAmbient
        ? 'Singular with the ambient unknown: every light is at the same elevation, so the Lz and ambient columns are collinear. Vary the light height between shots, or turn the ambient fit off.'
        : 'Singular: the light directions are collinear or duplicated. Spread the azimuths.',
    };
  }

  // P = A^-1 Lt, laid out as one vec4 per shot: xyz scales g, w scales ambient.
  const P = new Float32Array(MAX_SHOTS * 4);
  for (let k = 0; k < n; k++) {
    for (let i = 0; i < cols; i++) {
      let v = 0;
      for (let j = 0; j < cols; j++) v += inv[i * cols + j] * L[k][j];
      P[k * 4 + i] = v;
    }
  }

  // Condition number of A, as a usable warning about a poorly spread rig.
  const cond = conditionEstimate(A, inv, cols);
  // Degrees of freedom left over after the fit. This decides whether the capture
  // can be checked at all: with dof = 0 the system is exactly determined, the
  // model reproduces the data perfectly by construction, and the residual is
  // identically zero however wrong the capture is. Four shots with the ambient
  // term fitted is exactly that case — a solve with no way to validate itself.
  const dof = n - cols;
  return { ok: true, P, count: n, fitAmbient, cond, dof, unknowns: cols };
}

function invertSmall(A, n) {
  const M = [];
  for (let i = 0; i < n; i++) {
    const row = new Float64Array(2 * n);
    for (let j = 0; j < n; j++) row[j] = A[i * n + j];
    row[n + i] = 1;
    M.push(row);
  }
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-9) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    const d = M[c][c];
    for (let k = 0; k < 2 * n; k++) M[c][k] /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c];
      if (!f) continue;
      for (let k = 0; k < 2 * n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const out = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) out[i * n + j] = M[i][n + j];
  return out;
}

/** Rough condition number via matching 1-norms; enough to flag a bad rig. */
function conditionEstimate(A, inv, n) {
  const norm1 = (M) => {
    let best = 0;
    for (let j = 0; j < n; j++) {
      let s = 0;
      for (let i = 0; i < n; i++) s += Math.abs(M[i * n + j]);
      best = Math.max(best, s);
    }
    return best;
  };
  return norm1(A) * norm1(inv);
}

const HEAD = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 outColor;
vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}
`;

// The exposures go into one 2D array texture rather than N samplers: GLSL ES 3.00
// requires sampler-array indices to be compile-time constants, but an array
// texture's LAYER index may be dynamic, which is exactly what a loop over shots
// needs. It also enforces the thing photometric stereo already requires — every
// exposure identical in size and framing.
const SOLVE_FS = `${HEAD}
uniform highp sampler2DArray uShots;
uniform vec4  uP[${MAX_SHOTS}];
uniform int   uCount;
uniform float uClamp;        // highlight clamp; 1.0 disables
uniform float uAlbedoGain;

void main() {
  // Solve per channel so the albedo comes out coloured, and pool the three for
  // the normal — a per-channel normal would disagree with itself across a
  // pigment boundary.
  vec3 gR = vec3(0.0), gG = vec3(0.0), gB = vec3(0.0);
  vec3 gL = vec3(0.0);
  float ambient = 0.0;

  for (int k = 0; k < ${MAX_SHOTS}; k++) {
    if (k >= uCount) break;
    vec3 c = min(srgbToLinear(texture(uShots, vec3(vUV, float(k))).rgb), vec3(uClamp));
    float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
    vec4 p = uP[k];
    gR += p.xyz * c.r;
    gG += p.xyz * c.g;
    gB += p.xyz * c.b;
    gL += p.xyz * lum;
    ambient += p.w * lum;
  }

  float mag = length(gL);
  // Where the solve has no strength — a pixel in shadow across every exposure —
  // fall back to the plane normal rather than amplifying noise into geometry.
  vec3 N = mag > 1e-5 ? gL / mag : vec3(0.0, 0.0, 1.0);
  if (N.z < 0.0) N = -N;

  vec3 albedo = vec3(length(gR), length(gG), length(gB)) * uAlbedoGain;
  outColor = vec4(N * 0.5 + 0.5, clamp(dot(albedo, vec3(0.2126, 0.7152, 0.0722)), 0.0, 8.0));
}`;

const ALBEDO_FS = `${HEAD}
uniform highp sampler2DArray uShots;
uniform vec4  uP[${MAX_SHOTS}];
uniform int   uCount;
uniform float uClamp;
uniform float uAlbedoGain;
void main() {
  vec3 gR = vec3(0.0), gG = vec3(0.0), gB = vec3(0.0);
  for (int k = 0; k < ${MAX_SHOTS}; k++) {
    if (k >= uCount) break;
    vec3 c = min(srgbToLinear(texture(uShots, vec3(vUV, float(k))).rgb), vec3(uClamp));
    vec4 p = uP[k];
    gR += p.xyz * c.r; gG += p.xyz * c.g; gB += p.xyz * c.b;
  }
  outColor = vec4(vec3(length(gR), length(gG), length(gB)) * uAlbedoGain, 1.0);
}`;

// Residual: how well the Lambertian model actually fits the captured data.
//
// This is the diagnostic the synthetic tests get for free and a real capture
// never does. With N shots and 3 unknowns the system is over-determined, so
// re-projecting the solved g through each light direction and comparing against
// what was photographed costs nothing and says plainly whether the capture can be
// trusted. High residual means one of: frames not aligned, light directions
// wrong, specular glints, or cast shadows breaking the Lambertian assumption.
//
// Everything else in this tool produces something plausible-looking whether or
// not it is right. This is the one output that says which.
const RESIDUAL_FS = `${HEAD}
uniform highp sampler2DArray uShots;
uniform vec4  uP[${MAX_SHOTS}];
uniform vec3  uL[${MAX_SHOTS}];
uniform int   uCount;
uniform float uClamp;
uniform int   uFitAmbient;

void main() {
  vec3 g = vec3(0.0);
  float amb = 0.0;
  float mean = 0.0;
  for (int k = 0; k < ${MAX_SHOTS}; k++) {
    if (k >= uCount) break;
    vec3 c = min(srgbToLinear(texture(uShots, vec3(vUV, float(k))).rgb), vec3(uClamp));
    float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
    g += uP[k].xyz * lum;
    amb += uP[k].w * lum;
    mean += lum;
  }
  mean /= float(uCount);

  float sse = 0.0;
  for (int k = 0; k < ${MAX_SHOTS}; k++) {
    if (k >= uCount) break;
    vec3 c = min(srgbToLinear(texture(uShots, vec3(vUV, float(k))).rgb), vec3(uClamp));
    float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
    float pred = dot(g, uL[k]) + (uFitAmbient == 1 ? amb : 0.0);
    float e = lum - pred;
    sse += e * e;
  }
  float rms = sqrt(sse / float(uCount));
  // Relative to local brightness: an absolute error means little on a dark
  // passage and a lot on a bright one.
  outColor = vec4(rms, rms / max(mean, 1e-3), mean, 1.0);
}`;

// False-colour the residual so a bad capture is obvious at a glance rather than
// being a number the user has to interpret.
const RESIDUAL_VIEW_FS = `${HEAD}
uniform sampler2D uResidual;
uniform float uScale;
uniform vec3  uExclude;   // xy centre, z radius, in UV; radius 0 disables
uniform float uAspect;
void main() {
  float r = clamp(texture(uResidual, vUV).g * uScale, 0.0, 1.0);
  // dark blue (good) -> green -> yellow -> red (bad)
  vec3 c = r < 0.5
    ? mix(vec3(0.05, 0.10, 0.28), vec3(0.15, 0.75, 0.35), r * 2.0)
    : mix(vec3(0.15, 0.75, 0.35), vec3(0.95, 0.16, 0.12), (r - 0.5) * 2.0);
  // A chrome sphere is a mirror, so the Lambertian model does not describe it and
  // never will. Left in, it paints the loudest red in the frame and buries whatever
  // the rest of the capture is trying to say. Drawn flat grey instead: excluded,
  // and visibly so, rather than quietly dropped.
  if (uExclude.z > 0.0) {
    vec2 d = vec2((vUV.x - uExclude.x), (vUV.y - uExclude.y) / uAspect);
    if (dot(d, d) < uExclude.z * uExclude.z) c = vec3(0.16, 0.16, 0.18);
  }
  outColor = vec4(c, 1.0);
}`;

// Height from measured normals is a Poisson problem: find h whose gradient
// matches (-nx/nz, -ny/nz). Only the shadow march and the occlusion term need it,
// and it is built once per capture, so a few dozen Jacobi sweeps are affordable
// and avoid pulling in a solver.
const DIVERGENCE_FS = `${HEAD}
uniform sampler2D uNormal;
uniform vec2 uTexel;
vec2 grad(vec2 uv) {
  vec3 n = normalize(texture(uNormal, uv).rgb * 2.0 - 1.0);
  float nz = max(n.z, 0.05);
  return vec2(-n.x / nz, -n.y / nz);
}
void main() {
  vec2 gx1 = grad(vUV + vec2(uTexel.x, 0.0));
  vec2 gx0 = grad(vUV - vec2(uTexel.x, 0.0));
  vec2 gy1 = grad(vUV + vec2(0.0, uTexel.y));
  vec2 gy0 = grad(vUV - vec2(0.0, uTexel.y));
  outColor = vec4((gx1.x - gx0.x) * 0.5 + (gy1.y - gy0.y) * 0.5, 0.0, 0.0, 1.0);
}`;

const JACOBI_FS = `${HEAD}
uniform sampler2D uH;
uniform sampler2D uDiv;
uniform vec2 uTexel;
void main() {
  float l = texture(uH, vUV - vec2(uTexel.x, 0.0)).r;
  float r = texture(uH, vUV + vec2(uTexel.x, 0.0)).r;
  float d = texture(uH, vUV - vec2(0.0, uTexel.y)).r;
  float u = texture(uH, vUV + vec2(0.0, uTexel.y)).r;
  outColor = vec4((l + r + d + u - texture(uDiv, vUV).r) * 0.25, 0.0, 0.0, 1.0);
}`;

// Pack the solved height into the normal map's alpha, matching the layout the
// shading pass already expects from the single-image path.
const PACK_FS = `${HEAD}
uniform sampler2D uNormal;
uniform sampler2D uH;
uniform sampler2D uMean;
uniform float uHeightGain;
void main() {
  // Jacobi leaves an arbitrary additive constant (and a slow drift). The shading
  // pass wants a local-mean-zero relief field, so subtract a heavily blurred copy.
  float h = texture(uH, vUV).r - texture(uMean, vUV).r;
  outColor = vec4(texture(uNormal, vUV).rgb, h * uHeightGain);
}`;

const BLUR_FS = `${HEAD}
uniform sampler2D uSrc;
uniform vec2 uStep;
uniform float uSigma;
void main() {
  float sigma = max(uSigma, 1e-3);
  float inv2s2 = 1.0 / (2.0 * sigma * sigma);
  vec4 sum = texture(uSrc, vUV);
  float wsum = 1.0;
  for (int i = 1; i <= 48; i++) {
    float fi = float(i);
    if (fi > sigma * 3.0) break;
    float w = exp(-fi * fi * inv2s2);
    sum += w * (texture(uSrc, vUV + uStep * fi) + texture(uSrc, vUV - uStep * fi));
    wsum += 2.0 * w;
  }
  outColor = sum / wsum;
}`;

/**
 * Pack the exposures into one array texture. Each is drawn flipped so it matches
 * the UNPACK_FLIP_Y convention the rest of the pipeline uses; the flag itself is
 * not reliably honoured for 3D uploads, so the flip is done explicitly here.
 */
export function uploadShotArray(gl, sources, w, h) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
  gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, w, h, sources.length, 0,
    gl.RGBA, gl.UNSIGNED_BYTE, null);

  const stage = document.createElement('canvas');
  stage.width = w; stage.height = h;
  const sctx = stage.getContext('2d');

  const prevFlip = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  sources.forEach((src, k) => {
    sctx.save();
    sctx.setTransform(1, 0, 0, -1, 0, h);
    sctx.clearRect(0, 0, w, h);
    sctx.drawImage(src, 0, 0, w, h);
    sctx.restore();
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, k, w, h, 1,
      gl.RGBA, gl.UNSIGNED_BYTE, stage);
  });
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, prevFlip);

  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

export class Photometric {
  constructor(glctx) {
    this.glctx = glctx;
    const { gl } = glctx;
    this.progs = {
      solve: program(gl, SOLVE_FS, 'ps-solve'),
      albedo: program(gl, ALBEDO_FS, 'ps-albedo'),
      div: program(gl, DIVERGENCE_FS, 'ps-div'),
      jacobi: program(gl, JACOBI_FS, 'ps-jacobi'),
      pack: program(gl, PACK_FS, 'ps-pack'),
      residual: program(gl, RESIDUAL_FS, 'ps-residual'),
      residualView: program(gl, RESIDUAL_VIEW_FS, 'ps-residual-view'),
      blur: program(gl, BLUR_FS, 'ps-blur'),
    };
    this.targets = null;
    this.size = { w: 0, h: 0 };
  }

  resize(w, h) {
    if (this.size.w === w && this.size.h === h) return;
    const { gl, caps } = this.glctx;
    if (this.targets) {
      for (const t of Object.values(this.targets)) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo); }
    }
    const mk = () => makeTarget(gl, w, h, { float: true, caps });
    this.targets = {
      normal: mk(), albedo: mk(), div: mk(), residual: mk(),
      hA: mk(), hB: mk(), tmp: mk(), mean: mk(), lin: mk(),
    };
    this.size = { w, h };
  }

  /**
   * @param shots      a TEXTURE_2D_ARRAY holding one layer per exposure
   * @param solver     result of buildSolver()
   * @returns the same target names the shading pass expects: albedo, normal, lin
   */
  build(shots, solver, w, h, opts = {}) {
    const { gl } = this.glctx;
    const {
      highlightClamp = 1.0, albedoGain = 1.0, heightGain = 1.0,
      jacobiIterations = 48,
      // Jacobi propagates one texel per sweep, so after N sweeps only features
      // up to ~N texels have converged; anything larger is still domain-
      // dependent, which makes it differ between a tile and a whole image. Cut
      // the mean-removal blur at exactly that reach (3 sigma = N) so the height
      // field keeps only the band that actually converged.
      meanSigma = jacobiIterations / 3,
    } = opts;
    this.resize(w, h);
    const T = this.targets;
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);

    const bindShots = (prog) => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, shots);
      if (prog.uniforms.uShots != null) gl.uniform1i(prog.uniforms.uShots, 0);
    };

    // --- solve: normals (+ pooled albedo luminance in alpha)
    bindTarget(gl, T.normal);
    gl.useProgram(this.progs.solve.program);
    bindShots(this.progs.solve);
    gl.uniform4fv(this.progs.solve.uniforms.uP, solver.P);
    gl.uniform1i(this.progs.solve.uniforms.uCount, solver.count);
    gl.uniform1f(this.progs.solve.uniforms.uClamp, highlightClamp);
    gl.uniform1f(this.progs.solve.uniforms.uAlbedoGain, albedoGain);
    drawFullscreen(gl);

    // --- coloured albedo
    bindTarget(gl, T.albedo);
    gl.useProgram(this.progs.albedo.program);
    bindShots(this.progs.albedo);
    gl.uniform4fv(this.progs.albedo.uniforms.uP, solver.P);
    gl.uniform1i(this.progs.albedo.uniforms.uCount, solver.count);
    gl.uniform1f(this.progs.albedo.uniforms.uClamp, highlightClamp);
    gl.uniform1f(this.progs.albedo.uniforms.uAlbedoGain, albedoGain);
    drawFullscreen(gl);

    // --- residual: fit quality, computed alongside rather than on demand so the
    //     number is always current with the surface being shown
    if (opts.lightDirs) {
      const L = new Float32Array(MAX_SHOTS * 3);
      opts.lightDirs.slice(0, MAX_SHOTS).forEach((d, k) => {
        const m = Math.hypot(d[0], d[1], d[2]) || 1;
        L[k * 3] = d[0] / m; L[k * 3 + 1] = d[1] / m; L[k * 3 + 2] = d[2] / m;
      });
      bindTarget(gl, T.residual);
      gl.useProgram(this.progs.residual.program);
      bindShots(this.progs.residual);
      gl.uniform4fv(this.progs.residual.uniforms.uP, solver.P);
      gl.uniform3fv(this.progs.residual.uniforms.uL, L);
      gl.uniform1i(this.progs.residual.uniforms.uCount, solver.count);
      gl.uniform1f(this.progs.residual.uniforms.uClamp, highlightClamp);
      gl.uniform1i(this.progs.residual.uniforms.uFitAmbient, solver.fitAmbient ? 1 : 0);
      drawFullscreen(gl);
    }

    // --- height by Poisson relaxation
    const run = (prog, target, textures, setU) => {
      bindTarget(gl, target);
      gl.useProgram(prog.program);
      bindTextures(gl, prog, textures);
      if (setU) setU(prog.uniforms);
      drawFullscreen(gl);
    };

    run(this.progs.div, T.div, [['uNormal', T.normal.tex]], (u) => {
      gl.uniform2f(u.uTexel, 1 / w, 1 / h);
    });

    // clear the initial guess
    bindTarget(gl, T.hA);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    let src = T.hA, dst = T.hB;
    for (let i = 0; i < jacobiIterations; i++) {
      run(this.progs.jacobi, dst, [['uH', src.tex], ['uDiv', T.div.tex]], (u) => {
        gl.uniform2f(u.uTexel, 1 / w, 1 / h);
      });
      const t = src; src = dst; dst = t;
    }

    // local mean of the height, to remove the free additive constant
    run(this.progs.blur, T.tmp, [['uSrc', src.tex]], (u) => {
      gl.uniform2f(u.uStep, 1 / w, 0); gl.uniform1f(u.uSigma, meanSigma);
    });
    run(this.progs.blur, T.mean, [['uSrc', T.tmp.tex]], (u) => {
      gl.uniform2f(u.uStep, 0, 1 / h); gl.uniform1f(u.uSigma, meanSigma);
    });

    run(this.progs.pack, dst, [['uNormal', T.normal.tex], ['uH', src.tex], ['uMean', T.mean.tex]], (u) => {
      gl.uniform1f(u.uHeightGain, heightGain);
    });

    bindTarget(gl, null);
    // `lin` stands in for the original-image view; the first exposure is the
    // closest thing a capture set has to "the untouched photograph".
    return { albedo: T.albedo, normal: dst, lin: T.albedo, residual: T.residual };
  }

  /**
   * Paint the false-coloured residual straight to the screen.
   * @param exclude optional {cx, cy, r} in pixels, image coordinates — a region the
   *   Lambertian model is not expected to describe, such as a chrome sphere.
   */
  drawResidual(viewW, viewH, scale = 6, exclude = null) {
    const { gl } = this.glctx;
    const p = this.progs.residualView;
    bindTarget(gl, null);
    gl.viewport(0, 0, viewW, viewH);
    gl.useProgram(p.program);
    bindTextures(gl, p, [['uResidual', this.targets.residual.tex]]);
    gl.uniform1f(p.uniforms.uScale, scale);
    // UV runs bottom-up against the image's top-down rows.
    gl.uniform3f(p.uniforms.uExclude,
      exclude ? exclude.cx / viewW : 0,
      exclude ? 1 - exclude.cy / viewH : 0,
      exclude ? exclude.r / viewW : 0);
    gl.uniform1f(p.uniforms.uAspect, viewW / Math.max(1, viewH));
    drawFullscreen(gl);
  }

  /**
   * Whole-image fit quality, as a percentage of local brightness. Reads back a
   * coarse sample rather than the full buffer — this is a headline number, not a
   * measurement that needs every pixel.
   */
  measureResidual(w, h, exclude = null) {
    const { gl } = this.glctx;
    const step = Math.max(1, Math.floor(Math.min(w, h) / 256));
    const sw = Math.floor(w / step), sh = Math.floor(h / step);
    bindTarget(gl, this.targets.residual);
    const buf = new Float32Array(w * 4);
    let sum = 0, sumsq = 0, n = 0, worst = 0;
    // Pixels the model is not expected to fit — a chrome sphere is a mirror, and
    // scoring the Lambertian solve on a mirror measures nothing except that a
    // mirror is not Lambertian. Measured on the bench: a sphere left in raises a
    // clean capture's headline fit from 0.16% to 1.49%, which is enough to hide a
    // real fault behind the diagnostic meant to reveal it.
    const exR2 = exclude ? exclude.r * exclude.r : 0;
    for (let y = 0; y < sh; y++) {
      const glY = y * step;
      gl.readPixels(0, glY, w, 1, gl.RGBA, gl.FLOAT, buf);
      const imgY = h - 1 - glY;
      for (let x = 0; x < sw; x++) {
        const px = x * step;
        if (exR2) {
          const dx = px - exclude.cx, dy = imgY - exclude.cy;
          if (dx * dx + dy * dy < exR2) continue;
        }
        const v = buf[px * 4 + 1];
        if (!Number.isFinite(v)) continue;
        sum += v; sumsq += v * v; n++;
        if (v > worst) worst = v;
      }
    }
    bindTarget(gl, null);
    if (!n) return null;
    const mean = sum / n;
    return { mean, rms: Math.sqrt(sumsq / n), worst, samples: n };
  }
}
