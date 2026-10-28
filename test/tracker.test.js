import test from 'node:test';
import assert from 'node:assert/strict';
import { TrackerConflictError, TrackerService } from '../src/services/tracker.js';
import { ReportService } from '../src/services/reports.js';
import { parseActiveRecord, parseMonthlyRecords, serializeActiveRecord, serializeMonthlyRecords } from '../src/domain/work-records.js';
import {
  applyTaskIndexChanges, emptyTaskIndex, parseTaskIndex, serializeTaskIndex, TASK_INDEX_PATH,
} from '../src/domain/task-index.js';

const issue = { type: 'issue', owner: 'acme', repo: 'frontend', number: 123, url: 'https://github.com/acme/frontend/issues/123' };
const pull = { type: 'pull_request', owner: 'acme', repo: 'frontend', number: 44, url: 'https://github.com/acme/frontend/pull/44' };
const fixedId = '01K2ABCDEF0123456789ABCDEF';
const ULID_ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function deterministicRecordId(timestamp) {
  let time = new Date(timestamp).getTime(), encoded = '';
  for (let i = 0; i < 10; i += 1) { encoded = ULID_ENCODING[time % 32] + encoded; time = Math.floor(time / 32); }
  return `${encoded}0000000000000000`;
}

class MemoryStore {
  constructor() { this.value = { activeCache: null, recentCache: [], pendingWrites: [], user: 'alice' }; }
  async getState() { return structuredClone(this.value); }
  async patchState(patch) { Object.assign(this.value, structuredClone(patch)); }
  async mutateState(mutate) {
    const patch = mutate(structuredClone(this.value));
    if (patch) Object.assign(this.value, structuredClone(patch));
    return structuredClone(this.value);
  }
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

const actor = { kind: 'human', id: 'github:123', name: 'alice' };
const producer = { kind: 'browser_extension', name: 'clockoli-chrome', version: '0.1.29' };
function active(startedAt = '2026-08-18T08:00:00.000Z', override = {}) {
  const taskUrl = override.taskUrl ?? override.issue?.url ?? issue.url;
  const taskTitle = override.taskTitle ?? override.issueTitle ?? '';
  const id = override.id ?? override.entryId ?? deterministicRecordId(startedAt);
  return {
    schemaVersion: 1, id, entryId: id, user: 'alice', actor, producer, taskUrl, taskTitle, issueTitle: taskTitle,
    ...(parseGitHubTaskUrlForTest(taskUrl) ? { issue: parseGitHubTaskUrlForTest(taskUrl) } : {}),
    entryDate: override.entryDate ?? startedAt.slice(0, 10), timezone: override.timezone ?? 'UTC', startedAt,
    description: '', metadata: {}, metrics: {}, createdAt: startedAt, updatedAt: startedAt, ...override,
  };
}
function parseGitHubTaskUrlForTest(url) {
  const match = String(url).match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/(issues|pull)\/(\d+)$/);
  return match ? { type: match[3] === 'pull' ? 'pull_request' : 'issue', owner: match[1], repo: match[2], number: Number(match[4]), url } : null;
}
function entry(startedAt, endedAt, override = {}) {
  const id = override.id ?? deterministicRecordId(startedAt);
  const taskUrl = override.taskUrl ?? override.issue?.url ?? issue.url;
  const taskTitle = override.taskTitle ?? override.issueTitle ?? '';
  return {
    schemaVersion: 1, id, entryId: id, user: 'alice', actor, producer, taskUrl,
    ...(parseGitHubTaskUrlForTest(taskUrl) ? { issue: parseGitHubTaskUrlForTest(taskUrl) } : {}),
    taskTitle, issueTitle: taskTitle,
    entryDate: override.entryDate ?? startedAt.slice(0, 10), timezone: override.timezone ?? 'UTC', startedAt, endedAt,
    durationSeconds: Math.floor((new Date(endedAt) - new Date(startedAt)) / 1000), description: '',
    metadata: {}, metrics: {}, createdAt: startedAt, updatedAt: endedAt, ...override,
  };
}
function stripInternalForTest(value) {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !['_path', '_sha', '_index', '_pending'].includes(key)));
}
function seedText(github, path, text, sha = 'seed') { github.files.set(path, { sha, text }); }
function ensureTaskIndexFixture(github) {
  if (github.files.has(TASK_INDEX_PATH)) return;
  let entries = [];
  try {
    entries = [...github.files]
      .filter(([path]) => /^times\/\d{4}-\d{2}\/alice\.jsonl$/.test(path))
      .flatMap(([path, file]) => parseMonthlyRecords(file.text, { path, sha: file.sha }));
  } catch { /* Keep malformed monthly fixtures for the production parser under test. */ }
  seedText(github, TASK_INDEX_PATH, serializeTaskIndex(applyTaskIndexChanges(emptyTaskIndex('alice'), { add: entries })), 'task-index');
}
function localTimestamp(year, monthIndex, day, hour = 0, minute = 0, second = 0) {
  const date = new Date(year, monthIndex, day, hour, minute, second, 0);
  const pad = value => String(value).padStart(2, '0');
  const offset = -date.getTimezoneOffset(), sign = offset >= 0 ? '+' : '-';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    + `${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
}
function service(options = {}) {
  const github = options.github ?? new FakeGitHub();
  ensureTaskIndexFixture(github);
  return new TrackerService({ github, store: options.store ?? new MemoryStore(), reports: options.reports, user: 'alice',
    actorId: options.actorId ?? 'github:123', actorName: 'alice',
    clock: options.clock ?? (() => new Date('2026-08-18T09:00:00Z')), idFactory: options.idFactory ?? (() => fixedId),
    recentDays: options.recentDays ?? 7, allowedIssueOwners: ['acme'], ...(options.timezone ? { timezone: options.timezone } : {}) });
}

test('queued start/stop preparation is side-effect free and keeps destination metadata out of work JSON', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), tracker = service({ github, store });
  const running = { ...active(), _path: 'active/alice.json', _sha: 'active-sha', destinationId: 'must-not-persist' };
  store.value.activeCache = running;
  const stopped = tracker.prepareQueuedStop(running, 'done');
  const started = tracker.prepareQueuedStart('https://example.test/next', 'Next', '', {
    blockedBy: { destinationId: 'github:1', operationId: stopped.operation.id },
  });
  assert.equal(stopped.operation.nextActive, undefined);
  assert.equal(started.operation.stage, 'awaitSourceCompletion');
  assert.equal(started.operation.blockedBy.destinationId, 'github:1');
  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(store.value.activeCache.id, running.id);
  assert.doesNotMatch(serializeActiveRecord(started.pendingActive), /destination/i);
  assert.doesNotMatch(serializeMonthlyRecords([stopped.pendingEntry]), /destination/i);
});

test('Stop and switch keep the saved active description unless explicitly replaced', async () => {
  const notes = 'First line\n\nSecond line';
  const running = active('2026-08-18T08:00:00.000Z', { description: notes });

  const stopStore = new MemoryStore(), stopTracker = service({ store: stopStore });
  stopStore.value.activeCache = running;
  const stopped = await stopTracker.queueStop();
  assert.equal(stopped.entry.description, notes);
  assert.equal(stopStore.value.recentCache[0].description, notes);

  const switchStore = new MemoryStore(), switchTracker = service({ store: switchStore });
  switchStore.value.activeCache = running;
  const switched = await switchTracker.queueTaskSwitch('https://example.com/new', 'New task');
  assert.equal(switched.stopped.entry.description, notes);

  const crossStore = new MemoryStore(), crossTracker = service({ store: crossStore });
  assert.equal(crossTracker.prepareQueuedStop(running).entry.description, notes,
    'cross-repository switches should also preserve saved descriptions');

  const clearStore = new MemoryStore(), clearTracker = service({ store: clearStore });
  clearStore.value.activeCache = running;
  assert.equal((await clearTracker.queueStop('')).entry.description, '',
    'an explicitly cleared description must remain empty');
});

test('a queued Stop drains against a titled task index without losing earlier records', async () => {
  const github = new FakeGitHub(), store = new MemoryStore();
  const prior = entry('2026-10-26T08:00:00.000Z', '2026-10-26T09:00:00.000Z', { taskTitle: 'Earlier title' });
  const path = 'times/2026-10/alice.jsonl';
  seedText(github, path, serializeMonthlyRecords([prior]), 'monthly-sha');
  seedText(github, TASK_INDEX_PATH, serializeTaskIndex(applyTaskIndexChanges(emptyTaskIndex('alice'), {
    add: [prior],
  })), 'index-sha');
  const running = active('2026-10-27T08:00:00.000Z', { taskTitle: 'Reviewing', timezone: 'Europe/Warsaw' });
  seedText(github, 'active/alice.json', serializeActiveRecord(running), 'active-sha');
  store.value.activeCache = parseActiveRecord(github.files.get('active/alice.json').text,
    { user: 'alice', path: 'active/alice.json', sha: 'active-sha' });
  const tracker = service({ github, store, clock: () => new Date('2026-10-27T12:00:00.000Z') });
  const stopped = await tracker.queueStop();
  assert.equal(stopped.pending, true);
  assert.equal(store.value.pendingWrites[0].operation, 'completeTimer');
  await tracker.syncPending();
  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(github.files.has('active/alice.json'), false);
  const saved = parseMonthlyRecords(github.files.get(path).text, { user: 'alice', month: '2026-10' });
  assert.deepEqual(saved.map(record => record.id), [prior.id, running.id]);
  const index = parseTaskIndex(github.files.get(TASK_INDEX_PATH).text, { user: 'alice' });
  assert.equal(index.tasks[issue.url].sessionCount, 2);
  assert.equal(index.tasks[issue.url].title, 'Reviewing');
  assert.equal(index.tasks[issue.url].totalSeconds, 18000);
  assert.equal(github.atomicWrites.length, 1);
});

test('sync leaves an await-source start untouched without attempting a remote write', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), tracker = service({ github, store });
  store.value.pendingWrites = [{
    id: 'blocked', operation: 'startTimer', stage: 'awaitSourceCompletion', status: 'pending', retryCount: 0,
    nextActive: stripInternalForTest(active('2026-08-18T09:00:00.000Z')),
    blockedBy: { destinationId: 'github:1', operationId: 'source' }, queuedAt: '2026-08-18T09:00:00.000Z', lastError: '',
  }];
  const remaining = await tracker.syncPending();
  assert.equal(remaining[0].stage, 'awaitSourceCompletion');
  assert.deepEqual(github.writes, []);
});

test('completed-record mutations update the mandatory task index atomically', async () => {
  const github = new FakeGitHub(), store = new MemoryStore();
  seedText(github, 'active/alice.json', serializeActiveRecord(active('2026-08-18T08:00:00.000Z')), 'active-sha');
  store.value.activeCache = parseActiveRecord(github.files.get('active/alice.json').text, { user: 'alice', path: 'active/alice.json', sha: 'active-sha' });
  const tracker = service({ github, store });
  const stopped = await tracker.stop();
  let index = parseTaskIndex(github.files.get(TASK_INDEX_PATH).text, { user: 'alice' });
  assert.deepEqual(index.tasks[issue.url], { totalSeconds: 3600, sessionCount: 1, recordIds: [stopped.entry.id],
    title: '', titleSourceId: stopped.entry.id, titleStartedAt: stopped.entry.startedAt });
  assert.deepEqual(github.atomicWrites[0].changes.map(change => change.path), [
    'times/2026-08/alice.jsonl', 'active/alice.json', TASK_INDEX_PATH,
  ]);

  const saved = stopped.entry;
  const edited = await tracker.editEntry({
    path: saved._path, originalSha: saved._sha, index: saved._index, original: saved,
    edits: { endedAt: '2026-08-18T10:00:00.000Z' },
  });
  index = parseTaskIndex(github.files.get(TASK_INDEX_PATH).text, { user: 'alice' });
  assert.deepEqual(index.tasks[issue.url], { totalSeconds: 7200, sessionCount: 1, recordIds: [saved.id],
    title: '', titleSourceId: saved.id, titleStartedAt: saved.startedAt });

  await tracker.deleteEntry({ path: edited._path, originalSha: edited._sha, index: edited._index, original: edited });
  index = parseTaskIndex(github.files.get(TASK_INDEX_PATH).text, { user: 'alice' });
  assert.deepEqual(index.tasks, {});
  assert.ok(github.atomicWrites.every(write => write.changes.some(change => change.path === TASK_INDEX_PATH)));
});

test('task merge atomically replaces every queued source URL and title across the selected range and active timer', async () => {
  const github = new FakeGitHub(), store = new MemoryStore();
  const sourceUrl = 'https://example.test/source', targetUrl = 'https://example.test/target', secondSourceUrl = 'https://example.test/source-two', secondTargetUrl = 'https://example.test/target-two';
  const july = entry('2026-07-02T08:00:00.000Z', '2026-07-02T09:00:00.000Z', {
    taskUrl: sourceUrl, taskTitle: 'Old task', metadata: {
      custom: { keep: true }, clockoli: { future: 'keep', task_identity_history: [{ url: 'https://example.test/original', title: 'Original task' }] },
    },
  });
  const august = entry('2026-08-03T08:00:00.000Z', '2026-08-03T10:00:00.000Z', { taskUrl: secondSourceUrl, taskTitle: 'Second old task' });
  const outside = entry('2026-04-03T08:00:00.000Z', '2026-04-03T09:00:00.000Z', { taskUrl: sourceUrl, taskTitle: 'Old task' });
  seedText(github, 'times/2026-07/alice.jsonl', serializeMonthlyRecords([july]), 'july-sha');
  seedText(github, 'times/2026-08/alice.jsonl', serializeMonthlyRecords([august]), 'august-sha');
  seedText(github, 'times/2026-04/alice.jsonl', serializeMonthlyRecords([outside]), 'april-sha');
  const running = active('2026-08-18T08:00:00.000Z', { taskUrl: sourceUrl, taskTitle: 'Old task' });
  seedText(github, 'active/alice.json', serializeActiveRecord(running), 'active-sha');
  const tracker = service({ github, store, clock: () => new Date('2026-08-18T09:00:00Z') });
  const result = await tracker.mergeTasks({ pairs: [
    { sourceTaskUrl: sourceUrl, targetTaskUrl: targetUrl, targetTaskTitle: 'Canonical task' },
    { sourceTaskUrl: secondSourceUrl, targetTaskUrl: secondTargetUrl, targetTaskTitle: 'Second canonical task' },
  ], startDate: '2026-05-19', endDate: '2026-08-18' });
  assert.deepEqual(result, { mergedEntries: 2, mergedActive: true });
  const [savedJuly] = parseMonthlyRecords(github.files.get('times/2026-07/alice.jsonl').text, { user: 'alice', month: '2026-07' });
  const [savedAugust] = parseMonthlyRecords(github.files.get('times/2026-08/alice.jsonl').text, { user: 'alice', month: '2026-08' });
  assert.equal(savedJuly.taskUrl, targetUrl); assert.equal(savedJuly.taskTitle, 'Canonical task');
  assert.equal(savedAugust.taskUrl, secondTargetUrl); assert.equal(savedAugust.taskTitle, 'Second canonical task');
  assert.deepEqual(savedJuly.metadata, {
    custom: { keep: true }, clockoli: {
      future: 'keep', task_identity_history: [
        { url: 'https://example.test/original', title: 'Original task' },
        { url: sourceUrl, title: 'Old task' },
      ],
    },
  });
  assert.deepEqual(savedAugust.metadata.clockoli.task_identity_history, [{ url: secondSourceUrl, title: 'Second old task' }]);
  const [savedOutside] = parseMonthlyRecords(github.files.get('times/2026-04/alice.jsonl').text, { user: 'alice', month: '2026-04' });
  assert.equal(savedOutside.taskUrl, sourceUrl);
  const savedActive = parseActiveRecord(github.files.get('active/alice.json').text, { user: 'alice' });
  assert.equal(savedActive.taskUrl, targetUrl); assert.equal(savedActive.taskTitle, 'Canonical task');
  assert.deepEqual(savedActive.metadata.clockoli.task_identity_history, [{ url: sourceUrl, title: 'Old task' }]);
  const index = parseTaskIndex(github.files.get(TASK_INDEX_PATH).text, { user: 'alice' });
  assert.equal(index.tasks[sourceUrl].sessionCount, 1);
  assert.deepEqual(index.tasks[targetUrl], { totalSeconds: 3600, sessionCount: 1, recordIds: [july.id],
    title: 'Canonical task', titleSourceId: july.id, titleStartedAt: july.startedAt });
  assert.deepEqual(index.tasks[secondTargetUrl], { totalSeconds: 7200, sessionCount: 1, recordIds: [august.id],
    title: 'Second canonical task', titleSourceId: august.id, titleStartedAt: august.startedAt });
  assert.equal(github.atomicWrites.length, 1);
});

test('task merge replaces an imported identity with a URL and rejects an imported replacement', async () => {
  const github = new FakeGitHub(), store = new MemoryStore();
  const source = 'KlimTodrik/clockoli-issues/6-Polish-the-Clockoli-GitHub-project-page-for-Launch-1';
  const target = 'https://github.com/Clockoli/clockoli-issues/issues/6';
  const path = 'times/2026-08/alice.jsonl';
  const original = entry('2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z', { taskUrl: source, taskTitle: 'Imported task' });
  seedText(github, path, serializeMonthlyRecords([original]), 'monthly-sha');
  const tracker = service({ github, store, clock: () => new Date('2026-08-18T12:00:00Z') });
  await assert.rejects(tracker.mergeTasks({ pairs: [{ sourceTaskUrl: target, targetTaskUrl: source }], startDate: '2026-08-18', endDate: '2026-08-18' }), /Invalid task URL/);
  assert.equal(github.atomicWrites.length, 0);
  assert.deepEqual(await tracker.mergeTasks({ pairs: [{ sourceTaskUrl: source, targetTaskUrl: target, targetTaskTitle: 'Polish project page' }], startDate: '2026-08-18', endDate: '2026-08-18' }),
    { mergedEntries: 1, mergedActive: false });
  const [saved] = parseMonthlyRecords(github.files.get(path).text, { user: 'alice', month: '2026-08' });
  assert.equal(saved.taskUrl, target);
  assert.deepEqual(saved.metadata.clockoli.task_identity_history, [{ url: source, title: 'Imported task' }]);
  assert.equal(github.atomicWrites.length, 1);
});

test('start writes one readable active text file with its durable issue title', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), tracker = service({ github, store });
  const result = await tracker.start(issue, 'Ranking regression', 'Investigating');
  assert.equal(result._path, 'active/alice.json');
  const file = github.files.get('active/alice.json');
  assert.equal(JSON.parse(file.text).work_item.title, 'Ranking regression');
  assert.equal(JSON.parse(file.text).description, 'Investigating');
  assert.equal(new Date(parseActiveRecord(file.text, { user: 'alice' }).startedAt).getTime(), new Date('2026-08-18T09:00:00Z').getTime());
  assert.equal(JSON.parse(file.text).schema_version, 1);
  assert.equal(parseActiveRecord(file.text, { user: 'alice' }).issueTitle, 'Ranking regression');
  assert.equal(parseActiveRecord(file.text, { user: 'alice' }).issue.number, 123);
});

test('queued completed-entry edit updates local cache immediately and saves later in FIFO order', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-08/alice.jsonl';
  const original = entry('2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z');
  seedText(github, path, serializeMonthlyRecords([original]), 'monthly-sha');
  ensureTaskIndexFixture(github);
  store.value.recentCache = [{ ...original, _path: path, _sha: 'monthly-sha', _index: 0 }];
  const tracker = service({ github, store, clock: () => new Date('2026-08-18T12:00:00.000Z') });

  const accepted = await tracker.queueEntryEdit({
    path, originalSha: 'monthly-sha', index: 0,
    original: {
      id: original.id, taskUrl: original.taskUrl, taskTitle: original.taskTitle,
      issueUrl: original.taskUrl, issueTitle: original.taskTitle,
      startedAt: original.startedAt, endedAt: original.endedAt, description: original.description,
    },
    edits: { endedAt: '2026-08-18T10:00:00.000Z' },
  });

  assert.equal(accepted.pending, true);
  assert.equal(github.atomicWrites.length, 0);
  assert.equal(store.value.pendingWrites.length, 1);
  assert.equal(store.value.recentCache[0].endedAt, '2026-08-18T10:00:00.000Z');
  await tracker.syncPending();
  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(github.atomicWrites.length, 1);
  assert.equal(parseMonthlyRecords(github.files.get(path).text, { user: 'alice', month: '2026-08' })[0].endedAt, '2026-08-18T10:00:00.000Z');
})

test('calendar edit of a historical entry outside recent cache is accepted and survives worker restart', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-07/alice.jsonl';
  const original = entry('2026-07-18T08:00:00.000Z', '2026-07-18T09:00:00.000Z');
  const newer = entry('2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z');
  seedText(github, path, serializeMonthlyRecords([original]), 'historical-sha');
  ensureTaskIndexFixture(github);
  store.value.recentCache = [{ ...newer, _path: 'times/2026-08/alice.jsonl', _sha: 'newer-sha', _index: 0 }];
  const tracker = service({ github, store });
  const accepted = await tracker.queueEntryEdit({ path, originalSha: 'historical-sha', index: 0,
    original: { ...original, description: 'untrusted client snapshot' }, edits: { endedAt: '2026-07-18T10:00:00.000Z' } });
  assert.equal(accepted.pending, true);
  assert.equal(store.value.pendingWrites[0].request.original.description, original.description);
  assert.equal(store.value.pendingWrites[0].request.originalSha, 'historical-sha');
  assert.deepEqual(store.value.recentCache.map(item => item.id), [newer.id]);
  await service({ github, store }).syncPending();
  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(parseMonthlyRecords(github.files.get(path).text, { user: 'alice', month: '2026-07' })[0].endedAt, '2026-07-18T10:00:00.000Z');
  assert.equal(store.value.recentCache[0].id, newer.id);
});

test('moving an entry to another week checks remote neighbors before local acceptance', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-08/alice.jsonl';
  const original = entry('2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z');
  const neighbor = entry('2026-08-25T10:00:00.000Z', '2026-08-25T11:00:00.000Z');
  seedText(github, path, serializeMonthlyRecords([original, neighbor]), 'source-sha');
  const tracker = service({ github, store, clock: () => new Date('2026-08-26T12:00:00.000Z') });
  store.value.recentCache = [{ ...original, _path: path, _sha: 'source-sha', _index: 0 }];
  const request = { path, originalSha: 'source-sha', index: 0, original: { id: original.id },
    edits: { startedAt: '2026-08-25T10:30:00.000Z', endedAt: '2026-08-25T11:30:00.000Z' } };
  await assert.rejects(() => tracker.queueEntryEdit(request), /overlap/i);
  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(store.value.recentCache[0].startedAt, original.startedAt);
  assert.equal(github.atomicWrites.length, 0);
  await assert.rejects(() => tracker.editEntry(request), /overlap/i);
  assert.equal(github.atomicWrites.length, 0);
});

test('moving next to another week’s entry keeps both records after synchronization', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-08/alice.jsonl';
  const original = entry('2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z');
  const neighbor = entry('2026-08-25T10:00:00.000Z', '2026-08-25T11:00:00.000Z');
  seedText(github, path, serializeMonthlyRecords([original, neighbor]), 'source-sha');
  const tracker = service({ github, store, clock: () => new Date('2026-08-26T12:00:00.000Z') });
  store.value.recentCache = [{ ...original, _path: path, _sha: 'source-sha', _index: 0 }];
  const request = { path, originalSha: 'source-sha', index: 0, original: { id: original.id },
    edits: { startedAt: neighbor.endedAt, endedAt: '2026-08-25T12:00:00.000Z' } };
  assert.equal((await tracker.queueEntryEdit(request)).pending, true);
  await service({ github, store, clock: () => new Date('2026-08-26T12:00:00.000Z') }).syncPending();
  assert.equal(store.value.pendingWrites.length, 0);
  const saved = parseMonthlyRecords(github.files.get(path).text, { user: 'alice', month: '2026-08' });
  assert.equal(saved.length, 2);
  assert.equal(saved.find(item => item.id === original.id)?.startedAt, neighbor.endedAt);
  assert.equal(saved.find(item => item.id === neighbor.id)?.startedAt, neighbor.startedAt);
});

test('cross-month edit rejects an overlap with an earlier-month overnight entry', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), source = 'times/2026-08/alice.jsonl';
  const original = entry('2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z');
  const overnight = entry('2026-08-31T23:30:00.000Z', '2026-09-01T00:30:00.000Z');
  seedText(github, source, serializeMonthlyRecords([original, overnight]), 'august-sha');
  store.value.recentCache = [{ ...original, _path: source, _sha: 'august-sha', _index: 0 }];
  const tracker = service({ github, store, clock: () => new Date('2026-09-02T12:00:00.000Z') });
  const request = { path: source, originalSha: 'august-sha', index: 0, original: { id: original.id },
    edits: { startedAt: '2026-09-01T00:15:00.000Z', endedAt: '2026-09-01T01:15:00.000Z' } };
  await assert.rejects(() => tracker.queueEntryEdit(request), /overlap/i);
  assert.equal(store.value.pendingWrites.length, 0);
  await assert.rejects(() => tracker.editEntry(request), /overlap/i);
  assert.equal(github.atomicWrites.length, 0);
});

test('queued destination work and an unavailable overlap check prevent acceptance without hiding the original', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-08/alice.jsonl';
  const original = entry('2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z');
  const queued = entry('2026-08-25T10:00:00.000Z', '2026-08-25T11:00:00.000Z');
  seedText(github, path, serializeMonthlyRecords([original]), 'source-sha');
  store.value.recentCache = [{ ...original, _path: path, _sha: 'source-sha', _index: 0 }];
  store.value.pendingWrites = [{ operation: 'addTime', entry: queued, id: 'add', status: 'pending' }];
  const tracker = service({ github, store, clock: () => new Date('2026-08-26T12:00:00.000Z') });
  const request = { path, originalSha: 'source-sha', index: 0, original: { id: original.id },
    edits: { startedAt: '2026-08-25T10:30:00.000Z', endedAt: '2026-08-25T11:30:00.000Z' } };
  await assert.rejects(() => tracker.queueEntryEdit(request), /overlap/i);
  assert.equal(store.value.pendingWrites.length, 1);
  github.listTextFilesSnapshot = async () => { throw new Error('Offline'); };
  await assert.rejects(() => tracker.queueEntryEdit(request), /Offline/);
  assert.equal(store.value.recentCache[0].startedAt, original.startedAt);
  assert.equal(store.value.pendingWrites.length, 1);
});

test('linked boundary edits cannot move into another week’s occupied interval', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-08/alice.jsonl';
  const original = entry('2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z');
  const neighbor = entry('2026-08-25T10:00:00.000Z', '2026-08-25T11:00:00.000Z');
  seedText(github, path, serializeMonthlyRecords([original, neighbor]), 'source-sha');
  store.value.recentCache = [{ ...original, _path: path, _sha: 'source-sha', _index: 0 }];
  const tracker = service({ github, store, clock: () => new Date('2026-08-26T12:00:00.000Z') });
  const requests = [{ path, originalSha: 'source-sha', index: 0, original: { id: original.id },
    edits: { startedAt: '2026-08-25T10:30:00.000Z', endedAt: '2026-08-25T11:30:00.000Z' } }];
  await assert.rejects(() => tracker.queueEntriesEdit({ entries: requests }), /overlap/i);
  assert.equal(store.value.pendingWrites.length, 0);
  await assert.rejects(() => tracker.editEntries({ entries: requests }), /overlap/i);
  assert.equal(github.atomicWrites.length, 0);
});

test('direct edit guards older monthly files read during the overlap check', async () => {
  const github = new FakeGitHub(), path = 'times/2026-08/alice.jsonl', earlierPath = 'times/2026-07/alice.jsonl';
  const original = entry('2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z');
  seedText(github, path, serializeMonthlyRecords([original]), 'august-sha');
  seedText(github, earlierPath, serializeMonthlyRecords([entry('2026-07-20T08:00:00.000Z', '2026-07-20T09:00:00.000Z')]), 'july-sha');
  const tracker = service({ github, clock: () => new Date('2026-08-26T12:00:00.000Z') });
  const update = github.updateTextsAtomic.bind(github);
  github.updateTextsAtomic = async (...args) => {
    seedText(github, earlierPath, serializeMonthlyRecords([entry('2026-07-20T08:00:00.000Z', '2026-08-25T11:00:00.000Z')]), 'concurrent-july-sha');
    return update(...args);
  };
  await assert.rejects(() => tracker.editEntry({ path, originalSha: 'august-sha', index: 0,
    original: { id: original.id }, edits: { startedAt: '2026-08-25T10:00:00.000Z', endedAt: '2026-08-25T11:00:00.000Z' } }),
  /changed/i);
  assert.equal(github.atomicWrites.length, 0);
  assert.equal(github.files.get(path).sha, 'august-sha');
});

test('a moved entry is not queued against a monthly file changed since it was loaded', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-08/alice.jsonl';
  const original = entry('2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z');
  seedText(github, path, serializeMonthlyRecords([original]), 'newer-sha');
  store.value.recentCache = [{ ...original, _path: path, _sha: 'older-sha', _index: 0 }];
  const tracker = service({ github, store, clock: () => new Date('2026-08-26T12:00:00.000Z') });
  await assert.rejects(() => tracker.queueEntryEdit({ path, originalSha: 'older-sha', index: 0,
    original: { id: original.id }, edits: { startedAt: '2026-08-25T10:00:00.000Z', endedAt: '2026-08-25T11:00:00.000Z' } }),
  /changed/i);
  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(store.value.recentCache[0].startedAt, original.startedAt);
});

test('moving an entry to an earlier month keeps its source file in the overlap check', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-08/alice.jsonl';
  const original = entry('2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z');
  seedText(github, path, serializeMonthlyRecords([original]), 'august-sha');
  store.value.recentCache = [{ ...original, _path: path, _sha: 'august-sha', _index: 0 }];
  const tracker = service({ github, store, clock: () => new Date('2026-08-26T12:00:00.000Z') });
  const request = { path, originalSha: 'august-sha', index: 0, original: { id: original.id },
    edits: { startedAt: '2026-07-25T10:00:00.000Z', endedAt: '2026-07-25T11:00:00.000Z' } };
  await tracker.queueEntryEdit(request);
  assert.equal(store.value.pendingWrites.length, 1);
  const linkedStore = new MemoryStore();
  linkedStore.value.recentCache = [{ ...original, _path: path, _sha: 'august-sha', _index: 0 }];
  await service({ github, store: linkedStore, clock: () => new Date('2026-08-26T12:00:00.000Z') })
    .queueEntriesEdit({ entries: [request] });
  assert.equal(linkedStore.value.pendingWrites.length, 1);
  await tracker.syncPending();
  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(parseMonthlyRecords(github.files.get('times/2026-07/alice.jsonl').text, { user: 'alice', month: '2026-07' })[0].id, original.id);
});

test('an earlier local month cannot hide an overlapping record in a later timezone partition', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-08/alice.jsonl';
  const original = entry('2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z', { timezone: 'America/Los_Angeles' });
  const neighbor = entry('2026-09-01T00:30:00.000Z', '2026-09-01T00:50:00.000Z',
    { timezone: 'Pacific/Auckland', entryDate: '2026-09-01' });
  seedText(github, path, serializeMonthlyRecords([original]), 'august-sha');
  seedText(github, 'times/2026-09/alice.jsonl', serializeMonthlyRecords([neighbor]), 'september-sha');
  store.value.recentCache = [{ ...original, _path: path, _sha: 'august-sha', _index: 0 }];
  const tracker = service({ github, store, clock: () => new Date('2026-09-02T12:00:00.000Z') });
  const request = { path, originalSha: 'august-sha', index: 0, original: { id: original.id },
    edits: { startedAt: '2026-09-01T00:15:00.000Z', endedAt: '2026-09-01T01:15:00.000Z' } };
  await assert.rejects(() => tracker.queueEntryEdit(request), /overlap/i);
  assert.equal(store.value.pendingWrites.length, 0);
  await assert.rejects(() => tracker.editEntry(request), /overlap/i);
  assert.equal(github.atomicWrites.length, 0);
});

test('overlap preflight bounds concurrent historical monthly reads', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-08/alice.jsonl';
  const original = entry('2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z');
  for (let month = 1; month <= 7; month++) {
    const day = `2026-${String(month).padStart(2, '0')}-18`;
    seedText(github, `times/${day.slice(0, 7)}/alice.jsonl`,
      serializeMonthlyRecords([entry(`${day}T08:00:00.000Z`, `${day}T09:00:00.000Z`)]), `sha-${month}`);
  }
  seedText(github, path, serializeMonthlyRecords([original]), 'august-sha');
  store.value.recentCache = [{ ...original, _path: path, _sha: 'august-sha', _index: 0 }];
  const getText = github.getText.bind(github);
  let inFlight = 0, maxInFlight = 0;
  github.getText = async (...args) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try { await new Promise(resolve => setTimeout(resolve, 1)); return await getText(...args); }
    finally { inFlight--; }
  };
  await service({ github, store, clock: () => new Date('2026-08-26T12:00:00.000Z') }).queueEntryEdit({
    path, originalSha: 'august-sha', index: 0, original: { id: original.id },
    edits: { startedAt: '2026-08-25T10:00:00.000Z', endedAt: '2026-08-25T11:00:00.000Z' },
  });
  assert.equal(github.reads.filter(read => read.startsWith('times/')).length >= 8, true);
  assert.equal(maxInFlight <= 4, true);
});

test('a neighbor added after local acceptance becomes a recoverable sync conflict, not an endless retry', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-08/alice.jsonl';
  const original = entry('2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z');
  const neighbor = entry('2026-09-01T10:30:00.000Z', '2026-09-01T11:30:00.000Z');
  seedText(github, path, serializeMonthlyRecords([original]), 'august-sha');
  store.value.recentCache = [{ ...original, _path: path, _sha: 'august-sha', _index: 0 }];
  const tracker = service({ github, store, clock: () => new Date('2026-09-02T12:00:00.000Z') });
  await tracker.queueEntryEdit({ path, originalSha: 'august-sha', index: 0, original: { id: original.id },
    edits: { startedAt: '2026-09-01T10:00:00.000Z', endedAt: '2026-09-01T11:00:00.000Z' } });
  seedText(github, 'times/2026-09/alice.jsonl', serializeMonthlyRecords([neighbor]), 'new-september-sha');
  await tracker.syncPending();
  assert.equal(store.value.pendingWrites[0].status, 'conflict');
  assert.match(store.value.pendingWrites[0].lastError, /overlap another entry/i);
  assert.equal(github.atomicWrites.length, 0);
  assert.equal(store.value.recentCache.some(item => item.id === original.id), true);
});

test('a timer started after local acceptance becomes a recoverable edit conflict', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-08/alice.jsonl';
  const original = entry('2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z');
  seedText(github, path, serializeMonthlyRecords([original]), 'august-sha');
  store.value.recentCache = [{ ...original, _path: path, _sha: 'august-sha', _index: 0 }];
  const tracker = service({ github, store, clock: () => new Date('2026-08-26T12:00:00.000Z') });
  await tracker.queueEntryEdit({ path, originalSha: 'august-sha', index: 0, original: { id: original.id },
    edits: { startedAt: '2026-08-25T10:00:00.000Z', endedAt: '2026-08-25T11:00:00.000Z' } });
  seedText(github, 'active/alice.json', serializeActiveRecord(active('2026-08-25T10:30:00.000Z')),
    'new-active-sha');
  await tracker.syncPending();
  assert.equal(store.value.pendingWrites[0].status, 'conflict');
  assert.match(store.value.pendingWrites[0].lastError, /overlap the running timer/i);
  assert.equal(github.atomicWrites.length, 0);
});

test('calendar edit reuses the loaded monthly blob while checking the remote timer', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-07/alice.jsonl';
  const sha = 'a'.repeat(40), original = entry('2026-07-18T08:00:00.000Z', '2026-07-18T09:00:00.000Z');
  const text = serializeMonthlyRecords([original]);
  seedText(github, path, text, sha);
  const reports = new ReportService({ github, cache: { getReportCache: async () => ({
    version: 1, repositoryKey: 'repository', snapshotReady: true,
    files: [{ path, sha }], blobs: { [sha]: text },
  }) } });
  const tracker = service({ github, store, reports });
  const accepted = await tracker.queueEntryEdit({ path, originalSha: sha, index: 0,
    original: { ...original, description: 'untrusted client snapshot' }, edits: { endedAt: '2026-07-18T10:00:00.000Z' } });
  assert.equal(accepted.pending, true);
  assert.deepEqual(github.reads, ['active/alice.json']);
  assert.equal(store.value.pendingWrites[0].request.original.description, original.description);
  await service({ github, store, reports }).syncPending();
  assert.equal(parseMonthlyRecords(github.files.get(path).text, { user: 'alice', month: '2026-07' })[0].endedAt, '2026-07-18T10:00:00.000Z');
});

test('linked edits and deletion reuse the loaded report blob', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-07/alice.jsonl';
  const sha = 'b'.repeat(40), first = entry('2026-07-18T08:00:00.000Z', '2026-07-18T09:00:00.000Z');
  const second = entry('2026-07-18T09:00:00.000Z', '2026-07-18T10:00:00.000Z');
  const text = serializeMonthlyRecords([first, second]);
  seedText(github, path, text, sha);
  const reports = new ReportService({ github, cache: { getReportCache: async () => ({
    version: 1, repositoryKey: 'repository', snapshotReady: true,
    files: [{ path, sha }], blobs: { [sha]: text },
  }) } });
  const tracker = service({ github, store, reports });
  const request = (original, index, edits) => ({ path, originalSha: sha, index, original, edits });
  await tracker.queueEntriesEdit({ entries: [
    request(first, 0, { endedAt: '2026-07-18T09:15:00.000Z' }),
    request(second, 1, { startedAt: '2026-07-18T09:15:00.000Z' }),
  ] });
  await tracker.queueEntryDelete(request(first, 0, {}));
  assert.deepEqual(github.reads, ['active/alice.json']);
  assert.equal(store.value.pendingWrites[0].request.entries.length, 2);
  assert.equal(store.value.pendingWrites.at(-1).request.original.id, first.id);
});

test('historical delete and linked boundary edits resolve trusted monthly records outside recent cache', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-07/alice.jsonl';
  const first = entry('2026-07-18T08:00:00.000Z', '2026-07-18T09:00:00.000Z');
  const second = entry('2026-07-18T09:00:00.000Z', '2026-07-18T10:00:00.000Z');
  seedText(github, path, serializeMonthlyRecords([first, second]), 'historical-sha');
  ensureTaskIndexFixture(github);
  const tracker = service({ github, store });
  const request = (original, index, edits) => ({ path, originalSha: 'historical-sha', index, original, edits });
  assert.equal((await tracker.queueEntriesEdit({ entries: [
    request(first, 0, { endedAt: '2026-07-18T09:15:00.000Z' }),
    request(second, 1, { startedAt: '2026-07-18T09:15:00.000Z' }),
  ] })).pending, true);
  await service({ github, store }).syncPending();
  let saved = parseMonthlyRecords(github.files.get(path).text, { user: 'alice', month: '2026-07' });
  assert.equal(saved[0].endedAt, saved[1].startedAt);
  assert.equal((await tracker.queueEntryDelete({ path, originalSha: github.files.get(path).sha, index: 0, original: saved[0] })).pending, true);
  await service({ github, store }).syncPending();
  saved = parseMonthlyRecords(github.files.get(path).text, { user: 'alice', month: '2026-07' });
  assert.deepEqual(saved.map(item => item.id), [second.id]);
});

test('syncing a historical deletion preserves only records already in the recent cache', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-07/alice.jsonl';
  const removed = entry('2026-07-18T08:00:00.000Z', '2026-07-18T09:00:00.000Z');
  const historical = entry('2026-07-18T09:00:00.000Z', '2026-07-18T10:00:00.000Z');
  const recent = entry('2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z');
  seedText(github, path, serializeMonthlyRecords([removed, historical]), 'historical-sha');
  ensureTaskIndexFixture(github);
  store.value.recentCache = [{ ...recent, _path: 'times/2026-08/alice.jsonl', _sha: 'recent-sha', _index: 0 }];
  const tracker = service({ github, store });
  await tracker.queueEntryDelete({ path, originalSha: 'historical-sha', index: 0, original: removed });
  await service({ github, store }).syncPending();
  assert.deepEqual(store.value.recentCache.map(item => item.id), [recent.id]);
  assert.deepEqual(parseMonthlyRecords(github.files.get(path).text, { user: 'alice', month: '2026-07' }).map(item => item.id), [historical.id]);
});

test('direct deletion updates cached siblings without adding uncached monthly records', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-07/alice.jsonl';
  const removed = entry('2026-07-18T08:00:00.000Z', '2026-07-18T09:00:00.000Z');
  const cached = entry('2026-07-18T09:00:00.000Z', '2026-07-18T10:00:00.000Z');
  const uncached = entry('2026-07-18T10:00:00.000Z', '2026-07-18T11:00:00.000Z');
  seedText(github, path, serializeMonthlyRecords([removed, cached, uncached]), 'historical-sha');
  ensureTaskIndexFixture(github);
  store.value.recentCache = [{ ...cached, _path: path, _sha: 'historical-sha', _index: 1 }];
  await service({ github, store }).deleteEntry({ path, originalSha: 'historical-sha', index: 0, original: removed });
  assert.deepEqual(store.value.recentCache.map(item => item.id), [cached.id]);
  assert.equal(store.value.recentCache[0]._index, 0);
  assert.equal(store.value.recentCache[0]._sha, github.files.get(path).sha);
  assert.deepEqual(parseMonthlyRecords(github.files.get(path).text, { user: 'alice', month: '2026-07' }).map(item => item.id), [cached.id, uncached.id]);
});

test('historical cache miss rejects foreign paths, absent IDs and pending deletion without queueing', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-07/alice.jsonl';
  const original = entry('2026-07-18T08:00:00.000Z', '2026-07-18T09:00:00.000Z');
  seedText(github, path, serializeMonthlyRecords([original]));
  const tracker = service({ github, store });
  await assert.rejects(() => tracker.queueEntryEdit({ path: 'times/2026-07/bob.jsonl', original, edits: { description: 'wrong user' } }));
  await assert.rejects(() => tracker.queueEntryEdit({ path, original: { id: fixedId }, edits: { description: 'missing' } }), TrackerConflictError);
  store.value.pendingWrites = [{ operation: 'deleteEntry', request: { path, original } }];
  await assert.rejects(() => tracker.queueEntryEdit({ path, original, edits: { description: 'resurrected' } }), TrackerConflictError);
  assert.equal(store.value.pendingWrites.length, 1);
  assert.equal(github.atomicWrites.length, 0);
});

test('historical edit after cache eviction coalesces with an accepted pending edit', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-07/alice.jsonl';
  const original = entry('2026-07-18T08:00:00.000Z', '2026-07-18T09:00:00.000Z');
  seedText(github, path, serializeMonthlyRecords([original]), 'historical-sha');
  ensureTaskIndexFixture(github);
  const tracker = service({ github, store });
  store.value.recentCache = [{ ...original, _path: path, _sha: 'historical-sha', _index: 0 }];
  const first = await tracker.queueEntryEdit({ path, originalSha: 'historical-sha', index: 0, original,
    edits: { startedAt: '2026-07-18T08:15:00.000Z' } });
  store.value.recentCache = [];
  const second = await service({ github, store }).queueEntryEdit({ path, originalSha: 'historical-sha', index: 0, original,
    edits: { endedAt: '2026-07-18T09:15:00.000Z' } });
  assert.equal(second.operationId, first.operationId);
  assert.equal(store.value.pendingWrites.length, 1);
  await service({ github, store }).syncPending();
  const saved = parseMonthlyRecords(github.files.get(path).text, { user: 'alice', month: '2026-07' })[0];
  assert.equal(saved.startedAt, '2026-07-18T08:15:00.000Z');
  assert.equal(saved.endedAt, '2026-07-18T09:15:00.000Z');
});

test('queued completed-entry deletion disappears locally immediately and syncs later', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-08/alice.jsonl';
  const original = entry('2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z');
  seedText(github, path, serializeMonthlyRecords([original]), 'monthly-sha');
  ensureTaskIndexFixture(github);
  store.value.recentCache = [{ ...original, _path: path, _sha: 'monthly-sha', _index: 0 }];
  const tracker = service({ github, store, clock: () => new Date('2026-08-18T12:00:00.000Z') });

  const accepted = await tracker.queueEntryDelete({
    path, originalSha: 'monthly-sha', index: 0, original,
  });

  assert.equal(accepted.pending, true);
  assert.ok(accepted.operationId);
  assert.equal(github.atomicWrites.length, 0);
  assert.equal(store.value.pendingWrites.length, 1);
  assert.equal(store.value.pendingWrites[0].operation, 'deleteEntry');
  assert.deepEqual(store.value.recentCache, []);
  const menuWhilePending = await tracker.loadMenuData();
  assert.deepEqual(menuWhilePending.recent, [], 'a remote refresh must not resurrect a locally deleted queued entry');
  assert.equal(menuWhilePending.pendingCount, 1);

  await tracker.syncPending();
  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(github.atomicWrites.length, 1);
  assert.deepEqual(parseMonthlyRecords(github.files.get(path)?.text || '', { user: 'alice', month: '2026-08' }), []);
})

test('retrying an already committed linked edit does not create a second GitHub commit', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-08/alice.jsonl';
  const first = entry('2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z');
  const second = entry('2026-08-18T10:00:00.000Z', '2026-08-18T11:00:00.000Z');
  seedText(github, path, serializeMonthlyRecords([first, second]), 'monthly-sha');
  ensureTaskIndexFixture(github);
  const rows = (await service({ github, store }).readMonthly(path)).entries;
  store.value.recentCache = rows;
  const requests = rows.map((original, index) => ({
    path, originalSha: 'monthly-sha', index, original, edits: { description: `Already saved ${index}` },
  }));
  const tracker = service({ github, store });
  await tracker.queueEntriesEdit({ entries: requests });
  await tracker.editEntries({ entries: structuredClone(requests) }, { updateCache: false });
  const commits = github.atomicWrites.length;
  await service({ github, store }).syncPending();
  assert.deepEqual(store.value.pendingWrites, []);
  assert.equal(github.atomicWrites.length, commits);
  const saved = parseMonthlyRecords(github.files.get(path).text, { user: 'alice', month: '2026-08' });
  assert.deepEqual(saved.map(row => row.description), ['Already saved 0', 'Already saved 1']);
});

test('retry of a committed entry move across months does not conflict or duplicate the move', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), oldPath = 'times/2026-08/alice.jsonl',
    newPath = 'times/2026-09/alice.jsonl';
  const original = entry('2026-08-31T08:00:00.000Z', '2026-08-31T09:00:00.000Z');
  seedText(github, oldPath, serializeMonthlyRecords([original]), 'monthly-sha');
  ensureTaskIndexFixture(github);
  store.value.recentCache = [{ ...original, _path: oldPath, _sha: 'monthly-sha', _index: 0 }];
  const clock = () => new Date('2026-09-02T12:00:00.000Z');
  const tracker = service({ github, store, clock });
  const request = { path: oldPath, originalSha: 'monthly-sha', index: 0, original,
    edits: { startedAt: '2026-09-01T08:00:00.000Z', endedAt: '2026-09-01T09:00:00.000Z' } };
  await tracker.queueEntryEdit(request);
  await tracker.editEntry(request, { updateCache: false });
  const commits = github.atomicWrites.length;
  await service({ github, store, clock }).syncPending();
  assert.deepEqual(store.value.pendingWrites, []);
  assert.equal(github.atomicWrites.length, commits);
  assert.equal(github.files.has(oldPath), false);
  assert.equal(parseMonthlyRecords(github.files.get(newPath).text, { user: 'alice', month: '2026-09' })[0].id, original.id);
});

test('retrying an entry edit already committed by GitHub is idempotent', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-08/alice.jsonl';
  const original = entry('2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z');
  seedText(github, path, serializeMonthlyRecords([original]), 'monthly-sha');
  ensureTaskIndexFixture(github);
  store.value.recentCache = [{ ...original, _path: path, _sha: 'monthly-sha', _index: 0 }];
  const tracker = service({ github, store });
  const request = { path, originalSha: 'monthly-sha', index: 0, original, edits: { description: 'Accepted locally' } };
  await tracker.queueEntryEdit(request);
  await tracker.editEntry(request, { updateCache: false });
  const commits = github.atomicWrites.length;
  await service({ github, store }).syncPending();
  assert.deepEqual(store.value.pendingWrites, []);
  assert.equal(github.atomicWrites.length, commits,
    'replayed acknowledgement should not produce another commit for the same already-saved change');
  assert.equal(store.value.recentCache[0].description, 'Accepted locally');
});

test('retrying a Delete already committed on GitHub adopts the result without conflict or a second commit', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-08/alice.jsonl';
  const original = entry('2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z');
  seedText(github, path, serializeMonthlyRecords([original]), 'monthly-sha');
  ensureTaskIndexFixture(github);
  store.value.recentCache = [{ ...original, _path: path, _sha: 'monthly-sha', _index: 0 }];
  const tracker = service({ github, store });
  const request = { path, originalSha: 'monthly-sha', index: 0, original };
  await tracker.queueEntryDelete(request);
  // Simulate a crash after the Git commit completed, before IndexedDB
  // could acknowledge the queued operation.
  await tracker.deleteEntry(request, { updateCache: false });
  const committed = github.atomicWrites.length;
  await service({ github, store }).syncPending();
  assert.deepEqual(store.value.pendingWrites, [], 'a completed delete must not remain a conflict');
  assert.equal(github.atomicWrites.length, committed, 'the retry must not create a duplicate GitHub commit');
  assert.deepEqual(store.value.recentCache, []);
  assert.equal(github.files.has(path), false);
});

test('delete acknowledgement must preserve a newer local edit to another record in the same file', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-08/alice.jsonl';
  const deleted = entry('2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z');
  const survivor = entry('2026-08-18T10:00:00.000Z', '2026-08-18T11:00:00.000Z');
  seedText(github, path, serializeMonthlyRecords([deleted, survivor]), 'seed-sha');
  ensureTaskIndexFixture(github);
  store.value.recentCache = [deleted, survivor].map((row, index) => ({ ...row, _path: path, _sha: 'seed-sha', _index: index }));
  const tracker = service({ github, store });
  await tracker.queueEntryDelete({ path, originalSha: 'seed-sha', index: 0, original: deleted });
  let entered, release;
  const started = new Promise(resolve => { entered = resolve; });
  const hold = new Promise(resolve => { release = resolve; });
  const write = github.updateTextsAtomic.bind(github);
  let blocked = false;
  github.updateTextsAtomic = async (...args) => {
    if (!blocked) { blocked = true; entered(); await hold; }
    return write(...args);
  };
  const syncing = tracker.syncPending();
  await started;
  try {
    await tracker.queueEntryEdit({ path, originalSha: 'seed-sha', index: 1, original: survivor,
      edits: { description: 'last accepted local version' } });
  } finally { release(); }
  await syncing;
  assert.equal(store.value.recentCache.find(row => row.id === survivor.id)?.description, 'last accepted local version');
  assert.equal(store.value.pendingWrites.length, 1);
  await tracker.syncPending();
  const [saved] = parseMonthlyRecords(github.files.get(path).text, { user: 'alice', month: '2026-08' });
  assert.equal(saved.description, 'last accepted local version');
});

test('delete acknowledgement must preserve a newly stopped timer queued during the same GitHub write', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-08/alice.jsonl';
  const old = entry('2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z');
  seedText(github, path, serializeMonthlyRecords([old]), 'seed-sha');
  ensureTaskIndexFixture(github);
  store.value.recentCache = [{ ...old, _path: path, _sha: 'seed-sha', _index: 0 }];
  const tracker = service({ github, store });
  await tracker.queueEntryDelete({ path, originalSha: 'seed-sha', index: 0, original: old });
  let entered, release;
  const started = new Promise(resolve => { entered = resolve; });
  const hold = new Promise(resolve => { release = resolve; });
  const write = github.updateTextsAtomic.bind(github);
  let blocked = false;
  github.updateTextsAtomic = async (...args) => {
    if (!blocked) { blocked = true; entered(); await hold; }
    return write(...args);
  };
  const syncing = tracker.syncPending();
  await started;
  let stopped;
  try {
    await tracker.queueStart('https://example.com/new', 'New task');
    stopped = await tracker.stop('', { background: true });
  } finally { release(); }
  await syncing;
  assert.ok(store.value.recentCache.some(row => row.id === stopped.entry.id),
    'an unsynced Stop must not vanish when an earlier deletion finishes');
  assert.ok(store.value.pendingWrites.some(item => item.operation === 'completeTimer'));
});

test('sync compacts superseded queued edits for the same completed entry into one remote write', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-08/alice.jsonl';
  const original = entry('2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z');
  seedText(github, path, serializeMonthlyRecords([original]), 'monthly-sha');
  ensureTaskIndexFixture(github);
  store.value.recentCache = [{ ...original, _path: path, _sha: 'monthly-sha', _index: 0 }];
  const tracker = service({ github, store, clock: () => new Date('2026-08-18T12:00:00.000Z') });

  await tracker.queueEntryEdit({
    path, originalSha: 'monthly-sha', index: 0, original,
    edits: { startedAt: '2026-08-18T08:15:00.000Z', endedAt: '2026-08-18T09:30:00.000Z' },
  });
  const first = structuredClone(store.value.pendingWrites[0]);
  store.value.pendingWrites.push({
    ...structuredClone(first), id: deterministicRecordId('2026-08-18T12:00:01.000Z'), queuedAt: '2026-08-18T12:00:01.000Z',
    request: {
      ...structuredClone(first.request),
      original: stripInternalForTest(store.value.recentCache[0]),
      edits: { endedAt: '2026-08-18T10:00:00.000Z', description: 'Final edit' },
    },
  });

  await tracker.syncPending();

  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(github.atomicWrites.length, 1);
  const [saved] = parseMonthlyRecords(github.files.get(path).text, { user: 'alice', month: '2026-08' });
  assert.equal(saved.startedAt, '2026-08-18T08:15:00.000Z');
  assert.equal(saved.endedAt, '2026-08-18T10:00:00.000Z');
  assert.equal(saved.description, 'Final edit');
});

test('Stop sync does not roll back a locally edited completion accepted while GitHub is writing', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), activePath = 'active/alice.json';
  const running = active('2026-08-18T08:00:00.000Z');
  seedText(github, activePath, serializeActiveRecord(running), 'active-sha');
  ensureTaskIndexFixture(github);
  store.value.activeCache = { ...running, _path: activePath, _sha: 'active-sha' };
  const tracker = service({ github, store });
  const stopped = await tracker.stop('', { background: true });
  let notifyStarted, release;
  const started = new Promise(resolve => { notifyStarted = resolve; });
  const hold = new Promise(resolve => { release = resolve; });
  const write = github.updateTextsAtomic.bind(github);
  let blocked = false;
  github.updateTextsAtomic = async (...args) => {
    if (!blocked) { blocked = true; notifyStarted(); await hold; }
    return write(...args);
  };
  const syncing = tracker.syncPending();
  await started;
  const pendingEntry = stopped.localEntry;
  try {
    await tracker.queueEntryEdit({ path: pendingEntry._path, originalSha: pendingEntry._sha,
      index: pendingEntry._index, original: pendingEntry, edits: { description: 'edited during Stop sync' } });
  } finally { release(); }
  await syncing;
  assert.equal(store.value.recentCache[0].description, 'edited during Stop sync',
    'completion acknowledgement must not put the older record back in the local UI');
  assert.equal(store.value.pendingWrites.length, 1);
  await tracker.syncPending();
  const saved = parseMonthlyRecords(github.files.get(pendingEntry._path).text, { user: 'alice', month: '2026-08' });
  assert.equal(saved[0].description, 'edited during Stop sync');
});

test('Stop sync cannot resurrect a completion deleted locally while GitHub was writing', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), activePath = 'active/alice.json';
  const running = active('2026-08-18T08:00:00.000Z');
  seedText(github, activePath, serializeActiveRecord(running), 'active-sha');
  ensureTaskIndexFixture(github);
  store.value.activeCache = { ...running, _path: activePath, _sha: 'active-sha' };
  const tracker = service({ github, store });
  const stopped = await tracker.stop('', { background: true });
  let notifyStarted, release;
  const started = new Promise(resolve => { notifyStarted = resolve; });
  const hold = new Promise(resolve => { release = resolve; });
  const write = github.updateTextsAtomic.bind(github);
  let blocked = false;
  github.updateTextsAtomic = async (...args) => {
    if (!blocked) { blocked = true; notifyStarted(); await hold; }
    return write(...args);
  };
  const syncing = tracker.syncPending();
  await started;
  const pendingEntry = stopped.localEntry;
  try {
    await tracker.queueEntryDelete({ path: pendingEntry._path, originalSha: pendingEntry._sha,
      index: pendingEntry._index, original: pendingEntry });
  } finally { release(); }
  await syncing;
  assert.deepEqual(store.value.recentCache, [], 'an accepted local Delete must remain invisible while the prior Stop commits');
  assert.equal(store.value.pendingWrites.length, 1);
  await tracker.syncPending();
  assert.equal(github.files.has(pendingEntry._path), false, 'GitHub eventually removes the completed entry');
});

test('new local edit during an in-flight GitHub write pauses later queued operations in the same repository', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-08/alice.jsonl';
  const one = entry('2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z');
  const two = entry('2026-08-18T10:00:00.000Z', '2026-08-18T11:00:00.000Z');
  seedText(github, path, serializeMonthlyRecords([one, two]), 'monthly-sha');
  ensureTaskIndexFixture(github);
  store.value.recentCache = [one, two].map((row, index) => ({ ...row, _path: path, _sha: 'monthly-sha', _index: index }));
  const tracker = service({ github, store });
  const request = (original, index, description) => ({
    path, originalSha: 'monthly-sha', index, original, edits: { description },
  });
  await tracker.queueEntryEdit(request(one, 0, 'first'));
  // Different operation types: this second change must not be folded into
  // the first GitHub commit's independent-edit batch.
  await tracker.queueEntriesEdit({ entries: [request(two, 1, 'second')] });
  let startedSignal, release;
  const started = new Promise(resolve => { startedSignal = resolve; });
  const hold = new Promise(resolve => { release = resolve; });
  const write = github.updateTextsAtomic.bind(github);
  let blocked = false;
  github.updateTextsAtomic = async (...args) => {
    if (!blocked) { blocked = true; startedSignal(); await hold; }
    return write(...args);
  };
  let quiet = true;
  const syncing = tracker.syncPending({ canSync: async () => quiet });
  await started;
  try {
    await tracker.queueEntryEdit(request(one, 0, 'last'));
    quiet = false;
  } finally { release(); }
  await syncing;
  assert.equal(github.atomicWrites.length, 1,
    'the second queued operation must not write during the new 15-second idle window');
  assert.equal(store.value.pendingWrites.length, 2);
  assert.equal(store.value.recentCache.find(row => row.id === one.id).description, 'last');
  quiet = true;
  await tracker.syncPending({ canSync: async () => quiet });
  assert.equal(store.value.pendingWrites.length, 0);
  const saved = parseMonthlyRecords(github.files.get(path).text, { user: 'alice', month: '2026-08' });
  assert.equal(saved.find(row => row.id === one.id).description, 'last');
  assert.equal(saved.find(row => row.id === two.id).description, 'second');
});

test('edit accepted during an in-flight GitHub commit is not deleted with the older queue item', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-08/alice.jsonl';
  const original = entry('2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z');
  seedText(github, path, serializeMonthlyRecords([original]), 'original-sha');
  ensureTaskIndexFixture(github);
  store.value.recentCache = [{ ...original, _path: path, _sha: 'original-sha', _index: 0 }];
  const tracker = service({ github, store, clock: () => new Date('2026-08-18T12:00:00.000Z') });
  let notifyStarted, release;
  const started = new Promise(resolve => { notifyStarted = resolve; });
  const hold = new Promise(resolve => { release = resolve; });
  const originalWrite = github.updateTextsAtomic.bind(github);
  let blocked = false;
  github.updateTextsAtomic = async (...args) => {
    if (!blocked) { blocked = true; notifyStarted(); await hold; }
    return originalWrite(...args);
  };
  const request = { path, originalSha: 'original-sha', index: 0, original };
  await tracker.queueEntryEdit({ ...request, edits: { description: 'first edit' } });
  const syncing = tracker.syncPending();
  await started;
  try {
    await tracker.queueEntryEdit({ ...request, edits: { description: 'second edit' } });
  } finally { release(); }
  await syncing;
  assert.equal(store.value.recentCache[0].description, 'second edit', 'a stale GitHub result must not overwrite a newer local edit');
  assert.equal(store.value.pendingWrites.length, 1, 'the edit accepted during sync still needs a GitHub write');
  await tracker.syncPending();
  const [saved] = parseMonthlyRecords(github.files.get(path).text, { user: 'alice', month: '2026-08' });
  assert.equal(saved.description, 'second edit');
  assert.deepEqual(store.value.pendingWrites, []);
});

test('linked edits accepted during remote sync are not erased when that sync finishes', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-08/alice.jsonl';
  const original = entry('2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z');
  seedText(github, path, serializeMonthlyRecords([original]), 'original-sha');
  ensureTaskIndexFixture(github);
  store.value.recentCache = [{ ...original, _path: path, _sha: 'original-sha', _index: 0 }];
  const tracker = service({ github, store });
  let notifyStarted, release;
  const started = new Promise(resolve => { notifyStarted = resolve; });
  const hold = new Promise(resolve => { release = resolve; });
  const originalWrite = github.updateTextsAtomic.bind(github);
  let blocked = false;
  github.updateTextsAtomic = async (...args) => {
    if (!blocked) { blocked = true; notifyStarted(); await hold; }
    return originalWrite(...args);
  };
  const request = { path, originalSha: 'original-sha', index: 0, original };
  await tracker.queueEntriesEdit({ entries: [{ ...request, edits: { description: 'first edit' } }] });
  const syncing = tracker.syncPending();
  await started;
  try {
    await tracker.queueEntriesEdit({ entries: [{ ...request, edits: { description: 'second edit' } }] });
  } finally { release(); }
  await syncing;
  assert.equal(store.value.recentCache[0].description, 'second edit');
  assert.equal(store.value.pendingWrites.length, 1, 'a newer linked edit remains queued');
  await tracker.syncPending();
  assert.equal(parseMonthlyRecords(github.files.get(path).text, { user: 'alice', month: '2026-08' })[0].description, 'second edit');
});

test('in-flight batch of independent edits cannot roll back a newer linked local edit', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-08/alice.jsonl';
  const one = entry('2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z');
  const two = entry('2026-08-18T10:00:00.000Z', '2026-08-18T11:00:00.000Z');
  seedText(github, path, serializeMonthlyRecords([one, two]), 'original-sha');
  ensureTaskIndexFixture(github);
  store.value.recentCache = [one, two].map((row, index) => ({ ...row, _path: path, _sha: 'original-sha', _index: index }));
  const tracker = service({ github, store });
  const request = (original, index, description) => ({ path, originalSha: 'original-sha', index, original, edits: { description } });
  await tracker.queueEntryEdit(request(one, 0, 'first'));
  await tracker.queueEntryEdit(request(two, 1, 'other'));
  let notifyStarted, release;
  const started = new Promise(resolve => { notifyStarted = resolve; });
  const hold = new Promise(resolve => { release = resolve; });
  const originalWrite = github.updateTextsAtomic.bind(github);
  let blocked = false;
  github.updateTextsAtomic = async (...args) => {
    if (!blocked) { blocked = true; notifyStarted(); await hold; }
    return originalWrite(...args);
  };
  const syncing = tracker.syncPending();
  await started;
  try {
    await tracker.queueEntriesEdit({ entries: [request(one, 0, 'final')] });
  } finally { release(); }
  await syncing;
  assert.equal(store.value.recentCache.find(row => row.id === one.id).description, 'final');
  assert.equal(store.value.pendingWrites.length, 1);
  await tracker.syncPending();
  assert.equal(parseMonthlyRecords(github.files.get(path).text, { user: 'alice', month: '2026-08' })[0].description, 'final');
});

test('active timer edit accepted during GitHub sync remains queued and locally authoritative', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), original = active('2026-08-18T08:00:00.000Z');
  seedText(github, 'active/alice.json', serializeActiveRecord(original), 'active-sha');
  store.value.activeCache = { ...original, _path: 'active/alice.json', _sha: 'active-sha' };
  const tracker = service({ github, store });
  let notifyStarted, release;
  const started = new Promise(resolve => { notifyStarted = resolve; });
  const hold = new Promise(resolve => { release = resolve; });
  const originalWrite = github.putText.bind(github);
  let blocked = false;
  github.putText = async (...args) => {
    if (args[0] === 'active/alice.json' && !blocked) { blocked = true; notifyStarted(); await hold; }
    return originalWrite(...args);
  };
  const originalIdentity = { id: original.id, startedAt: original.startedAt };
  await tracker.queueActiveStartEdit({ original: originalIdentity, description: 'first edit' });
  const syncing = tracker.syncPending();
  await started;
  try {
    await tracker.queueActiveStartEdit({ original: originalIdentity, description: 'second edit' });
  } finally { release(); }
  await syncing;
  assert.equal(store.value.activeCache.description, 'second edit');
  assert.equal(store.value.pendingWrites.length, 1, 'newer timer edit must survive the first commit');
  await tracker.syncPending();
  assert.equal(parseActiveRecord(github.files.get('active/alice.json').text, { user: 'alice' }).description, 'second edit');
});

test('coalesced local edits persist the latest acceptance time without resetting the original queue timestamp', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-08/alice.jsonl';
  const original = entry('2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z');
  seedText(github, path, serializeMonthlyRecords([original]), 'monthly-sha');
  store.value.recentCache = [{ ...original, _path: path, _sha: 'monthly-sha', _index: 0 }];
  let now = new Date('2026-08-18T12:00:00.000Z');
  const tracker = service({ github, store, clock: () => now });
  await tracker.queueEntryEdit({ path, originalSha: 'monthly-sha', index: 0, original, edits: { startedAt: '2026-08-18T08:10:00.000Z' } });
  assert.equal(store.value.pendingWrites[0].lastLocalEditAt, now.toISOString());
  const queuedAt = store.value.pendingWrites[0].queuedAt;
  now = new Date('2026-08-18T12:00:10.000Z');
  await tracker.queueEntryEdit({ path, originalSha: 'monthly-sha', index: 0, original, edits: { endedAt: '2026-08-18T09:10:00.000Z' } });
  assert.equal(store.value.pendingWrites.length, 1);
  assert.equal(store.value.pendingWrites[0].queuedAt, queuedAt);
  assert.equal(store.value.pendingWrites[0].lastLocalEditAt, now.toISOString(),
    'the next 15-second countdown begins after the most recent local edit');

  const linked = service({ github, store, clock: () => now });
  await linked.queueEntriesEdit({ entries: [{ path, originalSha: 'monthly-sha', index: 0,
    original: store.value.recentCache[0], edits: { description: 'First' } }] });
  now = new Date('2026-08-18T12:00:14.000Z');
  await linked.queueEntriesEdit({ entries: [{ path, originalSha: 'monthly-sha', index: 0,
    original: store.value.recentCache[0], edits: { description: 'Second' } }] });
  const last = store.value.pendingWrites.at(-1);
  assert.equal(last.operation, 'editEntries');
  assert.equal(last.lastLocalEditAt, now.toISOString());
});

test('successive accepted timeline edits survive a worker restart with the latest interval', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-08/alice.jsonl';
  const original = entry('2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z');
  seedText(github, path, serializeMonthlyRecords([original]), 'monthly-sha');
  ensureTaskIndexFixture(github);
  store.value.recentCache = [{ ...original, _path: path, _sha: 'monthly-sha', _index: 0 }];
  const tracker = service({ github, store, clock: () => new Date('2026-08-18T12:00:00.000Z') });
  const request = { path, originalSha: 'monthly-sha', index: 0, original };
  const first = await tracker.queueEntryEdit({ ...request, edits: { startedAt: '2026-08-18T08:05:00.000Z', endedAt: '2026-08-18T09:05:00.000Z' } });
  const second = await tracker.queueEntryEdit({ ...request, edits: { startedAt: '2026-08-18T08:10:00.000Z', endedAt: '2026-08-18T09:10:00.000Z' } });
  assert.equal(second.operationId, first.operationId);
  assert.equal(store.value.pendingWrites.length, 1);
  assert.deepEqual(store.value.pendingWrites[0].request.edits, { startedAt: '2026-08-18T08:10:00.000Z', endedAt: '2026-08-18T09:10:00.000Z' });
  assert.equal(store.value.recentCache[0]._pending, true);
  assert.equal(store.value.recentCache[0].startedAt, '2026-08-18T08:10:00.000Z');
  await service({ github, store, clock: () => new Date('2026-08-18T12:00:00.000Z') }).syncPending();
  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(github.atomicWrites.length, 1);
  const [saved] = parseMonthlyRecords(github.files.get(path).text, { user: 'alice', month: '2026-08' });
  assert.equal(saved.startedAt, '2026-08-18T08:10:00.000Z');
  assert.equal(saved.endedAt, '2026-08-18T09:10:00.000Z');
});

test('queue compaction uses the latest accepted snapshot instead of combining incompatible timestamps', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-08/alice.jsonl';
  const original = entry('2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z');
  seedText(github, path, serializeMonthlyRecords([original]), 'monthly-sha');
  ensureTaskIndexFixture(github);
  store.value.recentCache = [{ ...original, _path: path, _sha: 'monthly-sha', _index: 0 }];
  const tracker = service({ github, store, clock: () => new Date('2026-08-18T12:00:00.000Z') });

  await tracker.queueEntryEdit({
    path, originalSha: 'monthly-sha', index: 0, original,
    edits: { startedAt: '2026-08-18T08:50:00.000Z' },
  });
  const first = structuredClone(store.value.pendingWrites[0]);
  store.value.pendingWrites.push({
    ...structuredClone(first), id: deterministicRecordId('2026-08-18T12:00:01.000Z'), queuedAt: '2026-08-18T12:00:01.000Z',
    request: {
      ...structuredClone(first.request), original: structuredClone(original),
      edits: { endedAt: '2026-08-18T08:10:00.000Z' },
    },
  });

  await tracker.syncPending();

  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(github.atomicWrites.length, 1);
  const [saved] = parseMonthlyRecords(github.files.get(path).text, { user: 'alice', month: '2026-08' });
  assert.equal(saved.startedAt, original.startedAt);
  assert.equal(saved.endedAt, '2026-08-18T08:10:00.000Z');
});

test('sync repairs an inverted interval persisted by the previous compaction algorithm from the optimistic cache', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-08/alice.jsonl';
  const original = entry('2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z');
  const intended = { ...original, endedAt: '2026-08-18T08:10:00.000Z', durationSeconds: 600 };
  seedText(github, path, serializeMonthlyRecords([original]), 'monthly-sha');
  ensureTaskIndexFixture(github);
  store.value.recentCache = [{ ...intended, _path: path, _sha: 'monthly-sha', _index: 0, _pending: true }];
  const tracker = service({ github, store, clock: () => new Date('2026-08-18T12:00:00.000Z') });
  await tracker.queueEntryEdit({
    path, originalSha: 'monthly-sha', index: 0, original,
    edits: { description: 'placeholder' },
  });
  Object.assign(store.value.pendingWrites[0], {
    status: 'conflict', conflictReason: 'queued_write_validation',
    request: {
      path, originalSha: 'monthly-sha', index: 0, original,
      edits: { startedAt: '2026-08-18T08:50:00.000Z', endedAt: intended.endedAt },
    },
  });

  await tracker.syncPending();

  assert.equal(store.value.pendingWrites.length, 0);
  const [saved] = parseMonthlyRecords(github.files.get(path).text, { user: 'alice', month: '2026-08' });
  assert.equal(saved.startedAt, intended.startedAt);
  assert.equal(saved.endedAt, intended.endedAt);
});

test('sync does not discard a malformed saved edit when only a fresh remote cache snapshot remains', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-08/alice.jsonl';
  const original = entry('2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z');
  seedText(github, path, serializeMonthlyRecords([original]), 'monthly-sha');
  ensureTaskIndexFixture(github);
  store.value.recentCache = [{ ...original, _path: path, _sha: 'monthly-sha', _index: 0 }];
  const tracker = service({ github, store, clock: () => new Date('2026-08-18T12:00:00.000Z') });
  await tracker.queueEntryEdit({ path, originalSha: 'monthly-sha', index: 0, original, edits: { description: 'placeholder' } });
  Object.assign(store.value.pendingWrites[0], {
    status: 'conflict', conflictReason: 'queued_write_validation',
    request: {
      path, originalSha: 'monthly-sha', index: 0, original,
      edits: { startedAt: '2026-08-18T08:50:00.000Z', endedAt: '2026-08-18T08:10:00.000Z' },
    },
  });
  store.value.recentCache[0] = { ...original, _path: path, _sha: 'monthly-sha', _index: 0 };

  await tracker.syncPending();

  assert.equal(store.value.pendingWrites.length, 1);
  assert.equal(store.value.pendingWrites[0].status, 'conflict');
  assert.equal(store.value.pendingWrites[0].conflictReason, 'queued_write_validation');
  assert.equal(github.atomicWrites.length, 0);

  const retried = await tracker.resolvePendingConflict(store.value.pendingWrites[0].id);

  assert.deepEqual(retried, { resolved: false });
  assert.equal(store.value.pendingWrites.length, 1);
  assert.equal(store.value.pendingWrites[0].status, 'conflict');
  assert.equal(store.value.pendingWrites[0].conflictReason, 'queued_write_validation');
  assert.equal(github.atomicWrites.length, 0);
});

test('sync keeps only the latest queued start adjustment for one active timer', async () => {
  const github = new FakeGitHub(), store = new MemoryStore();
  const original = active('2026-08-18T08:00:00.000Z');
  seedText(github, 'active/alice.json', serializeActiveRecord(original), 'active-sha');
  store.value.activeCache = { ...original, _path: 'active/alice.json', _sha: 'active-sha' };
  const tracker = service({ github, store, clock: () => new Date('2026-08-18T12:00:00.000Z') });

  await tracker.queueActiveStartEdit({ original: { id: original.id, startedAt: original.startedAt }, startedAt: '2026-08-18T09:00:00.000Z' });
  const first = structuredClone(store.value.pendingWrites[0]);
  store.value.pendingWrites.push({
    ...structuredClone(first), id: deterministicRecordId('2026-08-18T12:00:01.000Z'), queuedAt: '2026-08-18T12:00:01.000Z',
    original: { id: original.id, startedAt: '2026-08-18T09:00:00.000Z' }, startedAt: '2026-08-18T09:30:00.000Z',
  });

  await tracker.syncPending();

  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(github.atomicWrites.filter(write => write.changes.some(change => change.path === 'active/alice.json')).length, 1);
  assert.equal(parseActiveRecord(github.files.get('active/alice.json').text, { user: 'alice' }).startedAt, '2026-08-18T09:30:00.000Z');
});

test('queued running start and description edits coalesce and persist together', async () => {
  const github = new FakeGitHub(), store = new MemoryStore();
  const original = active('2026-08-18T08:00:00.000Z');
  seedText(github, 'active/alice.json', serializeActiveRecord(original), 'active-sha');
  store.value.activeCache = { ...original, _path: 'active/alice.json', _sha: 'active-sha' };
  const tracker = service({ github, store, clock: () => new Date('2026-08-18T12:00:00.000Z') });

  await tracker.queueActiveStartEdit({ original: { id: original.id, startedAt: original.startedAt }, startedAt: '2026-08-18T09:00:00.000Z' });
  await tracker.queueActiveStartEdit({ original: { id: original.id, startedAt: '2026-08-18T09:00:00.000Z' }, description: 'Saved on blur' });
  assert.equal(store.value.pendingWrites.length, 1);
  assert.equal(store.value.pendingWrites[0].startedAt, '2026-08-18T09:00:00.000Z');
  assert.equal(store.value.pendingWrites[0].description, 'Saved on blur');

  await tracker.syncPending();
  const saved = parseActiveRecord(github.files.get('active/alice.json').text, { user: 'alice' });
  assert.equal(saved.startedAt, '2026-08-18T09:00:00.000Z');
  assert.equal(saved.description, 'Saved on blur');
});

test('restart adopts an active-timer edit already committed to GitHub before local acknowledgement', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'active/alice.json';
  const original = active('2026-08-18T08:00:00.000Z');
  seedText(github, path, serializeActiveRecord(original), 'active-sha');
  store.value.activeCache = { ...original, _path: path, _sha: 'active-sha' };
  const tracker = service({ github, store });
  const newStart = '2026-08-18T08:30:00.000Z';
  await tracker.queueActiveStartEdit({ original: { id: original.id, startedAt: original.startedAt },
    startedAt: newStart, description: 'Updated before crash' });
  const alreadySaved = { ...original, startedAt: newStart, createdAt: newStart, description: 'Updated before crash', updatedAt: '2026-08-18T12:00:00.000Z' };
  await github.putText(path, serializeActiveRecord(alreadySaved), 'simulated completed but unacknowledged write', 'active-sha');
  const writes = github.writes.length;

  // The service worker was stopped after GitHub saved, but before it removed
  // the durable operation from IndexedDB. The retry must converge harmlessly.
  const resumed = service({ github, store });
  await resumed.syncPending();
  assert.deepEqual(store.value.pendingWrites, []);
  assert.equal(store.value.activeCache.startedAt, newStart);
  assert.equal(store.value.activeCache.description, 'Updated before crash');
  assert.equal(github.writes.length, writes, 'idempotent retry must not create another GitHub commit');
});

test('restart compaction preserves active fields changed by separate persisted edits', async () => {
  const github = new FakeGitHub(), store = new MemoryStore();
  const original = active('2026-08-18T08:00:00.000Z');
  seedText(github, 'active/alice.json', serializeActiveRecord(original), 'active-sha');
  store.value.activeCache = { ...original, _path: 'active/alice.json', _sha: 'active-sha' };
  const tracker = service({ github, store, clock: () => new Date('2026-08-18T12:00:00.000Z') });

  await tracker.queueActiveStartEdit({
    original: { id: original.id, startedAt: original.startedAt },
    startedAt: '2026-08-18T09:00:00.000Z',
  });
  const later = {
    ...structuredClone(store.value.pendingWrites[0]),
    id: deterministicRecordId('2026-08-18T12:00:01.000Z'),
    queuedAt: '2026-08-18T12:00:01.000Z',
    original: { id: original.id, startedAt: '2026-08-18T09:00:00.000Z' },
    description: 'Saved after restart',
  };
  delete later.startedAt;
  store.value.pendingWrites.push(later);

  await tracker.syncPending();

  const saved = parseActiveRecord(github.files.get('active/alice.json').text, { user: 'alice' });
  assert.equal(github.atomicWrites.filter(write => write.changes.some(change => change.path === 'active/alice.json')).length, 1);
  assert.equal(saved.startedAt, '2026-08-18T09:00:00.000Z');
  assert.equal(saved.description, 'Saved after restart');
});

test('queue compaction never crosses a timer lifecycle barrier', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-08/alice.jsonl';
  const original = entry('2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z');
  seedText(github, path, serializeMonthlyRecords([original]), 'monthly-sha');
  store.value.recentCache = [{ ...original, _path: path, _sha: 'monthly-sha', _index: 0 }];
  const tracker = service({ github, store, clock: () => new Date('2026-08-18T12:00:00.000Z') });
  await tracker.queueEntryEdit({ path, originalSha: 'monthly-sha', index: 0, original, edits: { endedAt: '2026-08-18T09:30:00.000Z' } });
  const first = structuredClone(store.value.pendingWrites[0]);
  store.value.pendingWrites.push(
    { operation: 'completeTimer', id: deterministicRecordId('2026-08-18T12:00:01.000Z'), status: 'pending', stage: 'verifyActive' },
    { ...structuredClone(first), id: deterministicRecordId('2026-08-18T12:00:02.000Z'), queuedAt: '2026-08-18T12:00:02.000Z', request: { ...structuredClone(first.request), edits: { endedAt: '2026-08-18T10:00:00.000Z' } } },
  );

  const compacted = await tracker.compactPendingQueue();

  assert.equal(compacted.length, 3);
  assert.deepEqual(compacted.map(operation => operation.operation), ['editEntry', 'completeTimer', 'editEntry']);
});

test('enqueue-time single-entry coalescing never crosses a timer lifecycle barrier', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-08/alice.jsonl';
  const original = entry('2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z');
  seedText(github, path, serializeMonthlyRecords([original]), 'monthly-sha');
  store.value.recentCache = [{ ...original, _path: path, _sha: 'monthly-sha', _index: 0 }];
  const tracker = service({ github, store, clock: () => new Date('2026-08-18T12:00:00.000Z') });
  const firstAccepted = await tracker.queueEntryEdit({ path, originalSha: 'monthly-sha', index: 0, original, edits: { endedAt: '2026-08-18T09:30:00.000Z' } });
  store.value.pendingWrites.push({ operation: 'completeTimer', id: deterministicRecordId('2026-08-18T12:00:01.000Z'), status: 'pending', stage: 'verifyActive' });

  const secondAccepted = await tracker.queueEntryEdit({
    path, originalSha: 'monthly-sha', index: 0, original: stripInternalForTest(store.value.recentCache[0]),
    edits: { endedAt: '2026-08-18T10:00:00.000Z' },
  });

  assert.deepEqual(store.value.pendingWrites.map(operation => operation.operation), ['editEntry', 'completeTimer', 'editEntry']);
  assert.notEqual(secondAccepted.operationId, firstAccepted.operationId);
  assert.equal(secondAccepted.operationId, store.value.pendingWrites[2].id);
  assert.equal(store.value.pendingWrites[0].request.edits.endedAt, '2026-08-18T09:30:00.000Z');
  assert.equal(store.value.pendingWrites[2].request.edits.endedAt, '2026-08-18T10:00:00.000Z');
});

test('enqueue-time linked-entry coalescing never crosses a timer lifecycle barrier', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-08/alice.jsonl';
  const original = entry('2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z');
  seedText(github, path, serializeMonthlyRecords([original]), 'monthly-sha');
  store.value.recentCache = [{ ...original, _path: path, _sha: 'monthly-sha', _index: 0 }];
  const tracker = service({ github, store, clock: () => new Date('2026-08-18T12:00:00.000Z') });
  const firstAccepted = await tracker.queueEntriesEdit({ entries: [{ path, originalSha: 'monthly-sha', index: 0, original, edits: { endedAt: '2026-08-18T09:30:00.000Z' } }] });
  store.value.pendingWrites.push({ operation: 'completeTimer', id: deterministicRecordId('2026-08-18T12:00:01.000Z'), status: 'pending', stage: 'verifyActive' });

  const secondAccepted = await tracker.queueEntriesEdit({ entries: [{
    path, originalSha: 'monthly-sha', index: 0, original: stripInternalForTest(store.value.recentCache[0]),
    edits: { endedAt: '2026-08-18T10:00:00.000Z' },
  }] });

  assert.deepEqual(store.value.pendingWrites.map(operation => operation.operation), ['editEntries', 'completeTimer', 'editEntries']);
  assert.notEqual(secondAccepted.operationId, firstAccepted.operationId);
  assert.equal(secondAccepted.operationId, store.value.pendingWrites[2].id);
  assert.equal(store.value.pendingWrites[0].request.entries[0].edits.endedAt, '2026-08-18T09:30:00.000Z');
  assert.equal(store.value.pendingWrites[2].request.entries[0].edits.endedAt, '2026-08-18T10:00:00.000Z');
});

test('sync preserves the final optimistic cache while a later edit remains behind a blocked lifecycle barrier', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-08/alice.jsonl';
  const original = entry('2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z');
  seedText(github, path, serializeMonthlyRecords([original]), 'monthly-sha');
  ensureTaskIndexFixture(github);
  store.value.recentCache = [{ ...original, _path: path, _sha: 'monthly-sha', _index: 0 }];
  const tracker = service({ github, store, clock: () => new Date('2026-08-18T12:00:00.000Z') });
  await tracker.queueEntryEdit({ path, originalSha: 'monthly-sha', index: 0, original, edits: { endedAt: '2026-08-18T09:30:00.000Z' } });
  store.value.pendingWrites.push({
    operation: 'completeTimer', id: deterministicRecordId('2026-08-18T12:00:01.000Z'),
    status: 'conflict', stage: 'verifyActive', conflictReason: 'active_changed_no_completion',
  });
  await tracker.queueEntryEdit({
    path, originalSha: 'monthly-sha', index: 0, original: stripInternalForTest(store.value.recentCache[0]),
    edits: { endedAt: '2026-08-18T10:00:00.000Z' },
  });

  await tracker.syncPending();

  assert.deepEqual(store.value.pendingWrites.map(operation => operation.operation), ['completeTimer', 'editEntry']);
  assert.equal(store.value.recentCache[0].endedAt, '2026-08-18T10:00:00.000Z');
  assert.equal(store.value.recentCache[0]._pending, true);
  const [persisted] = parseMonthlyRecords(github.files.get(path).text, { user: 'alice', month: '2026-08' });
  assert.equal(persisted.endedAt, '2026-08-18T09:30:00.000Z');
});

test('later queued edit follows an earlier cross-month move after its lifecycle barrier clears', async () => {
  const github = new FakeGitHub(), store = new MemoryStore();
  const august = 'times/2026-08/alice.jsonl', september = 'times/2026-09/alice.jsonl';
  const original = entry('2026-08-31T23:00:00.000Z', '2026-08-31T23:30:00.000Z');
  seedText(github, august, serializeMonthlyRecords([original]), 'august-sha');
  ensureTaskIndexFixture(github);
  store.value.recentCache = [{ ...original, _path: august, _sha: 'august-sha', _index: 0 }];
  const tracker = service({ github, store, clock: () => new Date('2026-09-01T12:00:00.000Z') });
  await tracker.queueEntryEdit({
    path: august, originalSha: 'august-sha', index: 0, original,
    edits: { startedAt: '2026-09-01T00:00:00.000Z', endedAt: '2026-09-01T00:30:00.000Z' },
  });
  const barrierId = deterministicRecordId('2026-09-01T12:00:01.000Z');
  store.value.pendingWrites.push({
    operation: 'completeTimer', id: barrierId, status: 'conflict', stage: 'verifyActive',
    conflictReason: 'active_changed_no_completion',
  });
  await tracker.queueEntryEdit({
    path: august, originalSha: 'august-sha', index: 0, original: stripInternalForTest(store.value.recentCache[0]),
    edits: { endedAt: '2026-09-01T01:00:00.000Z' },
  });

  await tracker.syncPending();
  store.value.pendingWrites = store.value.pendingWrites.filter(operation => operation.id !== barrierId);
  await tracker.syncPending();

  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(github.files.has(august), false);
  const [persisted] = parseMonthlyRecords(github.files.get(september).text, { user: 'alice', month: '2026-09' });
  assert.equal(persisted.startedAt, '2026-09-01T00:00:00.000Z');
  assert.equal(persisted.endedAt, '2026-09-01T01:00:00.000Z');
});

test('queued entry edit automatically rebases onto the latest Activity file without surfacing a conflict', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-08/alice.jsonl';
  const original = entry('2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z');
  seedText(github, path, serializeMonthlyRecords([original]), 'monthly-sha');
  ensureTaskIndexFixture(github);
  store.value.recentCache = [{ ...original, _path: path, _sha: 'monthly-sha', _index: 0 }];
  const tracker = service({ github, store, clock: () => new Date('2026-08-18T12:00:00.000Z') });

  const accepted = await tracker.queueEntryEdit({
    path, originalSha: 'monthly-sha', index: 0, original, edits: { endedAt: '2026-08-18T10:00:00.000Z' },
  });
  const remotelyUpdated = { ...original, description: 'Edited elsewhere', updatedAt: '2026-08-18T11:00:00.000Z' };
  seedText(github, path, serializeMonthlyRecords([remotelyUpdated]), 'newer-sha');

  await tracker.syncPending();
  assert.equal(store.value.pendingWrites.length, 0);
  const [saved] = parseMonthlyRecords(github.files.get(path).text, { user: 'alice', month: '2026-08' });
  assert.equal(saved.endedAt, '2026-08-18T10:00:00.000Z');
  assert.equal(saved.description, 'Edited elsewhere');
});

test('rebase that makes a saved edit interval invalid stops as a terminal conflict without writing', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-08/alice.jsonl';
  const original = entry('2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z');
  seedText(github, path, serializeMonthlyRecords([original]), 'monthly-sha');
  ensureTaskIndexFixture(github);
  store.value.recentCache = [{ ...original, _path: path, _sha: 'monthly-sha', _index: 0 }];
  const tracker = service({ github, store, clock: () => new Date('2026-08-18T12:00:00.000Z') });
  await tracker.queueEntryEdit({
    path, originalSha: 'monthly-sha', index: 0, original,
    edits: { endedAt: '2026-08-18T08:30:00.000Z' },
  });
  const remotelyUpdated = {
    ...original,
    startedAt: '2026-08-18T08:45:00.000Z',
    durationSeconds: 900,
    updatedAt: '2026-08-18T11:00:00.000Z',
  };
  seedText(github, path, serializeMonthlyRecords([remotelyUpdated]), 'newer-sha');

  await tracker.syncPending();

  assert.equal(store.value.pendingWrites.length, 1);
  assert.equal(store.value.pendingWrites[0].status, 'conflict');
  assert.equal(store.value.pendingWrites[0].conflictReason, 'queued_write_validation');
  assert.equal(github.atomicWrites.length, 0);
  const [persisted] = parseMonthlyRecords(github.files.get(path).text, { user: 'alice', month: '2026-08' });
  assert.equal(persisted.startedAt, remotelyUpdated.startedAt);
  assert.equal(persisted.endedAt, remotelyUpdated.endedAt);
});

test('a persisted queued-entry conflict is automatically retried on the next background sync', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-08/alice.jsonl';
  const original = entry('2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z');
  seedText(github, path, serializeMonthlyRecords([original]), 'monthly-sha');
  ensureTaskIndexFixture(github);
  store.value.recentCache = [{ ...original, _path: path, _sha: 'monthly-sha', _index: 0 }];
  const tracker = service({ github, store, clock: () => new Date('2026-08-18T12:00:00.000Z') });
  await tracker.queueEntryEdit({
    path, originalSha: 'monthly-sha', index: 0, original, edits: { endedAt: '2026-08-18T10:00:00.000Z' },
  });
  store.value.pendingWrites[0].status = 'conflict';
  store.value.pendingWrites[0].conflictReason = 'queued_entry_edit_conflict';
  const remotelyUpdated = { ...original, description: 'Edited elsewhere', updatedAt: '2026-08-18T11:00:00.000Z' };
  seedText(github, path, serializeMonthlyRecords([remotelyUpdated]), 'newer-sha');

  await tracker.syncPending();

  assert.equal(store.value.pendingWrites.length, 0);
  const [saved] = parseMonthlyRecords(github.files.get(path).text, { user: 'alice', month: '2026-08' });
  assert.equal(saved.endedAt, '2026-08-18T10:00:00.000Z');
  assert.equal(saved.description, 'Edited elsewhere');
});

test('queued entry edit conflict can be discarded without changing current Activity data', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-08/alice.jsonl';
  const original = entry('2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z');
  seedText(github, path, serializeMonthlyRecords([original]), 'monthly-sha');
  ensureTaskIndexFixture(github);
  store.value.recentCache = [{ ...original, _path: path, _sha: 'monthly-sha', _index: 0 }];
  const tracker = service({ github, store });
  const accepted = await tracker.queueEntryEdit({ path, originalSha: 'monthly-sha', index: 0, original, edits: { description: 'Discard me' } });
  seedText(github, path, serializeMonthlyRecords([]), 'newer-sha');
  await tracker.syncPending();

  assert.deepEqual(await tracker.resolvePendingConflict(accepted.operationId, 'discard_queued_edit'), { resolved: true, discarded: true });
  assert.equal(store.value.pendingWrites.length, 0);
  assert.deepEqual(parseMonthlyRecords(github.files.get(path).text, { user: 'alice', month: '2026-08' }), []);
});

test('queued linked-entry edits update local cache together and persist in one atomic write', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-08/alice.jsonl';
  const first = entry('2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z');
  const second = entry('2026-08-18T09:00:00.000Z', '2026-08-18T10:00:00.000Z');
  seedText(github, path, serializeMonthlyRecords([first, second]), 'monthly-sha');
  ensureTaskIndexFixture(github);
  store.value.recentCache = [
    { ...first, _path: path, _sha: 'monthly-sha', _index: 0 },
    { ...second, _path: path, _sha: 'monthly-sha', _index: 1 },
  ];
  const tracker = service({ github, store, clock: () => new Date('2026-08-18T12:00:00.000Z') });

  const accepted = await tracker.queueEntriesEdit({ entries: [
    { path, originalSha: 'monthly-sha', index: 0, original: first, edits: { endedAt: '2026-08-18T09:01:00.000Z' } },
    { path, originalSha: 'monthly-sha', index: 1, original: second, edits: { startedAt: '2026-08-18T09:01:00.000Z' } },
  ] });

  assert.equal(accepted.pending, true);
  assert.equal(github.atomicWrites.length, 0);
  assert.equal(store.value.pendingWrites.length, 1);
  const coalesced = await tracker.queueEntriesEdit({ entries: [
    { path, originalSha: 'monthly-sha', index: 0, original: first, edits: { endedAt: '2026-08-18T09:02:00.000Z' } },
    { path, originalSha: 'monthly-sha', index: 1, original: second, edits: { startedAt: '2026-08-18T09:02:00.000Z' } },
  ] });
  assert.equal(coalesced.operationId, accepted.operationId);
  assert.equal(store.value.pendingWrites.length, 1);
  assert.equal(store.value.pendingWrites[0].request.entries.length, 2);
  assert.equal(store.value.recentCache[0].endedAt, '2026-08-18T09:02:00.000Z');
  assert.equal(store.value.recentCache[1].startedAt, '2026-08-18T09:02:00.000Z');
  await tracker.syncPending();
  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(github.atomicWrites.length, 1);
  const saved = parseMonthlyRecords(github.files.get(path).text, { user: 'alice', month: '2026-08' });
  assert.equal(saved[0].endedAt, '2026-08-18T09:02:00.000Z');
  assert.equal(saved[1].startedAt, '2026-08-18T09:02:00.000Z');
});

test('queued completed edits cannot extend into a running timer, including after restart', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-08/alice.jsonl';
  const completed = entry('2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z');
  const running = active('2026-08-18T10:00:00.000Z');
  seedText(github, path, serializeMonthlyRecords([completed]), 'monthly-sha');
  store.value.recentCache = [{ ...completed, _path: path, _sha: 'monthly-sha', _index: 0 }];
  store.value.activeCache = { ...running, _path: 'active/alice.json', _sha: 'active-sha' };
  const tracker = service({ github, store, clock: () => new Date('2026-08-18T12:00:00.000Z') });
  const request = { path, originalSha: 'monthly-sha', index: 0, original: completed,
    edits: { endedAt: '2026-08-18T10:30:00.000Z' } };
  await assert.rejects(() => tracker.queueEntryEdit(request), /overlap.*running timer/i);
  await assert.rejects(() => service({ github, store }).queueEntriesEdit({ entries: [request] }), /overlap.*running timer/i);
  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(store.value.recentCache[0].endedAt, completed.endedAt);
  await tracker.queueEntriesEdit({ entries: [{ ...request, edits: { endedAt: running.startedAt } }] });
  assert.equal(store.value.recentCache[0].endedAt, running.startedAt);
});

test('queued edits reject a running timer present on GitHub but missing from the local snapshot', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-08/alice.jsonl';
  const completed = entry('2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z');
  const running = active('2026-08-18T10:00:00.000Z');
  seedText(github, path, serializeMonthlyRecords([completed]), 'monthly-sha');
  seedText(github, 'active/alice.json', serializeActiveRecord(running), 'active-sha');
  store.value.recentCache = [{ ...completed, _path: path, _sha: 'monthly-sha', _index: 0 }];
  const tracker = service({ github, store, clock: () => new Date('2026-08-18T12:00:00.000Z') });
  const request = { path, originalSha: 'monthly-sha', index: 0, original: completed,
    edits: { endedAt: '2026-08-18T10:30:00.000Z' } };
  await assert.rejects(() => tracker.queueEntryEdit(request), /overlap.*running timer/i);
  await assert.rejects(() => service({ github, store }).queueEntriesEdit({ entries: [request] }), /overlap.*running timer/i);
  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(store.value.recentCache[0].endedAt, completed.endedAt);
  assert.equal(github.atomicWrites.length, 0);
  const getText = github.getText.bind(github);
  github.getText = async requested => {
    if (requested === 'active/alice.json') throw new Error('Timer read unavailable');
    return getText(requested);
  };
  await assert.rejects(() => tracker.queueEntryEdit(request), /Timer read unavailable/);
  assert.equal(store.value.pendingWrites.length, 0);
  github.getText = getText;
  await tracker.queueEntryEdit({ ...request, edits: { description: 'Corrected' } });
  assert.equal(store.value.pendingWrites.length, 1);
});

test('direct completed edit rejects an overlap with remote active without writing', async () => {
  const github = new FakeGitHub(), path = 'times/2026-08/alice.jsonl';
  const completed = entry('2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z');
  const running = active('2026-08-18T10:00:00.000Z');
  seedText(github, path, serializeMonthlyRecords([completed]), 'monthly-sha');
  seedText(github, 'active/alice.json', serializeActiveRecord(running), 'active-sha');
  const tracker = service({ github, clock: () => new Date('2026-08-18T12:00:00.000Z') });
  const request = { path, originalSha: 'monthly-sha', index: 0, original: completed,
    edits: { endedAt: '2026-08-18T10:30:00.000Z' } };
  await assert.rejects(() => tracker.editEntry(request), /overlap.*running timer/i);
  await assert.rejects(() => tracker.editEntries({ entries: [request] }), /overlap.*running timer/i);
  assert.equal(github.atomicWrites.length, 0);
  assert.equal(github.files.get(path).sha, 'monthly-sha');
});

test('an idle-looking local state reports the remote timer boundary on a rejected edit', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-10/alice.jsonl';
  const first = entry('2026-10-27T08:00:00.000Z', '2026-10-27T11:13:00.000Z');
  const second = entry('2026-10-27T12:41:00.000Z', '2026-10-27T21:40:00.000Z');
  seedText(github, path, serializeMonthlyRecords([first, second]), 'monthly-sha');
  seedText(github, 'active/alice.json', serializeActiveRecord(active('2026-10-27T07:30:00.000Z')), 'active-sha');
  store.value.recentCache = [first, second].map((item, index) => ({ ...item, _path: path, _sha: 'monthly-sha', _index: index }));
  const tracker = service({ github, store, clock: () => new Date('2026-10-28T12:00:00.000Z') });
  for (const [index, end] of [[0, '2026-10-27T10:00:00.000Z'], [1, '2026-10-27T17:00:00.000Z']]) {
    await assert.rejects(() => tracker.queueEntryEdit({ path, originalSha: 'monthly-sha', index,
      original: { id: store.value.recentCache[index].id }, edits: { endedAt: end } }),
    error => /overlap the running timer/i.test(error.message)
      && error.message.includes('2026-10-27T07:30:00.000Z'));
  }
  assert.equal(store.value.activeCache, null);
  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(github.atomicWrites.length, 0);
});

test('an existing overlap does not block a description-only correction', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-08/alice.jsonl';
  const completed = entry('2026-08-18T08:00:00.000Z', '2026-08-18T10:30:00.000Z');
  const running = active('2026-08-18T10:00:00.000Z');
  seedText(github, path, serializeMonthlyRecords([completed]), 'monthly-sha');
  seedText(github, 'active/alice.json', serializeActiveRecord(running), 'active-sha');
  store.value.recentCache = [{ ...completed, _path: path, _sha: 'monthly-sha', _index: 0 }];
  store.value.activeCache = { ...running, _path: 'active/alice.json', _sha: 'active-sha' };
  const tracker = service({ github, store, clock: () => new Date('2026-08-18T12:00:00.000Z') });
  const request = { path, originalSha: 'monthly-sha', index: 0, original: completed, edits: { description: 'Updated' } };
  await tracker.queueEntryEdit(request);
  assert.equal((await tracker.editEntry(request)).description, 'Updated');
});

test('running timer start can be adjusted with SHA protection and preserves an active record', async () => {
  const github = new FakeGitHub(), store = new MemoryStore();
  const original = active('2026-08-18T08:00:00.000Z');
  seedText(github, 'active/alice.json', serializeActiveRecord(original), 'active-sha');
  store.value.activeCache = { ...original, _path: 'active/alice.json', _sha: 'active-sha' };
  const tracker = service({ github, store, clock: () => new Date('2026-08-18T12:00:00.000Z') });

  const updated = await tracker.editActiveStart({
    original: { id: original.id, startedAt: original.startedAt },
    startedAt: '2026-08-18T09:30:00.000Z',
  });

  assert.equal(updated.startedAt, '2026-08-18T09:30:00.000Z');
  assert.equal(updated.createdAt, updated.startedAt);
  assert.equal(updated.updatedAt, '2026-08-18T12:00:00.000Z');
  assert.deepEqual(github.atomicWrites.at(-1).changes.map(change => [change.path, change.sha]), [['active/alice.json', 'active-sha']]);
  assert.equal(parseActiveRecord(github.files.get('active/alice.json').text, { user: 'alice' }).startedAt, updated.startedAt);
  assert.equal(store.value.activeCache.startedAt, updated.startedAt);
  assert.equal(github.files.has('times/2026-08/alice.jsonl'), false);
});

test('running timer start rejects stale and future edits', async () => {
  const github = new FakeGitHub(), original = active('2026-08-18T08:00:00.000Z');
  seedText(github, 'active/alice.json', serializeActiveRecord(original), 'active-sha');
  const tracker = service({ github, clock: () => new Date('2026-08-18T12:00:00.000Z') });

  await assert.rejects(() => tracker.editActiveStart({
    original: { id: original.id, startedAt: '2026-08-18T07:00:00.000Z' }, startedAt: '2026-08-18T09:00:00.000Z',
  }), TrackerConflictError);
  await assert.rejects(() => tracker.editActiveStart({
    original: { id: original.id, startedAt: original.startedAt }, startedAt: '2026-08-18T12:01:00.000Z',
  }), /future/i);
});

test('running timer start cannot be moved into a remote completed interval before acceptance or direct save', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-08/alice.jsonl';
  const running = active('2026-08-18T10:00:00.000Z');
  const completed = entry('2026-08-18T08:00:00.000Z', '2026-08-18T09:30:00.000Z');
  seedText(github, 'active/alice.json', serializeActiveRecord(running), 'active-sha');
  seedText(github, path, serializeMonthlyRecords([completed]), 'month-sha');
  store.value.activeCache = { ...running, _path: 'active/alice.json', _sha: 'active-sha' };
  const tracker = service({ github, store, clock: () => new Date('2026-08-18T12:00:00.000Z') });
  const request = { original: { id: running.id, startedAt: running.startedAt }, startedAt: '2026-08-18T09:00:00.000Z' };
  await assert.rejects(() => tracker.queueActiveStartEdit(request), /overlap/i);
  await assert.rejects(() => tracker.editActiveStart(request), /overlap/i);
  assert.equal(store.value.activeCache.startedAt, running.startedAt);
  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(github.writes.length + github.atomicWrites.length, 0);

  const getText = github.getText.bind(github);
  github.getText = async requested => {
    if (requested === path) throw new Error('Time file unavailable');
    return getText(requested);
  };
  await assert.rejects(() => tracker.queueActiveStartEdit(request), /Time file unavailable/);
  assert.equal(store.value.pendingWrites.length, 0);
  github.getText = getText;

  const touching = { ...request, startedAt: completed.endedAt };
  await tracker.queueActiveStartEdit(touching);
  assert.equal(store.value.activeCache.startedAt, touching.startedAt);
  await service({ github, store, clock: () => new Date('2026-08-18T12:00:00.000Z') }).syncPending();
  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(parseActiveRecord(github.files.get('active/alice.json').text, { user: 'alice' }).startedAt, touching.startedAt);
  assert.deepEqual(github.atomicWrites[0].guards, [{ path, sha: 'month-sha' }]);
});

test('running timer start checks locally queued completed edits and rechecks remote records after restart', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-08/alice.jsonl';
  const running = active('2026-08-18T10:00:00.000Z');
  const completed = entry('2026-08-18T09:00:00.000Z', '2026-08-18T09:30:00.000Z');
  seedText(github, 'active/alice.json', serializeActiveRecord(running), 'active-sha');
  seedText(github, path, serializeMonthlyRecords([completed]), 'month-sha');
  store.value.activeCache = { ...running, _path: 'active/alice.json', _sha: 'active-sha' };
  store.value.recentCache = [{ ...completed, _path: path, _sha: 'month-sha', _index: 0 }];
  const tracker = service({ github, store, clock: () => new Date('2026-08-18T12:00:00.000Z') });
  await tracker.queueEntryEdit({ path, originalSha: 'month-sha', index: 0, original: completed,
    edits: { endedAt: '2026-08-18T09:55:00.000Z' } });
  const request = { original: { id: running.id, startedAt: running.startedAt }, startedAt: '2026-08-18T09:45:00.000Z' };
  await assert.rejects(() => tracker.queueActiveStartEdit(request), /overlap/i);
  assert.equal(store.value.activeCache.startedAt, running.startedAt);
  assert.equal(store.value.pendingWrites.length, 1);

  store.value.pendingWrites = [];
  store.value.recentCache = [];
  await tracker.queueActiveStartEdit({ ...request, startedAt: '2026-08-18T09:30:00.000Z' });
  seedText(github, path, serializeMonthlyRecords([entry('2026-08-18T09:00:00.000Z', '2026-08-18T09:45:00.000Z')]), 'raced-sha');
  await service({ github, store, clock: () => new Date('2026-08-18T12:00:00.000Z') }).syncPending();
  assert.equal(store.value.pendingWrites[0].status, 'conflict');
  assert.equal(parseActiveRecord(github.files.get('active/alice.json').text, { user: 'alice' }).startedAt, running.startedAt);
  assert.equal(github.atomicWrites.length, 0);
});

test('changing a running timer date checks a completed interval crossing a month boundary', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-07/alice.jsonl';
  const running = active('2026-08-02T10:00:00.000Z');
  const completed = entry('2026-07-31T23:00:00.000Z', '2026-08-01T01:00:00.000Z');
  seedText(github, 'active/alice.json', serializeActiveRecord(running), 'active-sha');
  seedText(github, path, serializeMonthlyRecords([completed]), 'july-sha');
  store.value.activeCache = { ...running, _path: 'active/alice.json', _sha: 'active-sha' };
  const tracker = service({ github, store, clock: () => new Date('2026-08-02T12:00:00.000Z') });
  const original = { id: running.id, startedAt: running.startedAt };
  await assert.rejects(() => tracker.queueActiveStartEdit({ original, startedAt: '2026-07-31T23:30:00.000Z' }), /overlap/i);
  assert.equal(store.value.activeCache.startedAt, running.startedAt);
  await tracker.queueActiveStartEdit({ original, startedAt: completed.endedAt });
  assert.equal(store.value.activeCache.entryDate, '2026-08-01');
  await service({ github, store, clock: () => new Date('2026-08-02T12:00:00.000Z') }).syncPending();
  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(parseActiveRecord(github.files.get('active/alice.json').text, { user: 'alice' }).entryDate, '2026-08-01');
  assert.deepEqual(github.atomicWrites[0].guards, [{ path, sha: 'july-sha' },
    { path: 'times/2026-08/alice.jsonl', sha: null }]);
});

test('a concurrent completed edit cannot race a direct running-start save past its monthly guard', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-08/alice.jsonl';
  const running = active('2026-08-18T10:00:00.000Z');
  const completed = entry('2026-08-18T08:00:00.000Z', '2026-08-18T08:30:00.000Z');
  seedText(github, 'active/alice.json', serializeActiveRecord(running), 'active-sha');
  seedText(github, path, serializeMonthlyRecords([completed]), 'month-sha');
  store.value.activeCache = { ...running, _path: 'active/alice.json', _sha: 'active-sha' };
  const atomic = github.updateTextsAtomic.bind(github);
  github.updateTextsAtomic = (...args) => {
    const raced = entry('2026-08-18T09:00:00.000Z', '2026-08-18T09:30:00.000Z');
    seedText(github, path, serializeMonthlyRecords([completed, raced]), 'concurrent-sha');
    return atomic(...args);
  };
  const tracker = service({ github, store, clock: () => new Date('2026-08-18T12:00:00.000Z') });
  await assert.rejects(() => tracker.editActiveStart({ original: { id: running.id, startedAt: running.startedAt },
    startedAt: '2026-08-18T09:00:00.000Z' }), TrackerConflictError);
  assert.equal(github.atomicWrites.length, 0);
  assert.equal(parseActiveRecord(github.files.get('active/alice.json').text, { user: 'alice' }).startedAt, running.startedAt);
  assert.equal(store.value.activeCache.startedAt, running.startedAt);
});

test('switching tasks stops the active timer before starting the selected task', async () => {
  const github = new FakeGitHub(), store = new MemoryStore();
  seedText(github, 'active/alice.json', serializeActiveRecord(active('2026-08-18T08:00:00.000Z')), 'active-sha');
  store.value.activeCache = parseActiveRecord(github.files.get('active/alice.json').text, { user: 'alice', path: 'active/alice.json', sha: 'active-sha' });
  const tracker = service({ github, store });
  const result = await tracker.switchTask('https://example.com/next', 'Next task');
  assert.equal(result.stopped.entry.taskUrl, issue.url);
  assert.equal(result.active.taskUrl, 'https://example.com/next');
  assert.equal(parseActiveRecord(github.files.get('active/alice.json').text, { user: 'alice' }).taskUrl, 'https://example.com/next');
  assert.equal(parseMonthlyRecords(github.files.get('times/2026-08/alice.jsonl').text, { user: 'alice', month: '2026-08' })[0].taskUrl, issue.url);
});

test('start persists an arbitrary task URL with an optional empty title', async () => {
  const github = new FakeGitHub(), tracker = service({ github });
  const result = await tracker.start('https://example.com/work/42?view=full', '');
  assert.equal(result.taskUrl, 'https://example.com/work/42?view=full');
  assert.equal(result.taskTitle, '');
  assert.equal(result.issue, undefined);
  const file = github.files.get('active/alice.json');
  assert.equal(JSON.parse(file.text).work_item.url, 'https://example.com/work/42?view=full');
  assert.equal(JSON.parse(file.text).work_item.title, '');
  assert.equal(parseActiveRecord(file.text, { user: 'alice' }).taskUrl, result.taskUrl);
});

test('queued imported-identity tracking survives restart and synchronization', async () => {
  const identity = 'acme/project/imported-task', github = new FakeGitHub(), store = new MemoryStore();
  const tracker = service({ github, store });
  const accepted = await tracker.start(identity, 'Imported task', '', { background: true });
  assert.equal(accepted.taskUrl, identity);
  await service({ github, store }).syncPending();
  const stored = parseActiveRecord(github.files.get('active/alice.json').text, { user: 'alice' });
  assert.equal(stored.taskUrl, identity);
  assert.equal(stored.taskTitle, 'Imported task');
  assert.equal(github.metadataReads.length, 0);
  assert.throws(() => tracker.validateTaskUrl(identity), /task URL/i, 'manual edit targets remain URL-only');
});

test('switching to an imported identity preserves the previous completion', async () => {
  const identity = 'acme/project/imported-task', github = new FakeGitHub(), store = new MemoryStore();
  seedText(github, 'active/alice.json', serializeActiveRecord(active('2026-08-18T08:00:00.000Z')), 'active-sha');
  store.value.activeCache = parseActiveRecord(github.files.get('active/alice.json').text, { user: 'alice', path: 'active/alice.json', sha: 'active-sha' });
  const tracker = service({ github, store });
  const result = await tracker.switchTask(identity, 'Imported task', '', { background: true });
  assert.equal(result.stopped.entry.taskUrl, issue.url);
  assert.equal(result.active.taskUrl, identity);
  await service({ github, store }).syncPending();
  assert.equal(parseActiveRecord(github.files.get('active/alice.json').text, { user: 'alice' }).taskUrl, identity);
});

test('queued Start persists a GitHub metadata snapshot and actor relationship when sync becomes available', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), tracker = service({ github, store });
  github.metadata.set(issue.url, {
    title: 'API title',
    github: {
      repository: { id: 99, node_id: 'R_repo', full_name: 'acme/frontend' },
      item: { number: 123, node_id: 'I_123', type: 'issue' },
      author: { id: 50, node_id: 'U_author', login: 'author' },
      assignees: [{ id: 123, node_id: 'U_alice', login: 'alice' }],
      state: { value: 'open', reason: null }, labels: [], milestone: null,
      timestamps: { created_at: '2026-08-01T00:00:00.000Z', updated_at: '2026-08-02T00:00:00.000Z', closed_at: null, merged_at: null },
      snapshot: { captured_at: '2026-08-18T09:00:01.000Z', source_updated_at: '2026-08-02T00:00:00.000Z', provider: 'github' },
    },
  });
  const accepted = await tracker.start(issue, '', '', { background: true });
  assert.equal(accepted._pending, true);
  assert.deepEqual(accepted.metadata, {}, 'offline acceptance does not wait for metadata');
  await tracker.syncPending();
  const stored = JSON.parse(github.files.get('active/alice.json').text);
  assert.equal(stored.work_item.title, 'API title');
  assert.equal(github.writes[0].message, 'timer: start alice', 'queued Start also avoids a premature issue cross-reference');
  assert.deepEqual(stored.metadata.github.actor_relationship, ['assignee']);
  assert.equal(stored.metadata.github.repository.id, 99);
  assert.equal(github.metadataReads.length, 1);
});

test('GitHub actor relationship prefers stable ID over a matching reusable login', async () => {
  const github = new FakeGitHub(), tracker = service({ github });
  github.metadata.set(issue.url, { title: 'Reused login', github: {
    repository: { id: 99, node_id: 'R_repo', full_name: 'acme/frontend' },
    item: { number: 123, node_id: 'I_123', type: 'issue' },
    author: { id: 999, node_id: 'U_other', login: 'alice' }, assignees: [],
    state: { value: 'open', reason: null }, labels: [], milestone: null,
    timestamps: { created_at: '2026-08-01T00:00:00.000Z', updated_at: '2026-08-02T00:00:00.000Z', closed_at: null, merged_at: null },
    snapshot: { captured_at: '2026-08-18T09:00:01.000Z', source_updated_at: '2026-08-02T00:00:00.000Z', provider: 'github' },
  } });
  await tracker.start(issue, '', '', { background: true }); await tracker.syncPending();
  assert.deepEqual(JSON.parse(github.files.get('active/alice.json').text).metadata.github.actor_relationship, ['other']);
});

test('generic URL Start never requests or stores GitHub metadata', async () => {
  const github = new FakeGitHub(), tracker = service({ github });
  await tracker.start('https://example.com/work/42', '', '', { background: true });
  await tracker.syncPending();
  assert.equal(github.metadataReads.length, 0);
  assert.deepEqual(JSON.parse(github.files.get('active/alice.json').text).metadata, {});
});

test('recent load backfills missing issue titles once with the current SHA', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-08/alice.jsonl';
  const untitled = entry(localTimestamp(2026, 7, 18, 8), localTimestamp(2026, 7, 18, 9));
  seedText(github, path, serializeMonthlyRecords([untitled]), 'daily');
  github.metadata.set(issue.url, { title: 'Ranking regression' });
  const tracker = service({ github, store, recentDays: 1, clock: () => new Date(localTimestamp(2026, 7, 18, 12)) });

  const first = await tracker.loadMenuData(50);
  assert.equal(first.recent[0].issueTitle, 'Ranking regression');
  assert.equal(github.metadataReads.length, 1);
  assert.equal(github.writes.length, 1);
  assert.equal(github.writes[0].sha, 'daily');
  assert.equal(JSON.parse(github.files.get(path).text).work_item.title, 'Ranking regression');

  const second = await tracker.loadMenuData(50);
  assert.equal(second.recent[0].issueTitle, 'Ranking regression');
  assert.equal(github.metadataReads.length, 1, 'persisted titles are not resolved again');
  assert.equal(github.writes.length, 1, 'persisted titles are not rewritten again');
});

test('recent load persists a current-page title into a legacy active timer with its current SHA', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), legacy = active('2026-08-18T08:00:00.000Z');
  seedText(github, 'active/alice.json', serializeActiveRecord(legacy), 'active-sha');
  store.value.activeCache = { ...legacy, issueTitle: '', _path: 'active/alice.json', _sha: 'active-sha' };
  const data = await service({ github, store, recentDays: 1, clock: () => new Date('2026-08-18T12:00:00Z') })
    .loadMenuData(50, { knownTitles: new Map([[issue.url, 'Ranking regression']]) });
  assert.equal(data.active.issueTitle, 'Ranking regression');
  assert.equal(github.writes.at(-1).path, 'active/alice.json');
  assert.equal(github.writes.at(-1).sha, 'active-sha');
  assert.equal(JSON.parse(github.files.get('active/alice.json').text).work_item.title, 'Ranking regression');
});

test('an unsupported queued stage is preserved instead of clearing active or losing the completion', async () => {
  const github = new FakeGitHub(), store = new MemoryStore();
  const queuedEntry = entry('2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z');
  store.value.pendingWrites = [{
    operation: 'completeTimer', id: 'legacy', status: 'pending', retryCount: 0,
    stage: 'unknownLegacyStage', monthlyPath: 'times/2026-08/alice.jsonl', entry: queuedEntry,
    activeSnapshot: active(), activeSha: 'active-sha', queuedAt: queuedEntry.endedAt, lastError: '',
  }];
  seedText(github, 'active/alice.json', serializeActiveRecord(active()), 'active-sha');
  const queue = await service({ github, store }).syncPending();
  assert.equal(queue.length, 1);
  assert.equal(queue[0].status, 'conflict');
  assert.match(queue[0].lastError, /unsupported storage stage/i);
  assert.equal(github.writes.length, 0);
  assert.equal(github.deletes.length, 0);
  assert.equal(github.files.has('active/alice.json'), true);
});

test('stop appends to one monthly JSONL file and clears active', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(); let now = new Date('2026-08-18T08:00:00Z');
  const tracker = service({ github, store, clock: () => new Date(now) });
  await tracker.start(issue); const activeReadsBeforeStop = github.reads.filter(path => path === 'active/alice.json').length; now = new Date('2026-08-18T09:15:00Z');
  const stopped = await tracker.stop('Done');
  assert.equal(stopped.pending, false);
  assert.equal(github.files.has('active/alice.json'), false);
  const file = github.files.get('times/2026-08/alice.jsonl');
  assert.ok(file);
  assert.equal(file.text.trim().split('\n').length, 1);
  assert.equal(new Date(parseMonthlyRecords(file.text, { user: 'alice', month: '2026-08' })[0].endedAt).getTime(), new Date('2026-08-18T09:15:00Z').getTime());
  assert.equal(JSON.parse(file.text).description, 'Done');
  assert.equal(github.writes[0].message, 'timer: start alice', 'Start does not create a premature GitHub issue cross-reference');
  assert.equal(github.atomicWrites[0].message, 'time: alice tracked 1h 15m 0s on acme/frontend#123');
  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(github.reads.filter(path => path === 'active/alice.json').length, activeReadsBeforeStop + 1, 'Stop verifies that the cached timer is still authoritative before completing it');
});

test('completion commit reports duration with second precision', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(); let now = new Date('2026-08-18T08:00:00Z');
  const tracker = service({ github, store, clock: () => new Date(now) });
  await tracker.start(issue); now = new Date('2026-08-18T08:00:30Z');
  await tracker.stop();
  assert.equal(github.atomicWrites[0].message, 'time: alice tracked 30s on acme/frontend#123');
});

test('stop does not complete a stale cached timer after another device replaces it', async () => {
  const github = new FakeGitHub(), store = new MemoryStore();
  const stale = { ...active('2026-08-18T08:00:00.000Z'), _path: 'active/alice.json', _sha: 'stale-sha' };
  const current = active('2026-08-18T10:00:00.000Z', { issue: pull });
  store.value.activeCache = stale;
  seedText(github, 'active/alice.json', serializeActiveRecord(current), 'current-sha');
  await assert.rejects(() => service({ github, store }).stop('must not be saved'), /changed on another device/i);
  assert.equal(github.files.has('times/2026-08/alice.jsonl'), false);
  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(store.value.activeCache.issue.url, pull.url);
  assert.equal(store.value.activeCache._sha, 'current-sha');
});

test('a confirmed missing active file cannot create a completion from stale cache', async () => {
  const github = new FakeGitHub(), store = new MemoryStore();
  store.value.activeCache = { ...active('2026-08-18T08:00:00.000Z'), _path: 'active/alice.json', _sha: 'stale-sha' };
  await assert.rejects(() => service({ github, store }).stop('must not be saved'), /No timer is running/);
  assert.equal(github.files.has('times/2026-08/alice.jsonl'), false);
  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(store.value.activeCache, null);
});

test('a transient read followed by confirmed missing cannot append stale cache', async () => {
  class OneFailedActiveReadGitHub extends FakeGitHub {
    constructor() { super(); this.failNextActiveRead = true; }
    async getText(path) {
      if (path === 'active/alice.json' && this.failNextActiveRead) {
        this.failNextActiveRead = false;
        throw new TypeError('temporary network failure');
      }
      return super.getText(path);
    }
  }
  const github = new OneFailedActiveReadGitHub(), store = new MemoryStore();
  store.value.activeCache = { ...active('2026-08-18T08:00:00.000Z'), _path: 'active/alice.json', _sha: 'stale-sha' };
  const result = await service({ github, store }).stop('must not be saved');
  assert.equal(result.pending, true);
  assert.equal(github.files.has('times/2026-08/alice.jsonl'), false);
  assert.equal(store.value.pendingWrites[0].stage, 'verifyActive');
  assert.equal(store.value.pendingWrites[0].status, 'conflict');
  assert.equal(store.value.pendingWrites[0].conflictReason, 'active_missing_no_completion');
  await assert.rejects(() => service({ github, store }).resolvePendingConflict(store.value.pendingWrites[0].id), /explicit discard/i);
  assert.equal(store.value.pendingWrites.length, 1, 'generic acknowledgement preserves the unsaved completion');
  assert.deepEqual(await service({ github, store }).resolvePendingConflict(store.value.pendingWrites[0].id, 'discard_unsaved_completion'), { resolved: true });
  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(store.value.recentCache.some(item => item._pending), false);
});

test('a transient read followed by confirmed missing adopts an existing completion', async () => {
  class OneFailedActiveReadGitHub extends FakeGitHub {
    constructor() { super(); this.failNextActiveRead = true; }
    async getText(path) {
      if (path === 'active/alice.json' && this.failNextActiveRead) {
        this.failNextActiveRead = false;
        throw new TypeError('temporary network failure');
      }
      return super.getText(path);
    }
  }
  const github = new OneFailedActiveReadGitHub(), store = new MemoryStore();
  const timer = active('2026-08-18T08:00:00.000Z', { taskTitle: 'Cached title', issueTitle: 'Cached title' });
  const completed = entry('2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z', { taskTitle: 'Remote title', issueTitle: 'Remote title', description: 'first device' });
  store.value.activeCache = { ...timer, _path: 'active/alice.json', _sha: 'stale-sha' };
  seedText(github, 'times/2026-08/alice.jsonl', serializeMonthlyRecords([completed]), 'daily-sha');
  const result = await service({ github, store }).stop('second device');
  assert.equal(result.pending, false);
  assert.equal(result.entry.description, 'first device');
  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(parseMonthlyRecords(github.files.get('times/2026-08/alice.jsonl').text, { user: 'alice', month: '2026-08', path: 'times/2026-08/alice.jsonl' }).length, 1);
});

test('a transient active read failure cannot append a stale cached timer before verification', async () => {
  class OneFailedActiveReadGitHub extends FakeGitHub {
    constructor() { super(); this.failNextActiveRead = true; }
    async getText(path) {
      if (path === 'active/alice.json' && this.failNextActiveRead) {
        this.failNextActiveRead = false;
        throw new TypeError('temporary network failure');
      }
      return super.getText(path);
    }
  }
  const github = new OneFailedActiveReadGitHub(), store = new MemoryStore();
  const stale = { ...active('2026-08-18T08:00:00.000Z'), _path: 'active/alice.json', _sha: 'stale-sha' };
  store.value.activeCache = stale;
  seedText(github, 'active/alice.json', serializeActiveRecord(active('2026-08-18T10:00:00.000Z', { issue: pull })), 'current-sha');
  const result = await service({ github, store }).stop('must not be saved');
  assert.equal(result.pending, true);
  assert.equal(github.files.has('times/2026-08/alice.jsonl'), false);
  assert.equal(store.value.pendingWrites[0].status, 'conflict');
  assert.equal(store.value.activeCache.issue.url, pull.url);
  assert.equal(store.value.pendingWrites[0].conflictReason, 'active_changed_no_completion');
  await assert.rejects(() => service({ github, store }).resolvePendingConflict(store.value.pendingWrites[0].id), /explicit discard/i);
  assert.deepEqual(await service({ github, store }).resolvePendingConflict(store.value.pendingWrites[0].id, 'discard_unsaved_completion'), { resolved: true });
  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(store.value.recentCache.some(item => item._pending), false);
  assert.equal(github.files.has('active/alice.json'), true);
});

test('transient active read does not overwrite a newer durable active title from stale cache', async () => {
  class OneFailedActiveReadGitHub extends FakeGitHub {
    constructor() { super(); this.failNextActiveRead = true; }
    async getText(path) {
      if (path === 'active/alice.json' && this.failNextActiveRead) {
        this.failNextActiveRead = false;
        throw new TypeError('temporary network failure');
      }
      return super.getText(path);
    }
  }
  const github = new OneFailedActiveReadGitHub(), store = new MemoryStore();
  const startedAt = '2026-08-18T08:00:00.000Z';
  const stale = { ...active(startedAt, { issueTitle: 'Stale cached title' }), _path: 'active/alice.json', _sha: 'stale-sha' };
  const remote = active(startedAt, { issueTitle: 'Newer durable title' });
  store.value.activeCache = stale;
  seedText(github, 'active/alice.json', serializeActiveRecord(remote), 'current-sha');

  const result = await service({ github, store }).stop('must not overwrite title');
  assert.equal(result.pending, false);
  assert.equal(github.files.has('active/alice.json'), false);
  const saved = parseMonthlyRecords(github.files.get('times/2026-08/alice.jsonl').text, { user: 'alice', month: '2026-08' });
  assert.equal(saved[0].issueTitle, 'Newer durable title');
  assert.equal(store.value.pendingWrites.length, 0);
});

test('changed-active verification adopts an existing completion before preserving the newer timer', async () => {
  class OneFailedActiveReadGitHub extends FakeGitHub {
    constructor() { super(); this.failNextActiveRead = true; }
    async getText(path) {
      if (path === 'active/alice.json' && this.failNextActiveRead) {
        this.failNextActiveRead = false;
        throw new TypeError('temporary network failure');
      }
      return super.getText(path);
    }
  }
  const github = new OneFailedActiveReadGitHub(), store = new MemoryStore();
  const stale = { ...active('2026-08-18T08:00:00.000Z', { issueTitle: 'Durable title' }), _path: 'active/alice.json', _sha: 'stale-sha' };
  const completed = entry(stale.startedAt, '2026-08-18T09:00:00.000Z', { issueTitle: 'Durable title', description: 'other device' });
  store.value.activeCache = stale;
  seedText(github, 'active/alice.json', serializeActiveRecord(active('2026-08-18T10:00:00.000Z', { issue: pull })), 'current-sha');
  seedText(github, 'times/2026-08/alice.jsonl', serializeMonthlyRecords([completed]), 'monthly-sha');

  const result = await service({ github, store }).stop('this device');
  assert.equal(result.pending, true);
  assert.equal(store.value.pendingWrites[0].stage, 'clearActive');
  assert.equal(store.value.pendingWrites[0].conflictReason, 'completion_saved_newer_timer');
  assert.equal(store.value.pendingWrites[0].entry.description, 'other device');
  assert.deepEqual(await service({ github, store }).resolvePendingConflict(store.value.pendingWrites[0].id), { resolved: true });
  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(parseActiveRecord(github.files.get('active/alice.json').text, { user: 'alice' }).issue.url, pull.url);
});

test('acknowledging a clear-active conflict keeps the newer timer and completes the saved operation', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), tracker = service({ github, store });
  const old = active('2026-08-18T08:00:00.000Z');
  const completed = entry(old.startedAt, '2026-08-18T09:00:00.000Z');
  const operation = { operation: 'completeTimer', id: fixedId, status: 'conflict', retryCount: 1, stage: 'clearActive',
    monthlyPath: 'times/2026-08/alice.jsonl', entry: completed, activeSnapshot: old, activeSha: 'old-sha', queuedAt: completed.endedAt, lastError: 'new timer' };
  store.value.pendingWrites = [operation];
  seedText(github, operation.monthlyPath, serializeMonthlyRecords([completed]), 'daily-sha');
  seedText(github, 'active/alice.json', serializeActiveRecord(active('2026-08-18T10:00:00.000Z', { issue: pull })), 'new-sha');
  const result = await tracker.resolvePendingConflict(store.value.pendingWrites[0].id);
  assert.deepEqual(result, { resolved: true });
  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(store.value.activeCache.issue.url, pull.url);
  assert.equal(github.files.has('active/alice.json'), true);
});

test('conflict resolution cannot erase a timer accepted during its remote read', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), tracker = service({ github, store });
  const old = active('2026-08-18T08:00:00.000Z'), completed = entry(old.startedAt, '2026-08-18T09:00:00.000Z');
  const conflict = { operation: 'completeTimer', id: fixedId, status: 'conflict', retryCount: 1, stage: 'clearActive',
    monthlyPath: 'times/2026-08/alice.jsonl', entry: completed, activeSnapshot: old, activeSha: 'old-sha', queuedAt: completed.endedAt, lastError: 'new timer' };
  store.value.pendingWrites = [conflict]; store.value.activeCache = null;
  seedText(github, conflict.monthlyPath, serializeMonthlyRecords([completed]), 'monthly-sha');
  seedText(github, 'active/alice.json', serializeActiveRecord(active('2026-08-18T10:00:00.000Z', { issue: pull })), 'new-sha');
  let releaseRead, readStarted;
  const started = new Promise(resolve => { readStarted = resolve; }), release = new Promise(resolve => { releaseRead = resolve; });
  const originalGet = github.getText.bind(github); let delayed = false;
  github.getText = async (...args) => {
    if (!delayed && args[0] === 'active/alice.json') { delayed = true; readStarted(); await release; }
    return originalGet(...args);
  };
  const resolving = tracker.resolvePendingConflict(store.value.pendingWrites[0].id); await started;
  const accepted = await tracker.start('https://example.com/new', 'New timer', '', { background: true });
  assert.equal(accepted._pending, true); releaseRead();
  assert.deepEqual(await resolving, { resolved: true });
  assert.deepEqual(store.value.pendingWrites.map(item => item.operation), ['startTimer']);
  assert.equal(store.value.activeCache.taskUrl, 'https://example.com/new');
  assert.equal(store.value.activeCache._pending, true);
});

test('conflict acknowledgement preserves a newer locally accepted timer operation', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), tracker = service({ github, store });
  const old = active('2026-08-18T08:00:00.000Z'), completed = entry(old.startedAt, '2026-08-18T09:00:00.000Z');
  const conflict = { operation: 'completeTimer', id: fixedId, status: 'conflict', retryCount: 1, stage: 'clearActive',
    monthlyPath: 'times/2026-08/alice.jsonl', entry: completed, activeSnapshot: old, activeSha: 'old-sha', queuedAt: completed.endedAt, lastError: 'new timer' };
  const next = active('2026-08-18T11:00:00.000Z', { taskUrl: 'https://example.com/next', issue: undefined });
  const later = { operation: 'startActive', id: '01K2ABCDEF0123456789ABCDEG', status: 'pending', retryCount: 0, stage: 'startNext', nextActive: next, queuedAt: next.startedAt, lastError: '' };
  store.value.pendingWrites = [conflict, later]; store.value.activeCache = { ...next, _pending: true };
  seedText(github, conflict.monthlyPath, serializeMonthlyRecords([completed]), 'monthly-sha');
  seedText(github, 'active/alice.json', serializeActiveRecord(active('2026-08-18T10:00:00.000Z', { issue: pull })), 'new-sha');
  assert.deepEqual(await tracker.resolvePendingConflict(store.value.pendingWrites[0].id), { resolved: true });
  assert.deepEqual(store.value.pendingWrites.map(item => item.id), [later.id]);
  assert.equal(store.value.activeCache.taskUrl, next.taskUrl);
  assert.equal(store.value.activeCache._pending, true);
});

test('queued Stop adopts the same stable-ID completion despite mutable title differences', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), tracker = service({ github, store });
  const timer = active('2026-08-18T08:00:00.000Z', { issueTitle: 'Intended durable title' });
  const intended = entry(timer.startedAt, '2026-08-18T09:00:00.000Z', { issueTitle: timer.issueTitle });
  const remote = { ...intended, issueTitle: 'Different remote title', taskTitle: 'Different remote title' };
  const operation = { operation: 'completeTimer', id: fixedId, status: 'pending', retryCount: 0, stage: 'appendMonthly',
    monthlyPath: 'times/2026-08/alice.jsonl', entry: intended, activeSnapshot: timer, activeSha: null, queuedAt: intended.endedAt, lastError: '' };
  store.value.pendingWrites = [operation];
  store.value.recentCache = [{ ...intended, _path: operation.monthlyPath, _sha: null, _index: -1, _pending: true }];
  seedText(github, operation.monthlyPath, serializeMonthlyRecords([remote]), 'daily-sha');

  await tracker.syncPending();

  const saved = parseMonthlyRecords(github.files.get(operation.monthlyPath).text, { user: 'alice', month: '2026-08' });
  assert.deepEqual(saved.map(item => item.issueTitle), ['Different remote title']);
  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(store.value.recentCache[0].issueTitle, 'Different remote title');
});

test('multiple completions on one day append to the same file', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(); let now = new Date('2026-08-18T08:00:00Z'), serial = 0;
  const tracker = service({ github, store, clock: () => new Date(now), idFactory: () => `01K2ABCDEF0123456789ABCDE${serial++ ? 'A' : 'F'}` });
  await tracker.start(issue); now = new Date('2026-08-18T09:00:00Z'); await tracker.stop();
  now = new Date('2026-08-18T10:00:00Z'); await tracker.start(pull); now = new Date('2026-08-18T11:00:00Z'); await tracker.stop('review');
  const file = github.files.get('times/2026-08/alice.jsonl');
  assert.equal(file.text.trim().split('\n').length, 2);
  assert.equal([...github.files.keys()].filter(path => path.startsWith('times/')).length, 1);
});

test('recent loading performs one direct read per month and no directory or per-record requests', async () => {
  const github = new FakeGitHub(), store = new MemoryStore();
  const records = [entry('2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z'), entry('2026-08-18T10:00:00.000Z', '2026-08-18T11:00:00.000Z', { issue: pull })];
  seedText(github, 'times/2026-08/alice.jsonl', serializeMonthlyRecords(records));
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
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-08/alice.jsonl';
  seedText(github, path, serializeMonthlyRecords([entry('2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z'), entry('2026-08-18T10:00:00.000Z', '2026-08-18T11:00:00.000Z', { issue: pull })]), 'daily');
  const tracker = service({ github, store });
  const saved = await tracker.editEntry({ path, originalSha: 'daily', index: 1, edits: { description: 'manual note', endedAt: '2026-08-18T11:30:00.000Z' } });
  assert.equal(github.writes.length, 0); assert.equal(github.atomicWrites.length, 1);
  const parsed = parseMonthlyRecords(github.files.get(path).text, { user: 'alice', month: '2026-08' });
  assert.equal(parsed[0].description, ''); assert.equal(parsed[1].description, 'manual note');
  assert.equal(saved._index, 1); assert.equal(saved.durationSeconds, 5400);
});

test('moving a completed entry to the latest permitted interval persists both timestamps', async () => {
  const github = new FakeGitHub(), path = 'times/2026-08/alice.jsonl';
  const target = entry('2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z', { issue: pull });
  seedText(github, path, serializeMonthlyRecords([target]), 'daily');

  const [saved] = await service({ github }).editEntries({ entries: [{
    path, originalSha: 'daily', index: 0,
    original: { id: target.id, taskUrl: target.taskUrl, taskTitle: target.taskTitle, issueUrl: target.taskUrl, issueTitle: target.taskTitle, startedAt: target.startedAt, endedAt: target.endedAt, description: target.description },
    edits: { startedAt: '2026-08-18T22:30:00.000Z', endedAt: '2026-08-18T23:30:00.000Z' },
  }] });

  assert.equal(saved.startedAt, '2026-08-18T22:30:00.000Z');
  assert.equal(saved.endedAt, '2026-08-18T23:30:00.000Z');
  const [persisted] = parseMonthlyRecords(github.files.get(path).text, { user: 'alice', month: '2026-08' });
  assert.equal(persisted.startedAt, saved.startedAt);
  assert.equal(persisted.endedAt, saved.endedAt);
  assert.equal(github.atomicWrites.length, 1);
});

test('edit locates the intended record after its array position changed', async () => {
  const github = new FakeGitHub(), path = 'times/2026-08/alice.jsonl';
  const intended = entry('2026-08-18T15:13:17.000Z', '2026-08-18T16:13:17.000Z', { description: 'target' });
  seedText(github, path, serializeMonthlyRecords([entry('2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z'), intended]), 'daily');
  const saved = await service({ github }).editEntry({ path, originalSha: 'daily', index: 99,
    original: { id: intended.id, issueUrl: intended.issue.url, startedAt: intended.startedAt, endedAt: intended.endedAt, description: intended.description },
    edits: { startedAt: '2026-08-18T01:13:17.000Z', endedAt: '2026-08-18T02:13:17.000Z' } });
  assert.equal(saved.startedAt, '2026-08-18T01:13:17.000Z'); assert.equal(saved.description, 'target');
});

test('editing one entry into another entry’s interval is rejected before writing', async () => {
  const github = new FakeGitHub(), path = 'times/2026-08/alice.jsonl';
  const first = entry('2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z', 'same');
  const second = entry('2026-08-18T10:00:00.000Z', '2026-08-18T11:00:00.000Z', 'same');
  seedText(github, path, serializeMonthlyRecords([first, second]), 'daily');
  await assert.rejects(() => service({ github }).editEntry({ path, originalSha: 'daily', index: 1,
    original: { id: second.id, issueUrl: second.issue.url, startedAt: second.startedAt, endedAt: second.endedAt, description: second.description },
    edits: { startedAt: first.startedAt, endedAt: first.endedAt } }), /overlap/i);
  assert.equal(github.atomicWrites.length, 0);
});

test('editing Start into another day in the same month performs one SHA-guarded rewrite', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-08/alice.jsonl';
  const intended = entry('2026-08-18T00:13:17.000Z', '2026-08-18T02:13:17.000Z');
  seedText(github, path, serializeMonthlyRecords([intended]), 'source');
  store.value.recentCache = parseMonthlyRecords(serializeMonthlyRecords([intended]), { user: 'alice', month: '2026-08', path, sha: 'source' });
  const saved = await service({ github, store }).editEntry({ path, originalSha: 'source', index: 0,
    original: { id: intended.id, issueUrl: intended.issue.url, startedAt: intended.startedAt, endedAt: intended.endedAt, description: '' },
    edits: { startedAt: '2026-08-17T23:13:17.000Z' } });
  assert.equal(github.atomicWrites.length, 1); assert.equal(github.writes.length, 0); assert.equal(saved._path, path);
  assert.equal(parseMonthlyRecords(github.files.get(path).text, { user: 'alice', month: '2026-08' })[0].startedAt, '2026-08-17T23:13:17.000Z');
  assert.deepEqual(store.value.recentCache.map(record => record._path), [path]);
});

test('editing Start into another month atomically moves the record between monthly files', async () => {
  const github = new FakeGitHub(), source = 'times/2026-08/alice.jsonl', destination = 'times/2026-09/alice.jsonl';
  const intended = entry('2026-08-31T23:13:17.000Z', '2026-09-01T00:13:17.000Z');
  seedText(github, source, serializeMonthlyRecords([intended]), 'source');
  const saved = await service({ github }).editEntry({ path: source, originalSha: 'source', index: 0,
    original: { id: intended.id, issueUrl: intended.issue.url, startedAt: intended.startedAt, endedAt: intended.endedAt, description: '' },
    edits: { startedAt: '2026-09-01T00:13:17.000Z', endedAt: '2026-09-01T01:13:17.000Z' } });
  assert.equal(github.atomicWrites.length, 1); assert.equal(github.files.has(source), false); assert.equal(saved._path, destination);
  assert.equal(parseMonthlyRecords(github.files.get(destination).text, { user: 'alice', month: '2026-09' })[0].entryDate, '2026-09-01');
});

test('edit rejects a stale monthly-file SHA before writing', async () => {
  const github = new FakeGitHub(), path = 'times/2026-08/alice.jsonl'; seedText(github, path, serializeMonthlyRecords([entry('2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z')]), 'new');
  await assert.rejects(() => service({ github }).editEntry({ path, originalSha: 'old', index: 0, edits: { description: 'x' } }), TrackerConflictError);
  assert.equal(github.writes.length, 0);
});

test('deleting one record keeps the monthly file; deleting the last removes it', async () => {
  const github = new FakeGitHub(), path = 'times/2026-08/alice.jsonl'; seedText(github, path, serializeMonthlyRecords([entry('2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z'), entry('2026-08-18T10:00:00.000Z', '2026-08-18T11:00:00.000Z')]), 'one');
  const tracker = service({ github }); const first = await tracker.deleteEntry({ path, originalSha: 'one', index: 0 });
  assert.equal(first.deleted, true); assert.equal(first.entries.length, 1);
  assert.equal(first.entries[0]._sha, github.files.get(path).sha); assert.equal(first.entries[0]._index, 0);
  assert.equal(parseMonthlyRecords(github.files.get(path).text, { user: 'alice', month: '2026-08' }).length, 1);
  const second = await tracker.deleteEntry({ path, originalSha: first.entries[0]._sha, index: first.entries[0]._index });
  assert.deepEqual(second, { deleted: true, entries: [] });
  assert.equal(github.files.has(path), false); assert.equal(github.deletes.length, 0); assert.equal(github.atomicWrites.length, 2);
});

test('same-day boundary movement updates two entries with one GitHub write', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-08/alice.jsonl';
  seedText(github, path, serializeMonthlyRecords([entry('2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z'), entry('2026-08-18T09:30:00.000Z', '2026-08-18T11:00:00.000Z')]), 'daily');
  const saved = await service({ github, store }).moveBoundary({
    upper: { path, originalSha: 'daily', index: 0, endedAt: '2026-08-18T10:00:00.000Z' },
    lower: { path, originalSha: 'daily', index: 1, startedAt: '2026-08-18T10:30:00.000Z' },
  });
  assert.equal(github.writes.length, 0); assert.equal(github.atomicWrites.length, 1); assert.equal(saved.length, 2);
  const parsed = parseMonthlyRecords(github.files.get(path).text, { user: 'alice', month: '2026-08' });
  assert.equal(parsed[0].endedAt, '2026-08-18T10:00:00.000Z'); assert.equal(parsed[1].startedAt, '2026-08-18T10:30:00.000Z');
});

test('boundary movement has no arbitrary twelve-hour cap', async () => {
  const github = new FakeGitHub(), path = 'times/2026-08/alice.jsonl';
  seedText(github, path, serializeMonthlyRecords([
    entry('2026-08-17T00:00:00.000Z', '2026-08-18T01:00:00.000Z'),
    entry('2026-08-18T01:00:00.000Z', '2026-08-20T01:00:00.000Z'),
  ]), 'monthly');
  await service({ github }).moveBoundary({
    upper: { path, originalSha: 'monthly', index: 0, endedAt: '2026-08-19T01:00:00.000Z' },
    lower: { path, originalSha: 'monthly', index: 1, startedAt: '2026-08-19T01:00:00.000Z' },
  });
  const records = parseMonthlyRecords(github.files.get(path).text, { user: 'alice', month: '2026-08' });
  assert.equal(records[0].durationSeconds, 49 * 3600); assert.equal(records[1].durationSeconds, 24 * 3600);
  assert.equal(github.writes.length, 0); assert.equal(github.atomicWrites.length, 1);
});

test('boundary movement rejects unequal deltas and invalid durations', async () => {
  const github = new FakeGitHub(), path = 'times/2026-08/alice.jsonl'; seedText(github, path, serializeMonthlyRecords([entry('2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z'), entry('2026-08-18T09:00:00.000Z', '2026-08-18T10:00:00.000Z')]), 'daily');
  const tracker = service({ github });
  await assert.rejects(() => tracker.moveBoundary({ upper: { path, originalSha: 'daily', index: 0, endedAt: '2026-08-18T09:15:00.000Z' }, lower: { path, originalSha: 'daily', index: 1, startedAt: '2026-08-18T09:20:00.000Z' } }), /same amount/i);
  await assert.rejects(() => tracker.moveBoundary({ upper: { path, originalSha: 'daily', index: 0, endedAt: '2026-08-18T07:00:00.000Z' }, lower: { path, originalSha: 'daily', index: 1, startedAt: '2026-08-18T07:00:00.000Z' } }), /end/i);
  assert.equal(github.writes.length, 0);
});

test('cross-month boundary changes are one atomic repository update', async () => {
  const github = new FakeGitHub(), first = 'times/2026-08/alice.jsonl', second = 'times/2026-09/alice.jsonl';
  seedText(github, first, serializeMonthlyRecords([entry('2026-08-31T22:00:00.000Z', '2026-08-31T23:00:00.000Z')]), 'first');
  seedText(github, second, serializeMonthlyRecords([entry('2026-09-01T00:00:00.000Z', '2026-09-01T01:00:00.000Z')]), 'second');
  await service({ github }).moveBoundary({ upper: { path: first, originalSha: 'first', index: 0, endedAt: '2026-08-31T23:15:00.000Z' }, lower: { path: second, originalSha: 'second', index: 0, startedAt: '2026-09-01T00:15:00.000Z' } });
  assert.equal(github.atomicWrites.length, 1); assert.equal(github.writes.length, 0);
  assert.equal(parseMonthlyRecords(github.files.get(first).text, { user: 'alice', month: '2026-08' })[0].endedAt, '2026-08-31T23:15:00.000Z');
  assert.equal(parseMonthlyRecords(github.files.get(second).text, { user: 'alice', month: '2026-09' })[0].startedAt, '2026-09-01T00:15:00.000Z');
});

test('pending completion does not adopt an unrelated record with only the same URL and Start', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-08/alice.jsonl';
  seedText(github, path, serializeMonthlyRecords([entry('2026-08-18T08:00:00.000Z', '2026-08-18T08:30:00.000Z', { id: fixedId, description: 'old unrelated completion' })]), 'daily');
  seedText(github, 'active/alice.json', serializeActiveRecord(active()), 'active');
  const tracker = service({ github, store, clock: () => new Date('2026-08-18T09:00:00Z') }); await tracker.refreshActive();
  const stopped = await tracker.stop('new completion');
  const records = parseMonthlyRecords(github.files.get(path).text, { user: 'alice', month: '2026-08' });
  assert.equal(stopped.pending, false); assert.equal(records.length, 2);
  assert.deepEqual(records.map(record => record.description), ['old unrelated completion', 'new completion']);
});

test('concurrent Stops adopt the first completion instead of duplicating it', async () => {
  const github = new FakeGitHub(), aStore = new MemoryStore(), bStore = new MemoryStore();
  seedText(github, 'active/alice.json', serializeActiveRecord(active()), 'active');
  const a = service({ github, store: aStore, clock: () => new Date('2026-08-18T09:00:00Z') });
  const b = service({ github, store: bStore, clock: () => new Date('2026-08-18T09:05:00Z') });
  await a.refreshActive(); await b.refreshActive(); await a.stop('first'); const second = await b.stop('second');
  const parsed = parseMonthlyRecords(github.files.get('times/2026-08/alice.jsonl').text, { user: 'alice', month: '2026-08' });
  assert.equal(parsed.length, 1); assert.equal(parsed[0].description, 'first'); assert.equal(second.entry.description, 'first');
});

test('simultaneous Stops converge automatically after an atomic completion race', async () => {
  const github = new FakeGitHub(), aStore = new MemoryStore(), bStore = new MemoryStore();
  seedText(github, 'active/alice.json', serializeActiveRecord(active()), 'active');
  const a = service({ github, store: aStore, clock: () => new Date('2026-08-18T09:00:00Z') });
  const b = service({ github, store: bStore, clock: () => new Date('2026-08-18T09:05:00Z') });
  await a.refreshActive(); await b.refreshActive();
  await Promise.all([a.stop('first'), b.stop('second')]);
  const parsed = parseMonthlyRecords(github.files.get('times/2026-08/alice.jsonl').text, { user: 'alice', month: '2026-08' });
  assert.equal(parsed.length, 1);
  assert.equal(aStore.value.pendingWrites.length, 0);
  assert.equal(bStore.value.pendingWrites.length, 0);
});

test('malformed monthly JSONL fails visibly instead of silently hiding the whole month', async () => {
  const github = new FakeGitHub(); seedText(github, 'times/2026-08/alice.jsonl', 'URL: javascript:alert(1)\nStart: nope\nEnd: nope\n');
  await assert.rejects(() => service({ github, recentDays: 1 }).loadRecent(), /JSON|task URL|timestamp/i);
});

test('tracking accepts a valid GitHub issue from any owner', async () => {
  const github = new FakeGitHub(), tracker = service({ github });
  const other = { type: 'issue', owner: 'other-org', repo: 'x', number: 1, url: 'https://github.com/other-org/x/issues/1' };
  const started = await tracker.start(other, 'Cross-organization task');
  assert.equal(started.issue.url, other.url);
});


test('menu data reports the complete current-day total even when recent rows are capped', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-08/alice.jsonl';
  const entries = Array.from({ length: 55 }, (_, index) => {
    const startedAt = localTimestamp(2026, 7, 18, 0, index), start = new Date(startedAt);
    const end = new Date(start.getTime() + 60_000);
    return entry(startedAt, localTimestamp(end.getFullYear(), end.getMonth(), end.getDate(), end.getHours(), end.getMinutes(), end.getSeconds()));
  });
  seedText(github, path, serializeMonthlyRecords(entries), 'daily');
  const pendingEntry = entry(localTimestamp(2026, 7, 18, 2), localTimestamp(2026, 7, 18, 2, 1));
  store.value.pendingWrites = [{ operation: 'completeTimer', id: 'pending-total', status: 'pending', retryCount: 0, stage: 'appendMonthly', monthlyPath: path, entry: pendingEntry, activeSnapshot: active(pendingEntry.startedAt), activeSha: 'active', queuedAt: pendingEntry.endedAt, lastError: '' }];
  const running = active(localTimestamp(2026, 7, 18, 11));
  store.value.activeCache = running;
  const data = await service({ github, store, recentDays: 1, clock: () => new Date(localTimestamp(2026, 7, 18, 12)) }).loadMenuData(50);
  assert.equal(data.recent.length, 50);
  assert.equal(data.todaySeconds, 56 * 60);
  assert.equal(data.todayTrackedMs, (56 * 60 + 3600) * 1000);
  assert.equal(data.weekTrackedMs, (56 * 60 + 3600) * 1000);
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
  const old = active('2026-08-18T08:00:00.000Z');
  const completed = entry(old.startedAt, '2026-08-18T09:00:00.000Z');
  const operation = { operation: 'completeTimer', id: fixedId, status: 'pending', retryCount: 0, stage: 'clearActive',
    monthlyPath: 'times/2026-08/alice.jsonl', entry: completed, activeSnapshot: old, activeSha: 'old-sha', queuedAt: completed.endedAt, lastError: '' };
  store.value.pendingWrites = [operation];
  store.value.activeCache = { ...old, _path: 'active/alice.json', _sha: 'old-sha' };
  await assert.rejects(() => tracker.syncPending(), error => error.code === 'not_found');
  assert.equal(store.value.pendingWrites.length, 1);
  assert.equal(store.value.pendingWrites[0].stage, 'clearActive');
  assert.equal(store.value.activeCache.startedAt, old.startedAt);
  assert.equal(store.value.recentCache.length, 0);
});


test('linked time edits save a crossed adjacent boundary in one monthly-file write', async () => {
  const github = new FakeGitHub(), path = 'times/2026-08/alice.jsonl';
  const previous = entry('2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z');
  const current = entry('2026-08-18T10:00:00.000Z', '2026-08-18T11:00:00.000Z', { issue: pull });
  seedText(github, path, serializeMonthlyRecords([previous, current]), 'linked');
  const saved = await service({ github }).editEntries({ entries: [
    { path, originalSha: 'linked', index: 0, original: { id: previous.id, issueUrl: previous.issue.url, issueTitle: '', startedAt: previous.startedAt, endedAt: previous.endedAt, description: '' }, edits: { endedAt: '2026-08-18T08:30:00.000Z' } },
    { path, originalSha: 'linked', index: 1, original: { id: current.id, issueUrl: current.issue.url, issueTitle: '', startedAt: current.startedAt, endedAt: current.endedAt, description: '' }, edits: { startedAt: '2026-08-18T08:30:00.000Z' } },
  ] });
  assert.equal(github.writes.length, 0);
  assert.equal(github.atomicWrites.length, 1);
  assert.equal(saved.length, 2);
  const parsed = parseMonthlyRecords(github.files.get(path).text, { user: 'alice', month: '2026-08' });
  assert.deepEqual(parsed.map(record => [record.startedAt, record.endedAt]), [
    ['2026-08-18T08:00:00.000Z', '2026-08-18T08:30:00.000Z'],
    ['2026-08-18T08:30:00.000Z', '2026-08-18T11:00:00.000Z'],
  ]);
});

test('linked edits preserve a persisted imported identity but reject newly entered non-URL identities', async () => {
  const github = new FakeGitHub(), path = 'times/2026-08/alice.jsonl';
  const identity = 'manticoresoftware/NexusRepo/Fixed-last-block-encoding';
  const original = entry('2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z', {
    taskUrl: identity, taskTitle: 'Imported task', issueTitle: 'Imported task', description: 'Old',
  });
  seedText(github, path, serializeMonthlyRecords([original]), 'original-sha');
  const request = { path, originalSha: 'original-sha', index: 0, original: {
    id: original.id, taskUrl: identity, issueUrl: identity, taskTitle: original.taskTitle,
    issueTitle: original.issueTitle, startedAt: original.startedAt, endedAt: original.endedAt, description: 'Old',
  } };
  const tracker = service({ github });
  await assert.rejects(() => tracker.editEntries({ entries: [{ ...request,
    edits: { taskUrl: 'other/project/new-task' },
  }] }), /Invalid task URL/);
  assert.equal(github.atomicWrites.length, 0);
  const [saved] = await tracker.editEntries({ entries: [{ ...request,
    edits: { endedAt: '2026-08-18T09:30:00.000Z', taskTitle: 'Reviewed', description: 'Updated' },
  }] });
  assert.equal(saved.taskUrl, identity);
  assert.equal(saved.endedAt, '2026-08-18T09:30:00.000Z');
  assert.equal(saved.taskTitle, 'Reviewed');
  assert.equal(saved.description, 'Updated');
  assert.equal(github.atomicWrites.length, 1);
});

test('linked time edits remain atomic when an adjusted Start moves across monthly files', async () => {
  const github = new FakeGitHub(), august = 'times/2026-08/alice.jsonl', september = 'times/2026-09/alice.jsonl';
  const previous = entry('2026-08-31T22:00:00.000Z', '2026-08-31T23:30:00.000Z');
  const current = entry('2026-09-01T00:00:00.000Z', '2026-09-01T01:00:00.000Z', { issue: pull });
  seedText(github, august, serializeMonthlyRecords([previous]), 'august');
  seedText(github, september, serializeMonthlyRecords([current]), 'september');
  await service({ github }).editEntries({ entries: [
    { path: august, originalSha: 'august', index: 0, original: { id: previous.id, issueUrl: previous.issue.url, issueTitle: '', startedAt: previous.startedAt, endedAt: previous.endedAt, description: '' }, edits: { endedAt: '2026-08-31T23:00:00.000Z' } },
    { path: september, originalSha: 'september', index: 0, original: { id: current.id, issueUrl: current.issue.url, issueTitle: '', startedAt: current.startedAt, endedAt: current.endedAt, description: '' }, edits: { startedAt: '2026-08-31T23:00:00.000Z' } },
  ] });
  assert.equal(github.atomicWrites.length, 1);
  assert.equal(parseMonthlyRecords(github.files.get(august).text, { user: 'alice', month: '2026-08' }).length, 2);
  assert.equal(github.files.has(september), false);
});


test('completed Add time is accepted and projected locally without any GitHub request, then synced', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), tracker = service({ github, store });
  const request = { taskUrl: issue.url, taskTitle: 'Investigate',
    startedAt: '2026-08-18T07:00:00.000Z', endedAt: '2026-08-18T08:00:00.000Z', description: 'Locally added' };
  const added = await tracker.addTime(request, { background: true });
  assert.equal(added.pending, true);
  assert.equal(added.entry.durationSeconds, 3600);
  assert.deepEqual(github.reads, [], 'local acceptance must not read remote history');
  assert.equal(github.atomicWrites.length, 0);
  assert.equal(store.value.pendingWrites.length, 1);
  assert.equal(store.value.recentCache[0]._pending, true);
  assert.equal((await tracker.projectActivityRecords([])).records[0].description, 'Locally added');
  await service({ github, store }).syncPending();
  assert.deepEqual(store.value.pendingWrites, []);
  assert.equal(github.atomicWrites.length, 1);
  assert.deepEqual(github.atomicWrites[0].changes.map(item => item.path).sort(), [TASK_INDEX_PATH, 'times/2026-08/alice.jsonl']);
  assert.equal(parseMonthlyRecords(github.files.get('times/2026-08/alice.jsonl').text, { user: 'alice', month: '2026-08' })[0].id, added.entry.id);
});

test('Add time with no End accepts a running timer locally before any GitHub access', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), tracker = service({ github, store });
  const result = await tracker.addTime({ taskUrl: issue.url,
    startedAt: '2026-08-18T08:00:00.000Z', endedAt: null }, { background: true });
  assert.equal(result.active._pending, true);
  assert.equal(result.active.startedAt, '2026-08-18T08:00:00.000Z');
  assert.deepEqual(github.reads, []);
  assert.equal(github.atomicWrites.length, 0);
  await service({ github, store }).syncPending();
  assert.equal(parseActiveRecord(github.files.get('active/alice.json').text, { user: 'alice' }).id, result.active.id);
});

test('completed Add time accepted offline remains recoverable after restart and cannot overwrite an overlapping GitHub record', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), request = {
    taskUrl: issue.url, startedAt: '2026-08-18T08:00:00.000Z', endedAt: '2026-08-18T09:00:00.000Z',
  };
  await service({ github, store }).addTime(request, { background: true });
  const before = structuredClone(store.value.pendingWrites);
  seedText(github, 'times/2026-08/alice.jsonl',
    serializeMonthlyRecords([entry('2026-08-18T08:30:00.000Z', '2026-08-18T09:30:00.000Z')]), 'raced');
  await service({ github, store }).syncPending();
  assert.equal(github.atomicWrites.length, 0);
  assert.equal(store.value.pendingWrites.length, before.length, 'a failed remote validation retains the durable intent');
  assert.equal(store.value.pendingWrites[0].status, 'conflict');
});

test('Bulk add persists the entire import locally first and later creates a single atomic GitHub commit', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-08/alice.jsonl';
  seedText(github, path, serializeMonthlyRecords([entry(localTimestamp(2026, 7, 21, 9), localTimestamp(2026, 7, 21, 10))]), 'before');
  const text = '2026-08-21 https://example.com/a First 2:00\n2026-08-21 https://example.com/b Second 1.5';
  const added = await service({ github, store }).bulkAddTimes(text, { background: true });
  assert.equal(added.added, 2);
  assert.equal(added.pending, true);
  assert.equal(added.entries.length, 2);
  assert.equal(github.reads.length, 0);
  assert.equal(github.atomicWrites.length, 0);
  assert.equal(store.value.pendingWrites.length, 1);
  assert.equal(store.value.pendingWrites[0].entries.length, 2);
  assert.equal((await service({ github, store }).projectActivityRecords([])).records.length, 2);
  const ids = store.value.pendingWrites[0].entries.map(row => row.id);
  await service({ github, store }).syncPending();
  assert.deepEqual(store.value.pendingWrites, []);
  assert.equal(github.atomicWrites.length, 1);
  const saved = parseMonthlyRecords(github.files.get(path).text, { user: 'alice', month: '2026-08' });
  assert.deepEqual(saved.slice(1).map(row => row.id), ids);
  assert.equal(saved[1].startedAt, new Date(localTimestamp(2026, 7, 21, 10)).toISOString());
  assert.equal(saved[2].endedAt, new Date(localTimestamp(2026, 7, 21, 13, 30)).toISOString());
});

test('Bulk add is durable on remote validation failure and never partially writes', async () => {
  const github = new FakeGitHub(), store = new MemoryStore();
  const submitted = await service({ github, store }).bulkAddTimes(
    '2026-08-21 https://example.com/a First 12:00\n2026-08-21 https://example.com/b Second 12:00',
    { background: true });
  assert.equal(submitted.added, 2);
  seedText(github, 'times/2026-08/alice.jsonl',
    serializeMonthlyRecords([entry(localTimestamp(2026, 7, 21, 12), localTimestamp(2026, 7, 21, 13))]), 'raced');
  await service({ github, store }).syncPending();
  assert.equal(github.atomicWrites.length, 0, 'rejected import is still all-or-nothing');
  assert.equal(store.value.pendingWrites.length, 1);
  assert.equal(store.value.pendingWrites[0].status, 'conflict');
});

test('locally accepted Add time still synchronizes after midnight and several days offline', async () => {
  const github = new FakeGitHub(), store = new MemoryStore();
  const initial = service({ github, store, timezone: 'UTC', clock: () => new Date('2026-08-18T09:00:00.000Z') });
  const result = await initial.addTime({
    taskUrl: issue.url, startedAt: '2026-08-18T07:00:00.000Z', endedAt: '2026-08-18T08:00:00.000Z',
    description: 'Saved offline',
  }, { background: true });
  assert.equal(result.pending, true);
  assert.equal(github.atomicWrites.length, 0);
  const resumed = service({ github, store, timezone: 'UTC', clock: () => new Date('2026-08-21T12:00:00.000Z') });
  await resumed.syncPending();
  assert.deepEqual(store.value.pendingWrites, []);
  const saved = parseMonthlyRecords(github.files.get('times/2026-08/alice.jsonl').text, {
    user: 'alice', month: '2026-08',
  });
  assert.equal(saved.length, 1);
  assert.equal(saved[0].id, result.entry.id);
  assert.equal(saved[0].description, 'Saved offline');
});

test('queued Add time retains its originally accepted timezone and metadata if the user travels before GitHub sync', async () => {
  const github = new FakeGitHub(), store = new MemoryStore();
  const original = service({ github, store, timezone: 'UTC',
    clock: () => new Date('2026-08-18T09:00:00.000Z') });
  const accepted = await original.addTime({
    taskUrl: issue.url, taskTitle: 'Timezone stable',
    startedAt: '2026-08-18T07:00:00.000Z', endedAt: '2026-08-18T08:00:00.000Z',
    description: 'Travel safe',
  }, { background: true });
  const remoteSync = service({ github, store, timezone: 'Pacific/Honolulu',
    clock: () => new Date('2026-08-22T09:00:00.000Z') });
  await remoteSync.syncPending();
  assert.deepEqual(store.value.pendingWrites, []);
  const [saved] = parseMonthlyRecords(github.files.get('times/2026-08/alice.jsonl').text,
    { user: 'alice', month: '2026-08' });
  assert.equal(saved.id, accepted.entry.id);
  assert.equal(saved.timezone, 'UTC');
  assert.equal(saved.entryDate, accepted.entry.entryDate);
  assert.equal(saved.createdAt, accepted.entry.createdAt);
  assert.equal(saved.updatedAt, accepted.entry.updatedAt);
  assert.equal(saved.description, accepted.entry.description);
});

test('queued Add time revalidates the original month rather than the current month after month rollover', async () => {
  const github = new FakeGitHub(), store = new MemoryStore();
  const original = service({ github, store, timezone: 'UTC', clock: () => new Date('2026-08-31T23:30:00.000Z') });
  await original.addTime({
    taskUrl: issue.url, startedAt: '2026-08-31T21:00:00.000Z', endedAt: '2026-08-31T22:00:00.000Z',
  }, { background: true });
  // A remote overlap in August must not be missed just because the retry is in September.
  seedText(github, 'times/2026-08/alice.jsonl', serializeMonthlyRecords([
    entry('2026-08-31T21:30:00.000Z', '2026-08-31T22:30:00.000Z'),
  ]), 'new-august-record');
  const resumed = service({ github, store, timezone: 'UTC', clock: () => new Date('2026-09-02T11:00:00.000Z') });
  await resumed.syncPending();
  assert.equal(github.atomicWrites.length, 0);
  assert.equal(store.value.pendingWrites.length, 1);
  assert.equal(store.value.pendingWrites[0].status, 'conflict');
});

test('queued completed Add time does not duplicate a GitHub commit after a service-worker crash', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), tracker = service({ github, store });
  const request = { taskUrl: issue.url, startedAt: '2026-08-18T07:00:00.000Z', endedAt: '2026-08-18T08:00:00.000Z' };
  const accepted = await tracker.addTime(request, { background: true });
  await tracker.addTime(request, { fixedId: accepted.entry.id, updateCache: false });
  const commits = github.atomicWrites.length;
  await service({ github, store }).syncPending();
  assert.deepEqual(store.value.pendingWrites, []);
  assert.equal(github.atomicWrites.length, commits, 'replaying a completed local addition never duplicates time');
  assert.equal(store.value.recentCache[0]._pending, undefined);
});

test('queued Bulk add survives restart without duplicating already committed records', async () => {
  const github = new FakeGitHub(), store = new MemoryStore();
  const text = '2026-08-21 https://example.com/one First 1\n2026-09-01 https://example.com/two Second 2';
  await service({ github, store }).bulkAddTimes(text, { background: true });
  const operation = structuredClone(store.value.pendingWrites[0]);
  await service({ github, store }).bulkAddTimes('', { requested: operation.requested, ids: operation.entries.map(row => row.id),
    updateCache: false, includeEntries: true });
  const commits = github.atomicWrites.length;
  await service({ github, store }).syncPending();
  assert.equal(github.atomicWrites.length, commits);
  assert.deepEqual(store.value.pendingWrites, []);
  assert.equal(parseMonthlyRecords(github.files.get('times/2026-08/alice.jsonl').text, { user: 'alice', month: '2026-08' }).length, 1);
  assert.equal(parseMonthlyRecords(github.files.get('times/2026-09/alice.jsonl').text, { user: 'alice', month: '2026-09' }).length, 1);
});

test('historical Bulk add entry outside the 50-row local cache can be edited before sync without GitHub reads', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), tracker = service({ github, store });
  const lines = Array.from({ length: 55 }, (_, i) =>
    `2026-08-21 https://example.com/task/${i} Row ${i} 0.25`).join('\n');
  await tracker.bulkAddTimes(lines, { background: true });
  const queued = store.value.pendingWrites[0].entries[0];
  assert.equal(store.value.recentCache.some(entry => entry.id === queued.id), false, 'oldest preview is evicted');
  const reads = github.reads.length;
  const local = { ...queued, _path: 'times/2026-08/alice.jsonl', _index: -1, _sha: null, _pending: true };
  await tracker.queueEntryEdit({
    path: local._path, originalSha: null, index: -1, original: local, edits: { description: 'Revised locally' },
  });
  assert.equal(github.reads.length, reads, 'editing an unsynced bulk entry uses the IndexedDB queue');
  assert.equal((await tracker.projectActivityRecords([])).records.find(entry => entry.id === queued.id).description, 'Revised locally');
  await service({ github, store }).syncPending();
  const saved = parseMonthlyRecords(github.files.get('times/2026-08/alice.jsonl').text, { user: 'alice', month: '2026-08' });
  assert.equal(saved.find(entry => entry.id === queued.id).description, 'Revised locally');
});

