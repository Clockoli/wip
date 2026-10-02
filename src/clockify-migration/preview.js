import { renderMigrationInvitations } from './invitations.js';

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

function safeProfiles(users) {
  if (!Array.isArray(users)) return [];
  const seen = new Set();
  return users.flatMap(user => {
    const login = user?.login;
    if (typeof login !== 'string' || !GITHUB_LOGIN.test(login) || seen.has(login.toLowerCase())) return [];
    seen.add(login.toLowerCase());
    let avatarUrl = '';
    try {
      const url = new URL(user.avatarUrl);
      if (url.protocol === 'https:' && url.hostname === 'avatars.githubusercontent.com') avatarUrl = url.href;
    } catch {}
    return [{ id: Number.isSafeInteger(user.id) && user.id > 0 ? user.id : null,
      login, name: typeof user.name === 'string' ? user.name : '', avatarUrl }];
  });
}

function profileRow(user, showAvatar) {
  const row = document.createElement('span'); row.className = 'mapping-profile';
  if (showAvatar && user.avatarUrl) {
    const avatar = document.createElement('img'); avatar.className = 'mapping-avatar';
    avatar.src = user.avatarUrl; avatar.alt = ''; avatar.setAttribute('aria-hidden', 'true');
    avatar.addEventListener('error', () => avatar.remove()); row.append(avatar);
  }
  const identity = document.createElement('span'); identity.className = 'mapping-identity';
  const login = document.createElement('span'); login.className = 'mapping-profile-login'; login.textContent = `@${user.login}`;
  identity.append(login);
  if (user.name) {
    const name = document.createElement('span'); name.className = 'mapping-name'; name.textContent = user.name;
    identity.append(name);
  }
  row.append(identity);
  return row;
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
  $('progress-summary').textContent = total ? (isCompleted ? `Processed ${completed} of ${total} people` : `Importing ${completed} of ${total} people`) : label;
  element.hidden = false;
}

