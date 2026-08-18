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
  assert.throws(() => assertMessageAllowed('GET_STATE', content, origin), /not allowed/i);
  assert.throws(() => assertMessageAllowed('EDIT_ENTRY', content, origin), /not allowed/i);
});

test('content-script START issue must match its sender URL', () => {
  assert.deepEqual(issueForStart(issue, content, origin), issue);
  assert.throws(() => issueForStart({ ...issue, number: 999, url: 'https://github.com/acme/frontend/issues/999' }, content, origin), /match/i);
});

test('trusted extension pages can perform popup-only operations', () => {
  assert.doesNotThrow(() => assertMessageAllowed('GET_STATE', extension, origin));
  assert.doesNotThrow(() => assertMessageAllowed('DELETE_ENTRY', extension, origin));
  assert.doesNotThrow(() => assertMessageAllowed('RESOLVE_PENDING', extension, origin));
  assert.doesNotThrow(() => assertMessageAllowed('SAVE_CONFIG', extension, origin));
  assert.throws(() => assertMessageAllowed('SAVE_CONFIG', content, origin), /not allowed/i);
  assert.throws(() => assertMessageAllowed('RESOLVE_PENDING', content, origin), /not allowed/i);
});
