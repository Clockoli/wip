import test from 'node:test';
import assert from 'node:assert/strict';
import { importClockifyOrganization } from '../src/services/clockify-organization-import.js';
import { emptyTaskIndex, serializeTaskIndex } from '../src/domain/task-index.js';
import { userBranchMetadataText } from '../src/services/user-storage-branch.js';

const actor = { id: 42, login: 'ada' }, newcomer = { id: 9, login: 'other' };

test('a mapped noncollaborator without a personal branch is provisioned on the configured repository before import', async () => {
  let exists = false;
  const calls = [];
  const github = {
    owner: 'acme', repo: 'times', expectedRepositoryId: 123, branch: 'clockoli/users/42',
    async ensureBranchWithTexts(branch, source, changes) {
      calls.push(['provision', branch, source, changes.map(item => item.path)]);
      exists = true;
      return { branch, created: true };
    },
    forBranch(branch) {
      return {
        owner: 'acme', repo: 'times', expectedRepositoryId: 123, branch,
        assertDestinationReachable: async () => {},
        getText: async path => {
          if (!exists) throw Object.assign(new Error('not found'), { status: 404 });
          return { text: path === '.clockoli/user.json' ? userBranchMetadataText(newcomer)
            : serializeTaskIndex(emptyTaskIndex(newcomer.login)) };
        },
      };
    },
  };
  const outcomes = await importClockifyOrganization({
    sourceUsers: [{ userId: 'clockify-other', displayName: 'Other', entryCount: 1 }],
    entries: [{ userId: 'clockify-other', entryId: 'other-1' }], mappings: [{ sourceUserId: 'clockify-other', githubLogin: 'other' }],
    github, destinationUser: actor, sourceBranch: 'main',
    resolveMappings: async () => [{ sourceUserId: 'clockify-other', githubUser: newcomer }],
    importRecords: async ({ github: target, githubUser }) => {
      calls.push(['import', target.branch, githubUser.id]);
      return { status: 'imported', added: 1, alreadyPresent: 0 };
    },
  });
  assert.deepEqual(outcomes.map(item => item.status), ['imported']);
  assert.deepEqual(calls, [
    ['provision', 'clockoli/users/9', 'main', ['.clockoli/user.json', '.clockoli/tasks.json']],
    ['import', 'clockoli/users/9', 9],
  ]);
});
