import { OnboardingError, RepositoryInspectionService } from './github-app-onboarding.js';
import { ensureUserStorageBranch, parseUserBranchMetadata, userStorageBranch, USER_METADATA_PATH } from './user-storage-branch.js';
import { parseTaskIndex, TASK_INDEX_PATH } from '../domain/task-index.js';

function transitionError(state) {
  if ((state.pendingWrites || []).length) return new OnboardingError('Open Clockoli and finish syncing its pending changes before changing GitHub authentication or the data repository.', 'migration_blocked');
  if (state.activeCache) return new OnboardingError('Stop the active timer before changing GitHub authentication or the time-data repository.', 'migration_blocked');
  return null;
}

export class OnboardingCoordinator {
  constructor({
    store, currentCredentialProvider, pendingCredentialProvider, githubFactory,
    discoveryFactory, initializerFactory, activeProbe = async () => false, now = () => Date.now(), maxRepositoryInspections = 100,
    userBranchProvisioner = ensureUserStorageBranch,
  }) {
    this.store = store;
    this.currentCredentialProvider = currentCredentialProvider;
    this.pendingCredentialProvider = pendingCredentialProvider;
    this.githubFactory = githubFactory;
    this.discoveryFactory = discoveryFactory;
    this.initializerFactory = initializerFactory;
    this.activeProbe = activeProbe;
    this.userBranchProvisioner = userBranchProvisioner;
    this.now = now;
    this.maxRepositoryInspections = maxRepositoryInspections;
  }

  async authContext() {
    const [pending, current] = await Promise.all([this.store.getPendingAuthSnapshot(), this.store.getAuthSnapshot()]);
    if (pending.auth?.mode === 'github_app') return { source: 'pending', snapshot: pending, currentSnapshot: current, credentialProvider: this.pendingCredentialProvider };
    if (current.auth?.mode === 'github_app') return { source: 'current', snapshot: current, currentSnapshot: current, credentialProvider: this.currentCredentialProvider };
    throw new OnboardingError('Authorize the Clockoli GitHub App before choosing a repository.', 'github_app_auth_required');
  }

  async discover(options = {}) {
    try {
      return await this.discoverWithAuthorization(options);
    } catch (error) {
      const pending = await this.store.getPendingAuthSnapshot();
      if (pending.auth?.mode !== 'github_app' || ![
        'migration_blocked', 'migration_identity_mismatch', 'migration_identity_unverified',
        'repository_access_required', 'onboarding_superseded',
      ].includes(error?.code)) throw error;
      return {
        installations: [], repositories: [], candidates: [], promoted: false,
        blocked: { code: error.code, message: error.message },
      };
    }
  }

  async listRepositories() { return this.discover({ inspectIds: [] }); }

  async checkRepository({ installationId, repoId } = {}) {
    if (!Number.isSafeInteger(installationId) || installationId <= 0
        || !Number.isSafeInteger(repoId) || repoId <= 0) {
      throw new OnboardingError('Select a repository discovered through the Clockoli GitHub App.', 'repository_access_required');
    }
    const result = await this.discover({ inspectIds: [{ installationId, repoId }] });
    if (result.blocked) throw new OnboardingError(result.blocked.message, result.blocked.code);
    const repository = result.repositories.find(value => value.installationId === installationId && value.repoId === repoId);
    if (!repository) throw new OnboardingError('Clockoli cannot access this repository through the GitHub App.', 'repository_access_required');
    return { repository, onboardingStateChanged: result.promoted };
  }

