import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { assertMessageAllowed, issueForStart, taskUrlForParticipantLoad, taskUrlForStart, taskUrlForTimelineSwitch, weekRangeForSender } from '../src/background/message-policy.js';

const origin = 'chrome-extension://abc/';
const content = { url: 'https://github.com/acme/frontend/issues/123', tab: { id: 1 } };
const extension = { url: `${origin}src/popup/popup.html` };
const issue = { type: 'issue', owner: 'acme', repo: 'frontend', number: 123, url: 'https://github.com/acme/frontend/issues/123' };

test('week reads accept only a Monday–Sunday range from the extension or a GitHub tab', () => {
  const week = { startDate: '2026-10-05', endDate: '2026-10-11' };
  assert.deepEqual(weekRangeForSender(week, content, origin), week);
  assert.deepEqual(weekRangeForSender(week, extension, origin), week);
  for (const payload of [{ ...week, destinationId: 'github:1' }, { ...week, endDate: '2026-10-12' }, { ...week, startDate: '2026-10-06' }, { ...week, startDate: '2026-02-30' }, null]) {
    assert.throws(() => weekRangeForSender(payload, content, origin), /week/i);
  }
  assert.throws(() => weekRangeForSender(week, { url: 'https://example.com/task', tab: { id: 2 } }, origin), /GitHub/i);
  assert.throws(() => weekRangeForSender(week, { url: 'https://app.clockify.me/reports/detailed', tab: { id: 2 } }, origin), /not allowed/i);
  assert.throws(() => weekRangeForSender(week, { url: 'https://github.com/acme/frontend/issues/123' }, origin), /not allowed/i);
  assert.throws(() => assertMessageAllowed('LOAD_TIMES', content, origin), /not allowed/i);
  assert.equal(assertMessageAllowed('SEARCH_ACTIVITY', extension, origin), 'extension');
  assert.throws(() => assertMessageAllowed('SEARCH_ACTIVITY', content, origin), /not allowed/i);
});

test('email-only CSV response is accepted only from the armed Clockify report tab and uses its URL year', async () => {
  const clockify = { url: 'https://app.clockify.me/reports/detailed', tab: { id: 5 } };
  assert.equal(assertMessageAllowed('CLOCKIFY_CSV_EMAIL_OFFER', clockify, origin), 'clockify');
  for (const sender of [extension, content, { url: 'https://app.clockify.me/other', tab: { id: 5 } }]) {
    assert.throws(() => assertMessageAllowed('CLOCKIFY_CSV_EMAIL_OFFER', sender, origin), /not allowed/i);
  }
  const worker = await readFile(new URL('../src/background/service-worker.js', import.meta.url), 'utf8');
  const seen = [];
  const context = vm.createContext({
    assertMessageAllowed,
    chrome: { runtime: { getURL: () => origin }, tabs: { get: async () => ({ url: 'https://app.clockify.me/reports/detailed?start=2026-01-01T00:00:00.000Z&end=2026-12-31T23:59:59.999Z' }) } },
    clockifyDetailedReportYear: () => 2026,
    clockifyCaptureArm: { isArmed: async tab => tab === 5, disarm: async tab => seen.push(['disarm', tab]) },
    clockifyHistoryScan: { recordCsvEmailOffer: async year => { seen.push(['offer', year]); return 3; }, reset: async () => seen.push(['reset']) },
  });
  vm.runInContext(worker.slice(worker.indexOf('async function handle('), worker.indexOf('chrome.runtime.onMessage.addListener')), context);
  await assert.rejects(context.handle({ type: 'CLOCKIFY_CSV_EMAIL_OFFER', year: 2025 }, clockify), /payload/i);
  await assert.rejects(context.handle({ type: 'CLOCKIFY_CSV_EMAIL_OFFER' }, { ...clockify, tab: { id: 6 } }), /armed/i);
  assert.deepEqual(JSON.parse(JSON.stringify(await context.handle({ type: 'CLOCKIFY_CSV_EMAIL_OFFER' }, clockify))), { attempts: 3, cancelled: true });
  assert.deepEqual(seen, [['offer', 2026], ['disarm', 5], ['reset']]);
});

