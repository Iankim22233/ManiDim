// Pure game logic: judgments, holds, slides, anti-mash, scoring. Time is song time (seconds).
import { J, J_WEIGHT, noteIsHold, noteEnd, laneAt, finalLane, objectCount } from './model.js';

export class GameEngine {
  constructor(chart, laneCount, startTime = 0, windowScale = 1) {
    this.laneCount = laneCount;
    this.windowScale = windowScale;
    this.mashWindow = 0.05;
    this.grace = 0.03;
    this.bot = false;
    this.onEvent = null;

    let list = chart.notes
      .filter((n) => n.time >= startTime - 0.001 && n.lane >= 0 && n.lane < laneCount)
      .sort((a, b) => a.time - b.time || a.lane - b.lane)
      .map((n) => ({ ...n, slides: n.slides.slice().sort((a, b) => a.time - b.time) }));
    for (const n of list) n.slides = n.slides.filter((s) => s.time > n.time && s.time < noteEnd(n));

    this.notes = list.map((n) => ({ note: n, state: 'waiting', headJudgment: null, nextSlide: 0, changedAt: -100, holdKey: n.lane }));
    this.laneQueues = Array.from({ length: laneCount }, () => []);
    this.notes.forEach((rn, i) => this.laneQueues[rn.note.lane].push(i));
    this.laneCursor = new Array(laneCount).fill(0);
    this.keyDown = new Array(laneCount).fill(false);
    this.holding = [];
    this.counts = [0, 0, 0, 0];
    this.earned = 0; this.judged = 0; this.combo = 0; this.maxCombo = 0;
    this.offsets = [];
    this.totalObjects = list.reduce((a, n) => a + (noteIsHold(n) ? 2 + n.slides.length : 1), 0);
    this.lastTime = list.reduce((m, n) => Math.max(m, noteEnd(n)), 0);
    this.botCursor = 0; this.botReleases = [];
    this.recentPresses = []; this.burstDue = 0;
  }

  get hitWindow() { return 0.135 * this.windowScale; }
  get slideWindow() { return 0.16 * this.windowScale; }
  get score() { return Math.round(1000000 * this.earned / Math.max(1, this.totalObjects)); }
  get accuracy() { return this.judged === 0 ? 1 : this.earned / this.judged; }
  get isFinished() { return !this.notes.some((n) => n.state === 'waiting' || n.state === 'holding'); }
  emit(e) { if (this.onEvent) this.onEvent(e); }

  judge(dt, w = [0.045, 0.09, 0.135]) {
    const d = Math.abs(dt) / this.windowScale;
    if (d <= w[0]) return J.PERFECT;
    if (d <= w[1]) return J.GREAT;
    return J.GOOD;
  }

  account(j) {
    this.counts[j]++;
    this.earned += J_WEIGHT[j];
    this.judged++;
    if (j === J.MISS) this.combo = 0; else { this.combo++; this.maxCombo = Math.max(this.maxCombo, this.combo); }
  }

  nextWaiting(lane) {
    let c = this.laneCursor[lane];
    const q = this.laneQueues[lane];
    while (c < q.length && this.notes[q[c]].state !== 'waiting') c++;
    this.laneCursor[lane] = c;
    return c < q.length ? q[c] : null;
  }

  press(lane, t, pendingDown = 0) {
    if (lane < 0 || lane >= this.laneCount) return;
    this.keyDown[lane] = true;
    this.emit({ type: 'keyDown', lane });

    // Anti-mash: more keys than notes due (and more than 2) is a miss, not a hit.
    this.recentPresses = this.recentPresses.filter((p) => Math.abs(t - p) <= this.mashWindow);
    if (this.recentPresses.length === 0) this.burstDue = 0;
    this.recentPresses.push(t);
    let due = 0;
    for (let l = 0; l < this.laneCount; l++) {
      const i = this.nextWaiting(l);
      if (i !== null && Math.abs(this.notes[i].note.time - t) <= 0.08) due++;
    }
    this.burstDue = Math.max(this.burstDue, due);
    if (this.recentPresses.length + pendingDown > Math.max(2, this.burstDue)) {
      const idx = this.nextWaiting(lane);
      if (idx !== null && Math.abs(t - this.notes[idx].note.time) <= this.hitWindow + this.grace) {
        this.missHead(idx, t);
        this.emit({ type: 'mash', lane });
      }
      return;
    }

    const idx = this.nextWaiting(lane);
    if (idx === null) return;
    const rn = this.notes[idx];
    const dt = t - rn.note.time;
    if (dt < -this.hitWindow || dt > this.hitWindow) return;
    const j = this.judge(dt);
    this.account(j);
    this.offsets.push(dt);
    rn.headJudgment = j;
    rn.changedAt = t;
    if (noteIsHold(rn.note)) {
      rn.state = 'holding'; rn.holdKey = lane;
      this.holding.push(idx);
      this.emit({ type: 'hit', lane, judgment: j, offset: dt, kind: 'holdHead' });
      this.emit({ type: 'holdBegin', lane });
    } else {
      rn.state = 'done';
      this.emit({ type: 'hit', lane, judgment: j, offset: dt, kind: 'tap' });
    }
  }