  async discoverWithAuthorization({ inspectIds = null, connectIds = [] } = {}) {
    const auth = await this.authContext();
    const configuration = await this.store.getConfigurationSnapshot();
    if (auth.source === 'pending') {
      await this.store.ensureDataVersion(5);
      await this.assertSafeTransition(configuration, await this.store.ensureDataVersion(5), true,
        { auth: auth.snapshot.auth, credentialProvider: auth.credentialProvider });
      await this.assertMatchingAuthorizationIdentity(auth);
    }
    const existing = Object.values(configuration?.registry?.destinations ?? {});
    const required = inspectIds === null ? null : [
      ...inspectIds, ...existing.map(config => ({ installationId: config.installationId, repoId: config.repoId })),
    ];
    const discovery = await this.inspectDiscovery(auth, required);
    const configs = [];
    for (const repository of discovery.repositories) {
      if (repository.state !== 'initialized_member' || !repository.eligible) continue;
      repository.ready = false;
      const branch = userStorageBranch(auth.snapshot.auth.githubUserId);
      const github = this.githubFactory({ credentialProvider: auth.credentialProvider,
        owner: repository.owner, repo: repository.repo, branch,
        expectedRepositoryId: repository.repoId, branchMode: 'custom' });
      try {
        // Read only: membership alone does not prove the personal branch exists.
        const metadata = parseUserBranchMetadata((await github.getText(USER_METADATA_PATH)).text);
        if (metadata.id !== auth.snapshot.auth.githubUserId || metadata.login.toLowerCase() !== repository.storageLogin.toLowerCase()) {
          throw new Error('Personal storage branch identity mismatch');
        }
        parseTaskIndex((await github.getText(TASK_INDEX_PATH)).text, { user: metadata.login });
        repository.ready = true;
        configs.push({ owner: repository.owner, ownerType: repository.ownerType, repo: repository.repo,
          repoId: repository.repoId, installationId: repository.installationId,
          branch, branchMode: 'custom', defaultBranch: repository.defaultBranch,
          storageBranchVersion: 1, repositoryFormatVersion: 1, storageLogin: metadata.login,
          visibility: 'private', authMode: 'github_app', recentDays: 7 });
      } catch (error) {
        repository.branchSetupRequired = error?.status === 404 || error?.code === 'not_found';
        if (!repository.branchSetupRequired) {
          repository.eligible = false;
          repository.inspectionError = 'personal_branch_unverified';
        }
      }
    }
    if (connectIds.length && !connectIds.every(id => configs.some(config => config.installationId === id.installationId && config.repoId === id.repoId))) {
      throw new OnboardingError('This repository is not ready to connect. Check its access and storage again.', 'repository_action_unavailable');
    }
    const configured = configs.filter(config => existing.some(value => value.repoId === config.repoId)
      || connectIds.some(id => id.installationId === config.installationId && id.repoId === config.repoId));
    if (auth.source === 'current' && configured.length) {
      await this.store.ensureDataVersion(5);
      const saved = await this.store.registerReadyGitHubAppRepositories(configured, auth.snapshot.authGeneration);
      if (!saved) throw new OnboardingError('Authentication changed during discovery. Check repositories again.', 'onboarding_superseded');
      return { ...discovery, candidates: discovery.repositories.filter(repository => repository.eligible), promoted: false };
    }
    if (auth.source === 'pending') {
      const readyById = new Map(configs.map(config => [config.repoId, config]));
      const inaccessible = existing.find(config => !readyById.has(config.repoId));
      if (inaccessible) {
        throw new OnboardingError(`The new GitHub authorization cannot validate ${inaccessible.owner}/${inaccessible.repo}. Grant access to every connected time repository, then try again.`, 'repository_access_required');
      }
      const promotedConfigs = [
        ...existing.map(config => ({ ...config, ...readyById.get(config.repoId),
          recentDays: config.recentDays ?? readyById.get(config.repoId).recentDays, authMode: 'github_app' })),
        ...configured.filter(config => !existing.some(current => current.repoId === config.repoId)),
      ];
      await this.assertSafeTransition(await this.store.getConfigurationSnapshot(), await this.store.ensureDataVersion(5), true,
        { auth: auth.snapshot.auth, credentialProvider: auth.credentialProvider });
      const saved = await this.store.promotePendingGitHubAppAuthorization(promotedConfigs, {
        pendingAuthGeneration: auth.snapshot.authGeneration,
        currentAuthGeneration: auth.currentSnapshot.authGeneration,
        configurationGeneration: configuration.generation,
        registry: configuration.registry,
        githubUserId: auth.snapshot.auth.githubUserId,
        verifiedAt: new Date(this.now()).toISOString(),
      });
      if (!saved) throw new OnboardingError('Authentication, repository configuration, or accepted work changed during authorization. Clockoli kept the current connection; try again.', 'onboarding_superseded');
      return { ...discovery, candidates: discovery.repositories.filter(repository => repository.eligible), promoted: true };
    }
    return { ...discovery, candidates: discovery.repositories.filter(repository => repository.eligible), promoted: false };
  }

