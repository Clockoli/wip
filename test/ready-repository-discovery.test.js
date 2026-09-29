import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { ChromeStore } from '../src/storage/chrome-store.js';
import { OnboardingCoordinator } from '../src/services/onboarding-coordinator.js';
import { ConfigurationService } from '../src/services/configuration.js';
import { withRepositoryRecovery } from '../src/services/repository-operation-recovery.js';
import { resolveStartDestinationId } from '../src/background/destination-runtime.js';

class Backend {
  constructor() { this.data = {}; }
  async getMany(keys) { return structuredClone(Object.fromEntries(keys.filter(key => key in this.data).map(key => [key, this.data[key]]))); }
  async setMany(values) { Object.assign(this.data, structuredClone(values)); }
  async mutateMany(keys, mutate) {
    const change = mutate(await this.getMany(keys));
    if (!change) return false;
    for (const key of change.delete || []) delete this.data[key];
    await this.setMany(change.set || {});
    return change.result ?? true;
  }
}

async function setup({ pending = false, branchError = null, onRead = () => {} } = {}) {
  const backend = new Backend();
  await backend.setMany({ dataVersion: 5, configurationGeneration: 1, authGeneration: 1,
    auth: { mode: 'github_app', githubUserId: 123, githubLogin: 'alice', generation: 1 },
    ...(pending ? { pendingAuth: { mode: 'github_app', githubUserId: 123, githubLogin: 'alice' }, pendingAuthGeneration: 2 } : {}),
    destinationRegistry: { version: 1, defaultDestinationId: null, destinations: {} },
    destinationStates: { version: 1, entries: {} }, activeTimer: null });
  const store = new ChromeStore(backend), reads = [];
  const repositories = [77, 78].map(repoId => ({ repoId, installationId: 88, owner: 'acme', repo: `time-${repoId}`,
    fullName: `acme/time-${repoId}`, ownerType: 'Organization', appPermissions: { contents: 'write' }, defaultBranch: 'main' }));
  const coordinator = new OnboardingCoordinator({ store,
    currentCredentialProvider: {}, pendingCredentialProvider: {},
    discoveryFactory: () => ({ discover: async () => ({ repositories: structuredClone(repositories) }) }),
    initializerFactory: () => { throw new Error('Discovery must never initialize'); },
    userBranchProvisioner: () => { throw new Error('Discovery must never provision'); },
    githubFactory: options => ({
      getAuthenticatedIdentity: async () => ({ id: 123, login: 'alice' }),
      validateRepository: async () => ({ id: options.expectedRepositoryId, private: true, default_branch: 'main', owner: { type: 'Organization' }, permissions: { push: true, admin: true } }),
      assertDestinationReachable: async () => ({ id: options.expectedRepositoryId }),
      getText: async path => {
        reads.push({ path, ...options });
        await onRead(path, backend);
        if (options.branch !== 'main' && options.expectedRepositoryId === 78 && branchError) {
          if (branchError instanceof Error) throw branchError;
          return { text: JSON.stringify(branchError) };
        }
        const value = path === '.clockoli/config.json'
          ? { repositoryFormatVersion: 1, createdAt: '2026-09-01T00:00:00.000Z', createdBy: { id: 123, login: 'alice' }, users: { 123: 'alice' } }
          : path === '.clockoli/user.json' ? { version: 1, githubUserId: 123, storageLogin: 'alice' }
            : { version: 1, storageLogin: 'alice', tasks: {} };
        return { text: JSON.stringify(value) };
      },
    }),
  });
  return { backend, store, coordinator, reads };
}

async function connectBoth(coordinator) {
  await coordinator.selectRepository({ installationId: 88, repoId: 77, action: 'connect' });
  await coordinator.selectRepository({ installationId: 88, repoId: 78, action: 'connect' });
}

