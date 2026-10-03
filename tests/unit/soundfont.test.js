import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { toneInfo, drumInfo } from '../../js/audio.js';

// load the real WebAudioFont loader (browser script) into a sandbox
const sandbox = { window: {}, console: { log() {} } };
vm.runInNewContext(fs.readFileSync('vendor/WebAudioFontPlayer.js', 'utf8') + ';this.P = WebAudioFontPlayer;', sandbox);
const loader = new sandbox.P().loader;

test('Radio Nabovarme’s original sample sets are used where it had them', () => {
  assert.equal(toneInfo(loader, 12).variable, '_tone_0120_FluidR3_GM_sf2_file'); // marimba (default pick would be Aspirin)
  assert.equal(toneInfo(loader, 35).variable, '_tone_0350_GeneralUserGS_sf2_file');
  assert.equal(toneInfo(loader, 4).variable, '_tone_0040_SBLive_sf2');
  assert.equal(drumInfo(loader, 35).url, 'https://surikov.github.io/webaudiofontdata/sound/12835_17_JCLive_sf2_file.js');
  assert.equal(drumInfo(loader, 40).variable, '_drum_40_1_JCLive_sf2_file');
});

test('every program and drum resolves to a sample file, preferring the original fonts', () => {
  const fonts = ['FluidR3_GM', 'GeneralUserGS', 'SBLive', 'JCLive', 'Chaos', 'Aspirin'];
  let original = 0;
  for (let p = 0; p < 128; p++) {
    const t = toneInfo(loader, p);
    assert.match(t.url, /^https:\/\/surikov\.github\.io\/webaudiofontdata\/sound\/\d{4}_.+\.js$/, String(p));
    if (fonts.some((f) => t.variable.includes(f))) original++;
  }
  assert.ok(original >= 126, `${original}/128 from Radio Nabovarme's fonts`);
  for (const n of [35, 36, 38, 42, 46, 49, 51, 56]) assert.match(drumInfo(loader, n).url, /\/128\d\d_.+\.js$/);
});
