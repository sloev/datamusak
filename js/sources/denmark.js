// Live Danish open data, all fetched straight from the browser (CORS-enabled APIs).
import { num, inDK } from './runtime.js';

// Energi Data Service refuses cross-origin requests, so a GitHub Action mirrors it every 10 minutes
// to the repo's `data` branch (.github/workflows/data-mirror.yml); raw.githubusercontent.com has CORS.
const GRID_MIRROR = 'https://raw.githubusercontent.com/sloev/datamusak/data/grid.json';
const DMI = 'https://opendataapi.dmi.dk/v2';
const DK_BBOX = '7.5,54.4,15.6,58.0';

const byLon = (a, b) => a.lon - b.lon;

// ---------------------------------------------------------------- Energinet

const GRID = [
  ['OffshoreWindPower', 'Offshore wind', 55.55, 7.75],
  ['OnshoreWindPower', 'Onshore wind', 56.25, 8.6],
  ['SolarPower', 'Solar', 54.85, 11.55],
  ['ProductionGe100MW', 'Central power plants', 55.6, 12.45],
  ['ProductionLt100MW', 'Local CHP plants', 56.05, 9.6],
  ['Exchange_DK1_DE', 'Cable West DK ↔ Germany', 54.85, 9.35],
  ['Exchange_DK1_NL', 'COBRA ↔ Netherlands', 55.15, 7.6],
  ['Exchange_DK1_GB', 'Viking Link ↔ Britain', 55.6, 7.2],
  ['Exchange_DK1_NO', 'Skagerrak ↔ Norway', 57.45, 8.9],
  ['Exchange_DK1_SE', 'Konti-Skan ↔ Sweden', 57.1, 11.2],
  ['Exchange_DK1_DK2', 'Great Belt link', 55.35, 11.0],
  ['Exchange_DK2_DE', 'Kontek ↔ Germany', 54.5, 12.15],
  ['Exchange_DK2_SE', 'Øresund ↔ Sweden', 55.95, 12.7],
  ['Exchange_Bornholm_SE', 'Bornholm ↔ Sweden', 55.55, 14.4],
];

// newest first
async function gridRecords(ctx, limit) {
  const data = await ctx.fetchJSON(GRID_MIRROR);
  return (data.records || []).slice(0, limit);
}

const ago = (r) => {
  const min = Math.round((Date.now() - Date.parse(r?.Minutes1UTC + 'Z')) / 60000);
  return Number.isFinite(min) ? ` · ${min} min ago` : '';
};

const energinetGrid = {
  id: 'energinet-grid',
  name: 'Energinet: power grid right now',
  group: 'Denmark',
  geo: 'dk',
  home: [55.56, 9.75],
  transport: 'REST · Energi Data Service via a 10-minute mirror',
  link: 'https://www.energidataservice.dk/tso-electricity/PowerSystemRightNow',
  info: 'Every production type and interconnector cable of the Danish grid, played as an arpeggio. Each note sits where the power is made or crosses the border; louder = more megawatts.',
  fields: {
    mw: { label: 'MW (signed: + import / production)', min: -2500, max: 3500, step: 60 },
    abs: { label: '|MW|', min: 0, max: 3500, log: true },
    component: { label: 'Component # (fixed per cable/plant)', min: 0, max: GRID.length - 1 },
    co2: { label: 'CO₂ g/kWh', min: 0, max: 300 },
    windShare: { label: 'Wind share of production', min: 0, max: 1 },
  },
  defaults: { pitch: 'mw', velocity: 'abs', duration: 'abs', bright: 'co2', families: ['lead', 'bass', 'chromatic'], register: 'wide', rate: 8 },
  enabledByDefault: true,
  start(ctx) {
    const seq = ctx.sequence(0.5);
    ctx.poll(120000, async () => {
      const recs = await gridRecords(ctx, 5);
      const pick = (k) => recs.map((r) => num(r[k])).find((v) => v !== undefined);
      const wind = (pick('OffshoreWindPower') || 0) + (pick('OnshoreWindPower') || 0);
      const prod = wind + (pick('SolarPower') || 0) + (pick('ProductionGe100MW') || 0) + (pick('ProductionLt100MW') || 0);
      const co2 = pick('CO2Emission');
      const items = [];
      GRID.forEach(([key, label, lat, lon], component) => {
        const mw = pick(key);
        if (mw === undefined) return;
        items.push({ lat, lon, key, label: `${label}: ${Math.round(mw)} MW`, values: { mw, abs: Math.abs(mw), component, co2, windShare: prod ? wind / prod : 0 } });
      });
      seq.set(items);
      return `CO₂ ${co2 ?? '?'} g/kWh${ago(recs[0])}`;
    });
  },
};

