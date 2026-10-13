// Turns songs into playable AudioBuffers (built-ins are synthesised in a worker; custom ones are decoded).
import { library } from './store.js';

let worker = null, nextId = 1; const pending = new Map();
export function getWorker() {
  if (!worker) {
    worker = new Worker('./synth.worker.js');
    worker.onmessage = (e) => { const p = pending.get(e.data.id); if (!p) return; pending.delete(e.data.id); e.data.error ? p.rej(new Error(e.data.error)) : p.res(e.data); };
  }
  return worker;
}
export function workerCall(msg, transfer = []) {
  return new Promise((res, rej) => { const id = nextId++; pending.set(id, { res, rej }); getWorker().postMessage({ ...msg, id }, transfer); });
}

const cache = new Map();   // key -> Promise<AudioBuffer>

export function bufferFor(audio, song) {
  const key = song.builtinKey ? 'b:' + song.builtinKey : 'c:' + song.id;
  if (cache.has(key)) return cache.get(key);
  const p = (async () => {
    if (song.builtinKey) {
      const { left, right } = await workerCall({ type: 'builtin', key: song.builtinKey });
      const b = audio.ctx.createBuffer(2, left.length, 44100);
      b.copyToChannel(left, 0); b.copyToChannel(right, 1);
      return b;
    }
    const rec = await library.audioFor(song);
    if (!rec || !rec.bytes) throw new Error('This song has no audio file.');
    return await audio.ctx.decodeAudioData(rec.bytes.slice(0));
  })();
  cache.set(key, p);
  p.catch(() => cache.delete(key));
  return p;
}
export const forgetBuffer = (song) => cache.delete(song.builtinKey ? 'b:' + song.builtinKey : 'c:' + song.id);
export const hasBuffer = (song) => cache.has(song.builtinKey ? 'b:' + song.builtinKey : 'c:' + song.id);
