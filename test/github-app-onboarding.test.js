import test from 'node:test';
import assert from 'node:assert/strict';
import { InstallationDiscoveryService, RepositoryInitializer, RepositoryInspectionService } from '../src/services/github-app-onboarding.js';

function notFound() { const error = new Error('not found'); error.status = 404; error.code = 'not_found'; return error; }
function conflict() { const error = new Error('conflict'); error.status = 409; error.code = 'conflict'; return error; }

function activeJson(user = 'alice') {
  return `${JSON.stringify({
    schema_version: 1, id: '01K2ABCDEF0123456789ABCDEF', record_type: 'work',
    actor: { kind: 'human', id: 'github:123', name: user },
    work_item: { kind: 'github_issue', id: 'url:https://github.com/acme/app/issues/1', url: 'https://github.com/acme/app/issues/1', title: '' },
    activity: { state: 'running', started_at: '2026-08-20T00:00:00.000Z', ended_at: null, local_date: '2026-08-20', timezone: 'UTC' },
    producer: { kind: 'browser_extension', name: 'clockoli-chrome', version: '0.1.29' },
    description: '', metadata: {}, metrics: {}, created_at: '2026-08-20T00:00:00.000Z', updated_at: '2026-08-20T00:00:00.000Z',
  }, null, 2)}\n`;
}

function installation(id, overrides = {}) {
  return {
    id, account: { id: id * 10, login: `owner-${id}`, type: id === 1 ? 'User' : 'Organization' },
    repository_selection: 'selected', permissions: { contents: 'write', metadata: 'read' },
    html_url: `https://github.com/settings/installations/${id}`,
    ...overrides,
  };
}
function repository(id, overrides = {}) {
  return {
    id, name: `repo-${id}`, full_name: `owner/repo-${id}`, private: true,
    archived: false, disabled: false, default_branch: 'main',
    owner: { id: 10, login: 'owner', type: 'User' }, permissions: { push: true },
    ...overrides,
  };
}

test('installation discovery paginates both endpoints and returns only effective private write candidates', async () => {
  const calls = [];
  const github = { request: async path => {
    calls.push(path);
    if (path === '/user/installations?per_page=2&page=1') return { total_count: 3, installations: [installation(1), installation(2, { permissions: { contents: 'read' } })] };
    if (path === '/user/installations?per_page=2&page=2') return { total_count: 3, installations: [installation(3)] };
    if (path === '/user/installations/1/repositories?per_page=2&page=1') return { total_count: 3, repositories: [repository(11), repository(12, { private: false })] };
    if (path === '/user/installations/1/repositories?per_page=2&page=2') return { total_count: 3, repositories: [repository(13, { permissions: { push: false } })] };
    if (path === '/user/installations/2/repositories?per_page=2&page=1') return { total_count: 1, repositories: [repository(21)] };
    if (path === '/user/installations/3/repositories?per_page=2&page=1') return { total_count: 2, repositories: [repository(31, { archived: true }), repository(32, { disabled: true })] };
    throw new Error(`Unexpected ${path}`);
  } };
  const result = await new InstallationDiscoveryService({ github, perPage: 2, maxPages: 10, maxRepositories: 20 }).discover();
  assert.equal(result.installations.length, 3);
  assert.deepEqual(result.candidates.map(item => item.repoId), [11]);
  assert.deepEqual(result.repositories.map(item => [item.repoId, item.eligible, item.reasons]), [
    [11, true, []],
    [12, false, ['private_required']],
    [13, false, ['user_write_required']],
    [21, false, ['app_contents_write_required']],
    [31, false, ['archived']],
    [32, false, ['disabled']],
  ]);
  assert.equal(calls.length, 6);
});

test('installation discovery fails closed before exceeding its page or result budget', async () => {
  let calls = 0;
  const github = { request: async path => {
    calls += 1;
    if (path.startsWith('/user/installations?')) return { total_count: 1, installations: [installation(1)] };
    return { total_count: 3, repositories: [repository(1), repository(2)] };
  } };
  await assert.rejects(
    () => new InstallationDiscoveryService({ github, perPage: 2, maxPages: 1, maxRepositories: 2 }).discover(),
    error => error.code === 'repository_discovery_budget',
  );
  assert.equal(calls, 2);
});

