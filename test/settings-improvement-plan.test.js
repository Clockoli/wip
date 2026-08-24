import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { onboardingStep } from '../src/options/onboarding-flow.js';

const root = new URL('../', import.meta.url);
const html = await readFile(new URL('src/options/options.html', root), 'utf8');
const script = await readFile(new URL('src/options/options.js', root), 'utf8');
const styles = await readFile(new URL('src/options/options.css', root), 'utf8');
const worker = await readFile(new URL('src/background/service-worker.js', root), 'utf8');
const policy = await readFile(new URL('src/background/message-policy.js', root), 'utf8');
const recovery = await readFile(new URL('src/domain/recovery-actions.js', root), 'utf8');

function section(id) {
  const start = html.indexOf(`id="${id}"`);
  assert.notEqual(start, -1, `missing ${id}`);
  const nextSection = html.indexOf('<section', start + 1);
  return html.slice(start, nextSection === -1 ? html.length : nextSection);
}

test('first run is a linear three-step connection flow with one obvious primary action', () => {
  assert.match(html, /Step <span id="current-step">1<\/span> of 3/);
  assert.match(html, /Connect GitHub[\s\S]*private GitHub repository[\s\S]*Only you and people you grant access to can see it/i);
  assert.match(html, /id="authorize"[^>]*>Connect GitHub<\/button>/);
  assert.match(html, /<details[^>]*id="connection-details"[\s\S]*<summary>How it works<\/summary>/i);
  assert.doesNotMatch(html, /four guided steps|of 4|Step 4/i);
  assert.equal(onboardingStep({ authorized: false }), 1);
  assert.equal(onboardingStep({ authorized: true, repositories: [], repositoryAccessDetected: false }), 2);
  assert.equal(onboardingStep({ authorized: true, repositories: [{ eligible: true }], repositoryAccessDetected: true }), 3);
});

test('repository creation and App grant are combined into step two while validation is step three', () => {
  const connect = section('repository-setup-step');
  assert.match(connect, /Create a private Clockoli data repository/i);
  assert.match(connect, /Use an existing private repository/i);
  assert.match(connect, /Only select repositories/i);
  assert.match(html, /id="repository-step"[\s\S]*Choose and validate/i);
  assert.doesNotMatch(html, /id="repository-access-step"/);
  assert.match(script, /\[2, 'repository-setup-step'\][\s\S]*\[3, 'repository-step'\]/);
  assert.doesNotMatch(script, /\[4, 'repository-step'\]|4: 'repository-step-title'/);
});

test('connected settings is a compact dashboard with primary status and secondary actions', () => {
  const connected = section('connected');
  for (const id of ['connected-account', 'connected-repository-link', 'connected-branch-link', 'connected-storage', 'connected-last-check', 'check-access', 'change-connection', 'manage-access']) {
    assert.match(connected, new RegExp(`id="${id}"`));
  }
  assert.match(connected, /Check access/);
  assert.match(connected, /Change repository/);
  assert.doesNotMatch(connected, /id="disconnect"|>Disconnect</);
  assert.match(script, /\$\('check-access'\)\.addEventListener/);
  assert.match(styles, /\.connection-dashboard/);
  assert.match(styles, /\.connected-secondary-actions/);
});

test('one contextual recovery action replaces the three-button recovery strip', () => {
  assert.match(html, /id="recovery-action"/);
  assert.match(html, /id="recovery-explanation"/);
  assert.doesNotMatch(html, /id="recovery-connect"|id="recovery-grant"|id="recovery-retry"/);
  assert.match(script, /recoveryAction/);
  assert.match(script, /recovery\.label/);
  assert.match(recovery, /repository_unavailable/);
});

test('regular local settings stay top-level while rare access controls are Advanced', () => {
  const advancedStart = html.indexOf('id="advanced-settings"');
  assert.notEqual(advancedStart, -1);
  const before = html.slice(0, advancedStart);
  const advanced = html.slice(advancedStart);
  for (const id of ['billing-settings', 'settings-backup']) assert.match(before, new RegExp(`id="${id}"`));
  for (const id of ['disconnect', 'clear-local', 'advanced-pat', 'revoke-action']) assert.match(advanced, new RegExp(`id="${id}"`));
  assert.doesNotMatch(advanced, /id="billing-settings"|id="settings-backup"/);
  assert.match(html, /<summary>Advanced<\/summary>/);
  assert.match(html, />Activity<\/h2>/);
  assert.match(html, />Backup &amp; restore<\/h2>/);
  assert.match(html, /<summary>What is included\?<\/summary>/);
});

test('rates and backup copy explain locality, exclusions, and offline restoration', () => {
  assert.match(html, /Rates are private to this browser/i);
  assert.match(html, /never written to your GitHub repository/i);
  assert.match(script, /rateLabel\.textContent = 'Hourly rate'/);
  assert.match(script, /currencyLabel\.textContent = 'Currency'/);
  assert.match(script, /currencyInput\.dataset\.initialValue/);
  assert.match(script, /row\.dataset\.currencyPosition/);
  assert.match(html, /Export settings/);
  assert.match(html, /Import settings/);
  assert.match(html, /credentials.*time entries.*never included/i);
  assert.match(html, /downloaded file[\s\S]*can be restored offline/i);
  assert.match(script, /clockoli-settings-backup-/);
});

test('local display settings stay available whenever local configuration exists', () => {
  assert.match(script, /\$\('display-settings'\)\.hidden = !state\.config/);
  assert.doesNotMatch(script, /\$\('display-settings'\)\.hidden = !state\.ready/);
});

