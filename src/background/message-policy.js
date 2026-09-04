import { normalizeIssue, normalizeTaskUrl, parseIssueUrl } from '../domain/values.js';

const CONTENT_MESSAGES = new Set([
  'GET_PAGE_STATE', 'LOAD_TASK_PARTICIPANTS', 'START', 'SWITCH_TASK', 'STOP', 'SYNC', 'LOAD_RECENT', 'EDIT_ENTRIES',
  'DELETE_ENTRY', 'RESOLVE_PENDING', 'OPEN_REPORTS', 'OPEN_TASKS', 'OPEN_TIMES', 'OPEN_OPTIONS',
  'SET_ACTION_ICON_FRAME',
]);
const CLOCKIFY_MESSAGES = new Set([
  'CLOCKIFY_ARM_CAPTURE', 'CLOCKIFY_IS_CAPTURE_ARMED', 'CLOCKIFY_DISARM_CAPTURE', 'CLOCKIFY_CAPTURED_REPORT',
]);

const EXTENSION_MESSAGES = new Set([
  'GET_STATE', 'GET_PAGE_STATE', 'START', 'SWITCH_TASK', 'STOP', 'SYNC', 'LOAD_RECENT', 'EDIT_ENTRIES',
  'DELETE_ENTRY', 'RESOLVE_PENDING', 'SAVE_CONFIG', 'UPDATE_DISPLAY_PREFERENCES', 'GET_LOCAL_PREFERENCES',
  'SAVE_BILLING_SETTINGS', 'EXPORT_SETTINGS', 'MARK_SETTINGS_EXPORTED', 'IMPORT_SETTINGS', 'LOAD_REPORT', 'GET_EXCHANGE_RATES',
  'LOAD_TASKS', 'LOAD_TIMES', 'BULK_ADD_TIMES', 'CANCEL_REPORT', 'OPEN_REPORTS', 'OPEN_TASKS', 'OPEN_TIMES', 'OPEN_OPTIONS', 'GET_ONBOARDING_STATE',
  'START_DEVICE_FLOW', 'OPEN_DEVICE_FLOW_PAGE', 'RESUME_DEVICE_FLOW', 'POLL_DEVICE_FLOW', 'CANCEL_DEVICE_FLOW',
  'CANCEL_GITHUB_APP_SETUP', 'DISCOVER_REPOSITORIES', 'CHECK_REPOSITORY_ACCESS', 'SELECT_REPOSITORY', 'DISCONNECT_GITHUB_APP',
  'CLEAR_LOCAL_CONFIGURATION',
  'GET_ADDON_SETTINGS', 'SET_ADDON_ENABLED',
  'GET_CLOCKIFY_MIGRATION_PREVIEW', 'GET_CLOCKIFY_MIGRATION_SUGGESTIONS', 'CONFIRM_CLOCKIFY_MIGRATION',
  'CLEANUP_CLOCKIFY_TEST_IMPORTS',
]);

function senderContext(sender, extensionOrigin) {
  const value = sender?.url || sender?.origin || sender?.tab?.url || '';
  if (value.startsWith(extensionOrigin) || value === extensionOrigin.replace(/\/$/, '')) return { kind: 'extension', taskUrl: null };
  try {
    const parsed = new URL(value);
    if (sender?.tab && parsed.protocol === 'https:' && parsed.hostname === 'app.clockify.me'
        && parsed.pathname.replace(/\/+$/, '') === '/reports/detailed') {
      return { kind: 'clockify', taskUrl: null };
    }
    if (sender?.tab && parsed.protocol === 'https:' && parsed.hostname === 'github.com') {
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

export function taskUrlForStart(payloadTaskUrl, sender, extensionOrigin) {
  const kind = assertMessageAllowed('START', sender, extensionOrigin);
  const requested = normalizeTaskUrl(payloadTaskUrl);
  if (kind === 'content') {
    const pageTaskUrl = normalizeTaskUrl(sender.url || sender.tab?.url || '');
    if (pageTaskUrl !== requested) throw new Error('Requested task URL must match the current page');
  }
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
