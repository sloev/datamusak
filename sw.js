// datamusak service worker.
// - App shell: precached, served stale-while-revalidate (instant loads, fresh on the next visit).
// - vendor/ libs and WebAudioFont instrument samples: cache-first (immutable, the heavy stuff).
// - Live data, map tiles, relays: straight to the network (never cached here).
const VERSION = '__VERSION__';
const SHELL = `shell-${VERSION}`;
const STATIC = 'static-v1';
const SAMPLES = 'samples-v1';

const PRECACHE = [
  './', 'index.html', 'manifest.webmanifest', 'css/style.css',
  'assets/logo.svg', 'assets/icon.svg', 'assets/icon-192.png',
  'vendor/leaflet.js', 'vendor/leaflet.css', 'vendor/titan-one.woff2',
  'js/main.js', 'js/engine.js', 'js/normalize.js', 'js/scales.js', 'js/audio.js', 'js/midi.js', 'js/map.js',
  'js/viz.js', 'js/state.js', 'js/gm.js', 'js/lazy.js',
  'js/sources/index.js', 'js/sources/runtime.js', 'js/sources/denmark.js', 'js/sources/streams.js',
  'js/sources/nostr.js', 'js/sources/torrent.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('shell-') && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'surikov.github.io' && url.pathname.includes('/webaudiofontdata/')) {
    e.respondWith(cacheFirst(SAMPLES, req));
  } else if (url.origin === location.origin && url.pathname.includes('/vendor/')) {
    e.respondWith(cacheFirst(STATIC, req));
  } else if (url.origin === location.origin) {
    e.respondWith(staleWhileRevalidate(req, e));
  }
  // everything else: default network behaviour
});

async function cacheFirst(name, req) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
  return res;
}

async function staleWhileRevalidate(req, e) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(req, { ignoreSearch: true });
  const fresh = fetch(req)
    .then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => hit);
  if (hit) {
    e.waitUntil(fresh);
    return hit;
  }
  return fresh;
}
