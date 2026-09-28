import test from 'node:test';
import assert from 'node:assert/strict';
import { importClockifyCompletedRecords } from '../src/services/clockify-record-import.js';
import { applyTaskIndexChanges, emptyTaskIndex, serializeTaskIndex, TASK_INDEX_PATH } from '../src/domain/task-index.js';
import { USER_METADATA_PATH, userBranchMetadataText, userStorageBranch } from '../src/services/user-storage-branch.js';
import { parseMonthlyRecords, serializeMonthlyRecords } from '../src/domain/work-records.js';

const githubUser = { id: 42, login: 'ada' };
const branch = userStorageBranch(githubUser.id);
const ids = ['01K2ABCDEF0123456789ABCDEF', '01K2ABCDEF0123456789ABCDEG'];
function entry(day, suffix) {
  return {
    provider: 'clockify', entryId: `raw-entry-${suffix}`, userId: 'raw-user-77',
    startedAt: `${day}T08:00:00.000Z`, endedAt: `${day}T09:00:00.000Z`,
    timezone: 'America/Los_Angeles', duration: 3600,
    projectId: 'raw-project-3', project: 'Private Project Name', task: 'Private Task Name',
    description: 'Private provider description', tags: ['private-tag'], billable: true,
    resolvedIssue: {
      url: 'https://github.com/manticoresoftware/clockoli-issues/issues/13',
      title: 'manticoresoftware/Private-Project-Name/Private-provider-description',
    },
  };
}

class FakeGitHub {
  constructor() { this.owner = 'manticoresoftware'; this.clients = []; this.files = new Map(); this.writes = []; this.conflict = false; }
  forBranch(name, mode) {
    this.clients.push({ name, mode });
    return {
      getText: async path => {
        const file = this.files.get(path);
        if (!file) { const error = new Error('not found'); error.status = 404; error.code = 'not_found'; throw error; }
        return { path, ...file };
      },
      updateTextsAtomic: async (changes, message, options) => {
        if (this.conflict) { const error = new Error('provider detail must not escape'); error.status = 409; error.code = 'conflict'; throw error; }
        for (const item of [...changes, ...(options.guards ?? [])]) {
          if ((this.files.get(item.path)?.sha ?? null) !== (item.sha ?? null)) { const error = new Error('conflict'); error.status = 409; throw error; }
        }
        this.writes.push({ changes, message, options });
        for (const change of changes) this.files.set(change.path, { sha: `sha-${this.writes.length}-${change.path}`, text: change.text });
        return { blobShas: {} };
      },
    };
  }
  seed(path, text, sha = `seed-${path}`) { this.files.set(path, { sha, text }); }
}

function prepared() {
  const github = new FakeGitHub();
  const configuredBranchClient = github.forBranch(branch, 'custom');
  github.getText = configuredBranchClient.getText;
  github.updateTextsAtomic = configuredBranchClient.updateTextsAtomic;
  github.clients = [];
  github.seed(USER_METADATA_PATH, userBranchMetadataText(githubUser));
  github.seed(TASK_INDEX_PATH, serializeTaskIndex(emptyTaskIndex(githubUser.login)));
  return github;
}
function factory() { return ids.shift(); }

test('imports exact records into the configured Clockoli writer branch across affected months with useful Clockify names', async () => {
  const github = prepared();
  const input = [entry('2026-08-31', 'a'), entry('2026-09-01', 'b')];
  const result = await importClockifyCompletedRecords({ github, githubUser, entries: input, idFactory: factory });
  assert.deepEqual(result, { status: 'imported', added: 2, alreadyPresent: 0 });
  assert.deepEqual(github.clients, []);
  assert.equal(github.writes.length, 1);
  const write = github.writes[0];
  assert.deepEqual(write.changes.map(change => change.path).sort(), [
    TASK_INDEX_PATH, 'times/2026-08/ada.jsonl', 'times/2026-09/ada.jsonl',
  ]);
  assert.deepEqual(write.options.guards.map(guard => guard.path), [USER_METADATA_PATH]);
  const august = parseMonthlyRecords(github.files.get('times/2026-08/ada.jsonl').text, { user: 'ada', path: 'times/2026-08/ada.jsonl' })[0];
  assert.equal(august.startedAt, input[0].startedAt);
  assert.equal(august.endedAt, input[0].endedAt);
  assert.equal(august.timezone, input[0].timezone);
  assert.equal(august.durationSeconds, input[0].duration);
  assert.equal(august.taskUrl, 'https://github.com/manticoresoftware/clockoli-issues/issues/13');
  assert.equal(august.taskTitle, 'manticoresoftware/Private-Project-Name/Private-provider-description');
  assert.equal(august.description, 'Private provider description');
  const serialized = `${write.message}\n${write.changes.map(change => change.text).join('\n')}`;
  for (const forbidden of ['raw-entry-a', 'raw-user-77', 'private-tag']) {
    assert.equal(serialized.includes(forbidden), false, `serialized import leaked ${forbidden}`);
  }
  assert.match(august.metadata.clockoli_import.provenance_sha256, /^[a-f0-9]{64}$/);
});

