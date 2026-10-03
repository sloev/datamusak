// WebTorrent: join a real BitTorrent swarm from the browser (WebRTC peers + HTTP web seed) and
// sonify the download as it happens — every received block is a data point, so this is fast.

const TRACKERS = ['wss://tracker.openwebtorrent.com', 'wss://tracker.webtorrent.dev', 'wss://tracker.btorrent.xyz'];
const FILMS = {
  sintel: ['08ada5a7a6183aae1e09d831df6748d566095a10', 'Sintel', 'sintel.torrent'],
  bbb: ['dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c', 'Big Buck Bunny', 'big-buck-bunny.torrent'],
  tears: ['209c8226b299b308beaf2b9cd3fb49212dbd13ec', 'Tears of Steel', 'tears-of-steel.torrent'],
  cosmos: ['c9e15763f722f23e98a29decdfae341b98d53056', 'Cosmos Laundromat', 'cosmos-laundromat.torrent'],
};

export function magnetFor(id) {
  const [ih, name, file] = FILMS[id] || FILMS.sintel;
  const q = [`xt=urn:btih:${ih}`, `dn=${encodeURIComponent(name)}`, ...TRACKERS.map((t) => `tr=${encodeURIComponent(t)}`)];
  q.push(`ws=${encodeURIComponent('https://webtorrent.io/torrents/')}`, `xs=${encodeURIComponent('https://webtorrent.io/torrents/' + file)}`);
  return 'magnet:?' + q.join('&');
}

const swarm = {
  id: 'webtorrent',
  name: 'WebTorrent swarm (open films)',
  group: 'WebTorrent',
  geo: 'virtual',
  home: [54.95, 8.0],
  transport: 'WebRTC + web seed · WebTorrent',
  link: 'https://webtorrent.io/',
  info: 'Joins the BitTorrent swarm of a Creative Commons film and plays the download: each received block is a note whose pitch is its position in the film, so the melody walks through the movie. New peers ring a bell. Data is kept in memory only and capped.',
  options: {
    film: { label: 'Torrent', type: 'select', choices: Object.entries(FILMS).map(([k, v]) => [k, v[1]]), default: 'sintel' },
    magnet: { label: 'Or any magnet link', type: 'text', default: '' },
    speed: { label: 'Max download', type: 'select', choices: [['100000', '100 KB/s'], ['300000', '300 KB/s'], ['1000000', '1 MB/s']], default: '300000' },
    cap: { label: 'Stop after', type: 'select', choices: [['25', '25 MB'], ['100', '100 MB'], ['500', '500 MB']], default: '25' },
  },
  fields: {
    position: { label: 'Position in torrent', min: 0, max: 1 },
    progress: { label: 'Downloaded so far', min: 0, max: 1 },
    speed: { label: 'Download speed B/s', min: 1000, max: 2000000, log: true },
    peers: { label: 'Connected peers', min: 0, max: 20 },
    newPeer: { label: 'New peer joined', min: 0, max: 1 },
  },
  defaults: { pitch: 'position', velocity: 'speed', duration: 'peers', bright: 'progress', families: ['lead', 'pad', 'chromatic'], register: 'wide', rate: 8 },
  async start(ctx) {
    ctx.status('connecting', 'loading WebTorrent…');
    const WebTorrent = await ctx.lib('webtorrent');
    if (ctx.stopped) return;
    const client = new WebTorrent({ maxConns: 20 });
    ctx.onStop(() => client.destroy());
    client.on('error', (e) => ctx.status('error', String(e.message || e)));
    client.throttleDownload(Number(ctx.options.speed));
    const cap = Number(ctx.options.cap) * 1e6;
    const magnet = ctx.options.magnet?.startsWith('magnet:') ? ctx.options.magnet : magnetFor(ctx.options.film);
    const t = client.add(magnet, { destroyStoreOnDestroy: true });
    t.on('error', (e) => ctx.status('error', String(e.message || e)));
    t.on('metadata', () => ctx.status('ok', `${t.name}: ${(t.length / 1e6).toFixed(0)} MB`));
    const values = (index, newPeer) => ({
      position: t.pieces?.length ? index / t.pieces.length : 0,
      progress: t.progress,
      speed: t.downloadSpeed,
      peers: t.numPeers,
      newPeer,
    });
    // Every block received from any peer (or the HTTP web seed) is a data point.
    t.on('wire', (wire) => {
      const key = wire.type === 'webSeed' ? 'webseed' : String(wire.peerId || wire.remoteAddress || 'peer');
      ctx.emit({ key, label: `peer joined (${wire.type || 'peer'})`, values: values(0, 1) });
      wire.on('piece', (index, offset, buffer) => {
        ctx.emit({ key, label: `piece ${index} +${((buffer?.length || 0) / 1024).toFixed(0)} KB`, values: values(index, 0) });
        if (t.downloaded >= cap) {
          ctx.status('ok', `cap of ${ctx.options.cap} MB reached — stopped`);
          client.destroy();
        }
      });
    });
    const timer = setInterval(() => {
      if (t.length) ctx.status('ok', `${t.numPeers} peers · ${(t.downloaded / 1e6).toFixed(1)} MB · ${(t.downloadSpeed / 1e3).toFixed(0)} KB/s`);
    }, 2000);
    ctx.onStop(() => clearInterval(timer));
  },
};

export default [swarm];
