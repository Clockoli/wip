import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TASK_INDEX_PATH, applyTaskIndexChanges, emptyTaskIndex, parseTaskIndex,
  serializeTaskIndex, taskIndexRecord,
} from '../src/domain/task-index.js';

const issue = 'https://github.com/acme/app/issues/42';
const pull = 'https://github.com/acme/app/pull/7';
const unresolved = 'manticoresoftware/NexusRepo/Fixed-last-block-encoding';
const entry = (id, taskUrl, durationSeconds) => ({ id, taskUrl, durationSeconds });
const [p1, i1, i2, i3, e1] = [
  '01K2ABCDEF0123456789ABCDEF',
  '01K2ABCDEF0123456789ABCDEE',
  '01K2ABCDEF0123456789ABCDED',
  '01K2ABCDEF0123456789ABCDEC',
  '01K2ABCDEF0123456789ABCDEB',
];

test('task index has one strict deterministic schema per personal branch', () => {
  assert.equal(TASK_INDEX_PATH, '.clockoli/tasks.json');
  const index = applyTaskIndexChanges(emptyTaskIndex('alice'), {
    add: [entry(p1, pull, 60), entry(i1, issue, 120), entry(i2, issue, 30)],
  });
  const text = serializeTaskIndex(index);
  assert.equal(text, `${JSON.stringify({
    version: 1,
    storageLogin: 'alice',
    tasks: {
      [issue]: { totalSeconds: 150, sessionCount: 2, recordIds: [i2, i1] },
      [pull]: { totalSeconds: 60, sessionCount: 1, recordIds: [p1] },
    },
  }, null, 2)}\n`);
  assert.deepEqual(parseTaskIndex(text, { user: 'alice' }), index);
});

test('task index applies exact edit, move, and delete deltas', () => {
  const initial = applyTaskIndexChanges(emptyTaskIndex('alice'), {
    add: [entry(i1, issue, 120), entry(i2, issue, 30), entry(p1, pull, 60)],
  });
  const changed = applyTaskIndexChanges(initial, {
    remove: [entry(i1, issue, 120), entry(p1, pull, 60)],
    add: [entry(i3, issue, 180), entry(e1, 'https://example.com/task/1', 60)],
  });
  assert.deepEqual(changed.tasks, {
    'https://example.com/task/1': { totalSeconds: 60, sessionCount: 1, recordIds: [e1] },
    [issue]: { totalSeconds: 210, sessionCount: 2, recordIds: [i3, i2] },
  });
  assert.deepEqual(taskIndexRecord(changed, issue), {
    user: 'alice', taskUrl: issue, durationSeconds: 210, recordIds: [i3, i2],
  });
  assert.equal(taskIndexRecord(changed, pull), null);
});

test('a queued completion preserves title snapshots already stored in a personal index', () => {
  const index = { version: 1, storageLogin: 'alice', tasks: {
    [issue]: { totalSeconds: 120, sessionCount: 1, recordIds: [i1],
      title: 'Existing task', titleSourceId: i1, titleStartedAt: '2026-10-26T08:00:00.000Z' },
  } };
  const parsed = parseTaskIndex(JSON.stringify(index), { user: 'alice' });
  const updated = applyTaskIndexChanges(parsed, { add: [{
    ...entry(p1, issue, 60), taskTitle: 'Newer task title', startedAt: '2026-10-27T08:00:00.000Z',
  }] });
  assert.deepEqual(parseTaskIndex(serializeTaskIndex(updated), { user: 'alice' }).tasks[issue], {
    totalSeconds: 180, sessionCount: 2, recordIds: [i1, p1],
    title: 'Newer task title', titleSourceId: p1, titleStartedAt: '2026-10-27T08:00:00.000Z',
  });
});

