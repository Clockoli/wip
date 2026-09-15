import test from 'node:test';
import assert from 'node:assert/strict';
import { ChromeStore } from '../src/storage/chrome-store.js';

class MemoryBackend {
  constructor(initial = {}) { this.values = new Map(Object.entries(structuredClone(initial))); }
  async getMany(keys) {
    return Object.fromEntries(keys.filter(key => this.values.has(key)).map(key => [key, structuredClone(this.values.get(key))]));
  }
  async setMany(values) { for (const [key, value] of Object.entries(values)) this.values.set(key, structuredClone(value)); }
  async mutateMany(keys, mutate) {
    const mutation = mutate(await this.getMany(keys));
    if (!mutation) return false;
    const next = new Map(this.values);
    for (const key of mutation.delete || []) next.delete(key);
    for (const [key, value] of Object.entries(mutation.set || {})) next.set(key, structuredClone(value));
    this.values = next;
    return structuredClone(mutation.result ?? true);
  }
  snapshot() { return Object.fromEntries([...this.values].map(([key, value]) => [key, structuredClone(value)])); }
}

const legacyConfig = {
  owner: 'acme', repo: 'time-data', repoId: 77, installationId: 88,
  branch: 'clockoli/users/123', defaultBranch: 'main', branchMode: 'custom',
  storageLogin: 'alice', storageBranchVersion: 1, repositoryFormatVersion: 1,
  visibility: 'private', authMode: 'github_app', recentDays: 9, customField: { keep: true },
};

function v5State(overrides = {}) {
  const a = 'github:1', b = 'github:2';
  return {
    dataVersion: 5, configurationGeneration: 4,
    destinationRegistry: { version: 1, defaultDestinationId: a, destinations: { [a]: { id: a }, [b]: { id: b } } },
    destinationStates: { version: 1, entries: {
      [a]: { user: 'alice', recentCache: [{ id: 'a' }], summaryCache: { a: 1 }, pendingWrites: [{ id: 'op-a' }] },
      [b]: { user: 'bob', recentCache: [{ id: 'b' }], summaryCache: { b: 1 }, pendingWrites: [] },
    } }, activeTimer: null, ...overrides,
  };
}

test('unverified onboarding target survives store recreation and stays account-scoped without changing destinations', async () => {
  const initial = v5State();
  const backend = new MemoryBackend(initial);
  await new ChromeStore(backend).saveOnboardingRepositoryChoice('123', 'acme/time-data');
  const reopened = new ChromeStore(backend);
  assert.equal(await reopened.getOnboardingRepositoryChoice('123'), 'acme/time-data');
  assert.equal(await reopened.getOnboardingRepositoryChoice('456'), '');
  assert.deepEqual(backend.snapshot(), { ...initial, onboardingRepositoryChoice: { account: '123', fullName: 'acme/time-data' } });
  await reopened.saveOnboardingRepositoryChoice('123', '');
  assert.equal(await reopened.getOnboardingRepositoryChoice('123'), '');
  assert.deepEqual(backend.values.get('destinationRegistry'), initial.destinationRegistry);
  assert.deepEqual(backend.values.get('destinationStates'), initial.destinationStates);
});

test('lossless v4 migration preserves active, pending, caches, verification, and unknown fields', async () => {
  const active = { id: 'timer', _sha: 'active-sha', unknown: { bytes: [0, 255] } };
  const recent = [{ id: 'done', _pending: true, unknownRoot: 'keep' }];
  const summary = { completedTodayMs: 12, extra: ['keep'] };
  const pending = [{ id: 'op', status: 'conflict', stage: 'appendMonthly', conflictReason: 'sha', baseSha: 'abc', unknown: { keep: true } }];
  const metadata = { repositoryKey: 'old-generation-scope', fetchedAt: 123, entries: { private: { title: 'Keep' } }, extra: 'keep' };
  const report = { version: 2, entries: { 'acme/time-data@clockoli/users/123': { etag: 'one', blobs: { sha: 'bytes' } } } };
  const backend = new MemoryBackend({
    config: legacyConfig, configurationGeneration: 10, dataVersion: 4,
    activeCache: active, recentCache: recent, summaryCache: summary, pendingWrites: pending, user: 'alice',
    onboardingLastVerifiedAt: '2026-09-09T10:00:00.000Z', onboardingVerificationStatus: 'write_verified',
    taskMetadataCache: metadata, reportCache: report,
  });
  const store = new ChromeStore(backend), state = await store.ensureDataVersion(5), id = 'github:77';
  assert.deepEqual(state, { activeCache: active, recentCache: recent, summaryCache: summary, pendingWrites: pending, user: 'alice', dataVersion: 5 });
  assert.deepEqual(await store.destinationStore(id).getState(), state);
  assert.deepEqual(backend.values.get('activeTimer'), { destinationId: id, record: active });
  assert.deepEqual(backend.values.get('repositoryVerification'), { [id]: { lastVerifiedAt: '2026-09-09T10:00:00.000Z', status: 'write_verified' } });
  assert.deepEqual(backend.values.get('taskMetadataCache'), { version: 2, entries: { [`${id}:clockoli/users/123:alice`]: metadata } });
  assert.deepEqual(backend.values.get('reportCache'), report);
});

