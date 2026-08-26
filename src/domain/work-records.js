import {
  durationSeconds, normalizeTaskTitle, normalizeTimezone, toIso, validateActiveTimer,
  validateEntry, validateTimestamp,
} from './records.js';
import {
  entryDateParts, normalizeTaskUrl, parseGitHubTaskUrl, taskUrlOf, validateEntryId, validatePathSegment,
} from './values.js';

const MONTH_PATH = /^times\/(\d{4}-(?:0[1-9]|1[0-2]))\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)\.jsonl$/;
const ACTIVE_PATH = /^active\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)\.json$/;
const AGGREGATIONS = new Set(['sum', 'max', 'min', 'last', 'none']);

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${label}`);
  return value;
}

function nonEmpty(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid ${label}`);
  return value;
}

function clone(value) { return structuredClone(value); }

function validateUtc(value, label) {
  validateTimestamp(value, label);
  if (!value.endsWith('Z')) throw new Error(`${label} must be a UTC timestamp`);
  return value;
}

function validateMetrics(metrics) {
  object(metrics, 'metrics');
  for (const [name, metric] of Object.entries(metrics)) {
    if (!/^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/.test(name)) throw new Error(`Invalid metric name: ${name}`);
    object(metric, `metric ${name}`);
    if (!Object.hasOwn(metric, 'value') || !['string', 'number'].includes(typeof metric.value)
        || (typeof metric.value === 'number' && !Number.isFinite(metric.value))) throw new Error(`Invalid metric value: ${name}`);
    nonEmpty(metric.unit, `metric unit: ${name}`);
    if (!AGGREGATIONS.has(metric.aggregation)) throw new Error(`Invalid metric aggregation: ${name}`);
    nonEmpty(metric.source, `metric source: ${name}`);
  }
}

function validateExecution(execution) {
  if (execution === undefined) return;
  object(execution, 'execution');
  nonEmpty(execution.id, 'execution ID');
  if (execution.session_id !== undefined && typeof execution.session_id !== 'string') throw new Error('Invalid execution session ID');
  if (execution.parent_id !== undefined && execution.parent_id !== null && typeof execution.parent_id !== 'string') throw new Error('Invalid execution parent ID');
  if (execution.attempt !== undefined && (!Number.isSafeInteger(execution.attempt) || execution.attempt <= 0)) throw new Error('Invalid execution attempt');
}

function validateStoredRecord(record, expectedState) {
  object(record, 'work record');
  if (record.schema_version !== 1) throw new Error('Unsupported work record schema');
  validateEntryId(record.id);
  if (record.record_type !== 'work') throw new Error('Unsupported record type');

  const actor = object(record.actor, 'actor');
  nonEmpty(actor.kind, 'actor kind'); nonEmpty(actor.id, 'actor ID'); nonEmpty(actor.name, 'actor name');

  const item = object(record.work_item, 'work item');
  nonEmpty(item.kind, 'work item kind'); nonEmpty(item.id, 'work item ID');
  const taskUrl = normalizeTaskUrl(item.url);
  if (item.url !== taskUrl) throw new Error('Work item URL is not canonical');
  if (typeof item.title !== 'string' || item.title !== normalizeTaskTitle(item.title)) throw new Error('Invalid work item title');

  const activity = object(record.activity, 'activity');
  if (!['running', 'completed'].includes(activity.state)) throw new Error('Invalid activity state');
  if (expectedState && activity.state !== expectedState) throw new Error(`${expectedState === 'running' ? 'Active' : 'Monthly'} storage requires a ${expectedState} record`);
  validateUtc(activity.started_at, 'activity started_at');
  entryDateParts(activity.local_date);
  nonEmpty(activity.timezone, 'activity timezone');
  normalizeTimezone(activity.timezone);
  if (activity.state === 'running') {
    if (activity.ended_at !== null) throw new Error('Running activity ended_at must be null');
  } else {
    validateUtc(activity.ended_at, 'activity ended_at');
    durationSeconds(activity.started_at, activity.ended_at);
  }

  const producer = object(record.producer, 'producer');
  nonEmpty(producer.kind, 'producer kind'); nonEmpty(producer.name, 'producer name'); nonEmpty(producer.version, 'producer version');
  if (typeof record.description !== 'string' || record.description.length > 2000) throw new Error('Invalid description');
  object(record.metadata, 'metadata');
  validateMetrics(record.metrics);
  validateExecution(record.execution);
  validateUtc(record.created_at, 'created_at');
  validateUtc(record.updated_at, 'updated_at');
  if (new Date(record.updated_at) < new Date(record.created_at)) throw new Error('updated_at must not be before created_at');
  return record;
}

