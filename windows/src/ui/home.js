import { h, modal, key } from './dom.js';
import { drawFanIcon } from './icons.js';
import { laneColor } from '../theme.js';
import { keyLabel } from '../store.js';

const ITEMS = [
  { title: 'Play', icon: '▶', c: '#8cf58c' }, { title: 'Create', icon: '✦', c: '#e64dff' }, { title: 'Settings', icon: '⚙', c: '#66b2ff' },
  { title: 'How to Play', icon: '?', c: '#f7dc6f' }, { title: 'Quit', icon: '⏻', c: '#ff6b6b' },
];

export function mount(app, root) {
  let sel = 0;
  const rows = ITEMS.map((it, i) => h('div', { class: `menu-row${i === 0 ? ' sel' : ''}`, style: { animationDelay: `${0.1 + i * 0.08}s` },
    onmouseenter: () => { setSel(i); }, onclick: () => activate(i) },
    h('div', { class: 'ico', style: { '--c': it.c } }, it.icon), it.title, h('span', { class: 'chev' }, '›')));
  const setSel = (i) => { if (i === sel) return; sel = i; rows.forEach((r, k) => r.classList.toggle('sel', k === sel)); app.audio.playSfx('move', 0.6); };
  const logoCanvas = h('canvas', { width: 220, height: 220, style: { width: '110px', height: '110px' } });
  const lctx = logoCanvas.getContext('2d');
  let raf = 0;
  const loop = () => { lctx.clearRect(0, 0, 220, 220); drawFanIcon(lctx, 220, 220, 4, { t: performance.now() / 1000 }); raf = requestAnimationFrame(loop); };
  loop();

  const el = h('div', { class: 'screen home' }, h('div', { class: 'col' },
    h('div', { class: 'logo' }, logoCanvas, h('div', {}, h('div', { class: 'word' }, 'Mani'), h('div', { class: 'word dim2' }, 'Dim'))),
    h('div', { class: 'menu' }, rows),
    h('div', { class: 'hint' }, key('↑', { small: true }), key('↓', { small: true }), key('Enter', { small: true }), 'to navigate')));
  root.append(el);

  function activate(i) {
    app.audio.playSfx('select');
    if (i === 0) app.go('songs');
    else if (i === 1) import('./newsong.js').then((m) => m.showNewSong(app));
    else if (i === 2) app.go('settings');
    else if (i === 3) showHowTo(app);
    else window.close();
  }
  return {
    onKey(e) {
      if (e.code === 'ArrowUp') setSel((sel + ITEMS.length - 1) % ITEMS.length);
      else if (e.code === 'ArrowDown') setSel((sel + 1) % ITEMS.length);
      else if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') activate(sel);
    },
    draw(ctx, W, H, wall) { app.demo.draw(ctx, W, H, wall, 0.73); },
    destroy() { cancelAnimationFrame(raf); },
  };
}

export function showHowTo(app) {
  const keys = app.store.keys(4), s = app.store.settings;
  const card = (title, c, text, ks, extra) => h('div', { class: 'howto-card' }, h('h3', {}, h('i', { style: { '--c': c } }), title), h('p', {}, text),
    h('div', { style: { marginTop: 'auto', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } }, ks.map(([l, a]) => key(l, { c, active: a, small: true })), extra ? h('b', {}, extra) : null));
  const m = modal(app, h('div', {},
    h('div', { class: 'row' }, h('h2', {}, 'How to Play'), h('div', { class: 'spacer' }), h('button', { class: 'btn small', onclick: () => m.close() }, '✕')),
    h('div', { class: 'howto-cards' },
      card('Tap', laneColor(0, 4), 'Notes fly out of the fan toward the circle. When one touches the circle, press the key of its lane.', keys.map((k) => [keyLabel(k), false])),
      card('Hold', laneColor(1, 4), 'Long notes: press on the head and keep the key held until the tail reaches the circle.', [[keyLabel(keys[1]), true]], 'keep holding'),
      card('Slide', laneColor(2, 4), 'While holding a slide note, tap a slide key when the arrow arrives. It points the way the note moves.', [[keyLabel(keys[1]), true]], `+ ${keyLabel(s.slideLeft)} / ${keyLabel(s.slideRight)}`)),
    h('p', { style: { fontWeight: 700, opacity: 0.6, fontSize: '15px' } }, 'Keys and slide keys can be changed in Settings → Controls. Esc pauses. Timing windows: Perfect ±45 ms · Great ±90 ms · Good ±135 ms.')),
    { onClose: () => m.close() });
}
