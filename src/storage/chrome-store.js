import {
  invoicingSettings, normalizeBillingSettings, normalizeDefaultDestinationId, normalizeOtherProjectClient, normalizeOtherProjectName,
  normalizeProjectDefinitions, normalizeProjects, normalizeReportingUtc, parseSettingsImport, projectClientPreferences, settingsExportText,
} from '../domain/local-settings.js';
const DEFAULT_STATE = Object.freeze({ activeCache: null, recentCache: [], summaryCache: null, pendingWrites: [], user: null, dataVersion: 0 });
const DESTINATION_STATE_DEFAULT = Object.freeze({ user: null, recentCache: [], summaryCache: null, pendingWrites: [] });
const CONFIGURATION_GENERATION = 'configurationGeneration';
const AUTH = 'auth';
const AUTH_GENERATION = 'authGeneration';
const DEVICE_ATTEMPT = 'deviceAttempt';
const PENDING_AUTH = 'pendingAuth';
const PENDING_AUTH_GENERATION = 'pendingAuthGeneration';
const ONBOARDING_KEYS = ['onboardingLastVerifiedAt', 'onboardingVerificationStatus'];
const REPOSITORY_CHOICE = 'onboardingRepositoryChoice';
const BILLING_SETTINGS = 'billingSettings';
const EXCHANGE_RATE_CACHE = 'exchangeRateCache';
const LOCAL_RECENT_DAYS = 'localRecentDays';
const PROJECTS = 'projects';
const OTHER_PROJECT_NAME = 'otherProjectName';
const OTHER_PROJECT_CLIENT = 'otherProjectClient';
const REPORTING_UTC = 'reportingUtc';
const SHOW_QUEUE_DIAGNOSTICS = 'showQueueDiagnostics';
const SETTINGS_REVISION = 'settingsRevision';
const SETTINGS_EXPORTED_REVISION = 'settingsExportedRevision';
const SETTINGS_KEYS = [BILLING_SETTINGS, LOCAL_RECENT_DAYS, PROJECTS, OTHER_PROJECT_NAME, OTHER_PROJECT_CLIENT, REPORTING_UTC, SHOW_QUEUE_DIAGNOSTICS, SETTINGS_REVISION, SETTINGS_EXPORTED_REVISION];
const DESTINATION_REGISTRY = 'destinationRegistry';
const DESTINATION_STATES = 'destinationStates';
const ACTIVE_TIMER = 'activeTimer';
const REPOSITORY_VERIFICATION = 'repositoryVerification';
const LEGACY_TRACKING_KEYS = ['activeCache', 'recentCache', 'summaryCache', 'pendingWrites', 'user'];
const V5_TRACKING_KEYS = [DESTINATION_REGISTRY, DESTINATION_STATES, ACTIVE_TIMER, 'dataVersion'];
const MIGRATION_KEYS = [
  'config', CONFIGURATION_GENERATION, ...LEGACY_TRACKING_KEYS, 'dataVersion', ...ONBOARDING_KEYS,
  'taskMetadataCache', 'reportCache', DESTINATION_REGISTRY, DESTINATION_STATES, ACTIVE_TIMER, REPOSITORY_VERIFICATION,
];
const ALL_KEYS = [REPOSITORY_CHOICE, 'config', 'token', AUTH, AUTH_GENERATION, PENDING_AUTH, PENDING_AUTH_GENERATION, DEVICE_ATTEMPT, 'reportCache', 'taskMetadataCache', EXCHANGE_RATE_CACHE, ...ONBOARDING_KEYS, ...SETTINGS_KEYS, CONFIGURATION_GENERATION, ...Object.keys(DEFAULT_STATE), DESTINATION_REGISTRY, DESTINATION_STATES, ACTIVE_TIMER, REPOSITORY_VERIFICATION];

function preservedProjectClients(values) {
  if (!(values[BILLING_SETTINGS]?.invoicing?.clients ?? []).some(client => Array.isArray(client.projects) && client.projects.length)) return {};
  const preferences = projectClientPreferences({ projects: values[PROJECTS] || [], billing: values[BILLING_SETTINGS], otherProjectName: normalizeOtherProjectName(values[OTHER_PROJECT_NAME]), otherProjectClient: values[OTHER_PROJECT_CLIENT] });
  return { [PROJECTS]: preferences.projects, [OTHER_PROJECT_CLIENT]: preferences.otherProjectClient };
}

function generationValue(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function storageFormatError(message) {
  return Object.assign(new Error(message), { code: 'incompatible_storage_format' });
}

function crossDestinationSwitchPendingError() {
  return Object.assign(new Error('Wait for the previous cross-repository task switch to finish, then try again.'), {
    code: 'cross_destination_switch_pending',
  });
}

function emptyDestinationRegistry() {
  return { version: 1, defaultDestinationId: null, destinations: {} };
}

function emptyDestinationStates() { return { version: 1, entries: {} }; }

function validLegacyConfiguration(config) {
  return config && typeof config === 'object' && !Array.isArray(config)
    && typeof config.owner === 'string' && config.owner.length > 0
    && typeof config.repo === 'string' && config.repo.length > 0;
}

function portableRandomUuid() {
  const crypto = globalThis.crypto;
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();
  if (typeof crypto?.getRandomValues !== 'function') {
    throw storageFormatError('This browser cannot allocate a stable local destination identifier.');
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function legacyDestinationId(config) {
  if (Number.isSafeInteger(config.repoId) && config.repoId > 0) return `github:${config.repoId}`;
  return `legacy:${portableRandomUuid()}`;
}

function destinationState(value) {
  return { ...structuredClone(DESTINATION_STATE_DEFAULT), ...(value && typeof value === 'object' ? value : {}) };
}

function projectedDestinationState(values, destinationId) {
  const entry = destinationState(values[DESTINATION_STATES]?.entries?.[destinationId]);
  const activeCache = values[ACTIVE_TIMER]?.destinationId === destinationId ? values[ACTIVE_TIMER].record : null;
  return { ...structuredClone(entry), activeCache: structuredClone(activeCache), dataVersion: 5 };
}

function validV5Structures(values) {
  const registry = values[DESTINATION_REGISTRY], states = values[DESTINATION_STATES];
  if (!registry || registry.version !== 1 || !registry.destinations || typeof registry.destinations !== 'object'
      || !states || states.version !== 1 || !states.entries || typeof states.entries !== 'object') return false;
  if (registry.defaultDestinationId !== null && !Object.hasOwn(registry.destinations, registry.defaultDestinationId)) return false;
  const active = values[ACTIVE_TIMER];
  return active === null || (active && typeof active === 'object' && Object.hasOwn(registry.destinations, active.destinationId) && Object.hasOwn(active, 'record'));
}

function destinationIdForConfiguration(config) {
  if (!Number.isSafeInteger(config?.repoId) || config.repoId <= 0) {
    throw storageFormatError('A GitHub destination requires a positive stable repository ID.');
  }
  return `github:${config.repoId}`;
}

function normalizedRegistryDestinations(destinations = {}) {
  return Object.fromEntries(Object.entries(destinations).map(([id, destination]) => {
    const { id: _id, label: _label, ...runtime } = destination;
    return [id, runtime];
  }));
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error || new Error('IndexedDB request failed')), { once: true });
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', resolve, { once: true });
    transaction.addEventListener('abort', () => reject(transaction.error || new Error('IndexedDB transaction aborted')), { once: true });
    transaction.addEventListener('error', () => reject(transaction.error || new Error('IndexedDB transaction failed')), { once: true });
  });
}

export class IndexedDbBackend {
  constructor(factory = indexedDB, databaseName = 'clockoli') {
    this.factory = factory;
    this.databaseName = databaseName;
    this.database = null;
  }

  async open() {
    if (this.database) return this.database;
    const request = this.factory.open(this.databaseName, 1);
    request.addEventListener('upgradeneeded', () => {
      if (!request.result.objectStoreNames.contains('values')) request.result.createObjectStore('values');
    }, { once: true });
    this.database = await requestResult(request);
    this.database.addEventListener('versionchange', () => { this.database?.close(); this.database = null; });
    return this.database;
  }

  async getMany(keys) {
    const database = await this.open();
    const transaction = database.transaction('values', 'readonly');
    const objectStore = transaction.objectStore('values');
    const results = await Promise.all(keys.map(async key => [key, await requestResult(objectStore.get(key))]));
    await transactionDone(transaction);
    return Object.fromEntries(results.filter(([, value]) => value !== undefined));
  }

  async setMany(values) {
    const database = await this.open();
    const transaction = database.transaction('values', 'readwrite');
    const objectStore = transaction.objectStore('values');
    for (const [key, value] of Object.entries(values)) objectStore.put(value, key);
    await transactionDone(transaction);
  }

  async deleteMany(keys) {
    const database = await this.open();
    const transaction = database.transaction('values', 'readwrite');
    const objectStore = transaction.objectStore('values');
    for (const key of keys) objectStore.delete(key);
    await transactionDone(transaction);
  }

  async setManyAndIncrement(values, counterKey) {
    const database = await this.open();
    const transaction = database.transaction('values', 'readwrite');
    const done = transactionDone(transaction);
    const objectStore = transaction.objectStore('values');
    const current = await requestResult(objectStore.get(counterKey));
    const next = (Number.isSafeInteger(current) && current >= 0 ? current : 0) + 1;
    for (const [key, value] of Object.entries({ ...values, [counterKey]: next })) objectStore.put(value, key);
    await done;
    return next;
  }

  async setManyIfEqual(compareKey, expected, values) {
    const database = await this.open();
    const transaction = database.transaction('values', 'readwrite');
    const done = transactionDone(transaction);
    const objectStore = transaction.objectStore('values');
    const current = await requestResult(objectStore.get(compareKey));
    if ((Number.isSafeInteger(current) && current >= 0 ? current : 0) !== expected) {
      await done;
      return false;
    }
    for (const [key, value] of Object.entries(values)) objectStore.put(value, key);
    await done;
    return true;
  }

