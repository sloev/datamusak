import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { bolt11Sats, decodeGeohash, looksDanish } from '../../js/sources/nostr.js';
import { magnetFor } from '../../js/sources/torrent.js';
import { SOURCE_BY_ID } from '../../js/sources/index.js';
import { fakeCtx } from './fake-ctx.js';

test('bolt11 amounts', () => {
  assert.equal(bolt11Sats('lnbc10u1pjxyz'), 1000);
  assert.equal(bolt11Sats('lnbc2500n1pjxyz'), 250);
  assert.equal(bolt11Sats('lnbc1m1pjxyz'), 100000);
  assert.equal(bolt11Sats('LNBC21P1x'), 0);
  assert.equal(bolt11Sats('lnbc1pjxyz'), undefined); // no amount
  assert.equal(bolt11Sats(undefined), undefined);
});

test('geohash decoding', () => {
  const cph = decodeGeohash('u3buz');
  assert.ok(Math.abs(cph.lat - 55.7) < 0.05 && Math.abs(cph.lon - 12.6) < 0.05, JSON.stringify(cph));
  assert.equal(decodeGeohash(''), null);
  assert.equal(decodeGeohash('a!'), null);
});

test('danish heuristic', () => {
  assert.ok(looksDanish('Jeg har det godt, og det er også rart at være her'));
  assert.ok(!looksDanish('GM nostr, have a great day everyone'));
  assert.ok(!looksDanish('og'));
});

const relayEvent = (ev) => JSON.stringify(['EVENT', 'sub', ev]);

test('nostr notes: subscribes on several relays, dedupes, geotags, danish filter, relay count status', () => {
  const src = SOURCE_BY_ID['nostr-notes'];
  const { ctx, rec } = fakeCtx(src);
  src.start(ctx);
  assert.equal(rec.ws.length, 5);
  rec.ws[0].onState(true);
  rec.ws[1].onState(true);
  rec.ws[1].onState(false);
  assert.deepEqual(rec.status.at(-1), ['ok', '1/5 relays'], 'one relay down does not mark the source down');
  const sent = [];
  rec.ws[0].onOpen({ send: (m) => sent.push(JSON.parse(m)) });
  assert.equal(sent[0][0], 'REQ');
  assert.deepEqual(sent[0][2].kinds, [1]);
  assert.equal(sent[0][2].limit, 0);
  const ev = { id: 'a', pubkey: 'p', kind: 1, content: 'hej verden', tags: [['g', 'u3buz'], ['t', 'dk'], ['p', 'x']] };
  rec.ws[0].onMessage(relayEvent(ev));
  rec.ws[1].onMessage(relayEvent(ev));
  rec.ws[2].onMessage(JSON.stringify(['EOSE', 'sub']));
  assert.equal(rec.emitted.length, 1);
  assert.ok(rec.emitted[0].lat > 55);
  assert.equal(rec.emitted[0].values.hashtags, 1);

  const da = fakeCtx(src);
  da.ctx.options.filter = 'da';
  src.start(da.ctx);
  da.rec.ws[0].onMessage(relayEvent({ id: 'b', kind: 1, content: 'good morning everyone', tags: [] }));
  da.rec.ws[0].onMessage(relayEvent({ id: 'c', kind: 1, content: 'jeg synes ikke det er godt', tags: [] }));
  assert.equal(da.rec.emitted.length, 1);
});

test('nostr zaps: amount from bolt11, comment from zap request', () => {
  const src = SOURCE_BY_ID['nostr-zaps'];
  const { ctx, rec } = fakeCtx(src);
  src.start(ctx);
  rec.ws[0].onMessage(relayEvent({ id: 'z', kind: 9735, tags: [['bolt11', 'lnbc210n1abc'], ['p', 'r'], ['description', JSON.stringify({ content: 'tak!' })]] }));
  rec.ws[0].onMessage(relayEvent({ id: 'y', kind: 9735, tags: [] }));
  assert.equal(rec.emitted.length, 1);
  assert.equal(rec.emitted[0].values.sats, 21);
  assert.equal(rec.emitted[0].values.comment, 4);
});

test('nostr firehose: any kind', () => {
  const src = SOURCE_BY_ID['nostr-firehose'];
  const { ctx, rec } = fakeCtx(src);
  src.start(ctx);
  rec.ws[0].onMessage(relayEvent({ id: '1', kind: 7, content: '+', tags: [['e', 'x']] }));
  rec.ws[0].onMessage(relayEvent({ id: '2', kind: 30023, content: 'long', tags: [] }));
  assert.deepEqual(rec.emitted.map((e) => e.values.kind), [7, 30023]);
  assert.equal(rec.emitted[0].values.reaction, 1);
});

test('magnet links carry websocket trackers and a web seed', () => {
  const m = magnetFor('sintel');
  assert.match(m, /xt=urn:btih:08ada5a7a6183aae1e09d831df6748d566095a10/);
  assert.match(m, /tr=wss%3A%2F%2F/);
  assert.match(m, /ws=https%3A%2F%2Fwebtorrent\.io/);
});

test('webtorrent: blocks become events with their position, new peers flagged, cap stops the client', async () => {
  const added = [];
  let destroyed = 0;
  let throttle;
  class FakeClient extends EventEmitter {
    add(magnet) {
      const t = new EventEmitter();
      Object.assign(t, { length: 100e6, downloaded: 0, progress: 0, downloadSpeed: 250000, numPeers: 3, pieces: new Array(100), name: 'Sintel' });
      added.push({ magnet, t });
      return t;
    }
    throttleDownload(n) { throttle = n; }
    destroy() { destroyed++; }
  }
  const src = SOURCE_BY_ID.webtorrent;
  const { ctx, rec } = fakeCtx(src, {}, { webtorrent: FakeClient });
  await src.start(ctx);
  assert.equal(throttle, 300000);
  const { t } = added[0];
  assert.match(added[0].magnet, /^magnet:\?xt=urn:btih:08ada5/);
  const wire = new EventEmitter();
  wire.type = 'webSeed';
  t.emit('wire', wire);
  wire.emit('piece', 50, 0, new Uint8Array(16384));
  assert.equal(rec.emitted.length, 2);
  assert.equal(rec.emitted[0].values.newPeer, 1);
  assert.equal(rec.emitted[1].values.position, 0.5);
  for (const ev of rec.emitted) for (const v of Object.values(ev.values)) assert.ok(Number.isFinite(v));
  t.downloaded = 26e6;
  wire.emit('piece', 51, 0, new Uint8Array(16384));
  assert.equal(destroyed, 1, 'cap reached');
  rec.stops.forEach((f) => f());
});
