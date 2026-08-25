// app.js — the bench. Loads a source image, builds the G-buffer once, then
// re-shades on every interaction. The split matters: surface recovery is the
// expensive half and it only reruns when a surface control moves, which is what
// keeps light dragging at frame rate.

import { createGL } from './gl.js';
import { GBuffer } from './gbuffer.js';
import { Shader, MAX_LIGHTS } from './shade.js';
import { kelvinToLinearRGB, hexToLinearRGB, linearRGBToHex } from './kelvin.js';
import { synthesizePainting, synthesizeCaptureSet, normalsToImageData } from './synth.js';
import { Photometric, buildSolver, uploadShotArray, MAX_SHOTS } from './photometric.js';
import { exportFullRes, downloadCanvas, requiredMargin } from './export.js';
import { registerFrames, resample } from './register.js';
import { estimateLight, spherePointFromLight } from './sphere.js';

const $ = (id) => document.getElementById(id);
const canvas = $('gl');
const wrap = $('wrap');

let glctx, gbuf, shader, photo, srcTex = null, targets = null;
// Photometric capture: one texture per exposure plus its light direction.
// `source` is what gets solved; `original` is what was loaded. Alignment always
// measures and corrects from `original`, so applying it twice cannot compound a
// shift and reverting is a straight swap rather than an inverse resample.
let shots = [];          // [{ source, original, az, elev, name, shift }]
let shotArrayTex = null; // the exposures packed into one TEXTURE_2D_ARRAY
let truthTex = null;     // ground-truth normals, when the source is synthetic
let imgW = 0, imgH = 0;
// The untouched source is kept so export can go back to native resolution;
// the preview only ever sees a downscaled copy.
let fullSource = null, fullW = 0, fullH = 0, previewScale = 1;
let dirtySurface = true;

const state = {
  reliefScale: 3, azimuthDeg: 141, integrateTaps: 8, reliefStrength: 12,
  chromaReject: 0.6, albedoSuppress: 0.7,
  reliefAmount: 1, heightScale: 0.006, roughness: 0.55, specular: 1,
  shadow: 0.7, shadowSpread: 4, ao: 0.4, ambient: 0.12, exposure: 0,
  shadowDist: 0.02, shadowDistPx: 12, exporting: false,
  ambientColor: [1, 1, 1],
  viewMode: 0,
  selected: 0,
  mode: 'single',           // 'single' | 'photometric'
  psFitAmbient: true,
  psClamp: 1.0,
  psShowTruth: false,
  psHeightGain: 1.0,
  psJacobi: 48,
  residualScale: 6,
  psMeanSigma: 16,   // 3*sigma == psJacobi: keep only the converged band
  // Chrome sphere, as fractions of image width/height so it survives a rescale.
  // Null until placed; placing it is a deliberate act, since a circle in the wrong
  // spot produces confident wrong light directions.
  sphere: null,
  placingSphere: false,
  lights: [],
};

function newLight(i) {
  const spots = [[0.28, 0.78], [0.74, 0.66], [0.5, 0.22]];
  const p = spots[i % spots.length];
  return {
    x: p[0], y: p[1], z: 0.55,
    kelvin: 4300, useKelvin: true, hex: '#ffffff',
    rgb: kelvinToLinearRGB(4300),
    power: 2.2, cone: 0.35, enabled: true,
  };
}
state.lights.push(newLight(0));

function fail(e) {
  const box = $('err');
  box.style.display = 'block';
  box.textContent = String(e && e.stack ? e.stack : e);
  console.error(e);
}

// ---------------------------------------------------------------- source

async function loadSynthetic() {
  const lighting = $('synthLight').value;
  const pigmentDetail = parseFloat($('pigment').value);
  const s = synthesizePainting({ width: 820, height: 980, seed: 7, lighting, pigmentDetail });
  const c = document.createElement('canvas');
  c.width = s.width; c.height = s.rows;
  c.getContext('2d').putImageData(s.image, 0, 0);

  // The synthetic rig knows how it lit the scene, so seed the azimuth dial with
  // the truth. On a real photograph this is the one number the user has to supply.
  const AZ = { symmetric: [-0.55, 0.45], single: [-0.55, 0.45], raking: [-0.90, 0.20] }[lighting];
  const deg = (Math.atan2(AZ[1], AZ[0]) * 180 / Math.PI + 360) % 360;
  $('azimuth').value = Math.round(deg);
  state.azimuthDeg = Math.round(deg);
  syncOutputs();

  $('synthNote').innerHTML = lighting === 'symmetric'
    ? '<b>Worst case by design.</b> Two matched opposing lights cancel first-order relief shading — that is what the geometry is for. Expect the recovery to find almost nothing here; that is the correct result, not a bug.'
    : lighting === 'raking'
      ? 'Easy case. Strong directional signal along the azimuth; almost none perpendicular to it.'
      : 'Typical one-light repro shot. Partial recovery along the azimuth.';

  return c;
}

function loadFile(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode that image.'));
    img.src = URL.createObjectURL(file);
  });
}

async function setSource(src) {
  const { gl } = glctx;
  const w = src.width || src.naturalWidth;
  const h = src.height || src.naturalHeight;
  fullSource = src; fullW = w; fullH = h;

  // Cap the working resolution. Relief lives at a few pixels, so there is no
  // point carrying a 100MP scan through an interactive loop — the export path is
  // where full resolution belongs.
  const MAX = 1400;
  const scale = Math.min(1, MAX / Math.max(w, h));
  previewScale = scale;
  imgW = Math.round(w * scale);
  imgH = Math.round(h * scale);

  const c = document.createElement('canvas');
  c.width = imgW; c.height = imgH;
  c.getContext('2d').drawImage(src, 0, 0, imgW, imgH);

  if (srcTex) gl.deleteTexture(srcTex);
  srcTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, srcTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, c);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  canvas.width = imgW; canvas.height = imgH;
  fitCanvas();

  dirtySurface = true;
  render();
}

