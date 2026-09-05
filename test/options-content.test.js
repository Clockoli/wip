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
  assert.match(source, /Step <span id="current-step">1<\/span> of 3/i);
  assert.match(source, /id="authorize"[^>]*>Connect GitHub<\/button>/);
  for (const id of ['device-code', 'install-app', 'repository-list', 'connect-repository']) assert.match(source, new RegExp(`id="${id}"`));
  for (const type of ['START_DEVICE_FLOW', 'RESUME_DEVICE_FLOW', 'POLL_DEVICE_FLOW', 'DISCOVER_REPOSITORIES', 'SELECT_REPOSITORY']) assert.match(script, new RegExp(type));
  for (const code of ['auth_denied', 'device_code_expired', 'device_flow_superseded']) assert.match(script, new RegExp(code));
});

test('onboarding names and explains Device activation without hiding GitHub safety warnings', () => {
  assert.match(source, /How it works[\s\S]*Device activation/i);
  assert.match(source, /Only enter a code after starting this connection here/i);
  assert.match(source, /verify that the page names Clockoli/i);
  assert.match(source, /Act on your behalf[\s\S]*only repositories you later grant/i);
});

test('Device activation copies the code before opening GitHub and offers an immediate completion check', () => {
  assert.match(source, /id="authorize"[^>]*>Connect GitHub<\/button>/i);
  assert.match(source, /copies the one-time code before opening GitHub so you can paste it/i);
  assert.match(source, /id="device-code"[^>]*readonly[^>]*aria-label="Device activation code"/i);
  assert.match(source, /id="copy-code"[^>]*aria-label="Copy device code"/i);
  assert.match(source, /id="device-done"[^>]*>Done on GitHub—check now<\/button>/i);
  assert.match(script, /navigator\.clipboard\.writeText\(attempt\.userCode\)/);
  assert.ok(script.indexOf('navigator.clipboard.writeText(attempt.userCode)') < script.indexOf("type: 'OPEN_DEVICE_FLOW_PAGE'"));
  const startHandler = worker.slice(worker.indexOf("if (message.type === 'START_DEVICE_FLOW')"), worker.indexOf("if (message.type === 'OPEN_DEVICE_FLOW_PAGE')"));
  assert.doesNotMatch(startHandler, /chrome\.tabs\.create/);
});

test('expected post-activation repository setup is neutral rather than an error', async () => {
  const onboarding = await readFile(new URL('../src/services/github-app-onboarding.js', import.meta.url), 'utf8');
  assert.doesNotMatch(onboarding, /Install Clockoli on a private repository, then check again/);
  assert.match(script, /Device activation is complete—nothing went wrong.*choose access on GitHub/i);
});

test('Step 2 creates a template-backed data repository or skips to existing-repository access', () => {
  assert.match(source, /id="repository-setup-step"[\s\S]*Create a private Clockoli data repository/i);
  assert.match(source, /id="new-repository"[^>]*>Create private repository/i);
  assert.match(source, /id="skip-repository-creation"[^>]*>Use existing repository/i);
  assert.match(source, /Clockoli template[\s\S]*Only select repositories/i);
  assert.match(script, /startRepositoryMonitoring\('clockoli-data'\)/);
});

test('Step 2 grants App access to the new or an existing repository', () => {
  assert.match(source, /id="repository-step"[\s\S]*Choose and validate the data repository/i);
  assert.match(source, /id="repository-access-instruction"/i);
  assert.match(source, /id="install-app"[\s\S]*Grant repository access/i);
  assert.match(source, /id="connect-repository"[^>]*>Validate and connect/i);
});

test('detected repository access advances to Step 3 for selection and validation', () => {
  assert.match(source, /of 3/);
  assert.match(source, /id="repository-access-complete"[\s\S]*Private repository access found/i);
  assert.match(script, /\[3, 'repository-step'\]/);
  assert.match(script, /3: 'repository-step-title'/);
  assert.doesNotMatch(script, /\[4, 'repository-step'\]/);
});

