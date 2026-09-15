import { mountRunningStatus } from '../ui/running-status.js';
import { onboardingStep, parseRepositoryTarget, selectOnlyEligibleRepository, settleBeforeDeadline } from './onboarding-flow.js';
import { invoicingSettings, normalizeInvoicingSettings, normalizeProjects, parseRateFields } from '../domain/local-settings.js';


const $ = id => document.getElementById(id);
const SAVE_CONFIRMATION_MS = 2000;
const saveButtonStates = new WeakMap();
let state = null;
let repositories = [];
let selectedRepository = null;
let pollTimer = null;
let showOnboarding = false;
import { ChromeStore } from '../storage/chrome-store.js';
const choiceStore = new ChromeStore();
let repositoryTarget = '';
let repositoryInputDirty = false;
let choiceAccount = '';
let installations = [];
let choiceWrite = Promise.resolve();
let discoveryPromise = null;
let githubHandoff = false;
let repositoryRecoveryHandoff = false;
let discoveryStatus = 'idle';
let setupCancelled = false;
let repositoryMonitorTimer = null;
let repositoryLifecycle = 0;
let repositoryPollingStopped = false;
let repositoryListSignature = '';
let repositoryDiscoveryKnown = false;
let renderedOnboardingStep = null;
let localPreferences = null;
let recoveryAction = null;
let settingsConnected = null;
let backupReminderShown = false;
let invoicingSaveInFlight = false;
let pendingConfirmation = null;
let repositoryActionApplying = false;
let authorizationBlock = null;
let projectSequence = 0;


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
  textarea.style.height = 'auto'; textarea.style.height = `${textarea.scrollHeight + textarea.offsetHeight - textarea.clientHeight}px`;
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
  const recoveryExplanation = error?.code === 'org_approval_required'
    ? 'A GitHub organization owner must approve Clockoli before it can access this repository.'
    : explanations[recovery.kind];
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
      : recoveryExplanation;
  actions.hidden = false;
}

function isAppAuthorized() {
  return state?.candidateAuth?.mode === 'github_app' || state?.auth?.mode === 'github_app';
}

function configuredDestinations() {
  const registryEntries = state?.destinationRegistry?.destinations || {};
  const projected = Array.isArray(state?.destinations)
    ? state.destinations
    : Object.entries(state?.destinations || {}).map(([id, destination]) => ({ id, ...destination }));
  const merged = new Map(Object.entries(registryEntries).map(([id, destination]) => [id, { id, ...destination }]));
  for (const destination of projected) {
    const id = destination?.id || destination?.destinationId;
    if (id) merged.set(id, { ...(merged.get(id) || {}), ...destination, id });
  }
  if (!merged.size && state?.config) {
    const id = state.config.id || state.config.destinationId
      || (Number.isSafeInteger(state.config.repoId) ? `github:${state.config.repoId}` : 'pat:single');
    merged.set(id, {
      id, ...state.config,
      verificationStatus: state.verificationStatus,
      lastVerifiedAt: state.lastVerifiedAt,
      repositoryUrl: state.trackingRepositoryUrl,
    });
  }
  return [...merged.values()];
}

function defaultDestinationId() {
  return state?.defaultDestinationId || state?.destinationRegistry?.defaultDestinationId
    || (configuredDestinations().length === 1 ? configuredDestinations()[0].id : '');
}

function destinationLabel(destination) {
  return destination?.label || (destination?.owner && destination?.repo ? `${destination.owner}/${destination.repo}` : destination?.id || 'Unknown repository');
}

function destinationNeedsAttention(destination) {
  return destination?.needsAttention === true
    || ['needs_attention', 'unavailable', 'error', 'revoked', 'read_only'].includes(destination?.status)
    || ['needs_attention', 'unavailable', 'error'].includes(destination?.verificationStatus);
}

function safeRepositoryUrl(destination) {
  const supplied = githubUrl(destination?.repositoryUrl || destination?.url);
  if (supplied) return supplied;
  if (!destination?.owner || !destination?.repo) return '';
  return `https://github.com/${encodeURIComponent(destination.owner)}/${encodeURIComponent(destination.repo)}`;
}

function appendBadge(parent, text, className = '') {
  const badge = document.createElement('span');
  badge.className = `badge ${className}`.trim();
  badge.textContent = text;
  parent.append(badge);
}

function teammateInstructions(destination) {
  const name = destinationLabel(destination);
  return [
    'Ask each teammate to:',
    `1. Get read and write access to ${name}.`,
    '2. Install Clockoli and select Sign in with GitHub.',
    `3. Select ${name} or enter its GitHub URL in Connect time repositories.`,
    `4. If requested, grant the Clockoli GitHub App access to ${name} if it is not already listed.`,
    `5. Select ${name}, review the repository writes, and select Join repository.`,
    '',
    'Clockoli creates a separate personal storage branch for each teammate. Do not create clockoli/users/… branches by hand.',
  ].join('\n');
}

function destinationStatus(destination) {
  if (destination.checking === true || destination.status === 'checking') return 'Checking…';
  if (destinationNeedsAttention(destination)) return 'Needs attention';
  return destination.verificationStatus === 'write_verified' || destination.status === 'write_verified'
    ? 'Connected · write verified' : 'Connected · access checked';
}

