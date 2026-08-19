import test from 'node:test';
import assert from 'node:assert/strict';
import { ReportService } from '../src/services/reports.js';

const text = (url, start, end, description = '') => `URL: ${url}\nStart: ${start}\nEnd: ${end}\n${description ? `Description: ${description}\n` : ''}`;

class FakeGitHub {
  constructor() {
    this.files = new Map([
      ['times/2026-08-17/alice.txt', { sha: 'a', text: text('https://github.com/acme/app/issues/1', '2026-08-17T09:00:00+00:00', '2026-08-17T10:00:00+00:00') }],
      ['times/2026-08-17/bob.txt', { sha: 'b', text: text('https://github.com/acme/app/pull/2', '2026-08-17T10:00:00+00:00', '2026-08-17T12:00:00+00:00', 'review') }],
      ['times/2026-08-18/alice.txt', { sha: 'c', text: text('https://github.com/acme/api/issues/3', '2026-08-18T09:00:00+00:00', '2026-08-18T10:00:00+00:00') }],
      ['times/2026-08-19/alice.txt', { sha: 'd', text: text('https://github.com/acme/app/issues/4', '2026-08-19T09:00:00+00:00', '2026-08-19T10:00:00+00:00') }],
      ['active/alice.txt', { sha: 'active', text: '' }],
    ]);
    this.reads = [];
  }
  async listTextFiles(prefix) {
    assert.equal(prefix, 'times/');
    return [...this.files].map(([path, file]) => ({ path, sha: file.sha }));
  }
  async getBlobText(path, sha) {
    this.reads.push(path);
    const file = this.files.get(path);
    assert.equal(sha, file.sha);
    return { path, sha, text: file.text };
  }
}

test('report service loads every user file in the inclusive range and strips storage metadata', async () => {
  const github = new FakeGitHub();
  const records = await new ReportService({ github }).loadRange({ startDate: '2026-08-17', endDate: '2026-08-18' });
  assert.deepEqual(github.reads.sort(), ['times/2026-08-17/alice.txt', 'times/2026-08-17/bob.txt', 'times/2026-08-18/alice.txt']);
  assert.deepEqual(records.map(item => [item.user, item.entryDate, item.issue.type, item.durationSeconds]), [
    ['alice', '2026-08-17', 'issue', 3600],
    ['bob', '2026-08-17', 'pull_request', 7200],
    ['alice', '2026-08-18', 'issue', 3600],
  ]);
  assert.equal(Object.keys(records[0]).some(key => key.startsWith('_')), false);
});

test('report service rejects invalid ranges before touching GitHub', async () => {
  const github = new FakeGitHub();
  await assert.rejects(() => new ReportService({ github }).loadRange({ startDate: '2026-08-20', endDate: '2026-08-19' }), /end date/i);
  assert.equal(github.reads.length, 0);
});


test('report service identifies the malformed daily file that must be repaired', async () => {
  const github = new FakeGitHub();
  github.files = new Map([['times/2026-08-18/alice.txt', { sha: 'broken', text: 'URL: not-a-github-url\nStart: 2026-08-18T08:00:00+00:00\nEnd: 2026-08-18T09:00:00+00:00\n' }]]);
  await assert.rejects(() => new ReportService({ github }).loadRange({ startDate: '2026-08-18', endDate: '2026-08-18' }), /Invalid time data in times\/2026-08-18\/alice\.txt/);
});
