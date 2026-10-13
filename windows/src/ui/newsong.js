import { h, modal, setKids } from './dom.js';
import { SONG_KEY_COUNTS } from '../store.js';
import { workerCall } from '../buffers.js';
import { buildAutoNotes } from '../analysis.js';
import { newSong, newChart, objectCount } from '../model.js';
import { uid, clamp } from '../util.js';
import { encodeWav } from '../dsp.js';

export const newCopyId = () => 'custom.' + uid().slice(-8);

export function showNewSong(app) {
  const st = { file: null, bytes: null, blank: false, title: '', artist: '', bpm: '120', bars: 48, keys: 4, auto: true, analysis: null, analyzing: false, working: false, status: '', error: '' };
  const wrap = h('div', { class: 'form' });
  let closed = false;

  async function pick() {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'audio/*,.mp3,.wav,.m4a,.ogg,.flac,.aac';
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      st.file = f; st.blank = false; st.bytes = await f.arrayBuffer(); st.analysis = null; st.analyzing = true; st.error = '';
      if (!st.title) st.title = f.name.replace(/\.[^.]+$/, '');
      render();
      try {
        const buf = await app.audio.ctx.decodeAudioData(st.bytes.slice(0));
        const chans = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i).slice());
        const { result } = await workerCall({ type: 'analyze', channels: chans, sampleRate: buf.sampleRate }, chans.map((c) => c.buffer));
        st.analysis = result; st.bpm = result.bpm.toFixed(1);
      } catch (e) { st.error = 'Couldn\'t analyse that file — you can still set the BPM manually.'; }
      st.analyzing = false; render();
    };
    inp.click();
  }

  function render() {
    const bpmVal = Number(st.bpm);
    const can = !st.working && (st.blank || st.file) && st.title.trim() && bpmVal >= 40;
    const sync = (k) => (e) => { st[k] = e.target.value; };
    setKids(wrap, 
      h('div', { class: 'row' }, h('h2', {}, 'New Song'), h('div', { class: 'spacer' }), h('button', { class: 'btn small', disabled: st.working, onclick: close }, '✕')),
      h('div', { class: 'src-btns' },
        h('button', { class: `btn${!st.blank && st.file ? ' sel' : ''}`, onclick: pick }, h('span', { style: { fontSize: '28px' } }, '♫'), 'Import audio…'),
        h('button', { class: `btn${st.blank ? ' sel' : ''}`, onclick: () => { st.blank = true; st.file = null; st.analysis = null; if (!st.title) st.title = 'Untitled'; render(); } }, h('span', { style: { fontSize: '28px' } }, '𝄞'), 'Blank metronome')),
      st.file && !st.blank ? h('div', { style: { fontWeight: 700, fontSize: '14px' } }, `♪ ${st.file.name}  ${st.analyzing ? '— analysing tempo…' : st.analysis ? `— detected ${st.analysis.bpm.toFixed(1)} BPM · ${st.analysis.onsets.length} onsets` : ''}`) : null,
      h('div', {}, h('label', { class: 'f' }, 'Title'), h('input', { type: 'text', value: st.title, oninput: sync('title') })),
      h('div', {}, h('label', { class: 'f' }, 'Artist'), h('input', { type: 'text', value: st.artist, oninput: sync('artist') })),
      h('div', { class: 'row' }, h('div', { style: { width: '140px' } }, h('label', { class: 'f' }, 'BPM'), h('input', { type: 'text', value: st.bpm, oninput: (e) => { st.bpm = e.target.value.replace(/[^0-9.]/g, ''); if (e.target.value !== st.bpm) e.target.value = st.bpm; } })),
        st.blank ? h('div', {}, h('label', { class: 'f' }, 'Bars'), h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: () => { st.bars = Math.max(8, st.bars - 8); render(); } }, '−'), h('b', { style: { fontSize: '20px', width: '40px', textAlign: 'center' } }, st.bars), h('button', { class: 'btn small', onclick: () => { st.bars = Math.min(256, st.bars + 8); render(); } }, '+'))) : null),
      h('div', {}, h('label', { class: 'f' }, 'Keys (lanes)'), h('div', { class: 'row', style: { gap: '8px' } }, SONG_KEY_COUNTS.map((k) => h('button', { class: `btn small${st.keys === k ? ' sel' : ''}`, onclick: () => { st.keys = k; render(); } }, k)))),
      !st.blank ? h('div', { class: 'row' }, h('div', { class: `switch${st.auto ? ' on' : ''}`, onclick: () => { st.auto = !st.auto; render(); } }),
        h('div', {}, h('b', { style: { fontSize: '16px' } }, 'Auto-generate a starter chart'), h('div', { style: { fontSize: '12px', opacity: 0.5, fontWeight: 700 } }, 'Notes, holds and slides placed from the song\'s beats — then refine in the editor.'))) : null,
      st.error ? h('div', { style: { color: '#d33', fontWeight: 800 } }, st.error) : null,
      h('div', { class: 'row' }, st.working ? h('b', {}, st.status) : null, h('div', { class: 'spacer' }), h('button', { class: 'btn green', disabled: !can, onclick: create }, 'Create & Open Editor →')));
  }

  async function create() {
    st.working = true; st.error = ''; render();
    try {
      const bpm = Number(st.bpm), id = newCopyId();
      let bytes, duration, audioName;
      if (st.blank) {
        st.status = 'Rendering metronome…'; render();
        const { left, right } = await workerCall({ type: 'blank', bpm, bars: st.bars });
        bytes = encodeWav(left, right).buffer; audioName = 'audio.wav'; duration = left.length / 44100;
      } else {
        st.status = 'Reading audio…'; render();
        bytes = st.bytes; audioName = st.file.name;
        duration = (await app.audio.ctx.decodeAudioData(bytes.slice(0))).duration;
      }
      let notes = [], offset = 0;
      if (st.analysis && !st.blank) { offset = st.analysis.offset; if (st.auto) notes = buildAutoNotes({ ...st.analysis, bpm }, st.keys, 1, Math.floor(Math.random() * 1e9)); }
      const chart = newChart('Custom', 1, notes);
      chart.level = clamp(Math.round(objectCount(chart) / Math.max(10, duration) * 2.1), 1, 15);
      const song = newSong({ id, title: st.title.trim(), artist: st.artist.trim() || 'Unknown artist', bpm, offset, keyCount: st.keys, duration, audioFile: audioName, hue: Math.random(), charts: [chart] });
      await app.library.saveCustom(song, { bytes, name: audioName });
      app.selectedSongId = id; app.editorSongId = id; close(); app.go('editor');
    } catch (e) { st.working = false; st.error = e.message || String(e); render(); }
  }

  render();
  const m = modal(app, wrap, { onClose: () => { if (!st.working) close(); } });
  function close() { if (closed) return; closed = true; m.close(); }
}
