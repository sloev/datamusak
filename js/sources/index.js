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
// Short names for the source tiles.
const SHORT = {
  'energinet-grid': 'Power grid', 'energinet-co2': 'CO₂ & wind', elpris: 'Spot price', 'dmi-weather': 'DMI weather',
  'dmi-lightning': 'Lightning', 'dmi-ocean': 'Sea level', 'open-meteo': '15 towns', 'sensor-community': 'Air quality',
  bikeshare: 'Bike share', aircraft: 'Aircraft', ais: 'Ships', hsl: 'Helsinki transit', 'fin-trains': 'Finnish trains',
  wikipedia: 'Wikipedia', bluesky: 'Bluesky', usgs: 'Earthquakes', iss: 'Space station', coinbase: 'Crypto trades',
  'bitcoin-mempool': 'Bitcoin', 'nostr-notes': 'Nostr notes', 'nostr-zaps': 'Nostr zaps', 'nostr-firehose': 'Nostr firehose',
  webtorrent: 'WebTorrent', listeners: 'Listeners', gifshooter: 'gifshooter', 'custom-mqtt': 'Custom MQTT', 'random-walk': 'Test signal',
};

// What gets its own instrument (the event identity), in plain words.
const IDENTITY = {
  'energinet-grid': 'cable or power plant', 'energinet-co2': null, elpris: 'price area (DK1/DK2)', 'dmi-weather': 'weather station',
  'dmi-lightning': 'kind of strike', 'dmi-ocean': 'tide gauge', 'open-meteo': 'town', 'sensor-community': 'sensor',
  bikeshare: 'bike station', aircraft: 'aircraft (transponder)', ais: 'ship (MMSI)', hsl: 'vehicle', 'fin-trains': 'train',
  wikipedia: 'editor', bluesky: 'author', usgs: 'region', iss: null, coinbase: 'side (buy/sell)', 'bitcoin-mempool': 'sending wallet',
  'nostr-notes': 'author', 'nostr-zaps': 'zapper', 'nostr-firehose': 'author', webtorrent: 'peer', listeners: 'listener',
  gifshooter: 'painter', 'custom-mqtt': 'topic', 'random-walk': 'voice',
};

const PALETTE = ['#FF8018', '#F3256C', '#9900CA', '#3F25FD', '#197FE7', '#3FDA93', '#99FF35', '#F3DA02'];

export const SOURCES = [...denmark, ...streams.slice(0, -2), ...nostr, ...torrent, ...p2p, ...streams.slice(-2)].map((src, i) => {
  const geo = GEO_RANGES[src.geo];
  const allFields = { ...src.fields };
  if (geo) {
    allFields.lat ??= { label: 'Latitude (north ↔ south)', min: geo.lat[0], max: geo.lat[1] };
    allFields.lon ??= { label: 'Longitude (west ↔ east)', min: geo.lon[0], max: geo.lon[1] };
  }
  const color = PALETTE[i % PALETTE.length];
  // ink: legible text on the swatch; shadow: a different saturated hue for the hard drop shadow
  const ink = ['#9900CA', '#3F25FD', '#197FE7', '#F3256C'].includes(color) ? '#F2F2F2' : '#050505';
  return { short: SHORT[src.id], identity: IDENTITY[src.id], ...src, color, ink, shadow: PALETTE[(i + 3) % PALETTE.length], allFields };
});

export const SOURCE_BY_ID = Object.fromEntries(SOURCES.map((s) => [s.id, s]));