/**
 * Size the canvas to the stage's real box rather than to the window. Guessing
 * from viewport fractions is what let the canvas slide underneath the control
 * panel on a phone, where the panel's height is not a fixed fraction.
 */
function fitCanvas() {
  if (!imgW || !imgH) return;
  const stage = $('stage');
  const r = stage.getBoundingClientRect();
  const availW = Math.max(80, r.width - 32);
  const availH = Math.max(80, r.height - 32);
  const disp = Math.min(availW / imgW, availH / imgH);
  canvas.style.width = `${Math.round(imgW * disp)}px`;
  canvas.style.height = `${Math.round(imgH * disp)}px`;
}

// ---------------------------------------------------------------- lights UI

function rebuildTabs() {
  const tabs = $('tabs');
  tabs.innerHTML = '';
  state.lights.forEach((l, i) => {
    const b = document.createElement('button');
    b.textContent = `Light ${i + 1}`;
    if (i === state.selected) b.className = 'on';
    b.onclick = () => { state.selected = i; rebuildTabs(); rebuildLightPanel(); };
    tabs.appendChild(b);
  });
  if (state.lights.length < MAX_LIGHTS) {
    const add = document.createElement('button');
    add.textContent = '+ Light';
    add.onclick = () => {
      state.lights.push(newLight(state.lights.length));
      state.selected = state.lights.length - 1;
      rebuildTabs(); rebuildLightPanel(); rebuildHandles(); render();
    };
    tabs.appendChild(add);
  }
}

function slider(label, min, max, step, value, oninput, fmt) {
  const row = document.createElement('div');
  row.className = 'row';
  const lab = document.createElement('label'); lab.textContent = label;
  const inp = document.createElement('input');
  inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step; inp.value = value;
  const out = document.createElement('output');
  const show = () => { out.textContent = fmt ? fmt(parseFloat(inp.value)) : parseFloat(inp.value).toFixed(2); };
  inp.oninput = () => { oninput(parseFloat(inp.value)); show(); render(); };
  show();
  row.append(lab, inp, out);
  return row;
}

function rebuildLightPanel() {
  const p = $('lightPanel');
  p.innerHTML = '';
  const l = state.lights[state.selected];
  if (!l) return;

  const head = document.createElement('div');
  head.style.cssText = 'display:flex;gap:6px;align-items:center;margin-bottom:8px';

  const mode = document.createElement('button');
  mode.textContent = l.useKelvin ? 'Kelvin' : 'Custom';
  mode.onclick = () => { l.useKelvin = !l.useKelvin; applyColor(l); rebuildLightPanel(); rebuildHandles(); render(); };

  const eye = document.createElement('button');
  eye.textContent = l.enabled ? 'Visible' : 'Hidden';
  if (l.enabled) eye.className = 'on';
  eye.onclick = () => { l.enabled = !l.enabled; rebuildLightPanel(); rebuildHandles(); render(); };

  const del = document.createElement('button');
  del.textContent = 'Delete';
  del.disabled = state.lights.length <= 1;
  del.onclick = () => {
    state.lights.splice(state.selected, 1);
    state.selected = Math.max(0, state.selected - 1);
    rebuildTabs(); rebuildLightPanel(); rebuildHandles(); render();
  };

  head.append(mode, eye, del);
  p.appendChild(head);

  if (l.useKelvin) {
    p.appendChild(slider('Temperature', 1800, 10000, 50, l.kelvin,
      (v) => { l.kelvin = v; applyColor(l); rebuildHandles(); }, (v) => `${v | 0}K`));
  } else {
    const row = document.createElement('div');
    row.className = 'row';
    const lab = document.createElement('label'); lab.textContent = 'Colour';
    const inp = document.createElement('input');
    inp.type = 'color'; inp.value = l.hex;
    inp.oninput = () => { l.hex = inp.value; applyColor(l); rebuildHandles(); render(); };
    row.append(lab, inp, document.createElement('output'));
    p.appendChild(row);
  }

  p.appendChild(slider('Power', 0, 8, 0.05, l.power, (v) => { l.power = v; }));
  p.appendChild(slider('Distance', 0.08, 2.5, 0.01, l.z, (v) => { l.z = v; rebuildHandles(); }));
  p.appendChild(slider('Cone', 0, 1, 0.01, l.cone, (v) => { l.cone = v; },
    (v) => (v < 0.02 ? 'flood' : v > 0.97 ? 'spot' : v.toFixed(2))));

  const note = document.createElement('p');
  note.className = 'note';
  note.textContent = 'Drag the dot on the canvas for X/Y; Distance is Z.';
  p.appendChild(note);
}

function applyColor(l) {
  l.rgb = l.useKelvin ? kelvinToLinearRGB(l.kelvin) : hexToLinearRGB(l.hex);
}

function rebuildHandles() {
  wrap.querySelectorAll('.handle').forEach((h) => h.remove());
  state.lights.forEach((l, i) => {
    const d = document.createElement('div');
    d.className = 'handle' + (i === state.selected ? ' sel' : '') + (l.enabled ? '' : ' off');
    d.style.background = l.useKelvin ? linearRGBToHex(l.rgb) : l.hex;
    // Handle size previews the light's reach, so the canvas shows Z as well as X/Y.
    const px = 18 + l.z * 26;
    d.style.width = d.style.height = `${px}px`;
    d.style.margin = `${-px / 2}px 0 0 ${-px / 2}px`;
    d.style.left = `${l.x * 100}%`;
    d.style.top = `${(1 - l.y) * 100}%`;
    d.onpointerdown = (e) => {
      e.preventDefault();
      state.selected = i; rebuildTabs(); rebuildLightPanel(); rebuildHandles();
      const el = wrap.querySelectorAll('.handle')[i];
      el.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const r = canvas.getBoundingClientRect();
        l.x = Math.min(1.4, Math.max(-0.4, (ev.clientX - r.left) / r.width));
        l.y = Math.min(1.4, Math.max(-0.4, 1 - (ev.clientY - r.top) / r.height));
        el.style.left = `${l.x * 100}%`;
        el.style.top = `${(1 - l.y) * 100}%`;
        render();
      };
      const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
    };
    wrap.appendChild(d);
  });
}

