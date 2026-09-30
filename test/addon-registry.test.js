import test from 'node:test';
import assert from 'node:assert/strict';
import { createAddonRegistry, getAddon, listAddons } from '../src/addons/registry.js';
import { validateAddonDescriptor } from '../src/addons/clockify/descriptor.js';

const clockifyDescriptor = {
  id: 'clockify-migration',
  version: 1,
  title: 'Clockify migration',
  description: 'Import completed time from a Clockify Detailed report opened in this browser.',
  requestedOrigins: ['https://app.clockify.me/*'],
  capabilities: ['import_completed_records'],
};

test('registry lists only deeply frozen packaged add-on descriptors', () => {
  const addons = listAddons();

  assert.equal(Object.isFrozen(addons), true);
  assert.equal(addons.length, 1);
  assert.deepEqual(addons[0], clockifyDescriptor);
  assert.equal(Object.isFrozen(addons[0]), true);
  assert.equal(Object.isFrozen(addons[0].requestedOrigins), true);
  assert.equal(Object.isFrozen(addons[0].capabilities), true);
  assert.throws(() => addons[0].requestedOrigins.push('https://example.test/*'), TypeError);
});

test('registry lookup accepts only exact known add-on IDs', () => {
  const descriptor = getAddon('clockify-migration');

  assert.deepEqual(descriptor, clockifyDescriptor);
  assert.equal(getAddon('Clockify-migration'), undefined);
  assert.equal(getAddon('clockify-migration '), undefined);
  assert.equal(getAddon('unknown'), undefined);
  assert.equal(getAddon(''), undefined);
  assert.equal(getAddon(null), undefined);
  assert.equal(getAddon({ id: 'clockify-migration' }), undefined);
});

test('descriptor validation rejects unsafe or malformed declarations', () => {
  assert.throws(
    () => validateAddonDescriptor({ ...clockifyDescriptor, provider: 'clockify' }),
    /unknown descriptor key/i,
  );
  assert.throws(
    () => validateAddonDescriptor({ ...clockifyDescriptor, capabilities: ['read_credentials'] }),
    /unsupported capability/i,
  );
  for (const requestedOrigins of [['https://*/*'], ['*://*/*'], ['<all_urls>'], ['clockify.me']]) {
    assert.throws(
      () => validateAddonDescriptor({ ...clockifyDescriptor, requestedOrigins }),
      /invalid requested origins/i,
    );
  }
  assert.throws(
    () => validateAddonDescriptor(Object.create(clockifyDescriptor)),
    /missing descriptor key/i,
  );
});

test('registry rejects duplicate add-on IDs', () => {
  assert.throws(
    () => createAddonRegistry([clockifyDescriptor, { ...clockifyDescriptor }]),
    /duplicate add-on ID/i,
  );
});
