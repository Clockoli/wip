import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubClient } from '../src/api/github-client.js';
import { RepositoryInvitationService } from '../src/services/repository-invitations.js';

function response(status, body = null) {
  return { ok: status >= 200 && status < 300, status, headers: new Headers(), json: async () => body };
}

function fixture({ appAdmin = 'write', userAdmin = true, member = false, memberPermission = 'write', pending = false, inviteStatus = 201, removeStatus = 204, repoId = 17, fullName = 'acme/time', profileId = 42, profileName = 'Bob Example', avatarUrl = 'https://avatars.githubusercontent.com/u/42?v=4', graphqlBody = { data: { search: { nodes: [{ __typename: 'User', databaseId: profileId, login: 'Bob', name: profileName, avatarUrl }, { __typename: 'Organization' }] } } } } = {}) {
  const requests = [];
  const github = new GitHubClient({ token: 'test', owner: 'acme', repo: 'time', expectedRepositoryId: 17, fetchImpl: async (url, options) => {
    const path = new URL(url).pathname;
    requests.push({ path, method: options.method || 'GET', body: options.body });
    if (path === '/graphql') return response(200, graphqlBody);
    if (path === '/user') return response(200, { id: 1, login: 'Admin' });
    if (path.toLowerCase() === '/users/bob') return response(200, { id: profileId, login: 'Bob', name: profileName, avatar_url: avatarUrl });
    if (path === '/repos/acme/time') return response(200, { id: repoId, full_name: fullName, private: true, archived: false, disabled: false, permissions: { push: true, admin: userAdmin } });
    if (path === '/user/installations') return response(200, { installations: [{ id: 9, permissions: { contents: 'write', administration: appAdmin } }] });
    if (path === '/repos/acme/time/collaborators/Bob/permission') return response(member ? 200 : 404, member ? { permission: memberPermission, user: { id: 42, login: 'Bob' } } : {});
    if (path === '/repos/acme/time/invitations') return response(200, pending ? [{ id: 5, invitee: { id: 42, login: 'Bob' } }] : []);
    if (path === '/repos/acme/time/collaborators/Bob') return options.method === 'DELETE' ? response(removeStatus) : response(inviteStatus, inviteStatus === 201 ? { id: 11, invitee: { id: 42, login: 'Bob' } } : null);
    if (path === '/repos/acme/time/invitations/5' && options.method === 'DELETE') return response(removeStatus);
    throw new Error(`Unexpected path ${path}`);
  } });
  return { github, requests, service: new RepositoryInvitationService({ github, installationId: 9 }) };
}

test('repository invitations require both App and actor admin rights before mutations', async () => {
  for (const scenario of [{ appAdmin: 'read' }, { userAdmin: false }]) {
    const { service, requests } = fixture(scenario);
    await assert.rejects(service.invite('bob', 42), /administration|admin/i);
    assert.equal(requests.some(request => request.method === 'PUT'), false);
  }
});

test('repository invitation checks existing and pending access without granting twice', async () => {
  for (const [scenario, status] of [[{ member: true }, 'already_has_access'], [{ pending: true }, 'already_invited']]) {
    const { service, requests } = fixture(scenario);
    assert.equal((await service.invite('bob', 42)).status, status);
    assert.equal(requests.some(request => request.method === 'PUT'), false);
  }
});

test('read-only collaborators are reported without silently escalating access', async () => {
  const { service, requests } = fixture({ member: true, memberPermission: 'read' });
  assert.equal((await service.invite('bob', 42)).status, 'read_only_access');
  assert.equal(requests.some(request => request.method === 'PUT'), false);
});

test('GitHub permission none checks pending invitations before requesting write access', async () => {
  const { service, requests } = fixture({ member: true, memberPermission: 'none', pending: true });
  assert.deepEqual(await service.invite('bob', 42), { status: 'already_invited', login: 'Bob' });
  assert.equal(requests.some(request => request.method === 'PUT'), false);
});

test('GitHub permission none allows an invitation only after identity and access checks', async () => {
  const { service, requests } = fixture({ member: true, memberPermission: 'none' });
  assert.deepEqual(await service.invite('bob', 42), { status: 'invited', login: 'Bob' });
  assert.equal(requests.filter(request => request.method === 'PUT').length, 1);
});

test('unknown collaborator permission still fails closed before inviting', async () => {
  const { service, requests } = fixture({ member: true, memberPermission: 'unknown' });
  await assert.rejects(service.invite('bob', 42), /unverified collaborator permission/);
  assert.equal(requests.some(request => request.method === 'PUT'), false);
});