test('invoice number reservation is extension-only and the dispatcher ignores payloads', async () => {
  assert.equal(assertMessageAllowed('RESERVE_INVOICE_NUMBER', extension, origin), 'extension');
  assert.throws(() => assertMessageAllowed('RESERVE_INVOICE_NUMBER', content, origin), /not allowed/i);
  const worker = await readFile(new URL('../src/background/service-worker.js', import.meta.url), 'utf8');
  let calls = 0;
  const context = vm.createContext({ assertMessageAllowed, chrome: { runtime: { getURL: () => origin } }, store: {
    reserveInvoiceNumber: async (...args) => { assert.deepEqual(args, []); calls += 1; return { sequence: calls }; },
  } });
  vm.runInContext(worker.slice(worker.indexOf('async function handle('), worker.indexOf('chrome.runtime.onMessage.addListener')), context);
  assert.equal((await context.handle({ type: 'RESERVE_INVOICE_NUMBER', payload: { nextNumber: 999 } }, extension)).sequence, 1);
  await assert.rejects(context.handle({ type: 'RESERVE_INVOICE_NUMBER' }, content), /not allowed/i);
  assert.equal(calls, 1);
});

test('billing dispatcher forwards project client links only from extension pages', async () => {
  const worker = await readFile(new URL('../src/background/service-worker.js', import.meta.url), 'utf8');
  const calls = [], broadcasts = [];
  const context = vm.createContext({ assertMessageAllowed, broadcastLocalPreferencesChanged: revision => broadcasts.push(revision), chrome: { runtime: { getURL: () => origin } }, store: {
    saveBillingSettings: async (...args) => { calls.push(args); return { revision: 8 }; },
  } });
  vm.runInContext(worker.slice(worker.indexOf('async function handle('), worker.indexOf('chrome.runtime.onMessage.addListener')), context);
  const message = { type: 'SAVE_BILLING_SETTINGS', payload: { invoicing: {} }, expectedRevision: 4, projectLinks: { projectClients: { 'project-1': 'client-1' }, otherProjectClient: '' } };
  await context.handle(message, extension);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [[message.payload, message.projectLinks, message.expectedRevision]]);
  assert.deepEqual(broadcasts, [8]);
  await assert.rejects(context.handle(message, content), /not allowed/i);
  assert.equal(calls.length, 1);
  await assert.rejects(context.handle({ ...message, expectedRevision: undefined }, extension), /revision/i);
});

test('display dispatcher forwards the expected revision and returns the atomic mutation result', async () => {
  const worker = await readFile(new URL('../src/background/service-worker.js', import.meta.url), 'utf8');
  const calls = [], broadcasts = [], result = { config: { recentDays: 14 }, generation: 3, revision: 8, preferences: { recentDays: 14, revision: 8 } };
  const context = vm.createContext({ assertMessageAllowed, broadcastLocalPreferencesChanged: revision => broadcasts.push(revision), chrome: { runtime: { getURL: () => origin } }, store: {
    updateDisplayPreferences: async (...args) => { calls.push(args); return result; },
  } });
  vm.runInContext(worker.slice(worker.indexOf('async function handle('), worker.indexOf('chrome.runtime.onMessage.addListener')), context);
  const message = { type: 'UPDATE_DISPLAY_PREFERENCES', payload: { recentDays: 14 }, expectedRevision: 7 };
  assert.deepEqual(await context.handle(message, extension), result);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [[message.payload, message.expectedRevision]]);
  assert.deepEqual(broadcasts, [8]);
  await assert.rejects(context.handle({ ...message, expectedRevision: undefined }, extension), /revision/i);
  await assert.rejects(context.handle(message, content), /not allowed/i);
});