  async assertMatchingAuthorizationIdentity(auth) {
    const candidateIdentity = await this.githubFactory({ credentialProvider: auth.credentialProvider }).getAuthenticatedIdentity();
    if (candidateIdentity.id !== auth.snapshot.auth.githubUserId) {
      throw new OnboardingError('GitHub returned a different account for the new authorization.', 'migration_identity_mismatch');
    }
    if (auth.currentSnapshot.auth?.githubUserId
        && auth.currentSnapshot.auth.githubUserId !== candidateIdentity.id) {
      throw new OnboardingError('The existing and new GitHub authorizations belong to different GitHub accounts.', 'migration_identity_mismatch');
    }
  }

  async inspectDiscovery(auth, inspectIds = null) {
    const discovery = await this.discoveryFactory({ credentialProvider: auth.credentialProvider }).discover();
    const selected = repository => inspectIds === null || inspectIds.some(id => id.installationId === repository.installationId && id.repoId === repository.repoId);
    const pending = discovery.repositories.filter(repository => selected(repository) && !repository.state);
    if (!pending.length) return discovery;
    if (!Number.isSafeInteger(this.maxRepositoryInspections) || this.maxRepositoryInspections <= 0
        || pending.length > this.maxRepositoryInspections) {
      throw new OnboardingError('Repository inspection exceeded its bounded result budget.', 'repository_discovery_budget');
    }
    const user = { id: auth.snapshot.auth.githubUserId, login: auth.snapshot.auth.githubLogin };
    const inspected = [];
    for (const repository of discovery.repositories) {
      if (repository.state || !selected(repository)) { inspected.push(repository); continue; }
      const github = this.githubFactory({
        credentialProvider: auth.credentialProvider,
        owner: repository.owner, repo: repository.repo, branch: repository.defaultBranch || 'main',
        expectedRepositoryId: repository.repoId, branchMode: 'default',
      });
      inspected.push(await new RepositoryInspectionService({ github }).inspect(user, repository));
    }
    inspected.sort((left, right) => left.fullName.localeCompare(right.fullName));
    return { ...discovery, repositories: inspected, candidates: inspected.filter(repository => repository.eligible) };
  }

  async assertSafeTransition(configuration, state, changing, credentials = {}) {
    const previousConfig = configuration?.config;
    if (!changing || !previousConfig) return;
    if (typeof this.store.getTrackingSnapshot === 'function' && configuration.registry) {
      const current = credentials.auth ? null : await this.store.getAuthSnapshot();
      await this.assertSafeLocalReset(configuration, credentials.auth || current.auth,
        'changing GitHub authentication', credentials.credentialProvider || this.currentCredentialProvider);
      return;
    }
    const local = transitionError(state);
    if (local) throw local;
    const current = await this.store.getAuthSnapshot();
    if (current.auth && await this.activeProbe({ config: previousConfig, auth: current.auth, state })) {
      throw new OnboardingError('Stop the active timer before changing GitHub authentication or the time-data repository.', 'migration_blocked');
    }
  }