test('onboarding renders one active step, keeps cancel below it, and names repository actions precisely', () => {
  for (const id of ['device-step', 'repository-setup-step', 'repository-step']) assert.match(source, new RegExp(`id="${id}"`));
  assert.doesNotMatch(source, /id="repository-access-step"/);
  assert.match(script, /element\.hidden = number !== step/);
  for (const id of ['connection-title', 'repository-setup-step-title', 'repository-step-title']) assert.match(source, new RegExp(`id=\"${id}\" tabindex=\"-1\"`));
  assert.match(script, /previousStep !== null && previousStep !== step[\s\S]*focus\(\)/);
  assert.equal((source.match(/id="install-app"/g) || []).length, 1);
  assert.ok(source.indexOf('id="cancel-app-setup"') > source.indexOf('id="repository-step"'));
});

test('PAT setup remains an explicit advanced compatibility path without direct credential storage access', () => {
  assert.match(source, /<details[^>]*id="advanced-settings"/);
  assert.match(source, /<details[^>]*id="advanced-pat"[\s\S]*Use a personal access token/i);
  assert.doesNotMatch(script, /ChromeStore|chrome\.storage|indexedDB/);
  assert.match(script, /SAVE_CONFIG/);
});

test('settings allows every GitHub issue and clearly scopes the recent-entry window to main-panel display', () => {
  assert.doesNotMatch(source, /Allowed issue owners/i);
  assert.doesNotMatch(script, /allowedIssueOwners|allowedOwners/);
  assert.match(source, /Recent entries shown in the main panel \(days\)/i);
  assert.match(source, /changes only the recent entries shown in the main panel/i);
  assert.match(source, /Track any HTTP\(S\) task URL.*title is optional/i);
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
  assert.match(configuration, /Open Clockoli and finish syncing its pending changes before changing GitHub authentication/);
  assert.doesNotMatch(configuration, /Sync pending entries before changing GitHub authentication/);
});

test('local reset instructions explain how to protect unsynced work', () => {
  assert.match(source, /stop any running timer/i);
  assert.match(source, /use Sync.*no pending changes remain/is);
  assert.doesNotMatch(source, /Active timers and pending writes must be resolved first/i);
});

test('connected settings render each action as a button with its own explanation', () => {
  assert.match(source, /id="connected-repository"[^>]*><a id="connected-repository-link"/);
  assert.match(source, /id="connected-branch-link"/);
  for (const id of ['check-access', 'change-connection', 'disconnect']) assert.match(source, new RegExp(`id="${id}"[^>]*>`, 'i'));
  assert.match(source, /id="revoke-action"[\s\S]*Revoke GitHub sign-in/);
  assert.match(script, /\$\('check-access'\)\.addEventListener/);
  assert.match(script, /DISCONNECT_GITHUB_APP/);
  assert.match(styles, /\.connection-dashboard/);
  assert.match(styles, /\.connected-secondary-actions/);
});

