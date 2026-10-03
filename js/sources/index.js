import denmark from './denmark.js';
import streams from './streams.js';

const GEO_RANGES = {
  dk: { lat: [54.5, 57.8], lon: [8, 15.2] },
  nordic: { lat: [53.5, 66], lon: [5, 30] },
  world: { lat: [-60, 75], lon: [-180, 180] },
};

const PALETTE = ['#ff6b6b', '#ffd166', '#06d6a0', '#4cc9f0', '#b388ff', '#ff9f1c', '#f15bb5', '#9ef01a', '#00bbf9', '#fee440', '#f28482', '#80ffdb', '#c77dff', '#e9c46a', '#48cae4', '#ff8fab', '#a7c957', '#ffafcc', '#90e0ef', '#ffb703', '#caffbf'];

export const SOURCES = [...denmark, ...streams].map((src, i) => {
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