test('content scripts receive only page-safe state and timer actions', () => {
  assert.doesNotThrow(() => assertMessageAllowed('GET_PAGE_STATE', content, origin));
  assert.doesNotThrow(() => assertMessageAllowed('LOAD_TASK_PARTICIPANTS', content, origin));
  assert.doesNotThrow(() => assertMessageAllowed('SET_ACTION_ICON_FRAME', content, origin));
  assert.doesNotThrow(() => assertMessageAllowed('EDIT_ACTIVE_START', content, origin));
  assert.doesNotThrow(() => assertMessageAllowed('OPEN_TASKS', content, origin));
  assert.throws(() => assertMessageAllowed('GET_STATE', content, origin), /not allowed/i);
  assert.throws(() => assertMessageAllowed('EDIT_ENTRY', content, origin), /not allowed/i);
});

test('Activity view messages accept only valid modes from Activity surfaces', async () => {
  const worker = await readFile(new URL('../src/background/service-worker.js', import.meta.url), 'utf8');
  let mode = null;
  const context = vm.createContext({ assertMessageAllowed, URL, chrome: { runtime: { getURL: path => `${origin}${path}` } }, store: {
    getActivityViewMode: async () => mode,
    setActivityViewMode: async value => { mode = value; return mode; },
  } });
  vm.runInContext(worker.slice(worker.indexOf('async function handle('), worker.indexOf('chrome.runtime.onMessage.addListener')), context);
  const read = { type: 'GET_ACTIVITY_VIEW_MODE' }, write = { type: 'SET_ACTIVITY_VIEW_MODE', mode: 'calendar' };
  assert.equal((await context.handle(write, extension)).mode, 'calendar');
  assert.equal((await context.handle(read, content)).mode, 'calendar');
  assert.equal((await context.handle(read, { url: 'https://example.com/task', tab: { id: 2 } })).mode, 'calendar');
  for (const sender of [{ url: `${origin}src/options/options.html` }, { url: 'https://example.com/task' }, { url: 'https://app.clockify.me/reports/detailed', tab: { id: 3 } }]) {
    await assert.rejects(context.handle(write, sender));
  }
  await assert.rejects(context.handle({ ...write, mode: 'invalid' }, content), /Invalid Activity view/i);
  await assert.rejects(context.handle({ ...write, token: 'injected' }, content), /Invalid Activity view/i);
  await assert.rejects(context.handle({ ...read, payload: {} }, extension), /Invalid Activity view/i);
  assert.equal(mode, 'calendar');
});

test('any GitHub page can manage its URL task but cannot access privileged state', () => {
  const dashboard = { url: 'https://github.com/issues/assigned', tab: { id: 2, url: 'https://github.com/issues/assigned' } };
  for (const type of ['GET_PAGE_STATE', 'START', 'STOP', 'SYNC', 'LOAD_RECENT', 'EDIT_ENTRIES', 'EDIT_ACTIVE_START', 'QUEUE_ENTRY_EDIT', 'QUEUE_ENTRIES_EDIT', 'QUEUE_ACTIVE_START_EDIT', 'OPEN_REPORTS', 'OPEN_TASKS', 'OPEN_TIMES', 'OPEN_OPTIONS']) {
    assert.equal(assertMessageAllowed(type, dashboard, origin), 'content');
  }
  for (const type of ['GET_STATE', 'SAVE_CONFIG', 'LOAD_REPORT']) {
    assert.throws(() => assertMessageAllowed(type, dashboard, origin), /not allowed/i);
  }
});

test('content-script START issue must match its sender URL', () => {
  assert.deepEqual(issueForStart(issue, content, origin), issue);
  assert.throws(() => issueForStart({ ...issue, number: 999, url: 'https://github.com/acme/frontend/issues/999' }, content, origin), /match/i);
});