test('a remote overlap prevents queued Add time from writing and verified discard clears only its local record', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), tracker = service({ github, store });
  const request = { taskUrl: issue.url, startedAt: '2026-08-18T08:00:00.000Z', endedAt: '2026-08-18T09:00:00.000Z' };
  await tracker.addTime(request, { background: true });
  seedText(github, 'times/2026-08/alice.jsonl',
    serializeMonthlyRecords([entry('2026-08-18T08:30:00.000Z', '2026-08-18T09:30:00.000Z')]), 'raced');
  await tracker.syncPending();
  const id = store.value.pendingWrites[0].id;
  assert.equal(store.value.pendingWrites[0].status, 'conflict');
  const resolved = await tracker.resolvePendingConflict(id, 'discard_queued_addition');
  assert.deepEqual(resolved, { resolved: true, discarded: true });
  assert.deepEqual(store.value.pendingWrites, []);
  assert.deepEqual(store.value.recentCache, []);
  assert.equal(github.atomicWrites.length, 0);
});

test('Add time writes an exact completed interval and task index atomically', async () => {
  const github = new FakeGitHub(), tracker = service({ github });
  const result = await tracker.addTime({ taskUrl: issue.url + '?noise=1', taskTitle: 'Fix frontend',
    startedAt: '2026-08-18T07:00:00.000Z', endedAt: '2026-08-18T08:00:00.000Z', description: 'Investigation' });
  assert.equal(result.entry.taskUrl, issue.url);
  assert.equal(result.entry.durationSeconds, 3600);
  assert.equal(result.entry.description, 'Investigation');
  assert.equal(result.entry.taskTitle, 'Fix frontend');
  assert.deepEqual(github.atomicWrites[0].changes.map(change => change.path).sort(), ['.clockoli/tasks.json', 'times/2026-08/alice.jsonl']);
  assert.equal(github.atomicWrites[0].guards.find(guard => guard.path === 'active/alice.json')?.sha, null);
});

