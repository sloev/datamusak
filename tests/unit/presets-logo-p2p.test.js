import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { SOURCES, SOURCE_BY_ID } from '../../js/sources/index.js';
import { loadState } from '../../js/state.js';
import { snapshot, applySnapshot, encode, decode, presetFromHash, BUILTIN } from '../../js/presets.js';
import { layout, frameUniforms } from '../../js/logo.js';
import { presence } from '../../js/presence.js';
import { fakeCtx } from './fake-ctx.js';

test('a default setup snapshots to (almost) nothing', () => {
  const state = loadState(SOURCES);
  assert.deepEqual(snapshot(state, SOURCES), { v: 2, g: {}, s: {} });
});

test('snapshot → share link → apply restores the setup', async () => {
  const a = loadState(SOURCES);
  a.global.bpm = 133;
  a.global.scale = 'dorian';
  a.global.families.bass.level = 0.3;
  a.sources.elpris.enabled = true;
  a.sources['dmi-weather'].map.pitch = 'wind';
  a.sources['dmi-weather'].families = 'all';
  a.sources.wikipedia.options.wiki = 'all';
  const code = await encode(snapshot(a, SOURCES));
  assert.match(code, /^[\w-]+$/, 'url-safe');
  assert.ok(code.length < 400, `short link (${code.length})`);
  assert.equal(presetFromHash('#p=' + code), code);
  assert.equal(presetFromHash('#other'), null);

  const b = loadState(SOURCES);
  b.global.midiOut = 'my-synth';
  applySnapshot(b, SOURCES, await decode(code));
  assert.equal(b.global.bpm, 133);
  assert.equal(b.global.scale, 'dorian');
  assert.equal(b.global.midiOut, 'my-synth', 'local MIDI port is kept');
  assert.equal(b.global.families.bass.level, 0.3);
  assert.equal(b.global.families.pad.level, 0.9, 'other families keep defaults');
  assert.equal(b.sources.elpris.enabled, true);
  assert.equal(b.sources['dmi-weather'].map.pitch, 'wind');
  assert.equal(b.sources['dmi-weather'].map.velocity, 'wind', 'untouched mapping keeps its default');
  assert.equal(b.sources['dmi-weather'].families, 'all');
  assert.equal(b.sources.wikipedia.options.wiki, 'all');
  assert.deepEqual(snapshot(b, SOURCES), snapshot(a, SOURCES));
});

test('broken links are rejected', async () => {
  await assert.rejects(decode('not-a-preset'));
});

test('built-in presets only reference real sources and enable exactly those', () => {
  for (const p of BUILTIN) {
    for (const id of p.snap.enable || []) assert.ok(SOURCE_BY_ID[id], `${p.name}: ${id}`);
    for (const id of Object.keys(p.snap.s || {})) assert.ok(SOURCE_BY_ID[id], `${p.name}: ${id}`);
    const st = loadState(SOURCES);
    applySnapshot(st, SOURCES, p.snap);
    if (p.snap.enable) {
      const on = SOURCES.filter((s) => st.sources[s.id].enabled).map((s) => s.id).sort();
      assert.deepEqual(on, [...p.snap.enable].sort(), p.name);
    }
  }
});

test('logo: letters are built and the animation loops seamlessly', () => {
  const { letters, segs, width } = layout('DATAMUSAK');
  assert.equal(letters.length, 9);
  assert.ok(segs.length <= 72);
  assert.ok(width > 10 && width < 12.5, String(width));
  for (const l of letters) assert.ok(l.w >= 0.85 && l.w <= 1.0, l.c);
  const a = frameUniforms(letters, 0);
  const b = frameUniforms(letters, 1);
  for (const k of Object.keys(a)) a[k].forEach((v, i) => assert.ok(Math.abs(v - b[k][i]) < 1e-6, `${k}[${i}] ${v} vs ${b[k][i]}`));
  // the domino flip spins each letter exactly once per loop, staggered
  const mid = frameUniforms(letters, 0.15);
  assert.ok(mid.cos[0] < 0, 'first letter is mid-flip');
  assert.ok(mid.cos[8] > 0.99, 'last letter has not started yet');
});

test('gifshooter: greets painters as a screen and plays their strokes', async () => {
  const sent = [];
  const room = { onPeerJoin: null, onPeerLeave: null, leave() {}, actions: {} };
  room.makeAction = (name) => (room.actions[name] = { send: async (d, o) => sent.push([name, d, o]), onMessage: null });
  const src = SOURCE_BY_ID.gifshooter;
  let joined;
  const { ctx, rec } = fakeCtx(src, {}, { trystero: { joinRoom: (cfg, name) => ((joined = [cfg, name]), room) } });
  await src.start(ctx);
  assert.deepEqual(joined, [{ appId: 'gifshooter-v2' }, 'canvas:public']);
  room.onPeerJoin('painter1');
  assert.deepEqual(sent[0], ['hello', { role: 'screen' }, { target: 'painter1' }]);
  const cur = room.actions.cursor.onMessage;
  cur({ x: 0.1, y: 0.1, d: false, s: 'hearts' }, { peerId: 'painter1' }); // hovering: silent
  cur({ x: 0.2, y: 0.2, d: true, s: 'hearts', h: 120 }, { peerId: 'painter1' });
  cur({ x: 0.2005, y: 0.2, d: true, s: 'hearts' }, { peerId: 'painter1' }); // resting finger: silent
  cur({ x: 0.5, y: 0.6, d: true, s: 'planet' }, { peerId: 'painter1' });
  cur({ bogus: 1 }, { peerId: 'x' });
  assert.equal(rec.emitted.length, 2);
  for (const ev of rec.emitted) {
    assert.ok(ev.lat > 54 && ev.lat < 58 && ev.lon > 8 && ev.lon < 15.2, 'painted over Denmark');
    for (const v of Object.values(ev.values)) if (v !== undefined) assert.ok(Number.isFinite(v));
  }
  assert.ok(rec.emitted[1].values.y < rec.emitted[0].values.y, 'lower on the canvas → lower');
});

test('listeners source relays presence events', () => {
  const src = SOURCE_BY_ID.listeners;
  const { ctx, rec } = fakeCtx(src);
  src.start(ctx);
  presence.emit({ type: 'join', peers: 2 });
  presence.emit({ type: 'note', peers: 2, note: { n: 64, v: 90, d: 0.3, s: 'ais' } });
  presence.emit({ type: 'leave', peers: 1 });
  assert.equal(rec.emitted.length, 3);
  assert.deepEqual(rec.emitted.map((e) => e.values.arrival), [1, 0, -1]);
  assert.equal(rec.emitted[1].values.note, 64);
  rec.stops.forEach((f) => f());
  presence.emit({ type: 'join', peers: 3 });
  assert.equal(rec.emitted.length, 3, 'unsubscribed on stop');
});
