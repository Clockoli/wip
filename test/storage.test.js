import test from 'node:test';
import assert from 'node:assert/strict';
import { ChromeStore } from '../src/storage/chrome-store.js';

class MemoryBackend {
  constructor() { this.values = new Map(); }
  async getMany(keys) { return Object.fromEntries(keys.filter(key => this.values.has(key)).map(key => [key, structuredClone(this.values.get(key))])); }
  async setMany(values) { for (const [key, value] of Object.entries(values)) this.values.set(key, structuredClone(value)); }
  async setManyAndIncrement(values, counterKey) {
    const next = (this.values.get(counterKey) ?? 0) + 1;
    await this.setMany({ ...values, [counterKey]: next });
    return next;
  }
  async setManyIfEqual(compareKey, expected, values) {
    if ((this.values.get(compareKey) ?? 0) !== expected) return false;
    await this.setMany(values);
    return true;
  }
  async deleteMany(keys) { for (const key of keys) this.values.delete(key); }
}

test('extension store persists config, token, caches, and queue through an isolated backend', async () => {
  const backend = new MemoryBackend();
  const store = new ChromeStore(backend);
  await store.saveConfig({ owner: 'acme', repo: 'time-data' }, 'secret-token');
  await store.patchState({ user: 'alice', pendingWrites: [{ id: 'one' }] });
  assert.deepEqual(await store.getConfig(), { config: { owner: 'acme', repo: 'time-data' }, token: 'secret-token' });
  assert.deepEqual(await store.getState(), { activeCache: null, recentCache: [], pendingWrites: [{ id: 'one' }], user: 'alice', dataVersion: 0 });
  await store.saveConfiguration({ owner: 'next', repo: 'time-data' }, 'next-token', { user: 'bob', activeCache: null, recentCache: [] });
  assert.deepEqual(await store.getConfig(), { config: { owner: 'next', repo: 'time-data' }, token: 'next-token' });
  assert.equal((await store.getState()).user, 'bob');
  await store.clearConfig();
  assert.deepEqual(await store.getConfig(), { config: null, token: '' });
  assert.deepEqual(await store.getState(), { activeCache: null, recentCache: [], pendingWrites: [], user: null, dataVersion: 0 });
});


test('new data format clears only stale caches and pending operations', async () => {
  const backend = new MemoryBackend(), store = new ChromeStore(backend);
  await store.saveConfig({ owner: 'acme', repo: 'time-data' }, 'secret-token');
  await store.patchState({ user: 'alice', activeCache: { old: true }, recentCache: [{ old: true }], pendingWrites: [{ old: true }], dataVersion: 1 });
  const state = await store.ensureDataVersion(2);
  assert.deepEqual(state, { user: 'alice', activeCache: null, recentCache: [], pendingWrites: [], dataVersion: 2 });
  assert.deepEqual(await store.getConfig(), { config: { owner: 'acme', repo: 'time-data' }, token: 'secret-token' });
});


test('report cache is repository-scoped, persisted separately, and cleared with configuration', async () => {
  const backend = new MemoryBackend(), store = new ChromeStore(backend);
  const cache = { version: 1, repositoryKey: 'acme/time@main', etag: '"one"', files: [], blobs: {} };
  await store.saveReportCache(cache);
  assert.deepEqual(await store.getReportCache('acme/time@main'), cache);
  assert.equal(await store.getReportCache('other/time@main'), null);
  await store.clearConfig();
  assert.equal(await store.getReportCache('acme/time@main'), null);
});

test('v2 pending completions migrate to monthly paths without losing active state', async () => {
  const backend = new MemoryBackend(), store = new ChromeStore(backend);
  const activeCache = { startedAt: '2026-08-18T08:00:00Z' };
  await store.patchState({ activeCache, recentCache: [{ old: true }], pendingWrites: [{
    operation: 'completeTimer', dailyPath: 'times/2026-08-18/alice.txt', id: 'one', stage: 'appendDaily',
  }], dataVersion: 2 });
  const state = await store.ensureDataVersion(3);
  assert.deepEqual(state.activeCache, activeCache);
  assert.deepEqual(state.recentCache, []);
  assert.deepEqual(state.pendingWrites, [{ operation: 'completeTimer', monthlyPath: 'times/2026-08/alice.txt', id: 'one', stage: 'appendMonthly' }]);
});

test('v2 migration refuses to silently discard an unrecognized pending completion', async () => {
  const backend = new MemoryBackend(), store = new ChromeStore(backend);
  await store.patchState({ pendingWrites: [{ operation: 'completeTimer', dailyPath: '../unsafe.txt' }], dataVersion: 2 });
  await assert.rejects(() => store.ensureDataVersion(3), /Cannot migrate a pending completion/);
  assert.equal((await store.getState()).dataVersion, 2);
});

test('task metadata cache is repository-scoped and cleared with configuration', async () => {
  const backend = new MemoryBackend(), store = new ChromeStore(backend);
  const cache = { repositoryKey: 'acme/time@main', fetchedAt: 123, entries: { 'https://github.com/acme/app/issues/1': { title: 'One', status: 'OPEN' } } };
  await store.saveTaskMetadataCache(cache);
  assert.deepEqual(await store.getTaskMetadataCache('acme/time@main'), cache);
  assert.equal(await store.getTaskMetadataCache('other/time@main'), null);
  await store.clearConfig();
  assert.equal(await store.getTaskMetadataCache('acme/time@main'), null);
});

test('configuration generation and metadata invalidation commit atomically', async () => {
  const backend = new MemoryBackend(), store = new ChromeStore(backend);
  await store.saveTaskMetadataCache({ repositoryKey: 'old-scope', entries: { private: true } });
  const first = await store.saveConfiguration({ owner: 'acme', repo: 'time' }, 'token-one', { taskMetadataCache: null });
  assert.equal(first, 1);
  assert.equal(await store.getConfigurationGeneration(), 1);
  assert.equal(await store.getTaskMetadataCache('old-scope'), null);
  const second = await store.saveConfiguration({ owner: 'acme', repo: 'time' }, 'token-two', { taskMetadataCache: null });
  assert.equal(second, 2);
  assert.deepEqual(await store.getConfigurationSnapshot(), {
    config: { owner: 'acme', repo: 'time' }, token: 'token-two', generation: 2,
  });
});

test('stale task loads cannot repopulate metadata after a configuration generation change', async () => {
  const backend = new MemoryBackend(), store = new ChromeStore(backend);
  await store.saveConfiguration({ owner: 'acme', repo: 'time' }, 'token-one', { taskMetadataCache: null });
  assert.equal(await store.saveTaskMetadataCache({ repositoryKey: 'scope:g1', entries: {} }, 1), true);
  await store.saveConfiguration({ owner: 'acme', repo: 'time' }, 'token-two', { taskMetadataCache: null });
  assert.equal(await store.saveTaskMetadataCache({ repositoryKey: 'scope:g1', entries: { leaked: true } }, 1), false);
  assert.equal(await store.getTaskMetadataCache('scope:g1'), null);
  assert.equal(await store.patchStateIfGeneration({ user: 'stale-user' }, 1), false);
  assert.equal((await store.getState()).user, null);
});
