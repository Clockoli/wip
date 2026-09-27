// This boundary accepts only the observed Clockify Detailed Report result shape.
// It deliberately does not accept request metadata, credentials, or inferred pagination.
const REPORT_KEYS = new Set(['timeentries', 'totals']);
const ENTRY_KEYS = new Set([
  '_id', 'approvalRequestId', 'billable', 'clientId', 'clientName', 'currency',
  'description', 'isLocked', 'projectColor', 'projectId', 'projectName', 'tagIds',
  'tags', 'taskId', 'taskName', 'timeInterval', 'type', 'userEmail', 'userId', 'userName',
]);
const INTERVAL_KEYS = new Set(['duration', 'end', 'offEnd', 'offStart', 'start', 'timeZone', 'zonedEnd', 'zonedStart']);
const TAG_KEYS = new Set(['_id', 'name']);
const TOTAL_KEYS = new Set(['_id', 'amounts', 'entriesCount', 'numOfCurrencies', 'totalAmount', 'totalAmountByCurrency', 'totalBillableTime', 'totalTime']);
const CREDENTIAL_KEY = /(?:authorization|credential|cookie|password|secret|token|api[_-]?key|session|header)/i;
// Size-limit untrusted report text while allowing a complete user-initiated
// history capture to reach the extension preview.
const MAX_INPUT_BYTES = 16 * 1024 * 1024;
const MAX_ID_LENGTH = 200;
const MAX_PROJECT_LENGTH = 300;
const MAX_TASK_LENGTH = 300;
const MAX_DESCRIPTION_LENGTH = 2000;
const MAX_TAGS = 50;
const MAX_TAG_LENGTH = 120;
const MAX_SHAPE_DEPTH = 100;

function fail(message, diagnostic) {
  const error = new Error(`Invalid Clockify Detailed Report: ${message}`);
  if (diagnostic) error.diagnostic = Object.freeze(diagnostic);
  throw error;
}

function dataDescriptor(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail('report must be JSON data');
  return descriptor;
}

// Validate every descriptor before any normalizer code reads an untrusted value.  This
// also makes the subsequent size serialization safe from report-owned getters.
function assertJsonDataShape(value, maximum, seen = new WeakSet(), depth = 0, nodes = { count: 0 }) {
  if (value === null || value === undefined) return;
  if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return;
  if (typeof value !== 'object' || depth > MAX_SHAPE_DEPTH || ++nodes.count > maximum) fail('report must be JSON data');
  if (seen.has(value)) fail('report must be JSON data');
  seen.add(value);
  if (Object.getOwnPropertySymbols(value).length) fail('report must be JSON data');

  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) fail('report must be JSON data');
    const length = dataDescriptor(value, 'length').value;
    if (!Number.isSafeInteger(length) || length < 0 || length > Math.floor((maximum + 1) / 5)) fail('report is too large');
    const names = Object.getOwnPropertyNames(value);
    if (names.length !== length + 1) fail('report must be JSON data');
    for (let index = 0; index < length; index += 1) {
      const key = String(index);
      const descriptor = dataDescriptor(value, key);
      if (!descriptor.enumerable || !descriptor.configurable || !descriptor.writable) fail('report must be JSON data');
      assertJsonDataShape(descriptor.value, maximum, seen, depth + 1, nodes);
    }
    seen.delete(value);
    return;
  }

  if (Object.getPrototypeOf(value) !== Object.prototype) fail('report must be JSON data');
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = dataDescriptor(value, key);
    if (!descriptor.enumerable) fail('report must be JSON data');
    assertJsonDataShape(descriptor.value, maximum, seen, depth + 1, nodes);
  }
  seen.delete(value);
}

function plainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(`${label} must be an object`);
  return value;
}

function allowedKeys(value, keys, label) {
  for (const key of Object.getOwnPropertyNames(value)) {
    if (CREDENTIAL_KEY.test(key)) fail('credential-bearing fields are forbidden');
    if (!keys.has(key)) fail(`unknown ${label} field: ${key}`);
  }
}

function required(value, key, label) {
  if (!Object.hasOwn(value, key)) fail(`missing ${label} field: ${key}`);
  return dataDescriptor(value, key).value;
}

function optional(value, key) {
  return Object.hasOwn(value, key) ? dataDescriptor(value, key).value : undefined;
}

function arrayValues(value) {
  const length = dataDescriptor(value, 'length').value;
  return Array.from({ length }, (_, index) => dataDescriptor(value, String(index)).value);
}

function boundedText(value, label, maximum, { normalize = false, empty = false } = {}) {
  if (typeof value !== 'string') fail(`${label} must be a string`);
  const text = normalize ? value.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim() : value;
  if ((!empty && !text) || text.length > maximum) fail(`invalid ${label}`);
  return text;
}

function optionalText(value, label, maximum) {
  if (value === null || value === undefined) return '';
  return boundedText(value, label, maximum, { normalize: true });
}

function utcTimestamp(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) fail(`${label} must be a UTC ISO timestamp`);
  const time = new Date(value).getTime();
  const milliseconds = (value.match(/\.(\d{1,6})Z$/)?.[1] ?? '').padEnd(3, '0').slice(0, 3);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== `${value.slice(0, 19)}.${milliseconds}Z`) fail(`${label} must be a UTC ISO timestamp`);
  return { value: new Date(time).toISOString(), time };
}

function timezone(value) {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.length > 100) fail('invalid timezone');
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date(0)); }
  catch { fail('invalid timezone'); }
  return value;
}