const energinetCo2 = {
  id: 'energinet-co2',
  name: 'Energinet: CO₂ & wind, last hour',
  group: 'Denmark',
  geo: 'dk',
  home: [55.47, 8.45],
  transport: 'REST · Energi Data Service via a 10-minute mirror',
  link: 'https://www.energidataservice.dk/tso-electricity/PowerSystemRightNow',
  info: 'The last 60 minutes of the Danish grid as a looping bass line: pitch follows CO₂ intensity, loudness the wind power. The loop moves on as new minutes arrive (Energinet’s API blocks browsers, so a GitHub Action mirrors it every 10 minutes).',
  fields: {
    co2: { label: 'CO₂ g/kWh', min: 0, max: 300, step: 4 },
    wind: { label: 'Wind MW', min: 0, max: 6000 },
    solar: { label: 'Solar MW', min: 0, max: 3000 },
    exchange: { label: 'Net exchange MW', min: -4000, max: 4000 },
    minute: { label: 'Minute in loop', min: 0, max: 59 },
  },
  defaults: { pitch: 'co2', velocity: 'wind', duration: 'solar', bright: 'exchange', pan: 'minute', families: ['bass', 'organ'], register: 'low', rate: 4 },
  start(ctx) {
    const seq = ctx.sequence(1);
    ctx.poll(120000, async () => {
      const newest = await gridRecords(ctx, 60);
      const recs = [...newest].reverse();
      seq.set(
        recs.map((r, minute) => ({
          label: `${r.Minutes1DK} CO₂ ${r.CO2Emission}`,
          values: {
            co2: num(r.CO2Emission),
            wind: (num(r.OffshoreWindPower) || 0) + (num(r.OnshoreWindPower) || 0),
            solar: num(r.SolarPower),
            exchange: num(r.Exchange_Sum),
            minute,
          },
        })),
      );
      return `${recs.length} minutes loaded${ago(newest[0])}`;
    });
  },
};

// ------------------------------------------------------------- Spot prices

const elpris = {
  id: 'elpris',
  name: 'Electricity spot price today (DK1/DK2)',
  group: 'Denmark',
  geo: 'dk',
  home: [56.16, 10.2],
  transport: 'REST · elprisenligenu.dk (Nord Pool day-ahead)',
  link: 'https://www.elprisenligenu.dk/elpris-api',
  info: 'Today’s day-ahead prices for West (DK1, Aarhus) and East Denmark (DK2, Copenhagen) as a melody through the day. The current time slot is accented.',
  fields: {
    price: { label: 'DKK/kWh', min: -0.5, max: 4, step: 0.03 },
    slot: { label: 'Time of day', min: 0, max: 1 },
    isNow: { label: 'Is current slot', min: 0, max: 1 },
    area: { label: 'Area (0 = DK1, 1 = DK2)', min: 0, max: 1 },
  },
  defaults: { pitch: 'price', velocity: 'isNow', duration: 'slot', pan: 'area', bright: 'price', families: ['piano', 'chromatic'], register: 'mid', rate: 8 },
  start(ctx) {
    const seq = ctx.sequence(0.5);
    ctx.poll(30 * 60000, async () => {
      const d = new Date();
      const path = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const [dk1, dk2] = await Promise.all(
        ['DK1', 'DK2'].map((a) => ctx.fetchJSON(`https://www.elprisenligenu.dk/api/v1/prices/${path}_${a}.json`)),
      );
      const now = Date.now();
      const items = [];
      dk1.forEach((p1, i) => {
        [p1, dk2[i]].forEach((p, area) => {
          if (!p) return;
          const start = Date.parse(p.time_start);
          const end = Date.parse(p.time_end);
          items.push({
            lat: area ? 55.68 : 56.16,
            lon: area ? 12.57 : 10.2,
            key: `DK${area + 1}`,
            label: `DK${area + 1} ${p.time_start.slice(11, 16)} ${p.DKK_per_kWh.toFixed(2)} kr`,
            values: { price: p.DKK_per_kWh, slot: i / dk1.length, isNow: start <= now && now < end ? 1 : 0, area },
          });
        });
      });
      seq.set(items);
      return `${dk1.length} price slots`;
    });
  },
};

