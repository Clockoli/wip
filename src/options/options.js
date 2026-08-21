import { onboardingStep, selectOnlyEligibleRepository, settleBeforeDeadline } from './onboarding-flow.js';

const $ = id => document.getElementById(id);
let state = null;
let repositories = [];
let selectedRepository = null;
let pollTimer = null;
let showOnboarding = false;
let discoveryPromise = null;
let githubHandoff = false;
let discoveryStatus = 'idle';
let setupCancelled = false;
let repositoryMonitorTimer = null;
let repositoryMonitorDeadline = 0;
let repositoryMonitorLastError = null;
let repositoryMonitorRetryPending = false;
let repositoryMonitorExpectedName = '';
let repositoryChoiceMade = false;
let repositoryAccessDetected = false;
let repositoryChoiceMode = '';
let renderedOnboardingStep = null;
let repositoryChoiceSummary = 'Repository setup option chosen';

function message(text, kind = '') {
  $('message').textContent = text;
  $('message').className = kind;
}

function send(request) {
  return new Promise((resolve, reject) => chrome.runtime.sendMessage(request, response => {
    if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
    if (!response?.ok) return reject(Object.assign(new Error(response?.error?.message || 'Extension request failed'), response?.error));
    resolve(response.data);
  }));
}

function githubUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'github.com' ? url.href : '';
  } catch { return ''; }
}

function setLink(id, value) {
  const element = $(id), url = githubUrl(value);
  element.hidden = !url;
  if (url) element.href = url;
  else element.removeAttribute('href');
}

function showRecovery(error = null) {
  const recovery = globalThis.RepoClockRecovery.actionFor(error?.code);
  const actions = $('recovery-actions');
  const connect = recovery?.kind === 'connect';
  const reviewAccess = ['grant', 'choose', 'repair'].includes(recovery?.kind);
  const retry = recovery?.kind === 'retry';
  const reviewUrl = githubUrl(state?.installationUrl);
  $('recovery-connect').hidden = !connect;
  $('recovery-grant').textContent = 'Review repository access on GitHub';
  $('recovery-grant').hidden = !reviewAccess || !reviewUrl;
  $('recovery-retry').hidden = !retry;
  actions.hidden = !(connect || (reviewAccess && reviewUrl) || retry);
}

function isAppAuthorized() {
  return state?.candidateAuth?.mode === 'github_app' || state?.auth?.mode === 'github_app';
}

function renderOnboardingProgress() {
  const authorized = isAppAuthorized();
  const step = onboardingStep({
    authorized,
    repositoryChoiceMade,
    repositoryAccessDetected,
    deviceAttempt: Boolean(state?.deviceAttempt),
    discoveryStatus,
    repositories,
  });
  $('current-step').textContent = String(step);
  $('progress-fill').style.width = `${(step / 4) * 100}%`;
  const previousStep = renderedOnboardingStep;
  renderedOnboardingStep = step;
  for (const [number, id] of [[1, 'device-step'], [2, 'access-step'], [3, 'repository-access-step'], [4, 'repository-step']]) {
    const element = $(id);
    element.hidden = number !== step;
  }
  $('device-complete').hidden = step === 1;
  $('device-account').textContent = authorized && (state?.candidateAuth?.githubLogin || state?.auth?.githubLogin)
    ? ` as ${state.candidateAuth?.githubLogin || state.auth?.githubLogin}` : '';
  $('access-complete').hidden = step < 3;
  $('repository-access-complete').hidden = step < 4;
  $('repository-choice-summary').textContent = repositoryChoiceSummary;
  if (previousStep !== null && previousStep !== step) {
    queueMicrotask(() => $({ 1: 'device-step-title', 2: 'access-step-title', 3: 'repository-access-step-title', 4: 'repository-step-title' }[step]).focus());
  }
}