test('explicitly connected ready repositories persist and runtime uses their verified branches without provisioning', async () => {
  const { backend, store, coordinator, reads } = await setup();
  const result = await coordinator.discover();
  assert.equal(result.repositories.filter(repository => repository.ready).length, 2);
  assert.deepEqual(Object.keys((await store.getDestinationRegistry()).destinations), []);
  await connectBoth(coordinator);
  const registry = await store.getDestinationRegistry();
  assert.deepEqual(Object.keys(registry.destinations), ['github:77', 'github:78']);
  assert.equal(registry.defaultDestinationId, 'github:77');
  for (const destination of Object.values(registry.destinations)) {
    assert.equal(destination.branch, 'clockoli/users/123');
    assert.equal(destination.storageBranchVersion, 1);
  }
  const restarted = new ChromeStore(backend);
  const configuration = new ConfigurationService({ store: restarted, githubFactory: () => { throw new Error('Runtime must not provision ready storage'); } });
  assert.equal((await configuration.ensurePersonalStorageBranch()).branch, 'clockoli/users/123');
  assert.equal(await resolveStartDestinationId(restarted, 'https://example.test/task'), 'github:77');
  const snapshot = structuredClone(backend.data);
  await coordinator.discover();
  assert.deepEqual(backend.data, snapshot, 'unchanged polls do not change generations or state');
  assert.ok(reads.filter(read => read.path !== '.clockoli/config.json').every(read => read.branch === 'clockoli/users/123'));
});

test('listing does not inspect unrelated repositories; explicit check validates the selected repository', async () => {
  const { store, coordinator, reads } = await setup();
  const listed = await coordinator.listRepositories();
  assert.equal(listed.repositories.length, 2);
  assert.equal(reads.length, 0);
  assert.equal(listed.repositories[1].state, undefined);
  assert.deepEqual((await store.getDestinationRegistry()).destinations, {});
  const checked = await coordinator.checkRepository({ installationId: 88, repoId: 78 });
  assert.equal(checked.repository.ready, true);
  assert.ok(reads.length > 0);
  assert.ok(reads.every(read => read.expectedRepositoryId === 78));
  assert.deepEqual(Object.keys((await store.getDestinationRegistry()).destinations), [], 'checking cannot connect');
});

test('explicit connect revalidates and registers only the chosen ready repository', async () => {
  const { store, coordinator, reads } = await setup();
  await coordinator.checkRepository({ installationId: 88, repoId: 78 });
  assert.deepEqual(Object.keys((await store.getDestinationRegistry()).destinations), []);
  reads.length = 0;
  await coordinator.selectRepository({ installationId: 88, repoId: 78, action: 'connect' });
  assert.ok(reads.length > 0, 'connect must validate again');
  assert.ok(reads.every(read => read.expectedRepositoryId === 78));
  assert.deepEqual(Object.keys((await store.getDestinationRegistry()).destinations), ['github:78']);
});

test('explicit connect refuses a repository whose personal branch no longer validates', async () => {
  const { store, coordinator } = await setup({ branchError: Object.assign(new Error('missing'), { status: 404 }) });
  await assert.rejects(coordinator.selectRepository({ installationId: 88, repoId: 78, action: 'connect' }),
    error => error.code === 'repository_action_unavailable');
  assert.deepEqual(Object.keys((await store.getDestinationRegistry()).destinations), []);
});

test('ready discovery verifies an identical existing non-default destination without rewriting pinned state', async () => {
  const { backend, store, coordinator } = await setup();
  await connectBoth(coordinator);
  const id = 'github:78';
  delete backend.data.repositoryVerification[id];
  backend.data.destinationRegistry.destinations[id].label = 'My team';
  delete backend.data.destinationRegistry.destinations[id].storageBranchVersion;
  backend.data.activeTimer = { destinationId: id, record: { id: 'running' } };
  Object.assign(backend.data.destinationStates.entries[id], {
    pendingWrites: [{ id: 'queued', destinationId: id }], recentCache: [{ id: 'recent' }], activeSha: 'accepted-sha',
  });
  const before = structuredClone(backend.data);
  const discovery = await coordinator.discover();
  assert.equal(discovery.repositories[1].ready, true);
  assert.equal((await store.getOnboardingVerification(id)).status, 'access_checked');
  assert.deepEqual(backend.data.destinationRegistry, before.destinationRegistry);
  assert.deepEqual(backend.data.destinationStates, before.destinationStates);
  assert.deepEqual(backend.data.activeTimer, before.activeTimer);
  assert.equal(backend.data.configurationGeneration, before.configurationGeneration, 'verification does not supersede accepted runtime contexts');
  const verified = structuredClone(backend.data);
  await coordinator.discover();
  assert.deepEqual(backend.data, verified, 'verified destinations do not churn on polls');
});

