// datamusak service worker.
// - App shell (html/css/js): network-first with revalidation, so a deploy is never mixed with
//   stale files from the HTTP cache; the precached copy is the offline fallback.
// - vendor/ libs and WebAudioFont instrument samples: cache-first (immutable, the heavy stuff).
// - Live data, map tiles, relays: straight to the network (never cached here).
const VERSION = '__VERSION__';
const SHELL = `shell-${VERSION}`;
const STATIC = `vendor-${VERSION}`;
const SAMPLES = 'samples-v1';

const PRECACHE = [
  './', 'index.html', 'manifest.webmanifest', 'css/style.css',
  'assets/icon-192.png', 'assets/map/coast.json', 'stats/sources.json',
  'vendor/leaflet.js', 'vendor/leaflet.css', 'vendor/titan-one.woff2',
  'js/main.js', 'js/engine.js', 'js/scales.js', 'js/audio.js', 'js/midi.js', 'js/map.js',
  'js/viz.js', 'js/state.js', 'js/gm.js', 'js/lazy.js', 'js/instruments.js', 'js/mapping.js', 'js/presence.js', 'js/presets.js', 'js/recorder.js', 'js/smf.js',
  'js/sources/index.js', 'js/sources/runtime.js', 'js/sources/denmark.js', 'js/sources/streams.js',
  'js/sources/nostr.js', 'js/sources/torrent.js', 'js/sources/p2p.js',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' bypasses the HTTP cache, so the precache can't capture files from an older deploy.
  e.waitUntil(
    caches.open(SHELL)
      .then((c) => c.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => /^(shell|vendor|static)-/.test(k) && k !== SHELL && k !== STATIC).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // video needs HTTP range requests; let the browser's own cache handle it
  if (req.destination === 'video' || /\.(mp4|webm)$/.test(url.pathname)) return;
  if (url.hostname === 'surikov.github.io' && url.pathname.includes('/webaudiofontdata/')) {
    e.respondWith(cacheFirst(SAMPLES, req));
  } else if (url.origin === location.origin && url.pathname.includes('/vendor/')) {
    e.respondWith(cacheFirst(STATIC, req));
  } else if (url.origin === location.origin && url.pathname.includes('/assets/')) {
    e.respondWith(cacheFirst(SHELL, req));
  } else if (url.origin === location.origin) {
    e.respondWith(networkFirst(req));
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

async function networkFirst(req) {
  const cache = await caches.open(SHELL);
  try {
    // 'no-cache' = revalidate with the server (cheap 304s), never trust a stale HTTP-cache copy
    // (a navigation Request can't be re-issued with options, so fetch by URL)
    const res = await fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' });
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    throw err;
  }
}
