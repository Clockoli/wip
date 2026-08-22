import test from 'node:test';
import assert from 'node:assert/strict';
import { ChromeStore } from '../src/storage/chrome-store.js';
import { CredentialBroker } from '../src/auth/github-app-auth.js';

class MemoryBackend {
  constructor() { this.values = new Map(); }
  async getMany(keys) { return Object.fromEntries(keys.filter(key => this.values.has(key)).map(key => [key, structuredClone(this.values.get(key))])); }
  async setMany(values) { for (const [key, value] of Object.entries(values)) this.values.set(key, structuredClone(value)); }
  async setManyAndIncrement(values, counterKey) {
    const next = (this.values.get(counterKey) ?? 0) + 1;
    await this.setMany({ ...values, [counterKey]: next });
    return next;
  }
  async setManyIfEqual(compareKey, expected, values) {
    if ((this.values.get(compareKey) ?? 0) !== expected) return false;
    await this.setMany(values);
    return true;
  }
  async mutateMany(keys, mutate) {
    const current = Object.fromEntries(keys.filter(key => this.values.has(key)).map(key => [key, structuredClone(this.values.get(key))]));
    const mutation = mutate(current);
    if (!mutation) return false;
    for (const key of mutation.delete || []) this.values.delete(key);
    await this.setMany(mutation.set || {});
    return mutation.result ?? true;
  }
  async deleteMany(keys) { for (const key of keys) this.values.delete(key); }
}

test('extension store persists config, token, caches, and queue through an isolated backend', async () => {
  const backend = new MemoryBackend();
  const store = new ChromeStore(backend);
  await store.saveConfig({ owner: 'acme', repo: 'time-data' }, 'secret-token');
  await store.patchState({ user: 'alice', pendingWrites: [{ id: 'one' }] });
  assert.deepEqual(await store.getConfig(), { config: { owner: 'acme', repo: 'time-data' }, token: 'secret-token' });
  assert.deepEqual(await store.getState(), { activeCache: null, recentCache: [], pendingWrites: [{ id: 'one' }], user: 'alice', dataVersion: 0 });
  await store.saveConfiguration({ owner: 'next', repo: 'time-data' }, 'next-token', { user: 'bob', activeCache: null, recentCache: [] });
  assert.deepEqual(await store.getConfig(), { config: { owner: 'next', repo: 'time-data' }, token: 'next-token' });
  assert.equal((await store.getState()).user, 'bob');
  await store.clearConfig();
  assert.deepEqual(await store.getConfig(), { config: null, token: '' });
  assert.deepEqual(await store.getState(), { activeCache: null, recentCache: [], pendingWrites: [], user: null, dataVersion: 0 });
});


test('unsupported old data with accepted work fails closed without clearing it', async () => {
  const backend = new MemoryBackend(), store = new ChromeStore(backend);
  await store.saveConfig({ owner: 'acme', repo: 'time-data' }, 'secret-token');
  const accepted = { user: 'alice', activeCache: { old: true }, recentCache: [{ old: true }], pendingWrites: [{ old: true }], dataVersion: 1 };
  await store.patchState(accepted);
  await assert.rejects(() => store.ensureDataVersion(2), error => error.code === 'incompatible_storage_format' && /cannot safely migrate/i.test(error.message));
  const state = await store.getState();
  assert.deepEqual(state, accepted);
  assert.deepEqual(await store.getConfig(), { config: { owner: 'acme', repo: 'time-data' }, token: 'secret-token' });
});


test('report cache is repository-scoped, persisted separately, and cleared with configuration', async () => {
  const backend = new MemoryBackend(), store = new ChromeStore(backend);
  const cache = { version: 1, repositoryKey: 'acme/time@main', etag: '"one"', files: [], blobs: {} };
  await store.saveReportCache(cache);
  assert.deepEqual(await store.getReportCache('acme/time@main'), cache);
  assert.equal(await store.getReportCache('other/time@main'), null);
  await store.clearConfig();
  assert.equal(await store.getReportCache('acme/time@main'), null);
});

test('v2 pending completions migrate to monthly paths without losing active state', async () => {
  const backend = new MemoryBackend(), store = new ChromeStore(backend);
  const activeCache = { startedAt: '2026-08-18T08:00:00Z' };
  await store.patchState({ activeCache, recentCache: [{ old: true }], pendingWrites: [{
    operation: 'completeTimer', dailyPath: 'times/2026-08-18/alice.txt', id: 'one', stage: 'appendDaily',
  }], dataVersion: 2 });
  const state = await store.ensureDataVersion(3);
  assert.deepEqual(state.activeCache, activeCache);
  assert.deepEqual(state.recentCache, []);
  assert.deepEqual(state.pendingWrites, [{ operation: 'completeTimer', monthlyPath: 'times/2026-08/alice.txt', id: 'one', stage: 'appendMonthly' }]);
});

