import { activeRecordPath, parseActiveRecord } from '../domain/work-records.js';
import { validateBranch, validateOwner, validateRepo } from '../domain/values.js';
import { ensureUserStorageBranch } from './user-storage-branch.js';

function isNotFound(error) { return error?.status === 404 || error?.code === 'not_found'; }

function normalizePayload(payload = {}) {
  const owner = validateOwner(String(payload.owner || '').trim());
  const repo = validateRepo(String(payload.repo || '').trim());
  const branch = validateBranch(String(payload.branch || 'main').trim());
  const recentDays = Number(payload.recentDays);
  if (!Number.isInteger(recentDays) || recentDays < 1 || recentDays > 31) throw new Error('Recent entries shown in the main panel must be between 1 and 31 days');
  const token = String(payload.token || '').trim();
  if (!token || token.length > 1000) throw new Error('GitHub token is required');
  return { config: { owner, repo, branch, recentDays }, token };
}

function repositoryConfigurationError(message, code) {
  return Object.assign(new Error(message), { code });
}

function destinationChanged(previous, next) {
  return Boolean(previous) && (previous.owner !== next.owner || previous.repo !== next.repo || (previous.defaultBranch || previous.branch) !== next.branch);
}

export class ConfigurationService {
  constructor({ store, githubFactory, credentialProvider = null, userBranchProvisioner = ensureUserStorageBranch }) {
    this.store = store;
    this.githubFactory = githubFactory;
    this.credentialProvider = credentialProvider;
    this.userBranchProvisioner = userBranchProvisioner;
  }

  repositoryIdentity(repository, config) {
    if (!Number.isSafeInteger(repository?.id) || repository.id <= 0) {
      throw repositoryConfigurationError(
        'GitHub returned an invalid stable repository identity.', 'repository_identity_unverified',
      );
    }
    const canonical = typeof repository.full_name === 'string' ? repository.full_name : '';
    if (!canonical || canonical.toLowerCase() !== `${config.owner}/${config.repo}`.toLowerCase()) {
      throw repositoryConfigurationError(
        'GitHub returned different canonical repository coordinates.', 'repository_coordinates_changed',
      );
    }
    return repository.id;
  }

  async ensureRepositoryIdentity() {
    const snapshot = await this.store.getConfigurationSnapshot();
    const config = snapshot.config;
    if (!config || config.repoId) return config;
    const credentials = this.credentialProvider ? { credentialProvider: this.credentialProvider } : { token: snapshot.token };
    const github = this.githubFactory({ ...credentials, owner: config.owner, repo: config.repo, branch: config.branch || 'main' });
    const repository = await github.validateRepository();
    const repoId = this.repositoryIdentity(repository, config);
    await github.validateBranch();
    const patch = { repoId, branchMode: 'custom', visibility: 'private' };
    const saved = await this.store.upgradeLegacyRepositoryIdentity(
      snapshot.generation,
      { owner: config.owner, repo: config.repo, branch: config.branch || 'main' },
      patch,
    );
    if (saved !== false) return { ...config, ...patch };
    const current = (await this.store.getConfigurationSnapshot()).config;
    if (current?.repoId) return current;
    throw new Error('Repository configuration changed while its stable identity was being verified.');
  }

  async ensurePersonalStorageBranch() {
    const existing = await this.ensureRepositoryIdentity();
    if (!existing || existing.storageBranchVersion === 1) return existing;
    const [snapshot, authSnapshot, state] = await Promise.all([
      this.store.getConfigurationSnapshot(), this.store.getAuthSnapshot(), this.store.getState(),
    ]);
    const config = snapshot.config;
    if (!config || config.storageBranchVersion === 1 || state.activeCache || (state.pendingWrites || []).length) return config;
    if (!snapshot.token && !authSnapshot.auth?.accessToken) return config;
    const credentials = authSnapshot.auth?.mode === 'github_app' && this.credentialProvider
      ? { credentialProvider: this.credentialProvider }
      : { token: snapshot.token || authSnapshot.auth?.accessToken };
    const sourceBranch = config.defaultBranch || config.branch;
    const github = this.githubFactory({ ...credentials, ...config, branch: sourceBranch, branchMode: 'custom', expectedRepositoryId: config.repoId || null });
    const identity = Number.isSafeInteger(authSnapshot.auth?.githubUserId)
      ? { id: authSnapshot.auth.githubUserId, login: authSnapshot.auth.githubLogin || config.storageLogin || state.user }
      : await github.getAuthenticatedIdentity();
    const storageLogin = config.storageLogin || state.user || identity.login;
    const initialRemoteActive = await this.previousActive(config, authSnapshot.auth, snapshot.token, state);
    if (initialRemoteActive) return config;
    const personal = await this.userBranchProvisioner(github, { id: identity.id, login: storageLogin }, sourceBranch);
    const remoteActive = await this.previousActive(config, authSnapshot.auth, snapshot.token, state);
    if (remoteActive) return config;
    const generation = await this.store.promoteToUserStorageBranch(snapshot.generation, {
      owner: config.owner, repo: config.repo, branch: config.branch,
    }, {
      branch: personal.branch, defaultBranch: sourceBranch, branchMode: 'custom',
      storageLogin, storageBranchVersion: 1,
    });
    if (generation !== false) return { ...config, branch: personal.branch, defaultBranch: sourceBranch, branchMode: 'custom', storageLogin, storageBranchVersion: 1 };
    return (await this.store.getConfigurationSnapshot()).config;
  }

