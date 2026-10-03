// App state with localStorage persistence: global settings, per-family levels, per-source setup.
import { FAMILIES } from './instruments.js';

const KEY = 'datamusak:v2';

// What a data field can drive, in plain words.
export const PARAMS = {
  pitch: 'Melody',
  velocity: 'Loudness',
  duration: 'Note length',
  pan: 'Left ↔ right',
  bright: 'Brightness',
};

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
  online: true,
  midiOut: '',
  internal: true,
  families: Object.fromEntries(FAMILIES.map((f) => [f.id, { level: f.id === 'drums' ? 0.8 : 0.9, mute: false }])),
};

export function defaultMapping(src) {
  const d = src.defaults || {};
  return {
    enabled: !!src.enabledByDefault,
    volume: 1,
    rate: d.rate ?? 4,
    register: d.register ?? 'mid',
    families: d.families ?? ['piano', 'chromatic'],
    map: {
      pitch: d.pitch ?? 'none',
      velocity: d.velocity ?? 'none',
      duration: d.duration ?? 'none',
      pan: d.pan ?? (src.geo === 'virtual' ? 'none' : 'lon'),
      bright: d.bright ?? 'none',
    },
    options: Object.fromEntries(Object.entries(src.options || {}).map(([k, o]) => [k, o.default])),
  };
}

const clone = (x) => JSON.parse(JSON.stringify(x));

export function loadState(sources) {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {}
  const global = { ...clone(DEFAULT_GLOBAL), ...(saved.global || {}) };
  global.families = { ...clone(DEFAULT_GLOBAL.families), ...(saved.global?.families || {}) };
  const state = { global, sources: {} };
  for (const src of sources) {
    const def = defaultMapping(src);
    const s = (saved.sources || {})[src.id] || {};
    state.sources[src.id] = { ...def, ...s, map: { ...def.map, ...(s.map || {}) }, options: { ...def.options, ...(s.options || {}) } };
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

// Write immediately (before a reload).
export function saveNow(state) {
  pending = state;
  flush();
}

export function clearState() {
  pending = null;
  clearTimeout(saveTimer);
  try {
    localStorage.removeItem(KEY);
  } catch {}
}
