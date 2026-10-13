// Procedural built-in songs: composition (notes + drums), chart generation, tutorial chart.
import { RNG, clamp } from './util.js';
import { newNote, newChart, newEvent, sortNotes, objectCount, noteIsHold, segments, newSong } from './model.js';

export const ARRANGEMENTS = [
  { key: 'first-steps', title: 'First Steps', artist: 'ManiDim', bpm: 100, keyCount: 4, rootMidi: 55, minor: false, progression: [0, 3, 4, 0],
    blocks: [['intro', 2], ['verse', 4], ['chorus', 4], ['verse', 4], ['breakdown', 4], ['chorus', 4], ['outro', 2]], drums: 'breakbeat', voice: 'soft', seed: 11, hue: 0.33, tutorial: true },
  { key: 'rainy-window', title: 'Rainy Window', artist: 'Mori Kite', bpm: 78, keyCount: 4, rootMidi: 48, minor: true, progression: [0, 3, 5, 4],
    blocks: [['intro', 2], ['verse', 8], ['chorus', 8], ['verse', 8], ['breakdown', 4], ['chorus', 8], ['outro', 2]], drums: 'lofi', voice: 'soft', seed: 4242, hue: 0.58 },
  { key: 'paper-lanterns', title: 'Paper Lanterns', artist: 'Mori Kite', bpm: 88, keyCount: 4, rootMidi: 60, minor: false, progression: [0, 4, 5, 3],
    blocks: [['intro', 2], ['verse', 8], ['chorus', 8], ['verse', 8], ['breakdown', 4], ['chorus', 8], ['outro', 2]], drums: 'lofi', voice: 'pluck', seed: 2024, hue: 0.08 },
  { key: 'turbo-kitten', title: 'Turbo Kitten', artist: 'Pixel Paws', bpm: 160, keyCount: 4, rootMidi: 55, minor: false, progression: [0, 5, 3, 4],
    blocks: [['intro', 2], ['verse', 8], ['chorus', 8], ['verse', 8], ['chorus', 8], ['breakdown', 4], ['chorus', 8], ['outro', 4]], drums: 'breakbeat', voice: 'pluck', seed: 31337, hue: 0.15 },
  { key: 'neon-drive', title: 'Neon Drive', artist: 'Vector Hearts', bpm: 128, keyCount: 4, rootMidi: 57, minor: true, progression: [0, 5, 2, 6],
    blocks: [['intro', 4], ['verse', 8], ['chorus', 8], ['breakdown', 8], ['verse', 8], ['chorus', 8], ['chorus', 8], ['outro', 4]], drums: 'fourOnFloor', voice: 'saw', seed: 8128, hue: 0.83 },
  { key: 'cherry-blossom-rush', title: 'Cherry Blossom Rush', artist: 'Sakura Static', bpm: 150, keyCount: 5, rootMidi: 57, minor: false, progression: [3, 4, 2, 5],
    blocks: [['intro', 2], ['verse', 8], ['chorus', 8], ['verse', 8], ['chorus', 8], ['breakdown', 4], ['chorus', 8], ['chorus', 8], ['outro', 4]], drums: 'breakbeat', voice: 'pluck', seed: 5150, hue: 0.94 },
  { key: 'glass-sunrise', title: 'Glass Sunrise', artist: 'Aurelia', bpm: 112, keyCount: 6, rootMidi: 50, minor: false, progression: [0, 4, 5, 3],
    blocks: [['intro', 4], ['verse', 8], ['chorus', 8], ['breakdown', 8], ['chorus', 8], ['verse', 8], ['chorus', 8], ['outro', 4]], drums: 'breakbeat', voice: 'soft', seed: 777, hue: 0.55 },
  { key: 'deep-blue-static', title: 'Deep Blue Static', artist: 'Aurelia', bpm: 100, keyCount: 6, rootMidi: 54, minor: true, progression: [0, 3, 6, 5],
    blocks: [['intro', 2], ['verse', 8], ['chorus', 8], ['breakdown', 4], ['chorus', 8], ['verse', 8], ['chorus', 8], ['outro', 2]], drums: 'lofi', voice: 'soft', seed: 60606, hue: 0.62 },
  { key: 'midnight-arcade', title: 'Midnight Arcade', artist: 'Vector Hearts', bpm: 140, keyCount: 4, rootMidi: 50, minor: true, progression: [0, 6, 5, 6],
    blocks: [['intro', 4], ['verse', 8], ['chorus', 8], ['breakdown', 8], ['verse', 8], ['chorus', 8], ['chorus', 8], ['outro', 4]], drums: 'fourOnFloor', voice: 'saw', seed: 1984, hue: 0.74 },
  { key: 'eclipse', title: 'Eclipse', artist: 'Umbra', bpm: 132, keyCount: 8, rootMidi: 45, minor: true, progression: [0, 2, 5, 6],
    blocks: [['intro', 4], ['verse', 8], ['chorus', 8], ['breakdown', 4], ['chorus', 8], ['verse', 8], ['chorus', 8], ['outro', 4]], drums: 'fourOnFloor', voice: 'saw', seed: 2112, hue: 0.12 },
  { key: 'hyperloop', title: 'Hyperloop', artist: 'Static Bloom', bpm: 170, keyCount: 5, rootMidi: 52, minor: true, progression: [0, 0, 5, 6],
    blocks: [['intro', 4], ['verse', 8], ['chorus', 8], ['breakdown', 4], ['chorus', 8], ['verse', 8], ['chorus', 8], ['chorus', 8], ['outro', 4]], drums: 'dnb', voice: 'saw', seed: 9001, hue: 0.0 },
  { key: 'solar-flare', title: 'Solar Flare', artist: 'Umbra', bpm: 175, keyCount: 7, rootMidi: 52, minor: true, progression: [0, 0, 6, 5],
    blocks: [['intro', 4], ['verse', 8], ['chorus', 8], ['breakdown', 4], ['chorus', 8], ['verse', 8], ['chorus', 8], ['chorus', 8], ['outro', 4]], drums: 'dnb', voice: 'saw', seed: 17517, hue: 0.04 },
];
export const arrangementFor = (key) => ARRANGEMENTS.find((a) => a.key === key);