test('Add time reuses only an existing imported task identity and keeps writes atomic', async () => {
  const github = new FakeGitHub(), tracker = service({ github });
  const imported = 'acme/project/imported-task';
  const request = { taskUrl: imported, taskTitle: 'Imported task',
    startedAt: '2026-08-18T07:00:00.000Z', endedAt: '2026-08-18T08:00:00.000Z' };
  await assert.rejects(() => tracker.addTime(request), /existing imported task/i);
  assert.equal(github.atomicWrites.length, 0);
  seedText(github, TASK_INDEX_PATH, serializeTaskIndex(applyTaskIndexChanges(emptyTaskIndex('alice'), {
    add: [{ id: '01K3X7Q8N8F4J7R2JQZ5AKP1MD', taskUrl: imported, durationSeconds: 60 }],
  })));
  const result = await tracker.addTime(request);
  assert.equal(result.entry.taskUrl, imported);
  assert.deepEqual(github.atomicWrites[0].changes.map(change => change.path).sort(), ['.clockoli/tasks.json', 'times/2026-08/alice.jsonl']);
});

test('Add time rejects overlap and invalid bounds before writing', async () => {
  const github = new FakeGitHub(), tracker = service({ github });
  seedText(github, 'times/2026-08/alice.jsonl', serializeMonthlyRecords([entry('2026-08-18T07:30:00.000Z', '2026-08-18T08:30:00.000Z')]));
  for (const [start, end] of [
    ['2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z'],
    ['2026-08-18T08:30:00.000Z', '2026-08-18T08:30:00.000Z'],
    ['2026-08-18T08:30:00.000Z', '2026-08-18T10:00:00.000Z'],
  ]) await assert.rejects(() => tracker.addTime({ taskUrl: issue.url, startedAt: start, endedAt: end }), /overlap|after|future/i);
  assert.equal(github.atomicWrites.length, 0);
});

