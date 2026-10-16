import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { onboardingStep, parseRepositoryTarget, selectOnlyEligibleRepository, settleBeforeDeadline } from '../src/options/onboarding-flow.js';
import { invoicingSettings, normalizeInvoicingSettings, normalizeProjects, parseRateFields } from '../src/domain/local-settings.js';
import { taskPeriodRange } from '../src/domain/tasks.js';
import { normalizeStoredTaskIdentity, normalizeTaskUrl } from '../src/domain/values.js';


const html = await readFile(new URL('../src/options/options.html', import.meta.url), 'utf8');
const widthCss = await readFile(new URL('../src/styles/interface-width.css', import.meta.url), 'utf8');
const source = await readFile(new URL('../src/options/options.js', import.meta.url), 'utf8');

test('Settings stays in a centered column regardless of the shared width preference', () => {
  assert.match(html, /<main class="settings-main">/);
  assert.match(widthCss, /html\[data-clockoli-width="full"\] main:not\(\.settings-main\)\s*\{\s*max-width:none;\s*\}/);
});
const preferences = {
  rates: { octocat: [{ amountMinorPerHour: 12500, currency: 'EUR', currencyPosition: 'suffix', startDate: '', endDate: '' }] },
  invoicing: {
    seller: { name: 'Seller', address: 'Street', email: 'seller@example.com', taxId: 'TAX-1' },
    clients: [{ id: 'client-1', name: 'Client', address: 'Road', email: 'client@example.com', taxId: 'TAX-2', defaultCurrency: 'EUR' }],
    nextNumber: 7, numberFormat: 'INV-{YYYY}-{NNNN}', paymentTerms: 'Net 30', taxPercent: 20, notes: 'Thanks',
  },
  projects: [], otherProjectClient: '', recentDays: 7, revision: 0, exportRecommended: false,
};
const connectedState = {
  ready: true, appConfigured: true, auth: { mode: 'github_app', githubLogin: 'octocat' },
  config: { owner: 'octocat', repo: 'clockoli-data', branch: 'main', recentDays: 7 },
  verificationStatus: 'write_verified', trackingRepositoryUrl: 'https://github.com/octocat/clockoli-data',
};

function element(tagName = 'div') {
  const node = {
    tagName,
    hidden: false, open: false, disabled: false, value: '', textContent: '', className: '',
    dataset: {}, style: {}, attributes: {}, children: [], listeners: {}, classList: { toggle() {} },
    append(...children) { for (const child of children) { child.parentNode = this; this.children.push(child); } },
    replaceChildren(...children) { this.children = []; this.textContent = ''; this.append(...children); },
    setAttribute(name, value) { this.attributes[name] = value; }, removeAttribute(name) { delete this.attributes[name]; }, focus() { this.focused = true; }, scrollIntoView() { this.scrolled = true; },
    showModal() { this.open = true; }, close() { this.open = false; this.listeners.close?.(); },
    querySelectorAll(selector) { const className = selector.startsWith('.') ? selector.slice(1) : ''; const matches = child => className && child.className.split(' ').includes(className); return this.children.flatMap(child => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]); },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    contains(child) { return this === child || this.children.some(node => node.contains(child)); },
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); },

    addEventListener(type, handler) { this.listeners[type] = handler; },
  };
  return node;
}

function harness({ reply = () => ({}), confirm = () => false, savedChoices = new Map(), collaboratorReplies = false } = {}) {
  const nodes = new Map([...html.matchAll(/id="([^"]+)"/g)].map(([, id]) => [id, element()]));
  for (const [, id, label] of html.matchAll(/<button\b[^>]*id="([^"]+)"[^>]*>([^<]*)<\/button>/g)) nodes.get(id).textContent = label;
  const requests = [], timers = [], windowListeners = {}, documentListeners = {}, tabListeners = {};
  const context = vm.createContext({
    document: { documentElement: { dataset: {} }, getElementById: id => nodes.get(id), createElement: tag => element(tag), createElementNS: (_, tag) => element(tag), addEventListener(type, handler) { documentListeners[type] = handler; }, removeEventListener(type) { delete documentListeners[type]; } },
    window: { addEventListener(type, handler) { windowListeners[type] = handler; }, confirm }, URL,
    setTimeout: (callback, delay) => { const timer = { callback, delay, cleared: false }; timers.push(timer); return timer; }, clearTimeout(timer) { if (timer) timer.cleared = true; }, queueMicrotask: callback => callback(),
    onboardingStep, parseRepositoryTarget, selectOnlyEligibleRepository, settleBeforeDeadline, normalizeProjects, parseRateFields, normalizeInvoicingSettings, invoicingSettings, taskPeriodRange, normalizeStoredTaskIdentity, normalizeTaskUrl,
    ChromeStore: class { async getOnboardingRepositoryChoice(account) { return savedChoices.get(account) || ''; } async saveOnboardingRepositoryChoice(account, name) { savedChoices.set(account, name); } },

    ClockoliRecovery: { actionFor: () => null },
    chrome: { tabs: { getCurrent: async () => ({ id: 11, windowId: 1 }), onActivated: { addListener(handler) { tabListeners.activated = handler; } } }, runtime: { sendMessage(request, callback) {
      if (request.type === 'LOAD_REPOSITORY_COLLABORATORS' && !collaboratorReplies) {
        callback({ ok: true, data: { users: [], hasMore: false } });
        return;
      }
      requests.push(request);
      const result = reply(request);
      const respond = value => callback(value instanceof Error ? { ok: false, error: { message: value.message } } : { ok: true, data: value });
      if (result?.then) result.then(respond, error => callback({ ok: false, error: { message: error.message } }));
      else respond(result);

    } } },
  });
  vm.runInContext(source.replace(/^import .*;\n/gm, '').slice(0, source.replace(/^import .*;\n/gm, '').indexOf('refreshState().then(refreshLocalPreferences)')), context);
  return {
    nodes, requests, timers, context, windowListeners, documentListeners, tabListeners,
    render(state) { context.nextState = state; vm.runInContext('state = nextState; renderState();', context); },
    submit(id, submitter = null) { return nodes.get(id).listeners.submit({ preventDefault() {}, submitter }); },
  };
}

function billingSaveResult(request, current = preferences) {
  return {
    rates: request.payload.rates ?? current.rates,
    invoicing: request.payload.invoicing ?? current.invoicing,
    projects: current.projects,
    otherProjectClient: current.otherProjectClient ?? '',
    revision: request.expectedRevision + 1,
  };
}

test('queue diagnostics saves immediately without submitting unrelated draft settings', async () => {
  const saved = { ...preferences, projects: [{ pattern: 'https://github.com/acme/*', label: 'Acme' }], showQueueDiagnostics: false };
  const page = harness({ reply: request => request.type === 'SET_QUEUE_DIAGNOSTICS'
    ? { preferences: { ...saved, showQueueDiagnostics: request.enabled } }
    : {} });
  page.render(connectedState);
  page.context.savedPreferences = saved;
  vm.runInContext('localPreferences = savedPreferences;', page.context);
  const control = page.nodes.get('show-queue-diagnostics');
  control.checked = true;
  await control.listeners.change();
  const request = page.requests.find(item => item.type === 'SET_QUEUE_DIAGNOSTICS');
  assert.deepEqual(JSON.parse(JSON.stringify(request)), { type: 'SET_QUEUE_DIAGNOSTICS', enabled: true });
  assert.equal(page.requests.some(item => item.type === 'UPDATE_DISPLAY_PREFERENCES'), false);
  assert.equal(page.nodes.get('diagnostics-feedback').textContent, 'Queue diagnostics saved.');
});

test('interface width saves separately, updates the page and reverts on failure', async () => {
  assert.match(html, /id="interface-width"/);
  const page = harness({ reply: request => request.type === 'SET_INTERFACE_WIDTH'
    ? { preferences: { ...preferences, interfaceWidth: request.width } } : {} });
  page.render(connectedState);
  page.context.savedPreferences = { ...preferences, interfaceWidth: 'contained' };
  vm.runInContext('localPreferences = savedPreferences; renderDisplayPreferences(localPreferences);', page.context);
  const control = page.nodes.get('interface-width');
  assert.equal(control.value, 'contained');
  control.value = 'full';
  await control.listeners.change();
  assert.deepEqual(JSON.parse(JSON.stringify(page.requests.at(-1))), { type: 'SET_INTERFACE_WIDTH', width: 'full' });
  assert.equal(page.context.document.documentElement.dataset.clockoliWidth, 'full');
  assert.doesNotMatch(html, /id="toolbar-display-mode"/);

  const failed = harness({ reply: request => request.type === 'SET_INTERFACE_WIDTH' ? new Error('No storage') : {} });
  failed.render(connectedState);
  failed.context.savedPreferences = { ...preferences, interfaceWidth: 'contained' };
  vm.runInContext('localPreferences = savedPreferences; renderDisplayPreferences(localPreferences);', failed.context);
  failed.nodes.get('interface-width').value = 'full';
  await failed.nodes.get('interface-width').listeners.change();
  assert.equal(failed.nodes.get('interface-width').value, 'contained');
});

test('ready discovery populates both default options without selection writes and preserves silent DOM', async () => {
  const repositories = [77, 78].map(repoId => ({ repoId, installationId: 88, owner: 'acme', repo: `time-${repoId}`,
    fullName: `acme/time-${repoId}`, state: 'initialized_member', canAdd: true, eligible: true, ready: true }));
  const onboardingState = { ...connectedState, config: null, destinationRegistry: { defaultDestinationId: 'github:77' },
    destinations: repositories.map(repository => ({ ...repository, id: `github:${repository.repoId}`, verificationStatus: 'access_checked' })) };
  const result = { repositories, onboardingState };
  const page = harness({ reply: () => result });
  page.render({ ...connectedState, ready: false, config: null });
  await page.context.discoverRepositories();
  assert.equal(page.nodes.get('setup-default-destination').children.length, 2);
  assert.equal(page.nodes.get('onboarding').hidden, false);
  assert.equal(page.nodes.get('finish-setup').disabled, false);
  assert.ok(page.nodes.get('repository-list').children.every(row => row.children.length === 2));
  assert.equal(page.nodes.get('repository-confirmation').open, false);
  assert.equal(page.requests.some(request => request.type === 'SELECT_REPOSITORY'), false);
  const option = page.nodes.get('setup-default-destination').children[0];
  const row = page.nodes.get('repository-list').children[0];
  await page.context.discoverRepositories({ silent: true });
  assert.equal(page.nodes.get('setup-default-destination').children[0], option);
  assert.equal(page.nodes.get('repository-list').children[0], row);
});

test('a newly granted manual target opens the initialization review without a second button click', async () => {
  const target = { installationId: 10, repoId: 20, fullName: 'acme/time-data', owner: 'acme', repo: 'time-data', eligible: true };
  let granted = false;
  const page = harness({ reply: request => request.type === 'DISCOVER_REPOSITORIES'
    ? { repositories: granted ? [target] : [], installations: [] }
    : request.type === 'INSPECT_REPOSITORY'
      ? { repository: { ...target, state: 'uninitialized', canInitialize: true } } : {} });
  page.render({ appConfigured: true, auth: connectedState.auth });
  page.nodes.get('repository-target').value = target.fullName;
  await page.submit('repository-target-form');
  assert.match(page.nodes.get('repository-target-status').textContent, /cannot access/);
  granted = true;
  await page.context.discoverRepositories({ silent: true });
  assert.equal(page.requests.filter(request => request.type === 'INSPECT_REPOSITORY').length, 1);
  assert.match(page.nodes.get('repository-target-status').textContent, /Needs setup/);
  assert.equal(page.nodes.get('repository-target').attributes['aria-invalid'], undefined);
  assert.equal(page.nodes.get('repository-confirmation').open, true);
  assert.equal(vm.runInContext('selectedRepository.canInitialize', page.context), true);
  assert.equal(page.nodes.get('connect-checked-repository').hidden, false);
  assert.equal(page.nodes.get('connect-checked-repository').textContent, 'Initialize repository');
  assert.match(page.nodes.get('repository-target-status').className, /repository-check-status/);
  assert.equal(page.nodes.get('repository-target-status').dataset.kind, 'attention');
  assert.equal(page.nodes.get('setup-ready-summary').hidden, true);
  assert.equal(page.requests.some(request => request.type === 'SELECT_REPOSITORY'), false);
  page.context.closeRepositoryConfirmation();
  await page.context.discoverRepositories({ silent: true });
  assert.equal(page.requests.filter(request => request.type === 'INSPECT_REPOSITORY').length, 1);
  assert.equal(page.nodes.get('repository-confirmation').open, false, 'polling must not reopen a dismissed review');
  await page.nodes.get('connect-checked-repository').listeners.click();
  assert.equal(page.nodes.get('repository-confirmation').open, true);
  assert.equal(page.requests.some(request => request.type === 'SELECT_REPOSITORY'), false);
});

test('automatic inspection clears its busy state when GitHub returns canonical mixed-case spelling', async () => {
  const target = { installationId: 10, repoId: 20, fullName: 'Acme/Time-Data', eligible: true };
  const page = harness({ reply: request => request.type === 'DISCOVER_REPOSITORIES'
    ? { repositories: [target], installations: [] }
    : { repository: { ...target, state: 'uninitialized', canInitialize: true } } });
  page.render({ appConfigured: true, auth: connectedState.auth });
  await page.context.rememberRepositoryTarget('acme/time-data');
  await page.context.discoverRepositories();
  assert.equal(page.requests.filter(request => request.type === 'INSPECT_REPOSITORY').length, 1);
  assert.equal(page.nodes.get('check-repository-target').attributes['aria-busy'], 'false');
  assert.equal(page.nodes.get('check-repository-target').disabled, false);
  assert.equal(page.nodes.get('connect-checked-repository').hidden, false);
});

test('a failed automatic inspection retries on the next discovery without a second user action', async () => {
  const target = { installationId: 10, repoId: 20, fullName: 'acme/time-data', eligible: true };
  let attempts = 0;
  const page = harness({ reply: request => request.type === 'DISCOVER_REPOSITORIES'
    ? { repositories: [target], installations: [] }
    : ++attempts === 1 ? new Error('GitHub unavailable')
      : { repository: { ...target, state: 'uninitialized', canInitialize: true } } });
  page.render({ appConfigured: true, auth: connectedState.auth });
  await page.context.rememberRepositoryTarget(target.fullName);
  await page.context.discoverRepositories();
  assert.match(page.nodes.get('repository-target-status').textContent, /Check failed/);
  await page.context.discoverRepositories({ silent: true });
  assert.equal(attempts, 2);
  assert.equal(page.nodes.get('repository-confirmation').open, true);
  assert.equal(page.requests.some(request => request.type === 'SELECT_REPOSITORY'), false);
});

test('an old automatic inspection failure does not mark an edited repository target invalid', async () => {
  const target = { installationId: 10, repoId: 20, fullName: 'acme/first', eligible: true };
  let rejectInspection, inspectionStarted;
  const started = new Promise(resolve => { inspectionStarted = resolve; });
  const page = harness({ reply: request => request.type === 'DISCOVER_REPOSITORIES'
    ? { repositories: [target], installations: [] }
    : new Promise((resolve, reject) => { rejectInspection = reject; inspectionStarted(); }) });
  page.render({ appConfigured: true, auth: connectedState.auth });
  await page.context.rememberRepositoryTarget(target.fullName);
  const pending = page.context.discoverRepositories();
  await started;
  const input = page.nodes.get('repository-target');
  input.value = 'acme/second'; input.listeners.input();
  rejectInspection(new Error('Old repository failed'));
  await pending;
  assert.doesNotMatch(page.nodes.get('repository-target-status').textContent, /Old repository failed/);
  assert.equal(input.attributes['aria-invalid'], undefined);
  assert.equal(page.requests.some(request => request.type === 'SELECT_REPOSITORY'), false);
});

test('grant becoming eligible rechecks a remembered target even when the old reason is not Contents-write', async () => {
  const target = { installationId: 10, repoId: 20, fullName: 'acme/time-data', owner: 'acme', repo: 'time-data' };
  let granted = false;
  const page = harness({ reply: request => request.type === 'DISCOVER_REPOSITORIES'
    ? { repositories: [{ ...target, eligible: granted, reasons: granted ? [] : ['user_write_required'] }], installations: [] }
    : request.type === 'INSPECT_REPOSITORY' ? { repository: { ...target, eligible: true, state: 'uninitialized', canInitialize: true } } : {} });
  page.render({ appConfigured: true, auth: connectedState.auth });
  await page.context.rememberRepositoryTarget(target.fullName);
  await page.context.discoverRepositories();
  assert.equal(page.requests.some(request => request.type === 'INSPECT_REPOSITORY'), false);
  granted = true;
  await page.context.discoverRepositories({ silent: true });
  assert.equal(page.requests.filter(request => request.type === 'INSPECT_REPOSITORY').length, 1);
  assert.equal(page.nodes.get('connect-checked-repository').textContent, 'Initialize repository');
  assert.equal(page.nodes.get('repository-confirmation').open, true);
  assert.equal(page.nodes.get('repository-target').attributes['aria-invalid'], undefined);
});

test('return from a grant refreshes the remembered target once without accepting a repository action', async () => {
  const target = { installationId: 10, repoId: 20, fullName: 'acme/time-data', owner: 'acme', repo: 'time-data', eligible: true };
  let granted = false;
  const page = harness({ reply: request => request.type === 'DISCOVER_REPOSITORIES'
    ? { repositories: granted ? [target] : [], installations: [] }
    : request.type === 'INSPECT_REPOSITORY' ? { repository: { ...target, state: 'uninitialized', canInitialize: true } } : {} });
  page.render({ appConfigured: true, auth: connectedState.auth });
  page.nodes.get('repository-target').value = target.fullName;
  await page.submit('repository-target-form');
  granted = true;
  await page.context.discoverRepositories();
  assert.equal(page.requests.filter(request => request.type === 'INSPECT_REPOSITORY').length, 1);
  assert.equal(page.requests.some(request => request.type === 'SELECT_REPOSITORY'), false);
  assert.equal(page.nodes.get('repository-confirmation').open, true);
  assert.match(page.nodes.get('repository-target-status').textContent, /Needs setup/);
});

test('grant return waits one second after focus and rechecks on a later return if access is not yet visible', async () => {
  const target = { installationId: 10, repoId: 20, fullName: 'acme/time-data', eligible: true };
  let granted = false;
  const page = harness({ reply: request => request.type === 'DISCOVER_REPOSITORIES'
    ? { repositories: granted ? [target] : [], installations: [] }
    : request.type === 'INSPECT_REPOSITORY' ? { repository: { ...target, state: 'uninitialized', canInitialize: true } } : {} });
  page.render({ appConfigured: true, auth: connectedState.auth });
  page.nodes.get('repository-target').value = target.fullName;
  await page.submit('repository-target-form');
  page.context.window.open = () => ({ opener: {}, location: { replace() {} } });
  page.nodes.get('install-app').listeners.click({ preventDefault() {} });
  assert.equal(page.context.repositoryPollingActive(), false, 'do not poll for the grant while the GitHub tab is open');
  page.context.document.visibilityState = 'visible';
  await page.context.rediscoverAfterGitHubHandoff();
  assert.equal(page.requests.filter(request => request.type === 'DISCOVER_REPOSITORIES').length, 1,
    'modal focus must not consume the GitHub handoff');
  page.windowListeners.blur();
  page.windowListeners.focus();
  assert.equal(page.requests.filter(request => request.type === 'DISCOVER_REPOSITORIES').length, 1,
    'focus does not query GitHub before it has time to publish the grant');
  page.documentListeners.visibilitychange();
  const first = page.timers.filter(timer => timer.delay === 1000 && !timer.cleared);
  assert.equal(first.length, 1, 'focus and visibility together schedule only one check');
  first[0].cleared = true;
  first[0].callback();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.requests.filter(request => request.type === 'DISCOVER_REPOSITORIES').length, 2);
  assert.equal(page.requests.filter(request => request.type === 'INSPECT_REPOSITORY').length, 0);
  assert.equal(page.context.repositoryPollingActive(), false, 'missing grant stays event-driven');
  assert.match(page.nodes.get('repository-target-status').textContent, /not available yet/);
  assert.equal(page.nodes.get('repository-target-status').dataset.kind, 'neutral');
  page.windowListeners.blur();
  granted = true;
  page.windowListeners.focus();
  const second = page.timers.filter(timer => timer.delay === 1000 && !timer.cleared);
  assert.equal(second.length, 1);
  second[0].cleared = true;
  second[0].callback();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.requests.filter(request => request.type === 'INSPECT_REPOSITORY').length, 1);
  assert.equal(page.context.repositoryPollingActive(), true);
  assert.equal(page.requests.some(request => request.type === 'SELECT_REPOSITORY'), false);
});

