import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ReportService, annotateDestinationRecord, loadDestinationRecords, mergeDestinationRecords,
  mergeDestinationTaskSummaries, withoutInternalMetadata,
} from '../src/services/reports.js';
import { applyTaskIndexChanges, emptyTaskIndex, serializeTaskIndex, TASK_INDEX_PATH } from '../src/domain/task-index.js';

const block = (url, start, end, description = '', user = 'alice') => {
  const github = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/(issues|pull)\/(\d+)$/);
  const suffix = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'[Number(github?.[4] || 0) % 32];
  return JSON.stringify({
    schema_version: 1, id: `01K2ABCDEF0123456789ABCDE${suffix}`, record_type: 'work',
    actor: { kind: 'human', id: `github:${user}`, name: user },
    work_item: {
      kind: github?.[3] === 'pull' ? 'github_pr' : github ? 'github_issue' : 'url', id: `url:${url}`, url, title: '',
    },
    activity: {
      state: 'completed', started_at: new Date(start).toISOString(), ended_at: new Date(end).toISOString(),
      local_date: start.slice(0, 10), timezone: 'UTC',
    },
    producer: { kind: 'browser_extension', name: 'clockoli-chrome', version: '0.1.29' },
    description, metadata: {}, metrics: {}, created_at: new Date(start).toISOString(), updated_at: new Date(end).toISOString(),
  });
};
const monthly = (...blocks) => `${blocks.join('\n')}\n`;
const taskIndex = (login, entries) => serializeTaskIndex(applyTaskIndexChanges(emptyTaskIndex(login), {
  add: entries.map((entry, index) => ({
    id: entry.id ?? `01K2ABCDEF0123456789ABCDE${'0123456789ABCDEFGHJKMNPQRSTVWXYZ'[index]}`,
    ...entry,
  })),
}));
const A = 'a'.repeat(40), B = 'b'.repeat(40), C = 'c'.repeat(40);

test('destination records are annotated after parsing without changing their persistent body', () => {
  const persistent = JSON.parse(block('https://example.com/work', '2026-08-17T09:00:00Z', '2026-08-17T10:00:00Z'));
  const record = { id: persistent.id, _record: persistent, _path: 'times/2026-08/alice.jsonl' };
  const annotated = annotateDestinationRecord(record, { id: 'github:1', label: 'acme/personal' });
  assert.equal(annotated.destinationId, 'github:1');
  assert.equal(annotated.timeRepository, 'acme/personal');
  assert.equal('destinationId' in annotated._record, false);
  assert.equal('timeRepository' in annotated._record, false);
  assert.equal('destinationId' in record, false);
});

test('destination merge deduplicates canonical bodies and omits conflicting ULIDs safely', () => {
  const body = JSON.parse(block('https://example.com/work', '2026-08-17T09:00:00Z', '2026-08-17T10:00:00Z'));
  const reordered = Object.fromEntries(Object.entries(body).reverse());
  const conflict = structuredClone(body); conflict.description = 'different private body';
  const destinations = [{ id: 'github:1', label: 'acme/personal' }, { id: 'github:2', label: 'acme/team' }];
  const equal = mergeDestinationRecords([
    { destination: destinations[0], records: [{ id: body.id, _record: body }] },
    { destination: destinations[1], records: [{ id: body.id, _record: reordered }] },
  ], destinations.map(item => item.id));
  assert.equal(equal.records.length, 1);
  assert.deepEqual(equal.records[0].duplicateDestinations, ['github:1', 'github:2']);
  assert.deepEqual(equal.conflicts, []);
  const divergent = mergeDestinationRecords([
    { destination: destinations[0], records: [{ id: body.id, _record: body }] },
    { destination: destinations[1], records: [{ id: body.id, _record: conflict }] },
  ], destinations.map(item => item.id));
  assert.deepEqual(divergent.records, []);
  assert.deepEqual(divergent.conflicts, [{
    code: 'record_id_conflict', id: body.id,
    destinationIds: ['github:1', 'github:2'], timeRepositories: ['acme/personal', 'acme/team'],
  }]);
  assert.doesNotMatch(JSON.stringify(divergent.conflicts), /different private body/);
});

test('exact search rejects even identical duplicate IDs within one destination', () => {
  const body = JSON.parse(block('https://example.com/work', '2026-08-17T09:00:00Z', '2026-08-17T10:00:00Z'));
  const destination = { id: 'one', label: 'team/one' };
  const records = [{ id: body.id, _record: body }, { id: body.id, _record: structuredClone(body) }];
  assert.equal(mergeDestinationRecords([{ destination, records }]).records.length, 1,
    'ordinary report callers retain their existing deduplication contract');
  const exact = mergeDestinationRecords([{ destination, records }], [], { rejectSameDestinationDuplicates: true });
  assert.deepEqual(exact.records, []);
  assert.equal(exact.conflicts[0].code, 'record_id_conflict');
});

test('task summaries merge by canonical URL and user instead of an absent work-record ID', () => {
  const taskUrl = 'https://github.com/acme/app/issues/1';
  const destinations = [{ id: 'github:1', label: 'alice/time' }, { id: 'github:2', label: 'team/time' }];
  const merged = mergeDestinationTaskSummaries([
    { destination: destinations[0], records: [
      { user: 'Alice', taskUrl, durationSeconds: 60, recordIds: ['01K2ABCDEF0123456789ABCDE0'] },
      { user: 'bob', taskUrl, durationSeconds: 120, recordIds: ['01K2ABCDEF0123456789ABCDE1'] },
    ] },
    { destination: destinations[1], records: [
      { user: 'alice', taskUrl, durationSeconds: 180, recordIds: ['01K2ABCDEF0123456789ABCDE2'] },
    ] },
  ], destinations.map(item => item.id));
  assert.deepEqual(merged.conflicts, []);
  assert.deepEqual(merged.records, [
    {
      user: 'Alice', taskUrl, durationSeconds: 240,
      recordIds: ['01K2ABCDEF0123456789ABCDE0', '01K2ABCDEF0123456789ABCDE2'],
      destinationIds: ['github:1', 'github:2'], timeRepositories: ['alice/time', 'team/time'],
    },
    {
      user: 'bob', taskUrl, durationSeconds: 120,
      recordIds: ['01K2ABCDEF0123456789ABCDE1'],
      destinationIds: ['github:1'], timeRepositories: ['alice/time'],
    },
  ]);
});

