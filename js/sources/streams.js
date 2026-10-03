// Push-based live streams: open MQTT-over-WebSocket brokers, WebSockets and server-sent events.
import { num } from './runtime.js';

const hash = (s) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 1000;
};

// Non-geographic sources get a "home" out at sea around Denmark so they are visible on the map.
const SEA = {
  northSea: [56.4, 6.9],
  northSea2: [55.2, 6.6],
  skagerrak: [58.0, 9.6],
  kattegat: [56.75, 11.65],
  baltic: [54.75, 13.6],
  baltic2: [55.25, 15.35],
  kiel: [54.55, 10.6],
  jammer: [57.5, 7.6],
};

// ------------------------------------------------------------ AIS ships

const ships = {
  id: 'ais',
  name: 'Ships (AIS) via Digitraffic MQTT',
  group: 'Nordic',
  geo: 'nordic',
  home: [57.2, 10.9],
  transport: 'MQTT/WSS · meri.digitraffic.fi',
  link: 'https://www.digitraffic.fi/en/marine-traffic/',
  info: 'Live AIS position reports from ships in the Baltic and Danish straits, pushed over an open MQTT broker. Faster ships play higher; the turn rate bends the tone.',
  options: {
    region: { label: 'Region', type: 'select', choices: [['dk', 'Danish waters'], ['all', 'Whole Baltic']], default: 'all' },
    moving: { label: 'Only moving ships', type: 'select', choices: [['yes', 'yes'], ['no', 'no']], default: 'yes' },
  },
  fields: {
    sog: { label: 'Speed knots', min: 0, max: 25 },
    cog: { label: 'Course °', min: 0, max: 360 },
    heading: { label: 'Heading °', min: 0, max: 360 },
    rot: { label: 'Rate of turn', min: -30, max: 30 },
    navStat: { label: 'Navigation status', min: 0, max: 15 },
    vessel: { label: 'Vessel id (stable per ship)', min: 0, max: 999 },
  },
  defaults: { pitch: 'cog', velocity: 'sog', duration: 'sog', bright: 'rot', families: ['pad', 'bass', 'ensemble'], register: 'low', rate: 1.5 },
  enabledByDefault: true,
  start(ctx) {
    const dk = ctx.options.region === 'dk';
    ctx.mqtt('wss://meri.digitraffic.fi:443/mqtt', 'vessels-v2/+/location', (topic, payload) => {
      const p = JSON.parse(payload);
      if (ctx.options.moving === 'yes' && !(p.sog > 0.5)) return;
      if (dk && !(p.lat > 53.8 && p.lat < 58.5 && p.lon > 6 && p.lon < 16)) return;
      const mmsi = topic.split('/')[1];
      ctx.emit({
        lat: p.lat, lon: p.lon, key: mmsi, label: `⚓ ${mmsi} ${p.sog} kn`,
        values: { sog: p.sog, cog: p.cog, heading: p.heading === 511 ? undefined : p.heading, rot: Math.max(-30, Math.min(30, p.rot ?? 0)), navStat: p.navStat, vessel: hash(mmsi) },
      });
    });
  },
};

// ------------------------------------------------------- Helsinki transit

const hsl = {
  id: 'hsl',
  name: 'Helsinki public transport (HSL HFP)',
  group: 'Nordic',
  geo: 'nordic',
  home: [60.17, 24.94],
  transport: 'MQTT/WSS · mqtt.hsl.fi',
  link: 'https://digitransit.fi/en/developers/apis/5-realtime-api/vehicle-positions/high-frequency-positioning/',
  info: 'Every tram (or bus/metro/train/ferry) in Helsinki reports its position once a second over an open MQTT broker. Delay from timetable drives pitch.',
  options: {
    mode: { label: 'Vehicle type', type: 'select', choices: ['tram', 'metro', 'train', 'ferry', 'bus'].map((m) => [m, m]), default: 'tram' },
  },
  fields: {
    speed: { label: 'Speed m/s', min: 0, max: 20 },
    heading: { label: 'Heading °', min: 0, max: 360 },
    delay: { label: 'Delay s', min: -120, max: 300 },
    accel: { label: 'Acceleration m/s²', min: -2, max: 2 },
    line: { label: 'Line (stable per line)', min: 0, max: 999 },
  },
  defaults: { pitch: 'heading', velocity: 'speed', duration: 'delay', bright: 'accel', families: ['drums', 'percussive'], register: 'mid', rate: 5 },
  start(ctx) {
    ctx.mqtt('wss://mqtt.hsl.fi:443/', `/hfp/v2/journey/ongoing/vp/${ctx.options.mode}/#`, (topic, payload) => {
      const v = JSON.parse(payload).VP;
      if (!v || v.lat == null) return;
      ctx.emit({
        lat: v.lat, lon: v.long, key: `${v.oper}/${v.veh}`, label: `${ctx.options.mode} ${v.desi} ${v.spd} m/s`,
        values: { speed: v.spd, heading: v.hdg, delay: -v.dl, accel: v.acc, line: hash(String(v.desi)) },
      });
    });
  },
};

