import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('every file the service worker precaches exists', () => {
  const sw = fs.readFileSync('sw.js', 'utf8');
  const list = JSON.parse(sw.slice(sw.indexOf('[', sw.indexOf('const PRECACHE')), sw.indexOf('];', sw.indexOf('const PRECACHE')) + 1).replace(/'/g, '"').replace(/,\s*]/, ']'));
  for (const f of list) if (f !== './') assert.ok(fs.existsSync(f), f);
});

test('every js module is precached (so the app works offline)', () => {
  const sw = fs.readFileSync('sw.js', 'utf8');
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]));
  for (const f of walk('js')) assert.ok(sw.includes(`'${f}'`), `${f} missing from PRECACHE`);
});

test('manifest icons exist', () => {
  const m = JSON.parse(fs.readFileSync('manifest.webmanifest', 'utf8'));
  for (const i of m.icons) assert.ok(fs.existsSync(i.src), i.src);
});
