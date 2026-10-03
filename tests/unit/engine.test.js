import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../../js/engine.js';
import { Normalizer } from '../../js/normalize.js';
import { DEFAULT_GLOBAL, DEFAULT_SLOTS, defaultMapping } from '../../js/state.js';
import { SCALES, DRUM_NOTES } from '../../js/scales.js';

const src = {
  id: 'test',
  fields: { a: { min: 0, max: 100 }, b: { min: 0, max: 1 } },
  defaults: { pitch: 'a', velocity: 'a', duration: 'a', slots: [0], rate: 1000 },
};
src.allFields = { ...src.fields, random: { min: 0, max: 1 } };

function setup(overrides = {}, global = {}) {
  const played = [];
  const midiSent = [];
  const state = {
    global: { ...DEFAULT_GLOBAL, quantize: 'off', ...global },
    slots: DEFAULT_SLOTS.map((s) => ({ ...s, octave: 0 })),
    sources: { test: { ...defaultMapping(src), enabled: true, ...overrides } },
  };
  const audio = { ctx: null, play: (n) => played.push(n) };
  const midi = { play: (n) => midiSent.push(n) };
  const engine = new Engine({ state, audio, midi, normalizer: new Normalizer() });
  const out = [];
  engine.on((o) => out.push(o));
  return { engine, state, played, midiSent, out };
}

test('events become in-scale notes within the pitch range', () => {
  const { engine, played, state } = setup();
  const { lo, hi } = state.sources.test.pitch;
  const steps = SCALES[state.global.scale].steps;
  for (let a = 0; a <= 100; a += 5) engine.handle(src, { values: { a } });
  assert.equal(played.length, 21);
  for (const n of played) {
    assert.ok(n.note >= lo && n.note <= hi, `note ${n.note}`);
    assert.ok(steps.includes((n.note - state.global.root + 120) % 12));
    assert.ok(n.velocity >= 1 && n.velocity <= 127);
    assert.ok(n.duration > 0);
  }
  assert.ok(played[0].note < played.at(-1).note, 'higher value → higher pitch');
});

test('invert flips the mapping', () => {
  const { engine, played, state } = setup();
  state.sources.test.pitch.invert = true;
  engine.handle(src, { values: { a: 0 } });
  engine.handle(src, { values: { a: 100 } });
  assert.ok(played[0].note > played[1].note);
});

test('disabled sources still report events but play nothing', () => {
  const { engine, played, out } = setup({ enabled: false });
  engine.handle(src, { values: { a: 50 } });
  assert.equal(played.length, 0);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].notes, []);
});

test('rate limit caps bursts', () => {
  const { engine, played } = setup({ rate: 2 });
  for (let i = 0; i < 50; i++) engine.handle(src, { values: { a: i } });
  assert.ok(played.length <= 4, `played ${played.length}`);
  assert.ok(played.length >= 1);
});

test('routing: selected slots, all slots, by field', () => {
  let t = setup({ slots: [2, 5], slotMode: 'cycle' });
  for (let i = 0; i < 6; i++) t.engine.handle(src, { values: { a: 50 } });
  assert.deepEqual([...new Set(t.played.map((n) => n.slot))].sort(), [2, 5]);

  t = setup({ slots: 'all', slotMode: 'cycle' });
  for (let i = 0; i < 16; i++) t.engine.handle(src, { values: { a: 50 } });
  assert.equal(new Set(t.played.map((n) => n.slot)).size, DEFAULT_SLOTS.length);

  t = setup({ slots: [0, 1, 2, 3], slotMode: 'field', slotField: 'b' });
  t.engine.handle(src, { values: { a: 50, b: 0 } });
  t.engine.handle(src, { values: { a: 50, b: 1 } });
  assert.deepEqual(t.played.map((n) => n.slot), [0, 3]);

  t = setup({ slots: [] });
  t.engine.handle(src, { values: { a: 50 } });
  assert.equal(t.played.length, 0);
});

test('drum slots play GM drum notes', () => {
  const { engine, played } = setup({ slots: [7] });
  for (let a = 0; a <= 100; a += 10) engine.handle(src, { values: { a } });
  for (const n of played) assert.ok(DRUM_NOTES.includes(n.note));
});

test('harmony adds notes and slot octave shifts', () => {
  const t = setup({ harmony: 'triad' });
  t.engine.handle(src, { values: { a: 50 } });
  assert.equal(t.played.length, 3);
  const t2 = setup();
  t2.state.slots[0].octave = 1;
  t2.engine.handle(src, { values: { a: 50 } });
  const t3 = setup();
  t3.engine.handle(src, { values: { a: 50 } });
  assert.equal(t2.played[0].note - t3.played[0].note, 12);
});

test('polyphony limit', () => {
  const { engine, played } = setup({ durationRange: undefined }, { maxPolyphony: 4 });
  for (let i = 0; i < 20; i++) engine.handle(src, { values: { a: 100 } });
  assert.equal(played.length, 4);
});

test('quantize snaps note start to the grid', () => {
  const { engine, played } = setup({}, { quantize: '1/16', bpm: 120 });
  engine.handle(src, { values: { a: 50 } });
  const grid = 0.125;
  const k = played[0].when / grid;
  assert.ok(Math.abs(k - Math.round(k)) < 1e-6);
});

test('built-in synth off still sends MIDI', () => {
  const { engine, played, midiSent } = setup({}, { internal: false });
  engine.handle(src, { values: { a: 50 } });
  assert.equal(played.length, 0);
  assert.equal(midiSent.length, 1);
});

test('missing field values fall back to the middle of the range', () => {
  const { engine, played } = setup();
  engine.handle(src, { values: {} });
  assert.equal(played.length, 1);
});
