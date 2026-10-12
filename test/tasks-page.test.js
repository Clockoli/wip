import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { effectiveTrackedSeconds, sortTrackedTasks, taskPeriodRange } from '../src/domain/tasks.js';
import { formatClockDuration } from '../src/domain/reporting.js';
import { normalizeTaskUrl, localDateParts, entryDateValue } from '../src/domain/values.js';

const html = fs.readFileSync(new URL('../src/tasks/tasks.html', import.meta.url), 'utf8');
const js = fs.readFileSync(new URL('../src/tasks/tasks.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/tasks/tasks.css', import.meta.url), 'utf8');
const worker = fs.readFileSync(new URL('../src/background/service-worker.js', import.meta.url), 'utf8');
const content = fs.readFileSync(new URL('../src/content/github.js', import.meta.url), 'utf8');
const manifest = fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8');
const popup = fs.readFileSync(new URL('../src/popup/popup.html', import.meta.url), 'utf8');

test('tasks page is a recent tracked-work list without GitHub issue-list clutter', () => {
  assert.match(html, /<title>Top tasks · Clockoli<\/title>/);
  assert.doesNotMatch(html, /<h1>|class="app-header"|class="brand-logo"/);
  assert.doesNotMatch(html, /id="source"/);
  assert.doesNotMatch(js, /result\.sourceRepository|result\.branch/);
  assert.doesNotMatch(html, /class="eyebrow"/);
  for (const id of ['period', 'task-filter', 'result-count', 'task-list']) assert.match(html, new RegExp(`id="${id}"`));
  for (const value of ['two-weeks', 'one-month', 'three-months', 'six-months', 'one-year']) assert.match(html, new RegExp(`value="${value}"`));
  assert.doesNotMatch(html, /id="status"|<label>Status/i);
  assert.doesNotMatch(html, /magnif|octicon-search|pagination|Sort|Assigned to me/i);
  assert.doesNotMatch(html, /labels|comments|assignee/i);
  assert.doesNotMatch(html, /id="settings"/);
  assert.match(js, /const PERIOD_KEY = 'clockoli\.tasks\.period'/);
  assert.doesNotMatch(js, /LEGACY_PERIOD_KEY/);
  assert.match(js, /localStorage\.getItem\(PERIOD_KEY\)/);
  assert.match(js, /savedPeriod = localStorage\.getItem\(PERIOD_KEY\) \|\| savedPeriod/);
  assert.match(js, /localStorage\.setItem\(PERIOD_KEY/);
  assert.match(js, /addEventListener\('input'/);
  assert.match(js, /type:\s*'LOAD_TASKS'/);
  assert.match(js, /type:\s*'START'/);
  assert.match(js, /type:\s*'STOP'/);
  assert.match(js, /type:\s*'SWITCH_TASK'/);
  assert.doesNotMatch(js, /!active && \(state\.active \|\| state\.pendingWrites\.length\)/,
    'Start remains available while a different task is active');
  assert.doesNotMatch(js, /innerHTML|outerHTML|eval\s*\(|new Function/);
  assert.match(css, /\.task-row/);
  assert.match(js, /className = 'task-url'/);
  assert.match(js, /className = 'task-title'/);
  assert.match(css, /\.task-url\{[^}]*text-overflow:ellipsis[^}]*white-space:nowrap/);
  assert.match(css, /\.task-title\{[^}]*color:var\(--fgColor-accent\)/);
  assert.match(css, /\.task-copy\.untitled \.task-url\{[^}]*overflow:hidden[^}]*text-overflow:ellipsis[^}]*white-space:nowrap/,
    'an untitled maximum-length URL remains a single clamped primary link');
  assert.match(js, /url\.title = task\.taskUrl/,
    'the full untitled URL remains available without expanding the row');
  assert.match(css, /\.task-title\{[^}]*-webkit-line-clamp:2/,
    'maximum-length task titles are limited to two result lines');
  assert.match(css, /\.task-copy:not\(\.untitled\) \.task-url\{[^}]*margin-top:4px/,
    'a titled task keeps its muted URL visually separate from the title');
  assert.match(js, /title\.title = task\.title/,
    'the full clamped task title remains available without expanding the row');
  assert.doesNotMatch(js, /Saved in|task-repositories/);
});