const TEMPLATES = {
  verse: [[[0, 4], [4, 4], [8, 4], [12, 4]], [[0, 6], [6, 2], [8, 4], [12, 4]], [[0, 4], [4, 2], [6, 2], [8, 4], [12, 2], [14, 2]], [[0, 3], [3, 3], [6, 2], [8, 4], [12, 4]]],
  chorus: [[[0, 2], [2, 2], [4, 2], [6, 2], [8, 2], [10, 2], [12, 2], [14, 2]], [[0, 3], [3, 3], [6, 2], [8, 3], [11, 3], [14, 2]],
    [[0, 2], [2, 2], [4, 4], [8, 2], [10, 2], [12, 2], [14, 2]], [[0, 4], [4, 2], [6, 2], [8, 2], [10, 2], [12, 4]]],
  breakdown: [[[0, 8], [8, 4], [12, 4]], [[0, 12], [12, 4]], [[0, 6], [6, 6], [12, 4]], [[0, 8], [8, 8]]],
  outro: [[[0, 16]]], intro: [[[0, 16]]],
};

function drumPattern(style, kind, i, n) {
  const all8 = [0, 2, 4, 6, 8, 10, 12, 14], off8 = [2, 6, 10, 14], s16 = [1, 3, 5, 7, 9, 11, 13, 15];
  const h = (arr, v) => arr.map((s) => [s, v]);
  const half = Math.floor(n / 2);
  const P = (kick = [], snare = [], clap = [], hat = [], open = []) => ({ kick, snare, clap, hat, open });
  switch (style) {
    case 'fourOnFloor':
      switch (kind) {
        case 'intro': return P([0, 4, 8, 12], [], [], i >= half ? h(off8, 0.5) : []);
        case 'verse': return P([0, 4, 8, 12], [], [4, 12], h(off8, 0.55));
        case 'chorus': return P([0, 4, 8, 12], [], [4, 12], [...h(off8, 0.6), ...h(s16, 0.22)], [14]);
        case 'breakdown': return P([], [], [], h([0, 4, 8, 12], 0.28));
        default: return P([0, 8]);
      }
    case 'breakbeat':
      switch (kind) {
        case 'intro': return P([0, 10], [], [], i >= half ? h(all8, 0.35) : []);
        case 'verse': return P([0, 10], [4, 12], [], h(all8, 0.45));
        case 'chorus': return P([0, 6, 10], [4, 12], [], [...h(all8, 0.5), ...h(s16, 0.18)], [14]);
        case 'breakdown': return P([], [], [], h([0, 4, 8, 12], 0.25));
        default: return P([0]);
      }
    case 'dnb':
      switch (kind) {
        case 'intro': return P([0], [], [], i >= half ? h(all8, 0.3) : []);
        case 'verse': return P([0, 10], [4, 12], [], h(all8, 0.4));
        case 'chorus': return P([0, 10], [4, 12], [7], [...h(all8, 0.45), ...h(s16, 0.2)], [14]);
        case 'breakdown': return P([], [], [], h([0, 4, 8, 12], 0.25));
        default: return P([0]);
      }
    default: { // lofi
      const swing = all8.map((s) => [s % 4 === 2 ? s + 0.5 : s, s % 4 === 0 ? 0.4 : 0.25]);
      switch (kind) {
        case 'intro': return P([], [], [], i >= half ? swing : []);
        case 'verse': return P([0, 7, 10], [8], [], swing);
        case 'chorus': return P([0, 7, 10], [4, 12], [], [...swing, ...s16.map((s) => [s + 0.5, 0.12])]);
        case 'breakdown': return P([0]);
        default: return P([0]);
      }
    }
  }
}

