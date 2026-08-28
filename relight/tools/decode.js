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
  if (ext === 'png') {
    // Crop in-process too. Routing a PNG through the browser just to take a
    // rectangle out of it would make the documented "PNG needs no dependencies"
    // false for every caller that samples crops — which is both of them.
    const img = decodePNG(readFileSync(path));
    if (!region) return img;
    const x0 = Math.max(0, Math.min(img.width - 1, region.x));
    const y0 = Math.max(0, Math.min(img.height - 1, region.y));
    const w = Math.max(1, Math.min(region.w, img.width - x0));
    const h = Math.max(1, Math.min(region.h, img.height - y0));
    const out = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      const src = ((y0 + y) * img.width + x0) * 4;
      out.set(img.data.subarray(src, src + w * 4), y * w * 4);
    }
    return { data: out, width: w, height: h, sourceSize: [img.width, img.height] };
  }

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
  if (ext === 'png') {
    // Straight out of IHDR. Inflating a 12MP image to learn its width is a
    // second or two of pure waste, and callers ask before every crop.
    const head = readFileSync(path).subarray(0, 33);
    if (head.length < 24) throw new Error(`imageSize: ${path} is too short to be a PNG`);
    return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
  }
  await ensureBrowser();
  const b64 = readFileSync(path).toString('base64');
  return page.evaluate(async ({ b64, mime }) => {
    const blob = await (await fetch(`data:image/${mime};base64,${b64}`)).blob();
    const bmp = await createImageBitmap(blob);
    return { width: bmp.width, height: bmp.height };
  }, { b64, mime: MIME[ext] || ext });
}
