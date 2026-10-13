import { h, key, setKids } from './dom.js';
import { GameSession } from '../session.js';
import { drawGame } from '../renderer.js';
import { AudioEngine } from '../audio.js';

export function mount(app, root, params) {
  const { song, chartIndex, startTime = 0, fromEditor = false } = params;
  const session = new GameSession(app, song, chartIndex, { startTime, fromEditor });
  app.session = session;
  const ui = h('div', { class: 'game-ui' });
  root.append(ui);
  let introShown = true;
  setTimeout(() => { introShown = false; renderOverlay(); }, 3600);

  session.onFinish = (r) => { app.result = r; setTimeout(() => app.go('results'), 150); };
  session.onQuit = () => { app.session = null; app.go(fromEditor ? 'editor' : 'songs'); };
  session.onRestart = () => { app.session = null; app.go('game', params); };
  session.onPhase = () => renderOverlay();

  function renderOverlay() {
    const ph = session.phase;
    let content = null;
    if (ph === 'loading') content = h('div', { class: 'loading' }, h('div', { class: 'spin' }), `Preparing ${song.title}…`);
    else if (ph === 'failed') content = h('div', { class: 'panel pause' }, h('h1', {}, 'Can\'t play this song'), h('p', {}, session.errorText), h('button', { class: 'btn', onclick: () => session.quit() }, 'Back'));
    else if (ph === 'countdown') content = h('div', { class: 'countdown' }, String(Math.max(1, session.countdown)));
    else if (ph === 'paused') {
      content = h('div', { class: 'modal', style: { position: 'absolute' } }, h('div', { class: 'panel pause' }, h('h1', {}, 'PAUSED'),
        ['Resume', 'Restart', 'Quit to Songs'].map((t, i) => h('div', {}, h('button', { class: `btn${i === 0 ? ' green' : ''}${session.pauseIndex === i ? ' cur' : ''}`, onclick: () => [() => session.resume(), () => session.restart(), () => session.quit()][i]() }, t))),
        h('div', { style: { fontSize: '13px', opacity: 0.45, marginTop: '10px' } }, '↑ ↓  Enter  ·  Esc to resume')));
    } else if (ph === 'running') {
      const L = session.activeLesson;
      if (L) {
        content = h('div', { class: 'panel lesson', style: { position: 'absolute' } }, h('div', { class: 'eyebrow' }, `LESSON ${session.lessonNumber} OF ${session.lessonTotal}`), h('h2', {}, L.title), h('p', {}, session.lessonText(L)),
          h('div', { class: 'press' }, 'Press', session.lessonKeyLabels(L).map((k) => key(k, { c: '#66b2ff', wide: k.length > 3 })), 'to continue', h('span', { class: 'spacer' }), h('small', { style: { opacity: 0.4 } }, 'Space also works')));
      } else if (introShown) content = h('div', { class: 'intro' }, h('h1', {}, song.title), h('p', {}, `${song.artist}  ·  ${session.chart.name}  ·  Lv.${session.chart.level}`));
    }
    setKids(ui, ...(content ? [content] : []));
  }
  renderOverlay();
  session.prepare().then(renderOverlay);

  return {
    draw(ctx, W, H, wall) {
      const s = session, st = app.store;
      drawGame(ctx, W, H, { engine: s.engine, fx: s.fx, time: s.time(wall), wall, settings: s.settings, bpm: s.song.bpm, offset: s.song.offset, hue: s.song.hue,
        title: s.song.title, artist: s.song.artist, chartName: s.chart.name, duration: s.song.duration, keyLabels: s.keyLabels, events: s.chart.events || [],
        classic: s.mods.classic, visibility: s.mods.visibility, scoreMult: s.scoreMultiplier, modLabel: s.mods.label, showHUD: true, ambient: false, bgImage: st.bgImage });
    },
    onKey(e) { session.onKeyDown(e); },
    onKeyUp(e) { session.onKeyUp(e); },
    destroy() { session.shutdown(); if (app.session === session) app.session = null; },
  };
}
