import test from 'node:test';
import assert from 'node:assert/strict';
import { setAddonEnabled } from '../src/addons/service.js';

const descriptor = { origins: ['https://app.clockify.me/*'] };

test('enablement requires a permission that was granted during the extension-page gesture', async () => {
  const calls = [];
  const store = { async setAddonEnabled(...args) { calls.push(['store', ...args]); } };
  await assert.rejects(() => setAddonEnabled({ store, permissions: { async contains(value) { calls.push(['contains', value]); return false; } } }, 'clockify-migration', true), /not granted/i);
  assert.deepEqual(calls, [['contains', descriptor]]);
});

test('enablement verifies granted access, while disabling persists before removing access', async () => {
  const calls = [];
  const store = { async setAddonEnabled(...args) { calls.push(['store', ...args]); } };
  const permissions = {
    async contains(value) { calls.push(['contains', value]); return true; },
    async remove(value) { calls.push(['remove', value]); return true; },
  };
  assert.deepEqual(await setAddonEnabled({ store, permissions }, 'clockify-migration', true), { id: 'clockify-migration', enabled: true });
  assert.deepEqual(await setAddonEnabled({ store, permissions }, 'clockify-migration', false), { id: 'clockify-migration', enabled: false });
  assert.deepEqual(calls, [
    ['contains', descriptor], ['store', 'clockify-migration', true],
    ['store', 'clockify-migration', false], ['remove', descriptor],
  ]);
});

test('storage failures compensate the permission operation before surfacing the error', async () => {
  const failedStore = { async setAddonEnabled() { throw new Error('storage failed'); } };
  const enabledCalls = [];
  await assert.rejects(() => setAddonEnabled({
    store: failedStore,
    permissions: {
      async contains(value) { enabledCalls.push(['contains', value]); return true; },
      async remove(value) { enabledCalls.push(['remove', value]); return true; },
    },
  }, 'clockify-migration', true), /storage failed/i);
  assert.deepEqual(enabledCalls, [['contains', descriptor], ['remove', descriptor]]);

  const disabledCalls = [];
  await assert.rejects(() => setAddonEnabled({
    store: failedStore,
    permissions: {
      async request(value) { disabledCalls.push(['request', value]); return true; },
      async remove(value) { disabledCalls.push(['remove', value]); return true; },
    },
  }, 'clockify-migration', false), /storage failed/i);
  assert.deepEqual(disabledCalls, []);
});
