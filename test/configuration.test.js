import test from 'node:test';
import assert from 'node:assert/strict';
import { ConfigurationService } from '../src/services/configuration.js';

const oldConfig = { owner: 'old-org', repo: 'time-data', branch: 'main', recentDays: 7, allowedIssueOwners: ['old-org'], repoId: 77, branchMode: 'custom' };
const provisionUserBranch = async (_github, user) => ({ branch: `repoclock/users/${user.id}` });

const newPayload = { owner: 'new-org', repo: 'time-data', branch: 'main', recentDays: 7, allowedIssueOwners: ['new-org'], token: 'new-token' };

class MemoryConfigStore {
  constructor({ activeCache = null, pendingWrites = [], user = 'alice', authMode = 'pat' } = {}) {
    this.config = oldConfig; this.token = 'old-token';
    this.auth = { mode: authMode, accessToken: 'old-token', generation: 3 };
    this.generation = 4;
    this.state = { activeCache, recentCache: [], pendingWrites, user, reportCache: { repositoryKey: 'old-org/time-data@main' }, taskMetadataCache: { repositoryKey: 'private:g4' } };
  }
  async getConfig() { return { config: structuredClone(this.config), token: this.token }; }
  async getConfigurationSnapshot() { return { ...(await this.getConfig()), generation: this.generation }; }
  async getAuthSnapshot() { return { auth: structuredClone(this.auth), authGeneration: 3, configurationGeneration: this.generation }; }
  async getState() { return structuredClone(this.state); }
  async saveConfig(config, token) { this.config = structuredClone(config); this.token = token; }
  async saveConfiguration(config, token, statePatch) { this.config = structuredClone(config); this.token = token; this.generation += 1; Object.assign(this.state, structuredClone(statePatch)); return this.generation; }
  async savePatConfiguration(config, token, statePatch, identity = {}) { this.config = { ...structuredClone(config), authMode: 'pat' }; this.token = token; this.auth = { mode: 'pat', accessToken: token, githubUserId: identity.id, githubLogin: identity.login, generation: 4 }; this.generation += 1; Object.assign(this.state, structuredClone(statePatch)); return this.generation; }
  async patchState(patch) { Object.assign(this.state, structuredClone(patch)); }
  async upgradeLegacyRepositoryIdentity(expectedGeneration, expected, patch) { if (expectedGeneration !== this.generation || this.config.owner !== expected.owner || this.config.repo !== expected.repo || this.config.branch !== expected.branch) return false; this.config = { ...this.config, ...structuredClone(patch) }; this.generation += 1; return this.generation; }
  async promoteToUserStorageBranch(expectedGeneration, expected, patch) {
    if (expectedGeneration !== this.generation || this.config.owner !== expected.owner || this.config.repo !== expected.repo || this.config.branch !== expected.branch
        || this.state.activeCache || this.state.pendingWrites.length) return false;
    this.config = { ...this.config, ...structuredClone(patch) }; this.generation += 1; this.state.reportCache = null; this.state.taskMetadataCache = null; return this.generation;
  }
}

function factory({ token, owner, repo }) {
  if (token === 'new-token') return {
    getAuthenticatedIdentity: async () => ({ id: 123, login: 'alice' }), getAuthenticatedUser: async () => 'alice', validateRepository: async () => ({ id: 77, full_name: `${owner}/${repo}`, private: true }), validateBranch: async () => ({}),
  };
  return {
    getAuthenticatedIdentity: async () => ({ id: 123, login: 'alice' }), getAuthenticatedUser: async () => 'alice',
    getText: async () => ({ sha: 'active', text: 'URL: https://github.com/acme/app/issues/1\nStart: 2026-08-18T08:00:00Z\n' }),
  };
}

test('configuration service refuses to redirect pending writes', async () => {
  const store = new MemoryConfigStore({ pendingWrites: [{ id: 'pending' }] });
  const service = new ConfigurationService({ store, userBranchProvisioner: provisionUserBranch, githubFactory: factory });
  await assert.rejects(() => service.save(newPayload), /pending/i);
  assert.equal(store.config.owner, 'old-org');
});

