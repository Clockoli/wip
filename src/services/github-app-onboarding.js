import { parseActiveRecord, parseMonthlyRecords, parseMonthlyRecordsPath, timestampWithTimezone } from '../domain/work-records.js';
const MARKER_PATH = '.clockoli/config.json';
const REPOSITORY_FORMAT_VERSION = 1;
const MAX_DATA_FILES = 500;
const MAX_DATA_BYTES = 20 * 1024 * 1024;
const MAX_MARKER_BYTES = 64 * 1024;
const MAX_MARKER_USERS = 1000;
const LOGIN_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

export class OnboardingError extends Error {
  constructor(message, code, status = 0) {
    super(message);
    this.name = 'OnboardingError';
    this.code = code;
    this.status = status;
  }
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new OnboardingError(`GitHub returned an invalid ${label}.`, 'invalid_github_response');
  return number;
}

function pageValues(body, key) {
  if (!body || !Array.isArray(body[key])) throw new OnboardingError('GitHub returned an invalid repository-discovery response.', 'invalid_github_response');
  return body[key];
}

function repositoryReasons(repo, appCanWrite) {
  const reasons = [];
  if (repo.private !== true || (repo.visibility && repo.visibility !== 'private')) reasons.push('private_required');
  if (repo.archived === true) reasons.push('archived');
  if (repo.disabled === true) reasons.push('disabled');
  if (!appCanWrite) reasons.push('app_contents_write_required');
  if (repo.permissions?.push !== true) reasons.push('user_write_required');
  if (typeof repo.default_branch !== 'string' || !repo.default_branch) reasons.push('initialized_default_branch_required');
  return reasons;
}

function installationValue(value) {
  return {
    installationId: positiveInteger(value?.id, 'installation ID'),
    accountId: positiveInteger(value?.account?.id, 'installation account ID'),
    accountLogin: String(value.account.login || ''),
    accountType: String(value.account.type || ''),
    repositorySelection: String(value.repository_selection || ''),
    permissions: { ...(value.permissions || {}) },
    settingsUrl: typeof value.html_url === 'string' && value.html_url.startsWith('https://github.com/') ? value.html_url : '',
  };
}

export class InstallationDiscoveryService {
  constructor({ github, perPage = 100, maxPages = 20, maxInstallations = 50, maxRepositoryPages = 100, maxRepositories = 2_000 }) {
    this.github = github;
    this.perPage = Math.min(100, positiveInteger(perPage, 'page size'));
    this.maxPages = positiveInteger(maxPages, 'page budget');
    this.maxInstallations = positiveInteger(maxInstallations, 'installation budget');
    this.maxRepositoryPages = positiveInteger(maxRepositoryPages, 'repository page budget');
    this.maxRepositories = positiveInteger(maxRepositories, 'repository budget');
  }

  async pages(path, key, { maxItems, beforeRequest } = {}) {
    const collected = [];
    for (let page = 1; page <= this.maxPages; page += 1) {
      beforeRequest?.();
      const separator = path.includes('?') ? '&' : '?';
      const body = await this.github.request(`${path}${separator}per_page=${this.perPage}&page=${page}`);
      const values = pageValues(body, key);
      collected.push(...values);
      const total = Number(body.total_count);
      if ((Number.isFinite(total) && total > maxItems) || collected.length > maxItems) {
        throw new OnboardingError('Repository discovery exceeded its bounded result budget.', 'repository_discovery_budget');
      }
      if (values.length < this.perPage || (Number.isFinite(total) && collected.length >= total)) return collected;
    }
    throw new OnboardingError('Repository discovery exceeded its page budget.', 'repository_discovery_budget');
  }

