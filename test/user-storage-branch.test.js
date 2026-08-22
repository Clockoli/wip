import assert from 'node:assert/strict';
import test from 'node:test';
import {
  discoverUserStorageBranches, ensureUserStorageBranch, parseUserBranchMetadata,
  userStorageBranch,
} from '../src/services/user-storage-branch.js';

function notFound() { return Object.assign(new Error('missing'), { status: 404 }); }

class BranchClient {
  constructor(network, branch) { this.network = network; this.branch = branch; }
  forBranch(branch) { return new BranchClient(this.network, branch); }
  async ensureBranch(target, source) { this.network.ensureCalls.push({ target, source }); const created = !this.network.branches.has(target); this.network.branches.add(target); return { branch: target, created }; }
  async getText(path) {
    const text = this.network.metadata.get(this.branch);
    if (!text) throw notFound();
    return { path, sha: 'a'.repeat(40), text };
  }
  async putText(_path, text, message) { this.network.metadata.set(this.branch, text); this.network.writes.push({ branch: this.branch, message }); }
  async listBranches(prefix) { return [...this.network.branches].filter(branch => branch.startsWith(prefix)); }
}

function network() { return { branches: new Set(['main']), metadata: new Map(), ensureCalls: [], writes: [] }; }

test('each stable GitHub user gets a deterministic non-default storage branch and ownership marker', async () => {
  const state = network(), github = new BranchClient(state, 'main');
  const result = await ensureUserStorageBranch(github, { id: 123, login: 'alice' }, 'main');
  assert.equal(result.branch, 'repoclock/users/123');
  assert.deepEqual(state.ensureCalls, [{ target: 'repoclock/users/123', source: 'main' }]);
  assert.equal(state.writes.length, 1);
  assert.deepEqual(parseUserBranchMetadata(state.metadata.get(result.branch)), { id: 123, login: 'alice' });
});

test('existing user branch without ownership metadata fails closed', async () => {
  const state = network(), github = new BranchClient(state, 'main'), branch = userStorageBranch(123);
  state.branches.add(branch);
  await assert.rejects(() => ensureUserStorageBranch(github, { id: 123, login: 'alice' }, 'main'), /ownership metadata/i);
  assert.equal(state.writes.length, 0);
});

test('existing user branch fails closed when stable ownership metadata identifies another user', async () => {
  const state = network(), github = new BranchClient(state, 'main'), branch = userStorageBranch(123);
  state.branches.add(branch); state.metadata.set(branch, JSON.stringify({ version: 1, githubUserId: 456, storageLogin: 'bob' }));
  await assert.rejects(() => ensureUserStorageBranch(github, { id: 123, login: 'alice' }, 'main'), /different GitHub account/i);
});

test('branch discovery accepts only marker-backed deterministic RepoClock user branches', async () => {
  const state = network(), github = new BranchClient(state, 'main');
  for (const user of [{ id: 2, login: 'bob' }, { id: 1, login: 'alice' }]) {
    const branch = userStorageBranch(user.id); state.branches.add(branch);
    state.metadata.set(branch, `${JSON.stringify({ version: 1, githubUserId: user.id, storageLogin: user.login })}\n`);
  }
  state.branches.add('repoclock/users/999');
  const users = await discoverUserStorageBranches(github);
  assert.deepEqual(users.map(({ id, login, branch }) => ({ id, login, branch })), [
    { id: 1, login: 'alice', branch: 'repoclock/users/1' },
    { id: 2, login: 'bob', branch: 'repoclock/users/2' },
  ]);
});