test('repository initialization creates a versioned marker and reports a real write', async () => {
  const writes = [];
  const github = {
    validateRepository: async () => ({ id: 77, private: true, archived: false, disabled: false, default_branch: 'main', permissions: { push: true } }),
    validateBranch: async () => ({ name: 'main' }),
    getText: async () => { throw notFound(); },
    listRepositoryFiles: async () => ['README.md'],
    putText: async (path, text, message, sha) => { writes.push({ path, text, message, sha }); return { sha: 'marker-sha' }; },
  };
  const result = await new RepositoryInitializer({ github, now: () => new Date('2026-08-20T00:00:00Z') }).initialize({ id: 123, login: 'alice' });
  assert.equal(result.status, 'write_verified');
  assert.equal(result.storageLogin, 'alice');
  assert.equal(result.repositoryFormatVersion, 1);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, '.clockoli/config.json');
  assert.equal(writes[0].sha, undefined);
  assert.deepEqual(JSON.parse(writes[0].text), {
    repositoryFormatVersion: 1,
    createdAt: '2026-08-20T00:00:00.000Z',
    createdBy: { id: 123, login: 'alice' },
    users: { '123': 'alice' },
  });
});

test('repository initialization accepts an existing compatible user mapping without a meaningless commit', async () => {
  let writes = 0;
  const marker = {
    repositoryFormatVersion: 1, createdAt: '2026-08-01T00:00:00.000Z',
    createdBy: { id: 1, login: 'owner' }, users: { '1': 'owner', '123': 'original-login' },
  };
  const github = {
    validateRepository: async () => ({ id: 77, private: true, archived: false, disabled: false, default_branch: 'main', permissions: { push: true } }),
    validateBranch: async () => ({ name: 'main' }),
    getText: async () => ({ path: '.clockoli/config.json', sha: 'marker-sha', text: `${JSON.stringify(marker)}\n` }),
    putText: async () => { writes += 1; },
  };
  const result = await new RepositoryInitializer({ github }).initialize({ id: 123, login: 'renamed-login' });
  assert.deepEqual(result, { status: 'access_checked', storageLogin: 'original-login', repositoryFormatVersion: 1, repositoryId: 77, branch: 'main' });
  assert.equal(writes, 0);
});

test('repository initialization merges a new stable user mapping with SHA protection', async () => {
  const writes = [];
  const marker = {
    repositoryFormatVersion: 1, createdAt: '2026-08-01T00:00:00.000Z',
    createdBy: { id: 1, login: 'owner' }, users: { '1': 'owner' },
  };
  const github = {
    validateRepository: async () => ({ id: 77, private: true, archived: false, disabled: false, default_branch: 'main', permissions: { push: true } }),
    validateBranch: async () => ({ name: 'main' }),
    getText: async () => ({ path: '.clockoli/config.json', sha: 'marker-sha', text: `${JSON.stringify(marker)}\n` }),
    putText: async (path, text, message, sha) => { writes.push({ path, text, message, sha }); return { sha: 'new-sha' }; },
  };
  const result = await new RepositoryInitializer({ github }).initialize({ id: 123, login: 'alice' });
  assert.equal(result.status, 'write_verified');
  assert.equal(writes[0].sha, 'marker-sha');
  assert.deepEqual(JSON.parse(writes[0].text).users, { '1': 'owner', '123': 'alice' });
});

test('repository initialization resolves a concurrent create by validating the winning marker', async () => {
  const winner = {
    repositoryFormatVersion: 1, createdAt: '2026-08-20T00:00:00.000Z',
    createdBy: { id: 123, login: 'alice' }, users: { '123': 'alice' },
  };
  let reads = 0, conflicted = false;
  const github = {
    validateRepository: async () => ({ id: 77, private: true, archived: false, disabled: false, default_branch: 'main', permissions: { push: true } }),
    validateBranch: async () => ({ name: 'main' }),
    listRepositoryFiles: async () => ['README.md'],
    getText: async () => { reads += 1; if (!conflicted) throw notFound(); return { sha: 'winner', text: JSON.stringify(winner) }; },
    putText: async () => { conflicted = true; throw conflict(); },
  };
  const result = await new RepositoryInitializer({ github }).initialize({ id: 123, login: 'alice' });
  assert.equal(result.status, 'access_checked');
  assert.equal(result.storageLogin, 'alice');
  assert.equal(reads, 3);
});

test('repository initialization rejects incompatible markers and occupied storage paths', async () => {
  const base = {
    validateRepository: async () => ({ id: 77, private: true, archived: false, disabled: false, default_branch: 'main', permissions: { push: true } }),
    validateBranch: async () => ({ name: 'main' }),
  };
  await assert.rejects(() => new RepositoryInitializer({ github: {
    ...base, getText: async () => ({ sha: 'x', text: JSON.stringify({ repositoryFormatVersion: 999, users: {} }) }),
  } }).initialize({ id: 123, login: 'alice' }), error => error.code === 'incompatible_storage_format');
  await assert.rejects(() => new RepositoryInitializer({ github: {
    ...base, getText: async () => { throw notFound(); }, listRepositoryFiles: async () => ['active/not a login.txt'],
  } }).initialize({ id: 123, login: 'alice' }), error => error.code === 'incompatible_storage_format');
});


