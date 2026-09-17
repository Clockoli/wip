import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateTaskParticipants, aggregateTrackedTasks, effectiveTrackedSeconds, sortTrackedTasks, taskPeriodRange } from '../src/domain/tasks.js';

const issue = (number, type = 'issue', repo = 'app') => ({
  type, owner: 'acme', repo, number,
  url: `https://github.com/acme/${repo}/${type === 'pull_request' ? 'pull' : 'issues'}/${number}`,
});
const record = (task, seconds, entryDate, user = 'alice') => ({ issue: task, durationSeconds: seconds, entryDate, user });

test('task periods are inclusive and default to the last two weeks', () => {
  assert.deepEqual(taskPeriodRange('two-weeks', '2026-08-20'), { startDate: '2026-08-07', endDate: '2026-08-20' });
  assert.deepEqual(taskPeriodRange('one-month', '2026-08-20'), { startDate: '2026-07-21', endDate: '2026-08-20' });
  assert.deepEqual(taskPeriodRange('three-months', '2026-08-20'), { startDate: '2026-05-21', endDate: '2026-08-20' });
  assert.deepEqual(taskPeriodRange('six-months', '2026-08-20'), { startDate: '2026-02-21', endDate: '2026-08-20' });
  assert.deepEqual(taskPeriodRange('one-year', '2026-08-20'), { startDate: '2025-08-21', endDate: '2026-08-20' });
  assert.throws(() => taskPeriodRange('forever', '2026-08-20'), /period/i);
});

test('all-time task period starts at the first supported Clockoli date', () => {
  assert.deepEqual(taskPeriodRange('all-time', '2026-08-20'), { startDate: '1970-01-01', endDate: '2026-08-20' });
});

test('tracked tasks deduplicate sessions by canonical issue or PR and sort by total time', () => {
  const issueOne = issue(1), pullTwo = issue(2, 'pull_request');
  const tasks = aggregateTrackedTasks([
    record(issueOne, 600, '2026-08-18'),
    record(pullTwo, 3600, '2026-08-19'),
    record(issueOne, 1200, '2026-08-20'),
    record(issue(3), 9999, '2026-08-20', 'bob'),
  ], { user: 'alice', metadata: new Map([
    [issueOne.url, { title: 'Fix search' }],
    [pullTwo.url, { title: 'Improve reports' }],
  ]) });
  assert.deepEqual(tasks.map(task => ({ url: task.issue.url, seconds: task.totalSeconds, sessions: task.sessionCount, title: task.title })), [
    { url: pullTwo.url, seconds: 3600, sessions: 1, title: 'Improve reports' },
    { url: issueOne.url, seconds: 1800, sessions: 2, title: 'Fix search' },
  ]);
});

test('tracked tasks aggregate current users by URL with sorted destination provenance', () => {
  const task = issue(1);
  const sharedId = '01K2ABCDEF0123456789ABCDE0';
  const tasks = aggregateTrackedTasks([
    { ...record(task, 600, '2026-08-18', 'alice'), id: sharedId, destinationId: 'github:1', timeRepository: 'alice/time', duplicateDestinations: ['github:1', 'github:2'] },
    { ...record(task, 900, '2026-08-19', 'alice-alt'), id: '01K2ABCDEF0123456789ABCDE1', destinationId: 'github:2', timeRepository: 'team/time' },
  ], { currentUsers: ['alice', 'alice-alt'] });
  assert.deepEqual(tasks, [{
    taskUrl: task.url, issue: task, title: '', totalSeconds: 1500, sessionCount: 2,
    destinationIds: ['github:1', 'github:2'], timeRepositories: ['alice/time', 'team/time'],
  }]);
});

test('persisted record titles are used without display-time metadata resolution', () => {
  const storedIssue = issue(8);
  const stored = { user: 'alice', issue: storedIssue, issueTitle: 'Stored ranking regression', durationSeconds: 120 };
  const tasks = aggregateTrackedTasks([stored], { user: 'alice', metadata: new Map([[storedIssue.url, { title: 'Fresh API title' }]]) });
  assert.equal(tasks[0].title, 'Stored ranking regression');
  assert.equal('status' in tasks[0], false, 'provider status is not part of the tracked-task DTO');
});

