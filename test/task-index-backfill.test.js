import test from 'node:test';
import assert from 'node:assert/strict';
import { previewTaskIndexBackfill } from '../src/services/task-index-backfill.js';
import { previewGithubTaskIndex } from '../scripts/preview-task-index-backfill.mjs';

const first = '01K2ABCDEF0123456789ABCDEF';
const second = '01K2ABCDEF0123456789ABCDEE';
const third = '01K2ABCDEF0123456789ABCDED';
const url = 'https://github.com/acme/app/issues/42';
const record = (id, taskUrl, title, startedAt, durationSeconds = 60) =>
  ({ id, taskUrl, taskTitle: title, startedAt, durationSeconds });
const index = (entries) => ({ version: 1, storageLogin: 'alice', tasks: entries });

// Preview is read-only: proposed index changes are returned separately, never applied here.
test('backfill previews the latest real title and retains index and record inputs unchanged', () => {
  const original = index({ [url]: { totalSeconds: 120, sessionCount: 2, recordIds: [second, first] } });
  const before = structuredClone(original);
  const result = previewTaskIndexBackfill(original, [
    record(first, url, '  New task  ', '2026-01-02T09:00:00.000Z'),
    record(second, url, 'Old task', '2025-01-01T09:00:00.000Z'),
  ]);
  assert.deepEqual(result.counts, { tasks: 1, existing: 0, found: 1, untitled: 0, ambiguous: 0, records: 2 });
  assert.deepEqual(result.proposals, [{ taskUrl: url, title: 'New task', titleSourceId: first,
    titleStartedAt: '2026-01-02T09:00:00.000Z' }]);
  assert.deepEqual(original, before);
});

test('already titled and genuinely untitled tasks stay unchanged', () => {
  const titled = 'https://example.org/titled';
  const blank = 'https://example.org/blank';
  const result = previewTaskIndexBackfill(index({
    [titled]: { totalSeconds: 60, sessionCount: 1, recordIds: [first], title: 'Stored title', titleSourceId: first },
    [blank]: { totalSeconds: 60, sessionCount: 1, recordIds: [second], title: '', titleSourceId: second },
  }), [record(first, titled, 'Stored title', '2026-01-01T00:00:00.000Z'),
    record(second, blank, '', '2026-01-01T00:00:00.000Z')]);
  assert.deepEqual(result.counts, { tasks: 2, existing: 1, found: 0, untitled: 1, ambiguous: 0, records: 2 });
  assert.deepEqual(result.proposals, []);
});

test('different historical titles are not ambiguous if the newest nonempty one is unambiguous', () => {
  const result = previewTaskIndexBackfill(index({ [url]: {
    totalSeconds: 180, sessionCount: 3, recordIds: [third, second, first],
  } }), [record(first, url, '', '2026-01-03T00:00:00.000Z'),
    record(second, url, 'New', '2026-01-02T00:00:00.000Z'),
    record(third, url, 'Old', '2026-01-01T00:00:00.000Z')]);
  assert.equal(result.counts.found, 1);
  assert.equal(result.proposals[0].title, 'New');
});

test('conflicting titles tied at latest timestamp require review, not an arbitrary winner', () => {
  const at = '2026-01-02T00:00:00.000Z';
  const result = previewTaskIndexBackfill(index({ [url]: {
    totalSeconds: 120, sessionCount: 2, recordIds: [second, first],
  } }), [record(first, url, 'A', at), record(second, url, 'B', at)]);
  assert.equal(result.counts.ambiguous, 1);
  assert.deepEqual(result.proposals, []);
});

test('latest title selection compares instants across timestamp precisions and offsets', () => {
  const original = index({ [url]: { totalSeconds: 120, sessionCount: 2, recordIds: [second, first] } });
  const result = previewTaskIndexBackfill(original, [
    record(first, url, 'Older', '2026-01-02T12:00:00Z'),
    record(second, url, 'Newer', '2026-01-02T12:00:00.999Z'),
  ]);
  assert.equal(result.proposals[0].title, 'Newer');
  const tie = previewTaskIndexBackfill(original, [
    record(first, url, 'Another', '2026-01-02T13:00:00.999+01:00'),
    record(second, url, 'Newer', '2026-01-02T12:00:00.999Z'),
  ]);
  assert.equal(tie.counts.ambiguous, 1);
  assert.deepEqual(tie.proposals, []);
});

test('missing, extra, repeated and mismatched records fail the entire preview', () => {
  const original = index({ [url]: { totalSeconds: 60, sessionCount: 1, recordIds: [first] } });
  assert.throws(() => previewTaskIndexBackfill(original, []), /does not match/i);
  assert.throws(() => previewTaskIndexBackfill(original, [record(second, url, 'X', '2026-01-01T00:00:00.000Z')]), /does not match/i);
  assert.throws(() => previewTaskIndexBackfill(original, [record(first, 'https://example.org/wrong', 'X', '2026-01-01T00:00:00.000Z')]), /does not match/i);
  assert.throws(() => previewTaskIndexBackfill(original, [record(first, url, 'X', '2026-01-01T00:00:00.000Z'), record(first, url, 'X', '2026-01-01T00:00:00.000Z')]), /does not match/i);
  assert.throws(() => previewTaskIndexBackfill(original, [record(first, url, 'X', '2026-01-01T00:00:00.000Z', 59)]), /does not match/i);
});

