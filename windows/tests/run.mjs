// Node tests for the pure logic (engine, mods, chart text, song generation).
import { makeBuiltinSongs, ARRANGEMENTS } from '../src/songs.js';
import { GameEngine } from '../src/engine.js';
import { ModSet, applyMods, keyMultiplier } from '../src/mods.js';
import { parseChartText, writeChartText } from '../src/chart_text.js';
import { J, newNote, newChart, segments, noteIsHold, noteEnd } from '../src/model.js';

let failed = 0;
const check = (c, msg) => { if (c) console.log('  ok  ', msg); else { console.log('  FAIL', msg); failed++; } };
const bot = (chart, keys, ws = 1) => { const e = new GameEngine(chart, keys, 0, ws); e.bot = true; let t = -1; const last = Math.max(...chart.notes.map(noteEnd), 0); while (t < last + 2) { e.update(t); t += 1 / 240; } return e; };

const songs = makeBuiltinSongs();
console.log(`${songs.length} built-in songs`);
for (const s of songs) for (const ch of s.charts) {
  const e = bot(ch, s.keyCount);
  check(e.counts[J.PERFECT] === e.totalObjects && e.score === 1000000 && e.isFinished, `${s.title} [${ch.name}] Lv${ch.level}: ${ch.notes.length} notes, bot all-perfect (${e.totalObjects})`);
}

// manual engine behaviour
{
  const mk = (notes) => newChart('t', 1, notes);
  let e = new GameEngine(mk([newNote(1, 1, 2, [{ time: 2, dir: 1 }]), newNote(4, 0)]), 4);
  e.press(1, 1.02); e.update(1.5); e.slide(1, 2.03); e.update(3.1); e.release(1, 3.05);
  check(e.counts[J.PERFECT] === 3, `hold + slide scores (${e.counts})`);
  e.update(4.3); check(e.counts[J.MISS] === 1, 'late tap = miss');
  e = new GameEngine(mk([newNote(1, 1, 2, [{ time: 2, dir: 1 }])]), 4);
  e.press(1, 1.0); e.update(1.5); e.release(1, 1.8);
  check(e.counts[J.MISS] === 2 && e.combo === 0, `early release drops tail + slide (${e.counts})`);
  e = new GameEngine(mk([newNote(1, 1, 2, [{ time: 2, dir: 1 }])]), 4);
  e.press(1, 1.0); e.slide(-1, 2.0); e.update(2.3);
  check(e.counts[J.MISS] === 1, 'wrong slide direction = miss');
  // anti-mash
  e = new GameEngine(mk([newNote(1, 1)]), 4); e.press(0, 1.0, 3); e.press(1, 1.002, 2);
  check(e.counts[J.PERFECT] === 0 && e.counts[J.MISS] === 1, 'mashed 4 keys for 1 note = miss');
  e = new GameEngine(mk([newNote(1, 3)]), 4); e.press(0, 1.0); e.press(1, 1.01); e.press(3, 1.02);
  check(e.counts[J.MISS] === 1, 'third key within 50 ms = miss');
  e = new GameEngine(mk([newNote(2, 0), newNote(2, 3)]), 4); e.press(0, 2.0, 1); e.press(3, 2.003);
  check(e.counts[J.PERFECT] === 2, '2-note chord ok');
  e = new GameEngine(mk([newNote(2, 0), newNote(2, 1), newNote(2, 3)]), 4); e.press(0, 2.0, 2); e.press(1, 2.002, 1); e.press(3, 2.004);
  check(e.counts[J.PERFECT] === 3, '3-note chord ok');
  e = new GameEngine(mk([newNote(1, 0, 3), newNote(2, 2), newNote(2, 3)]), 4); e.press(0, 1.0); e.update(1.5); e.press(2, 2.0, 1); e.press(3, 2.002);
  check(e.counts[J.PERFECT] === 3, 'hold + chord ok');
  e = new GameEngine(mk([newNote(3, 0), newNote(3.095, 1), newNote(3.19, 2), newNote(3.285, 3)]), 4);
  [3, 3.095, 3.19, 3.285].forEach((t, i) => e.press(i, t));
  check(e.counts[J.PERFECT] === 4, 'fast stream ok');
  // windows
  e = new GameEngine(mk([newNote(1, 0)]), 4, 0, 0.6); e.press(0, 1.09);
  check(e.judged === 0, 'strict window rejects 90 ms');
  e = new GameEngine(mk([newNote(1, 0)]), 4, 0, 1.4); e.press(0, 1.17);
  check(e.judged === 1 && e.counts[J.MISS] === 0, 'wide window accepts 170 ms');
}

