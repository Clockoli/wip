import test from 'node:test';
import assert from 'node:assert/strict';
import { createClockifyCaptureProfileService, PROFILE_KEY } from '../src/services/clockify-capture-profile.js';

function storage() {
  const values = new Map();
  return {
    values,
    async get(key) { return structuredClone(values.get(key)); },
    async set(key, value) { values.set(key, structuredClone(value)); },
    async remove(key) { values.delete(key); },
  };
}

test('persists ordered aggregate-only CSV timing across service instances', async () => {
  const session = storage();
  let current = 10_010;
  const first = createClockifyCaptureProfileService({ storageSession: session, now: () => current });
  await first.start(10_000);
  await first.measure('csv_parse', 12.5, 3);
  current = 10_200;
  await first.measure('csv_parse', 7.5, 2);
  await first.measure('history_append', 3, 2);
  await first.measure('history_append', 1, 0);

  const restarted = createClockifyCaptureProfileService({ storageSession: session, now: () => current });
  assert.deepEqual(await restarted.read(), {
    startedAt: 10_000,
    expiresAt: 7_210_000,
    measures: [
      { name: 'csv_parse', elapsedMs: 20, samples: 2, count: 5 },
      { name: 'history_append', elapsedMs: 4, samples: 2, count: 2 },
    ],
  });
  assert.doesNotMatch(JSON.stringify(session.values.get(PROFILE_KEY)), /authorization|cookie|token|reportText|email/i);
});

test('rejects untrusted metrics and clears expired profiles', async () => {
  const session = storage();
  const service = createClockifyCaptureProfileService({ storageSession: session, now: () => 100_000 });
  await assert.rejects(() => service.start(0), /request window/i);
  await service.start(100_000);
  await assert.rejects(() => service.measure('not-a-measure', 1), /unknown measure/i);
  await assert.rejects(() => service.measure('csv_parse', -1), /elapsed time/i);

  session.values.set(PROFILE_KEY, { version: 2, startedAt: 0, expiresAt: 1, measures: [] });
  assert.equal(await service.read(), null);
  assert.equal(session.values.has(PROFILE_KEY), false);
});
