import test from 'node:test';
import assert from 'node:assert/strict';
import { ChromeStore } from '../src/storage/chrome-store.js';

class MemoryBackend {
  constructor() { this.values = new Map(); }
  async getMany(keys) { return Object.fromEntries(keys.filter(key => this.values.has(key)).map(key => [key, structuredClone(this.values.get(key))])); }
  async setMany(values) { for (const [key, value] of Object.entries(values)) this.values.set(key, structuredClone(value)); }
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
