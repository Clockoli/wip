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
    assert.deepEqual(classify(code), { kind: 'connect', label: 'Sign in with GitHub' });
  }
  for (const code of ['app_installation_required', 'permission', 'app_contents_write_required']) {
    assert.deepEqual(classify(code), { kind: 'grant', label: 'Grant access' });
  }
  assert.deepEqual(classify('org_approval_required'), { kind: 'grant', label: 'Request organization approval' });
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
    'src/content/task-timeline-component.js',
    'src/content/github.js',
  ]);
  for (const html of [optionsHtml, tasksHtml, reportsHtml]) assert.match(html, /\.\.\/domain\/recovery-actions\.js/);
  for (const runtime of [options, content, tasks, reports]) {
    assert.match(runtime, /ClockoliRecovery\.actionFor/);
    assert.doesNotMatch(runtime, /function recoveryLabel/);
  }
});

const describeSave = state => JSON.parse(JSON.stringify(context.ClockoliRecovery.describeSaveStatus(state)));
const describeError = error => JSON.parse(JSON.stringify(context.ClockoliRecovery.describeConnectionError(error)));

test('save status requires remote evidence and gives pending work, errors, and conflicts precedence', () => {
  assert.deepEqual(describeSave({ saving: true }), { label: 'Saving…' });
  assert.deepEqual(describeSave({ pendingCount: 2, remoteWriteConfirmed: true }), { label: 'Saving…', pending: 2 });
  assert.deepEqual(describeSave({ remoteWriteConfirmed: true }), { label: 'Saved to GitHub' });
  assert.deepEqual(describeSave({ remoteWriteConfirmed: true, remoteWriteAttempted: true }), { label: 'Saved to GitHub' });
  assert.notEqual(describeSave({ pendingCount: 0 }).label, 'Saved to GitHub');
  assert.notEqual(describeSave({}).label, 'Saved to GitHub');
  const conflict = describeSave({ remoteWriteConfirmed: true, pendingWrites: [{ id: 'blocked', status: 'conflict' }] });
  assert.equal(conflict.conflict, true);
  assert.equal(conflict.recovery, 'mutation-recovery');
  const error = describeSave({ remoteWriteConfirmed: true, error: { code: 'authentication', message: 'Access expired' } });
  assert.equal(error.label, 'GitHub access was revoked');
  assert.equal(error.detail, 'Access expired');
  assert.equal(error.action, 'connect');
  assert.equal(error.recovery, 'mutation-recovery');
});

test('connection errors retain detail and separate read retry from mutation recovery', () => {
  for (const [code, headline, action] of [
    ['network', "Couldn't reach GitHub", 'retry'],
    ['authentication', 'GitHub access was revoked', 'connect'],
    ['permission', 'GitHub access was revoked', 'grant'],
    ['not_found', 'Repository not found or not private', 'choose'],
    ['private_required', 'Repository not found or not private', 'choose'],
    ['rate_limit', 'GitHub rate limit reached', 'retry'],
    ['cross_destination_switch_pending', 'Task switch still syncing', 'retry'],
  ]) {
    assert.deepEqual(describeError({ code, message: 'Original detail' }), { headline, detail: 'Original detail', action, recovery: 'read-retry' });
    assert.equal(describeError({ code, message: 'Original detail', recovery: 'mutation-recovery' }).recovery, 'mutation-recovery');
  }
  const retryAt = '2026-09-05T10:42:00.000Z';
  const time = new Date(retryAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  assert.equal(describeError({ code: 'rate_limit', retryAt, message: 'Throttled' }).headline, `GitHub rate limit reached — retry after ${time}`);
  assert.equal(describeError({ code: 'rate_limit', retryAt: 'invalid' }).headline, 'GitHub rate limit reached');
  assert.deepEqual(describeError({ code: 'org_approval_required', message: 'An owner must approve Clockoli' }), {
    headline: 'Organization approval required', detail: 'An owner must approve Clockoli', action: 'grant', recovery: 'read-retry',
  });
});

test('connection descriptions accept the GitHub client error classes and fetch failures directly', async () => {
  const { GitHubAuthenticationError, GitHubPermissionError, GitHubNotFoundError, GitHubRateLimitError } = await import('../src/api/github-client.js');
  for (const [error, action] of [
    [new GitHubAuthenticationError(), 'connect'], [new GitHubPermissionError(), 'grant'],
    [new GitHubNotFoundError(), 'choose'], [new GitHubRateLimitError(), 'retry'],
    [new TypeError('Failed to fetch'), 'retry'],
  ]) {
    const description = describeError(error);
    assert.equal(description.detail, error.message);
    assert.equal(description.action, action);
    assert.equal(description.recovery, 'read-retry');
  }
});