// ------------------------------------------------------------------- DMI

const MET_PARAMS = {
  temp_dry: 'temp',
  wind_speed: 'wind',
  wind_max: 'gust',
  wind_dir: 'windDir',
  humidity: 'humidity',
  pressure_at_sea: 'pressure',
  precip_past10min: 'precip',
  radia_glob: 'radiation',
};

const dmiWeather = {
  id: 'dmi-weather',
  name: 'DMI weather stations',
  group: 'Denmark',
  geo: 'dk',
  home: [55.71, 12.56],
  transport: 'REST · opendataapi.dmi.dk metObs (10 min)',
  link: 'https://www.dmi.dk/friedata/dokumentation/apis',
  info: 'Latest observations from every DMI station in Denmark, swept west → east like a scan line. Temperature drives pitch, wind the loudness.',
  fields: {
    temp: { label: 'Temperature °C', min: -12, max: 30 },
    wind: { label: 'Wind m/s', min: 0, max: 20 },
    gust: { label: 'Gust m/s', min: 0, max: 30 },
    windDir: { label: 'Wind direction °', min: 0, max: 360 },
    humidity: { label: 'Humidity %', min: 30, max: 100 },
    pressure: { label: 'Pressure hPa', min: 970, max: 1045 },
    precip: { label: 'Rain mm/10 min', min: 0, max: 3 },
    radiation: { label: 'Sun W/m²', min: 0, max: 900 },
  },
  defaults: { pitch: 'temp', velocity: 'wind', duration: 'humidity', bright: 'radiation', families: ['pipe', 'chromatic', 'strings'], register: 'wide', rate: 10 },
  enabledByDefault: true,
  start(ctx) {
    const seq = ctx.sequence(0.25);
    ctx.poll(10 * 60000, async () => {
      const stations = new Map();
      const results = await Promise.allSettled(
        Object.keys(MET_PARAMS).map((p) =>
          ctx.fetchJSON(`${DMI}/metObs/collections/observation/items?period=latest-10-minutes&parameterId=${p}&bbox=${DK_BBOX}&sortorder=observed,DESC&limit=3000`),
        ),
      );
      const ok = results.filter((r) => r.status === 'fulfilled');
      if (!ok.length) throw results[0].reason;
      for (const r of ok) {
        for (const f of r.value.features || []) {
          const { stationId, parameterId, value } = f.properties;
          const [lon, lat] = f.geometry.coordinates;
          let s = stations.get(stationId);
          if (!s) stations.set(stationId, (s = { lat, lon, key: stationId, label: `station ${stationId}`, values: {} }));
          s.values[MET_PARAMS[parameterId]] ??= value; // newest first: keep the latest reading
        }
      }
      const items = [...stations.values()].sort(byLon);
      seq.set(items);
      return `${items.length} stations`;
    });
  },
};

const dmiLightning = {
  id: 'dmi-lightning',
  name: 'DMI lightning strikes',
  group: 'Denmark',
  geo: 'dk',
  home: [56.45, 10.05],
  transport: 'REST · opendataapi.dmi.dk lightningdata',
  link: 'https://www.dmi.dk/friedata/dokumentation/lightning-data-api',
  info: 'New lightning strikes over and around Denmark as they are detected. Silent in fair weather — that is a feature.',
  fields: {
    amp: { label: 'Peak current |kA|', min: 0, max: 80, log: true },
    type: { label: 'Type (0 ground−, 1 ground+, 2 cloud)', min: 0, max: 2 },
    strokes: { label: 'Strokes', min: 1, max: 8 },
    sensors: { label: 'Sensors' },
  },
  defaults: { pitch: 'amp', velocity: 'amp', duration: 'strokes', families: ['drums', 'percussive', 'fx'], register: 'wide', rate: 10 },
  start(ctx) {
    const seen = new Set();
    const interval = 30000;
    ctx.poll(interval, async () => {
      const from = new Date(Date.now() - 3 * 60000).toISOString();
      const to = new Date().toISOString();
      const data = await ctx.fetchJSON(`${DMI}/lightningdata/collections/observation/items?datetime=${from}/${to}&bbox=4,53,18,59&limit=2000`);
      const fresh = (data.features || [])
        .filter((f) => !seen.has(f.id))
        .sort((a, b) => Date.parse(a.properties.observed) - Date.parse(b.properties.observed));
      fresh.forEach((f) => seen.add(f.id));
      if (seen.size > 20000) seen.clear();
      ctx.spread(
        fresh.map((f) => {
          const p = f.properties;
          const [lon, lat] = f.geometry.coordinates;
          return { lat, lon, key: `type${p.type}`, label: `⚡ ${p.amp} kA`, values: { amp: Math.abs(num(p.amp) || 0), type: num(p.type), strokes: num(p.strokes), sensors: num(p.sensors) } };
        }),
        interval,
      );
      return fresh.length ? `${fresh.length} new strikes` : 'no strikes right now';
    });
  },
};

