// Looping autoplay of Neon Drive behind the home screen (synced to the menu music when it is ready).
import { GameEngine } from './engine.js';
import { FX } from './fxstate.js';
import { drawGame } from './renderer.js';
import { bufferFor } from './buffers.js';
import { AudioEngine } from './audio.js';

const SEG_START = 22.5, SEG_END = 58, LEAD = 1.6;

export class Demo {
  constructor(app) {
    this.app = app; this.fx = new FX();
    const song = app.library.songs.find((s) => s.builtinKey === 'neon-drive');
    this.song = song; this.chart = song.charts[2];
    this.runStart = 0; this.wantMusic = false; this.musicOn = false; this.engine = null;
    this.restart(AudioEngine.perfNow());
  }
  newEngine() { const e = new GameEngine(this.chart, this.song.keyCount, SEG_START); e.bot = true; e.onEvent = (ev) => this.fx.queue.push(ev); return e; }
  restart(wall) {
    this.engine = this.newEngine(); this.fx.reset(); this.runStart = wall;
    if (!this.wantMusic) return;
    const a = this.app.audio;
    bufferFor(a, this.song).then((buf) => {
      if (!this.wantMusic || a.owner) return;
      a.setBuffer('b:' + this.song.builtinKey, buf);
      a.play(SEG_START, LEAD, 1);
      a.fadeScale = 0.55; a.applyVolumes();
      this.runStart = a.startPerf - LEAD; this.musicOn = true;
      this.engine = this.newEngine();
    }).catch(() => {});
  }
  setMusic(on) {
    this.wantMusic = on;
    if (on) this.restart(AudioEngine.perfNow());
    else if (this.musicOn) { const a = this.app.audio; if (!a.owner) a.stop(); this.musicOn = false; }
  }
  time(wall) {
    const t = SEG_START - LEAD + (wall - this.runStart);
    if (t > SEG_END) { this.restart(wall); return SEG_START - LEAD; }
    this.engine.update(t);
    return t;
  }
  draw(ctx, W, H, wall, centerX = 0.73) {
    const t = this.time(wall);
    const s = this.app.store.settings;
    drawGame(ctx, W, H, { engine: this.engine, fx: this.fx, time: t, wall, settings: { ...s, particles: true, screenShake: false, chartEffects: false },
      bpm: this.song.bpm, offset: 0, hue: this.song.hue, centerX, showHUD: false, ambient: true, events: [], classic: false, visibility: 'none',
      scoreMult: 1, modLabel: '', keyLabels: [], bgImage: this.app.store.bgImage, title: '', artist: '', chartName: '', duration: 0 });
  }
}
