function supersededError() {
  return new DOMException('Task load was superseded by a configuration change.', 'AbortError');
}

function assertLoadUsable({ signal, assertCurrent } = {}) {
  signal?.throwIfAborted();
  assertCurrent?.();
}

export async function refreshTaskState(executor, store, tracker, expectedGeneration, guard = {}) {
  return executor.run(async () => {
    assertLoadUsable(guard);
    if (await store.getConfigurationGeneration() !== expectedGeneration) throw supersededError();
    assertLoadUsable(guard);
    const state = await tracker.getState({ refresh: true, signal: guard.signal });
    assertLoadUsable(guard);
    if (await store.getConfigurationGeneration() !== expectedGeneration) throw supersededError();
    return state;
  });
}

export async function finalizeTaskLoad(executor, store, tracker, expectedGeneration, guard = {}) {
  return executor.run(async () => {
    assertLoadUsable(guard);
    if (await store.getConfigurationGeneration() !== expectedGeneration) throw supersededError();
    assertLoadUsable(guard);
    const state = await tracker.getState({ signal: guard.signal });
    assertLoadUsable(guard);
    return state;
  });
}

export async function saveConfigurationAfterCancelling(executor, cancelLoads, save) {
  await cancelLoads();
  return executor.run(save);
}

export class ConfigurationLoadCoordinator {
  constructor(executor) { this.executor = executor; this.epoch = 0; this.saving = null; }

  current() { return this.epoch; }

  async beginLoad() {
    while (this.saving) {
      const saving = this.saving;
      await saving.catch(() => {});
      if (this.saving === saving) this.saving = null;
    }
    return this.epoch;
  }

  assertCurrent(expectedEpoch) {
    if (expectedEpoch !== this.epoch) throw supersededError();
  }

  save(cancelLoads, save) {
    this.epoch += 1;
    const previous = this.saving;
    const operation = (async () => {
      if (previous) await previous.catch(() => {});
      return saveConfigurationAfterCancelling(this.executor, cancelLoads, save);
    })();
    this.saving = operation;
    const clear = () => { if (this.saving === operation) this.saving = null; };
    operation.then(clear, clear);
    return operation;
  }
}