for (const [field, value] of Object.entries({ owner: 'elsewhere', repo: 'renamed', branch: 'main', storageLogin: 'bob', installationId: 999, branchMode: 'default', authMode: 'pat' })) {
  test(`ready discovery does not verify an existing destination with different ${field}`, async () => {
    const { backend, store, coordinator } = await setup();
    await connectBoth(coordinator);
    delete backend.data.repositoryVerification['github:78'];
    backend.data.destinationRegistry.destinations['github:78'][field] = value;
    const before = structuredClone(backend.data);
    await coordinator.discover();
    assert.equal((await store.getOnboardingVerification('github:78')).status, null);
    assert.deepEqual(backend.data, before);
  });
}

test('existing verification refresh rejects a branch belonging to another current identity', async () => {
  const { backend, store, coordinator } = await setup();
  await connectBoth(coordinator);
  delete backend.data.repositoryVerification['github:78'];
  const configs = Object.values(backend.data.destinationRegistry.destinations);
  backend.data.auth.githubUserId = 999;
  const before = structuredClone(backend.data);
  await store.registerReadyGitHubAppRepositories(configs, 1);
  assert.deepEqual(backend.data, before);
});

test('existing verification refresh remains atomic under replaced or candidate authorization', async () => {
  const { backend, store, coordinator } = await setup();
  await connectBoth(coordinator);
  delete backend.data.repositoryVerification['github:78'];
  const configs = Object.values(backend.data.destinationRegistry.destinations);
  for (const patch of [{ authGeneration: 2 }, { authGeneration: 1, pendingAuth: { mode: 'github_app' } }]) {
    Object.assign(backend.data, patch);
    const before = structuredClone(backend.data);
    assert.equal(await store.registerReadyGitHubAppRepositories(configs, 1), false);
    assert.deepEqual(backend.data, before);
  }
});

test('read recovery and refreshed state never provision old configured branches', async () => {
  const { backend, store, coordinator } = await setup();
  await connectBoth(coordinator);
  delete backend.data.destinationRegistry.destinations['github:77'].storageBranchVersion;
  backend.data.auth.accessToken = 'test-only';
  let provisions = 0;
  const configuration = new ConfigurationService({ store,
    credentialProvider: {},
    githubFactory: () => ({ getText: async () => { throw Object.assign(new Error('missing'), { status: 404 }); }, assertDestinationReachable: async () => {} }),
    userBranchProvisioner: async () => { provisions++; return { branch: 'clockoli/users/123' }; },
  });
  const source = await readFile(new URL('../src/background/service-worker.js', import.meta.url), 'utf8');
  const between = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
  const context = vm.createContext({ store, configuration,
    withRepositoryRecovery: async operation => operation(),
    trackerForDestination: async (id, options) => {
      assert.equal(options.localOnly, true);
      return { getState: async () => ({ recent: [], pendingWrites: [] }) };
    },
  });
  vm.runInContext(between('async function configuredSnapshot(', 'async function onboardingState(')
    + between('const RECOVERABLE_REPOSITORY_MESSAGES', 'function diagnosticError(')
    + between('async function globalTrackerState(', 'async function loadRecentAcrossDestinations('), context);
  const before = structuredClone(backend.data);
  await context.withCurrentRepositoryRecovery({ type: 'GET_STATE', refresh: false }, () => store.getTrackingSnapshot());
  assert.equal(provisions, 0, 'GET_STATE refresh=false must not provision before reading');
  await context.globalTrackerState({ refresh: true });
  assert.equal(provisions, 0, 'remote refresh still must not provision storage');
  assert.deepEqual(backend.data, before);
});

