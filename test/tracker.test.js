import test from 'node:test';
import assert from 'node:assert/strict';
import { TrackerConflictError, TrackerService } from '../src/services/tracker.js';
import { parseActiveText, parseDailyText, serializeActiveText, serializeDailyText } from '../src/domain/daily-text.js';

const issue = { type: 'issue', owner: 'acme', repo: 'frontend', number: 123, url: 'https://github.com/acme/frontend/issues/123' };
const pull = { type: 'pull_request', owner: 'acme', repo: 'frontend', number: 44, url: 'https://github.com/acme/frontend/pull/44' };
const fixedId = '01K2ABCDEF0123456789ABCDEF';

class MemoryStore {
  constructor() { this.value = { activeCache: null, recentCache: [], pendingWrites: [], user: 'alice' }; }
  async getState() { return structuredClone(this.value); }
  async patchState(patch) { Object.assign(this.value, structuredClone(patch)); }
}

class FakeGitHub {
  constructor() { this.files = new Map(); this.reads = []; this.writes = []; this.deletes = []; this.atomicWrites = []; this.serial = 0; }
  notFound() { const error = new Error('not found'); error.status = 404; error.code = 'not_found'; return error; }
  conflict() { const error = new Error('conflict'); error.status = 409; error.code = 'conflict'; return error; }
  async getText(path) {
    this.reads.push(path); const file = this.files.get(path); if (!file) throw this.notFound();
    return { path, sha: file.sha, text: file.text };
  }
  async putText(path, text, message, sha) {
    const current = this.files.get(path);
    if ((current && sha !== current.sha) || (!current && sha)) throw this.conflict();
    const nextSha = `sha-${++this.serial}`; this.files.set(path, { sha: nextSha, text }); this.writes.push({ path, text, message, sha });
    return { sha: nextSha, commitSha: `commit-${this.serial}` };
  }
  async deleteFile(path, message, sha) {
    const current = this.files.get(path); if (!current) throw this.notFound(); if (current.sha !== sha) throw this.conflict();
    this.files.delete(path); this.deletes.push({ path, message, sha }); return {};
  }
  async updateTextsAtomic(changes, message) {
    for (const change of changes) {
      const current = this.files.get(change.path);
      if ((current?.sha ?? null) !== (change.sha ?? null)) throw this.conflict();
    }
    const commitSha = `commit-${++this.serial}`, blobShas = {};
    for (const change of changes) {
      if (change.text === null) this.files.delete(change.path);
      else { blobShas[change.path] = `${commitSha}-${change.path}`; this.files.set(change.path, { sha: blobShas[change.path], text: change.text }); }
    }
    this.atomicWrites.push({ changes: structuredClone(changes), message });
    return { commitSha, blobShas };
  }
}

function active(startedAt = '2026-08-18T08:00:00+00:00', override = {}) {
  return { schemaVersion: 1, user: 'alice', issue, entryDate: startedAt.slice(0, 10), startedAt, description: '', createdAt: startedAt, ...override };
}
function entry(startedAt, endedAt, override = {}) {
  return {
    schemaVersion: 1, id: fixedId, user: 'alice', issue, entryDate: startedAt.slice(0, 10), startedAt, endedAt,
    durationSeconds: (new Date(endedAt) - new Date(startedAt)) / 1000, description: '', createdAt: endedAt, updatedAt: endedAt, ...override,
  };
}
function seedText(github, path, text, sha = 'seed') { github.files.set(path, { sha, text }); }
function service(options = {}) {
  return new TrackerService({ github: options.github ?? new FakeGitHub(), store: options.store ?? new MemoryStore(), user: 'alice',
    clock: options.clock ?? (() => new Date('2026-08-18T09:00:00Z')), idFactory: options.idFactory ?? (() => fixedId),
    recentDays: options.recentDays ?? 7, allowedIssueOwners: ['acme'] });
}

