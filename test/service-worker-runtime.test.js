import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import {
  assertMessageAllowed,
  destinationIdForCompletedMutation,
  taskUrlForParticipantLoad,
  taskUrlForStart,
  taskUrlForTimelineSwitch,
} from '../src/background/message-policy.js';
import {
  activeDestinationId,
  requireConfiguredDestinationId,
  resolveStartDestinationId,
  selectReadDestinations,
  syncPendingAll,
} from '../src/background/destination-runtime.js';
import { createUlid } from '../src/domain/ulid.js';
import { normalizeTaskUrl, taskUrlOf } from '../src/domain/values.js';

const worker = await readFile(new URL('../src/background/service-worker.js', import.meta.url), 'utf8');
const extensionOrigin = 'chrome-extension://clockoli/';
const extensionSender = { url: `${extensionOrigin}src/times/times.html`, documentId: 'activity' };
const registry = {
  version: 1,
  defaultDestinationId: 'github:1',
  destinations: {
    'github:1': { id: 'github:1', owner: 'default', repo: 'time' },
    'github:2': { id: 'github:2', owner: 'team', repo: 'time' },
  },
  projects: [{ id: 'team', name: 'Team', substrings: ['example.test/team/'], destinationId: 'github:2' }],
};

function sourceBetween(start, end) {
  const first = worker.indexOf(start), last = worker.indexOf(end, first);
  assert.notEqual(first, -1, `missing worker marker: ${start}`);
  assert.notEqual(last, -1, `missing worker marker: ${end}`);
  return worker.slice(first, last);
}

test('last accepted local edit determines the 15-second durable sync deadline', async () => {
  const now = Date.now();
  const context = vm.createContext({ Date });
  vm.runInContext(sourceBetween('let pendingSync = null;', 'function requestPendingSync('), context);
  const snapshot = {
    destinationStates: { entries: {
      'github:1': { pendingWrites: [
        { operation: 'editEntry', queuedAt: new Date(now - 80_000).toISOString(), lastLocalEditAt: new Date(now - 3_000).toISOString() },
      ] },
      'github:2': { pendingWrites: [{ operation: 'completeTimer', queuedAt: new Date(now - 8_000).toISOString() }] },
    } },
  };
  assert.equal(context.pendingSyncQuietUntil(snapshot), now + 12_000);
  snapshot.destinationStates.entries['github:1'].pendingWrites[0].lastLocalEditAt = new Date(now + 5_000).toISOString();
  assert.equal(context.pendingSyncQuietUntil(snapshot), now + 20_000,
    'editing an existing queued record resets the inactivity clock');
  snapshot.destinationStates.entries['github:1'].pendingWrites = [];
  snapshot.destinationStates.entries['github:2'].pendingWrites = [];
  assert.equal(context.pendingSyncQuietUntil(snapshot), null);
});

test('a fresh local edit re-arms 15-second wakeup, without needing a minute tick', async () => {
  let now = Date.now();
  class FakeDate extends Date { static now() { return now; } }
  const pending = [{ operation: 'editEntry', queuedAt: new Date(now).toISOString() }];
  const timers = [], alarms = [], commits = [];
  const store = {
    getPendingDestinationIds: async () => pending.length ? ['github:1'] : [],
    getTrackingSnapshot: async () => ({
      destinationStates: { entries: { 'github:1': { pendingWrites: structuredClone(pending) } } },
    }),
  };
  const context = vm.createContext({
    Date: FakeDate, store,
    chrome: { alarms: { create: async (...args) => { alarms.push(args); } } },
    setTimeout: (callback, delay) => {
      const timer = { callback, delay, cancelled: false, unref() {} };
      timers.push(timer);
      return timer;
    },
    clearTimeout: timer => { timer.cancelled = true; },
    withCurrentRepositoryRecovery: async (_message, callback) => callback(),
    executor: { run: callback => callback() },
    syncPendingAll: async () => { commits.push(now); pending.length = 0; },
    trackerForDestination: async () => ({}),
    pullRemoteNow: async () => {},
  });
  vm.runInContext(sourceBetween('let pendingSync = null;', 'function scheduleSync() {'), context);
  context.requestPendingSync();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(timers.at(-1).delay, 15_000);
  assert.equal(alarms.at(-1)[0], 'sync-pending-idle-fallback');
  assert.equal(alarms.at(-1)[1].when >= now + 30_000, true);

  now += 10_000;
  pending[0].lastLocalEditAt = new Date(now).toISOString();
  context.requestPendingSync();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(timers.at(-2).cancelled, true);
  assert.equal(timers.at(-1).delay, 15_000);
  now += 14_999;
  assert.deepEqual(commits, []);
  now += 1;
  timers.at(-1).callback();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(commits, [now]);
});