test('task summaries merge unresolved imported identities without guessing URLs', () => {
  const taskUrl = 'manticoresoftware/NexusRepo/Fixed-last-block-encoding';
  const merged = mergeDestinationTaskSummaries([
    { destination: { id: 'first' }, records: [{ user: 'alice', taskUrl, durationSeconds: 90, recordIds: ['a'] }] },
    { destination: { id: 'second' }, records: [{ user: 'alice', taskUrl, durationSeconds: 30, recordIds: ['b'] }] },
  ]);
  assert.equal(merged.records.length, 1);
  assert.equal(merged.records[0].taskUrl, taskUrl);
  assert.equal(merged.records[0].durationSeconds, 120);
  assert.deepEqual(merged.records[0].destinationIds, ['first', 'second']);
});

test('task summaries omit duplicated record IDs across destinations instead of double-counting them', () => {
  const taskUrl = 'https://github.com/acme/app/issues/1';
  const merged = mergeDestinationTaskSummaries([
    { destination: { id: 'github:1', label: 'one' }, records: [{ user: 'alice', taskUrl, durationSeconds: 60, recordIds: ['same-id'] }] },
    { destination: { id: 'github:2', label: 'two' }, records: [{ user: 'alice', taskUrl, durationSeconds: 60, recordIds: ['same-id'] }] },
  ], ['github:1', 'github:2']);
  assert.deepEqual(merged.records, []);
  assert.deepEqual(merged.conflicts, [{
    code: 'task_summary_record_id_conflict', taskUrl, user: 'alice', recordIds: ['same-id'],
    destinationIds: ['github:1', 'github:2'], timeRepositories: ['one', 'two'],
  }]);
});

test('destination loads isolate ordinary failures, reject all failures, and propagate abort', async () => {
  const destinations = [{ id: 'github:1', label: 'one' }, { id: 'github:2', label: 'two' }];
  const partial = await loadDestinationRecords(destinations, async destination => {
    if (destination.id === 'github:2') throw Object.assign(new Error('token=private'), { code: 'unavailable' });
    return [{ id: '01K2ABCDEF0123456789ABCDE0', _record: { id: '01K2ABCDEF0123456789ABCDE0' } }];
  });
  assert.equal(partial.records.length, 1);
  assert.equal(partial.partial, true);
  assert.deepEqual(partial.readStatus.map(item => [item.destinationId, item.status]), [['github:1', 'ok'], ['github:2', 'error']]);
  assert.doesNotMatch(JSON.stringify(partial.readStatus), /private/);
  await assert.rejects(() => loadDestinationRecords(destinations, async () => { throw new Error('down'); }), error => error?.code === 'all_destinations_failed');
  const controller = new AbortController(); let settled = 0;
  const loading = loadDestinationRecords(destinations, (_destination, signal) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => { settled += 1; reject(signal.reason); }, { once: true });
  }), { signal: controller.signal });
  controller.abort(new DOMException('cancelled', 'AbortError'));
  await assert.rejects(loading, error => error?.name === 'AbortError');
  assert.equal(settled, 2);
});

test('destination loads keep outer repository concurrency bounded', async () => {
  const destinations = Array.from({ length: 9 }, (_, index) => ({ id: `github:${index + 1}`, label: `repo-${index + 1}` }));
  let active = 0, peak = 0;
  await loadDestinationRecords(destinations, async destination => {
    active += 1; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 2));
    active -= 1;
    return [{ id: `record-${destination.id}`, durationSeconds: 1 }];
  }, { concurrency: 3 });
  assert.equal(peak, 3);
});

class MemoryReportCache {
  constructor() { this.value = null; this.saves = 0; }
  async getReportCache(key) { return this.value?.repositoryKey === key ? structuredClone(this.value) : null; }
  async saveReportCache(value) { this.value = structuredClone(value); this.saves += 1; }
}

class FakeGitHub {
  constructor() {
    this.repositoryKey = 'acme/time-data@main';
    this.etag = '"one"';
    this.notModified = false;
    this.files = new Map([
      ['times/2026-08/alice.jsonl', { sha: A, text: monthly(
        block('https://github.com/acme/app/issues/1', '2026-08-17T09:00:00+00:00', '2026-08-17T10:00:00+00:00'),
        block('https://github.com/acme/api/issues/3', '2026-08-18T09:00:00+00:00', '2026-08-18T10:00:00+00:00'),
        block('https://github.com/acme/app/issues/4', '2026-08-19T09:00:00+00:00', '2026-08-19T10:00:00+00:00')) }],
      ['times/2026-08/bob.jsonl', { sha: B, text: monthly(block('https://github.com/acme/app/pull/2', '2026-08-17T10:00:00+00:00', '2026-08-17T12:00:00+00:00', 'review', 'bob')) }],
    ]);
    this.snapshots = [];
    this.reads = [];
    this.textReads = [];
  }
  async listTextFilesSnapshot(prefix, { etag, signal } = {}) {
    assert.equal(prefix, 'times/');
    signal?.throwIfAborted();
    this.snapshots.push({ etag });
    if (this.notModified && etag === this.etag) return { notModified: true, etag: this.etag };
    return { notModified: false, etag: this.etag, files: [...this.files].map(([path, file]) => ({ path, sha: file.sha, size: new TextEncoder().encode(file.text).length })) };
  }
  async getBlobText(path, sha, { signal } = {}) {
    signal?.throwIfAborted();
    this.reads.push(path);
    const file = this.files.get(path);
    assert.equal(sha, file.sha);
    return { path, sha, text: file.text };
  }
  async getText(path, { signal } = {}) {
    signal?.throwIfAborted(); this.textReads.push(path);
    const file = this.files.get(path);
    if (!file) throw Object.assign(new Error('missing'), { status: 404, code: 'not_found' });
    return { path, sha: file.sha, text: file.text };
  }
}

