import { LIBS } from '../lazy.js';

// Helpers handed to every source's start(ctx). Everything registered through
// ctx is torn down automatically when the source is stopped.

export function createRuntime(src, cfg, { emit, setStatus, getBpm }) {
  const disposers = [];
  const timers = new Set();
  const aborts = new Set();
  let stopped = false;
  disposers.push(() => {
    timers.forEach(clearTimeout);
    aborts.forEach((a) => a.abort());
  });

  const ctx = {
    options: cfg.options,
    emit: (ev) => !stopped && emit(ev),
    status: (kind, msg = '') => !stopped && setStatus(kind, msg),
    onStop: (fn) => disposers.push(fn),
    get stopped() {
      return stopped;
    },

    async fetchJSON(url, { timeout = 20000, headers } = {}) {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), timeout);
      aborts.add(ac);
      try {
        const r = await fetch(url, { signal: ac.signal, headers });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return await r.json();
      } finally {
        clearTimeout(t);
        aborts.delete(ac);
      }
    },

    // Run fn now and then every `ms`; failures become a status, not a crash.
    poll(ms, fn) {
      let timer;
      const run = async () => {
        if (stopped) return;
        try {
          const msg = await fn();
          ctx.status('ok', typeof msg === 'string' ? msg : `updated ${new Date().toLocaleTimeString()}`);
        } catch (e) {
          ctx.status('error', explain(e));
        }
        if (!stopped) timer = setTimeout(run, ms);
      };
      ctx.status('connecting');
      run();
      disposers.push(() => clearTimeout(timer));
    },

    // A step sequencer over a list of items (replaceable at any time with seq.set).
    // Slow-changing data becomes a looping, evolving phrase.
    sequence(beats, { loop = true, toEvent = (x) => x } = {}) {
      let items = [];
      let i = 0;
      let timer;
      const tick = () => {
        if (stopped) return;
        if (items.length) {
          if (i >= items.length) i = loop ? 0 : items.length;
          if (i < items.length) ctx.emit(toEvent(items[i++], i - 1, items.length));
        }
        timer = setTimeout(tick, (beats * 60000) / getBpm());
      };
      timer = setTimeout(tick, 50);
      disposers.push(() => clearTimeout(timer));
      return {
        set(next, { restart = false } = {}) {
          items = next;
          if (restart || i >= items.length) i = 0;
        },
        get length() {
          return items.length;
        },
      };
    },

    // Emit a batch of events evenly spread over `ms` (keeps their order).
    spread(events, ms) {
      if (!events.length) return;
      const step = ms / events.length;
      events.forEach((ev, k) => {
        const t = setTimeout(() => {
          timers.delete(t);
          ctx.emit(ev);
        }, k * step);
        timers.add(t);
      });
    },

    // Lazily loaded third-party libraries: 'mqtt' | 'webtorrent'.
    lib: (name) => LIBS[name](),

    // MQTT over WebSockets (mqtt.js, loaded on first use). onMessage(topic, payloadString).
    mqtt(url, topics, onMessage, opts = {}) {
      ctx.status('connecting', url);
      ctx
        .lib('mqtt')
        .then((mqtt) => {
          if (stopped) return;
          const client = mqtt.connect(url, {
            clientId: 'datamusak_' + Math.random().toString(16).slice(2, 10),
            reconnectPeriod: 5000,
            connectTimeout: 15000,
            clean: true,
            ...opts,
          });
          client.on('connect', () => {
            client.subscribe(topics, { qos: 0 }, (err) => {
              if (err) ctx.status('error', 'subscribe failed: ' + err.message);
              else ctx.status('ok', 'subscribed ' + [].concat(topics).join(', '));
            });
          });
          client.on('message', (topic, payload) => {
            try {
              onMessage(topic, payload.toString());
            } catch {}
          });
          client.on('error', (e) => ctx.status('error', explain(e)));
          client.on('offline', () => ctx.status('connecting', 'reconnecting…'));
          disposers.push(() => client.end(true));
        })
        .catch((e) => ctx.status('error', explain(e)));
    },

    // WebSocket with reconnect + backoff.
    // onState(up) replaces the status updates (for sources that pool several sockets).
    ws(url, { onOpen, onMessage, onState }) {
      let sock;
      let retry = 2000;
      let timer;
      const report = onState ? (kind) => onState(kind === 'ok') : (kind, msg) => ctx.status(kind, msg);
      const open = () => {
        if (stopped) return;
        report('connecting', url);
        sock = new WebSocket(url);
        sock.onopen = () => {
          retry = 2000;
          report('ok', 'connected');
          onOpen && onOpen(sock);
        };
        sock.onmessage = (m) => {
          try {
            onMessage(m.data, sock);
          } catch {}
        };
        sock.onerror = () => report('error', 'websocket error');
        sock.onclose = () => {
          if (stopped) return;
          report('connecting', `closed, retrying in ${retry / 1000}s`);
          timer = setTimeout(open, retry);
          retry = Math.min(60000, retry * 2);
        };
      };
      open();
      disposers.push(() => {
        clearTimeout(timer);
        if (sock) {
          sock.onclose = null;
          sock.close();
        }
      });
    },

    // Server-sent events.
    sse(url, onMessage) {
      ctx.status('connecting', url);
      const es = new EventSource(url);
      es.onopen = () => ctx.status('ok', 'streaming');
      es.onerror = () => ctx.status('connecting', 'stream interrupted, retrying…');
      es.onmessage = (m) => {
        try {
          onMessage(JSON.parse(m.data));
        } catch {}
      };
      disposers.push(() => es.close());
    },
  };

  return {
    ctx,
    stop() {
      stopped = true;
      for (const d of disposers.splice(0)) {
        try {
          d();
        } catch {}
      }
    },
  };
}

function explain(e) {
  if (e && e.name === 'AbortError') return 'request timed out';
  if (e instanceof TypeError) return 'network/CORS error — source unreachable from this browser';
  return (e && e.message) || String(e);
}

// Small shared helpers for source modules.
export const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : undefined;
};

export const DK_BBOX = { minLat: 54.4, maxLat: 58.0, minLon: 7.5, maxLon: 15.6 };
export const inDK = (lat, lon) =>
  lat >= DK_BBOX.minLat && lat <= DK_BBOX.maxLat && lon >= DK_BBOX.minLon && lon <= DK_BBOX.maxLon;