test('v2 migration refuses to silently discard an unrecognized pending completion', async () => {
  const backend = new MemoryBackend(), store = new ChromeStore(backend);
  await store.patchState({ pendingWrites: [{ operation: 'completeTimer', dailyPath: '../unsafe.txt' }], dataVersion: 2 });
  await assert.rejects(() => store.ensureDataVersion(3), /Cannot migrate a pending completion/);
  assert.equal((await store.getState()).dataVersion, 2);
});

test('task metadata cache is repository-scoped and cleared with configuration', async () => {
  const backend = new MemoryBackend(), store = new ChromeStore(backend);
  const cache = { repositoryKey: 'acme/time@main', fetchedAt: 123, entries: { 'https://github.com/acme/app/issues/1': { title: 'One', status: 'OPEN' } } };
  await store.saveTaskMetadataCache(cache);
  assert.deepEqual(await store.getTaskMetadataCache('acme/time@main'), cache);
  assert.equal(await store.getTaskMetadataCache('other/time@main'), null);
  await store.clearConfig();
  assert.equal(await store.getTaskMetadataCache('acme/time@main'), null);
});

test('configuration generation and metadata invalidation commit atomically', async () => {
  const backend = new MemoryBackend(), store = new ChromeStore(backend);
  await store.saveTaskMetadataCache({ repositoryKey: 'old-scope', entries: { private: true } });
  const first = await store.saveConfiguration({ owner: 'acme', repo: 'time' }, 'token-one', { taskMetadataCache: null });
  assert.equal(first, 1);
  assert.equal(await store.getConfigurationGeneration(), 1);
  assert.equal(await store.getTaskMetadataCache('old-scope'), null);
  const second = await store.saveConfiguration({ owner: 'acme', repo: 'time' }, 'token-two', { taskMetadataCache: null });
  assert.equal(second, 2);
  assert.deepEqual(await store.getConfigurationSnapshot(), {
    config: { owner: 'acme', repo: 'time' }, token: 'token-two', generation: 2,
  });
});

test('display preference updates only recentDays and rotates configuration generation', async () => {
  const backend = new MemoryBackend(), store = new ChromeStore(backend);
  const config = { owner: 'acme', repo: 'time', branch: 'main', recentDays: 7, repoId: 77 };
  await store.saveConfiguration(config, 'token-one', { recentCache: [{ id: 'accepted' }], pendingWrites: [{ id: 'pending' }] });
  const generation = await store.updateDisplayPreferences({ recentDays: 14 });
  assert.equal(generation, 2);
  assert.deepEqual((await store.getConfigurationSnapshot()).config, { ...config, recentDays: 14 });
  assert.deepEqual((await store.getState()).recentCache, [{ id: 'accepted' }]);
  assert.deepEqual((await store.getState()).pendingWrites, [{ id: 'pending' }]);
  await assert.rejects(() => store.updateDisplayPreferences({ recentDays: 0 }), /between 1 and 31/i);
});

test('stale task loads cannot repopulate metadata after a configuration generation change', async () => {
  const backend = new MemoryBackend(), store = new ChromeStore(backend);
  await store.saveConfiguration({ owner: 'acme', repo: 'time' }, 'token-one', { taskMetadataCache: null });
  assert.equal(await store.saveTaskMetadataCache({ repositoryKey: 'scope:g1', entries: {} }, 1), true);
  await store.saveConfiguration({ owner: 'acme', repo: 'time' }, 'token-two', { taskMetadataCache: null });
  assert.equal(await store.saveTaskMetadataCache({ repositoryKey: 'scope:g1', entries: { leaked: true } }, 1), false);
  assert.equal(await store.getTaskMetadataCache('scope:g1'), null);
  assert.equal(await store.patchStateIfGeneration({ user: 'stale-user' }, 1), false);
  assert.equal((await store.getState()).user, null);
});


