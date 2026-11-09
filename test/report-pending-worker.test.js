import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { independentCompletedWrite } from '../src/services/tracker.js';
import { cachedViewRequest } from '../src/background/message-policy.js';

const worker = await readFile(new URL('../src/background/service-worker.js', import.meta.url), 'utf8');
const start = worker.indexOf('async function loadReport('), end = worker.indexOf('async function loadTaskParticipants(', start);
assert.ok(start >= 0 && end > start);

test('cached page reads take live local timer and queue state without GitHub requests', async () => {
  const from = worker.indexOf('function pageSnapshotScope('), to = worker.indexOf('function broadcastLocalPreferencesChanged(', from);
  const stored = { configured: true, tasks: [{ taskUrl: 'https://example.org/one', activeStartedAt: 'old' }],
    records: [{ id: 'old' }], pendingWrites: [], partial: false };
  const store = {
    getPageSnapshot: async () => stored,
    getTrackingSnapshot: async () => ({ destinationStates: { entries: { 'github:1': { pendingWrites: [{ operation: 'editEntry', status: 'pending', entry: { description: 'PRIVATE' } }] } } } }),
    getLocalPreferences: async () => ({ invoicing: { clients: [] } }),
  };
  const context = vm.createContext({ store, cachedViewRequest,
    configuredSnapshot: async () => ({ auth: { mode: 'test' }, generation: 2, authGeneration: 3, registry: { destinations: { 'github:1': {} } } }),
    globalTrackerState: async () => ({ active: { taskUrl: 'https://example.org/one', startedAt: 'now' }, pendingWrites: [{ status: 'pending' }] }),
  });
  vm.runInContext(worker.slice(from, to), context);
  const origin = 'chrome-extension://abc/';
  const range = { startDate: '2026-09-01', endDate: '2026-09-07' };
  const tasks = await context.cachedPageView({ type: 'GET_CACHED_VIEW', kind: 'tasks', range }, { url: `${origin}src/tasks/tasks.html` }, origin);
  assert.equal(tasks.active.startedAt, 'now');
  assert.equal(tasks.tasks[0].activeStartedAt, 'now');
  const reports = await context.cachedPageView({ type: 'GET_CACHED_VIEW', kind: 'reports', range: { ...range, reportingUtc: false } },
    { url: `${origin}src/reports/reports.html` }, origin);
  assert.equal(reports.pendingCount, 1);
  assert.equal(reports.partial, true);
  assert.equal(JSON.stringify(reports).includes('PRIVATE'), false);
});

function reportWorker(pendingByDestination) {
  const destinations = [
    { id: 'github:1', label: 'first', branch: 'main' },
    { id: 'github:2', label: 'second', branch: 'main' },
  ];
  const store = {
    ensureDataVersion: async () => {}, getLocalPreferences: async () => ({}), savePageSnapshot: async () => true,
    getTrackingSnapshot: async () => ({ destinationStates: { entries: Object.fromEntries(
      destinations.map(d => [d.id, { pendingWrites: pendingByDestination[d.id] || [] }]),
    ) } }),
  };
  const context = vm.createContext({
    AbortController, store, reportLoads: new Map(), pageSnapshotScope: () => ({}),
    loadCoordinator: { beginLoad: async () => 1, assertCurrent: () => {} },
    configuredSnapshot: async () => ({ auth: { mode: 'test' } }),
    selectReadDestinations: (_snapshot, payload) => destinations.filter(d => !payload.destinationIds || payload.destinationIds.includes(d.id)),
    destinationUser: async () => 'alice', githubForConfig: () => ({}), emitReportProgress: () => {},
    ReportService: class { async loadRepositoryRange() { return []; } },
    loadDestinationRecords: async (selected, read) => {
      for (const d of selected) await read(d, new AbortController().signal);
      return { records: [{ id: 'remote-only' }], partial: false, readStatus: [], conflicts: [] };
    },
    withoutInternalMetadata: x => x,
  });
  vm.runInContext(worker.slice(start, end), context);
  return context;
}

test('report flags locally accepted work and conflicts without exposing queued record bodies', async () => {
  const pending = {
    'github:1': [{ id: 'first', status: 'conflict', stage: 'editEntry', operation: 'editEntry',
      conflictReason: 'queued_entry_missing', request: { original: { description: 'PRIVATE' } } }],
    'github:2': [{ id: 'second', status: 'pending', stage: 'addTime', operation: 'addTime',
      entry: { description: 'PRIVATE' } }],
  };
  const context = reportWorker(pending);
  const report = await context.loadReport({ payload: { startDate: '2026-10-01', endDate: '2026-10-31' } });
  assert.equal(report.pendingCount, 2);
  assert.equal(report.partial, true);
  assert.deepEqual(JSON.parse(JSON.stringify(report.pendingWrites.map(x => x.status))), ['conflict', 'pending']);
  assert.equal(JSON.stringify(report).includes('PRIVATE'), false);
  assert.deepEqual(JSON.parse(JSON.stringify(report.records)), [{ id: 'remote-only' }]);
  const selected = await context.loadReport({ payload: { destinationIds: ['github:2'] } });
  assert.equal(selected.pendingCount, 1);
  pending['github:2'] = [];
  const complete = await context.loadReport({ payload: { destinationIds: ['github:2'] } });
  assert.equal(complete.pendingCount, 0);
  assert.equal(complete.partial, false);
});

test('a conflicted edit with an independent queued write keeps the background sync alarm runnable', () => {
  const first = worker.indexOf('function hasRunnablePending('), last = worker.indexOf('async function shouldContinuePendingSync(', first);
  assert.ok(first >= 0 && last > first);
  const context = vm.createContext({ independentCompletedWrite });
  vm.runInContext(worker.slice(first, last), context);
  const blocked = { operation: 'editEntry', status: 'conflict', stage: 'editEntry', conflictReason: 'queued_entry_missing',
    request: { original: { id: 'first', startedAt: '2026-10-29T08:00:00Z', endedAt: '2026-10-29T16:00:00Z' }, edits: {} } };
  const separate = { operation: 'addTime', status: 'pending', entry: {
    id: 'second', startedAt: '2026-10-30T08:00:00Z', endedAt: '2026-10-30T16:00:00Z',
  } };
  assert.equal(context.hasRunnablePending([blocked, separate]), true);
  assert.equal(context.hasRunnablePending([blocked, { ...separate, entry: {
    ...separate.entry, startedAt: '2026-10-29T15:00:00Z', endedAt: '2026-10-29T17:00:00Z',
  } }]), false, 'overlap remains a dependency');
  assert.equal(context.hasRunnablePending([{ ...blocked, conflictReason: 'queued_write_auth' }, separate]), false,
    'a repository-wide refusal is not bypassed');
});
