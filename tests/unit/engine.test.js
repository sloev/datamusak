import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../../js/engine.js';
import { SOURCES, SOURCE_BY_ID } from '../../js/sources/index.js';
import { loadState, defaultMapping } from '../../js/state.js';
import { SCALES, DRUM_NOTES } from '../../js/scales.js';
import { poolFor, FAMILIES, DRUMS } from '../../js/instruments.js';
import { fold, stepIndex, unit, hash32, REGISTERS } from '../../js/mapping.js';

function setup(id, over = {}, global = {}) {
  const played = [];
  const midiSent = [];
  const state = loadState(SOURCES);
  Object.assign(state.global, { quantize: 'off' }, global);
  Object.assign(state.sources[id], { enabled: true, rate: 1000 }, over);
  const engine = new Engine({ state, audio: { ctx: null, play: (n) => played.push(n) }, midi: { play: (n) => midiSent.push(n) } });
  const out = [];
  engine.on((o) => out.push(o));
  return { engine, state, played, midiSent, out, src: SOURCE_BY_ID[id] };
}

test('fold bounces smoothly and stays in range', () => {
  assert.deepEqual([...Array(12).keys()].map((i) => fold(i, 5)), [0, 1, 2, 3, 4, 3, 2, 1, 0, 1, 2, 3]);
  assert.equal(fold(-1, 5), 1);
  assert.equal(fold(7, 1), 0);
});

test('mapping helpers are pure', () => {
  assert.equal(hash32('a'), hash32('a'));
  assert.notEqual(hash32('a'), hash32('b'));
  assert.equal(unit({ min: 0, max: 10 }, 5), 0.5);
  assert.equal(unit({ min: 0, max: 10 }, 50), 1);
  assert.equal(unit({}, NaN), null);
  const u = unit({}, 12345);
  assert.ok(u >= 0 && u < 1);
  assert.equal(stepIndex({ min: 0, max: 36 }, 10), 10);
  assert.equal(stepIndex({ min: 0, max: 36, step: 2 }, 10), 5);
});

test('the same event always makes the same note', () => {
  const a = setup('dmi-weather');
  const b = setup('dmi-weather');
  const ev = { key: '06180', values: { temp: 11.3, wind: 6, humidity: 80, radiation: 120 }, lat: 55.7, lon: 12.5 };
  const va = a.engine.voice(a.src, a.state.sources['dmi-weather'], ev, { ...ev.values, lat: ev.lat, lon: ev.lon });
  const vb = b.engine.voice(b.src, b.state.sources['dmi-weather'], ev, { ...ev.values, lat: ev.lat, lon: ev.lon });
  assert.deepEqual(va, vb);
  for (let i = 0; i < 5; i++) a.engine.handle(a.src, ev);
  assert.equal(new Set(a.played.map((n) => `${n.program}/${n.note}/${n.velocity}/${n.duration}`)).size, 1);
});

test('notes are in scale, in range, and on a valid instrument', () => {
  const { engine, played, state, src } = setup('dmi-weather', { families: 'all' });
  for (let i = 0; i < 300; i++) engine.handle(src, { key: `st${i % 40}`, values: { temp: -10 + (i % 40), wind: i % 20, humidity: 50 + (i % 50) }, lat: 56, lon: 8 + (i % 7) });
  const steps = SCALES[state.global.scale].steps;
  const [lo, hi] = REGISTERS.wide;
  for (const n of played) {
    if (n.program === DRUMS) assert.ok(DRUM_NOTES.includes(n.note));
    else {
      assert.ok(n.program >= 0 && n.program < 128);
      assert.ok(n.note >= lo && n.note <= hi, String(n.note));
      assert.ok(steps.includes((n.note - state.global.root + 120) % 12));
    }
    assert.ok(n.velocity >= 1 && n.velocity <= 127);
    assert.ok(n.duration > 0);
    assert.ok(n.pan >= -0.8 && n.pan <= 0.8);
  }
});

