import test from 'node:test';
import assert from 'node:assert/strict';
import { validateClockifyUserMapping } from '../src/addons/clockify/user-mapping.js';

const sourceUsers = [
  { userId: 'clockify-ada', displayName: 'Ada Lovelace', entryCount: 4 },
  { userId: 'clockify-lin', displayName: 'Lin Torres', entryCount: 2 },
];

const mappings = [
  { sourceUserId: 'clockify-lin', githubUser: { id: 42, login: 'lin-torres' } },
  { sourceUserId: 'clockify-ada', githubUser: { id: 7, login: 'Ada-Lovelace' } },
];

function clone(value) { return structuredClone(value); }

test('returns a complete explicit Clockify-to-GitHub mapping in roster order without source display names', () => {
  assert.deepEqual(validateClockifyUserMapping(sourceUsers, mappings), [
    { sourceUserId: 'clockify-ada', githubUser: { id: 7, login: 'Ada-Lovelace' } },
    { sourceUserId: 'clockify-lin', githubUser: { id: 42, login: 'lin-torres' } },
  ]);
});

test('requires exactly one mapping for every known source user', () => {
  for (const [value, expected] of [
    [[mappings[0]], /missing.*mapping/i],
    [[...mappings, { sourceUserId: 'unknown', githubUser: { id: 99, login: 'unknown-user' } }], /unknown.*source/i],
    [[mappings[0], { sourceUserId: 'clockify-lin', githubUser: { id: 99, login: 'another-user' } }], /duplicate.*source/i],
    [[...mappings, mappings[0]], /duplicate.*source/i],
  ]) assert.throws(() => validateClockifyUserMapping(sourceUsers, value), expected);
});

test('requires unique GitHub IDs and case-insensitively unique GitHub logins', () => {
  assert.throws(() => validateClockifyUserMapping(sourceUsers, [
    mappings[0], { sourceUserId: 'clockify-ada', githubUser: { id: 42, login: 'ada-lovelace' } },
  ]), /duplicate.*GitHub.*ID/i);
  assert.throws(() => validateClockifyUserMapping(sourceUsers, [
    mappings[0], { sourceUserId: 'clockify-ada', githubUser: { id: 7, login: 'LIN-TORRES' } },
  ]), /duplicate.*GitHub.*login/i);
});

test('accepts an explicit skip decision without creating a surrogate GitHub mapping', () => {
  assert.deepEqual(validateClockifyUserMapping(sourceUsers, [
    { sourceUserId: 'clockify-ada', skipped: true },
    mappings[0],
  ]), [
    { sourceUserId: 'clockify-ada', skipped: true },
    { sourceUserId: 'clockify-lin', githubUser: { id: 42, login: 'lin-torres' } },
  ]);
  assert.throws(() => validateClockifyUserMapping(sourceUsers, [
    { sourceUserId: 'clockify-ada', skipped: false }, mappings[0],
  ]), /skip/i);
});

test('validates the normalized bounded source roster and GitHub identity conventions', () => {
  for (const [users, value, expected] of [
    [[{ userId: '', displayName: 'Ada', entryCount: 1 }], [{ sourceUserId: '', githubUser: { id: 1, login: 'ada' } }], /source.*ID/i],
    [[{ userId: 'user', displayName: '', entryCount: 1 }], [{ sourceUserId: 'user', githubUser: { id: 1, login: 'ada' } }], /display name/i],
    [[{ userId: 'user', displayName: 'Ada', entryCount: 0 }], [{ sourceUserId: 'user', githubUser: { id: 1, login: 'ada' } }], /entry count/i],
    [[...sourceUsers, { userId: 'clockify-ada', displayName: 'Other', entryCount: 1 }], mappings, /duplicate.*source.*ID/i],
    [sourceUsers, [{ sourceUserId: 'clockify-lin', githubUser: { id: 42, login: 'lin-torres' } }, { sourceUserId: 'clockify-ada', githubUser: { id: 0, login: 'ada-lovelace' } }], /GitHub.*ID/i],
    [sourceUsers, [{ sourceUserId: 'clockify-lin', githubUser: { id: 42, login: 'lin-torres' } }, { sourceUserId: 'clockify-ada', githubUser: { id: 7, login: '-ada' } }], /GitHub.*login/i],
  ]) assert.throws(() => validateClockifyUserMapping(users, value), expected);

  const tooMany = Array.from({ length: 1001 }, (_, index) => ({ userId: `user-${index}`, displayName: `User ${index}`, entryCount: 1 }));
  assert.throws(() => validateClockifyUserMapping(tooMany, []), /too many.*source users/i);
});

