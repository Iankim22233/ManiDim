// A running game: clock, input, tutorial lessons (slow-down + stop), pause, mods and results.
import { GameEngine } from './engine.js';
import { ModSet, applyMods } from './mods.js';
import { J, gradeFor, noteIsHold, chartKeys } from './model.js';
import { FX } from './fxstate.js';
import { smoothstep, clamp } from './util.js';
import { store, keyLabel } from './store.js';
import { bufferFor } from './buffers.js';
import { AudioEngine } from './audio.js';

const LEAD_IN = 2.6;
const SLOW_DUR = 0.8;

export class GameSession {
  constructor(app, song, chartIndex, opts = {}) {
    this.app = app; this.audio = app.audio;
    this.settings = { ...store.settings };
    this.chartIndex = Math.min(chartIndex, song.charts.length - 1);
    song = { ...song, keyCount: chartKeys(song, this.chartIndex) };      // charts can have their own key count
    this.origSong = song;
    const chart0 = song.charts[this.chartIndex];
    const isTutorial = (chart0.lessons || []).length > 0;
    this.fromEditor = !!opts.fromEditor;
    this.mods = (this.fromEditor || isTutorial) ? new ModSet() : new ModSet(this.settings.mods);
    this.song = applyMods(song, this.chartIndex, this.mods);
    this.chart = this.song.charts[this.chartIndex];
    this.startTime = opts.startTime || 0;
    this.scoreMultiplier = this.mods.multiplier(song.keyCount);
    this.engine = new GameEngine(this.chart, this.song.keyCount, this.startTime, this.mods.windowScale);
    this.engine.bot = this.settings.autoplay;
    this.fx = new FX();
    this.engine.onEvent = (e) => this.onEngineEvent(e);

    const keys = store.keys(this.song.keyCount);
    this.laneMap = new Map(keys.map((c, i) => [c, i]));
    this.keyLabels = [...keys.map(keyLabel), keyLabel(this.settings.slideLeft), keyLabel(this.settings.slideRight)];

    this.phase = 'loading'; this.countdown = 0; this.pauseIndex = 0; this.errorText = '';
    this.activeLesson = null; this.lessonNumber = 0;
    this.lessons = this.settings.autoplay ? [] : (this.chart.lessons || []).filter((l) => l.time > this.startTime).sort((a, b) => a.time - b.time);
    this.lessonTotal = this.lessons.length;
    this.lessonIdx = 0; this.lessonState = 'none';
    this.songClock = 0; this.lastWall = 0; this.rate = 1; this.resumeBeginWall = 0;
    this.pausedTime = 0; this.clampMin = null; this.countdownEnd = 0; this.finishRequested = false;
    this.pressBuf = []; this.pressTimer = null; this.timer = null;
    this.onFinish = null; this.onQuit = null; this.onRestart = null; this.onPhase = null;
    this.speed = this.mods.speed;
  }

  get scaled() { return this.lessons.length > 0; }
  setPhase(p) { this.phase = p; if (this.onPhase) this.onPhase(p); }

  async prepare() {
    this.setPhase('loading');
    let buf;
    try { buf = await bufferFor(this.audio, this.origSong); }
    catch (e) { this.errorText = e.message || 'Couldn\'t load the audio for this song.'; this.setPhase('failed'); return; }
    this.audio.setVolumes(this.settings.musicVolume, this.settings.sfxVolume);
    this.audio.setBuffer(this.origSong.builtinKey ? 'b:' + this.origSong.builtinKey : 'c:' + this.origSong.id, buf);
    this.fx.reset();
    this.audio.owner = this;
    this.audio.play(this.startTime, LEAD_IN, this.scaled ? 1 : this.speed);
    if (this.scaled) { this.songClock = this.audio.position(AudioEngine.perfNow()); this.lastWall = AudioEngine.perfNow(); this.rate = 1; }
    this.setPhase('running');
    this.timer = setInterval(() => this.tick(), 1000 / 144);
  }

