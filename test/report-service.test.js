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
