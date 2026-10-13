import { AudioEngine } from './audio.js';
import { store, library } from './store.js';
import { Demo } from './demo.js';
import { drawBackdrop } from './renderer.js';
import { backdropSpec } from './theme.js';
import { clear, h } from './ui/dom.js';
import * as Home from './ui/home.js';
import * as Songs from './ui/songs.js';
import * as Settings from './ui/settings.js';
import * as Game from './ui/game.js';
import * as Results from './ui/results.js';
import * as Editor from './ui/editor.js';

const SCREENS = { home: Home, songs: Songs, settings: Settings, game: Game, results: Results, editor: Editor };

export const app = {
  store, library, audio: null, demo: null, current: null, name: null, session: null, result: null,
  selectedSongId: null, selectedChart: 1, editorSongId: null, editorState: { playhead: 0, chart: 0 },
  overlayKey: null, capture: null, hueOverride: null,
  go(name, params = {}) {
    if (this.current && this.current.destroy) this.current.destroy();
    this.capture = null; this.overlayKey = null;
    document.getElementById('overlay').replaceChildren();
    const prev = this.name;
    this.name = name;
    if (prev === 'home' && name !== 'home') this.demo.setMusic(false);
    if (name === 'home' && prev !== 'home') this.demo.setMusic(true);
    const root = clear(document.getElementById('ui'));
    this.current = SCREENS[name].mount(this, root, params);
  },
  toast(text) {
    const t = document.getElementById('toast'); t.replaceChildren(h('div', { class: 'toast' }, text));
    clearTimeout(this._toast); this._toast = setTimeout(() => t.replaceChildren(), 2600);
  },
};

async function boot() {
  app.audio = new AudioEngine();
  await library.load();
  app.audio.setVolumes(store.settings.musicVolume, store.settings.sfxVolume);
  store.onChange((s) => app.audio.setVolumes(s.musicVolume, s.sfxVolume));
  app.selectedSongId = (library.get('builtin.neon-drive') || library.songs[0]).id;
  app.demo = new Demo(app);
  try { await Promise.all(['600', '700', '800', '900'].map((w) => document.fonts.load(`${w} 20px Nunito`))); } catch (e) { /* fonts optional */ }

  const params = new URLSearchParams(location.search);
  if (params.get('suppress')) store.suppressSave = true;
  if (params.get('skin')) store.settings.skin = params.get('skin');
  if (params.get('mods')) store.settings.mods = params.get('mods').split(',').filter(Boolean);
  if (params.get('autoplay')) store.settings.autoplay = true;

  // ---- stage
  const canvas = document.getElementById('stage'), ctx = canvas.getContext('2d');
  let W = 0, H = 0, dpr = 1;
  const resize = () => { dpr = window.devicePixelRatio || 1; W = window.innerWidth; H = window.innerHeight; canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); };
  window.addEventListener('resize', resize); resize();
  const frame = () => {
    const wall = AudioEngine.perfNow();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cur = app.current;
    if (cur && cur.draw) cur.draw(ctx, W, H, wall);
    else {
      const s = store.settings, hue = app.hueOverride ?? (library.get(app.selectedSongId)?.hue ?? 0.5);
      drawBackdrop(ctx, W, H, { x: W / 2, y: H * 0.6 }, Math.max(0.4, Math.min(H / 800, W / 1180)), backdropSpec(s.background, s.skin, false, store.bgImage), hue, wall);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // ---- input
  const typing = (e) => { const t = e.target; return t && (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || (t.tagName === 'INPUT' && !['range', 'color', 'checkbox', 'button'].includes(t.type))); };
  const route = (e, down) => {
    app.audio.resume();
    if (typing(e)) {
      if (down && e.code === 'Escape') { e.target.blur(); e.preventDefault(); }
      else if (down && (e.code === 'Enter' || e.code === 'NumpadEnter') && e.target.tagName !== 'TEXTAREA') { e.target.blur(); }
      return;
    }
    e.preventDefault();
    if (app.capture) { if (down) app.capture(e); return; }
    if (down && app.overlayKey && app.overlayKey(e)) return;
    const cur = app.current; if (!cur) return;
    if (down) cur.onKey && cur.onKey(e); else cur.onKeyUp && cur.onKeyUp(e);
  };
  window.addEventListener('keydown', (e) => route(e, true), true);
  window.addEventListener('keyup', (e) => route(e, false), true);
  if (!params.get('keybot')) window.addEventListener('blur', () => { if (app.session && app.session.phase === 'running') app.session.pause(); });
  window.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('pointerdown', () => app.audio.resume(), { once: false });
  window.app = app;

  const first = params.get('screen') || 'home';
  if (params.get('play')) {
    const s = library.songs.find((x) => x.builtinKey === params.get('play'));
    app.session = null; app.go('game', { song: s, chartIndex: Number(params.get('chart') || 1), startTime: Number(params.get('from') || 0) });
  } else app.go(first);
  if (params.get('editdemo')) {
    const { audioBytesFor } = await import('./madim.js');
    const src = library.songs.find((x) => x.builtinKey === 'neon-drive'), a = await audioBytesFor(app, src);
    const copy = { ...structuredClone(src), id: 'custom.debugdemo', title: 'Neon Drive (Remix)', builtinKey: null, audioFile: 'audio.wav' };
    await library.saveCustom(copy, { bytes: a.bytes, name: 'audio.wav' });
    app.editorSongId = copy.id; app.editorState = { playhead: 30.9, chart: 2 }; app.go('editor');
  }
  if (params.get('newsong')) import('./ui/newsong.js').then((m) => m.showNewSong(app));
  if (params.get('howto')) import('./ui/home.js').then((m) => m.showHowTo(app));
  if (params.get('results')) {
    app.result = { songId: 'builtin.neon-drive', songTitle: 'Neon Drive', artist: 'Vector Hearts', chartName: 'Hard', chartLevel: 7, hue: 0.83, score: 947210, baseScore: 947210, accuracy: 0.962, maxCombo: 211,
      counts: [280, 30, 6, 2], offsets: Array.from({ length: 300 }, () => Math.random() * 0.19 - 0.1), totalObjects: 318, autoplay: false, fromEditor: false, multiplier: 1.28, modLabel: '6K BS', failed: false, failReason: '', newBest: true, grade: 'A', fullCombo: false, allPerfect: false };
    app.go('results');
  }
  if (params.get('keybot')) runKeyBot(params);
  window.__devImport = async (list) => {       // dev only (MANIDIM_IMPORT): import files like the Import button does
    try {
      const files = list.map((f) => new File([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))], f.name));
      const { importOsuFiles } = await import('./osu.js');
      const song = await importOsuFiles(app, files);
      app.selectedSongId = song.id; app.selectedChart = 0;
      if (params.get('devplay')) { app.session = null; app.go('game', { song, chartIndex: Number(params.get('devplay')), startTime: Number(params.get('from') || 0) }); } else app.go('songs');
    } catch (e) { console.error('devImport failed: ' + e.message); }
  };
  if (params.get('showmods')) import('./ui/mods.js').then((m) => m.showMods(app, library.get(app.selectedSongId), () => {}));
}
boot();

