import test from 'node:test';
import assert from 'node:assert/strict';
import { readyRepositoryMemberIds } from '../src/services/repository-team-status.js';

const marker = {
  repositoryFormatVersion: 1,
  createdAt: '2026-11-09T10:00:00.000Z',
  createdBy: { id: 1, login: 'alice' },
  users: { 1: 'alice', 2: 'bob', 3: 'charlie' },
};
function fixture({ missingIndex = false, wrongOwner = false, invalidMarker = false } = {}) {
  const calls = [];
  const github = {
    forBranch(branch) {
      return { getText: async path => {
        calls.push([branch, path]);
        if (branch === 'main' && path === '.clockoli/config.json') {
          return { text: invalidMarker ? '{}' : JSON.stringify(marker) };
        }
        if (branch === 'clockoli/users/2' && path === '.clockoli/user.json') {
          return { text: JSON.stringify({ version: 1, githubUserId: wrongOwner ? 9 : 2, storageLogin: 'bob' }) };
        }
        if (branch === 'clockoli/users/2' && path === '.clockoli/tasks.json') {
          if (missingIndex) throw Object.assign(new Error('Not found'), { status: 404 });
          return { text: JSON.stringify({ version: 1, storageLogin: 'bob', tasks: {} }) };
        }
        throw new Error(`Unexpected branch read ${branch}: ${path}`);
      } };
    },
    async listBranches() { throw new Error('Member readiness must not enumerate the entire repository branch list'); },
  };
  return { github, calls };
}

test('only a mapped GitHub collaborator with verified branch ownership and index is storage ready', async () => {
  const { github } = fixture();
  const ready = await readyRepositoryMemberIds(github, 'main', [
    { id: 2, login: 'Bob' }, { id: 3, login: 'charlie' }, { id: 4, login: 'other' },
  ]);
  assert.deepEqual(ready, [2]);
});

test('malformed markers, foreign branch ownership and missing indexes never show storage ready', async () => {
  for (const option of [{ invalidMarker: true }, { wrongOwner: true }, { missingIndex: true }]) {
    const { github } = fixture(option);
    assert.deepEqual(await readyRepositoryMemberIds(github, 'main', [{ id: 2, login: 'bob' }]), []);
  }
});

test('missing repository context never triggers a remote storage check', async () => {
  const { github, calls } = fixture();
  assert.deepEqual(await readyRepositoryMemberIds(github, '', [{ id: 2, login: 'bob' }]), []);
  assert.deepEqual(await readyRepositoryMemberIds(github, 'main', []), []);
  assert.deepEqual(calls, []);
});

test('renamed GitHub accounts keep storage readiness through their stable ID and stored login', async () => {
  const { github } = fixture();
  assert.deepEqual(await readyRepositoryMemberIds(github, 'main', [{ id: 2, login: 'renamed-bob' }]), [2]);
});
