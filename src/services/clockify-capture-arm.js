import { snapshotClockifyMigrationData } from './clockify-migration-session.js';

const ARM_TTL_MS = 30 * 60 * 1000;
const CHECKPOINT_MAX_BYTES = 8 * 1024 * 1024;
const KEY_PREFIX = 'clockify-capture-arm:';
const CHECKPOINT_KEY_PREFIX = 'clockify-capture-checkpoint:';
const PAGE_KEY_PREFIX = 'clockify-capture-page:';
const ENTRY_KEY_PREFIX = 'clockify-capture-entry:';
const USER_KEY_PREFIX = 'clockify-capture-user:';
const CHECKPOINT_VERSION = 4;
const PROFILE_LIMIT = 100;

function recordProfile(profile) {
  const entries = globalThis.__clockoliClockifyCaptureProfiles || [];
  entries.push(Object.freeze(profile));
  if (entries.length > PROFILE_LIMIT) entries.splice(0, entries.length - PROFILE_LIMIT);
  globalThis.__clockoliClockifyCaptureProfiles = entries;
  console.info('[Clockoli Clockify capture arm]', JSON.stringify(profile));
}

function assertTabId(tabId) {
  if (!Number.isInteger(tabId) || tabId < 0) throw new Error('Clockify capture arm requires a browser tab');
}
function armKey(tabId) { return `${KEY_PREFIX}${tabId}`; }
function checkpointKey(tabId) { return `${CHECKPOINT_KEY_PREFIX}${tabId}`; }
function pageKey(tabId, sessionId, pageNumber) { return `${PAGE_KEY_PREFIX}${tabId}:${sessionId}:${pageNumber}`; }
function entryKey(tabId, sessionId, entryId) { return `${ENTRY_KEY_PREFIX}${tabId}:${sessionId}:${encodeURIComponent(entryId)}`; }
function userKey(tabId, sessionId, userId) { return `${USER_KEY_PREFIX}${tabId}:${sessionId}:${encodeURIComponent(userId)}`; }
function bytesOf(value) { return new TextEncoder().encode(JSON.stringify(value)).length; }
function validArm(value, current) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === 1 && Number.isSafeInteger(value.expiresAt) && value.expiresAt > current;
}
function validSessionId(value) { return typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value); }
function validCheckpoint(value, current) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 6
    || value.version !== CHECKPOINT_VERSION || !validSessionId(value.sessionId)
    || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= current
    || !Number.isSafeInteger(value.skippedEntries) || value.skippedEntries < 0
    || !Number.isSafeInteger(value.pageCount) || value.pageCount < 0
    || !Number.isSafeInteger(value.storageBytes) || value.storageBytes < 0 || value.storageBytes > CHECKPOINT_MAX_BYTES) return null;
  return value;
}
function exactEntry(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function checkpointValue(sessionId, expiresAt, skippedEntries, pageCount, storageBytes) {
  return { version: CHECKPOINT_VERSION, sessionId, expiresAt, skippedEntries, pageCount, storageBytes };
}

export function createClockifyCaptureArmService({ storageSession, now = () => Date.now(), ttlMs = ARM_TTL_MS }) {
  if (!storageSession || typeof storageSession.get !== 'function' || typeof storageSession.set !== 'function' || typeof storageSession.remove !== 'function') throw new Error('Clockify capture arm requires session storage');
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > ARM_TTL_MS) throw new Error('Invalid Clockify capture arm TTL');
  const clear = async tabId => {
    const checkpoint = await storageSession.get(checkpointKey(tabId));
    const sessionId = checkpoint?.sessionId;
    const pageCount = checkpoint?.pageCount;
    const keys = [checkpointKey(tabId)];
    if (validSessionId(sessionId) && Number.isSafeInteger(pageCount) && pageCount >= 0) {
      const pages = await Promise.all(Array.from({ length: pageCount }, async (_, pageNumber) => {
        const key = pageKey(tabId, sessionId, pageNumber);
        keys.push(key);
        return storageSession.get(key);
      }));
      for (const shard of pages) {
        try {
          const data = snapshotClockifyMigrationData(shard);
          for (const entry of data.entries) keys.push(entryKey(tabId, sessionId, entry.entryId));
          for (const user of data.users) keys.push(userKey(tabId, sessionId, user.userId));
        } catch {
          // The known page key is still removed; malformed session data never
          // becomes a valid resume point.
        }
      }
    }
    await Promise.all(keys.map(key => storageSession.remove(key)));
  };
  let tail = Promise.resolve();
  const exclusive = operation => {
    const work = tail.then(operation, operation);
    tail = work.catch(() => {});
    return work;
  };

  async function priorPageEntry(tabId, sessionId, index) {
    if (!index || !Number.isSafeInteger(index.page) || index.page < 0) throw new Error('Clockify report checkpoint is malformed');
    const shard = await storageSession.get(pageKey(tabId, sessionId, index.page));
    try {
      const data = snapshotClockifyMigrationData(shard);
      const entry = data.entries.find(candidate => candidate.entryId === index.entryId);
      if (!entry) throw new Error('missing indexed entry');
      return entry;
    } catch { throw new Error('Clockify report checkpoint is malformed'); }
  }

  return Object.freeze({
    arm(tabId) { return exclusive(async () => { assertTabId(tabId); await clear(tabId); await storageSession.set(armKey(tabId), Object.freeze({ expiresAt: now() + ttlMs })); }); },
    isArmed(tabId) { return exclusive(async () => { assertTabId(tabId); const value = await storageSession.get(armKey(tabId)); if (validArm(value, now())) return true; await Promise.all([storageSession.remove(armKey(tabId)), clear(tabId)]); return false; }); },
    disarm(tabId) { return exclusive(async () => { assertTabId(tabId); await Promise.all([storageSession.remove(armKey(tabId)), clear(tabId)]); }); },
    appendPage(tabId, page, skippedEntries = 0, pageIsFinal = false) {
      return exclusive(async () => {
        assertTabId(tabId);
        if (!Number.isSafeInteger(skippedEntries) || skippedEntries < 0) throw new Error('Invalid skipped Clockify report entries');
        if (typeof pageIsFinal !== 'boolean') throw new Error('Invalid Clockify report page boundary');
        const profileStartedAt = now();
        const [arm, storedValue] = await Promise.all([storageSession.get(armKey(tabId)), storageSession.get(checkpointKey(tabId))]);
        const capturedAt = now();
        const armed = validArm(arm, capturedAt);
        const stored = validCheckpoint(storedValue, capturedAt);
        if (!stored && storedValue !== undefined) { await clear(tabId); throw new Error('Clockify report checkpoint is malformed'); }
        if (!armed && !stored) {
          await Promise.all([storageSession.remove(armKey(tabId)), clear(tabId)]);
          throw new Error('Clockify capture is not armed');
        }
        const normalized = snapshotClockifyMigrationData(page);
        if (normalized.entries.length + skippedEntries > 200) throw new Error('Clockify report page exceeds configured size');
        const sessionId = stored?.sessionId || crypto.randomUUID();
        const pageNumber = stored?.pageCount || 0;
        const totalSkippedEntries = (stored?.skippedEntries || 0) + skippedEntries;

        // Index lookups are bounded by this page (at most 200 entries); previous
        // page payloads are never loaded during normal accumulation.
        const entryIndexes = await Promise.all(normalized.entries.map(async entry => ({ entry, index: await storageSession.get(entryKey(tabId, sessionId, entry.entryId)) })));
        const userIndexes = await Promise.all(normalized.users.map(async user => ({ user, value: await storageSession.get(userKey(tabId, sessionId, user.userId)) })));
        for (const { entry, index } of entryIndexes) {
          if (index === undefined) continue;
          if (!index || typeof index !== 'object' || Array.isArray(index) || Object.keys(index).length !== 2 || index.entryId !== entry.entryId) {
            await clear(tabId); throw new Error('Clockify report checkpoint is malformed');
          }
          const prior = await priorPageEntry(tabId, sessionId, index);
          if (!exactEntry(prior, entry)) throw new Error('Clockify report has conflicting duplicate entry IDs');
        }
        for (const { user, value } of userIndexes) {
          if (value === undefined) continue;
          if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1 || value.displayName !== user.displayName) {
            throw new Error('Clockify report has conflicting source users');
          }
        }

        const currentEntries = entryIndexes.filter(({ index }) => index === undefined || index.page === pageNumber).map(({ entry }) => entry);
        const currentCounts = new Map();
        for (const entry of currentEntries) currentCounts.set(entry.userId, (currentCounts.get(entry.userId) || 0) + 1);
        const shard = snapshotClockifyMigrationData({
          users: normalized.users.filter(user => currentCounts.has(user.userId)).map(user => ({ ...user, entryCount: currentCounts.get(user.userId) })),
          entries: currentEntries,
        });

        if (pageIsFinal) {
          const pages = await Promise.all(Array.from({ length: pageNumber }, async (_, number) => {
            const shard = await storageSession.get(pageKey(tabId, sessionId, number));
            try { return snapshotClockifyMigrationData(shard); }
            catch { await clear(tabId); throw new Error('Clockify report checkpoint is malformed'); }
          }));
          // An exact duplicate from an already-published page is intentionally
          // idempotent; a duplicate left by an interrupted write has this page's
          // number and is the page being completed now.
          const newEntries = entryIndexes.filter(({ index }) => index === undefined || index.page === pageNumber).map(({ entry }) => entry);
          const entries = [...pages.flatMap(shard => shard.entries), ...newEntries];
          const names = new Map();
          for (const shard of [...pages, normalized]) for (const user of shard.users) names.set(user.userId, user.displayName);
          const counts = new Map();
          for (const entry of entries) counts.set(entry.userId, (counts.get(entry.userId) || 0) + 1);
          const data = snapshotClockifyMigrationData({ users: [...counts].map(([userId, entryCount]) => ({ userId, displayName: names.get(userId), entryCount })), entries });
          const allShards = [...pages, normalized];
          await Promise.all([
            storageSession.remove(armKey(tabId)),
            clear(tabId),
            ...Array.from({ length: pageNumber }, (_, number) => storageSession.remove(pageKey(tabId, sessionId, number))),
            ...allShards.flatMap(shard => shard.entries.map(entry => storageSession.remove(entryKey(tabId, sessionId, entry.entryId)))),
            ...allShards.flatMap(shard => shard.users.map(user => storageSession.remove(userKey(tabId, sessionId, user.userId)))),
          ]);
          recordProfile({ event: 'page_profile', complete: true, pageEntries: normalized.entries.length, totalEntryCount: data.entries.length, totalMs: now() - profileStartedAt });
          return { complete: true, data };
        }

        const shardBytes = bytesOf(shard);
        const newEntryIndexes = entryIndexes.filter(({ index }) => index === undefined || index.page === pageNumber);
        const indexBytes = newEntryIndexes.reduce((total, { entry }) => total + bytesOf({ page: pageNumber, entryId: entry.entryId }), 0)
          + userIndexes.filter(({ value }) => value === undefined).reduce((total, { user }) => total + bytesOf({ displayName: user.displayName }), 0);
        const expiresAt = capturedAt + ttlMs;
        const nextCheckpoint = checkpointValue(sessionId, expiresAt, totalSkippedEntries, pageNumber + 1, (stored?.storageBytes || 0) + shardBytes + indexBytes);
        if (nextCheckpoint.storageBytes + bytesOf(nextCheckpoint) > CHECKPOINT_MAX_BYTES) throw new Error('Clockify report checkpoint is too large');
        // Publish the shard and its bounded indexes before metadata. If the worker
        // dies mid-write, metadata still points only at fully committed pages; a
        // retry can safely overwrite this page number and finish publication.
        await storageSession.set(pageKey(tabId, sessionId, pageNumber), shard);
        await Promise.all([
          ...newEntryIndexes.map(({ entry }) => storageSession.set(entryKey(tabId, sessionId, entry.entryId), { page: pageNumber, entryId: entry.entryId })),
          ...userIndexes.filter(({ value }) => value === undefined).map(({ user }) => storageSession.set(userKey(tabId, sessionId, user.userId), { displayName: user.displayName })),
        ]);
        await Promise.all([storageSession.set(armKey(tabId), Object.freeze({ expiresAt })), storageSession.set(checkpointKey(tabId), nextCheckpoint)]);
        recordProfile({ event: 'page_profile', complete: false, pageEntries: normalized.entries.length, storedPageCount: stored?.pageCount || 0, checkpointBytes: nextCheckpoint.storageBytes, totalMs: now() - profileStartedAt });
        return { complete: false };
      });
    },
  });
}
export { ARM_TTL_MS };
