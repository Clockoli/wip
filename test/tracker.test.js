import test from 'node:test';
import assert from 'node:assert/strict';
import { TrackerService, TrackerConflictError } from '../src/services/tracker.js';

const issue = { type: 'issue', owner: 'acme', repo: 'frontend', number: 123, url: 'https://github.com/acme/frontend/issues/123' };

class MemoryStore {
  constructor() { this.value = { activeCache: null, recentCache: [], pendingWrites: [] }; }
  async getState() { return structuredClone(this.value); }
  async patchState(patch) { Object.assign(this.value, structuredClone(patch)); }
}

class FakeGitHub {
  constructor() { this.files = new Map(); this.failDeleteOnce = false; this.deleteBeforeNotFoundOnce = false; this.denyDeleteAsNotFoundOnce = false; this.createCalls = 0; }
  async getFile(path) {
    if (!this.files.has(path)) { const e = new Error('not found'); e.status = 404; throw e; }
    const value = this.files.get(path); return { path, sha: value.sha, data: structuredClone(value.data) };
  }
  async putJson(path, data, message, sha) {
    if (sha && this.files.get(path)?.sha !== sha) { const e = new Error('conflict'); e.status = 409; throw e; }
    if (!sha && this.files.has(path)) { const e = new Error('conflict'); e.status = 409; throw e; }
    this.createCalls += 1; this.files.set(path, { sha: `s${this.createCalls}`, data: structuredClone(data) });
    return { sha: `s${this.createCalls}` };
  }
  async deleteFile(path, message, sha) {
    if (this.failDeleteOnce) { this.failDeleteOnce = false; throw new TypeError('network'); }
    if (this.deleteBeforeNotFoundOnce) { this.deleteBeforeNotFoundOnce = false; this.files.delete(path); const e = new Error('not found'); e.status = 404; throw e; }
    if (this.denyDeleteAsNotFoundOnce) { this.denyDeleteAsNotFoundOnce = false; const e = new Error('not found'); e.status = 404; throw e; }
    if (this.files.get(path)?.sha !== sha) { const e = new Error('conflict'); e.status = 409; throw e; }
    this.files.delete(path);
  }
  async listDirectory() { return []; }
}

const clock = (() => { let now = new Date(2026, 7, 18, 8, 0, 0); return { now: () => new Date(now), set: value => { now = new Date(value); } }; })();

test('start persists one active timer and rejects a second', async () => {
  const store = new MemoryStore(); const github = new FakeGitHub();
  const service = new TrackerService({ github, store, user: 'alice', clock: clock.now, idFactory: () => '01K2ABCDEF0123456789ABCDEF' });
  await service.start(issue, 'title');
  assert.ok(github.files.has('active/alice.json'));
  await assert.rejects(() => service.start({ ...issue, number: 2 }), /already running/i);
});

test('stop is queued before I/O and retry does not duplicate a created entry', async () => {
  const store = new MemoryStore(); const github = new FakeGitHub();
  const service = new TrackerService({ github, store, user: 'alice', clock: clock.now, idFactory: () => '01K2ABCDEF0123456789ABCDEF' });
  await service.start(issue, 'title');
  github.failDeleteOnce = true;
  clock.set(new Date(2026, 7, 18, 9, 0, 0));
  const result = await service.stop('worked');
  assert.equal(result.pending, true);
  assert.equal(store.value.pendingWrites.length, 1);
  const entryPath = store.value.pendingWrites[0].entryPath;
  assert.ok(github.files.has(entryPath));
  const callsAfterCreate = github.createCalls;
  await service.syncPending();
  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(github.files.has('active/alice.json'), false);
  assert.equal(github.createCalls, callsAfterCreate);
});

test('stop completes immediately when active deletion reports it is already absent', async () => {
  const store = new MemoryStore(); const github = new FakeGitHub();
  const service = new TrackerService({ github, store, user: 'alice', clock: clock.now, idFactory: () => '01K2ABCDEF0123456789ABCDEG' });
  await service.start(issue, 'title');
  github.deleteBeforeNotFoundOnce = true;
  clock.set(new Date(2026, 7, 18, 9, 0, 0));
  const result = await service.stop('worked');
  assert.equal(result.pending, false);
  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(store.value.activeCache, null);
});

test('permission-masked active deletion 404 remains queued when the remote timer still exists', async () => {
  const store = new MemoryStore(); const github = new FakeGitHub();
  const service = new TrackerService({ github, store, user: 'alice', clock: clock.now, idFactory: () => '01K2ABCDEF0123456789ABCDEH' });
  await service.start(issue, 'title');
  github.denyDeleteAsNotFoundOnce = true;
  clock.set(new Date(2026, 7, 18, 9, 0, 0));
  const result = await service.stop('worked');
  assert.equal(result.pending, true);
  assert.equal(store.value.pendingWrites.length, 1);
  assert.equal(github.files.has('active/alice.json'), true);
});

test('stale entry edit is rejected without overwrite', async () => {
  const store = new MemoryStore(); const github = new FakeGitHub();
  const path = 'entries/alice/2026/08/18/01K2ABCDEF0123456789ABCDEF.json';
  github.files.set(path, { sha: 'latest', data: { id: '01K2ABCDEF0123456789ABCDEF' } });
  const service = new TrackerService({ github, store, user: 'alice', clock: clock.now });
  await assert.rejects(() => service.editEntry({ path, originalSha: 'stale', edits: {} }), TrackerConflictError);
  assert.equal(github.files.get(path).sha, 'latest');
});


