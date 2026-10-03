// The engine: data event → deterministic notes on General MIDI instruments.
import { scaleNotes, DRUM_NOTES } from './scales.js';
import { poolFor, familyOf, DRUMS } from './instruments.js';
import { hash32, unit, stepIndex, fold, LENGTHS, REGISTERS } from './mapping.js';

const GRID = { off: 0, '1/4': 1, '1/8': 0.5, '1/16': 0.25, '1/32': 0.125 };
const MAX_VOICES = 48;

export class Engine {
  constructor({ state, audio, midi }) {
    this.state = state;
    this.audio = audio;
    this.midi = midi;
    this.listeners = [];
    this.buckets = new Map();
    this.inFlight = [];
    this.stats = new Map();
  }

  on(fn) {
    this.listeners.push(fn);
  }

  now() {
    return this.audio.ctx ? this.audio.ctx.currentTime : performance.now() / 1000;
  }

  eventsPerMinute(id) {
    const s = this.stats.get(id);
    if (!s) return 0;
    const cutoff = performance.now() - 60000;
    while (s.length && s[0] < cutoff) s.shift();
    return s.length;
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
    let s = this.stats.get(src.id);
    if (!s) this.stats.set(src.id, (s = []));
    s.push(performance.now());

    const out = { src, ev, values, notes: [] };
    if (cfg.enabled && this.allow(src.id, cfg.rate)) {
      const n = this.voice(src, cfg, ev, values);
      if (n) out.notes = this.play(n);
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
    this.inFlight = this.inFlight.filter((t) => t > now);
    if (this.inFlight.length >= MAX_VOICES) return [];
    const when = this.when();
    const voice = { ...n, when, delayMs: (when - now) * 1000 };
    if (this.state.global.internal) this.audio.play(voice);
    this.midi.play(voice, voice.delayMs);
    this.inFlight.push(when + n.duration);
    return [voice];
  }
}