test('connected access check validates the configured destination for App and PAT auth', () => {
  assert.match(script, /send\(\{ type: 'CHECK_REPOSITORY_ACCESS' \}\)/);
  assert.doesNotMatch(script.slice(script.indexOf("$('check-access').addEventListener"), script.indexOf("$('connect-repository').addEventListener")), /DISCOVER_REPOSITORIES/);
  assert.match(worker, /message\.type === 'CHECK_REPOSITORY_ACCESS'/);
  assert.match(worker, /auth\?\.mode === 'github_app'[\s\S]*recoverCurrentRepository/);
  assert.match(worker, /assertDestinationReachable\(\)/);
  assert.match(worker, /onboardingVerificationStatus: 'access_checked'/);
  assert.match(policy, /CHECK_REPOSITORY_ACCESS/);
});

test('choose recovery stays in Settings and opens the auth-appropriate repository editor', () => {
  assert.match(script, /function beginRepositoryChange/);
  assert.match(script, /recoveryAction\.kind === 'choose'[\s\S]*beginRepositoryChange\(\)/);
  assert.match(script, /state\?\.auth\?\.mode === 'pat'[\s\S]*advanced-settings[\s\S]*advanced-pat/);
  assert.doesNotMatch(script.slice(script.indexOf('function showRecovery'), script.indexOf('function isAppAuthorized')), /choose[^\n]*installationUrl|\['grant', 'choose'/);
});

test('zero hourly rates render and round-trip as zero rather than an empty required input', () => {
  assert.match(script, /Number\.isFinite\(Number\(rate\.amountMinorPerHour\)\)/);
  assert.doesNotMatch(script, /rate\.amountMinorPerHour \?/);
});

test('PAT permission recovery opens the local PAT editor instead of GitHub App installation', () => {
  assert.match(script, /state\?\.auth\?\.mode === 'pat'[\s\S]*\['grant', 'connect'\]\.includes\(recovery\.kind\)/);
  assert.match(script, /Update PAT access/);
  assert.match(script, /recoveryAction = \{[\s\S]*kind: recoveryKind[\s\S]*forceManualSelection: storageRepair/);
});

test('GitHub recovery handoff rechecks the configured destination when focus returns', () => {
  assert.match(script, /repositoryRecoveryHandoff = recoveryAction\.recheckConfigured/);
  assert.match(script, /if \(repositoryRecoveryHandoff[\s\S]*checkRepositoryAccess\(\)/);
  assert.match(script, /function checkRepositoryAccess\(\)/);
});

test('blocked GitHub recovery popups do not leave an armed handoff', () => {
  assert.match(script, /function openGitHubHandoff/);
  assert.match(script, /const opened = window\.open\('', '_blank'\)/);
  assert.match(script, /if \(!opened\) return false/);
  const handler = script.slice(script.indexOf("$('recovery-action').addEventListener"));
  assert.match(handler, /if \(!openGitHubHandoff\(recoveryAction\.url\)\)[\s\S]*Browser blocked/);
  assert.ok(handler.indexOf('openGitHubHandoff(recoveryAction.url)') < handler.indexOf('repositoryRecoveryHandoff = recoveryAction.recheckConfigured'));
});

test('storage-format recovery returns to repository selection instead of a shallow access handoff', () => {
  assert.match(script, /const storageRepair = recovery\.kind === 'repair'/);
  assert.match(script, /patUpdate \|\| storageRepair \? 'choose'/);
  assert.doesNotMatch(script.slice(script.indexOf('function showRecovery'), script.indexOf('function isAppAuthorized')), /recoveryKind === 'repair'/);
});

test('one eligible repository completes setup without a manual validation click', () => {
  assert.match(script, /relevantCandidates\.length === 1 && !suppressRepositoryAutoConnect\)[\s\S]*await connectSelectedRepository\(\{ automatic: true \}\)/);
  assert.match(script, /async function connectSelectedRepository/);
});

test('repository monitoring stops immediately after automatic connection completes', () => {
  assert.match(script, /await discoverRepositories\(\{ monitoring: true, deadline: repositoryMonitorDeadline \}\);\s*if \(state\?\.ready\) \{\s*stopRepositoryMonitoring\(\);\s*return;\s*\}/);
});

test('Retry after a connected access-check failure repeats the destination check', () => {
  assert.match(script, /showRecovery\(error, \{ retry: 'access' \}\)/);
  assert.match(script, /if \(recoveryAction\.retry === 'access'\) \{\s*void checkRepositoryAccess\(\);\s*return;\s*\}/);
});

test('App grant handoff rechecks a destination only when one is configured', () => {
  assert.match(script, /recheckConfigured: Boolean\(state\?\.ready && state\?\.config\)/);
  assert.match(script, /repositoryRecoveryHandoff = recoveryAction\.recheckConfigured/);
});

test('expired PAT recovery opens the local PAT editor instead of Device Flow', () => {
  assert.match(script, /state\?\.auth\?\.mode === 'pat'[\s\S]*\['grant', 'connect'\]\.includes\(recovery\.kind\)/);
  assert.match(script, /patUpdate[\s\S]*recoveryKind[\s\S]*'choose'/);
});

test('storage recovery suppresses one-repository auto-connect until the user validates a choice', () => {
  assert.match(script, /forceManualSelection: storageRepair/);
  assert.match(script, /suppressRepositoryAutoConnect = recoveryAction\.forceManualSelection/);
  assert.match(script, /relevantCandidates\.length === 1 && !suppressRepositoryAutoConnect/);
});
