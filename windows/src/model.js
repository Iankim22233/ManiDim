import { clamp, uid } from './util.js';

export const noteIsHold = (n) => n.duration > 0.001;
export const noteEnd = (n) => n.time + Math.max(0, n.duration);

export function newNote(time, lane, duration = 0, slides = []) {
  return { id: uid(), time, lane, duration, slides };
}

export function laneAt(n, t, count) {
  let l = n.lane;
  for (const s of n.slides) if (s.time <= t) l = clamp(l + s.dir, 0, count - 1);
  return l;
}
export const finalLane = (n, count) => laneAt(n, Infinity, count);

/** Path segments of a note: [{lane, from, to}] (a tap is one zero-length segment). */
export function segments(n, count) {
  const out = [];
  let l = n.lane, start = n.time;
  for (const s of n.slides) {
    out.push({ lane: l, from: start, to: s.time });
    l = clamp(l + s.dir, 0, count - 1);
    start = s.time;
  }
  out.push({ lane: l, from: start, to: Math.max(noteEnd(n), start) });
  return out;
}

export const objectCount = (chart) => chart.notes.reduce((a, n) => a + (noteIsHold(n) ? 2 + n.slides.length : 1), 0);
export const sortNotes = (notes) => notes.sort((a, b) => a.time - b.time || a.lane - b.lane);
export const chartLastTime = (chart) => chart.notes.reduce((m, n) => Math.max(m, noteEnd(n)), 0);
export const newChart = (name, level = 1, notes = []) => ({ id: uid(), name, level, notes, events: [], lessons: [], keys: null });
/** Key count of one chart (charts from imported osu sets can differ from the song's). */
export const chartKeys = (song, i) => (song.charts[i] && song.charts[i].keys) || song.keyCount;
export const mixedKeys = (song) => song.charts.some((c) => (c.keys || song.keyCount) !== song.keyCount);
export function keysLabel(song) {
  const ks = song.charts.map((c) => c.keys || song.keyCount);
  const lo = Math.min(...ks, song.keyCount), hi = Math.max(...ks, song.keyCount);
  return lo === hi ? `${song.keyCount}K` : `${lo}–${hi}K`;
}

export const EVENT_KINDS = {
  sparkles: { title: 'Sparkles', icon: '✨', defaultDuration: 2.4, usesHue: false, usesDuration: false },
  flash: { title: 'Flash', icon: '⚡', defaultDuration: 0.45, usesHue: true, usesDuration: false },
  shake: { title: 'Shake', icon: '〰', defaultDuration: 0.5, usesHue: false, usesDuration: false },
  pulse: { title: 'Pulse', icon: '◎', defaultDuration: 0.9, usesHue: true, usesDuration: false },
  fireworks: { title: 'Fireworks', icon: '🎆', defaultDuration: 1.9, usesHue: true, usesDuration: false },
  lasers: { title: 'Lasers', icon: '✦', defaultDuration: 4, usesHue: true, usesDuration: true },
  tint: { title: 'Colour wash', icon: '🎨', defaultDuration: 4, usesHue: true, usesDuration: true },
};
export const EVENT_ORDER = Object.keys(EVENT_KINDS);
export const eventLength = (e) => (e.duration > 0 ? e.duration : EVENT_KINDS[e.kind].defaultDuration);
export const newEvent = (time, kind, hue = 0.12, duration = 0) => ({ id: uid(), time, kind, hue, duration });
export function eventSeed(e) {
  const k = EVENT_ORDER.indexOf(e.kind);
  return ((Math.max(0, Math.round(e.time * 1000)) * 2654435761) + k * 97) >>> 0;
}

export const J = { PERFECT: 0, GREAT: 1, GOOD: 2, MISS: 3 };
export const J_WEIGHT = [1.0, 0.7, 0.4, 0];
export const J_TITLE = ['PERFECT', 'GREAT', 'GOOD', 'MISS'];
export const J_COLOR = ['#ffdb40', '#73f28c', '#73b8ff', '#ff5961'];

export function gradeFor(r) {
  if (r.failed) return 'F';
  const perfectAll = r.totalObjects > 0 && r.counts[J.PERFECT] === r.totalObjects;
  if (perfectAll) return 'SS';
  if (r.accuracy >= 0.97) return 'S';
  if (r.accuracy >= 0.92) return 'A';
  if (r.accuracy >= 0.85) return 'B';
  if (r.accuracy >= 0.72) return 'C';
  return 'D';
}

export function newSong(o) {
  return {
    id: o.id, title: o.title ?? 'Untitled', artist: o.artist ?? 'Unknown artist', bpm: o.bpm ?? 120, offset: o.offset ?? 0,
    keyCount: o.keyCount ?? 4, duration: o.duration ?? 0, audioFile: o.audioFile ?? null, builtinKey: o.builtinKey ?? null,
    hue: o.hue ?? Math.random(), charts: o.charts ?? [], timeSigNum: o.timeSigNum ?? 4, timeSigDen: o.timeSigDen ?? 4, source: o.source ?? null,
  };
}
