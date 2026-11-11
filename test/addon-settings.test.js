import test from 'node:test';
import assert from 'node:assert/strict';
import { ChromeStore } from '../src/storage/chrome-store.js';

class MemoryBackend {
  constructor() { this.values = new Map(); }
  async getMany(keys) { return Object.fromEntries(keys.filter(key => this.values.has(key)).map(key => [key, structuredClone(this.values.get(key))])); }
  async setMany(values) { for (const [key, value] of Object.entries(values)) this.values.set(key, structuredClone(value)); }
  async mutateMany(keys, mutate) {
    const current = Object.fromEntries(keys.filter(key => this.values.has(key)).map(key => [key, structuredClone(this.values.get(key))]));
    const mutation = mutate(current);
    for (const key of mutation.delete || []) this.values.delete(key);
    await this.setMany(mutation.set || {});
    return mutation.result ?? true;
  }
}

test('add-on state has a fixed known map and defaults to disabled', async () => {
  const store = new ChromeStore(new MemoryBackend());
  assert.deepEqual(await store.getAddonSettings(), { 'clockify-migration': false });
  await store.setAddonEnabled('clockify-migration', true);
  assert.deepEqual(await store.getAddonSettings(), { 'clockify-migration': true });
  await assert.rejects(() => store.setAddonEnabled('unknown', true), /known add-on/i);
  await assert.rejects(() => store.setAddonEnabled('clockify-migration', 'true'), /Boolean/i);
});

test('add-on state persistence removes unknown and provider-data-shaped fields', async () => {
  const backend = new MemoryBackend();
  await backend.setMany({ addonEnabled: {
    'clockify-migration': false,
    unknown: true,
    token: 'secret',
    report: { raw: 'provider data' },
  } });
  const store = new ChromeStore(backend);

  await store.setAddonEnabled('clockify-migration', true);

  assert.deepEqual(backend.values.get('addonEnabled'), { 'clockify-migration': true });
});