  async mutateMany(keys, mutate) {
    const database = await this.open();
    const transaction = database.transaction('values', 'readwrite');
    const done = transactionDone(transaction);
    const objectStore = transaction.objectStore('values');
    const pairs = await Promise.all(keys.map(async key => [key, await requestResult(objectStore.get(key))]));
    const current = Object.fromEntries(pairs.filter(([, value]) => value !== undefined));
    const mutation = mutate(current);
    if (!mutation) { await done; return false; }
    for (const key of mutation.delete || []) objectStore.delete(key);
    for (const [key, value] of Object.entries(mutation.set || {})) objectStore.put(value, key);
    await done;
    return mutation.result ?? true;
  }
}

export class ChromeStore {
  constructor(backend = new IndexedDbBackend()) { this.backend = backend; }

  // UI-only, credentials-free intent. This never configures a destination.
  async getOnboardingRepositoryChoice(account) {
    const values = await this.backend.getMany([REPOSITORY_CHOICE]);
    const choice = values[REPOSITORY_CHOICE];
    return choice?.account === account && typeof choice.fullName === 'string' ? choice.fullName : '';
  }

  async saveOnboardingRepositoryChoice(account, fullName) {
    if (typeof account !== 'string' || !account || typeof fullName !== 'string' || fullName.length > 140) throw new Error('Invalid repository choice');
    await this.backend.setMany({ [REPOSITORY_CHOICE]: { account, fullName } });
  }

  async getState() {
    const stored = await this.backend.getMany([...Object.keys(DEFAULT_STATE), DESTINATION_REGISTRY, DESTINATION_STATES, ACTIVE_TIMER]);
    if (stored.dataVersion === 5 && stored[DESTINATION_REGISTRY] && stored[DESTINATION_STATES]) {
      const destinationId = stored[DESTINATION_REGISTRY].defaultDestinationId;
      return destinationId ? projectedDestinationState(stored, destinationId) : { ...structuredClone(DEFAULT_STATE), dataVersion: 5 };
    }
    return { ...structuredClone(DEFAULT_STATE), ...stored };
  }

  async patchState(patch) {
    const { dataVersion = 0, destinationRegistry = null } = await this.backend.getMany(['dataVersion', DESTINATION_REGISTRY]);
    if (dataVersion === 5 && destinationRegistry?.defaultDestinationId) {
      return this.destinationStore(destinationRegistry.defaultDestinationId).patchState(patch);
    }
    await this.backend.setMany(patch);
  }

  async mutateState(mutate) {
    return this.backend.mutateMany([...Object.keys(DEFAULT_STATE), DESTINATION_REGISTRY, DESTINATION_STATES, ACTIVE_TIMER], values => {
      if (values.dataVersion === 5 && values[DESTINATION_REGISTRY]?.defaultDestinationId) {
        return this.destinationMutation(values[DESTINATION_REGISTRY].defaultDestinationId, values, mutate);
      }
      const state = { ...structuredClone(DEFAULT_STATE), ...values };
      const patch = mutate(structuredClone(state));
      return patch ? { set: patch, result: { ...state, ...patch } } : { result: state };
    });
  }

  async patchStateIfGeneration(patch, expectedGeneration, destinationId = null) {
    return this.backend.mutateMany(
      [CONFIGURATION_GENERATION, ...V5_TRACKING_KEYS],
      values => {
        if (generationValue(values[CONFIGURATION_GENERATION]) !== expectedGeneration) return { result: false };
        if (values.dataVersion !== 5) return { set: patch, result: true };
        const selected = destinationId ?? values[DESTINATION_REGISTRY]?.defaultDestinationId;
        if (!selected) return { result: false };
        const mutation = this.destinationMutation(selected, values, () => patch);
        return { ...mutation, result: true };
      },
    );
  }

  async ensureDataVersion(version) {
    if (version !== 5) return this.backend.mutateMany(version === 4 ? MIGRATION_KEYS : Object.keys(DEFAULT_STATE), values => {
      const state = { ...structuredClone(DEFAULT_STATE), ...values };
      if (state.dataVersion === version) return { result: state };
      // Staged runtime callers may still request v4 after another context has
      // atomically upgraded the shared store to v5. Return the compatible
      // destination projection without downgrading or changing generation.
      if (version === 4 && state.dataVersion === 5) {
        if (!validV5Structures(values)) throw storageFormatError('Clockoli local data version 5 is incomplete or invalid.');
        const destinationId = values[DESTINATION_REGISTRY].defaultDestinationId;
        return { result: destinationId ? projectedDestinationState(values, destinationId) : { ...structuredClone(DEFAULT_STATE), dataVersion: 5 } };
      }
      if (state.dataVersion > version) {
        throw storageFormatError(`Clockoli local data version ${state.dataVersion} is newer than supported version ${version}.`);
      }
      const reset = { activeCache: null, recentCache: [], summaryCache: null, pendingWrites: [], dataVersion: version };
      return { set: reset, result: { ...state, ...reset } };
    });
    return this.backend.mutateMany(MIGRATION_KEYS, values => {
      const currentVersion = Number.isSafeInteger(values.dataVersion) && values.dataVersion >= 0 ? values.dataVersion : 0;
      if (currentVersion > 5) throw storageFormatError(`Clockoli local data version ${currentVersion} is newer than supported version 5.`);
      if (currentVersion === 5) {
        if (!validV5Structures(values)) throw storageFormatError('Clockoli local data version 5 is incomplete or invalid.');
        const destinationId = values[DESTINATION_REGISTRY].defaultDestinationId;
        return { result: destinationId ? projectedDestinationState(values, destinationId) : { ...structuredClone(DEFAULT_STATE), dataVersion: 5 } };
      }

      const legacy = { ...structuredClone(DEFAULT_STATE), ...values };
      const hasWork = legacy.activeCache !== null || (legacy.recentCache ?? []).length > 0
        || legacy.summaryCache !== null || (legacy.pendingWrites ?? []).length > 0;
      if (currentVersion === 4 && hasWork && !validLegacyConfiguration(values.config)) {
        throw storageFormatError('Clockoli found local work that cannot be pinned to a configured destination.');
      }

      const registry = emptyDestinationRegistry(), states = emptyDestinationStates();
      let activeTimer = null, verification = {}, taskMetadataCache = { version: 2, entries: {} };
      if (validLegacyConfiguration(values.config)) {
        const id = legacyDestinationId(values.config);
        const config = structuredClone(values.config);
        registry.defaultDestinationId = id;
        registry.destinations[id] = { id, ...config, label: config.label || `${config.owner}/${config.repo}` };
        states.entries[id] = currentVersion === 4 ? {
          user: structuredClone(legacy.user), recentCache: structuredClone(legacy.recentCache),
          summaryCache: structuredClone(legacy.summaryCache), pendingWrites: structuredClone(legacy.pendingWrites),
        } : structuredClone(DESTINATION_STATE_DEFAULT);
        if (currentVersion === 4 && legacy.activeCache !== null) activeTimer = { destinationId: id, record: structuredClone(legacy.activeCache) };
        if (values.onboardingLastVerifiedAt !== undefined || values.onboardingVerificationStatus !== undefined) {
          verification[id] = {
            lastVerifiedAt: values.onboardingLastVerifiedAt ?? null,
            status: values.onboardingVerificationStatus ?? null,
          };
        }
        if (values.taskMetadataCache?.version === 2 && values.taskMetadataCache.entries && typeof values.taskMetadataCache.entries === 'object') {
          taskMetadataCache = structuredClone(values.taskMetadataCache);
        } else if (values.taskMetadataCache != null) {
          const scope = `${id}:${config.branch || 'main'}:${config.storageLogin || legacy.user || ''}`;
          taskMetadataCache.entries[scope] = structuredClone(values.taskMetadataCache);
        }
      }
      const generation = generationValue(values[CONFIGURATION_GENERATION]) + 1;
      const set = {
        [DESTINATION_REGISTRY]: registry, [DESTINATION_STATES]: states, [ACTIVE_TIMER]: activeTimer,
        [REPOSITORY_VERIFICATION]: verification, taskMetadataCache, dataVersion: 5,
        [CONFIGURATION_GENERATION]: generation,
      };
      return {
        set,
        delete: ['config', ...LEGACY_TRACKING_KEYS, ...ONBOARDING_KEYS],
        result: registry.defaultDestinationId
          ? projectedDestinationState(set, registry.defaultDestinationId)
          : { ...structuredClone(DEFAULT_STATE), dataVersion: 5 },
      };
    });
  }

  async getDestinationRegistry() {
    const values = await this.backend.getMany([DESTINATION_REGISTRY]);
    return structuredClone(values[DESTINATION_REGISTRY] ?? emptyDestinationRegistry());
  }

  async getDestinationConfiguration(destinationId) {
    return (await this.getDestinationRegistry()).destinations?.[destinationId] ?? null;
  }

  destinationRegistration(values, config, statePatch = {}) {
    if (values.dataVersion !== 5 || !validV5Structures(values)) {
      throw storageFormatError('Clockoli must finish upgrading local storage before registering a destination.');
    }
    const destinationId = destinationIdForConfiguration(config);
    const registry = structuredClone(values[DESTINATION_REGISTRY]);
    const entries = structuredClone(values[DESTINATION_STATES].entries);
    const existing = Object.hasOwn(registry.destinations, destinationId);
    registry.destinations[destinationId] = {
      ...structuredClone(config), id: destinationId,
      label: config.label || `${config.owner}/${config.repo}`,
    };
    if (!registry.defaultDestinationId) registry.defaultDestinationId = destinationId;
    if (!existing) {
      const state = destinationState();
      for (const key of Object.keys(DESTINATION_STATE_DEFAULT)) {
        if (Object.hasOwn(statePatch, key)) state[key] = structuredClone(statePatch[key]);
      }
      entries[destinationId] = state;
    } else if (!Object.hasOwn(entries, destinationId)) {
      entries[destinationId] = destinationState();
    }
    const verification = structuredClone(values[REPOSITORY_VERIFICATION] ?? {});
    if (Object.hasOwn(statePatch, 'onboardingLastVerifiedAt')
        || Object.hasOwn(statePatch, 'onboardingVerificationStatus')) {
      verification[destinationId] = {
        lastVerifiedAt: statePatch.onboardingLastVerifiedAt ?? null,
        status: statePatch.onboardingVerificationStatus ?? null,
      };
    }
    return {
      destinationId,
      set: {
        [DESTINATION_REGISTRY]: registry,
        [DESTINATION_STATES]: { ...values[DESTINATION_STATES], entries },
        [REPOSITORY_VERIFICATION]: verification,
        dataVersion: 5,
      },
      delete: ['config', ...LEGACY_TRACKING_KEYS, ...ONBOARDING_KEYS],
    };
  }

