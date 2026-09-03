import {
  entryDateParts, entryDateValue, localDateParts, normalizeTaskUrl, parseGitHubTaskUrl,
  taskUrlOf, validateEntryId, validatePathSegment,
} from './values.js';
import { createUlid } from './ulid.js';

export const DEFAULT_PRODUCER = Object.freeze({
  kind: 'browser_extension', name: 'clockoli-chrome', version: '0.1.30',
});

export function normalizeTaskTitle(value) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, 300);
}

export function validateTimestamp(value, label = 'timestamp') {
  const match = typeof value === 'string' ? value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/) : null;
  if (!match) throw new Error(`Invalid ${label} with timezone`);
  const [, year, month, day, hour, minute, second] = match;
  const maxDay = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > maxDay
      || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59
      || Number.isNaN(new Date(value).getTime())) throw new Error(`Invalid ${label} with timezone`);
  return value;
}

export function toIso(value) {
  if (typeof value === 'string') validateTimestamp(value);
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Invalid timestamp');
  return date.toISOString();
}

export function normalizeTimezone(value) {
  const timezone = value === undefined ? (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC') : value;
  if (typeof timezone !== 'string' || !timezone || timezone !== timezone.trim()) throw new Error('Invalid IANA timezone');
  try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date(0)); }
  catch { throw new Error('Invalid IANA timezone'); }
  return timezone;
}

export function localDateInTimezone(value, timezone) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Invalid timestamp');
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: normalizeTimezone(timezone), year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return entryDateValue({ year: parts.year, month: parts.month, day: parts.day });
}

export function durationSeconds(startedAt, endedAt) {
  const start = new Date(startedAt).getTime(), end = new Date(endedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) throw new Error('Invalid timestamp');
  if (end < start) throw new Error('End time must not be before start time');
  return Math.floor((end - start) / 1000);
}

function validateNamedIdentity(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || !['kind', 'id', 'name'].every(key => typeof value[key] === 'string' && value[key].trim())) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function validateProducer(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || !['kind', 'name', 'version'].every(key => typeof value[key] === 'string' && value[key].trim())) {
    throw new Error('Invalid producer');
  }
  return value;
}

function actorValue(user, actor) {
  return structuredClone(actor ?? { kind: 'human', id: `clockoli-user:${user}`, name: user });
}

function producerValue(producer) { return structuredClone(producer ?? DEFAULT_PRODUCER); }

export function buildActiveTimer({
  user, id, entryId, actor, producer, taskUrl, taskTitle = '', issue, issueTitle = '', startedAt,
  entryDate, timezone, description = '', metadata = {}, metrics = {}, execution,
}) {
  const validUser = validatePathSegment(user, 'user'), started = toIso(startedAt);
  const zone = normalizeTimezone(timezone), date = entryDate ?? localDateInTimezone(started, zone);
  entryDateParts(date);
  const recordId = validateEntryId(id ?? entryId ?? createUlid(new Date(started).getTime()));
  const url = normalizeTaskUrl(taskUrl ?? issue), title = normalizeTaskTitle(taskTitle || issueTitle);
  return {
    schemaVersion: 1,
    id: recordId,
    entryId: recordId,
    user: validUser,
    actor: actorValue(validUser, actor),
    producer: producerValue(producer),
    taskUrl: url,
    taskTitle: title,
    issueTitle: title,
    ...(parseGitHubTaskUrl(url) ? { issue: parseGitHubTaskUrl(url) } : {}),
    entryDate: date,
    timezone: zone,
    startedAt: started,
    description: String(description ?? '').slice(0, 2000),
    metadata: structuredClone(metadata ?? {}),
    metrics: structuredClone(metrics ?? {}),
    ...(execution === undefined ? {} : { execution: structuredClone(execution) }),
    createdAt: started,
    updatedAt: started,
  };
}

export function validateActiveTimer(active) {
  if (!active || active.schemaVersion !== 1) throw new Error('Unsupported active timer schema');
  validateEntryId(active.id);
  if (active.entryId !== undefined && active.entryId !== active.id) throw new Error('Active timer identity does not match record ID');
  validatePathSegment(active.user, 'user');
  validateNamedIdentity(active.actor, 'actor');
  validateProducer(active.producer);
  taskUrlOf(active);
  entryDateParts(active.entryDate);
  normalizeTimezone(active.timezone);
  validateTimestamp(active.startedAt, 'startedAt timestamp');
  validateTimestamp(active.createdAt, 'createdAt timestamp');
  validateTimestamp(active.updatedAt ?? active.createdAt, 'updatedAt timestamp');
  if (new Date(active.createdAt).getTime() !== new Date(active.startedAt).getTime()) throw new Error('Active timer createdAt must equal startedAt');
  if (typeof active.description !== 'string' || active.description.length > 2000) throw new Error('Invalid active timer description');
  if (!active.metadata || typeof active.metadata !== 'object' || Array.isArray(active.metadata)) throw new Error('Invalid active timer metadata');
  if (!active.metrics || typeof active.metrics !== 'object' || Array.isArray(active.metrics)) throw new Error('Invalid active timer metrics');
  const title = active.taskTitle ?? active.issueTitle;
  if (typeof title !== 'string' || title !== normalizeTaskTitle(title)) throw new Error('Invalid active timer task title');
  return active;
}

