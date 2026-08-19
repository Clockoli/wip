import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubClient, GitHubConflictError, GitHubNotFoundError, GitHubValidationError } from '../src/api/github-client.js';

function response(status, body = null) {
  return { ok: status >= 200 && status < 300, status, headers: new Headers(), json: async () => body };
}

test('GitHub client encodes unicode text and uses SHA for update/delete', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (!options.method) return response(200, { type: 'file', sha: 'oldsha', content: btoa(unescape(encodeURIComponent('Description: ✓\n'))) });
    return response(200, { content: { sha: 'newsha' }, commit: { sha: 'commitsha' } });
  };
  const client = new GitHubClient({ token: 'secret', owner: 'acme', repo: 'time-data', branch: 'main', fetchImpl });
  const file = await client.getText('active/alice.txt');
  assert.equal(file.text, 'Description: ✓\n');
  await client.putText('active/alice.txt', 'Description: Привет\n', 'update', 'oldsha');
  await client.deleteFile('active/alice.txt', 'delete', 'newsha');
  assert.equal(JSON.parse(calls[1].options.body).sha, 'oldsha');
  assert.equal(JSON.parse(calls[2].options.body).sha, 'newsha');
  assert.equal(calls.every(call => call.options.cache === 'no-store'), true);
  assert.equal(client.token, 'secret');
});

test('GitHub client lists report text files from one tree and reads immutable blobs', async () => {
  const sha = 'a'.repeat(40), calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/git/ref/heads/main')) return response(200, { object: { sha: 'parent' } });
    if (url.endsWith('/git/commits/parent')) return response(200, { tree: { sha: 'tree' } });
    if (url.includes('/git/trees/tree?recursive=1')) return response(200, { tree: [
      { path: 'times/2026-08-18/alice.txt', type: 'blob', sha },
      { path: 'active/alice.txt', type: 'blob', sha: 'b'.repeat(40) },
      { path: 'times/readme.md', type: 'blob', sha: 'c'.repeat(40) },
    ] });
    if (url.endsWith(`/git/blobs/${sha}`)) return response(200, { encoding: 'base64', content: btoa('URL: https://github.com/acme/app/issues/1\n'), truncated: false });
    throw new Error(`Unexpected ${url}`);
  };
  const client = new GitHubClient({ token: 'secret', owner: 'acme', repo: 'time-data', fetchImpl });
  assert.deepEqual(await client.listTextFiles('times/'), [{ path: 'times/2026-08-18/alice.txt', sha }]);
  assert.equal((await client.getBlobText('times/2026-08-18/alice.txt', sha)).text, 'URL: https://github.com/acme/app/issues/1\n');
  assert.equal(calls.every(call => call.options.cache === 'no-store'), true);
});

test('GitHub client atomically updates multiple text files from one verified tree', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/git/ref/heads/main') && !options.method) return response(200, { object: { sha: 'parent' } });
    if (url.endsWith('/git/commits/parent')) return response(200, { tree: { sha: 'tree' } });
    if (url.includes('/git/trees/tree?recursive=1')) return response(200, { tree: [{ path: 'a.txt', type: 'blob', sha: 'a-old' }] });
    if (url.endsWith('/git/blobs')) return response(201, { sha: 'blob-new' });
    if (url.endsWith('/git/trees')) return response(201, { sha: 'tree-new' });
    if (url.endsWith('/git/commits')) return response(201, { sha: 'commit-new' });
    if (url.endsWith('/git/refs/heads/main') && options.method === 'PATCH') return response(200, { object: { sha: 'commit-new' } });
    throw new Error(`Unexpected ${url}`);
  };
  const client = new GitHubClient({ token: 'secret', owner: 'acme', repo: 'time-data', fetchImpl });
  const result = await client.updateTextsAtomic([{ path: 'a.txt', sha: 'a-old', text: null }, { path: 'b.txt', sha: null, text: 'hello\n' }], 'move');
  assert.deepEqual(result, { commitSha: 'commit-new', blobShas: { 'b.txt': 'blob-new' } });
  const patch = calls.find(call => call.options.method === 'PATCH');
  assert.deepEqual(JSON.parse(patch.options.body), { sha: 'commit-new', force: false });
  assert.equal(calls.every(call => call.options.cache === 'no-store'), true);
});

test('atomic text update rejects stale expected blobs before creating a commit', async () => {
  let writes = 0;
  const fetchImpl = async (url, options = {}) => {
    if (options.method) writes += 1;
    if (url.endsWith('/git/ref/heads/main')) return response(200, { object: { sha: 'parent' } });
    if (url.endsWith('/git/commits/parent')) return response(200, { tree: { sha: 'tree' } });
    return response(200, { tree: [{ path: 'a.txt', type: 'blob', sha: 'newer' }] });
  };
  const client = new GitHubClient({ token: 'secret', owner: 'acme', repo: 'time-data', fetchImpl });
  await assert.rejects(() => client.updateTextsAtomic([{ path: 'a.txt', sha: 'old', text: 'a' }, { path: 'b.txt', sha: null, text: 'b' }], 'move'), GitHubConflictError);
  assert.equal(writes, 0);
});

test('GitHub client classifies not found and conflicts without exposing credentials', async () => {
  const missing = new GitHubClient({ token: 'do-not-leak', owner: 'a', repo: 'b', fetchImpl: async () => response(404, { message: 'Not Found' }) });
  await assert.rejects(() => missing.getText('x.txt'), error => error instanceof GitHubNotFoundError && !error.message.includes('do-not-leak'));
  const conflict = new GitHubClient({ token: 'x', owner: 'a', repo: 'b', fetchImpl: async () => response(409, { message: 'Conflict' }) });
  await assert.rejects(() => conflict.putText('x.txt', 'text', 'm', 'stale'), GitHubConflictError);
});


test('setup rejects public repositories and 422 is validation, not a concurrency conflict', async () => {
  const publicRepo = new GitHubClient({ token: 'x', owner: 'a', repo: 'b', fetchImpl: async () => response(200, { private: false, permissions: { push: true } }) });
  await assert.rejects(() => publicRepo.validateRepository(), /private/i);
  const invalid = new GitHubClient({ token: 'x', owner: 'a', repo: 'b', fetchImpl: async () => response(422, { message: 'Invalid request' }) });
  await assert.rejects(() => invalid.putText('x.txt', 'text', 'm'), GitHubValidationError);
  await assert.rejects(() => invalid.putText('x.txt', 'text', 'm'), error => !(error instanceof GitHubConflictError));
});


test('GitHub client invokes a WorkerGlobalScope-branded fetch with the global receiver', async () => {
  const workerFetch = async function () {
    if (this !== globalThis) throw new TypeError("Failed to execute 'fetch' on 'WorkerGlobalScope': Illegal invocation");
    return response(200, { login: 'alice' });
  };
  const client = new GitHubClient({ token: 'secret', owner: 'acme', repo: 'time-data', fetchImpl: workerFetch });
  assert.equal(await client.getAuthenticatedUser(), 'alice');
});
