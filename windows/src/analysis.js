// Tempo + onset detection and auto-charting (port of the native version).
import { RNG, clamp } from './util.js';
import { newNote, segments, noteIsHold } from './model.js';

export function analyzeAudio(channels, sr) {
  const hop = 512, hopSec = hop / sr;
  const total = channels[0].length;
  const a1 = 1 - Math.exp(-2 * Math.PI * 200 / sr), a2 = 1 - Math.exp(-2 * Math.PI * 2200 / sr);
  let lp1 = 0, lp2 = 0;
  const eLow = [], eMid = [], eHigh = [];
  let accL = 0, accM = 0, accH = 0, count = 0;
  const chs = channels.length;
  for (let i = 0; i < total; i++) {
    let x = 0;
    for (let c = 0; c < chs; c++) x += channels[c][i];
    x /= chs;
    lp1 += a1 * (x - lp1); lp2 += a2 * (x - lp2);
    const low = lp1, mid = lp2 - lp1, high = x - lp2;
    accL += low * low; accM += mid * mid; accH += high * high;
    if (++count === hop) { eLow.push(accL / hop); eMid.push(accM / hop); eHigh.push(accH / hop); accL = accM = accH = 0; count = 0; }
  }
  const frames = eLow.length;
  if (frames < 32) throw new Error('audio too short to analyse');
  const flux = (e, gain) => {
    const out = new Float32Array(e.length); let prevAvg = 0;
    for (let i = 0; i < e.length; i++) {
      const c = Math.log(1 + gain * e[i]);
      if (i > 0) out[i] = Math.max(0, c - prevAvg);
      prevAvg = i === 0 ? c : 0.5 * prevAvg + 0.5 * c;
    }
    return out;
  };
  const fLow = flux(eLow, 4000), fMid = flux(eMid, 8000), fHigh = flux(eHigh, 20000);
  const f = new Float32Array(frames);
  for (let i = 0; i < frames; i++) f[i] = fLow[i] + fMid[i] + fHigh[i] * 0.8;

  const w = Math.floor(0.5 / hopSec);
  const prefix = new Float64Array(frames + 1), prefix2 = new Float64Array(frames + 1);
  for (let i = 0; i < frames; i++) { prefix[i + 1] = prefix[i] + f[i]; prefix2[i + 1] = prefix2[i] + f[i] * f[i]; }
  const onsets = [];
  let lastIdx = -100;
  const minSpacing = Math.floor(0.05 / hopSec);
  for (let i = 2; i < frames - 2; i++) {
    const v = f[i];
    if (!(v > f[i - 1] && v >= f[i + 1] && v > f[i - 2] && v >= f[i + 2])) continue;
    const lo = Math.max(0, i - w), hi = Math.min(frames, i + w), n = hi - lo;
    const mean = (prefix[hi] - prefix[lo]) / n;
    const varc = Math.max(0, (prefix2[hi] - prefix2[lo]) / n - mean * mean);
    if (!(v > mean + 0.9 * Math.sqrt(varc) + 0.02)) continue;
    if (i - lastIdx < minSpacing) { const l = onsets[onsets.length - 1]; if (l && v > l.strength) onsets.pop(); else continue; }
    const tot = Math.max(1e-6, fLow[i] + fMid[i] + fHigh[i]);
    onsets.push({ time: i * hopSec + hopSec / 2, strength: v, low: fLow[i] / tot, mid: fMid[i] / tot, high: fHigh[i] / tot });
    lastIdx = i;
  }

  const interp = (idx) => { const i = Math.floor(idx); if (i < 0 || i + 1 >= frames) return 0; const fr = idx - i; return f[i] * (1 - fr) + f[i + 1] * fr; };
  const rawScore = (bpm) => {
    const lag = 60 / bpm / hopSec; let s = 0;
    for (let i = 0; i + 2 * lag < frames; i++) s += interp(i) * (interp(i + lag) + 0.5 * interp(i + 2 * lag));
    return s;
  };
  let bestBPM = 120, bestScore = -1;
  for (let bpm = 70; bpm <= 190; bpm += 0.5) {
    let s = rawScore(bpm);
    const prior = Math.exp(-Math.pow(Math.log2(bpm / 120), 2) / 0.8);
    s *= 0.6 + 0.4 * prior;
    if (s > bestScore) { bestScore = s; bestBPM = bpm; }
  }
  const base = rawScore(bestBPM);
  for (const ratio of [1.5, 4 / 3]) {
    if (bestBPM * ratio <= 185 && rawScore(bestBPM * ratio) > 0.5 * base) { bestBPM *= ratio; break; }
  }
  let refined = bestBPM, refinedScore = -1;
  for (let b = bestBPM - 0.6; b <= bestBPM + 0.6; b += 0.1) { const s = rawScore(b); if (s > refinedScore) { refinedScore = s; refined = b; } }
  const period = 60 / refined / hopSec;
  let bestPhase = 0, bestPS = -1;
  for (let ph = 0; ph < period; ph += 0.5) {
    let s = 0;
    for (let k = ph; k < frames - 1; k += period) s += interp(k);
    if (s > bestPS) { bestPS = s; bestPhase = ph; }
  }
  return { bpm: Math.round(refined * 10) / 10, offset: bestPhase * hopSec, onsets, duration: total / sr };
}