test('rejects display-name matching, email and arbitrary fields, credential-shaped fields, and malformed objects', () => {
  const cases = [
    [[...sourceUsers], [{ sourceUserId: 'Ada Lovelace', githubUser: { id: 7, login: 'ada-lovelace' } }, mappings[0]], /unknown.*source/i],
    [[{ ...sourceUsers[0], email: 'ada@example.test' }, sourceUsers[1]], mappings, /unknown.*source user field/i],
    [sourceUsers, [{ ...mappings[0], sourceDisplayName: 'Lin Torres' }, mappings[1]], /unknown.*mapping field/i],
    [sourceUsers, [{ ...mappings[0], githubUser: { ...mappings[0].githubUser, email: 'lin@example.test' } }, mappings[1]], /unknown.*GitHub user field/i],
    [sourceUsers, [{ ...mappings[0], token: 'not-a-real-token' }, mappings[1]], /credential/i],
    [sourceUsers, [{ ...mappings[0], githubUser: { ...mappings[0].githubUser, authorization: 'nope' } }, mappings[1]], /credential/i],
    [sourceUsers, [{ sourceUserId: 'clockify-lin', githubUser: { id: 42, login: 'lin-torres' }, displayName: 'Lin Torres' }, mappings[1]], /unknown.*mapping field/i],
  ];
  for (const [users, value, expected] of cases) assert.throws(() => validateClockifyUserMapping(users, value), expected);

  const nonPlainUser = Object.assign(Object.create(null), sourceUsers[0]);
  assert.throws(() => validateClockifyUserMapping([nonPlainUser, sourceUsers[1]], mappings), /source user.*object/i);

  const accessorMapping = clone(mappings[0]);
  Object.defineProperty(accessorMapping, 'sourceUserId', { enumerable: true, get() { return 'clockify-lin'; } });
  assert.throws(() => validateClockifyUserMapping(sourceUsers, [accessorMapping, mappings[1]]), /mapping.*data/i);

  const accessorGithubUser = clone(mappings[0].githubUser);
  Object.defineProperty(accessorGithubUser, 'login', { enumerable: true, get() { return 'lin-torres'; } });
  assert.throws(() => validateClockifyUserMapping(sourceUsers, [{ sourceUserId: 'clockify-lin', githubUser: accessorGithubUser }, mappings[1]]), /GitHub user.*data/i);

  const accessorSourceUser = clone(sourceUsers[0]);
  Object.defineProperty(accessorSourceUser, 'displayName', { enumerable: true, get() { return 'Ada Lovelace'; } });
  assert.throws(() => validateClockifyUserMapping([accessorSourceUser, sourceUsers[1]], mappings), /source user.*data/i);

  const accessorGithubTarget = clone(mappings[0]);
  Object.defineProperty(accessorGithubTarget, 'githubUser', { enumerable: true, get() { return mappings[0].githubUser; } });
  assert.throws(() => validateClockifyUserMapping(sourceUsers, [accessorGithubTarget, mappings[1]]), /mapping.*data/i);

  const symbolMapping = clone(mappings[0]);
  symbolMapping[Symbol('unexpected')] = true;
  assert.throws(() => validateClockifyUserMapping(sourceUsers, [symbolMapping, mappings[1]]), /unknown.*mapping field/i);

  const sparseMappings = [mappings[0], , mappings[1]];
  assert.throws(() => validateClockifyUserMapping(sourceUsers, sparseMappings), /dense data array/i);

  const accessorArray = [...mappings];
  let getterCalls = 0;
  Object.defineProperty(accessorArray, '0', { enumerable: true, get() { getterCalls += 1; return mappings[0]; } });
  assert.throws(() => validateClockifyUserMapping(sourceUsers, accessorArray), /mappings.*data/i);
  assert.equal(getterCalls, 0);
});
