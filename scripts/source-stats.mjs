// Measures every data source the way a visitor experiences it: the real site in real Chromium,
// on the real network (so CORS, blocked hosts and dead APIs all show up), every source on for a
// while. Writes stats/sources.json — status, last message and events per minute per source —
// which the app uses to sort its tiles. Run weekly by .github/workflows/source-stats.yml.
//   node scripts/source-stats.mjs [seconds=120]
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from '@playwright/test';

const SECONDS = Number(process.argv[2] || 120);
const PORT = 8177;
const server = spawn(process.execPath, ['tests/serve.mjs'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ reducedMotion: 'reduce' });
page.on('pageerror', (e) => console.warn('page error:', e.message));
// per-host request outcomes, so a failing source shows *why* (HTTP status, CORS, DNS, refused…)
const hosts = {};
const host = (u) => {
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
};
const note = (u, what) => {
  const h = host(u);
  if (h.startsWith('localhost')) return;
  const e = (hosts[h] ??= {});
  e[what] = (e[what] || 0) + 1;
};
page.on('response', (r) => {
  note(r.url(), `HTTP ${r.status()}`);
  if (r.request().resourceType() === 'fetch' && !r.headers()['access-control-allow-origin']) note(r.url(), 'no CORS header');
});
page.on('requestfailed', (r) => note(r.url(), r.failure()?.errorText || 'failed'));
page.on('websocket', (ws) => {
  note(ws.url(), 'websocket opened');
  ws.on('socketerror', (e) => note(ws.url(), `websocket error: ${e}`));
  ws.on('close', () => note(ws.url(), 'websocket closed'));
});
await page.goto(`http://localhost:${PORT}/`);
await page.waitForFunction(() => window.datamusak);

// every source on (stats are about reachability, not taste)
await page.evaluate(() => {
  for (const tile of document.querySelectorAll('.tile:not(.on) .tile-main')) tile.click();
});
await page.click('#power');
console.log(`listening to every source for ${SECONDS}s…`);
await page.waitForTimeout(SECONDS * 1000);

const result = await page.evaluate(() => {
  const { sources, engine, statusOf } = window.datamusak;
  const out = {};
  for (const s of sources) {
    const st = statusOf.get(s.id) || { kind: 'idle', msg: '' };
    out[s.id] = { status: st.kind, message: (st.msg || '').slice(0, 140), eventsPerMin: engine.eventsPerMinute(s.id) };
  }
  return out;
});
await browser.close();
server.kill();

const stats = { checkedAt: new Date().toISOString(), seconds: SECONDS, sources: result, hosts };
fs.mkdirSync('stats', { recursive: true });
fs.writeFileSync('stats/sources.json', JSON.stringify(stats, null, 2) + '\n');
const rows = Object.entries(result).sort((a, b) => b[1].eventsPerMin - a[1].eventsPerMin);
for (const [id, r] of rows) console.log(`${r.status.padEnd(10)} ${String(r.eventsPerMin).padStart(8)}/min  ${id}  ${r.message}`);
for (const [h, e] of Object.entries(hosts)) console.log(h.padEnd(40), JSON.stringify(e));