const finTrains = {
  id: 'fin-trains',
  name: 'Finnish trains (Digitraffic MQTT)',
  group: 'Nordic',
  geo: 'nordic',
  home: [61.5, 23.8],
  transport: 'MQTT/WSS · rata.digitraffic.fi',
  link: 'https://www.digitraffic.fi/en/railway-traffic/',
  info: 'GPS positions of every train in Finland, pushed over MQTT. Speed drives pitch.',
  fields: {
    speed: { label: 'Speed km/h', min: 0, max: 220 },
    train: { label: 'Train number (stable)', min: 0, max: 999 },
    accuracy: { label: 'GPS accuracy m', min: 0, max: 50 },
  },
  defaults: { pitch: 'speed', velocity: 'speed', duration: 'speed', families: ['organ', 'reed'], register: 'mid', rate: 3 },
  start(ctx) {
    ctx.mqtt('wss://rata.digitraffic.fi:443/mqtt', 'train-locations/#', (topic, payload) => {
      const p = JSON.parse(payload);
      const [lon, lat] = p.location?.coordinates || [];
      if (lat == null) return;
      ctx.emit({ lat, lon, key: String(p.trainNumber), label: `🚆 ${p.trainNumber} ${p.speed} km/h`, values: { speed: p.speed, train: p.trainNumber % 1000, accuracy: p.accuracy } });
    });
  },
};

// ---------------------------------------------------------- Wikipedia

const wikipedia = {
  id: 'wikipedia',
  name: 'Wikipedia edits (Danish by default)',
  group: 'Internet',
  geo: 'virtual',
  home: SEA.kattegat,
  transport: 'SSE · stream.wikimedia.org',
  link: 'https://wikitech.wikimedia.org/wiki/Event_Platform/EventStreams',
  info: 'Every edit to Danish Wikipedia as it happens. Bigger edits are louder; removals play low, additions high. Switch to all wikis for a torrent.',
  options: {
    wiki: { label: 'Wiki', type: 'select', choices: [['dawiki', 'Danish Wikipedia'], ['svwiki', 'Swedish'], ['nowiki', 'Norwegian'], ['enwiki', 'English'], ['wikidatawiki', 'Wikidata'], ['all', 'All wikis']], default: 'dawiki' },
  },
  fields: {
    delta: { label: 'Bytes changed (signed)', min: -2000, max: 2000, log: true },
    size: { label: 'Bytes changed', min: 0, max: 5000, log: true },
    length: { label: 'Article length', min: 0, max: 100000, log: true },
    bot: { label: 'Bot edit', min: 0, max: 1 },
    namespace: { label: 'Namespace', min: 0, max: 15 },
  },
  defaults: { pitch: 'delta', velocity: 'size', duration: 'length', bright: 'bot', families: ['piano', 'drums', 'chromatic'], register: 'wide', rate: 6 },
  enabledByDefault: true,
  start(ctx) {
    const wiki = ctx.options.wiki;
    ctx.sse('https://stream.wikimedia.org/v2/stream/recentchange', (e) => {
      if (wiki !== 'all' && e.wiki !== wiki) return;
      if (e.type !== 'edit' && e.type !== 'new') return;
      const delta = (e.length?.new || 0) - (e.length?.old || 0);
      ctx.emit({ key: e.user || e.title || e.wiki, label: `${e.wiki}: ${delta > 0 ? '+' : ''}${delta} bytes`, values: { delta, size: Math.abs(delta), length: e.length?.new || 0, bot: e.bot ? 1 : 0, namespace: e.namespace } });
    });
  },
};

