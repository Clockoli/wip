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
  const requests = [];
  const context = vm.createContext({
    document: { getElementById: id => nodes.get(id), createElement: tag => element(tag), addEventListener() {} },
    window: { addEventListener() {}, confirm }, URL,
    setTimeout: () => 1, clearTimeout() {}, queueMicrotask: callback => callback(),
    onboardingStep, selectOnlyEligibleRepository, settleBeforeDeadline, normalizeProjects, parseRateFields, normalizeInvoicingSettings, invoicingSettings,
    ClockoliRecovery: { actionFor: () => null },
    chrome: { runtime: { sendMessage(request, callback) {
      requests.push(request);
      const result = reply(request);
      callback(result instanceof Error ? { ok: false, error: { message: result.message } } : { ok: true, data: result });
    } } },
  });
  vm.runInContext(source.replace(/^import .*;\n/gm, '').slice(0, source.replace(/^import .*;\n/gm, '').indexOf('refreshState().then(refreshLocalPreferences)')), context);
  return {
    nodes, requests, context,
    render(state) { context.nextState = state; vm.runInContext('state = nextState; renderState();', context); },
    submit(id) { return nodes.get(id).listeners.submit({ preventDefault() {} }); },
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

for (const [form, requestType, success] of [
  ['display', 'UPDATE_DISPLAY_PREFERENCES', 'Display settings saved.'],
  ['billing', 'SAVE_BILLING_SETTINGS', 'Billable rates saved locally.'],
  ['invoicing', 'SAVE_BILLING_SETTINGS', 'Invoicing settings saved locally.'],
]) {
  test(`${form} save confirms beside its button, reports errors there and restores the button`, async () => {
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
    assert.equal(page.nodes.get(`${form}-feedback`)?.textContent, success);
    assert.match(page.nodes.get(`${form}-feedback`).className, /success/);
    assert.equal(page.nodes.get('message').textContent, '');
    assert.equal(page.nodes.get(`save-${form}`).disabled, false);
    fail = true;
    await page.submit(`${form}-form`);
    assert.equal(page.nodes.get(`${form}-feedback`).textContent, 'Save rejected');
    assert.match(page.nodes.get(`${form}-feedback`).className, /error/);
    assert.equal(page.nodes.get('message').textContent, '');
    assert.equal(page.nodes.get(`save-${form}`).disabled, false);
  });
}

for (const form of ['billing', 'invoicing']) test(`${form} surfaces stale invoice counter errors and refreshes the stored number after success`, async () => {
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
  assert.equal(page.nodes.get('invoice-next-number').value, '9');
  assert.match(page.nodes.get(`${form}-feedback`).className, /success/);
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

test('undefined client projects report inline without sending or throwing', async () => {
  const page = harness(); page.context.renderLocalPreferences(preferences);
  page.nodes.get('clients-list').querySelector('.client-projects').value = 'Missing project';
  await page.submit('invoicing-form');
  assert.equal(page.nodes.get('invoicing-feedback').textContent, 'Project Missing project is not defined. Add it under Projects, or remove it from Client.');
  assert.equal(page.requests.length, 0);
  assert.equal(page.nodes.get('save-invoicing').disabled, false);
});

test('valid client projects save with both billing halves intact', async () => {
  const linked = {
    ...preferences,
    projects: [{ name: 'Acme web', substrings: ['example.com/acme/'] }],
    invoicing: { ...preferences.invoicing, clients: [{ ...preferences.invoicing.clients[0], projects: ['Acme web'] }] },
  };
  const page = harness({ reply(request) {
    if (request.type === 'SAVE_BILLING_SETTINGS') return {};
    if (request.type === 'GET_LOCAL_PREFERENCES') return linked;
    throw new Error(`Unexpected message: ${request.type}`);
  } });
  page.context.renderLocalPreferences(linked);
  await page.submit('invoicing-form');
  const save = page.requests.find(request => request.type === 'SAVE_BILLING_SETTINGS');
  assert.equal(save.payload.rates.octocat[0].amountMinorPerHour, 12500);
  assert.deepEqual(save.payload.invoicing.clients[0].projects, ['Acme web']);
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
