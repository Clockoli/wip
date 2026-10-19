import test from 'node:test';
import assert from 'node:assert/strict';
import {
  requireConfiguredDestinationId,
  resolveStartDestinationId,
  selectReadDestinations,
  syncPendingAll,
} from '../src/background/destination-runtime.js';

const registry = {
  version: 1,
  defaultDestinationId: 'github:1',
  destinations: {
    'github:1': { id: 'github:1', owner: 'default', repo: 'time' },
    'github:2': { id: 'github:2', owner: 'team', repo: 'time' },
  },
};

test('read destination selection defaults to all and rejects explicit empty or unknown selections', () => {
  assert.deepEqual(selectReadDestinations({ registry }, {}).map(item => item.id), ['github:1', 'github:2']);
  assert.deepEqual(selectReadDestinations({ registry }, { destinationIds: ['github:2', 'github:2'] }).map(item => item.id), ['github:2']);
  assert.throws(() => selectReadDestinations({ registry }, { destinationIds: [] }), error => error?.code === 'invalid_destinations');
  assert.throws(() => selectReadDestinations({ registry }, { destinationIds: ['github:404'] }), error => error?.code === 'unknown_destination');
});

function routingStore({ authMode = 'github_app', projects = [] } = {}) {
  return {
    getConfigurationSnapshot: async () => ({ registry, config: registry.destinations['github:1'] }),
    getLocalPreferences: async () => ({ projects }),
    getAuthSnapshot: async () => ({ auth: { mode: authMode } }),
  };
}

test('Start routing uses ordered first match then the registry default', async () => {
  const store = routingStore({ projects: [
    { id: 'specific', name: 'Specific', substrings: ['github.com/acme/special/'], destinationId: 'github:2' },
    { id: 'broad', name: 'Broad', substrings: ['github.com/acme/'], destinationId: 'github:1' },
  ] });
  assert.equal(await resolveStartDestinationId(store, 'https://github.com/acme/special/issues/1'), 'github:2');
  assert.equal(await resolveStartDestinationId(store, 'https://github.com/acme/other/issues/2'), 'github:1');
  assert.equal(await resolveStartDestinationId(store, 'https://example.test/task'), 'github:1');
});

test('PAT mode remains pinned to exactly one destination', async () => {
  const store = routingStore({ authMode: 'pat', projects: [
    { id: 'team', name: 'Team', substrings: ['example.test'], destinationId: 'github:2' },
  ] });
  await assert.rejects(() => resolveStartDestinationId(store, 'https://example.test/task'), /PAT.*one destination/i);
});

test('completed mutations require a configured destination ID', async () => {
  const store = { getDestinationRegistry: async () => registry };
  assert.equal(await requireConfiguredDestinationId(store, 'github:2'), 'github:2');
  for (const value of [undefined, '', 'github:404', 2]) {
    await assert.rejects(() => requireConfiguredDestinationId(store, value), /destination/i);
  }
});

test('sync processes every runnable destination and resumes a target after source removal', async () => {
  const queues = {
    'github:1': [{ id: 'source-op', operation: 'completeTimer', stage: 'verifyActive', status: 'pending' }],
    'github:2': [{ id: 'target-op', operation: 'startTimer', stage: 'awaitSourceCompletion', status: 'pending', blockedBy: { destinationId: 'github:1', operationId: 'source-op', operation: 'completeTimer' } }],
    'github:3': [{ id: 'other-op', operation: 'editEntry', stage: 'editEntry', status: 'pending' }],
  };
  const calls = [];
  const store = {
    getPendingDestinationIds: async () => Object.keys(queues).filter(id => queues[id].length),
    getTrackingSnapshot: async () => ({ destinationStates: { entries: Object.fromEntries(Object.entries(queues).map(([id, pendingWrites]) => [id, { pendingWrites: structuredClone(pendingWrites) }])) } }),
    unblockCrossDestinationStart: async (destinationId, operationId) => {
      const operation = queues[destinationId][0];
      if (operation?.id !== operationId || queues[operation.blockedBy.destinationId].some(item => item.id === operation.blockedBy.operationId)) return false;
      operation.stage = 'startNext'; delete operation.blockedBy; return true;
    },
  };
  const trackerForDestination = async destinationId => ({
    syncPending: async () => { calls.push(destinationId); queues[destinationId].shift(); return structuredClone(queues[destinationId]); },
  });
  await syncPendingAll({ store, trackerForDestination });
  assert.deepEqual(calls, ['github:1', 'github:3', 'github:2']);
  assert.deepEqual(queues, { 'github:1': [], 'github:2': [], 'github:3': [] });
});

