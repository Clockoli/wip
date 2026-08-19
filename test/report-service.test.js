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
    return { notModified: false, etag: this.etag, files: [...this.files].map(([path, file]) => ({ path, sha: file.sha })) };
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
