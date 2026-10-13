// Settings, scores and the song library (custom songs live in IndexedDB).
import { makeBuiltinSongs } from './songs.js';
import { ModSet } from './mods.js';

export function defaultSettings() {
  return {
    keymaps: {
      1: ['Space'], 2: ['KeyF', 'KeyJ'], 3: ['KeyF', 'Space', 'KeyJ'], 4: ['KeyD', 'KeyF', 'KeyJ', 'KeyK'],
      5: ['KeyD', 'KeyF', 'Space', 'KeyJ', 'KeyK'], 6: ['KeyS', 'KeyD', 'KeyF', 'KeyJ', 'KeyK', 'KeyL'],
      7: ['KeyS', 'KeyD', 'KeyF', 'Space', 'KeyJ', 'KeyK', 'KeyL'], 8: ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon'],
    },
    slideLeft: 'ControlLeft', slideRight: 'ControlRight',
    scrollSpeed: 7, audioOffsetMs: 0, musicVolume: 0.8, sfxVolume: 0.6,
    hitSounds: true, particles: true, screenShake: true, beatPulse: true, showFPS: false, autoplay: false, chartEffects: true,
    mods: [], skin: 'original',
    background: { mode: 'skin', preset: 'slate', top: [0.5, 0.5, 0.5], bottom: [0.4, 0.4, 0.4], dim: 0.45, hasImage: false },
  };
}

export const KEY_COUNTS = [1, 2, 3, 4, 5, 6, 7, 8];
export const SONG_KEY_COUNTS = [3, 4, 5, 6, 7, 8];

const NAMES = { Space: 'Space', Enter: 'Enter', Tab: 'Tab', Backspace: '⌫', Escape: 'Esc', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
  ControlLeft: 'L Ctrl', ControlRight: 'R Ctrl', ShiftLeft: 'L Shift', ShiftRight: 'R Shift', AltLeft: 'L Alt', AltRight: 'R Alt', MetaLeft: 'L Win', MetaRight: 'R Win',
  CapsLock: 'Caps', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\', BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=', Backquote: '`' };
export function keyLabel(code) {
  if (NAMES[code]) return NAMES[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad/.test(code)) return 'Num' + code.slice(6);
  return code;
}

class Store {
  constructor() {
    this.listeners = new Set();
    let s = defaultSettings();
    try {
      const raw = JSON.parse(localStorage.getItem('manidim.settings.v1') || 'null');
      if (raw) s = { ...s, ...raw, keymaps: { ...s.keymaps, ...(raw.keymaps || {}) }, background: { ...s.background, ...(raw.background || {}) } };
    } catch (e) { /* ignore corrupt settings */ }
    s.autoplay = false;                      // never carry autoplay across launches
    this.settings = s;
    try { this.scores = JSON.parse(localStorage.getItem('manidim.scores.v1') || '{}'); } catch (e) { this.scores = {}; }
    this.suppressSave = false;
    this.bgImage = null;
  }
  save() { if (!this.suppressSave) localStorage.setItem('manidim.settings.v1', JSON.stringify(this.settings)); }
  set(patch) { Object.assign(this.settings, patch); this.save(); this.listeners.forEach((f) => f(this.settings)); }
  setBackground(patch) { this.settings.background = { ...this.settings.background, ...patch }; this.save(); this.listeners.forEach((f) => f(this.settings)); }
  onChange(f) { this.listeners.add(f); return () => this.listeners.delete(f); }
  get modSet() { return new ModSet(this.settings.mods); }
  keys(count) { return this.settings.keymaps[count] || defaultSettings().keymaps[count] || []; }
  resetKeys() { const d = defaultSettings(); this.set({ keymaps: d.keymaps, slideLeft: d.slideLeft, slideRight: d.slideRight }); }

