import test from 'node:test';
import assert from 'node:assert/strict';
import { CredentialBroker, DeviceFlowService } from '../src/auth/github-app-auth.js';

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => structuredClone(body) };
}

class MemoryAuthStore {
  constructor({ auth = null, authGeneration = 0, configurationGeneration = 0, attempt = null } = {}) {
    this.auth = structuredClone(auth);
    this.authGeneration = authGeneration;
    this.configurationGeneration = configurationGeneration;
    this.attempt = structuredClone(attempt);
    this.rotations = 0;
  }
  async getDeviceAttempt() { return structuredClone(this.attempt); }
  async saveDeviceAttempt(attempt) { this.attempt = structuredClone(attempt); }
  async replaceDeviceAttempt(attemptId, attempt) {
    if (this.attempt?.id !== attemptId) return false;
    this.attempt = structuredClone(attempt); return true;
  }
  async clearDeviceAttempt(attemptId) {
    if (attemptId && this.attempt?.id !== attemptId) return false;
    if (!this.attempt) return false;
    this.attempt = null; return true;
  }
  async getAuthSnapshot() {
    return {
      auth: structuredClone(this.auth),
      authGeneration: this.authGeneration,
      configurationGeneration: this.configurationGeneration,
    };
  }
  async saveAuthorizedGitHubApp(auth, attemptId) {
    if (this.attempt?.id !== attemptId) return false;
    this.authGeneration += 1;
    this.auth = { ...structuredClone(auth), generation: this.authGeneration };
    this.attempt = null;
    return true;
  }
  async rotateGitHubAppAuth(expectedAuthGeneration, _expectedConfigurationGeneration, auth) {
    if (this.authGeneration !== expectedAuthGeneration) return false;
    this.authGeneration += 1;
    this.auth = { ...structuredClone(auth), generation: this.authGeneration };
    this.rotations += 1;
    return true;
  }
}

const clientId = 'Iv1.public-client-id';

function attemptResponse(overrides = {}) {
  return {
    device_code: 'background-only-device-code', user_code: 'ABCD-EFGH',
    verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5,
    ...overrides,
  };
}

test('Device Flow persists the secret attempt but returns only a safe display projection', async () => {
  const store = new MemoryAuthStore();
  const calls = [];
  const service = new DeviceFlowService({
    clientId, store, now: () => 1_000, randomUUID: () => 'attempt-one',
    fetchImpl: async (url, options) => { calls.push({ url, options }); return response(200, attemptResponse()); },
  });
  const display = await service.start();
  assert.deepEqual(display, {
    attemptId: 'attempt-one', userCode: 'ABCD-EFGH', verificationUri: 'https://github.com/login/device',
    expiresAt: 901_000, status: 'pending', nextPollAt: 6_000,
  });
  assert.equal('deviceCode' in display, false);
  assert.equal(store.attempt.deviceCode, 'background-only-device-code');
  assert.equal(calls[0].url, 'https://github.com/login/device/code');
  assert.equal(new URLSearchParams(calls[0].options.body).get('client_id'), clientId);
  assert.equal(calls[0].options.cache, 'no-store');
});

test('Device Flow resume remains safe and polling honors the persisted next time', async () => {
  const store = new MemoryAuthStore({ attempt: {
    id: 'attempt-one', deviceCode: 'secret-device', userCode: 'ABCD-EFGH',
    verificationUri: 'https://github.com/login/device', expiresAt: 20_000,
    intervalMs: 5_000, nextPollAt: 6_000, status: 'pending',
  } });
  let calls = 0;
  const service = new DeviceFlowService({ clientId, store, now: () => 5_000, fetchImpl: async () => { calls += 1; throw new Error('too early'); } });
  assert.equal((await service.resume()).attemptId, 'attempt-one');
  assert.equal('deviceCode' in (await service.resume()), false);
  const pending = await service.poll('attempt-one');
  assert.deepEqual(pending, { attemptId: 'attempt-one', userCode: 'ABCD-EFGH', verificationUri: 'https://github.com/login/device', expiresAt: 20_000, status: 'pending', nextPollAt: 6_000 });
  assert.equal('deviceCode' in pending, false);
  assert.equal(calls, 0);
});