test('returns a safe exact repair target when an existing monthly file contains a record from another month', async () => {
  const github = prepared();
  const source = entry('2026-08-18', 'misplaced');
  await importClockifyCompletedRecords({ github, githubUser, entries: [source], idFactory: factory });
  const path = 'times/2026-08/ada.jsonl';
  const record = JSON.parse(github.files.get(path).text);
  record.activity.local_date = '2026-09-01';
  github.seed(path, `${JSON.stringify(record)}\n`);
  const result = await importClockifyCompletedRecords({ github, githubUser, entries: [source], idFactory: factory });
  assert.deepEqual(result, { status: 'failed', failureReason: 'storage_data_unreadable', repair: { kind: 'monthly_partition_mismatch', path: 'times/2026-08/ada.jsonl', line: 1, actualMonth: '2026-09', expectedMonth: '2026-08' } });
});


test('same provenance already present and duplicate input perform no write', async () => {
  const github = prepared();
  const source = entry('2026-08-18', 'same');
  assert.deepEqual(await importClockifyCompletedRecords({ github, githubUser, entries: [source], idFactory: () => '01K2ABCDEF0123456789ABCDEF' }), {
    status: 'imported', added: 1, alreadyPresent: 0,
  });
  const writes = github.writes.length;
  const result = await importClockifyCompletedRecords({ github, githubUser, entries: [source, structuredClone(source)], idFactory: () => '01K2ABCDEF0123456789ABCDEF' });
  assert.deepEqual(result, { status: 'already_present', added: 0, alreadyPresent: 1 });
  assert.equal(github.writes.length, writes);
});

test('replays a shifted prior Clockify import by title, project, date, author, and duration', async () => {
  const github = prepared();
  const source = entry('2026-08-18', 'replay');
  await importClockifyCompletedRecords({ github, githubUser, entries: [source], idFactory: () => '01K2ABCDEF0123456789ABCDEF' });
  const path = 'times/2026-08/ada.jsonl';
  const [shifted] = parseMonthlyRecords(github.files.get(path).text, { user: 'ada', path });
  delete shifted.metadata.clockoli_import;
  shifted.startedAt = '2026-08-18T08:30:00.000Z';
  shifted.endedAt = '2026-08-18T09:30:00.000Z';
  shifted.updatedAt = shifted.endedAt;
  github.seed(path, serializeMonthlyRecords([shifted]), github.files.get(path).sha);

  assert.deepEqual(await importClockifyCompletedRecords({ github, githubUser, entries: [source], idFactory: () => '01K2ABCDEF0123456789ABCDEF' }), {
    status: 'imported', added: 0, alreadyPresent: 0,
  });
  const [replayed] = parseMonthlyRecords(github.files.get(path).text, { user: 'ada', path });
  assert.equal(replayed.startedAt, source.startedAt);
  assert.equal(replayed.endedAt, source.endedAt);
  assert.equal(replayed.taskTitle, 'manticoresoftware/Private-Project-Name/Private-provider-description');
  assert.equal(replayed.taskUrl, 'https://github.com/manticoresoftware/clockoli-issues/issues/13');
  assert.equal(replayed.durationSeconds, source.duration);
  assert.equal(replayed.actor.id, 'github:42');
  assert.match(replayed.metadata.clockoli_import.provenance_sha256, /^[a-f0-9]{64}$/);
});

