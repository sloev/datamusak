# datamusak

Live open data from Denmark (and beyond), turned into music right in the browser.

datamusak listens to public data streams and turns every data point into a note. Each data field can drive pitch, velocity, note length, stereo pan and brightness. Every note is snapped to a scale of your choice, played on General MIDI instruments, and drawn on a map, a piano roll and a raw data → MIDI log.

It is a static site with no build step and no server. All data is fetched straight from each provider's CORS-enabled API, WebSocket or MQTT-over-WebSocket broker.

*(This project started life as "Radio Nabovarme", which sonified district-heating meters over a private MQTT broker. That server and its UI have been replaced.)*

## Data sources

| Source | Transport | Where |
|---|---|---|
| Energinet: power grid right now (production + every interconnector) | REST, per minute | 🇩🇰 |
| Energinet: CO₂ & wind, last hour (looping bass line) | REST | 🇩🇰 |
| Electricity spot price today, DK1/DK2 (elprisenligenu.dk) | REST | 🇩🇰 |
| DMI weather stations (metObs, no API key since Dec 2025) | REST | 🇩🇰 |
| DMI lightning strikes | REST | 🇩🇰 |
| DMI sea level / tide gauges | REST | 🇩🇰 |
| Open-Meteo, 15 Danish towns (DMI HARMONIE model) | REST | 🇩🇰 |
| Sensor.Community citizen air-quality sensors | REST | 🇩🇰 |
| Bike share via GBFS (Donkey Republic Copenhagen; any GBFS URL works) | REST | 🇩🇰 |
| Aircraft over Denmark (adsb.lol, OpenSky as fallback) | REST | 🇩🇰 |
| Ships (AIS) via Digitraffic | **MQTT/WSS** | Baltic / Danish straits |
| Helsinki trams/metro/buses (HSL HFP) | **MQTT/WSS** | 🇫🇮 |
| Finnish trains (Digitraffic) | **MQTT/WSS** | 🇫🇮 |
| Wikipedia edits (Danish by default) | SSE | internet |
| Bluesky posts in Danish (Jetstream) | WebSocket | internet |
| Earthquakes, last 24 h (USGS) | REST | world |
| International Space Station position | REST | world |
| Crypto trades (Coinbase) | WebSocket | internet |
| Bitcoin unconfirmed transactions | WebSocket | internet |
| Custom MQTT broker + topic (default: public Mosquitto test broker) | **MQTT/WSS** | anywhere |
| Offline random walk (for testing) | — | — |

Slow data (prices, weather, the grid) plays as a looping step sequence over the latest values, synced to the BPM, so the music changes as new data arrives. Fast streams (ships, edits, posts, trades) trigger notes directly and are thinned out by each source's *max notes/s*.

If a provider is down or doesn't allow browser access, its status dot turns red and the rest keep playing.

## Mapping

For each source:

- **Pitch, velocity, length, pan, brightness**: pick a data field (or a fixed value), set a low/high range, and optionally invert it. Fields with known physical ranges (°C, m/s, MW…) use fixed ranges. Other fields learn their range from recent data (2nd–98th percentile of a rolling window).
- **Pitch** is mapped onto *scale degrees* between the low and high note, so every step lands in the scale.
- **Instruments**: route the source to all slots or a chosen subset. Pick one per note by taking turns, at random, or by a data field.
- **Scale override** and **harmony** (third, fifth, triad, octave…), plus **level**, **max notes/s** and **chance**.

Global settings: BPM, quantize grid, key, scale (22 scales and modes), master, tone (low-pass), reverb, tempo-synced delay, polyphony limit, built-in synth on/off, and **Web MIDI out**. With MIDI out, slot *n* sends on channel *n*, drums on channel 10, brightness as CC74.

Instrument slots are General MIDI programs or a drum kit, each with its own level, pan, octave and mute. Sounds are streamed on demand via [WebAudioFont](https://github.com/surikov/webaudiofont).

## Running locally

ES modules need a web server (not `file://`):

```sh
npm run serve        # or: python3 -m http.server 8000
# open http://localhost:8000
```

## Tests

```sh
npm install
npm run test:unit    # node:test, scales/normalizer/engine + every source parser against fixture payloads
npx playwright install chromium
npm run test:e2e     # Playwright, fully offline: CDNs, samples and APIs are mocked
```

## Deploying

`.github/workflows/ci.yml` runs the tests on every push and pull request. When they pass on `master`, it publishes the site to GitHub Pages (Settings → Pages → Source: GitHub Actions).

## Code layout

```
index.html          page shell (Leaflet, mqtt.js, WebAudioFont from CDNs)
css/style.css
js/main.js          UI wiring
js/engine.js        data event → normalized fields → notes (rate limit, quantize, routing)
js/normalize.js     fixed / auto-learned ranges
js/scales.js        scales and quantization
js/audio.js         WebAudioFont instruments, slot buses, reverb/delay/tone/master
js/midi.js          Web MIDI output
js/map.js           Leaflet map with per-source homes and event pulses
js/viz.js           piano roll and raw log
js/state.js         defaults and localStorage persistence
js/sources/         data sources (runtime helpers: poll, sequence, spread, mqtt, ws, sse)
```

To add a source, export an object like the ones in `js/sources/denmark.js`, with `id`, `name`, `home: [lat, lon]`, `fields`, `defaults` and `start(ctx)`, and call `ctx.emit({ lat, lon, label, values })`.