test('start writes one readable active text file without user or generated metadata', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), tracker = service({ github, store });
  const result = await tracker.start(issue, 'ignored title', 'Investigating');
  assert.equal(result._path, 'active/alice.txt');
  const file = github.files.get('active/alice.txt');
  assert.match(file.text, /^URL: https:\/\/github\.com\/acme\/frontend\/issues\/123\nStart: .*?(?:Z|[+-]\d{2}:\d{2})\nDescription: Investigating\n$/);
  assert.equal(new Date(parseActiveText(file.text, { user: 'alice' }).startedAt).getTime(), new Date('2026-08-18T09:00:00Z').getTime());
  assert.doesNotMatch(file.text, /user|schema|title/i);
  assert.equal(parseActiveText(file.text, { user: 'alice' }).issue.number, 123);
});

test('stop appends to one daily text file and clears active', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(); let now = new Date('2026-08-18T08:00:00Z');
  const tracker = service({ github, store, clock: () => new Date(now) });
  await tracker.start(issue); const activeReadsBeforeStop = github.reads.filter(path => path === 'active/alice.txt').length; now = new Date('2026-08-18T09:15:00Z');
  const stopped = await tracker.stop('Done');
  assert.equal(stopped.pending, false);
  assert.equal(github.files.has('active/alice.txt'), false);
  const file = github.files.get('times/2026-08-18/alice.txt');
  assert.ok(file);
  assert.equal((file.text.match(/^URL:/gm) || []).length, 1);
  assert.equal(new Date(parseDailyText(file.text, { user: 'alice', date: '2026-08-18' })[0].endedAt).getTime(), new Date('2026-08-18T09:15:00Z').getTime());
  assert.match(file.text, /Description: Done/);
  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(github.reads.filter(path => path === 'active/alice.txt').length, activeReadsBeforeStop + 1, 'Stop verifies that the cached timer is still authoritative before completing it');
});

test('stop does not complete a stale cached timer after another device replaces it', async () => {
  const github = new FakeGitHub(), store = new MemoryStore();
  const stale = { ...active('2026-08-18T08:00:00+00:00'), _path: 'active/alice.txt', _sha: 'stale-sha' };
  const current = active('2026-08-18T10:00:00+00:00', { issue: pull });
  store.value.activeCache = stale;
  seedText(github, 'active/alice.txt', serializeActiveText(current), 'current-sha');
  await assert.rejects(() => service({ github, store }).stop('must not be saved'), /changed on another device/i);
  assert.equal(github.files.has('times/2026-08-18/alice.txt'), false);
  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(store.value.activeCache.issue.url, pull.url);
  assert.equal(store.value.activeCache._sha, 'current-sha');
});

test('a confirmed missing active file cannot create a completion from stale cache', async () => {
  const github = new FakeGitHub(), store = new MemoryStore();
  store.value.activeCache = { ...active('2026-08-18T08:00:00+00:00'), _path: 'active/alice.txt', _sha: 'stale-sha' };
  await assert.rejects(() => service({ github, store }).stop('must not be saved'), /No timer is running/);
  assert.equal(github.files.has('times/2026-08-18/alice.txt'), false);
  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(store.value.activeCache, null);
});

test('a transient read followed by confirmed missing cannot append stale cache', async () => {
  class OneFailedActiveReadGitHub extends FakeGitHub {
    constructor() { super(); this.failNextActiveRead = true; }
    async getText(path) {
      if (path === 'active/alice.txt' && this.failNextActiveRead) {
        this.failNextActiveRead = false;
        throw new TypeError('temporary network failure');
      }
      return super.getText(path);
    }
  }
  const github = new OneFailedActiveReadGitHub(), store = new MemoryStore();
  store.value.activeCache = { ...active('2026-08-18T08:00:00+00:00'), _path: 'active/alice.txt', _sha: 'stale-sha' };
  const result = await service({ github, store }).stop('must not be saved');
  assert.equal(result.pending, true);
  assert.equal(github.files.has('times/2026-08-18/alice.txt'), false);
  assert.equal(store.value.pendingWrites[0].stage, 'verifyActive');
  assert.equal(store.value.pendingWrites[0].status, 'conflict');
  assert.deepEqual(await service({ github, store }).resolvePendingConflict(fixedId), { resolved: true });
  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(store.value.recentCache.some(item => item._pending), false);
});

