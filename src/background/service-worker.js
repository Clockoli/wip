import { GitHubClient } from '../api/github-client.js';
import { CredentialBroker, DeviceFlowService } from '../auth/github-app-auth.js';
import {
  GITHUB_APP_CLIENT_ID, githubAppInstallationUrl,
  GITHUB_AUTHORIZATIONS_URL, GITHUB_NEW_REPOSITORY_URL,
} from '../config/github-app.js';
import { activeRecordPath } from '../domain/work-records.js';
import { aggregateTaskParticipants, aggregateTrackedTasks } from '../domain/tasks.js';
import { ChromeStore } from '../storage/chrome-store.js';
import { setAddonEnabled } from '../addons/service.js';
import { TrackerService } from '../services/tracker.js';
import { ConfigurationService } from '../services/configuration.js';
import { ReportService } from '../services/reports.js';
import { ExchangeRateService } from '../services/exchange-rates.js';
import { TaskMetadataService } from '../services/task-metadata.js';
import { InstallationDiscoveryService, RepositoryInitializer } from '../services/github-app-onboarding.js';
import { OnboardingCoordinator } from '../services/onboarding-coordinator.js';
import { withRepositoryRecovery } from '../services/repository-operation-recovery.js';
import { normalizeClockifyDetailedReport } from '../addons/clockify/report-normalizer.js';
import { normalizeClockifyDetailedCsv } from '../addons/clockify/csv-normalizer.js';
import { createClockifyMigrationSessionService } from '../services/clockify-migration-session.js';
import { createClockifyCaptureArmService } from '../services/clockify-capture-arm.js';
import { createClockifyCaptureProfileService } from '../services/clockify-capture-profile.js';
import { completeClockifyHistoryCapture } from '../services/clockify-history-capture-completion.js';
import { createClockifyHistoryScanService } from '../services/clockify-history-scan.js';
import { clockifyDetailedReportYear } from '../services/clockify-report-route.js';
import { assertClockifyAnnualDataYear } from '../services/clockify-annual-data.js';
import { importClockifyOrganization } from '../services/clockify-organization-import.js';
import { removeAllClockoliRecords, removeClockifyImportedTestRecords } from '../services/clockify-import-cleanup.js';
import { resolveClockifyUrlSuggestions } from '../services/clockify-url-classifier.js';
import { IndexedDbBackend } from '../storage/chrome-store.js';
import { assertMessageAllowed, taskUrlForStart } from './message-policy.js';
import { SerialExecutor } from './serial-executor.js';
import { ConfigurationLoadCoordinator, finalizeTaskLoad, refreshTaskState } from './task-load.js';

const store = new ChromeStore();
const executor = new SerialExecutor();
const acceptanceExecutor = new SerialExecutor();
const loadCoordinator = new ConfigurationLoadCoordinator(executor);
const reportLoads = new Map();
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
const CLOCKIFY_MIGRATION_PROGRESS_PORT = 'CLOCKIFY_MIGRATION_PROGRESS_V1';
const CLOCKIFY_CAPTURE_PARSE_PROGRESS = 'CLOCKIFY_CAPTURE_PARSE_PROGRESS';
const CLOCKIFY_CAPTURE_PHASE = 'CLOCKIFY_CAPTURE_PHASE';
const CLOCKIFY_CAPTURE_PHASES = new Set([
  'saving_current_report', 'checking_task_projects', 'preparing_task_suggestions', 'saving_preview', 'opening_preview',
]);
const clockifyMigrationProgressPorts = new Map();
const clockifyMigrationBackend = new IndexedDbBackend();
const clockifyMigrationStorage = Object.freeze({
  async get(key) { return (await clockifyMigrationBackend.getMany([key]))[key]; },
  async set(key, value) { await clockifyMigrationBackend.setMany({ [key]: value }); },
  async remove(key) { await clockifyMigrationBackend.deleteMany([key]); },
});
const clockifyMigrationSession = createClockifyMigrationSessionService({ storageSession: clockifyMigrationStorage });
const clockifyCaptureArm = createClockifyCaptureArmService({ storageSession: clockifyMigrationStorage });
const clockifyCaptureProfile = createClockifyCaptureProfileService({ storageSession: clockifyMigrationStorage });
const clockifyHistoryScan = createClockifyHistoryScanService({ storageSession: clockifyMigrationStorage });