// ---------------------------------------------------------------- views

const VIEWS = [
  ['Relit', 0, 'The shaded result. This is the deliverable.'],
  ['Fit', 5, 'Photometric only. How well the Lambertian model matches what was '
    + 'photographed. Blue is a good fit; red means misaligned frames, wrong light '
    + 'angles, specular glints or cast shadows. This is the one view that tells you '
    + 'whether to trust the rest.'],
  ['Normals', 1, 'Recovered surface orientation. Should trace individual brushstrokes, not the composition.'],
  ['Height', 2, 'Reconstructed relief after integration along the azimuth.'],
  ['Albedo', 3, 'Base colour with the baked fine-scale shading divided out.'],
  ['Original', 4, 'The untouched source, for before/after.'],
];

function rebuildViews() {
  const v = $('views');
  v.innerHTML = '';
  VIEWS.forEach(([name, mode, note]) => {
    const b = document.createElement('button');
    b.textContent = name;
    if (state.viewMode === mode) b.className = 'on';
    b.onclick = () => { state.viewMode = mode; rebuildViews(); render(); };
    v.appendChild(b);
  });
  $('viewNote').textContent = (VIEWS.find((x) => x[1] === state.viewMode) || [])[2] || '';
}

// ---------------------------------------------------------------- render

// Height from the Poisson solve is measured in texels, so it grows with
// resolution; normalising against a reference width keeps a capture looking the
// same in the preview and in a full-resolution export.
const PS_REFERENCE_W = 700;

function updateDerived(workingW) {
  const W = Math.max(1, workingW);
  if (state.mode === 'photometric') {
    // Measured relief sits at its true physical scale whatever the resolution,
    // so shadow reach is a fraction of image width and stays put.
    state.shadowDist = state.shadowSpread * 0.005;
    state.shadowDistPx = state.shadowDist * W;
    state.psHeightGain = PS_REFERENCE_W / W;
  } else {
    // Single-image relief is parameterised in PIXELS, so its features shrink as
    // resolution rises; tying shadow reach to the relief scale keeps the two in
    // step. A fixed fraction of image width would leave shadows too long.
    state.shadowDistPx = state.reliefScale * state.shadowSpread;
    state.shadowDist = state.shadowDistPx / W;
  }
}

function render() {
  if (!srcTex) return;
  try {
    updateDerived(imgW);
    if (dirtySurface) {
      if (state.mode === 'photometric') {
        const solver = buildSolver(shots.map(shotDir), { fitAmbient: state.psFitAmbient });
        const status = $('psStatus');
        if (!solver.ok) {
          // Refuse loudly rather than rendering a silently-wrong surface.
          if (status) status.innerHTML = `<b>Cannot solve.</b> ${solver.reason}`;
          return;
        }
        if (status) {
          status.textContent = `${solver.count} shots, ${solver.unknowns} unknowns, `
            + `${solver.dof} spare`
            + (solver.cond > 800 ? ` · condition ${solver.cond.toFixed(0)}, poorly spread rig` : '');
        }
        targets = photo.build(shotArrayTex, solver, imgW, imgH, {
          highlightClamp: state.psClamp,
          heightGain: state.psHeightGain,
          jacobiIterations: state.psJacobi,
          meanSigma: state.psMeanSigma,
          lightDirs: shots.map(shotDir),
        });
        // Fit quality, reported every rebuild. On a real capture this is the only
        // signal that the surface can be trusted.
        if (solver.dof <= 0) {
          // Say so rather than printing a reassuring 0%: with nothing spare the
          // residual is zero by construction and means nothing.
          if (status) {
            status.innerHTML += ` · <b>fit unmeasurable</b> — add a shot to check it`;
          }
        } else {
          const fit = photo.measureResidual(imgW, imgH, residualExclusion());
          if (fit && status) {
            const pct = (fit.mean * 100).toFixed(1);
            const verdict = fit.mean < 1.5 ? 'good'
              : fit.mean < 5 ? 'usable' : 'poor — check alignment and light angles';
            status.textContent += ` · fit ${pct}% (${verdict})`;
          }
        }
      } else {
        targets = gbuf.build(srcTex, imgW, imgH, state);
      }
      dirtySurface = false;
    }
    if (state.mode === 'photometric' && state.psShowTruth && truthTex) {
      // Swap the recovered normals for the known ones, so the two can be compared
      // in the same view without re-rendering anything else.
      targets = Object.assign({}, targets, { normal: { tex: truthTex } });
    }
    if (state.viewMode === 5) {
      if (state.mode === 'photometric') photo.drawResidual(imgW, imgH, state.residualScale, residualExclusion());
      else shader.draw(targets, state, imgH / imgW, imgW, imgH);
    } else {
      shader.draw(targets, state, imgH / imgW, imgW, imgH);
    }
  } catch (e) { fail(e); }
}

function syncOutputs() {
  document.querySelectorAll('#panel .grp .row').forEach((row) => {
    const inp = row.querySelector('input[type=range]');
    const out = row.querySelector('output');
    if (inp && out && inp.id) out.textContent = parseFloat(inp.value).toFixed(inp.step < 1 ? 3 : 0);
  });
}

function bind(id, key, surface) {
  const el = $(id);
  if (!el) return;
  el.addEventListener('input', () => {
    state[key] = parseFloat(el.value);
    if (surface) dirtySurface = true;
    syncOutputs();
    render();
  });
}

/**
 * Refuse to run rather than render quietly-wrong output. The height field is
 * signed, so without float render targets it clamps to [0,1] and the relief goes
 * wrong in a way that still looks like relief — the failure mode this whole tool
 * is built to avoid.
 */
function checkCapabilities(caps) {
  if (!caps.colorBufferFloat) {
    throw new Error(
      'This browser has WebGL2 but not EXT_color_buffer_float, which the surface '
      + 'passes need for a signed height field. Without it the output would be '
      + 'wrong in ways that still look plausible, so it is refused rather than '
      + 'shown.\n\nTry a current Chrome, Edge, Firefox, or Safari 15+.',
    );
  }
}

