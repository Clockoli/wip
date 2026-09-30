import test from 'node:test';
import assert from 'node:assert/strict';
import { ReportService } from '../src/services/reports.js';

const record = (url, startedAt, endedAt) => `${JSON.stringify({
  schema_version: 1,
  id: '01K2ABCDEF0123456789ABCDE9',
  record_type: 'work',
  actor: { kind: 'human', id: 'github:alice', name: 'alice' },
  work_item: { kind: 'github_issue', id: `url:${url}`, url, title: '' },
  activity: { state: 'completed', started_at: startedAt, ended_at: endedAt, local_date: startedAt.slice(0, 10), timezone: 'UTC' },
  producer: { kind: 'browser_extension', name: 'clockoli-chrome', version: '0.1.30' },
  description: '', metadata: {}, metrics: {}, created_at: startedAt, updated_at: endedAt,
})}\n`;

class FakeGitHub {
  constructor(branch, files) {
    this.branch = branch;
    this.repositoryKey = `acme/time-data@${branch}`;
    this.files = files;
    this.reads = [];
  }
  async listTextFilesSnapshot() {
    return { notModified: false, etag: '', files: [...this.files].map(([path, file]) => ({ path, sha: file.sha, size: file.text.length })) };
  }
  async getBlobText(path, sha) {
    this.reads.push(path);
    return { path, sha, text: this.files.get(path).text };
  }
}

test('current-user activity reads the mapped personal branch instead of the configured branch', async () => {
  const main = new FakeGitHub('main', new Map([[
    'times/2026-08/alice.jsonl', { sha: 'a'.repeat(40), text: record('https://github.com/acme/app/issues/1', '2026-08-17T09:00:00.000Z', '2026-08-17T10:00:00.000Z') },
  ]]));
  const personal = new FakeGitHub('clockoli/users/123', new Map([[
    'times/2026-08/alice.jsonl', { sha: 'b'.repeat(40), text: record('https://github.com/acme/app/issues/9', '2026-08-17T08:00:00.000Z', '2026-08-17T09:30:00.000Z') },
  ]]));
  main.forBranch = branch => ({ main, 'clockoli/users/123': personal })[branch];
  personal.forBranch = main.forBranch;
  main.listBranches = async prefix => ['clockoli/users/123'].filter(branch => branch.startsWith(prefix));
  personal.getText = async path => {
    assert.equal(path, '.clockoli/user.json');
    return { path, sha: 'c'.repeat(40), text: JSON.stringify({ version: 1, githubUserId: 123, storageLogin: 'alice' }) };
  };

  const records = await new ReportService({ github: personal }).loadRepositoryUserRange(
    { startDate: '2026-08-17', endDate: '2026-08-17' },
    { defaultBranch: 'main', githubUserId: 123, user: 'alice' },
  );

  assert.deepEqual(records.map(item => item.issue.number), [9]);
  assert.deepEqual(main.reads, []);
});
