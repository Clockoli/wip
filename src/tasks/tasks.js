import { mountRunningStatus } from '../ui/running-status.js';
import { mountAddTime } from '../ui/add-time.js';
import { effectiveTrackedSeconds, sortTrackedTasks, taskPeriodRange } from '../domain/tasks.js';
import { formatClockDuration } from '../domain/reporting.js';

const PERIOD_KEY = 'clockoli.tasks.period';
const SECOND_MS = 1_000;
const PERIODS = new Set(['two-weeks', 'one-month', 'three-months', 'six-months', 'one-year']);
const ISSUE_OPEN_PATH = 'M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z';
const PULL_OPEN_PATH = 'M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z';
const TASK_COLORS = ['#e76f51','#2a9d8f','#b8860b','#5f8f52','#d66b2c','#477ca8','#8f4fc7','#d94c78','#27866a','#c76f0a','#659344','#4c6f8c','#d52f33','#0087a3','#806b99','#b88400','#2886a8','#914657','#55766e','#c95e43'];
const $ = id => document.getElementById(id);
const state = { tasks: [], active: null, pendingWrites: [], configured: false, requestId: 0, busyUrl: '', loading: false, range: null, partial: false };
let tick = null;
let pendingRefresh = null;
let pendingRender = false;
let filterFocused = false;

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