test('a remembered unavailable target rechecks on tab return without an armed grant tab', async () => {
  const target = { installationId: 10, repoId: 20, fullName: 'acme/time-data', eligible: true };
  let granted = false;
  const page = harness({ reply: request => request.type === 'DISCOVER_REPOSITORIES'
    ? { repositories: granted ? [target] : [], installations: [] }
    : request.type === 'INSPECT_REPOSITORY' ? { repository: { ...target, state: 'uninitialized', canInitialize: true } } : {} });
  page.render({ appConfigured: true, auth: connectedState.auth });
  page.nodes.get('repository-target').value = target.fullName;
  await page.submit('repository-target-form');
  assert.match(page.nodes.get('repository-target-status').textContent, /Unavailable/);
  page.nodes.get('close-repository-access').listeners.click();
  const before = page.requests.length;
  page.context.document.visibilityState = 'visible';
  page.windowListeners.focus();
  assert.equal(page.requests.length, before, 'ordinary focus without leaving Settings does not check');
  page.windowListeners.blur();
  granted = true;
  page.windowListeners.focus();
  page.documentListeners.visibilitychange();
  const delayed = page.timers.filter(timer => timer.delay === 1000 && !timer.cleared);
  assert.equal(delayed.length, 1);
  assert.equal(page.requests.length, before, 'grant propagation gets a settling delay');
  delayed[0].cleared = true;
  delayed[0].callback();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.requests.filter(request => request.type === 'DISCOVER_REPOSITORIES').length, 2);
  assert.equal(page.requests.filter(request => request.type === 'INSPECT_REPOSITORY').length, 1);
  assert.equal(page.nodes.get('repository-confirmation').open, true);
  assert.equal(page.requests.some(request => request.type === 'SELECT_REPOSITORY'), false);
  page.nodes.get('close-repository-confirmation').listeners.click();
  page.windowListeners.blur();
  page.windowListeners.focus();
  assert.equal(page.timers.filter(timer => timer.delay === 1000 && !timer.cleared).length, 0,
    'dismissed initialization review does not reopen on focus');
});

test('Chrome tab activation rechecks a remembered target when focus and visibility events are absent', async () => {
  const target = { installationId: 10, repoId: 20, fullName: 'acme/time-data', eligible: true };
  let granted = false;
  const page = harness({ reply: request => request.type === 'DISCOVER_REPOSITORIES'
    ? { repositories: granted ? [target] : [], installations: [] }
    : request.type === 'INSPECT_REPOSITORY' ? { repository: { ...target, state: 'uninitialized', canInitialize: true } } : {} });
  page.render({ appConfigured: true, auth: connectedState.auth });
  page.nodes.get('repository-target').value = target.fullName;
  await page.submit('repository-target-form');
  page.nodes.get('close-repository-access').listeners.click();
  page.context.document.visibilityState = 'visible';
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof page.tabListeners.activated, 'function');
  page.tabListeners.activated({ tabId: 15, windowId: 2 });
  page.tabListeners.activated({ tabId: 11, windowId: 1 });
  assert.equal(page.timers.filter(timer => timer.delay === 1000 && !timer.cleared).length, 0,
    'an activation in another window is not a departure from Settings');
  page.tabListeners.activated({ tabId: 12, windowId: 1 });
  granted = true;
  page.tabListeners.activated({ tabId: 11, windowId: 1 });
  const delayed = page.timers.filter(timer => timer.delay === 1000 && !timer.cleared);
  assert.equal(delayed.length, 1);
  page.windowListeners.focus();
  assert.equal(page.timers.filter(timer => timer.delay === 1000 && !timer.cleared).length, 1,
    'duplicate focus must not schedule a second check');
  delayed[0].cleared = true;
  delayed[0].callback();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.requests.filter(request => request.type === 'INSPECT_REPOSITORY').length, 1);
  assert.equal(page.nodes.get('repository-confirmation').open, true);
  assert.equal(page.requests.some(request => request.type === 'SELECT_REPOSITORY'), false);
});

test('Chrome tab activation completes the Grant access handoff without page focus events', async () => {
  const target = { installationId: 10, repoId: 20, fullName: 'acme/time-data', eligible: true };
  let granted = false;
  const page = harness({ reply: request => request.type === 'DISCOVER_REPOSITORIES'
    ? { repositories: granted ? [target] : [], installations: [] }
    : request.type === 'INSPECT_REPOSITORY' ? { repository: { ...target, state: 'uninitialized', canInitialize: true } } : {} });
  page.render({ appConfigured: true, auth: connectedState.auth });
  page.nodes.get('repository-target').value = target.fullName;
  await page.submit('repository-target-form');
  page.context.window.open = () => ({ opener: {}, location: { replace() {} } });
  page.nodes.get('install-app').listeners.click({ preventDefault() {} });
  page.context.document.visibilityState = 'visible';
  await new Promise(resolve => setImmediate(resolve));
  page.tabListeners.activated({ tabId: 12, windowId: 1 });
  granted = true;
  page.tabListeners.activated({ tabId: 11, windowId: 1 });
  const delayed = page.timers.filter(timer => timer.delay === 1000 && !timer.cleared);
  assert.equal(delayed.length, 1);
  delayed[0].cleared = true;
  delayed[0].callback();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.requests.filter(request => request.type === 'INSPECT_REPOSITORY').length, 1);
  assert.equal(page.nodes.get('repository-confirmation').open, true);
  assert.equal(page.requests.some(request => request.type === 'SELECT_REPOSITORY'), false);
});

test('a restored unavailable target rechecks on visibility return after a Settings reload', async () => {
  const target = { installationId: 10, repoId: 20, fullName: 'acme/time-data', eligible: true };
  let granted = false;
  const page = harness({ savedChoices: new Map([['octocat', target.fullName]]), reply: request => {
    if (request.type === 'GET_ONBOARDING_STATE') return { appConfigured: true, auth: connectedState.auth };
    if (request.type === 'RESUME_DEVICE_FLOW') return null;
    if (request.type === 'DISCOVER_REPOSITORIES') return { repositories: granted ? [target] : [], installations: [] };
    if (request.type === 'INSPECT_REPOSITORY') return { repository: { ...target, state: 'uninitialized', canInitialize: true } };
    return {};
  } });
  page.context.document.visibilityState = 'visible';
  await page.context.refreshState();
  assert.equal(page.nodes.get('repository-target').value, target.fullName);
  assert.equal(page.requests.filter(request => request.type === 'DISCOVER_REPOSITORIES').length, 1);
  page.context.document.visibilityState = 'hidden';
  page.documentListeners.visibilitychange();
  granted = true;
  page.context.document.visibilityState = 'visible';
  page.documentListeners.visibilitychange();
  const delayed = page.timers.find(timer => timer.delay === 1000 && !timer.cleared);
  assert.ok(delayed);
  delayed.cleared = true;
  delayed.callback();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.requests.filter(request => request.type === 'INSPECT_REPOSITORY').length, 1);
  assert.equal(page.nodes.get('repository-confirmation').open, true);
  assert.equal(page.requests.some(request => request.type === 'SELECT_REPOSITORY'), false);
});

test('editing a remembered unavailable target cancels its return check', async () => {
  const page = harness({ reply: request => request.type === 'DISCOVER_REPOSITORIES'
    ? { repositories: [], installations: [] } : {} });
  page.render({ appConfigured: true, auth: connectedState.auth });
  page.nodes.get('repository-target').value = 'acme/time-data';
  await page.submit('repository-target-form');
  page.nodes.get('close-repository-access').listeners.click();
  page.context.document.visibilityState = 'visible';
  page.windowListeners.blur();
  page.windowListeners.focus();
  const delayed = page.timers.find(timer => timer.delay === 1000 && !timer.cleared);
  assert.ok(delayed);
  page.nodes.get('repository-target').value = 'acme/other-data';
  page.nodes.get('repository-target').listeners.input();
  assert.equal(delayed.cleared, true);
  const before = page.requests.length;
  delayed.callback();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.requests.length, before);
});

test('grant return checks immediately after a hidden tab becomes visible even without a window blur', async () => {
  const target = { installationId: 10, repoId: 20, fullName: 'acme/time-data', eligible: true };
  let granted = false;
  const page = harness({ reply: request => request.type === 'DISCOVER_REPOSITORIES'
    ? { repositories: granted ? [target] : [], installations: [] }
    : request.type === 'INSPECT_REPOSITORY' ? { repository: { ...target, state: 'uninitialized', canInitialize: true } } : {} });
  page.render({ appConfigured: true, auth: connectedState.auth });
  page.nodes.get('repository-target').value = target.fullName;
  await page.submit('repository-target-form');
  page.context.window.open = () => ({ opener: {}, location: { replace() {} } });
  page.nodes.get('install-app').listeners.click({ preventDefault() {} });
  page.context.document.visibilityState = 'hidden';
  page.documentListeners.visibilitychange();
  granted = true;
  page.context.document.visibilityState = 'visible';
  page.documentListeners.visibilitychange();
  const delayed = page.timers.find(timer => timer.delay === 1000 && !timer.cleared);
  assert.ok(delayed);
  delayed.cleared = true;
  delayed.callback();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.requests.filter(request => request.type === 'INSPECT_REPOSITORY').length, 1);
  assert.equal(page.nodes.get('repository-confirmation').open, true);
  assert.equal(page.requests.some(request => request.type === 'SELECT_REPOSITORY'), false);
});

test('blocked GitHub access tab does not arm a return check', async () => {
  const page = harness({ reply: request => request.type === 'DISCOVER_REPOSITORIES'
    ? { repositories: [], installations: [] } : {} });
  page.render({ appConfigured: true, auth: connectedState.auth });
  page.nodes.get('repository-target').value = 'acme/time-data';
  await page.submit('repository-target-form');
  page.context.window.open = () => null;
  page.nodes.get('install-app').listeners.click({ preventDefault() {} });
  assert.match(page.nodes.get('message').textContent, /blocked the GitHub access tab/);
  assert.equal(page.context.repositoryPollingActive(), true);
  const before = page.requests.length;
  page.windowListeners.blur();
  page.windowListeners.focus();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.requests.length, before);
});

test('editing the target cancels a pending grant return check', async () => {
  const page = harness({ reply: request => request.type === 'DISCOVER_REPOSITORIES'
    ? { repositories: [], installations: [] } : {} });
  page.render({ appConfigured: true, auth: connectedState.auth });
  page.nodes.get('repository-target').value = 'acme/time-data';
  await page.submit('repository-target-form');
  page.context.window.open = () => ({ opener: {}, location: { replace() {} } });
  page.nodes.get('install-app').listeners.click({ preventDefault() {} });
  page.context.document.visibilityState = 'visible';
  page.windowListeners.blur();
  page.windowListeners.focus();
  const delayed = page.timers.find(timer => timer.delay === 1000 && !timer.cleared);
  assert.ok(delayed);
  page.nodes.get('repository-target').value = 'acme/other-data';
  page.nodes.get('repository-target').listeners.input();
  assert.equal(delayed.cleared, true);
  const before = page.requests.length;
  delayed.callback();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.requests.length, before);
  assert.equal(page.context.repositoryPollingActive(), true);
});

test('ineligible newly granted target is not auto-inspected or connected', async () => {
  const target = { installationId: 10, repoId: 20, fullName: 'acme/time-data', owner: 'acme', repo: 'time-data', eligible: false };
  let granted = false;
  const page = harness({ reply: request => request.type === 'DISCOVER_REPOSITORIES'
    ? { repositories: granted ? [target] : [], installations: [] } : {} });
  page.render({ appConfigured: true, auth: connectedState.auth });
  page.nodes.get('repository-target').value = target.fullName;
  await page.submit('repository-target-form');
  granted = true;
  await page.context.discoverRepositories({ silent: true });
  assert.equal(page.requests.some(request => request.type === 'INSPECT_REPOSITORY'), false);
  assert.equal(page.requests.some(request => request.type === 'SELECT_REPOSITORY'), false);
  assert.equal(page.nodes.get('repository-confirmation').open, false);
});

test('successful initialization completes first-time setup without a page reload or second action', async () => {
  const repo = { installationId: 10, repoId: 20, fullName: 'acme/time-data', owner: 'acme', repo: 'time-data', eligible: true,
    state: 'uninitialized', canInitialize: true };
  const ready = { ...connectedState, config: null, ready: true,
    destinationRegistry: { defaultDestinationId: 'github:20', destinations: { 'github:20': {
      owner: 'acme', repo: 'time-data', verificationStatus: 'write_verified', id: 'github:20',
    } } } };
  const page = harness({ reply: request => request.type === 'DISCOVER_REPOSITORIES' ? { repositories: [repo], installations: [] }
    : request.type === 'INSPECT_REPOSITORY' ? { repository: repo }
    : request.type === 'GET_ONBOARDING_STATE' ? ready : preferences });
  page.render({ appConfigured: true, auth: connectedState.auth });
  await page.context.discoverRepositories();
  page.nodes.get('repository-target').value = repo.fullName;
  await page.submit('repository-target-form');
  assert.equal(page.nodes.get('repository-confirmation').open, true);
  assert.match(page.nodes.get('repository-target-status').textContent, /Needs setup/);
  await page.context.confirmRepositoryAction();
  assert.equal(page.requests.filter(request => request.type === 'SELECT_REPOSITORY').length, 1);
  assert.equal(page.nodes.get('onboarding').hidden, true, page.nodes.get('message').textContent);
  assert.match(page.nodes.get('message').textContent, /setup complete/i);
  assert.equal(page.nodes.get('setup-default-destination').children[0].textContent, 'acme/time-data');
  assert.equal(page.nodes.get('finish-setup').disabled, false);
  assert.equal(page.nodes.get('repository-target-status').hidden, true, 'completed setup must not retain the old inspection');
  assert.equal(page.nodes.get('repository-target-status').textContent, '');
  vm.runInContext('showOnboarding = true; renderState();', page.context);
  assert.equal(page.nodes.get('onboarding').hidden, false);
  assert.equal(page.nodes.get('repository-target-status').hidden, true, 'reopening setup must not resurrect the old status');
});

test('confirmed initialization does not claim setup complete until a default is registered', async () => {
  const repo = { installationId: 10, repoId: 20, fullName: 'acme/time-data', owner: 'acme', repo: 'time-data', eligible: true,
    state: 'uninitialized', canInitialize: true };
  const page = harness({ reply: request => request.type === 'DISCOVER_REPOSITORIES' ? { repositories: [repo], installations: [] }
    : request.type === 'INSPECT_REPOSITORY' ? { repository: repo }
    : request.type === 'GET_ONBOARDING_STATE' ? { appConfigured: true, auth: connectedState.auth, ready: false } : preferences });
  page.render({ appConfigured: true, auth: connectedState.auth });
  await page.context.discoverRepositories();
  page.nodes.get('repository-target').value = repo.fullName;
  await page.submit('repository-target-form');
  await page.context.confirmRepositoryAction();
  assert.equal(page.nodes.get('onboarding').hidden, false);
  assert.doesNotMatch(page.nodes.get('message').textContent, /setup complete/i);
  assert.equal(page.nodes.get('repository-target-status').hidden, true, 'successful connection clears stale setup guidance even when onboarding stays open');
});

test('silent discovery revokes inspected Ready on semantic changes without re-inspecting rows', async () => {
  const base = { installationId: 10, repoId: 20, fullName: 'acme/time-data', owner: 'acme', repo: 'time-data',
    private: true, visibility: 'private', archived: false, disabled: false, defaultBranch: 'main',
    appPermissions: { contents: 'write' }, userPermissions: { push: true }, eligible: true, reasons: [] };
  const inspected = { ...base, state: 'initialized_member', canAdd: true, ready: true };
  let discovered = base;
  const page = harness({ reply: request => request.type === 'INSPECT_REPOSITORY' ? { repository: inspected }
    : { repositories: [discovered], installations: [] } });
  page.render({ appConfigured: true, auth: connectedState.auth });
  await page.context.discoverRepositories();
  page.nodes.get('repository-target').value = base.fullName;
  await page.submit('repository-target-form');
  assert.equal(vm.runInContext('selectedRepository.ready', page.context), true);
  const unchanged = vm.runInContext('selectedRepository', page.context);
  await page.context.discoverRepositories({ silent: true });
  assert.equal(vm.runInContext('selectedRepository', page.context), unchanged);
  for (const changed of [{ archived: true, eligible: false, reasons: ['archived'] },
    { private: false, visibility: 'public', eligible: false, reasons: ['private_required'] }]) {
    discovered = { ...base, ...changed };
    await page.context.discoverRepositories({ silent: true });
    assert.equal(vm.runInContext('repositoryCanBeSelected(selectedRepository)', page.context), false);
    assert.equal(page.context.reviewSelectedRepository(), false);
    assert.equal(page.requests.filter(request => request.type === 'INSPECT_REPOSITORY').length, 1);
    discovered = base;
    await page.context.discoverRepositories({ silent: true });
    assert.equal(vm.runInContext('selectedRepository?.ready === true', page.context), false);
  }
});

test('a second explicit Check is queued after an in-flight inspection without applying stale A', async () => {
  const first = { installationId: 10, repoId: 20, fullName: 'acme/first', owner: 'acme', repo: 'first', eligible: true };
  const second = { installationId: 10, repoId: 21, fullName: 'acme/second', owner: 'acme', repo: 'second', eligible: true };
  let releaseFirst, firstStarted;
  const started = new Promise(resolve => { firstStarted = resolve; });
  const page = harness({ reply: request => request.type === 'INSPECT_REPOSITORY'
    ? request.payload.repoId === first.repoId
      ? new Promise(resolve => { releaseFirst = () => resolve({ repository: { ...first, state: 'initialized_member', canAdd: true, ready: true } }); firstStarted(); })
      : { repository: { ...second, state: 'initialized_member', canAdd: true, ready: true } }
    : { repositories: [first, second], installations: [] } });
  page.render({ appConfigured: true, auth: connectedState.auth });
  const input = page.nodes.get('repository-target');
  input.value = first.fullName;
  const checkingFirst = page.submit('repository-target-form');
  await started;
  input.value = second.fullName;
  input.listeners.input();
  await input.listeners.blur({ relatedTarget: null });
  assert.deepEqual(page.requests.filter(request => request.type === 'INSPECT_REPOSITORY').map(request => request.payload.repoId), [20]);
  const checkingSecond = page.submit('repository-target-form');
  releaseFirst();
  await Promise.all([checkingFirst, checkingSecond]);
  assert.deepEqual(page.requests.filter(request => request.type === 'INSPECT_REPOSITORY').map(request => request.payload.repoId), [20, 21]);
  assert.equal(vm.runInContext('selectedRepository.fullName', page.context), second.fullName);
  assert.equal(page.context.reviewSelectedRepository(), true);
  assert.equal(page.nodes.get('repository-confirmation-title').textContent, 'Connect acme/second?');
});

test('Merge tasks offers imported identities as sources but only URLs as replacement targets', async () => {
  const imported = 'KlimTodrik/clockoli-issues/6-Polish-the-Clockoli-GitHub-project-page-for-Launch-1';
  const page = harness({ reply: request => request.type === 'LOAD_TASKS' ? { tasks: [
    { taskUrl: imported, title: 'clockoli-issues — #6 Polish the Clockoli GitHub project page for Launch 1', destinationIds: ['github:1'] },
    { taskUrl: 'https://example.test/task', destinationIds: ['github:1'] },
  ], currentUsers: { 'github:1': 'octocat' }, availableUsers: ['octocat'] } : {} });
  page.render({ ...connectedState, destinationRegistry: { defaultDestinationId: 'github:1', destinations: {
    'github:1': { owner: 'acme', repo: 'time-data' },
  } } });
  page.nodes.get('merge-tasks').hidden = false;
  page.nodes.get('merge-task-period').value = 'one-month';
  assert.equal(page.nodes.get('merge-task-destination').value, 'github:1');
  await page.context.refreshMergeTasks();
  assert.equal(page.requests.filter(request => request.type === 'LOAD_TASKS').length, 1);
  assert.match(page.nodes.get('merge-tasks-feedback').textContent, /replacement.*URL/i);
  assert.deepEqual(page.nodes.get('merge-source-list').children.map(row => row.children[1]?.textContent),
    ['https://example.test/task', imported]);
  assert.deepEqual(page.nodes.get('merge-target-list').children.map(row => row.children[1]?.textContent), ['https://example.test/task']);
  page.context.selectMergeTask('source', imported);
  page.context.selectMergeTask('target', 'https://example.test/task');
  assert.equal(page.nodes.get('merge-tasks-submit').disabled, false);
});

