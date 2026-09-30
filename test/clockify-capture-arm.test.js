import test from 'node:test';
import assert from 'node:assert/strict';
import { ARM_TTL_MS, createClockifyCaptureArmService } from '../src/services/clockify-capture-arm.js';

function sessionStorage() {
  const values = new Map();
  const operations = [];
  return {
    values,
    operations,
    async get(key) { operations.push(['get', key]); return values.get(key); },
    async set(key, value) { operations.push(['set', key]); values.set(key, value); },
    async remove(key) { operations.push(['remove', key]); values.delete(key); },
  };
}

test('Clockify capture arm is tab-scoped, survives a service-worker restart, and expires fail-closed', async () => {
  let time = 1_000;
  const storage = sessionStorage();
  const first = createClockifyCaptureArmService({ storageSession: storage, now: () => time });
  await first.arm(7);
  assert.equal(await first.isArmed(7), true);
  assert.equal(await first.isArmed(8), false);

  const restarted = createClockifyCaptureArmService({ storageSession: storage, now: () => time });
  assert.equal(await restarted.isArmed(7), true);
  time += ARM_TTL_MS;
  assert.equal(await restarted.isArmed(7), false);
  assert.equal(await restarted.isArmed(7), false, 'expired state is removed');
});

test('Clockify capture arm validates its storage boundary and tab identity', async () => {
  const storage = sessionStorage();
  assert.throws(() => createClockifyCaptureArmService({ storageSession: storage, ttlMs: ARM_TTL_MS + 1 }), /TTL/i);
  const service = createClockifyCaptureArmService({ storageSession: storage });
  await assert.rejects(() => service.arm(-1), /tab/i);
  await assert.rejects(() => service.isArmed(1.5), /tab/i);
});

test('Clockify capture rejects an unarmed page and removes stale capture state', async () => {
  const storage = sessionStorage();
  const service = createClockifyCaptureArmService({ storageSession: storage, now: () => 1_000 });
  storage.values.set('clockify-capture-arm:7', { expiresAt: 999 });
  const page = { users: [], entries: [] };

  await assert.rejects(() => service.appendPage(7, page), /not armed/i);
  assert.equal([...storage.values.keys()].some(key => key.includes(':7')), false);
});

test('Clockify capture arm checkpoints each page as a bounded shard instead of rewriting accumulated data', async () => {
  const storage = sessionStorage();
  const service = createClockifyCaptureArmService({ storageSession: storage, now: () => 1_000 });
  const page = entryId => ({
    users: [{ userId: 'user-1', displayName: 'Ada', entryCount: 1 }],
    entries: [{
      provider: 'clockify', entryId, userId: 'user-1',
      startedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T00:01:00.000Z', timezone: 'UTC', duration: 60,
      projectId: 'project-1', project: 'Project', task: '', description: '', tags: [], billable: false,
    }],
  });
  await service.arm(7);
  await service.appendPage(7, page('entry-1'));
  const checkpoint = storage.values.get('clockify-capture-checkpoint:7');
  assert.equal(Object.hasOwn(checkpoint, 'data'), false, 'metadata must not contain the annual report');
  assert.equal(checkpoint.version, 4);
  assert.equal([...storage.values.keys()].some(key => key.startsWith('clockify-capture-page:7:')), true);

  storage.operations.length = 0;
  await service.appendPage(7, page('entry-2'));
  assert.equal(storage.operations.some(([operation, key]) => operation === 'get' && key.startsWith('clockify-capture-page:7:0')), false,
    'a subsequent page must not read an earlier page shard');
  assert.equal(storage.operations.some(([operation, key]) => operation === 'set' && key === 'clockify-capture-checkpoint:7' && Object.hasOwn(storage.values.get(key), 'data')), false,
    'a subsequent page must not rewrite the annual report into checkpoint metadata');
});

