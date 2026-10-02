import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { assertMessageAllowed } from '../src/background/message-policy.js';
import {
  emitClockifyMigrationProgress,
  isClockifyProgressRequestId,
  registerClockifyMigrationProgressPort,
} from '../src/background/clockify-migration-progress.js';

const worker = await readFile(new URL('../src/background/service-worker.js', import.meta.url), 'utf8');
const origin = 'chrome-extension://clockoli/';
const previewSender = { url: `${origin}src/clockify-migration/preview.html` };
const clockifySender = { url: 'https://app.clockify.me/reports/detailed', tab: { id: 71 } };
const requestId = '123e4567-e89b-42d3-a456-426614174000';

function between(start, end) {
  const first = worker.indexOf(start), last = worker.indexOf(end, first);
  assert.notEqual(first, -1, `missing worker marker: ${start}`);
  assert.notEqual(last, -1, `missing worker marker: ${end}`);
  return worker.slice(first, last);
}

function handlerContext(overrides = {}) {
  const context = vm.createContext({
    Map, Number, Object, Array, JSON, Promise, Error, console,
    assertMessageAllowed,
    isClockifyProgressRequestId,
    CLOCKIFY_MIGRATION_OUTCOME_KEY: 'clockify-migration-import-outcome-v1',
    CLOCKIFY_MIGRATION_SUGGESTIONS_KEY: 'clockify-migration-suggestions-v1',
    chrome: { runtime: { getURL: path => `${origin}${path || ''}` }, tabs: { get: async () => ({ url: 'https://app.clockify.me/reports/detailed?year=2024' }) }, action: { setIcon: async () => {} } },
    clockifyMigrationStorage: { get: async () => null, set: async () => {} },
    clockifyMigrationSession: { peek: async () => null },
    ...overrides,
  });
  vm.runInContext(between('async function handle(', 'chrome.runtime.onMessage.addListener'), context);
  return context;
}

test('Clockify migration confirmation retains the recoverable preview when Clockoli is not configured', async () => {
  let consumed = false;
  const context = handlerContext({
    clockifyMigrationProgressPorts: new Map([[requestId, {}]]),
    clockifyMigrationSession: { consume: async () => { consumed = true; return { users: [], entries: [] }; } },
    configuredSnapshot: async () => ({ config: null, auth: null }),
  });

  await assert.rejects(
    context.handle({ type: 'CONFIRM_CLOCKIFY_MIGRATION', payload: { id: requestId, mappings: [], requestId } }, previewSender),
    /Connect a Clockoli GitHub repository/i,
  );
  assert.equal(consumed, false, 'a configuration failure must not discard the single-use preview');
});

test('Clockify migration confirmation consumes once, imports the exact session data, and forwards narrowed progress', async () => {
  const portMessages = [];
  const sourceUsers = [{ userId: 'clockify-klim', displayName: 'klim - KlimTodrik', entryCount: 1 }];
  const entries = [{ entryId: 'entry-1' }];
  const mappings = [{ sourceUserId: 'clockify-klim', githubLogin: 'KlimTodrik' }];
  const github = { destination: 'configured repository' };
  let consumed = 0, importRequest, persistedOutcome;
  const context = handlerContext({
    clockifyMigrationProgressPorts: new Map([[requestId, { postMessage: message => portMessages.push(message) }]]),
    clockifyMigrationSession: { consume: async id => { consumed += 1; assert.equal(id, requestId); return { users: sourceUsers, entries }; } },
    configuredSnapshot: async () => ({ config: { storageLogin: 'KlimTodrik', defaultBranch: 'main' }, destinationId: 'github:18', auth: { githubUserId: 'github-user', githubLogin: 'fallback-login' } }),
    githubForConfig: config => { assert.equal(config.storageLogin, 'KlimTodrik'); return github; },
    importClockifyOrganization: async request => {
      importRequest = request;
      request.onProgress({ stage: 'writing_records', completed: 1, total: 1, elapsedMs: 42 });
      return [{ sourceUserId: 'clockify-klim', status: 'imported' }];
    },
    clockifyMigrationStorage: { get: async () => null, set: async (key, value) => { persistedOutcome = { key, value }; } },
    isClockifyProgressRequestId,
    emitClockifyMigrationProgress: (ports, id, progress) => {
      assert.equal(id, requestId);
      const port = ports.get(id);
      port.postMessage({ type: 'CLOCKIFY_MIGRATION_PROGRESS', phase: progress.stage, completedUsers: progress.completed, totalUsers: progress.total, elapsedMs: progress.elapsedMs });
    },
  });

  const result = await context.handle({ type: 'CONFIRM_CLOCKIFY_MIGRATION', payload: { id: requestId, mappings, requestId } }, previewSender);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { outcomes: [{ sourceUserId: 'clockify-klim', status: 'imported' }] });
  assert.equal(consumed, 1);
  assert.equal(importRequest.github, github);
  assert.equal(importRequest.sourceBranch, 'main');
  assert.deepEqual(JSON.parse(JSON.stringify(importRequest.sourceUsers)), sourceUsers);
  assert.deepEqual(JSON.parse(JSON.stringify(importRequest.entries)), entries);
  assert.deepEqual(JSON.parse(JSON.stringify(importRequest.mappings)), mappings);
  assert.deepEqual(JSON.parse(JSON.stringify(importRequest.destinationUser)), { id: 'github-user', login: 'KlimTodrik' });
  assert.deepEqual(portMessages, [{ type: 'CLOCKIFY_MIGRATION_PROGRESS', phase: 'writing_records', completedUsers: 1, totalUsers: 1, elapsedMs: 42 }]);
  assert.deepEqual(JSON.parse(JSON.stringify(persistedOutcome)), {
    key: 'clockify-migration-import-outcome-v1',
    value: { id: requestId, destinationId: 'github:18', users: sourceUsers, outcomes: [{ sourceUserId: 'clockify-klim', status: 'imported' }] },
  });
});

