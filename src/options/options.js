import { mountRunningStatus } from '../ui/running-status.js';
import { onboardingStep, selectOnlyEligibleRepository, settleBeforeDeadline } from './onboarding-flow.js';
import { invoicingSettings, normalizeInvoicingSettings, normalizeProjects, parseRateFields } from '../domain/local-settings.js';

const $ = id => document.getElementById(id);
const SAVE_CONFIRMATION_MS = 2000;
const saveButtonStates = new WeakMap();
let state = null;
let repositories = [];
let selectedRepository = null;
let pollTimer = null;
let showOnboarding = false;
let discoveryPromise = null;
let githubHandoff = false;
let repositoryRecoveryHandoff = false;
let suppressRepositoryAutoConnect = false;
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
let localPreferences = null;
let recoveryAction = null;
let settingsConnected = null;
let backupReminderShown = false;
let invoicingSaveInFlight = false;

function message(text, kind = '') {
  $('message').textContent = text;
  $('message').className = kind;
}

function formFeedback(id, text, kind = '') {
  $(id).textContent = text;
  $(id).className = `form-feedback ${kind}`.trim();
}

function saveButtonFeedback(button, outcome = 'saving', operation = null) {
  if (outcome === 'saving') {
    const previous = saveButtonStates.get(button);
    if (previous) { clearTimeout(previous.timer); button.textContent = previous.label; button.disabled = previous.disabled; saveButtonStates.delete(button); }
    const next = { button, label: button.textContent, disabled: button.disabled, timer: null };
    button.disabled = true; saveButtonStates.set(button, next); return next;
  }
  if (!operation || saveButtonStates.get(operation.button) !== operation) return;
  saveButtonStates.delete(operation.button); clearTimeout(operation.timer);
  operation.button.textContent = operation.label; operation.button.disabled = operation.disabled;
  if (outcome !== 'saved') return;
  const next = { button, label: button.textContent, disabled: button.disabled, timer: null };
  button.textContent = 'Saved'; button.disabled = true; saveButtonStates.set(button, next);
  next.timer = setTimeout(() => {
    if (saveButtonStates.get(button) !== next) return;
    button.textContent = next.label; button.disabled = next.disabled; saveButtonStates.delete(button);
  }, SAVE_CONFIRMATION_MS);
}

function autoGrowTextarea(textarea) {
  if (!textarea.scrollHeight) return;
  textarea.style.height = 'auto'; textarea.style.height = `${textarea.scrollHeight}px`;
}