export function buildAutoNotes(an, n, diff, seed = 1) {
  const rng = new RNG(seed);
  const minGap = [0.32, 0.19, 0.115][diff], keepFrac = [0.40, 0.70, 1.0][diff];
  const spb = 60 / an.bpm;
  const sorted = [...an.onsets].sort((a, b) => b.strength - a.strength);
  const cutoff = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * keepFrac))].strength : 0;
  const onsets = an.onsets.filter((o) => o.strength >= cutoff || diff === 2).sort((a, b) => a.time - b.time);
  const notes = [], busy = [];
  const free = (lane, from, to, pad = 0.09) => !busy.some((b) => b.lane === lane && b.from < to + pad && b.to > from - pad);
  const add = (note) => {
    const segs = segments(note, n);
    for (const s of segs) if (!free(s.lane, s.from, s.to)) return false;
    notes.push(note); for (const s of segs) busy.push({ lane: s.lane, from: s.from, to: s.to });
    return true;
  };
  let last = -10, sweep = Math.floor(n / 2), sweepDir = 1, prevLane = -1, outerAlt = 0;
  onsets.forEach((o, i) => {
    let t = o.time;
    const grid = spb / 4, snapped = an.offset + Math.round((t - an.offset) / grid) * grid;
    if (Math.abs(snapped - t) < 0.04) t = snapped;
    if (t - last < minGap) return;
    let lane;
    if (o.low > 0.5) { lane = outerAlt % 2 === 0 ? 0 : n - 1; outerAlt++; }
    else if (o.high > 0.5 && n > 2) lane = rng.int(1, n - 2);
    else { sweep += sweepDir; if (sweep >= n - 1) { sweep = n - 1; sweepDir = -1; } if (sweep <= 0) { sweep = 0; sweepDir = 1; } lane = sweep; }
    if (lane === prevLane && t - last < 0.35) lane = (lane + 1 + rng.int(0, Math.max(0, n - 2))) % n;
    const note = newNote(t, lane);
    const nextT = i + 1 < onsets.length ? onsets[i + 1].time : t + 2;
    const gap = nextT - t;
    const wantHold = (gap >= 0.75 && diff !== 0) ? rng.chance(0.55) : (gap >= 1.0 && rng.chance(0.4));
    if (wantHold) {
      let dur = Math.min(gap - 0.18, 2.6);
      dur = Math.max(0.3, Math.floor(dur / (spb / 2)) * (spb / 2));
      if (dur >= 0.4) {
        note.duration = dur;
        if (diff !== 0 && dur >= 1.0 && rng.chance(0.5)) {
          let dir = lane < n / 2 ? 1 : -1;
          if (lane === 0) dir = 1; else if (lane === n - 1) dir = -1;
          note.slides = [{ time: t + dur / 2, dir }];
        }
      }
    }
    if (add(note)) {
      last = t; prevLane = lane;
      if (diff === 2 && o.strength > (sorted[0]?.strength ?? 0) * 0.55 && rng.chance(0.35) && !noteIsHold(note)) {
        const mirror = n - 1 - lane; if (mirror !== lane) add(newNote(t, mirror));
      }
    }
  });
  return notes.sort((a, b) => a.time - b.time || a.lane - b.lane);
}