  shutdown() {
    clearInterval(this.timer); this.timer = null;
    clearTimeout(this.pressTimer);
    if (this.phase === 'finished') { if (this.audio.owner === this) this.audio.owner = null; }
    else this.audio.stopIfOwner(this);
  }

  // ---------------------------------------------------------------- clock
  time(wall = AudioEngine.perfNow()) {
    const off = this.settings.audioOffsetMs / 1000;
    switch (this.phase) {
      case 'loading': case 'failed': return this.startTime - LEAD_IN;
      case 'paused': return this.pausedTime;
      case 'finished': return Math.max(this.engine.lastTime, this.scaled ? this.songClock - off : this.audio.position(wall - off));
      default: {
        const raw = this.scaled ? this.songClock + (wall - this.lastWall) * this.rate - off : this.audio.position(wall - off);
        return this.clampMin != null ? Math.max(raw, this.clampMin) : raw;
      }
    }
  }
  songTimeFromEvent(ts) {
    const h = ts / 1000, off = this.settings.audioOffsetMs / 1000;
    if (this.scaled) return this.songClock + (h - this.lastWall) * this.rate - off;
    return this.audio.position(h - off);
  }

  tick() {
    const wall = AudioEngine.perfNow();
    if (this.phase === 'countdown') {
      const remaining = this.countdownEnd - wall, c = Math.max(0, Math.ceil(remaining));
      if (c !== this.countdown) { this.countdown = c; if (c > 0) this.audio.playSfx('beep'); if (this.onPhase) this.onPhase('countdown'); }
      if (remaining <= 0) {
        this.clampMin = null; this.audio.playSfx('go', 0.6);
        if (this.scaled) { this.lastWall = wall; this.rate = 1; }
        this.setPhase('running');
      }
      this.engine.update(this.pausedTime - 0.0001);
      return;
    }
    if (this.phase !== 'running') return;
    if (this.scaled) this.advanceScaled(wall);
    const t = this.time(wall);
    this.engine.update(t);
    if (!this.finishRequested) {
      const fm = this.mods.failMode, c = this.engine.counts;
      if (fm === 'suddenDeath' && c[J.MISS] > 0) { this.finishRequested = true; this.finish('Sudden Death — you missed'); }
      else if (fm === 'perfectOnly' && c[J.GREAT] + c[J.GOOD] + c[J.MISS] > 0) { this.finishRequested = true; this.finish('Perfect Only — not a PERFECT'); }
    }
    const outroEnd = Math.min(this.song.duration - 0.3, this.engine.lastTime + 7);
    if (!this.finishRequested && this.engine.isFinished && t > this.engine.lastTime + 0.8 && t >= outroEnd) { this.finishRequested = true; this.finish(); }
    else if (!this.finishRequested && t > this.song.duration + 2) { this.finishRequested = true; this.finish(); }
  }

  finish(failed = null) {
    clearInterval(this.timer);
    this.setPhase('finished');
    const e = this.engine;
    const r = {
      songId: this.origSong.id, songTitle: this.song.title, artist: this.song.artist, chartName: this.chart.name, chartLevel: this.chart.level,
      hue: this.song.hue, score: e.score, baseScore: e.score, accuracy: e.accuracy, maxCombo: e.maxCombo, counts: [...e.counts], offsets: e.offsets.slice(),
      totalObjects: e.totalObjects, autoplay: this.settings.autoplay, fromEditor: this.fromEditor, multiplier: this.scoreMultiplier, modLabel: this.mods.label,
      failed: !!failed, failReason: failed || '', newBest: false,
    };
    r.score = Math.round(r.baseScore * this.scoreMultiplier);
    r.fullCombo = r.counts[J.MISS] === 0 && r.totalObjects > 0;
    r.allPerfect = r.counts[J.PERFECT] === r.totalObjects && r.totalObjects > 0;
    r.grade = gradeFor(r);
    r.newBest = store.submitScore(r);
    this.audio.fadeOut(1.8);
    if (this.onFinish) this.onFinish(r);
  }

