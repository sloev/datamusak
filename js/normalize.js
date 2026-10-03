// Turns raw field values into 0..1.
// Fields can declare a fixed {min, max} (and `log: true` for heavy-tailed data);
// otherwise the range is learned from a rolling window (2nd–98th percentile),
// so sources with unknown units still use the whole musical range.

const WINDOW = 256;

class Range {
  constructor() {
    this.values = [];
    this.lo = 0;
    this.hi = 1;
    this.dirty = 0;
  }
  push(v) {
    this.values.push(v);
    if (this.values.length > WINDOW) this.values.shift();
    if (++this.dirty >= 8 || this.values.length < 16) this.recompute();
  }
  recompute() {
    this.dirty = 0;
    const s = [...this.values].sort((a, b) => a - b);
    this.lo = s[Math.floor((s.length - 1) * 0.02)];
    this.hi = s[Math.ceil((s.length - 1) * 0.98)];
  }
}

export class Normalizer {
  constructor() {
    this.ranges = new Map();
  }
  reset(sourceId) {
    for (const k of this.ranges.keys()) if (k.startsWith(sourceId + '/')) this.ranges.delete(k);
  }
  // Learn from every numeric field of an event (call once per event).
  observe(sourceId, fields, values) {
    for (const [key, raw] of Object.entries(values)) {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
      const spec = fields[key] || {};
      if (spec.min !== undefined && spec.max !== undefined) continue;
      const id = sourceId + '/' + key;
      let r = this.ranges.get(id);
      if (!r) this.ranges.set(id, (r = new Range()));
      r.push(spec.log ? signedLog(raw) : raw);
    }
  }
  value(sourceId, fields, values, key) {
    if (key === 'random') return Math.random();
    const raw = values[key];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
    const spec = fields[key] || {};
    let v = spec.log ? signedLog(raw) : raw;
    let lo, hi;
    if (spec.min !== undefined && spec.max !== undefined) {
      lo = spec.log ? signedLog(spec.min) : spec.min;
      hi = spec.log ? signedLog(spec.max) : spec.max;
    } else {
      const r = this.ranges.get(sourceId + '/' + key);
      if (!r) return 0.5;
      lo = r.lo;
      hi = r.hi;
    }
    if (hi - lo < 1e-9) return 0.5;
    return Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
  }
}

function signedLog(v) {
  return Math.sign(v) * Math.log10(1 + Math.abs(v));
}