test('Add time with no end queues one timer at the selected start and preserves an existing timer', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), tracker = service({ github, store });
  const result = await tracker.addTime({ taskUrl: issue.url, startedAt: '2026-08-18T08:45:00.000Z', endedAt: null, description: 'Review' });
  assert.equal(result.active.startedAt, '2026-08-18T08:45:00.000Z');
  assert.equal(store.value.pendingWrites[0].nextActive.description, 'Review');
  await assert.rejects(() => tracker.addTime({ taskUrl: issue.url, startedAt: '2026-08-18T08:50:00.000Z', endedAt: null }), /already tracking/i);
  assert.equal(store.value.pendingWrites.length, 1);
  await service({ github, store }).syncPending();
  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(store.value.activeCache.startedAt, result.active.startedAt);
  assert.deepEqual(github.atomicWrites[0].guards.map(guard => guard.path), ['times/2026-08/alice.jsonl']);
});

test('Add time starts with only the current month even when older months exist', async () => {
  const github = new FakeGitHub(), store = new MemoryStore();
  seedText(github, 'times/2026-06/alice.jsonl', serializeMonthlyRecords([entry('2026-06-18T07:00:00.000Z', '2026-06-18T08:00:00.000Z')]));
  seedText(github, 'times/2026-08/alice.jsonl', serializeMonthlyRecords([entry('2026-08-17T07:00:00.000Z', '2026-08-17T08:00:00.000Z')]));
  github.listTextFilesSnapshot = () => { throw new Error('Add time must not list all history'); };
  const tracker = service({ github, store });
  const result = await tracker.addTime({ taskUrl: issue.url, startedAt: '2026-08-18T08:45:00.000Z' });
  assert.equal(result.active._pending, true);
  assert.deepEqual(github.reads.filter(path => path.startsWith('times/')), ['times/2026-08/alice.jsonl']);
  assert.equal(store.value.pendingWrites.length, 1);
});

