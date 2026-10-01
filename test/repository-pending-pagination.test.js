import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubClient } from '../src/api/github-client.js';

function response(body) {
  return { ok: true, status: 200, headers: new Headers(), json: async () => body };
}

test('email-only invitation pages do not invent account overflow and reach later account invitees', async () => {
  const pages = [];
  const client = new GitHubClient({ token: 'synthetic', owner: 'acme', repo: 'time-data', fetchImpl: async url => {
    const page = Number(new URL(url).searchParams.get('page') || 1);
    pages.push(page);
    return response(page === 1 ? Array.from({ length: 100 }, (_, index) => ({ id: index + 1, invitee: null }))
      : [{ id: 101, invitee: { id: 21, login: 'Alice', avatar_url: null } }]);
  } });
  assert.deepEqual(await client.listRepositoryPendingInvitations(), {
    users: [{ id: 21, login: 'Alice', avatarUrl: null }], hasMore: false,
  });
  assert.deepEqual(pages, [1, 2]);
});

test('a full bounded scan of email-only invitations reports uncertainty rather than more account avatars', async () => {
  const pages = [];
  const client = new GitHubClient({ token: 'synthetic', owner: 'acme', repo: 'time-data', fetchImpl: async url => {
    const page = Number(new URL(url).searchParams.get('page') || 1);
    pages.push(page);
    return response(Array.from({ length: 100 }, (_, index) => ({ id: (page - 1) * 100 + index + 1, invitee: null })));
  } });
  assert.deepEqual(await client.listRepositoryPendingInvitations(), { users: [], hasMore: false, incomplete: true });
  assert.deepEqual(pages, [1, 2, 3, 4, 5]);
});