test('repository discovery and validation fail closed when user push permission is absent', async () => {
  const github = {
    async request(path) {
      if (path.startsWith('/user/installations?')) return { total_count: 1, installations: [{ id: 8, account: { id: 80, login: 'acme' }, permissions: { contents: 'write' } }] };
      return { total_count: 1, repositories: [{ id: 9, name: 'time', full_name: 'acme/time', private: true, archived: false, disabled: false, default_branch: 'main', owner: { id: 80, login: 'acme' } }] };
    },
  };
  const result = await new InstallationDiscoveryService({ github }).discover();
  assert.equal(result.candidates.length, 0);
  assert.deepEqual(result.repositories[0].reasons, ['user_write_required']);
});

test('pre-marker canonical files are parsed strictly before initialization', async () => {
  const github = {
    async validateRepository() { return repository(); },
    async validateBranch() {},
    async getText(path) {
      if (path === '.clockoli/config.json' || path === '.clockoli/config.json') throw notFound();
      return { text: 'not a valid Clockoli record\n', sha: 'bad' };
    },
    async listRepositoryFiles() { return ['active/alice.json']; },
    async putText() { throw new Error('must not write'); },
  };
  await assert.rejects(() => new RepositoryInitializer({ github }).initialize({ id: 123, login: 'alice' }), error => error.code === 'incompatible_storage_format' && /active\/alice\.json/.test(error.message));
});

test('empty repositories and branch rules have actionable recovery classifications', async () => {
  const empty = { async validateRepository() { return repository(); }, async validateBranch() { throw notFound(); }, async putInitialText() { throw notFound(); } };
  await assert.rejects(() => new RepositoryInitializer({ github: empty }).initialize({ id: 123, login: 'alice' }), error => error.code === 'empty_repository');
  const protectedBranch = {
    async validateRepository() { return repository(); }, async validateBranch() {},
    async getText() { throw notFound(); }, async listRepositoryFiles() { return []; },
    async putText() { const error = new Error('ruleset'); error.status = 422; error.code = 'validation'; throw error; },
  };
  await assert.rejects(() => new RepositoryInitializer({ github: protectedBranch }).initialize({ id: 123, login: 'alice' }), error => error.code === 'branch_policy_rejected');
});


test('installation discovery enforces aggregate installation and repository-page budgets', async () => {
  const installations = [installation(1), installation(2)];
  const installationBudgetClient = { requests: [], request: async function (path) { this.requests.push(path);
    if (path.startsWith('/user/installations?')) return { installations };
    throw new Error(`unexpected ${path}`);
  } };
  const installationBudget = new InstallationDiscoveryService({ github: installationBudgetClient, maxInstallations: 1 });
  await assert.rejects(() => installationBudget.discover(), error => error.code === 'repository_discovery_budget');
  assert.equal(installationBudgetClient.requests.length, 1);

  const pageBudgetClient = { requests: [], request: async function (path) { this.requests.push(path);
    if (path.startsWith('/user/installations?')) return { installations };
    if (path.startsWith('/user/installations/1/repositories?')) return { total_count: 0, repositories: [] };
    if (path.startsWith('/user/installations/2/repositories?')) throw new Error('aggregate budget must stop before this request');
    throw new Error(`unexpected ${path}`);
  } };
  const pageBudget = new InstallationDiscoveryService({ github: pageBudgetClient, maxRepositoryPages: 1 });
  await assert.rejects(() => pageBudget.discover(), error => error.code === 'repository_discovery_budget');
  assert.equal(pageBudgetClient.requests.length, 2);
});

test('installation discovery enforces one aggregate repository-row budget', async () => {
  const client = { requests: [], request: async function (path) { this.requests.push(path);
    if (path.startsWith('/user/installations?')) return { installations: [installation(1), installation(2)] };
    if (path.startsWith('/user/installations/1/repositories?')) return { repositories: [repository(101)] };
    if (path.startsWith('/user/installations/2/repositories?')) return { repositories: [repository(102)] };
    throw new Error(`unexpected ${path}`);
  } };
  const service = new InstallationDiscoveryService({ github: client, maxRepositories: 1 });
  await assert.rejects(() => service.discover(), error => error.code === 'repository_discovery_budget');
});


