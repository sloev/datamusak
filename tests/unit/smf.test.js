import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeMidi } from '../../js/smf.js';

// minimal reader for the writer's own output
function read(bytes) {
  const u32 = (i) => (bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3];
  assert.equal(String.fromCharCode(...bytes.slice(0, 4)), 'MThd');
  assert.equal(u32(4), 6);
  const ppq = (bytes[12] << 8) | bytes[13];
  assert.equal(String.fromCharCode(...bytes.slice(14, 18)), 'MTrk');
  const len = u32(18);
  assert.equal(bytes.length, 22 + len, 'track length matches');
  const events = [];
  let i = 22;
  let t = 0;
  while (i < bytes.length) {
    let d = 0;
    let b;
    do {
      b = bytes[i++];
      d = (d << 7) | (b & 0x7f);
    } while (b & 0x80);
    t += d;
    const st = bytes[i++];
    if (st === 0xff) {
      const type = bytes[i++];
      const l = bytes[i++];
      events.push({ t, meta: type, data: bytes.slice(i, i + l) });
      i += l;
    } else if ((st & 0xf0) === 0xc0) {
      events.push({ t, st, a: bytes[i++] });
    } else {
      events.push({ t, st, a: bytes[i++], b: bytes[i++] });
    }
  }
  return { ppq, events };
}

test('writes a valid format-0 file with tempo, program changes and paired notes', () => {
  const notes = [
    { t: 0, duration: 0.5, note: 60, velocity: 100, channel: 0, program: 12 },
    { t: 0.5, duration: 0.25, note: 64, velocity: 80, channel: 0, program: 12 },
    { t: 0.25, duration: 1, note: 38, velocity: 127, channel: 9, program: 'drums' },
    { t: 1, duration: 0.5, note: 67, velocity: 90, channel: 3, program: 89 },
  ];
  const { ppq, events } = read(writeMidi(notes, { bpm: 120 }));
  assert.equal(ppq, 480);
  const tempo = events.find((e) => e.meta === 0x51);
  assert.equal((tempo.data[0] << 16) | (tempo.data[1] << 8) | tempo.data[2], 500000);
  const pcs = events.filter((e) => (e.st & 0xf0) === 0xc0);
  assert.deepEqual(pcs.map((e) => [e.st & 0x0f, e.a]), [[0, 12], [3, 89]], 'one program change per channel change, none for drums');
  const ons = events.filter((e) => (e.st & 0xf0) === 0x90);
  const offs = events.filter((e) => (e.st & 0xf0) === 0x80);
  assert.equal(ons.length, 4);
  assert.equal(offs.length, 4);
  // at 120 bpm, 0.5 s = 1 beat = 480 ticks
  assert.equal(ons.find((e) => e.a === 64).t, 480);
  assert.equal(offs.find((e) => e.a === 60).t, 480);
  assert.equal(events.at(-1).meta, 0x2f, 'ends with end-of-track');
  for (let k = 1; k < events.length; k++) assert.ok(events[k].t >= events[k - 1].t, 'time-ordered');
});

test('empty recordings are still valid files', () => {
  const { events } = read(writeMidi([], { bpm: 90 }));
  assert.equal(events.at(-1).meta, 0x2f);
});
