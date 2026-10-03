import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:8123',
    viewport: { width: 1400, height: 900 },
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
  },
  webServer: {
    command: 'node tests/serve.mjs',
    env: { PORT: '8123' },
    url: 'http://localhost:8123',
    reuseExistingServer: !process.env.CI,
  },
});
