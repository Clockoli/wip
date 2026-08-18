import { GitHubClient } from '../api/github-client.js';
import { ChromeStore } from '../storage/chrome-store.js';
import { TrackerService } from '../services/tracker.js';
import { ConfigurationService } from '../services/configuration.js';
import { assertMessageAllowed, issueForStart } from './message-policy.js';
import { SerialExecutor } from './serial-executor.js';

const store = new ChromeStore();
const executor = new SerialExecutor();
const configuration = new ConfigurationService({ store, githubFactory: options => new GitHubClient(options) });

function serializeError(error) {
  return { message: error?.message || 'Unexpected error', code: error?.code || 'error', status: error?.status || 0 };
}

async function context() {
  const { config, token } = await store.getConfig();
  if (!config || !token) throw new Error('Configure the private time-data repository and token in Settings.');
  const github = new GitHubClient({ token, owner: config.owner, repo: config.repo, branch: config.branch || 'main' });
  let { user } = await store.getState();
  if (!user) {
    user = await github.getAuthenticatedUser();
    await store.patchState({ user });
  }
  return {
    config,
    tracker: new TrackerService({
      github, store, user, recentDays: config.recentDays || 7,
      allowedIssueOwners: config.allowedIssueOwners || [config.owner],
    }),
  };
}

async function handle(message, sender) {
  if (!message || typeof message.type !== 'string') throw new Error('Invalid extension message');
  const extensionOrigin = chrome.runtime.getURL('');
  assertMessageAllowed(message.type, sender, extensionOrigin);
  if (message.type === 'OPEN_OPTIONS') { await chrome.runtime.openOptionsPage(); return { ok: true }; }
  if (message.type === 'SAVE_CONFIG') return configuration.save(message.payload);
  if (message.type === 'GET_STATE' || message.type === 'GET_PAGE_STATE') {
    const { config } = await store.getConfig();
    if (!config) return message.type === 'GET_PAGE_STATE'
      ? { configured: false, active: null, pendingCount: 0 }
      : { configured: false, active: null, recent: [], pendingWrites: [] };
    const { tracker } = await context();
    const state = await tracker.getState({ refresh: Boolean(message.refresh) });
    if (message.type === 'GET_PAGE_STATE') {
      const active = state.active ? {
        issue: state.active.issue, startedAt: state.active.startedAt,
        description: state.active.description || '', issueTitle: state.active.issueTitle || '',
      } : null;
      return { configured: true, active, pendingCount: state.pendingWrites.length };
    }
    return { configured: true, ...state };
  }
  const { tracker } = await context();
  switch (message.type) {
    case 'START': return tracker.start(issueForStart(message.issue, sender, extensionOrigin), message.issueTitle || '', message.description || '');
    case 'STOP': return tracker.stop(message.description || '');
    case 'SYNC': return tracker.syncPending();
    case 'LOAD_RECENT': return tracker.loadRecent(50);
    case 'EDIT_ENTRY': return tracker.editEntry(message.payload);
    case 'DELETE_ENTRY': return tracker.deleteEntry(message.payload);
    case 'RESOLVE_PENDING': return tracker.resolvePendingConflict(message.id);
    default: throw new Error('Unknown extension message');
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  executor.run(() => handle(message, sender)).then(data => sendResponse({ ok: true, data })).catch(error => sendResponse({ ok: false, error: serializeError(error) }));
  return true;
});

chrome.runtime.onInstalled.addListener(() => chrome.alarms.create('sync-pending', { periodInMinutes: 1 }));
chrome.runtime.onStartup.addListener(() => chrome.alarms.create('sync-pending', { periodInMinutes: 1 }));
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'sync-pending') executor.run(() => context().then(({ tracker }) => tracker.syncPending())).catch(() => {});
});