test('member with missing personal storage needs explicit setup, not automatic registration', async () => {
  const { store, coordinator } = await setup({ branchError: Object.assign(new Error('missing'), { status: 404 }) });
  await coordinator.selectRepository({ installationId: 88, repoId: 77, action: 'connect' });
  const result = await coordinator.discover();
  assert.equal(result.repositories[1].ready, false);
  assert.equal(result.repositories[1].branchSetupRequired, true);
  assert.deepEqual(Object.keys((await store.getDestinationRegistry()).destinations), ['github:77']);
});

test('invalid personal branch ownership fails closed while healthy repositories remain usable', async () => {
  const { store, coordinator } = await setup({ branchError: { version: 1, githubUserId: 999, storageLogin: 'alice' } });
  await coordinator.selectRepository({ installationId: 88, repoId: 77, action: 'connect' });
  const result = await coordinator.discover();
  assert.equal(result.repositories[1].ready, false);
  assert.equal(result.repositories[1].eligible, false);
  assert.deepEqual(Object.keys((await store.getDestinationRegistry()).destinations), ['github:77']);
});

test('candidate discovery promotes matching authorization without silently connecting ready repositories', async () => {
  const { backend, store, coordinator } = await setup({ pending: true });
  const result = await coordinator.discover();
  assert.equal(result.repositories.filter(repository => repository.ready).length, 2);
  assert.deepEqual(Object.keys((await store.getDestinationRegistry()).destinations), []);
  assert.equal(backend.data.auth.mode, 'github_app');
  assert.equal(backend.data.auth.githubUserId, 123);
  assert.equal(backend.data.pendingAuth, undefined);
  assert.equal(backend.data.authGeneration, 2);
});

test('candidate promotion preserves local destination preferences and stronger verification evidence', async () => {
  const { backend, coordinator } = await setup();
  await connectBoth(coordinator);
  backend.data.destinationRegistry.destinations['github:77'].recentDays = 13;
  backend.data.destinationRegistry.destinations['github:77'].futureSetting = { keep: true };
  backend.data.repositoryVerification['github:77'] = {
    status: 'write_verified', lastVerifiedAt: 'older-write', futureVerification: { keep: true },
  };
  backend.data.pendingAuth = { mode: 'github_app', githubUserId: 123, githubLogin: 'alice' };
  backend.data.pendingAuthGeneration = 2;
  const result = await coordinator.discover();
  assert.equal(result.promoted, true);
  assert.equal(backend.data.destinationRegistry.destinations['github:77'].recentDays, 13);
  assert.deepEqual(backend.data.destinationRegistry.destinations['github:77'].futureSetting, { keep: true });
  assert.deepEqual(backend.data.repositoryVerification['github:77'], {
    status: 'write_verified', lastVerifiedAt: 'older-write', futureVerification: { keep: true },
  });
});

test('candidate promotion does not need a still-working previous access token', async () => {
  const { backend, coordinator } = await setup();
  await connectBoth(coordinator);
  coordinator.currentCredentialProvider = { source: 'expired-current' };
  coordinator.pendingCredentialProvider = { source: 'candidate' };
  const githubFactory = coordinator.githubFactory;
  coordinator.githubFactory = options => {
    if (options.credentialProvider?.source === 'expired-current') {
      return { getAuthenticatedIdentity: async () => { throw Object.assign(new Error('expired'), { code: 'auth_expired' }); } };
    }
    return githubFactory(options);
  };
  backend.data.pendingAuth = { mode: 'github_app', githubUserId: 123, githubLogin: 'alice' };
  backend.data.pendingAuthGeneration = 2;
  const result = await coordinator.discover();
  assert.equal(result.promoted, true);
  assert.equal(backend.data.pendingAuth, undefined);
});

test('candidate promotion requires the same GitHub identity and access to every configured destination', async () => {
  for (const failure of ['identity', 'access']) {
    const { backend, store, coordinator } = await setup();
    await connectBoth(coordinator);
    backend.data.pendingAuth = { mode: 'github_app', githubUserId: failure === 'identity' ? 999 : 123, githubLogin: failure === 'identity' ? 'mallory' : 'alice' };
    backend.data.pendingAuthGeneration = 2;
    const before = structuredClone(backend.data);
    if (failure === 'access') {
      coordinator.discoveryFactory = () => ({ discover: async () => ({ repositories: [{
        repoId: 77, installationId: 88, owner: 'acme', repo: 'time-77', fullName: 'acme/time-77',
        ownerType: 'Organization', appPermissions: { contents: 'write' }, defaultBranch: 'main',
      }] }) });
    }
    const result = await coordinator.discover();
    assert.equal(result.blocked.code, failure === 'identity' ? 'migration_identity_mismatch' : 'repository_access_required');
    assert.deepEqual(backend.data.auth, before.auth, 'current credentials stay usable');
    assert.deepEqual(backend.data.destinationRegistry, before.destinationRegistry);
    assert.ok(backend.data.pendingAuth);
  }
});