const dmiOcean = {
  id: 'dmi-ocean',
  name: 'DMI sea level around the coast',
  group: 'Denmark',
  geo: 'dk',
  home: [55.05, 10.6],
  transport: 'REST · opendataapi.dmi.dk oceanObs',
  link: 'https://www.dmi.dk/friedata/dokumentation/oceanographic-observation-data-api',
  info: 'Tide gauges played as a slow tour around the Danish coastline. Water level drives pitch.',
  fields: {
    level: { label: 'Sea level cm', min: -120, max: 150 },
    waterTemp: { label: 'Water temp °C', min: 0, max: 22 },
    angle: { label: 'Position on the coast tour', min: -Math.PI, max: Math.PI },
  },
  defaults: { pitch: 'level', velocity: 'waterTemp', duration: 'waterTemp', bright: 'waterTemp', families: ['pad', 'ensemble'], register: 'low', rate: 2 },
  start(ctx) {
    const seq = ctx.sequence(2);
    ctx.poll(10 * 60000, async () => {
      const get = (p) => ctx.fetchJSON(`${DMI}/oceanObs/collections/observation/items?period=latest-hour&parameterId=${p}&bbox=${DK_BBOX}&sortorder=observed,DESC&limit=3000`);
      const [lev, tw] = await Promise.allSettled([get('sealev_dvr'), get('tw')]);
      if (lev.status !== 'fulfilled') throw lev.reason;
      const st = new Map();
      for (const [res, key] of [[lev, 'level'], [tw, 'waterTemp']]) {
        if (res.status !== 'fulfilled') continue;
        for (const f of res.value.features || []) {
          const [lon, lat] = f.geometry.coordinates;
          const id = f.properties.stationId;
          if (!st.has(id)) st.set(id, { lat, lon, key: id, label: `tide gauge ${id}`, values: { angle: Math.atan2(lat - 56, lon - 10.6) } });
          st.get(id).values[key] ??= f.properties.value;
        }
      }
      const items = [...st.values()].filter((s) => s.values.level !== undefined).sort((a, b) => a.values.angle - b.values.angle);
      seq.set(items);
      return `${items.length} gauges`;
    });
  },
};

// ---------------------------------------------------------- Open-Meteo

const CITIES = [
  ['Esbjerg', 55.47, 8.45], ['Thisted', 56.96, 8.69], ['Ribe', 55.33, 8.76], ['Herning', 56.14, 8.97],
  ['Sønderborg', 54.91, 9.79], ['Aalborg', 57.05, 9.92], ['Aarhus', 56.16, 10.2], ['Odense', 55.4, 10.39],
  ['Skagen', 57.72, 10.58], ['Svendborg', 55.06, 10.61], ['Nakskov', 54.83, 11.13], ['Roskilde', 55.64, 12.08],
  ['København', 55.68, 12.57], ['Helsingør', 56.04, 12.61], ['Rønne', 55.1, 14.7],
];

