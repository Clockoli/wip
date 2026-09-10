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
  syncPendingAll,
} from '../src/background/destination-runtime.js';
import { createUlid } from '../src/domain/ulid.js';
import { taskUrlOf } from '../src/domain/values.js';

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

function handlerContext(overrides = {}) {
  const context = vm.createContext({
    URL, TextEncoder, Date, Map, AbortController,
    chrome: { runtime: { getURL: () => extensionOrigin }, action: { setIcon: async () => {} }, tabs: { create: async () => {} } },
    assertMessageAllowed, destinationIdForCompletedMutation, taskUrlForParticipantLoad, taskUrlForStart, taskUrlForTimelineSwitch,
    activeDestinationId, requireConfiguredDestinationId, resolveStartDestinationId, syncPendingAll,
    createUlid, taskUrlOf,
    globalTrackerState: async () => ({ configured: true, active: null, recent: [], pendingWrites: [] }),
    requestPendingSync: () => {},
    ...overrides,
  });
  vm.runInContext(sourceBetween('async function handle(', 'chrome.runtime.onMessage.addListener'), context);
  return context;
}

test('extracted service-worker handler routes START to the first matching destination', async () => {
  const calls = [];
  const store = {
    getConfigurationSnapshot: async () => ({ registry, config: registry.destinations['github:1'] }),
    getLocalPreferences: async () => ({ projects: registry.projects }),
    getAuthSnapshot: async () => ({ auth: { mode: 'github_app' } }),
  };
  const context = handlerContext({
    store,
    trackerForDestination: async destinationId => ({
      start: async (...args) => { calls.push({ destinationId, args }); return { id: 'timer', _pending: true }; },
    }),
  });
  const result = await context.handle({ type: 'START', taskUrl: 'https://example.test/team/42', taskTitle: 'Team task' }, extensionSender);
  assert.equal(result.destinationId, 'github:2');
  assert.deepEqual(calls.map(call => [call.destinationId, call.args[0], call.args[3]?.background]), [
    ['github:2', 'https://example.test/team/42', true],
  ]);
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

test('extracted service-worker handler pins STOP to the active destination', async () => {
  const calls = [];
  const store = {
    getTrackingSnapshot: async () => ({ activeTimer: { destinationId: 'github:2', record: { id: 'running' } } }),
    getDestinationRegistry: async () => registry,
  };
  const context = handlerContext({
    store,
    trackerForDestination: async destinationId => ({
      stop: async (...args) => { calls.push({ destinationId, args }); return { pending: true, entry: { id: 'running' } }; },
    }),
  });
  const result = await context.handle({ type: 'STOP', description: 'done' }, extensionSender);
  assert.equal(result.destinationId, 'github:2');
  assert.deepEqual(calls.map(call => [call.destinationId, call.args[0], call.args[1]?.background]), [
    ['github:2', 'done', true],
  ]);
});

test('extracted service-worker handler requires and routes a completed edit destination', async () => {
  const calls = [];
  const store = { getDestinationRegistry: async () => registry };
  const context = handlerContext({
    store,
    trackerForDestination: async destinationId => ({
      queueEntryEdit: async payload => { calls.push({ destinationId, payload }); return { pending: true }; },
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
  vm.runInContext("chrome.alarms.onAlarm.addListener(alarm => {\n  if (alarm.name === 'sync-pending' || alarm.name === 'sync-pending-now') void syncPendingNow().catch(() => {});\n});", context);
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
  test(`extracted pending sync keeps retry scheduling alive for a ${label}`, async () => {
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
    assert.equal(created.length, 1);
    assert.equal(created[0][0], 'sync-pending-now');
    assert.equal(created[0][1].when > Date.now(), true);
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
