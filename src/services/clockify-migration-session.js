// A deliberately small storage-session boundary for the extension-origin
// migration preview. It accepts only the normalizer's credential-free DTO.
const SESSION_KEY = 'clockify-migration-preview';
const SESSION_VERSION = 1;
const MAX_USERS = 20_000;
const MAX_ID_LENGTH = 200;
const MAX_NAME_LENGTH = 300;
const MAX_TASK_LENGTH = 300;
const MAX_DESCRIPTION_LENGTH = 2_000;
const MAX_TAGS = 50;
const MAX_TAG_LENGTH = 120;
// Mapping a large historical report requires reviewing each source person. Keep
// the credential-free, single-use preview available long enough to do that
// deliberately, while still bounding its lifetime in extension storage.
const MAX_CLOCKIFY_MIGRATION_SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const DEFAULT_CLOCKIFY_MIGRATION_SESSION_TTL_MS = 60 * 60 * 1000;
const OPAQUE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const USER_KEYS = new Set(['userId', 'displayName', 'entryCount']);
const ENTRY_KEYS = new Set(['provider', 'entryId', 'userId', 'startedAt', 'endedAt', 'timezone', 'duration', 'projectId', 'project', 'task', 'description', 'tags', 'billable', 'resolvedIssue']);
const RESOLVED_ISSUE_KEYS = new Set(['url', 'title']);
const GITHUB_TASK_URL = /^https:\/\/github\.com\/[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*\/(?:issues|pull)\/\d{1,9}$/;

function fail(message) { throw new Error(`Invalid Clockify migration session: ${message}`); }

function dataProperty(value, key, label) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail(`${label}.${key} must be an inert data property`);
  return descriptor.value;
}

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(`${label} must be an inert plain object`);
  if (Object.getOwnPropertySymbols(value).length) fail(`${label} must not contain symbol fields`);
  return value;
}

function exactKeys(value, keys, label) {
  const names = Object.getOwnPropertyNames(value);
  if (names.length !== keys.size || names.some(key => !keys.has(key))) fail(`${label} has unsupported fields`);
}

function denseArray(value, label, maximum = Infinity) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || Object.getOwnPropertySymbols(value).length) fail(`${label} must be an inert array`);
  const length = dataProperty(value, 'length', label);
  const names = Object.getOwnPropertyNames(value);
  if (!Number.isSafeInteger(length) || length < 0 || length > maximum || names.length !== length + 1) fail(`${label} must be a dense data array`);
  const result = [];
  for (let index = 0; index < length; index += 1) result.push(dataProperty(value, String(index), label));
  return result;
}

function text(value, label, maximum, { empty = false } = {}) {
  if (typeof value !== 'string' || (!empty && !value) || value.length > maximum) fail(`invalid ${label}`);
  return value;
}

function timestamp(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) fail(`invalid ${label}`);
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) fail(`invalid ${label}`);
  return milliseconds;
}

function validTimezone(value) {
  text(value, 'timezone', 100);
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date(0)); }
  catch { fail('invalid timezone'); }
  return value;
}

function snapshotUser(value) {
  plainObject(value, 'source user');
  exactKeys(value, USER_KEYS, 'source user');
  const userId = text(dataProperty(value, 'userId', 'source user'), 'source user ID', MAX_ID_LENGTH);
  const displayName = text(dataProperty(value, 'displayName', 'source user'), 'source user display name', MAX_NAME_LENGTH);
  const entryCount = dataProperty(value, 'entryCount', 'source user');
  if (!Number.isSafeInteger(entryCount) || entryCount < 1) fail('invalid source user entry count');
  return { userId, displayName, entryCount };
}

