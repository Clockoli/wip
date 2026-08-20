import test from 'node:test';
import assert from 'node:assert/strict';
import { SerialExecutor } from '../src/background/serial-executor.js';
import { ConfigurationLoadCoordinator, finalizeTaskLoad, refreshTaskState, saveConfigurationAfterCancelling } from '../src/background/task-load.js';

const activeA = { issue: { url: 'https://github.com/acme/app/issues/1' }, sha: 'a'.repeat(40) };
const activeB = { issue: { url: 'https://github.com/acme/app/issues/2' }, sha: 'b'.repeat(40) };

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('a delayed Tasks refresh cannot resurrect a timer cleared by Stop', async () => {
  const executor = new SerialExecutor(), gate = deferred();
  const state = { active: activeA, pendingWrites: [] };
  const tracker = { getState: async ({ refresh }) => {
    if (refresh) { await gate.promise; state.active = activeA; }
    return structuredClone(state);
  } };
  const store = { getConfigurationGeneration: async () => 3 };

  const refreshing = refreshTaskState(executor, store, tracker, 3);
  const stopping = executor.run(async () => { state.active = null; });
  gate.resolve();
  await refreshing;
  await stopping;
  const finalState = await finalizeTaskLoad(executor, store, tracker, 3);
  assert.equal(finalState.active, null);
  assert.equal(state.active, null);
});

test('final Tasks snapshot observes a Start serialized after its initial refresh', async () => {
  const executor = new SerialExecutor(), state = { active: null, pendingWrites: [] };
  const tracker = { getState: async () => structuredClone(state) };
  const store = { getConfigurationGeneration: async () => 7 };
  await refreshTaskState(executor, store, tracker, 7);
  await executor.run(async () => { state.active = activeB; });
  assert.deepEqual((await finalizeTaskLoad(executor, store, tracker, 7)).active, activeB);
});

test('final Tasks snapshot rejects a configuration generation change', async () => {
  const executor = new SerialExecutor();
  const tracker = { getState: async () => ({ active: null, pendingWrites: [] }) };
  const store = { getConfigurationGeneration: async () => 9 };
  await assert.rejects(() => finalizeTaskLoad(executor, store, tracker, 8), error => error?.name === 'AbortError');
});

test('configuration cancellation waits outside the executor so a final Tasks snapshot cannot deadlock it', async () => {
  const executor = new SerialExecutor();
  let taskFinished = false, saved = false;
  const task = Promise.resolve().then(() => executor.run(async () => { taskFinished = true; }));
  await saveConfigurationAfterCancelling(executor, () => task, async () => { saved = true; });
  assert.equal(taskFinished, true);
  assert.equal(saved, true);
});

test('a Tasks refresh queued after configuration rotation aborts before touching old credentials or active cache', async () => {
  const executor = new SerialExecutor();
  let refreshes = 0;
  const store = { getConfigurationGeneration: async () => 12 };
  const tracker = { getState: async () => { refreshes += 1; return { active: activeA, pendingWrites: [] }; } };
  await assert.rejects(() => refreshTaskState(executor, store, tracker, 11), error => error?.name === 'AbortError');
  assert.equal(refreshes, 0);
});

test('a load missed by the cancellation snapshot is rejected before it can queue old work', async () => {
  const executor = new SerialExecutor(), coordinator = new ConfigurationLoadCoordinator(executor);
  const oldLoad = await coordinator.beginLoad();
  let cancelled = false, saved = false, oldWorkRan = false;
  const saving = coordinator.save(async () => { cancelled = true; }, async () => { saved = true; });
  assert.equal(cancelled, true);
  assert.throws(() => coordinator.assertCurrent(oldLoad), error => error?.name === 'AbortError');
  if (oldLoad === coordinator.current()) oldWorkRan = true;
  await saving;
  assert.equal(oldWorkRan, false);
  assert.equal(saved, true);
});

test('loads arriving during configuration save wait for its final configuration epoch', async () => {
  const executor = new SerialExecutor(), coordinator = new ConfigurationLoadCoordinator(executor), gate = deferred();
  const saving = coordinator.save(async () => {}, async () => { await gate.promise; });
  let began = false;
  const loading = coordinator.beginLoad().then(epoch => { began = true; return epoch; });
  await Promise.resolve();
  assert.equal(began, false);
  gate.resolve(); await saving;
  const epoch = await loading;
  assert.equal(epoch, coordinator.current());
  coordinator.assertCurrent(epoch);
});