test('Add time queued timer cannot sync after a completed interval changes across a restart', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-08/alice.jsonl';
  await service({ github, store }).addTime({ taskUrl: issue.url, startedAt: '2026-08-18T08:45:00.000Z' });
  seedText(github, path, serializeMonthlyRecords([entry('2026-08-18T08:30:00.000Z', '2026-08-18T09:00:00.000Z')]), 'raced');
  await service({ github, store }).syncPending();
  assert.equal(github.files.has('active/alice.json'), false);
  assert.equal(store.value.pendingWrites.length, 1);
  assert.equal(store.value.pendingWrites[0].status, 'conflict');
  await service({ github, store }).syncPending();
  assert.equal(github.files.has('active/alice.json'), false);
  assert.equal(store.value.pendingWrites[0].status, 'conflict');
});

test('Add time queued start retries after revalidating a nonoverlapping monthly change', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-08/alice.jsonl';
  await service({ github, store }).addTime({ taskUrl: issue.url, startedAt: '2026-08-18T08:45:00.000Z' });
  seedText(github, path, serializeMonthlyRecords([entry('2026-08-18T07:00:00.000Z', '2026-08-18T08:00:00.000Z')]), 'raced');
  await service({ github, store }).syncPending();
  const pending = store.value.pendingWrites[0];
  assert.equal(pending.status, 'conflict');
  assert.deepEqual(await service({ github, store }).resolvePendingConflict(pending.id), { resolved: true });
  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(parseActiveRecord(github.files.get('active/alice.json').text, { user: 'alice' }).startedAt, '2026-08-18T08:45:00.000Z');
  assert.deepEqual(github.atomicWrites[0].guards, [{ path, sha: 'raced' }]);
});