async function boot() {
  try {
    glctx = createGL(canvas);
    checkCapabilities(glctx.caps);
    gbuf = new GBuffer(glctx);
    shader = new Shader(glctx);
    photo = new Photometric(glctx);
  } catch (e) { return fail(e); }

  $('hint').textContent =
    'Drag the dot to move the light. Distance sets its height. Tap to dismiss.';

  ['reliefScale:reliefScale', 'azimuth:azimuthDeg', 'taps:integrateTaps',
   'reliefStrength:reliefStrength', 'chromaReject:chromaReject',
   'albedoSuppress:albedoSuppress'].forEach((s) => {
    const [id, key] = s.split(':'); bind(id, key, true);
  });
  ['reliefAmount', 'heightScale', 'roughness', 'specular', 'shadow', 'shadowSpread', 'ao', 'ambient', 'exposure']
    .forEach((id) => bind(id, id, false));

  $('src').addEventListener('change', async () => {
    const v = $('src').value;
    const photometric = v === 'psynth' || v === 'pupload';
    state.mode = photometric ? 'photometric' : 'single';
    $('synthOpts').style.display = v === 'synth' ? '' : 'none';
    $('file').style.display = v === 'upload' ? '' : 'none';
    $('psOpts').style.display = photometric ? '' : 'none';
    $('psFiles').style.display = v === 'pupload' ? '' : 'none';
    // Surface-recovery controls only drive the single-image path; the measured
    // path takes its geometry from the capture instead.
    document.querySelectorAll('#panel .grp')[1].style.opacity = photometric ? 0.35 : 1;

    dirtySurface = true;
    if (v === 'synth') await setSource(await loadSynthetic());
    else if (v === 'psynth') await setSource(await loadSyntheticCapture());
  });
  $('synthLight').addEventListener('change', async () => setSource(await loadSynthetic()));
  $('pigment').addEventListener('input', async () => setSource(await loadSynthetic()));
  $('file').addEventListener('change', async (e) => {
    if (e.target.files[0]) {
      try { await setSource(await loadFile(e.target.files[0])); } catch (err) { fail(err); }
    }
  });

  rebuildTabs(); rebuildLightPanel(); rebuildViews(); rebuildHandles(); syncOutputs();
  await setSource(await loadSynthetic());

  wireExport();
  wirePhotometric();
  wireSpherePlacement();

  // Test hook. The §8 #7 acceptance criterion — brushstroke shadows must invert
  // when the light crosses to the other side — is a claim about pixels, so it
  // should be checked against pixels rather than by eye.
  window.__bench = {
    state, render, setSource, loadSynthetic, canvas, applyColor,
    exportFullRes: (job, onP) => exportFullRes(glctx, { gbuf, photo, shader },
      job || { mode: 'single', source: fullSource }, state, onP),
    // --- diagnostics used by the test harness
    shots: () => shots,
    dirty: () => { dirtySurface = true; },
    measureFit: () => photo.measureResidual(imgW, imgH, residualExclusion()),
    residualTarget: () => photo.targets && photo.targets.residual,
    /**
     * Displace one exposure, to model a tripod that moved between shots.
     *
     * Replaces `original` as well as `source`: this is standing in for a frame
     * that was *photographed* from a different position, not for an edit applied
     * afterwards. Moving only `source` would leave alignment measuring an
     * undisplaced original and "correcting" the drift by discarding it, which
     * passes the fit check while testing none of the registration.
     */
    shiftShot: async (i, dx, dy) => {
      const src = shots[i].original;
      const c = document.createElement('canvas');
      c.width = src.width || src.naturalWidth;
      c.height = src.height || src.naturalHeight;
      const cx = c.getContext('2d');
      cx.drawImage(src, dx, dy);
      shots[i].source = c;
      shots[i].original = c;
      shots[i].shift = null;
      packShots(c.width, c.height);
      dirtySurface = true;
      render();
    },
    alignShots,
    readLightsFromSphere,
    setSphere: (c) => { state.sphere = c; drawSphereOverlay(); },
    shotReads: () => shots.map((s2) => s2.read || null),
    shotShifts: () => shots.map((s2) => s2.shift),
    photometricJob: () => ({
      mode: 'photometric',
      sources: shots.map((s2) => s2.source),
      solver: buildSolver(shots.map(shotDir), { fitAmbient: state.psFitAmbient }),
    }),
    getFullSource: () => fullSource,
    caps: () => glctx.caps,
  };
  const relayout = () => { fitCanvas(); if (srcTex) render(); };
  window.addEventListener('resize', relayout);
  window.addEventListener('orientationchange', () => setTimeout(relayout, 120));
  // The panel can change height as sections show and hide, which changes the
  // stage box; observing it is more reliable than guessing when that happens.
  if (window.ResizeObserver) new ResizeObserver(() => fitCanvas()).observe($('stage'));
  $('hint').addEventListener('click', () => $('hint').classList.add('gone'));
}

// ---------------------------------------------------------------- export

