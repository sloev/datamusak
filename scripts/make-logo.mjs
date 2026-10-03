// Generates the bubbly rainbow logo + PWA icons from the Titan One font (outlined to paths, so no
// font is needed to render them). Run: npm run logo  (needs Playwright's Chromium for the PNGs)
import fs from 'node:fs';
import opentype from 'opentype.js';
import { chromium } from '@playwright/test';

const font = opentype.parse(fs.readFileSync('node_modules/@fontsource/titan-one/files/titan-one-latin-400-normal.woff').buffer);
const RAINBOW = ['#ff2e4d', '#ff8a00', '#ffe600', '#2bff5a', '#00e5ff', '#2e5bff', '#a637ff', '#ff2ed1'];

// Lay out letters with a little bounce: alternate tilt and baseline.
function word(text, size, tracking = -2) {
  let x = 0;
  const letters = [];
  for (const [i, ch] of [...text].entries()) {
    const g = font.charToGlyph(ch);
    const adv = (g.advanceWidth / font.unitsPerEm) * size;
    const dy = i % 2 ? -size * 0.04 : size * 0.03;
    const rot = i % 2 ? 4 : -4;
    const d = g.getPath(0, 0, size).toPathData(2);
    letters.push({ d, x, dy, rot, cx: adv / 2, cy: -size * 0.35, ch });
    x += adv + tracking;
  }
  return { letters, width: x - tracking, size };
}

function wordSvg({ letters }, { animate, shadow = [10, 8] }) {
  const tf = (l, ox = 0, oy = 0) => `translate(${(l.x + ox).toFixed(1)} ${(l.dy + oy).toFixed(1)}) rotate(${l.rot} ${l.cx.toFixed(1)} ${l.cy.toFixed(1)})`;
  const shadows = letters.map((l, i) => `<path d="${l.d}" transform="${tf(l, ...shadow)}" fill="${RAINBOW[(i + 2) % RAINBOW.length]}" stroke="#000" stroke-width="6" stroke-linejoin="round"/>`).join('');
  const glyphs = letters.map((l) => `<path d="${l.d}" transform="${tf(l)}"/>`).join('');
  return `
  <g>${shadows}</g>
  <g stroke-linejoin="round" stroke-linecap="round">
    <g fill="none" stroke="#000" stroke-width="18">${glyphs}</g>
    <g fill="none" stroke="#fff" stroke-width="9" stroke-dasharray="7 9">${glyphs}</g>
    <g fill="none" stroke="#000" stroke-width="6">${glyphs}</g>
    <g fill="url(#rb)">${glyphs}</g>
  </g>`;
}

const gradient = (animate, gx = 260, gy = 140) => `
  <linearGradient id="rb" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${gx}" y2="${gy}" spreadMethod="repeat">
    ${[...RAINBOW, RAINBOW[0]].map((c, i, a) => `<stop offset="${(i / (a.length - 1)).toFixed(3)}" stop-color="${c}"/>`).join('')}
    ${animate ? '<animateTransform attributeName="gradientTransform" type="translate" from="0 0" to="${gx} ${gy}" dur="2.4s" repeatCount="indefinite"/>' : ''}
  </linearGradient>`;

// Logo
const w = word('DATAMUSAK', 120);
const pad = 24;
const vbW = Math.ceil(w.width + pad * 2 + 12);
const vbH = 185;
const logo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vbW} ${vbH}" role="img" aria-label="datamusak">
<title>datamusak</title>
<defs>${gradient(true, 150, 90)}</defs>
<g transform="translate(${pad} 135)">${wordSvg(w, { animate: true, shadow: [15, 12] })}</g>
</svg>`;
fs.writeFileSync('assets/logo.svg', logo.replace(/\n\s*/g, ''));

// Icon: "DM" on white with zigzags and glitch bars.
const zig = (y, color, amp = 14, step = 32) => {
  let d = `M-10 ${y}`;
  for (let x = -10, up = true; x <= 530; x += step / 2, up = !up) d += ` L${x} ${y + (up ? -amp : amp)}`;
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="12" stroke-linejoin="miter"/>`;
};
const icon = (maskable) => {
  const dm = word('DM', maskable ? 210 : 250, -6);
  const s = maskable ? 0.8 : 1;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<defs>${gradient(false)}</defs>
<rect width="512" height="512" fill="#fff"/>
${zig(70, '#ffe600')}${zig(450, '#00e5ff')}
<rect y="150" width="512" height="18" fill="#9aa3ad"/><rect y="200" width="512" height="10" fill="#ff2ed1"/>
<rect y="330" width="512" height="14" fill="#a3a63a"/><rect y="372" width="512" height="8" fill="#2e5bff"/>
<g transform="translate(256 256) scale(${s}) translate(${-dm.width / 2 - 5} ${dm.size * 0.36})">${wordSvg(dm, { animate: false, shadow: [14, 11] })}</g>
</svg>`.replace(/\n\s*/g, '');
};
fs.writeFileSync('assets/icon.svg', icon(false));
fs.writeFileSync('assets/icon-maskable.svg', icon(true));

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [file, svg, size] of [
  ['assets/icon-192.png', icon(false), 192],
  ['assets/icon-512.png', icon(false), 512],
  ['assets/icon-maskable-512.png', icon(true), 512],
  ['assets/apple-touch-icon.png', icon(true), 180],
]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0}</style><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" width="${size}" height="${size}">`);
  await page.waitForTimeout(100);
  await page.screenshot({ path: file });
}
await browser.close();
for (const f of fs.readdirSync('assets')) console.log(f, (fs.statSync('assets/' + f).size / 1024).toFixed(1) + ' KB');
