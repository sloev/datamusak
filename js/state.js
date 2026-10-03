// App state (global params, instrument slots, per-source mappings) with localStorage persistence.
import { DRUMS } from './audio.js';

const KEY = 'datamusak:v1';

export const PARAMS = {
  pitch: { label: 'Pitch', unit: 'note', min: 0, max: 127, step: 1 },
  velocity: { label: 'Velocity', unit: '', min: 1, max: 127, step: 1 },
  duration: { label: 'Length', unit: 's', min: 0.03, max: 8, step: 0.01 },
  pan: { label: 'Pan', unit: '', min: -1, max: 1, step: 0.05 },
  bright: { label: 'Brightness (CC74)', unit: '', min: 0, max: 1, step: 0.05 },
};

export const DEFAULT_SLOTS = [
  { name: 'Keys', program: 4, level: 0.7, pan: 0, octave: 0, mute: false }, // Electric piano 1
  { name: 'Mallets', program: 12, level: 0.75, pan: -0.3, octave: 0, mute: false }, // Marimba
  { name: 'Bells', program: 11, level: 0.6, pan: 0.3, octave: 1, mute: false }, // Vibraphone
  { name: 'Pad', program: 89, level: 0.45, pan: 0, octave: -1, mute: false }, // Pad 2 (warm)
  { name: 'Pluck', program: 45, level: 0.6, pan: 0.2, octave: 0, mute: false }, // Pizzicato strings
  { name: 'Kalimba', program: 108, level: 0.6, pan: -0.2, octave: 0, mute: false },
  { name: 'Bass', program: 35, level: 0.7, pan: 0, octave: -1, mute: false }, // Fretless bass
  { name: 'Drums', program: DRUMS, level: 0.6, pan: 0, octave: 0, mute: false },
];

export const DEFAULT_GLOBAL = {
  bpm: 92,
  quantize: '1/16',
  root: 2,
  scale: 'minorPentatonic',
  master: 0.8,
  reverb: 0.35,
  tone: 0.85,
  delayMix: 0.15,
  delayFeedback: 0.35,
  delayBeats: 0.75,
  maxPolyphony: 32,
  midiOut: '',
  internal: true,
};

export function defaultMapping(src) {
  const d = src.defaults || {};
  const inv = d.invert || [];
  const m = (field, lo, hi, name) => ({ field: field ?? 'none', lo, hi, invert: inv.includes(name) });
  return {
    enabled: !!src.enabledByDefault,
    level: 1,
    rate: d.rate ?? 4,
    chance: 1,
    scale: 'global',
    harmony: 'none',
    slots: d.slots ?? [0, 1, 2],
    slotMode: d.slotMode ?? 'cycle',
    slotField: d.slotField ?? 'random',
    pitch: m(d.pitch, ...(d.pitchRange ?? [45, 81]), 'pitch'),
    velocity: m(d.velocity, ...(d.velocityRange ?? [40, 105]), 'velocity'),
    duration: m(d.duration, ...(d.durationRange ?? [0.2, 1.6]), 'duration'),
    pan: m(d.pan ?? (src.geo === 'virtual' ? 'random' : 'lon'), -0.8, 0.8, 'pan'),
    bright: m(d.bright, 0.35, 0.95, 'bright'),
    options: Object.fromEntries(Object.entries(src.options || {}).map(([k, o]) => [k, o.default])),
  };
}

export function loadState(sources) {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {}
  const state = {
    global: { ...DEFAULT_GLOBAL, ...(saved.global || {}) },
    slots: (saved.slots && saved.slots.length ? saved.slots : DEFAULT_SLOTS).map((s) => ({ ...s })),
    sources: {},
  };
  for (const src of sources) {
    const def = defaultMapping(src);
    const s = (saved.sources || {})[src.id] || {};
    const merged = { ...def, ...s };
    for (const p of Object.keys(PARAMS)) merged[p] = { ...def[p], ...(s[p] || {}) };
    merged.options = { ...def.options, ...(s.options || {}) };
    state.sources[src.id] = merged;
  }
  return state;
}

let saveTimer;
let pending = null;

function flush() {
  clearTimeout(saveTimer);
  if (!pending) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(pending));
  } catch {}
  pending = null;
}

// Debounced, but never lost: pending changes are written when the page is hidden or closed.
export function saveState(state) {
  pending = state;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 300);
}
if (typeof window !== 'undefined') window.addEventListener('pagehide', flush);

export function clearState() {
  pending = null;
  clearTimeout(saveTimer);
  try {
    localStorage.removeItem(KEY);
  } catch {}
}