test('repository initialization merges a different concurrent create winner after GitHub 422', async () => {
  const winner = {
    repositoryFormatVersion: 1, createdAt: '2026-08-20T00:00:00.000Z',
    createdBy: { id: 1, login: 'owner' }, users: { '1': 'owner' },
  };
  let reads = 0, winnerAvailable = false;
  const writes = [];
  const github = {
    validateRepository: async () => ({ id: 77, private: true, archived: false, disabled: false, default_branch: 'main', permissions: { push: true } }),
    validateBranch: async () => ({ name: 'main' }),
    listRepositoryFiles: async () => ['README.md'],
    getText: async () => { reads += 1; if (!winnerAvailable) throw notFound(); return { sha: 'winner-sha', text: JSON.stringify(winner) }; },
    putText: async (path, text, message, sha) => {
      writes.push({ path, text, message, sha });
      if (writes.length === 1) { winnerAvailable = true; const error = new Error('already exists'); error.status = 422; error.code = 'validation'; throw error; }
      return { sha: 'merged-sha' };
    },
  };
  const result = await new RepositoryInitializer({ github }).initialize({ id: 123, login: 'alice' }, { expectedRepositoryId: 77 });
  assert.equal(result.status, 'write_verified');
  assert.equal(writes.length, 2);
  assert.equal(writes[1].sha, 'winner-sha');
  assert.deepEqual(JSON.parse(writes[1].text).users, { '1': 'owner', '123': 'alice' });
});

test('repository initialization rejects a selected repository ID mismatch before writing', async () => {
  let branchChecks = 0;
  const github = {
    validateRepository: async () => ({ id: 88, private: true, archived: false, disabled: false, default_branch: 'main', permissions: { push: true } }),
    validateBranch: async () => { branchChecks += 1; return { name: 'main' }; },
  };
  await assert.rejects(
    () => new RepositoryInitializer({ github }).initialize({ id: 123, login: 'alice' }, { expectedRepositoryId: 77 }),
    error => error.code === 'repository_identity_changed',
  );
  assert.equal(branchChecks, 0);
});


test('zero installations is a normal post-activation state with no repositories yet', async () => {
  const github = { request: async path => {
    assert.match(path, /^\/user\/installations\?/);
    return { total_count: 0, installations: [] };
  } };
  assert.deepEqual(await new InstallationDiscoveryService({ github }).discover(), {
    installations: [], repositories: [], candidates: [],
  });
});

test('internal repositories are unavailable under the private-only first-release policy', async () => {
  const github = { request: async path => path.startsWith('/user/installations?')
    ? { total_count: 1, installations: [installation(1)] }
    : { total_count: 1, repositories: [repository(71, { visibility: 'internal' })] } };
  const result = await new InstallationDiscoveryService({ github }).discover();
  assert.equal(result.candidates.length, 0);
  assert.deepEqual(result.repositories[0].reasons, ['private_required']);
});

test('persistent create-time 409 without a winning marker is branch policy rejection', async () => {
  const github = {
    validateRepository: async () => repository(77), validateBranch: async () => ({}),
    getText: async () => { throw notFound(); }, listRepositoryFiles: async () => [],
    putText: async () => { throw conflict(); },
  };
  await assert.rejects(
    () => new RepositoryInitializer({ github }).initialize({ id: 123, login: 'alice' }),
    error => error.code === 'branch_policy_rejected',
  );
});


test('repository initialization rejects duplicate or inconsistent marker ownership before accepting a mapping', async () => {
  const base = {
    validateRepository: async () => repository(77), validateBranch: async () => ({}), putText: async () => { throw new Error('must not write'); },
  };
  for (const marker of [
    { repositoryFormatVersion: 1, createdAt: '2026-08-20T00:00:00Z', createdBy: { id: 1, login: 'alice' }, users: { '1': 'alice', '2': 'alice' } },
    { repositoryFormatVersion: 1, createdAt: '2026-08-20T00:00:00Z', createdBy: { id: 1, login: 'alice' }, users: { '1': 'bob' } },
  ]) {
    const github = { ...base, getText: async () => ({ sha: 'marker', text: JSON.stringify(marker) }) };
    await assert.rejects(
      () => new RepositoryInitializer({ github }).initialize({ id: 1, login: 'alice' }),
      error => error.code === 'incompatible_storage_format',
    );
  }
});

