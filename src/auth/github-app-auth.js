const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const USER_URL = 'https://api.github.com/user';
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
const DEFAULT_REFRESH_WINDOW_MS = 5 * 60 * 1000;

export class GitHubAppAuthError extends Error {
  constructor(message, code, status = 0) {
    super(message);
    this.name = 'GitHubAppAuthError';
    this.code = code;
    this.status = status;
  }
}

function requireClientId(clientId) {
  const value = String(clientId || '').trim();
  if (!value || value.length > 200) throw new GitHubAppAuthError('Clockoli GitHub App is not configured in this build.', 'github_app_unconfigured');
  return value;
}

function safeAttempt(attempt) {
  if (!attempt) return null;
  return {
    attemptId: attempt.id,
    userCode: attempt.userCode,
    verificationUri: attempt.verificationUri,
    expiresAt: attempt.expiresAt,
    status: attempt.status || 'pending',
    nextPollAt: attempt.nextPollAt,
  };
}

function finitePositive(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new GitHubAppAuthError(`GitHub returned an invalid ${label}.`, 'invalid_auth_response');
  return number;
}

async function jsonResponse(response) {
  try { return await response.json(); }
  catch { throw new GitHubAppAuthError('GitHub returned an unreadable authentication response.', 'invalid_auth_response', response?.status || 0); }
}

function oauthError(body, status = 0) {
  const code = String(body?.error || 'authentication_failed');
  if (code === 'access_denied') return new GitHubAppAuthError('GitHub authorization was denied.', 'auth_denied', status);
  if (code === 'expired_token') return new GitHubAppAuthError('The GitHub device code expired. Start again.', 'device_code_expired', status);
  if (code === 'incorrect_client_credentials' || code === 'incorrect_device_code') return new GitHubAppAuthError('GitHub rejected this Clockoli authorization attempt. Start again.', 'invalid_device_flow', status);
  if (code === 'unsupported_grant_type') return new GitHubAppAuthError('GitHub rejected the authorization grant.', 'invalid_device_flow', status);
  return new GitHubAppAuthError('GitHub authentication failed.', 'authentication_failed', status);
}

function tokenPair(body, now) {
  const accessToken = String(body?.access_token || '');
  const refreshToken = String(body?.refresh_token || '');
  if (!accessToken || !refreshToken) throw new GitHubAppAuthError('GitHub did not return a refreshable token pair.', 'invalid_auth_response');
  return {
    accessToken,
    accessTokenExpiresAt: now + finitePositive(body.expires_in, 'access-token expiration') * 1000,
    refreshToken,
    refreshTokenExpiresAt: now + finitePositive(body.refresh_token_expires_in, 'refresh-token expiration') * 1000,
  };
}

export class DeviceFlowService {
  constructor({
    clientId, store, fetchImpl = fetch, now = () => Date.now(), randomUUID = () => crypto.randomUUID(),
    controllers = new Map(), pollPromises = new Map(), requestingAttempts = new Set(),
  }) {
    this.clientId = requireClientId(clientId);
    this.store = store;
    this.fetchImpl = fetchImpl.bind(globalThis);
    this.now = now;
    this.randomUUID = randomUUID;
    this.controllers = controllers;
    this.pollPromises = pollPromises;
    this.requestingAttempts = requestingAttempts;
    this.startReservations = Promise.resolve();
  }

  superseded() {
    return new GitHubAppAuthError('This GitHub authorization attempt is no longer active.', 'device_flow_superseded');
  }

  async requestForAttempt(attemptId, url, options = {}) {
    const controller = new AbortController();
    this.controllers.set(attemptId, controller);
    try {
      return await this.fetchImpl(url, { ...options, signal: controller.signal });
    } catch (error) {
      if (error?.name === 'AbortError') throw this.superseded();
      throw error;
    } finally {
      if (this.controllers.get(attemptId) === controller) this.controllers.delete(attemptId);
    }
  }

  async replaceAttempt(attemptId, attempt) {
    if (!await this.store.replaceDeviceAttempt(attemptId, attempt)) throw this.superseded();
    return attempt;
  }

