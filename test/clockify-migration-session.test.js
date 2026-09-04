import test from 'node:test';
import assert from 'node:assert/strict';
import { createClockifyMigrationSessionService, MAX_CLOCKIFY_MIGRATION_SESSION_TTL_MS } from '../src/services/clockify-migration-session.js';

const SESSION_KEY = 'clockify-migration-preview';
const firstId = 'a1b2c3d4-e5f6-4a78-9abc-def012345678';
const secondId = 'b1b2c3d4-e5f6-4a78-9abc-def012345678';

function normalized() {
  return {
    users: [{ userId: 'source-user-1', displayName: 'Preview Person', entryCount: 1 }],
    entries: [{
      provider: 'clockify', entryId: 'time-entry-1', userId: 'source-user-1',
      startedAt: '2026-09-01T08:00:00.000Z', endedAt: '2026-09-01T09:30:00.000Z', timezone: 'UTC', duration: 5400,
      projectId: 'project-1', project: 'Migration work', task: 'Review preview',
      description: 'Validated historical time', tags: ['migration'], billable: true,
    }],
  };
}

function sessionStorage() {
  const values = new Map();
  const calls = [];
  return {
    calls, values,
    async get(key) { calls.push(['get', key]); return structuredClone(values.get(key)); },
    async set(key, value) { calls.push(['set', key, structuredClone(value)]); values.set(key, structuredClone(value)); },
    async remove(key) { calls.push(['remove', key]); values.delete(key); },
  };
}

function service(storage, { now = () => 1_000, ids = [firstId] } = {}) {
  return createClockifyMigrationSessionService({
    storageSession: storage, now,
    randomUUID: () => {
      const id = ids.shift();
      if (!id) throw new Error('test ran out of session IDs');
      return id;
    },
  });
}

test('creates a bounded credential-free session snapshot and consumes it exactly once', async () => {
  const storage = sessionStorage();
  const data = normalized();
  const handoff = service(storage);

  const created = await handoff.create(data);
  data.users[0].displayName = 'Changed after handoff';
  data.entries[0].tags.push('changed');

  assert.deepEqual(created, { id: firstId, expiresAt: 601_000 });
  assert.deepEqual(storage.values.get(SESSION_KEY), {
    version: 1, id: firstId, expiresAt: 601_000, data: normalized(),
  });
  assert.doesNotMatch(JSON.stringify(storage.values.get(SESSION_KEY)), /reportText|authorization|cookie|token|email/i);

  assert.deepEqual(await handoff.peek(), { id: firstId, data: normalized() });
  assert.equal(storage.values.has(SESSION_KEY), true, 'previewing must not consume the import handoff');

  const consumed = await handoff.consume(firstId);
  assert.deepEqual(consumed, normalized());
  assert.equal(storage.values.has(SESSION_KEY), false);
  assert.deepEqual(await handoff.consume(firstId), null);
});

test('replaces the sole active session and never permits a TTL longer than thirty minutes', async () => {
  const storage = sessionStorage();
  const handoff = service(storage, { ids: [firstId, secondId] });
  await handoff.create(normalized());
  const created = await handoff.create(normalized(), { ttlMs: MAX_CLOCKIFY_MIGRATION_SESSION_TTL_MS });

  assert.deepEqual(created, { id: secondId, expiresAt: 1_801_000 });
  assert.equal(await handoff.consume(firstId), null);
  assert.deepEqual(await handoff.consume(secondId), normalized());
  await assert.rejects(() => handoff.create(normalized(), { ttlMs: MAX_CLOCKIFY_MIGRATION_SESSION_TTL_MS + 1 }), /TTL/i);
});

test('deletes an expired, malformed, or unreadable stored value and fails closed', async t => {
  await t.test('expired', async () => {
    const storage = sessionStorage();
    storage.values.set(SESSION_KEY, { version: 1, id: firstId, expiresAt: 1_000, data: normalized() });
    assert.equal(await service(storage, { now: () => 1_000 }).consume(firstId), null);
    assert.equal(storage.values.has(SESSION_KEY), false);
  });

  await t.test('malformed snapshot', async () => {
    const storage = sessionStorage();
    const malformed = normalized();
    malformed.entries[0].rawReport = '{ not allowed }';
    storage.values.set(SESSION_KEY, { version: 1, id: firstId, expiresAt: 2_000, data: malformed });
    assert.equal(await service(storage).consume(firstId), null);
    assert.equal(storage.values.has(SESSION_KEY), false);
  });

  await t.test('storage read failure', async () => {
    const calls = [];
    const storage = {
      async get() { calls.push('get'); throw new Error('storage unavailable'); },
      async remove(key) { calls.push(`remove:${key}`); },
      async set() {},
    };
    assert.equal(await service(storage).consume(firstId), null);
    assert.deepEqual(calls, ['get', `remove:${SESSION_KEY}`]);
  });
});

test('rejects non-inert or non-normalized input before storage, and validates retrieval again', async () => {
  const storage = sessionStorage();
  const handoff = service(storage);
  const accessor = normalized();
  Object.defineProperty(accessor.entries[0], 'description', { enumerable: true, get() { throw new Error('must not execute'); } });

  await assert.rejects(() => handoff.create(accessor), /data property|inert/i);
  await assert.rejects(() => handoff.create({ users: [], entries: undefined }), /entries/i);
  await assert.rejects(() => handoff.create({ ...normalized(), users: [{ userId: 'source-user-1', displayName: 'Preview Person', entryCount: 2 }] }), /count/i);
  assert.equal(storage.values.has(SESSION_KEY), false);

  storage.values.set(SESSION_KEY, {
    version: 1, id: firstId, expiresAt: 2_000,
    data: { ...normalized(), entries: [{ ...normalized().entries[0], startedAt: 'not-a-timestamp' }] },
  });
  assert.equal(await handoff.consume(firstId), null);
  assert.equal(storage.values.has(SESSION_KEY), false);
});

test('serializes concurrent consume calls and removes storage before returning the snapshot', async () => {
  const storage = sessionStorage();
  const handoff = service(storage);
  await handoff.create(normalized());
  let releaseRemove;
  const removed = new Promise(resolve => { releaseRemove = resolve; });
  const originalRemove = storage.remove;
  storage.remove = async key => { await removed; return originalRemove(key); };

  const first = handoff.consume(firstId);
  const second = handoff.consume(firstId);
  await Promise.resolve();
  assert.equal(storage.values.has(SESSION_KEY), true);
  releaseRemove();
  assert.deepEqual(await first, normalized());
  assert.equal(await second, null);
  assert.equal(storage.values.has(SESSION_KEY), false);
});
