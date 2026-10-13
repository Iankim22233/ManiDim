// Canvas renderer: fan layout (Original / High Contrast skins), vertical Classic layout, effects, HUD.
import { clamp, lerp, smoothstep, rgba, hsv, mixRGB } from './util.js';
import { themeFor, backdropSpec, laneColor, laneRGB, hueColor } from './theme.js';
import { noteIsHold, noteEnd, EVENT_KINDS, eventLength, eventSeed } from './model.js';
import { RNG } from './util.js';

const FONT = 'Nunito, "Segoe UI Rounded", "Segoe UI", sans-serif';

export class Geo {
  constructor(W, H, n, speed, centerX = 0.5, centerY = 0.62, boxWidthU = null, classic = false) {
    const u = Math.max(0.4, Math.min(H / 800, W / 1180));
    this.W = W; this.H = H; this.u = u; this.n = n; this.classic = classic;
    this.apex = { x: W * centerX, y: H * centerY };
    const span = 80 * Math.PI / 180;
    const step = n > 1 ? 2 * span / (n - 1) : 0;
    const lw = n > 1 ? Math.min(26 * Math.PI / 180, step * 0.5) : 26 * Math.PI / 180;
    this.angles = Array.from({ length: n }, (_, i) => (n === 1 ? 0 : -span + step * i));
    this.laneHalf = lw / 2;
    this.hw = Math.max(0.025, (step - lw) / 2);
    this.laneW = Math.min(84 * u, W * 0.6 / Math.max(1, n));
    this.stageW = this.laneW * n;
    this.stageX = W * centerX - this.stageW / 2;
    this.keysTop = H - 128 * u;
    this.hitY = H - 128 * u;
    this.circleR = 76 * u;
    this.hitR = classic ? 0 : 80 * u;
    this.pps = speed * 62 * u;
    const bw = boxWidthU != null ? boxWidthU * u : Math.min(W * 0.84, 980 * u);
    this.box = { x: this.apex.x - bw / 2, y: this.apex.y - 17 * u, w: bw, h: 190 * u };
    this.maxR = classic ? H - 128 * u + 120 * u
      : Math.hypot(Math.max(this.apex.x, W - this.apex.x), Math.max(this.apex.y, H - this.apex.y)) + 140 * u;
  }
  point(a, r) { return { x: this.apex.x + r * Math.sin(a), y: this.apex.y - r * Math.cos(a) }; }
  tangent(a) { return { dx: Math.cos(a), dy: Math.sin(a) }; }
  radius(dt) { return this.hitR + dt * this.pps; }
  y(dt) { return this.hitY - dt * this.pps; }
  laneX(i) { return this.stageX + this.laneW * (i + 0.5); }
  receptor(lane) {
    const l = clamp(lane, 0, this.n - 1);
    return this.classic ? { x: this.laneX(l), y: this.hitY } : this.point(this.angles[l], this.circleR + 6 * this.u);
  }
  outward(lane) {
    const l = clamp(lane, 0, this.n - 1);
    return this.classic ? { dx: 0, dy: -1 } : { dx: Math.sin(this.angles[l]), dy: -Math.cos(this.angles[l]) };
  }
  visibleLength(a) {
    const dx = Math.sin(a), dy = -Math.cos(a);
    let t = Infinity;
    if (dx > 1e-6) t = Math.min(t, (this.W - this.apex.x) / dx); else if (dx < -1e-6) t = Math.min(t, (0 - this.apex.x) / dx);
    if (dy < -1e-6) t = Math.min(t, (0 - this.apex.y) / dy);
    return Math.max(60, t - this.hitR);
  }
  pathAngle(note, t) {
    let l = note.lane, ang = this.angles[clamp(l, 0, this.n - 1)];
    const tw = 0.07;
    for (const s of note.slides) {
      const nl = clamp(l + s.dir, 0, this.n - 1);
      const w = smoothstep((t - (s.time - tw)) / (2 * tw));
      ang += (this.angles[nl] - this.angles[l]) * w; l = nl;
    }
    return ang;
  }
  pathX(note, t) {
    let l = note.lane, x = this.laneX(clamp(l, 0, this.n - 1));
    const tw = 0.07;
    for (const s of note.slides) {
      const nl = clamp(l + s.dir, 0, this.n - 1);
      const w = smoothstep((t - (s.time - tw)) / (2 * tw));
      x += (this.laneX(nl) - this.laneX(l)) * w; l = nl;
    }
    return x;
  }
  pathColor(note, t) {
    let l = note.lane, rgb = laneRGB(l, this.n);
    const tw = 0.07;
    for (const s of note.slides) {
      const nl = clamp(l + s.dir, 0, this.n - 1);
      const w = smoothstep((t - (s.time - tw)) / (2 * tw));
      if (w > 0) rgb = mixRGB(laneRGB(l, this.n), laneRGB(nl, this.n), w);
      l = nl;
    }
    return rgba(rgb);
  }
}

