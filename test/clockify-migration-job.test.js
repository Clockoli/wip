import test from 'node:test';
import assert from 'node:assert/strict';
import { createClockifyMigrationJobService, CLOCKIFY_MIGRATION_JOB_KEY } from '../src/services/clockify-migration-job.js';
import { createClockifyMigrationSessionService } from '../src/services/clockify-migration-session.js';

const id = '123e4567-e89b-42d3-a456-426614174000';
const pin = { destinationId: 'github:18', repoId: 18, owner: 'acme', repo: 'times', branch: 'clockoli/users/42', defaultBranch: 'main', actorId: 42, login: 'ada', authGeneration: 3 };
const mappings = [{ sourceUserId: 'source-1', githubLogin: 'ada' }];
const data = { users: [{ userId: 'source-1', displayName: 'Person', entryCount: 1 }], entries: [{
  provider: 'clockify', entryId: 'entry-1', userId: 'source-1', startedAt: '2026-09-01T08:00:00.000Z', endedAt: '2026-09-01T09:00:00.000Z', timezone: 'UTC', duration: 3600,
  projectId: 'project-1', project: 'Project', task: 'Task', description: '', tags: [], billable: false,
}] };
const outcome = { sourceUserId: 'source-1', githubUser: { id: 42, login: 'ada' }, status: 'imported', added: 1, alreadyPresent: 0 };

function backend() {
  const values = new Map();
  return {
    values,
    async getMany(keys) { return Object.fromEntries(keys.filter(key => values.has(key)).map(key => [key, structuredClone(values.get(key))])); },
    async setMany(set) { for (const [key, value] of Object.entries(set)) values.set(key, structuredClone(value)); },
    async deleteMany(keys) { for (const key of keys) values.delete(key); },
    async mutateMany(keys, mutate) {
      const current = await this.getMany(keys);
      const change = mutate(current);
      if (!change) return false;
      for (const key of change.delete || []) values.delete(key);
      for (const [key, value] of Object.entries(change.set || {})) values.set(key, structuredClone(value));
      return change.result ?? true;
    },
  };
}
async function seeded(storage) {
  const session = createClockifyMigrationSessionService({
    storageSession: { get: async key => (await storage.getMany([key]))[key], set: async (key, value) => storage.setMany({ [key]: value }), remove: async key => storage.deleteMany([key]) },
    now: () => 1_000, randomUUID: () => id,
  });
  await session.create(data);
  return createClockifyMigrationJobService({ backend: storage, now: () => 2_000 });
}

test('confirmation atomically transfers a validated preview into one durable credential-free job', async () => {
  const storage = backend(); const jobs = await seeded(storage);
  const job = await jobs.claim(id, mappings, pin);
  assert.equal(job.id, id);
  assert.deepEqual(job.data, data);
  assert.equal(storage.values.has('clockify-migration-preview'), false);
  assert.equal(storage.values.has(CLOCKIFY_MIGRATION_JOB_KEY), true);
  assert.doesNotMatch(JSON.stringify(storage.values.get(CLOCKIFY_MIGRATION_JOB_KEY)), /accessToken|authorization|cookie|secret|password/i);
  await assert.rejects(jobs.claim(id, mappings, pin), /already|unavailable/i);
  const restarted = createClockifyMigrationJobService({ backend: storage, now: () => 3_000 });
  assert.deepEqual(await restarted.load(), job);
});

test('invalid mapping or concurrent job never consumes preview', async () => {
  const storage = backend(); const jobs = await seeded(storage);
  await assert.rejects(jobs.claim(id, [{ sourceUserId: 'source-1', githubLogin: 'bad name' }], pin), /unavailable/i);
  assert.equal(storage.values.has('clockify-migration-preview'), true);
  storage.values.set(CLOCKIFY_MIGRATION_JOB_KEY, { id: 'other' });
  await assert.rejects(jobs.claim(id, mappings, pin), /already/i);
  assert.equal(storage.values.has('clockify-migration-preview'), true);
});

test('a captured preview cannot overwrite a job claimed after an earlier job check', async () => {
  const storage = backend(); const jobs = await seeded(storage);
  await jobs.claim(id, mappings, pin);
  await assert.rejects(jobs.createPreview(data), /already pending/i);
  assert.equal(storage.values.has('clockify-migration-preview'), false);
  assert.equal((await jobs.load()).id, id);
});

