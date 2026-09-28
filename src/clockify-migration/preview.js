const $ = id => document.getElementById(id);
const GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const PROGRESS_LABELS = {
  resolving_identities: 'Verifying GitHub account mappings',
  preparing_storage: 'Preparing Clockoli storage',
  verifying_storage: 'Verifying storage identity',
  reading_existing_records: 'Reading destination records',
  preparing_records: 'Preparing destination records',
  matching_replay_targets: 'Matching prior imports',
  normalizing_intervals: 'Resolving interval placement',
  building_records: 'Building destination records',
  validating_output: 'Validating atomic write',
  writing_records: 'Writing completed records',
  completed: 'Import completed',
};

export function mappingState(users, logins, skipped, confirmed) {
  if (!Array.isArray(users) || users.length === 0 || users.length !== logins.length || users.length !== skipped.length || !confirmed) return { valid: false, mappings: [] };
  const mappings = users.map((user, index) => skipped[index] === true
    ? { sourceUserId: String(user?.id || ''), skipped: true }
    : { sourceUserId: String(user?.id || ''), githubLogin: String(logins[index] || '').trim() });
  const mapped = mappings.filter(mapping => !mapping.skipped);
  const normalizedLogins = mapped.map(mapping => mapping.githubLogin.toLowerCase());
  const valid = mappings.every(mapping => mapping.sourceUserId && (mapping.skipped || GITHUB_LOGIN.test(mapping.githubLogin)))
    && new Set(normalizedLogins).size === normalizedLogins.length;
  return valid ? { valid, mappings } : { valid: false, mappings: [] };
}

function send(request) {
  return new Promise((resolve, reject) => chrome.runtime.sendMessage(request, response => {
    if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
    if (!response?.ok) return reject(Object.assign(new Error(response?.error?.message || 'Extension request failed'), response?.error));
    resolve(response.data);
  }));
}

function safeUsers(value) {
  if (!Array.isArray(value) || value.length === 0) return [];
  const ids = new Set();
  const users = [];
  for (const valueUser of value) {
    const id = String(valueUser?.id || valueUser?.userId || '');
    const displayName = String(valueUser?.displayName || '');
    const entryCount = Number(valueUser?.entryCount);
    if (!id || !displayName || !Number.isSafeInteger(entryCount) || entryCount < 1 || ids.has(id)) return [];
    ids.add(id); users.push({ id, displayName, entryCount });
  }
  return users;
}

function renderSuggestions(logins) {
  const root = $('github-login-suggestions');
  root.replaceChildren();
  if (!Array.isArray(logins)) return;
  const seen = new Set();
  for (const login of logins) {
    if (typeof login !== 'string' || !GITHUB_LOGIN.test(login) || seen.has(login.toLowerCase())) continue;
    seen.add(login.toLowerCase());
    const option = document.createElement('option'); option.value = login; root.append(option);
  }
}

function showMessage(text, kind = 'error') {
  const element = $('message');
  element.textContent = text;
  element.className = `card-header-message ${kind}`;
  element.hidden = !text;
}


function renderProgress(progress) {
  const element = $('import-status');
  const label = PROGRESS_LABELS[progress?.phase];
  const completed = progress?.completedUsers;
  const total = progress?.totalUsers;
  if (!label || !Number.isSafeInteger(completed) || !Number.isSafeInteger(total) || completed < 0 || total < completed) {
    element.hidden = true;
    return;
  }
  const isCompleted = progress.phase === 'completed';
  const phases = Object.keys(PROGRESS_LABELS);
  const activeIndex = phases.indexOf(progress.phase);
  $('import-status-title').textContent = isCompleted ? 'Migration complete' : 'Saving migration';
  $('progress-current-step').textContent = `Step ${activeIndex + 1} of ${phases.length}: ${label}`;
  $('import-progress').value = activeIndex + 1;
  $('progress-summary').textContent = total ? (isCompleted ? `Imported ${completed} of ${total} people` : `Importing ${completed} of ${total} people`) : label;
  element.hidden = false;
}

function renderUsers(users) {
  const root = $('source-users');
  root.replaceChildren();
  for (const [index, user] of users.entries()) {
    const row = document.createElement('div'); row.className = 'mapping-row';
    const source = document.createElement('p'); source.className = 'source-user'; source.textContent = user.displayName;
    const count = document.createElement('span'); count.className = 'source-user-count'; count.textContent = `${user.entryCount} ${user.entryCount === 1 ? 'entry' : 'entries'}`;
    source.append(count);
    const label = document.createElement('label'); label.className = 'mapping-login'; label.htmlFor = `github-login-${index}`; label.append('GitHub login');
    const input = document.createElement('input');
    input.id = `github-login-${index}`; input.type = 'text'; input.required = true; input.autocomplete = 'username'; input.spellcheck = false; input.maxLength = 39;
    input.setAttribute('list', 'github-login-suggestions');
    input.setAttribute('aria-label', `GitHub login for ${user.displayName}`);
    const skip = document.createElement('label'); skip.className = 'mapping-skip';
    const skipInput = document.createElement('input'); skipInput.type = 'checkbox'; skipInput.className = 'mapping-skip-input';
    skip.append(skipInput, ' Skip this person');
    skipInput.addEventListener('change', () => { input.disabled = skipInput.checked; if (skipInput.checked) input.value = ''; });
    label.append(input); row.append(source, label, skip); root.append(row);
  }
}