const openMeteo = {
  id: 'open-meteo',
  name: 'Open-Meteo: weather in 15 Danish towns',
  group: 'Denmark',
  geo: 'dk',
  home: [55.4, 10.39],
  transport: 'REST · api.open-meteo.com (DMI HARMONIE model)',
  link: 'https://open-meteo.com/en/docs/dmi-api',
  info: 'Current conditions in towns from Esbjerg to Rønne, modelled by DMI’s HARMONIE model. A robust fallback if the DMI station API is unreachable.',
  fields: {
    temp: { label: 'Temperature °C', min: -12, max: 30 },
    humidity: { label: 'Humidity %', min: 30, max: 100 },
    precip: { label: 'Rain mm', min: 0, max: 4 },
    cloud: { label: 'Cloud cover %', min: 0, max: 100 },
    pressure: { label: 'Pressure hPa', min: 970, max: 1045 },
    wind: { label: 'Wind m/s', min: 0, max: 20 },
    windDir: { label: 'Wind direction °', min: 0, max: 360 },
    gust: { label: 'Gust m/s', min: 0, max: 30 },
    sun: { label: 'Sun W/m²', min: 0, max: 900 },
  },
  defaults: { pitch: 'temp', velocity: 'gust', duration: 'cloud', bright: 'sun', families: ['ethnic', 'guitar', 'pipe'], register: 'mid', rate: 6 },
  start(ctx) {
    const seq = ctx.sequence(0.5);
    ctx.poll(15 * 60000, async () => {
      const q = new URLSearchParams({
        latitude: CITIES.map((c) => c[1]).join(','),
        longitude: CITIES.map((c) => c[2]).join(','),
        current: 'temperature_2m,relative_humidity_2m,precipitation,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,shortwave_radiation',
        wind_speed_unit: 'ms',
      });
      const data = [].concat(await ctx.fetchJSON(`https://api.open-meteo.com/v1/forecast?${q}`));
      seq.set(
        data.map((d, i) => {
          const c = d.current;
          return {
            lat: CITIES[i][1],
            lon: CITIES[i][2],
            key: CITIES[i][0],
            label: `${CITIES[i][0]} ${c.temperature_2m}°C`,
            values: {
              temp: c.temperature_2m, humidity: c.relative_humidity_2m, precip: c.precipitation, cloud: c.cloud_cover,
              pressure: c.pressure_msl, wind: c.wind_speed_10m, windDir: c.wind_direction_10m, gust: c.wind_gusts_10m, sun: c.shortwave_radiation,
            },
          };
        }),
      );
      return `${data.length} towns`;
    });
  },
};

// ---------------------------------------------------- Sensor.Community

const airQuality = {
  id: 'sensor-community',
  name: 'Citizen air-quality sensors (Sensor.Community)',
  group: 'Denmark',
  geo: 'dk',
  home: [55.86, 9.85],
  transport: 'REST · data.sensor.community (5 min averages)',
  link: 'https://sensor.community/en/',
  info: 'Hundreds of home-built particulate sensors across Denmark. Fine dust (PM2.5) drives pitch — dirtier air plays higher.',
  fields: {
    pm25: { label: 'PM2.5 µg/m³', min: 0, max: 40, log: true },
    pm10: { label: 'PM10 µg/m³', min: 0, max: 60, log: true },
    temp: { label: 'Temperature °C', min: -12, max: 30 },
    humidity: { label: 'Humidity %', min: 30, max: 100 },
  },
  defaults: { pitch: 'pm25', velocity: 'pm10', duration: 'humidity', bright: 'temp', families: ['chromatic', 'percussive'], register: 'high', rate: 8 },
  start(ctx) {
    const seq = ctx.sequence(0.25);
    const keys = { P2: 'pm25', P1: 'pm10', temperature: 'temp', humidity: 'humidity' };
    ctx.poll(5 * 60000, async () => {
      const data = await ctx.fetchJSON('https://data.sensor.community/airrohr/v1/filter/country=DK', { timeout: 40000 });
      const locs = new Map();
      for (const r of data) {
        const lat = num(r.location.latitude);
        const lon = num(r.location.longitude);
        if (lat === undefined || !inDK(lat, lon)) continue;
        let l = locs.get(r.location.id);
        if (!l) locs.set(r.location.id, (l = { lat, lon, key: String(r.location.id), label: `sensor @${r.location.id}`, values: {} }));
        for (const v of r.sensordatavalues) if (keys[v.value_type]) l.values[keys[v.value_type]] = num(v.value);
      }
      const items = [...locs.values()].filter((l) => Object.keys(l.values).length).sort(byLon);
      seq.set(items);
      return `${items.length} sensor sites`;
    });
  },
};

// ------------------------------------------------------- Bike share (GBFS)

