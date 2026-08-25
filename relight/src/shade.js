// shade.js — the per-frame pass. Everything above it is precomputed once per
// image; this runs on every slider tick, so it has to stay cheap.
//
// Physically-based rather than "a gradient that looks lit": Cook-Torrance GGX in
// linear light, inverse-square falloff, real spot cones, and a horizon-march
// against the height field so raised paint shadows the paint beside it. That last
// term is the one the depth-map competitors structurally cannot do.

import { program, bindTextures, drawFullscreen, bindTarget } from './gl.js';

export const MAX_LIGHTS = 8;

const SHADE_FS = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 outColor;

uniform sampler2D uAlbedo;
uniform sampler2D uNormal;   // rgb = normal, a = height
uniform sampler2D uLin;      // original linear colour, for the before/after view

uniform int   uLightCount;
uniform vec3  uLightPos[${MAX_LIGHTS}];
uniform vec3  uLightColor[${MAX_LIGHTS}];
uniform float uLightPower[${MAX_LIGHTS}];
uniform float uLightCone[${MAX_LIGHTS}];     // 0 = flood, 1 = tight spot
uniform float uLightEnabled[${MAX_LIGHTS}];

uniform float uAspect;
uniform vec2  uUVOffset;   // where this tile sits in the full image
uniform vec2  uUVScale;    // how much of the full image this tile covers
uniform float uShadowDist; // march length, in whole-image UV units
uniform float uAmbient;
uniform vec3  uAmbientColor;
uniform float uRoughness;
uniform float uSpecular;
uniform float uReliefAmount;
uniform float uHeightScale;
uniform float uShadow;
uniform float uAO;
uniform float uExposure;
uniform int   uViewMode;     // 0 relit, 1 normals, 2 height, 3 albedo, 4 original

const float PI = 3.14159265359;
const int SHADOW_STEPS = 24;

float D_GGX(float NoH, float a) {
  float a2 = a * a;
  float d = NoH * NoH * (a2 - 1.0) + 1.0;
  return a2 / max(PI * d * d, 1e-7);
}

// Height-correlated Smith visibility (Heitz). Pairs with D_GGX above; using the
// uncorrelated form here is the usual source of specular that looks too bright
// at grazing angles, which on a varnished painting is exactly where you look.
float V_SmithGGX(float NoV, float NoL, float a) {
  float a2 = a * a;
  float gv = NoL * sqrt(NoV * NoV * (1.0 - a2) + a2);
  float gl = NoV * sqrt(NoL * NoL * (1.0 - a2) + a2);
  return 0.5 / max(gv + gl, 1e-7);
}

vec3 F_Schlick(float u, vec3 f0) {
  float f = pow(1.0 - u, 5.0);
  return f0 + (1.0 - f0) * f;
}

float sampleHeight(vec2 uv) {
  return texture(uNormal, uv).a * uHeightScale;
}

/**
 * Horizon march: step along the light's planar direction and find the steepest
 * blocker. Smoother than a binary occlusion test and it costs the same.
 */
float shadowMarch(vec2 uv, vec3 L) {
  vec2 dxy = L.xy;
  float lxy = length(dxy);
  if (lxy < 1e-4) return 1.0;              // light overhead: nothing to cast
  vec2 dir = dxy / lxy;
  float slope = L.z / lxy;                 // world height gained per unit travelled
  float h0 = sampleHeight(uv);
  float maxDist = uShadowDist;
  float occ = 0.0;
  for (int i = 1; i <= SHADOW_STEPS; i++) {
    float t = (float(i) / float(SHADOW_STEPS)) * maxDist;
    vec2 suv = uv + (dir * t / vec2(1.0, uAspect)) / uUVScale;
    if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) break;
    float rise = sampleHeight(suv) - h0;
    occ = max(occ, rise / t - slope);
  }
  return 1.0 - clamp(occ * 40.0, 0.0, 1.0) * uShadow;
}

