import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import {
  GitHubClient,
  GitHubConflictError,
  GitHubNotFoundError,
  GitHubPermissionError,
  GitHubRateLimitError,
  GitHubValidationError,
} from '../src/api/github-client.js';

function response(status, body = null, headers = {}) {
  return { ok: status >= 200 && status < 300, status, headers: new Headers(headers), json: async () => body };
}

test('GitHub client encodes unicode text and uses SHA for update/delete', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (!options.method) return response(200, { type: 'file', sha: 'oldsha', content: btoa(unescape(encodeURIComponent('Description: ✓\n'))) });
    return response(200, { content: { sha: 'newsha' }, commit: { sha: 'commitsha' } });
  };
  const client = new GitHubClient({ token: 'secret', owner: 'acme', repo: 'time-data', branch: 'main', fetchImpl });
  const file = await client.getText('active/alice.json');
  assert.equal(file.text, 'Description: ✓\n');
  await client.putText('active/alice.json', 'Description: Привет\n', 'update', 'oldsha');
  await client.deleteFile('active/alice.json', 'delete', 'newsha');
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
      { path: 'times/2026-08/alice.jsonl', type: 'blob', sha },
      { path: 'active/alice.json', type: 'blob', sha: 'b'.repeat(40) },
      { path: 'times/readme.md', type: 'blob', sha: 'c'.repeat(40) },
    ] });
    if (url.endsWith(`/git/blobs/${sha}`)) return response(200, { encoding: 'base64', content: btoa('URL: https://github.com/acme/app/issues/1\n'), truncated: false });
    throw new Error(`Unexpected ${url}`);
  };
  const client = new GitHubClient({ token: 'secret', owner: 'acme', repo: 'time-data', fetchImpl });
  assert.deepEqual(await client.listTextFiles('times/'), [{ path: 'times/2026-08/alice.jsonl', sha }]);
  assert.equal((await client.getBlobText('times/2026-08/alice.jsonl', sha)).text, 'URL: https://github.com/acme/app/issues/1\n');
  assert.equal(calls.every(call => call.options.cache === 'no-store'), true);
});

test('GitHub client returns branch ETags and accepts a conditional 304 snapshot', async () => {
  const sha = 'a'.repeat(40), calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/git/ref/heads/main')) {
      if (options.headers?.['If-None-Match'] === '"snapshot"') return response(304, null, { etag: '"snapshot"' });
      return response(200, { object: { sha: 'parent' } }, { etag: '"snapshot"' });
    }
    if (url.endsWith('/git/commits/parent')) return response(200, { tree: { sha: 'tree' } });
    if (url.includes('/git/trees/tree?recursive=1')) return response(200, { tree: [{ path: 'times/2026-08/alice.jsonl', type: 'blob', sha }] });
    throw new Error(`Unexpected ${url}`);
  };
  const client = new GitHubClient({ token: 'secret', owner: 'acme', repo: 'time-data', fetchImpl });
  const first = await client.listTextFilesSnapshot('times/');
  assert.deepEqual(first, { notModified: false, etag: '"snapshot"', headSha: 'parent', files: [{ path: 'times/2026-08/alice.jsonl', sha }] });
  const second = await client.listTextFilesSnapshot('times/', { etag: first.etag });
  assert.deepEqual(second, { notModified: true, etag: '"snapshot"' });
  assert.equal(calls.length, 4, '304 skips commit and tree requests');
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

test('atomic text update rejects a branch head changed after partition discovery', async () => {
  let writes = 0;
  const fetchImpl = async (url, options = {}) => {
    if (options.method) writes += 1;
    if (url.endsWith('/git/ref/heads/main')) return response(200, { object: { sha: 'new-head' } });
    throw new Error(`Unexpected ${url}`);
  };
  const client = new GitHubClient({ token: 'secret', owner: 'acme', repo: 'time-data', fetchImpl });
  await assert.rejects(() => client.updateTextsAtomic([
    { path: 'times/2026-09/alice.jsonl', sha: null, text: 'new time\n' },
  ], 'bulk', { guards: [{ path: 'active/alice.json', sha: null }], expectedHeadSha: 'discovery-head' }), GitHubConflictError);
  assert.equal(writes, 0);
});

