import { normalizeIssue, normalizeStoredTaskIdentity, normalizeTaskUrl, parseGitHubProjectPaneIssueUrl, parseIssueUrl, validateEntryId, validatePathSegment } from '../domain/values.js';

const CONTENT_MESSAGES = new Set([
  'GET_PAGE_STATE', 'LOAD_TASK_PARTICIPANTS', 'START', 'SWITCH_TASK', 'STOP', 'DISCARD_ACTIVE', 'LOAD_RECENT', 'LOAD_WEEK', 'EDIT_ENTRIES', 'EDIT_ACTIVE_START', 'QUEUE_ENTRY_EDIT', 'QUEUE_ENTRY_DELETE', 'QUEUE_ENTRIES_EDIT', 'QUEUE_ACTIVE_START_EDIT',
  'SEARCH_ENTRY_TASKS',
  'DELETE_ENTRY', 'RESOLVE_PENDING', 'OPEN_REPORTS', 'OPEN_TASKS', 'OPEN_TIMES', 'OPEN_PREFERRED_SURFACE', 'OPEN_OPTIONS',
  'SET_ACTION_ICON_FRAME',
  'GET_ACTIVITY_VIEW_MODE', 'SET_ACTIVITY_VIEW_MODE',
]);
const CLOCKIFY_MESSAGES = new Set([
  'CLOCKIFY_ARM_CAPTURE', 'CLOCKIFY_ARM_CSV_CAPTURE', 'CLOCKIFY_IS_CAPTURE_ARMED', 'CLOCKIFY_DISARM_CAPTURE',
  'CLOCKIFY_CAPTURED_REPORT', 'CLOCKIFY_CAPTURED_CSV', 'CLOCKIFY_YEAR_OBSERVED', 'CLOCKIFY_CSV_EMAIL_OFFER',
]);
const EXTENSION_MESSAGES = new Set([
  'CONSUME_TOOLBAR_TASK_CONTEXT',
  'GET_STATE', 'GET_PAGE_STATE', 'START', 'SWITCH_TASK', 'STOP', 'DISCARD_ACTIVE', 'LOAD_RECENT', 'LOAD_WEEK', 'EDIT_ENTRIES', 'EDIT_ACTIVE_START', 'QUEUE_ENTRY_EDIT', 'QUEUE_ENTRY_DELETE', 'QUEUE_ENTRIES_EDIT', 'QUEUE_ACTIVE_START_EDIT',
  'DELETE_ENTRY', 'RESOLVE_PENDING', 'GET_STOPPED_OVERLAP', 'RESOLVE_STOPPED_OVERLAP', 'DELETE_STOPPED_OVERLAP', 'SAVE_CONFIG', 'UPDATE_DISPLAY_PREFERENCES', 'SET_QUEUE_DIAGNOSTICS', 'SET_INTERFACE_WIDTH', 'SET_TOOLBAR_CLICK_MODE', 'GET_LOCAL_PREFERENCES',
  'GET_ACTIVITY_VIEW_MODE', 'SET_ACTIVITY_VIEW_MODE',
  'SAVE_BILLING_SETTINGS', 'RESERVE_INVOICE_NUMBER', 'EXPORT_SETTINGS', 'MARK_SETTINGS_EXPORTED', 'IMPORT_SETTINGS', 'LOAD_REPORT', 'GET_CACHED_VIEW', 'GET_EXCHANGE_RATES',
  'LOAD_TASKS', 'LOAD_TIMES', 'SEARCH_ACTIVITY', 'SEARCH_TASKS', 'BULK_ADD_TIMES', 'ADD_TIME', 'ADD_DAY_RANGE', 'CANCEL_REPORT', 'OPEN_REPORTS', 'OPEN_TASKS', 'OPEN_TIMES', 'OPEN_OPTIONS', 'GET_ONBOARDING_STATE',
  'START_DEVICE_FLOW', 'OPEN_DEVICE_FLOW_PAGE', 'RESUME_DEVICE_FLOW', 'POLL_DEVICE_FLOW', 'CANCEL_DEVICE_FLOW',
  'CANCEL_GITHUB_APP_SETUP', 'DISCOVER_REPOSITORIES', 'INSPECT_REPOSITORY', 'CHECK_REPOSITORY_ACCESS', 'SELECT_REPOSITORY', 'SET_DEFAULT_DESTINATION', 'REMOVE_DESTINATION', 'DISCONNECT_GITHUB_APP', 'CHECK_REPOSITORY_INVITE_ACCESS', 'SEARCH_INVITEE_USERS', 'INVITE_REPOSITORY_USER', 'REMOVE_REPOSITORY_USER', 'LOAD_REPOSITORY_COLLABORATORS',
  'CLEAR_LOCAL_CONFIGURATION', 'MERGE_TASKS', 'GET_ADDON_SETTINGS', 'SET_ADDON_ENABLED',
  'GET_CLOCKIFY_MIGRATION_PREVIEW', 'GET_CLOCKIFY_MIGRATION_SUGGESTIONS', 'SEARCH_CLOCKIFY_GITHUB_USERS', 'CONFIRM_CLOCKIFY_MIGRATION', 'RESTORE_CLOCKIFY_MIGRATION_PREVIEW', 'INVITE_MIGRATED_USER',
  'CLEANUP_CLOCKIFY_TEST_IMPORTS', 'DELETE_ALL_CLOCKOLI_RECORDS',
]);
const COMPLETED_MUTATION_MESSAGES = new Set([
  'EDIT_ENTRIES', 'QUEUE_ENTRY_EDIT', 'QUEUE_ENTRY_DELETE', 'QUEUE_ENTRIES_EDIT', 'DELETE_ENTRY',
]);
const DESTINATION_ID_RE = /^github:[1-9]\d*$/;

