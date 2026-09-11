import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { assertMessageAllowed, issueForStart, taskUrlForParticipantLoad, taskUrlForStart, taskUrlForTimelineSwitch } from '../src/background/message-policy.js';

const origin = 'chrome-extension://abc/';
const content = { url: 'https://github.com/acme/frontend/issues/123', tab: { id: 1 } };
const extension = { url: `${origin}src/popup/popup.html` };
const issue = { type: 'issue', owner: 'acme', repo: 'frontend', number: 123, url: 'https://github.com/acme/frontend/issues/123' };

test('invoice number reservation is extension-only and the dispatcher ignores payloads', async () => {
  assert.equal(assertMessageAllowed('RESERVE_INVOICE_NUMBER', extension, origin), 'extension');
  assert.throws(() => assertMessageAllowed('RESERVE_INVOICE_NUMBER', content, origin), /not allowed/i);
  const worker = await readFile(new URL('../src/background/service-worker.js', import.meta.url), 'utf8');
  let calls = 0;
  const context = vm.createContext({ assertMessageAllowed, chrome: { runtime: { getURL: () => origin } }, store: {
    reserveInvoiceNumber: async (...args) => { assert.deepEqual(args, []); calls += 1; return { sequence: calls }; },
  } });
  vm.runInContext(worker.slice(worker.indexOf('async function handle('), worker.indexOf('chrome.runtime.onMessage.addListener')), context);
  assert.equal((await context.handle({ type: 'RESERVE_INVOICE_NUMBER', payload: { nextNumber: 999 } }, extension)).sequence, 1);
  await assert.rejects(context.handle({ type: 'RESERVE_INVOICE_NUMBER' }, content), /not allowed/i);
  assert.equal(calls, 1);
});

test('content scripts receive only page-safe state and timer actions', () => {
  assert.doesNotThrow(() => assertMessageAllowed('GET_PAGE_STATE', content, origin));
  assert.doesNotThrow(() => assertMessageAllowed('LOAD_TASK_PARTICIPANTS', content, origin));
  assert.doesNotThrow(() => assertMessageAllowed('SET_ACTION_ICON_FRAME', content, origin));
  assert.doesNotThrow(() => assertMessageAllowed('EDIT_ACTIVE_START', content, origin));
  assert.doesNotThrow(() => assertMessageAllowed('OPEN_TASKS', content, origin));
  assert.throws(() => assertMessageAllowed('GET_STATE', content, origin), /not allowed/i);
  assert.throws(() => assertMessageAllowed('EDIT_ENTRY', content, origin), /not allowed/i);
});

test('any GitHub page can manage its URL task but cannot access privileged state', () => {
  const dashboard = { url: 'https://github.com/issues/assigned', tab: { id: 2, url: 'https://github.com/issues/assigned' } };
  for (const type of ['GET_PAGE_STATE', 'START', 'STOP', 'SYNC', 'LOAD_RECENT', 'EDIT_ENTRIES', 'EDIT_ACTIVE_START', 'QUEUE_ENTRY_EDIT', 'QUEUE_ENTRIES_EDIT', 'QUEUE_ACTIVE_START_EDIT', 'OPEN_REPORTS', 'OPEN_TASKS', 'OPEN_TIMES', 'OPEN_OPTIONS']) {
    assert.equal(assertMessageAllowed(type, dashboard, origin), 'content');
  }
  for (const type of ['GET_STATE', 'SAVE_CONFIG', 'LOAD_REPORT']) {
    assert.throws(() => assertMessageAllowed(type, dashboard, origin), /not allowed/i);
  }
});

test('content-script START issue must match its sender URL', () => {
  assert.deepEqual(issueForStart(issue, content, origin), issue);
  assert.throws(() => issueForStart({ ...issue, number: 999, url: 'https://github.com/acme/frontend/issues/999' }, content, origin), /match/i);
});

test('content-script START accepts a matching canonical pull request page', () => {
  const pull = { type: 'pull_request', owner: 'acme', repo: 'frontend', number: 456, url: 'https://github.com/acme/frontend/pull/456' };
  const sender = { url: pull.url, tab: { id: 2 } };
  assert.deepEqual(issueForStart(pull, sender, origin), pull);
  assert.throws(() => issueForStart({ ...pull, type: 'issue', url: 'https://github.com/acme/frontend/issues/456' }, sender, origin), /match/i);
});

test('content task switches remain bound to the current page URL', () => {
  assert.equal(taskUrlForStart(issue.url, content, origin), issue.url);
  assert.throws(() => taskUrlForStart('https://github.com/acme/frontend/issues/124', content, origin), /current page/i);
});

test('timeline task switching may select a previously tracked task from another GitHub page', () => {
  assert.equal(
    taskUrlForTimelineSwitch('https://github.com/manticoresoftware/site/issues/231', content, origin),
    'https://github.com/manticoresoftware/site/issues/231',
  );
  assert.throws(() => taskUrlForTimelineSwitch('javascript:alert(1)', content, origin), /task URL/i);
});

