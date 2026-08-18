const DEFAULT_STATE = Object.freeze({ activeCache: null, recentCache: [], pendingWrites: [], user: null });
const ALL_KEYS = ['config', 'token', ...Object.keys(DEFAULT_STATE)];

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

export class ChromeStore {
  constructor(backend = new IndexedDbBackend()) { this.backend = backend; }

  async getState() {
    const stored = await this.backend.getMany(Object.keys(DEFAULT_STATE));
    return { ...structuredClone(DEFAULT_STATE), ...stored };
  }

  async patchState(patch) { await this.backend.setMany(patch); }

  async getConfig() {
    const { config = null, token = '' } = await this.backend.getMany(['config', 'token']);
    return { config, token };
  }

  async saveConfig(config, token) { await this.backend.setMany({ config, token }); }
  async saveConfiguration(config, token, statePatch) { await this.backend.setMany({ config, token, ...statePatch }); }

  async clearConfig() { await this.backend.deleteMany(ALL_KEYS); }
}
