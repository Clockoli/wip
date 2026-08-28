import assert from 'node:assert/strict';
import test from 'node:test';
import {
  discoverUserStorageBranches, ensureUserStorageBranch, parseUserBranchMetadata,
  userStorageBranch, userBranchMetadataText,
} from '../src/services/user-storage-branch.js';
import { parseTaskIndex, TASK_INDEX_PATH } from '../src/domain/task-index.js';

function notFound() { return Object.assign(new Error('missing'), { status: 404 }); }

class BranchClient {
  constructor(network, branch) { this.network = network; this.branch = branch; }
  forBranch(branch) { return new BranchClient(this.network, branch); }
  async ensureBranch(target, source) { this.network.ensureCalls.push({ target, source }); const created = !this.network.branches.has(target); this.network.branches.add(target); return { branch: target, created }; }
  async ensureBranchWithTexts(target, source, changes, message) {
    this.network.ensureCalls.push({ target, source });
    const created = !this.network.branches.has(target);
    if (created) {
      this.network.branches.add(target);
      for (const change of changes) this.network.metadata.set(`${target}:${change.path}`, change.text);
      this.network.atomicWrites.push({ branch: target, changes, message });
    }
    return { branch: target, created };
  }
  async getText(path) {
    const text = this.network.metadata.get(`${this.branch}:${path}`) ?? this.network.metadata.get(this.branch);
    if (!text) throw notFound();
    return { path, sha: 'a'.repeat(40), text };
  }
  async putText(path, text, message) { this.network.metadata.set(`${this.branch}:${path}`, text); this.network.metadata.set(this.branch, text); this.network.writes.push({ branch: this.branch, path, message }); }
  async updateTextsAtomic(changes, message) {
    for (const change of changes) this.network.metadata.set(`${this.branch}:${change.path}`, change.text);
    this.network.atomicWrites.push({ branch: this.branch, changes, message });
    return { blobShas: Object.fromEntries(changes.map(change => [change.path, 'b'.repeat(40)])) };
  }
  async listBranches(prefix) { return [...this.network.branches].filter(branch => branch.startsWith(prefix)); }
}

function network() { return { branches: new Set(['main']), metadata: new Map(), ensureCalls: [], writes: [], atomicWrites: [] }; }

test('each stable GitHub user gets a deterministic non-default storage branch and ownership marker', async () => {
  const state = network(), github = new BranchClient(state, 'main');
  const result = await ensureUserStorageBranch(github, { id: 123, login: 'alice' }, 'main');
  assert.equal(result.branch, 'clockoli/users/123');
  assert.deepEqual(state.ensureCalls, [{ target: 'clockoli/users/123', source: 'main' }]);
  assert.equal(state.writes.length, 0);
  assert.equal(state.atomicWrites.length, 1);
  assert.deepEqual(state.atomicWrites[0].changes.map(change => change.path), ['.clockoli/user.json', TASK_INDEX_PATH]);
  assert.deepEqual(parseUserBranchMetadata(state.metadata.get(`${result.branch}:.clockoli/user.json`)), { id: 123, login: 'alice' });
  assert.deepEqual(parseTaskIndex(state.metadata.get(`${result.branch}:${TASK_INDEX_PATH}`), { user: 'alice' }).tasks, {});
});

test('personal branch is published only with ownership marker and mandatory task index', async () => {
  const state = network(), github = new BranchClient(state, 'main');
  await ensureUserStorageBranch(github, { id: 123, login: 'alice' }, 'main');
  assert.equal(state.branches.has('clockoli/users/123'), true);
  assert.equal(state.metadata.has('clockoli/users/123:.clockoli/user.json'), true);
  assert.equal(state.metadata.has(`clockoli/users/123:${TASK_INDEX_PATH}`), true);
});

test('existing user branch without the mandatory task index fails closed', async () => {
  const state = network(), github = new BranchClient(state, 'main'), branch = userStorageBranch(123);
  state.branches.add(branch);
  state.metadata.set(`${branch}:.clockoli/user.json`, userBranchMetadataText({ id: 123, login: 'alice' }));
  await assert.rejects(() => ensureUserStorageBranch(github, { id: 123, login: 'alice' }, 'main'), /task index/i);
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

test('branch discovery accepts only marker-backed deterministic Clockoli user branches', async () => {
  const state = network(), github = new BranchClient(state, 'main');
  for (const user of [{ id: 2, login: 'bob' }, { id: 1, login: 'alice' }]) {
    const branch = userStorageBranch(user.id); state.branches.add(branch);
    state.metadata.set(branch, `${JSON.stringify({ version: 1, githubUserId: user.id, storageLogin: user.login })}\n`);
  }
  state.branches.add('clockoli/users/999');
  const users = await discoverUserStorageBranches(github);
  assert.deepEqual(users.map(({ id, login, branch }) => ({ id, login, branch })), [
    { id: 1, login: 'alice', branch: 'clockoli/users/1' },
    { id: 2, login: 'bob', branch: 'clockoli/users/2' },
  ]);
});

test('user storage discovery reads independent branch metadata concurrently', async () => {
  const branches = ['clockoli/users/1', 'clockoli/users/2', 'clockoli/users/3'];
  let active = 0, maxActive = 0;
  const github = {
    listBranches: async () => branches,
    forBranch: branch => ({
      getText: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise(resolve => setTimeout(resolve, 20));
        active -= 1;
        const id = Number(branch.split('/').at(-1));
        return { text: JSON.stringify({ version: 1, githubUserId: id, storageLogin: `user-${id}` }) };
      },
    }),
  };

  const users = await discoverUserStorageBranches(github, { concurrency: 2 });

  assert.equal(users.length, 3);
  assert.equal(maxActive, 2, 'metadata reads must be concurrent without exceeding the configured cap');
});
