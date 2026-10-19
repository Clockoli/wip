import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

function weeklySummary() {
  const sandbox = { globalThis: {} };
  runInNewContext(read('src/ui/weekly-summary.js'), sandbox);
  return sandbox.globalThis.ClockoliWeeklySummary.summarize;
}

test('weekly summary clips work to its Monday–Sunday window and counts distinct tasks', () => {
  const summarize = weeklySummary();
  const start = Date.parse('2026-10-12T00:00:00Z'), hour = 3600000;
  const entries = [
    { startedAt: start - hour, endedAt: start + hour, url: 'https://example.com/a' },
    { startedAt: start + 3 * hour, endedAt: start + 5 * hour, url: 'https://example.com/a' },
    { startedAt: start + 6 * hour, endedAt: null, isRunning: true, url: 'https://example.com/b' },
    { startedAt: start - 3 * hour, endedAt: start - hour, url: 'https://example.com/c' },
  ];
  const actual = summarize(entries, start, start + 7 * 24 * hour, start + 8 * hour);
  assert.equal(actual.total, '5h 0m');
  assert.equal(actual.average, '42m');
  assert.equal(actual.entries, 3);
  assert.equal(actual.tasks, 2);
});

test('weekly summary handles no entries, invalid timestamps, and intervals outside its range', () => {
  const summarize = weeklySummary();
  const start = Date.parse('2026-10-12T00:00:00Z'), end = start + 7 * 86400000;
  assert.deepEqual({ ...summarize([], start, end, start + 1) },
    { total: '0m', average: '0m', entries: 0, tasks: 0 });
  assert.equal(summarize([
    { startedAt: NaN, endedAt: start + 10000, url: 'bad' },
    { startedAt: start, endedAt: start, url: 'same' },
    { startedAt: end + 1, endedAt: end + 2, url: 'later' },
  ], start, end, start + 86400000).entries, 0);
});

test('Clockoli pages expose the theme button; popup applies the same selected theme', () => {
  for (const page of ['src/times/times.html', 'src/tasks/tasks.html', 'src/reports/reports.html', 'src/options/options.html']) {
    assert.match(read(page), /class="page-theme-toggle"/, page);
    assert.match(read(page), /src="\.\.\/ui\/theme\.js"/, page);
  }
  assert.match(read('src/popup/popup.html'), /src="\.\.\/ui\/theme\.js"/);
  const tokens = read('src/styles/github-primer.css');
  assert.match(tokens, /:root\[data-clockoli-theme="dark"\]/);
  assert.match(tokens, /:root\[data-clockoli-theme="light"\]/);
});

test('Calendar days use one empty-state label and task action icons', () => {
  const adapter = read('packages/task-timeline-component/src/clockoli-adapter.js');
  assert.match(adapter, /title\.textContent = 'No time entries'/);
  assert.doesNotMatch(adapter, /Enjoy your weekend/);
  assert.match(adapter, /next\.setDate\(next\.getDate\(\) \+ 1\)/);
  assert.match(adapter, /button\.prepend\(actionIcon\('delete'\)\)/);
  assert.match(adapter, /button\.prepend\(actionIcon\('play'\)\)/);
  assert.match(read('src/times/times.html'), /page-add-time"[\s\S]*class="page-action-icon"/);
});

test('weekly summary counts compact task identities and a just-started timer', () => {
  const summarize = weeklySummary();
  const start = Date.parse('2026-10-12T00:00:00Z');
  const now = start + 3600000, end = start + 7 * 86400000;
  const running = { startedAt: now, endedAt: null, isRunning: true, taskIdentity: 'acme/site/work-42' };
  assert.deepEqual({ ...summarize([running], start, end, now) },
    { total: '0m', average: '0m', entries: 1, tasks: 1 });
  const completed = { startedAt: start, endedAt: start + 60000, taskIdentity: 'acme/site/work-42' };
  assert.deepEqual({ ...summarize([completed, running], start, end, now) },
    { total: '1m', average: '0m', entries: 2, tasks: 1 });
});

test('calendar does not show an empty-day marker behind a newly started timer', () => {
  for (const file of ['packages/task-timeline-component/src/clockoli-adapter.js', 'src/content/task-timeline-component.js']) {
    assert.ok(read(file).includes("node.classList.contains('running')"), file);
  }
});

test('manual themes control select arrows and print reports stay light', () => {
  for (const file of ['src/tasks/tasks.css', 'src/reports/reports.css']) {
    const css = read(file);
    assert.ok(css.includes(':root:not([data-clockoli-theme="light"])'), file);
    assert.ok(css.includes(':root[data-clockoli-theme="dark"]'), file);
  }
  assert.ok(read('src/reports/reports.css').includes(':root:root{color-scheme:light;'));
});