test('Settings exposes two filtered task lists, people selection, and a queued atomic merge list', () => {
  const optionsHtml = fs.readFileSync(new URL('../src/options/options.html', import.meta.url), 'utf8');
  const optionsJs = fs.readFileSync(new URL('../src/options/options.js', import.meta.url), 'utf8');
  assert.match(optionsHtml, /id="merge-tasks"[\s\S]*<h2[^>]*>Merge tasks<\/h2>/);
  assert.match(optionsHtml, /id="merge-task-period"[\s\S]*one-month[\s\S]*three-months[\s\S]*all-time/);
  assert.match(optionsHtml, /id="merge-task-period"[\s\S]*id="merge-task-destination"[\s\S]*id="merge-people-select"/);
  assert.match(optionsHtml, /<details id="merge-people-select"/);
  assert.match(optionsHtml, /<summary[^>]*>[\s\S]*id="merge-people-filter"[^>]*type="search"/);
  assert.match(optionsHtml, /id="merge-people-all"[^>]*>All people<\/button>[\s\S]*<\/summary>/);
  assert.doesNotMatch(optionsHtml, /id="merge-people-summary"/);
  assert.doesNotMatch(optionsHtml, /id="merge-people-none"/);
  assert.match(optionsHtml, /id="merge-source-filter"/); assert.match(optionsHtml, /id="merge-source-list"/);
  assert.match(optionsHtml, /class="merge-task-arrow"[^>]*>→<\/span>/);
  assert.match(optionsHtml, /id="merge-target-filter"/); assert.match(optionsHtml, /id="merge-target-list"/);
  assert.match(optionsHtml, /id="merge-queue-list"/); assert.match(optionsHtml, /id="merge-tasks-submit"[^>]*>Merge<\/button>/);
  assert.match(optionsHtml, /class="actions merge-task-actions"/);
  assert.match(optionsJs, /taskPeriodRange\(\$\('merge-task-period'\)\.value/);
  assert.match(optionsJs, /includeAllUsers: true/);
  assert.match(optionsJs, /mergePairs\.push/);
  assert.match(optionsJs, /allSelected \? mergePeople\.clear\(\) : mergeAvailableUsers\.forEach/);
  assert.match(optionsJs, /type:\s*'MERGE_TASKS'/);
  assert.match(optionsJs, /pairs = mergePairs\.map/);
  assert.match(optionsJs, /destinationIds:\s*\[\$\('merge-task-destination'\)\.value\]/);
  assert.match(optionsJs, /remove\.textContent = '✕'/);
  assert.match(optionsJs, /className = 'merge-queue-task-url'/);
  assert.doesNotMatch(optionsJs, /mergeTaskDuration|merge-task-total/);
  assert.match(optionsJs, /className = 'merge-task-title'/);
  assert.match(optionsJs, /focusedUser = document\.activeElement\?\.type === 'checkbox'/);
  assert.match(optionsJs, /focused\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(optionsJs, /function setMergePeopleOpen\(open\)[\s\S]*aria-expanded'[\s\S]*String\(open\)/);
  assert.match(optionsJs, /\$\('merge-people-filter'\)\.addEventListener\('focus',[\s\S]*setMergePeopleOpen\(true\)/);
  assert.match(optionsJs, /mergePeopleSelect\.addEventListener\('keydown',[\s\S]*event\.key !== 'Escape'[\s\S]*merge-people-filter'\)\.focus\(\{ preventScroll: true \}\)[\s\S]*setMergePeopleOpen\(false\)/);
  assert.match(optionsJs, /document\.addEventListener\('pointerdown',[\s\S]*!mergePeopleSelect\.contains\(event\.target\)[\s\S]*setMergePeopleOpen\(false\)/);
  assert.match(optionsJs, /document\.addEventListener\('focusin',[\s\S]*!mergePeopleSelect\.contains\(event\.target\)[\s\S]*setMergePeopleOpen\(false\)/);
  assert.match(optionsJs, /merge-people-filter'\)\.addEventListener\('click',[\s\S]*setMergePeopleOpen\(true\)/);
  assert.match(optionsJs, /event\.stopPropagation\(\)/);
});

test('failed task switches reconcile from local tracker state without reloading reports', () => {
  assert.match(js, /async function reconcileTaskState\(previousActive\)/);
  assert.match(js, /send\(\{ type: 'GET_PAGE_STATE' \}\)/);
  assert.match(js, /catch \(error\) \{\s*await reconcileTaskState\(activeBeforeAction\)\.catch/);
  assert.doesNotMatch(js, /reconcileTaskState[\s\S]{0,300}type: 'LOAD_TASKS'/);
  assert.match(js, /state\.active = result\.active \?\? null; state\.pendingWrites = result\.pendingWrites \?\? \[\]/);
});

test('visible extension branding is Clockoli and Tasks uses neutral GitHub buttons', () => {
  assert.match(manifest, /"name":\s*"Clockoli"/);
  assert.match(manifest, /"default_title":\s*"Clockoli"/);
  assert.doesNotMatch(content, /heading\.append\(el\('strong', 'Clockoli'\)/);
  assert.match(content, /const ROOT_ID = 'clockoli-root'/);
  assert.match(css, /\.timer-button\{[^}]*border:1px solid var\(--button-default-borderColor-rest\)[^}]*background:var\(--button-default-bgColor-rest\)[^}]*color:var\(--button-default-fgColor-rest\)/);
  assert.match(css, /\.timer-button:hover\{[^}]*background:var\(--button-default-bgColor-hover\)/);
  assert.doesNotMatch(css, /\.timer-button\{[^}]*button-primary/);
  assert.doesNotMatch(html, /class="button primary"/);
  assert.doesNotMatch(css, /\.button\.primary/);
  assert.doesNotMatch(js, /task\.status|statusMatches|statusLabel/);
});

test('standalone selects use an inset custom caret while the GitHub header caret remains untouched', () => {
  const reportsCss = fs.readFileSync(new URL('../src/reports/reports.css', import.meta.url), 'utf8');
  for (const pageCss of [css, reportsCss]) {
    assert.match(pageCss, /select\{[^}]*appearance:none[^}]*padding-right:32px[^}]*background-position:right 12px center/);
  }
  assert.doesNotMatch(content, /trigger-menu[^}]*translateX/);
});

test('GitHub header icon opens the browser action panel without a dropdown', () => {
  assert.match(content, /trigger-main/);
  assert.doesNotMatch(content, /trigger-menu|navigation-menu|renderNavigationMenu/);
  const start = content.indexOf("main.addEventListener('click'");
  const click = content.slice(start, content.indexOf('shadow.append(style, main)', start));
  assert.match(click, /toggleFullWidthPopup\(\)/);
  assert.doesNotMatch(click, /menuOpen = !menuOpen|renderMenu\(/);
  const full = content.slice(content.indexOf('function renderFullWidthPopup'), content.indexOf('async function toggleFullWidthPopup'));
  assert.match(full, /renderMenu\(\{ compact: true, onClose: closeFullWidthPopup \}\)/);
});


test('Top tasks exposes the same sync and refresh action as the tracking panel', () => {
  assert.match(html, /id="refresh-tasks"[^>]*aria-label="Sync and refresh"/);
  const panelSyncPath = content.match(/const SYNC_PATH = '([^']+)'/)?.[1];
  assert.ok(panelSyncPath);
  assert.match(html, new RegExp(`<path d="${panelSyncPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
  assert.match(js, /refresh-tasks'\)\.addEventListener[\s\S]*type: 'SYNC'[\s\S]*await load\(\)/);
});


test('background timer sync never blocks timer actions and drives a disabled spinning refresh icon', () => {
  assert.match(worker, /tracker\.switchTask\([\s\S]*\{ background: true \}/);
  assert.match(worker, /const acceptanceExecutor = new SerialExecutor\(\)/);
  assert.match(worker, /acceptsLocally[\s\S]*acceptanceExecutor\.run/,
    'timer acceptance must not wait behind the remote synchronization executor');
  assert.match(worker, /acceptsLocally = \[[\s\S]*QUEUE_ENTRY_EDIT[\s\S]*QUEUE_ENTRY_DELETE[\s\S]*QUEUE_ENTRIES_EDIT[\s\S]*QUEUE_ACTIVE_START_EDIT[\s\S]*\]\.includes/,
    'queued timeline edits must be durably accepted without waiting behind remote synchronization');
  assert.match(worker, /scheduleSyncAlarm\('sync-pending-now'/,
    'accepted mutations schedule a durable one-shot alarm that wakes the MV3 worker');
  assert.match(worker, /function requestPendingSync\(\) \{\s*void scheduleSyncAlarm\('sync-pending-now', \{ when: Date\.now\(\) \+ 250 \}\);\s*\}/,
    'accepted mutations wait for the debounce alarm so superseding queue edits can coalesce');
  assert.doesNotMatch(worker, /function requestPendingSync\(\) \{[^}]*syncPendingNow\(\)/);
  assert.doesNotMatch(js, /button\.disabled = Boolean\(state\.busyUrl \|\| state\.pendingWrites\.length\)/);
  assert.match(worker, /const retryableConflict = !String\(first\.conflictReason \|\| ''\)\.startsWith\('queued_write_'\)/);
  assert.match(worker, /retryableConflict && \(\(first\.stage === 'startNext'[\s\S]*?\['editEntry', 'editEntries', 'deleteEntry'\]\.includes\(operation\) && first\.conflictReason !== 'queued_entry_missing'/);
  assert.match(worker, /if \(await shouldContinuePendingSync\(\)\)[\s\S]*sync-pending-now/,
    'MV3 retry alarms must continue for safely rebased entry edits and stop only for a missing record or an unsafe conflict');
  assert.match(js, /const retryableConflict = !String\(first\.conflictReason \|\| ''\)\.startsWith\('queued_write_'\)/);
  assert.match(js, /const busy = state\.loading \|\| hasRunnablePending\(\)/);
  assert.match(js, /hadPending[\s\S]*!hasRunnablePending\(\)[\s\S]*await load\(\)/,
    'pending completion or transition to a blocking conflict must reload task aggregates');
  assert.match(js, /function updateRefreshControl\(\)[\s\S]*state\.loading \|\| hasRunnablePending\(\)[\s\S]*refresh\.disabled = busy/);
  assert.match(css, /\.icon-button\.syncing svg\{[^}]*animation:/);
  assert.match(content, /refresh\.disabled = syncing/);
  assert.match(content, /refresh\.classList\.toggle\('syncing', syncing\)/);
  assert.doesNotMatch(content, /stop\.disabled = pageState\.pendingCount > 0/);
  assert.doesNotMatch(content, /startButton\.disabled = !current \|\| pageState\.pendingCount > 0/);
});

test('Top tasks keeps existing results visible while a spinner-only refresh runs', () => {
  assert.doesNotMatch(html, /Loading tracked tasks from the data repository/);
  assert.match(html, /id="loading"[^>]*aria-label="Loading tracked tasks"[\s\S]*loading-spinner/);
  assert.match(css, /\.loading-spinner[^}]*animation:/);
  assert.doesNotMatch(js, /setError\(\); \$\('loading'\)\.hidden = false;[^\n]*tasks-content/);
});

test('Top tasks reuses the result-header refresh spinner while existing results reload', async () => {
  let loads = 0, finishReload;
  const page = await tasksHarness({ respond: message => {
    if (message.type !== 'LOAD_TASKS') return undefined;
    loads += 1;
    if (loads === 1) return { configured: true, tasks: [taskA], active: null, pendingWrites: [] };
    return new Promise(resolve => { finishReload = resolve; });
  } });
  const reloading = page.load(); await page.settle();
  assert.equal(page.nodes.loading.hidden, true, 'the standalone loader row stays hidden with existing results');
  assert.equal(page.nodes['refresh-tasks'].classList.contains('syncing'), true);
  assert.equal(page.nodes['refresh-tasks'].disabled, true);
  finishReload({ configured: true, tasks: [taskA], active: null, pendingWrites: [] });
  await reloading;
  assert.equal(page.nodes['refresh-tasks'].classList.contains('syncing'), false);
  assert.equal(page.nodes['refresh-tasks'].disabled, false);
});

test('Top tasks Stop button shows seconds only during the first minute', () => {
  assert.match(js, /if \(current && seconds < 60\) return `\$\{Math\.floor\(seconds\)\}s`/);
  assert.match(js, /Stop: \$\{formatDuration\(currentElapsedSeconds\(\), \{ current: true \}\)\}/);
});

test('tracking panel gives Top tasks and Reports matching header icons', () => {
  assert.match(content, /const tasks = button\('Top tasks'[\s\S]{0,250}tasks\.prepend\(icon\('checklist', TASKS_PATH\)\)/);
  assert.match(content, /const reports = button\('Reports'[\s\S]{0,250}reports\.prepend\(icon\('graph', REPORTS_PATH\)\)/);
});

test('background reconciliation preserves an already-fresh editable Recent snapshot', () => {
  assert.match(content, /if \(Array\.isArray\(data\?\.recent\)\) applyMenuData\(data\.recent, recentFresh\)/);
  assert.match(content, /const disabled = Boolean\(loadingRecent \|\| !recentFresh\)/);
  assert.doesNotMatch(content, /inlineMutation/);
});


test('tasks mounts the shared running status directly below the tabs', () => {
  assert.match(html, /<\/nav>\s*<\/div>\s*<div id="running-status"/);
  assert.match(html, /href="\.\.\/styles\/running-status\.css"/);
  assert.match(js, /import \{ mountRunningStatus \} from '\.\.\/ui\/running-status\.js'/);
  assert.match(js, /mountRunningStatus\(\$\('running-status'\), \{ send[, }]/);
});

async function tasksHarness({ configured = true, tasks = [], active = null, pendingWrites = [], respond, runningStatus = false, permissions = ['favicon'] } = {}) {
  const resources = [], messages = [], intervals = new Map(), timeouts = new Map();
  let now = Date.parse('2026-09-05T10:00:00Z'), timerId = 0;
  class Node {
    constructor(tag) { this.tag = tag; this.children = []; this.dataset = {}; this.listeners = {}; this.className = ''; this.value = ''; this.hidden = false; this.scrollTop = 0; this.scrollLeft = 0; }
    get disabled() { return Boolean(this.isDisabled); }
    set disabled(value) { this.isDisabled = value; if (value && document.activeElement === this) document.activeElement = document.body; }
    get classList() { return { add: name => this.classList.toggle(name, true), contains: name => this.className.split(' ').includes(name), toggle: (name, enabled) => { const names = new Set(this.className.split(' ').filter(Boolean)); if (enabled) names.add(name); else names.delete(name); this.className = [...names].join(' '); } }; }
    append(...nodes) { for (const node of nodes) { node.parentElement = this; this.children.push(node); } }
    replaceChildren(...nodes) { if (this.contains(document.activeElement)) document.activeElement = document.body; for (const node of this.children) node.parentElement = null; this.children = []; this.append(...nodes); }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    matches(selector) { return selector === ':hover' ? Boolean(this.hovered) : selector.startsWith('.') ? selector.slice(1).split('.').every(name => this.classList.contains(name)) : selector === this.tag; }
    closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null; }
    querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
    setAttribute(name, value) { if (name === 'class') this.className = value; else this[name] = value; }
    addEventListener(type, callback) { (this.listeners[type] ??= []).push(callback); }
    async dispatch(type, values = {}) { const event = { target: this, preventDefault() { this.defaultPrevented = true; }, ...values }; for (const callback of this.listeners[type] ?? []) await callback(event); return event; }
    click() { return this.disabled ? Promise.resolve() : this.dispatch('click'); }
    focus(options) { document.activeElement = this; this.focusOptions = options; }
  }
  const document = { createElement: tag => new Node(tag), createElementNS: (_ns, tag) => new Node(tag), createTextNode: text => Object.assign(new Node('#text'), { textContent: text }) };
  document.body = new Node('body'); document.activeElement = document.body; document.scrollingElement = document.body;
  const nodes = Object.fromEntries([...html.matchAll(/<([\w-]+)[^>]*id="([^"]+)"[^>]*>/g)].map(([, tag, id]) => [id, new Node(tag)]));
  document.body.append(...Object.values(nodes));
  document.getElementById = id => nodes[id]; document.querySelector = selector => document.body.querySelector(selector);
  document.addEventListener = () => {};
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const context = vm.createContext({ document, Date: FixedDate, URL, console, queueMicrotask,
    effectiveTrackedSeconds, sortTrackedTasks, taskPeriodRange, formatClockDuration, normalizeTaskUrl, localDateParts, entryDateValue, mountRunningStatus() {},
    localStorage: { getItem: () => null, setItem() {} }, confirm: () => true,
    ClockoliRecovery: { actionFor: () => null },
    setInterval: callback => { intervals.set(++timerId, callback); return timerId; }, clearInterval: id => intervals.delete(id),
    setTimeout: callback => { timeouts.set(++timerId, callback); return timerId; }, clearTimeout: id => timeouts.delete(id),
    chrome: { runtime: { getManifest: () => ({ permissions }), getURL: path => { resources.push(path); return `chrome-extension://clockoli${path}`; }, sendMessage(message, callback) {
      messages.push(structuredClone(message));
      Promise.resolve().then(() => respond?.(message) ?? (message.type === 'LOAD_TASKS' || message.type === 'GET_PAGE_STATE'
        ? { configured, tasks: structuredClone(tasks), active, pendingWrites } : { taskUrl: message.taskUrl, startedAt: new Date(now).toISOString() }))
        .then(data => callback({ ok: true, data }), error => callback({ ok: false, error: { message: error.message } }));
    } } },
  });
  if (runningStatus) {
    const strip = fs.readFileSync(new URL('../src/ui/running-status.js', import.meta.url), 'utf8');
    vm.runInContext(`(() => { ${strip.replace(/^import .*;\n/gm, '').replace('export function', 'function')}\nglobalThis.mountRunningStatus = mountRunningStatus; })()`, context);
  }
  vm.runInContext(js.replace(/^import .*;\n/gm, ''), context);
  const settle = async () => { for (let step = 0; step < 12; step++) await Promise.resolve(); };
  await settle();
  return { nodes, document, messages, resources, settle, timeouts, load: () => context.load(),
    rows: () => nodes['task-list'].children, order: () => nodes['task-list'].children.map(row => row.dataset.taskUrl),
    advance: async seconds => { now += seconds * 1000; for (const callback of [...intervals.values()]) callback(); await settle(); },
  };
}

const taskA = { taskUrl: 'https://github.com/acme/app/issues/1', title: 'Fix search', totalSeconds: 100, issue: { type: 'issue', owner: 'acme', repo: 'app', number: 1, url: 'https://github.com/acme/app/issues/1' } };
const taskB = { taskUrl: 'https://example.org/tasks/2', title: 'Review launch', totalSeconds: 50 };
const activeB = { taskUrl: taskB.taskUrl, startedAt: '2026-09-05T10:00:00Z' };

test('Top tasks keeps GitHub issue icons, uses favicons for other sites, and colors every title', async () => {
  const page = await tasksHarness({ tasks: [taskA, taskB] });
  const [github, external] = page.rows();
  assert.equal(github.querySelector('.task-main').children[0].tag, 'svg');
  const favicon = external.querySelector('.task-main').children[0];
  assert.equal(favicon.tag, 'img');
  assert.equal(favicon.src, 'chrome-extension://clockoli/_favicon/?pageUrl=https%3A%2F%2Fexample.org%2Ftasks%2F2&size=32');
  for (const row of [github, external]) {
    assert.match(row.style, /^--task-color:#[0-9a-f]{6}$/i);
    assert.match(row.querySelector('.task-title').style, /^color:#[0-9a-f]{6}$/i);
  }
});

test('Top tasks uses monograms without favicon permission and preserves GitHub and imported icons', async () => {
  const imported = { taskUrl: 'owner/repo/slug', title: 'Imported task', totalSeconds: 20 };
  const external = { ...taskB, taskUrl: 'https://www.example.org/tasks/2' };
  const page = await tasksHarness({ tasks: [taskA, external, imported], permissions: [] });
  const [github, site, unresolved] = page.rows();
  assert.equal(github.querySelector('.task-main').children[0].tag, 'svg');
  const icon = site.querySelector('.task-main').children[0];
  assert.equal(icon.tag, 'span');
  assert.equal(icon.textContent, 'E');
  assert.equal(icon['aria-hidden'], 'true');
  assert.equal(icon.src, undefined);
  assert.equal(unresolved.querySelector('.task-main').children[0].tag, 'img');
  assert.equal(unresolved.querySelector('.task-main').children[0].hidden, true);
  assert.equal(page.resources.includes('/_favicon/'), false);
});

test('Top tasks hides repository provenance while timer actions keep the task URL as identity', async () => {
  const task = { ...taskA, destinationIds: ['github:1', 'github:2'], timeRepositories: ['alice/time', 'team/time'] };
  const page = await tasksHarness({ tasks: [task] });
  assert.equal(page.rows()[0].querySelector('.task-repositories'), null);
  await page.rows()[0].querySelector('.timer-button').click(); await page.settle();
  const start = page.messages.find(message => message.type === 'START');
  assert.equal(start.taskUrl, task.taskUrl);
  assert.equal('destinationId' in start, false);
});

test('Top tasks starts and switches imported identities without making them links', async () => {
  const imported = { taskUrl: 'acme/project/imported-task', title: 'Imported task', totalSeconds: 120 };
  const page = await tasksHarness({ tasks: [imported, taskA] });
  const row = page.rows().find(item => item.dataset.taskUrl === imported.taskUrl);
  assert.equal(row.querySelector('.task-title').tag, 'span');
  assert.equal(row.querySelector('.timer-button').disabled, false);
  await row.querySelector('.timer-button').click(); await page.settle();
  assert.equal(page.messages.find(message => message.type === 'START')?.taskUrl, imported.taskUrl);
  const switching = await tasksHarness({ tasks: [imported, taskA], active: { taskUrl: taskA.taskUrl, startedAt: '2026-09-05T09:00:00Z' } });
  await switching.rows().find(item => item.dataset.taskUrl === imported.taskUrl).querySelector('.timer-button').click();
  assert.equal(switching.messages.find(message => message.type === 'SWITCH_TASK')?.taskUrl, imported.taskUrl);
});

test('Top tasks distinguishes read failures from conflict-only omissions', async () => {
  const failed = await tasksHarness({ respond: message => message.type === 'LOAD_TASKS' ? {
    configured: true, tasks: [taskA], active: null, pendingWrites: [], partial: true,
    readStatus: [{ status: 'error' }], conflicts: [],
  } : undefined });
  assert.match(failed.nodes['partial-status'].textContent, /1 time repository could not be loaded/i);
  const conflicted = await tasksHarness({ respond: message => message.type === 'LOAD_TASKS' ? {
    configured: true, tasks: [taskA], active: null, pendingWrites: [], partial: true,
    readStatus: [{ status: 'ok' }, { status: 'ok' }], conflicts: [{ code: 'record_id_conflict' }],
  } : undefined });
  assert.match(conflicted.nodes['partial-status'].textContent, /1 conflicting record was omitted/i);
  assert.doesNotMatch(conflicted.nodes['partial-status'].textContent, /could not be loaded/i);
});

for (const pending of [false, true]) test(`shared strip Stop reconciles Top tasks with pending writes ${pending}`, async () => {
  const active = { taskUrl: taskA.taskUrl, startedAt: '2026-09-05T09:00:00Z' };
  let stopped = false;
  const page = await tasksHarness({ runningStatus: true, respond: message => {
    if (message.type === 'STOP') { stopped = true; return { pending, entry: { durationSeconds: 3600 } }; }
    return { configured: true, active: stopped ? null : active, todayTrackedMs: 3_600_000,
      pendingWrites: stopped && pending ? [{ id: 'stopped-entry', status: 'pending' }] : [],
      tasks: [{ ...taskA, totalSeconds: stopped ? 3600 : 0, activeStartedAt: stopped ? null : active.startedAt }],
    };
  } });
  assert.equal(page.timeouts.size, 0, 'no list polling before Stop');
  assert.equal(page.rows()[0].querySelector('.tracked-time').textContent, '1h 0m');
  page.document.scrollingElement.scrollTop = 320;
  await page.nodes['running-status'].querySelector('.running-status-stop').click();
  assert.equal(page.nodes['running-status'].querySelector('.running-status-idle').hidden, false);
  assert.equal(page.rows()[0].querySelector('.timer-button').textContent, 'Start');
  assert.equal(page.rows()[0].classList.contains('running'), false);
  assert.equal(page.nodes['refresh-tasks'].disabled, pending);
  assert.equal(page.timeouts.size, pending ? 1 : 0, 'only existing pending-write polling is scheduled');
  await page.advance(60);
  assert.equal(page.rows()[0].querySelector('.tracked-time').textContent, '1h 0m', 'completed time must stop counting');
  assert.equal(page.document.scrollingElement.scrollTop, 320);
});

test('rejected shared strip Stop leaves the task running and does not notify the list', async () => {
  const active = { ...activeB, startedAt: '2026-09-05T09:00:00Z' };
  const page = await tasksHarness({ runningStatus: true, tasks: [{ ...taskB, activeStartedAt: active.startedAt }], active,
    respond: message => { if (message.type === 'STOP') throw new Error('Stop rejected'); },
  });
  await page.nodes['running-status'].querySelector('.running-status-stop').click();
  assert.equal(page.messages.filter(message => message.type === 'LOAD_TASKS').length, 1);
  assert.equal(page.rows()[0].querySelector('.timer-button').textContent, 'Stop: 1h 0m');
  assert.equal(page.nodes['running-status'].querySelector('.running-status-error').textContent, 'Stop rejected');
});

for (const interaction of ['hover', 'focus']) test(`elapsed sorting waits for row ${interaction} to end and keeps clocks live`, async () => {
  const page = await tasksHarness({ tasks: [taskA, { ...taskB, activeStartedAt: activeB.startedAt }], active: activeB });
  const [first, second] = page.rows(), button = first.querySelector('.timer-button');
  if (interaction === 'hover') { first.hovered = true; await first.dispatch('pointerenter'); } else button.focus();
  page.document.scrollingElement.scrollTop = 320;
  await page.advance(70);
  assert.deepEqual(page.order(), [taskA.taskUrl, taskB.taskUrl]);
  assert.equal(page.rows()[0], first, 'the row under interaction must stay mounted');
  assert.equal(second.querySelector('.tracked-time').textContent, formatClockDuration(120));
  assert.equal(second.querySelector('.timer-button').textContent, 'Stop: 1m');
  if (interaction === 'focus') assert.equal(page.document.activeElement, button);
  first.hovered = false; page.nodes['task-filter'].focus();
  await first.dispatch('pointerleave'); await page.nodes['task-list'].dispatch('focusout'); await page.settle();
  assert.deepEqual(page.order(), [taskB.taskUrl, taskA.taskUrl]);
  assert.equal(page.document.activeElement, page.nodes['task-filter']);
  assert.equal(page.document.scrollingElement.scrollTop, 320);
});

test('reconciliation waits until both hover and focus leave, including refreshes', async () => {
  const page = await tasksHarness({ tasks: [taskA, { ...taskB, activeStartedAt: activeB.startedAt }], active: activeB });
  const row = page.rows()[0], button = row.querySelector('.timer-button');
  row.hovered = true; button.focus(); await page.advance(70); await page.load();
  row.hovered = false; await row.dispatch('pointerleave'); await page.settle();
  assert.equal(page.rows()[0], row); assert.equal(page.document.activeElement, button);
  page.nodes['task-filter'].focus(); await page.nodes['task-list'].dispatch('focusout'); await page.settle();
  assert.deepEqual(page.order(), [taskB.taskUrl, taskA.taskUrl]);
});

test('explicit filter rebuild restores the same task control and both scroll positions', async () => {
  const page = await tasksHarness({ tasks: [taskA, taskB] });
  page.rows()[0].querySelector('.task-title').focus();
  page.document.scrollingElement.scrollTop = 320; page.nodes['task-list'].scrollTop = 80;
  page.nodes['task-filter'].value = 'Fix'; await page.nodes['task-filter'].dispatch('input');
  assert.equal(page.rows().length, 1);
  assert.equal(page.document.activeElement, page.rows()[0].querySelector('.task-title'));
  assert.equal(page.document.scrollingElement.scrollTop, 320); assert.equal(page.nodes['task-list'].scrollTop, 80);
});

test('empty, unmatched, and unconfigured states each give the appropriate next action', async () => {
  assert.match(html, /id="task-controls"[^>]*hidden/);
  const empty = await tasksHarness();
  assert.equal(empty.nodes['empty-message'].textContent, 'Nothing tracked yet. Open a task page and click Clockoli to start.');
  assert.equal(empty.nodes['clear-filter'].hidden, true);
  const page = await tasksHarness({ tasks: [taskA] });
  page.nodes['task-filter'].value = 'missing'; await page.nodes['task-filter'].dispatch('input');
  assert.equal(page.nodes['empty-message'].textContent, 'No tasks match.'); assert.equal(page.nodes['clear-filter'].hidden, false);
  await page.nodes['clear-filter'].click();
  assert.equal(page.nodes['task-filter'].value, ''); assert.equal(page.rows().length, 1); assert.equal(page.document.activeElement, page.nodes['task-filter']);
  const setup = await tasksHarness({ configured: false });
  assert.equal(setup.nodes['task-controls'].hidden, true); assert.equal(setup.nodes.setup.hidden, false); assert.equal(setup.nodes['tasks-content'].hidden, true);
  assert.notEqual(setup.document.activeElement, setup.nodes['task-filter']);
  await setup.nodes['setup-settings'].click(); assert.equal(setup.messages.at(-1).type, 'OPEN_OPTIONS');
});

test('filter keyboard flow launches exactly one idle match, clears on Escape, and never stops a running match', async () => {
  const page = await tasksHarness({ tasks: [taskA, taskB] });
  const filter = page.nodes['task-filter']; assert.equal(page.document.activeElement, filter);
  await filter.dispatch('keydown', { key: 'Enter' }); assert.equal(page.messages.length, 1);
  filter.value = 'missing'; await filter.dispatch('input'); await filter.dispatch('keydown', { key: 'Enter' }); assert.equal(page.messages.length, 1);
  filter.value = 'Fix'; await filter.dispatch('input');
  await filter.dispatch('keydown', { key: 'Enter', isComposing: true }); assert.equal(page.messages.length, 1);
  await filter.dispatch('keydown', { key: 'Enter' }); await page.settle();
  assert.equal(page.messages.at(-1).type, 'START'); assert.equal(page.messages.at(-1).taskUrl, taskA.taskUrl);
  await filter.dispatch('keydown', { key: 'Enter' }); assert.equal(page.messages.filter(message => message.type === 'STOP').length, 0);
  await filter.dispatch('keydown', { key: 'Escape' }); assert.equal(filter.value, ''); assert.equal(page.rows().length, 2);
  filter.focus(); await page.load(); assert.equal(page.document.activeElement, filter);
});

test('launching a different task uses the durable stop-before-start switch and reconciles failures', async () => {
  for (const fail of [false, true]) {
    const page = await tasksHarness({ tasks: [taskA, { ...taskB, activeStartedAt: activeB.startedAt }], active: activeB, respond: message => {
      if (message.type !== 'SWITCH_TASK') return;
      if (fail) throw new Error('Could not save current timer');
      return { active: { taskUrl: taskA.taskUrl, startedAt: activeB.startedAt }, stopped: { entry: { durationSeconds: 0 } } };
    } });
    page.nodes['task-filter'].value = 'Fix'; await page.nodes['task-filter'].dispatch('input');
    await page.nodes['task-filter'].dispatch('keydown', { key: 'Enter' }); await page.settle();
    assert.deepEqual(page.messages.map(message => message.type), fail ? ['LOAD_TASKS', 'SWITCH_TASK', 'GET_PAGE_STATE'] : ['LOAD_TASKS', 'SWITCH_TASK']);
    assert.equal(page.rows()[0].querySelector('.timer-button').textContent, fail ? 'Start' : 'Stop: 0s');
    if (fail) assert.equal(page.nodes.error.hidden, false);
  }
});

test('blocking conflicts reject keyboard launches and rows put title before muted URL and clock before action', async () => {
  const page = await tasksHarness({ tasks: [taskA], active: { taskUrl: taskA.taskUrl, startedAt: activeB.startedAt }, pendingWrites: [{ status: 'conflict' }] });
  const row = page.rows()[0], copy = row.querySelector('.task-copy'), actions = row.querySelector('.task-actions');
  assert.equal(copy.children[0].className, 'task-title'); assert.equal(copy.children[1].className, 'task-url');
  assert.equal(actions.children[0].className, 'tracked-time'); assert.ok(row.classList.contains('running'));
  assert.match(css, /\.tracked-time\{[^}]*font:[^}]*var\(--fontStack-monospace\)[^}]*text-align:right/);
  assert.match(css, /\.task-row\.running\{[^}]*var\(--borderColor-accent-emphasis\)/);
  assert.match(css, /\.task-row\.running\{[^}]*background:color-mix\(in srgb,var\(--task-color\) 12%,var\(--bgColor-default\)\)/);
  assert.doesNotMatch(css, /\.task-row\.running\{[^}]*animation/);
  await page.nodes['task-filter'].dispatch('keydown', { key: 'Enter' }); await page.rows()[0].querySelector('.timer-button').click();
  assert.equal(page.messages.length, 1);
  const idle = await tasksHarness({ tasks: [taskA], pendingWrites: [{ status: 'conflict' }] });
  await idle.nodes['task-filter'].dispatch('keydown', { key: 'Enter' }); await idle.settle();
  assert.equal(idle.messages.length, 1);
});

test('timer mutations keep the focused control and row mounted through busy state', async () => {
  let accept;
  const page = await tasksHarness({ tasks: [taskA], respond: message => message.type === 'START' ? new Promise(resolve => { accept = resolve; }) : undefined });
  const row = page.rows()[0], button = row.querySelector('.timer-button'); button.focus();
  const started = button.click(); await page.settle();
  await page.nodes['task-list'].dispatch('focusout'); await page.settle();
  assert.equal(page.rows()[0], row); assert.equal(button.disabled, true);
  accept({ taskUrl: taskA.taskUrl, startedAt: '2026-09-05T10:00:00Z' }); await started;
  assert.equal(page.document.activeElement, button); assert.equal(page.rows()[0], row);
  assert.equal(button.textContent, 'Stop: 0s'); assert.equal(button.disabled, false);
});

test('Enter waits while multiple visible rows are retained under the pointer during refresh', async () => {
  let refreshed = false;
  const page = await tasksHarness({ respond: message => message.type === 'LOAD_TASKS' ? { configured: true, tasks: refreshed ? [taskA] : [taskA, taskB] } : undefined });
  page.rows()[0].hovered = true; refreshed = true; await page.load();
  await page.nodes['task-filter'].dispatch('keydown', { key: 'Enter' }); await page.settle();
  assert.deepEqual(page.messages.map(message => message.type), ['LOAD_TASKS', 'LOAD_TASKS']);
});