function bassPattern(style, kind, i, n) {
  if (kind === 'intro') return (i >= Math.floor(n / 2) || n <= 2) ? [[0, 16, 0, 0]] : [];
  if (kind === 'breakdown' || kind === 'outro') return [[0, 16, 0, 0]];
  switch (style) {
    case 'fourOnFloor': return [[2, 2, 0, 0], [6, 2, 0, 0], [10, 2, 0, 0], [14, 2, 0, 1]];
    case 'dnb': return [[0, 3, 0, 0], [3, 3, 0, 0], [6, 2, 0, 0], [10, 3, 4, 0], [13, 3, 0, 0]];
    case 'breakbeat': return [[0, 6, 0, 0], [6, 2, 0, 0], [8, 4, 0, 0], [12, 2, 4, 0], [14, 2, 0, 0]];
    default: return [[0, 7, 0, 0], [8, 5, 0, 0], [14, 2, 4, 0]];
  }
}

export function compose(a) {
  const rng = new RNG(a.seed);
  const spb = 60 / a.bpm, s16 = spb / 4, barLen = spb * 4;
  const scale = a.minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  const semis = (d) => scale[d % 7] + 12 * Math.floor(d / 7);
  const laneDeg = [0, 2, 4, 6, 7, 9, 11, 13];
  const n = a.keyCount;
  const c = { melody: [], drums: [], bass: [], pads: [], sections: [], duration: 0 };
  let bar = 0, lane = Math.floor(n / 2), prevLanes = [], prevTemplate = -1, prevKind = 'intro';

  for (const [kind, nBars] of a.blocks) {
    c.sections.push({ kind, start: bar * barLen, bars: nBars });
    for (let i = 0; i < nBars; i++) {
      const r = a.progression[bar % a.progression.length];
      const t0 = bar * barLen;
      const last = i === nBars - 1;
      const hit = (k, step, vel) => c.drums.push({ t: t0 + step * s16, kind: k, vel, section: kind });
      const p = drumPattern(a.drums, kind, i, nBars);
      for (const s of p.kick) hit('kick', s, 0.95);
      for (const s of p.snare) hit('snare', s, 0.8);
      for (const s of p.clap) hit('clap', s, 0.7);
      for (const [s, v] of p.hat) hit('hat', s, v);
      for (const s of p.open) hit('openHat', s, 0.5);
      if (last && (kind === 'verse' || kind === 'chorus')) {
        c.drums = c.drums.filter((d) => !(d.kind === 'snare' && Math.abs(d.t - (t0 + 12 * s16)) < 0.001));
        [12, 13, 14, 15].forEach((s, k) => hit('snare', s, 0.45 + 0.15 * k));
      }
      for (const [s, len, off, oct] of bassPattern(a.drums, kind, i, nBars)) {
        c.bass.push({ t: t0 + s * s16, dur: len * s16 * 0.92, midi: a.rootMidi - 12 + semis(r + off) + 12 * oct });
      }
      if (!(kind === 'intro' && i < Math.floor(nBars / 2) && nBars > 2)) {
        c.pads.push({ t: t0, dur: barLen, midis: [r, r + 2, r + 4, r + 7].map((d) => a.rootMidi + semis(d)) });
      }
      if (kind !== 'intro') {
        const tpls = TEMPLATES[kind];
        let ti = rng.int(0, tpls.length - 1);
        let lanes = [];
        const reuse = (i % 2 === 1) && prevLanes.length > 0 && kind === prevKind && prevTemplate >= 0 && rng.chance(0.7);
        if (reuse) { ti = prevTemplate; lanes = prevLanes; }
        else {
          let l = lane;
          for (let k = 0; k < tpls[ti].length; k++) {
            const steps = kind === 'breakdown' ? [-1, 1, 1, -1, 1] : [-2, -1, -1, 0, 1, 1, 2];
            const s = rng.pick(steps);
            let nl = clamp(l + s, 0, n - 1);
            if (nl === l && lanes[lanes.length - 1] === l) nl = clamp(l + (rng.chance(0.5) ? 1 : -1), 0, n - 1);
            lanes.push(nl); l = nl;
          }
          lane = l;
        }
        tpls[ti].forEach(([st, len], k) => {
          const ln = lanes[k];
          c.melody.push({ start: t0 + st * s16, dur: len * s16, lane: ln, midi: a.rootMidi + 12 + semis(r + laneDeg[ln]), section: kind, bar });
        });
        prevLanes = lanes; prevTemplate = ti;
      }
      prevKind = kind;
      bar++;
    }
  }
  c.duration = bar * barLen + 1.5;
  return c;
}

