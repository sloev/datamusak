// The engine: data event → deterministic notes on General MIDI instruments.
import { scaleNotes, DRUM_NOTES } from './scales.js';
import { poolFor, familyOf, DRUMS } from './instruments.js';
import { hash32, unit, stepIndex, fold, LENGTHS, REGISTERS } from './mapping.js';

const GRID = { off: 0, '1/4': 1, '1/8': 0.5, '1/16': 0.25, '1/32': 0.125 };

// Busy sources (hundreds of events a minute) used to stutter: notes were scheduled only 30 ms
// ahead (any main-thread hiccup made them late), piled onto the same grid step, and one source
// could take every voice. These keep the output steady:
export const LIMITS = {
  lookahead: 0.12, // s between "now" and the earliest note: room for the main thread to be busy
  voices: 48, // notes sounding at once, all sources
  perSource: 10, // … per source
  perSlot: 4, // notes starting on the same grid step (or within `slot` s when not quantized)
  perSlotPerSource: 2,
  slot: 0.04,
  spill: 3, // a full step pushes a note up to this many steps later, then drops it
  quietEvery: 0.125, // events that don't play reach the map/log at most every 125 ms per source
};

export class Engine {
  constructor({ state, audio, midi }) {
    this.state = state;
    this.audio = audio;
    this.midi = midi;
    this.listeners = [];
    this.buckets = new Map();
    this.inFlight = []; // { source, end }
    this.slots = new Map(); // step start (ms) → { all, [source]: n }
    this.stats = new Map(); // source → events per second, last 60 s
    this.lastQuiet = new Map();
    this.limits = { ...LIMITS };
  }

  on(fn) {
    this.listeners.push(fn);
  }

  now() {
    return this.audio.ctx ? this.audio.ctx.currentTime : performance.now() / 1000;
  }

  // A ring of 60 one-second counters per source: O(1) per event even at thousands a minute.
  count(id) {
    const sec = Math.floor(performance.now() / 1000);
    let s = this.stats.get(id);
    if (!s) this.stats.set(id, (s = { counts: new Uint32Array(60), sec }));
    this.advance(s, sec);
    s.counts[sec % 60]++;
  }
  advance(s, sec) {
    for (let t = Math.min(sec, s.sec + 60); t > s.sec; t--) s.counts[t % 60] = 0;
    s.sec = Math.max(s.sec, sec);
  }
  eventsPerMinute(id) {
    const s = this.stats.get(id);
    if (!s) return 0;
    this.advance(s, Math.floor(performance.now() / 1000));
    return s.counts.reduce((a, b) => a + b, 0);
  }

  // Token bucket: `rate` notes/s on average, bursts up to 2×.
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

  // The first free step for this source's note, or null when the next few are all full.
  when(sourceId) {
    const g = this.state.global;
    const L = this.limits;
    const t = this.now() + L.lookahead;
    const grid = (GRID[g.quantize] || 0) * (60 / g.bpm);
    const step = grid || L.slot;
    const first = grid ? Math.ceil(t / grid) * grid : t;
    for (let i = 0; i <= L.spill; i++) {
      const when = first + i * step;
      const key = Math.round((grid ? when : Math.floor(when / step) * step) * 1000);
      let slot = this.slots.get(key);
      if (!slot) this.slots.set(key, (slot = { all: 0 }));
      if (slot.all >= L.perSlot || (slot[sourceId] || 0) >= L.perSlotPerSource) continue;
      slot.all++;
      slot[sourceId] = (slot[sourceId] || 0) + 1;
      return when;
    }
    return null;
  }

  handle(src, ev) {
    const cfg = this.state.sources[src.id];
    const values = { ...ev.values };
    if (ev.lat != null) {
      values.lat = ev.lat;
      values.lon = ev.lon;
    }
    this.count(src.id);

    const out = { src, ev, values, notes: [] };
    if (cfg.enabled && this.allow(src.id, cfg.rate)) {
      const n = this.voice(src, cfg, ev, values);
      if (n) out.notes = this.play(n);
    }
    // the map and the log get every played note but only a sample of the rest, so a firehose
    // of events can't keep the main thread (and with it the audio scheduling) busy
    if (!out.notes.length) {
      const t = performance.now() / 1000;
      if (t - (this.lastQuiet.get(src.id) || 0) < this.limits.quietEvery) return;
      this.lastQuiet.set(src.id, t);
    }
    for (const fn of this.listeners) fn(out);
  }

  // Pure and deterministic: the musical result of one event (exported for tests).
  voice(src, cfg, ev, values) {
    const g = this.state.global;
    const h = hash32(`${src.id}|${ev.key ?? ''}`);
    const pool = poolFor(cfg.families);
    const program = pool[h % pool.length];
    const family = familyOf(program);
    const fam = g.families[family] || { level: 1, mute: false };
    if (fam.mute || fam.level <= 0) return null;

    const field = (name) => src.allFields[cfg.map[name]];
    const val = (name) => values[cfg.map[name]];
    const idx = cfg.map.pitch === 'none' ? 0 : stepIndex(field('pitch'), val('pitch')) ?? 0;
    const shift = (h >>> 8) % 97; // each identity gets its own transposition
    let note;
    if (program === DRUMS) {
      note = DRUM_NOTES[fold(idx + shift, DRUM_NOTES.length)];
    } else {
      const [lo, hi] = REGISTERS[cfg.register] || REGISTERS.mid;
      const notes = scaleNotes(g.scale, g.root, lo, hi);
      note = notes[fold(idx + shift, notes.length)];
    }
    const u = (name, dflt) => (cfg.map[name] === 'none' ? dflt : unit(field(name), val(name)) ?? dflt);
    const velocity = Math.max(1, Math.min(127, Math.round((38 + 86 * u('velocity', 0.55)) * cfg.volume)));
    const beats = LENGTHS[Math.round(u('duration', 0.3) * (LENGTHS.length - 1))];
    const duration = program === DRUMS ? 0.4 : (beats * 60) / g.bpm;
    const pan = cfg.map.pan === 'none' ? (((h >>> 16) % 161) / 100 - 0.8) : u('pan', 0.5) * 1.6 - 0.8;
    const bright = 0.3 + 0.7 * u('bright', 0.6);
    return { source: src.id, program, family, note, velocity, duration, pan, bright, level: fam.level };
  }

  play(n) {
    const now = this.now();
    const L = this.limits;
    this.inFlight = this.inFlight.filter((v) => v.end > now);
    if (this.inFlight.length >= L.voices) return [];
    if (this.inFlight.filter((v) => v.source === n.source).length >= L.perSource) return [];
    for (const k of this.slots.keys()) if (k < (now - 1) * 1000) this.slots.delete(k);
    const when = this.when(n.source);
    if (when === null) return [];
    const voice = { ...n, when, delayMs: (when - now) * 1000 };
    if (this.state.global.internal) this.audio.play(voice);
    this.midi.play(voice, voice.delayMs);
    this.inFlight.push({ source: n.source, end: when + n.duration });
    return [voice];
  }
}
