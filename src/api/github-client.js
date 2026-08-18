import { validateBranch, validateOwner, validateRepo } from '../domain/values.js';

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

  async request(path, options = {}) {
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
    let body = null;
    try { body = await response.json(); } catch { /* empty response */ }
    if (!response.ok) {
      if (response.status === 401) throw new GitHubAuthenticationError();
      if (response.status === 403) throw new GitHubPermissionError();
      if (response.status === 404) throw new GitHubNotFoundError();
      if (response.status === 409) throw new GitHubConflictError();
      if (response.status === 422) throw new GitHubValidationError();
      throw new GitHubApiError(`GitHub request failed (${response.status})`, response.status);
    }
    return body;
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

  async getFile(path) {
    const body = await this.request(`${this.contentUrl(path)}?ref=${encodeURIComponent(this.branch)}`);
    if (Array.isArray(body) || body.type !== 'file') throw new GitHubApiError('Expected a file', 422);
    let data;
    try { data = JSON.parse(decodeBase64Utf8(body.content)); } catch { throw new GitHubApiError('Stored file is not valid JSON', 422, 'invalid_json'); }
    return { path, sha: body.sha, data };
  }

  async listDirectory(path) {
    const body = await this.request(`${this.contentUrl(path)}?ref=${encodeURIComponent(this.branch)}`);
    if (!Array.isArray(body)) throw new GitHubApiError('Expected a directory', 422);
    return body.map(item => ({ name: item.name, path: item.path, sha: item.sha, type: item.type }));
  }

  async putJson(path, data, message, sha) {
    const payload = { message, content: encodeBase64Utf8(`${JSON.stringify(data, null, 2)}\n`), branch: this.branch, ...(sha ? { sha } : {}) };
    const body = await this.request(this.contentUrl(path), { method: 'PUT', body: JSON.stringify(payload) });
    return { sha: body.content?.sha, commitSha: body.commit?.sha };
  }

  async deleteFile(path, message, sha) {
    if (!sha) throw new Error('SHA is required to delete a file');
    return this.request(this.contentUrl(path), { method: 'DELETE', body: JSON.stringify({ message, sha, branch: this.branch }) });
  }
}