test('clean v4 migrates to one default destination and removes singleton keys', async () => {
  const backend = new MemoryBackend({ config: legacyConfig, configurationGeneration: 4, dataVersion: 4 });
  const store = new ChromeStore(backend);
  assert.equal((await store.ensureDataVersion(5)).dataVersion, 5);
  assert.deepEqual(await store.getDestinationRegistry(), {
    version: 1, defaultDestinationId: 'github:77',
    destinations: { 'github:77': { id: 'github:77', ...legacyConfig, label: 'acme/time-data' } },
  });
  assert.deepEqual(backend.values.get('destinationStates'), {
    version: 1, entries: { 'github:77': { user: null, recentCache: [], summaryCache: null, pendingWrites: [] } },
  });
  assert.equal(backend.values.get('activeTimer'), null);
  assert.equal(backend.values.get('configurationGeneration'), 5);
  for (const key of ['config', 'activeCache', 'recentCache', 'summaryCache', 'pendingWrites', 'user']) assert.equal(backend.values.has(key), false);
});

test('orphan v4 work without configuration fails with backend byte-for-byte unchanged', async () => {
  const initial = { dataVersion: 4, activeCache: { id: 'orphan' }, recentCache: [{ id: 'done' }], pendingWrites: [{ id: 'op' }], user: 'alice' };
  const backend = new MemoryBackend(initial), before = backend.snapshot(), store = new ChromeStore(backend);
  await assert.rejects(() => store.ensureDataVersion(5), error => error.code === 'incompatible_storage_format');
  assert.deepEqual(backend.snapshot(), before);
});

test('idempotent v5 ensure and staged v4 ensure do not change generation or state', async () => {
  const backend = new MemoryBackend(v5State()), before = backend.snapshot(), store = new ChromeStore(backend);
  assert.equal((await store.ensureDataVersion(5)).dataVersion, 5);
  assert.deepEqual(backend.snapshot(), before);
  assert.equal((await store.ensureDataVersion(4)).dataVersion, 5);
  assert.deepEqual(backend.snapshot(), before);
});

test('future storage version fails closed and remains unchanged', async () => {
  const initial = { ...v5State(), dataVersion: 6, configurationGeneration: 7 };
  const backend = new MemoryBackend(initial), before = backend.snapshot(), store = new ChromeStore(backend);
  await assert.rejects(() => store.ensureDataVersion(5), error => error.code === 'incompatible_storage_format' && /newer|version/i.test(error.message));
  assert.deepEqual(backend.snapshot(), before);
});

test('legacy repoId-less migration persists one stable opaque destination ID', async () => {
  const config = { owner: 'legacy', repo: 'time', branch: 'main', storageLogin: 'alice', unknown: 'keep' };
  const backend = new MemoryBackend({ config, configurationGeneration: 2, dataVersion: 4 }), store = new ChromeStore(backend);
  const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true, value: { getRandomValues: bytes => (bytes.fill(0), bytes) },
  });
  try { await store.ensureDataVersion(5); }
  finally {
    if (cryptoDescriptor) Object.defineProperty(globalThis, 'crypto', cryptoDescriptor);
    else delete globalThis.crypto;
  }
  const first = backend.snapshot(), id = first.destinationRegistry.defaultDestinationId;
  assert.equal(id, 'legacy:00000000-0000-4000-8000-000000000000');
  assert.deepEqual(first.destinationRegistry.destinations[id], { id, ...config, label: 'legacy/time' });
  await store.ensureDataVersion(5);
  assert.equal(backend.values.get('destinationRegistry').defaultDestinationId, id);
});

test('v5 stable identity upgrade atomically rekeys a legacy opaque destination and every local reference', async () => {
  const oldId = 'legacy:00000000-0000-4000-8000-000000000000', active = { id: 'running' };
  const initial = {
    dataVersion: 5, configurationGeneration: 7,
    destinationRegistry: { version: 1, defaultDestinationId: oldId, destinations: {
      [oldId]: { id: oldId, owner: 'acme', repo: 'time', branch: 'main' },
    } },
    destinationStates: { version: 1, entries: { [oldId]: { user: 'alice', recentCache: [], summaryCache: null, pendingWrites: [] } } },
    activeTimer: { destinationId: oldId, record: active },
    repositoryVerification: { [oldId]: { status: 'access_checked', lastVerifiedAt: '2026-09-09T00:00:00.000Z' } },
    projects: [{ id: 'acme', name: 'Acme', substrings: ['acme.test'], destinationId: oldId }],
  };
  const backend = new MemoryBackend(initial), store = new ChromeStore(backend);
  assert.equal(await store.upgradeLegacyRepositoryIdentity(7, { owner: 'acme', repo: 'time', branch: 'main' }, { repoId: 77 }), 8);
  assert.equal((await store.getDestinationRegistry()).defaultDestinationId, 'github:77');
  assert.equal((await store.getDestinationConfiguration('github:77')).repoId, 77);
  assert.deepEqual((await store.getTrackingSnapshot()).activeTimer, { destinationId: 'github:77', record: active });
  assert.equal(backend.values.get('projects')[0].destinationId, 'github:77');
  assert.equal((await store.getRepositoryVerificationMap())['github:77'].status, 'access_checked');
  assert.equal(await store.getDestinationConfiguration(oldId), null);
});

