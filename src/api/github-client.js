import { normalizeIssue, validateBranch, validateOwner, validateRepo } from '../domain/values.js';

export class GitHubApiError extends Error {
  constructor(message, status, code = 'github_api_error') { super(message); this.name = this.constructor.name; this.status = status; this.code = code; }
}
export class GitHubNotFoundError extends GitHubApiError {
  constructor(message = 'GitHub resource was not found') { super(message, 404, 'not_found'); }
}
export class GitHubConflictError extends GitHubApiError {
  constructor(message = 'GitHub resource changed concurrently') { super(message, 409, 'conflict'); }
}
export class GitHubValidationError extends GitHubApiError {
  constructor(message = 'GitHub rejected the request') { super(message, 422, 'validation'); }
}
export class GitHubAuthenticationError extends GitHubApiError {
  constructor(message = 'GitHub authentication failed. Check your token in Settings.') { super(message, 401, 'authentication'); }
}
export class GitHubPermissionError extends GitHubApiError {
  constructor(message = 'The token does not have access to the configured repository.') { super(message, 403, 'permission'); }
}
export class GitHubOrganizationApprovalError extends GitHubApiError {
  constructor(message = 'This organization must approve Clockoli before its installations are available.') { super(message, 403, 'org_approval_required'); }
}
export class GitHubRateLimitError extends GitHubApiError {
  constructor(message = 'GitHub API rate limit exceeded. Wait a few minutes and try again.', status = 403) { super(message, status, 'rate_limit'); }
}