export function renderUsers(users, getSuggestions, updateValidity) {
  const root = $('source-users');
  root.replaceChildren();
  const refresh = [];
  for (const [index, user] of users.entries()) {
    const row = document.createElement('div'); row.className = 'mapping-row';
    const source = document.createElement('p'); source.className = 'source-user'; source.textContent = user.displayName;
    const count = document.createElement('span'); count.className = 'source-user-count'; count.textContent = `${user.entryCount} ${user.entryCount === 1 ? 'entry' : 'entries'}`;
    source.append(count);
    const field = document.createElement('div'); field.className = 'mapping-field';
    const label = document.createElement('label'); label.className = 'mapping-login'; label.htmlFor = `github-login-${index}`; label.textContent = 'GitHub login';
    const input = document.createElement('input'); input.className = 'mapping-login-input';
    input.id = `github-login-${index}`; input.type = 'text'; input.required = true; input.autocomplete = 'off'; input.spellcheck = false; input.maxLength = 39;
    input.setAttribute('aria-label', `GitHub login for ${user.displayName}`);
    input.setAttribute('aria-controls', `github-choices-${index}`); input.setAttribute('aria-expanded', 'false');
    const choices = document.createElement('div'); choices.id = `github-choices-${index}`; choices.className = 'mapping-choices'; choices.hidden = true;
    const feedback = document.createElement('p'); feedback.className = 'mapping-search-feedback'; feedback.setAttribute('role', 'status');
    let generation = 0, timer;
    const close = () => { choices.hidden = true; input.setAttribute('aria-expanded', 'false'); };
    const open = () => { choices.hidden = false; input.setAttribute('aria-expanded', 'true'); };
    const show = (profiles, emptyMessage, showAvatars = false) => {
      choices.replaceChildren();
      const validProfiles = safeProfiles(profiles);
      for (const profile of validProfiles) {
        const choice = document.createElement('button'); choice.type = 'button'; choice.className = 'mapping-choice';
        choice.append(profileRow(profile, showAvatars));
        choice.addEventListener('click', () => {
          ++generation; clearTimeout(timer); input.value = profile.login; close(); feedback.textContent = '';
          updateValidity(); input.focus();
        });
        choices.append(choice);
      }
      feedback.textContent = validProfiles.length ? '' : emptyMessage;
      choices.append(feedback); open();
    };
    const displayDefaults = () => {
      const { users: defaults } = getSuggestions();
      show(defaults, 'No repository users available. Enter a GitHub login manually.', true);
    };
    refresh.push(() => { if (!choices.hidden && !input.value.trim() && !input.disabled) displayDefaults(); });
    input.addEventListener('focus', () => {
      if (!input.disabled && !input.value.trim()) displayDefaults();
    });
    input.addEventListener('click', () => { if (!input.disabled && !input.value.trim() && choices.hidden) displayDefaults(); });
    input.addEventListener('input', () => {
      const current = ++generation; clearTimeout(timer);
      const query = input.value.trim();
      if (!query) { displayDefaults(); return; }
      choices.replaceChildren(feedback);
      if (query.length < 2) { feedback.textContent = 'Type at least 2 characters to search GitHub logins.'; open(); return; }
      const { destinationId } = getSuggestions();
      if (!destinationId) { feedback.textContent = 'Search is unavailable. Enter a GitHub login manually.'; open(); return; }
      feedback.textContent = 'Searching GitHub users…'; open();
      timer = setTimeout(async () => {
        try {
          const result = await send({ type: 'SEARCH_CLOCKIFY_GITHUB_USERS', payload: { destinationId, query } });
          if (current === generation && !input.disabled) show(result?.users, 'No matching GitHub logins. You can still enter a login manually.');
        } catch (error) {
          if (current === generation && !input.disabled) { choices.replaceChildren(feedback); feedback.textContent = error.message; open(); }
        }
      }, 250);
    });
    input.addEventListener('keydown', event => { if (event.key === 'Escape') { ++generation; clearTimeout(timer); close(); } });
    field.addEventListener('focusout', event => { if (!field.contains(event.relatedTarget)) { ++generation; clearTimeout(timer); close(); } });
    const skip = document.createElement('label'); skip.className = 'mapping-skip';
    const skipInput = document.createElement('input'); skipInput.type = 'checkbox'; skipInput.className = 'mapping-skip-input';
    skip.append(skipInput, ' Skip this person');
    skipInput.addEventListener('change', () => {
      ++generation; clearTimeout(timer); close(); input.disabled = skipInput.checked;
      if (skipInput.checked) input.value = '';
      updateValidity();
    });
    field.append(label, input, choices); choices.append(feedback);
    row.append(source, field, skip); root.append(row);
  }
  return () => refresh.forEach(update => update());
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
    const collision = diagnostic?.collision;
    const hasCollisionComparison = collision?.incoming && collision?.existing && collision?.comparison;
    const collisionDetail = hasCollisionComparison
      ? ` Incoming: ${collision.incoming.recordId}; ${collision.incoming.startedAt} to ${collision.incoming.endedAt} (${collision.incoming.durationSeconds}s); provenance ${collision.incoming.provenanceSha256}; task fingerprint ${collision.incoming.taskFingerprintSha256}. Existing: ${collision.existing.recordId} in ${collision.existing.path}, line ${collision.existing.line}; ${collision.existing.startedAt} to ${collision.existing.endedAt} (${collision.existing.durationSeconds}s); provenance ${collision.existing.provenanceSha256}; task fingerprint ${collision.existing.taskFingerprintSha256}. Comparison: provenance ${collision.comparison.sameProvenance ? 'matches' : 'differs'}, time ${collision.comparison.sameTimeRange ? 'matches' : 'differs'}, task ${collision.comparison.sameTaskFingerprint ? 'matches' : 'differs'}.`
      : collision?.recordId && collision?.path && Number.isSafeInteger(collision.line)
        ? ` Existing record: ${collision.recordId} in ${collision.path}, line ${collision.line}.`
      : '';
    const label = diagnostic?.stage === 'preparing_destination_record'
      ? `Clockoli failed while preparing the destination record. Code: ${diagnostic.code}.${diagnostic.detail ? ` Detail: ${diagnostic.detail}.` : ''}${collisionDetail} Nothing was written.`
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
  let suggestions = { users: [], destinationId: '' };
  const form = $('mapping-form');
  const confirmation = $('confirmation');
  const importButton = $('import');
  const mappingView = $('mapping-view');
  const migrationView = $('migration-view');
  const invitationSection = $('migration-invitations');
  const renderInvitations = outcome => {
    renderMigrationInvitations({ container: invitationSection, outcome, send, confirm: question => window.confirm(question),
      collaboratorIds: new Set(suggestions.users.map(user => user.id).filter(Boolean)) });
    invitationSection.hidden = !invitationSection.childElementCount;
  };

  const updateValidity = () => {
    const inputs = [...document.querySelectorAll('.mapping-login-input')];
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
      try {
        const saved = await send({ type: 'GET_CLOCKIFY_MIGRATION_PREVIEW' });
        if (saved?.outcome?.id === preview.id) renderInvitations(saved.outcome);
      } catch { invitationSection.textContent = 'Could not load invitation options. Reopen this preview to try again.'; invitationSection.hidden = false; }
    } catch (error) {
      $('import-status').hidden = true;
      importButton.textContent = 'Import completed time';
      showMessage(error.message || 'Could not confirm the migration.');
    } finally { submitting = false; try { progress?.port.disconnect(); } catch {} updateValidity(); }
  });

  (async () => {
    try {
      const data = await send({ type: 'GET_CLOCKIFY_MIGRATION_PREVIEW', measureRequests: true });
      if (data?.outcome) {
        const users = safeUsers(data.outcome.users);
        if (!users.length || !Array.isArray(data.outcome.outcomes)) throw new Error('The recovered migration outcome is incomplete. Return to the Clockify report and capture it again.');
        preview = { id: String(data.outcome.id), users };
        mappingView.hidden = true; migrationView.hidden = false; finished = true;
        renderOutcomes(users, data.outcome.outcomes);
        try {
          const access = await send({ type: 'GET_CLOCKIFY_MIGRATION_SUGGESTIONS' });
          suggestions = { users: safeProfiles(access?.users), destinationId: typeof access?.destinationId === 'string' ? access.destinationId : '' };
        } catch { /* invitation checks still verify repository access server-side */ }
        renderInvitations(data.outcome);
        renderProgress({ phase: 'completed', completedUsers: data.outcome.outcomes.length, totalUsers: data.outcome.outcomes.length });
        showMessage(outcomeMessage(data.outcome.outcomes), 'success');
        $('loading').hidden = true; $('preview').hidden = false;
        return;
      }
      const users = safeUsers(data?.users);
      const entryCount = Array.isArray(data?.entries) ? data.entries.length : Number(data?.entries);
      if (!data?.id || !users.length || !Number.isSafeInteger(entryCount) || entryCount < 1) throw new Error('The migration preview is unavailable or incomplete. Return to the Clockify report and try again.');
      preview = { id: String(data.id), users };
      $('entry-count').textContent = String(entryCount);
      const refreshSuggestions = renderUsers(users, () => suggestions, updateValidity);
      send({ type: 'GET_CLOCKIFY_MIGRATION_SUGGESTIONS' }).then(data => {
        suggestions = { users: safeProfiles(data?.users), destinationId: typeof data?.destinationId === 'string' ? data.destinationId : '' };
        refreshSuggestions();
      }).catch(() => {});
      $('loading').hidden = true; $('preview').hidden = false;
      updateValidity();
    } catch (error) {
      $('loading').hidden = true;
      showMessage(error.message || 'Could not load the migration preview.');
    }
  })();
}

if (typeof document !== 'undefined' && document.getElementById('mapping-form')) initialize();