function renderState() {
  const connected = state.ready && !showOnboarding;
  $('connected').hidden = !connected;
  $('onboarding').hidden = connected;
  $('display-settings').hidden = !state.config;
  $('onboarding-flow').hidden = setupCancelled;
  $('setup-cancelled').hidden = !setupCancelled;
  $('build-warning').hidden = state.appConfigured;
  $('authorize').disabled = !state.appConfigured;
  $('connection-status').textContent = state.ready ? (state.auth?.mode === 'pat' ? 'Connected with PAT' : 'Connected') : (state.candidateAuth ? 'Setup in progress' : 'Not connected');
  $('connection-status').className = `badge${state.ready ? ' ready' : ''}`;

  if (state.config) {
    $('connected-account').textContent = state.auth?.githubLogin || (state.auth?.mode === 'pat' ? 'Personal access token' : '—');
    $('connected-repository-link').textContent = `${state.config.owner}/${state.config.repo}`;
    $('connected-branch').textContent = state.config.branch || 'main';
    const verification = state.verificationStatus === 'write_verified' ? 'Write verified'
      : state.verificationStatus === 'access_checked' ? 'Access checked' : 'Not checked';
    $('connected-storage').textContent = `Private · Format ${state.config.repositoryFormatVersion || 'legacy'} · ${verification}`;
    $('owner').value = state.config.owner || '';
    $('repo').value = state.config.repo || '';
    $('branch').value = state.config.branch || 'main';
    $('recent-days').value = state.config.recentDays || 7;
  }
  $('save-display').disabled = !state.config;
  setLink('revoke', state.authorizationSettingsUrl);
  setLink('recovery-grant', state.installationUrl);
  $('revoke-action').hidden = state.auth?.mode !== 'github_app';
  setLink('install-app', state.installationUrl);
  setLink('new-repository', state.newRepositoryUrl);
  setLink('connected-repository-link', state.trackingRepositoryUrl);

  if (state.deviceAttempt) renderDeviceAttempt(state.deviceAttempt);
  else $('device-panel').hidden = true;
  $('authorize-panel').hidden = Boolean(state.deviceAttempt || state.candidateAuth);
  renderOnboardingProgress();
  if (!connected && !setupCancelled && isAppAuthorized() && discoveryStatus === 'idle' && !state.deviceAttempt) {
    void discoverRepositories().catch(() => {});
  }
}

function renderDeviceAttempt(attempt) {
  $('device-panel').hidden = false;
  $('authorize-panel').hidden = true;
  if (attempt.status === 'requesting') {
    $('device-code').value = 'Requesting code…';
    $('copy-code').disabled = true;
    $('device-done').hidden = true;
    setLink('open-device-page', '');
    $('device-wait').textContent = 'Starting secure GitHub authorization…';
    schedulePoll(attempt);
    return;
  }
  $('device-code').value = attempt.userCode;
  $('copy-code').disabled = false;
  $('device-done').hidden = false;
  $('device-done').disabled = false;
  setLink('open-device-page', attempt.verificationUri);
  const seconds = Math.max(0, Math.ceil((attempt.expiresAt - Date.now()) / 1000));
  $('device-wait').textContent = `RepoClock checks automatically every few seconds · code expires in ${Math.ceil(seconds / 60)} min`;
  schedulePoll(attempt);
}

function schedulePoll(attempt) {
  clearTimeout(pollTimer);
  const delay = Math.max(0, Number(attempt.nextPollAt || Date.now()) - Date.now());
  pollTimer = setTimeout(() => void poll(attempt.attemptId), delay);
}

async function poll(attemptId) {
  try {
    const result = await send({ type: 'POLL_DEVICE_FLOW', attemptId });
    if (result.status === 'authorized') {
      message(`Device activation complete for ${result.githubLogin}. Next, give RepoClock access to a data repository.`, 'success');
      discoveryStatus = 'idle';
      await refreshState();
      await discoverRepositories().catch(() => {});
      return;
    }
    state.deviceAttempt = result;
    renderDeviceAttempt(result);
  } catch (error) {
    if (['auth_denied', 'device_code_expired', 'device_flow_superseded', 'device_attempt_missing'].includes(error.code)) {
      state.deviceAttempt = null;
      $('device-panel').hidden = true;
      $('authorize-panel').hidden = false;
      message(error.message, 'error');
      return;
    }
    $('device-wait').textContent = `${error.message} Retrying authorization…`;
    message(`${error.message} Retrying authorization…`, 'error');
    pollTimer = setTimeout(() => void poll(attemptId), 5000);
  }
}

function repositoryReason(repository) {
  const labels = {
    private_required: 'private repositories only', archived: 'archived', disabled: 'disabled',
    app_contents_write_required: 'RepoClock needs Contents: write',
    user_write_required: 'your account cannot write',
    initialized_default_branch_required: 'initialize a default branch first',
  };
  return repository.reasons.map(reason => labels[reason] || 'unavailable').join(', ');
}

