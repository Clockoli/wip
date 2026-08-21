import test from 'node:test';
import assert from 'node:assert/strict';
import { OnboardingCoordinator } from '../src/services/onboarding-coordinator.js';

const candidate = {
  installationId: 88, repoId: 77, owner: 'acme', repo: 'time-data', fullName: 'acme/time-data',
  private: true, archived: false, disabled: false, defaultBranch: 'main', eligible: true, reasons: [],
};

class MemoryStore {
  constructor({ current = null, pending = null, config = null, state = {} } = {}) {
    this.current = current; this.pending = pending; this.config = config;
    this.currentGeneration = current?.generation || 0; this.pendingGeneration = pending?.generation || 0; this.configurationGeneration = 4;
    this.state = { activeCache: null, pendingWrites: [], recentCache: [], reportCache: null, taskMetadataCache: null, user: null, dataVersion: 3, ...state };
    this.commits = []; this.saves = []; this.removals = 0; this.clears = 0;
  }
  async getAuthSnapshot() { return { auth: structuredClone(this.current), authGeneration: this.currentGeneration, configurationGeneration: this.configurationGeneration }; }
  async getPendingAuthSnapshot() { return { auth: structuredClone(this.pending), authGeneration: this.pendingGeneration, configurationGeneration: this.configurationGeneration }; }
  async getConfigurationSnapshot() { return { config: structuredClone(this.config), token: '', generation: this.configurationGeneration }; }
  async getState() { return structuredClone(this.state); }
  async ensureDataVersion(version) { if (this.state.dataVersion !== version) throw new Error(`unsupported local data version ${this.state.dataVersion}`); return structuredClone(this.state); }
  async commitPendingGitHubAppConfiguration(config, patch, expected) {
    if (expected !== this.pendingGeneration) return false;
    this.commits.push({ config: structuredClone(config), patch: structuredClone(patch), expected });
    this.currentGeneration += 1; this.current = { ...this.pending, generation: this.currentGeneration }; this.pending = null; this.pendingGeneration = 0;
    this.configurationGeneration += 1; this.config = structuredClone(config); Object.assign(this.state, structuredClone(patch)); return this.configurationGeneration;
  }
  async saveGitHubAppConfiguration(config, patch, expected) {
    if (expected !== this.currentGeneration) return false;
    this.saves.push({ config: structuredClone(config), patch: structuredClone(patch), expected });
    this.configurationGeneration += 1; this.config = structuredClone(config); Object.assign(this.state, structuredClone(patch)); return this.configurationGeneration;
  }
  async removeCurrentAuthentication(expected) { if (expected !== this.currentGeneration) return false; this.current = null; this.currentGeneration += 1; this.removals += 1; return true; }
  async clearConfig() { this.clears += 1; this.current = null; this.pending = null; this.config = null; }
}

function coordinator(store, overrides = {}) {
  const discovery = overrides.discovery || { discover: async () => ({ installations: [], repositories: [candidate], candidates: [candidate] }) };
  const initializer = overrides.initializer || { initialize: async () => ({ status: 'write_verified', storageLogin: 'alice', repositoryFormatVersion: 1, repositoryId: 77, branch: 'main' }) };
  return new OnboardingCoordinator({
    store,
    currentCredentialProvider: { getAccessToken: async () => 'current' },
    pendingCredentialProvider: { getAccessToken: async () => 'pending' },
    githubFactory: options => ({ options, getAuthenticatedIdentity: async () => ({ id: 123, login: 'alice' }) }),
    discoveryFactory: ({ credentialProvider }) => { assert.ok(credentialProvider); return discovery; },
    initializerFactory: ({ github }) => { assert.ok(github); return initializer; },
    activeProbe: overrides.activeProbe || (async () => false),
  });
}

test('repository discovery requires a pending or current GitHub App authorization', async () => {
  const store = new MemoryStore({ current: { mode: 'pat', accessToken: 'pat', generation: 1 } });
  await assert.rejects(() => coordinator(store).discover(), error => error.code === 'github_app_auth_required');
});

