import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SOURCES, SOURCE_BY_ID } from '../../js/sources/index.js';
import { defaultMapping, PARAMS } from '../../js/state.js';
import { fakeCtx } from './fake-ctx.js';

test('source definitions are complete and consistent', () => {
  const ids = new Set();
  for (const s of SOURCES) {
    assert.ok(!ids.has(s.id), 'duplicate id ' + s.id);
    ids.add(s.id);
    for (const k of ['name', 'group', 'transport', 'info', 'color']) assert.ok(s[k], `${s.id}.${k}`);
    assert.ok(Math.abs(s.home[0]) <= 90 && Math.abs(s.home[1]) <= 180, s.id);
    assert.equal(typeof s.start, 'function');
    const m = defaultMapping(s);
    for (const p of Object.keys(PARAMS)) {
      assert.ok(m[p].field === 'none' || s.allFields[m[p].field], `${s.id}: ${p} → unknown field ${m[p].field}`);
    }
    if (m.slotMode === 'field') assert.ok(s.allFields[m.slotField], `${s.id}: slotField`);
    assert.ok(m.slots === 'all' || m.slots.every((i) => i >= 0 && i < 8), s.id);
    for (const [k, f] of Object.entries(s.allFields)) {
      assert.ok(f.label, `${s.id}.${k} label`);
      if (f.min !== undefined) assert.ok(f.max > f.min, `${s.id}.${k} range`);
    }
    for (const [k, o] of Object.entries(s.options || {})) {
      if (o.type === 'select') assert.ok(o.choices.some(([v]) => v === o.default), `${s.id}.${k} default`);
    }
  }
});

// Every event must carry finite numbers for declared fields and a position inside the world.
function checkEvents(src, events, { min = 1, geo = true } = {}) {
  assert.ok(events.length >= min, `${src.id}: expected ≥${min} events, got ${events.length}`);
  for (const ev of events) {
    const nums = Object.entries(ev.values).filter(([, v]) => v !== undefined);
    assert.ok(nums.length > 0, `${src.id}: event without values`);
    for (const [k, v] of nums) {
      assert.ok(src.allFields[k], `${src.id}: undeclared field ${k}`);
      assert.ok(Number.isFinite(v), `${src.id}: ${k}=${v}`);
    }
    if (geo) {
      assert.ok(Number.isFinite(ev.lat) && Number.isFinite(ev.lon), `${src.id}: position`);
      assert.ok(Math.abs(ev.lat) <= 90 && Math.abs(ev.lon) <= 180);
    }
  }
}

async function runRest(id, fixtures, opts) {
  const src = SOURCE_BY_ID[id];
  const { ctx, rec } = fakeCtx(src, fixtures);
  src.start(ctx);
  assert.ok(rec.polls.length, `${id} should poll`);
  await rec.runPolls();
  checkEvents(src, rec.events(), opts);
  return rec;
}

const gridRecord = (i) => ({
  Minutes1UTC: `2026-10-03T10:${String(i).padStart(2, '0')}:00`, Minutes1DK: `2026-10-03T12:${String(i).padStart(2, '0')}:00`,
  CO2Emission: 90 + i, ProductionGe100MW: 600, ProductionLt100MW: 450, SolarPower: 120, OffshoreWindPower: 1500, OnshoreWindPower: 1800,
  Exchange_Sum: -900, Exchange_DK1_DE: -1200, Exchange_DK1_NL: 300, Exchange_DK1_GB: null, Exchange_DK1_NO: 700, Exchange_DK1_SE: 200,
  Exchange_DK1_DK2: 400, Exchange_DK2_DE: -300, Exchange_DK2_SE: 500, Exchange_Bornholm_SE: 30,
});

test('energinet grid: one event per component, nulls skipped', async () => {
  const rec = await runRest('energinet-grid', { energidataservice: { records: [gridRecord(1), { ...gridRecord(0), Exchange_DK1_GB: null }] } });
  assert.equal(rec.sequences[0].items.length, 13);
});

test('energinet co2: chronological 60-minute loop', async () => {
  const records = Array.from({ length: 60 }, (_, i) => gridRecord(59 - i));
  const rec = await runRest('energinet-co2', { energidataservice: { records } }, { geo: false });
  const items = rec.sequences[0].items;
  assert.equal(items.length, 60);
  assert.equal(items[0].values.co2, 90);
  assert.equal(items[59].values.minute, 59);
});

