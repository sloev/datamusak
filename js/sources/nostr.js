// Nostr: public relays over plain WebSockets (NIP-01, no library needed). High-frequency, global.

const RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net'];

export const hash = (s) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 1000;
};

// Subscribe to the same filter on several relays; each event is delivered once.
export function subscribe(ctx, filter, onEvent) {
  const seen = new Set();
  const order = [];
  for (const url of RELAYS) {
    ctx.ws(url, {
      onOpen: (s) => s.send(JSON.stringify(['REQ', 'dm' + Math.random().toString(36).slice(2, 8), { ...filter, since: Math.floor(Date.now() / 1000), limit: 0 }])),
      onMessage(data) {
        const m = JSON.parse(data);
        if (m[0] !== 'EVENT' || !m[2] || seen.has(m[2].id)) return;
        seen.add(m[2].id);
        order.push(m[2].id);
        if (order.length > 5000) seen.delete(order.shift());
        onEvent(m[2]);
      },
    });
  }
}

const tag = (ev, name) => (ev.tags || []).find((t) => t[0] === name)?.[1];
const countTags = (ev, name) => (ev.tags || []).filter((t) => t[0] === name).length;

// Amount in sats from a BOLT11 invoice's human-readable part (lnbc<amount><multiplier>1…).
export function bolt11Sats(invoice) {
  const m = /^ln(?:bcrt|bc|tbs|tb)(\d+)([munp]?)1/i.exec(invoice || '');
  if (!m) return undefined;
  const mult = { m: 1e-3, u: 1e-6, n: 1e-9, p: 1e-12, '': 1 }[m[2].toLowerCase()];
  return Math.round(Number(m[1]) * mult * 1e8);
}

const B32 = '0123456789bcdefghjkmnpqrstuvwxyz';
export function decodeGeohash(gh) {
  let even = true;
  const lat = [-90, 90];
  const lon = [-180, 180];
  for (const c of (gh || '').toLowerCase()) {
    const v = B32.indexOf(c);
    if (v < 0) return null;
    for (let b = 4; b >= 0; b--) {
      const r = even ? lon : lat;
      const mid = (r[0] + r[1]) / 2;
      if ((v >> b) & 1) r[0] = mid;
      else r[1] = mid;
      even = !even;
    }
  }
  if (!gh) return null;
  return { lat: (lat[0] + lat[1]) / 2, lon: (lon[0] + lon[1]) / 2 };
}

const DA_WORDS = new Set(['ikke', 'jeg', 'og', 'det', 'på', 'hvad', 'hvor', 'også', 'meget', 'godt', 'tak', 'hej', 'bare', 'lige', 'kun', 'nogle', 'være', 'mig', 'dig', 'hvis', 'når', 'skal', 'kan', 'vil', 'har', 'af', 'til', 'med', 'en', 'et', 'den', 'som', 'der']);
export function looksDanish(text) {
  const words = (text || '').toLowerCase().match(/[a-zæøå]+/g) || [];
  if (words.length < 3) return false;
  const hits = new Set(words.filter((w) => DA_WORDS.has(w))).size;
  return hits >= 3 || (hits >= 2 && /[æøå]/i.test(text));
}

function geo(ev) {
  const g = (ev.tags || []).filter((t) => t[0] === 'g').map((t) => t[1]).sort((a, b) => b.length - a.length)[0];
  return g ? decodeGeohash(g) : null;
}