function snapshotEntry(value) {
  plainObject(value, 'entry');
  if (Object.getOwnPropertyNames(value).some(key => !ENTRY_KEYS.has(key))) fail('entry has unsupported fields');
  if (dataProperty(value, 'provider', 'entry') !== 'clockify') fail('invalid entry provider');
  const entryId = text(dataProperty(value, 'entryId', 'entry'), 'entry ID', MAX_ID_LENGTH);
  const userId = text(dataProperty(value, 'userId', 'entry'), 'entry user ID', MAX_ID_LENGTH);
  const startedAt = dataProperty(value, 'startedAt', 'entry');
  const endedAt = dataProperty(value, 'endedAt', 'entry');
  if (timestamp(endedAt, 'entry end timestamp') <= timestamp(startedAt, 'entry start timestamp')) fail('entry end timestamp must be after start timestamp');
  const duration = dataProperty(value, 'duration', 'entry');
  if (!Number.isSafeInteger(duration) || duration < 1) fail('invalid entry duration');
  const tags = denseArray(dataProperty(value, 'tags', 'entry'), 'entry tags', MAX_TAGS).map(tag => text(tag, 'entry tag', MAX_TAG_LENGTH));
  if (new Set(tags).size !== tags.length) fail('duplicate entry tag');
  const billable = dataProperty(value, 'billable', 'entry');
  if (typeof billable !== 'boolean') fail('invalid entry billable flag');
  const resolvedIssue = Object.hasOwn(value, 'resolvedIssue') ? dataProperty(value, 'resolvedIssue', 'entry') : null;
  if (resolvedIssue !== null) {
    plainObject(resolvedIssue, 'resolved issue');
    exactKeys(resolvedIssue, RESOLVED_ISSUE_KEYS, 'resolved issue');
    if (!GITHUB_TASK_URL.test(dataProperty(resolvedIssue, 'url', 'resolved issue'))) fail('invalid resolved issue URL');
  }
  return {
    provider: 'clockify', entryId, userId, startedAt, endedAt, duration,
    timezone: validTimezone(dataProperty(value, 'timezone', 'entry')),
    projectId: text(dataProperty(value, 'projectId', 'entry'), 'project ID', MAX_ID_LENGTH),
    project: text(dataProperty(value, 'project', 'entry'), 'project', MAX_NAME_LENGTH),
    task: text(dataProperty(value, 'task', 'entry'), 'task', MAX_TASK_LENGTH, { empty: true }),
    description: text(dataProperty(value, 'description', 'entry'), 'description', MAX_DESCRIPTION_LENGTH, { empty: true }),
    tags, billable,
    ...(resolvedIssue ? { resolvedIssue: { url: dataProperty(resolvedIssue, 'url', 'resolved issue'), title: text(dataProperty(resolvedIssue, 'title', 'resolved issue'), 'resolved issue title', MAX_TASK_LENGTH) } } : {}),
  };
}

export function snapshotClockifyMigrationData(value) {
  plainObject(value, 'normalized preview');
  exactKeys(value, new Set(['users', 'entries']), 'normalized preview');
  const users = denseArray(dataProperty(value, 'users', 'normalized preview'), 'source users', MAX_USERS).map(snapshotUser);
  const entries = denseArray(dataProperty(value, 'entries', 'normalized preview'), 'entries').map(snapshotEntry);
  const userCounts = new Map();
  for (const user of users) {
    if (userCounts.has(user.userId)) fail('duplicate source user ID');
    userCounts.set(user.userId, { displayName: user.displayName, count: user.entryCount, actual: 0 });
  }
  const entryIds = new Set();
  for (const entry of entries) {
    if (entryIds.has(entry.entryId)) fail('duplicate entry ID');
    entryIds.add(entry.entryId);
    const user = userCounts.get(entry.userId);
    if (!user) fail('entry user is not in source roster');
    user.actual += 1;
  }
  for (const user of userCounts.values()) if (user.actual !== user.count) fail('source user entry count does not match entries');
  return deepFreeze({ users, entries });
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function validNow(now) {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) fail('clock returned an invalid time');
  return value;
}

function validTtl(ttlMs) {
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > MAX_CLOCKIFY_MIGRATION_SESSION_TTL_MS) fail('invalid TTL');
  return ttlMs;
}

function validOpaqueId(value) { return typeof value === 'string' && OPAQUE_ID.test(value); }