test('a transient read followed by confirmed missing adopts an existing completion', async () => {
  class OneFailedActiveReadGitHub extends FakeGitHub {
    constructor() { super(); this.failNextActiveRead = true; }
    async getText(path) {
      if (path === 'active/alice.txt' && this.failNextActiveRead) {
        this.failNextActiveRead = false;
        throw new TypeError('temporary network failure');
      }
      return super.getText(path);
    }
  }
  const github = new OneFailedActiveReadGitHub(), store = new MemoryStore();
  const timer = active('2026-08-18T08:00:00+00:00');
  const completed = entry('2026-08-18T08:00:00+00:00', '2026-08-18T09:00:00+00:00', { description: 'first device' });
  store.value.activeCache = { ...timer, _path: 'active/alice.txt', _sha: 'stale-sha' };
  seedText(github, 'times/2026-08-18/alice.txt', serializeDailyText([completed]), 'daily-sha');
  const result = await service({ github, store }).stop('second device');
  assert.equal(result.pending, false);
  assert.equal(result.entry.description, 'first device');
  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(parseDailyText(github.files.get('times/2026-08-18/alice.txt').text, { user: 'alice', date: '2026-08-18', path: 'times/2026-08-18/alice.txt' }).length, 1);
});

test('a transient active read failure cannot append a stale cached timer before verification', async () => {
  class OneFailedActiveReadGitHub extends FakeGitHub {
    constructor() { super(); this.failNextActiveRead = true; }
    async getText(path) {
      if (path === 'active/alice.txt' && this.failNextActiveRead) {
        this.failNextActiveRead = false;
        throw new TypeError('temporary network failure');
      }
      return super.getText(path);
    }
  }
  const github = new OneFailedActiveReadGitHub(), store = new MemoryStore();
  const stale = { ...active('2026-08-18T08:00:00+00:00'), _path: 'active/alice.txt', _sha: 'stale-sha' };
  store.value.activeCache = stale;
  seedText(github, 'active/alice.txt', serializeActiveText(active('2026-08-18T10:00:00+00:00', { issue: pull })), 'current-sha');
  const result = await service({ github, store }).stop('must not be saved');
  assert.equal(result.pending, true);
  assert.equal(github.files.has('times/2026-08-18/alice.txt'), false);
  assert.equal(store.value.pendingWrites[0].status, 'conflict');
  assert.equal(store.value.activeCache.issue.url, pull.url);
  assert.deepEqual(await service({ github, store }).resolvePendingConflict(fixedId), { resolved: true });
  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(store.value.recentCache.some(item => item._pending), false);
  assert.equal(github.files.has('active/alice.txt'), true);
});

test('acknowledging a clear-active conflict keeps the newer timer and completes the saved operation', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), tracker = service({ github, store });
  const old = active('2026-08-18T08:00:00+00:00');
  const completed = entry(old.startedAt, '2026-08-18T09:00:00+00:00');
  const operation = { operation: 'completeTimer', id: fixedId, status: 'conflict', retryCount: 1, stage: 'clearActive',
    dailyPath: 'times/2026-08-18/alice.txt', entry: completed, activeSnapshot: old, activeSha: 'old-sha', queuedAt: completed.endedAt, lastError: 'new timer' };
  store.value.pendingWrites = [operation];
  seedText(github, operation.dailyPath, serializeDailyText([completed]), 'daily-sha');
  seedText(github, 'active/alice.txt', serializeActiveText(active('2026-08-18T10:00:00+00:00', { issue: pull })), 'new-sha');
  const result = await tracker.resolvePendingConflict(fixedId);
  assert.deepEqual(result, { resolved: true });
  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(store.value.activeCache.issue.url, pull.url);
  assert.equal(github.files.has('active/alice.txt'), true);
});

test('multiple completions on one day append to the same file', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(); let now = new Date('2026-08-18T08:00:00Z'), serial = 0;
  const tracker = service({ github, store, clock: () => new Date(now), idFactory: () => `01K2ABCDEF0123456789ABCDE${serial++ ? 'A' : 'F'}` });
  await tracker.start(issue); now = new Date('2026-08-18T09:00:00Z'); await tracker.stop();
  now = new Date('2026-08-18T10:00:00Z'); await tracker.start(pull); now = new Date('2026-08-18T11:00:00Z'); await tracker.stop('review');
  const file = github.files.get('times/2026-08-18/alice.txt');
  assert.equal((file.text.match(/^URL:/gm) || []).length, 2);
  assert.equal([...github.files.keys()].filter(path => path.startsWith('times/')).length, 1);
});

