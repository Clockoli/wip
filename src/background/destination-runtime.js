function registryDestinations(registry) {
  return registry?.destinations && typeof registry.destinations === 'object' ? registry.destinations : {};
}

export function selectReadDestinations(snapshot, payload = {}) {
  const destinations = registryDestinations(snapshot?.registry);
  const allIds = Object.keys(destinations);
  const explicit = Object.hasOwn(payload, 'destinationIds');
  const ids = explicit ? payload.destinationIds : allIds;
  if (!Array.isArray(ids) || (explicit && ids.length === 0)) {
    throw Object.assign(new Error('Choose at least one time repository.'), { code: 'invalid_destinations' });
  }
  const unique = [...new Set(ids)];
  if (unique.some(id => typeof id !== 'string' || !Object.hasOwn(destinations, id))) {
    throw Object.assign(new Error('A selected time repository is no longer configured.'), { code: 'unknown_destination' });
  }
  return unique.map(id => ({ id, ...destinations[id], label: destinations[id].label || `${destinations[id].owner}/${destinations[id].repo}` }));
}

export async function requireConfiguredDestinationId(store, destinationId) {
  if (typeof destinationId !== 'string' || !destinationId) throw new Error('A destination ID is required.');
  const registry = await store.getDestinationRegistry();
  if (!Object.hasOwn(registryDestinations(registry), destinationId)) throw new Error('The requested destination is not configured.');
  return destinationId;
}

export async function resolveStartDestinationId(store, taskUrl) {
  const [snapshot, preferences, authSnapshot] = await Promise.all([
    store.getConfigurationSnapshot(),
    store.getLocalPreferences(),
    store.getAuthSnapshot(),
  ]);
  const registry = snapshot.registry;
  const destinations = registryDestinations(registry);
  const ids = Object.keys(destinations);
  if (!registry?.defaultDestinationId || !Object.hasOwn(destinations, registry.defaultDestinationId)) {
    throw new Error('Choose a default time repository in Settings.');
  }
  if (authSnapshot.auth?.mode === 'pat') {
    if (ids.length !== 1) throw new Error('PAT compatibility mode supports exactly one destination.');
    return registry.defaultDestinationId;
  }
  const candidate = String(taskUrl || '').toLowerCase();
  const projects = Array.isArray(registry.projects) ? registry.projects : preferences.projects;
  for (const project of projects ?? []) {
    if ((project?.substrings ?? []).some(substring => candidate.includes(String(substring).toLowerCase()))) {
      if (!Object.hasOwn(destinations, project.destinationId)) throw new Error('A project route references an unconfigured destination.');
      return project.destinationId;
    }
  }
  return registry.defaultDestinationId;
}

export async function activeDestinationId(store, { required = false } = {}) {
  const [tracking, registry] = await Promise.all([store.getTrackingSnapshot(), store.getDestinationRegistry()]);
  const destinationId = tracking.activeTimer?.destinationId ?? null;
  if (!destinationId) {
    if (required) throw new Error('No timer is running');
    return null;
  }
  if (!Object.hasOwn(registryDestinations(registry), destinationId)) {
    throw new Error('The active timer references an unconfigured destination.');
  }
  return destinationId;
}

function pendingEntries(snapshot) {
  return snapshot?.destinationStates?.entries ?? {};
}

function dependencyExists(entries, blockedBy) {
  return (entries?.[blockedBy?.destinationId]?.pendingWrites ?? [])
    .some(operation => operation?.id === blockedBy?.operationId
      && blockedBy?.operation === 'completeTimer'
      && operation?.operation === blockedBy.operation);
}

export async function syncPendingAll({ store, trackerForDestination }) {
  const destinationIds = await store.getPendingDestinationIds();
  const results = {}, errors = [];
  for (const destinationId of destinationIds) {
    const snapshot = await store.getTrackingSnapshot();
    const first = pendingEntries(snapshot)[destinationId]?.pendingWrites?.[0];
    if (!first || first.stage === 'awaitSourceCompletion') continue;
    try { results[destinationId] = await (await trackerForDestination(destinationId)).syncPending(); }
    catch (error) { errors.push(error); }
  }

  const afterSources = await store.getTrackingSnapshot();
  for (const destinationId of destinationIds) {
    const first = pendingEntries(afterSources)[destinationId]?.pendingWrites?.[0];
    if (first?.stage !== 'awaitSourceCompletion' || dependencyExists(pendingEntries(afterSources), first.blockedBy)) continue;
    try {
      if (!await store.unblockCrossDestinationStart(destinationId, first.id)) continue;
      results[destinationId] = await (await trackerForDestination(destinationId)).syncPending();
    } catch (error) { errors.push(error); }
  }
  if (errors.length) throw errors[0];
  return results;
}
