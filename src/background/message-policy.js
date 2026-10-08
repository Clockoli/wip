import { normalizeIssue, normalizeStoredTaskIdentity, normalizeTaskUrl, parseGitHubProjectPaneIssueUrl, parseIssueUrl } from '../domain/values.js';

const CONTENT_MESSAGES = new Set([
  'GET_PAGE_STATE', 'LOAD_TASK_PARTICIPANTS', 'START', 'SWITCH_TASK', 'STOP', 'DISCARD_ACTIVE', 'SYNC', 'LOAD_RECENT', 'EDIT_ENTRIES', 'EDIT_ACTIVE_START', 'QUEUE_ENTRY_EDIT', 'QUEUE_ENTRY_DELETE', 'QUEUE_ENTRIES_EDIT', 'QUEUE_ACTIVE_START_EDIT',
  'DELETE_ENTRY', 'RESOLVE_PENDING', 'OPEN_REPORTS', 'OPEN_TASKS', 'OPEN_TIMES', 'OPEN_OPTIONS',
  'SET_ACTION_ICON_FRAME',
]);
const CLOCKIFY_MESSAGES = new Set([
  'CLOCKIFY_ARM_CAPTURE', 'CLOCKIFY_ARM_CSV_CAPTURE', 'CLOCKIFY_IS_CAPTURE_ARMED', 'CLOCKIFY_DISARM_CAPTURE',
  'CLOCKIFY_CAPTURED_REPORT', 'CLOCKIFY_CAPTURED_CSV', 'CLOCKIFY_YEAR_OBSERVED', 'CLOCKIFY_CSV_EMAIL_OFFER',
]);
const EXTENSION_MESSAGES = new Set([
  'GET_STATE', 'GET_PAGE_STATE', 'START', 'SWITCH_TASK', 'STOP', 'DISCARD_ACTIVE', 'SYNC', 'LOAD_RECENT', 'EDIT_ENTRIES', 'EDIT_ACTIVE_START', 'QUEUE_ENTRY_EDIT', 'QUEUE_ENTRY_DELETE', 'QUEUE_ENTRIES_EDIT', 'QUEUE_ACTIVE_START_EDIT',
  'DELETE_ENTRY', 'RESOLVE_PENDING', 'SAVE_CONFIG', 'UPDATE_DISPLAY_PREFERENCES', 'SET_QUEUE_DIAGNOSTICS', 'GET_LOCAL_PREFERENCES',
  'SAVE_BILLING_SETTINGS', 'RESERVE_INVOICE_NUMBER', 'EXPORT_SETTINGS', 'MARK_SETTINGS_EXPORTED', 'IMPORT_SETTINGS', 'LOAD_REPORT', 'GET_EXCHANGE_RATES',
  'LOAD_TASKS', 'LOAD_TIMES', 'BULK_ADD_TIMES', 'CANCEL_REPORT', 'OPEN_REPORTS', 'OPEN_TASKS', 'OPEN_TIMES', 'OPEN_OPTIONS', 'GET_ONBOARDING_STATE',
  'START_DEVICE_FLOW', 'OPEN_DEVICE_FLOW_PAGE', 'RESUME_DEVICE_FLOW', 'POLL_DEVICE_FLOW', 'CANCEL_DEVICE_FLOW',
  'CANCEL_GITHUB_APP_SETUP', 'DISCOVER_REPOSITORIES', 'INSPECT_REPOSITORY', 'CHECK_REPOSITORY_ACCESS', 'SELECT_REPOSITORY', 'SET_DEFAULT_DESTINATION', 'REMOVE_DESTINATION', 'DISCONNECT_GITHUB_APP', 'SEARCH_INVITEE_USERS', 'INVITE_REPOSITORY_USER', 'REMOVE_REPOSITORY_USER', 'LOAD_REPOSITORY_COLLABORATORS',
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

export function destinationIdForCompletedMutation(type, payload, sender, extensionOrigin) {
  if (!COMPLETED_MUTATION_MESSAGES.has(type)) throw new Error(`Message ${type} is not a completed-record mutation`);
  assertMessageAllowed(type, sender, extensionOrigin);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)
      || typeof payload.destinationId !== 'string' || !DESTINATION_ID_RE.test(payload.destinationId)) {
    throw new Error('Completed-record mutations require a valid destination ID');
  }
  return payload.destinationId;
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

export function taskUrlForTimelineSwitch(payloadTaskUrl, sender, extensionOrigin) {
  assertMessageAllowed('SWITCH_TASK', sender, extensionOrigin);
  return normalizeTaskUrl(payloadTaskUrl);
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