  async start() {
    const attemptId = this.randomUUID();
    this.requestingAttempts.add(attemptId);
    const reservation = this.startReservations.then(async () => {
      const previous = await this.store.getDeviceAttempt();
      if (previous?.id && previous.id !== attemptId) this.controllers.get(previous.id)?.abort();
      await this.store.saveDeviceAttempt({ id: attemptId, status: 'requesting', requestedAt: this.now() });
    });
    this.startReservations = reservation.catch(() => {});
    try {
      await reservation;
      const response = await this.requestForAttempt(attemptId, DEVICE_CODE_URL, {
        method: 'POST', cache: 'no-store',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: this.clientId }).toString(),
      });
      const body = await jsonResponse(response);
      if (!response.ok || body?.error) throw oauthError(body, response.status);
      const now = this.now();
      const intervalMs = finitePositive(body.interval, 'polling interval') * 1000;
      const attempt = {
        id: attemptId,
        deviceCode: String(body.device_code || ''),
        userCode: String(body.user_code || ''),
        verificationUri: String(body.verification_uri || ''),
        expiresAt: now + finitePositive(body.expires_in, 'device-code expiration') * 1000,
        intervalMs,
        nextPollAt: now + intervalMs,
        status: 'pending',
      };
      if (!attempt.deviceCode || !attempt.userCode || !attempt.verificationUri.startsWith('https://github.com/')) {
        throw new GitHubAppAuthError('GitHub returned an invalid Device Flow response.', 'invalid_auth_response');
      }
      await this.replaceAttempt(attemptId, attempt);
      return safeAttempt(attempt);
    } catch (error) {
      await this.store.clearDeviceAttempt(attemptId);
      throw error;
    } finally {
      this.requestingAttempts.delete(attemptId);
    }
  }

  async resume() {
    const attempt = await this.store.getDeviceAttempt();
    const completePending = attempt?.status === 'pending'
      && typeof attempt.deviceCode === 'string' && attempt.deviceCode
      && typeof attempt.userCode === 'string' && attempt.userCode
      && typeof attempt.verificationUri === 'string' && attempt.verificationUri.startsWith('https://github.com/')
      && Number.isFinite(attempt.expiresAt) && Number.isFinite(attempt.intervalMs) && Number.isFinite(attempt.nextPollAt);
    const completeProvisional = attempt?.status === 'token_received'
      && attempt.provisionalAuth?.accessToken && attempt.provisionalAuth?.refreshToken
      && Number.isFinite(attempt.nextPollAt);
    if (attempt?.status === 'requesting' && this.requestingAttempts.has(attempt.id)) {
      return safeAttempt({ ...attempt, nextPollAt: this.now() + 1_000 });
    }
    if (attempt && !completePending && !completeProvisional) {
      await this.store.clearDeviceAttempt(attempt.id);
      return null;
    }
    return safeAttempt(attempt);
  }

  async cancel(attemptId) {
    const id = String(attemptId || '');
    if (!id) return { cancelled: false };
    this.controllers.get(id)?.abort();
    return { cancelled: Boolean(await this.store.clearDeviceAttempt(id)) };
  }

  async refreshProvisional(attempt) {
    const auth = attempt.provisionalAuth, now = this.now();
    if (!auth?.refreshToken || Number(auth.refreshTokenExpiresAt) <= now) {
      throw new GitHubAppAuthError('GitHub authorization expired. Start again.', 'auth_expired');
    }
    const response = await this.requestForAttempt(attempt.id, TOKEN_URL, {
      method: 'POST', cache: 'no-store',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        grant_type: 'refresh_token',
        refresh_token: auth.refreshToken,
      }).toString(),
    });
    const body = await jsonResponse(response);
    if (!response.ok || body?.error) {
      const error = oauthError(body, response.status);
      error.code = 'auth_expired';
      throw error;
    }
    return this.replaceAttempt(attempt.id, { ...attempt, provisionalAuth: tokenPair(body, now) });
  }

  async finalize(attempt, { immediate = false } = {}) {
    const now = this.now();
    if (!immediate && now < attempt.nextPollAt) return safeAttempt(attempt);
    if (!immediate) {
      attempt = await this.replaceAttempt(attempt.id, { ...attempt, nextPollAt: now + attempt.intervalMs });
    }
    let pair = attempt.provisionalAuth, refreshed = false;
    if (!pair?.accessToken || !pair?.refreshToken) {
      throw new GitHubAppAuthError('GitHub authorization recovery data is invalid. Start again.', 'invalid_auth_response');
    }
    if (Number(pair.accessTokenExpiresAt) - now <= DEFAULT_REFRESH_WINDOW_MS) {
      attempt = await this.refreshProvisional(attempt);
      pair = attempt.provisionalAuth;
      refreshed = true;
    }
    const requestUser = () => this.requestForAttempt(attempt.id, USER_URL, {
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${pair.accessToken}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    let userResponse = await requestUser();
    if (userResponse.status === 401 && !refreshed) {
      attempt = await this.refreshProvisional(attempt);
      pair = attempt.provisionalAuth;
      refreshed = true;
      userResponse = await requestUser();
    }
    const user = await jsonResponse(userResponse);
    if (!userResponse.ok || !Number.isSafeInteger(user?.id) || user.id <= 0 || typeof user?.login !== 'string' || !user.login) {
      const code = userResponse.status === 401 ? 'auth_expired' : 'invalid_auth_response';
      throw new GitHubAppAuthError('GitHub authorized Clockoli but did not return a valid user identity.', code, userResponse.status);
    }
    const saved = await this.store.saveAuthorizedGitHubApp({
      mode: 'github_app', candidateId: attempt.id, githubUserId: user.id, githubLogin: user.login, ...pair,
    }, attempt.id);
    if (!saved) throw this.superseded();
    return { status: 'authorized', githubUserId: user.id, githubLogin: user.login };
  }

  async poll(attemptId) {
    const id = String(attemptId || '');
    if (this.pollPromises.has(id)) return this.pollPromises.get(id);
    const promise = this.pollOnce(id).finally(() => {
      if (this.pollPromises.get(id) === promise) this.pollPromises.delete(id);
    });
    this.pollPromises.set(id, promise);
    return promise;
  }

  async pollOnce(attemptId) {
    let attempt = await this.store.getDeviceAttempt();
    if (!attempt || attempt.id !== attemptId) throw this.superseded();
    const completePending = attempt.status === 'pending'
      && typeof attempt.deviceCode === 'string' && attempt.deviceCode
      && typeof attempt.userCode === 'string' && attempt.userCode
      && typeof attempt.verificationUri === 'string' && attempt.verificationUri.startsWith('https://github.com/')
      && Number.isFinite(attempt.expiresAt) && Number.isFinite(attempt.intervalMs) && Number.isFinite(attempt.nextPollAt);
    const completeProvisional = attempt.status === 'token_received'
      && attempt.provisionalAuth?.accessToken && attempt.provisionalAuth?.refreshToken
      && Number.isFinite(attempt.nextPollAt);
    if (attempt.status === 'requesting' && this.requestingAttempts.has(attempt.id)) {
      return safeAttempt({ ...attempt, nextPollAt: this.now() + 1_000 });
    }
    if (!completePending && !completeProvisional) {
      await this.store.clearDeviceAttempt(attempt.id);
      throw this.superseded();
    }
    const now = this.now();
    if (attempt.status === 'token_received') return this.finalize(attempt);
    if (now >= attempt.expiresAt) {
      await this.store.clearDeviceAttempt(attempt.id);
      throw new GitHubAppAuthError('The GitHub device code expired. Start again.', 'device_code_expired');
    }
    if (now < attempt.nextPollAt) return { ...safeAttempt(attempt), status: 'pending' };

    // Persist the next allowed poll before network I/O so worker restart or a lost
    // response cannot accidentally tighten GitHub's required interval.
    attempt = await this.replaceAttempt(attempt.id, { ...attempt, nextPollAt: now + attempt.intervalMs });
    const response = await this.requestForAttempt(attempt.id, TOKEN_URL, {
      method: 'POST', cache: 'no-store',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        device_code: attempt.deviceCode,
        grant_type: DEVICE_GRANT,
      }).toString(),
    });
    const body = await jsonResponse(response);
    if (body?.error === 'authorization_pending') return { ...safeAttempt(attempt), status: 'pending' };
    if (body?.error === 'slow_down') {
      attempt = await this.replaceAttempt(attempt.id, {
        ...attempt, intervalMs: attempt.intervalMs + 5_000, nextPollAt: now + attempt.intervalMs + 5_000,
      });
      return { ...safeAttempt(attempt), status: 'pending' };
    }
    if (!response.ok || body?.error) {
      const error = oauthError(body, response.status);
      if (['auth_denied', 'device_code_expired', 'invalid_device_flow'].includes(error.code)) await this.store.clearDeviceAttempt(attempt.id);
      throw error;
    }

    const pair = tokenPair(body, now);
    const { deviceCode: consumedDeviceCode, ...durableAttempt } = attempt;
    void consumedDeviceCode;
    attempt = await this.replaceAttempt(attempt.id, {
      ...durableAttempt,
      status: 'token_received',
      provisionalAuth: pair,
      nextPollAt: now + attempt.intervalMs,
    });
    return this.finalize(attempt, { immediate: true });
  }
}

