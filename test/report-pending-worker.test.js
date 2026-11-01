import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { independentCompletedWrite } from '../src/services/tracker.js';

const worker = await readFile(new URL('../src/background/service-worker.js', import.meta.url), 'utf8');
const start = worker.indexOf('async function loadReport('), end = worker.indexOf('async function loadTaskParticipants(', start);
assert.ok(start >= 0 && end > start);

function reportWorker(pendingByDestination) {
  const destinations = [
    { id: 'github:1', label: 'first', branch: 'main' },
    { id: 'github:2', label: 'second', branch: 'main' },
  ];
  const store = {
    ensureDataVersion: async () => {}, getLocalPreferences: async () => ({}),
    getTrackingSnapshot: async () => ({ destinationStates: { entries: Object.fromEntries(
      destinations.map(d => [d.id, { pendingWrites: pendingByDestination[d.id] || [] }]),
    ) } }),
  };
  const context = vm.createContext({
    AbortController, store, reportLoads: new Map(),
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
