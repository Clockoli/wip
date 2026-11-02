import test from 'node:test';
import assert from 'node:assert/strict';
import { TrackerService } from '../src/services/tracker.js';
import { parseMonthlyRecords, serializeMonthlyRecords } from '../src/domain/work-records.js';
import { applyTaskIndexChanges, emptyTaskIndex, parseTaskIndex, serializeTaskIndex, TASK_INDEX_PATH } from '../src/domain/task-index.js';

const taskUrl = 'https://github.com/acme/frontend/issues/123';
const actor = { kind: 'human', id: 'github:123', name: 'alice' };
const producer = { kind: 'browser_extension', name: 'clockoli-chrome', version: '0.3.0' };
const id = suffix => `01K2ABCDEF0123456789ABCDE${suffix}`;
const path = month => `times/${month}/alice.jsonl`;
function entry(suffix, date, start, end) {
  const startedAt = `${date}T${start}.000Z`, endedAt = `${date}T${end}.000Z`;
  return {
    schemaVersion: 1, id: id(suffix), entryId: id(suffix), user: 'alice', actor, producer,
    taskUrl, taskTitle: '', issueTitle: '', entryDate: date, timezone: 'UTC', startedAt, endedAt,
    durationSeconds: Math.floor((new Date(endedAt) - new Date(startedAt)) / 1000),
    description: '', metadata: {}, metrics: {}, createdAt: startedAt, updatedAt: endedAt,
  };
}
class Store {
  constructor() { this.value = { activeCache: null, recentCache: [], pendingWrites: [], user: 'alice' }; }
  async getState() { return structuredClone(this.value); }
  async mutateState(mutate) {
    const patch = mutate(structuredClone(this.value));
    if (patch) Object.assign(this.value, structuredClone(patch));
    return structuredClone(this.value);
  }
}
class GitHub {
  constructor() { this.files = new Map(); this.atomicWrites = []; this.serial = 0; }
  async getText(filePath) {
    const file = this.files.get(filePath);
    if (!file) throw Object.assign(new Error('not found'), { status: 404, code: 'not_found' });
    return { path: filePath, ...file };
  }
  async assertDestinationReachable() { return true; }
  async listTextFilesSnapshot(prefix) {
    return { notModified: false, etag: '', headSha: 'test-head', files: [...this.files]
      .filter(([filePath]) => filePath.startsWith(prefix))
      .map(([filePath, file]) => ({ path: filePath, sha: file.sha, size: file.text.length })) };
  }
  async getBlobText(filePath, sha) {
    const file = await this.getText(filePath);
    assert.equal(file.sha, sha);
    return { sha, text: file.text };
  }
  async updateTextsAtomic(changes, message, { guards = [] } = {}) {
    for (const item of [...changes, ...guards]) {
      if ((this.files.get(item.path)?.sha ?? null) !== (item.sha ?? null)) {
        throw Object.assign(new Error('conflict'), { status: 409, code: 'conflict' });
      }
    }
    const blobShas = {}, commitSha = `commit-${++this.serial}`;
    for (const item of changes) {
      if (item.text === null) this.files.delete(item.path);
      else {
        blobShas[item.path] = `${commitSha}:${item.path}`;
        this.files.set(item.path, { sha: blobShas[item.path], text: item.text });
      }
    }
    this.atomicWrites.push({ changes: structuredClone(changes), message });
    return { commitSha, blobShas };
  }
}
function seed(github, filePath, entries, sha = 'original-sha') {
  github.files.set(filePath, { sha, text: serializeMonthlyRecords(entries) });
  github.files.set(TASK_INDEX_PATH, {
    sha: 'index-sha', text: serializeTaskIndex(applyTaskIndexChanges(emptyTaskIndex('alice'), { add: entries })),
  });
}
function tracker(github, store) {
  return new TrackerService({ github, store, user: 'alice', actorId: 'github:123', actorName: 'alice',
    clock: () => new Date('2026-11-01T12:00:00.000Z'), allowedIssueOwners: ['acme'] });
}
function queuedEdit(target, month, edits, status = 'pending', reason = '', suffix = 'A') {
  return { id: `edit-${suffix}`, operation: 'editEntry', stage: 'editEntry', status, conflictReason: reason,
    request: { path: path(month), originalSha: 'original-sha', index: 0, original: target, edits },
    queuedAt: '2026-11-01T11:00:00.000Z', retryCount: 0, lastError: '' };
}
function queuedAddition(target) {
  return { id: 'new-addition', operation: 'addTime', stage: 'addTime', status: 'pending', entry: target,
    queuedAt: '2026-11-01T11:01:00.000Z', retryCount: 0, lastError: '' };
}