function renderRepositoryList() {
  const query = $('repository-search').value.trim().toLowerCase();
  const visible = repositories.filter(repository => !query || repository.fullName.toLowerCase().includes(query));
  const root = $('repository-list');
  root.replaceChildren();
  if (!visible.length) {
    const empty = document.createElement('p'); empty.className = 'help';
    empty.textContent = repositories.length ? 'No repository matches this search.' : 'No repositories are visible. Install RepoClock or grant repository access on GitHub, then check again.';
    root.append(empty); return;
  }
  for (const repository of visible) {
    const label = document.createElement('label');
    label.className = `repository-option${repository.eligible ? '' : ' unavailable'}`;
    const radio = document.createElement('input');
    radio.type = 'radio'; radio.name = 'repository'; radio.disabled = !repository.eligible;
    radio.value = `${repository.installationId}:${repository.repoId}`;
    radio.checked = selectedRepository?.installationId === repository.installationId && selectedRepository?.repoId === repository.repoId;
    const copy = document.createElement('span');
    const name = document.createElement('strong'); name.textContent = repository.fullName;
    copy.append(name);
    if (repository.needsInitialization || !repository.eligible) {
      const details = document.createElement('small');
      details.textContent = repository.needsInitialization
        ? 'Empty repository — RepoClock will create the first commit automatically.'
        : `Unavailable · ${repositoryReason(repository)}`;
      copy.append(details);
    }
    label.append(radio, copy); root.append(label);
    radio.addEventListener('change', () => { selectedRepository = repository; $('connect-repository').disabled = false; });
  }
}

function renderRepositories(result) {
  const previousSelection = selectedRepository;
  repositories = result.repositories;
  if (repositories.length && !repositoryChoiceMade) { repositoryChoiceMade = true; repositoryChoiceMode = 'existing'; repositoryChoiceSummary = 'Using an existing repository'; }
  repositoryAccessDetected = repositoryChoiceMode === 'create'
    ? repositories.some(repository => repository.repo === 'repoclock-data')
    : repositories.length > 0;
  const expectedRepository = repositoryChoiceMode === 'create'
    ? repositories.find(repository => repository.repo === 'repoclock-data' && repository.eligible)
    : null;
  selectedRepository = expectedRepository || repositories.find(repository => previousSelection
    && repository.installationId === previousSelection.installationId
    && repository.repoId === previousSelection.repoId
    && repository.eligible) || selectOnlyEligibleRepository(repositories);
  $('connect-repository').disabled = !selectedRepository;
  $('repository-search').value = '';
  $('repository-search-label').hidden = repositories.length < 10;
  renderRepositoryList();
  renderOnboardingProgress();
}

async function discoverRepositories({ monitoring = false, deadline = 0 } = {}) {
  const remaining = deadline ? deadline - Date.now() : 30_000;
  const timeoutMs = Math.max(0, Math.min(30_000, remaining));
  const timeoutCode = deadline && remaining <= 30_000 ? 'repository_monitor_timeout' : 'github_discovery_timeout';
  const bounded = promise => settleBeforeDeadline(promise, timeoutMs, () => Object.assign(new Error('GitHub did not respond in time.'), { code: timeoutCode }));
  if (discoveryPromise) return bounded(discoveryPromise);
  discoveryStatus = 'loading';
  renderOnboardingProgress();
  discoveryPromise = (async () => {
    if (!monitoring) $('refresh-repositories').disabled = true;
    if (!monitoring) message('Refreshing RepoClock installation and repository access…');
    showRecovery();
    try {
      const result = await bounded(send({ type: 'DISCOVER_REPOSITORIES' }));
      discoveryStatus = 'ready';
      renderRepositories(result);
      const relevantCandidates = repositoryChoiceMode === 'create'
        ? result.candidates.filter(repository => repository.repo === 'repoclock-data')
        : result.candidates;
      if (!repositoryAccessDetected && repositoryChoiceMode === 'create') {
        message('RepoClock still cannot see repoclock-data. Grant that repository access on GitHub; automatic checking will continue.');
      } else if (relevantCandidates.length === 1) {
        message('Repository access was detected and the eligible data repository was selected automatically. Validate it to finish setup.', 'success');
      } else if (relevantCandidates.length > 1) {
        message('Repository access was detected. Choose the private repository that should store RepoClock data.');
      } else if (result.repositories.length) {
        message('Repository access was detected, but none can be used yet. Review each repository below for the reason.');
      } else {
        message('Device activation is complete—nothing went wrong. Next, choose access on GitHub for a private data repository.');
      }
      return result;
    } catch (error) {
      discoveryStatus = 'error';
      renderOnboardingProgress();
      if (!monitoring) message(error.message, 'error');
      throw error;
    } finally {
      if (!monitoring) $('refresh-repositories').disabled = false;
      discoveryPromise = null;
    }
  })();
  return discoveryPromise;
}