// The complaint that started this: "a channel was just two notes on the same instrument".
test('every source turns varied data into varied music', () => {
  for (const src of SOURCES) {
    const { engine, played, state } = setup(src.id);
    const cfg = state.sources[src.id];
    const fields = Object.entries(src.allFields).filter(([k]) => k !== 'lat' && k !== 'lon');
    // 60 events from 12 identities with values spread across each field's range
    for (let i = 0; i < 60; i++) {
      const values = {};
      for (const [k, f] of fields) {
        const lo = f.min ?? 1;
        const hi = f.max ?? 1000;
        values[k] = lo + ((hi - lo) * ((i * 7 + k.length * 3) % 60)) / 59;
      }
      const ev = { key: `id${i % 12}`, values, lat: 56 + (i % 5) * 0.3, lon: 9 + (i % 7) * 0.5 };
      played.push(engine.voice(src, cfg, ev, { ...values, lat: ev.lat, lon: ev.lon }));
    }
    const pool = poolFor(cfg.families);
    const programs = new Set(played.map((n) => n.program));
    const notes = new Set(played.map((n) => n.note));
    const velocities = new Set(played.map((n) => n.velocity));
    assert.ok(played.every(Boolean), src.id);
    if (pool.length > 1) assert.ok(programs.size >= Math.min(4, pool.length), `${src.id}: ${programs.size} instruments`);
    assert.ok(notes.size >= 8, `${src.id}: only ${notes.size} different notes`);
    if (cfg.map.velocity !== 'none') assert.ok(velocities.size >= 5, `${src.id}: only ${velocities.size} velocities`);
  }
});

test('ALL uses the whole General MIDI set plus drums', () => {
  const pool = poolFor('all');
  assert.equal(pool.length, 129);
  const { engine, played, src } = setup('custom-mqtt', { families: 'all' });
  for (let i = 0; i < 2000; i++) engine.handle(src, { key: `topic/${i}`, values: { value: i, bytes: 100, count: 1, depth: 2, topic: 0 } });
  const families = new Set(played.map((n) => n.family));
  assert.equal(families.size, FAMILIES.length, 'every family is reachable');
});

test('choosing families restricts instruments; muting a family silences it', () => {
  const { engine, played, src, state } = setup('dmi-weather', { families: ['bass'] });
  for (let i = 0; i < 40; i++) engine.handle(src, { key: `s${i}`, values: { temp: i } });
  assert.ok(played.every((n) => n.program >= 32 && n.program < 40));
  state.global.families.bass.mute = true;
  const before = played.length;
  engine.handle(src, { key: 's1', values: { temp: 3 } });
  assert.equal(played.length, before);
});

test('disabled sources still report events but play nothing', () => {
  const { engine, played, out, src } = setup('dmi-weather', { enabled: false });
  engine.handle(src, { values: { temp: 1 } });
  assert.equal(played.length, 0);
  assert.equal(out.length, 1);
});

test('rate limit caps bursts', () => {
  const { engine, played, src } = setup('dmi-weather', { rate: 2 });
  for (let i = 0; i < 50; i++) engine.handle(src, { key: 'x', values: { temp: i } });
  assert.ok(played.length >= 1 && played.length <= 4, String(played.length));
});

test('quantize snaps note start to the grid; lengths are musical', () => {
  const { engine, played, src } = setup('dmi-weather', {}, { quantize: '1/16', bpm: 120 });
  for (let i = 0; i < 20; i++) engine.handle(src, { key: `k${i}`, values: { temp: i, humidity: i * 4 } });
  for (const n of played) {
    const k = n.when / 0.125;
    assert.ok(Math.abs(k - Math.round(k)) < 1e-6);
    if (n.program !== DRUMS) assert.ok([0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4].some((b) => Math.abs(n.duration - b * 0.5) < 1e-9), String(n.duration));
  }
});

test('built-in synth off still sends MIDI', () => {
  const { engine, played, midiSent, src } = setup('dmi-weather', {}, { internal: false });
  engine.handle(src, { key: 'a', values: { temp: 1 } });
  assert.equal(played.length, 0);
  assert.equal(midiSent.length, 1);
});

test('defaults: every source has valid families, register and fields', () => {
  const ids = new Set(FAMILIES.map((f) => f.id));
  for (const src of SOURCES) {
    const d = defaultMapping(src);
    assert.ok(d.families === 'all' || d.families.every((f) => ids.has(f)), src.id);
    assert.ok(REGISTERS[d.register], src.id);
  }
});