test('atomic text update rejects a stale read-set guard before creating a single-file commit', async () => {
  let writes = 0;
  const fetchImpl = async (url, options = {}) => {
    if (options.method) writes += 1;
    if (url.endsWith('/git/ref/heads/main')) return response(200, { object: { sha: 'parent' } });
    if (url.endsWith('/git/commits/parent')) return response(200, { tree: { sha: 'tree' } });
    return response(200, { tree: [
      { path: 'times/2026-09/alice.jsonl', type: 'blob', sha: 'month-old' },
      { path: 'active/alice.json', type: 'blob', sha: 'active-new' },
    ] });
  };
  const client = new GitHubClient({ token: 'secret', owner: 'acme', repo: 'time-data', fetchImpl });
  await assert.rejects(() => client.updateTextsAtomic([
    { path: 'times/2026-09/alice.jsonl', sha: 'month-old', text: 'new time\n' },
  ], 'bulk', { guards: [{ path: 'active/alice.json', sha: null }] }), GitHubConflictError);
  assert.equal(writes, 0);
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


test('GitHub client distinguishes primary rate limits from repository permission failures', async () => {
  const limited = new GitHubClient({
    token: 'x', owner: 'a', repo: 'b',
    fetchImpl: async () => response(403, { message: 'API rate limit exceeded' }, {
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': '1893456000',
    }),
  });
  await assert.rejects(() => limited.validateRepository(), error => {
    assert.ok(error instanceof GitHubRateLimitError);
    assert.equal(error.code, 'rate_limit');
    assert.match(error.message, /rate limit exceeded/i);
    assert.match(error.message, /2030-01-01T00:00:00\.000Z/);
    return true;
  });

  const forbidden = new GitHubClient({ token: 'x', owner: 'a', repo: 'b', fetchImpl: async () => response(403, { message: 'Forbidden' }) });
  await assert.rejects(() => forbidden.validateRepository(), GitHubPermissionError);
});

test('GitHub client reports secondary throttling and HTTP 429 as rate limits', async () => {
  const secondary = new GitHubClient({
    token: 'x', owner: 'a', repo: 'b',
    fetchImpl: async () => response(403, { message: 'You have exceeded a secondary rate limit.' }, { 'retry-after': '60' }),
  });
  await assert.rejects(() => secondary.validateRepository(), error => (
    error instanceof GitHubRateLimitError
      && error.code === 'rate_limit'
      && /60 seconds/i.test(error.message)
  ));

  const tooMany = new GitHubClient({ token: 'x', owner: 'a', repo: 'b', fetchImpl: async () => response(429, { message: 'Too many requests' }) });
  await assert.rejects(() => tooMany.validateRepository(), error => (
    error instanceof GitHubRateLimitError
      && /wait a few minutes/i.test(error.message)
  ));
});

test('setup rejects public repositories and 422 is validation, not a concurrency conflict', async () => {
  const publicRepo = new GitHubClient({ token: 'x', owner: 'a', repo: 'b', fetchImpl: async () => response(200, { private: false, permissions: { push: true } }) });
  await assert.rejects(() => publicRepo.validateRepository(), /private/i);
  const invalid = new GitHubClient({ token: 'x', owner: 'a', repo: 'b', fetchImpl: async () => response(422, { message: 'Invalid request' }) });
  await assert.rejects(() => invalid.putText('x.txt', 'text', 'm'), error => (
    error instanceof GitHubValidationError && error.message === 'Invalid request'
  ));
  await assert.rejects(() => invalid.putText('x.txt', 'text', 'm'), error => !(error instanceof GitHubConflictError));
});


test('GitHub client returns canonical task metadata snapshots in bounded GraphQL batches', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    const query = JSON.parse(options.body).query;
    assert.match(query, /databaseId nameWithOwner/);
    assert.match(query, /labels\(first: 50\)/);
    assert.match(query, /milestone \{ id number title \}/);
    assert.match(query, /reviewRequests\(first: 25\)/);
    return response(200, { data: {
      task0: { id: 'R_repo', databaseId: 99, nameWithOwner: 'acme/app', issueOrPullRequest: {
        __typename: 'Issue', id: 'I_one', databaseId: 1001, number: 1, title: 'Fix indexing', url: 'https://github.com/acme/app/issues/1', state: 'OPEN', stateReason: null,
        createdAt: '2026-08-01T01:00:00Z', updatedAt: '2026-08-02T02:00:00Z', closedAt: null,
        author: { id: 'U_author', databaseId: 11, login: 'author' }, assignees: { nodes: [{ id: 'U_alice', databaseId: 123, login: 'alice' }] },
        labels: { nodes: [{ id: 'L_bug', name: 'bug', color: 'd73a4a' }] }, milestone: { id: 'M_one', number: 2, title: '1.0' },
      } },
      task1: { id: 'R_repo', databaseId: 99, nameWithOwner: 'acme/app', issueOrPullRequest: {
        __typename: 'PullRequest', id: 'P_two', databaseId: 1002, number: 2, title: 'Ship reports', url: 'https://github.com/acme/app/pull/2', state: 'MERGED', merged: true, isDraft: false,
        createdAt: '2026-08-03T03:00:00Z', updatedAt: '2026-08-04T04:00:00Z', closedAt: '2026-08-04T04:00:00Z', mergedAt: '2026-08-04T03:59:00Z',
        author: { id: 'U_bob', databaseId: 12, login: 'bob' }, assignees: { nodes: [] }, labels: { nodes: [] }, milestone: null,
        baseRefName: 'main', headRefName: 'feature', baseRepository: { id: 'R_repo', databaseId: 99 }, headRepository: { id: 'R_fork', databaseId: 101 },
        reviewRequests: { nodes: [{ requestedReviewer: { __typename: 'User', id: 'U_alice', databaseId: 123, login: 'alice' } }] },
      } },
    } });
  };
  const client = new GitHubClient({ token: 'secret', owner: 'acme', repo: 'time-data', fetchImpl, now: () => new Date('2026-08-26T12:00:00Z') });
  const issues = [
    { type: 'issue', owner: 'acme', repo: 'app', number: 1, url: 'https://github.com/acme/app/issues/1' },
    { type: 'pull_request', owner: 'acme', repo: 'app', number: 2, url: 'https://github.com/acme/app/pull/2' },
  ];
  const metadata = await client.getTaskMetadata(issues, { includeSnapshot: true });
  assert.equal(metadata.get(issues[0].url).title, 'Fix indexing');
  assert.deepEqual(metadata.get(issues[0].url).github, {
    repository: { id: 99, node_id: 'R_repo', full_name: 'acme/app' },
    item: { number: 1, node_id: 'I_one', type: 'issue' },
    author: { id: 11, node_id: 'U_author', login: 'author' },
    assignees: [{ id: 123, node_id: 'U_alice', login: 'alice' }],
    state: { value: 'open', reason: null }, labels: [{ node_id: 'L_bug', name: 'bug', color: 'd73a4a' }],
    milestone: { node_id: 'M_one', number: 2, title: '1.0' },
    timestamps: { created_at: '2026-08-01T01:00:00.000Z', updated_at: '2026-08-02T02:00:00.000Z', closed_at: null, merged_at: null },
    snapshot: { captured_at: '2026-08-26T12:00:00.000Z', source_updated_at: '2026-08-02T02:00:00.000Z', provider: 'github' },
  });
  assert.deepEqual(metadata.get(issues[1].url).github.pull_request, {
    draft: false, merged: true,
    base: { repository_id: 99, repository_node_id: 'R_repo', ref: 'main' },
    head: { repository_id: 101, repository_node_id: 'R_fork', ref: 'feature' },
    requested_reviewers: [{ kind: 'user', id: 123, node_id: 'U_alice', login: 'alice' }],
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.github.com/graphql');
});

test('title-only task metadata does not request snapshot connections', async () => {
  const issue = { type: 'issue', owner: 'acme', repo: 'app', number: 1, url: 'https://github.com/acme/app/issues/1' };
  const client = new GitHubClient({ token: 'secret', owner: 'acme', repo: 'time-data', fetchImpl: async (_url, options) => {
    const query = JSON.parse(options.body).query;
    assert.match(query, /on Issue \{ title url \}/);
    assert.doesNotMatch(query, /labels\(|assignees\(|reviewRequests\(|databaseId/);
    return response(200, { data: { task0: { issueOrPullRequest: { __typename: 'Issue', title: 'Small query', url: issue.url } } } });
  } });
  assert.deepEqual(await client.getTaskMetadata([issue]), new Map([[issue.url, { title: 'Small query' }]]));
});

test('task metadata rejects a GraphQL node whose URL or type does not match the requested task', async () => {
  const fetchImpl = async () => response(200, { data: {
    task0: { issueOrPullRequest: { __typename: 'PullRequest', title: 'Wrong object', state: 'OPEN', url: 'https://github.com/acme/app/pull/1' } },
  } });
  const client = new GitHubClient({ token: 'secret', owner: 'acme', repo: 'time-data', fetchImpl });
  const issue = { type: 'issue', owner: 'acme', repo: 'app', number: 1, url: 'https://github.com/acme/app/issues/1' };
  assert.deepEqual(await client.getTaskMetadata([issue]), new Map());
});

test('GitHub client invokes a WorkerGlobalScope-branded fetch with the global receiver', async () => {
  const workerFetch = async function () {
    if (this !== globalThis) throw new TypeError("Failed to execute 'fetch' on 'WorkerGlobalScope': Illegal invocation");
    return response(200, { id: 123, login: 'alice' });
  };
  const client = new GitHubClient({ token: 'secret', owner: 'acme', repo: 'time-data', fetchImpl: workerFetch });
  assert.equal(await client.getAuthenticatedUser(), 'alice');
});

test('task metadata enforces a total GraphQL request budget before fetching', async () => {
  let calls = 0;
  const client = new GitHubClient({
    token: 'secret', owner: 'acme', repo: 'time-data',
    fetchImpl: async () => { calls += 1; return response(200, { data: {} }); },
  });
  const issues = Array.from({ length: 3 }, (_, index) => ({
    type: 'issue', owner: 'acme', repo: 'app', number: index + 1,
    url: `https://github.com/acme/app/issues/${index + 1}`,
  }));
  await assert.rejects(() => client.getTaskMetadata(issues, { batchSize: 1, maxRequests: 2 }), /metadata request budget/i);
  assert.equal(calls, 0);
});


test('GitHub client obtains dynamic credentials and retries one 401 with a refreshed token', async () => {
  const calls = [], tokenCalls = [];
  const credentialProvider = {
    async getAccessToken(options = {}) {
      tokenCalls.push(options);
      return options.forceRefresh ? 'access-new' : 'access-old';
    },
  };
  const client = new GitHubClient({
    credentialProvider, owner: 'acme', repo: 'time-data',
    fetchImpl: async (url, options) => {
      calls.push({ url, authorization: options.headers.Authorization });
      return options.headers.Authorization === 'Bearer access-old'
        ? response(401, { message: 'Bad credentials' })
        : response(200, { id: 123, login: 'alice' });
    },
  });
  assert.equal(await client.getAuthenticatedUser(), 'alice');
  assert.deepEqual(calls.map(call => call.authorization), ['Bearer access-old', 'Bearer access-new']);
  assert.deepEqual(tokenCalls, [{}, { forceRefresh: true, rejectedToken: 'access-old' }]);
});

test('GitHub client retries authentication only once', async () => {
  let fetches = 0, tokenCalls = 0;
  const client = new GitHubClient({
    credentialProvider: { getAccessToken: async ({ forceRefresh = false } = {}) => { tokenCalls += 1; return forceRefresh ? 'new' : 'old'; } },
    owner: 'acme', repo: 'time-data',
    fetchImpl: async () => { fetches += 1; return response(401, { message: 'Bad credentials' }); },
  });
  await assert.rejects(() => client.getAuthenticatedUser(), error => error.code === 'authentication');
  assert.equal(fetches, 2);
  assert.equal(tokenCalls, 2);
});

test('metadata access rejection degrades to unavailable when the same token still authenticates', async () => {
  const calls = [];
  const provider = { getAccessToken: async ({ forceRefresh = false } = {}) => forceRefresh ? 'refreshed' : 'current' };
  const client = new GitHubClient({
    credentialProvider: provider, owner: 'storage', repo: 'time-data',
    fetchImpl: async (url, options) => {
      calls.push({ url, authorization: options.headers.Authorization });
      if (url.endsWith('/graphql')) return response(401, { message: 'Resource not accessible by integration' });
      if (url.endsWith('/user')) return response(200, { id: 123, login: 'alice' });
      throw new Error(`Unexpected ${url}`);
    },
  });
  const issue = { type: 'issue', owner: 'private-source', repo: 'app', number: 1, url: 'https://github.com/private-source/app/issues/1' };
  assert.deepEqual(await client.getTaskMetadata([issue]), new Map());
  assert.equal(calls.filter(call => call.url.endsWith('/graphql')).length, 2, 'one refresh retry');
  assert.equal(calls.filter(call => call.url.endsWith('/user')).length, 1, 'known-access endpoint validates authentication');
});


test('GitHub client supports user-scoped API requests without a selected repository', async () => {
  const calls = [];
  const client = new GitHubClient({
    credentialProvider: { getAccessToken: async () => 'access' },
    fetchImpl: async (url, options) => { calls.push({ url, options }); return response(200, { total_count: 0, installations: [] }); },
  });
  assert.deepEqual(await client.request('/user/installations?per_page=100&page=1'), { total_count: 0, installations: [] });
  assert.equal(calls[0].options.headers.Authorization, 'Bearer access');
  assert.throws(() => client.contentUrl('x.txt'), /repository is required/i);
});

test('GitHub client lists all repository blob paths for compatible storage inspection', async () => {
  const calls = [];
  const client = new GitHubClient({
    token: 'secret', owner: 'acme', repo: 'time-data', branch: 'main',
    fetchImpl: async url => {
      calls.push(url);
      if (url.endsWith('/git/ref/heads/main')) return response(200, { object: { sha: 'parent' } });
      if (url.endsWith('/git/commits/parent')) return response(200, { tree: { sha: 'tree' } });
      if (url.includes('/git/trees/tree?recursive=1')) return response(200, { tree: [
        { path: 'README.md', type: 'blob', mode: '100644' }, { path: 'active/alice.json', type: 'blob', mode: '100644' }, { path: 'times', type: 'tree', mode: '040000' },
      ] });
      throw new Error(`Unexpected ${url}`);
    },
  });
  assert.deepEqual(await client.listRepositoryEntries(), [
    { path: 'active/alice.json', type: 'blob', mode: '100644' },
    { path: 'README.md', type: 'blob', mode: '100644' },
    { path: 'times', type: 'tree', mode: '040000' },
  ]);
  assert.equal(calls.length, 3);
});

test('repository validation rejects archived and disabled repositories', async () => {
  for (const property of ['archived', 'disabled']) {
    const client = new GitHubClient({
      token: 'secret', owner: 'acme', repo: 'time-data',
      fetchImpl: async () => response(200, { private: true, permissions: { push: true }, [property]: true }),
    });
    await assert.rejects(() => client.validateRepository(), /not writable/i);
  }
});


test('destination reachability verifies stable repository ID and default-branch provenance without an extra branch request', async () => {
  const calls = [];
  const client = new GitHubClient({
    token: 'secret', owner: 'acme', repo: 'time-data', branch: 'trunk', expectedRepositoryId: 42, branchMode: 'default',
    fetchImpl: async url => { calls.push(url); return response(200, { id: 42, full_name: 'acme/time-data', private: true, archived: false, disabled: false, default_branch: 'trunk', permissions: { push: true } }); },
  });
  assert.equal((await client.assertDestinationReachable()).id, 42);
  assert.equal(calls.length, 1);

  const movedIdentity = new GitHubClient({
    token: 'secret', owner: 'acme', repo: 'time-data', branch: 'trunk', expectedRepositoryId: 42, branchMode: 'default',
    fetchImpl: async () => response(200, { id: 99, full_name: 'acme/time-data', private: true, archived: false, disabled: false, default_branch: 'trunk', permissions: { push: true } }),
  });
  await assert.rejects(() => movedIdentity.assertDestinationReachable(), error => error.code === 'repository_identity_changed' && error.status === 404);
});

test('destination reachability rejects a renamed default branch and validates a custom branch', async () => {
  const renamed = new GitHubClient({
    token: 'secret', owner: 'acme', repo: 'time-data', branch: 'main', expectedRepositoryId: 42, branchMode: 'default',
    fetchImpl: async () => response(200, { id: 42, full_name: 'acme/time-data', private: true, archived: false, disabled: false, default_branch: 'trunk', permissions: { push: true } }),
  });
  await assert.rejects(() => renamed.assertDestinationReachable(), error => error.code === 'repository_branch_changed' && error.status === 404);

  const calls = [];
  const custom = new GitHubClient({
    token: 'secret', owner: 'acme', repo: 'time-data', branch: 'release', expectedRepositoryId: 42, branchMode: 'custom',
    fetchImpl: async url => {
      calls.push(url);
      if (url.endsWith('/repos/acme/time-data')) return response(200, { id: 42, full_name: 'acme/time-data', private: true, archived: false, disabled: false, default_branch: 'trunk', permissions: { push: true } });
      if (url.endsWith('/branches/release')) return response(200, { name: 'release' });
      throw new Error(`Unexpected ${url}`);
    },
  });
  await custom.assertDestinationReachable();
  assert.equal(calls.length, 2);
});


test('organization approval 403 remains distinct from repository permission denial', async () => {
  const client = new GitHubClient({ token: 'x', fetchImpl: async () => response(403, {
    message: 'This organization requires approval for this GitHub App.',
    documentation_url: 'https://docs.github.com/apps/using-github-apps/reviewing-and-revoking-authorization-of-github-apps',
  }) });
  await assert.rejects(() => client.request('/user/installations'), error => error.code === 'org_approval_required' && error.status === 403);
});

test('mutating content requests verify the configured stable repository ID before writing', async () => {
  const calls = [];
  const client = new GitHubClient({
    token: 'secret', owner: 'acme', repo: 'time-data', branch: 'main', expectedRepositoryId: 77,
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (url.endsWith('/repos/acme/time-data') && !options.method) return response(200, { id: 88, private: true, archived: false, disabled: false, default_branch: 'main', permissions: { push: true } });
      throw new Error('must not write to mismatched coordinates');
    },
  });
  await assert.rejects(
    () => client.putText('active/alice.json', 'Start: now\n', 'start'),
    error => error.code === 'repository_identity_changed',
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, undefined);
});

test('explicit missing user push permission emits choose-repository recovery code', async () => {
  const client = new GitHubClient({
    token: 'secret', owner: 'acme', repo: 'time-data',
    fetchImpl: async () => response(200, { id: 77, private: true, archived: false, disabled: false, default_branch: 'main', permissions: { push: false } }),
  });
  await assert.rejects(() => client.validateRepository(), error => error.code === 'user_write_required' && error.status === 403);
});

test('custom branch and canonical coordinates are revalidated before every mutation', async () => {
  const branchCalls = [];
  const custom = new GitHubClient({
    token: 'secret', owner: 'acme', repo: 'time-data', branch: 'release', expectedRepositoryId: 77, branchMode: 'custom',
    fetchImpl: async (url, options = {}) => {
      branchCalls.push({ url, options });
      if (url.endsWith('/repos/acme/time-data')) return response(200, { id: 77, name: 'time-data', full_name: 'acme/time-data', owner: { login: 'acme' }, private: true, archived: false, disabled: false, default_branch: 'main', permissions: { push: true } });
      if (url.endsWith('/branches/release')) return response(200, { name: 'release' });
      if (options.method === 'PUT') return response(200, { content: { sha: 'new' }, commit: { sha: 'commit' } });
      throw new Error(`Unexpected ${url}`);
    },
  });
  await custom.putText('active/alice.json', 'Start: now\n', 'start');
  assert.ok(branchCalls.some(call => call.url.endsWith('/branches/release')));
  assert.equal(branchCalls.at(-1).options.method, 'PUT');

  const renameCalls = [];
  const renamed = new GitHubClient({
    token: 'secret', owner: 'old-owner', repo: 'old-repo', branch: 'main', expectedRepositoryId: 77, branchMode: 'default',
    fetchImpl: async (url, options = {}) => {
      renameCalls.push({ url, options });
      return response(200, { id: 77, name: 'new-repo', full_name: 'new-owner/new-repo', owner: { login: 'new-owner' }, private: true, archived: false, disabled: false, default_branch: 'main', permissions: { push: true } });
    },
  });
  await assert.rejects(() => renamed.putText('active/alice.json', 'Start: now\n', 'start'), error => error.code === 'repository_coordinates_changed');
  assert.equal(renameCalls.length, 1);
  assert.equal(renameCalls[0].options.method, undefined);
});

const recoverySource = await readFile(new URL('../src/domain/recovery-actions.js', import.meta.url), 'utf8');
function recoveryFor(code) {
  const context = { globalThis: null, Set, Object, String };
  context.globalThis = context;
  vm.runInNewContext(recoverySource, context);
  return context.ClockoliRecovery.actionFor(code);
}

test('destination reachability fails closed on canonical coordinate drift before confirming file absence', async () => {
  const calls = [];
  const client = new GitHubClient({
    token: 'secret', owner: 'old', repo: 'time', branch: 'main', expectedRepositoryId: 77, branchMode: 'default',
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      return response(200, { id: 77, full_name: 'new/time', private: true, archived: false, disabled: false, default_branch: 'main', permissions: { push: true } });
    },
  });
  await assert.rejects(() => client.assertDestinationReachable(), error => error.code === 'repository_coordinates_changed');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, undefined);
});

test('runtime repository-state failures produce choose-repository recovery', async () => {
  const states = [
    [{ private: false, archived: false, disabled: false }, 'private_required'],
    [{ private: true, archived: true, disabled: false }, 'repository_unavailable'],
    [{ private: true, archived: false, disabled: true }, 'repository_unavailable'],
  ];
  for (const [state, code] of states) {
    const client = new GitHubClient({
      token: 'secret', owner: 'acme', repo: 'time', branch: 'main', expectedRepositoryId: 77, branchMode: 'default',
      fetchImpl: async () => response(200, { id: 77, full_name: 'acme/time', default_branch: 'main', permissions: { push: true }, ...state }),
    });
    await assert.rejects(() => client.putText('active/alice.json', 'Start: now\n', 'start'), error => {
      assert.equal(error.code, code);
      assert.equal(recoveryFor(error.code).kind, 'choose');
      assert.equal(recoveryFor(error.code).label, 'Choose another repository');
      return true;
    });
  }
});

test('documented branch-policy rejections map to choose while genuine ref races remain conflicts', async () => {
  const policy = new GitHubClient({
    token: 'secret', owner: 'acme', repo: 'time', branch: 'main', expectedRepositoryId: 77, branchMode: 'default',
    fetchImpl: async (url, options = {}) => {
      if (url.endsWith('/repos/acme/time') && !options.method) return response(200, { id: 77, full_name: 'acme/time', private: true, archived: false, disabled: false, default_branch: 'main', permissions: { push: true } });
      return response(422, { message: 'Protected branch update failed for refs/heads/main.' });
    },
  });
  for (const operation of [
    () => policy.putText('active/alice.json', 'Start: now\n', 'start'),
    () => policy.deleteFile('active/alice.json', 'clear', 'old-sha'),
  ]) {
    await assert.rejects(operation, error => {
      assert.equal(error.code, 'branch_policy_rejected');
      assert.equal(recoveryFor(error.code).kind, 'choose');
      assert.equal(recoveryFor(error.code).label, 'Choose another repository');
      return true;
    });
  }

  async function atomicClient(finalResponse) {
    return new GitHubClient({
      token: 'secret', owner: 'acme', repo: 'time', branch: 'main', expectedRepositoryId: 77, branchMode: 'default',
      fetchImpl: async (url, options = {}) => {
        if (url.endsWith('/repos/acme/time') && !options.method) return response(200, { id: 77, full_name: 'acme/time', private: true, archived: false, disabled: false, default_branch: 'main', permissions: { push: true } });
        if (url.endsWith('/git/ref/heads/main')) return response(200, { object: { sha: 'parent' } });
        if (url.endsWith('/git/commits/parent')) return response(200, { tree: { sha: 'tree' } });
        if (url.includes('/git/trees/tree?recursive=1')) return response(200, { tree: [{ path: 'a.txt', type: 'blob', sha: 'old' }] });
        if (url.endsWith('/git/blobs')) return response(201, { sha: 'blob-new' });
        if (url.endsWith('/git/trees')) return response(201, { sha: 'tree-new' });
        if (url.endsWith('/git/commits')) return response(201, { sha: 'commit-new' });
        if (url.endsWith('/git/refs/heads/main')) return finalResponse;
        throw new Error(`Unexpected ${url}`);
      },
    });
  }
  const changes = [{ path: 'a.txt', sha: 'old', text: 'new' }, { path: 'b.txt', sha: null, text: 'b' }];
  await assert.rejects(
    () => atomicClient(response(422, { message: 'Repository rule violations found.' })).then(client => client.updateTextsAtomic(changes, 'move')),
    error => error.code === 'branch_policy_rejected' && recoveryFor(error.code).kind === 'choose',
  );
  await assert.rejects(
    () => atomicClient(response(422, { message: 'Reference update failed due to a stale ref.' })).then(client => client.updateTextsAtomic(changes, 'move')),
    error => error instanceof GitHubConflictError,
  );
});

test('runtime mutations fail closed when stable repository identity has not been upgraded', async () => {
  const client = new GitHubClient({ token: 'secret', owner: 'acme', repo: 'time', branch: 'main', expectedRepositoryId: null, fetchImpl: async () => { throw new Error('must not reach GitHub'); } });
  await assert.rejects(() => client.putText('active/alice.json', 'Start: now\n', 'start'), error => error.code === 'repository_identity_unverified');
});


test('guarded first commit fails closed if a default branch appears after the configured ref check', async () => {
  const calls = [];
  let repositoryReads = 0;
  const empty = { id: 77, full_name: 'acme/clockoli-data', private: true, archived: false, disabled: false, default_branch: null, permissions: { push: true } };
  const initialized = { ...empty, default_branch: 'trunk' };
  const client = new GitHubClient({
    token: 'secret', owner: 'acme', repo: 'clockoli-data', branch: 'main', expectedRepositoryId: 77, branchMode: 'default',
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (!options.method && url.endsWith('/repos/acme/clockoli-data')) return response(200, repositoryReads++ === 0 ? empty : initialized);
      if (!options.method && url.endsWith('/branches/main')) return response(404, { message: 'Not Found' });
      throw new Error('must not write after the default branch changes');
    },
  });
  await assert.rejects(
    () => client.putInitialText('.clockoli/config.json', '{}\n', 'Initialize Clockoli storage'),
    error => error.code === 'repository_branch_changed',
  );
  assert.equal(calls.length, 3);
  assert.equal(calls.some(call => call.options.method === 'PUT'), false);
});

test('GitHub client can make the guarded first commit in an empty repository without naming a nonexistent branch', async () => {
  const calls = [];
  const repository = { id: 77, full_name: 'acme/clockoli-data', private: true, archived: false, disabled: false, default_branch: null, permissions: { push: true } };
  const client = new GitHubClient({
    token: 'secret', owner: 'acme', repo: 'clockoli-data', branch: 'main', expectedRepositoryId: 77, branchMode: 'default',
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (!options.method && url.endsWith('/repos/acme/clockoli-data')) return response(200, repository);
      if (!options.method && url.endsWith('/branches/main')) return response(404, { message: 'Not Found' });
      return response(201, { content: { sha: 'marker' }, commit: { sha: 'initial' } });
    },
  });
  await client.putInitialText('.clockoli/config.json', '{}\n', 'Initialize Clockoli storage');
  assert.equal(calls.length, 4);
  const payload = JSON.parse(calls[3].options.body);
  assert.equal(payload.branch, undefined);
  assert.equal(payload.message, 'Initialize Clockoli storage');
  assert.equal(calls[3].options.method, 'PUT');
});