test('Add time queued start cannot revalidate overlap and can be explicitly discarded', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-08/alice.jsonl';
  await service({ github, store }).addTime({ taskUrl: issue.url, startedAt: '2026-08-18T08:45:00.000Z' });
  seedText(github, path, serializeMonthlyRecords([entry('2026-08-18T08:30:00.000Z', '2026-08-18T09:00:00.000Z')]), 'raced');
  await service({ github, store }).syncPending();
  const pending = store.value.pendingWrites[0];
  await assert.rejects(() => service({ github, store }).resolvePendingConflict(pending.id), /overlap/i);
  assert.equal(store.value.pendingWrites[0].status, 'conflict');
  assert.equal(github.files.has('active/alice.json'), false);
  assert.deepEqual(await service({ github, store }).resolvePendingConflict(pending.id, 'discard_queued_start'), { resolved: true, discarded: true });
  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(store.value.activeCache, null);
  assert.equal(github.files.has('active/alice.json'), false);
});

test('discard refuses a queued Add time start already committed despite a lost response', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-08/alice.jsonl';
  await service({ github, store }).addTime({ taskUrl: issue.url, startedAt: '2026-08-18T08:45:00.000Z' });
  const queued = store.value.pendingWrites[0];
  // GitHub accepted the guarded write, but the client never received its response.
  seedText(github, 'active/alice.json', serializeActiveRecord(queued.nextActive), 'committed');
  seedText(github, path, serializeMonthlyRecords([entry('2026-08-18T08:30:00.000Z', '2026-08-18T09:00:00.000Z')]), 'raced');
  await service({ github, store }).syncPending();
  assert.equal(store.value.pendingWrites[0].conflictReason, 'add_time_overlap_changed');
  await assert.rejects(() => service({ github, store }).resolvePendingConflict(queued.id, 'discard_queued_start'), /already running/i);
  assert.equal(store.value.pendingWrites.length, 1);
  assert.deepEqual(await service({ github, store }).resolvePendingConflict(queued.id), { resolved: true, alreadyRunning: true });
  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(store.value.activeCache.id, queued.nextActive.id);
  assert.equal(github.files.has('active/alice.json'), true);
});

test('discard keeps a queued Add time start when remote verification is unavailable', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-08/alice.jsonl';
  await service({ github, store }).addTime({ taskUrl: issue.url, startedAt: '2026-08-18T08:45:00.000Z' });
  seedText(github, path, serializeMonthlyRecords([entry('2026-08-18T08:30:00.000Z', '2026-08-18T09:00:00.000Z')]), 'raced');
  await service({ github, store }).syncPending();
  const queued = store.value.pendingWrites[0], pendingActive = store.value.activeCache;
  github.getText = async () => { throw new TypeError('network unavailable'); };
  await assert.rejects(() => service({ github, store }).resolvePendingConflict(queued.id, 'discard_queued_start'), /network unavailable/);
  assert.equal(store.value.pendingWrites[0].id, queued.id);
  assert.deepEqual(store.value.activeCache, pendingActive);
});

test('Add time checks yesterday across a month boundary before writing', async () => {
  const github = new FakeGitHub(), store = new MemoryStore();
  seedText(github, 'times/2026-08/alice.jsonl', serializeMonthlyRecords([
    entry('2026-08-31T23:45:00.000Z', '2026-09-01T00:45:00.000Z'),
  ]));
  const tracker = service({ github, store, timezone: 'UTC', clock: () => new Date('2026-09-01T01:00:00.000Z') });
  await assert.rejects(() => tracker.addTime({ taskUrl: issue.url,
    startedAt: '2026-09-01T00:30:00.000Z', endedAt: '2026-09-01T00:50:00.000Z' }), /overlap/i);
  assert.deepEqual(github.reads.filter(path => path.startsWith('times/')).sort(),
    ['times/2026-08/alice.jsonl', 'times/2026-09/alice.jsonl']);
  assert.equal(github.atomicWrites.length, 0);
});

test('Add time refuses a concurrent change to yesterday at a month boundary', async () => {
  const github = new FakeGitHub(), path = 'times/2026-08/alice.jsonl';
  seedText(github, path, serializeMonthlyRecords([entry('2026-08-31T20:00:00.000Z', '2026-08-31T21:00:00.000Z')]));
  const tracker = service({ github, timezone: 'UTC', clock: () => new Date('2026-09-01T01:00:00.000Z') });
  const original = github.updateTextsAtomic.bind(github);
  github.updateTextsAtomic = (...args) => {
    seedText(github, path, serializeMonthlyRecords([entry('2026-08-31T23:50:00.000Z', '2026-09-01T00:40:00.000Z')]), 'changed');
    return original(...args);
  };
  await assert.rejects(() => tracker.addTime({ taskUrl: issue.url,
    startedAt: '2026-09-01T00:20:00.000Z', endedAt: '2026-09-01T00:50:00.000Z' }), /changed while adding/i);
  assert.equal(github.atomicWrites.length, 0);
});

test('Add time accepts a historical date and guards both neighboring monthly partitions across midnight', async () => {
  const github = new FakeGitHub(), store = new MemoryStore();
  const tracker = service({ github, store, timezone: 'UTC', clock: () => new Date('2026-10-19T12:00:00.000Z') });
  const request = { taskUrl: issue.url, startedAt: '2026-08-31T23:00:00.000Z', endedAt: '2026-09-01T00:00:00.000Z' };
  const accepted = await tracker.addTime(request, { background: true });
  assert.equal(accepted.entry.entryDate, '2026-08-31');
  assert.deepEqual(github.reads, []);
  await tracker.syncPending();
  assert.deepEqual(store.value.pendingWrites, []);
  assert.equal(github.atomicWrites.length, 1);
  assert.deepEqual(github.reads.filter(path => path.startsWith('times/')).sort(),
    ['times/2026-08/alice.jsonl', 'times/2026-09/alice.jsonl']);
  assert.equal(github.atomicWrites[0].guards.some(guard => guard.path === 'times/2026-09/alice.jsonl'), true);
});