test('recent loading performs one direct read per day and no directory or per-record requests', async () => {
  const github = new FakeGitHub(), store = new MemoryStore();
  const records = [entry('2026-08-18T08:00:00+00:00', '2026-08-18T09:00:00+00:00'), entry('2026-08-18T10:00:00+00:00', '2026-08-18T11:00:00+00:00', { issue: pull })];
  seedText(github, 'times/2026-08-18/alice.txt', serializeDailyText(records));
  const recent = await service({ github, store, recentDays: 7, clock: () => new Date('2026-08-18T12:00:00Z') }).loadRecent();
  assert.equal(recent.length, 2);
  assert.equal(github.reads.length, 7);
  assert.equal(new Set(github.reads).size, 7);
  assert.equal(recent[0].issue.type, 'pull_request');
});

test('recent daily files are fetched concurrently', async () => {
  const github = new FakeGitHub(); let inFlight = 0, peak = 0;
  github.getText = async path => { github.reads.push(path); inFlight += 1; peak = Math.max(peak, inFlight); await new Promise(resolve => setTimeout(resolve, 5)); inFlight -= 1; throw github.notFound(); };
  await service({ github, recentDays: 7 }).loadRecent();
  assert.equal(github.reads.length, 7); assert.equal(peak, 7);
});

test('editing one entry rewrites its daily file once and preserves the other records', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-08-18/alice.txt';
  seedText(github, path, serializeDailyText([entry('2026-08-18T08:00:00+00:00', '2026-08-18T09:00:00+00:00'), entry('2026-08-18T10:00:00+00:00', '2026-08-18T11:00:00+00:00', { issue: pull })]), 'daily');
  const tracker = service({ github, store });
  const saved = await tracker.editEntry({ path, originalSha: 'daily', index: 1, edits: { description: 'manual note', endedAt: '2026-08-18T11:30:00+00:00' } });
  assert.equal(github.writes.length, 1);
  const parsed = parseDailyText(github.files.get(path).text, { user: 'alice', date: '2026-08-18' });
  assert.equal(parsed[0].description, ''); assert.equal(parsed[1].description, 'manual note');
  assert.equal(saved._index, 1); assert.equal(saved.durationSeconds, 5400);
});

test('edit locates the intended record after its array position changed', async () => {
  const github = new FakeGitHub(), path = 'times/2026-08-18/alice.txt';
  const intended = entry('2026-08-18T15:13:17+00:00', '2026-08-18T16:13:17+00:00', { description: 'target' });
  seedText(github, path, serializeDailyText([entry('2026-08-18T08:00:00+00:00', '2026-08-18T09:00:00+00:00'), intended]), 'daily');
  const saved = await service({ github }).editEntry({ path, originalSha: 'daily', index: 99,
    original: { issueUrl: intended.issue.url, startedAt: intended.startedAt, endedAt: intended.endedAt, description: intended.description },
    edits: { startedAt: '2026-08-18T01:13:17+00:00' } });
  assert.equal(saved.startedAt, '2026-08-18T01:13:17+00:00'); assert.equal(saved.description, 'target');
});

test('successful edit returns the edited position when visible records become identical', async () => {
  const github = new FakeGitHub(), path = 'times/2026-08-18/alice.txt';
  const first = entry('2026-08-18T08:00:00+00:00', '2026-08-18T09:00:00+00:00', 'same');
  const second = entry('2026-08-18T10:00:00+00:00', '2026-08-18T11:00:00+00:00', 'same');
  seedText(github, path, serializeDailyText([first, second]), 'daily');
  const saved = await service({ github }).editEntry({ path, originalSha: 'daily', index: 1,
    original: { issueUrl: second.issue.url, startedAt: second.startedAt, endedAt: second.endedAt, description: second.description },
    edits: { startedAt: first.startedAt, endedAt: first.endedAt } });
  assert.equal(saved._index, 1);
});

