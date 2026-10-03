import { test, expect } from '@playwright/test';
import { mockNetwork, onlySources } from './mocks.js';

let errors;
test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await mockNetwork(page);
});
test.afterEach(() => expect(errors, 'uncaught page errors').toEqual([]));

const tile = (page, id) => page.locator(`.tile[data-id="${id}"]`);
const openSettings = async (page, tab) => {
  if (!(await page.locator('#sheet').isVisible())) await page.click('#open-settings');
  if (tab) await page.locator('#sheet .tabs button', { hasText: tab }).click();
};

test('loads: logo, play, a tile per source, and the vector map', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('datamusak');
  await expect(page.locator('.tile')).toHaveCount(27);
  await expect(page.locator('#map.leaflet-container')).toBeVisible();
  await expect(page.locator('#power')).toHaveText('▶ PLAY');
  await expect(page.locator('#logo:visible, #logo-fallback:visible')).toHaveCount(1);
  // coastlines are drawn from our own data (no tile server)
  await expect.poll(() => page.evaluate(() => Object.keys(window.datamusak.map._layers).length)).toBeGreaterThan(200);
});

test('play: sources light up and data becomes varied notes on many instruments', async ({ page }) => {
  await page.goto('/');
  await onlySources(page, ['energinet-grid', 'open-meteo', 'usgs', 'random-walk']);
  await page.click('#power');
  await expect(page.locator('#power')).toHaveText('■ STOP');
  for (const id of ['energinet-grid', 'open-meteo', 'usgs', 'random-walk']) await expect(tile(page, id).locator('.status')).toHaveClass(/ok/);
  await page.click('#raw');
  await expect.poll(() => page.locator('.log-row.played').count()).toBeGreaterThan(20);
  const midi = await page.locator('.log-row.played .midi').allInnerTexts();
  const instruments = new Set(midi.map((m) => m.replace(/^\S+ v\d+ /, '')));
  const notes = new Set(midi.map((m) => m.split(' ')[0]));
  expect(instruments.size, [...instruments].join(', ')).toBeGreaterThanOrEqual(5);
  expect(notes.size).toBeGreaterThanOrEqual(6);
  await expect(tile(page, 'open-meteo').locator('.tile-sub')).toContainText('/min', { timeout: 5000 });
  // the instruments those notes asked for were fetched and decoded on demand
  await expect.poll(() => page.evaluate(() => window.datamusak.audio.presets.size), { timeout: 10000 }).toBeGreaterThanOrEqual(4);
  await page.click('#power');
  await expect(page.locator('#power')).toHaveText('▶ PLAY');
});

test('an unreachable source turns red without affecting the others', async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await mockNetwork(page, { fail: ['data.sensor.community'] });
  await page.goto('/');
  await onlySources(page, ['sensor-community', 'random-walk']);
  await page.click('#power');
  await expect(tile(page, 'sensor-community').locator('.status')).toHaveClass(/error/);
  await expect(tile(page, 'random-walk').locator('.status')).toHaveClass(/ok/);
  await page.click('.tile[data-id="sensor-community"] .tile-more');
  await expect(page.locator('#sheet .status-line')).toContainText('503');
});

test('websocket sources receive pushed data (Bluesky mock)', async ({ page }) => {
  await page.routeWebSocket(/jetstream/, (ws) => {
    const post = (n) => JSON.stringify({ did: 'did:plc:' + (n % 7), kind: 'commit', commit: { operation: 'create', collection: 'app.bsky.feed.post', record: { text: 'x'.repeat(n), langs: ['da'] } } });
    let n = 0;
    const timer = setInterval(() => ws.send(post(10 + (n++ % 200))), 100);
    ws.onClose(() => clearInterval(timer));
  });
  await page.goto('/');
  await onlySources(page, ['bluesky']);
  await page.click('#power');
  await expect(tile(page, 'bluesky').locator('.status')).toHaveClass(/ok/);
  await expect(tile(page, 'bluesky').locator('.tile-sub')).toContainText('/min', { timeout: 6000 });
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
  await page.click('#raw');
  await expect(tile(page, 'nostr-notes').locator('.status')).toHaveClass(/ok/);
  await expect.poll(() => page.locator('.log-row', { hasText: 'note' }).count()).toBe(5);
  expect(sent.filter((t) => t === 'REQ').length).toBe(3);
  await expect(page.locator('.log-row', { hasText: '📍' })).toHaveCount(1);
});

