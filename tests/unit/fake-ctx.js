// A stand-in for the runtime ctx that records what a source does,
// so source parsing can be tested against fixture payloads without a network.
import { defaultMapping } from '../../js/state.js';

export function fakeCtx(src, fixtures = {}) {
  const rec = { emitted: [], sequences: [], spread: [], polls: [], mqtt: [], ws: [], sse: [], status: [] };
  const ctx = {
    options: defaultMapping(src).options,
    emit: (ev) => rec.emitted.push(ev),
    status: (kind, msg) => rec.status.push([kind, msg]),
    onStop() {},
    stopped: false,
    async fetchJSON(url) {
      for (const [frag, body] of Object.entries(fixtures)) {
        if (url.includes(frag)) return typeof body === 'function' ? body(url) : structuredClone(body);
      }
      throw new Error('no fixture for ' + url);
    },
    poll(ms, fn) {
      rec.polls.push({ ms, fn });
    },
    sequence() {
      const seq = { items: [], set(items) { seq.items = items; }, get length() { return seq.items.length; } };
      rec.sequences.push(seq);
      return seq;
    },
    spread(events) {
      rec.spread.push(...events);
    },
    mqtt(url, topics, onMessage) {
      rec.mqtt.push({ url, topics, onMessage });
    },
    ws(url, handlers) {
      rec.ws.push({ url, ...handlers });
    },
    sse(url, onMessage) {
      rec.sse.push({ url, onMessage });
    },
  };
  // All events a source produced, whichever helper it used.
  rec.events = () => [...rec.emitted, ...rec.spread, ...rec.sequences.flatMap((s) => s.items)];
  rec.runPolls = async () => {
    for (const p of rec.polls) await p.fn();
  };
  return { ctx, rec };
}
