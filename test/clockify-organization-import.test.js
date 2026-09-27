import test from 'node:test';
import assert from 'node:assert/strict';
import { importClockifyOrganization } from '../src/services/clockify-organization-import.js';

const destinationUser = { id: 42, login: 'ada' };
const sourceUsers = [
  { userId: 'clockify-ada', displayName: 'Ada', entryCount: 2 },
  { userId: 'clockify-skip', displayName: 'Skip', entryCount: 1 },
];
const entries = [
  { userId: 'clockify-ada', entryId: 'ada-1' },
  { userId: 'clockify-ada', entryId: 'ada-2' },
  { userId: 'clockify-skip', entryId: 'skip-1' },
];
const mappings = [
  { sourceUserId: 'clockify-ada', githubLogin: 'ada' },
  { sourceUserId: 'clockify-skip', skipped: true },
];

function dependencies({ resolved = [
  { sourceUserId: 'clockify-ada', githubUser: destinationUser },
  { sourceUserId: 'clockify-skip', skipped: true },
], imported = { status: 'imported', added: 2, alreadyPresent: 0 } } = {}) {
  const calls = { resolve: 0, imports: [] };
  return {
    calls,
    resolveMappings: async input => {
      calls.resolve += 1;
      assert.deepEqual(input, { sourceUsers, mappings, github: input.github });
      return resolved;
    },
    importRecords: async input => {
      calls.imports.push(input);
      return imported;
    },
  };
}

test('imports the selected Clockify user into the already configured Clockoli writer branch', async () => {
  const github = { branch: 'clockoli/users/42' };
  const deps = dependencies();
  const result = await importClockifyOrganization({ sourceUsers, entries, mappings, github, destinationUser, ...deps });

  assert.equal(deps.calls.resolve, 1);
  assert.deepEqual(deps.calls.imports, [{
    github,
    githubUser: destinationUser,
    entries: entries.slice(0, 2),
  }]);
  assert.deepEqual(result, [{
    sourceUserId: 'clockify-ada', githubUser: destinationUser, status: 'imported', added: 2, alreadyPresent: 0,
  }]);
});

test('rejects selected mappings to another user instead of creating or writing a different branch', async () => {
  const deps = dependencies({ resolved: [
    { sourceUserId: 'clockify-ada', githubUser: { id: 9, login: 'other' } },
    { sourceUserId: 'clockify-skip', skipped: true },
  ] });
  await assert.rejects(() => importClockifyOrganization({
    sourceUsers, entries, mappings, github: {}, destinationUser, ...deps,
  }), /configured Clockoli user/i);
  assert.deepEqual(deps.calls.imports, []);
});

test('does not invoke GitHub resolution or write records for malformed source association data', async () => {
  const deps = dependencies();
  await assert.rejects(() => importClockifyOrganization({
    sourceUsers, entries: entries.slice(1), mappings, github: {}, destinationUser, ...deps,
  }), /entry.*count/i);
  assert.equal(deps.calls.resolve, 0);
  assert.deepEqual(deps.calls.imports, []);
});

test('keeps importer failures privacy-safe in the migration result', async () => {
  const deps = dependencies({ imported: { status: 'failed', failureReason: 'github_write_permission', providerDetail: 'must not escape' } });
  const result = await importClockifyOrganization({ sourceUsers, entries, mappings, github: {}, destinationUser, ...deps });
  assert.deepEqual(result, [{
    sourceUserId: 'clockify-ada', githubUser: destinationUser, status: 'failed', failureReason: 'github_write_permission',
  }]);
  assert.equal(JSON.stringify(result).includes('providerDetail'), false);
});