test('a source sheet: listen, instrument families, range — all remembered', async ({ page }) => {
  await page.goto('/');
  await page.click('.tile[data-id="dmi-weather"] .tile-more');
  const sheet = page.locator('#sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('h2')).toContainText('DMI weather');
  await sheet.locator('.chip', { hasText: 'ALL 128' }).click();
  await sheet.locator('.chip', { hasText: 'High' }).click();
  await sheet.locator('summary', { hasText: 'Which data drives what' }).click();
  await sheet.locator('label.row:has-text("Melody") select').selectOption('wind');
  await page.waitForTimeout(400);
  await page.reload();
  await page.click('.tile[data-id="dmi-weather"] .tile-more');
  await expect(sheet.locator('.chip', { hasText: 'ALL 128' })).toHaveAttribute('aria-pressed', 'true');
  await expect(sheet.locator('.chip', { hasText: 'High' })).toHaveAttribute('aria-pressed', 'true');
  await sheet.locator('summary', { hasText: 'Which data drives what' }).click();
  await expect(sheet.locator('label.row:has-text("Melody") select')).toHaveValue('wind');
  // pick specific families instead of all
  await sheet.locator('.chip', { hasText: 'ALL 128' }).click();
  await sheet.locator('.chip', { hasText: 'Bass' }).click();
  await expect(sheet.locator('.chip', { hasText: 'Bass' })).toHaveAttribute('aria-pressed', 'true');
  await sheet.locator('.close').click();
  await expect(sheet).toBeHidden();
});

test('tapping a tile switches the source on and off; filters narrow the list', async ({ page }) => {
  await page.goto('/');
  await onlySources(page, []);
  await tile(page, 'ais').locator('.tile-main').click();
  await expect(tile(page, 'ais')).toHaveClass(/on/);
  await page.locator('#filters .chip', { hasText: 'On' }).click();
  await expect(page.locator('.tile')).toHaveCount(1);
  await page.locator('#filters .chip', { hasText: 'Nostr' }).click();
  await expect(page.locator('.tile')).toHaveCount(3);
  await page.locator('#filters .chip', { hasText: 'All' }).click();
  await expect(page.locator('.tile')).toHaveCount(27);
});

test('clicking a source on the map opens its sheet', async ({ page }) => {
  await page.goto('/');
  await page.click('[data-view="dk"]'); // hold the view still (AUTO keeps refitting)
  await page.waitForTimeout(300);
  const pt = await page.evaluate(() => {
    const { map, sources } = window.datamusak;
    const p = map.latLngToContainerPoint(sources.find((s) => s.id === 'energinet-grid').home);
    const r = map.getContainer().getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  });
  await page.mouse.click(pt.x, pt.y);
  await expect(page.locator('#sheet h2')).toContainText('Energinet');
});

test('settings: one tab at a time, save bar always visible, presets load/share/delete', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await openSettings(page);
  const sheet = page.locator('#sheet');
  await expect(sheet.locator('.tabs button[aria-selected="true"]')).toHaveText('Music');
  await sheet.locator('label.row:has-text("Scale") select').selectOption('blues');
  for (const tab of ['Sound', 'Mixer', 'Presets', 'Recordings', 'MIDI', 'About']) {
    await openSettings(page, tab);
    await expect(sheet.locator('.tabs button[aria-selected="true"]')).toHaveText(tab);
    await expect(sheet.locator('.save-bar')).toBeVisible();
    await expect(sheet.locator('.panel')).toHaveCount(1);
  }
  await openSettings(page, 'Mixer');
  await sheet.locator('.fader button', { hasText: 'Mallets' }).click();

  // save from the always-visible bar
  await sheet.locator('.save-bar input').fill('my blues');
  await sheet.locator('.save-bar .save').click();
  await expect(sheet.locator('.msg')).toContainText('my blues');
  await expect(sheet.locator('.tabs button[aria-selected="true"]')).toHaveText('Presets');
  const mine = sheet.locator('.preset', { hasText: 'my blues' });
  await mine.locator('button', { hasText: 'Share' }).click();
  await expect(sheet.locator('.msg')).toContainText('copied');
  const link = await page.evaluate(() => navigator.clipboard.readText());
  expect(link).toMatch(/#p=[\w-]+$/);

  // load a built-in, then our own again
  await sheet.locator('.preset', { hasText: 'Power grid' }).locator('button', { hasText: 'Load' }).click();
  await page.waitForLoadState('load');
  await openSettings(page, 'Music');
  await expect(sheet.locator('label.row:has-text("Scale") select')).toHaveValue('dorian');
  await expect(tile(page, 'elpris')).toHaveClass(/on/);
  await openSettings(page, 'Presets');
  await sheet.locator('.preset', { hasText: 'my blues' }).locator('button', { hasText: 'Load' }).click();
  await page.waitForLoadState('load');
  await openSettings(page, 'Music');
  await expect(sheet.locator('label.row:has-text("Scale") select')).toHaveValue('blues');

  // delete
  await openSettings(page, 'Presets');
  page.once('dialog', (d) => d.accept());
  await sheet.locator('.preset', { hasText: 'my blues' }).locator('button', { hasText: 'Delete' }).click();
  await expect(sheet.locator('.preset', { hasText: 'my blues' })).toHaveCount(0);

  // the share link opens the setup in a fresh browser
  const fresh = await context.browser().newContext({ reducedMotion: 'reduce', serviceWorkers: 'block' });
  const p2 = await fresh.newPage();
  await mockNetwork(p2);
  await p2.goto(link.replace(/^https?:\/\/[^/]+/, 'http://localhost:8123'));
  await expect(p2.locator('#sheet .msg')).toContainText('Loaded the preset');
  await p2.locator('#sheet .tabs button', { hasText: 'Music' }).click();
  await expect(p2.locator('#sheet label.row:has-text("Scale") select')).toHaveValue('blues');
  expect(new URL(p2.url()).hash).toBe('');
  await fresh.close();
});

test('recording: sound + MIDI file, listed with play/download/delete', async ({ page }) => {
  await page.goto('/');
  await onlySources(page, ['random-walk']);
  await page.click('#rec'); // starts playback too
  await expect(page.locator('#power')).toHaveText('■ STOP');
  await expect(page.locator('#rec')).toHaveText(/■ 0:\d\d/);
  await page.waitForTimeout(2500);
  await page.click('#rec');
  const sheet = page.locator('#sheet');
  await expect(sheet.locator('.tabs button[aria-selected="true"]')).toHaveText('Recordings');
  const rec = sheet.locator('.recording').first();
  await expect(rec).toBeVisible();
  await expect(rec).toContainText('notes');
  const midiDl = page.waitForEvent('download');
  await rec.locator('button', { hasText: 'MIDI' }).click();
  const midiFile = await (await midiDl).path();
  const bytes = (await import('node:fs')).readFileSync(midiFile);
  expect(bytes.subarray(0, 4).toString()).toBe('MThd');
  const noteOns = [...bytes].filter((b, i) => (b & 0xf0) === 0x90 && i > 22).length;
  expect(noteOns).toBeGreaterThan(3);
  const soundDl = page.waitForEvent('download');
  await rec.locator('button', { hasText: 'Sound' }).click();
  expect((await soundDl).suggestedFilename()).toMatch(/^datamusak-\d{8}-\d{6}\.(webm|ogg|m4a)$/);
  await rec.locator('button', { hasText: 'Delete' }).click();
  await expect(sheet.locator('.recording')).toHaveCount(0);
});

test('raw log toggles on and off on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 760 });
  await page.goto('/');
  await page.click('#raw');
  await expect(page.locator('#log')).toBeVisible();
  await page.click('#raw');
  await expect(page.locator('#log')).toBeHidden();
});

