import { GitHubClient } from '../api/github-client.js';
import { CredentialBroker, DeviceFlowService } from '../auth/github-app-auth.js';
import {
  GITHUB_APP_CLIENT_ID, githubAppInstallationUrl,
  GITHUB_AUTHORIZATIONS_URL, GITHUB_NEW_REPOSITORY_URL,
} from '../config/github-app.js';
import { activeRecordPath } from '../domain/work-records.js';
import { aggregateTrackedTasks } from '../domain/tasks.js';
import { ChromeStore } from '../storage/chrome-store.js';
import { TrackerService } from '../services/tracker.js';
import { ConfigurationService } from '../services/configuration.js';
import { ReportService } from '../services/reports.js';
import { ExchangeRateService } from '../services/exchange-rates.js';
import { TaskMetadataService } from '../services/task-metadata.js';
import { InstallationDiscoveryService, RepositoryInitializer } from '../services/github-app-onboarding.js';
import { OnboardingCoordinator } from '../services/onboarding-coordinator.js';
import { withRepositoryRecovery } from '../services/repository-operation-recovery.js';
import { assertMessageAllowed, taskUrlForStart } from './message-policy.js';
import { SerialExecutor } from './serial-executor.js';
import { ConfigurationLoadCoordinator, finalizeTaskLoad, refreshTaskState } from './task-load.js';

const store = new ChromeStore();
const executor = new SerialExecutor();
const acceptanceExecutor = new SerialExecutor();
const loadCoordinator = new ConfigurationLoadCoordinator(executor);
const reportLoads = new Map();
const currentCredentialProvider = new CredentialBroker({ clientId: GITHUB_APP_CLIENT_ID, store });
const configuration = new ConfigurationService({
  store,
  credentialProvider: currentCredentialProvider,
  githubFactory: options => new GitHubClient(options),
});
const pendingCredentialStore = {
  getAuthSnapshot: () => store.getPendingAuthSnapshot(),
  rotateGitHubAppAuth: (...args) => store.rotatePendingGitHubAppAuth(...args),
};
const pendingCredentialProvider = new CredentialBroker({ clientId: GITHUB_APP_CLIENT_ID, store: pendingCredentialStore });

function isNotFound(error) { return error?.status === 404 || error?.code === 'not_found'; }

function githubForConfig(config) {
  return new GitHubClient({
    credentialProvider: currentCredentialProvider,
    owner: config.owner, repo: config.repo, branch: config.branch || 'main',
    expectedRepositoryId: config.repoId || null,
    branchMode: config.branchMode || 'custom',
  });
}

async function remoteActiveProbe({ config, auth, state }) {
  const user = config.storageLogin || state.user || auth.githubLogin;
  if (!user) return false;
  const github = githubForConfig(config);
  try { await github.getText(activeRecordPath(user)); return true; }
  catch (error) {
    if (!isNotFound(error)) throw error;
    await github.assertDestinationReachable();
    return false;
  }
}

const onboarding = new OnboardingCoordinator({
  store,
  currentCredentialProvider,
  pendingCredentialProvider,
  githubFactory: options => new GitHubClient(options),
  discoveryFactory: ({ credentialProvider }) => new InstallationDiscoveryService({
    github: new GitHubClient({ credentialProvider }),
  }),
  initializerFactory: ({ github }) => new RepositoryInitializer({ github }),
  activeProbe: remoteActiveProbe,
});

function serializeError(error) {
  return { message: error?.message || 'Unexpected error', code: error?.code || 'error', status: error?.status || 0 };
}

