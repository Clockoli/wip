const PROFILE_KEY = 'clockify-migration-capture-profile-v1';
const PROFILE_VERSION = 2;
const PROFILE_TTL_MS = 2 * 60 * 60 * 1000;
const MEASURES = new Set(['csv_parse', 'csv_source_digest', 'csv_row_normalization', 'history_append', 'task_url_resolution', 'preview_session_write', 'preview_tab_create']);

function fail(message) { throw new Error(`Invalid Clockify capture profile: ${message}`); }

function timestamp(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) fail(`invalid ${label}`);
  return value;
}

function elapsed(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) fail(`invalid ${label}`);
  return value;
}

function count(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) fail(`invalid ${label}`);
  return value;
}

function itemCount(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) fail(`invalid ${label}`);
  return value;
}

function snapshot(value, now) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype
      || Object.keys(value).length !== 4 || value.version !== PROFILE_VERSION) fail('malformed stored value');
  const startedAt = timestamp(value.startedAt, 'start time');
  const expiresAt = timestamp(value.expiresAt, 'expiry');
  if (expiresAt <= now || expiresAt - startedAt > PROFILE_TTL_MS) fail('expired stored value');
  if (!Array.isArray(value.measures) || value.measures.length > MEASURES.size) fail('invalid measures');
  const seen = new Set();
  const measures = value.measures.map(measure => {
    if (!measure || typeof measure !== 'object' || Array.isArray(measure) || Object.getPrototypeOf(measure) !== Object.prototype
        || Object.keys(measure).length !== 4 || !MEASURES.has(measure.name) || seen.has(measure.name)) fail('invalid measure');
    seen.add(measure.name);
    return {
      name: measure.name,
      elapsedMs: elapsed(measure.elapsedMs, 'measure elapsed time'),
      samples: count(measure.samples, 'measure sample count'),
      count: itemCount(measure.count, 'measure count'),
    };
  });
  return { startedAt, expiresAt, measures };
}

export function createClockifyCaptureProfileService({ storageSession, now = () => Date.now() } = {}) {
  if (!storageSession || typeof storageSession.get !== 'function' || typeof storageSession.set !== 'function' || typeof storageSession.remove !== 'function') {
    throw new Error('Clockify capture profile storage adapter is required');
  }
  if (typeof now !== 'function') throw new Error('Clockify capture profile clock is required');
  let tail = Promise.resolve();
  const exclusive = operation => {
    const work = tail.then(operation, operation);
    tail = work.catch(() => {});
    return work;
  };
  const read = async current => {
    const stored = await storageSession.get(PROFILE_KEY);
    if (stored === undefined || stored === null) return null;
    return snapshot(stored, current);
  };
  const write = profile => storageSession.set(PROFILE_KEY, {
    version: PROFILE_VERSION, startedAt: profile.startedAt, expiresAt: profile.expiresAt, measures: profile.measures,
  });

  return Object.freeze({
    start(startedAt = now()) {
      return exclusive(async () => {
        const current = timestamp(now(), 'current time');
        const started = timestamp(startedAt, 'start time');
        if (started > current || current - started > 60_000) fail('start time is outside the capture request window');
        const profile = { startedAt: started, expiresAt: started + PROFILE_TTL_MS, measures: [] };
        await write(profile);
        return profile;
      });
    },
    measure(name, elapsedMs, items = 1) {
      return exclusive(async () => {
        if (!MEASURES.has(name)) fail('unknown measure');
        const current = timestamp(now(), 'current time');
        const profile = await read(current);
        if (!profile) fail('profile is unavailable');
        const sampleElapsed = elapsed(elapsedMs, 'measure elapsed time');
        const sampleCount = itemCount(items, 'measure item count');
        const previous = profile.measures.find(measure => measure.name === name);
        if (previous) {
          previous.elapsedMs += sampleElapsed;
          previous.samples += 1;
          previous.count += sampleCount;
        } else profile.measures.push({ name, elapsedMs: sampleElapsed, samples: 1, count: sampleCount });
        await write(profile);
        return profile;
      });
    },
    read() {
      return exclusive(async () => {
        const current = timestamp(now(), 'current time');
        try { return await read(current); }
        catch { await storageSession.remove(PROFILE_KEY); return null; }
      });
    },
    clear() { return exclusive(() => storageSession.remove(PROFILE_KEY)); },
  });
}

export { PROFILE_KEY };