  // ---------------------------------------------------------------- tutorial lessons
  advanceScaled(wall) {
    const dt = Math.max(0, wall - this.lastWall);
    this.songClock += dt * this.rate; this.lastWall = wall;
    switch (this.lessonState) {
      case 'none':
        this.rate = 1;
        if (this.lessonIdx < this.lessons.length && this.lessons[this.lessonIdx].time - this.songClock <= SLOW_DUR) this.lessonState = 'stopping';
        break;
      case 'stopping': {
        const L = this.lessons[this.lessonIdx], rem = L.time - this.songClock;
        if (rem <= 0.008) {
          this.songClock = L.time; this.rate = 0; this.lessonState = 'stopped';
          this.audio.stop(); this.audio.playSfx('select', 0.7);
          this.lessonNumber = this.lessonIdx + 1; this.activeLesson = L;
          if (this.onPhase) this.onPhase('lesson');
        } else {
          const r = rem / SLOW_DUR;
          this.rate = r >= 0.25 ? r : 0.25 * Math.sqrt(r / 0.25);
          this.audio.setRate(Math.max(0.25, this.rate));
        }
        break;
      }
      case 'stopped': this.rate = 0; break;
      case 'resuming': {
        const since = wall - this.resumeBeginWall;
        if (since < 0) this.rate = 0;
        else {
          const p = since / 0.7;
          if (p >= 1) { this.rate = 1; this.audio.setRate(1); this.lessonState = 'none'; this.lessonIdx++; }
          else { this.rate = 0.25 + 0.75 * smoothstep(p); this.audio.setRate(this.rate); }
        }
        break;
      }
      default: break;
    }
  }
  lessonKeyMatches(code, L) {
    if (code === 'Space' || code === 'Enter' || code === 'NumpadEnter') return true;
    if (L.key === 'slideLeft') return code === this.settings.slideLeft;
    if (L.key === 'slideRight') return code === this.settings.slideRight;
    return false;
  }
  beginResume() {
    if (this.lessonState !== 'stopped') return;
    this.activeLesson = null;
    this.audio.owner = this;
    const w = AudioEngine.perfNow();
    this.audio.play(Math.max(0, this.songClock), 0.03, 0.25);
    this.lastWall = w; this.resumeBeginWall = w + 0.03; this.rate = 0; this.lessonState = 'resuming';
    this.audio.playSfx('select', 0.6);
    if (this.onPhase) this.onPhase('lessonEnd');
  }
  lessonText(L) {
    let t = L.text.replace(/\{SL\}/g, keyLabel(this.settings.slideLeft)).replace(/\{SR\}/g, keyLabel(this.settings.slideRight));
    store.keys(this.song.keyCount).forEach((c, i) => { t = t.replace(new RegExp(`\\{K${i + 1}\\}`, 'g'), keyLabel(c)); });
    return t;
  }
  lessonKeyLabels(L) {
    if (L.key === 'slideLeft') return [keyLabel(this.settings.slideLeft)];
    if (L.key === 'slideRight') return [keyLabel(this.settings.slideRight)];
    return ['Space'];
  }

  // ---------------------------------------------------------------- pause
  pause() {
    if (this.phase !== 'running' && this.phase !== 'countdown') return;
    this.pausedTime = this.time();
    if (this.scaled) {
      const w = AudioEngine.perfNow();
      this.songClock += (w - this.lastWall) * this.rate; this.lastWall = w;
      if (this.lessonState === 'resuming') { this.lessonState = 'none'; this.lessonIdx++; this.rate = 1; }
      if (this.lessonState !== 'stopped') this.rate = 0;
    }
    this.audio.stop(); this.clampMin = null; this.pauseIndex = 0;
    this.setPhase('paused');
  }
  resume() {
    if (this.phase !== 'paused') return;
    if (this.scaled && this.lessonState === 'stopped') { this.setPhase('running'); return; }
    this.audio.playSfx('beep', 0.5);
    this.clampMin = this.pausedTime; this.audio.owner = this;
    this.audio.play(Math.max(0, this.pausedTime), 3.0, this.scaled ? 1 : this.speed);
    if (this.scaled) { this.songClock = this.pausedTime + this.settings.audioOffsetMs / 1000; this.lastWall = AudioEngine.perfNow(); this.rate = 0; }
    this.countdownEnd = AudioEngine.perfNow() + 3; this.countdown = 3;
    this.setPhase('countdown');
  }
  restart() { this.shutdown(); if (this.onRestart) this.onRestart(); }
  quit() { this.shutdown(); if (this.onQuit) this.onQuit(); }

