// Peer-to-peer sources: other datamusak listeners, and gifshooter painters.
import { presence } from '../presence.js';
import { hash } from './nostr.js';

const listeners = {
  id: 'listeners',
  name: 'Other datamusak listeners',
  group: 'Peer to peer',
  geo: 'virtual',
  home: [56.9, 12.4],
  transport: 'WebRTC · Trystero over Nostr relays',
  link: 'https://github.com/dmotz/trystero',
  info: 'Notes played by everyone else who has datamusak open right now, plus a chime when someone arrives or leaves. Their notes are re-snapped to your scale. Needs “online” switched on in the header.',
  fields: {
    note: { label: 'Their note', min: 24, max: 108 },
    velocity: { label: 'Their velocity', min: 1, max: 127 },
    length: { label: 'Their note length s', min: 0.03, max: 4, log: true },
    peers: { label: 'Listeners online', min: 0, max: 12 },
    arrival: { label: 'Arrival (+1) / departure (−1)', min: -1, max: 1 },
    source: { label: 'Their source (stable per source)', min: 0, max: 999 },
  },
  defaults: { pitch: 'note', velocity: 'velocity', duration: 'length', bright: 'peers', families: 'all', register: 'wide', rate: 6 },
  enabledByDefault: true,
  start(ctx) {
    const off = presence.on((e) => {
      if (e.type === 'count') ctx.status('ok', `${e.peers} other listener${e.peers === 1 ? '' : 's'}`);
      if (e.type === 'join' || e.type === 'leave') {
        ctx.status('ok', `${e.peers} other listener${e.peers === 1 ? '' : 's'}`);
        ctx.emit({ key: e.type, label: e.type === 'join' ? '👋 someone joined' : '👋 someone left', values: { peers: e.peers, arrival: e.type === 'join' ? 1 : -1, note: e.type === 'join' ? 84 : 48, velocity: 90 } });
      }
      if (e.type === 'note') {
        const n = e.note;
        ctx.emit({ key: String(n.s || ''), label: `peer note ${n.n}`, values: { note: n.n, velocity: n.v, length: n.d, peers: e.peers, arrival: 0, source: hash(String(n.s || '')) } });
      }
    });
    ctx.onStop(off);
    ctx.status(presence.connected ? 'ok' : 'idle', presence.connected ? `${presence.peers} other listeners` : 'switch “online” on in the header');
  },
};

// gifshooter (https://sloev.github.io/gifshooter/): collaborative gif painting over the same
// Trystero/Nostr transport. We greet the room as a silent extra "screen" so painters stream
// their cursor to us too; we never draw anything back.
const gifshooter = {
  id: 'gifshooter',
  name: 'gifshooter painters',
  group: 'Peer to peer',
  geo: 'dk',
  home: [55.86, 11.2],
  transport: 'WebRTC · Trystero over Nostr relays (gifshooter-v2)',
  link: 'https://sloev.github.io/gifshooter/',
  info: 'Listens to people painting with animated gifs on a gifshooter canvas. Their cursors are stretched over the map of Denmark, so you see and hear them paint. Pitch follows height on the canvas, speed the loudness; lifting the finger rests.',
  options: {
    room: { label: 'Canvas code', type: 'text', default: 'public' },
  },
  fields: {
    x: { label: 'Cursor x', min: 0, max: 1 },
    y: { label: 'Cursor height (top = high)', min: 0, max: 1 },
    speed: { label: 'Stroke speed', min: 0, max: 0.05, log: true },
    gif: { label: 'Gif (stable per sprite)', min: 0, max: 999 },
    hue: { label: 'Painter colour', min: 0, max: 360 },
    painters: { label: 'Painters seen', min: 0, max: 8 },
  },
  defaults: { pitch: 'y', velocity: 'speed', duration: 'speed', pan: 'x', bright: 'hue', families: ['ethnic', 'chromatic', 'pipe'], register: 'wide', rate: 10 },
  async start(ctx) {
    ctx.status('connecting', 'joining canvas…');
    const { joinRoom } = await ctx.lib('trystero');
    if (ctx.stopped) return;
    const room = joinRoom({ appId: 'gifshooter-v2' }, `canvas:${ctx.options.room || 'public'}`);
    ctx.onStop(() => room.leave());
    const hello = room.makeAction('hello');
    const cursor = room.makeAction('cursor');
    const last = new Map();
    const status = () => ctx.status('ok', `canvas “${ctx.options.room}” · ${last.size} painter${last.size === 1 ? '' : 's'} seen`);
    room.onPeerJoin = (peerId) => {
      hello.send({ role: 'screen' }, { target: peerId }).catch(() => {});
      status();
    };
    room.onPeerLeave = (peerId) => {
      last.delete(peerId);
      status();
    };
    cursor.onMessage = (m, { peerId }) => {
      if (!m || !Number.isFinite(m.x) || !Number.isFinite(m.y)) return;
      const prev = last.get(peerId);
      last.set(peerId, m);
      if (!m.d) return; // only painting strokes make sound
      const speed = prev ? Math.hypot(m.x - prev.x, m.y - prev.y) : 0;
      if (prev?.d && speed < 0.004) return; // a resting finger isn't a melody
      ctx.emit({
        lat: 57.75 - m.y * 3.3,
        lon: 8.1 + m.x * 7.0,
        key: `${peerId}|${m.s ?? ''}`,
        label: `🖌 painter ${String(peerId).slice(0, 4)} ${m.s ?? ''}`,
        values: { x: m.x, y: 1 - m.y, speed, gif: hash(String(m.s ?? '')), hue: Number.isFinite(m.h) ? m.h : undefined, painters: last.size },
      });
    };
    status();
  },
};

export default [listeners, gifshooter];
