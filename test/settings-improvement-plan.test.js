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

test('first run has two steps: GitHub sign-in then repository selection regardless of access state', () => {
  assert.match(html, /Step <span id="current-step">1<\/span> of 2/);
  assert.match(html, /Set up Clockoli[\s\S]*private GitHub repository[\s\S]*Only you and people you grant access to can see it/i);
  assert.match(html, /id="authorize"[^>]*>Sign in with GitHub<\/button>/);
  assert.match(html, /Clockoli copies the one-time code before opening GitHub so you can paste it/);
  assert.match(html, /<details[^>]*id="connection-details"[\s\S]*<summary>How it works<\/summary>/i);
  assert.doesNotMatch(html, /of [34]|Step [34]/i);
  assert.equal(onboardingStep({ authorized: false }), 1);
  assert.equal(onboardingStep({ authorized: true, repositories: [], repositoryAccessDetected: false }), 2);
  assert.equal(onboardingStep({ authorized: true, repositories: [{ eligible: true }], repositoryAccessDetected: true }), 2);
  assert.equal(onboardingStep({ authorized: true, repositories: [{ eligible: false }], repositoryAccessDetected: true }), 2);
});

test('step two offers repositories and a manual target with conditional App access, not scenario choices', () => {
  const connect = section('repository-step');
  assert.match(connect, /Connect time repositories/i);
  assert.match(connect, /id="repository-target-form"[\s\S]*Enter a repository URL or owner\/name[\s\S]*id="repository-target"/);
  assert.match(connect, /id="repository-list"/);
  assert.match(connect, /<a id="new-time-repository"[^>]*>Create a new time repository<\/a>/);
  assert.match(connect, /id="repository-access-panel"[^>]*hidden/);
  assert.match(connect, /Only select repositories/i);
  assert.doesNotMatch(connect, /id="connect-repository"|id="refresh-repositories"/);
  assert.match(connect, /id="setup-default-destination"/);
  assert.match(connect, /id="finish-setup"[^>]*disabled[^>]*>Finish setup/);
  assert.doesNotMatch(html, /id="repository-(?:setup|access)-step"|data-repository-choice|id="choose-existing-repository"/);
  assert.match(script, /\$\('repository-step'\)\.hidden = step !== 2/);
  const access = script.slice(script.indexOf('function renderRepositoryAccess()'), script.indexOf('function repositoryActionKey('));
  assert.match(access, /Boolean\(repositoryTarget\)[\s\S]*discoveryStatus === 'ready' && !selectedRepository/);
  assert.match(access, /selectedRepository\?\.reasons\?\.includes\('app_contents_write_required'\)/);
  assert.match(access, /if \(!\(missing \|\| needsAppWrite\)\) closeRepositoryAccess\(\)/);
  assert.match(access, /Its existence is not confirmed/);
});

