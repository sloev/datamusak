# datamusak

**Live open data from Denmark (and beyond), turned into music in your browser.**

▶ https://sloev.github.io/datamusak/

datamusak listens to public live data: the Danish power grid, DMI weather and lightning, tide gauges, ships, aircraft, Nostr relays, a WebTorrent swarm, people painting in [gifshooter](https://sloev.github.io/gifshooter/), other datamusak listeners, and more. It turns every data point into a note. Each data field can drive pitch, velocity, note length, stereo pan and brightness. Notes snap to a scale of your choice and play on General MIDI instruments (or your own synths over Web MIDI). Everything is drawn live on a map, a piano roll and a raw data → MIDI log.

It's a static site with no server and no build step. It is also an installable PWA.

## Features

- **27 live sources** (see below), each with its own **mapping** from data fields to musical parameters. Ranges are either fixed physical ranges or learned automatically from recent data.
- **22 scales and modes**, set globally or per source, plus optional harmony (third, fifth, triad, octave…).
- **Instrument slots** (General MIDI programs or a drum kit) with level, pan, octave and mute. Each source routes to all slots or a chosen subset, picking one per note by taking turns, at random, or by a data field.
- **Global settings**: BPM, quantize grid, key, scale, tone, reverb, tempo-synced delay, polyphony limit, built-in synth on/off.
- **Web MIDI out**: slot *n* sends on channel *n*, drums on channel 10, brightness as CC74.
- **Presets**: save setups in your browser, start from built-in ones, or **share a link** that holds the whole setup (`#p=…`, compressed).
- **Online**: a peer-to-peer room shows how many people are listening and passes notes between you. The "Other datamusak listeners" source plays them.
- **Settings are saved in your browser** (localStorage) automatically.
- **Installable PWA**, fast and well cached:
  - The app shell is precached.
  - Heavy libraries (MQTT, WebTorrent, Trystero, the sound engine) are self-hosted and only loaded when something needs them.
  - Instrument samples are cached the first time they play.

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
  fields: {                               // numbers that can drive music
    temp: { label: 'Water °C', min: 0, max: 24 },   // fixed range…
    flow: { label: 'Flow', log: true },              // …or learned automatically (log for heavy tails)
  },
  options: { /* optional user settings: { label, type: 'select' | 'text', choices, default } */ },
  defaults: { pitch: 'temp', velocity: 'flow', slots: [1], rate: 4 },
  start(ctx) {
    const seq = ctx.sequence(0.5);        // slow data → a looping phrase (beats per step)
    ctx.poll(60_000, async () => {
      const d = await ctx.fetchJSON('https://example.org/api/latest');
      seq.set(d.stations.map((s) => ({ lat: s.lat, lon: s.lon, label: s.name, values: { temp: s.t, flow: s.q } })));
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

3. Add a parser test in `tests/unit/sources.test.js` using the fake `ctx` and a real sample payload. The definition checks (fields, defaults, options) run automatically.
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
```

CI (`.github/workflows/ci.yml`) runs all tests on every push and pull request. When they pass on `master`, it deploys to GitHub Pages and stamps a fresh service-worker cache version.

### Code layout

```
index.html            page shell
sw.js                 service worker (network-first shell, cache-first vendor libs + samples)
manifest.webmanifest
assets/               logo.png + app icons (rendered by the logo shader)
vendor/               self-hosted Leaflet, mqtt.js, WebTorrent, Trystero, WebAudioFont player, Titan One
js/main.js            UI wiring
js/logo.js            the WebGL logo (3D bubble letters, plasma, checkerboards, copper bars, glitch)
js/engine.js          data event → normalized fields → notes (rate limit, quantize, routing)
js/normalize.js       fixed and auto-learned ranges
js/scales.js          scales and quantization
js/audio.js           WebAudioFont instruments, slot buses, reverb/delay/tone/master
js/midi.js            Web MIDI output
js/map.js             OpenStreetMap (free tiles, no key), source homes, event pulses
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