  /** Assign a key to a lane, swapping if another lane/slide key already uses it. */
  bindLane(lane, count, code) {
    const keys = [...this.keys(count)];
    const old = keys[lane];
    const other = keys.indexOf(code);
    if (other >= 0 && other !== lane) keys[other] = old;
    const patch = {};
    if (this.settings.slideLeft === code) patch.slideLeft = old; else if (this.settings.slideRight === code) patch.slideRight = old;
    keys[lane] = code;
    this.set({ ...patch, keymaps: { ...this.settings.keymaps, [count]: keys } });
  }
  bindSlide(left, count, code) {
    const old = left ? this.settings.slideLeft : this.settings.slideRight;
    const keys = [...this.keys(count)];
    const idx = keys.indexOf(code);
    const patch = {};
    if (idx >= 0) { keys[idx] = old; patch.keymaps = { ...this.settings.keymaps, [count]: keys }; }
    if (left) { if (this.settings.slideRight === code) patch.slideRight = old; patch.slideLeft = code; }
    else { if (this.settings.slideLeft === code) patch.slideLeft = old; patch.slideRight = code; }
    this.set(patch);
  }

  bestScore(songId, chart) { return this.scores[`${songId}|${chart}`] || null; }
  submitScore(r) {
    if (r.autoplay || r.fromEditor || r.failed) return false;
    const k = `${r.songId}|${r.chartName}`;
    const rec = { score: r.score, accuracy: r.accuracy, maxCombo: r.maxCombo, grade: r.grade, fullCombo: r.fullCombo, mods: r.modLabel || null };
    if (this.scores[k] && this.scores[k].score >= rec.score) return false;
    this.scores[k] = rec;
    localStorage.setItem('manidim.scores.v1', JSON.stringify(this.scores));
    return true;
  }
}
export const store = new Store();

// ------------------------------------------------------------------ IndexedDB
let dbPromise = null;
function db() {
  if (!dbPromise) dbPromise = new Promise((res, rej) => {
    const rq = indexedDB.open('manidim', 1);
    rq.onupgradeneeded = () => { const d = rq.result; d.createObjectStore('songs', { keyPath: 'id' }); d.createObjectStore('kv'); };
    rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
  });
  return dbPromise;
}
const tx = async (storeName, mode, fn) => {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(storeName, mode); const st = t.objectStore(storeName); const rq = fn(st);
    t.oncomplete = () => res(rq && rq.result); t.onerror = () => rej(t.error);
  });
};
export const idbPut = (s, v, key) => tx(s, 'readwrite', (st) => st.put(v, key));
export const idbGet = (s, key) => tx(s, 'readonly', (st) => st.get(key));
export const idbDel = (s, key) => tx(s, 'readwrite', (st) => st.delete(key));
export const idbAll = (s) => tx(s, 'readonly', (st) => st.getAll());

// ------------------------------------------------------------------ library
export const library = {
  songs: [],
  async load() {
    const builtin = makeBuiltinSongs();
    let custom = [];
    try { custom = (await idbAll('songs')).map((r) => r.song); } catch (e) { /* no IndexedDB */ }
    custom.sort((a, b) => a.title.localeCompare(b.title));
    this.songs = [...builtin, ...custom];
    try { store.bgImage = (await idbGet('kv', 'bgImage')) || null; } catch (e) { /* ignore */ }
    return this.songs;
  },
  get(id) { return this.songs.find((s) => s.id === id) || null; },
  async saveCustom(song, audio /* {bytes: ArrayBuffer, name} optional */) {
    const prev = await idbGet('songs', song.id).catch(() => null);
    const rec = { id: song.id, song, audio: audio ? audio.bytes : (prev ? prev.audio : null), audioName: audio ? audio.name : (prev ? prev.audioName : null) };
    await idbPut('songs', rec);
    const i = this.songs.findIndex((s) => s.id === song.id);
    if (i >= 0) this.songs[i] = song; else this.songs.push(song);
  },
  async audioFor(song) { const r = await idbGet('songs', song.id); return r ? { bytes: r.audio, name: r.audioName } : null; },
  async deleteCustom(song) { await idbDel('songs', song.id); this.songs = this.songs.filter((s) => s.id !== song.id); },
};