test('template repository placeholders are accepted before creating the user marker', async () => {
  const writes = [];
  const github = {
    validateRepository: async () => repository(77), validateBranch: async () => ({}),
    getText: async path => { assert.ok(['.clockoli/config.json', '.clockoli/config.json'].includes(path)); throw notFound(); },
    listRepositoryEntries: async () => [
      { path: '.clockoli', type: 'tree', mode: '040000' },
      { path: '.clockoli/.gitkeep', type: 'blob', mode: '100644' },
      { path: 'active', type: 'tree', mode: '040000' },
      { path: 'active/.gitkeep', type: 'blob', mode: '100644' },
      { path: 'times', type: 'tree', mode: '040000' },
      { path: 'times/.gitkeep', type: 'blob', mode: '100644' },
    ],
    putText: async (...args) => { writes.push(args); return { sha: 'marker' }; },
  };
  const result = await new RepositoryInitializer({ github }).initialize({ id: 123, login: 'alice' });
  assert.equal(result.status, 'write_verified');
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0], '.clockoli/config.json');
});

test('pre-marker validation rejects non-blob entries and incompatible modes under reserved namespaces', async () => {
  let writes = 0;
  const github = {
    validateRepository: async () => repository(77), validateBranch: async () => ({}),
    getText: async () => { throw notFound(); },
    listRepositoryEntries: async () => [
      { path: 'active/vendor', type: 'commit', mode: '160000' },
      { path: 'times/2026-08/alice.jsonl', type: 'blob', mode: '120000' },
    ],
    putText: async () => { writes += 1; },
  };
  await assert.rejects(
    () => new RepositoryInitializer({ github }).initialize({ id: 123, login: 'alice' }),
    error => error.code === 'incompatible_storage_format',
  );
  assert.equal(writes, 0);
});

test('default-branch initialization rejects a stale discovered branch before marker access', async () => {
  let branchChecks = 0, markerReads = 0, writes = 0;
  const github = {
    validateRepository: async () => repository(77, { default_branch: 'trunk' }),
    validateBranch: async () => { branchChecks += 1; return {}; },
    getText: async () => { markerReads += 1; throw notFound(); },
    putText: async () => { writes += 1; },
  };
  await assert.rejects(
    () => new RepositoryInitializer({ github }).initialize(
      { id: 123, login: 'alice' },
      { expectedRepositoryId: 77, selectedBranch: 'main', branchMode: 'default' },
    ),
    error => error.code === 'repository_branch_changed',
  );
  assert.equal(branchChecks, 0); assert.equal(markerReads, 0); assert.equal(writes, 0);
});

test('marker schema rejects unknown fields and bounded-size or user-count violations', async () => {
  const valid = { repositoryFormatVersion: 1, createdAt: '2026-08-20T00:00:00Z', createdBy: { id: 1, login: 'alice' }, users: { '1': 'alice' } };
  const base = { validateRepository: async () => repository(77), validateBranch: async () => ({}), putText: async () => { throw new Error('must not write'); } };
  const variants = [
    { ...valid, unexpected: true },
    { ...valid, createdBy: { ...valid.createdBy, unexpected: true } },
    { ...valid, users: Object.fromEntries(Array.from({ length: 1001 }, (_, index) => [String(index + 1), `user-${index + 1}`])) },
    `${JSON.stringify(valid)}${' '.repeat(65_536)}`,
  ];
  for (const marker of variants) {
    const text = typeof marker === 'string' ? marker : JSON.stringify(marker);
    await assert.rejects(
      () => new RepositoryInitializer({ github: { ...base, getText: async () => ({ sha: 'marker', text }) } }).initialize({ id: 1, login: 'alice' }),
      error => error.code === 'incompatible_storage_format',
    );
  }
});

test('PAT migration can require the immutable legacy storage login when creating the marker', async () => {
  const writes = [];
  const github = {
    validateRepository: async () => repository(77), validateBranch: async () => ({}),
    getText: async path => {
      if (path === '.clockoli/config.json' || path === '.clockoli/config.json') throw notFound();
      if (path.startsWith('active/')) return { text: activeJson('old-login'), sha: 'a' };
      return { text: '', sha: 'b' };
    }, listRepositoryEntries: async () => [
      { path: 'active/old-login.json', type: 'blob', mode: '100644' },
      { path: 'times/2026-08/old-login.jsonl', type: 'blob', mode: '100644' },
    ],
    putText: async (_path, text) => { writes.push(JSON.parse(text)); return { sha: 'marker' }; },
  };
  const result = await new RepositoryInitializer({ github }).initialize(
    { id: 123, login: 'new-login' },
    { expectedRepositoryId: 77, selectedBranch: 'main', branchMode: 'default', requiredStorageLogin: 'old-login' },
  );
  assert.equal(result.storageLogin, 'old-login');
  assert.deepEqual(writes[0].createdBy, { id: 123, login: 'old-login' });
  assert.deepEqual(writes[0].users, { '123': 'old-login' });
});

