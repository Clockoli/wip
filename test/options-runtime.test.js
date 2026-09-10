import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { onboardingStep, selectOnlyEligibleRepository, settleBeforeDeadline } from '../src/options/onboarding-flow.js';
import { invoicingSettings, normalizeInvoicingSettings, normalizeProjects, parseRateFields } from '../src/domain/local-settings.js';

const html = await readFile(new URL('../src/options/options.html', import.meta.url), 'utf8');
const source = await readFile(new URL('../src/options/options.js', import.meta.url), 'utf8');
const preferences = {
  rates: { octocat: [{ amountMinorPerHour: 12500, currency: 'EUR', currencyPosition: 'suffix', startDate: '', endDate: '' }] },
  invoicing: {
    seller: { name: 'Seller', address: 'Street', email: 'seller@example.com', taxId: 'TAX-1' },
    clients: [{ id: 'client-1', name: 'Client', address: 'Road', email: 'client@example.com', taxId: 'TAX-2', defaultCurrency: 'EUR' }],
    nextNumber: 7, numberFormat: 'INV-{YYYY}-{NNNN}', paymentTerms: 'Net 30', taxPercent: 20, notes: 'Thanks',
  },
  projects: [], recentDays: 7, exportRecommended: false,
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
    setAttribute(name, value) { this.attributes[name] = value; }, removeAttribute(name) { delete this.attributes[name]; }, focus() {},
    querySelectorAll(selector) {
      const className = selector.startsWith('.') ? selector.slice(1) : '';
      const matches = child => className && child.className.split(' ').includes(className);
      return this.children.flatMap(child => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]);
    },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); },
    addEventListener(type, handler) { this.listeners[type] = handler; },
  };
  return node;
}