function workItemKind(taskUrl) {
  const github = parseGitHubTaskUrl(taskUrl);
  if (github?.type === 'issue') return 'github_issue';
  if (github?.type === 'pull_request') return 'github_pr';
  return 'url';
}

function toStoredRecord(runtime, state) {
  if (state === 'running') validateActiveTimer(runtime); else validateEntry(runtime);
  const base = runtime._record ? clone(runtime._record) : {};
  const taskUrl = normalizeTaskUrl(taskUrlOf(runtime));
  const previousUrl = base.work_item?.url;
  const sameItem = previousUrl === taskUrl;
  const title = normalizeTaskTitle(runtime.taskTitle ?? runtime.issueTitle);
  const record = {
    ...base,
    schema_version: 1,
    id: runtime.id,
    record_type: 'work',
    actor: { ...(base.actor ?? {}), ...clone(runtime.actor) },
    work_item: {
      ...(base.work_item ?? {}),
      kind: sameItem && base.work_item?.kind ? base.work_item.kind : workItemKind(taskUrl),
      id: sameItem && base.work_item?.id ? base.work_item.id : `url:${taskUrl}`,
      url: taskUrl,
      title,
    },
    activity: {
      ...(base.activity ?? {}),
      state,
      started_at: toIso(runtime.startedAt),
      ended_at: state === 'running' ? null : toIso(runtime.endedAt),
      local_date: runtime.entryDate,
      timezone: normalizeTimezone(runtime.timezone),
    },
    producer: { ...(base.producer ?? {}), ...clone(runtime.producer) },
    description: runtime.description,
    metadata: clone(runtime.metadata),
    metrics: clone(runtime.metrics),
    created_at: toIso(runtime.createdAt),
    updated_at: toIso(runtime.updatedAt ?? runtime.createdAt),
  };
  if (runtime.execution !== undefined) record.execution = clone(runtime.execution);
  validateStoredRecord(record, state);
  return record;
}

function fromStoredRecord(stored, { user, path, sha, index } = {}) {
  const record = clone(stored), taskUrl = normalizeTaskUrl(record.work_item.url);
  if (user !== undefined && record.actor.name !== user) throw new Error('Record actor does not match storage user');
  const title = normalizeTaskTitle(record.work_item.title), github = parseGitHubTaskUrl(taskUrl);
  const runtime = {
    schemaVersion: 1,
    id: record.id,
    entryId: record.id,
    user: validatePathSegment(user ?? record.actor.name, 'user'),
    actor: clone(record.actor),
    producer: clone(record.producer),
    taskUrl,
    taskTitle: title,
    issueTitle: title,
    ...(github ? { issue: github } : {}),
    entryDate: record.activity.local_date,
    timezone: record.activity.timezone,
    startedAt: record.activity.started_at,
    description: record.description,
    metadata: clone(record.metadata),
    metrics: clone(record.metrics),
    ...(record.execution === undefined ? {} : { execution: clone(record.execution) }),
    createdAt: record.created_at,
    updatedAt: record.updated_at,
    _record: record,
    ...(path ? { _path: path } : {}),
    ...(sha ? { _sha: sha } : {}),
    ...(index === undefined ? {} : { _index: index }),
  };
  if (record.activity.state === 'completed') {
    runtime.endedAt = record.activity.ended_at;
    runtime.durationSeconds = durationSeconds(runtime.startedAt, runtime.endedAt);
    return validateEntry(runtime);
  }
  return validateActiveTimer(runtime);
}