test('legacy PAT credentials migrate atomically to explicit auth mode without changing configuration', async () => {
  const backend = new MemoryBackend(), store = new ChromeStore(backend);
  await store.saveConfig({ owner: 'acme', repo: 'time-data', branch: 'main' }, 'legacy-secret');
  const migrated = await store.migrateLegacyPatAuth();
  assert.equal(migrated.mode, 'pat');
  assert.equal(migrated.accessToken, 'legacy-secret');
  assert.equal(migrated.generation, 1);
  assert.equal(backend.values.has('token'), false);
  assert.deepEqual(backend.values.get('config'), { owner: 'acme', repo: 'time-data', branch: 'main' });
  assert.deepEqual(await store.getAuthSnapshot(), {
    auth: migrated, authGeneration: 1, configurationGeneration: 0,
  });
});

test('Device Flow attempt and GitHub App authorization commit through background-owned storage', async () => {
  const backend = new MemoryBackend(), store = new ChromeStore(backend);
  const attempt = { id: 'attempt-one', deviceCode: 'secret-device', userCode: 'ABCD-EFGH', nextPollAt: 5_000 };
  await store.saveDeviceAttempt(attempt);
  assert.deepEqual(await store.getDeviceAttempt(), attempt);
  assert.equal(await store.saveAuthorizedGitHubApp({
    mode: 'github_app', githubUserId: 123, githubLogin: 'alice', accessToken: 'access', refreshToken: 'refresh',
  }, 'wrong-attempt'), false);
  assert.deepEqual(await store.getDeviceAttempt(), attempt);
  assert.equal(await store.saveAuthorizedGitHubApp({
    mode: 'github_app', githubUserId: 123, githubLogin: 'alice', accessToken: 'access', refreshToken: 'refresh',
  }, 'attempt-one'), true);
  assert.equal(await store.getDeviceAttempt(), null);
  assert.equal((await store.getAuthSnapshot()).auth, null, 'candidate authorization does not replace active credentials');
  assert.deepEqual((await store.getPendingAuthSnapshot()).auth, {
    mode: 'github_app', candidateId: 'attempt-one', githubUserId: 123, githubLogin: 'alice', accessToken: 'access', refreshToken: 'refresh', generation: 1,
  });
});

test('token rotation follows auth generation and survives configuration-only changes', async () => {
  const backend = new MemoryBackend(), store = new ChromeStore(backend);
  await backend.setMany({
    auth: { mode: 'github_app', accessToken: 'old', refreshToken: 'old-refresh', generation: 3 },
    authGeneration: 3, configurationGeneration: 7,
  });
  const next = { mode: 'github_app', accessToken: 'new', refreshToken: 'new-refresh' };
  assert.equal(await store.rotateGitHubAppAuth(2, 7, next), false);
  assert.equal(await store.rotateGitHubAppAuth(3, 6, next), true);
  assert.deepEqual(await store.getAuthSnapshot(), {
    auth: { ...next, generation: 4 }, authGeneration: 4, configurationGeneration: 7,
  });
  assert.equal(await store.rotateGitHubAppAuth(3, 7, { ...next, accessToken: 'stale' }), false);
  assert.equal((await store.getAuthSnapshot()).auth.accessToken, 'new');
});

test('clearing a stale Device Flow attempt cannot remove its replacement', async () => {
  const backend = new MemoryBackend(), store = new ChromeStore(backend);
  await store.saveDeviceAttempt({ id: 'new-attempt', deviceCode: 'new-secret' });
  await store.clearDeviceAttempt('old-attempt');
  assert.equal((await store.getDeviceAttempt()).id, 'new-attempt');
  await store.clearDeviceAttempt('new-attempt');
  assert.equal(await store.getDeviceAttempt(), null);
});


test('validated GitHub App setup atomically commits candidate auth and configuration', async () => {
  const backend = new MemoryBackend(), store = new ChromeStore(backend);
  await backend.setMany({
    auth: { mode: 'pat', accessToken: 'old-pat', generation: 4 }, authGeneration: 4,
    pendingAuth: { mode: 'github_app', githubUserId: 123, githubLogin: 'alice', accessToken: 'app-token', refreshToken: 'app-refresh', generation: 2 },
    pendingAuthGeneration: 2, configurationGeneration: 8,
    config: { owner: 'old', repo: 'time', branch: 'main' },
  });
  assert.equal(await store.commitPendingGitHubAppConfiguration(
    { owner: 'new', repo: 'time', branch: 'main', repoId: 77, installationId: 88, storageLogin: 'alice' },
    { user: 'alice', taskMetadataCache: null }, 1,
  ), false);
  assert.equal((await store.getAuthSnapshot()).auth.mode, 'pat');
  assert.equal(await store.commitPendingGitHubAppConfiguration(
    { owner: 'new', repo: 'time', branch: 'main', repoId: 77, installationId: 88, storageLogin: 'alice' },
    { user: 'alice', taskMetadataCache: null }, 2,
  ), 9);
  assert.deepEqual(await store.getAuthSnapshot(), {
    auth: { mode: 'github_app', githubUserId: 123, githubLogin: 'alice', accessToken: 'app-token', refreshToken: 'app-refresh', generation: 5 },
    authGeneration: 5, configurationGeneration: 9,
  });
  assert.equal((await store.getPendingAuthSnapshot()).auth, null);
  assert.equal(backend.values.has('token'), false);
  assert.equal(backend.values.get('config').repoId, 77);
});