  async selectRepository(payload = {}) {
    const installationId = Number(payload.installationId), repoId = Number(payload.repoId);
    if (!Number.isSafeInteger(installationId) || installationId <= 0 || !Number.isSafeInteger(repoId) || repoId <= 0) {
      throw new OnboardingError('Select a repository discovered through the Clockoli GitHub App.', 'repository_access_required');
    }
    const action = typeof payload.action === 'string' ? payload.action : '';
    if (!['connect', 'add', 'join', 'initialize'].includes(action)) {
      throw new OnboardingError('Choose whether to connect, add, join, or initialize the repository.', 'repository_action_required');
    }
    if (action === 'connect') {
      const result = await this.discoverWithAuthorization({ inspectIds: [{ installationId, repoId }], connectIds: [{ installationId, repoId }] });
      return { repository: result.repositories.find(repository => repository.installationId === installationId && repository.repoId === repoId), status: 'access_checked' };
    }
    const auth = await this.authContext();
    const discovery = await this.inspectDiscovery(auth, [{ installationId, repoId }]);
    let candidate = discovery.candidates.find(value => value.installationId === installationId && value.repoId === repoId);
    if (!candidate) throw new OnboardingError('Clockoli no longer has access to the selected repository.', 'repository_access_required');
    const allowed = { add: candidate.canAdd, join: candidate.canJoin, initialize: candidate.canInitialize };
    if (allowed[action] !== true) {
      throw new OnboardingError(`The selected repository cannot perform the requested ${action} action. Refresh repository access and choose an available action.`, 'repository_action_unavailable');
    }

    await this.store.ensureDataVersion(5);
    const [configurationBefore, before] = await Promise.all([
      this.store.getConfigurationSnapshot(), this.store.ensureDataVersion(5),
    ]);
    const previousConfig = configurationBefore.config;
    let migrationGithub = null, migrationIdentity = null;
    const migratingPat = auth.source === 'pending' && auth.currentSnapshot.auth?.mode === 'pat';
    if (migratingPat) {
      migrationGithub = this.githubFactory({
        credentialProvider: this.currentCredentialProvider,
        ...(previousConfig ? { owner: previousConfig.owner, repo: previousConfig.repo, branch: previousConfig.branch } : {}),
      });
      try { migrationIdentity = await migrationGithub.getAuthenticatedIdentity(); }
      catch (error) {
        throw new OnboardingError(`Clockoli could not verify the existing PAT account: ${error.message}`, 'migration_identity_unverified');
      }
      if (migrationIdentity.id !== auth.snapshot.auth.githubUserId) {
        throw new OnboardingError('The existing PAT and GitHub App authorization belong to different GitHub accounts.', 'migration_identity_mismatch');
      }
    }
    const requiredStorageLogin = migratingPat
      ? (previousConfig?.storageLogin || before.user || migrationIdentity.login)
      : '';
    let selectedBranch = candidate.defaultBranch || 'main';
    let branchMode = 'default';
    const sameRepository = previousConfig && (previousConfig.repoId
      ? previousConfig.repoId === candidate.repoId
      : previousConfig.owner === candidate.owner && previousConfig.repo === candidate.repo);
    const legacyPatCustomBranch = sameRepository && auth.source === 'pending'
      && auth.currentSnapshot.auth?.mode === 'pat' && previousConfig.branch
      && previousConfig.branch !== candidate.defaultBranch;
    const preserveCustomBranch = sameRepository && previousConfig.branch && previousConfig.storageBranchVersion !== 1
      && (previousConfig.branchMode === 'custom' || legacyPatCustomBranch);
    if (preserveCustomBranch) {
      if (!previousConfig.repoId) {
        if (!auth.currentSnapshot.auth) {
          throw new OnboardingError('Reconnect the existing PAT before switching its custom branch to GitHub App authentication.', 'custom_branch_unverified');
        }
        try {
          const previousRepository = await migrationGithub.validateRepository();
          if (previousRepository.id !== candidate.repoId) throw new Error('repository identity mismatch');
        } catch {
          throw new OnboardingError('Clockoli could not verify that the existing custom branch belongs to the selected repository. Resolve the branch or choose another repository.', 'custom_branch_unverified');
        }
      }
      selectedBranch = previousConfig.branch;
      branchMode = 'custom';
    }
    // Adding another destination under the current GitHub authorization does
    // not redirect accepted work. Only an authorization promotion is a
    // protected transition of the existing account/storage identity.
    const changing = auth.source === 'pending';
    await this.assertSafeTransition(configurationBefore, before, changing);

    const initialize = async () => {
      const github = this.githubFactory({
        credentialProvider: auth.credentialProvider,
        owner: candidate.owner, repo: candidate.repo, branch: selectedBranch,
        expectedRepositoryId: candidate.repoId, branchMode,
      });
      const initializer = this.initializerFactory({ github });
      const user = {
        id: auth.snapshot.auth.githubUserId,
        login: auth.snapshot.auth.githubLogin,
      };
      const options = {
        expectedRepositoryId: candidate.repoId, selectedBranch, branchMode,
        ...(requiredStorageLogin ? { requiredStorageLogin } : {}),
      };
      if (typeof initializer.execute === 'function') return initializer.execute(action, user, options);
      if (action === 'initialize' && typeof initializer.initializeRepository === 'function') return initializer.initializeRepository(user, options);
      if (typeof initializer[action] === 'function') return initializer[action](user, options);
      // Temporary compatibility for injected initializers predating explicit actions.
      return initializer.initialize(user, options);
    };
    let initialization;
    try {
      initialization = await initialize();
    } catch (error) {
      if (error?.code !== 'repository_branch_changed' || branchMode !== 'default') throw error;
      const refreshed = await this.inspectDiscovery(auth, [{ installationId, repoId }]);
      const refreshedCandidate = refreshed.candidates.find(value => value.installationId === installationId && value.repoId === repoId);
      if (!refreshedCandidate?.defaultBranch) {
        throw new OnboardingError('GitHub is still finishing repository setup. Wait a moment, then validate again.', 'onboarding_superseded');
      }
      candidate = refreshedCandidate;
      selectedBranch = refreshedCandidate.defaultBranch;
      try { initialization = await initialize(); }
      catch (retryError) {
        if (retryError?.code === 'repository_branch_changed') {
          throw new OnboardingError('GitHub is still finishing repository setup. Wait a moment, then validate again.', 'onboarding_superseded');
        }
        throw retryError;
      }
    }

    const branchSource = initialization.branch || selectedBranch;
    const branchGithub = this.githubFactory({
      credentialProvider: auth.credentialProvider,
      owner: candidate.owner, repo: candidate.repo, branch: branchSource,
      expectedRepositoryId: candidate.repoId,
      branchMode: branchSource === candidate.defaultBranch ? 'default' : 'custom',
    });
    const personal = await this.userBranchProvisioner(branchGithub, {
      id: auth.snapshot.auth.githubUserId,
      login: initialization.storageLogin,
    }, branchSource);

    // Close the validation-vs-Start/Stop race before committing the transition.
    const [configurationAfter, after] = await Promise.all([
      this.store.getConfigurationSnapshot(), this.store.ensureDataVersion(5),
    ]);
    await this.assertSafeTransition(configurationAfter, after, changing);
    const recentDays = Number(payload.recentDays ?? previousConfig?.recentDays ?? 7);
    if (!Number.isInteger(recentDays) || recentDays < 1 || recentDays > 31) throw new OnboardingError('Recent entries shown in the main panel must be between 1 and 31 days.', 'invalid_configuration');
    const config = {
      owner: candidate.owner,
      ...(candidate.ownerType ? { ownerType: candidate.ownerType } : {}),
      repo: candidate.repo,
      branch: personal.branch,
      branchMode: 'custom',
      defaultBranch: branchSource,
      storageBranchVersion: 1,
      repoId: candidate.repoId,
      installationId: candidate.installationId,
      visibility: 'private',
      repositoryFormatVersion: initialization.repositoryFormatVersion,
      storageLogin: initialization.storageLogin,
      recentDays,
      authMode: 'github_app',
    };
    const patch = {
      user: initialization.storageLogin,
      dataVersion: 5,
      taskMetadataCache: null,
      onboardingLastVerifiedAt: new Date(this.now()).toISOString(),
      onboardingVerificationStatus: initialization.status,
    };
    const saved = auth.source === 'pending'
      ? await this.store.commitPendingGitHubAppConfiguration(config, patch, auth.snapshot.authGeneration)
      : await this.store.saveGitHubAppConfiguration(config, patch, auth.snapshot.authGeneration);
    if (saved === false) throw new OnboardingError('Authentication or repository access changed during setup. Check access and try again.', 'onboarding_superseded');
    return { ...initialization, branch: personal.branch, config };
  }

