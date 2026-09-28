import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseInventory, validateReleaseInventory } from '../scripts/release-inventory.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const EXPECTED_RUNTIME_INVENTORY = [
  'manifest.json',
  'src/addons/clockify/csv-normalizer.js',
  'src/addons/clockify/descriptor.js',
  'src/addons/clockify/detailed-report-button.js',
  'src/addons/clockify/detailed-report-capture.js',
  'src/addons/clockify/report-normalizer.js',
  'src/addons/clockify/user-mapping.js',
  'src/addons/registry.js',
  'src/addons/service.js',
  'src/api/github-client.js',
  'src/assets/action-spin/clockoli-16-0.png',
  'src/assets/action-spin/clockoli-16-1.png',
  'src/assets/action-spin/clockoli-16-2.png',
  'src/assets/action-spin/clockoli-16-3.png',
  'src/assets/action-spin/clockoli-16-4.png',
  'src/assets/action-spin/clockoli-16-5.png',
  'src/assets/action-spin/clockoli-16-6.png',
  'src/assets/action-spin/clockoli-16-7.png',
  'src/assets/action-spin/clockoli-32-0.png',
  'src/assets/action-spin/clockoli-32-1.png',
  'src/assets/action-spin/clockoli-32-2.png',
  'src/assets/action-spin/clockoli-32-3.png',
  'src/assets/action-spin/clockoli-32-4.png',
  'src/assets/action-spin/clockoli-32-5.png',
  'src/assets/action-spin/clockoli-32-6.png',
  'src/assets/action-spin/clockoli-32-7.png',

  'src/assets/clockoli-128.png',
  'src/assets/clockoli-16.png',
  'src/assets/clockoli-32.png',
  'src/assets/clockoli-48.png',
  'src/assets/clockoli-with-text.svg',
  'src/auth/github-app-auth.js',
  'src/background/message-policy.js',
  'src/background/serial-executor.js',
  'src/background/service-worker.js',
  'src/background/task-load.js',
  'src/clockify-migration/preview.css',
  'src/clockify-migration/preview.html',
  'src/clockify-migration/preview.js',
  'src/config/github-app.js',
  'src/content/github.js',
  'src/domain/bulk-time.js',
  'src/domain/local-settings.js',
  'src/domain/records.js',
  'src/domain/recovery-actions.js',
  'src/domain/reporting.js',
  'src/domain/task-index.js',
  'src/domain/tasks.js',
  'src/domain/ulid.js',
  'src/domain/values.js',
  'src/domain/work-records.js',
  'src/options/onboarding-flow.js',
  'src/options/options.css',
  'src/options/options.html',
  'src/options/options.js',
  'src/popup/popup.css',
  'src/popup/popup.html',
  'src/reports/reports.css',
  'src/reports/reports.html',
  'src/reports/reports.js',
  'src/services/clockify-annual-data.js',
  'src/services/clockify-capture-arm.js',
  'src/services/clockify-capture-profile.js',
  'src/services/clockify-history-capture-completion.js',
  'src/services/clockify-history-scan.js',
  'src/services/clockify-identity-mapping.js',
  'src/services/clockify-import-cleanup.js',
  'src/services/clockify-migration-session.js',
  'src/services/clockify-organization-import.js',
  'src/services/clockify-record-import.js',
  'src/services/clockify-report-route.js',

  'src/services/configuration.js',
  'src/services/exchange-rates.js',
  'src/services/github-app-onboarding.js',
  'src/services/onboarding-coordinator.js',
  'src/services/reports.js',
  'src/services/repository-operation-recovery.js',
  'src/services/task-metadata.js',
  'src/services/tracker.js',
  'src/services/user-storage-branch.js',
  'src/storage/chrome-store.js',
  'src/styles/github-primer.css',
  'src/styles/page-tabs.css',
  'src/tasks/tasks.css',
  'src/tasks/tasks.html',
  'src/tasks/tasks.js',
  'src/times/times.css',
  'src/times/times.html',
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
