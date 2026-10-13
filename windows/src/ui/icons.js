import { laneColor } from '../theme.js';

/** The wedge-and-circle motif, drawn on a canvas. */
export function drawFanIcon(ctx, w, h, lanes = 4, { inverted = false, t = null } = {}) {
  const fill = inverted ? '#000' : '#fff', line = inverted ? '#fff' : '#000';
  const u = Math.min(w, h) / 100, ax = w / 2, ay = h * 0.68;
  const span = 80 * Math.PI / 180, step = 2 * span / Math.max(1, lanes - 1);
  const pt = (a, r) => [ax + r * Math.sin(a), ay - r * Math.cos(a)];
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (let i = 0; i < lanes - 1; i++) {
    const mid = -span + step * (i + 0.5), hw = step * 0.27;
    const p1 = pt(mid - hw, 62 * u), p2 = pt(mid + hw, 62 * u);
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(...p1); ctx.lineTo(...p2); ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
    ctx.beginPath(); ctx.moveTo(...p1); ctx.lineTo(ax, ay); ctx.lineTo(...p2); ctx.strokeStyle = line; ctx.lineWidth = 4 * u; ctx.stroke();
  }
  for (let i = 0; i < lanes; i++) {
    const a = -span + step * i, ph = t == null ? 0.5 : (t * 0.8 + i * 0.37) % 1, r = (14 + 56 * (1 - ph)) * u, [x, y] = pt(a, r);
    ctx.beginPath(); ctx.arc(x, y, 5 * u, 0, Math.PI * 2); ctx.fillStyle = laneColor(i, lanes); ctx.fill();
  }
  ctx.beginPath(); ctx.roundRect(w * 0.1, ay - 4 * u, w * 0.8, 30 * u, 3 * u); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = line; ctx.lineWidth = 4 * u; ctx.stroke();
  ctx.beginPath(); ctx.arc(ax, ay, 17 * u, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.arc(ax, ay, 5 * u, 0, Math.PI * 2); ctx.fill(); ctx.lineWidth = 3 * u; ctx.stroke();
}

export function fanIconCanvas(size, lanes, opts = {}) {
  const c = document.createElement('canvas'); const d = Math.min(2, window.devicePixelRatio || 1);
  c.width = size * d; c.height = size * d; c.style.width = size + 'px'; c.style.height = size + 'px';
  const ctx = c.getContext('2d'); ctx.scale(d, d); drawFanIcon(ctx, size, size, lanes, opts);
  return c;
}

export function classicIconCanvas(w, h) {
  const c = document.createElement('canvas'); c.width = w * 2; c.height = h * 2; c.style.width = w + 'px'; c.style.height = h + 'px';
  const ctx = c.getContext('2d'); ctx.scale(2, 2);
  const n = 4, lw = w * 0.15, x0 = (w - lw * n) / 2;
  ctx.fillStyle = 'rgba(0,0,0,.92)'; ctx.fillRect(x0, 0, lw * n, h);
  for (let i = 0; i <= n; i++) { ctx.fillStyle = i === 0 || i === n ? '#808080' : 'rgba(255,255,255,.8)'; ctx.fillRect(x0 + lw * i - 0.8, 0, 1.6, h); }
  [0.18, 0.42, 0.3, 0.55].forEach((y, i) => { ctx.fillStyle = laneColor(i, n); ctx.beginPath(); ctx.roundRect(x0 + lw * i + 3, h * y, lw - 6, 9, 4); ctx.fill(); });
  const hy = h * 0.72; ctx.fillStyle = 'rgb(128,153,199)'; ctx.fillRect(x0, hy - 3, lw * n, 6);
  for (let i = 0; i < n; i++) { ctx.fillStyle = Math.min(i, n - 1 - i) % 2 === 0 ? 'rgb(219,194,230)' : 'rgb(194,84,148)'; ctx.fillRect(x0 + lw * i + 1, hy + 3, lw - 2, h - hy); }
  return c;
}
