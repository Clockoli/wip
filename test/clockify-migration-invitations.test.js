import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMigrationInvitations } from '../src/clockify-migration/invitations.js';

function node(tag) {
  return {
    tag, children: [], listeners: {}, disabled: false, textContent: '',
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = [...children]; },
    remove() { this.removed = true; },
    setAttribute() {},
    addEventListener(type, listener) { this.listeners[type] = listener; },
  };
}

const outcome = { id: 'preview-1', destinationId: 'github:18', outcomes: [
  { sourceUserId: 'a', status: 'imported', githubUser: { id: 42, login: 'Alice' } },
  { sourceUserId: 'b', status: 'already_present', githubUser: { id: 43, login: 'Bob' } },
  { sourceUserId: 'c', status: 'failed', githubUser: { id: 44, login: 'Carol' } },
] };

test('only successful noncollaborators are offered a separate invitation after migration; no automatic send', async () => {
  const oldDocument = globalThis.document;
  globalThis.document = { createElement: node };
  try {
    const container = node('section'), calls = [];
    renderMigrationInvitations({ container, outcome, collaboratorIds: new Set([43]),
      confirm: () => false, send: async value => { calls.push(value); return { status: 'invited', login: 'Alice' }; } });
    assert.equal(container.children.length, 3);
    const row = container.children[2];
    assert.equal(row.children[0].textContent, '@Alice');
    assert.deepEqual(calls, []);
    await row.children[1].listeners.click();
    assert.deepEqual(calls, []);
    row.children[2].listeners.click();
    assert.equal(row.removed, true);
    renderMigrationInvitations({ container, outcome: { ...outcome, destinationId: null },
      confirm: () => true, send: async () => { throw new Error('Should not invite'); } });
    assert.equal(container.children.length, 0);
  } finally { globalThis.document = oldDocument; }
});

test('invitation action requires explicit confirmation and sends only the persisted outcome keys', async () => {
  const oldDocument = globalThis.document;
  globalThis.document = { createElement: node };
  try {
    const container = node('section'), calls = [];
    renderMigrationInvitations({ container, outcome, confirm: () => true,
      send: async message => { calls.push(message); return { status: 'invited', login: 'Alice' }; } });
    const row = container.children[2];
    await row.children[1].listeners.click();
    assert.deepEqual(calls, [{ type: 'INVITE_MIGRATED_USER', payload: { id: 'preview-1', sourceUserId: 'a' } }]);
    assert.match(row.children[3].textContent, /Invitation sent/);
    assert.equal(row.children[1].removed, true);
  } finally { globalThis.document = oldDocument; }
});
