// ManiDim compact text chart format (.mdc) — see CHART_FORMAT.md
import { newNote, newChart, newEvent, sortNotes, noteIsHold, noteEnd, EVENT_KINDS, newSong } from './model.js';
import { uid } from './util.js';

export class ChartTextError extends Error {
  constructor(line, message) {
    super(line > 0 ? `Chart file, line ${line}: ${message}` : `Chart file: ${message}`);
    this.line = line;
  }
}

export function fmt(v, digits = 4) {
  let s = v.toFixed(digits);
  if (s.includes('.')) { s = s.replace(/0+$/, ''); if (s.endsWith('.')) s = s.slice(0, -1); }
  return s === '-0' ? '0' : s;
}

class Sig {
  constructor(changes) { this.changes = changes; }   // [{measure, num, den}]
  measureLen(c) { return c.num * 4 / c.den; }
  quarters(m, b) {
    const first = this.changes[0];
    if (m <= first.measure) return (m - first.measure) * this.measureLen(first) + (b - 1) * 4 / first.den;
    let q = 0;
    for (let i = 0; i < this.changes.length; i++) {
      const c = this.changes[i];
      const end = i + 1 < this.changes.length ? Math.min(this.changes[i + 1].measure, m) : m;
      if (m > c.measure) q += Math.max(0, end - c.measure) * this.measureLen(c);
      if (i + 1 >= this.changes.length || this.changes[i + 1].measure > m) return q + (b - 1) * 4 / c.den;
    }
    return q;
  }
}

export function writeChartText(song) {
  const num = Math.max(1, song.timeSigNum || 4), den = Math.max(1, song.timeSigDen || 4);
  const ql = num * 4 / den;
  const pos = (t) => {
    const q = (t - song.offset) * song.bpm / 60;
    let m = Math.floor(q / ql + 1e-9);
    let beat = (q - m * ql) * den / 4 + 1;
    if (beat >= num + 1 - 0.00005) { m += 1; beat = 1; }
    return `${m + 1},${fmt(beat)}`;
  };
  let out = `# ManiDim chart (.mdc) — see CHART_FORMAT.md. Everything after a # is a comment.
# Note line:  K<lane> <measure>,<beat> <hold 0/1> <slide 0 | 1|L|m,b|R|m,b> [E:<measure>,<beat>]
T:${song.title}
A:${song.artist}
B:${fmt(song.bpm, 3)}
O:${fmt(song.offset, 4)}
H:${fmt(song.hue, 3)}
`;
  if (song.audioFile) out += `AUDIO:${song.audioFile}\n`;
  for (const chart of song.charts) {
    out += `\n[${chart.name}]\n`;
    out += `${chart.keys || song.keyCount},${chart.level}   # keys, difficulty\n`;
    out += `${num}:${den}   # time signature\n`;
    const notes = [...chart.notes].sort((a, b) => a.time - b.time || a.lane - b.lane);
    for (const n of notes) {
      let line = `K${n.lane + 1} ${pos(n.time)} `;
      if (noteIsHold(n)) {
        line += '1 ';
        if (!n.slides.length) line += '0';
        else line += '1' + [...n.slides].sort((a, b) => a.time - b.time).map((s) => `|${s.dir < 0 ? 'L' : 'R'}|${pos(s.time)}`).join('');
        line += ` E:${pos(noteEnd(n))}`;
      } else line += '0 0';
      out += line + '\n';
    }
    for (const e of [...(chart.events || [])].sort((a, b) => a.time - b.time)) {
      let line = `FX ${e.kind} ${pos(e.time)}`;
      if (EVENT_KINDS[e.kind].usesHue) line += ` hue=${fmt(e.hue, 3)}`;
      if (e.duration > 0) line += ` len=${fmt(e.duration, 3)}`;
      out += line + '\n';
    }
    for (const l of chart.lessons || []) out += `LS ${pos(l.time)} ${l.key}|${l.title}|${l.text.replace(/\n/g, '\\n')}\n`;
  }
  return out;
}

function parsePos(s, line) {
  const p = s.split(',');
  if (p.length !== 2 || !/^-?\d+$/.test(p[0]) || !isFinite(Number(p[1])) || p[1] === '') throw new ChartTextError(line, `expected measure,beat (like 3,2.5) but found “${s}”`);
  return [parseInt(p[0], 10), Number(p[1])];
}

