import { h, header, key, toggleRow, slider, section, modal, toggle, setKids } from './dom.js';
import { KEY_COUNTS, keyLabel, idbPut, idbDel } from '../store.js';
import { laneColor, BG_PRESETS, SKINS, themeFor, backdropSpec, hexToArr, arrToHex } from '../theme.js';
import { drawFanIcon } from './icons.js';
import { drawBackdrop } from '../renderer.js';
import { AudioEngine } from '../audio.js';

const TABS = [['controls', '⌨', 'Controls'], ['gameplay', '🎮', 'Gameplay'], ['audio', '🔊', 'Audio'], ['visuals', '🎨', 'Visuals']];

export function mount(app, root) {
  const { store, audio } = app;
  let tab = new URLSearchParams(location.search).get('tab') || 'controls', keyCount = 4, rebinding = null;
  const pressed = new Set();
  const panel = h('div', { class: 'panel settings-panel' });
  const tabsEl = h('div', { class: 'tabs' });
  const el = h('div', { class: 'screen' }, header(app, 'Settings', 'Changes are saved automatically', () => app.go('home')), h('div', { class: 'settings-body' }, tabsEl, panel));
  root.append(el);

  const sliderRow = (opts, fmtVal) => { const v = h('div', { class: 'val' }, fmtVal(opts.value)); const s = slider({ ...opts, onInput: (x) => { v.textContent = fmtVal(x); opts.onInput(x); } }); return h('div', { class: 'slider-row' }, s, v); };

  function renderTabs() { setKids(tabsEl, TABS.map(([id, ico, name]) => h('button', { class: `btn${tab === id ? ' sel' : ''}`, onclick: () => { tab = id; stopRebind(); audio.playSfx('move'); render(); } }, `${ico}  ${name}`))); }

  function startRebind(target) {
    rebinding = target; audio.playSfx('select'); render();
    app.capture = (ev) => {
      if (ev.code === 'Escape') { stopRebind(); return; }
      if (ev.repeat) return;
      if (target === 'L') store.bindSlide(true, keyCount, ev.code); else if (target === 'R') store.bindSlide(false, keyCount, ev.code); else store.bindLane(target, keyCount, ev.code);
      audio.playSfx('tap'); stopRebind();
    };
  }
  function stopRebind() { rebinding = null; app.capture = null; render(); }

  function controls() {
    const s = store.settings, keys = store.keys(keyCount);
    return [
      section('Lane keys', 'Click a key, then press the key you want. Different lane counts have their own layouts.',
        h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } }, KEY_COUNTS.map((k) => h('button', { class: `btn small${k === keyCount ? ' sel' : ''}`, onclick: () => { keyCount = k; stopRebind(); } }, `${k} key${k > 1 ? 's' : ''}`))),
        h('div', { class: 'keys-row' }, keys.map((c, i) => h('div', { class: 'keys-col' }, h('div', { style: { cursor: 'pointer' }, onclick: () => startRebind(i) }, key(rebinding === i ? '…' : keyLabel(c), { c: laneColor(i, keyCount), active: pressed.has(c) || rebinding === i, wide: true })), h('small', {}, `Lane ${i + 1}`))))),
      section('Slide keys', 'While holding a slide note, tap one of these when its arrow reaches the circle.',
        h('div', { class: 'keys-row', style: { gap: '28px' } },
          h('div', { class: 'keys-col' }, h('div', { style: { cursor: 'pointer' }, onclick: () => startRebind('L') }, key(rebinding === 'L' ? '…' : keyLabel(s.slideLeft), { c: '#66b2ff', wide: true, active: pressed.has(s.slideLeft) || rebinding === 'L' })), h('small', {}, '◀ Slide left')),
          h('div', { class: 'keys-col' }, h('div', { style: { cursor: 'pointer' }, onclick: () => startRebind('R') }, key(rebinding === 'R' ? '…' : keyLabel(s.slideRight), { c: '#66b2ff', wide: true, active: pressed.has(s.slideRight) || rebinding === 'R' })), h('small', {}, 'Slide right ▶')))),
      section('Key tester', 'Anything you press lights up here — handy for checking that your slide keys register.', h('div', { class: 'tester' }, pressed.size ? [...pressed].map(keyLabel).join('  +  ') : h('span', { class: 'dim' }, 'Press some keys…'))),
      h('div', {}, h('button', { class: 'btn small', onclick: () => { store.resetKeys(); audio.playSfx('back'); render(); } }, 'Reset keys to defaults')),
    ];
  }

  function gameplay() {
    const s = store.settings;
    return [
      section('Note speed', 'How fast notes travel from the edge of the screen to the circle.', sliderRow({ min: 3, max: 14, step: 0.5, value: s.scrollSpeed, onInput: (v) => store.set({ scrollSpeed: v }) }, (v) => Number(v).toFixed(1))),
      section('Audio offset', 'If notes feel late (you keep hitting after the beat) raise it; if early, lower it.',
        sliderRow({ min: -150, max: 250, step: 1, value: s.audioOffsetMs, tint: '#e64dff', onInput: (v) => store.set({ audioOffsetMs: v }) }, (v) => `${v >= 0 ? '+' : ''}${Math.round(v)} ms`),
        h('div', { style: { marginTop: '10px' } }, h('button', { class: 'btn small', onclick: () => { audio.playSfx('select'); calibrate(); } }, '♩ Calibrate by tapping along'))),
      section('Assist', null, toggleRow('Hit sounds', 'Play a tick for every note you hit.', s.hitSounds, (v) => store.set({ hitSounds: v })),
        toggleRow('Autoplay', 'Let the game play for you (scores aren\'t saved).', s.autoplay, (v) => store.set({ autoplay: v }))),
    ];
  }

  function audioTab() {
    const s = store.settings;
    return [
      section('Music volume', null, sliderRow({ min: 0, max: 1, step: 0.01, value: s.musicVolume, tint: '#8cf58c', onInput: (v) => store.set({ musicVolume: v }) }, (v) => `${Math.round(v * 100)}%`)),
      section('Effects volume', null, sliderRow({ min: 0, max: 1, step: 0.01, value: s.sfxVolume, tint: '#f7dc6f', onInput: (v) => store.set({ sfxVolume: v }) }, (v) => `${Math.round(v * 100)}%`),
        h('div', { class: 'row', style: { marginTop: '10px' } }, [['Tap', 'tap'], ['Hold', 'hold'], ['Slide', 'slide'], ['Miss', 'miss']].map(([n, k]) => h('button', { class: 'btn small', onclick: () => audio.playSfx(k) }, n)))),
    ];
  }

  function skinCard(sk) {
    const c = document.createElement('canvas'); c.width = 336; c.height = 216;
    const g = c.getContext('2d'); const spec = backdropSpec(store.settings.background, sk.id, false, store.bgImage);
    drawBackdrop(g, 336, 216, { x: 168, y: 130 }, 1, spec, 0.5, 0);
    g.save(); g.translate(28, 14); drawFanIcon(g, 280, 190, 4, { inverted: sk.id === 'highContrast' }); g.restore();
    return h('div', { class: `skin${store.settings.skin === sk.id ? ' sel' : ''}`, onclick: () => { store.set({ skin: sk.id }); audio.playSfx('move'); render(); } }, c, h('b', {}, sk.title), h('small', {}, sk.blurb));
  }

  function visuals() {
    const s = store.settings, bg = s.background;
    const modes = [['skin', 'Style default'], ['preset', 'Presets'], ['custom', 'Custom colours'], ['image', 'Image']];
    let bgBody = null;
    if (bg.mode === 'skin') bgBody = h('p', { style: { fontWeight: 700, opacity: 0.5, fontSize: '13px' } }, 'Each style brings its own backdrop: grey for Original, flat grey for High Contrast, black for the Classic Layout mod.');
    else if (bg.mode === 'preset') bgBody = h('div', { class: 'swatches' }, BG_PRESETS.map((p) => h('div', { class: `swatch${bg.preset === p.id ? ' sel' : ''}`, onclick: () => { store.setBackground({ preset: p.id }); audio.playSfx('move'); render(); } },
      h('i', { style: { background: `linear-gradient(${arrToHex(p.top)}, ${arrToHex(p.bottom)})` } }), p.name)));
    else if (bg.mode === 'custom') bgBody = h('div', { class: 'row', style: { gap: '22px' } },
      h('div', {}, h('label', { class: 'f' }, 'Top'), h('input', { type: 'color', value: arrToHex(bg.top), oninput: (e) => store.setBackground({ top: hexToArr(e.target.value) }) })),
      h('div', {}, h('label', { class: 'f' }, 'Bottom'), h('input', { type: 'color', value: arrToHex(bg.bottom), oninput: (e) => store.setBackground({ bottom: hexToArr(e.target.value) }) })),
      h('button', { class: 'btn small', onclick: () => { store.setBackground({ bottom: [...bg.top] }); render(); } }, 'Same colour'));
    else bgBody = h('div', { class: 'row', style: { gap: '16px', alignItems: 'flex-start' } },
      h('div', { style: { width: '160px', height: '90px', border: '3px solid #000', borderRadius: '12px', background: store.bgImage ? `center/cover url(${store.bgImage})` : '#e6e6e6', display: 'grid', placeItems: 'center', fontSize: '26px' } }, store.bgImage ? '' : '🖼'),
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px', flex: 1 } },
        h('div', { class: 'row' }, h('button', { class: 'btn small blue', onclick: pickImage }, 'Choose image…'),
          store.bgImage ? h('button', { class: 'btn small', onclick: async () => { store.bgImage = null; await idbDel('kv', 'bgImage'); store.setBackground({ hasImage: false, mode: 'skin' }); render(); } }, 'Remove') : null),
        h('div', { class: 'slider-row' }, h('b', {}, 'Dim'), sliderRow({ min: 0, max: 0.9, step: 0.01, value: bg.dim, tint: '#f7dc6f', onInput: (v) => store.setBackground({ dim: v }) }, (v) => `${Math.round(v * 100)}%`))));
    return [
      section('Style', 'Same game, different look. (The vertical Classic layout is an Easy mod — pick it under Mods.)', h('div', { class: 'skins' }, SKINS.map(skinCard))),
      section('Background', 'Pick a colour, a gradient, or your own image. It shows behind the game and the menus.',
        h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap', marginBottom: '12px' } }, modes.map(([m, n]) => h('button', { class: `btn small${bg.mode === m ? ' sel' : ''}`, onclick: () => { store.setBackground({ mode: m }); audio.playSfx('move'); render(); } }, n))), bgBody),
      section('Effects', null, toggleRow('Particles', 'Sparks and bursts on every hit.', s.particles, (v) => store.set({ particles: v })),
        toggleRow('Screen shake', 'A small jolt when you miss.', s.screenShake, (v) => store.set({ screenShake: v })),
        toggleRow('Beat pulse', 'The circle and lights breathe with the music.', s.beatPulse, (v) => store.set({ beatPulse: v })),
        toggleRow('Chart effects', 'Sparkles, flashes, fireworks and lasers placed in a chart. Turn off if flashing bothers you.', s.chartEffects, (v) => store.set({ chartEffects: v })),
        toggleRow('Show FPS', null, s.showFPS, (v) => store.set({ showFPS: v }))),
    ];
  }

  function pickImage() {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = () => {
      const f = inp.files[0]; if (!f) return;
      const r = new FileReader();
      r.onload = async () => {
        // downscale big images so they stay light
        const img = new Image();
        img.onload = async () => {
          const sc = Math.min(1, 2560 / Math.max(img.width, img.height)), c = document.createElement('canvas');
          c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          const url = c.toDataURL('image/jpeg', 0.9); store.bgImage = url; await idbPut('kv', url, 'bgImage');
          store.setBackground({ hasImage: true, mode: 'image' }); render();
        };
        img.onerror = () => app.toast('Couldn\'t use that image');
        img.src = r.result;
      };
      r.readAsDataURL(f);
    };
    inp.click();
  }

  function calibrate() {
    const total = 14, interval = 0.6; let deltas = [], start = 0, running = false, finished = false, timer = null;
    const body = h('div', { style: { textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center', width: '480px' } });
    const draw = () => {
      const med = (() => { const d = [...deltas].sort((a, b) => a - b); return d.length >= 5 ? d[Math.floor(d.length / 2)] * 1000 : null; })();
      setKids(body, h('h2', {}, 'Calibration'),
        h('p', { style: { fontWeight: 700, opacity: 0.6, margin: 0 } }, 'Tap Space (or any key) exactly on each click. Ignore the first couple while you find the rhythm.'),
        h('div', { style: { width: '130px', height: '130px', borderRadius: '50%', border: '5px solid #000', background: running ? '#f7dc6f' : '#ebebeb', display: 'grid', placeItems: 'center', fontSize: '24px', fontWeight: 900 } }, running ? `${Math.min(beat, total)}/${total}` : finished ? 'done' : 'ready'),
        finished ? (med != null ? [h('div', { style: { fontSize: '24px', fontWeight: 900 } }, `Suggested offset: ${med >= 0 ? '+' : ''}${Math.round(med)} ms`),
          h('div', { class: 'row' }, h('button', { class: 'btn green', onclick: () => { store.set({ audioOffsetMs: Math.max(-150, Math.min(250, Math.round(med))) }); audio.playSfx('select'); m.close(); render(); } }, 'Apply'), h('button', { class: 'btn', onclick: begin }, 'Try again'))]
          : [h('div', {}, 'Not enough taps — try again.'), h('button', { class: 'btn', onclick: begin }, 'Try again')]) : (!running ? h('button', { class: 'btn green', onclick: begin }, 'Start') : null),
        h('button', { class: 'btn small', onclick: () => m.close() }, 'Close'));
    };
    let beat = 0;
    function begin() {
      stop(); deltas = []; finished = false; running = true; beat = 0;
      audio.stop(); start = AudioEngine.perfNow() + 0.8;
      for (let i = 0; i < total; i++) audio.scheduleSfx('metronome', start + i * interval, 1.2);
      app.capture = (ev) => { if (ev.repeat) return; const t = ev.timeStamp / 1000 - start, i = Math.round(t / interval), d = t - i * interval; if (i >= 2 && i < total && Math.abs(d) < 0.25) deltas.push(d); };
      timer = setInterval(() => { const t = AudioEngine.perfNow() - start; beat = Math.max(0, Math.floor(t / interval) + 1); if (t > total * interval) { stop(); finished = true; } draw(); }, 100);
      draw();
    }
    function stop() { clearInterval(timer); timer = null; running = false; app.capture = null; }
    const m = modal(app, body, { onClose: () => { stop(); m.close(); } });
    draw();
    const close = m.close; m.close = () => { stop(); close(); };
  }

  function render() {
    renderTabs();
    setKids(panel, ...({ controls, gameplay, audio: audioTab, visuals }[tab])());
  }
  render();
  return {
    onKey(e) { if (!pressed.has(e.code)) { pressed.add(e.code); if (tab === 'controls' && !rebinding) render(); } if (e.code === 'Escape' && !rebinding && tab !== 'controls') app.go('home'); else if (e.code === 'Escape' && tab === 'controls' && !rebinding) app.go('home'); },
    onKeyUp(e) { pressed.delete(e.code); if (tab === 'controls' && !rebinding) render(); },
    destroy() { app.capture = null; },
  };
}
