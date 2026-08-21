import { effectiveTrackedSeconds, sortTrackedTasks, taskPeriodRange } from '../domain/tasks.js';

const PERIOD_KEY = 'repoclock.tasks.period';
const LEGACY_PERIOD_KEY = 'github-private-time-tracker.tasks.period';
const PERIODS = new Set(['two-weeks', 'one-month', 'three-months', 'six-months', 'one-year']);
const ISSUE_OPEN_PATH = 'M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z';
const ISSUE_CLOSED_PATH = 'M11.28 6.78a.75.75 0 0 0-1.06-1.06L7.25 8.69 5.78 7.22a.75.75 0 0 0-1.06 1.06l2 2a.75.75 0 0 0 1.06 0l3.5-3.5ZM16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0Zm-1.5 0a6.5 6.5 0 1 0-13 0 6.5 6.5 0 0 0 13 0Z';
const ISSUE_NOT_PLANNED_PATH = 'M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Zm9.78-2.22-5.5 5.5a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734l5.5-5.5a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042Z';
const PULL_OPEN_PATH = 'M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z';
const PULL_CLOSED_PATH = 'M3.25 1A2.25 2.25 0 0 1 4 5.372v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.251 2.251 0 0 1 3.25 1Zm9.5 5.5a.75.75 0 0 1 .75.75v3.378a2.251 2.251 0 1 1-1.5 0V7.25a.75.75 0 0 1 .75-.75Zm-2.03-5.273a.75.75 0 0 1 1.06 0l.97.97.97-.97a.748.748 0 0 1 1.265.332.75.75 0 0 1-.205.729l-.97.97.97.97a.751.751 0 0 1-.018 1.042.751.751 0 0 1-1.042.018l-.97-.97-.97.97a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734l.97-.97-.97-.97a.75.75 0 0 1 0-1.06ZM2.5 3.25a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0ZM3.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm9.5 0a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z';
const PULL_MERGED_PATH = 'M5.45 5.154A4.25 4.25 0 0 0 9.25 7.5h1.378a2.251 2.251 0 1 1 0 1.5H9.25A5.734 5.734 0 0 1 5 7.123v3.505a2.25 2.25 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.95-.218ZM4.25 13.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm8.5-4.5a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM5 3.25a.75.75 0 1 0 0 .005V3.25Z';
const $ = id => document.getElementById(id);
const state = { tasks: [], active: null, pendingWrites: [], configured: false, requestId: 0, busyUrl: '', range: null };
let tick = null;

function send(message) {
  return new Promise((resolve, reject) => chrome.runtime.sendMessage(message, response => {
    if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
    if (!response?.ok) return reject(Object.assign(new Error(response?.error?.message || 'Extension request failed'), response?.error));
    resolve(response.data);
  }));
}

function localDateValue(date = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function sameIssue(a, b) {
  return Boolean(a && b && a.type === b.type && a.owner === b.owner && a.repo === b.repo && a.number === b.number);
}

function formatDuration(seconds, { current = false } = {}) {
  const minutes = Math.max(0, current ? Math.floor(seconds / 60) : Math.round(seconds / 60));
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return hours ? `${hours}h ${rest}m` : `${rest}m`;
}

function currentElapsedSeconds() {
  return state.active ? Math.max(0, Math.floor((Date.now() - new Date(state.active.startedAt).getTime()) / 1000)) : 0;
}

function setError(error = '') {
  const root = $('error'), text = error?.message || String(error || '');
  root.replaceChildren(document.createTextNode(text));
  const recovery = globalThis.RepoClockRecovery.actionFor(error?.code), label = recovery?.label || '';
  if (label) {
    const action = document.createElement('button'); action.type = 'button'; action.className = 'button secondary'; action.textContent = label;
    action.addEventListener('click', () => { if (recovery.kind === 'retry') void load(); else void send({ type: 'OPEN_OPTIONS' }); });
    root.append(document.createTextNode(' '), action);
  }
  root.hidden = !text;
}

function taskVisualStatus(task) {
  if (task.issue.type === 'issue' && task.status === 'CLOSED') return task.stateReason === 'NOT_PLANNED' ? 'not-planned' : 'completed';
  return task.status.toLowerCase();
}

function taskIcon(task) {
  const { type } = task.issue, { status } = task, visualStatus = taskVisualStatus(task);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16'); svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', `task-icon ${type === 'pull_request' ? 'pull-request' : 'issue'} ${visualStatus}`);
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  const iconPath = type === 'pull_request'
    ? (status === 'MERGED' ? PULL_MERGED_PATH : status === 'CLOSED' ? PULL_CLOSED_PATH : PULL_OPEN_PATH)
    : (visualStatus === 'not-planned' ? ISSUE_NOT_PLANNED_PATH : status === 'CLOSED' ? ISSUE_CLOSED_PATH : ISSUE_OPEN_PATH);
  path.setAttribute('d', iconPath); svg.append(path); return svg;
}

function statusMatches(task, selected) {
  if (selected === 'all') return true;
  if (selected === 'open') return task.status === 'OPEN';
  return task.status === 'CLOSED' || task.status === 'MERGED';
}

function taskTotalSeconds(task) {
  return effectiveTrackedSeconds(task, { active: state.active, now: Date.now() });
}

function visibleTasks() {
  const query = $('task-filter').value.trim().toLowerCase(), status = $('status').value;
  const filtered = state.tasks.filter(task => {
    if (!statusMatches(task, status)) return false;
    if (!query) return true;
    const searchable = `${task.title} ${task.issue.owner}/${task.issue.repo} #${task.issue.number} ${task.issue.type}`.toLowerCase();
    return searchable.includes(query);
  });
  return sortTrackedTasks(filtered, { active: state.active, now: Date.now() });
}

