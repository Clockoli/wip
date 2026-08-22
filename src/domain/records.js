import { entryDateParts, entryDateValue, localDateParts, normalizeIssue, utcDateParts, validateEntryId, validatePathSegment } from './values.js';


function normalizeIssueTitle(value) {
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

export function buildActiveTimer({ user, issue, startedAt, entryId, description = '', issueTitle = '' }) {
  const started = toIso(startedAt);
  const normalized = {
    schemaVersion: 1,
    user: validatePathSegment(user, 'user'),
    issue: normalizeIssue(issue),
    ...(entryId ? { entryId: validateEntryId(entryId) } : {}),
    entryDate: entryDateValue(localDateParts(new Date(started))),
    startedAt: started,
    description: String(description ?? '').slice(0, 2000),
    createdAt: started,
  };
  normalized.issueTitle = normalizeIssueTitle(issueTitle);
  return normalized;
}


export function validateActiveTimer(active) {
  if (!active || active.schemaVersion !== 1) throw new Error('Unsupported active timer schema');
  validatePathSegment(active.user, 'user');
  normalizeIssue(active.issue);
  if (active.entryId !== undefined) validateEntryId(active.entryId);
  if (active.entryDate !== undefined) entryDateParts(active.entryDate);
  validateTimestamp(active.startedAt, 'startedAt timestamp');
  validateTimestamp(active.createdAt, 'createdAt timestamp');
  if (new Date(active.createdAt).getTime() !== new Date(active.startedAt).getTime()) throw new Error('Active timer createdAt must equal startedAt');
  if (typeof active.description !== 'string' || active.description.length > 2000) throw new Error('Invalid active timer description');
  if (active.issueTitle !== undefined && (typeof active.issueTitle !== 'string' || active.issueTitle !== normalizeIssueTitle(active.issueTitle))) throw new Error('Invalid active timer task title');
  return active;
}

export function buildEntry({ active, id, endedAt, now = endedAt, description = active?.description ?? '' }) {
  if (!active) throw new Error('No active timer');
  const started = toIso(active.startedAt);
  const ended = toIso(endedAt);
  const created = toIso(now);
  return {
    schemaVersion: 1,
    id: validateEntryId(id),
    user: validatePathSegment(active.user, 'user'),
    issue: normalizeIssue(active.issue),
    entryDate: active.entryDate ?? entryDateValue(utcDateParts(new Date(started))),
    startedAt: started,
    endedAt: ended,
    durationSeconds: durationSeconds(started, ended),
    description: String(description ?? '').slice(0, 2000),
    createdAt: created,
    updatedAt: created,
    issueTitle: normalizeIssueTitle(active.issueTitle),
  };
}

export function validateEntry(entry) {
  if (!entry || entry.schemaVersion !== 1) throw new Error('Unsupported time entry schema');
  validateEntryId(entry.id);
  validatePathSegment(entry.user, 'user');
  normalizeIssue(entry.issue);
  if (entry.entryDate !== undefined) entryDateParts(entry.entryDate);
  validateTimestamp(entry.startedAt, 'startedAt timestamp');
  validateTimestamp(entry.endedAt, 'endedAt timestamp');
  validateTimestamp(entry.createdAt, 'createdAt timestamp');
  validateTimestamp(entry.updatedAt, 'updatedAt timestamp');
  const computed = durationSeconds(entry.startedAt, entry.endedAt);
  if (!Number.isInteger(entry.durationSeconds) || entry.durationSeconds !== computed) throw new Error('Duration does not match timestamps');
  if (new Date(entry.updatedAt).getTime() < new Date(entry.createdAt).getTime()) throw new Error('updatedAt must not be before createdAt');
  if (typeof entry.description !== 'string' || entry.description.length > 2000) throw new Error('Invalid description');
  if (entry.issueTitle !== undefined && (typeof entry.issueTitle !== 'string' || entry.issueTitle !== normalizeIssueTitle(entry.issueTitle))) throw new Error('Invalid task title');
  return entry;
}

export function applyEntryEdits(entry, edits, now = new Date()) {
  validateEntry(entry);
  const issue = normalizeIssue(edits.issue ?? entry.issue);
  const next = {
    ...entry,
    entryDate: entry.entryDate ?? entryDateValue(utcDateParts(new Date(entry.startedAt))),
    issue,
    issueTitle: normalizeIssueTitle(edits.issueTitle ?? (issue.url === entry.issue.url ? entry.issueTitle : '')),
    startedAt: toIso(edits.startedAt ?? entry.startedAt),
    endedAt: toIso(edits.endedAt ?? entry.endedAt),
    description: String(edits.description ?? entry.description).slice(0, 2000),
    updatedAt: toIso(now),
  };
  next.durationSeconds = durationSeconds(next.startedAt, next.endedAt);
  return validateEntry(next);
}