test('map AUTO view fits what the enabled sources do; panning switches to manual', async ({ page }) => {
  await page.goto('/');
  await onlySources(page, ['usgs']);
  await page.click('#power');
  await expect(page.locator('[data-view="auto"]')).toHaveClass(/on/);
  // world-wide earthquakes → the auto view zooms out to the world
  await expect.poll(() => page.evaluate(() => window.datamusak.map.getZoom()), { timeout: 15000 }).toBeLessThan(5);
  const box = await page.locator('#map').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 3 + 40, { steps: 5 });
  await page.mouse.up();
  await expect(page.locator('[data-view="auto"]')).not.toHaveClass(/on/);
  await page.click('[data-view="auto"]');
  await expect(page.locator('[data-view="auto"]')).toHaveClass(/on/);
});

test('tiles are sorted by measured reachability and activity; sheets name the identity', async ({ page }) => {
  await page.route('**/stats/sources.json', (r) =>
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ sources: { ais: { status: 'ok', eventsPerMin: 900 }, wikipedia: { status: 'ok', eventsPerMin: 300 }, 'energinet-co2': { status: 'error', eventsPerMin: 0 } } }) }));
  await page.goto('/');
  await expect.poll(() => page.locator('.tile').first().getAttribute('data-id')).toBe('ais');
  const ids = await page.locator('.tile').evaluateAll((els) => els.map((e) => e.dataset.id));
  expect(ids.indexOf('wikipedia')).toBe(1);
  expect(ids.indexOf('energinet-co2')).toBe(ids.length - 1);
  await expect(tile(page, 'energinet-co2').locator('.tile-sub')).toContainText('down');
  await tile(page, 'ais').locator('.tile-more').click();
  await expect(page.locator('#sheet')).toContainText('Each ship (MMSI) always gets its own instrument');
});

test('online button joins and leaves the listener room, and is remembered', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#online')).toHaveText(/online/, { timeout: 8000 });
  await page.click('#online');
  await expect(page.locator('#online')).toHaveText(/offline/);
  await page.reload();
  await page.waitForTimeout(2500);
  await expect(page.locator('#online')).toHaveText(/offline/, { timeout: 1000 });
});

for (const [name, vp] of [['phone', { width: 360, height: 760 }], ['tablet', { width: 820, height: 1180 }], ['desktop', { width: 1440, height: 900 }]]) {
  test(`responsive: no horizontal scroll on ${name}, sheet fits`, async ({ page }) => {
    await page.setViewportSize(vp);
    await page.goto('/');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await page.click('.tile[data-id="ais"] .tile-more');
    await expect.poll(async () => {
      const box = await page.locator('#sheet').boundingBox();
      return box.x >= -1 && box.x + box.width <= vp.width + 1 && box.height <= vp.height + 1;
    }).toBe(true);
  });
}

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
    expect(cached).toContain('/assets/map/coast.json');
  });

  test('the app still boots on reloads served by the service worker', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    for (let i = 0; i < 2; i++) {
      await page.reload();
      expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
      await expect(page.locator('.tile').first()).toBeVisible();
      await expect(page.locator('#map.leaflet-container')).toBeVisible();
    }
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