function repositoryMetadata(destination) {
  const metadata = document.createElement('dl'); metadata.className = 'repository-metadata';
  const rows = [
    ['Default branch', destination.defaultBranch || destination.branch || 'main'],
    ['Your branch', destination.storageBranch || destination.personalBranch || (destination.storageLogin ? `clockoli/users/${destination.storageLogin}` : '')],
    ['Last checked', destination.lastVerifiedAt || destination.lastCheckedAt
      ? new Date(destination.lastVerifiedAt || destination.lastCheckedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Not checked yet'],
  ];
  for (const [term, value] of rows) {
    if (!value) continue;
    const row = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd');
    dt.textContent = `${term}:`; dd.textContent = value; row.append(dt, dd); metadata.append(row);
  }
  return metadata;
}

function renderTeammateInstructions(container, destination) {
  const details = document.createElement('details'); details.className = 'teammate-instructions';
  const summary = document.createElement('summary'); summary.textContent = 'Teammate instructions';
  const heading = document.createElement('h4'); heading.textContent = `Invite teammates to ${destinationLabel(destination)}`;
  const instructions = document.createElement('pre'); instructions.textContent = teammateInstructions(destination);
  const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'secondary'; copy.textContent = 'Copy instructions';
  const feedback = document.createElement('p'); feedback.className = 'form-feedback'; feedback.setAttribute('role', 'status'); feedback.setAttribute('aria-live', 'polite');
  copy.addEventListener('click', async () => {
    copy.disabled = true;
    try {
      await navigator.clipboard.writeText(instructions.textContent);
      feedback.textContent = 'Teammate instructions copied.'; feedback.className = 'form-feedback success';
    } catch {
      feedback.textContent = 'Clockoli could not copy the instructions automatically. Select the text and copy it with your keyboard.';
      feedback.className = 'form-feedback error';
    } finally { copy.disabled = false; }
  });
  details.append(summary, heading, instructions, copy, feedback); container.append(details);
}

function renderRemoval(container, destination) {
  const panel = document.createElement('section'); panel.className = 'repository-removal notice'; panel.hidden = true;
  const title = document.createElement('h4'); title.textContent = `Remove ${destinationLabel(destination)} from Clockoli?`;
  const body = document.createElement('p');
  body.textContent = 'This removes the repository from this browser. Repository data, GitHub App access, and Git history will not be deleted.';
  const error = document.createElement('p'); error.className = 'form-feedback error'; error.setAttribute('role', 'alert');
  const confirm = document.createElement('button'); confirm.type = 'button'; confirm.className = 'danger'; confirm.textContent = 'Remove from Clockoli';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'secondary'; cancel.textContent = 'Cancel';
  const blockers = Array.isArray(destination.removalBlockers) ? destination.removalBlockers : [];
  confirm.addEventListener('click', async () => {
    confirm.disabled = true; cancel.disabled = true; error.textContent = '';
    try {
      await send({ type: 'REMOVE_DESTINATION', destinationId: destination.id });
      await refreshState();
      await refreshLocalPreferences();
      message(`${destinationLabel(destination)} was removed from this browser.`, 'success');
    } catch (reason) {
      error.textContent = reason.message || String(reason);
      confirm.disabled = false; cancel.disabled = false;
    }
  });
  cancel.addEventListener('click', () => { panel.hidden = true; });
  if (blockers.length) { error.textContent = blockers.join(' '); confirm.hidden = true; }
  const actions = document.createElement('div'); actions.className = 'actions'; actions.append(confirm, cancel);
  panel.append(title, body, error, actions); container.append(panel);
  return panel;
}

function renderDestinationCard(destination, isDefault) {
  const article = document.createElement('details'); article.className = 'time-repository'; article.dataset.destinationId = destination.id;
  const header = document.createElement('summary'); header.className = 'repository-card-heading';
  const title = document.createElement('h3'); title.textContent = destinationLabel(destination);
  const badges = document.createElement('div'); badges.className = 'repository-badges';
  appendBadge(badges, destinationStatus(destination), destinationNeedsAttention(destination) ? 'attention' : 'ready');
  if (isDefault) appendBadge(badges, 'Default', 'default');
  header.append(title, badges); article.append(header, repositoryMetadata(destination));
  const feedback = document.createElement('p'); feedback.className = 'form-feedback'; feedback.setAttribute('role', 'status'); feedback.setAttribute('aria-live', 'polite');
  const actions = document.createElement('div'); actions.className = 'repository-actions';
  const check = document.createElement('button'); check.type = 'button'; check.className = 'secondary check-repository-access'; check.textContent = 'Check access';
  check.addEventListener('click', async () => {
    check.disabled = true; feedback.textContent = 'Checking…';
    try {
      await send({ type: 'CHECK_REPOSITORY_ACCESS', destinationId: destination.id });
      await refreshState(); feedback.textContent = 'Repository access checked.'; feedback.className = 'form-feedback success';
    } catch (error) { feedback.textContent = error.message; feedback.className = 'form-feedback error'; }
    finally { check.disabled = false; }
  });
  actions.append(check);
  const repositoryUrl = safeRepositoryUrl(destination);
  if (repositoryUrl) {
    const open = document.createElement('a'); open.className = 'button-link secondary-link'; open.target = '_blank'; open.rel = 'noreferrer'; open.href = repositoryUrl; open.textContent = 'Open repository'; actions.append(open);
  }
  const manageUrl = githubUrl(destination.settingsUrl || destination.manageAccessUrl || destination.installationSettingsUrl || state?.installationUrl);
  if (manageUrl) {
    const manage = document.createElement('a'); manage.className = 'button-link secondary-link'; manage.target = '_blank'; manage.rel = 'noreferrer'; manage.href = manageUrl; manage.textContent = 'Manage GitHub access'; actions.append(manage);
  }
  if (!isDefault && state?.auth?.mode !== 'pat') {
    const makeDefault = document.createElement('button'); makeDefault.type = 'button'; makeDefault.className = 'secondary make-default-destination'; makeDefault.textContent = 'Make default';
    makeDefault.addEventListener('click', async () => {
      makeDefault.disabled = true;
      try { await send({ type: 'SET_DEFAULT_DESTINATION', destinationId: destination.id }); await refreshState(); await refreshLocalPreferences(); }
      catch (error) { feedback.textContent = error.message; feedback.className = 'form-feedback error'; makeDefault.disabled = false; }
    });
    actions.append(makeDefault);
  }
  const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'secondary remove-destination'; remove.textContent = 'Remove from Clockoli'; actions.append(remove);
  article.append(actions, feedback);
  if (destination.initialized !== false) renderTeammateInstructions(article, destination);
  const removalPanel = renderRemoval(article, destination);
  remove.addEventListener('click', () => { removalPanel.hidden = false; removalPanel.focus?.(); });
  return article;
}

function readySetupDestination(destination) {
  if (!destination || destinationNeedsAttention(destination)) return false;
  if (!['write_verified', 'access_checked'].includes(destination.verificationStatus || destination.status)
      && !(destination.id === defaultDestinationId() && state?.ready)) return false;
  if (!repositoryDiscoveryKnown) return true;
  return repositories.some(repository => repository.ready !== false && repository.eligible && (repository.storageState || repository.state) === 'initialized_member'
    && repository.canAdd === true && repository.fullName?.toLowerCase() === `${destination.owner}/${destination.repo}`.toLowerCase());
}
function canFinishRepositorySetup() {
  return !repositoryActionApplying && !state?.candidateAuth
    && readySetupDestination(configuredDestinations().find(destination => destination.id === defaultDestinationId()));
}

function renderDestinationCards() {
  const destinations = configuredDestinations();
  const root = $('time-repository-list'); root.replaceChildren();
  $('time-repositories-empty').hidden = destinations.length > 0;
  $('add-time-repository').hidden = state?.auth?.mode === 'pat';
  $('pat-repository-limitation').hidden = state?.auth?.mode !== 'pat';
  const fallback = defaultDestinationId();
  const chooser = $('setup-default-destination');
  $('setup-default-destination-label').hidden = destinations.length === 0;
  chooser.replaceChildren();
  for (const destination of destinations.filter(readySetupDestination)) {
    const option = document.createElement('option'); option.value = destination.id; option.textContent = destinationLabel(destination); chooser.append(option);
  }
  chooser.value = fallback;
  chooser.disabled = repositoryActionApplying || Boolean(state?.candidateAuth);
  $('finish-setup').hidden = !showOnboarding && destinations.length > 0;
  $('finish-setup').disabled = !canFinishRepositorySetup();
  $('setup-ready-summary').textContent = state?.candidateAuth && authorizationBlock
    ? authorizationBlock.message
    : destinations.length
      ? `Connected repositories are listed above with their status. Default: ${destinationLabel(destinations.find(destination => destination.id === fallback))}. Choose a ready default, or check another repository.`
      : 'Ready repositories appear here automatically. If none are ready, check a repository to initialize or join it.';
  for (const destination of [...destinations].sort((a, b) => destinationLabel(a).localeCompare(destinationLabel(b)))) {
    root.append(renderDestinationCard(destination, destination.id === fallback));
  }
}

function renderOnboardingProgress() {
  const authorized = isAppAuthorized();
  const step = onboardingStep({ authorized });
  $('current-step').textContent = String(step);
  $('current-step-name').textContent = ['Connect GitHub', 'Connect time repositories'][step - 1];
  $('progress-fill').style.width = `${(step / 2) * 100}%`;
  const previousStep = renderedOnboardingStep;
  renderedOnboardingStep = step;
  $('device-step').hidden = step !== 1;
  $('repository-step').hidden = step !== 2;
  $('device-complete').hidden = step === 1;
  $('device-account').textContent = authorized && (state?.candidateAuth?.githubLogin || state?.auth?.githubLogin)
    ? ` as ${state.candidateAuth?.githubLogin || state.auth?.githubLogin}` : '';
  if (previousStep !== null && previousStep !== step) {
    queueMicrotask(() => $(step === 1 ? 'connection-title' : 'repository-step-title').focus());
  }
}

function renderState() {
  const accountConnected = Boolean(state?.auth);
  const destinations = configuredDestinations();
  const repositoryFlowOpen = Boolean(state?.candidateAuth) || (state?.auth?.mode === 'github_app' && (showOnboarding || destinations.length === 0));
  $('connected').hidden = !accountConnected;
  $('onboarding').hidden = accountConnected && !repositoryFlowOpen;
  $('time-repositories').hidden = !accountConnected;
  $('display-settings').hidden = !state.config && destinations.length === 0;
  if (settingsConnected !== accountConnected) {
    $('more-settings').open = Boolean(accountConnected);
    settingsConnected = accountConnected;
  }
  $('more-settings-toggle').hidden = Boolean(accountConnected);
  $('onboarding-flow').hidden = setupCancelled;
  $('setup-cancelled').hidden = !setupCancelled;
  $('build-warning').hidden = state.appConfigured;
  $('authorize').disabled = !state.appConfigured;
  $('connection-status').textContent = accountConnected ? (state.auth?.mode === 'pat' ? 'Connected with PAT' : 'Connected') : (state.candidateAuth ? 'Setup in progress' : 'Not connected');
  $('connection-status').className = `badge${accountConnected ? ' ready' : ''}`;
  $('connection-title').textContent = accountConnected ? 'GitHub account' : 'Set up Clockoli';

  if (state.config) {
    $('owner').value = state.config.owner || '';
    $('repo').value = state.config.repo || '';
    $('branch').value = state.config.branch || 'main';
    $('recent-days').value = state.config.recentDays || 7;
  }
  $('connected-account').textContent = state.auth?.githubLogin ? `@${state.auth.githubLogin}` : 'Personal access token';
  $('save-display').disabled = destinations.length === 0;
  setLink('revoke', state.authorizationSettingsUrl);
  $('revoke-action').hidden = state.auth?.mode !== 'github_app';
  setLink('manage-authorization', state.authorizationSettingsUrl || 'https://github.com/settings/apps/authorizations');
  renderRepositoryAccess();
  renderDestinationCards();
  renderDestinationControls(localPreferences || {});

  if (state.deviceAttempt) renderDeviceAttempt(state.deviceAttempt);
  else $('device-panel').hidden = true;
  $('authorize-panel').hidden = Boolean(state.deviceAttempt || state.candidateAuth);
  renderOnboardingProgress();
  scheduleRepositoryPolling();
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
      message(`Device activation complete for ${result.githubLogin}. Connect your time repositories below.`, 'success');
      discoveryStatus = 'idle';
      await refreshState();
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
  const reasons = Array.isArray(repository.reasons) ? repository.reasons : [];
  return reasons.map(reason => labels[reason] || 'unavailable').join(', ');
}

function repositoryMatchesIntent() { return true; }

function repositoryChoiceAccount() {
  const auth = state?.candidateAuth || state?.auth;
  return auth?.mode === 'github_app' ? String(auth.githubUserId || auth.githubLogin || '') : '';
}

function rememberRepositoryTarget(fullName) {
  repositoryTarget = fullName;
  repositoryInputDirty = false;
  $('repository-target').value = fullName;
  const account = repositoryChoiceAccount();
  // Serialize writes so a slower previous click cannot overwrite the latest choice.
  choiceWrite = choiceWrite.catch(() => {}).then(() => account ? choiceStore.saveOnboardingRepositoryChoice(account, fullName) : undefined);
  return choiceWrite;
}

function closeRepositoryAccess() {
  const dialog = $('repository-access-panel');
  if (dialog.open) dialog.close();
  dialog.hidden = true;
}

function renderRepositoryAccess() {
  const owner = repositoryTarget.split('/')[0].toLowerCase();
  const installation = installations.find(item => item.accountLogin.toLowerCase() === owner);
  const missing = !repositoryInputDirty && Boolean(repositoryTarget) && discoveryStatus === 'ready' && !selectedRepository;
  const needsAppWrite = selectedRepository?.reasons?.includes('app_contents_write_required');
  // Rendering (including background discovery/reload) never opens the modal.
  if (!(missing || needsAppWrite)) closeRepositoryAccess();
  setLink('install-app', installation?.settingsUrl || state?.installationUrl);
  if (repositoryTarget && !repositoryInputDirty) {
    const [owner, name] = parseRepositoryTarget(repositoryTarget).split('/');
    const createUrl = new URL('https://github.com/new?description=Private+Clockoli+time+data&visibility=private&template_owner=Clockoli&template_name=data-template');
    createUrl.searchParams.set('owner', owner);
    createUrl.searchParams.set('name', name);
    setLink('modal-new-time-repository', createUrl.href);
  } else setLink('modal-new-time-repository', '');
  $('repository-access-target').textContent = repositoryTarget;
  $('repository-access-name').textContent = repositoryTarget;
  $('repository-access-instruction').textContent = missing
    ? 'Clockoli cannot access this repository. Check its name and your GitHub access; its existence is not confirmed.'
    : 'Clockoli needs Contents: Read and write permission for this repository.';
  $('repository-target-status').textContent = repositoryInputDirty ? 'Select Check repository to inspect the edited target.' : !repositoryTarget ? '' : missing
    ? `Clockoli cannot access ${repositoryTarget}. It may be private, not granted to the App, awaiting approval, or the name may be incorrect. Its existence is not confirmed. Check the name and your GitHub access.`
    : selectedRepository ? `${selectedRepository.fullName}: ${repositoryInspectionStatus(selectedRepository)}`
      : `Checking ${repositoryTarget}…`;
}

function repositoryActionKey(repository = selectedRepository) {
  if (!repository) return '';
  const storageState = repository.storageState || repository.state;
  const organization = repository.ownerType === 'Organization' || repository.ownership === 'organization';
  if (storageState === 'initialized_member' && repository.canAdd === true && !repository.ready) return 'add';
  if (storageState === 'initialized_joinable' && repository.canJoin === true) return 'join';
  if (['empty', 'uninitialized'].includes(storageState) && repository.canInitialize === true) {
    return organization ? 'initialize_organization' : 'initialize_personal';
  }
  return '';
}

function repositoryAction(repository = selectedRepository) {
  return {
    add: 'Set up storage branch', join: 'Join repository', initialize_personal: 'Initialize repository',
    initialize_organization: 'Initialize repository',
  }[repositoryActionKey(repository)] || 'Choose repository';
}

function repositoryIsConnected(repository) {
  return Boolean(repository) && configuredDestinations().some(destination =>
    String(destination.repoId || '') === String(repository.repoId || 'missing')
    || `${destination.owner}/${destination.repo}`.toLowerCase() === repository.fullName?.toLowerCase());
}

function repositoryCanBeSelected(repository) {
  return (repository?.branchSetupRequired || !repositoryIsConnected(repository))
    && repository?.eligible === true && Boolean(repositoryActionKey(repository));
}

function updateRepositoryConfirmation() {
  closeRepositoryConfirmation();
}

function repositoryInspectionStatus(repository) {
  if (repositoryIsConnected(repository) && repository.ready !== false && !state?.candidateAuth && repository.eligible && (repository.storageState || repository.state) === 'initialized_member' && repository.canAdd) return 'Ready — connected';
  const storageState = repository.storageState || repository.state;
  if (storageState === 'initialized_member' && repository.ready) return 'Ready';
  if (storageState === 'initialized_member' && repository.branchSetupRequired) return 'Needs setup — personal storage branch';
  if (storageState === 'initialized_member' && repository.canAdd && repository.eligible) return 'Ready';
  if (storageState === 'initialized_joinable' && repository.canJoin) return 'Ready to join';
  if (storageState === 'empty' && repository.canInitialize) return 'Empty — initialization will create the first commit';
  if (storageState === 'uninitialized' && repository.canInitialize) return 'Needs setup — initialize Clockoli storage';
  const reasons = Array.isArray(repository.reasons) ? repository.reasons : [];
  if (reasons.includes('admin_required') || reasons.includes('administrator_required')
      || ((repository.ownerType === 'Organization' || repository.ownership === 'organization') && ['empty', 'uninitialized'].includes(storageState))) return 'Administrator setup required';
  if (reasons.includes('private_required')) return 'Unavailable — private repository required';
  if (reasons.includes('archived')) return 'Unavailable — repository is archived';
  if (reasons.includes('disabled')) return 'Unavailable — repository is disabled';
  if (reasons.includes('app_contents_write_required')) return 'Unavailable — Clockoli App needs Contents: Read and write';
  if (reasons.includes('user_write_required')) return 'Unavailable — your GitHub account needs read and write access';
  if (storageState === 'incompatible') return 'Unavailable — incompatible Clockoli storage';
  return repositoryReason(repository) ? `Unavailable — ${repositoryReason(repository)}` : 'Unavailable';
}

function renderRepositoryList() {
  const query = $('repository-search').value.trim().toLowerCase();
  const visible = repositories.filter(repository => !query || repository.fullName.toLowerCase().includes(query))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
  const signature = JSON.stringify(visible.map(repository => [repository.fullName, repository.installationId, repository.repoId,
    repositoryInspectionStatus(repository), repositoryCanBeSelected(repository), repositoryActionKey(repository)]));
  if (repositoryListSignature === signature) return;
  repositoryListSignature = signature;
  const root = $('repository-list');
  const focused = document.activeElement?.dataset?.repositoryAction;
  root.replaceChildren();
  if (!visible.length) {
    const empty = document.createElement('p'); empty.className = 'help';
    empty.textContent = repositories.length ? 'No repository matches this search.' : 'No accessible repositories yet. Enter a repository URL or owner/name above.';
    root.append(empty); return;
  }
  for (const repository of visible) {
    const row = document.createElement('div'); row.className = 'repository-option';
    const icon = document.createElement('span'); icon.className = 'repository-icon'; icon.setAttribute('aria-hidden', 'true');
    const copy = document.createElement('span');
    const name = document.createElement('a'); name.textContent = repository.fullName;
    name.href = `https://github.com/${repository.fullName}`; name.target = '_blank'; name.rel = 'noreferrer';
    const status = document.createElement('small'); status.textContent = repositoryInspectionStatus(repository);
    copy.append(name, status);
    const action = document.createElement('button'); action.type = 'button'; action.className = 'secondary';
    action.dataset.repositoryAction = repository.fullName;
    const selectable = repositoryCanBeSelected(repository);
    action.textContent = selectable ? repositoryAction(repository) : repositoryIsConnected(repository) ? 'Connected' : 'Check repository';
    action.disabled = repositoryActionApplying || (repositoryIsConnected(repository) && !repository.branchSetupRequired);
    action.addEventListener('click', async () => {
      selectedRepository = repository;
      await rememberRepositoryTarget(repository.fullName);
      updateRepositoryConfirmation(); renderRepositoryAccess();
      if (selectable) reviewSelectedRepository();
      else $('check-repository-target').click();
    });
    row.append(icon, copy);
    if (!repository.ready) row.append(action);
    root.append(row);
    if (!repository.ready && focused === repository.fullName) action.focus();
  }
}

function renderRepositories(result) {
  repositories = result.repositories;
  installations = result.installations || [];
  // An explicit target always wins, including when it is absent or unavailable.
  selectedRepository = repositoryInputDirty ? null : repositoryTarget
    ? repositories.find(repository => repository.fullName.toLowerCase() === repositoryTarget.toLowerCase()) || null
    : selectOnlyEligibleRepository(repositories.filter(repositoryCanBeSelected));
  $('repository-choice-fieldset').hidden = repositories.length === 0;
  const searchHidden = repositories.length < 5;
  $('repository-search-label').hidden = searchHidden;
  if (searchHidden && $('repository-search').value) {
    $('repository-search').value = '';
    repositoryListSignature = '';
  }
  updateRepositoryConfirmation();
  renderRepositoryList();
  renderRepositoryAccess();
  renderOnboardingProgress();
}

function reviewSelectedRepository() {
  const intent = repositoryActionKey(selectedRepository);
  if (!intent || !repositoryCanBeSelected(selectedRepository)) return false;
  const repository = selectedRepository;
  const fullName = repository.fullName || `${repository.owner}/${repository.repo}`;
  pendingConfirmation = {
    installationId: repository.installationId,
    repoId: repository.repoId,
    intent,
    fullName,
    defaultBranch: repository.defaultBranch || 'main',
    storageState: repository.storageState || repository.state,
  };
  const titles = {
    add: `Add ${fullName}?`, join: `Join ${fullName}?`,
    initialize_personal: `Initialize ${fullName}?`,
    initialize_organization: `Initialize ${fullName}?`,
  };
  const bodies = {
    add: 'Clockoli will add this repository to this browser, create or verify your personal storage branch, and make it available for project routing. Existing Clockoli records and other users’ branches will not be changed.',
    join: 'Clockoli will add your GitHub identity to this repository’s Clockoli user list and create your personal storage branch if it does not exist. Other users’ branches and time records will not be changed.',
    initialize_personal: 'Clockoli will initialize this repository for time tracking.',
    initialize_organization: 'Clockoli will initialize this repository for time tracking. Repository administrator confirmation is required.',
  };
  $('repository-confirmation-title').textContent = titles[intent];
  $('repository-confirmation-body').textContent = `${bodies[intent]} Anyone with read access can see stored task URLs, titles, timestamps, and descriptions.`;
  $('confirm-repository-action').textContent = repositoryAction(repository);
  const writes = $('repository-write-list'); writes.replaceChildren();
  const writeDescriptions = intent === 'add'
    ? [`Create or verify branch clockoli/users/${state?.auth?.githubUserId || 'your GitHub user ID'}`]
    : intent === 'join'
    ? [`Update .clockoli/config.json on ${pendingConfirmation.defaultBranch}`, `Create or verify branch clockoli/users/${state?.auth?.githubUserId || 'your GitHub user ID'}`]
    : intent === 'initialize_organization' || intent === 'initialize_personal'
      ? [`Create .clockoli/config.json on ${pendingConfirmation.defaultBranch}`, `Create branch clockoli/users/${state?.auth?.githubUserId || 'your GitHub user ID'}`, ...(pendingConfirmation.storageState === 'empty' ? ['Create the first commit and default branch'] : [])]
      : [];
  for (const description of writeDescriptions) {
    const item = document.createElement('li'); item.textContent = description; writes.append(item);
  }
  $('repository-write-details').hidden = writeDescriptions.length === 0;
  $('repository-confirmation').hidden = false;
  if (!$('repository-confirmation').open) $('repository-confirmation').showModal();
  return true;
}

async function confirmRepositoryAction() {
  if (!pendingConfirmation || repositoryActionApplying) return false;
  const confirmation = { ...pendingConfirmation };
  repositoryActionApplying = true;
  $('finish-setup').disabled = true;
  $('confirm-repository-action').disabled = true;
  $('close-repository-confirmation').disabled = true;
  $('back-to-repository-selection').disabled = true;
  const actionProgress = confirmation.intent === 'add' ? 'Adding repository…'
    : confirmation.intent === 'join' ? 'Joining repository…' : 'Initializing repository…';
  $('confirm-repository-action').textContent = actionProgress;
  message(`${actionProgress.slice(0, -1)} ${confirmation.fullName}…`);
  try {
    const result = await send({ type: 'SELECT_REPOSITORY', payload: {
      installationId: confirmation.installationId,
      repoId: confirmation.repoId,
      action: confirmation.intent.startsWith('initialize_') ? 'initialize' : confirmation.intent,
    } });
    stopRepositoryMonitoring();
    await rememberRepositoryTarget('');
    showOnboarding = true;
    selectedRepository = null;
    updateRepositoryConfirmation();
    pendingConfirmation = null;
    await refreshState();
    renderRepositoryList();
    $('time-repositories-title').focus();
    await refreshLocalPreferences();
    message(confirmation.intent.startsWith('initialize_')
      ? 'Repository initialized. Clockoli verified the setup write.'
      : confirmation.intent === 'join'
        ? 'Repository joined. Clockoli registered your storage branch.'
        : 'Repository added. Existing Clockoli membership was validated.', 'success');
    return true;
  } catch (error) {
    message(error.message, 'error');
    showRecovery(error);
    $('confirm-repository-action').textContent = repositoryAction(selectedRepository);
    return false;
  } finally {
    repositoryActionApplying = false;
    renderDestinationCards();
    $('confirm-repository-action').disabled = false;
    $('close-repository-confirmation').disabled = false;
    $('back-to-repository-selection').disabled = false;
  }
}

function closeRepositoryConfirmation() {
  pendingConfirmation = null;
  const dialog = $('repository-confirmation');
  if (dialog.open) dialog.close();
  dialog.hidden = true;
}

async function discoverRepositories({ silent = false } = {}) {
  // Keep the actual request in flight until it settles, even after lifecycle invalidation.
  if (discoveryPromise) {
    const waitingRevision = repositoryLifecycle;
    await discoveryPromise.catch(() => {});
    if (silent || waitingRevision !== repositoryLifecycle) return;
    return discoverRepositories();
  }
  const revision = repositoryLifecycle;
  const account = repositoryChoiceAccount();
  if (!silent) {
    discoveryStatus = 'loading'; selectedRepository = null;
    updateRepositoryConfirmation(); closeRepositoryAccess();
    message('Checking accessible repositories…'); showRecovery();
  }
  const request = send({ type: 'DISCOVER_REPOSITORIES' });
  discoveryPromise = request;
  try {
    const result = await request;
    if (revision !== repositoryLifecycle || account !== repositoryChoiceAccount()) return;
    if (silent && (pendingConfirmation || repositoryActionApplying || !repositoryPollingActive())) return;
    const previousDestinations = JSON.stringify([state?.destinations, state?.destinationRegistry]);
    if (result.onboardingState) {
      if (!configuredDestinations().length) showOnboarding = true;
      state = { ...state, ...result.onboardingState };
    }
    authorizationBlock = result.blocked || null;
    if (result.blocked) {
      renderDestinationCards();
      if (!silent) message(result.blocked.message, 'error');
      return result;
    }
    if (silent) {
      if (pendingConfirmation || repositoryActionApplying || !repositoryPollingActive()) return;
      repositories = result.repositories;
      installations = result.installations || [];
      repositoryDiscoveryKnown = true;
      renderRepositoryList();
      if (previousDestinations !== JSON.stringify([state?.destinations, state?.destinationRegistry])) renderDestinationCards();
      $('finish-setup').disabled = !canFinishRepositorySetup();
    } else {
      discoveryStatus = 'ready'; repositoryDiscoveryKnown = true; renderRepositories(result); renderDestinationCards();
      message(repositoryTarget && !selectedRepository ? $('repository-target-status').textContent : 'Enter a repository URL or owner/name, review a repository action, or finish setup with a ready default.');
    }
    return result;
  } catch (error) {
    if (!silent && revision === repositoryLifecycle) {
      discoveryStatus = 'error'; selectedRepository = null; updateRepositoryConfirmation();
      $('repository-target-status').textContent = 'Repository check failed. Retry when GitHub is available.';
      message(error.message, 'error'); throw error;
    }
  } finally {
    if (discoveryPromise === request) discoveryPromise = null;
  }
}

function repositoryPollingActive() {
  return !repositoryPollingStopped && !setupCancelled && isAppAuthorized()
    && (showOnboarding || Boolean(state?.candidateAuth) || configuredDestinations().length === 0);
}
function stopRepositoryMonitoring() {
  repositoryLifecycle++;
  clearTimeout(repositoryMonitorTimer); repositoryMonitorTimer = null;
}
function scheduleRepositoryPolling() {
  if (repositoryMonitorTimer || !repositoryPollingActive()) return;
  repositoryMonitorTimer = setTimeout(async () => {
    repositoryMonitorTimer = null;
    if (!repositoryPollingActive()) return;
    if (!pendingConfirmation && !repositoryActionApplying && !$('repository-access-panel').open && !discoveryPromise) {
      await discoverRepositories({ silent: true });
    }
    scheduleRepositoryPolling();
  }, 3000);
}
window.addEventListener('pagehide', () => { repositoryPollingStopped = true; stopRepositoryMonitoring(); });

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
  const existingIds = new Set([...$('projects-list').querySelectorAll('.project-row')].map(item => item.dataset.projectId));
  let projectId = project.id;
  while (!projectId || existingIds.has(projectId)) projectId = `project-${++projectSequence}`;
  row.dataset.projectId = projectId;
  const nameLabel = document.createElement('label'); nameLabel.textContent = 'Name';
  const name = document.createElement('input'); name.className = 'project-name'; name.required = true; name.maxLength = 80; name.autocomplete = 'off'; name.placeholder = 'work'; name.value = project.name || ''; nameLabel.append(name);
  const substringsLabel = document.createElement('label'); substringsLabel.textContent = 'URL substrings';
  const substrings = document.createElement('textarea'); substrings.className = 'project-substrings'; substrings.required = true; substrings.rows = Math.max(1, (project.substrings || []).length); substrings.maxLength = 50_000; substrings.placeholder = 'linear.app/my-team/\ngithub.com/my-company/'; substrings.value = (project.substrings || []).join('\n'); substringsLabel.append(substrings);
  const destinationLabelElement = document.createElement('label'); destinationLabelElement.textContent = 'Time repository';
  const destination = document.createElement('select'); destination.className = 'project-destination'; destination.required = true;
  destination.dataset.selectedDestinationId = project.destinationId || $('default-destination').value || defaultDestinationId();
  destination.addEventListener('change', () => { destination.dataset.selectedDestinationId = destination.value; });
  destinationLabelElement.append(destination);
  const clientLabel = document.createElement('label'); clientLabel.textContent = 'Client';
  const client = document.createElement('select'); client.className = 'project-client';
  const selected = document.createElement('option'); selected.value = project.client || ''; client.append(selected); client.value = selected.value; clientLabel.append(client);
  const actions = document.createElement('div'); actions.className = 'project-actions';
  const up = document.createElement('button'); up.type = 'button'; up.className = 'secondary move-project-up'; up.textContent = '↑'; up.setAttribute('aria-label', `Move project ${project.name || 'row'} up`); up.addEventListener('click', () => moveProjectRow(row, -1));
  const down = document.createElement('button'); down.type = 'button'; down.className = 'secondary move-project-down'; down.textContent = '↓'; down.setAttribute('aria-label', `Move project ${project.name || 'row'} down`); down.addEventListener('click', () => moveProjectRow(row, 1));
  const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'secondary remove-project'; remove.textContent = '✕'; remove.setAttribute('aria-label', project.name ? `Remove project ${project.name}` : 'Remove this project');
  remove.addEventListener('click', () => { row.remove(); refreshProjectOrderControls(); });
  actions.append(up, down, remove); row.append(nameLabel, substringsLabel, destinationLabelElement, clientLabel, actions); $('projects-list').append(row); wireAutoGrow(substrings); renderDestinationControls(localPreferences || {}); refreshProjectOrderControls(); refreshProjectClients();

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
  const rows = [...$('projects-list').querySelectorAll('.project-row')];
  const basic = normalizeProjects(rows.map(row => ({
    name: row.querySelector('.project-name').value,
    client: row.querySelector('.project-client').value,
    substrings: row.querySelector('.project-substrings').value.split(/\r?\n/).map(value => value.trim()).filter(Boolean),
  })));
  return basic.map((project, index) => ({
    id: rows[index].dataset.projectId || `project-${index + 1}`,
    ...project,
    destinationId: rows[index].querySelector('.project-destination').value,
  }));
}

function projectClientLinksPayload() {
  const rows = new Map([...$('projects-list').querySelectorAll('.project-row')].map(row => [row.dataset.projectId, row]));
  return {
    projectClients: Object.fromEntries((localPreferences?.projects || []).filter(project => project.id && rows.has(project.id))
      .map(project => [project.id, rows.get(project.id).querySelector('.project-client').value])),
    otherProjectClient: $('other-project-client').value,
  };
}

function fillDestinationSelect(select, selectedId) {
  if (!select) return;
  const destinations = configuredDestinations(), known = new Set(destinations.map(destination => destination.id));
  select.replaceChildren();
  for (const destination of destinations) {
    const option = document.createElement('option'); option.value = destination.id;
    option.textContent = `${destinationLabel(destination)}${destinationNeedsAttention(destination) ? ' — needs attention' : ''}`;
    option.selected = destination.id === selectedId; select.append(option);
  }
  if (selectedId && !known.has(selectedId)) {
    const option = document.createElement('option'); option.value = selectedId;
    option.textContent = `${selectedId} — needs attention`; option.selected = true; select.append(option);
  }
  select.value = selectedId || destinations[0]?.id || '';
}

function renderDestinationControls(preferences = {}) {
  const destinations = configuredDestinations(), fallback = preferences.defaultDestinationId || defaultDestinationId();
  fillDestinationSelect($('default-destination'), fallback);
  $('default-destination').disabled = state?.auth?.mode === 'pat' || destinations.length < 2;
  $('default-destination-label').hidden = state?.auth?.mode === 'pat' || destinations.length === 0;
  $('pat-routing-summary').hidden = state?.auth?.mode !== 'pat';
  $('pat-routing-summary').textContent = state?.auth?.mode === 'pat' && destinations[0]
    ? `All projects use ${destinationLabel(destinations[0])} in personal access token compatibility mode.` : '';
  for (const row of $('projects-list').querySelectorAll('.project-row')) {
    const select = row.querySelector('.project-destination');
    fillDestinationSelect(select, select.dataset.selectedDestinationId || fallback);
    select.disabled = state?.auth?.mode === 'pat';
  }
}

function renderDisplayPreferences(preferences) {
  $('recent-days').value = state?.config?.recentDays || preferences.recentDays || 7;
  $('other-project-name').value = preferences.otherProjectName || 'Other';
  $('show-queue-diagnostics').checked = preferences.showQueueDiagnostics === true;
  $('projects-list').replaceChildren();
  for (const project of preferences.projects || []) addProjectRow(project);
  const selected = document.createElement('option'); selected.value = preferences.otherProjectClient || ''; $('other-project-client').append(selected); $('other-project-client').value = selected.value;
  refreshProjectClients();
  renderDestinationControls(preferences);
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

function ratesPayload() {
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
  return rates;
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
  if (JSON.stringify([state?.auth, state?.candidateAuth]) !== JSON.stringify([nextState?.auth, nextState?.candidateAuth])) { stopRepositoryMonitoring(); repositoryDiscoveryKnown = false; }
  state = nextState;
  state.deviceAttempt = resumedAttempt || state.deviceAttempt;
  if (!isAppAuthorized()) {
    repositories = [];
    selectedRepository = null;
    discoveryStatus = 'idle';
  }
  const account = repositoryChoiceAccount();
  if (account !== choiceAccount) {
    choiceAccount = account;
    const saved = account ? await choiceStore.getOnboardingRepositoryChoice(account) : '';
    try { repositoryTarget = saved ? parseRepositoryTarget(saved) : ''; } catch { repositoryTarget = ''; }
    $('repository-target').value = repositoryTarget;
    selectedRepository = null;
    discoveryStatus = 'idle';
    if (repositoryTarget) showOnboarding = true;
  }
  renderState();
  if (isAppAuthorized() && !setupCancelled && (showOnboarding || configuredDestinations().length === 0) && discoveryStatus === 'idle') {
    await discoverRepositories().catch(() => {});
  }
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
  discoveryStatus = 'idle';
  renderState();
  void discoverRepositories().catch(() => {});
}
async function checkRepositoryAccess() {
  message('Checking GitHub repository access…');
  try {
    await send({ type: 'CHECK_REPOSITORY_ACCESS' });
    await refreshState();
    showRecovery();
    message('Repository and branch access confirmed.', 'success');
  } catch (error) { message(error.message, 'error'); showRecovery(error, { retry: 'access' }); }
}

$('confirm-repository-action').addEventListener('click', () => void confirmRepositoryAction());
for (const id of ['back-to-repository-selection', 'close-repository-confirmation']) $(id).addEventListener('click', () => {
  if (repositoryActionApplying) return;
  closeRepositoryConfirmation();
  $('check-repository-target').focus();
});

$('repository-confirmation').addEventListener('cancel', event => { event.preventDefault(); if (!repositoryActionApplying) closeRepositoryConfirmation(); });
$('cancel-app-setup').addEventListener('click', async () => {
  stopRepositoryMonitoring(); setupCancelled = true;
  clearTimeout(pollTimer);
  $('cancel-app-setup').disabled = true;
  try {
    await rememberRepositoryTarget('');
    await send({ type: 'CANCEL_GITHUB_APP_SETUP' });
    repositories = []; selectedRepository = null; discoveryStatus = 'idle';
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
  if (isAppAuthorized()) void discoverRepositories().catch(() => {});
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
    stopRepositoryMonitoring(); repositories = []; selectedRepository = null; discoveryStatus = 'idle'; setupCancelled = false; showOnboarding = true;
    await refreshState();
    message('All local Clockoli data cleared. Repository data and GitHub authorization were not deleted.', 'success');
  } catch (error) { message(error.message, 'error'); }
  finally { $('clear-local').disabled = false; }
});


for (const id of ['open-device-page']) {
  $(id).addEventListener('click', () => { githubHandoff = true; });
}
$('repository-target-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('check-repository-target');
  const revision = repositoryLifecycle;
  const account = repositoryChoiceAccount();
  button.disabled = true; button.textContent = 'Checking repository';
  try {
    const target = parseRepositoryTarget($('repository-target').value);
    selectedRepository = null;
    updateRepositoryConfirmation();
    $('repository-access-panel').hidden = true;
    await rememberRepositoryTarget(target);
    if (revision !== repositoryLifecycle || account !== repositoryChoiceAccount() || setupCancelled) return;
    const result = await discoverRepositories();
    if (!result || revision !== repositoryLifecycle || account !== repositoryChoiceAccount() || setupCancelled) return;
    if (!repositoryInputDirty && repositoryTarget === target && discoveryStatus === 'ready'
        && (!selectedRepository || selectedRepository.reasons?.includes('app_contents_write_required'))) {
      const dialog = $('repository-access-panel');
      dialog.hidden = false;
      dialog.showModal();
    } else if (!repositoryInputDirty && repositoryTarget === target) {
      if (!reviewSelectedRepository()) $('repository-target-status').focus();
    }
  } catch (error) { message(error.message, 'error'); }
  finally { button.disabled = false; button.textContent = 'Check repository'; }
});
$('repository-target').addEventListener('input', () => {
  // Editing is not permission to apply an earlier inspection/confirmation.
  repositoryInputDirty = true;
  selectedRepository = null;
  updateRepositoryConfirmation();
  $('repository-access-panel').hidden = true;
});
$('close-repository-access').addEventListener('click', closeRepositoryAccess);
$('repository-access-panel').addEventListener('cancel', event => { event.preventDefault(); closeRepositoryAccess(); });
$('repository-access-panel').addEventListener('close', () => {
  $('repository-access-panel').hidden = true;
  $('check-repository-target').focus();
});
$('install-app').addEventListener('click', event => {
  event.preventDefault();
  if (!repositoryTarget || !$('repository-access-panel').open) return;
  const url = $('install-app').href;
  closeRepositoryAccess();
  stopRepositoryMonitoring();
  scheduleRepositoryPolling();
  githubHandoff = false;
  try {
    if (!openGitHubHandoff(url)) throw new Error('Browser blocked the GitHub access tab. Allow popups and try again.');
    message('The repository list updates automatically. Return to set up the repository, or use Check repository for its URL.');
  } catch (error) { message(error.message, 'error'); }
});
for (const id of ['new-time-repository', 'modal-new-time-repository']) $(id).addEventListener('click', () => {
  closeRepositoryAccess();
  githubHandoff = false;
  message('Create a private repository on GitHub, then return and enter its URL. Nothing is initialized automatically.');
});
$('setup-default-destination').addEventListener('change', async () => {
  const chooser = $('setup-default-destination'); chooser.disabled = true; $('finish-setup').disabled = true;
  repositoryActionApplying = true;
  try { await send({ type: 'SET_DEFAULT_DESTINATION', destinationId: chooser.value }); await refreshState(); await refreshLocalPreferences(); }
  catch (error) { message(error.message, 'error'); }
  finally { repositoryActionApplying = false; renderDestinationCards(); }
});
$('finish-setup').addEventListener('click', async () => {
  if (!canFinishRepositorySetup() || $('finish-setup').disabled) return;
  $('finish-setup').disabled = true;
  stopRepositoryMonitoring();
  showOnboarding = false;
  selectedRepository = null;
  updateRepositoryConfirmation();
  try { await rememberRepositoryTarget(''); }
  catch (error) { showOnboarding = true; renderDestinationCards(); scheduleRepositoryPolling(); message(error.message, 'error'); return; }
  showOnboarding = false;
  closeRepositoryAccess();
  stopRepositoryMonitoring();
  renderState();
  message('Setup complete. Add more time repositories here whenever you need them.', 'success');
});
$('add-time-repository').addEventListener('click', async event => {
  event.preventDefault();
  stopRepositoryMonitoring();
  setupCancelled = false;
  showOnboarding = true;
  selectedRepository = null;
  discoveryStatus = 'idle';
  try {
    await rememberRepositoryTarget('');
    renderState();
    await discoverRepositories();
  } catch (error) { message(error.message, 'error'); }
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
  void discoverRepositories().catch(() => {});
});


$('show-queue-diagnostics').addEventListener('change', async () => {
  const control = $('show-queue-diagnostics');
  const previous = localPreferences?.showQueueDiagnostics === true;
  if (!localPreferences || !state?.config) { control.checked = previous; return; }
  control.disabled = true;
  formFeedback('diagnostics-feedback', 'Saving diagnostics setting…');
  try {
    const result = await send({ type: 'SET_QUEUE_DIAGNOSTICS', enabled: control.checked });
    localPreferences = result.preferences;
    control.checked = localPreferences.showQueueDiagnostics === true;
    formFeedback('diagnostics-feedback', 'Queue diagnostics saved.', 'success');
  } catch (error) {
    control.checked = previous;
    formFeedback('diagnostics-feedback', error.message || 'Could not save diagnostics setting.', 'error');
  } finally { control.disabled = false; }
});

$('display-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!state?.config) return;
  const button = $('save-display'), operation = saveButtonFeedback(button);
  formFeedback('display-feedback', 'Saving display settings…');
  try {
    const result = await send({ type: 'UPDATE_DISPLAY_PREFERENCES', expectedRevision: localPreferences.revision, payload: {
      recentDays: Number($('recent-days').value),
      projects: projectsPayload(),
      defaultDestinationId: $('default-destination').value,
      otherProjectName: $('other-project-name').value,
      otherProjectClient: $('other-project-client').value,
      showQueueDiagnostics: $('show-queue-diagnostics').checked,
    } });
    state.config = result.config;
    localPreferences = { ...localPreferences, ...result.preferences, revision: result.revision };
    renderDisplayPreferences(localPreferences);
    formFeedback('display-feedback', ''); saveButtonFeedback(button, 'saved', operation);
  } catch (error) { formFeedback('display-feedback', error.message || 'Could not save display settings.', 'error'); saveButtonFeedback(button, 'error', operation); }
});

