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
      assert.deepEqual(input, { sourceUsers, mappings, github: input.github, completedOutcomes: [] });
      return resolved;
    },
    importRecords: async input => {
      calls.imports.push(input);
      return imported;
    },
  };
}

test('imports the selected Clockify user into the already configured Clockoli writer branch', async () => {
  const { github } = verifiedGithub();
  const deps = dependencies();
  const result = await importClockifyOrganization({ sourceUsers, entries, mappings, github, destinationUser, ...deps });

  assert.equal(deps.calls.resolve, 1);
  assert.equal(deps.calls.imports.length, 1);
  assert.equal(deps.calls.imports[0].github.branch, 'clockoli/users/42');
  assert.deepEqual(deps.calls.imports[0].githubUser, destinationUser);
  assert.deepEqual(deps.calls.imports[0].entries, entries.slice(0, 2));
  assert.deepEqual(result, [{
    sourceUserId: 'clockify-ada', githubUser: destinationUser, status: 'imported', added: 2, alreadyPresent: 0,
  }]);
});

function verifiedGithub({ missing = [], wrongOwner = [], wrongBranch = [], wrongIdentity = [], accessDenied = [] } = {}) {
  const calls = [];
  const root = { owner: 'acme', repo: 'times', expectedRepositoryId: 123, branch: 'clockoli/users/42' };
  const forBranch = branch => ({
    ...root, branch: wrongBranch.includes(branch) ? root.branch : branch,
    owner: wrongOwner.includes(branch) ? 'attacker' : root.owner,
    assertDestinationReachable: async () => {
      calls.push(['access', branch]);
      if (accessDenied.includes(branch)) throw Object.assign(new Error('provider secret'), { status: 403 });
    },
    getText: async path => {
      calls.push(['read', branch, path]);
      if (missing.includes(branch)) throw Object.assign(new Error('not found'), { status: 404 });
      if (path === '.clockoli/user.json') return { text: JSON.stringify({ version: 1, githubUserId: wrongIdentity.includes(branch) ? 42 : Number(branch.split('/').at(-1)), storageLogin: branch.endsWith('/42') ? 'ada' : 'other' }) };
      return { text: JSON.stringify({ version: 1, storageLogin: branch.endsWith('/42') ? 'ada' : 'other', tasks: {} }) };
    },
  });
  return { github: { ...root, forBranch }, calls };
}

const multipleUsers = [...sourceUsers.slice(0, 1), { userId: 'clockify-other', displayName: 'Other', entryCount: 1 }, sourceUsers[1]];
const multipleEntries = [...entries.slice(0, 2), { userId: 'clockify-other', entryId: 'other-1' }, entries[2]];
const multipleMappings = [mappings[0], { sourceUserId: 'clockify-other', githubLogin: 'other' }, mappings[1]];
const multipleResolved = [
  { sourceUserId: 'clockify-ada', githubUser: destinationUser },
  { sourceUserId: 'clockify-other', githubUser: { id: 9, login: 'other' } },
  { sourceUserId: 'clockify-skip', skipped: true },
];

test('routes two explicitly mapped people to separately verified branches, never the configured branch for the other person', async () => {
  const { github, calls } = verifiedGithub();
  const imports = [];
  const result = await importClockifyOrganization({ sourceUsers: multipleUsers, entries: multipleEntries, mappings: multipleMappings,
    destinationUser, github, resolveMappings: async () => multipleResolved, importRecords: async request => {
      imports.push(request);
      return { status: 'imported', added: request.entries.length, alreadyPresent: 0 };
    } });
  assert.deepEqual(imports.map(({ github: target, githubUser, entries: items }) => [target.branch, githubUser.id, items.map(item => item.entryId)]), [
    ['clockoli/users/42', 42, ['ada-1', 'ada-2']], ['clockoli/users/9', 9, ['other-1']],
  ]);
  assert.deepEqual(result.map(item => [item.sourceUserId, item.status, item.added]), [
    ['clockify-ada', 'imported', 2], ['clockify-other', 'imported', 1],
  ]);
  assert(calls.some(call => call[0] === 'access' && call[1] === 'clockoli/users/9'));
  assert(!calls.some(call => call[1] === 'clockoli/users/9' && call[2] === 'times/2026-08/ada.jsonl'));
});