function stopRepositoryMonitoring() {
  clearTimeout(repositoryMonitorTimer);
  repositoryMonitorTimer = null;
  repositoryMonitorDeadline = 0;
  repositoryMonitorExpectedName = '';
}

function finishRepositoryMonitoring() {
  const detail = repositoryMonitorLastError?.message ? ` Last error: ${repositoryMonitorLastError.message}` : '';
  stopRepositoryMonitoring();
  repositoryMonitorRetryPending = true;
  discoveryStatus = 'error';
  renderOnboardingProgress();
  message(`RepoClock stopped checking after five minutes.${detail} Review repository access on GitHub, then select Retry.`, 'error');
  showRecovery({ code: 'repository_monitor_timeout' });
}

async function monitorRepositories() {
  if (!repositoryMonitorDeadline || state?.ready) {
    stopRepositoryMonitoring();
    return;
  }
  if (Date.now() >= repositoryMonitorDeadline) {
    finishRepositoryMonitoring();
    return;
  }
  try {
    const result = await discoverRepositories({ monitoring: true, deadline: repositoryMonitorDeadline });
    const accessedRepository = repositoryMonitorExpectedName
      ? result.repositories.find(repository => repository.repo === repositoryMonitorExpectedName)
      : result.repositories[0];
    if (accessedRepository) {
      repositoryMonitorLastError = null;
      repositoryMonitorRetryPending = false;
      stopRepositoryMonitoring();
      message(selectedRepository
        ? 'Repository access was detected. Validate the selected repository to finish setup.'
        : result.candidates.length
          ? 'Repository access was detected. Choose the repository RepoClock should use.'
          : 'Repository access was detected, but the repository cannot be used yet. Review its availability reason.');
      return;
    }
    message(repositoryMonitorExpectedName
      ? `RepoClock still cannot see ${repositoryMonitorExpectedName}. On GitHub, choose access, select Only select repositories, and add ${repositoryMonitorExpectedName}. Automatic checking will continue.`
      : 'RepoClock still cannot see an eligible repository. On GitHub, choose access, select Only select repositories, and add your data repository. Automatic checking will continue.');
  } catch (error) {
    if (error.code === 'repository_monitor_timeout') {
      finishRepositoryMonitoring();
      return;
    }
    repositoryMonitorLastError = error;
    message(`Could not check GitHub: ${error.message} RepoClock will keep retrying.`, 'error');
    showRecovery(error);
  }
  repositoryMonitorTimer = setTimeout(() => void monitorRepositories(), 2500);
}

function startRepositoryMonitoring(expectedName = '') {
  stopRepositoryMonitoring();
  repositoryMonitorExpectedName = expectedName;
  repositoryMonitorLastError = null;
  repositoryMonitorRetryPending = false;
  repositoryMonitorDeadline = Date.now() + (5 * 60 * 1000);
  message(expectedName ? `Waiting for ${expectedName} and RepoClock access…` : 'Waiting for eligible repository access…');
  repositoryMonitorTimer = setTimeout(() => void monitorRepositories(), 1500);
}

async function refreshState() {
  const [nextState, resumedAttempt] = await Promise.all([
    send({ type: 'GET_ONBOARDING_STATE' }), send({ type: 'RESUME_DEVICE_FLOW' }),
  ]);
  state = nextState;
  state.deviceAttempt = resumedAttempt || state.deviceAttempt;
  if (!isAppAuthorized()) {
    repositories = [];
    repositoryAccessDetected = false;
    selectedRepository = null;
    discoveryStatus = 'idle';
  }
  renderState();
}

$('authorize').addEventListener('click', async () => {
  setupCancelled = false; $('authorize').disabled = true; message('Requesting a one-time device code from GitHub…');
  try {
    const attempt = await send({ type: 'START_DEVICE_FLOW' });
    state.deviceAttempt = attempt;
    renderDeviceAttempt(attempt);
    try {
      await navigator.clipboard.writeText(attempt.userCode);
    } catch {
      $('device-code').focus();
      $('device-code').select();
      message('The code is ready, but RepoClock could not copy it automatically. Copy it here before opening GitHub.', 'error');
      return;
    }
    githubHandoff = true;
    await send({ type: 'OPEN_DEVICE_FLOW_PAGE', attemptId: attempt.attemptId });
    message('Device code copied. Paste it on GitHub, authorize RepoClock, then choose Done on GitHub—check now if this page does not advance automatically.', 'success');
  } catch (error) { message(error.message, 'error'); }
  finally { $('authorize').disabled = !state?.appConfigured; }
});

