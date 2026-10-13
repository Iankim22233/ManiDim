// osu!mania import: .osu files (or a whole .osz set). Each mania difficulty that shares the song's audio becomes
// a chart; every chart keeps its own key count.
import { unzipSync, strFromU8 } from 'fflate';
import { newNote, newChart, newSong, sortNotes, noteEnd } from './model.js';
import { hashString, uid } from './util.js';

const AUDIO_EXTS = ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus', 'aif', 'aiff'];
const baseName = (p) => p.split(/[\\/]/).pop();

/** Parses one .osu file's text. Notes are only filled in for mania (Mode 3) maps. */
export function parseOsu(text, fileName = '') {
  const m = { file: fileName, audio: '', title: 'Untitled', artist: 'Unknown artist', version: 'Chart', mode: 0, keys: 4, bpm: 120, offset: 0, notes: [] };
  let section = '', gotTiming = false;
  const raw = [];
  for (const ln of text.split(/\r?\n/)) {
    const line = ln.trim();
    if (!line || line.startsWith('//')) continue;
    if (line.startsWith('[') && line.endsWith(']')) { section = line.slice(1, -1); continue; }
    if (section === 'General' || section === 'Metadata' || section === 'Difficulty') {
      const c = line.indexOf(':'); if (c < 0) continue;
      const key = line.slice(0, c).trim(), val = line.slice(c + 1).trim();
      if (key === 'AudioFilename') m.audio = val;
      else if (key === 'Mode') m.mode = parseInt(val, 10) || 0;
      else if (key === 'Title') m.title = val;
      else if (key === 'Artist') m.artist = val;
      else if (key === 'Version') m.version = val;
      else if (key === 'CircleSize') m.keys = Math.trunc(parseFloat(val)) || 4;
    } else if (section === 'TimingPoints') {
      if (gotTiming) continue;
      const p = line.split(',');
      const t = parseFloat(p[0]), beat = parseFloat(p[1]);
      if (p.length < 2 || isNaN(t) || !(beat > 0)) continue;
      if (p.length >= 7 && p[6].trim() === '0') continue;     // inherited point
      m.bpm = 60000 / beat; m.offset = t / 1000; gotTiming = true;
    } else if (section === 'HitObjects') raw.push(line.split(','));
  }
  if (m.mode !== 3) return m;
  const keys = Math.max(1, m.keys), seen = new Set();
  for (const p of raw) {
    const x = parseFloat(p[0]), ms = parseFloat(p[2]), type = parseInt(p[3], 10);
    if (p.length < 5 || isNaN(x) || isNaN(ms) || isNaN(type)) continue;
    const col = Math.min(keys - 1, Math.max(0, Math.floor(x * keys / 512)));
    let dur = 0;
    if ((type & 128) && p.length > 5) {
      const end = parseFloat((p[5] || '').split(':')[0]);
      if (!isNaN(end)) { dur = (end - ms) / 1000; if (dur < 0.12) dur = 0; }   // too short to be a playable hold
    } else if (!(type & 1)) continue;
    const k = `${Math.trunc(ms)}-${col}`;
    if (seen.has(k)) continue;
    seen.add(k);
    m.notes.push(newNote(ms / 1000, col, dur));
  }
  return m;
}

const lanesOf = (m) => Math.min(8, Math.max(3, m.keys));
function levelOf(m) {
  const start = Math.min(...m.notes.map((n) => n.time)), end = Math.max(...m.notes.map(noteEnd));
  const nps = m.notes.length / Math.max(10, end - start);
  return Math.min(20, Math.max(1, Math.round(3 * Math.sqrt(nps))));
}

/**
 * Builds a song (without audio/duration) from parsed maps. `chosen` is the map the user picked (single .osu),
 * or null for a whole set, where the most common key count becomes the song's.
 */