test('restart skips only checkpointed people, and a checkpoint failure stops later writes', async () => {
  const { github, calls } = verifiedGithub();
  const first = { sourceUserId: 'clockify-ada', githubUser: destinationUser, status: 'imported', added: 2, alreadyPresent: 0 };
  const imports = [], checkpoints = [];
  const request = { sourceUsers: multipleUsers, entries: multipleEntries, mappings: multipleMappings,
    destinationUser, github, resolveMappings: async () => multipleResolved,
    importRecords: async value => { imports.push(value.github.branch); return { status: 'imported', added: value.entries.length, alreadyPresent: 0 }; },
    completedOutcomes: [first], onOutcome: async value => { checkpoints.push(value); } };
  const result = await importClockifyOrganization(request);
  assert.deepEqual(imports, ['clockoli/users/9']);
  assert.deepEqual(checkpoints.map(value => value.sourceUserId), ['clockify-other']);
  assert.equal(result[0], first);
  assert.equal(calls.some(call => call[1] === 'clockoli/users/42'), false);
  await assert.rejects(importClockifyOrganization({ ...request, completedOutcomes: [{ ...first, githubUser: { id: 99, login: 'ada' } }] }), /checkpoint/i);
  imports.length = 0;
  await assert.rejects(importClockifyOrganization({ ...request, completedOutcomes: [], onOutcome: async () => { throw new Error('storage unavailable'); } }), /storage unavailable/);
  assert.deepEqual(imports, ['clockoli/users/42']);
});

test('repeated GitHub throttling preserves the current person and does not checkpoint failure', async () => {
  const { github } = verifiedGithub();
  const checkpoints = [];
  const throttle = Object.assign(new Error('throttled'), { code: 'rate_limit' });
  await assert.rejects(importClockifyOrganization({ sourceUsers, entries, mappings, destinationUser, github,
    resolveMappings: async () => [{ sourceUserId: 'clockify-ada', githubUser: destinationUser }, mappings[1]],
    importRecords: async () => { throw throttle; }, onOutcome: outcome => checkpoints.push(outcome),
  }), error => error === throttle);
  assert.deepEqual(checkpoints, []);
});

test('transient identity lookup failures do not block a valid mapping; a missing account does', async () => {
  const { github } = verifiedGithub();
  for (const failure of [Object.assign(new Error('GitHub unavailable'), { status: 503, code: 'github_api_error' }),
    new TypeError('Failed to fetch')]) {
    let checkpoints = 0;
    await assert.rejects(importClockifyOrganization({ sourceUsers, entries, mappings, destinationUser, github,
      resolveMappings: async () => { throw failure; }, onOutcome: () => { checkpoints += 1; },
    }), error => error === failure);
    assert.equal(checkpoints, 0);
  }
  await assert.rejects(importClockifyOrganization({ sourceUsers, entries, mappings, destinationUser, github,
    resolveMappings: async () => { throw Object.assign(new Error('unknown login'), { status: 404, code: 'not_found' }); },
  }), error => error.code === 'mapping_unresolved');
});

test('a changed connection aborts before checkpointing the current person', async () => {
  const { github } = verifiedGithub();
  const checkpoints = [];
  const changed = Object.assign(new Error('connection changed'), { code: 'migration_paused' });
  await assert.rejects(importClockifyOrganization({ sourceUsers, entries, mappings, destinationUser, github,
    resolveMappings: async () => [{ sourceUserId: 'clockify-ada', githubUser: destinationUser }, mappings[1]],
    importRecords: async () => { throw changed; }, onOutcome: outcome => checkpoints.push(outcome),
  }), error => error === changed);
  assert.deepEqual(checkpoints, []);
});

test('missing or mismatched personal branch fails only that person and does not write their records elsewhere', async () => {
  const { github } = verifiedGithub({ missing: ['clockoli/users/9'] });
  const imports = [];
  const outcomes = await importClockifyOrganization({ sourceUsers: multipleUsers, entries: multipleEntries, mappings: multipleMappings,
    destinationUser, github, resolveMappings: async () => multipleResolved,
    importRecords: async request => { imports.push(request); return { status: 'imported', added: 2, alreadyPresent: 0 }; } });
  assert.deepEqual(imports.map(request => request.github.branch), ['clockoli/users/42']);
  assert.deepEqual(outcomes[1], { sourceUserId: 'clockify-other', githubUser: { id: 9, login: 'other' }, status: 'failed', failureReason: 'repository_or_branch_not_found' });
});

test('rejects a branch client that points to another branch or repository before importing', async () => {
  for (const options of [{ wrongBranch: ['clockoli/users/9'] }, { wrongOwner: ['clockoli/users/9'] }]) {
    const { github } = verifiedGithub(options);
    const imports = [];
    const outcomes = await importClockifyOrganization({ sourceUsers: multipleUsers, entries: multipleEntries, mappings: multipleMappings,
      destinationUser, github, resolveMappings: async () => multipleResolved,
      importRecords: async request => { imports.push(request); return { status: 'imported', added: 1, alreadyPresent: 0 }; } });
    assert.deepEqual(imports.map(request => request.github.branch), ['clockoli/users/42']);
    assert.equal(outcomes[1].failureReason, 'storage_branch_incomplete');
  }
});