test('ReportService retains unknown persistent fields until cross-destination conflict detection', async () => {
  const taskUrl = 'https://github.com/acme/app/issues/1';
  const base = JSON.parse(block(taskUrl, '2026-08-17T09:00:00Z', '2026-08-17T10:00:00Z'));
  const changed = structuredClone(base);
  changed.unknown_root = { revision: 2 };
  changed.work_item.unknown_work_item = 'private-extension';
  changed.activity.unknown_activity = true;
  const destinations = [{ id: 'github:1', label: 'alice/time' }, { id: 'github:2', label: 'team/time' }];
  const githubs = [new FakeGitHub(), new FakeGitHub()];
  githubs[0].files = new Map([['times/2026-08/alice.jsonl', { sha: A, text: monthly(JSON.stringify(base)) }]]);
  githubs[1].repositoryKey = 'acme/team-time@main';
  githubs[1].files = new Map([['times/2026-08/alice.jsonl', { sha: B, text: monthly(JSON.stringify(changed)) }]]);
  const loaded = await loadDestinationRecords(destinations, (destination, signal) => {
    const index = destinations.findIndex(item => item.id === destination.id);
    return new ReportService({ github: githubs[index] }).loadRange(
      { startDate: '2026-08-17', endDate: '2026-08-17' }, { includeStorageMetadata: true, signal },
    );
  });
  assert.equal(loaded.partial, true);
  assert.deepEqual(loaded.records, []);
  assert.deepEqual(loaded.conflicts.map(item => [item.code, item.id]), [['record_id_conflict', base.id]]);
  assert.deepEqual(withoutInternalMetadata({ ...changed, _record: changed, _path: 'private', destinationId: 'github:2' }), {
    ...changed, destinationId: 'github:2',
  });
});

test('report service loads monthly files and filters records to the inclusive date range', async () => {
  const github = new FakeGitHub(), cache = new MemoryReportCache();
  const records = await new ReportService({ github, cache }).loadRange({ startDate: '2026-08-17', endDate: '2026-08-18' });
  assert.deepEqual(github.reads.sort(), ['times/2026-08/alice.jsonl', 'times/2026-08/bob.jsonl']);
  assert.deepEqual(records.map(item => [item.user, item.entryDate, item.issue.type, item.durationSeconds]), [
    ['alice', '2026-08-17', 'issue', 3600],
    ['bob', '2026-08-17', 'pull_request', 7200],
    ['alice', '2026-08-18', 'issue', 3600],
  ]);
  assert.equal(Object.keys(records[0]).some(key => key.startsWith('_')), false);
});

test('task participant loading reads only the mandatory per-user task index', async () => {
  const github = new FakeGitHub(), cache = new MemoryReportCache();
  github.files.set(TASK_INDEX_PATH, { sha: 'd'.repeat(40), text: taskIndex('alice', [
    { taskUrl: 'https://github.com/acme/app/issues/1', durationSeconds: 1800 },
    { taskUrl: 'https://github.com/acme/app/issues/1', durationSeconds: 3600 },
    { taskUrl: 'https://github.com/acme/app/issues/99', durationSeconds: 999 },
  ]) });

  const records = await new ReportService({ github, cache }).loadRepositoryTask(
    'https://github.com/acme/app/issues/1',
  );

  assert.deepEqual(records, [{
    user: 'alice', taskUrl: 'https://github.com/acme/app/issues/1', durationSeconds: 5400,
    recordIds: ['01K2ABCDEF0123456789ABCDE0', '01K2ABCDEF0123456789ABCDE1'],
  }]);
  assert.deepEqual(github.textReads, [TASK_INDEX_PATH]);
  assert.deepEqual(github.reads, [], 'sidebar task totals must not read monthly blobs');
});

test('task catalog reads marked personal indexes without downloading monthly history', async () => {
  const primary = new FakeGitHub(), personal = new FakeGitHub();
  primary.forBranch = branch => branch === 'main' ? primary : personal;
  primary.listBranches = async () => ['clockoli/users/123'];
  personal.repositoryKey = 'acme/time-data@clockoli/users/123';
  personal.files = new Map([[TASK_INDEX_PATH, { sha: 'f'.repeat(40),
    text: taskIndex('alice', [{ taskUrl: 'https://example.com/forgotten', durationSeconds: 30, taskTitle: 'Year-old work' }]) }]]);
  personal.getText = async path => ({ path, text: JSON.stringify({ version: 1, githubUserId: 123, storageLogin: 'alice' }) });
  const cache = new MemoryReportCache();
  const result = await new ReportService({ github: primary, cache }).loadRepositoryTaskCatalog({ defaultBranch: 'main' });
  assert.deepEqual(result.tasks.map(item => [item.taskUrl, item.title]), [['https://example.com/forgotten', 'Year-old work']]);
  assert.deepEqual(result.tasks[0].recordIds, result.recordIds,
    'the private catalog retains per-task IDs for pending deletion and move projection');
  assert.deepEqual(personal.reads, [TASK_INDEX_PATH]);
  assert.equal(personal.snapshots.length, 1);
  personal.notModified = true;
  const warm = await new ReportService({ github: primary, cache }).loadRepositoryTaskCatalog({ defaultBranch: 'main' });
  assert.deepEqual(warm.tasks, result.tasks);
  assert.deepEqual(personal.reads, [TASK_INDEX_PATH], 'warm service-worker restart reads no unchanged blob');
  assert.equal(personal.snapshots.at(-1).etag, personal.etag);
  personal.notModified = false; personal.etag = '"two"';
  personal.files.set(TASK_INDEX_PATH, { sha: C, text: taskIndex('alice', [
    { taskUrl: 'https://example.com/forgotten', durationSeconds: 30, taskTitle: 'Revised title' },
  ]) });
  const changed = await new ReportService({ github: primary, cache }).loadRepositoryTaskCatalog({ defaultBranch: 'main' });
  assert.deepEqual(changed.tasks.map(item => item.title), ['Revised title']);
  assert.deepEqual(personal.reads, [TASK_INDEX_PATH, TASK_INDEX_PATH]);
});

