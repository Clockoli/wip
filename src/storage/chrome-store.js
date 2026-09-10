import { normalizeReportingUtc, invoicingSettings, normalizeBillingSettings, normalizeOtherProjectName, normalizeOtherProjectClient, normalizeProjects, projectClientPreferences, parseSettingsImport, settingsExportText } from '../domain/local-settings.js';
const DEFAULT_STATE = Object.freeze({ activeCache: null, recentCache: [], summaryCache: null, pendingWrites: [], user: null, dataVersion: 0 });
const CONFIGURATION_GENERATION = 'configurationGeneration';
const AUTH = 'auth';
const AUTH_GENERATION = 'authGeneration';
const DEVICE_ATTEMPT = 'deviceAttempt';
const PENDING_AUTH = 'pendingAuth';
const PENDING_AUTH_GENERATION = 'pendingAuthGeneration';
const ONBOARDING_KEYS = ['onboardingLastVerifiedAt', 'onboardingVerificationStatus'];
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
const ALL_KEYS = ['config', 'token', AUTH, AUTH_GENERATION, PENDING_AUTH, PENDING_AUTH_GENERATION, DEVICE_ATTEMPT, 'reportCache', 'taskMetadataCache', EXCHANGE_RATE_CACHE, ...ONBOARDING_KEYS, ...SETTINGS_KEYS, CONFIGURATION_GENERATION, ...Object.keys(DEFAULT_STATE)];

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

  async getState() {
    const stored = await this.backend.getMany(Object.keys(DEFAULT_STATE));
    return { ...structuredClone(DEFAULT_STATE), ...stored };
  }

  async patchState(patch) { await this.backend.setMany(patch); }

  async mutateState(mutate) {
    return this.backend.mutateMany(Object.keys(DEFAULT_STATE), values => {
      const state = { ...structuredClone(DEFAULT_STATE), ...values };
      const patch = mutate(structuredClone(state));
      return patch ? { set: patch, result: { ...state, ...patch } } : { result: state };
    });
  }

  async patchStateIfGeneration(patch, expectedGeneration) {
    return this.backend.setManyIfEqual(CONFIGURATION_GENERATION, expectedGeneration, patch);
  }

  async ensureDataVersion(version) {
    return this.backend.mutateMany(Object.keys(DEFAULT_STATE), values => {
      const state = { ...structuredClone(DEFAULT_STATE), ...values };
      if (state.dataVersion === version) return { result: state };
      if (state.dataVersion > version) {
        throw storageFormatError(`Clockoli local data version ${state.dataVersion} is newer than supported version ${version}.`);
      }
      const reset = { activeCache: null, recentCache: [], summaryCache: null, pendingWrites: [], dataVersion: version };
      return { set: reset, result: { ...state, ...reset } };
    });
  }

  async getOnboardingVerification() {
    const values = await this.backend.getMany(ONBOARDING_KEYS);
    return {
      lastVerifiedAt: values.onboardingLastVerifiedAt ?? null,
      status: values.onboardingVerificationStatus ?? null,
    };
  }

  async getConfig() {
    const { config = null, token = '' } = await this.backend.getMany(['config', 'token']);
    return { config, token };
  }

  async getConfigurationSnapshot() {
    const { config = null, token = '', configurationGeneration = 0 } = await this.backend.getMany(['config', 'token', CONFIGURATION_GENERATION]);
    const generation = Number.isSafeInteger(configurationGeneration) && configurationGeneration >= 0 ? configurationGeneration : 0;
    return { config, token, generation };
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
      ['config', CONFIGURATION_GENERATION, 'activeCache', 'pendingWrites', 'recentCache', 'summaryCache', 'reportCache', 'taskMetadataCache'],
      values => {
        const config = values.config, generation = generationValue(values[CONFIGURATION_GENERATION]);
        if (generation !== expectedGeneration || !config
            || config.owner !== expected.owner || config.repo !== expected.repo || config.branch !== expected.branch
            || values.activeCache || (values.pendingWrites || []).length) return { result: false };
        return {
          set: {
            config: { ...config, ...structuredClone(patch) },
            [CONFIGURATION_GENERATION]: generation + 1,
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
    return taskMetadataCache?.repositoryKey === repositoryKey ? taskMetadataCache : null;
  }

  async saveTaskMetadataCache(taskMetadataCache, expectedGeneration = null) {
    if (expectedGeneration === null) { await this.backend.setMany({ taskMetadataCache }); return true; }
    return this.backend.setManyIfEqual(CONFIGURATION_GENERATION, expectedGeneration, { taskMetadataCache });
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
    const values = await this.backend.getMany(['config', ...SETTINGS_KEYS]);
    const billing = normalizeBillingSettings(values[BILLING_SETTINGS] || {});
    const revision = Number.isSafeInteger(values[SETTINGS_REVISION]) && values[SETTINGS_REVISION] >= 0 ? values[SETTINGS_REVISION] : 0;
    const exportedRevision = Number.isSafeInteger(values[SETTINGS_EXPORTED_REVISION]) && values[SETTINGS_EXPORTED_REVISION] >= 0 ? values[SETTINGS_EXPORTED_REVISION] : 0;
    const recentDays = Number(values.config?.recentDays ?? values[LOCAL_RECENT_DAYS] ?? 7);
    const otherProjectName = normalizeOtherProjectName(values[OTHER_PROJECT_NAME]);
    const { projects, otherProjectClient } = projectClientPreferences({ projects: values[PROJECTS] || [], billing: values[BILLING_SETTINGS] || {}, otherProjectName, otherProjectClient: values[OTHER_PROJECT_CLIENT] });
    const showQueueDiagnostics = values[SHOW_QUEUE_DIAGNOSTICS] === true;
    return { recentDays, projects, otherProjectName, otherProjectClient, reportingUtc: normalizeReportingUtc(values[REPORTING_UTC]), showQueueDiagnostics, ...billing, invoicing: invoicingSettings(billing), revision, exportedRevision, exportRecommended: revision > exportedRevision };
  }

  async saveBillingSettings(value) {
    const billing = normalizeBillingSettings(value);
    return this.backend.mutateMany([BILLING_SETTINGS, PROJECTS, OTHER_PROJECT_NAME, OTHER_PROJECT_CLIENT, SETTINGS_REVISION], values => {
      const stored = invoicingSettings(values[BILLING_SETTINGS] || {}).nextNumber;
      if (invoicingSettings(billing).nextNumber < stored) throw new Error(`Next invoice number cannot go below ${stored}; invoice ${stored - 1} has already been issued.`);
      const revision = (Number.isSafeInteger(values[SETTINGS_REVISION]) && values[SETTINGS_REVISION] >= 0 ? values[SETTINGS_REVISION] : 0) + 1;
      return { set: { ...preservedProjectClients(values), [BILLING_SETTINGS]: billing, [SETTINGS_REVISION]: revision }, result: { ...billing, revision, exportRecommended: true } };
    });
  }

  async reserveInvoiceNumber() {
    return this.backend.mutateMany([BILLING_SETTINGS, PROJECTS, OTHER_PROJECT_NAME, OTHER_PROJECT_CLIENT, SETTINGS_REVISION], values => {
      const billing = normalizeBillingSettings(values[BILLING_SETTINGS] || {}), invoicing = invoicingSettings(billing);
      const sequence = invoicing.nextNumber, numberFormat = invoicing.numberFormat;
      if (sequence >= 1e9) throw new Error('Invoice number sequence is exhausted');
      const revision = (Number.isSafeInteger(values[SETTINGS_REVISION]) && values[SETTINGS_REVISION] >= 0 ? values[SETTINGS_REVISION] : 0) + 1;
      return { set: { ...preservedProjectClients(values), [BILLING_SETTINGS]: { ...billing, invoicing: { ...invoicing, nextNumber: sequence + 1 } }, [SETTINGS_REVISION]: revision }, result: { sequence, numberFormat, revision, exportRecommended: true } };
    });
  }

  async updateDisplayPreferences(preferences) {
    const { recentDays, projects = [], otherProjectName, otherProjectClient, reportingUtc, showQueueDiagnostics = false } = preferences;
    if (reportingUtc !== undefined) normalizeReportingUtc(reportingUtc);
    if (Object.keys(preferences).length === 1 && reportingUtc !== undefined) {
      return this.backend.mutateMany(['config', REPORTING_UTC, CONFIGURATION_GENERATION, SETTINGS_REVISION], values => {
        if (!values.config) throw new Error('Connect a repository before saving display settings');
        const generation = generationValue(values[CONFIGURATION_GENERATION]) + 1;
        const revision = generationValue(values[SETTINGS_REVISION]) + 1;
        return { set: { [REPORTING_UTC]: reportingUtc, [CONFIGURATION_GENERATION]: generation, [SETTINGS_REVISION]: revision }, result: generation };
      });
    }
    const normalized = Number(recentDays);
    const normalizedProjects = normalizeProjects(projects);
    const normalizedOtherProjectName = normalizeOtherProjectName(otherProjectName);
    const normalizedOtherProjectClient = normalizeOtherProjectClient(otherProjectClient);
    if (normalizedProjects.some(project => project.name.toLowerCase() === normalizedOtherProjectName.toLowerCase())) throw new Error('Main project name must differ from named projects');
    if (!Number.isInteger(normalized) || normalized < 1 || normalized > 31) {
      throw new Error('Recent entries shown in the main panel must be between 1 and 31 days');
    }
    return this.backend.mutateMany(['config', PROJECTS, OTHER_PROJECT_NAME, OTHER_PROJECT_CLIENT, REPORTING_UTC, SHOW_QUEUE_DIAGNOSTICS, CONFIGURATION_GENERATION, SETTINGS_REVISION], values => {
      if (!values.config) throw new Error('Connect a repository before saving display settings');
      const generation = (Number.isSafeInteger(values[CONFIGURATION_GENERATION]) && values[CONFIGURATION_GENERATION] >= 0
        ? values[CONFIGURATION_GENERATION] : 0) + 1;
      const revision = (Number.isSafeInteger(values[SETTINGS_REVISION]) && values[SETTINGS_REVISION] >= 0 ? values[SETTINGS_REVISION] : 0) + 1;
      return {
        set: { config: { ...values.config, recentDays: normalized }, [LOCAL_RECENT_DAYS]: normalized, [PROJECTS]: normalizedProjects, [OTHER_PROJECT_NAME]: normalizedOtherProjectName, [OTHER_PROJECT_CLIENT]: normalizedOtherProjectClient, [SHOW_QUEUE_DIAGNOSTICS]: showQueueDiagnostics === true, [REPORTING_UTC]: normalizeReportingUtc(reportingUtc ?? values[REPORTING_UTC]), [CONFIGURATION_GENERATION]: generation, [SETTINGS_REVISION]: revision },
        result: generation,
      };
    });
  }

  async importSettings(text) {
    const imported = parseSettingsImport(text);
    return this.backend.mutateMany(['config', CONFIGURATION_GENERATION, ...SETTINGS_KEYS], values => {
      const generation = (Number.isSafeInteger(values[CONFIGURATION_GENERATION]) && values[CONFIGURATION_GENERATION] >= 0 ? values[CONFIGURATION_GENERATION] : 0) + 1;
      const revision = (Number.isSafeInteger(values[SETTINGS_REVISION]) && values[SETTINGS_REVISION] >= 0 ? values[SETTINGS_REVISION] : 0) + 1;
      // Restoring a backup must never make the user reissue an invoice number, so the counter only ever moves forward.
      const storedNextNumber = invoicingSettings(values[BILLING_SETTINGS] || {}).nextNumber;
      const billing = { ...imported.billing, invoicing: { ...invoicingSettings(imported.billing), nextNumber: Math.max(invoicingSettings(imported.billing).nextNumber, storedNextNumber) } };
      const set = {
        [BILLING_SETTINGS]: billing, [LOCAL_RECENT_DAYS]: imported.recentDays, [PROJECTS]: imported.projects, [OTHER_PROJECT_NAME]: imported.otherProjectName, [OTHER_PROJECT_CLIENT]: imported.otherProjectClient, [SHOW_QUEUE_DIAGNOSTICS]: imported.showQueueDiagnostics, [REPORTING_UTC]: imported.reportingUtc,
        [SETTINGS_REVISION]: revision, [SETTINGS_EXPORTED_REVISION]: revision, [CONFIGURATION_GENERATION]: generation,
      };
      if (values.config) set.config = { ...values.config, recentDays: imported.recentDays };
      return { set, result: { ...imported, billing, revision, exportRecommended: false } };
    });
  }

  async exportSettings() {
    const values = await this.backend.getMany(['config', BILLING_SETTINGS, LOCAL_RECENT_DAYS, PROJECTS, OTHER_PROJECT_NAME, OTHER_PROJECT_CLIENT, REPORTING_UTC, SHOW_QUEUE_DIAGNOSTICS, SETTINGS_REVISION]);
    const config = values.config ? { ...values.config } : { recentDays: values[LOCAL_RECENT_DAYS] ?? 7 };
    return {
      text: settingsExportText({ config, billing: values[BILLING_SETTINGS] || {}, projects: values[PROJECTS] || [], otherProjectName: values[OTHER_PROJECT_NAME], otherProjectClient: values[OTHER_PROJECT_CLIENT], showQueueDiagnostics: values[SHOW_QUEUE_DIAGNOSTICS], reportingUtc: values[REPORTING_UTC] }),
      revision: Number.isSafeInteger(values[SETTINGS_REVISION]) && values[SETTINGS_REVISION] >= 0 ? values[SETTINGS_REVISION] : 0,
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
    return this.backend.mutateMany(['config', CONFIGURATION_GENERATION], values => {
      const generation = Number.isSafeInteger(values[CONFIGURATION_GENERATION]) && values[CONFIGURATION_GENERATION] >= 0
        ? values[CONFIGURATION_GENERATION] : 0;
      const config = values.config;
      if (generation !== expectedGeneration || !config || config.repoId
          || config.owner !== expected.owner || config.repo !== expected.repo
          || (config.branch || 'main') !== expected.branch) return { result: false };
      const nextGeneration = generation + 1;
      return {
        set: { config: { ...config, ...patch }, [CONFIGURATION_GENERATION]: nextGeneration },
        result: nextGeneration,
      };
    });
  }

  async savePatConfiguration(config, token, statePatch, identity = {}) {
    return this.backend.mutateMany([AUTH_GENERATION, PENDING_AUTH_GENERATION, CONFIGURATION_GENERATION], values => {
      const authGeneration = (Number.isSafeInteger(values[AUTH_GENERATION]) && values[AUTH_GENERATION] >= 0 ? values[AUTH_GENERATION] : 0) + 1;
      const pendingAuthGeneration = (Number.isSafeInteger(values[PENDING_AUTH_GENERATION]) && values[PENDING_AUTH_GENERATION] >= 0 ? values[PENDING_AUTH_GENERATION] : 0) + 1;
      const configurationGeneration = (Number.isSafeInteger(values[CONFIGURATION_GENERATION]) && values[CONFIGURATION_GENERATION] >= 0 ? values[CONFIGURATION_GENERATION] : 0) + 1;
      return {
        set: {
          [AUTH]: {
            mode: 'pat', accessToken: token,
            ...(Number.isSafeInteger(identity.id) && identity.id > 0 ? { githubUserId: identity.id } : {}),
            ...(identity.login ? { githubLogin: identity.login } : {}),
            generation: authGeneration,
          }, [AUTH_GENERATION]: authGeneration,
          [PENDING_AUTH_GENERATION]: pendingAuthGeneration,
          config: { ...config, authMode: 'pat' }, ...statePatch, summaryCache: null, [CONFIGURATION_GENERATION]: configurationGeneration,
        },
        delete: ['token', PENDING_AUTH, DEVICE_ATTEMPT, ...ONBOARDING_KEYS], result: configurationGeneration,
      };
    });
  }

  async saveGitHubAppConfiguration(config, statePatch, expectedAuthGeneration) {
    return this.backend.mutateMany([AUTH, AUTH_GENERATION, CONFIGURATION_GENERATION], values => {
      const authGeneration = Number.isSafeInteger(values[AUTH_GENERATION]) && values[AUTH_GENERATION] >= 0 ? values[AUTH_GENERATION] : 0;
      if (authGeneration !== expectedAuthGeneration || values[AUTH]?.mode !== 'github_app') return { result: false };
      const generation = (Number.isSafeInteger(values[CONFIGURATION_GENERATION]) && values[CONFIGURATION_GENERATION] >= 0 ? values[CONFIGURATION_GENERATION] : 0) + 1;
      return { set: { config, ...statePatch, summaryCache: null, [CONFIGURATION_GENERATION]: generation }, result: generation };
    });
  }

  async commitPendingGitHubAppConfiguration(config, statePatch, expectedPendingGeneration) {
    return this.backend.mutateMany([PENDING_AUTH, PENDING_AUTH_GENERATION, AUTH_GENERATION, CONFIGURATION_GENERATION], values => {
      const pendingGeneration = Number.isSafeInteger(values[PENDING_AUTH_GENERATION]) && values[PENDING_AUTH_GENERATION] >= 0 ? values[PENDING_AUTH_GENERATION] : 0;
      if (pendingGeneration !== expectedPendingGeneration || values[PENDING_AUTH]?.mode !== 'github_app') return { result: false };
      const authGeneration = (Number.isSafeInteger(values[AUTH_GENERATION]) && values[AUTH_GENERATION] >= 0 ? values[AUTH_GENERATION] : 0) + 1;
      const consumedPendingGeneration = pendingGeneration + 1;
      const configurationGeneration = (Number.isSafeInteger(values[CONFIGURATION_GENERATION]) && values[CONFIGURATION_GENERATION] >= 0 ? values[CONFIGURATION_GENERATION] : 0) + 1;
      return {
        set: {
          [AUTH]: { ...values[PENDING_AUTH], generation: authGeneration }, [AUTH_GENERATION]: authGeneration,
          [PENDING_AUTH_GENERATION]: consumedPendingGeneration,
          config, ...statePatch, summaryCache: null, [CONFIGURATION_GENERATION]: configurationGeneration,
        },
        delete: [PENDING_AUTH, 'token'],
        result: configurationGeneration,
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
