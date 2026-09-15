import { GitHubClient } from '../api/github-client.js';
import { CredentialBroker, DeviceFlowService } from '../auth/github-app-auth.js';
import {
  GITHUB_APP_CLIENT_ID, githubAppInstallationUrl,
  GITHUB_AUTHORIZATIONS_URL, GITHUB_NEW_REPOSITORY_URL, GITHUB_NEW_ORGANIZATION_REPOSITORY_URL,
} from '../config/github-app.js';
import { activeRecordPath } from '../domain/work-records.js';
import { createUlid } from '../domain/ulid.js';
import { taskUrlOf } from '../domain/values.js';
import { aggregateTaskParticipants, aggregateTrackedTasks } from '../domain/tasks.js';
import { ChromeStore } from '../storage/chrome-store.js';
import { TrackerService } from '../services/tracker.js';
import { ConfigurationService } from '../services/configuration.js';
import { annotateDestinationRecord, loadDestinationRecords, mergeDestinationTaskSummaries, ReportService, withoutInternalMetadata } from '../services/reports.js';
import { ExchangeRateService } from '../services/exchange-rates.js';
import { TaskMetadataService } from '../services/task-metadata.js';
import { InstallationDiscoveryService, RepositoryInitializer } from '../services/github-app-onboarding.js';
import { OnboardingCoordinator } from '../services/onboarding-coordinator.js';
import { withRepositoryRecovery } from '../services/repository-operation-recovery.js';
import { assertMessageAllowed, destinationIdForCompletedMutation, taskUrlForParticipantLoad, taskUrlForStart, taskUrlForTimelineSwitch } from './message-policy.js';
import { activeDestinationId, requireConfiguredDestinationId, resolveStartDestinationId, selectReadDestinations, syncPendingAll } from './destination-runtime.js';
import { SerialExecutor } from './serial-executor.js';
import { ConfigurationLoadCoordinator, finalizeTaskLoad, refreshTaskState } from './task-load.js';

const store = new ChromeStore();
const executor = new SerialExecutor();
const acceptanceExecutor = new SerialExecutor();
const loadCoordinator = new ConfigurationLoadCoordinator(executor);
const reportLoads = new Map();
const destinationValidationCache = new Map();
const STATIC_ACTION_ICON = { 16: 'src/assets/clockoli-16.png', 32: 'src/assets/clockoli-32.png' };
const ACTION_ICON_FRAMES = 8;
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
    validationCache: destinationValidationCache,
  });
}