test('browser restart refreshes GitHub active state and network failure falls back to cache', async () => {
  const store = new MemoryStore(); const github = new FakeGitHub();
  const active = {
    schemaVersion: 1, user: 'alice', issue,
    startedAt: '2026-08-18T08:00:00.000Z', description: '', createdAt: '2026-08-18T08:00:00.000Z',
  };
  github.files.set('active/alice.json', { sha: 'remote', data: active });
  const service = new TrackerService({ github, store, user: 'alice', clock: clock.now });
  const restored = await service.getState({ refresh: true });
  assert.equal(restored.active._sha, 'remote');
  github.getFile = async () => { throw new TypeError('network'); };
  const offline = await service.getState({ refresh: true });
  assert.equal(offline.active.startedAt, active.startedAt);
});


test('successful edit recomputes duration in the same file and delete uses latest SHA', async () => {
  const store = new MemoryStore(); const github = new FakeGitHub();
  const path = 'entries/alice/2026/08/18/01K2ABCDEF0123456789ABCDEF.json';
  const entry = {
    schemaVersion: 1, id: '01K2ABCDEF0123456789ABCDEF', user: 'alice', issue,
    startedAt: '2026-08-18T08:00:00.000Z', endedAt: '2026-08-18T09:00:00.000Z',
    durationSeconds: 3600, description: '', createdAt: '2026-08-18T09:00:01.000Z', updatedAt: '2026-08-18T09:00:01.000Z',
  };
  github.files.set(path, { sha: 'original', data: entry });
  const service = new TrackerService({ github, store, user: 'alice', clock: () => new Date('2026-08-18T10:00:00.000Z') });
  const edited = await service.editEntry({ path, originalSha: 'original', edits: { endedAt: '2026-08-18T09:15:00.000Z', description: 'review' } });
  assert.equal(edited.durationSeconds, 4500);
  assert.equal(github.files.get(path).data.description, 'review');
  await service.deleteEntry({ path, originalSha: github.files.get(path).sha });
  assert.equal(github.files.has(path), false);
});

test('pending Stop never clears a newer active timer from another device', async () => {
  const store = new MemoryStore(); const github = new FakeGitHub();
  const service = new TrackerService({ github, store, user: 'alice', clock: clock.now, idFactory: () => '01K2ABCDEF0123456789ABCDEF' });
  await service.start(issue, 'title');
  github.failDeleteOnce = true;
  clock.set(new Date(2026, 7, 18, 9, 0, 0));
  await service.stop('done');
  github.files.set('active/alice.json', { sha: 'other-device', data: {
    schemaVersion: 1, user: 'alice', issue: { ...issue, number: 999, url: 'https://github.com/acme/frontend/issues/999' },
    startedAt: '2026-08-18T09:05:00.000Z', description: '', createdAt: '2026-08-18T09:05:00.000Z',
  }});
  const queue = await service.syncPending();
  assert.equal(queue[0].status, 'conflict');
  assert.equal(github.files.get('active/alice.json').data.issue.number, 999);
});


test('repeated Stop for the same remote active timer reuses the pending entry ID', async () => {
  const store = new MemoryStore(); const github = new FakeGitHub();
  let nextId = 0;
  const service = new TrackerService({ github, store, user: 'alice', clock: clock.now, idFactory: () => nextId++ === 0 ? '01K2ABCDEF0123456789ABCDEA' : '01K2ABCDEF0123456789ABCDEB' });
  await service.start(issue, 'title');
  github.failDeleteOnce = true;
  clock.set(new Date(2026, 7, 18, 9, 0, 0));
  const first = await service.stop('done');
  assert.equal(first.pending, true);
  const remote = await github.getFile('active/alice.json');
  await store.patchState({ activeCache: { ...remote.data, _sha: remote.sha } });
  const second = await service.stop('done again');
  assert.equal(second.entry.id, first.entry.id);
  assert.equal(store.value.pendingWrites.length, 1);
  assert.equal([...github.files.keys()].filter(path => path.startsWith('entries/')).length, 1);
});

test('recent entries select newest ULIDs before applying the 50-entry limit', async () => {
  const store = new MemoryStore(); const github = new FakeGitHub();
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  const names = Array.from({ length: 60 }, (_, i) => `000000000000000000000000${alphabet[Math.floor(i / 32)]}${alphabet[i % 32]}.json`);
  github.listDirectory = async directory => names.map(name => ({ name, path: `${directory}/${name}`, type: 'file' }));
  github.getFile = async path => {
    const id = path.slice(-31, -5); const index = names.indexOf(`${id}.json`);
    return { path, sha: `s${index}`, data: { schemaVersion: 1, id, user: 'alice', issue, startedAt: `2026-08-18T08:${String(index).padStart(2,'0')}:00.000Z`, endedAt: `2026-08-18T08:${String(index).padStart(2,'0')}:30.000Z`, durationSeconds: 30, description: '', createdAt: '2026-08-18T10:00:00.000Z', updatedAt: '2026-08-18T10:00:00.000Z' } };
  };
  const service = new TrackerService({ github, store, user: 'alice', clock: () => new Date(2026, 7, 18, 12, 0, 0), recentDays: 1 });
  const recent = await service.loadRecent(50);
  assert.equal(recent.length, 50);
  assert.ok(recent.some(entry => entry.id === names.at(-1).slice(0, -5)));
  assert.ok(!recent.some(entry => entry.id === names[0].slice(0, -5)));
});