function senderContext(sender, extensionOrigin) {
  const value = sender?.url || sender?.tab?.url || '';
  if (value.startsWith(extensionOrigin)) return { kind: 'extension', taskUrl: null };
  try {
    const parsed = new URL(value);
    if (sender?.tab && parsed.protocol === 'https:' && parsed.hostname === 'app.clockify.me'
        && parsed.pathname.replace(/\/+$/, '') === '/reports/detailed') {
      return { kind: 'clockify', taskUrl: null };
    }
    if (sender?.tab && ['http:', 'https:'].includes(parsed.protocol)) {
      return { kind: 'content', taskUrl: normalizeTaskUrl(value) };
    }
  } catch { /* invalid sender URL */ }
  return { kind: 'unknown', taskUrl: null };
}

export function assertMessageAllowed(type, sender, extensionOrigin) {
  const context = senderContext(sender, extensionOrigin);
  const allowed = context.kind === 'extension' ? EXTENSION_MESSAGES
    : context.kind === 'content' ? CONTENT_MESSAGES
      : context.kind === 'clockify' ? CLOCKIFY_MESSAGES : new Set();
  if (!allowed.has(type)) throw new Error(`Message ${type} is not allowed from this sender`);
  return context.kind;
}

export function cachedViewRequest(message, sender, extensionOrigin) {
  assertMessageAllowed('GET_CACHED_VIEW', sender, extensionOrigin);
  const kind = message?.kind;
  const page = kind === 'reports' ? 'reports' : kind === 'tasks' ? 'tasks' : '';
  if (!page || sender?.url !== `${extensionOrigin}src/${page}/${page}.html`
      || !message.range || typeof message.range !== 'object' || Array.isArray(message.range)
      || Object.keys(message).sort().join(',') !== 'kind,range,type'
      || Object.keys(message.range).sort().join(',') !== (kind === 'reports' ? 'endDate,reportingUtc,startDate' : 'endDate,startDate')
      || (kind === 'reports' && typeof message.range.reportingUtc !== 'boolean')) throw new Error('Invalid cached view request');
  for (const date of [message.range.startDate, message.range.endDate]) {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)
        || !Number.isFinite(Date.parse(`${date}T00:00:00Z`))
        || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error('Invalid cached view date');
  }
  if (message.range.endDate < message.range.startDate) throw new Error('Invalid cached view range');
  return { kind, range: message.range };
}

export function weekRangeForSender(payload, sender, extensionOrigin) {
  // Validate the one-week request from allowed extension or page senders.
  assertMessageAllowed('LOAD_WEEK', sender, extensionOrigin);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
      || Object.keys(payload).sort().join(',') !== 'endDate,startDate') throw new Error('Invalid week range');
  const date = value => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Invalid week date');
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error('Invalid week date');
    return parsed;
  };
  const start = date(payload.startDate), end = date(payload.endDate);
  if (start.getUTCDay() !== 1 || end.getTime() - start.getTime() !== 6 * 86_400_000) throw new Error('Invalid week range');
  return { startDate: payload.startDate, endDate: payload.endDate };
}

