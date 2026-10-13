import { renderBuiltin, renderBlank } from './dsp.js';
import { analyzeAudio } from './analysis.js';

self.onmessage = (e) => {
  const { id, type } = e.data;
  try {
    if (type === 'builtin') {
      const { left, right } = renderBuiltin(e.data.key);
      self.postMessage({ id, left, right }, [left.buffer, right.buffer]);
    } else if (type === 'blank') {
      const { left, right } = renderBlank(e.data.bpm, e.data.bars);
      self.postMessage({ id, left, right }, [left.buffer, right.buffer]);
    } else if (type === 'analyze') {
      self.postMessage({ id, result: analyzeAudio(e.data.channels, e.data.sampleRate) });
    }
  } catch (err) { self.postMessage({ id, error: String(err && err.stack || err) }); }
};
