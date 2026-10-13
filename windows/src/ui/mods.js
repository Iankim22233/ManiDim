import { h, modal, setKids } from './dom.js';
import { CATEGORIES, MODS, ModSet, keyMultiplier } from '../mods.js';

export function showMods(app, song, onChange) {
  const origKeys = song ? song.keyCount : 4;
  const wrap = h('div', {});
  const multOf = (m) => (m.keyCount ? keyMultiplier(origKeys, m.keyCount) : m.multiplier);
  const set = () => app.store.modSet;
  const toggle = (id) => {
    const s = set(); s.toggle(id); app.store.set({ mods: s.list });
    app.audio.playSfx(s.has(id) ? 'select' : 'back', 0.7); render(); if (onChange) onChange();
  };
  function render() {
    const s = set(), total = s.multiplier(origKeys);
    setKids(wrap, 
      h('div', { class: 'row' },
        h('div', {}, h('h2', {}, 'Mods'), h('div', { style: { fontSize: '13px', fontWeight: 700, opacity: 0.5 } }, song ? `Applied to ${song.title} and every other song until you change them` : 'Applied to every song')),
        h('div', { class: 'spacer' }),
        h('div', { style: { textAlign: 'right' } }, h('div', { class: 'lbl' }, 'SCORE MULTIPLIER'),
          h('div', { class: 'mult-big', style: { color: total >= 1 ? '#d9594c' : '#33884d' } }, `×${total.toFixed(2)}`)),
        h('button', { class: 'btn small', disabled: s.isEmpty, onclick: () => { app.store.set({ mods: [] }); app.audio.playSfx('back'); render(); if (onChange) onChange(); } }, 'Reset'),
        h('button', { class: 'btn small green', onclick: () => close() }, 'Done')),
      h('div', { class: 'mods-cols' }, CATEGORIES.map((cat) => h('div', { class: 'mods-col', style: { '--c': cat.tint } },
        h('h4', {}, h('i'), h('div', {}, cat.title, h('div', { style: { fontSize: '11px', fontWeight: 700, opacity: 0.5 } }, cat.blurb))),
        h('div', { class: 'list' },
          cat.id === 'conversion' ? h('div', {}, h('div', { class: 'lbl', style: { marginBottom: '6px' } }, 'KEY COUNT — remap the chart to this many lanes'),
            h('div', { class: 'keygrid' }, MODS.filter((m) => m.keyCount).map((m) => h('button', { class: `btn small${s.has(m.id) ? '' : ''}`, style: s.has(m.id) ? { '--bg': cat.tint } : {}, onclick: () => toggle(m.id) },
              m.title, h('small', {}, m.keyCount === origKeys ? 'as is' : `×${multOf(m).toFixed(2)}`))))) : null,
          MODS.filter((m) => m.category === cat.id && !m.keyCount).map((m) => h('button', { class: `mod${s.has(m.id) ? ' on' : ''}`, style: { '--c': cat.tint + '99', '--cc': cat.tint }, onclick: () => toggle(m.id) },
            h('div', { class: 'mi' }, m.icon), h('div', {}, h('b', {}, m.title, h('span', { class: 'ac' }, m.acronym)), h('small', {}, m.blurb)),
            h('span', { class: `mult${m.multiplier < 1 ? ' low' : ''}` }, `×${multOf(m).toFixed(2)}`), h('span', { class: 'check' }, '✓'))))))),
      s.isEmpty ? null : h('div', { style: { textAlign: 'center', marginTop: '12px', fontWeight: 900, opacity: 0.6 } }, `Active: ${s.label}`));
  }
  render();
  const m = modal(app, wrap, { onClose: () => close() });
  const prevKey = app.overlayKey;
  app.overlayKey = (ev) => { if (ev.code === 'Escape' || ev.code === 'KeyM') { close(); return true; } return true; };
  function close() { m.close(); if (onChange) onChange(); }
}