test('trusted extension pages can perform popup-only operations', () => {
  assert.doesNotThrow(() => assertMessageAllowed('GET_STATE', extension, origin));
  assert.doesNotThrow(() => assertMessageAllowed('GET_PAGE_STATE', extension, origin));
  assert.doesNotThrow(() => assertMessageAllowed('DELETE_ENTRY', extension, origin));
  assert.doesNotThrow(() => assertMessageAllowed('SWITCH_TASK', extension, origin));
  assert.doesNotThrow(() => assertMessageAllowed('RESOLVE_PENDING', extension, origin));
  assert.doesNotThrow(() => assertMessageAllowed('SAVE_CONFIG', extension, origin));
  assert.doesNotThrow(() => assertMessageAllowed('UPDATE_DISPLAY_PREFERENCES', extension, origin));
  assert.doesNotThrow(() => assertMessageAllowed('SET_QUEUE_DIAGNOSTICS', extension, origin));
  assert.doesNotThrow(() => assertMessageAllowed('LOAD_REPORT', extension, origin));
  assert.doesNotThrow(() => assertMessageAllowed('GET_EXCHANGE_RATES', extension, origin));
  assert.doesNotThrow(() => assertMessageAllowed('CANCEL_REPORT', extension, origin));
  for (const type of ['LOAD_TIMES', 'BULK_ADD_TIMES']) {
    assert.equal(assertMessageAllowed(type, extension, origin), 'extension');
    assert.throws(() => assertMessageAllowed(type, content, origin), /not allowed/i);
  }
  assert.throws(() => assertMessageAllowed('SAVE_CONFIG', content, origin), /not allowed/i);
  assert.throws(() => assertMessageAllowed('UPDATE_DISPLAY_PREFERENCES', content, origin), /not allowed/i);
  assert.throws(() => assertMessageAllowed('SET_QUEUE_DIAGNOSTICS', content, origin), /not allowed/i);
  assert.throws(() => assertMessageAllowed('LOAD_REPORT', content, origin), /not allowed/i);
  assert.throws(() => assertMessageAllowed('GET_EXCHANGE_RATES', content, origin), /not allowed/i);
  assert.throws(() => assertMessageAllowed('CANCEL_REPORT', content, origin), /not allowed/i);
  assert.equal(assertMessageAllowed('SWITCH_TASK', content, origin), 'content');
  assert.doesNotThrow(() => assertMessageAllowed('RESOLVE_PENDING', content, origin));
});


test('trusted content-script menu can manage recent entries but cannot access privileged configuration state', () => {
  const sender = { url: 'https://github.com/acme/app/issues/7', tab: { url: 'https://github.com/acme/app/issues/7' } };
  for (const type of ['SYNC', 'LOAD_RECENT', 'EDIT_ENTRIES', 'QUEUE_ENTRIES_EDIT', 'DELETE_ENTRY', 'RESOLVE_PENDING', 'OPEN_REPORTS', 'OPEN_TIMES']) assert.equal(assertMessageAllowed(type, sender, origin), 'content');
  for (const type of ['GET_STATE', 'SAVE_CONFIG']) assert.throws(() => assertMessageAllowed(type, sender, origin), /not allowed/);
  assert.throws(() => assertMessageAllowed('MOVE_BOUNDARY', sender, origin), /not allowed/);
});


test('GitHub App onboarding and credential operations are extension-page only', () => {
  const privileged = [
    'GET_ONBOARDING_STATE', 'START_DEVICE_FLOW', 'OPEN_DEVICE_FLOW_PAGE', 'RESUME_DEVICE_FLOW', 'POLL_DEVICE_FLOW',
    'CANCEL_DEVICE_FLOW', 'CANCEL_GITHUB_APP_SETUP', 'DISCOVER_REPOSITORIES', 'CHECK_REPOSITORY_ACCESS',
    'SELECT_REPOSITORY', 'SET_DEFAULT_DESTINATION', 'REMOVE_DESTINATION', 'DISCONNECT_GITHUB_APP', 'CLEAR_LOCAL_CONFIGURATION',
  ];
  for (const type of privileged) {
    assert.equal(assertMessageAllowed(type, extension, origin), 'extension');
    assert.throws(() => assertMessageAllowed(type, content, origin), /not allowed/i);
  }
});


test('any GitHub page can start a URL task only for its exact sender URL', () => {
  const sender = { url: 'https://github.com/acme/app/actions/runs/123?check_suite_focus=true', tab: { id: 9 } };
  assert.equal(assertMessageAllowed('START', sender, origin), 'content');
  assert.equal(taskUrlForStart(sender.url, sender, origin), sender.url);
  assert.throws(() => taskUrlForStart('https://example.com/other', sender, origin), /match/i);
});

test('trusted popup accepts arbitrary HTTP(S) task URLs and rejects unsafe schemes', () => {
  assert.equal(taskUrlForStart('https://example.com/docs/42', extension, origin), 'https://example.com/docs/42');
  assert.throws(() => taskUrlForStart('javascript:alert(1)', extension, origin), /task URL/i);
});


test('GitHub issue query and fragment churn cannot create a second task identity', () => {
  const sender = { url: 'https://github.com/acme/app/issues/7?notification_referrer_id=1#issuecomment-3', tab: { id: 10 } };
  assert.equal(taskUrlForStart('https://github.com/acme/app/issues/7', sender, origin), 'https://github.com/acme/app/issues/7');
});

test('participant totals follow the current GitHub SPA tab URL instead of the original document URL', () => {
  const sender = {
    url: 'https://github.com/manticoresoftware/manticoresearch/issues/4883',
    tab: { id: 10, url: 'https://github.com/manticoresoftware/manticoresearch/issues/4884' },
  };
  assert.equal(
    taskUrlForParticipantLoad('https://github.com/manticoresoftware/manticoresearch/issues/4884', sender, origin),
    'https://github.com/manticoresoftware/manticoresearch/issues/4884',
  );
  assert.throws(
    () => taskUrlForParticipantLoad('https://github.com/manticoresoftware/manticoresearch/issues/4885', sender, origin),
    /current page/i,
  );
});
