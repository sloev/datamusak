// Offline mocks: libraries are vendored (same origin); instrument samples are a
// generated sine wave, and data APIs return small fixtures. Anything else is blocked.
const sine = (() => {
  const n = 4000;
  const b = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / 10) * 8000 * (1 - i / n)), i * 2);
  return b.toString('base64');
})();
const preset = (v) =>
  `var ${v}={zones:[{midi:0,originalPitch:6000,keyRangeLow:0,keyRangeHigh:127,loopStart:0,loopEnd:0,coarseTune:0,fineTune:0,sampleRate:22050,ahdsr:false,sample:'${sine}'}]};`;
const json = (body) => ({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });

const grid = (i) => ({
  Minutes1DK: `2026-10-03T12:${String(i).padStart(2, '0')}:00`, CO2Emission: 90 + i, OffshoreWindPower: 1500, OnshoreWindPower: 1800,
  SolarPower: 120, ProductionGe100MW: 600, ProductionLt100MW: 450, Exchange_Sum: -900, Exchange_DK1_DE: -1200, Exchange_DK2_SE: 500,
});

export const API = {
  'raw.githubusercontent.com/sloev/datamusak/data/grid.json': () => json({ records: Array.from({ length: 60 }, (_, i) => grid(59 - i)) }),
  'api.open-meteo.com': () =>
    json(Array.from({ length: 15 }, (_, i) => ({ current: { temperature_2m: 5 + i, relative_humidity_2m: 80, precipitation: 0, cloud_cover: 40, pressure_msl: 1012, wind_speed_10m: i, wind_direction_10m: 250, wind_gusts_10m: i * 1.5, shortwave_radiation: 150 } }))),
  'earthquake.usgs.gov': () =>
    json({ features: Array.from({ length: 12 }, (_, i) => ({ geometry: { coordinates: [-150 + i * 25, 20, 5 + i * 40] }, properties: { mag: 1 + i / 3, time: i, sig: i * 40, tsunami: 0, place: 'somewhere' } })) }),
};

export async function mockNetwork(page, { api = API, fail = [] } = {}) {
  await page.route(/^https?:\/\/(?!localhost)/, async (route) => {
    const u = route.request().url();
    if (u.includes('webaudiofontdata/sound/')) {
      const key = u.split('/').pop().replace('.js', '');
      return route.fulfill({ contentType: 'text/javascript', body: preset(key.startsWith('128') ? '_drum_' + key.slice(3) : '_tone_' + key) });
    }
    if (fail.some((f) => u.includes(f))) return route.fulfill({ status: 503, body: 'down' });
    for (const [frag, fn] of Object.entries(api)) if (u.includes(frag)) return route.fulfill(fn(u));
    return route.abort();
  });
  // WebSockets / MQTT brokers: refuse by default.
  await page.routeWebSocket(/.*/, (ws) => ws.close());
}

// Enable exactly these sources (and disable the rest) before pressing Start.
export async function onlySources(page, ids) {
  // Set up which sources are on without playing (tapping a tile would also start playback),
  // through the saved settings, then reload.
  await page.evaluate((ids) => {
    const { state } = window.datamusak;
    for (const [id, cfg] of Object.entries(state.sources)) cfg.enabled = ids.includes(id);
    localStorage.setItem('datamusak:v2', JSON.stringify(state));
  }, ids);
  await page.reload();
  await page.locator('.tile').first().waitFor();
}