// ------------------------------------------------------------- Bluesky

const bluesky = {
  id: 'bluesky',
  name: 'Bluesky posts in Danish',
  group: 'Internet',
  geo: 'virtual',
  home: SEA.skagerrak,
  transport: 'WebSocket · Bluesky Jetstream',
  link: 'https://docs.bsky.app/blog/jetstream',
  info: 'Every new Bluesky post tagged with the chosen language. Longer posts are longer notes; links and hashtags brighten the sound. Only numbers are used — no text is shown.',
  options: {
    lang: { label: 'Language', type: 'select', choices: [['da', 'Danish'], ['sv', 'Swedish'], ['no', 'Norwegian'], ['de', 'German'], ['en', 'English'], ['all', 'All']], default: 'da' },
  },
  fields: {
    chars: { label: 'Characters', min: 0, max: 300 },
    words: { label: 'Words', min: 0, max: 60 },
    tags: { label: 'Hashtags + links + mentions', min: 0, max: 5 },
    media: { label: 'Has image/video/link card', min: 0, max: 1 },
    reply: { label: 'Is reply', min: 0, max: 1 },
  },
  defaults: { pitch: 'chars', velocity: 'words', duration: 'chars', bright: 'tags', families: ['guitar', 'ethnic', 'piano'], register: 'mid', rate: 4 },
  enabledByDefault: true,
  start(ctx) {
    const lang = ctx.options.lang;
    ctx.ws('wss://jetstream2.us-east.bsky.network/subscribe?wantedCollections=app.bsky.feed.post', {
      onMessage(data) {
        const m = JSON.parse(data);
        if (m.kind !== 'commit' || m.commit?.operation !== 'create') return;
        const r = m.commit.record || {};
        if (lang !== 'all' && !(r.langs || []).some((l) => l.toLowerCase().startsWith(lang))) return;
        const text = r.text || '';
        ctx.emit({
          key: m.did,
          label: `post ${text.length} chars`,
          values: { chars: text.length, words: text.split(/\s+/).filter(Boolean).length, tags: (r.facets || []).length, media: r.embed ? 1 : 0, reply: r.reply ? 1 : 0 },
        });
      },
    });
  },
};

// -------------------------------------------------------------- Global

const earthquakes = {
  id: 'usgs',
  name: 'Earthquakes worldwide, last 24 h (USGS)',
  group: 'World',
  geo: 'world',
  home: SEA.northSea,
  transport: 'REST · earthquake.usgs.gov GeoJSON',
  link: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php',
  info: 'The last day of earthquakes on Earth, replayed in order as a loop. Magnitude drives loudness, depth drives pitch (deep quakes play low).',
  fields: {
    mag: { label: 'Magnitude', min: -0.5, max: 7 },
    depth: { label: 'Depth km', min: 0, max: 700, log: true },
    sig: { label: 'Significance', min: 0, max: 1000 },
    tsunami: { label: 'Tsunami flag', min: 0, max: 1 },
  },
  defaults: { pitch: 'depth', velocity: 'mag', duration: 'mag', bright: 'sig', families: ['bass', 'percussive', 'ensemble'], register: 'low', rate: 6 },
  start(ctx) {
    const seq = ctx.sequence(0.25);
    ctx.poll(5 * 60000, async () => {
      const d = await ctx.fetchJSON('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson');
      const items = d.features
        .sort((a, b) => a.properties.time - b.properties.time)
        .map((f) => {
          const [lon, lat, depth] = f.geometry.coordinates;
          const p = f.properties;
          return { lat, lon, key: (p.place || '').split(', ').pop() || p.net, label: `M${p.mag} ${p.place || ''}`, values: { mag: p.mag, depth: Math.max(0, depth), sig: p.sig, tsunami: p.tsunami } };
        });
      seq.set(items);
      return `${items.length} quakes`;
    });
  },
};

