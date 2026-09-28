import { parseGitHubTaskUrl, taskUrlOf } from './values.js';

const PERIOD_DAYS = Object.freeze({
  'two-weeks': 14,
  'one-month': 31,
  'three-months': 92,
  'six-months': 181,
  'one-year': 365,
});

function dateValue(date) {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
function taskTitleOf(value) { return String(value?.taskTitle ?? value?.issueTitle ?? '').trim().slice(0, 300); }
function sameTimer(left, right) {
  if (left?.id && right?.id && left.id === right.id) return true;
  if (right?.id && Array.isArray(left?.recordIds) && left.recordIds.includes(right.id)) return true;
  return left?.user === right?.user && taskUrlOf(left) === taskUrlOf(right)
    && left.startedAt === right.startedAt;
}

export function aggregateTaskParticipants(records, {
  taskUrl, currentUser = '', active = null, pendingWrites = [],
} = {}) {
  const canonicalTaskUrl = taskUrlOf(taskUrl);
  if (!canonicalTaskUrl) throw new Error('Task URL is required');
  const persisted = [...(records ?? [])];
  const pending = pendingWrites
    .filter(operation => ['completeTimer', 'completeTimerAndStart'].includes(operation?.operation) && operation.entry
      && !['clearActive', 'startNext'].includes(operation.stage))
    .map(operation => operation.entry)
    .filter(entry => (!currentUser || String(entry?.user).toLowerCase() === currentUser.toLowerCase())
      && !persisted.some(record => sameTimer(record, entry)));
  const totals = new Map();
  for (const record of [...persisted, ...pending]) {
    if (taskUrlOf(record) !== canonicalTaskUrl) continue;
    const login = String(record?.user || '').trim(), key = login.toLowerCase();
    const seconds = Number(record?.durationSeconds);
    if (!login || !Number.isFinite(seconds) || seconds < 0) throw new Error('Invalid task participant record');
    const existing = totals.get(key) ?? { login, totalSeconds: 0 };
    existing.totalSeconds += seconds; totals.set(key, existing);
  }
  if (active && taskUrlOf(active) === canonicalTaskUrl
      && (!currentUser || String(active.user).toLowerCase() === currentUser.toLowerCase())) {
    const login = String(active.user || currentUser).trim(), key = login.toLowerCase();
    const startedAt = new Date(active.startedAt);
    if (!login || Number.isNaN(startedAt.getTime())) throw new Error('Invalid active task participant');
    const existing = totals.get(key) ?? { login, totalSeconds: 0 };
    existing.activeStartedAt = startedAt.toISOString(); totals.set(key, existing);
  }
  return [...totals.values()]
    .sort((a, b) => b.totalSeconds - a.totalSeconds || a.login.localeCompare(b.login));
}

export function taskPeriodRange(period, today) {
  const match = typeof today === 'string' ? today.match(/^(\d{4})-(\d{2})-(\d{2})$/) : null;
  if (!match) throw new Error('Invalid task period date');
  const end = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0);
  if (Number.isNaN(end.getTime()) || dateValue(end) !== today) throw new Error('Invalid task period date');
  if (period === 'all-time') return { startDate: '1970-01-01', endDate: today };
  const days = PERIOD_DAYS[period];
  if (!days) throw new Error('Invalid task period');
  const start = new Date(end); start.setDate(start.getDate() - days + 1);
  return { startDate: dateValue(start), endDate: today };
}

export function effectiveTrackedSeconds(task, { active = null, now = Date.now() } = {}) {
  const completed = Number(task?.totalSeconds);
  if (!Number.isFinite(completed) || completed < 0) throw new Error('Invalid tracked task duration');
  if (!task.activeStartedAt || taskUrlOf(active) !== taskUrlOf(task)) return completed;
  const startedAt = new Date(task.activeStartedAt).getTime(), current = new Date(now).getTime();
  if (!Number.isFinite(startedAt) || !Number.isFinite(current)) throw new Error('Invalid active task time');
  return completed + Math.max(0, Math.floor((current - startedAt) / 1000));
}