export class CredentialBroker {
  constructor({ clientId, store, fetchImpl = fetch, now = () => Date.now(), refreshWindowMs = DEFAULT_REFRESH_WINDOW_MS }) {
    this.clientId = String(clientId || '').trim();
    this.store = store;
    this.fetchImpl = fetchImpl.bind(globalThis);
    this.now = now;
    this.refreshWindowMs = refreshWindowMs;
    this.refreshPromise = null;
  }

  async getAccessToken({ forceRefresh = false, rejectedToken = '' } = {}) {
    const snapshot = await this.store.getAuthSnapshot();
    const auth = snapshot.auth;
    if (!auth?.accessToken) throw new GitHubAppAuthError('Connect Clockoli to GitHub.', 'auth_required');
    if (auth.mode === 'pat') return auth.accessToken;
    if (auth.mode !== 'github_app') throw new GitHubAppAuthError('Clockoli authentication is invalid.', 'auth_required');
    if (forceRefresh && rejectedToken && rejectedToken !== auth.accessToken) return auth.accessToken;
    if (!forceRefresh && Number(auth.accessTokenExpiresAt) - this.now() > this.refreshWindowMs) return auth.accessToken;
    if (!this.refreshPromise) {
      this.refreshPromise = this.refresh(snapshot).finally(() => { this.refreshPromise = null; });
    }
    return this.refreshPromise;
  }

