import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assertMessageAllowed } from '../src/background/message-policy.js';

const readManifest = async () => JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
const extensionOrigin = 'chrome-extension://abc/';
const extensionSender = { url: `${extensionOrigin}src/options/options.html` };
const githubContentSender = { url: 'https://github.com/acme/clockoli/issues/1', tab: { id: 1 } };

const permanentHostPermissions = [
  'https://api.github.com/*',
  'https://github.com/login/*',
  'https://api.frankfurter.dev/*',
];
const forbiddenPermissions = new Set(['<all_urls>', 'cookies', 'downloads', 'webRequest']);
const forbiddenBroadHostPatterns = [/<all_urls>/i, /:\/\/\*\//, /:\/\/\*\./, /^https?:\/\/[^/]*\*[^/]*\//i];

test('manifest grants Clockify only as the exact optional host origin', async () => {
  const manifest = await readManifest();

  assert.deepEqual(manifest.optional_host_permissions, ['https://app.clockify.me/*']);
  assert.deepEqual(manifest.host_permissions, permanentHostPermissions);
  assert.equal(manifest.permissions.includes('storage'), false, 'the preview handoff uses privileged IndexedDB, not chrome.storage');
  assert.equal(manifest.permissions.some(permission => forbiddenPermissions.has(permission)), false);
  for (const hostPattern of [...manifest.host_permissions, ...manifest.optional_host_permissions]) {
    assert.equal(forbiddenBroadHostPatterns.some(pattern => pattern.test(hostPattern)), false, `broad host pattern: ${hostPattern}`);
  }
});

test('manifest injects the Clockify adapter only on the Detailed Report route', async () => {
  const manifest = await readManifest();

  assert.deepEqual(manifest.content_scripts, [
    {
      matches: ['https://github.com/*'],
      js: ['src/domain/recovery-actions.js', 'src/content/task-timeline-component.js', 'src/content/github.js'],
      run_at: 'document_idle',
    },
    {
      matches: ['https://app.clockify.me/reports/detailed*'],
      js: ['src/addons/clockify/detailed-report-button.js'],
      run_at: 'document_start',
    },
    {
      matches: ['https://app.clockify.me/reports/detailed*'],
      js: ['src/addons/clockify/detailed-report-capture.js'],
      run_at: 'document_start',
      world: 'MAIN',
    },
  ]);
  assert.deepEqual(manifest.web_accessible_resources.at(-1), {
    matches: ['https://app.clockify.me/*'],
    resources: ['src/assets/clockoli-32.png'],
  });
});

test('message policy rejects unimplemented add-on management and import requests', () => {
  for (const type of ['ENABLE_ADDON', 'DISABLE_ADDON', 'IMPORT_COMPLETED_RECORDS', 'CLOCKIFY_IMPORT']) {
    assert.throws(() => assertMessageAllowed(type, extensionSender, extensionOrigin), /not allowed/i);
    assert.throws(() => assertMessageAllowed(type, githubContentSender, extensionOrigin), /not allowed/i);
  }
});
