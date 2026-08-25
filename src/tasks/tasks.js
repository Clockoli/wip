import { effectiveTrackedSeconds, sortTrackedTasks, taskPeriodRange } from '../domain/tasks.js';

const PERIOD_KEY = 'clockoli.tasks.period';
const PERIODS = new Set(['two-weeks', 'one-month', 'three-months', 'six-months', 'one-year']);
const ISSUE_OPEN_PATH = 'M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z';
const PULL_OPEN_PATH = 'M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z';
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

function taskUrlOf(value) { return value?.taskUrl || value?.issue?.url || ''; }
function sameTask(a, b) { return Boolean(taskUrlOf(a) && taskUrlOf(a) === taskUrlOf(b)); }


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
  const recovery = globalThis.ClockoliRecovery.actionFor(error?.code), label = recovery?.label || '';
  if (label) {
    const action = document.createElement('button'); action.type = 'button'; action.className = 'button secondary'; action.textContent = label;
    action.addEventListener('click', () => { if (recovery.kind === 'retry') void load(); else void send({ type: 'OPEN_OPTIONS' }); });
    root.append(document.createTextNode(' '), action);
  }
  root.hidden = !text;
}

function taskIcon(task) {
  const type = task.issue?.type || 'url';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16'); svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', `task-icon ${type === 'pull_request' ? 'pull-request' : 'task'}`);
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', type === 'pull_request' ? PULL_OPEN_PATH : ISSUE_OPEN_PATH); svg.append(path); return svg;
}

function visibleTasks() {
  const query = $('task-filter').value.trim().toLowerCase();
  const filtered = state.tasks.filter(task => {
    if (!query) return true;
    const searchable = `${task.title} ${task.taskUrl} ${task.issue ? `${task.issue.owner}/${task.issue.repo} #${task.issue.number} ${task.issue.type}` : ''}`.toLowerCase();
    return searchable.includes(query);
  });
  return sortTrackedTasks(filtered, { active: state.active, now: Date.now() });
}

function taskTotalSeconds(task) {
  return effectiveTrackedSeconds(task, { active: state.active, now: Date.now() });
}

function makeTimerButton(task) {
  const active = sameTask(state.active, task), button = document.createElement('button');
  button.type = 'button'; button.className = `timer-button${active ? ' stop' : ''}`;
  button.textContent = active ? `Stop: ${formatDuration(currentElapsedSeconds(), { current: true })}` : 'Start';
  button.disabled = Boolean(state.busyUrl || (!active && (state.active || state.pendingWrites.length)));
  button.addEventListener('click', async () => {
    if (button.disabled) return;
    state.busyUrl = task.taskUrl; setError(); render();
    try {
      if (active) {
        const elapsed = currentElapsedSeconds();
        if (elapsed > 12 * 3600 && !confirm(`This entry is ${Math.floor(elapsed / 3600)} hours long. Save anyway?`)) return;
        const result = await send({ type: 'STOP' });
        task.totalSeconds += Math.max(0, Number(result?.entry?.durationSeconds) || elapsed);
        task.activeStartedAt = null; state.active = null;
        if (result?.pending) state.pendingWrites = [{ id: result.entry?.id || 'pending', status: 'pending' }];
      } else {
        state.active = await send({ type: 'START', taskUrl: task.taskUrl, taskTitle: task.title });
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
    const row = document.createElement('article'); row.className = 'task-row'; row.dataset.taskUrl = task.taskUrl;
    const main = document.createElement('div'); main.className = 'task-main'; main.append(taskIcon(task));
    const copy = document.createElement('div'); copy.className = `task-copy${task.title ? '' : ' untitled'}`;
    const url = document.createElement(task.title ? 'div' : 'a'); url.className = 'task-url'; url.title = task.taskUrl; url.textContent = task.taskUrl;
    if (!task.title) { url.href = task.taskUrl; url.target = '_blank'; url.rel = 'noreferrer'; }
    copy.append(url);
    if (task.title) {
      const title = document.createElement('a'); title.className = 'task-title'; title.href = task.taskUrl; title.target = '_blank'; title.rel = 'noreferrer'; title.textContent = task.title; title.title = task.title; copy.append(title);
    }
    main.append(copy);
    const actions = document.createElement('div'); actions.className = 'task-actions';
    const total = document.createElement('span'); total.className = 'tracked-time'; total.textContent = `${formatDuration(taskTotalSeconds(task))} tracked`;
    actions.append(total, makeTimerButton(task)); row.append(main, actions); list.append(row);
  }
  if (state.active) tick = setInterval(() => {
    const expectedOrder = visibleTasks().map(task => task.taskUrl);
    const renderedOrder = [...list.children].map(row => row.dataset.taskUrl);
    if (expectedOrder.some((url, index) => renderedOrder[index] !== url)) { render(); return; }
    const activeButton = document.querySelector('.timer-button.stop');
    if (activeButton) activeButton.textContent = `Stop: ${formatDuration(currentElapsedSeconds(), { current: true })}`;
    const activeRow = [...list.children].find(row => row.dataset.taskUrl === taskUrlOf(state.active));
    const activeTask = state.tasks.find(task => sameTask(task, state.active));
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
    if (!state.configured) { $('setup').hidden = false; return; }
    state.tasks = result.tasks ?? []; state.active = result.active ?? null; state.pendingWrites = result.pendingWrites ?? [];
    $('tasks-content').hidden = false; render();
  } catch (error) { if (requestId === state.requestId) setError(error); }
  finally { if (requestId === state.requestId) $('loading').hidden = true; }
}

$('task-filter').addEventListener('input', render);
$('period').addEventListener('change', () => {
  try { localStorage.setItem(PERIOD_KEY, $('period').value); } catch { /* unavailable storage falls back to this tab */ }
  void load();
});
$('setup-settings').addEventListener('click', () => send({ type: 'OPEN_OPTIONS' }));

let savedPeriod = 'two-weeks';
try {
  savedPeriod = localStorage.getItem(PERIOD_KEY) || savedPeriod;
} catch { /* use default */ }
$('period').value = PERIODS.has(savedPeriod) ? savedPeriod : 'two-weeks';
void load();