export function buildEntry({ active, id = active?.id, endedAt, now = endedAt, description = active?.description ?? '' }) {
  if (!active) throw new Error('No active timer');
  validateActiveTimer(active);
  if (id !== active.id) throw new Error('Completed record ID must match the active timer ID');
  const ended = toIso(endedAt), updated = toIso(now);
  return {
    ...active,
    id: validateEntryId(active.id),
    entryId: active.id,
    endedAt: ended,
    durationSeconds: durationSeconds(active.startedAt, ended),
    description: String(description ?? '').slice(0, 2000),
    createdAt: active.createdAt,
    updatedAt: updated,
  };
}

export function validateEntry(entry) {
  if (!entry || entry.schemaVersion !== 1) throw new Error('Unsupported time entry schema');
  validateEntryId(entry.id);
  if (entry.entryId !== undefined && entry.entryId !== entry.id) throw new Error('Entry identity does not match record ID');
  validatePathSegment(entry.user, 'user');
  validateNamedIdentity(entry.actor, 'actor');
  validateProducer(entry.producer);
  taskUrlOf(entry);
  entryDateParts(entry.entryDate);
  normalizeTimezone(entry.timezone);
  validateTimestamp(entry.startedAt, 'startedAt timestamp');
  validateTimestamp(entry.endedAt, 'endedAt timestamp');
  validateTimestamp(entry.createdAt, 'createdAt timestamp');
  validateTimestamp(entry.updatedAt, 'updatedAt timestamp');
  const computed = durationSeconds(entry.startedAt, entry.endedAt);
  if (!Number.isInteger(entry.durationSeconds) || entry.durationSeconds !== computed) throw new Error('Duration does not match timestamps');
  if (new Date(entry.updatedAt).getTime() < new Date(entry.createdAt).getTime()) throw new Error('updatedAt must not be before createdAt');
  if (typeof entry.description !== 'string' || entry.description.length > 2000) throw new Error('Invalid description');
  if (!entry.metadata || typeof entry.metadata !== 'object' || Array.isArray(entry.metadata)) throw new Error('Invalid metadata');
  if (!entry.metrics || typeof entry.metrics !== 'object' || Array.isArray(entry.metrics)) throw new Error('Invalid metrics');
  const title = entry.taskTitle ?? entry.issueTitle;
  if (typeof title !== 'string' || title !== normalizeTaskTitle(title)) throw new Error('Invalid task title');
  return entry;
}

export function applyActiveStartEdit(active, startedAt, now = new Date()) {
  validateActiveTimer(active);
  const nextStart = toIso(startedAt), updatedAt = toIso(now);
  if (new Date(nextStart).getTime() > new Date(updatedAt).getTime()) throw new Error('Active timer start must not be in the future');
  return validateActiveTimer({
    ...active,
    entryDate: localDateInTimezone(nextStart, active.timezone),
    startedAt: nextStart,
    createdAt: nextStart,
    updatedAt,
  });
}

export function applyEntryEdits(entry, edits, now = new Date()) {
  validateEntry(entry);
  const currentUrl = taskUrlOf(entry), taskUrl = normalizeTaskUrl(edits.taskUrl ?? edits.issue ?? currentUrl);
  const startedAt = toIso(edits.startedAt ?? entry.startedAt), timezone = normalizeTimezone(edits.timezone ?? entry.timezone);
  const { issue: _issue, issueTitle: _issueTitle, taskUrl: _taskUrl, taskTitle: _taskTitle, ...base } = entry;
  const metadata = structuredClone(entry.metadata);
  if (taskUrl !== currentUrl) delete metadata.github;
  const title = normalizeTaskTitle(edits.taskTitle ?? edits.issueTitle ?? (taskUrl === currentUrl ? (entry.taskTitle ?? entry.issueTitle) : ''));
  const next = {
    ...base,
    metadata,
    taskUrl,
    taskTitle: title,
    issueTitle: title,
    ...(parseGitHubTaskUrl(taskUrl) ? { issue: parseGitHubTaskUrl(taskUrl) } : {}),
    entryDate: edits.entryDate ?? (startedAt === entry.startedAt ? entry.entryDate : localDateInTimezone(startedAt, timezone)),
    timezone,
    startedAt,
    endedAt: toIso(edits.endedAt ?? entry.endedAt),
    description: String(edits.description ?? entry.description).slice(0, 2000),
    updatedAt: toIso(now),
  };
  next.durationSeconds = durationSeconds(next.startedAt, next.endedAt);
  return validateEntry(next);
}