  async getTrackingSnapshot() {
    const values = await this.backend.getMany(V5_TRACKING_KEYS);
    return {
      activeTimer: structuredClone(values[ACTIVE_TIMER] ?? null),
      destinationStates: structuredClone(values[DESTINATION_STATES] ?? emptyDestinationStates()),
      dataVersion: values.dataVersion ?? 0,
    };
  }

  async getPendingDestinationIds() {
    const { destinationStates } = await this.getTrackingSnapshot();
    return Object.entries(destinationStates.entries)
      .filter(([, state]) => Array.isArray(state?.pendingWrites) && state.pendingWrites.length)
      .map(([destinationId]) => destinationId);
  }

  async acceptCrossDestinationSwitch(plan) {
    const expected = plan?.expectedActive, source = plan?.source, target = plan?.target;
    if (!expected || !source || !target || source.destinationId === target.destinationId
        || expected.destinationId !== source.destinationId
        || source.operation?.operation !== 'completeTimer' || source.operation?.nextActive
        || target.operation?.operation !== 'startTimer' || target.operation?.stage !== 'awaitSourceCompletion'
        || target.operation?.blockedBy?.destinationId !== source.destinationId
        || target.operation?.blockedBy?.operationId !== source.operation?.id
        || target.operation?.blockedBy?.operation !== 'completeTimer'
        || target.pendingActive?.id !== target.operation?.nextActive?.id) {
      throw new Error('Invalid cross-destination switch plan');
    }
    return this.backend.mutateMany(V5_TRACKING_KEYS, values => {
      if (!validV5Structures(values)
          || !values[DESTINATION_REGISTRY].destinations[source.destinationId]
          || !values[DESTINATION_REGISTRY].destinations[target.destinationId]) {
        throw storageFormatError('A cross-destination switch references an unconfigured destination.');
      }
      const active = values[ACTIVE_TIMER];
      if (active?.destinationId !== expected.destinationId || active?.record?.id !== expected.recordId) return { result: false };
      const entries = structuredClone(values[DESTINATION_STATES].entries);
      const sourceState = destinationState(entries[source.destinationId]);
      const targetState = destinationState(entries[target.destinationId]);
      if ([...sourceState.pendingWrites, ...targetState.pendingWrites]
        .some(operation => operation?.stage === 'awaitSourceCompletion')) {
        throw crossDestinationSwitchPendingError();
      }
      sourceState.pendingWrites.push(structuredClone(source.operation));
      sourceState.recentCache = [structuredClone(source.pendingEntry), ...sourceState.recentCache
        .filter(entry => entry?.id !== source.pendingEntry?.id)].slice(0, 50);
      targetState.pendingWrites.push(structuredClone(target.operation));
      entries[source.destinationId] = sourceState;
      entries[target.destinationId] = targetState;
      return {
        set: {
          [DESTINATION_STATES]: { ...values[DESTINATION_STATES], entries },
          [ACTIVE_TIMER]: { destinationId: target.destinationId, record: structuredClone(target.pendingActive) },
        },
        result: true,
      };
    });
  }

  async unblockCrossDestinationStart(destinationId, operationId) {
    return this.backend.mutateMany(V5_TRACKING_KEYS, values => {
      if (!validV5Structures(values) || !values[DESTINATION_REGISTRY].destinations[destinationId]) return { result: false };
      const entries = structuredClone(values[DESTINATION_STATES].entries), target = destinationState(entries[destinationId]);
      const operation = target.pendingWrites?.[0];
      if (operation?.id !== operationId || operation.stage !== 'awaitSourceCompletion'
          || operation.blockedBy?.operation !== 'completeTimer') return { result: false };
      const sourceQueue = entries[operation.blockedBy.destinationId]?.pendingWrites ?? [];
      if (sourceQueue.some(item => item.id === operation.blockedBy.operationId
          && item.operation === operation.blockedBy.operation)) return { result: false };
      operation.stage = 'startNext';
      delete operation.blockedBy;
      entries[destinationId] = target;
      return { set: { [DESTINATION_STATES]: { ...values[DESTINATION_STATES], entries } }, result: true };
    });
  }

  destinationStore(destinationId) {
    if (typeof destinationId !== 'string' || !destinationId) throw new Error('Destination ID is required');
    return {
      getState: async () => {
        const values = await this.backend.getMany(V5_TRACKING_KEYS);
        if (values.dataVersion !== 5 || !values[DESTINATION_REGISTRY]?.destinations?.[destinationId]) {
          throw storageFormatError(`Destination ${destinationId} is not configured.`);
        }
        return projectedDestinationState(values, destinationId);
      },
      patchState: async patch => {
        await this.backend.mutateMany(V5_TRACKING_KEYS, values => this.destinationMutation(destinationId, values, () => patch));
      },
      mutateState: mutate => this.backend.mutateMany(
        V5_TRACKING_KEYS, values => this.destinationMutation(destinationId, values, mutate),
      ),
    };
  }

  destinationMutation(destinationId, values, mutate) {
    if (values.dataVersion !== 5 || !values[DESTINATION_REGISTRY]?.destinations?.[destinationId]) {
      throw storageFormatError(`Destination ${destinationId} is not configured.`);
    }
    const state = projectedDestinationState(values, destinationId), patch = mutate(structuredClone(state));
    if (!patch) return { result: state };
    if (Object.hasOwn(patch, 'dataVersion') && patch.dataVersion !== 5) throw storageFormatError('Destination state data version must remain 5.');
    const entries = { ...values[DESTINATION_STATES].entries };
    const nextEntry = destinationState(entries[destinationId]);
    for (const key of Object.keys(DESTINATION_STATE_DEFAULT)) {
      if (Object.hasOwn(patch, key)) nextEntry[key] = structuredClone(patch[key]);
    }
    entries[destinationId] = nextEntry;
    let activeTimer = values[ACTIVE_TIMER] ?? null;
    if (Object.hasOwn(patch, 'activeCache')) {
      if (patch.activeCache === null) {
        if (activeTimer?.destinationId === destinationId) activeTimer = null;
      } else {
        if (activeTimer && activeTimer.destinationId !== destinationId) {
          throw new Error('A timer is already active in another destination.');
        }
        activeTimer = { destinationId, record: structuredClone(patch.activeCache) };
      }
    }
    const set = { [DESTINATION_STATES]: { ...values[DESTINATION_STATES], entries }, [ACTIVE_TIMER]: activeTimer };
    return { set, result: projectedDestinationState({ ...values, ...set }, destinationId) };
  }

  async getOnboardingVerification(destinationId = null) {
    const values = await this.backend.getMany([...ONBOARDING_KEYS, 'dataVersion', DESTINATION_REGISTRY, REPOSITORY_VERIFICATION]);
    if (values.dataVersion === 5) {
      const id = destinationId ?? values[DESTINATION_REGISTRY]?.defaultDestinationId;
      return structuredClone(values[REPOSITORY_VERIFICATION]?.[id] ?? { lastVerifiedAt: null, status: null });
    }
    return {
      lastVerifiedAt: values.onboardingLastVerifiedAt ?? null,
      status: values.onboardingVerificationStatus ?? null,
    };
  }

  async getRepositoryVerificationMap() {
    const values = await this.backend.getMany(['dataVersion', REPOSITORY_VERIFICATION]);
    return values.dataVersion === 5 ? structuredClone(values[REPOSITORY_VERIFICATION] ?? {}) : {};
  }

  async saveDestinationVerification(destinationId, status, lastVerifiedAt) {
    return this.backend.mutateMany(['dataVersion', DESTINATION_REGISTRY, REPOSITORY_VERIFICATION], values => {
      if (values.dataVersion !== 5 || !values[DESTINATION_REGISTRY]?.destinations?.[destinationId]) {
        throw storageFormatError(`Destination ${destinationId} is not configured.`);
      }
      const verification = structuredClone(values[REPOSITORY_VERIFICATION] ?? {});
      verification[destinationId] = { status, lastVerifiedAt };
      return { set: { [REPOSITORY_VERIFICATION]: verification }, result: verification[destinationId] };
    });
  }

  async setDefaultDestination(destinationId) {
    return this.backend.mutateMany(['dataVersion', DESTINATION_REGISTRY, CONFIGURATION_GENERATION, SETTINGS_REVISION], values => {
      if (values.dataVersion !== 5 || !values[DESTINATION_REGISTRY]?.destinations?.[destinationId]) {
        throw storageFormatError(`Destination ${destinationId} is not configured.`);
      }
      const registry = structuredClone(values[DESTINATION_REGISTRY]);
      registry.defaultDestinationId = destinationId;
      const generation = generationValue(values[CONFIGURATION_GENERATION]) + 1;
      const revision = generationValue(values[SETTINGS_REVISION]) + 1;
      return {
        set: { [DESTINATION_REGISTRY]: registry, [CONFIGURATION_GENERATION]: generation, [SETTINGS_REVISION]: revision },
        result: { destinationId, generation, revision },
      };
    });
  }