export function monthlyRecordsPath(user, entryDate) {
  validatePathSegment(user, 'user');
  const { year, month } = entryDateParts(entryDate);
  return `times/${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}/${user}.jsonl`;
}

export function activeRecordPath(user) {
  validatePathSegment(user, 'user');
  return `active/${user}.json`;
}

export function parseMonthlyRecordsPath(path) {
  const match = typeof path === 'string' ? path.match(MONTH_PATH) : null;
  if (!match) throw new Error('Invalid monthly records path');
  return { path, month: match[1], user: match[2] };
}

export function assertUserMonthlyRecordsPath(path, user) {
  const parsed = parseMonthlyRecordsPath(path);
  if (parsed.user !== validatePathSegment(user, 'user')) throw new Error('Invalid monthly records path');
  return { path, month: parsed.month };
}

export function parseActiveRecordPath(path) {
  const match = typeof path === 'string' ? path.match(ACTIVE_PATH) : null;
  if (!match) throw new Error('Invalid active record path');
  return { path, user: match[1] };
}

export function serializeActiveRecord(active) {
  return `${JSON.stringify(toStoredRecord(active, 'running'), null, 2)}\n`;
}

export function parseActiveRecord(text, context = {}) {
  const value = String(text);
  if (!value.endsWith('}\n')) throw new Error('Active JSON must end with exactly one newline');
  let stored;
  try { stored = JSON.parse(value); }
  catch { throw new Error('Active work record is not valid JSON'); }
  validateStoredRecord(stored, 'running');
  let user = context.user;
  if (context.path) {
    const parsed = parseActiveRecordPath(context.path);
    if (user && parsed.user !== user) throw new Error('Active path user does not match context user');
    user = parsed.user;
  }
  return fromStoredRecord(stored, { ...context, user });
}

export function serializeMonthlyRecords(entries) {
  const ids = new Set();
  const lines = entries.map(entry => {
    const stored = toStoredRecord(entry, 'completed');
    if (ids.has(stored.id)) throw new Error(`Duplicate work record ID: ${stored.id}`);
    ids.add(stored.id);
    return JSON.stringify(stored);
  });
  return lines.length ? `${lines.join('\n')}\n` : '';
}

export function parseMonthlyRecords(text, context = {}) {
  const value = String(text);
  if (!value) return [];
  if (!value.endsWith('\n')) throw new Error('Monthly JSONL must end with a newline');
  const lines = value.split('\n');
  if (lines.at(-1) === '') lines.pop();
  if (lines.some(line => !line.trim())) throw new Error('Monthly JSONL must not contain blank lines');
  let pathContext = null;
  if (context.path) {
    pathContext = parseMonthlyRecordsPath(context.path);
    if (context.month && pathContext.month !== context.month) throw new Error('Monthly path month does not match context month');
    if (context.user && pathContext.user !== context.user) throw new Error('Monthly path user does not match context user');
  }
  const month = pathContext?.month ?? context.month;
  const user = pathContext?.user ?? context.user;
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month ?? '')) throw new Error('Monthly records context requires a valid month');
  const ids = new Set();
  return lines.map((line, index) => {
    let stored;
    try { stored = JSON.parse(line); }
    catch { throw new Error(`Monthly record line ${index + 1} is not valid JSON`); }
    validateStoredRecord(stored, 'completed');
    if (stored.activity.local_date.slice(0, 7) !== month) throw new Error(`Record line ${index + 1} does not match monthly partition ${month}`);
    if (ids.has(stored.id)) throw new Error(`Duplicate work record ID: ${stored.id}`);
    ids.add(stored.id);
    return fromStoredRecord(stored, { ...context, user, index });
  });
}

export const timestampWithTimezone = validateTimestamp;
export const normalizePlainTitle = normalizeTaskTitle;

export function localTimestamp(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Invalid timestamp');
  const pad = (number, width = 2) => String(number).padStart(width, '0');
  const offset = -date.getTimezoneOffset(), sign = offset >= 0 ? '+' : '-', absolute = Math.abs(offset);
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
    + `${date.getMilliseconds() ? `.${pad(date.getMilliseconds(), 3)}` : ''}`
    + `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}