export function destinationIdForCompletedMutation(type, payload, sender, extensionOrigin) {
  if (!COMPLETED_MUTATION_MESSAGES.has(type)) throw new Error(`Message ${type} is not a completed-record mutation`);
  assertMessageAllowed(type, sender, extensionOrigin);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
      || typeof payload.destinationId !== 'string' || !DESTINATION_ID_RE.test(payload.destinationId)) {
    throw new Error('Completed-record mutations require a valid destination ID');
  }
  return payload.destinationId;
}

export function entryTaskSearchForSender(message, sender, extensionOrigin) {
  if (assertMessageAllowed('SEARCH_ENTRY_TASKS', sender, extensionOrigin) !== 'content'
      || !sender?.tab || ![sender.url, sender.tab.url].every(value => {
        try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'github.com'; }
        catch { return false; }
      }) || !message || Object.keys(message).sort().join(',') !== 'destinationId,path,query,recordId,type'
      || message.type !== 'SEARCH_ENTRY_TASKS' || typeof message.destinationId !== 'string'
      || !DESTINATION_ID_RE.test(message.destinationId) || typeof message.query !== 'string'
      || !message.query.trim() || message.query.length > 300 || typeof message.path !== 'string') {
    throw new Error('Invalid GitHub entry task search');
  }
  const path = message.path.match(/^times\/(\d{4}-(?:0[1-9]|1[0-2]))\/([A-Za-z0-9_.-]{1,100})\.jsonl$/);
  if (!path) throw new Error('Invalid GitHub entry task search path');
  validatePathSegment(path[2], 'user');
  validateEntryId(message.recordId);
  return { destinationId: message.destinationId, path: message.path, recordId: message.recordId, query: message.query };
}

export function taskUrlForStart(payloadTaskUrl, sender, extensionOrigin) {
  const kind = assertMessageAllowed('START', sender, extensionOrigin);
  const requested = kind === 'extension' ? normalizeStoredTaskIdentity(payloadTaskUrl) : normalizeTaskUrl(payloadTaskUrl);
  if (kind === 'content') {
    // GitHub changes the tab URL in-place; sender.url can still be the original document URL.
    const pageUrl = sender.tab?.url || sender.url || '';
    const pageTaskUrl = parseGitHubProjectPaneIssueUrl(pageUrl) || normalizeTaskUrl(pageUrl);
    if (pageTaskUrl !== requested) throw new Error('Requested task URL must match the current page');
  }
  return requested;
}