$('copy-code').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('device-code').value); message('Device code copied.', 'success'); }
  catch { $('device-code').focus(); $('device-code').select(); message('Could not copy automatically. The code is selected; copy it with your keyboard.', 'error'); }
});

$('device-done').addEventListener('click', async () => {
  const attemptId = state?.deviceAttempt?.attemptId;
  if (!attemptId) return;
  clearTimeout(pollTimer);
  $('device-done').disabled = true;
  $('device-wait').textContent = 'Checking GitHub authorization now…';
  message('Checking GitHub authorization now…');
  try {
    await poll(attemptId);
    if (state?.deviceAttempt?.attemptId === attemptId && !$('message').classList.contains('error')) {
      $('device-wait').textContent = 'GitHub has not confirmed authorization yet. RepoClock will check again automatically.';
      message('GitHub has not confirmed authorization yet. RepoClock will check again automatically.');
    }
  } finally { $('device-done').disabled = !state?.deviceAttempt; }
});

$('refresh-repositories').addEventListener('click', () => void discoverRepositories().catch(() => {}));
$('repository-search').addEventListener('input', renderRepositoryList);
$('change-connection').addEventListener('click', () => { setupCancelled = false; showOnboarding = true; repositoryChoiceMade = true; repositoryChoiceMode = 'existing'; repositoryChoiceSummary = 'Using an existing repository'; discoveryStatus = 'idle'; renderState(); });

$('connect-repository').addEventListener('click', async () => {
  if (!selectedRepository) return;
  $('connect-repository').disabled = true; message('Validating repository access and RepoClock storage…');
  try {
    const result = await send({ type: 'SELECT_REPOSITORY', payload: {
      installationId: selectedRepository.installationId, repoId: selectedRepository.repoId,
      recentDays: Number($('recent-days').value),
    } });
    stopRepositoryMonitoring(); showOnboarding = false; await refreshState();
    message(result.status === 'write_verified' ? 'Connected. RepoClock verified a repository write.' : 'Connected. Existing RepoClock storage was validated without an unnecessary write.', 'success');
  } catch (error) { message(error.message, 'error'); showRecovery(error); $('connect-repository').disabled = false; }
});

$('cancel-app-setup').addEventListener('click', async () => {
  clearTimeout(pollTimer);
  $('cancel-app-setup').disabled = true;
  try {
    await send({ type: 'CANCEL_GITHUB_APP_SETUP' });
    repositories = []; repositoryAccessDetected = false; selectedRepository = null; repositoryChoiceMade = false; repositoryChoiceMode = ''; repositoryChoiceSummary = 'Repository setup option chosen'; discoveryStatus = 'idle';
    stopRepositoryMonitoring(); setupCancelled = true; showOnboarding = false;
    await refreshState();
    message('GitHub App setup cancelled. Existing settings were preserved.');
  } catch (error) { message(error.message, 'error'); }
  finally { $('cancel-app-setup').disabled = false; }
});

$('resume-setup').addEventListener('click', () => {
  setupCancelled = false;
  showOnboarding = true;
  discoveryStatus = 'idle';
  renderState();
});

$('disconnect').addEventListener('click', async () => {
  if (!window.confirm('Disconnect this browser? RepoClock will preserve local tracking data and the repository configuration.')) return;
  $('disconnect').disabled = true;
  try { stopRepositoryMonitoring(); await send({ type: 'DISCONNECT_GITHUB_APP' }); setupCancelled = false; showOnboarding = true; await refreshState(); message('Disconnected locally. GitHub authorization was not revoked.', 'success'); }
  catch (error) { message(error.message, 'error'); }
  finally { $('disconnect').disabled = false; }
});

$('clear-local').addEventListener('click', async () => {
  if (!window.confirm('Clear local RepoClock configuration? This does not delete repository data or revoke GitHub authorization.')) return;
  $('clear-local').disabled = true;
  try {
    await send({ type: 'CLEAR_LOCAL_CONFIGURATION' });
    stopRepositoryMonitoring(); repositories = []; repositoryAccessDetected = false; selectedRepository = null; repositoryChoiceMade = false; repositoryChoiceMode = ''; repositoryChoiceSummary = 'Repository setup option chosen'; discoveryStatus = 'idle'; setupCancelled = false; showOnboarding = true;
    await refreshState();
    message('Local RepoClock configuration cleared. Repository data and GitHub authorization were not deleted.', 'success');
  } catch (error) { message(error.message, 'error'); }
  finally { $('clear-local').disabled = false; }
});


