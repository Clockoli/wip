const DEFAULT_STATE = Object.freeze({ activeCache: null, recentCache: [], pendingWrites: [], user: null, dataVersion: 0 });
const ALL_KEYS = ['config', 'token', 'reportCache', 'taskMetadataCache', ...Object.keys(DEFAULT_STATE)];

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
  constructor(factory = indexedDB, databaseName = 'github-private-time-tracker') {
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
}

function migrateV2PendingWrites(pendingWrites) {
  return (pendingWrites ?? []).map(operation => {
    if (operation.operation !== 'completeTimer') return operation;
    if (operation.monthlyPath) return operation;
    const match = typeof operation.dailyPath === 'string'
      ? operation.dailyPath.match(/^times\/(\d{4}-\d{2})-\d{2}\/([A-Za-z0-9-]+)\.txt$/)
      : null;
    if (!match) throw new Error('Cannot migrate a pending completion to monthly storage. Resolve it with the previous extension version first.');
    const { dailyPath, ...rest } = operation;
    return {
      ...rest,
      stage: rest.stage === 'appendDaily' ? 'appendMonthly' : rest.stage,
      monthlyPath: `times/${match[1]}/${match[2]}.txt`,
    };
  });
}

export class ChromeStore {
  constructor(backend = new IndexedDbBackend()) { this.backend = backend; }

  async getState() {
    const stored = await this.backend.getMany(Object.keys(DEFAULT_STATE));
    return { ...structuredClone(DEFAULT_STATE), ...stored };
  }

  async patchState(patch) { await this.backend.setMany(patch); }

  async ensureDataVersion(version) {
    const state = await this.getState();
    if (state.dataVersion === version) return state;
    const reset = state.dataVersion === 2 && version === 3
      ? { activeCache: state.activeCache, recentCache: [], pendingWrites: migrateV2PendingWrites(state.pendingWrites), dataVersion: version }
      : { activeCache: null, recentCache: [], pendingWrites: [], dataVersion: version };
    await this.patchState(reset);
    return { ...state, ...reset };
  }

  async getConfig() {
    const { config = null, token = '' } = await this.backend.getMany(['config', 'token']);
    return { config, token };
  }

  async saveConfig(config, token) { await this.backend.setMany({ config, token }); }

  async getReportCache(repositoryKey) {
    const { reportCache = null } = await this.backend.getMany(['reportCache']);
    return reportCache?.repositoryKey === repositoryKey ? reportCache : null;
  }

  async saveReportCache(reportCache) { await this.backend.setMany({ reportCache }); }

  async getTaskMetadataCache(repositoryKey) {
    const { taskMetadataCache = null } = await this.backend.getMany(['taskMetadataCache']);
    return taskMetadataCache?.repositoryKey === repositoryKey ? taskMetadataCache : null;
  }

  async saveTaskMetadataCache(taskMetadataCache) { await this.backend.setMany({ taskMetadataCache }); }
  async saveConfiguration(config, token, statePatch) { await this.backend.setMany({ config, token, ...statePatch }); }

  async clearConfig() { await this.backend.deleteMany(ALL_KEYS); }
}
