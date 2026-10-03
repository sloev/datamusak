import denmark from './denmark.js';
import streams from './streams.js';
import nostr from './nostr.js';
import torrent from './torrent.js';
import p2p from './p2p.js';

const GEO_RANGES = {
  dk: { lat: [54.5, 57.8], lon: [8, 15.2] },
  nordic: { lat: [53.5, 66], lon: [5, 30] },
  world: { lat: [-60, 75], lon: [-180, 180] },
};

// The 8 face swatches of the logo's acid palette (static UI accents).
const PALETTE = ['#FF8018', '#F3256C', '#9900CA', '#3F25FD', '#197FE7', '#3FDA93', '#99FF35', '#F3DA02'];

export const SOURCES = [...denmark, ...streams.slice(0, -2), ...nostr, ...torrent, ...p2p, ...streams.slice(-2)].map((src, i) => {
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
