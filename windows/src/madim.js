// .madim packages (a renamed zip): ManiDimExport-<title>/chart/<title>.mdc + audio/<title>.wav
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { writeChartText, parseChartText } from './chart_text.js';
import { encodeWav } from './dsp.js';
import { bufferFor } from './buffers.js';
import { library } from './store.js';
import { newSong, newChart } from './model.js';
import { uid } from './util.js';
import { importOsuFiles } from './osu.js';

const AUDIO_EXTS = ['wav', 'mp3', 'm4a', 'aac', 'aif', 'aiff', 'caf', 'flac', 'ogg', 'mp4', 'opus'];
export const safeName = (s) => (s.replace(/[\/\\:*?"<>|\n\r\t]/g, '-').trim() || 'Song');

export function wavBytesOf(audioBuffer) {
  const l = audioBuffer.getChannelData(0), r = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : l;
  return encodeWav(l, r, audioBuffer.sampleRate);
}

/** Audio bytes + file name for any song (built-ins are rendered to WAV). */
export async function audioBytesFor(app, song) {
  if (song.builtinKey) { const buf = await bufferFor(app.audio, song); return { bytes: wavBytesOf(buf).buffer, name: 'audio.wav' }; }
  const rec = await library.audioFor(song);
  if (!rec || !rec.bytes) throw new Error('This song has no audio file.');
  return { bytes: rec.bytes, name: rec.name || 'audio.wav' };
}

export function download(name, bytes, mime = 'application/zip') {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export async function exportMadim(app, song) {
  try {
    const audio = await audioBytesFor(app, song);
    const name = safeName(song.title), ext = (audio.name.split('.').pop() || 'wav').toLowerCase();
    const audioName = `${name}.${ext}`;
    const out = { ...song, builtinKey: null, audioFile: audioName };
    const root = `ManiDimExport-${name}`;
    const zip = zipSync({
      [`${root}/chart/${name}.mdc`]: strToU8(writeChartText(out)),
      [`${root}/audio/${audioName}`]: [new Uint8Array(audio.bytes), { level: 0 }],
    }, { level: 6 });
    download(`${root}.madim`, zip);
    app.toast(`Exported ${root}.madim`);
  } catch (e) { app.toast(e.message || 'Export failed'); }
}

export async function importMadimBytes(app, bytes, fileName = 'package') {
  const files = unzipSync(new Uint8Array(bytes));
  const charts = [], audios = [];
  for (const [path, data] of Object.entries(files)) {
    if (path.includes('__MACOSX') || path.split('/').pop().startsWith('.') || path.endsWith('/')) continue;
    const ext = path.split('.').pop().toLowerCase();
    if (['mdc', 'txt', 'json'].includes(ext)) charts.push({ path, data });
    else if (AUDIO_EXTS.includes(ext)) audios.push({ path, data });
  }
  if (!charts.length) throw new Error('This package has no chart file.');
  let song = null, lastErr = '';
  for (const c of charts) {
    try {
      const text = strFromU8(c.data);
      song = c.path.toLowerCase().endsWith('.json') ? songFromJson(JSON.parse(text)) : parseChartText(text);
      break;
    } catch (e) { lastErr = `${c.path.split('/').pop()}: ${e.message}`; }
  }
  if (!song) throw new Error(lastErr || 'The chart could not be read.');
  const audio = audios.find((a) => a.path.split('/').pop() === song.audioFile) || audios[0];
  if (!audio) throw new Error('This package has no audio file.');
  const abuf = audio.data.buffer.slice(audio.data.byteOffset, audio.data.byteOffset + audio.data.byteLength);
  let decoded;
  try { decoded = await app.audio.ctx.decodeAudioData(abuf.slice(0)); } catch (e) { throw new Error('The audio in this package could not be decoded.'); }
  song.id = 'custom.' + uid().slice(-8);
  song.builtinKey = null; song.audioFile = audio.path.split('/').pop();
  song.duration = decoded.duration;
  if (!song.charts.length) song.charts = [newChart('Custom')];
  for (const ch of song.charts) for (const n of ch.notes) n.lane = Math.min(Math.max(0, n.lane), (ch.keys || song.keyCount) - 1);
  await library.saveCustom(song, { bytes: abuf, name: song.audioFile });
  return song;
}

/** Charts exported by older versions (verbose JSON). */
function songFromJson(j) {
  const charts = (j.charts || []).map((c) => ({ ...newChart(c.name || 'Chart', c.level || 1, (c.notes || []).map((n) => ({ id: uid(), time: n.time, lane: n.lane, duration: n.duration || 0, slides: n.slides || [] }))),
    events: (c.events || []).map((e) => ({ id: uid(), time: e.time, kind: e.kind, hue: e.hue ?? 0.12, duration: e.duration || 0 })), lessons: c.lessons || [] }));
  return newSong({ id: j.id, title: j.title, artist: j.artist, bpm: j.bpm || 120, offset: j.offset || 0, keyCount: Math.min(8, Math.max(1, j.keyCount || 4)),
    duration: 0, audioFile: j.audioFile, hue: j.hue ?? Math.random(), charts, timeSigNum: j.timeSigNum || 4, timeSigDen: j.timeSigDen || 4 });
}

export function pickAndImport(app, then) {
  const inp = document.createElement('input'); inp.type = 'file'; inp.multiple = true;
  inp.accept = '.madim,.zip,.osz,.osu,.mp3,.ogg,.wav,.m4a,.flac,.opus';
  inp.onchange = async () => {
    const files = [...inp.files]; if (!files.length) return;
    const isOsu = files.some((f) => /\.(osu|osz)$/i.test(f.name));
    app.toast(`Importing ${files.length === 1 ? files[0].name : files.length + ' files'}…`);
    try {
      const song = isOsu ? await importOsuFiles(app, files) : await importMadimBytes(app, await files[0].arrayBuffer(), files[0].name);
      app.toast(`Imported “${song.title}”`); app.selectedSongId = song.id; app.selectedChart = 0; if (then) then(song);
    } catch (e) { app.toast(e.message || 'Import failed'); }
  };
  inp.click();
}