function rateLimitMessage(response) {
  const retryAfter = Number(response.headers?.get('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return `GitHub temporarily throttled requests. Try again in ${Math.ceil(retryAfter)} seconds.`;
  }
  const reset = Number(response.headers?.get('x-ratelimit-reset'));
  if (Number.isFinite(reset) && reset > 0) {
    return `GitHub API rate limit exceeded. Try again after ${new Date(reset * 1000).toISOString()}.`;
  }
  return 'GitHub API rate limit exceeded. Wait a few minutes and try again.';
}

function isBranchPolicyRejection(body) {
  const detail = `${body?.message ?? ''} ${JSON.stringify(body?.errors ?? '')}`;
  return /protected branch|repository rule|ruleset|rule violations?|changes? (?:must|are required to) be made through a pull request/i.test(detail);
}

function isRateLimited(response, body) {
  if (response.status === 429) return true;
  if (response.status !== 403) return false;
  if (response.headers?.get('x-ratelimit-remaining') === '0' || response.headers?.get('retry-after')) return true;
  const detail = `${body?.message ?? ''} ${body?.documentation_url ?? ''}`;
  return /rate.?limit|too many requests|abuse detection/i.test(detail);
}

function encodeBase64Utf8(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64Utf8(value) {
  const binary = atob(String(value).replace(/\s/g, ''));
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodePath(path) {
  if (typeof path !== 'string' || path.startsWith('/') || path.includes('..') || path.includes('\\')) throw new Error('Invalid GitHub content path');
  return path.split('/').map(encodeURIComponent).join('/');
}


function isoTimestamp(value) {
  if (value === null || value === undefined) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function providerIdentity(node) {
  if (!node || typeof node.login !== 'string' || !node.login) return null;
  return {
    ...(Number.isSafeInteger(node.databaseId) && node.databaseId > 0 ? { id: node.databaseId } : {}),
    ...(typeof node.id === 'string' && node.id ? { node_id: node.id } : {}),
    login: node.login,
  };
}

function reviewerIdentity(node) {
  if (!node || !['User', 'Team'].includes(node.__typename)) return null;
  const name = node.__typename === 'User' ? node.login : node.slug;
  if (typeof name !== 'string' || !name) return null;
  return {
    kind: node.__typename === 'User' ? 'user' : 'team',
    ...(Number.isSafeInteger(node.databaseId) && node.databaseId > 0 ? { id: node.databaseId } : {}),
    ...(typeof node.id === 'string' && node.id ? { node_id: node.id } : {}),
    ...(node.__typename === 'User' ? { login: name } : { slug: name }),
  };
}

function repositoryIdentity(node) {
  if (!node) return null;
  return {
    ...(Number.isSafeInteger(node.databaseId) && node.databaseId > 0 ? { repository_id: node.databaseId } : {}),
    ...(typeof node.id === 'string' && node.id ? { repository_node_id: node.id } : {}),
  };
}

function taskSnapshot(repository, node, type, capturedAt) {
  const updatedAt = isoTimestamp(node.updatedAt);
  const labels = (node.labels?.nodes ?? []).flatMap(label => (
    label && typeof label.name === 'string' && typeof label.color === 'string' ? [{
      ...(Number.isSafeInteger(label.databaseId) && label.databaseId > 0 ? { id: label.databaseId } : {}),
      ...(typeof label.id === 'string' && label.id ? { node_id: label.id } : {}),
      name: label.name, color: label.color,
    }] : []
  ));
  const milestone = node.milestone && Number.isSafeInteger(node.milestone.number) && typeof node.milestone.title === 'string' ? {
    ...(Number.isSafeInteger(node.milestone.databaseId) && node.milestone.databaseId > 0 ? { id: node.milestone.databaseId } : {}),
    ...(typeof node.milestone.id === 'string' && node.milestone.id ? { node_id: node.milestone.id } : {}),
    number: node.milestone.number, title: node.milestone.title,
  } : null;
  const github = {
    repository: {
      ...(Number.isSafeInteger(repository.databaseId) && repository.databaseId > 0 ? { id: repository.databaseId } : {}),
      ...(typeof repository.id === 'string' && repository.id ? { node_id: repository.id } : {}),
      full_name: repository.nameWithOwner,
    },
    item: { number: node.number, ...(typeof node.id === 'string' && node.id ? { node_id: node.id } : {}), type },
    author: providerIdentity(node.author),
    assignees: (node.assignees?.nodes ?? []).map(providerIdentity).filter(Boolean),
    state: { value: node.merged ? 'merged' : String(node.state).toLowerCase(), reason: node.stateReason ? String(node.stateReason).toLowerCase() : null },
    labels, milestone,
    timestamps: {
      created_at: isoTimestamp(node.createdAt), updated_at: updatedAt,
      closed_at: isoTimestamp(node.closedAt), merged_at: isoTimestamp(node.mergedAt),
    },
    snapshot: { captured_at: capturedAt, source_updated_at: updatedAt, provider: 'github' },
  };
  if (type === 'pull_request') {
    github.pull_request = {
      draft: node.isDraft === true, merged: node.merged === true,
      base: { ...repositoryIdentity(node.baseRepository), ref: node.baseRefName },
      head: { ...repositoryIdentity(node.headRepository), ref: node.headRefName },
      requested_reviewers: (node.reviewRequests?.nodes ?? []).map(value => reviewerIdentity(value?.requestedReviewer)).filter(Boolean),
    };
  }
  return github;
}

export class GitHubClient {
  constructor({ token, credentialProvider = null, owner, repo, branch = 'main', expectedRepositoryId = undefined, branchMode = 'custom', fetchImpl = fetch, now = () => new Date() }) {
    if ((!token || typeof token !== 'string') && !credentialProvider?.getAccessToken) throw new Error('GitHub credentials are required');
    this.token = token || '';
    this.credentialProvider = credentialProvider;
    const hasOwner = owner !== undefined && owner !== null && owner !== '';
    const hasRepo = repo !== undefined && repo !== null && repo !== '';
    if (hasOwner !== hasRepo) throw new Error('GitHub repository owner and name must be provided together');
    this.owner = hasOwner ? validateOwner(owner) : '';
    this.repo = hasRepo ? validateRepo(repo) : '';
    this.branch = validateBranch(String(branch || 'main'));
    if (expectedRepositoryId !== undefined && expectedRepositoryId !== null
        && (!Number.isSafeInteger(expectedRepositoryId) || expectedRepositoryId <= 0)) throw new Error('Invalid expected GitHub repository ID');
    if (!['default', 'custom'].includes(branchMode)) throw new Error('Invalid GitHub branch mode');
    this.expectedRepositoryId = expectedRepositoryId;
    this.branchMode = branchMode;
    this.fetchImpl = fetchImpl.bind(globalThis);
    this.now = now;
  }

  get repositoryKey() { return `${this.owner}/${this.repo}@${this.branch}`; }

  async requestDetailed(path, options = {}, { allowNotModified = false } = {}) {
    const requestWithToken = token => this.fetchImpl(`https://api.github.com${path}`, {
      ...options,
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    });
    let token = this.credentialProvider ? await this.credentialProvider.getAccessToken() : this.token;
    let response = await requestWithToken(token);
    if (response.status === 401 && this.credentialProvider) {
      token = await this.credentialProvider.getAccessToken({ forceRefresh: true, rejectedToken: token });
      response = await requestWithToken(token);
    }
    if (allowNotModified && response.status === 304) {
      return { body: null, status: response.status, headers: response.headers, notModified: true };
    }
    let body = null;
    try { body = await response.json(); } catch { /* empty response */ }
    if (!response.ok) {
      if (response.status === 401) throw new GitHubAuthenticationError();
      if (isRateLimited(response, body)) throw new GitHubRateLimitError(rateLimitMessage(response), response.status);
      if (response.status === 403) {
        const detail = String(body?.message || '').slice(0, 500);
        if (/organi[sz]ation[\s\S]{0,120}(?:approval|approve)|(?:approval|approve)[\s\S]{0,120}organi[sz]ation|third-party application access policy/i.test(detail)) {
          throw new GitHubOrganizationApprovalError();
        }
        throw new GitHubPermissionError();
      }
      if (response.status === 404) throw new GitHubNotFoundError();
      if (response.status === 409) throw new GitHubConflictError();
      if (response.status === 422) {
        if (options.method && isBranchPolicyRejection(body)) {
          throw new GitHubApiError('GitHub branch or repository rules rejected this write.', 422, 'branch_policy_rejected');
        }
        throw new GitHubValidationError();
      }
      throw new GitHubApiError(`GitHub request failed (${response.status})`, response.status);
    }
    return { body, status: response.status, headers: response.headers, notModified: false };
  }
  async request(path, options = {}) {
    return (await this.requestDetailed(path, options)).body;
  }

  contentUrl(path) {
    if (!this.owner || !this.repo) throw new Error('A GitHub repository is required for content operations');
    return `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}/contents/${encodePath(path)}`;
  }

  async getAuthenticatedIdentity() {
    const user = await this.request('/user');
    if (!Number.isSafeInteger(user?.id) || user.id <= 0 || typeof user?.login !== 'string' || !user.login) {
      throw new GitHubApiError('GitHub returned an invalid authenticated user identity.', 502, 'invalid_github_response');
    }
    return { id: user.id, login: user.login };
  }

  async getAuthenticatedUser() { return (await this.getAuthenticatedIdentity()).login; }

  async validateRepository() {
    const repo = await this.request(`/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}`);
    if (repo.private !== true) throw new GitHubApiError(`${this.owner}/${this.repo} must be a private repository.`, 422, 'private_required');
    if (repo.archived === true || repo.disabled === true) {
      throw new GitHubApiError(`${this.owner}/${this.repo} is not writable.`, 422, 'repository_unavailable');
    }
    if (repo.permissions?.push !== true) throw new GitHubApiError(`You do not have write access to ${this.owner}/${this.repo}.`, 403, 'user_write_required');
    return repo;
  }

  async validateBranch() {
    return this.request(`/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}/branches/${encodeURIComponent(this.branch)}`);
  }

  forBranch(branch, branchMode = 'custom') {
    return new GitHubClient({
      token: this.token, credentialProvider: this.credentialProvider,
      owner: this.owner, repo: this.repo, branch,
      expectedRepositoryId: this.expectedRepositoryId,
      branchMode, fetchImpl: this.fetchImpl,
    });
  }

  async ensureBranch(branch, sourceBranch = this.branch) {
    const target = validateBranch(String(branch));
    const source = validateBranch(String(sourceBranch));
    const base = `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}`;
    const refPath = name => `${base}/git/ref/heads/${encodeURIComponent(name)}`;
    await this.assertStableDestinationForWrite();
    try { await this.request(refPath(target)); return { branch: target, created: false }; }
    catch (error) { if (error?.status !== 404) throw error; }
    const sourceRef = await this.request(refPath(source));
    const sha = sourceRef?.object?.sha;
    if (typeof sha !== 'string' || !/^[0-9a-f]{40}$/i.test(sha)) throw new GitHubApiError('GitHub returned an invalid source branch reference.', 502, 'invalid_github_response');
    try {
      await this.request(`${base}/git/refs`, { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${target}`, sha }) });
      return { branch: target, created: true };
    } catch (error) {
      if (error?.status !== 422 && error?.code !== 'validation') throw error;
      try { await this.request(refPath(target)); return { branch: target, created: false }; }
      catch { throw error; }
    }
  }

  async listBranches(prefix, { maxBranches = 1000, signal } = {}) {
    const normalized = String(prefix || '');
    validateBranch(`${normalized}probe`);
    const base = `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}`;
    const body = await this.request(`${base}/git/matching-refs/heads/${encodePath(normalized)}`, { signal });
    if (!Array.isArray(body) || body.length > maxBranches) throw new GitHubApiError('Clockoli user branch discovery exceeded its bounded result budget.', 422, 'branch_discovery_budget');
    const fullPrefix = `refs/heads/${normalized}`;
    return body.map(item => String(item?.ref || '')).filter(ref => ref.startsWith(fullPrefix))
      .map(ref => validateBranch(ref.slice('refs/heads/'.length))).sort();
  }

  assertCanonicalCoordinates(repository) {
    const canonicalName = typeof repository?.full_name === 'string' ? repository.full_name : '';
    if (!canonicalName || canonicalName.toLowerCase() !== `${this.owner}/${this.repo}`.toLowerCase()) {
      throw new GitHubApiError('The configured GitHub repository coordinates changed.', 404, 'repository_coordinates_changed');
    }
  }

  async assertConfiguredBranch(repository) {
    if (this.branchMode === 'default') {
      if (repository.default_branch !== this.branch) {
        throw new GitHubApiError('The configured GitHub default branch changed.', 404, 'repository_branch_changed');
      }
      return;
    }
    try { await this.validateBranch(); }
    catch (error) {
      if (error?.status === 404) throw new GitHubApiError('The configured GitHub branch changed.', 404, 'repository_branch_changed');
      throw error;
    }
  }

  async assertDestinationReachable() {
    if (this.expectedRepositoryId === null) {
      throw new GitHubApiError('The configured GitHub repository identity has not been verified.', 409, 'repository_identity_unverified');
    }
    const repository = await this.validateRepository();
    if (this.expectedRepositoryId !== undefined && repository.id !== this.expectedRepositoryId) {
      throw new GitHubApiError('The configured GitHub repository identity changed.', 404, 'repository_identity_changed');
    }
    if (this.expectedRepositoryId !== undefined) this.assertCanonicalCoordinates(repository);
    await this.assertConfiguredBranch(repository);
    return repository;
  }

  async getText(path, { signal } = {}) {
    const body = await this.request(`${this.contentUrl(path)}?ref=${encodeURIComponent(this.branch)}`, { signal });
    if (Array.isArray(body) || body.type !== 'file') throw new GitHubApiError('Expected a file', 422);
    return { path, sha: body.sha, text: decodeBase64Utf8(body.content) };
  }

  async listRepositoryEntries({ signal } = {}) {
    if (!this.owner || !this.repo) throw new Error('A GitHub repository is required for repository inspection');
    const base = `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}`;
    const ref = await this.request(`${base}/git/ref/heads/${encodeURIComponent(this.branch)}`, { signal });
    const commit = await this.request(`${base}/git/commits/${encodeURIComponent(ref?.object?.sha)}`, { signal });
    const tree = await this.request(`${base}/git/trees/${encodeURIComponent(commit?.tree?.sha)}?recursive=1`, { signal });
    if (tree.truncated || !Array.isArray(tree.tree)) throw new GitHubApiError('Repository tree is invalid or too large to validate safely', 422);
    return tree.tree.map(item => ({
      path: String(item?.path || ''), type: String(item?.type || ''), mode: String(item?.mode || ''),
      ...(typeof item?.sha === 'string' ? { sha: item.sha } : {}),
    })).sort((left, right) => left.path.localeCompare(right.path));
  }

  async listRepositoryFiles(options = {}) {
    return (await this.listRepositoryEntries(options)).filter(item => item.type === 'blob').map(item => item.path).sort();
  }

  async listTextFilesSnapshot(prefix = '', { etag = '', signal } = {}) {
    if (typeof prefix !== 'string' || prefix.startsWith('/') || prefix.includes('..') || prefix.includes('\\')) throw new Error('Invalid GitHub content prefix');
    if (prefix) encodePath(prefix.endsWith('/') ? prefix.slice(0, -1) : prefix);
    const base = `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}`;
    const refResponse = await this.requestDetailed(`${base}/git/ref/heads/${encodeURIComponent(this.branch)}`, {
      signal,
      headers: etag ? { 'If-None-Match': etag } : {},
    }, { allowNotModified: true });
    const snapshotEtag = refResponse.headers?.get('etag') || etag || '';
    if (refResponse.notModified) return { notModified: true, etag: snapshotEtag };
    const commit = await this.request(`${base}/git/commits/${encodeURIComponent(refResponse.body?.object?.sha)}`, { signal });
    const tree = await this.request(`${base}/git/trees/${encodeURIComponent(commit.tree?.sha)}?recursive=1`, { signal });
    if (tree.truncated) throw new GitHubApiError('Repository tree is too large to generate reports', 422);
    const files = (tree.tree ?? []).filter(item => item.type === 'blob' && item.path.startsWith(prefix) && item.path.endsWith('.jsonl'))
      .map(({ path, sha, size }) => ({ path, sha, ...(Number.isSafeInteger(size) && size >= 0 ? { size } : {}) })).sort((a, b) => a.path.localeCompare(b.path));
    return { notModified: false, etag: snapshotEtag, headSha: refResponse.body?.object?.sha || '', files };
  }

  async listTextFiles(prefix = '') {
    return (await this.listTextFilesSnapshot(prefix)).files;
  }

  async getBlobText(path, sha, { signal } = {}) {
    encodePath(path);
    if (typeof sha !== 'string' || !/^[0-9a-f]{40}$/i.test(sha)) throw new Error('Invalid Git blob SHA');
    const body = await this.request(`/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}/git/blobs/${encodeURIComponent(sha)}`, { signal });
    if (body.encoding !== 'base64' || typeof body.content !== 'string' || body.truncated) throw new GitHubApiError('Expected a complete text blob', 422);
    return { path, sha, text: decodeBase64Utf8(body.content) };
  }

  async getTaskMetadata(issues, { batchSize = 40, maxRequests = 40, signal, includeSnapshot = false } = {}) {
    const unique = new Map();
    for (const value of issues ?? []) {
      const issue = normalizeIssue(value); unique.set(issue.url, issue);
    }
    const requested = [...unique.values()], metadata = new Map();
    const size = Math.min(50, Math.max(1, Number(batchSize) || 40));
    const requestBudget = Number(maxRequests);
    if (!Number.isSafeInteger(requestBudget) || requestBudget < 0) throw new Error('Invalid task metadata request budget');
    if (Math.ceil(requested.length / size) > requestBudget) {
      throw new Error(`Task metadata request budget exceeded (${requested.length} tasks; maximum ${requestBudget * size}). Choose a shorter period.`);
    }
    for (let offset = 0; offset < requested.length; offset += size) {
      const batch = requested.slice(offset, offset + size);
      const common = `id databaseId number title url state createdAt updatedAt closedAt author { __typename login ... on User { id databaseId } ... on Bot { id databaseId } ... on Mannequin { id databaseId } ... on Organization { id databaseId } } assignees(first: 25) { nodes { id databaseId login } } labels(first: 50) { nodes { id name color } } milestone { id number title }`;
      const fields = batch.map((issue, index) => includeSnapshot
        ? `task${index}: repository(owner: "${issue.owner}", name: "${issue.repo}") { id databaseId nameWithOwner issueOrPullRequest(number: ${issue.number}) { __typename ... on Issue { ${common} stateReason } ... on PullRequest { ${common} merged mergedAt isDraft baseRefName headRefName baseRepository { id databaseId } headRepository { id databaseId } reviewRequests(first: 25) { nodes { requestedReviewer { __typename ... on User { id databaseId login } ... on Team { id databaseId slug } } } } } } }`
        : `task${index}: repository(owner: "${issue.owner}", name: "${issue.repo}") { issueOrPullRequest(number: ${issue.number}) { __typename ... on Issue { title url } ... on PullRequest { title url } } }`).join('\n');
      let body;
      try {
        body = await this.request('/graphql', { method: 'POST', signal, body: JSON.stringify({ query: `query TrackedTasks {\n${fields}\n}` }) });
      } catch (error) {
        if (!(error instanceof GitHubAuthenticationError)) throw error;
        // GitHub Apps may return 401 when the token is valid but the App lacks
        // source-repository permission. Confirm the user token independently;
        // if it is healthy, metadata is unavailable rather than authentication.
        await this.request('/user', { signal });
        continue;
      }
      if (!body?.data && body?.errors?.length) throw new GitHubApiError('GitHub could not load tracked task details', 422);
      for (let index = 0; index < batch.length; index += 1) {
        const issue = batch[index], repository = body?.data?.[`task${index}`], node = repository?.issueOrPullRequest;
        const expectedType = issue.type === 'pull_request' ? 'PullRequest' : 'Issue';
        if (!node || node.__typename !== expectedType || node.url !== issue.url || typeof node.title !== 'string') continue;
        if (!includeSnapshot) { metadata.set(issue.url, { title: node.title }); continue; }
        if (typeof repository?.nameWithOwner !== 'string' || !Number.isSafeInteger(node.number) || node.number !== issue.number) continue;
        const capturedAt = this.now();
        const capturedIso = capturedAt instanceof Date && !Number.isNaN(capturedAt.getTime()) ? capturedAt.toISOString() : null;
        if (!capturedIso) throw new Error('Invalid GitHub metadata capture time');
        metadata.set(issue.url, { title: node.title, github: taskSnapshot(repository, node, issue.type, capturedIso) });
      }
    }
    return metadata;
  }

  async assertStableDestinationForWrite() {
    if (this.expectedRepositoryId === undefined) return;
    if (this.expectedRepositoryId === null) {
      throw new GitHubApiError('The configured GitHub repository identity has not been verified.', 409, 'repository_identity_unverified');
    }
    const repository = await this.validateRepository();
    if (repository.id !== this.expectedRepositoryId) {
      throw new GitHubApiError('The configured GitHub repository identity changed.', 404, 'repository_identity_changed');
    }
    this.assertCanonicalCoordinates(repository);
    await this.assertConfiguredBranch(repository);
  }

  async putInitialText(path, text, message) {
    if (typeof text !== 'string') throw new Error('Text content is required');
    const repository = await this.validateRepository();
    if (this.expectedRepositoryId !== undefined && repository.id !== this.expectedRepositoryId) {
      throw new GitHubApiError('The configured GitHub repository identity changed.', 404, 'repository_identity_changed');
    }
    if (this.expectedRepositoryId !== undefined) this.assertCanonicalCoordinates(repository);
    if (this.branchMode === 'default' && repository.default_branch) {
      throw new GitHubApiError('The repository gained or changed its default branch during setup.', 409, 'repository_branch_changed');
    }
    try {
      await this.validateBranch();
      throw new GitHubConflictError();
    } catch (error) {
      if (error?.status !== 404) throw error;
    }
    const latestRepository = await this.validateRepository();
    if (this.expectedRepositoryId !== undefined && latestRepository.id !== this.expectedRepositoryId) {
      throw new GitHubApiError('The configured GitHub repository identity changed.', 404, 'repository_identity_changed');
    }
    if (this.expectedRepositoryId !== undefined) this.assertCanonicalCoordinates(latestRepository);
    if (this.branchMode === 'default' && latestRepository.default_branch) {
      throw new GitHubApiError('The repository gained or changed its default branch during setup.', 409, 'repository_branch_changed');
    }
    const payload = { message, content: encodeBase64Utf8(text) };
    const body = await this.request(this.contentUrl(path), { method: 'PUT', body: JSON.stringify(payload) });
    return { sha: body.content?.sha, commitSha: body.commit?.sha };
  }

  async putText(path, text, message, sha) {
    if (typeof text !== 'string') throw new Error('Text content is required');
    await this.assertStableDestinationForWrite();
    const payload = { message, content: encodeBase64Utf8(text), branch: this.branch, ...(sha ? { sha } : {}) };
    const body = await this.request(this.contentUrl(path), { method: 'PUT', body: JSON.stringify(payload) });
    return { sha: body.content?.sha, commitSha: body.commit?.sha };
  }

  async deleteFile(path, message, sha) {
    if (!sha) throw new Error('SHA is required to delete a file');
    await this.assertStableDestinationForWrite();
    return this.request(this.contentUrl(path), { method: 'DELETE', body: JSON.stringify({ message, sha, branch: this.branch }) });
  }

  async updateTextsAtomic(changes, message, { guards = [], expectedHeadSha = null } = {}) {
    if (!Array.isArray(changes) || !changes.length || !Array.isArray(guards) || (changes.length < 2 && !guards.length)) throw new Error('At least two changed or guarded file paths are required');
    if (expectedHeadSha !== null && typeof expectedHeadSha !== 'string') throw new Error('Expected branch head SHA must be a string or null');
    await this.assertStableDestinationForWrite();
    const unique = new Set();
    for (const item of [...changes, ...guards]) {
      encodePath(item.path);
      if (unique.has(item.path)) throw new Error('Atomic changed and guarded file paths must be unique');
      unique.add(item.path);
      if (item.sha !== null && item.sha !== undefined && typeof item.sha !== 'string') throw new Error('Atomic file SHA must be a string or null');
    }
    for (const change of changes) {
      if (change.text !== null && typeof change.text !== 'string') throw new Error('Atomic text content must be a string or null');
    }
    const base = `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}`;
    const refPath = `${base}/git/ref/heads/${encodeURIComponent(this.branch)}`;
    const updateRefPath = `${base}/git/refs/heads/${encodeURIComponent(this.branch)}`;
    const ref = await this.request(refPath), parentSha = ref.object?.sha;
    if (!parentSha) throw new GitHubApiError('GitHub branch head is missing', 422);
    if (expectedHeadSha && parentSha !== expectedHeadSha) throw new GitHubConflictError();
    const commit = await this.request(`${base}/git/commits/${encodeURIComponent(parentSha)}`), treeSha = commit.tree?.sha;
    const currentTree = await this.request(`${base}/git/trees/${encodeURIComponent(treeSha)}?recursive=1`);
    if (currentTree.truncated) throw new GitHubApiError('Repository tree is too large for an atomic update', 422);
    const current = new Map((currentTree.tree ?? []).filter(item => item.type === 'blob').map(item => [item.path, item.sha]));
    for (const item of [...changes, ...guards]) {
      if ((current.get(item.path) ?? null) !== (item.sha ?? null)) throw new GitHubConflictError();
    }
    const blobShas = {}, tree = [];
    for (const change of changes) {
      let sha = null;
      if (change.text !== null) {
        const blob = await this.request(`${base}/git/blobs`, { method: 'POST', body: JSON.stringify({ content: change.text, encoding: 'utf-8' }) });
        sha = blob.sha; blobShas[change.path] = sha;
      }
      tree.push({ path: change.path, mode: '100644', type: 'blob', sha });
    }
    const nextTree = await this.request(`${base}/git/trees`, { method: 'POST', body: JSON.stringify({ base_tree: treeSha, tree }) });
    const nextCommit = await this.request(`${base}/git/commits`, { method: 'POST', body: JSON.stringify({ message, tree: nextTree.sha, parents: [parentSha] }) });
    try { await this.request(updateRefPath, { method: 'PATCH', body: JSON.stringify({ sha: nextCommit.sha, force: false }) }); }
    catch (error) {
      if (error?.code === 'branch_policy_rejected') throw error;
      if (error?.status === 409 || error?.status === 422) throw new GitHubConflictError();
      throw error;
    }
    return { commitSha: nextCommit.sha, blobShas };
  }

}