test('Merge tasks queues selected left-to-right pairs and sends them together', async () => {
  const tasks = [
    { taskUrl: 'https://github.com/acme/app/issues/1', title: 'Old task', totalSeconds: 3600, destinationIds: ['github:1'] },
    { taskUrl: 'https://github.com/acme/app/issues/2', title: 'Canonical task', totalSeconds: 1800, destinationIds: ['github:1'] },
    { taskUrl: 'https://github.com/acme/other/issues/3', title: 'Other repository', totalSeconds: 900, destinationIds: ['github:2'] },
  ];
  const page = harness({ reply: request => request.type === 'MERGE_TASKS'
    ? { mergedEntries: 3, mergedActive: false, destinationCount: 1 }
    : request.type === 'LOAD_TASKS' ? { tasks, currentUsers: { 'github:1': 'octocat' }, availableUsers: ['octocat'] } : {} });
  page.render({
    ...connectedState,
    destinationRegistry: { defaultDestinationId: 'github:1', destinations: {
      'github:1': { owner: 'acme', repo: 'time-one', label: 'acme/time-one' },
      'github:2': { owner: 'acme', repo: 'time-two', label: 'acme/time-two' },
    } },
  });
  page.nodes.get('merge-task-period').value = 'one-month';
  assert.equal(page.nodes.get('merge-task-destination').value, 'github:1');
  vm.runInContext("mergePeople = new Set(['octocat']);", page.context);
  page.context.renderMergeTasks(tasks);
  assert.equal(page.nodes.get('merge-source-list').children.some(row => row.children?.[1]?.textContent === tasks[2].taskUrl), false);
  page.context.selectMergeTask('source', tasks[0].taskUrl);
  page.context.selectMergeTask('target', tasks[1].taskUrl);
  assert.equal(page.nodes.get('merge-tasks-submit').disabled, false);
  const queued = page.nodes.get('merge-queue-list').children[0];
  assert.deepEqual(queued.children[0].children.map(node => node.textContent), ['Old task', tasks[0].taskUrl]);
  assert.deepEqual(queued.children[2].children.map(node => node.textContent), ['Canonical task', tasks[1].taskUrl]);
  assert.equal(queued.children[3].textContent, '✕');
  assert.match(queued.children[3].attributes['aria-label'], /Remove merge pair/);
  await page.nodes.get('merge-tasks-submit').listeners.click();
  const request = page.requests.find(item => item.type === 'MERGE_TASKS');
  assert.deepEqual(JSON.parse(JSON.stringify(request.destinationIds)), ['github:1']);
  assert.deepEqual(JSON.parse(JSON.stringify(request.pairs)), [{ sourceTaskUrl: tasks[0].taskUrl, targetTaskUrl: tasks[1].taskUrl, targetTaskTitle: 'Canonical task' }]);
  assert.match(page.nodes.get('merge-tasks-feedback').textContent, /Merged 1 task pair/);
});

test('changing the merge repository clears stale candidates and scopes the next task load', async () => {
  let releaseLoad;
  const page = harness({ reply: request => request.type === 'LOAD_TASKS'
    ? new Promise(resolve => { releaseLoad = () => resolve({ tasks: [], currentUsers: { [request.payload.destinationIds[0]]: 'octocat' }, availableUsers: ['octocat'] }); })
    : {} });
  page.render({
    ...connectedState,
    destinationRegistry: { defaultDestinationId: 'github:1', destinations: {
      'github:1': { owner: 'acme', repo: 'time-one', label: 'acme/time-one' },
      'github:2': { owner: 'acme', repo: 'time-two', label: 'acme/time-two' },
    } },
  });
  page.nodes.get('merge-task-period').value = 'one-month';
  page.context.renderMergeTasks([{ taskUrl: 'https://example.test/stale', title: 'Stale task', destinationIds: ['github:1'] }]);
  vm.runInContext("mergePairs = [{ source: { taskUrl: 'https://example.test/old' }, target: { taskUrl: 'https://example.test/new' } }]; mergePeople = new Set(['octocat']); renderMergeQueue();", page.context);
  page.nodes.get('merge-task-destination').value = 'github:2';
  const changing = page.nodes.get('merge-task-destination').listeners.change();
  assert.equal(vm.runInContext('mergePairs.length', page.context), 0);
  assert.equal(page.nodes.get('merge-source-list').children.some(row => row.children?.[1]?.textContent === 'https://example.test/stale'), false);
  assert.equal(page.nodes.get('merge-target-list').children.some(row => row.children?.[1]?.textContent === 'https://example.test/stale'), false);
  assert.equal(page.nodes.get('merge-tasks-submit').disabled, true);
  releaseLoad(); await changing;
  const request = page.requests.filter(item => item.type === 'LOAD_TASKS').at(-1);
  assert.deepEqual(JSON.parse(JSON.stringify(request.payload.destinationIds)), ['github:2']);
});

test('removing the selected merge repository cannot carry its queued pair into the fallback repository', () => {
  const page = harness();
  page.render({
    ...connectedState,
    destinationRegistry: { defaultDestinationId: 'github:1', destinations: {
      'github:1': { owner: 'acme', repo: 'time-one', label: 'acme/time-one' },
      'github:2': { owner: 'acme', repo: 'time-two', label: 'acme/time-two' },
    } },
  });
  page.context.renderMergeTasks([
    { taskUrl: 'https://example.test/old', title: 'Old', destinationIds: ['github:1'] },
    { taskUrl: 'https://example.test/new', title: 'New', destinationIds: ['github:1'] },
  ]);
  page.context.selectMergeTask('source', 'https://example.test/old');
  page.context.selectMergeTask('target', 'https://example.test/new');
  assert.equal(vm.runInContext('mergePairs.length', page.context), 1);

  page.render({
    ...connectedState,
    destinationRegistry: { defaultDestinationId: 'github:2', destinations: {
      'github:2': { owner: 'acme', repo: 'time-two', label: 'acme/time-two' },
    } },
  });
  assert.equal(page.nodes.get('merge-task-destination').value, 'github:2');
  assert.equal(vm.runInContext('mergePairs.length', page.context), 0);
  assert.equal(page.nodes.get('merge-tasks-submit').disabled, true);
  assert.equal(page.nodes.get('merge-source-list').children.some(row => row.children?.[1]?.textContent === 'https://example.test/old'), false);
});

test('People multi-select filters checkboxes and Select all toggles every person', () => {
  const page = harness({ reply: request => request.type === 'LOAD_TASKS'
    ? { tasks: [], currentUsers: { current: 'octocat' }, availableUsers: ['alice', 'bob', 'octocat'] } : {} });
  page.nodes.get('merge-task-period').value = 'one-month';
  vm.runInContext("mergePeople = new Set(['octocat']);", page.context);
  page.context.renderMergePeople(['alice', 'bob', 'octocat']);
  const filter = page.nodes.get('merge-people-filter');
  filter.listeners.focus();
  assert.equal(page.nodes.get('merge-people-select').open, true);
  filter.value = 'bo'; filter.listeners.input();
  const labels = page.nodes.get('merge-people-list').children;
  assert.deepEqual(labels.map(label => [label.children[0].value, label.hidden]), [['alice', true], ['bob', false], ['octocat', true]]);
  page.nodes.get('merge-people-all').listeners.click({ stopPropagation() {} });
  assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify([...mergePeople].sort())', page.context)), ['alice', 'bob', 'octocat']);
  page.nodes.get('merge-people-all').listeners.click({ stopPropagation() {} });
  assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify([...mergePeople])', page.context)), []);
});

test('repository suggestions stay collapsed until typing and show at most eight matching names', () => {
  const page = harness();
  const repositories = count => Array.from({ length: count }, (_, index) => ({
    installationId: 10, repoId: index + 1, fullName: `acme/time-${index + 1}`,
    state: 'initialized_member', canAdd: true, eligible: true,
  }));
  page.render({ appConfigured: true, auth: connectedState.auth });
  page.context.renderRepositories({ repositories: repositories(30), installations: [] });
  vm.runInContext('repositoryDiscoveryKnown = true; discoveryStatus = "ready";', page.context);
  assert.equal(page.nodes.get('repository-list').hidden, true);
  assert.equal(page.nodes.get('repository-list').children.length, 0);
  const input = page.nodes.get('repository-target');
  input.value = 'time-'; input.listeners.input();
  assert.equal(page.nodes.get('repository-list').hidden, false);
  assert.equal(page.nodes.get('repository-list').children.length, 8);
  assert.equal(page.requests.some(request => request.type === 'INSPECT_REPOSITORY' || request.type === 'SELECT_REPOSITORY'), false);
  input.value = 'time-25'; input.listeners.input();
  assert.equal(page.nodes.get('repository-list').children.length, 1);
  assert.match(page.nodes.get('repository-list').children[0].textContent, /acme\/time-25/);
});

test('repository catalog is not requested on initial setup without a remembered target', async () => {
  const page = harness({ reply: request => request.type === 'GET_ONBOARDING_STATE'
    ? { appConfigured: true, auth: connectedState.auth, config: null } : null });
  await page.context.refreshState();
  assert.equal(page.requests.some(request => request.type === 'DISCOVER_REPOSITORIES'), false);
  page.context.renderRepositoryList();
  assert.equal(page.nodes.get('repository-list').hidden, true);
});

test('typing a repository name loads suggestions once, while a pasted URL waits for explicit Check', async () => {
  const page = harness({ reply: request => request.type === 'DISCOVER_REPOSITORIES'
    ? { repositories: [{ installationId: 10, repoId: 20, fullName: 'acme/time-data' }], installations: [] } : {} });
  page.render({ appConfigured: true, auth: connectedState.auth });
  const input = page.nodes.get('repository-target');
  input.value = 't'; input.listeners.input();
  assert.equal(page.requests.length, 0);
  input.value = 'ti'; input.listeners.input();
  await vm.runInContext('discoveryPromise', page.context);
  assert.equal(page.requests.filter(request => request.type === 'DISCOVER_REPOSITORIES').length, 1);
  input.value = 'time'; input.listeners.input();
  assert.equal(page.nodes.get('repository-list').children[0].textContent, 'acme/time-data');
  assert.equal(page.requests.filter(request => request.type === 'DISCOVER_REPOSITORIES').length, 1);
  input.value = 'https://github.com/acme/time-data'; input.listeners.input();
  assert.equal(page.requests.filter(request => request.type === 'DISCOVER_REPOSITORIES').length, 1);
  assert.equal(page.requests.some(request => request.type === 'INSPECT_REPOSITORY'), false);
  assert.equal(page.nodes.get('repository-list').hidden, true);
});

test('repository input uses an explicit Check button without checking or showing a prompt on blur', async () => {
  assert.match(html, /id="check-repository-target"[^>]*>Check<\/button>/);
  assert.doesNotMatch(html, /id="refresh-repository-target"/);
  const repository = { installationId: 10, repoId: 20, fullName: 'acme/time-data', eligible: true };
  const page = harness({ reply: request => request.type === 'INSPECT_REPOSITORY'
    ? { repository: { ...repository, state: 'initialized_member', canAdd: true, ready: true } }
    : { repositories: [repository], installations: [] } });
  page.render({ appConfigured: true, auth: connectedState.auth });
  const input = page.nodes.get('repository-target');
  const check = page.nodes.get('check-repository-target');
  const status = page.nodes.get('repository-target-status');
  assert.equal(check.disabled, true);
  input.value = repository.fullName;
  input.listeners.input();
  assert.equal(check.disabled, false);
  assert.equal(status.hidden, true);
  await input.listeners.blur({ relatedTarget: null });
  assert.equal(status.hidden, true);
  assert.equal(input.attributes['aria-invalid'], undefined);
  assert.equal(page.requests.some(request => ['DISCOVER_REPOSITORIES', 'INSPECT_REPOSITORY'].includes(request.type)), false);
  await check.listeners.click();
  assert.equal(page.requests.filter(request => request.type === 'INSPECT_REPOSITORY').length, 1);
  assert.equal(status.textContent, 'Checked. Ready, but not connected yet. Select "Connect repository" below to start using it.');
  assert.equal(page.nodes.get('connect-checked-repository').hidden, false);
  assert.equal(page.nodes.get('connect-checked-repository').textContent, 'Connect repository');
  assert.equal(page.requests.some(request => request.type === 'SELECT_REPOSITORY'), false);
});

test('reopening completed setup refreshes the granted catalog before showing suggestions', async () => {
  const old = { installationId: 10, repoId: 20, fullName: 'acme/time-old', eligible: true };
  const added = { installationId: 10, repoId: 21, fullName: 'acme/time-new', eligible: true };
  let granted = [old];
  const page = harness({ reply: request => request.type === 'DISCOVER_REPOSITORIES'
    ? { repositories: granted, installations: [] } : {} });
  page.render(connectedState);
  vm.runInContext('showOnboarding = true; renderState();', page.context);
  await page.context.discoverRepositories();
  await page.nodes.get('finish-setup').listeners.click();
  granted = [old, added];
  await page.nodes.get('add-time-repository').listeners.click({ preventDefault() {} });
  const input = page.nodes.get('repository-target');
  input.value = 'time'; input.listeners.input();
  await vm.runInContext('discoveryPromise', page.context);
  assert.equal(page.requests.filter(request => request.type === 'DISCOVER_REPOSITORIES').length, 2);
  assert.deepEqual(page.nodes.get('repository-list').children.map(item => item.textContent), ['acme/time-new', 'acme/time-old']);
});

test('repository autocomplete supports keyboard navigation and Escape without checking', () => {
  const page = harness();
  page.render({ appConfigured: true, auth: connectedState.auth });
  page.context.renderRepositories({ repositories: [
    { installationId: 10, repoId: 20, fullName: 'acme/time-data' },
    { installationId: 10, repoId: 21, fullName: 'acme/time-other' },
  ], installations: [] });
  vm.runInContext('repositoryDiscoveryKnown = true; discoveryStatus = "ready";', page.context);
  const input = page.nodes.get('repository-target');
  input.value = 'time'; input.listeners.input();
  let prevented = false;
  input.listeners.keydown({ key: 'ArrowDown', preventDefault() { prevented = true; } });
  const first = page.nodes.get('repository-list').children[0];
  assert.equal(prevented, true);
  assert.equal(first.focused, true);
  first.listeners.keydown({ key: 'Escape', preventDefault() {} });
  assert.equal(page.nodes.get('repository-list').hidden, true);
  assert.equal(input.focused, true);
  assert.equal(page.requests.length, 0);
});

test('repository list shows a local loader until the first discovery completes', async () => {
  let release;
  const page = harness({ reply: () => new Promise(resolve => { release = resolve; }) });
  page.render({ appConfigured: true, auth: connectedState.auth });
  page.nodes.get('repository-target').value = 'time'; page.nodes.get('repository-target').listeners.input();
  const pending = vm.runInContext('discoveryPromise', page.context);
  assert.equal(page.nodes.get('repository-choice-fieldset').hidden, false);
  assert.equal(page.nodes.get('repository-list-loading').hidden, false);
  release({ repositories: [{ installationId: 1, repoId: 2, fullName: 'acme/time-data' }], installations: [] });
  await pending;
  assert.equal(page.nodes.get('repository-list-loading').hidden, true);
  assert.equal(page.nodes.get('repository-list').children.length, 1);
});

test('repository check hides target status during repository discovery and restores inspection feedback', async () => {
  let releaseDiscovery;
  const repository = { installationId: 10, repoId: 20, fullName: 'acme/time-data', eligible: true };
  const page = harness({ reply: request => request.type === 'DISCOVER_REPOSITORIES'
    ? new Promise(resolve => { releaseDiscovery = resolve; })
    : { repository: { ...repository, state: 'initialized_member', ready: true, canAdd: true } } });
  page.render({ appConfigured: true, auth: connectedState.auth });
  const input = page.nodes.get('repository-target');
  input.value = repository.fullName; input.listeners.input();
  const check = page.nodes.get('check-repository-target').listeners.click();
  const status = page.nodes.get('repository-target-status');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.nodes.get('check-repository-target').attributes['aria-busy'], 'true');
  assert.equal(status.hidden, true, 'the target status must not compete with discovery loading');
  releaseDiscovery({ repositories: [repository], installations: [] });
  await check;
  assert.equal(status.hidden, false);
  assert.equal(status.textContent, 'Checked. Ready, but not connected yet. Select "Connect repository" below to start using it.');
});


test('repository checks do not duplicate button progress in the large status message', () => {
  assert.equal(source.includes('Checking ${target}… Repository files will not be changed.'), false);
  assert.doesNotMatch(source, /Checking access and storage… No changes will be made/);
});

test('repository list loader clears on failure and silent refresh leaves existing rows visible', async () => {
  let release;
  const page = harness({ reply: () => new Promise(resolve => { release = resolve; }) });
  page.render({ appConfigured: true, auth: connectedState.auth });
  const pending = page.context.discoverRepositories();
  release(new Error('GitHub unavailable'));
  await assert.rejects(pending, /GitHub unavailable/);
  assert.equal(page.nodes.get('repository-list-loading').hidden, true);
  const existing = { installationId: 1, repoId: 2, fullName: 'acme/time-data' };
  page.context.renderRepositories({ repositories: [existing], installations: [] });
  vm.runInContext('repositoryDiscoveryKnown = true; discoveryStatus = "ready";', page.context);
  page.nodes.get('repository-target').value = 'time'; page.nodes.get('repository-target').listeners.input();
  const row = page.nodes.get('repository-list').children[0];
  vm.runInContext('showOnboarding = true; renderState();', page.context);
  const refresh = page.context.discoverRepositories({ silent: true });
  assert.equal(page.nodes.get('repository-list-loading').hidden, true);
  assert.equal(page.nodes.get('repository-list').children[0], row);
  release({ repositories: [existing], installations: [] });
  await refresh;
  assert.equal(page.nodes.get('repository-list-loading').hidden, true);
});

test('repository list loader clears when discovery is blocked or setup is cancelled', async () => {
  const blocked = harness({ reply: () => ({ blocked: { message: 'Authorization needs attention.' } }) });
  blocked.render({ appConfigured: true, auth: connectedState.auth });
  await blocked.context.discoverRepositories();
  assert.equal(blocked.nodes.get('repository-list-loading').hidden, true);
  assert.equal(blocked.nodes.get('message').textContent, 'Authorization needs attention.');

  let release;
  const page = harness({ reply: () => new Promise(resolve => { release = resolve; }) });
  page.render({ appConfigured: true, auth: connectedState.auth });
  const pending = page.context.discoverRepositories();
  page.context.stopRepositoryMonitoring();
  assert.equal(page.nodes.get('repository-list-loading').hidden, true);
  release({ repositories: [], installations: [] });
  await pending;
  assert.equal(page.nodes.get('repository-list-loading').hidden, true);
});

test('partial settings import message names repositories and project routes that were not restored', () => {
  const page = harness();
  const text = page.context.settingsImportMessage({ notRestored: [
    { type: 'repository', repository: 'acme/archive', reason: 'not connected in Clockoli on this browser' },
    { type: 'project', name: 'Legacy', repository: 'acme/archive', reason: 'not connected in Clockoli on this browser' },
  ] });
  assert.match(text, /restored where possible/i);
  assert.match(text, /repository acme\/archive.*not connected/i);
  assert.match(text, /project “Legacy”.*acme\/archive.*not connected/i);
  assert.match(text, /connect.*import.*again/i);
});

