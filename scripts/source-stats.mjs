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

const stats = { checkedAt: new Date().toISOString(), seconds: SECONDS, sources: result };
fs.mkdirSync('stats', { recursive: true });
fs.writeFileSync('stats/sources.json', JSON.stringify(stats, null, 2) + '\n');
const rows = Object.entries(result).sort((a, b) => b[1].eventsPerMin - a[1].eventsPerMin);
for (const [id, r] of rows) console.log(`${r.status.padEnd(10)} ${String(r.eventsPerMin).padStart(8)}/min  ${id}  ${r.message}`);
