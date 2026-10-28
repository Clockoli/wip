import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { mergeTaskCatalogIndexes, taskCandidates } from '../src/services/task-catalog.js';
import { loadDestinationRecords, mergeDestinationRecords } from '../src/services/reports.js';
import { assertMessageAllowed } from '../src/background/message-policy.js';

const origin = 'chrome-extension://clockoli/';
const sender = { url: `${origin}src/times/times.html` };
const content = { url: 'https://github.com/acme/app/issues/1', tab: { url: 'https://github.com/acme/app/issues/1' } };
const worker = await readFile(new URL('../src/background/service-worker.js', import.meta.url), 'utf8');

test('task search is extension-only and rejects input before reading other users', async () => {
  assert.equal(assertMessageAllowed('SEARCH_TASKS', sender, origin), 'extension');
  assert.throws(() => assertMessageAllowed('SEARCH_TASKS', content, origin), /not allowed/i);
  const start = worker.indexOf('async function handle('), end = worker.indexOf('chrome.runtime.onMessage.addListener', start);
  const context = vm.createContext({ assertMessageAllowed, chrome: { runtime: { getURL: () => origin } },
    searchTasks: async () => ({ tasks: [] }) });
  vm.runInContext(worker.slice(start, end), context);
  for (const request of [{ type: 'SEARCH_TASKS', payload: {} }, { type: 'SEARCH_TASKS' },
    { type: 'SEARCH_TASKS', query: {} }, { type: 'SEARCH_TASKS', query: 'a'.repeat(301) }]) {
    await assert.rejects(context.handle(request, sender), /query/i);
  }
  await assert.rejects(context.handle({ type: 'SEARCH_TASKS', query: 'private' }, content), /not allowed/i);
  assert.deepEqual(JSON.parse(JSON.stringify(await context.handle({ type: 'SEARCH_TASKS', query: 'private' }, sender))), { tasks: [] });
});

test('catalog merges users by canonical URL but retains imported destination identity', () => {
  const url = 'https://github.com/acme/app/issues/1';
  const destinationA = { id: 'github:1', owner: 'acme', repo: 'one' };
  const destinationB = { id: 'github:2', owner: 'acme', repo: 'two' };
  const results = [
    { destination: destinationA, records: [
      { id: 'alice-1', user: 'alice', taskUrl: url, taskTitle: 'Old title', startedAt: '2026-01-01', _record: { id: 'alice-1' } },
      { id: 'alice-2', user: 'alice', taskUrl: 'acme/project/slug', taskTitle: 'Imported Alice', startedAt: '2026-01-01', _record: { id: 'alice-2' } },
    ] },
    { destination: destinationB, records: [
      { id: 'bob-1', user: 'bob', taskUrl: url, taskTitle: 'New title', startedAt: '2026-02-01', _record: { id: 'bob-1' } },
      { id: 'bob-2', user: 'bob', taskUrl: 'acme/project/slug', taskTitle: 'Imported Bob', startedAt: '2026-02-01', _record: { id: 'bob-2' } },
    ] },
  ];
  const merged = mergeDestinationRecords(results, [destinationA.id, destinationB.id]);
  const candidates = taskCandidates(merged.records);
  assert.deepEqual(candidates, [
    { taskUrl: 'acme/project/slug', title: 'Imported Alice', destinationId: 'github:1', timeRepository: 'acme/one' },
    { taskUrl: 'acme/project/slug', title: 'Imported Bob', destinationId: 'github:2', timeRepository: 'acme/two' },
    { taskUrl: url, title: 'New title', destinationIds: ['github:1', 'github:2'] },
  ]);
  assert.equal(JSON.stringify(candidates).includes('user'), false);
  assert.equal(JSON.stringify(candidates).includes('_record'), false);
});

test('search catalog omits untitled identities, but retains titled identity provenance', () => {
  const candidates = taskCandidates([
    { taskUrl: 'https://example.org/unknown', taskTitle: '', destinationId: 'one' },
    { taskUrl: 'https://example.org/whitespace', taskTitle: '  ', destinationId: 'one' },
    { taskUrl: 'team/project/imported', taskTitle: '', destinationId: 'one' },
    { taskUrl: 'https://example.org/shared', taskTitle: '', destinationId: 'one' },
    { taskUrl: 'https://example.org/shared', taskTitle: 'Named task', destinationId: 'two' },
    { taskUrl: 'team/project/imported', taskTitle: 'Named import', destinationId: 'two', timeRepository: 'team/time' },
  ]);
  assert.deepEqual(candidates, [
    { taskUrl: 'https://example.org/shared', title: 'Named task', destinationIds: ['one', 'two'] },
    { taskUrl: 'team/project/imported', title: 'Named import', destinationId: 'two', timeRepository: 'team/time' },
  ]);
});