test('acknowledging a clear-active conflict keeps the newer timer and removes only the completed queue item', async () => {
  const store = new MemoryStore(); const github = new FakeGitHub();
  const service = new TrackerService({ github, store, user: 'alice', clock: clock.now, idFactory: () => '01K2ABCDEF0123456789ABCDEF' });
  await service.start(issue, 'title'); github.failDeleteOnce = true;
  clock.set(new Date(2026, 7, 18, 9, 0, 0)); await service.stop('done');
  github.files.set('active/alice.json', { sha: 'newer', data: { schemaVersion: 1, user: 'alice', issue: { ...issue, number: 999, url: 'https://github.com/acme/frontend/issues/999' }, startedAt: '2026-08-18T09:05:00.000Z', description: '', createdAt: '2026-08-18T09:05:00.000Z' } });
  await service.syncPending();
  await service.resolvePendingConflict('01K2ABCDEF0123456789ABCDEF');
  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(github.files.get('active/alice.json').data.issue.number, 999);
  assert.equal(store.value.activeCache.issue.number, 999);
  assert.ok([...github.files.keys()].some(path => path.startsWith('entries/')));
});


test('two devices stopping the same active timer converge on one entry path', async () => {
  const github = new FakeGitHub(); const storeA = new MemoryStore(); const storeB = new MemoryStore();
  const serviceA = new TrackerService({ github, store: storeA, user: 'alice', clock: clock.now, idFactory: () => '01K2ABCDEF0123456789ABCDEA' });
  const serviceB = new TrackerService({ github, store: storeB, user: 'alice', clock: clock.now, idFactory: () => '01K2ABCDEF0123456789ABCDEB' });
  await serviceA.start(issue, 'title');
  await serviceB.refreshActive();
  clock.set(new Date(2026, 7, 18, 9, 0, 0));
  const a = await serviceA.stop('same completion');
  const b = await serviceB.stop('same completion');
  assert.equal(a.entry.id, b.entry.id);
  assert.equal([...github.files.keys()].filter(path => path.startsWith('entries/')).length, 1);
  assert.equal(storeA.value.pendingWrites.length, 0);
  assert.equal(storeB.value.pendingWrites.length, 0);
});


test('same entry ID with different remote content is a conflict, not idempotent success', async () => {
  const store = new MemoryStore(); const github = new FakeGitHub();
  const service = new TrackerService({ github, store, user: 'alice', clock: clock.now });
  const path = 'entries/alice/2026/08/18/01K2ABCDEF0123456789ABCDEF.json';
  const expected = { schemaVersion: 1, id: '01K2ABCDEF0123456789ABCDEF', user: 'alice', issue, startedAt: '2026-08-18T08:00:00.000Z', endedAt: '2026-08-18T09:00:00.000Z', durationSeconds: 3600, description: 'expected', createdAt: '2026-08-18T09:00:00.000Z', updatedAt: '2026-08-18T09:00:00.000Z' };
  github.files.set(path, { sha: 'occupied', data: { ...expected, description: 'different' } });
  await assert.rejects(() => service.ensureEntry({ entryPath: path, entry: expected }), TrackerConflictError);
});

test('GitHub validation failures are not mislabeled as timer conflicts', async () => {
  const store = new MemoryStore(); const github = new FakeGitHub();
  github.putJson = async () => { const error = new Error('validation'); error.status = 422; error.code = 'validation'; throw error; };
  const service = new TrackerService({ github, store, user: 'alice', clock: clock.now, idFactory: () => '01K2ABCDEF0123456789ABCDEF' });
  await assert.rejects(() => service.start(issue), error => error.code === 'validation' && !(error instanceof TrackerConflictError));
});

test('conflict acknowledgement replaces the optimistic pending cache with the saved SHA', async () => {
  const store = new MemoryStore(); const github = new FakeGitHub();
  const id = '01K2ABCDEF0123456789ABCDEF', path = `entries/alice/2026/08/18/${id}.json`;
  const entry = { schemaVersion: 1, id, user: 'alice', issue, startedAt: '2026-08-18T08:00:00.000Z', endedAt: '2026-08-18T09:00:00.000Z', durationSeconds: 3600, description: '', createdAt: '2026-08-18T09:00:00.000Z', updatedAt: '2026-08-18T09:00:00.000Z' };
  github.files.set(path, { sha: 'saved-sha', data: entry });
  store.value.pendingWrites = [{ operation: 'completeTimer', id, status: 'conflict', stage: 'clearActive', entryPath: path, entry }];
  store.value.recentCache = [{ ...entry, _path: path, _sha: null, _pending: true }];
  const service = new TrackerService({ github, store, user: 'alice', clock: clock.now });
  await service.resolvePendingConflict(id);
  assert.equal(store.value.recentCache[0]._pending, undefined);
  assert.equal(store.value.recentCache[0]._sha, 'saved-sha');
});