const notes = {
  id: 'nostr-notes',
  name: 'Nostr notes',
  group: 'Nostr',
  geo: 'world',
  home: [57.85, 11.0],
  transport: 'WebSocket · relay.damus.io, nos.lol, relay.primal.net',
  link: 'https://github.com/nostr-protocol/nips/blob/master/01.md',
  info: 'Every new text note on three big public Nostr relays. Notes carrying a geohash pop up where they were posted. Filter to (heuristically) Danish notes or geotagged notes only. Only numbers are used — no text is shown.',
  options: {
    filter: { label: 'Notes', type: 'select', choices: [['all', 'All'], ['da', 'Danish-looking'], ['geo', 'Geotagged only']], default: 'all' },
  },
  fields: {
    chars: { label: 'Characters', min: 0, max: 500, log: true },
    words: { label: 'Words', min: 0, max: 80 },
    hashtags: { label: 'Hashtags', min: 0, max: 5 },
    mentions: { label: 'Mentions', min: 0, max: 5 },
    reply: { label: 'Is reply', min: 0, max: 1 },
    author: { label: 'Author (stable per pubkey)', min: 0, max: 999 },
  },
  defaults: { pitch: 'chars', velocity: 'chars', duration: 'words', bright: 'hashtags', families: 'all', register: 'wide', rate: 5 },
  start(ctx) {
    const mode = ctx.options.filter;
    subscribe(ctx, { kinds: [1] }, (ev) => {
      const pos = geo(ev);
      if (mode === 'geo' && !pos) return;
      if (mode === 'da' && !looksDanish(ev.content)) return;
      const text = ev.content || '';
      ctx.emit({
        ...(pos || {}),
        key: ev.pubkey,
        label: `note ${text.length} chars${pos ? ' 📍' : ''}`,
        values: { chars: text.length, words: text.split(/\s+/).filter(Boolean).length, hashtags: countTags(ev, 't'), mentions: countTags(ev, 'p'), reply: tag(ev, 'e') ? 1 : 0, author: hash(ev.pubkey || '') },
      });
    });
  },
};

const zaps = {
  id: 'nostr-zaps',
  name: 'Nostr zaps (Lightning tips)',
  group: 'Nostr',
  geo: 'virtual',
  home: [56.35, 12.0],
  transport: 'WebSocket · Nostr relays, kind 9735',
  link: 'https://github.com/nostr-protocol/nips/blob/master/57.md',
  info: 'Every Lightning “zap” payment receipt on Nostr. The amount in sats drives loudness and pitch — big zaps ring out.',
  fields: {
    sats: { label: 'Sats', min: 1, max: 100000, log: true },
    comment: { label: 'Comment length', min: 0, max: 140 },
    recipient: { label: 'Recipient (stable per pubkey)', min: 0, max: 999 },
  },
  defaults: { pitch: 'sats', velocity: 'sats', duration: 'sats', bright: 'comment', families: ['chromatic', 'ensemble'], register: 'high', rate: 4 },
  start(ctx) {
    subscribe(ctx, { kinds: [9735] }, (ev) => {
      const sats = bolt11Sats(tag(ev, 'bolt11'));
      if (!sats) return;
      let comment = 0;
      let zapper = '';
      try {
        const req = JSON.parse(tag(ev, 'description') || '{}');
        comment = (req.content || '').length;
        zapper = req.pubkey || '';
      } catch {}
      ctx.emit({ key: zapper || tag(ev, 'p'), label: `⚡ ${sats} sats`, values: { sats, comment, recipient: hash(tag(ev, 'p') || '') } });
    });
  },
};

const firehose = {
  id: 'nostr-firehose',
  name: 'Nostr firehose (all event kinds)',
  group: 'Nostr',
  geo: 'virtual',
  home: [54.3, 11.7],
  transport: 'WebSocket · Nostr relays, every kind',
  link: 'https://github.com/nostr-protocol/nips#event-kinds',
  info: 'Everything flowing through the relays: profiles, notes, reposts, reactions, zaps, long-form articles… The event kind picks the instrument, its size the loudness. A dense, fast texture.',
  fields: {
    kind: { label: 'Event kind', min: 0, max: 40000, log: true },
    bytes: { label: 'Event size bytes', min: 100, max: 20000, log: true },
    tags: { label: 'Tag count', min: 0, max: 30, log: true },
    reaction: { label: 'Is reaction', min: 0, max: 1 },
  },
  defaults: { pitch: 'bytes', velocity: 'bytes', duration: 'tags', bright: 'reaction', families: ['drums', 'percussive', 'sfx'], register: 'wide', rate: 8 },
  start(ctx) {
    subscribe(ctx, {}, (ev) => {
      ctx.emit({ key: ev.pubkey || `kind${ev.kind}`, label: `kind ${ev.kind}`, values: { kind: ev.kind, bytes: JSON.stringify(ev).length, tags: (ev.tags || []).length, reaction: ev.kind === 7 ? 1 : 0 } });
    });
  },
};

export default [notes, zaps, firehose];
