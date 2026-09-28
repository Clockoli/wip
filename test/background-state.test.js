import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { TrackerService } from '../src/services/tracker.js';
import { buildActiveTimer, buildEntry } from '../src/domain/records.js';
import { serializeActiveRecord, serializeMonthlyRecords } from '../src/domain/work-records.js';
import { assertMessageAllowed } from '../src/background/message-policy.js';
import { loadDestinationRecords } from '../src/services/reports.js';

const worker = await readFile(new URL('../src/background/service-worker.js', import.meta.url), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const origin = 'chrome-extension://clockoli/';
const sender = { url: `${origin}src/times/times.html`, documentId: 'activity' };
const destinationId = 'github:1';
const registry = { defaultDestinationId: destinationId, destinations: { [destinationId]: {} } };

function installWorkerHandler(context) {
  vm.runInContext(worker.slice(worker.indexOf('function diagnosticError('), worker.indexOf('async function handle(')), context);
  vm.runInContext(worker.slice(worker.indexOf('async function handle('), worker.indexOf('chrome.runtime.onMessage.addListener')), context);
}

test('pending projection includes bounded redacted timing diagnostics only', () => {
  const context = vm.createContext({});
  vm.runInContext(worker.slice(worker.indexOf('function diagnosticError('), worker.indexOf('function destinationSaveConfirmed(')), context);
  const result = plain(context.safePendingProjection({
    id: 'pending', status: 'pending', stage: 'commitCompletion', operation: 'completeTimer', queuedAt: '2026-09-10T16:02:30.000Z', retryCount: 0,
    diagnostics: [
      { at: '2026-09-10T16:02:31.000Z', message: 'GitHub GET /repos/acme/time: 200 in 87ms.' },
      { at: 'invalid', message: 'must not escape' },
      { at: '2026-09-10T16:02:32.000Z', message: 'token=secret' },
    ],
  }, destinationId));
  assert.deepEqual(result.diagnostics, [
    { at: '2026-09-10T16:02:31.000Z', message: 'GitHub GET /repos/acme/time: 200 in 87ms.' },
    { at: '2026-09-10T16:02:32.000Z', message: 'token=[redacted]' },
  ]);
  assert.equal(JSON.stringify(result).includes('secret'), false);
});

test('Activity returns the current safe pending/conflict projection after records load', async () => {
  const state = { user: 'alice', activeCache: null, recentCache: [], pendingWrites: [] };
  const destination = { id: destinationId, owner: 'acme', repo: 'time', label: 'acme/time' };
  const store = { ensureDataVersion: async () => {} };
  const context = vm.createContext({ AbortController, TrackerService, Map,
    store, reportLoads: new Map(), githubForConfig: () => ({}),
    loadCoordinator: { beginLoad: async () => 1, assertCurrent: () => {} },
    configuredSnapshot: async () => ({ registry, auth: { githubLogin: 'alice' }, generation: 1 }),
    selectReadDestinations: () => [destination], destinationUser: async () => 'alice', loadDestinationRecords,
    trackerForDestination: async () => ({ getRecoveryState: async () => ({ pendingWrites: state.pendingWrites, remoteWriteConfirmed: false }) }),
    safePendingProjection: (operation, id) => ({ id: operation.id, destinationId: id, operation: operation.operation, status: operation.status, stage: operation.stage, conflictReason: operation.conflictReason, retryCount: 0 }),
    emitReportProgress: () => {},
    ReportService: class {
      async loadUserRange() {
        state.pendingWrites.push({ id: 'conflict', operation: 'editEntry', status: 'conflict', stage: 'editEntry', conflictReason: 'queued_entry_missing', request: { private: 'not projected' } });
        return [{ id: 'record', startedAt: '2026-09-05T08:00:00Z' }];
      }
    },
  });
  vm.runInContext(worker.slice(worker.indexOf('async function loadTimes('), worker.indexOf('async function loadTasks(')), context);
  const result = plain(await context.loadTimes({ payload: {} }, sender));
  assert.equal(result.recent[0].id, 'record');
  assert.equal(result.recent[0].destinationId, destinationId);
  assert.equal(result.pendingCount, 1);
  assert.deepEqual(result.pendingWrites, [{ id: 'conflict', destinationId, operation: 'editEntry', status: 'conflict', stage: 'editEntry', conflictReason: 'queued_entry_missing', retryCount: 0 }]);
  assert.equal(result.remoteWriteConfirmed, false);
  assert.equal(context.reportLoads.size, 0);
});

test('page state exposes full totals while retaining safe active and pending projections', async () => {
  const active = { id: 'running', taskUrl: 'https://example.org/task', startedAt: '2026-09-05T08:00:00Z', entryDate: '2026-09-05', timezone: 'Asia/Bangkok', private: 'not projected' };
  const tracker = {
    getState: async () => ({ active, recent: [], pendingWrites: [], todayTrackedMs: 3_600_000, weekTrackedMs: 7_200_000, remoteWriteConfirmed: true }),
    loadMenuData: async () => ({ todayTrackedMs: 3_600_000, weekTrackedMs: 7_200_000, remoteWriteConfirmed: true }),
  };
  const context = vm.createContext({ assertMessageAllowed,
    chrome: { runtime: { getURL: () => origin } },
    configuredSnapshot: async () => ({ registry, auth: {} }),
    trackerForDestination: async () => tracker,
    store: {
      getTrackingSnapshot: async () => ({ activeTimer: { destinationId, record: active } }),
      getLocalPreferences: async () => ({ projects: [] }),
    },
  });
  installWorkerHandler(context);
  const result = plain(await context.handle({ type: 'GET_PAGE_STATE', refresh: true }, sender));
  assert.equal(result.todayTrackedMs, 3_600_000);
  assert.equal(result.weekTrackedMs, 7_200_000);
  assert.equal(result.remoteWriteConfirmed, true);
  assert.equal(result.active.entryDate, active.entryDate);
  assert.equal(result.active.timezone, active.timezone);
  assert.equal(Object.hasOwn(result.active, 'private'), false);
  await assert.rejects(() => context.handle({ type: 'LOAD_TIMES' }, { url: 'https://example.org' }), /extension|allowed|trusted/i);
});

test('real page-state handler confirms a used destination without requiring summaries or records in unused ready destinations', async () => {
  const ids = ['github:1', 'github:2', 'github:3'];
  const multiRegistry = { defaultDestinationId: ids[0], destinations: Object.fromEntries(ids.map(id => [id, {}])) };
  const states = new Map([
    [ids[0], { active: null, recent: [{ id: 'saved', _sha: 'sha-1' }], pendingWrites: [], todayTrackedMs: 60_000, weekTrackedMs: 60_000, remoteWriteAttempted: true, remoteWriteConfirmed: true }],
    [ids[1], { active: null, recent: [], pendingWrites: [], todayTrackedMs: null, weekTrackedMs: null, remoteWriteAttempted: false, remoteWriteConfirmed: false }],
    [ids[2], { active: null, recent: [], pendingWrites: [], todayTrackedMs: null, weekTrackedMs: null, remoteWriteAttempted: false, remoteWriteConfirmed: false }],
  ]);
  const context = vm.createContext({ assertMessageAllowed,
    chrome: { runtime: { getURL: () => origin } },
    configuredSnapshot: async () => ({ registry: multiRegistry, auth: {} }),
    trackerForDestination: async id => ({
      getState: async () => structuredClone(states.get(id)),
      loadMenuData: async () => structuredClone(states.get(id)),
    }),
    store: { getTrackingSnapshot: async () => ({ activeTimer: null }), getLocalPreferences: async () => ({ projects: [] }) },
  });
  installWorkerHandler(context);
  const result = plain(await context.handle({ type: 'GET_PAGE_STATE', refresh: false }, sender));
  assert.equal(result.todayTrackedMs, null, 'unused repositories may not have summary caches yet');
  assert.equal(result.remoteWriteConfirmed, true, 'unused repositories are neutral for save confirmation');
  assert.equal(result.pendingCount, 0);
});

test('page state keeps accepted local work available when complete summaries cannot be loaded', async () => {
  const state = { active: { id: 'local', taskUrl: 'https://example.org/task', entryDate: '2026-09-05', timezone: 'UTC', _pending: true }, recent: [], pendingWrites: [{ id: 'queued', status: 'pending' }] };
  const tracker = { getState: async () => state, loadMenuData: async () => { throw new TypeError('Failed to fetch'); } };
  const context = vm.createContext({ assertMessageAllowed, diagnosticError: value => value,
    chrome: { runtime: { getURL: () => origin } },
    configuredSnapshot: async () => ({ registry, auth: {} }),
    trackerForDestination: async () => tracker,
    store: {
      getTrackingSnapshot: async () => ({ activeTimer: { destinationId, record: state.active } }),
      getLocalPreferences: async () => ({ projects: [] }),
    },
  });
  vm.runInContext(worker.slice(worker.indexOf('function serializeError('), worker.indexOf('function authSummary(')), context);
  vm.runInContext(worker.slice(worker.indexOf('const READ_RETRY_MESSAGES'), worker.indexOf('const RECOVERABLE_REPOSITORY_MESSAGES')), context);
  installWorkerHandler(context);
  const result = plain(await context.handle({ type: 'GET_PAGE_STATE', refresh: true }, sender));
  assert.equal(result.active.id, 'local');
  assert.equal(result.pendingCount, 1);
  assert.equal(result.todayTrackedMs, null);
  assert.equal(result.weekTrackedMs, null);
  assert.equal(result.remoteWriteConfirmed, false);
  assert.equal(result.summaryError.message, 'Failed to fetch');
  assert.equal(result.summaryError.recovery, 'read-retry');
});

test('serialized read and mutation failures retain rate-limit retry metadata', () => {
  const context = vm.createContext({});
  vm.runInContext(worker.slice(worker.indexOf('function serializeError('), worker.indexOf('function authSummary(')), context);
  vm.runInContext(worker.slice(worker.indexOf('const READ_RETRY_MESSAGES'), worker.indexOf('const RECOVERABLE_REPOSITORY_MESSAGES')), context);
  const error = { code: 'rate_limit', message: 'Wait', status: 429, retryAt: '2026-09-05T10:42:00Z' };
  for (const [type, recovery] of [['LOAD_TIMES', 'read-retry'], ['GET_PAGE_STATE', 'read-retry'], ['STOP', 'mutation-recovery'], ['RESOLVE_PENDING', 'mutation-recovery']]) {
    assert.deepEqual(plain(context.serializeError(error, { type })), { ...error, recovery });
  }
});

for (const cacheDate of ['today', 'stale', 'absent']) {
  test(`local page state uses the ${cacheDate} summary cache without any GitHub calls`, async () => {
    const now = new Date(2026, 8, 1, 12), hourMs = 3_600_000;
    const state = {
      activeCache: { id: 'running', taskUrl: 'https://example.org/task', startedAt: new Date(now.getTime() - hourMs).toISOString(), entryDate: '2026-09-01', timezone: 'UTC', _sha: 'active-sha' },
      recentCache: [], pendingWrites: [],
      ...(cacheDate === 'absent' ? {} : { summaryCache: {
        reportDate: cacheDate === 'today' ? '2026-09-01' : '2026-08-31',
        weekEntries: [
          { id: 'monday', entryDate: '2026-08-31', startedAt: '2026-08-31T08:00:00Z', endedAt: '2026-08-31T09:00:00Z', _sha: 'monday-sha' },
          { id: 'tuesday', entryDate: '2026-09-01', startedAt: '2026-09-01T08:00:00Z', endedAt: '2026-09-01T09:00:00Z', _sha: 'tuesday-sha' },
        ], computedAt: now.getTime() - 60_000,
      } }),
    };
    const calls = [];
    const github = new Proxy({}, { get: (_, method) => async () => { calls.push(method); throw new TypeError('Unexpected GitHub call'); } });
    const store = {
      getState: async () => structuredClone(state),
      getTrackingSnapshot: async () => ({ activeTimer: { destinationId, record: state.activeCache } }),
      getLocalPreferences: async () => ({ projects: [] }),
    };
    const tracker = new TrackerService({ github, store, user: 'alice', clock: () => now });
    const context = vm.createContext({ assertMessageAllowed, diagnosticError: value => value,
      chrome: { runtime: { getURL: () => origin } },
      configuredSnapshot: async () => ({ registry, auth: {} }),
      trackerForDestination: async () => tracker, store,
    });
    vm.runInContext(worker.slice(worker.indexOf('function serializeError('), worker.indexOf('function authSummary(')), context);
    vm.runInContext(worker.slice(worker.indexOf('const READ_RETRY_MESSAGES'), worker.indexOf('const RECOVERABLE_REPOSITORY_MESSAGES')), context);
    installWorkerHandler(context);
    for (const refresh of [false, undefined]) {
      const result = plain(await context.handle({ type: 'GET_PAGE_STATE', ...(refresh === undefined ? {} : { refresh }) }, sender));
      assert.deepEqual(calls, []);
      assert.equal(result.todayTrackedMs, cacheDate === 'today' ? 2 * hourMs : null);
      assert.equal(result.weekTrackedMs, cacheDate === 'today' ? 3 * hourMs : null);
      assert.equal(Object.hasOwn(result, 'summaryError'), false);
      assert.equal(result.active.id, 'running');
      assert.equal(result.remoteWriteConfirmed, cacheDate === 'today');
    }
  });
}

test('local page state skips network-capable configuration probes as well as tracker reads', async () => {
  const calls = [];
  const network = new Proxy({}, { get: (_, method) => async () => { calls.push(method); throw new Error('Unexpected network probe'); } });
  const state = { activeCache: null, recentCache: [], summaryCache: null, pendingWrites: [], user: 'alice' };
  const store = {
    migrateLegacyPatAuth: async () => {},
    getConfigurationSnapshot: async () => ({ registry, destinationId, config: { owner: 'acme', repo: 'time', storageLogin: 'alice' } }),
    getAuthSnapshot: async () => ({ auth: { githubLogin: 'alice' } }),
    getState: async () => structuredClone(state), ensureDataVersion: async () => structuredClone(state),
    getTrackingSnapshot: async () => ({ activeTimer: null }),
    getLocalPreferences: async () => ({ projects: [] }),
  };
  const tracker = new TrackerService({ github: network, store, user: 'alice' });
  const context = vm.createContext({ assertMessageAllowed, TrackerService,
    chrome: { runtime: { getURL: () => origin } },
    store, configuration: network, githubForConfig: () => network, ReportService: class {},
    trackerForDestination: async () => tracker,
  });
  vm.runInContext(worker.slice(worker.indexOf('async function configuredSnapshot('), worker.indexOf('async function onboardingState(')), context);
  installWorkerHandler(context);
  const result = plain(await context.handle({ type: 'GET_PAGE_STATE', refresh: false }, sender));
  assert.deepEqual(calls, []);
  assert.equal(result.configured, true);
  assert.equal(result.todayTrackedMs, null);
  assert.equal(Object.hasOwn(result, 'summaryError'), false);
});

function pageStateFixture() {
  const state = { activeCache: null, recentCache: [], pendingWrites: [] }, files = new Map();
  const store = {
    getState: async () => structuredClone(state),
    patchState: async patch => { Object.assign(state, structuredClone(patch)); },
    mutateState: async mutate => {
      Object.assign(state, structuredClone(mutate(structuredClone(state)) || {}));
      return structuredClone(state);
    },
    getTrackingSnapshot: async () => ({ activeTimer: state.activeCache ? { destinationId, record: state.activeCache } : null }),
    getLocalPreferences: async () => ({ projects: [] }),
  };
  const github = {
    getText: async path => {
      if (!files.has(path)) throw Object.assign(new Error('not found'), { status: 404 });
      return { text: files.get(path), sha: 'remote-sha', path };
    },
    assertDestinationReachable: async () => {},
  };
  let now = new Date('2026-08-18T10:00:00Z');
  const tracker = new TrackerService({ github, store, user: 'alice', clock: () => now });
  const context = vm.createContext({ assertMessageAllowed, diagnosticError: value => value,
    chrome: { runtime: { getURL: () => origin } }, configuredSnapshot: async () => ({ registry, auth: {} }),
    trackerForDestination: async () => tracker, store,
  });
  vm.runInContext(worker.slice(worker.indexOf('function serializeError('), worker.indexOf('function authSummary(')), context);
  vm.runInContext(worker.slice(worker.indexOf('const READ_RETRY_MESSAGES'), worker.indexOf('const RECOVERABLE_REPOSITORY_MESSAGES')), context);
  installWorkerHandler(context);
  const active = buildActiveTimer({ user: 'alice', taskUrl: 'https://example.org/a', startedAt: '2026-08-18T08:00:00.000Z', timezone: 'UTC' });
  return { state, store, tracker, files, active, advance: () => { now = new Date(now.getTime() + 60_000); },
    read: refresh => context.handle({ type: 'GET_PAGE_STATE', refresh }, sender) };
}

for (const linked of [false, true]) {
  test(`page refresh preserves an accepted ${linked ? 'linked' : 'single'} edit and its totals`, async t => {
    const previousTZ = process.env.TZ;
    process.env.TZ = 'UTC';
    t.after(() => { if (previousTZ === undefined) delete process.env.TZ; else process.env.TZ = previousTZ; });
    const { state, tracker, files, active, read } = pageStateFixture();
    const path = 'times/2026-08/alice.jsonl';
    files.set(path, serializeMonthlyRecords([buildEntry({ active, endedAt: '2026-08-18T09:00:00.000Z' })]));
    await tracker.loadMenuData();
    const request = { path, originalSha: 'remote-sha', index: 0, original: state.recentCache[0], edits: { startedAt: '2026-08-18T07:00:00.000Z' } };
    if (linked) await tracker.queueEntriesEdit({ entries: [request] });
    else await tracker.queueEntryEdit(request);
    for (const refresh of [true, false]) {
      const result = await read(refresh);
      assert.equal(result.recent[0].startedAt, request.edits.startedAt);
      assert.equal(result.recent[0]._pending, true);
      assert.equal(result.todayTrackedMs, 7_200_000);
      assert.equal(result.weekTrackedMs, 7_200_000);
      assert.equal(result.pendingCount, 1);
      assert.equal(result.remoteWriteConfirmed, false);
      assert.equal(state.recentCache[0].startedAt, request.edits.startedAt);
      assert.equal(state.recentCache[0]._pending, true);
    }
  });
}

test('page refresh recomputes confirmation and totals when a switch is accepted during the cache write', async () => {
  const { state, store, tracker, files, active, advance, read } = pageStateFixture();
  files.set('active/alice.json', serializeActiveRecord(active));
  let switched = false;
  const switchDuringWrite = async patch => {
    if (!Object.hasOwn(patch || {}, 'summaryCache') || switched) return;
    switched = true;
    await tracker.switchTask('https://example.org/b', 'B', '', { background: true });
    advance();
  };
  const patchState = store.patchState, mutateState = store.mutateState;
  store.patchState = async patch => { await switchDuringWrite(patch); return patchState(patch); };
  store.mutateState = async mutate => {
    await switchDuringWrite(mutate(await store.getState()));
    return mutateState(mutate);
  };
  const result = await read(true);
  assert.equal(switched, true);
  assert.equal(result.active.id, state.activeCache.id);
  assert.notEqual(result.active.id, active.id);
  assert.equal(result.active._pending, true);
  assert.equal(state.activeCache._sha, null);
  assert.equal(result.pendingCount, 1);
  assert.equal(result.remoteWriteConfirmed, false);
  assert.equal(result.recent[0].id, active.id);
  assert.equal(result.recent[0]._pending, true);
  assert.equal(result.todayTrackedMs, 7_260_000);
  assert.equal(result.weekTrackedMs, 7_260_000);
});