test('v5 personal-branch promotion updates the destination registry without redirecting accepted work', async () => {
  const initial = {
    dataVersion: 5, configurationGeneration: 3,
    destinationRegistry: { version: 1, defaultDestinationId: 'github:77', destinations: {
      'github:77': { id: 'github:77', repoId: 77, owner: 'acme', repo: 'time', branch: 'main' },
    } },
    destinationStates: { version: 1, entries: {
      'github:77': { user: 'alice', recentCache: [{ id: 'old' }], summaryCache: { total: 1 }, pendingWrites: [] },
    } }, activeTimer: null, reportCache: { stale: true }, taskMetadataCache: { stale: true },
  };
  const backend = new MemoryBackend(initial), store = new ChromeStore(backend);
  assert.equal(await store.promoteToUserStorageBranch(3, { owner: 'acme', repo: 'time', branch: 'main' }, {
    branch: 'clockoli/users/7', defaultBranch: 'main', storageLogin: 'alice', storageBranchVersion: 1,
  }), 4);
  assert.equal((await store.getDestinationConfiguration('github:77')).branch, 'clockoli/users/7');
  assert.deepEqual((await store.destinationStore('github:77').getState()).recentCache, []);
  assert.equal(backend.values.get('reportCache'), null);
  assert.equal(backend.values.get('taskMetadataCache'), null);
});

test('destination adapters isolate state and returned snapshots', async () => {
  const backend = new MemoryBackend(v5State()), store = new ChromeStore(backend);
  const a = store.destinationStore('github:1'), b = store.destinationStore('github:2');
  await a.patchState({ activeCache: { id: 'timer-a' }, recentCache: [{ id: 'a2' }] });
  const result = await b.mutateState(state => ({ pendingWrites: [...state.pendingWrites, { id: 'op-b' }] }));
  result.pendingWrites[0].id = 'mutated-copy';
  assert.deepEqual((await a.getState()).activeCache, { id: 'timer-a' });
  assert.equal((await b.getState()).activeCache, null);
  assert.deepEqual((await b.getState()).recentCache, [{ id: 'b' }]);
  assert.deepEqual((await b.getState()).pendingWrites, [{ id: 'op-b' }]);
  assert.deepEqual(backend.values.get('destinationStates').entries['github:1'].summaryCache, { a: 1 });
});

test('active timer is globally exclusive across destinations', async () => {
  const backend = new MemoryBackend(v5State({ activeTimer: { destinationId: 'github:1', record: { id: 'timer-a' } } }));
  const store = new ChromeStore(backend), before = backend.snapshot();
  await assert.rejects(() => store.destinationStore('github:2').patchState({ activeCache: { id: 'timer-b' } }), /another destination|already/i);
  assert.deepEqual(backend.snapshot(), before);
});

test('stale source clear cannot erase an active timer owned by another destination', async () => {
  const activeTimer = { destinationId: 'github:2', record: { id: 'timer-b', _pending: true } };
  const backend = new MemoryBackend(v5State({ activeTimer })), store = new ChromeStore(backend);
  await store.destinationStore('github:1').patchState({ activeCache: null, recentCache: [{ id: 'a-done' }] });
  assert.deepEqual(backend.values.get('activeTimer'), activeTimer);
  assert.deepEqual((await store.destinationStore('github:1').getState()).recentCache, [{ id: 'a-done' }]);
});

test('backend transaction failure leaves migration and destination state unchanged', async () => {
  class FailingBackend extends MemoryBackend {
    constructor(initial, expectedKey) { super(initial); this.expectedKey = expectedKey; }
    async mutateMany(keys, mutate) {
      const mutation = mutate(await this.getMany(keys));
      assert.ok(Object.hasOwn(mutation?.set ?? {}, this.expectedKey));
      throw new Error('injected atomic commit failure');
    }
  }
  const migrationInitial = {
    config: legacyConfig, dataVersion: 4, configurationGeneration: 9,
    activeCache: { id: 'legacy-timer' }, pendingWrites: [{ id: 'legacy-op' }],
  };
  const migrationBackend = new FailingBackend(migrationInitial, 'destinationRegistry');
  const migrationBefore = migrationBackend.snapshot();
  await assert.rejects(() => new ChromeStore(migrationBackend).ensureDataVersion(5), /injected atomic commit failure/);
  assert.deepEqual(migrationBackend.snapshot(), migrationBefore);

  const backend = new FailingBackend(v5State(), 'destinationStates'), before = backend.snapshot(), store = new ChromeStore(backend);
  await assert.rejects(
    () => store.destinationStore('github:1').patchState({ activeCache: { id: 'timer' }, pendingWrites: [{ id: 'new-op' }] }),
    /injected atomic commit failure/,
  );
  assert.deepEqual(backend.snapshot(), before);
});