test('content-script START accepts a matching canonical pull request page', () => {
  const pull = { type: 'pull_request', owner: 'acme', repo: 'frontend', number: 456, url: 'https://github.com/acme/frontend/pull/456' };
  const sender = { url: pull.url, tab: { id: 2 } };
  assert.deepEqual(issueForStart(pull, sender, origin), pull);
  assert.throws(() => issueForStart({ ...pull, type: 'issue', url: 'https://github.com/acme/frontend/issues/456' }, sender, origin), /match/i);
});

test('content task switches remain bound to the current page URL', () => {
  assert.equal(taskUrlForStart(issue.url, content, origin), issue.url);
  assert.throws(() => taskUrlForStart('https://github.com/acme/frontend/issues/124', content, origin), /current page/i);
});

test('page-bound Start uses the current tab URL after GitHub SPA navigation', () => {
  const sender = { url: issue.url, tab: { id: 1, url: 'https://github.com/acme/frontend/issues/124?notification_referrer_id=1' } };
  const current = 'https://github.com/acme/frontend/issues/124';
  assert.equal(taskUrlForStart(current, sender, origin), current);
  assert.deepEqual(issueForStart({ ...issue, number: 124, url: current }, sender, origin).url, current);
  assert.throws(() => taskUrlForStart(issue.url, sender, origin), /current page/i);
  assert.throws(() => taskUrlForStart('https://github.com/acme/frontend/issues/125', sender, origin), /current page/i);
});

test('Projects issue pane Start is bound to its selected canonical issue after SPA navigation', () => {
  const pane = 'https://github.com/orgs/acme/projects/3/views/16?pane=issue&itemId=239268027&issue=acme%7Crepo%7C6';
  const sender = { url: 'https://github.com/orgs/acme/projects/3/views/16', tab: { id: 1, url: pane } };
  assert.equal(taskUrlForStart('https://github.com/acme/repo/issues/6', sender, origin), 'https://github.com/acme/repo/issues/6');
  assert.throws(() => taskUrlForStart('https://github.com/acme/repo/issues/7', sender, origin), /current page/i);
  assert.throws(() => taskUrlForStart('https://github.com/acme/repo/pull/6', sender, origin), /current page/i);
  assert.throws(() => taskUrlForStart(pane.replace('issue=acme%7Crepo%7C6', 'issue=other%7Crepo%7C6'), sender, origin), /current page/i);
});

test('page Start does not fall back to the original document when the tab has left the task', () => {
  const sender = { url: issue.url, tab: { id: 1, url: 'https://github.com/acme/frontend' } };
  assert.throws(() => taskUrlForStart(issue.url, sender, origin), /current page/i);
});

test('only extension pages can start an imported identity', () => {
  assert.equal(taskUrlForStart('acme/project/imported-task', extension, origin), 'acme/project/imported-task');
  assert.equal(taskUrlForTimelineSwitch('acme/project/imported-task', extension, origin), 'acme/project/imported-task');
  assert.throws(() => taskUrlForStart('acme/project/imported-task', content, origin), /task URL/i);
  assert.throws(() => taskUrlForTimelineSwitch('acme/project/imported-task', content, origin), /stored record/i);
  assert.throws(() => taskUrlForStart('acme/project/bad task', extension, origin), /task URL/i);
});

test('content timeline switch accepts an imported identity only with a matching stored record', () => {
  const identity = 'manticoresoftware/Routines/1-dev-call';
  const sourceEntry = { id: 'record-1', destinationId: 'github:1', entryDate: '2026-10-12' };
  const records = [{ ...sourceEntry, taskUrl: identity }];
  assert.equal(taskUrlForTimelineSwitch(identity, content, origin, sourceEntry, records), identity);
  for (const invalid of [
    [], [{ ...records[0], id: 'other' }], [{ ...records[0], destinationId: 'github:2' }],
    [{ ...records[0], entryDate: '2026-10-13' }], [{ ...records[0], taskUrl: 'acme/other/task' }],
  ]) assert.throws(() => taskUrlForTimelineSwitch(identity, content, origin, sourceEntry, invalid), /stored record/i);
  assert.throws(() => taskUrlForTimelineSwitch('acme/project/bad task', content, origin, sourceEntry, records), /task URL/i);
});