function wireAutoGrow(textarea) {
  textarea.addEventListener('input', () => autoGrowTextarea(textarea)); autoGrowTextarea(textarea);
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

function openGitHubHandoff(url) {
  const opened = window.open('', '_blank');
  if (!opened) return false;
  try {
    opened.opener = null;
    opened.location.replace(url);
    return true;
  } catch {
    opened.close();
    return false;
  }
}

function setLink(id, value) {
  const element = $(id), url = githubUrl(value);
  element.hidden = !url;
  if (url) element.href = url;
  else element.removeAttribute('href');
}

function showRecovery(error = null, { retry = '' } = {}) {
  const recovery = globalThis.ClockoliRecovery.actionFor(error?.code);
  const actions = $('recovery-actions');
  recoveryAction = null;
  if (!recovery) { actions.hidden = true; return; }
  const patUpdate = state?.auth?.mode === 'pat' && ['grant', 'connect'].includes(recovery.kind);
  const storageRepair = recovery.kind === 'repair';
  const recoveryKind = patUpdate || storageRepair ? 'choose' : recovery.kind;
  const reviewUrl = recoveryKind === 'grant' ? githubUrl(state?.installationUrl) : '';
  if (recoveryKind === 'grant' && !reviewUrl) { actions.hidden = true; return; }
  const explanations = {
    connect: 'Your GitHub sign-in is missing or expired. Reconnect to continue.',
    grant: 'Clockoli cannot access the selected private repository. Review the App repository grant on GitHub.',
    choose: 'The selected repository is unavailable or no longer writable. Choose and validate another private repository.',
    repair: 'Clockoli found an incompatible storage layout. Review repository access and repair the repository before continuing.',
    retry: 'GitHub did not complete the request. Retry when the connection is available.',
  };
  recoveryAction = {
    kind: recoveryKind,
    url: reviewUrl,
    retry,
    recheckConfigured: Boolean(state?.ready && state?.config),
    forceManualSelection: storageRepair,
  };
  $('recovery-action').textContent = patUpdate ? 'Update PAT access'
    : storageRepair ? 'Choose another repository' : recovery.label;
  $('recovery-explanation').textContent = patUpdate
    ? 'The personal access token cannot write to this repository. Update the token or repository coordinates.'
    : storageRepair ? 'Clockoli found an incompatible storage layout. Choose and fully validate another private repository.'
      : explanations[recovery.kind];
  actions.hidden = false;
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
  $('progress-fill').style.width = `${(step / 3) * 100}%`;
  const previousStep = renderedOnboardingStep;
  renderedOnboardingStep = step;
  for (const [number, id] of [[1, 'device-step'], [2, 'repository-setup-step'], [3, 'repository-step']]) {
    const element = $(id);
    element.hidden = number !== step;
  }
  $('device-complete').hidden = step === 1;
  $('device-account').textContent = authorized && (state?.candidateAuth?.githubLogin || state?.auth?.githubLogin)
    ? ` as ${state.candidateAuth?.githubLogin || state.auth?.githubLogin}` : '';
  $('repository-access-complete').hidden = step < 3;
  $('repository-access-instruction').textContent = repositoryChoiceMode === 'create'
    ? 'On GitHub, choose Only select repositories and add clockoli-data.'
    : 'On GitHub, choose Only select repositories and add your existing private data repository.';
  for (const mode of ['create', 'existing']) {
    const selected = repositoryChoiceMode === mode;
    const choice = $(`${mode}-repository-choice`);
    choice.classList.toggle('selected', selected);
    choice.setAttribute('aria-current', selected ? 'step' : 'false');
  }
  $('skip-repository-creation').setAttribute('aria-pressed', String(repositoryChoiceMode === 'existing'));
  if (previousStep !== null && previousStep !== step) {
    queueMicrotask(() => $({ 1: 'connection-title', 2: 'repository-setup-step-title', 3: 'repository-step-title' }[step]).focus());
  }
}

function renderState() {
  const connected = state.ready && !showOnboarding;
  $('connected').hidden = !connected;
  $('onboarding').hidden = connected;
  $('display-settings').hidden = !state.config;
  if (settingsConnected !== state.ready) {
    $('more-settings').open = Boolean(state.ready);
    settingsConnected = state.ready;
  }
  $('more-settings-toggle').hidden = Boolean(state.ready);
  $('onboarding-flow').hidden = setupCancelled;
  $('setup-cancelled').hidden = !setupCancelled;
  $('build-warning').hidden = state.appConfigured;
  $('authorize').disabled = !state.appConfigured;
  $('connection-status').textContent = state.ready ? (state.auth?.mode === 'pat' ? 'Connected with PAT' : 'Connected') : (state.candidateAuth ? 'Setup in progress' : 'Not connected');
  $('connection-status').className = `badge${state.ready ? ' ready' : ''}`;
  $('connection-title').textContent = connected ? 'GitHub connection' : 'Connect GitHub';

  if (state.config) {
    $('connected-account').textContent = state.auth?.githubLogin || (state.auth?.mode === 'pat' ? 'Personal access token' : '—');
    $('connected-repository-link').textContent = `${state.config.owner}/${state.config.repo}`;
    const branch = state.config.branch || 'main';
    $('connected-branch').textContent = branch;
    setLink('connected-branch-link', `${state.trackingRepositoryUrl}/tree/${encodeURIComponent(branch)}`);
    const verification = state.verificationStatus === 'write_verified' ? 'Write verified'
      : state.verificationStatus === 'access_checked' ? 'Access checked' : 'Not checked';
    $('connected-storage').textContent = `Private · Format ${state.config.repositoryFormatVersion || 'unknown'} · ${verification}`;
    $('connected-last-check').textContent = state.lastVerifiedAt
      ? `Last access check ${new Date(state.lastVerifiedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}` : '';
    $('owner').value = state.config.owner || '';
    $('repo').value = state.config.repo || '';
    $('branch').value = state.config.branch || 'main';
    $('recent-days').value = state.config.recentDays || 7;
  }
  $('save-display').disabled = !state.config;
  setLink('revoke', state.authorizationSettingsUrl);
  $('revoke-action').hidden = state.auth?.mode !== 'github_app';
  setLink('install-app', state.installationUrl);
  setLink('manage-access', state.installationUrl);
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
  $('device-wait').textContent = `Clockoli checks automatically every few seconds · code expires in ${Math.ceil(seconds / 60)} min`;
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
      message(`Device activation complete for ${result.githubLogin}. Next, give Clockoli access to a data repository.`, 'success');
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
    app_contents_write_required: 'Clockoli needs Contents: write',
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
    empty.textContent = repositories.length ? 'No repository matches this search.' : 'No repositories are visible. Install Clockoli or grant repository access on GitHub, then check again.';
    root.append(empty); return;
  }
  const eligible = visible.filter(repository => repository.eligible);
  const singleEligibleRepository = eligible.length === 1 && visible.length === 1;
  for (const repository of visible) {
    const label = document.createElement('label');
    label.className = `repository-option${singleEligibleRepository ? ' single' : ''}${repository.eligible ? '' : ' unavailable'}`;
    const radio = document.createElement('input');
    radio.type = 'radio'; radio.name = 'repository'; radio.disabled = !repository.eligible;
    radio.hidden = singleEligibleRepository;
    radio.value = `${repository.installationId}:${repository.repoId}`;
    radio.checked = selectedRepository?.installationId === repository.installationId && selectedRepository?.repoId === repository.repoId;
    const copy = document.createElement('span');
    const name = document.createElement('strong'); name.textContent = repository.fullName;
    copy.append(name);
    if (repository.needsInitialization || !repository.eligible) {
      const details = document.createElement('small');
      details.textContent = repository.needsInitialization
        ? 'Empty repository — Clockoli will create the first commit automatically.'
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
    ? repositories.some(repository => repository.repo === 'clockoli-data')
    : repositories.length > 0;
  const expectedRepository = repositoryChoiceMode === 'create'
    ? repositories.find(repository => repository.repo === 'clockoli-data' && repository.eligible)
    : null;
  selectedRepository = expectedRepository || repositories.find(repository => previousSelection
    && repository.installationId === previousSelection.installationId
    && repository.repoId === previousSelection.repoId
    && repository.eligible) || selectOnlyEligibleRepository(repositories);
  const eligibleRepositories = repositories.filter(repository => repository.eligible);
  const singleEligibleRepository = eligibleRepositories.length === 1 && repositories.length === 1;
  $('repository-step-instruction').textContent = singleEligibleRepository
    ? `Clockoli detected access to ${eligibleRepositories[0].fullName}. Validate it as the repository that stores Clockoli data.`
    : 'Clockoli detected repository access. Choose the private repository that should store Clockoli data.';
  $('repository-choice-legend').textContent = singleEligibleRepository
    ? 'Data repository Clockoli can access'
    : 'Repositories Clockoli can use for data storage';
  $('connect-repository').disabled = !selectedRepository;
  $('repository-search').value = '';
  $('repository-search-label').hidden = repositories.length < 10;
  renderRepositoryList();
  renderOnboardingProgress();
}

async function connectSelectedRepository({ automatic = false } = {}) {
  if (!selectedRepository) return false;
  $('connect-repository').disabled = true;
  message(automatic
    ? `Validating ${selectedRepository.fullName} and Clockoli storage…`
    : 'Validating repository access and Clockoli storage…');
  try {
    const result = await send({ type: 'SELECT_REPOSITORY', payload: {
      installationId: selectedRepository.installationId,
      repoId: selectedRepository.repoId,
      recentDays: Number($('recent-days').value),
    } });
    stopRepositoryMonitoring();
    showOnboarding = false;
    await refreshState();
    message(result.status === 'write_verified'
      ? 'Connected. Clockoli verified a repository write.'
      : 'Connected. Existing Clockoli storage was validated.', 'success');
    return true;
  } catch (error) {
    message(error.message, 'error');
    showRecovery(error);
    $('connect-repository').disabled = false;
    return false;
  }
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
    if (!monitoring) message('Refreshing Clockoli installation and repository access…');
    showRecovery();
    try {
      const result = await bounded(send({ type: 'DISCOVER_REPOSITORIES' }));
      discoveryStatus = 'ready';
      renderRepositories(result);
      const relevantCandidates = repositoryChoiceMode === 'create'
        ? result.candidates.filter(repository => repository.repo === 'clockoli-data')
        : result.candidates;
      if (!repositoryAccessDetected && repositoryChoiceMode === 'create') {
        message('Clockoli still cannot see clockoli-data. Grant that repository access on GitHub; automatic checking will continue.');
      } else if (relevantCandidates.length === 1 && !suppressRepositoryAutoConnect) {
        selectedRepository = relevantCandidates[0];
        renderRepositoryList();
        await connectSelectedRepository({ automatic: true });
      } else if (relevantCandidates.length === 1) {
        suppressRepositoryAutoConnect = false;
        message('Repository access was detected. Review and validate the selected repository to continue.');
      } else if (relevantCandidates.length > 1) {
        message('Repository access was detected. Choose the private repository that should store Clockoli data.');
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
  message(`Clockoli stopped checking after five minutes.${detail} Review repository access on GitHub, then select Retry.`, 'error');
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
    if (state?.ready) {
      stopRepositoryMonitoring();
      return;
    }
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
          ? 'Repository access was detected. Choose the repository Clockoli should use.'
          : 'Repository access was detected, but the repository cannot be used yet. Review its availability reason.');
      return;
    }
    message(repositoryMonitorExpectedName
      ? `Clockoli still cannot see ${repositoryMonitorExpectedName}. On GitHub, choose access, select Only select repositories, and add ${repositoryMonitorExpectedName}. Automatic checking will continue.`
      : 'Clockoli still cannot see an eligible repository. On GitHub, choose access, select Only select repositories, and add your data repository. Automatic checking will continue.');
  } catch (error) {
    if (error.code === 'repository_monitor_timeout') {
      finishRepositoryMonitoring();
      return;
    }
    repositoryMonitorLastError = error;
    message(`Could not check GitHub: ${error.message} Clockoli will keep retrying.`, 'error');
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
  message(expectedName ? `Waiting for ${expectedName} and Clockoli access…` : 'Waiting for eligible repository access…');
  repositoryMonitorTimer = setTimeout(() => void monitorRepositories(), 1500);
}

function addRateRow(login = '', period = null) {
  const rate = period || { amountMinorPerHour: 0, currency: '$', currencyPosition: 'prefix', startDate: '', endDate: '' };
  const row = document.createElement('div'); row.className = 'rate-row';
  const loginLabel = document.createElement('label'); loginLabel.textContent = 'GitHub user';
  const loginInput = document.createElement('input'); loginInput.className = 'rate-login'; loginInput.required = true; loginInput.maxLength = 39; loginInput.autocomplete = 'off'; loginInput.placeholder = 'octocat'; loginInput.value = login;
  loginLabel.append(loginInput);
  const rateLabel = document.createElement('label'); rateLabel.textContent = 'Hourly rate';
  const rateInput = document.createElement('input'); rateInput.className = 'rate-value'; rateInput.required = true; rateInput.inputMode = 'decimal'; rateInput.maxLength = 16; rateInput.autocomplete = 'off'; rateInput.placeholder = '15.50'; rateInput.value = Number.isFinite(Number(rate.amountMinorPerHour)) ? (Number(rate.amountMinorPerHour) / 100).toFixed(2).replace(/\.00$/, '') : '';
  rateLabel.append(rateInput);
  const currencyLabel = document.createElement('label'); currencyLabel.textContent = 'Currency';
  const currencyInput = document.createElement('input'); currencyInput.className = 'rate-currency'; currencyInput.required = true; currencyInput.maxLength = 12; currencyInput.autocomplete = 'off'; currencyInput.spellcheck = false; currencyInput.placeholder = '$ or EUR'; currencyInput.value = rate.currency || '$';
  currencyInput.dataset.initialValue = currencyInput.value;
  row.dataset.currencyPosition = rate.currencyPosition || (/^[A-Za-z]{2,12}$/.test(currencyInput.value) ? 'suffix' : 'prefix');
  currencyLabel.append(currencyInput);
  const startLabel = document.createElement('label'); startLabel.textContent = 'Start date';
  const startInput = document.createElement('input'); startInput.className = 'rate-start'; startInput.type = 'date'; startInput.value = rate.startDate || ''; startLabel.append(startInput);
  const endLabel = document.createElement('label'); endLabel.textContent = 'End date (optional)';
  const endInput = document.createElement('input'); endInput.className = 'rate-end'; endInput.type = 'date'; endInput.value = rate.endDate || ''; endInput.setAttribute('aria-describedby', 'rate-date-help'); endLabel.append(endInput);
  const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'secondary remove-rate'; remove.textContent = 'Remove'; remove.setAttribute('aria-label', login ? `Remove rate for ${login}` : 'Remove this rate');
  remove.addEventListener('click', () => row.remove());
  row.append(loginLabel, rateLabel, currencyLabel, startLabel, endLabel, remove); $('rates-list').append(row);
}

function nextClientId() {
  const used = new Set([...$('clients-list').querySelectorAll('.client-row')].map(row => row.dataset.clientId));
  // Missing links must not silently attach to a newly created client.
  for (const select of [$('other-project-client'), ...$('projects-list').querySelectorAll('.project-client')]) used.add(select.value);
  let index = 1;
  while (used.has(`client-${index}`)) index += 1;
  return `client-${index}`;
}

function refreshProjectClients() {
  const clients = [...$('clients-list').querySelectorAll('.client-row')].map(row => ({ id: row.dataset.clientId, name: row.querySelector('.client-name').value.trim() }));
  for (const select of [$('other-project-client'), ...$('projects-list').querySelectorAll('.project-client')]) {
    const selected = select.value;
    select.replaceChildren();
    for (const client of [{ id: '', name: '— No client —' }, ...clients, ...(selected && !clients.some(client => client.id === selected) ? [{ id: selected, name: `${selected} (missing)` }] : [])]) {
      const option = document.createElement('option'); option.value = client.id; option.textContent = client.name || client.id; select.append(option);
    }
    select.value = selected;
  }
}

function addClientRow(client = null) {
  const value = client || { id: nextClientId(), name: '', address: '', email: '', taxId: '', defaultCurrency: '' };
  const row = document.createElement('div'); row.className = 'client-row'; row.dataset.clientId = value.id || nextClientId();
  if (client) row.dataset.persisted = 'true';
  const fields = [
    ['Name', 'client-name', 'text', 'Acme Ltd', value.name],
    ['Email', 'client-email', 'email', 'billing@example.com', value.email],
    ['Address', 'client-address', 'text', 'Street and city', value.address],
    ['Tax ID', 'client-tax-id', 'text', 'VAT number', value.taxId],
    ['Default currency', 'client-currency', 'text', 'EUR', value.defaultCurrency],
  ];
  for (const [labelText, className, type, placeholder, fieldValue] of fields) {
    const label = document.createElement('label'); label.textContent = labelText;
    const input = document.createElement('input'); input.className = className; input.type = type; input.maxLength = className === 'client-address' ? 1000 : 200; input.autocomplete = 'off'; input.placeholder = placeholder; input.value = fieldValue || '';
    input.addEventListener('input', () => { row.dataset.touched = 'true'; if (className === 'client-name') refreshProjectClients(); });
    label.append(input); row.append(label);
  }
  const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'secondary remove-client'; remove.textContent = '✕'; remove.setAttribute('aria-label', value.name ? `Remove client ${value.name}` : 'Remove this client');
  const save = document.createElement('button'); save.type = 'submit'; save.className = 'primary save-client'; save.textContent = 'Save';
  remove.addEventListener('click', () => { row.remove(); refreshProjectClients(); }); row.append(remove, save); $('clients-list').append(row); refreshProjectClients();
}

function addProjectRow(project = { name: '', substrings: [], client: '' }) {
  const row = document.createElement('div'); row.className = 'project-row';
  const nameLabel = document.createElement('label'); nameLabel.textContent = 'Name';
  const name = document.createElement('input'); name.className = 'project-name'; name.required = true; name.maxLength = 80; name.autocomplete = 'off'; name.placeholder = 'work'; name.value = project.name || ''; nameLabel.append(name);
  const substringsLabel = document.createElement('label'); substringsLabel.textContent = 'URL substrings';
  const substrings = document.createElement('textarea'); substrings.className = 'project-substrings'; substrings.required = true; substrings.rows = 1; substrings.maxLength = 50_000; substrings.placeholder = 'linear.app/my-team/\ngithub.com/my-company/'; substrings.value = (project.substrings || []).join('\n'); substringsLabel.append(substrings);
  const clientLabel = document.createElement('label'); clientLabel.textContent = 'Client';
  const client = document.createElement('select'); client.className = 'project-client';
  const selected = document.createElement('option'); selected.value = project.client || ''; client.append(selected); client.value = selected.value; clientLabel.append(client);
  const actions = document.createElement('div'); actions.className = 'project-actions';
  const up = document.createElement('button'); up.type = 'button'; up.className = 'secondary move-project-up'; up.textContent = '↑'; up.setAttribute('aria-label', `Move project ${project.name || 'row'} up`); up.addEventListener('click', () => moveProjectRow(row, -1));
  const down = document.createElement('button'); down.type = 'button'; down.className = 'secondary move-project-down'; down.textContent = '↓'; down.setAttribute('aria-label', `Move project ${project.name || 'row'} down`); down.addEventListener('click', () => moveProjectRow(row, 1));
  const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'secondary remove-project'; remove.textContent = '✕'; remove.setAttribute('aria-label', project.name ? `Remove project ${project.name}` : 'Remove this project');
  remove.addEventListener('click', () => { row.remove(); refreshProjectOrderControls(); });
  actions.append(up, down); row.append(nameLabel, substringsLabel, clientLabel, actions, remove); $('projects-list').append(row); wireAutoGrow(substrings); refreshProjectOrderControls(); refreshProjectClients();
}

function refreshProjectOrderControls() {
  const rows = [...$('projects-list').querySelectorAll('.project-row')];
  rows.forEach((row, index) => {
    row.querySelector('.move-project-up').disabled = index === 0;
    row.querySelector('.move-project-down').disabled = index === rows.length - 1;
  });
}

function moveProjectRow(row, direction) {
  const sibling = direction < 0 ? row.previousElementSibling : row.nextElementSibling;
  if (!sibling) return;
  if (direction < 0) sibling.before(row); else sibling.after(row);
  refreshProjectOrderControls();
  row.querySelector(direction < 0 ? '.move-project-up' : '.move-project-down').focus();
}

function projectsPayload() {
  return normalizeProjects([...$('projects-list').querySelectorAll('.project-row')].map(row => ({
    name: row.querySelector('.project-name').value,
    client: row.querySelector('.project-client').value,
    substrings: row.querySelector('.project-substrings').value.split(/\r?\n/).map(value => value.trim()).filter(Boolean),
  })));
}

function renderDisplayPreferences(preferences) {
  $('recent-days').value = state?.config?.recentDays || preferences.recentDays || 7;
  $('other-project-name').value = preferences.otherProjectName || 'Other';
  $('show-queue-diagnostics').checked = preferences.showQueueDiagnostics === true;
  $('projects-list').replaceChildren();
  for (const project of preferences.projects || []) addProjectRow(project);
  const selected = document.createElement('option'); selected.value = preferences.otherProjectClient || ''; $('other-project-client').append(selected); $('other-project-client').value = selected.value;
  refreshProjectClients();
}

function renderBillingPreferences(preferences) {
  $('rates-list').replaceChildren();
  for (const [login, periods] of Object.entries(preferences.rates || {})) {
    for (const period of (Array.isArray(periods) ? periods : [{ amountMinorPerHour: periods, startDate: '', endDate: '' }])) {
      addRateRow(login, typeof period === 'object' ? period : { amountMinorPerHour: period, currency: 'USD', currencyPosition: 'suffix', startDate: '', endDate: '' });
    }
  }
  if (!Object.keys(preferences.rates || {}).length) addRateRow(state?.auth?.githubLogin || '', 0);
}

function renderInvoicingPreferences(preferences) {
  const invoicing = invoicingSettings(preferences);
  $('seller-name').value = invoicing.seller.name; $('seller-address').value = invoicing.seller.address;
  $('seller-email').value = invoicing.seller.email; $('seller-tax-id').value = invoicing.seller.taxId;
  $('clients-list').replaceChildren();
  for (const client of invoicing.clients) addClientRow(client);
  refreshProjectClients();
  $('invoice-next-number').value = String(invoicing.nextNumber); $('invoice-number-format').value = invoicing.numberFormat;
  $('invoice-payment-terms').value = String(invoicing.paymentTermsDays); $('invoice-tax-percent').value = String(invoicing.taxPercent); $('invoice-notes').value = invoicing.notes;
  autoGrowTextarea($('seller-address')); autoGrowTextarea($('invoice-notes'));
}

function renderLocalPreferences(preferences) {
  localPreferences = preferences;
  renderDisplayPreferences(preferences);
  renderBillingPreferences(preferences);
  renderInvoicingPreferences(preferences);
  if (!preferences.exportRecommended) $('settings-export-reminder').hidden = true;
  else if (!backupReminderShown) {
    $('settings-export-reminder').hidden = false;
    backupReminderShown = true;
  }
}

async function refreshLocalPreferences() {
  renderLocalPreferences(await send({ type: 'GET_LOCAL_PREFERENCES' }));
}

function billingPayload() {
  const rates = {};
  for (const row of $('rates-list').querySelectorAll('.rate-row')) {
    const login = row.querySelector('.rate-login').value.trim();
    const value = row.querySelector('.rate-value').value.trim();
    const currency = row.querySelector('.rate-currency').value.trim();
    if (!login && !value && !currency) continue;
    if (!login || !value || !currency) throw new Error('Enter a GitHub user, hourly rate, and currency');
    const parsed = parseRateFields(value, currency);
    const currencyPosition = currency === row.querySelector('.rate-currency').dataset.initialValue
      ? row.dataset.currencyPosition : parsed.currencyPosition;
    rates[login] ||= [];
    rates[login].push({ ...parsed, currencyPosition, startDate: row.querySelector('.rate-start').value, endDate: row.querySelector('.rate-end').value });
  }
  return { rates, invoicing: invoicingPayload() };
}

function invoicingPayload() {
  const selectedClients = new Set([$('other-project-client'), ...$('projects-list').querySelectorAll('.project-client')].map(select => select.value));
  const invoicing = normalizeInvoicingSettings({
    seller: {
      name: $('seller-name').value, address: $('seller-address').value,
      email: $('seller-email').value, taxId: $('seller-tax-id').value,
    },
    clients: [...$('clients-list').querySelectorAll('.client-row')].filter(row => row.dataset.persisted === 'true' || row.dataset.touched === 'true' || selectedClients.has(row.dataset.clientId)
      || ['.client-name', '.client-email', '.client-address', '.client-tax-id', '.client-currency'].some(selector => row.querySelector(selector).value.trim())).map(row => ({
      id: row.dataset.clientId, name: row.querySelector('.client-name').value,
      address: row.querySelector('.client-address').value, email: row.querySelector('.client-email').value,
      taxId: row.querySelector('.client-tax-id').value, defaultCurrency: row.querySelector('.client-currency').value,
    })),
    nextNumber: Number($('invoice-next-number').value), numberFormat: $('invoice-number-format').value,
    paymentTermsDays: $('invoice-payment-terms').value.trim() ? Number($('invoice-payment-terms').value) : NaN, taxPercent: Number($('invoice-tax-percent').value), notes: $('invoice-notes').value,
  });
  return invoicing;
}

function downloadText(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
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
      message('The code is ready, but Clockoli could not copy it automatically. Copy it here before opening GitHub.', 'error');
      return;
    }
    githubHandoff = true;
    await send({ type: 'OPEN_DEVICE_FLOW_PAGE', attemptId: attempt.attemptId });
    message('Device code copied. Paste it on GitHub, authorize Clockoli, then choose Done on GitHub—check now if this page does not advance automatically.', 'success');
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
      $('device-wait').textContent = 'GitHub has not confirmed authorization yet. Clockoli will check again automatically.';
      message('GitHub has not confirmed authorization yet. Clockoli will check again automatically.');
    }
  } finally { $('device-done').disabled = !state?.deviceAttempt; }
});

