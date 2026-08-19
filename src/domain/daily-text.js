import { durationSeconds } from './records.js';
import { entryDateParts, normalizeIssue, parseIssueUrl, validatePathSegment } from './values.js';

const FIELD_RE = /^([A-Za-z]+):(?: (.*))?$/;
const ALLOWED_FIELDS = new Set(['URL', 'Start', 'End', 'Description']);

export function timestampWithTimezone(value) {
  if (typeof value !== 'string') throw new Error('Invalid timestamp with timezone');
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?(Z|([+-])(\d{2}):(\d{2}))$/);
  if (!match) throw new Error('Invalid timestamp with timezone');
  const [, y, mo, d, h, mi, s, ms = '000', zone, sign, oh = '00', om = '00'] = match;
  const year = Number(y), month = Number(mo), day = Number(d), hour = Number(h), minute = Number(mi), second = Number(s), millis = Number(ms);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59 || Number(oh) > 23 || Number(om) > 59) throw new Error('Invalid timestamp with timezone');
  const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > maxDay) throw new Error('Invalid timestamp with timezone');
  const offsetMinutes = zone === 'Z' ? 0 : (sign === '+' ? 1 : -1) * (Number(oh) * 60 + Number(om));
  const expected = Date.UTC(year, month - 1, day, hour, minute, second, millis) - offsetMinutes * 60_000;
  if (new Date(value).getTime() !== expected) throw new Error('Invalid timestamp with timezone');
  return value;
}

export function localTimestamp(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Invalid timestamp');
  const pad = (number, width = 2) => String(number).padStart(width, '0');
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const absolute = Math.abs(offset);
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${date.getMilliseconds() ? `.${pad(date.getMilliseconds(), 3)}` : ''}${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}

export function normalizePlainDescription(value) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, 2000);
}

export function activeTextPath(user) { return `active/${validatePathSegment(user, 'user')}.txt`; }
export function dailyTextPath(user, date) {
  entryDateParts(date);
  return `times/${date}/${validatePathSegment(user, 'user')}.txt`;
}

export function assertUserDailyTextPath(path, user) {
  const validatedUser = validatePathSegment(user, 'user');
  const match = typeof path === 'string' ? path.match(/^times\/(\d{4}-\d{2}-\d{2})\/([A-Za-z0-9-]+)\.txt$/) : null;
  if (!match || match[2] !== validatedUser) throw new Error('Invalid daily time path');
  entryDateParts(match[1]);
  return { path, date: match[1] };
}

function recordId(date, index) { return `${date.replaceAll('-', '')}${String(index).padStart(18, '0')}`; }

function parseBlock(block, { active = false } = {}) {
  const fields = new Map();
  for (const line of block.split('\n')) {
    const match = line.match(FIELD_RE);
    if (!match) throw new Error('Invalid time record line');
    const [, key, value = ''] = match;
    if (!ALLOWED_FIELDS.has(key)) throw new Error(`Unknown time record field: ${key}`);
    if (fields.has(key)) throw new Error(`Duplicate time record field: ${key}`);
    fields.set(key, value);
  }
  for (const required of active ? ['URL', 'Start'] : ['URL', 'Start', 'End']) {
    if (!fields.get(required)) throw new Error(`Missing time record field: ${required}`);
  }
  if (active && fields.has('End')) throw new Error('Active timer must not contain End');
  const issue = parseIssueUrl(fields.get('URL'));
  if (!issue) throw new Error('Invalid issue or pull request URL');
  const startedAt = timestampWithTimezone(fields.get('Start'));
  const endedAt = active ? null : timestampWithTimezone(fields.get('End'));
  const description = normalizePlainDescription(fields.get('Description') || '');
  if (active) return { issue, startedAt, description };
  durationSeconds(startedAt, endedAt);
  return { issue, startedAt, endedAt, description };
}

function splitBlocks(text) {
  const normalized = String(text ?? '').replace(/\r\n?/g, '\n').trim();
  if (!normalized) return [];
  return normalized.split(/\n{2,}/);
}

export function parseDailyText(text, { user, date, path = dailyTextPath(user, date), sha = null } = {}) {
  validatePathSegment(user, 'user'); entryDateParts(date);
  const pathDate = assertUserDailyTextPath(path, user).date;
  if (pathDate !== date) throw new Error(`Daily path date ${pathDate} does not match context date ${date}`);
  return splitBlocks(text).map((block, index) => {
    const record = parseBlock(block);
    if (record.startedAt.slice(0, 10) !== date) throw new Error(`Start date must match daily file date ${date}`);
    const createdAt = record.endedAt;
    return {
      schemaVersion: 1, id: recordId(date, index), user, issue: normalizeIssue(record.issue), entryDate: date,
      startedAt: record.startedAt, endedAt: record.endedAt, durationSeconds: durationSeconds(record.startedAt, record.endedAt),
      description: record.description, createdAt, updatedAt: createdAt,
      _path: path, _sha: sha, _index: index,
    };
  });
}

function serializeRecord(record, { active = false } = {}) {
  const issue = normalizeIssue(record.issue);
  const lines = [`URL: ${issue.url}`, `Start: ${timestampWithTimezone(record.startedAt)}`];
  if (!active) {
    timestampWithTimezone(record.endedAt);
    durationSeconds(record.startedAt, record.endedAt);
    lines.push(`End: ${record.endedAt}`);
  }
  const description = normalizePlainDescription(record.description);
  if (description) lines.push(`Description: ${description}`);
  return lines.join('\n');
}

export function serializeDailyText(entries) {
  if (!Array.isArray(entries)) throw new Error('Daily entries must be an array');
  return entries.length ? `${entries.map(entry => serializeRecord(entry)).join('\n\n')}\n` : '';
}

export function parseActiveText(text, { user, path = activeTextPath(user), sha = null } = {}) {
  validatePathSegment(user, 'user');
  if (path !== activeTextPath(user)) throw new Error('Invalid active timer path');
  const blocks = splitBlocks(text);
  if (blocks.length !== 1) throw new Error('Active timer file must contain exactly one timer');
  const record = parseBlock(blocks[0], { active: true });
  return {
    schemaVersion: 1, user, issue: normalizeIssue(record.issue), entryDate: record.startedAt.slice(0, 10),
    startedAt: record.startedAt, description: record.description, createdAt: record.startedAt,
    _path: path, _sha: sha,
  };
}

export function serializeActiveText(active) { return `${serializeRecord(active, { active: true })}\n`; }