test('a new local edit arriving during a slow GitHub write still schedules its own flush', async () => {
  let now = Date.now();
  class FakeDate extends Date { static now() { return now; } }
  const pending = [{ id: 'first', operation: 'editEntry', queuedAt: new Date(now - 15_000).toISOString() }];
  const timers = [], alarms = [], commits = [];
  let notifyStarted, release;
  const started = new Promise(resolve => { notifyStarted = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  const store = {
    getPendingDestinationIds: async () => pending.length ? ['github:1'] : [],
    getTrackingSnapshot: async () => ({
      destinationStates: { entries: { 'github:1': { pendingWrites: structuredClone(pending) } } },
    }),
  };
  const context = vm.createContext({
    Date: FakeDate, store,
    chrome: { alarms: { create: async (...args) => { alarms.push(args); } } },
    setTimeout: (callback, delay) => {
      const timer = { callback, delay, cancelled: false, unref() {} };
      timers.push(timer);
      return timer;
    },
    clearTimeout: timer => { timer.cancelled = true; },
    withCurrentRepositoryRecovery: async (_message, callback) => callback(),
    executor: { run: callback => callback() },
    syncPendingAll: async () => {
      if (commits.length === 0) { notifyStarted(); await blocked; }
      commits.push(pending.shift()?.id);
    },
  });
  vm.runInContext(sourceBetween('let pendingSync = null;', 'function scheduleSync() {'), context);
  const first = context.syncPendingNow();
  await started;
  now += 1_000;
  pending.push({ id: 'second', operation: 'editEntry', queuedAt: new Date(now).toISOString() });
  context.requestPendingSync();
  await new Promise(resolve => setImmediate(resolve));
  const originalWake = timers.at(-1);
  assert.equal(originalWake.delay, 15_000);
  now += 15_000;
  originalWake.callback();
  await new Promise(resolve => setImmediate(resolve));
  release();
  await first;
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(commits, ['first'], 'the second edit cannot be swallowed by the in-flight sync');
  const followupWake = timers.filter(timer => !timer.cancelled).at(-1);
  assert.notEqual(followupWake, originalWake, 'the new edit must get another flush after the first completes');
  followupWake.callback();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(commits, ['first', 'second']);
});

test('an early alarm cannot sync before 15 seconds of inactivity after service-worker restart', async () => {
  let now = Date.now();
  class FakeDate extends Date { static now() { return now; } }
  const recent = [{ operation: 'editEntry', queuedAt: new Date(now - 5_000).toISOString() }];
  const commits = [], timers = [], alarms = [];
  const context = vm.createContext({
    Date: FakeDate,
    store: {
      getPendingDestinationIds: async () => recent.length ? ['github:1'] : [],
      getTrackingSnapshot: async () => ({
        destinationStates: { entries: { 'github:1': { pendingWrites: structuredClone(recent) } } },
      }),
    },
    chrome: { alarms: { create: async (...args) => { alarms.push(args); } } },
    setTimeout: (fn, delay) => { timers.push({ fn, delay }); return timers.length; },
    clearTimeout: () => {},
    executor: { run: fn => fn() },
    withCurrentRepositoryRecovery: async (_message, fn) => fn(),
    syncPendingAll: async () => { commits.push(now); recent.length = 0; },
    trackerForDestination: async () => ({}),
  });
  vm.runInContext(sourceBetween('let pendingSync = null;', 'function scheduleSync() {'), context);
  await context.syncPendingNow();
  assert.deepEqual(commits, []);
  assert.equal(timers.at(-1).delay, 10_000);
  now += 10_000;
  await context.syncPendingNow();
  assert.deepEqual(commits, [now]);
});

test('startup handles an alarm rejection while Chrome replaces the service worker', async () => {
  const calls = [];
  const context = vm.createContext({
    chrome: { alarms: { create: (...args) => { calls.push(args); return Promise.reject(new Error('No SW')); } } },
    store: { migrateLegacyPatAuth: async () => {} },
    syncPendingNow: async () => {},
    pullRemoteNow: async () => {},
    requestPendingSync: () => {},
    resumeClockifyMigration: async () => {},
  });
  vm.runInContext(sourceBetween('function scheduleSyncAlarm(', 'function hasRunnablePending(')
    + sourceBetween('function scheduleSync() {', 'async function openTimesPage()'), context);
  const scheduled = context.scheduleSync();
  assert.equal(typeof scheduled?.then, 'function', 'startup must observe the alarm promise');
  await scheduled;
  assert.deepEqual(calls.map(([name]) => name), ['sync-pending', 'clockify-migration-resume']);
});

function handlerContext(overrides = {}) {
  const context = vm.createContext({
    URL, TextEncoder, Date, Map, AbortController,
    chrome: { runtime: { getURL: () => extensionOrigin }, action: { setIcon: async () => {} }, tabs: { create: async () => {} } },
    assertMessageAllowed, destinationIdForCompletedMutation, taskUrlForParticipantLoad, taskUrlForStart, taskUrlForTimelineSwitch,
    activeDestinationId, requireConfiguredDestinationId, resolveStartDestinationId, selectReadDestinations, syncPendingAll,
    createUlid, normalizeTaskUrl, taskUrlOf,
    globalTrackerState: async () => ({ configured: true, active: null, recent: [], pendingWrites: [] }),
    requestPendingSync: () => {},
    ...overrides,
  });
  vm.runInContext(sourceBetween('async function handle(', 'chrome.runtime.onMessage.addListener'), context);
  return context;
}

test('content timeline switch verifies an imported entry before touching the running timer', async () => {
  const identity = 'manticoresoftware/Routines/1-dev-call';
  const sourceEntry = { id: 'record-1', destinationId: 'github:1', entryDate: '2026-10-12' };
  const sender = { url: 'https://github.com/acme/repo/issues/7', tab: { id: 5, url: 'https://github.com/acme/repo/issues/7' } };
  const calls = [];
  let records = [{ ...sourceEntry, taskUrl: identity }];
  let partial = false;
  const context = handlerContext({
    store: {},
    loadTimes: async ({ payload }) => { calls.push(['read', payload.startDate]); return { configured: true, partial, recent: records }; },
    resolveStartDestinationId: async () => { calls.push(['resolve']); return 'github:1'; },
    activeDestinationId: async () => { calls.push(['active']); return null; },
    trackerForDestination: async () => ({ switchTask: async task => { calls.push(['switch', task]); return { active: { taskUrl: task } }; } }),
  });
  const message = { type: 'SWITCH_TASK', timelineTask: true, taskUrl: identity, sourceEntry };
  const result = await context.handle(message, sender);
  assert.equal(result.active.taskUrl, identity);
  assert.deepEqual(calls.map(([kind]) => kind), ['read', 'resolve', 'active', 'switch']);
  calls.length = 0;
  records = [{ ...sourceEntry, taskUrl: 'acme/other/task' }];
  await assert.rejects(context.handle(message, sender), /stored record/i);
  assert.deepEqual(calls.map(([kind]) => kind), ['read']);
  calls.length = 0;
  partial = true;
  await assert.rejects(context.handle(message, sender), /unavailable/i);
  assert.deepEqual(calls.map(([kind]) => kind), ['read']);
  calls.length = 0;
  await assert.rejects(context.handle({ ...message, sourceEntry: { ...sourceEntry, entryDate: '2026-02-30' } }, sender), /valid source record/i);
  assert.deepEqual(calls, []);
});

test('extracted service-worker handler routes START to the first matching destination', async () => {
  const calls = [];
  const store = {
    getConfigurationSnapshot: async () => ({ registry, config: registry.destinations['github:1'] }),
    getLocalPreferences: async () => ({ projects: registry.projects }),
    getAuthSnapshot: async () => ({ auth: { mode: 'github_app' } }),
  };
  const context = handlerContext({
    store,
    trackerForDestination: async (destinationId, options) => ({
      start: async (...args) => { calls.push({ destinationId, options, args }); return { id: 'timer', _pending: true }; },
    }),
  });
  const result = await context.handle({ type: 'START', taskUrl: 'https://example.test/team/42', taskTitle: 'Team task' }, extensionSender);
  assert.equal(result.destinationId, 'github:2');
  assert.deepEqual(calls.map(call => [call.destinationId, call.args[0], call.args[3]?.background]), [
    ['github:2', 'https://example.test/team/42', true],
  ]);
  assert.equal(calls[0].options?.localOnly, true, 'Start must not wait for GitHub preflight');
});

test('multi-destination read callbacks use local-only contexts and retain persistent bodies for merging', () => {
  const participants = sourceBetween('async function loadTaskParticipants(', 'async function loadTimes(');
  const tasks = sourceBetween('async function loadTasks(', 'async function cancelReports(');
  const reports = sourceBetween('async function loadReport(', 'async function loadTaskParticipants(');
  assert.match(participants, /trackerForDestination\(destination\.id, \{ localOnly: true \}\)/);
  assert.match(participants, /tracker\.getState\(\{ refresh: true, signal \}\)/);
  assert.match(tasks, /contextForDestination\(destination\.id, \{ localOnly: true \}\)/);
  assert.match(tasks, /tracker\.getState\(\{ refresh: true, signal \}\)/);
  assert.match(reports, /includeStorageMetadata: true/);
  assert.match(tasks, /includeStorageMetadata: true/);
  assert.match(participants, /merge: mergeDestinationTaskSummaries/);
});

test('MERGE_TASKS applies every queued pair only in the one selected destination', async () => {
  const calls = [];
  const context = handlerContext({
    configuredSnapshot: async () => ({ registry, auth: { githubLogin: 'alice' } }),
    destinationUser: async () => 'alice',
    githubForConfig: () => ({}),
    discoverUserStorageBranches: async () => [],
    trackerForDestination: async destinationId => ({
      getState: async () => ({ pendingWrites: [] }),
      mergeTasks: async request => { calls.push({ destinationId, request }); return { mergedEntries: 2, mergedActive: destinationId === 'github:2' }; },
    }),
  });
  const request = {
    type: 'MERGE_TASKS', destinationIds: ['github:1'], selectedUsers: ['alice'],
    pairs: [{ sourceTaskUrl: 'https://example.test/old', targetTaskUrl: 'https://example.test/new', targetTaskTitle: 'New task' }, { sourceTaskUrl: 'https://example.test/old-two', targetTaskUrl: 'https://example.test/new-two', targetTaskTitle: 'Newer task' }],
    startDate: '2026-05-19', endDate: '2026-08-18',
  };
  const result = await context.handle(request, extensionSender);
  assert.equal(result.mergedEntries, 2); assert.equal(result.mergedActive, false); assert.equal(result.destinationCount, 1);
  assert.deepEqual(calls.map(call => call.destinationId), ['github:1']);
  assert.deepEqual(calls[0].request.pairs, request.pairs);
});

test('MERGE_TASKS rejects requests spanning multiple time repositories', async () => {
  const context = handlerContext({ configuredSnapshot: async () => ({ registry, auth: { githubLogin: 'alice' } }) });
  await assert.rejects(context.handle({
    type: 'MERGE_TASKS', destinationIds: ['github:1', 'github:2'], selectedUsers: ['alice'],
    pairs: [{ sourceTaskUrl: 'https://example.test/old', targetTaskUrl: 'https://example.test/new', targetTaskTitle: 'New task' }],
    startDate: '2026-05-19', endDate: '2026-08-18',
  }, extensionSender), /one time repository/i);
});

test('MERGE_TASKS writes selected other-user storage branches rather than only the current user branch', async () => {
  const calls = [];
  const context = handlerContext({
    configuredSnapshot: async () => ({ registry, auth: { githubLogin: 'alice' } }),
    destinationUser: async () => 'alice',
    githubForConfig: destination => ({ destinationId: destination.id }),
    discoverUserStorageBranches: async github => [{ id: 42, login: 'bob', github: { destinationId: github.destinationId, branch: 'bob' } }],
    TrackerService: class {
      constructor({ github, user }) { this.github = github; this.user = user; }
      async mergeTasks(request) { calls.push({ destinationId: this.github.destinationId, user: this.user, request }); return { mergedEntries: 1, mergedActive: false }; }
    },
    trackerForDestination: async destinationId => ({
      getState: async () => ({ pendingWrites: [] }),
      mergeTasks: async request => { calls.push({ destinationId, user: 'alice', request }); return { mergedEntries: 1, mergedActive: false }; },
    }),
  });
  await context.handle({
    type: 'MERGE_TASKS', destinationIds: ['github:1'], selectedUsers: ['alice', 'bob'],
    pairs: [{ sourceTaskUrl: 'https://example.test/old', targetTaskUrl: 'https://example.test/new', targetTaskTitle: 'New task' }],
    startDate: '2026-05-19', endDate: '2026-08-18',
  }, extensionSender);
  assert.deepEqual(calls.map(call => [call.destinationId, call.user]), [['github:1', 'alice'], ['github:1', 'bob']]);
});

test('extracted service-worker handler pins STOP to the active destination', async () => {
  const calls = [], syncRequests = [];
  const store = {
    getTrackingSnapshot: async () => ({ activeTimer: { destinationId: 'github:2', record: { id: 'running' } } }),
    getDestinationRegistry: async () => registry,
  };
  const context = handlerContext({
    store,
    requestPendingSync: () => syncRequests.push('stop'),
    trackerForDestination: async (destinationId, options) => ({
      stop: async (...args) => { calls.push({ destinationId, options, args }); return { pending: true, entry: { id: 'running' } }; },
    }),
  });
  const result = await context.handle({ type: 'STOP', description: 'done' }, extensionSender);
  assert.equal(result.destinationId, 'github:2');
  assert.deepEqual(calls.map(call => [call.destinationId, call.args[0], call.args[1]?.background]), [
    ['github:2', 'done', true],
  ]);
  assert.deepEqual(syncRequests, ['stop'], 'Stop must use the shared 15-second idle scheduler');
  assert.equal(calls[0].options?.localOnly, true, 'Stop must not wait for GitHub preflight');
});

test('extracted service-worker handler requires and routes a completed edit destination', async () => {
  const calls = [];
  const store = { getDestinationRegistry: async () => registry };
  const context = handlerContext({
    store,
    trackerForDestination: async (destinationId, options) => ({
      queueEntryEdit: async payload => { calls.push({ destinationId, options, payload }); return { pending: true }; },
    }),
  });
  await assert.rejects(
    () => context.handle({ type: 'QUEUE_ENTRY_EDIT', payload: { original: { id: 'entry' } } }, extensionSender),
    /destination ID/i,
  );
  const payload = { destinationId: 'github:2', original: { id: 'entry' }, edits: { description: 'updated' } };
  const result = await context.handle({ type: 'QUEUE_ENTRY_EDIT', payload }, extensionSender);
  assert.equal(result.destinationId, 'github:2');
  assert.deepEqual(calls.map(call => call.destinationId), ['github:2']);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].payload)), { original: { id: 'entry' }, edits: { description: 'updated' } });
  assert.equal('destinationId' in calls[0].payload, false);
  assert.equal(calls[0].options?.localOnly, true, 'queued edits must never wait for GitHub preflight');
});