function outcomeMessage(outcomes) {
  if (!Array.isArray(outcomes)) return 'Migration request completed.';
  const completed = outcomes.filter(outcome => ['imported', 'completed', 'already_present'].includes(outcome?.status)).length;
  const failed = outcomes.length - completed;
  return failed ? `Migration completed for ${completed} user${completed === 1 ? '' : 's'}; ${failed} user${failed === 1 ? '' : 's'} were not imported.`
    : `Migration completed for ${completed} user${completed === 1 ? '' : 's'}.`;
}

const FAILURE_LABELS = {
  github_rate_limited: 'GitHub rate limit blocked storage-branch preparation. Capture the report and try again after the limit resets.',
  github_authentication: 'GitHub authentication was rejected while preparing the storage branch. Reconnect GitHub, then capture and try again.',
  github_permission: 'GitHub denied permission to prepare the storage branch. Check repository write access, then capture and try again.',
  repository_or_branch_not_found: 'The configured repository or storage branch was not found. Check repository access, then capture and try again.',
  github_conflict: 'GitHub reported a storage-branch conflict. Capture the report and try again.',
  github_validation: 'GitHub rejected the storage-branch request. Check repository setup, then capture and try again.',
  storage_branch_unavailable: 'Clockoli could not prepare the storage branch. Capture the report and try again.',
  storage_branch_incomplete: 'Clockoli storage for this person is incomplete. Capture the report and try again.',
  storage_data_unreadable: 'Existing Clockoli time data for this person could not be read safely. Repair it before retrying.',
  invalid_imported_interval: 'Clockoli rejected a destination interval because its timestamp or duration is invalid. Nothing was written.',
  invalid_imported_task: 'Clockoli rejected a destination task URL or title. Nothing was written.',
  invalid_imported_description: 'Clockoli rejected a destination description. Nothing was written.',
  invalid_imported_time_context: 'Clockoli rejected a destination timezone or local date. Nothing was written.',
  invalid_imported_record_id: 'Clockoli could not create a valid destination record ID. Nothing was written.',
  invalid_imported_record: 'Clockoli rejected a generated destination record. Nothing was written.',
  github_write_rate_limited: 'GitHub rate limit blocked the atomic record write. Nothing was written; retry after the limit resets.',
  github_write_authentication: 'GitHub rejected authentication for the atomic record write. Nothing was written; reconnect GitHub before retrying.',
  github_write_permission: 'GitHub denied permission for the atomic record write. Nothing was written; check repository write access.',
  github_write_target_missing: 'GitHub could not find the configured repository or personal storage branch during the atomic record write. Nothing was written.',
  github_write_rejected: 'GitHub rejected the atomic record write as an invalid request. Nothing was written.',
  github_write_failed: 'GitHub failed the atomic record write for an unknown transport or server reason. Nothing was written.',
  overlapping_intervals: 'Clockoli could not resolve the imported intervals safely. Nothing was imported; capture the report and try again.',
  record_write_failed: 'Clockoli could not save this person\'s completed records. Capture the report and try again.',
};

function renderOutcomes(users, outcomes) {
  const root = $('outcomes');
  root.replaceChildren();
  if (!Array.isArray(outcomes)) { root.hidden = true; return; }
  const names = new Map(users.map(user => [user.id, user.displayName]));
  const labels = {
    imported: 'Imported', completed: 'Imported', already_present: 'Already present', rejected: 'Not imported',
    conflict: 'A concurrent change prevented the record write. Capture the report and try again.',
    failed: 'Clockoli could not complete this import. Capture the report and try again.',
  };
  for (const outcome of outcomes) {
    const name = names.get(String(outcome?.sourceUserId || outcome?.userId || ''));
    const repair = outcome?.repair;
    const diagnostic = outcome?.diagnostic;
    const label = diagnostic?.stage === 'preparing_destination_record'
      ? `Clockoli failed while preparing the destination record. Code: ${diagnostic.code}.${diagnostic.detail ? ` Detail: ${diagnostic.detail}.` : ''} Nothing was written.`
      : repair?.kind === 'monthly_partition_mismatch'
      ? `Clockoli found a misplaced record in ${repair.path}, line ${repair.line}: its local month is ${repair.actualMonth}, not ${repair.expectedMonth}. Move it to the ${repair.actualMonth} monthly file, then retry.`
      : outcome?.status === 'failed' && FAILURE_LABELS[outcome?.failureReason]
        ? FAILURE_LABELS[outcome.failureReason] : labels[outcome?.status];
    if (!name || !label) continue;
    const item = document.createElement('li'); item.textContent = `${name}: ${label}`; root.append(item);
  }
  root.hidden = !root.childElementCount;
}