test('a new local change while one destination syncs defers untouched destinations until the next idle window', async () => {
  const queues = {
    'github:1': [{ id: 'earlier', operation: 'editEntry', status: 'pending' }],
    'github:2': [{ id: 'later', operation: 'editEntry', status: 'pending' }],
  };
  const calls = [];
  let idle = true;
  const store = {
    getPendingDestinationIds: async () => Object.keys(queues).filter(id => queues[id].length),
    getTrackingSnapshot: async () => ({ destinationStates: { entries: Object.fromEntries(
      Object.entries(queues).map(([id, pendingWrites]) => [id, { pendingWrites: structuredClone(pendingWrites) }]),
    ) } }),
  };
  await syncPendingAll({
    store, canSync: async () => idle,
    trackerForDestination: async id => ({ syncPending: async () => {
      calls.push(id);
      queues[id].shift();
      if (id === 'github:1') idle = false; // User changed something while the first GitHub request was in flight.
      return queues[id];
    } }),
  });
  assert.deepEqual(calls, ['github:1'], 'a newer local edit postpones GitHub writes not yet started');
  assert.equal(queues['github:2'].length, 1, 'later destination stays durably queued');
});

test('source conflict keeps a cross-destination target blocked across sync attempts', async () => {
  const queues = {
    'github:1': [{ id: 'source-op', operation: 'completeTimer', stage: 'verifyActive', status: 'conflict' }],
    'github:2': [{ id: 'target-op', operation: 'startTimer', stage: 'awaitSourceCompletion', status: 'pending', blockedBy: { destinationId: 'github:1', operationId: 'source-op', operation: 'completeTimer' } }],
  };
  const calls = [];
  const store = {
    getPendingDestinationIds: async () => Object.keys(queues),
    getTrackingSnapshot: async () => ({ destinationStates: { entries: Object.fromEntries(Object.entries(queues).map(([id, pendingWrites]) => [id, { pendingWrites: structuredClone(pendingWrites) }])) } }),
    unblockCrossDestinationStart: async () => { throw new Error('must remain blocked'); },
  };
  await syncPendingAll({ store, trackerForDestination: async id => ({ syncPending: async () => { calls.push(id); return queues[id]; } }) });
  assert.deepEqual(calls, ['github:1']);
  assert.equal(queues['github:2'][0].stage, 'awaitSourceCompletion');
});

test('cross-destination dependency does not confuse a different operation with the same ID', async () => {
  const queues = {
    'github:1': [
      { id: 'shared-id', operation: 'completeTimer', stage: 'verifyActive', status: 'pending' },
      { id: 'shared-id', operation: 'startTimer', stage: 'startNext', status: 'conflict' },
    ],
    'github:2': [{
      id: 'target-op', operation: 'startTimer', stage: 'awaitSourceCompletion', status: 'pending',
      blockedBy: { destinationId: 'github:1', operationId: 'shared-id', operation: 'completeTimer' },
    }],
  };
  const calls = [];
  const store = {
    getPendingDestinationIds: async () => Object.keys(queues).filter(id => queues[id].length),
    getTrackingSnapshot: async () => ({ destinationStates: { entries: Object.fromEntries(
      Object.entries(queues).map(([id, pendingWrites]) => [id, { pendingWrites: structuredClone(pendingWrites) }]),
    ) } }),
    unblockCrossDestinationStart: async (destinationId, operationId) => {
      const operation = queues[destinationId][0];
      if (operation?.id !== operationId) return false;
      const sourceQueue = queues[operation.blockedBy.destinationId];
      if (sourceQueue.some(item => item.id === operation.blockedBy.operationId && item.operation === operation.blockedBy.operation)) return false;
      operation.stage = 'startNext'; delete operation.blockedBy; return true;
    },
  };
  await syncPendingAll({ store, trackerForDestination: async id => ({
    syncPending: async () => {
      calls.push(id);
      if (id === 'github:1') queues[id].shift();
      else queues[id].shift();
      return queues[id];
    },
  }) });
  assert.deepEqual(calls, ['github:1', 'github:2']);
  assert.equal(queues['github:1'][0].operation, 'startTimer');
  assert.deepEqual(queues['github:2'], []);
});