test('Device Flow cancellation bypasses the tracker mutation executor and shares one live service', () => {
  assert.match(worker, /let activeDeviceFlow = null/);
  assert.match(worker, /DIRECT_DEVICE_FLOW_MESSAGES = new Set\(\[[\s\S]*POLL_DEVICE_FLOW[\s\S]*CANCEL_DEVICE_FLOW/);
  assert.match(worker, /const direct = readOnly \|\| DIRECT_DEVICE_FLOW_MESSAGES\.has/);
  assert.match(worker, /const attempt = \(\) => direct \? handle\(message, sender\)[\s\S]*acceptsLocally \? acceptanceExecutor\.run[\s\S]*executor\.run/);
});


test('repository access monitoring explains the separate App grant without blinking refresh', () => {
  assert.match(script, /still cannot see \${repositoryMonitorExpectedName}.*Only select repositories.*add \${repositoryMonitorExpectedName}.*Automatic checking will continue/is);
  assert.match(script, /still cannot see an eligible repository.*Only select repositories.*add your data repository.*Automatic checking will continue/is);
  assert.doesNotMatch(script, /refresh-repositories/);
});

test('repository onboarding uses full names and monitors GitHub after repository creation', () => {
  assert.match(source, /id="repository-search"/);
  assert.doesNotMatch(source, /id="refresh-repositories"/);
  assert.match(script, /name\.textContent = repository\.fullName/);
  assert.doesNotMatch(script, /name\.textContent = repository\.repo/);
  assert.doesNotMatch(script, /Private ·.*Contents: write/);
  assert.match(script, /startRepositoryMonitoring/);
  assert.match(script, /setTimeout\(.*monitorRepositories/s);
  assert.match(script, /new-repository.*startRepositoryMonitoring/s);
  assert.match(script, /install-app.*startRepositoryMonitoring/s);
  assert.match(script, /repositoryChoiceMode === 'create' \? 'clockoli-data' : ''/);
  assert.match(script, /startRepositoryMonitoring\('clockoli-data'\)/);
  assert.match(script, /repositoryAccessDetected = repositoryChoiceMode === 'create'/);
  assert.match(script, /repositories\.some\(repository => repository\.repo === 'clockoli-data'\)/);
  assert.match(script, /expectedRepository = repositoryChoiceMode === 'create'[\s\S]*repository\.repo === 'clockoli-data' && repository\.eligible/);
  assert.match(script, /const accessedRepository = repositoryMonitorExpectedName/);
  assert.match(script, /relevantCandidates = repositoryChoiceMode === 'create'/);
  assert.match(script, /still cannot see clockoli-data.*Grant that repository access/i);
  assert.match(script, /still cannot see an eligible repository/i);
  assert.match(script, /visibilitychange/);
  assert.match(script, /addEventListener\('focus'/);
  assert.doesNotMatch(script, /catch \{ \/\* Keep watching/);
  assert.match(script, /Could not check GitHub.*keep retrying/i);
  assert.match(script, /stopped checking after five minutes/i);
  assert.match(script, /repository_monitor_timeout/);
  assert.match(script, /repositoryMonitorRetryPending/);
});

test('repository reasons and recovery actions use user-facing contracts', () => {
  for (const reason of ['private_required', 'archived', 'disabled', 'app_contents_write_required', 'user_write_required', 'initialized_default_branch_required']) assert.match(script, new RegExp(`${reason}:`));
  for (const code of ['app_installation_required', 'org_approval_required', 'repository_access_required', 'github_app_auth_required', 'branch_policy_rejected']) assert.match(recovery, new RegExp(code));
  assert.match(source, /id="recovery-action"/);
  assert.match(script, /recovery\.label/);
  assert.doesNotMatch(source, /id="recovery-connect"|id="recovery-grant"|id="recovery-retry"/);
});

test('connected storage summary distinguishes write verification from access checking', () => {
  assert.match(script, /write_verified/);
  assert.match(script, /Write verified/);
  assert.match(script, /Access checked/);
});

test('normal popup uses the shared tracker setup and directs users to Connect GitHub', async () => {
  const [popup, tracker] = await Promise.all([
    readFile(new URL('../src/popup/popup.html', import.meta.url), 'utf8'),
    readFile(new URL('../src/content/github.js', import.meta.url), 'utf8'),
  ]);
  assert.match(popup, /src="\.\.\/content\/github\.js"/);
  assert.match(tracker, /Connect GitHub/);
  assert.doesNotMatch(`${popup}
${tracker}`, /fine-grained token/i);
});

test('tracking and reporting surfaces expose code-specific recovery actions', async () => {
  const [content, tasks, reports] = await Promise.all([
    readFile(new URL('../src/content/github.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/tasks/tasks.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/reports/reports.js', import.meta.url), 'utf8'),
  ]);
  for (const runtime of [content, tasks, reports]) assert.match(runtime, /ClockoliRecovery\.actionFor/);
  for (const code of ['authentication', 'org_approval_required', 'repository_access_required']) assert.match(recovery, new RegExp(code));
  for (const label of ['Connect GitHub', 'Grant access', 'Choose another repository', 'Retry']) assert.match(recovery, new RegExp(label));
});

test('public Device Flow resume uses validated service state rather than raw storage', () => {
  assert.match(worker, /RESUME_DEVICE_FLOW'\) return deviceFlow\(\)\.resume\(\)/);
  assert.doesNotMatch(worker, /RESUME_DEVICE_FLOW'\) return safeAttempt\(await store\.getDeviceAttempt\(\)\)/);
});

test('compliance documentation matches any-owner tracking and durable v1 work-item titles', async () => {
  const compliance = await readFile(new URL('../docs/spec-compliance.md', import.meta.url), 'utf8');
  assert.doesNotMatch(compliance, /configurable allowlist/i);
  assert.match(compliance, /work-item URL, title/i);
  assert.match(compliance, /schema_version` is exactly `1`/i);
});


test('repository choice copy is plain language and errors stay visible at the current scroll position', () => {
  assert.match(source, /Repositories Clockoli can use for data storage/i);
  assert.match(source, /created from the Clockoli template/i);
  assert.match(styles, /#message\.error\{[^}]*position:fixed/);
  assert.match(styles, /#message\.error\{[^}]*z-index:/);
});


test('options mounts the shared running status directly below the tabs', () => {
  assert.match(source, /<\/nav>\s*<\/div>\s*<div id="running-status"/);
  assert.match(source, /href="\.\.\/styles\/running-status\.css"/);
  assert.match(script, /import \{ mountRunningStatus \} from '\.\.\/ui\/running-status\.js'/);
  assert.match(script, /mountRunningStatus\(\$\('running-status'\), \{ send \}\)/);
});


test('first run groups secondary cards and import under one closed More settings disclosure', () => {
  assert.match(source, /<details id="more-settings"[^>]*>\s*<summary[^>]*>More settings<\/summary>/);
  assert.doesNotMatch(source.match(/<details id="more-settings"[^>]*>/)?.[0] || '', /\bopen\b/);
  const secondary = source.slice(source.indexOf('<details id="more-settings"'), source.indexOf('</main>'));
  for (const id of ['display-settings', 'billing-settings', 'settings-backup', 'import-settings-file', 'advanced-settings']) {
    assert.match(secondary, new RegExp(`id="${id}"`));
  }
  assert.equal((source.match(/<h[1-6][^>]*>Connect GitHub<\/h[1-6]>/g) || []).length, 1);
  assert.match(source, /id="device-step"[^>]*aria-labelledby="connection-title"/);
});

test('setup completion gives the next action before optional repository verification details', () => {
  assert.match(source, /id="setup-complete"[^>]*>Setup complete\. Open a task page, then click the Clockoli icon to start tracking\.<\/p>/);
  assert.match(source, /id="setup-complete"[\s\S]*<details id="repository-verification"[\s\S]*<summary>Repository verification details<\/summary>[\s\S]*id="connected-storage"/);
});

test('each preferences form has its own live feedback beside its Save button', () => {
  for (const form of ['billing', 'display']) {
    assert.match(source, new RegExp(`id="save-${form}"[^>]*>[^<]+</button>\\s*<p id="${form}-feedback"[^>]*role="status"[^>]*aria-live="polite"`));
  }
});

test('setup docs describe the shipped three-step flow and current settings actions', async () => {
  const gettingStarted = await readFile(new URL('../docs/getting-started.md', import.meta.url), 'utf8');
  const troubleshooting = await readFile(new URL('../docs/troubleshooting.md', import.meta.url), 'utf8');
  assert.match(gettingStarted, /three guided steps/);
  assert.doesNotMatch(gettingStarted, /Step 4|four guided steps/);
  for (const label of ['Connect GitHub', 'Create private repository', 'Use existing repository', 'Grant repository access', 'Validate and connect', 'More settings', 'Use a personal access token', 'Validate and use PAT']) {
    assert.ok(gettingStarted.includes(`**${label}**`), label);
  }
  assert.match(gettingStarted, /automatically validates and connects/i);
  assert.match(gettingStarted, /Setup complete\. Open a task page, then click the Clockoli icon to start tracking\./);
  assert.doesNotMatch(troubleshooting, /Choose repository access on GitHub|Disconnect this browser/);
});
