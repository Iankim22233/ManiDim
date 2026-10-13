import { h } from './dom.js';
import { J, J_TITLE, J_COLOR } from '../model.js';

const GRADE_COLOR = { SS: '#ffd633', S: '#ffb340', A: '#73e680', B: '#73b8ff', C: '#cc8cff', D: '#b3b3b3', F: '#b3b3b3' };

export function mount(app, root) {
  const r = app.result;
  const hist = h('canvas', { width: 1000, height: 70, style: { width: '100%', height: '70px' } });
  const g = hist.getContext('2d');
  const mean = r.offsets.length ? r.offsets.reduce((a, b) => a + b, 0) / r.offsets.length * 1000 : 0;
  const scoreEl = h('div', { class: 'bigscore' }, '0000000'), accEl = h('b', { style: { fontSize: '36px' } }, '0.00%'), comboEl = h('b', { style: { fontSize: '36px' } }, '0');
  const fills = J_TITLE.map((t, j) => h('div', { class: 'fill', style: { width: '0%', background: J_COLOR[j] } }));

  const el = h('div', { class: 'screen results' }, h('div', { class: 'top' },
    h('div', { class: 'panel grade-card' }, h('small', {}, 'RESULT'), h('div', { class: 'grade', style: { color: GRADE_COLOR[r.grade] } }, r.grade),
      r.failed ? h('span', { class: 'badge', style: { background: '#ff7373' } }, 'FAILED') : r.allPerfect ? h('span', { class: 'badge', style: { background: '#ffd633' } }, 'ALL PERFECT') : r.fullCombo ? h('span', { class: 'badge', style: { background: '#80e699' } }, 'FULL COMBO') : null),
    h('div', { class: 'res-main' },
      h('div', { class: 'panel' },
        h('div', { class: 'row', style: { alignItems: 'flex-start' } }, h('div', {}, h('div', { style: { fontSize: '34px', fontWeight: 900 } }, r.songTitle), h('div', { style: { fontWeight: 800, opacity: 0.55 } }, `${r.artist}  ·  ${r.chartName}  ·  Lv.${r.chartLevel}`)),
          h('div', { class: 'spacer' }), r.newBest ? h('div', { class: 'newbest' }, 'NEW BEST') : null, r.autoplay ? h('div', { class: 'pill' }, 'AUTOPLAY') : null),
        r.failed ? h('div', { style: { color: '#d94040', fontWeight: 800, marginTop: '8px' } }, r.failReason) : null,
        r.modLabel ? h('div', { style: { fontWeight: 800, opacity: 0.55, fontSize: '14px', marginTop: '8px' } }, `Mods  ${r.modLabel}   ×${r.multiplier.toFixed(2)}   ·   base score ${r.baseScore}`) : null,
        h('div', { class: 'row', style: { alignItems: 'flex-end', gap: '30px', marginTop: '10px' } }, h('div', {}, h('div', { class: 'lbl' }, 'SCORE'), scoreEl), h('div', {}, h('div', { class: 'lbl' }, 'ACCURACY'), accEl), h('div', {}, h('div', { class: 'lbl' }, 'MAX COMBO'), comboEl)),
        h('div', { style: { marginTop: '12px' } }, J_TITLE.map((t, j) => h('div', { class: 'jbar' }, h('span', {}, t), h('div', { class: 'track' }, fills[j]), h('span', {}, r.counts[j]))))),
      h('div', { class: 'panel', style: { padding: '14px 22px' } }, h('div', { class: 'row' }, h('span', { class: 'lbl' }, 'TIMING'), h('div', { class: 'spacer' }),
        r.offsets.length ? h('span', { style: { fontSize: '13px', fontWeight: 800, opacity: 0.55 } }, `average ${mean >= 0 ? '+' : ''}${mean.toFixed(0)} ms  (${Math.abs(mean) < 4 ? 'on time' : mean < 0 ? 'early' : 'late'})`) : null), hist))),
  h('div', { class: 'row', style: { marginTop: '26px' } },
    h('button', { class: 'btn green', onclick: retry }, '↺ Retry'),
    h('button', { class: 'btn', onclick: () => app.go(r.fromEditor ? 'editor' : 'songs') }, r.fromEditor ? 'Back to Editor' : '☰ Songs'),
    h('button', { class: 'btn', onclick: () => app.go('home') }, '⌂ Home')));
  root.append(el);
  app.audio.playSfx('go');

  function retry() {
    const song = app.library.get(r.songId); if (!song) return app.go('songs');
    const idx = Math.max(0, song.charts.findIndex((c) => c.name === r.chartName));
    app.go('game', { song, chartIndex: idx, fromEditor: r.fromEditor });
  }
  // count-up animation
  const t0 = performance.now(); let raf = 0;
  const tick = () => {
    const p = Math.min(1, Math.max(0, (performance.now() - t0 - 300) / 1400)), e = 1 - Math.pow(1 - p, 3);
    scoreEl.textContent = String(Math.round(r.score * e)).padStart(7, '0'); accEl.textContent = `${(r.accuracy * 100 * e).toFixed(2)}%`; comboEl.textContent = String(Math.round(r.maxCombo * e));
    fills.forEach((f, j) => { f.style.width = `${Math.max(r.counts[j] ? 1 : 0, 100 * r.counts[j] / Math.max(1, r.totalObjects) * e)}%`; });
    drawHist(e); if (p < 1) raf = requestAnimationFrame(tick);
  };
  function drawHist(prog) {
    g.clearRect(0, 0, 1000, 70);
    const bins = 41, counts = new Array(bins).fill(0);
    for (const o of r.offsets) counts[Math.round((Math.min(0.15, Math.max(-0.15, o)) + 0.15) / 0.3 * (bins - 1))]++;
    const peak = Math.max(1, ...counts), w = 1000 / bins;
    counts.forEach((c, i) => { const ms = i / (bins - 1) * 0.3 - 0.15, hh = (70 - 6) * c / peak * prog; g.fillStyle = Math.abs(ms) <= 0.045 ? J_COLOR[J.PERFECT] : Math.abs(ms) <= 0.09 ? J_COLOR[J.GREAT] : J_COLOR[J.GOOD];
      g.beginPath(); g.roundRect(i * w + 2, 67 - hh, w - 4, Math.max(c ? 3 : 0, hh), 3); g.fill(); g.strokeStyle = '#000'; g.lineWidth = 2; g.stroke(); });
    g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(498, 0, 4, 70);
  }
  tick();
  return {
    onKey(e) { if (e.code === 'Enter' || e.code === 'KeyR') retry(); else if (e.code === 'Escape') app.go(r.fromEditor ? 'editor' : 'songs'); },
    destroy() { cancelAnimationFrame(raf); },
  };
}