test('task metadata map isolates destination scopes', async () => {
  const backend = new MemoryBackend({ configurationGeneration: 3 }), store = new ChromeStore(backend);
  const cacheA = { repositoryKey: 'github:1:main:alice', entries: { same: { title: 'A' } } };
  const cacheB = { repositoryKey: 'github:2:main:alice', entries: { same: { title: 'B' } } };
  assert.equal(await store.saveTaskMetadataCache(cacheA, 3), true);
  assert.equal(await store.saveTaskMetadataCache(cacheB, 3), true);
  assert.deepEqual(await store.getTaskMetadataCache(cacheA.repositoryKey), cacheA);
  assert.deepEqual(await store.getTaskMetadataCache(cacheB.repositoryKey), cacheB);
  assert.deepEqual(backend.values.get('taskMetadataCache'), { version: 2, entries: { [cacheA.repositoryKey]: cacheA, [cacheB.repositoryKey]: cacheB } });
});

test('cross-destination switch acceptance atomically moves the global timer and appends both queues', async () => {
  const sourceActive = { id: 'timer-a', startedAt: '2026-09-09T08:00:00Z', _sha: 'active-a' };
  const sourceOperation = { id: 'source-op', operation: 'completeTimer', stage: 'verifyActive', entry: { id: 'timer-a' } };
  const targetOperation = {
    id: 'target-op', operation: 'startTimer', stage: 'awaitSourceCompletion',
    nextActive: { id: 'timer-b' },
    blockedBy: { destinationId: 'github:1', operationId: 'source-op', operation: 'completeTimer' },
  };
  const pendingEntry = { id: 'timer-a', _pending: true }, pendingActive = { id: 'timer-b', _pending: true };
  const backend = new MemoryBackend(v5State({ activeTimer: { destinationId: 'github:1', record: sourceActive } }));
  const store = new ChromeStore(backend);
  const accepted = await store.acceptCrossDestinationSwitch({
    expectedActive: { destinationId: 'github:1', recordId: 'timer-a' },
    source: { destinationId: 'github:1', operation: sourceOperation, pendingEntry },
    target: { destinationId: 'github:2', operation: targetOperation, pendingActive },
  });
  assert.equal(accepted, true);
  assert.deepEqual(backend.values.get('activeTimer'), { destinationId: 'github:2', record: pendingActive });
  assert.deepEqual(backend.values.get('destinationStates').entries['github:1'].pendingWrites, [{ id: 'op-a' }, sourceOperation]);
  assert.deepEqual(backend.values.get('destinationStates').entries['github:1'].recentCache[0], pendingEntry);
  assert.deepEqual(backend.values.get('destinationStates').entries['github:2'].pendingWrites, [targetOperation]);
});

test('cross-destination acceptance CAS and backend failure leave active and queues untouched', async () => {
  const plan = {
    expectedActive: { destinationId: 'github:1', recordId: 'stale' },
    source: { destinationId: 'github:1', operation: { id: 'source', operation: 'completeTimer', stage: 'verifyActive' }, pendingEntry: { id: 'a' } },
    target: { destinationId: 'github:2', operation: { id: 'target', operation: 'startTimer', stage: 'awaitSourceCompletion', nextActive: { id: 'b' }, blockedBy: { destinationId: 'github:1', operationId: 'source', operation: 'completeTimer' } }, pendingActive: { id: 'b' } },
  };
  const initial = v5State({ activeTimer: { destinationId: 'github:1', record: { id: 'actual' } } });
  const backend = new MemoryBackend(initial), store = new ChromeStore(backend), before = backend.snapshot();
  assert.equal(await store.acceptCrossDestinationSwitch(plan), false);
  assert.deepEqual(backend.snapshot(), before);

  class FailingBackend extends MemoryBackend {
    async mutateMany(keys, mutate) { mutate(await this.getMany(keys)); throw new Error('injected atomic commit failure'); }
  }
  const failing = new FailingBackend({ ...initial, activeTimer: { destinationId: 'github:1', record: { id: 'stale' } } });
  const failingBefore = failing.snapshot();
  await assert.rejects(() => new ChromeStore(failing).acceptCrossDestinationSwitch(plan), /injected atomic commit failure/);
  assert.deepEqual(failing.snapshot(), failingBefore);
});