test('identical imported identities remain selectable in each destination', () => {
  assert.deepEqual(taskCandidates([
    { taskUrl: 'team/project/imported', taskTitle: 'Shared', destinationId: 'one', timeRepository: 'team/one', duplicateDestinations: ['two'], duplicateTimeRepositories: ['team/one', 'team/two'] },
  ]), [
    { taskUrl: 'team/project/imported', title: 'Shared', destinationId: 'one', timeRepository: 'team/one' },
    { taskUrl: 'team/project/imported', title: 'Shared', destinationId: 'two', timeRepository: 'team/two' },
  ]);
});

test('conflicted record IDs are omitted rather than turned into task suggestions', () => {
  const url = 'https://example.org/conflicted';
  const merged = mergeDestinationRecords([
    { destination: { id: 'github:1' }, records: [{ id: 'same', taskUrl: url, taskTitle: 'First', _record: { id: 'same', title: 'First' } }] },
    { destination: { id: 'github:2' }, records: [{ id: 'same', taskUrl: url, taskTitle: 'Second', _record: { id: 'same', title: 'Second' } }] },
  ]);
  assert.equal(merged.conflicts.length, 1);
  assert.deepEqual(taskCandidates(merged.records), []);
});

test('index-only search falls back to exact records if IDs overlap across repositories', () => {
  const destinations = [{ id: 'one', label: 'acme/one' }, { id: 'two', label: 'acme/two' }];
  const results = destinations.map(destination => ({ destination, records: [{
    tasks: [{ taskUrl: 'https://example.com/dormant', title: destination.id, recordIds: ['same-id'] }], recordIds: ['same-id'],
  }] }));
  assert.equal(mergeTaskCatalogIndexes(results).fallback, true);
  results[1].records[0].recordIds = ['different-id'];
  results[1].records[0].tasks[0].recordIds = ['different-id'];
  assert.deepEqual(mergeTaskCatalogIndexes(results).records, [
    { taskUrl: 'https://example.com/dormant', title: 'two', destinationIds: ['one', 'two'] },
  ]);
  results[1].destination = results[0].destination;
  results[1].records[0].recordIds = ['same-id'];
  results[1].records[0].tasks[0].recordIds = ['same-id'];
  const sameRepository = mergeTaskCatalogIndexes(results);
  assert.deepEqual(sameRepository.records, []);
  assert.equal(sameRepository.conflicts[0].code, 'record_id_conflict');
  assert.equal(sameRepository.fallback, false, 'monthly merge within a repository cannot prove a duplicate safe');
});

test('same-destination duplicate IDs omit only affected tasks and preserve independent identities', () => {
  const destination = { id: 'one', label: 'acme/one' };
  const results = [{ destination, records: [
    { recordIds: ['same-id', 'unrelated'], tasks: [
      { taskUrl: 'https://example.com/conflicted', title: 'Untrusted', recordIds: ['same-id'] },
      { taskUrl: 'https://example.com/independent', title: 'Still searchable', recordIds: ['unrelated'] },
    ] },
    { recordIds: ['same-id'], tasks: [
      { taskUrl: 'https://example.com/other', title: 'Also untrusted', recordIds: ['same-id'] },
    ] },
  ] }];
  const merged = mergeTaskCatalogIndexes(results);
  assert.deepEqual(merged.records, [
    { taskUrl: 'https://example.com/independent', title: 'Still searchable', destinationIds: ['one'] },
  ]);
  assert.equal(merged.conflicts.length, 1);
  assert.equal(merged.fallback, false);
});