test('passive GitHub pulls run independently and never send UI messages or trigger a render', async () => {
  const calls = [];
  const context = vm.createContext({
    configuredSnapshot: async () => ({ auth: { githubLogin: 'alice' }, registry }),
    trackerForDestination: async (id, options) => ({
      pullRemoteSilently: async () => { calls.push({ id, localOnly: options.localOnly }); },
    }),
  });
  const source = sourceBetween('let pendingPull = null;', 'function scheduleSyncAlarm(');
  for (const call of ['renderUi(', 'chrome.tabs.sendMessage(', 'chrome.runtime.sendMessage(']) {
    assert.equal(source.includes(call), false, `background pull must not call ${call}`);
  }
  vm.runInContext(source, context);
  await context.pullRemoteNow();
  assert.deepEqual(calls, [
    { id: 'github:1', localOnly: true },
    { id: 'github:2', localOnly: true },
  ]);
});

test('a failed passive pull does not block the other time repositories', async () => {
  const calls = [];
  const context = vm.createContext({
    configuredSnapshot: async () => ({ auth: { githubLogin: 'alice' }, registry }),
    trackerForDestination: async id => ({
      pullRemoteSilently: async () => {
        calls.push(id);
        if (id === 'github:1') throw new Error('GitHub offline');
      },
    }),
  });
  vm.runInContext(sourceBetween('let pendingPull = null;', 'function scheduleSyncAlarm('), context);
  await context.pullRemoteNow();
  assert.deepEqual(calls, ['github:1', 'github:2']);
});