  async removeDestination(destinationId) {
    return this.backend.mutateMany(
      ['dataVersion', DESTINATION_REGISTRY, DESTINATION_STATES, ACTIVE_TIMER, REPOSITORY_VERIFICATION,
        PROJECTS, 'reportCache', 'taskMetadataCache', CONFIGURATION_GENERATION, SETTINGS_REVISION],
      values => {
        const registry = values[DESTINATION_REGISTRY], destination = registry?.destinations?.[destinationId];
        if (values.dataVersion !== 5 || !destination) throw storageFormatError(`Destination ${destinationId} is not configured.`);
        if (values[ACTIVE_TIMER]?.destinationId === destinationId) {
          throw new Error('Stop the timer using this repository before removing it.');
        }
        const pending = values[DESTINATION_STATES]?.entries?.[destinationId]?.pendingWrites ?? [];
        if (pending.length) throw new Error('Sync all pending changes for this repository before removing it.');
        const projectNames = (values[PROJECTS] ?? []).filter(project => project.destinationId === destinationId).map(project => project.name);
        if (projectNames.length) throw new Error(`Assign these projects to another repository before removing it: ${projectNames.join(', ')}.`);
        if (registry.defaultDestinationId === destinationId) {
          throw new Error('Choose another default time repository before removing this one.');
        }
        const nextRegistry = structuredClone(registry), nextStates = structuredClone(values[DESTINATION_STATES]);
        const verification = structuredClone(values[REPOSITORY_VERIFICATION] ?? {});
        delete nextRegistry.destinations[destinationId];
        delete nextStates.entries[destinationId];
        delete verification[destinationId];
        const generation = generationValue(values[CONFIGURATION_GENERATION]) + 1;
        const revision = generationValue(values[SETTINGS_REVISION]) + 1;
        return {
          set: {
            [DESTINATION_REGISTRY]: nextRegistry, [DESTINATION_STATES]: nextStates,
            [REPOSITORY_VERIFICATION]: verification, reportCache: null, taskMetadataCache: null,
            [CONFIGURATION_GENERATION]: generation, [SETTINGS_REVISION]: revision,
          },
          result: { destinationId, generation, revision },
        };
      },
    );
  }

  async getConfig() {
    const values = await this.backend.getMany(['config', 'token', 'dataVersion', DESTINATION_REGISTRY]);
    const config = values.dataVersion === 5
      ? values[DESTINATION_REGISTRY]?.destinations?.[values[DESTINATION_REGISTRY]?.defaultDestinationId] ?? null
      : values.config ?? null;
    const token = values.token ?? '';
    return { config, token };
  }

  async getConfigurationSnapshot(destinationId = null) {
    const values = await this.backend.getMany(['config', 'token', 'dataVersion', DESTINATION_REGISTRY, CONFIGURATION_GENERATION]);
    const { configurationGeneration = 0 } = values;
    const generation = Number.isSafeInteger(configurationGeneration) && configurationGeneration >= 0 ? configurationGeneration : 0;
    if (values.dataVersion === 5) {
      const registry = structuredClone(values[DESTINATION_REGISTRY] ?? emptyDestinationRegistry());
      const selected = destinationId ?? registry.defaultDestinationId;
      return { registry, destinationId: selected, config: registry.destinations?.[selected] ?? null, generation };
    }
    return { config: values.config ?? null, token: values.token ?? '', generation };
  }

  async getConfigurationGeneration() { return (await this.getConfigurationSnapshot()).generation; }

  async getAuthSnapshot() {
    const values = await this.backend.getMany([AUTH, AUTH_GENERATION, CONFIGURATION_GENERATION, 'token']);
    const authGeneration = Number.isSafeInteger(values[AUTH_GENERATION]) && values[AUTH_GENERATION] >= 0 ? values[AUTH_GENERATION] : 0;
    const configurationGeneration = Number.isSafeInteger(values[CONFIGURATION_GENERATION]) && values[CONFIGURATION_GENERATION] >= 0 ? values[CONFIGURATION_GENERATION] : 0;
    const auth = values[AUTH] ?? (values.token ? { mode: 'pat', accessToken: values.token, generation: authGeneration } : null);
    return { auth, authGeneration, configurationGeneration };
  }

  async migrateLegacyPatAuth() {
    return this.backend.mutateMany([AUTH, AUTH_GENERATION, 'token'], values => {
      if (values[AUTH]) return { result: values[AUTH] };
      if (!values.token) return { result: null };
      const generation = (Number.isSafeInteger(values[AUTH_GENERATION]) && values[AUTH_GENERATION] >= 0 ? values[AUTH_GENERATION] : 0) + 1;
      const auth = { mode: 'pat', accessToken: values.token, generation };
      return { set: { [AUTH]: auth, [AUTH_GENERATION]: generation }, delete: ['token'], result: auth };
    });
  }

  async getDeviceAttempt() {
    const values = await this.backend.getMany([DEVICE_ATTEMPT]);
    return values[DEVICE_ATTEMPT] ?? null;
  }

  async saveDeviceAttempt(attempt) { await this.backend.setMany({ [DEVICE_ATTEMPT]: attempt }); }

  async replaceDeviceAttempt(attemptId, attempt) {
    return this.backend.mutateMany([DEVICE_ATTEMPT], values => {
      if (!values[DEVICE_ATTEMPT] || values[DEVICE_ATTEMPT].id !== attemptId) return { result: false };
      return { set: { [DEVICE_ATTEMPT]: attempt }, result: true };
    });
  }

  async clearDeviceAttempt(attemptId = '') {
    return this.backend.mutateMany([DEVICE_ATTEMPT], values => {
      const current = values[DEVICE_ATTEMPT];
      if (!current || (attemptId && current.id !== attemptId)) return { result: false };
      return { delete: [DEVICE_ATTEMPT], result: true };
    });
  }

  async saveAuthorizedGitHubApp(auth, attemptId) {
    return this.backend.mutateMany([DEVICE_ATTEMPT, PENDING_AUTH_GENERATION], values => {
      if (values[DEVICE_ATTEMPT]?.id !== attemptId) return { result: false };
      const generation = (Number.isSafeInteger(values[PENDING_AUTH_GENERATION]) && values[PENDING_AUTH_GENERATION] >= 0 ? values[PENDING_AUTH_GENERATION] : 0) + 1;
      return {
        set: { [PENDING_AUTH]: { ...auth, candidateId: attemptId, generation }, [PENDING_AUTH_GENERATION]: generation },
        delete: [DEVICE_ATTEMPT], result: true,
      };
    });
  }

  async getPendingAuthSnapshot() {
    const values = await this.backend.getMany([PENDING_AUTH, PENDING_AUTH_GENERATION, CONFIGURATION_GENERATION]);
    const authGeneration = Number.isSafeInteger(values[PENDING_AUTH_GENERATION]) && values[PENDING_AUTH_GENERATION] >= 0 ? values[PENDING_AUTH_GENERATION] : 0;
    const configurationGeneration = Number.isSafeInteger(values[CONFIGURATION_GENERATION]) && values[CONFIGURATION_GENERATION] >= 0 ? values[CONFIGURATION_GENERATION] : 0;
    return { auth: values[PENDING_AUTH] ?? null, authGeneration, configurationGeneration };
  }

  async clearPendingGitHubAppAuth() {
    await this.backend.mutateMany([PENDING_AUTH, PENDING_AUTH_GENERATION, DEVICE_ATTEMPT], values => {
      const generation = (Number.isSafeInteger(values[PENDING_AUTH_GENERATION]) && values[PENDING_AUTH_GENERATION] >= 0 ? values[PENDING_AUTH_GENERATION] : 0) + 1;
      return { set: { [PENDING_AUTH_GENERATION]: generation }, delete: [PENDING_AUTH, DEVICE_ATTEMPT], result: true };
    });
  }

  async rotatePendingGitHubAppAuth(expectedAuthGeneration, _expectedConfigurationGeneration, auth) {
    return this.backend.mutateMany([PENDING_AUTH, PENDING_AUTH_GENERATION, AUTH, AUTH_GENERATION], values => {
      const pendingGeneration = Number.isSafeInteger(values[PENDING_AUTH_GENERATION]) && values[PENDING_AUTH_GENERATION] >= 0 ? values[PENDING_AUTH_GENERATION] : 0;
      if (pendingGeneration === expectedAuthGeneration && values[PENDING_AUTH]?.mode === 'github_app') {
        const generation = pendingGeneration + 1;
        return { set: { [PENDING_AUTH]: { ...auth, generation }, [PENDING_AUTH_GENERATION]: generation }, result: true };
      }
      // GitHub may consume the old refresh token just before this candidate is promoted.
      // Redirect only the exact promoted candidate's replacement pair into current auth.
      const current = values[AUTH];
      if (pendingGeneration === expectedAuthGeneration + 1 && !values[PENDING_AUTH]
          && auth.candidateId && current?.mode === 'github_app'
          && current.candidateId === auth.candidateId) {
        const generation = (Number.isSafeInteger(values[AUTH_GENERATION]) && values[AUTH_GENERATION] >= 0 ? values[AUTH_GENERATION] : 0) + 1;
        return { set: { [AUTH]: { ...auth, generation }, [AUTH_GENERATION]: generation }, result: true };
      }
      return { result: false };
    });
  }

  async rotateGitHubAppAuth(expectedAuthGeneration, _expectedConfigurationGeneration, auth) {
    return this.backend.mutateMany([AUTH_GENERATION], values => {
      const authGeneration = Number.isSafeInteger(values[AUTH_GENERATION]) && values[AUTH_GENERATION] >= 0 ? values[AUTH_GENERATION] : 0;
      if (authGeneration !== expectedAuthGeneration) return { result: false };
      const generation = authGeneration + 1;
      return { set: { [AUTH]: { ...auth, generation }, [AUTH_GENERATION]: generation }, result: true };
    });
  }