test('default branch is revalidated after reserved-tree traversal and immediately before marker write', async () => {
  let validations = 0, writes = 0;
  const github = {
    validateRepository: async () => repository(77, { default_branch: ++validations >= 2 ? 'trunk' : 'main' }),
    validateBranch: async () => ({}), getText: async () => { throw notFound(); }, listRepositoryEntries: async () => [],
    putText: async () => { writes += 1; },
  };
  await assert.rejects(
    () => new RepositoryInitializer({ github }).initialize(
      { id: 123, login: 'alice' }, { expectedRepositoryId: 77, selectedBranch: 'main', branchMode: 'default' },
    ),
    error => error.code === 'repository_branch_changed',
  );
  assert.equal(validations, 2);
  assert.equal(writes, 0);
});

test('marker update rejects growth beyond the exact user-count ceiling before writing', async () => {
  const users = Object.fromEntries(Array.from({ length: 1000 }, (_, index) => [String(index + 1), `user-${index + 1}`]));
  const marker = { repositoryFormatVersion: 1, createdAt: '2026-08-20T00:00:00Z', createdBy: { id: 1, login: 'user-1' }, users };
  let writes = 0;
  const github = {
    validateRepository: async () => repository(77), validateBranch: async () => ({}),
    getText: async () => ({ text: JSON.stringify(marker), sha: 'marker' }),
    putText: async () => { writes += 1; },
  };
  await assert.rejects(
    () => new RepositoryInitializer({ github }).initialize(
      { id: 2001, login: 'new-user' }, { expectedRepositoryId: 77, selectedBranch: 'main', branchMode: 'default' },
    ),
    error => error.code === 'incompatible_storage_format',
  );
  assert.equal(writes, 0);
});

test('marker update rejects pretty serialization that grows beyond the byte ceiling', async () => {
  const firstId = 1_000_000_000_000_000;
  const users = Object.fromEntries(Array.from({ length: 999 }, (_, index) => {
    const prefix = `u${index + 1}`;
    return [String(firstId + index), `${prefix}${'x'.repeat(39 - prefix.length)}`];
  }));
  const marker = { repositoryFormatVersion: 1, createdAt: '2026-08-20T00:00:00Z', createdBy: { id: firstId, login: users[String(firstId)] }, users };
  const compact = JSON.stringify(marker);
  assert.ok(new TextEncoder().encode(compact).byteLength <= 64 * 1024);
  const expanded = `${JSON.stringify({ ...marker, users: { ...users, 2001: 'new-user' } }, null, 2)}\n`;
  assert.ok(new TextEncoder().encode(expanded).byteLength > 64 * 1024);
  let writes = 0;
  const github = {
    validateRepository: async () => repository(77), validateBranch: async () => ({}),
    getText: async () => ({ text: compact, sha: 'marker' }),
    putText: async () => { writes += 1; },
  };
  await assert.rejects(
    () => new RepositoryInitializer({ github }).initialize(
      { id: 2001, login: 'new-user' }, { expectedRepositoryId: 77, selectedBranch: 'main', branchMode: 'default' },
    ),
    error => error.code === 'incompatible_storage_format',
  );
  assert.equal(writes, 0);
});

test('repository marker rejects impossible UTC calendar timestamps instead of accepting Date normalization', async () => {
  const marker = {
    repositoryFormatVersion: 1,
    createdAt: '2026-02-31T00:00:00Z',
    createdBy: { id: 123, login: 'alice' },
    users: { '123': 'alice' },
  };
  const github = {
    validateRepository: async () => repository(77), validateBranch: async () => ({}),
    getText: async () => ({ sha: 'marker', text: JSON.stringify(marker) }),
    putText: async () => { throw new Error('must not write'); },
  };
  await assert.rejects(
    () => new RepositoryInitializer({ github }).initialize({ id: 123, login: 'alice' }),
    error => error.code === 'incompatible_storage_format',
  );
});