test('search fallback retains different bodies sharing an ID within a repository', async () => {
  const primary = new FakeGitHub(), personal = new FakeGitHub();
  primary.forBranch = branch => branch === 'main' ? primary : personal;
  primary.listBranches = async () => ['clockoli/users/123'];
  personal.repositoryKey = 'acme/time-data@clockoli/users/123';
  const record = JSON.parse(block('https://github.com/acme/app/issues/1', '2025-01-01T09:00:00Z', '2025-01-01T10:00:00Z'));
  const duplicate = structuredClone(record);
  duplicate.activity.started_at = '2025-02-01T09:00:00.000Z';
  duplicate.activity.ended_at = '2025-02-01T10:00:00.000Z';
  duplicate.activity.local_date = '2025-02-01';
  personal.files = new Map([
    ['times/2025-01/alice.jsonl', { sha: A, text: monthly(JSON.stringify(record)) }],
    ['times/2025-02/alice.jsonl', { sha: C, text: monthly(JSON.stringify(duplicate)) }],
  ]);
  personal.getText = async () => ({ text: JSON.stringify({ version: 1, githubUserId: 123, storageLogin: 'alice' }) });
  const service = new ReportService({ github: primary, cache: new MemoryReportCache() });
  const range = { startDate: '2025-01-01', endDate: '2025-02-28' };
  assert.equal((await service.loadRepositoryRange(range, { defaultBranch: 'main' })).length, 1);
  const raw = await service.loadRepositoryRange(range, { defaultBranch: 'main', preserveDuplicateIds: true, includeStorageMetadata: true });
  assert.equal(raw.length, 2);
  const merged = mergeDestinationRecords([{ destination: { id: 'one', label: 'acme/time-data' }, records: raw }]);
  assert.equal(merged.records.length, 0);
  assert.equal(merged.conflicts[0].code, 'record_id_conflict');
});

test('task catalog fills missing old titles from completed history without writing to colleagues branches', async () => {
  const primary = new FakeGitHub(), personal = new FakeGitHub();
  primary.forBranch = branch => branch === 'main' ? primary : personal;
  primary.listBranches = async () => ['clockoli/users/123'];
  personal.repositoryKey = 'acme/time-data@clockoli/users/123';
  const url = 'https://github.com/acme/app/issues/1';
  const historical = block(url, '2025-01-01T09:00:00Z', '2025-01-01T10:00:00Z');
  const record = JSON.parse(historical); record.work_item.title = 'Old task title';
  personal.files = new Map([
    ['times/2025-01/alice.jsonl', { sha: A, text: monthly(JSON.stringify(record)) }],
    [TASK_INDEX_PATH, { sha: B, text: taskIndex('alice', [{ id: record.id, taskUrl: url, durationSeconds: 3600 }]) }],
  ]);
  const getText = personal.getText.bind(personal);
  personal.getText = async path => path === '.clockoli/user.json'
    ? { text: JSON.stringify({ version: 1, githubUserId: 123, storageLogin: 'alice' }) }
    : getText(path);
  const cache = new MemoryReportCache();
  const result = await new ReportService({ github: primary, cache })
    .loadRepositoryTaskCatalog({ defaultBranch: 'main' });
  assert.deepEqual(result.tasks.map(item => [item.taskUrl, item.title]), [[url, 'Old task title']]);
  assert.deepEqual(personal.reads, [TASK_INDEX_PATH, 'times/2025-01/alice.jsonl']);
  personal.notModified = true;
  const warm = await new ReportService({ github: primary, cache }).loadRepositoryTaskCatalog({ defaultBranch: 'main' });
  assert.deepEqual(warm.tasks, result.tasks);
  assert.equal(personal.reads.length, 2, 'unchanged old index reuses locally reconstructed names');
  personal.notModified = false; personal.etag = '"two"';
  const revised = structuredClone(record); revised.work_item.title = 'Renamed old task';
  personal.files.set('times/2025-01/alice.jsonl', { sha: C, text: monthly(JSON.stringify(revised)) });
  const refreshed = await new ReportService({ github: primary, cache }).loadRepositoryTaskCatalog({ defaultBranch: 'main' });
  assert.equal(refreshed.tasks[0].title, 'Renamed old task');
});

test('legacy title reconstruction rejects a repeated record ID across monthly files', async () => {
  const primary = new FakeGitHub(), personal = new FakeGitHub();
  primary.forBranch = branch => branch === 'main' ? primary : personal;
  primary.listBranches = async () => ['clockoli/users/123'];
  personal.repositoryKey = 'acme/time-data@clockoli/users/123';
  const url = 'https://github.com/acme/app/issues/1';
  const record = JSON.parse(block(url, '2025-01-01T09:00:00Z', '2025-01-01T10:00:00Z'));
  const duplicate = structuredClone(record);
  duplicate.activity.started_at = '2025-02-01T09:00:00.000Z';
  duplicate.activity.ended_at = '2025-02-01T10:00:00.000Z';
  duplicate.activity.local_date = '2025-02-01';
  personal.files = new Map([
    ['times/2025-01/alice.jsonl', { sha: A, text: monthly(JSON.stringify(record)) }],
    ['times/2025-02/alice.jsonl', { sha: C, text: monthly(JSON.stringify(duplicate)) }],
    [TASK_INDEX_PATH, { sha: B, text: taskIndex('alice', [{ id: record.id, taskUrl: url, durationSeconds: 3600 }]) }],
  ]);
  const getText = personal.getText.bind(personal);
  personal.getText = async path => path === '.clockoli/user.json'
    ? { text: JSON.stringify({ version: 1, githubUserId: 123, storageLogin: 'alice' }) }
    : getText(path);
  await assert.rejects(() => new ReportService({ github: primary, cache: new MemoryReportCache() })
    .loadRepositoryTaskCatalog({ defaultBranch: 'main' }), /duplicate|match completed records/i);
});