test('tracked task aggregation keeps inaccessible metadata as a safe canonical fallback', () => {
  const task = issue(7, 'issue', 'private');
  assert.deepEqual(aggregateTrackedTasks([record(task, 60, '2026-08-20')], { user: 'alice' }), [{
    taskUrl: task.url, issue: task, title: '', totalSeconds: 60, sessionCount: 1,
  }]);
});

test('active-only work is included without baking elapsed time into completed totals', () => {
  const activeIssue = issue(9, 'pull_request', 'api');
  const tasks = aggregateTrackedTasks([], {
    user: 'alice',
    active: { user: 'alice', issue: activeIssue, startedAt: '2026-08-20T10:00:00.000Z', issueTitle: 'Running review', destinationId: 'github:2', timeRepository: 'team/time' },
    metadata: new Map([[activeIssue.url, { title: 'Running review' }]]),
  });
  assert.deepEqual(tasks, [{
    taskUrl: activeIssue.url, issue: activeIssue, title: 'Running review', totalSeconds: 0, sessionCount: 0,
    destinationIds: ['github:2'], timeRepositories: ['team/time'],
    activeStartedAt: '2026-08-20T10:00:00.000Z',
  }]);
});

test('active work augments an existing tracked task and ignores another user', () => {
  const tracked = issue(4);
  const tasks = aggregateTrackedTasks([record(tracked, 1800, '2026-08-20')], {
    user: 'alice',
    active: { user: 'alice', issue: tracked, startedAt: '2026-08-20T11:00:00.000Z' },
  });
  assert.equal(tasks[0].totalSeconds, 1800);
  assert.equal(tasks[0].activeStartedAt, '2026-08-20T11:00:00.000Z');
  assert.equal(aggregateTrackedTasks([], {
    user: 'alice', active: { user: 'bob', issue: tracked, startedAt: '2026-08-20T11:00:00.000Z' },
  }).length, 0);
});

test('running elapsed time participates in total-time ordering without mutating completed totals', () => {
  const first = { issue: issue(1), title: 'First', totalSeconds: 3600, sessionCount: 1 };
  const second = { issue: issue(2), title: 'Second', totalSeconds: 3000, sessionCount: 1, activeStartedAt: '2026-08-20T10:00:00.000Z' };
  const active = { issue: second.issue, startedAt: second.activeStartedAt };
  assert.equal(effectiveTrackedSeconds(second, { active, now: '2026-08-20T10:20:00.000Z' }), 4200);
  assert.deepEqual(sortTrackedTasks([first, second], { active, now: '2026-08-20T10:20:00.000Z' }).map(task => task.issue.number), [2, 1]);
  assert.equal(second.totalSeconds, 3000);
});


test('provider status metadata is not exposed in URL-first tracked-task results', () => {
  const completed = issue(10);
  const [task] = aggregateTrackedTasks([record(completed, 60, '2026-08-20')], {
    user: 'alice', metadata: new Map([[completed.url, { title: 'Done' }]]),
  });
  assert.equal(task.title, 'Done');
  assert.equal('status' in task, false);
  assert.equal('stateReason' in task, false);
});


test('arbitrary URL tasks aggregate without provider metadata and keep title optional', () => {
  const taskUrl = 'https://example.com/work/42';
  const tasks = aggregateTrackedTasks([
    { user: 'alice', taskUrl, taskTitle: '', durationSeconds: 120 },
    { user: 'alice', taskUrl, taskTitle: 'Optional name', durationSeconds: 180 },
  ], { user: 'alice' });
  assert.deepEqual(tasks, [{ taskUrl, title: 'Optional name', totalSeconds: 300, sessionCount: 2 }]);
});