test('GitHub client validates stable repository identity before adopting an existing user branch', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/repos/acme/time-data')) return response(200, { id: 77, full_name: 'acme/time-data', private: true, archived: false, disabled: false, permissions: { push: true } });
    if (url.endsWith('/branches/main')) return response(200, { name: 'main' });
    if (url.endsWith('/git/ref/heads/main')) return response(200, { object: { sha: 'a'.repeat(40) } });
    if (url.endsWith('/git/ref/heads/clockoli%2Fusers%2F123')) return response(200, { object: { sha: 'b'.repeat(40) } });
    throw new Error(`Unexpected ${url}`);
  };
  const client = new GitHubClient({ token: 'secret', owner: 'acme', repo: 'time-data', branch: 'main', branchMode: 'custom', expectedRepositoryId: 77, fetchImpl });
  assert.deepEqual(await client.ensureBranch('clockoli/users/123', 'main'), { branch: 'clockoli/users/123', created: false });
  assert.equal(calls[0].url.endsWith('/repos/acme/time-data'), true);
});

test('GitHub client creates an initialized commit before publishing a user branch ref', async () => {
  const parentSha = 'a'.repeat(40), treeSha = 'b'.repeat(40), nextTreeSha = 'c'.repeat(40), nextCommitSha = 'd'.repeat(40);
  const blobShas = ['e'.repeat(40), 'f'.repeat(40)], calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/repos/acme/time-data')) return response(200, { id: 77, full_name: 'acme/time-data', private: true, archived: false, disabled: false, permissions: { push: true } });
    if (url.endsWith('/branches/main')) return response(200, { name: 'main' });
    if (url.endsWith('/git/ref/heads/clockoli%2Fusers%2F123')) return response(404, { message: 'missing' });
    if (url.endsWith('/git/ref/heads/main')) return response(200, { object: { sha: parentSha } });
    if (url.endsWith(`/git/commits/${parentSha}`) && !options.method) return response(200, { tree: { sha: treeSha } });
    if (url.endsWith('/git/blobs') && options.method === 'POST') return response(201, { sha: blobShas.shift() });
    if (url.endsWith('/git/trees') && options.method === 'POST') return response(201, { sha: nextTreeSha });
    if (url.endsWith('/git/commits') && options.method === 'POST') return response(201, { sha: nextCommitSha });
    if (url.endsWith('/git/refs') && options.method === 'POST') return response(201, { ref: 'refs/heads/clockoli/users/123' });
    throw new Error(`Unexpected ${url}`);
  };
  const client = new GitHubClient({ token: 'secret', owner: 'acme', repo: 'time-data', branch: 'main', branchMode: 'custom', expectedRepositoryId: 77, fetchImpl });
  const changes = [
    { path: '.clockoli/user.json', sha: null, text: '{}\n' },
    { path: '.clockoli/tasks.json', sha: null, text: '{"version":1}\n' },
  ];
  const result = await client.ensureBranchWithTexts('clockoli/users/123', 'main', changes, 'Initialize Clockoli user storage branch');
  assert.equal(result.created, true);
  const refCall = calls.find(call => call.url.endsWith('/git/refs') && call.options.method === 'POST');
  assert.deepEqual(JSON.parse(refCall.options.body), { ref: 'refs/heads/clockoli/users/123', sha: nextCommitSha });
  assert.equal(calls.findIndex(call => call === refCall) > calls.findIndex(call => call.url.endsWith('/git/commits') && call.options.method === 'POST'), true);
});