test('extracted alarm handler synchronizes every pending destination without consulting default state', async () => {
  const queues = {
    'github:1': [{ id: 'one', operation: 'editEntry', stage: 'editEntry', status: 'pending' }],
    'github:2': [{ id: 'two', operation: 'startTimer', stage: 'startNext', status: 'pending' }],
  };
  const calls = [], created = [], listeners = [];
  const store = {
    ensureDataVersion: async () => { throw new Error('default projected state must not be read'); },
    getState: async () => { throw new Error('default projected state must not be read'); },
    getPendingDestinationIds: async () => Object.keys(queues).filter(id => queues[id].length),
    getTrackingSnapshot: async () => ({
      destinationStates: { entries: Object.fromEntries(Object.entries(queues).map(([id, pendingWrites]) => [id, { pendingWrites: structuredClone(pendingWrites) }])) },
    }),
  };
  const context = vm.createContext({
    Date,
    store,
    trackerForDestination: async destinationId => ({
      syncPending: async () => {
        calls.push(destinationId);
        queues[destinationId].shift();
        return [];
      },
    }),
    syncPendingAll,
    withCurrentRepositoryRecovery: async (_message, operation) => operation(),
    executor: { run: operation => operation() },
    chrome: { alarms: {
      create: (...args) => created.push(args),
      onAlarm: { addListener: listener => listeners.push(listener) },
    } },
  });
  vm.runInContext(sourceBetween('let pendingSync = null;', 'function requestPendingSync('), context);
  vm.runInContext("chrome.alarms.onAlarm.addListener(alarm => {\n  if (alarm.name === 'sync-pending') void syncPendingNow().catch(() => {});\n});", context);
  assert.equal(listeners.length, 1);
  listeners[0]({ name: 'sync-pending' });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['github:1', 'github:2']);
  assert.deepEqual(created, []);
});