test('pre-marker validation rejects blobs occupying reserved directory roots', async () => {
  for (const path of ['.clockoli', 'active', 'times']) {
    let writes = 0;
    const github = {
      validateRepository: async () => repository(77), validateBranch: async () => ({}),
      getText: async () => { throw notFound(); },
      listRepositoryEntries: async () => [{ path, type: 'blob', mode: '100644' }],
      putText: async () => { writes += 1; },
    };
    await assert.rejects(
      () => new RepositoryInitializer({ github }).initialize({ id: 123, login: 'alice' }),
      error => error.code === 'incompatible_storage_format',
    );
    assert.equal(writes, 0);
  }
});



test('empty private writable repositories remain selectable for automatic initialization', async () => {
  const github = { request: async path => path.startsWith('/user/installations?')
    ? { total_count: 1, installations: [installation(1)] }
    : { total_count: 1, repositories: [repository(91, { default_branch: null })] } };
  const result = await new InstallationDiscoveryService({ github }).discover();
  assert.equal(result.repositories[0].needsInitialization, true);
  assert.equal(result.repositories[0].eligible, true);
  assert.deepEqual(result.candidates.map(value => value.repoId), [91]);
});

test('repository initialization makes the first commit automatically when the selected repository is empty', async () => {
  let validations = 0;
  const writes = [];
  const github = {
    validateRepository: async () => ({
      id: 77, full_name: 'owner/repo-77', private: true, archived: false, disabled: false,
      default_branch: validations++ === 0 ? null : 'main', permissions: { push: true },
    }),
    putInitialText: async (path, text, message) => { writes.push({ path, text, message }); return { sha: 'marker', commitSha: 'initial' }; },
    validateBranch: async () => { throw new Error('must not validate a branch before the first commit'); },
    getText: async () => { throw new Error('must not read before the first commit'); },
  };
  const result = await new RepositoryInitializer({ github, now: () => new Date('2026-08-21T00:00:00Z') })
    .initialize({ id: 123, login: 'alice' }, { expectedRepositoryId: 77, selectedBranch: 'main', branchMode: 'default' });
  assert.equal(result.status, 'write_verified');
  assert.equal(result.branch, 'main');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, '.clockoli/config.json');
  assert.deepEqual(JSON.parse(writes[0].text).users, { '123': 'alice' });
});

test('repository inspection is read-only and classifies every onboarding state and action', async () => {
  const memberMarker = {
    repositoryFormatVersion: 1, createdAt: '2026-08-20T00:00:00Z',
    createdBy: { id: 1, login: 'owner' }, users: { '1': 'owner', '123': 'alice' },
  };
  const joinableMarker = { ...memberMarker, users: { '1': 'owner' } };
  const scenarios = [
    ['initialized_member', { marker: memberMarker }, { canAdd: true, canJoin: false, canInitialize: false }],
    ['initialized_joinable', { marker: joinableMarker }, { canAdd: false, canJoin: true, canInitialize: false }],
    ['uninitialized', {}, { canAdd: false, canJoin: false, canInitialize: true }],
    ['empty', { empty: true }, { canAdd: false, canJoin: false, canInitialize: true }],
    ['incompatible', { markerText: '{bad json' }, { canAdd: false, canJoin: false, canInitialize: false }],
    ['unavailable', { private: false }, { canAdd: false, canJoin: false, canInitialize: false }],
  ];
  for (const [state, setup, actions] of scenarios) {
    let writes = 0;
    const github = {
      validateRepository: async () => repository(77, {
        owner: { id: 10, login: 'owner', type: 'User' },
        private: setup.private !== false, default_branch: setup.empty ? null : 'main',
        permissions: { push: true, admin: false },
      }),
      validateBranch: async () => ({}),
      getText: async () => {
        if (setup.marker || setup.markerText) return { sha: 'marker', text: setup.markerText || JSON.stringify(setup.marker) };
        throw notFound();
      },
      listRepositoryEntries: async () => [],
      putText: async () => { writes += 1; }, putInitialText: async () => { writes += 1; },
    };
    const candidate = {
      repoId: 77, owner: 'owner', repo: 'time', ownerType: 'User', defaultBranch: setup.empty ? '' : 'main',
      private: setup.private !== false, archived: false, disabled: false,
      appPermissions: { contents: 'write' }, userPermissions: { push: true, admin: false }, reasons: setup.private === false ? ['private_required'] : [],
    };
    const inspected = await new RepositoryInspectionService({ github }).inspect({ id: 123, login: 'alice' }, candidate);
    assert.equal(inspected.state, state);
    assert.equal(inspected.ownership, 'personal');
    assert.deepEqual({ canAdd: inspected.canAdd, canJoin: inspected.canJoin, canInitialize: inspected.canInitialize }, actions);
    assert.equal(writes, 0);
  }
});