  // ---------------------------------------------------------------- input
  onKeyDown(ev) {
    if (ev.repeat) return true;
    const code = ev.code;
    switch (this.phase) {
      case 'loading': case 'failed': if (code === 'Escape') this.quit(); return true;
      case 'paused':
        if (code === 'Escape') this.resume();
        else if (code === 'ArrowUp') { this.pauseIndex = (this.pauseIndex + 2) % 3; this.audio.playSfx('move'); if (this.onPhase) this.onPhase('pauseSel'); }
        else if (code === 'ArrowDown') { this.pauseIndex = (this.pauseIndex + 1) % 3; this.audio.playSfx('move'); if (this.onPhase) this.onPhase('pauseSel'); }
        else if (code === 'Enter' || code === 'Space') { this.audio.playSfx('select'); [() => this.resume(), () => this.restart(), () => this.quit()][this.pauseIndex](); }
        return true;
      case 'countdown': if (code === 'Escape') this.pause(); return true;
      case 'finished': return true;
      default: break;
    }
    if (code === 'Escape') { this.pause(); return true; }
    if (this.scaled && this.lessonState === 'stopped' && this.activeLesson) {
      if (this.lessonKeyMatches(code, this.activeLesson)) this.beginResume();
      return true;
    }
    if (this.settings.autoplay) return true;
    const lane = this.laneMap.get(code);
    if (lane != null) {
      this.pressBuf.push({ lane, t: ev.timeStamp });
      if (!this.pressTimer) this.pressTimer = setTimeout(() => this.flushPresses(), 4);
    } else if (code === this.settings.slideLeft) { this.fx.slideLeftPress = 1; this.engine.slide(-1, this.songTimeFromEvent(ev.timeStamp)); }
    else if (code === this.settings.slideRight) { this.fx.slideRightPress = 1; this.engine.slide(1, this.songTimeFromEvent(ev.timeStamp)); }
    return true;
  }
  /** Keys pressed within ~4 ms are judged together so a mash of keys can be told apart from a real chord. */
  flushPresses() {
    this.pressTimer = null;
    const buf = this.pressBuf; this.pressBuf = [];
    if (this.phase !== 'running') return;
    buf.forEach((p, i) => this.engine.press(p.lane, this.songTimeFromEvent(p.t), buf.length - 1 - i));
  }
  onKeyUp(ev) {
    const lane = this.laneMap.get(ev.code);
    if (lane == null) return true;
    if (this.phase === 'paused' || this.phase === 'countdown') { this.engine.release(lane, this.pausedTime); return true; }
    if (this.phase !== 'running' || this.settings.autoplay) return true;
    if (this.scaled && this.lessonState === 'stopped') return true;      // releases during a lesson stop are ignored
    // a key released before its press was flushed still has to be pressed first
    if (this.pressBuf.length) this.flushPresses();
    this.engine.release(lane, this.songTimeFromEvent(ev.timeStamp));
    return true;
  }

  onEngineEvent(e) {
    this.fx.queue.push(e);
    if (!this.settings.hitSounds) return;
    if (e.type === 'hit') {
      if (e.kind === 'tap') this.audio.playSfx('tap'); else if (e.kind === 'holdHead') this.audio.playSfx('hold');
      else if (e.kind === 'slide') this.audio.playSfx('slide'); else this.audio.playSfx('tap', 0.6);
    } else if (e.type === 'miss' && (e.kind === 'tap' || e.kind === 'holdHead')) this.audio.playSfx('miss', 0.6);
  }
}