// ----------------------------------------------------------------------------- helpers
const lg = (ctx, x0, y0, x1, y1, stops) => { const g = ctx.createLinearGradient(x0, y0, x1, y1); for (const [o, c] of stops) g.addColorStop(o, c); return g; };
const rg = (ctx, x, y, r0, r1, stops) => { const g = ctx.createRadialGradient(x, y, r0, x, y, r1); for (const [o, c] of stops) g.addColorStop(o, c); return g; };
function strokePts(ctx, pts, style, width, cap = 'round') {
  ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.strokeStyle = style; ctx.lineWidth = width; ctx.lineCap = cap; ctx.lineJoin = 'round'; ctx.stroke();
}
function segStroke(ctx, a, b, style, width, ext = 1.6) {
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.max(0.001, Math.hypot(dx, dy)), ux = dx / len * ext, uy = dy / len * ext;
  strokePts(ctx, [{ x: a.x - ux, y: a.y - uy }, { x: b.x + ux, y: b.y + uy }], style, width, 'butt');
}
function text(ctx, s, x, y, o) {
  ctx.font = `${o.weight || 900} ${o.size}px ${FONT}`;
  ctx.textAlign = o.align || 'center'; ctx.textBaseline = 'middle';
  const a = ctx.globalAlpha; if (o.alpha != null) ctx.globalAlpha = a * o.alpha;
  ctx.fillStyle = o.color; ctx.fillText(s, x, y);
  ctx.globalAlpha = a;
}
function outlined(ctx, s, x, y, o) {
  ctx.font = `900 ${o.size}px ${FONT}`; ctx.textAlign = o.align || 'center'; ctx.textBaseline = 'middle';
  const a = ctx.globalAlpha; if (o.alpha != null) ctx.globalAlpha = a * o.alpha;
  ctx.lineJoin = 'round'; ctx.lineWidth = o.width * 2; ctx.strokeStyle = o.outline || '#000'; ctx.strokeText(s, x, y);
  ctx.fillStyle = o.color; ctx.fillText(s, x, y);
  ctx.globalAlpha = a;
}
/** Fixed-pitch digits so numbers don't jiggle. */
function monoText(ctx, s, x, y, o) {
  const adv = o.size * 0.62;
  const total = adv * s.length;
  let sx = o.align === 'right' ? x - total : o.align === 'left' ? x : x - total / 2;
  const a = ctx.globalAlpha; ctx.font = `${o.weight || 900} ${o.size}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = o.color; if (o.alpha != null) ctx.globalAlpha = a * o.alpha;
  if (o.outline) { ctx.lineJoin = 'round'; ctx.lineWidth = o.outlineW * 2; ctx.strokeStyle = o.outline; }
  for (let i = 0; i < s.length; i++) { const cx = sx + adv * (i + 0.5); if (o.outline) ctx.strokeText(s[i], cx, y); ctx.fillText(s[i], cx, y); }
  ctx.globalAlpha = a;
}
const circle = (ctx, x, y, r) => { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); };
const rrect = (ctx, x, y, w, h, r) => { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); };

export function visAlpha(v, p) {
  switch (v) {
    case 'blackout': return 0;
    case 'blindSpot': return smoothstep((p - 0.42) / 0.16);
    case 'blindSpot2': return 1 - smoothstep((p - 0.28) / 0.37);
    default: return 1;
  }
}
const fanAlpha = (geo, rs, angle, t) => {
  if (rs.visibility === 'none') return 1;
  const r = geo.radius(t - rs.time);
  return visAlpha(rs.visibility, (r - geo.hitR) / geo.visibleLength(angle));
};
const classicAlpha = (geo, rs, y) => rs.visibility === 'none' ? 1 : visAlpha(rs.visibility, (geo.hitY - y) / Math.max(1, geo.hitY));

// ----------------------------------------------------------------------------- main
export function drawGame(ctx, W, H, rs) {
  const eng = rs.engine, fx = rs.fx;
  const theme = themeFor(rs.settings.skin);
  const geo = new Geo(W, H, eng.laneCount, rs.settings.scrollSpeed, rs.centerX ?? 0.5, 0.62, rs.ambient ? 560 : null, rs.classic);
  const u = geo.u;
  fx.begin(rs.wall);
  fx.consume(geo, rs.wall, rs.settings.particles, rs.settings.screenShake);

  const spb = 60 / Math.max(40, rs.bpm);
  const beatPos = (rs.time - rs.offset) / spb;
  const frac = beatPos - Math.floor(beatPos);
  const pulse = rs.settings.beatPulse ? Math.exp(-frac * 4.5) : 0;

  const spec = backdropSpec(rs.settings.background, rs.settings.skin, rs.classic, rs.bgImage);
  drawBackdrop(ctx, W, H, geo.apex, u, spec, rs.hue, rs.wall, pulse, fx.flash, fx.flashColor);

  ctx.save();
  if (fx.shake > 0.01) ctx.translate((Math.random() * 2 - 1) * fx.shake * u, (Math.random() * 2 - 1) * fx.shake * u);
  const fxOn = rs.settings.chartEffects && rs.events && rs.events.length && !rs.ambient;
  if (fxOn) { const sh = chartShake(rs.events, rs.time, u); ctx.translate(sh.x, sh.y); }

  if (geo.classic) drawClassic(ctx, geo, theme, rs, beatPos);
  else {
    drawLanes(ctx, geo, theme, rs, beatPos);
    drawNotes(ctx, geo, rs);
    drawBase(ctx, geo, theme, rs, pulse);
    drawNeedle(ctx, geo, theme, rs);
    drawEffects(ctx, geo, rs);
  }
  if (fxOn) drawChartFX(ctx, W, H, geo.classic ? { x: geo.stageX + geo.stageW / 2, y: geo.hitY } : geo.apex, u, rs.events, rs.time);
  if (rs.showHUD && !rs.ambient) drawTopHUD(ctx, W, H, geo, rs);
  ctx.restore();
}

export function drawBackdrop(ctx, W, H, apex, u, spec, hue, wall, pulse = 0, flash = 0, flashColor = '#fff') {
  if (spec.image) {
    const img = spec.image, sc = Math.max(W / img.naturalWidth, H / img.naturalHeight);
    const w = img.naturalWidth * sc, h = img.naturalHeight * sc;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
    ctx.fillStyle = `rgba(0,0,0,${spec.dim})`; ctx.fillRect(0, 0, W, H);
  } else {
    ctx.fillStyle = lg(ctx, 0, 0, 0, H, [[0, spec.top], [1, spec.bottom]]);
    ctx.fillRect(0, 0, W, H);
  }
  if (spec.decor) {
    for (let i = 0; i < 6; i++) {
      const x = W * (0.5 + 0.45 * Math.sin(wall * 0.07 + i * 1.9)), y = H * (0.4 + 0.35 * Math.cos(wall * 0.05 + i * 2.3));
      const r = u * (180 + 90 * (i % 3));
      const c = hsv(hue + i * 0.09, 0.55, 1);
      ctx.fillStyle = rg(ctx, x, y, 0, r, [[0, rgba(c, 0.13 + 0.03 * pulse)], [1, rgba(c, 0)]]);
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }
  if (flash > 0.001) { ctx.globalAlpha = flash * 0.3; ctx.fillStyle = flashColor; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
  if (spec.decor || spec.image) {
    ctx.fillStyle = rg(ctx, apex.x, apex.y, H * 0.35, Math.max(W, H) * 0.85, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.32)']]);
    ctx.fillRect(0, 0, W, H);
  }
}

// ----------------------------------------------------------------------------- fan: lanes
function drawLanes(ctx, geo, theme, rs, beatPos) {
  const u = geo.u, n = geo.n, far = geo.maxR * 1.6;
  for (let i = 0; i < n; i++) {
    const g = rs.fx.laneGlow[i]; if (g <= 0.01) continue;
    const a = geo.angles[i];
    const p1 = geo.point(a - geo.laneHalf * 1.02, far), p2 = geo.point(a + geo.laneHalf * 1.02, far), e = geo.point(a, 1000 * u);
    ctx.beginPath(); ctx.moveTo(geo.apex.x, geo.apex.y); ctx.lineTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.closePath();
    ctx.fillStyle = lg(ctx, geo.apex.x, geo.apex.y, e.x, e.y, [[0, laneColor(i, n, 0.75 * g)], [1, laneColor(i, n, 0)]]);
    ctx.fill();
  }
  // beat / bar arcs
  const spb = 60 / Math.max(40, rs.bpm);
  let k = Math.max(0, Math.floor(beatPos));
  const k0 = k;
  for (;;) {
    const tk = rs.offset + k * spb;
    const r = geo.radius(tk - rs.time);
    if (r > geo.maxR) break;
    if (r > geo.circleR) {
      const bar = k % 4 === 0;
      const lo = geo.angles[0] - 0.28, hi = geo.angles[n - 1] + 0.28;
      const fade = clamp((geo.maxR - r) / (geo.maxR * 0.4), 0, 1);
      ctx.beginPath();
      for (let s = 0; s <= 28; s++) { const p = geo.point(lerp(lo, hi, s / 28), r); if (s === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); }
      ctx.strokeStyle = `rgba(255,255,255,${(bar ? 0.34 : 0.14) * fade})`; ctx.lineWidth = (bar ? 5 : 3) * u; ctx.lineCap = 'round'; ctx.stroke();
    }
    k++; if (k > k0 + 80) break;
  }
  // wedges running off to infinity
  for (let i = 0; i < n - 1; i++) {
    const mid = (geo.angles[i] + geo.angles[i + 1]) / 2;
    const l = geo.point(mid - geo.hw, far), r = geo.point(mid + geo.hw, far);
    ctx.beginPath(); ctx.moveTo(geo.apex.x, geo.apex.y); ctx.lineTo(l.x, l.y); ctx.lineTo(r.x, r.y); ctx.closePath();
    ctx.fillStyle = theme.wedge; ctx.fill();
    ctx.beginPath(); ctx.moveTo(l.x, l.y); ctx.lineTo(geo.apex.x, geo.apex.y); ctx.lineTo(r.x, r.y);
    ctx.strokeStyle = theme.outline; ctx.lineWidth = 9 * u; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
  }
}

// ----------------------------------------------------------------------------- fan: notes
function drawNotes(ctx, geo, rs) {
  const eng = rs.engine, t = rs.time;
  const horizon = (geo.maxR - geo.hitR) / geo.pps + 0.2;
  const holds = [], taps = [];
  for (const rn of eng.notes) {
    const nt = rn.note;
    if (nt.time - t > horizon) break;
    if (noteEnd(nt) - t < -0.7) continue;
    if (rn.state === 'done') continue;
    if ((rn.state === 'missed' || rn.state === 'dropped') && t - rn.changedAt > 0.5) continue;
    (noteIsHold(nt) ? holds : taps).push(rn);
  }
  for (const rn of holds) drawHold(ctx, geo, rs, rn);
  for (const rn of taps) drawTap(ctx, geo, rs, rn);
}

function tapBar(ctx, geo, angle, r, color, alpha, gray = false) {
  if (r >= geo.maxR || alpha <= 0.003) return;
  const u = geo.u, c = geo.point(angle, r), T = geo.tangent(angle);
  const len = clamp(2 * Math.max(r, 40 * u) * Math.sin(geo.laneHalf) * 0.92, 74 * u, 150 * u);
  const p1 = { x: c.x - T.dx * len / 2, y: c.y - T.dy * len / 2 }, p2 = { x: c.x + T.dx * len / 2, y: c.y + T.dy * len / 2 };
  const a = ctx.globalAlpha; ctx.globalAlpha = a * alpha;
  const col = gray ? 'rgb(140,140,140)' : color;
  strokePts(ctx, [p1, p2], gray ? 'rgba(140,140,140,0.28)' : color.replace(/[\d.]+\)$/, '0.28)'), 44 * u);
  strokePts(ctx, [p1, p2], lg(ctx, p1.x, p1.y, p2.x, p2.y, [[0, gray ? 'rgba(255,255,255,0.8)' : '#fff'], [1, col]]), 27 * u);
  strokePts(ctx, [{ x: p1.x + T.dx * 8 * u, y: p1.y + T.dy * 8 * u - 6 * u }, { x: p2.x - T.dx * 14 * u, y: p2.y - T.dy * 14 * u - 6 * u }], 'rgba(255,255,255,0.35)', 4 * u);
  ctx.globalAlpha = a;
}

function drawTap(ctx, geo, rs, rn) {
  const nt = rn.note, a = geo.angles[nt.lane], r = geo.radius(nt.time - rs.time);
  if (rn.state === 'missed') {
    const age = rs.time - rn.changedAt;
    tapBar(ctx, geo, a, r, 'rgb(140,140,140)', Math.max(0, 0.6 - age * 1.2) * fanAlpha(geo, rs, a, nt.time), true);
  } else {
    const approach = clamp((geo.maxR - r) / (120 * geo.u), 0, 1);
    tapBar(ctx, geo, a, r, laneColor(nt.lane, geo.n), approach * fanAlpha(geo, rs, a, nt.time));
  }
}

function chevron(ctx, geo, angle, r, dir, dead, wall, alpha) {
  const u = geo.u, c = geo.point(angle, r), T = geo.tangent(angle), N = { dx: Math.sin(angle), dy: -Math.cos(angle) };
  const d = dir, s = u * (1 + 0.08 * Math.sin(wall * 10));
  const pt = (al, ac) => ({ x: c.x + T.dx * al * d * s + N.dx * ac * s, y: c.y + T.dy * al * d * s + N.dy * ac * s });
  const pts = [pt(26, 0), pt(-6, 24), pt(-6, 9), pt(-24, 9), pt(-24, -9), pt(-6, -9), pt(-6, -24)];
  const a = ctx.globalAlpha; ctx.globalAlpha = a * alpha;
  ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath();
  ctx.fillStyle = dead ? 'rgb(204,204,204)' : '#fff'; ctx.fill();
  ctx.strokeStyle = '#000'; ctx.lineWidth = 4 * u; ctx.lineJoin = 'round'; ctx.stroke();
  ctx.globalAlpha = a;
}

function drawHold(ctx, geo, rs, rn) {
  const u = geo.u, nt = rn.note, t = rs.time;
  const holdingNow = rn.state === 'holding', dead = rn.state === 'missed' || rn.state === 'dropped';
  const tStart = holdingNow ? Math.max(t, nt.time) : nt.time;
  const maxT = t + (geo.maxR + 100 * u - geo.hitR) / geo.pps;
  const tEnd = Math.min(noteEnd(nt), maxT);
  if (tEnd <= tStart) return;
  const times = [tStart];
  const vis = rs.visibility !== 'none';
  if (nt.slides.length || vis) {
    const step = Math.max(0.008, (vis ? 5 : 10) / geo.pps);
    for (let s = tStart + step; s < tEnd; s += step) times.push(s);
  }
  times.push(tEnd);
  const pts = times.map((s) => geo.point(geo.pathAngle(nt, s), geo.radius(s - t)));
  const baseColor = dead ? 'rgb(153,153,153)' : laneColor(nt.lane, geo.n);
  const baseAlpha = dead ? Math.max(0, 0.55 - (t - rn.changedAt) * 1.1) : 1;
  const pulse = holdingNow ? 0.8 + 0.2 * Math.sin(rs.wall * 22) : 1;
  const A = ctx.globalAlpha;
  ctx.globalAlpha = A * baseAlpha;

  if (vis) {
    for (let i = 0; i < pts.length - 1; i++) {
      const mid = (times[i] + times[i + 1]) / 2;
      const va = fanAlpha(geo, rs, geo.pathAngle(nt, mid), mid);
      if (va < 0.01) continue;
      const col = dead ? 'rgb(153,153,153)' : geo.pathColor(nt, mid);
      ctx.globalAlpha = A * baseAlpha * va;
      segStroke(ctx, pts[i], pts[i + 1], col.replace(/[\d.]+\)$/, `${holdingNow ? 0.42 : 0.24})`), (holdingNow ? 52 : 44) * u);
      segStroke(ctx, pts[i], pts[i + 1], col, 24 * u * pulse);
      segStroke(ctx, pts[i], pts[i + 1], 'rgba(255,255,255,0.5)', 5 * u);
    }
    ctx.globalAlpha = A * baseAlpha;
  } else {
    strokePts(ctx, pts, baseColor.replace(/[\d.]+\)$/, `${holdingNow ? 0.42 : 0.24})`), (holdingNow ? 52 : 44) * u);
    if (!nt.slides.length) {
      const far = laneColor(Math.min(nt.lane + 1, geo.n - 1), geo.n);
      const end = dead ? 'rgb(179,179,179)' : (nt.lane === geo.n - 1 ? laneColor(Math.max(nt.lane - 1, 0), geo.n) : far);
      strokePts(ctx, pts, lg(ctx, pts[0].x, pts[0].y, pts[pts.length - 1].x, pts[pts.length - 1].y, [[0, baseColor], [1, end]]), 24 * u * pulse);
    } else {
      for (let i = 0; i < pts.length - 1; i++) {
        const col = dead ? 'rgb(153,153,153)' : geo.pathColor(nt, (times[i] + times[i + 1]) / 2);
        strokePts(ctx, [pts[i], pts[i + 1]], col, 24 * u * pulse);
      }
    }
    strokePts(ctx, pts, 'rgba(255,255,255,0.5)', 5 * u);
  }

  if (rn.state === 'waiting' || dead) {
    const a = geo.pathAngle(nt, nt.time), r = geo.radius(nt.time - t);
    tapBar(ctx, geo, a, r, baseColor, fanAlpha(geo, rs, a, nt.time), dead);
  }
  if (noteEnd(nt) <= maxT) {
    const a = geo.pathAngle(nt, noteEnd(nt)), r = geo.radius(noteEnd(nt) - t);
    if (r > geo.circleR * 0.8) {
      const c = geo.point(a, r), col = dead ? 'rgb(153,153,153)' : geo.pathColor(nt, noteEnd(nt));
      ctx.globalAlpha = A * baseAlpha * fanAlpha(geo, rs, a, noteEnd(nt));
      circle(ctx, c.x, c.y, 15 * u); ctx.fillStyle = '#fff'; ctx.fill();
      ctx.strokeStyle = col; ctx.lineWidth = 7 * u; ctx.stroke();
      ctx.globalAlpha = A * baseAlpha;
    }
  }
  let l = nt.lane;
  nt.slides.forEach((s, i) => {
    const nl = clamp(l + s.dir, 0, geo.n - 1);
    const from = l; l = nl;
    if (rn.nextSlide > i && !dead) return;
    const r = geo.radius(s.time - t);
    if (r < geo.circleR * 0.9 || r > geo.maxR) return;
    const a = (geo.angles[from] + geo.angles[nl]) / 2;
    chevron(ctx, geo, a, r, s.dir, dead, rs.wall, fanAlpha(geo, rs, a, s.time));
  });
  ctx.globalAlpha = A;
}

// ----------------------------------------------------------------------------- fan: base, circle, HUD
function drawBase(ctx, geo, theme, rs, pulse) {
  const u = geo.u, eng = rs.engine, fx = rs.fx, box = geo.box;
  ctx.fillStyle = 'rgba(0,0,0,0.25)'; rrect(ctx, box.x, box.y + 10 * u, box.w, box.h, 8 * u); ctx.fill();
  rrect(ctx, box.x, box.y, box.w, box.h, 8 * u); ctx.fillStyle = theme.box; ctx.fill();
  ctx.strokeStyle = theme.outline; ctx.lineWidth = 9 * u; ctx.lineJoin = 'round'; ctx.stroke();

  for (let i = 0; i < geo.n; i++) {
    const press = fx.capPress[i]; if (press <= 0.01) continue;
    const p = geo.point(geo.angles[i], geo.circleR * (1 + 0.04 * pulse)), rad = (7 + 7 * press) * u;
    ctx.fillStyle = rg(ctx, p.x, p.y, 0, rad * 2.2, [[0, laneColor(i, geo.n, 0.8 * press)], [1, laneColor(i, geo.n, 0)]]);
    ctx.fillRect(p.x - rad * 2.2, p.y - rad * 2.2, rad * 4.4, rad * 4.4);
  }
  const cr = geo.circleR * (1 + 0.035 * pulse);
  circle(ctx, geo.apex.x, geo.apex.y, cr); ctx.fillStyle = theme.box; ctx.fill();
  if (fx.circleFlash > 0.01) {
    ctx.save(); ctx.globalAlpha = 0.75 * fx.circleFlash;
    ctx.fillStyle = rg(ctx, geo.apex.x, geo.apex.y, cr * 0.2, cr, [[0, 'rgba(255,255,255,0)'], [1, fx.circleColor]]);
    circle(ctx, geo.apex.x, geo.apex.y, cr); ctx.fill(); ctx.restore();
  }
  circle(ctx, geo.apex.x, geo.apex.y, cr); ctx.strokeStyle = theme.outline; ctx.lineWidth = 11 * u; ctx.stroke();

  for (let i = 0; i < geo.n; i++) {
    const p = geo.point(geo.angles[i], cr), press = fx.capPress[i], rad = (6.5 + 4 * press) * u;
    circle(ctx, p.x, p.y, rad); ctx.fillStyle = press > 0.5 ? '#fff' : laneColor(i, geo.n); ctx.fill();
    ctx.strokeStyle = theme.outline; ctx.lineWidth = 3 * u; ctx.stroke();
  }
  if (rs.ambient) { drawInnerDot(ctx, geo, theme); return; }

  const n = geo.n, capW = Math.min(66 * u, box.w * 0.55 / n), gap = 10 * u, totalW = capW * n + gap * (n - 1);
  const capY = geo.apex.y + 100 * u, capH = 50 * u;
  for (let i = 0; i < n; i++) {
    const x = geo.apex.x - totalW / 2 + i * (capW + gap), press = fx.capPress[i], y = capY + 5 * u * press;
    const col = laneColor(i, n);
    rrect(ctx, x, y + 5 * u * (1 - press), capW, capH, 10 * u); ctx.fillStyle = theme.capShadow; ctx.fill();
    rrect(ctx, x, y, capW, capH, 10 * u);
    ctx.fillStyle = lg(ctx, x, y, x, y + capH, [[0, press > 0.3 ? col : theme.capTop], [1, press > 0.3 ? col : theme.capBottom]]); ctx.fill();
    ctx.strokeStyle = theme.outline; ctx.lineWidth = 4 * u; ctx.stroke();
    const lab = rs.keyLabels[i] || '';
    text(ctx, lab, x + capW / 2, y + capH / 2 + 1, { size: (lab.length > 2 ? 14 : 24) * u, color: press > 0.3 ? '#000' : theme.capText });
  }
  const slideW = 92 * u;
  [['◀', true], ['▶', false]].forEach(([g, left]) => {
    const x = left ? geo.apex.x - totalW / 2 - gap * 2 - slideW : geo.apex.x + totalW / 2 + gap * 2;
    const press = left ? fx.slideLeftPress : fx.slideRightPress, y = capY + 5 * u * press;
    rrect(ctx, x, y + 5 * u * (1 - press), slideW, capH, 10 * u); ctx.fillStyle = theme.capShadow; ctx.fill();
    rrect(ctx, x, y, slideW, capH, 10 * u); ctx.fillStyle = press > 0.2 ? 'rgb(140,217,255)' : theme.capTop; ctx.fill();
    ctx.strokeStyle = theme.outline; ctx.lineWidth = 4 * u; ctx.stroke();
    const lab = left ? rs.keyLabels[n] : rs.keyLabels[n + 1];
    text(ctx, `${g} ${lab || ''}`, x + slideW / 2, y + capH / 2 + 1, { size: 15 * u, color: press > 0.2 ? '#000' : theme.capText });
  });

  const lx = geo.apex.x - box.w * 0.27, rx = geo.apex.x + box.w * 0.27;
  text(ctx, `SCORE   ${(eng.accuracy * 100).toFixed(2)}%`, lx, box.y + 36 * u, { size: 15 * u, color: theme.ink, alpha: 0.45 });
  monoText(ctx, String(Math.round(eng.score * rs.scoreMult)).padStart(7, '0'), lx, box.y + 88 * u, { size: 52 * u, color: theme.ink });
  const comboScale = 1 + 0.32 * Math.exp(-(rs.wall - fx.comboBorn) * 14);
  text(ctx, `COMBO   MAX ${eng.maxCombo}`, rx, box.y + 36 * u, { size: 15 * u, color: theme.ink, alpha: 0.45 });
  ctx.save(); ctx.translate(rx, box.y + 90 * u); ctx.scale(comboScale, comboScale);
  monoText(ctx, String(eng.combo), 0, 0, { size: 60 * u, color: eng.combo >= 50 ? '#f25a8c' : theme.ink });
  ctx.restore();
  drawInnerDot(ctx, geo, theme);
}

function drawInnerDot(ctx, geo, theme) {
  const u = geo.u;
  circle(ctx, geo.apex.x, geo.apex.y, 18 * u); ctx.fillStyle = theme.box; ctx.fill();
  ctx.strokeStyle = theme.outline; ctx.lineWidth = 9 * u; ctx.stroke();
}

function drawNeedle(ctx, geo, theme, rs) {
  const fx = rs.fx, dt = fx.frameDT;
  let target = null;
  if (rs.engine.holding.length) target = geo.pathAngle(rs.engine.notes[rs.engine.holding[0]].note, rs.time);
  if (target != null) {
    if (fx.needleAlpha < 0.05) fx.needleAngle = target;
    fx.needleAngle += (target - fx.needleAngle) * Math.min(1, dt * 16);
    fx.needleAlpha = Math.min(1, fx.needleAlpha + dt * 8);
  } else fx.needleAlpha = Math.max(0, fx.needleAlpha - dt * 6);
  if (fx.needleAlpha <= 0.01) return;
  const u = geo.u, a = fx.needleAngle, tip = geo.point(a, geo.circleR * 1.12), tail = geo.point(a + Math.PI, geo.circleR * 1.12);
  const N = { dx: Math.cos(a), dy: Math.sin(a) }, w = 13 * u;
  ctx.save(); ctx.globalAlpha = fx.needleAlpha;
  ctx.beginPath(); ctx.moveTo(tip.x, tip.y); ctx.lineTo(tail.x + N.dx * w, tail.y + N.dy * w); ctx.lineTo(tail.x - N.dx * w, tail.y - N.dy * w); ctx.closePath();
  ctx.fillStyle = lg(ctx, tip.x, tip.y, tail.x, tail.y, [[0, 'rgb(224,242,255)'], [1, 'rgb(140,191,255)']]); ctx.fill();
  ctx.strokeStyle = '#000'; ctx.lineWidth = 3.5 * u; ctx.lineJoin = 'round'; ctx.stroke();
  drawInnerDot(ctx, geo, theme);
  ctx.restore();
}

function emitHoldSparks(geo, rs) {
  const fx = rs.fx;
  if (!rs.settings.particles || !rs.engine.holding.length) return;
  fx.holdEmit += fx.frameDT * 70;
  while (fx.holdEmit >= 1) {
    fx.holdEmit -= 1;
    const nt = rs.engine.notes[rs.engine.holding[0]].note;
    let l = nt.lane; for (const s of nt.slides) if (s.time <= rs.time) l = clamp(l + s.dir, 0, geo.n - 1);
    fx.burst(geo, l, l, 1);
  }
}

function drawParticles(ctx, fx) {
  if (!fx.particles.length) return;
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (const p of fx.particles) {
    const k = p.life / p.maxLife, s = p.size * (0.4 + 0.6 * k);
    ctx.globalAlpha = k; ctx.fillStyle = p.color; circle(ctx, p.x, p.y, s); ctx.fill();
  }
  ctx.restore();
}

function drawPop(ctx, fx, wall, bx, by, u) {
  const pop = fx.pop; if (!pop) return;
  const age = wall - pop.born; if (age >= 0.7) return;
  const scale = 1 + 0.35 * Math.exp(-age * 18), alpha = age < 0.45 ? 1 : Math.max(0, 1 - (age - 0.45) / 0.25);
  ctx.save(); ctx.translate(bx, by - 6 * u * Math.min(1, age * 5)); ctx.scale(scale, scale);
  outlined(ctx, pop.text, 0, 0, { size: 44 * u, color: pop.color, width: 3.2 * u, alpha });
  if (pop.early) text(ctx, pop.early < 0 ? 'EARLY' : 'LATE', 0, 36 * u, { size: 15 * u, color: pop.early < 0 ? 'rgb(140,217,255)' : 'rgb(255,179,102)', alpha });
  ctx.restore();
}

function drawEffects(ctx, geo, rs) {
  const u = geo.u, fx = rs.fx, wall = rs.wall;
  emitHoldSparks(geo, rs);
  for (const ring of fx.rings) {
    const age = (wall - ring.born) / 0.5; if (age >= 1) continue;
    const e = 1 - Math.pow(1 - age, 3), r = geo.circleR + (ring.big ? 110 : 70) * u * e;
    ctx.globalAlpha = (1 - age) * 0.8; circle(ctx, geo.apex.x, geo.apex.y, r);
    ctx.strokeStyle = ring.color; ctx.lineWidth = Math.max(1, (ring.big ? 10 : 6) * u * (1 - age)); ctx.stroke(); ctx.globalAlpha = 1;
  }
  for (const b of fx.slideBursts) {
    const age = (wall - b.born) / 0.5; if (age >= 1 || b.lane >= geo.n) continue;
    const a0 = geo.angles[b.lane] - b.dir * 0.5 * (1 - age);
    ctx.beginPath();
    for (let s = 0; s <= 10; s++) { const p = geo.point(a0 - b.dir * s * 0.05, geo.circleR + 12 * u + 20 * u * age); if (s === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); }
    ctx.strokeStyle = `rgba(255,255,255,${(1 - age) * 0.9})`; ctx.lineWidth = 9 * u * (1 - age); ctx.lineCap = 'round'; ctx.stroke();
  }
  drawParticles(ctx, fx);
  drawPop(ctx, fx, wall, geo.apex.x, geo.apex.y - geo.circleR - 120 * u, u);
}

function drawTopHUD(ctx, W, H, geo, rs) {
  const u = geo.u, m = 26 * u;
  outlined(ctx, rs.title, m, 62 * u, { size: 26 * u, color: '#fff', width: 2.2 * u, align: 'left' });
  outlined(ctx, `${rs.artist}  ·  ${rs.chartName}`, m, 90 * u, { size: 14 * u, color: '#fff', width: 1.8 * u, align: 'left' });
  if (rs.modLabel) outlined(ctx, `${rs.modLabel}  ×${rs.scoreMult.toFixed(2)}`, m, 118 * u, { size: 15 * u, color: 'rgb(255,224,102)', width: 1.8 * u, align: 'left' });
  if (rs.settings.autoplay) text(ctx, 'AUTOPLAY', W - m, 40 * u, { size: 18 * u, color: 'rgb(255,217,77)', align: 'right' });
  if (rs.settings.showFPS) text(ctx, `${Math.round(rs.fx.fps)} fps`, W - m, 62 * u, { size: 13 * u, color: '#fff', align: 'right', weight: 700, alpha: 0.8 });
  const barH = 8 * u, p = rs.duration > 0 ? clamp(rs.time / rs.duration, 0, 1) : 0;
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, 0, W, barH);
  const stops = Array.from({ length: geo.n }, (_, i) => [geo.n === 1 ? 0 : i / (geo.n - 1), laneColor(i, geo.n)]);
  ctx.fillStyle = geo.n === 1 ? stops[0][1] : lg(ctx, 0, 0, W, 0, stops); ctx.fillRect(0, 0, W * p, barH);
  ctx.fillStyle = '#000'; ctx.fillRect(0, barH, W, 3 * u);
}

// ----------------------------------------------------------------------------- Classic (vertical) layout
function classicBar(ctx, geo, x, y, color, alpha, gray = false) {
  if (y < -40 || y > geo.H + 40 || alpha <= 0.003) return;
  const u = geo.u, wd = geo.laneW - 9 * u, h = 28 * u, rx = x - wd / 2, ry = y - h / 2;
  const A = ctx.globalAlpha; ctx.globalAlpha = A * alpha;
  const col = gray ? 'rgb(140,140,140)' : color;
  rrect(ctx, rx - 5 * u, ry - 5 * u, wd + 10 * u, h + 10 * u, 14 * u); ctx.fillStyle = gray ? 'rgba(140,140,140,0.25)' : color.replace(/[\d.]+\)$/, '0.25)'); ctx.fill();
  rrect(ctx, rx, ry, wd, h, 9 * u); ctx.fillStyle = lg(ctx, x, ry, x, ry + h, [[0, '#fff'], [1, col]]); ctx.fill();
  rrect(ctx, rx + 8 * u, ry + 4 * u, wd - 16 * u, 3.5 * u, 2 * u); ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fill();
  ctx.globalAlpha = A;
}

function classicHold(ctx, geo, rs, rn) {
  const u = geo.u, nt = rn.note, t = rs.time;
  const holdingNow = rn.state === 'holding', dead = rn.state === 'missed' || rn.state === 'dropped';
  const tStart = holdingNow ? Math.max(t, nt.time) : nt.time;
  const maxT = t + (geo.hitY + 80 * u) / geo.pps, tEnd = Math.min(noteEnd(nt), maxT);
  if (tEnd <= tStart) return;
  const vis = rs.visibility !== 'none';
  const times = [tStart];
  if (nt.slides.length || vis) { const step = Math.max(0.008, (vis ? 5 : 10) / geo.pps); for (let s = tStart + step; s < tEnd; s += step) times.push(s); }
  times.push(tEnd);
  const pts = times.map((s) => ({ x: geo.pathX(nt, s), y: geo.y(s - t) }));
  const base = dead ? 'rgb(153,153,153)' : laneColor(nt.lane, geo.n);
  const A = ctx.globalAlpha, baseAlpha = dead ? Math.max(0, 0.55 - (t - rn.changedAt) * 1.1) : 1;
  ctx.globalAlpha = A * baseAlpha;
  const pulse = holdingNow ? 0.85 + 0.15 * Math.sin(rs.wall * 22) : 1, bodyW = geo.laneW * 0.52 * pulse;
  if (vis) {
    for (let i = 0; i < pts.length - 1; i++) {
      const mid = (times[i] + times[i + 1]) / 2, va = classicAlpha(geo, rs, geo.y(mid - t));
      if (va < 0.01) continue;
      const col = dead ? 'rgb(153,153,153)' : geo.pathColor(nt, mid);
      ctx.globalAlpha = A * baseAlpha * va;
      segStroke(ctx, pts[i], pts[i + 1], col.replace(/[\d.]+\)$/, `${holdingNow ? 0.4 : 0.22})`), bodyW + 16 * u);
      segStroke(ctx, pts[i], pts[i + 1], col, bodyW);
      segStroke(ctx, pts[i], pts[i + 1], 'rgba(255,255,255,0.5)', 4 * u);
    }
    ctx.globalAlpha = A * baseAlpha;
  } else {
    strokePts(ctx, pts, base.replace(/[\d.]+\)$/, `${holdingNow ? 0.4 : 0.22})`), bodyW + 16 * u);
    if (!nt.slides.length) {
      const other = laneColor(Math.min(nt.lane + 1, geo.n - 1), geo.n);
      strokePts(ctx, pts, lg(ctx, pts[pts.length - 1].x, pts[pts.length - 1].y, pts[0].x, pts[0].y, [[0, dead ? 'rgb(179,179,179)' : other], [1, base]]), bodyW);
    } else {
      for (let i = 0; i < pts.length - 1; i++) strokePts(ctx, [pts[i], pts[i + 1]], dead ? 'rgb(153,153,153)' : geo.pathColor(nt, (times[i] + times[i + 1]) / 2), bodyW);
    }
    strokePts(ctx, pts, 'rgba(255,255,255,0.5)', 4 * u);
  }
  if (rn.state === 'waiting' || dead) {
    const hy = geo.y(nt.time - t);
    classicBar(ctx, geo, geo.pathX(nt, nt.time), hy, base, classicAlpha(geo, rs, hy), dead);
  }
  if (noteEnd(nt) <= maxT) {
    const cx = geo.pathX(nt, noteEnd(nt)), cy = geo.y(noteEnd(nt) - t);
    ctx.globalAlpha = A * baseAlpha * classicAlpha(geo, rs, cy);
    rrect(ctx, cx - geo.laneW * 0.34, cy - 9 * u, geo.laneW * 0.68, 18 * u, 8 * u); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.strokeStyle = dead ? 'rgb(153,153,153)' : geo.pathColor(nt, noteEnd(nt)); ctx.lineWidth = 5 * u; ctx.stroke();
    ctx.globalAlpha = A * baseAlpha;
  }
  let l = nt.lane;
  nt.slides.forEach((s, i) => {
    const nl = clamp(l + s.dir, 0, geo.n - 1), from = l; l = nl;
    if (rn.nextSlide > i && !dead) return;
    const y = geo.y(s.time - t);
    if (y > geo.hitY + 10 * u || y < -30) return;
    classicChevron(ctx, geo, (geo.laneX(from) + geo.laneX(nl)) / 2, y, s.dir, dead, rs.wall, classicAlpha(geo, rs, y));
  });
  ctx.globalAlpha = A;
}

function classicChevron(ctx, geo, cx, cy, dir, dead, wall, alpha) {
  const u = geo.u, s = u * (1 + 0.08 * Math.sin(wall * 10));
  const pt = (al, ac) => ({ x: cx + al * dir * s, y: cy - ac * s });
  const pts = [pt(26, 0), pt(-6, 24), pt(-6, 9), pt(-24, 9), pt(-24, -9), pt(-6, -9), pt(-6, -24)];
  const a = ctx.globalAlpha; ctx.globalAlpha = a * alpha;
  ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath();
  ctx.fillStyle = dead ? 'rgb(204,204,204)' : '#fff'; ctx.fill(); ctx.strokeStyle = '#000'; ctx.lineWidth = 4 * u; ctx.lineJoin = 'round'; ctx.stroke();
  ctx.globalAlpha = a;
}

function drawClassic(ctx, geo, theme, rs, beatPos) {
  const u = geo.u, n = geo.n, fx = rs.fx, x0 = geo.stageX, w = geo.stageW, hitY = geo.hitY, H = geo.H, eng = rs.engine;
  ctx.fillStyle = `rgba(0,0,0,${rs.ambient ? 0.72 : 0.9})`; ctx.fillRect(x0, -20, w, H + 40);
  for (let i = 0; i < n; i++) {
    const g = fx.laneGlow[i]; if (g <= 0.01) continue;
    const rx = x0 + geo.laneW * i, ry = hitY - 460 * u;
    ctx.fillStyle = lg(ctx, rx, ry, rx, hitY, [[0, laneColor(i, n, 0)], [1, laneColor(i, n, 0.55 * g)]]);
    ctx.fillRect(rx, ry, geo.laneW, 460 * u);
  }
  const spb = 60 / Math.max(40, rs.bpm);
  let k = Math.max(0, Math.floor(beatPos) - 1); const k0 = k;
  for (;;) {
    const y = geo.y(rs.offset + k * spb - rs.time);
    if (y < -10) break;
    if (y < H) { const bar = k % 4 === 0; ctx.fillStyle = `rgba(255,255,255,${bar ? 0.3 : 0.12})`; ctx.fillRect(x0, y - (bar ? 1.5 : 0.75) * u, w, (bar ? 3 : 1.5) * u); }
    k++; if (k > k0 + 90) break;
  }
  for (let i = 0; i <= n; i++) {
    const x = x0 + geo.laneW * i;
    if (i === 0 || i === n) {
      const bx = i === 0 ? x - 9 * u : x;
      ctx.fillStyle = 'rgb(107,107,107)'; ctx.fillRect(bx, -20, 9 * u, H + 40);
      ctx.fillStyle = 'rgb(158,158,158)'; ctx.fillRect(bx + (i === 0 ? 6 * u : 0), -20, 3 * u, H + 40);
    } else { ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(x - 0.9 * u, -20, 1.8 * u, H + 40); }
  }
  // notes
  const t = rs.time, horizon = hitY / geo.pps + 0.3, holds = [], taps = [];
  for (const rn of eng.notes) {
    const nt = rn.note;
    if (nt.time - t > horizon) break;
    if (noteEnd(nt) - t < -0.7) continue;
    if (rn.state === 'done') continue;
    if ((rn.state === 'missed' || rn.state === 'dropped') && t - rn.changedAt > 0.5) continue;
    (noteIsHold(nt) ? holds : taps).push(rn);
  }
  for (const rn of holds) classicHold(ctx, geo, rs, rn);
  for (const rn of taps) {
    const y = geo.y(rn.note.time - t);
    if (rn.state === 'missed') classicBar(ctx, geo, geo.laneX(rn.note.lane), y, 'rgb(140,140,140)', Math.max(0, 0.6 - (t - rn.changedAt) * 1.2) * classicAlpha(geo, rs, y), true);
    else classicBar(ctx, geo, geo.laneX(rn.note.lane), y, laneColor(rn.note.lane, n), classicAlpha(geo, rs, y));
  }
  // judgement line + key pads
  ctx.fillStyle = lg(ctx, 0, hitY - 7 * u, 0, hitY + 7 * u, [[0, 'rgb(158,179,214)'], [1, 'rgb(92,110,148)']]); ctx.fillRect(x0, hitY - 7 * u, w, 14 * u);
  ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillRect(x0, hitY - 7 * u, w, 2 * u);
  for (let i = 0; i < n; i++) {
    const press = fx.capPress[i], light = Math.min(i, n - 1 - i) % 2 === 0;
    const base = light ? [219, 194, 230] : [194, 84, 148], lc = laneRGB(i, n);
    const mix = 0.65 * press;
    const c = `rgb(${Math.round(lerp(base[0], lc.r * 255, mix))},${Math.round(lerp(base[1], lc.g * 255, mix))},${Math.round(lerp(base[2], lc.b * 255, mix))})`;
    const px = x0 + geo.laneW * i + 1.5 * u, py = geo.keysTop + 7 * u + 4 * u * press;
    ctx.fillStyle = c; ctx.fillRect(px, py, geo.laneW - 3 * u, H - geo.keysTop + 20 * u);
    ctx.fillStyle = `rgba(255,255,255,${0.35 + 0.4 * press})`; ctx.fillRect(px, py, geo.laneW - 3 * u, 3 * u);
    const lab = rs.keyLabels[i] || '';
    text(ctx, lab, px + (geo.laneW - 3 * u) / 2, py + 46 * u, { size: (lab.length > 2 ? 14 : 26) * u, color: '#000', alpha: 0.55 + 0.35 * press });
  }
  [['◀', true], ['▶', false]].forEach(([g, left]) => {
    const press = left ? fx.slideLeftPress : fx.slideRightPress;
    const rx = left ? x0 - 12 * u - 96 * u : x0 + w + 12 * u, ry = geo.keysTop + 22 * u;
    rrect(ctx, rx, ry, 96 * u, 48 * u, 10 * u); ctx.fillStyle = press > 0.2 ? 'rgb(140,217,255)' : 'rgba(255,255,255,0.14)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 2.5 * u; ctx.stroke();
    const lab = left ? rs.keyLabels[n] : rs.keyLabels[n + 1];
    text(ctx, `${g} ${lab || ''}`, rx + 48 * u, ry + 25 * u, { size: 15 * u, color: press > 0.2 ? '#000' : '#fff' });
  });
  emitHoldSparks(geo, rs);
  for (const ring of fx.rings) {
    const age = (rs.wall - ring.born) / 0.5; if (age >= 1 || ring.lane >= n) continue;
    const e = 1 - Math.pow(1 - age, 3), c = geo.receptor(ring.lane);
    const rw = geo.laneW * 0.5 + (ring.big ? 80 : 50) * u * e, rh = 14 * u + (ring.big ? 36 : 22) * u * e;
    ctx.globalAlpha = (1 - age) * 0.85; ctx.beginPath(); ctx.ellipse(c.x, c.y, rw, rh, 0, 0, Math.PI * 2);
    ctx.strokeStyle = ring.color; ctx.lineWidth = Math.max(1, 7 * u * (1 - age)); ctx.stroke(); ctx.globalAlpha = 1;
  }
  for (const b of fx.slideBursts) {
    const age = (rs.wall - b.born) / 0.5; if (age >= 1 || b.lane >= n) continue;
    const c = geo.receptor(b.lane), from = c.x - b.dir * geo.laneW * (1 - age * 0.3);
    strokePts(ctx, [{ x: from, y: c.y }, { x: c.x, y: c.y }], `rgba(255,255,255,${(1 - age) * 0.9})`, 10 * u * (1 - age));
  }
  drawParticles(ctx, fx);
  if (!rs.showHUD || rs.ambient) return;
  if (eng.combo >= 2) {
    const sc = 1 + 0.28 * Math.exp(-(rs.wall - fx.comboBorn) * 14);
    ctx.save(); ctx.translate(x0 + w / 2, hitY * 0.36); ctx.scale(sc, sc);
    monoText(ctx, String(eng.combo), 0, 0, { size: 68 * u, color: 'rgba(255,255,255,0.92)', outline: 'rgba(0,0,0,0.6)', outlineW: 2.5 * u });
    text(ctx, 'COMBO', 0, 46 * u, { size: 15 * u, color: '#fff', alpha: 0.7 });
    ctx.restore();
  }
  drawPop(ctx, fx, rs.wall, x0 + w / 2, hitY - 150 * u, u);
  const rx = geo.W - 34 * u;
  text(ctx, 'SCORE', rx, 92 * u, { size: 14 * u, color: '#fff', alpha: 0.65, align: 'right' });
  monoText(ctx, String(Math.round(eng.score * rs.scoreMult)).padStart(7, '0'), rx, 132 * u, { size: 50 * u, color: '#fff', align: 'right' });
  text(ctx, `${(eng.accuracy * 100).toFixed(2)}%`, rx, 176 * u, { size: 24 * u, color: '#fff', alpha: 0.85, align: 'right' });
  text(ctx, `MAX ${eng.maxCombo}`, rx, 204 * u, { size: 14 * u, color: '#fff', alpha: 0.55, align: 'right' });
}

// ----------------------------------------------------------------------------- chart effects (stateless)
export function chartShake(events, t, u) {
  let x = 0, y = 0;
  for (const e of events) {
    if (e.kind !== 'shake') continue;
    const a = t - e.time, len = eventLength(e);
    if (a < 0 || a >= len) continue;
    const decay = Math.pow(1 - a / len, 2);
    x += Math.sin(a * 70) * 16 * u * decay; y += Math.cos(a * 83) * 12 * u * decay;
  }
  return { x, y };
}

function star(ctx, cx, cy, r) {
  const inner = r * 0.22;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) { const ang = i * Math.PI / 4 - Math.PI / 2, rad = i % 2 === 0 ? r : inner; const x = cx + Math.cos(ang) * rad, y = cy + Math.sin(ang) * rad; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
  ctx.closePath();
}

export function drawChartFX(ctx, W, H, center, u, events, t) {
  const maxR = Math.hypot(W, H), later = [];
  for (const e of events) {
    const a = t - e.time, len = eventLength(e);
    if (a < 0 || a >= len) continue;
    const k = a / len;
    switch (e.kind) {
      case 'flash': ctx.fillStyle = hueColor(e.hue, 0.25, 1, Math.pow(1 - k, 2) * 0.55); ctx.fillRect(0, 0, W, H); break;
      case 'tint': { const env = Math.max(0, Math.min(1, a / 0.6, (len - a) / 0.9)); ctx.fillStyle = hueColor(e.hue, 0.65, 1, 0.24 * env); ctx.fillRect(0, 0, W, H); break; }
      case 'pulse':
        for (let i = 0; i < 3; i++) {
          const ai = a - i * 0.12; if (ai <= 0) continue;
          const p = Math.min(1, ai / 0.7), r = (1 - Math.pow(1 - p, 3)) * maxR * 0.85;
          ctx.beginPath(); ctx.arc(center.x, center.y, r, 0, Math.PI * 2);
          ctx.strokeStyle = hueColor((e.hue + i * 0.08) % 1, 0.6, 1, (1 - p) * 0.85); ctx.lineWidth = Math.max(1, 16 * u * (1 - p)); ctx.stroke();
        }
        break;
      case 'sparkles': case 'fireworks': case 'lasers': later.push([e, a]); break;
      default: break;
    }
  }
  for (const [e, a] of later) {
    const len = eventLength(e), k = a / len;
    if (e.kind === 'sparkles') {
      const rng = new RNG(eventSeed(e));
      for (let i = 0; i < 70; i++) {
        const x0 = rng.unit() * W, delay = rng.unit() * len * 0.45, vy = (140 + rng.unit() * 280) * u, size = (3 + rng.unit() * 6) * u;
        const hue = rng.unit(), phase = rng.unit() * 6.28, sway = (8 + rng.unit() * 22) * u, age = a - delay;
        if (age <= 0) continue;
        const y = -30 * u + vy * age; if (y > H + 30) continue;
        const x = x0 + Math.sin(age * 2.2 + phase) * sway, tw = 0.55 + 0.45 * Math.sin(age * 13 + phase), fade = Math.max(0, 1 - k) * Math.min(1, age * 4);
        const c = hsv(hue, 0.7, 1);
        ctx.fillStyle = rg(ctx, x, y, 0, size * 2.6, [[0, rgba(c, 0.35 * tw * fade)], [1, rgba(c, 0)]]); ctx.fillRect(x - size * 2.6, y - size * 2.6, size * 5.2, size * 5.2);
        star(ctx, x, y, size * (1.2 + 0.6 * tw)); ctx.fillStyle = rgba(c, Math.min(1, tw * fade * 1.3)); ctx.fill();
        ctx.strokeStyle = `rgba(0,0,0,${0.45 * fade})`; ctx.lineWidth = 1.2 * u; ctx.lineJoin = 'round'; ctx.stroke();
      }
    } else if (e.kind === 'fireworks') {
      const rng = new RNG(eventSeed(e));
      for (let b = 0; b < 3; b++) {
        const cx = W * (0.15 + 0.7 * rng.unit()), cy = H * (0.12 + 0.33 * rng.unit()), baseHue = (e.hue + b * 0.27) % 1;
        const ab = a - b * 0.38, life = 1.35, jit = rng.unit() * 6.28;
        const speeds = [], hues = [];
        for (let j = 0; j < 40; j++) { speeds.push((150 + rng.unit() * 190) * u); hues.push(baseHue + rng.unit() * 0.12); }
        if (ab <= 0 || ab >= life) continue;
        const p = ab / life;
        for (let j = 0; j < 40; j++) {
          const ang = j / 40 * Math.PI * 2 + jit;
          const pos = (tt) => { const d = 1 - Math.exp(-tt * 2.6); return { x: cx + Math.cos(ang) * speeds[j] * d * 1.4, y: cy + Math.sin(ang) * speeds[j] * d * 1.4 + 150 * u * tt * tt }; };
          strokePts(ctx, [pos(Math.max(0, ab - 0.09)), pos(ab)], hueColor(hues[j] % 1, 0.75, 1, (1 - p) * 0.9), 3.2 * u * (1 - p * 0.5));
        }
        const fl = Math.max(0, 1 - ab / 0.18);
        if (fl > 0) { ctx.fillStyle = rg(ctx, cx, cy, 0, 60 * u, [[0, `rgba(255,255,255,${0.8 * fl})`], [1, 'rgba(255,255,255,0)']]); ctx.fillRect(cx - 60 * u, cy - 60 * u, 120 * u, 120 * u); }
      }
    } else if (e.kind === 'lasers') {
      const env = Math.max(0, Math.min(1, a / 0.5, (len - a) / 0.6)), n = 7;
      for (let i = 0; i < n; i++) {
        const ox = W * (i + 0.5) / n, ang = Math.sin(a * 1.3 + i * 0.9) * 0.62, ex = ox + Math.sin(ang) * H * 1.6, ey = Math.cos(ang) * H * 1.6;
        const h = (e.hue + i * 0.07 + a * 0.05) % 1;
        strokePts(ctx, [{ x: ox, y: -10 }, { x: ex, y: ey }], lg(ctx, ox, 0, ex, ey, [[0, hueColor(h, 0.8, 1, 0.28 * env)], [1, hueColor(h, 0.8, 1, 0)]]), 34 * u);
        strokePts(ctx, [{ x: ox, y: -10 }, { x: ex, y: ey }], lg(ctx, ox, 0, ex, ey, [[0, hueColor(h, 0.8, 1, 0.8 * env)], [1, hueColor(h, 0.8, 1, 0)]]), 7 * u);
      }
    }
  }
}