$('repository-search').addEventListener('input', renderRepositoryList);
function beginRepositoryChange() {
  if (state?.auth?.mode === 'pat') {
    $('more-settings').open = true;
    $('advanced-settings').open = true;
    $('advanced-pat').open = true;
    queueMicrotask(() => $('owner').focus());
    message('Update the PAT repository coordinates and validate them.');
    return;
  }
  setupCancelled = false;
  showOnboarding = true;
  repositoryChoiceMade = true;
  repositoryChoiceMode = 'existing';
  repositoryChoiceSummary = 'Using an existing repository';
  discoveryStatus = 'idle';
  renderState();
  void discoverRepositories().catch(() => {});
}
$('change-connection').addEventListener('click', beginRepositoryChange);
async function checkRepositoryAccess() {
  $('check-access').disabled = true;
  message('Checking GitHub repository access…');
  try {
    await send({ type: 'CHECK_REPOSITORY_ACCESS' });
    await refreshState();
    showRecovery();
    message('Repository and branch access confirmed.', 'success');
  } catch (error) { message(error.message, 'error'); showRecovery(error, { retry: 'access' }); }
  finally { $('check-access').disabled = false; }
}
$('check-access').addEventListener('click', checkRepositoryAccess);

$('connect-repository').addEventListener('click', () => void connectSelectedRepository());

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
  if (!window.confirm('Sign out on this browser? Clockoli will preserve local tracking data and the repository configuration. This does not revoke GitHub sign-in or delete repository data.')) return;
  $('disconnect').disabled = true;
  try { stopRepositoryMonitoring(); await send({ type: 'DISCONNECT_GITHUB_APP' }); setupCancelled = false; showOnboarding = true; await refreshState(); message('Disconnected locally. GitHub authorization was not revoked.', 'success'); }
  catch (error) { message(error.message, 'error'); }
  finally { $('disconnect').disabled = false; }
});

