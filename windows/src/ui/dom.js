export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') { for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; } }
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
export function setKids(el, ...kids) {
  el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false).map((k) => (k.nodeType ? k : document.createTextNode(String(k)))));
  return el;
}
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
export const $ = (sel, root = document) => root.querySelector(sel);

export function key(label, { c, active = false, small = false, wide = false } = {}) {
  return h('span', { class: `key${active ? ' active' : ''}${small ? ' small' : ''}${wide ? ' wide' : ''}`, style: c ? { '--c': c } : {} }, label);
}
export function toggle(on, onChange) {
  const el = h('div', { class: `switch${on ? ' on' : ''}`, onclick: () => { on = !on; el.classList.toggle('on', on); onChange(on); } });
  return el;
}
export function slider({ min, max, step = 1, value, tint, onInput }) {
  const el = h('input', { type: 'range', min, max, step, value });
  const upd = () => el.style.setProperty('--p', `${(el.value - min) / (max - min) * 100}%`);
  if (tint) el.style.setProperty('--tint', tint);
  el.addEventListener('input', () => { upd(); onInput(Number(el.value)); });
  upd();
  return el;
}
export function toggleRow(title, sub, on, onChange) {
  return h('div', { class: 'toggle-row' }, h('div', {}, h('b', {}, title), sub ? h('small', {}, sub) : null), toggle(on, onChange));
}
export function section(title, sub, ...kids) {
  return h('div', { class: 'sec' }, h('h3', {}, title), sub ? h('p', {}, sub) : null, ...kids);
}
export function header(app, title, subtitle, onBack, ...trailing) {
  return h('div', { class: 'header' },
    h('button', { class: 'btn small', onclick: () => { app.audio.playSfx('back'); onBack(); } }, '‹ Back'),
    h('div', {}, h('div', { class: 'title' }, title), subtitle ? h('div', { class: 'subtitle' }, subtitle) : null),
    h('div', { class: 'spacer' }), ...trailing);
}
export const hsl = (h2, s = 0.62, v = 1) => {
  const f = (n) => { const k = (n + h2 * 6) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return `rgb(${Math.round(f(5) * 255)},${Math.round(f(3) * 255)},${Math.round(f(1) * 255)})`;
};
export function modal(app, content, { onClose, closeOnEsc = true } = {}) {
  const wrap = h('div', { class: 'modal', onmousedown: (e) => { if (e.target === wrap && onClose) onClose(); } }, h('div', { class: 'panel' }, content));
  document.getElementById('overlay').append(wrap);
  const prev = app.overlayKey;
  app.overlayKey = (ev) => { if (closeOnEsc && ev.code === 'Escape' && onClose) { onClose(); return true; } return true; };
  const close = () => { wrap.remove(); app.overlayKey = prev; };
  return { close, el: wrap };
}
