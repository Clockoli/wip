import { formatClockDuration } from '../domain/reporting.js';
import { normalizeTaskUrl, normalizeStoredTaskIdentity, localDateParts, entryDateValue } from '../domain/values.js';
import { dateValue, timeValue, parseTime, localTimestamp } from './local-time.js';
import './tracking-card.js';

const SECOND_MS = 1_000;
const HOUR_MS = 3_600_000;
const LONG_ENTRY_HOURS = 12;
const STATE_POLL_MS = 5_000;
const RECENT_TASK_LIMIT = 3;

export function mountRunningStatus(container, { send, onChange, showToday = true }) {
  const document = container.ownerDocument || globalThis.document;
  const row = document.createElement('div'); row.className = 'running-status-row';
  const make = (tag, className) => {
    const node = document.createElement(tag); node.className = className; return node;
  };
  const idle = make('span', 'running-status-idle'); idle.textContent = 'Loading tracking status…';
  const quickStart = make('div', 'running-status-quick-start');
  const quickLabel = make('span', 'running-status-quick-label'); quickLabel.textContent = 'Quick start from recent tasks:';
  const recentList = make('div', 'running-status-recent');
  quickStart.append(quickLabel, recentList); quickStart.hidden = true;
  const task = make('a', 'running-status-task'); task.target = '_blank'; task.rel = 'noreferrer';
  const elapsed = make('span', 'running-status-elapsed'); elapsed.setAttribute('role', 'timer'); elapsed.setAttribute('aria-label', 'Duration');
  const today = make('span', 'running-status-today');
  const elapsedLabel = make('span', 'running-status-metric-label'); elapsedLabel.textContent = 'Duration';
  const elapsedValue = make('span', 'running-status-metric-value'); elapsed.append(elapsedLabel, elapsedValue);
  const todayLabel = make('span', 'running-status-metric-label'); todayLabel.textContent = 'Today';
  const todayValue = make('span', 'running-status-metric-value'); today.append(todayLabel, todayValue);
  const stop = make('button', 'running-status-stop'); stop.type = 'button'; stop.textContent = 'Stop and save';
  const descriptionField = make('div', 'running-status-description-field');
  const description = make('textarea', 'running-status-description');
  description.rows = 1; description.maxLength = 2000; description.placeholder = 'Description (optional)';
  description.setAttribute('aria-label', 'Description');
  const saveDescription = make('button', 'running-status-description-save');
  saveDescription.type = 'button'; saveDescription.textContent = '✓';
  saveDescription.title = 'Save description'; saveDescription.setAttribute('aria-label', 'Save description');
  const saved = make('span', 'running-status-description-saved');
  saved.textContent = '✓ Saved'; saved.setAttribute('role', 'status');
  const moreLines = make('small', 'running-status-description-more');
  moreLines.textContent = '↓ More lines — scroll'; moreLines.hidden = true;
  descriptionField.append(description, saveDescription, saved, moreLines);
  const startField = make('div', 'running-status-start-field');
  const startLabel = make('label', 'running-status-start-label');
  const startCaption = make('span', 'running-status-start-caption'); startCaption.textContent = 'Started';
  const start = make('input', 'running-status-start'); start.type = 'text'; start.inputMode = 'numeric';
  start.placeholder = 'HH:MM'; start.maxLength = 5; start.autocomplete = 'off'; start.value = '';
  start.title = 'Edit started time; press Enter to save';
  const startValue = make('span', 'running-status-start-value'); startValue.append(start);
  startLabel.append(startCaption, startValue);
  const saveStart = make('button', 'running-status-start-save'); saveStart.type = 'button';
  saveStart.textContent = '✓'; saveStart.title = 'Save start'; saveStart.setAttribute('aria-label', 'Save start');
  const startSaved = make('span', 'running-status-start-saved');
  startSaved.textContent = '✓ Saved'; startSaved.setAttribute('role', 'status'); startSaved.hidden = true;
  startField.append(startLabel, saveStart, startSaved);
  const error = make('div', 'running-status-error'); error.setAttribute('role', 'alert'); error.hidden = true;
  const idleGroup = make('div', 'running-status-idle-group');
  const idleHint = make('span', 'running-status-idle-hint');
  idleHint.textContent = 'Start a task to begin';
  idleGroup.append(idle, idleHint);
  row.append(idleGroup, quickStart);
  const { live, metrics } = globalThis.ClockoliTrackingCard.createTrackingCard(document, { root: row, task, description: descriptionField, elapsed, today: showToday ? today : null, stop });
  const stats = make('div', 'running-status-stats'); stats.append(startField, metrics);
  row.replaceChildren(idleGroup, quickStart, live, task, descriptionField, stats, stop);
  for (const node of [live, task, descriptionField, stats, stop]) node.hidden = true;
  container.classList.add('running-status'); container.setAttribute('aria-label', 'Running status');
  container.replaceChildren(row, error);
  let state = null, readAt = 0, reportDate = '', requestId = 0, busy = false, destroyed = false, recentKey = '';
  let shownTimer = '', acceptedDescription = '', pendingAccepted = null;
  let focusDescriptionOnLoad = true;
  let savingDescription = null, submittedDescription = null, saveAgain = false, hideSavedTimer = null;
  let shownStartTimer = '', acceptedStartedAt = '', pendingAcceptedStart = null, savingStart = false, hideStartSavedTimer = null;
  const localDate = () => entryDateValue(localDateParts(new Date(Date.now())));
  const timerKey = active => active ? String(active.id || active.startedAt) : '';
  const normalizedDescription = value => String(value || '').replace(/\r\n?/g, '\n').replace(/\t/g, ' ')
    .replace(/ {2,}/g, ' ').trim().slice(0, 2000);

  function showError(cause) {
    error.textContent = cause?.message || ''; error.hidden = !error.textContent;
  }

  function resizeDescription() {
    const count = String(description.value || '').split('\n').length;
    description.rows = Math.min(8, Math.max(1, count));
    description.style.height = 'auto';
    const height = Number(description.scrollHeight) || 0;
    const clipped = count > 8 || height > 180;
    if (height) description.style.height = `${Math.min(180, Math.max(32, height))}px`;
    description.style.overflowY = clipped ? 'auto' : 'hidden';
    moreLines.hidden = !clipped;
  }

  function updateDescriptionSave() {
    saveDescription.hidden = normalizedDescription(description.value) === normalizedDescription(acceptedDescription);
  }

  function showSaved() {
    if (hideSavedTimer !== null) clearTimeout(hideSavedTimer);
    saved.hidden = false;
    hideSavedTimer = setTimeout(() => { saved.hidden = true; }, 3000);
  }

  function renderDescription(active) {
    const key = timerKey(active);
    if (key !== shownTimer) {
      shownTimer = key;
      acceptedDescription = active?.description || '';
      pendingAccepted = null;
      savingDescription = null; submittedDescription = null; saveAgain = false;
      if (hideSavedTimer !== null) clearTimeout(hideSavedTimer);
      saved.hidden = true;
      description.value = acceptedDescription;
    } else if (active && !savingDescription && !saveDescription.hidden) {
      // Preserve an unsaved draft across the five-second state refresh.
    } else if (active && !savingDescription) {
      const latest = active.description || '';
      if (pendingAccepted === null || latest === pendingAccepted) {
        acceptedDescription = latest;
        pendingAccepted = null;
        description.value = latest;
      }
    }
    descriptionField.hidden = !active;
    resizeDescription();
    updateDescriptionSave();
  }

  function updateStartSave() {
    const initial = new Date(acceptedStartedAt);
    saveStart.hidden = !acceptedStartedAt || parseTime(start.value) === timeValue(initial);
  }

  function renderStart(active) {
    startField.hidden = !active;
    const key = timerKey(active);
    if (key !== shownStartTimer) {
      shownStartTimer = key; acceptedStartedAt = ''; pendingAcceptedStart = null;
      if (hideStartSavedTimer !== null) clearTimeout(hideStartSavedTimer);
      hideStartSavedTimer = null; startSaved.hidden = true;
    }
    if (!active) return;
    const current = new Date(acceptedStartedAt);
    const dirty = acceptedStartedAt && parseTime(start.value) !== timeValue(current);
    const latest = active.startedAt;
    if (!savingStart && (!dirty || !acceptedStartedAt)
      && (pendingAcceptedStart === null || latest === pendingAcceptedStart)) {
      acceptedStartedAt = latest; pendingAcceptedStart = null;
      start.value = timeValue(new Date(latest));
    }
    updateStartSave();
  }

  function updateStartDraft() { startSaved.hidden = true; updateStartSave(); }
  start.addEventListener('click', () => start.select());
  start.addEventListener('input', updateStartDraft);
  start.addEventListener('blur', () => {
    const normalized = parseTime(start.value);
    if (normalized) start.value = normalized;
    updateStartSave();
  });
  async function commitStart() {
    if (savingStart || !state?.active) return;
    const active = state.active, key = timerKey(active);
    const clock = parseTime(start.value);
    const timestamp = clock && localTimestamp(dateValue(new Date(active.startedAt)), clock);
    if (!timestamp) { showError(new Error('Enter a valid Started time (HH:MM or 1000).')); return; }
    const unchanged = clock === timeValue(new Date(active.startedAt));
    const startedAt = unchanged ? active.startedAt : timestamp.toISOString();
    if (new Date(startedAt).getTime() > Date.now()) { showError(new Error('Started time cannot be in the future.')); return; }
    if (unchanged) return;
    savingStart = true; start.disabled = true; saveStart.disabled = true; showError();
    try {
      await send({ type: 'QUEUE_ACTIVE_START_EDIT', payload: {
        original: { id: active.id, startedAt: active.startedAt }, startedAt,
      } });
      if (destroyed || timerKey(state?.active) !== key) return;
      state = { ...state, active: { ...state.active, startedAt } };
      acceptedStartedAt = startedAt; pendingAcceptedStart = startedAt;
      start.value = clock; updateClocks();
      clearTimeout(hideStartSavedTimer); startSaved.hidden = false;
      hideStartSavedTimer = setTimeout(() => { startSaved.hidden = true; updateStartSave(); }, 3000);
      await onChange?.({ type: 'EDIT_ACTIVE_START', active: state.active });
    } catch (cause) { if (!destroyed) showError(cause); }
    finally { savingStart = false; start.disabled = false; saveStart.disabled = false; updateStartSave(); }
  }
  start.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229) return;
    event.preventDefault(); void commitStart();
  });
  saveStart.addEventListener('click', () => void commitStart());

  function commitDescription() {
    const key = shownTimer;
    if (savingDescription) {
      if (normalizedDescription(description.value) !== submittedDescription) saveAgain = true;
      return savingDescription;
    }
    const work = (async () => {
      do {
        saveAgain = false;
        const active = state?.active;
        if (!active || timerKey(active) !== key) return;
        const value = normalizedDescription(description.value);
        submittedDescription = value;
        if (value !== normalizedDescription(acceptedDescription)) {
          await send({ type: 'QUEUE_ACTIVE_START_EDIT', payload: {
            original: { id: active.id, startedAt: active.startedAt }, description: value,
          } });
          if (shownTimer !== key) return;
          acceptedDescription = value;
          pendingAccepted = value;
        }
        if (!saveAgain && normalizedDescription(description.value) === value) showSaved();
        updateDescriptionSave();
      } while (saveAgain);
    })();
    savingDescription = work.finally(() => {
      if (savingDescription === saving) {
        savingDescription = null;
        submittedDescription = null;
        updateDescriptionSave();
      }
    });
    const saving = savingDescription;
    return saving;
  }

  description.addEventListener('input', () => {
    saved.hidden = true;
    resizeDescription();
    updateDescriptionSave();
  });
  description.addEventListener('keydown', event => {
    if (event.key === 'Tab' && !event.shiftKey && !event.isComposing && event.keyCode !== 229 && !stop.disabled) {
      event.preventDefault();
      stop.focus({ preventScroll: true });
      return;
    }
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    void commitDescription().catch(showError);
  });
  description.addEventListener('blur', () => {
    if (!busy && !saveDescription.hidden) void commitDescription().catch(showError);
  });
  saveDescription.addEventListener('click', () => void commitDescription().catch(showError));

  function recentTasks() {
    const candidates = [];
    for (const entry of state?.recent || []) {
      try {
        const taskUrl = normalizeStoredTaskIdentity(entry);
        const taskTitle = String(entry.taskTitle ?? entry.issueTitle ?? '').trim().slice(0, 300);
        const end = Date.parse(entry.endedAt || ''), start = Date.parse(entry.startedAt || '');
        candidates.push({ taskUrl, taskTitle, timestamp: Number.isFinite(end) ? end : (Number.isFinite(start) ? start : 0) });
      } catch { /* Ignore invalid cached task identities. */ }
    }
    candidates.sort((a, b) => b.timestamp - a.timestamp);
    const seen = new Set(), recent = [];
    for (const candidate of candidates) {
      if (seen.has(candidate.taskUrl)) continue;
      seen.add(candidate.taskUrl); recent.push({ taskUrl: candidate.taskUrl, taskTitle: candidate.taskTitle });
      if (recent.length === RECENT_TASK_LIMIT) break;
    }
    return recent;
  }

  function renderRecent() {
    const recent = recentTasks(), key = JSON.stringify(recent);
    if (key !== recentKey) {
      recentKey = key; recentList.replaceChildren();
      for (const item of recent) {
        const label = item.taskTitle || item.taskUrl;
        const button = make('button', 'running-status-recent-task'); button.type = 'button';
        button.title = item.taskUrl;
        button.setAttribute('aria-label', 'Start tracking ' + label);
        const play = make('span', 'running-status-recent-play'); play.setAttribute('aria-hidden', 'true');
        const name = make('span', 'running-status-recent-name'); name.textContent = label;
        button.append(play, name);
        button.addEventListener('click', () => startRecentTask(item));
        recentList.append(button);
      }
      if (!recent.length) {
        const empty = make('span', 'running-status-recent-empty');
        empty.textContent = 'No recent tasks yet'; recentList.append(empty);
      }
    }
    for (const node of recentList.children) node.disabled = busy;
  }

  function updateClocks() {
    if (!state) return;
    const currentDate = localDate();
    const ticking = state.active?.entryDate === currentDate;
    const total = state.todayTrackedMs;
    const totalText = total == null || state.summaryError || reportDate !== currentDate ? '…'
      : formatClockDuration((total + (ticking ? Math.max(0, Date.now() - readAt) : 0)) / SECOND_MS);
    todayValue.textContent = totalText;
    if (state.active) {
      const seconds = Math.max(0, Math.floor((Date.now() - new Date(state.active.startedAt).getTime()) / SECOND_MS));
      elapsedValue.textContent = formatClockDuration(Math.floor(seconds / 60) * 60);
    }
  }

  function render() {
    const active = state.active;
    container.classList.toggle('is-active', Boolean(active));
    container.classList.toggle('is-idle', Boolean(state.configured && !active));
    idle.textContent = 'Not tracking';
    idle.hidden = Boolean(active);
    quickStart.hidden = !state.configured || Boolean(active);
    if (!quickStart.hidden) renderRecent();
    for (const node of [live, task, stats, stop]) node.hidden = !active;
    renderDescription(active);
    renderStart(active);
    stop.disabled = busy;
    if (active) {
      const url = active.taskUrl || active.issue?.url || '';
      task.textContent = active.taskTitle || active.issueTitle || url; task.title = task.textContent;
      try { task.href = normalizeTaskUrl(url); } catch { task.removeAttribute('href'); }
    }
    updateClocks();
  }

  async function readState(refresh = false) {
    const id = ++requestId;
    try {
      // Read durable local state first, even when GitHub cannot be reached.
      const local = await send({ type: 'GET_PAGE_STATE' });
      if (destroyed || id !== requestId) return;
      state = local; readAt = Date.now(); reportDate = localDate(); render(); showError(local.summaryError);
      if (focusDescriptionOnLoad && state.active) {
        focusDescriptionOnLoad = false;
        if (!document.activeElement || document.activeElement === document.body) description.focus({ preventScroll: true });
      }
      if (refresh && local.configured) {
        const remote = await send({ type: 'GET_PAGE_STATE', refresh: true });
        if (destroyed || id !== requestId) return;
        state = remote; readAt = Date.now(); reportDate = localDate(); render(); showError(remote.summaryError);
      }
    } catch (cause) {
      if (!destroyed && id === requestId) showError(cause);
    }
  }

  async function startRecentTask({ taskUrl, taskTitle }) {
    if (busy || destroyed || !state?.configured || state.active) return;
    busy = true; ++requestId; showError(); render();
    let failure = null;
    try {
      // The status may have changed in another tab since the buttons were shown.
      const current = await send({ type: 'GET_PAGE_STATE' });
      if (destroyed) return;
      state = current; readAt = Date.now(); reportDate = localDate(); render();
      if (!current.configured || current.active) return;
      const active = await send({ type: 'START', taskUrl, taskTitle });
      if (destroyed) return;
      // The accepted local timer is immediately available, even before GitHub sync.
      state = { ...state, active }; readAt = Date.now(); reportDate = localDate(); render();
      await onChange?.({ type: 'START', active });
    } catch (cause) { failure = cause; }
    finally {
      if (!destroyed) {
        await readState();
        busy = false; render();
        if (failure) showError(failure);
      }
    }
  }

  stop.addEventListener('click', async () => {
    if (busy || destroyed || !state?.active) return;
    busy = true; stop.disabled = true; ++requestId;
    const stoppingTimer = shownTimer;
    const stopDescription = normalizedDescription(description.value);
    let failure = null;
    try {
      // A preceding Enter/blur save must not race with the local Stop acceptance.
      if (savingDescription) await savingDescription.catch(() => {});
      const latest = await send({ type: 'GET_PAGE_STATE' });
      if (destroyed) return;
      state = latest;
      readAt = Date.now(); reportDate = localDate(); render();
      if (!state.active) return;
      if (timerKey(state.active) !== stoppingTimer) throw new Error('The running timer changed. Retry Stop.');
      const hours = (Date.now() - new Date(state.active.startedAt).getTime()) / HOUR_MS;
      if (hours > LONG_ENTRY_HOURS && !confirm(`This entry is ${Math.floor(hours)} hours long. Save anyway?`)) return;
      const completion = await send({ type: 'STOP', description: stopDescription });
      if (!destroyed) await onChange?.({ type: 'STOP', completion });
    } catch (cause) { failure = cause; }
    finally {
      if (!destroyed) {
        await readState();
        busy = false; stop.disabled = false;
        if (failure) showError(failure);
      }
    }
  });

  const onVisibility = () => { if (!document.hidden && !busy) return readState(true); };
  document.addEventListener('visibilitychange', onVisibility);
  const tick = setInterval(() => {
    if (document.hidden) return;
    updateClocks();
  }, SECOND_MS);
  const poll = setInterval(() => {
    if (!document.hidden && !busy) void readState(reportDate !== localDate());
  }, STATE_POLL_MS);
  void readState(true);
  return () => {
    destroyed = true; ++requestId; clearInterval(tick); clearInterval(poll);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}

// Activity's content renderer is a classic script with a private message helper.
const activityContainer = document.getElementById('activity-running-status');
if (activityContainer) mountRunningStatus(activityContainer, {
  showToday: false,
  send: message => new Promise((resolve, reject) => chrome.runtime.sendMessage(message, response => {
    if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
    if (!response?.ok) return reject(Object.assign(new Error(response?.error?.message || 'Extension request failed'), response?.error));
    resolve(response.data);
  })),
  onChange: detail => {
    // Activity's Timeline is a separate renderer. Forward the *locally accepted*
    // mutation directly; never wait for its next GitHub history refresh.
    document.dispatchEvent(new CustomEvent('clockoli:local-tracking-changed', { detail }));
  },
});
