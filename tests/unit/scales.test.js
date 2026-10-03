import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCALES, scaleNotes, quantize, stepInScale, noteName, DRUM_NOTES } from '../../js/scales.js';

test('every scale yields notes only from its pitch classes', () => {
  for (const [id, s] of Object.entries(SCALES)) {
    for (const root of [0, 2, 7, 11]) {
      const notes = scaleNotes(id, root, 36, 84);
      assert.ok(notes.length > 0, id);
      for (const n of notes) assert.ok(s.steps.includes((n - root + 120) % 12), `${id} ${n}`);
    }
  }
});

test('quantize stays in range, is monotonic and hits both ends', () => {
  for (const id of Object.keys(SCALES)) {
    const notes = scaleNotes(id, 2, 45, 81);
    let prev = -1;
    for (let x = 0; x <= 1; x += 0.01) {
      const n = quantize(x, id, 2, 45, 81);
      assert.ok(n >= 45 && n <= 81);
      assert.ok(n >= prev, 'monotonic');
      prev = n;
    }
    assert.equal(quantize(0, id, 2, 45, 81), notes[0]);
    assert.equal(quantize(1, id, 2, 45, 81), notes.at(-1));
  }
});

test('quantize falls back to the middle when no scale note is in range', () => {
  assert.equal(quantize(0.5, 'fifths', 0, 61, 62), 62); // C# and D are not C or G → midpoint 61.5 rounds to 62
});

test('stepInScale moves by scale degrees', () => {
  assert.equal(stepInScale(60, 2, 'major', 0), 64); // C → E
  assert.equal(stepInScale(60, 4, 'major', 0), 67); // C → G
  assert.equal(stepInScale(62, 3, 'minorPentatonic', 2), 69); // D → A in D minor pentatonic
});

test('noteName', () => {
  assert.equal(noteName(60), 'C4');
  assert.equal(noteName(69), 'A4');
  assert.equal(noteName(21), 'A0');
});

test('drum notes are valid GM percussion keys', () => {
  for (const n of DRUM_NOTES) assert.ok(n >= 35 && n <= 81);
});