test('local disconnect rotates generations but preserves destination and accepted local work', async () => {
  const backend = new MemoryBackend(), store = new ChromeStore(backend);
  await backend.setMany({
    auth: { mode: 'github_app', accessToken: 'app-token', refreshToken: 'app-refresh', generation: 3 }, authGeneration: 3,
    configurationGeneration: 6, config: { owner: 'acme', repo: 'time', branch: 'main' },
    activeCache: null, pendingWrites: [], recentCache: [{ id: 'kept' }],
  });
  assert.equal(await store.removeCurrentAuthentication(2), false);
  assert.equal(await store.removeCurrentAuthentication(3), true);
  assert.equal((await store.getAuthSnapshot()).auth, null);
  assert.deepEqual((await store.getConfig()).config, { owner: 'acme', repo: 'time', branch: 'main' });
  assert.deepEqual((await store.getState()).recentCache, [{ id: 'kept' }]);
  assert.equal(await store.getConfigurationGeneration(), 7);
});


test('Device Flow attempt stage replacement is compare-and-swap protected', async () => {
  const backend = new MemoryBackend(), store = new ChromeStore(backend);
  await store.saveDeviceAttempt({ id: 'current', status: 'pending' });
  assert.equal(await store.replaceDeviceAttempt('stale', { id: 'stale', status: 'token_received' }), false);
  assert.deepEqual(await store.getDeviceAttempt(), { id: 'current', status: 'pending' });
  assert.equal(await store.replaceDeviceAttempt('current', { id: 'current', status: 'token_received', provisionalAuth: { accessToken: 'secret' } }), true);
  assert.equal((await store.getDeviceAttempt()).status, 'token_received');
});


test('clearing pending authorization retains a monotonic generation tombstone', async () => {
  const backend = new MemoryBackend(), store = new ChromeStore(backend);
  await backend.setMany({
    pendingAuth: { mode: 'github_app', accessToken: 'alice', generation: 4 },
    pendingAuthGeneration: 4, configurationGeneration: 2,
  });
  await store.clearPendingGitHubAppAuth();
  const cleared = await store.getPendingAuthSnapshot();
  assert.equal(cleared.auth, null);
  assert.equal(cleared.authGeneration, 5);
  assert.equal(await store.rotatePendingGitHubAppAuth(4, 2, { mode: 'github_app', accessToken: 'stale' }), false);
  assert.equal((await store.getPendingAuthSnapshot()).auth, null);
});

test('full local reset preserves monotonic auth and configuration generation tombstones', async () => {
  const backend = new MemoryBackend(), store = new ChromeStore(backend);
  await backend.setMany({
    auth: { mode: 'github_app', accessToken: 'alice', generation: 7 }, authGeneration: 7,
    pendingAuth: { mode: 'github_app', accessToken: 'candidate', generation: 5 }, pendingAuthGeneration: 5,
    configurationGeneration: 11, config: { owner: 'acme', repo: 'time' }, activeCache: null,
  });
  await store.clearConfig();
  assert.deepEqual(await store.getAuthSnapshot(), { auth: null, authGeneration: 8, configurationGeneration: 12 });
  assert.deepEqual(await store.getPendingAuthSnapshot(), { auth: null, authGeneration: 6, configurationGeneration: 12 });
  assert.equal(await store.rotateGitHubAppAuth(7, 11, { mode: 'github_app', accessToken: 'stale' }), false);
  assert.equal(await store.rotatePendingGitHubAppAuth(5, 11, { mode: 'github_app', accessToken: 'stale' }), false);
});

