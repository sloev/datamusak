// Deterministic data → music mapping. The same event always becomes the same note:
//   identity (station, ship, author, topic…) → instrument + transposition (diversity)
//   pitch field → walks the scale in fine steps, folding back at the edges (melody)
//   other fields → fixed ranges (loudness, length, pan, tone)
// No learned ranges, no randomness.

export function hash32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const signedLog = (v) => Math.sign(v) * Math.log10(1 + Math.abs(v));
const golden = (x) => x - Math.floor(x);

// 0..1 for a value; fixed ranges, or a deterministic spread for unbounded fields.
export function unit(field = {}, v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  if (field.min !== undefined && field.max !== undefined) {
    const f = field.log ? signedLog : (x) => x;
    const lo = f(field.min);
    const hi = f(field.max);
    return hi === lo ? 0.5 : Math.min(1, Math.max(0, (f(v) - lo) / (hi - lo)));
  }
  return golden(signedLog(v) * 0.61803);
}

// Integer step index for the melody: one scale step per `field.step` units
// (default: the field's range in 36 steps; unbounded fields step in 1/12 decades).
export function stepIndex(field = {}, v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  if (field.min !== undefined && field.max !== undefined && !field.log) {
    const step = field.step ?? (field.max - field.min) / 36;
    return Math.floor((v - field.min) / step);
  }
  const lo = field.min !== undefined ? signedLog(field.min) : 0;
  const step = field.step ?? (field.min !== undefined && field.max !== undefined ? (signedLog(field.max) - lo) / 36 : 1 / 12);
  return Math.floor((signedLog(v) - lo) / step);
}

// Fold any integer into 0..n-1 by bouncing (0 1 2 … n-1 n-2 … 1 0 1 …), so steps stay smooth.
export function fold(i, n) {
  if (n <= 1) return 0;
  const p = 2 * (n - 1);
  const m = ((i % p) + p) % p;
  return m < n ? m : p - m;
}

// Musical note lengths, in beats.
export const LENGTHS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];

export const REGISTERS = {
  low: [33, 57],
  mid: [48, 76],
  high: [62, 93],
  wide: [36, 91],
};