test('Device Flow persists slow_down before the next poll and survives network failure', async () => {
  let now = 6_000, calls = 0;
  const store = new MemoryAuthStore({ attempt: {
    id: 'attempt-one', deviceCode: 'secret-device', userCode: 'ABCD-EFGH',
    verificationUri: 'https://github.com/login/device', expiresAt: 30_000,
    intervalMs: 5_000, nextPollAt: 6_000, status: 'pending',
  } });
  const service = new DeviceFlowService({
    clientId, store, now: () => now,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return response(200, { error: 'slow_down' });
      throw new TypeError('offline');
    },
  });
  const slow = await service.poll('attempt-one');
  assert.deepEqual(slow, { attemptId: 'attempt-one', userCode: 'ABCD-EFGH', verificationUri: 'https://github.com/login/device', expiresAt: 30_000, status: 'pending', nextPollAt: 16_000 });
  assert.equal('deviceCode' in slow, false);
  assert.equal(store.attempt.intervalMs, 10_000);
  now = 16_000;
  await assert.rejects(() => service.poll('attempt-one'), /offline/);
  assert.equal(store.attempt.nextPollAt, 26_000);
  assert.equal(store.attempt.deviceCode, 'secret-device');
});

test('successful Device Flow stores the rotating token pair and authenticated identity atomically', async () => {
  const store = new MemoryAuthStore({ attempt: {
    id: 'attempt-one', deviceCode: 'secret-device', userCode: 'ABCD-EFGH',
    verificationUri: 'https://github.com/login/device', expiresAt: 30_000,
    intervalMs: 5_000, nextPollAt: 6_000, status: 'pending',
  } });
  const calls = [];
  const service = new DeviceFlowService({
    clientId, store, now: () => 6_000,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url === 'https://github.com/login/oauth/access_token') return response(200, {
        access_token: 'access-one', expires_in: 28_800,
        refresh_token: 'refresh-one', refresh_token_expires_in: 15_552_000,
        token_type: 'bearer',
      });
      assert.equal(options.headers.Authorization, 'Bearer access-one');
      return response(200, { id: 123, login: 'alice' });
    },
  });
  const result = await service.poll('attempt-one');
  assert.deepEqual(result, { status: 'authorized', githubUserId: 123, githubLogin: 'alice' });
  assert.equal(store.attempt, null);
  assert.deepEqual(store.auth, {
    mode: 'github_app', candidateId: 'attempt-one', githubUserId: 123, githubLogin: 'alice', accessToken: 'access-one',
    accessTokenExpiresAt: 28_806_000, refreshToken: 'refresh-one',
    refreshTokenExpiresAt: 15_552_006_000, generation: 1,
  });
  assert.equal(calls.length, 2);
});

test('Device Flow denial clears the attempt and returns a classified error', async () => {
  const store = new MemoryAuthStore({ attempt: {
    id: 'attempt-one', deviceCode: 'secret-device', userCode: 'ABCD-EFGH',
    verificationUri: 'https://github.com/login/device', expiresAt: 30_000,
    intervalMs: 5_000, nextPollAt: 6_000, status: 'pending',
  } });
  const service = new DeviceFlowService({ clientId, store, now: () => 6_000, fetchImpl: async () => response(200, { error: 'access_denied' }) });
  await assert.rejects(() => service.poll('attempt-one'), error => error.code === 'auth_denied');
  assert.equal(store.attempt, null);
});

test('Credential broker performs one secretless refresh for concurrent callers and atomically rotates both tokens', async () => {
  const store = new MemoryAuthStore({ authGeneration: 4, configurationGeneration: 9, auth: {
    mode: 'github_app', githubUserId: 123, githubLogin: 'alice', accessToken: 'access-old',
    accessTokenExpiresAt: 10_000, refreshToken: 'refresh-old', refreshTokenExpiresAt: 99_999_999, generation: 4,
  } });
  let calls = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  const broker = new CredentialBroker({
    clientId, store, now: () => 10_000,
    fetchImpl: async (url, options) => {
      calls += 1;
      assert.equal(url, 'https://github.com/login/oauth/access_token');
      const body = new URLSearchParams(options.body);
      assert.equal(body.get('client_id'), clientId);
      assert.equal(body.get('client_secret'), null);
      assert.equal(body.get('grant_type'), 'refresh_token');
      assert.equal(body.get('refresh_token'), 'refresh-old');
      await gate;
      return response(200, {
        access_token: 'access-new', expires_in: 28_800,
        refresh_token: 'refresh-new', refresh_token_expires_in: 15_552_000,
      });
    },
  });
  const first = broker.getAccessToken(), second = broker.getAccessToken();
  release();
  assert.deepEqual(await Promise.all([first, second]), ['access-new', 'access-new']);
  assert.equal(calls, 1);
  assert.equal(store.rotations, 1);
  assert.equal(store.auth.accessToken, 'access-new');
  assert.equal(store.auth.refreshToken, 'refresh-new');
  assert.equal(store.auth.generation, 5);
});