test('elpris: DK1 + DK2 per slot, current slot accented', async () => {
  const day = Date.now() - 2 * 3600e3;
  const prices = (k) => Array.from({ length: 96 }, (_, i) => ({
    DKK_per_kWh: k + i / 100, EUR_per_kWh: 0.1, EXR: 7.46,
    time_start: new Date(day + i * 900e3).toISOString(), time_end: new Date(day + (i + 1) * 900e3).toISOString(),
  }));
  const rec = await runRest('elpris', { _DK1: prices(0.5), _DK2: prices(0.7) });
  const items = rec.sequences[0].items;
  assert.equal(items.length, 192);
  assert.equal(items.filter((e) => e.values.isNow === 1).length, 2);
});

const feature = (lon, lat, props) => ({ type: 'Feature', id: Math.random().toString(36), geometry: { type: 'Point', coordinates: [lon, lat] }, properties: props });

test('dmi weather: groups parameters per station, sorted west → east', async () => {
  const rec = await runRest('dmi-weather', {
    metObs: (url) => {
      const p = new URL(url).searchParams.get('parameterId');
      return { features: [feature(12.5, 55.7, { stationId: '06180', parameterId: p, value: 11 }), feature(8.4, 55.5, { stationId: '06080', parameterId: p, value: 9 })] };
    },
  });
  const items = rec.sequences[0].items;
  assert.equal(items.length, 2);
  assert.ok(items[0].lon < items[1].lon);
  assert.equal(Object.keys(items[0].values).length, 8);
});

test('dmi weather: tolerates some parameters failing', async () => {
  let n = 0;
  const rec = await runRest('dmi-weather', {
    metObs: () => {
      if (n++ % 2) throw new Error('HTTP 500');
      return { features: [feature(10, 56, { stationId: 'x', parameterId: 'temp_dry', value: 3 })] };
    },
  });
  assert.equal(rec.sequences[0].items.length, 1);
});

test('dmi lightning: only new strikes, in time order', async () => {
  const src = SOURCE_BY_ID['dmi-lightning'];
  const f1 = { ...feature(10, 56, { amp: -12.3, type: 0, strokes: 2, sensors: 7, observed: '2026-10-03T10:00:02Z' }), id: 'a' };
  const f2 = { ...feature(11, 55, { amp: 40, type: 2, strokes: 1, sensors: 5, observed: '2026-10-03T10:00:01Z' }), id: 'b' };
  const { ctx, rec } = fakeCtx(src, { lightningdata: { features: [f1, f2] } });
  src.start(ctx);
  await rec.runPolls();
  await rec.runPolls();
  assert.equal(rec.spread.length, 2, 'second poll must not repeat strikes');
  assert.equal(rec.spread[0].values.amp, 40);
  checkEvents(src, rec.spread);
});

test('dmi ocean: sea level + water temp per gauge', async () => {
  await runRest('dmi-ocean', {
    sealev_dvr: { features: [feature(10.2, 57.7, { stationId: '20101', parameterId: 'sealev_dvr', value: 23 }), feature(12.6, 55.7, { stationId: '30336', parameterId: 'sealev_dvr', value: -14 })] },
    'parameterId=tw': { features: [feature(10.2, 57.7, { stationId: '20101', parameterId: 'tw', value: 13.1 })] },
  }, { min: 2 });
});

test('open-meteo: one event per town', async () => {
  const cur = { temperature_2m: 12.3, relative_humidity_2m: 81, precipitation: 0, cloud_cover: 75, pressure_msl: 1012.4, wind_speed_10m: 6.1, wind_direction_10m: 240, wind_gusts_10m: 11.2, shortwave_radiation: 210 };
  const rec = await runRest('open-meteo', { 'api.open-meteo.com': Array.from({ length: 15 }, () => ({ current: cur })) });
  assert.equal(rec.sequences[0].items.length, 15);
});

test('sensor.community: merges sensors per location, drops sites outside Denmark', async () => {
  const row = (id, lat, lon, vals) => ({ location: { id, latitude: String(lat), longitude: String(lon), country: 'DK' }, sensordatavalues: vals });
  const rec = await runRest('sensor-community', {
    'data.sensor.community': [
      row(1, 55.68, 12.57, [{ value_type: 'P1', value: '12.5' }, { value_type: 'P2', value: '6.1' }]),
      row(1, 55.68, 12.57, [{ value_type: 'temperature', value: '9.2' }, { value_type: 'humidity', value: '88' }]),
      row(2, 64.1, -21.9, [{ value_type: 'P2', value: '3' }]),
    ],
  });
  const items = rec.sequences[0].items;
  assert.equal(items.length, 1);
  assert.equal(Object.keys(items[0].values).length, 4);
});

