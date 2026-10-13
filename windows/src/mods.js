import { clamp, RNG, hashString } from './util.js';
import { newNote, noteIsHold, segments, sortNotes } from './model.js';

export const CATEGORIES = [
  { id: 'conversion', title: 'Conversion', blurb: 'Change how the chart is laid out', tint: '#9dbcff' },
  { id: 'easy', title: 'Easy', blurb: 'Make the song more forgiving', tint: '#8cebA0' },
  { id: 'hard', title: 'Hard', blurb: 'Turn up the challenge', tint: '#ff8080' },
];

const keyMod = (k) => ({
  id: `k${k}`, keyCount: k, category: 'conversion', group: 'keys', title: `${k}K`, acronym: `${k}K`, icon: '▦', multiplier: 1,
  blurb: k === 1 ? 'One lane: a pure rhythm chart.' : `Squeeze or spread the chart onto ${k} lanes.`,
});

export const MODS = [
  ...[1, 2, 3, 4, 5, 6, 7, 8].map(keyMod),
  { id: 'mirror', category: 'conversion', group: 'layout', title: 'Mirror', acronym: 'MR', icon: '⇋', multiplier: 1.0, blurb: 'Flip the chart left ↔ right.' },
  { id: 'random', category: 'conversion', group: 'layout', title: 'Random', acronym: 'RD', icon: '🔀', multiplier: 1.05, blurb: 'Shuffle which lane is which (the same shuffle every time).' },
  { id: 'classic', category: 'easy', title: 'Classic Layout', acronym: 'CL', icon: '▥', multiplier: 0.9, blurb: 'A vertical, mania-style stage — easier to read.' },
  { id: 'halfTime', category: 'easy', group: 'speed', title: 'Half Time', acronym: 'HT', icon: '🐢', multiplier: 0.7, blurb: 'The song plays at 0.75× speed (lower pitch).' },
  { id: 'noSlides', category: 'easy', group: 'holds', title: 'No Slides', acronym: 'NS', icon: '⊖', multiplier: 0.85, blurb: 'Slide notes become plain holds.' },
  { id: 'holdOff', category: 'easy', group: 'holds', title: 'Hold Off', acronym: 'HO', icon: '👆', multiplier: 0.75, blurb: 'Every hold becomes a simple tap.' },
  { id: 'wideWindows', category: 'easy', group: 'windows', title: 'Wide Windows', acronym: 'WW', icon: '⤢', multiplier: 0.85, blurb: 'Timing windows are 40% more forgiving.' },
  { id: 'blindSpot', category: 'hard', group: 'vis', title: 'Blind Spot', acronym: 'BS', icon: '🙈', multiplier: 1.12, blurb: 'Notes vanish halfway to the circle.' },
  { id: 'blindSpot2', category: 'hard', group: 'vis', title: 'Blind Spot 2', acronym: 'B2', icon: '🌫', multiplier: 1.10, blurb: 'Notes only fade in as they get close.' },
  { id: 'blackout', category: 'hard', group: 'vis', title: 'Blackout', acronym: 'BO', icon: '🌙', multiplier: 1.4, blurb: 'Notes are invisible. Play by ear!' },
  { id: 'fastForward', category: 'hard', group: 'speed', title: 'Fast Forward', acronym: 'FF', icon: '⏩', multiplier: 1.1, blurb: 'The song plays at 1.25× speed.' },
  { id: 'doubleTime', category: 'hard', group: 'speed', title: 'Double Time', acronym: 'DT', icon: '🐇', multiplier: 1.3, blurb: 'The song plays at 1.5× speed (higher pitch).' },
  { id: 'strict', category: 'hard', group: 'windows', title: 'Strict Timing', acronym: 'ST', icon: '🎯', multiplier: 1.1, blurb: 'Timing windows are 40% tighter.' },
  { id: 'suddenDeath', category: 'hard', group: 'fail', title: 'Sudden Death', acronym: 'SD', icon: '💔', multiplier: 1.15, blurb: 'Any miss fails the song.' },
  { id: 'perfectOnly', category: 'hard', group: 'fail', title: 'Perfect Only', acronym: 'PF', icon: '⭐', multiplier: 1.3, blurb: 'Anything but PERFECT fails the song.' },
  { id: 'doubleNotes', category: 'hard', title: 'Double Notes', acronym: 'DN', icon: '⧉', multiplier: 1.2, blurb: 'Lone taps get a mirrored partner note.' },
];
export const MOD_BY_ID = Object.fromEntries(MODS.map((m) => [m.id, m]));

export function keyMultiplier(orig, target) {
  if (target === orig) return 1;
  if (target < orig) return 0.55 + 0.45 * target / Math.max(1, orig);
  return 1 + 0.07 * (target - orig);
}

