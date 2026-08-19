import { normalizeIssue, parseIssueUrl } from '../domain/values.js';

const CONTENT_MESSAGES = new Set(['GET_PAGE_STATE', 'START', 'STOP', 'SYNC', 'LOAD_RECENT', 'EDIT_ENTRY', 'MOVE_BOUNDARY', 'DELETE_ENTRY', 'RESOLVE_PENDING', 'OPEN_OPTIONS']);
const EXTENSION_MESSAGES = new Set(['GET_STATE', 'START', 'STOP', 'SYNC', 'LOAD_RECENT', 'EDIT_ENTRY', 'MOVE_BOUNDARY', 'DELETE_ENTRY', 'RESOLVE_PENDING', 'SAVE_CONFIG', 'OPEN_OPTIONS']);

function senderType(sender, extensionOrigin) {
  const url = sender?.url || sender?.tab?.url || '';
  if (url.startsWith(extensionOrigin)) return 'extension';
  const issue = parseIssueUrl(url);
  if (issue && sender?.tab) return 'content';
  return 'unknown';
}

export function assertMessageAllowed(type, sender, extensionOrigin) {
  const kind = senderType(sender, extensionOrigin);
  const allowed = kind === 'extension' ? EXTENSION_MESSAGES : kind === 'content' ? CONTENT_MESSAGES : new Set();
  if (!allowed.has(type)) throw new Error(`Message ${type} is not allowed from this sender`);
  return kind;
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