  async recoverCurrentRepository() {
    const [current, pending, configuration] = await Promise.all([
      this.store.getAuthSnapshot(), this.store.getPendingAuthSnapshot(), this.store.getConfigurationSnapshot(),
    ]);
    const config = configuration.config;
    if (current.auth?.mode !== 'github_app' || !config?.repoId) {
      throw new OnboardingError('Reconnect GitHub before checking repository access.', 'github_app_auth_required');
    }
    if (pending.auth) {
      throw new OnboardingError('Finish or cancel the pending GitHub authorization before repairing repository access.', 'onboarding_superseded');
    }
    const discovery = await this.discoveryFactory({ credentialProvider: this.currentCredentialProvider }).discover();
    const candidate = discovery.candidates.find(value => value.repoId === config.repoId);
    if (!candidate) {
      const installationStillVisible = discovery.installations.some(value => value.installationId === config.installationId);
      if (!installationStillVisible) {
        throw new OnboardingError('The Clockoli App installation is no longer available. Install or approve Clockoli, then check again.', 'app_installation_required');
      }
      throw new OnboardingError('The Clockoli App no longer has access to the configured repository. Grant access or choose another private repository.', 'repository_access_required');
    }
    const selectedBranch = config.branchMode === 'default' ? candidate.defaultBranch : config.branch;
    const changed = config.owner !== candidate.owner || config.repo !== candidate.repo
      || config.installationId !== candidate.installationId || config.branch !== selectedBranch;
    // Recovery is not an onboarding action: inspect remotely, then repair only
    // local coordinates. Never initialize, join, provision, or move accepted work.
    const github = this.githubFactory({ credentialProvider: this.currentCredentialProvider,
      owner: candidate.owner, repo: candidate.repo, branch: candidate.defaultBranch,
      expectedRepositoryId: config.repoId, branchMode: 'default' });
    const inspected = await new RepositoryInspectionService({ github }).inspect({
      id: current.auth.githubUserId, login: current.auth.githubLogin,
    }, candidate);
    if (!inspected.eligible || inspected.state !== 'initialized_member') {
      throw new OnboardingError('Open Settings, Check repository, and explicitly confirm the required repository setup or join action.', 'repository_setup_required');
    }
    const personal = this.githubFactory({ credentialProvider: this.currentCredentialProvider,
      owner: candidate.owner, repo: candidate.repo, branch: selectedBranch,
      expectedRepositoryId: config.repoId, branchMode: 'custom' });
    try {
      const metadata = parseUserBranchMetadata((await personal.getText(USER_METADATA_PATH)).text);
      if (metadata.id !== current.auth.githubUserId
          || metadata.login.toLowerCase() !== inspected.storageLogin.toLowerCase()
          || (config.storageLogin && metadata.login !== config.storageLogin)) {
        throw new Error('Personal storage branch identity mismatch');
      }
      parseTaskIndex((await personal.getText(TASK_INDEX_PATH)).text, { user: metadata.login });
    } catch (error) {
      if (error?.status === 404 || error?.code === 'not_found') {
        throw new OnboardingError('Open Settings, Check repository, and explicitly confirm Set up storage branch before retrying. Automatic recovery cannot create personal storage.', 'personal_branch_setup_required');
      }
      throw error;
    }
    const repaired = { ...config, owner: candidate.owner, repo: candidate.repo,
      installationId: candidate.installationId, branch: selectedBranch };
    const saved = await this.store.repairGitHubAppRepositoryCoordinates(
      repaired, current.authGeneration, configuration.generation,
    );
    if (saved === false) throw new OnboardingError('Authentication or repository configuration changed during recovery. Check access and try again.', 'onboarding_superseded');
    return { recovered: changed, config: repaired };
  }

