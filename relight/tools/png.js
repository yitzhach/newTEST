// png.js — minimal PNG encode/decode on node:zlib, no dependencies.
//
// Why this exists rather than a library: the surface maths in recover.js must be
// testable with `node` alone, the way tools/validate.mjs already is. The real
// harness reads JPEG and WebP through a headless browser (score-real.mjs), but a
// browser is a heavy thing to require before you can check that file intake works
// at all. PNG is the one format simple enough to do honestly in ~120 lines, and it
// is lossless — which matters here, because HANDOFF.md's capture protocol asks for
// uncompressed originals precisely so that JPEG does not eat the 2-7px band the
// engine works in.
//
// Scope, deliberately narrow: 8-bit non-interlaced truecolour (RGB) and truecolour
// with alpha (RGBA). Anything else throws by name rather than guessing, per the
// project's "refuse rather than approximate" convention.

import { deflateSync, inflateSync } from 'node:zlib';

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}

/**
 * Encode RGBA bytes to a PNG buffer.
 *
 * Filter type 0 (None) on every scanline. A real encoder would try the five
 * filters per row and keep the smallest; we are writing test fixtures, not
 * shipping assets, and None keeps the writer obviously correct.
 */
export function encodePNG(rgba, w, h) {
  if (rgba.length !== w * h * 4) throw new Error(`encodePNG: expected ${w * h * 4} bytes, got ${rgba.length}`);
  const stride = w * 4;
  const bytes = Buffer.isBuffer(rgba) ? rgba : Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    bytes.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // colour type: truecolour + alpha
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    SIG,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const paeth = (a, b, c) => {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/** Decode a PNG buffer to { data: Uint8ClampedArray (RGBA), width, height }. */
export function decodePNG(buf) {
  if (!buf.subarray(0, 8).equals(SIG)) throw new Error('decodePNG: not a PNG (bad signature)');
  let off = 8, w = 0, h = 0, depth = 0, colour = 0, interlace = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      depth = data[8]; colour = data[9]; interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    off += 12 + len;
  }
  if (depth !== 8) throw new Error(`decodePNG: only 8-bit supported, got ${depth}-bit`);
  if (interlace !== 0) throw new Error('decodePNG: interlaced PNG not supported');
  if (colour !== 2 && colour !== 6) {
    throw new Error(`decodePNG: only truecolour (2) and truecolour+alpha (6) supported, got colour type ${colour}`);
  }
  const bpp = colour === 6 ? 4 : 3;
  const stride = w * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  if (raw.length < (stride + 1) * h) throw new Error('decodePNG: truncated image data');

  // Ping-pong two row buffers: `prev` is the already-unfiltered row above, which
  // filter types 2/3/4 reference. They must not alias — after the swap, `cur` is
  // fully overwritten from `raw` before it is read.
  let cur = Buffer.alloc(stride);
  let prev = Buffer.alloc(stride);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)];
    raw.copy(cur, 0, y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let v = cur[i];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) v += paeth(a, b, c);
      else if (ft !== 0) throw new Error(`decodePNG: bad filter type ${ft} on row ${y}`);
      cur[i] = v & 0xff;
    }
    for (let x = 0; x < w; x++) {
      const s = x * bpp, d = (y * w + x) * 4;
      out[d] = cur[s]; out[d + 1] = cur[s + 1]; out[d + 2] = cur[s + 2];
      out[d + 3] = bpp === 4 ? cur[s + 3] : 255;
    }
    const t = prev; prev = cur; cur = t;
  }
  return { data: out, width: w, height: h };
}