test('bike share: initial sweep, then only changes', async () => {
  const src = SOURCE_BY_ID.bikeshare;
  let bikes = 5;
  const { ctx, rec } = fakeCtx(src, {
    'gbfs.json': { data: { en: { feeds: [{ name: 'station_information', url: 'https://x/si.json' }, { name: 'station_status', url: 'https://x/ss.json' }] } } },
    'si.json': { data: { stations: [{ station_id: 'a', name: 'Nørreport', lat: 55.68, lon: 12.57, capacity: 10 }, { station_id: 'b', name: 'Vesterport', lat: 55.67, lon: 12.56 }] } },
    'ss.json': () => ({ data: { stations: [{ station_id: 'a', num_bikes_available: bikes, num_docks_available: 10 - bikes }, { station_id: 'b', num_bikes_available: 2, num_docks_available: 3 }] } }),
  });
  src.start(ctx);
  await rec.runPolls();
  assert.equal(rec.spread.length, 2);
  bikes = 3;
  await rec.runPolls();
  assert.equal(rec.spread.length, 3);
  assert.equal(rec.spread[2].values.delta, -2);
  checkEvents(src, rec.spread);
});

test('aircraft: adsb.lol format, ground altitude handled', async () => {
  await runRest('aircraft', {
    'api.adsb.lol': { ac: [
      { hex: '45ac2d', flight: 'SAS1234 ', lat: 55.6, lon: 12.6, alt_baro: 35000, gs: 450.2, track: 270.1, baro_rate: -64 },
      { hex: '4ca7b8', lat: 55.62, lon: 12.65, alt_baro: 'ground', gs: 12, track: 90 },
      { hex: 'no-pos', alt_baro: 1000 },
    ] },
  }, { min: 2 });
});

test('aircraft: falls back to OpenSky', async () => {
  const rec = await runRest('aircraft', {
    'opensky-network.org': { states: [['45ac2d', 'SAS1234 ', 'Denmark', 0, 0, 12.6, 55.6, 10668, false, 231.5, 270, -0.3]] },
  });
  assert.ok(Math.abs(rec.spread[0].values.alt - 35000) < 10, 'metres converted to feet');
});

test('usgs: chronological with real positions', async () => {
  await runRest('usgs', {
    'earthquake.usgs.gov': { features: [
      { geometry: { coordinates: [-117.5, 35.6, 8.2] }, properties: { mag: 1.2, time: 2, sig: 22, tsunami: 0, place: 'CA' } },
      { geometry: { coordinates: [142.1, 38.3, -1.5] }, properties: { mag: 5.1, time: 1, sig: 400, tsunami: 1, place: 'JP' } },
    ] },
  }, { min: 2 });
});

test('iss: emits a moving position', async () => {
  const rec = await runRest('iss', { wheretheiss: { latitude: 50.1, longitude: 5.3, altitude: 418.2, velocity: 27600, visibility: 'eclipsed' } });
  assert.equal(rec.emitted[0].values.daylight, 0);
});

// ---- push sources: feed sample messages to their handlers

function push(id) {
  const src = SOURCE_BY_ID[id];
  const { ctx, rec } = fakeCtx(src);
  src.start(ctx);
  return { src, ctx, rec };
}

test('ais (digitraffic mqtt): parses location messages and filters', () => {
  const { src, rec } = push('ais');
  assert.match(rec.mqtt[0].url, /^wss:\/\/meri\.digitraffic\.fi/);
  const on = rec.mqtt[0].onMessage;
  on('vessels-v2/230123456/location', JSON.stringify({ time: 1, sog: 12.3, cog: 180.5, navStat: 0, rot: -127, posAcc: true, raim: false, heading: 511, lon: 11.1, lat: 57.2 }));
  on('vessels-v2/230123457/location', JSON.stringify({ time: 1, sog: 0, cog: 0, navStat: 5, rot: 0, heading: 90, lon: 24.9, lat: 60.1 }));
  assert.equal(rec.emitted.length, 1, 'moored ship filtered');
  checkEvents(src, rec.emitted);
});