test('task catalog refuses understated index bytes before persisting a cache entry', async () => {
  const primary = new FakeGitHub(), personal = new FakeGitHub(), cache = new MemoryReportCache();
  primary.forBranch = branch => branch === 'main' ? primary : personal;
  primary.listBranches = async () => ['clockoli/users/123'];
  personal.repositoryKey = 'acme/time-data@clockoli/users/123';
  personal.files = new Map([[TASK_INDEX_PATH, { sha: A, text: taskIndex('alice', [
    { taskUrl: 'https://example.com/old', durationSeconds: 30, taskTitle: 'A task title' },
  ]) }]]);
  personal.getText = async () => ({ text: JSON.stringify({ version: 1, githubUserId: 123, storageLogin: 'alice' }) });
  const snapshot = personal.listTextFilesSnapshot.bind(personal);
  personal.listTextFilesSnapshot = async (...args) => {
    const value = await snapshot(...args);
    value.files[0].size = 1;
    return value;
  };
  await assert.rejects(() => new ReportService({ github: primary, cache }).loadRepositoryTaskCatalog({
    defaultBranch: 'main', budgets: { maxTotalBytes: 20, maxBytes: 20 },
  }), error => error.code === 'task_scan_budget');
  assert.equal(cache.saves, 0);
});

test('task participant loading fails closed when the first-version index is missing or malformed', async () => {
  const github = new FakeGitHub(), cache = new MemoryReportCache();
  await assert.rejects(() => new ReportService({ github, cache }).loadRepositoryTask('https://github.com/acme/app/issues/1'), /task index/i);
  github.files.set(TASK_INDEX_PATH, { sha: 'd'.repeat(40), text: '{"version":1}' });
  await assert.rejects(() => new ReportService({ github, cache }).loadRepositoryTask('https://github.com/acme/app/issues/1'), /task index/i);
});

test('unchanged branch snapshot reuses persistent SHA blobs without blob requests', async () => {
  const github = new FakeGitHub(), cache = new MemoryReportCache();
  const service = new ReportService({ github, cache });
  await service.loadRange({ startDate: '2026-08-01', endDate: '2026-08-31' });
  assert.equal(github.reads.length, 2);
  github.notModified = true;
  const records = await new ReportService({ github, cache }).loadRange({ startDate: '2026-08-17', endDate: '2026-08-18' });
  assert.equal(github.reads.length, 2, '304 snapshot must not re-download immutable blobs');
  assert.equal(github.snapshots.at(-1).etag, '"one"');
  assert.equal(records.length, 3);
});

test('ETag-only report cache is refreshed unconditionally instead of failing on 304', async () => {
  const github = new FakeGitHub(), cache = new MemoryReportCache();
  cache.value = { version: 1, repositoryKey: github.repositoryKey, etag: github.etag, files: [], blobs: {} };
  github.notModified = true;

  const records = await new ReportService({ github, cache }).loadRange({ startDate: '2026-08-17', endDate: '2026-08-18' });

  assert.equal(github.snapshots[0].etag, '', 'an ETag without a complete cached file snapshot must not be sent');
  assert.equal(records.length, 3);
  assert.equal(cache.value.snapshotReady, true);
});

test('explicit incomplete or malformed cache markers never authorize a conditional snapshot request', async () => {
  for (const snapshotReady of [false, 'yes', 1, null]) {
    const github = new FakeGitHub(), cache = new MemoryReportCache();
    cache.value = {
      version: 1,
      repositoryKey: github.repositoryKey,
      etag: github.etag,
      snapshotReady,
      files: [...github.files].slice(0, 1).map(([path, file]) => ({ path, sha: file.sha, size: new TextEncoder().encode(file.text).length })),
      blobs: {},
    };
    github.notModified = true;

    const records = await new ReportService({ github, cache }).loadRange({ startDate: '2026-08-17', endDate: '2026-08-18' });

    assert.equal(github.snapshots[0].etag, '', `marker ${String(snapshotReady)} must force an unconditional snapshot refresh`);
    assert.equal(records.length, 3);
    assert.equal(cache.value.snapshotReady, true);
  }
});

test('a confirmed empty report snapshot can use its ETag on a warm reload', async () => {
  const github = new FakeGitHub(), cache = new MemoryReportCache();
  github.files.clear();
  const service = new ReportService({ github, cache });

  assert.deepEqual(await service.loadRange({ startDate: '2026-08-01', endDate: '2026-08-31' }), []);
  assert.equal(cache.value.snapshotReady, true);
  github.notModified = true;
  assert.deepEqual(await service.loadRange({ startDate: '2026-08-01', endDate: '2026-08-31' }), []);
  assert.equal(github.snapshots.at(-1).etag, '"one"');
});

test('changed branch fetches only blobs whose immutable SHA is missing', async () => {
  const github = new FakeGitHub(), cache = new MemoryReportCache(), service = new ReportService({ github, cache });
  await service.loadRange({ startDate: '2026-08-01', endDate: '2026-08-31' });
  github.etag = '"two"';
  github.files.set('times/2026-08/bob.jsonl', { sha: C, text: monthly(block('https://github.com/acme/app/pull/2', '2026-08-17T10:00:00+00:00', '2026-08-17T13:00:00+00:00', 'updated', 'bob')) });
  github.reads = [];
  const records = await service.loadRange({ startDate: '2026-08-17', endDate: '2026-08-17' });
  assert.deepEqual(github.reads, ['times/2026-08/bob.jsonl']);
  assert.deepEqual(records.map(record => record.durationSeconds), [3600, 10800]);
});