test('untitled index summaries remain available internally without becoming search results', () => {
  const destination = { id: 'one', label: 'acme/one' };
  const result = mergeTaskCatalogIndexes([{ destination, records: [{ recordIds: ['old-id'],
    tasks: [{ taskUrl: 'https://example.org/unnamed', title: '', recordIds: ['old-id'] }] }] }]);
  assert.deepEqual(result.records, []);
  assert.deepEqual(result.indexTasks[0].recordIds, ['old-id'],
    'retaining the original IDs permits pending edits and later title enrichment');
  assert.deepEqual(result.conflicts, []);
});

test('search checks a local unified index first and refreshes all users on a miss', async () => {
  const start = worker.indexOf('async function searchTasks('), end = worker.indexOf('async function cancelReports(', start);
  const destination = { id: 'github:1', owner: 'acme', repo: 'time', defaultBranch: 'main' };
  let saved = null, reads = 0, newTask = false;
  const context = vm.createContext({ AbortController, Map, reportLoads: new Map(), directCompletedWrites: 0,
    loadCoordinator: { beginLoad: async () => 1, assertCurrent() {} },
    store: { ensureDataVersion: async () => {}, getTaskSearchRevision: async () => 0, isTaskSearchDirty: async () => false,
      getTrackingSnapshot: async () => ({ destinationStates: { entries: {} } }),
      getTaskSearchCache: async () => saved, saveTaskSearchCache: async value => { saved = value; return true; } },
    configuredSnapshot: async () => ({ auth: { githubLogin: 'alice' }, generation: 1, authGeneration: 2 }),
    selectReadDestinations: () => [destination], loadDestinationRecords, mergeDestinationRecords,
    mergeTaskCatalogIndexes, taskCandidates, githubForConfig: () => destination,
    ReportService: class { async loadRepositoryTaskCatalog() {
      reads++;
      return { tasks: [{ taskUrl: 'https://example.org/colleague', title: 'Colleague task',
        recordIds: ['bob-1'] }, ...(newTask ? [{ taskUrl: 'https://example.org/new', title: 'New task',
          recordIds: ['bob-2'] }] : [])], recordIds: newTask ? ['bob-1', 'bob-2'] : ['bob-1'] };
    } },
  });
  vm.runInContext(worker.slice(start, end), context);
  const first = await context.searchTasks(sender, 'colleague');
  assert.equal(reads, 1, 'first search builds a complete local snapshot');
  assert.equal(first.tasks[0].title, 'Colleague task');
  const cached = await context.searchTasks(sender, 'colleague');
  assert.equal(reads, 1, 'a hit after a worker restart must not touch GitHub');
  assert.equal(cached.tasks[0].title, 'Colleague task');
  newTask = true;
  const refreshed = await context.searchTasks(sender, 'new task');
  assert.equal(reads, 2, 'a miss rechecks all marked personal branches');
  assert.equal(refreshed.tasks.some(task => task.title === 'New task'), true);
  await context.searchTasks(sender, 'new task');
  assert.equal(reads, 2, 'the refreshed local snapshot serves subsequent hits');
  assert.equal(JSON.stringify(saved).includes('accessToken'), false);
  const snapshot = saved;
  context.store.getTaskSearchCache = async () => null;
  context.store.isTaskSearchDirty = async () => true;
  await context.searchTasks(sender, 'colleague');
  assert.equal(reads, 3, 'dirty catalog forces an authoritative read, not a stale hit');
  assert.equal(saved, snapshot, 'an ordinary search cannot repopulate a cache with an unfinished write');
});