test('partial settings import completes and displays the concrete recovery report', async () => {
  const imported = {
    recentDays: 12,
    notRestored: [{ type: 'project', name: 'Legacy', repository: 'acme/archive', reason: 'not connected in Clockoli on this browser' }],
  };
  const page = harness({ reply: request => request.type === 'IMPORT_SETTINGS' ? imported : preferences });
  page.render(connectedState);
  const input = page.nodes.get('import-settings-file');
  input.files = [{ size: 100, text: async () => '{"backup":true}' }];
  await input.listeners.change();
  assert.equal(page.requests.some(request => request.type === 'IMPORT_SETTINGS'), true);
  assert.match(page.nodes.get('message').textContent, /project “Legacy”.*acme\/archive.*not connected/i);
  assert.equal(page.nodes.get('message').className, 'warning');
  assert.equal(input.disabled, false);
  assert.equal(input.value, '');
});

test('silent discovery preserves unchanged DOM, dirty intent, and ignores replies after Finish', async () => {
  let release;
  const result = { repositories: [{ installationId: 11, repoId: 22, fullName: 'octocat/clockoli-data', state: 'initialized_member', canAdd: true, eligible: true }, { installationId: 10, repoId: 20, fullName: 'acme/new', state: 'uninitialized', canInitialize: true, eligible: true }], installations: [] };
  const page = harness({ reply: () => new Promise(resolve => { release = resolve; }) });
  page.render(connectedState);
  vm.runInContext('showOnboarding = true; renderState();', page.context);
  page.context.renderRepositories(result);
  const root = page.nodes.get('repository-list');
  const original = root.children[0];
  const before = page.nodes.get('message').textContent;
  let poll = page.context.discoverRepositories({ silent: true }); release(result); await poll;
  assert.equal(root.children[0], original);
  assert.equal(page.nodes.get('message').textContent, before);
  page.nodes.get('repository-target').value = 'dirty/draft';
  page.nodes.get('repository-target').listeners.input();
  poll = page.context.discoverRepositories({ silent: true }); release({ ...result, repositories: [...result.repositories, { ...result.repositories[0], repoId: 21, fullName: 'acme/extra' }] }); await poll;
  assert.equal(page.nodes.get('repository-target').value, 'dirty/draft');
  assert.equal(page.context.reviewSelectedRepository(), false);
  poll = page.context.discoverRepositories({ silent: true });
  await page.nodes.get('finish-setup').listeners.click();
  release(result); await poll;
  assert.equal(page.context.reviewSelectedRepository(), false);
  assert.equal(page.nodes.get('onboarding').hidden, true);
});

test('queued manual Check cannot open a modal after setup lifecycle changes', async () => {
  let release;
  const result = { repositories: [], installations: [] };
  let requests = 0;
  const page = harness({ reply: () => ++requests === 1 ? new Promise(resolve => { release = resolve; }) : result });
  page.render({ appConfigured: true, auth: connectedState.auth });
  await page.context.rememberRepositoryTarget('acme/new');
  vm.runInContext("discoveryStatus = 'ready';", page.context);
  const poll = page.context.discoverRepositories({ silent: true });
  const check = page.submit('repository-target-form');
  await new Promise(resolve => setImmediate(resolve));
  vm.runInContext('setupCancelled = true; stopRepositoryMonitoring();', page.context);
  release(result);
  await Promise.all([poll, check]);
  assert.equal(page.nodes.get('repository-access-panel').open, false);
  assert.equal(page.nodes.get('repository-confirmation').open, false);
  assert.equal(page.requests.length, 1);
});

test('manual check opens native initialization confirmation without writing', async () => {
  const repository = { installationId: 10, repoId: 20, fullName: 'acme/new', state: 'uninitialized', canInitialize: true, eligible: true };
  const page = harness({ reply: request => request.type === 'INSPECT_REPOSITORY'
    ? { repository } : { repositories: [{ ...repository, state: undefined, canInitialize: undefined, eligible: false }], installations: [] } });
  page.render({ appConfigured: true, auth: connectedState.auth });
  page.nodes.get('repository-target').value = 'acme/new';
  await page.submit('repository-target-form');
  assert.equal(page.nodes.get('repository-confirmation').open, true);
  assert.match(page.nodes.get('repository-confirmation-body').textContent, /read access/);
  assert.equal(page.requests.some(request => request.type === 'SELECT_REPOSITORY'), false);
});

test('unverified rows show their status and checking an arbitrary name inspects only its stable IDs', async () => {
  const repositories = [
    { installationId: 10, repoId: 20, fullName: 'acme/other', owner: 'acme', repo: 'other', eligible: true },
    { installationId: 11, repoId: 21, fullName: 'zalupa/picropenis', owner: 'zalupa', repo: 'picropenis', eligible: true },
  ];
  const page = harness({ reply: request => request.type === 'INSPECT_REPOSITORY'
    ? { repository: { ...repositories[1], state: 'uninitialized', canInitialize: true } }
    : { repositories, installations: [] } });
  page.render({ ready: false, appConfigured: true, auth: connectedState.auth });
  await page.context.discoverRepositories();
  assert.equal(page.requests.filter(request => request.type === 'INSPECT_REPOSITORY').length, 0);
  assert.equal(page.nodes.get('repository-list').children.length, 0);
  page.nodes.get('repository-target').value = 'zalupa/picropenis';
  await page.submit('repository-target-form');
  const checks = page.requests.filter(request => request.type === 'INSPECT_REPOSITORY');
  assert.equal(checks.length, 1);
  assert.equal(checks[0].payload.installationId, 11);
  assert.equal(checks[0].payload.repoId, 21);
  assert.equal(page.nodes.get('repository-confirmation').open, true);
  assert.equal(page.requests.filter(request => request.type === 'INSPECT_REPOSITORY').length, 1);
});

test('choosing an autocomplete suggestion checks access without connecting', async () => {
  let release;
  const repository = { installationId: 10, repoId: 20, fullName: 'acme/time-data', owner: 'acme', repo: 'time-data', eligible: true };
  const page = harness({ reply: request => request.type === 'INSPECT_REPOSITORY'
    ? new Promise(resolve => { release = resolve; })
    : { repositories: [repository], installations: [] } });
  page.render({ appConfigured: true, auth: connectedState.auth });
  await page.context.discoverRepositories();
  const input = page.nodes.get('repository-target');
  input.value = 'time'; input.listeners.input();
  const action = page.nodes.get('repository-list').children[0];
  assert.equal(action.textContent, repository.fullName);
  const click = action.listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.nodes.get('repository-list').hidden, true);
  assert.equal(input.value, repository.fullName);
  assert.equal(page.nodes.get('repository-target-status').hidden, true);
  assert.equal(page.nodes.get('repository-target-status').textContent, '');
  assert.equal(page.nodes.get('check-repository-target').textContent, 'Checking…');
  release({ repository: { ...repository, state: 'incompatible', eligible: false } });
  await click;
  assert.match(page.nodes.get('repository-target-status').textContent, /Unavailable/);
  assert.equal(page.nodes.get('repository-confirmation').open, false);
  assert.equal(page.requests.some(request => request.type === 'SELECT_REPOSITORY'), false);
});

test('leaving a manual repository name waits for Check without inspecting it', async () => {
  const repository = { installationId: 10, repoId: 20, fullName: 'acme/typed', eligible: true };
  const page = harness({ reply: request => request.type === 'INSPECT_REPOSITORY'
    ? { repository: { ...repository, state: 'incompatible', eligible: false } }
    : { repositories: [repository], installations: [] } });
  page.render({ appConfigured: true, auth: connectedState.auth });
  await page.context.discoverRepositories();
  const input = page.nodes.get('repository-target');
  input.value = 'acme/typed'; input.listeners.input();
  assert.equal(page.requests.filter(request => request.type === 'INSPECT_REPOSITORY').length, 0);
  await input.listeners.blur();
  assert.equal(page.requests.filter(request => request.type === 'INSPECT_REPOSITORY').length, 0);
  assert.equal(page.nodes.get('repository-target-status').hidden, true);
  await page.nodes.get('check-repository-target').listeners.click();
  assert.equal(page.requests.filter(request => request.type === 'INSPECT_REPOSITORY').length, 1);
  assert.equal(input.value, 'acme/typed');
  assert.match(page.nodes.get('repository-target-status').textContent, /Unavailable/);
  assert.equal(page.requests.some(request => request.type === 'SELECT_REPOSITORY'), false);
});

test('unknown manual target retains its name and displays a red access error', async () => {
  const page = harness({ reply: () => ({ repositories: [], installations: [] }) });
  page.render({ appConfigured: true, auth: connectedState.auth });
  const input = page.nodes.get('repository-target');
  input.value = 'acme/unknown'; input.listeners.input();
  await input.listeners.blur();
  assert.equal(page.nodes.get('repository-target-status').hidden, true);
  await page.nodes.get('check-repository-target').listeners.click();
  assert.equal(input.value, 'acme/unknown');
  assert.match(page.nodes.get('repository-target-status').textContent, /cannot access/);
  assert.match(page.nodes.get('repository-target-status').className, /repository-target-error/);
  assert.equal(input.attributes['aria-invalid'], 'true');
  assert.equal(page.nodes.get('repository-access-panel').open, true);
});

test('unfinished repository names validate on Check, never on blur', async () => {
  const page = harness();
  page.render({ appConfigured: true, auth: connectedState.auth });
  const input = page.nodes.get('repository-target');
  input.value = 'acme/'; input.listeners.input();
  await input.listeners.blur();
  assert.equal(page.requests.length, 0);
  assert.equal(input.value, 'acme/');
  assert.equal(input.attributes['aria-invalid'], undefined);
  assert.equal(page.nodes.get('repository-target-status').hidden, true);
  await page.nodes.get('check-repository-target').listeners.click();
  assert.equal(page.requests.length, 0);
  assert.equal(input.attributes['aria-invalid'], 'true');
  assert.match(page.nodes.get('repository-target-status').textContent, /Enter a valid GitHub repository URL/);
  input.value = ''; input.listeners.input();
  await input.listeners.blur();
  assert.equal(input.attributes['aria-invalid'], undefined);
  assert.equal(page.nodes.get('repository-target-status').hidden, true);
});

test('Check button checks a manual target once without an extra blur check', async () => {
  let discoveries = 0;
  const page = harness({ reply: request => {
    if (request.type === 'DISCOVER_REPOSITORIES') discoveries += 1;
    return { repositories: [], installations: [] };
  } });
  page.render({ appConfigured: true, auth: connectedState.auth });
  const input = page.nodes.get('repository-target');
  const refresh = page.nodes.get('check-repository-target');
  assert.equal(refresh.disabled, true);
  input.value = 'acme/unknown'; input.listeners.input();
  assert.equal(refresh.disabled, false);
  assert.equal(refresh.textContent, 'Check');
  await input.listeners.blur({ relatedTarget: { id: 'check-repository-target' } });
  assert.equal(discoveries, 0);
  await refresh.listeners.click();
  assert.equal(discoveries, 1);
  assert.equal(refresh.disabled, false);
});

test('Check button alone shows progress before the completed inspection feedback', async () => {
  let release;
  const repository = { installationId: 10, repoId: 20, fullName: 'acme/time-data', owner: 'acme', repo: 'time-data', eligible: true };
  const page = harness({ reply: request => request.type === 'INSPECT_REPOSITORY'
    ? new Promise(resolve => { release = resolve; })
    : { repositories: [repository], installations: [] } });
  page.render({ appConfigured: true, auth: connectedState.auth });
  await page.context.discoverRepositories();
  const input = page.nodes.get('repository-target');
  const status = page.nodes.get('repository-target-status');
  const refresh = page.nodes.get('check-repository-target');
  input.value = repository.fullName; input.listeners.input();
  const click = refresh.listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(status.hidden, true, 'do not show a separate message while the Check button is busy');
  assert.equal(status.textContent, '', 'avoid displaying redundant progress text beside the Check button');
  assert.equal(refresh.disabled, true);
  assert.equal(refresh.attributes['aria-busy'], 'true', 'the Check button signals the pending inspection');
  assert.equal(refresh.textContent, 'Checking…');
  assert.equal(page.requests.filter(request => request.type === 'INSPECT_REPOSITORY').length, 1);
  release({ repository: { ...repository, state: 'incompatible', eligible: false } });
  await click;
  assert.match(status.textContent, /Checked acme\/time-data/);
  assert.match(status.textContent, /Unavailable/);
  assert.match(status.textContent, /Repository files were not changed/);
  assert.equal(refresh.disabled, false);
  assert.equal(refresh.attributes['aria-busy'], 'false');
  assert.equal(refresh.textContent, 'Check');
  assert.equal(page.requests.some(request => request.type === 'SELECT_REPOSITORY'), false);
});