for (const [label, operation] of [
  ['blocked dependency', {
    id: 'target', operation: 'startTimer', stage: 'awaitSourceCompletion', status: 'pending',
    blockedBy: { destinationId: 'github:1', operationId: 'source', operation: 'completeTimer' },
  }],
  ['retryable conflict', {
    id: 'edit', operation: 'editEntry', stage: 'editEntry', status: 'conflict', conflictReason: 'sha_conflict',
  }],
]) {
  test(`extracted pending sync leaves a ${label} queued for the next minute`, async () => {
    const queues = { 'github:2': [structuredClone(operation)] };
    const created = [];
    const store = {
      getPendingDestinationIds: async () => Object.keys(queues).filter(id => queues[id].length),
      getTrackingSnapshot: async () => ({ destinationStates: { entries: {
        'github:2': { pendingWrites: structuredClone(queues['github:2']) },
      } } }),
      unblockCrossDestinationStart: async () => false,
    };
    const context = vm.createContext({
      Date, store, syncPendingAll,
      trackerForDestination: async () => ({ syncPending: async () => structuredClone(queues['github:2']) }),
      withCurrentRepositoryRecovery: async (_message, callback) => callback(),
      executor: { run: callback => callback() },
      chrome: { alarms: { create: (...args) => created.push(args) } },
    });
    vm.runInContext(sourceBetween('let pendingSync = null;', 'function requestPendingSync('), context);
    await context.syncPendingNow();
    assert.deepEqual(created, [], 'retries use the existing periodic alarm');
  });
}