test('replays a legacy Clockify report identity into the generated task identity', async () => {
  const github = prepared();
  const source = entry('2026-08-18', 'pre-resolver-replay');
  delete source.resolvedIssue;
  await importClockifyCompletedRecords({ github, githubUser, entries: [source], idFactory: () => '01K2ABCDEF0123456789ABCDEF' });
  const path = 'times/2026-08/ada.jsonl';
  const [shifted] = parseMonthlyRecords(github.files.get(path).text, { user: 'ada', path });
  delete shifted.metadata.clockoli_import;
  shifted.taskUrl = 'https://app.clockify.me/reports/detailed?project=raw-project-3';
  shifted.taskTitle = 'Private Project Name — Private Task Name';
  shifted.startedAt = '2026-08-18T08:30:00.000Z';
  shifted.endedAt = '2026-08-18T09:30:00.000Z';
  shifted.updatedAt = shifted.endedAt;
  github.seed(path, serializeMonthlyRecords([shifted]), github.files.get(path).sha);
  github.seed(TASK_INDEX_PATH, serializeTaskIndex(applyTaskIndexChanges(emptyTaskIndex(githubUser.login), { add: [shifted] })), github.files.get(TASK_INDEX_PATH).sha);

  assert.deepEqual(await importClockifyCompletedRecords({ github, githubUser, entries: [source], idFactory: () => '01K2ABCDEF0123456789ABCDEF' }), {
    status: 'imported', added: 0, alreadyPresent: 0,
  });
  const [replayed] = parseMonthlyRecords(github.files.get(path).text, { user: 'ada', path });
  assert.equal(replayed.startedAt, source.startedAt);
  assert.equal(replayed.taskUrl, 'manticoresoftware/Private-Project-Name/Private-Task-Name');
});

test('replays a shifted generic-project import after the local classifier supplies a GitHub URL', async () => {
  const github = prepared();
  const source = {
    ...entry('2026-08-18', 'resolved-replay'), project: 'clockoli-issues', task: '#13 Create a migration plugin for Clockify', resolvedIssue: {
      url: 'https://github.com/manticoresoftware/clockoli-issues/issues/13', title: 'Create a migration plugin for Clockify',
    },
  };
  await importClockifyCompletedRecords({ github, githubUser, entries: [source], idFactory: () => '01K2ABCDEF0123456789ABCDEF' });
  const path = 'times/2026-08/ada.jsonl';
  const [shifted] = parseMonthlyRecords(github.files.get(path).text, { user: 'ada', path });
  delete shifted.metadata.clockoli_import;
  shifted.startedAt = '2026-08-18T08:30:00.000Z';
  shifted.endedAt = '2026-08-18T09:30:00.000Z';
  shifted.updatedAt = shifted.endedAt;
  github.seed(path, serializeMonthlyRecords([shifted]), github.files.get(path).sha);
  const resolved = { ...source, resolvedIssue: {
    url: 'https://github.com/manticoresoftware/clockoli-issues/issues/13', title: 'Create a migration plugin for Clockify',
  } };

  assert.deepEqual(await importClockifyCompletedRecords({ github, githubUser, entries: [resolved], idFactory: () => '01K2ABCDEF0123456789ABCDEF' }), {
    status: 'imported', added: 0, alreadyPresent: 0,
  });
  const [replayed] = parseMonthlyRecords(github.files.get(path).text, { user: 'ada', path });
  assert.equal(replayed.startedAt, source.startedAt);
  assert.equal(replayed.endedAt, source.endedAt);
  assert.equal(replayed.taskUrl, 'https://github.com/manticoresoftware/clockoli-issues/issues/13');
});

test('imports a Clockify interval whose millisecond timestamps round to its reported whole-second duration', async () => {
  const github = prepared();
  const source = {
    ...entry('2026-08-18', 'fractional-duration'),
    startedAt: '2026-08-18T08:00:00.123Z', endedAt: '2026-08-18T09:00:00.000Z', duration: 3600,
  };
  assert.deepEqual(await importClockifyCompletedRecords({ github, githubUser, entries: [source], idFactory: () => '01K2ABCDEF0123456789ABCDEF' }), {
    status: 'imported', added: 1, alreadyPresent: 0,
  });
  const [record] = parseMonthlyRecords(github.files.get('times/2026-08/ada.jsonl').text, { user: 'ada', path: 'times/2026-08/ada.jsonl' });
  assert.equal(record.startedAt, source.startedAt);
  assert.equal(record.endedAt, '2026-08-18T09:00:00.123Z');
  assert.equal(record.durationSeconds, source.duration);
});