test('removing a title source retains other sessions without dangling title metadata', () => {
  const index = applyTaskIndexChanges(emptyTaskIndex('alice'), { add: [
    { ...entry(i1, issue, 60), taskTitle: 'Older title', startedAt: '2026-10-26T08:00:00.000Z' },
    { ...entry(p1, issue, 120), taskTitle: 'Latest title', startedAt: '2026-10-27T08:00:00.000Z' },
  ] });
  const remaining = applyTaskIndexChanges(index, { remove: [entry(p1, issue, 120)] });
  assert.deepEqual(remaining.tasks[issue], { totalSeconds: 60, sessionCount: 1, recordIds: [i1] });
  assert.deepEqual(parseTaskIndex(serializeTaskIndex(remaining), { user: 'alice' }), remaining);
});

test('task index accepts and updates an unresolved Clockify identity without inventing a URL', () => {
  const index = applyTaskIndexChanges(emptyTaskIndex('alice'), { add: [entry(i1, unresolved, 120)] });
  assert.deepEqual(parseTaskIndex(serializeTaskIndex(index), { user: 'alice' }).tasks[unresolved], {
    totalSeconds: 120, sessionCount: 1, recordIds: [i1],
  });
  assert.deepEqual(taskIndexRecord(index, unresolved), {
    user: 'alice', taskUrl: unresolved, durationSeconds: 120, recordIds: [i1],
  });
  assert.deepEqual(applyTaskIndexChanges(index, { remove: [entry(i1, unresolved, 120)] }).tasks, {});
});

test('task index rejects malformed unresolved identities and still requires canonical URLs', () => {
  for (const key of [
    'manticoresoftware/NexusRepo', 'manticoresoftware/NexusRepo/',
    'manticoresoftware/NexusRepo/Fixed last block',
    'manticoresoftware/NexusRepo/../secret',
    'manticoresoftware/NexusRepo/Fixed?query=1',
    'https://github.com/acme/app/issues/42?utm_source=test',
  ]) {
    const index = { version: 1, storageLogin: 'alice', tasks: {
      [key]: { totalSeconds: 120, sessionCount: 1, recordIds: [i1] },
    } };
    assert.throws(() => parseTaskIndex(JSON.stringify(index), { user: 'alice' }), undefined, key);
  }
});

test('task index rejects missing, malformed, noncanonical, foreign, and inconsistent data', () => {
  assert.throws(() => parseTaskIndex('', { user: 'alice' }), /valid JSON/i);
  assert.throws(() => parseTaskIndex(JSON.stringify({ version: 1, storageLogin: 'bob', tasks: {} }), { user: 'alice' }), /storage user/i);
  assert.throws(() => parseTaskIndex(JSON.stringify({ version: 1, storageLogin: 'alice', tasks: {
    'https://github.com/acme/app/issues/42?utm_source=test': { totalSeconds: 1, sessionCount: 1 },
  } }), { user: 'alice' }), /canonical/i);
  assert.throws(() => applyTaskIndexChanges(emptyTaskIndex('alice'), { remove: [entry(i1, issue, 1)] }), /does not match/i);
});

test('task index rejects invalid and cross-task duplicate record IDs', () => {
  const index = { version: 1, storageLogin: 'alice', tasks: {
    [issue]: { totalSeconds: 60, sessionCount: 1, recordIds: [i1] },
    [pull]: { totalSeconds: 30, sessionCount: 1, recordIds: [i1] },
  } };
  assert.throws(() => parseTaskIndex(JSON.stringify({ ...index, tasks: {
    [issue]: { totalSeconds: 60, sessionCount: 1, recordIds: ['not-a-ulid'] },
  } }), { user: 'alice' }), /summary/i);
  assert.throws(() => parseTaskIndex(JSON.stringify(index), { user: 'alice' }), /summary/i);
  assert.throws(() => applyTaskIndexChanges(
    applyTaskIndexChanges(emptyTaskIndex('alice'), { add: [entry(i1, issue, 60)] }),
    { add: [entry(i1, pull, 30)] },
  ), /does not match/i);

  const moved = applyTaskIndexChanges(
    applyTaskIndexChanges(emptyTaskIndex('alice'), { add: [entry(i1, issue, 60)] }),
    { remove: [entry(i1, issue, 60)], add: [entry(i1, pull, 60)] },
  );
  assert.deepEqual(moved.tasks, {
    [pull]: { totalSeconds: 60, sessionCount: 1, recordIds: [i1] },
  });
});
