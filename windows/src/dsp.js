// Offline synthesis (runs in a Web Worker): instruments, mixing, WAV encoding, UI sound effects.
import { compose, arrangementFor } from './songs.js';

const TAU = Math.PI * 2;
const SR = 44100;

class Mixer {
  constructor(seconds) {
    this.n = Math.floor(seconds * SR);
    this.dryL = new Float32Array(this.n); this.dryR = new Float32Array(this.n);
    this.leadL = new Float32Array(this.n); this.leadR = new Float32Array(this.n);
    this.noise = 0x9E3779B9 >>> 0;
  }
  rnd() { let x = this.noise; x = (x ^ (x << 13)) >>> 0; x = (x ^ (x >>> 17)) >>> 0; x = (x ^ (x << 5)) >>> 0; this.noise = x; return x / 4294967295 * 2 - 1; }
  hz(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  gains(pan) { return [Math.cos(pan * Math.PI / 2) * 1.414, Math.sin(pan * Math.PI / 2) * 1.414]; }

  kick(t, vel) {
    const start = Math.floor(t * SR), len = Math.floor(0.45 * SR);
    const [gl, gr] = this.gains(0.5);
    let phase = 0;
    for (let i = 0; i < len; i++) {
      const idx = start + i; if (idx >= this.n) break;
      const tt = i / SR;
      phase += TAU * (46 + 120 * Math.exp(-tt * 30)) / SR;
      let s = Math.sin(phase) * Math.exp(-tt * 6.5) * Math.min(1, tt * 600);
      s += this.rnd() * Math.exp(-tt * 350) * 0.2;
      const v = s * vel * 0.95;
      this.dryL[idx] += v * gl; this.dryR[idx] += v * gr;
    }
  }

  snare(t, vel, clap) {
    const start = Math.floor(t * SR), len = Math.floor(0.28 * SR);
    const [gl, gr] = this.gains(clap ? 0.55 : 0.5);
    let hp = 0, prev = 0;
    for (let i = 0; i < len; i++) {
      const idx = start + i; if (idx >= this.n) break;
      const tt = i / SR;
      const nz = this.rnd();
      hp = 0.7 * (hp + nz - prev); prev = nz;
      let s;
      if (clap) {
        const burst = (tt < 0.012 || (tt > 0.02 && tt < 0.032) || (tt > 0.04 && tt < 0.052)) ? 1 : 0;
        s = hp * (burst * 0.9 + Math.exp(-tt * 20) * 0.5) * 0.6;
      } else s = hp * Math.exp(-tt * 16) * 0.65 + Math.sin(TAU * 190 * tt) * Math.exp(-tt * 24) * 0.45;
      const v = s * vel * 0.8;
      this.dryL[idx] += v * gl; this.dryR[idx] += v * gr;
    }
  }

  hat(t, vel, open) {
    const start = Math.floor(t * SR), len = Math.floor((open ? 0.28 : 0.07) * SR);
    const [gl, gr] = this.gains(0.62);
    let prev = 0, hp = 0;
    const decay = open ? 14 : 75;
    for (let i = 0; i < len; i++) {
      const idx = start + i; if (idx >= this.n) break;
      const tt = i / SR;
      const nz = this.rnd();
      hp = 0.85 * (hp + nz - prev); prev = nz;
      const v = hp * Math.exp(-tt * decay) * vel * 0.3;
      this.dryL[idx] += v * gl; this.dryR[idx] += v * gr;
    }
  }

  static blep(t, dt) {
    if (t < dt) { const x = t / dt; return x + x - x * x - 1; }
    if (t > 1 - dt) { const x = (t - 1) / dt; return x * x + x + x + 1; }
    return 0;
  }
  static saw(p, dt) { return 2 * p - 1 - Mixer.blep(p, dt); }

  bass(t, dur, midi) {
    const f = this.hz(midi), start = Math.floor(t * SR), len = Math.floor((dur + 0.12) * SR);
    const dt = f / SR;
    const [gl, gr] = this.gains(0.5);
    let p = 0, sp = 0, lp = 0;
    for (let i = 0; i < len; i++) {
      const idx = start + i; if (idx >= this.n) break;
      const tt = i / SR;
      p += dt; if (p >= 1) p -= 1;
      sp += TAU * f / SR;
      const cutoff = 260 + 900 * Math.exp(-tt * 9);
      const a = 1 - Math.exp(-TAU * cutoff / SR);
      lp += a * (Mixer.saw(p, dt) * 0.6 - lp);
      let env = Math.min(1, tt / 0.004) * (0.65 + 0.35 * Math.exp(-tt * 4));
      if (tt > dur) env *= Math.exp(-(tt - dur) * 40);
      const v = (lp + Math.sin(sp) * 0.55) * env * 0.55;
      this.dryL[idx] += v * gl; this.dryR[idx] += v * gr;
    }
  }

  lead(t, dur, midi, voice, pan) {
    const f = this.hz(midi);
    const rel = voice === 'pluck' ? 0.2 : 0.28;
    const start = Math.floor(t * SR), len = Math.floor((dur + rel) * SR);
    const dt1 = f * 1.0035 / SR, dt2 = f * 0.9965 / SR;
    const [gl, gr] = this.gains(pan);
    let p1 = 0, p2 = 0, lp = 0, ph = 0;
    for (let i = 0; i < len; i++) {
      const idx = start + i; if (idx >= this.n) break;
      const tt = i / SR;
      p1 += dt1; if (p1 >= 1) p1 -= 1;
      p2 += dt2; if (p2 >= 1) p2 -= 1;
      let s, env;
      if (voice === 'saw') {
        const cutoff = 900 + 3600 * Math.exp(-tt * 5);
        const a = 1 - Math.exp(-TAU * cutoff / SR);
        lp += a * ((Mixer.saw(p1, dt1) + Mixer.saw(p2, dt2)) * 0.5 - lp);
        s = lp; env = Math.min(1, tt / 0.006) * (0.7 + 0.3 * Math.exp(-tt * 6));
      } else if (voice === 'pluck') {
        ph += TAU * f / SR;
        s = Math.sin(ph) + 0.4 * Math.sin(2 * ph) * Math.exp(-tt * 9) + 0.2 * Math.sin(3 * ph) * Math.exp(-tt * 14);
        env = Math.min(1, tt / 0.002) * Math.exp(-tt * 5.5);
      } else {
        ph += TAU * f * (1 + 0.0025 * Math.sin(TAU * 5.2 * tt)) / SR;
        s = Math.sin(ph) + 0.25 * Math.sin(2 * ph) + 0.08 * Math.sin(3 * ph);
        env = Math.min(1, tt / 0.012) * (0.75 + 0.25 * Math.exp(-tt * 3));
      }
      if (tt > dur) env *= Math.exp(-(tt - dur) * (voice === 'pluck' ? 25 : 14));
      const v = s * env * 0.3;
      this.leadL[idx] += v * gl; this.leadR[idx] += v * gr;
    }
  }

  pad(t, dur, midis, level) {
    const start = Math.floor(t * SR), len = Math.floor((dur + 0.7) * SR);
    midis.forEach((m, k) => {
      const f = this.hz(m);
      const dt1 = f * 1.004 / SR, dt2 = f * 0.996 / SR;
      let p1 = k * 0.13, p2 = k * 0.29, lp = 0;
      const [gl, gr] = this.gains(Math.min(1, 0.25 + 0.5 * (k % 2) + 0.05 * k));
      const a = 1 - Math.exp(-TAU * 1100 / SR);
      for (let i = 0; i < len; i++) {
        const idx = start + i; if (idx >= this.n) break;
        const tt = i / SR;
        p1 += dt1; if (p1 >= 1) p1 -= 1;
        p2 += dt2; if (p2 >= 1) p2 -= 1;
        lp += a * ((Mixer.saw(p1, dt1) + Mixer.saw(p2, dt2)) * 0.5 - lp);
        let env = Math.min(1, tt / 0.35);
        if (tt > dur) env *= Math.exp(-(tt - dur) * 6);
        const v = lp * env * level * 0.5;
        this.dryL[idx] += v * gl; this.dryR[idx] += v * gr;
      }
    });
  }

  finish(delaySeconds, fadeSeconds) {
    const n = this.n, d = Math.max(1, Math.floor(delaySeconds * SR)), fb = 0.38;
    const { dryL, dryR, leadL, leadR } = this;
    for (let i = d; i < n; i++) { leadL[i] += leadR[i - d] * fb; leadR[i] += leadL[i - d] * fb; }
    let peak = 0.0001;
    for (let i = 0; i < n; i++) {
      dryL[i] += leadL[i] * 0.9; dryR[i] += leadR[i] * 0.9;
      const a = Math.abs(dryL[i]), b = Math.abs(dryR[i]);
      if (a > peak) peak = a; if (b > peak) peak = b;
    }
    const g = 0.88 / peak, fadeN = Math.floor(fadeSeconds * SR);
    for (let i = 0; i < n; i++) {
      let f = 1;
      if (fadeN > 0 && i > n - fadeN) f = 0.5 + 0.5 * Math.cos((i - (n - fadeN)) / fadeN * Math.PI);
      dryL[i] = Math.tanh(dryL[i] * g * 1.1) * f;
      dryR[i] = Math.tanh(dryR[i] * g * 1.1) * f;
    }
    return { left: dryL, right: dryR };
  }
}

export function renderArrangement(a, comp = compose(a)) {
  const m = new Mixer(comp.duration + 1);
  for (const d of comp.drums) {
    if (d.kind === 'kick') m.kick(d.t, d.vel);
    else if (d.kind === 'snare') m.snare(d.t, d.vel, false);
    else if (d.kind === 'clap') m.snare(d.t, d.vel, true);
    else if (d.kind === 'hat') m.hat(d.t, d.vel, false);
    else m.hat(d.t, d.vel, true);
  }
  for (const b of comp.bass) m.bass(b.t, b.dur, b.midi);
  const padLevel = a.voice === 'soft' ? 0.5 : 0.32;
  for (const p of comp.pads) m.pad(p.t, p.dur, p.midis, padLevel);
  comp.melody.forEach((n, i) => m.lead(n.start, n.dur * 0.95, n.midi, a.voice, 0.38 + 0.24 * (i % 2)));
  return m.finish(60 / a.bpm * 0.75, 3.0);
}

export function renderBlank(bpm, bars) {
  const spb = 60 / bpm;
  const m = new Mixer(bars * spb * 4 + 2);
  for (let b = 0; b < bars * 4; b++) {
    const t = b * spb;
    if (b % 4 === 0) m.kick(t, 0.8);
    if (b % 4 === 2) m.kick(t, 0.6);
    if (b % 4 === 1 || b % 4 === 3) m.snare(t, 0.5, false);
    m.hat(t + spb / 2, 0.45, false);
    m.hat(t, b % 4 === 0 ? 0.7 : 0.4, false);
  }
  return m.finish(spb, 0.5);
}

export function renderBuiltin(key) {
  const a = arrangementFor(key);
  return renderArrangement(a);
}

/** 16-bit stereo WAV file bytes. */
export function encodeWav(left, right, sampleRate = SR) {
  const n = left.length, bytes = 44 + n * 4;
  const buf = new ArrayBuffer(bytes), v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, bytes - 8, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 2, true); v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 4, true);
  v.setUint16(32, 4, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 4, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    v.setInt16(o, Math.max(-1, Math.min(1, left[i])) * 32767, true);
    v.setInt16(o + 2, Math.max(-1, Math.min(1, right[i])) * 32767, true);
    o += 4;
  }
  return new Uint8Array(buf);
}