test('migration suggestions read full collaborator profiles from the configured default destination', async () => {
  const users = [{ id: 42, login: 'Ada', name: 'Ada Example', avatarUrl: 'https://avatars.githubusercontent.com/u/42?v=4' }];
  const context = handlerContext({
    configuredSnapshot: async () => ({ config: { repo: 'time' }, auth: { mode: 'github_app' }, destinationId: 'github:18' }),
    githubForConfig: config => ({ listRepositoryCollaboratorProfiles: async () => { assert.equal(config.repo, 'time'); return users; } }),
  });
  assert.deepEqual(JSON.parse(JSON.stringify(await context.handle({ type: 'GET_CLOCKIFY_MIGRATION_SUGGESTIONS' }, previewSender))),
    { destinationId: 'github:18', users });
  await assert.rejects(context.handle({ type: 'GET_CLOCKIFY_MIGRATION_SUGGESTIONS' }, clockifySender), /not allowed/i);
  await assert.rejects(context.handle({ type: 'GET_CLOCKIFY_MIGRATION_SUGGESTIONS', destinationId: 'github:99' }, previewSender), /preview page/i);
});

test('opening the mapping page resets GitHub measurement, while an outcome refresh does not', async () => {
  let starts = 0;
  const context = handlerContext({
    clockifyGitHubRequests: { start: async () => { starts++; } },
    clockifyMigrationSession: { peek: async () => ({ id: requestId, data: { users: [{ id: 'a' }], entries: [1] } }) },
  });
  await assert.rejects(context.handle({ type: 'GET_CLOCKIFY_MIGRATION_PREVIEW', measureRequests: true }, clockifySender), /not allowed/i);
  await assert.rejects(context.handle({ type: 'GET_CLOCKIFY_MIGRATION_PREVIEW', measureRequests: true, extra: 1 }, previewSender), /requires the preview page/i);
  assert.equal(starts, 0);
  await context.handle({ type: 'GET_CLOCKIFY_MIGRATION_PREVIEW', measureRequests: true }, previewSender);
  await context.handle({ type: 'GET_CLOCKIFY_MIGRATION_PREVIEW' }, previewSender);
  assert.equal(starts, 1);
});