function wireExport() {
  const btn = $('exportBtn');
  const status = $('exportStatus');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    if (!fullSource) return;
    btn.disabled = true;
    const fmt = $('exportFmt').value;
    const scalePct = parseFloat($('exportScale').value) / 100;
    const outW = Math.max(1, Math.round(fullW * scalePct));
    const ratio = outW / imgW;

    const photometric = state.mode === 'photometric';
    const saved = {
      reliefScale: state.reliefScale,
      integrateTaps: state.integrateTaps,
      reliefStrength: state.reliefStrength,
    };
    const clamped = [];

    if (!photometric) {
      // Single-image surface parameters are measured in pixels of the working
      // image, so they have to be rescaled or the export shows different relief
      // from the preview.
      state.reliefScale = saved.reliefScale * ratio;
      state.integrateTaps = saved.integrateTaps * ratio;
      // Gradients are taken per texel, so the slope-to-normal gain comes down as
      // texels get smaller, or the export reads far harsher than the preview.
      state.reliefStrength = saved.reliefStrength / ratio;
      if (state.reliefScale > 16) clamped.push(`blur ${state.reliefScale.toFixed(0)}px > 16px shader cap`);
      if (state.integrateTaps > 32) clamped.push(`integration ${state.integrateTaps.toFixed(0)} > 32 tap cap`);
    }
    // The photometric path measures geometry directly, so nothing about the
    // surface needs rescaling; updateDerived() handles the two terms that do.

    let solver = null;
    if (photometric) {
      solver = buildSolver(shots.map(shotDir), { fitAmbient: state.psFitAmbient });
      if (!solver.ok) {
        status.innerHTML = `<b>Cannot export.</b> ${solver.reason}`;
        btn.disabled = false;
        return;
      }
    }

    const rescale = (img) => {
      if (scalePct >= 1) return img;
      const c = document.createElement('canvas');
      c.width = outW; c.height = Math.round(fullH * scalePct);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return c;
    };
    const job = photometric
      ? { mode: 'photometric', sources: shots.map((s2) => rescale(s2.source)), solver }
      : { mode: 'single', source: rescale(fullSource) };

    try {
      status.textContent = `margin ${requiredMargin(state)}px — starting…`;
      const t0 = performance.now();
      const canvas = await exportFullRes(glctx, { gbuf, photo, shader }, job, state, (frac, i, n) => {
        status.textContent = `tile ${i}/${n} — ${Math.round(frac * 100)}%`;
      });
      status.textContent = 'encoding…';
      const bytes = await downloadCanvas(
        canvas,
        `relit-${canvas.width}x${canvas.height}.${fmt === 'image/png' ? 'png' : 'jpg'}`,
        fmt,
        fmt === 'image/jpeg' ? 0.95 : undefined,
      );
      const secs = ((performance.now() - t0) / 1000).toFixed(1);
      status.textContent = `${canvas.width}x${canvas.height}, ${(bytes / 1e6).toFixed(1)}MB, ${secs}s`
        + (clamped.length ? ` — clamped: ${clamped.join('; ')}` : '');
    } catch (e) {
      status.textContent = 'failed — see console';
      fail(e);
    } finally {
      Object.assign(state, saved);
      dirtySurface = true;
      render();
      btn.disabled = false;
    }
  });
}

// ------------------------------------------------------------- chrome sphere

/** Sphere in image pixels of the FULL-resolution frame the reading is taken from. */
function spherePx(w, h) {
  if (!state.sphere) return null;
  return {
    cx: state.sphere.cx * w,
    cy: state.sphere.cy * h,
    r: state.sphere.r * w,
  };
}

/**
 * Drag a circle over the chrome sphere.
 *
 * Placed by hand, and that is not free — a circle 3px off centre on an 80px sphere
 * costs 5 degrees of light direction. What makes it workable is that the error
 * scales with circle error relative to RADIUS, so a big sphere is forgiving where a
 * small one is not. The readout reports degrees-per-pixel for the reading actually
 * taken rather than leaving that to be assumed.
 */
function wireSpherePlacement() {
  const btn = $('sphPlace');
  if (!btn) return;
  btn.addEventListener('click', () => {
    state.placingSphere = !state.placingSphere;
    btn.className = state.placingSphere ? 'on' : '';
    wrap.style.cursor = state.placingSphere ? 'crosshair' : '';
    $('sphStatus').textContent = state.placingSphere
      ? 'Drag from the centre of the sphere out to its edge.'
      : '';
  });

  wrap.addEventListener('pointerdown', (e) => {
    if (!state.placingSphere) return;
    e.preventDefault(); e.stopPropagation();
    const r = canvas.getBoundingClientRect();
    const cx = (e.clientX - r.left) / r.width;
    const cy = (e.clientY - r.top) / r.height;
    wrap.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const dx = ((ev.clientX - r.left) / r.width) - cx;
      // Radius is carried as a fraction of WIDTH, so the circle stays round
      // whatever the aspect ratio.
      const dy = (((ev.clientY - r.top) / r.height) - cy) * (imgH / imgW);
      state.sphere = { cx, cy, r: Math.max(0.005, Math.hypot(dx, dy)) };
      drawSphereOverlay();
    };
    const up = () => {
      wrap.removeEventListener('pointermove', move);
      wrap.removeEventListener('pointerup', up);
      state.placingSphere = false;
      $('sphPlace').className = '';
      wrap.style.cursor = '';
      reportSphere();
    };
    wrap.addEventListener('pointermove', move);
    wrap.addEventListener('pointerup', up);
  }, true);
}

function drawSphereOverlay() {
  let el = wrap.querySelector('.sphere-ring');
  if (!state.sphere) { if (el) el.remove(); return; }
  if (!el) {
    el = document.createElement('div');
    el.className = 'sphere-ring';
    wrap.appendChild(el);
  }
  const s = state.sphere;
  el.style.left = `${s.cx * 100}%`;
  el.style.top = `${s.cy * 100}%`;
  const wpc = s.r * 2 * 100;
  el.style.width = `${wpc}%`;
  el.style.height = `${(s.r * 2 * imgW / imgH) * 100}%`;
}

function reportSphere() {
  const st = $('sphStatus');
  if (!st) return;
  if (!state.sphere) { st.textContent = ''; return; }
  drawSphereOverlay();
  const px = spherePx(imgW, imgH);
  st.innerHTML = `Circle: centre ${(state.sphere.cx * 100).toFixed(1)}%, `
    + `${(state.sphere.cy * 100).toFixed(1)}%, radius ${px.r.toFixed(0)}px in the preview.`
    + ' Then <b>Read light directions</b>.';
}

/**
 * Read every exposure's light direction off the sphere and write them into the rig.
 *
 * Read from `original` at full resolution: the reading's accuracy scales with the
 * sphere's radius in pixels, so taking it from the downscaled preview would throw
 * away most of the precision the sphere exists to provide.
 */
