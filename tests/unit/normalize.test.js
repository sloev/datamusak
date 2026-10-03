import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Normalizer } from '../../js/normalize.js';

test('fixed ranges map linearly and clamp', () => {
  const n = new Normalizer();
  const fields = { t: { min: -10, max: 30 } };
  assert.equal(n.value('s', fields, { t: -10 }, 't'), 0);
  assert.equal(n.value('s', fields, { t: 10 }, 't'), 0.5);
  assert.equal(n.value('s', fields, { t: 99 }, 't'), 1);
  assert.equal(n.value('s', fields, { t: -99 }, 't'), 0);
});

test('log ranges compress large values', () => {
  const n = new Normalizer();
  const fields = { b: { min: 0, max: 10000, log: true } };
  const v = n.value('s', fields, { b: 100 }, 'b');
  assert.ok(v > 0.45 && v < 0.55, String(v));
});

test('missing or non-numeric values give null; random gives 0..1', () => {
  const n = new Normalizer();
  assert.equal(n.value('s', {}, {}, 'x'), null);
  assert.equal(n.value('s', {}, { x: NaN }, 'x'), null);
  const r = n.value('s', {}, {}, 'random');
  assert.ok(r >= 0 && r <= 1);
});

test('auto ranges learn from observed data', () => {
  const n = new Normalizer();
  const fields = { p: {} };
  assert.equal(n.value('s', fields, { p: 5 }, 'p'), 0.5); // nothing learned yet
  for (let i = 0; i <= 100; i++) n.observe('s', fields, { p: 1000 + i * 10 });
  assert.ok(n.value('s', fields, { p: 1000 }, 'p') < 0.05);
  assert.ok(n.value('s', fields, { p: 2000 }, 'p') > 0.95);
  const mid = n.value('s', fields, { p: 1500 }, 'p');
  assert.ok(mid > 0.4 && mid < 0.6);
});

test('auto ranges ignore outliers and are per source', () => {
  const n = new Normalizer();
  const fields = { p: {} };
  for (let i = 0; i < 200; i++) n.observe('a', fields, { p: i % 10 });
  n.observe('a', fields, { p: 1e9 });
  assert.ok(n.value('a', fields, { p: 5 }, 'p') > 0.3, 'outlier must not squash the range');
  assert.equal(n.value('b', fields, { p: 5 }, 'p'), 0.5);
  n.reset('a');
  assert.equal(n.value('a', fields, { p: 5 }, 'p'), 0.5);
});

test('constant data maps to the middle', () => {
  const n = new Normalizer();
  for (let i = 0; i < 20; i++) n.observe('s', { p: {} }, { p: 7 });
  assert.equal(n.value('s', { p: {} }, { p: 7 }, 'p'), 0.5);
});