test('validated repository selection atomically commits pending App auth over the old PAT', async () => {
  const store = new MemoryStore({
    current: { mode: 'pat', accessToken: 'old-pat', generation: 3 },
    pending: { mode: 'github_app', githubUserId: 123, githubLogin: 'alice', accessToken: 'candidate', refreshToken: 'refresh', generation: 2 },
    config: { owner: 'acme', repo: 'time-data', branch: 'main', branchMode: 'default', repoId: 77, storageLogin: 'alice', recentDays: 7, allowedIssueOwners: ['acme'] },
    state: { user: 'alice', recentCache: [{ id: 'recent' }], reportCache: { repositoryKey: 'acme/time-data@main', snapshot: 'kept' } },
  });
  const result = await coordinator(store).selectRepository({ installationId: 88, repoId: 77 });
  assert.equal(result.status, 'write_verified');
  assert.equal(store.commits.length, 1);
  assert.equal(store.current.mode, 'github_app');
  assert.equal(store.config.repoId, 77);
  assert.equal(store.config.storageLogin, 'alice');
  assert.equal(store.state.user, 'alice');
  assert.equal(store.state.taskMetadataCache, null);
  assert.deepEqual(store.state.recentCache, [{ id: 'recent' }]);
  assert.deepEqual(store.state.reportCache, { repositoryKey: 'acme/time-data@main', snapshot: 'kept' });
  assert.equal(store.commits[0].patch.activeCache, null);
  assert.deepEqual(store.commits[0].patch.pendingWrites, []);
});

test('repository selection re-discovers IDs and rejects a caller-supplied inaccessible repository', async () => {
  const store = new MemoryStore({ pending: { mode: 'github_app', githubUserId: 123, githubLogin: 'alice', generation: 1 } });
  await assert.rejects(() => coordinator(store).selectRepository({ installationId: 999, repoId: 777 }), error => error.code === 'repository_access_required');
  assert.equal(store.commits.length, 0);
});

test('auth or destination transition is blocked by local or remote active work and pending writes', async () => {
  const pendingAuth = { mode: 'github_app', githubUserId: 123, githubLogin: 'alice', generation: 1 };
  for (const setup of [
    { state: { activeCache: { startedAt: '2026-08-20T00:00:00Z' } }, activeProbe: async () => false, pattern: /active timer/i },
    { state: { pendingWrites: [{ id: 'one' }] }, activeProbe: async () => false, pattern: /pending/i },
    { state: {}, activeProbe: async () => true, pattern: /active timer/i },
  ]) {
    const store = new MemoryStore({ current: { mode: 'pat', accessToken: 'old', generation: 2 }, pending: pendingAuth, config: { owner: 'old', repo: 'time', branch: 'main' }, state: setup.state });
    await assert.rejects(() => coordinator(store, { activeProbe: setup.activeProbe }).selectRepository({ installationId: 88, repoId: 77 }), setup.pattern);
    assert.equal(store.commits.length, 0);
  }
});

test('blocked transitions explain exactly how to protect running and unsynced work', async () => {
  const active = new MemoryStore({ current: { mode: 'github_app', generation: 2 }, config: { owner: 'acme', repo: 'time', branch: 'main' }, state: { activeCache: { startedAt: 'x' } } });
  await assert.rejects(() => coordinator(active).clearLocalConfiguration(), /stop the active timer/i);
  const pending = new MemoryStore({ current: { mode: 'github_app', generation: 2 }, config: { owner: 'acme', repo: 'time', branch: 'main' }, state: { pendingWrites: [{ id: 'one' }] } });
  await assert.rejects(() => coordinator(pending).clearLocalConfiguration(), /open RepoClock.*finish syncing.*pending changes/i);
});

test('disconnect is local, generation-checked, and refuses to discard active or pending work', async () => {
  for (const state of [{ activeCache: { startedAt: 'x' } }, { pendingWrites: [{ id: 'one' }] }]) {
    const store = new MemoryStore({ current: { mode: 'github_app', generation: 2 }, state });
    await assert.rejects(() => coordinator(store).disconnect(), /stop|sync/i);
    assert.equal(store.removals, 0);
  }
  const store = new MemoryStore({ current: { mode: 'github_app', generation: 2 } });
  assert.deepEqual(await coordinator(store).disconnect(), { disconnected: true, remoteAuthorizationRevoked: false });
  assert.equal(store.removals, 1);
});