test('initialized branch creation rejects malformed Git object SHAs before publishing a ref', async t => {
  for (const malformed of ['blob', 'tree', 'commit']) {
    await t.test(malformed, async () => {
      const parentSha = 'a'.repeat(40), sourceTreeSha = 'b'.repeat(40), calls = [];
      const fetchImpl = async (url, options = {}) => {
        calls.push({ url, options });
        if (url.endsWith('/repos/acme/time-data')) return response(200, { id: 77, full_name: 'acme/time-data', private: true, archived: false, disabled: false, permissions: { push: true } });
        if (url.endsWith('/branches/main')) return response(200, { name: 'main' });
        if (url.endsWith('/git/ref/heads/clockoli%2Fusers%2F123')) return response(404, { message: 'missing' });
        if (url.endsWith('/git/ref/heads/main')) return response(200, { object: { sha: parentSha } });
        if (url.endsWith(`/git/commits/${parentSha}`) && !options.method) return response(200, { tree: { sha: sourceTreeSha } });
        if (url.endsWith('/git/blobs') && options.method === 'POST') return response(201, { sha: malformed === 'blob' ? 'invalid' : 'c'.repeat(40) });
        if (url.endsWith('/git/trees') && options.method === 'POST') return response(201, { sha: malformed === 'tree' ? 'invalid' : 'd'.repeat(40) });
        if (url.endsWith('/git/commits') && options.method === 'POST') return response(201, { sha: malformed === 'commit' ? 'invalid' : 'e'.repeat(40) });
        throw new Error(`Unexpected ${url}`);
      };
      const client = new GitHubClient({ token: 'secret', owner: 'acme', repo: 'time-data', branch: 'main', branchMode: 'custom', expectedRepositoryId: 77, fetchImpl });
      await assert.rejects(
        client.ensureBranchWithTexts('clockoli/users/123', 'main', [{ path: '.clockoli/user.json', sha: null, text: '{}\n' }], 'Initialize'),
        /invalid .* reference/i,
      );
      assert.equal(calls.some(call => call.url.endsWith('/git/refs') && call.options.method === 'POST'), false);
    });
  }
});