function statusLabel(task) {
  const visualStatus = taskVisualStatus(task);
  return visualStatus === 'open' ? 'Open' : visualStatus === 'merged' ? 'Merged' : visualStatus === 'closed' ? 'Closed'
    : visualStatus === 'completed' ? 'Completed' : visualStatus === 'not-planned' ? 'Not planned' : 'Status unavailable';
}

function makeTimerButton(task) {
  const active = sameIssue(state.active?.issue, task.issue), button = document.createElement('button');
  button.type = 'button'; button.className = `timer-button${active ? ' stop' : ''}`;
  button.textContent = active ? `Stop: ${formatDuration(currentElapsedSeconds(), { current: true })}` : 'Start';
  button.disabled = Boolean(state.busyUrl || (!active && (state.active || state.pendingWrites.length)));
  button.addEventListener('click', async () => {
    if (button.disabled) return;
    state.busyUrl = task.issue.url; setError(); render();
    try {
      if (active) {
        const elapsed = currentElapsedSeconds();
        if (elapsed > 12 * 3600 && !confirm(`This entry is ${Math.floor(elapsed / 3600)} hours long. Save anyway?`)) return;
        const result = await send({ type: 'STOP' });
        task.totalSeconds += Math.max(0, Number(result?.entry?.durationSeconds) || elapsed);
        task.activeStartedAt = null; state.active = null;
        if (result?.pending) state.pendingWrites = [{ id: result.entry?.id || 'pending', status: 'pending' }];
      } else {
        state.active = await send({ type: 'START', issue: task.issue, issueTitle: task.title });
        task.activeStartedAt = state.active.startedAt;
      }
    } catch (error) { setError(error); }
    finally { state.busyUrl = ''; render(); }
  });
  return button;
}

function render() {
  clearInterval(tick); tick = null;
  const tasks = visibleTasks(), list = $('task-list'); list.replaceChildren();
  $('result-count').textContent = `${tasks.length} ${tasks.length === 1 ? 'result' : 'results'}`;
  $('empty').hidden = tasks.length > 0;
  for (const task of tasks) {
    const row = document.createElement('article'); row.className = 'task-row'; row.dataset.taskUrl = task.issue.url;
    const main = document.createElement('div'); main.className = 'task-main'; main.append(taskIcon(task));
    const copy = document.createElement('div'); copy.className = 'task-copy';
    const title = document.createElement('a'); title.className = 'task-title'; title.href = task.issue.url; title.target = '_blank'; title.rel = 'noreferrer'; title.textContent = task.title;
    const subline = document.createElement('div'); subline.className = 'task-subline';
    const status = document.createElement('span'); status.className = `status ${taskVisualStatus(task)}`; status.textContent = statusLabel(task); subline.append(status);
    copy.append(title, subline); main.append(copy);
    const actions = document.createElement('div'); actions.className = 'task-actions';
    const total = document.createElement('span'); total.className = 'tracked-time'; total.textContent = `${formatDuration(taskTotalSeconds(task))} tracked`;
    actions.append(total, makeTimerButton(task)); row.append(main, actions); list.append(row);
  }
  if (state.active) tick = setInterval(() => {
    const expectedOrder = visibleTasks().map(task => task.issue.url);
    const renderedOrder = [...list.children].map(row => row.dataset.taskUrl);
    if (expectedOrder.some((url, index) => renderedOrder[index] !== url)) { render(); return; }
    const activeButton = document.querySelector('.timer-button.stop');
    if (activeButton) activeButton.textContent = `Stop: ${formatDuration(currentElapsedSeconds(), { current: true })}`;
    const activeRow = [...list.children].find(row => row.dataset.taskUrl === state.active.issue.url);
    const activeTask = state.tasks.find(task => sameIssue(task.issue, state.active.issue));
    const total = activeRow?.querySelector('.tracked-time');
    if (total && activeTask) total.textContent = `${formatDuration(taskTotalSeconds(activeTask))} tracked`;
  }, 1000);
}

async function load() {
  const requestId = ++state.requestId, range = taskPeriodRange($('period').value, localDateValue()); state.range = range;
  setError(); $('loading').hidden = false; $('setup').hidden = true; $('tasks-content').hidden = true;
  try {
    const result = await send({ type: 'LOAD_TASKS', payload: range });
    if (requestId !== state.requestId) return;
    state.configured = Boolean(result.configured);
    if (!state.configured) { $('setup').hidden = false; $('source').textContent = 'No time-data repository configured'; return; }
    state.tasks = result.tasks ?? []; state.active = result.active ?? null; state.pendingWrites = result.pendingWrites ?? [];
    $('source').textContent = `${result.sourceRepository} · ${result.branch} · ${range.startDate} to ${range.endDate}`;
    $('tasks-content').hidden = false; render();
  } catch (error) { if (requestId === state.requestId) setError(error); }
  finally { if (requestId === state.requestId) $('loading').hidden = true; }
}

$('task-filter').addEventListener('input', render);
$('status').addEventListener('change', render);
$('period').addEventListener('change', () => {
  try { localStorage.setItem(PERIOD_KEY, $('period').value); } catch { /* unavailable storage falls back to this tab */ }
  void load();
});
$('setup-settings').addEventListener('click', () => send({ type: 'OPEN_OPTIONS' }));

let savedPeriod = 'two-weeks';
try {
  savedPeriod = localStorage.getItem(PERIOD_KEY) || localStorage.getItem(LEGACY_PERIOD_KEY) || savedPeriod;
  if (!localStorage.getItem(PERIOD_KEY) && savedPeriod) localStorage.setItem(PERIOD_KEY, savedPeriod);
} catch { /* use default */ }
$('period').value = PERIODS.has(savedPeriod) ? savedPeriod : 'two-weeks';
void load();