test('configuration service discovers and protects an uncached active timer before changing destination', async () => {
  const store = new MemoryConfigStore();
  const service = new ConfigurationService({ store, userBranchProvisioner: provisionUserBranch, githubFactory: factory });
  await assert.rejects(() => service.save(newPayload), /active timer/i);
  assert.equal(store.config.owner, 'old-org');
});

test('configuration service allows first setup and returns the authenticated user', async () => {
  const store = new MemoryConfigStore({ user: null }); store.config = null; store.token = '';
  const service = new ConfigurationService({ store, userBranchProvisioner: provisionUserBranch, githubFactory: factory });
  const result = await service.save(newPayload);
  assert.equal(result.user, 'alice');
  assert.equal(store.config.owner, 'new-org');
  assert.equal(store.state.user, 'alice');
  assert.equal(store.config.repoId, 77);
  assert.equal(store.config.branchMode, 'custom');
});


test('same-destination settings changes preserve pending completions', async () => {
  const pending = [{ operation: 'completeTimer', id: 'pending', stage: 'appendMonthly' }];
  const store = new MemoryConfigStore({ pendingWrites: pending, authMode: 'pat' });
  const service = new ConfigurationService({ store, userBranchProvisioner: provisionUserBranch, githubFactory: factory });
  await service.save({ ...newPayload, owner: 'old-org', allowedIssueOwners: ['old-org'] });
  assert.deepEqual(store.state.pendingWrites, pending);
});

test('configuration service re-reads pending state after asynchronous GitHub validation', async () => {
  const store = new MemoryConfigStore();
  const racingFactory = options => {
    const github = factory(options);
    if (options.token === 'new-token') github.validateBranch = async () => { store.state.pendingWrites = [{ id: 'arrived-during-validation' }]; return {}; };
    return github;
  };
  const service = new ConfigurationService({ store, userBranchProvisioner: provisionUserBranch, githubFactory: racingFactory });
  await assert.rejects(() => service.save(newPayload), /pending/i);
  assert.equal(store.config.owner, 'old-org');
});


test('configuration remains unchanged when the atomic persistence transaction fails', async () => {
  const store = new MemoryConfigStore({ user: null }); store.config = null; store.token = '';
  store.savePatConfiguration = async () => { throw new Error('simulated atomic write failure'); };
  const service = new ConfigurationService({ store, userBranchProvisioner: provisionUserBranch, githubFactory: factory });
  await assert.rejects(() => service.save(newPayload), /atomic write failure/i);
  assert.equal(store.config, null);
  assert.equal(store.token, '');
  assert.equal(store.state.user, null);
});


test('configuration recovers the previous authenticated user before allowing a token identity change', async () => {
  const store = new MemoryConfigStore({ user: null });
  let oldActiveReads = 0;
  const identityFactory = ({ token }) => token === 'new-token' ? {
    getAuthenticatedIdentity: async () => ({ id: 456, login: 'bob' }), getAuthenticatedUser: async () => 'bob', validateRepository: async () => ({ id: 77, full_name: 'old-org/time-data', private: true }), validateBranch: async () => ({}),
  } : {
    getAuthenticatedIdentity: async () => ({ id: 123, login: 'alice' }), getAuthenticatedUser: async () => 'alice',
    getText: async () => { oldActiveReads += 1; return { sha: 'active', text: 'URL: https://github.com/acme/app/issues/1\nStart: 2026-08-18T08:00:00Z\n' }; },
  };
  const service = new ConfigurationService({ store, userBranchProvisioner: provisionUserBranch, githubFactory: identityFactory });
  await assert.rejects(() => service.save({ ...newPayload, owner: 'old-org', allowedIssueOwners: ['old-org'] }), /active timer/i);
  assert.equal(oldActiveReads, 1);
  assert.equal(store.token, 'old-token');
});


test('changing repository clears the old private report cache', async () => {
  const store = new MemoryConfigStore();
  const noActiveFactory = options => options.token === 'new-token' ? factory(options) : {
    getAuthenticatedIdentity: async () => ({ id: 123, login: 'alice' }), getAuthenticatedUser: async () => 'alice',
    getText: async () => { const error = new Error('not found'); error.status = 404; throw error; },
    assertDestinationReachable: async () => ({ id: 77 }),
  };
  const service = new ConfigurationService({ store, userBranchProvisioner: provisionUserBranch, githubFactory: noActiveFactory });
  await service.save(newPayload);
  assert.equal(store.state.reportCache, null);
});