// ---------------------------------------------------------------- chart generation

const DIFFS = ['Easy', 'Normal', 'Hard'];

export function buildChart(comp, a, diff) {
  const rng = new RNG(a.seed + diff * 7919);
  const n = a.keyCount;
  const spb = 60 / a.bpm, s16 = spb / 4;
  const minGap = [0.30, 0.17, 0.095][diff];
  const holdMin = [0.80, 0.65, 0.55][diff];
  const maxChain = [0, 1, 2][diff];
  const notes = [];
  const busy = [];
  let lastTime = -10;
  const free = (lane, from, to, pad = 0.1) => !busy.some((b) => b.lane === lane && b.from < to + pad && b.to > from - pad);
  const add = (note) => {
    const segs = segments(note, n);
    for (const s of segs) if (!free(s.lane, s.from, s.to)) return false;
    notes.push(note);
    for (const s of segs) busy.push({ lane: s.lane, from: s.from, to: s.to });
    return true;
  };

  const mel = comp.melody;
  let i = 0;
  while (i < mel.length) {
    const m = mel[i++];
    if (diff === 0) { const idx = Math.round(m.start / s16); if (idx % 4 !== 0 && m.dur < holdMin) continue; }
    if (m.start - lastTime < minGap) continue;
    const note = newNote(m.start, m.lane);
    if (m.dur >= holdMin) {
      let endT = m.start + m.dur - 0.06, curEnd = m.start + m.dur, curLane = m.lane, chain = 0;
      while (chain < maxChain && i < mel.length) {
        const nx = mel[i];
        if (Math.abs(nx.start - curEnd) < 0.02 && Math.abs(nx.lane - curLane) === 1 && rng.chance([0, 0.6, 0.5][diff])) {
          note.slides.push({ time: nx.start, dir: nx.lane - curLane });
          curLane = nx.lane; endT = nx.start + nx.dur - 0.06; curEnd = nx.start + nx.dur; i++; chain++;
        } else break;
      }
      note.duration = endT - m.start;
    }
    if (add(note)) lastTime = m.start;
  }

  if (diff !== 0) {
    let alt = 0;
    for (const d of [...comp.drums].sort((x, y) => x.t - y.t)) {
      let want = false;
      if (diff === 1 && d.kind === 'kick' && d.section === 'chorus') want = Math.abs((d.t / (spb * 4)) % 1) < 0.01;
      else if (diff === 2 && (d.kind === 'kick' || d.kind === 'snare' || d.kind === 'clap') && d.section === 'chorus') want = true;
      else if (diff === 2 && (d.kind === 'snare' || d.kind === 'kick') && d.section === 'verse') want = rng.chance(0.4);
      if (!want || d.t - lastTime < 0.09) continue;
      if (notes.some((x) => Math.abs(x.time - d.t) < 0.09)) continue;
      const lane = alt % 2 === 0 ? 0 : n - 1;
      alt++;
      if (add(newNote(d.t, lane))) lastTime = Math.max(lastTime, d.t);
    }
    if (diff === 2) {
      const barLen = spb * 4;
      for (const nt of [...notes]) {
        if (noteIsHold(nt) || nt.slides.length) continue;
        const pos = (nt.time / barLen) % 1;
        const mm = mel.find((x) => Math.abs(x.start - nt.time) < 0.001);
        if ((pos < 0.01 || pos > 0.99) && mm && mm.section === 'chorus') {
          const mirror = n - 1 - nt.lane;
          if (mirror !== nt.lane) add(newNote(nt.time, mirror));
        }
      }
    }
  }
  const chart = newChart(DIFFS[diff], 1, notes);
  chart.events = buildEvents(comp, a, diff);
  sortNotes(chart.notes);
  const span = Math.max(1, (chart.notes.length ? chart.notes[chart.notes.length - 1].time + chart.notes[chart.notes.length - 1].duration : 1) - (chart.notes[0]?.time ?? 0));
  chart.level = clamp(Math.round(objectCount(chart) / span * 2.1), 1, 15);
  return chart;
}

