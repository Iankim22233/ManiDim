// Web Audio wrapper: music playback with exact timing, speed (rate) control, fades and UI sound effects.
import { makeSFX, SFX_NAMES } from './dsp.js';

export class AudioEngine {
  constructor() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    this.musicGain = this.ctx.createGain();
    this.sfxGain = this.ctx.createGain();
    this.musicGain.connect(this.ctx.destination);
    this.sfxGain.connect(this.ctx.destination);
    this.musicVolume = 0.8; this.sfxVolume = 0.6;
    this.sfx = {};
    for (const n of SFX_NAMES) {
      const d = makeSFX(n);
      const b = this.ctx.createBuffer(1, d.length, 44100);
      b.copyToChannel(d, 0);
      this.sfx[n] = b;
    }
    this.buffer = null; this.bufferKey = null;
    this.source = null;
    this.startPerf = 0; this.startPos = 0; this.rate = 1;
    this.playing = false; this.isPreview = false; this.owner = null;
    this.fadeScale = 1; this.fadeTimer = null;
    this.applyVolumes();
  }

  applyVolumes() {
    this.musicGain.gain.value = this.musicVolume * this.fadeScale;
    this.sfxGain.gain.value = this.sfxVolume;
  }
  setVolumes(music, sfx) { this.musicVolume = music; this.sfxVolume = sfx; this.applyVolumes(); }
  resume() { if (this.ctx.state !== 'running') this.ctx.resume(); }

  static perfNow() { return performance.now() / 1000; }

  /** performance-time (s) at which context time T is audible. */
  ctxToPerf(T) {
    const ts = this.ctx.getOutputTimestamp();
    if (ts.contextTime > 0 && ts.performanceTime > 0) return ts.performanceTime / 1000 + (T - ts.contextTime);
    return performance.now() / 1000 + (T - this.ctx.currentTime) + (this.ctx.outputLatency || this.ctx.baseLatency || 0);
  }
  perfToCtx(p) {
    const ts = this.ctx.getOutputTimestamp();
    if (ts.contextTime > 0 && ts.performanceTime > 0) return ts.contextTime + (p - ts.performanceTime / 1000);
    return this.ctx.currentTime + (p - performance.now() / 1000);
  }

  setBuffer(key, buffer) { this.stop(); this.buffer = buffer; this.bufferKey = key; }
  get duration() { return this.buffer ? this.buffer.duration : 0; }

  /** Start playing `from` seconds into the track, `delay` seconds from now, at playback speed `rate`. */
  play(from, delay = 0.05, rate = 1) {
    if (!this.buffer) return;
    this.resume();
    this._killSource();
    clearInterval(this.fadeTimer);
    this.fadeScale = 1; this.applyVolumes();
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.playbackRate.value = rate;
    src.connect(this.musicGain);
    const T0 = this.ctx.currentTime + delay;
    const off = Math.max(0, from);
    if (off >= this.buffer.duration) return;
    src.start(T0, off);
    src.onended = () => { if (this.source === src) { this.playing = false; } };
    this.source = src;
    this.startPerf = this.ctxToPerf(T0);
    this.startPos = off;
    this.rate = rate;
    this.playing = true; this.isPreview = false;
  }

  _killSource() {
    if (this.source) { try { this.source.onended = null; this.source.stop(); } catch (e) { /* already stopped */ } try { this.source.disconnect(); } catch (e) { /* */ } }
    this.source = null;
  }

  stop() {
    this._killSource();
    clearInterval(this.fadeTimer);
    this.fadeScale = 1; this.applyVolumes();
    this.playing = false; this.isPreview = false; this.rate = 1;
  }
  stopIfOwner(o) { if (this.owner === o) { this.owner = null; this.stop(); } }
  stopPreview() { if (this.isPreview) this.stop(); }

  /** Live speed change (tutorial tape-stop). */
  setRate(r) { if (this.source) this.source.playbackRate.value = Math.min(4, Math.max(0.25, r)); }

  /** Song position (s) at performance time `p`. */
  position(p = AudioEngine.perfNow()) { return this.startPos + (p - this.startPerf) * this.rate; }

  fadeOut(seconds) {
    if (!this.playing) return;
    clearInterval(this.fadeTimer);
    const start = this.fadeScale; let el = 0;
    this.fadeTimer = setInterval(() => {
      el += 1 / 30;
      const p = Math.min(1, el / seconds);
      this.fadeScale = start * (1 - p); this.applyVolumes();
      if (p >= 1) { clearInterval(this.fadeTimer); this.stop(); }
    }, 1000 / 30);
  }

  playPreview(key, buffer, from) {
    if (this.owner) return;
    this.setBufferQuiet(key, buffer);
    const pos = Math.min(from, Math.max(0, buffer.duration - 12));
    this.play(pos, 0.05, 1);
    this.isPreview = true;
    clearInterval(this.fadeTimer);
    this.fadeScale = 0; this.applyVolumes();
    let step = 0;
    this.fadeTimer = setInterval(() => {
      step++; this.fadeScale = Math.min(1, step / 45) * 0.8; this.applyVolumes();
      if (step >= 45) clearInterval(this.fadeTimer);
    }, 1000 / 30);
  }
  setBufferQuiet(key, buffer) { if (this.bufferKey !== key) { this._killSource(); this.buffer = buffer; this.bufferKey = key; } }

  playSfx(name, volume = 1) {
    const b = this.sfx[name]; if (!b) return;
    this.resume();
    const s = this.ctx.createBufferSource(); s.buffer = b;
    const g = this.ctx.createGain(); g.gain.value = volume;
    s.connect(g); g.connect(this.sfxGain);
    s.start();
  }
  scheduleSfx(name, perfTime, volume = 1) {
    const b = this.sfx[name]; if (!b) return;
    const s = this.ctx.createBufferSource(); s.buffer = b;
    const g = this.ctx.createGain(); g.gain.value = volume;
    s.connect(g); g.connect(this.sfxGain);
    s.start(Math.max(this.ctx.currentTime, this.perfToCtx(perfTime)));
  }
}