  release(lane, t) {
    if (lane < 0 || lane >= this.laneCount) return;
    if (this.keyDown[lane]) this.emit({ type: 'keyUp', lane });
    this.keyDown[lane] = false;
    for (const idx of [...this.holding]) {
      const rn = this.notes[idx];
      if (rn.holdKey !== lane) continue;
      if (t >= noteEnd(rn.note) - 0.12) this.completeHold(idx, t); else this.dropHold(idx, t);
    }
  }

  slide(dir, t) {
    let best = null;
    for (const idx of this.holding) {
      const rn = this.notes[idx];
      if (rn.nextSlide >= rn.note.slides.length) continue;
      const s = rn.note.slides[rn.nextSlide];
      if (s.dir !== dir) continue;
      const dt = t - s.time;
      if (Math.abs(dt) > this.slideWindow) continue;
      if (!best || Math.abs(dt) < Math.abs(best.dt)) best = { idx, dt };
    }
    if (!best) return;
    const rn = this.notes[best.idx];
    const s = rn.note.slides[rn.nextSlide];
    const j = this.judge(best.dt, [0.07, 0.115, 0.16]);
    this.account(j);
    this.offsets.push(best.dt);
    rn.nextSlide++;
    const from = laneAt(rn.note, s.time - 1e-6, this.laneCount);
    const to = laneAt(rn.note, s.time, this.laneCount);
    this.emit({ type: 'slide', from, to, judgment: j });
    this.emit({ type: 'hit', lane: to, judgment: j, offset: best.dt, kind: 'slide' });
  }

  update(now) {
    if (this.bot) this.runBot(now);
    for (let lane = 0; lane < this.laneCount; lane++) {
      for (;;) {
        const idx = this.nextWaiting(lane);
        if (idx === null) break;
        if (now - this.notes[idx].note.time > this.hitWindow + this.grace) this.missHead(idx, now); else break;
      }
    }
    for (const idx of [...this.holding]) {
      const rn = this.notes[idx];
      while (rn.nextSlide < rn.note.slides.length && now - rn.note.slides[rn.nextSlide].time > this.slideWindow + this.grace) {
        const s = rn.note.slides[rn.nextSlide];
        rn.nextSlide++;
        this.account(J.MISS);
        this.emit({ type: 'miss', lane: laneAt(rn.note, s.time, this.laneCount), kind: 'slide' });
      }
      if (now >= noteEnd(rn.note)) this.completeHold(idx, now);
    }
  }

  missHead(idx, now) {
    const rn = this.notes[idx];
    rn.state = 'missed'; rn.changedAt = now;
    this.account(J.MISS);
    this.emit({ type: 'miss', lane: rn.note.lane, kind: noteIsHold(rn.note) ? 'holdHead' : 'tap' });
    if (noteIsHold(rn.note)) for (let k = 0; k < 1 + rn.note.slides.length; k++) this.account(J.MISS);
  }

  completeHold(idx, t) {
    const rn = this.notes[idx];
    if (rn.state !== 'holding') return;
    rn.state = 'done'; rn.changedAt = t;
    this.holding = this.holding.filter((i) => i !== idx);
    while (rn.nextSlide < rn.note.slides.length) { rn.nextSlide++; this.account(J.MISS); }
    this.account(J.PERFECT);
    const lane = finalLane(rn.note, this.laneCount);
    this.emit({ type: 'hit', lane, judgment: J.PERFECT, offset: 0, kind: 'holdTail' });
    this.emit({ type: 'holdEnd', lane, success: true });
  }

  dropHold(idx, t) {
    const rn = this.notes[idx];
    if (rn.state !== 'holding') return;
    rn.state = 'dropped'; rn.changedAt = t;
    this.holding = this.holding.filter((i) => i !== idx);
    this.account(J.MISS);
    while (rn.nextSlide < rn.note.slides.length) { rn.nextSlide++; this.account(J.MISS); }
    const lane = laneAt(rn.note, t, this.laneCount);
    this.emit({ type: 'miss', lane, kind: 'holdTail' });
    this.emit({ type: 'holdEnd', lane, success: false });
  }

  runBot(now) {
    while (this.botCursor < this.notes.length && this.notes[this.botCursor].note.time <= now) {
      const rn = this.notes[this.botCursor++];
      if (rn.state !== 'waiting') continue;
      this.press(rn.note.lane, rn.note.time, 0);
      this.botReleases.push({ lane: rn.note.lane, time: noteIsHold(rn.note) ? noteEnd(rn.note) : rn.note.time + 0.07 });
    }
    for (const idx of this.holding) {
      const rn = this.notes[idx];
      while (rn.nextSlide < rn.note.slides.length && rn.note.slides[rn.nextSlide].time <= now) {
        const s = rn.note.slides[rn.nextSlide];
        const before = rn.nextSlide;
        this.slide(s.dir, s.time);
        if (rn.nextSlide === before) rn.nextSlide++;
      }
    }
    const remaining = [];
    for (const r of this.botReleases) { if (r.time <= now) this.release(r.lane, r.time); else remaining.push(r); }
    this.botReleases = remaining;
  }
}