function buildEvents(comp, a, diff) {
  const ev = [];
  const barLen = 60 / a.bpm * 4;
  let lastChorus = -1;
  comp.sections.forEach((s, i) => { if (s.kind === 'chorus') lastChorus = i; });
  const add = (t, kind, hue, dur = 0) => ev.push(newEvent(t, kind, (hue ?? a.hue), dur));
  comp.sections.forEach((s, i) => {
    if (s.kind === 'chorus') {
      add(s.start, 'flash', a.hue); add(s.start, 'sparkles');
      if (diff !== 0) add(s.start, 'pulse');
      if (diff === 2) add(s.start, 'shake');
      for (let bar = 4; bar < s.bars; bar += 4) {
        const t = s.start + bar * barLen;
        add(t, diff === 2 && bar % 8 === 4 ? 'fireworks' : 'sparkles', a.hue + 0.3);
        if (diff !== 0) add(t, 'pulse', a.hue + 0.1);
      }
      if (diff === 2 && i === lastChorus) add(s.start + barLen, 'lasers', a.hue, (s.bars - 2) * barLen);
    } else if (s.kind === 'breakdown') {
      add(s.start, 'tint', a.hue, s.bars * barLen);
      add(s.start + s.bars * barLen - 0.01, 'shake');
    } else if (s.kind === 'outro') add(s.start, 'sparkles', a.hue + 0.5);
  });
  return ev.sort((x, y) => x.time - y.time);
}

