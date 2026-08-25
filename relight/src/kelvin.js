// kelvin.js — colour temperature to linear sRGB, through the Planckian locus.
//
// Clipdrop exposes a raw RGB picker. For a photographic tool a Kelvin control is
// both more useful and more physically honest: it moves along the locus of colours
// real incandescent sources actually produce, so "warmer" tracks tungsten rather
// than sliding toward arbitrary orange.
//
// Route: T -> CIE 1931 xy on the Planckian locus -> XYZ (Y normalised to 1)
// -> linear sRGB via the standard D65 matrix.

/** Kim et al. cubic spline approximation of the Planckian locus in CIE 1931 xy.
 *  Valid 1667K–25000K, which comfortably covers candle (1900K) to shade (12000K). */
export function planckianXY(kelvin) {
  const T = Math.min(25000, Math.max(1667, kelvin));
  const t1 = 1e3 / T, t2 = 1e6 / (T * T), t3 = 1e9 / (T * T * T);

  let x;
  if (T <= 4000) x = -0.2661239 * t3 - 0.2343589 * t2 + 0.8776956 * t1 + 0.179910;
  else           x = -3.0258469 * t3 + 2.1070379 * t2 + 0.2226347 * t1 + 0.240390;

  const x2 = x * x, x3 = x2 * x;
  let y;
  if (T <= 2222)      y = -1.1063814 * x3 - 1.34811020 * x2 + 2.18555832 * x - 0.20219683;
  else if (T <= 4000) y = -0.9549476 * x3 - 1.37418593 * x2 + 2.09137015 * x - 0.16748867;
  else                y =  3.0817580 * x3 - 5.87338670 * x2 + 3.75112997 * x - 0.37001483;

  return [x, y];
}

/** xyY (Y = 1) -> CIE XYZ. */
function xyToXYZ(x, y) {
  if (y <= 1e-6) return [0, 0, 0];
  return [x / y, 1, (1 - x - y) / y];
}

// CIE XYZ (D65) -> linear sRGB. Standard IEC 61966-2-1 matrix.
const XYZ_TO_LRGB = [
   3.2404542, -1.5371385, -0.4985314,
  -0.9692660,  1.8760108,  0.0415560,
   0.0556434, -0.2040259,  1.0572252,
];

/**
 * Linear-sRGB tint for a colour temperature, normalised so that changing Kelvin
 * changes hue without also changing exposure — otherwise the temperature slider
 * doubles as a brightness slider and the two controls fight each other.
 */
export function kelvinToLinearRGB(kelvin) {
  const [x, y] = planckianXY(kelvin);
  const [X, Y, Z] = xyToXYZ(x, y);
  const m = XYZ_TO_LRGB;
  let r = m[0] * X + m[1] * Y + m[2] * Z;
  let g = m[3] * X + m[4] * Y + m[5] * Z;
  let b = m[6] * X + m[7] * Y + m[8] * Z;

  // Clip the negative lobes that fall outside the sRGB gamut at the extremes.
  r = Math.max(0, r); g = Math.max(0, g); b = Math.max(0, b);

  // Normalise on luminance, not on max channel: preserving Y is what keeps the
  // apparent brightness constant as the hue swings.
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (lum > 1e-6) { r /= lum; g /= lum; b /= lum; }
  return [r, g, b];
}

/** Linear sRGB -> #rrggbb, for painting swatches and light handles in the DOM. */
export function linearRGBToHex(rgb) {
  const enc = (c) => {
    const v = Math.min(1, Math.max(0, c));
    const s = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
    return Math.round(s * 255).toString(16).padStart(2, '0');
  };
  // Scale so the brightest channel hits 1.0 — a swatch should read as a hue,
  // and the luminance-normalised value above is often > 1 in one channel.
  const peak = Math.max(rgb[0], rgb[1], rgb[2], 1e-6);
  return `#${enc(rgb[0] / peak)}${enc(rgb[1] / peak)}${enc(rgb[2] / peak)}`;
}

/** #rrggbb -> linear sRGB, for the creative-override colour picker. */
export function hexToLinearRGB(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return [1, 1, 1];
  const dec = (h) => {
    const s = parseInt(h, 16) / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return [dec(m[1]), dec(m[2]), dec(m[3])];
}
