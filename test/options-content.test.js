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
  assert.match(source, /Step <span id="current-step">1<\/span> of 2/i);
  assert.match(source, /id="authorize"[^>]*>Sign in with GitHub<\/button>/);
  for (const id of ['device-code', 'install-app', 'repository-list', 'finish-setup']) assert.match(source, new RegExp(`id="${id}"`));
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
  assert.match(source, /id="authorize"[^>]*>Sign in with GitHub<\/button>/i);
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
  assert.match(script, /Enter a repository URL or owner\/name/i);
});

test('repository-first choice has no scenario or owner preselection', () => {
  assert.match(source, /id="repository-target"/);
  assert.match(source, /id="new-time-repository"[^>]*>Create a new time repository/i);
  assert.doesNotMatch(source, /id="repository-setup-step"|id="choose-existing-repository"|id="choose-empty-repository"/);
  assert.doesNotMatch(source, /Use a personal repository|Join an organization repository|Set up an organization repository/i);
  assert.match(script, /configuredDestinations\(\)\.length === 0[\s\S]*discoverRepositories/);
});

test('repository list has independent actions and local icons, not radio selection', () => {
  assert.match(styles, /\.repository-icon/);
  assert.match(script, /selectable \? repositoryAction\(repository\)/);
  assert.doesNotMatch(script, /radio.type = 'radio'/);
  assert.match(source, /id="setup-default-destination"/);
});

test('Repository selection uses review then action-specific confirmation', () => {
  assert.match(source, /id="repository-step"[\s\S]*Connect time repositories/i);
  assert.match(source, /id="repository-access-instruction"/i);
  assert.match(source, /id="install-app"[\s\S]*Grant access/i);
  assert.doesNotMatch(source, />Review connection</i);
  assert.match(source, /<dialog id="repository-confirmation"[^>]*aria-labelledby="repository-confirmation-title"/i);
  assert.match(source, /id="confirm-repository-action"/i);
  assert.doesNotMatch(source, /repository-write-confirmation/i);
  assert.ok(script.indexOf('function reviewSelectedRepository') < script.indexOf('function confirmRepositoryAction'));
  assert.match(script, /confirmRepositoryAction[\s\S]*type: 'SELECT_REPOSITORY'[\s\S]*action:/);
});

test('Add repository confirmation discloses personal-branch provisioning', () => {
  assert.match(script, /add: 'Clockoli will add this repository[^']*create or verify your personal storage branch/);
  assert.match(script, /intent === 'add'[\s\S]*`Create or verify branch clockoli\/users\//);
});

test('sign-in leads directly to the repository step even before access is granted', () => {
  assert.match(source, /of 2/);
  assert.doesNotMatch(source, /id="repository-access-complete"/);
  assert.match(script, /\$\('repository-step'\)\.hidden = step !== 2/);
});

test('onboarding renders one active step, keeps cancel below it, and names repository actions precisely', () => {
  for (const id of ['device-step', 'repository-step']) assert.match(source, new RegExp(`id="${id}"`));
  assert.doesNotMatch(source, /id="repository-access-step"/);
  assert.match(script, /\$\('device-step'\)\.hidden = step !== 1/);
  for (const id of ['connection-title', 'repository-step-title']) assert.match(source, new RegExp(`id=\"${id}\" tabindex=\"-1\"`));
  assert.match(script, /previousStep !== null && previousStep !== step[\s\S]*focus\(\)/);
  assert.equal((source.match(/id="install-app"/g) || []).length, 1);
  assert.ok(source.indexOf('id="cancel-app-setup"') > source.indexOf('id="repository-step"'));
});