export function tutorialChart(a) {
  const spb = 60 / a.bpm, bar = spb * 4;
  const notes = [];
  const tap = (b, beat, lane) => notes.push(newNote(b * bar + beat * spb, lane));
  const hold = (b, beat, lane, len, slides = []) => {
    const nn = newNote(b * bar + beat * spb, lane, len * spb - 0.08, slides.map(([bt, dir]) => ({ time: b * bar + bt * spb, dir })));
    notes.push(nn);
  };
  [0, 1, 2, 3].forEach((l, k) => tap(2, k, l));
  [3, 2, 1, 0].forEach((l, k) => tap(3, k, l));
  [0, 1, 2, 3, 0, 1, 2, 3].forEach((l, k) => tap(4, k / 2, l));
  [0, 0, 3, 3, 1, 1, 2, 2].forEach((l, k) => tap(5, k / 2, l));
  hold(6, 0, 1, 2); tap(6, 3, 2);
  hold(7, 0, 2, 2); tap(7, 3, 1);
  hold(8, 0, 0, 3); tap(8, 1, 3); tap(8, 2, 3);
  [3, 0, 2, 1].forEach((l, k) => tap(9, k, l));
  hold(10, 0, 1, 3, [[1.5, 1]]);
  tap(11, 0, 2); tap(11, 1, 3);
  hold(12, 0, 2, 3, [[1.5, -1]]);
  hold(13, 0, 0, 2, [[0.7, 1], [1.3, 1]]);
  const rng = new RNG(42);
  for (let b = 14; b < 22; b++) {
    if (b % 4 === 1) {
      const l = rng.int(0, 2);
      let dir = rng.chance(0.5) ? 1 : -1;
      if (l + dir < 0 || l + dir > 3) dir = -dir;
      hold(b, 0, l, 4, [[2, dir]]);
    } else {
      let prev = -1;
      for (let k = 0; k < 8; k++) {
        if (k % 2 === 1 && b % 2 === 0) continue;
        let l = rng.int(0, 3);
        if (l === prev) l = (l + 1) % 4;
        prev = l; tap(b, k / 2, l);
      }
    }
  }
  const chart = newChart('Tutorial', 2, notes);
  sortNotes(chart.notes);
  const lead = 0.9;
  chart.lessons = [
    { time: 2 * bar - lead, title: 'Tap notes', key: 'space', text: 'Notes fly out of the fan toward the big circle. When one touches the circle, press the key for its lane. Lanes go left to right, and so do your keys: {K1}  {K2}  {K3}  {K4}.\n\nThe closer to the middle of the circle you press, the better the rating.' },
    { time: 6 * bar - lead, title: 'Hold notes', key: 'space', text: 'A note with a tail is a hold. Press its key as the head touches the circle and KEEP it held down until the round tail cap touches the circle, then let go.\n\nLetting go early breaks your combo. Your other fingers are free to tap other lanes while you hold.' },
    { time: 10 * bar - lead, title: 'Slide notes', key: 'slideRight', text: 'A hold with white arrows on it is a slide. Hit it like any hold and keep holding the SAME key that started it — never let go of it.\n\nWhen the arrow touches the circle, tap {SR} (arrow points right) or {SL} (arrow points left) with your other hand. The note slides over to the next lane.\n\nTry the key now: press {SR} to continue.' },
    { time: 12 * bar - lead, title: 'More slides', key: 'slideLeft', text: 'Slides can point either way, and some have several arrows in a row. Keep the first key down the whole time and tap a slide key for every arrow.\n\nThe next slide points left: {SL}. The one after it has two arrows to the right.' },
    { time: 14 * bar - 0.35, title: "You're ready!", key: 'space', text: 'Now a mix of everything: taps, holds and slides.\n\nPress Esc any time to pause. Good luck!' },
  ];
  chart.events = [
    newEvent(14 * bar, 'flash', a.hue), newEvent(14 * bar, 'sparkles'), newEvent(18 * bar, 'pulse', a.hue),
    newEvent(18 * bar, 'fireworks', a.hue), newEvent(22 * bar, 'sparkles', a.hue + 0.4),
  ];
  return chart;
}

export function makeBuiltinSongs() {
  return ARRANGEMENTS.map((a) => {
    const comp = compose(a);
    const charts = a.tutorial ? [tutorialChart(a)] : [0, 1, 2].map((d) => buildChart(comp, a, d));
    return newSong({ id: 'builtin.' + a.key, title: a.title, artist: a.artist, bpm: a.bpm, offset: 0, keyCount: a.keyCount,
      duration: comp.duration, audioFile: null, builtinKey: a.key, hue: a.hue, charts });
  });
}