test('a second cross-destination switch reports syncing rather than a GitHub connection failure', async () => {
  const initial = v5State({ activeTimer: { destinationId: 'github:1', record: { id: 'timer-a' } }, destinationStates: { version: 1, entries: {
    'github:1': { user: 'alice', recentCache: [], summaryCache: null, pendingWrites: [] },
    'github:2': { user: 'alice', recentCache: [], summaryCache: null, pendingWrites: [{
      id: 'previous-target', operation: 'startTimer', stage: 'awaitSourceCompletion',
    }] },
  } } });
  const store = new ChromeStore(new MemoryBackend(initial));
  const plan = {
    expectedActive: { destinationId: 'github:1', recordId: 'timer-a' },
    source: {
      destinationId: 'github:1',
      operation: { id: 'source', operation: 'completeTimer', stage: 'verifyActive' },
      pendingEntry: { id: 'timer-a' },
    },
    target: {
      destinationId: 'github:2',
      operation: {
        id: 'target', operation: 'startTimer', stage: 'awaitSourceCompletion', nextActive: { id: 'timer-b' },
        blockedBy: { destinationId: 'github:1', operationId: 'source', operation: 'completeTimer' },
      },
      pendingActive: { id: 'timer-b' },
    },
  };
  await assert.rejects(() => store.acceptCrossDestinationSwitch(plan), error => {
    assert.equal(error.code, 'cross_destination_switch_pending');
    assert.equal(error.message, 'Wait for the previous cross-repository task switch to finish, then try again.');
    return true;
  });
});

test('unblocking a cross-destination start distinguishes duplicate operation IDs by operation type', async () => {
  const sourceQueue = [{ id: 'shared', operation: 'startTimer', stage: 'startNext', status: 'conflict' }];
  const targetQueue = [{
    id: 'target', operation: 'startTimer', stage: 'awaitSourceCompletion', status: 'pending',
    blockedBy: { destinationId: 'github:1', operationId: 'shared', operation: 'completeTimer' },
  }];
  const initial = v5State({ destinationStates: { version: 1, entries: {
    'github:1': { user: 'alice', recentCache: [], summaryCache: null, pendingWrites: sourceQueue },
    'github:2': { user: 'alice', recentCache: [], summaryCache: null, pendingWrites: targetQueue },
  } } });
  const store = new ChromeStore(new MemoryBackend(initial));
  assert.equal(await store.unblockCrossDestinationStart('github:2', 'target'), true);
  const target = (await store.destinationStore('github:2').getState()).pendingWrites[0];
  assert.equal(target.stage, 'startNext');
  assert.equal(Object.hasOwn(target, 'blockedBy'), false);
  assert.deepEqual((await store.destinationStore('github:1').getState()).pendingWrites, sourceQueue);
});

test('current GitHub App registration adds a v5 destination without replacing defaults or accepted work', async () => {
  const initial = v5State({
    auth: { mode: 'github_app', githubUserId: 123, generation: 3 }, authGeneration: 3,
    activeTimer: { destinationId: 'github:1', record: { id: 'timer-a' } },
    repositoryVerification: { 'github:1': { lastVerifiedAt: 'old', status: 'write_verified' } },
  });
  initial.destinationRegistry.destinations['github:1'] = { id: 'github:1', repoId: 1, owner: 'one', repo: 'time', branch: 'users/a', recentDays: 7 };
  initial.destinationRegistry.destinations['github:2'] = { id: 'github:2', repoId: 2, owner: 'two', repo: 'time', branch: 'users/a', recentDays: 7 };
  const backend = new MemoryBackend(initial), store = new ChromeStore(backend), beforeA = await store.destinationStore('github:1').getState();
  const saved = await store.saveGitHubAppConfiguration(
    { repoId: 3, owner: 'three', repo: 'time', branch: 'users/a', recentDays: 9, authMode: 'github_app' },
    { user: 'alice', activeCache: null, recentCache: [], pendingWrites: [], dataVersion: 5, onboardingLastVerifiedAt: 'now', onboardingVerificationStatus: 'access_checked' },
    3,
  );
  assert.equal(saved, 5);
  const snapshot = backend.snapshot();
  assert.equal(snapshot.dataVersion, 5);
  assert.equal(snapshot.destinationRegistry.defaultDestinationId, 'github:1');
  assert.equal(snapshot.destinationRegistry.destinations['github:3'].id, 'github:3');
  assert.deepEqual(await store.destinationStore('github:1').getState(), beforeA);
  assert.deepEqual(snapshot.activeTimer, { destinationId: 'github:1', record: { id: 'timer-a' } });
  assert.deepEqual(snapshot.repositoryVerification['github:3'], { lastVerifiedAt: 'now', status: 'access_checked' });
  assert.equal(Object.hasOwn(snapshot, 'config'), false);
  assert.equal(Object.hasOwn(snapshot, 'activeCache'), false);
});

test('same-destination v5 registration updates coordinates while preserving its state', async () => {
  const initial = v5State({
    auth: { mode: 'github_app', githubUserId: 123, generation: 3 }, authGeneration: 3,
    activeTimer: { destinationId: 'github:1', record: { id: 'timer-a' } },
  });
  initial.destinationRegistry.destinations['github:1'] = { id: 'github:1', repoId: 1, owner: 'old', repo: 'time', branch: 'users/a' };
  const backend = new MemoryBackend(initial), store = new ChromeStore(backend), before = await store.destinationStore('github:1').getState();
  await store.saveGitHubAppConfiguration(
    { repoId: 1, owner: 'renamed', repo: 'time-renamed', branch: 'users/a', authMode: 'github_app' },
    { user: 'alice', dataVersion: 5, onboardingLastVerifiedAt: 'new', onboardingVerificationStatus: 'write_verified' },
    3,
  );
  assert.deepEqual(await store.destinationStore('github:1').getState(), before);
  assert.equal((await store.getDestinationConfiguration('github:1')).owner, 'renamed');
});

