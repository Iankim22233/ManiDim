import { h, header, setKids, key, hsl } from './dom.js';
import { EVENT_KINDS, EVENT_ORDER, eventLength, newNote, newEvent, newChart, noteIsHold, noteEnd, segments, laneAt, objectCount, sortNotes } from '../model.js';
import { clamp, formatTime } from '../util.js';
import { laneColor } from '../theme.js';
import { drawChartFX } from '../renderer.js';
import { bufferFor, workerCall } from '../buffers.js';
import { AudioEngine } from '../audio.js';
import { keyLabel, SONG_KEY_COUNTS } from '../store.js';
import { buildAutoNotes } from '../analysis.js';
import { exportMadim } from '../madim.js';

const GUTTER = 70, RULER = 38, EVROW = 34;
const SNAPS = [1, 2, 3, 4, 6, 8, 12, 16];
const TOOLS = [['tap', '●', 'Tap', 'Click a lane to drop a tap note.'], ['hold', '▬', 'Hold', 'Click and drag along a lane to make a hold.'],
  ['slideL', '◀', 'Slide ◀', 'Click on a hold to add a slide to the left.'], ['slideR', '▶', 'Slide ▶', 'Click on a hold to add a slide to the right.'],
  ['erase', '⌫', 'Erase', 'Click a note, slide marker or effect to remove it.'], ['event', '✨', 'Effect', 'Click the FX row (above the lanes) to place the chosen effect. Click an effect to remove it.']];