$('add-project').addEventListener('click', () => addProjectRow());
$('add-rate').addEventListener('click', () => addRateRow());
$('add-client').addEventListener('click', () => addClientRow());
$('billing-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = $('save-billing'), operation = saveButtonFeedback(button); formFeedback('billing-feedback', 'Saving billable rates…');
  try {
    const result = await send({ type: 'SAVE_BILLING_SETTINGS', payload: { rates: ratesPayload() }, expectedRevision: localPreferences.revision });
    localPreferences = { ...localPreferences, rates: result.rates, revision: result.revision, exportRecommended: true };
    renderBillingPreferences(localPreferences);
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
    const result = await send({
      type: 'SAVE_BILLING_SETTINGS', payload: { invoicing: invoicingPayload() },
      projectLinks: projectClientLinksPayload(), expectedRevision: localPreferences.revision,
    });
    localPreferences = {
      ...localPreferences, invoicing: result.invoicing, projects: result.projects,
      otherProjectClient: result.otherProjectClient, revision: result.revision, exportRecommended: true,
    };
    renderInvoicingPreferences(localPreferences);
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
function settingsImportMessage(result) {
  const issues = Array.isArray(result?.notRestored) ? result.notRestored : [];
  if (!issues.length) return 'Local settings restored from backup. GitHub remains connected only if it was already connected.';
  const details = issues.map(issue => issue.type === 'project'
    ? `project “${issue.name}” — its route was not restored because repository ${issue.repository} is ${issue.reason}`
    : `repository ${issue.repository} — dependent settings were not restored because it is ${issue.reason}`);
  return `Local settings restored where possible. Not restored: ${details.join('; ')}. Connect the missing time repositories, then import the backup again. GitHub remains connected only if it was already connected.`;
}

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
    message(settingsImportMessage(result), result.notRestored?.length ? 'warning' : 'success');
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