test('explicit local reset uses the same active and pending-work safety gate', async () => {
  const blocked = new MemoryStore({ current: { mode: 'github_app', generation: 2 }, config: { owner: 'acme', repo: 'time', branch: 'main' }, state: { pendingWrites: [{ id: 'one' }] } });
  await assert.rejects(() => coordinator(blocked).clearLocalConfiguration(), /finish syncing.*pending changes/i);
  assert.equal(blocked.clears, 0);
  const safe = new MemoryStore({ current: { mode: 'github_app', generation: 2 }, config: { owner: 'acme', repo: 'time', branch: 'main' } });
  assert.deepEqual(await coordinator(safe).clearLocalConfiguration(), { cleared: true, remoteDataDeleted: false });
  assert.equal(safe.clears, 1);
});


test('PAT migration preserves a validated custom branch for the same stable repository', async () => {
  const currentProvider = { getAccessToken: async () => 'current' };
  const pendingProvider = { getAccessToken: async () => 'pending' };
  const factoryCalls = [];
  const initializerCalls = [];
  const store = new MemoryStore({
    current: { mode: 'pat', accessToken: 'old-pat', generation: 3 },
    pending: { mode: 'github_app', githubUserId: 123, githubLogin: 'alice', generation: 2 },
    config: { owner: 'acme', repo: 'time-data', branch: 'worklog', recentDays: 7, allowedIssueOwners: ['acme'] },
  });
  const c = new OnboardingCoordinator({
    store, currentCredentialProvider: currentProvider, pendingCredentialProvider: pendingProvider,
    githubFactory: options => {
      factoryCalls.push(options);
      return options.credentialProvider === currentProvider
        ? { getAuthenticatedIdentity: async () => ({ id: 123, login: 'alice' }), validateRepository: async () => ({ id: 77 }) }
        : { options };
    },
    discoveryFactory: () => ({ discover: async () => ({ installations: [], repositories: [candidate], candidates: [candidate] }) }),
    initializerFactory: ({ github }) => ({ initialize: async (user, options) => {
      initializerCalls.push({ github, user, options });
      return { status: 'access_checked', storageLogin: 'alice', repositoryFormatVersion: 1, repositoryId: 77, branch: 'worklog' };
    } }),
  });
  await c.selectRepository({ installationId: 88, repoId: 77 });
  assert.equal(store.config.branch, 'worklog');
  assert.equal(factoryCalls[0].branch, 'worklog');
  assert.equal(factoryCalls[1].branch, 'worklog');
  assert.deepEqual(initializerCalls[0].options, { expectedRepositoryId: 77, selectedBranch: 'worklog', branchMode: 'custom', requiredStorageLogin: 'alice' });
});

test('PAT custom-branch migration fails closed when old coordinates resolve to another repository ID', async () => {
  const currentProvider = { getAccessToken: async () => 'current' };
  const pendingProvider = { getAccessToken: async () => 'pending' };
  const store = new MemoryStore({
    current: { mode: 'pat', accessToken: 'old-pat', generation: 3 },
    pending: { mode: 'github_app', githubUserId: 123, githubLogin: 'alice', generation: 2 },
    config: { owner: 'acme', repo: 'time-data', branch: 'worklog' },
  });
  const c = new OnboardingCoordinator({
    store, currentCredentialProvider: currentProvider, pendingCredentialProvider: pendingProvider,
    githubFactory: options => ({ getAuthenticatedIdentity: async () => ({ id: 123, login: 'alice' }), validateRepository: async () => ({ id: options.credentialProvider === currentProvider ? 999 : 77 }) }),
    discoveryFactory: () => ({ discover: async () => ({ installations: [], repositories: [candidate], candidates: [candidate] }) }),
    initializerFactory: () => ({ initialize: async () => { throw new Error('must not initialize'); } }),
  });
  await assert.rejects(() => c.selectRepository({ installationId: 88, repoId: 77 }), error => error.code === 'custom_branch_unverified');
  assert.equal(store.commits.length, 0);
  assert.equal(store.config.branch, 'worklog');
});