test('imports a large set of non-overlapping completed records without quadratic interval rescans', { timeout: 5_000 }, async () => {
  const github = prepared();
  const source = Array.from({ length: 5_000 }, (_, index) => {
    const startedAt = new Date(Date.UTC(2020, 0, 1, 0, index * 2)).toISOString();
    const endedAt = new Date(Date.UTC(2020, 0, 1, 0, index * 2 + 1)).toISOString();
    return {
      ...entry('2020-01-01', `scale-${index}`),
      startedAt,
      endedAt,
      timezone: 'UTC',
      duration: 60,
      resolvedIssue: {
        url: 'https://github.com/manticoresoftware/clockoli-issues/issues/13',
        title: 'Scale test',
      },
    };
  });

  const result = await importClockifyCompletedRecords({ github, githubUser, entries: source });

  assert.deepEqual(result, { status: 'imported', added: 5_000, alreadyPresent: 0 });
  assert.equal(github.writes.length, 1);
});

test('profiles replay matching separately from interval normalization', async () => {
  const github = prepared();
  const profiles = [];
  await importClockifyCompletedRecords({
    github, githubUser, entries: [entry('2026-08-18', 'profile')],
    idFactory: () => '01K2ABCDEF0123456789ABCDEF', onProfile: profile => profiles.push(profile.stage),
  });

  const replayMatching = profiles.indexOf('matching_replay_targets');
  const intervalNormalization = profiles.indexOf('normalizing_intervals');
  const buildingRecords = profiles.indexOf('building_records');
  assert.notEqual(replayMatching, -1);
  assert.notEqual(intervalNormalization, -1);
  assert.notEqual(buildingRecords, -1);
  assert.ok(replayMatching < intervalNormalization);
  assert.ok(intervalNormalization < buildingRecords);
});

test('replays a large imported set through indexed provenance lookups', { timeout: 5_000 }, async () => {
  const github = prepared();
  const source = Array.from({ length: 4_000 }, (_, index) => {
    const startedAt = new Date(Date.UTC(2020, 0, 1, 0, index * 2)).toISOString();
    const endedAt = new Date(Date.UTC(2020, 0, 1, 0, index * 2 + 1)).toISOString();
    return {
      ...entry('2020-01-01', `replay-scale-${index}`),
      startedAt,
      endedAt,
      timezone: 'UTC',
      duration: 60,
      resolvedIssue: {
        url: 'https://github.com/manticoresoftware/clockoli-issues/issues/13',
        title: `Replay scale ${index}`,
      },
    };
  });
  assert.deepEqual(await importClockifyCompletedRecords({ github, githubUser, entries: source }), {
    status: 'imported', added: 4_000, alreadyPresent: 0,
  });

  const startedAt = performance.now();
  assert.deepEqual(await importClockifyCompletedRecords({ github, githubUser, entries: source }), {
    status: 'already_present', added: 0, alreadyPresent: 4_000,
  });
  assert.ok(performance.now() - startedAt < 3_000, 'replay matching must not rescan every record for every source entry');
});

test('reads affected monthly destination files with bounded concurrency', async () => {
  const github = prepared();
  const originalGetText = github.getText.bind(github);
  let inFlight = 0;
  let maximumInFlight = 0;
  github.getText = async path => {
    if (path.startsWith('times/')) {
      inFlight += 1;
      maximumInFlight = Math.max(maximumInFlight, inFlight);
      await new Promise(resolve => setTimeout(resolve, 5));
      inFlight -= 1;
    }
    return originalGetText(path);
  };
  const entries = Array.from({ length: 12 }, (_, month) => entry(`2025-${String(month + 1).padStart(2, '0')}-01`, `month-${month}`));

  const result = await importClockifyCompletedRecords({ github, githubUser, entries });

  assert.deepEqual(result, { status: 'imported', added: 12, alreadyPresent: 0 });
  assert.ok(maximumInFlight > 1, 'affected monthly files should not be read serially');
  assert.ok(maximumInFlight <= 6, 'destination reads must remain bounded to avoid GitHub throttling');
});