  async promoteToUserStorageBranch(expectedGeneration, expected, patch) {
    return this.backend.mutateMany(
      ['config', 'dataVersion', DESTINATION_REGISTRY, DESTINATION_STATES, ACTIVE_TIMER,
        CONFIGURATION_GENERATION, 'activeCache', 'pendingWrites', 'recentCache', 'summaryCache', 'reportCache', 'taskMetadataCache'],
      values => {
        const generation = generationValue(values[CONFIGURATION_GENERATION]);
        if (generation !== expectedGeneration) return { result: false };
        if (values.dataVersion === 5) {
          const registry = structuredClone(values[DESTINATION_REGISTRY]), destinationId = registry?.defaultDestinationId;
          const config = registry?.destinations?.[destinationId], state = destinationState(values[DESTINATION_STATES]?.entries?.[destinationId]);
          if (!config || config.owner !== expected.owner || config.repo !== expected.repo || config.branch !== expected.branch
              || values[ACTIVE_TIMER] || state.pendingWrites.length) return { result: false };
          registry.destinations[destinationId] = { ...config, ...structuredClone(patch) };
          const entries = structuredClone(values[DESTINATION_STATES].entries);
          entries[destinationId] = { ...state, recentCache: [], summaryCache: null };
          return {
            set: {
              [DESTINATION_REGISTRY]: registry, [DESTINATION_STATES]: { ...values[DESTINATION_STATES], entries },
              [CONFIGURATION_GENERATION]: generation + 1, reportCache: null, taskMetadataCache: null,
            },
            result: generation + 1,
          };
        }
        const config = values.config;
        if (!config || config.owner !== expected.owner || config.repo !== expected.repo || config.branch !== expected.branch
            || values.activeCache || (values.pendingWrites || []).length) return { result: false };
        return {
          set: {
            config: { ...config, ...structuredClone(patch) }, [CONFIGURATION_GENERATION]: generation + 1,
            recentCache: [], summaryCache: null, reportCache: null, taskMetadataCache: null,
          },
          result: generation + 1,
        };
      },
    );
  }

  async saveConfig(config, token) { await this.backend.setMany({ config, token, summaryCache: null }); }

  async getReportCache(repositoryKey) {
    const { reportCache = null } = await this.backend.getMany(['reportCache']);
    if (reportCache?.repositoryKey === repositoryKey) return reportCache;
    return reportCache?.version === 2 && reportCache.entries?.[repositoryKey] || null;
  }

  async saveReportCache(value) {
    await this.backend.mutateMany(['reportCache'], current => {
      const existing = current.reportCache?.version === 2 && current.reportCache.entries
        ? current.reportCache.entries
        : current.reportCache?.repositoryKey ? { [current.reportCache.repositoryKey]: current.reportCache } : {};
      return { set: { reportCache: { version: 2, entries: { ...existing, [value.repositoryKey]: value } } }, result: true };
    });
  }

  async getTaskMetadataCache(repositoryKey) {
    const { taskMetadataCache = null } = await this.backend.getMany(['taskMetadataCache']);
    if (taskMetadataCache?.version === 2 && taskMetadataCache.entries && typeof taskMetadataCache.entries === 'object') {
      return taskMetadataCache.entries[repositoryKey] ?? null;
    }
    return taskMetadataCache?.repositoryKey === repositoryKey ? taskMetadataCache : null;
  }

  async saveTaskMetadataCache(taskMetadataCache, expectedGeneration = null) {
    return this.backend.mutateMany(['taskMetadataCache', CONFIGURATION_GENERATION], values => {
      if (expectedGeneration !== null && generationValue(values[CONFIGURATION_GENERATION]) !== expectedGeneration) return { result: false };
      const current = values.taskMetadataCache;
      const entries = current?.version === 2 && current.entries && typeof current.entries === 'object'
        ? { ...current.entries }
        : current?.repositoryKey ? { [current.repositoryKey]: current } : {};
      if (taskMetadataCache === null) return { set: { taskMetadataCache: { version: 2, entries: {} } }, result: true };
      return {
        set: { taskMetadataCache: { version: 2, entries: { ...entries, [taskMetadataCache.repositoryKey]: structuredClone(taskMetadataCache) } } },
        result: true,
      };
    });
  }

  async saveConfiguration(config, token, statePatch) {
    return this.backend.setManyAndIncrement({ config, token, ...statePatch, summaryCache: null }, CONFIGURATION_GENERATION);
  }

  async getExchangeRateCache() {
    const values = await this.backend.getMany([EXCHANGE_RATE_CACHE]);
    return values[EXCHANGE_RATE_CACHE] ?? null;
  }

  async saveExchangeRateCache(value) {
    await this.backend.mutateMany([EXCHANGE_RATE_CACHE], current => {
      const existing = current[EXCHANGE_RATE_CACHE];
      const entries = existing?.version === value.version && existing.entries && typeof existing.entries === 'object'
        ? { ...existing.entries } : {};
      for (const [key, incoming] of Object.entries(value.entries || {})) {
        const current = entries[key];
        const newerEffectiveDate = String(incoming?.effectiveDate || '').localeCompare(String(current?.effectiveDate || ''));
        const newerFetch = String(incoming?.fetchedAt || '').localeCompare(String(current?.fetchedAt || ''));
        if (!current || newerEffectiveDate > 0 || (newerEffectiveDate === 0 && newerFetch >= 0)) entries[key] = incoming;
      }
      return {
        set: { [EXCHANGE_RATE_CACHE]: { ...value, entries } },
        result: true,
      };
    });
  }

  async getLocalPreferences() {
    const values = await this.backend.getMany(['config', 'dataVersion', DESTINATION_REGISTRY, ...SETTINGS_KEYS]);
    const normalizedBilling = normalizeBillingSettings(values[BILLING_SETTINGS] || {});
    const billing = { ...normalizedBilling, invoicing: invoicingSettings(normalizedBilling) };
    const revision = Number.isSafeInteger(values[SETTINGS_REVISION]) && values[SETTINGS_REVISION] >= 0 ? values[SETTINGS_REVISION] : 0;
    const exportedRevision = Number.isSafeInteger(values[SETTINGS_EXPORTED_REVISION]) && values[SETTINGS_EXPORTED_REVISION] >= 0 ? values[SETTINGS_EXPORTED_REVISION] : 0;
    const defaultConfig = values.dataVersion === 5
      ? values[DESTINATION_REGISTRY]?.destinations?.[values[DESTINATION_REGISTRY]?.defaultDestinationId]
      : values.config;
    const recentDays = Number(values[LOCAL_RECENT_DAYS] ?? defaultConfig?.recentDays ?? 7);
    const registryDestinations = normalizedRegistryDestinations(values[DESTINATION_REGISTRY]?.destinations);
    if (values.dataVersion === 5) normalizeProjectDefinitions(values[PROJECTS] || [], registryDestinations);
    else normalizeProjects(values[PROJECTS] || []);
    const otherProjectName = normalizeOtherProjectName(values[OTHER_PROJECT_NAME]);
    const { projects, otherProjectClient } = projectClientPreferences({ projects: values[PROJECTS] || [], billing: values[BILLING_SETTINGS] || {}, otherProjectName, otherProjectClient: values[OTHER_PROJECT_CLIENT] });
    const showQueueDiagnostics = values[SHOW_QUEUE_DIAGNOSTICS] === true;
    return {
      recentDays, projects,
      ...(values.dataVersion === 5 ? { defaultDestinationId: values[DESTINATION_REGISTRY]?.defaultDestinationId ?? null } : {}),
      otherProjectName, otherProjectClient, reportingUtc: values[REPORTING_UTC] === true, showQueueDiagnostics, ...billing, revision, exportedRevision, exportRecommended: revision > exportedRevision,
    };
  }