const DOTT_CPH = 'https://gbfs.api.ridedott.com/public/v2/copenhagen/gbfs.json';
// Donkey Republic's feed sends no CORS header, so browsers can't read it; old settings move to Dott.
const UNREACHABLE_GBFS = /stables\.donkey\.bike/;
const cell = (lat, lon) => `${lat.toFixed(2)},${lon.toFixed(2)}`; // ≈1 km neighbourhood

const bikeShare = {
  id: 'bikeshare',
  name: 'Bikes & scooters: taken and parked',
  group: 'Denmark',
  geo: 'dk',
  home: [55.69, 12.53],
  transport: 'REST · GBFS feed (Dott Copenhagen by default)',
  link: 'https://github.com/MobilityData/gbfs',
  info: 'Watches a shared bike/scooter system: every vehicle picked up or parked is a note where it happened. Paste any GBFS discovery URL (with CORS) to listen to another city; station-based systems work too.',
  options: {
    url: { label: 'GBFS discovery URL', type: 'text', default: DOTT_CPH },
  },
  fields: {
    delta: { label: 'Change (− taken, + parked/returned)', min: -4, max: 4 },
    bikes: { label: 'Vehicles here', log: true },
    fullness: { label: 'Station fullness / battery range', min: 0, max: 1 },
  },
  defaults: { pitch: 'bikes', velocity: 'delta', duration: 'fullness', families: ['guitar', 'piano'], register: 'mid', rate: 6 },
  start(ctx) {
    const url = UNREACHABLE_GBFS.test(ctx.options.url) ? DOTT_CPH : ctx.options.url;
    let feeds = null;
    let info = null;
    let last = null;
    const interval = 60000;
    ctx.poll(interval, async () => {
      if (!feeds) {
        const g = await ctx.fetchJSON(url);
        const lang = g.data.feeds ? g.data : g.data.en || g.data.da || Object.values(g.data)[0];
        feeds = Object.fromEntries(lang.feeds.map((f) => [f.name, f.url]));
        if (feeds.station_status) {
          const si = await ctx.fetchJSON(feeds.station_information);
          info = new Map(si.data.stations.map((s) => [s.station_id, s]));
        }
      }
      const first = !last;
      const events = feeds.station_status ? await stations(ctx, feeds, info, (last ??= new Map()), first) : await floating(ctx, feeds, (last ??= new Map()), first);
      ctx.spread(first ? events.sort(byLon).slice(0, 80) : events, interval);
      return `${last.size} ${feeds.station_status ? 'stations' : 'vehicles'} · ${first ? 'initial sweep' : events.length + ' changes'}`;
    });
  },
};

async function stations(ctx, feeds, info, last, first) {
  const status = await ctx.fetchJSON(feeds.station_status);
  const events = [];
  for (const s of status.data.stations) {
    const meta = info.get(s.station_id);
    if (!meta) continue;
    const bikes = s.num_bikes_available;
    const prev = last.get(s.station_id);
    last.set(s.station_id, bikes);
    if (!first && (prev === undefined || prev === bikes)) continue;
    const cap = meta.capacity || bikes + (s.num_docks_available || 0) || 1;
    events.push({
      lat: meta.lat, lon: meta.lon, key: s.station_id,
      label: `${meta.name}: ${bikes} bikes${first ? '' : ` (${bikes - prev > 0 ? '+' : ''}${bikes - prev})`}`,
      values: { delta: first ? 0 : bikes - prev, bikes, fullness: Math.min(1, bikes / cap) },
    });
  }
  return events;
}

// Free-floating vehicles: GBFS rotates a vehicle's id after every trip, so an id that appears was
// just parked and an id that vanished was just picked up. The ~1 km cell is the identity.
async function floating(ctx, feeds, last, first) {
  const d = await ctx.fetchJSON(feeds.free_bike_status || feeds.vehicle_status);
  const list = (d.data.bikes || d.data.vehicles || []).filter((b) => b.lat != null && !b.is_disabled);
  const now = new Map(list.map((b) => [b.bike_id ?? b.vehicle_id, b]));
  const perCell = new Map();
  for (const b of list) perCell.set(cell(b.lat, b.lon), (perCell.get(cell(b.lat, b.lon)) || 0) + 1);
  const ev = (b, delta, what) => {
    const key = cell(b.lat, b.lon);
    const range = num(b.current_range_meters);
    return {
      lat: b.lat, lon: b.lon, key,
      label: `${what} · ${perCell.get(key) || 0} vehicles nearby${range !== undefined ? ` · ${Math.round(range / 1000)} km range` : ''}`,
      values: { delta, bikes: perCell.get(key) || 0, fullness: range !== undefined ? Math.min(1, range / 60000) : undefined },
    };
  };
  const events = [];
  if (first) for (const b of list) events.push(ev(b, 0, 'parked'));
  else {
    for (const [id, b] of now) if (!last.has(id)) events.push(ev(b, 1, 'parked'));
    for (const [id, b] of last) if (!now.has(id)) events.push(ev(b, -1, 'picked up'));
  }
  last.clear();
  for (const [id, b] of now) last.set(id, b);
  return events;
}