test('mapping search and collaborator suggestions use measured GitHub clients, not Settings search', async () => {
  const measured = [];
  const context = handlerContext({
    configuredSnapshot: async () => ({ config: { repo: 'time', repoId: 18, installationId: 42 }, auth: { mode: 'github_app', githubUserId: 7 }, destinationId: 'github:18' }),
    requireConfiguredDestinationId: async (_store, id) => id,
    store: {},
    githubForConfig: (_config, options) => {
      measured.push(options?.measureMigration === true);
      return { listRepositoryCollaboratorProfiles: async () => [], request: async () => ({ items: [] }) };
    },
    RepositoryInvitationService: class { constructor({ github }) { this.github = github; } async search() { return []; } },
  });
  vm.runInContext(between('async function repositoryInvitationService(', 'async function contextForDestination('), context);
  await context.handle({ type: 'GET_CLOCKIFY_MIGRATION_SUGGESTIONS' }, previewSender);
  await context.handle({ type: 'SEARCH_CLOCKIFY_GITHUB_USERS', payload: { destinationId: 'github:18', query: 'al' } }, previewSender);
  await context.handle({ type: 'SEARCH_INVITEE_USERS', payload: { destinationId: 'github:18', query: 'al' } }, previewSender);
  assert.deepEqual(measured, [true, true, false]);
});

test('migration suggestions reuse profiles for the same preview, destination and actor across worker restarts', async () => {
  const values = new Map();
  let calls = 0, previewId = requestId, destinationId = 'github:18', actorId = 7, authGeneration = 1;
  const users = [{ id: 42, login: 'Ada', name: 'Ada Example', avatarUrl: 'https://avatars.githubusercontent.com/u/42?v=4' }];
  const storage = { get: async key => values.get(key), set: async (key, value) => { values.set(key, value); } };
  const restart = () => handlerContext({
    clockifyMigrationStorage: storage,
    clockifyMigrationSession: { peek: async () => ({ id: previewId }) },
    configuredSnapshot: async () => ({ config: { repo: 'time', repoId: Number(destinationId.split(':')[1]) }, auth: { githubUserId: actorId }, authGeneration, destinationId }),
    githubForConfig: () => ({ listRepositoryCollaboratorProfiles: async () => { calls++; return users; } }),
  });
  const load = context => context.handle({ type: 'GET_CLOCKIFY_MIGRATION_SUGGESTIONS' }, previewSender);
  assert.deepEqual(JSON.parse(JSON.stringify(await load(restart()))), { destinationId: 'github:18', users });
  assert.deepEqual(JSON.parse(JSON.stringify(await load(restart()))), { destinationId: 'github:18', users });
  assert.equal(calls, 1);
  previewId = '123e4567-e89b-42d3-a456-426614174001'; await load(restart());
  destinationId = 'github:19'; await load(restart());
  actorId = 8; await load(restart());
  assert.equal(calls, 4);
  values.get('clockify-migration-suggestions-v1').savedAt = Date.now() - 5 * 60 * 1000;
  await load(restart());
  assert.equal(calls, 5, 'expired suggestions must be fetched again');
  authGeneration = 2; await load(restart());
  assert.equal(calls, 6, 'new authentication must not reuse an old profile list');
});

test('lean migration search is preview-only, validates its destination and requests no profiles', async () => {
  const calls = [];
  const context = handlerContext({
    repositoryInvitationService: async id => {
      calls.push(id);
      if (id !== 'github:18') throw new Error('The requested destination is not configured.');
      return { search: async (query, options) => {
        calls.push([query, options]);
        return [{ id: 42, login: 'Ada', name: null, avatarUrl: null }];
      } };
    },
  });
  const request = { type: 'SEARCH_CLOCKIFY_GITHUB_USERS', payload: { destinationId: 'github:18', query: 'Ad' } };
  assert.deepEqual(JSON.parse(JSON.stringify(await context.handle(request, previewSender))),
    { users: [{ id: 42, login: 'Ada', name: null, avatarUrl: null }] });
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), ['github:18', ['Ad', { profiles: false }]]);
  for (const sender of [clockifySender, { url: `${origin}src/options/options.html` }]) {
    await assert.rejects(context.handle(request, sender), /not allowed|Invalid migration user search/i);
  }
  for (const payload of [{ ...request.payload, profiles: true }, { ...request.payload, destinationId: 'github:99' }]) {
    await assert.rejects(context.handle({ ...request, payload }, previewSender), /Invalid|not configured/i);
  }
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), ['github:18', ['Ad', { profiles: false }], 'github:99']);
});

