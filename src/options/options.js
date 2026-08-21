import { onboardingStep, selectOnlyEligibleRepository } from './onboarding-flow.js';

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
  const grant = recovery?.kind === 'grant';
  const choose = ['choose', 'repair'].includes(recovery?.kind);
  const retry = recovery?.kind === 'retry';
  $('recovery-connect').hidden = !connect;
  $('recovery-grant').hidden = !grant || !githubUrl(state?.installationUrl);
  $('recovery-choose').textContent = recovery?.label || 'Choose another repository';
  $('recovery-choose').hidden = !choose;
  $('recovery-retry').hidden = !retry;
  actions.hidden = !(connect || (grant && githubUrl(state?.installationUrl)) || choose || retry);
}

function isAppAuthorized() {
  return state?.candidateAuth?.mode === 'github_app' || state?.auth?.mode === 'github_app';
}

function renderOnboardingProgress() {
  const authorized = isAppAuthorized();
  const step = onboardingStep({
    authorized,
    deviceAttempt: Boolean(state?.deviceAttempt),
    discoveryStatus,
    repositories,
  });
  $('current-step').textContent = String(step);
  $('progress-fill').style.width = `${(step / 3) * 100}%`;
  for (const [number, id] of [[1, 'device-step'], [2, 'access-step'], [3, 'repository-step']]) {
    const element = $(id);
    element.hidden = number !== step;
  }
  $('device-complete').hidden = step === 1;
  $('device-account').textContent = authorized && (state?.candidateAuth?.githubLogin || state?.auth?.githubLogin)
    ? ` as ${state.candidateAuth?.githubLogin || state.auth?.githubLogin}` : '';
  $('access-complete').hidden = step < 3;
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
    $('connected-repository').textContent = `${state.config.owner}/${state.config.repo}`;
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
  $('revoke').hidden = state.auth?.mode !== 'github_app';
  setLink('install-app', state.installationUrl);
  setLink('review-repository-access', state.installationUrl);
  setLink('new-repository', state.newRepositoryUrl);
  setLink('open-repository', state.trackingRepositoryUrl);

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
    $('device-code').textContent = 'Requesting code…';
    setLink('open-device-page', '');
    $('device-wait').textContent = 'Starting secure GitHub authorization…';
    schedulePoll(attempt);
    return;
  }
  $('device-code').textContent = attempt.userCode;
  setLink('open-device-page', attempt.verificationUri);
  const seconds = Math.max(0, Math.ceil((attempt.expiresAt - Date.now()) / 1000));
  $('device-wait').textContent = `Waiting for GitHub authorization · code expires in ${Math.ceil(seconds / 60)} min`;
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
  const groups = new Map();
  for (const repository of visible) {
    const groupName = repository.accountLogin || repository.owner;
    if (!groups.has(groupName)) groups.set(groupName, []);
    groups.get(groupName).push(repository);
  }
  for (const [accountLogin, values] of groups) {
    const group = document.createElement('section'); group.className = 'repository-group';
    const heading = document.createElement('h3'); heading.textContent = accountLogin; group.append(heading);
    for (const repository of values) {
      const label = document.createElement('label');
      label.className = `repository-option${repository.eligible ? '' : ' unavailable'}`;
      const radio = document.createElement('input');
      radio.type = 'radio'; radio.name = 'repository'; radio.disabled = !repository.eligible;
      radio.value = `${repository.installationId}:${repository.repoId}`;
      radio.checked = selectedRepository?.installationId === repository.installationId && selectedRepository?.repoId === repository.repoId;
      const copy = document.createElement('span');
      const name = document.createElement('strong'); name.textContent = repository.repo;
      const details = document.createElement('small');
      details.textContent = repository.eligible ? `Private · ${repository.defaultBranch} · Contents: write` : `Unavailable · ${repositoryReason(repository)}`;
      copy.append(name, details); label.append(radio, copy); group.append(label);
      radio.addEventListener('change', () => { selectedRepository = repository; $('connect-repository').disabled = false; });
    }
    root.append(group);
  }
}

function renderRepositories(result) {
  const previousSelection = selectedRepository;
  repositories = result.repositories;
  selectedRepository = repositories.find(repository => previousSelection
    && repository.installationId === previousSelection.installationId
    && repository.repoId === previousSelection.repoId
    && repository.eligible) || selectOnlyEligibleRepository(repositories);
  $('connect-repository').disabled = !selectedRepository;
  $('repository-search').value = '';
  $('repository-search-label').hidden = repositories.length < 10;
  $('repository-recovery').hidden = result.candidates.length > 0;
  renderRepositoryList();
  renderOnboardingProgress();
}

async function discoverRepositories() {
  if (discoveryPromise) return discoveryPromise;
  discoveryStatus = 'loading';
  renderOnboardingProgress();
  discoveryPromise = (async () => {
    $('refresh-repositories').disabled = true;
    message('Refreshing RepoClock installation and repository access…'); showRecovery();
    try {
      const result = await send({ type: 'DISCOVER_REPOSITORIES' });
      discoveryStatus = 'ready';
      renderRepositories(result);
      if (result.candidates.length === 1) {
        message('One eligible data repository was found and selected automatically. Validate it to finish setup.', 'success');
      } else if (result.candidates.length > 1) {
        message('Choose the private repository that should store RepoClock data.');
      } else if (result.repositories.length) {
        message('RepoClock found repository access, but none can be used yet. Review each repository below for the reason.');
      } else {
        message('');
      }
      return result;
    } catch (error) {
      discoveryStatus = 'error';
      renderOnboardingProgress();
      message(error.message, 'error');
      throw error;
    } finally {
      $('refresh-repositories').disabled = false;
      discoveryPromise = null;
    }
  })();
  return discoveryPromise;
}

