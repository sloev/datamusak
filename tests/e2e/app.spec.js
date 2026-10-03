import { test, expect } from '@playwright/test';
import { mockNetwork, onlySources } from './mocks.js';

let errors;
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await mockNetwork(page);
});
test.afterEach(() => expect(errors, 'uncaught page errors').toEqual([]));

test('loads with every source listed and a map', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('datamusak');
  await expect(page.locator('.source')).toHaveCount(25);
  await expect(page.locator('#map.leaflet-container')).toBeVisible();
  await expect(page.locator('#power')).toHaveText('▶ Start');
});

test('start plays notes from REST sources and shows them everywhere', async ({ page }) => {
  await page.goto('/');
  await onlySources(page, ['energinet-grid', 'open-meteo', 'usgs']);
  await page.click('#power');
  await expect(page.locator('#power')).toHaveText('■ Stop');
  for (const id of ['energinet-grid', 'open-meteo', 'usgs']) {
    await expect(page.locator(`.source[data-id="${id}"] .status`)).toHaveClass(/ok/);
  }
  await expect(page.locator('.log-row.played').first()).toBeVisible();
  await expect.poll(() => page.locator('.log-row.played').count()).toBeGreaterThan(10);
  // log rows show raw values and a resulting note
  const row = await page.locator('.log-row.played').first().innerText();
  expect(row).toMatch(/=/);
  expect(row).toMatch(/[A-G]#?-?\d v\d+ [\d.]+s →\d/);
  // disabled sources stay idle
  await expect(page.locator('.source[data-id="dmi-weather"] .status')).not.toHaveClass(/ok|connecting|error/);
  await page.click('#power');
  await expect(page.locator('#power')).toHaveText('▶ Start');
});

test('an unreachable source turns red without affecting the others', async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await mockNetwork(page, { fail: ['data.sensor.community'] });
  await page.goto('/');
  await onlySources(page, ['sensor-community', 'random-walk']);
  await page.click('#power');
  await expect(page.locator('.source[data-id="sensor-community"] .status')).toHaveClass(/error/);
  await expect(page.locator('.source[data-id="sensor-community"] .status-msg')).toContainText('503');
  await expect(page.locator('.source[data-id="random-walk"] .status')).toHaveClass(/ok/);
  await expect.poll(() => page.locator('.log-row.played').count()).toBeGreaterThan(3);
});

test('websocket sources receive pushed data (Bluesky mock)', async ({ page }) => {
  await page.routeWebSocket(/jetstream/, (ws) => {
    const post = (n) => JSON.stringify({ kind: 'commit', commit: { operation: 'create', collection: 'app.bsky.feed.post', record: { text: 'x'.repeat(n), langs: ['da'] } } });
    let n = 0;
    const timer = setInterval(() => ws.send(post(10 + (n++ % 200))), 100);
    ws.onClose(() => clearInterval(timer));
  });
  await page.goto('/');
  await onlySources(page, ['bluesky']);
  await page.click('#power');
  await expect(page.locator('.source[data-id="bluesky"] .status')).toHaveClass(/ok/);
  await expect.poll(() => page.locator('.log-row.played').count()).toBeGreaterThan(3);
  await expect(page.locator('.source[data-id="bluesky"] .rate')).toHaveText(/\d+\/min/, { timeout: 5000 });
});

test('mapping edits persist across reloads', async ({ page }) => {
  await page.goto('/');
  await page.click('.source[data-id="dmi-weather"] .name');
  const mapping = page.locator('.source[data-id="dmi-weather"] .mapping');
  await expect(mapping).toBeVisible();
  await mapping.locator('tbody tr').first().locator('select').selectOption('wind');
  await mapping.locator('tbody tr').first().locator('input[type=number]').first().fill('40');
  await mapping.locator('tbody tr').first().locator('input[type=number]').first().dispatchEvent('change');
  await mapping.locator('.chip', { hasText: '8 Drums' }).locator('input').check();
  await page.selectOption('#globals label:has-text("Scale") select', 'dorian');
  await page.waitForTimeout(500); // saves are debounced
  await page.reload();
  await page.click('.source[data-id="dmi-weather"] .name');
  await expect(mapping.locator('tbody tr').first().locator('select')).toHaveValue('wind');
  await expect(mapping.locator('tbody tr').first().locator('input[type=number]').first()).toHaveValue('40');
  await expect(mapping.locator('.chip', { hasText: '8 Drums' }).locator('input')).toBeChecked();
  await expect(page.locator('#globals label:has-text("Scale") select')).toHaveValue('dorian');
});

