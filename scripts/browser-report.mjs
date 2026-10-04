// Turn Playwright's JSON report into stats/browsers.json: which browsers the app was tested on
// and whether everything passed there. Usage: node scripts/browser-report.mjs <results.json> <out.json>
import { readFile, writeFile } from 'node:fs/promises';
import { BROWSERS } from '../playwright.config.js';

const [input = 'test-results/results.json', output = 'stats/browsers.json'] = process.argv.slice(2);
const report = JSON.parse(await readFile(input, 'utf8'));

const tests = [];
const walk = (suite) => {
  for (const spec of suite.specs || []) tests.push(...spec.tests);
  for (const s of suite.suites || []) walk(s);
};
report.suites.forEach(walk);

const browsers = BROWSERS.map(({ name, label }) => {
  const mine = tests.filter((t) => t.projectName === name);
  const passed = mine.filter((t) => t.status === 'expected' || t.status === 'flaky').length;
  const failed = mine.filter((t) => t.status === 'unexpected').length;
  const [engine, version] = (mine.flatMap((t) => t.annotations).find((a) => a.type === 'browser')?.description || '').split(' ');
  return { id: name, label, engine, version, passed, failed, ok: mine.length > 0 && failed === 0 };
}).filter((b) => b.passed + b.failed > 0);

await writeFile(output, JSON.stringify({ testedAt: new Date().toISOString(), commit: process.env.GITHUB_SHA?.slice(0, 8), browsers }, null, 2) + '\n');
console.log(browsers.map((b) => `${b.ok ? '✓' : '✗'} ${b.label} (${b.engine} ${b.version}): ${b.passed} passed, ${b.failed} failed`).join('\n'));
