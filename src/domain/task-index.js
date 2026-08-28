import { normalizeTaskUrl, taskUrlOf, validateEntryId, validatePathSegment } from './values.js';

export const TASK_INDEX_PATH = '.clockoli/tasks.json';

function exactKeys(value, expected) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === [...expected].sort().join(',');
}

function cloneIndex(index) {
  return { version: 1, storageLogin: index.storageLogin, tasks: structuredClone(index.tasks) };
}

function normalizedEntry(entry) {
  const taskUrl = taskUrlOf(entry);
  const id = validateEntryId(entry?.id);
  const durationSeconds = Number(entry?.durationSeconds);
  if (!taskUrl || !Number.isSafeInteger(durationSeconds) || durationSeconds < 0) {
    throw new Error('Invalid task index entry');
  }
  return { id, taskUrl, durationSeconds };
}

export function emptyTaskIndex(user) {
  return { version: 1, storageLogin: validatePathSegment(user, 'user'), tasks: {} };
}

export function parseTaskIndex(text, { user } = {}) {
  let value;
  try { value = JSON.parse(String(text)); }
  catch { throw new Error('Clockoli task index is not valid JSON'); }
  if (!exactKeys(value, ['version', 'storageLogin', 'tasks']) || value.version !== 1
      || typeof value.storageLogin !== 'string' || !exactKeys(value.tasks, Object.keys(value.tasks ?? {}))) {
    throw new Error('Clockoli task index schema is invalid');
  }
  const storageLogin = validatePathSegment(value.storageLogin, 'storage user');
  if (user !== undefined && storageLogin !== validatePathSegment(user, 'storage user')) {
    throw new Error('Clockoli task index belongs to a different storage user');
  }
  const tasks = {};
  const knownRecordIds = new Set();
  for (const taskUrl of Object.keys(value.tasks).sort()) {
    const canonical = normalizeTaskUrl(taskUrl), summary = value.tasks[taskUrl];
    if (canonical !== taskUrl) throw new Error('Clockoli task index URL is not canonical');
    if (!exactKeys(summary, ['totalSeconds', 'sessionCount', 'recordIds'])
        || !Number.isSafeInteger(summary.totalSeconds) || summary.totalSeconds < 0
        || !Number.isSafeInteger(summary.sessionCount) || summary.sessionCount < 1
        || !Array.isArray(summary.recordIds) || summary.recordIds.length !== summary.sessionCount
        || summary.recordIds.some(id => {
          try { validateEntryId(id); return false; } catch { return true; }
        })
        || new Set(summary.recordIds).size !== summary.recordIds.length
        || summary.recordIds.some((id, position) => position && summary.recordIds[position - 1].localeCompare(id) >= 0)) {
      throw new Error('Clockoli task index summary is invalid');
    }
    if (summary.recordIds.some(id => knownRecordIds.has(id))) {
      throw new Error('Clockoli task index summary is invalid');
    }
    summary.recordIds.forEach(id => knownRecordIds.add(id));
    tasks[taskUrl] = { totalSeconds: summary.totalSeconds, sessionCount: summary.sessionCount, recordIds: [...summary.recordIds] };
  }
  return { version: 1, storageLogin, tasks };
}

export function serializeTaskIndex(index) {
  const validated = parseTaskIndex(JSON.stringify(index), { user: index?.storageLogin });
  return `${JSON.stringify(validated, null, 2)}\n`;
}

export function applyTaskIndexChanges(index, { remove = [], add = [] } = {}) {
  const next = cloneIndex(parseTaskIndex(JSON.stringify(index), { user: index?.storageLogin }));
  for (const entry of remove) {
    const { id, taskUrl, durationSeconds } = normalizedEntry(entry), current = next.tasks[taskUrl];
    if (!current || !current.recordIds.includes(id) || current.sessionCount < 1 || current.totalSeconds < durationSeconds) {
      throw new Error('Clockoli task index does not match completed records');
    }
    const totalSeconds = current.totalSeconds - durationSeconds, sessionCount = current.sessionCount - 1;
    if (!sessionCount) delete next.tasks[taskUrl];
    else next.tasks[taskUrl] = { totalSeconds, sessionCount, recordIds: current.recordIds.filter(recordId => recordId !== id) };
  }
  const knownRecordIds = new Set(Object.values(next.tasks).flatMap(summary => summary.recordIds));
  for (const entry of add) {
    const { id, taskUrl, durationSeconds } = normalizedEntry(entry);
    const current = next.tasks[taskUrl] ?? { totalSeconds: 0, sessionCount: 0, recordIds: [] };
    if (knownRecordIds.has(id)) throw new Error('Clockoli task index does not match completed records');
    next.tasks[taskUrl] = {
      totalSeconds: current.totalSeconds + durationSeconds,
      sessionCount: current.sessionCount + 1,
      recordIds: [...current.recordIds, id].sort((left, right) => left.localeCompare(right)),
    };
    knownRecordIds.add(id);
  }
  next.tasks = Object.fromEntries(Object.entries(next.tasks).sort(([left], [right]) => left.localeCompare(right)));
  return next;
}

export function taskIndexRecord(index, taskUrl) {
  const canonical = normalizeTaskUrl(taskUrl), summary = index.tasks[canonical];
  return summary ? {
    user: index.storageLogin, taskUrl: canonical, durationSeconds: summary.totalSeconds, recordIds: [...summary.recordIds],
  } : null;
}