/** Dev tool: presses real keyboard events at each note's time and reports the score (tests input + clock). */
function runKeyBot(params) {
  const down = (code) => window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true }));
  const up = (code) => window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true, cancelable: true }));
  const pressed = new Map(); let slideIdx = new Map();
  const timer = setInterval(() => {
    const s = app.session; if (!s) return;
    if (s.phase === 'finished') { clearInterval(timer); return; }
    if (s.phase !== 'running') return;
    const t = s.time(), keys = store.keys(s.song.keyCount), e = s.engine;
    for (const rn of e.notes) {
      const n = rn.note;
      if (n.time - t > 0.05) break;
      if (rn.state === 'waiting' && !pressed.has(rn) && t >= n.time) {
        pressed.set(rn, { down: true, end: noteEndT(n) }); down(keys[n.lane]);
        if (!(n.duration > 0.001)) setTimeout(() => up(keys[n.lane]), 60);
      }
      const st = pressed.get(rn);
      if (st && n.duration > 0.001) {
        const si = slideIdx.get(rn) || 0;
        if (si < n.slides.length && t >= n.slides[si].time) { down(n.slides[si].dir < 0 ? store.settings.slideLeft : store.settings.slideRight); setTimeout(() => up(n.slides[si].dir < 0 ? store.settings.slideLeft : store.settings.slideRight), 40); slideIdx.set(rn, si + 1); }
        if (st.down && t >= st.end) { st.down = false; up(keys[n.lane]); }
      }
    }
  }, 2);
  if (params.get('keybot') === 'dbg') setInterval(() => { const s = app.session; console.warn('KEYBOTDBG ' + (s ? `${s.phase} t=${s.time().toFixed(2)} judged=${s.engine.judged}/${s.engine.totalObjects} combo=${s.engine.combo}` : 'no session')); }, 4000);
  const noteEndT = (n) => n.time + Math.max(0, n.duration);
  const wait = setInterval(() => {
    if (app.result) { clearInterval(wait); const r = app.result, off = r.offsets.length ? r.offsets.reduce((a, b) => a + b, 0) / r.offsets.length * 1000 : 0;
      console.warn('KEYBOT ' + JSON.stringify({ score: r.score, accuracy: +r.accuracy.toFixed(4), counts: r.counts, maxCombo: r.maxCombo, grade: r.grade, avgOffsetMs: +off.toFixed(1) })); }
  }, 500);
}