test('same-repository settings changes preserve its immutable report cache', async () => {
  const store = new MemoryConfigStore({ authMode: 'pat' });
  const original = structuredClone(store.state.reportCache);
  const service = new ConfigurationService({ store, userBranchProvisioner: provisionUserBranch, githubFactory: factory });
  await service.save({ ...newPayload, owner: 'old-org', allowedIssueOwners: ['old-org'], recentDays: 14 });
  assert.deepEqual(store.state.reportCache, original);
});

test('every credential save rotates generation and clears private task metadata', async () => {
  const store = new MemoryConfigStore({ authMode: 'pat' });
  const service = new ConfigurationService({ store, userBranchProvisioner: provisionUserBranch, githubFactory: factory });
  await service.save({ ...newPayload, owner: 'old-org', allowedIssueOwners: ['old-org'] });
  assert.equal(store.generation, 5);
  assert.equal(store.state.taskMetadataCache, null);
});

test('switching authenticated users rotates generation and drops prior private metadata', async () => {
  const store = new MemoryConfigStore();
  const identityFactory = ({ token }) => token === 'new-token' ? {
    getAuthenticatedIdentity: async () => ({ id: 456, login: 'bob' }), getAuthenticatedUser: async () => 'bob', validateRepository: async () => ({ id: 77, full_name: 'old-org/time-data', private: true }), validateBranch: async () => ({}),
  } : {
    getAuthenticatedIdentity: async () => ({ id: 123, login: 'alice' }), getAuthenticatedUser: async () => 'alice',
    getText: async () => { const error = new Error('not found'); error.status = 404; throw error; },
    assertDestinationReachable: async () => ({ id: 77 }),
  };
  const service = new ConfigurationService({ store, userBranchProvisioner: provisionUserBranch, githubFactory: identityFactory });
  await service.save({ ...newPayload, owner: 'old-org', allowedIssueOwners: ['old-org'] });
  assert.equal(store.state.user, 'bob');
  assert.equal(store.generation, 5);
  assert.equal(store.state.taskMetadataCache, null);
});


test('switching from GitHub App authentication to PAT is blocked while a timer is active', async () => {
  const active = { issue: { url: 'https://github.com/acme/app/issues/1' }, startedAt: '2026-08-20T08:00:00Z' };
  const store = new MemoryConfigStore({ activeCache: active, authMode: 'github_app' });
  const service = new ConfigurationService({ store, userBranchProvisioner: provisionUserBranch, githubFactory: factory });
  await assert.rejects(
    () => service.save({ ...newPayload, owner: 'old-org', allowedIssueOwners: ['old-org'] }),
    /active timer/i,
  );
  assert.equal(store.auth.mode, 'github_app');
  assert.deepEqual(store.state.activeCache, active);
});

test('same-destination PAT credential update preserves accepted local work', async () => {
  const active = { issue: { url: 'https://github.com/acme/app/issues/1' }, startedAt: '2026-08-20T08:00:00Z' };
  const pending = [{ id: 'pending', operation: 'completeTimer', status: 'pending' }];
  const store = new MemoryConfigStore({ activeCache: active, pendingWrites: pending, authMode: 'pat' });
  store.state.recentCache = [{ id: 'recent' }];
  const service = new ConfigurationService({ store, userBranchProvisioner: provisionUserBranch, githubFactory: factory });
  await service.save({ ...newPayload, owner: 'old-org', allowedIssueOwners: ['old-org'] });
  assert.equal(store.auth.mode, 'pat');
  assert.deepEqual(store.state.activeCache, active);
  assert.deepEqual(store.state.pendingWrites, pending);
  assert.deepEqual(store.state.recentCache, [{ id: 'recent' }]);
});


