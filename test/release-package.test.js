import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseInventory, validateReleaseInventory } from '../scripts/release-inventory.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const EXPECTED_RUNTIME_INVENTORY = [
  'manifest.json',
  'src/api/github-client.js',
  'src/auth/github-app-auth.js',
  'src/background/message-policy.js',
  'src/background/serial-executor.js',
  'src/background/service-worker.js',
  'src/background/task-load.js',
  'src/config/github-app.js',
  'src/content/github.js',
  'src/domain/monthly-text.js',
  'src/domain/records.js',
  'src/domain/recovery-actions.js',
  'src/domain/reporting.js',
  'src/domain/tasks.js',
  'src/domain/ulid.js',
  'src/domain/values.js',
  'src/options/onboarding-flow.js',
  'src/options/options.css',
  'src/options/options.html',
  'src/options/options.js',
  'src/popup/popup.css',
  'src/popup/popup.html',
  'src/popup/popup.js',
  'src/popup/view-state.js',
  'src/reports/reports.css',
  'src/reports/reports.html',
  'src/reports/reports.js',
  'src/services/configuration.js',
  'src/services/github-app-onboarding.js',
  'src/services/onboarding-coordinator.js',
  'src/services/reports.js',
  'src/services/repository-operation-recovery.js',
  'src/services/task-metadata.js',
  'src/services/tracker.js',
  'src/storage/chrome-store.js',
  'src/styles/github-primer.css',
  'src/tasks/tasks.css',
  'src/tasks/tasks.html',
  'src/tasks/tasks.js',
];

test('release inventory is deterministic, runtime-only, and secret-scanned', async () => {
  const first = await releaseInventory(root), second = await releaseInventory(root);
  assert.deepEqual(first, second);
  assert.equal(first[0], 'manifest.json');
  assert.deepEqual(first, EXPECTED_RUNTIME_INVENTORY);
  assert.ok(first.every(file => file === 'manifest.json' || file.startsWith('src/')));
  assert.ok(first.every(file => !/(?:^|\/)(?:test|tests|docs|scripts|node_modules)(?:\/|$)|\.map$/i.test(file)));
  const summary = await validateReleaseInventory(root, first);
  assert.equal(summary.files, first.length);
  assert.ok(summary.bytes > 0);
});
