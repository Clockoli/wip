import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubClient } from '../src/api/github-client.js';
import { ClockifyGitHubRequestCounter } from '../src/background/clockify-github-request-counter.js';

function fixture() {
  const values = new Map(), messages = [];
  const storage = {
    get: async key => values.get(key),
    set: async (key, value) => { values.set(key, structuredClone(value)); },
  };
  return { storage, messages, create: () => new ClockifyGitHubRequestCounter({ storage, log: message => messages.push(message) }) };
}

test('mapping counter starts at zero and counts outbound collaborator and live search calls, including failures', async () => {
  const { create, messages } = fixture(), counter = create(), urls = [];
  await counter.start();
  const client = new GitHubClient({ token: 'synthetic', owner: 'acme', repo: 'time',
    fetchImpl: counter.wrapFetch(async url => {
      urls.push(url);
      return new Response(JSON.stringify({ message: 'rate limited' }), { status: 429 });
    }),
  });
  await assert.rejects(client.listRepositoryCollaborators());
  await assert.rejects(client.request('/search/users?q=ad'));
  assert.equal(urls.length, 2);
  assert.deepEqual(messages, [
    '[Clockify mapping GitHub requests] total=0 search=0 other=0 (started)',
    '[Clockify mapping GitHub requests] total=1 search=0 other=1',
    '[Clockify mapping GitHub requests] response status=429 resource=unknown limit=unknown remaining=unknown resetAt=unknown retryAfterSeconds=unknown',
    '[Clockify mapping GitHub requests] total=2 search=1 other=1',
    '[Clockify mapping GitHub requests] response status=429 resource=unknown limit=unknown remaining=unknown resetAt=unknown retryAfterSeconds=unknown',
  ]);
  assert.equal(messages.join(' ').includes('synthetic'), false);
  assert.equal(messages.join(' ').includes('ad'), false);
});

test('mapping counter survives worker recreation, handles parallel requests, counts a 401 retry and resets on reopen', async () => {
  const { create, messages } = fixture();
  const first = create();
  await first.start();
  await Promise.all(Array.from({ length: 6 }, (_, index) => first.wrapFetch(async () => index)(`https://api.github.com/users/user${index}`)));
  const second = create();
  const client = new GitHubClient({
    credentialProvider: { getAccessToken: async () => 'synthetic' },
    fetchImpl: second.wrapFetch(async () => new Response('{}', { status: 401 })),
  });
  await assert.rejects(client.getAuthenticatedUser());
  assert.match(messages.at(-1), /total=8 search=0 other=8/);
  await second.start();
  await second.wrapFetch(async () => new Response('{}', { status: 200 }))('https://api.github.com/search/users?q=ada');
  assert.deepEqual(messages.slice(-2), [
    '[Clockify mapping GitHub requests] total=0 search=0 other=0 (started)',
    '[Clockify mapping GitHub requests] total=1 search=1 other=0',
  ]);
});

test('mapping counter ignores requests when no preview has opened', async () => {
  const { create, messages } = fixture();
  await create().wrapFetch(async () => new Response('{}', { status: 200 }))('https://api.github.com/user');
  assert.deepEqual(messages, []);
});

test('mapping counter counts only the named GraphQL user search as search, not other GraphQL work', async () => {
  const { create, messages } = fixture(), counter = create();
  await counter.start();
  const fetch = counter.wrapFetch(async () => new Response('{}', { status: 200 }));
  await fetch('https://api.github.com/graphql', { method: 'POST', body: JSON.stringify({ query: 'query ClockifyUserSearch($query: String!) { search(query: $query, type: USER, first: 10) { nodes { __typename } } }', variables: { query: 'private-login in:login' } }) });
  await fetch('https://api.github.com/graphql', { method: 'POST', body: JSON.stringify({ query: 'query TrackedTasks { repository(owner: "acme", name: "time") { id } }' }) });
  assert.deepEqual(messages.slice(-2), [
    '[Clockify mapping GitHub requests] total=1 search=1 other=0',
    '[Clockify mapping GitHub requests] total=2 search=1 other=1',
  ]);
  assert.doesNotMatch(messages.join(' '), /private-login|TrackedTasks/);
});

test('failed search logs the response rate-limit bucket and allowance without request or response secrets', async () => {
  const { create, messages } = fixture(), counter = create();
  await counter.start();
  const client = new GitHubClient({ token: 'synthetic-secret',
    fetchImpl: counter.wrapFetch(async () => new Response(JSON.stringify({ message: 'private-provider-detail' }), {
      status: 403,
      headers: {
        'x-ratelimit-resource': 'search', 'x-ratelimit-limit': '30',
        'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1790872309',
      },
    })),
  });
  await assert.rejects(client.request('/search/users?q=private-login'));
  assert.match(messages.at(-1), /^\[Clockify mapping GitHub requests\] response status=403 resource=search limit=30 remaining=0 resetAt=\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.000Z retryAfterSeconds=unknown$/);
  assert.equal(messages.at(-2), '[Clockify mapping GitHub requests] total=1 search=1 other=0');
  assert.doesNotMatch(messages.join(' '), /private-login|private-provider-detail|synthetic-secret/);
});

test('throttling with remaining allowance logs retry-after without guessing the exhausted bucket', async () => {
  const { create, messages } = fixture(), counter = create();
  await counter.start();
  await counter.wrapFetch(async () => new Response('{}', {
    status: 429,
    headers: { 'x-ratelimit-resource': 'search', 'x-ratelimit-limit': '30', 'x-ratelimit-remaining': '12', 'retry-after': '60' },
  }))('https://api.github.com/search/users?q=private');
  assert.equal(messages.at(-1), '[Clockify mapping GitHub requests] response status=429 resource=search limit=30 remaining=12 resetAt=unknown retryAfterSeconds=60');
});

test('rate-limit diagnostics reject untrusted or malformed header values', async () => {
  const { create, messages } = fixture(), counter = create();
  await counter.start();
  await counter.wrapFetch(async () => new Response('{}', {
    status: 403,
    headers: {
      'x-ratelimit-resource': 'Bearer private-secret', 'x-ratelimit-limit': '30 private-secret',
      'x-ratelimit-remaining': '-1', 'x-ratelimit-reset': 'not-a-date', 'retry-after': 'private-secret',
    },
  }))('https://api.github.com/search/users?q=private-login');
  assert.equal(messages.at(-1), '[Clockify mapping GitHub requests] response status=403 resource=unknown limit=unknown remaining=unknown resetAt=unknown retryAfterSeconds=unknown');
  assert.doesNotMatch(messages.join(' '), /private-secret|private-login/);
});
