// gl.js — minimal WebGL2 scaffolding for the relight bench.
// Everything here is plain ES modules with no build step: the bench must be
// openable from a static file server with zero toolchain, so that judging the
// surface response never depends on a working install.

export function createGL(canvas) {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    preserveDrawingBuffer: true,
    premultipliedAlpha: false,
  });
  if (!gl) throw new Error('WebGL2 is required and is not available in this browser.');

  // Float render targets are what let the G-buffer hold a signed height field and
  // linear-light colour without banding. Half-float is enough and is far more
  // widely supported than full float, so prefer it and record what we actually got.
  const halfFloat = gl.getExtension('EXT_color_buffer_float');
  const linearFloat = gl.getExtension('OES_texture_float_linear');
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

  return {
    gl,
    caps: {
      colorBufferFloat: !!halfFloat,
      linearFloat: !!linearFloat,
      maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    },
  };
}

export function compile(gl, type, src, label) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`Shader compile failed (${label}):\n${log}\n\n${numberLines(src)}`);
  }
  return sh;
}

function numberLines(src) {
  return src.split('\n').map((l, i) => `${String(i + 1).padStart(3)}| ${l}`).join('\n');
}

// Every pass in this bench is a fullscreen triangle, so they all share one vertex
// shader and differ only in the fragment stage.
export const FULLSCREEN_VS = `#version 300 es
out vec2 vUV;
void main() {
  // Single oversized triangle: cheaper than a quad and avoids the diagonal seam
  // that shows up when a quad is rasterised with derivatives near the split.
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUV = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export function program(gl, fsSrc, label) {
  const vs = compile(gl, gl.VERTEX_SHADER, FULLSCREEN_VS, `${label}:vs`);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc, `${label}:fs`);
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(p);
    gl.deleteProgram(p);
    throw new Error(`Program link failed (${label}):\n${log}`);
  }
  // Cache uniform locations up front; getUniformLocation is a synchronous driver
  // round-trip and the shading pass sets ~30 uniforms per frame.
  const uniforms = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    const name = info.name.replace(/\[0\]$/, '');
    uniforms[name] = gl.getUniformLocation(p, name);
  }
  return { program: p, uniforms, label };
}

export function drawFullscreen(gl) {
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

/** A render target plus its texture. Float when the hardware allows it. */
export function makeTarget(gl, w, h, { float = true, linear = true, caps } = {}) {
  const useFloat = float && caps && caps.colorBufferFloat;
  const filter = linear && (!useFloat || (caps && caps.linearFloat)) ? gl.LINEAR : gl.NEAREST;

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(
    gl.TEXTURE_2D, 0,
    useFloat ? gl.RGBA16F : gl.RGBA8,
    w, h, 0,
    gl.RGBA,
    useFloat ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE,
    null,
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error(`Framebuffer incomplete (0x${status.toString(16)}) at ${w}x${h}, float=${useFloat}`);
  }
  return { tex, fbo, w, h, float: useFloat };
}

export function bindTarget(gl, target) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
  if (target) gl.viewport(0, 0, target.w, target.h);
}

export function texFromImage(gl, img) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

export function bindTextures(gl, prog, entries) {
  entries.forEach(([name, tex], unit) => {
    const loc = prog.uniforms[name];
    if (loc == null) return;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(loc, unit);
  });
}