const iss = {
  id: 'iss',
  name: 'International Space Station',
  group: 'World',
  geo: 'world',
  home: SEA.northSea2,
  transport: 'REST · api.wheretheiss.at',
  link: 'https://wheretheiss.at/w/developer',
  info: 'The ISS position every 5 s. Pitch rises as it gets closer to Copenhagen; it sounds brighter in daylight than in Earth’s shadow.',
  fields: {
    distance: { label: 'Closeness to Copenhagen (20000 − km)', min: 0, max: 20000 },
    lat: { label: 'Latitude', min: -52, max: 52 },
    altitude: { label: 'Altitude km', min: 400, max: 430 },
    daylight: { label: 'In daylight', min: 0, max: 1 },
  },
  defaults: { pitch: 'distance', velocity: 'altitude', duration: 'altitude', bright: 'daylight', families: ['pad', 'fx'], register: 'high', rate: 1 },
  start(ctx) {
    ctx.poll(5000, async () => {
      const d = await ctx.fetchJSON('https://api.wheretheiss.at/v1/satellites/25544');
      const distance = haversine(d.latitude, d.longitude, 55.68, 12.57);
      ctx.emit({ lat: d.latitude, lon: d.longitude, label: `ISS ${Math.round(distance)} km away`, values: { distance: 20000 - distance, altitude: d.altitude, daylight: d.visibility === 'daylight' ? 1 : 0 } });
      return `${Math.round(distance)} km from Copenhagen`;
    });
  },
};

const coinbase = {
  id: 'coinbase',
  name: 'Crypto trades (Coinbase)',
  group: 'Internet',
  geo: 'virtual',
  home: SEA.baltic2,
  transport: 'WebSocket · ws-feed.exchange.coinbase.com',
  link: 'https://docs.cdp.coinbase.com/exchange/docs/websocket-overview',
  info: 'Every matched trade on a Coinbase market. Buys play higher than sells; trade size drives loudness.',
  options: {
    product: { label: 'Market', type: 'select', choices: ['BTC-USD', 'ETH-USD', 'SOL-USD', 'BTC-EUR', 'DOGE-USD'].map((p) => [p, p]), default: 'BTC-USD' },
  },
  fields: {
    price: { label: 'Price' },
    size: { label: 'Trade size', log: true },
    side: { label: 'Side (0 sell, 1 buy)', min: 0, max: 1 },
    move: { label: 'Price move vs previous', min: -1, max: 1 },
  },
  defaults: { pitch: 'price', velocity: 'size', duration: 'size', bright: 'side', families: ['drums', 'lead'], register: 'mid', rate: 5 },
  start(ctx) {
    let last;
    ctx.ws('wss://ws-feed.exchange.coinbase.com', {
      onOpen: (s) => s.send(JSON.stringify({ type: 'subscribe', product_ids: [ctx.options.product], channels: ['matches'] })),
      onMessage(data) {
        const m = JSON.parse(data);
        if (m.type !== 'match') return;
        const price = num(m.price);
        const move = last === undefined ? 0 : Math.sign(price - last);
        last = price;
        ctx.emit({ key: m.side, label: `${m.side} ${m.size} @ ${m.price}`, values: { price, size: num(m.size), side: m.side === 'buy' ? 1 : 0, move } });
      },
    });
  },
};

const bitcoinTx = {
  id: 'bitcoin-mempool',
  name: 'Bitcoin unconfirmed transactions',
  group: 'Internet',
  geo: 'virtual',
  home: SEA.baltic,
  transport: 'WebSocket · mempool.space',
  link: 'https://mempool.space/docs/api/websocket',
  info: 'Each new Bitcoin transaction entering the mempool. Value moved drives pitch, the number of inputs/outputs the length; the sending address picks the instrument.',
  fields: {
    btc: { label: 'BTC moved', log: true },
    inputs: { label: 'Inputs', min: 1, max: 20, log: true },
    outputs: { label: 'Outputs', min: 1, max: 20, log: true },
    bytes: { label: 'Size vbytes', min: 100, max: 3000, log: true },
    feeRate: { label: 'Fee rate sat/vB', min: 1, max: 200, log: true },
  },
  defaults: { pitch: 'btc', velocity: 'bytes', duration: 'outputs', bright: 'feeRate', families: ['chromatic', 'fx'], register: 'high', rate: 3 },
  start(ctx) {
    ctx.ws('wss://mempool.space/api/v1/ws', {
      onOpen: (s) => s.send(JSON.stringify({ 'track-mempool': true })),
      onMessage(data) {
        const added = JSON.parse(data)['mempool-transactions']?.added || [];
        for (const x of added) {
          const btc = (x.vout || []).reduce((s, o) => s + (o.value || 0), 0) / 1e8;
          const vbytes = x.weight ? x.weight / 4 : x.size;
          ctx.emit({
            key: x.vin?.[0]?.prevout?.scriptpubkey_address || x.txid,
            label: `tx ${btc.toFixed(4)} BTC`,
            values: { btc, inputs: x.vin?.length || 1, outputs: x.vout?.length || 1, bytes: vbytes, feeRate: vbytes && x.fee !== undefined ? x.fee / vbytes : undefined },
          });
        }
      },
    });
  },
};