// ------------------------------------------------------------- Aircraft

// Real ADS-B feeds (adsb.lol, adsb.fi, OpenSky, airplanes.live) all refuse browser requests, so
// this listens to VATSIM: thousands of flight-sim pilots flying live on a shared network, with the
// same callsigns, altitudes and headings — and CORS.
const REGIONS = {
  dk: { label: 'Denmark & around', bbox: [53.5, 4, 59.5, 17.5] },
  europe: { label: 'Europe', bbox: [34, -12, 72, 35] },
  world: { label: 'World', bbox: [-90, -180, 90, 180] },
};

const aircraft = {
  id: 'aircraft',
  name: 'Flight-sim pilots flying live (VATSIM)',
  group: 'World',
  geo: 'nordic',
  home: [55.62, 12.65],
  transport: 'REST · data.vatsim.net (every 15 s)',
  link: 'https://vatsim.dev/api/data-api/get-network-data',
  info: 'Every pilot on the VATSIM flight-simulation network over the chosen region, played as a sweep. Altitude drives pitch, climbing/descending colours the tone. (Real ADS-B feeds block browsers.)',
  options: {
    region: { label: 'Region', type: 'select', choices: Object.entries(REGIONS).map(([k, r]) => [k, r.label]), default: 'europe' },
  },
  fields: {
    alt: { label: 'Altitude ft', min: 0, max: 42000 },
    speed: { label: 'Ground speed kt', min: 0, max: 560 },
    track: { label: 'Heading °', min: 0, max: 360 },
    vrate: { label: 'Vertical rate ft/min', min: -3000, max: 3000 },
  },
  defaults: { pitch: 'alt', velocity: 'speed', duration: 'track', bright: 'vrate', families: ['brass', 'lead', 'reed'], register: 'high', rate: 6 },
  start(ctx) {
    const interval = 30000;
    const lastAlt = new Map();
    let lastTime = 0;
    ctx.poll(interval, async () => {
      const d = await ctx.fetchJSON('https://data.vatsim.net/v3/vatsim-data.json', { timeout: 30000 });
      const [s, w, n, e] = (REGIONS[ctx.options.region] || REGIONS.europe).bbox;
      const now = Date.parse(d.general?.update_timestamp) || Date.now();
      const minutes = lastTime ? (now - lastTime) / 60000 : 0;
      lastTime = now;
      const planes = (d.pilots || []).filter((p) => p.latitude >= s && p.latitude <= n && p.longitude >= w && p.longitude <= e && p.groundspeed > 40);
      const events = planes.map((p) => {
        const prev = lastAlt.get(p.callsign);
        const vrate = prev !== undefined && minutes > 0 ? Math.max(-6000, Math.min(6000, (p.altitude - prev) / minutes)) : 0;
        return {
          lat: p.latitude, lon: p.longitude, key: p.callsign,
          label: `✈ ${p.callsign}${p.flight_plan?.arrival ? ' → ' + p.flight_plan.arrival : ''} ${Math.round(p.altitude)} ft`,
          values: { alt: Math.max(0, p.altitude), speed: p.groundspeed, track: p.heading, vrate },
        };
      });
      lastAlt.clear();
      for (const p of planes) lastAlt.set(p.callsign, p.altitude);
      ctx.spread(events.sort(byLon), interval);
      return `${planes.length} pilots in the air`;
    });
  },
};

export default [energinetGrid, energinetCo2, elpris, dmiWeather, dmiLightning, dmiOcean, openMeteo, airQuality, bikeShare, aircraft];
