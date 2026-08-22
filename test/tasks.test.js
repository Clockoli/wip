import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateTrackedTasks, effectiveTrackedSeconds, sortTrackedTasks, taskPeriodRange } from '../src/domain/tasks.js';

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

test('tracked tasks deduplicate sessions by canonical issue or PR and sort by total time', () => {
  const issueOne = issue(1), pullTwo = issue(2, 'pull_request');
  const tasks = aggregateTrackedTasks([
    record(issueOne, 600, '2026-08-18'),
    record(pullTwo, 3600, '2026-08-19'),
    record(issueOne, 1200, '2026-08-20'),
    record(issue(3), 9999, '2026-08-20', 'bob'),
  ], { user: 'alice', metadata: new Map([
    [issueOne.url, { title: 'Fix search', status: 'OPEN' }],
    [pullTwo.url, { title: 'Improve reports', status: 'MERGED' }],
  ]) });
  assert.deepEqual(tasks.map(task => ({ url: task.issue.url, seconds: task.totalSeconds, sessions: task.sessionCount, title: task.title, status: task.status })), [
    { url: pullTwo.url, seconds: 3600, sessions: 1, title: 'Improve reports', status: 'MERGED' },
    { url: issueOne.url, seconds: 1800, sessions: 2, title: 'Fix search', status: 'OPEN' },
  ]);
});

test('persisted record titles are used without display-time metadata resolution', () => {
  const storedIssue = issue(8);
  const stored = { user: 'alice', issue: storedIssue, issueTitle: 'Stored ranking regression', durationSeconds: 120 };
  const tasks = aggregateTrackedTasks([stored], { user: 'alice', metadata: new Map([[storedIssue.url, { title: 'Fresh API title', status: 'OPEN' }]]) });
  assert.equal(tasks[0].title, 'Stored ranking regression');
  assert.equal(tasks[0].status, 'OPEN', 'metadata still supplies issue state without replacing the persisted title');
});

test('tracked task aggregation keeps inaccessible metadata as a safe canonical fallback', () => {
  const task = issue(7, 'issue', 'private');
  assert.deepEqual(aggregateTrackedTasks([record(task, 60, '2026-08-20')], { user: 'alice' }), [{
    taskUrl: task.url, issue: task, title: '', status: 'UNKNOWN', totalSeconds: 60, sessionCount: 1,
  }]);
});

test('active-only work is included without baking elapsed time into completed totals', () => {
  const activeIssue = issue(9, 'pull_request', 'api');
  const tasks = aggregateTrackedTasks([], {
    user: 'alice',
    active: { user: 'alice', issue: activeIssue, startedAt: '2026-08-20T10:00:00.000Z', issueTitle: 'Running review' },
    metadata: new Map([[activeIssue.url, { title: 'Running review', status: 'OPEN' }]]),
  });
  assert.deepEqual(tasks, [{
    taskUrl: activeIssue.url, issue: activeIssue, title: 'Running review', status: 'OPEN', totalSeconds: 0, sessionCount: 0,
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
  const first = { issue: issue(1), title: 'First', status: 'OPEN', totalSeconds: 3600, sessionCount: 1 };
  const second = { issue: issue(2), title: 'Second', status: 'OPEN', totalSeconds: 3000, sessionCount: 1, activeStartedAt: '2026-08-20T10:00:00.000Z' };
  const active = { issue: second.issue, startedAt: second.activeStartedAt };
  assert.equal(effectiveTrackedSeconds(second, { active, now: '2026-08-20T10:20:00.000Z' }), 4200);
  assert.deepEqual(sortTrackedTasks([first, second], { active, now: '2026-08-20T10:20:00.000Z' }).map(task => task.issue.number), [2, 1]);
  assert.equal(second.totalSeconds, 3000);
});


test('closed issue state reasons preserve GitHub completed and not-planned semantics', () => {
  const completed = issue(10), notPlanned = issue(11);
  const tasks = aggregateTrackedTasks([
    record(completed, 60, '2026-08-20'), record(notPlanned, 30, '2026-08-20'),
  ], { user: 'alice', metadata: new Map([
    [completed.url, { title: 'Done', status: 'CLOSED', stateReason: 'COMPLETED' }],
    [notPlanned.url, { title: 'Skipped', status: 'CLOSED', stateReason: 'NOT_PLANNED' }],
  ]) });
  assert.equal(tasks.find(task => task.issue.url === completed.url).stateReason, 'COMPLETED');
  assert.equal(tasks.find(task => task.issue.url === notPlanned.url).stateReason, 'NOT_PLANNED');
});


test('arbitrary URL tasks aggregate without provider metadata and keep title optional', () => {
  const taskUrl = 'https://example.com/work/42';
  const tasks = aggregateTrackedTasks([
    { user: 'alice', taskUrl, taskTitle: '', durationSeconds: 120 },
    { user: 'alice', taskUrl, taskTitle: 'Optional name', durationSeconds: 180 },
  ], { user: 'alice' });
  assert.deepEqual(tasks, [{ taskUrl, title: 'Optional name', status: 'UNKNOWN', totalSeconds: 300, sessionCount: 2 }]);
});