function snapshotStored(value, now) {
  plainObject(value, 'stored preview');
  exactKeys(value, new Set(['version', 'id', 'expiresAt', 'data']), 'stored preview');
  if (dataProperty(value, 'version', 'stored preview') !== SESSION_VERSION) fail('unsupported stored preview version');
  const id = dataProperty(value, 'id', 'stored preview');
  const expiresAt = dataProperty(value, 'expiresAt', 'stored preview');
  if (!validOpaqueId(id) || !Number.isSafeInteger(expiresAt) || expiresAt <= now) fail('stored preview is expired or malformed');
  if (expiresAt - now > MAX_CLOCKIFY_MIGRATION_SESSION_TTL_MS) fail('stored preview expiry is invalid');
  return { id, expiresAt, data: snapshotClockifyMigrationData(dataProperty(value, 'data', 'stored preview')) };
}

/**
 * `storageSession` is a narrow privileged extension-storage adapter:
 * `{ get(key), set(key, value), remove(key) }`. It intentionally has no
 * Chrome global dependency, so the security boundary is testable in isolation.
 */
export function createClockifyMigrationSessionService({ storageSession, now = () => Date.now(), randomUUID = () => crypto.randomUUID() } = {}) {
  if (!storageSession || typeof storageSession.get !== 'function' || typeof storageSession.set !== 'function' || typeof storageSession.remove !== 'function') throw new Error('Clockify migration session storage adapter is required');
  if (typeof now !== 'function' || typeof randomUUID !== 'function') throw new Error('Clockify migration session dependencies are invalid');
  let tail = Promise.resolve();
  const exclusive = operation => {
    const work = tail.then(operation, operation);
    tail = work.catch(() => {});
    return work;
  };
  const discard = async () => { try { await storageSession.remove(SESSION_KEY); } catch { /* fail closed */ } };

  return Object.freeze({
    create(normalized, { ttlMs = DEFAULT_CLOCKIFY_MIGRATION_SESSION_TTL_MS } = {}) {
      return exclusive(async () => {
        const data = snapshotClockifyMigrationData(normalized);
        const current = validNow(now);
        const ttl = validTtl(ttlMs);
        const id = randomUUID();
        if (!validOpaqueId(id)) fail('random ID generator returned an invalid ID');
        const expiresAt = current + ttl;
        if (!Number.isSafeInteger(expiresAt)) fail('session expiry is invalid');
        // The fixed key ensures there can only be one active handoff.
        await storageSession.set(SESSION_KEY, { version: SESSION_VERSION, id, expiresAt, data });
        return Object.freeze({ id, expiresAt });
      });
    },

    peek() {
      return exclusive(async () => {
        let stored;
        try { stored = await storageSession.get(SESSION_KEY); }
        catch { await discard(); return null; }
        if (stored === undefined || stored === null) return null;
        let snapshot;
        try { snapshot = snapshotStored(stored, validNow(now)); }
        catch (error) {
          // This diagnostic deliberately contains only the validator's fixed
          // reason text; it never logs stored Clockify data.
          console.warn('[Clockoli Clockify migration preview rejected]', error instanceof Error ? error.message : 'unknown validation error');
          await discard();
          return null;
        }
        return { id: snapshot.id, data: snapshot.data };
      });
    },

    consume(id) {
      return exclusive(async () => {
        if (!validOpaqueId(id)) return null;
        let stored;
        try { stored = await storageSession.get(SESSION_KEY); }
        catch { await discard(); return null; }
        if (stored === undefined || stored === null) return null;
        let snapshot;
        try { snapshot = snapshotStored(stored, validNow(now)); }
        catch { await discard(); return null; }
        if (snapshot.id !== id) return null;
        // Delete is awaited before exposing data: a second consumer cannot reuse it.
        try { await storageSession.remove(SESSION_KEY); }
        catch { return null; }
        return snapshot.data;
      });
    },
  });
}

export { MAX_CLOCKIFY_MIGRATION_SESSION_TTL_MS };