test('timeline task switching may select a previously tracked task from another GitHub page', () => {
  assert.equal(
    taskUrlForTimelineSwitch('https://github.com/manticoresoftware/site/issues/231', content, origin),
    'https://github.com/manticoresoftware/site/issues/231',
  );
  assert.throws(() => taskUrlForTimelineSwitch('javascript:alert(1)', content, origin), /task URL/i);
});

test('trusted extension pages can perform popup-only operations', () => {
  assert.doesNotThrow(() => assertMessageAllowed('GET_STATE', extension, origin));
  assert.doesNotThrow(() => assertMessageAllowed('GET_PAGE_STATE', extension, origin));
  assert.doesNotThrow(() => assertMessageAllowed('DELETE_ENTRY', extension, origin));
  assert.doesNotThrow(() => assertMessageAllowed('SWITCH_TASK', extension, origin));
  assert.doesNotThrow(() => assertMessageAllowed('RESOLVE_PENDING', extension, origin));
  assert.doesNotThrow(() => assertMessageAllowed('SAVE_CONFIG', extension, origin));
  assert.doesNotThrow(() => assertMessageAllowed('UPDATE_DISPLAY_PREFERENCES', extension, origin));
  assert.doesNotThrow(() => assertMessageAllowed('SET_QUEUE_DIAGNOSTICS', extension, origin));
  assert.doesNotThrow(() => assertMessageAllowed('LOAD_REPORT', extension, origin));
  assert.doesNotThrow(() => assertMessageAllowed('GET_EXCHANGE_RATES', extension, origin));
  assert.doesNotThrow(() => assertMessageAllowed('CANCEL_REPORT', extension, origin));
  for (const type of ['LOAD_TIMES', 'BULK_ADD_TIMES']) {
    assert.equal(assertMessageAllowed(type, extension, origin), 'extension');
    assert.throws(() => assertMessageAllowed(type, content, origin), /not allowed/i);
  }
  assert.throws(() => assertMessageAllowed('SAVE_CONFIG', content, origin), /not allowed/i);
  assert.throws(() => assertMessageAllowed('UPDATE_DISPLAY_PREFERENCES', content, origin), /not allowed/i);
  assert.throws(() => assertMessageAllowed('SET_QUEUE_DIAGNOSTICS', content, origin), /not allowed/i);
  assert.throws(() => assertMessageAllowed('LOAD_REPORT', content, origin), /not allowed/i);
  assert.throws(() => assertMessageAllowed('GET_EXCHANGE_RATES', content, origin), /not allowed/i);
  assert.throws(() => assertMessageAllowed('CANCEL_REPORT', content, origin), /not allowed/i);
  assert.equal(assertMessageAllowed('SWITCH_TASK', content, origin), 'content');
  assert.doesNotThrow(() => assertMessageAllowed('RESOLVE_PENDING', content, origin));
});


test('trusted content-script menu can manage recent entries but cannot access privileged configuration state', () => {
  const sender = { url: 'https://github.com/acme/app/issues/7', tab: { url: 'https://github.com/acme/app/issues/7' } };
  for (const type of ['SYNC', 'LOAD_RECENT', 'EDIT_ENTRIES', 'QUEUE_ENTRIES_EDIT', 'DELETE_ENTRY', 'RESOLVE_PENDING', 'OPEN_REPORTS', 'OPEN_TIMES']) assert.equal(assertMessageAllowed(type, sender, origin), 'content');
  for (const type of ['GET_STATE', 'SAVE_CONFIG']) assert.throws(() => assertMessageAllowed(type, sender, origin), /not allowed/);
  assert.throws(() => assertMessageAllowed('MOVE_BOUNDARY', sender, origin), /not allowed/);
});