test('exact search fallback detects a within-destination collision before the pending overlay coalesces IDs', async () => {
  const start = worker.indexOf('async function searchTasks('), end = worker.indexOf('async function cancelReports(', start);
  const destinations = [{ id: 'one', owner: 'team', repo: 'one' }, { id: 'two', owner: 'team', repo: 'two' }];
  const context = vm.createContext({ AbortController, Map, Set, reportLoads: new Map(), directCompletedWrites: 0,
    loadCoordinator: { beginLoad: async () => 1, assertCurrent() {} },
    store: { ensureDataVersion: async () => {}, getTaskSearchRevision: async () => 0,
      isTaskSearchDirty: async () => false, getTrackingSnapshot: async () => ({ destinationStates: { entries: {} } }) },
    configuredSnapshot: async () => ({ auth: { githubLogin: 'alice' } }),
    selectReadDestinations: () => destinations, githubForConfig: destination => destination,
    mergeTaskCatalogIndexes, taskCandidates, loadDestinationRecords, mergeDestinationRecords,
    trackerForDestination: async () => ({ projectActivityRecords: async records => ({
      records: [...new Map(records.map(record => [record.id, record])).values()],
    }) }),
    ReportService: class {
      constructor({ github }) { this.github = github; }
      async loadRepositoryTaskCatalog() { return { recordIds: ['same'], tasks: [
        { taskUrl: 'https://example.org/work', title: 'Work', recordIds: ['same'] },
      ] }; }
      async loadRepositoryRange(_range, options) {
        assert.equal(options.preserveDuplicateIds, true);
        return this.github.id === 'one' ? [
          { id: 'same', taskUrl: 'https://example.org/work', taskTitle: 'Old', startedAt: '2025-01-01',
            _record: { id: 'same', title: 'Old' } },
          { id: 'same', taskUrl: 'https://example.org/work', taskTitle: 'New', startedAt: '2025-02-01',
            _record: { id: 'same', title: 'New' } },
        ] : [{ id: 'same', taskUrl: 'https://example.org/work', taskTitle: 'Old', startedAt: '2025-01-01',
          _record: { id: 'same', title: 'Old' } }];
      }
    },
  });
  vm.runInContext(worker.slice(start, end), context);
  const result = await context.searchTasks(sender);
  assert.deepEqual(result.tasks, []);
  assert.equal(result.conflicts[0].code, 'record_id_conflict');
  assert.equal(result.partial, true);
});

