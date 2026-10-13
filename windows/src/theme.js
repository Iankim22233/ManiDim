import { hsv, rgba, mixRGB, lerp } from './util.js';

export const SKINS = [
  { id: 'original', title: 'Original', blurb: 'The fan with light wedges' },
  { id: 'highContrast', title: 'High Contrast', blurb: 'Black wedges, white outlines' },
];

export function themeFor(skin) {
  if (skin === 'highContrast') {
    return { wedge: '#000', outline: '#fff', box: '#000', ink: '#fff', capTop: '#1f1f1f', capBottom: '#000', capText: '#fff', capShadow: 'rgba(140,140,140,1)' };
  }
  return { wedge: '#fff', outline: '#000', box: '#fff', ink: '#000', capTop: '#fff', capBottom: '#ebebeb', capText: '#000', capShadow: 'rgba(0,0,0,0.85)' };
}

export const BG_PRESETS = [
  { id: 'slate', name: 'Slate', top: [0.50, 0.50, 0.50], bottom: [0.40, 0.40, 0.40] },
  { id: 'midnight', name: 'Midnight', top: [0.11, 0.11, 0.20], bottom: [0.04, 0.04, 0.09] },
  { id: 'sunset', name: 'Sunset', top: [0.98, 0.62, 0.48], bottom: [0.42, 0.22, 0.52] },
  { id: 'ocean', name: 'Ocean', top: [0.23, 0.48, 0.84], bottom: [0.04, 0.16, 0.29] },
  { id: 'forest', name: 'Forest', top: [0.37, 0.64, 0.42], bottom: [0.09, 0.20, 0.12] },
  { id: 'rose', name: 'Rose', top: [0.94, 0.56, 0.69], bottom: [0.42, 0.16, 0.33] },
  { id: 'paper', name: 'Paper', top: [0.95, 0.95, 0.95], bottom: [0.80, 0.80, 0.80] },
  { id: 'black', name: 'Black', top: [0, 0, 0], bottom: [0, 0, 0] },
];
const css = (c) => `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;
export const hexToArr = (hex) => { const v = parseInt(hex.slice(1), 16); return [(v >> 16 & 255) / 255, (v >> 8 & 255) / 255, (v & 255) / 255]; };
export const arrToHex = (a) => '#' + a.map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');

const imageCache = { src: null, img: null };
export function backgroundImage(dataUrl) {
  if (!dataUrl) return null;
  if (imageCache.src !== dataUrl) { const img = new Image(); img.src = dataUrl; imageCache.src = dataUrl; imageCache.img = img; }
  return imageCache.img && imageCache.img.complete && imageCache.img.naturalWidth ? imageCache.img : null;
}

/** Backdrop description for the current settings. */
export function backdropSpec(bg, skin, classic, bgImageData) {
  const flat = (c) => ({ top: c, bottom: c, image: null, dim: 0, decor: false });
  if (bg.mode === 'skin') {
    if (classic) return flat('#000');
    if (skin === 'highContrast') return flat(css([0.47, 0.47, 0.47]));
    return { top: css([0.5, 0.5, 0.5]), bottom: css([0.4, 0.4, 0.4]), image: null, dim: 0, decor: true };
  }
  if (bg.mode === 'preset') {
    const p = BG_PRESETS.find((x) => x.id === bg.preset) || BG_PRESETS[0];
    return { top: css(p.top), bottom: css(p.bottom), image: null, dim: 0, decor: skin === 'original' && !classic };
  }
  if (bg.mode === 'custom') return { top: css(bg.top), bottom: css(bg.bottom), image: null, dim: 0, decor: skin === 'original' && !classic };
  const img = backgroundImage(bgImageData);
  if (img) return { top: '#000', bottom: '#000', image: img, dim: bg.dim, decor: false };
  return backdropSpec({ ...bg, mode: 'skin' }, skin, classic, null);
}

/** Lane colours: magenta → blue → green → red across the fan. */
export function laneHue(i, n) {
  const t = n <= 1 ? 0 : i / (n - 1);
  let h = 0.84 - t * 0.86; if (h < 0) h += 1; return h;
}
const laneCache = new Map();
export function laneRGB(i, n) {
  const k = i * 16 + n;
  let c = laneCache.get(k);
  if (!c) { c = hsv(laneHue(i, n), 0.66, 1); laneCache.set(k, c); }
  return c;
}
export const laneColor = (i, n, a = 1) => rgba(laneRGB(i, n), a);
export const mixLane = (a, b, n, t) => mixRGB(laneRGB(a, n), laneRGB(b, n), t);
export const hueColor = (h, s = 0.6, v = 1, a = 1) => rgba(hsv(h, s, v), a);