test('imports an unresolved Clockify entry with its deterministic Clockify project identity', async () => {
  const github = prepared();
  const source = { ...entry('2026-08-18', 'issue'), project: 'NexusRepo', task: 'Fixed last block encoding' };
  delete source.resolvedIssue;
  assert.deepEqual(await importClockifyCompletedRecords({ github, githubUser, entries: [source], idFactory: () => '01K2ABCDEF0123456789ABCDEF' }), {
    status: 'imported', added: 1, alreadyPresent: 0,
  });
  const record = parseMonthlyRecords(github.files.get('times/2026-08/ada.jsonl').text, { user: 'ada', path: 'times/2026-08/ada.jsonl' })[0];
  assert.equal(record.taskUrl, 'manticoresoftware/NexusRepo/Fixed-last-block-encoding');
  assert.equal(record.taskTitle, 'NexusRepo — Fixed last block encoding');
});

test('does not derive a GitHub URL from an unresolved Clockify entry', async () => {
  const github = prepared();
  github.owner = 'manticoresoftware';
  const source = {
    ...entry('2026-08-18', 'unresolved'),
    project: 'NexusRepo', task: '', description: 'https://app.clockify.me/reports/detailed?project=123 Fixed last block encoding',
  };
  delete source.resolvedIssue;

  assert.deepEqual(await importClockifyCompletedRecords({
    github, githubUser, entries: [source], idFactory: () => '01K2ABCDEF0123456789ABCDEF',
  }), { status: 'imported', added: 1, alreadyPresent: 0 });
  const record = parseMonthlyRecords(github.files.get('times/2026-08/ada.jsonl').text, { user: 'ada', path: 'times/2026-08/ada.jsonl' })[0];
  assert.equal(record.taskUrl, 'manticoresoftware/NexusRepo/https-app-clockify-me-reports-detailed-project-123-Fixed-last-block-encoding');
  assert.doesNotMatch(record.taskUrl, /github\.com/);
});

test('refreshes blank legacy imported labels from the same Clockify provenance without changing time', async () => {
  const github = prepared();
  const source = entry('2026-08-18', 'legacy');
  await importClockifyCompletedRecords({ github, githubUser, entries: [source], idFactory: () => '01K2ABCDEF0123456789ABCDEF' });
  const path = 'times/2026-08/ada.jsonl';
  const [legacy] = parseMonthlyRecords(github.files.get(path).text, { user: 'ada', path });
  legacy.taskTitle = ''; legacy.issueTitle = ''; legacy.description = '';
  github.seed(path, serializeMonthlyRecords([legacy]), github.files.get(path).sha);
  const writes = github.writes.length;
  assert.deepEqual(await importClockifyCompletedRecords({ github, githubUser, entries: [source], idFactory: () => '01K2ABCDEF0123456789ABCDEF' }), {
    status: 'imported', added: 0, alreadyPresent: 1,
  });
  assert.equal(github.writes.length, writes + 1);
  assert.deepEqual(github.writes.at(-1).changes.map(change => change.path), [path, TASK_INDEX_PATH]);
  const [refreshed] = parseMonthlyRecords(github.files.get(path).text, { user: 'ada', path });
  assert.equal(refreshed.startedAt, source.startedAt);
  assert.equal(refreshed.endedAt, source.endedAt);
  assert.equal(refreshed.taskTitle, 'manticoresoftware/Private-Project-Name/Private-provider-description');
  assert.equal(refreshed.description, 'Private provider description');
});

test('moves an imported interval after existing completed Clockoli time without changing that existing record', async () => {
  const github = prepared();
  await importClockifyCompletedRecords({
    github,
    githubUser,
    entries: [{ ...entry('2026-08-18', 'existing'), task: 'Different task' }],
    idFactory: () => '01K2ABCDEF0123456789ABCDEF',
  });
  const overlapping = {
    ...entry('2026-08-18', 'overlap'), startedAt: '2026-08-18T08:30:00.000Z', endedAt: '2026-08-18T09:30:00.000Z', resolvedIssue: {
      url: 'https://github.com/manticoresoftware/clockoli-issues/issues/14', title: 'Different imported task',
    },
  };
  assert.deepEqual(await importClockifyCompletedRecords({ github, githubUser, entries: [overlapping], idFactory: () => '01K2ABCDEF0123456789ABCDEG' }), {
    status: 'imported', added: 1, alreadyPresent: 0,
  });
  const records = parseMonthlyRecords(github.files.get('times/2026-08/ada.jsonl').text, { user: 'ada', path: 'times/2026-08/ada.jsonl' })
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  assert.deepEqual(records.map(record => [record.startedAt, record.endedAt, record.durationSeconds]), [
    ['2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z', 3600],
    ['2026-08-18T09:00:00.000Z', '2026-08-18T10:00:00.000Z', 3600],
  ]);
});