test('checkpoint survives restart; completion atomically stores outcome and removes source data', async () => {
  const storage = backend(); const jobs = await seeded(storage); await jobs.claim(id, mappings, pin);
  await jobs.checkpoint(id, outcome);
  const resumed = createClockifyMigrationJobService({ backend: storage, now: () => 3_000 });
  assert.deepEqual((await resumed.load()).outcomes, [outcome]);
  await resumed.finish(id);
  assert.equal(storage.values.has(CLOCKIFY_MIGRATION_JOB_KEY), false);
  assert.deepEqual(storage.values.get('clockify-migration-import-outcome-v1'), { id, destinationId: pin.destinationId, users: data.users, outcomes: [outcome] });
});

test('checkpoint cannot skip, overwrite or accept an outcome for a different source', async () => {
  const storage = backend(); const jobs = await seeded(storage); await jobs.claim(id, mappings, pin);
  await assert.rejects(jobs.checkpoint(id, { ...outcome, sourceUserId: 'other' }), /checkpoint/i);
  await jobs.checkpoint(id, outcome);
  await assert.rejects(jobs.checkpoint(id, outcome), /checkpoint/i);
  await assert.rejects(jobs.claim(id, mappings, pin), /already/i);
});

test('failed atomic claim leaves the original preview available and creates no job', async () => {
  const storage = backend();
  const jobs = await seeded(storage);
  const failing = { ...storage, mutateMany: async () => { throw new Error('injected transaction failure'); } };
  await assert.rejects(createClockifyMigrationJobService({ backend: failing, now: () => 3_000 }).claim(id, mappings, pin), /transaction failure/);
  assert.equal(storage.values.has('clockify-migration-preview'), true);
  assert.equal(await jobs.load(), null);
});

test('a blocked mapping can atomically restore a fresh preview without losing source entries', async () => {
  const storage = backend(); const jobs = await seeded(storage); await jobs.claim(id, mappings, pin);
  await jobs.block(id, 'mapping_unresolved');
  const restored = await jobs.restorePreview(id);
  assert.notEqual(restored.id, id);
  assert.equal(await jobs.load(), null);
  assert.deepEqual(storage.values.get('clockify-migration-preview').data, data);
  assert.equal(storage.values.get('clockify-migration-preview').id, restored.id);
  assert.equal(storage.values.get('clockify-migration-preview').expiresAt > 2_000, true);
  assert.equal(storage.values.has('clockify-migration-import-outcome-v1'), false);
});

test('a live job or an existing preview cannot be overwritten by mapping repair', async () => {
  const storage = backend(); const jobs = await seeded(storage); await jobs.claim(id, mappings, pin);
  await assert.rejects(jobs.restorePreview(id), /blocked/i);
  await jobs.block(id, 'mapping_unresolved');
  storage.values.set('clockify-migration-preview', { id: 'existing' });
  await assert.rejects(jobs.restorePreview(id), /preview/i);
  assert.equal((await jobs.load()).id, id);
});

test('migration claim persists the authentication generation without credential material', async () => {
  const storage = backend(); const jobs = await seeded(storage);
  const claimed = await jobs.claim(id, mappings, { ...pin, authGeneration: 3 });
  assert.equal(claimed.pin.authGeneration, 3);
  assert.equal((await jobs.load()).pin.authGeneration, 3);
  await assert.rejects(jobs.claim(id, mappings, { ...pin, authGeneration: -1 }), /identity/i);
});

test('migration job stores only a validated stable GitHub App authorization identifier', async () => {
  const storage = backend(); const jobs = await seeded(storage);
  await assert.rejects(jobs.claim(id, mappings, { ...pin, authCandidateId: 'not-a-device-attempt' }), /identity/i);
  assert.equal(storage.values.has('clockify-migration-preview'), true);
  const claimed = await jobs.claim(id, mappings, { ...pin, authCandidateId: id });
  assert.equal(claimed.pin.authCandidateId, id);
  assert.equal((await createClockifyMigrationJobService({ backend: storage }).load()).pin.authCandidateId, id);
});

test('connection-change repair needs explicit authorization and never discards another preview', async () => {
  const storage = backend(); const jobs = await seeded(storage);
  await jobs.claim(id, mappings, pin);
  await assert.rejects(jobs.restorePreview(id), /blocked/i);
  const restored = await jobs.restorePreview(id, { connectionChanged: true });
  assert.notEqual(restored.id, id);
  assert.equal(await jobs.load(), null);
  assert.equal((await storage.getMany(['clockify-migration-preview']))['clockify-migration-preview'].id, restored.id);
});
