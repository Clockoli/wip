import { snapshotClockifyMigrationData } from './clockify-migration-session.js';

const SCAN_KEY = 'clockify-migration-history-scan';
const SCAN_VERSION = 6;
const SCAN_TTL_MS = 30 * 60 * 1000;
const SHARD_KEY_PREFIX = 'clockify-migration-history-scan-year:';
// Clockify launched in 2016. This is only a final safety floor when no
// populated annual report establishes an earlier stopping boundary.
const DEFAULT_EARLIEST_YEAR = 2016;

function fail(message) { throw new Error(`Invalid Clockify history scan: ${message}`); }

function validYear(year, earliestYear = DEFAULT_EARLIEST_YEAR) {
  if (!Number.isInteger(year) || year < earliestYear || year > 9999) fail('invalid report year');
  return year;
}

function validNow(now) {
  const value = now();
  if (!Number.isSafeInteger(value) || value < 0) fail('clock returned an invalid time');
  return value;
}

function validSessionId(value) { return typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value); }
function validTransport(value) {
  if (!['csv', 'report'].includes(value)) fail('invalid capture transport');
  return value;
}
function shardKey(sessionId, year) { return `${SHARD_KEY_PREFIX}${sessionId}:${year}`; }

function aggregate(shards) {
  const entries = new Map();
  const names = new Map();
  for (const value of shards) {
    const shard = snapshotClockifyMigrationData(value);
    for (const entry of shard.entries) {
      const previous = entries.get(entry.entryId);
      if (previous && JSON.stringify(previous) !== JSON.stringify(entry)) fail('conflicting duplicate entry ID');
      entries.set(entry.entryId, entry);
    }
    for (const user of shard.users) {
      const previous = names.get(user.userId);
      if (previous && previous !== user.displayName) fail('conflicting source user display name');
      names.set(user.userId, user.displayName);
    }
  }
  const counts = new Map();
  for (const entry of entries.values()) counts.set(entry.userId, (counts.get(entry.userId) || 0) + 1);
  return snapshotClockifyMigrationData({
    users: [...counts].map(([userId, entryCount]) => ({ userId, displayName: names.get(userId), entryCount })),
    entries: [...entries.values()],
  });
}

function history(yearsWithEntries, completedYears) {
  return Object.freeze({ totalYears: yearsWithEntries.length, completedYears, yearsWithEntries: [...yearsWithEntries] });
}

function snapshotStored(value, now, earliestYear) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype
      || Object.keys(value).length !== 9 || value.version !== SCAN_VERSION
      || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= now
      || !['discovering', 'capturing'].includes(value.phase) || !validSessionId(value.sessionId)) fail('stored scan is expired or malformed');
  const currentYear = validYear(value.currentYear, earliestYear);
  const nextYear = validYear(value.nextYear, earliestYear);
  const transport = validTransport(value.transport);
  if (!Array.isArray(value.yearsWithEntries) || value.yearsWithEntries.some(year => !Number.isInteger(year) || year < earliestYear || year > currentYear)
      || new Set(value.yearsWithEntries).size !== value.yearsWithEntries.length) fail('stored scan has invalid planned years');
  const captureIndex = value.captureIndex;
  if (!Number.isInteger(captureIndex) || captureIndex < 0 || captureIndex > value.yearsWithEntries.length) fail('stored scan has invalid capture position');
  if (value.phase === 'discovering') {
    if (captureIndex !== 0 || nextYear > currentYear) fail('stored scan has invalid discovery position');
  } else if (value.yearsWithEntries.length === 0 || nextYear !== value.yearsWithEntries[captureIndex]) {
    fail('stored scan has invalid capture year');
  }
  return {
    expiresAt: value.expiresAt,
    phase: value.phase,
    currentYear,
    nextYear,
    yearsWithEntries: [...value.yearsWithEntries],
    captureIndex,
    sessionId: value.sessionId,
    transport,
  };
}