export function mount(app, root) {
  const { store, library, audio } = app;
  const rec = library.get(app.editorSongId);
  if (!rec || rec.builtinKey) { setTimeout(() => app.go('songs')); return {}; }
  const m = {
    song: structuredClone(rec), ci: Math.min(app.editorState.chart || 0, rec.charts.length - 1), tool: 'tap', snapIdx: 3, playhead: app.editorState.playhead || 0,
    playing: false, recording: false, quant: true, hitSounds: true, px: 170, viewStart: Math.max(-0.6, (app.editorState.playhead || 0) - 1),
    hover: null, dragStart: null, dragNow: null, undo: [], redo: [], brush: { kind: 'sparkles', hue: 0.12, dur: 4 }, pending: new Map(),
    analysis: null, autoDiff: 1, lastSound: 0, buffer: null, busy: null,
  };
  if (!m.song.charts.length) m.song.charts = [newChart('Custom')];
  const chart = () => m.song.charts[Math.min(m.ci, m.song.charts.length - 1)];
  const nKeys = () => m.song.keyCount;
  const spb = () => 60 / Math.max(30, m.song.bpm);
  const snap = () => SNAPS[m.snapIdx];
  const snapped = (t) => { const step = spb() / snap(); return m.song.offset + Math.round((t - m.song.offset) / step) * step; };

  // ---------------------------------------------------------------- DOM skeleton
  const timeline = h('canvas', { class: 'timeline' }), mini = h('canvas', { class: 'mini' });
  const side = h('div', { class: 'side' }), topbar = h('div', {});
  const busyEl = h('div', {});
  const el = h('div', { class: 'screen editor' }, topbar, h('div', { class: 'body' }, side, h('div', { class: 'tl' }, timeline, mini, h('div', { class: 'help' }, 'Space play · ←/→ step · 1–6 tools · R record · T test · [ ] snap · Ctrl-scroll or − = zoom'))), busyEl);
  root.append(el);
  let toastTimer;
  const flash = (t) => app.toast(t);

  const persist = () => {
    const c = chart(); sortNotes(c.notes); c.events.sort((a, b) => a.time - b.time);
    c.level = clamp(Math.round(objectCount(c) / Math.max(10, m.song.duration) * 2.1), 1, 15);
    library.saveCustom(JSON.parse(JSON.stringify(m.song))).catch(() => {});
  };
  const checkpoint = () => { const c = chart(); m.undo.push({ notes: structuredClone(c.notes), events: structuredClone(c.events) }); if (m.undo.length > 80) m.undo.shift(); m.redo = []; };
  const undo = () => { const s = m.undo.pop(); if (!s) return; const c = chart(); m.redo.push({ notes: structuredClone(c.notes), events: structuredClone(c.events) }); c.notes = s.notes; c.events = s.events; persist(); renderTop(); renderSide(); };
  const redo = () => { const s = m.redo.pop(); if (!s) return; const c = chart(); m.undo.push({ notes: structuredClone(c.notes), events: structuredClone(c.events) }); c.notes = s.notes; c.events = s.events; persist(); renderTop(); renderSide(); };

  // ---------------------------------------------------------------- audio / transport
  async function ensureBuffer() { if (!m.buffer) m.buffer = await bufferFor(audio, m.song); return m.buffer; }
  async function play() {
    if (m.playing) return;
    try { const buf = await ensureBuffer(); audio.setBuffer('c:' + m.song.id, buf); } catch (e) { flash('Audio file missing'); return; }
    audio.setVolumes(store.settings.musicVolume, store.settings.sfxVolume);
    audio.play(m.playhead, 0.05, 1); m.playing = true; m.lastSound = m.playhead; renderTop();
  }
  function pause() { if (!m.playing) return; m.playing = false; audio.stop(); finishPending(m.playhead); renderTop(); }
  const togglePlay = () => (m.playing ? pause() : play());
  function seek(t) { m.playhead = clamp(t, 0, m.song.duration); m.lastSound = m.playhead; if (m.playing) { audio.play(m.playhead, 0.05, 1); } keepVisible(); }
  function keepVisible() { const w = timeline.clientWidth - GUTTER, px = X(m.playhead); if (px > GUTTER + w * 0.72 || px < GUTTER) m.viewStart = m.playhead - w * 0.28 / m.px; }
  const offsetSec = () => store.settings.audioOffsetMs / 1000;

  // ---------------------------------------------------------------- geometry
  const X = (t) => GUTTER + (t - m.viewStart) * m.px;
  const T = (x) => m.viewStart + (x - GUTTER) / m.px;
  const laneH = () => (timeline.clientHeight - RULER - EVROW) / nKeys();
  const laneAtY = (y) => Math.floor((y - RULER - EVROW) / Math.max(1, laneH()));
  const Y = (l) => RULER + EVROW + (l + 0.5) * laneH();

  function noteIndex(lane, t) {
    const tol = 9 / m.px; const notes = chart().notes;
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i];
      if (!noteIsHold(n)) { if (n.lane === lane && Math.abs(n.time - t) < tol) return i; }
      else for (const s of segments(n, nKeys())) if (s.lane === lane && t >= s.from - tol && t <= s.to + tol) return i;
    }
    return -1;
  }

  // ---------------------------------------------------------------- editing actions
  function eventClick(t) {
    const tol = 13 / m.px, c = chart();
    const i = c.events.findIndex((e) => Math.abs(e.time - t) < tol || (EVENT_KINDS[e.kind].usesDuration && t >= e.time && t <= e.time + eventLength(e)));
    if (i >= 0) { if (m.tool === 'event' || m.tool === 'erase') { checkpoint(); c.events.splice(i, 1); persist(); renderSide(); } return; }
    if (m.tool !== 'event') { if (m.tool !== 'erase') flash('Pick the Effect tool (6) to place effects'); return; }
    checkpoint();
    c.events.push(newEvent(Math.max(0, snapped(t)), m.brush.kind, m.brush.hue, EVENT_KINDS[m.brush.kind].usesDuration ? m.brush.dur : 0));
    persist(); renderSide(); if (m.hitSounds && !m.playing) audio.playSfx('slide', 0.5);
  }

  function pointerUp(p) {
    const s = m.dragStart; m.dragStart = null; m.dragNow = null; if (!s) return;
    if (s.y < RULER) return;
    if (s.y < RULER + EVROW) { eventClick(T(s.x)); return; }
    const l = laneAtY(s.y); if (l < 0 || l >= nKeys()) return;
    if (m.tool === 'event') { flash('Click the FX row above the lanes to place effects'); return; }
    const t0 = T(s.x), moved = Math.hypot(p.x - s.x, p.y - s.y) > 6, c = chart(), K = nKeys();
    switch (m.tool) {
      case 'tap': { const i = noteIndex(l, t0); checkpoint(); if (i >= 0) c.notes.splice(i, 1); else c.notes.push(newNote(Math.max(0, snapped(t0)), l)); persist(); break; }
      case 'hold': {
        const a = Math.max(0, snapped(t0)), b = snapped(T(p.x));
        if (moved && Math.abs(b - a) >= spb() / snap() * 0.9) { checkpoint(); c.notes.push(newNote(Math.min(a, b), l, Math.abs(b - a))); }
        else { const i = noteIndex(l, t0); checkpoint(); if (i >= 0) c.notes.splice(i, 1); else c.notes.push(newNote(a, l, spb())); }
        persist(); break;
      }
      case 'slideL': case 'slideR': {
        const dir = m.tool === 'slideL' ? -1 : 1, i = noteIndex(l, t0);
        if (i < 0 || !noteIsHold(c.notes[i])) { flash('Click on a hold note to add a slide'); return; }
        const n = c.notes[i], si = n.slides.findIndex((x) => Math.abs(x.time - t0) < 12 / m.px);
        if (si >= 0) { checkpoint(); n.slides.splice(si, 1); persist(); break; }
        const st = snapped(t0);
        if (!(st > n.time + 0.04 && st < noteEnd(n) - 0.04)) { flash('Slides go inside a hold, not on its ends'); return; }
        const before = laneAt(n, st - 1e-6, K), after = clamp(before + dir, 0, K - 1);
        if (after === before) { flash('No lane there to slide into'); return; }
        checkpoint(); n.slides.push({ time: st, dir }); n.slides.sort((x, y) => x.time - y.time); persist(); break;
      }
      case 'erase': {
        const i = noteIndex(l, t0);
        if (i >= 0) { const n = c.notes[i]; checkpoint(); const si = n.slides.findIndex((x) => Math.abs(x.time - t0) < 12 / m.px); if (si >= 0) n.slides.splice(si, 1); else c.notes.splice(i, 1); persist(); }
        break;
      }
      default: break;
    }
    if (m.hitSounds && !m.playing) audio.playSfx('move', 0.6);
    renderTop(); renderSide();
  }

  // ---------------------------------------------------------------- recording
  function recordKey(lane, down, code, ts) {
    const t = audio.position(ts / 1000 - offsetSec());
    if (down) { if (!m.pending.has(code)) m.pending.set(code, { lane, start: t, slides: [] }); } else finishPendingCode(code, t);
  }
  function recordSlide(dir, ts) {
    const t = audio.position(ts / 1000 - offsetSec());
    let best = null; for (const [code, p] of m.pending) if (!best || p.start > best[1].start) best = [code, p];
    if (!best) return;
    const p = best[1], cur = clamp(p.lane + p.slides.reduce((a, s) => a + s.dir, 0), 0, nKeys() - 1);
    if (clamp(cur + dir, 0, nKeys() - 1) === cur) return;
    p.slides.push({ time: t, dir }); audio.playSfx('slide', 0.6);
  }
  function finishPendingCode(code, t) {
    const p = m.pending.get(code); if (!p) return; m.pending.delete(code);
    checkpoint();
    const q = (v) => (m.quant ? Math.max(0, snapped(v)) : Math.max(0, v));
    const start = q(p.start), n = newNote(start, p.lane), dur = t - p.start;
    if (dur > 0.22) {
      let end = q(t); if (end <= start + 0.05) end = start + dur;
      n.duration = end - start;
      n.slides = p.slides.map((s) => ({ time: q(s.time), dir: s.dir })).filter((s) => s.time > n.time + 0.02 && s.time < noteEnd(n) - 0.02);
    }
    chart().notes.push(n); audio.playSfx(noteIsHold(n) ? 'hold' : 'tap', 0.6); persist();
  }
  function finishPending(t) { for (const code of [...m.pending.keys()]) finishPendingCode(code, t); }

  // ---------------------------------------------------------------- analysis
  async function analysis() {
    if (m.analysis) return m.analysis;
    const buf = await ensureBuffer();
    const chans = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i).slice());
    const { result } = await workerCall({ type: 'analyze', channels: chans, sampleRate: buf.sampleRate }, chans.map((c) => c.buffer));
    m.analysis = result; return result;
  }
  const busy = (text) => { setKids(busyEl, text ? h('div', { class: 'busy' }, h('div', { class: 'panel' }, h('div', { class: 'spin' }), text)) : null); };
  async function detectTempo() { busy('Analysing tempo…'); try { const a = await analysis(); m.song.bpm = a.bpm; m.song.offset = a.offset; persist(); flash(`Detected ${a.bpm.toFixed(1)} BPM`); renderSide(); } catch (e) { flash('Couldn\'t analyse the audio'); } busy(null); }
  async function autoGenerate() {
    busy('Charting…');
    try { const a = { ...(await analysis()), bpm: m.song.bpm, offset: m.song.offset }; const notes = buildAutoNotes(a, nKeys(), m.autoDiff, Math.floor(Math.random() * 1e9)); checkpoint(); chart().notes = notes; persist(); flash(`Generated ${notes.length} notes`); renderTop(); renderSide(); }
    catch (e) { flash('Couldn\'t analyse the audio'); }
    busy(null);
  }

  // ---------------------------------------------------------------- UI: top bar & sidebar
  function renderTop() {
    setKids(topbar, h('div', { class: 'header' },
      h('button', { class: 'btn small', onclick: back }, '‹ Songs'),
      h('div', {}, h('div', { class: 'title', style: { fontSize: '26px' } }, m.song.title), h('div', { class: 'subtitle' }, `Chart editor · ${chart().notes.length} notes`)),
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn small', onclick: () => { persist(); exportMadim(app, m.song); } }, '⇧ Export'),
      h('button', { class: 'btn small', disabled: !m.undo.length, onclick: undo }, '↶'), h('button', { class: 'btn small', disabled: !m.redo.length, onclick: redo }, '↷'),
      h('button', { class: 'btn small green', style: { width: '100px' }, onclick: togglePlay }, m.playing ? '❚❚ Pause' : '▶ Play'),
      h('button', { class: `btn small${m.recording ? ' sel' : ''}`, onclick: toggleRecord }, h('span', { style: { color: m.recording ? '#e22' : '#000' } }, '●'), m.recording ? 'Recording' : 'Record'),
      h('button', { class: 'btn small pink', onclick: testPlay }, '🎮 Test Play')));
  }
  function toggleRecord() { m.recording = !m.recording; flash(m.recording ? 'Recording: play the lane keys + slide keys along with the song' : 'Recording off'); if (m.recording && !m.playing) play(); renderTop(); }
  function testPlay() {
    if (!chart().notes.length) { flash('Add some notes first'); return; }
    pause(); persist(); app.editorState = { playhead: m.playhead, chart: m.ci };
    app.go('game', { song: JSON.parse(JSON.stringify(m.song)), chartIndex: m.ci, startTime: Math.max(0, snapped(m.playhead) - 0.01), fromEditor: true });
  }
  function back() { audio.playSfx('back'); pause(); persist(); app.editorState = { playhead: 0, chart: 0 }; app.go('songs'); }

  const card = (title, ...kids) => h('div', { class: 'panel card' }, h('h5', {}, title), ...kids);
  const field = (label, value, onchange, w) => h('div', { style: w ? { width: w } : {} }, h('label', { class: 'f' }, label), h('input', { type: 'text', value, onchange: (e) => onchange(e.target.value) }));
  const numField = (label, get, set) => {
    const inp = h('input', { type: 'text', value: String(Math.round(get() * 1000) / 1000) });
    inp.addEventListener('input', () => { const c = inp.value.replace(/[^0-9.\-]/g, ''); if (c !== inp.value) inp.value = c; const v = Number(c); if (c !== '' && isFinite(v)) set(v); });
    inp.addEventListener('change', () => { persist(); inp.value = String(Math.round(get() * 1000) / 1000); });
    return h('div', { style: { flex: 1 } }, h('label', { class: 'f' }, label), inp);
  };
  function renderSide() {
    const c = chart(), tool = TOOLS.find((t) => t[0] === m.tool);
    setKids(side,
      card('Tools', TOOLS.map(([id, ico, name], i) => h('button', { class: `btn tool${m.tool === id ? ' sel' : ''}`, onclick: () => { m.tool = id; audio.playSfx('move'); renderSide(); } }, ico, name, h('span', { class: 'n' }, i + 1))),
        h('div', { class: 'small-text' }, tool[3]),
        h('div', { class: 'row' }, h('b', { style: { fontSize: '13px' } }, `Snap ${snap()} per beat`), h('div', { class: 'spacer' }),
          h('button', { class: 'btn small', onclick: () => { m.snapIdx = Math.max(0, m.snapIdx - 1); renderSide(); } }, '−'), h('button', { class: 'btn small', onclick: () => { m.snapIdx = Math.min(SNAPS.length - 1, m.snapIdx + 1); renderSide(); } }, '+')),
        h('div', { class: 'row' }, h('b', { style: { fontSize: '13px' } }, 'Hit sounds'), h('div', { class: 'spacer' }), h('div', { class: `switch${m.hitSounds ? ' on' : ''}`, onclick: (e) => { m.hitSounds = !m.hitSounds; e.currentTarget.classList.toggle('on', m.hitSounds); } })),
        h('div', { class: 'row' }, h('b', { style: { fontSize: '13px' } }, 'Quantize recording'), h('div', { class: 'spacer' }), h('div', { class: `switch${m.quant ? ' on' : ''}`, onclick: (e) => { m.quant = !m.quant; e.currentTarget.classList.toggle('on', m.quant); } }))),
      m.tool === 'event' ? card('Effect',
        h('div', { class: 'grid2' }, EVENT_ORDER.map((k) => h('button', { class: `btn${m.brush.kind === k ? ' sel' : ''}`, onclick: () => { m.brush.kind = k; audio.playSfx('move'); renderSide(); } }, EVENT_KINDS[k].icon, EVENT_KINDS[k].title))),
        EVENT_KINDS[m.brush.kind].usesHue ? [h('label', { class: 'f' }, 'Colour'), h('input', { type: 'range', min: 0, max: 1, step: 0.01, value: m.brush.hue, style: { '--p': `${m.brush.hue * 100}%`, '--tint': hsl(m.brush.hue) }, oninput: (e) => { m.brush.hue = Number(e.target.value); e.target.style.setProperty('--p', `${m.brush.hue * 100}%`); e.target.style.setProperty('--tint', hsl(m.brush.hue)); } })] : null,
        EVENT_KINDS[m.brush.kind].usesDuration ? h('div', { class: 'row' }, h('b', { style: { fontSize: '13px' } }, `Length ${m.brush.dur} s`), h('div', { class: 'spacer' }),
          h('button', { class: 'btn small', onclick: () => { m.brush.dur = Math.max(1, m.brush.dur - 1); renderSide(); } }, '−'), h('button', { class: 'btn small', onclick: () => { m.brush.dur = Math.min(30, m.brush.dur + 1); renderSide(); } }, '+')) : null,
        h('div', { class: 'small-text' }, `${c.events.length} effects in this chart. Scrub or play to preview them over the lanes.`)) : null,
      card('Chart',
        h('div', { class: 'chips' }, m.song.charts.map((ch, i) => h('button', { class: `btn small${i === m.ci ? ' sel' : ''}`, onclick: () => { m.ci = i; m.undo = []; m.redo = []; audio.playSfx('move'); renderTop(); renderSide(); } }, ch.name))),
        field('Name', c.name, (v) => { c.name = v || 'Chart'; persist(); renderSide(); }),
        h('div', { class: 'row', style: { gap: '6px' } }, h('button', { class: 'btn small', onclick: addChart }, '+ Add'), h('button', { class: 'btn small', onclick: delChart }, '🗑 Delete'),
          h('button', { class: 'btn small', onclick: () => { if (confirm('Clear every note in this chart?')) { checkpoint(); c.notes = []; c.events = []; persist(); renderTop(); renderSide(); } } }, '✕ Clear')),
        h('div', { class: 'small-text' }, `Level ${c.level} · ${objectCount(c)} scored objects`)),
      card('Auto-chart', h('div', { class: 'chips' }, ['Easy', 'Normal', 'Hard'].map((n, i) => h('button', { class: `btn small${m.autoDiff === i ? ' sel' : ''}`, onclick: () => { m.autoDiff = i; renderSide(); } }, n))),
        h('button', { class: 'btn small pink', style: { width: '100%' }, onclick: autoGenerate }, '✦ Generate from audio'), h('div', { class: 'small-text' }, 'Replaces this chart\'s notes using the song\'s beats. Undo works.')),
      card('Song', field('Title', m.song.title, (v) => { m.song.title = v || 'Untitled'; persist(); renderTop(); }), field('Artist', m.song.artist, (v) => { m.song.artist = v; persist(); }),
        h('div', { class: 'row' }, numField('BPM', () => m.song.bpm, (v) => { m.song.bpm = Math.max(20, v); }), numField('Offset (s)', () => m.song.offset, (v) => { m.song.offset = v; })),
        h('div', { class: 'row', style: { gap: '6px' } }, h('button', { class: 'btn small', onclick: detectTempo }, '♩ Detect'), h('button', { class: 'btn small', onclick: () => { m.song.offset = m.playhead; persist(); flash(`Beat grid starts at ${m.playhead.toFixed(3)} s`); renderSide(); } }, '⌖ Beat 1 = playhead')),
        h('label', { class: 'f' }, 'Keys'), h('div', { class: 'chips' }, SONG_KEY_COUNTS.map((k) => h('button', { class: `btn small${nKeys() === k ? ' sel' : ''}`, onclick: () => setKeys(k) }, k)))));
  }
  function addChart() { const names = ['Easy', 'Normal', 'Hard', 'Expert', 'Custom 2', 'Custom 3'].filter((n) => !m.song.charts.some((c) => c.name === n)); m.song.charts.push(newChart(names[0] || `Chart ${m.song.charts.length + 1}`)); m.ci = m.song.charts.length - 1; persist(); renderSide(); }
  function delChart() { if (m.song.charts.length < 2) { flash('A song needs at least one chart'); return; } m.song.charts.splice(m.ci, 1); m.ci = Math.max(0, m.ci - 1); persist(); renderSide(); }
  function setKeys(k) {
    if (k === nKeys()) return;
    for (const c of m.song.charts) for (const n of c.notes) { n.lane = Math.min(n.lane, k - 1); }
    m.song.keyCount = k; persist(); renderSide();
  }

  // ---------------------------------------------------------------- drawing
  const tctx = timeline.getContext('2d'), mctx = mini.getContext('2d');
  function sizeCanvas(cv) { const d = window.devicePixelRatio || 1, w = cv.clientWidth, hh = cv.clientHeight; if (cv.width !== Math.round(w * d) || cv.height !== Math.round(hh * d)) { cv.width = Math.round(w * d); cv.height = Math.round(hh * d); } return d; }

  function drawTimeline() {
    const d = sizeCanvas(timeline), W = timeline.clientWidth, H = timeline.clientHeight, ctx = tctx, n = nKeys(), c = chart();
    ctx.setTransform(d, 0, 0, d, 0, 0);
    const lh = (H - RULER - EVROW) / n;
    ctx.fillStyle = '#f7f7f7'; ctx.fillRect(0, 0, W, H);
    for (let l = 0; l < n; l++) { ctx.fillStyle = laneColor(l, n, l % 2 === 0 ? 0.10 : 0.05); ctx.fillRect(0, RULER + EVROW + l * lh, W, lh); }
    ctx.save(); ctx.beginPath(); ctx.rect(GUTTER, RULER, W - GUTTER, H - RULER); ctx.clip();
    const t0 = T(GUTTER), t1 = T(W), sp = spb(), sub = sp / snap();
    let k = Math.ceil((t0 - m.song.offset) / sub);
    const subVisible = sub * m.px >= 6;
    for (let guard = 0; guard < 5000; guard++, k++) {
      const t = m.song.offset + k * sub; if (t > t1) break;
      const isBeat = k % snap() === 0, beatIdx = Math.floor(k / snap()), isBar = isBeat && (((beatIdx % 4) + 4) % 4 === 0);
      if (isBar || isBeat || subVisible) { ctx.fillStyle = `rgba(0,0,0,${isBar ? 0.5 : isBeat ? 0.22 : 0.07})`; ctx.fillRect(X(t) - (isBar ? 1 : 0.5), RULER, isBar ? 2 : 1, H - RULER); }
    }
    for (let l = 0; l <= n; l++) { ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(GUTTER, RULER + EVROW + l * lh - 0.75, W, 1.5); }
    const hh = lh * 0.62;
    const rr = (x, y, w, h2, r) => { ctx.beginPath(); ctx.roundRect(x, y, w, h2, r); };
    const noteBox = (nx, ny, col) => { const g = ctx.createLinearGradient(nx - 11, ny - hh / 2, nx + 11, ny + hh / 2); g.addColorStop(0, '#fff'); g.addColorStop(1, col); rr(nx - 11, ny - hh / 2, 22, hh, 8); ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = '#000'; ctx.lineWidth = 2.5; ctx.stroke(); };
    for (const note of c.notes) {
      if (noteEnd(note) < t0 - 0.5 || note.time > t1 + 0.5) continue;
      const segs = segments(note, n), col = laneColor(segs[0].lane, n);
      if (!noteIsHold(note)) noteBox(X(note.time), Y(note.lane), col);
      else {
        segs.forEach((sg, i) => { const x0 = X(sg.from) - (i === 0 ? 11 : 0); rr(x0, Y(sg.lane) - hh * 0.36, Math.max(8, X(sg.to) - X(sg.from) + (i === 0 ? 11 : 0)), hh * 0.72, 8); ctx.fillStyle = laneColor(sg.lane, n, 0.85); ctx.fill(); ctx.strokeStyle = '#000'; ctx.lineWidth = 2.5; ctx.stroke(); });
        noteBox(X(note.time), Y(note.lane), col);
        note.slides.forEach((sl, i) => {
          const x = X(sl.time), a = Y(segs[i].lane), b = Y(segs[i + 1].lane);
          ctx.beginPath(); ctx.moveTo(x, a); ctx.lineTo(x, b); ctx.strokeStyle = '#000'; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.stroke(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
          const my = (a + b) / 2; ctx.beginPath(); ctx.arc(x, my, 11, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#000'; ctx.lineWidth = 2.5; ctx.stroke();
          ctx.fillStyle = '#000'; ctx.font = '900 10px Nunito, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(sl.dir < 0 ? '◀' : '▶', x, my + 0.5);
        });
      }
    }
    for (const p of m.pending.values()) { const w = Math.max(10, X(m.playhead) - X(p.start)); rr(X(p.start) - 11, Y(p.lane) - hh * 0.36, w + 11, hh * 0.72, 8); ctx.fillStyle = 'rgba(230,40,40,.6)'; ctx.fill(); ctx.strokeStyle = '#000'; ctx.lineWidth = 2.5; ctx.stroke(); }
    const sub2 = sub;
    if (m.hover && m.hover.x > GUTTER && m.hover.y > RULER + EVROW && !m.dragStart) {
      const l = laneAtY(m.hover.y);
      if (l >= 0 && l < n) {
        const st = m.song.offset + Math.round((T(m.hover.x) - m.song.offset) / sub2) * sub2;
        if (m.tool === 'tap' || m.tool === 'hold') { rr(X(st) - 11, Y(l) - hh / 2, 22, hh, 8); ctx.fillStyle = laneColor(l, n, 0.45); ctx.fill(); ctx.setLineDash([4, 3]); ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash([]); }
        else { ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fillRect(X(st) - 1, Y(l) - lh / 2, 2, lh); }
      }
    }
    if (m.tool === 'hold' && m.dragStart && m.dragNow && m.dragStart.y > RULER + EVROW) {
      const l = laneAtY(m.dragStart.y); if (l >= 0 && l < n) {
        const sn = (x) => m.song.offset + Math.round((T(x) - m.song.offset) / sub2) * sub2, a = sn(m.dragStart.x), b = sn(m.dragNow.x), x0 = X(Math.min(a, b)), x1 = X(Math.max(a, b));
        rr(x0 - 11, Y(l) - hh * 0.36, Math.max(22, x1 - x0 + 22), hh * 0.72, 8); ctx.fillStyle = laneColor(l, n, 0.6); ctx.fill(); ctx.setLineDash([5, 3]); ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = 2.5; ctx.stroke(); ctx.setLineDash([]);
      }
    }
    // FX row
    ctx.fillStyle = 'rgb(237,224,252)'; ctx.fillRect(GUTTER, RULER, W - GUTTER, EVROW); ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(GUTTER, RULER + EVROW - 1, W - GUTTER, 2);
    for (const e of c.events) {
      const len = eventLength(e); if (e.time > t1 + 0.5 || e.time + len < t0 - 0.5) continue;
      const col = hsl(e.hue, 0.55), x = X(e.time);
      if (EVENT_KINDS[e.kind].usesDuration) { rr(x, RULER + 6, Math.max(8, len * m.px), EVROW - 12, 7); ctx.fillStyle = col.replace('rgb', 'rgba').replace(')', ',.45)'); ctx.fill(); ctx.setLineDash([4, 3]); ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash([]); }
      rr(x - 14, RULER + 3, 28, EVROW - 6, 9); ctx.fillStyle = col; ctx.fill(); ctx.strokeStyle = '#000'; ctx.lineWidth = 2.5; ctx.stroke();
      ctx.font = '14px "Segoe UI Emoji", Nunito, sans-serif'; ctx.fillStyle = '#000'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(EVENT_KINDS[e.kind].icon, x, RULER + EVROW / 2 + 1);
    }
    ctx.restore();
    if (store.settings.chartEffects && c.events.length) {
      ctx.save(); ctx.translate(GUTTER, RULER + EVROW); const aw = W - GUTTER, ah = H - RULER - EVROW; ctx.beginPath(); ctx.rect(0, 0, aw, ah); ctx.clip();
      drawChartFX(ctx, aw, ah, { x: aw * 0.5, y: ah * 0.7 }, 0.6, c.events, m.playhead); ctx.restore();
    }
    const px = X(m.playhead);
    if (px >= GUTTER) { ctx.fillStyle = '#ff4050'; ctx.fillRect(px - 1.5, 0, 3, H); }
    // ruler
    ctx.fillStyle = '#2e2e2e'; ctx.fillRect(0, 0, W, RULER);
    ctx.save(); ctx.beginPath(); ctx.rect(GUTTER, 0, W - GUTTER, RULER); ctx.clip();
    let kb = Math.ceil((t0 - m.song.offset) / sp);
    for (let guard = 0; guard < 3000; guard++, kb++) {
      const t = m.song.offset + kb * sp; if (t > t1) break;
      const x = X(t), bar = (((kb % 4) + 4) % 4) === 0;
      ctx.fillStyle = `rgba(255,255,255,${bar ? 0.9 : 0.4})`; ctx.fillRect(x - 0.5, bar ? 14 : 26, 1, bar ? RULER - 14 : RULER - 26);
      if (bar && m.px * sp * 4 > 36) { ctx.fillStyle = '#fff'; ctx.font = '800 11px Nunito, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(String(Math.floor(kb / 4) + 1), x + 4, 8); }
    }
    ctx.restore();
    if (px >= GUTTER) { ctx.beginPath(); ctx.moveTo(px - 8, 0); ctx.lineTo(px + 8, 0); ctx.lineTo(px, 14); ctx.closePath(); ctx.fillStyle = '#ff4050'; ctx.fill(); }
    // gutter
    ctx.fillStyle = '#ebebeb'; ctx.fillRect(0, 0, GUTTER, H); ctx.fillStyle = '#000'; ctx.fillRect(GUTTER - 2, 0, 4, H); ctx.fillStyle = '#2e2e2e'; ctx.fillRect(0, 0, GUTTER - 2, RULER);
    ctx.fillStyle = '#fff'; ctx.font = '800 13px Nunito, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(formatTime(Math.max(0, m.playhead)), GUTTER / 2, RULER / 2);
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillText('FX', GUTTER / 2, RULER + EVROW / 2);
    const labels = store.keys(n);
    for (let l = 0; l < n; l++) {
      const ch = Math.min(36, lh - 6); rr(10, Y(l) - ch / 2, GUTTER - 24, ch, 9); ctx.fillStyle = laneColor(l, n); ctx.fill(); ctx.strokeStyle = '#000'; ctx.lineWidth = 3; ctx.stroke();
      const lab = labels[l] ? keyLabel(labels[l]) : String(l + 1); ctx.fillStyle = '#000'; ctx.font = `900 ${lab.length > 2 ? 11 : 16}px Nunito, sans-serif`; ctx.fillText(lab, GUTTER / 2 - 2, Y(l) + 1);
    }
    if (m.recording) { ctx.fillStyle = '#e22'; ctx.fillText('● REC', GUTTER / 2, RULER + EVROW + 14); }
  }

  function drawMini() {
    const d = sizeCanvas(mini), W = mini.clientWidth, H = mini.clientHeight, ctx = mctx, c = chart();
    ctx.setTransform(d, 0, 0, d, 0, 0); ctx.fillStyle = '#f2f2f2'; ctx.fillRect(0, 0, W, H);
    const dur = Math.max(1, m.song.duration), bins = Math.floor(W / 3), cnt = new Array(bins).fill(0);
    for (const n of c.notes) cnt[Math.min(bins - 1, Math.max(0, Math.floor(n.time / dur * bins)))]++;
    const peak = Math.max(3, ...cnt);
    cnt.forEach((v, i) => { const hh = (H - 8) * v / peak; ctx.fillStyle = laneColor(Math.floor(nKeys() / 2), nKeys(), 0.9); ctx.fillRect(i * 3, H - 4 - hh, 2.2, hh); });
    const vw = (timeline.clientWidth - GUTTER) / m.px, vx = Math.max(0, m.viewStart / dur) * W, vwp = Math.min(W - vx, vw / dur * W);
    ctx.fillStyle = 'rgba(0,0,0,.12)'; ctx.fillRect(vx, 2, vwp, H - 4); ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 2; ctx.strokeRect(vx, 2, vwp, H - 4);
    ctx.fillStyle = '#ff4050'; ctx.fillRect(m.playhead / dur * W - 1.5, 0, 3, H);
    ctx.fillStyle = 'rgba(255,255,255,.9)'; const label = `${formatTime(m.playhead)} / ${formatTime(m.song.duration)}`; ctx.font = '800 12px Nunito, sans-serif'; const tw = ctx.measureText(label).width;
    ctx.beginPath(); ctx.roundRect(W - tw - 22, 11, tw + 16, 24, 12); ctx.fill(); ctx.fillStyle = '#000'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillText(label, W - 14, 23);
  }

  // ---------------------------------------------------------------- loop & pointer
  let raf = 0;
  function loop() {
    if (m.playing) {
      const now = audio.position(AudioEngine.perfNow() - offsetSec());
      if (now >= m.song.duration) pause();
      else {
        if (m.hitSounds && !m.recording) {
          for (const n of chart().notes) { if (n.time > m.lastSound && n.time <= now) audio.playSfx(noteIsHold(n) ? 'hold' : 'tap', 0.7); for (const s of n.slides) if (s.time > m.lastSound && s.time <= now) audio.playSfx('slide', 0.7); }
        }
        m.lastSound = now; m.playhead = now; keepVisible();
      }
    }
    drawTimeline(); drawMini(); raf = requestAnimationFrame(loop);
  }
  const pos = (e) => { const r = timeline.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  timeline.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return; const p = pos(e); app.audio.resume();
    if (p.y < RULER) { m.dragStart = { x: p.x, y: p.y }; seek(Math.max(0, T(p.x))); return; }
    if (p.x < GUTTER) return;
    m.dragStart = p; m.dragNow = p;
  });
  window.addEventListener('mousemove', moveHandler); window.addEventListener('mouseup', upHandler);
  function moveHandler(e) {
    const p = pos(e);
    if (e.target === timeline) m.hover = p; else if (!m.dragStart) m.hover = null;
    if (m.dragStart) { if (m.dragStart.y < RULER) seek(Math.max(0, T(p.x))); else m.dragNow = p; }
  }
  function upHandler(e) { if (m.dragStart && m.dragStart.y >= RULER) pointerUp(pos(e)); else m.dragStart = null; }
  timeline.addEventListener('mouseleave', () => { if (!m.dragStart) m.hover = null; });
  timeline.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.altKey) zoom(Math.exp(-e.deltaY * 0.004), pos(e).x);
    else m.viewStart = clamp(m.viewStart + (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) / m.px, -1.5, m.song.duration);
  }, { passive: false });
  function zoom(f, ax) { ax = ax ?? (GUTTER + (timeline.clientWidth - GUTTER) / 2); const ta = T(ax); m.px = clamp(m.px * f, 30, 900); m.viewStart = ta - (ax - GUTTER) / m.px; }
  mini.addEventListener('mousedown', (e) => { const miniDrag = (ev) => { const r = mini.getBoundingClientRect(), t = clamp((ev.clientX - r.left) / r.width, 0, 1) * m.song.duration; seek(t); m.viewStart = t - (timeline.clientWidth - GUTTER) / m.px * 0.3; };
    miniDrag(e); const mv = (ev) => miniDrag(ev), up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); }; window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up); });

  renderTop(); renderSide(); raf = requestAnimationFrame(loop);
  ensureBuffer().catch(() => flash('This song\'s audio could not be loaded'));

  return {
    onKey(e) {
      const keys = store.keys(nKeys());
      if (m.recording && m.playing) {
        const lane = keys.indexOf(e.code);
        if (lane >= 0) { if (!e.repeat) recordKey(lane, true, e.code, e.timeStamp); return; }
        if (!e.repeat && e.code === store.settings.slideLeft) { recordSlide(-1, e.timeStamp); return; }
        if (!e.repeat && e.code === store.settings.slideRight) { recordSlide(1, e.timeStamp); return; }
      }
      if (e.ctrlKey && e.code === 'KeyZ') { e.shiftKey ? redo() : undo(); return; }
      if (e.ctrlKey && e.code === 'KeyY') { redo(); return; }
      const step = spb() / snap();
      switch (e.code) {
        case 'Space': if (!e.repeat) togglePlay(); break;
        case 'ArrowLeft': seek(snapped(m.playhead) - step); break; case 'ArrowRight': seek(snapped(m.playhead) + step); break;
        case 'Home': seek(0); break;
        case 'Escape': if (!e.repeat) back(); break;
        case 'KeyR': if (!e.repeat) toggleRecord(); break; case 'KeyT': if (!e.repeat) testPlay(); break;
        case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4': case 'Digit5': case 'Digit6': m.tool = TOOLS[Number(e.code.slice(5)) - 1][0]; renderSide(); break;
        case 'BracketLeft': m.snapIdx = Math.max(0, m.snapIdx - 1); renderSide(); break; case 'BracketRight': m.snapIdx = Math.min(SNAPS.length - 1, m.snapIdx + 1); renderSide(); break;
        case 'Minus': zoom(0.85); break; case 'Equal': zoom(1.18); break;
        default: break;
      }
    },
    onKeyUp(e) { if (m.recording && m.playing) { const lane = store.keys(nKeys()).indexOf(e.code); if (lane >= 0) recordKey(lane, false, e.code, e.timeStamp); } },
    destroy() { cancelAnimationFrame(raf); window.removeEventListener('mousemove', moveHandler); window.removeEventListener('mouseup', upHandler); if (m.playing) { m.playing = false; audio.stop(); } clearTimeout(toastTimer); persist(); },
  };
}