test('report cache survives an interrupted load and resumes from downloaded SHAs', async () => {
  const github = new FakeGitHub(), cache = new MemoryReportCache(), controller = new AbortController();
  const original = github.getBlobText.bind(github);
  github.getBlobText = async (...args) => {
    const result = await original(...args);
    if (github.reads.length === 1) controller.abort();
    return result;
  };
  await assert.rejects(() => new ReportService({ github, cache, concurrency: 1 }).loadRange({ startDate: '2026-08-01', endDate: '2026-08-31' }, { signal: controller.signal }), error => error?.name === 'AbortError');
  assert.equal(Object.keys(cache.value.blobs).length, 1);
  github.getBlobText = original; github.reads = [];
  await new ReportService({ github, cache, concurrency: 1 }).loadRange({ startDate: '2026-08-01', endDate: '2026-08-31' });
  assert.equal(github.reads.length, 1);
});

test('report service rejects invalid ranges before touching GitHub', async () => {
  const github = new FakeGitHub();
  await assert.rejects(() => new ReportService({ github }).loadRange({ startDate: '2026-08-20', endDate: '2026-08-19' }), /end date/i);
  assert.equal(github.snapshots.length, 0);
});

test('report service identifies the malformed monthly file that must be repaired', async () => {
  const github = new FakeGitHub();
  github.files = new Map([['times/2026-08/alice.jsonl', { sha: 'd'.repeat(40), text: 'URL: not-a-github-url\nStart: 2026-08-18T08:00:00+00:00\nEnd: 2026-08-18T09:00:00+00:00\n' }]]);
  await assert.rejects(() => new ReportService({ github }).loadRange({ startDate: '2026-08-18', endDate: '2026-08-18' }), /Invalid time data in times\/2026-08\/alice\.jsonl/);
});

test('current-user task loading never fetches or parses another user monthly file', async () => {
  const github = new FakeGitHub();
  github.files.set('times/2026-08/bob.jsonl', { sha: B, text: 'malformed hostile data' });
  const records = await new ReportService({ github }).loadUserRange(
    { startDate: '2026-08-17', endDate: '2026-08-18' }, 'alice',
  );
  assert.deepEqual(github.reads, ['times/2026-08/alice.jsonl']);
  assert.equal(records.every(record => record.user === 'alice'), true);
});

test('current-user task loading enforces file and record budgets before returning partial data', async () => {
  const github = new FakeGitHub(), service = new ReportService({ github });
  await assert.rejects(() => service.loadUserRange(
    { startDate: '2026-08-01', endDate: '2026-08-31' }, 'alice', {}, { maxFiles: 0 },
  ), /file budget/i);
  assert.equal(github.reads.length, 0);
  await assert.rejects(() => service.loadUserRange(
    { startDate: '2026-08-01', endDate: '2026-08-31' }, 'alice', {}, { maxRecords: 2 },
  ), /record budget/i);
});

test('an understated blob size cannot persist content beyond the aggregate search byte limit', async () => {
  const github = new FakeGitHub(), cache = new MemoryReportCache();
  github.files = new Map([['times/2026-08/alice.jsonl', { sha: A,
    text: monthly(block('https://example.org/task', '2026-08-17T09:00:00Z', '2026-08-17T10:00:00Z')) }]]);
  const original = github.listTextFilesSnapshot.bind(github);
  github.listTextFilesSnapshot = async (...args) => {
    const snapshot = await original(...args);
    return { ...snapshot, files: snapshot.files.map(file => ({ ...file, size: 1 })) };
  };
  await assert.rejects(() => new ReportService({ github, cache }).loadRepositoryRange(
    { startDate: '2026-08-01', endDate: '2026-08-31' },
    { budgets: { maxFiles: 1, maxBytes: 100, maxRecords: 100,
      maxTotalFiles: 1, maxTotalBytes: 100, maxTotalRecords: 100 } },
  ), error => error.code === 'task_scan_budget' || /byte budget/i.test(error.message));
  assert.deepEqual(Object.keys(cache.value?.blobs ?? {}), [], 'oversized content never enters the report cache');
});

test('current-user loading refreshes an incomplete size-less cache before byte preflight', async () => {
  const github = new FakeGitHub(), cache = new MemoryReportCache(), service = new ReportService({ github, cache });
  await service.loadRange({ startDate: '2026-08-01', endDate: '2026-08-31' });
  cache.value.files = cache.value.files.map(({ path, sha }) => ({ path, sha }));
  github.notModified = true;
  await service.loadUserRange({ startDate: '2026-08-01', endDate: '2026-08-31' }, 'alice');
  assert.equal(github.snapshots.at(-1).etag, '', 'legacy cache must be refreshed so tree blob sizes are known before reads');
  assert.ok(cache.value.files.every(file => Number.isSafeInteger(file.size)));
});