test('candidate promotion is blocked by accepted work before reads and by auth/config/work races at commit', async () => {
  for (const race of ['active', 'pending', 'auth', 'config', 'registry', 'work']) {
    let reads = 0, triggerRace = false;
    const { backend, coordinator } = await setup({ onRead: async (path, values) => {
      reads += 1;
      if (!triggerRace || path !== '.clockoli/tasks.json' || reads < 3) return;
      if (race === 'auth') values.data.pendingAuthGeneration += 1;
      if (race === 'config') values.data.configurationGeneration += 1;
      if (race === 'registry') values.data.destinationRegistry.destinations['github:77'].label = 'changed concurrently';
      if (race === 'work') values.data.activeTimer = { destinationId: 'github:77', record: { id: 'raced' } };
    } });
    await connectBoth(coordinator);
    backend.data.pendingAuth = { mode: 'github_app', githubUserId: 123, githubLogin: 'alice' };
    backend.data.pendingAuthGeneration = 2;
    if (race === 'active') backend.data.activeTimer = { destinationId: 'github:77', record: { id: 'running' } };
    if (race === 'pending') backend.data.destinationStates.entries['github:77'] = { pendingWrites: [{ id: 'queued' }] };
    const current = structuredClone(backend.data.auth);
    reads = 0; triggerRace = true;
    const result = await coordinator.discover();
    assert.ok(result.blocked, `${race} must not promote`);
    const expectedCode = ['active', 'pending', 'work'].includes(race) ? 'migration_blocked' : 'onboarding_superseded';
    assert.equal(result.blocked.code, expectedCode, race);
    assert.deepEqual(backend.data.auth, current);
    assert.ok(backend.data.pendingAuth);
    if (race === 'active' || race === 'pending') assert.equal(reads, 0, 'accepted work blocks candidate validation before GitHub reads');
  }
});

test('candidate authorization validation performs GitHub reads only', async () => {
  const writes = [];
  const { coordinator } = await setup({ pending: true });
  coordinator.initializerFactory = () => ({ execute: async () => writes.push('initialize') });
  coordinator.userBranchProvisioner = async () => { writes.push('provision'); };
  await coordinator.discover();
  assert.deepEqual(writes, []);
});

test('authorization replaced during branch reads prevents local registration atomically', async () => {
  const { store, coordinator } = await setup({ onRead: async (path, backend) => {
    if (path === '.clockoli/tasks.json') await backend.setMany({ authGeneration: 2 });
  } });
  await assert.rejects(coordinator.selectRepository({ installationId: 88, repoId: 77, action: 'connect' }), { code: 'onboarding_superseded' });
  assert.deepEqual((await store.getDestinationRegistry()).destinations, {});
});