test('legacy active timers without entryId derive the same deterministic ID on every device', async () => {
  const github = new FakeGitHub(), storeA = new MemoryStore(), storeB = new MemoryStore();
  const legacy = { schemaVersion: 1, user: 'alice', issue, startedAt: '2026-08-18T08:00:00.000Z', description: '', createdAt: '2026-08-18T08:00:00.000Z' };
  github.files.set('active/alice.json', { sha: 'legacy', data: legacy });
  const a = new TrackerService({ github, store: storeA, user: 'alice', clock: () => new Date('2026-08-18T09:00:00.000Z'), idFactory: () => '01K2ABCDEF0123456789ABCDEA' });
  const b = new TrackerService({ github, store: storeB, user: 'alice', clock: () => new Date('2026-08-18T09:00:00.000Z'), idFactory: () => '01K2ABCDEF0123456789ABCDEB' });
  await a.refreshActive(); await b.refreshActive();
  const first = await a.stop('a'), second = await b.stop('b');
  assert.equal(first.entry.id, second.entry.id);
  assert.equal([...github.files.keys()].filter(path => path.startsWith('entries/')).length, 1);
});


test('direct concurrent Stop calls cannot both report success for different completions', async () => {
  const store = new MemoryStore(), github = new FakeGitHub();
  const service = new TrackerService({ github, store, user: 'alice', clock: clock.now, idFactory: () => '01K2ABCDEF0123456789ABCDEF' });
  await service.start(issue);
  clock.set(new Date(2026, 7, 18, 9, 0, 0));
  const results = await Promise.allSettled([service.stop('first'), service.stop('second')]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  const entries = [...github.files.entries()].filter(([path]) => path.startsWith('entries/'));
  assert.equal(entries.length, 1);
  assert.equal(entries[0][1].data.description, results.find(result => result.status === 'fulfilled').value.entry.description);
});


test('active clear requires the exact reserved entry identity', async () => {
  const store = new MemoryStore(), github = new FakeGitHub();
  const base = { schemaVersion: 1, user: 'alice', issue, startedAt: '2026-08-18T08:00:00.000Z', description: '', createdAt: '2026-08-18T08:00:00.000Z' };
  const snapshot = { ...base, entryId: '01K2ABCDEF0123456789ABCDEA' };
  github.files.set('active/alice.json', { sha: 'different', data: { ...base, entryId: '01K2ABCDEF0123456789ABCDEB' } });
  const service = new TrackerService({ github, store, user: 'alice' });
  await assert.rejects(() => service.clearMatchingActive({ activeSnapshot: snapshot }), TrackerConflictError);
  assert.equal(github.files.has('active/alice.json'), true);
});


test('two authenticated users track the same issue in independent files', async () => {
  const github = new FakeGitHub(), aliceStore = new MemoryStore(), bobStore = new MemoryStore();
  const alice = new TrackerService({ github, store: aliceStore, user: 'alice', clock: clock.now, idFactory: () => '01K2ABCDEF0123456789ABCDEA' });
  const bob = new TrackerService({ github, store: bobStore, user: 'bob', clock: clock.now, idFactory: () => '01K2ABCDEF0123456789ABCDEB' });
  await alice.start(issue); await bob.start(issue);
  clock.set(new Date(2026, 7, 18, 10, 0, 0));
  await alice.stop('alice work'); await bob.stop('bob work');
  const paths = [...github.files.keys()].filter(path => path.startsWith('entries/'));
  assert.equal(paths.some(path => path.startsWith('entries/alice/')), true);
  assert.equal(paths.some(path => path.startsWith('entries/bob/')), true);
  assert.equal(github.files.has('active/alice.json'), false);
  assert.equal(github.files.has('active/bob.json'), false);
});


test('recent and edit reject records whose identity disagrees with their path', async () => {
  const store = new MemoryStore(), github = new FakeGitHub();
  const pathId = '01K2ABCDEF0123456789ABCDEF', recordId = '01K2ABCDEF0123456789ABCDEA';
  const path = `entries/alice/2026/08/18/${pathId}.json`;
  const entry = { schemaVersion: 1, id: recordId, user: 'alice', issue, startedAt: '2026-08-18T08:00:00.000Z', endedAt: '2026-08-18T09:00:00.000Z', durationSeconds: 3600, description: '', createdAt: '2026-08-18T09:00:00.000Z', updatedAt: '2026-08-18T09:00:00.000Z' };
  github.files.set(path, { sha: 'bad', data: entry });
  github.listDirectory = async () => [{ name: `${pathId}.json`, path, type: 'file' }];
  const service = new TrackerService({ github, store, user: 'alice', clock: () => new Date('2026-08-18T12:00:00.000Z') });
  assert.deepEqual(await service.loadRecent(), []);
  await assert.rejects(() => service.editEntry({ path, originalSha: 'bad', edits: { description: 'changed' } }), /identity/i);
  await assert.rejects(() => service.deleteEntry({ path, originalSha: 'bad' }), /identity/i);
});

test('active record user must agree with its user-specific path', async () => {
  const store = new MemoryStore(), github = new FakeGitHub();
  github.files.set('active/alice.json', { sha: 'bad', data: { schemaVersion: 1, user: 'bob', issue, startedAt: '2026-08-18T08:00:00.000Z', description: '', createdAt: '2026-08-18T08:00:00.000Z' } });
  const service = new TrackerService({ github, store, user: 'alice' });
  await assert.rejects(() => service.refreshActive(), /user does not match/i);
});


test('different simultaneous Stops for one reserved timer adopt the first saved completion', async () => {
  const github = new FakeGitHub(), storeA = new MemoryStore(), storeB = new MemoryStore();
  const clockA = () => new Date('2026-08-18T09:00:00.000Z');
  const clockB = () => new Date('2026-08-18T09:05:00.000Z');
  const serviceA = new TrackerService({ github, store: storeA, user: 'alice', clock: clockA, idFactory: () => '01K2ABCDEF0123456789ABCDEF' });
  const serviceB = new TrackerService({ github, store: storeB, user: 'alice', clock: clockB });
  await serviceA.start(issue); await serviceB.refreshActive();
  const first = await serviceA.stop('first device');
  const second = await serviceB.stop('second device');
  assert.equal(first.pending, false);
  assert.equal(second.pending, false);
  assert.equal(second.entry.description, 'first device');
  assert.equal(storeB.value.pendingWrites.length, 0);
  assert.equal([...github.files.keys()].filter(path => path.startsWith('entries/')).length, 1);
});


test('cross-time-zone Stops reuse the local calendar date captured at Start', async () => {
  const originalTimezone = process.env.TZ;
  try {
    const github = new FakeGitHub(), storeA = new MemoryStore(), storeB = new MemoryStore();
    let nowA = new Date('2026-08-18T00:30:00.000Z');
    let nowB = new Date('2026-08-18T00:30:00.000Z');
    process.env.TZ = 'America/Los_Angeles';
    const serviceA = new TrackerService({ github, store: storeA, user: 'alice', clock: () => new Date(nowA), idFactory: () => '01K2ABCDEF0123456789ABCDEF' });
    const serviceB = new TrackerService({ github, store: storeB, user: 'alice', clock: () => new Date(nowB) });
    const active = await serviceA.start(issue);
    assert.equal(active.entryDate, '2026-08-17');
    await serviceB.refreshActive();
    process.env.TZ = 'UTC';
    nowA = new Date('2026-08-18T01:30:00.000Z');
    await serviceA.stop('UTC device');
    process.env.TZ = 'Asia/Tokyo';
    nowB = new Date('2026-08-18T01:35:00.000Z');
    await serviceB.stop('Tokyo device');
    const paths = [...github.files.keys()].filter(path => path.startsWith('entries/'));
    assert.deepEqual(paths, ['entries/alice/2026/08/17/01K2ABCDEF0123456789ABCDEF.json']);
    assert.equal(storeA.value.pendingWrites.length, 0);
    assert.equal(storeB.value.pendingWrites.length, 0);
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
});

test('entry directory date must agree with the record date identity', async () => {
  const store = new MemoryStore(), github = new FakeGitHub();
  const id = '01K2ABCDEF0123456789ABCDEF';
  const path = `entries/alice/2026/08/18/${id}.json`;
  const entry = {
    schemaVersion: 1, id, user: 'alice', issue,
    startedAt: '2026-08-15T08:00:00.000Z', endedAt: '2026-08-15T09:00:00.000Z',
    durationSeconds: 3600, description: '', createdAt: '2026-08-15T09:00:00.000Z', updatedAt: '2026-08-15T09:00:00.000Z',
  };
  github.files.set(path, { sha: 'wrong-date', data: entry });
  github.listDirectory = async () => [{ name: `${id}.json`, path, type: 'file' }];
  const service = new TrackerService({ github, store, user: 'alice', clock: () => new Date('2026-08-18T12:00:00.000Z') });
  assert.deepEqual(await service.loadRecent(), []);
  await assert.rejects(() => service.editEntry({ path, originalSha: 'wrong-date', edits: { description: 'changed' } }), /identity/i);
  await assert.rejects(() => service.deleteEntry({ path, originalSha: 'wrong-date' }), /identity/i);
});


test('malformed remote active state is not hidden by a valid local cache', async () => {
  const store = new MemoryStore(), github = new FakeGitHub();
  store.value.activeCache = { schemaVersion: 1, user: 'alice', issue, entryId: '01K2ABCDEF0123456789ABCDEF', entryDate: '2026-08-18', startedAt: '2026-08-18T08:00:00.000Z', description: '', createdAt: '2026-08-18T08:00:00.000Z', _sha: 'cached' };
  github.files.set('active/alice.json', { sha: 'malformed', data: { ...store.value.activeCache, startedAt: 'not-a-date', _sha: undefined } });
  const service = new TrackerService({ github, store, user: 'alice' });
  await assert.rejects(() => service.getState({ refresh: true }), /timestamp/i);
});


test('recent entries apply the limit only after globally ordering all date directories', async () => {
  const store = new MemoryStore(), github = new FakeGitHub();
  const olderIds = Array.from({ length: 50 }, (_, index) => `000000000000000000000000${String(index).padStart(2, '0')}`);
  const newerId = '7ZZZZZZZZZZZZZZZZZZZZZZZZZ';
  const directoriesRead = [];
  github.listDirectory = async directory => {
    directoriesRead.push(directory);
    if (directory.endsWith('/18')) return olderIds.map(id => ({ name: `${id}.json`, path: `${directory}/${id}.json`, type: 'file' }));
    if (directory.endsWith('/17')) return [{ name: `${newerId}.json`, path: `${directory}/${newerId}.json`, type: 'file' }];
    return [];
  };
  github.getFile = async path => {
    const id = path.slice(-31, -5);
    const entryDate = path.includes('/08/17/') ? '2026-08-17' : '2026-08-18';
    const startedAt = id === newerId ? '2026-08-18T00:30:00.000Z' : '2026-08-17T23:00:00.000Z';
    return { path, sha: `sha-${id}`, data: { schemaVersion: 1, id, user: 'alice', issue, entryDate, startedAt, endedAt: id === newerId ? '2026-08-18T00:31:00.000Z' : '2026-08-17T23:01:00.000Z', durationSeconds: 60, description: '', createdAt: '2026-08-18T01:00:00.000Z', updatedAt: '2026-08-18T01:00:00.000Z' } };
  };
  const service = new TrackerService({ github, store, user: 'alice', clock: () => new Date(2026, 7, 18, 12, 0, 0), recentDays: 2 });
  const recent = await service.loadRecent(50);
  assert.equal(directoriesRead.some(directory => directory.endsWith('/17')), true);
  assert.equal(recent.length, 50);
  assert.equal(recent[0].id, newerId);
});


test('malformed occupied completion becomes a stable conflict that can be retried after repair', async () => {
  const store = new MemoryStore(), github = new FakeGitHub();
  let now = new Date('2026-08-18T08:00:00.000Z');
  const id = '01K2ABCDEF0123456789ABCDEF';
  const service = new TrackerService({ github, store, user: 'alice', clock: () => new Date(now), idFactory: () => id });
  const active = await service.start(issue);
  const path = `entries/alice/2026/08/18/${id}.json`;
  github.files.set(path, { sha: 'malformed', data: { schemaVersion: 1, id, user: 'alice', startedAt: 'not-a-date' } });
  now = new Date('2026-08-18T09:00:00.000Z');
  const stopped = await service.stop('done');
  assert.equal(stopped.pending, true);
  assert.equal(store.value.pendingWrites[0].status, 'conflict');
  assert.equal(store.value.pendingWrites[0].stage, 'createEntry');
  const retryCount = store.value.pendingWrites[0].retryCount;
  await service.syncPending();
  assert.equal(store.value.pendingWrites[0].retryCount, retryCount);
  github.files.delete(path);
  await service.resolvePendingConflict(id);
  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(github.files.has(path), true);
  assert.equal(github.files.has('active/alice.json'), false);
  assert.equal(active.entryDate, '2026-08-18');
});


test('recent ordering includes an older-ID entry whose edited start is newest', async () => {
  const store = new MemoryStore(), github = new FakeGitHub();
  const ids = Array.from({ length: 51 }, (_, index) => `${String(index).padStart(26, '0')}`);
  github.listDirectory = async directory => ids.map(id => ({ name: `${id}.json`, path: `${directory}/${id}.json`, type: 'file' }));
  github.getFile = async path => {
    const id = path.slice(-31, -5), isEditedNewest = id === ids[0];
    const startedAt = isEditedNewest ? '2026-08-18T23:00:00.000Z' : '2026-08-18T08:00:00.000Z';
    const endedAt = isEditedNewest ? '2026-08-18T23:01:00.000Z' : '2026-08-18T08:01:00.000Z';
    return { path, sha: `sha-${id}`, data: { schemaVersion: 1, id, user: 'alice', issue, entryDate: '2026-08-18', startedAt, endedAt, durationSeconds: 60, description: '', createdAt: '2026-08-18T08:01:00.000Z', updatedAt: '2026-08-18T23:02:00.000Z' } };
  };
  const service = new TrackerService({ github, store, user: 'alice', clock: () => new Date(2026, 7, 18, 12), recentDays: 1 });
  const recent = await service.loadRecent(50);
  assert.equal(recent.length, 50);
  assert.equal(recent[0].id, ids[0]);
});

test('recent loading rejects an oversized candidate set before per-file API reads', async () => {
  const store = new MemoryStore(), github = new FakeGitHub();
  let fileReads = 0;
  github.listDirectory = async directory => Array.from({ length: 201 }, (_, index) => {
    const id = String(index).padStart(26, '0');
    return { name: `${id}.json`, path: `${directory}/${id}.json`, type: 'file' };
  });
  github.getFile = async () => { fileReads += 1; throw new Error('must not read oversized candidate sets'); };
  const service = new TrackerService({ github, store, user: 'alice', clock: () => new Date(2026, 7, 18, 12), recentDays: 1 });
  await assert.rejects(() => service.loadRecent(50), /candidate safety limit/i);
  assert.equal(fileReads, 0);
});


test('batch edit preflights and updates an adjacent time boundary', async () => {
  const store = new MemoryStore(); const github = new FakeGitHub();
  const firstPath = 'entries/alice/2026/08/18/01K2ABCDEF0123456789ABCDEA.json';
  const secondPath = 'entries/alice/2026/08/18/01K2ABCDEF0123456789ABCDEB.json';
  const make = (id, startedAt, endedAt) => ({
    schemaVersion: 1, id, user: 'alice', issue, entryDate: '2026-08-18', startedAt, endedAt,
    durationSeconds: (new Date(endedAt) - new Date(startedAt)) / 1000, description: '',
    createdAt: '2026-08-18T10:00:00.000Z', updatedAt: '2026-08-18T10:00:00.000Z',
  });
  github.files.set(firstPath, { sha: 'first', data: make('01K2ABCDEF0123456789ABCDEA', '2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z') });
  github.files.set(secondPath, { sha: 'second', data: make('01K2ABCDEF0123456789ABCDEB', '2026-08-18T09:00:00.000Z', '2026-08-18T10:00:00.000Z') });
  const service = new TrackerService({ github, store, user: 'alice', clock: () => new Date('2026-08-18T11:00:00.000Z') });
  const result = await service.moveBoundary({
    upper: { path: firstPath, originalSha: 'first', endedAt: '2026-08-18T09:15:00.000Z' },
    lower: { path: secondPath, originalSha: 'second', startedAt: '2026-08-18T09:15:00.000Z' },
  });
  assert.equal(result.length, 2);
  assert.equal(github.files.get(firstPath).data.endedAt, '2026-08-18T09:15:00.000Z');
  assert.equal(github.files.get(secondPath).data.startedAt, '2026-08-18T09:15:00.000Z');
});

test('batch edit rejects a stale second entry before writing the first', async () => {
  const store = new MemoryStore(); const github = new FakeGitHub();
  const firstPath = 'entries/alice/2026/08/18/01K2ABCDEF0123456789ABCDEA.json';
  const secondPath = 'entries/alice/2026/08/18/01K2ABCDEF0123456789ABCDEB.json';
  const make = (id, startedAt, endedAt) => ({
    schemaVersion: 1, id, user: 'alice', issue, entryDate: '2026-08-18', startedAt, endedAt,
    durationSeconds: (new Date(endedAt) - new Date(startedAt)) / 1000, description: '',
    createdAt: '2026-08-18T10:00:00.000Z', updatedAt: '2026-08-18T10:00:00.000Z',
  });
  github.files.set(firstPath, { sha: 'first', data: make('01K2ABCDEF0123456789ABCDEA', '2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z') });
  github.files.set(secondPath, { sha: 'newer-than-panel', data: make('01K2ABCDEF0123456789ABCDEB', '2026-08-18T09:00:00.000Z', '2026-08-18T10:00:00.000Z') });
  const service = new TrackerService({ github, store, user: 'alice', clock: () => new Date('2026-08-18T11:00:00.000Z') });
  await assert.rejects(() => service.moveBoundary({
    upper: { path: firstPath, originalSha: 'first', endedAt: '2026-08-18T09:15:00.000Z' },
    lower: { path: secondPath, originalSha: 'stale', startedAt: '2026-08-18T09:15:00.000Z' },
  }), TrackerConflictError);
  assert.equal(github.files.get(firstPath).sha, 'first');
  assert.equal(github.files.get(firstPath).data.endedAt, '2026-08-18T09:00:00.000Z');
});


test('batch edit rolls back the first entry if the second write races', async () => {
  const store = new MemoryStore(); const github = new FakeGitHub();
  const firstPath = 'entries/alice/2026/08/18/01K2ABCDEF0123456789ABCDEA.json';
  const secondPath = 'entries/alice/2026/08/18/01K2ABCDEF0123456789ABCDEB.json';
  const make = (id, startedAt, endedAt) => ({
    schemaVersion: 1, id, user: 'alice', issue, entryDate: '2026-08-18', startedAt, endedAt,
    durationSeconds: (new Date(endedAt) - new Date(startedAt)) / 1000, description: '',
    createdAt: '2026-08-18T10:00:00.000Z', updatedAt: '2026-08-18T10:00:00.000Z',
  });
  const originalFirst = make('01K2ABCDEF0123456789ABCDEA', '2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z');
  const originalSecond = make('01K2ABCDEF0123456789ABCDEB', '2026-08-18T09:00:00.000Z', '2026-08-18T10:00:00.000Z');
  github.files.set(firstPath, { sha: 'first', data: originalFirst }); github.files.set(secondPath, { sha: 'second', data: originalSecond });
  const put = github.putJson.bind(github); let secondRaced = false;
  github.putJson = async (path, data, message, sha) => {
    if (path === secondPath && !secondRaced) { secondRaced = true; const error = new Error('race'); error.status = 409; throw error; }
    return put(path, data, message, sha);
  };
  const service = new TrackerService({ github, store, user: 'alice', clock: () => new Date('2026-08-18T11:00:00.000Z') });
  await assert.rejects(() => service.moveBoundary({
    upper: { path: firstPath, originalSha: 'first', endedAt: '2026-08-18T09:15:00.000Z' },
    lower: { path: secondPath, originalSha: 'second', startedAt: '2026-08-18T09:15:00.000Z' },
  }), TrackerConflictError);
  assert.deepEqual(github.files.get(firstPath).data, originalFirst);
  assert.deepEqual(github.files.get(secondPath).data, originalSecond);
});


test('boundary move preserves a gap while shifting both sides by the same delta', async () => {
  const store = new MemoryStore(); const github = new FakeGitHub();
  const upperPath = 'entries/alice/2026/08/18/01K2ABCDEF0123456789ABCDEA.json';
  const lowerPath = 'entries/alice/2026/08/18/01K2ABCDEF0123456789ABCDEB.json';
  const make = (id, startedAt, endedAt) => ({ schemaVersion: 1, id, user: 'alice', issue, entryDate: '2026-08-18', startedAt, endedAt, durationSeconds: (new Date(endedAt) - new Date(startedAt)) / 1000, description: '', createdAt: '2026-08-18T10:00:00.000Z', updatedAt: '2026-08-18T10:00:00.000Z' });
  github.files.set(upperPath, { sha: 'upper', data: make('01K2ABCDEF0123456789ABCDEA', '2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z') });
  github.files.set(lowerPath, { sha: 'lower', data: make('01K2ABCDEF0123456789ABCDEB', '2026-08-18T09:30:00.000Z', '2026-08-18T10:30:00.000Z') });
  const service = new TrackerService({ github, store, user: 'alice', clock: () => new Date('2026-08-18T11:00:00.000Z') });
  await service.moveBoundary({
    upper: { path: upperPath, originalSha: 'upper', endedAt: '2026-08-18T09:15:00.000Z' },
    lower: { path: lowerPath, originalSha: 'lower', startedAt: '2026-08-18T09:45:00.000Z' },
  });
  assert.equal(github.files.get(upperPath).data.endedAt, '2026-08-18T09:15:00.000Z');
  assert.equal(github.files.get(lowerPath).data.startedAt, '2026-08-18T09:45:00.000Z');
});

test('boundary move rejects unequal deltas on its two sides', async () => {
  const store = new MemoryStore(); const github = new FakeGitHub();
  const upperPath = 'entries/alice/2026/08/18/01K2ABCDEF0123456789ABCDEA.json';
  const lowerPath = 'entries/alice/2026/08/18/01K2ABCDEF0123456789ABCDEB.json';
  const make = (id, startedAt, endedAt) => ({ schemaVersion: 1, id, user: 'alice', issue, entryDate: '2026-08-18', startedAt, endedAt, durationSeconds: (new Date(endedAt) - new Date(startedAt)) / 1000, description: '', createdAt: '2026-08-18T10:00:00.000Z', updatedAt: '2026-08-18T10:00:00.000Z' });
  github.files.set(upperPath, { sha: 'upper', data: make('01K2ABCDEF0123456789ABCDEA', '2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z') });
  github.files.set(lowerPath, { sha: 'lower', data: make('01K2ABCDEF0123456789ABCDEB', '2026-08-18T09:30:00.000Z', '2026-08-18T10:30:00.000Z') });
  const service = new TrackerService({ github, store, user: 'alice', clock: () => new Date('2026-08-18T11:00:00.000Z') });
  await assert.rejects(() => service.moveBoundary({
    upper: { path: upperPath, originalSha: 'upper', endedAt: '2026-08-18T09:15:00.000Z' },
    lower: { path: lowerPath, originalSha: 'lower', startedAt: '2026-08-18T09:50:00.000Z' },
  }), /same amount/i);
});

test('batch edit verifies a committed second write after its response is lost', async () => {
  const store = new MemoryStore(); const github = new FakeGitHub();
  const upperPath = 'entries/alice/2026/08/18/01K2ABCDEF0123456789ABCDEA.json';
  const lowerPath = 'entries/alice/2026/08/18/01K2ABCDEF0123456789ABCDEB.json';
  const make = (id, startedAt, endedAt) => ({ schemaVersion: 1, id, user: 'alice', issue, entryDate: '2026-08-18', startedAt, endedAt, durationSeconds: (new Date(endedAt) - new Date(startedAt)) / 1000, description: '', createdAt: '2026-08-18T10:00:00.000Z', updatedAt: '2026-08-18T10:00:00.000Z' });
  github.files.set(upperPath, { sha: 'upper', data: make('01K2ABCDEF0123456789ABCDEA', '2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z') });
  github.files.set(lowerPath, { sha: 'lower', data: make('01K2ABCDEF0123456789ABCDEB', '2026-08-18T09:00:00.000Z', '2026-08-18T10:00:00.000Z') });
  const put = github.putJson.bind(github), get = github.getFile.bind(github); let lost = false, staleReads = 0;
  const originalLower = structuredClone(github.files.get(lowerPath));
  github.putJson = async (...args) => { const result = await put(...args); if (args[0] === lowerPath && !lost) { lost = true; throw new TypeError('response lost after commit'); } return result; };
  github.getFile = async path => {
    if (path === lowerPath && lost && staleReads++ === 0) return { path, sha: originalLower.sha, data: structuredClone(originalLower.data) };
    return get(path);
  };
  const service = new TrackerService({ github, store, user: 'alice', clock: () => new Date('2026-08-18T11:00:00.000Z') });
  const result = await service.moveBoundary({
    upper: { path: upperPath, originalSha: 'upper', endedAt: '2026-08-18T09:15:00.000Z' },
    lower: { path: lowerPath, originalSha: 'lower', startedAt: '2026-08-18T09:15:00.000Z' },
  });
  assert.equal(result.length, 2);
  assert.equal(github.files.get(upperPath).data.endedAt, '2026-08-18T09:15:00.000Z');
  assert.equal(github.files.get(lowerPath).data.startedAt, '2026-08-18T09:15:00.000Z');
  assert.equal(staleReads, 2, 'verification retries after one successful but stale read');
});
