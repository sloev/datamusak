// The mapping engine: data event → normalized fields → notes on instrument slots.
import { quantize, stepInScale, DRUM_NOTES } from './scales.js';
import { DRUMS } from './audio.js';

const GRID = { off: 0, '1/4': 1, '1/8': 0.5, '1/16': 0.25, '1/32': 0.125 };
const HARMONY = {
  none: [],
  third: [2],
  fifth: [4],
  triad: [2, 4],
  octave: ['oct'],
  spread: [4, 'oct'],
};

export class Engine {
  constructor({ state, audio, midi, normalizer }) {
    this.state = state;
    this.audio = audio;
    this.midi = midi;
    this.normalizer = normalizer;
    this.listeners = [];
    this.buckets = new Map();
    this.cycle = new Map();
    this.inFlight = [];
    this.stats = new Map(); // sourceId → {events, notes, times[]}
  }

  on(fn) {
    this.listeners.push(fn);
  }

  now() {
    return this.audio.ctx ? this.audio.ctx.currentTime : performance.now() / 1000;
  }

  stat(id) {
    let s = this.stats.get(id);
    if (!s) this.stats.set(id, (s = { events: 0, notes: 0, recent: [] }));
    return s;
  }

  eventsPerMinute(id) {
    const s = this.stats.get(id);
    if (!s) return 0;
    const cutoff = performance.now() - 60000;
    while (s.recent.length && s.recent[0] < cutoff) s.recent.shift();
    return s.recent.length;
  }

  // Token bucket: allows `rate` notes/sec on average, bursts up to 2×.
  allow(id, rate) {
    const t = performance.now() / 1000;
    let b = this.buckets.get(id);
    if (!b) this.buckets.set(id, (b = { tokens: rate * 2, t }));
    b.tokens = Math.min(rate * 2, b.tokens + (t - b.t) * rate);
    b.t = t;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  param(src, cfg, values, name) {
    const m = cfg[name];
    let x = m.field === 'none' ? 0.5 : this.normalizer.value(src.id, src.allFields, values, m.field);
    if (x === null) x = 0.5;
    if (m.invert) x = 1 - x;
    return { x, value: m.lo + (m.hi - m.lo) * x };
  }

  pickSlot(src, cfg, values) {
    const slots = (cfg.slots === 'all' ? this.state.slots.map((_, i) => i) : cfg.slots).filter(
      (i) => i < this.state.slots.length,
    );
    if (!slots.length) return null;
    if (cfg.slotMode === 'random') return slots[Math.floor(Math.random() * slots.length)];
    if (cfg.slotMode === 'field') {
      const x = this.normalizer.value(src.id, src.allFields, values, cfg.slotField) ?? Math.random();
      return slots[Math.min(slots.length - 1, Math.floor(x * slots.length))];
    }
    const c = (this.cycle.get(src.id) || 0) + 1;
    this.cycle.set(src.id, c);
    return slots[c % slots.length];
  }

  when() {
    const g = this.state.global;
    const t = this.now() + 0.03;
    const grid = (GRID[g.quantize] || 0) * (60 / g.bpm);
    return grid ? Math.ceil(t / grid) * grid : t;
  }

  handle(src, ev) {
    const cfg = this.state.sources[src.id];
    const values = { ...ev.values };
    if (ev.lat != null) {
      values.lat = ev.lat;
      values.lon = ev.lon;
    }
    this.normalizer.observe(src.id, src.allFields, values);
    const st = this.stat(src.id);
    st.events++;
    st.recent.push(performance.now());

    const out = { src, ev, values, notes: [] };
    if (cfg.enabled && Math.random() <= cfg.chance && this.allow(src.id, cfg.rate)) {
      out.notes = this.makeNotes(src, cfg, values);
      st.notes += out.notes.length;
    }
    for (const fn of this.listeners) fn(out);
  }

  makeNotes(src, cfg, values) {
    const g = this.state.global;
    const now = this.now();
    this.inFlight = this.inFlight.filter((t) => t > now);
    if (this.inFlight.length >= g.maxPolyphony) return [];

    const slot = this.pickSlot(src, cfg, values);
    if (slot === null) return [];
    const s = this.state.slots[slot];
    const scale = cfg.scale === 'global' ? g.scale : cfg.scale;
    const pitch = this.param(src, cfg, values, 'pitch');
    const velocity = Math.round(this.param(src, cfg, values, 'velocity').value * cfg.level);
    const duration = this.param(src, cfg, values, 'duration').value;
    const pan = this.param(src, cfg, values, 'pan').value;
    const bright = this.param(src, cfg, values, 'bright').value;
    if (velocity < 1) return [];

    let notes;
    if (s.program === DRUMS) {
      notes = [DRUM_NOTES[Math.min(DRUM_NOTES.length - 1, Math.floor(pitch.x * DRUM_NOTES.length))]];
    } else {
      const lo = Math.round(Math.min(cfg.pitch.lo, cfg.pitch.hi));
      const hi = Math.round(Math.max(cfg.pitch.lo, cfg.pitch.hi));
      const x = cfg.pitch.lo > cfg.pitch.hi ? 1 - pitch.x : pitch.x;
      const base = quantize(x, scale, g.root, lo, hi) + 12 * s.octave;
      notes = [base];
      for (const h of HARMONY[cfg.harmony] || []) {
        notes.push(h === 'oct' ? base + 12 : stepInScale(base, h, scale, g.root));
      }
      notes = notes.filter((n) => n >= 0 && n <= 127);
    }

    const when = this.when();
    const result = [];
    for (const note of notes) {
      const n = { slot, note, velocity: Math.min(127, velocity), duration, pan, bright, when };
      if (g.internal) this.audio.play(n);
      this.midi.play(n, (when - now) * 1000);
      this.inFlight.push(when + duration);
      result.push({ ...n, delayMs: (when - now) * 1000 });
    }
    return result;
  }
}