test('locally accepted pending completions participate in Top tasks without double counting persisted records', () => {
  const taskUrl = 'https://example.com/pending';
  const pendingEntry = {
    user: 'alice', taskUrl, taskTitle: 'Pending task', startedAt: '2026-08-20T10:00:00Z',
    endedAt: '2026-08-20T11:00:00Z', durationSeconds: 3600, description: 'done',
  };
  const pendingWrites = [{ operation: 'completeTimer', destinationId: 'github:2', timeRepository: 'team/time', entry: pendingEntry }];
  assert.deepEqual(aggregateTrackedTasks([], { user: 'alice', pendingWrites }), [{
    taskUrl, title: 'Pending task', totalSeconds: 3600, sessionCount: 1,
    destinationIds: ['github:2'], timeRepositories: ['team/time'],
  }]);
  assert.equal(aggregateTrackedTasks([pendingEntry], { user: 'alice', pendingWrites })[0].totalSeconds, 3600);
  const winner = { ...pendingEntry, endedAt: '2026-08-20T10:55:00Z', durationSeconds: 3300, description: 'first Stop' };
  const loser = { ...pendingEntry, endedAt: '2026-08-20T11:05:00Z', durationSeconds: 3900, description: 'second Stop' };
  assert.deepEqual(aggregateTrackedTasks([winner], {
    user: 'alice', pendingWrites: [{ operation: 'completeTimer', entry: loser }],
  }), [{ taskUrl, title: 'Pending task', totalSeconds: 3300, sessionCount: 1 }]);
});

test('task participants aggregate every person and overlay only unsynced and active local work', () => {
  const task = issue(42);
  const persistedAlice = {
    ...record(task, 600, '2026-08-19', 'Alice'),
    startedAt: '2026-08-19T10:00:00.000Z',
  };
  const pendingAlice = {
    ...record(task, 300, '2026-08-20', 'Alice'),
    startedAt: '2026-08-20T10:00:00.000Z',
  };
  const alreadyPersisted = { ...persistedAlice, durationSeconds: 999 };
  const participants = aggregateTaskParticipants([
    persistedAlice,
    record(task, 1200, '2026-08-20', 'bob'),
    record(issue(99), 9999, '2026-08-20', 'carol'),
  ], {
    taskUrl: task.url,
    currentUser: 'Alice',
    pendingWrites: [
      { operation: 'completeTimer', entry: pendingAlice },
      { operation: 'completeTimer', entry: alreadyPersisted },
    ],
    active: { user: 'Alice', issue: task, startedAt: '2026-08-20T11:00:00.000Z' },
  });

  assert.deepEqual(participants, [
    { login: 'bob', totalSeconds: 1200 },
    { login: 'Alice', totalSeconds: 900, activeStartedAt: '2026-08-20T11:00:00.000Z' },
  ]);
});

test('task participant index does not overlay a completion already saved before active cleanup', () => {
  const task = issue(42);
  const savedIndexTotal = { user: 'Alice', taskUrl: task.url, durationSeconds: 600 };
  const savedCompletion = { ...record(task, 600, '2026-08-20', 'Alice'), startedAt: '2026-08-20T10:00:00.000Z' };
  assert.deepEqual(aggregateTaskParticipants([savedIndexTotal], {
    taskUrl: task.url,
    currentUser: 'Alice',
    pendingWrites: [{ operation: 'completeTimer', stage: 'clearActive', entry: savedCompletion }],
  }), [{ login: 'Alice', totalSeconds: 600 }]);
});

test('task participant index does not overlay a completion after its durable commit starts', () => {
  const task = issue(42);
  const completion = { ...record(task, 600, '2026-08-20', 'Alice'), id: 'completion-1', startedAt: '2026-08-20T10:00:00.000Z' };
  assert.deepEqual(aggregateTaskParticipants([
    { user: 'Alice', taskUrl: task.url, durationSeconds: 600, recordIds: ['completion-1'] },
  ], {
    taskUrl: task.url,
    currentUser: 'Alice',
    pendingWrites: [{ operation: 'completeTimer', stage: 'commitCompletion', entry: completion }],
  }), [{ login: 'Alice', totalSeconds: 600 }]);
});

test('task participant index overlays a completion not yet present when its durable commit is retried', () => {
  const task = issue(42);
  const completion = { ...record(task, 600, '2026-08-20', 'Alice'), id: 'completion-1', startedAt: '2026-08-20T10:00:00.000Z' };
  assert.deepEqual(aggregateTaskParticipants([], {
    taskUrl: task.url,
    currentUser: 'Alice',
    pendingWrites: [{ operation: 'completeTimer', stage: 'commitCompletion', entry: completion }],
  }), [{ login: 'Alice', totalSeconds: 600 }]);
});
