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

export class GitHubClient {
  constructor({ token, owner, repo, branch = 'main', fetchImpl = fetch }) {
    if (!token || typeof token !== 'string') throw new Error('GitHub token is required');
    this.token = token;
    this.owner = validateOwner(owner);
    this.repo = validateRepo(repo);
    this.branch = validateBranch(String(branch || 'main'));
    this.fetchImpl = fetchImpl.bind(globalThis);
  }

  get repositoryKey() { return `${this.owner}/${this.repo}@${this.branch}`; }

  async requestDetailed(path, options = {}, { allowNotModified = false } = {}) {
    const response = await this.fetchImpl(`https://api.github.com${path}`, {
      ...options,
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    });
    if (allowNotModified && response.status === 304) {
      return { body: null, status: response.status, headers: response.headers, notModified: true };
    }
    let body = null;
    try { body = await response.json(); } catch { /* empty response */ }
    if (!response.ok) {
      if (response.status === 401) throw new GitHubAuthenticationError();
      if (isRateLimited(response, body)) throw new GitHubRateLimitError(rateLimitMessage(response), response.status);
      if (response.status === 403) throw new GitHubPermissionError();
      if (response.status === 404) throw new GitHubNotFoundError();
      if (response.status === 409) throw new GitHubConflictError();
      if (response.status === 422) throw new GitHubValidationError();
      throw new GitHubApiError(`GitHub request failed (${response.status})`, response.status);
    }
    return { body, status: response.status, headers: response.headers, notModified: false };
  }

  async request(path, options = {}) {
    return (await this.requestDetailed(path, options)).body;
  }

  contentUrl(path) {
    return `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}/contents/${encodePath(path)}`;
  }

  async getAuthenticatedUser() {
    const user = await this.request('/user');
    return user.login;
  }

  async validateRepository() {
    const repo = await this.request(`/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}`);
    if (repo.private !== true) throw new GitHubValidationError(`${this.owner}/${this.repo} must be a private repository.`);
    if (repo.permissions && repo.permissions.push === false) throw new GitHubPermissionError(`You do not have write access to ${this.owner}/${this.repo}.`);
    return repo;
  }

  async validateBranch() {
    return this.request(`/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}/branches/${encodeURIComponent(this.branch)}`);
  }

  async getText(path, { signal } = {}) {
    const body = await this.request(`${this.contentUrl(path)}?ref=${encodeURIComponent(this.branch)}`, { signal });
    if (Array.isArray(body) || body.type !== 'file') throw new GitHubApiError('Expected a file', 422);
    return { path, sha: body.sha, text: decodeBase64Utf8(body.content) };
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
    const files = (tree.tree ?? []).filter(item => item.type === 'blob' && item.path.startsWith(prefix) && item.path.endsWith('.txt'))
      .map(({ path, sha, size }) => ({ path, sha, ...(Number.isSafeInteger(size) && size >= 0 ? { size } : {}) })).sort((a, b) => a.path.localeCompare(b.path));
    return { notModified: false, etag: snapshotEtag, files };
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

  async getTaskMetadata(issues, { batchSize = 40, maxRequests = 40, signal } = {}) {
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
      const fields = batch.map((issue, index) => `task${index}: repository(owner: "${issue.owner}", name: "${issue.repo}") { issueOrPullRequest(number: ${issue.number}) { __typename ... on Issue { title state url } ... on PullRequest { title state url } } }`).join('\n');
      const body = await this.request('/graphql', { method: 'POST', signal, body: JSON.stringify({ query: `query TrackedTasks {\n${fields}\n}` }) });
      if (!body?.data && body?.errors?.length) throw new GitHubApiError('GitHub could not load tracked task details', 422);
      for (let index = 0; index < batch.length; index += 1) {
        const issue = batch[index], node = body?.data?.[`task${index}`]?.issueOrPullRequest;
        const expectedType = issue.type === 'pull_request' ? 'PullRequest' : 'Issue';
        if (!node || node.__typename !== expectedType || node.url !== issue.url || typeof node.title !== 'string') continue;
        const status = String(node.state || '').toUpperCase();
        if (!['OPEN', 'CLOSED', 'MERGED'].includes(status)) continue;
        metadata.set(issue.url, { title: node.title, status });
      }
    }
    return metadata;
  }

  async putText(path, text, message, sha) {
    if (typeof text !== 'string') throw new Error('Text content is required');
    const payload = { message, content: encodeBase64Utf8(text), branch: this.branch, ...(sha ? { sha } : {}) };
    const body = await this.request(this.contentUrl(path), { method: 'PUT', body: JSON.stringify(payload) });
    return { sha: body.content?.sha, commitSha: body.commit?.sha };
  }

  async deleteFile(path, message, sha) {
    if (!sha) throw new Error('SHA is required to delete a file');
    return this.request(this.contentUrl(path), { method: 'DELETE', body: JSON.stringify({ message, sha, branch: this.branch }) });
  }

  async updateTextsAtomic(changes, message) {
    if (!Array.isArray(changes) || changes.length < 2) throw new Error('At least two file changes are required');
    const unique = new Set();
    for (const change of changes) {
      encodePath(change.path);
      if (unique.has(change.path)) throw new Error('Atomic file paths must be unique');
      unique.add(change.path);
      if (change.text !== null && typeof change.text !== 'string') throw new Error('Atomic text content must be a string or null');
    }
    const base = `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}`;
    const refPath = `${base}/git/ref/heads/${encodeURIComponent(this.branch)}`;
    const updateRefPath = `${base}/git/refs/heads/${encodeURIComponent(this.branch)}`;
    const ref = await this.request(refPath), parentSha = ref.object?.sha;
    const commit = await this.request(`${base}/git/commits/${encodeURIComponent(parentSha)}`), treeSha = commit.tree?.sha;
    const currentTree = await this.request(`${base}/git/trees/${encodeURIComponent(treeSha)}?recursive=1`);
    if (currentTree.truncated) throw new GitHubApiError('Repository tree is too large for an atomic update', 422);
    const current = new Map((currentTree.tree ?? []).filter(item => item.type === 'blob').map(item => [item.path, item.sha]));
    for (const change of changes) {
      if ((current.get(change.path) ?? null) !== (change.sha ?? null)) throw new GitHubConflictError();
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
    catch (error) { if (error?.status === 409 || error?.status === 422) throw new GitHubConflictError(); throw error; }
    return { commitSha: nextCommit.sha, blobShas };
  }

}