for (const scenario of ['renamed', 'custom-branch', 'missing', 'pending-auth', 'replaced-auth', 'changed-config', 'changed-default']) {
  test(`real 404 recovery is remote-read-only and preserves pinned state: ${scenario}`, async () => {
    const { backend, store, coordinator } = await setup();
    await connectBoth(coordinator);
    const id = 'github:77';
    delete backend.data.destinationRegistry.destinations[id].storageBranchVersion;
    if (scenario === 'custom-branch') {
      backend.data.destinationRegistry.destinations[id].branch = 'existing-worklog';
      delete backend.data.destinationRegistry.destinations[id].branchMode;
    }
    backend.data.auth.accessToken = 'test-only';
    backend.data.activeTimer = { destinationId: id, record: { id: 'running' } };
    backend.data.destinationStates.entries[id].pendingWrites = [{ id: 'queued', destinationId: id }];
    const before = structuredClone(backend.data);
    const candidate = { ...before.destinationRegistry.destinations[id], owner: 'renamed-org',
      fullName: 'renamed-org/time-77', appPermissions: { contents: 'write' }, eligible: true, state: 'initialized_member', canAdd: true };
    coordinator.discoveryFactory = () => ({ discover: async () => ({ installations: [{ installationId: 88 }], repositories: [candidate], candidates: [candidate] }) });
    let provisions = 0, initializations = 0, operations = 0;
    coordinator.userBranchProvisioner = async () => { provisions++; return { branch: candidate.branch }; };
    coordinator.initializerFactory = () => ({ execute: async () => {
      initializations++; return { storageLogin: 'alice', repositoryFormatVersion: 1, status: 'access_checked', branch: 'main' };
    } });
    const githubFactory = coordinator.githubFactory;
    coordinator.githubFactory = options => {
      const github = githubFactory(options), getText = github.getText;
      github.getText = async path => {
        if (path === '.clockoli/user.json' && scenario === 'missing') throw Object.assign(new Error('missing personal branch'), { status: 404 });
        if (path === '.clockoli/tasks.json') {
          if (scenario === 'pending-auth') backend.data.pendingAuth = { mode: 'github_app' };
          if (scenario === 'replaced-auth') backend.data.authGeneration++;
          if (scenario === 'changed-config') backend.data.configurationGeneration++;
          if (scenario === 'changed-default') {
            backend.data.destinationRegistry.defaultDestinationId = 'github:78';
            backend.data.configurationGeneration++;
          }
        }
        return getText(path);
      };
      return github;
    };
    const configuration = new ConfigurationService({ store, credentialProvider: {},
      githubFactory: () => { throw new Error('snapshot must be local-only'); } });
    const source = await readFile(new URL('../src/background/service-worker.js', import.meta.url), 'utf8');
    const between = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
    const context = vm.createContext({ store, configuration, onboarding: coordinator, withRepositoryRecovery,
      cancelReports: () => {}, loadCoordinator: { save: async (cancel, operation) => { cancel(); return operation(); } } });
    vm.runInContext(between('async function configuredSnapshot(', 'async function onboardingState(')
      + between('const RECOVERABLE_REPOSITORY_MESSAGES', 'function diagnosticError('), context);
    const read = () => context.withCurrentRepositoryRecovery({ type: 'GET_STATE' }, async () => {
      operations++;
      const snapshot = await store.getConfigurationSnapshot();
      if (snapshot.config.owner !== 'renamed-org') throw Object.assign(new Error('old coordinates missing'), { status: 404 });
      return snapshot.config.owner;
    });
    if (scenario === 'renamed' || scenario === 'custom-branch') {
      assert.equal(await read(), 'renamed-org');
      assert.equal(operations, 2);
      assert.equal((await new ChromeStore(backend).getConfigurationSnapshot()).config.owner, 'renamed-org');
    } else {
      await assert.rejects(read(), scenario === 'missing'
        ? error => error.code === 'personal_branch_setup_required' && /Settings.*Check repository.*confirm/i.test(error.message)
        : { code: 'onboarding_superseded' });
      assert.equal(operations, 1);
      assert.deepEqual(backend.data.destinationRegistry.destinations, before.destinationRegistry.destinations);
    }
    assert.equal(backend.data.destinationRegistry.destinations[id].branch, before.destinationRegistry.destinations[id].branch);
    assert.equal(backend.data.destinationRegistry.destinations[id].storageBranchVersion, undefined);
    assert.deepEqual(backend.data.repositoryVerification, before.repositoryVerification);
    assert.equal(provisions, 0);
    assert.equal(initializations, 0);
    assert.deepEqual(backend.data.activeTimer, before.activeTimer);
    assert.deepEqual(backend.data.destinationStates, before.destinationStates);
    assert.equal(backend.data.destinationRegistry.defaultDestinationId, scenario === 'changed-default' ? 'github:78' : before.destinationRegistry.defaultDestinationId);
    assert.deepEqual(backend.data.destinationRegistry.destinations['github:78'], before.destinationRegistry.destinations['github:78']);
  });
}
