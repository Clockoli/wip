import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { onboardingStep, parseRepositoryTarget, selectOnlyEligibleRepository, settleBeforeDeadline } from '../src/options/onboarding-flow.js';
import { invoicingSettings, normalizeInvoicingSettings, normalizeProjects, parseRateFields } from '../src/domain/local-settings.js';
import { taskPeriodRange } from '../src/domain/tasks.js';


const html = await readFile(new URL('../src/options/options.html', import.meta.url), 'utf8');
const source = await readFile(new URL('../src/options/options.js', import.meta.url), 'utf8');
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
    replaceChildren(...children) { this.children = []; this.append(...children); },
    setAttribute(name, value) { this.attributes[name] = value; }, removeAttribute(name) { delete this.attributes[name]; }, focus() { this.focused = true; }, scrollIntoView() { this.scrolled = true; },
    showModal() { this.open = true; }, close() { this.open = false; this.listeners.close?.(); },
    querySelectorAll(selector) { const className = selector.startsWith('.') ? selector.slice(1) : ''; const matches = child => className && child.className.split(' ').includes(className); return this.children.flatMap(child => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]); },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); },

    addEventListener(type, handler) { this.listeners[type] = handler; },
  };
  return node;
}

function harness({ reply = () => ({}), confirm = () => false, savedChoices = new Map() } = {}) {
  const nodes = new Map([...html.matchAll(/id="([^"]+)"/g)].map(([, id]) => [id, element()]));
  for (const [, id, label] of html.matchAll(/<button\b[^>]*id="([^"]+)"[^>]*>([^<]*)<\/button>/g)) nodes.get(id).textContent = label;
  const requests = [], timers = [];
  const context = vm.createContext({
    document: { getElementById: id => nodes.get(id), createElement: tag => element(tag), addEventListener() {} },
    window: { addEventListener() {}, confirm }, URL,
    setTimeout: (callback, delay) => { const timer = { callback, delay, cleared: false }; timers.push(timer); return timer; }, clearTimeout(timer) { if (timer) timer.cleared = true; }, queueMicrotask: callback => callback(),
    onboardingStep, parseRepositoryTarget, selectOnlyEligibleRepository, settleBeforeDeadline, normalizeProjects, parseRateFields, normalizeInvoicingSettings, invoicingSettings, taskPeriodRange,
    ChromeStore: class { async getOnboardingRepositoryChoice(account) { return savedChoices.get(account) || ''; } async saveOnboardingRepositoryChoice(account, name) { savedChoices.set(account, name); } },

    ClockoliRecovery: { actionFor: () => null },
    chrome: { runtime: { sendMessage(request, callback) {
      requests.push(request);
      const result = reply(request);
      const respond = value => callback(value instanceof Error ? { ok: false, error: { message: value.message } } : { ok: true, data: value });
      if (result?.then) result.then(respond, error => callback({ ok: false, error: { message: error.message } }));
      else respond(result);

    } } },
  });
  vm.runInContext(source.replace(/^import .*;\n/gm, '').slice(0, source.replace(/^import .*;\n/gm, '').indexOf('refreshState().then(refreshLocalPreferences)')), context);
  return {
    nodes, requests, timers, context,
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

test('repository search is shown only for five or more discovered repositories', () => {
  const page = harness();
  const repositories = count => Array.from({ length: count }, (_, index) => ({
    installationId: 10, repoId: index + 1, fullName: `acme/time-${index + 1}`,
    state: 'initialized_member', canAdd: true, eligible: true,
  }));
  page.context.renderRepositories({ repositories: repositories(4), installations: [] });
  assert.equal(page.nodes.get('repository-choice-fieldset').hidden, false);
  assert.equal(page.nodes.get('repository-search-label').hidden, true);
  page.context.renderRepositories({ repositories: repositories(5), installations: [] });
  assert.equal(page.nodes.get('repository-search-label').hidden, false);
  page.nodes.get('repository-search').value = 'time-5';
  page.context.renderRepositoryList();
  assert.equal(page.nodes.get('repository-list').children.length, 1);
  page.context.renderRepositories({ repositories: repositories(4), installations: [] });
  assert.equal(page.nodes.get('repository-search').value, '');
  assert.equal(page.nodes.get('repository-list').children.length, 4);
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
  const page = harness({ reply: () => ({ repositories: [{ installationId: 10, repoId: 20, fullName: 'acme/new', state: 'uninitialized', canInitialize: true, eligible: true }], installations: [] }) });
  page.render({ appConfigured: true, auth: connectedState.auth });
  page.nodes.get('repository-target').value = 'acme/new';
  await page.submit('repository-target-form');
  assert.equal(page.nodes.get('repository-confirmation').open, true);
  assert.match(page.nodes.get('repository-confirmation-body').textContent, /read access/);
  assert.equal(page.requests.some(request => request.type === 'SELECT_REPOSITORY'), false);
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

test('pending reauthorization has no per-repository confirmation action and cannot finish before automatic promotion', () => {
  const page = harness();
  page.render({ ...connectedState, candidateAuth: { mode: 'github_app', githubLogin: 'octocat' } });
  page.context.renderRepositories({ repositories: [{ installationId: 10, repoId: 20, fullName: 'octocat/clockoli-data', state: 'initialized_member', canAdd: true, eligible: true, ready: true }], installations: [] });
  assert.equal(page.nodes.get('finish-setup').disabled, true);
  assert.equal(vm.runInContext('repositoryCanBeSelected(selectedRepository)', page.context), false);
  assert.equal(page.context.reviewSelectedRepository(), false);
  assert.ok(page.nodes.get('repository-list').children.every(row => row.children.length === 2));
  assert.equal(page.nodes.get('repository-confirmation').open, false);
  assert.doesNotMatch(page.nodes.get('repository-list').children[0].children[1].children[1].textContent, /confirm authorization/i);
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
  assert.equal(page.requests.filter(request => request.type === 'DISCOVER_REPOSITORIES').length, 1);
  assert.equal(page.nodes.get('repository-access-panel').hidden, true);
  page.nodes.get('repository-target').value = 'https://github.com/acme/time-data';
  await page.submit('repository-target-form');
  assert.equal(savedChoices.get('1'), 'acme/time-data');
  assert.equal(vm.runInContext('!repositoryCanBeSelected(selectedRepository)', page.context), true);
  assert.equal(page.nodes.get('repository-access-panel').hidden, false);
  assert.equal(page.nodes.get('install-app').href, 'https://github.com/settings/installations/11');
  assert.match(page.nodes.get('repository-target-status').textContent, /existence is not confirmed/);
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

test('access modal closes on Grant and return remains read-only until manual Check', async () => {
  let granted = false;
  const target = { installationId: 11, repoId: 21, fullName: 'acme/time-data', owner: 'acme', repo: 'time-data', ownerType: 'Organization', state: 'initialized_joinable', canJoin: true, eligible: true };
  const page = harness({ reply: () => ({ repositories: granted ? [target] : [], installations: [] }) });
  page.context.window.open = () => ({ opener: {}, location: { replace(url) { assert.equal(url, 'https://github.com/apps/clockoli/installations/new'); } } });
  page.render({ ready: false, appConfigured: true, auth: { mode: 'github_app', githubLogin: 'alice' }, installationUrl: 'https://github.com/apps/clockoli/installations/new' });
  page.nodes.get('repository-target').value = 'acme/time-data';
  await page.submit('repository-target-form');
  assert.equal(page.nodes.get('repository-access-panel').open, true);
  page.nodes.get('install-app').listeners.click({ preventDefault() {} });
  assert.equal(page.nodes.get('repository-access-panel').open, false);
  assert.equal(page.nodes.get('check-repository-target').focused, true);
  const before = page.requests.length;
  granted = true;
  await page.context.rediscoverAfterGitHubHandoff();
  assert.equal(page.requests.length, before);
  assert.equal(vm.runInContext('!repositoryCanBeSelected(selectedRepository)', page.context), true);
  await page.submit('repository-target-form');
  assert.equal(vm.runInContext('!repositoryCanBeSelected(selectedRepository)', page.context), false);
  assert.equal(page.nodes.get('repository-access-panel').open, false);
  assert.equal(page.requests.filter(request => request.type === 'SELECT_REPOSITORY').length, 0);
});

test('known repository missing App write access does not claim existence is unknown', async () => {
  const page = harness({ reply: () => ({ repositories: [{ fullName: 'acme/time-data', reasons: ['app_contents_write_required'], eligible: false }], installations: [] }) });
  page.render({ ready: false, appConfigured: true, auth: { mode: 'github_app', githubLogin: 'alice' } });
  page.nodes.get('repository-target').value = 'acme/time-data';
  await page.submit('repository-target-form');
  assert.equal(page.nodes.get('repository-access-panel').open, true);
  assert.match(page.nodes.get('repository-access-instruction').textContent, /Contents: Read and write/);
  assert.doesNotMatch(page.nodes.get('repository-access-instruction').textContent, /existence/);
  page.nodes.get('close-repository-access').listeners.click();
  assert.equal(page.nodes.get('repository-access-panel').open, false);
  assert.equal(page.nodes.get('check-repository-target').focused, true);
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
    assert.match(text, /2\. Install Clockoli and select Sign in with GitHub\./);
    assert.match(text, /3\. Select .* or enter its GitHub URL in Connect time repositories\./);
    assert.match(text, new RegExp(`grant the Clockoli GitHub App access to ${destination.owner}\/${destination.repo}`));
    assert.doesNotMatch(text, /Connect GitHub|Join an organization repository/);
  }
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