function parseReport(value, maximum) {
  if (typeof value !== 'string') fail('report must be JSON text');
  if (new TextEncoder().encode(value).length > maximum) fail('report is too large');
  let report;
  try { report = JSON.parse(value); } catch { fail('report must be JSON data'); }
  assertJsonDataShape(report, maximum);
  return report;
}

function normalizeTags(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || dataDescriptor(value, 'length').value > MAX_TAGS) fail('invalid tags');
  const tags = arrayValues(value).map(tag => {
    plainObject(tag, 'tag');
    allowedKeys(tag, TAG_KEYS, 'tag');
    return boundedText(required(tag, 'name', 'tag'), 'tag', MAX_TAG_LENGTH, { normalize: true });
  });
  return [...new Set(tags)];
}

function normalizeEntry(value, entryIndex) {
  plainObject(value, 'entry');
  allowedKeys(value, ENTRY_KEYS, 'entry');
  const entryId = boundedText(required(value, '_id', 'entry'), 'entry ID', MAX_ID_LENGTH);
  const userId = boundedText(required(value, 'userId', 'entry'), 'user ID', MAX_ID_LENGTH);
  const displayName = boundedText(required(value, 'userName', 'entry'), 'user display name', MAX_PROJECT_LENGTH, { normalize: true });
  const projectId = boundedText(required(value, 'projectId', 'entry'), 'project ID', MAX_ID_LENGTH);
  const project = boundedText(required(value, 'projectName', 'entry'), 'project', MAX_PROJECT_LENGTH, { normalize: true });
  const task = optionalText(optional(value, 'taskName'), 'task', MAX_TASK_LENGTH);
  const interval = plainObject(required(value, 'timeInterval', 'entry'), 'timeInterval');
  allowedKeys(interval, INTERVAL_KEYS, 'timeInterval');
  const started = utcTimestamp(required(interval, 'start', 'timeInterval'), 'start timestamp');
  const ended = utcTimestamp(required(interval, 'end', 'timeInterval'), 'end timestamp');
  const duration = required(interval, 'duration', 'timeInterval');
  const diagnostic = Object.freeze({
    entryIndex, entryId, user: displayName, project, task,
    start: started.value, end: ended.value, duration, timezone: optional(interval, 'timeZone'),
  });
  if (ended.time < started.time) fail('end timestamp must be after start timestamp', diagnostic);
  if (ended.time === started.time && duration === 0) return null;
  if (ended.time === started.time) fail('end timestamp must be after start timestamp', diagnostic);
  if (!Number.isSafeInteger(duration) || duration < 0 || duration !== Math.round((ended.time - started.time) / 1000)) fail('invalid duration');
  const billable = required(value, 'billable', 'entry');
  if (typeof billable !== 'boolean') fail('billable must be Boolean');
  const tagIds = optional(value, 'tagIds');
  if (tagIds !== undefined && tagIds !== null && (!Array.isArray(tagIds) || dataDescriptor(tagIds, 'length').value !== 0)) fail('tag IDs require names');
  return {
    displayName,
    entry: {
      provider: 'clockify', entryId, userId,
      startedAt: started.value, endedAt: ended.value, timezone: timezone(required(interval, 'timeZone', 'timeInterval')), duration,
      projectId, project, task,
      description: boundedText(required(value, 'description', 'entry'), 'description', MAX_DESCRIPTION_LENGTH, { normalize: true, empty: true }),
      tags: normalizeTags(optional(value, 'tags')), billable,
    },
  };
}

function validateTotals(totals, entryCount) {
  if (Array.isArray(totals) && dataDescriptor(totals, 'length').value === 0 && entryCount === 0) return;
  if (!Array.isArray(totals) || dataDescriptor(totals, 'length').value !== 1) fail('totals must contain one aggregate');
  const total = plainObject(dataDescriptor(totals, '0').value, 'total');
  allowedKeys(total, TOTAL_KEYS, 'total');
  const count = required(total, 'entriesCount', 'total');
  if (!Number.isSafeInteger(count) || count < entryCount) fail('invalid total entry count');
}

export function normalizeClockifyDetailedReport(reportText, { maxInputBytes = MAX_INPUT_BYTES } = {}) {
  if (!Number.isInteger(maxInputBytes) || maxInputBytes < 1 || maxInputBytes > MAX_INPUT_BYTES) throw new Error('Invalid Clockify input limit');
  const report = parseReport(reportText, maxInputBytes);
  plainObject(report, 'report');
  allowedKeys(report, REPORT_KEYS, 'report');
  const entries = required(report, 'timeentries', 'report');
  const entryCount = Array.isArray(entries) ? dataDescriptor(entries, 'length').value : -1;
  if (!Array.isArray(entries)) fail('entries must be an array');
  validateTotals(required(report, 'totals', 'report'), entryCount);
  const normalized = arrayValues(entries).map((entry, entryIndex) => normalizeEntry(entry, entryIndex));
  const skippedEntryCount = normalized.filter(value => value === null).length;
  const accepted = normalized.filter(value => value !== null);
  const normalizedEntries = accepted.map(value => value.entry);
  if (new Set(normalizedEntries.map(entry => entry.entryId)).size !== normalizedEntries.length) fail('duplicate entry ID');
  const users = new Map();
  for (const { entry, displayName } of accepted) {
    const existing = users.get(entry.userId);
    if (existing && existing.displayName !== displayName) fail('source user has conflicting display names');
    if (existing) existing.entryCount += 1;
    else users.set(entry.userId, { userId: entry.userId, displayName, entryCount: 1 });
  }
  return { users: [...users.values()], entries: normalizedEntries, ...(skippedEntryCount ? { skippedEntryCount } : {}) };
}
