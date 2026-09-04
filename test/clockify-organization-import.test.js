import test from 'node:test';
import assert from 'node:assert/strict';
import { importClockifyOrganization } from '../src/services/clockify-organization-import.js';

const sourceUsers = [
  { userId: 'source-b', displayName: 'Private Bob', entryCount: 2 },
  { userId: 'source-a', displayName: 'Private Ada', entryCount: 1 },
  { userId: 'source-c', displayName: 'Private Cara', entryCount: 1 },
];
const mappings = [
  { sourceUserId: 'source-a', githubLogin: 'ada' },
  { sourceUserId: 'source-b', githubLogin: 'bob' },
  { sourceUserId: 'source-c', githubLogin: 'cara' },
];
const entries = [
  { userId: 'source-b', entryId: 'raw-b-1', description: 'Bob private description' },
  { userId: 'source-a', entryId: 'raw-a-1', description: 'Ada private description' },
  { userId: 'source-b', entryId: 'raw-b-2', description: 'Bob private description two' },
  { userId: 'source-c', entryId: 'raw-c-1', description: 'Cara private description' },
];
const resolved = [
  { sourceUserId: 'source-b', githubUser: { id: 2, login: 'bob' } },
  { sourceUserId: 'source-a', githubUser: { id: 1, login: 'ada' } },
  { sourceUserId: 'source-c', githubUser: { id: 3, login: 'cara' } },
];

function dependencies({ provisionOutcomes, importOutcomes } = {}) {
  const calls = { resolve: 0, provision: 0, imports: [] };
  return {
    calls,
    resolveMappings: async input => {
      calls.resolve += 1;
      assert.deepEqual(input, { sourceUsers, mappings, github: input.github });
      return resolved;
    },
    provisionBranches: async input => {
      calls.provision += 1;
      assert.deepEqual(input.mappings, resolved);
      return provisionOutcomes ?? [
        { ...resolved[0], status: 'provisioned', branch: 'clockoli/users/2' },
        { ...resolved[1], status: 'provisioned', branch: 'clockoli/users/1' },
        { ...resolved[2], status: 'provisioned', branch: 'clockoli/users/3' },
      ];
    },
    importRecords: async input => {
      calls.imports.push(input);
      return importOutcomes?.[input.githubUser.id] ?? { status: 'imported', added: input.entries.length, alreadyPresent: 0 };
    },
  };
}

test('resolves all explicit identities, provisions roster-ordered users, then imports exact per-user entry subsets sequentially', async () => {
  const deps = dependencies({
    provisionOutcomes: [
      { ...resolved[0], status: 'provisioned', branch: 'clockoli/users/2' },
      { ...resolved[1], status: 'failed', error: { message: 'provider secret: no', reason: 'github_permission' } },
      { ...resolved[2], status: 'provisioned', branch: 'clockoli/users/3' },
    ],
    importOutcomes: {
      2: { status: 'imported', added: 2, alreadyPresent: 0, raw: 'must not escape' },
      3: { status: 'conflict', providerMessage: 'must not escape' },
    },
  });

  const result = await importClockifyOrganization({
    sourceUsers, entries, mappings, github: { marker: 'github' }, sourceBranch: 'main',
    ...deps,
  });

  assert.equal(deps.calls.resolve, 1);
  assert.equal(deps.calls.provision, 1);
  assert.deepEqual(deps.calls.imports.map(call => ({ user: call.githubUser, entryIds: call.entries.map(entry => entry.entryId) })), [
    { user: { id: 2, login: 'bob' }, entryIds: ['raw-b-1', 'raw-b-2'] },
    { user: { id: 3, login: 'cara' }, entryIds: ['raw-c-1'] },
  ]);
  assert.deepEqual(result, [
    { sourceUserId: 'source-b', githubUser: { id: 2, login: 'bob' }, status: 'imported', added: 2, alreadyPresent: 0 },
    {
      sourceUserId: 'source-a', githubUser: { id: 1, login: 'ada' }, status: 'failed',
      failureReason: 'github_permission',
      error: { message: "Could not prepare this user's Clockoli storage branch.", reason: 'github_permission' },
    },
    { sourceUserId: 'source-c', githubUser: { id: 3, login: 'cara' }, status: 'conflict' },
  ]);
  const serialized = JSON.stringify(result);
  for (const forbidden of ['Private', 'raw-', 'description', 'provider secret', 'must not escape', 'clockoli/users']) {
    assert.equal(serialized.includes(forbidden), false, `result leaked ${forbidden}`);
  }
});

test('preserves allowlisted importer write failures for the preview', async () => {
  const deps = dependencies({
    importOutcomes: {
      1: { status: 'failed', failureReason: 'github_write_rejected' },
      2: { status: 'failed', failureReason: 'github_write_permission' },
      3: { status: 'failed', failureReason: 'github_write_rate_limited' },
    },
  });
  const result = await importClockifyOrganization({ sourceUsers, entries, mappings, github: {}, sourceBranch: 'main', ...deps });
  assert.deepEqual(result.map(outcome => outcome.failureReason), [
    'github_write_permission', 'github_write_rejected', 'github_write_rate_limited',
  ]);
});

