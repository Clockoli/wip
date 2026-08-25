import test from 'node:test';
import assert from 'node:assert/strict';
import { ReportService } from '../src/services/reports.js';

const block = (url, start, end, description = '') => `URL: ${url}\nStart: ${start}\nEnd: ${end}\n${description ? `Description: ${description}\n` : ''}`;
const monthly = (...blocks) => blocks.join('\n');
const A = 'a'.repeat(40), B = 'b'.repeat(40), C = 'c'.repeat(40);

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
      ['times/2026-08/alice.txt', { sha: A, text: monthly(
        block('https://github.com/acme/app/issues/1', '2026-08-17T09:00:00+00:00', '2026-08-17T10:00:00+00:00'),
        block('https://github.com/acme/api/issues/3', '2026-08-18T09:00:00+00:00', '2026-08-18T10:00:00+00:00'),
        block('https://github.com/acme/app/issues/4', '2026-08-19T09:00:00+00:00', '2026-08-19T10:00:00+00:00')) }],
      ['times/2026-08/bob.txt', { sha: B, text: block('https://github.com/acme/app/pull/2', '2026-08-17T10:00:00+00:00', '2026-08-17T12:00:00+00:00', 'review') }],
    ]);
    this.snapshots = [];
    this.reads = [];
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
}

test('report service loads monthly files and filters records to the inclusive date range', async () => {
  const github = new FakeGitHub(), cache = new MemoryReportCache();
  const records = await new ReportService({ github, cache }).loadRange({ startDate: '2026-08-17', endDate: '2026-08-18' });
  assert.deepEqual(github.reads.sort(), ['times/2026-08/alice.txt', 'times/2026-08/bob.txt']);
  assert.deepEqual(records.map(item => [item.user, item.entryDate, item.issue.type, item.durationSeconds]), [
    ['alice', '2026-08-17', 'issue', 3600],
    ['bob', '2026-08-17', 'pull_request', 7200],
    ['alice', '2026-08-18', 'issue', 3600],
  ]);
  assert.equal(Object.keys(records[0]).some(key => key.startsWith('_')), false);
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
  github.files.set('times/2026-08/bob.txt', { sha: C, text: block('https://github.com/acme/app/pull/2', '2026-08-17T10:00:00+00:00', '2026-08-17T13:00:00+00:00', 'updated') });
  github.reads = [];
  const records = await service.loadRange({ startDate: '2026-08-17', endDate: '2026-08-17' });
  assert.deepEqual(github.reads, ['times/2026-08/bob.txt']);
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
  github.files = new Map([['times/2026-08/alice.txt', { sha: 'd'.repeat(40), text: 'URL: not-a-github-url\nStart: 2026-08-18T08:00:00+00:00\nEnd: 2026-08-18T09:00:00+00:00\n' }]]);
  await assert.rejects(() => new ReportService({ github }).loadRange({ startDate: '2026-08-18', endDate: '2026-08-18' }), /Invalid time data in times\/2026-08\/alice\.txt/);
});

test('current-user task loading never fetches or parses another user monthly file', async () => {
  const github = new FakeGitHub();
  github.files.set('times/2026-08/bob.txt', { sha: B, text: 'malformed hostile data' });
  const records = await new ReportService({ github }).loadUserRange(
    { startDate: '2026-08-17', endDate: '2026-08-18' }, 'alice',
  );
  assert.deepEqual(github.reads, ['times/2026-08/alice.txt']);
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

test('current-user loading refreshes a legacy size-less cache before byte preflight', async () => {
  const github = new FakeGitHub(), cache = new MemoryReportCache(), service = new ReportService({ github, cache });
  await service.loadRange({ startDate: '2026-08-01', endDate: '2026-08-31' });
  cache.value.files = cache.value.files.map(({ path, sha }) => ({ path, sha }));
  github.notModified = true;
  await service.loadUserRange({ startDate: '2026-08-01', endDate: '2026-08-31' }, 'alice');
  assert.equal(github.snapshots.at(-1).etag, '', 'legacy cache must be refreshed so tree blob sizes are known before reads');
  assert.ok(cache.value.files.every(file => Number.isSafeInteger(file.size)));
});


test('repository reports merge personal and legacy records for migrated users without copied duplicates', async () => {
  const primary = new FakeGitHub(), personal = new FakeGitHub();
  primary.repositoryKey = 'acme/time-data@main';
  personal.repositoryKey = 'acme/time-data@clockoli/users/123';
  primary.files.set('times/2026-08/alice.txt', { sha: A, text: monthly(
    block('https://github.com/acme/app/issues/1', '2026-08-17T09:00:00+00:00', '2026-08-17T10:00:00+00:00'),
    block('https://github.com/acme/app/issues/8', '2026-08-17T13:00:00+00:00', '2026-08-17T14:00:00+00:00'),
  ) });
  personal.files.set('times/2026-08/alice.txt', { sha: 'd'.repeat(40), text: monthly(
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
  const legacyRecords = await new ReportService({ github: primary }).loadRange(
    { startDate: '2026-08-17', endDate: '2026-08-17' },
  );
  assert.deepEqual(legacyRecords.map(record => record.issue.number), [1, 2, 8]);
  const records = await new ReportService({ github: personal, cache }).loadRepositoryRange(
    { startDate: '2026-08-17', endDate: '2026-08-17' }, { defaultBranch: 'main' },
  );
  assert.deepEqual(records.map(record => [record.user, record.issue.number, record.durationSeconds]), [
    ['alice', 9, 5400],
    ['alice', 1, 3600],
    ['bob', 2, 7200],
    ['alice', 8, 3600],
  ]);
});