export function createClockifyHistoryScanService({
  storageSession,
  now = () => Date.now(),
  currentYear = () => new Date().getFullYear(),
  earliestYear = DEFAULT_EARLIEST_YEAR,
  randomUUID = () => crypto.randomUUID(),
} = {}) {
  if (!storageSession || typeof storageSession.get !== 'function' || typeof storageSession.set !== 'function' || typeof storageSession.remove !== 'function') {
    throw new Error('Clockify history scan requires session storage');
  }
  if (typeof now !== 'function' || typeof currentYear !== 'function' || typeof randomUUID !== 'function') throw new Error('Clockify history scan dependencies are invalid');
  validYear(earliestYear, DEFAULT_EARLIEST_YEAR);
  let tail = Promise.resolve();
  const exclusive = operation => {
    const work = tail.then(operation, operation);
    tail = work.catch(() => {});
    return work;
  };
  const discard = async stored => {
    const keys = [SCAN_KEY];
    if (stored?.sessionId && Array.isArray(stored.yearsWithEntries)) {
      for (const year of stored.yearsWithEntries) keys.push(shardKey(stored.sessionId, year));
    }
    try { await Promise.all(keys.map(key => storageSession.remove(key))); } catch { /* fail closed */ }
  };
  const load = async current => {
    let stored;
    try { stored = await storageSession.get(SCAN_KEY); }
    catch { await discard(); throw new Error('Clockify history scan storage is unavailable'); }
    if (stored === undefined || stored === null) return null;
    try { return snapshotStored(stored, current, earliestYear); }
    catch { await discard(stored); throw new Error('Clockify history scan has expired or is malformed'); }
  };
  const save = (value, current) => storageSession.set(SCAN_KEY, {
    version: SCAN_VERSION,
    expiresAt: current + SCAN_TTL_MS,
    phase: value.phase,
    currentYear: value.currentYear,
    nextYear: value.nextYear,
    yearsWithEntries: value.yearsWithEntries,
    captureIndex: value.captureIndex,
    sessionId: value.sessionId,
    transport: value.transport,
  });

  return Object.freeze({
    reset() { return exclusive(discard); },
    start(transport = 'csv') {
      return exclusive(async () => {
        const current = validNow(now);
        const year = validYear(currentYear(), earliestYear);
        const sessionId = randomUUID();
        if (!validSessionId(sessionId)) fail('random ID generator returned an invalid ID');
        await save({ phase: 'discovering', currentYear: year, nextYear: year, yearsWithEntries: [], captureIndex: 0, sessionId, transport: validTransport(transport) }, current);
        return { discovering: true, nextYear: year };
      });
    },
    status() {
      return exclusive(async () => {
        const stored = await load(validNow(now));
        if (!stored) return null;
        return stored.phase === 'discovering'
          ? {
              phase: 'discovering',
              currentYear: stored.currentYear,
              nextYear: stored.nextYear,
              yearsChecked: stored.currentYear - stored.nextYear,
              yearsWithEntries: [...stored.yearsWithEntries],
              transport: stored.transport,
            }
          : { phase: 'capturing', history: history(stored.yearsWithEntries, stored.captureIndex), transport: stored.transport };
      });
    },
    observeYear(year, entryCount) {
      return exclusive(async () => {
        const current = validNow(now);
        const stored = await load(current);
        const requestedYear = validYear(year, earliestYear);
        if (!stored || stored.phase !== 'discovering' || requestedYear !== stored.nextYear) fail(`expected discovery year ${stored?.nextYear ?? 'none'}`);
        if (!Number.isSafeInteger(entryCount) || entryCount < 0) fail('invalid report entry count');
        const yearsWithEntries = entryCount > 0 ? [...stored.yearsWithEntries, requestedYear] : stored.yearsWithEntries;
        const yearsChecked = stored.currentYear - requestedYear + 1;
        // Empty years preceding the first populated year are expected when a
        // scan starts at the present. Once history has begun, the first empty
        // earlier year is its boundary; continuing would only request known
        // empty report ranges.
        const reachedHistoryBoundary = entryCount === 0 && yearsWithEntries.length > 0;
        if (requestedYear > earliestYear && !reachedHistoryBoundary) {
          const nextYear = requestedYear - 1;
          await save({ ...stored, nextYear, yearsWithEntries }, current);
          return { discovering: true, nextYear, yearsChecked, yearsWithEntries: [...yearsWithEntries] };
        }
        if (yearsWithEntries.length === 0) fail('history scan has no years with entries');
        const nextYear = yearsWithEntries[0];
        await save({ ...stored, phase: 'capturing', nextYear, yearsWithEntries, captureIndex: 0 }, current);
        return { capturing: true, nextYear, history: history(yearsWithEntries, 0) };
      });
    },
    append(year, normalized) {
      return exclusive(async () => {
        const current = validNow(now);
        const stored = await load(current);
        const requestedYear = validYear(year, earliestYear);
        if (!stored || stored.phase !== 'capturing' || requestedYear !== stored.nextYear) fail(`expected report year ${stored?.nextYear ?? 'none'}`);
        const shard = snapshotClockifyMigrationData(normalized);
        await storageSession.set(shardKey(stored.sessionId, requestedYear), shard);
        const completedYears = stored.captureIndex + 1;
        const completedHistory = history(stored.yearsWithEntries, completedYears);
        if (completedYears === stored.yearsWithEntries.length) {
          let data;
          try {
            const shards = await Promise.all(stored.yearsWithEntries.map(year => storageSession.get(shardKey(stored.sessionId, year))));
            data = aggregate(shards);
          } catch (error) {
            await discard(stored);
            throw error;
          }
          await discard(stored);
          return { complete: true, history: completedHistory, data };
        }
        const nextYear = stored.yearsWithEntries[completedYears];
        await save({ ...stored, nextYear, captureIndex: completedYears }, current);
        return { complete: false, nextYear, history: completedHistory };
      });
    },
  });
}
