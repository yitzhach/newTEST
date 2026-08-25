// export.js — full-resolution render.
//
// The preview deliberately works on a downscaled copy, because relief lives at a
// few pixels and dragging a light through a 60MP image is pointless. Export has
// the opposite priority: every pixel, however long it takes.
//
// It renders in tiles with an overlap margin. The margin is not cosmetic — the
// blur, the directional integration and the shadow march all read outside the
// pixel they are writing, so a tile rendered without context would show seams
// exactly where the relief is strongest.

import { makeTarget, bindTarget } from './gl.js';
import { uploadShotArray } from './photometric.js';

/**
 * How far outside a tile the surface passes reach, in pixels. Getting this wrong
 * does not fail loudly — it seams, exactly where the relief is strongest.
 */
export function requiredMargin(state) {
  const shadow = Math.ceil(state.shadowDistPx || 0);
  if (state.mode === 'photometric') {
    // Height comes from Jacobi relaxation, which moves information one texel per
    // sweep, so a pixel depends on everything within `iterations` texels. The
    // mean-removal blur that follows reaches 3 sigma further.
    const jacobi = Math.ceil(state.psJacobi || 48);
    const mean = Math.ceil(3 * (state.psMeanSigma || 16));
    return jacobi + mean + shadow + 4;
  }
  const blur = Math.ceil(3 * state.reliefScale);
  const integrate = Math.ceil(state.integrateTaps);
  return blur + integrate + shadow + 4;
}

/**
 * @param builders {gbuf, photo, shader}
 * @param job      {mode:'single', source} | {mode:'photometric', sources:[], solver}
 */
export async function exportFullRes(glctx, builders, job, state, onProgress) {
  const { gl, caps } = glctx;
  const { gbuf, photo, shader } = builders;
  const photometric = job.mode === 'photometric';
  const sources = photometric ? job.sources : [job.source];
  const source = sources[0];
  const W = source.width || source.naturalWidth;
  const H = source.height || source.naturalHeight;
  const aspect = H / W;

  const margin = requiredMargin(state);
  // Keep the padded tile inside the driver's texture limit with room to spare;
  // several float targets of this size are alive at once.
  // Overridable so the seam behaviour can be exercised on small test images, and
  // so a constrained device can be told to use less memory per tile.
  const maxTile = state.maxTile
    ? Math.max(64, state.maxTile)
    : Math.min(2048, Math.max(256, (caps.maxTexture || 4096) / 2));
  const interior = Math.max(64, maxTile - 2 * margin);

  const cols = Math.ceil(W / interior);
  const rows = Math.ceil(H / interior);
  const total = cols * rows;

  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const octx = out.getContext('2d', { willReadFrequently: false });

  // Scratch canvas for cutting padded regions out of the source.
  const cut = document.createElement('canvas');
  const cutx = cut.getContext('2d', { willReadFrequently: false });

  const tex = photometric ? null : gl.createTexture();
  let shotArray = null;
  let target = null;
  let done = 0;

  const prevExporting = state.exporting;
  state.exporting = true;

  try {
    for (let ty = 0; ty < rows; ty++) {
      for (let tx = 0; tx < cols; tx++) {
        const ix0 = tx * interior, iy0 = ty * interior;
        const iw = Math.min(interior, W - ix0), ih = Math.min(interior, H - iy0);
        if (iw <= 0 || ih <= 0) continue;

        // Padded region, clamped to the image. Clamping means edge tiles get less
        // context than interior ones; that is correct, since there is no data to
        // be had beyond the border.
        const px0 = Math.max(0, ix0 - margin);
        const py0 = Math.max(0, iy0 - margin);
        const px1 = Math.min(W, ix0 + iw + margin);
        const py1 = Math.min(H, iy0 + ih + margin);
        const pw = px1 - px0, ph = py1 - py0;

        cut.width = pw; cut.height = ph;

        let targets;
        if (photometric) {
          // Cut the same region out of every exposure. The solve is per pixel and
          // assumes all exposures see the same pixel, so they must be cut alike.
          const pieces = sources.map((src) => {
            const c = document.createElement('canvas');
            c.width = pw; c.height = ph;
            c.getContext('2d').drawImage(src, px0, py0, pw, ph, 0, 0, pw, ph);
            return c;
          });
          if (shotArray) gl.deleteTexture(shotArray);
          shotArray = uploadShotArray(gl, pieces, pw, ph);
          targets = photo.build(shotArray, job.solver, pw, ph, {
            highlightClamp: state.psClamp,
            heightGain: state.psHeightGain,
            jacobiIterations: state.psJacobi || 48,
            meanSigma: state.psMeanSigma || 16,
          });
        } else {
          cutx.clearRect(0, 0, pw, ph);
          cutx.drawImage(source, px0, py0, pw, ph, 0, 0, pw, ph);
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, cut);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          targets = gbuf.build(tex, pw, ph, state);
        }

        if (!target || target.w !== pw || target.h !== ph) {
          if (target) { gl.deleteTexture(target.tex); gl.deleteFramebuffer(target.fbo); }
          target = makeTarget(gl, pw, ph, { float: false, linear: false, caps });
        }
        bindTarget(gl, target);

        // Textures are uploaded flipped, so v = 0 is the BOTTOM of the image and
        // the tile's UV origin has to be measured up from the bottom edge.
        shader.draw(targets, state, aspect, pw, ph, {
          ox: px0 / W,
          oy: (H - py1) / H,
          sx: pw / W,
          sy: ph / H,
        });

        const buf = new Uint8Array(pw * ph * 4);
        gl.readPixels(0, 0, pw, ph, gl.RGBA, gl.UNSIGNED_BYTE, buf);

        // readPixels comes back bottom-up; un-flip while copying only the
        // interior, which is the part that had full context on every side.
        const offX = ix0 - px0, offY = iy0 - py0;
        const img = octx.createImageData(iw, ih);
        for (let y = 0; y < ih; y++) {
          const srcRow = ph - 1 - (offY + y);
          let s = (srcRow * pw + offX) * 4;
          let d = y * iw * 4;
          for (let x = 0; x < iw; x++) {
            img.data[d] = buf[s]; img.data[d + 1] = buf[s + 1];
            img.data[d + 2] = buf[s + 2]; img.data[d + 3] = 255;
            s += 4; d += 4;
          }
        }
        octx.putImageData(img, ix0, iy0);

        done++;
        if (onProgress) onProgress(done / total, done, total);
        // Yield so the progress readout actually paints between tiles.
        await new Promise((r) => setTimeout(r, 0));
      }
    }
  } finally {
    state.exporting = prevExporting;
    bindTarget(gl, null);
    if (tex) gl.deleteTexture(tex);
    if (shotArray) gl.deleteTexture(shotArray);
    if (target) { gl.deleteTexture(target.tex); gl.deleteFramebuffer(target.fbo); }
  }

  return out;
}

export function downloadCanvas(canvas, filename, type = 'image/png', quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error('Could not encode the image.'));
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      resolve(blob.size);
    }, type, quality);
  });
}
