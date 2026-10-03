// Presets: snapshots of the whole setup (globals, family levels, per-source setup) that can be saved in
// this browser, picked from a few built-ins, or shared as a link (#p=<deflated base64url>).
import { DEFAULT_GLOBAL, defaultMapping } from './state.js';

const LOCAL_KEY = 'datamusak:presets';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Only what differs from the defaults, so links stay short.
export function snapshot(state, sources) {
  const g = {};
  for (const [k, v] of Object.entries(state.global)) if (k !== 'midiOut' && !same(v, DEFAULT_GLOBAL[k])) g[k] = v;
  const s = {};
  for (const src of sources) {
    const def = defaultMapping(src);
    const cur = state.sources[src.id];
    const diff = {};
    for (const k of Object.keys(def)) if (!same(cur[k], def[k])) diff[k] = cur[k];
    if (Object.keys(diff).length) s[src.id] = diff;
  }
  return { v: 2, g, s };
}

// Replace the state's contents (in place) with defaults + snapshot.
export function applySnapshot(state, sources, snap) {
  const midiOut = state.global.midiOut;
  for (const k of Object.keys(state.global)) delete state.global[k];
  const g = JSON.parse(JSON.stringify(DEFAULT_GLOBAL));
  Object.assign(state.global, g, snap.g || {}, { midiOut });
  state.global.families = { ...g.families, ...(snap.g?.families || {}) };
  for (const src of sources) {
    const def = defaultMapping(src);
    const over = (snap.s || {})[src.id] || {};
    if (snap.enable) over.enabled = snap.enable.includes(src.id);
    state.sources[src.id] = { ...def, ...over, map: { ...def.map, ...(over.map || {}) }, options: { ...def.options, ...(over.options || {}) } };
  }
}

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function pipe(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}
export async function encode(snap) {
  return b64url(await pipe(new TextEncoder().encode(JSON.stringify(snap)), new CompressionStream('deflate-raw')));
}
export async function decode(str) {
  return JSON.parse(new TextDecoder().decode(await pipe(unb64url(str), new DecompressionStream('deflate-raw'))));
}
export async function shareUrl(snap) {
  const u = new URL(location.href);
  u.hash = 'p=' + (await encode(snap));
  return u.href;
}
export function presetFromHash(hash = location.hash) {
  const m = /^#p=([\w-]+)$/.exec(hash);
  return m ? m[1] : null;
}

export function localPresets() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}');
  } catch {
    return {};
  }
}
export function saveLocalPreset(name, snap) {
  const all = localPresets();
  all[name] = { snap, saved: Date.now() };
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(all));
  } catch {}
}
export function deleteLocalPreset(name) {
  const all = localPresets();
  delete all[name];
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(all));
  } catch {}
}

export const BUILTIN = [
  { name: 'Danish weather report', desc: 'DMI stations, towns, tide gauges and lightning in lydian.', snap: { v: 2, g: { bpm: 84, root: 5, scale: 'lydian' }, enable: ['dmi-weather', 'open-meteo', 'dmi-ocean', 'dmi-lightning'] } },
  { name: 'Power grid', desc: 'Energinet flows, CO₂ bass line and today’s spot prices.', snap: { v: 2, g: { bpm: 100, root: 9, scale: 'dorian' }, enable: ['energinet-grid', 'energinet-co2', 'elpris'] } },
  { name: 'Sea & sky', desc: 'Ships, aircraft, the ISS and the planet’s earthquakes.', snap: { v: 2, g: { bpm: 72, root: 4, scale: 'hirajoshi', reverb: 0.6 }, enable: ['ais', 'aircraft', 'iss', 'usgs'] } },
  { name: 'Internet storm', desc: 'Nostr firehose, every Wikipedia, Bluesky and crypto trades.', snap: { v: 2, g: { bpm: 128, root: 0, scale: 'minorPentatonic', quantize: '1/32' }, enable: ['nostr-firehose', 'wikipedia', 'bluesky', 'coinbase'], s: { wikipedia: { options: { wiki: 'all' } } } } },
  { name: 'Paint party', desc: 'gifshooter painters, other listeners and Nostr zaps.', snap: { v: 2, g: { bpm: 110, root: 7, scale: 'majorPentatonic' }, enable: ['gifshooter', 'listeners', 'nostr-zaps'] } },
  { name: 'Defaults', desc: 'Back to the factory setup.', snap: { v: 2 } },
];
