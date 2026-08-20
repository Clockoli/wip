import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskMetadataService } from '../src/services/task-metadata.js';

const oldIssue = { type: 'issue', owner: 'acme', repo: 'app', number: 1, url: 'https://github.com/acme/app/issues/1' };
const newIssue = { type: 'pull_request', owner: 'acme', repo: 'app', number: 2, url: 'https://github.com/acme/app/pull/2' };

class MemoryMetadataCache {
  constructor(scopeKey, entries = {}, generation = 1) {
    this.value = { repositoryKey: scopeKey, entries: structuredClone(entries) };
    this.generation = generation;
  }
  async getTaskMetadataCache(scopeKey) { return this.value?.repositoryKey === scopeKey ? structuredClone(this.value) : null; }
  async saveTaskMetadataCache(value, expectedGeneration) {
    if (expectedGeneration !== this.generation) return false;
    this.value = structuredClone(value);
    return true;
  }
}

function metadata(title, status = 'OPEN') { return { title, status }; }

test('fetching a missing task does not renew another entry timestamp', async () => {
  const scopeKey = 'time@main:alice:g1', base = 1_000_000;
  const cache = new MemoryMetadataCache(scopeKey, {
    [oldIssue.url]: { fetchedAt: base, details: metadata('Old') },
  });
  let now = base + 14 * 60 * 1000;
  const calls = [];
  const github = { getTaskMetadata: async issues => {
    calls.push(issues.map(issue => issue.url));
    return new Map(issues.map(issue => [issue.url, metadata(issue.number === 1 ? 'Old refreshed' : 'New')]));
  } };
  const service = new TaskMetadataService({ github, cache, scopeKey, configurationGeneration: 1, now: () => now });
  await service.load([oldIssue, newIssue]);
  assert.deepEqual(calls, [[newIssue.url]]);
  assert.equal(cache.value.entries[oldIssue.url].fetchedAt, base);
  assert.equal(cache.value.entries[newIssue.url].fetchedAt, now);

  now = base + 16 * 60 * 1000;
  const result = await service.load([oldIssue, newIssue]);
  assert.deepEqual(calls, [[newIssue.url], [oldIssue.url]]);
  assert.equal(result.get(oldIssue.url).title, 'Old refreshed');
});

test('metadata cache scope isolates authenticated users and configuration generations', async () => {
  const cache = new MemoryMetadataCache('time@main:alice:g1', {
    [oldIssue.url]: { fetchedAt: 1_000, details: metadata('Alice-only private title') },
  }, 2);
  let requests = 0;
  const github = { getTaskMetadata: async issues => {
    requests += 1;
    return new Map(issues.map(issue => [issue.url, null]));
  } };
  const service = new TaskMetadataService({
    github, cache, scopeKey: 'time@main:bob:g2', configurationGeneration: 2, now: () => 1_100,
  });
  const result = await service.load([oldIssue]);
  assert.equal(requests, 1);
  assert.equal(result.has(oldIssue.url), false);
  assert.equal(cache.value.repositoryKey, 'time@main:bob:g2');
  assert.equal(cache.value.entries[oldIssue.url].details, null);
});

test('an old in-flight metadata request cannot repopulate a rotated generation', async () => {
  const scopeKey = 'time@main:alice:g1', cache = new MemoryMetadataCache(scopeKey, {}, 1);
  let release;
  const deferred = new Promise(resolve => { release = resolve; });
  const github = { getTaskMetadata: async () => { await deferred; return new Map([[oldIssue.url, metadata('Private')]]); } };
  const service = new TaskMetadataService({ github, cache, scopeKey, configurationGeneration: 1, now: () => 2_000 });
  const loading = service.load([oldIssue]);
  await Promise.resolve();
  cache.generation = 2;
  cache.value = null;
  release();
  await assert.rejects(loading, error => error?.name === 'AbortError');
  assert.equal(cache.value, null);
});
