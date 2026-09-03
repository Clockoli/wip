import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/domain/recovery-actions.js', import.meta.url), 'utf8');
const context = {};
vm.createContext(context);
vm.runInContext(source, context);
const classify = code => JSON.parse(JSON.stringify(context.ClockoliRecovery.actionFor(code)));

test('shared recovery taxonomy distinguishes reconnect, grant, choose, repair, and retry states', () => {
  for (const code of ['authentication', 'auth_required', 'auth_expired', 'github_app_auth_required', 'authentication_failed']) {
    assert.deepEqual(classify(code), { kind: 'connect', label: 'Connect GitHub' });
  }
  for (const code of ['app_installation_required', 'org_approval_required', 'permission', 'app_contents_write_required']) {
    assert.deepEqual(classify(code), { kind: 'grant', label: 'Grant access' });
  }
  for (const code of ['repository_access_required', 'branch_policy_rejected', 'empty_repository', 'custom_branch_unverified', 'repository_identity_unverified', 'repository_identity_changed', 'repository_coordinates_changed', 'repository_branch_changed', 'repository_unavailable', 'private_required', 'user_write_required']) {
    assert.deepEqual(classify(code), { kind: 'choose', label: 'Choose another repository' });
  }
  for (const code of ['incompatible_storage_format', 'storage_login_conflict', 'storage_layout_budget', 'migration_identity_mismatch', 'migration_identity_unverified']) {
    assert.deepEqual(classify(code), { kind: 'repair', label: 'Repair storage' });
  }
  for (const code of ['rate_limit', 'github_api_error', 'error', 'conflict', 'onboarding_superseded', 'unexpected']) {
    assert.deepEqual(classify(code), { kind: 'retry', label: 'Retry' });
  }
  assert.equal(classify(''), null);
});

test('all required runtime surfaces load and use the shared recovery taxonomy', async () => {
  const files = await Promise.all([
    '../manifest.json', '../src/options/options.html', '../src/options/options.js',
    '../src/content/github.js', '../src/tasks/tasks.html', '../src/tasks/tasks.js',
    '../src/reports/reports.html', '../src/reports/reports.js',
  ].map(path => readFile(new URL(path, import.meta.url), 'utf8')));
  const [manifest, optionsHtml, options, content, tasksHtml, tasks, reportsHtml, reports] = files;
  assert.deepEqual(JSON.parse(manifest).content_scripts[0].js, [
    'src/domain/recovery-actions.js',
    'src/content/elastic-timeline-editor.js',
    'src/content/github.js',
  ]);
  for (const html of [optionsHtml, tasksHtml, reportsHtml]) assert.match(html, /\.\.\/domain\/recovery-actions\.js/);
  for (const runtime of [options, content, tasks, reports]) {
    assert.match(runtime, /ClockoliRecovery\.actionFor/);
    assert.doesNotMatch(runtime, /function recoveryLabel/);
  }
});
