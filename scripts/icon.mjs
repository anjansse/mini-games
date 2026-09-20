// Generates home-screen icons as real PNGs, with no dependencies, because the
// Cloudflare Pages build has no install step.
//
// iOS only accepts PNG for apple-touch-icon — an SVG there is silently ignored
// and the home screen falls back to a screenshot of the page. So these have to
// be rasterised, and rasterising text would need a font engine. The marks are
// therefore geometric: a rounded tile in a hue derived from the slug, plus one
// of a few simple shapes. Deterministic, so an app's icon never changes.

import { deflateSync } from 'node:zlib';

/* ---------- PNG container ---------- */

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

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

// size x size, 8-bit RGBA, filter 0 on every row.
function encodePng(size, pixels) {
  const stride = size * 4;
  const raw = Buffer.alloc(size * (stride + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------- colour ---------- */

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function hslToRgb(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

/* ---------- shapes ---------- */
// Each returns true when the point is inside. Coordinates are -1..1 from centre.

const SHAPES = [
  (x, y) => Math.abs(x) + Math.abs(y) <= 0.62,                              // diamond
  (x, y) => x * x + y * y <= 0.36,                                          // disc
  (x, y) => { const d = x * x + y * y; return d <= 0.40 && d >= 0.16; },    // ring
  (x, y) => Math.max(Math.abs(x), Math.abs(y)) <= 0.52,                     // square
];

function roundedTile(x, y, r) {
  // x,y in -1..1; r is the corner radius as a fraction of the half-extent.
  const ax = Math.abs(x), ay = Math.abs(y), k = 1 - r;
  if (ax <= k || ay <= k) return ax <= 1 && ay <= 1;
  const dx = ax - k, dy = ay - k;
  return dx * dx + dy * dy <= r * r;
}

/* ---------- render ---------- */

const SS = 3; // supersampling factor per axis, for smooth edges

/**
 * @param {string} slug     picks the hue and the mark, deterministically
 * @param {number} size     pixel width and height
 * @param {boolean} maskable  fill the full square (Android maskable icons get
 *                            cropped to a circle, so the tile must bleed out)
 */
export function appIcon(slug, size, maskable = false) {
  const h = hash(slug);
  const hue = h % 360;
  const shape = SHAPES[(h >>> 9) % SHAPES.length];
  const bg = hslToRgb(hue, 0.55, 0.34);
  const fg = hslToRgb(hue, 0.60, 0.94);

  const px = Buffer.alloc(size * size * 4);
  const inset = maskable ? 1 : 0.92;     // leave a hair of margin on iOS
  const radius = maskable ? 0 : 0.26;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let tile = 0, mark = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = ((x + (sx + 0.5) / SS) / size) * 2 - 1;
          const v = ((y + (sy + 0.5) / SS) / size) * 2 - 1;
          if (radius ? roundedTile(u / inset, v / inset, radius) : Math.max(Math.abs(u), Math.abs(v)) <= 1) tile++;
          // The mark is drawn smaller on a maskable icon so the circular crop
          // never clips it.
          if (shape(u / (maskable ? 0.68 : 1), v / (maskable ? 0.68 : 1))) mark++;
        }
      }
      const n = SS * SS;
      const ta = tile / n, ma = (mark / n) * ta;
      const p = (y * size + x) * 4;
      px[p]     = Math.round(bg[0] * (1 - ma) + fg[0] * ma);
      px[p + 1] = Math.round(bg[1] * (1 - ma) + fg[1] * ma);
      px[p + 2] = Math.round(bg[2] * (1 - ma) + fg[2] * ma);
      px[p + 3] = Math.round(255 * ta);
    }
  }
  return encodePng(size, px);
}

export function themeColor(slug) {
  const [r, g, b] = hslToRgb(hash(slug) % 360, 0.55, 0.34);
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}