async function refreshState() {
  const [nextState, resumedAttempt] = await Promise.all([
    send({ type: 'GET_ONBOARDING_STATE' }), send({ type: 'RESUME_DEVICE_FLOW' }),
  ]);
  state = nextState;
  state.deviceAttempt = resumedAttempt || state.deviceAttempt;
  if (!isAppAuthorized()) {
    repositories = [];
    selectedRepository = null;
    discoveryStatus = 'idle';
  }
  renderState();
}

$('authorize').addEventListener('click', async () => {
  setupCancelled = false; $('authorize').disabled = true; message('Requesting a one-time device code from GitHub…');
  try {
    const attempt = await send({ type: 'START_DEVICE_FLOW' });
    state.deviceAttempt = attempt; renderDeviceAttempt(attempt); message('Enter the code on GitHub only because you started Device activation here.');
  } catch (error) { message(error.message, 'error'); }
  finally { $('authorize').disabled = !state?.appConfigured; }
});

$('copy-code').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('device-code').textContent); message('Device code copied.', 'success'); }
  catch { message('Could not copy automatically. Select the code and copy it.', 'error'); }
});

$('refresh-repositories').addEventListener('click', () => void discoverRepositories().catch(() => {}));
$('refresh-repository-access').addEventListener('click', () => void discoverRepositories().catch(() => {}));
$('repository-search').addEventListener('input', renderRepositoryList);
$('check-access').addEventListener('click', () => { setupCancelled = false; showOnboarding = true; discoveryStatus = 'idle'; renderState(); });
$('change-connection').addEventListener('click', () => { setupCancelled = false; showOnboarding = true; discoveryStatus = 'idle'; renderState(); });

$('connect-repository').addEventListener('click', async () => {
  if (!selectedRepository) return;
  $('connect-repository').disabled = true; message('Validating repository access and RepoClock storage…');
  try {
    const result = await send({ type: 'SELECT_REPOSITORY', payload: {
      installationId: selectedRepository.installationId, repoId: selectedRepository.repoId,
      recentDays: Number($('recent-days').value),
    } });
    showOnboarding = false; await refreshState();
    message(result.status === 'write_verified' ? 'Connected. RepoClock verified a repository write.' : 'Connected. Existing RepoClock storage was validated without an unnecessary write.', 'success');
  } catch (error) { message(error.message, 'error'); showRecovery(error); $('connect-repository').disabled = false; }
});

$('cancel-app-setup').addEventListener('click', async () => {
  clearTimeout(pollTimer);
  $('cancel-app-setup').disabled = true;
  try {
    await send({ type: 'CANCEL_GITHUB_APP_SETUP' });
    repositories = []; selectedRepository = null; discoveryStatus = 'idle';
    setupCancelled = true; showOnboarding = false;
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
  try { await send({ type: 'DISCONNECT_GITHUB_APP' }); setupCancelled = false; showOnboarding = true; await refreshState(); message('Disconnected locally. GitHub authorization was not revoked.', 'success'); }
  catch (error) { message(error.message, 'error'); }
  finally { $('disconnect').disabled = false; }
});

$('clear-local').addEventListener('click', async () => {
  if (!window.confirm('Clear local RepoClock configuration? This does not delete repository data or revoke GitHub authorization.')) return;
  $('clear-local').disabled = true;
  try {
    await send({ type: 'CLEAR_LOCAL_CONFIGURATION' });
    repositories = []; selectedRepository = null; discoveryStatus = 'idle'; setupCancelled = false; showOnboarding = true;
    await refreshState();
    message('Local RepoClock configuration cleared. Repository data and GitHub authorization were not deleted.', 'success');
  } catch (error) { message(error.message, 'error'); }
  finally { $('clear-local').disabled = false; }
});


for (const id of ['install-app', 'review-repository-access', 'new-repository', 'open-device-page', 'recovery-grant']) {
  $(id).addEventListener('click', () => { githubHandoff = true; });
}
async function rediscoverAfterGitHubHandoff() {
  if (!githubHandoff || document.visibilityState !== 'visible') return;
  githubHandoff = false;
  if (state?.candidateAuth?.mode === 'github_app' || state?.auth?.mode === 'github_app') {
    await discoverRepositories().catch(() => {});
  }
}
window.addEventListener('focus', () => void rediscoverAfterGitHubHandoff());
document.addEventListener('visibilitychange', () => void rediscoverAfterGitHubHandoff());
$('recovery-connect').addEventListener('click', () => $('authorize').click());
$('recovery-choose').addEventListener('click', () => { setupCancelled = false; showOnboarding = true; discoveryStatus = 'idle'; renderState(); });
$('recovery-retry').addEventListener('click', () => void discoverRepositories().catch(() => {}));

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