function isNotFound(error) { return error?.status === 404 || error?.code === 'not_found'; }

function githubForConfig(config) {
  return new GitHubClient({
    credentialProvider: currentCredentialProvider,
    owner: config.owner, repo: config.repo, branch: config.branch || 'main',
    expectedRepositoryId: config.repoId || null,
    branchMode: config.branchMode || 'custom',
  });
}

async function clockifyUrlClassifierArtifact() {
  const response = await fetch(chrome.runtime.getURL('src/assets/clockify-url-classifier-model-v1.json'));
  if (!response.ok) throw new Error('Clockify URL classifier artifact is unavailable.');
  return response.json();
}

async function resolveClockifyCapturedUrls(entries, config, { onCatalogReady = null } = {}) {
  if (onCatalogReady !== null && typeof onCatalogReady !== 'function') throw new TypeError('Clockify URL-resolution phase callback is invalid.');
  const catalog = await new InstallationDiscoveryService({ github: githubForConfig(config) }).discover();
  onCatalogReady?.();
  const modelArtifact = await clockifyUrlClassifierArtifact();
  return resolveClockifyUrlSuggestions({ entries, repositories: catalog.repositories, modelArtifact });
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
  return {
    message: error?.message || 'Unexpected error',
    code: error?.name === 'AbortError' ? 'aborted' : error?.code || 'error',
    status: error?.status || 0,
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

function isClockifyProgressRequestId(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function emitClockifyMigrationProgress(requestId, progress) {
  const stages = new Set([
    'resolving_identities', 'preparing_storage', 'verifying_storage', 'reading_existing_records',
    'preparing_records', 'matching_replay_targets', 'normalizing_intervals', 'building_records', 'validating_output',
    'writing_records', 'completed',
  ]);
  const port = clockifyMigrationProgressPorts.get(requestId);
  if (!port || !stages.has(progress?.stage)
      || !Number.isSafeInteger(progress.completed) || !Number.isSafeInteger(progress.total)
      || progress.completed < 0 || progress.total < progress.completed) return;
  try {
    port.postMessage({
      type: 'CLOCKIFY_MIGRATION_PROGRESS', phase: progress.stage, completedUsers: progress.completed, totalUsers: progress.total,
      ...(Number.isSafeInteger(progress.elapsedMs) && progress.elapsedMs >= 0 ? { elapsedMs: progress.elapsedMs } : {}),
    });
  } catch {}
}

function emitClockifyCaptureParseProgress(tabId, progress) {
  if (!Number.isInteger(tabId) || !Number.isSafeInteger(progress?.completedRows) || !Number.isSafeInteger(progress?.totalRows)
      || progress.completedRows < 0 || progress.totalRows < progress.completedRows) return;
  try {
    chrome.tabs.sendMessage(tabId, {
      type: CLOCKIFY_CAPTURE_PARSE_PROGRESS,
      completedRows: progress.completedRows,
      totalRows: progress.totalRows,
    }, () => void chrome.runtime.lastError);
  } catch {}
}

function emitClockifyCapturePhase(tabId, { phase, entryCount, year = null }) {
  if (!Number.isInteger(tabId) || !CLOCKIFY_CAPTURE_PHASES.has(phase)
      || !Number.isSafeInteger(entryCount) || entryCount < 0
      || (year !== null && (!Number.isInteger(year) || year < 2000 || year > 2100))) return;
  try {
    chrome.tabs.sendMessage(tabId, {
      type: CLOCKIFY_CAPTURE_PHASE, phase, entryCount, year,
    }, () => void chrome.runtime.lastError);
  } catch {}
}

function completeClockifyCapture({ tabId, year, data }) {
  return completeClockifyHistoryCapture({
    tabId, year, data,
    appendHistory: (capturedYear, capturedData) => clockifyHistoryScan.append(capturedYear, capturedData),
    armCapture: capturedTabId => clockifyCaptureArm.arm(capturedTabId),
    disarmCapture: capturedTabId => clockifyCaptureArm.disarm(capturedTabId),
    measure: (name, elapsedMs, count) => clockifyCaptureProfile.measure(name, elapsedMs, count),
    configuredSnapshot,
    resolveUrls: resolveClockifyCapturedUrls,
    createPreview: preview => clockifyMigrationSession.create(preview),
    peekPreview: () => clockifyMigrationSession.peek(),
    openPreview: () => chrome.tabs.create({ url: chrome.runtime.getURL('src/clockify-migration/preview.html') }),
    emitPhase: emitClockifyCapturePhase,
    now: () => performance.now(),
  });
}

chrome.runtime.onConnect.addListener(port => {
  const previewUrl = chrome.runtime.getURL('src/clockify-migration/preview.html');
  if (port.name !== CLOCKIFY_MIGRATION_PROGRESS_PORT || port.sender?.id !== chrome.runtime.id || port.sender?.url !== previewUrl) {
    port.disconnect(); return;
  }
  let requestId = null;
  port.onMessage.addListener(message => {
    if (requestId || !message || typeof message !== 'object' || Array.isArray(message)
        || Object.keys(message).length !== 2 || message.type !== 'SUBSCRIBE_CLOCKIFY_MIGRATION_PROGRESS'
        || !isClockifyProgressRequestId(message.requestId)) { port.disconnect(); return; }
    requestId = message.requestId;
    clockifyMigrationProgressPorts.set(requestId, port);
    port.postMessage({ type: 'CLOCKIFY_MIGRATION_PROGRESS_SUBSCRIBED' });
  });
  port.onDisconnect.addListener(() => { if (requestId && clockifyMigrationProgressPorts.get(requestId) === port) clockifyMigrationProgressPorts.delete(requestId); });
});

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

async function loadTaskParticipants(message, sender, extensionOrigin) {
  const loadEpoch = await loadCoordinator.beginLoad();
  await store.ensureDataVersion(4); loadCoordinator.assertCurrent(loadEpoch);
  const { config, auth, generation } = await configuredSnapshot(); loadCoordinator.assertCurrent(loadEpoch);
  const taskUrl = taskUrlForStart(message.taskUrl, sender, extensionOrigin);
  if (!config || !auth) return { configured: false, taskUrl, complete: false, participants: [] };
  const branch = config.branch || 'main', repositoryKey = `${config.owner}/${config.repo}@${branch}`;
  const requestOwner = sender?.documentId ?? sender?.tab?.id ?? sender?.url ?? 'content';
  const loadKey = `${repositoryKey}:participants:${requestOwner}`;
  const previous = reportLoads.get(loadKey);
  if (previous) {
    previous.controller.abort();
    await previous.promise.catch(() => {});
    loadCoordinator.assertCurrent(loadEpoch);
  }
  const controller = new AbortController(), github = githubForConfig(config);
  const reports = new ReportService({ github, cache: store });
  const loadGuard = { signal: controller.signal, assertCurrent: () => loadCoordinator.assertCurrent(loadEpoch) };
  const promise = (async () => {
    let { user } = await store.getState();
    user = config.storageLogin || user || auth.githubLogin;
    if (!user) {
      user = await github.getAuthenticatedUser(); controller.signal.throwIfAborted();
      if (!await store.patchStateIfGeneration({ user }, generation)) {
        throw new DOMException('Participant load was superseded by a configuration change.', 'AbortError');
      }
    }
    const tracker = new TrackerService({
      github, store, user,
      actorId: Number.isSafeInteger(auth.githubUserId) ? `github:${auth.githubUserId}` : `clockoli:${config.repoId}:${user}`,
      actorName: user, recentDays: config.recentDays || 7,
    });
    await refreshTaskState(executor, store, tracker, generation, loadGuard);
    const records = await reports.loadRepositoryTask(taskUrl, {
      defaultBranch: config.defaultBranch || branch, signal: controller.signal,
    });
    const timerState = await finalizeTaskLoad(executor, store, tracker, generation, loadGuard);
    return {
      configured: true, taskUrl, complete: true,
      participants: aggregateTaskParticipants(records, {
        taskUrl, currentUser: user, active: timerState.active, pendingWrites: timerState.pendingWrites,
      }),
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
    const recent = await reports.loadRepositoryUserRange(message.payload || {}, {
      defaultBranch: config.defaultBranch || branch, githubUserId: auth.githubUserId, user, includeStorageMetadata: true, signal: controller.signal,
    }, {
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
    const records = await reports.loadRepositoryUserRange(message.payload || {}, {
      defaultBranch: config.defaultBranch || branch, githubUserId: auth.githubUserId, user, signal: controller.signal,
    });
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
  'LOAD_REPORT', 'LOAD_TASK_PARTICIPANTS', 'LOAD_TASKS', 'LOAD_TIMES', 'GET_STATE', 'GET_PAGE_STATE', 'START', 'SWITCH_TASK', 'STOP', 'SYNC',
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
  if (message.type === 'CLOCKIFY_ARM_CSV_CAPTURE') {
    if (!Number.isInteger(sender?.tab?.id)) throw new Error('Clockify CSV capture arming requires a browser tab');
    await Promise.all([clockifyHistoryScan.reset(), clockifyCaptureProfile.start(message.startedAt)]);
    const discovery = await clockifyHistoryScan.start('csv');
    await clockifyCaptureArm.arm(sender.tab.id);
    return { armed: true, discovery };
  }
  if (message.type === 'CLOCKIFY_ARM_CAPTURE') {
    if (!Number.isInteger(sender?.tab?.id)) throw new Error('Clockify capture arming requires a browser tab');
    await Promise.all([clockifyHistoryScan.reset(), clockifyCaptureProfile.start(message.startedAt)]);
    const discovery = await clockifyHistoryScan.start('report');
    await clockifyCaptureArm.arm(sender.tab.id);
    return { armed: true, discovery };
  }
  if (message.type === 'CLOCKIFY_IS_CAPTURE_ARMED') {
    if (!Number.isInteger(sender?.tab?.id)) throw new Error('Clockify capture lookup requires a browser tab');
    const armed = await clockifyCaptureArm.isArmed(sender.tab.id);
    return { armed, history: armed ? await clockifyHistoryScan.status() : null };
  }
  if (message.type === 'CLOCKIFY_DISARM_CAPTURE') {
    if (!Number.isInteger(sender?.tab?.id)) throw new Error('Clockify capture disarming requires a browser tab');
    await Promise.all([clockifyCaptureArm.disarm(sender.tab.id), clockifyHistoryScan.reset(), clockifyCaptureProfile.clear()]);
    return { disarmed: true };
  }
  if (message.type === 'CLOCKIFY_YEAR_OBSERVED') {
    if (!Number.isSafeInteger(message.entryCount) || message.entryCount < 0 || !Number.isInteger(message.year) || !Number.isInteger(sender?.tab?.id)) {
      throw new Error('Invalid Clockify report-year observation');
    }
    try {
      const discovery = await clockifyHistoryScan.observeYear(message.year, message.entryCount);
      await clockifyCaptureArm.arm(sender.tab.id);
      return discovery.discovering ? { discovering: true, ...discovery } : { capturing: true, ...discovery };
    } catch (error) {
      await Promise.all([clockifyCaptureArm.disarm(sender.tab.id), clockifyHistoryScan.reset(), clockifyCaptureProfile.clear()]);
      return { observed: false, reason: error instanceof Error ? error.message : 'unknown failure' };
    }
  }
  if (message.type === 'CLOCKIFY_CAPTURED_CSV') {
    if (typeof message.text !== 'string' || !Number.isInteger(sender?.tab?.id)) throw new Error('Invalid Clockify CSV capture');
    try {
      const captured = await normalizeClockifyDetailedCsv(message.text, {
        profile: true,
        onProgress: progress => emitClockifyCaptureParseProgress(sender.tab.id, progress),
      });
      const normalized = captured.data;
      await Promise.all([
        clockifyCaptureProfile.measure('csv_parse', captured.profile.parseMs, captured.profile.rowCount),
        clockifyCaptureProfile.measure('csv_source_digest', captured.profile.sourceDigestMs, captured.profile.byteCount),
        clockifyCaptureProfile.measure('csv_row_normalization', captured.profile.normalizeRowsMs, captured.profile.rowCount),
      ]);
      console.info('[Clockoli Clockify CSV profile]', JSON.stringify(captured.profile));
      // The sender URL can be stale after Clockify's SPA route transition.
      // Validate Chrome's current tab URL so an export cannot be attributed to
      // the wrong annual scan step.
      const tab = await chrome.tabs.get(sender.tab.id);
      const year = clockifyDetailedReportYear(tab?.url || '');
      const scan = await clockifyHistoryScan.status();
      if (scan?.phase === 'discovering') {
        const discovery = await clockifyHistoryScan.observeYear(year, normalized.entries.length);
        await clockifyCaptureArm.arm(sender.tab.id);
          return discovery.discovering ? { discovering: true, ...discovery } : { capturing: true, ...discovery };
      }
      if (scan?.phase !== 'capturing') throw new Error('Clockify CSV history capture plan is unavailable');
      assertClockifyAnnualDataYear(normalized, year);
      return completeClockifyCapture({ tabId: sender.tab.id, year, data: normalized });
    } catch (error) {
      await Promise.all([clockifyCaptureArm.disarm(sender.tab.id), clockifyHistoryScan.reset(), clockifyCaptureProfile.clear()]);
      return { captured: false, stage: 'normalizing_csv', reason: error instanceof Error ? error.message : 'unknown failure' };
    }
  }
  if (message.type === 'CLOCKIFY_CAPTURED_REPORT') {
    if (typeof message.text !== 'string') throw new Error('Invalid Clockify report capture');
    if (!Number.isInteger(sender?.tab?.id)) throw new Error('Clockify capture requires a browser tab');
    let stage = 'normalizing';
    try {
      const profileStartedAt = performance.now();
      console.info('[Clockoli Clockify capture background]', stage);
      const normalized = normalizeClockifyDetailedReport(message.text);
      const normalizedAt = performance.now();
      const source = JSON.parse(message.text);
      const expectedEntries = source?.totals?.[0]?.entriesCount;
      if (!Number.isSafeInteger(expectedEntries) || expectedEntries < 0) throw new Error('Invalid Clockify report total');
      // Runtime sender URLs are the document URL from when a content script
      // was injected and can be stale after Clockify's SPA route transition.
      // Read Chrome's current tab URL instead, then validate its exact annual
      // Detailed Report range before using it as history-scan identity.
      const tab = await chrome.tabs.get(sender.tab.id);
      const year = clockifyDetailedReportYear(tab?.url || '');
      const scan = await clockifyHistoryScan.status();
      if (scan?.phase === 'discovering') {
        stage = 'discovering_history';
        const discovery = await clockifyHistoryScan.observeYear(year, expectedEntries);
        await clockifyCaptureArm.arm(sender.tab.id);
          return discovery.discovering ? { discovering: true, ...discovery } : { capturing: true, ...discovery };
      }
      if (scan?.phase !== 'capturing') throw new Error('Clockify history capture plan is unavailable');
      assertClockifyAnnualDataYear(normalized, year);
      const { skippedEntryCount = 0, ...normalizedPage } = normalized;
      const pageIsFinal = source.timeentries.length < 200;
      console.info('[Clockoli Clockify capture background]', JSON.stringify({
        stage: 'append_page', tabId: sender.tab.id, expectedEntries, skippedEntryCount, pageEntries: normalizedPage.entries.length, pageIsFinal,
      }));
      const report = await clockifyCaptureArm.appendPage(sender.tab.id, normalizedPage, skippedEntryCount, pageIsFinal);
      const appendedAt = performance.now();
      console.info('[Clockoli Clockify capture background]', JSON.stringify({
        event: 'page_profile', pageEntries: normalizedPage.entries.length, expectedEntries, pageIsFinal,
        normalizeMs: normalizedAt - profileStartedAt, appendMs: appendedAt - normalizedAt,
        totalMs: appendedAt - profileStartedAt,
      }));
      if (!report.complete) return { nextPage: true };
      stage = 'collecting_history';
      console.info('[Clockoli Clockify capture background]', stage);
      return completeClockifyCapture({ tabId: sender.tab.id, year, data: report.data });
    } catch (error) {
      await clockifyCaptureArm.disarm(sender.tab.id);
      await Promise.all([clockifyHistoryScan.reset(), clockifyCaptureProfile.clear()]);
      console.info('[Clockoli Clockify capture background]', `failed:${stage}`);
      const diagnostic = error instanceof Error && error.diagnostic && typeof error.diagnostic === 'object'
        ? error.diagnostic : undefined;
      return {
        captured: false, stage, reason: error instanceof Error ? error.message : 'unknown failure',
        ...(diagnostic ? { diagnostic } : {}),
      };
    }
  }
  if (message.type === 'GET_CLOCKIFY_MIGRATION_PREVIEW') {
    const preview = await clockifyMigrationSession.peek();
    if (!preview) throw new Error('The Clockify migration preview is unavailable or expired. Return to the Clockify report and capture it again.');
    return { id: preview.id, users: preview.data.users, entries: preview.data.entries.length, profile: await clockifyCaptureProfile.read() };
  }
  if (message.type === 'GET_CLOCKIFY_MIGRATION_SUGGESTIONS') {
    const { config, auth } = await configuredSnapshot();
    if (!config || !auth) return { logins: [] };
    try { return { logins: await githubForConfig(config).listRepositoryCollaboratorLogins() }; }
    catch { return { logins: [] }; }
  }
  if (message.type === 'CONFIRM_CLOCKIFY_MIGRATION') {
    const payload = message.payload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)
        || Object.keys(payload).length !== 3 || typeof payload.id !== 'string' || !Array.isArray(payload.mappings)
        || !isClockifyProgressRequestId(payload.requestId) || !clockifyMigrationProgressPorts.has(payload.requestId)) {
      throw new Error('Invalid Clockify migration confirmation');
    }
    const data = await clockifyMigrationSession.consume(payload.id);
    if (!data) throw new Error('The Clockify migration confirmation expired. Return to the report and capture it again.');
    const { config, auth } = await configuredSnapshot();
    if (!config || !auth) throw new Error('Connect a Clockoli GitHub repository before importing.');
    try {
      const destinationUser = {
        id: auth.githubUserId,
        login: config.storageLogin || auth.githubLogin,
      };
      const outcomes = await importClockifyOrganization({
        sourceUsers: data.users, entries: data.entries, mappings: payload.mappings,
        github: githubForConfig(config), destinationUser,
        onProgress: progress => emitClockifyMigrationProgress(payload.requestId, progress),
      });
      return { outcomes: outcomes.map(({ sourceUserId, status, added, alreadyPresent, failureReason, repair, diagnostic, error }) => {
        const safeDiagnostic = diagnostic?.stage === 'preparing_destination_record'
          && ['destination_record_schema', 'destination_active_timer_schema', 'destination_duplicate_record_id', 'destination_source_identity', 'destination_record_identity', 'destination_time_context', 'destination_producer', 'destination_actor', 'destination_metadata', 'destination_description', 'destination_task', 'destination_record_validation'].includes(diagnostic.code)
          ? { stage: diagnostic.stage, code: diagnostic.code, ...(typeof diagnostic.detail === 'string' && /^[A-Za-z][A-Za-z0-9 _:-]{0,120}$/.test(diagnostic.detail) ? { detail: diagnostic.detail } : {}) } : null;
        const safeRepair = repair?.kind === 'monthly_partition_mismatch'
          && typeof repair.path === 'string' && /^times\/\d{4}-(?:0[1-9]|1[0-2])\/[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\.jsonl$/.test(repair.path)
          && Number.isSafeInteger(repair.line) && repair.line > 0
          && /^\d{4}-(?:0[1-9]|1[0-2])$/.test(repair.actualMonth)
          && /^\d{4}-(?:0[1-9]|1[0-2])$/.test(repair.expectedMonth)
          ? { kind: repair.kind, path: repair.path, line: repair.line, actualMonth: repair.actualMonth, expectedMonth: repair.expectedMonth } : null;
        return {
          sourceUserId, status,
          ...(Number.isSafeInteger(added) ? { added } : {}),
          ...(Number.isSafeInteger(alreadyPresent) ? { alreadyPresent } : {}),
          ...(typeof failureReason === 'string' ? { failureReason } : {}),
          ...(safeRepair ? { repair: safeRepair } : {}),
          ...(safeDiagnostic ? { diagnostic: safeDiagnostic } : {}),
          ...(!failureReason && typeof error?.reason === 'string' ? { failureReason: error.reason } : {}),
        };
      }) };
    } finally { clockifyMigrationProgressPorts.delete(payload.requestId); }
  }
  if (message.type === 'CLEANUP_CLOCKIFY_TEST_IMPORTS') {
    if (!message.payload || Object.keys(message.payload).length !== 1 || message.payload.confirmation !== 'DELETE_CLOCKIFY_TEST_IMPORTS') {
      throw new Error('Invalid Clockify test-import cleanup confirmation');
    }
    const { config, auth } = await configuredSnapshot();
    if (!config || !auth) throw new Error('Connect a Clockoli GitHub repository before cleaning imported records.');
    return removeClockifyImportedTestRecords({ github: githubForConfig(config) });
  }
  if (message.type === 'DELETE_ALL_CLOCKOLI_RECORDS') {
    if (!message.payload || Object.keys(message.payload).length !== 1 || message.payload.confirmation !== 'DELETE_ALL_CLOCKOLI_RECORDS') {
      throw new Error('Invalid Clockoli record-deletion confirmation');
    }
    const { config, auth } = await configuredSnapshot();
    if (!config || !auth) throw new Error('Connect a Clockoli GitHub repository before deleting work records.');
    return removeAllClockoliRecords({ github: githubForConfig(config) });
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
  if (message.type === 'GET_ADDON_SETTINGS') return store.getAddonSettings();
  if (message.type === 'SET_ADDON_ENABLED') {
    if (!message.payload || typeof message.payload !== 'object' || Array.isArray(message.payload)
        || Object.keys(message.payload).length !== 2 || typeof message.payload.id !== 'string'
        || typeof message.payload.enabled !== 'boolean') throw new Error('Invalid add-on enablement request');
    return setAddonEnabled({ store, permissions: chrome.permissions }, message.payload.id, message.payload.enabled);
  }

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
  if (message.type === 'LOAD_TASK_PARTICIPANTS') return loadTaskParticipants(message, sender, extensionOrigin);
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
  const reportReadOnly = ['LOAD_REPORT', 'LOAD_TASK_PARTICIPANTS', 'CANCEL_REPORT', 'GET_EXCHANGE_RATES'].includes(message?.type);
  const localStateRead = ['GET_STATE', 'GET_PAGE_STATE'].includes(message?.type) && !message?.refresh;
  const readOnly = reportReadOnly || localStateRead || ['LOAD_TASKS', 'LOAD_TIMES', 'GET_ONBOARDING_STATE', 'RESUME_DEVICE_FLOW', 'DISCOVER_REPOSITORIES', 'GET_CLOCKIFY_MIGRATION_PREVIEW', 'GET_CLOCKIFY_MIGRATION_SUGGESTIONS'].includes(message?.type);
  const changesConfiguration = ['SAVE_CONFIG', 'UPDATE_DISPLAY_PREFERENCES', 'IMPORT_SETTINGS', 'CHECK_REPOSITORY_ACCESS', 'SELECT_REPOSITORY', 'DISCONNECT_GITHUB_APP', 'CLEAR_LOCAL_CONFIGURATION', 'SET_ADDON_ENABLED'].includes(message?.type);
  let operation;
  if (changesConfiguration) {
    try {
      assertMessageAllowed(message.type, sender, chrome.runtime.getURL(''));
      operation = acceptanceExecutor.run(() => loadCoordinator.save(() => cancelReports(), () => handle(message, sender)));
    } catch (error) { operation = Promise.reject(error); }
  } else {
    const direct = readOnly || DIRECT_DEVICE_FLOW_MESSAGES.has(message?.type)
      || ['CLOCKIFY_ARM_CAPTURE', 'CLOCKIFY_ARM_CSV_CAPTURE', 'CLOCKIFY_IS_CAPTURE_ARMED', 'CLOCKIFY_DISARM_CAPTURE', 'CLOCKIFY_YEAR_OBSERVED', 'CLOCKIFY_CAPTURED_CSV', 'CLOCKIFY_CAPTURED_REPORT'].includes(message?.type);
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
