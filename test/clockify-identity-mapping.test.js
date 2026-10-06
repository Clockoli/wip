import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveClockifyUserMappings } from '../src/services/clockify-identity-mapping.js';

const sourceUsers = [
  { userId: 'clockify-ada', displayName: 'Ada Lovelace', entryCount: 4 },
  { userId: 'clockify-lin', displayName: 'Lin Torres', entryCount: 2 },
];

const mappings = [
  { sourceUserId: 'clockify-lin', githubLogin: 'lin-torres' },
  { sourceUserId: 'clockify-ada', githubLogin: 'Ada-Lovelace' },
];

function clone(value) { return structuredClone(value); }

function githubStub(identities) {
  const calls = [];
  return {
    calls,
    github: {
      async getUserIdentity(login) {
        calls.push(login);
        return identities[login];
      },
    },
  };
}

test('resolves exact GitHub logins once and returns the verified mapping in source-roster order', async () => {
  const { github, calls } = githubStub({
    'lin-torres': { id: 42, login: 'lin-torres' },
    'Ada-Lovelace': { id: 7, login: 'ada-lovelace' },
  });

  const result = await resolveClockifyUserMappings({ sourceUsers, mappings, github });

  assert.deepEqual(calls, ['lin-torres', 'Ada-Lovelace']);
  assert.deepEqual(result, [
    { sourceUserId: 'clockify-ada', githubUser: { id: 7, login: 'ada-lovelace' } },
    { sourceUserId: 'clockify-lin', githubUser: { id: 42, login: 'lin-torres' } },
  ]);
});

test('resume reuses checkpointed GitHub IDs without looking up an old login', async () => {
  const { github, calls } = githubStub({ 'lin-torres': { id: 42, login: 'lin-torres' } });
  const result = await resolveClockifyUserMappings({ sourceUsers, mappings, github,
    completedOutcomes: [{ sourceUserId: 'clockify-ada', githubUser: { id: 7, login: 'ada-lovelace' }, status: 'imported' }] });
  assert.deepEqual(calls, ['lin-torres']);
  assert.equal(result[0].githubUser.id, 7);
});

test('renamed pending GitHub login must be repaired before writing, not rejected at checkpoint', async () => {
  const { github } = githubStub({
    'lin-torres': { id: 42, login: 'new-lin-login' },
    'Ada-Lovelace': { id: 7, login: 'ada-lovelace' },
  });
  await assert.rejects(resolveClockifyUserMappings({ sourceUsers, mappings, github }), /mapping|login/i);
});

test('rejects untrusted mapping fields, credentials, prototypes, and accessors before GitHub resolution', async () => {
  const cases = [
    [{ sourceUserId: 'clockify-lin', githubLogin: 'lin-torres', githubUser: { id: 42 } }, mappings[1]],
    [{ sourceUserId: 'clockify-lin', githubLogin: 'lin-torres', displayName: 'Lin Torres' }, mappings[1]],
    [{ sourceUserId: 'clockify-lin', githubLogin: 'lin-torres', email: 'lin@example.test' }, mappings[1]],
    [{ sourceUserId: 'clockify-lin', githubLogin: 'lin-torres', token: 'secret' }, mappings[1]],
  ];
  for (const value of cases) {
    const { github, calls } = githubStub({});
    await assert.rejects(() => resolveClockifyUserMappings({ sourceUsers, mappings: value, github }), /invalid|unknown|credential/i);
    assert.deepEqual(calls, []);
  }

  const nonPlain = Object.assign(Object.create(null), mappings[0]);
  const { github: prototypeGithub, calls: prototypeCalls } = githubStub({});
  await assert.rejects(() => resolveClockifyUserMappings({ sourceUsers, mappings: [nonPlain, mappings[1]], github: prototypeGithub }), /mapping.*object/i);
  assert.deepEqual(prototypeCalls, []);

  const accessor = clone(mappings[0]);
  Object.defineProperty(accessor, 'githubLogin', { enumerable: true, get() { return 'lin-torres'; } });
  const { github: accessorGithub, calls: accessorCalls } = githubStub({});
  await assert.rejects(() => resolveClockifyUserMappings({ sourceUsers, mappings: [accessor, mappings[1]], github: accessorGithub }), /mapping.*data/i);
  assert.deepEqual(accessorCalls, []);

  const accessorArray = [...mappings];
  let getterCalls = 0;
  Object.defineProperty(accessorArray, '0', { enumerable: true, get() { getterCalls += 1; return mappings[0]; } });
  const { github: arrayGithub, calls: arrayCalls } = githubStub({});
  await assert.rejects(() => resolveClockifyUserMappings({ sourceUsers, mappings: accessorArray, github: arrayGithub }), /mappings.*data/i);
  assert.equal(getterCalls, 0);
  assert.deepEqual(arrayCalls, []);
});

test('validates complete exact source IDs and login syntax before GitHub resolution', async () => {
  for (const value of [
    [mappings[0]],
    [mappings[0], { sourceUserId: 'unknown', githubLogin: 'unknown-user' }],
    [mappings[0], { sourceUserId: 'clockify-lin', githubLogin: 'other-user' }],
    [{ sourceUserId: 'clockify-lin', githubLogin: 'invalid/login' }, mappings[1]],
  ]) {
    const { github, calls } = githubStub({});
    await assert.rejects(() => resolveClockifyUserMappings({ sourceUsers, mappings: value, github }), /missing|unknown|duplicate|GitHub login/i);
    assert.deepEqual(calls, []);
  }
});

test('rejects case-insensitively duplicate requested GitHub logins before resolution', async () => {
  const { github, calls } = githubStub({
    'lin-torres': { id: 42, login: 'lin-torres' },
    'LIN-TORRES': { id: 42, login: 'lin-torres' },
  });
  await assert.rejects(() => resolveClockifyUserMappings({
    sourceUsers,
    mappings: [mappings[0], { sourceUserId: 'clockify-ada', githubLogin: 'LIN-TORRES' }],
    github,
  }), /duplicate.*GitHub.*login/i);
  assert.deepEqual(calls, []);
});

test('propagates GitHub errors unchanged and rejects verified duplicate identities', async () => {
  const blocker = new Error('GitHub user was not found');
  const missing = { getUserIdentity: async () => { throw blocker; } };
  await assert.rejects(
    () => resolveClockifyUserMappings({ sourceUsers, mappings, github: missing }),
    error => error === blocker,
  );

  const { github } = githubStub({
    'lin-torres': { id: 7, login: 'lin-torres' },
    'Ada-Lovelace': { id: 7, login: 'ada-lovelace' },
  });
  await assert.rejects(
    () => resolveClockifyUserMappings({ sourceUsers, mappings, github }),
    /duplicate.*GitHub.*ID/i,
  );
});
