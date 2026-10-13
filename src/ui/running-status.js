import { formatClockDuration } from '../domain/reporting.js';
import { normalizeTaskUrl, localDateParts, entryDateValue } from '../domain/values.js';

const SECOND_MS = 1_000;
const HOUR_MS = 3_600_000;
const LONG_ENTRY_HOURS = 12;
const STATE_POLL_MS = 5_000;

export function mountRunningStatus(container, { send, onChange }) {
  const document = container.ownerDocument || globalThis.document;
  const row = document.createElement('div'); row.className = 'running-status-row';
  const make = (tag, className) => {
    const node = document.createElement(tag); node.className = className; return node;
  };
  const idle = make('span', 'running-status-idle'); idle.textContent = 'Loading tracking status…';
  const task = make('a', 'running-status-task'); task.target = '_blank'; task.rel = 'noreferrer';
  const elapsed = make('span', 'running-status-elapsed'); elapsed.setAttribute('role', 'timer'); elapsed.setAttribute('aria-label', 'Elapsed time');
  const today = make('span', 'running-status-today');
  const stop = make('button', 'running-status-stop'); stop.type = 'button'; stop.textContent = 'Stop and save';
  const error = make('div', 'running-status-error'); error.setAttribute('role', 'alert'); error.hidden = true;
  for (const node of [task, elapsed, today, stop]) node.hidden = true;
  row.append(idle, task, elapsed, today, stop);
  container.classList.add('running-status'); container.setAttribute('aria-label', 'Running status');
  container.replaceChildren(row, error);
  let state = null, readAt = 0, reportDate = '', requestId = 0, busy = false, destroyed = false;
  const localDate = () => entryDateValue(localDateParts(new Date(Date.now())));

  function showError(cause) {
    error.textContent = cause?.message || ''; error.hidden = !error.textContent;
  }

  function updateClocks() {
    if (!state) return;
    const currentDate = localDate();
    const ticking = state.active?.entryDate === currentDate;
    const total = state.todayTrackedMs;
    const totalText = total == null || state.summaryError || reportDate !== currentDate ? '…'
      : formatClockDuration((total + (ticking ? Math.max(0, Date.now() - readAt) : 0)) / SECOND_MS);
    idle.textContent = `Not tracking · Today ${totalText}`;
    today.textContent = `Today ${totalText}`;
    if (state.active) {
      const seconds = Math.max(0, Math.floor((Date.now() - new Date(state.active.startedAt).getTime()) / SECOND_MS));
      elapsed.textContent = formatClockDuration(Math.floor(seconds / 60) * 60);
    }
  }

  function render() {
    const active = state.active;
    idle.hidden = Boolean(active);
    for (const node of [task, elapsed, today, stop]) node.hidden = !active;
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
      await send({ type: 'STOP' });
      if (!destroyed) await onChange?.();
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
});