  async saveBillingSettings(value, projectLinks = null, expectedRevision = null) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || !Object.keys(value).length || Object.keys(value).some(key => !['rates', 'invoicing'].includes(key))) {
      throw new Error('Billing settings are invalid');
    }
    if (expectedRevision !== null && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)) throw new Error('Settings revision is invalid');
    let normalizedLinks = null;
    if (projectLinks !== null) {
      if (!Object.hasOwn(value, 'invoicing')) throw new Error('Project client links require invoicing settings');
      if (!projectLinks || typeof projectLinks !== 'object' || Array.isArray(projectLinks)
          || Object.keys(projectLinks).some(key => !['projectClients', 'otherProjectClient'].includes(key))
          || !projectLinks.projectClients || typeof projectLinks.projectClients !== 'object' || Array.isArray(projectLinks.projectClients)) {
        throw new Error('Project client links are invalid');
      }
      const normalizeClient = value => normalizeOtherProjectClient(value);
      normalizedLinks = {
        projectClients: Object.fromEntries(Object.entries(projectLinks.projectClients).map(([id, client]) => [id, normalizeClient(client)])),
        otherProjectClient: normalizeClient(projectLinks.otherProjectClient),
      };
    }
    return this.backend.mutateMany([BILLING_SETTINGS, PROJECTS, OTHER_PROJECT_NAME, OTHER_PROJECT_CLIENT, SETTINGS_REVISION], values => {
      const previousBilling = normalizeBillingSettings(values[BILLING_SETTINGS] || {});
      const billing = normalizeBillingSettings({ ...previousBilling, ...value });
      const stored = invoicingSettings(previousBilling).nextNumber;
      if (invoicingSettings(billing).nextNumber < stored) throw new Error(`Next invoice number cannot go below ${stored}; invoice ${stored - 1} has already been issued.`);
      const currentRevision = Number.isSafeInteger(values[SETTINGS_REVISION]) && values[SETTINGS_REVISION] >= 0 ? values[SETTINGS_REVISION] : 0;
      if (expectedRevision !== null && expectedRevision !== currentRevision) throw new Error('Settings changed in another page. Reload settings and try again.');
      const revision = currentRevision + 1;
      const set = { ...preservedProjectClients(values), [BILLING_SETTINGS]: billing, [SETTINGS_REVISION]: revision };
      if (normalizedLinks) {
        const projects = values[PROJECTS] || [], storedIds = new Set(projects.map(project => project.id).filter(Boolean));
        const unknown = Object.keys(normalizedLinks.projectClients).find(id => !storedIds.has(id));
        if (unknown) throw new Error(`Project client link references an unknown project: ${unknown}`);
        set[PROJECTS] = projects.map(project => Object.hasOwn(normalizedLinks.projectClients, project.id)
          ? { ...project, client: normalizedLinks.projectClients[project.id] } : project);
        set[OTHER_PROJECT_CLIENT] = normalizedLinks.otherProjectClient;
      }
      return {
        set,
        result: {
          ...billing, projects: set[PROJECTS] || values[PROJECTS] || [],
          otherProjectClient: set[OTHER_PROJECT_CLIENT] ?? values[OTHER_PROJECT_CLIENT] ?? '',
          revision, exportRecommended: true,
        },
      };
    });
  }

  async reserveInvoiceNumber() {
    return this.backend.mutateMany([BILLING_SETTINGS, PROJECTS, OTHER_PROJECT_NAME, OTHER_PROJECT_CLIENT, SETTINGS_REVISION], values => {
      const billing = normalizeBillingSettings(values[BILLING_SETTINGS] || {}), invoicing = invoicingSettings(billing);
      const sequence = invoicing.nextNumber;
      if (sequence >= 1e9) throw new Error('Invoice number sequence is exhausted');
      const revision = generationValue(values[SETTINGS_REVISION]) + 1;
      return { set: { ...preservedProjectClients(values), [BILLING_SETTINGS]: { ...billing, invoicing: { ...invoicing, nextNumber: sequence + 1 } }, [SETTINGS_REVISION]: revision }, result: { sequence, numberFormat: invoicing.numberFormat, revision, exportRecommended: true } };
    });
  }

  async setQueueDiagnostics(enabled) {
    return this.backend.mutateMany([SHOW_QUEUE_DIAGNOSTICS, SETTINGS_REVISION], values => {
      const revision = generationValue(values[SETTINGS_REVISION]) + 1;
      const showQueueDiagnostics = enabled === true;
      return {
        set: { [SHOW_QUEUE_DIAGNOSTICS]: showQueueDiagnostics, [SETTINGS_REVISION]: revision },
        result: { showQueueDiagnostics, revision, exportRecommended: true },
      };
    });
  }

  async updateDisplayPreferences(preferences = {}, expectedRevision = null) {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error('Settings revision is invalid');
    return this.backend.mutateMany(['config', 'dataVersion', DESTINATION_REGISTRY, ...SETTINGS_KEYS, CONFIGURATION_GENERATION], values => {
      const currentRevision = generationValue(values[SETTINGS_REVISION]);
      if (expectedRevision !== currentRevision) throw new Error('Settings changed in another page. Reload settings and try again.');
      const defaultConfig = values.dataVersion === 5
        ? values[DESTINATION_REGISTRY]?.destinations?.[values[DESTINATION_REGISTRY]?.defaultDestinationId]
        : values.config;
      const normalized = Number(preferences.recentDays ?? values[LOCAL_RECENT_DAYS] ?? defaultConfig?.recentDays ?? 7);
      const sourceProjects = preferences.projects ?? values[PROJECTS] ?? [];
      const normalizedProjects = normalizeProjects(sourceProjects);
      const normalizedOtherProjectName = normalizeOtherProjectName(preferences.otherProjectName ?? values[OTHER_PROJECT_NAME]);
      const normalizedOtherProjectClient = normalizeOtherProjectClient(preferences.otherProjectClient ?? values[OTHER_PROJECT_CLIENT] ?? '');
      const reportingUtc = normalizeReportingUtc(preferences.reportingUtc ?? values[REPORTING_UTC] ?? false);
      const showQueueDiagnostics = preferences.showQueueDiagnostics ?? values[SHOW_QUEUE_DIAGNOSTICS] ?? false;
      if (normalizedProjects.some(project => project.name.toLowerCase() === normalizedOtherProjectName.toLowerCase())) throw new Error('Main project name must differ from named projects');
      if (!Number.isInteger(normalized) || normalized < 1 || normalized > 31) {
        throw new Error('Recent entries shown in the main panel must be between 1 and 31 days');
      }
      const generation = generationValue(values[CONFIGURATION_GENERATION]) + 1;
      const revision = currentRevision + 1;
      const set = {
        [LOCAL_RECENT_DAYS]: normalized, [OTHER_PROJECT_NAME]: normalizedOtherProjectName, [OTHER_PROJECT_CLIENT]: normalizedOtherProjectClient, [REPORTING_UTC]: reportingUtc,
        [SHOW_QUEUE_DIAGNOSTICS]: showQueueDiagnostics === true,
        [CONFIGURATION_GENERATION]: generation, [SETTINGS_REVISION]: revision,
      };
      let config, projects;
      if (values.dataVersion === 5) {
        if (!values[DESTINATION_REGISTRY]) throw storageFormatError('Clockoli local data version 5 has no destination registry.');
        const registry = structuredClone(values[DESTINATION_REGISTRY]);
        const destinations = normalizedRegistryDestinations(registry.destinations);
        const selected = normalizeDefaultDestinationId(preferences.defaultDestinationId ?? registry.defaultDestinationId, destinations);
        projects = normalizeProjectDefinitions(normalizedProjects, destinations);
        registry.defaultDestinationId = selected;
        registry.destinations[selected] = { ...registry.destinations[selected], recentDays: normalized };
        set[DESTINATION_REGISTRY] = registry;
        set[PROJECTS] = projects;
        config = registry.destinations[selected];
      } else {
        if (!values.config) throw new Error('Connect a repository before saving display settings');
        config = { ...values.config, recentDays: normalized };
        projects = normalizedProjects;
        set.config = config;
        set[PROJECTS] = projects;
      }
      return {
        set,
        result: {
          config, generation, revision,
          preferences: {
            recentDays: normalized, projects, otherProjectName: normalizedOtherProjectName,
            otherProjectClient: normalizedOtherProjectClient, reportingUtc,
            showQueueDiagnostics: showQueueDiagnostics === true, revision,
          },
        },
      };
    });
  }

  async importSettings(text) {
    const imported = parseSettingsImport(text);
    return this.backend.mutateMany(['config', 'dataVersion', DESTINATION_REGISTRY, CONFIGURATION_GENERATION, ...SETTINGS_KEYS], values => {
      const generation = generationValue(values[CONFIGURATION_GENERATION]) + 1;
      const revision = generationValue(values[SETTINGS_REVISION]) + 1;
      let projects = imported.projects;
      const storedInvoicing = invoicingSettings(values[BILLING_SETTINGS] || {});
      const importedInvoicing = invoicingSettings(imported.billing);
      const billing = {
        ...imported.billing,
        invoicing: { ...importedInvoicing, nextNumber: Math.max(storedInvoicing.nextNumber, importedInvoicing.nextNumber) },
      };
      const set = {
        [BILLING_SETTINGS]: billing, [LOCAL_RECENT_DAYS]: imported.recentDays,
        [OTHER_PROJECT_NAME]: imported.otherProjectName, [OTHER_PROJECT_CLIENT]: imported.otherProjectClient ?? '',
        [REPORTING_UTC]: imported.reportingUtc ?? false, [SHOW_QUEUE_DIAGNOSTICS]: imported.showQueueDiagnostics,
        [SETTINGS_REVISION]: revision, [SETTINGS_EXPORTED_REVISION]: revision, [CONFIGURATION_GENERATION]: generation,
      };
      if (values.dataVersion === 5) {
        if (!values[DESTINATION_REGISTRY]) throw storageFormatError('Clockoli local data version 5 has no destination registry.');
        const registry = structuredClone(values[DESTINATION_REGISTRY]);
        const destinations = normalizedRegistryDestinations(registry.destinations);
        const referencedIds = Object.keys(imported.destinations ?? {});
        if (referencedIds.some(id => !Object.hasOwn(destinations, id))) {
          throw new Error('Settings reference a repository that is not a configured destination. Add it before importing routes.');
        }
        registry.defaultDestinationId = normalizeDefaultDestinationId(registry.defaultDestinationId, destinations);
        projects = (imported.projectDefinitions ?? imported.projects).map((project, index) => Object.hasOwn(project, 'id')
          ? project
          : { ...project, id: `legacy-project-${index + 1}`, destinationId: registry.defaultDestinationId });
        projects = normalizeProjectDefinitions(projects, destinations);
        registry.destinations[registry.defaultDestinationId] = {
          ...registry.destinations[registry.defaultDestinationId], recentDays: imported.recentDays,
        };
        set[DESTINATION_REGISTRY] = registry;
      } else if (values.config) {
        set.config = { ...values.config, recentDays: imported.recentDays };
      }
      set[PROJECTS] = projects;
      return { set, result: { ...imported, billing, projects, revision, exportRecommended: false } };
    });
  }

  async exportSettings() {
    const values = await this.backend.getMany(['config', 'dataVersion', DESTINATION_REGISTRY, BILLING_SETTINGS, LOCAL_RECENT_DAYS, PROJECTS, OTHER_PROJECT_NAME, OTHER_PROJECT_CLIENT, REPORTING_UTC, SHOW_QUEUE_DIAGNOSTICS, SETTINGS_REVISION]);
    const revision = generationValue(values[SETTINGS_REVISION]);
    if (values.dataVersion === 5) {
      const registry = values[DESTINATION_REGISTRY] ?? emptyDestinationRegistry();
      const destinations = normalizedRegistryDestinations(registry.destinations);
      const config = { recentDays: values[LOCAL_RECENT_DAYS] ?? registry.destinations?.[registry.defaultDestinationId]?.recentDays ?? 7 };
      return {
        text: settingsExportText({
          config, billing: values[BILLING_SETTINGS] || {}, projects: values[PROJECTS] || [],
          otherProjectName: values[OTHER_PROJECT_NAME], otherProjectClient: values[OTHER_PROJECT_CLIENT],
          reportingUtc: values[REPORTING_UTC] === true, showQueueDiagnostics: values[SHOW_QUEUE_DIAGNOSTICS],
          destinations, defaultDestinationId: registry.defaultDestinationId,
        }),
        revision,
      };
    }
    const config = values.config ? { ...values.config } : { recentDays: values[LOCAL_RECENT_DAYS] ?? 7 };
    return {
      text: settingsExportText({
        config, billing: values[BILLING_SETTINGS] || {}, projects: values[PROJECTS] || [], otherProjectName: values[OTHER_PROJECT_NAME],
        otherProjectClient: values[OTHER_PROJECT_CLIENT], reportingUtc: values[REPORTING_UTC] === true, showQueueDiagnostics: values[SHOW_QUEUE_DIAGNOSTICS],
      }),
      revision,
    };
  }

  async markSettingsExported(revision) {
    const expected = Number(revision);
    return this.backend.mutateMany([SETTINGS_REVISION, SETTINGS_EXPORTED_REVISION], values => {
      const current = Number.isSafeInteger(values[SETTINGS_REVISION]) && values[SETTINGS_REVISION] >= 0 ? values[SETTINGS_REVISION] : 0;
      if (!Number.isSafeInteger(expected) || expected !== current) return { result: false };
      return { set: { [SETTINGS_EXPORTED_REVISION]: current }, result: true };
    });
  }

  async upgradeLegacyRepositoryIdentity(expectedGeneration, expected, patch) {
    return this.backend.mutateMany(
      ['config', 'dataVersion', DESTINATION_REGISTRY, DESTINATION_STATES, ACTIVE_TIMER, REPOSITORY_VERIFICATION,
        PROJECTS, CONFIGURATION_GENERATION],
      values => {
        const generation = generationValue(values[CONFIGURATION_GENERATION]);
        if (generation !== expectedGeneration) return { result: false };
        if (values.dataVersion === 5) {
          const registry = structuredClone(values[DESTINATION_REGISTRY]), oldId = registry?.defaultDestinationId;
          const config = registry?.destinations?.[oldId];
          if (!config || config.repoId || config.owner !== expected.owner || config.repo !== expected.repo
              || (config.branch || 'main') !== expected.branch) return { result: false };
          const nextId = destinationIdForConfiguration({ ...config, ...patch });
          if (nextId !== oldId && registry.destinations[nextId]) return { result: false };
          const nextConfig = { ...config, ...structuredClone(patch), id: nextId };
          const states = structuredClone(values[DESTINATION_STATES]), verification = structuredClone(values[REPOSITORY_VERIFICATION] ?? {});
          delete registry.destinations[oldId]; registry.destinations[nextId] = nextConfig; registry.defaultDestinationId = nextId;
          if (nextId !== oldId) {
            states.entries[nextId] = states.entries[oldId]; delete states.entries[oldId];
            if (Object.hasOwn(verification, oldId)) { verification[nextId] = verification[oldId]; delete verification[oldId]; }
          }
          const activeTimer = values[ACTIVE_TIMER]?.destinationId === oldId
            ? { ...values[ACTIVE_TIMER], destinationId: nextId } : values[ACTIVE_TIMER] ?? null;
          const projects = (values[PROJECTS] ?? []).map(project => project.destinationId === oldId ? { ...project, destinationId: nextId } : project);
          return {
            set: {
              [DESTINATION_REGISTRY]: registry, [DESTINATION_STATES]: states, [ACTIVE_TIMER]: activeTimer,
              [REPOSITORY_VERIFICATION]: verification, [PROJECTS]: projects, [CONFIGURATION_GENERATION]: generation + 1,
            },
            result: generation + 1,
          };
        }
        const config = values.config;
        if (!config || config.repoId || config.owner !== expected.owner || config.repo !== expected.repo
            || (config.branch || 'main') !== expected.branch) return { result: false };
        return {
          set: { config: { ...config, ...patch }, [CONFIGURATION_GENERATION]: generation + 1 },
          result: generation + 1,
        };
      },
    );
  }

  async savePatConfiguration(config, token, statePatch, identity = {}) {
    return this.backend.mutateMany([
      AUTH, AUTH_GENERATION, PENDING_AUTH, PENDING_AUTH_GENERATION, DEVICE_ATTEMPT,
      CONFIGURATION_GENERATION, 'dataVersion', DESTINATION_REGISTRY, DESTINATION_STATES,
      ACTIVE_TIMER, REPOSITORY_VERIFICATION, 'reportCache', 'taskMetadataCache',
      ...LEGACY_TRACKING_KEYS, ...ONBOARDING_KEYS,
    ], values => {
      const authGeneration = generationValue(values[AUTH_GENERATION]) + 1;
      const pendingAuthGeneration = generationValue(values[PENDING_AUTH_GENERATION]) + 1;
      const configurationGeneration = generationValue(values[CONFIGURATION_GENERATION]) + 1;
      const auth = {
        mode: 'pat', accessToken: token,
        ...(Number.isSafeInteger(identity.id) && identity.id > 0 ? { githubUserId: identity.id } : {}),
        ...(identity.login ? { githubLogin: identity.login } : {}),
        generation: authGeneration,
      };
      if (values.dataVersion === 5) {
        const patConfig = { ...config, authMode: 'pat' };
        const registration = this.destinationRegistration(values, patConfig, statePatch);
        const destinationId = registration.destinationId;
        const state = destinationState(registration.set[DESTINATION_STATES].entries[destinationId]);
        for (const key of Object.keys(DESTINATION_STATE_DEFAULT)) {
          if (Object.hasOwn(statePatch, key)) state[key] = structuredClone(statePatch[key]);
        }
        state.summaryCache = null;
        let activeTimer = values[ACTIVE_TIMER] ?? null;
        if (Object.hasOwn(statePatch, 'activeCache')) {
          activeTimer = statePatch.activeCache === null ? null : { destinationId, record: structuredClone(statePatch.activeCache) };
        }
        return {
          set: {
            [AUTH]: auth, [AUTH_GENERATION]: authGeneration,
            [PENDING_AUTH_GENERATION]: pendingAuthGeneration,
            [CONFIGURATION_GENERATION]: configurationGeneration,
            dataVersion: 5,
            [DESTINATION_REGISTRY]: {
              version: 1, defaultDestinationId: destinationId,
              destinations: { [destinationId]: registration.set[DESTINATION_REGISTRY].destinations[destinationId] },
            },
            [DESTINATION_STATES]: { version: 1, entries: { [destinationId]: state } },
            [ACTIVE_TIMER]: activeTimer,
            [REPOSITORY_VERIFICATION]: {},
            ...(Object.hasOwn(statePatch, 'reportCache') ? { reportCache: statePatch.reportCache } : {}),
            ...(Object.hasOwn(statePatch, 'taskMetadataCache') ? { taskMetadataCache: statePatch.taskMetadataCache } : {}),
          },
          delete: ['config', 'token', PENDING_AUTH, DEVICE_ATTEMPT, ...LEGACY_TRACKING_KEYS, ...ONBOARDING_KEYS],
          result: configurationGeneration,
        };
      }
      return {
        set: {
          [AUTH]: auth, [AUTH_GENERATION]: authGeneration,
          [PENDING_AUTH_GENERATION]: pendingAuthGeneration,
          config: { ...config, authMode: 'pat' }, ...statePatch, summaryCache: null,
          [CONFIGURATION_GENERATION]: configurationGeneration,
        },
        delete: ['token', PENDING_AUTH, DEVICE_ATTEMPT, ...ONBOARDING_KEYS], result: configurationGeneration,
      };
    });
  }

  // Discovery may add already-provisioned destinations locally, but must never
  // replace coordinates, accepted work, defaults, or promote candidate credentials.
  async registerReadyGitHubAppRepositories(configs, expectedAuthGeneration) {
    return this.backend.mutateMany([
      AUTH, AUTH_GENERATION, PENDING_AUTH, CONFIGURATION_GENERATION, 'dataVersion',
      DESTINATION_REGISTRY, DESTINATION_STATES, ACTIVE_TIMER, REPOSITORY_VERIFICATION,
    ], values => {
      if (values[AUTH]?.mode !== 'github_app' || values[PENDING_AUTH]
          || generationValue(values[AUTH_GENERATION]) !== expectedAuthGeneration) return { result: false };
      let next = { ...values }, changed = false, verificationChanged = false;
      for (const config of configs) {
        const id = destinationIdForConfiguration(config);
        const existing = next[DESTINATION_REGISTRY]?.destinations?.[id];
        if (existing) {
          // Readiness proves only these exact coordinates and this user's branch.
          // Refresh trust metadata, never replace configuration or accepted work.
          if (config.branch === `clockoli/users/${values[AUTH].githubUserId}`
              && ['owner', 'repo', 'repoId', 'installationId', 'branch', 'branchMode', 'storageLogin', 'authMode']
                .every(key => existing[key] === config[key])
              && !['access_checked', 'write_verified'].includes(next[REPOSITORY_VERIFICATION]?.[id]?.status)) {
            next[REPOSITORY_VERIFICATION] = { ...next[REPOSITORY_VERIFICATION],
              [id]: { ...next[REPOSITORY_VERIFICATION]?.[id], status: 'access_checked', lastVerifiedAt: new Date().toISOString() } };
            verificationChanged = true;
          }
          continue;
        }
        const registration = this.destinationRegistration(next, config, {
          user: config.storageLogin, onboardingVerificationStatus: 'access_checked',
        });
        next = { ...next, ...registration.set };
        changed = true;
      }
      if (!changed) return verificationChanged
        ? { set: { [REPOSITORY_VERIFICATION]: next[REPOSITORY_VERIFICATION] }, result: true }
        : { result: true };
      return { set: {
        [DESTINATION_REGISTRY]: next[DESTINATION_REGISTRY],
        [DESTINATION_STATES]: next[DESTINATION_STATES],
        [REPOSITORY_VERIFICATION]: next[REPOSITORY_VERIFICATION],
        [CONFIGURATION_GENERATION]: generationValue(values[CONFIGURATION_GENERATION]) + 1,
      }, result: true };
    });
  }

  async promotePendingGitHubAppAuthorization(configs, expected) {
    return this.backend.mutateMany([
      AUTH, AUTH_GENERATION, PENDING_AUTH, PENDING_AUTH_GENERATION, CONFIGURATION_GENERATION,
      'dataVersion', DESTINATION_REGISTRY, DESTINATION_STATES, ACTIVE_TIMER, REPOSITORY_VERIFICATION,
    ], values => {
      const pendingGeneration = generationValue(values[PENDING_AUTH_GENERATION]);
      const currentGeneration = generationValue(values[AUTH_GENERATION]);
      const configurationGeneration = generationValue(values[CONFIGURATION_GENERATION]);
      const pending = values[PENDING_AUTH], current = values[AUTH];
      if (pending?.mode !== 'github_app' || pendingGeneration !== expected.pendingAuthGeneration
          || currentGeneration !== expected.currentAuthGeneration
          || configurationGeneration !== expected.configurationGeneration
          || pending.githubUserId !== expected.githubUserId
          || (current?.githubUserId && current.githubUserId !== expected.githubUserId)) return { result: false };
      if (values[ACTIVE_TIMER]
          || Object.values(values[DESTINATION_STATES]?.entries ?? {}).some(state => (state?.pendingWrites ?? []).length)) {
        return { result: false };
      }
      const registry = values[DESTINATION_REGISTRY];
      if (JSON.stringify(registry) !== JSON.stringify(expected.registry)) return { result: false };
      const suppliedIds = new Set(configs.map(destinationIdForConfiguration));
      if (Object.keys(registry?.destinations ?? {}).some(id => !suppliedIds.has(id))) return { result: false };
      let next = { ...values }, deleteKeys = new Set();
      for (const config of configs) {
        const destinationId = destinationIdForConfiguration(config);
        const existingVerification = next[REPOSITORY_VERIFICATION]?.[destinationId];
        const registration = this.destinationRegistration(next, config, { user: config.storageLogin });
        next = { ...next, ...registration.set };
        next[REPOSITORY_VERIFICATION] = {
          ...next[REPOSITORY_VERIFICATION],
          [destinationId]: existingVerification?.status === 'write_verified'
            ? structuredClone(existingVerification)
            : { ...structuredClone(existingVerification ?? {}), status: 'access_checked', lastVerifiedAt: expected.verifiedAt },
        };
        for (const key of registration.delete) deleteKeys.add(key);
      }
      const nextAuthGeneration = currentGeneration + 1;
      return {
        set: {
          [AUTH]: { ...pending, generation: nextAuthGeneration },
          [AUTH_GENERATION]: nextAuthGeneration,
          [PENDING_AUTH_GENERATION]: pendingGeneration + 1,
          [CONFIGURATION_GENERATION]: configurationGeneration + 1,
          [DESTINATION_REGISTRY]: next[DESTINATION_REGISTRY],
          [DESTINATION_STATES]: next[DESTINATION_STATES],
          [REPOSITORY_VERIFICATION]: next[REPOSITORY_VERIFICATION],
        },
        delete: [...deleteKeys, PENDING_AUTH, 'token'],
        result: true,
      };
    });
  }

  async repairGitHubAppRepositoryCoordinates(config, expectedAuthGeneration, expectedConfigurationGeneration) {
    return this.backend.mutateMany([
      AUTH, AUTH_GENERATION, PENDING_AUTH, CONFIGURATION_GENERATION, 'dataVersion', 'config', DESTINATION_REGISTRY,
    ], values => {
      if (values[AUTH]?.mode !== 'github_app' || values[PENDING_AUTH]
          || generationValue(values[AUTH_GENERATION]) !== expectedAuthGeneration
          || generationValue(values[CONFIGURATION_GENERATION]) !== expectedConfigurationGeneration) return { result: false };
      const registry = values[DESTINATION_REGISTRY];
      const id = registry?.defaultDestinationId;
      const existing = values.dataVersion === 5 ? registry?.destinations?.[id] : values.config;
      if (!existing?.repoId || existing.repoId !== config.repoId) return { result: false };
      // Only coordinates may change. Keep the stable destination, all identity
      // and setup fields, routing, verification, caches and accepted work intact.
      const patch = { owner: config.owner, repo: config.repo, installationId: config.installationId, branch: config.branch };
      if (Object.keys(patch).every(key => existing[key] === patch[key])) return { result: true };
      const repaired = { ...existing, ...patch };
      return { set: {
        ...(values.dataVersion === 5
          ? { [DESTINATION_REGISTRY]: { ...registry, destinations: { ...registry.destinations, [id]: repaired } } }
          : { config: repaired }),
        [CONFIGURATION_GENERATION]: expectedConfigurationGeneration + 1,
      }, result: true };
    });
  }

  async saveGitHubAppConfiguration(config, statePatch, expectedAuthGeneration) {
    return this.backend.mutateMany([
      AUTH, AUTH_GENERATION, CONFIGURATION_GENERATION, 'dataVersion', DESTINATION_REGISTRY,
      DESTINATION_STATES, ACTIVE_TIMER, REPOSITORY_VERIFICATION, ...LEGACY_TRACKING_KEYS, ...ONBOARDING_KEYS,
    ], values => {
      const authGeneration = Number.isSafeInteger(values[AUTH_GENERATION]) && values[AUTH_GENERATION] >= 0 ? values[AUTH_GENERATION] : 0;
      if (authGeneration !== expectedAuthGeneration || values[AUTH]?.mode !== 'github_app') return { result: false };
      const generation = generationValue(values[CONFIGURATION_GENERATION]) + 1;
      if (values.dataVersion === 5) {
        const registration = this.destinationRegistration(values, config, statePatch);
        return {
          set: { ...registration.set, [CONFIGURATION_GENERATION]: generation },
          delete: registration.delete,
          result: generation,
        };
      }
      return { set: { config, ...statePatch, summaryCache: null, [CONFIGURATION_GENERATION]: generation }, result: generation };
    });
  }

  async commitPendingGitHubAppConfiguration(config, statePatch, expectedPendingGeneration) {
    return this.backend.mutateMany([
      PENDING_AUTH, PENDING_AUTH_GENERATION, AUTH, AUTH_GENERATION, CONFIGURATION_GENERATION,
      'dataVersion', DESTINATION_REGISTRY, DESTINATION_STATES, ACTIVE_TIMER, REPOSITORY_VERIFICATION,
      ...LEGACY_TRACKING_KEYS, ...ONBOARDING_KEYS,
    ], values => {
      const pendingGeneration = Number.isSafeInteger(values[PENDING_AUTH_GENERATION]) && values[PENDING_AUTH_GENERATION] >= 0 ? values[PENDING_AUTH_GENERATION] : 0;
      if (pendingGeneration !== expectedPendingGeneration || values[PENDING_AUTH]?.mode !== 'github_app') return { result: false };
      const acceptedWork = values.dataVersion === 5
        ? values[ACTIVE_TIMER] !== null && values[ACTIVE_TIMER] !== undefined
          || Object.values(values[DESTINATION_STATES]?.entries ?? {}).some(state => (state?.pendingWrites ?? []).length > 0)
        : values.activeCache !== null && values.activeCache !== undefined || (values.pendingWrites ?? []).length > 0;
      if (acceptedWork) return { result: false };
      const authGeneration = generationValue(values[AUTH_GENERATION]) + 1;
      const consumedPendingGeneration = pendingGeneration + 1;
      const configurationGeneration = generationValue(values[CONFIGURATION_GENERATION]) + 1;
      const commonSet = {
        [AUTH]: { ...values[PENDING_AUTH], generation: authGeneration }, [AUTH_GENERATION]: authGeneration,
        [PENDING_AUTH_GENERATION]: consumedPendingGeneration, [CONFIGURATION_GENERATION]: configurationGeneration,
      };
      if (values.dataVersion === 5) {
        const registration = this.destinationRegistration(values, config, statePatch);
        return {
          set: { ...registration.set, ...commonSet },
          delete: [...registration.delete, PENDING_AUTH, 'token'],
          result: configurationGeneration,
        };
      }
      return {
        set: { ...commonSet, config, ...statePatch, summaryCache: null },
        delete: [PENDING_AUTH, 'token'], result: configurationGeneration,
      };
    });
  }

  async removeCurrentAuthentication(expectedAuthGeneration) {
    return this.backend.mutateMany([AUTH_GENERATION, PENDING_AUTH_GENERATION, CONFIGURATION_GENERATION], values => {
      const authGeneration = Number.isSafeInteger(values[AUTH_GENERATION]) && values[AUTH_GENERATION] >= 0 ? values[AUTH_GENERATION] : 0;
      if (authGeneration !== expectedAuthGeneration) return { result: false };
      const nextAuthGeneration = authGeneration + 1;
      const nextPendingGeneration = (Number.isSafeInteger(values[PENDING_AUTH_GENERATION]) && values[PENDING_AUTH_GENERATION] >= 0 ? values[PENDING_AUTH_GENERATION] : 0) + 1;
      const nextConfigurationGeneration = (Number.isSafeInteger(values[CONFIGURATION_GENERATION]) && values[CONFIGURATION_GENERATION] >= 0 ? values[CONFIGURATION_GENERATION] : 0) + 1;
      return {
        set: { [AUTH_GENERATION]: nextAuthGeneration, [PENDING_AUTH_GENERATION]: nextPendingGeneration, [CONFIGURATION_GENERATION]: nextConfigurationGeneration },
        delete: [AUTH, 'token', PENDING_AUTH, DEVICE_ATTEMPT], result: true,
      };
    });
  }

  async clearConfig() {
    await this.backend.mutateMany(ALL_KEYS, values => {
      const next = key => (Number.isSafeInteger(values[key]) && values[key] >= 0 ? values[key] : 0) + 1;
      return {
        set: {
          [AUTH_GENERATION]: next(AUTH_GENERATION),
          [PENDING_AUTH_GENERATION]: next(PENDING_AUTH_GENERATION),
          [CONFIGURATION_GENERATION]: next(CONFIGURATION_GENERATION),
        },
        delete: ALL_KEYS.filter(key => ![AUTH_GENERATION, PENDING_AUTH_GENERATION, CONFIGURATION_GENERATION].includes(key)),
        result: true,
      };
    });
  }
}