  async assertSafeLocalReset(configuration, auth, action, credentialProvider = this.currentCredentialProvider) {
    if (typeof this.store.getTrackingSnapshot !== 'function' || !configuration.registry) {
      const state = await this.store.getState();
      const local = transitionError(state);
      if (local) throw local;
      if (auth && configuration.config && await this.activeProbe({ config: configuration.config, auth, state, credentialProvider })) {
        throw new OnboardingError(`Stop the active timer before ${action}.`, 'migration_blocked');
      }
      return;
    }
    const tracking = await this.store.getTrackingSnapshot();
    if (tracking.activeTimer) throw new OnboardingError(`Stop the active timer before ${action}.`, 'migration_blocked');
    for (const [destinationId, state] of Object.entries(tracking.destinationStates?.entries ?? {})) {
      if ((state.pendingWrites ?? []).length) {
        throw new OnboardingError('Open Clockoli and finish syncing its pending changes before changing GitHub authentication or the data repository.', 'migration_blocked');
      }
      const config = configuration.registry.destinations?.[destinationId];
      if (auth && config && await this.activeProbe({ config, auth, state: { ...state, activeCache: null }, credentialProvider })) {
        throw new OnboardingError(`Stop the active timer before ${action}.`, 'migration_blocked');
      }
    }
  }

  async disconnect() {
    const [snapshot, configuration] = await Promise.all([
      this.store.getAuthSnapshot(), this.store.getConfigurationSnapshot(),
    ]);
    await this.assertSafeLocalReset(configuration, snapshot.auth, 'disconnecting this browser');
    if (snapshot.auth && !await this.store.removeCurrentAuthentication(snapshot.authGeneration)) {
      throw new OnboardingError('Authentication changed while disconnecting. Try again.', 'onboarding_superseded');
    }
    return { disconnected: true, remoteAuthorizationRevoked: false };
  }

  async clearLocalConfiguration() {
    const [snapshot, configuration] = await Promise.all([
      this.store.getAuthSnapshot(), this.store.getConfigurationSnapshot(),
    ]);
    await this.assertSafeLocalReset(configuration, snapshot.auth, 'clearing local Clockoli configuration');
    await this.store.clearConfig();
    return { cleared: true, remoteDataDeleted: false };
  }
}
