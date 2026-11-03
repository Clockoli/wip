import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('functional browser suites do not launch visible Chromium windows', () => {
  for (const file of readdirSync(new URL('./', import.meta.url)).filter(name => name.endsWith('.functional.spec.js'))) {
    const source = read(`test/${file}`);
    assert.equal(/headless\s*:\s*false\b/.test(source), false, `${file} must run headless`);
  }
  assert.match(read('packages/task-timeline-component/playwright.config.js'), /headless:\s*true\b/);
});