test('PAT setup remains an explicit advanced compatibility path without direct credential storage access', () => {
  assert.match(source, /<details[^>]*id="advanced-settings"/);
  assert.match(source, /<details[^>]*id="advanced-pat"[\s\S]*Use a personal access token/i);
  assert.doesNotMatch(script, /chrome\.storage|indexedDB|getAuthSnapshot|getPendingAuthSnapshot/);
  assert.deepEqual([...new Set([...script.matchAll(/choiceStore\.(\w+)\s*\(/g)].map(match => match[1]))].sort(),
    ['getOnboardingRepositoryChoice', 'saveOnboardingRepositoryChoice'],
    'direct store access is limited to UI-only repository intent, never credentials');
  assert.match(script, /SAVE_CONFIG/);
  assert.doesNotMatch(source, /Private time-data repository/);
  assert.match(source, /Repository used by this token/);
});

test('queue diagnostics saves from its own control without submitting dirty routing fields', () => {
  assert.doesNotMatch(source, /id="show-queue-diagnostics"[^>]*form="display-form"/);
  assert.match(source, /id="diagnostics-feedback"/);
  const handler = script.slice(script.indexOf("$('show-queue-diagnostics').addEventListener"), script.indexOf("$('display-form').addEventListener"));
  assert.match(handler, /SET_QUEUE_DIAGNOSTICS/);
  assert.match(handler, /enabled: control\.checked/);
  assert.doesNotMatch(handler, /UPDATE_DISPLAY_PREFERENCES|renderLocalPreferences/);
  assert.doesNotMatch(handler, /projectsPayload\(\)|other-project-name/);
});

test('queue diagnostics checkbox stays aligned with its label text', () => {
  assert.match(source, /<label class="diagnostics-toggle"><input id="show-queue-diagnostics"/);
  assert.match(styles, /\.diagnostics-toggle\{[^}]*display:inline-flex[^}]*align-items:center[^}]*gap:8px/);
  assert.match(styles, /\.diagnostics-toggle input\{[^}]*width:auto[^}]*margin:0/);
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

test('connected settings separate the GitHub account from time repositories', () => {
  for (const id of ['connected-account', 'manage-authorization', 'disconnect', 'time-repositories', 'time-repository-list', 'add-time-repository']) assert.match(source, new RegExp(`id="${id}"`, 'i'));
  assert.doesNotMatch(source, /id="connected-repository"|id="connected-branch-link"/);
  assert.match(source, /id="revoke-action"[\s\S]*Revoke GitHub sign-in/);
  assert.match(script, /function renderDestinationCards/);
  assert.match(script, /\$\('add-time-repository'\)\.addEventListener/);
  assert.match(script, /DISCONNECT_GITHUB_APP/);
  assert.match(styles, /\.time-repository/);
  assert.match(styles, /\.connected-secondary-actions/);
});