function authSummary(auth) {
  if (!auth) return null;
  return {
    mode: auth.mode,
    ...(auth.githubUserId ? { githubUserId: auth.githubUserId } : {}),
    ...(auth.githubLogin ? { githubLogin: auth.githubLogin } : {}),
    ...(auth.accessTokenExpiresAt ? { accessTokenExpiresAt: auth.accessTokenExpiresAt } : {}),
    ...(auth.refreshTokenExpiresAt ? { refreshTokenExpiresAt: auth.refreshTokenExpiresAt } : {}),
  };
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

async function configuredSnapshot() {
  await store.migrateLegacyPatAuth();
  await configuration.ensureRepositoryIdentity();
  await configuration.ensurePersonalStorageBranch();
  const [configurationSnapshot, authSnapshot] = await Promise.all([
    store.getConfigurationSnapshot(), store.getAuthSnapshot(),
  ]);
  return { ...configurationSnapshot, auth: authSnapshot.auth, authGeneration: authSnapshot.authGeneration };
}

async function onboardingState() {
  await store.migrateLegacyPatAuth();
  await configuration.ensurePersonalStorageBranch();
  const [configurationSnapshot, current, pending, attempt, state, verification] = await Promise.all([
    store.getConfigurationSnapshot(), store.getAuthSnapshot(), store.getPendingAuthSnapshot(),
    deviceFlow().resume(), store.getState(), store.getOnboardingVerification(),
  ]);
  const ready = Boolean(configurationSnapshot.config && current.auth);
  return {
    appConfigured: Boolean(GITHUB_APP_CLIENT_ID),
    ready,
    auth: authSummary(current.auth),
    candidateAuth: authSummary(pending.auth),
    deviceAttempt: safeAttempt(attempt),
    config: configurationSnapshot.config,
    trackingRepositoryUrl: configurationSnapshot.config ? `https://github.com/${encodeURIComponent(configurationSnapshot.config.owner)}/${encodeURIComponent(configurationSnapshot.config.repo)}` : '',
    lastVerifiedAt: verification.lastVerifiedAt,
    verificationStatus: ['write_verified', 'access_checked'].includes(verification.status) ? verification.status : null,
    active: Boolean(state.activeCache),
    pendingCount: (state.pendingWrites || []).length,
    installationUrl: githubAppInstallationUrl(),
    authorizationSettingsUrl: GITHUB_AUTHORIZATIONS_URL,
    newRepositoryUrl: GITHUB_NEW_REPOSITORY_URL,
  };
}

async function checkCurrentRepositoryAccess() {
  let snapshot = await configuredSnapshot();
  if (!snapshot.config || !snapshot.auth) throw new Error('Connect GitHub before checking repository access.');
  if (snapshot.auth.mode === 'github_app' && snapshot.config.repoId) {
    await onboarding.recoverCurrentRepository();
    snapshot = await configuredSnapshot();
  }
  const repository = await githubForConfig(snapshot.config).assertDestinationReachable();
  const lastVerifiedAt = new Date().toISOString();
  await store.patchState({
    onboardingLastVerifiedAt: lastVerifiedAt,
    onboardingVerificationStatus: 'access_checked',
  });
  return {
    config: snapshot.config,
    repository: { id: repository.id, fullName: repository.full_name },
    lastVerifiedAt,
    verificationStatus: 'access_checked',
  };
}

async function context() {
  const snapshot = await configuredSnapshot();
  const { config, auth } = snapshot;
  if (!config || !auth) throw new Error('Connect GitHub and choose a private time-data repository in Settings.');
  const github = githubForConfig(config);
  const localState = await store.ensureDataVersion(4);
  let user = config.storageLogin || localState.user;
  if (!user) {
    user = auth.githubLogin || await github.getAuthenticatedUser();
    await store.patchState({ user });
  }
  return {
    config,
    reports: new ReportService({ github, cache: store }),
    tracker: new TrackerService({ github, store, user, actorId: Number.isSafeInteger(auth.githubUserId) ? `github:${auth.githubUserId}` : `clockoli:${config.repoId}:${user}`, actorName: user, recentDays: config.recentDays || 7 }),
  };
}

function emitReportProgress(requestId, progress) {
  if (!requestId) return;
  try { chrome.runtime.sendMessage({ type: 'REPORT_PROGRESS', requestId, ...progress }, () => void chrome.runtime.lastError); } catch {}
}

async function loadExchangeRates(message) {
  const payload = message.payload || {};
  emitReportProgress(payload.requestId, { label: 'Loading exchange rates from Frankfurter…', value: 85 });
  const service = new ExchangeRateService({ cache: store });
  const result = await service.ratesForDates(payload);
  emitReportProgress(payload.requestId, { label: 'Applying exchange rates…', value: 95 });
  return result;
}

async function loadReport(message) {
  const loadEpoch = await loadCoordinator.beginLoad();
  await store.ensureDataVersion(4);
  loadCoordinator.assertCurrent(loadEpoch);
  const { config, auth } = await configuredSnapshot();
  loadCoordinator.assertCurrent(loadEpoch);
  if (!config || !auth) return { configured: false, records: [] };
  const branch = config.branch || 'main';
  const repositoryKey = `${config.owner}/${config.repo}@${branch}`;
  const loadKey = `${repositoryKey}:reports`;
  const previous = reportLoads.get(loadKey);
  if (previous) {
    previous.controller.abort();
    await previous.promise.catch(() => {});
    loadCoordinator.assertCurrent(loadEpoch);
  }
  const controller = new AbortController();
  const github = githubForConfig(config);
  const reports = new ReportService({ github, cache: store, onProgress: progress => emitReportProgress(message.payload?.requestId, progress) });
  const promise = (async () => {
    controller.signal.throwIfAborted();
    loadCoordinator.assertCurrent(loadEpoch);
    const localState = await store.getState();
    return {
      configured: true, sourceRepository: `${config.owner}/${config.repo}`, branch,
      currentUser: config.storageLogin || localState.user || auth.githubLogin || '',
      records: await reports.loadRepositoryRange(message.payload || {}, { defaultBranch: config.defaultBranch || branch, signal: controller.signal }),
      billing: await store.getLocalPreferences(),
    };
  })();
  reportLoads.set(loadKey, { controller, promise });
  try { return await promise; }
  finally { if (reportLoads.get(loadKey)?.promise === promise) reportLoads.delete(loadKey); }
}

async function loadTimes(message, sender) {
  const loadEpoch = await loadCoordinator.beginLoad();
  await store.ensureDataVersion(4); loadCoordinator.assertCurrent(loadEpoch);
  const { config, auth, generation } = await configuredSnapshot(); loadCoordinator.assertCurrent(loadEpoch);
  if (!config || !auth) return { configured: false, recent: [] };
  const branch = config.branch || 'main', repositoryKey = `${config.owner}/${config.repo}@${branch}`;
  const requestOwner = sender?.documentId ?? sender?.tab?.id ?? sender?.url ?? 'extension';
  const loadKey = `${repositoryKey}:times:${requestOwner}`;
  const previous = reportLoads.get(loadKey);
  if (previous) {
    previous.controller.abort();
    await previous.promise.catch(() => {});
    loadCoordinator.assertCurrent(loadEpoch);
  }
  const controller = new AbortController(), github = githubForConfig(config);
  const promise = (async () => {
    controller.signal.throwIfAborted(); loadCoordinator.assertCurrent(loadEpoch);
    const state = await store.getState();
    let user = config.storageLogin || state.user || auth.githubLogin;
    if (!user) {
      user = await github.getAuthenticatedUser(); controller.signal.throwIfAborted();
      if (!await store.patchStateIfGeneration({ user }, generation)) throw new DOMException('Time load was superseded by a configuration change.', 'AbortError');
    }
    const reports = new ReportService({ github, cache: store, onProgress: progress => emitReportProgress(message.payload?.requestId, progress) });
    const recent = await reports.loadUserRange(message.payload || {}, user, { includeStorageMetadata: true, signal: controller.signal }, {
      maxFiles: 120, maxBytes: 100 * 1024 * 1024, maxRecords: 500000,
    });
    controller.signal.throwIfAborted(); loadCoordinator.assertCurrent(loadEpoch);
    return { configured: true, recent: recent.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt)) };
  })();
  reportLoads.set(loadKey, { controller, promise });
  try { return await promise; }
  finally { if (reportLoads.get(loadKey)?.promise === promise) reportLoads.delete(loadKey); }
}

