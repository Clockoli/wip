import assert from 'node:assert/strict';
import test from 'node:test';
import { provisionClockifyUserBranches } from '../src/services/clockify-user-branch-provisioning.js';

const sourceUsers = [
  { userId: 'clockify-b', displayName: 'Bob', entryCount: 2 },
  { userId: 'clockify-a', displayName: 'Alice', entryCount: 1 },
  { userId: 'clockify-c', displayName: 'Cara', entryCount: 3 },
];

const mappings = [
  { sourceUserId: 'clockify-a', githubUser: { id: 11, login: 'alice' } },
  { sourceUserId: 'clockify-b', githubUser: { id: 22, login: 'bob' } },
  { sourceUserId: 'clockify-c', githubUser: { id: 33, login: 'cara' } },
];

test('provisions verified mappings once each in source roster order and reports deterministic branches', async () => {
  const github = { branch: 'main' };
  const calls = [];
  const outcomes = await provisionClockifyUserBranches({
    sourceUsers,
    mappings,
    github,
    sourceBranch: 'imports/clockify',
    provisioner: async (...args) => {
      calls.push(args);
      return { branch: `clockoli/users/${args[1].id}` };
    },
  });

  assert.deepEqual(calls, [
    [github, { id: 22, login: 'bob' }, 'imports/clockify'],
    [github, { id: 11, login: 'alice' }, 'imports/clockify'],
    [github, { id: 33, login: 'cara' }, 'imports/clockify'],
  ]);
  assert.deepEqual(outcomes, [
    { sourceUserId: 'clockify-b', githubUser: { id: 22, login: 'bob' }, status: 'provisioned', branch: 'clockoli/users/22' },
    { sourceUserId: 'clockify-a', githubUser: { id: 11, login: 'alice' }, status: 'provisioned', branch: 'clockoli/users/11' },
    { sourceUserId: 'clockify-c', githubUser: { id: 33, login: 'cara' }, status: 'provisioned', branch: 'clockoli/users/33' },
  ]);
});

test('provisions sequentially and continues with visible safe failures', async () => {
  let active = 0;
  let maxActive = 0;
  const calls = [];
  const outcomes = await provisionClockifyUserBranches({
    sourceUsers,
    mappings,
    github: {},
    sourceBranch: 'main',
    provisioner: async (_github, user) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      calls.push(user.id);
      await new Promise(resolve => setTimeout(resolve, 10));
      active -= 1;
      if (user.id === 11) throw Object.assign(new Error('provider token and response details'), { code: 'github_rate_limited' });
      return { branch: `clockoli/users/${user.id}` };
    },
  });

  assert.equal(maxActive, 1);
  assert.deepEqual(calls, [22, 11, 33]);
  assert.deepEqual(outcomes, [
    { sourceUserId: 'clockify-b', githubUser: { id: 22, login: 'bob' }, status: 'provisioned', branch: 'clockoli/users/22' },
    {
      sourceUserId: 'clockify-a', githubUser: { id: 11, login: 'alice' }, status: 'failed',
      error: { message: 'Could not prepare this user\'s Clockoli storage branch.', reason: 'github_rate_limited' },
    },
    { sourceUserId: 'clockify-c', githubUser: { id: 33, login: 'cara' }, status: 'provisioned', branch: 'clockoli/users/33' },
  ]);
});

test('fails a single outcome closed when a provisioner returns the wrong branch', async () => {
  const outcomes = await provisionClockifyUserBranches({
    sourceUsers,
    mappings,
    github: {},
    sourceBranch: 'main',
    provisioner: async (_github, user) => ({ branch: user.id === 11 ? 'main' : `clockoli/users/${user.id}` }),
  });

  assert.deepEqual(outcomes[1], {
    sourceUserId: 'clockify-a', githubUser: { id: 11, login: 'alice' }, status: 'failed',
    error: { message: 'Could not prepare this user\'s Clockoli storage branch.', reason: 'storage_branch_unavailable' },
  });
  assert.equal(outcomes[2].status, 'provisioned');
});

test('revalidates the full mapping against the source roster before any provisioner write', async () => {
  let calls = 0;
  await assert.rejects(() => provisionClockifyUserBranches({
    sourceUsers,
    mappings: mappings.slice(0, 2),
    github: {},
    sourceBranch: 'main',
    provisioner: async () => { calls += 1; },
  }), /missing source user mapping/i);
  assert.equal(calls, 0);
});

test('rejects invalid source branches before any provisioner write', async () => {
  let calls = 0;
  await assert.rejects(() => provisionClockifyUserBranches({
    sourceUsers,
    mappings,
    github: {},
    sourceBranch: ' main ',
    provisioner: async () => { calls += 1; },
  }), /invalid branch name/i);
  assert.equal(calls, 0);
});