test('repository invitation sends only the verified GitHub user with write permission', async () => {
  const { service, requests } = fixture();
  assert.deepEqual(await service.invite('bob', 42), { status: 'invited', login: 'Bob' });
  const write = requests.find(request => request.method === 'PUT');
  assert.equal(write.path, '/repos/acme/time/collaborators/Bob');
  assert.deepEqual(JSON.parse(write.body), { permission: 'push' });
});

test('repository invitation rejects invalid user and treats GitHub 204 as existing access', async () => {
  const { service, requests } = fixture({ inviteStatus: 204 });
  await assert.rejects(service.invite('../wrong', 42), /Invalid user/);
  assert.equal(requests.length, 0);
  assert.deepEqual(await service.invite('bob', 42), { status: 'already_has_access', login: 'Bob' });
});

test('changed repository identity aborts before checking a user or sending an invitation', async () => {
  const { service, requests } = fixture({ repoId: 18 });
  await assert.rejects(service.invite('bob', 42), /identity changed/);
  assert.equal(requests.some(request => request.path.includes('/collaborators/')), false);
});

test('renamed repository coordinates abort before sending an invitation', async () => {
  const { service, requests } = fixture({ fullName: 'other/time' });
  await assert.rejects(service.invite('bob', 42), /coordinates changed/);
  assert.equal(requests.some(request => request.method === 'PUT'), false);
});

test('repository coordinates are rechecked immediately before sending an invitation', async () => {
  const { github, service, requests } = fixture();
  const validateRepository = github.validateRepository.bind(github);
  let checks = 0;
  github.validateRepository = async () => {
    const repository = await validateRepository();
    return ++checks === 1 ? repository : { ...repository, full_name: 'other/time' };
  };
  await assert.rejects(service.invite('bob', 42), /coordinates changed/);
  assert.equal(requests.some(request => request.method === 'PUT'), false);
});

test('user search offers bounded suggestions and does not mutate repository access', async () => {
  const { service, requests } = fixture();
  assert.deepEqual(await service.search('Bo'), [{ id: 42, login: 'Bob', name: 'Bob Example', avatarUrl: 'https://avatars.githubusercontent.com/u/42?v=4' }]);
  assert.deepEqual(await service.search('..'), []);
  assert.deepEqual(requests.map(request => request.path), ['/graphql']);
  assert.equal(requests[0].method, 'POST');
  const { query, variables } = JSON.parse(requests[0].body);
  assert.match(query, /search\(query: \$query, type: USER, first: 10\)/);
  assert.match(query, /\.\.\. on User \{[^}]*databaseId[^}]*login[^}]*name[^}]*avatarUrl/);
  assert.deepEqual(variables, { query: 'Bo in:login' });
});

test('migration search returns GitHub identities with one request and no profile hydration', async () => {
  const { service, requests } = fixture();
  assert.deepEqual(await service.search('Bo', { profiles: false }), [
    { id: 42, login: 'Bob', name: null, avatarUrl: null },
  ]);
  assert.deepEqual(requests.map(request => request.path), ['/graphql']);
  assert.equal(requests[0].method, 'POST');
  const { query, variables } = JSON.parse(requests[0].body);
  assert.match(query, /search\(query: \$query, type: USER, first: 10\)/);
  assert.match(query, /\.\.\. on User \{[^}]*databaseId[^}]*login/);
  assert.deepEqual(variables, { query: 'Bo in:login' });
});

test('migration GraphQL search fails closed on partial errors, missing identities and malformed connections', async () => {
  for (const graphqlBody of [
    { data: { search: { nodes: [{ __typename: 'User', databaseId: 42, login: 'Bob' }] } }, errors: [{ message: 'partial failure' }] },
    { data: { search: { nodes: [{ __typename: 'User', databaseId: null, login: 'Bob' }] } } },
    { data: { search: { nodes: [{ __typename: 'User', databaseId: 42, login: 'bad/login' }] } } },
    { data: { search: { nodes: Array.from({ length: 11 }, () => ({ __typename: 'User', databaseId: 42, login: 'Bob' })) } } },
    { data: { search: null } },
  ]) {
    const { service, requests } = fixture({ graphqlBody });
    await assert.rejects(service.search('Bo', { profiles: false }), /invalid|failed|limit/i);
    assert.deepEqual(requests.map(request => request.path), ['/graphql']);
  }
});

test('user search drops unsafe avatar URLs while keeping login and public name', async () => {
  const { service } = fixture({ avatarUrl: 'https://example.com/track?token=bad' });
  assert.deepEqual(await service.search('Bo'), [{ id: 42, login: 'Bob', name: 'Bob Example', avatarUrl: null }]);
});