export function parseChartText(text) {
  let title = 'Untitled', artist = 'Unknown artist', bpm = 120, offset = 0, hue = null, audio = null;
  const charts = [];
  const current = () => { if (!charts.length) charts.push({ name: 'Custom', tokens: [], sig: [], fx: [], lessons: [] }); return charts[charts.length - 1]; };

  const lines = text.replace(/\uFEFF/g, '').split(/\r?\n/);
  lines.forEach((raw, idx) => {
    const ln = idx + 1;
    const trimmed = raw.trim();
    if (trimmed.startsWith('T:')) { title = trimmed.slice(2).trim(); return; }
    if (trimmed.startsWith('A:')) { artist = trimmed.slice(2).trim(); return; }
    let line = trimmed;
    const h = line.indexOf('#');
    if (h >= 0) line = line.slice(0, h).trim();
    if (!line) return;

    if (line.startsWith('[') && line.endsWith(']')) {
      let name = line.slice(1, -1).trim();
      if (!name) name = `Chart ${charts.length + 1}`;
      charts.push({ name, tokens: [], sig: [], fx: [], lessons: [] });
      return;
    }
    for (const key of ['B', 'O', 'H', 'AUDIO']) {
      if (line.startsWith(key + ':')) {
        const v = line.slice(key.length + 1).trim();
        if (key === 'AUDIO') audio = v;
        else {
          const d = Number(v);
          if (v === '' || !isFinite(d)) throw new ChartTextError(ln, `${key}: needs a number, found “${v}”`);
          if (key === 'B') bpm = d; else if (key === 'O') offset = d; else hue = d;
        }
        return;
      }
    }
    if (line.startsWith('@')) {
      const p = line.slice(1).split(/\s+/).filter(Boolean);
      if (p.length !== 2 || !/^-?\d+$/.test(p[0])) throw new ChartTextError(ln, 'time-signature change looks like  @12 3:4');
      const sg = p[1].split(':');
      const n = parseInt(sg[0], 10), d = parseInt(sg[1], 10);
      if (sg.length !== 2 || !(n > 0) || !(d > 0)) throw new ChartTextError(ln, `bad time signature “${p[1]}”`);
      current().sig.push({ measure: parseInt(p[0], 10), num: n, den: d });
      return;
    }
    if (line === 'FX' || line.startsWith('FX ')) {
      const p = line.split(/\s+/).filter(Boolean);
      if (p.length < 3 || !EVENT_KINDS[p[1]]) throw new ChartTextError(ln, `effect looks like  FX sparkles 5,1 [hue=0.3] [len=4]  — kinds: ${Object.keys(EVENT_KINDS).join(', ')}`);
      const [m, b] = parsePos(p[2], ln);
      let hh = null, len = 0;
      for (const o of p.slice(3)) {
        if (o.startsWith('hue=') && isFinite(Number(o.slice(4)))) hh = Number(o.slice(4));
        else if (o.startsWith('len=') && isFinite(Number(o.slice(4)))) len = Number(o.slice(4));
        else throw new ChartTextError(ln, `unknown effect option “${o}”`);
      }
      current().fx.push({ line: ln, kind: p[1], m, b, hue: hh, len });
      return;
    }
    if (line.startsWith('LS ')) {
      const rest = line.slice(3).trim();
      const sp = rest.indexOf(' ');
      if (sp < 0) throw new ChartTextError(ln, 'lesson looks like  LS 3,2 space|Title|Text');
      const [m, b] = parsePos(rest.slice(0, sp), ln);
      const parts = rest.slice(sp + 1).split('|');
      if (parts.length < 3) throw new ChartTextError(ln, 'lesson looks like  LS 3,2 space|Title|Text');
      current().lessons.push({ line: ln, m, b, key: parts[0], title: parts[1], text: parts.slice(2).join('|').replace(/\\n/g, '\n') });
      return;
    }
    const c = current();
    for (const t of line.split(/\s+/).filter(Boolean)) c.tokens.push({ s: t, line: ln });
  });

  if (!charts.length) throw new ChartTextError(0, 'no charts found');
  if (!(bpm >= 20 && bpm <= 400)) throw new ChartTextError(0, 'B: (BPM) must be between 20 and 400');

  const built = [];
  let keyCount = 0, sigNum = 4, sigDen = 4;
  charts.forEach((rc, ci) => {
    const toks = rc.tokens;
    let i = 0;
    if (!toks.length) throw new ChartTextError(0, `chart “${rc.name}” is empty — it needs a “keys,difficulty” line`);
    const h = toks[i].s.split(',');
    const keys = parseInt(h[0], 10), level = parseInt(h[1], 10);
    if (h.length !== 2 || !(keys >= 1 && keys <= 8) || isNaN(level)) {
      throw new ChartTextError(toks[i].line, `chart “${rc.name}” must start with keys,difficulty (like 4,3; keys 1–8) — found “${toks[i].s}”`);
    }
    i++;
    if (keyCount === 0) keyCount = keys;
    let num = 4, den = 4;
    if (i < toks.length && toks[i].s.includes(':') && !toks[i].s.startsWith('E:')) {
      const sg = toks[i].s.split(':');
      const n = parseInt(sg[0], 10), d = parseInt(sg[1], 10);
      if (sg.length !== 2 || !(n > 0) || !(d > 0)) throw new ChartTextError(toks[i].line, `bad time signature “${toks[i].s}” (like 4:4)`);
      num = n; den = d; i++;
    }
    if (ci === 0) { sigNum = num; sigDen = den; }
    const changes = [{ measure: 1, num, den }, ...[...rc.sig].sort((a, b) => a.measure - b.measure)];
    const sig = new Sig(changes);
    const time = (m, b) => offset + sig.quarters(m, b) * 60 / bpm;

    const notes = [];
    while (i < toks.length) {
      const t = toks[i];
      const lane1 = /^K\d+$/.test(t.s) ? parseInt(t.s.slice(1), 10) : 0;
      if (!(lane1 >= 1 && lane1 <= keys)) throw new ChartTextError(t.line, `expected a note starting with K1…K${keys} but found “${t.s}”`);
      i++;
      if (i >= toks.length) throw new ChartTextError(t.line, `note ${t.s} has no position`);
      const [m, b] = parsePos(toks[i].s, toks[i].line);
      const startLine = toks[i].line;
      i++;
      let hold = false;
      if (i < toks.length && (toks[i].s === '0' || toks[i].s === '1')) { hold = toks[i].s === '1'; i++; }
      const slideSpec = [];
      if (i < toks.length && (toks[i].s === '0' || toks[i].s.startsWith('1|'))) {
        const tk = toks[i]; i++;
        if (tk.s !== '0') {
          const parts = tk.s.split('|');
          if (parts.length < 3 || parts.length % 2 !== 1) throw new ChartTextError(tk.line, `slide looks like 1|L|2,2 (direction L or R, then measure,beat) — found “${tk.s}”`);
          for (let k = 1; k + 1 < parts.length; k += 2) {
            if (parts[k] !== 'L' && parts[k] !== 'R') throw new ChartTextError(tk.line, `slide direction must be L or R, found “${parts[k]}”`);
            const [sm, sb] = parsePos(parts[k + 1], tk.line);
            slideSpec.push({ dir: parts[k] === 'L' ? -1 : 1, m: sm, b: sb, line: tk.line });
          }
        }
      }
      const note = newNote(time(m, b), lane1 - 1, 0, []);
      if (hold) {
        if (!(i < toks.length && toks[i].s.startsWith('E:'))) throw new ChartTextError(startLine, `hold at ${m},${fmt(b)} needs an end like E:3,2`);
        const [em, eb] = parsePos(toks[i].s.slice(2), toks[i].line);
        const endT = time(em, eb);
        if (!(endT > note.time + 0.001)) throw new ChartTextError(toks[i].line, 'the hold ends before it starts');
        note.duration = endT - note.time;
        i++;
        let lane = lane1 - 1;
        for (const s of slideSpec) {
          const st = time(s.m, s.b);
          if (!(st > note.time && st < endT)) throw new ChartTextError(s.line, 'a slide must happen inside its hold (between start and E:)');
          lane += s.dir;
          if (lane < 0 || lane >= keys) throw new ChartTextError(s.line, `that slide would leave the lanes (K1…K${keys})`);
          note.slides.push({ time: st, dir: s.dir });
        }
        note.slides.sort((a, b) => a.time - b.time);
      } else if (slideSpec.length) {
        throw new ChartTextError(startLine, 'only holds can have slides (put hold = 1)');
      } else if (i < toks.length && toks[i].s.startsWith('E:')) i++;
      notes.push(note);
    }
    const chart = newChart(rc.name, Math.max(1, level), notes);
    chart.keys = keys === keyCount ? null : keys;
    chart.events = rc.fx.map((f) => newEvent(time(f.m, f.b), f.kind, f.hue ?? hue ?? 0.12, f.len));
    chart.lessons = rc.lessons.map((l) => ({ time: time(l.m, l.b), title: l.title, text: l.text, key: l.key }));
    sortNotes(chart.notes);
    built.push(chart);
  });

  return newSong({
    id: 'custom.' + uid().slice(-8), title, artist, bpm, offset, keyCount, duration: 0, audioFile: audio, builtinKey: null,
    hue: hue ?? Math.random(), charts: built, timeSigNum: sigNum, timeSigDen: sigDen,
  });
}
