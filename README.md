# datamusak

**Live open data from Denmark (and beyond), turned into music in your browser.**

▶ https://sloev.github.io/datamusak/

datamusak listens to public live data: the Danish power grid, DMI weather and lightning, tide gauges, ships, aircraft, Nostr relays, a WebTorrent swarm, people painting in [gifshooter](https://sloev.github.io/gifshooter/), other datamusak listeners, and more. It turns every data point into a note. Each data field can drive pitch, velocity, note length, stereo pan and brightness. Notes snap to a scale of your choice and play on General MIDI instruments (or your own synths over Web MIDI). Everything is drawn live on a map, a piano roll and a raw data → MIDI log.

It's a static site with no server and no build step. It is also an installable PWA.

## How data becomes music

Mapping is **deterministic**: the same data always makes the same sound. Nothing is random, and nothing "learns" ranges.

- **Identity → instrument and register.** Every event carries an identity: a weather station, ship, aircraft, author, topic, cable and so on. The identity picks the instrument from the source's instrument families, plus its own transposition, so ten stations sound like ten different players.
- **Value → melody.** The melody field walks the chosen scale in fine steps (by default the field's physical range in 36 steps). At the edge of the register it bounces back instead of jumping, so small changes like 12.1 → 12.9 °C still move the tune.
- **Other fields → fixed ranges.** Loudness, note length (snapped to musical lengths), left/right and brightness come from fixed physical ranges.
- **Instruments:** each source plays from instrument families: the 16 General MIDI families (Piano, Mallets, Organ, Guitar, Bass, Strings, Ensemble, Brass, Reed, Pipe, Synth lead/pad/FX, Ethnic, Percussive, Sound FX) plus a drum kit, or **ALL 128**. Sounds load on demand and are cached. A mixer sets the level of each family across all sources.

## Features

- **27 live sources**, each a tile. Tap to switch it on; tap ⋯ to choose its instrument families, range (low/mid/high/wide), volume, how busy it may be, and (folded away) which data field drives what.
- **Settings** (⚙): key, 22 scales, tempo, grid, reverb/echo/brightness, the instrument mixer, presets, MIDI out.
- **Presets**: save in the browser, start from built-ins, or **share a link** with the whole setup (`#p=…`).
- **Online**: a peer-to-peer room counts listeners and passes notes between you.
- **Web MIDI out**: each source on its own channel, with program changes; drums on channel 10.
- **Map**: our own vector coastlines from Natural Earth (Denmark at 1:10m), with no tile server and no API key.
- **Installable PWA**, fast and well cached. The app shell is precached; heavy libraries and instrument samples load only when needed.

## Data sources

| Source | Transport | Where |
|---|---|---|
| Energinet: power grid right now (production + every interconnector) | REST, per minute | 🇩🇰 |
| Energinet: CO₂ & wind, last hour (looping bass line) | REST | 🇩🇰 |
| Electricity spot price today, DK1/DK2 (elprisenligenu.dk) | REST | 🇩🇰 |
| DMI weather stations (metObs, no API key) | REST | 🇩🇰 |
| DMI lightning strikes | REST | 🇩🇰 |
| DMI sea level / tide gauges | REST | 🇩🇰 |
| Open-Meteo, 15 Danish towns (DMI HARMONIE model) | REST | 🇩🇰 |
| Sensor.Community citizen air-quality sensors | REST | 🇩🇰 |
| Bike share via GBFS (Donkey Republic Copenhagen; any GBFS URL works) | REST | 🇩🇰 |
| Aircraft over Denmark (adsb.lol, with OpenSky as fallback) | REST | 🇩🇰 |
| Ships (AIS) via Digitraffic | MQTT/WSS | Baltic / Danish straits |
| Helsinki trams/metro/buses (HSL HFP) | MQTT/WSS | 🇫🇮 |
| Finnish trains (Digitraffic) | MQTT/WSS | 🇫🇮 |
| Wikipedia edits (Danish by default) | SSE | internet |
| Bluesky posts in Danish (Jetstream) | WebSocket | internet |
| Earthquakes, last 24 h (USGS) | REST | world |
| International Space Station position | REST | world |
| Crypto trades (Coinbase) | WebSocket | internet |
| Bitcoin unconfirmed transactions | WebSocket | internet |
| Nostr notes (geotagged notes land on the map; optional Danish filter) | Nostr relays | internet |
| Nostr zaps (sats read from the BOLT11 invoice) | Nostr relays | internet |
| Nostr firehose (every event kind) | Nostr relays | internet |
| WebTorrent swarm of a Creative Commons film (each received block is a note) | WebRTC + web seed | internet |
| Other datamusak listeners | WebRTC (Trystero/Nostr) | peers |
| gifshooter painters (strokes drawn over a map of Denmark) | WebRTC (Trystero/Nostr) | peers |
| Custom MQTT broker + topic (default: public Mosquitto test broker) | MQTT/WSS | anywhere |
| Offline random walk (for testing) | — | — |

Slow data (prices, weather, the grid) plays as a looping step sequence over the latest values, synced to the BPM, so the music changes as new data arrives. Fast streams trigger notes directly and are thinned out by each source's *max notes/s*.

If a provider is down or blocks browsers, its status dot turns red and the rest keep playing.

**Privacy note:** "online" and the peer-to-peer sources use WebRTC, so peers in the same room can see each other's IP address. Switch "online" off in the header to stay out of the room.

## Adding a data source

Have an idea? [Open a "New data source" issue](https://github.com/sloev/datamusak/issues/new?template=new-data-source.yml). Or build it yourself:

1. The data must be reachable **from a browser**: a CORS-enabled HTTP API (look for `Access-Control-Allow-Origin`), a WebSocket, MQTT over `wss://`, server-sent events, Nostr, or WebRTC. Keyless and free is strongly preferred, because there is no server to hide keys on.
2. Add an object to one of the files in `js/sources/` (or a new file registered in `js/sources/index.js`):

```js
const harbour = {
  id: 'harbour-temp',                     // unique, stable (used in saved settings and share links)
  name: 'Copenhagen harbour temperature',
  group: 'Denmark',                       // heading in the source list
  geo: 'dk',                              // 'dk' | 'nordic' | 'world' | 'virtual' (not a place)
  home: [55.67, 12.58],                   // map pin
  transport: 'REST · example.org',
  link: 'https://example.org/docs',
  info: 'One or two sentences on what you hear.',
  fields: {                               // numbers that can drive music — give physical ranges
    temp: { label: 'Water °C', min: 0, max: 24, step: 0.5 },  // step: one scale step per 0.5 °C
    flow: { label: 'Flow m³/s', min: 0, max: 400, log: true },
  },
  options: { /* optional user settings: { label, type: 'select' | 'text', choices, default } */ },
  defaults: {
    pitch: 'temp', velocity: 'flow', duration: 'flow',     // which field drives melody/loudness/length/…
    families: ['pipe', 'chromatic'], register: 'mid', rate: 4,
  },
  start(ctx) {
    const seq = ctx.sequence(0.5);        // slow data → a looping phrase (beats per step)
    ctx.poll(60_000, async () => {
      const d = await ctx.fetchJSON('https://example.org/api/latest');
      // `key` is the identity: it picks the instrument and transposition, so give every station its own
      seq.set(d.stations.map((s) => ({ key: s.id, lat: s.lat, lon: s.lon, label: s.name, values: { temp: s.t, flow: s.q } })));
      return `${d.stations.length} stations`;  // shown as the status line
    });
  },
};
```

The `ctx` helpers:

- `poll`, `fetchJSON`, `sequence`, `spread` and `emit` for HTTP data and timing.
- `ws`, `sse` and `mqtt` for push streams.
- `lib('webtorrent' | 'trystero' | 'mqtt')` loads a library lazily.
- `status` sets the status line, and `onStop` registers cleanup.

Everything registered through `ctx` is cleaned up when the source stops.

3. Add a parser test in `tests/unit/sources.test.js` using the fake `ctx` and a real sample payload. The definition checks (fields, defaults, options) and the musical diversity check (`tests/unit/engine.test.js`) run automatically.
4. Run `npm test` and open a PR.

## Development

```sh
npm install
npm run serve          # http://localhost:8000 (ES modules need a server, not file://)
npm run test:unit      # node:test: scales, normalizer, engine, presets, every source parser
npx playwright install chromium
npm run test:e2e       # Playwright, fully offline: samples and APIs are mocked
npm run vendor         # refresh vendor/ after bumping a library
npm run logo           # re-render assets/logo.png and the app icons from the logo shader
npm run map            # rebuild assets/map/coast.json from Natural Earth (world-atlas)
```

CI (`.github/workflows/ci.yml`) runs all tests on every push and pull request. When they pass on `master`, it deploys to GitHub Pages and stamps a fresh service-worker cache version.

### Code layout

```
index.html            page shell
sw.js                 service worker (network-first shell, cache-first vendor libs + samples)
manifest.webmanifest
assets/               logo.png + app icons (rendered by the logo shader), map/coast.json (vector coastlines)
vendor/               self-hosted Leaflet, mqtt.js, WebTorrent, Trystero, WebAudioFont player, Titan One
js/main.js            UI wiring
js/logo.js            the WebGL logo (3D bubble letters, plasma, checkerboards, copper bars, glitch)
js/engine.js          data event → deterministic voice (instrument, note, loudness, length, pan) → audio + MIDI
js/mapping.js         the deterministic mapping maths (identity hash, scale walk with fold, ranges)
js/instruments.js     General MIDI families + drum kit
js/scales.js          scales and quantization
js/audio.js           WebAudioFont instruments loaded on demand, family buses, reverb/echo/tone/master
js/midi.js            Web MIDI output
js/map.js             vector coastline map (no tiles, no key), source homes, event pulses
js/viz.js             piano roll and raw log
js/presets.js         snapshots, built-in presets, share links
js/presence.js        peer-to-peer "online" room
js/state.js           defaults and localStorage persistence
js/lazy.js            on-demand loading of the heavy libraries
js/sources/           data sources + runtime helpers
```

### Design

The look is "early-MTV × 90s demoscene":

- A pure black canvas, with one wild hero (the raymarched 3D logo).
- Acid colours, fat black outlines and hard offset shadows.
- Checkerboards and zigzags.
- Bouncy low-frame-rate motion and a rare VHS glitch.

Everything else stays calm and legible.

*This project began as "Radio Nabovarme", which sonified district-heating meters.*