test('pending GitHub App promotion is additive and generation checked when no work is accepted', async () => {
  const initial = v5State({
    auth: { mode: 'pat', accessToken: 'old', githubUserId: 123, generation: 4 }, authGeneration: 4,
    pendingAuth: { mode: 'github_app', githubUserId: 123, accessToken: 'new', refreshToken: 'refresh', generation: 2 },
    pendingAuthGeneration: 2,
  });
  initial.destinationStates.entries['github:1'].pendingWrites = [];
  const backend = new MemoryBackend(initial), store = new ChromeStore(backend), beforeStates = structuredClone(initial.destinationStates);
  assert.equal(await store.commitPendingGitHubAppConfiguration({ repoId: 3, owner: 'three', repo: 'time', branch: 'users/a' }, { user: 'alice', dataVersion: 5 }, 1), false);
  assert.deepEqual(backend.snapshot(), initial);
  assert.equal(await store.commitPendingGitHubAppConfiguration({ repoId: 3, owner: 'three', repo: 'time', branch: 'users/a' }, { user: 'alice', dataVersion: 5 }, 2), 5);
  const snapshot = backend.snapshot();
  assert.equal(snapshot.auth.mode, 'github_app');
  assert.equal(snapshot.dataVersion, 5);
  assert.equal(snapshot.activeTimer, null);
  assert.deepEqual(snapshot.destinationStates.entries['github:1'], beforeStates.entries['github:1']);
  assert.deepEqual(snapshot.destinationStates.entries['github:2'], beforeStates.entries['github:2']);
  assert.equal(snapshot.destinationRegistry.defaultDestinationId, 'github:1');
  assert.ok(snapshot.destinationRegistry.destinations['github:3']);
});

test('pending GitHub App promotion atomically rejects newly accepted work in every destination', async () => {
  for (const accepted of [
    { activeTimer: { destinationId: 'github:2', record: { id: 'timer-a' } } },
    { pendingDestinationId: 'github:2', pendingWrites: [{ id: 'queued-a' }] },
  ]) {
    const initial = v5State({
      auth: { mode: 'github_app', githubUserId: 123, generation: 4 }, authGeneration: 4,
      pendingAuth: { mode: 'github_app', githubUserId: 123, generation: 2 }, pendingAuthGeneration: 2,
      ...(accepted.activeTimer ? { activeTimer: accepted.activeTimer } : {}),
    });
    if (accepted.pendingWrites) initial.destinationStates.entries[accepted.pendingDestinationId].pendingWrites = accepted.pendingWrites;
    const backend = new MemoryBackend(initial), store = new ChromeStore(backend), before = backend.snapshot();
    assert.equal(await store.commitPendingGitHubAppConfiguration(
      { repoId: 3, owner: 'three', repo: 'time', branch: 'users/a' },
      { user: 'alice', dataVersion: 5 },
      2,
    ), false);
    assert.deepEqual(backend.snapshot(), before);
  }
});

test('PAT persistence remains v5 and enforces one destination without losing its accepted work', async () => {
  const initial = v5State({
    auth: { mode: 'github_app', githubUserId: 7, githubLogin: 'alice', generation: 3 },
    authGeneration: 3,
    pendingAuthGeneration: 2,
    activeTimer: { destinationId: 'github:1', record: { id: 'running' } },
  });
  const backend = new MemoryBackend(initial), store = new ChromeStore(backend);
  await store.savePatConfiguration(
    { repoId: 1, owner: 'one', repo: 'time', branch: 'users/a', recentDays: 7 },
    'new-secret',
    { user: 'alice', activeCache: { id: 'running' }, recentCache: [{ id: 'a' }], pendingWrites: [{ id: 'op-a' }], dataVersion: 5 },
    { id: 7, login: 'alice' },
  );
  assert.equal(backend.values.get('dataVersion'), 5);
  assert.deepEqual(Object.keys(backend.values.get('destinationRegistry').destinations), ['github:1']);
  assert.equal(backend.values.get('destinationRegistry').defaultDestinationId, 'github:1');
  assert.deepEqual((await store.destinationStore('github:1').getState()).activeCache, { id: 'running' });
  assert.deepEqual((await store.destinationStore('github:1').getState()).pendingWrites, [{ id: 'op-a' }]);
  assert.equal((await store.getAuthSnapshot()).auth.mode, 'pat');
  assert.equal(backend.values.has('config'), false);
  assert.equal(backend.values.has('token'), false);
});