test('cascades an imported interval past every existing Clockoli conflict while preserving duration', async () => {
  const github = prepared();
  const first = { ...entry('2026-08-18', 'fixed-first'), task: 'Fixed first task' };
  const second = {
    ...entry('2026-08-18', 'fixed-second'), task: 'Fixed second task',
    startedAt: '2026-08-18T09:00:00.000Z', endedAt: '2026-08-18T10:00:00.000Z',
  };
  const existingIds = ['01K2ABCDEF0123456789ABCDE1', '01K2ABCDEF0123456789ABCDE2'];
  await importClockifyCompletedRecords({ github, githubUser, entries: [first, second], idFactory: () => existingIds.shift() });
  const overlapping = {
    ...entry('2026-08-18', 'cascade'), task: 'Imported task',
    startedAt: '2026-08-18T08:30:00.000Z', endedAt: '2026-08-18T09:30:00.000Z',
  };

  assert.deepEqual(await importClockifyCompletedRecords({ github, githubUser, entries: [overlapping], idFactory: () => '01K2ABCDEF0123456789ABCDEH' }), {
    status: 'imported', added: 1, alreadyPresent: 0,
  });
  const records = parseMonthlyRecords(github.files.get('times/2026-08/ada.jsonl').text, { user: 'ada', path: 'times/2026-08/ada.jsonl' })
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  assert.deepEqual(records.map(record => [record.startedAt, record.endedAt, record.durationSeconds]), [
    ['2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z', 3600],
    ['2026-08-18T09:00:00.000Z', '2026-08-18T10:00:00.000Z', 3600],
    ['2026-08-18T10:00:00.000Z', '2026-08-18T11:00:00.000Z', 3600],
  ]);
});

test('replays overlapping source intervals in source order without mutating source timestamps', async () => {
  const github = prepared();
  const first = entry('2026-08-18', 'first');
  const second = {
    ...entry('2026-08-18', 'second'),
    startedAt: '2026-08-18T08:30:00.000Z', endedAt: '2026-08-18T09:30:00.000Z',
  };
  const third = {
    ...entry('2026-08-18', 'third'),
    startedAt: '2026-08-18T09:15:00.000Z', endedAt: '2026-08-18T09:45:00.000Z', duration: 1800,
  };
  const importedIds = [
    '01K2ABCDEF0123456789ABCDE1',
    '01K2ABCDEF0123456789ABCDE2',
    '01K2ABCDEF0123456789ABCDE3',
  ];

  const result = await importClockifyCompletedRecords({
    github,
    githubUser,
    entries: [first, second, third],
    idFactory: () => importedIds.shift(),
  });

  assert.deepEqual(result, { status: 'imported', added: 3, alreadyPresent: 0 });
  assert.equal(second.startedAt, '2026-08-18T08:30:00.000Z');
  assert.equal(third.startedAt, '2026-08-18T09:15:00.000Z');
  const records = parseMonthlyRecords(github.files.get('times/2026-08/ada.jsonl').text, { user: 'ada', path: 'times/2026-08/ada.jsonl' });
  assert.deepEqual(records.map(record => [record.startedAt, record.endedAt]), [
    ['2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z'],
    ['2026-08-18T09:00:00.000Z', '2026-08-18T10:00:00.000Z'],
    ['2026-08-18T10:00:00.000Z', '2026-08-18T10:30:00.000Z'],
  ]);
});

test('returns a safe conflict outcome without writing or exposing provider details', async () => {
  const github = prepared();
  github.conflict = true;
  const result = await importClockifyCompletedRecords({ github, githubUser, entries: [entry('2026-08-18', 'conflict')], idFactory: () => '01K2ABCDEF0123456789ABCDEF' });
  assert.deepEqual(result, { status: 'conflict' });
  assert.equal(github.writes.length, 0);
});

test('fails closed when the pre-provisioned metadata or task index is missing', async () => {
  const github = new FakeGitHub();
  assert.deepEqual(await importClockifyCompletedRecords({ github, githubUser, entries: [entry('2026-08-18', 'missing')] }), {
    status: 'failed', failureReason: 'storage_branch_incomplete',
  });
  assert.equal(github.writes.length, 0);
});