async function loadTasks(message, sender) {
  const loadEpoch = await loadCoordinator.beginLoad();
  await store.ensureDataVersion(4);
  loadCoordinator.assertCurrent(loadEpoch);
  const snapshot = await configuredSnapshot();
  const { config, auth, generation } = snapshot;
  loadCoordinator.assertCurrent(loadEpoch);
  if (!config || !auth) return { configured: false, tasks: [], active: null, pendingWrites: [] };
  const branch = config.branch || 'main';
  const repositoryKey = `${config.owner}/${config.repo}@${branch}`;
  const requestOwner = sender?.tab?.id ?? sender?.url ?? 'extension';
  const loadKey = `${repositoryKey}:tasks:${requestOwner}`;
  const previous = reportLoads.get(loadKey);
  if (previous) {
    previous.controller.abort();
    await previous.promise.catch(() => {});
    loadCoordinator.assertCurrent(loadEpoch);
  }
  const controller = new AbortController();
  const github = githubForConfig(config);
  const reports = new ReportService({ github, cache: store, onProgress: progress => emitReportProgress(message.payload?.requestId, progress) });
  const loadGuard = { signal: controller.signal, assertCurrent: () => loadCoordinator.assertCurrent(loadEpoch) };
  const promise = (async () => {
    let { user } = await store.getState();
    user = config.storageLogin || user;
    controller.signal.throwIfAborted();
    loadCoordinator.assertCurrent(loadEpoch);
    if (!user) {
      user = auth.githubLogin || await github.getAuthenticatedUser();
      const saved = await store.patchStateIfGeneration({ user }, generation);
      if (!saved) throw new DOMException('Task load was superseded by a configuration change.', 'AbortError');
      controller.signal.throwIfAborted();
      loadCoordinator.assertCurrent(loadEpoch);
    }
    const tracker = new TrackerService({ github, store, user, actorId: Number.isSafeInteger(auth.githubUserId) ? `github:${auth.githubUserId}` : `clockoli:${config.repoId}:${user}`, actorName: user, recentDays: config.recentDays || 7 });
    const initialTimerState = await refreshTaskState(executor, store, tracker, generation, loadGuard);
    controller.signal.throwIfAborted();
    loadCoordinator.assertCurrent(loadEpoch);
    const records = await reports.loadUserRange(message.payload || {}, user, { signal: controller.signal });
    const issueValues = records.flatMap(record => record.issue ? [record.issue] : []);
    if (initialTimerState.active?.issue) issueValues.push(initialTimerState.active.issue);
    let issues = [...new Map(issueValues.map(issue => [issue.url, issue])).values()];
    const metadataService = new TaskMetadataService({
      github, cache: store, configurationGeneration: generation,
      scopeKey: `${repositoryKey}:${user}:g${generation}`,
    });
    let metadata = await metadataService.load(issues, { signal: controller.signal });
    controller.signal.throwIfAborted();
    loadCoordinator.assertCurrent(loadEpoch);
    let timerState = await finalizeTaskLoad(executor, store, tracker, generation, loadGuard);
    if (timerState.active?.issue && !metadata.has(timerState.active.issue.url)) {
      issues = [...new Map([...issues, timerState.active.issue].map(issue => [issue.url, issue])).values()];
      metadata = await metadataService.load(issues, { signal: controller.signal });
      controller.signal.throwIfAborted();
      loadCoordinator.assertCurrent(loadEpoch);
      timerState = await finalizeTaskLoad(executor, store, tracker, generation, loadGuard);
    }
    return {
      configured: true, sourceRepository: `${config.owner}/${config.repo}`, branch,
      tasks: aggregateTrackedTasks(records, {
        user, metadata, active: timerState.active, pendingWrites: timerState.pendingWrites,
        startDate: message.payload?.startDate, endDate: message.payload?.endDate,
      }),
      active: timerState.active,
      pendingWrites: timerState.pendingWrites,
    };
  })();
  reportLoads.set(loadKey, { controller, promise });
  try { return await promise; }
  finally { if (reportLoads.get(loadKey)?.promise === promise) reportLoads.delete(loadKey); }
}