test('wrong-month queued edit rebases by verified record ID, preserving the task index', async () => {
  const github = new GitHub(), store = new Store();
  const original = entry('0', '2026-10-29', '08:00:00', '08:00:14');
  seed(github, path('2026-10'), [original]);
  store.value.pendingWrites = [queuedEdit(original, '2026-11', { endedAt: '2026-10-29T16:00:00.000Z' },
    'conflict', 'queued_entry_missing')];
  store.value.recentCache = [{ ...original, _path: path('2026-11'), _sha: 'original-sha', _index: 0, _pending: true }];

  await tracker(github, store).syncPending();
  assert.equal(store.value.pendingWrites.length, 0, JSON.stringify(store.value.pendingWrites.map(x =>
    ({ status: x.status, reason: x.conflictReason, error: x.lastError }))));
  assert.equal(github.files.has(path('2026-11')), false);
  const [saved] = parseMonthlyRecords(github.files.get(path('2026-10')).text, { path: path('2026-10') });
  assert.equal(saved.id, original.id);
  assert.equal(saved.durationSeconds, 8 * 3600);
  assert.equal(parseTaskIndex(github.files.get(TASK_INDEX_PATH).text).tasks[taskUrl].totalSeconds, 8 * 3600);
});

test('overlapping queued edit identifies the actual conflicting GitHub entry without losing the draft', async () => {
  const github = new GitHub(), store = new Store();
  const original = entry('B', '2026-10-29', '08:00:00', '09:00:00');
  const blocker = { ...entry('C', '2026-10-29', '09:30:00', '11:00:00'), taskTitle: 'Review' };
  seed(github, path('2026-10'), [original, blocker]);
  store.value.pendingWrites = [queuedEdit(original, '2026-10', { endedAt: '2026-10-29T10:00:00.000Z' })];
  await tracker(github, store).syncPending();
  assert.equal(store.value.pendingWrites[0].status, 'conflict');
  assert.equal(store.value.pendingWrites[0].conflictWith?.id, blocker.id);
  assert.equal(store.value.pendingWrites[0].conflictWith?.taskTitle, 'Review');
  assert.equal(parseMonthlyRecords(github.files.get(path('2026-10')).text, { path: path('2026-10') })[0].endedAt,
    original.endedAt);
});

test('a stale local month path cannot accept a new completed edit', async () => {
  const github = new GitHub(), store = new Store();
  const original = entry('6', '2026-10-29', '08:00:00', '09:00:00');
  seed(github, path('2026-10'), [original]);
  store.value.recentCache = [{ ...original, _path: path('2026-11'), _sha: 'original-sha', _index: 0 }];
  await assert.rejects(tracker(github, store).queueEntryEdit({
    path: path('2026-11'), originalSha: 'original-sha', index: 0, original,
    edits: { description: 'must not target November' },
  }), /monthly file|reload/i);
  assert.equal(store.value.pendingWrites.length, 0);
  assert.equal(github.atomicWrites.length, 0);
});

test('unresolved conflict preserves local work while independent later Add time and edit sync across restart', async () => {
  const github = new GitHub(), store = new Store();
  const missing = entry('1', '2026-10-29', '08:00:00', '09:00:00');
  const existing = entry('2', '2026-10-09', '08:00:00', '09:00:00');
  const added = entry('3', '2026-10-30', '08:00:00', '16:00:00');
  seed(github, path('2026-10'), [existing]);
  store.value.pendingWrites = [
    queuedEdit(missing, '2026-10', { description: 'unsaved change' }, 'conflict', 'queued_entry_missing'),
    queuedAddition(added), queuedEdit(existing, '2026-10', { description: 'independent correction' }, 'pending', '', 'B'),
  ];
  store.value.recentCache = [missing, existing, added].map(x => ({ ...x, _path: path('2026-10'),
    _sha: 'original-sha', _index: 0, _pending: true }));

  await tracker(github, store).syncPending();
  assert.deepEqual(store.value.pendingWrites.map(x => x.id), ['edit-A'], JSON.stringify(store.value.pendingWrites.map(x =>
    ({ operation: x.operation, status: x.status, reason: x.conflictReason, error: x.lastError }))));
  assert.equal(store.value.pendingWrites[0].status, 'conflict');
  const saved = parseMonthlyRecords(github.files.get(path('2026-10')).text, { path: path('2026-10') });
  assert.equal(saved.length, 2);
  assert.equal(saved.find(x => x.id === existing.id).description, 'independent correction');
  assert.equal(saved.find(x => x.id === added.id).durationSeconds, 8 * 3600);
  assert.equal(parseTaskIndex(github.files.get(TASK_INDEX_PATH).text).tasks[taskUrl].sessionCount, 2);
  const writes = github.atomicWrites.length;
  await tracker(github, store).syncPending();
  assert.equal(github.atomicWrites.length, writes);
  assert.deepEqual(store.value.pendingWrites.map(x => x.id), ['edit-A']);
});