  async discover() {
    const rawInstallations = await this.pages('/user/installations', 'installations', { maxItems: this.maxInstallations });
    const installations = rawInstallations.map(installationValue);
    if (!installations.length) return { installations: [], repositories: [], candidates: [] };
    const repositories = [];
    let repositoryPageRequests = 0;
    const countRepositoryPage = () => {
      repositoryPageRequests += 1;
      if (repositoryPageRequests > this.maxRepositoryPages) {
        throw new OnboardingError('Repository discovery exceeded its aggregate page budget.', 'repository_discovery_budget');
      }
    };
    for (const installation of installations) {
      const values = await this.pages(`/user/installations/${installation.installationId}/repositories`, 'repositories', {
        maxItems: this.maxRepositories,
        beforeRequest: countRepositoryPage,
      });
      if (repositories.length + values.length > this.maxRepositories) {
        throw new OnboardingError('Repository discovery exceeded its aggregate result budget.', 'repository_discovery_budget');
      }
      const appCanWrite = installation.permissions.contents === 'write';
      for (const repo of values) {
        const reasons = repositoryReasons(repo, appCanWrite);
        repositories.push({
          installationId: installation.installationId,
          accountId: installation.accountId,
          accountLogin: installation.accountLogin,
          accountType: installation.accountType,
          repositorySelection: installation.repositorySelection,
          repoId: positiveInteger(repo?.id, 'repository ID'),
          ownerId: positiveInteger(repo?.owner?.id, 'repository owner ID'),
          owner: String(repo.owner.login || ''),
          ownerType: String(repo.owner.type || ''),
          ownership: repo.owner.type === 'User' ? 'personal' : repo.owner.type === 'Organization' ? 'organization' : 'unknown',
          repo: String(repo.name || ''),
          fullName: String(repo.full_name || ''),
          private: repo.private === true && (!repo.visibility || repo.visibility === 'private'),
          visibility: String(repo.visibility || (repo.private === true ? 'private' : 'public')),
          archived: repo.archived === true,
          disabled: repo.disabled === true,
          defaultBranch: String(repo.default_branch || ''),
          appPermissions: { ...installation.permissions },
          userPermissions: { ...(repo.permissions || {}) },
          admin: repo.permissions?.admin === true,
          eligible: reasons.every(reason => reason === 'initialized_default_branch_required'),
          needsInitialization: reasons.includes('initialized_default_branch_required'),
          reasons,
        });
      }
    }
    repositories.sort((left, right) => left.fullName.localeCompare(right.fullName));
    return { installations, repositories, candidates: repositories.filter(repository => repository.eligible) };
  }
}

function isNotFound(error) { return error?.status === 404 || error?.code === 'not_found'; }
function isConflict(error) { return error?.status === 409 || error?.code === 'conflict'; }

function validLogin(value) { return typeof value === 'string' && LOGIN_PATTERN.test(value); }
function validMarkerCreatedAt(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false;
  try { timestampWithTimezone(value); return true; } catch { return false; }
}

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
}

function parseMarker(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).byteLength > MAX_MARKER_BYTES) {
    throw new OnboardingError('The existing Clockoli repository marker is too large.', 'incompatible_storage_format');
  }
  let marker;
  try { marker = JSON.parse(text); }
  catch { throw new OnboardingError('The existing Clockoli repository marker is not valid JSON.', 'incompatible_storage_format'); }
  if (!exactKeys(marker, ['repositoryFormatVersion', 'createdAt', 'createdBy', 'users'])
      || marker.repositoryFormatVersion !== REPOSITORY_FORMAT_VERSION) {
    throw new OnboardingError('This repository uses an unsupported Clockoli storage format.', 'incompatible_storage_format');
  }
  if (!exactKeys(marker.createdBy, ['id', 'login'])
      || !validMarkerCreatedAt(marker.createdAt)
      || !Number.isSafeInteger(marker.createdBy.id) || marker.createdBy.id <= 0 || !validLogin(marker.createdBy.login)) {
    throw new OnboardingError('The existing Clockoli repository marker is invalid.', 'incompatible_storage_format');
  }
  if (!marker.users || typeof marker.users !== 'object' || Array.isArray(marker.users)
      || Object.keys(marker.users).length > MAX_MARKER_USERS) {
    throw new OnboardingError('The existing Clockoli user mapping is invalid.', 'incompatible_storage_format');
  }
  const users = {}, assignedLogins = new Set();
  for (const [id, login] of Object.entries(marker.users)) {
    const normalized = typeof login === 'string' ? login.toLowerCase() : '';
    if (!/^[1-9][0-9]*$/.test(id) || !Number.isSafeInteger(Number(id)) || !validLogin(login) || assignedLogins.has(normalized)) {
      throw new OnboardingError('The existing Clockoli user mapping is invalid.', 'incompatible_storage_format');
    }
    assignedLogins.add(normalized);
    users[id] = login;
  }
  if (users[String(marker.createdBy.id)] !== marker.createdBy.login) {
    throw new OnboardingError('The existing Clockoli marker ownership is invalid.', 'incompatible_storage_format');
  }
  return {
    repositoryFormatVersion: marker.repositoryFormatVersion,
    createdAt: marker.createdAt,
    createdBy: { id: marker.createdBy.id, login: marker.createdBy.login },
    users,
  };
}