export function requestedStartDestinationId(taskUrl, destinationId, sender, extensionOrigin, type = 'START') {
  if (destinationId === undefined) return null;
  if (assertMessageAllowed(type, sender, extensionOrigin) !== 'extension') {
    throw new Error('Only extension pages can select an imported task destination');
  }
  if (/^https?:\/\//i.test(taskUrl)) throw new Error('Only imported tasks may select a destination');
  normalizeStoredTaskIdentity(taskUrl);
  if (typeof destinationId !== 'string' || !DESTINATION_ID_RE.test(destinationId)) {
    throw new Error('Invalid imported task destination');
  }
  return destinationId;
}

export function addTimeForSender(payload, sender, extensionOrigin) {
  assertMessageAllowed('ADD_TIME', sender, extensionOrigin);
  if (![`${extensionOrigin}src/tasks/tasks.html`, `${extensionOrigin}src/times/times.html`].includes(sender?.url)) {
    throw new Error('Add time is not allowed from this page');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
      || !['description,endedAt,startedAt,taskTitle,taskUrl', 'description,destinationId,endedAt,startedAt,taskTitle,taskUrl'].includes(Object.keys(payload).sort().join(','))) {
    throw new Error('Invalid Add time payload');
  }
  const { taskTitle, description, startedAt, endedAt } = payload;
  if (typeof taskTitle !== 'string' || taskTitle.length > 500 || typeof description !== 'string' || description.length > 2000) {
    throw new Error('Invalid or too long Add time text');
  }
  for (const value of [startedAt, endedAt]) {
    if (value !== null && (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)
        || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value)) throw new Error('Invalid Add time timestamp');
  }
  if (Object.hasOwn(payload, 'destinationId')) {
    if (typeof payload.destinationId !== 'string' || !DESTINATION_ID_RE.test(payload.destinationId)) throw new Error('Invalid Add time destination');
    const taskUrl = normalizeStoredTaskIdentity(payload.taskUrl);
    if (/^https?:\/\//i.test(taskUrl)) throw new Error('Invalid Add time payload');
    return { taskUrl, taskTitle, description, startedAt, endedAt, destinationId: payload.destinationId };
  }
  return { taskUrl: normalizeTaskUrl(payload.taskUrl), taskTitle, description, startedAt, endedAt };
}

export function dayRangeForSender(payload, sender, extensionOrigin) {
  assertMessageAllowed('ADD_DAY_RANGE', sender, extensionOrigin);
  if (![`${extensionOrigin}src/tasks/tasks.html`, `${extensionOrigin}src/times/times.html`].includes(sender?.url)) {
    throw new Error('Day range is not allowed from this page');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
      || !['dates,description,durationSeconds,taskTitle,taskUrl',
        'dates,description,destinationId,durationSeconds,taskTitle,taskUrl'].includes(Object.keys(payload).sort().join(','))) {
    throw new Error('Invalid day range payload');
  }
  if (typeof payload.taskTitle !== 'string' || payload.taskTitle.length > 500
      || typeof payload.description !== 'string' || payload.description.length > 2000
      || !Number.isSafeInteger(payload.durationSeconds) || payload.durationSeconds < 0 || payload.durationSeconds > 86400) {
    throw new Error('Invalid day range duration or text');
  }
  const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`))
    && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
  if (!Array.isArray(payload.dates) || !payload.dates.length || payload.dates.length > 500
      || payload.dates.some((date, index) => !validDate(date) || index > 0 && date <= payload.dates[index - 1])
      || (Date.parse(`${payload.dates.at(-1)}T00:00:00.000Z`) - Date.parse(`${payload.dates[0]}T00:00:00.000Z`)) / 86400000 >= 500) {
    throw new Error('Invalid selected days (maximum 500-day span)');
  }
  if (Object.hasOwn(payload, 'destinationId')) {
    if (typeof payload.destinationId !== 'string' || !DESTINATION_ID_RE.test(payload.destinationId)) throw new Error('Invalid day range destination');
    const taskUrl = normalizeStoredTaskIdentity(payload.taskUrl);
    if (/^https?:\/\//i.test(taskUrl)) throw new Error('Invalid day range payload');
    return { ...payload, taskUrl };
  }
  return { ...payload, taskUrl: normalizeTaskUrl(payload.taskUrl) };
}

export function taskUrlForTimelineSwitch(payloadTaskUrl, sender, extensionOrigin, sourceEntry, storedRecords = []) {
  const kind = assertMessageAllowed('SWITCH_TASK', sender, extensionOrigin);
  if (kind === 'extension') return normalizeStoredTaskIdentity(payloadTaskUrl);
  try { return normalizeTaskUrl(payloadTaskUrl); }
  catch (error) {
    const identity = normalizeStoredTaskIdentity(payloadTaskUrl);
    if (!sourceEntry || !storedRecords.some(record => record.id === sourceEntry.id
        && record.destinationId === sourceEntry.destinationId && record.entryDate === sourceEntry.entryDate
        && record.taskUrl === identity)) throw new Error('Imported task requires a matching stored record');
    return identity;
  }
}

export function taskUrlForParticipantLoad(payloadTaskUrl, sender, extensionOrigin) {
  const kind = assertMessageAllowed('LOAD_TASK_PARTICIPANTS', sender, extensionOrigin);
  const requested = normalizeTaskUrl(payloadTaskUrl);
  if (kind !== 'content' || !parseIssueUrl(requested)) throw new Error('Participant totals require the current GitHub issue or pull request page');
  const current = normalizeTaskUrl(sender?.tab?.url || sender?.url || '');
  if (current !== requested) throw new Error('Requested task URL must match the current page');
  return requested;
}

// Backward-compatible input adapter for cached callers while task URL remains the canonical identity.
export function issueForStart(payloadIssue, sender, extensionOrigin) {
  const requested = normalizeIssue(payloadIssue);
  taskUrlForStart(requested.url, sender, extensionOrigin);
  const pageIssue = parseIssueUrl(requested.url);
  if (!pageIssue) throw new Error('Requested task URL must match the current page');
  return requested;
}