test('same-record follow-up stays pending while a later independent edit proceeds', async () => {
  const github = new GitHub(), store = new Store();
  const missing = entry('4', '2026-10-29', '08:00:00', '09:00:00');
  const existing = entry('5', '2026-10-09', '08:00:00', '09:00:00');
  const added = entry('7', '2026-10-30', '08:00:00', '16:00:00');
  seed(github, path('2026-10'), [existing]);
  store.value.pendingWrites = [
    queuedEdit(missing, '2026-10', { description: 'first' }, 'conflict', 'queued_entry_missing'),
    queuedAddition(added),
    queuedEdit(missing, '2026-10', { description: 'dependent' }, 'pending', '', 'B'),
    queuedEdit(existing, '2026-10', { description: 'independent' }, 'pending', '', 'C'),
  ];
  await tracker(github, store).syncPending();
  assert.deepEqual(store.value.pendingWrites.map(x => x.id), ['edit-A', 'edit-B']);
  assert.equal(store.value.pendingWrites[0].status, 'conflict');
  assert.ok(store.value.pendingWrites.every(x => x.request.original.id === missing.id));
  assert.equal(parseMonthlyRecords(github.files.get(path('2026-10')).text, { path: path('2026-10') })
    .find(x => x.id === existing.id).description, 'independent');
});

test('an overlapping queued addition is held while a disjoint later edit can sync', async () => {
  const github = new GitHub(), store = new Store();
  const missing = entry('8', '2026-10-29', '08:00:00', '09:00:00');
  const overlapping = entry('9', '2026-10-29', '15:00:00', '17:00:00');
  const existing = entry('A', '2026-10-09', '08:00:00', '09:00:00');
  seed(github, path('2026-10'), [existing]);
  store.value.pendingWrites = [
    queuedEdit(missing, '2026-10', { endedAt: '2026-10-29T16:00:00.000Z' }, 'conflict', 'queued_entry_missing'),
    queuedAddition(overlapping),
    queuedEdit(existing, '2026-10', { description: 'safe' }, 'pending', '', 'B'),
  ];
  await tracker(github, store).syncPending();
  assert.deepEqual(store.value.pendingWrites.map(x => x.id), ['edit-A', 'new-addition']);
  const saved = parseMonthlyRecords(github.files.get(path('2026-10')).text, { path: path('2026-10') });
  assert.equal(saved.length, 1);
  assert.equal(saved[0].description, 'safe');
});

test('repository-wide and timer lifecycle failures still hold every later write', async () => {
  for (const blocking of [
    { operation: 'editEntry', status: 'conflict', stage: 'editEntry', conflictReason: 'queued_write_auth' },
    { operation: 'completeTimer', status: 'conflict', stage: 'verifyActive', conflictReason: 'active_missing_no_completion' },
  ]) {
    const github = new GitHub(), store = new Store();
    const missing = entry('B', '2026-10-29', '08:00:00', '09:00:00');
    const added = entry('C', '2026-10-30', '08:00:00', '16:00:00');
    seed(github, path('2026-10'), []);
    store.value.pendingWrites = [{ ...queuedEdit(missing, '2026-10', {}, 'conflict'), ...blocking }, queuedAddition(added)];
    await tracker(github, store).syncPending();
    assert.equal(store.value.pendingWrites.length, 2);
    assert.equal(github.atomicWrites.length, 0);
  }
});

test('a transient GitHub failure pauses even independent later writes', async () => {
  const github = new GitHub(), store = new Store();
  const original = entry('D', '2026-10-29', '08:00:00', '09:00:00');
  const added = entry('E', '2026-10-30', '08:00:00', '16:00:00');
  seed(github, path('2026-10'), [original]);
  store.value.pendingWrites = [queuedEdit(original, '2026-10', { description: 'first' }), queuedAddition(added)];
  const getText = github.getText.bind(github);
  let unavailable = true;
  github.getText = async filePath => {
    if (unavailable && filePath === path('2026-10')) { unavailable = false; throw new TypeError('network unavailable'); }
    return getText(filePath);
  };
  await tracker(github, store).syncPending();
  assert.deepEqual(store.value.pendingWrites.map(x => x.id), ['edit-A', 'new-addition']);
  assert.equal(store.value.pendingWrites[0].status, 'pending');
  assert.equal(github.atomicWrites.length, 0);
});