function compatibleDirectory(path, entry) {
  return entry.type === 'tree' && entry.mode === '040000' && (
    path === '.clockoli' || path === 'active' || path === 'times' || /^times\/\d{4}-(?:0[1-9]|1[0-2])$/.test(path)
  );
}

async function validateExistingFiles(github, entries) {
  const relevant = [];
  for (const value of entries || []) {
    const entry = typeof value === 'string' ? { path: value, type: 'blob', mode: '100644' } : value;
    const path = typeof entry?.path === 'string' ? entry.path : '';
    const reserved = path === '.clockoli' || path.startsWith('.clockoli/') || path === 'active' || path.startsWith('active/') || path === 'times' || path.startsWith('times/');
    if (!reserved) continue;
    if (compatibleDirectory(path, entry)) continue;
    if (path === '.clockoli' || path === 'active' || path === 'times') {
      throw new OnboardingError(`The repository contains a non-directory Clockoli root at ${path}.`, 'incompatible_storage_format');
    }
    if (entry.type !== 'blob' || entry.mode !== '100644') {
      throw new OnboardingError(`The repository contains an incompatible Clockoli tree entry at ${path || '(unknown path)'}.`, 'incompatible_storage_format');
    }
    if ([MARKER_PATH, '.clockoli/.gitkeep', 'active/.gitkeep', 'times/.gitkeep'].includes(path)) continue;
    if (path.startsWith('.clockoli/')) throw new OnboardingError('The repository contains an incompatible Clockoli control path.', 'incompatible_storage_format');
    if (path.startsWith('active/')) {
      if (!/^active\/[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\.json$/.test(path)) {
        throw new OnboardingError('The repository contains an incompatible active-timer path.', 'incompatible_storage_format');
      }
      relevant.push({ path, type: 'active', user: path.slice(7, -5) });
    }
    if (path.startsWith('times/')) {
      if (!/^times\/\d{4}-(?:0[1-9]|1[0-2])\/[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\.jsonl$/.test(path)) {
        throw new OnboardingError('The repository contains an incompatible monthly time path.', 'incompatible_storage_format');
      }
      const parsed = parseMonthlyRecordsPath(path);
      relevant.push({ path, type: 'monthly', user: parsed.user, month: parsed.month });
    }
  }
  if (relevant.length > MAX_DATA_FILES) throw new OnboardingError('Existing Clockoli storage has too many files to validate safely.', 'storage_layout_budget');
  let bytes = 0;
  for (let index = 0; index < relevant.length; index += 6) {
    const batch = relevant.slice(index, index + 6);
    const files = await Promise.all(batch.map(item => github.getText(item.path)));
    for (let offset = 0; offset < batch.length; offset += 1) {
      const item = batch[offset], file = files[offset];
      bytes += new TextEncoder().encode(file.text).byteLength;
      if (bytes > MAX_DATA_BYTES) throw new OnboardingError('Existing Clockoli storage is too large to validate safely.', 'storage_layout_budget');
      try {
        if (item.type === 'active') parseActiveRecord(file.text, { user: item.user, path: item.path, sha: file.sha });
        else parseMonthlyRecords(file.text, { user: item.user, month: item.month, path: item.path, sha: file.sha });
      } catch (error) {
        throw new OnboardingError(`Existing Clockoli data is incompatible at ${item.path}: ${error.message}`, 'incompatible_storage_format');
      }
    }
  }
}

function inspectionResult(repository, state, { storageLogin = '', errorCode = '' } = {}) {
  const ownership = repository.ownerType === 'User' ? 'personal'
    : repository.ownerType === 'Organization' ? 'organization' : 'unknown';
  const canInitialize = ['empty', 'uninitialized'].includes(state)
    && (ownership === 'personal' || (ownership === 'organization' && repository.userPermissions?.admin === true));
  return {
    ...repository,
    ownership,
    admin: repository.userPermissions?.admin === true,
    state,
    storageLogin,
    canAdd: state === 'initialized_member',
    canJoin: state === 'initialized_joinable',
    canInitialize,
    eligible: state === 'initialized_member' || state === 'initialized_joinable' || canInitialize,
    ...(errorCode ? { inspectionError: errorCode } : {}),
  };
}

export class RepositoryInspectionService {
  constructor({ github }) { this.github = github; }

  async inspect(user, repository) {
    if (!Number.isSafeInteger(user?.id) || user.id <= 0 || !validLogin(user?.login)) {
      return inspectionResult(repository, 'unavailable', { errorCode: 'invalid_github_response' });
    }
    if (repository.appPermissions?.contents !== 'write' || !['User', 'Organization'].includes(repository.ownerType)) {
      return inspectionResult(repository, 'unavailable', { errorCode: repository.reasons?.[0] || 'repository_unavailable' });
    }
    try {
      const fresh = await this.github.validateRepository();
      if (fresh?.id !== repository.repoId) {
        return inspectionResult(repository, 'unavailable', { errorCode: 'repository_identity_changed' });
      }
      const inspectedRepository = {
        ...repository,
        ownerType: String(fresh.owner?.type || ''),
        private: fresh.private === true && (!fresh.visibility || fresh.visibility === 'private'),
        archived: fresh.archived === true,
        disabled: fresh.disabled === true,
        defaultBranch: String(fresh.default_branch || ''),
        userPermissions: { ...(fresh.permissions || {}) },
      };
      const reasons = repositoryReasons(fresh, true);
      const blockingReason = reasons.find(reason => reason !== 'initialized_default_branch_required');
      if (blockingReason || !['User', 'Organization'].includes(inspectedRepository.ownerType)) {
        return inspectionResult(inspectedRepository, 'unavailable', { errorCode: blockingReason || 'repository_unavailable' });
      }
      if (!inspectedRepository.defaultBranch) return inspectionResult(inspectedRepository, 'empty');
      let file = null;
      try { file = await this.github.getText(MARKER_PATH); }
      catch (error) { if (!isNotFound(error)) throw error; }
      if (file) {
        const marker = parseMarker(file.text);
        const storageLogin = marker.users[String(user.id)] || '';
        return inspectionResult(inspectedRepository, storageLogin ? 'initialized_member' : 'initialized_joinable', { storageLogin });
      }
      const entries = this.github.listRepositoryEntries
        ? await this.github.listRepositoryEntries()
        : await this.github.listRepositoryFiles();
      await validateExistingFiles(this.github, entries);
      return inspectionResult(inspectedRepository, 'uninitialized');
    } catch (error) {
      if (['incompatible_storage_format', 'storage_layout_budget'].includes(error?.code)) {
        return inspectionResult(repository, 'incompatible', { errorCode: error.code });
      }
      const errorCode = isNotFound(error) ? 'repository_access_required'
        : ['authentication', 'permission', 'org_approval_required', 'rate_limit', 'private_required', 'user_write_required', 'repository_unavailable', 'invalid_github_response'].includes(error?.code)
          ? error.code : 'repository_unavailable';
      return inspectionResult(repository, 'unavailable', { errorCode });
    }
  }
}

function markerText(user, storageLogin, now) {
  return `${JSON.stringify({
    repositoryFormatVersion: REPOSITORY_FORMAT_VERSION,
    createdAt: new Date(now()).toISOString(),
    createdBy: { id: user.id, login: storageLogin },
    users: { [String(user.id)]: storageLogin },
  }, null, 2)}\n`;
}

function result(status, storageLogin, repository, selectedBranch = repository.default_branch) {
  return {
    status,
    storageLogin,
    repositoryFormatVersion: REPOSITORY_FORMAT_VERSION,
    repositoryId: repository.id,
    branch: selectedBranch,
  };
}

export class RepositoryInitializer {
  constructor({ github, now = () => new Date() }) {
    this.github = github;
    this.now = now;
  }

  async execute(action, user, options = {}) {
    if (!['add', 'join', 'initialize'].includes(action)) {
      throw new OnboardingError('Choose whether to add, join, or initialize the repository.', 'repository_action_required');
    }
    return this.#apply(action, user, options);
  }

  async add(user, options = {}) { return this.execute('add', user, options); }
  async join(user, options = {}) { return this.execute('join', user, options); }
  async initializeRepository(user, options = {}) { return this.execute('initialize', user, options); }

  // Temporary compatibility for callers predating explicit onboarding actions.
  async initialize(user, options = {}) { return this.#apply('legacy', user, options); }

  async #apply(action, user, { expectedRepositoryId, selectedBranch, branchMode = 'default', requiredStorageLogin = '' } = {}) {
    if (!Number.isSafeInteger(user?.id) || user.id <= 0 || !validLogin(user?.login)) throw new OnboardingError('GitHub returned an invalid user identity.', 'invalid_github_response');
    const storageLogin = requiredStorageLogin || user.login;
    if (!validLogin(storageLogin)) throw new OnboardingError('The existing Clockoli storage login is invalid.', 'incompatible_storage_format');
    const validateFreshRepository = async ({ allowEmpty = false, acceptCreatedDefaultBranch = false } = {}) => {
      const fresh = await this.github.validateRepository();
      if (expectedRepositoryId !== undefined && fresh.id !== expectedRepositoryId) {
        throw new OnboardingError('The selected repository identity changed during validation. Refresh repository access and choose it again.', 'repository_identity_changed');
      }
      if (fresh.private !== true) throw new OnboardingError('Clockoli requires a private repository.', 'private_required');
      if (fresh.archived === true || fresh.disabled === true) throw new OnboardingError('The selected repository is not writable.', 'repository_unavailable');
      if (fresh.permissions?.push !== true) throw new OnboardingError('Your GitHub account cannot write to this repository.', 'user_write_required');
      if (!allowEmpty && !fresh.default_branch) throw new OnboardingError('Clockoli could not create the first commit in this empty repository. Open it on GitHub, add a README, then try again.', 'empty_repository');
      if (!acceptCreatedDefaultBranch && branchMode === 'default' && fresh.default_branch && selectedBranch && selectedBranch !== fresh.default_branch) {
        throw new OnboardingError('The repository default branch changed during setup. Check access and select the repository again.', 'repository_branch_changed');
      }
      return fresh;
    };
    let repository = await validateFreshRepository({ allowEmpty: true });
    if (action === 'initialize' && repository.owner?.type === 'Organization' && repository.permissions?.admin !== true) {
      throw new OnboardingError('Organization repository initialization requires GitHub administrator permission.', 'repository_admin_required');
    }
    const initializeEmptyRepository = async () => {
      const text = markerText(user, storageLogin, this.now);
      parseMarker(text);
      try {
        await this.github.putInitialText(MARKER_PATH, text, 'Initialize Clockoli storage');
        repository = await validateFreshRepository({ acceptCreatedDefaultBranch: true });
        return result('write_verified', storageLogin, repository, repository.default_branch);
      } catch (initializationError) {
        if (isNotFound(initializationError)) {
          throw new OnboardingError('Clockoli could not create the first commit. Open the repository on GitHub, choose “Add a README”, commit it to the default branch, then return here and try again.', 'empty_repository');
        }
        throw initializationError;
      }
    };
    if (!repository.default_branch && branchMode === 'default') {
      if (action === 'join') throw new OnboardingError('Join requires an existing valid Clockoli repository marker.', 'repository_not_initialized');
      if (action === 'add') throw new OnboardingError('This GitHub account is not registered in the Clockoli repository.', 'repository_membership_required');
      return initializeEmptyRepository();
    }
    try { await this.github.validateBranch(); }
    catch (error) {
      if (isNotFound(error) && branchMode === 'default' && !['add', 'join'].includes(action)) return initializeEmptyRepository();
      if (isNotFound(error) && action === 'join') throw new OnboardingError('Join requires an existing valid Clockoli repository marker.', 'repository_not_initialized');
      if (isNotFound(error) && action === 'add') throw new OnboardingError('This GitHub account is not registered in the Clockoli repository.', 'repository_membership_required');
      if (isNotFound(error) && selectedBranch && selectedBranch !== repository.default_branch) {
        throw new OnboardingError('The existing custom branch is unavailable to the Clockoli GitHub App. Resolve the branch or choose another repository.', 'custom_branch_unverified');
      }
      if (isNotFound(error)) throw new OnboardingError('The selected branch is unavailable. Choose another repository or branch.', 'custom_branch_unverified');
      throw error;
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await validateFreshRepository();
      const readOptional = async path => {
        try { return await this.github.getText(path); }
        catch (error) { if (isNotFound(error)) return null; throw error; }
      };
      const file = await readOptional(MARKER_PATH);
      const markerPath = MARKER_PATH;
      if (!file) {
        await validateExistingFiles(this.github, this.github.listRepositoryEntries ? await this.github.listRepositoryEntries() : await this.github.listRepositoryFiles());
        await validateFreshRepository();
        if (action === 'join') throw new OnboardingError('Join requires an existing valid Clockoli repository marker.', 'repository_not_initialized');
        if (action === 'add') throw new OnboardingError('This GitHub account is not registered in the Clockoli repository.', 'repository_membership_required');
      } else if (action === 'initialize') {
        throw new OnboardingError('This repository is already initialized for Clockoli.', 'repository_already_initialized');
      }

      let marker;
      if (file) marker = parseMarker(file.text);
      else marker = {
        repositoryFormatVersion: REPOSITORY_FORMAT_VERSION,
        createdAt: new Date(this.now()).toISOString(),
        createdBy: { id: user.id, login: storageLogin },
        users: {},
      };

      const userId = String(user.id);
      if (marker.users[userId]) {
        if (action === 'join') throw new OnboardingError('This GitHub account is already registered in the Clockoli repository.', 'repository_already_joined');
        if (requiredStorageLogin && marker.users[userId] !== requiredStorageLogin) {
          throw new OnboardingError('The repository maps this GitHub account to a different immutable storage login.', 'storage_login_conflict');
        }
        return result('access_checked', marker.users[userId], repository, selectedBranch);
      }
      if (action === 'add') throw new OnboardingError('This GitHub account is not registered in the Clockoli repository.', 'repository_membership_required');
      const occupied = Object.entries(marker.users).find(([id, login]) => id !== userId && login.toLowerCase() === storageLogin.toLowerCase());
      if (occupied) throw new OnboardingError('This repository path is already assigned to another GitHub account.', 'storage_login_conflict');
      marker.users = { ...marker.users, [userId]: storageLogin };
      const text = `${JSON.stringify(marker, null, 2)}\n`;
      // The merged marker must satisfy the same count and UTF-8 byte budgets as a read marker.
      parseMarker(text);
      try {
        await validateFreshRepository();
        await this.github.putText(markerPath, text, file ? 'Register Clockoli user' : 'Initialize Clockoli storage', file?.sha);
        return result('write_verified', storageLogin, repository, selectedBranch);
      } catch (error) {
        if (isConflict(error) || error?.status === 422 || error?.code === 'validation') {
          try {
            await validateFreshRepository();
            const winner = await this.github.getText(markerPath);
            if (!file || winner.sha !== file.sha) continue;
          } catch (readError) {
            if (!isNotFound(readError)) throw readError;
          }
          throw new OnboardingError("GitHub's branch rules do not allow Clockoli to write its storage marker to the selected branch.", 'branch_policy_rejected');
        }
        throw error;
      }
    }
    throw new OnboardingError('Clockoli storage changed repeatedly during initialization. Try again.', 'initialization_conflict');
  }
}