test('GitHub App onboarding and credential operations are extension-page only', () => {
  const privileged = [
    'GET_ONBOARDING_STATE', 'START_DEVICE_FLOW', 'OPEN_DEVICE_FLOW_PAGE', 'RESUME_DEVICE_FLOW', 'POLL_DEVICE_FLOW',
    'CANCEL_DEVICE_FLOW', 'CANCEL_GITHUB_APP_SETUP', 'DISCOVER_REPOSITORIES', 'CHECK_REPOSITORY_ACCESS',
    'SELECT_REPOSITORY', 'SET_DEFAULT_DESTINATION', 'REMOVE_DESTINATION', 'DISCONNECT_GITHUB_APP', 'CLEAR_LOCAL_CONFIGURATION', 'SEARCH_INVITEE_USERS', 'INVITE_REPOSITORY_USER', 'REMOVE_REPOSITORY_USER', 'LOAD_REPOSITORY_COLLABORATORS',
    'MERGE_TASKS',
  ];
  for (const type of privileged) {
    assert.equal(assertMessageAllowed(type, extension, origin), 'extension');
    assert.throws(() => assertMessageAllowed(type, content, origin), /not allowed/i);
  }
});


test('repository collaborator read checks sender and configured destination before GitHub access', async () => {
  const worker = await readFile(new URL('../src/background/service-worker.js', import.meta.url), 'utf8');
  const calls = [];
  let pendingFails = false, pendingIncomplete = false;
  const context = vm.createContext({ assertMessageAllowed, chrome: { runtime: { getURL: () => origin } },
    store: {}, requireConfiguredDestinationId: async (_store, id) => {
      calls.push(['destination', id]);
      if (id !== 'github:20') throw new Error('The requested destination is not configured.');
      return id;
    }, configuredSnapshot: async ({ destinationId }) => {
      calls.push(['snapshot', destinationId]); return { config: { repoId: 20 }, auth: { mode: 'github_app' } };
    }, githubForConfig: () => ({
      assertDestinationReachable: async () => { calls.push(['verified']); },
      listRepositoryCollaborators: async () => { calls.push(['listed']); return { users: [{ id: 42, login: 'bob', avatarUrl: null }], hasMore: false }; },
      listRepositoryPendingInvitations: async () => {
        calls.push(['pending']);
        if (pendingFails) throw new Error('No permission');
        return { users: [{ id: 43, login: 'alice', avatarUrl: null }], hasMore: false,
          ...(pendingIncomplete ? { incomplete: true } : {}) };
      },
    }),
  });
  vm.runInContext(worker.slice(worker.indexOf('async function handle('), worker.indexOf('chrome.runtime.onMessage.addListener')), context);
  const request = { type: 'LOAD_REPOSITORY_COLLABORATORS', destinationId: 'github:20' };
  await assert.rejects(context.handle(request, content), /not allowed/i);
  await assert.rejects(context.handle({ ...request, destinationId: 'github:21' }, extension), /not configured/i);
  await assert.rejects(context.handle({ ...request, extra: 'ignored' }, extension), /invalid collaborator request/i);
  assert.deepEqual(calls, [['destination', 'github:21']]);
  assert.deepEqual(JSON.parse(JSON.stringify(await context.handle(request, extension))),
    { users: [{ id: 42, login: 'bob', avatarUrl: null }], hasMore: false,
      pendingUsers: [{ id: 43, login: 'alice', avatarUrl: null }], pendingHasMore: false });
  assert.deepEqual(calls.slice(1), [['destination', 'github:20'], ['snapshot', 'github:20'], ['verified'], ['listed'], ['pending']]);
  pendingIncomplete = true;
  assert.deepEqual(JSON.parse(JSON.stringify(await context.handle(request, extension))),
    { users: [{ id: 42, login: 'bob', avatarUrl: null }], hasMore: false,
      pendingUsers: [{ id: 43, login: 'alice', avatarUrl: null }], pendingHasMore: false, pendingUnavailable: true });
  pendingFails = true;
  assert.deepEqual(JSON.parse(JSON.stringify(await context.handle(request, extension))),
    { users: [{ id: 42, login: 'bob', avatarUrl: null }], hasMore: false, pendingUnavailable: true });
});

