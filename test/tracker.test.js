import test from 'node:test';
import assert from 'node:assert/strict';
import { TrackerConflictError, TrackerService } from '../src/services/tracker.js';
import { parseActiveText, parseMonthlyText, serializeActiveText, serializeMonthlyText } from '../src/domain/monthly-text.js';

const issue = { type: 'issue', owner: 'acme', repo: 'frontend', number: 123, url: 'https://github.com/acme/frontend/issues/123' };
const pull = { type: 'pull_request', owner: 'acme', repo: 'frontend', number: 44, url: 'https://github.com/acme/frontend/pull/44' };
const fixedId = '01K2ABCDEF0123456789ABCDEF';

class MemoryStore {
  constructor() { this.value = { activeCache: null, recentCache: [], pendingWrites: [], user: 'alice' }; }
  async getState() { return structuredClone(this.value); }
  async patchState(patch) { Object.assign(this.value, structuredClone(patch)); }
}

class FakeGitHub {
  constructor() { this.files = new Map(); this.reads = []; this.writes = []; this.deletes = []; this.atomicWrites = []; this.metadataReads = []; this.metadata = new Map(); this.serial = 0; this.headSha = 'discovery-head'; }
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
  async assertDestinationReachable() { return true; }
  async listTextFilesSnapshot(prefix) {
    return { notModified: false, etag: '', headSha: this.headSha, files: [...this.files].filter(([path]) => path.startsWith(prefix)).map(([path, file]) => ({ path, sha: file.sha, size: file.text.length })) };
  }
  async getTaskMetadata(issues) { this.metadataReads.push(structuredClone(issues)); return new Map(issues.flatMap(item => this.metadata.has(item.url) ? [[item.url, this.metadata.get(item.url)]] : [])); }
  async updateTextsAtomic(changes, message, { guards = [], expectedHeadSha = null } = {}) {
    for (const item of [...changes, ...guards]) {
      const current = this.files.get(item.path);
      if ((current?.sha ?? null) !== (item.sha ?? null)) throw this.conflict();
    }
    const commitSha = `commit-${++this.serial}`, blobShas = {};
    for (const change of changes) {
      if (change.text === null) this.files.delete(change.path);
      else { blobShas[change.path] = `${commitSha}-${change.path}`; this.files.set(change.path, { sha: blobShas[change.path], text: change.text }); }
    }
    this.atomicWrites.push({ changes: structuredClone(changes), guards: structuredClone(guards), expectedHeadSha, message });
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
function localTimestamp(year, monthIndex, day, hour = 0, minute = 0, second = 0) {
  const date = new Date(year, monthIndex, day, hour, minute, second, 0);
  const pad = value => String(value).padStart(2, '0');
  const offset = -date.getTimezoneOffset(), sign = offset >= 0 ? '+' : '-';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    + `${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
}
function service(options = {}) {
  return new TrackerService({ github: options.github ?? new FakeGitHub(), store: options.store ?? new MemoryStore(), user: 'alice',
    clock: options.clock ?? (() => new Date('2026-08-18T09:00:00Z')), idFactory: options.idFactory ?? (() => fixedId),
    recentDays: options.recentDays ?? 7, allowedIssueOwners: ['acme'] });
}

test('start writes one readable active text file with its durable issue title', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), tracker = service({ github, store });
  const result = await tracker.start(issue, 'Ranking regression', 'Investigating');
  assert.equal(result._path, 'active/alice.txt');
  const file = github.files.get('active/alice.txt');
  assert.match(file.text, /^URL: https:\/\/github\.com\/acme\/frontend\/issues\/123\nTitle: Ranking regression\nStart: .*?(?:Z|[+-]\d{2}:\d{2})\nDescription: Investigating\n$/);
  assert.equal(new Date(parseActiveText(file.text, { user: 'alice' }).startedAt).getTime(), new Date('2026-08-18T09:00:00Z').getTime());
  assert.doesNotMatch(file.text, /user|schema/i);
  assert.equal(parseActiveText(file.text, { user: 'alice' }).issueTitle, 'Ranking regression');
  assert.equal(parseActiveText(file.text, { user: 'alice' }).issue.number, 123);
});

test('switching tasks stops the active timer before starting the selected task', async () => {
  const github = new FakeGitHub(), store = new MemoryStore();
  seedText(github, 'active/alice.txt', serializeActiveText(active('2026-08-18T08:00:00+00:00')), 'active-sha');
  store.value.activeCache = parseActiveText(github.files.get('active/alice.txt').text, { user: 'alice', path: 'active/alice.txt', sha: 'active-sha' });
  const tracker = service({ github, store });
  const result = await tracker.switchTask('https://example.com/next', 'Next task');
  assert.equal(result.stopped.entry.taskUrl, issue.url);
  assert.equal(result.active.taskUrl, 'https://example.com/next');
  assert.equal(parseActiveText(github.files.get('active/alice.txt').text, { user: 'alice' }).taskUrl, 'https://example.com/next');
  assert.equal(parseMonthlyText(github.files.get('times/2026-08/alice.txt').text, { user: 'alice', month: '2026-08' })[0].taskUrl, issue.url);
});

test('start persists an arbitrary task URL with an optional empty title', async () => {
  const github = new FakeGitHub(), tracker = service({ github });
  const result = await tracker.start('https://example.com/work/42?view=full', '');
  assert.equal(result.taskUrl, 'https://example.com/work/42?view=full');
  assert.equal(result.taskTitle, '');
  assert.equal(result.issue, undefined);
  const file = github.files.get('active/alice.txt');
  assert.equal(file.text.startsWith('URL: https://example.com/work/42?view=full\nStart: '), true);
  assert.doesNotMatch(file.text, /^Title:/m);
  assert.equal(parseActiveText(file.text, { user: 'alice' }).taskUrl, result.taskUrl);
});

test('recent load backfills missing issue titles once with the current SHA', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-08/alice.txt';
  const untitled = entry(localTimestamp(2026, 7, 18, 8), localTimestamp(2026, 7, 18, 9));
  seedText(github, path, serializeMonthlyText([untitled]), 'daily');
  github.metadata.set(issue.url, { title: 'Ranking regression' });
  const tracker = service({ github, store, recentDays: 1, clock: () => new Date(localTimestamp(2026, 7, 18, 12)) });

  const first = await tracker.loadMenuData(50);
  assert.equal(first.recent[0].issueTitle, 'Ranking regression');
  assert.equal(github.metadataReads.length, 1);
  assert.equal(github.writes.length, 1);
  assert.equal(github.writes[0].sha, 'daily');
  assert.match(github.files.get(path).text, /Title: Ranking regression/);

  const second = await tracker.loadMenuData(50);
  assert.equal(second.recent[0].issueTitle, 'Ranking regression');
  assert.equal(github.metadataReads.length, 1, 'persisted titles are not resolved again');
  assert.equal(github.writes.length, 1, 'persisted titles are not rewritten again');
});

test('recent load persists a current-page title into a legacy active timer with its current SHA', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), legacy = active('2026-08-18T08:00:00+00:00');
  seedText(github, 'active/alice.txt', serializeActiveText(legacy), 'active-sha');
  store.value.activeCache = { ...legacy, issueTitle: '', _path: 'active/alice.txt', _sha: 'active-sha' };
  const data = await service({ github, store, recentDays: 1, clock: () => new Date('2026-08-18T12:00:00Z') })
    .loadMenuData(50, { knownTitles: new Map([[issue.url, 'Ranking regression']]) });
  assert.equal(data.active.issueTitle, 'Ranking regression');
  assert.equal(github.writes.at(-1).path, 'active/alice.txt');
  assert.equal(github.writes.at(-1).sha, 'active-sha');
  assert.match(github.files.get('active/alice.txt').text, /Title: Ranking regression/);
});

test('an unsupported queued stage is preserved instead of clearing active or losing the completion', async () => {
  const github = new FakeGitHub(), store = new MemoryStore();
  const queuedEntry = entry('2026-08-18T08:00:00+00:00', '2026-08-18T09:00:00+00:00');
  store.value.pendingWrites = [{
    operation: 'completeTimer', id: 'legacy', status: 'pending', retryCount: 0,
    stage: 'unknownLegacyStage', monthlyPath: 'times/2026-08/alice.txt', entry: queuedEntry,
    activeSnapshot: active(), activeSha: 'active-sha', queuedAt: queuedEntry.endedAt, lastError: '',
  }];
  seedText(github, 'active/alice.txt', serializeActiveText(active()), 'active-sha');
  const queue = await service({ github, store }).syncPending();
  assert.equal(queue.length, 1);
  assert.equal(queue[0].status, 'conflict');
  assert.match(queue[0].lastError, /unsupported storage stage/i);
  assert.equal(github.writes.length, 0);
  assert.equal(github.deletes.length, 0);
  assert.equal(github.files.has('active/alice.txt'), true);
});

test('stop appends to one monthly text file and clears active', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(); let now = new Date('2026-08-18T08:00:00Z');
  const tracker = service({ github, store, clock: () => new Date(now) });
  await tracker.start(issue); const activeReadsBeforeStop = github.reads.filter(path => path === 'active/alice.txt').length; now = new Date('2026-08-18T09:15:00Z');
  const stopped = await tracker.stop('Done');
  assert.equal(stopped.pending, false);
  assert.equal(github.files.has('active/alice.txt'), false);
  const file = github.files.get('times/2026-08/alice.txt');
  assert.ok(file);
  assert.equal((file.text.match(/^URL:/gm) || []).length, 1);
  assert.equal(new Date(parseMonthlyText(file.text, { user: 'alice', month: '2026-08' })[0].endedAt).getTime(), new Date('2026-08-18T09:15:00Z').getTime());
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
  assert.equal(github.files.has('times/2026-08/alice.txt'), false);
  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(store.value.activeCache.issue.url, pull.url);
  assert.equal(store.value.activeCache._sha, 'current-sha');
});

test('a confirmed missing active file cannot create a completion from stale cache', async () => {
  const github = new FakeGitHub(), store = new MemoryStore();
  store.value.activeCache = { ...active('2026-08-18T08:00:00+00:00'), _path: 'active/alice.txt', _sha: 'stale-sha' };
  await assert.rejects(() => service({ github, store }).stop('must not be saved'), /No timer is running/);
  assert.equal(github.files.has('times/2026-08/alice.txt'), false);
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
  assert.equal(github.files.has('times/2026-08/alice.txt'), false);
  assert.equal(store.value.pendingWrites[0].stage, 'verifyActive');
  assert.equal(store.value.pendingWrites[0].status, 'conflict');
  assert.equal(store.value.pendingWrites[0].conflictReason, 'active_missing_no_completion');
  await assert.rejects(() => service({ github, store }).resolvePendingConflict(fixedId), /explicit discard/i);
  assert.equal(store.value.pendingWrites.length, 1, 'generic acknowledgement preserves the unsaved completion');
  assert.deepEqual(await service({ github, store }).resolvePendingConflict(fixedId, 'discard_unsaved_completion'), { resolved: true });
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
  seedText(github, 'times/2026-08/alice.txt', serializeMonthlyText([completed]), 'daily-sha');
  const result = await service({ github, store }).stop('second device');
  assert.equal(result.pending, false);
  assert.equal(result.entry.description, 'first device');
  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(parseMonthlyText(github.files.get('times/2026-08/alice.txt').text, { user: 'alice', month: '2026-08', path: 'times/2026-08/alice.txt' }).length, 1);
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
  assert.equal(github.files.has('times/2026-08/alice.txt'), false);
  assert.equal(store.value.pendingWrites[0].status, 'conflict');
  assert.equal(store.value.activeCache.issue.url, pull.url);
  assert.equal(store.value.pendingWrites[0].conflictReason, 'active_changed_no_completion');
  await assert.rejects(() => service({ github, store }).resolvePendingConflict(fixedId), /explicit discard/i);
  assert.deepEqual(await service({ github, store }).resolvePendingConflict(fixedId, 'discard_unsaved_completion'), { resolved: true });
  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(store.value.recentCache.some(item => item._pending), false);
  assert.equal(github.files.has('active/alice.txt'), true);
});

test('transient active read does not overwrite a newer durable active title from stale cache', async () => {
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
  const startedAt = '2026-08-18T08:00:00+00:00';
  const stale = { ...active(startedAt, { issueTitle: 'Stale cached title' }), _path: 'active/alice.txt', _sha: 'stale-sha' };
  const remote = active(startedAt, { issueTitle: 'Newer durable title' });
  store.value.activeCache = stale;
  seedText(github, 'active/alice.txt', serializeActiveText(remote), 'current-sha');

  const result = await service({ github, store }).stop('must not overwrite title');
  assert.equal(result.pending, true);
  assert.equal(github.files.has('times/2026-08/alice.txt'), false);
  assert.equal(parseActiveText(github.files.get('active/alice.txt').text, { user: 'alice' }).issueTitle, 'Newer durable title');
  assert.equal(store.value.pendingWrites[0].status, 'conflict');
  assert.equal(store.value.pendingWrites[0].conflictReason, 'active_changed_no_completion');
});

test('changed-active verification adopts an existing completion before preserving the newer timer', async () => {
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
  const stale = { ...active('2026-08-18T08:00:00+00:00', { issueTitle: 'Durable title' }), _path: 'active/alice.txt', _sha: 'stale-sha' };
  const completed = entry(stale.startedAt, '2026-08-18T09:00:00+00:00', { issueTitle: 'Durable title', description: 'other device' });
  store.value.activeCache = stale;
  seedText(github, 'active/alice.txt', serializeActiveText(active('2026-08-18T10:00:00+00:00', { issue: pull })), 'current-sha');
  seedText(github, 'times/2026-08/alice.txt', serializeMonthlyText([completed]), 'monthly-sha');

  const result = await service({ github, store }).stop('this device');
  assert.equal(result.pending, true);
  assert.equal(store.value.pendingWrites[0].stage, 'clearActive');
  assert.equal(store.value.pendingWrites[0].conflictReason, 'completion_saved_newer_timer');
  assert.equal(store.value.pendingWrites[0].entry.description, 'other device');
  assert.deepEqual(await service({ github, store }).resolvePendingConflict(fixedId), { resolved: true });
  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(parseActiveText(github.files.get('active/alice.txt').text, { user: 'alice' }).issue.url, pull.url);
});

test('acknowledging a clear-active conflict keeps the newer timer and completes the saved operation', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), tracker = service({ github, store });
  const old = active('2026-08-18T08:00:00+00:00');
  const completed = entry(old.startedAt, '2026-08-18T09:00:00+00:00');
  const operation = { operation: 'completeTimer', id: fixedId, status: 'conflict', retryCount: 1, stage: 'clearActive',
    monthlyPath: 'times/2026-08/alice.txt', entry: completed, activeSnapshot: old, activeSha: 'old-sha', queuedAt: completed.endedAt, lastError: 'new timer' };
  store.value.pendingWrites = [operation];
  seedText(github, operation.monthlyPath, serializeMonthlyText([completed]), 'daily-sha');
  seedText(github, 'active/alice.txt', serializeActiveText(active('2026-08-18T10:00:00+00:00', { issue: pull })), 'new-sha');
  const result = await tracker.resolvePendingConflict(fixedId);
  assert.deepEqual(result, { resolved: true });
  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(store.value.activeCache.issue.url, pull.url);
  assert.equal(github.files.has('active/alice.txt'), true);
});

test('queued Stop never adopts a same-timer completion with a different durable title', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), tracker = service({ github, store });
  const timer = active('2026-08-18T08:00:00+00:00', { issueTitle: 'Intended durable title' });
  const intended = entry(timer.startedAt, '2026-08-18T09:00:00+00:00', { issueTitle: timer.issueTitle });
  const remote = { ...intended, issueTitle: 'Different remote title' };
  const operation = { operation: 'completeTimer', id: fixedId, status: 'pending', retryCount: 0, stage: 'appendMonthly',
    monthlyPath: 'times/2026-08/alice.txt', entry: intended, activeSnapshot: timer, activeSha: null, queuedAt: intended.endedAt, lastError: '' };
  store.value.pendingWrites = [operation];
  store.value.recentCache = [{ ...intended, _path: operation.monthlyPath, _sha: null, _index: -1, _pending: true }];
  seedText(github, operation.monthlyPath, serializeMonthlyText([remote]), 'daily-sha');

  await tracker.syncPending();

  const saved = parseMonthlyText(github.files.get(operation.monthlyPath).text, { user: 'alice', month: '2026-08' });
  assert.deepEqual(saved.map(item => item.issueTitle), ['Different remote title', 'Intended durable title']);
  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(store.value.recentCache[0].issueTitle, 'Intended durable title');
});

test('multiple completions on one day append to the same file', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(); let now = new Date('2026-08-18T08:00:00Z'), serial = 0;
  const tracker = service({ github, store, clock: () => new Date(now), idFactory: () => `01K2ABCDEF0123456789ABCDE${serial++ ? 'A' : 'F'}` });
  await tracker.start(issue); now = new Date('2026-08-18T09:00:00Z'); await tracker.stop();
  now = new Date('2026-08-18T10:00:00Z'); await tracker.start(pull); now = new Date('2026-08-18T11:00:00Z'); await tracker.stop('review');
  const file = github.files.get('times/2026-08/alice.txt');
  assert.equal((file.text.match(/^URL:/gm) || []).length, 2);
  assert.equal([...github.files.keys()].filter(path => path.startsWith('times/')).length, 1);
});

test('recent loading performs one direct read per month and no directory or per-record requests', async () => {
  const github = new FakeGitHub(), store = new MemoryStore();
  const records = [entry('2026-08-18T08:00:00+00:00', '2026-08-18T09:00:00+00:00'), entry('2026-08-18T10:00:00+00:00', '2026-08-18T11:00:00+00:00', { issue: pull })];
  seedText(github, 'times/2026-08/alice.txt', serializeMonthlyText(records));
  const recent = await service({ github, store, recentDays: 7, clock: () => new Date('2026-08-18T12:00:00Z') }).loadRecent();
  assert.equal(recent.length, 2);
  assert.equal(github.reads.length, 1);
  assert.equal(new Set(github.reads).size, 1);
  assert.equal(recent[0].issue.type, 'pull_request');
});

test('recent monthly files are fetched concurrently', async () => {
  const github = new FakeGitHub(); let inFlight = 0, peak = 0;
  github.getText = async path => { github.reads.push(path); inFlight += 1; peak = Math.max(peak, inFlight); await new Promise(resolve => setTimeout(resolve, 5)); inFlight -= 1; throw github.notFound(); };
  await service({ github, recentDays: 31, clock: () => new Date('2026-08-02T12:00:00Z') }).loadRecent();
  assert.equal(github.reads.length, 2); assert.equal(peak, 2);
});

test('editing one entry rewrites its monthly file once and preserves the other records', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-08/alice.txt';
  seedText(github, path, serializeMonthlyText([entry('2026-08-18T08:00:00+00:00', '2026-08-18T09:00:00+00:00'), entry('2026-08-18T10:00:00+00:00', '2026-08-18T11:00:00+00:00', { issue: pull })]), 'daily');
  const tracker = service({ github, store });
  const saved = await tracker.editEntry({ path, originalSha: 'daily', index: 1, edits: { description: 'manual note', endedAt: '2026-08-18T11:30:00+00:00' } });
  assert.equal(github.writes.length, 1);
  const parsed = parseMonthlyText(github.files.get(path).text, { user: 'alice', month: '2026-08' });
  assert.equal(parsed[0].description, ''); assert.equal(parsed[1].description, 'manual note');
  assert.equal(saved._index, 1); assert.equal(saved.durationSeconds, 5400);
});

test('edit locates the intended record after its array position changed', async () => {
  const github = new FakeGitHub(), path = 'times/2026-08/alice.txt';
  const intended = entry('2026-08-18T15:13:17+00:00', '2026-08-18T16:13:17+00:00', { description: 'target' });
  seedText(github, path, serializeMonthlyText([entry('2026-08-18T08:00:00+00:00', '2026-08-18T09:00:00+00:00'), intended]), 'daily');
  const saved = await service({ github }).editEntry({ path, originalSha: 'daily', index: 99,
    original: { issueUrl: intended.issue.url, startedAt: intended.startedAt, endedAt: intended.endedAt, description: intended.description },
    edits: { startedAt: '2026-08-18T01:13:17+00:00' } });
  assert.equal(saved.startedAt, '2026-08-18T01:13:17+00:00'); assert.equal(saved.description, 'target');
});

test('successful edit returns the edited position when visible records become identical', async () => {
  const github = new FakeGitHub(), path = 'times/2026-08/alice.txt';
  const first = entry('2026-08-18T08:00:00+00:00', '2026-08-18T09:00:00+00:00', 'same');
  const second = entry('2026-08-18T10:00:00+00:00', '2026-08-18T11:00:00+00:00', 'same');
  seedText(github, path, serializeMonthlyText([first, second]), 'daily');
  const saved = await service({ github }).editEntry({ path, originalSha: 'daily', index: 1,
    original: { issueUrl: second.issue.url, startedAt: second.startedAt, endedAt: second.endedAt, description: second.description },
    edits: { startedAt: first.startedAt, endedAt: first.endedAt } });
  assert.equal(saved._index, 1);
});

test('editing Start into another day in the same month performs one SHA-guarded rewrite', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-08/alice.txt';
  const intended = entry('2026-08-18T00:13:17+00:00', '2026-08-18T02:13:17+00:00');
  seedText(github, path, serializeMonthlyText([intended]), 'source');
  store.value.recentCache = parseMonthlyText(serializeMonthlyText([intended]), { user: 'alice', month: '2026-08', path, sha: 'source' });
  const saved = await service({ github, store }).editEntry({ path, originalSha: 'source', index: 0,
    original: { issueUrl: intended.issue.url, startedAt: intended.startedAt, endedAt: intended.endedAt, description: '' },
    edits: { startedAt: '2026-08-17T23:13:17+00:00' } });
  assert.equal(github.atomicWrites.length, 0); assert.equal(github.writes.length, 1); assert.equal(saved._path, path);
  assert.equal(parseMonthlyText(github.files.get(path).text, { user: 'alice', month: '2026-08' })[0].startedAt, '2026-08-17T23:13:17+00:00');
  assert.deepEqual(store.value.recentCache.map(record => record._path), [path]);
});

test('editing Start into another month atomically moves the record between monthly files', async () => {
  const github = new FakeGitHub(), source = 'times/2026-08/alice.txt', destination = 'times/2026-09/alice.txt';
  const intended = entry('2026-08-31T23:13:17+00:00', '2026-09-01T00:13:17+00:00');
  seedText(github, source, serializeMonthlyText([intended]), 'source');
  const saved = await service({ github }).editEntry({ path: source, originalSha: 'source', index: 0,
    original: { issueUrl: intended.issue.url, startedAt: intended.startedAt, endedAt: intended.endedAt, description: '' },
    edits: { startedAt: '2026-09-01T00:13:17+00:00', endedAt: '2026-09-01T01:13:17+00:00' } });
  assert.equal(github.atomicWrites.length, 1); assert.equal(github.files.has(source), false); assert.equal(saved._path, destination);
  assert.equal(parseMonthlyText(github.files.get(destination).text, { user: 'alice', month: '2026-09' })[0].entryDate, '2026-09-01');
});

test('edit rejects a stale monthly-file SHA before writing', async () => {
  const github = new FakeGitHub(), path = 'times/2026-08/alice.txt'; seedText(github, path, serializeMonthlyText([entry('2026-08-18T08:00:00+00:00', '2026-08-18T09:00:00+00:00')]), 'new');
  await assert.rejects(() => service({ github }).editEntry({ path, originalSha: 'old', index: 0, edits: { description: 'x' } }), TrackerConflictError);
  assert.equal(github.writes.length, 0);
});

test('deleting one record keeps the monthly file; deleting the last removes it', async () => {
  const github = new FakeGitHub(), path = 'times/2026-08/alice.txt'; seedText(github, path, serializeMonthlyText([entry('2026-08-18T08:00:00+00:00', '2026-08-18T09:00:00+00:00'), entry('2026-08-18T10:00:00+00:00', '2026-08-18T11:00:00+00:00')]), 'one');
  const tracker = service({ github }); const first = await tracker.deleteEntry({ path, originalSha: 'one', index: 0 });
  assert.equal(first.deleted, true); assert.equal(first.entries.length, 1);
  assert.equal(first.entries[0]._sha, github.files.get(path).sha); assert.equal(first.entries[0]._index, 0);
  assert.equal(parseMonthlyText(github.files.get(path).text, { user: 'alice', month: '2026-08' }).length, 1);
  const second = await tracker.deleteEntry({ path, originalSha: first.entries[0]._sha, index: first.entries[0]._index });
  assert.deepEqual(second, { deleted: true, entries: [] });
  assert.equal(github.files.has(path), false); assert.equal(github.deletes.length, 1);
});

test('same-day boundary movement updates two entries with one GitHub write', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-08/alice.txt';
  seedText(github, path, serializeMonthlyText([entry('2026-08-18T08:00:00+00:00', '2026-08-18T09:00:00+00:00'), entry('2026-08-18T09:30:00+00:00', '2026-08-18T11:00:00+00:00')]), 'daily');
  const saved = await service({ github, store }).moveBoundary({
    upper: { path, originalSha: 'daily', index: 0, endedAt: '2026-08-18T10:00:00+00:00' },
    lower: { path, originalSha: 'daily', index: 1, startedAt: '2026-08-18T10:30:00+00:00' },
  });
  assert.equal(github.writes.length, 1); assert.equal(saved.length, 2);
  const parsed = parseMonthlyText(github.files.get(path).text, { user: 'alice', month: '2026-08' });
  assert.equal(parsed[0].endedAt, '2026-08-18T10:00:00+00:00'); assert.equal(parsed[1].startedAt, '2026-08-18T10:30:00+00:00');
});

test('boundary movement has no arbitrary twelve-hour cap', async () => {
  const github = new FakeGitHub(), path = 'times/2026-08/alice.txt';
  seedText(github, path, serializeMonthlyText([
    entry('2026-08-17T00:00:00+00:00', '2026-08-18T01:00:00+00:00'),
    entry('2026-08-18T01:00:00+00:00', '2026-08-20T01:00:00+00:00'),
  ]), 'monthly');
  await service({ github }).moveBoundary({
    upper: { path, originalSha: 'monthly', index: 0, endedAt: '2026-08-19T01:00:00+00:00' },
    lower: { path, originalSha: 'monthly', index: 1, startedAt: '2026-08-19T01:00:00+00:00' },
  });
  const records = parseMonthlyText(github.files.get(path).text, { user: 'alice', month: '2026-08' });
  assert.equal(records[0].durationSeconds, 49 * 3600); assert.equal(records[1].durationSeconds, 24 * 3600);
  assert.equal(github.writes.length, 1); assert.equal(github.atomicWrites.length, 0);
});

test('boundary movement rejects unequal deltas and invalid durations', async () => {
  const github = new FakeGitHub(), path = 'times/2026-08/alice.txt'; seedText(github, path, serializeMonthlyText([entry('2026-08-18T08:00:00+00:00', '2026-08-18T09:00:00+00:00'), entry('2026-08-18T09:00:00+00:00', '2026-08-18T10:00:00+00:00')]), 'daily');
  const tracker = service({ github });
  await assert.rejects(() => tracker.moveBoundary({ upper: { path, originalSha: 'daily', index: 0, endedAt: '2026-08-18T09:15:00+00:00' }, lower: { path, originalSha: 'daily', index: 1, startedAt: '2026-08-18T09:20:00+00:00' } }), /same amount/i);
  await assert.rejects(() => tracker.moveBoundary({ upper: { path, originalSha: 'daily', index: 0, endedAt: '2026-08-18T07:00:00+00:00' }, lower: { path, originalSha: 'daily', index: 1, startedAt: '2026-08-18T07:00:00+00:00' } }), /end/i);
  assert.equal(github.writes.length, 0);
});

test('cross-month boundary changes are one atomic repository update', async () => {
  const github = new FakeGitHub(), first = 'times/2026-08/alice.txt', second = 'times/2026-09/alice.txt';
  seedText(github, first, serializeMonthlyText([entry('2026-08-31T22:00:00+00:00', '2026-08-31T23:00:00+00:00')]), 'first');
  seedText(github, second, serializeMonthlyText([entry('2026-09-01T00:00:00+00:00', '2026-09-01T01:00:00+00:00')]), 'second');
  await service({ github }).moveBoundary({ upper: { path: first, originalSha: 'first', index: 0, endedAt: '2026-08-31T23:15:00+00:00' }, lower: { path: second, originalSha: 'second', index: 0, startedAt: '2026-09-01T00:15:00+00:00' } });
  assert.equal(github.atomicWrites.length, 1); assert.equal(github.writes.length, 0);
  assert.equal(parseMonthlyText(github.files.get(first).text, { user: 'alice', month: '2026-08' })[0].endedAt, '2026-08-31T23:15:00+00:00');
  assert.equal(parseMonthlyText(github.files.get(second).text, { user: 'alice', month: '2026-09' })[0].startedAt, '2026-09-01T00:15:00+00:00');
});

test('pending completion does not adopt an unrelated record with only the same URL and Start', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-08/alice.txt';
  seedText(github, path, serializeMonthlyText([entry('2026-08-18T08:00:00+00:00', '2026-08-18T08:30:00+00:00', { description: 'old unrelated completion' })]), 'daily');
  seedText(github, 'active/alice.txt', serializeActiveText(active()), 'active');
  const tracker = service({ github, store, clock: () => new Date('2026-08-18T09:00:00Z') }); await tracker.refreshActive();
  const stopped = await tracker.stop('new completion');
  const records = parseMonthlyText(github.files.get(path).text, { user: 'alice', month: '2026-08' });
  assert.equal(stopped.pending, false); assert.equal(records.length, 2);
  assert.deepEqual(records.map(record => record.description), ['old unrelated completion', 'new completion']);
});

test('concurrent Stops adopt the first completion instead of duplicating it', async () => {
  const github = new FakeGitHub(), aStore = new MemoryStore(), bStore = new MemoryStore();
  seedText(github, 'active/alice.txt', serializeActiveText(active()), 'active');
  const a = service({ github, store: aStore, clock: () => new Date('2026-08-18T09:00:00Z') });
  const b = service({ github, store: bStore, clock: () => new Date('2026-08-18T09:05:00Z') });
  await a.refreshActive(); await b.refreshActive(); await a.stop('first'); const second = await b.stop('second');
  const parsed = parseMonthlyText(github.files.get('times/2026-08/alice.txt').text, { user: 'alice', month: '2026-08' });
  assert.equal(parsed.length, 1); assert.equal(parsed[0].description, 'first'); assert.equal(second.entry.description, 'first');
});

test('simultaneous Stops converge automatically after a monthly-file create race', async () => {
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
  const parsed = parseMonthlyText(github.files.get('times/2026-08/alice.txt').text, { user: 'alice', month: '2026-08' });
  assert.equal(parsed.length, 1);
  assert.equal(pendingStore.value.pendingWrites.length, 0);
});

test('malformed monthly text fails visibly instead of silently hiding the whole month', async () => {
  const github = new FakeGitHub(); seedText(github, 'times/2026-08/alice.txt', 'URL: javascript:alert(1)\nStart: nope\nEnd: nope\n');
  await assert.rejects(() => service({ github, recentDays: 1 }).loadRecent(), /task URL|timestamp/i);
});

test('tracking accepts a valid GitHub issue from any owner', async () => {
  const github = new FakeGitHub(), tracker = service({ github });
  const other = { type: 'issue', owner: 'other-org', repo: 'x', number: 1, url: 'https://github.com/other-org/x/issues/1' };
  const started = await tracker.start(other, 'Cross-organization task');
  assert.equal(started.issue.url, other.url);
});


test('menu data reports the complete current-day total even when recent rows are capped', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-08/alice.txt';
  const entries = Array.from({ length: 55 }, (_, index) => {
    const startedAt = localTimestamp(2026, 7, 18, 0, index), start = new Date(startedAt);
    const end = new Date(start.getTime() + 60_000);
    return entry(startedAt, localTimestamp(end.getFullYear(), end.getMonth(), end.getDate(), end.getHours(), end.getMinutes(), end.getSeconds()));
  });
  seedText(github, path, serializeMonthlyText(entries), 'daily');
  const pendingEntry = entry(localTimestamp(2026, 7, 18, 2), localTimestamp(2026, 7, 18, 2, 1));
  store.value.pendingWrites = [{ operation: 'completeTimer', id: 'pending-total', status: 'pending', retryCount: 0, stage: 'appendMonthly', monthlyPath: path, entry: pendingEntry, activeSnapshot: active(pendingEntry.startedAt), activeSha: 'active', queuedAt: pendingEntry.endedAt, lastError: '' }];
  const running = active(localTimestamp(2026, 7, 18, 11));
  store.value.activeCache = running;
  const data = await service({ github, store, recentDays: 1, clock: () => new Date(localTimestamp(2026, 7, 18, 12)) }).loadMenuData(50);
  assert.equal(data.recent.length, 50);
  assert.equal(data.todaySeconds, 56 * 60);
  assert.equal(data.reportDate, '2026-08-18');
  assert.deepEqual(data.summaries.map(({ key, seconds }) => [key, seconds]), [
    ['today', 56 * 60], ['this-week', 56 * 60], ['last-week', 0], ['this-month', 56 * 60],
  ]);
  assert.deepEqual(data.summaries.map(({ displayMs }) => displayMs), [2000, 1000, 1000, 1000]);
  assert.equal(data.active.startedAt, running.startedAt);
  assert.equal(data.pendingCount, 1);
  assert.deepEqual(data.pendingWrites, [{ id: 'pending-total', status: 'pending', stage: 'appendMonthly' }]);
  assert.equal(Object.keys(data.active).some(key => key.startsWith('_')), false);
});

test('active refresh forwards cancellation and cannot patch cache after abort', async () => {
  const store = new MemoryStore(), controller = new AbortController();
  const github = new FakeGitHub();
  github.getText = async (_path, { signal } = {}) => {
    assert.equal(signal, controller.signal);
    controller.abort();
    signal.throwIfAborted();
  };
  await assert.rejects(
    () => service({ github, store }).getState({ refresh: true, signal: controller.signal }),
    error => error?.name === 'AbortError',
  );
  assert.equal(store.value.activeCache, null);
});


test('repository-level 404 during clearActive preserves the queue and escapes for stable-ID recovery', async () => {
  class RenamedRepositoryGitHub extends FakeGitHub {
    async deleteFile() { throw this.notFound(); }
    async getText() { throw this.notFound(); }
    async assertDestinationReachable() { throw this.notFound(); }
  }
  const github = new RenamedRepositoryGitHub(), store = new MemoryStore(), tracker = service({ github, store });
  const old = active('2026-08-18T08:00:00+00:00');
  const completed = entry(old.startedAt, '2026-08-18T09:00:00+00:00');
  const operation = { operation: 'completeTimer', id: fixedId, status: 'pending', retryCount: 0, stage: 'clearActive',
    monthlyPath: 'times/2026-08/alice.txt', entry: completed, activeSnapshot: old, activeSha: 'old-sha', queuedAt: completed.endedAt, lastError: '' };
  store.value.pendingWrites = [operation];
  store.value.activeCache = { ...old, _path: 'active/alice.txt', _sha: 'old-sha' };
  await assert.rejects(() => tracker.syncPending(), error => error.code === 'not_found');
  assert.equal(store.value.pendingWrites.length, 1);
  assert.equal(store.value.pendingWrites[0].stage, 'clearActive');
  assert.equal(store.value.activeCache.startedAt, old.startedAt);
  assert.equal(store.value.recentCache.length, 0);
});


test('linked time edits save a crossed adjacent boundary in one monthly-file write', async () => {
  const github = new FakeGitHub(), path = 'times/2026-08/alice.txt';
  const previous = entry('2026-08-18T08:00:00+00:00', '2026-08-18T09:00:00+00:00');
  const current = entry('2026-08-18T10:00:00+00:00', '2026-08-18T11:00:00+00:00', { issue: pull });
  seedText(github, path, serializeMonthlyText([previous, current]), 'linked');
  const saved = await service({ github }).editEntries({ entries: [
    { path, originalSha: 'linked', index: 0, original: { issueUrl: previous.issue.url, issueTitle: '', startedAt: previous.startedAt, endedAt: previous.endedAt, description: '' }, edits: { endedAt: '2026-08-18T08:30:00+00:00' } },
    { path, originalSha: 'linked', index: 1, original: { issueUrl: current.issue.url, issueTitle: '', startedAt: current.startedAt, endedAt: current.endedAt, description: '' }, edits: { startedAt: '2026-08-18T08:30:00+00:00' } },
  ] });
  assert.equal(github.writes.length, 1);
  assert.equal(github.atomicWrites.length, 0);
  assert.equal(saved.length, 2);
  const parsed = parseMonthlyText(github.files.get(path).text, { user: 'alice', month: '2026-08' });
  assert.deepEqual(parsed.map(record => [record.startedAt, record.endedAt]), [
    ['2026-08-18T08:00:00+00:00', '2026-08-18T08:30:00+00:00'],
    ['2026-08-18T08:30:00+00:00', '2026-08-18T11:00:00+00:00'],
  ]);
});

test('linked time edits remain atomic when an adjusted Start moves across monthly files', async () => {
  const github = new FakeGitHub(), august = 'times/2026-08/alice.txt', september = 'times/2026-09/alice.txt';
  const previous = entry('2026-08-31T22:00:00+00:00', '2026-08-31T23:30:00+00:00');
  const current = entry('2026-09-01T00:00:00+00:00', '2026-09-01T01:00:00+00:00', { issue: pull });
  seedText(github, august, serializeMonthlyText([previous]), 'august');
  seedText(github, september, serializeMonthlyText([current]), 'september');
  await service({ github }).editEntries({ entries: [
    { path: august, originalSha: 'august', index: 0, original: { issueUrl: previous.issue.url, issueTitle: '', startedAt: previous.startedAt, endedAt: previous.endedAt, description: '' }, edits: { endedAt: '2026-08-31T23:00:00+00:00' } },
    { path: september, originalSha: 'september', index: 0, original: { issueUrl: current.issue.url, issueTitle: '', startedAt: current.startedAt, endedAt: current.endedAt, description: '' }, edits: { startedAt: '2026-08-31T23:00:00+00:00' } },
  ] });
  assert.equal(github.atomicWrites.length, 1);
  assert.equal(parseMonthlyText(github.files.get(august).text, { user: 'alice', month: '2026-08' }).length, 2);
  assert.equal(github.files.has(september), false);
});


test('bulk import appends entries after existing same-day time and stages same-day lines sequentially', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-08/alice.txt';
  seedText(github, path, serializeMonthlyText([entry(localTimestamp(2026, 7, 21, 9), localTimestamp(2026, 7, 21, 10))]), 'before');
  const tracker = service({ github, store, idFactory: value => `${fixedId.slice(0, -2)}${String(value).slice(-2)}` });
  const result = await tracker.bulkAddTimes(`2026/08/21 https://example.com/a First task 2:00\n2026-08-21 https://example.com/b Second task 1.5`);
  assert.deepEqual(result, { added: 2 });
  const saved = parseMonthlyText(github.files.get(path).text, { user: 'alice', month: '2026-08' });
  assert.equal(saved.length, 3);
  assert.equal(saved[1].startedAt.slice(11, 19), '10:00:00');
  assert.equal(saved[1].endedAt.slice(11, 19), '12:00:00');
  assert.equal(saved[2].startedAt.slice(11, 19), '12:00:00');
  assert.equal(saved[2].endedAt.slice(11, 19), '13:30:00');
  assert.equal(saved[2].description, 'Second task');
});

test('bulk import is all-or-nothing when requested hours do not fit without crossing the day', async () => {
  const github = new FakeGitHub(), path = 'times/2026-08/alice.txt';
  seedText(github, path, serializeMonthlyText([entry(localTimestamp(2026, 7, 21, 23), localTimestamp(2026, 7, 22, 0))]), 'before');
  const tracker = service({ github });
  await assert.rejects(() => tracker.bulkAddTimes('2026-08-21 https://example.com/a No room 1:00'), /Line 1.*do not fit.*No entries were added/i);
  assert.equal(github.writes.length, 0);
  assert.equal(github.atomicWrites.length, 0);
  assert.equal(github.files.get(path).sha, 'before');
});

test('bulk import commits multiple monthly files atomically', async () => {
  const github = new FakeGitHub(), tracker = service({ github });
  const result = await tracker.bulkAddTimes('2026-08-31 https://example.com/a August 1\n2026-09-01 https://example.com/b September 2');
  assert.deepEqual(result, { added: 2 });
  assert.equal(github.atomicWrites.length, 1);
  assert.deepEqual(github.atomicWrites[0].changes.map(change => change.path), ['times/2026-08/alice.txt', 'times/2026-09/alice.txt']);
});


test('bulk import rejects intervals that would overlap the running timer', async () => {
  const github = new FakeGitHub(), store = new MemoryStore();
  const startedAt = localTimestamp(2026, 9, 2, 9);
  seedText(github, 'active/alice.txt', serializeActiveText(active(startedAt)), 'active-sha');
  const tracker = service({ github, store });
  await assert.rejects(() => tracker.bulkAddTimes('2026-10-02 https://example.com/import Import 10'), /overlap the running timer/i);
  assert.equal(github.files.has('times/2026-10/alice.txt'), false);
  assert.equal(github.atomicWrites.length, 0);
});

test('bulk import starts after a completed entry that crosses in from the previous month', async () => {
  const github = new FakeGitHub(), store = new MemoryStore();
  const previousStart = localTimestamp(2026, 7, 31, 23, 30), previousEnd = localTimestamp(2026, 8, 1, 0, 30);
  seedText(github, 'times/2026-08/alice.txt', serializeMonthlyText([entry(previousStart, previousEnd)]), 'aug-sha');
  const tracker = service({ github, store, idFactory: () => '01K2ABCDEF0123456789ABCDE0' });
  await tracker.bulkAddTimes('2026-09-01 https://example.com/import Import 1');
  const imported = parseMonthlyText(github.files.get('times/2026-09/alice.txt').text, { user: 'alice', month: '2026-09', path: 'times/2026-09/alice.txt' });
  assert.equal(imported[0].startedAt, previousEnd);
  assert.equal(imported[0].endedAt, localTimestamp(2026, 8, 1, 1, 30));
});


test('bulk import formats generated timestamps in the importing timezone across mixed-offset month boundaries', async () => {
  const previousTz = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
  try {
    const github = new FakeGitHub(), path = 'times/2026-08/alice.txt';
    const existing = entry('2026-08-31T23:00:00+00:00', '2026-09-01T06:00:00+00:00');
    seedText(github, path, serializeMonthlyText([existing]), 'aug-sha');

    const result = await service({ github }).bulkAddTimes('2026-08-31 https://example.com/import Mixed-zone 0.5');

    assert.deepEqual(result, { added: 1 });
    assert.equal(github.atomicWrites.length, 1);
    const saved = parseMonthlyText(github.files.get(path).text, { user: 'alice', month: '2026-08', path });
    assert.equal(saved[1].startedAt, '2026-08-31T23:00:00-07:00');
    assert.equal(saved[1].endedAt, '2026-08-31T23:30:00-07:00');
  } finally {
    if (previousTz === undefined) delete process.env.TZ;
    else process.env.TZ = previousTz;
  }
});

test('bulk import atomically guards a prior-month crossing partition against concurrent changes', async () => {
  const github = new FakeGitHub(), previousPath = 'times/2026-08/alice.txt';
  seedText(github, previousPath, '', 'aug-old');
  const originalAtomic = github.updateTextsAtomic.bind(github);
  github.updateTextsAtomic = async (changes, message, options) => {
    const crossing = entry(localTimestamp(2026, 7, 31, 23, 30), localTimestamp(2026, 8, 1, 0, 30));
    seedText(github, previousPath, serializeMonthlyText([crossing]), 'aug-new');
    return originalAtomic(changes, message, options);
  };
  await assert.rejects(() => service({ github }).bulkAddTimes('2026-09-01 https://example.com/import Import 1'), /changed during bulk import/i);
  assert.equal(github.files.has('times/2026-09/alice.txt'), false);
  assert.equal(github.atomicWrites.length, 0);
});

test('bulk import atomically guards against a timer started after occupancy validation', async () => {
  const github = new FakeGitHub(), activePath = 'active/alice.txt';
  const originalAtomic = github.updateTextsAtomic.bind(github);
  github.updateTextsAtomic = async (changes, message, options) => {
    seedText(github, activePath, serializeActiveText(active(localTimestamp(2026, 9, 2, 0, 30))), 'active-new');
    return originalAtomic(changes, message, options);
  };
  await assert.rejects(() => service({ github }).bulkAddTimes('2026-10-02 https://example.com/import Import 1'), /changed during bulk import/i);
  assert.equal(github.files.has('times/2026-10/alice.txt'), false);
  assert.equal(github.atomicWrites.length, 0);
});


test('bulk import starts after an interval crossing from any older monthly partition', async () => {
  const github = new FakeGitHub(), oldPath = 'times/2026-07/alice.txt';
  const crossing = entry(localTimestamp(2026, 6, 31, 23), localTimestamp(2026, 8, 1, 1));
  seedText(github, oldPath, serializeMonthlyText([crossing]), 'july-sha');
  const tracker = service({ github });
  await tracker.bulkAddTimes('2026-09-01 https://example.com/import Import 1');
  const imported = parseMonthlyText(github.files.get('times/2026-09/alice.txt').text, { user: 'alice', month: '2026-09' });
  assert.equal(imported[0].startedAt, localTimestamp(2026, 8, 1, 1));
  assert.equal(imported[0].endedAt, localTimestamp(2026, 8, 1, 2));
  assert.deepEqual(github.atomicWrites[0].guards, [{ path: oldPath, sha: 'july-sha' }, { path: 'active/alice.txt', sha: null }]);
  assert.equal(github.atomicWrites[0].expectedHeadSha, 'discovery-head');
});


test('background switching durably queues the transition before any GitHub request and later converges', async () => {
  const github = new FakeGitHub(), store = new MemoryStore();
  seedText(github, 'active/alice.txt', serializeActiveText(active('2026-08-18T08:00:00+00:00')), 'active-sha');
  store.value.activeCache = parseActiveText(github.files.get('active/alice.txt').text, { user: 'alice', path: 'active/alice.txt', sha: 'active-sha' });
  const tracker = service({ github, store });
  const accepted = await tracker.switchTask('https://example.com/next', 'Next task', '', { background: true });
  assert.equal(accepted.pending, true);
  assert.equal(accepted.active.taskUrl, 'https://example.com/next');
  assert.equal(github.reads.length + github.writes.length + github.deletes.length, 0, 'the UI response waits only for durable local storage');
  assert.equal(store.value.pendingWrites[0].operation, 'completeTimerAndStart');
  assert.equal(store.value.activeCache.taskUrl, 'https://example.com/next');
  await tracker.syncPending();
  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(parseActiveText(github.files.get('active/alice.txt').text, { user: 'alice' }).taskUrl, 'https://example.com/next');
  assert.equal(parseMonthlyText(github.files.get('times/2026-08/alice.txt').text, { user: 'alice', month: '2026-08' })[0].taskUrl, issue.url);
});


test('queued switch resumes from startNext after a service-worker restart', async () => {
  const github = new FakeGitHub(), store = new MemoryStore();
  seedText(github, 'active/alice.txt', serializeActiveText(active('2026-08-18T08:00:00+00:00')), 'active-sha');
  store.value.activeCache = parseActiveText(github.files.get('active/alice.txt').text, { user: 'alice', path: 'active/alice.txt', sha: 'active-sha' });
  const originalPut = github.putText.bind(github); let failTargetOnce = true;
  github.putText = async (...args) => {
    if (args[0] === 'active/alice.txt' && !github.files.has(args[0]) && failTargetOnce) { failTargetOnce = false; throw new Error('offline'); }
    return originalPut(...args);
  };
  await service({ github, store }).switchTask('https://example.com/next', 'Next task', '', { background: true });
  await service({ github, store }).syncPending();
  assert.equal(store.value.pendingWrites[0].stage, 'startNext');
  assert.equal(store.value.activeCache._pending, true);
  await service({ github, store }).syncPending();
  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(parseActiveText(github.files.get('active/alice.txt').text, { user: 'alice' }).taskUrl, 'https://example.com/next');
});

test('queued switch preserves a newer remote timer instead of showing its optimistic target', async () => {
  const github = new FakeGitHub(), store = new MemoryStore();
  seedText(github, 'active/alice.txt', serializeActiveText(active('2026-08-18T08:00:00+00:00')), 'active-sha');
  store.value.activeCache = parseActiveText(github.files.get('active/alice.txt').text, { user: 'alice', path: 'active/alice.txt', sha: 'active-sha' });
  const tracker = service({ github, store });
  await tracker.switchTask('https://example.com/next', 'Next task', '', { background: true });
  const newer = active('2026-08-18T08:30:00+00:00', { taskUrl: 'https://example.com/other', issue: undefined });
  seedText(github, 'active/alice.txt', serializeActiveText(newer), 'newer-sha');
  await tracker.syncPending();
  assert.equal(store.value.pendingWrites[0].status, 'conflict');
  assert.equal(store.value.activeCache.taskUrl, 'https://example.com/other');
  assert.equal(github.files.has('times/2026-08/alice.txt'), false);
});


test('queued switch reconciles to a remote timer that races with startNext', async () => {
  const github = new FakeGitHub(), store = new MemoryStore();
  seedText(github, 'active/alice.txt', serializeActiveText(active('2026-08-18T08:00:00+00:00')), 'active-sha');
  store.value.activeCache = parseActiveText(github.files.get('active/alice.txt').text, { user: 'alice', path: 'active/alice.txt', sha: 'active-sha' });
  const newer = active('2026-08-18T08:30:00+00:00', { taskUrl: 'https://example.com/other', issue: undefined });
  const originalPut = github.putText.bind(github); let raceOnce = true;
  github.putText = async (...args) => {
    if (args[0] === 'active/alice.txt' && !github.files.has(args[0]) && raceOnce) {
      raceOnce = false;
      seedText(github, 'active/alice.txt', serializeActiveText(newer), 'newer-sha');
    }
    return originalPut(...args);
  };
  const tracker = service({ github, store });
  await tracker.switchTask('https://example.com/next', 'Next task', '', { background: true });
  await tracker.syncPending();
  assert.equal(store.value.pendingWrites[0].stage, 'startNext');
  assert.equal(store.value.pendingWrites[0].status, 'conflict');
  assert.equal(store.value.activeCache.taskUrl, 'https://example.com/other');
  assert.equal(store.value.activeCache._pending, undefined);
});