test('repository reports read only canonical personal branches and never merge default-branch data', async () => {
  const primary = new FakeGitHub(), personal = new FakeGitHub();
  primary.repositoryKey = 'acme/time-data@main';
  personal.repositoryKey = 'acme/time-data@clockoli/users/123';
  primary.files.set('times/2026-08/alice.jsonl', { sha: A, text: monthly(
    block('https://github.com/acme/app/issues/1', '2026-08-17T09:00:00+00:00', '2026-08-17T10:00:00+00:00'),
    block('https://github.com/acme/app/issues/8', '2026-08-17T13:00:00+00:00', '2026-08-17T14:00:00+00:00'),
  ) });
  personal.files.set('times/2026-08/alice.jsonl', { sha: 'd'.repeat(40), text: monthly(
    block('https://github.com/acme/app/issues/1', '2026-08-17T09:00:00+00:00', '2026-08-17T10:00:00+00:00'),
    block('https://github.com/acme/app/issues/9', '2026-08-17T08:00:00+00:00', '2026-08-17T09:30:00+00:00'),
  ) });
  const clients = new Map([['main', primary], ['clockoli/users/123', personal]]);
  for (const client of clients.values()) client.forBranch = branch => clients.get(branch);
  primary.listBranches = async prefix => ['clockoli/users/123'].filter(branch => branch.startsWith(prefix));
  personal.listBranches = primary.listBranches;
  personal.getText = async path => ({ path, sha: 'e'.repeat(40), text: JSON.stringify({ version: 1, githubUserId: 123, storageLogin: 'alice' }) });
  const cacheValues = new Map();
  const cache = {
    async getReportCache(key) { return structuredClone(cacheValues.get(key) || null); },
    async saveReportCache(value) { cacheValues.set(value.repositoryKey, structuredClone(value)); },
  };
  const records = await new ReportService({ github: personal, cache }).loadRepositoryRange(
    { startDate: '2026-08-17', endDate: '2026-08-17' }, { defaultBranch: 'main' },
  );
  assert.deepEqual(records.map(record => [record.user, record.issue.number, record.durationSeconds]), [
    ['alice', 9, 5400],
    ['alice', 1, 3600],
  ]);
  assert.equal(primary.reads.length, 0, 'the default branch is metadata-only and never a legacy data source');
});

test('all-time task catalog can scan more than thirteen cached months per person', async () => {
  const defaultGithub = new FakeGitHub(), personal = new FakeGitHub();
  personal.files.clear();
  defaultGithub.repositoryKey = 'acme/team@main';
  personal.repositoryKey = 'acme/team@clockoli/users/123';
  defaultGithub.forBranch = branch => branch === 'main' ? defaultGithub : personal;
  defaultGithub.listBranches = async () => ['clockoli/users/123'];
  personal.forBranch = defaultGithub.forBranch;
  personal.listBranches = defaultGithub.listBranches;
  personal.getText = async () => ({ text: JSON.stringify({ version: 1, githubUserId: 123, storageLogin: 'alice' }) });
  for (let month = 1; month <= 14; month++) {
    const date = new Date(Date.UTC(2025, month - 1, 1)).toISOString().slice(0, 10);
    const path = `times/${date.slice(0, 7)}/alice.jsonl`;
    personal.files.set(path, { sha: month.toString(16).padStart(40, '0'),
      text: monthly(block(`https://github.com/acme/app/issues/${month}`, `${date}T09:00:00Z`, `${date}T10:00:00Z`)) });
  }
  const values = new Map();
  const cache = { getReportCache: async key => structuredClone(values.get(key) || null),
    saveReportCache: async value => values.set(value.repositoryKey, structuredClone(value)) };
  const service = new ReportService({ github: personal, cache });
  const range = { startDate: '0001-01-01', endDate: '9999-12-31' };
  const options = { defaultBranch: 'main', budgets: { maxFiles: 120, maxBytes: 100 * 1024 * 1024, maxRecords: 500000 } };
  assert.equal((await service.loadRepositoryRange(range, options)).length, 14);
  assert.equal(personal.reads.length, 14);
  assert.equal((await new ReportService({ github: personal, cache }).loadRepositoryRange(range, options)).length, 14);
  assert.equal(personal.reads.length, 14, 'worker restart reuses persisted SHA-keyed monthly blobs');
});

test('all-time task reads refuse an aggregate limit before downloading the next user files', async () => {
  const defaultGithub = new FakeGitHub(), personal = new FakeGitHub();
  personal.files.clear(); personal.repositoryKey = 'acme/team@clockoli/users/123';
  defaultGithub.forBranch = branch => branch === 'main' ? defaultGithub : personal;
  defaultGithub.listBranches = async () => ['clockoli/users/123'];
  personal.forBranch = defaultGithub.forBranch;
  personal.listBranches = defaultGithub.listBranches;
  personal.getText = async () => ({ text: JSON.stringify({ version: 1, githubUserId: 123, storageLogin: 'alice' }) });
  for (let month = 1; month <= 3; month++) {
    const path = `times/2026-0${month}/alice.jsonl`;
    personal.files.set(path, { sha: month.toString(16).padStart(40, '0'),
      text: monthly(block(`https://example.org/task/${month}`, `2026-0${month}-01T09:00:00Z`, `2026-0${month}-01T10:00:00Z`)) });
  }
  const service = new ReportService({ github: defaultGithub });
  await assert.rejects(() => service.loadRepositoryRange({ startDate: '2026-01-01', endDate: '2026-03-31' }, {
    defaultBranch: 'main', budgets: { maxFiles: 120, maxBytes: 20 * 1024 * 1024, maxRecords: 50000,
      maxUsers: 10, maxTotalFiles: 2, maxTotalBytes: 30 * 1024 * 1024, maxTotalRecords: 100000 },
  }), error => error.code === 'task_scan_budget');
  assert.equal(personal.reads.length, 0, 'aggregate file budget is enforced before downloading blobs');
});

