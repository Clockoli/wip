import test from 'node:test';
import assert from 'node:assert/strict';
import { TrackerService } from '../src/services/tracker.js';
import { serializeActiveRecord, serializeMonthlyRecords } from '../src/domain/work-records.js';

const actor = { kind: 'human', id: 'github:123', name: 'alice' };
const producer = { kind: 'browser_extension', name: 'clockoli-chrome', version: '0.3.0' };
const firstId = '01K2ABCDEF0123456789ABCDEF';
const secondId = '01K2ABCDEF0123456789ABCDEG';
const date = '2026-10-13';
const monthPath = 'times/2026-10/alice.jsonl';
const activePath = 'active/alice.json';

function timer(id = firstId, startedAt = `${date}T08:00:00.000Z`) {
  return {
    schemaVersion: 1, id, entryId: id, user: 'alice', actor, producer,
    taskUrl: 'https://example.com/task', taskTitle: '', issueTitle: '',
    entryDate: date, timezone: 'UTC', startedAt,
    description: '', metadata: {}, metrics: {},
    createdAt: startedAt, updatedAt: startedAt,
  };
}

function completed(id = firstId) {
  const entry = timer(id);
  const endedAt = `${date}T09:00:00.000Z`;
  return { ...entry, endedAt, durationSeconds: 3600, updatedAt: endedAt };
}

class LocalStore {
  constructor() {
    this.state = { activeCache: null, recentCache: [], summaryCache: null, pendingWrites: [] };
  }
  async getState() { return structuredClone(this.state); }
  async mutateState(mutate) {
    const patch = mutate(structuredClone(this.state));
    if (patch) Object.assign(this.state, structuredClone(patch));
    return this.getState();
  }
}

class RemoteBranch {
  constructor() {
    this.repositoryKey = 'acme/time@clockoli/users/123';
    this.etag = '"revision-1"';
    this.files = new Map();
    this.snapshots = [];
    this.blobReads = [];
  }
  set(path, text, sha) { this.files.set(path, { path, sha, text, size: new TextEncoder().encode(text).byteLength }); }
  async listTextFilesSnapshot(prefix, { etag = '', includeActive } = {}) {
    this.snapshots.push({ prefix, etag, includeActive });
    if (etag && etag === this.etag) return { notModified: true, etag: this.etag };
    return {
      notModified: false, etag: this.etag, headSha: this.etag,
      files: [...this.files.values()].map(({ path, sha, size }) => ({ path, sha, size })),
    };
  }
  async getBlobText(path, sha) {
    this.blobReads.push({ path, sha });
    const file = this.files.get(path);
    assert.equal(file?.sha, sha, 'the immutable snapshot SHA must be used to retrieve each file');
    return { path, sha, text: file.text };
  }
}

function fixture() {
  const store = new LocalStore(), github = new RemoteBranch();
  const tracker = new TrackerService({
    github, store, user: 'alice', actorId: 'github:123',
    clock: () => new Date(`${date}T12:00:00.000Z`), recentDays: 7,
  });
  github.set(monthPath, serializeMonthlyRecords([completed()]), 'a'.repeat(40));
  github.set(activePath, serializeActiveRecord(timer(secondId, `${date}T10:00:00.000Z`)), 'b'.repeat(40));
  return { store, github, tracker };
}

test('silent pull caches remote completed and active records and reuses the branch ETag', async () => {
  const { store, github, tracker } = fixture();
  assert.equal(await tracker.pullRemoteSilently(), true);
  assert.equal(store.state.recentCache.length, 1);
  assert.equal(store.state.recentCache[0].id, firstId);
  assert.equal(store.state.activeCache.id, secondId);
  assert.equal(store.state.summaryCache.weekEntries.length, 1);
  assert.equal(store.state.summaryCache.silentPull.etag, github.etag);
  assert.equal(github.blobReads.length, 2);

  assert.equal(await tracker.pullRemoteSilently(), false);
  assert.equal(github.snapshots[1].etag, '"revision-1"');
  assert.equal(github.blobReads.length, 2, 'an unchanged GitHub branch must not redownload data');
});