// -------------------------------------------------------------- Custom

const customMqtt = {
  id: 'custom-mqtt',
  name: 'Custom MQTT broker',
  group: 'Custom',
  geo: 'virtual',
  home: SEA.jammer,
  transport: 'MQTT/WSS · any broker',
  link: 'https://test.mosquitto.org/',
  info: 'Point at any MQTT-over-WebSocket broker and topic. Numbers are pulled out of the payload automatically (plain numbers or JSON). The default listens to everything on the public Mosquitto test broker — a chaotic window onto hobby IoT around the world.',
  options: {
    url: { label: 'Broker URL (wss://)', type: 'text', default: 'wss://test.mosquitto.org:8081' },
    topic: { label: 'Topic', type: 'text', default: '#' },
  },
  fields: {
    value: { label: 'First number in payload' },
    count: { label: 'How many numbers', min: 0, max: 20 },
    bytes: { label: 'Payload bytes', log: true },
    depth: { label: 'Topic depth', min: 1, max: 8 },
    topic: { label: 'Topic (stable per topic)', min: 0, max: 999 },
  },
  defaults: { pitch: 'value', velocity: 'bytes', duration: 'count', bright: 'depth', families: 'all', register: 'wide', rate: 4 },
  start(ctx) {
    ctx.mqtt(ctx.options.url, ctx.options.topic, (topic, payload) => {
      const nums = [];
      try {
        collect(JSON.parse(payload), nums);
      } catch {
        const n = parseFloat(payload);
        if (Number.isFinite(n)) nums.push(n);
      }
      ctx.emit({
        key: topic,
        label: `${topic.slice(0, 48)} = ${payload.slice(0, 32)}`,
        values: { value: nums[0], count: nums.length, bytes: payload.length, depth: topic.split('/').length, topic: hash(topic) },
      });
    });
  },
};

function collect(v, out) {
  if (out.length > 32) return;
  if (typeof v === 'number' && Number.isFinite(v)) out.push(v);
  else if (v && typeof v === 'object') for (const k in v) collect(v[k], out);
}

const randomWalk = {
  id: 'random-walk',
  name: 'Offline test signal',
  group: 'Custom',
  geo: 'virtual',
  home: SEA.kiel,
  transport: 'generated in the browser',
  info: 'No network needed — a deterministic wandering signal, handy for trying out instruments and mappings.',
  fields: {
    walk: { label: 'Wandering line', min: 0, max: 1 },
    noise: { label: 'Chaos', min: 0, max: 1 },
    step: { label: 'Step in bar', min: 0, max: 15 },
  },
  defaults: { pitch: 'walk', velocity: 'noise', duration: 'noise', pan: 'walk', families: ['piano', 'chromatic'], register: 'mid', rate: 8 },
  start(ctx) {
    // deterministic: two slow sines and a chaotic logistic map, so every run sounds the same
    let n = 0;
    let chaos = 0.37;
    const seq = ctx.sequence(0.25, {
      toEvent: (step) => {
        n++;
        chaos = 3.91 * chaos * (1 - chaos);
        const walk = 0.5 + 0.35 * Math.sin(n * 0.21) + 0.15 * Math.sin(n * 0.047);
        return { key: `voice${step % 4}`, label: `signal ${walk.toFixed(2)}`, values: { walk, noise: chaos, step } };
      },
    });
    seq.set([...Array(16).keys()]);
    ctx.status('ok', 'generating');
  },
};

function haversine(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}

export default [ships, hsl, finTrains, wikipedia, bluesky, earthquakes, iss, coinbase, bitcoinTx, customMqtt, randomWalk];
