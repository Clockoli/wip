import test from 'node:test';
import assert from 'node:assert/strict';
import { assertMessageAllowed, issueForStart } from '../src/background/message-policy.js';

const origin = 'chrome-extension://abc/';
const content = { url: 'https://github.com/acme/frontend/issues/123', tab: { id: 1 } };
const extension = { url: `${origin}src/popup/popup.html` };
const issue = { type: 'issue', owner: 'acme', repo: 'frontend', number: 123, url: 'https://github.com/acme/frontend/issues/123' };

test('content scripts receive only page-safe state and timer actions', () => {
  assert.doesNotThrow(() => assertMessageAllowed('GET_PAGE_STATE', content, origin));
  assert.doesNotThrow(() => assertMessageAllowed('START', content, origin));
  assert.doesNotThrow(() => assertMessageAllowed('OPEN_TASKS', content, origin));
  assert.throws(() => assertMessageAllowed('GET_STATE', content, origin), /not allowed/i);
  assert.doesNotThrow(() => assertMessageAllowed('EDIT_ENTRY', content, origin));
});

test('non-issue GitHub pages can open navigation pages but cannot mutate timers', () => {
  const dashboard = { url: 'https://github.com/issues/assigned', tab: { id: 2, url: 'https://github.com/issues/assigned' } };
  for (const type of ['GET_PAGE_STATE', 'OPEN_REPORTS', 'OPEN_TASKS', 'OPEN_OPTIONS']) {
    assert.equal(assertMessageAllowed(type, dashboard, origin), 'content');
  }
  for (const type of ['START', 'STOP', 'SYNC', 'LOAD_RECENT', 'EDIT_ENTRY']) {
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

test('trusted extension pages can perform popup-only operations', () => {
  assert.doesNotThrow(() => assertMessageAllowed('GET_STATE', extension, origin));
  assert.doesNotThrow(() => assertMessageAllowed('DELETE_ENTRY', extension, origin));
  assert.doesNotThrow(() => assertMessageAllowed('RESOLVE_PENDING', extension, origin));
  assert.doesNotThrow(() => assertMessageAllowed('SAVE_CONFIG', extension, origin));
  assert.doesNotThrow(() => assertMessageAllowed('LOAD_REPORT', extension, origin));
  assert.doesNotThrow(() => assertMessageAllowed('CANCEL_REPORT', extension, origin));
  assert.throws(() => assertMessageAllowed('SAVE_CONFIG', content, origin), /not allowed/i);
  assert.throws(() => assertMessageAllowed('LOAD_REPORT', content, origin), /not allowed/i);
  assert.throws(() => assertMessageAllowed('CANCEL_REPORT', content, origin), /not allowed/i);
  assert.doesNotThrow(() => assertMessageAllowed('RESOLVE_PENDING', content, origin));
});


test('trusted content-script menu can manage recent entries but cannot access privileged configuration state', () => {
  const sender = { url: 'https://github.com/acme/app/issues/7', tab: { url: 'https://github.com/acme/app/issues/7' } };
  for (const type of ['SYNC', 'LOAD_RECENT', 'EDIT_ENTRY', 'MOVE_BOUNDARY', 'DELETE_ENTRY', 'RESOLVE_PENDING', 'OPEN_REPORTS']) assert.equal(assertMessageAllowed(type, sender, origin), 'content');
  for (const type of ['GET_STATE', 'SAVE_CONFIG']) assert.throws(() => assertMessageAllowed(type, sender, origin), /not allowed/);
});


test('GitHub App onboarding and credential operations are extension-page only', () => {
  const privileged = [
    'GET_ONBOARDING_STATE', 'START_DEVICE_FLOW', 'RESUME_DEVICE_FLOW', 'POLL_DEVICE_FLOW',
    'CANCEL_DEVICE_FLOW', 'CANCEL_GITHUB_APP_SETUP', 'DISCOVER_REPOSITORIES',
    'SELECT_REPOSITORY', 'DISCONNECT_GITHUB_APP', 'CLEAR_LOCAL_CONFIGURATION',
  ];
  for (const type of privileged) {
    assert.equal(assertMessageAllowed(type, extension, origin), 'extension');
    assert.throws(() => assertMessageAllowed(type, content, origin), /not allowed/i);
  }
});
