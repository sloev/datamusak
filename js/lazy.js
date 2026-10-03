// Load heavy third-party code only when it is first needed (all served from vendor/, cached by the service worker).
const loaded = new Map();

export function loadScript(src) {
  if (!loaded.has(src)) {
    loaded.set(
      src,
      new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.async = true;
        s.onload = resolve;
        s.onerror = () => {
          loaded.delete(src);
          reject(new Error('could not load ' + src));
        };
        document.head.append(s);
      }),
    );
  }
  return loaded.get(src);
}

const base = new URL('../vendor/', import.meta.url);

export const LIBS = {
  mqtt: () => loadScript(new URL('mqtt.min.js', base).href).then(() => window.mqtt),
  webtorrent: () => import(new URL('webtorrent.min.js', base).href).then((m) => m.default),
  webaudiofont: () => loadScript(new URL('WebAudioFontPlayer.js', base).href).then(() => window.WebAudioFontPlayer),
};