test('automatic grant-return check keeps the Check button busy through discovery and inspection', async () => {
  const target = { installationId: 10, repoId: 20, fullName: 'acme/time-data', eligible: true };
  let releaseDiscovery, releaseInspection;
  const page = harness({ reply: request => request.type === 'DISCOVER_REPOSITORIES'
    ? new Promise(resolve => { releaseDiscovery = resolve; })
    : request.type === 'INSPECT_REPOSITORY'
      ? new Promise(resolve => { releaseInspection = resolve; }) : {} });
  page.render({ appConfigured: true, auth: connectedState.auth });
  page.nodes.get('repository-target').value = target.fullName;
  await page.context.rememberRepositoryTarget(target.fullName);
  page.context.document.visibilityState = 'visible';
  page.windowListeners.blur();
  page.windowListeners.focus();
  const delayed = page.timers.find(timer => timer.delay === 1000 && !timer.cleared);
  assert.ok(delayed);
  delayed.callback();
  const refresh = page.nodes.get('check-repository-target');
  assert.equal(refresh.attributes['aria-busy'], 'true', 'show activity during discovery');
  assert.equal(page.nodes.get('repository-target-status').hidden, true, 'do not duplicate the automatic check progress');
  releaseDiscovery({ repositories: [target], installations: [] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(refresh.attributes['aria-busy'], 'true', 'keep showing activity during inspection');
  assert.equal(page.nodes.get('repository-target-status').hidden, true);
  releaseInspection({ repository: { ...target, state: 'uninitialized', canInitialize: true } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(refresh.attributes['aria-busy'], 'false', 'stop after the read-only check settles');
  assert.equal(page.requests.some(request => request.type === 'SELECT_REPOSITORY'), false);
});

test('manual Check exposes a retryable local failure when the listed target inspection fails', async () => {
  const repository = { installationId: 10, repoId: 20, fullName: 'acme/time-data', owner: 'acme', repo: 'time-data', eligible: true };
  const page = harness({ reply: request => request.type === 'INSPECT_REPOSITORY'
    ? new Error('GitHub unavailable') : { repositories: [repository], installations: [] } });
  page.render({ appConfigured: true, auth: connectedState.auth });
  await page.context.discoverRepositories();
  const input = page.nodes.get('repository-target');
  input.value = repository.fullName; input.listeners.input();
  await page.nodes.get('check-repository-target').listeners.click();
  const status = page.nodes.get('repository-target-status');
  assert.match(status.textContent, /Check failed.*GitHub unavailable/);
  assert.match(status.className, /repository-target-error/);
  assert.equal(page.nodes.get('check-repository-target').disabled, false);
  assert.equal(page.nodes.get('check-repository-target').attributes['aria-busy'], 'false');
});

test('manual Check reports authorization blocks beside the field without inspecting', async () => {
  const page = harness({ reply: request => request.type === 'DISCOVER_REPOSITORIES'
    ? { blocked: { message: 'GitHub authorization expired.' }, repositories: [], installations: [] }
    : {} });
  page.render({ appConfigured: true, auth: connectedState.auth });
  const input = page.nodes.get('repository-target');
  input.value = 'acme/time-data'; input.listeners.input();
  await page.nodes.get('check-repository-target').listeners.click();
  assert.match(page.nodes.get('repository-target-status').textContent, /Check blocked: GitHub authorization expired/);
  assert.match(page.nodes.get('repository-target-status').className, /repository-target-error/);
  assert.equal(page.requests.some(request => request.type === 'INSPECT_REPOSITORY'), false);
});

test('choosing a list row while editing a manual target does not check the abandoned input', async () => {
  const repository = { installationId: 10, repoId: 20, fullName: 'acme/listed', eligible: true };
  const page = harness({ reply: request => request.type === 'INSPECT_REPOSITORY'
    ? { repository: { ...repository, state: 'incompatible', eligible: false } }
    : { repositories: [repository], installations: [] } });
  page.render({ appConfigured: true, auth: connectedState.auth });
  await page.context.discoverRepositories();
  const input = page.nodes.get('repository-target');
  input.value = 'listed'; input.listeners.input();
  const action = page.nodes.get('repository-list').children[0];
  await input.listeners.blur({ relatedTarget: action });
  await action.listeners.click();
  assert.equal(page.requests.filter(request => request.type === 'DISCOVER_REPOSITORIES').length, 2);
  assert.equal(page.requests.filter(request => request.type === 'INSPECT_REPOSITORY').length, 1);
  assert.equal(input.value, 'acme/listed');
});

test('inspection failure clears checking state and keeps a retryable row', async () => {
  const repository = { installationId: 10, repoId: 20, fullName: 'acme/time-data', eligible: true };
  const page = harness({ reply: request => request.type === 'INSPECT_REPOSITORY'
    ? new Error('GitHub unavailable') : { repositories: [repository], installations: [] } });
  page.render({ appConfigured: true, auth: connectedState.auth });
  await page.context.discoverRepositories();
  page.nodes.get('repository-target').value = 'acme/time-data';
  await page.nodes.get('check-repository-target').listeners.click();
  assert.match(page.nodes.get('repository-target-status').textContent, /Check failed/);
  assert.equal(page.nodes.get('check-repository-target').disabled, false);
});

test('checking a ready repository offers a separate connect confirmation without connecting it', async () => {
  const repository = { installationId: 10, repoId: 20, fullName: 'acme/time-data', owner: 'acme', repo: 'time-data',
    state: 'initialized_member', canAdd: true, eligible: true, ready: true };
  const page = harness({ reply: request => request.type === 'DISCOVER_REPOSITORIES'
    ? { repositories: [{ installationId: 10, repoId: 20, fullName: 'acme/time-data', eligible: true }], installations: [] }
    : request.type === 'INSPECT_REPOSITORY' ? { repository } : request.type === 'SELECT_REPOSITORY' ? { status: 'access_checked' }
      : request.type === 'GET_ONBOARDING_STATE' ? connectedState : preferences });
  page.render({ appConfigured: true, auth: connectedState.auth });
  const input = page.nodes.get('repository-target');
  input.value = 'acme/time-data';
  await page.nodes.get('check-repository-target').listeners.click();
  assert.equal(page.requests.filter(request => request.type === 'SELECT_REPOSITORY').length, 0);
  assert.equal(page.nodes.get('repository-confirmation').open, false, 'Check alone cannot open the connect confirmation');
  assert.match(page.nodes.get('repository-target-status').textContent, /Ready.*Connect repository/);
  assert.equal(page.nodes.get('connect-checked-repository').hidden, false);
  await page.nodes.get('connect-checked-repository').listeners.click();
  assert.equal(page.nodes.get('repository-confirmation').open, true);
  await page.nodes.get('back-to-repository-selection').listeners.click();
  await page.nodes.get('connect-checked-repository').listeners.click();
  assert.equal(page.nodes.get('repository-confirmation').open, true);
  assert.equal(page.nodes.get('repository-write-details').hidden, true);
  assert.equal(page.requests.filter(request => request.type === 'SELECT_REPOSITORY').length, 0);
  await page.nodes.get('confirm-repository-action').listeners.click();
  assert.equal(page.requests.find(request => request.type === 'SELECT_REPOSITORY').payload.action, 'connect');
});

test('Enter check retains a ready manual target and exposes Connect beside it', async () => {
  const listed = { installationId: 10, repoId: 20, fullName: 'acme/time-data', eligible: true };
  const ready = { ...listed, owner: 'acme', repo: 'time-data', state: 'initialized_member', canAdd: true, ready: true };
  const page = harness({ reply: request => request.type === 'INSPECT_REPOSITORY'
    ? { repository: ready } : { repositories: [listed], installations: [] } });
  page.render({ appConfigured: true, auth: connectedState.auth });
  const input = page.nodes.get('repository-target');
  input.value = 'acme/time-data'; input.listeners.input();
  await page.submit('repository-target-form');
  assert.equal(input.value, 'acme/time-data');
  assert.equal(page.nodes.get('connect-checked-repository').hidden, false);
  assert.equal(page.nodes.get('repository-confirmation').open, false);
  assert.equal(page.requests.some(request => request.type === 'SELECT_REPOSITORY'), false);
});

test('manual check of a repository outside the list prevents competing row checks', async () => {
  let release;
  let discoveries = 0;
  const repository = { installationId: 10, repoId: 20, fullName: 'acme/listed', eligible: true };
  const page = harness({ reply: request => request.type === 'DISCOVER_REPOSITORIES' && ++discoveries === 2
    ? new Promise(resolve => { release = resolve; }) : { repositories: [repository], installations: [] } });
  page.render({ appConfigured: true, auth: connectedState.auth });
  await page.context.discoverRepositories();
  page.nodes.get('repository-target').value = 'acme/other';
  const check = page.submit('repository-target-form');
  for (let i = 0; i < 10 && !release; i += 1) await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof release, 'function');
  assert.equal(page.nodes.get('check-repository-target').disabled, true);
  release({ repositories: [repository], installations: [] });
  await check;
  assert.equal(page.nodes.get('check-repository-target').disabled, false);
});

test('access create link uses the checked target and preserves private template defaults', async () => {
  const page = harness({ reply: () => ({ repositories: [], installations: [] }) });
  page.render({ ready: false, appConfigured: true, auth: { mode: 'github_app', githubLogin: 'alice' } });
  page.nodes.get('repository-target').value = 'acme/another.repo-2';
  await page.submit('repository-target-form');
  const url = new URL(page.nodes.get('modal-new-time-repository').href);
  assert.equal(url.searchParams.get('name'), 'another.repo-2');
  assert.equal(url.searchParams.get('owner'), 'acme');
  assert.equal(url.searchParams.get('visibility'), 'private');
  assert.equal(url.searchParams.get('template_owner'), 'Clockoli');
  assert.equal(url.searchParams.get('template_name'), 'data-template');
});

test('creating a repository offers the URL field inside the handoff dialog without checking on open', () => {
  const page = harness();
  page.render({ appConfigured: true, auth: connectedState.auth });
  page.nodes.get('new-time-repository').listeners.click();
  const dialog = page.nodes.get('new-repository-guidance');
  assert.equal(dialog.open, true);
  assert.match(html, /id="new-repository-guidance"[\s\S]*<form id="new-repository-target-form"[\s\S]*<label for="new-repository-target">New repository URL<\/label>/i);
  assert.equal(page.nodes.get('new-repository-target').value, '');
  assert.equal(page.requests.length, 0);
  page.nodes.get('close-new-repository-guidance').listeners.click();
  assert.equal(dialog.open, false);
  assert.equal(page.nodes.get('repository-target').focused, true);
});

test('submitting a URL in the handoff dialog checks the target without connecting it', async () => {
  const listed = { installationId: 10, repoId: 20, fullName: 'acme/time-data', eligible: true };
  const ready = { ...listed, owner: 'acme', repo: 'time-data', state: 'initialized_member', canAdd: true, ready: true };
  const page = harness({ reply: request => request.type === 'DISCOVER_REPOSITORIES'
    ? { repositories: [listed], installations: [] }
    : request.type === 'INSPECT_REPOSITORY' ? { repository: ready } : {} });
  page.render({ appConfigured: true, auth: connectedState.auth });
  page.nodes.get('new-time-repository').listeners.click();
  page.nodes.get('new-repository-target').value = 'https://github.com/acme/time-data';
  await page.submit('new-repository-target-form');
  assert.equal(page.nodes.get('new-repository-guidance').open, false);
  assert.equal(page.nodes.get('repository-target').value, 'acme/time-data');
  assert.equal(page.requests.some(request => request.type === 'INSPECT_REPOSITORY'), true);
  assert.equal(page.requests.some(request => request.type === 'SELECT_REPOSITORY'), false);
  assert.equal(page.nodes.get('connect-checked-repository').hidden, false);
  assert.equal(page.nodes.get('repository-confirmation').open, false);
});

test('invalid handoff URL remains editable in the dialog and cannot inspect an old target', async () => {
  const page = harness();
  page.render({ appConfigured: true, auth: connectedState.auth });
  page.nodes.get('repository-target').value = 'acme/previous';
  page.nodes.get('new-time-repository').listeners.click();
  page.nodes.get('new-repository-target').value = 'https://example.com/acme/time-data';
  await page.submit('new-repository-target-form');
  assert.equal(page.nodes.get('new-repository-guidance').open, true);
  assert.equal(page.nodes.get('repository-target').value, 'acme/previous');
  assert.equal(page.nodes.get('new-repository-target').attributes['aria-invalid'], 'true');
  assert.match(page.nodes.get('new-repository-target-error').textContent, /GitHub repository URL/);
  assert.equal(page.requests.length, 0);
});

test('setup exposes connected repositories and finishes without another repository write', async () => {
  const page = harness();
  page.render(connectedState);
  vm.runInContext('showOnboarding = true; renderState();', page.context);
  assert.equal(page.nodes.get('time-repositories').hidden, false);
  assert.equal(page.nodes.get('finish-setup').disabled, false);
  await page.nodes.get('finish-setup').listeners.click();
  assert.equal(page.nodes.get('onboarding').hidden, true);
  assert.equal(page.requests.length, 0);
  page.render({ ready: false, appConfigured: true, auth: connectedState.auth });
  assert.equal(page.nodes.get('finish-setup').disabled, true);
});

test('a discovered default whose Clockoli membership is missing cannot finish setup', async () => {
  const page = harness({ reply: request => request.type === 'DISCOVER_REPOSITORIES'
    ? { repositories: [{ installationId: 10, repoId: 20, fullName: 'octocat/clockoli-data',
      eligible: true, ready: true, state: 'uninitialized', canAdd: false }], installations: [] } : {} });
  page.render(connectedState);
  vm.runInContext('showOnboarding = true; renderState();', page.context);
  await page.context.discoverRepositories();
  assert.equal(page.nodes.get('finish-setup').disabled, true);
  await page.nodes.get('finish-setup').listeners.click();
  assert.equal(page.nodes.get('onboarding').hidden, false);
});

test('pending reauthorization has no per-repository confirmation action and cannot finish before automatic promotion', () => {
  const page = harness();
  page.render({ ...connectedState, candidateAuth: { mode: 'github_app', githubLogin: 'octocat' } });
  page.context.renderRepositories({ repositories: [{ installationId: 10, repoId: 20, fullName: 'octocat/clockoli-data', state: 'initialized_member', canAdd: true, eligible: true, ready: true }], installations: [] });
  assert.equal(page.nodes.get('finish-setup').disabled, true);
  assert.equal(vm.runInContext('repositoryCanBeSelected(selectedRepository)', page.context), false);
  assert.equal(page.context.reviewSelectedRepository(), false);
  assert.ok(page.nodes.get('repository-list').children.every(row => row.children.length === 2));
  assert.equal(page.nodes.get('repository-confirmation').open, false);
  assert.equal(page.nodes.get('repository-list').hidden, true);
});

test('Finish clears remembered target and reviewed writes without changing connected settings', async () => {
  const savedChoices = new Map();
  const page = harness({ savedChoices });
  page.render(connectedState);
  await page.context.rememberRepositoryTarget('acme/more-time');
  vm.runInContext('showOnboarding = true; renderState();', page.context);
  await page.nodes.get('finish-setup').listeners.click();
  assert.equal(savedChoices.get('octocat'), '');
  assert.equal(page.nodes.get('repository-target').value, '');
  assert.equal(page.context.reviewSelectedRepository(), false);
  assert.equal(page.nodes.get('onboarding').hidden, true);
  assert.equal(page.requests.length, 0);
});

test('Finish is blocked throughout an in-flight repository connection', async () => {
  let release;
  const response = new Promise(resolve => { release = resolve; });
  const page = harness({ reply: request => request.type === 'SELECT_REPOSITORY' ? response : request.type === 'GET_ONBOARDING_STATE' ? connectedState : request.type === 'DISCOVER_REPOSITORIES' ? { repositories: [{ fullName: 'octocat/clockoli-data', state: 'initialized_member', canAdd: true, eligible: true }], installations: [] } : preferences });
  page.render(connectedState);
  vm.runInContext('showOnboarding = true; renderState();', page.context);
  page.context.renderRepositories({ repositories: [{ installationId: 10, repoId: 21, fullName: 'acme/more-time', state: 'initialized_member', canAdd: true, eligible: true }], installations: [] });
  vm.runInContext('selectedRepository = repositories[0];', page.context);
  assert.equal(page.context.reviewSelectedRepository(), true);
  const pending = page.context.confirmRepositoryAction();
  assert.equal(page.nodes.get('finish-setup').disabled, true);
  // Guard the operation state even if an old render made the control enabled.
  page.nodes.get('finish-setup').disabled = false;
  await page.nodes.get('finish-setup').listeners.click();
  assert.equal(page.nodes.get('onboarding').hidden, false);
  release({});
  assert.equal(await pending, true, page.nodes.get('message').textContent);
  assert.equal(page.nodes.get('finish-setup').disabled, false);
  assert.equal(page.requests.filter(request => request.type === 'SELECT_REPOSITORY').length, 1);
});

test('late discovery cannot restore a reviewed repository after the target is edited', async () => {
  const repository = { installationId: 10, repoId: 20, fullName: 'alice/time-data', owner: 'alice', repo: 'time-data', ownerType: 'User', state: 'initialized_member', canAdd: true, eligible: true };
  let release;
  const response = new Promise(resolve => { release = resolve; });
  const page = harness({ reply: () => response });
  page.render({ ready: false, appConfigured: true, auth: { mode: 'github_app', githubLogin: 'alice' } });
  await page.context.rememberRepositoryTarget(repository.fullName);
  page.context.renderRepositories({ repositories: [repository], installations: [] });
  page.context.reviewSelectedRepository();
  assert.equal(page.nodes.get('repository-confirmation').hidden, false);
  const pending = page.context.discoverRepositories();
  page.nodes.get('repository-target').value = 'acme/time-data';
  page.nodes.get('repository-target').listeners.input();
  release({ repositories: [repository], candidates: [repository] });
  await pending;
  assert.equal(page.nodes.get('repository-target').value, 'acme/time-data');
  assert.equal(vm.runInContext('!repositoryCanBeSelected(selectedRepository)', page.context), true);
  assert.equal(page.nodes.get('repository-confirmation').hidden, true);
  assert.equal(page.nodes.get('repository-access-panel').hidden, true);
  assert.equal(page.context.reviewSelectedRepository(), false);
  assert.equal(await page.context.confirmRepositoryAction(), false);
  assert.equal(page.requests.filter(request => request.type === 'SELECT_REPOSITORY').length, 0);
});

test('manual target survives page reload and never falls back to another owner with the same repository name', async () => {
  const savedChoices = new Map();
  const authState = { ready: false, appConfigured: true, auth: { mode: 'github_app', githubUserId: 1, githubLogin: 'alice' } };
  const alice = { installationId: 10, repoId: 20, fullName: 'alice/time-data', owner: 'alice', repo: 'time-data', ownerType: 'User', state: 'initialized_member', canAdd: true, eligible: true };
  const acme = { ...alice, installationId: 11, repoId: 21, fullName: 'acme/time-data', owner: 'acme', ownerType: 'Organization' };
  let granted = false;
  const reply = request => {
    if (request.type === 'GET_ONBOARDING_STATE') return authState;
    if (request.type === 'RESUME_DEVICE_FLOW') return null;
    if (request.type === 'DISCOVER_REPOSITORIES') return { repositories: granted ? [alice, acme] : [alice], installations: [{ accountLogin: 'acme', settingsUrl: 'https://github.com/settings/installations/11' }] };
    throw new Error(`Unexpected message: ${request.type}`);
  };
  const page = harness({ reply, savedChoices });
  await page.context.refreshState();
  assert.equal(page.requests.filter(request => request.type === 'DISCOVER_REPOSITORIES').length, 0);
  assert.equal(page.nodes.get('repository-access-panel').hidden, true);
  page.nodes.get('repository-target').value = 'https://github.com/acme/time-data';
  await page.submit('repository-target-form');
  assert.equal(savedChoices.get('1'), 'acme/time-data');
  assert.equal(vm.runInContext('!repositoryCanBeSelected(selectedRepository)', page.context), true);
  assert.equal(page.nodes.get('repository-access-panel').hidden, false);
  assert.equal(page.nodes.get('install-app').href, 'https://github.com/settings/installations/11');
  assert.match(page.nodes.get('repository-target-status').textContent, /cannot access this repository/);
  const reopened = harness({ reply, savedChoices });
  await reopened.context.refreshState();
  assert.equal(reopened.nodes.get('repository-target').value, 'acme/time-data');
  assert.equal(reopened.context.reviewSelectedRepository(), false);
  assert.equal(reopened.nodes.get('repository-access-panel').open, false, 'Reload never opens an access modal');
  assert.equal(page.nodes.get('repository-access-panel').open, true, 'Only explicit Check opens the modal');
  granted = true;
  await reopened.context.discoverRepositories();
  assert.equal(vm.runInContext('repositoryCanBeSelected(selectedRepository)', reopened.context), true);
  assert.equal(reopened.nodes.get('repository-access-panel').hidden, true);
  reopened.context.reviewSelectedRepository();
  assert.match(reopened.nodes.get('repository-confirmation-title').textContent, /acme\/time-data/);
  assert.equal(reopened.requests.filter(request => request.type === 'SELECT_REPOSITORY').length, 0);
});

test('discovery failure keeps the manual target without misreporting missing permission', async () => {
  const page = harness({ reply: () => new Error('GitHub rate limit exceeded') });
  page.render({ ready: false, appConfigured: true, auth: { mode: 'github_app', githubLogin: 'alice' } });
  page.nodes.get('repository-target').value = 'acme/time-data';
  await page.submit('repository-target-form');
  assert.equal(page.nodes.get('repository-target').value, 'acme/time-data');
  assert.match(page.nodes.get('message').textContent, /rate limit/);
  assert.equal(page.nodes.get('repository-access-panel').hidden, true);
  assert.equal(vm.runInContext('!repositoryCanBeSelected(selectedRepository)', page.context), true);
  assert.equal(page.requests.filter(request => request.type === 'SELECT_REPOSITORY').length, 0);
});

test('access modal closes on Grant and return checks only the remembered target without connecting it', async () => {
  let granted = false;
  const target = { installationId: 11, repoId: 21, fullName: 'acme/time-data', owner: 'acme', repo: 'time-data', ownerType: 'Organization', state: 'initialized_joinable', canJoin: true, eligible: true };
  const page = harness({ reply: request => request.type === 'INSPECT_REPOSITORY'
    ? { repository: target } : { repositories: granted ? [{ ...target, state: undefined, canJoin: undefined }] : [], installations: [] } });
  page.context.window.open = () => ({ opener: {}, location: { replace(url) { assert.equal(url, 'https://github.com/apps/clockoli/installations/new'); } } });
  page.render({ ready: false, appConfigured: true, auth: { mode: 'github_app', githubLogin: 'alice' }, installationUrl: 'https://github.com/apps/clockoli/installations/new' });
  page.nodes.get('repository-target').value = 'acme/time-data';
  await page.submit('repository-target-form');
  assert.equal(page.nodes.get('repository-access-panel').open, true);
  page.nodes.get('install-app').listeners.click({ preventDefault() {} });
  assert.equal(page.nodes.get('repository-access-panel').open, false);
  assert.equal(page.nodes.get('repository-target').focused, true);
  page.windowListeners.blur();
  granted = true;
  page.context.document.visibilityState = 'visible';
  await page.context.rediscoverAfterGitHubHandoff();
  const delayed = page.timers.find(timer => timer.delay === 1000 && !timer.cleared);
  assert.ok(delayed);
  delayed.cleared = true;
  delayed.callback();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.requests.filter(request => request.type === 'INSPECT_REPOSITORY').length, 1);
  assert.equal(vm.runInContext('repositoryCanBeSelected(selectedRepository)', page.context), true);
  assert.equal(page.nodes.get('repository-access-panel').open, false);
  assert.equal(page.requests.filter(request => request.type === 'SELECT_REPOSITORY').length, 0);
});

test('known repository missing App write access does not claim existence is unknown', async () => {
  const repository = { installationId: 10, repoId: 20, fullName: 'acme/time-data', state: 'unavailable', reasons: ['app_contents_write_required'], eligible: false };
  const page = harness({ reply: request => request.type === 'INSPECT_REPOSITORY'
    ? { repository } : { repositories: [{ ...repository, state: undefined }], installations: [] } });
  page.render({ ready: false, appConfigured: true, auth: { mode: 'github_app', githubLogin: 'alice' } });
  page.nodes.get('repository-target').value = 'acme/time-data';
  await page.submit('repository-target-form');
  assert.equal(page.nodes.get('repository-access-panel').open, true);
  assert.match(page.nodes.get('repository-access-instruction').textContent, /Contents: Read and write/);
  assert.doesNotMatch(page.nodes.get('repository-access-instruction').textContent, /existence/);
  page.nodes.get('close-repository-access').listeners.click();
  assert.equal(page.nodes.get('repository-access-panel').open, false);
  assert.equal(page.nodes.get('repository-target').focused, true);
});

test('secondary settings collapse only on disconnect and remain reachable across refreshes', () => {
  const page = harness();
  page.render({ ready: false, appConfigured: true });
  assert.equal(page.nodes.get('more-settings')?.open, false);
  page.nodes.get('more-settings').open = true;
  page.render({ ready: false, appConfigured: true });
  assert.equal(page.nodes.get('more-settings').open, true);
  page.render(connectedState);
  assert.equal(page.nodes.get('more-settings').open, true);
  assert.equal(page.nodes.get('more-settings-toggle').hidden, true);
  page.render({ ...connectedState, ready: false, auth: null });
  assert.equal(page.nodes.get('more-settings').open, false);
  assert.equal(page.nodes.get('more-settings-toggle').hidden, false);
  assert.equal(page.nodes.get('display-settings').hidden, false);
  assert.equal(page.nodes.get('connected').hidden, true);
});

for (const [form, requestType, originalLabel] of [
  ['display', 'UPDATE_DISPLAY_PREFERENCES', 'Save projects and routing'],
  ['billing', 'SAVE_BILLING_SETTINGS', 'Save billable rates'],
  ['invoicing', 'SAVE_BILLING_SETTINGS', 'Save invoicing settings'],
]) {
  test(`${form} save confirms on its button for two seconds and keeps errors beside it`, async () => {
    let fail = false;
    const page = harness({ reply(request) {
      if (request.type === requestType) {
        assert.equal(page.nodes.get(`save-${form}`).disabled, true);
        if (fail) return new Error('Save rejected');
        return request.type === 'SAVE_BILLING_SETTINGS'
          ? billingSaveResult(request)
          : { config: connectedState.config, preferences: { ...preferences, ...request.payload, revision: 1 }, revision: 1 };
      }
      if (request.type === 'GET_LOCAL_PREFERENCES') return preferences;
      throw new Error(`Unexpected message: ${request.type}`);
    } });
    page.context.renderLocalPreferences(preferences);
    page.render(connectedState);
    await page.submit(`${form}-form`);
    assert.equal(page.nodes.get(`${form}-feedback`)?.textContent, '');
    assert.equal(page.nodes.get('message').textContent, '');
    assert.equal(page.nodes.get(`save-${form}`).textContent, 'Saved');
    assert.equal(page.nodes.get(`save-${form}`).disabled, true);
    assert.equal(page.timers.at(-1).delay, 2000);
    page.timers.at(-1).callback();
    assert.equal(page.nodes.get(`save-${form}`).textContent, originalLabel);
    assert.equal(page.nodes.get(`save-${form}`).disabled, false);
    fail = true;
    const timerCount = page.timers.length;
    await page.submit(`${form}-form`);
    assert.equal(page.nodes.get(`${form}-feedback`).textContent, 'Save rejected');
    assert.match(page.nodes.get(`${form}-feedback`).className, /error/);
    assert.equal(page.nodes.get('message').textContent, '');
    assert.equal(page.nodes.get(`save-${form}`).textContent, originalLabel);
    assert.equal(page.nodes.get(`save-${form}`).disabled, false);
    assert.equal(page.timers.length, timerCount);
  });
}

test('client-card save confirms on the clicked replacement button and stale timers cannot restore a newer save', async () => {
  const page = harness({ reply: request => billingSaveResult(request) });
  page.context.renderLocalPreferences(preferences);
  const first = page.nodes.get('clients-list').querySelector('.save-client');
  await page.submit('invoicing-form', first);
  const replacement = page.nodes.get('clients-list').querySelector('.save-client');
  assert.notEqual(replacement, first);
  assert.equal(replacement.textContent, 'Saved'); assert.equal(replacement.disabled, true);
  const stale = page.timers.at(-1);
  replacement.disabled = false;
  await page.submit('invoicing-form', replacement);
  const newest = page.nodes.get('clients-list').querySelector('.save-client'), current = page.timers.at(-1);
  stale.callback();
  assert.equal(newest.textContent, 'Saved'); assert.equal(newest.disabled, true);
  current.callback();
  assert.equal(newest.textContent, 'Save'); assert.equal(newest.disabled, false);
});

test('invoicing save blocks every section save button and ignores concurrent submits until completion', async () => {
  const clients = [preferences.invoicing.clients[0], { ...preferences.invoicing.clients[0], id: 'client-2', name: 'Second client' }];
  const saved = { ...preferences, invoicing: { ...preferences.invoicing, clients } };
  let finishSave;
  const pendingSave = new Promise(resolve => { finishSave = resolve; });
  const page = harness({ reply: request => request.type === 'SAVE_BILLING_SETTINGS' ? pendingSave : saved });
  page.context.renderLocalPreferences(saved);
  const buttons = page.nodes.get('clients-list').querySelectorAll('.save-client'), clicked = buttons[0];
  const first = page.submit('invoicing-form', clicked);
  assert.equal(page.nodes.get('save-invoicing').disabled, true);
  for (const button of buttons) assert.equal(button.disabled, true);
  await page.submit('invoicing-form', buttons[1]);
  assert.equal(page.requests.filter(request => request.type === 'SAVE_BILLING_SETTINGS').length, 1);
  finishSave(billingSaveResult(page.requests[0], saved)); await first;
  const replacements = page.nodes.get('clients-list').querySelectorAll('.save-client');
  assert.equal(page.nodes.get('save-invoicing').disabled, false);
  assert.equal(replacements[0].textContent, 'Saved'); assert.equal(replacements[0].disabled, true);
  assert.equal(replacements[1].textContent, 'Save'); assert.equal(replacements[1].disabled, false);
});

test('restoring invoicing siblings does not clobber another active Saved confirmation', async () => {
  const page = harness({ reply: request => billingSaveResult(request) });
  page.context.renderLocalPreferences(preferences);
  await page.submit('invoicing-form');
  const sectionButton = page.nodes.get('save-invoicing'), sectionTimer = page.timers.at(-1);
  assert.equal(sectionButton.textContent, 'Saved'); assert.equal(sectionButton.disabled, true);
  await page.submit('invoicing-form', page.nodes.get('clients-list').querySelector('.save-client'));
  const clientButton = page.nodes.get('clients-list').querySelector('.save-client');
  assert.equal(sectionButton.textContent, 'Saved'); assert.equal(sectionButton.disabled, true);
  assert.equal(clientButton.textContent, 'Saved'); assert.equal(clientButton.disabled, true);
  sectionTimer.callback();
  assert.equal(sectionButton.textContent, 'Save invoicing settings'); assert.equal(sectionButton.disabled, false);
  assert.equal(clientButton.textContent, 'Saved'); assert.equal(clientButton.disabled, true);
});

test('editing any settings section clears persistent feedback and stored textarea content is auto-sized again on render', () => {
  const page = harness();
  for (const form of ['display', 'billing', 'invoicing']) {
    page.nodes.get(`${form}-feedback`).textContent = 'Old feedback';
    page.nodes.get(`${form}-form`).listeners.input();
    assert.equal(page.nodes.get(`${form}-feedback`).textContent, '');
  }
  const address = page.nodes.get('seller-address'), notes = page.nodes.get('invoice-notes');
  // A 1px border on each side sits outside scrollHeight under border-box sizing.
  address.scrollHeight = 48; notes.scrollHeight = 72;
  Object.assign(address, { offsetHeight: 50, clientHeight: 48 }); Object.assign(notes, { offsetHeight: 74, clientHeight: 72 });
  page.context.renderInvoicingPreferences(preferences);
  assert.equal(address.style.height, '50px'); assert.equal(notes.style.height, '74px');
  address.scrollHeight = 96; address.listeners.input();
  assert.equal(address.style.height, '98px');
});

test('hidden invoicing textareas keep their height when layout reports zero scroll height', () => {
  const page = harness(), address = page.nodes.get('seller-address'), notes = page.nodes.get('invoice-notes');
  address.style.height = '48px'; notes.style.height = '';
  address.scrollHeight = 0; notes.scrollHeight = 0;
  page.context.renderInvoicingPreferences(preferences);
  assert.equal(address.style.height, '48px'); assert.equal(notes.style.height, '');
});

for (const form of ['billing', 'invoicing']) test(`${form} surfaces stale invoice counter errors and refreshes only its own fields after success`, async () => {
  let fail = true;
  const message = 'Next invoice number cannot go below 8; invoice 7 has already been issued.';
  const page = harness({ reply(request) {
    if (request.type === 'SAVE_BILLING_SETTINGS') return fail ? new Error(message) : {
      ...billingSaveResult(request), invoicing: { ...preferences.invoicing, nextNumber: 9 },
    };
    throw new Error(`Unexpected message: ${request.type}`);
  } });
  page.context.renderLocalPreferences(preferences);
  page.nodes.get('invoice-notes').value = 'Edited';
  await page.submit(`${form}-form`);
  assert.equal(page.nodes.get(`${form}-feedback`).textContent, message);
  assert.match(page.nodes.get(`${form}-feedback`).className, /error/);
  assert.equal(page.nodes.get(`save-${form}`).disabled, false);
  assert.equal(page.requests.length, 1);
  fail = false; page.nodes.get('invoice-next-number').value = '8';
  await page.submit(`${form}-form`);
  assert.equal(page.requests.at(-1).type, 'SAVE_BILLING_SETTINGS');
  assert.equal(page.nodes.get('invoice-next-number').value, form === 'invoicing' ? '9' : '8');
  assert.equal(page.nodes.get(`${form}-feedback`).textContent, '');
  assert.equal(page.nodes.get(`save-${form}`).textContent, 'Saved');
});

test('invalid billable input reports inline without sending a mutation', async () => {
  const page = harness();
  page.nodes.get('rates-list').querySelectorAll = () => [{ querySelector: () => ({ value: 'invalid' }) }];
  await page.submit('billing-form');
  assert.match(page.nodes.get('billing-feedback')?.textContent || '', /rate|amount|currency/i);
  assert.equal(page.requests.length, 0);
  assert.equal(page.nodes.get('save-billing').disabled, false);
});

test('rates and invoicing saves send only their owned section and use the atomic returned revision', async () => {
  const page = harness({ reply(request) {
    if (request.type === 'SAVE_BILLING_SETTINGS') return { ...request.payload, projects: preferences.projects, otherProjectClient: '', revision: request.expectedRevision + 1 };
    throw new Error(`Unexpected message: ${request.type}`);
  } });
  page.context.renderLocalPreferences(preferences);
  await page.submit('billing-form');
  await page.submit('invoicing-form');
  const saves = page.requests.filter(request => request.type === 'SAVE_BILLING_SETTINGS');
  assert.equal(saves.length, 2);
  assert.deepEqual(Object.keys(saves[0].payload), ['rates']);
  assert.equal(saves[0].payload.rates.octocat[0].amountMinorPerHour, 12500);
  assert.equal(saves[0].expectedRevision, preferences.revision);
  assert.deepEqual(Object.keys(saves[1].payload), ['invoicing']);
  assert.equal(saves[1].payload.invoicing.seller.name, 'Seller');
  assert.equal(saves[1].payload.invoicing.clients[0].id, 'client-1');
  assert.equal(saves[1].expectedRevision, preferences.revision + 1);
  assert.equal(page.requests.some(request => request.type === 'GET_LOCAL_PREFERENCES'), false);
});

test('saving invoicing also persists current client links for stored projects', async () => {
  const saved = {
    ...preferences,
    projects: [{ id: 'project-1', name: 'Work', substrings: ['work/'], destinationId: 'github:77', client: '' }],
    otherProjectName: 'General', otherProjectClient: '', revision: 4,
  };
  const page = harness({ reply: request => request.type === 'GET_LOCAL_PREFERENCES' ? saved : {} });
  page.context.savedPreferences = saved;
  vm.runInContext('localPreferences = savedPreferences; renderLocalPreferences(savedPreferences);', page.context);
  const projectClient = page.nodes.get('projects-list').querySelector('.project-client');
  projectClient.value = 'client-1';
  page.nodes.get('other-project-client').value = 'client-1';
  await page.submit('invoicing-form');
  const request = page.requests.find(request => request.type === 'SAVE_BILLING_SETTINGS');
  assert.equal(request.expectedRevision, saved.revision);
  assert.deepEqual(JSON.parse(JSON.stringify(request.projectLinks)), {
    projectClients: { 'project-1': 'client-1' },
    otherProjectClient: 'client-1',
  });
  assert.equal(request.payload.invoicing.clients[0].id, 'client-1');
});

test('a newly saved project is immediately included in the next invoicing link save', async () => {
  let latest = { ...preferences, projects: [], revision: 0 };
  const routedState = { ...connectedState, destinations: [{ id: 'github:77', repoId: 77, owner: 'acme', repo: 'time', branch: 'main' }], destinationRegistry: { defaultDestinationId: 'github:77' } };
  const page = harness({ reply(request) {
    if (request.type === 'UPDATE_DISPLAY_PREFERENCES') {
      latest = { ...latest, ...request.payload, revision: 1 };
      return { config: routedState.config, preferences: latest, revision: 1 };
    }
    if (request.type === 'SAVE_BILLING_SETTINGS') return billingSaveResult(request, latest);
    return {};
  } });
  page.context.latestPreferences = latest;
  page.context.routedState = routedState;
  vm.runInContext('state = routedState; localPreferences = latestPreferences; renderLocalPreferences(latestPreferences);', page.context);
  page.context.addProjectRow({ name: 'New project', substrings: ['new/'], destinationId: 'github:77', client: '' });
  await page.submit('display-form');
  const project = page.nodes.get('projects-list').querySelector('.project-row');
  project.querySelector('.project-client').value = 'client-1';
  await page.submit('invoicing-form');
  const request = page.requests.filter(request => request.type === 'SAVE_BILLING_SETTINGS').at(-1);
  assert.equal(request.expectedRevision, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(request.projectLinks)), {
    projectClients: { [project.dataset.projectId]: 'client-1' },
    otherProjectClient: '',
  });
});

test('changing the default destination remains selected and a following display save keeps it', async () => {
  const destinations = [77, 78].map(repoId => ({ id: `github:${repoId}`, repoId, owner: 'acme', repo: `time-${repoId}`, branch: 'main' }));
  const routedState = {
    ...connectedState, config: destinations[0], destinations,
    destinationRegistry: { defaultDestinationId: 'github:77', destinations: Object.fromEntries(destinations.map(destination => [destination.id, destination])) },
  };
  let revision = 0;
  const page = harness({ reply(request) {
    if (request.type !== 'UPDATE_DISPLAY_PREFERENCES') throw new Error(`Unexpected message: ${request.type}`);
    revision += 1;
    const config = destinations.find(destination => destination.id === request.payload.defaultDestinationId);
    return { config, generation: revision + 1, revision, preferences: { ...preferences, ...request.payload, defaultDestinationId: config.id, revision } };
  } });
  page.context.routedState = routedState;
  page.context.savedPreferences = { ...preferences, defaultDestinationId: 'github:77' };
  vm.runInContext('state = routedState; renderLocalPreferences(savedPreferences); renderState();', page.context);
  page.nodes.get('default-destination').value = 'github:78';
  await page.submit('display-form');
  assert.equal(page.nodes.get('default-destination').value, 'github:78');
  assert.equal(page.requests[0].expectedRevision, 0);
  assert.equal(page.requests[0].payload.defaultDestinationId, 'github:78');
  await page.submit('display-form');
  assert.equal(page.requests[1].expectedRevision, 1);
  assert.equal(page.requests[1].payload.defaultDestinationId, 'github:78');
  assert.equal(page.nodes.get('default-destination').value, 'github:78');
});

test('successful display save preserves an unsaved client row and other forms while refreshing project client names', async () => {
  const page = harness({ reply(request) {
    if (request.type === 'UPDATE_DISPLAY_PREFERENCES') return {
      config: { ...connectedState.config, recentDays: request.payload.recentDays },
      preferences: { ...preferences, ...request.payload, revision: 1 }, revision: 1,
    };
    throw new Error(`Unexpected message: ${request.type}`);
  } });
  page.render(connectedState); page.context.renderLocalPreferences(preferences);
  page.context.addClientRow();
  const client = page.nodes.get('clients-list').querySelectorAll('.client-row').at(-1);
  client.querySelector('.client-name').value = 'Typed client';
  client.querySelector('.client-email').value = 'typed@example.com';
  page.nodes.get('seller-name').value = 'Draft seller'; page.nodes.get('invoice-notes').value = 'Draft notes';
  const rate = page.nodes.get('rates-list').querySelector('.rate-row'); rate.querySelector('.rate-value').value = '150';
  page.context.addProjectRow({ name: 'Work', substrings: ['work/'], client: client.dataset.clientId });
  page.nodes.get('projects-list').querySelector('.project-name').value = 'Renamed';
  page.nodes.get('other-project-client').value = client.dataset.clientId;
  await page.submit('display-form');
  assert.equal(page.nodes.get('display-feedback').textContent, '');
  assert.equal(page.nodes.get('save-display').textContent, 'Saved');
  assert.equal(page.nodes.get('clients-list').querySelectorAll('.client-row').at(-1), client);
  assert.equal(client.querySelector('.client-name').value, 'Typed client');
  assert.equal(client.querySelector('.client-email').value, 'typed@example.com');
  assert.equal(page.nodes.get('seller-name').value, 'Draft seller'); assert.equal(page.nodes.get('invoice-notes').value, 'Draft notes');
  assert.equal(page.nodes.get('rates-list').querySelector('.rate-row'), rate); assert.equal(rate.querySelector('.rate-value').value, '150');
  assert.equal(page.nodes.get('projects-list').querySelector('.project-name').value, 'Renamed');
  client.querySelector('.client-name').value = 'Edited after save'; client.querySelector('.client-name').listeners.input();
  for (const select of [page.nodes.get('other-project-client'), page.nodes.get('projects-list').querySelector('.project-client')]) {
    assert.equal(select.value, client.dataset.clientId);
    assert.equal(select.children.find(option => option.value === client.dataset.clientId).textContent, 'Edited after save');
  }
});

for (const form of ['billing', 'invoicing']) test(`${form} successful save preserves unsaved display settings and the other form`, async () => {
  const page = harness({ reply(request) {
    if (request.type === 'SAVE_BILLING_SETTINGS') return billingSaveResult(request);
    throw new Error(`Unexpected message: ${request.type}`);
  } });
  page.context.renderLocalPreferences(preferences);
  page.context.addProjectRow({ name: 'Draft', substrings: ['draft/'], client: 'client-1' });
  const project = page.nodes.get('projects-list').querySelector('.project-row');
  page.nodes.get('other-project-name').value = 'Draft main'; page.nodes.get('other-project-client').value = 'client-1';
  page.nodes.get('recent-days').value = '14'; page.nodes.get('show-queue-diagnostics').checked = true;
  const client = page.nodes.get('clients-list').querySelector('.client-row'); client.querySelector('.client-name').value = 'Draft client';
  page.nodes.get('seller-name').value = 'Draft seller'; page.nodes.get('invoice-notes').value = 'Draft notes';
  const rate = page.nodes.get('rates-list').querySelector('.rate-row'); rate.querySelector('.rate-value').value = '150';
  await page.submit(`${form}-form`);
  assert.equal(page.nodes.get(`${form}-feedback`).textContent, '');
  assert.equal(page.nodes.get(`save-${form}`).textContent, 'Saved');
  assert.equal(page.nodes.get('projects-list').querySelector('.project-row'), project);
  assert.equal(project.querySelector('.project-name').value, 'Draft'); assert.equal(project.querySelector('.project-substrings').value, 'draft/');
  assert.equal(project.querySelector('.project-client').value, 'client-1');
  assert.equal(page.nodes.get('other-project-name').value, 'Draft main'); assert.equal(page.nodes.get('other-project-client').value, 'client-1');
  assert.equal(page.nodes.get('recent-days').value, '14'); assert.equal(page.nodes.get('show-queue-diagnostics').checked, true);
  if (form === 'billing') {
    assert.equal(page.nodes.get('clients-list').querySelector('.client-row'), client); assert.equal(client.querySelector('.client-name').value, 'Draft client');
    assert.equal(page.nodes.get('seller-name').value, 'Draft seller'); assert.equal(page.nodes.get('invoice-notes').value, 'Draft notes');
    assert.equal(page.nodes.get('rates-list').querySelector('.rate-value').value, '150');
  } else {
    assert.equal(page.nodes.get('rates-list').querySelector('.rate-row'), rate); assert.equal(rate.querySelector('.rate-value').value, '150');
    assert.equal(page.nodes.get('clients-list').querySelector('.client-name').value, 'Draft client');
    assert.equal(project.querySelector('.project-client').children.find(option => option.value === 'client-1').textContent, 'Draft client');
  }
});

for (const form of ['billing', 'invoicing']) test(`${form} handles a typed client without validating incomplete projects`, async () => {
  const page = harness({ reply(request) {
    if (request.type === 'SAVE_BILLING_SETTINGS') return billingSaveResult(request);
    throw new Error(`Unexpected message: ${request.type}`);
  } });
  page.context.renderLocalPreferences(preferences);
  page.context.addProjectRow({ name: 'Work', substrings: [] });
  page.context.addClientRow();
  const client = page.nodes.get('clients-list').querySelectorAll('.client-row').at(-1);
  client.querySelector('.client-name').value = 'Typed client';
  client.querySelector('.client-email').value = 'typed@example.com';
  await page.submit(`${form}-form`);
  assert.equal(page.nodes.get(`${form}-feedback`).textContent, '');
  assert.equal(page.nodes.get(`save-${form}`).textContent, 'Saved');
  const save = page.requests.find(request => request.type === 'SAVE_BILLING_SETTINGS');
  if (form === 'invoicing') {
    assert.equal(save.payload.invoicing.clients.at(-1).name, 'Typed client');
    assert.equal(save.payload.invoicing.clients.at(-1).email, 'typed@example.com');
    assert.equal(Object.hasOwn(save.payload.invoicing.clients.at(-1), 'projects'), false);
  } else {
    assert.deepEqual(Object.keys(save.payload), ['rates']);
    assert.equal(client.querySelector('.client-name').value, 'Typed client');
    assert.equal(client.querySelector('.client-email').value, 'typed@example.com');
  }
});

test('project and main client options refresh on add, name input and removal without losing missing ids', () => {
  const page = harness();
  page.context.renderLocalPreferences({ ...preferences, projects: [{ name: 'Web', substrings: ['web/'], client: 'missing' }], otherProjectClient: 'client-1' });
  const project = page.nodes.get('projects-list').querySelector('.project-client'), main = page.nodes.get('other-project-client');
  assert.equal(project.value, 'missing'); assert.equal(main.value, 'client-1');
  assert.equal(project.children.at(-1).textContent, 'missing (missing)');
  assert.equal(project.children[0].textContent, '— No client —');
  const first = page.nodes.get('clients-list').querySelector('.client-row');
  first.querySelector('.client-name').value = 'Renamed'; first.querySelector('.client-name').listeners.input();
  assert.equal(main.children.find(option => option.value === 'client-1').textContent, 'Renamed');
  page.context.addClientRow();
  assert.equal(main.children.find(option => option.value === 'client-2').textContent, 'client-2');
  first.querySelector('.remove-client').listeners.click();
  assert.equal(main.value, 'client-1');
  assert.equal(main.children.at(-1).textContent, 'client-1 (missing)');
  assert.equal(project.value, 'missing');
  assert.equal(page.context.projectsPayload()[0].client, 'missing');
});

for (const form of ['billing', 'invoicing']) test(`${form} save retains stored clients without metadata and their project links`, async () => {
  let stored = { ...preferences, projects: [{ name: 'Work', substrings: ['work/'], client: 'empty' }], otherProjectClient: 'empty', invoicing: { ...preferences.invoicing, clients: [{ id: 'empty' }, { id: 'unlinked' }] } };
  const page = harness({ reply(request) {
    if (request.type === 'SAVE_BILLING_SETTINGS') {
      stored = { ...stored, ...request.payload, revision: request.expectedRevision + 1 };
      return billingSaveResult(request, stored);
    }
    throw new Error(`Unexpected message: ${request.type}`);
  } });
  page.context.renderLocalPreferences(stored);
  await page.submit(`${form}-form`);
  assert.equal(page.nodes.get(`${form}-feedback`).textContent, '');
  assert.equal(page.nodes.get(`save-${form}`).textContent, 'Saved');
  assert.deepEqual(Array.from(stored.invoicing.clients, client => client.id), ['empty', 'unlinked']);
  assert.equal(stored.projects[0].client, stored.invoicing.clients[0].id);
  assert.equal(stored.otherProjectClient, stored.invoicing.clients[0].id);
  page.context.renderLocalPreferences(stored);
  assert.equal(page.nodes.get('projects-list').querySelector('.project-client').value, 'empty');
  assert.equal(page.nodes.get('other-project-client').value, 'empty');
  assert.equal(page.context.invoicingPayload().clients.length, 2);
});

for (const target of ['project', 'main']) test(`empty new client selected by ${target} survives serialization`, () => {
  const page = harness(); page.context.renderLocalPreferences({ ...preferences, invoicing: { ...preferences.invoicing, clients: [] } });
  page.context.addClientRow();
  const id = page.nodes.get('clients-list').querySelector('.client-row').dataset.clientId;
  if (target === 'project') page.context.addProjectRow({ name: 'Work', substrings: ['work/'], client: id });
  else page.nodes.get('other-project-client').value = id;
  assert.deepEqual(Array.from(page.context.invoicingPayload().clients, client => client.id), [id]);
});

test('new client edited and then cleared is no longer untouched', () => {
  const page = harness(); page.context.renderLocalPreferences({ ...preferences, invoicing: { ...preferences.invoicing, clients: [] } });
  page.context.addClientRow();
  const input = page.nodes.get('clients-list').querySelector('.client-email');
  input.value = 'client@example.com'; input.listeners.input?.();
  input.value = ''; input.listeners.input?.();
  assert.equal(page.context.invoicingPayload().clients.length, 1);
});

test('fresh preferences create no client and completely empty client cards are omitted', () => {
  const page = harness(); page.context.renderLocalPreferences({ ...preferences, invoicing: { ...preferences.invoicing, clients: [] } });
  assert.equal(page.nodes.get('clients-list').children.length, 0);
  page.context.addClientRow();
  assert.equal(page.context.invoicingPayload().clients.length, 0);
  page.nodes.get('clients-list').querySelector('.client-email').value = 'only@example.com';
  assert.equal(page.context.invoicingPayload().clients.length, 1);
  assert.equal(page.nodes.get('clients-list').querySelector('.client-projects'), null);
  assert.equal(page.nodes.get('clients-list').querySelector('.save-client').textContent, 'Save');
  assert.equal(page.nodes.get('clients-list').querySelector('.remove-client').textContent, '✕');
});

for (const form of ['billing', 'invoicing', 'display']) test(`${form} rejected save preserves every draft and never refreshes storage`, async () => {
  const page = harness({ reply: () => new Error('Save rejected') }); page.render(connectedState); page.context.renderLocalPreferences(preferences);
  page.context.addProjectRow({ name: 'Draft', substrings: ['draft/'], client: 'client-1' });
  page.nodes.get('clients-list').querySelector('.client-name').value = 'Unsaved';
  page.nodes.get('other-project-client').value = 'client-1';
  await page.submit(`${form}-form`);
  assert.equal(page.nodes.get('clients-list').querySelector('.client-name').value, 'Unsaved');
  assert.equal(page.nodes.get('projects-list').querySelector('.project-name').value, 'Draft');
  assert.equal(page.nodes.get('other-project-client').value, 'client-1');
  assert.equal(page.requests.length, 1);
  if (form === 'display') assert.equal(page.requests[0].payload.otherProjectClient, 'client-1');
});

for (const [field, value, message] of [
  ['invoice-tax-percent', '101', /tax percent/i],
  ['invoice-number-format', 'INV-{NOPE}-{NNNN}', /number format/i],
  ['invoice-next-number', '-1', /next number/i],
]) test(`invalid ${field} reports through form feedback without sending`, async () => {
  const page = harness(); page.context.renderLocalPreferences(preferences);
  page.nodes.get(field).value = value;
  await page.submit('invoicing-form');
  assert.match(page.nodes.get('invoicing-feedback').textContent, message);
  assert.equal(page.requests.length, 0);
  assert.equal(page.nodes.get('save-invoicing').disabled, false);
});

test('new client rows use the smallest unused stable client index', () => {
  const page = harness();
  page.context.renderLocalPreferences({ ...preferences, invoicing: { ...preferences.invoicing, clients: [
    preferences.invoicing.clients[0], { ...preferences.invoicing.clients[0], id: 'client-3' },
  ] } });
  page.context.addClientRow();
  const rows = page.nodes.get('clients-list').querySelectorAll('.client-row');
  assert.equal(rows.at(-1).dataset.clientId, 'client-2');
});

test('backup reminder appears once per page load and stays dismissed after an export', () => {
  const page = harness();
  const reminder = page.nodes.get('settings-export-reminder');
  page.context.renderLocalPreferences(preferences);
  assert.equal(reminder.hidden, true);
  page.context.renderLocalPreferences({ ...preferences, exportRecommended: true });
  assert.equal(reminder.hidden, false);
  page.context.renderLocalPreferences({ ...preferences, exportRecommended: true });
  assert.equal(reminder.hidden, false);
  page.context.renderLocalPreferences(preferences);
  assert.equal(reminder.hidden, true);
  page.context.renderLocalPreferences({ ...preferences, exportRecommended: true });
  assert.equal(reminder.hidden, true);
  const reopened = harness();
  reopened.context.renderLocalPreferences({ ...preferences, exportRecommended: true });
  assert.equal(reopened.nodes.get('settings-export-reminder').hidden, false);
});

test('destructive confirmations name their button scope and cancellation makes no request', async () => {
  const prompts = [];
  const page = harness({ confirm: text => { prompts.push(text); return false; } });
  for (const id of ['disconnect', 'clear-local']) {
    await page.nodes.get(id).listeners.click();
    const label = html.match(new RegExp(`id="${id}"[^>]*>([^<]+)</button>`))[1];
    assert.ok(prompts.at(-1).startsWith(`${label}?`), `${id}: ${prompts.at(-1)}`);
  }
  assert.equal(page.requests.length, 0);
  assert.match(html, /id="revoke"[^>]*href="https:\/\/github.com\/settings\/apps\/authorizations"[^>]*>Revoke GitHub sign-in/);
});

test('sole eligible repository is preselected but writes only after review and action confirmation', async () => {
  const repository = {
    installationId: 10, repoId: 20, fullName: 'octocat/clockoli-data', owner: 'octocat', ownerType: 'User', repo: 'clockoli-data',
    state: 'initialized_member', canAdd: true, canJoin: false, canInitialize: false, eligible: true,
  };
  const page = harness({ reply(request) {
    if (request.type === 'DISCOVER_REPOSITORIES') return { repositories: [repository], candidates: [repository] };
    if (request.type === 'SELECT_REPOSITORY') return { status: 'write_verified' };
    if (request.type === 'GET_ONBOARDING_STATE') return connectedState;
    if (request.type === 'RESUME_DEVICE_FLOW') return null;
    if (request.type === 'GET_LOCAL_PREFERENCES') return preferences;
    throw new Error(`Unexpected message: ${request.type}`);
  } });
  page.render({ ready: false, appConfigured: true });
  await page.context.discoverRepositories();
  assert.equal(page.requests.filter(request => request.type === 'SELECT_REPOSITORY').length, 0);
  assert.equal(vm.runInContext('!repositoryCanBeSelected(selectedRepository)', page.context), false);
  await page.context.reviewSelectedRepository();
  assert.equal(page.requests.filter(request => request.type === 'SELECT_REPOSITORY').length, 0);
  assert.equal(page.nodes.get('repository-confirmation').hidden, false);
  assert.equal(page.nodes.get('confirm-repository-action').textContent, 'Set up storage branch');
  await page.nodes.get('confirm-repository-action').listeners.click();
  assert.equal(page.requests.filter(request => request.type === 'SELECT_REPOSITORY').length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(page.requests.find(request => request.type === 'SELECT_REPOSITORY').payload)),
    { installationId: 10, repoId: 20, action: 'add' });
});