test('editing Start into another day atomically moves the record to that daily file', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), source = 'times/2026-08-18/alice.txt', destination = 'times/2026-08-17/alice.txt';
  const intended = entry('2026-08-18T00:13:17+00:00', '2026-08-18T02:13:17+00:00');
  seedText(github, source, serializeDailyText([intended]), 'source');
  store.value.recentCache = parseDailyText(serializeDailyText([intended]), { user: 'alice', date: '2026-08-18', path: source, sha: 'source' });
  const saved = await service({ github, store }).editEntry({ path: source, originalSha: 'source', index: 0,
    original: { issueUrl: intended.issue.url, startedAt: intended.startedAt, endedAt: intended.endedAt, description: '' },
    edits: { startedAt: '2026-08-17T23:13:17+00:00' } });
  assert.equal(github.atomicWrites.length, 1); assert.equal(github.files.has(source), false); assert.equal(saved._path, destination);
  assert.equal(parseDailyText(github.files.get(destination).text, { user: 'alice', date: '2026-08-17' })[0].startedAt, '2026-08-17T23:13:17+00:00');
  assert.deepEqual(store.value.recentCache.map(record => record._path), [destination]);
});

test('edit rejects a stale daily-file SHA before writing', async () => {
  const github = new FakeGitHub(), path = 'times/2026-08-18/alice.txt'; seedText(github, path, serializeDailyText([entry('2026-08-18T08:00:00+00:00', '2026-08-18T09:00:00+00:00')]), 'new');
  await assert.rejects(() => service({ github }).editEntry({ path, originalSha: 'old', index: 0, edits: { description: 'x' } }), TrackerConflictError);
  assert.equal(github.writes.length, 0);
});

test('deleting one record keeps the daily file; deleting the last removes it', async () => {
  const github = new FakeGitHub(), path = 'times/2026-08-18/alice.txt'; seedText(github, path, serializeDailyText([entry('2026-08-18T08:00:00+00:00', '2026-08-18T09:00:00+00:00'), entry('2026-08-18T10:00:00+00:00', '2026-08-18T11:00:00+00:00')]), 'one');
  const tracker = service({ github }); await tracker.deleteEntry({ path, originalSha: 'one', index: 0 });
  assert.equal(parseDailyText(github.files.get(path).text, { user: 'alice', date: '2026-08-18' }).length, 1);
  await tracker.deleteEntry({ path, originalSha: github.files.get(path).sha, index: 0 });
  assert.equal(github.files.has(path), false); assert.equal(github.deletes.length, 1);
});

test('same-day boundary movement updates two entries with one GitHub write', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-08-18/alice.txt';
  seedText(github, path, serializeDailyText([entry('2026-08-18T08:00:00+00:00', '2026-08-18T09:00:00+00:00'), entry('2026-08-18T09:30:00+00:00', '2026-08-18T11:00:00+00:00')]), 'daily');
  const saved = await service({ github, store }).moveBoundary({
    upper: { path, originalSha: 'daily', index: 0, endedAt: '2026-08-18T10:00:00+00:00' },
    lower: { path, originalSha: 'daily', index: 1, startedAt: '2026-08-18T10:30:00+00:00' },
  });
  assert.equal(github.writes.length, 1); assert.equal(saved.length, 2);
  const parsed = parseDailyText(github.files.get(path).text, { user: 'alice', date: '2026-08-18' });
  assert.equal(parsed[0].endedAt, '2026-08-18T10:00:00+00:00'); assert.equal(parsed[1].startedAt, '2026-08-18T10:30:00+00:00');
});

test('boundary movement has no arbitrary twelve-hour cap', async () => {
  const github = new FakeGitHub(), upperPath = 'times/2026-08-17/alice.txt', lowerPath = 'times/2026-08-18/alice.txt';
  seedText(github, upperPath, serializeDailyText([entry('2026-08-17T00:00:00+00:00', '2026-08-18T01:00:00+00:00')]), 'upper');
  seedText(github, lowerPath, serializeDailyText([entry('2026-08-18T01:00:00+00:00', '2026-08-20T01:00:00+00:00')]), 'lower');
  await service({ github }).moveBoundary({
    upper: { path: upperPath, originalSha: 'upper', index: 0, endedAt: '2026-08-19T01:00:00+00:00' },
    lower: { path: lowerPath, originalSha: 'lower', index: 0, startedAt: '2026-08-19T01:00:00+00:00' },
  });
  const upper = parseDailyText(github.files.get(upperPath).text, { user: 'alice', date: '2026-08-17' });
  const movedPath = 'times/2026-08-19/alice.txt';
  const lower = parseDailyText(github.files.get(movedPath).text, { user: 'alice', date: '2026-08-19' });
  assert.equal(upper[0].durationSeconds, 49 * 3600); assert.equal(lower[0].durationSeconds, 24 * 3600);
  assert.equal(github.atomicWrites.length, 1, 'moving Start into another day updates all daily files atomically');
});

