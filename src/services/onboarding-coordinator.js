import { OnboardingError } from './github-app-onboarding.js';
import { ensureUserStorageBranch } from './user-storage-branch.js';

function changedDestination(previous, candidate, selectedBranch = candidate.defaultBranch) {
  if (!previous) return false;
  if (previous.repoId) return previous.repoId !== candidate.repoId;
  return previous.owner !== candidate.owner || previous.repo !== candidate.repo || previous.branch !== selectedBranch;
}

function transitionError(state) {
  if ((state.pendingWrites || []).length) return new OnboardingError('Open Clockoli and finish syncing its pending changes before changing GitHub authentication or the data repository.', 'migration_blocked');
  if (state.activeCache) return new OnboardingError('Stop the active timer before changing GitHub authentication or the time-data repository.', 'migration_blocked');
  return null;
}

export class OnboardingCoordinator {
  constructor({
    store, currentCredentialProvider, pendingCredentialProvider, githubFactory,
    discoveryFactory, initializerFactory, activeProbe = async () => false, now = () => Date.now(),
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
  }

  async authContext() {
    const [pending, current] = await Promise.all([this.store.getPendingAuthSnapshot(), this.store.getAuthSnapshot()]);
    if (pending.auth?.mode === 'github_app') return { source: 'pending', snapshot: pending, currentSnapshot: current, credentialProvider: this.pendingCredentialProvider };
    if (current.auth?.mode === 'github_app') return { source: 'current', snapshot: current, currentSnapshot: current, credentialProvider: this.currentCredentialProvider };
    throw new OnboardingError('Authorize the Clockoli GitHub App before choosing a repository.', 'github_app_auth_required');
  }

  async discover() {
    const auth = await this.authContext();
    return this.discoveryFactory({ credentialProvider: auth.credentialProvider }).discover();
  }

  async assertSafeTransition(previousConfig, state, changing) {
    if (!changing || !previousConfig) return;
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
    const auth = await this.authContext();
    const discovery = await this.discoveryFactory({ credentialProvider: auth.credentialProvider }).discover();
    let candidate = discovery.candidates.find(value => value.installationId === installationId && value.repoId === repoId);
    if (!candidate) throw new OnboardingError('Clockoli no longer has access to the selected repository.', 'repository_access_required');

    const [{ config: previousConfig }, before] = await Promise.all([
      this.store.getConfigurationSnapshot(), this.store.ensureDataVersion(3),
    ]);
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
    const changing = auth.source === 'pending' || changedDestination(previousConfig, candidate, selectedBranch);
    await this.assertSafeTransition(previousConfig, before, changing);

    const initialize = async () => {
      const github = this.githubFactory({
        credentialProvider: auth.credentialProvider,
        owner: candidate.owner, repo: candidate.repo, branch: selectedBranch,
        expectedRepositoryId: candidate.repoId, branchMode,
      });
      return this.initializerFactory({ github }).initialize({
        id: auth.snapshot.auth.githubUserId,
        login: auth.snapshot.auth.githubLogin,
      }, {
        expectedRepositoryId: candidate.repoId, selectedBranch, branchMode,
        ...(requiredStorageLogin ? { requiredStorageLogin } : {}),
      });
    };
    let initialization;
    try {
      initialization = await initialize();
    } catch (error) {
      if (error?.code !== 'repository_branch_changed' || branchMode !== 'default') throw error;
      const refreshed = await this.discoveryFactory({ credentialProvider: auth.credentialProvider }).discover();
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
    const after = await this.store.ensureDataVersion(3);
    await this.assertSafeTransition(previousConfig, after, changing);
    const recentDays = Number(payload.recentDays ?? previousConfig?.recentDays ?? 7);
    if (!Number.isInteger(recentDays) || recentDays < 1 || recentDays > 31) throw new OnboardingError('Recent entries shown in the main panel must be between 1 and 31 days.', 'invalid_configuration');
    const config = {
      owner: candidate.owner,
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
    const previousStorageLogin = previousConfig?.storageLogin || after.user || '';
    const repositoryDataChanged = !sameRepository
      || (previousStorageLogin && previousStorageLogin !== initialization.storageLogin);
    const patch = {
      user: initialization.storageLogin,
      activeCache: repositoryDataChanged ? null : after.activeCache,
      recentCache: repositoryDataChanged ? [] : (after.recentCache || []),
      pendingWrites: repositoryDataChanged ? [] : (after.pendingWrites || []),
      dataVersion: 3,
      taskMetadataCache: null,
      onboardingLastVerifiedAt: new Date(this.now()).toISOString(),
      onboardingVerificationStatus: initialization.status,
      ...(repositoryDataChanged ? { reportCache: null } : {}),
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
    const selectedBranch = config.branchMode === 'custom' ? config.branch : candidate.defaultBranch;
    const changed = config.owner !== candidate.owner || config.repo !== candidate.repo
      || config.installationId !== candidate.installationId || config.branch !== selectedBranch;
    if (!changed) return { recovered: false, config };
    const repaired = await this.selectRepository({
      installationId: candidate.installationId,
      repoId: candidate.repoId,
      recentDays: config.recentDays,
    });
    return { ...repaired, recovered: true };
  }

  async disconnect() {
    const [snapshot, state, configuration] = await Promise.all([
      this.store.getAuthSnapshot(), this.store.getState(), this.store.getConfigurationSnapshot(),
    ]);
    const local = transitionError(state);
    if (local) throw local;
    if (snapshot.auth && configuration.config && await this.activeProbe({ config: configuration.config, auth: snapshot.auth, state })) {
      throw new OnboardingError('Stop the active timer before disconnecting this browser.', 'migration_blocked');
    }
    if (snapshot.auth && !await this.store.removeCurrentAuthentication(snapshot.authGeneration)) {
      throw new OnboardingError('Authentication changed while disconnecting. Try again.', 'onboarding_superseded');
    }
    return { disconnected: true, remoteAuthorizationRevoked: false };
  }

  async clearLocalConfiguration() {
    const [snapshot, state, configuration] = await Promise.all([
      this.store.getAuthSnapshot(), this.store.getState(), this.store.getConfigurationSnapshot(),
    ]);
    const local = transitionError(state);
    if (local) throw local;
    if (snapshot.auth && configuration.config && await this.activeProbe({ config: configuration.config, auth: snapshot.auth, state })) {
      throw new OnboardingError('Stop the active timer before clearing local Clockoli configuration.', 'migration_blocked');
    }
    await this.store.clearConfig();
    return { cleared: true, remoteDataDeleted: false };
  }
}