vec3 acesFilm(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

vec3 linearToSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(max(c, 1e-5), vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}

void main() {
  vec4 nh = texture(uNormal, vUV);
  vec3 reliefN = normalize(nh.rgb * 2.0 - 1.0);
  float height = nh.a;

  if (uViewMode == 1) { outColor = vec4(reliefN * 0.5 + 0.5, 1.0); return; }
  if (uViewMode == 2) { float v = height * 8.0 + 0.5; outColor = vec4(vec3(v), 1.0); return; }
  if (uViewMode == 3) { outColor = vec4(linearToSrgb(texture(uAlbedo, vUV).rgb), 1.0); return; }
  if (uViewMode == 4) { outColor = vec4(linearToSrgb(texture(uLin, vUV).rgb), 1.0); return; }

  vec3 albedo = texture(uAlbedo, vUV).rgb;

  // The artwork is a plane. Its own normal is (0,0,1) and blending toward the
  // relief normal by uReliefAmount is what makes the relief slider a real dial
  // between "flat print" and "heavy impasto".
  vec3 N = normalize(mix(vec3(0.0, 0.0, 1.0), reliefN, uReliefAmount));

  // Position in whole-image space, so a light stays put as tiles change.
  vec2 gUV = uUVOffset + vUV * uUVScale;
  vec3 P = vec3(gUV.x, gUV.y * uAspect, 0.0);
  vec3 V = normalize(vec3(0.5, 0.5 * uAspect, 1.6) - P);
  float NoV = max(dot(N, V), 1e-4);

  float rough = clamp(uRoughness, 0.03, 1.0);
  float a = rough * rough;
  vec3 f0 = vec3(0.04 * uSpecular);

  vec3 acc = vec3(0.0);
  for (int i = 0; i < ${MAX_LIGHTS}; i++) {
    if (i >= uLightCount) break;
    if (uLightEnabled[i] < 0.5) continue;

    vec3 lp = uLightPos[i];
    vec3 Lv = vec3(lp.x, lp.y * uAspect, lp.z) - P;
    float dist = max(length(Lv), 1e-4);
    vec3 L = Lv / dist;
    float NoL = dot(N, L);
    if (NoL <= 0.0) continue;

    // Inverse square, referenced to a half-width distance so that the Distance
    // slider lands on sane values instead of needing a power of ten of Power.
    float atten = 0.25 / (dist * dist);

    // Cone: L.z is the cosine of the angle off the plane normal, so the spot
    // test falls out without needing a separate aim vector while the light
    // points straight at the surface.
    float cone = clamp(uLightCone[i], 0.0, 1.0);
    float cosOuter = mix(0.02, 0.985, cone);
    float cosInner = mix(0.0, 0.999, cone * 0.92);
    float spot = smoothstep(cosOuter, max(cosInner, cosOuter + 1e-3), L.z);
    if (spot <= 0.0) continue;

    float shadow = shadowMarch(vUV, L);

    vec3 H = normalize(L + V);
    float NoH = max(dot(N, H), 0.0);
    float VoH = max(dot(V, H), 0.0);

    float D = D_GGX(NoH, a);
    float Vis = V_SmithGGX(NoV, NoL, a);
    vec3 F = F_Schlick(VoH, f0);

    vec3 spec = D * Vis * F;
    vec3 diff = albedo * (1.0 - F) / PI;

    acc += (diff + spec) * uLightColor[i] * uLightPower[i] * NoL * atten * spot * shadow;
  }

  // Ambient occlusion straight off the height field: the high-pass is already a
  // local-mean-zero signal, so a negative height *is* a pit and pits catch less
  // of the sky term.
  float ao = 1.0 - uAO * clamp(-height * 6.0, 0.0, 1.0);
  acc += albedo * uAmbientColor * uAmbient * ao;

  acc *= exp2(uExposure);
  outColor = vec4(linearToSrgb(acesFilm(acc)), 1.0);
}`;

export class Shader {
  constructor(glctx) {
    this.glctx = glctx;
    this.prog = program(glctx.gl, SHADE_FS, 'shade');
  }

  /**
   * @param tile  {ox,oy,sx,sy} placing this draw within the full image in UV
   *              terms. Defaults to the whole image.
   */
  draw(targets, state, aspect, viewW, viewH, tile) {
    const { gl } = this.glctx;
    const p = this.prog;
    if (!state.exporting) bindTarget(gl, null);
    gl.viewport(0, 0, viewW, viewH);
    gl.useProgram(p.program);
    bindTextures(gl, p, [
      ['uAlbedo', targets.albedo.tex],
      ['uNormal', targets.normal.tex],
      ['uLin', targets.lin.tex],
    ]);

    const lights = state.lights.slice(0, MAX_LIGHTS);
    const pos = new Float32Array(MAX_LIGHTS * 3);
    const col = new Float32Array(MAX_LIGHTS * 3);
    const pow = new Float32Array(MAX_LIGHTS);
    const cone = new Float32Array(MAX_LIGHTS);
    const on = new Float32Array(MAX_LIGHTS);
    lights.forEach((l, i) => {
      pos[i * 3] = l.x; pos[i * 3 + 1] = l.y; pos[i * 3 + 2] = l.z;
      col[i * 3] = l.rgb[0]; col[i * 3 + 1] = l.rgb[1]; col[i * 3 + 2] = l.rgb[2];
      pow[i] = l.power;
      cone[i] = l.cone;
      on[i] = l.enabled ? 1 : 0;
    });

    const u = p.uniforms;
    gl.uniform1i(u.uLightCount, lights.length);
    gl.uniform3fv(u.uLightPos, pos);
    gl.uniform3fv(u.uLightColor, col);
    gl.uniform1fv(u.uLightPower, pow);
    gl.uniform1fv(u.uLightCone, cone);
    gl.uniform1fv(u.uLightEnabled, on);
    gl.uniform1f(u.uAspect, aspect);
    const t = tile || { ox: 0, oy: 0, sx: 1, sy: 1 };
    gl.uniform2f(u.uUVOffset, t.ox, t.oy);
    gl.uniform2f(u.uUVScale, t.sx, t.sy);
    // Shadow length follows the relief scale, not the image size. A fixed
    // fraction of image width would make shadows grow with resolution, so the
    // preview and the full-res export would not match.
    gl.uniform1f(u.uShadowDist, state.shadowDist);
    gl.uniform1f(u.uAmbient, state.ambient);
    gl.uniform3fv(u.uAmbientColor, new Float32Array(state.ambientColor));
    gl.uniform1f(u.uRoughness, state.roughness);
    gl.uniform1f(u.uSpecular, state.specular);
    gl.uniform1f(u.uReliefAmount, state.reliefAmount);
    gl.uniform1f(u.uHeightScale, state.heightScale);
    gl.uniform1f(u.uShadow, state.shadow);
    gl.uniform1f(u.uAO, state.ao);
    gl.uniform1f(u.uExposure, state.exposure);
    gl.uniform1i(u.uViewMode, state.viewMode);

    drawFullscreen(gl);
  }
}
