import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { assertMessageAllowed } from '../src/background/message-policy.js';
import { createGitHubRateLimitGate } from '../src/api/github-client.js';
import { SerialExecutor } from '../src/background/serial-executor.js';
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
    createGitHubRateLimitGate,
    isClockifyProgressRequestId,
    CLOCKIFY_MIGRATION_OUTCOME_KEY: 'clockify-migration-import-outcome-v1',
    CLOCKIFY_MIGRATION_SUGGESTIONS_KEY: 'clockify-migration-suggestions-v1',
    chrome: { runtime: { getURL: path => `${origin}${path || ''}` }, tabs: { get: async () => ({ url: 'https://app.clockify.me/reports/detailed?year=2024' }) }, action: { setIcon: async () => {} } },
    clockifyMigrationStorage: { get: async () => null, set: async () => {} },
    clockifyMigrationSession: { peek: async () => null },
    clockifyMigrationJobs: { load: async () => null },
    scheduleSyncAlarm: async () => {},
    ...overrides,
  });
  vm.runInContext(between('function migrationDestinationPin(', 'chrome.runtime.onMessage.addListener'), context);
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

test('a migration confirmation cannot occupy the tracking and sync executor', async () => {
  let release;
  const listeners = [], replies = [];
  const context = vm.createContext({
    chrome: { runtime: { getURL: () => origin, onMessage: { addListener: listener => listeners.push(listener) } } },
    executor: new SerialExecutor(), acceptanceExecutor: new SerialExecutor(),
    DIRECT_DEVICE_FLOW_MESSAGES: new Set(),
    withCurrentRepositoryRecovery: (_message, attempt) => attempt(),
    handle: message => message.type === 'CONFIRM_CLOCKIFY_MIGRATION'
      ? new Promise(resolve => { release = resolve; }) : Promise.resolve({ synced: true }),
    serializeError: error => error.message,
  });
  vm.runInContext(between('chrome.runtime.onMessage.addListener((message', 'let pendingSync = null;'), context);
  listeners[0]({ type: 'CONFIRM_CLOCKIFY_MIGRATION' }, previewSender, result => replies.push(['confirm', result]));
  listeners[0]({ type: 'SYNC' }, previewSender, result => replies.push(['sync', result]));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(JSON.parse(JSON.stringify(replies)), [['sync', { ok: true, data: { synced: true } }]]);
  release({ pending: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(replies.length, 2);
});

test('migration roster and status are limited to the exact preview page', async () => {
  const context = handlerContext({ clockifyMigrationSession: { peek: async () => ({ id: requestId, data: { users: [{ userId: 'private-person' }], entries: [] } }) } });
  await assert.rejects(context.handle({ type: 'GET_CLOCKIFY_MIGRATION_PREVIEW' }, { url: `${origin}src/options/options.html` }), /preview page/i);
  const result = await context.handle({ type: 'GET_CLOCKIFY_MIGRATION_PREVIEW' }, previewSender);
  assert.equal(result.id, requestId);
});

test('a new captured preview cannot replace an active durable import job', async () => {
  let active = true, creates = 0;
  const context = vm.createContext({
    clockifyMigrationJobs: { createPreview: async () => { if (active) throw new Error('Migration already pending'); creates++; return { id: requestId }; } },
    completeClockifyHistoryCapture: async options => options.createPreview({ users: [] }),
  });
  vm.runInContext(between('async function completeClockifyCapture(', 'async function onboardingState()'), context);
  await assert.rejects(context.completeClockifyCapture({ tabId: 1, year: 2026, data: {} }), /pending|running/i);
  assert.equal(creates, 0);
  active = false;
  await context.completeClockifyCapture({ tabId: 1, year: 2026, data: {} });
  assert.equal(creates, 1);
});

test('Clockify migration confirmation claims a durable job and checkpoints before publishing the outcome', async () => {
  const portMessages = [];
  const sourceUsers = [{ userId: 'clockify-klim', displayName: 'klim - KlimTodrik', entryCount: 1 }];
  const entries = [{ entryId: 'entry-1' }];
  const mappings = [{ sourceUserId: 'clockify-klim', githubLogin: 'KlimTodrik' }];
  const github = { destination: 'configured repository' };
  const config = { storageLogin: 'KlimTodrik', defaultBranch: 'main', branch: 'clockoli/users/42', owner: 'acme', repo: 'time', repoId: 18 };
  const auth = { githubUserId: 42, githubLogin: 'KlimTodrik' };
  const imported = [{ sourceUserId: 'clockify-klim', githubUser: auth, status: 'imported' }];
  let claimed = 0, importRequest, saved = null, finished = 0;
  const job = { id: requestId, data: { users: sourceUsers, entries }, mappings,
    pin: { destinationId: 'github:18', repoId: 18, owner: 'acme', repo: 'time', branch: 'clockoli/users/42', defaultBranch: 'main', actorId: 42, login: 'KlimTodrik', authGeneration: 0 }, outcomes: [], retryAt: null };
  const context = handlerContext({
    clockifyMigrationProgressPorts: new Map([[requestId, { postMessage: message => portMessages.push(message) }]]),
    clockifyMigrationJobs: {
      claim: async (id, requested, pin) => { claimed++; assert.equal(id, requestId); assert.deepEqual(requested, mappings); assert.deepEqual(JSON.parse(JSON.stringify(pin)), job.pin); saved = job; },
      load: async () => saved,
      checkpoint: async (id, outcome) => { assert.equal(id, requestId); assert.deepEqual(outcome, imported[0]); saved.outcomes.push(outcome); },
      finish: async id => { assert.equal(id, requestId); finished++; saved = null; },
    },
    configuredSnapshot: async () => ({ config, destinationId: 'github:18', auth, authGeneration: 0 }),
    githubForConfig: config => { assert.equal(config.storageLogin, 'KlimTodrik'); return github; },
    importClockifyOrganization: async request => {
      importRequest = request;
      request.onProgress({ stage: 'writing_records', completed: 1, total: 1, elapsedMs: 42 });
      await request.onOutcome(imported[0]);
      return imported;
    },
    isClockifyProgressRequestId,
    emitClockifyMigrationProgress: (ports, id, progress) => {
      assert.equal(id, requestId);
      const port = ports.get(id);
      port.postMessage({ type: 'CLOCKIFY_MIGRATION_PROGRESS', phase: progress.stage, completedUsers: progress.completed, totalUsers: progress.total, elapsedMs: progress.elapsedMs });
    },
  });
  const result = await context.handle({ type: 'CONFIRM_CLOCKIFY_MIGRATION', payload: { id: requestId, mappings, requestId } }, previewSender);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { pending: true });
  while (!finished) await new Promise(resolve => setImmediate(resolve));
  assert.equal(claimed, 1);
  assert.equal(finished, 1);
  assert.equal(importRequest.github, github);
  assert.equal(importRequest.sourceBranch, 'main');
  assert.deepEqual(JSON.parse(JSON.stringify(importRequest.sourceUsers)), sourceUsers);
  assert.deepEqual(JSON.parse(JSON.stringify(importRequest.entries)), entries);
  assert.deepEqual(JSON.parse(JSON.stringify(importRequest.mappings)), mappings);
  assert.deepEqual(JSON.parse(JSON.stringify(importRequest.destinationUser)), { id: 42, login: 'KlimTodrik' });
  assert.deepEqual(portMessages, [{ type: 'CLOCKIFY_MIGRATION_PROGRESS', phase: 'writing_records', completedUsers: 1, totalUsers: 1, elapsedMs: 42 }]);
});

test('a fresh worker resumes only unchecked people and revalidates the pinned destination', async () => {
  const pin = { destinationId: 'github:18', repoId: 18, owner: 'acme', repo: 'time', branch: 'clockoli/users/42',
    defaultBranch: 'main', actorId: 42, login: 'Ada', authGeneration: 0 };
  const config = { repoId: 18, owner: 'acme', repo: 'time', branch: 'clockoli/users/42', defaultBranch: 'main', storageLogin: 'Ada' };
  const auth = { githubUserId: 42, githubLogin: 'Ada' };
  const data = { users: [{ userId: 'a', displayName: 'A', entryCount: 1 }, { userId: 'b', displayName: 'B', entryCount: 1 }], entries: [{ entryId: 'private' }] };
  const mappings = [{ sourceUserId: 'a', githubLogin: 'Ada' }, { sourceUserId: 'b', githubLogin: 'Bob' }];
  const job = { id: requestId, data, mappings, pin, outcomes: [], retryAt: null };
  const imported = [];
  let blocked = true, replayed = 0, finished = 0;
  const jobs = { load: async () => finished ? null : job,
    checkpoint: async (_id, outcome) => { job.outcomes.push(outcome); },
    retry: async () => {}, finish: async () => { finished++; } };
  const worker = () => handlerContext({ clockifyMigrationJobs: jobs, configuredSnapshot: async () => ({
    config: blocked ? { ...config, repo: 'other' } : config, auth, destinationId: 'github:18', authGeneration: 0,
  }), githubForConfig: () => ({}), createGitHubRateLimitGate: () => ({}),
  importClockifyOrganization: async request => {
    replayed++;
    assert.equal(request.completedOutcomes.length, job.outcomes.length);
    for (const mapping of mappings.slice(request.completedOutcomes.length)) {
      const outcome = { sourceUserId: mapping.sourceUserId, status: 'imported', githubUser: { id: 42, login: mapping.githubLogin } };
      await request.onOutcome(outcome); imported.push(outcome);
      if (replayed === 1) throw new Error('worker interrupted after checkpoint');
    }
    return job.outcomes;
  } });
  const first = worker();
  assert.equal(await first.resumeClockifyMigration(), null);
  assert.equal(replayed, 0, 'a changed destination cannot write or resolve identities');
  const status = await first.handle({ type: 'GET_CLOCKIFY_MIGRATION_PREVIEW' }, previewSender);
  assert.equal(status.pending.blocked, true);
  assert.equal(JSON.stringify(status).includes('private'), false, 'entries must not cross into the preview page');
  blocked = false;
  await assert.rejects(worker().resumeClockifyMigration(), /worker interrupted/);
  assert.equal(job.outcomes.length, 1);
  await worker().resumeClockifyMigration();
  assert.deepEqual(imported.map(outcome => outcome.sourceUserId), ['a', 'b']);
  assert.equal(finished, 1);
});

test('migration preflight shares the durable rate-limit gate with record writes', async () => {
  const pin = { destinationId: 'github:18', repoId: 18, owner: 'acme', repo: 'time', branch: 'clockoli/users/42',
    defaultBranch: 'main', actorId: 42, login: 'Ada', authGeneration: 0 };
  const config = { repoId: 18, owner: 'acme', repo: 'time', branch: pin.branch, defaultBranch: 'main', storageLogin: 'Ada' };
  const job = { id: requestId, data: { users: [], entries: [] }, mappings: [], pin, outcomes: [], retryAt: null };
  let gate, savedDeadline = null, finished = false;
  const context = handlerContext({
    clockifyMigrationJobs: { load: async () => finished ? null : job,
      retry: async (_id, value) => { savedDeadline = value; }, finish: async () => { finished = true; } },
    createGitHubRateLimitGate: options => { gate = { ready: async () => options.onReady(),
      pause: async error => { await options.onWait(error.retryAt); await options.onResume(); } }; return gate; },
    configuredSnapshot: async options => {
      if (options?.localOnly) return { config, auth: { githubUserId: 42, githubLogin: 'Ada' }, destinationId: pin.destinationId, authGeneration: 0 };
      assert.equal(options?.rateLimitGate, gate, 'preflight must use the migration gate');
      await gate.pause({ retryAt: new Date(Date.now() + 1000).toISOString() });
      return { config, auth: { githubUserId: 42, githubLogin: 'Ada' }, destinationId: pin.destinationId, authGeneration: 0 };
    },
    scheduleSyncAlarm: async () => {},
    githubForConfig: (_config, options) => { assert.equal(options.rateLimitGate, gate); return {}; },
    importClockifyOrganization: async () => [],
  });
  await context.resumeClockifyMigration();
  assert.equal(savedDeadline, null);
  assert.equal(finished, true);
});

test('a changed connection during a throttle wait blocks the next write without checkpointing', async () => {
  const pin = { destinationId: 'github:18', repoId: 18, owner: 'acme', repo: 'time', branch: 'clockoli/users/42',
    defaultBranch: 'main', actorId: 42, login: 'Ada', authGeneration: 0 };
  const config = { repoId: 18, owner: 'acme', repo: 'time', branch: pin.branch, defaultBranch: 'main', storageLogin: 'Ada' };
  const job = { id: requestId, data: { users: [], entries: [] }, mappings: [], pin, outcomes: [], retryAt: null };
  let gate, owner = 'acme', writes = 0, checkpoints = 0;
  const context = handlerContext({
    clockifyMigrationJobs: { load: async () => job, retry: async () => {}, checkpoint: async () => { checkpoints++; } },
    createGitHubRateLimitGate: options => {
      gate = { ready: options.onReady, pause: async () => { owner = 'other-owner'; await options.onReady(); } };
      return gate;
    },
    configuredSnapshot: async () => ({ config: { ...config, owner }, auth: { githubUserId: 42, githubLogin: 'Ada' }, destinationId: pin.destinationId, authGeneration: 0 }),
    githubForConfig: () => ({ write: async () => { writes++; } }),
    importClockifyOrganization: async ({ github }) => { await gate.pause(); await github.write(); return []; },
  });
  await assert.rejects(context.resumeClockifyMigration(), /restore the original connection/i);
  assert.equal(writes, 0);
  assert.equal(checkpoints, 0);
});

test('a new authentication generation for the same actor pauses the saved migration', async () => {
  const pin = { destinationId: 'github:18', repoId: 18, owner: 'acme', repo: 'time', branch: 'clockoli/users/42',
    defaultBranch: 'main', actorId: 42, login: 'Ada', authGeneration: 1 };
  const config = { repoId: 18, owner: 'acme', repo: 'time', branch: pin.branch, defaultBranch: 'main', storageLogin: 'Ada' };
  const job = { id: requestId, data: { users: [], entries: [] }, mappings: [], pin, outcomes: [], retryAt: null };
  let attempts = 0, generation = 2, repairs = 0, restored = false;
  const context = handlerContext({
    clockifyMigrationJobs: { load: async () => restored ? null : job, finish: async () => {},
      restorePreview: async (id, options) => { assert.equal(id, requestId); assert.equal(options.connectionChanged, true); repairs++; restored = true; return { id: 'new-preview' }; } },
    configuredSnapshot: async () => ({ config, auth: { githubUserId: 42, githubLogin: 'Ada' },
      destinationId: pin.destinationId, authGeneration: generation }),
    githubForConfig: () => ({}), createGitHubRateLimitGate: () => ({}),
    importClockifyOrganization: async () => { attempts++; return []; },
  });
  assert.equal(await context.resumeClockifyMigration(), null);
  assert.equal(attempts, 0);
  const status = await context.handle({ type: 'GET_CLOCKIFY_MIGRATION_PREVIEW' }, previewSender);
  assert.equal(status.pending.blockedReason, 'connection_changed');
  await context.handle({ type: 'RESTORE_CLOCKIFY_MIGRATION_PREVIEW', id: requestId }, previewSender);
  assert.equal(repairs, 1);
  assert.equal(await context.resumeClockifyMigration(), null);
  assert.equal(attempts, 0);
});

test('routine GitHub App token rotation keeps a migration pinned to its original authorization', async () => {
  const pin = { destinationId: 'github:18', repoId: 18, owner: 'acme', repo: 'time', branch: 'clockoli/users/42',
    defaultBranch: 'main', actorId: 42, login: 'Ada', authGeneration: 1, authCandidateId: requestId };
  const config = { repoId: 18, owner: 'acme', repo: 'time', branch: pin.branch, defaultBranch: 'main', storageLogin: 'Ada' };
  const job = { id: requestId, data: { users: [], entries: [] }, mappings: [], pin, outcomes: [], retryAt: null };
  let generation = 2, candidateId = requestId, attempts = 0;
  const context = handlerContext({
    clockifyMigrationJobs: { load: async () => job, finish: async () => {} },
    configuredSnapshot: async () => ({ config, auth: { mode: 'github_app', candidateId, githubUserId: 42, githubLogin: 'Ada' },
      destinationId: pin.destinationId, authGeneration: generation }),
    createGitHubRateLimitGate: options => ({ ready: options.onReady }),
    githubForConfig: () => ({}), importClockifyOrganization: async () => { attempts++; return []; },
  });
  await context.resumeClockifyMigration();
  assert.equal(attempts, 1);
  candidateId = '123e4567-e89b-42d3-a456-426614174001'; generation++;
  assert.equal(await context.resumeClockifyMigration(), null);
  assert.equal(attempts, 1, 'a replacement authorization still blocks writes');
});

test('connection repair cannot delete a job while its import is in flight', async () => {
  const pin = { destinationId: 'github:18', repoId: 18, owner: 'acme', repo: 'time', branch: 'clockoli/users/42',
    defaultBranch: 'main', actorId: 42, login: 'Ada', authGeneration: 1 };
  const config = { repoId: 18, owner: 'acme', repo: 'time', branch: pin.branch, defaultBranch: 'main', storageLogin: 'Ada' };
  const job = { id: requestId, data: { users: [], entries: [] }, mappings: [], pin, outcomes: [], retryAt: null };
  let release, restoreCount = 0, generation = 1;
  const context = handlerContext({
    clockifyMigrationJobs: { load: async () => job, restorePreview: async () => { restoreCount++; } },
    configuredSnapshot: async () => ({ config, auth: { githubUserId: 42, githubLogin: 'Ada' },
      destinationId: pin.destinationId, authGeneration: generation }),
    createGitHubRateLimitGate: () => ({}), githubForConfig: () => ({}),
    importClockifyOrganization: () => new Promise((_resolve, reject) => { release = reject; }),
  });
  const running = context.resumeClockifyMigration();
  while (!release) await new Promise(resolve => setImmediate(resolve));
  generation = 2;
  await assert.rejects(context.handle({ type: 'RESTORE_CLOCKIFY_MIGRATION_PREVIEW', id: requestId }, previewSender), /in progress|in flight|still running/i);
  assert.equal(restoreCount, 0);
  release(new Error('interrupted before checkpoint'));
  await assert.rejects(running, /interrupted before checkpoint/);
  await context.handle({ type: 'RESTORE_CLOCKIFY_MIGRATION_PREVIEW', id: requestId }, previewSender);
  assert.equal(restoreCount, 1);
});

test('unresolved mapping blocks retries and only the preview page can restore an editable preview', async () => {
  const pin = { destinationId: 'github:18', repoId: 18, owner: 'acme', repo: 'time', branch: 'clockoli/users/42',
    defaultBranch: 'main', actorId: 42, login: 'Ada', authGeneration: 0 };
  const config = { repoId: 18, owner: 'acme', repo: 'time', branch: pin.branch, defaultBranch: 'main', storageLogin: 'Ada' };
  const job = { id: requestId, data: { users: [{ userId: 'person', displayName: 'Person', entryCount: 1 }], entries: [] },
    mappings: [{ sourceUserId: 'person', githubLogin: 'missing' }], pin, outcomes: [], retryAt: null };
  let attempts = 0, restores = 0;
  const context = handlerContext({
    clockifyMigrationJobs: { load: async () => job, block: async (id, reason) => { assert.equal(id, requestId); job.blockedReason = reason; },
      restorePreview: async id => { assert.equal(id, requestId); restores++; return { id: 'fresh-preview' }; } },
    configuredSnapshot: async () => ({ config, auth: { githubUserId: 42, githubLogin: 'Ada' }, destinationId: pin.destinationId, authGeneration: 0 }),
    createGitHubRateLimitGate: () => ({ ready: async () => {} }),
    githubForConfig: () => ({}),
    importClockifyOrganization: async () => { attempts++; throw Object.assign(new Error('unresolved'), { code: 'mapping_unresolved' }); },
  });
  await context.resumeClockifyMigration();
  await context.resumeClockifyMigration();
  assert.equal(attempts, 1);
  const status = await context.handle({ type: 'GET_CLOCKIFY_MIGRATION_PREVIEW' }, previewSender);
  assert.equal(status.pending.blockedReason, 'mapping_unresolved');
  assert.equal(JSON.stringify(status).includes('entries'), false);
  await assert.rejects(context.handle({ type: 'RESTORE_CLOCKIFY_MIGRATION_PREVIEW', id: requestId }, clockifySender), /not allowed|preview page/i);
  await assert.rejects(context.handle({ type: 'RESTORE_CLOCKIFY_MIGRATION_PREVIEW', id: requestId, extra: true }, previewSender), /preview page/i);
  assert.deepEqual(JSON.parse(JSON.stringify(await context.handle({ type: 'RESTORE_CLOCKIFY_MIGRATION_PREVIEW', id: requestId }, previewSender))), { id: 'fresh-preview' });
  assert.equal(restores, 1);
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