test('data-version migration is one atomic backend mutation and cannot use a stale read/write split', async () => {
  const backend = new MemoryBackend(), store = new ChromeStore(backend);
  await store.patchState({ activeCache: { startedAt: 'old' }, pendingWrites: [{ id: 'old' }], user: 'alice', dataVersion: 2 });
  const originalGetMany = backend.getMany.bind(backend);
  backend.getMany = async keys => {
    if (keys.includes('dataVersion')) throw new Error('state migration must not perform a split read');
    return originalGetMany(keys);
  };
  const migrated = await store.ensureDataVersion(3);
  assert.equal(migrated.dataVersion, 3);
  await store.saveConfiguration({ owner: 'new', repo: 'time', branch: 'main' }, 'token', { activeCache: null, pendingWrites: [], user: 'bob', dataVersion: 3 });
  backend.getMany = originalGetMany;
  const state = await store.getState();
  assert.equal(state.user, 'bob');
  assert.equal(state.activeCache, null);
  assert.deepEqual(state.pendingWrites, []);
});

test('onboarding verification metadata is readable and removed by full local reset', async () => {
  const backend = new MemoryBackend(), store = new ChromeStore(backend);
  await store.patchState({ onboardingLastVerifiedAt: '2026-08-20T00:00:00.000Z', onboardingVerificationStatus: 'write_verified' });
  assert.deepEqual(await store.getOnboardingVerification(), { lastVerifiedAt: '2026-08-20T00:00:00.000Z', status: 'write_verified' });
  await store.clearConfig();
  assert.equal(backend.values.has('onboardingLastVerifiedAt'), false);
  assert.equal(backend.values.has('onboardingVerificationStatus'), false);
});

test('future data versions fail closed without deleting active or pending work', async () => {
  const backend = new MemoryBackend(), store = new ChromeStore(backend);
  const active = { startedAt: '2026-08-20T00:00:00Z' }, pending = [{ id: 'accepted' }];
  await store.patchState({ activeCache: active, pendingWrites: pending, dataVersion: 4 });
  await assert.rejects(() => store.ensureDataVersion(3), error => error.code === 'incompatible_storage_format' && /newer|unsupported|version/i.test(error.message));
  const state = await store.getState();
  assert.equal(state.dataVersion, 4);
  assert.deepEqual(state.activeCache, active);
  assert.deepEqual(state.pendingWrites, pending);
});

test('PAT configuration replacement clears stale onboarding verification atomically', async () => {
  const backend = new MemoryBackend(), store = new ChromeStore(backend);
  await store.patchState({ onboardingLastVerifiedAt: '2026-08-20T00:00:00.000Z', onboardingVerificationStatus: 'write_verified' });
  await store.savePatConfiguration(
    { owner: 'acme', repo: 'time', branch: 'main' }, 'pat',
    { user: 'alice', activeCache: null, recentCache: [], pendingWrites: [], dataVersion: 3 },
    { id: 123, login: 'alice' },
  );
  assert.deepEqual(await store.getOnboardingVerification(), { lastVerifiedAt: null, status: null });
});

test('pending refresh rotation survives atomic candidate promotion after GitHub consumes the old token', async () => {
  const backend = new MemoryBackend(), store = new ChromeStore(backend);
  await backend.setMany({
    pendingAuth: {
      mode: 'github_app', candidateId: 'attempt-one', githubUserId: 123, githubLogin: 'alice',
      accessToken: 'access-old', accessTokenExpiresAt: 10_000,
      refreshToken: 'refresh-old', refreshTokenExpiresAt: 99_999_999, generation: 2,
    },
    pendingAuthGeneration: 2, authGeneration: 4, configurationGeneration: 4,
  });
  let releaseResponse;
  const responseReady = new Promise(resolve => { releaseResponse = resolve; });
  let requestStarted;
  const started = new Promise(resolve => { requestStarted = resolve; });
  const pendingStore = {
    getAuthSnapshot: () => store.getPendingAuthSnapshot(),
    rotateGitHubAppAuth: (...args) => store.rotatePendingGitHubAppAuth(...args),
  };
  const broker = new CredentialBroker({
    clientId: 'Iv1.public-client-id', store: pendingStore, now: () => 10_000,
    fetchImpl: async () => { requestStarted(); await responseReady; return {
      ok: true, status: 200, json: async () => ({
        access_token: 'access-new', expires_in: 28_800,
        refresh_token: 'refresh-new', refresh_token_expires_in: 15_552_000,
      }),
    }; },
  });
  const refreshing = broker.getAccessToken();
  await started;
  const promoted = await store.commitPendingGitHubAppConfiguration(
    { owner: 'acme', repo: 'time', branch: 'main' }, { user: 'alice' }, 2,
  );
  assert.notEqual(promoted, false);
  releaseResponse();
  assert.equal(await refreshing, 'access-new');
  const current = await store.getAuthSnapshot();
  assert.equal(current.auth.accessToken, 'access-new');
  assert.equal(current.auth.refreshToken, 'refresh-new');
  assert.equal((await store.getPendingAuthSnapshot()).auth, null);
});

