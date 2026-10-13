import { hueColor } from './theme.js';
import { J_COLOR, J_TITLE, J } from './model.js';
import { laneColor } from './theme.js';

export class FX {
  constructor() {
    this.queue = [];
    this.reset();
    this.lastWall = 0; this.frameDT = 1 / 60; this.fps = 60; this.holdEmit = 0;
  }
  reset() {
    this.queue = []; this.particles = []; this.rings = [];
    this.laneGlow = new Array(10).fill(0); this.laneKey = new Array(10).fill(false); this.capPress = new Array(10).fill(0);
    this.slideLeftPress = 0; this.slideRightPress = 0;
    this.pop = null; this.comboBorn = -10; this.shake = 0; this.flash = 0; this.flashColor = '#fff';
    this.circleFlash = 0; this.circleColor = '#fff'; this.needleAngle = 0; this.needleAlpha = 0; this.slideBursts = [];
  }

  begin(wall) {
    let dt = wall - this.lastWall;
    if (this.lastWall === 0 || dt > 0.25 || dt <= 0) dt = 1 / 60;
    this.lastWall = wall; this.frameDT = dt;
    this.fps += (1 / dt - this.fps) * 0.05;
    this.shake = Math.max(0, this.shake - dt * 30);
    this.flash = Math.max(0, this.flash - dt * 2.4);
    this.circleFlash = Math.max(0, this.circleFlash - dt * 3.2);
    for (let i = 0; i < 10; i++) {
      this.laneGlow[i] = Math.max(this.laneGlow[i] - dt * 3.4, this.laneKey[i] ? 0.5 : 0);
      this.capPress[i] = this.laneKey[i] ? 1 : Math.max(0, this.capPress[i] - dt * 9);
    }
    this.slideLeftPress = Math.max(0, this.slideLeftPress - dt * 5);
    this.slideRightPress = Math.max(0, this.slideRightPress - dt * 5);
    const ps = this.particles;
    for (let k = 0; k < ps.length;) {
      const p = ps[k];
      p.life -= dt;
      if (p.life <= 0) { ps[k] = ps[ps.length - 1]; ps.pop(); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 380 * dt; p.vx *= (1 - dt * 1.4);
      k++;
    }
    this.rings = this.rings.filter((r) => wall - r.born <= 0.55);
    this.slideBursts = this.slideBursts.filter((b) => wall - b.born <= 0.5);
  }

  consume(geo, wall, particlesOn, shakeOn) {
    const n = geo.n;
    for (const e of this.queue) {
      switch (e.type) {
        case 'keyDown': if (e.lane < 10) { this.laneKey[e.lane] = true; this.laneGlow[e.lane] = Math.max(this.laneGlow[e.lane], 0.9); } break;
        case 'keyUp': if (e.lane < 10) this.laneKey[e.lane] = false; break;
        case 'hit': {
          const col = laneColor(e.lane, n);
          this.laneGlow[Math.min(e.lane, 9)] = 1;
          this.rings.push({ born: wall, color: col, big: e.judgment === J.PERFECT || e.kind === 'holdTail', lane: e.lane });
          this.circleFlash = 1; this.circleColor = J_COLOR[e.judgment];
          this.flash = Math.max(this.flash, e.judgment === J.PERFECT ? 0.22 : 0.12); this.flashColor = col;
          this.pop = { text: J_TITLE[e.judgment], color: J_COLOR[e.judgment], born: wall,
            early: (Math.abs(e.offset) < 0.03 || e.kind === 'holdTail') ? 0 : (e.offset < 0 ? -1 : 1) };
          this.comboBorn = wall;
          if (particlesOn) this.burst(geo, e.lane, e.lane, e.judgment === J.PERFECT ? 16 : 10);
          break;
        }
        case 'miss':
          this.pop = { text: 'MISS', color: J_COLOR[J.MISS], born: wall, early: 0 };
          if (shakeOn) this.shake = Math.max(this.shake, 7);
          this.circleFlash = 1; this.circleColor = J_COLOR[J.MISS]; this.comboBorn = wall - 5;
          break;
        case 'mash':
          this.pop = { text: 'NO MASHING', color: J_COLOR[J.MISS], born: wall, early: 0 };
          if (shakeOn) this.shake = Math.max(this.shake, 9);
          break;
        case 'holdEnd': if (e.success && particlesOn) this.burst(geo, e.lane, e.lane, 22); break;
        case 'slide': {
          this.slideBursts.push({ born: wall, lane: e.to, dir: e.to > e.from ? 1 : -1 });
          if (particlesOn) this.burst(geo, e.to, -1, 14);
          break;
        }
        default: break;
      }
    }
    this.queue.length = 0;
  }

  /** colorLane = -1 for white sparks. */
  burst(geo, lane, colorLane, count) {
    if (lane < 0 || lane >= geo.n) return;
    const p = geo.receptor(lane), o = geo.outward(lane);
    const a = Math.atan2(o.dx, -o.dy);
    const color = colorLane < 0 ? 'rgb(255,255,255)' : laneColor(colorLane, geo.n);
    for (let i = 0; i < count; i++) {
      const ca = a + (Math.random() * 1.8 - 0.9);
      const sp = (120 + Math.random() * 340) * geo.u;
      const life = 0.35 + Math.random() * 0.45;
      this.particles.push({ x: p.x, y: p.y, vx: Math.sin(ca) * sp + o.dx * 40, vy: -Math.cos(ca) * sp + o.dy * 40 - 60, life, maxLife: life,
        size: (2.5 + Math.random() * 4) * geo.u, color });
    }
    if (this.particles.length > 500) this.particles.splice(0, this.particles.length - 500);
  }
}
