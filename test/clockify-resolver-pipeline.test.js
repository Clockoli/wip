import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveClockifyMigrationEntries } from '../src/services/clockify-resolver-pipeline.js';

test('adds only a canonical deterministic validated task to the import handoff entry', async () => {
  const entry = {
    provider: 'clockify', entryId: 'clockify-1', project: 'manticoresoftware/clockoli', task: '#13 Create migration plugin',
    description: '', tags: [],
  };
  const result = await resolveClockifyMigrationEntries({
    entries: [entry],
    policy: { workspaceId: 'workspace-1', repositories: [{ organization: 'manticoresoftware', repository: 'clockoli' }] },
    validate: async () => ({
      provider: 'github', organization: 'manticoresoftware', repository: 'clockoli', entityType: 'issue', externalId: '13',
      title: 'Create migration plugin', externalUrl: 'https://github.com/manticoresoftware/clockoli/issues/13',
    }),
  });

  assert.deepEqual(result, [{
    ...entry,
    resolvedIssue: { url: 'https://github.com/manticoresoftware/clockoli/issues/13', title: 'Create migration plugin' },
  }]);
  assert.deepEqual(entry, {
    provider: 'clockify', entryId: 'clockify-1', project: 'manticoresoftware/clockoli', task: '#13 Create migration plugin',
    description: '', tags: [],
  }, 'resolver must not mutate the normalized source snapshot');
});

test('keeps unresolved source entries byte-for-byte unchanged', async () => {
  const entry = { provider: 'clockify', entryId: 'clockify-2', project: 'clockoli', task: '#13', description: '', tags: [] };
  const result = await resolveClockifyMigrationEntries({
    entries: [entry], policy: { workspaceId: 'workspace-1', repositories: [{ organization: 'manticoresoftware', repository: 'clockoli' }] },
    validate: async () => { throw new Error('must not be called for ambiguous evidence'); },
  });
  assert.deepEqual(result, [entry]);
});