export function sortTrackedTasks(tasks, options = {}) {
  return [...(tasks ?? [])].sort((a, b) => effectiveTrackedSeconds(b, options) - effectiveTrackedSeconds(a, options)
    || taskUrlOf(a).localeCompare(taskUrlOf(b)));
}

export function aggregateTrackedTasks(records, { user, currentUsers = null, metadata = new Map(), active = null, pendingWrites = [], startDate = '', endDate = '' } = {}) {
  const users = new Set(currentUsers ?? (typeof user === 'string' && user ? [user] : []));
  if (!users.size) throw new Error('Task owner is required');
  const persisted = [...(records ?? [])];
  const pending = pendingWrites.filter(operation => ['completeTimer', 'completeTimerAndStart'].includes(operation?.operation) && operation.entry)
    .map(operation => ({
      ...operation.entry,
      destinationId: operation.entry.destinationId || operation.destinationId,
      timeRepository: operation.entry.timeRepository || operation.timeRepository,
    }))
    .filter(entry => (!startDate || entry.entryDate >= startDate) && (!endDate || entry.entryDate <= endDate)
      && !persisted.some(record => sameTimer(record, entry)));
  const tasks = new Map(), countedIds = new Set();
  for (const record of [...persisted, ...pending]) {
    if (!users.has(record?.user)) continue;
    const taskUrl = taskUrlOf(record), issue = record.issue ?? parseGitHubTaskUrl(taskUrl);
    const seconds = Number(record.durationSeconds);
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error('Invalid tracked task duration');
    const existing = tasks.get(taskUrl) ?? {
      taskUrl, ...(issue ? { issue } : {}), totalSeconds: 0, sessionCount: 0,
      destinationIds: new Set(), timeRepositories: new Set(),
    };
    const storedTitle = taskTitleOf(record);
    if (storedTitle) existing.title = storedTitle;
    if (record.destinationId) existing.destinationIds.add(record.destinationId);
    if (record.timeRepository) existing.timeRepositories.add(record.timeRepository);
    for (const destinationId of record.duplicateDestinations ?? []) existing.destinationIds.add(destinationId);
    for (const repository of record.duplicateTimeRepositories ?? []) existing.timeRepositories.add(repository);
    if (record.id && countedIds.has(record.id)) { tasks.set(taskUrl, existing); continue; }
    if (record.id) countedIds.add(record.id);
    existing.totalSeconds += seconds; existing.sessionCount += 1; tasks.set(taskUrl, existing);
  }
  if (users.has(active?.user)) {
    const taskUrl = taskUrlOf(active), issue = active.issue ?? parseGitHubTaskUrl(taskUrl), startedAt = new Date(active.startedAt);
    if (Number.isNaN(startedAt.getTime())) throw new Error('Invalid active task start time');
    const existing = tasks.get(taskUrl) ?? {
      taskUrl, ...(issue ? { issue } : {}), totalSeconds: 0, sessionCount: 0,
      destinationIds: new Set(), timeRepositories: new Set(),
    };
    if (active.destinationId) existing.destinationIds.add(active.destinationId);
    if (active.timeRepository) existing.timeRepositories.add(active.timeRepository);
    existing.activeStartedAt = startedAt.toISOString(); tasks.set(taskUrl, existing);
  }
  return [...tasks.values()].map(task => {
    const details = metadata.get(task.taskUrl);
    const title = task.title || (task.activeStartedAt && taskTitleOf(active)
      ? taskTitleOf(active)
      : (typeof details?.title === 'string' && details.title.trim() ? details.title.trim().slice(0, 300) : ''));
    return {
      taskUrl: task.taskUrl, ...(task.issue ? { issue: task.issue } : {}), title,
      totalSeconds: task.totalSeconds, sessionCount: task.sessionCount,
      ...(task.destinationIds.size ? { destinationIds: [...task.destinationIds].sort() } : {}),
      ...(task.timeRepositories.size ? { timeRepositories: [...task.timeRepositories].sort() } : {}),
      ...(task.activeStartedAt ? { activeStartedAt: task.activeStartedAt } : {}),
    };
  }).sort((a, b) => b.totalSeconds - a.totalSeconds || a.taskUrl.localeCompare(b.taskUrl));
}