test('Clockify capture arm preserves exact duplicate idempotence and rejects conflicting duplicate IDs', async () => {
  const page = (entryId, description = '') => ({
    users: [{ userId: 'user-1', displayName: 'Ada', entryCount: 1 }],
    entries: [{
      provider: 'clockify', entryId, userId: 'user-1',
      startedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T00:01:00.000Z', timezone: 'UTC', duration: 60,
      projectId: 'project-1', project: 'Project', task: '', description, tags: [], billable: false,
    }],
  });
  const duplicateStorage = sessionStorage();
  const duplicateService = createClockifyCaptureArmService({ storageSession: duplicateStorage, now: () => 1_000 });
  await duplicateService.arm(7);
  await duplicateService.appendPage(7, page('entry-1'));
  await duplicateService.appendPage(7, page('entry-1'));
  const duplicate = await duplicateService.appendPage(7, page('entry-2'), 0, true);
  assert.equal(duplicate.data.entries.length, 2);

  const conflictStorage = sessionStorage();
  const conflictService = createClockifyCaptureArmService({ storageSession: conflictStorage, now: () => 1_000 });
  await conflictService.arm(7);
  await conflictService.appendPage(7, page('entry-1'));
  await assert.rejects(() => conflictService.appendPage(7, page('entry-1', 'changed'), 0, true), /conflicting duplicate/i);
});

test('Clockify capture arm renews its lease after every accepted incomplete page', async () => {
  let time = 1_000;
  const storage = sessionStorage();
  const service = createClockifyCaptureArmService({ storageSession: storage, now: () => time, ttlMs: 100 });
  const page = {
    users: [{ userId: 'user-1', displayName: 'Ada', entryCount: 1 }],
    entries: [{
      provider: 'clockify', entryId: 'entry-1', userId: 'user-1',
      startedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T00:01:00.000Z', timezone: 'UTC', duration: 60,
      projectId: 'project-1', project: 'Project', task: '', description: '', tags: [], billable: false,
    }],
  };
  await service.arm(7);
  time += 99;
  assert.deepEqual(await service.appendPage(7, page), { complete: false });
  time += 99;
  assert.equal(await service.isArmed(7), true);
});

test('Clockify capture arm resumes a checkpointed report when only its lease is absent', async () => {
  const storage = sessionStorage();
  const service = createClockifyCaptureArmService({ storageSession: storage, now: () => 1_000 });
  const page = entryId => ({
    users: [{ userId: 'user-1', displayName: 'Ada', entryCount: 1 }],
    entries: [{
      provider: 'clockify', entryId, userId: 'user-1',
      startedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T00:01:00.000Z', timezone: 'UTC', duration: 60,
      projectId: 'project-1', project: 'Project', task: '', description: '', tags: [], billable: false,
    }],
  });
  await service.arm(7);
  assert.deepEqual(await service.appendPage(7, page('entry-1')), { complete: false });
  storage.values.delete('clockify-capture-arm:7');
  assert.equal((await service.appendPage(7, page('entry-2'), 0, true)).complete, true);
});

test('Clockify capture checkpoints pages without treating page-local totals as an annual total', async () => {
  const storage = sessionStorage();
  const service = createClockifyCaptureArmService({ storageSession: storage, now: () => 1_000 });
  const page = entryId => ({
    users: [{ userId: 'user-1', displayName: 'Ada', entryCount: 1 }],
    entries: [{
      provider: 'clockify', entryId, userId: 'user-1',
      startedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T00:01:00.000Z', timezone: 'UTC', duration: 60,
      projectId: 'project-1', project: 'Project', task: '', description: '', tags: [], billable: false,
    }],
  });
  await service.arm(7);
  assert.deepEqual(await service.appendPage(7, page('entry-1')), { complete: false });
  const checkpoint = storage.values.get('clockify-capture-checkpoint:7');
  assert.equal(Object.hasOwn(checkpoint, 'expectedEntries'), false);
  assert.equal((await service.appendPage(7, page('entry-2'), 0, true)).complete, true);
});

test('Clockify capture disarm removes every checkpoint shard and index', async () => {
  const storage = sessionStorage();
  const service = createClockifyCaptureArmService({ storageSession: storage, now: () => 1_000 });
  const page = {
    users: [{ userId: 'user-1', displayName: 'Ada', entryCount: 1 }],
    entries: [{
      provider: 'clockify', entryId: 'entry-1', userId: 'user-1',
      startedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T00:01:00.000Z', timezone: 'UTC', duration: 60,
      projectId: 'project-1', project: 'Project', task: '', description: '', tags: [], billable: false,
    }],
  };
  await service.arm(7);
  await service.appendPage(7, page);
  await service.disarm(7);
  assert.equal([...storage.values.keys()].some(key => key.includes(':7:')), false);
});
