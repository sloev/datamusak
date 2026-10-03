import denmark from './denmark.js';
import streams from './streams.js';
import nostr from './nostr.js';
import torrent from './torrent.js';

const GEO_RANGES = {
  dk: { lat: [54.5, 57.8], lon: [8, 15.2] },
  nordic: { lat: [53.5, 66], lon: [5, 30] },
  world: { lat: [-60, 75], lon: [-180, 180] },
};

// Loud, saturated, rainbow-ordered: everything is drawn with black outlines on white.
const PALETTE = ['#ff2e4d', '#ff8a00', '#ffd400', '#2bd94a', '#00c8ff', '#2e5bff', '#a637ff', '#ff2ed1', '#ff5e00', '#00d6a4', '#7a5cff', '#ff3b8d', '#b5e300', '#00a2ff', '#e62ef0', '#ffb000', '#14e0d0', '#ff4fa0', '#5b8cff', '#c8f000', '#ff6f3c', '#3bd1ff', '#d04bff', '#ff2e4d', '#ffd400'];

export const SOURCES = [...denmark, ...streams.slice(0, -2), ...nostr, ...torrent, ...streams.slice(-2)].map((src, i) => {
  const geo = GEO_RANGES[src.geo];
  const allFields = { ...src.fields };
  if (geo) {
    allFields.lat ??= { label: 'Latitude (north ↔ south)', min: geo.lat[0], max: geo.lat[1] };
    allFields.lon ??= { label: 'Longitude (west ↔ east)', min: geo.lon[0], max: geo.lon[1] };
  }
  allFields.random = { label: 'Random', min: 0, max: 1 };
  return { ...src, color: PALETTE[i % PALETTE.length], allFields };
});

export const SOURCE_BY_ID = Object.fromEntries(SOURCES.map((s) => [s.id, s]));