  async previousActive(previousConfig, previousAuth, previousToken, state) {
    if (state.activeCache) return state.activeCache;
    if (!previousConfig || (!previousToken && !this.credentialProvider)) return null;
    const credentials = previousAuth?.mode === 'github_app' && this.credentialProvider
      ? { credentialProvider: this.credentialProvider }
      : { token: previousToken };
    const github = this.githubFactory({
      ...credentials, ...previousConfig,
      expectedRepositoryId: previousConfig.repoId || null,
      branchMode: previousConfig.branchMode || 'custom',
    });
    const user = state.user || await github.getAuthenticatedUser();
    try {
      const path = activeRecordPath(user), file = await github.getText(path);
      return parseActiveRecord(file.text, { user, path, sha: file.sha });
    } catch (error) {
      if (!isNotFound(error)) throw error;
      await github.assertDestinationReachable();
      return null;
    }
  }

  async save(payload) {
    await this.ensureRepositoryIdentity();
    const { config: requestedConfig, token } = normalizePayload(payload);
    const github = this.githubFactory({ token, ...requestedConfig });
    const [identity, repository] = await Promise.all([
      github.getAuthenticatedIdentity(), github.validateRepository(), github.validateBranch(),
    ]);
    const repoId = this.repositoryIdentity(repository, requestedConfig);

    // Read accepted local state only after remote validation closes the
    // validation-vs-Start/Stop race.
    const [configurationSnapshot, state, authSnapshot] = await Promise.all([
      this.store.getConfigurationSnapshot(), this.store.getState(),
      this.store.getAuthSnapshot ? this.store.getAuthSnapshot() : Promise.resolve({ auth: null }),
    ]);
    const { config: previousConfig } = configurationSnapshot;
    const previousToken = configurationSnapshot.token || authSnapshot.auth?.accessToken || '';
    let previousIdentity = Number.isSafeInteger(authSnapshot.auth?.githubUserId)
      ? { id: authSnapshot.auth.githubUserId, login: authSnapshot.auth.githubLogin || '' }
      : null;
    if (!previousIdentity && previousConfig && previousToken) {
      previousIdentity = await this.githubFactory({ token: previousToken, ...previousConfig }).getAuthenticatedIdentity();
    }
    const previousStorageLogin = previousConfig?.storageLogin || state.user || previousIdentity?.login || '';
    const changesDestination = destinationChanged(previousConfig, requestedConfig)
      || Boolean(previousConfig?.repoId && previousConfig.repoId !== repoId);
    const changesUser = Boolean(previousIdentity && previousIdentity.id !== identity.id);
    const changesAuthMode = Boolean(authSnapshot.auth && authSnapshot.auth.mode !== 'pat');
    if (changesAuthMode && (!previousIdentity || changesUser)) {
      throw new Error('The GitHub App and personal access token belong to different GitHub accounts or their stable identity could not be verified.');
    }
    const protectedTransition = changesDestination || changesUser || changesAuthMode;
    if (protectedTransition) {
      if ((state.pendingWrites || []).length) throw new Error('Open Clockoli and finish syncing its pending changes before changing GitHub authentication, the time-data repository, or GitHub user.');
      if (await this.previousActive(previousConfig, authSnapshot.auth, previousToken, { ...state, user: previousStorageLogin })) {
        throw new Error('Stop the active timer before changing GitHub authentication, the time-data repository, or GitHub user.');
      }
    }

    const preservesDataIdentity = Boolean(previousConfig) && !changesDestination && !changesUser;
    const storageLogin = preservesDataIdentity ? previousStorageLogin : identity.login;
    const personal = await this.userBranchProvisioner(github, { id: identity.id, login: storageLogin }, requestedConfig.branch);
    const preservedConfig = preservesDataIdentity ? Object.fromEntries(
      ['installationId', 'repositoryFormatVersion']
        .filter(key => previousConfig[key] !== undefined)
        .map(key => [key, previousConfig[key]]),
    ) : {};
    const config = {
      ...requestedConfig, ...preservedConfig,
      branch: personal.branch, defaultBranch: requestedConfig.branch,
      storageLogin, storageBranchVersion: 1,
      repoId, branchMode: 'custom', visibility: 'private',
    };
    const statePatch = {
      user: preservesDataIdentity ? previousStorageLogin : identity.login,
      activeCache: preservesDataIdentity ? state.activeCache : null,
      recentCache: preservesDataIdentity ? (state.recentCache || []) : [],
      pendingWrites: preservesDataIdentity ? (state.pendingWrites ?? []) : [],
      dataVersion: 4,
      taskMetadataCache: null,
      ...(!preservesDataIdentity ? { reportCache: null } : {}),
    };
    if (this.store.savePatConfiguration) await this.store.savePatConfiguration(config, token, statePatch, identity);
    else await this.store.saveConfiguration(config, token, statePatch);
    return { user: identity.login, config };
  }

}