test('hsl mqtt: parses VP messages', () => {
  const { src, rec } = push('hsl');
  assert.equal(rec.mqtt[0].topics, '/hfp/v2/journey/ongoing/vp/tram/#');
  rec.mqtt[0].onMessage('/hfp/v2/journey/ongoing/vp/tram/0040/00406/1009/1/Länsi-Pasila/12:01/1301110/4/60;24/19/43/68', JSON.stringify({ VP: { desi: '9', dir: '1', spd: 6.2, hdg: 92, lat: 60.17, long: 24.94, acc: 0.3, dl: -45 } }));
  checkEvents(src, rec.emitted);
});

test('finnish trains mqtt', () => {
  const { src, rec } = push('fin-trains');
  rec.mqtt[0].onMessage('train-locations/2026-10-03/45', JSON.stringify({ trainNumber: 45, departureDate: '2026-10-03', timestamp: 'x', location: { type: 'Point', coordinates: [24.9, 60.2] }, speed: 120, accuracy: 5 }));
  checkEvents(src, rec.emitted);
});

test('wikipedia sse: filters by wiki and computes size', () => {
  const { src, rec } = push('wikipedia');
  const on = rec.sse[0].onMessage;
  on({ wiki: 'dawiki', type: 'edit', length: { old: 1200, new: 900 }, bot: false, namespace: 0 });
  on({ wiki: 'enwiki', type: 'edit', length: { old: 1, new: 2 }, bot: false, namespace: 0 });
  on({ wiki: 'dawiki', type: 'log', namespace: 2 });
  on({ wiki: 'dawiki', type: 'new', length: { new: 500 }, bot: true, namespace: 0 });
  assert.equal(rec.emitted.length, 2);
  assert.equal(rec.emitted[0].values.delta, -300);
  checkEvents(src, rec.emitted, { geo: false });
});

test('bluesky jetstream: language filter, no text leaked into values', () => {
  const { src, rec } = push('bluesky');
  const post = (langs, text, extra = {}) => JSON.stringify({ did: 'did:plc:x', kind: 'commit', commit: { operation: 'create', collection: 'app.bsky.feed.post', record: { text, langs, ...extra } } });
  rec.ws[0].onMessage(post(['da'], 'Hej med dig, god weekend!', { facets: [{}], embed: {} }));
  rec.ws[0].onMessage(post(['en'], 'hello'));
  rec.ws[0].onMessage(JSON.stringify({ kind: 'identity' }));
  assert.equal(rec.emitted.length, 1);
  assert.ok(!rec.emitted[0].label.includes('Hej'));
  checkEvents(src, rec.emitted, { geo: false });
});

test('coinbase: subscribes and parses matches', () => {
  const { src, rec } = push('coinbase');
  const sent = [];
  rec.ws[0].onOpen({ send: (m) => sent.push(JSON.parse(m)) });
  assert.deepEqual(sent[0].product_ids, ['BTC-USD']);
  rec.ws[0].onMessage(JSON.stringify({ type: 'match', price: '62000.12', size: '0.0153', side: 'sell' }));
  rec.ws[0].onMessage(JSON.stringify({ type: 'heartbeat' }));
  assert.equal(rec.emitted.length, 1);
  checkEvents(src, rec.emitted, { geo: false });
});

test('bitcoin mempool: parses utx', () => {
  const { src, rec } = push('bitcoin-mempool');
  rec.ws[0].onMessage(JSON.stringify({ op: 'utx', x: { size: 225, vin_sz: 1, vout_sz: 2, out: [{ value: 150000 }, { value: 2500000 }] } }));
  assert.equal(rec.emitted[0].values.btc, 0.0265);
  checkEvents(src, rec.emitted, { geo: false });
});

test('custom mqtt: extracts numbers from json and plain payloads', () => {
  const { src, rec } = push('custom-mqtt');
  assert.equal(rec.mqtt[0].topics, '#');
  rec.mqtt[0].onMessage('home/kitchen/temp', '21.5');
  rec.mqtt[0].onMessage('sensors/x', JSON.stringify({ a: { b: [1, 2, 'x'] }, c: 3 }));
  rec.mqtt[0].onMessage('text/only', 'hello');
  assert.equal(rec.emitted[0].values.value, 21.5);
  assert.equal(rec.emitted[1].values.count, 3);
  assert.equal(rec.emitted[2].values.value, undefined);
  checkEvents(src, rec.emitted, { geo: false });
});