test('switching from GitHub App authentication to PAT is blocked while writes are pending', async () => {
  const pending = [{ id: 'conflict', operation: 'completeTimer', status: 'conflict' }];
  const store = new MemoryConfigStore({ pendingWrites: pending, authMode: 'github_app' });
  const service = new ConfigurationService({ store, userBranchProvisioner: provisionUserBranch, githubFactory: factory });
  await assert.rejects(
    () => service.save({ ...newPayload, owner: 'old-org', allowedIssueOwners: ['old-org'] }),
    /pending/i,
  );
  assert.equal(store.auth.mode, 'github_app');
  assert.deepEqual(store.state.pendingWrites, pending);
});

test('App to PAT transition requires the same stable account and preserves immutable storage identity', async () => {
  const store = new MemoryConfigStore({ authMode: 'github_app', user: 'old-login' });
  store.auth = { mode: 'github_app', accessToken: 'old-token', githubUserId: 123, githubLogin: 'new-login', generation: 3 };
  store.config = { ...oldConfig, repoId: 77, branchMode: 'custom', storageLogin: 'old-login', authMode: 'github_app' };
  store.state.recentCache = [{ id: 'accepted' }];
  const githubFactory = ({ token }) => token === 'new-token' ? {
    getAuthenticatedIdentity: async () => ({ id: 123, login: 'new-login' }),
    validateRepository: async () => ({ id: 77, full_name: 'old-org/time-data', private: true }), validateBranch: async () => ({}),
  } : {
    getAuthenticatedIdentity: async () => ({ id: 123, login: 'new-login' }),
    getText: async () => { throw Object.assign(new Error('absent'), { status: 404, code: 'not_found' }); },
    assertDestinationReachable: async () => ({}),
  };
  await new ConfigurationService({ store, userBranchProvisioner: provisionUserBranch, githubFactory }).save({ ...newPayload, owner: 'old-org', allowedIssueOwners: ['old-org'] });
  assert.equal(store.auth.githubUserId, 123);
  assert.equal(store.config.storageLogin, 'old-login');
  assert.equal(store.config.repoId, 77);
  assert.equal(store.config.branchMode, 'custom');
  assert.equal(store.state.user, 'old-login');
  assert.deepEqual(store.state.recentCache, [{ id: 'accepted' }]);
});

test('App to PAT transition rejects login reuse by a different stable GitHub account', async () => {
  const store = new MemoryConfigStore({ authMode: 'github_app', user: 'old-login' });
  store.auth = { mode: 'github_app', accessToken: 'old-token', githubUserId: 123, githubLogin: 'old-login', generation: 3 };
  store.config = { ...oldConfig, storageLogin: 'old-login', authMode: 'github_app' };
  const githubFactory = ({ token }) => token === 'new-token' ? {
    getAuthenticatedIdentity: async () => ({ id: 999, login: 'old-login' }),
    validateRepository: async () => ({ id: 77, full_name: 'old-org/time-data', private: true }), validateBranch: async () => ({}),
  } : { getAuthenticatedIdentity: async () => ({ id: 123, login: 'old-login' }) };
  await assert.rejects(
    () => new ConfigurationService({ store, userBranchProvisioner: provisionUserBranch, githubFactory }).save({ ...newPayload, owner: 'old-org', allowedIssueOwners: ['old-org'] }),
    /different GitHub account|identity/i,
  );
  assert.equal(store.auth.mode, 'github_app');
  assert.equal(store.config.authMode, 'github_app');
});

test('legacy ID-less PAT configuration is atomically upgraded before runtime use', async () => {
  const store = new MemoryConfigStore();
  store.config = { ...oldConfig }; delete store.config.repoId; delete store.config.branchMode;
  const calls = [];
  const service = new ConfigurationService({
    store,
    githubFactory: options => ({
      options,
      validateRepository: async () => { calls.push('repository'); return { id: 77, full_name: 'old-org/time-data', private: true, archived: false, disabled: false, permissions: { push: true } }; },
      validateBranch: async () => { calls.push('branch'); return { name: 'main' }; },
    }),
  });
  const config = await service.ensureRepositoryIdentity();
  assert.deepEqual(calls, ['repository', 'branch']);
  assert.equal(config.repoId, 77);
  assert.equal(config.branchMode, 'custom');
  assert.equal(store.config.repoId, 77);
  assert.equal(store.generation, 5);
});

