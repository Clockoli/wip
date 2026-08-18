import test from 'node:test';
import assert from 'node:assert/strict';
import { popupControlState } from '../src/popup/view-state.js';

test('Stop is re-enabled when a new active timer is rendered', () => {
  const issue = { type: 'issue', owner: 'acme', repo: 'app', number: 1, url: 'https://github.com/acme/app/issues/1' };
  assert.equal(popupControlState({ configured: true, active: null, pendingWrites: [] }, issue).stopDisabled, true);
  assert.equal(popupControlState({ configured: true, active: { issue }, pendingWrites: [] }, issue).stopDisabled, false);
});