  async refresh(snapshot) {
    const auth = snapshot.auth, now = this.now();
    if (!auth?.refreshToken || Number(auth.refreshTokenExpiresAt) <= now) {
      throw new GitHubAppAuthError('Clockoli needs to reconnect to GitHub.', 'auth_expired');
    }
    const clientId = requireClientId(this.clientId);
    const response = await this.fetchImpl(TOKEN_URL, {
      method: 'POST', cache: 'no-store',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        grant_type: 'refresh_token',
        refresh_token: auth.refreshToken,
      }).toString(),
    });
    const body = await jsonResponse(response);
    if (!response.ok || body?.error) {
      const error = oauthError(body, response.status);
      if (['authentication_failed', 'invalid_device_flow'].includes(error.code)) error.code = 'auth_expired';
      throw error;
    }
    const next = { ...auth, ...tokenPair(body, now) };
    delete next.generation;
    const saved = await this.store.rotateGitHubAppAuth(
      snapshot.authGeneration,
      snapshot.configurationGeneration,
      next,
    );
    if (saved) return next.accessToken;

    const current = await this.store.getAuthSnapshot();
    if (current.auth?.mode === 'github_app' && current.auth.accessToken !== auth.accessToken) return current.auth.accessToken;
    throw new GitHubAppAuthError('Authentication changed while GitHub credentials were refreshing.', 'auth_superseded');
  }
}