// mods
{
  const validate = (song, ch, label) => {
    const n = song.keyCount; let ok = true; const busy = Array.from({ length: n }, () => []);
    for (const note of ch.notes) {
      if (note.lane < 0 || note.lane >= n) ok = false;
      let l = note.lane;
      for (const s of note.slides) { l += s.dir; if (l < 0 || l >= n || s.time <= note.time || s.time >= noteEnd(note)) ok = false; }
      for (const seg of segments(note, n)) {
        if (busy[seg.lane]?.some((b) => b[0] < seg.to + 0.05 && b[1] > seg.from - 0.05)) ok = false;
        busy[seg.lane]?.push([seg.from, seg.to]);
      }
    }
    const e = bot(ch, n);
    check(ok && ch.notes.length > 0 && e.counts[J.PERFECT] === e.totalObjects, `${label}: ${ch.notes.length} notes valid + playable`);
  };
  for (const key of ['neon-drive', 'eclipse']) {
    const song = songs.find((s) => s.builtinKey === key);
    for (let k = 1; k <= 8; k++) { const o = applyMods(song, 2, new ModSet([`k${k}`])); validate(o, o.charts[2], `${song.title} ${k}K`); }
    for (const m of ['mirror', 'random', 'noSlides', 'holdOff', 'doubleNotes']) { const o = applyMods(song, 2, new ModSet([m])); validate(o, o.charts[2], `${song.title} ${m}`); }
    const o = applyMods(song, 2, new ModSet(['k6', 'random', 'doubleNotes'])); validate(o, o.charts[2], `${song.title} 6K+Random+DN`);
  }
  const ms = new ModSet(); ms.toggle('k3'); ms.toggle('k5');
  check(ms.keyCount === 5 && ms.ids.size === 1, 'key mods exclusive');
  ms.toggle('halfTime'); ms.toggle('doubleTime'); check(ms.speed === 1.5 && !ms.has('halfTime'), 'speed mods exclusive');
  check(Math.abs(new ModSet(['doubleTime', 'blackout']).multiplier(4) - 1.82) < 1e-9, 'multipliers multiply');
  check(keyMultiplier(4, 2) < 1 && keyMultiplier(4, 8) > 1, 'fewer keys easier, more harder');
}

