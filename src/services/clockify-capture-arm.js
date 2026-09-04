const ARM_TTL_MS = 2 * 60 * 1000;
const KEY_PREFIX = 'clockify-capture-arm:';

function assertTabId(tabId) {
  if (!Number.isInteger(tabId) || tabId < 0) throw new Error('Clockify capture arm requires a browser tab');
}

function armKey(tabId) {
  return `${KEY_PREFIX}${tabId}`;
}

function validArm(value, now) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === 1 && Number.isSafeInteger(value.expiresAt)
    && value.expiresAt > now;
}

export function createClockifyCaptureArmService({ storageSession, now = () => Date.now(), ttlMs = ARM_TTL_MS }) {
  if (!storageSession || typeof storageSession.get !== 'function' || typeof storageSession.set !== 'function' || typeof storageSession.remove !== 'function') {
    throw new Error('Clockify capture arm requires session storage');
  }
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > ARM_TTL_MS) throw new Error('Invalid Clockify capture arm TTL');

  return Object.freeze({
    async arm(tabId) {
      assertTabId(tabId);
      await storageSession.set(armKey(tabId), Object.freeze({ expiresAt: now() + ttlMs }));
    },
    async isArmed(tabId) {
      assertTabId(tabId);
      const key = armKey(tabId);
      const value = await storageSession.get(key);
      if (validArm(value, now())) return true;
      await storageSession.remove(key);
      return false;
    },
    async disarm(tabId) {
      assertTabId(tabId);
      await storageSession.remove(armKey(tabId));
    },
  });
}

export { ARM_TTL_MS };