test('v5 display settings preserve routed project identities and explicitly change the default destination', async () => {
  const initial = v5State();
  initial.destinationRegistry.destinations = {
    'github:1': { id: 'github:1', repoId: 1, owner: 'one', repo: 'time', branch: 'users/a', recentDays: 7 },
    'github:2': { id: 'github:2', repoId: 2, owner: 'two', repo: 'time', branch: 'users/a', recentDays: 7 },
  };
  const backend = new MemoryBackend(initial), store = new ChromeStore(backend);
  const projects = [{ id: 'two-project', name: 'Two', substrings: ['example.com/two'], destinationId: 'github:2' }];
  const result = await store.updateDisplayPreferences({ recentDays: 13, projects, otherProjectName: 'General', defaultDestinationId: 'github:2' }, 0);
  assert.equal(result.preferences.defaultDestinationId, 'github:2');
  assert.deepEqual((await store.getLocalPreferences()).projects, projects);
  assert.equal((await store.getLocalPreferences()).recentDays, 13);
  assert.equal((await store.getDestinationRegistry()).defaultDestinationId, 'github:2');
  assert.equal((await store.getConfigurationSnapshot()).config.recentDays, 13);
  await assert.rejects(
    () => store.updateDisplayPreferences({ recentDays: 13, projects: [{ ...projects[0], destinationId: 'github:99' }], defaultDestinationId: 'github:2' }, 1),
    /missing destination/i,
  );
});

test('queue diagnostics updates only its own preference and revision', async () => {
  const initial = v5State({
    settingsRevision: 8, showQueueDiagnostics: false,
    projects: [{ id: 'newer-route', name: 'Newer', substrings: ['example.com/newer'], destinationId: 'github:2' }],
    otherProjectName: 'Concurrent value', localRecentDays: 19,
  });
  const backend = new MemoryBackend(initial), store = new ChromeStore(backend);
  const before = backend.snapshot();
  const result = await store.setQueueDiagnostics(true);
  assert.equal(result.revision, 9);
  assert.equal(result.showQueueDiagnostics, true);
  assert.deepEqual(backend.snapshot(), { ...before, showQueueDiagnostics: true, settingsRevision: 9 });
  assert.equal(backend.values.get('configurationGeneration'), 4);
});

test('default selection and destination removal are atomic and preserve routing safety', async () => {
  const initial = v5State({
    projects: [{ id: 'two', name: 'Two', substrings: ['two.test'], destinationId: 'github:2' }],
    repositoryVerification: { 'github:1': { status: 'write_verified' }, 'github:2': { status: 'access_checked' } },
  });
  const backend = new MemoryBackend(initial), store = new ChromeStore(backend);
  await assert.rejects(() => store.removeDestination('github:2'), /Assign these projects.*Two/i);
  await store.setDefaultDestination('github:2');
  assert.equal((await store.getDestinationRegistry()).defaultDestinationId, 'github:2');
  backend.values.set('projects', []);
  await assert.rejects(() => store.removeDestination('github:2'), /another default time repository/i);
  await store.setDefaultDestination('github:1');
  await store.removeDestination('github:2');
  assert.deepEqual(Object.keys((await store.getDestinationRegistry()).destinations), ['github:1']);
  assert.equal((await store.getRepositoryVerificationMap())['github:2'], undefined);
  assert.equal(backend.values.get('reportCache'), null);
  assert.equal(backend.values.get('taskMetadataCache'), null);
});

test('destination removal blocks active and pending owners without changing storage', async () => {
  const activeBackend = new MemoryBackend(v5State({ activeTimer: { destinationId: 'github:2', record: { id: 'running' } } }));
  const activeStore = new ChromeStore(activeBackend), activeBefore = activeBackend.snapshot();
  await assert.rejects(() => activeStore.removeDestination('github:2'), /Stop the timer/i);
  assert.deepEqual(activeBackend.snapshot(), activeBefore);

  const pendingState = v5State();
  pendingState.destinationStates.entries['github:2'].pendingWrites = [{ id: 'queued' }];
  const pendingBackend = new MemoryBackend(pendingState), pendingStore = new ChromeStore(pendingBackend), pendingBefore = pendingBackend.snapshot();
  await assert.rejects(() => pendingStore.removeDestination('github:2'), /Sync all pending changes/i);
  assert.deepEqual(pendingBackend.snapshot(), pendingBefore);
});

