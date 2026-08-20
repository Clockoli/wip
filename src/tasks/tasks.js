import { effectiveTrackedSeconds, sortTrackedTasks, taskPeriodRange } from '../domain/tasks.js';

const PERIOD_KEY = 'github-private-time-tracker.tasks.period';
const PERIODS = new Set(['two-weeks', 'one-month', 'three-months', 'six-months', 'one-year']);
const ISSUE_PATH = 'M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0Zm0 14.5A6.5 6.5 0 1 1 8 1.5a6.5 6.5 0 0 1 0 13Zm0-5.25a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5ZM8.75 4a.75.75 0 0 0-1.5 0v3a.75.75 0 0 0 1.5 0V4Z';
const PULL_PATH = 'M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.251 2.251 0 0 1 1.5 3.25Zm10.677-.177L9.573.47A.75.75 0 0 0 8.293 1v1.75H7.75a.75.75 0 0 0 0 1.5h.543V6A3.75 3.75 0 0 0 12 9.75h.5a.75.75 0 0 0 0-1.5H12A2.25 2.25 0 0 1 9.793 6V4.25h1.793a.75.75 0 0 0 .53-1.28l.061.103ZM12.5 10.5a2.25 2.25 0 1 1 0 4.5 2.25 2.25 0 0 1 0-4.5Z';
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
  $('error').textContent = error?.message || String(error || '');
  $('error').hidden = !$('error').textContent;
}

function taskIcon(type) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16'); svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', `task-icon ${type === 'pull_request' ? 'pull-request' : 'issue'}`);
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', type === 'pull_request' ? PULL_PATH : ISSUE_PATH); svg.append(path); return svg;
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

function statusLabel(status) {
  return status === 'OPEN' ? 'Open' : status === 'MERGED' ? 'Merged' : status === 'CLOSED' ? 'Closed' : 'Status unavailable';
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
    const main = document.createElement('div'); main.className = 'task-main'; main.append(taskIcon(task.issue.type));
    const copy = document.createElement('div'); copy.className = 'task-copy';
    const title = document.createElement('a'); title.className = 'task-title'; title.href = task.issue.url; title.target = '_blank'; title.rel = 'noreferrer'; title.textContent = task.title;
    const subline = document.createElement('div'); subline.className = 'task-subline';
    const status = document.createElement('span'); status.className = `status ${task.status.toLowerCase()}`; status.textContent = statusLabel(task.status); subline.append(status);
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
$('settings').addEventListener('click', () => send({ type: 'OPEN_OPTIONS' }));
$('setup-settings').addEventListener('click', () => send({ type: 'OPEN_OPTIONS' }));

let savedPeriod = 'two-weeks';
try { savedPeriod = localStorage.getItem(PERIOD_KEY) || savedPeriod; } catch { /* use default */ }
$('period').value = PERIODS.has(savedPeriod) ? savedPeriod : 'two-weeks';
void load();
