import { normalizeStoredTaskIdentity, validateEntryId, validatePathSegment } from './values.js';
import { normalizeTaskTitle, validateTimestamp } from './records.js';

export const TASK_INDEX_PATH = '.clockoli/tasks.json';

function exactKeys(value, expected) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === [...expected].sort().join(',');
}

function cloneIndex(index) {
  return { version: 1, storageLogin: index.storageLogin, tasks: structuredClone(index.tasks) };
}

function normalizedEntry(entry) {
  const taskUrl = normalizeStoredTaskIdentity(entry?.taskUrl ?? entry?.issue?.url ?? entry?.url);
  const id = validateEntryId(entry?.id);
  const durationSeconds = Number(entry?.durationSeconds);
  if (!taskUrl || !Number.isSafeInteger(durationSeconds) || durationSeconds < 0) {
    throw new Error('Invalid task index entry');
  }
  return { id, taskUrl, durationSeconds,
    ...('taskTitle' in (entry ?? {}) || 'issueTitle' in (entry ?? {})
      ? { title: normalizeTaskTitle(entry.taskTitle ?? entry.issueTitle),
        ...(entry.startedAt ? { titleStartedAt: validateTimestamp(entry.startedAt) } : {}) } : {}),
  };
}

function validTitleStartedAt(value) {
  if (typeof value !== 'string') return false;
  try { validateTimestamp(value); return true; }
  catch { return false; }
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
    const canonical = normalizeStoredTaskIdentity(taskUrl), summary = value.tasks[taskUrl];
    if (canonical !== taskUrl) throw new Error('Clockoli task index identity is not canonical');
    const hasTitle = Object.hasOwn(summary ?? {}, 'title');
    if (!exactKeys(summary, hasTitle
      ? ['totalSeconds', 'sessionCount', 'recordIds', 'title', 'titleSourceId',
        ...(Object.hasOwn(summary, 'titleStartedAt') ? ['titleStartedAt'] : [])]
      : ['totalSeconds', 'sessionCount', 'recordIds'])
        || !Number.isSafeInteger(summary.totalSeconds) || summary.totalSeconds < 0
        || !Number.isSafeInteger(summary.sessionCount) || summary.sessionCount < 1
        || !Array.isArray(summary.recordIds) || summary.recordIds.length !== summary.sessionCount
        || (hasTitle && (typeof summary.title !== 'string' || summary.title !== normalizeTaskTitle(summary.title)
          || !summary.recordIds.includes(summary.titleSourceId)))
        || (Object.hasOwn(summary ?? {}, 'titleStartedAt') && !validTitleStartedAt(summary.titleStartedAt))
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
    tasks[taskUrl] = { totalSeconds: summary.totalSeconds, sessionCount: summary.sessionCount, recordIds: [...summary.recordIds],
      ...(hasTitle ? { title: summary.title, titleSourceId: summary.titleSourceId,
        ...(Object.hasOwn(summary, 'titleStartedAt') ? { titleStartedAt: summary.titleStartedAt } : {}) } : {}) };
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
    else next.tasks[taskUrl] = { totalSeconds, sessionCount, recordIds: current.recordIds.filter(recordId => recordId !== id),
      ...(current.titleSourceId !== id && Object.hasOwn(current, 'title')
        ? { title: current.title, titleSourceId: current.titleSourceId,
          ...(current.titleStartedAt ? { titleStartedAt: current.titleStartedAt } : {}) } : {}) };
  }
  const knownRecordIds = new Set(Object.values(next.tasks).flatMap(summary => summary.recordIds));
  const additionsByTask = new Map();
  for (const entry of add) {
    const { id, taskUrl, durationSeconds, ...title } = normalizedEntry(entry);
    if (knownRecordIds.has(id)) throw new Error('Clockoli task index does not match completed records');
    knownRecordIds.add(id);
    if (!additionsByTask.has(taskUrl)) additionsByTask.set(taskUrl, []);
    additionsByTask.get(taskUrl).push({ id, durationSeconds, ...title });
  }
  for (const [taskUrl, additions] of additionsByTask) {
    const current = next.tasks[taskUrl] ?? { totalSeconds: 0, sessionCount: 0, recordIds: [] };
    const titled = additions.filter(entry => entry.title).reduce((best, entry) =>
      !best || (entry.titleStartedAt && best.titleStartedAt
        ? Date.parse(entry.titleStartedAt) >= Date.parse(best.titleStartedAt) : true) ? entry : best, null);
    const keepCurrent = Object.hasOwn(current, 'title') && (!titled || (current.title && current.titleStartedAt
      && titled.titleStartedAt && Date.parse(current.titleStartedAt) > Date.parse(titled.titleStartedAt)));
    const blank = additions.findLast(entry => Object.hasOwn(entry, 'title'));
    const source = keepCurrent ? { ...current, id: current.titleSourceId } : titled
      ?? (current.sessionCount === 0 ? blank : null);
    const chosen = source ? { title: source.title, titleSourceId: source.id,
      ...(source.titleStartedAt ? { titleStartedAt: source.titleStartedAt } : {}) } : {};
    next.tasks[taskUrl] = {
      totalSeconds: current.totalSeconds + additions.reduce((total, entry) => total + entry.durationSeconds, 0),
      sessionCount: current.sessionCount + additions.length,
      recordIds: [...current.recordIds, ...additions.map(entry => entry.id)].sort((left, right) => left.localeCompare(right)),
      ...chosen,
    };
  }
  next.tasks = Object.fromEntries(Object.entries(next.tasks).sort(([left], [right]) => left.localeCompare(right)));
  return next;
}

export function taskIndexRecord(index, taskUrl) {
  const canonical = normalizeStoredTaskIdentity(taskUrl), summary = index.tasks[canonical];
  return summary ? {
    user: index.storageLogin, taskUrl: canonical, durationSeconds: summary.totalSeconds, recordIds: [...summary.recordIds],
  } : null;
}