test('Credential broker returns a current token after another request already replaced the rejected token', async () => {
  const store = new MemoryAuthStore({ authGeneration: 5, configurationGeneration: 2, auth: {
    mode: 'github_app', githubUserId: 123, githubLogin: 'alice', accessToken: 'access-new',
    accessTokenExpiresAt: 9_999_999, refreshToken: 'refresh-new', refreshTokenExpiresAt: 99_999_999, generation: 5,
  } });
  const broker = new CredentialBroker({ clientId, store, now: () => 10_000, fetchImpl: async () => { throw new Error('must not refresh'); } });
  assert.equal(await broker.getAccessToken({ forceRefresh: true, rejectedToken: 'access-old' }), 'access-new');
});

test('Credential broker preserves legacy PAT mode without attempting refresh', async () => {
  const store = new MemoryAuthStore({ auth: { mode: 'pat', accessToken: 'legacy-pat', generation: 1 }, authGeneration: 1 });
  const broker = new CredentialBroker({ clientId, store, fetchImpl: async () => { throw new Error('must not fetch'); } });
  assert.equal(await broker.getAccessToken(), 'legacy-pat');
});


test('pending and slow-down polls retain the complete safe display projection', async () => {
  const now = 12_000;
  const attempt = { id: 'attempt-display', deviceCode: 'secret-device', userCode: 'ABCD-1234', verificationUri: 'https://github.com/login/device', expiresAt: 90_000, intervalMs: 5_000, nextPollAt: 20_000, status: 'pending' };
  const earlyStore = new MemoryAuthStore({ attempt });
  const early = await new DeviceFlowService({ clientId: 'Iv1.public', store: earlyStore, now: () => now, fetchImpl: async () => { throw new Error('must not fetch'); } }).poll(attempt.id);
  assert.deepEqual(early, { attemptId: attempt.id, userCode: attempt.userCode, verificationUri: attempt.verificationUri, expiresAt: attempt.expiresAt, status: 'pending', nextPollAt: attempt.nextPollAt });
  assert.equal('deviceCode' in early, false);

  const slowStore = new MemoryAuthStore({ attempt: { ...attempt, nextPollAt: now } });
  const slow = await new DeviceFlowService({ clientId: 'Iv1.public', store: slowStore, now: () => now, fetchImpl: async () => response(200, { error: 'slow_down' }) }).poll(attempt.id);
  assert.equal(slow.attemptId, attempt.id);
  assert.equal(slow.userCode, attempt.userCode);
  assert.equal(slow.verificationUri, attempt.verificationUri);
  assert.equal(slow.expiresAt, attempt.expiresAt);
  assert.equal(slow.nextPollAt, now + 10_000);
  assert.equal('deviceCode' in slow, false);
});


test('Device Flow persists a consumed token pair and resumes identity commit after worker restart', async () => {
  const store = new MemoryAuthStore({ attempt: {
    id: 'attempt-resume', deviceCode: 'one-time-code', userCode: 'ABCD-EFGH',
    verificationUri: 'https://github.com/login/device', expiresAt: 30_000,
    intervalMs: 5_000, nextPollAt: 6_000, status: 'pending',
  } });
  const first = new DeviceFlowService({
    clientId, store, now: () => 6_000,
    fetchImpl: async url => {
      if (url.endsWith('/login/oauth/access_token')) return response(200, {
        access_token: 'access-provisional', expires_in: 28_800,
        refresh_token: 'refresh-provisional', refresh_token_expires_in: 15_552_000,
      });
      throw new TypeError('worker stopped during identity lookup');
    },
  });
  await assert.rejects(() => first.poll('attempt-resume'), /worker stopped/);
  assert.equal(store.attempt.status, 'token_received');
  assert.equal('deviceCode' in store.attempt, false, 'consumed device code is removed');
  assert.equal(store.attempt.provisionalAuth.accessToken, 'access-provisional');
  const projection = await first.resume();
  assert.equal('provisionalAuth' in projection, false);
  assert.equal('accessToken' in projection, false);

  let tokenCalls = 0, userCalls = 0;
  const restarted = new DeviceFlowService({
    clientId, store, now: () => 11_000,
    fetchImpl: async (url, options) => {
      if (url.endsWith('/login/oauth/access_token')) { tokenCalls += 1; throw new Error('consumed code must not be polled'); }
      userCalls += 1;
      assert.equal(options.headers.Authorization, 'Bearer access-provisional');
      return response(200, { id: 123, login: 'alice' });
    },
  });
  assert.deepEqual(await restarted.poll('attempt-resume'), { status: 'authorized', githubUserId: 123, githubLogin: 'alice' });
  assert.equal(tokenCalls, 0);
  assert.equal(userCalls, 1);
  assert.equal(store.attempt, null);
  assert.equal(store.auth.accessToken, 'access-provisional');
});