test('v6 settings import routes only to configured destinations and never verifies or replaces references', async () => {
  const initial = v5State({ repositoryVerification: { 'github:1': { status: 'write_verified' } } });
  initial.destinationRegistry.destinations = {
    'github:1': { id: 'github:1', repoId: 1, owner: 'current-one', repo: 'time', branch: 'users/a' },
    'github:2': { id: 'github:2', repoId: 2, owner: 'current-two', repo: 'time', branch: 'users/a' },
  };
  const backend = new MemoryBackend(initial), store = new ChromeStore(backend);
  const text = JSON.stringify({
    format: 'clockoli-settings', version: 6, exportedAt: '2026-09-09T00:00:00.000Z',
    display: { recentDays: 12, otherProjectName: 'General', showQueueDiagnostics: false },
    projects: [{ id: 'team', name: 'Team', substrings: ['github.com/team/'], destinationId: 'github:2' }],
    billing: { rates: {} },
    destinations: {
      'github:1': { repoId: 1, owner: 'exported-one', repo: 'time', branch: 'old' },
      'github:2': { repoId: 2, owner: 'exported-two', repo: 'time', branch: 'old' },
    },
    defaultDestinationId: 'github:2', security: { credentialsIncluded: false },
  });
  const imported = await store.importSettings(text);
  assert.equal(imported.repositoryReferencesVerified, false);
  assert.equal((await store.getDestinationRegistry()).defaultDestinationId, 'github:1');
  assert.equal((await store.getDestinationConfiguration('github:1')).owner, 'current-one');
  assert.deepEqual(backend.values.get('repositoryVerification'), { 'github:1': { status: 'write_verified' } });
  const exported = JSON.parse((await store.exportSettings()).text);
  assert.equal(exported.version, 6);
  assert.equal(exported.security.credentialsIncluded, false);
  assert.equal(exported.destinations['github:1'].owner, 'current-one');
  assert.equal(JSON.stringify(exported).includes('accessToken'), false);

  const invalidValue = JSON.parse(text);
  invalidValue.projects[0].destinationId = 'github:99';
  invalidValue.destinations['github:99'] = { repoId: 99, owner: 'unknown', repo: 'time', branch: 'old' };
  delete invalidValue.destinations['github:2'];
  invalidValue.defaultDestinationId = 'github:99';
  invalidValue.projects.push({ id: 'local', name: 'Local', substrings: ['github.com/local/'], destinationId: 'github:1' });
  invalidValue.billing.rates = { alice: [{ amountMinorPerHour: 15000, currency: 'USD', currencyPosition: 'prefix', startDate: '', endDate: '' }] };
  const partial = await store.importSettings(JSON.stringify(invalidValue));
  assert.equal(partial.recentDays, 12);
  assert.deepEqual(partial.projects.map(project => project.name), ['Local']);
  assert.deepEqual(partial.notRestored, [
    { type: 'repository', destinationId: 'github:99', repository: 'unknown/time', reason: 'not connected in Clockoli on this browser, and backups do not include GitHub credentials' },
    { type: 'project', name: 'Team', destinationId: 'github:99', repository: 'unknown/time', reason: 'not connected in Clockoli on this browser, and backups do not include GitHub credentials' },
  ]);
  assert.equal((await store.getDestinationRegistry()).defaultDestinationId, 'github:1');
  assert.equal((await store.getDestinationConfiguration('github:1')).owner, 'current-one');
  assert.equal((await store.getLocalPreferences()).rates.alice[0].amountMinorPerHour, 15000);
  assert.equal(backend.values.get('repositoryVerification')['github:1'].status, 'write_verified');
});

test('partial routed import with no connected repositories does not create a null destination', async () => {
  const initial = v5State();
  initial.destinationRegistry = { version: 1, defaultDestinationId: null, destinations: {} };
  const backend = new MemoryBackend(initial), store = new ChromeStore(backend);
  const text = JSON.stringify({
    format: 'clockoli-settings', version: 6, exportedAt: '2026-09-09T00:00:00.000Z',
    display: { recentDays: 12, otherProjectName: 'General', showQueueDiagnostics: false },
    projects: [{ id: 'team', name: 'Team', substrings: ['github.com/team/'], destinationId: 'github:99' }],
    billing: { rates: {} },
    destinations: { 'github:99': { repoId: 99, owner: 'unknown', repo: 'time', branch: 'old' } },
    defaultDestinationId: 'github:99', security: { credentialsIncluded: false },
  });
  const imported = await store.importSettings(text);
  assert.deepEqual((await store.getDestinationRegistry()).destinations, {});
  assert.deepEqual(imported.projects, []);
  assert.deepEqual(imported.notRestored.map(item => item.type), ['repository', 'project']);
});

test('ready discovery registration is atomic, additive, idempotent and never promotes candidate auth', async () => {
  const initial = v5State({ auth: { mode: 'github_app', githubUserId: 123 }, authGeneration: 3,
    activeTimer: { destinationId: 'github:1', record: { id: 'running' } } });
  const backend = new MemoryBackend(initial), store = new ChromeStore(backend);
  const config = { ...legacyConfig };
  assert.equal(await store.registerReadyGitHubAppRepositories([config], 3), true);
  const after = backend.snapshot();
  assert.equal(after.destinationRegistry.defaultDestinationId, 'github:1');
  assert.deepEqual(after.activeTimer, initial.activeTimer);
  assert.deepEqual(after.destinationStates.entries['github:1'], initial.destinationStates.entries['github:1']);
  assert.equal(after.destinationStates.entries['github:77'].user, 'alice');
  assert.equal(after.destinationRegistry.destinations['github:77'].branch, 'clockoli/users/123');
  await store.registerReadyGitHubAppRepositories([config], 3);
  assert.deepEqual(backend.snapshot(), after);
  await backend.setMany({ pendingAuth: { mode: 'github_app' } });
  assert.equal(await store.registerReadyGitHubAppRepositories([{ ...config, repoId: 99 }], 3), false);
  assert.equal(await store.registerReadyGitHubAppRepositories([{ ...config, repoId: 99 }], 2), false);
  assert.equal((await store.getDestinationRegistry()).destinations['github:99'], undefined);
});
