import test from 'node:test';
import assert from 'node:assert/strict';
import { importClockifyOrganization } from '../src/services/clockify-organization-import.js';

const sourceUsers = [
  { userId: 'source-a', displayName: 'Private Ada', entryCount: 1 },
  { userId: 'source-b', displayName: 'Private Bob', entryCount: 1 },
];
const mappings = [
  { sourceUserId: 'source-a', githubLogin: 'ada' },
  { sourceUserId: 'source-b', githubLogin: 'bob' },
];
const entries = [
  { userId: 'source-a', entryId: 'raw-a' },
  { userId: 'source-b', entryId: 'raw-b' },
];
const resolved = [
  { sourceUserId: 'source-a', githubUser: { id: 1, login: 'ada' } },
  { sourceUserId: 'source-b', githubUser: { id: 2, login: 'bob' } },
];

test('reports finite privacy-safe progress and preserves an allowlisted record-write failure reason', async () => {
  const progress = [];
  const result = await importClockifyOrganization({
    sourceUsers, entries, mappings, github: {}, sourceBranch: 'main',
    onProgress: event => progress.push(event),
    resolveMappings: async () => resolved,
    provisionBranches: async () => resolved.map(mapping => ({
      ...mapping, status: 'provisioned', branch: `clockoli/users/${mapping.githubUser.id}`,
    })),
    importRecords: async ({ githubUser }) => githubUser.id === 1
      ? { status: 'failed', failureReason: 'storage_branch_incomplete' }
      : { status: 'already_present', added: 0, alreadyPresent: 1 },
  });

  assert.deepEqual(progress, [
    { stage: 'resolving_identities', completed: 0, total: 2 },
    { stage: 'resolving_identities', completed: 2, total: 2 },
    { stage: 'preparing_storage', completed: 0, total: 2 },
    { stage: 'preparing_storage', completed: 2, total: 2 },
    { stage: 'writing_records', completed: 0, total: 2 },
    { stage: 'writing_records', completed: 1, total: 2 },
    { stage: 'writing_records', completed: 2, total: 2 },
    { stage: 'completed', completed: 2, total: 2 },
  ]);
  assert.deepEqual(result[0], {
    sourceUserId: 'source-a', githubUser: { id: 1, login: 'ada' }, status: 'failed',
    failureReason: 'storage_branch_incomplete',
  });
  assert.doesNotMatch(JSON.stringify(progress), /source-|Private|raw-|clockoli\/users/i);
});