test('boundary movement rejects unequal deltas and invalid durations', async () => {
  const github = new FakeGitHub(), path = 'times/2026-08-18/alice.txt'; seedText(github, path, serializeDailyText([entry('2026-08-18T08:00:00+00:00', '2026-08-18T09:00:00+00:00'), entry('2026-08-18T09:00:00+00:00', '2026-08-18T10:00:00+00:00')]), 'daily');
  const tracker = service({ github });
  await assert.rejects(() => tracker.moveBoundary({ upper: { path, originalSha: 'daily', index: 0, endedAt: '2026-08-18T09:15:00+00:00' }, lower: { path, originalSha: 'daily', index: 1, startedAt: '2026-08-18T09:20:00+00:00' } }), /same amount/i);
  await assert.rejects(() => tracker.moveBoundary({ upper: { path, originalSha: 'daily', index: 0, endedAt: '2026-08-18T07:00:00+00:00' }, lower: { path, originalSha: 'daily', index: 1, startedAt: '2026-08-18T07:00:00+00:00' } }), /end/i);
  assert.equal(github.writes.length, 0);
});

test('cross-day boundary changes are one atomic repository update', async () => {
  const github = new FakeGitHub(), first = 'times/2026-08-17/alice.txt', second = 'times/2026-08-18/alice.txt';
  seedText(github, first, serializeDailyText([entry('2026-08-17T22:00:00+00:00', '2026-08-17T23:00:00+00:00')]), 'first');
  seedText(github, second, serializeDailyText([entry('2026-08-18T00:00:00+00:00', '2026-08-18T01:00:00+00:00')]), 'second');
  await service({ github }).moveBoundary({ upper: { path: first, originalSha: 'first', index: 0, endedAt: '2026-08-17T23:15:00+00:00' }, lower: { path: second, originalSha: 'second', index: 0, startedAt: '2026-08-18T00:15:00+00:00' } });
  assert.equal(github.atomicWrites.length, 1); assert.equal(github.writes.length, 0);
  assert.equal(parseDailyText(github.files.get(first).text, { user: 'alice', date: '2026-08-17' })[0].endedAt, '2026-08-17T23:15:00+00:00');
  assert.equal(parseDailyText(github.files.get(second).text, { user: 'alice', date: '2026-08-18' })[0].startedAt, '2026-08-18T00:15:00+00:00');
});

test('pending completion does not adopt an unrelated record with only the same URL and Start', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-08-18/alice.txt';
  seedText(github, path, serializeDailyText([entry('2026-08-18T08:00:00+00:00', '2026-08-18T08:30:00+00:00', { description: 'old unrelated completion' })]), 'daily');
  seedText(github, 'active/alice.txt', serializeActiveText(active()), 'active');
  const tracker = service({ github, store, clock: () => new Date('2026-08-18T09:00:00Z') }); await tracker.refreshActive();
  const stopped = await tracker.stop('new completion');
  const records = parseDailyText(github.files.get(path).text, { user: 'alice', date: '2026-08-18' });
  assert.equal(stopped.pending, false); assert.equal(records.length, 2);
  assert.deepEqual(records.map(record => record.description), ['old unrelated completion', 'new completion']);
});

test('concurrent Stops adopt the first completion instead of duplicating it', async () => {
  const github = new FakeGitHub(), aStore = new MemoryStore(), bStore = new MemoryStore();
  seedText(github, 'active/alice.txt', serializeActiveText(active()), 'active');
  const a = service({ github, store: aStore, clock: () => new Date('2026-08-18T09:00:00Z') });
  const b = service({ github, store: bStore, clock: () => new Date('2026-08-18T09:05:00Z') });
  await a.refreshActive(); await b.refreshActive(); await a.stop('first'); const second = await b.stop('second');
  const parsed = parseDailyText(github.files.get('times/2026-08-18/alice.txt').text, { user: 'alice', date: '2026-08-18' });
  assert.equal(parsed.length, 1); assert.equal(parsed[0].description, 'first'); assert.equal(second.entry.description, 'first');
});

