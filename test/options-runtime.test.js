import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { onboardingStep, selectOnlyEligibleRepository, settleBeforeDeadline } from '../src/options/onboarding-flow.js';
import { normalizeProjects, parseRateFields } from '../src/domain/local-settings.js';

const html = await readFile(new URL('../src/options/options.html', import.meta.url), 'utf8');
const source = await readFile(new URL('../src/options/options.js', import.meta.url), 'utf8');
const preferences = { rates: {}, projects: [], recentDays: 7, exportRecommended: false };
const connectedState = {
  ready: true, appConfigured: true, auth: { mode: 'github_app', githubLogin: 'octocat' },
  config: { owner: 'octocat', repo: 'clockoli-data', branch: 'main', recentDays: 7 },
  verificationStatus: 'write_verified', trackingRepositoryUrl: 'https://github.com/octocat/clockoli-data',
};

function element() {
  return {
    hidden: false, open: false, disabled: false, value: '', textContent: '', className: '',
    dataset: {}, style: {}, children: [], listeners: {}, classList: { toggle() {} },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    setAttribute() {}, removeAttribute() {}, focus() {},
    querySelectorAll() { return []; },
    addEventListener(type, handler) { this.listeners[type] = handler; },
  };
}

function harness({ reply = () => ({}), confirm = () => false } = {}) {
  const nodes = new Map([...html.matchAll(/id="([^"]+)"/g)].map(([, id]) => [id, element()]));
  const requests = [];
  const context = vm.createContext({
    document: { getElementById: id => nodes.get(id), createElement: element, addEventListener() {} },
    window: { addEventListener() {}, confirm }, URL,
    setTimeout: () => 1, clearTimeout() {}, queueMicrotask: callback => callback(),
    onboardingStep, selectOnlyEligibleRepository, settleBeforeDeadline, normalizeProjects, parseRateFields,
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

test('invalid billable input reports inline without sending a mutation', async () => {
  const page = harness();
  page.nodes.get('rates-list').querySelectorAll = () => [{ querySelector: () => ({ value: 'invalid' }) }];
  await page.submit('billing-form');
  assert.match(page.nodes.get('billing-feedback')?.textContent || '', /rate|amount|currency/i);
  assert.equal(page.requests.length, 0);
  assert.equal(page.nodes.get('save-billing').disabled, false);
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