async function cancelReports(channel = null) {
  const active = [...reportLoads.entries()]
    .filter(([key]) => !channel || key.endsWith(`:${channel}`))
    .map(([, value]) => value);
  for (const { controller } of active) controller.abort();
  await Promise.allSettled(active.map(({ promise }) => promise));
}

let activeDeviceFlow = null;
function deviceFlow() {
  activeDeviceFlow ||= new DeviceFlowService({ clientId: GITHUB_APP_CLIENT_ID, store });
  return activeDeviceFlow;
}

const DIRECT_DEVICE_FLOW_MESSAGES = new Set([
  'START_DEVICE_FLOW', 'OPEN_DEVICE_FLOW_PAGE', 'POLL_DEVICE_FLOW', 'CANCEL_DEVICE_FLOW', 'CANCEL_GITHUB_APP_SETUP',
]);

const RECOVERABLE_REPOSITORY_MESSAGES = new Set([
  'LOAD_REPORT', 'LOAD_TASKS', 'LOAD_TIMES', 'GET_STATE', 'GET_PAGE_STATE', 'START', 'SWITCH_TASK', 'STOP', 'SYNC',
  'LOAD_RECENT', 'BULK_ADD_TIMES', 'EDIT_ENTRIES', 'DELETE_ENTRY', 'RESOLVE_PENDING',
]);

