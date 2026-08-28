// decode.js — get pixels out of an image file, in node.
//
// PNG in-process with no dependencies; everything else through a headless
// Chromium, which tools/smoke.mjs already requires. Shared by score-real.mjs and
// spectrum.mjs so the two cannot disagree about what a file contains.
//
// One rule worth stating: images are decoded at NATIVE resolution and any
// downscale is the caller's, done deliberately and in linear light. A decoder
// that quietly resampled would low-pass exactly the 1-8px band both callers
// exist to measure.

import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { decodePNG } from './png.js';

let browser = null;
let page = null;

async function ensureBrowser() {
  if (browser) return;
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    throw new Error(
      'Non-PNG images need a headless browser to decode.\n'
      + '  Either:  npm i playwright\n'
      + '  or:      export as PNG, which this reads with no dependencies.\n'
      + 'If playwright is installed but its browser build differs from the one on this\n'
      + 'machine, set CHROME to the chrome binary rather than reinstalling.');
  }
  browser = await chromium.launch({
    executablePath: process.env.CHROME || undefined,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  page = await browser.newPage();
}

export async function closeDecoder() {
  if (browser) { await browser.close(); browser = null; page = null; }
}

const MIME = { jpg: 'jpeg', jpeg: 'jpeg', webp: 'webp', png: 'png', gif: 'gif', bmp: 'bmp', avif: 'avif' };

/**
 * Decode one file to { data: Uint8ClampedArray (RGBA), width, height }.
 *
 * `region` optionally takes a native-resolution crop {x, y, w, h}, which is how to
 * look at a 9MP photograph without moving 36M numbers across the browser bridge —
 * that transfer, not the decode, is the slow part.
 */
export async function decodeImage(path, { region = null } = {}) {
  const ext = extname(path).slice(1).toLowerCase();
  if (ext === 'png' && !region) return decodePNG(readFileSync(path));

  await ensureBrowser();
  const mime = MIME[ext] || ext;
  const b64 = readFileSync(path).toString('base64');
  const r = await page.evaluate(async ({ b64, mime, region }) => {
    const blob = await (await fetch(`data:image/${mime};base64,${b64}`)).blob();
    const bmp = await createImageBitmap(blob);
    const sx = region ? region.x : 0, sy = region ? region.y : 0;
    const w = region ? Math.min(region.w, bmp.width - sx) : bmp.width;
    const h = region ? Math.min(region.h, bmp.height - sy) : bmp.height;
    const c = new OffscreenCanvas(w, h);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, sx, sy, w, h, 0, 0, w, h);   // 1:1, never scaled
    const id = ctx.getImageData(0, 0, w, h);
    return { w, h, full: [bmp.width, bmp.height], bytes: Array.from(id.data) };
  }, { b64, mime, region });
  return { data: new Uint8ClampedArray(r.bytes), width: r.w, height: r.h, sourceSize: r.full };
}

/** Native size without moving any pixels. Cheap enough to call before cropping. */
export async function imageSize(path) {
  const ext = extname(path).slice(1).toLowerCase();
  if (ext === 'png') { const d = decodePNG(readFileSync(path)); return { width: d.width, height: d.height }; }
  await ensureBrowser();
  const b64 = readFileSync(path).toString('base64');
  return page.evaluate(async ({ b64, mime }) => {
    const blob = await (await fetch(`data:image/${mime};base64,${b64}`)).blob();
    const bmp = await createImageBitmap(blob);
    return { width: bmp.width, height: bmp.height };
  }, { b64, mime: MIME[ext] || ext });
}