test('repository-first empty discovery asks for a concrete target before offering access', async () => {
  const page = harness({ reply(request) {
    if (request.type === 'DISCOVER_REPOSITORIES') return { repositories: [], candidates: [] };
    throw new Error(`Unexpected message: ${request.type}`);
  } });
  page.render({ ready: false, appConfigured: true, auth: { mode: 'github_app', githubLogin: 'octocat' } });
  await page.context.discoverRepositories();
  assert.equal(page.nodes.get('repository-step').hidden, false);
  assert.equal(page.nodes.get('current-step').textContent, '2');
  assert.equal(page.nodes.get('repository-access-panel').hidden, true);
  assert.equal(page.nodes.get('repository-choice-fieldset').hidden, true);
  assert.equal(page.nodes.get('setup-default-destination-label').hidden, true);
  assert.equal(page.nodes.get('default-destination-label').hidden, true);
  assert.match(page.nodes.get('message').textContent, /Enter a repository URL or owner\/name/);
  assert.equal(page.requests.filter(request => request.type === 'DISCOVER_REPOSITORIES').length, 1);
  assert.equal(page.requests.filter(request => request.type === 'SELECT_REPOSITORY').length, 0);
});

test('connected sharing instructions use the owner-neutral path for user and organization repositories', () => {
  const page = harness();
  for (const destination of [
    { owner: 'alice', repo: 'clockoli-data', ownerType: 'User' },
    { owner: 'acme', repo: 'team-time', ownerType: 'Organization' },
  ]) {
    page.context.testDestination = destination;
    const text = vm.runInContext('teammateInstructions(testDestination)', page.context);
    assert.match(text, /Install Clockoli and sign in with GitHub\./);
    assert.match(text, /Connect .* in Time repositories/);
    assert.match(text, new RegExp(`grant the Clockoli GitHub App access to ${destination.owner}\/${destination.repo}`));
    assert.doesNotMatch(text, /Connect GitHub|Join an organization repository/);
  }
});