test('Device Flow cancellation aborts an in-flight poll and reports whether CAS cancellation won', async () => {
  const store = new MemoryAuthStore({ attempt: {
    id: 'attempt-cancel', deviceCode: 'one-time-code', userCode: 'ABCD-EFGH',
    verificationUri: 'https://github.com/login/device', expiresAt: 30_000,
    intervalMs: 5_000, nextPollAt: 6_000, status: 'pending',
  } });
  let started;
  const startedPromise = new Promise(resolve => { started = resolve; });
  const service = new DeviceFlowService({
    clientId, store, now: () => 6_000,
    fetchImpl: async (url, options) => new Promise((resolve, reject) => {
      started();
      options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }),
  });
  const polling = service.poll('attempt-cancel');
  await startedPromise;
  assert.deepEqual(await service.cancel('attempt-cancel'), { cancelled: true });
  await assert.rejects(polling, error => error.code === 'device_flow_superseded');
  assert.equal(store.attempt, null);
  assert.equal(store.auth, null);
  assert.deepEqual(await service.cancel('attempt-cancel'), { cancelled: false });
});


test('a delayed older Device Flow start cannot overwrite a newer reserved attempt', async () => {
  const store = new MemoryAuthStore();
  const responses = new Map();
  const waiting = id => new Promise(resolve => responses.set(id, resolve));
  let requestNumber = 0;
  const service = new DeviceFlowService({
    clientId, store,
    randomUUID: (() => { let value = 0; return () => `attempt-${++value}`; })(),
    fetchImpl: async (_url, options) => {
      const id = `request-${++requestNumber}`;
      void options.signal;
      return waiting(id);
    },
  });
  const older = service.start();
  await new Promise(resolve => setTimeout(resolve, 0));
  const newer = service.start();
  await new Promise(resolve => setTimeout(resolve, 0));
  responses.get('request-2')(response(200, attemptResponse({ device_code: 'new-device', user_code: 'NEW-CODE' })));
  assert.equal((await newer).attemptId, 'attempt-2');
  assert.equal(store.attempt.id, 'attempt-2');
  responses.get('request-1')(response(200, attemptResponse({ device_code: 'old-device', user_code: 'OLD-CODE' })));
  await assert.rejects(older, error => error.code === 'device_flow_superseded');
  assert.equal(store.attempt.id, 'attempt-2');
  assert.equal(store.attempt.deviceCode, 'new-device');
});

test('Device Flow expires a persisted code before making another token request', async () => {
  const store = new MemoryAuthStore({ attempt: {
    id: 'expired', deviceCode: 'secret', userCode: 'OLD-CODE', verificationUri: 'https://github.com/login/device',
    expiresAt: 10_000, intervalMs: 5_000, nextPollAt: 9_000, status: 'pending',
  } });
  let calls = 0;
  const service = new DeviceFlowService({ clientId, store, now: () => 10_000, fetchImpl: async () => { calls += 1; } });
  await assert.rejects(() => service.poll('expired'), error => error.code === 'device_code_expired');
  assert.equal(calls, 0);
  assert.equal(store.attempt, null);
});


test('initial Device Flow network failure clears its incomplete reservation and a restart can begin cleanly', async () => {
  const store = new MemoryAuthStore();
  const failed = new DeviceFlowService({
    clientId, store, randomUUID: () => 'attempt-offline',
    fetchImpl: async () => { throw new TypeError('offline'); },
  });
  await assert.rejects(() => failed.start(), /offline/);
  assert.equal(store.attempt, null);
  assert.equal(await new DeviceFlowService({ clientId, store, fetchImpl: async () => { throw new Error('must not fetch'); } }).resume(), null);

  const restarted = new DeviceFlowService({
    clientId, store, now: () => 1_000, randomUUID: () => 'attempt-restarted',
    fetchImpl: async () => response(200, attemptResponse()),
  });
  assert.equal((await restarted.start()).attemptId, 'attempt-restarted');
  assert.equal(store.attempt.status, 'pending');
});

