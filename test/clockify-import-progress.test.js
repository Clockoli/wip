import test from 'node:test';
import assert from 'node:assert/strict';
import { importClockifyOrganization } from '../src/services/clockify-organization-import.js';

const sourceUsers = [
  { userId: 'source-a', displayName: 'Private Ada', entryCount: 1 },
  { userId: 'source-b', displayName: 'Private Bob', entryCount: 1 },
];
const mappings = [
  { sourceUserId: 'source-a', githubLogin: 'ada' },
  { sourceUserId: 'source-b', skipped: true },
];
const entries = [
  { userId: 'source-a', entryId: 'raw-a' },
  { userId: 'source-b', entryId: 'raw-b' },
];
const resolved = [
  { sourceUserId: 'source-a', githubUser: { id: 1, login: 'ada' } },
  { sourceUserId: 'source-b', skipped: true },
];

test('reports finite privacy-safe progress and preserves an allowlisted record-write failure reason', async () => {
  const progress = [];
  const result = await importClockifyOrganization({
    sourceUsers, entries, mappings, github: {}, destinationUser: { id: 1, login: 'ada' },
    onProgress: event => progress.push(event), now: () => 1_000,
    resolveMappings: async () => resolved,
    importRecords: async () => ({ status: 'failed', failureReason: 'storage_branch_incomplete' }),
  });

  assert.deepEqual(progress, [
    { stage: 'resolving_identities', completed: 0, total: 2, elapsedMs: 0 },
    { stage: 'resolving_identities', completed: 2, total: 2, elapsedMs: 0 },
    { stage: 'preparing_storage', completed: 0, total: 1, elapsedMs: 0 },
    { stage: 'preparing_storage', completed: 1, total: 1, elapsedMs: 0 },
    { stage: 'writing_records', completed: 0, total: 1, elapsedMs: 0 },
    { stage: 'writing_records', completed: 1, total: 1, elapsedMs: 0 },
    { stage: 'completed', completed: 1, total: 1, elapsedMs: 0 },
  ]);
  assert.deepEqual(result[0], {
    sourceUserId: 'source-a', githubUser: { id: 1, login: 'ada' }, status: 'failed',
    failureReason: 'storage_branch_incomplete',
  });
  assert.doesNotMatch(JSON.stringify(progress), /source-|Private|raw-|clockoli\/users/i);
});