test('GitHub dry-run reads one pinned personal-branch tree and never calls a write API', async () => {
  const indexText = `${JSON.stringify(index({ [url]: { totalSeconds: 60, sessionCount: 1, recordIds: [first] } }))}\n`;
  const marker = `${JSON.stringify({ version: 1, githubUserId: 123, storageLogin: 'alice' })}\n`;
  const body = JSON.stringify({
    schema_version: 1, id: first, record_type: 'work',
    actor: { kind: 'human', id: 'github:123', name: 'alice' },
    work_item: { kind: 'github_issue', id: `url:${url}`, url, title: 'Real task' },
    activity: { state: 'completed', started_at: '2026-01-02T09:00:00.000Z',
      ended_at: '2026-01-02T09:01:00.000Z', local_date: '2026-01-02', timezone: 'UTC' },
    producer: { kind: 'browser_extension', name: 'clockoli-chrome', version: '0.3.0' },
    description: '', metadata: {}, metrics: {},
    created_at: '2026-01-02T09:00:00.000Z', updated_at: '2026-01-02T09:01:00.000Z',
  });
  const monthlyText = `${body}\n`;
  const files = [
    ['.clockoli/user.json', 'a'.repeat(40), marker],
    ['.clockoli/tasks.json', 'b'.repeat(40), indexText],
    ['times/2026-01/alice.jsonl', 'c'.repeat(40), monthlyText],
  ];
  const tree = { truncated: false, tree: files.map(([path, sha, text]) =>
    ({ path, sha, type: 'blob', size: Buffer.byteLength(text) })) };
  tree.tree.push({ path: 'times/.gitkeep', sha: 'f'.repeat(40), type: 'blob', size: 0 });
  const calls = [];
  const read = async endpoint => {
    calls.push(endpoint);
    if (endpoint === 'user') return { id: 123, login: 'alice' };
    if (endpoint === 'repos/acme/time/branches/clockoli/users/123') return {
      commit: { sha: 'd'.repeat(40), commit: { tree: { sha: 'e'.repeat(40) } } },
    };
    if (endpoint === `repos/acme/time/git/trees/${'e'.repeat(40)}?recursive=1`) return tree;
    const sha = endpoint.split('/').at(-1);
    const file = files.find(item => item[1] === sha);
    if (file) return { encoding: 'base64', size: Buffer.byteLength(file[2]),
      content: Buffer.from(file[2]).toString('base64') };
    throw new Error(`Unexpected read: ${endpoint}`);
  };
  const result = await previewGithubTaskIndex('acme/time', read);
  assert.equal(result.counts.found, 1);
  assert.equal(result.fileCount, 1);
  assert.equal(result.commitSha, 'd'.repeat(40));
  assert.equal(result.indexSha, 'b'.repeat(40));
  assert.equal(calls.filter(call => call.includes('/branches/')).length, 2,
    'the branch must be rechecked after reading the immutable snapshot');
  assert.equal(calls.every(call => call === 'user' || call.startsWith('repos/acme/time/')), true);
  tree.truncated = true;
  await assert.rejects(previewGithubTaskIndex('acme/time', read), /truncated/i);
  tree.truncated = false;
  await assert.rejects(previewGithubTaskIndex('acme/time', read, { maxFiles: 0 }), /budget/i);
  let branchReads = 0;
  await assert.rejects(previewGithubTaskIndex('acme/time', endpoint => {
    if (endpoint.includes('/branches/')) {
      branchReads++;
      if (branchReads === 2) return { commit: { sha: '0'.repeat(40) } };
    }
    return read(endpoint);
  }), /changed during preview/i);
  await assert.rejects(previewGithubTaskIndex('acme/time', endpoint => {
    if (endpoint.endsWith(`/git/blobs/${'b'.repeat(40)}`)) {
      return { encoding: 'base64', size: 1, content: 'eA==' };
    }
    return read(endpoint);
  }), /size or encoding mismatch/i);
  const invalidUtf8 = Buffer.from(monthlyText);
  invalidUtf8[invalidUtf8.indexOf('Real task')] = 0xff;
  await assert.rejects(previewGithubTaskIndex('acme/time', endpoint => {
    if (endpoint.endsWith(`/git/blobs/${'c'.repeat(40)}`)) {
      return { encoding: 'base64', size: invalidUtf8.length, content: invalidUtf8.toString('base64') };
    }
    return read(endpoint);
  }), /UTF-8/i);
});
