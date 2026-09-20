// Generates home-screen icons as real PNGs, with no dependencies, because the
// Cloudflare Pages build has no install step.
//
// iOS only accepts PNG for apple-touch-icon — an SVG there is silently ignored
// and the home screen falls back to a screenshot of the page. Rasterising text
// would need a font engine, so an app picks a named mark from GLYPHS below and
// that path is filled here.
//
// Cost matters: this runs once per app per build. One master is rasterised at
// high resolution and every smaller size is box-filtered down from it, which is
// both far cheaper than rasterising each size and better-looking, since the
// downscale is itself the antialiasing.

import { deflateSync } from 'node:zlib';

/* ---------- marks ----------
   Filled paths on a 24x24 grid, centred on (12,12). Keep them solid shapes:
   the rasteriser fills, it does not stroke. Add to this list rather than
   inventing per-app artwork, so the set stays coherent at a hundred games. */

export const GLYPHS = {
  spade:  'M12 2C12 2 4 8.5 4 13.5C4 16.5 6.2 18.5 8.6 18.5C10 18.5 11 17.9 11.6 17C11.4 19 10.6 20.4 9 21.2L9 22L15 22L15 21.2C13.4 20.4 12.6 19 12.4 17C13 17.9 14 18.5 15.4 18.5C17.8 18.5 20 16.5 20 13.5C20 8.5 12 2 12 2Z',
  heart:  'M12 21C12 21 3 14.7 3 9.2C3 6.3 5.2 4.2 7.9 4.2C9.7 4.2 11.2 5.2 12 6.6C12.8 5.2 14.3 4.2 16.1 4.2C18.8 4.2 21 6.3 21 9.2C21 14.7 12 21 12 21Z',
  diamond:'M12 2L20 12L12 22L4 12Z',
  club:   'M12 2C9.9 2 8.2 3.7 8.2 5.8C8.2 6.4 8.3 6.9 8.6 7.4C8.2 7.2 7.7 7.1 7.2 7.1C5.1 7.1 3.4 8.8 3.4 10.9C3.4 13 5.1 14.7 7.2 14.7C8.6 14.7 9.8 13.9 10.5 12.8C10.6 15.5 10 19.4 8.5 21.2L8.5 22L15.5 22L15.5 21.2C14 19.4 13.4 15.5 13.5 12.8C14.2 13.9 15.4 14.7 16.8 14.7C18.9 14.7 20.6 13 20.6 10.9C20.6 8.8 18.9 7.1 16.8 7.1C16.3 7.1 15.8 7.2 15.4 7.4C15.7 6.9 15.8 6.4 15.8 5.8C15.8 3.7 14.1 2 12 2Z',
  cards:  'M7.5 5L15 3L19 17L11.5 19ZM5 7L9.5 21L5 22L2 9Z',
  dice:   'M4 4L20 4L20 20L4 20ZM8 8.5A1.6 1.6 0 1 0 8 11.7A1.6 1.6 0 1 0 8 8.5ZM16 12.3A1.6 1.6 0 1 0 16 15.5A1.6 1.6 0 1 0 16 12.3ZM12 10.4A1.6 1.6 0 1 0 12 13.6A1.6 1.6 0 1 0 12 10.4Z',
  star:   'M12 2L15.1 8.6L22 9.6L17 14.6L18.2 21.6L12 18.3L5.8 21.6L7 14.6L2 9.6L8.9 8.6Z',
  clock:  'M12 2A10 10 0 1 0 12 22A10 10 0 1 0 12 2ZM12 5.5L13.4 5.5L13.4 11.4L18 14.1L17.2 15.5L12 12.4Z',
  list:   'M3 5L7 5L7 9L3 9ZM9 6L21 6L21 8L9 8ZM3 11L7 11L7 15L3 15ZM9 12L21 12L21 14L9 14ZM3 17L7 17L7 21L3 21ZM9 18L21 18L21 20L9 20Z',
  grid:   'M3 3L11 3L11 11L3 11ZM13 3L21 3L21 11L13 11ZM3 13L11 13L11 21L3 21ZM13 13L21 13L21 21L13 21Z',
  target: 'M12 2A10 10 0 1 0 12 22A10 10 0 1 0 12 2ZM12 5.5A6.5 6.5 0 1 1 12 18.5A6.5 6.5 0 1 1 12 5.5ZM12 9A3 3 0 1 0 12 15A3 3 0 1 0 12 9Z',
  bolt:   'M13.5 2L4 13.5L11 13.5L10.5 22L20 10.5L13 10.5Z',
  flag:   'M5 2L7 2L7 22L5 22ZM8 3L20 3L17 8L20 13L8 13Z',
  trophy: 'M7 3L17 3L17 5L21 5L21 8A4 4 0 0 1 16.6 11.9A5 5 0 0 1 13 14.8L13 18L16 18L16 21L8 21L8 18L11 18L11 14.8A5 5 0 0 1 7.4 11.9A4 4 0 0 1 3 8L3 5L7 5ZM7 7L5 7L5 8A2 2 0 0 0 7 10ZM17 7L17 10A2 2 0 0 0 19 8L19 7Z',
  pencil: 'M3 17.2L14.9 5.3L18.7 9.1L6.8 21L3 21ZM16.3 3.9L18 2.2L21.8 6L20.1 7.7Z',
  book:   'M4 3L11 3L11 19L4 19ZM13 3L20 3L20 19L13 19ZM3 20L21 20L21 22L3 22Z',
  note:   'M9 3L20 3L20 6L12 6L12 17.5A3.5 3.5 0 1 1 9 14L9 6ZM4 15A3.5 3.5 0 1 1 4 22A3.5 3.5 0 1 1 4 15Z',
  mark:   'M12 2L20.5 12L12 22L3.5 12Z',
};