test('Device Flow cancellation bypasses the tracker mutation executor and shares one live service', () => {
  assert.match(worker, /let activeDeviceFlow = null/);
  assert.match(worker, /DIRECT_DEVICE_FLOW_MESSAGES = new Set\(\[[\s\S]*POLL_DEVICE_FLOW[\s\S]*CANCEL_DEVICE_FLOW/);
  assert.match(worker, /const direct = readOnly \|\| DIRECT_DEVICE_FLOW_MESSAGES\.has/);
  assert.match(worker, /const attempt = \(\) => direct \? handle\(message, sender\)[\s\S]*acceptsLocally \? acceptanceExecutor\.run[\s\S]*executor\.run/);
});


test('repository polling is silent, read-only, bounded by lifecycle, and has no refresh button', () => {
  assert.doesNotMatch(source + script, /refresh-repositories|monitorRepositories|repositoryMonitorDeadline/);
  assert.match(script, /}, 3000\)/);
  assert.match(script, /revision !== repositoryLifecycle/);
  assert.match(script, /repositoryListSignature === signature/);
  assert.match(script, /if \(!silent && revision === repositoryLifecycle\)/);
  const silent = script.slice(script.indexOf('    if (silent) {'), script.indexOf('    } else {', script.indexOf('    if (silent) {')));
  assert.match(silent, /renderRepositoryList\(\)/);
  assert.doesNotMatch(silent, /selectedRepository\s*=|rememberRepositoryTarget|message\(|showModal|reviewSelectedRepository|SELECT_REPOSITORY/);
  assert.match(script, /pendingConfirmation \|\| repositoryActionApplying/);
  assert.match(script, /addEventListener\('pagehide'/);
  const grant = script.slice(script.indexOf("$('install-app').addEventListener"), script.indexOf("for (const id of ['new-time-repository', 'modal-new-time-repository'])"));
  assert.ok(grant.indexOf('closeRepositoryAccess()') < grant.indexOf('openGitHubHandoff('));
  assert.doesNotMatch(grant, /SELECT_REPOSITORY/);
});

test('repository reasons and recovery actions use user-facing contracts', () => {
  for (const reason of ['private_required', 'archived', 'disabled', 'app_contents_write_required', 'user_write_required', 'initialized_default_branch_required']) assert.match(script, new RegExp(`${reason}:`));
  for (const code of ['app_installation_required', 'org_approval_required', 'repository_access_required', 'github_app_auth_required', 'branch_policy_rejected']) assert.match(recovery, new RegExp(code));
  assert.match(source, /id="recovery-action"/);
  assert.match(script, /recovery\.label/);
  assert.doesNotMatch(source, /id="recovery-connect"|id="recovery-grant"|id="recovery-retry"/);
});

test('each destination status distinguishes write verification from access checking', () => {
  assert.match(script, /write_verified/);
  assert.match(script, /Connected · write verified/);
  assert.match(script, /Connected · access checked/);
});

test('normal popup uses the shared tracker setup and directs users to Set up Clockoli', async () => {
  const [popup, tracker] = await Promise.all([
    readFile(new URL('../src/popup/popup.html', import.meta.url), 'utf8'),
    readFile(new URL('../src/content/github.js', import.meta.url), 'utf8'),
  ]);
  assert.match(popup, /src="\.\.\/content\/github\.js"/);
  assert.match(tracker, /Set up Clockoli/);
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
  for (const label of ['Sign in with GitHub', 'Grant access', 'Choose another repository', 'Retry']) assert.match(recovery, new RegExp(label));
});

test('public Device Flow resume uses validated service state rather than raw storage', () => {
  assert.match(worker, /RESUME_DEVICE_FLOW'\) return deviceFlow\(\)\.resume\(\)/);
  assert.doesNotMatch(worker, /RESUME_DEVICE_FLOW'\) return safeAttempt\(await store\.getDeviceAttempt\(\)\)/);
});

test('compliance documentation matches any-owner tracking and durable v1 work-item titles', async () => {
  const compliance = await readFile(new URL('../docs/spec-compliance.md', import.meta.url), 'utf8');
  assert.doesNotMatch(compliance, /configurable allowlist/i);
  assert.match(compliance, /Work-item identity .* title/i);
  assert.match(compliance, /schema_version` is exactly `1`/i);
});


test('repository choice copy is plain language and errors stay visible at the current scroll position', () => {
  assert.match(source, /Repositories granted to the GitHub App/i);
  assert.match(source, /explicitly connect a ready repository, regardless of who owns it/i);
  assert.match(source, /Anyone with read access[\s\S]*stored task URLs, titles, timestamps, and descriptions/i);
  assert.match(styles, /#message\.error\{[^}]*position:fixed/);
  assert.match(styles, /#message\.error\{[^}]*z-index:/);
});


test('options mounts the shared running status directly below the tabs', () => {
  assert.match(source, /<\/nav>\s*<\/div>\s*<div id="running-status"/);
  assert.match(source, /href="\.\.\/styles\/running-status\.css"/);
  assert.match(script, /import \{ mountRunningStatus \} from '\.\.\/ui\/running-status\.js'/);
  assert.match(script, /mountRunningStatus\(\$\('running-status'\), \{ send \}\)/);
});


test('multi-repository routing stays top-level while secondary settings remain grouped', () => {
  assert.match(source, /<details id="more-settings"[^>]*>\s*<summary[^>]*>More settings<\/summary>/);
  assert.doesNotMatch(source.match(/<details id="more-settings"[^>]*>/)?.[0] || '', /\bopen\b/);
  const secondary = source.slice(source.indexOf('<details id="more-settings"'), source.indexOf('</main>'));
  for (const id of ['billing-settings', 'settings-backup', 'import-settings-file', 'advanced-settings']) {
    assert.match(secondary, new RegExp(`id="${id}"`));
  }
  assert.ok(source.indexOf('id="time-repositories"') < source.indexOf('<details id="more-settings"'));
  assert.ok(source.indexOf('id="display-settings"') < source.indexOf('<details id="more-settings"'));
  assert.match(source, /id="device-step"[^>]*aria-labelledby="connection-title"/);
});

test('connected repository details are rendered per destination rather than as one singleton card', () => {
  assert.doesNotMatch(source, /id="setup-complete"|id="repository-verification"|id="connected-storage"/);
  assert.match(script, /function renderDestinationCard\(destination, isDefault\)/);
  assert.match(script, /document\.createElement\('details'\)/);
  assert.match(script, /const header = document\.createElement\('summary'\)/);
  assert.match(script, /repositoryMetadata\(destination\)/);
});

test('each preferences form has its own live feedback beside its Save button', () => {
  for (const form of ['billing', 'invoicing', 'display']) {
    assert.match(source, new RegExp(`id="save-${form}"[^>]*>[^<]+</button>\\s*<p id="${form}-feedback"[^>]*role="status"[^>]*aria-live="polite"`));
  }
});

test('settings exposes browser-only invoicing parties, numbering and terms', () => {
  const billingEnd = source.indexOf('</section>', source.indexOf('id="billing-settings"'));
  const invoicingStart = source.indexOf('id="invoicing-settings"');
  assert.ok(invoicingStart > billingEnd, 'Invoicing follows Billable rates');
  for (const id of [
    'invoicing-form', 'seller-name', 'seller-address', 'seller-email', 'seller-tax-id', 'clients-list',
    'add-client', 'invoice-next-number', 'invoice-number-format', 'invoice-payment-terms',
    'invoice-tax-percent', 'invoice-notes', 'save-invoicing', 'invoicing-feedback',
  ]) assert.match(source, new RegExp(`id="${id}"`), id);
  assert.match(source, /never written to the GitHub repository/i);
  assert.match(source, /\{YYYY\}.*\{MM\}.*\{NNNN\}/);
  assert.match(script, /function addClientRow\(/);
  assert.match(script, /function ratesPayload\(\)/);
  assert.match(script, /function invoicingPayload\(\)/);
  assert.match(script, /payload: \{ rates: ratesPayload\(\) \}/);
  assert.match(script, /payload: \{ invoicing: invoicingPayload\(\) \}/);
  assert.doesNotMatch(script, /return \{ rates, invoicing:/);
  for (const id of ['seller-address', 'invoice-notes']) assert.match(source, new RegExp(`id="${id}"[^>]*rows="1"`));
  assert.match(styles, /#seller-address,#invoice-notes\{[^}]*max-height:calc\(/);
});

test('setup UI has two steps while docs retain explicit-write safety and multi-repository IA', async () => {

  const gettingStarted = await readFile(new URL('../docs/getting-started.md', import.meta.url), 'utf8');
  const troubleshooting = await readFile(new URL('../docs/troubleshooting.md', import.meta.url), 'utf8');
  assert.match(source, /Step <span id="current-step">1<\/span> of 2:/);
  assert.doesNotMatch(source, /id="repository-setup-step"|id="repository-access-step"/);
  for (const label of ['Sign in with GitHub', 'Grant access', 'Finish setup', 'Initialize repository', 'Join repository', 'Set up storage branch', 'More settings', 'Use a personal access token', 'Validate and use PAT']) {
    assert.ok(gettingStarted.includes(`**${label}**`), label);
  }
  assert.match(gettingStarted, /two guided steps/i);
  assert.doesNotMatch(gettingStarted, /three guided steps|### Step 3:/i);
  for (const label of ['Check repository']) {
    assert.ok(gettingStarted.includes(`**${label}**`), label);
  }
  assert.match(gettingStarted, /manual target.*leave the field or press Enter/);
  assert.match(gettingStarted, /Discovery and inspection never write to GitHub/i);
  assert.match(gettingStarted, /then explicitly confirm the offered action/i);
  assert.match(gettingStarted, /requires fresh GitHub repository-admin permission/i);
  assert.match(gettingStarted, /does not replace a missing target with another available repository/i);
  assert.match(gettingStarted, /GitHub account[\s\S]*Time repositories[\s\S]*Projects and routing/i);
  assert.doesNotMatch(troubleshooting, /Choose repository access on GitHub|Disconnect this browser/);
});