$('clear-local').addEventListener('click', async () => {
  if (!window.confirm('Clear all local Clockoli data? This removes local settings, credentials and unsynced local state from this browser. This does not delete repository data or revoke GitHub sign-in.')) return;
  $('clear-local').disabled = true;
  try {
    await send({ type: 'CLEAR_LOCAL_CONFIGURATION' });
    stopRepositoryMonitoring(); repositories = []; repositoryAccessDetected = false; selectedRepository = null; repositoryChoiceMade = false; repositoryChoiceMode = ''; repositoryChoiceSummary = 'Repository setup option chosen'; discoveryStatus = 'idle'; setupCancelled = false; showOnboarding = true;
    await refreshState();
    message('All local Clockoli data cleared. Repository data and GitHub authorization were not deleted.', 'success');
  } catch (error) { message(error.message, 'error'); }
  finally { $('clear-local').disabled = false; }
});


for (const id of ['open-device-page']) {
  $(id).addEventListener('click', () => { githubHandoff = true; });
}
$('install-app').addEventListener('click', () => { githubHandoff = true; startRepositoryMonitoring(repositoryChoiceMode === 'create' ? 'clockoli-data' : ''); });
$('new-repository').addEventListener('click', () => {
  repositoryChoiceMade = true;
  repositoryChoiceMode = 'create';
  repositoryChoiceSummary = 'Repository creation started';
  githubHandoff = true;
  renderOnboardingProgress();
  startRepositoryMonitoring('clockoli-data');
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
$('skip-repository-creation').addEventListener('click', () => {
  repositoryChoiceMade = true;
  repositoryChoiceMode = 'existing';
  repositoryChoiceSummary = 'Using an existing repository';
  renderOnboardingProgress();
  message('Next, choose repository access on GitHub for your existing private repository.');
  $('existing-repository-choice').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  queueMicrotask(() => $('install-app').focus());
  void discoverRepositories().catch(() => {});
});
async function rediscoverAfterGitHubHandoff() {
  if (!githubHandoff || document.visibilityState !== 'visible') return;
  githubHandoff = false;
  if (repositoryRecoveryHandoff) {
    repositoryRecoveryHandoff = false;
    await checkRepositoryAccess();
    return;
  }
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
$('recovery-action').addEventListener('click', () => {
  if (!recoveryAction) return;
  if (recoveryAction.kind === 'connect') { $('authorize').click(); return; }
  if (recoveryAction.kind === 'choose') {
    suppressRepositoryAutoConnect = recoveryAction.forceManualSelection;
    beginRepositoryChange();
    return;
  }
  if (recoveryAction.url) {
    if (!openGitHubHandoff(recoveryAction.url)) {
      message('Browser blocked the GitHub recovery tab. Allow popups for Clockoli and try again.', 'error');
      return;
    }
    repositoryRecoveryHandoff = recoveryAction.recheckConfigured;
    githubHandoff = true;
    return;
  }
  if (recoveryAction.retry === 'access') {
    void checkRepositoryAccess();
    return;
  }
  if (repositoryMonitorRetryPending) startRepositoryMonitoring();
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
  const button = $('save-display'), operation = saveButtonFeedback(button);
  formFeedback('display-feedback', 'Saving display settings…');
  try {
    const result = await send({ type: 'UPDATE_DISPLAY_PREFERENCES', payload: {
      recentDays: Number($('recent-days').value),
      projects: projectsPayload(),
      otherProjectName: $('other-project-name').value,
      otherProjectClient: $('other-project-client').value,
      showQueueDiagnostics: $('show-queue-diagnostics').checked,
    } });
    state.config = result.config;
    renderDisplayPreferences(result.preferences);
    formFeedback('display-feedback', ''); saveButtonFeedback(button, 'saved', operation);
  } catch (error) { formFeedback('display-feedback', error.message || 'Could not save display settings.', 'error'); saveButtonFeedback(button, 'error', operation); }
});

$('add-project').addEventListener('click', () => addProjectRow());
$('add-rate').addEventListener('click', () => addRateRow());
$('add-client').addEventListener('click', () => addClientRow());
$('billing-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = $('save-billing'), operation = saveButtonFeedback(button); formFeedback('billing-feedback', 'Saving billable rates…');
  try {
    await send({ type: 'SAVE_BILLING_SETTINGS', payload: billingPayload() });
    renderBillingPreferences(await send({ type: 'GET_LOCAL_PREFERENCES' }));
    formFeedback('billing-feedback', ''); saveButtonFeedback(button, 'saved', operation);
  } catch (error) { formFeedback('billing-feedback', error.message || 'Could not save billable rates.', 'error'); saveButtonFeedback(button, 'error', operation); }
});
$('invoicing-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (invoicingSaveInFlight) return;
  const clicked = event.submitter?.className.split(' ').includes('save-client') ? event.submitter : $('save-invoicing');
  const clientId = clicked.className.split(' ').includes('save-client') ? clicked.parentNode.dataset.clientId : '';
  const operation = saveButtonFeedback(clicked); invoicingSaveInFlight = true;
  for (const button of [$('save-invoicing'), ...$('clients-list').querySelectorAll('.save-client')]) button.disabled = true;
  let confirmationButton = null; formFeedback('invoicing-feedback', 'Saving invoicing settings…');
  try {
    await send({ type: 'SAVE_BILLING_SETTINGS', payload: billingPayload() });
    renderInvoicingPreferences(await send({ type: 'GET_LOCAL_PREFERENCES' }));
    confirmationButton = clientId ? [...$('clients-list').querySelectorAll('.client-row')].find(row => row.dataset.clientId === clientId)?.querySelector('.save-client') || clicked : clicked;
    formFeedback('invoicing-feedback', ''); saveButtonFeedback(confirmationButton, 'saved', operation);
  } catch (error) { formFeedback('invoicing-feedback', error.message || 'Could not save invoicing settings.', 'error'); saveButtonFeedback(clicked, 'error', operation); }
  finally {
    invoicingSaveInFlight = false;
    for (const button of [$('save-invoicing'), ...$('clients-list').querySelectorAll('.save-client')]) if (button !== confirmationButton && !saveButtonStates.has(button)) button.disabled = false;
  }
});
for (const [form, feedback] of [['display-form', 'display-feedback'], ['billing-form', 'billing-feedback'], ['invoicing-form', 'invoicing-feedback']]) {
  $(form).addEventListener('input', () => formFeedback(feedback, ''));
}
for (const id of ['seller-address', 'invoice-notes']) wireAutoGrow($(id));
$('export-settings').addEventListener('click', async () => {
  $('export-settings').disabled = true;
  try {
    const result = await send({ type: 'EXPORT_SETTINGS' });
    downloadText(result.text, `clockoli-settings-backup-${new Date().toISOString().slice(0, 10)}.json`);
    await send({ type: 'MARK_SETTINGS_EXPORTED', revision: result.revision });
    await refreshLocalPreferences();
    message('Local settings backup exported. GitHub credentials and tracked data were not included.', 'success');
  } catch (error) { message(error.message || 'Could not export settings.', 'error'); }
  finally { $('export-settings').disabled = false; }
});
$('import-settings-file').addEventListener('change', async () => {
  const input = $('import-settings-file'), file = input.files?.[0];
  if (!file) return;
  input.disabled = true;
  try {
    if (file.size > 262_144) throw new Error('Settings file is too large.');
    const result = await send({ type: 'IMPORT_SETTINGS', text: await file.text() });
    if (state?.config) state.config.recentDays = result.recentDays;
    $('recent-days').value = result.recentDays;
    await refreshLocalPreferences();
    message('Local settings restored from backup. GitHub remains connected only if it was already connected.', 'success');
  } catch (error) { message(error.message || 'Could not import settings.', 'error'); }
  finally { input.value = ''; input.disabled = false; }
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

refreshState().then(refreshLocalPreferences).catch(error => message(error.message, 'error'));

mountRunningStatus($('running-status'), { send });