test('stable-ID recovery atomically repairs renamed repository and default-branch coordinates without dropping work', async () => {
  const renamed = { ...candidate, owner: 'new-owner', repo: 'renamed-time-data', fullName: 'new-owner/renamed-time-data', defaultBranch: 'new-main' };
  const state = { activeCache: { issue: { url: 'https://github.com/acme/project/issues/1' } }, pendingWrites: [{ id: 'pending-one' }], recentCache: [{ id: 'recent-one' }] };
  const store = new MemoryStore({
    current: { mode: 'github_app', githubUserId: 123, githubLogin: 'alice', generation: 4 },
    config: { owner: 'acme', repo: 'time-data', branch: 'old-main', branchMode: 'default', repoId: 77, installationId: 88, recentDays: 7, allowedIssueOwners: ['acme'] },
    state,
  });
  const initializerCalls = [];
  const c = coordinator(store, {
    discovery: { discover: async () => ({ installations: [], repositories: [renamed], candidates: [renamed] }) },
    initializer: { initialize: async (user, options) => {
      initializerCalls.push({ user, options });
      return { status: 'access_checked', storageLogin: 'alice', repositoryFormatVersion: 1, repositoryId: 77, branch: 'new-main' };
    } },
    activeProbe: async () => { throw new Error('same stable repository must not probe old coordinates'); },
  });
  const result = await c.recoverCurrentRepository();
  assert.equal(result.config.owner, 'new-owner');
  assert.equal(result.config.repo, 'renamed-time-data');
  assert.equal(result.config.branch, 'new-main');
  assert.equal(result.config.branchMode, 'default');
  assert.equal(store.saves.length, 1);
  assert.deepEqual(store.state.activeCache, state.activeCache);
  assert.deepEqual(store.state.pendingWrites, state.pendingWrites);
  assert.deepEqual(store.state.recentCache, state.recentCache);
  assert.deepEqual(initializerCalls[0].options, { expectedRepositoryId: 77, selectedBranch: 'new-main', branchMode: 'default' });
});

test('stable-ID recovery distinguishes lost installation access from expired authentication', async () => {
  const store = new MemoryStore({
    current: { mode: 'github_app', githubUserId: 123, githubLogin: 'alice', generation: 4 },
    config: { owner: 'acme', repo: 'time-data', branch: 'main', branchMode: 'default', repoId: 77, installationId: 88 },
  });
  const c = coordinator(store, { discovery: { discover: async () => ({ installations: [{ installationId: 88 }], repositories: [], candidates: [] }) } });
  await assert.rejects(() => c.recoverCurrentRepository(), error => error.code === 'repository_access_required');
  assert.equal(store.saves.length, 0);
});


test('stable-ID recovery leaves the configuration generation unchanged when coordinates still match', async () => {
  const store = new MemoryStore({
    current: { mode: 'github_app', githubUserId: 123, githubLogin: 'alice', generation: 4 },
    config: { owner: 'acme', repo: 'time-data', branch: 'main', branchMode: 'default', repoId: 77, installationId: 88 },
  });
  const before = store.configurationGeneration;
  const result = await coordinator(store).recoverCurrentRepository();
  assert.deepEqual(result, { recovered: false, config: store.config });
  assert.equal(store.configurationGeneration, before);
  assert.equal(store.saves.length, 0);
});