async function remoteActiveProbe({ config, auth, state, credentialProvider = currentCredentialProvider }) {
  const user = config.storageLogin || state.user || auth.githubLogin;
  if (!user) return false;
  const github = new GitHubClient({
    credentialProvider,
    owner: config.owner, repo: config.repo, branch: config.branch || 'main',
    expectedRepositoryId: config.repoId || null,
    branchMode: config.branchMode || 'custom',
  });
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

function serializeError(error, message) {
  return {
    message: error?.message || 'Unexpected error',
    code: error?.name === 'AbortError' ? 'aborted' : error?.code || 'error',
    status: error?.status || 0,
    ...(error?.retryAt ? { retryAt: error.retryAt } : {}),
    recovery: READ_RETRY_MESSAGES.has(message?.type) ? 'read-retry' : 'mutation-recovery',
  };
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

async function configuredSnapshot({ localOnly = false, destinationId = null } = {}) {
  await store.migrateLegacyPatAuth();
  await store.ensureDataVersion(5);
  if (!localOnly) {
    await configuration.ensureRepositoryIdentity();
    await configuration.ensurePersonalStorageBranch();
  }
  const [configurationSnapshot, authSnapshot] = await Promise.all([
    store.getConfigurationSnapshot(destinationId), store.getAuthSnapshot(),
  ]);
  return { ...configurationSnapshot, auth: authSnapshot.auth, authGeneration: authSnapshot.authGeneration };
}

async function onboardingState() {
  await store.migrateLegacyPatAuth();
  await store.ensureDataVersion(5);
  const [configurationSnapshot, current, pending, attempt, tracking, verification] = await Promise.all([
    store.getConfigurationSnapshot(), store.getAuthSnapshot(), store.getPendingAuthSnapshot(),
    deviceFlow().resume(), store.getTrackingSnapshot(), store.getRepositoryVerificationMap(),
  ]);
  const registry = configurationSnapshot.registry ?? { version: 1, defaultDestinationId: null, destinations: {} };
  const destinations = Object.entries(registry.destinations ?? {}).map(([id, config]) => ({
    id, owner: config.owner, ownerType: config.ownerType || 'User', repo: config.repo,
    label: config.label || `${config.owner}/${config.repo}`,
    branch: config.branch || 'main', defaultBranch: config.defaultBranch || 'main',
    storageLogin: config.storageLogin || '', installationId: config.installationId || null,
    repositoryFormatVersion: config.repositoryFormatVersion || null,
    default: registry.defaultDestinationId === id,
    active: tracking.activeTimer?.destinationId === id,
    pendingCount: tracking.destinationStates?.entries?.[id]?.pendingWrites?.length || 0,
    lastVerifiedAt: verification[id]?.lastVerifiedAt ?? null,
    verificationStatus: ['write_verified', 'access_checked'].includes(verification[id]?.status) ? verification[id].status : null,
    repositoryUrl: `https://github.com/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}`,
  }));
  const ready = Boolean(registry.defaultDestinationId && current.auth);
  const defaultVerification = verification[registry.defaultDestinationId] ?? {};
  return {
    appConfigured: Boolean(GITHUB_APP_CLIENT_ID), ready,
    auth: authSummary(current.auth), candidateAuth: authSummary(pending.auth),
    deviceAttempt: safeAttempt(attempt), config: configurationSnapshot.config,
    destinationRegistry: { version: 1, defaultDestinationId: registry.defaultDestinationId }, destinations,
    trackingRepositoryUrl: configurationSnapshot.config ? `https://github.com/${encodeURIComponent(configurationSnapshot.config.owner)}/${encodeURIComponent(configurationSnapshot.config.repo)}` : '',
    lastVerifiedAt: defaultVerification.lastVerifiedAt ?? null,
    verificationStatus: ['write_verified', 'access_checked'].includes(defaultVerification.status) ? defaultVerification.status : null,
    active: Boolean(tracking.activeTimer),
    pendingCount: Object.values(tracking.destinationStates?.entries ?? {}).reduce((total, entry) => total + (entry.pendingWrites?.length || 0), 0),
    installationUrl: githubAppInstallationUrl(), authorizationSettingsUrl: GITHUB_AUTHORIZATIONS_URL,
    newRepositoryUrl: GITHUB_NEW_REPOSITORY_URL, newOrganizationRepositoryUrl: GITHUB_NEW_ORGANIZATION_REPOSITORY_URL,
  };
}

async function checkCurrentRepositoryAccess(destinationId = null) {
  let snapshot = await configuredSnapshot({ destinationId });
  if (!snapshot.config || !snapshot.auth) throw new Error('Connect GitHub before checking repository access.');
  const selectedId = snapshot.destinationId;
  if (!destinationId && snapshot.auth.mode === 'github_app' && snapshot.config.repoId) {
    await onboarding.recoverCurrentRepository();
    snapshot = await configuredSnapshot({ destinationId: selectedId });
  }
  const repository = await githubForConfig(snapshot.config).assertDestinationReachable();
  const lastVerifiedAt = new Date().toISOString();
  await store.saveDestinationVerification(selectedId, 'access_checked', lastVerifiedAt);
  return {
    destinationId: selectedId, config: snapshot.config,
    repository: { id: repository.id, fullName: repository.full_name },
    lastVerifiedAt, verificationStatus: 'access_checked',
  };
}

async function contextForDestination(destinationId, { localOnly = false } = {}) {
  await requireConfiguredDestinationId(store, destinationId);
  const snapshot = await configuredSnapshot({ localOnly, destinationId });
  const { config, auth } = snapshot;
  if (!config || !auth) throw new Error('Connect GitHub and choose a private time-data repository in Settings.');
  const github = githubForConfig(config);
  const destinationStore = store.destinationStore(destinationId);
  const localState = await destinationStore.getState();
  let user = config.storageLogin || localState.user;
  if (!user) {
    user = auth.githubLogin || (localOnly ? null : await github.getAuthenticatedUser());
    if (!user) throw new Error('Refresh the GitHub connection to load your tracking identity.');
    await destinationStore.patchState({ user });
  }
  return {
    config, destinationId,
    reports: new ReportService({ github, cache: store }),
    tracker: new TrackerService({ github, store: destinationStore, user, actorId: Number.isSafeInteger(auth.githubUserId) ? `github:${auth.githubUserId}` : `clockoli:${config.repoId}:${user}`, actorName: user, recentDays: config.recentDays || 7 }),
  };
}

async function context(options = {}) {
  const snapshot = await configuredSnapshot(options);
  if (!snapshot.destinationId) throw new Error('Choose a default time repository in Settings.');
  return contextForDestination(snapshot.destinationId, options);
}

async function trackerForDestination(destinationId, options = {}) {
  return (await contextForDestination(destinationId, options)).tracker;
}

async function destinationUser(destination, auth) {
  const state = await store.destinationStore(destination.id).getState();
  return destination.storageLogin || state.user || auth.githubLogin || '';
}

function emitReportProgress(requestId, progress) {
  if (!requestId) return;
  try { chrome.runtime.sendMessage({ type: 'REPORT_PROGRESS', requestId, ...progress }, () => void chrome.runtime.lastError); } catch {}
}

function broadcastLocalPreferencesChanged(revision) {
  try { chrome.runtime.sendMessage({ type: 'LOCAL_PREFERENCES_CHANGED', revision }, () => void chrome.runtime.lastError); }
  catch { /* no open extension surface */ }
  void chrome.tabs.query({}).then(tabs => Promise.allSettled(tabs
    .filter(tab => Number.isInteger(tab.id))
    .map(tab => chrome.tabs.sendMessage(tab.id, { type: 'LOCAL_PREFERENCES_CHANGED', revision })))).catch(() => {});
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
  await store.ensureDataVersion(5);
  loadCoordinator.assertCurrent(loadEpoch);
  const snapshot = await configuredSnapshot({ localOnly: true });
  loadCoordinator.assertCurrent(loadEpoch);
  const { auth } = snapshot, destinations = selectReadDestinations(snapshot, message.payload || {});
  if (!auth || !destinations.length) return { configured: false, records: [] };
  const loadKey = 'all:reports', previous = reportLoads.get(loadKey);
  if (previous) {
    previous.controller.abort();
    await previous.promise.catch(() => {});
    loadCoordinator.assertCurrent(loadEpoch);
  }
  const controller = new AbortController();
  const promise = (async () => {
    const currentUsers = {};
    const loaded = await loadDestinationRecords(destinations, async (destination, signal) => {
      loadCoordinator.assertCurrent(loadEpoch);
      currentUsers[destination.id] = await destinationUser(destination, auth);
      const branch = destination.branch || 'main';
      const reports = new ReportService({
        github: githubForConfig(destination), cache: store,
        onProgress: progress => emitReportProgress(message.payload?.requestId, { ...progress, destinationId: destination.id }),
      });
      return reports.loadRepositoryRange(message.payload || {}, {
        defaultBranch: destination.defaultBranch || branch, signal, includeStorageMetadata: true,
      });
    }, { signal: controller.signal });
    loadCoordinator.assertCurrent(loadEpoch);
    const users = [...new Set(Object.values(currentUsers).filter(Boolean))];
    return {
      configured: true,
      sourceRepositories: destinations.map(destination => destination.label),
      currentUsers, currentUser: users[0] || '',
      ...loaded,
      records: loaded.records.map(withoutInternalMetadata),
      billing: await store.getLocalPreferences(),
    };
  })();
  reportLoads.set(loadKey, { controller, promise });
  try { return await promise; }
  finally { if (reportLoads.get(loadKey)?.promise === promise) reportLoads.delete(loadKey); }
}

async function loadTaskParticipants(message, sender, extensionOrigin) {
  const loadEpoch = await loadCoordinator.beginLoad();
  await store.ensureDataVersion(5); loadCoordinator.assertCurrent(loadEpoch);
  const snapshot = await configuredSnapshot({ localOnly: true }); loadCoordinator.assertCurrent(loadEpoch);
  const taskUrl = taskUrlForParticipantLoad(message.taskUrl, sender, extensionOrigin);
  const { auth } = snapshot, destinations = selectReadDestinations(snapshot, message.payload || {});
  if (!auth || !destinations.length) return { configured: false, taskUrl, complete: false, participants: [] };
  const requestOwner = sender?.documentId ?? sender?.tab?.id ?? sender?.url ?? 'content';
  const loadKey = `all:participants:${requestOwner}`, previous = reportLoads.get(loadKey);
  if (previous) {
    previous.controller.abort();
    await previous.promise.catch(() => {});
    loadCoordinator.assertCurrent(loadEpoch);
  }
  const controller = new AbortController();
  const promise = (async () => {
    const timerStates = new Map(), currentUsers = {};
    const loaded = await loadDestinationRecords(destinations, async (destination, signal) => {
      loadCoordinator.assertCurrent(loadEpoch);
      const user = await destinationUser(destination, auth);
      if (!user) throw Object.assign(new Error('Tracking identity is unavailable.'), { code: 'identity_unavailable' });
      currentUsers[destination.id] = user;
      const tracker = await trackerForDestination(destination.id, { localOnly: true });
      await tracker.getState({ refresh: true, signal });
      signal.throwIfAborted(); loadCoordinator.assertCurrent(loadEpoch);
      const records = await new ReportService({ github: githubForConfig(destination), cache: store })
        .loadRepositoryTask(taskUrl, { defaultBranch: destination.defaultBranch || destination.branch || 'main', signal });
      timerStates.set(destination.id, await tracker.getState());
      return records;
    }, { signal: controller.signal, merge: mergeDestinationTaskSummaries });
    loadCoordinator.assertCurrent(loadEpoch);
    const activeEntry = [...timerStates.entries()].find(([, state]) => state.active);
    const active = activeEntry ? annotateDestinationRecord(activeEntry[1].active, destinations.find(item => item.id === activeEntry[0])) : null;
    const pendingWrites = [...timerStates.entries()].flatMap(([destinationId, state]) => (state.pendingWrites || []).map(operation => ({ ...operation, destinationId })));
    return {
      configured: true, taskUrl, complete: !loaded.partial,
      participants: aggregateTaskParticipants(loaded.records, { taskUrl, active, pendingWrites }),
      currentUsers, readStatus: loaded.readStatus, partial: loaded.partial, conflicts: loaded.conflicts,
    };
  })();
  reportLoads.set(loadKey, { controller, promise });
  try { return await promise; }
  finally { if (reportLoads.get(loadKey)?.promise === promise) reportLoads.delete(loadKey); }
}

async function loadTimes(message, sender) {
  const loadEpoch = await loadCoordinator.beginLoad();
  await store.ensureDataVersion(5); loadCoordinator.assertCurrent(loadEpoch);
  const snapshot = await configuredSnapshot({ localOnly: true }); loadCoordinator.assertCurrent(loadEpoch);
  const { auth } = snapshot, destinations = selectReadDestinations(snapshot, message.payload || {});
  if (!auth || !destinations.length) return { configured: false, recent: [] };
  const requestOwner = sender?.documentId ?? sender?.tab?.id ?? sender?.url ?? 'extension';
  const loadKey = `all:times:${requestOwner}`, previous = reportLoads.get(loadKey);
  if (previous) {
    previous.controller.abort();
    await previous.promise.catch(() => {});
    loadCoordinator.assertCurrent(loadEpoch);
  }
  const controller = new AbortController();
  const promise = (async () => {
    const recoveries = new Map(), currentUsers = {};
    const loaded = await loadDestinationRecords(destinations, async (destination, signal) => {
      signal.throwIfAborted(); loadCoordinator.assertCurrent(loadEpoch);
      const user = await destinationUser(destination, auth);
      if (!user) throw Object.assign(new Error('Tracking identity is unavailable.'), { code: 'identity_unavailable' });
      currentUsers[destination.id] = user;
      const reports = new ReportService({
        github: githubForConfig(destination), cache: store,
        onProgress: progress => emitReportProgress(message.payload?.requestId, { ...progress, destinationId: destination.id }),
      });
      const recent = await reports.loadUserRange(message.payload || {}, user, { includeStorageMetadata: true, signal }, {
        maxFiles: 120, maxBytes: 100 * 1024 * 1024, maxRecords: 500000,
      });
      const tracker = await trackerForDestination(destination.id, { localOnly: true });
      recoveries.set(destination.id, await tracker.getRecoveryState());
      return recent;
    }, { signal: controller.signal });
    loadCoordinator.assertCurrent(loadEpoch);
    const pendingWrites = [...recoveries.entries()].flatMap(([destinationId, recovery]) => (recovery.pendingWrites || []).map(operation => safePendingProjection(operation, destinationId)));
    return {
      configured: true,
      recent: loaded.records.map(({ _record, ...record }) => record)
        .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt)),
      pendingWrites, pendingCount: pendingWrites.length,
      remoteWriteConfirmed: !loaded.partial && !(loaded.conflicts?.length)
        && [...recoveries.entries()].every(([destinationId, recovery]) => recovery.remoteWriteConfirmed === true
          || (!(recovery.pendingWrites?.length) && !loaded.records.some(record => record.destinationId === destinationId))),
      currentUsers, readStatus: loaded.readStatus, partial: loaded.partial, conflicts: loaded.conflicts,
    };
  })();
  reportLoads.set(loadKey, { controller, promise });
  try { return await promise; }
  finally { if (reportLoads.get(loadKey)?.promise === promise) reportLoads.delete(loadKey); }
}