test('returns an allowlisted structural reason when the pre-provisioned branch is incomplete', async () => {
  const github = new FakeGitHub();
  assert.deepEqual(await importClockifyCompletedRecords({ github, githubUser, entries: [entry('2026-08-18', 'missing')] }), {
    status: 'failed', failureReason: 'storage_branch_incomplete',
  });
  assert.equal(github.writes.length, 0);
});

test('fails closed rather than replacing an unrelated record with a colliding deterministic import ID', async () => {
  const github = prepared();
  const unrelated = entry('2026-08-18', 'unrelated');
  await importClockifyCompletedRecords({ github, githubUser, entries: [unrelated], idFactory: () => '01K2ABCDEF0123456789ABCDEF' });
  const path = 'times/2026-08/ada.jsonl';
  const [stored] = parseMonthlyRecords(github.files.get(path).text, { user: 'ada', path });
  stored.metadata.clockoli_import.provenance_sha256 = 'a'.repeat(64);
  stored.taskUrl = 'https://github.com/acme/other/issues/999';
  github.seed(path, serializeMonthlyRecords([stored]), github.files.get(path).sha);
  const before = github.files.get(path).text;
  const writes = github.writes.length;

  const result = await importClockifyCompletedRecords({
    github, githubUser, entries: [entry('2026-08-18', 'different-source')], idFactory: () => '01K2ABCDEF0123456789ABCDEF',
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.failureReason, 'invalid_imported_record');
  assert.deepEqual(result.diagnostic, {
    stage: 'preparing_destination_record', code: 'destination_duplicate_record_id', detail: 'Duplicate imported work record ID',
    collision: {
      incoming: {
        recordId: '01K2ABCDEF0123456789ABCDEF', startedAt: '2026-08-18T09:00:00.000Z', endedAt: '2026-08-18T10:00:00.000Z', durationSeconds: 3600,
        provenanceSha256: result.diagnostic.collision.incoming.provenanceSha256,
        taskFingerprintSha256: result.diagnostic.collision.incoming.taskFingerprintSha256,
      },
      existing: {
        recordId: '01K2ABCDEF0123456789ABCDEF', startedAt: '2026-08-18T08:00:00.000Z', endedAt: '2026-08-18T09:00:00.000Z', durationSeconds: 3600,
        provenanceSha256: 'a'.repeat(64), taskFingerprintSha256: result.diagnostic.collision.existing.taskFingerprintSha256, path, line: 1,
      },
      comparison: { sameProvenance: false, sameTimeRange: false, sameTaskFingerprint: false },
    },
  });
  assert.match(result.diagnostic.collision.incoming.provenanceSha256, /^[a-f0-9]{64}$/);
  assert.match(result.diagnostic.collision.incoming.taskFingerprintSha256, /^[a-f0-9]{64}$/);
  assert.match(result.diagnostic.collision.existing.taskFingerprintSha256, /^[a-f0-9]{64}$/);
  assert.equal(github.writes.length, writes);
  assert.equal(github.files.get(path).text, before);
});

test('replays a legacy imported record by deterministic ID when its normalized time changed', async () => {
  const github = prepared();
  const source = entry('2026-08-18', 'legacy-id-replay');
  const idFactory = () => '01K2ABCDEF0123456789ABCDEF';
  await importClockifyCompletedRecords({ github, githubUser, entries: [source], idFactory });
  const path = 'times/2026-08/ada.jsonl';
  const [stored] = parseMonthlyRecords(github.files.get(path).text, { user: 'ada', path });
  stored.startedAt = '2026-08-19T08:00:00.000Z';
  stored.endedAt = '2026-08-19T09:00:00.000Z';
  stored.metadata.clockoli_import.provenance_sha256 = 'b'.repeat(64);
  const serialized = JSON.parse(serializeMonthlyRecords([stored]));
  serialized.activity.local_date = '2026-08-19';
  github.seed(path, `${JSON.stringify(serialized)}\n`, github.files.get(path).sha);

  const result = await importClockifyCompletedRecords({ github, githubUser, entries: [source], idFactory });

  assert.deepEqual(result, { status: 'imported', added: 0, alreadyPresent: 0 });
  const [replayed] = parseMonthlyRecords(github.files.get(path).text, { user: 'ada', path });
  assert.equal(replayed.id, stored.id);
  assert.equal(replayed.startedAt, source.startedAt);
  assert.equal(replayed.endedAt, source.endedAt);
  assert.notEqual(replayed.metadata.clockoli_import.provenance_sha256, 'b'.repeat(64));
});
