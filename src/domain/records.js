import { entryDateParts, entryDateValue, localDateParts, normalizeIssue, utcDateParts, validateEntryId, validatePathSegment } from './values.js';

export function toIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Invalid timestamp');
  return date.toISOString();
}


function validateUtcTimestamp(value, label = 'timestamp') {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) throw new Error(`Invalid UTC ${label}`);
  const parsed = new Date(value);
  const canonical = value.includes('.') ? value : value.replace(/Z$/, '.000Z');
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== canonical) throw new Error(`Invalid UTC ${label}`);
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
  if (issueTitle) normalized.issueTitle = String(issueTitle).slice(0, 300);
  return normalized;
}


export function validateActiveTimer(active) {
  if (!active || active.schemaVersion !== 1) throw new Error('Unsupported active timer schema');
  validatePathSegment(active.user, 'user');
  normalizeIssue(active.issue);
  if (active.entryId !== undefined) validateEntryId(active.entryId);
  if (active.entryDate !== undefined) entryDateParts(active.entryDate);
  validateUtcTimestamp(active.startedAt, 'startedAt timestamp');
  validateUtcTimestamp(active.createdAt, 'createdAt timestamp');
  if (new Date(active.createdAt).getTime() !== new Date(active.startedAt).getTime()) throw new Error('Active timer createdAt must equal startedAt');
  if (typeof active.description !== 'string' || active.description.length > 2000) throw new Error('Invalid active timer description');
  if (active.issueTitle !== undefined && (typeof active.issueTitle !== 'string' || active.issueTitle.length > 300)) throw new Error('Invalid active timer issue title');
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
    ...(active.issueTitle ? { issueTitle: String(active.issueTitle).slice(0, 300) } : {}),
  };
}

export function validateEntry(entry) {
  if (!entry || entry.schemaVersion !== 1) throw new Error('Unsupported time entry schema');
  validateEntryId(entry.id);
  validatePathSegment(entry.user, 'user');
  normalizeIssue(entry.issue);
  if (entry.entryDate !== undefined) entryDateParts(entry.entryDate);
  validateUtcTimestamp(entry.startedAt, 'startedAt timestamp');
  validateUtcTimestamp(entry.endedAt, 'endedAt timestamp');
  validateUtcTimestamp(entry.createdAt, 'createdAt timestamp');
  validateUtcTimestamp(entry.updatedAt, 'updatedAt timestamp');
  const computed = durationSeconds(entry.startedAt, entry.endedAt);
  if (!Number.isInteger(entry.durationSeconds) || entry.durationSeconds !== computed) throw new Error('Duration does not match timestamps');
  if (new Date(entry.updatedAt).getTime() < new Date(entry.createdAt).getTime()) throw new Error('updatedAt must not be before createdAt');
  if (typeof entry.description !== 'string' || entry.description.length > 2000) throw new Error('Invalid description');
  if (entry.issueTitle !== undefined && (typeof entry.issueTitle !== 'string' || entry.issueTitle.length > 300)) throw new Error('Invalid issue title');
  return entry;
}

export function applyEntryEdits(entry, edits, now = new Date()) {
  validateEntry(entry);
  const next = {
    ...entry,
    entryDate: entry.entryDate ?? entryDateValue(utcDateParts(new Date(entry.startedAt))),
    issue: normalizeIssue(edits.issue ?? entry.issue),
    startedAt: toIso(edits.startedAt ?? entry.startedAt),
    endedAt: toIso(edits.endedAt ?? entry.endedAt),
    description: String(edits.description ?? entry.description).slice(0, 2000),
    updatedAt: toIso(now),
  };
  next.durationSeconds = durationSeconds(next.startedAt, next.endedAt);
  return validateEntry(next);
}
