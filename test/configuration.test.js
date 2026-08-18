import test from 'node:test';
import assert from 'node:assert/strict';
import { ConfigurationService } from '../src/services/configuration.js';

const oldConfig = { owner: 'old-org', repo: 'time-data', branch: 'main', recentDays: 7, allowedIssueOwners: ['old-org'] };
const newPayload = { owner: 'new-org', repo: 'time-data', branch: 'main', recentDays: 7, allowedIssueOwners: ['new-org'], token: 'new-token' };

class MemoryConfigStore {
  constructor({ activeCache = null, pendingWrites = [], user = 'alice' } = {}) {
    this.config = oldConfig; this.token = 'old-token';
    this.state = { activeCache, recentCache: [], pendingWrites, user };
  }
  async getConfig() { return { config: structuredClone(this.config), token: this.token }; }
  async getState() { return structuredClone(this.state); }
  async saveConfig(config, token) { this.config = structuredClone(config); this.token = token; }
  async saveConfiguration(config, token, statePatch) { this.config = structuredClone(config); this.token = token; Object.assign(this.state, structuredClone(statePatch)); }
  async patchState(patch) { Object.assign(this.state, structuredClone(patch)); }
}

function factory({ token }) {
  if (token === 'new-token') return {
    getAuthenticatedUser: async () => 'alice', validateRepository: async () => ({ private: true }), validateBranch: async () => ({}),
  };
  return {
    getAuthenticatedUser: async () => 'alice',
    getFile: async () => ({ data: { schemaVersion: 1, user: 'alice', issue: { type: 'issue', owner: 'acme', repo: 'app', number: 1, url: 'https://github.com/acme/app/issues/1' }, startedAt: '2026-08-18T08:00:00.000Z', description: '', createdAt: '2026-08-18T08:00:00.000Z' } }),
  };
}

test('configuration service refuses to redirect pending writes', async () => {
  const store = new MemoryConfigStore({ pendingWrites: [{ id: 'pending' }] });
  const service = new ConfigurationService({ store, githubFactory: factory });
  await assert.rejects(() => service.save(newPayload), /pending/i);
  assert.equal(store.config.owner, 'old-org');
});

test('configuration service discovers and protects an uncached active timer before changing destination', async () => {
  const store = new MemoryConfigStore();
  const service = new ConfigurationService({ store, githubFactory: factory });
  await assert.rejects(() => service.save(newPayload), /active timer/i);
  assert.equal(store.config.owner, 'old-org');
});

test('configuration service allows first setup and returns the authenticated user', async () => {
  const store = new MemoryConfigStore({ user: null }); store.config = null; store.token = '';
  const service = new ConfigurationService({ store, githubFactory: factory });
  const result = await service.save(newPayload);
  assert.equal(result.user, 'alice');
  assert.equal(store.config.owner, 'new-org');
  assert.equal(store.state.user, 'alice');
});


test('configuration service re-reads pending state after asynchronous GitHub validation', async () => {
  const store = new MemoryConfigStore();
  const racingFactory = options => {
    const github = factory(options);
    if (options.token === 'new-token') github.validateBranch = async () => { store.state.pendingWrites = [{ id: 'arrived-during-validation' }]; return {}; };
    return github;
  };
  const service = new ConfigurationService({ store, githubFactory: racingFactory });
  await assert.rejects(() => service.save(newPayload), /pending/i);
  assert.equal(store.config.owner, 'old-org');
});


test('configuration remains unchanged when the atomic persistence transaction fails', async () => {
  const store = new MemoryConfigStore({ user: null }); store.config = null; store.token = '';
  store.saveConfiguration = async () => { throw new Error('simulated atomic write failure'); };
  const service = new ConfigurationService({ store, githubFactory: factory });
  await assert.rejects(() => service.save(newPayload), /atomic write failure/i);
  assert.equal(store.config, null);
  assert.equal(store.token, '');
  assert.equal(store.state.user, null);
});


test('configuration recovers the previous authenticated user before allowing a token identity change', async () => {
  const store = new MemoryConfigStore({ user: null });
  let oldActiveReads = 0;
  const identityFactory = ({ token }) => token === 'new-token' ? {
    getAuthenticatedUser: async () => 'bob', validateRepository: async () => ({ private: true }), validateBranch: async () => ({}),
  } : {
    getAuthenticatedUser: async () => 'alice',
    getFile: async () => { oldActiveReads += 1; return { data: { schemaVersion: 1, user: 'alice' } }; },
  };
  const service = new ConfigurationService({ store, githubFactory: identityFactory });
  await assert.rejects(() => service.save({ ...newPayload, owner: 'old-org', allowedIssueOwners: ['old-org'] }), /active timer/i);
  assert.equal(oldActiveReads, 1);
  assert.equal(store.token, 'old-token');
});
