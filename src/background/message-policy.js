import { normalizeIssue, parseIssueUrl } from '../domain/values.js';

const ISSUE_CONTENT_MESSAGES = new Set(['GET_PAGE_STATE', 'START', 'STOP', 'SYNC', 'LOAD_RECENT', 'EDIT_ENTRY', 'MOVE_BOUNDARY', 'DELETE_ENTRY', 'RESOLVE_PENDING', 'OPEN_REPORTS', 'OPEN_TASKS', 'OPEN_OPTIONS']);
const PAGE_CONTENT_MESSAGES = new Set(['GET_PAGE_STATE', 'OPEN_REPORTS', 'OPEN_TASKS', 'OPEN_OPTIONS']);
const EXTENSION_MESSAGES = new Set(['GET_STATE', 'START', 'STOP', 'SYNC', 'LOAD_RECENT', 'EDIT_ENTRY', 'MOVE_BOUNDARY', 'DELETE_ENTRY', 'RESOLVE_PENDING', 'SAVE_CONFIG', 'LOAD_REPORT', 'LOAD_TASKS', 'CANCEL_REPORT', 'OPEN_REPORTS', 'OPEN_TASKS', 'OPEN_OPTIONS', 'GET_ONBOARDING_STATE', 'START_DEVICE_FLOW', 'RESUME_DEVICE_FLOW', 'POLL_DEVICE_FLOW', 'CANCEL_DEVICE_FLOW', 'CANCEL_GITHUB_APP_SETUP', 'DISCOVER_REPOSITORIES', 'SELECT_REPOSITORY', 'DISCONNECT_GITHUB_APP', 'CLEAR_LOCAL_CONFIGURATION']);

function senderContext(sender, extensionOrigin) {
  const url = sender?.url || sender?.tab?.url || '';
  if (url.startsWith(extensionOrigin)) return { kind: 'extension', issue: null };
  try {
    const parsed = new URL(url);
    if (sender?.tab && parsed.protocol === 'https:' && parsed.hostname === 'github.com') {
      return { kind: 'content', issue: parseIssueUrl(url) };
    }
  } catch { /* invalid sender URL */ }
  return { kind: 'unknown', issue: null };
}

export function assertMessageAllowed(type, sender, extensionOrigin) {
  const context = senderContext(sender, extensionOrigin);
  const allowed = context.kind === 'extension' ? EXTENSION_MESSAGES
    : context.kind === 'content' ? (context.issue ? ISSUE_CONTENT_MESSAGES : PAGE_CONTENT_MESSAGES)
      : new Set();
  if (!allowed.has(type)) throw new Error(`Message ${type} is not allowed from this sender`);
  return context.kind;
}

export function issueForStart(payloadIssue, sender, extensionOrigin) {
  const kind = assertMessageAllowed('START', sender, extensionOrigin);
  const requested = normalizeIssue(payloadIssue);
  if (kind === 'content') {
    const pageIssue = parseIssueUrl(sender.url || sender.tab?.url || '');
    if (!pageIssue || pageIssue.type !== requested.type || pageIssue.owner !== requested.owner || pageIssue.repo !== requested.repo || pageIssue.number !== requested.number) {
      throw new Error('Requested item must match the GitHub issue or pull request page');
    }
  }
  return requested;
}