test('source options restart the source', async ({ page }) => {
  await page.goto('/');
  await onlySources(page, ['wikipedia']);
  await page.click('#power');
  await page.click('.source[data-id="wikipedia"] .name');
  await page.locator('.source[data-id="wikipedia"] .opts select').selectOption('all');
  await page.reload();
  await page.click('.source[data-id="wikipedia"] .name');
  await expect(page.locator('.source[data-id="wikipedia"] .opts select')).toHaveValue('all');
});

test('clicking a source on the map opens its mapping', async ({ page }) => {
  await page.goto('/');
  await page.click('.tabs button[data-tab="instruments"]');
  const pt = await page.evaluate(() => {
    const { map, sources } = window.datamusak;
    const p = map.latLngToContainerPoint(sources.find((s) => s.id === 'energinet-grid').home);
    const r = map.getContainer().getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  });
  await page.mouse.click(pt.x, pt.y);
  await expect(page.locator('#tab-sources')).toBeVisible();
  await expect(page.locator('.source[data-id="energinet-grid"] .mapping')).toBeVisible();
});

test('instruments: change program, test note, add and remove slots', async ({ page }) => {
  await page.goto('/');
  await page.click('.tabs button[data-tab="instruments"]');
  await expect(page.locator('.slot')).toHaveCount(8);
  const first = page.locator('.slot').first();
  await first.locator('select').first().selectOption('0');
  await first.locator('button', { hasText: 'test' }).click();
  await expect(first.locator('.slot-status')).toHaveText('');
  await page.click('text=+ add instrument');
  await expect(page.locator('.slot')).toHaveCount(9);
  await page.click('text=− remove last');
  await expect(page.locator('.slot')).toHaveCount(8);
});

test('phone layout has no horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.click('.source[data-id="energinet-grid"] .name');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('nostr relays: events from several relays are de-duplicated and geotags land on the map', async ({ page }) => {
  const sent = [];
  await page.routeWebSocket(/relay\.damus\.io|nos\.lol|relay\.primal\.net/, (ws) => {
    ws.onMessage((m) => {
      const [type, sub] = JSON.parse(m);
      sent.push(type);
      if (type !== 'REQ') return;
      for (let i = 0; i < 5; i++) {
        const ev = { id: 'ev' + i, pubkey: 'pk' + i, kind: 1, content: 'hello nostr ' + i, tags: i === 0 ? [['g', 'u3buz']] : [], created_at: 0, sig: '' };
        ws.send(JSON.stringify(['EVENT', sub, ev]));
      }
    });
  });
  await page.goto('/');
  await onlySources(page, ['nostr-notes']);
  await page.click('#power');
  await expect(page.locator('.source[data-id="nostr-notes"] .status')).toHaveClass(/ok/);
  await expect.poll(() => page.locator('.log-row', { hasText: 'note' }).count()).toBe(5);
  expect(sent.filter((t) => t === 'REQ').length).toBe(3);
  await expect(page.locator('.log-row', { hasText: '📍' })).toHaveCount(1);
});

test.describe('PWA', () => {
  test.use({ serviceWorkers: 'allow' });
  test('has a valid manifest, icons, and a service worker that precaches the shell', async ({ page, request }) => {
    const manifest = await (await request.get('/manifest.webmanifest')).json();
    expect(manifest.name).toBe('datamusak');
    expect(manifest.display).toBe('standalone');
    for (const icon of manifest.icons) expect((await request.get('/' + icon.src)).ok(), icon.src).toBeTruthy();
    await page.goto('/');
    const cached = await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      const keys = await caches.keys();
      const shell = await caches.open(keys.find((k) => k.startsWith('shell-')));
      return (await shell.keys()).map((r) => new URL(r.url).pathname);
    });
    expect(cached).toContain('/js/main.js');
    expect(cached).toContain('/vendor/titan-one.woff2');
  });
});

test('heavy libraries are not loaded until needed', async ({ page }) => {
  const requested = [];
  page.on('request', (r) => requested.push(new URL(r.url()).pathname));
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  for (const lib of ['mqtt.min.js', 'webtorrent.min.js', 'WebAudioFontPlayer.js']) {
    expect(requested.some((p) => p.endsWith(lib)), lib).toBe(false);
  }
  await page.click('#power');
  await expect.poll(() => requested.some((p) => p.endsWith('WebAudioFontPlayer.js'))).toBe(true);
});