function initialize() {
  let preview = null;
  let submitting = false;
  let finished = false;
  const form = $('mapping-form');
  const confirmation = $('confirmation');
  const importButton = $('import');
  const mappingView = $('mapping-view');
  const migrationView = $('migration-view');

  const updateValidity = () => {
    const inputs = [...document.querySelectorAll('.mapping-login input')];
    const skipped = [...document.querySelectorAll('.mapping-skip-input')].map(input => input.checked);
    const state = mappingState(preview?.users || [], inputs.map(input => input.value), skipped, confirmation.checked);
    const duplicateLogins = inputs.map((input, index) => skipped[index] ? '' : input.value.trim().toLowerCase());
    inputs.forEach((input, index) => input.setAttribute('aria-invalid', String(Boolean(input.value.trim()) && duplicateLogins.indexOf(duplicateLogins[index]) !== duplicateLogins.lastIndexOf(duplicateLogins[index]))));
    importButton.disabled = !state.valid || submitting || finished;
    return state;
  };

  const openProgressPort = () => new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const port = chrome.runtime.connect({ name: 'CLOCKIFY_MIGRATION_PROGRESS_V1' });
    let subscribed = false;
    const timeout = setTimeout(() => { if (!subscribed) { try { port.disconnect(); } catch {} reject(new Error('Could not connect import progress. Reload the preview and try again.')); } }, 3000);
    port.onMessage.addListener(message => {
      if (!subscribed && message?.type === 'CLOCKIFY_MIGRATION_PROGRESS_SUBSCRIBED' && Object.keys(message).length === 1) {
        subscribed = true; clearTimeout(timeout); resolve({ requestId, port }); return;
      }
      if (subscribed && message?.type === 'CLOCKIFY_MIGRATION_PROGRESS' && (Object.keys(message).length === 4 || Object.keys(message).length === 5)) renderProgress(message);
    });
    port.onDisconnect.addListener(() => { if (subscribed && submitting) showMessage('Import is continuing; waiting for the final result…', ''); });
    port.postMessage({ type: 'SUBSCRIBE_CLOCKIFY_MIGRATION_PROGRESS', requestId });
  });

  form.addEventListener('input', updateValidity);
  confirmation.addEventListener('change', updateValidity);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const state = updateValidity();
    if (!state.valid || submitting || finished) return;
    submitting = true; importButton.disabled = true; importButton.textContent = 'Saving migration…'; showMessage('Importing completed time…', '');
    mappingView.hidden = true; migrationView.hidden = false;
    migrationView.scrollIntoView({ block: 'start' });
    renderProgress({ phase: 'resolving_identities', completedUsers: 0, totalUsers: preview.users.length });
    let progress;
    try {
      progress = await openProgressPort();
      const data = await send({ type: 'CONFIRM_CLOCKIFY_MIGRATION', payload: { id: preview.id, mappings: state.mappings, requestId: progress.requestId } });
      renderOutcomes(preview.users, data?.outcomes || data);
      finished = true; importButton.textContent = 'Migration imported';
      showMessage(outcomeMessage(data?.outcomes || data), 'success');
    } catch (error) {
      $('import-status').hidden = true;
      importButton.textContent = 'Import completed time';
      showMessage(error.message || 'Could not confirm the migration.');
    } finally { submitting = false; try { progress?.port.disconnect(); } catch {} updateValidity(); }
  });

  (async () => {
    try {
      const data = await send({ type: 'GET_CLOCKIFY_MIGRATION_PREVIEW' });
      const users = safeUsers(data?.users);
      const entryCount = Array.isArray(data?.entries) ? data.entries.length : Number(data?.entries);
      if (!data?.id || !users.length || !Number.isSafeInteger(entryCount) || entryCount < 1) throw new Error('The migration preview is unavailable or incomplete. Return to the Clockify report and try again.');
      preview = { id: String(data.id), users };
      $('entry-count').textContent = String(entryCount);
      renderUsers(users);
      send({ type: 'GET_CLOCKIFY_MIGRATION_SUGGESTIONS' }).then(data => renderSuggestions(data?.logins)).catch(() => renderSuggestions([]));
      $('loading').hidden = true; $('preview').hidden = false;
      updateValidity();
    } catch (error) {
      $('loading').hidden = true;
      showMessage(error.message || 'Could not load the migration preview.');
    }
  })();
}

if (typeof document !== 'undefined' && document.getElementById('mapping-form')) initialize();