test('historical Add time keeps a cross-month remote overlap as a recoverable conflict', async () => {
  const github = new FakeGitHub(), store = new MemoryStore();
  const tracker = service({ github, store, timezone: 'UTC', clock: () => new Date('2026-10-19T12:00:00.000Z') });
  await tracker.addTime({ taskUrl: issue.url, startedAt: '2026-08-31T23:00:00.000Z',
    endedAt: '2026-09-01T01:00:00.000Z' }, { background: true });
  seedText(github, 'times/2026-09/alice.jsonl', serializeMonthlyRecords([
    entry('2026-09-01T00:30:00.000Z', '2026-09-01T02:00:00.000Z'),
  ]));
  await tracker.syncPending();
  assert.equal(github.atomicWrites.length, 0);
  assert.equal(store.value.pendingWrites.length, 1);
  assert.equal(store.value.pendingWrites[0].status, 'conflict');
});

test('historical Add time finds a long-running completed record from an earlier month', async () => {
  const github = new FakeGitHub(), store = new MemoryStore();
  const tracker = service({ github, store, timezone: 'UTC', clock: () => new Date('2026-10-19T12:00:00.000Z') });
  await tracker.addTime({ taskUrl: issue.url, startedAt: '2026-08-02T08:00:00.000Z',
    endedAt: '2026-08-02T09:00:00.000Z' }, { background: true });
  const olderPath = 'times/2026-07/alice.jsonl';
  seedText(github, olderPath, serializeMonthlyRecords([
    entry('2026-07-31T23:00:00.000Z', '2026-08-02T08:30:00.000Z'),
  ]));
  await tracker.syncPending();
  assert.ok(github.reads.includes(olderPath));
  assert.equal(github.atomicWrites.length, 0);
  assert.equal(store.value.pendingWrites[0].status, 'conflict');
  assert.equal(store.value.pendingWrites[0].conflictReason, 'add_time_overlap');
});

test('historical Add time cannot start a running timer over an older-month completion', async () => {
  const github = new FakeGitHub(), store = new MemoryStore();
  const tracker = service({ github, store, timezone: 'UTC', clock: () => new Date('2026-08-03T07:00:00.000Z') });
  await tracker.addTime({ taskUrl: issue.url, startedAt: '2026-08-02T08:00:00.000Z' }, { background: true });
  seedText(github, 'times/2026-07/alice.jsonl', serializeMonthlyRecords([
    entry('2026-07-31T23:00:00.000Z', '2026-08-02T08:30:00.000Z'),
  ]));
  await tracker.syncPending();
  assert.equal(github.atomicWrites.length, 0);
  assert.equal(github.files.has('active/alice.json'), false);
  assert.equal(store.value.pendingWrites[0].status, 'conflict');
  assert.equal(store.value.pendingWrites[0].conflictReason, 'add_time_overlap_changed');
});

test('historical running Add time keeps a raced older-month conflict recoverable', async () => {
  const github = new FakeGitHub(), store = new MemoryStore();
  const tracker = service({ github, store, timezone: 'UTC', clock: () => new Date('2026-08-03T07:00:00.000Z') });
  await tracker.addTime({ taskUrl: issue.url, startedAt: '2026-08-02T08:00:00.000Z' }, { background: true });
  const discover = github.listTextFilesSnapshot.bind(github);
  github.listTextFilesSnapshot = async prefix => {
    const snapshot = await discover(prefix);
    if (github.headSha === 'discovery-head') {
      github.headSha = 'raced-head';
      seedText(github, 'times/2026-07/alice.jsonl', serializeMonthlyRecords([
        entry('2026-07-31T23:00:00.000Z', '2026-08-02T08:30:00.000Z'),
      ]));
    }
    return snapshot;
  };
  const write = github.updateTextsAtomic.bind(github);
  github.updateTextsAtomic = (changes, message, options) => {
    if (options.expectedHeadSha !== github.headSha) throw github.conflict();
    return write(changes, message, options);
  };
  await tracker.syncPending();
  assert.equal(github.atomicWrites.length, 0);
  assert.equal(github.files.has('active/alice.json'), false);
  const pending = store.value.pendingWrites[0];
  assert.equal(pending.status, 'conflict');
  assert.equal(pending.conflictReason, 'add_time_overlap_changed');
  await assert.rejects(() => tracker.resolvePendingConflict(pending.id), /overlap/i);
  assert.equal(store.value.pendingWrites[0].status, 'conflict');
});

test('historical Add time guards discovered older monthly files in its atomic write', async () => {
  const github = new FakeGitHub(), store = new MemoryStore();
  const olderPath = 'times/2026-07/alice.jsonl';
  seedText(github, olderPath, serializeMonthlyRecords([
    entry('2026-07-31T08:00:00.000Z', '2026-07-31T09:00:00.000Z'),
  ]));
  const tracker = service({ github, store, timezone: 'UTC', clock: () => new Date('2026-10-19T12:00:00.000Z') });
  await tracker.addTime({ taskUrl: issue.url, startedAt: '2026-08-02T08:00:00.000Z',
    endedAt: '2026-08-02T09:00:00.000Z' }, { background: true });
  await tracker.syncPending();
  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(github.atomicWrites[0].expectedHeadSha, 'discovery-head');
  assert.ok(github.atomicWrites[0].guards.some(guard => guard.path === olderPath));
});

test('historical Add time rejects a new older monthly file raced after discovery', async () => {
  const github = new FakeGitHub(), store = new MemoryStore();
  const tracker = service({ github, store, timezone: 'UTC', clock: () => new Date('2026-10-19T12:00:00.000Z') });
  await tracker.addTime({ taskUrl: issue.url, startedAt: '2026-08-02T08:00:00.000Z',
    endedAt: '2026-08-02T09:00:00.000Z' }, { background: true });
  const discover = github.listTextFilesSnapshot.bind(github);
  github.listTextFilesSnapshot = async prefix => {
    const snapshot = await discover(prefix);
    github.headSha = 'raced-head';
    seedText(github, 'times/2026-07/alice.jsonl', serializeMonthlyRecords([
      entry('2026-07-31T23:00:00.000Z', '2026-08-02T08:30:00.000Z'),
    ]));
    return snapshot;
  };
  const write = github.updateTextsAtomic.bind(github);
  github.updateTextsAtomic = (changes, message, options) => {
    if (options.expectedHeadSha !== github.headSha) throw github.conflict();
    return write(changes, message, options);
  };
  await tracker.syncPending();
  assert.equal(github.atomicWrites.length, 0);
  assert.equal(store.value.pendingWrites[0].status, 'conflict');
});

test('Add time rejects intervals longer than 24 hours before local or remote work', async () => {
  const github = new FakeGitHub(), store = new MemoryStore();
  const tracker = service({ github, store, timezone: 'UTC', clock: () => new Date('2026-10-19T12:00:00.000Z') });
  const request = { taskUrl: issue.url, startedAt: '2026-08-18T07:00:00.000Z', endedAt: '2026-08-19T07:00:01.000Z' };
  for (const settings of [{ background: true }, {}]) {
    await assert.rejects(() => tracker.addTime(request, settings), /24 hours/i);
  }
  await assert.rejects(() => tracker.addTime({ ...request, endedAt: null }, { background: true }), /24 hours/i);
  const exactDay = await tracker.addTime({ ...request, endedAt: '2026-08-19T07:00:00.000Z' }, { background: true });
  assert.equal(exactDay.entry.durationSeconds, 24 * 60 * 60);
  assert.deepEqual(github.reads, []);
  assert.equal(store.value.pendingWrites.length, 1);
  assert.equal(github.atomicWrites.length, 0);
});

test('Add time preserves pending writes and rejects a remote race without losing time', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), tracker = service({ github, store });
  store.value.pendingWrites = [{ id: 'unresolved' }];
  await assert.rejects(() => tracker.addTime({ taskUrl: issue.url, startedAt: '2026-08-18T07:00:00.000Z', endedAt: '2026-08-18T08:00:00.000Z' }), /Pending time writes/i);
  assert.equal(store.value.pendingWrites.length, 1);
  store.value.pendingWrites = [];
  const original = github.updateTextsAtomic.bind(github);
  github.updateTextsAtomic = async (...args) => {
    seedText(github, 'times/2026-08/alice.jsonl', serializeMonthlyRecords([entry('2026-08-18T07:30:00.000Z', '2026-08-18T08:30:00.000Z')]));
    return original(...args);
  };
  await assert.rejects(() => tracker.addTime({ taskUrl: issue.url, startedAt: '2026-08-18T07:00:00.000Z', endedAt: '2026-08-18T08:00:00.000Z' }), /changed while adding/i);
  assert.equal(github.atomicWrites.length, 0);
});

test('bulk import appends entries after existing same-day time and stages same-day lines sequentially', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-08/alice.jsonl';
  seedText(github, path, serializeMonthlyRecords([entry(localTimestamp(2026, 7, 21, 9), localTimestamp(2026, 7, 21, 10))]), 'before');
  const tracker = service({ github, store, idFactory: value => `${fixedId.slice(0, -2)}${String(value).slice(-2)}` });
  const result = await tracker.bulkAddTimes(`2026/08/21 https://example.com/a First task 2:00\n2026-08-21 https://example.com/b Second task 1.5`);
  assert.deepEqual(result, { added: 2 });
  const saved = parseMonthlyRecords(github.files.get(path).text, { user: 'alice', month: '2026-08' });
  assert.equal(saved.length, 3);
  assert.equal(saved[1].startedAt, new Date(localTimestamp(2026, 7, 21, 10)).toISOString());
  assert.equal(saved[1].endedAt, new Date(localTimestamp(2026, 7, 21, 12)).toISOString());
  assert.equal(saved[2].startedAt, new Date(localTimestamp(2026, 7, 21, 12)).toISOString());
  assert.equal(saved[2].endedAt, new Date(localTimestamp(2026, 7, 21, 13, 30)).toISOString());
  assert.equal(saved[2].description, 'Second task');
});

test('bulk import is all-or-nothing when requested hours do not fit without crossing the day', async () => {
  const github = new FakeGitHub(), path = 'times/2026-08/alice.jsonl';
  seedText(github, path, serializeMonthlyRecords([entry(localTimestamp(2026, 7, 21, 23), localTimestamp(2026, 7, 22, 0))]), 'before');
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
  assert.deepEqual(github.atomicWrites[0].changes.map(change => change.path), ['times/2026-08/alice.jsonl', 'times/2026-09/alice.jsonl', TASK_INDEX_PATH]);
});


test('bulk import rejects intervals that would overlap the running timer', async () => {
  const github = new FakeGitHub(), store = new MemoryStore();
  const startedAt = localTimestamp(2026, 9, 2, 9);
  seedText(github, 'active/alice.json', serializeActiveRecord(active(startedAt)), 'active-sha');
  const tracker = service({ github, store });
  await assert.rejects(() => tracker.bulkAddTimes('2026-10-02 https://example.com/import Import 10'), /overlap the running timer/i);
  assert.equal(github.files.has('times/2026-10/alice.jsonl'), false);
  assert.equal(github.atomicWrites.length, 0);
});

test('bulk import starts after a completed entry that crosses in from the previous month', async () => {
  const github = new FakeGitHub(), store = new MemoryStore();
  const previousStart = localTimestamp(2026, 7, 31, 23, 30), previousEnd = localTimestamp(2026, 8, 1, 0, 30);
  seedText(github, 'times/2026-08/alice.jsonl', serializeMonthlyRecords([entry(previousStart, previousEnd)]), 'aug-sha');
  const tracker = service({ github, store, idFactory: () => '01K2ABCDEF0123456789ABCDE0' });
  await tracker.bulkAddTimes('2026-09-01 https://example.com/import Import 1');
  const imported = parseMonthlyRecords(github.files.get('times/2026-09/alice.jsonl').text, { user: 'alice', month: '2026-09', path: 'times/2026-09/alice.jsonl' });
  assert.equal(imported[0].startedAt, new Date(previousEnd).toISOString());
  assert.equal(imported[0].endedAt, new Date(localTimestamp(2026, 8, 1, 1, 30)).toISOString());
});


test('bulk import formats generated timestamps in the importing timezone across mixed-offset month boundaries', async () => {
  const previousTz = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
  try {
    const github = new FakeGitHub(), path = 'times/2026-08/alice.jsonl';
    const existing = entry('2026-08-31T23:00:00.000Z', '2026-09-01T06:00:00.000Z');
    seedText(github, path, serializeMonthlyRecords([existing]), 'aug-sha');

    const result = await service({ github }).bulkAddTimes('2026-08-31 https://example.com/import Mixed-zone 0.5');

    assert.deepEqual(result, { added: 1 });
    assert.equal(github.atomicWrites.length, 1);
    const saved = parseMonthlyRecords(github.files.get(path).text, { user: 'alice', month: '2026-08', path });
    assert.equal(saved[1].startedAt, '2026-09-01T06:00:00.000Z');
    assert.equal(saved[1].endedAt, '2026-09-01T06:30:00.000Z');
  } finally {
    if (previousTz === undefined) delete process.env.TZ;
    else process.env.TZ = previousTz;
  }
});

test('bulk import atomically guards a prior-month crossing partition against concurrent changes', async () => {
  const github = new FakeGitHub(), previousPath = 'times/2026-08/alice.jsonl';
  seedText(github, previousPath, '', 'aug-old');
  const originalAtomic = github.updateTextsAtomic.bind(github);
  github.updateTextsAtomic = async (changes, message, options) => {
    const crossing = entry(localTimestamp(2026, 7, 31, 23, 30), localTimestamp(2026, 8, 1, 0, 30));
    seedText(github, previousPath, serializeMonthlyRecords([crossing]), 'aug-new');
    return originalAtomic(changes, message, options);
  };
  await assert.rejects(() => service({ github }).bulkAddTimes('2026-09-01 https://example.com/import Import 1'), /changed during bulk import/i);
  assert.equal(github.files.has('times/2026-09/alice.jsonl'), false);
  assert.equal(github.atomicWrites.length, 0);
});

test('bulk import atomically guards against a timer started after occupancy validation', async () => {
  const github = new FakeGitHub(), activePath = 'active/alice.json';
  const originalAtomic = github.updateTextsAtomic.bind(github);
  github.updateTextsAtomic = async (changes, message, options) => {
    seedText(github, activePath, serializeActiveRecord(active(localTimestamp(2026, 9, 2, 0, 30))), 'active-new');
    return originalAtomic(changes, message, options);
  };
  await assert.rejects(() => service({ github }).bulkAddTimes('2026-10-02 https://example.com/import Import 1'), /changed during bulk import/i);
  assert.equal(github.files.has('times/2026-10/alice.jsonl'), false);
  assert.equal(github.atomicWrites.length, 0);
});


test('bulk import starts after an interval crossing from any older monthly partition', async () => {
  const github = new FakeGitHub(), oldPath = 'times/2026-07/alice.jsonl';
  const crossing = entry(localTimestamp(2026, 6, 31, 23), localTimestamp(2026, 8, 1, 1));
  seedText(github, oldPath, serializeMonthlyRecords([crossing]), 'july-sha');
  const tracker = service({ github });
  await tracker.bulkAddTimes('2026-09-01 https://example.com/import Import 1');
  const imported = parseMonthlyRecords(github.files.get('times/2026-09/alice.jsonl').text, { user: 'alice', month: '2026-09' });
  assert.equal(imported[0].startedAt, new Date(localTimestamp(2026, 8, 1, 1)).toISOString());
  assert.equal(imported[0].endedAt, new Date(localTimestamp(2026, 8, 1, 2)).toISOString());
  assert.deepEqual(github.atomicWrites[0].guards, [{ path: oldPath, sha: 'july-sha' }, { path: 'active/alice.json', sha: null }]);
  assert.equal(github.atomicWrites[0].expectedHeadSha, 'discovery-head');
});


test('a local Stop is accepted while an earlier Start is still writing to GitHub', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), tracker = service({ github, store });
  let releaseStart, startWriteBegan;
  const began = new Promise(resolve => { startWriteBegan = resolve; });
  const release = new Promise(resolve => { releaseStart = resolve; });
  const originalPut = github.putText.bind(github);
  github.putText = async (...args) => {
    if (args[0] === 'active/alice.json' && !github.files.has(args[0])) { startWriteBegan(); await release; }
    return originalPut(...args);
  };
  await tracker.start('https://example.com/first', 'First', '', { background: true });
  const firstSync = tracker.syncPending();
  await began;
  const stopped = await tracker.stop('Done while syncing', { background: true });
  assert.equal(stopped.pending, true, 'local acceptance does not await the in-flight GitHub write');
  assert.equal(store.value.activeCache, null, 'the later local Stop remains the effective UI state');
  releaseStart(); await firstSync;
  assert.deepEqual(store.value.pendingWrites.map(item => item.operation), ['completeTimer']);
  assert.equal(store.value.activeCache, null, 'the completed older Start cannot overwrite a newer local Stop');
  await tracker.syncPending();
  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(github.files.has('active/alice.json'), false);
});

test('a local Stop stays stopped when an earlier active edit finishes remotely', async () => {
  const github = new FakeGitHub(), store = new MemoryStore();
  const timer = active('2026-08-18T08:00:00.000Z');
  seedText(github, 'active/alice.json', serializeActiveRecord(timer), 'active-sha');
  store.value.activeCache = parseActiveRecord(github.files.get('active/alice.json').text, {
    user: 'alice', path: 'active/alice.json', sha: 'active-sha',
  });
  const tracker = service({ github, store, clock: () => new Date('2026-08-18T10:00:00.000Z') });
  await tracker.queueActiveStartEdit({
    original: { id: timer.id, startedAt: timer.startedAt },
    startedAt: '2026-08-18T08:30:00.000Z', description: 'Edited while running',
  });

  let releaseEdit, editWriteBegan;
  const began = new Promise(resolve => { editWriteBegan = resolve; });
  const release = new Promise(resolve => { releaseEdit = resolve; });
  const originalAtomic = github.updateTextsAtomic.bind(github);
  github.updateTextsAtomic = async (...args) => {
    if (args[1] === 'timer: edit start alice') { editWriteBegan(); await release; }
    return originalAtomic(...args);
  };

  const editSync = tracker.syncPending();
  await began;
  const stopped = await tracker.stop('Stopped during active edit', { background: true });
  assert.equal(stopped.pending, true);
  assert.equal(store.value.activeCache, null, 'Stop is projected immediately while the edit write is pending');
  releaseEdit(); await editSync;
  assert.deepEqual(store.value.pendingWrites.map(item => item.operation), ['completeTimer']);
  assert.equal(store.value.activeCache, null, 'the older edit completion cannot resurrect the stopped timer');
  await tracker.syncPending();
  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(github.files.has('active/alice.json'), false);
});

test('remote active refresh cannot overwrite a timer accepted while its read is pending', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), tracker = service({ github, store });
  seedText(github, 'active/alice.json', serializeActiveRecord(active('2026-08-18T08:00:00.000Z', { issue: pull })), 'remote-sha');
  let releaseRead, readStarted;
  const started = new Promise(resolve => { readStarted = resolve; }), release = new Promise(resolve => { releaseRead = resolve; });
  const originalGet = github.getText.bind(github); let delayed = false;
  github.getText = async (...args) => {
    if (!delayed && args[0] === 'active/alice.json') { delayed = true; readStarted(); await release; }
    return originalGet(...args);
  };
  const refreshing = tracker.getState({ refresh: true }); await started;
  const accepted = await tracker.start('https://example.com/new', 'New timer', '', { background: true });
  assert.equal(accepted._pending, true); releaseRead();
  const refreshed = await refreshing;
  assert.equal(refreshed.active.taskUrl, accepted.taskUrl);
  assert.equal(refreshed.active._pending, true);
  assert.deepEqual(refreshed.pendingWrites.map(item => item.operation), ['startTimer']);
  assert.equal(store.value.activeCache.taskUrl, accepted.taskUrl);
  assert.equal(store.value.activeCache._pending, true);
  assert.deepEqual(store.value.pendingWrites.map(item => item.operation), ['startTimer']);
});

test('matching remote active verification does not resurrect an optimistically stopped timer', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), tracker = service({ github, store });
  const timer = active('2026-08-18T08:00:00.000Z');
  const stopped = entry(timer.startedAt, '2026-08-18T09:00:00.000Z');
  const operation = { operation: 'completeTimer', id: fixedId, status: 'pending', retryCount: 0, stage: 'appendMonthly',
    monthlyPath: 'times/2026-08/alice.jsonl', entry: stopped, activeSnapshot: timer, activeSha: null, queuedAt: stopped.endedAt, lastError: '' };
  store.value.pendingWrites = [operation]; store.value.activeCache = null;
  seedText(github, 'active/alice.json', serializeActiveRecord(timer), 'active-sha');
  assert.equal(await tracker.activeStateFor(operation), 'matching');
  assert.equal(store.value.activeCache, null);
  assert.deepEqual(store.value.pendingWrites.map(item => item.id), [fixedId]);
});

test('background sync queue accepts Start, Stop, and another Start without blocking actions', async () => {
  const github = new FakeGitHub(), store = new MemoryStore();
  const times = [
    new Date('2026-08-18T08:00:00.000Z'),
    new Date('2026-08-18T09:00:00.000Z'),
    new Date('2026-08-18T09:00:00.000Z'),
  ];
  const tracker = service({ github, store, clock: () => times.shift() ?? new Date('2026-08-18T09:00:00.000Z') });
  await tracker.start('https://example.com/first', 'First', '', { background: true });
  await tracker.stop('Done', { background: true });
  await tracker.start('https://example.com/second', 'Second', '', { background: true });
  assert.deepEqual(store.value.pendingWrites.map(item => item.operation), ['startTimer', 'completeTimer', 'startTimer']);
  assert.equal(store.value.activeCache.taskUrl, 'https://example.com/second');
  await tracker.syncPending();
  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(parseActiveRecord(github.files.get('active/alice.json').text, { user: 'alice' }).taskUrl, 'https://example.com/second');
  assert.equal(parseMonthlyRecords(github.files.get('times/2026-08/alice.jsonl').text, { user: 'alice', month: '2026-08' })[0].taskUrl, 'https://example.com/first');
});

test('background switching durably queues the transition before any GitHub request and later converges', async () => {
  const github = new FakeGitHub(), store = new MemoryStore();
  seedText(github, 'active/alice.json', serializeActiveRecord(active('2026-08-18T08:00:00.000Z')), 'active-sha');
  store.value.activeCache = parseActiveRecord(github.files.get('active/alice.json').text, { user: 'alice', path: 'active/alice.json', sha: 'active-sha' });
  const tracker = service({ github, store });
  const accepted = await tracker.switchTask('https://example.com/next', 'Next task', '', { background: true });
  assert.equal(accepted.pending, true);
  assert.equal(accepted.active.taskUrl, 'https://example.com/next');
  assert.equal(accepted.stopped.localEntry.id, accepted.stopped.entry.id);
  assert.equal(accepted.stopped.localEntry._pending, true);
  assert.equal(accepted.stopped.localEntry._path, 'times/2026-08/alice.jsonl');
  assert.equal(github.reads.length + github.writes.length + github.deletes.length, 0, 'the UI response waits only for durable local storage');
  assert.equal(store.value.pendingWrites[0].operation, 'completeTimerAndStart');
  assert.equal(store.value.activeCache.taskUrl, 'https://example.com/next');
  await tracker.syncPending();
  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(parseActiveRecord(github.files.get('active/alice.json').text, { user: 'alice' }).taskUrl, 'https://example.com/next');
  assert.equal(parseMonthlyRecords(github.files.get('times/2026-08/alice.jsonl').text, { user: 'alice', month: '2026-08' })[0].taskUrl, issue.url);
});


test('queued switch resumes from startNext after a service-worker restart', async () => {
  const github = new FakeGitHub(), store = new MemoryStore();
  seedText(github, 'active/alice.json', serializeActiveRecord(active('2026-08-18T08:00:00.000Z')), 'active-sha');
  store.value.activeCache = parseActiveRecord(github.files.get('active/alice.json').text, { user: 'alice', path: 'active/alice.json', sha: 'active-sha' });
  const originalPut = github.putText.bind(github); let failTargetOnce = true;
  github.putText = async (...args) => {
    if (args[0] === 'active/alice.json' && !github.files.has(args[0]) && failTargetOnce) { failTargetOnce = false; throw new Error('offline'); }
    return originalPut(...args);
  };
  await service({ github, store }).switchTask('https://example.com/next', 'Next task', '', { background: true });
  await service({ github, store }).syncPending();
  assert.equal(store.value.pendingWrites[0].stage, 'startNext');
  assert.equal(store.value.activeCache._pending, true);
  const target = store.value.pendingWrites[0].nextActive;
  seedText(github, 'active/alice.json', serializeActiveRecord({ ...target, taskTitle: 'Remote title', issueTitle: 'Remote title' }), 'remote-target-sha');
  await service({ github, store }).syncPending();
  assert.equal(store.value.pendingWrites.length, 0);
  const adopted = parseActiveRecord(github.files.get('active/alice.json').text, { user: 'alice' });
  assert.equal(adopted.taskUrl, 'https://example.com/next');
  assert.equal(adopted.taskTitle, 'Remote title');
});

test('queued switch replaces an older remote timer with its later queued start', async () => {
  const github = new FakeGitHub(), store = new MemoryStore();
  seedText(github, 'active/alice.json', serializeActiveRecord(active('2026-08-18T08:00:00.000Z')), 'active-sha');
  store.value.activeCache = parseActiveRecord(github.files.get('active/alice.json').text, { user: 'alice', path: 'active/alice.json', sha: 'active-sha' });
  const tracker = service({ github, store });
  await tracker.switchTask('https://example.com/next', 'Next task', '', { background: true });
  const older = active('2026-08-18T08:30:00.000Z', { taskUrl: 'https://example.com/other', issue: undefined });
  seedText(github, 'active/alice.json', serializeActiveRecord(older), 'older-sha');
  await tracker.syncPending();
  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(store.value.activeCache.taskUrl, 'https://example.com/next');
  assert.equal(store.value.activeCache._pending, undefined);
  assert.equal(github.writes.at(-1).sha, 'older-sha');
  assert.equal(github.files.has('times/2026-08/alice.jsonl'), true);
});


test('persisted startNext conflict is automatically reconsidered under the later-start-wins policy', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), tracker = service({ github, store });
  await tracker.start('https://example.com/queued', 'Queued', '', { background: true });
  const operation = store.value.pendingWrites[0];
  operation.status = 'conflict';
  operation.retryCount = 5847;
  operation.lastError = 'Another timer started before the queued task switch completed. The queued target was preserved for recovery.';
  seedText(github, 'active/alice.json', serializeActiveRecord(active('2026-08-18T08:30:00.000Z', { taskUrl: 'https://example.com/older', issue: undefined })), 'older-sha');

  await tracker.syncPending();

  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(store.value.activeCache.taskUrl, 'https://example.com/queued');
  assert.equal(store.value.activeCache._pending, undefined);
  assert.equal(github.writes.at(-1).sha, 'older-sha');
});

test('queued switch adopts a newer remote timer and unblocks the queue automatically', async () => {
  const github = new FakeGitHub(), store = new MemoryStore();
  seedText(github, 'active/alice.json', serializeActiveRecord(active('2026-08-18T08:00:00.000Z')), 'active-sha');
  store.value.activeCache = parseActiveRecord(github.files.get('active/alice.json').text, { user: 'alice', path: 'active/alice.json', sha: 'active-sha' });
  const newer = active('2026-08-18T09:30:00.000Z', { taskUrl: 'https://example.com/other', issue: undefined });
  const tracker = service({ github, store });
  await tracker.switchTask('https://example.com/next', 'Next task', '', { background: true });
  seedText(github, 'active/alice.json', serializeActiveRecord(newer), 'newer-sha');
  await tracker.syncPending();
  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(store.value.activeCache.taskUrl, 'https://example.com/other');
  assert.equal(store.value.activeCache._sha, 'newer-sha');
  assert.equal(store.value.activeCache._pending, undefined);
});

test('queued switch reconciles to a remote timer that races with startNext', async () => {
  const github = new FakeGitHub(), store = new MemoryStore();
  seedText(github, 'active/alice.json', serializeActiveRecord(active('2026-08-18T08:00:00.000Z')), 'active-sha');
  store.value.activeCache = parseActiveRecord(github.files.get('active/alice.json').text, { user: 'alice', path: 'active/alice.json', sha: 'active-sha' });
  const newer = active('2026-08-18T08:30:00.000Z', { taskUrl: 'https://example.com/other', issue: undefined });
  const originalPut = github.putText.bind(github); let raceOnce = true;
  github.putText = async (...args) => {
    if (args[0] === 'active/alice.json' && !github.files.has(args[0]) && raceOnce) {
      raceOnce = false;
      seedText(github, 'active/alice.json', serializeActiveRecord(newer), 'newer-sha');
    }
    return originalPut(...args);
  };
  const tracker = service({ github, store });
  await tracker.switchTask('https://example.com/next', 'Next task', '', { background: true });
  await tracker.syncPending();
  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(store.value.activeCache.taskUrl, 'https://example.com/next');
  assert.equal(store.value.activeCache._pending, undefined);
});


test('background Start durably queues locally before any GitHub request', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), tracker = service({ github, store });
  const active = await tracker.start('https://example.com/fast-start', 'Fast start', '', { background: true });
  assert.equal(github.reads.length + github.writes.length + github.deletes.length, 0);
  assert.equal(active.taskUrl, 'https://example.com/fast-start');
  assert.equal(active._pending, true);
  assert.equal(store.value.pendingWrites[0].operation, 'startTimer');
  assert.equal(store.value.pendingWrites[0].stage, 'startNext');
  await tracker.syncPending();
  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(store.value.activeCache._pending, undefined);
});

test('discarding a queued active timer removes it without creating a completed entry', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), tracker = service({ github, store });
  const started = await tracker.start('https://example.com/discard-me', 'Discard me', '', { background: true });

  const discarded = await tracker.discardActive({ background: true });

  assert.equal(discarded.id, started.id);
  assert.equal(discarded.pending, true);
  assert.equal(store.value.activeCache, null, 'discard is accepted locally before GitHub synchronization');
  assert.deepEqual(store.value.pendingWrites.map(operation => operation.operation), ['startTimer', 'discardActive']);
  assert.equal(github.reads.length + github.writes.length + github.deletes.length, 0);

  await tracker.syncPending();
  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(github.files.has('active/alice.json'), false);
  assert.equal([...github.files.keys()].some(path => path.startsWith('times/')), false);
});