test('teammate picker selects a searched GitHub user and requires confirmation before inviting', async () => {
  const destination = { id: 'github:20', owner: 'acme', repo: 'time-data', installationId: 10 };
  let invited = false;
  const page = harness({ confirm: () => true, collaboratorReplies: true, reply: request => {
    if (request.type === 'SEARCH_INVITEE_USERS') return { users: [{ id: 42, login: 'Bob', name: 'Bob Example', avatarUrl: 'https://avatars.githubusercontent.com/u/42?v=4' }] };
    if (request.type === 'LOAD_REPOSITORY_COLLABORATORS') return { users: [], hasMore: false,
      pendingUsers: invited ? [{ id: 42, login: 'Bob', avatarUrl: 'https://avatars.githubusercontent.com/u/42?v=4' }] : [], pendingHasMore: false };
    invited = true; return { status: 'invited', login: 'Bob' };
  } });
  page.render({ ...connectedState, destinations: [destination] });
  const picker = page.nodes.get('time-repository-list').querySelector('.teammate-picker');
  assert.ok(picker);
  const input = picker.querySelector('.teammate-search'), invite = picker.querySelector('.invite-teammate');
  assert.equal(invite.disabled, true);
  input.value = 'Bo'; input.listeners.input();
  await page.timers.find(timer => timer.delay === 250).callback();
  const choice = picker.querySelector('.teammate-choice');
  assert.equal(choice.querySelector('.teammate-login').textContent, '@Bob');
  assert.equal(choice.querySelector('.teammate-name').textContent, 'Bob Example');
  assert.equal(choice.querySelector('.teammate-avatar').src, 'https://avatars.githubusercontent.com/u/42?v=4');
  await choice.listeners.click();
  assert.equal(invite.disabled, false);
  assert.equal(input.value, 'Bob');
  assert.equal(picker.querySelector('.teammate-choice'), null);
  assert.equal(picker.querySelector('.teammate-selected'), null);
  assert.match(picker.querySelector('.teammate-feedback').textContent, /Selected @Bob.*Bob Example/);
  await invite.listeners.click();
  assert.deepEqual(JSON.parse(JSON.stringify(page.requests.find(request => request.type === 'INVITE_REPOSITORY_USER').payload)),
    { destinationId: 'github:20', login: 'Bob', userId: 42 });
  assert.match(picker.querySelector('.teammate-feedback').textContent, /invitation sent/i);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(page.nodes.get('time-repository-list').querySelector('.repository-invitation').dataset.login, '@Bob · pending invitation');
  assert.equal(page.nodes.get('time-repository-list').querySelector('.repository-collaborators').textContent, '');
});

test('teammate picker does not invite when confirmation is cancelled', async () => {
  const page = harness({ confirm: () => false, reply: request => request.type === 'SEARCH_INVITEE_USERS'
    ? { users: [{ id: 42, login: 'Bob' }] } : {} });
  page.render({ ...connectedState, destinations: [{ id: 'github:20', owner: 'acme', repo: 'time-data', installationId: 10 }] });
  const picker = page.nodes.get('time-repository-list').querySelector('.teammate-picker');
  const input = picker.querySelector('.teammate-search');
  input.value = 'Bo'; input.listeners.input();
  await page.timers.find(timer => timer.delay === 250).callback();
  await picker.querySelector('.teammate-choice').listeners.click();
  await picker.querySelector('.invite-teammate').listeners.click();
  assert.equal(page.requests.some(request => request.type === 'INVITE_REPOSITORY_USER'), false);
});

test('an earlier teammate search cannot reopen suggestions after a user is selected', async () => {
  let finishEarlierSearch;
  const page = harness({ reply: request => request.type === 'SEARCH_INVITEE_USERS'
    ? request.payload.query === 'Al'
      ? new Promise(resolve => { finishEarlierSearch = resolve; })
      : { users: [{ id: 42, login: 'Bob' }] }
    : {} });
  page.render({ ...connectedState, destinations: [{ id: 'github:20', owner: 'acme', repo: 'time-data', installationId: 10 }] });
  const picker = page.nodes.get('time-repository-list').querySelector('.teammate-picker');
  const input = picker.querySelector('.teammate-search');
  input.value = 'Al'; input.listeners.input();
  const earlierSearch = page.timers.find(timer => timer.delay === 250).callback();
  input.value = 'Bo'; input.listeners.input();
  await page.timers.filter(timer => timer.delay === 250).at(-1).callback();
  await picker.querySelector('.teammate-choice').listeners.click();
  finishEarlierSearch({ users: [{ id: 99, login: 'Alice' }] });
  await earlierSearch;
  assert.equal(picker.querySelector('.teammate-choice'), null);
  assert.equal(input.value, 'Bob');
  assert.equal(picker.querySelector('.invite-teammate').disabled, false);
});

test('repository confirmation sends the one action allowed by the inspected repository state', async () => {
  const scenarios = [
    ['existing', 'User', 'initialized_member', { canAdd: true, canJoin: false, canInitialize: false }, 'add', 'Set up storage branch'],
    ['existing', 'Organization', 'initialized_joinable', { canAdd: false, canJoin: true, canInitialize: false }, 'join', 'Join repository'],
    ['new', 'User', 'uninitialized', { canAdd: false, canJoin: false, canInitialize: true }, 'initialize', 'Initialize repository'],
    ['new', 'Organization', 'empty', { canAdd: false, canJoin: false, canInitialize: true }, 'initialize', 'Initialize repository'],
  ];
  for (const [mode, ownerType, state, capabilities, expectedAction, expectedLabel] of scenarios) {
    const repository = {
      installationId: 10, repoId: 20, fullName: 'octocat/clockoli-data', owner: 'octocat', ownerType, repo: 'clockoli-data',
      state, ...capabilities, eligible: true,
    };
    const page = harness({ reply(request) {
      if (request.type === 'DISCOVER_REPOSITORIES') return { repositories: [repository], candidates: [repository] };
      if (request.type === 'SELECT_REPOSITORY') return { status: 'write_verified' };
      if (request.type === 'GET_ONBOARDING_STATE') return connectedState;
      if (request.type === 'RESUME_DEVICE_FLOW') return null;
      if (request.type === 'GET_LOCAL_PREFERENCES') return preferences;
      throw new Error(`Unexpected message: ${request.type}`);
    } });
    page.render({ ready: false, appConfigured: true });
    page.context.testMode = mode;
    await page.context.discoverRepositories();
    await page.context.reviewSelectedRepository();
    assert.equal(page.requests.filter(request => request.type === 'SELECT_REPOSITORY').length, 0);
    assert.equal(page.nodes.get('repository-confirmation').hidden, false);
    assert.equal(page.nodes.get('confirm-repository-action').textContent, expectedLabel);
    await page.nodes.get('confirm-repository-action').listeners.click();
    assert.equal(page.requests.find(request => request.type === 'SELECT_REPOSITORY').payload.action, expectedAction);
  }
});

test('repository confirmation fails closed when state and capability flags disagree', async () => {
  const repository = {
    installationId: 10, repoId: 20, fullName: 'octocat/clockoli-data', owner: 'octocat', ownerType: 'User', repo: 'clockoli-data',
    state: 'initialized_member', canAdd: false, canJoin: true, canInitialize: false, eligible: true,
  };
  const page = harness({ reply(request) {
    if (request.type === 'DISCOVER_REPOSITORIES') return { repositories: [repository], candidates: [repository] };
    throw new Error(`Unexpected message: ${request.type}`);
  } });
  page.render({ ready: false, appConfigured: true });
  await page.context.discoverRepositories();
  assert.equal(vm.runInContext('!repositoryCanBeSelected(selectedRepository)', page.context), true);
  await page.context.reviewSelectedRepository();
  await page.nodes.get('confirm-repository-action').listeners.click();
  assert.equal(page.requests.filter(request => request.type === 'SELECT_REPOSITORY').length, 0);
});

test('adding a client cannot reuse an id still assigned to a project or the main bucket', () => {
  const page = harness();
  page.context.renderLocalPreferences({ ...preferences, invoicing: { ...preferences.invoicing, clients: [] }, projects: [{ name: 'Web', substrings: ['web/'], client: 'client-1' }], otherProjectClient: 'client-2' });
  page.context.addClientRow();
  assert.equal(page.nodes.get('clients-list').querySelector('.client-row').dataset.clientId, 'client-3');
  assert.equal(page.nodes.get('projects-list').querySelector('.project-client').children.at(-1).textContent, 'client-1 (missing)');
  assert.equal(page.nodes.get('other-project-client').children.at(-1).textContent, 'client-2 (missing)');
});

test('payment terms days load and save one numeric setting with explanatory help', async () => {
  const page = harness({ reply: request => request.type === 'GET_LOCAL_PREFERENCES' ? preferences : {} });
  await page.context.refreshLocalPreferences();
  assert.equal(page.nodes.get('invoice-payment-terms').value, '30');
  assert.match(html, /Payment terms \(days\)<input id="invoice-payment-terms" type="number" min="0" max="365"/);
  assert.match(html, /Due date is the issue date plus this many days\./);
  page.nodes.get('invoice-payment-terms').value = '45';
  await page.submit('invoicing-form');
  const save = page.requests.find(request => request.type === 'SAVE_BILLING_SETTINGS');
  assert.equal(save.payload.invoicing.paymentTermsDays, 45); assert.equal(Object.hasOwn(save.payload.invoicing, 'paymentTerms'), false);
});