async function withCurrentRepositoryRecovery(message, operation) {
  if (!RECOVERABLE_REPOSITORY_MESSAGES.has(message?.type)) return operation();
  const baseline = await configuredSnapshot();
  if (baseline.auth?.mode !== 'github_app' || !baseline.config?.repoId) return operation();
  return withRepositoryRecovery(operation, {
    shouldRecover: async () => true,
    recover: async () => {
      let recovered = false;
      await loadCoordinator.save(() => cancelReports(), async () => {
        const latest = await configuredSnapshot();
        if (latest.auth?.mode === 'github_app' && latest.config?.repoId === baseline.config.repoId
            && latest.generation !== baseline.generation) {
          recovered = true;
          return;
        }
        const result = await onboarding.recoverCurrentRepository();
        recovered = result.recovered === true;
      });
      return recovered;
    },
  });
}

async function handle(message, sender) {
  if (!message || typeof message.type !== 'string') throw new Error('Invalid extension message');
  const extensionOrigin = chrome.runtime.getURL('');
  assertMessageAllowed(message.type, sender, extensionOrigin);
  if (message.type === 'OPEN_OPTIONS') { await chrome.runtime.openOptionsPage(); return { ok: true }; }
  if (message.type === 'OPEN_REPORTS') {
    await chrome.tabs.create({ url: chrome.runtime.getURL('src/reports/reports.html') }); return { ok: true };
  }
  if (message.type === 'OPEN_TASKS') {
    await chrome.tabs.create({ url: chrome.runtime.getURL('src/tasks/tasks.html') }); return { ok: true };
  }
  if (message.type === 'OPEN_TIMES') {
    await chrome.tabs.create({ url: chrome.runtime.getURL('src/times/times.html') }); return { ok: true };
  }
  if (message.type === 'GET_ONBOARDING_STATE') return onboardingState();
  if (message.type === 'START_DEVICE_FLOW') return deviceFlow().start();
  if (message.type === 'OPEN_DEVICE_FLOW_PAGE') {
    const attempt = await deviceFlow().resume();
    if (!attempt || attempt.attemptId !== String(message.attemptId || '')) throw new Error('The Device activation attempt is no longer available.');
    const url = new URL(attempt.verificationUri);
    if (url.protocol !== 'https:' || url.hostname !== 'github.com') throw new Error('GitHub returned an invalid Device activation URL.');
    await chrome.tabs.create({ url: url.href });
    return { opened: true };
  }
  if (message.type === 'RESUME_DEVICE_FLOW') return deviceFlow().resume();
  if (message.type === 'POLL_DEVICE_FLOW') return deviceFlow().poll(String(message.attemptId || ''));
  if (message.type === 'CANCEL_DEVICE_FLOW') return deviceFlow().cancel(String(message.attemptId || ''));
  if (message.type === 'CANCEL_GITHUB_APP_SETUP') {
    const attempt = await store.getDeviceAttempt();
    if (attempt?.id) await deviceFlow().cancel(attempt.id);
    await store.clearPendingGitHubAppAuth();
    return { cancelled: true };
  }
  if (message.type === 'DISCOVER_REPOSITORIES') return onboarding.discover();
  if (message.type === 'CHECK_REPOSITORY_ACCESS') return checkCurrentRepositoryAccess();
  if (message.type === 'SELECT_REPOSITORY') return onboarding.selectRepository(message.payload);
  if (message.type === 'DISCONNECT_GITHUB_APP') return onboarding.disconnect();
  if (message.type === 'CLEAR_LOCAL_CONFIGURATION') return onboarding.clearLocalConfiguration();
  if (message.type === 'SAVE_CONFIG') {
    await store.ensureDataVersion(4);
    return configuration.save(message.payload);
  }
  if (message.type === 'UPDATE_DISPLAY_PREFERENCES') {
    const generation = await store.updateDisplayPreferences(message.payload || {});
    const { config } = await store.getConfigurationSnapshot();
    return { config, generation, preferences: await store.getLocalPreferences() };
  }
  if (message.type === 'GET_LOCAL_PREFERENCES') return store.getLocalPreferences();
  if (message.type === 'SAVE_BILLING_SETTINGS') return store.saveBillingSettings(message.payload || {});
  if (message.type === 'EXPORT_SETTINGS') return store.exportSettings();
  if (message.type === 'MARK_SETTINGS_EXPORTED') return { marked: await store.markSettingsExported(message.revision) };
  if (message.type === 'IMPORT_SETTINGS') {
    const text = String(message.text || '');
    if (new TextEncoder().encode(text).byteLength > 262_144) throw new Error('Settings file is too large.');
    return store.importSettings(text);
  }
  if (message.type === 'CANCEL_REPORT') { await cancelReports('reports'); return { cancelled: true }; }
  if (message.type === 'LOAD_REPORT') return loadReport(message);
  if (message.type === 'GET_EXCHANGE_RATES') return loadExchangeRates(message);
  if (message.type === 'LOAD_TASKS') return loadTasks(message, sender);
  if (message.type === 'LOAD_TIMES') return loadTimes(message, sender);
  if (message.type === 'GET_STATE' || message.type === 'GET_PAGE_STATE') {
    const { config, auth } = await configuredSnapshot();
    if (!config || !auth) return message.type === 'GET_PAGE_STATE'
      ? { configured: false, active: null, pendingCount: 0, recent: [] }
      : { configured: false, active: null, recent: [], pendingWrites: [] };
    const { tracker } = await context();
    const state = await tracker.getState({ refresh: Boolean(message.refresh) });
    if (message.type === 'GET_PAGE_STATE') {
      const active = state.active ? {
        taskUrl: state.active.taskUrl || state.active.issue?.url, taskTitle: state.active.taskTitle ?? state.active.issueTitle ?? '',
        ...(state.active.issue ? { issue: state.active.issue } : {}), startedAt: state.active.startedAt,
        entryDate: state.active.entryDate, timezone: state.active.timezone,
        description: state.active.description || '', issueTitle: state.active.taskTitle ?? state.active.issueTitle ?? '',
        _pending: Boolean(state.active._pending),
      } : null;
      return {
        configured: true, active, recent: state.recent,
        pendingCount: state.pendingWrites.length,
        pendingWrites: state.pendingWrites.map(({ id, status, stage, conflictReason }) => ({ id, status, stage, ...(conflictReason ? { conflictReason } : {}) })),
      };
    }
    return { configured: true, ...state };
  }
  const { tracker } = await context();
  switch (message.type) {
    case 'START': {
      const result = await tracker.start(taskUrlForStart(message.taskUrl ?? message.issue, sender, extensionOrigin), message.taskTitle ?? message.issueTitle ?? '', message.description || '', { background: true });
      if (result._pending) requestPendingSync();
      return result;
    }
    case 'SWITCH_TASK': {
      const result = await tracker.switchTask(taskUrlForStart(message.taskUrl ?? message.issue, sender, extensionOrigin), message.taskTitle ?? message.issueTitle ?? '', message.description || '', { background: true });
      if (result.pending) requestPendingSync();
      return result;
    }
    case 'STOP': {
      const result = await tracker.stop(message.description || '', { background: true });
      if (result.pending) requestPendingSync();
      return result;
    }
    case 'SYNC': return tracker.syncPending();
    case 'LOAD_RECENT': {
      if (!message.menuData) return tracker.loadRecent(50);
      const knownTitles = new Map();
      if ((message.taskUrl || message.issue) && (message.taskTitle || message.issueTitle)) {
        const taskUrl = taskUrlForStart(message.taskUrl ?? message.issue, sender, extensionOrigin);
        const title = String(message.taskTitle ?? message.issueTitle).replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, 300);
        if (title) knownTitles.set(taskUrl, title);
      }
      return tracker.loadMenuData(50, { knownTitles });
    }
    case 'EDIT_ENTRIES': return tracker.editEntries(message.payload);
    case 'BULK_ADD_TIMES': {
      const text = String(message.text || '');
      if (new TextEncoder().encode(text).byteLength > 262_144) throw new Error('Bulk input is too large.');
      return tracker.bulkAddTimes(text);
    }
    case 'DELETE_ENTRY': return tracker.deleteEntry(message.payload);
    case 'RESOLVE_PENDING': {
      const result = await tracker.resolvePendingConflict(message.id, message.action || '');
      requestPendingSync();
      return result;
    }
    default: throw new Error('Unknown extension message');
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const reportReadOnly = ['LOAD_REPORT', 'CANCEL_REPORT', 'GET_EXCHANGE_RATES'].includes(message?.type);
  const localStateRead = ['GET_STATE', 'GET_PAGE_STATE'].includes(message?.type) && !message?.refresh;
  const readOnly = reportReadOnly || localStateRead || ['LOAD_TASKS', 'LOAD_TIMES', 'GET_ONBOARDING_STATE', 'RESUME_DEVICE_FLOW', 'DISCOVER_REPOSITORIES'].includes(message?.type);
  const changesConfiguration = ['SAVE_CONFIG', 'UPDATE_DISPLAY_PREFERENCES', 'IMPORT_SETTINGS', 'CHECK_REPOSITORY_ACCESS', 'SELECT_REPOSITORY', 'DISCONNECT_GITHUB_APP', 'CLEAR_LOCAL_CONFIGURATION'].includes(message?.type);
  let operation;
  if (changesConfiguration) {
    try {
      assertMessageAllowed(message.type, sender, chrome.runtime.getURL(''));
      operation = acceptanceExecutor.run(() => loadCoordinator.save(() => cancelReports(), () => handle(message, sender)));
    } catch (error) { operation = Promise.reject(error); }
  } else {
    const direct = readOnly || DIRECT_DEVICE_FLOW_MESSAGES.has(message?.type);
    const acceptsLocally = ['START', 'STOP', 'SWITCH_TASK'].includes(message?.type);
    const attempt = () => direct ? handle(message, sender)
      : acceptsLocally ? acceptanceExecutor.run(() => handle(message, sender))
        : executor.run(() => handle(message, sender));
    operation = withCurrentRepositoryRecovery(message, attempt);
  }
  operation.then(data => sendResponse({ ok: true, data })).catch(error => sendResponse({ ok: false, error: serializeError(error) }));
  return true;
});

