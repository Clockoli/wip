import test from 'node:test';
import assert from 'node:assert/strict';
import { importClockifyCompletedRecords } from '../src/services/clockify-record-import.js';
import { emptyTaskIndex, serializeTaskIndex, TASK_INDEX_PATH } from '../src/domain/task-index.js';
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
  };
}

class FakeGitHub {
  constructor() { this.clients = []; this.files = new Map(); this.writes = []; this.conflict = false; }
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
  github.seed(USER_METADATA_PATH, userBranchMetadataText(githubUser));
  github.seed(TASK_INDEX_PATH, serializeTaskIndex(emptyTaskIndex(githubUser.login)));
  return github;
}
function factory() { return ids.shift(); }

test('imports exact records to only the mapped personal branch across affected months with useful Clockify names', async () => {
  const github = prepared();
  const input = [entry('2026-08-31', 'a'), entry('2026-09-01', 'b')];
  const result = await importClockifyCompletedRecords({ github, githubUser, entries: input, idFactory: factory });
  assert.deepEqual(result, { status: 'imported', added: 2, alreadyPresent: 0 });
  assert.deepEqual(github.clients, [{ name: branch, mode: 'custom' }]);
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
  assert.equal(august.taskUrl, 'https://app.clockify.me/reports/detailed?project=raw-project-3');
  assert.notEqual(august.taskUrl, 'https://clockoli.invalid/imported-work');
  assert.equal(august.taskTitle, 'Private Project Name — Private Task Name');
  assert.equal(august.description, 'Private provider description');
  const serialized = `${write.message}\n${write.changes.map(change => change.text).join('\n')}`;
  for (const forbidden of ['raw-entry-a', 'raw-user-77', 'private-tag']) {
    assert.equal(serialized.includes(forbidden), false, `serialized import leaked ${forbidden}`);
  }
  assert.match(august.metadata.clockoli_import.provenance_sha256, /^[a-f0-9]{64}$/);
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
  assert.equal(replayed.taskTitle, 'Private Project Name — Private Task Name');
  assert.equal(replayed.taskUrl, 'https://app.clockify.me/reports/detailed?project=raw-project-3');
  assert.equal(replayed.durationSeconds, source.duration);
  assert.equal(replayed.actor.id, 'github:42');
  assert.match(replayed.metadata.clockoli_import.provenance_sha256, /^[a-f0-9]{64}$/);
});

test('replays a shifted generic-project import after the task is later resolved as a GitHub issue', async () => {
  const github = prepared();
  const source = { ...entry('2026-08-18', 'resolved-replay'), project: 'clockoli-issues', task: '#13 Create a migration plugin for Clockify' };
  await importClockifyCompletedRecords({ github, githubUser, entries: [source], idFactory: () => '01K2ABCDEF0123456789ABCDEF' });
  const path = 'times/2026-08/ada.jsonl';
  const [shifted] = parseMonthlyRecords(github.files.get(path).text, { user: 'ada', path });
  delete shifted.metadata.clockoli_import;
  shifted.startedAt = '2026-08-18T08:30:00.000Z';
  shifted.endedAt = '2026-08-18T09:30:00.000Z';
  shifted.updatedAt = shifted.endedAt;
  github.seed(path, serializeMonthlyRecords([shifted]), github.files.get(path).sha);
  github.resolveRepositoryIssue = async () => ({
    url: 'https://github.com/manticoresoftware/clockoli-issues/issues/13', title: 'Create a migration plugin for Clockify',
  });

  assert.deepEqual(await importClockifyCompletedRecords({ github, githubUser, entries: [source], idFactory: () => '01K2ABCDEF0123456789ABCDEF' }), {
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

test('uses a verified same-owner GitHub issue when a Clockify project and task identify it exactly', async () => {
  const github = prepared();
  github.resolveRepositoryIssue = async request => {
    assert.deepEqual(request, { repository: 'clockoli-issues', number: 13, title: 'Create a migration plugin for Clockify' });
    return { url: 'https://github.com/manticoresoftware/clockoli-issues/issues/13', title: 'Create a migration plugin for Clockify' };
  };
  const source = { ...entry('2026-08-18', 'issue'), project: 'clockoli-issues', task: '#13 Create a migration plugin for Clockify' };
  assert.deepEqual(await importClockifyCompletedRecords({ github, githubUser, entries: [source], idFactory: () => '01K2ABCDEF0123456789ABCDEF' }), {
    status: 'imported', added: 1, alreadyPresent: 0,
  });
  const record = parseMonthlyRecords(github.files.get('times/2026-08/ada.jsonl').text, { user: 'ada', path: 'times/2026-08/ada.jsonl' })[0];
  assert.equal(record.taskUrl, 'https://github.com/manticoresoftware/clockoli-issues/issues/13');
  assert.equal(record.taskTitle, 'Create a migration plugin for Clockify');
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
  assert.equal(refreshed.taskTitle, 'Private Project Name — Private Task Name');
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
  const overlapping = { ...entry('2026-08-18', 'overlap'), startedAt: '2026-08-18T08:30:00.000Z', endedAt: '2026-08-18T09:30:00.000Z' };
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