// ------------------------------------------------------------------ UI / hit sound effects (mono)
export const SFX_NAMES = ['tap', 'hold', 'slide', 'miss', 'select', 'move', 'back', 'beep', 'go', 'metronome'];
export function makeSFX(name) {
  let noise = 0x1234ABCD >>> 0;
  const white = () => { noise = (noise ^ (noise << 13)) >>> 0; noise = (noise ^ (noise >>> 17)) >>> 0; noise = (noise ^ (noise << 5)) >>> 0; return noise / 4294967295 * 2 - 1; };
  const synth = (dur, g) => { const n = Math.floor(dur * SR), out = new Float32Array(n); for (let i = 0; i < n; i++) out[i] = Math.max(-1, Math.min(1, g(i / SR))); return out; };
  const E = Math.exp, S = Math.sin;
  switch (name) {
    case 'tap': return synth(0.09, (t) => (S(TAU * 1500 * t) * 0.45 + S(TAU * 3000 * t) * 0.15) * E(-t * 75) + white() * 0.25 * E(-t * 260));
    case 'hold': return synth(0.14, (t) => S(TAU * 260 * t) * E(-t * 28) * 0.7 + S(TAU * 1100 * t) * E(-t * 90) * 0.3 + white() * 0.2 * E(-t * 300));
    case 'slide': return synth(0.18, (t) => { const f = 500 + 2200 * t, e = S(Math.PI * Math.min(1, t / 0.18)); return S(TAU * f * t) * e * 0.5 + white() * 0.1 * e; });
    case 'miss': return synth(0.18, (t) => S(TAU * (110 - 200 * t) * t) * E(-t * 16) * 0.55 + white() * 0.08 * E(-t * 60));
    case 'select': return synth(0.16, (t) => S(TAU * (t < 0.06 ? 880 : 1320) * t) * E(-t * 22) * 0.4);
    case 'move': return synth(0.05, (t) => S(TAU * 700 * t) * E(-t * 70) * 0.35);
    case 'back': return synth(0.14, (t) => S(TAU * (t < 0.05 ? 700 : 480) * t) * E(-t * 24) * 0.4);
    case 'beep': return synth(0.12, (t) => S(TAU * 880 * t) * E(-t * 14) * 0.45);
    case 'go': return synth(0.3, (t) => (S(TAU * 1320 * t) + 0.4 * S(TAU * 1980 * t)) * E(-t * 9) * 0.4);
    default: return synth(0.06, (t) => S(TAU * 1000 * t) * E(-t * 80) * 0.7);
  }
}