async function loadTasks(message, sender) {
  const loadEpoch = await loadCoordinator.beginLoad();
  await store.ensureDataVersion(5);
  loadCoordinator.assertCurrent(loadEpoch);
  const snapshot = await configuredSnapshot({ localOnly: true });
  loadCoordinator.assertCurrent(loadEpoch);
  const { auth, generation } = snapshot, destinations = selectReadDestinations(snapshot, message.payload || {});
  if (!auth || !destinations.length) return { configured: false, tasks: [], active: null, pendingWrites: [] };
  const requestOwner = sender?.tab?.id ?? sender?.url ?? 'extension';
  const loadKey = `all:tasks:${requestOwner}`, previous = reportLoads.get(loadKey);
  if (previous) {
    previous.controller.abort();
    await previous.promise.catch(() => {});
    loadCoordinator.assertCurrent(loadEpoch);
  }
  const controller = new AbortController();
  const promise = (async () => {
    const timerStates = new Map(), metadata = new Map(), currentUsers = {};
    const loaded = await loadDestinationRecords(destinations, async (destination, signal) => {
      loadCoordinator.assertCurrent(loadEpoch);
      const { tracker } = await contextForDestination(destination.id, { localOnly: true });
      const user = await destinationUser(destination, auth);
      if (!user) throw Object.assign(new Error('Tracking identity is unavailable.'), { code: 'identity_unavailable' });
      currentUsers[destination.id] = user;
      await tracker.getState({ refresh: true, signal });
      signal.throwIfAborted(); loadCoordinator.assertCurrent(loadEpoch);
      const reports = new ReportService({
        github: githubForConfig(destination), cache: store,
        onProgress: progress => emitReportProgress(message.payload?.requestId, { ...progress, destinationId: destination.id }),
      });
      const records = await reports.loadUserRange(message.payload || {}, user, { signal, includeStorageMetadata: true });
      const state = await tracker.getState();
      timerStates.set(destination.id, state);
      const issueValues = records.flatMap(record => record.issue ? [record.issue] : []);
      if (state.active?.issue) issueValues.push(state.active.issue);
      const issues = [...new Map(issueValues.map(issue => [issue.url, issue])).values()];
      const repositoryKey = `${destination.owner}/${destination.repo}@${destination.branch || 'main'}`;
      const details = await new TaskMetadataService({
        github: githubForConfig(destination), cache: store, configurationGeneration: generation,
        scopeKey: `${repositoryKey}:${user}:g${generation}`,
      }).load(issues, { signal });
      for (const [url, value] of details) if (!metadata.has(url)) metadata.set(url, value);
      return records;
    }, { signal: controller.signal });
    loadCoordinator.assertCurrent(loadEpoch);
    const activeEntry = [...timerStates.entries()].find(([, state]) => state.active);
    const active = activeEntry ? annotateDestinationRecord(activeEntry[1].active, destinations.find(item => item.id === activeEntry[0])) : null;
    const pendingWrites = [...timerStates.entries()].flatMap(([destinationId, state]) => {
      const destination = destinations.find(item => item.id === destinationId);
      return (state.pendingWrites || []).map(operation => ({
        ...operation, destinationId, timeRepository: destination?.label || `${destination?.owner}/${destination?.repo}`,
        ...(operation.entry ? { entry: { ...operation.entry, destinationId, timeRepository: destination?.label || `${destination?.owner}/${destination?.repo}` } } : {}),
      }));
    });
    return {
      configured: true,
      sourceRepositories: destinations.map(destination => destination.label),
      currentUsers,
      tasks: aggregateTrackedTasks(loaded.records.map(withoutInternalMetadata), {
        currentUsers: Object.values(currentUsers), metadata, active, pendingWrites,
        startDate: message.payload?.startDate, endDate: message.payload?.endDate,
      }),
      active, pendingWrites,
      readStatus: loaded.readStatus, partial: loaded.partial, conflicts: loaded.conflicts,
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

const READ_RETRY_MESSAGES = new Set([
  'LOAD_REPORT', 'LOAD_TASK_PARTICIPANTS', 'LOAD_TASKS', 'LOAD_TIMES', 'LOAD_RECENT',
  'GET_STATE', 'GET_PAGE_STATE', 'GET_EXCHANGE_RATES', 'GET_ONBOARDING_STATE',
  'RESUME_DEVICE_FLOW', 'DISCOVER_REPOSITORIES',
]);

const RECOVERABLE_REPOSITORY_MESSAGES = new Set([
  'LOAD_REPORT', 'LOAD_TASK_PARTICIPANTS', 'LOAD_TASKS', 'LOAD_TIMES', 'GET_STATE', 'GET_PAGE_STATE', 'START', 'SWITCH_TASK', 'STOP', 'DISCARD_ACTIVE', 'SYNC',
  'LOAD_RECENT', 'BULK_ADD_TIMES', 'EDIT_ENTRIES', 'EDIT_ACTIVE_START', 'QUEUE_ENTRY_EDIT', 'QUEUE_ENTRIES_EDIT', 'QUEUE_ACTIVE_START_EDIT', 'DELETE_ENTRY', 'RESOLVE_PENDING',
]);

async function withCurrentRepositoryRecovery(message, operation) {
  if (!RECOVERABLE_REPOSITORY_MESSAGES.has(message?.type)) return operation();
  const baseline = await configuredSnapshot({ localOnly: true });
  if (baseline.auth?.mode !== 'github_app' || !baseline.config?.repoId) return operation();
  return withRepositoryRecovery(operation, {
    shouldRecover: async () => true,
    recover: async () => {
      let recovered = false;
      await loadCoordinator.save(() => cancelReports(), async () => {
        const latest = await configuredSnapshot({ localOnly: true });
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

function diagnosticError(value) {
  return String(value || '')
    .replace(/(token|secret|authorization|password|credential)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/gh[pousr]_[A-Za-z0-9_]+/g, '[redacted]')
    .slice(0, 300);
}

function safeActiveProjection(active, destinationId) {
  return active ? {
    id: active.id, taskUrl: active.taskUrl || active.issue?.url, taskTitle: active.taskTitle ?? active.issueTitle ?? '',
    ...(active.issue ? { issue: active.issue } : {}), startedAt: active.startedAt,
    entryDate: active.entryDate, timezone: active.timezone,
    description: active.description || '', issueTitle: active.taskTitle ?? active.issueTitle ?? '',
    destinationId, _pending: Boolean(active._pending),
  } : null;
}

function safePendingProjection(operation, destinationId) {
  const { id, status, stage, conflictReason, queuedAt, retryCount, lastError } = operation;
  const diagnostics = Array.isArray(operation.diagnostics) ? operation.diagnostics.slice(-60).flatMap(event => {
    const at = typeof event?.at === 'string' && !Number.isNaN(new Date(event.at).getTime()) ? event.at : null;
    const message = diagnosticError(event?.message);
    return at && message ? [{ at, message }] : [];
  }) : [];
  return {
    id, destinationId, status, stage, operation: operation.operation, queuedAt,
    retryCount: Math.max(0, Number(retryCount) || 0),
    ...(conflictReason ? { conflictReason } : {}),
    ...(lastError ? { lastError: diagnosticError(lastError) } : {}),
    ...(diagnostics.length ? { diagnostics } : {}),
  };
}

function destinationSaveConfirmed(state) {
  const pending = Math.max(state?.pendingWrites?.length || 0, Number(state?.pendingCount) || 0);
  const hasLocalRecord = Boolean(state?.active || state?.recent?.length);
  return state?.remoteWriteConfirmed === true || (!pending && !hasLocalRecord);
}

async function globalTrackerState({ refresh = false, includeSummary = false } = {}) {
  const snapshot = await configuredSnapshot({ localOnly: true });
  const destinationIds = Object.keys(snapshot.registry?.destinations ?? {});
  if (!snapshot.auth || !destinationIds.length) return { configured: false, active: null, recent: [], pendingWrites: [] };
  let summaryError;
  const states = new Map();
  for (const destinationId of destinationIds) {
    const tracker = await trackerForDestination(destinationId, { localOnly: true });
    let state = await tracker.getState({ refresh });
    if (includeSummary && refresh) {
      try { await tracker.loadMenuData(); }
      catch (error) { summaryError ||= serializeError(error, { type: 'GET_PAGE_STATE' }); }
    }
    if (includeSummary) state = await tracker.getState({ includeSummary: true });
    states.set(destinationId, state);
  }
  const tracking = await store.getTrackingSnapshot();
  const activeId = tracking.activeTimer?.destinationId ?? null;
  const active = activeId ? safeActiveProjection(states.get(activeId)?.active, activeId) : null;
  const recent = [...states].flatMap(([destinationId, state]) => (state.recent ?? [])
    .map(entry => ({ ...entry, destinationId })))
    .sort((left, right) => new Date(right.startedAt) - new Date(left.startedAt)).slice(0, 50);
  const pendingWrites = [...states].flatMap(([destinationId, state]) => (state.pendingWrites ?? [])
    .map(operation => safePendingProjection(operation, destinationId)));
  const result = { configured: true, active, recent, pendingWrites };
  if (includeSummary) {
    const summaries = [...states.values()];
    const complete = !summaryError && summaries.every(state => state.todayTrackedMs !== null && state.weekTrackedMs !== null);
    Object.assign(result, complete ? {
      todayTrackedMs: summaries.reduce((total, state) => total + state.todayTrackedMs, 0),
      weekTrackedMs: summaries.reduce((total, state) => total + state.weekTrackedMs, 0),
    } : { todayTrackedMs: null, weekTrackedMs: null, ...(summaryError ? { summaryError } : {}) });
    result.remoteWriteConfirmed = !summaryError && summaries.every(destinationSaveConfirmed);
  }
  return result;
}

async function loadRecentAcrossDestinations(message, sender, extensionOrigin) {
  const snapshot = await configuredSnapshot({ localOnly: true });
  const destinations = selectReadDestinations(snapshot, message || {});
  if (!snapshot.auth || !destinations.length) return message.menuData ? { configured: false, recent: [] } : [];
  const knownTitles = new Map();
  if ((message.taskUrl || message.issue) && (message.taskTitle || message.issueTitle)) {
    const taskUrl = taskUrlForStart(message.taskUrl ?? message.issue, sender, extensionOrigin);
    const title = String(message.taskTitle ?? message.issueTitle).replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, 300);
    if (title) knownTitles.set(taskUrl, title);
  }
  const states = new Map();
  const loaded = await loadDestinationRecords(destinations, async destination => {
    const tracker = await trackerForDestination(destination.id, { localOnly: true });
    if (!message.menuData) return tracker.loadRecent(50);
    const state = await tracker.loadMenuData(50, { knownTitles });
    states.set(destination.id, state);
    return state.recent || [];
  });
  const recent = loaded.records.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt)).slice(0, 50);
  if (!message.menuData) return recent;
  const tracking = await store.getTrackingSnapshot();
  const activeId = tracking.activeTimer?.destinationId;
  const activeState = activeId ? states.get(activeId) : null;
  const pendingWrites = [...states.entries()].flatMap(([destinationId, state]) => (state.pendingWrites || []).map(operation => safePendingProjection(operation, destinationId)));
  const completeSummary = states.size > 0 && [...states.values()].every(state => state.todayTrackedMs !== null && state.weekTrackedMs !== null);
  return {
    configured: true, recent,
    active: activeState?.active ? safeActiveProjection(activeState.active, activeId) : null,
    pendingWrites, pendingCount: pendingWrites.length,
    todayTrackedMs: completeSummary ? [...states.values()].reduce((sum, state) => sum + state.todayTrackedMs, 0) : null,
    weekTrackedMs: completeSummary ? [...states.values()].reduce((sum, state) => sum + state.weekTrackedMs, 0) : null,
    remoteWriteConfirmed: completeSummary && !loaded.partial && !(loaded.conflicts?.length)
      && [...states.values()].every(destinationSaveConfirmed),
    readStatus: loaded.readStatus, partial: loaded.partial, conflicts: loaded.conflicts,
  };
}

async function handle(message, sender) {
  if (!message || typeof message.type !== 'string') throw new Error('Invalid extension message');
  const extensionOrigin = chrome.runtime.getURL('');
  assertMessageAllowed(message.type, sender, extensionOrigin);
  if (message.type === 'SET_ACTION_ICON_FRAME') {
    if (!Number.isInteger(sender?.tab?.id)) throw new Error('Action icon updates require a browser tab');
    const frame = message.frame;
    if (frame !== null && (!Number.isInteger(frame) || frame < 0 || frame >= ACTION_ICON_FRAMES)) throw new Error('Invalid action icon frame');
    const path = frame === null ? STATIC_ACTION_ICON : {
      16: `src/assets/action-spin/clockoli-16-${frame}.png`,
      32: `src/assets/action-spin/clockoli-32-${frame}.png`,
    };
    await chrome.action.setIcon({ path, tabId: sender.tab.id });
    return { updated: true };
  }
  if (message.type === 'OPEN_OPTIONS') { await chrome.runtime.openOptionsPage(); return { ok: true }; }
  if (message.type === 'OPEN_REPORTS') {
    await chrome.tabs.create({ url: chrome.runtime.getURL('src/reports/reports.html') }); return { ok: true };
  }
  if (message.type === 'OPEN_TASKS') {
    await chrome.tabs.create({ url: chrome.runtime.getURL('src/tasks/tasks.html') }); return { ok: true };
  }
  if (message.type === 'OPEN_TIMES') {
    await openTimesPage(); return { ok: true };
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
  if (message.type === 'DISCOVER_REPOSITORIES') {
    const discovery = await onboarding.discover();
    return { ...discovery, onboardingState: await onboardingState() };
  }
  if (message.type === 'CHECK_REPOSITORY_ACCESS') return checkCurrentRepositoryAccess(message.destinationId || message.payload?.destinationId || null);
  if (message.type === 'SELECT_REPOSITORY') return onboarding.selectRepository(message.payload);
  if (message.type === 'SET_DEFAULT_DESTINATION') {
    const destinationId = await requireConfiguredDestinationId(store, message.destinationId || message.payload?.destinationId);
    const result = await store.setDefaultDestination(destinationId);
    broadcastLocalPreferencesChanged(result.revision);
    return result;
  }
  if (message.type === 'REMOVE_DESTINATION') {
    const destinationId = await requireConfiguredDestinationId(store, message.destinationId || message.payload?.destinationId);
    const result = await store.removeDestination(destinationId);
    broadcastLocalPreferencesChanged(result.revision);
    return result;
  }
  if (message.type === 'DISCONNECT_GITHUB_APP') return onboarding.disconnect();
  if (message.type === 'CLEAR_LOCAL_CONFIGURATION') return onboarding.clearLocalConfiguration();
  if (message.type === 'SAVE_CONFIG') {
    await store.ensureDataVersion(5);
    return configuration.save(message.payload);
  }
  if (message.type === 'UPDATE_DISPLAY_PREFERENCES') {
    const generation = await store.updateDisplayPreferences(message.payload || {});
    const { config } = await store.getConfigurationSnapshot();
    const preferences = await store.getLocalPreferences();
    broadcastLocalPreferencesChanged(preferences.revision);
    return { config, generation, preferences };
  }
  if (message.type === 'SET_QUEUE_DIAGNOSTICS') {
    await store.setQueueDiagnostics(message.enabled === true);
    const preferences = await store.getLocalPreferences();
    broadcastLocalPreferencesChanged(preferences.revision);
    return { preferences };
  }
  if (message.type === 'GET_LOCAL_PREFERENCES') return store.getLocalPreferences();
  if (message.type === 'SAVE_BILLING_SETTINGS') {
    const result = await store.saveBillingSettings(message.payload || {}, message.projectLinks ?? null);
    broadcastLocalPreferencesChanged(result.revision);
    return result;
  }
  if (message.type === 'RESERVE_INVOICE_NUMBER') return store.reserveInvoiceNumber();
  if (message.type === 'EXPORT_SETTINGS') return store.exportSettings();
  if (message.type === 'MARK_SETTINGS_EXPORTED') return { marked: await store.markSettingsExported(message.revision) };
  if (message.type === 'IMPORT_SETTINGS') {
    const text = String(message.text || '');
    if (new TextEncoder().encode(text).byteLength > 262_144) throw new Error('Settings file is too large.');
    const imported = await store.importSettings(text);
    broadcastLocalPreferencesChanged(imported.revision);
    return imported;
  }
  if (message.type === 'CANCEL_REPORT') { await cancelReports('reports'); return { cancelled: true }; }
  if (message.type === 'LOAD_REPORT') return loadReport(message);
  if (message.type === 'LOAD_TASK_PARTICIPANTS') return loadTaskParticipants(message, sender, extensionOrigin);
  if (message.type === 'GET_EXCHANGE_RATES') return loadExchangeRates(message);
  if (message.type === 'LOAD_TASKS') return loadTasks(message, sender);
  if (message.type === 'LOAD_TIMES') return loadTimes(message, sender);
  if (message.type === 'GET_STATE' || message.type === 'GET_PAGE_STATE') {
    const pageState = message.type === 'GET_PAGE_STATE';
    const state = await globalTrackerState({ refresh: Boolean(message.refresh), includeSummary: pageState });
    if (!state.configured) return pageState
      ? { configured: false, active: null, pendingCount: 0, recent: [] }
      : state;
    if (!pageState) return state;
    const preferences = await store.getLocalPreferences();
    return {
      ...state,
      projects: preferences.projects,
      otherProjectName: preferences.otherProjectName,
      showQueueDiagnostics: preferences.showQueueDiagnostics,
      pendingCount: state.pendingWrites.length,
    };
  }
  switch (message.type) {
    case 'START': {
      const taskUrl = taskUrlForStart(message.taskUrl ?? message.issue, sender, extensionOrigin);
      const destinationId = await resolveStartDestinationId(store, taskUrl);
      const tracker = await trackerForDestination(destinationId);
      const result = await tracker.start(taskUrl, message.taskTitle ?? message.issueTitle ?? '', message.description || '', { background: true });
      if (result._pending) requestPendingSync();
      return { ...result, destinationId };
    }
    case 'SWITCH_TASK': {
      const taskUrl = message.timelineTask
        ? taskUrlForTimelineSwitch(message.taskUrl ?? message.issue, sender, extensionOrigin)
        : taskUrlForStart(message.taskUrl ?? message.issue, sender, extensionOrigin);
      const targetDestinationId = await resolveStartDestinationId(store, taskUrl);
      const sourceDestinationId = await activeDestinationId(store);
      if (!sourceDestinationId || sourceDestinationId === targetDestinationId) {
        const tracker = await trackerForDestination(targetDestinationId);
        const result = await tracker.switchTask(taskUrl, message.taskTitle ?? message.issueTitle ?? '', message.description || '', { background: true });
        if (result.pending) requestPendingSync();
        return { ...result, destinationId: targetDestinationId };
      }
      const sourceTracker = await trackerForDestination(sourceDestinationId);
      const targetTracker = await trackerForDestination(targetDestinationId);
      const sourceState = await sourceTracker.getState();
      const current = sourceState.active;
      if (!current) throw new Error('The active timer changed before this switch was accepted. Retry the action.');
      if (taskUrlOf(current) === taskUrl) return { stopped: null, active: { ...current, destinationId: sourceDestinationId }, pending: false, destinationId: sourceDestinationId };
      const changedAt = new Date();
      const source = sourceTracker.prepareQueuedStop(current, message.description || '', { endedAt: changedAt });
      let nextId = createUlid(changedAt.getTime());
      if (nextId === current.id) nextId = createUlid(changedAt.getTime() + 1);
      const target = targetTracker.prepareQueuedStart(taskUrl, message.taskTitle ?? message.issueTitle ?? '', '', {
        startedAt: changedAt, id: nextId,
        blockedBy: { destinationId: sourceDestinationId, operationId: source.operation.id, operation: 'completeTimer' },
      });
      const accepted = await store.acceptCrossDestinationSwitch({
        expectedActive: { destinationId: sourceDestinationId, recordId: current.id },
        source: { destinationId: sourceDestinationId, ...source },
        target: { destinationId: targetDestinationId, ...target },
      });
      if (!accepted) throw new Error('The active timer changed before this switch was accepted. Retry the action.');
      requestPendingSync();
      return {
        stopped: { entry: { ...source.entry, destinationId: sourceDestinationId }, pending: true },
        active: { ...target.pendingActive, destinationId: targetDestinationId }, pending: true,
        destinationId: targetDestinationId,
      };
    }
    case 'STOP': {
      const destinationId = await activeDestinationId(store, { required: true });
      const tracker = await trackerForDestination(destinationId);
      const result = await tracker.stop(message.description || '', { background: true });
      if (result.pending) requestPendingSync();
      return { ...result, destinationId };
    }
    case 'DISCARD_ACTIVE': {
      const destinationId = await activeDestinationId(store, { required: true });
      const tracker = await trackerForDestination(destinationId);
      const result = await tracker.discardActive({ background: true });
      if (result.pending) requestPendingSync();
      return { ...result, destinationId };
    }
    case 'SYNC': return syncPendingAll({ store, trackerForDestination });
    case 'LOAD_RECENT': return loadRecentAcrossDestinations(message, sender, extensionOrigin);
    case 'EDIT_ENTRIES': {
      const destinationId = await requireConfiguredDestinationId(store,
        destinationIdForCompletedMutation(message.type, message.payload, sender, extensionOrigin));
      const { destinationId: _destinationId, ...payload } = message.payload;
      return (await trackerForDestination(destinationId)).editEntries(payload);
    }
    case 'EDIT_ACTIVE_START': {
      const destinationId = await activeDestinationId(store, { required: true });
      return (await trackerForDestination(destinationId)).editActiveStart(message.payload);
    }
    case 'QUEUE_ENTRY_EDIT': {
      const destinationId = await requireConfiguredDestinationId(store,
        destinationIdForCompletedMutation(message.type, message.payload, sender, extensionOrigin));
      const { destinationId: _destinationId, ...payload } = message.payload;
      const result = await (await trackerForDestination(destinationId)).queueEntryEdit(payload);
      requestPendingSync();
      return { ...result, destinationId };
    }
    case 'QUEUE_ENTRY_DELETE': {
      const destinationId = await requireConfiguredDestinationId(store,
        destinationIdForCompletedMutation(message.type, message.payload, sender, extensionOrigin));
      const { destinationId: _destinationId, ...payload } = message.payload;
      const result = await (await trackerForDestination(destinationId)).queueEntryDelete(payload);
      requestPendingSync();
      return { ...result, destinationId };
    }
    case 'QUEUE_ENTRIES_EDIT': {
      const destinationId = await requireConfiguredDestinationId(store,
        destinationIdForCompletedMutation(message.type, message.payload, sender, extensionOrigin));
      const { destinationId: _destinationId, ...payload } = message.payload;
      const result = await (await trackerForDestination(destinationId)).queueEntriesEdit(payload);
      requestPendingSync();
      return { ...result, destinationId };
    }
    case 'QUEUE_ACTIVE_START_EDIT': {
      const destinationId = await activeDestinationId(store, { required: true });
      const result = await (await trackerForDestination(destinationId)).queueActiveStartEdit(message.payload);
      requestPendingSync();
      return { ...result, destinationId };
    }
    case 'BULK_ADD_TIMES': {
      const text = String(message.text || '');
      if (new TextEncoder().encode(text).byteLength > 262_144) throw new Error('Bulk input is too large.');
      return (await context()).tracker.bulkAddTimes(text);
    }
    case 'DELETE_ENTRY': {
      const destinationId = await requireConfiguredDestinationId(store,
        destinationIdForCompletedMutation(message.type, message.payload, sender, extensionOrigin));
      const { destinationId: _destinationId, ...payload } = message.payload;
      return (await trackerForDestination(destinationId)).deleteEntry(payload);
    }
    case 'RESOLVE_PENDING': {
      const snapshot = await store.getTrackingSnapshot();
      const destinationIds = Object.entries(snapshot.destinationStates?.entries ?? {})
        .filter(([, state]) => (state.pendingWrites ?? []).some(operation => operation.id === message.id))
        .map(([destinationId]) => destinationId);
      if (destinationIds.length !== 1) throw new Error('The pending operation could not be uniquely located. Reload and try again.');
      const result = await (await trackerForDestination(destinationIds[0])).resolvePendingConflict(message.id, message.action || '');
      requestPendingSync();
      return { ...result, destinationId: destinationIds[0] };
    }
    default: throw new Error('Unknown extension message');
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'LOCAL_PREFERENCES_CHANGED') return undefined;
  const reportReadOnly = ['LOAD_REPORT', 'LOAD_TASK_PARTICIPANTS', 'CANCEL_REPORT', 'GET_EXCHANGE_RATES'].includes(message?.type);
  const localStateRead = ['GET_STATE', 'GET_PAGE_STATE'].includes(message?.type) && !message?.refresh;
  const readOnly = reportReadOnly || localStateRead || ['LOAD_TASKS', 'LOAD_TIMES', 'GET_ONBOARDING_STATE', 'RESUME_DEVICE_FLOW', 'DISCOVER_REPOSITORIES'].includes(message?.type);
  const changesConfiguration = ['SAVE_CONFIG', 'UPDATE_DISPLAY_PREFERENCES', 'IMPORT_SETTINGS', 'CHECK_REPOSITORY_ACCESS', 'SELECT_REPOSITORY', 'SET_DEFAULT_DESTINATION', 'REMOVE_DESTINATION', 'DISCONNECT_GITHUB_APP', 'CLEAR_LOCAL_CONFIGURATION'].includes(message?.type);
  let operation;
  if (changesConfiguration) {
    try {
      assertMessageAllowed(message.type, sender, chrome.runtime.getURL(''));
      operation = acceptanceExecutor.run(() => loadCoordinator.save(() => cancelReports(), () => handle(message, sender)));
    } catch (error) { operation = Promise.reject(error); }
  } else {
    const direct = readOnly || DIRECT_DEVICE_FLOW_MESSAGES.has(message?.type);
    const acceptsLocally = [
      'START', 'STOP', 'SWITCH_TASK', 'DISCARD_ACTIVE',
      'QUEUE_ENTRY_EDIT', 'QUEUE_ENTRY_DELETE', 'QUEUE_ENTRIES_EDIT', 'QUEUE_ACTIVE_START_EDIT',
    ].includes(message?.type);
    const attempt = () => direct ? handle(message, sender)
      : acceptsLocally ? acceptanceExecutor.run(() => handle(message, sender))
        : executor.run(() => handle(message, sender));
    operation = withCurrentRepositoryRecovery(message, attempt);
  }
  operation.then(data => sendResponse({ ok: true, data })).catch(error => sendResponse({ ok: false, error: serializeError(error, message) }));
  return true;
});

let pendingSync = null;
function hasRunnablePending(queue) {
  const first = queue?.[0];
  if (!first) return false;
  if (first.stage === 'awaitSourceCompletion') return true;
  if (first.status !== 'conflict') return true;
  const operation = first.operation ?? first.stage;
  const retryableConflict = !String(first.conflictReason || '').startsWith('queued_write_');
  return retryableConflict && ((first.stage === 'startNext' && first.nextActive)
    || (['editEntry', 'editEntries', 'deleteEntry'].includes(operation) && first.conflictReason !== 'queued_entry_missing'));
}
async function shouldContinuePendingSync() {
  const destinationIds = await store.getPendingDestinationIds();
  if (!destinationIds.length) return false;
  const snapshot = await store.getTrackingSnapshot();
  const entries = snapshot.destinationStates?.entries ?? {};
  return destinationIds.some(destinationId => hasRunnablePending(entries[destinationId]?.pendingWrites));
}
function syncPendingNow() {
  if (pendingSync) return pendingSync;
  pendingSync = withCurrentRepositoryRecovery({ type: 'SYNC' }, () => executor.run(async () => {
    if (!(await store.getPendingDestinationIds()).length) return;
    await syncPendingAll({ store, trackerForDestination });
    if (await shouldContinuePendingSync()) {
      chrome.alarms.create('sync-pending-now', { when: Date.now() + 5_000 });
    }
  })).catch(async error => {
    if (await shouldContinuePendingSync().catch(() => false)) {
      chrome.alarms.create('sync-pending-now', { when: Date.now() + 5_000 });
    }
    throw error;
  }).finally(() => { pendingSync = null; });
  return pendingSync;
}

function requestPendingSync() {
  chrome.alarms.create('sync-pending-now', { when: Date.now() + 250 });
}

function scheduleSync() {
  chrome.alarms.create('sync-pending', { periodInMinutes: 1 });
  void store.migrateLegacyPatAuth().catch(() => {});
  void syncPendingNow().catch(() => {});
}

async function openTimesPage() {
  await chrome.tabs.create({ url: chrome.runtime.getURL('src/times/times.html') });
}

async function toggleActionSurface(tab) {
  if (!Number.isInteger(tab?.id)) return openTimesPage();
  try {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_FULL_WIDTH_POPUP' });
      return;
    } catch {
      const url = new URL(tab.url || '');
      if (!['http:', 'https:'].includes(url.protocol)) return openTimesPage();
    }
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => { globalThis.__CLOCKOLI_ACTION_SURFACE__ = true; },
    });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['src/domain/recovery-actions.js', 'src/content/task-timeline-component.js', 'src/content/github.js'],
    });
  } catch {
    return openTimesPage();
  }
}

chrome.runtime.onInstalled.addListener(details => {
  scheduleSync();
  if (details.reason === 'install') void chrome.runtime.openOptionsPage();
});
chrome.action.onClicked.addListener(tab => {
  void toggleActionSurface(tab).catch(() => {});
});
chrome.runtime.onStartup.addListener(() => { scheduleSync(); });
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'sync-pending' || alarm.name === 'sync-pending-now') void syncPendingNow().catch(() => {});
});

scheduleSync();