export const GLYPH_NAMES = Object.keys(GLYPHS);

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

function encodePng(size, pixels) {
  const stride = size * 4;
  const raw = Buffer.alloc(size * (stride + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ---------- path parsing ----------
   Supports M/L/H/V/C/S/Q/T/A/Z in both cases, which is everything the marks
   above use. Curves are flattened to line segments; arcs become polylines. */

function parsePath(d) {
  const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || [];
  const polys = [];
  let cur = [], x = 0, y = 0, sx = 0, sy = 0, cmd = '', px = 0, py = 0, qx = 0, qy = 0;
  let i = 0;
  const num = () => parseFloat(tokens[i++]);
  const close = () => { if (cur.length > 2) polys.push(cur); cur = []; };
  const moveTo = (nx, ny) => { close(); x = sx = nx; y = sy = ny; cur = [[x, y]]; };
  const lineTo = (nx, ny) => { x = nx; y = ny; cur.push([x, y]); };

  const cubic = (x1, y1, x2, y2, x3, y3) => {
    const n = 18;
    for (let t = 1; t <= n; t++) {
      const u = t / n, m = 1 - u;
      cur.push([
        m * m * m * x + 3 * m * m * u * x1 + 3 * m * u * u * x2 + u * u * u * x3,
        m * m * m * y + 3 * m * m * u * y1 + 3 * m * u * u * y2 + u * u * u * y3,
      ]);
    }
    px = x2; py = y2; x = x3; y = y3;
  };
  const quad = (x1, y1, x2, y2) =>
    cubic(x + (2 / 3) * (x1 - x), y + (2 / 3) * (y1 - y),
          x2 + (2 / 3) * (x1 - x2), y2 + (2 / 3) * (y1 - y2), x2, y2);

  // Endpoint-parameterised arc, per the SVG implementation notes.
  const arc = (rx, ry, rot, large, sweep, ex, ey) => {
    if (!rx || !ry) return lineTo(ex, ey);
    const phi = (rot * Math.PI) / 180, cp = Math.cos(phi), sp = Math.sin(phi);
    const dx2 = (x - ex) / 2, dy2 = (y - ey) / 2;
    const x1 = cp * dx2 + sp * dy2, y1 = -sp * dx2 + cp * dy2;
    rx = Math.abs(rx); ry = Math.abs(ry);
    const lam = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
    if (lam > 1) { const s = Math.sqrt(lam); rx *= s; ry *= s; }
    const sign = large === sweep ? -1 : 1;
    const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
    const co = den ? sign * Math.sqrt(Math.max(0, (rx * rx * ry * ry - den) / den)) : 0;
    const cx1 = (co * rx * y1) / ry, cy1 = (-co * ry * x1) / rx;
    const cx = cp * cx1 - sp * cy1 + (x + ex) / 2, cy = sp * cx1 + cp * cy1 + (y + ey) / 2;
    const ang = (ux, uy, vx, vy) => {
      const d = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy));
      let a = Math.acos(Math.min(1, Math.max(-1, (ux * vx + uy * vy) / d)));
      return ux * vy - uy * vx < 0 ? -a : a;
    };
    const t1 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
    let dt = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
    if (!sweep && dt > 0) dt -= 2 * Math.PI;
    if (sweep && dt < 0) dt += 2 * Math.PI;
    const n = Math.max(6, Math.ceil(Math.abs(dt) / 0.2));
    for (let k = 1; k <= n; k++) {
      const t = t1 + (dt * k) / n;
      cur.push([cp * rx * Math.cos(t) - sp * ry * Math.sin(t) + cx,
                sp * rx * Math.cos(t) + cp * ry * Math.sin(t) + cy]);
    }
    x = ex; y = ey;
  };

  while (i < tokens.length) {
    const tk = tokens[i];
    if (/[A-Za-z]/.test(tk)) { cmd = tk; i++; }
    else if (cmd === 'M') cmd = 'L';
    else if (cmd === 'm') cmd = 'l';
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    switch (cmd.toUpperCase()) {
      case 'M': moveTo(num() + ox, num() + oy); break;
      case 'L': lineTo(num() + ox, num() + oy); break;
      case 'H': lineTo(num() + ox, y); break;
      case 'V': lineTo(x, num() + oy); break;
      case 'C': cubic(num() + ox, num() + oy, num() + ox, num() + oy, num() + ox, num() + oy); break;
      case 'S': cubic(2 * x - px, 2 * y - py, num() + ox, num() + oy, num() + ox, num() + oy); break;
      case 'Q': { const a = num() + ox, b = num() + oy; qx = a; qy = b; quad(a, b, num() + ox, num() + oy); break; }
      case 'T': { const a = 2 * x - qx, b = 2 * y - qy; qx = a; qy = b; quad(a, b, num() + ox, num() + oy); break; }
      case 'A': arc(num(), num(), num(), num(), num(), num() + ox, num() + oy); break;
      case 'Z': if (cur.length) { cur.push([sx, sy]); close(); } x = sx; y = sy; break;
      default: i++; // unknown command: skip a token so we cannot spin
    }
  }
  close();
  return polys;
}

// Even-odd coverage of one scanline sample against the flattened polygons.
function crossings(polys, py) {
  const xs = [];
  for (const poly of polys) {
    for (let k = 0; k < poly.length - 1; k++) {
      const [ax, ay] = poly[k], [bx, by] = poly[k + 1];
      if (ay === by) continue;
      if ((py >= ay && py < by) || (py >= by && py < ay)) {
        xs.push(ax + ((py - ay) / (by - ay)) * (bx - ax));
      }
    }
  }
  return xs.sort((a, b) => a - b);
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

// Hues are picked from a fixed wheel rather than hash % 360 so that no app
// lands on the muddy yellow-green band, and neighbouring slugs stay distinct.
const HUES = [222, 258, 292, 330, 352, 14, 32, 174, 196, 208];

// The one hue an app is identified by. The icon, the theme colour and the UI
// kit's accent all read it, so a game looks like its own icon without anyone
// choosing a colour by hand.
export function hueFor(slug) {
  return HUES[hash(slug) % HUES.length];
}

export function themeColor(slug) {
  const [r, g, b] = hslToRgb(hueFor(slug), 0.5, 0.32);
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

/* ---------- render ---------- */

const MASTER = 512;
const SS = 2;                 // supersampling per axis on the master only

function roundedTile(x, y, r) {
  const ax = Math.abs(x), ay = Math.abs(y), k = 1 - r;
  if (ax > 1 || ay > 1) return false;
  if (ax <= k || ay <= k) return true;
  const dx = ax - k, dy = ay - k;
  return dx * dx + dy * dy <= r * r;
}

// An icon is fully determined by its glyph, its hue and whether it is maskable
// — never by the slug itself. Memoising on that key makes the cost of a build
// scale with the VARIETY of icons (at most GLYPH_NAMES x HUES x 2) rather than
// with the number of apps, which is what matters at a few hundred games.
const masterCache = new Map();

function renderMaster(slug, glyph, maskable) {
  const key = (GLYPHS[glyph] ? glyph : 'mark') + '|' + (hash(slug) % HUES.length) + '|' + (maskable ? 1 : 0);
  const hit = masterCache.get(key);
  if (hit) return hit;
  const built = buildMaster(slug, glyph, maskable);
  masterCache.set(key, built);
  return built;
}

function buildMaster(slug, glyph, maskable) {
  const h = hash(slug);
  const bg = hslToRgb(HUES[h % HUES.length], 0.5, 0.32);
  const fg = hslToRgb(HUES[h % HUES.length], 0.55, 0.95);
  const polys = parsePath(GLYPHS[glyph] || GLYPHS.mark);

  // A maskable icon is cropped to a circle by the launcher, so the tile bleeds
  // to the edges and the mark is drawn smaller to stay inside the safe zone.
  const radius = maskable ? 0 : 0.26;
  const inset = maskable ? 1 : 0.94;
  const glyphSpan = maskable ? 0.46 : 0.62;   // half-width of the mark, 0..1

  const size = MASTER;
  const px = Buffer.alloc(size * size * 4);
  const scale = (glyphSpan * size) / 12;      // the 24-unit grid, centred
  const cx = size / 2, cy = size / 2;

  // Precompute glyph crossings per subsample row: the expensive part is the
  // edge walk, and it is identical for every pixel in a row.
  const rows = size * SS;
  const rowXs = new Array(rows);
  for (let r = 0; r < rows; r++) {
    const gy = ((r + 0.5) / SS - cy) / scale + 12;
    rowXs[r] = crossings(polys, gy);
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let tile = 0, mark = 0;
      for (let sy = 0; sy < SS; sy++) {
        const r = y * SS + sy;
        const xs = rowXs[r];
        const v = ((y + (sy + 0.5) / SS) / size) * 2 - 1;
        for (let sx = 0; sx < SS; sx++) {
          const u = ((x + (sx + 0.5) / SS) / size) * 2 - 1;
          if (radius ? roundedTile(u / inset, v / inset, radius) : true) tile++;
          if (xs.length) {
            const gx = ((x + (sx + 0.5) / SS) - cx) / scale + 12;
            let inside = 0;
            for (let k = 0; k < xs.length && xs[k] <= gx; k++) inside ^= 1;
            if (inside) mark++;
          }
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
  return px;
}

// Box filter. The master is 512, so every target divides into a clean window
// and the average is both correct and the antialiasing for the smaller sizes.
function downscale(src, from, to) {
  if (from === to) return src;
  const out = Buffer.alloc(to * to * 4);
  const f = from / to;
  for (let y = 0; y < to; y++) {
    const y0 = Math.floor(y * f), y1 = Math.min(from, Math.ceil((y + 1) * f));
    for (let x = 0; x < to; x++) {
      const x0 = Math.floor(x * f), x1 = Math.min(from, Math.ceil((x + 1) * f));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const p = (sy * from + sx) * 4;
          r += src[p]; g += src[p + 1]; b += src[p + 2]; a += src[p + 3]; n++;
        }
      }
      const p = (y * to + x) * 4;
      out[p] = r / n; out[p + 1] = g / n; out[p + 2] = b / n; out[p + 3] = a / n;
    }
  }
  return out;
}

/**
 * Renders one master per variant and derives every requested size from it.
 * @returns {Map<string, Buffer>} keyed "<size>" and "<size>m" for maskable
 */
export function iconSet(slug, glyph, sizes, maskableSizes = []) {
  const out = new Map();
  const g = GLYPHS[glyph] ? glyph : 'mark';
  const hue = hash(slug) % HUES.length;
  const take = (want, mask, label) => {
    for (const s of want) {
      const key = g + '|' + hue + '|' + (mask ? 1 : 0) + '|' + s;
      let png = pngCache.get(key);
      if (!png) {
        png = encodePng(s, downscale(renderMaster(slug, glyph, mask), MASTER, s));
        pngCache.set(key, png);
      }
      out.set(label(s), png);
    }
  };
  take(sizes, false, (s) => String(s));
  take(maskableSizes, true, (s) => s + 'm');
  return out;
}

const pngCache = new Map();

// Deterministic fallback so an app that names no mark still gets a sensible one.
export function defaultGlyph(slug) {
  return GLYPH_NAMES[hash(slug + '#g') % GLYPH_NAMES.length];
}