test('repository verification status is persisted atomically and survives state reload', async () => {
  const store = new MemoryStore({
    pending: { mode: 'github_app', githubUserId: 123, githubLogin: 'alice', generation: 2 },
  });
  await coordinator(store, { initializer: { initialize: async () => ({
    status: 'access_checked', storageLogin: 'alice', repositoryFormatVersion: 1, repositoryId: 77, branch: 'main',
  }) } }).selectRepository({ installationId: 88, repoId: 77 });
  assert.equal(store.state.onboardingVerificationStatus, 'access_checked');
  assert.match(store.state.onboardingLastVerifiedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('recovery distinguishes removed installation from repository selection loss', async () => {
  const config = { owner: 'acme', repo: 'time-data', branch: 'main', branchMode: 'default', repoId: 77, installationId: 88 };
  const current = { mode: 'github_app', githubUserId: 123, githubLogin: 'alice', generation: 4 };
  const removed = new MemoryStore({ current, config });
  await assert.rejects(
    () => coordinator(removed, { discovery: { discover: async () => ({ installations: [], repositories: [], candidates: [] }) } }).recoverCurrentRepository(),
    error => error.code === 'app_installation_required',
  );
  const deselected = new MemoryStore({ current, config });
  await assert.rejects(
    () => coordinator(deselected, { discovery: { discover: async () => ({ installations: [{ installationId: 88 }], repositories: [], candidates: [] }) } }).recoverCurrentRepository(),
    error => error.code === 'repository_access_required',
  );
});

test('PAT to App migration proves stable account identity before preserving legacy storage', async () => {
  const currentProvider = { getAccessToken: async () => 'current' };
  const pendingProvider = { getAccessToken: async () => 'pending' };
  const store = new MemoryStore({
    current: { mode: 'pat', accessToken: 'old-pat', generation: 3 },
    pending: { mode: 'github_app', githubUserId: 123, githubLogin: 'new-login', generation: 2 },
    config: { owner: 'acme', repo: 'time-data', branch: 'main', repoId: 77, storageLogin: 'old-login' },
    state: { user: 'old-login', recentCache: [{ id: 'kept' }] },
  });
  const calls = [];
  const c = new OnboardingCoordinator({
    store, currentCredentialProvider: currentProvider, pendingCredentialProvider: pendingProvider,
    githubFactory: options => options.credentialProvider === currentProvider
      ? { getAuthenticatedIdentity: async () => ({ id: 123, login: 'new-login' }), validateRepository: async () => ({ id: 77 }) }
      : {},
    discoveryFactory: () => ({ discover: async () => ({ installations: [], repositories: [candidate], candidates: [candidate] }) }),
    initializerFactory: () => ({ initialize: async (_user, options) => { calls.push(options); return { status: 'access_checked', storageLogin: 'old-login', repositoryFormatVersion: 1, repositoryId: 77, branch: 'main' }; } }),
  });
  await c.selectRepository({ installationId: 88, repoId: 77 });
  assert.equal(calls[0].requiredStorageLogin, 'old-login');
  assert.deepEqual(store.state.recentCache, [{ id: 'kept' }]);

  const mismatch = new MemoryStore({ current: store.current = { mode: 'pat', accessToken: 'old', generation: 3 }, pending: { mode: 'github_app', githubUserId: 123, githubLogin: 'alice', generation: 2 }, config: { owner: 'acme', repo: 'time-data', branch: 'main', storageLogin: 'old-login' }, state: { user: 'old-login' } });
  const rejected = new OnboardingCoordinator({
    store: mismatch, currentCredentialProvider: currentProvider, pendingCredentialProvider: pendingProvider,
    githubFactory: options => options.credentialProvider === currentProvider ? { getAuthenticatedIdentity: async () => ({ id: 999, login: 'mallory' }) } : {},
    discoveryFactory: () => ({ discover: async () => ({ installations: [], repositories: [candidate], candidates: [candidate] }) }),
    initializerFactory: () => ({ initialize: async () => { throw new Error('must not initialize'); } }),
  });
  await assert.rejects(() => rejected.selectRepository({ installationId: 88, repoId: 77 }), error => error.code === 'migration_identity_mismatch');
  assert.equal(mismatch.commits.length, 0);
});

test('repository selection rejects future local data before initialization and preserves it exactly', async () => {
  const future = { activeCache: null, pendingWrites: [], recentCache: [{ future: true }], user: 'alice', dataVersion: 4 };
  const store = new MemoryStore({
    current: { mode: 'github_app', githubUserId: 123, githubLogin: 'alice', accessToken: 'current', generation: 2 },
    config: { owner: 'acme', repo: 'time-data', branch: 'main', branchMode: 'default', repoId: 77, storageLogin: 'alice' },
    state: future,
  });
  let initialized = 0;
  await assert.rejects(
    () => coordinator(store, { initializer: { initialize: async () => { initialized += 1; throw new Error('must not initialize'); } } })
      .selectRepository({ installationId: 88, repoId: 77 }),
    /unsupported local data version 4/,
  );
  assert.equal(initialized, 0);
  assert.deepEqual(store.state, { taskMetadataCache: null, reportCache: null, ...future });
  assert.equal(store.saves.length, 0);
});

