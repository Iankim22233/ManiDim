import { renderBuiltin, encodeWav } from '../src/dsp.js';
import { ARRANGEMENTS } from '../src/songs.js';
import { analyzeAudio } from '../src/analysis.js';
for (const a of ARRANGEMENTS) {
  const t0 = performance.now();
  const { left, right } = renderBuiltin(a.key);
  let peak = 0, nan = 0; for (let i = 0; i < left.length; i += 7) { const v = Math.abs(left[i]); if (v > peak) peak = v; if (!isFinite(v)) nan++; }
  console.log(`${a.title.padEnd(22)} ${(left.length / 44100).toFixed(1)}s rendered in ${((performance.now() - t0) / 1000).toFixed(2)}s  peak ${peak.toFixed(2)} nan ${nan}`);
  if (a.key === 'neon-drive' || a.key === 'hyperloop') {
    const an = analyzeAudio([left, right], 44100);
    console.log(`   tempo analysis: ${an.bpm} BPM (expected ${a.bpm}), ${an.onsets.length} onsets`);
  }
}