test('migration invitation requires persisted successful outcome, matching default destination and preview sender', async () => {
  const calls = [];
  const outcome = { id: requestId, destinationId: 'github:18', outcomes: [
    { sourceUserId: 'clockify-a', status: 'imported', githubUser: { id: 42, login: 'Ada' } },
    { sourceUserId: 'clockify-b', status: 'failed', githubUser: { id: 43, login: 'Bob' } },
  ] };
  let currentId = 'github:18';
  const context = handlerContext({
    clockifyMigrationStorage: { get: async key => { assert.equal(key, 'clockify-migration-import-outcome-v1'); return outcome; } },
    configuredSnapshot: async () => ({ config: { repo: 'time' }, auth: { mode: 'github_app' }, destinationId: currentId }),
    repositoryInvitationService: async id => {
      assert.equal(id, 'github:18');
      return { invite: async (login, id) => { calls.push([login, id]); return { status: 'invited', login }; } };
    },
  });
  const request = (id, sourceUserId) => ({ type: 'INVITE_MIGRATED_USER', payload: { id, sourceUserId } });
  await assert.rejects(context.handle(request(requestId, 'clockify-a'), clockifySender), /not allowed/i);
  await assert.rejects(context.handle(request(requestId, 'clockify-a'), { url: `${origin}src/options/options.html` }), /preview/i);
  await assert.rejects(context.handle(request('wrong', 'clockify-a'), previewSender), /migration/i);
  await assert.rejects(context.handle(request(requestId, 'clockify-b'), previewSender), /successful/i);
  await assert.rejects(context.handle({ ...request(requestId, 'clockify-a'), payload: { id: requestId, sourceUserId: 'clockify-a', login: 'mallory' } }, previewSender), /invitation/i);
  currentId = 'github:19';
  await assert.rejects(context.handle(request(requestId, 'clockify-a'), previewSender), /default time repository/i);
  assert.deepEqual(calls, []);
  currentId = 'github:18';
  assert.deepEqual(JSON.parse(JSON.stringify(await context.handle(request(requestId, 'clockify-a'), previewSender))), { status: 'invited', login: 'Ada' });
  assert.deepEqual(calls, [['Ada', 42]]);
});

test('Clockify migration preview returns a persisted import outcome after worker restart', async () => {
  const outcome = { id: requestId, users: [{ userId: 'clockify-klim', displayName: 'KlimTodrik', entryCount: 1 }], outcomes: [{ sourceUserId: 'clockify-klim', status: 'already_present' }] };
  const context = handlerContext({
    clockifyMigrationSession: { peek: async () => null },
    clockifyMigrationStorage: { get: async key => { assert.equal(key, 'clockify-migration-import-outcome-v1'); return outcome; }, set: async () => {} },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(await context.handle({ type: 'GET_CLOCKIFY_MIGRATION_PREVIEW' }, previewSender))), { outcome });
});

test('Clockify migration progress ignores malformed updates and removes a failed Port subscription', () => {
  const ports = new Map();
  emitClockifyMigrationProgress(ports, 'missing', { stage: 'writing_records', completed: 0, total: 1 });
  const messages = [];
  ports.set('valid', { postMessage: message => messages.push(message) });
  emitClockifyMigrationProgress(ports, 'valid', { stage: 'writing_records', completed: 2, total: 1 });
  assert.deepEqual(messages, []);
  emitClockifyMigrationProgress(ports, 'valid', { stage: 'writing_records', completed: 1, total: 1, elapsedMs: 8 });
  assert.deepEqual(JSON.parse(JSON.stringify(messages)), [{ type: 'CLOCKIFY_MIGRATION_PROGRESS', phase: 'writing_records', completedUsers: 1, totalUsers: 1, elapsedMs: 8 }]);
  ports.set('broken', { postMessage: () => { throw new Error('Port disconnected'); } });
  emitClockifyMigrationProgress(ports, 'broken', { stage: 'writing_records', completed: 1, total: 1 });
  assert.equal(ports.has('broken'), false);
});