export function songFromOsuMaps(maps, chosen = null) {
  const mania = maps.filter((m) => m.mode === 3 && m.notes.length);
  if (chosen && chosen.mode !== 3) throw new Error('That .osu file is osu!standard, not osu!mania. Only mania (key) beatmaps can be imported.');
  if (!mania.length) throw new Error('This beatmap has no osu!mania difficulties.');
  let target = chosen && chosen.mode === 3 ? chosen : null;
  if (!target) {
    const groups = new Map();
    for (const m of mania) { const k = `${m.keys}|${m.audio}`; (groups.get(k) || groups.set(k, []).get(k)).push(m); }
    const best = [...groups.values()].sort((a, b) => b.length - a.length || b[0].keys - a[0].keys)[0];
    target = best[0];
  }
  const set = mania.filter((m) => m.audio === target.audio).sort((a, b) => lanesOf(a) - lanesOf(b) || levelOf(a) - levelOf(b));
  const keyCount = lanesOf(target);
  const charts = set.map((m) => {
    const k = lanesOf(m);
    let notes = m.notes;
    if (m.keys !== k) {      // fold unusual key counts (1–2K, 9–10K) into 3–8 lanes
      const seen = new Set();
      notes = notes.map((n) => ({ ...n, lane: Math.min(k - 1, Math.floor(n.lane * k / m.keys)) })).filter((n) => { const key = `${Math.trunc(n.time * 1000)}-${n.lane}`; if (seen.has(key)) return false; seen.add(key); return true; });
    }
    const c = newChart(m.version, levelOf(m), notes);
    c.keys = k === keyCount ? null : k;
    sortNotes(c.notes);
    return c;
  });
  const song = newSong({ id: 'custom.' + uid().slice(-8), title: target.title, artist: target.artist, bpm: Math.round(target.bpm * 100) / 100, offset: target.offset,
    keyCount, duration: 0, audioFile: 'audio', hue: (hashString(target.title) % 1000) / 1000, charts, source: 'osz' });
  return { song, audio: target.audio };
}

/** Imports the picked files: one .osz, or one or more .osu files together with their audio file. */
export async function importOsuFiles(app, files) {
  const maps = [], audios = new Map();       // lower-case base name -> {name, bytes}
  let chosen = null;
  const osuFiles = files.filter((f) => /\.osu$/i.test(f.name));
  for (const f of files) {
    const ext = f.name.split('.').pop().toLowerCase();
    if (ext === 'osz' || ext === 'zip') {
      const entries = unzipSync(new Uint8Array(await f.arrayBuffer()));
      for (const [path, data] of Object.entries(entries)) {
        if (path.endsWith('/') || baseName(path).startsWith('.')) continue;
        const e = path.split('.').pop().toLowerCase();
        if (e === 'osu') maps.push(parseOsu(strFromU8(data), baseName(path)));
        else if (AUDIO_EXTS.includes(e)) audios.set(baseName(path).toLowerCase(), { name: baseName(path), bytes: data });
      }
    } else if (ext === 'osu') {
      const m = parseOsu(await f.text(), f.name); maps.push(m);
      if (osuFiles.length === 1) chosen = m;
    } else if (AUDIO_EXTS.includes(ext)) audios.set(f.name.toLowerCase(), { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
  }
  if (!maps.length) throw new Error('No .osu beatmap found in that selection.');
  const { song, audio } = songFromOsuMaps(maps, chosen);
  const a = audios.get(baseName(audio).toLowerCase());
  if (!a) throw new Error(`The audio file “${audio}” wasn't found. Select it together with the .osu file(s) (in the file picker, press Ctrl+A in the beatmap folder), or import the .osz instead.`);
  const abuf = a.bytes.buffer.slice(a.bytes.byteOffset, a.bytes.byteOffset + a.bytes.byteLength);
  let decoded;
  try { decoded = await app.audio.ctx.decodeAudioData(abuf.slice(0)); } catch (e) { throw new Error('The beatmap audio could not be decoded.'); }
  song.duration = decoded.duration; song.audioFile = a.name;
  const { library } = await import('./store.js');
  await library.saveCustom(song, { bytes: abuf, name: a.name });
  return song;
}