export class ModSet {
  constructor(ids = []) { this.ids = new Set(ids.filter((i) => MOD_BY_ID[i])); }
  has(id) { return this.ids.has(id); }
  get isEmpty() { return this.ids.size === 0; }
  get keyCount() { for (const i of this.ids) if (MOD_BY_ID[i].keyCount) return MOD_BY_ID[i].keyCount; return null; }
  get classic() { return this.has('classic'); }
  get speed() { return this.has('halfTime') ? 0.75 : this.has('fastForward') ? 1.25 : this.has('doubleTime') ? 1.5 : 1; }
  get windowScale() { return this.has('strict') ? 0.6 : this.has('wideWindows') ? 1.4 : 1; }
  get visibility() { return this.has('blackout') ? 'blackout' : this.has('blindSpot2') ? 'blindSpot2' : this.has('blindSpot') ? 'blindSpot' : 'none'; }
  get failMode() { return this.has('suddenDeath') ? 'suddenDeath' : this.has('perfectOnly') ? 'perfectOnly' : 'none'; }
  multiplier(origKeys) {
    let m = 1;
    for (const id of this.ids) {
      const d = MOD_BY_ID[id];
      m *= d.keyCount ? keyMultiplier(origKeys, d.keyCount) : d.multiplier;
    }
    return m;
  }
  get label() { return MODS.filter((m) => this.ids.has(m.id)).map((m) => m.acronym).join(' '); }
  toggle(id) {
    if (this.ids.has(id)) { this.ids.delete(id); return; }
    const g = MOD_BY_ID[id].group;
    if (g) for (const o of [...this.ids]) if (MOD_BY_ID[o].group === g) this.ids.delete(o);
    this.ids.add(id);
  }
  get list() { return MODS.filter((m) => this.ids.has(m.id)).map((m) => m.id); }
}

/** Returns a copy of the song whose chart `chartIndex` has been rewritten for the active mods. */
export function applyMods(song, chartIndex, mods) {
  if (mods.isEmpty || !song.charts.length) return song;
  const ci = Math.min(chartIndex, song.charts.length - 1);
  const chart = song.charts[ci];
  const orig = song.keyCount;
  const N = mods.keyCount ?? orig;
  const rng = new RNG(hashString(song.id + chart.name));

  const map = Array.from({ length: orig }, (_, i) => i);
  if (N !== orig) {
    for (let l = 0; l < orig; l++) {
      if (N < orig) map[l] = Math.min(N - 1, Math.floor(l * N / orig));
      else if (orig === 1) map[l] = Math.floor(N / 2);
      else map[l] = Math.round(l * (N - 1) / (orig - 1));
    }
  }
  if (mods.has('random')) {
    const perm = Array.from({ length: N }, (_, i) => i);
    for (let i = N - 1; i > 0; i--) { const j = rng.int(0, i); [perm[i], perm[j]] = [perm[j], perm[i]]; }
    for (let l = 0; l < orig; l++) map[l] = perm[map[l]];
  }
  if (mods.has('mirror')) for (let l = 0; l < orig; l++) map[l] = N - 1 - map[l];

  const upscale = N > orig;
  let converted = [];
  for (const n of chart.notes) {
    let lane = map[clamp(n.lane, 0, orig - 1)];
    if (upscale && !noteIsHold(n)) lane = clamp(lane + rng.pick([-1, 0, 0, 1]), 0, N - 1);
    const out = newNote(n.time, lane, n.duration, []);
    if (mods.has('holdOff')) out.duration = 0;
    if (noteIsHold(out) && !mods.has('noSlides') && !mods.has('holdOff')) {
      let cur = lane, l = n.lane;
      for (const s of n.slides) {
        l = clamp(l + s.dir, 0, orig - 1);
        const target = map[l];
        if (target === cur) continue;
        if (Math.abs(target - cur) === 1) { out.slides.push({ time: s.time, dir: target - cur }); cur = target; } else break;
      }
    }
    converted.push(out);
  }
  sortNotes(converted);

  const busy = Array.from({ length: N }, () => []);
  const pad = N <= 2 ? 0.12 : 0.09;
  const free = (lane, from, to) => !busy[lane].some((b) => b.from < to + pad && b.to > from - pad);
  let kept = [];
  for (const n of converted) {
    const segs = segments(n, N);
    if (segs.some((s) => !free(s.lane, s.from, s.to))) continue;
    for (const s of segs) busy[s.lane].push({ from: s.from, to: s.to });
    kept.push(n);
  }
  if (mods.has('doubleNotes') && N >= 2) {
    const times = kept.map((n) => n.time);
    for (const n of [...kept]) {
      if (noteIsHold(n)) continue;
      const near = times.filter((t) => Math.abs(t - n.time) < 0.1).length;
      if (near !== 1 || !rng.chance(0.7)) continue;
      const m = N - 1 - n.lane;
      if (m !== n.lane && free(m, n.time, n.time)) { busy[m].push({ from: n.time, to: n.time }); kept.push(newNote(n.time, m)); }
    }
  }
  sortNotes(kept);
  const charts = song.charts.slice();
  charts[ci] = { ...chart, notes: kept };
  return { ...song, keyCount: N, charts };
}