test('interactive menu loading preserves the silent-pull ETag for the next background check', async () => {
  const { store, github, tracker } = fixture();
  github.getText = async path => {
    const file = github.files.get(path);
    assert.ok(file);
    return { text: file.text, sha: file.sha };
  };
  assert.equal(await tracker.pullRemoteSilently(), true);
  await tracker.loadMenuData();
  assert.equal(store.state.summaryCache.silentPull.etag, github.etag);

  assert.equal(await tracker.pullRemoteSilently(), false);
  assert.equal(github.snapshots.at(-1).etag, github.etag);
  assert.equal(github.blobReads.length, 2, 'opening the menu must not redownload unchanged blobs');
});

test('a pending local operation blocks background pulls without modifying the queue or active timer', async () => {
  const { store, github, tracker } = fixture();
  store.state.pendingWrites = [{ id: 'local', operation: 'completeTimer', status: 'pending' }];
  store.state.activeCache = { id: 'local-active', _pending: true };
  assert.equal(await tracker.pullRemoteSilently(), false);
  assert.equal(github.snapshots.length, 0);
  assert.equal(store.state.activeCache.id, 'local-active');
  assert.equal(store.state.pendingWrites[0].id, 'local');
});

test('local changes accepted during network I/O cannot be overwritten by the older remote snapshot', async () => {
  const { store, github, tracker } = fixture();
  let announce, resume;
  const reached = new Promise(resolve => { announce = resolve; });
  const released = new Promise(resolve => { resume = resolve; });
  const originalGetBlob = github.getBlobText.bind(github);
  github.getBlobText = async (...args) => { announce(); await released; return originalGetBlob(...args); };
  const pull = tracker.pullRemoteSilently();
  await reached;
  store.state.pendingWrites.push({ id: 'new-local', operation: 'startTimer', status: 'pending' });
  store.state.activeCache = { id: 'new-local', _pending: true };
  resume();
  assert.equal(await pull, false);
  assert.equal(store.state.activeCache.id, 'new-local');
  assert.equal(store.state.pendingWrites.length, 1);
  assert.equal(store.state.summaryCache, null, 'an interrupted pull must not advance its ETag');
});

test('remote deletions are reflected in local data after the branch changes', async () => {
  const { store, github, tracker } = fixture();
  await tracker.pullRemoteSilently();
  github.files.clear();
  github.etag = '"revision-2"';
  assert.equal(await tracker.pullRemoteSilently(), true);
  assert.deepEqual(store.state.recentCache, []);
  assert.equal(store.state.activeCache, null);
  assert.equal(store.state.summaryCache.weekEntries.length, 0);
});

test('a malformed or oversized remote snapshot never replaces a valid local cache', async () => {
  const { store, github, tracker } = fixture();
  await tracker.pullRemoteSilently();
  const previous = structuredClone(store.state);
  github.etag = '"revision-2"';
  github.set(monthPath, '{invalid-json}', 'c'.repeat(40));
  await assert.rejects(tracker.pullRemoteSilently());
  assert.deepEqual(store.state, previous);
  github.set(monthPath, serializeMonthlyRecords([completed()]), 'd'.repeat(40));
  assert.equal(await tracker.pullRemoteSilently({ maxBytes: 3 }), false);
  assert.deepEqual(store.state, previous);
});

test('a branch change touching only older files still advances the snapshot without rewriting records', async () => {
  const { store, github, tracker } = fixture();
  await tracker.pullRemoteSilently();
  github.etag = '"revision-2"';
  github.set('times/2020-01/alice.jsonl', serializeMonthlyRecords([completed()]), 'c'.repeat(40));
  assert.equal(await tracker.pullRemoteSilently(), true);
  assert.equal(store.state.recentCache[0].id, firstId);
  assert.equal(github.blobReads.length, 4, 'out-of-window history is not hydrated during a silent pull');
});