let pendingSync = null;
function hasRunnablePending(queue) { return Boolean(queue?.length && queue[0].status !== 'conflict'); }
function syncPendingNow() {
  if (pendingSync) return pendingSync;
  pendingSync = withCurrentRepositoryRecovery({ type: 'SYNC' }, () => executor.run(async () => {
    const state = await store.ensureDataVersion(4);
    if (!(state.pendingWrites ?? []).length) return;
    const { tracker } = await context();
    await tracker.syncPending();
    const latest = await store.getState();
    if (hasRunnablePending(latest.pendingWrites)) {
      chrome.alarms.create('sync-pending-now', { when: Date.now() + 5_000 });
    }
  })).catch(async error => {
    const latest = await store.getState().catch(() => null);
    if (hasRunnablePending(latest?.pendingWrites)) {
      chrome.alarms.create('sync-pending-now', { when: Date.now() + 5_000 });
    }
    throw error;
  }).finally(() => { pendingSync = null; });
  return pendingSync;
}

function requestPendingSync() {
  chrome.alarms.create('sync-pending-now', { when: Date.now() + 250 });
  void syncPendingNow().catch(() => {});
}

function scheduleSync() {
  chrome.alarms.create('sync-pending', { periodInMinutes: 1 });
  void store.migrateLegacyPatAuth().catch(() => {});
  void syncPendingNow().catch(() => {});
}

chrome.runtime.onInstalled.addListener(details => {
  scheduleSync();
  if (details.reason === 'install') void chrome.runtime.openOptionsPage();
});
chrome.runtime.onStartup.addListener(scheduleSync);
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'sync-pending' || alarm.name === 'sync-pending-now') void syncPendingNow().catch(() => {});
});

scheduleSync();