// chart text
{
  const sketch = `B:120
4,3 #keys and difficulty#
4:4 #time signature#
K2
1,3.5 # measure and beat the note is in#
1 #0 for no hold 1 for hold#
1|L|2,2 #1 for slide note 0 for no slide note L for left and R for right slide#
E:3,2 # end of hold in measures and beat#`;
  const song = parseChartText(sketch); const n = song.charts[0].notes[0];
  check(song.keyCount === 4 && song.charts[0].level === 3, 'sketch header');
  check(n.lane === 1 && Math.abs(n.time - 1.25) < 1e-9, 'sketch note position');
  check(n.slides.length === 1 && n.slides[0].dir === -1 && Math.abs(n.slides[0].time - 2.5) < 1e-9, 'sketch slide');
  check(Math.abs(noteEnd(n) - 4.5) < 1e-9, 'sketch hold end');
  let ok = true, tb = 0, jb = 0;
  for (const s of songs) {
    const txt = writeChartText(s); tb += txt.length; jb += JSON.stringify(s).length;
    const back = parseChartText(txt);
    s.charts.forEach((a, ci) => {
      const an = [...a.notes].sort((x, y) => x.time - y.time || x.lane - y.lane), bn = back.charts[ci].notes;
      if (an.length !== bn.length || a.events.length !== back.charts[ci].events.length || a.lessons.length !== back.charts[ci].lessons.length) ok = false;
      an.forEach((x, i) => { const y = bn[i]; if (!y || x.lane !== y.lane || Math.abs(x.time - y.time) > 0.001 || Math.abs(x.duration - y.duration) > 0.001 || x.slides.length !== y.slides.length) ok = false; });
    });
  }
  check(ok, 'text format round-trips every built-in song'); console.log(`  size: text ${Math.round(tb / 1024)} KB vs JSON ${Math.round(jb / 1024)} KB`);
  const s34 = parseChartText('B:120\n4,1\n3:4\nK1 2,1 0 0\nK2 1,3 0 0\n@3 6:8\nK3 3,4 0 0').charts[0].notes;
  check(Math.abs(s34[0].time - 1.0) < 1e-9 && Math.abs(s34[1].time - 1.5) < 1e-9 && Math.abs(s34[2].time - 3.75) < 1e-9, `3:4 and 6:8 timing (${s34.map((n) => n.time)})`);
  for (const [bad, expect] of [['4,3\n4:4\nK9 1,1 0 0', 'K1'], ['4,3\nK1 1,1 1 0', 'end'], ['4,3\nK1 1,1 1 1|X|2,1 E:3,1', 'L or R'], ['4,3\nK1 1,1 1 1|L|5,1 E:3,1', 'inside']]) {
    try { parseChartText(bad); check(false, `error for ${bad}`); } catch (e) { check(e.message.includes(expect), `error mentions “${expect}”: ${e.message}`); }
  }
  // tutorial lessons never overlap a hold
  const tut = songs.find((s) => s.builtinKey === 'first-steps').charts[0];
  for (const L of tut.lessons) check(!tut.notes.some((n) => noteIsHold(n) && n.time <= L.time + 0.05 && noteEnd(n) >= L.time - 0.85), `lesson '${L.title}' clear of holds`);
}
// osu!mania import
{
  const { parseOsu, songFromOsuMaps } = await import('../src/osu.js');
  const mania = (keys, ver, objs) => `osu file format v14\n[General]\nAudioFilename: a.mp3\nMode: 3\n[Metadata]\nTitle:T\nArtist:A\nVersion:${ver}\n[Difficulty]\nCircleSize:${keys}\n[TimingPoints]\n1000,500,4,2,1,30,1,0\n2000,-100,4,2,1,30,0,0\n[HitObjects]\n${objs}\n`;
  const objs = ['0,192,1000,1,0,0:0:0:0:', '511,192,1500,1,0,0:0:0:0:', '256,192,2000,128,0,3000:0:0:0:0:', '256,192,2000,1,0,0:0:0:0:', '109,192,4000,128,0,4050:0:0:0:0:'].join('\n');
  const m7 = parseOsu(mania(7, 'S7', objs), 'a.osu'), m4 = parseOsu(mania(4, 'S4', objs), 'b.osu');
  check(m7.bpm === 120 && m7.offset === 1 && m7.keys === 7 && m7.mode === 3, `osu timing/keys (${m7.bpm} bpm, offset ${m7.offset})`);
  check(m7.notes.length === 4 && m7.notes[0].lane === 0 && m7.notes[1].lane === 6 && Math.abs(m7.notes[2].duration - 1) < 1e-9 && m7.notes[3].duration === 0, `osu lanes + hold, dup + tiny hold handled (${m7.notes.map((n) => n.lane + '/' + n.duration.toFixed(2))})`);
  const set = songFromOsuMaps([m7, m4], null);
  check(set.song.charts.length === 2 && set.song.charts.map((c) => c.keys || set.song.keyCount).join() === '4,7' && set.song.keyCount === 7 && set.song.source === 'osz', 'mixed 4K/7K set keeps both charts');
  const rt = parseChartText(writeChartText(set.song));
  check(rt.charts.map((c) => c.keys || rt.keyCount).join() === '4,7', 'per-chart keys survive the text format');
  for (const c of set.song.charts) { const k = c.keys || set.song.keyCount; const e = bot(c, k); check(e.counts[J.PERFECT] === e.totalObjects, `bot plays the ${k}K chart`); }
  try { songFromOsuMaps([parseOsu('[General]\nMode: 0\n[HitObjects]\n10,10,100,1,0\n', 'x.osu')], parseOsu('[General]\nMode: 0\n', 'x.osu')); check(false, 'standard map rejected'); } catch (e) { check(/standard/.test(e.message), 'osu!standard is rejected'); }
  const fs = await import('fs'); const dir = process.env.HOME + '/Downloads/1660279 xi - FREEDOM DiVE/';
  if (fs.existsSync(dir)) {
    const maps = fs.readdirSync(dir).filter((f) => f.endsWith('.osu')).map((f) => parseOsu(fs.readFileSync(dir + f, 'utf8'), f));
    const r = songFromOsuMaps(maps, null);
    check(r.song.charts.length === 10 && r.song.keyCount === 7 && Math.abs(r.song.bpm - 222.22) < 0.01, `FREEDOM DiVE set: ${r.song.charts.map((c) => c.name + ' Lv' + c.level).join(', ')}`);
    for (const c of r.song.charts) { const e = bot(c, r.song.keyCount); if (e.counts[J.PERFECT] !== e.totalObjects) check(false, `bot ${c.name}`); }
  }
}
console.log(failed ? `${failed} FAILED` : 'ALL PASSED');
process.exit(failed ? 1 : 0);
