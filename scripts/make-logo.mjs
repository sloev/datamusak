// Renders the static logo (fallback + social image) and the PWA icons with the same WebGL
// shader the site uses (js/logo.js), in headless Chromium. Run: npm run logo
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from '@playwright/test';

const root = path.resolve('.');
const server = http.createServer((req, res) => {
  const f = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!fs.existsSync(f)) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : 'text/html' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(8199, r));
fs.writeFileSync('_render.html', `<!doctype html><body style="margin:0;background:#000">
<div id=wrap style="background:#000;display:grid;place-items:center"><canvas id=c></canvas></div>
<script type=module>
import { mountLogo } from './js/logo.js';
window.render = (text, w, h, frame, pad = 0) => {
  const wrap = document.getElementById('wrap'), c = document.getElementById('c');
  wrap.style.width = w + 'px'; wrap.style.height = h + 'px';
  c.style.width = (w - 2 * pad) + 'px'; c.style.height = (h - 2 * pad) + 'px';
  mountLogo(c, { text, frame, margin: text.length > 2 ? 0.8 : 0.35 });
};
window.ready = true;
</script>`);

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
// deviceScaleFactor 2 + a CSS size of half the output = the renderer's 2×2 supersampling
const p2 = await browser.newPage({ deviceScaleFactor: 2 });
async function render(file, text, w, h, frame, pad = 0) {
  await p2.setViewportSize({ width: w / 2, height: h / 2 });
  await p2.goto('http://localhost:8199/_render.html');
  await p2.waitForFunction(() => window.ready);
  await p2.evaluate(([t, w, h, f, p]) => window.render(t, w, h, f, p), [text, w / 2, h / 2, frame, pad / 2]);
  await p2.waitForTimeout(400);
  await (await p2.$('#wrap')).screenshot({ path: file });
}
await render('assets/logo.png', 'DATAMUSAK', 800, 220, 0);
await render('assets/icon-512.png', 'DM', 512, 512, 0, 24);
await render('assets/icon-192.png', 'DM', 192, 192, 0, 8);
await render('assets/icon-maskable-512.png', 'DM', 512, 512, 0, 90);
await render('assets/apple-touch-icon.png', 'DM', 180, 180, 0, 10);
await browser.close();
server.close();
fs.unlinkSync('_render.html');
for (const f of fs.readdirSync('assets')) console.log(f, (fs.statSync('assets/' + f).size / 1024).toFixed(1) + ' KB');
