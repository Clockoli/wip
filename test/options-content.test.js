import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/options/options.html', import.meta.url), 'utf8');
const script = await readFile(new URL('../src/options/options.js', import.meta.url), 'utf8');
const worker = await readFile(new URL('../src/background/service-worker.js', import.meta.url), 'utf8');
const recovery = await readFile(new URL('../src/domain/recovery-actions.js', import.meta.url), 'utf8');

test('settings links directly to fine-grained token creation', () => {
  assert.match(source, /href="https:\/\/github\.com\/settings\/personal-access-tokens"/);
  assert.match(source, /target="_blank"/);
  assert.match(source, /rel="noreferrer"/);
});

test('settings no longer exposes the repository data convention', () => {
  assert.doesNotMatch(source, /Data convention/);
  assert.doesNotMatch(source, /active\/\{github-login\}\.json/);
  assert.doesNotMatch(source, /entries\/\{github-login\}/);
});


test('normal settings route is GitHub App onboarding with resumable authorization and repository selection', () => {
  assert.match(source, /Connect GitHub/i);
  assert.match(source, /id="authorize"/);
  assert.match(source, /id="device-code"/);
  assert.match(source, /id="install-app"/);
  assert.match(source, /id="repository-list"/);
  assert.match(source, /id="connect-repository"/);
  assert.match(source, /GitHub may ask/i);
  assert.doesNotMatch(source, /exactly three|three clicks|three actions/i);
  assert.match(script, /START_DEVICE_FLOW/);
  assert.match(script, /RESUME_DEVICE_FLOW/);
  assert.match(script, /POLL_DEVICE_FLOW/);
  assert.match(script, /auth_denied/);
  assert.match(script, /device_code_expired/);
  assert.match(script, /device_flow_superseded/);
  assert.match(script, /DISCOVER_REPOSITORIES/);
  assert.match(script, /SELECT_REPOSITORY/);
  assert.match(script, /user_write_required: 'your account cannot write'/);
});

test('PAT setup remains an explicit advanced compatibility path without direct credential storage access', () => {
  assert.match(source, /<details[^>]*id="advanced-pat"/);
  assert.match(source, /Personal access token compatibility/i);
  assert.doesNotMatch(script, /ChromeStore|chrome\.storage|indexedDB/);
  assert.match(script, /SAVE_CONFIG/);
});

test('settings allows every GitHub issue and clearly scopes the recent-entry window to main-panel display', () => {
  assert.doesNotMatch(source, /Allowed issue owners/i);
  assert.doesNotMatch(script, /allowedIssueOwners|allowedOwners/);
  assert.match(source, /Recent entries shown in the main panel \(days\)/i);
  assert.match(source, /only controls how many past days appear in the main tracking panel/i);
  assert.match(source, /Track any GitHub issue or pull request/i);
});

test('settings exposes local disconnect and GitHub-side recovery separately', () => {
  assert.match(source, /id="disconnect"/);
  assert.match(source, /id="clear-local"/);
  assert.match(source, /Revoke on GitHub/i);
  assert.match(script, /DISCONNECT_GITHUB_APP/);
});


test('Device Flow cancellation bypasses the tracker mutation executor and shares one live service', () => {
  assert.match(worker, /let activeDeviceFlow = null/);
  assert.match(worker, /DIRECT_DEVICE_FLOW_MESSAGES = new Set\(\[[\s\S]*POLL_DEVICE_FLOW[\s\S]*CANCEL_DEVICE_FLOW/);
  assert.match(worker, /const direct = readOnly \|\| DIRECT_DEVICE_FLOW_MESSAGES\.has/);
  assert.match(worker, /const attempt = \(\) => direct \? handle\(message, sender\) : executor\.run/);
});


test('repository onboarding is grouped, searchable, and automatically checks again after GitHub handoff', () => {
  assert.match(source, /id="repository-search"/);
  assert.match(source, /id="refresh-repositories"[^>]*>Check again</);
  assert.match(script, /accountLogin/);
  assert.match(script, /repository-group/);
  assert.match(script, /discoveryPromise/);
  assert.match(script, /visibilitychange/);
  assert.match(script, /addEventListener\('focus'/);
  assert.match(script, /githubHandoff/);
});

test('repository reasons and recovery actions use user-facing contracts', () => {
  for (const reason of ['private_required', 'archived', 'disabled', 'app_contents_write_required', 'user_write_required', 'initialized_default_branch_required']) {
    assert.match(script, new RegExp(`${reason}:`));
  }
  for (const code of ['app_installation_required', 'org_approval_required', 'repository_access_required', 'github_app_auth_required', 'branch_policy_rejected']) {
    assert.match(recovery, new RegExp(code));
  }
  assert.match(script, /RepoClockRecovery\.actionFor/);
  for (const label of ['Grant access', 'Choose another repository', 'Connect GitHub', 'Retry']) assert.match(source, new RegExp(label));
});

test('connected storage summary distinguishes write verification from access checking', () => {
  assert.match(script, /write_verified/);
  assert.match(script, /Write verified/);
  assert.match(script, /Access checked/);
});

test('normal popup setup directs users to Connect GitHub rather than PAT creation', async () => {
  const popup = await readFile(new URL('../src/popup/popup.html', import.meta.url), 'utf8');
  assert.match(popup, /Connect GitHub/);
  assert.doesNotMatch(popup, /fine-grained token/i);
});

test('tracking and reporting surfaces expose code-specific recovery actions', async () => {
  const [content, tasks, reports] = await Promise.all([
    readFile(new URL('../src/content/github.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/tasks/tasks.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/reports/reports.js', import.meta.url), 'utf8'),
  ]);
  for (const runtime of [content, tasks, reports]) assert.match(runtime, /RepoClockRecovery\.actionFor/);
  for (const code of ['authentication', 'org_approval_required', 'repository_access_required']) assert.match(recovery, new RegExp(code));
  for (const label of ['Connect GitHub', 'Grant access', 'Choose another repository', 'Retry']) assert.match(recovery, new RegExp(label));
});

test('public Device Flow resume uses validated service state rather than raw storage', () => {
  assert.match(worker, /RESUME_DEVICE_FLOW'\) return deviceFlow\(\)\.resume\(\)/);
  assert.doesNotMatch(worker, /RESUME_DEVICE_FLOW'\) return safeAttempt\(await store\.getDeviceAttempt\(\)\)/);
});

test('compliance documentation matches any-owner tracking and durable Title storage', async () => {
  const compliance = await readFile(new URL('../docs/spec-compliance.md', import.meta.url), 'utf8');
  assert.doesNotMatch(compliance, /configurable allowlist/i);
  assert.match(compliance, /optional one-line `Title`/i);
});
