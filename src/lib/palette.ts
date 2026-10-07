// Extracts a poster's colour theme (a dominant and a secondary colour) for the shelf background.
// The poster is drawn into a tiny canvas (24×36 px), so extraction takes well under a millisecond;
// results are cached per URL.
export type RGB = [number, number, number];

export interface Palette {
  primary: RGB;
  secondary: RGB;
}

const cache = new Map<string, Promise<Palette | null>>();
const MAX_CACHE = 400;

export function getPalette(src: string): Promise<Palette | null> {
  if (!src) return Promise.resolve(null);
  let hit = cache.get(src);
  if (!hit) {
    hit = extract(src).catch(() => null); // cross-origin images without CORS can't be read: fall back
    cache.set(src, hit);
    if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value as string);
  }
  return hit;
}

/** Fallback colour theme derived from a title, for posters that can't be sampled. */
export function paletteFromSeed(seed: string): Palette {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return { primary: hslToRgb(h / 360, 0.55, 0.42), secondary: hslToRgb(((h + 40) % 360) / 360, 0.5, 0.32) };
}

export const rgbCss = ([r, g, b]: RGB) => `rgb(${r} ${g} ${b})`;

async function extract(src: string): Promise<Palette | null> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.decoding = 'async';
  img.src = src;
  await img.decode();

  const w = 24;
  const h = 36;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data; // throws if the image is cross-origin tainted

  // Bucket colourful pixels by hue; weight by saturation and mid-lightness so vivid colours win
  const BUCKETS = 12;
  const buckets = Array.from({ length: BUCKETS }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
  let ar = 0, ag = 0, ab = 0, n = 0;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    ar += r; ag += g; ab += b; n++;
    const [hue, s, l] = rgbToHsl(r, g, b);
    if (s < 0.2 || l < 0.1 || l > 0.92) continue;
    const weight = s * (1 - Math.abs(l - 0.5) * 1.4);
    if (weight <= 0) continue;
    const bucket = buckets[Math.min(BUCKETS - 1, Math.floor(hue * BUCKETS))];
    bucket.w += weight;
    bucket.r += r * weight;
    bucket.g += g * weight;
    bucket.b += b * weight;
  }
  if (n === 0) return null;

  const ranked = buckets
    .map((bk, i) => ({ ...bk, i }))
    .filter(bk => bk.w > 0)
    .sort((a, b) => b.w - a.w);

  const toRgb = (bk: { w: number; r: number; g: number; b: number }): RGB =>
    [bk.r / bk.w, bk.g / bk.w, bk.b / bk.w].map(Math.round) as RGB;

  let primary: RGB;
  let secondary: RGB;
  if (ranked.length === 0) {
    // Black-and-white or very muted poster: use its average tone
    primary = [ar / n, ag / n, ab / n].map(Math.round) as RGB;
    secondary = primary;
  } else {
    primary = toRgb(ranked[0]);
    // A clearly different hue that still covers a meaningful part of the poster
    const far = ranked.find(bk => {
      const d = Math.abs(bk.i - ranked[0].i);
      return Math.min(d, BUCKETS - d) >= 2 && bk.w > ranked[0].w * 0.12;
    });
    secondary = far ? toRgb(far) : shift(primary, 0.08);
  }

  return { primary: glow(primary), secondary: glow(secondary, 0.85) };
}

/** Normalises a colour so it reads as a glow: enough saturation, mid lightness. */
function glow([r, g, b]: RGB, lightScale = 1): RGB {
  const [h, s, l] = rgbToHsl(r, g, b);
  const sat = s < 0.08 ? s : Math.min(0.85, Math.max(0.45, s * 1.15));
  const light = Math.min(0.55, Math.max(0.32, l)) * lightScale;
  return hslToRgb(h, sat, light);
}

function shift([r, g, b]: RGB, hueShift: number): RGB {
  const [h, s, l] = rgbToHsl(r, g, b);
  return hslToRgb((h + hueShift) % 1, s, l * 0.75);
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb(h: number, s: number, l: number): RGB {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const conv = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [conv(h + 1 / 3), conv(h), conv(h - 1 / 3)].map(v => Math.round(v * 255)) as RGB;
}