test('App to PAT active-file verification uses the refresh-capable current credential provider and proves a 404 destination', async () => {
  const store = new MemoryConfigStore({ authMode: 'github_app', user: 'old-login' });
  store.auth = { mode: 'github_app', accessToken: 'expired', githubUserId: 123, githubLogin: 'new-login', generation: 3 };
  store.config = { ...oldConfig, storageLogin: 'old-login', authMode: 'github_app' };
  const provider = { getAccessToken: async () => 'refreshed' };
  let usedProvider = false, proved = false;
  const githubFactory = options => options.token === 'new-token' ? {
    getAuthenticatedIdentity: async () => ({ id: 123, login: 'new-login' }),
    validateRepository: async () => ({ id: 77, full_name: 'old-org/time-data', private: true }), validateBranch: async () => ({}),
  } : {
    getText: async () => { usedProvider = options.credentialProvider === provider; throw Object.assign(new Error('absent'), { status: 404, code: 'not_found' }); },
    assertDestinationReachable: async () => { proved = true; return { id: 77 }; },
  };
  await new ConfigurationService({ store, userBranchProvisioner: provisionUserBranch, githubFactory, credentialProvider: provider })
    .save({ ...newPayload, owner: 'old-org', allowedIssueOwners: ['old-org'] });
  assert.equal(usedProvider, true);
  assert.equal(proved, true);
});

test('legacy configuration promotes to a personal branch only after atomic accepted-work recheck', async () => {
  const store = new MemoryConfigStore(); const factoryOptions = [];
  const service = new ConfigurationService({
    store,
    githubFactory: options => { factoryOptions.push(options); return { getAuthenticatedIdentity: async () => ({ id: 123, login: 'alice' }), getText: async () => { throw Object.assign(new Error('missing'), { status: 404 }); }, assertDestinationReachable: async () => ({ id: 77 }) }; },
    userBranchProvisioner: provisionUserBranch,
  });
  const config = await service.ensurePersonalStorageBranch();
  assert.equal(factoryOptions[0].expectedRepositoryId, 77);
  assert.equal(config.branch, 'repoclock/users/123');
  assert.equal(config.defaultBranch, 'main');
  assert.equal(config.storageBranchVersion, 1);
  assert.equal(store.state.reportCache, null);
});

test('legacy branch promotion refuses a remote active timer that is absent from local cache', async () => {
  const store = new MemoryConfigStore(); let provisioned = false;
  const service = new ConfigurationService({
    store,
    githubFactory: () => ({
      getAuthenticatedIdentity: async () => ({ id: 123, login: 'alice' }),
      getText: async path => ({ path, sha: 'a'.repeat(40), text: 'URL: https://github.com/acme/app/issues/1\nTitle: Remote task\nStart: 2026-08-18T08:00:00Z\n' }),
    }),
    userBranchProvisioner: async (...args) => { provisioned = true; return provisionUserBranch(...args); },
  });
  const config = await service.ensurePersonalStorageBranch();
  assert.equal(provisioned, false);
  assert.equal(config.branch, 'main');
  assert.equal(store.config.branch, 'main');
  assert.equal(store.config.storageBranchVersion, undefined);
});

test('legacy branch promotion leaves configuration unchanged when work arrives during provisioning', async () => {
  const store = new MemoryConfigStore();
  const service = new ConfigurationService({
    store,
    githubFactory: () => ({ getAuthenticatedIdentity: async () => ({ id: 123, login: 'alice' }), getText: async () => { throw Object.assign(new Error('missing'), { status: 404 }); }, assertDestinationReachable: async () => ({ id: 77 }) }),
    userBranchProvisioner: async (...args) => {
      store.state.pendingWrites.push({ id: 'accepted-during-provisioning' });
      return provisionUserBranch(...args);
    },
  });
  const config = await service.ensurePersonalStorageBranch();
  assert.equal(config.branch, 'main');
  assert.equal(store.config.branch, 'main');
  assert.equal(store.config.storageBranchVersion, undefined);
  assert.equal(store.state.pendingWrites.length, 1);
});