test('user search keeps an account selectable when its public name and avatar are absent', async () => {
  const { service } = fixture({ profileName: null, avatarUrl: null });
  assert.deepEqual(await service.search('Bo'), [{ id: 42, login: 'Bob', name: null, avatarUrl: null }]);
});

test('user search rejects a missing immutable GitHub ID', async () => {
  const { service } = fixture({ profileId: null });
  await assert.rejects(service.search('Bo'), /invalid/i);
});

test('invitation user search rejects partial GraphQL errors without trusting returned identities', async () => {
  const { service, requests } = fixture({ graphqlBody: { data: { search: { nodes: [{ __typename: 'User', databaseId: 42, login: 'Bob' }] } }, errors: [{ message: 'partial failure' }] } });
  await assert.rejects(service.search('Bo'), /failed/i);
  assert.deepEqual(requests.map(request => request.path), ['/graphql']);
});

test('selected user ID must still match at invitation time', async () => {
  const { service, requests } = fixture();
  await assert.rejects(service.invite('bob', 99), /identity changed/i);
  assert.equal(requests.some(request => request.method === 'PUT'), false);
});

test('removing a verified collaborator revokes only that repository user after admin checks', async () => {
  const { service, requests } = fixture({ member: true });
  assert.deepEqual(await service.remove('bob', 42, 'collaborator'), { status: 'removed', login: 'Bob' });
  assert.deepEqual(requests.filter(request => request.method === 'DELETE').map(request => request.path), ['/repos/acme/time/collaborators/Bob']);
  assert.equal(requests.filter(request => request.path === '/repos/acme/time').length, 2);
});

test('removing a pending invitee cancels only the matching verified invitation', async () => {
  const { service, requests } = fixture({ pending: true });
  assert.deepEqual(await service.remove('bob', 42, 'pending'), { status: 'cancelled', login: 'Bob' });
  assert.deepEqual(requests.filter(request => request.method === 'DELETE').map(request => request.path), ['/repos/acme/time/invitations/5']);
});

test('removal rejects stale IDs, unexpected membership and wrong pending state without a write', async () => {
  for (const [options, login, id, kind] of [
    [{ member: true }, 'bob', 99, 'collaborator'],
    [{ member: true, memberPermission: 'none' }, 'bob', 42, 'collaborator'],
    [{}, 'bob', 42, 'collaborator'],
    [{ pending: true }, 'bob', 42, 'collaborator'],
    [{ member: true }, 'bob', 42, 'pending'],
    [{ pending: true }, 'bob', 99, 'pending'],
    [{ member: true }, '../wrong', 42, 'collaborator'],
    [{ member: true }, 'bob', 42, 'invalid'],
  ]) {
    const { service, requests } = fixture(options);
    await assert.rejects(service.remove(login, id, kind));
    assert.equal(requests.some(request => request.method === 'DELETE'), false);
  }
});

test('removal rejects changed repo identity, missing admin rights and self-removal before DELETE', async () => {
  for (const options of [{ repoId: 18 }, { fullName: 'wrong/time' }, { appAdmin: 'read' }, { userAdmin: false }, { profileId: 1 }]) {
    const { service, requests } = fixture({ member: true, ...options });
    await assert.rejects(service.remove('bob', options.profileId ?? 42, 'collaborator'));
    assert.equal(requests.some(request => request.method === 'DELETE'), false);
  }
});

test('removal does not report success when GitHub does not confirm revocation', async () => {
  const { service } = fixture({ member: true, removeStatus: 202 });
  await assert.rejects(service.remove('bob', 42, 'collaborator'), /confirm|verify/i);
});

test('removal rechecks repository identity immediately before the DELETE, including after worker restart', async () => {
  const { github, requests } = fixture({ member: true });
  const original = github.validateRepository.bind(github);
  let checks = 0;
  github.validateRepository = async () => {
    const repository = await original();
    return ++checks === 1 ? repository : { ...repository, full_name: 'other/time' };
  };
  await assert.rejects(new RepositoryInvitationService({ github, installationId: 9 }).remove('bob', 42, 'collaborator'), /coordinates changed/i);
  assert.equal(requests.some(request => request.method === 'DELETE'), false);
  const restarted = fixture({ member: true });
  assert.deepEqual(await new RepositoryInvitationService({ github: restarted.github, installationId: 9 }).remove('bob', 42, 'collaborator'),
    { status: 'removed', login: 'Bob' });
});