async function readLightsFromSphere() {
  const st = $('sphStatus');
  const btn = $('sphRead');
  if (!state.sphere || !shots.length) {
    if (st) st.innerHTML = '<b>Place the circle on the sphere first.</b>';
    return;
  }
  if (btn) btn.disabled = true;
  try {
    const src = shots[0].original;
    const w = src.width || src.naturalWidth, h = src.height || src.naturalHeight;
    const sph = spherePx(w, h);
    const before = solvableNow() ? photo.measureResidual(imgW, imgH, residualExclusion()) : null;
    const rows = [];
    let worstSens = 0, flagged = 0, failed = 0;

    for (let i = 0; i < shots.length; i++) {
      if (st) st.textContent = `Reading exposure ${i + 1} of ${shots.length}…`;
      await yieldToUI();
      const e = estimateLight(readShot(shots[i].original), w, h, sph);
      if (!e.ok) { rows.push(`${shots[i].name}: ${e.reason}`); failed++; continue; }
      shots[i].az = e.az;
      shots[i].elev = e.elev;
      shots[i].read = e;
      worstSens = Math.max(worstSens, e.sensitivity);
      if (!e.reliable) flagged++;
    }
    renderShotList();
    dirtySurface = true;
    render();

    if (failed === shots.length) {
      st.innerHTML = `<b>Could not read any exposure.</b> ${rows[0] || ''}`;
      return;
    }
    const after = solvableNow() ? photo.measureResidual(imgW, imgH, residualExclusion()) : null;
    let msg = `Read ${shots.length - failed} of ${shots.length} exposures.`
      + ` Worst sensitivity ${worstSens.toFixed(2)}&deg;/px`
      + ` — a circle 3px out costs about ${(worstSens * 3).toFixed(1)}&deg;.`;

    // A capture moves the lamp between exposures — that is what makes it a capture.
    // So if every reading comes back pointing the same way, the circle is not on a
    // mirror: it is sitting on paint, and the "highlight" it found is just the
    // brightest brushstroke in that patch, which does not move. Caught here because
    // it is decisive and needs no reference; the fit check below catches the rest.
    const read = shots.filter((s2) => s2.read);
    if (read.length >= 3) {
      let spread = 0;
      for (let i = 0; i < read.length; i++) {
        for (let j = i + 1; j < read.length; j++) {
          const a = read[i].read.dir, b = read[j].read.dir;
          const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
          spread = Math.max(spread, Math.acos(Math.max(-1, Math.min(1, d))) * 180 / Math.PI);
        }
      }
      if (spread < 12) {
        msg += ` <b>These readings cannot be right:</b> every exposure came back within`
          + ` ${spread.toFixed(1)}&deg; of the others, but the lamp moved between them.`
          + ' The circle is almost certainly not on the sphere.';
      }
    }

    if (before && after) {
      msg += ` Fit ${(before.mean * 100).toFixed(2)}% &rarr; <b>${(after.mean * 100).toFixed(2)}%</b>`;
      // The same objective test the alignment uses. Directions that make the model
      // fit the photographs worse are worse directions, whatever the sphere looked
      // like — and unlike alignment there is nothing to put back, since the angles
      // being replaced were themselves guesses.
      if (after.mean > before.mean * 1.25) {
        msg += ' — <b>worse.</b> Either the circle is off the sphere, or it was'
          + ' reading something else bright on it. The previous angles are not restored;'
          + ' set them by hand or place the circle again.';
      } else if (after.mean < before.mean * 0.9) {
        msg += ' — better, so the sphere is telling you something the typed angles were not.';
      } else {
        msg += '.';
      }
    }
    if (flagged) {
      msg += ` <b>${flagged} reading${flagged === 1 ? '' : 's'} flagged</b> — the highlight`
        + ' landed near the rim, the sphere is small in frame, or something else on it is'
        + ' nearly as bright as the lamp. Check those angles before trusting the surface.';
    }
    if (failed) msg += ` ${failed} failed: ${rows[0]}`;
    if (worstSens > 1.5) {
      msg += ' <b>The sphere is small for this.</b> Accuracy scales with its radius in'
        + ' pixels — re-shoot with it larger in frame, or nearer the camera.';
    }
    st.innerHTML = msg;
  } catch (e) {
    if (st) st.innerHTML = '<b>Read failed.</b> See console.';
    fail(e);
  } finally {
    if (btn) btn.disabled = false;
  }
}

// --------------------------------------------------------- frame registration

/** A shot's pixels, read on demand so a full-resolution set is never all in RAM. */
function readShot(src) {
  const w = src.width || src.naturalWidth, h = src.height || src.naturalHeight;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const cx = c.getContext('2d', { willReadFrequently: true });
  cx.drawImage(src, 0, 0);
  return cx.getImageData(0, 0, w, h).data;
}

function putShot(data, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').putImageData(new ImageData(data, w, h), 0, 0);
  return c;
}

/** Let the browser paint between the slow steps. */
const yieldToUI = () => new Promise((r) => setTimeout(r, 0));

/**
 * Measure the drift between exposures and correct it.
 *
 * The verdict is the fit residual before against after. That is the point of
 * doing this now rather than earlier: registration used to have no way to show it
 * had helped, and the residual is an objective score that a real capture — which
 * arrives with no ground truth — can actually produce. If it does not improve,
 * this says so and leaves the frames alone rather than insisting.
 */