function harness({ reply = () => ({}), confirm = () => false } = {}) {
  const nodes = new Map([...html.matchAll(/id="([^"]+)"/g)].map(([, id]) => [id, element()]));
  for (const [, id, label] of html.matchAll(/<button\b[^>]*id="([^"]+)"[^>]*>([^<]*)<\/button>/g)) nodes.get(id).textContent = label;
  const requests = [], timers = [];
  const context = vm.createContext({
    document: { getElementById: id => nodes.get(id), createElement: tag => element(tag), addEventListener() {} },
    window: { addEventListener() {}, confirm }, URL,
    setTimeout: (callback, delay) => { const timer = { callback, delay, cleared: false }; timers.push(timer); return timer; }, clearTimeout(timer) { if (timer) timer.cleared = true; }, queueMicrotask: callback => callback(),
    onboardingStep, selectOnlyEligibleRepository, settleBeforeDeadline, normalizeProjects, parseRateFields, normalizeInvoicingSettings, invoicingSettings,
    ClockoliRecovery: { actionFor: () => null },
    chrome: { runtime: { sendMessage(request, callback) {
      requests.push(request);
      const result = reply(request);
      if (result && typeof result.then === 'function') { result.then(value => callback({ ok: true, data: value }), error => callback({ ok: false, error: { message: error.message } })); return; }
      callback(result instanceof Error ? { ok: false, error: { message: result.message } } : { ok: true, data: result });
    } } },
  });
  vm.runInContext(source.replace(/^import .*;\n/gm, '').slice(0, source.replace(/^import .*;\n/gm, '').indexOf('refreshState().then(refreshLocalPreferences)')), context);
  return {
    nodes, requests, timers, context,
    render(state) { context.nextState = state; vm.runInContext('state = nextState; renderState();', context); },
    submit(id, submitter = null) { return nodes.get(id).listeners.submit({ preventDefault() {}, submitter }); },
  };
}

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
  ['display', 'UPDATE_DISPLAY_PREFERENCES', 'Save display settings'],
  ['billing', 'SAVE_BILLING_SETTINGS', 'Save billable rates'],
  ['invoicing', 'SAVE_BILLING_SETTINGS', 'Save invoicing settings'],
]) {
  test(`${form} save confirms on its button for two seconds and keeps errors beside it`, async () => {
    let fail = false;
    const page = harness({ reply(request) {
      if (request.type === requestType) {
        assert.equal(page.nodes.get(`save-${form}`).disabled, true);
        return fail ? new Error('Save rejected') : { config: connectedState.config, preferences };
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
  const page = harness({ reply: request => request.type === 'GET_LOCAL_PREFERENCES' ? preferences : {} });
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
  finishSave({}); await first;
  const replacements = page.nodes.get('clients-list').querySelectorAll('.save-client');
  assert.equal(page.nodes.get('save-invoicing').disabled, false);
  assert.equal(replacements[0].textContent, 'Saved'); assert.equal(replacements[0].disabled, true);
  assert.equal(replacements[1].textContent, 'Save'); assert.equal(replacements[1].disabled, false);
});

test('restoring invoicing siblings does not clobber another active Saved confirmation', async () => {
  const page = harness({ reply: request => request.type === 'GET_LOCAL_PREFERENCES' ? preferences : {} });
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
  address.scrollHeight = 48; notes.scrollHeight = 72;
  page.context.renderInvoicingPreferences(preferences);
  assert.equal(address.style.height, '48px'); assert.equal(notes.style.height, '72px');
  address.scrollHeight = 96; address.listeners.input();
  assert.equal(address.style.height, '96px');
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
    if (request.type === 'SAVE_BILLING_SETTINGS') return fail ? new Error(message) : {};
    if (request.type === 'GET_LOCAL_PREFERENCES') return { ...preferences, invoicing: { ...preferences.invoicing, nextNumber: 9 } };
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
  assert.equal(page.requests.at(-1).type, 'GET_LOCAL_PREFERENCES');
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

test('both billing saves carry rates and invoicing so neither half is erased', async () => {
  const page = harness({ reply(request) {
    if (request.type === 'SAVE_BILLING_SETTINGS') return {};
    if (request.type === 'GET_LOCAL_PREFERENCES') return preferences;
    throw new Error(`Unexpected message: ${request.type}`);
  } });
  page.context.renderLocalPreferences(preferences);
  await page.submit('billing-form');
  await page.submit('invoicing-form');
  const saves = page.requests.filter(request => request.type === 'SAVE_BILLING_SETTINGS');
  assert.equal(saves.length, 2);
  for (const save of saves) {
    assert.equal(save.payload.rates.octocat[0].amountMinorPerHour, 12500);
    assert.equal(save.payload.invoicing.seller.name, 'Seller');
    assert.equal(save.payload.invoicing.clients[0].id, 'client-1');
  }
});

test('successful display save preserves an unsaved client row and other forms while refreshing project client names', async () => {
  const page = harness({ reply(request) {
    if (request.type === 'UPDATE_DISPLAY_PREFERENCES') return {
      config: { ...connectedState.config, recentDays: request.payload.recentDays }, preferences: { ...preferences, ...request.payload },
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
    if (request.type === 'SAVE_BILLING_SETTINGS') return {};
    if (request.type === 'GET_LOCAL_PREFERENCES') return preferences;
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
    assert.equal(page.nodes.get('rates-list').querySelector('.rate-value').value, '125');
  } else {
    assert.equal(page.nodes.get('rates-list').querySelector('.rate-row'), rate); assert.equal(rate.querySelector('.rate-value').value, '150');
    assert.equal(page.nodes.get('clients-list').querySelector('.client-name').value, 'Client');
    assert.equal(project.querySelector('.project-client').children.find(option => option.value === 'client-1').textContent, 'Client');
  }
});

for (const form of ['billing', 'invoicing']) test(`${form} saves a typed client without validating incomplete projects`, async () => {
  const page = harness({ reply(request) {
    if (request.type === 'SAVE_BILLING_SETTINGS') return {};
    if (request.type === 'GET_LOCAL_PREFERENCES') return preferences;
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
  assert.equal(save.payload.invoicing.clients.at(-1).name, 'Typed client');
  assert.equal(save.payload.invoicing.clients.at(-1).email, 'typed@example.com');
  assert.equal(Object.hasOwn(save.payload.invoicing.clients.at(-1), 'projects'), false);
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
    if (request.type === 'SAVE_BILLING_SETTINGS') { stored = { ...stored, ...request.payload }; return {}; }
    if (request.type === 'GET_LOCAL_PREFERENCES') return stored;
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

test('sole eligible repository still auto-connects and reveals completion after validation', async () => {
  const repository = { installationId: 10, repoId: 20, fullName: 'octocat/clockoli-data', repo: 'clockoli-data', eligible: true };
  const page = harness({ reply(request) {
    if (request.type === 'DISCOVER_REPOSITORIES') return { repositories: [repository], candidates: [repository] };
    if (request.type === 'SELECT_REPOSITORY') return { status: 'write_verified' };
    if (request.type === 'GET_ONBOARDING_STATE') return connectedState;
    if (request.type === 'RESUME_DEVICE_FLOW') return null;
    throw new Error(`Unexpected message: ${request.type}`);
  } });
  page.render({ ready: false, appConfigured: true });
  await page.context.discoverRepositories();
  assert.equal(page.requests.filter(request => request.type === 'SELECT_REPOSITORY').length, 1);
  assert.equal(page.requests.find(request => request.type === 'SELECT_REPOSITORY').payload.repoId, 20);
  assert.equal(page.nodes.get('connected').hidden, false);
  assert.equal(page.nodes.get('onboarding').hidden, true);
  assert.equal(page.nodes.get('connected-storage').textContent.includes('Write verified'), true);
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
