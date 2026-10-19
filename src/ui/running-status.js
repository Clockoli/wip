import { formatClockDuration } from '../domain/reporting.js';
import { normalizeTaskUrl, normalizeStoredTaskIdentity, localDateParts, entryDateValue } from '../domain/values.js';
import './tracking-card.js';

const SECOND_MS = 1_000;
const HOUR_MS = 3_600_000;
const LONG_ENTRY_HOURS = 12;
const STATE_POLL_MS = 5_000;
const RECENT_TASK_LIMIT = 3;

export function mountRunningStatus(container, { send, onChange }) {
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
  const elapsed = make('span', 'running-status-elapsed'); elapsed.setAttribute('role', 'timer'); elapsed.setAttribute('aria-label', 'Elapsed time');
  const today = make('span', 'running-status-today');
  const stop = make('button', 'running-status-stop'); stop.type = 'button'; stop.textContent = 'Stop and save';
  const error = make('div', 'running-status-error'); error.setAttribute('role', 'alert'); error.hidden = true;
  row.append(idle, quickStart);
  const { live, metrics } = globalThis.ClockoliTrackingCard.createTrackingCard(document, { root: row, task, elapsed, today, stop });
  for (const node of [live, task, metrics, stop]) node.hidden = true;
  container.classList.add('running-status'); container.setAttribute('aria-label', 'Running status');
  container.replaceChildren(row, error);
  let state = null, readAt = 0, reportDate = '', requestId = 0, busy = false, destroyed = false, recentKey = '';
  const localDate = () => entryDateValue(localDateParts(new Date(Date.now())));

  function showError(cause) {
    error.textContent = cause?.message || ''; error.hidden = !error.textContent;
  }

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
    today.textContent = `Today ${totalText}`;
    if (state.active) {
      const seconds = Math.max(0, Math.floor((Date.now() - new Date(state.active.startedAt).getTime()) / SECOND_MS));
      elapsed.textContent = formatClockDuration(Math.floor(seconds / 60) * 60);
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
    for (const node of [live, task, metrics, stop]) node.hidden = !active;
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
    let failure = null;
    try {
      // Another surface may have changed the active task since the last poll.
      state = await send({ type: 'GET_PAGE_STATE' });
      if (destroyed) return;
      readAt = Date.now(); reportDate = localDate(); render();
      if (!state.active) return;
      const hours = (Date.now() - new Date(state.active.startedAt).getTime()) / HOUR_MS;
      if (hours > LONG_ENTRY_HOURS && !confirm(`This entry is ${Math.floor(hours)} hours long. Save anyway?`)) return;
      const completion = await send({ type: 'STOP' });
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
