// gbuffer.js — derive surface data from a single flat-lit photograph.
//
// CORRECTED PIPELINE. The obvious formulation — high-pass the luminance, treat the
// result as a height field, differentiate it to get normals — does not work, and
// it is worth being precise about why, because it looks right.
//
// Under a light with azimuth â, Lambertian shading of a height field h is
//
//     I  ≈  N·L  ≈  Lz − (∂h/∂x·Lx + ∂h/∂y·Ly)   =  Lz − |Lxy|·(∂h/∂â)
//
// so the high-passed luminance is proportional to a *derivative* of the surface,
// not to the surface. Treating it as height and differentiating again yields the
// second derivative, which correlates with the true normals at r ≈ 0.0 — measured,
// not assumed (see tools/validate.mjs). The recovered field traces the brushwork
// convincingly enough to fool the eye, which is exactly what makes the error
// dangerous: it produces plausible relief that is not the relief that is there.
//
// The fix is to integrate rather than differentiate. Walking back along â and
// accumulating −s reconstructs a height field whose gradient does correlate with
// truth (r ≈ 0.74 along the azimuth under a raking source).
//
// Two consequences fall out of the same algebra and both are load-bearing:
//
//   1. Only the slope component ALONG â is recoverable. The perpendicular
//      component is unconstrained — the shape-from-shading ambiguity, appearing
//      at relief scale rather than at form scale. One photograph buys half the
//      surface. A second shot with the light moved buys the other half, which is
//      the real argument for the photometric-stereo path.
//
//   2. A properly executed archival copy shot — two matched lights at equal and
//      opposite angles — cancels the first-order term almost exactly. That
//      geometry exists precisely to suppress texture. Measured recovery on such
//      a source is r ≈ 0.00: the better the repro photography, the less relief
//      survives to be found.
//
// The remaining caveat is unchanged: high-frequency luminance is also produced by
// paint colour changing, which is albedo, not geometry. Relief shading is
// achromatic because it scales every channel together, whereas a pigment change
// usually shifts hue — so where hue moves at fine scale, the chroma-reject term
// below down-weights the contribution.

import { program, makeTarget, bindTarget, bindTextures, drawFullscreen } from './gl.js';