test('GitHub client creates a user branch from a source ref and discovers bounded matching refs', async () => {
  const sha = 'f'.repeat(40), calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/git/ref/heads/clockoli%2Fusers%2F123')) return response(404, { message: 'missing' });
    if (url.endsWith('/git/ref/heads/main')) return response(200, { object: { sha } });
    if (url.endsWith('/git/refs') && options.method === 'POST') return response(201, { ref: 'refs/heads/clockoli/users/123', object: { sha } });
    if (url.includes('/git/matching-refs/heads/clockoli/users/')) return response(200, [
      { ref: 'refs/heads/clockoli/users/456' }, { ref: 'refs/heads/clockoli/users/123' },
    ]);
    throw new Error(`Unexpected ${url}`);
  };
  const client = new GitHubClient({ token: 'secret', owner: 'acme', repo: 'time-data', branch: 'main', fetchImpl });
  assert.deepEqual(await client.ensureBranch('clockoli/users/123', 'main'), { branch: 'clockoli/users/123', created: true });
  const payload = JSON.parse(calls.find(call => call.options.method === 'POST').options.body);
  assert.deepEqual(payload, { ref: 'refs/heads/clockoli/users/123', sha });
  assert.deepEqual(await client.listBranches('clockoli/users/'), ['clockoli/users/123', 'clockoli/users/456']);
  assert.equal(client.forBranch('clockoli/users/123').repositoryKey, 'acme/time-data@clockoli/users/123');
});

test('rate-limit errors expose an absolute retry time for status projections', async () => {
  for (const [headers, expected] of [
    [{ 'retry-after': '60' }, '2026-09-05T10:01:00.000Z'],
    [{ 'x-ratelimit-reset': String(Date.parse('2026-09-05T10:42:00Z') / 1000) }, '2026-09-05T10:42:00.000Z'],
  ]) {
    const client = new GitHubClient({ token: 'test', now: () => new Date('2026-09-05T10:00:00Z'), fetchImpl: async () => response(429, {}, headers) });
    await assert.rejects(() => client.request('/user'), error => error.code === 'rate_limit' && error.retryAt === expected);
  }
});