test('Clockify progress Ports accept one preview-page subscription and discard stale or malformed connections', () => {
  const listeners = [];
  const ports = new Map();
  registerClockifyMigrationProgressPort({
    id: 'clockoli',
    getURL: path => `${origin}${path}`,
    onConnect: { addListener: listener => listeners.push(listener) },
  }, ports);
  assert.equal(listeners.length, 1);

  const malformed = portFixture({ name: 'CLOCKIFY_MIGRATION_PROGRESS_V1', sender: { id: 'clockoli', url: `${origin}src/clockify-migration/preview.html` } });
  listeners[0](malformed.port);
  malformed.message({ type: 'SUBSCRIBE_CLOCKIFY_MIGRATION_PROGRESS', requestId: 'not-a-uuid' });
  assert.equal(malformed.disconnected(), true);
  assert.equal(ports.size, 0);

  const valid = portFixture({ name: 'CLOCKIFY_MIGRATION_PROGRESS_V1', sender: { id: 'clockoli', url: `${origin}src/clockify-migration/preview.html` } });
  listeners[0](valid.port);
  valid.message({ type: 'SUBSCRIBE_CLOCKIFY_MIGRATION_PROGRESS', requestId });
  assert.equal(valid.disconnected(), false);
  assert.equal(ports.get(requestId), valid.port);
  assert.deepEqual(JSON.parse(JSON.stringify(valid.messages)), [{ type: 'CLOCKIFY_MIGRATION_PROGRESS_SUBSCRIBED' }]);
  valid.disconnect();
  assert.equal(ports.has(requestId), false);

  const acknowledgementFailure = portFixture({ name: 'CLOCKIFY_MIGRATION_PROGRESS_V1', sender: { id: 'clockoli', url: `${origin}src/clockify-migration/preview.html` }, throwOnPost: true });
  listeners[0](acknowledgementFailure.port);
  acknowledgementFailure.message({ type: 'SUBSCRIBE_CLOCKIFY_MIGRATION_PROGRESS', requestId: '123e4567-e89b-42d3-a456-426614174001' });
  assert.equal(acknowledgementFailure.disconnected(), true);
  assert.equal(ports.size, 0);

  const untrusted = portFixture({ name: 'CLOCKIFY_MIGRATION_PROGRESS_V1', sender: { id: 'clockoli', url: `${origin}src/options/options.html` } });
  listeners[0](untrusted.port);
  assert.equal(untrusted.disconnected(), true);
});

function portFixture({ name, sender, throwOnPost = false }) {
  let onMessage, onDisconnect, wasDisconnected = false;
  const messages = [];
  const port = {
    name, sender,
    postMessage: message => {
      if (throwOnPost) throw new Error('Port disconnected');
      messages.push(message);
    },
    disconnect: () => { wasDisconnected = true; },
    onMessage: { addListener: listener => { onMessage = listener; } },
    onDisconnect: { addListener: listener => { onDisconnect = listener; } },
  };
  return {
    port, messages,
    message: value => onMessage(value),
    disconnect: () => onDisconnect(),
    disconnected: () => wasDisconnected,
  };
}

test('Clockify CSV capture discovers with the active tab year, then completes only an annual validated capture plan', async () => {
  const normalized = { users: [{ userId: 'clockify-klim' }], entries: [{ entryId: 'entry-1' }] };
  const observations = [], captures = [];
  let phase = 'discovering';
  const context = handlerContext({
    normalizeClockifyDetailedCsv: async text => { assert.equal(text, 'csv export'); return normalized; },
    clockifyDetailedReportYear: url => { assert.equal(url, 'https://app.clockify.me/reports/detailed?year=2024'); return 2024; },
    clockifyHistoryScan: {
      status: async () => ({ phase }),
      observeYear: async (year, count) => { observations.push([year, count]); return { discovering: false, history: { yearsWithEntries: [2024] } }; },
    },
    clockifyCaptureArm: { arm: async tabId => { assert.equal(tabId, 71); } },
    assertClockifyAnnualDataYear: (data, year) => { assert.equal(data, normalized); assert.equal(year, 2024); },
    completeClockifyCapture: async payload => { captures.push(payload); return { captured: true }; },
  });

  const discovery = await context.handle({ type: 'CLOCKIFY_CAPTURED_CSV', text: 'csv export' }, clockifySender);
  assert.deepEqual(JSON.parse(JSON.stringify(discovery)), { capturing: true, discovering: false, history: { yearsWithEntries: [2024] } });
  assert.deepEqual(observations, [[2024, 1]]);
  assert.deepEqual(captures, []);

  phase = 'capturing';
  assert.deepEqual(await context.handle({ type: 'CLOCKIFY_CAPTURED_CSV', text: 'csv export' }, clockifySender), { captured: true });
  assert.deepEqual(JSON.parse(JSON.stringify(captures)), [{ tabId: 71, year: 2024, data: normalized }]);
});
