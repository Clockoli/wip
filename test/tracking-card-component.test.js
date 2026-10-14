import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = path => readFile(new URL(path, import.meta.url), 'utf8');

test('Activity and popup mount the same tracking-card presentation', async () => {
  const [activity, panel, component, manifest, popup, times, worker] = await Promise.all([
    source('../src/ui/running-status.js'), source('../src/content/github.js'),
    source('../src/ui/tracking-card.js'), source('../manifest.json'),
    source('../src/popup/popup.html'), source('../src/times/times.html'),
    source('../src/background/service-worker.js'),
  ]);
  assert.match(activity, /createTrackingCard\(/);
  assert.match(panel, /createTrackingCard\(/);
  assert.match(component, /running-status-live/);
  assert.match(component, /running-status-metrics/);
  assert.match(manifest, /src\/ui\/tracking-card\.js/);
  assert.match(popup, /tracking-card\.js/);
  assert.match(times, /tracking-card\.js/);
  assert.match(worker, /src\/ui\/tracking-card\.js/);
});
