import { h, header, toggle, hsl, $, setKids } from './dom.js';
import { fanIconCanvas } from './icons.js';
import { laneColor } from '../theme.js';
import { formatTime } from '../util.js';
import { noteIsHold, noteEnd, chartKeys, mixedKeys, keysLabel } from '../model.js';
import { bufferFor } from '../buffers.js';
import { showMods } from './mods.js';
import { exportMadim, pickAndImport, audioBytesFor } from '../madim.js';
import { newCopyId } from './newsong.js';

export function mount(app, root) {
  const { store, library, audio } = app;
  let previewTimer = null, previewToken = 0, listEl, detailEl;
  const expanded = new Set([library.get(app.selectedSongId)?.id || songsFirst()]);
  function songsFirst() { return library.songs[0]?.id; }

  const songs = () => library.songs;
  const song = () => library.get(app.selectedSongId) || songs()[0];
  const chartIndex = () => Math.min(app.selectedChart, Math.max(0, (song()?.charts.length || 1) - 1));

  const el = h('div', { class: 'screen' });
  root.append(el);

  function build() {
    const count = songs().length;
    setKids(el, 
      header(app, 'Songs', `${count} tracks`, () => app.go('home'),
        h('button', { class: 'btn small', onclick: () => pickAndImport(app, () => { build(); }) }, '⇩ Import'),
        h('button', { class: 'btn small pink', onclick: () => import('./newsong.js').then((m) => m.showNewSong(app)) }, '+ New Song')),
      h('div', { class: 'songs-body' }, listEl = h('div', { class: 'song-list' }), detailEl = h('div', { class: 'detail' })));
    renderList(); renderDetail();
  }

  const diffColor = (i, n) => `hsl(${Math.round((0.38 - 0.38 * (n <= 1 ? 0.5 : i / (n - 1))) * 360)} 70% 75%)`;
  function card(s) {
    const sel = s.id === song().id, open = expanded.has(s.id), n = s.charts.length;
    const icon = h('div', { class: 'icon', style: { '--c': hsl(s.hue) } }, fanIconCanvas(70, s.keyCount));
    const main = h('div', { class: `song-card${sel ? ' sel' : ''}`, 'data-id': s.id, onclick: () => { if (sel) play(); else select(s.id); } },
      icon, h('div', { style: { minWidth: 0 } }, h('h3', {}, s.title),
        h('div', { class: 'artist' }, s.artist, s.source === 'osz' ? h('span', { class: 'pill osz' }, 'OSZ IMPORTED') : null),
        h('div', { class: 'pills' }, h('span', { class: 'pill' }, `${Math.round(s.bpm)} BPM`), h('span', { class: 'pill' }, keysLabel(s)), h('span', { class: 'pill' }, formatTime(s.duration)),
          s.builtinKey || s.source ? null : h('span', { class: 'pill custom' }, 'CUSTOM'))),
      h('div', { class: `maps${open ? ' open' : ''}`, onclick: (e) => { e.stopPropagation(); audio.playSfx('move'); if (open) expanded.delete(s.id); else expanded.add(s.id); renderList(); } },
        h('span', {}, `${n} beatmap${n === 1 ? '' : 's'}`), h('i', {})));
    const rows = open ? h('div', { class: 'chart-rows' }, s.charts.map((c, i) => {
      const on = sel && i === chartIndex(), b = store.bestScore(s.id, c.name);
      return h('div', { class: `chart-row${on ? ' sel' : ''}`, style: on ? { background: diffColor(i, n) } : {},
        onclick: () => { if (on) play(); else { app.selectedSongId = s.id; app.selectedChart = i; audio.playSfx('move'); renderList(); renderDetail(); schedulePreview(); } } },
        h('span', { class: 'dot', style: { background: diffColor(i, n) } }), h('b', {}, c.name), h('small', {}, `Lv. ${c.level}`),
        mixedKeys(s) ? h('span', { class: 'pill' }, `${c.keys || s.keyCount}K`) : null,
        h('em', {}, b ? `${b.grade}  ${b.score}` : '—'));
    })) : null;
    return h('div', { class: `song-wrap${sel ? ' sel' : ''}` }, main, rows);
  }
  function renderList() {
    const b = songs().filter((s) => s.builtinKey), c = songs().filter((s) => !s.builtinKey);
    setKids(listEl, h('div', { class: 'section-label' }, 'Built-in'), b.map(card), h('div', { class: 'section-label' }, 'Your songs'),
      c.length ? c.map(card) : h('div', { class: 'panel', style: { padding: '18px', background: 'rgba(255,255,255,.35)', boxShadow: 'none', textAlign: 'center', color: '#fff' } },
        h('div', { style: { fontSize: '18px', fontWeight: 900 } }, 'Nothing here yet'),
        h('div', { style: { fontSize: '14px', fontWeight: 700, opacity: 0.9 } }, 'Press New Song to import a track and chart it, or remix a built-in song.')));
    const sel = listEl.querySelector('.song-card.sel'); if (sel) sel.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function density(c, s, keys) {
    const cv = h('canvas', { class: 'graph', width: 1000, height: 96 }); const g = cv.getContext('2d');
    const bins = Math.max(1, Math.floor(s.duration)), counts = Array.from({ length: bins }, () => new Array(keys).fill(0));
    for (const n of c.notes) counts[Math.min(bins - 1, Math.max(0, Math.floor(n.time)))][Math.min(n.lane, keys - 1)]++;
    const w = cv.width / bins, peak = Math.max(4, ...counts.map((r) => r.reduce((a, b) => a + b, 0)));
    counts.forEach((row, i) => { let y = cv.height; row.forEach((v, l) => { if (!v) return; const hh = (cv.height - 4) * v / peak; g.fillStyle = laneColor(l, keys); g.fillRect(i * w + 0.5, y - hh, Math.max(1, w - 1), hh); y -= hh; }); });
    return cv;
  }

  function renderDetail() {
    const s = song(); const ci = chartIndex(); const c = s.charts[ci]; const keys = chartKeys(s, ci), mixed = mixedKeys(s);
    const ms = store.modSet;
    const holds = c ? c.notes.filter(noteIsHold).length : 0, slides = c ? c.notes.reduce((a, n) => a + n.slides.length, 0) : 0;
    const diffHue = diffColor;
    const icon = fanIconCanvas(96, keys);
    setKids(detailEl, 
      h('div', { class: 'panel main' },
        h('div', { class: 'row', style: { alignItems: 'flex-start' } }, h('div', { style: { minWidth: 0 } }, h('h1', {}, s.title), h('div', { class: 'artist' }, s.artist)), h('div', { class: 'spacer' }), icon),
        c ? density(c, s, keys) : null,
        c ? h('div', { class: 'stats' }, [['NOTES', c.notes.length], ['HOLDS', holds], ['SLIDES', slides], ['LENGTH', formatTime(s.duration)], ['BPM', Math.round(s.bpm)], ['KEYS', keys]]
          .map(([k, v]) => h('div', { class: 'stat' }, h('b', {}, v), h('span', {}, k)))) : null,
        h('div', { class: `diffs${s.charts.length > 6 ? ' many' : ''}` }, s.charts.map((ch, i) => { const b = store.bestScore(s.id, ch.name);
          return h('div', { class: `diff${i === ci ? ' sel' : ''}`, style: i === ci ? { background: diffHue(i, s.charts.length) } : {}, onclick: () => { app.selectedChart = i; app.audio.playSfx('move'); renderDetail(); } },
            h('b', {}, ch.name), h('small', {}, mixed ? `${ch.keys || s.keyCount}K · Lv. ${ch.level}` : `Lv. ${ch.level}`), h('em', {}, b ? `${b.grade}  ${b.score}` : '—')); }))),
      h('div', { class: 'row' },
        h('button', { class: 'btn green big', style: { flex: 1 }, disabled: !s.charts.length, onclick: play }, '▶  PLAY'),
        h('button', { class: `btn${ms.isEmpty ? '' : ' yellow'}`, style: { width: '170px', flexDirection: 'column', gap: 0, fontSize: '18px', padding: '8px' }, onclick: openMods },
          'MODS', h('small', { style: { fontSize: '11px', opacity: 0.65 } }, ms.isEmpty ? 'none' : `${ms.label}  ×${ms.multiplier(keys).toFixed(2)}`)),
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px', alignItems: 'center' } }, h('span', { class: 'lbl', style: { color: '#fff' } }, 'AUTOPLAY'), toggle(store.settings.autoplay, (v) => store.set({ autoplay: v })))),
      h('div', { class: 'row' },
        h('button', { class: 'btn small', onclick: () => exportMadim(app, s) }, '⇧ Export'),
        s.builtinKey ? h('button', { class: 'btn small', onclick: () => remix(s) }, '✎ Remix in Editor')
          : [h('button', { class: 'btn small pink', disabled: mixed, title: mixed ? "This song mixes key counts (imported beatmap set), which the editor can't edit." : '', onclick: () => { app.editorSongId = s.id; app.go('editor'); } }, '✎ Edit Chart'), h('button', { class: 'btn small', onclick: () => del(s) }, '🗑 Delete')],
        h('div', { class: 'spacer' }), h('span', { class: 'subtitle' }, '← → difficulty   M mods')));
  }

  function openMods() { const s = song(); showMods(app, { ...s, keyCount: chartKeys(s, chartIndex()) }, () => renderDetail()); }

  function select(id) { expanded.clear(); expanded.add(id); app.selectedSongId = id; app.selectedChart = Math.min(app.selectedChart, song().charts.length - 1); app.audio.playSfx('move'); renderList(); renderDetail(); schedulePreview(); }
  function play() { const s = song(); if (!s.charts.length) return; audio.playSfx('select'); app.go('game', { song: s, chartIndex: chartIndex() }); }
  function move(d) { const i = songs().findIndex((s) => s.id === song().id); select(songs()[(i + d + songs().length) % songs().length].id); }

  async function remix(s) {
    try {
      const a = await audioBytesFor(app, s);
      const copy = { ...s, id: newCopyId(), title: s.title + ' (Remix)', builtinKey: null, audioFile: 'audio.wav', charts: s.charts.map((c) => ({ ...c, id: Math.random().toString(36).slice(2), notes: c.notes.map((n) => ({ ...n, slides: n.slides.map((x) => ({ ...x })) })), events: (c.events || []).map((e) => ({ ...e })), lessons: [] })) };
      await library.saveCustom(copy, { bytes: a.bytes, name: 'audio.wav' });
      app.editorSongId = copy.id; app.go('editor');
    } catch (e) { app.toast(e.message); }
  }
  async function del(s) {
    if (!confirm('Delete this song? The chart and its audio will be removed.')) return;
    const idx = songs().findIndex((x) => x.id === s.id);
    await library.deleteCustom(s);
    app.selectedSongId = songs()[Math.max(0, Math.min(idx - 1, songs().length - 1))].id; build(); schedulePreview();
  }

  function schedulePreview() {
    clearTimeout(previewTimer); const token = ++previewToken; const s = song();
    previewTimer = setTimeout(async () => {
      try {
        const buf = await bufferFor(audio, s);
        if (token !== previewToken || app.name !== 'songs') return;
        audio.setVolumes(store.settings.musicVolume, store.settings.sfxVolume);
        audio.playPreview(s.builtinKey ? 'b:' + s.builtinKey : 'c:' + s.id, buf, s.duration * 0.28);
      } catch (e) { /* no preview */ }
    }, 380);
  }

  build(); schedulePreview();
  return {
    onKey(e) {
      switch (e.code) {
        case 'ArrowUp': move(-1); break; case 'ArrowDown': move(1); break;
        case 'ArrowLeft': app.selectedChart = Math.max(0, chartIndex() - 1); audio.playSfx('move'); renderDetail(); break;
        case 'ArrowRight': app.selectedChart = Math.min(song().charts.length - 1, chartIndex() + 1); audio.playSfx('move'); renderDetail(); break;
        case 'Enter': case 'NumpadEnter': play(); break;
        case 'KeyM': openMods(); break;
        case 'Escape': audio.playSfx('back'); app.go('home'); break;
        default: break;
      }
    },
    destroy() { clearTimeout(previewTimer); previewToken++; audio.stopPreview(); },
  };
}
