import { test, expect } from '@playwright/test';

// Records which browser engine and version this project ran on, for stats/browsers.json.
test('browser version', async ({ browser, browserName }, testInfo) => {
  expect(browser.version()).toBeTruthy();
  testInfo.annotations.push({ type: 'browser', description: `${browserName} ${browser.version()}` });
});
