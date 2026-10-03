// Copies the few third-party browser files datamusak uses into vendor/ (served from our own origin,
// precached/cached by the service worker). Run after bumping a dependency: npm run vendor
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const files = {
  'leaflet/dist/leaflet.js': 'leaflet.js',
  'leaflet/dist/leaflet.css': 'leaflet.css',
  'mqtt/dist/mqtt.min.js': 'mqtt.min.js',
  'webtorrent/dist/webtorrent.min.js': 'webtorrent.min.js',
  'webaudiofont/npm/dist/WebAudioFontPlayer.js': 'WebAudioFontPlayer.js',
  '@fontsource/titan-one/files/titan-one-latin-400-normal.woff2': 'titan-one.woff2',
};
fs.mkdirSync('vendor', { recursive: true });
for (const [from, to] of Object.entries(files)) {
  fs.copyFileSync(`node_modules/${from}`, `vendor/${to}`);
  console.log(`vendor/${to}  ${(fs.statSync(`vendor/${to}`).size / 1024).toFixed(0)} KB`);
}

// Trystero (Nostr signalling) is ESM with dependencies: bundle it to one file.
execFileSync('npx', ['esbuild', 'scripts/trystero-entry.js', '--bundle', '--format=esm', '--minify', '--outfile=vendor/trystero-nostr.js'], { stdio: 'inherit' });
