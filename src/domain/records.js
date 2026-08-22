import { entryDateParts, entryDateValue, localDateParts, normalizeTaskUrl, parseGitHubTaskUrl, taskUrlOf, utcDateParts, validateEntryId, validatePathSegment } from './values.js';


export function normalizeTaskTitle(value) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, 300);
}

export function toIso(value) {
  if (typeof value === 'string') {
    validateTimestamp(value);
    return value;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Invalid timestamp');
  const pad = (number, width = 2) => String(number).padStart(width, '0');
  const offset = -date.getTimezoneOffset(), sign = offset >= 0 ? '+' : '-', absolute = Math.abs(offset);
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${date.getMilliseconds() ? `.${pad(date.getMilliseconds(), 3)}` : ''}${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}

function validateTimestamp(value, label = 'timestamp') {
  const match = typeof value === 'string' ? value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?(Z|[+-]\d{2}:\d{2})$/) : null;
  if (!match) throw new Error(`Invalid ${label} with timezone`);
  const [, year, month, day, hour, minute, second] = match;
  const maxDay = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > maxDay || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) throw new Error(`Invalid ${label} with timezone`);
  if (Number.isNaN(new Date(value).getTime())) throw new Error(`Invalid ${label} with timezone`);
  return value;
}

export function durationSeconds(startedAt, endedAt) {
  const start = new Date(startedAt).getTime();
  const end = new Date(endedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) throw new Error('Invalid timestamp');
  if (end < start) throw new Error('End time must not be before start time');
  return Math.floor((end - start) / 1000);
}

export function buildActiveTimer({ user, taskUrl, taskTitle = '', issue, issueTitle = '', startedAt, entryId, description = '' }) {
  const started = toIso(startedAt);
  return {
    schemaVersion: 1,
    user: validatePathSegment(user, 'user'),
    taskUrl: normalizeTaskUrl(taskUrl ?? issue),
    taskTitle: normalizeTaskTitle(taskTitle || issueTitle),
    issueTitle: normalizeTaskTitle(taskTitle || issueTitle),
    ...(parseGitHubTaskUrl(taskUrl ?? issue) ? { issue: parseGitHubTaskUrl(taskUrl ?? issue) } : {}),
    ...(entryId ? { entryId: validateEntryId(entryId) } : {}),
    entryDate: entryDateValue(localDateParts(new Date(started))),
    startedAt: started,
    description: String(description ?? '').slice(0, 2000),
    createdAt: started,
  };
}

export function validateActiveTimer(active) {
  if (!active || active.schemaVersion !== 1) throw new Error('Unsupported active timer schema');
  validatePathSegment(active.user, 'user');
  taskUrlOf(active);
  if (active.entryId !== undefined) validateEntryId(active.entryId);
  if (active.entryDate !== undefined) entryDateParts(active.entryDate);
  validateTimestamp(active.startedAt, 'startedAt timestamp');
  validateTimestamp(active.createdAt, 'createdAt timestamp');
  if (new Date(active.createdAt).getTime() !== new Date(active.startedAt).getTime()) throw new Error('Active timer createdAt must equal startedAt');
  if (typeof active.description !== 'string' || active.description.length > 2000) throw new Error('Invalid active timer description');
  const taskTitle = active.taskTitle ?? active.issueTitle;
  if (taskTitle !== undefined && (typeof taskTitle !== 'string' || taskTitle !== normalizeTaskTitle(taskTitle))) throw new Error('Invalid active timer task title');
  return active;
}

export function buildEntry({ active, id, endedAt, now = endedAt, description = active?.description ?? '' }) {
  if (!active) throw new Error('No active timer');
  const started = toIso(active.startedAt), ended = toIso(endedAt), created = toIso(now);
  return {
    schemaVersion: 1,
    id: validateEntryId(id),
    user: validatePathSegment(active.user, 'user'),
    taskUrl: taskUrlOf(active),
    taskTitle: normalizeTaskTitle(active.taskTitle ?? active.issueTitle),
    issueTitle: normalizeTaskTitle(active.taskTitle ?? active.issueTitle),
    ...(parseGitHubTaskUrl(taskUrlOf(active)) ? { issue: parseGitHubTaskUrl(taskUrlOf(active)) } : {}),
    entryDate: active.entryDate ?? entryDateValue(utcDateParts(new Date(started))),
    startedAt: started,
    endedAt: ended,
    durationSeconds: durationSeconds(started, ended),
    description: String(description ?? '').slice(0, 2000),
    createdAt: created,
    updatedAt: created,
  };
}

export function validateEntry(entry) {
  if (!entry || entry.schemaVersion !== 1) throw new Error('Unsupported time entry schema');
  validateEntryId(entry.id);
  validatePathSegment(entry.user, 'user');
  taskUrlOf(entry);
  if (entry.entryDate !== undefined) entryDateParts(entry.entryDate);
  validateTimestamp(entry.startedAt, 'startedAt timestamp');
  validateTimestamp(entry.endedAt, 'endedAt timestamp');
  validateTimestamp(entry.createdAt, 'createdAt timestamp');
  validateTimestamp(entry.updatedAt, 'updatedAt timestamp');
  const computed = durationSeconds(entry.startedAt, entry.endedAt);
  if (!Number.isInteger(entry.durationSeconds) || entry.durationSeconds !== computed) throw new Error('Duration does not match timestamps');
  if (new Date(entry.updatedAt).getTime() < new Date(entry.createdAt).getTime()) throw new Error('updatedAt must not be before createdAt');
  if (typeof entry.description !== 'string' || entry.description.length > 2000) throw new Error('Invalid description');
  const taskTitle = entry.taskTitle ?? entry.issueTitle;
  if (taskTitle !== undefined && (typeof taskTitle !== 'string' || taskTitle !== normalizeTaskTitle(taskTitle))) throw new Error('Invalid task title');
  return entry;
}

export function applyEntryEdits(entry, edits, now = new Date()) {
  validateEntry(entry);
  const currentTaskUrl = taskUrlOf(entry), taskUrl = normalizeTaskUrl(edits.taskUrl ?? edits.issue ?? currentTaskUrl);
  const { issue: _legacyIssue, issueTitle: _legacyTitle, taskUrl: _oldTaskUrl, taskTitle: _oldTaskTitle, ...base } = entry;
  const next = {
    ...base,
    entryDate: entry.entryDate ?? entryDateValue(utcDateParts(new Date(entry.startedAt))),
    taskUrl,
    taskTitle: normalizeTaskTitle(edits.taskTitle ?? edits.issueTitle ?? (taskUrl === currentTaskUrl ? (entry.taskTitle ?? entry.issueTitle) : '')),
    issueTitle: normalizeTaskTitle(edits.taskTitle ?? edits.issueTitle ?? (taskUrl === currentTaskUrl ? (entry.taskTitle ?? entry.issueTitle) : '')),
    ...(parseGitHubTaskUrl(taskUrl) ? { issue: parseGitHubTaskUrl(taskUrl) } : {}),
    startedAt: toIso(edits.startedAt ?? entry.startedAt),
    endedAt: toIso(edits.endedAt ?? entry.endedAt),
    description: String(edits.description ?? entry.description).slice(0, 2000),
    updatedAt: toIso(now),
  };
  next.durationSeconds = durationSeconds(next.startedAt, next.endedAt);
  return validateEntry(next);
}