test('repository inspection treats the discovery empty-branch reason as initializable, not unavailable', async () => {
  const candidate = {
    repoId: 77, owner: 'owner', repo: 'time', ownerType: 'User', defaultBranch: '', private: true,
    archived: false, disabled: false, appPermissions: { contents: 'write' }, userPermissions: { push: true, admin: false },
    reasons: ['initialized_default_branch_required'],
  };
  const github = {
    validateRepository: async () => repository(77, { default_branch: null }),
    getText: async () => { throw new Error('must not inspect a branch in an empty repository'); },
  };
  const inspected = await new RepositoryInspectionService({ github }).inspect({ id: 123, login: 'alice' }, candidate);
  assert.equal(inspected.state, 'empty');
  assert.equal(inspected.canInitialize, true);
  assert.equal(inspected.eligible, true);
});

test('repository inspection uses fresh repository admin permission and fails closed when access disappeared', async () => {
  const organization = {
    repoId: 77, owner: 'acme', repo: 'time', ownerType: 'Organization', defaultBranch: 'main', private: true,
    archived: false, disabled: false, appPermissions: { contents: 'write' }, userPermissions: { push: true, admin: true }, reasons: [],
  };
  const nonAdmin = await new RepositoryInspectionService({ github: {
    validateRepository: async () => repository(77, {
      owner: { id: 10, login: 'acme', type: 'Organization' }, default_branch: null,
      permissions: { push: true, admin: false },
    }),
  } }).inspect({ id: 123, login: 'alice' }, organization);
  assert.equal(nonAdmin.state, 'empty');
  assert.equal(nonAdmin.admin, false);
  assert.equal(nonAdmin.canInitialize, false);
  assert.equal(nonAdmin.eligible, false);

  let markerReads = 0;
  const inaccessible = await new RepositoryInspectionService({ github: {
    validateRepository: async () => { throw notFound(); },
    getText: async () => { markerReads += 1; throw notFound(); },
  } }).inspect({ id: 123, login: 'alice' }, organization);
  assert.equal(inaccessible.state, 'unavailable');
  assert.equal(inaccessible.inspectionError, 'repository_access_required');
  assert.equal(markerReads, 0);
});

test('organization initialization requires admin and join never initializes an unmarked repository', async () => {
  for (const action of ['join', 'initialize']) {
    let writes = 0;
    const github = {
      validateRepository: async () => ({ ...repository(77, { owner: { id: 10, login: 'acme', type: 'Organization' } }), permissions: { push: true, admin: false } }),
      validateBranch: async () => ({}), getText: async () => { throw notFound(); }, listRepositoryEntries: async () => [],
      putText: async () => { writes += 1; }, putInitialText: async () => { writes += 1; },
    };
    await assert.rejects(
      () => new RepositoryInitializer({ github }).execute(action, { id: 123, login: 'alice' }, { expectedRepositoryId: 77 }),
      error => error.code === (action === 'join' ? 'repository_not_initialized' : 'repository_admin_required'),
    );
    assert.equal(writes, 0);
  }
});

test('explicit initialize by an organization admin writes once, while member add writes no marker', async () => {
  const initializationWrites = [];
  const adminGithub = {
    validateRepository: async () => ({ ...repository(77, { owner: { id: 10, login: 'acme', type: 'Organization' } }), permissions: { push: true, admin: true } }),
    validateBranch: async () => ({}), getText: async () => { throw notFound(); }, listRepositoryEntries: async () => [],
    putText: async (...args) => { initializationWrites.push(args); return { sha: 'marker' }; },
  };
  const initialized = await new RepositoryInitializer({ github: adminGithub }).execute('initialize', { id: 123, login: 'alice' }, { expectedRepositoryId: 77 });
  assert.equal(initialized.status, 'write_verified');
  assert.equal(initializationWrites.length, 1);

  let memberWrites = 0;
  const marker = {
    repositoryFormatVersion: 1, createdAt: '2026-08-20T00:00:00Z',
    createdBy: { id: 123, login: 'alice' }, users: { '123': 'alice' },
  };
  const memberGithub = {
    validateRepository: async () => repository(77), validateBranch: async () => ({}),
    getText: async () => ({ sha: 'marker', text: JSON.stringify(marker) }),
    putText: async () => { memberWrites += 1; },
  };
  const added = await new RepositoryInitializer({ github: memberGithub }).execute('add', { id: 123, login: 'renamed' }, { expectedRepositoryId: 77 });
  assert.equal(added.status, 'access_checked');
  assert.equal(added.storageLogin, 'alice');
  assert.equal(memberWrites, 0);
});