async function alignShots() {
  const status = $('psStatus');
  const btn = $('psAlign');
  if (shots.length < 2) return;

  const w = shots[0].original.width || shots[0].original.naturalWidth;
  const h = shots[0].original.height || shots[0].original.naturalHeight;
  const say = (html) => { if (status) status.innerHTML = html; };

  if (btn) btn.disabled = true;
  const beforeFit = solvableNow() ? photo.measureResidual(imgW, imgH, residualExclusion()) : null;

  try {
    const reg = await registerFrames(
      shots.map((s2) => ({ width: w, height: h, read: () => readShot(s2.original) })),
      {
        onProgress: async (frac, msg) => {
          say(`Aligning — ${msg} (${Math.round(frac * 100)}%)`);
          await yieldToUI();
        },
      });

    if (!reg.ok) { say(`<b>Cannot align.</b> ${reg.reason}`); return; }

    for (let i = 0; i < shots.length; i++) {
      say(`Aligning — correcting frame ${i + 1} of ${shots.length}`);
      await yieldToUI();
      const sh = reg.shifts[i];
      shots[i].shift = sh;
      shots[i].source = (Math.abs(sh.dx) < 1e-6 && Math.abs(sh.dy) < 1e-6)
        ? shots[i].original
        : putShot(resample(readShot(shots[i].original), w, h, sh.dx, sh.dy), w, h);
    }
    packShots(w, h);
    renderShotList();
    dirtySurface = true;
    render();

    const afterFit = solvableNow() ? photo.measureResidual(imgW, imgH, residualExclusion()) : null;
    const px = (v) => `${v.toFixed(2)}px`;
    let msg = `Aligned: drift up to ${px(reg.worst)}`
      + (reg.reduce > 1 ? ` (measured at 1/${reg.reduce} scale)` : '')
      + `. Pairs agree to ${px(reg.consistency)}`
      + (reg.outliers ? `, ${reg.outliers} of ${reg.pairs} discounted` : '');

    if (beforeFit && afterFit) {
      const b = beforeFit.mean * 100, a = afterFit.mean * 100;
      msg += ` · fit ${b.toFixed(2)}% → <b>${a.toFixed(2)}%</b>`;
      if (a > b + 0.02) {
        // Say it plainly and put it back. A correction that made the fit worse is
        // a correction that was wrong, whatever the correlation peaks looked like.
        msg += ' — <b>worse, so the frames have been put back.</b>'
          + ' Registration only corrects translation; a rotated or rescaled frame,'
          + ' or a light angle that is wrong, will not be fixed by shifting it.';
        revertShots(w, h);
      }
    } else if (!beforeFit || !afterFit) {
      msg += ' · fit unmeasurable — add a shot to check it';
    }
    if (!reg.reliable) {
      msg += ' <b>Low confidence:</b> the frame pairs did not agree well.'
        + ' Check the Fit view before trusting this.';
    }
    say(msg);
  } catch (e) {
    say('<b>Align failed.</b> See console.');
    fail(e);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function revertShots(w, h) {
  shots.forEach((s2) => { s2.source = s2.original; s2.shift = null; });
  packShots(w, h);
  renderShotList();
  dirtySurface = true;
  render();
}

/** The sphere's disc in preview pixels, for excluding it from the fit. */
function residualExclusion() {
  return state.sphere ? spherePx(imgW, imgH) : null;
}

/** Whether a residual is meaningful right now: it needs spare degrees of freedom. */
function solvableNow() {
  if (state.mode !== 'photometric' || !photo || !photo.targets) return false;
  const solver = buildSolver(shots.map(shotDir), { fitAmbient: state.psFitAmbient });
  return solver.ok && solver.dof > 0;
}

// ------------------------------------------------------- photometric capture

function shotDir(s2) {
  const a = (s2.az * Math.PI) / 180, e = (s2.elev * Math.PI) / 180;
  return [Math.cos(a) * Math.cos(e), Math.sin(a) * Math.cos(e), Math.sin(e)];
}

function uploadTex(canvasOrImg) {
  const { gl } = glctx;
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, canvasOrImg);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

function disposeShots() {
  const { gl } = glctx;
  shots = [];
  if (shotArrayTex) { gl.deleteTexture(shotArrayTex); shotArrayTex = null; }
  if (truthTex) { gl.deleteTexture(truthTex); truthTex = null; }
}

/** Rebuild the array texture. Only needed when the image set changes — moving a
 *  light angle re-solves but re-uses the same pixels. */
function packShots(w, h) {
  const { gl } = glctx;
  if (shotArrayTex) gl.deleteTexture(shotArrayTex);
  shotArrayTex = uploadShotArray(gl, shots.map((s2) => s2.source), w, h);
}

function toCanvas(imageData) {
  const c = document.createElement('canvas');
  c.width = imageData.width; c.height = imageData.height;
  c.getContext('2d').putImageData(imageData, 0, 0);
  return c;
}

async function loadSyntheticCapture() {
  const n = parseInt($('psShots').value, 10);
  const elev = parseFloat($('psElev').value);
  const spread = parseFloat($('psSpread').value);

  const dirs = [], meta = [];
  for (let i = 0; i < n; i++) {
    const az = (i * 360) / n;
    // Alternate the elevation so the ambient unknown is separable. With every
    // light at one height the Lz column matches the ambient column exactly.
    const e = elev + (i % 2 ? spread : -spread) * 0.5;
    const a = (az * Math.PI) / 180, er = (e * Math.PI) / 180;
    dirs.push([Math.cos(a) * Math.cos(er), Math.sin(a) * Math.cos(er), Math.sin(er)]);
    meta.push({ az, elev: e, name: `shot ${i + 1}` });
  }

  // The synthetic sphere is opt-in: it occupies part of the frame and the solve
  // makes nonsense of those pixels, exactly as it would on a real capture, so it
  // should not appear in the default bench image.
  const withSphere = $('psSphere') && $('psSphere').className === 'on';
  const sphere = withSphere ? { cx: 180, cy: 620, r: 150 } : null;
  const S = synthesizeCaptureSet({
    width: 700, height: 800, seed: 7,
    pigmentDetail: parseFloat($('pigment').value),
    lightDirs: dirs, sphere,
  });
  if (sphere) {
    // Pre-filled because on the synthetic path its position is known. On a real
    // capture this is the one thing the user has to supply.
    state.sphere = { cx: sphere.cx / S.width, cy: sphere.cy / S.rows, r: sphere.r / S.width };
  }

  disposeShots();
  shots = S.images.map((im, i) => {
    const c = toCanvas(im);
    return { source: c, original: c, shift: null, ...meta[i] };
  });
  packShots(S.width, S.rows);
  truthTex = uploadTex(toCanvas(normalsToImageData(S.normals, S.width, S.rows)));
  renderShotList();
  return shots[0].source;
}

async function loadUploadedCapture(files) {
  const imgs = await Promise.all([...files].slice(0, MAX_SHOTS).map(loadFile));
  const w = imgs[0].naturalWidth, h = imgs[0].naturalHeight;
  const mismatched = imgs.filter((im) => im.naturalWidth !== w || im.naturalHeight !== h);
  if (mismatched.length) {
    throw new Error('All exposures must be the same size and framing — photometric stereo '
      + 'assumes a fixed camera. Re-export them at matching dimensions.');
  }
  disposeShots();
  shots = imgs.map((im, i) => ({
    source: im, original: im, shift: null,
    // A sensible starting rig; the user corrects it per shot below.
    az: (i * 360) / imgs.length,
    elev: 45 + (i % 2 ? 7 : -7),
    name: files[i].name.slice(0, 22),
  }));
  packShots(w, h);
  renderShotList();
  return imgs[0];
}

function renderShotList() {
  const box = $('psShotList');
  if (!box) return;
  box.innerHTML = '';
  shots.forEach((s2, i) => {
    const row = document.createElement('div');
    row.className = 'row';
    row.style.gridTemplateColumns = '68px 1fr 1fr';
    const lab = document.createElement('label');
    lab.textContent = s2.name;
    lab.title = s2.name;
    lab.style.overflow = 'hidden';
    lab.style.textOverflow = 'ellipsis';

    const mk = (val, min, max, onset, title) => {
      const inp = document.createElement('input');
      inp.type = 'number'; inp.value = Math.round(val); inp.min = min; inp.max = max;
      inp.title = title;
      inp.style.cssText = 'width:100%;background:var(--panel2);color:var(--ink);'
        + 'border:1px solid var(--line);border-radius:5px;padding:3px 5px;font:11px var(--mono)';
      inp.oninput = () => { onset(parseFloat(inp.value) || 0); dirtySurface = true; render(); };
      return inp;
    };
    row.append(lab,
      mk(s2.az, -360, 360, (v) => { s2.az = v; }, 'azimuth, degrees'),
      mk(s2.elev, 1, 89, (v) => { s2.elev = v; }, 'elevation, degrees'));
    if (s2.read) {
      const d = document.createElement('span');
      d.className = 'note';
      d.style.cssText = 'grid-column:1/-1;margin:0 0 4px;font:10px var(--mono);opacity:.75';
      d.textContent = `sphere: ${s2.read.sensitivity.toFixed(2)}\u00b0/px, rim ${s2.read.rim.toFixed(2)}`
        + (s2.read.reliable ? '' : ' — flagged');
      if (!s2.read.reliable) d.style.color = 'var(--warn, #e0a030)';
      row.appendChild(d);
    }
    if (s2.shift) {
      // The measured drift, per frame. Worth showing rather than folding into one
      // headline: it says WHICH exposure moved, which is the thing a re-shoot
      // needs to know.
      const d = document.createElement('span');
      d.className = 'note';
      d.style.cssText = 'grid-column:1/-1;margin:0 0 4px;font:10px var(--mono);opacity:.75';
      d.textContent = `shifted ${s2.shift.dx >= 0 ? '+' : ''}${s2.shift.dx.toFixed(2)}, `
        + `${s2.shift.dy >= 0 ? '+' : ''}${s2.shift.dy.toFixed(2)} px`;
      row.appendChild(d);
    }
    box.appendChild(row);
  });
}

function wirePhotometric() {
  const set = (id, fn) => { const el = $(id); if (el) el.addEventListener('input', fn); };
  ['psShots', 'psElev', 'psSpread'].forEach((id) => set(id, async () => {
    if (state.mode === 'photometric' && $('src').value === 'psynth') {
      syncOutputs();
      await setSource(await loadSyntheticCapture());
    }
  }));
  set('psClamp', () => { state.psClamp = parseFloat($('psClamp').value); dirtySurface = true; syncOutputs(); render(); });

  $('psAmbient').addEventListener('click', () => {
    state.psFitAmbient = !state.psFitAmbient;
    $('psAmbient').className = state.psFitAmbient ? 'on' : '';
    dirtySurface = true; render();
  });
  const sphToggle = $('psSphere');
  if (sphToggle) {
    sphToggle.addEventListener('click', async () => {
      sphToggle.className = sphToggle.className === 'on' ? '' : 'on';
      if (sphToggle.className !== 'on') { state.sphere = null; drawSphereOverlay(); }
      shots.forEach((s2) => { s2.read = null; });
      if (state.mode === 'photometric' && $('src').value === 'psynth') {
        await setSource(await loadSyntheticCapture());
        reportSphere();
      }
    });
  }
  $('psTruth').addEventListener('click', () => {
    state.psShowTruth = !state.psShowTruth;
    $('psTruth').className = state.psShowTruth ? 'on' : '';
    if (state.psShowTruth && state.viewMode === 0) { state.viewMode = 1; rebuildViews(); }
    render();
  });
  const sphRead = $('sphRead');
  if (sphRead) sphRead.addEventListener('click', () => { readLightsFromSphere(); });
  const sphClear = $('sphClear');
  if (sphClear) {
    sphClear.addEventListener('click', () => {
      state.sphere = null;
      shots.forEach((s2) => { s2.read = null; });
      drawSphereOverlay(); renderShotList();
      $('sphStatus').textContent = 'Circle cleared. Angles keep whatever they were last set to.';
    });
  }
  const alignBtn = $('psAlign');
  if (alignBtn) alignBtn.addEventListener('click', () => { alignShots(); });
  const resetBtn = $('psAlignReset');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      if (!shots.length) return;
      const src = shots[0].original;
      revertShots(src.width || src.naturalWidth, src.height || src.naturalHeight);
      const st = $('psStatus');
      if (st) st.textContent = 'Alignment cleared — frames are as shot.';
    });
  }
  $('psFiles').addEventListener('change', async (e) => {
    if (!e.target.files.length) return;
    try { await setSource(await loadUploadedCapture(e.target.files)); }
    catch (err) { $('psStatus').innerHTML = `<b>${err.message}</b>`; }
  });
}

boot();