test('extracted service-worker handler submits one atomic cross-destination SWITCH plan', async () => {
  const acceptedPlans = [], requestedSync = [];
  const current = {
    id: '01J5SOURCE0000000000000000', taskUrl: 'https://example.test/default/1', taskTitle: 'Old',
    startedAt: '2026-09-09T08:00:00.000Z', entryDate: '2026-09-09', timezone: 'UTC', _sha: null,
  };
  const sourceTracker = {
    getState: async () => ({ active: current }),
    prepareQueuedStop: active => ({
      operation: { id: active.id, operation: 'completeTimer', stage: 'verifyActive', status: 'pending', queuedAt: '2026-09reti', retryCount: 0 },
      entry: { id: active.id, taskUrl: active.taskUrl },
      pendingEntry: { id: active.id, taskUrl: active.taskUrl, _pending: true },
    }),
  };
  const targetTracker = {
    prepareQueuedStart: (taskUrl, taskTitle, description, options) => ({
      operation: {
        id: options.id, operation: 'startTimer', stage: 'awaitSourceCompletion', status: 'pending', retryCount: 0,
        blockedBy: structuredClone(options.blockedBy), nextActive: { id: options.id, taskUrl },
      },
      pendingActive: { id: options.id, taskUrl, taskTitle, description, _pending: true },
    }),
  };
  const store = {
    getConfigurationSnapshot: async () => ({ registry, config: registry.destinations['github:1'] }),
    getLocalPreferences: async () => ({ projects: registry.projects }),
    getAuthSnapshot: async () => ({ auth: { mode: 'github_app' } }),
    getTrackingSnapshot: async () => ({ activeTimer: { destinationId: 'github:1', record: current } }),
    getDestinationRegistry: async () => registry,
    acceptCrossDestinationSwitch: async plan => { acceptedPlans.push(structuredClone(plan)); return true; },
  };
  const context = handlerContext({
    store,
    trackerForDestination: async id => id === 'github:1' ? sourceTracker : targetTracker,
    requestPendingSync: () => requestedSync.push(true),
  });
  const result = await context.handle({ type: 'SWITCH_TASK', taskUrl: 'https://example.test/team/2', taskTitle: 'New' }, extensionSender);
  assert.equal(result.destinationId, 'github:2');
  assert.equal(acceptedPlans.length, 1);
  const plan = acceptedPlans[0];
  assert.deepEqual(plan.expectedActive, { destinationId: 'github:1', recordId: current.id });
  assert.equal(plan.source.destinationId, 'github:1');
  assert.equal(plan.target.destinationId, 'github:2');
  assert.deepEqual(plan.target.operation.blockedBy, {
    destinationId: 'github:1', operationId: plan.source.operation.id, operation: 'completeTimer',
  });
  assert.equal(plan.target.pendingActive.id, plan.target.operation.nextActive.id);
  assert.deepEqual(requestedSync, [true]);
});