test('worker searches verified user branches across destinations and reports partial reads without leaking records', async () => {
  const start = worker.indexOf('async function searchTasks('), end = worker.indexOf('async function cancelReports(', start);
  const calls = []; let failSecond = true, budgetFailures = false, monthlyTooLarge = false;
  let indexedRecordIds = ['bob-1'];
  const destinationA = { id: 'github:1', defaultBranch: 'trunk', owner: 'acme', repo: 'one' };
  const destinationB = { id: 'github:2', defaultBranch: 'main', owner: 'acme', repo: 'two' };
  const context = vm.createContext({ AbortController, Map, reportLoads: new Map(), directCompletedWrites: 0,
    loadCoordinator: { beginLoad: async () => 1, assertCurrent() {} },
    store: { ensureDataVersion: async () => {}, getTaskSearchRevision: async () => 0, isTaskSearchDirty: async () => false,
      getTrackingSnapshot: async () => ({ destinationStates: { entries: {} } }) },
    configuredSnapshot: async () => ({ auth: { githubLogin: 'alice' } }),
    selectReadDestinations: () => [destinationA, destinationB],
    loadDestinationRecords, mergeDestinationRecords, mergeTaskCatalogIndexes, taskCandidates,
    githubForConfig: destination => destination,
    trackerForDestination: async () => ({ projectActivityRecords: async records => ({ records }) }),
    ReportService: class { constructor({ github, cache, concurrency }) {
      this.github = github; this.concurrency = concurrency; assert.ok(cache);
    }
      async loadRepositoryTaskCatalog(options) {
        assert.equal(this.concurrency, 10, 'task search must read ten user indexes in a bounded parallel batch');
        calls.push({ mode: 'index', destination: this.github.id, branch: options.defaultBranch, budgets: options.budgets });
        if (budgetFailures) throw Object.assign(new Error('Too many records'), { code: 'task_scan_budget' });
        if (this.github.id === 'github:2' && failSecond) throw new Error('Repository unavailable');
        return { tasks: [{ taskUrl: 'https://example.org/colleague', title: 'From Bob', recordIds: indexedRecordIds,
          titleSourceId: 'bob-1' }], recordIds: indexedRecordIds };
      }
      async loadRepositoryRange(range, options) {
        calls.push({ mode: 'monthly', destination: this.github.id, branch: options.defaultBranch, range,
          budgets: options.budgets, metadata: options.includeStorageMetadata, concurrency: options.concurrency });
        if (monthlyTooLarge) throw Object.assign(new Error('121 monthly files'), { code: 'task_scan_budget' });
        if (budgetFailures) throw Object.assign(new Error('Too many records'), { code: 'task_scan_budget' });
        if (this.github.id === 'github:2' && failSecond) throw new Error('Repository unavailable');
        return [{ id: 'bob-1', user: 'bob', taskUrl: 'https://example.org/colleague', taskTitle: 'From Bob',
          startedAt: '2026-02-01', description: 'Private note',
          _record: { id: 'bob-1', unknown: this.github.id } }];
      }
    },
  });
  vm.runInContext(worker.slice(start, end), context);
  const data = JSON.parse(JSON.stringify(await context.searchTasks(sender)));
  assert.equal(data.configured, true);
  assert.equal(data.partial, true);
  assert.deepEqual(data.tasks, [{ taskUrl: 'https://example.org/colleague', title: 'From Bob', destinationIds: ['github:1'] }]);
  assert.equal(JSON.stringify(data).includes('Private note'), false);
  assert.deepEqual(calls.map(call => [call.destination, call.branch]), [['github:1', 'trunk'], ['github:2', 'main']]);
  assert.equal(calls[0].mode, 'index', 'indexed history never scans monthly blobs without overlapping IDs');
  assert.equal(calls[0].budgets.maxFiles, 120);
  assert.equal(calls[0].budgets.maxTotalBytes, 30 * 1024 * 1024);
  failSecond = false;
  const conflicting = JSON.parse(JSON.stringify(await context.searchTasks(sender)));
  assert.deepEqual(conflicting.tasks, [], 'different stored bodies with the same ID cannot become suggestions');
  assert.equal(conflicting.conflicts.length, 1);
  assert.equal(conflicting.partial, true);
  assert.equal(calls.filter(call => call.mode === 'monthly').length, 2);
  assert.equal(calls.find(call => call.mode === 'monthly').metadata, true);
  context.store.getTrackingSnapshot = async () => ({ destinationStates: { entries: {
    'github:1': { pendingWrites: [{ id: 'queued' }] },
  } } });
  failSecond = true;
  monthlyTooLarge = true;
  context.trackerForDestination = async () => ({ projectActivityRecords: async records => ({ records: [...records,
    { id: 'queued', taskUrl: 'https://example.org/new', taskTitle: 'Pending task', startedAt: '2026-02-02',
      description: 'Private pending note' },
  ] }) });
  const beforePending = calls.length;
  const pending = JSON.parse(JSON.stringify(await context.searchTasks(sender)));
  assert.equal(pending.partial, true);
  assert.deepEqual(pending.tasks, [
    data.tasks[0], { taskUrl: 'https://example.org/new', title: 'Pending task', destinationIds: ['github:1'] },
  ], 'pending writes must supplement the indexed catalog without erasing old tasks');
  assert.doesNotMatch(JSON.stringify(pending), /Private pending note/);
  assert.deepEqual(calls.slice(beforePending).map(call => call.mode), ['index', 'index'],
    'an unsynced Stop must not force a 121-file monthly scan just to search old tasks');
  context.trackerForDestination = async () => ({ projectActivityRecords: async () => ({
    replacedRecordIds: ['bob-1'], records: [{ id: 'bob-1', taskUrl: 'https://example.org/moved',
      taskTitle: 'Moved task', startedAt: '2026-02-03' }],
  }) });
  const moved = JSON.parse(JSON.stringify(await context.searchTasks(sender)));
  assert.deepEqual(moved.tasks, [
    { taskUrl: 'https://example.org/moved', title: 'Moved task', destinationIds: ['github:1'] },
  ], 'a queued move replaces the indexed identity instead of returning both');
  context.trackerForDestination = async () => ({ projectActivityRecords: async () => ({
    replacedRecordIds: ['bob-1'], records: [],
  }) });
  const deleted = JSON.parse(JSON.stringify(await context.searchTasks(sender)));
  assert.deepEqual(deleted.tasks, [], 'a queued deletion of the only record removes its indexed identity');
  indexedRecordIds = ['bob-1', 'bob-2'];
  const surviving = JSON.parse(JSON.stringify(await context.searchTasks(sender)));
  assert.deepEqual(surviving.tasks, [],
    'another session retains the task in its index, but an empty title is not a searchable suggestion');
  monthlyTooLarge = false;
  context.store.getTrackingSnapshot = async () => ({ destinationStates: { entries: {} } });
  budgetFailures = true;
  await assert.rejects(() => context.searchTasks(sender), error =>
    error.code === 'task_scan_budget' && /history limit/i.test(error.message));
});