test('fails the complete operation before provision/import when identity resolution fails', async () => {
  const deps = dependencies();
  deps.resolveMappings = async () => { throw new Error('GitHub API response: login ada not found; token omitted'); };

  await assert.rejects(() => importClockifyOrganization({ sourceUsers, entries, mappings, github: {}, sourceBranch: 'main', ...deps }), /Could not resolve all mapped GitHub users/i);
  assert.equal(deps.calls.provision, 0);
  assert.deepEqual(deps.calls.imports, []);
});

test('validates every entry has a roster user and exact roster count before any remote action', async () => {
  for (const invalidEntries of [
    [...entries, { userId: 'unknown', entryId: 'private' }],
    entries.slice(1),
  ]) {
    const deps = dependencies();
    await assert.rejects(() => importClockifyOrganization({ sourceUsers, entries: invalidEntries, mappings, github: {}, sourceBranch: 'main', ...deps }), /entry.*roster|entry.*count/i);
    assert.equal(deps.calls.resolve, 0);
    assert.equal(deps.calls.provision, 0);
    assert.deepEqual(deps.calls.imports, []);
  }
});

test('rejects a zero-count roster before any remote collaborator is called', async () => {
  const zeroRoster = [{ userId: 'source-a', displayName: 'Private Ada', entryCount: 0 }];
  const zeroMappings = [{ sourceUserId: 'source-a', githubLogin: 'ada' }];
  const calls = { resolve: 0, provision: 0, imports: 0 };
  await assert.rejects(() => importClockifyOrganization({
    sourceUsers: zeroRoster, entries: [], mappings: zeroMappings, github: {}, sourceBranch: 'main',
    resolveMappings: async () => { calls.resolve += 1; },
    provisionBranches: async () => { calls.provision += 1; },
    importRecords: async () => { calls.imports += 1; },
  }), /source roster entry count/i);
  assert.deepEqual(calls, { resolve: 0, provision: 0, imports: 0 });
});

test('uses a pre-await deep snapshot when a delayed resolver races mutations of source records', async () => {
  let release;
  const resolverStarted = new Promise(resolve => { release = resolve; });
  const imports = [];
  const operation = importClockifyOrganization({
    sourceUsers, entries, mappings, github: {}, sourceBranch: 'main',
    resolveMappings: async input => {
      assert.notEqual(input.sourceUsers, sourceUsers);
      await resolverStarted;
      return resolved;
    },
    provisionBranches: async () => resolved.map(mapping => ({ ...mapping, status: 'provisioned', branch: `clockoli/users/${mapping.githubUser.id}` })),
    importRecords: async input => { imports.push(input); return { status: 'imported', added: input.entries.length, alreadyPresent: 0 }; },
  });
  sourceUsers[0].userId = 'attacker-user';
  entries[0].userId = 'attacker-user';
  entries[0].entryId = 'attacker-entry';
  release();
  await operation;
  assert.deepEqual(imports.map(input => input.entries.map(entry => ({ userId: entry.userId, entryId: entry.entryId }))), [
    [{ userId: 'source-b', entryId: 'raw-b-1' }, { userId: 'source-b', entryId: 'raw-b-2' }],
    [{ userId: 'source-a', entryId: 'raw-a-1' }],
    [{ userId: 'source-c', entryId: 'raw-c-1' }],
  ]);
  // Restore module-level fixtures for any later test execution ordering.
  sourceUsers[0].userId = 'source-b';
  entries[0].userId = 'source-b';
  entries[0].entryId = 'raw-b-1';
});

test('rejects reordered malicious resolver mappings with extra fields before provisioning', async () => {
  let provisioned = 0;
  let imported = 0;
  await assert.rejects(() => importClockifyOrganization({
    sourceUsers, entries, mappings, github: {}, sourceBranch: 'main',
    resolveMappings: async () => [
      { ...resolved[2], untrusted: true },
      resolved[0],
      resolved[1],
    ],
    provisionBranches: async () => { provisioned += 1; },
    importRecords: async () => { imported += 1; },
  }), /Could not resolve all mapped GitHub users/i);
  assert.equal(provisioned, 0);
  assert.equal(imported, 0);
});

test('does not import a user when its provision outcome has the wrong storage branch', async () => {
  const deps = dependencies({
    provisionOutcomes: [
      { ...resolved[0], status: 'provisioned', branch: 'clockoli/users/999' },
      { ...resolved[1], status: 'provisioned', branch: 'clockoli/users/1' },
      { ...resolved[2], status: 'provisioned', branch: 'clockoli/users/3' },
    ],
  });
  const result = await importClockifyOrganization({ sourceUsers, entries, mappings, github: {}, sourceBranch: 'main', ...deps });
  assert.deepEqual(deps.calls.imports.map(call => call.githubUser.login), ['ada', 'cara']);
  assert.equal(result[0].status, 'failed');
  assert.equal(result[0].error.message, "Could not prepare this user's Clockoli storage branch.");
});
