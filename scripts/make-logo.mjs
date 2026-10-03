// Renders the logo with the WebGL shader in scripts/logo-shader.js, in headless Chromium:
//  - assets/logo.webm + logo.mp4: the 45-frame, 15 fps, 3 s loop (what the site plays)
//  - assets/logo.png: frame 0 (video poster + social image)
//  - the PWA icons
// Needs ffmpeg with libvpx-vp9 and libx264. Run: npm run logo
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
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
import { mountLogo } from './scripts/logo-shader.js';
window.render = (text, w, h, frame, pad = 0) => {
  const wrap = document.getElementById('wrap'), c = document.getElementById('c');
  wrap.style.width = w + 'px'; wrap.style.height = h + 'px';
  c.style.width = (w - 2 * pad) + 'px'; c.style.height = (h - 2 * pad) + 'px';
  window.logo = mountLogo(c, { text, frame, margin: text.length > 2 ? 0.8 : 0.35 });
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

// The loop: every frame rendered at 1600×440 and downsampled to 800×220 (2×2 supersampling).
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'logo-'));
const p1 = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 800, height: 220 } });
await p1.goto('http://localhost:8199/_render.html');
await p1.waitForFunction(() => window.ready);
await p1.evaluate(() => window.render('DATAMUSAK', 800, 220, 0));
for (let f = 0; f < 45; f++) {
  await p1.evaluate((f) => window.logo.draw(f), f);
  await p1.waitForTimeout(30);
  await (await p1.$('#wrap')).screenshot({ path: path.join(tmp, `f${String(f).padStart(2, '0')}.png`) });
}
const ff = (...args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', '15', '-i', path.join(tmp, 'f%02d.png'), ...args], { stdio: 'inherit' });
ff('-c:v', 'libvpx-vp9', '-pix_fmt', 'yuv420p', '-crf', '44', '-b:v', '0', '-row-mt', '1', '-an', 'assets/logo.webm');
ff('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-preset', 'veryslow', '-tune', 'animation', '-movflags', '+faststart', '-an', 'assets/logo.mp4');
fs.rmSync(tmp, { recursive: true });
await render('assets/icon-512.png', 'DM', 512, 512, 0, 24);
await render('assets/icon-192.png', 'DM', 192, 192, 0, 8);
await render('assets/icon-maskable-512.png', 'DM', 512, 512, 0, 90);
await render('assets/apple-touch-icon.png', 'DM', 180, 180, 0, 10);
await browser.close();
server.close();
fs.unlinkSync('_render.html');
for (const f of fs.readdirSync('assets')) console.log(f, (fs.statSync('assets/' + f).size / 1024).toFixed(1) + ' KB');