test('discarding a persisted active timer deletes only its active file and saves no time', async () => {
  const github = new FakeGitHub(), store = new MemoryStore();
  seedText(github, 'active/alice.json', serializeActiveRecord(active()), 'active-sha');
  store.value.activeCache = parseActiveRecord(github.files.get('active/alice.json').text, {
    user: 'alice', path: 'active/alice.json', sha: 'active-sha',
  });
  const tracker = service({ github, store });

  await tracker.discardActive({ background: true });
  assert.equal(store.value.activeCache, null);
  assert.equal(github.files.has('active/alice.json'), true, 'remote deletion waits for queued synchronization');

  await tracker.syncPending();
  assert.equal(github.files.has('active/alice.json'), false);
  assert.equal(github.deletes.length, 1);
  assert.equal([...github.files.keys()].some(path => path.startsWith('times/')), false);
});

test('queued background Start adopts an already-created matching timer after any GitHub create rejection', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), tracker = service({ github, store });
  await tracker.start('https://example.com/already-started', 'Already started', '', { background: true });
  const target = store.value.pendingWrites[0].nextActive;
  seedText(github, 'active/alice.json', serializeActiveRecord(target), 'remote-target-sha');
  github.putText = async (path, text, message, sha) => {
    if (path === 'active/alice.json' && !sha) {
      const error = new Error('A different GitHub validation response.');
      error.status = 422; error.code = 'validation';
      throw error;
    }
    throw new Error('unexpected write');
  };
  await tracker.syncPending();
  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(store.value.activeCache._sha, 'remote-target-sha');
  assert.equal(store.value.activeCache._pending, undefined);
});

test('queued background Start turns a permanent GitHub rejection into a conflict without retrying', async () => {
  const github = new FakeGitHub(), store = new MemoryStore();
  github.putText = async () => {
    const error = new Error('GitHub rejected the request');
    error.status = 422; error.code = 'validation';
    throw error;
  };
  const tracker = service({ github, store });
  await tracker.start('https://example.com/rejected-start', 'Rejected start', '', { background: true });
  await tracker.syncPending();
  const [operation] = store.value.pendingWrites;
  assert.equal(operation.status, 'conflict');
  assert.equal(operation.conflictReason, 'queued_write_validation');
  assert.equal(operation.retryCount, 1);
  assert.match(operation.lastError, /GitHub rejected starting this queued timer/);
  await tracker.syncPending();
  assert.equal(operation.retryCount, 1, 'a terminal validation rejection must not increment retries again');
});

test('background Stop durably queues locally before any GitHub request', async () => {
  const github = new FakeGitHub(), store = new MemoryStore();
  seedText(github, 'active/alice.json', serializeActiveRecord(active()), 'active-sha');
  store.value.activeCache = parseActiveRecord(github.files.get('active/alice.json').text, { user: 'alice', path: 'active/alice.json', sha: 'active-sha' });
  github.reads.length = 0; github.writes.length = 0; github.deletes.length = 0;
  const tracker = service({ github, store }), result = await tracker.stop('Done', { background: true });
  assert.equal(github.reads.length + github.writes.length + github.deletes.length, 0);
  assert.equal(result.pending, true);
  assert.equal(store.value.activeCache, null);
  assert.equal(store.value.pendingWrites[0].operation, 'completeTimer');
  await tracker.syncPending();
  assert.equal(store.value.pendingWrites.length, 0);
});


test('queued background Start survives a service-worker restart', async () => {
  const github = new FakeGitHub(), store = new MemoryStore();
  await service({ github, store }).start('https://example.com/restarted-start', 'Restarted start', '', { background: true });
  assert.equal(github.writes.length, 0);
  await service({ github, store }).syncPending();
  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(store.value.activeCache.taskUrl, 'https://example.com/restarted-start');
  assert.equal(parseActiveRecord(github.files.get('active/alice.json').text, { user: 'alice' }).taskUrl, 'https://example.com/restarted-start');
});

test('queued background Start replaces an older timer created remotely before synchronization', async () => {
  const github = new FakeGitHub(), store = new MemoryStore();
  await service({ github, store }).start('https://example.com/local-target', 'Local target', '', { background: true });
  const remote = active('2026-08-18T08:30:00.000Z', { taskUrl: 'https://example.com/remote-timer', issue: undefined });
  seedText(github, 'active/alice.json', serializeActiveRecord(remote), 'remote-sha');
  await service({ github, store }).syncPending();
  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(store.value.activeCache.taskUrl, 'https://example.com/local-target');
  assert.equal(store.value.activeCache._pending, undefined);
});

test('queued background Stop survives a service-worker restart', async () => {
  const github = new FakeGitHub(), store = new MemoryStore();
  seedText(github, 'active/alice.json', serializeActiveRecord(active()), 'active-sha');
  store.value.activeCache = parseActiveRecord(github.files.get('active/alice.json').text, { user: 'alice', path: 'active/alice.json', sha: 'active-sha' });
  await service({ github, store }).stop('Restarted stop', { background: true });
  assert.equal(github.files.has('active/alice.json'), true);
  await service({ github, store }).syncPending();
  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(github.files.has('active/alice.json'), false);
  assert.equal(store.value.recentCache[0].description, 'Restarted stop');
});

test('a second Stop cannot append another completion while the first Stop is clearing the active timer', async () => {
  class DelayedFirstCommitGitHub extends FakeGitHub {
    constructor() {
      super(); this.commitCalls = 0;
      this.firstCommitStarted = new Promise(resolve => { this.markFirstCommitStarted = resolve; });
      this.firstCommitRelease = new Promise(resolve => { this.releaseFirstCommit = resolve; });
    }
    async updateTextsAtomic(...args) {
      this.commitCalls += 1;
      if (this.commitCalls === 1) { this.markFirstCommitStarted(); await this.firstCommitRelease; }
      const result = await super.updateTextsAtomic(...args);
      if (this.commitCalls === 2) this.releaseFirstCommit();
      return result;
    }
  }
  const github = new DelayedFirstCommitGitHub(), aStore = new MemoryStore(), bStore = new MemoryStore();
  seedText(github, 'active/alice.json', serializeActiveRecord(active()), 'active');
  const a = service({ github, store: aStore, clock: () => new Date('2026-08-18T09:00:00Z'), idFactory: () => '01K2ABCDEF0123456789ABCDEF' });
  const b = service({ github, store: bStore, clock: () => new Date('2026-08-18T09:05:00Z'), idFactory: () => '01K2ABCDEF0123456789ABCDEG' });
  await a.refreshActive(); await b.refreshActive();
  await a.stop('first', { background: true }); await b.stop('second', { background: true });
  const firstSync = a.syncPending(); await github.firstCommitStarted;
  await b.syncPending(); await firstSync;
  const parsed = parseMonthlyRecords(github.files.get('times/2026-08/alice.jsonl').text, { user: 'alice', month: '2026-08' });
  assert.equal(parsed.length, 1);
  assert.equal(aStore.value.pendingWrites.length, 0);
  assert.equal(bStore.value.pendingWrites.length, 0);
});

test('active title backfill cannot turn a locally accepted Stop into a false timer conflict', async () => {
  const github = new FakeGitHub(), store = new MemoryStore();
  const untitled = active('2026-08-18T08:00:00.000Z', { issue: undefined, taskUrl: 'https://example.com/task', taskTitle: '', issueTitle: '' });
  seedText(github, 'active/alice.json', serializeActiveRecord(untitled), 'active');
  const tracker = service({ github, store, clock: () => new Date('2026-08-18T09:00:00Z') });
  const cached = await tracker.refreshActive();
  await tracker.stop('', { background: true });
  await tracker.backfillActiveIssueTitle(cached, new Map([[untitled.taskUrl, 'Fetched title']]));
  await tracker.syncPending();
  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(github.files.has('active/alice.json'), false);
  assert.equal(parseMonthlyRecords(github.files.get('times/2026-08/alice.jsonl').text, { user: 'alice', month: '2026-08' }).length, 1);
});

test('menu data keeps a locally accepted pending task switch in Recent and summary totals', async () => {
  const github = new FakeGitHub(), store = new MemoryStore();
  seedText(github, 'active/alice.json', serializeActiveRecord(active()), 'active');
  const tracker = service({ github, store, clock: () => new Date('2026-08-18T09:00:00Z') });
  await tracker.refreshActive();
  await tracker.switchTask('https://example.com/next', 'Next', 'done', { background: true });
  const data = await tracker.loadMenuData();
  assert.equal(data.pendingCount, 1);
  assert.equal(data.recent.length, 1);
  assert.equal(data.recent[0]._pending, true);
  assert.equal(data.todaySeconds, 3600);
});

test('title backfill that began before Stop acceptance cannot create a false conflict', async () => {
  const github = new FakeGitHub(), store = new MemoryStore();
  const untitled = active('2026-08-18T08:00:00.000Z', { issue: undefined, taskUrl: 'https://example.com/task', taskTitle: '', issueTitle: '' });
  seedText(github, 'active/alice.json', serializeActiveRecord(untitled), 'active');
  const tracker = service({ github, store, clock: () => new Date('2026-08-18T09:00:00Z') });
  const cached = await tracker.refreshActive();
  const originalPut = github.putText.bind(github); let releaseTitleWrite, titleWriteStarted;
  const started = new Promise(resolve => { titleWriteStarted = resolve; });
  const release = new Promise(resolve => { releaseTitleWrite = resolve; });
  github.putText = async (...args) => {
    if (String(args[2]).includes('add missing title')) { titleWriteStarted(); await release; }
    return originalPut(...args);
  };
  const backfill = tracker.backfillActiveIssueTitle(cached, new Map([[untitled.taskUrl, 'Fetched title']]));
  await started;
  await tracker.stop('', { background: true });
  releaseTitleWrite(); await backfill;
  await tracker.syncPending();
  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(github.files.has('active/alice.json'), false);
  assert.equal(parseMonthlyRecords(github.files.get('times/2026-08/alice.jsonl').text, { user: 'alice', month: '2026-08' }).length, 1);
});

test('title backfill between Stop verification and atomic commit retries automatically', async () => {
  const github = new FakeGitHub(), store = new MemoryStore();
  const untitled = active('2026-08-18T08:00:00.000Z', { issue: undefined, taskUrl: 'https://example.com/task', taskTitle: '', issueTitle: '' });
  seedText(github, 'active/alice.json', serializeActiveRecord(untitled), 'active');
  const tracker = service({ github, store, clock: () => new Date('2026-08-18T09:00:00Z') });
  await tracker.refreshActive(); await tracker.stop('Locally accepted stop', { background: true });
  const originalAtomic = github.updateTextsAtomic.bind(github), originalPut = github.putText.bind(github); let race = true;
  github.updateTextsAtomic = async (...args) => {
    if (race) {
      race = false;
      const remoteRecord = JSON.parse(serializeActiveRecord({ ...untitled, taskTitle: 'Fetched title', issueTitle: 'Fetched title' }));
      remoteRecord.actor.label = 'Remote actor extension';
      remoteRecord.metadata.remote = { keep: true };
      remoteRecord.metrics['vendor.tokens'] = { value: 42, unit: 'tokens', aggregation: 'sum', source: 'remote' };
      remoteRecord.vendor_extension = { keep: 'root' };
      await originalPut('active/alice.json', `${JSON.stringify(remoteRecord, null, 2)}\n`, 'add remote fields', github.files.get('active/alice.json').sha);
    }
    return originalAtomic(...args);
  };
  await tracker.syncPending();
  assert.equal(store.value.pendingWrites[0]?.status, 'pending');
  await tracker.syncPending();
  assert.equal(store.value.pendingWrites.length, 0);
  const saved = parseMonthlyRecords(github.files.get('times/2026-08/alice.jsonl').text, { user: 'alice', month: '2026-08' });
  assert.equal(saved[0].issueTitle, 'Fetched title');
  assert.equal(saved[0].endedAt, '2026-08-18T09:00:00.000Z');
  assert.equal(saved[0].description, 'Locally accepted stop');
  assert.equal(saved[0].actor.label, 'Remote actor extension');
  assert.deepEqual(saved[0].metadata.remote, { keep: true });
  assert.deepEqual(saved[0].metrics['vendor.tokens'], { value: 42, unit: 'tokens', aggregation: 'sum', source: 'remote' });
  assert.deepEqual(saved[0]._record.vendor_extension, { keep: 'root' });
  assert.equal(store.value.recentCache.length, 1);
  assert.equal(store.value.recentCache[0].issueTitle, 'Fetched title');
  assert.equal(store.value.recentCache[0]._pending, undefined);
});

test('menu data deduplicates a concurrent Stop loser against the persisted winner by timer identity', async () => {
  const github = new FakeGitHub(), store = new MemoryStore();
  const winner = entry('2026-08-18T08:00:00Z', '2026-08-18T08:55:00Z', { issue: undefined, taskUrl: 'https://example.com/task', taskTitle: 'Task', description: 'first Stop' });
  const loser = entry('2026-08-18T08:00:00Z', '2026-08-18T09:05:00Z', { id: winner.id, issue: undefined, taskUrl: 'https://example.com/task', taskTitle: 'Task', description: 'second Stop' });
  seedText(github, 'times/2026-08/alice.jsonl', serializeMonthlyRecords([winner]), 'month');
  store.value.pendingWrites = [{ operation: 'completeTimer', entry: loser, monthlyPath: 'times/2026-08/alice.jsonl' }];
  const tracker = service({ github, store, clock: () => new Date('2026-08-18T10:00:00Z') });
  const menu = await tracker.loadMenuData();
  assert.equal(menu.recent.length, 1);
  assert.equal(menu.todaySeconds, winner.durationSeconds);
});

test('live menu totals cover the complete ISO week across months with a one-day recent window', async () => {
  const github = new FakeGitHub(), store = new MemoryStore();
  const sunday = entry(localTimestamp(2026, 7, 30, 8), localTimestamp(2026, 7, 30, 9));
  const monday = entry(localTimestamp(2026, 7, 31, 8), localTimestamp(2026, 7, 31, 9));
  const today = entry(localTimestamp(2026, 8, 1, 8), localTimestamp(2026, 8, 1, 9));
  seedText(github, 'times/2026-08/alice.jsonl', serializeMonthlyRecords([sunday, monday]));
  seedText(github, 'times/2026-09/alice.jsonl', serializeMonthlyRecords([today]));
  store.value.activeCache = active(localTimestamp(2026, 8, 1, 10), { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
  let now = new Date(localTimestamp(2026, 8, 1, 11));
  const tracker = service({ github, store, recentDays: 1, clock: () => now });
  const data = await tracker.loadMenuData();
  assert.equal(data.recent.length, 1);
  assert.equal(data.todayTrackedMs, 2 * 3_600_000);
  assert.equal(data.weekTrackedMs, 3 * 3_600_000);
  assert.equal(data.active.entryDate, '2026-09-01');
  assert.equal(data.active.timezone, store.value.activeCache.timezone);
  assert.deepEqual(store.value.summaryCache, {
    reportDate: '2026-09-01',
    weekEntries: [
      ...parseMonthlyRecords(github.files.get('times/2026-08/alice.jsonl').text, { user: 'alice', month: '2026-08', path: 'times/2026-08/alice.jsonl', sha: 'seed' }).filter(value => value.id === monday.id),
      ...parseMonthlyRecords(github.files.get('times/2026-09/alice.jsonl').text, { user: 'alice', month: '2026-09', path: 'times/2026-09/alice.jsonl', sha: 'seed' }),
    ], computedAt: now.getTime(),
  });
  now = new Date(now.getTime() + 1000);
  const reads = github.reads.length;
  const restarted = service({ github, store, recentDays: 1, clock: () => now });
  const cached = await restarted.getCachedSummary();
  assert.equal(cached.todayTrackedMs, data.todayTrackedMs + 1000);
  assert.equal(cached.weekTrackedMs, data.weekTrackedMs + 1000);
  assert.equal(github.reads.length, reads);
  assert.equal((await tracker.loadMenuData()).todayTrackedMs, data.todayTrackedMs + 1000);
});

test('cached summary includes only the running timer whose local date is in the requested range', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), hourMs = 3_600_000;
  const now = new Date(2026, 0, 1, 1);
  store.value.summaryCache = {
    reportDate: '2026-01-01', weekEntries: [
      { id: 'today', entryDate: '2026-01-01', startedAt: '2026-01-01T00:00:00Z', endedAt: '2026-01-01T00:00:00.999Z', _sha: 'today-sha' },
      { id: 'yesterday', entryDate: '2025-12-31', startedAt: '2025-12-31T00:00:00.999Z', endedAt: '2025-12-31T01:00:00Z', _sha: 'yesterday-sha' },
    ], computedAt: now.getTime(),
  };
  const tracker = service({ github, store, clock: () => now });
  const startedAt = new Date(now.getTime() - 2 * hourMs).toISOString();
  for (const [entryDate, todayRunningMs, weekRunningMs] of [
    ['2026-01-01', 2 * hourMs, 2 * hourMs],
    ['2025-12-31', 0, 2 * hourMs],
    ['2025-12-28', 0, 0],
    ['2026-01-02', 0, 0],
  ]) {
    store.value.activeCache = active(startedAt, { entryDate, _sha: 'persisted-active' });
    assert.deepEqual(await tracker.getCachedSummary(), {
      todayTrackedMs: 999 + todayRunningMs, weekTrackedMs: hourMs + weekRunningMs, remoteWriteConfirmed: true,
    });
  }
  store.value.pendingWrites = [{ id: 'new-write', status: 'pending' }];
  assert.equal((await tracker.getCachedSummary()).remoteWriteConfirmed, false);
  store.value.pendingWrites = [];
  store.value.activeCache._pending = true;
  assert.equal((await tracker.getCachedSummary()).remoteWriteConfirmed, false);
  store.value.activeCache = null;
  assert.equal((await tracker.getCachedSummary()).remoteWriteConfirmed, true);
  for (const summaryCache of [null, { ...store.value.summaryCache, reportDate: '2025-12-31' }]) {
    store.value.summaryCache = summaryCache;
    assert.deepEqual(await tracker.getCachedSummary(), { todayTrackedMs: null, weekTrackedMs: null, remoteWriteConfirmed: false });
  }
  assert.deepEqual(github.reads, []);
  assert.deepEqual(github.metadataReads, []);
  assert.deepEqual(github.writes, []);
});

test('recovery projection survives restart and confirms remote saves only with persisted SHA evidence', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), tracker = service({ github, store });
  assert.equal((await tracker.getRecoveryState()).remoteWriteConfirmed, false);
  await tracker.start(issue, 'Task', '', { background: true });
  assert.equal((await tracker.getRecoveryState()).pendingCount, 1);
  assert.equal((await tracker.getRecoveryState()).remoteWriteConfirmed, false);
  await tracker.syncPending();
  assert.equal((await service({ github, store }).getRecoveryState()).remoteWriteConfirmed, true);
  await tracker.stop('', { background: true });
  await tracker.syncPending();
  assert.equal((await service({ github, store }).getRecoveryState()).remoteWriteConfirmed, true);
  store.value.pendingWrites = [{ id: 'blocked', operation: 'editEntry', status: 'conflict', stage: 'editEntry', conflictReason: 'queued_entry_missing', request: { privateField: 'must stay privileged' }, lastError: 'private diagnostic' }];
  assert.deepEqual(await tracker.getRecoveryState(), {
    pendingCount: 1, remoteWriteConfirmed: false,
    pendingWrites: [{ id: 'blocked', operation: 'editEntry', status: 'conflict', stage: 'editEntry', conflictReason: 'queued_entry_missing' }],
  });
});

test('ISO-week totals include prior local days across a year boundary and exclude a prior-week active timer', async () => {
  const github = new FakeGitHub(), store = new MemoryStore();
  const monday = entry(localTimestamp(2025, 11, 29, 8), localTimestamp(2025, 11, 29, 9));
  seedText(github, 'times/2025-12/alice.jsonl', serializeMonthlyRecords([monday]));
  store.value.activeCache = active(localTimestamp(2025, 11, 31, 23), { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
  const tracker = service({ github, store, recentDays: 1, clock: () => new Date(localTimestamp(2026, 0, 1, 1)) });
  let data = await tracker.loadMenuData();
  assert.equal(data.todayTrackedMs, 0);
  assert.equal(data.weekTrackedMs, 3 * 3_600_000);
  assert.equal(data.active.entryDate, '2025-12-31');
  store.value.activeCache = active(localTimestamp(2025, 11, 28, 23));
  data = await tracker.loadMenuData();
  assert.equal(data.todayTrackedMs, 0);
  assert.equal(data.weekTrackedMs, 3_600_000);
});

test('millisecond summary projections preserve sub-second record durations', async () => {
  const github = new FakeGitHub();
  const startedAt = new Date(localTimestamp(2026, 7, 18, 8));
  const endedAt = new Date(startedAt.getTime() + 999);
  const record = entry(startedAt.toISOString(), endedAt.toISOString(), { entryDate: '2026-08-18', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
  seedText(github, 'times/2026-08/alice.jsonl', serializeMonthlyRecords([record]));
  const data = await service({ github, clock: () => new Date(localTimestamp(2026, 7, 18, 12)) }).loadMenuData();
  assert.equal(data.todayTrackedMs, 999);
  assert.equal(data.weekTrackedMs, 999);
});

for (const linked of [false, true]) {
  test(`menu and cached week totals preserve queued ${linked ? 'linked' : 'single'} edits outside Recent`, async () => {
    const github = new FakeGitHub(), store = new MemoryStore();
    const path = 'times/2026-08/alice.jsonl';
    const original = entry('2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z');
    seedText(github, path, serializeMonthlyRecords([original]), 'monthly-sha');
    const tracker = service({ github, store, recentDays: 1, clock: () => new Date('2026-08-18T12:00:00Z') });
    await tracker.loadMenuData();
    const request = { path, originalSha: 'monthly-sha', index: 0, original, edits: { startedAt: '2026-08-18T07:00:00.000Z' } };
    if (linked) await tracker.queueEntriesEdit({ entries: [request] });
    else await tracker.queueEntryEdit(request);
    assert.equal((await tracker.getCachedSummary()).todayTrackedMs, 7_200_000);
    const menu = await tracker.loadMenuData();
    assert.equal(menu.recent[0].startedAt, request.edits.startedAt);
    assert.equal(menu.recent[0]._pending, true);
    assert.equal(menu.todayTrackedMs, 7_200_000);
    assert.equal(menu.weekTrackedMs, 7_200_000);
    assert.equal(menu.pendingCount, 1);
    assert.equal(store.value.recentCache[0]._pending, true);
    const nextDay = service({ github, store, recentDays: 1, clock: () => new Date('2026-08-19T12:00:00Z') });
    const nextMenu = await nextDay.loadMenuData();
    assert.deepEqual(nextMenu.recent, []);
    assert.equal(nextMenu.weekTrackedMs, 7_200_000);
    const reads = github.reads.length;
    assert.equal((await nextDay.getCachedSummary()).weekTrackedMs, 7_200_000);
    assert.equal(github.reads.length, reads);
  });
}

test('menu refresh applies both sides of an accepted linked boundary edit in one projection', async () => {
  const github = new FakeGitHub(), store = new MemoryStore(), path = 'times/2026-08/alice.jsonl';
  const previous = entry('2026-08-18T06:00:00.000Z', '2026-08-18T08:00:00.000Z');
  const current = entry('2026-08-18T08:00:00.000Z', '2026-08-18T09:00:00.000Z');
  seedText(github, path, serializeMonthlyRecords([previous, current]), 'monthly-sha');
  const tracker = service({ github, store, clock: () => new Date('2026-08-18T12:00:00Z') });
  await tracker.loadMenuData();
  await tracker.queueEntriesEdit({ entries: [
    { path, originalSha: 'monthly-sha', index: 0, original: previous, edits: { endedAt: '2026-08-18T07:00:00.000Z' } },
    { path, originalSha: 'monthly-sha', index: 1, original: current, edits: { startedAt: '2026-08-18T07:00:00.000Z' } },
  ] });
  const menu = await tracker.loadMenuData();
  assert.equal(menu.pendingCount, 1);
  assert.equal(menu.recent.find(value => value.id === previous.id).endedAt, '2026-08-18T07:00:00.000Z');
  assert.equal(menu.recent.find(value => value.id === current.id).startedAt, '2026-08-18T07:00:00.000Z');
  assert.ok(menu.recent.every(value => value._pending));
  assert.equal(menu.todayTrackedMs, 10_800_000);
  assert.equal(menu.weekTrackedMs, 10_800_000);
  const restarted = service({ github, store, clock: () => new Date('2026-08-18T12:00:00Z') });
  assert.equal((await restarted.getCachedSummary()).todayTrackedMs, 10_800_000);
});

test('reopening immediately after an IndexedDB-queued Timeline edit retains the local interval', async () => {
  const github = new FakeGitHub(), store = new MemoryStore();
  const path = 'times/2026-08/alice.jsonl';
  const saved = entry('2026-08-18T08:00:00.000Z', '2026-08-18T08:30:00.000Z');
  seedText(github, path, serializeMonthlyRecords([saved]), 'original-sha');
  const tracker = service({ github, store });
  const [cached] = (await tracker.readMonthly(path)).entries;
  store.value.recentCache = [cached];
  store.value.summaryCache = { reportDate: '2026-08-18', weekEntries: [cached], computedAt: Date.now() };
  await tracker.queueEntryEdit({
    path, originalSha: 'original-sha', index: 0,
    original: { id: cached.id }, edits: {
      startedAt: '2026-08-18T07:45:00.000Z', endedAt: '2026-08-18T08:15:00.000Z',
    },
  });
  const expected = store.value.recentCache[0];
  const disconnected = service({ github, store });
  github.getText = async () => { throw new Error('GitHub is unavailable'); };
  const reloaded = await disconnected.loadMenuData();
  assert.equal(reloaded.recent.find(item => item.id === cached.id)?.startedAt, expected.startedAt);
  assert.equal(reloaded.recent.find(item => item.id === cached.id)?.endedAt, expected.endedAt);
  assert.equal(store.value.pendingWrites.length, 1, 'the saved local edit must remain queued');
});

test('an older in-flight GitHub recent load must not overwrite a newer committed local edit', async () => {
  const github = new FakeGitHub(), store = new MemoryStore();
  const path = 'times/2026-08/alice.jsonl';
  const original = entry('2026-08-18T08:00:00.000Z', '2026-08-18T08:30:00.000Z');
  seedText(github, path, serializeMonthlyRecords([original]), 'original-sha');
  const tracker = service({ github, store });
  const [cached] = (await tracker.readMonthly(path)).entries;
  store.value.recentCache = [cached];
  store.value.summaryCache = { reportDate: '2026-08-18', weekEntries: [cached], computedAt: Date.now() };
  let reached, release;
  const started = new Promise(resolve => { reached = resolve; });
  const allowResponse = new Promise(resolve => { release = resolve; });
  const originalRead = github.getText.bind(github);
  github.getText = async requested => {
    const result = await originalRead(requested).catch(error => error);
    if (requested === path) { reached(); await allowResponse; }
    if (result instanceof Error) throw result;
    return result;
  };
  const refreshing = tracker.loadMenuData();
  await started;
  const updated = { ...cached, startedAt: '2026-08-18T07:40:00.000Z',
    endedAt: '2026-08-18T08:10:00.000Z', _sha: 'new-commit-sha' };
  // The queued edit has completed on GitHub while an older read is still in flight.
  store.value.recentCache = [updated];
  store.value.summaryCache = { reportDate: '2026-08-18', weekEntries: [updated], computedAt: Date.now() };
  release();
  const result = await refreshing;
  assert.equal(result.recent[0]?.startedAt, updated.startedAt);
  assert.equal(store.value.recentCache[0]?.startedAt, updated.startedAt);
  assert.equal(store.value.recentCache[0]?._sha, 'new-commit-sha');
});


test('minute flush batches distinct locally queued timeline edits into one non-reference Git commit', async () => {
  const github = new FakeGitHub(), store = new MemoryStore();
  const path = 'times/2026-08/alice.jsonl';
  const a = entry('2026-08-18T08:00:00.000Z', '2026-08-18T08:30:00.000Z');
  const b = entry('2026-08-18T10:00:00.000Z', '2026-08-18T10:30:00.000Z');
  seedText(github, path, serializeMonthlyRecords([a, b]), 'seed-sha');
  const tracker = service({ github, store });
  const rows = (await tracker.readMonthly(path)).entries;
  store.value.recentCache = rows;
  await tracker.queueEntryEdit({
    path, originalSha: 'seed-sha', index: 0, original: rows[0],
    edits: { startedAt: '2026-08-18T08:10:00.000Z' },
  });
  await tracker.queueEntryEdit({
    path, originalSha: 'seed-sha', index: 1, original: rows[1],
    edits: { endedAt: '2026-08-18T10:40:00.000Z' },
  });
  assert.equal(github.atomicWrites.length, 0, 'both edits must remain durable locally until the scheduled flush');
  await tracker.syncPending();
  assert.equal(github.atomicWrites.length, 1, 'routine entry edits should share one atomic Git commit');
  assert.match(github.atomicWrites[0].message, /^time: edit linked entries alice$/);
  assert.doesNotMatch(github.atomicWrites[0].message, /tracked|#[0-9]+/);
  const saved = parseMonthlyRecords(github.files.get(path).text, { user: 'alice', month: '2026-08' });
  assert.equal(saved[0].startedAt, '2026-08-18T08:10:00.000Z');
  assert.equal(saved[1].endedAt, '2026-08-18T10:40:00.000Z');
  assert.deepEqual(store.value.pendingWrites, []);
});

test('every Stop retains its own GitHub issue-reference tracking commit in a minute flush', async () => {
  const github = new FakeGitHub(), store = new MemoryStore();
  const times = [
    new Date('2026-08-18T08:00:00.000Z'),
    new Date('2026-08-18T09:00:00.000Z'),
    new Date('2026-08-18T10:00:00.000Z'),
    new Date('2026-08-18T11:00:00.000Z'),
  ];
  const tracker = service({ github, store, clock: () => times.shift() ?? new Date('2026-08-18T11:00:00.000Z'), idFactory: deterministicRecordId });
  await tracker.start(issue.url, 'Issue 123', '', { background: true });
  await tracker.stop('', { background: true });
  await tracker.start(pull.url, 'PR 44', '', { background: true });
  await tracker.stop('', { background: true });
  assert.equal(github.atomicWrites.length, 0);
  await tracker.syncPending();
  const tracked = github.atomicWrites.filter(write => /^time: alice tracked /.test(write.message));
  assert.equal(tracked.length, 2);
  assert.match(tracked[0].message, / on acme\/frontend#123$/);
  assert.match(tracked[1].message, / on acme\/frontend#44$/);
  assert.notEqual(tracked[0].message, tracked[1].message);
  assert.equal(store.value.pendingWrites.length, 0);
});
