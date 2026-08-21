import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/options/options.html', import.meta.url), 'utf8');
const script = await readFile(new URL('../src/options/options.js', import.meta.url), 'utf8');
const worker = await readFile(new URL('../src/background/service-worker.js', import.meta.url), 'utf8');
const recovery = await readFile(new URL('../src/domain/recovery-actions.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('../src/options/options.css', import.meta.url), 'utf8');

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
  assert.match(source, /GitHub keeps these approvals separate/i);
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

test('onboarding names and explains Device activation without hiding GitHub safety warnings', () => {
  assert.match(source, /Step <span id="current-step">1<\/span> of 3/i);
  assert.match(source, /Device activation/i);
  assert.match(source, /only use the code after you start Device activation/i);
  assert.match(source, /RepoClock by RepoClock/i);
  assert.match(source, /Act on your behalf/i);
  assert.match(source, /limited API calls/i);
  assert.match(source, /did not install RepoClock on any repository/i);
});


test('expected post-activation repository setup is neutral rather than an error', async () => {
  const onboarding = await readFile(new URL('../src/services/github-app-onboarding.js', import.meta.url), 'utf8');
  assert.doesNotMatch(onboarding, /Install RepoClock on a private repository, then check again/);
  assert.match(script, /Device activation is complete—nothing went wrong.*choose access on GitHub/i);
});

test('onboarding renders one active step, keeps cancel below it, and names repository actions precisely', () => {
  for (const id of ['device-step', 'access-step', 'repository-step']) assert.match(source, new RegExp(`id="${id}"`));
  assert.match(script, /onboardingStep/);
  assert.match(script, /element\.hidden = number !== step/);
  assert.match(source, /Choose access on GitHub/i);
  assert.match(source, /Refresh repository access/i);
  assert.match(source, /Creating a repository does not grant RepoClock access to it/i);
  assert.match(source, /Create repoclock-data on GitHub/i);
  assert.match(source, /id="repository-recovery"/);
  assert.match(source, /id="review-repository-access"/);
  assert.match(source, /id="refresh-repository-access"/);
  assert.match(script, /\$\('repository-recovery'\)\.hidden = result\.candidates\.length > 0/);
  assert.ok(source.indexOf('id="cancel-app-setup"') > source.indexOf('id="repository-step"'));
});

test('PAT setup remains an explicit advanced compatibility path without direct credential storage access', () => {
  assert.match(source, /<details[^>]*id="advanced-pat"/);
  assert.match(source, /Don’t want to install the GitHub App\?/i);
  assert.doesNotMatch(source, /Personal access token compatibility/i);
  assert.match(source, /Use a personal access token instead/i);
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

test('saved display preferences remain available while GitHub authentication is disconnected', () => {
  assert.match(script, /\$\('display-settings'\)\.hidden = !state\.config/);
  assert.doesNotMatch(script, /\$\('display-settings'\)\.hidden = !state\.ready/);
});

test('recent-entry display preference is independent from GitHub App and PAT authentication', () => {
  const patStart = source.indexOf('<details id="advanced-pat"');
  const patEnd = source.indexOf('</details>', patStart);
  const patSection = source.slice(patStart, patEnd);
  assert.match(source, /<section[^>]*id="display-settings"/);
  assert.equal((source.match(/id="recent-days"/g) || []).length, 1);
  assert.doesNotMatch(patSection, /Recent entries|id="recent-days"/i);
  assert.doesNotMatch(source, /id="app-recent-days"/);
  assert.match(script, /UPDATE_DISPLAY_PREFERENCES/);
});

test('PAT transitions explain exactly how to finish pending synchronization', async () => {
  const configuration = await readFile(new URL('../src/services/configuration.js', import.meta.url), 'utf8');
  assert.match(configuration, /Open RepoClock and finish syncing its pending changes before changing GitHub authentication/);
  assert.doesNotMatch(configuration, /Sync pending entries before changing GitHub authentication/);
});

test('local reset instructions explain how to protect unsynced work', () => {
  assert.match(source, /stop any running timer/i);
  assert.match(source, /use Sync.*no pending changes remain/is);
  assert.doesNotMatch(source, /Active timers and pending writes must be resolved first/i);
});

test('connected settings use one clear repository action and explain local versus GitHub disconnects', () => {
  assert.match(source, /id="connected-repository"[^>]*><a id="connected-repository-link"/);
  assert.doesNotMatch(source, /id="open-repository"|Open repository/i);
  assert.doesNotMatch(source, /id="check-access"|Check access/i);
  assert.match(source, /id="change-connection"[^>]*>Change data repository</i);
  assert.match(source, /Revoke RepoClock authorization on GitHub/i);
  assert.match(source, /sign-in approval/i);
  assert.match(source, /Neither action deletes repository data/i);
  assert.match(source, /id="disconnect"/);
  assert.match(source, /id="clear-local"/);
  assert.match(script, /DISCONNECT_GITHUB_APP/);
  assert.match(styles, /\.danger:hover\{[^}]*button-danger-borderColor-hover[^}]*button-danger-bgColor-hover[^}]*button-danger-fgColor-hover/);
});


test('Device Flow cancellation bypasses the tracker mutation executor and shares one live service', () => {
  assert.match(worker, /let activeDeviceFlow = null/);
  assert.match(worker, /DIRECT_DEVICE_FLOW_MESSAGES = new Set\(\[[\s\S]*POLL_DEVICE_FLOW[\s\S]*CANCEL_DEVICE_FLOW/);
  assert.match(worker, /const direct = readOnly \|\| DIRECT_DEVICE_FLOW_MESSAGES\.has/);
  assert.match(worker, /const attempt = \(\) => direct \? handle\(message, sender\) : executor\.run/);
});


test('repository creation monitoring explains the separate App grant without blinking refresh', () => {
  assert.match(script, /RepoClock still cannot see repoclock-data.*Only select repositories.*add repoclock-data.*Automatic checking will continue/is);
  assert.match(script, /if \(!monitoring\) \$\('refresh-repositories'\)\.disabled = true/);
  assert.match(script, /if \(!monitoring\) \$\('refresh-repositories'\)\.disabled = false/);
});

test('repository onboarding uses full names and monitors GitHub after repository creation', () => {
  assert.match(source, /id="repository-search"/);
  assert.match(source, /id="refresh-repositories"[^>]*>Refresh repository access</);
  assert.match(script, /name\.textContent = repository\.fullName/);
  assert.doesNotMatch(script, /name\.textContent = repository\.repo/);
  assert.doesNotMatch(script, /Private ·.*Contents: write/);
  assert.match(script, /startRepositoryMonitoring/);
  assert.match(script, /setTimeout\(.*monitorRepositories/s);
  assert.match(script, /new-repository.*startRepositoryMonitoring/s);
  assert.match(script, /visibilitychange/);
  assert.match(script, /addEventListener\('focus'/);
  assert.doesNotMatch(script, /catch \{ \/\* Keep watching/);
  assert.match(script, /Could not check GitHub.*keep retrying/i);
  assert.match(script, /stopped checking after five minutes/i);
  assert.match(script, /repository_monitor_timeout/);
  assert.match(script, /repositoryMonitorRetryPending/);
});

test('repository reasons and recovery actions use user-facing contracts', () => {
  for (const reason of ['private_required', 'archived', 'disabled', 'app_contents_write_required', 'user_write_required', 'initialized_default_branch_required']) {
    assert.match(script, new RegExp(`${reason}:`));
  }
  for (const code of ['app_installation_required', 'org_approval_required', 'repository_access_required', 'github_app_auth_required', 'branch_policy_rejected']) {
    assert.match(recovery, new RegExp(code));
  }
  assert.match(script, /RepoClockRecovery\.actionFor/);
  for (const label of ['Review repository access on GitHub', 'Connect GitHub', 'Retry']) assert.match(source, new RegExp(label));
  assert.doesNotMatch(source, /id="recovery-choose"|Choose another repository/i);
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


test('repository choice copy is plain language and errors stay visible at the current scroll position', () => {
  assert.match(source, /Choose where RepoClock should save your time data/i);
  assert.doesNotMatch(source, /Selectable repositories are private repositories granted/i);
  assert.match(source, /RepoClock will create the first commit automatically/i);
  assert.match(styles, /#message\.error\{[^}]*position:fixed/);
  assert.match(styles, /#message\.error\{[^}]*z-index:/);
});