test('Device Flow resume clears an orphaned requesting reservation instead of polling undefined secrets', async () => {
  const store = new MemoryAuthStore({ attempt: { id: 'orphan', status: 'requesting', createdAt: 1_000 } });
  let calls = 0;
  const service = new DeviceFlowService({ clientId, store, now: () => 2_000, fetchImpl: async () => { calls += 1; } });
  assert.equal(await service.resume(), null);
  assert.equal(store.attempt, null);
  assert.equal(calls, 0);
});

test('Credential broker preserves a consumed rotated token pair across a configuration-only race', async () => {
  const store = new MemoryAuthStore({ authGeneration: 4, configurationGeneration: 8, auth: {
    mode: 'github_app', githubUserId: 123, githubLogin: 'alice', accessToken: 'access-old',
    accessTokenExpiresAt: 10_000, refreshToken: 'refresh-old', refreshTokenExpiresAt: 99_999_999, generation: 4,
  } });
  const broker = new CredentialBroker({ clientId, store, now: () => 10_000, fetchImpl: async () => {
    store.configurationGeneration += 1;
    return response(200, { access_token: 'access-new', expires_in: 28_800, refresh_token: 'refresh-new', refresh_token_expires_in: 15_552_000 });
  } });
  assert.equal(await broker.getAccessToken(), 'access-new');
  assert.equal(store.auth.accessToken, 'access-new');
  assert.equal(store.auth.refreshToken, 'refresh-new');
});

test('Device Flow poll clears an orphaned requesting reservation before any OAuth request', async () => {
  const store = new MemoryAuthStore({ attempt: { id: 'orphan', status: 'requesting', requestedAt: 1_000 } });
  let calls = 0;
  const service = new DeviceFlowService({ clientId, store, now: () => 2_000, fetchImpl: async () => { calls += 1; } });
  await assert.rejects(() => service.poll('orphan'), error => error.code === 'device_flow_superseded');
  assert.equal(store.attempt, null);
  assert.equal(calls, 0);
});

test('a live initial Device Flow request survives concurrent resume and poll reads', async () => {
  const store = new MemoryAuthStore();
  let release;
  const service = new DeviceFlowService({
    clientId, store, now: () => 1_000, randomUUID: () => 'live-request',
    fetchImpl: async () => new Promise(resolve => { release = () => resolve(response(200, {
      device_code: 'device', user_code: 'ABCD-EFGH', verification_uri: 'https://github.com/login/device',
      expires_in: 900, interval: 5,
    })); }),
  });
  const start = service.start();
  while (store.attempt?.status !== 'requesting') await Promise.resolve();
  const resumed = await service.resume();
  const polled = await service.poll('live-request');
  assert.equal(resumed.status, 'requesting');
  assert.equal(polled.status, 'requesting');
  assert.equal(store.attempt.status, 'requesting');
  release();
  assert.equal((await start).status, 'pending');
  assert.equal(store.attempt.status, 'pending');
});

test('resumed token-received Device Flow refreshes an expired provisional pair before identity lookup', async () => {
  const store = new MemoryAuthStore({ attempt: {
    id: 'attempt-one', status: 'token_received', nextPollAt: 10_000, intervalMs: 5_000,
    provisionalAuth: {
      accessToken: 'expired-access', accessTokenExpiresAt: 9_000,
      refreshToken: 'valid-refresh', refreshTokenExpiresAt: 100_000,
    },
  } });
  const calls = [];
  const service = new DeviceFlowService({
    clientId, store, now: () => 10_000,
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      if (url.includes('/login/oauth/access_token')) return response(200, {
        access_token: 'rotated-access', expires_in: 28_800,
        refresh_token: 'rotated-refresh', refresh_token_expires_in: 15_552_000,
      });
      assert.equal(options.headers.Authorization, 'Bearer rotated-access');
      return response(200, { id: 123, login: 'alice' });
    },
  });
  assert.deepEqual(await service.poll('attempt-one'), { status: 'authorized', githubUserId: 123, githubLogin: 'alice' });
  assert.equal(calls.length, 2);
  assert.match(calls[0].options.body, /grant_type=refresh_token/);
  assert.equal(store.auth.accessToken, 'rotated-access');
  assert.equal(store.auth.refreshToken, 'rotated-refresh');
});