test('connected repository rows show collaborators by destination and ignore stale responses', async () => {
  let resolveFirst;
  const destination = { id: 'github:20', owner: 'acme', repo: 'time-data', installationId: 10 };
  const second = { id: 'github:21', owner: 'acme', repo: 'other', installationId: 10 };
  const page = harness({ collaboratorReplies: true, reply: request => {
    if (request.type !== 'LOAD_REPOSITORY_COLLABORATORS') return {};
    if (request.destinationId === destination.id) return new Promise(resolve => { resolveFirst = resolve; });
    return { users: [{ id: 7, login: 'New', avatarUrl: null }], hasMore: false };
  } });
  page.render({ ...connectedState, destinations: [destination] });
  assert.deepEqual(page.requests.filter(request => request.type === 'LOAD_REPOSITORY_COLLABORATORS').map(request => request.destinationId), ['github:20']);
  page.render({ ...connectedState, destinations: [second] });
  await new Promise(resolve => setImmediate(resolve));
  const row = page.nodes.get('time-repository-list').children[0];
  assert.equal(row.querySelector('.repository-collaborator').textContent, 'N');
  resolveFirst({ users: [{ id: 8, login: 'Stale', avatarUrl: null }], hasMore: false });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(row.querySelector('.repository-collaborators').children.length, 1);
  assert.equal(row.querySelector('.repository-collaborator').dataset.login, '@New');
});

test('each repository disclosure has a decorative chevron that changes direction when open', async () => {
  const page = harness();
  page.render({ ...connectedState, destinations: [
    { id: 'github:20', owner: 'acme', repo: 'time-data', installationId: 10 },
    { id: 'github:21', owner: 'acme', repo: 'other', installationId: 10 },
  ] });
  const rows = page.nodes.get('time-repository-list').children;
  for (const row of rows) {
    const icon = row.querySelector('.repository-heading-title').children[0];
    assert.equal(icon.tagName, 'svg');
    assert.equal(icon.attributes.class, 'repository-disclosure-icon');
    assert.equal(icon.attributes['aria-hidden'], 'true');
    assert.equal(icon.children[0].attributes.d, 'M3 6l5 5 5-5');
  }
  const css = await readFile(new URL('../src/options/options.css', import.meta.url), 'utf8');
  assert.match(css, /\.time-repository\[open\] \.repository-disclosure-icon\{[^}]*rotate\(180deg\)/);
});

test('reloading repository access indicators replaces old avatars and pending status on the same card', async () => {
  const destination = { id: 'github:20', owner: 'acme', repo: 'time-data', installationId: 10 };
  const replies = [
    { users: [{ id: 7, login: 'Member', avatarUrl: null }], hasMore: false,
      pendingUsers: [{ id: 8, login: 'Invitee', avatarUrl: null }], pendingHasMore: false },
    { users: [{ id: 7, login: 'Member', avatarUrl: null }], hasMore: false, pendingUnavailable: true },
  ];
  const page = harness({ collaboratorReplies: true, reply: request => request.type === 'LOAD_REPOSITORY_COLLABORATORS' ? replies.shift() : {} });
  page.render({ ...connectedState, destinations: [destination] });
  await new Promise(resolve => setImmediate(resolve));
  const root = page.nodes.get('time-repository-list'), row = root.children[0];
  assert.equal(row.querySelectorAll('.repository-invitation').length, 1);
  await page.context.loadRepositoryCollaborators(row, destination, root);
  const display = row.querySelector('.repository-collaborators');
  assert.equal(display.querySelectorAll('.repository-collaborator').length, 1);
  assert.equal(display.querySelectorAll('.repository-invitation').length, 0);
  assert.equal(display.attributes['aria-label'], 'Repository collaborators: @Member');
});

test('repository avatar refresh removes an old empty state and ignores a late older response', async () => {
  const destination = { id: 'github:20', owner: 'acme', repo: 'time-data', installationId: 10 };
  let resolveOld;
  const replies = [
    { users: [], hasMore: false, pendingUsers: [], pendingHasMore: false },
    new Promise(resolve => { resolveOld = resolve; }),
    { users: [{ id: 7, login: 'New', avatarUrl: null }], hasMore: false },
  ];
  const page = harness({ collaboratorReplies: true, reply: request => request.type === 'LOAD_REPOSITORY_COLLABORATORS' ? replies.shift() : {} });
  page.render({ ...connectedState, destinations: [destination] });
  await new Promise(resolve => setImmediate(resolve));
  const root = page.nodes.get('time-repository-list'), row = root.children[0];
  const display = row.querySelector('.repository-collaborators');
  assert.equal(display.textContent, 'No collaborators or pending invitations');
  const oldLoad = page.context.loadRepositoryCollaborators(row, destination, root);
  await page.context.loadRepositoryCollaborators(row, destination, root);
  assert.equal(display.textContent, '');
  assert.equal(display.querySelectorAll('.repository-collaborator').length, 1);
  resolveOld({ users: [{ id: 8, login: 'Old', avatarUrl: null }], hasMore: false });
  await oldLoad;
  assert.equal(display.querySelector('.repository-collaborator').dataset.login, '@New');
});

test('repository add circle opens only its own teammate form and focuses GitHub search', () => {
  const destinations = [
    { id: 'github:20', owner: 'acme', repo: 'time-data', installationId: 10 },
    { id: 'github:21', owner: 'acme', repo: 'other', installationId: 10 },
  ];
  const page = harness(); page.render({ ...connectedState, destinations });
  const rows = page.nodes.get('time-repository-list').children;
  const first = rows.find(row => row.dataset.destinationId === 'github:20');
  const second = rows.find(row => row.dataset.destinationId === 'github:21');
  const add = second.querySelector('.repository-add-teammate');
  assert.equal(add.tagName, 'button');
  assert.match(add.attributes['aria-label'], /add.*acme\/other/i);
  let prevented = false, stopped = false;
  add.listeners.click({ preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } });
  assert.equal(prevented, true); assert.equal(stopped, true);
  assert.equal(first.open, false);
  assert.equal(second.open, true);
  assert.equal(second.querySelector('.teammate-instructions').open, true);
  assert.equal(second.querySelector('.teammate-search').focused, true);
  assert.equal(page.requests.some(request => request.type === 'INVITE_REPOSITORY_USER'), false);
  const pat = harness(); pat.render({ ...connectedState, auth: { mode: 'pat' }, destinations });
  assert.equal(pat.nodes.get('time-repository-list').querySelector('.repository-add-teammate'), null);
});

test('managing repository access requires confirmation and removes only the chosen collaborator', async () => {
  const destinations = [
    { id: 'github:20', owner: 'acme', repo: 'time-data', installationId: 10 },
    { id: 'github:21', owner: 'acme', repo: 'other', installationId: 10 },
  ];
  let confirmed = false, removed = false;
  const page = harness({ collaboratorReplies: true, confirm: () => confirmed, reply: request => {
    if (request.type === 'LOAD_REPOSITORY_COLLABORATORS') return {
      users: request.destinationId === 'github:20' && !removed ? [{ id: 42, login: 'Bob', avatarUrl: null }] : [], hasMore: false,
    };
    if (request.type === 'REMOVE_REPOSITORY_USER') { removed = true; return { status: 'removed', login: 'Bob' }; }
    return {};
  } });
  page.render({ ...connectedState, destinations });
  await new Promise(resolve => setImmediate(resolve));
  const rows = page.nodes.get('time-repository-list').children;
  const first = rows.find(row => row.dataset.destinationId === 'github:20');
  const second = rows.find(row => row.dataset.destinationId === 'github:21');
  const avatar = first.querySelector('.repository-collaborator');
  const menu = first.querySelector('.repository-avatar-actions');
  assert.equal(avatar.tagName, 'button');
  assert.equal(avatar.attributes['aria-expanded'], 'false');
  assert.equal(menu.hidden, true);
  assert.equal(first.querySelector('.repository-manage-teammates'), null);
  await avatar.listeners.click({ preventDefault() {}, stopPropagation() {} });
  assert.equal(first.open, false);
  assert.equal(menu.hidden, false);
  assert.equal(avatar.attributes['aria-expanded'], 'true');
  const button = menu.querySelector('.remove-repository-user');
  assert.match(button.textContent, /Remove @Bob/);
  await button.listeners.click({ preventDefault() {}, stopPropagation() {} });
  assert.equal(page.requests.some(request => request.type === 'REMOVE_REPOSITORY_USER'), false);
  confirmed = true;
  await button.listeners.click({ preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(JSON.parse(JSON.stringify(page.requests.find(request => request.type === 'REMOVE_REPOSITORY_USER').payload)),
    { destinationId: 'github:20', login: 'Bob', userId: 42, kind: 'collaborator' });
  assert.match(first.querySelector('.repository-manage-feedback').textContent, /removed/i);
  assert.equal(first.querySelector('.repository-manage-feedback').focused, true);
  assert.equal(first.querySelector('.remove-repository-user'), null);
  assert.equal(second.querySelector('.remove-repository-user'), null);
});

test('pending account invitation can be cancelled but a failed removal retains its action', async () => {
  let fail = true;
  const page = harness({ collaboratorReplies: true, confirm: () => true, reply: request => {
    if (request.type === 'LOAD_REPOSITORY_COLLABORATORS') return { users: [], hasMore: false,
      pendingUsers: fail ? [{ id: 43, login: 'Alice', avatarUrl: null }] : [], pendingHasMore: false };
    if (request.type === 'REMOVE_REPOSITORY_USER') return fail ? Promise.reject(new Error('GitHub declined')) : { status: 'cancelled', login: 'Alice' };
    return {};
  } });
  page.render({ ...connectedState, destinations: [{ id: 'github:20', owner: 'acme', repo: 'time-data', installationId: 10 }] });
  await new Promise(resolve => setImmediate(resolve));
  const row = page.nodes.get('time-repository-list').children[0];
  const avatar = row.querySelector('.repository-invitation');
  const menu = row.querySelector('.repository-avatar-actions');
  await avatar.listeners.click({ preventDefault() {}, stopPropagation() {} });
  const cancel = menu.querySelector('.remove-repository-user');
  assert.match(cancel.textContent, /Cancel invitation for @Alice/);
  await cancel.listeners.click({ preventDefault() {}, stopPropagation() {} });
  assert.match(row.querySelector('.repository-manage-feedback').textContent, /GitHub declined/);
  assert.equal(cancel.disabled, false);
  assert.ok(menu.querySelector('.remove-repository-user'));
  fail = false;
  await cancel.listeners.click({ preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(JSON.parse(JSON.stringify(page.requests.filter(request => request.type === 'REMOVE_REPOSITORY_USER').at(-1).payload)),
    { destinationId: 'github:20', login: 'Alice', userId: 43, kind: 'pending' });
  assert.match(row.querySelector('.repository-manage-feedback').textContent, /cancelled/i);
});

test('avatar menu closes on Escape and does not open the repository or send a mutation', async () => {
  const page = harness({ collaboratorReplies: true, reply: () => ({ users: [
    { id: 7, login: 'Member' }, { id: 8, login: 'Teammate' },
  ], hasMore: false }) });
  page.render({ ...connectedState, destinations: [{ id: 'github:20', owner: 'acme', repo: 'time-data', installationId: 10 }] });
  await new Promise(resolve => setImmediate(resolve));
  const row = page.nodes.get('time-repository-list').children[0];
  const [first, second] = row.querySelectorAll('.repository-collaborator');
  await first.listeners.click({ preventDefault() {}, stopPropagation() {} });
  assert.equal(row.querySelectorAll('.repository-avatar-actions').filter(menu => !menu.hidden).length, 1);
  await second.listeners.click({ preventDefault() {}, stopPropagation() {} });
  assert.equal(first.attributes['aria-expanded'], 'false');
  assert.equal(second.attributes['aria-expanded'], 'true');
  second.listeners.keydown({ key: 'Escape', preventDefault() {}, stopPropagation() {} });
  assert.equal(second.attributes['aria-expanded'], 'false');
  assert.equal(second.focused, true);
  assert.equal(row.open, false);
  assert.equal(page.requests.some(request => request.type === 'REMOVE_REPOSITORY_USER'), false);
});

test('signed-in account avatar is not offered a self-removal action', async () => {
  const page = harness({ collaboratorReplies: true, reply: () => ({ users: [
    { id: 7, login: 'Octocat' }, { id: 8, login: 'Teammate' },
  ], hasMore: false }) });
  page.render({ ...connectedState, destinations: [{ id: 'github:20', owner: 'acme', repo: 'time-data', installationId: 10 }] });
  await new Promise(resolve => setImmediate(resolve));
  const avatars = page.nodes.get('time-repository-list').querySelectorAll('.repository-collaborator');
  assert.equal(avatars[0].tagName, 'span');
  assert.equal(avatars[0].attributes.role, 'img');
  assert.equal(avatars[1].tagName, 'button');
  assert.equal(page.nodes.get('time-repository-list').querySelectorAll('.remove-repository-user').length, 1);
});

test('repository avatar hover uses the GitHub login and overflow does not impersonate add', async () => {
  const page = harness({ collaboratorReplies: true, reply: () => ({
    users: [{ id: 7, login: 'New', avatarUrl: null }], hasMore: true,
  }) });
  page.render({ ...connectedState, destinations: [{ id: 'github:20', owner: 'acme', repo: 'time-data', installationId: 10 }] });
  await new Promise(resolve => setImmediate(resolve));
  const row = page.nodes.get('time-repository-list').children[0];
  const avatar = row.querySelector('.repository-collaborator');
  assert.equal(avatar.dataset.login, '@New');
  assert.equal(row.querySelector('.repository-collaborator-more').textContent, '…');
  assert.equal(row.querySelectorAll('.repository-add-teammate').length, 1);
  const css = await readFile(new URL('../src/options/options.css', import.meta.url), 'utf8');
  assert.match(css, /\.repository-collaborator\[data-login\]:hover::after\{[^}]*content:attr\(data-login\)/);
});

test('pending GitHub invitations show distinct noninteractive avatars and accessible status', async () => {
  const page = harness({ collaboratorReplies: true, reply: () => ({
    users: [{ id: 7, login: 'Member', avatarUrl: null }], hasMore: false,
    pendingUsers: [{ id: 8, login: 'Invitee', avatarUrl: 'https://avatars.githubusercontent.com/u/8?v=4' }], pendingHasMore: true,
  }) });
  page.render({ ...connectedState, destinations: [{ id: 'github:20', owner: 'acme', repo: 'time-data', installationId: 10 }] });
  await new Promise(resolve => setImmediate(resolve));
  const row = page.nodes.get('time-repository-list').children[0];
  const pending = row.querySelector('.repository-invitation');
  assert.equal(pending.dataset.login, '@Invitee · pending invitation');
  assert.match(pending.attributes['aria-label'], /@Invitee.*pending invitation/i);
  assert.equal(pending.children.find(child => child.tagName === 'img').src, 'https://avatars.githubusercontent.com/u/8?v=4');
  assert.match(row.querySelector('.repository-collaborators').attributes['aria-label'], /pending invitation/i);
  assert.match(row.querySelector('.repository-invitation-more').title, /pending invitation/i);
  assert.equal(row.querySelectorAll('.repository-add-teammate').length, 1);
  const css = await readFile(new URL('../src/options/options.css', import.meta.url), 'utf8');
  assert.match(css, /\.repository-invitation\{[^}]*border-style:dashed/);
});

test('unavailable pending invitations stay silent without erasing verified collaborators', async () => {
  const page = harness({ collaboratorReplies: true, reply: () => ({
    users: [{ id: 7, login: 'Member', avatarUrl: null }], hasMore: false, pendingUnavailable: true,
  }) });
  page.render({ ...connectedState, destinations: [{ id: 'github:20', owner: 'acme', repo: 'time-data', installationId: 10 }] });
  await new Promise(resolve => setImmediate(resolve));
  const row = page.nodes.get('time-repository-list').children[0];
  assert.equal(row.querySelector('.repository-collaborator').dataset.login, '@Member');
  assert.equal(row.querySelector('.repository-collaborators').attributes['aria-label'], 'Repository collaborators: @Member');
  assert.equal(row.querySelector('.repository-invitations-unavailable'), null);
  assert.equal(row.querySelector('.repository-collaborators').textContent.includes('Pending unavailable'), false);
});

test('failed pending lookup with no collaborators does not claim there are no invitations', async () => {
  const page = harness({ collaboratorReplies: true, reply: () => ({
    users: [], hasMore: false, pendingUnavailable: true,
  }) });
  page.render({ ...connectedState, destinations: [{ id: 'github:20', owner: 'acme', repo: 'time-data', installationId: 10 }] });
  await new Promise(resolve => setImmediate(resolve));
  const row = page.nodes.get('time-repository-list').children[0];
  const display = row.querySelector('.repository-collaborators');
  assert.equal(display.textContent, 'No collaborators');
  assert.doesNotMatch(display.attributes['aria-label'], /pending|unavailable/i);
  assert.equal(row.querySelector('.repository-invitation'), null);
  assert.equal(row.querySelectorAll('.repository-add-teammate').length, 1);
});

test('invite section leads with search and keeps teammate setup steps behind a disclosure', () => {
  const page = harness();
  page.render({ ...connectedState, destinations: [{ id: 'github:20', owner: 'acme', repo: 'time-data', installationId: 10 }] });
  const row = page.nodes.get('time-repository-list').children[0];
  const invite = row.querySelector('.teammate-instructions');
  assert.equal(invite.children[0].textContent, 'Invite teammates');
  assert.match(invite.querySelector('.teammate-intro').textContent, /acme\/time-data/);
  const picker = invite.querySelector('.teammate-picker');
  const setup = invite.querySelector('.teammate-setup');
  assert.ok(invite.children.indexOf(picker) < invite.children.indexOf(setup));
  assert.equal(setup.open, false);
  assert.equal(setup.querySelector('.teammate-steps').tagName, 'ol');
  assert.equal(invite.children.some(child => child.tagName === 'pre'), false);
  assert.equal(picker.querySelector('.teammate-search').placeholder, 'Search by GitHub username');
  assert.match(picker.querySelector('.help').textContent, /repository admin/i);
});

test('add teammate control has a hover title and a compact icon next to avatars', async () => {
  const page = harness({ collaboratorReplies: true, reply: () => ({ users: [{ id: 7, login: 'New' }], hasMore: false }) });
  page.render({ ...connectedState, destinations: [{ id: 'github:20', owner: 'acme', repo: 'time-data', installationId: 10 }] });
  await new Promise(resolve => setImmediate(resolve));
  const people = page.nodes.get('time-repository-list').querySelector('.repository-people');
  const add = people.querySelector('.repository-add-teammate');
  assert.equal(add.title, 'Add teammate');
  assert.equal(add.children[0].tagName, 'svg');
  assert.equal(people.children[0].className, 'repository-collaborators');
  assert.equal(people.children[1], add);
  const css = await readFile(new URL('../src/options/options.css', import.meta.url), 'utf8');
  assert.match(css, /\.repository-people\{[^}]*gap:3px/);
  assert.match(css, /\.repository-add-teammate\{[^}]*width:24px;height:24px/);
});

test('shareable teammate steps copy the rewritten guide and expose a readable fallback', async () => {
  const page = harness();
  page.render({ ...connectedState, destinations: [{ id: 'github:20', owner: 'acme', repo: 'time-data', installationId: 10 }] });
  const setup = page.nodes.get('time-repository-list').querySelector('.teammate-setup');
  const copy = setup.children.find(child => child.textContent === 'Copy instructions');
  const feedback = setup.querySelector('.form-feedback');
  let copied = '';
  page.context.navigator = { clipboard: { async writeText(text) { copied = text; } } };
  await copy.listeners.click();
  assert.match(copied, /Join acme\/time-data in Clockoli/);
  assert.match(copied, /Do not create clockoli\/users/);
  assert.match(feedback.textContent, /copied/);
  page.context.navigator.clipboard.writeText = async () => { throw new Error('Clipboard denied'); };
  await copy.listeners.click();
  assert.equal(setup.open, true);
  assert.match(feedback.textContent, /Select the steps above/);
});
