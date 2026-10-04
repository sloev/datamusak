import { defineConfig, devices } from '@playwright/test';

// The same suite runs on desktop Chrome, Firefox and Safari (WebKit) and on phone-sized Chrome
// (Android) and Safari (iPhone). CI runs them all and publishes which ones pass
// (scripts/browser-report.mjs → stats/browsers.json, shown in the footer).
const desktop = { viewport: { width: 1400, height: 900 } };
export const BROWSERS = [
  { name: 'chrome', label: 'Chrome', use: { ...devices['Desktop Chrome'], ...desktop, launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] } } },
  { name: 'firefox', label: 'Firefox', use: { ...devices['Desktop Firefox'], ...desktop, launchOptions: { firefoxUserPrefs: { 'media.autoplay.default': 0, 'media.autoplay.block-webaudio': false } } } },
  { name: 'safari', label: 'Safari', use: { ...devices['Desktop Safari'], ...desktop } },
  { name: 'android', label: 'Android Chrome', use: { ...devices['Pixel 7'], launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] } } },
  { name: 'iphone', label: 'iPhone Safari', use: { ...devices['iPhone 15'] } },
];

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }], ['json', { outputFile: 'test-results/results.json' }]] : 'list',
  projects: BROWSERS.map(({ name, use }) => ({
    name,
    use: {
      ...use,
      baseURL: 'http://localhost:8123',
      // page.route() can't see requests a service worker handles; the PWA test opts back in.
      serviceWorkers: 'block',
      // the animated logo and glitches are heavy on a software GPU
      reducedMotion: 'reduce',
    },
  })),
  webServer: {
    command: 'node tests/serve.mjs',
    env: { PORT: '8123' },
    url: 'http://localhost:8123',
    reuseExistingServer: !process.env.CI,
  },
});
