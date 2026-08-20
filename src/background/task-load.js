function supersededError() {
  return new DOMException('Task load was superseded by a configuration change.', 'AbortError');
}

export function refreshTaskState(executor, store, tracker, expectedGeneration) {
  return executor.run(async () => {
    if (await store.getConfigurationGeneration() !== expectedGeneration) throw supersededError();
    return tracker.getState({ refresh: true });
  });
}

export function finalizeTaskLoad(executor, store, tracker, expectedGeneration) {
  return executor.run(async () => {
    if (await store.getConfigurationGeneration() !== expectedGeneration) throw supersededError();
    return tracker.getState({ refresh: false });
  });
}

export async function saveConfigurationAfterCancelling(executor, cancelLoads, save) {
  await cancelLoads();
  return executor.run(save);
}