test('repository task loading reads one index per personal branch with bounded concurrency', async () => {
  const primary = new FakeGitHub(), users = ['alice', 'bob', 'carol'];
  const clients = new Map([['main', primary]]);
  let active = 0, maxActive = 0;
  for (const [index, login] of users.entries()) {
    const branch = `clockoli/users/${index + 1}`, client = new FakeGitHub();
    client.repositoryKey = `acme/time-data@${branch}`;
    client.files = new Map([[TASK_INDEX_PATH, {
      sha: String(index + 1).repeat(40),
      text: taskIndex(login, [{ taskUrl: 'https://github.com/acme/app/issues/1', durationSeconds: 3600 }]),
    }]]);
    client.getText = async (path, { signal } = {}) => {
      if (path === '.clockoli/user.json') return { text: JSON.stringify({ version: 1, githubUserId: index + 1, storageLogin: login }) };
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 20));
      try { signal?.throwIfAborted(); return { path, ...client.files.get(path) }; }
      finally { active -= 1; }
    };
    clients.set(branch, client);
  }
  for (const client of clients.values()) client.forBranch = branch => clients.get(branch);
  primary.listBranches = async () => [...clients.keys()].filter(branch => branch !== 'main');

  const records = await new ReportService({ github: primary, concurrency: 2 }).loadRepositoryTask(
    'https://github.com/acme/app/issues/1', { defaultBranch: 'main' },
  );

  assert.deepEqual(records.map(record => record.user).sort(), users);
  assert.equal(maxActive, 2, 'task index reads must not exceed the configured cap');
  assert.ok([...clients.values()].every(client => client.reads.length === 0), 'monthly blobs are never read');
});

test('imported task eligibility can be checked against other marked branches from a personal client', async () => {
  const personal = new FakeGitHub(), teammate = new FakeGitHub();
  personal.repositoryKey = 'acme/team@clockoli/users/1';
  teammate.repositoryKey = 'acme/team@clockoli/users/2';
  personal.listBranches = async () => ['clockoli/users/1', 'clockoli/users/2'];
  personal.forBranch = branch => branch === 'clockoli/users/1' ? personal : teammate;
  personal.getText = async path => ({ text: path === '.clockoli/user.json'
    ? JSON.stringify({ version: 1, githubUserId: 1, storageLogin: 'alice' }) : taskIndex('alice', []) });
  teammate.getText = async path => ({ text: path === '.clockoli/user.json'
    ? JSON.stringify({ version: 1, githubUserId: 2, storageLogin: 'bob' })
    : taskIndex('bob', [{ taskUrl: 'acme/project/imported', durationSeconds: 30 }]) });
  const result = await new ReportService({ github: personal }).loadRepositoryTask('acme/project/imported', { scanAllUsers: true });
  assert.deepEqual(result.map(item => item.user), ['bob']);
});

test('repository task loading aborts and settles sibling index reads before rejecting', async () => {
  const primary = new FakeGitHub(), clients = new Map([['main', primary]]);
  const failure = new Error('branch scan failed');
  let siblingAborted = false, saves = 0, parentRejected = false, workAfterReject = false;
  for (const [index, login] of ['alice', 'bob'].entries()) {
    const branch = `clockoli/users/${index + 1}`, client = new FakeGitHub();
    client.repositoryKey = `acme/time-data@${branch}`;
    client.getText = async (path, { signal } = {}) => {
      if (path === '.clockoli/user.json') return { text: JSON.stringify({ version: 1, githubUserId: index + 1, storageLogin: login }) };
      if (index === 0) {
        await new Promise(resolve => setTimeout(resolve, 5));
        throw failure;
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          workAfterReject ||= parentRejected;
          resolve({ text: taskIndex(login, []) });
        }, 100);
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          siblingAborted = true;
          reject(signal.reason);
        }, { once: true });
      });
    };
    clients.set(branch, client);
  }
  for (const client of clients.values()) client.forBranch = branch => clients.get(branch);
  primary.listBranches = async () => [...clients.keys()].filter(branch => branch !== 'main');
  const cache = {
    async getReportCache() { return null; },
    async saveReportCache() { saves += 1; workAfterReject ||= parentRejected; },
  };

  await assert.rejects(
    () => new ReportService({ github: primary, cache, concurrency: 2 }).loadRepositoryTask(
      'https://github.com/acme/app/issues/1', { defaultBranch: 'main' },
    ).finally(() => { parentRejected = true; }),
    error => error?.cause === failure && /task index/i.test(error.message),
  );
  await new Promise(resolve => setTimeout(resolve, 120));

  assert.equal(siblingAborted, true, 'the first branch failure must abort sibling scans');
  assert.equal(saves, 0, 'task-index reads do not persist partial report caches');
  assert.equal(workAfterReject, false, 'no sibling work may continue after the parent rejects');
});


test('UTC ranges fetch both adjacent local months and filter candidates by UTC date', async () => {
  const github = new FakeGitHub(); github.files.clear();
  for (const [month, start, zone, sha, issue] of [
    ['2026-07', '2026-08-01T01:00:00Z', 'America/New_York', A, 1],
    ['2026-08', '2026-07-31T22:00:00Z', 'Europe/Berlin', B, 2],
    ['2026-09', '2026-08-31T22:30:00Z', 'Europe/Berlin', C, 3],
  ]) {
    const value = JSON.parse(block(`https://github.com/acme/app/issues/${issue}`, start, new Date(Date.parse(start) + 3600000).toISOString()));
    value.activity.local_date = month + (month === '2026-07' ? '-31' : '-01'); value.activity.timezone = zone;
    github.files.set(`times/${month}/alice.jsonl`, { sha, text: monthly(JSON.stringify(value)) });
  }
  const service = new ReportService({ github });
  const utc = await service.loadRepositoryRange({ startDate: '2026-08-01', endDate: '2026-08-31', reportingUtc: true });
  assert.deepEqual(github.reads.sort(), ['times/2026-07/alice.jsonl', 'times/2026-08/alice.jsonl', 'times/2026-09/alice.jsonl']);
  assert.deepEqual(utc.map(record => record.issue.number), [1, 3]);
  assert.deepEqual(utc.map(record => record.entryDate), ['2026-07-31', '2026-09-01']);
  github.reads = [];
  const local = await service.loadRange({ startDate: '2026-08-01', endDate: '2026-08-31' });
  assert.deepEqual(local.map(record => record.issue.number), [2]);
  assert.deepEqual(github.reads, ['times/2026-08/alice.jsonl']);
});