test('identity mismatch and access denial fail independently with source-free diagnostics', async () => {
  for (const options of [{ wrongIdentity: ['clockoli/users/9'] }, { accessDenied: ['clockoli/users/9'] }]) {
    const { github } = verifiedGithub(options);
    const imports = [];
    const outcomes = await importClockifyOrganization({ sourceUsers: multipleUsers, entries: multipleEntries, mappings: multipleMappings,
      destinationUser, github, resolveMappings: async () => multipleResolved,
      importRecords: async request => { imports.push(request); return { status: 'imported', added: 1, alreadyPresent: 0 }; } });
    assert.deepEqual(imports.map(request => request.github.branch), ['clockoli/users/42']);
    assert.equal(outcomes[1].failureReason, options.accessDenied ? 'github_permission' : 'storage_branch_incomplete');
    assert.equal(JSON.stringify(outcomes).includes('provider secret'), false);
  }
});

test('default resolver looks up each explicit GitHub login and skips unselected source users', async () => {
  const { github } = verifiedGithub();
  const resolved = [];
  github.getUserIdentity = async login => {
    resolved.push(login);
    return login === 'ada' ? destinationUser : { id: 9, login: 'other' };
  };
  const outcomes = await importClockifyOrganization({ sourceUsers: multipleUsers, entries: multipleEntries,
    mappings: multipleMappings, destinationUser, github,
    importRecords: async () => ({ status: 'already_present', added: 0, alreadyPresent: 1 }) });
  assert.deepEqual(resolved, ['ada', 'other']);
  assert.deepEqual(outcomes.map(outcome => outcome.status), ['already_present', 'already_present']);
});

test('rejects an unverified configured repository before any record write', async () => {
  const { github } = verifiedGithub();
  github.expectedRepositoryId = null;
  let writes = 0;
  await assert.rejects(() => importClockifyOrganization({ sourceUsers, entries, mappings, github, destinationUser,
    resolveMappings: async () => [{ sourceUserId: 'clockify-ada', githubUser: destinationUser }, { sourceUserId: 'clockify-skip', skipped: true }],
    importRecords: async () => { writes += 1; } }), /repository and personal branch must be verified/);
  assert.equal(writes, 0);
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
  const result = await importClockifyOrganization({ sourceUsers, entries, mappings, github: verifiedGithub().github, destinationUser, ...deps });
  assert.deepEqual(result, [{
    sourceUserId: 'clockify-ada', githubUser: destinationUser, status: 'failed', failureReason: 'github_write_permission',
  }]);
  assert.equal(JSON.stringify(result).includes('providerDetail'), false);
});

test('forwards only the allowlisted source-free destination collision comparison', async () => {
  const incoming = {
    recordId: '01K2ABCDEF0123456789ABCDEF', provenanceSha256: 'a'.repeat(64),
    startedAt: '2026-08-18T08:00:00.000Z', endedAt: '2026-08-18T09:00:00.000Z', durationSeconds: 3600, taskFingerprintSha256: 'b'.repeat(64),
  };
  const existing = {
    recordId: '01K2ABCDEF0123456789ABCDEF', provenanceSha256: 'c'.repeat(64),
    startedAt: '2026-08-18T08:00:00.000Z', endedAt: '2026-08-18T09:00:00.000Z', durationSeconds: 3600, taskFingerprintSha256: 'd'.repeat(64),
    path: 'times/2026-08/ada.jsonl', line: 4,
  };
  const diagnostic = {
    stage: 'preparing_destination_record', code: 'destination_duplicate_record_id', detail: 'Duplicate imported work record ID',
    collision: { incoming, existing, comparison: { sameProvenance: false, sameTimeRange: true, sameTaskFingerprint: false }, providerDetail: 'must not escape' },
  };
  const deps = dependencies({ imported: { status: 'failed', failureReason: 'invalid_imported_record', diagnostic } });
  const result = await importClockifyOrganization({ sourceUsers, entries, mappings, github: verifiedGithub().github, destinationUser, ...deps });
  assert.deepEqual(result, [{
    sourceUserId: 'clockify-ada', githubUser: destinationUser, status: 'failed', failureReason: 'invalid_imported_record',
    diagnostic: {
      stage: 'preparing_destination_record', code: 'destination_duplicate_record_id', detail: 'Duplicate imported work record ID',
      collision: { incoming, existing, comparison: { sameProvenance: false, sameTimeRange: true, sameTaskFingerprint: false } },
    },
  }]);
  assert.equal(JSON.stringify(result).includes('providerDetail'), false);
});
