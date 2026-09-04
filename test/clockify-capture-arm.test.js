import test from 'node:test';
import assert from 'node:assert/strict';
import { ARM_TTL_MS, createClockifyCaptureArmService } from '../src/services/clockify-capture-arm.js';

function sessionStorage() {
  const values = new Map();
  return {
    async get(key) { return values.get(key); },
    async set(key, value) { values.set(key, value); },
    async remove(key) { values.delete(key); },
  };
}

test('Clockify capture arm is tab-scoped, survives a service-worker restart, and expires fail-closed', async () => {
  let time = 1_000;
  const storage = sessionStorage();
  const first = createClockifyCaptureArmService({ storageSession: storage, now: () => time });
  await first.arm(7);
  assert.equal(await first.isArmed(7), true);
  assert.equal(await first.isArmed(8), false);

  const restarted = createClockifyCaptureArmService({ storageSession: storage, now: () => time });
  assert.equal(await restarted.isArmed(7), true);
  time += ARM_TTL_MS;
  assert.equal(await restarted.isArmed(7), false);
  assert.equal(await restarted.isArmed(7), false, 'expired state is removed');
});

test('Clockify capture arm validates its storage boundary and tab identity', async () => {
  const storage = sessionStorage();
  assert.throws(() => createClockifyCaptureArmService({ storageSession: storage, ttlMs: ARM_TTL_MS + 1 }), /TTL/i);
  const service = createClockifyCaptureArmService({ storageSession: storage });
  await assert.rejects(() => service.arm(-1), /tab/i);
  await assert.rejects(() => service.isArmed(1.5), /tab/i);
});