test('connected settings separates account controls from the destination registry', () => {
  const connected = section('connected');
  for (const id of ['connected-account', 'manage-authorization', 'disconnect']) {
    assert.match(connected, new RegExp(`id="${id}"`));
  }
  assert.doesNotMatch(connected, /connected-repository-link|connected-branch-link|connected-storage/);
  assert.doesNotMatch(html, /id="time-repositories-details"/);
  assert.match(html, /id="time-repository-list"/);
  assert.match(html, /id="add-time-repository"[^>]*class="button-link secondary-link time-repositories-add"/);
  assert.match(html, /id="manage-authorization"[^>]*class="button-link secondary-link"/);
  assert.match(styles, /\.time-repository/);
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

test('repository routing stays top-level while local secondary settings remain grouped', () => {
  const advancedStart = html.indexOf('id="advanced-settings"');
  assert.notEqual(advancedStart, -1);
  const before = html.slice(0, advancedStart);
  const advanced = html.slice(advancedStart);
  for (const id of ['time-repositories', 'display-settings', 'disconnect']) assert.match(before, new RegExp(`id="${id}"`));
  for (const id of ['clear-local', 'advanced-pat', 'revoke-action']) assert.match(advanced, new RegExp(`id="${id}"`));
  assert.doesNotMatch(advanced, /id="time-repositories"|id="display-settings"|id="disconnect"/);
  assert.match(html, /<summary>Advanced<\/summary>/);
  assert.match(html, />Projects and routing<\/h2>/);
  assert.match(html, />Backup &amp; restore<\/h2>/);
  assert.match(html, /<summary>What is included\?<\/summary>/);
});

test('rates and backup copy explain locality, exclusions, and offline restoration', () => {
  assert.match(html, /Add date ranges if a rate changes over time\. Rates are private to this browser;/i);
  assert.match(html, /never written to your GitHub repository/i);
  assert.doesNotMatch(html, /class="local-only-note"/);
  assert.match(script, /Repository initialized\. Clockoli verified the setup write\./);
  assert.match(script, /Repository joined\. Clockoli registered your storage branch\./);
  assert.doesNotMatch(script, /without an unnecessary write/);
  assert.match(script, /rateLabel\.textContent = 'Hourly rate'/);
  assert.match(script, /currencyLabel\.textContent = 'Currency'/);
  assert.match(script, /currencyInput\.dataset\.initialValue/);
  assert.match(script, /row\.dataset\.currencyPosition/);
  assert.match(html, /Export settings/);
  assert.match(html, /class="file-action"[^>]*>Import settings<input id="import-settings-file"/);
  assert.doesNotMatch(html, /id="import-settings"/);
  assert.match(script, /import-settings-file'\)\.addEventListener\('change', async/);
  assert.match(html, /credentials.*time entries.*never included/i);
  assert.match(html, /downloaded file[\s\S]*can be restored offline/i);
  assert.match(script, /clockoli-settings-backup-/);
});

test('local display settings stay available whenever local configuration exists', () => {
  assert.match(script, /\$\('display-settings'\)\.hidden = !state\.config/);
  assert.doesNotMatch(script, /\$\('display-settings'\)\.hidden = !state\.ready/);
});

test('each connected destination has an explicit scoped access check', () => {
  assert.match(script, /send\(\{ type: 'CHECK_REPOSITORY_ACCESS', destinationId: destination\.id \}\)/);
  assert.match(script, /className = 'secondary check-repository-access'/);
  assert.match(worker, /message\.type === 'CHECK_REPOSITORY_ACCESS'/);
  assert.match(worker, /auth\?\.mode === 'github_app'[\s\S]*recoverCurrentRepository/);
  assert.match(worker, /assertDestinationReachable\(\)/);
  assert.match(worker, /saveDestinationVerification\(selectedId, 'access_checked', lastVerifiedAt\)/);
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

test('discovery never writes and explicit modal confirmation discloses administrator initialization', () => {
  const render = script.slice(script.indexOf('function renderRepositories('), script.indexOf('function reviewSelectedRepository('));
  assert.match(render, /selectedRepository = repositoryInputDirty \? null : repositoryTarget/);
  assert.match(render, /repositories\.find\([^\n]+\) \|\| null/);
  assert.match(render, /updateRepositoryConfirmation\(\)/);
  const review = script.slice(script.indexOf('function reviewSelectedRepository('), script.indexOf('async function confirmRepositoryAction('));
  assert.match(review, /pendingConfirmation = \{/);
  assert.match(review, /Repository administrator confirmation is required/);
  assert.match(review, /Create \.clockoli\/config\.json/);
  assert.match(review, /showModal\(\)/);
  assert.match(review, /\$\('repository-confirmation'\)\.hidden = false/);
  assert.doesNotMatch(render + review, /send\(|SELECT_REPOSITORY/);
  const confirm = script.slice(script.indexOf('async function confirmRepositoryAction('), script.indexOf('async function discoverRepositories('));
  assert.match(confirm, /if \(!pendingConfirmation \|\| repositoryActionApplying\) return false/);
  assert.match(confirm, /type: 'SELECT_REPOSITORY'/);
  assert.match(script, /\$\('confirm-repository-action'\)\.addEventListener\('click', \(\) => void confirmRepositoryAction\(\)\)/);
  assert.doesNotMatch(script, /connectSelectedRepository\(\{ automatic: true \}\)/);
});

test('repository polling stays silent and read-only until its lifecycle stops', () => {
  const polling = script.slice(script.indexOf('function repositoryPollingActive('), script.indexOf('function addRateRow('));
  assert.match(polling, /!repositoryPollingStopped && !setupCancelled && isAppAuthorized\(\)/);
  assert.match(polling, /repositoryLifecycle\+\+/);
  assert.match(polling, /clearTimeout\(repositoryMonitorTimer\)/);
  assert.match(polling, /!pendingConfirmation && !repositoryActionApplying/);
  assert.match(polling, /!discoveryPromise/);
  assert.match(polling, /await discoverRepositories\(\{ silent: true \}\)/);
  assert.match(polling, /}, 3000\)/);
  assert.match(polling, /addEventListener\('pagehide'/);
  assert.doesNotMatch(polling, /SELECT_REPOSITORY|confirmRepositoryAction\(|reviewSelectedRepository\(|showModal/);
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

test('storage recovery returns to selection under the universal explicit-confirm gate', () => {
  assert.match(script, /const storageRepair = recovery\.kind === 'repair'[\s\S]*storageRepair \? 'choose'/);
  assert.match(script, /recoveryAction\.kind === 'choose'[\s\S]*beginRepositoryChange\(\)/);
  const change = script.slice(script.indexOf('function beginRepositoryChange('), script.indexOf('async function checkRepositoryAccess('));
  assert.match(change, /showOnboarding = true[\s\S]*discoveryStatus = 'idle'[\s\S]*discoverRepositories\(\)/);
  assert.doesNotMatch(change, /repositoryChoiceMode|rememberRepositoryTarget\(''\)|SELECT_REPOSITORY/);
  assert.match(script, /updateRepositoryConfirmation[\s\S]*pendingConfirmation = null/);
  assert.doesNotMatch(script, /suppressRepositoryAutoConnect/);
});

test('direct repository selection is accessible and exposes check progress and focused review', () => {
  assert.match(html, /<label for="repository-target">Enter a repository URL or owner\/name<\/label>[\s\S]*<input id="repository-target"/);
  assert.match(html, /id="repository-target-status"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html, /id="refresh-repository-target"[^>]*type="button"[^>]*aria-label="Recheck repository"/);
  assert.match(html, /id="repository-confirmation"[^>]*tabindex="-1"[^>]*hidden/);
  assert.match(html, /id="confirm-repository-action"[^>]*type="button"/);
  assert.doesNotMatch(html, /Unavailable repositories include the reason/);
  assert.match(styles, /\.repository-option/);
  assert.match(styles, /\.repository-icon/);
  assert.doesNotMatch(script, /radio\.type = 'radio'/);
  assert.match(script, /status\.textContent = statusLabel/);
  assert.match(script, /action\.textContent = checkingRepositoryTarget === repository.fullName \? 'Checking…'/);
  const check = script.slice(script.indexOf('async function checkRepositoryTarget'), script.indexOf("$('close-repository-access').addEventListener"));
  assert.match(check, /!repositoryInputDirty && repositoryTarget === target/);
  assert.match(check, /repositoryActionKey\(selectedRepository\) !== 'connect' && !reviewSelectedRepository\(\)/);
  assert.match(check, /repositoryInputDirty = true;\s*repositoryCheckError = '';\s*selectedRepository = null;\s*updateRepositoryConfirmation\(\)/);
  assert.doesNotMatch(check, /SELECT_REPOSITORY/);
  assert.match(script, /\$\('repository-confirmation'\)\.showModal\(\)/);
  assert.match(styles, /@media\(max-width:400px\)/);
  assert.match(styles, /\.actions button,[^}]*width:100%/);
});


test('billable rate End date is visibly optional and empty means current through today', () => {
  assert.match(script, /endLabel\.textContent = 'End date \(optional\)'/);
  assert.match(html, /id="rate-date-help"[^>]*>Leave End date empty if the rate is still current\. Clockoli applies it through today/);
});