test('simultaneous Stops converge automatically after a daily-file create race', async () => {
  class RacingGitHub extends FakeGitHub {
    constructor() { super(); this.activeReads = 0; this.deleteGate = new Promise(resolve => { this.releaseDelete = resolve; }); }
    async getText(path) {
      const result = await super.getText(path);
      if (path === 'active/alice.txt' && ++this.activeReads === 5) setTimeout(this.releaseDelete, 0);
      return result;
    }
    async deleteFile(path, message, sha) {
      if (path === 'active/alice.txt') await this.deleteGate;
      return super.deleteFile(path, message, sha);
    }
  }
  const github = new RacingGitHub(), aStore = new MemoryStore(), bStore = new MemoryStore();
  seedText(github, 'active/alice.txt', serializeActiveText(active()), 'active');
  const a = service({ github, store: aStore, clock: () => new Date('2026-08-18T09:00:00Z') });
  const b = service({ github, store: bStore, clock: () => new Date('2026-08-18T09:05:00Z') });
  await a.refreshActive(); await b.refreshActive();
  await Promise.all([a.stop('first'), b.stop('second')]);
  const pendingTracker = aStore.value.pendingWrites.length ? a : b;
  const pendingStore = aStore.value.pendingWrites.length ? aStore : bStore;
  assert.equal(pendingStore.value.pendingWrites[0]?.status, 'pending', 'the loser remains automatically retryable');
  await pendingTracker.syncPending();
  const parsed = parseDailyText(github.files.get('times/2026-08-18/alice.txt').text, { user: 'alice', date: '2026-08-18' });
  assert.equal(parsed.length, 1);
  assert.equal(pendingStore.value.pendingWrites.length, 0);
});

test('malformed daily text fails visibly instead of silently hiding the whole day', async () => {
  const github = new FakeGitHub(); seedText(github, 'times/2026-08-18/alice.txt', 'URL: javascript:alert(1)\nStart: nope\nEnd: nope\n');
  await assert.rejects(() => service({ github, recentDays: 1 }).loadRecent(), /issue|timestamp/i);
});

test('issue-owner policy still applies to starts and edits', async () => {
  const github = new FakeGitHub(), tracker = service({ github });
  await assert.rejects(() => tracker.start({ type: 'issue', owner: 'evil', repo: 'x', number: 1, url: 'https://github.com/evil/x/issues/1' }), /not allowed/i);
});


test('menu data reports the complete current-day total even when recent rows are capped', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-08-18/alice.txt';
  const entries = Array.from({ length: 55 }, (_, index) => {
    const start = new Date(Date.UTC(2026, 7, 18, 0, index, 0)), end = new Date(start.getTime() + 60_000);
    return entry(start.toISOString().replace('.000Z', '+00:00'), end.toISOString().replace('.000Z', '+00:00'));
  });
  seedText(github, path, serializeDailyText(entries), 'daily');
  const pendingEntry = entry('2026-08-18T02:00:00+00:00', '2026-08-18T02:01:00+00:00');
  store.value.pendingWrites = [{ operation: 'completeTimer', id: 'pending-total', status: 'pending', retryCount: 0, stage: 'appendDaily', dailyPath: path, entry: pendingEntry, activeSnapshot: active(pendingEntry.startedAt), activeSha: 'active', queuedAt: pendingEntry.endedAt, lastError: '' }];
  const running = active('2026-08-18T11:00:00+00:00');
  store.value.activeCache = running;
  const data = await service({ github, store, recentDays: 1, clock: () => new Date('2026-08-18T12:00:00Z') }).loadMenuData(50);
  assert.equal(data.recent.length, 50);
  assert.equal(data.todaySeconds, 56 * 60);
  assert.equal(data.reportDate, '2026-08-18');
  assert.equal(data.active.startedAt, running.startedAt);
  assert.equal(data.pendingCount, 1);
  assert.deepEqual(data.pendingWrites, [{ id: 'pending-total', status: 'pending', stage: 'appendDaily' }]);
  assert.equal(Object.keys(data.active).some(key => key.startsWith('_')), false);
});