test('legacy repository identity upgrade is one generation-checked atomic mutation', async () => {
  const backend = new MemoryBackend(), store = new ChromeStore(backend);
  await backend.setMany({ config: { owner: 'acme', repo: 'time', branch: 'main' }, configurationGeneration: 7 });
  assert.equal(await store.upgradeLegacyRepositoryIdentity(6, { owner: 'acme', repo: 'time', branch: 'main' }, { repoId: 77, branchMode: 'custom' }), false);
  assert.equal(await store.upgradeLegacyRepositoryIdentity(7, { owner: 'other', repo: 'time', branch: 'main' }, { repoId: 77, branchMode: 'custom' }), false);
  assert.equal(await store.upgradeLegacyRepositoryIdentity(7, { owner: 'acme', repo: 'time', branch: 'main' }, { repoId: 77, branchMode: 'custom' }), 8);
  const snapshot = await store.getConfigurationSnapshot();
  assert.equal(snapshot.generation, 8);
  assert.equal(snapshot.config.repoId, 77);
  assert.equal(snapshot.config.branchMode, 'custom');
});


test('billable rates and settings export stay local, version changes, and import atomically', async () => {
  const backend = new MemoryBackend(), store = new ChromeStore(backend);
  await store.saveConfiguration({ owner: 'acme', repo: 'time', branch: 'main', recentDays: 7 }, 'secret', {});
  assert.deepEqual(await store.getLocalPreferences(), {
    recentDays: 7, currency: 'USD', rates: {}, revision: 0, exportedRevision: 0, exportRecommended: false,
  });
  const saved = await store.saveBillingSettings({ currency: 'EUR', rates: { alice: 12500 } });
  assert.equal(saved.revision, 1);
  assert.equal((await store.getLocalPreferences()).exportRecommended, true);
  const exported = await store.exportSettings();
  assert.doesNotMatch(exported.text, /secret/);
  assert.deepEqual(JSON.parse(exported.text).billing, { currency: 'EUR', rates: { alice: 12500 } });
  assert.equal(await store.markSettingsExported(exported.revision), true);
  assert.equal((await store.getLocalPreferences()).exportRecommended, false);
  const imported = await store.importSettings(exported.text.replace('"recentDays": 7', '"recentDays": 12'));
  assert.equal(imported.recentDays, 12);
  assert.equal((await store.getConfigurationSnapshot()).config.recentDays, 12);
  assert.equal((await store.getLocalPreferences()).exportRecommended, true);
});


test('legacy branch promotion is atomic and refuses to redirect accepted work', async () => {
  const backend = new MemoryBackend(), store = new ChromeStore(backend);
  await store.saveConfiguration({ owner: 'acme', repo: 'time', branch: 'main', repoId: 7 }, 'token', { user: 'alice', activeCache: null, pendingWrites: [], recentCache: [{ id: 'old' }] });
  let snapshot = await store.getConfigurationSnapshot();
  await backend.setMany({ activeCache: { startedAt: '2026-08-22T10:00:00Z' } });
  assert.equal(await store.promoteToUserStorageBranch(snapshot.generation, { owner: 'acme', repo: 'time', branch: 'main' }, { branch: 'repoclock/users/123', defaultBranch: 'main', storageBranchVersion: 1 }), false);
  await backend.setMany({ activeCache: null });
  const promoted = await store.promoteToUserStorageBranch(snapshot.generation, { owner: 'acme', repo: 'time', branch: 'main' }, { branch: 'repoclock/users/123', defaultBranch: 'main', storageBranchVersion: 1 });
  assert.ok(promoted > snapshot.generation);
  snapshot = await store.getConfigurationSnapshot();
  assert.equal(snapshot.config.branch, 'repoclock/users/123');
  assert.equal(snapshot.config.defaultBranch, 'main');
  assert.equal(snapshot.config.storageBranchVersion, 1);
  assert.deepEqual((await store.getState()).recentCache, []);
});