test('repository access removal validates payload and sender before loading a destination or mutating', async () => {
  const worker = await readFile(new URL('../src/background/service-worker.js', import.meta.url), 'utf8');
  const calls = [];
  const context = vm.createContext({ assertMessageAllowed, chrome: { runtime: { getURL: () => origin } },
    repositoryInvitationService: async id => { calls.push(id); if (id !== 'github:20') throw new Error('not configured');
      return { remove: async (...args) => { calls.push(args); return { status: 'removed', login: 'Bob' }; } }; },
  });
  vm.runInContext(worker.slice(worker.indexOf('async function handle('), worker.indexOf('chrome.runtime.onMessage.addListener')), context);
  const request = { type: 'REMOVE_REPOSITORY_USER', payload: { destinationId: 'github:20', login: 'Bob', userId: 42, kind: 'collaborator' } };
  await assert.rejects(context.handle(request, content), /not allowed/i);
  for (const payload of [{ ...request.payload, userId: 0 }, { ...request.payload, kind: 'other' },
    { ...request.payload, extra: true }, { ...request.payload, destinationId: 'github:21' }]) {
    await assert.rejects(context.handle({ ...request, payload }, extension));
  }
  assert.deepEqual(calls, ['github:21']);
  assert.deepEqual(JSON.parse(JSON.stringify(await context.handle(request, extension))), { status: 'removed', login: 'Bob' });
  assert.deepEqual(calls, ['github:21', 'github:20', ['Bob', 42, 'collaborator']]);
});

test('any GitHub page can start a URL task only for its exact sender URL', () => {
  const sender = { url: 'https://github.com/acme/app/actions/runs/123?check_suite_focus=true', tab: { id: 9 } };
  assert.equal(assertMessageAllowed('START', sender, origin), 'content');
  assert.equal(taskUrlForStart(sender.url, sender, origin), sender.url);
  assert.throws(() => taskUrlForStart('https://example.com/other', sender, origin), /match/i);
});

test('trusted popup accepts arbitrary HTTP(S) task URLs and rejects unsafe schemes', () => {
  assert.equal(taskUrlForStart('https://example.com/docs/42', extension, origin), 'https://example.com/docs/42');
  assert.throws(() => taskUrlForStart('javascript:alert(1)', extension, origin), /task URL/i);
});


test('GitHub issue query and fragment churn cannot create a second task identity', () => {
  const sender = { url: 'https://github.com/acme/app/issues/7?notification_referrer_id=1#issuecomment-3', tab: { id: 10 } };
  assert.equal(taskUrlForStart('https://github.com/acme/app/issues/7', sender, origin), 'https://github.com/acme/app/issues/7');
});

test('participant totals follow the current GitHub SPA tab URL instead of the original document URL', () => {
  const sender = {
    url: 'https://github.com/manticoresoftware/manticoresearch/issues/4883',
    tab: { id: 10, url: 'https://github.com/manticoresoftware/manticoresearch/issues/4884' },
  };
  assert.equal(
    taskUrlForParticipantLoad('https://github.com/manticoresoftware/manticoresearch/issues/4884', sender, origin),
    'https://github.com/manticoresoftware/manticoresearch/issues/4884',
  );
  assert.throws(
    () => taskUrlForParticipantLoad('https://github.com/manticoresoftware/manticoresearch/issues/4885', sender, origin),
    /current page/i,
  );
});