const HEAD = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 outColor;
`;

// sRGB -> linear. All surface maths must happen in linear light or the gradients
// are wrong by the transfer curve, which shows up as relief that reads too hard
// in the shadows and too soft in the highlights.
const SRGB = `
vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}
float luma(vec3 lin) { return dot(lin, vec3(0.2126, 0.7152, 0.0722)); }
`;

const LUMA_FS = `${HEAD}${SRGB}
uniform sampler2D uSrc;
void main() {
  vec3 lin = srgbToLinear(texture(uSrc, vUV).rgb);
  outColor = vec4(lin, luma(lin));
}`;

// Separable Gaussian. The radius is a uniform rather than a compile-time constant
// so the relief-scale control is live; taps beyond the radius get zero weight.
const MAX_TAPS = 48;
const BLUR_FS = `${HEAD}
uniform sampler2D uSrc;
uniform vec2 uStep;      // texel-sized step along the blur axis
uniform float uSigma;
void main() {
  float sigma = max(uSigma, 1e-3);
  float inv2s2 = 1.0 / (2.0 * sigma * sigma);
  vec4 sum = texture(uSrc, vUV);
  float wsum = 1.0;
  for (int i = 1; i <= ${MAX_TAPS}; i++) {
    float fi = float(i);
    if (fi > sigma * 3.0) break;
    float w = exp(-fi * fi * inv2s2);
    sum += w * (texture(uSrc, vUV + uStep * fi) + texture(uSrc, vUV - uStep * fi));
    wsum += 2.0 * w;
  }
  outColor = sum / wsum;
}`;

// Slope field: the achromatic fine-scale residual of luminance, which by the
// relation above is proportional to ∂h/∂â — a slope, not a height.
const SLOPE_FS = `${HEAD}
uniform sampler2D uLin;    // linear rgb + luma
uniform sampler2D uBlur;   // blurred linear rgb + luma
uniform float uChromaReject;
void main() {
  vec4 a = texture(uLin, vUV);
  vec4 b = texture(uBlur, vUV);
  float L = max(a.a, 1e-4);
  float Lb = max(b.a, 1e-4);

  // Work on the log ratio, not the difference: relief shading is *multiplicative*
  // on albedo, so a ratio makes the recovered height independent of how light or
  // dark the paint underneath happens to be. Without this, relief in dark passages
  // comes out flat and relief in light passages comes out exaggerated.
  float h = log(L / Lb);

  // Chroma reject: compare the fine-scale hue against the local average hue.
  // A pure shading change leaves chromaticity untouched; a pigment change moves it.
  vec3 chromaA = a.rgb / L;
  vec3 chromaB = b.rgb / Lb;
  float hueShift = length(chromaA - chromaB);
  float w = 1.0 - uChromaReject * smoothstep(0.02, 0.25, hueShift);

  outColor = vec4(h * w, hueShift, 0.0, 1.0);
}`;

// Directional integration: reconstruct height by accumulating −slope backwards
// along the source azimuth. The linear taper band-limits the integral, which
// both suppresses the unbounded DC drift a raw running sum would accumulate and
// keeps the result at the relief scale we actually care about.
const INTEGRATE_FS = `${HEAD}
uniform sampler2D uSlope;
uniform vec2 uTexel;
uniform vec2 uAzimuth;     // unit vector, the direction the original light came from
uniform float uTaps;
void main() {
  float acc = 0.0;
  float total = 0.0;
  for (int i = 1; i <= 32; i++) {
    float t = float(i);
    if (t > uTaps) break;
    vec2 suv = vUV - uAzimuth * uTexel * t;
    if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) break;
    float wt = 1.0 - (t - 1.0) / uTaps;
    acc += -texture(uSlope, suv).r * wt;
    total += wt;
  }
  outColor = vec4(total > 0.0 ? acc / total : 0.0, 0.0, 0.0, 1.0);
}`;

// Normals by central difference on the height field. Sobel would be smoother but
// central difference keeps single-bristle detail that Sobel averages away, and
// bristle detail is the entire point of this exercise.
const NORMAL_FS = `${HEAD}
uniform sampler2D uHeight;
uniform vec2 uTexel;
uniform float uStrength;
void main() {
  float l = texture(uHeight, vUV - vec2(uTexel.x, 0.0)).r;
  float r = texture(uHeight, vUV + vec2(uTexel.x, 0.0)).r;
  float d = texture(uHeight, vUV - vec2(0.0, uTexel.y)).r;
  float u = texture(uHeight, vUV + vec2(0.0, uTexel.y)).r;

  // dh/dx and dh/dy scaled into a slope. +Y is up because the source texture was
  // uploaded flipped, so the shading space and the light-handle space agree.
  vec3 n = normalize(vec3((l - r) * uStrength, (d - u) * uStrength, 1.0));
  outColor = vec4(n * 0.5 + 0.5, texture(uHeight, vUV).r);
}`;

// Albedo: divide the fine-scale shading back out, so the relight does not
// double-count light that is already baked into the photograph.
const ALBEDO_FS = `${HEAD}
uniform sampler2D uLin;
uniform sampler2D uBlur;
uniform float uSuppress;
void main() {
  vec4 a = texture(uLin, vUV);
  vec4 b = texture(uBlur, vUV);
  float L = max(a.a, 1e-4);
  float Lb = max(b.a, 1e-4);
  float ratio = clamp(Lb / L, 0.25, 4.0);
  outColor = vec4(a.rgb * mix(1.0, ratio, uSuppress), 1.0);
}`;

export class GBuffer {
  constructor(glctx) {
    this.glctx = glctx;
    const { gl } = glctx;
    this.progs = {
      luma: program(gl, LUMA_FS, 'luma'),
      blur: program(gl, BLUR_FS, 'blur'),
      slope: program(gl, SLOPE_FS, 'slope'),
      integrate: program(gl, INTEGRATE_FS, 'integrate'),
      normal: program(gl, NORMAL_FS, 'normal'),
      albedo: program(gl, ALBEDO_FS, 'albedo'),
    };
    this.targets = null;
    this.size = { w: 0, h: 0 };
  }

  resize(w, h) {
    if (this.size.w === w && this.size.h === h) return;
    const { gl, caps } = this.glctx;
    if (this.targets) {
      for (const t of Object.values(this.targets)) {
        gl.deleteTexture(t.tex);
        gl.deleteFramebuffer(t.fbo);
      }
    }
    const mk = () => makeTarget(gl, w, h, { float: true, caps });
    this.targets = { lin: mk(), tmp: mk(), blur: mk(), slope: mk(), height: mk(), normal: mk(), albedo: mk() };
    this.size = { w, h };
  }

  /**
   * Rebuild every derived map. Called only when the source image or a surface
   * parameter changes — never per frame, which is what keeps light dragging cheap.
   */
  build(srcTex, w, h, opts) {
    const { gl } = this.glctx;
    const { reliefScale, reliefStrength, chromaReject, albedoSuppress,
            azimuthDeg, integrateTaps } = opts;
    this.resize(w, h);
    const T = this.targets;
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);

    const run = (prog, target, textures, setUniforms) => {
      bindTarget(gl, target);
      gl.useProgram(prog.program);
      bindTextures(gl, prog, textures);
      if (setUniforms) setUniforms(prog.uniforms);
      drawFullscreen(gl);
    };

    run(this.progs.luma, T.lin, [['uSrc', srcTex]]);

    // Two-pass separable blur; sigma is the relief scale in pixels.
    run(this.progs.blur, T.tmp, [['uSrc', T.lin.tex]], (u) => {
      gl.uniform2f(u.uStep, 1 / w, 0);
      gl.uniform1f(u.uSigma, reliefScale);
    });
    run(this.progs.blur, T.blur, [['uSrc', T.tmp.tex]], (u) => {
      gl.uniform2f(u.uStep, 0, 1 / h);
      gl.uniform1f(u.uSigma, reliefScale);
    });

    run(this.progs.slope, T.slope, [['uLin', T.lin.tex], ['uBlur', T.blur.tex]], (u) => {
      gl.uniform1f(u.uChromaReject, chromaReject);
    });

    const az = (azimuthDeg * Math.PI) / 180;
    run(this.progs.integrate, T.height, [['uSlope', T.slope.tex]], (u) => {
      gl.uniform2f(u.uTexel, 1 / w, 1 / h);
      gl.uniform2f(u.uAzimuth, Math.cos(az), Math.sin(az));
      gl.uniform1f(u.uTaps, integrateTaps);
    });

    run(this.progs.normal, T.normal, [['uHeight', T.height.tex]], (u) => {
      gl.uniform2f(u.uTexel, 1 / w, 1 / h);
      gl.uniform1f(u.uStrength, reliefStrength);
    });

    run(this.progs.albedo, T.albedo, [['uLin', T.lin.tex], ['uBlur', T.blur.tex]], (u) => {
      gl.uniform1f(u.uSuppress, albedoSuppress);
    });

    bindTarget(gl, null);
    return T;
  }
}