for (const id of ['open-device-page', 'recovery-grant']) {
  $(id).addEventListener('click', () => { githubHandoff = true; });
}
$('install-app').addEventListener('click', () => { githubHandoff = true; startRepositoryMonitoring(repositoryChoiceMode === 'create' ? 'repoclock-data' : ''); });
$('new-repository').addEventListener('click', () => {
  repositoryChoiceMade = true;
  repositoryChoiceMode = 'create';
  repositoryChoiceSummary = 'Repository creation started';
  githubHandoff = true;
  renderOnboardingProgress();
  startRepositoryMonitoring('repoclock-data');
});
$('change-repository-access').addEventListener('click', () => {
  stopRepositoryMonitoring();
  repositories = [];
  repositoryAccessDetected = false;
  selectedRepository = null;
  discoveryStatus = 'idle';
  renderOnboardingProgress();
  message('Review or change repository access on GitHub.');
});
$('change-repository-setup').addEventListener('click', () => {
  stopRepositoryMonitoring();
  repositoryChoiceMade = false;
  repositoryChoiceMode = '';
  repositoryChoiceSummary = 'Repository setup option chosen';
  discoveryStatus = 'idle';
  renderOnboardingProgress();
  message('Choose whether to create a dedicated repository or use an existing one.');
});
$('skip-repository-creation').addEventListener('click', () => {
  repositoryChoiceMade = true;
  repositoryChoiceMode = 'existing';
  repositoryChoiceSummary = 'Using an existing repository';
  renderOnboardingProgress();
  message('Next, choose repository access on GitHub for your existing private repository.');
  void discoverRepositories().catch(() => {});
});
async function rediscoverAfterGitHubHandoff() {
  if (!githubHandoff || document.visibilityState !== 'visible') return;
  githubHandoff = false;
  if (state?.deviceAttempt?.attemptId) {
    clearTimeout(pollTimer);
    await poll(state.deviceAttempt.attemptId);
    return;
  }
  if (state?.candidateAuth?.mode === 'github_app' || state?.auth?.mode === 'github_app') {
    await discoverRepositories().catch(() => {});
  }
}
window.addEventListener('focus', () => void rediscoverAfterGitHubHandoff());
document.addEventListener('visibilitychange', () => void rediscoverAfterGitHubHandoff());
$('recovery-connect').addEventListener('click', () => $('authorize').click());
$('recovery-retry').addEventListener('click', () => {
  if (repositoryMonitorRetryPending) {
    startRepositoryMonitoring();
    clearTimeout(repositoryMonitorTimer);
    repositoryMonitorTimer = null;
    void monitorRepositories();
    return;
  }
  if (repositoryMonitorDeadline) {
    clearTimeout(repositoryMonitorTimer);
    repositoryMonitorTimer = null;
    void monitorRepositories();
    return;
  }
  void discoverRepositories().catch(() => {});
});

$('display-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!state?.config) return;
  $('save-display').disabled = true;
  message('Saving display settings…');
  try {
    const result = await send({ type: 'UPDATE_DISPLAY_PREFERENCES', payload: {
      recentDays: Number($('recent-days').value),
    } });
    state.config = result.config;
    $('recent-days').value = result.config.recentDays;
    message('Display settings saved.', 'success');
  } catch (error) { message(error.message || 'Could not save display settings.', 'error'); }
  finally { $('save-display').disabled = !state?.config; }
});

$('settings-form').addEventListener('submit', async event => {
  event.preventDefault(); message('Validating the PAT and private repository…'); $('save').disabled = true;
  try {
    const payload = {
      owner: $('owner').value.trim(), repo: $('repo').value.trim(), branch: $('branch').value.trim(),
      recentDays: Number($('recent-days').value), token: $('token').value.trim(),
    };
    const { user, config } = await send({ type: 'SAVE_CONFIG', payload });
    $('token').value = ''; showOnboarding = false; await refreshState();
    message(`Saved PAT compatibility settings for ${user}; writes target ${config.owner}/${config.repo}@${config.branch}.`, 'success');
  } catch (error) { message(error.message || 'Could not save settings.', 'error'); }
  finally { $('save').disabled = false; }
});

refreshState().catch(error => message(error.message, 'error'));