function taskColor(value) {
  let hash = 2166136261;
  for (const char of taskUrlOf(value)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return TASK_COLORS[(hash >>> 0) % TASK_COLORS.length];
}


function formatDuration(seconds, { current = false } = {}) {
  if (current && seconds < 60) return `${Math.floor(seconds)}s`;
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
  if (!task.issue) {
    if (!/^https?:\/\//.test(taskUrlOf(task))) {
      const icon = document.createElement('span');
      icon.className = 'task-icon task-clockoli-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.style.maskImage = `url("${chrome.runtime.getURL('src/assets/clockoli-inverse-circle.svg')}")`;
      return icon;
    }
    const image = document.createElement('img');
    image.className = 'task-icon task-favicon'; image.alt = ''; image.width = 16; image.height = 16; image.referrerPolicy = 'no-referrer';
    try {
      if (!chrome.runtime.getManifest().permissions.includes('favicon')) {
        const monogram = document.createElement('span');
        monogram.className = 'task-icon task-favicon task-monogram';
        monogram.textContent = new URL(taskUrlOf(task)).hostname.replace(/^www\./, '').charAt(0).toUpperCase();
        monogram.setAttribute('aria-hidden', 'true');
        return monogram;
      }
      const favicon = new URL(chrome.runtime.getURL('/_favicon/'));
      favicon.searchParams.set('pageUrl', taskUrlOf(task)); favicon.searchParams.set('size', '32'); image.setAttribute('src', favicon.href);
    } catch { image.hidden = true; }
    image.addEventListener('error', () => { image.hidden = true; }, { once: true });
    return image;
  }
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
  button.disabled = Boolean(state.busyUrl || state.pendingWrites.some(item => item.status === 'conflict'));
  button.addEventListener('click', async () => {
    if (button.disabled) return;
    task = state.tasks.find(item => item.taskUrl === task.taskUrl);
    if (!task) return;
    const active = sameTask(state.active, task);
    const restoreFocus = document.activeElement === button;
    const activeBeforeAction = state.active;
    state.busyUrl = task.taskUrl; setError(); render();
    try {
      if (active) {
        const elapsed = currentElapsedSeconds();
        if (elapsed > 12 * 3600 && !confirm(`This entry is ${Math.floor(elapsed / 3600)} hours long. Save anyway?`)) return;
        const result = await send({ type: 'STOP' });
        task.totalSeconds += Math.max(0, Number(result?.entry?.durationSeconds) || elapsed);
        task.activeStartedAt = null; state.active = null;
        if (result?.pending) state.pendingWrites.push({ id: result.entry?.id || 'pending', status: 'pending' });
      } else {
        if (state.active) {
          const elapsed = currentElapsedSeconds(), previous = state.tasks.find(item => sameTask(item, state.active));
          if (elapsed > 12 * 3600 && !confirm(`The current entry is ${Math.floor(elapsed / 3600)} hours long. Save it and start this task?`)) return;
          const result = await send({ type: 'SWITCH_TASK', taskUrl: task.taskUrl, taskTitle: task.title });
          if (previous) { previous.totalSeconds += Math.max(0, Number(result?.stopped?.entry?.durationSeconds) || elapsed); previous.activeStartedAt = null; }
          state.active = result.active;
          if (result.pending) state.pendingWrites.push({ id: result.stopped?.entry?.id || 'switch-pending', status: 'pending', stage: 'verifyActive' });
        } else {
          state.active = await send({ type: 'START', taskUrl: task.taskUrl, taskTitle: task.title });
          if (state.active?._pending) state.pendingWrites.push({ id: 'start-pending', status: 'pending', stage: 'startNext' });
        }
        task.activeStartedAt = state.active.startedAt;
      }
    } catch (error) {
      await reconcileTaskState(activeBeforeAction).catch(() => {});
      setError(error);
    } finally {
      state.busyUrl = '';
      if (restoreFocus && document.activeElement === document.body) {
        button.disabled = false; button.focus({ preventScroll: true });
      }
      render();
    }
  });
  return button;
}

function hasRunnablePending(queue = state.pendingWrites) {
  const first = queue?.[0];
  if (!first) return false;
  if (first.status !== 'conflict') return true;
  const operation = first.operation ?? first.stage;
  const retryableConflict = !String(first.conflictReason || '').startsWith('queued_write_');
  return retryableConflict && ['editEntry', 'editEntries'].includes(operation)
    && first.conflictReason !== 'queued_entry_missing';
}

function updateRefreshControl() {
  const busy = state.loading;
  const refresh = $('refresh-tasks');
  refresh.disabled = busy;
  refresh.classList.toggle('syncing', state.loading); // Pending background writes do not animate.
}

function isInteracting() {
  return Boolean(state.busyUrl) || [...$('task-list').children].some(row => row.matches(':hover') || row.contains(document.activeElement));
}

function reconcileList() {
  // Focus and pointer events may be moving between two controls in the list.
  queueMicrotask(() => { if (pendingRender && !isInteracting()) render(); });
}

function updateRows() {
  for (const row of $('task-list').children) {
    const task = state.tasks.find(item => item.taskUrl === row.dataset.taskUrl);
    const button = row.querySelector('.timer-button'), active = sameTask(state.active, task);
    row.classList.toggle('running', active);
    button.classList.toggle('stop', active);
    button.textContent = active ? `Stop: ${formatDuration(currentElapsedSeconds(), { current: true })}` : 'Start';
    button.disabled = Boolean(!task || state.busyUrl || state.pendingWrites.some(item => item.status === 'conflict'));
    if (task) row.querySelector('.tracked-time').textContent = formatClockDuration(taskTotalSeconds(task));
  }
}

function render({ force = false } = {}) {
  clearInterval(tick); tick = null;
  const tasks = visibleTasks(), list = $('task-list');
  $('task-controls').hidden = !state.configured;
  $('tasks-content').hidden = !state.configured; $('setup').hidden = state.configured;
  updateRefreshControl();
  if (!force && isInteracting()) {
    pendingRender = true;
  } else {
    pendingRender = false;
    rebuildList(tasks);
  }
  updateRows();
  if (state.active) tick = setInterval(() => {
    const expectedOrder = visibleTasks().map(task => task.taskUrl);
    const renderedOrder = [...list.children].map(row => row.dataset.taskUrl);
    if (expectedOrder.length !== renderedOrder.length || expectedOrder.some((url, index) => renderedOrder[index] !== url)) { render(); return; }
    updateRows();
  }, SECOND_MS);
  schedulePendingRefresh();
}

function rebuildList(tasks) {
  const list = $('task-list'), focused = document.activeElement;
  const focusedRow = focused?.closest('.task-row');
  const focusUrl = focusedRow?.dataset.taskUrl;
  const focusSelector = focused?.classList.contains('timer-button') ? '.timer-button'
    : focused?.classList.contains('task-title') ? '.task-title' : '.task-url';
  const scroller = document.scrollingElement;
  const scrollTop = scroller.scrollTop, scrollLeft = scroller.scrollLeft;
  const listTop = list.scrollTop, listLeft = list.scrollLeft;
  list.replaceChildren();
  $('result-count').textContent = `${tasks.length} ${tasks.length === 1 ? 'result' : 'results'}`;
  $('empty').hidden = tasks.length > 0;
  const filtered = Boolean($('task-filter').value.trim());
  $('empty-message').textContent = filtered ? 'No tasks match.' : 'Nothing tracked yet. Open a task page and click Clockoli to start.';
  $('clear-filter').hidden = !filtered;
  for (const task of tasks) {
    const row = document.createElement('article'); row.className = 'task-row'; row.dataset.taskUrl = task.taskUrl;
    row.setAttribute('style', `--task-color:${taskColor(task)}`);
    row.addEventListener('pointerleave', reconcileList);
    const main = document.createElement('div'); main.className = 'task-main';
    const taskIdentityIcon = taskIcon(task); taskIdentityIcon.style.color = taskIdentityIcon.classList.contains('task-monogram') ? 'var(--fgColor-default)' : taskColor(task); main.append(taskIdentityIcon);
    const copy = document.createElement('div'); copy.className = `task-copy${task.title ? '' : ' untitled'}`;
    const navigable = /^https?:\/\//.test(task.taskUrl);
    const url = document.createElement(!task.title && navigable ? 'a' : 'div'); url.className = 'task-url'; url.title = task.taskUrl; url.textContent = task.taskUrl;
    if (!task.title && navigable) { url.href = task.taskUrl; url.target = '_blank'; url.rel = 'noreferrer'; }
    if (task.title) {
      const title = document.createElement(navigable ? 'a' : 'span'); title.className = 'task-title';
      if (navigable) { title.href = task.taskUrl; title.target = '_blank'; title.rel = 'noreferrer'; }
      title.textContent = task.title; title.title = task.title; title.setAttribute('style', `color:${taskColor(task)}`); copy.append(title);
    }
    copy.append(url);
    main.append(copy);
    const actions = document.createElement('div'); actions.className = 'task-actions';
    const total = document.createElement('span'); total.className = 'tracked-time'; total.setAttribute('aria-label', 'Accumulated time');
    actions.append(total, makeTimerButton(task)); row.append(main, actions); list.append(row);
  }
  if (focusUrl) {
    const replacement = [...list.children].find(row => row.dataset.taskUrl === focusUrl)?.querySelector(focusSelector);
    (replacement || $('task-filter')).focus({ preventScroll: true });
  }
  scroller.scrollTop = scrollTop; scroller.scrollLeft = scrollLeft;
  list.scrollTop = listTop; list.scrollLeft = listLeft;
}

function schedulePendingRefresh() {
  clearTimeout(pendingRefresh); pendingRefresh = null;
  if (!hasRunnablePending()) return;
  pendingRefresh = setTimeout(async () => {
    try {
      const hadPending = hasRunnablePending();
      const result = await send({ type: 'GET_PAGE_STATE' });
      state.configured = Boolean(result.configured); state.active = result.active ?? null;
      state.pendingWrites = result.pendingWrites ?? [];
      if (hadPending && !hasRunnablePending()) await load();
      else render();
    } catch (error) { setError(error); schedulePendingRefresh(); }
  }, 500);
}

async function reconcileTaskState(previousActive) {
  const result = await send({ type: 'GET_PAGE_STATE' });
  state.configured = Boolean(result.configured);
  state.active = result.active ?? null; state.pendingWrites = result.pendingWrites ?? [];
  const previous = state.tasks.find(item => sameTask(item, previousActive));
  if (!previous || sameTask(state.active, previousActive)) return;
  const completion = (result.recent ?? []).find(entry => sameTask(entry, previousActive) && entry.startedAt === previousActive?.startedAt);
  if (completion) previous.totalSeconds += Math.max(0, Number(completion.durationSeconds) || 0);
  previous.activeStartedAt = null;
}

async function load() {
  const requestId = ++state.requestId, range = taskPeriodRange($('period').value, localDateValue()); state.range = range;
  const keepResults = state.configured && !$('tasks-content').hidden;
  state.loading = true; setError(); $('loading').hidden = keepResults; $('setup').hidden = true; updateRefreshControl();
  try {
    const result = await send({ type: 'LOAD_TASKS', payload: range });
    if (requestId !== state.requestId) return;
    state.configured = Boolean(result.configured);
    if (!state.configured) {
      state.tasks = []; state.active = null; state.pendingWrites = [];
      render({ force: true }); return;
    }
    state.tasks = result.tasks ?? []; state.active = result.active ?? null; state.pendingWrites = result.pendingWrites ?? []; state.partial = Boolean(result.partial);
    const failed = (result.readStatus || []).filter(item => item.status === 'error').length;
    const conflictCount = result.conflicts?.length || 0;
    $('partial-status').hidden = !state.partial;
    $('partial-status').textContent = !state.partial ? '' : [
      failed ? `${failed} time ${failed === 1 ? 'repository' : 'repositories'} could not be loaded.` : '',
      conflictCount ? `${conflictCount} conflicting ${conflictCount === 1 ? 'record was' : 'records were'} omitted.` : '',
      'Showing available tracked work.',
    ].filter(Boolean).join(' ');
    $('tasks-content').hidden = false; render();
    if (!filterFocused) {
      filterFocused = true;
      if (document.activeElement === document.body) $('task-filter').focus({ preventScroll: true });
    }
  } catch (error) { if (requestId === state.requestId) setError(error); }
  finally {
    if (requestId === state.requestId) { state.loading = false; $('loading').hidden = true; updateRefreshControl(); }
  }
}

$('refresh-tasks').addEventListener('click', async () => {
  const button = $('refresh-tasks'); button.disabled = true; setError();
  try { await load(); }
  catch (error) { setError(error); }
  finally { button.disabled = state.loading; }
});
$('task-list').addEventListener('focusout', reconcileList);
$('task-filter').addEventListener('input', () => render({ force: true }));
function clearFilter() {
  $('task-filter').value = ''; $('task-filter').focus({ preventScroll: true }); render({ force: true });
}
$('clear-filter').addEventListener('click', clearFilter);
$('task-filter').addEventListener('keydown', event => {
  if (!state.configured || event.isComposing) return;
  if (event.key === 'Escape') { event.preventDefault(); clearFilter(); }
  if (event.key !== 'Enter' || event.repeat) return;
  const tasks = visibleTasks();
  const rows = [...$('task-list').children];
  if (tasks.length !== 1 || rows.length !== 1 || rows[0].dataset.taskUrl !== tasks[0].taskUrl || sameTask(state.active, tasks[0])) return;
  event.preventDefault();
  $('task-list').querySelector('.timer-button')?.click();
});
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

mountRunningStatus($('running-status'), { send, onChange: load });
mountAddTime($('add-time-button'), { send, onAdded: load });
