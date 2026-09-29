import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../', import.meta.url);
const read = relative => fs.readFileSync(new URL(relative, root), 'utf8');

test('TaskTimeline source and adapter live inside Clockoli', () => {
  const clockoliPackage = JSON.parse(read('package.json'));
  const timelinePackage = JSON.parse(read('packages/task-timeline-component/package.json'));

  assert.equal(timelinePackage.name, 'task-timeline-component-clockoli');
  assert.equal(clockoliPackage.engines.node, '>=20.19.0');
  assert.deepEqual(clockoliPackage.workspaces, ['packages/*']);
  assert.equal(clockoliPackage.scripts['test:clockoli'], 'node --test test/*.test.js');
  assert.equal(clockoliPackage.scripts['test:timeline'], 'npm run test:all --workspace task-timeline-component-clockoli && npm run build:timeline && git diff --exit-code -- src/content/task-timeline-component.js');
  assert.doesNotMatch(clockoliPackage.scripts.test, /run-elastic-timeline-suite|\.\.\/timeline/);
  assert.equal(timelinePackage.scripts['test:all'], 'npm test && npm run test:e2e && npm run test:package');
  for (const relative of [
    'packages/task-timeline-component/vendor/timeline-component.js',
    'packages/task-timeline-component/src/clockoli-adapter.js',
    'packages/task-timeline-component/tests/adapter.test.js',
    'packages/task-timeline-component/e2e/adapter.spec.js',
    'packages/task-timeline-component/scripts/build.mjs',
  ]) {
    assert.equal(fs.existsSync(new URL(relative, root)), true, `${relative} must be part of Clockoli`);
  }
});

test('GitHub panel uses the vendored TaskTimeline adapter and has no legacy timeline experiment', () => {
  const manifest = JSON.parse(read('manifest.json'));
  const content = read('src/content/github.js');

  assert.deepEqual(manifest.content_scripts[0].js, [
    'src/domain/recovery-actions.js',
    'src/content/task-timeline-component.js',
    'src/content/github.js',
  ]);
  assert.ok(!manifest.web_accessible_resources[0].resources.includes('src/content/elastic-timeline-editor.css'));
  assert.match(content, /globalThis\.ClockoliTaskTimeline\?\.createTimeline/);
  assert.match(content, /items,\s*rows,\s*now,\s*view: timelineView,\s*viewMode: timelineGraphicViewMode/);
  assert.match(read('src/content/task-timeline-component.js'), /global\.TaskTimeline = TaskTimeline/);
  assert.match(read('src/content/task-timeline-component.js'), /global\.ClockoliTaskTimeline = Object\.freeze/);
  assert.doesNotMatch(read('src/content/task-timeline-component.js'), /\bexport\s*\{/);
  assert.doesNotMatch(content, /ClockoliElasticTimeline/);
  assert.doesNotMatch(content, /elastic-timeline-core/);
  assert.doesNotMatch(content, /onMove: async/);
  assert.doesNotMatch(content, /onResize: async/);
  assert.doesNotMatch(content, /async function saveCalendarEntry/);
  assert.doesNotMatch(content, /type: 'EDIT_ACTIVE_START'/);
  assert.match(content, /type: 'QUEUE_ENTRY_EDIT'/);
  assert.match(content, /type: 'QUEUE_ACTIVE_START_EDIT'/);
  assert.match(content, /timeline-queue-spinner/);
  assert.match(content, /describeSaveStatus/);
  assert.match(content, /edit\.kind !== 'resize-left'/);
  assert.match(content, /type: 'QUEUE_ACTIVE_START_EDIT'/);
  assert.match(content, /original: \{ id: entry\.id, startedAt: entry\.startedAt \}/);
});

test('timeline applies edits immediately and shows a non-blocking durable queue badge', () => {
  const content = read('src/content/github.js');

  assert.match(content, /async function queueCalendarEntry/);
  assert.match(content, /timelineOptimisticEdits\.set\(entry\.id, edits\);\s*applyTimelineOptimisticEntry\(entry, edits\);\s*refreshMountedTimeline\(\);\s*const acceptanceId = beginTimelineQueueAcceptance\(\);/);
  assert.match(content, /isPending: Boolean\(entry\._pending \|\| optimistic\)/);
  assert.match(content, /isEditable: !entry\._active/);
  assert.match(content, /timelineQueueIndicator\.textContent = status.label/);
  assert.doesNotMatch(content, /timeline-queue-count/);
  assert.match(content, /recordTimelineQueueDiagnostic\('Edit time entry: accepted locally and queued for GitHub\.'/);
  assert.match(content, /recent\.filter\(entry => entry\._path && \(entry\._sha \|\| entry\._pending\)/);
  assert.match(content, /const previousEntry = recent\.find/);
  assert.match(content, /recent = recent\.map\(item => item\.id === entry\.id[\s\S]*?restore\.previousEntry/);
  assert.match(content, /function rollbackTimelineOptimisticEdit[\s\S]*?previousState\?\.rejected[\s\S]*?timelineOptimisticEdits\.set\(entry\.id, restore\.previousOptimisticEdit\)[\s\S]*?timelineOptimisticEdits\.delete\(entry\.id\)/);
  assert.match(content, /function timelineQueueSize\(\) \{ return Math\.max\(Number\(pageState\.pendingCount\) \|\| 0, timelineQueuedOperationIds\.size \+ timelineQueueAcceptances\.size\); \}/);
  assert.match(content, /finishTimelineQueueAcceptance\(acceptanceId\);\s*refreshTimelineQueueIndicator\(\);\s*if \(!refreshMountedTimeline\(\)\) renderUi\(\);/);
  assert.match(content, /type: 'QUEUE_ENTRY_EDIT'/);
  assert.match(content, /timelineQueuedOperationIds\.set/);
  assert.match(content, /timeline-queue-spinner/);
  assert.match(content, /describeSaveStatus/);
  assert.doesNotMatch(content, /async function saveCalendarEntry/);
  assert.doesNotMatch(content, /timelineSaving = true; suppressRecentRender = true/);
  assert.doesNotMatch(content, /timelineShell\.inert|timeline-saving-spinner|timeline-shell\.is-saving/);
});

test('timeline task switching is optimistic and keeps the queued completion visible', () => {
  const content = read('src/content/github.js');

  assert.match(content, /isPending: Boolean\(entry\._pending\)/);
  assert.match(content, /const acceptedActive = \{[\s\S]*?_pending: true/);
  assert.match(content, /function refreshMountedTimelineAtRightEdge\(startedAt\)/);
  assert.match(content, /function acceptTimelineStartImmediately[\s\S]*?pageState = \{ \.\.\.pageState, active: acceptedActive \};[\s\S]*?if \(!refreshMountedTimelineAtRightEdge\(startedAt\)\) renderUi\(\);/);
  assert.match(content, /function refreshMountedTimelineAtRightEdge[\s\S]*?timelineView = \{ start: now - span, end: now, focusedAt: now \}/);
  assert.doesNotMatch(content, /endPadding|end: now \+ /);
  assert.match(content, /if \(timelineGraphicViewMode === 'calendar'\) \{\s*timelineInstance\.update\(\{ items, rows, now \}\)/);
  assert.match(content, /type: 'SWITCH_TASK', timelineTask: true/);
  assert.match(content, /const timelineOptimisticCompletions = new Map\(\)/);
  assert.match(content, /function mergeTimelineCompletedEntries\(completed, optimisticCompletions\)/);
  assert.match(content, /mergeTimelineCompletedEntries\(completed, timelineOptimisticCompletions\.values\(\)\)/);
  assert.match(content, /timelineStartInFlight/);
  assert.match(content, /isStartDisabled: !taskUrlOf\(entry\) \|\| timelineStartInFlight \|\|/);
  assert.match(content, /timelineStartInFlight = true;\s*refreshMountedTimeline\(\);/);
  assert.match(content, /timelineStartInFlight = false;\s*refreshMountedTimeline\(\);/);
  assert.match(content, /timelineInstance\.scrollToEnd\(\)/);
  assert.match(content, /if \(timelineScrollToRightPending\)/);
  assert.match(content, /timelineAcceptedActive = acceptedActive/);
  assert.match(content, /timelineOptimisticCompletions\.set\(previousActive\.id/);
  assert.doesNotMatch(content, /timelineAcceptedActive = \{ \.\.\.result\.active[\s\S]{0,300}recentLoaded = false/);
  assert.match(content, /accepted && !incomingConfirmsAccepted/);
  assert.match(content, /onEditDebug: detail => recordTimelineGestureDiagnostic\(detail\)/);
  assert.match(content, /function recordTimelineGestureDiagnostic\(event\)/);
  assert.match(content, /Timeline \$\{phase\}/);
});

test('timeline switch adopts the worker timestamp without overriding later manual scroll', () => {
  const content = read('src/content/github.js');
  const start = content.indexOf('  async function restartTimelineEntry(entry)');
  const end = content.indexOf('\n        onEditCommit:', start);
  assert.ok(start >= 0 && end > start);
  const handler = content.slice(start, end);
  const adopt = handler.indexOf('timelineAcceptedActive = { ...result.active');
  const preserveScroll = handler.indexOf('if (!refreshMountedTimeline()) renderUi()', adopt);

  assert.ok(adopt >= 0, 'worker active response is adopted');
  assert.ok(preserveScroll > adopt, 'worker timestamp must refresh without another right-edge scroll');
  assert.equal(handler.indexOf('refreshMountedTimelineAtRightEdge(', adopt), -1, 'worker acceptance must not override manual scroll');
});

test('running entry with a worker timestamp beyond the old edge is included after advancing now', () => {
  const content = read('src/content/github.js');
  const start = content.indexOf('  function mergeTimelineCompletedEntries(');
  const end = content.indexOf('\n\n  function popupTimelineItems', start);
  assert.ok(start >= 0 && end > start);
  const project = Function('workerStartedAt', `
    const recent = [];
    const timelineOptimisticCompletions = new Map();
    const timelineOptimisticEdits = new Map();
    const pageState = { active: { id: 'worker-active', taskUrl: 'https://example.com/new', startedAt: workerStartedAt } };
    ${content.slice(start, end)}
    return now => popupTimelineEntries(0, now);
  `)('2026-09-03T10:00:00.010Z');

  assert.equal(project(Date.parse('2026-09-03T10:00:00.000Z')).length, 0, 'the frozen optimistic edge reproduces the disappearance');
  const advanced = project(Date.parse('2026-09-03T10:00:00.011Z'));
  assert.equal(advanced.length, 1);
  assert.equal(advanced[0].id, 'worker-active');
  assert.equal(advanced[0]._active, true);
});

test('ordinary Start tracking projects the running block and right-edge scroll before worker acceptance', () => {
  const content = read('src/content/github.js');
  const start = content.indexOf("const startButton = button(current ? 'Start tracking this task'");
  const end = content.indexOf('\n        startButton.disabled', start);
  assert.ok(start >= 0 && end > start);
  const handler = content.slice(start, end);
  const optimistic = handler.indexOf('acceptTimelineStartImmediately(');
  const worker = handler.indexOf("await send({ type: 'START'");

  assert.ok(optimistic >= 0, 'ordinary Start must project an optimistic running block');
  assert.ok(worker > optimistic, 'the optimistic block must render before waiting for the worker');
  assert.match(handler, /if \(timelineStartInFlight \|\| timelineStopInFlight \|\| timelineDeleteInFlight\) return;\s*timelineStartInFlight = true/);
  assert.match(handler, /if \(!refreshMountedTimeline\(\)\) renderUi\(\)/);
  assert.equal(handler.indexOf('refreshMountedTimelineAtRightEdge(', worker), -1, 'worker acceptance must preserve any manual scroll');
  assert.match(handler, /rollbackTimelineStart/);
  assert.match(handler, /finally \{\s*timelineStartInFlight = false;\s*refreshMountedTimeline\(\);/);
});

test('optimistic start helper updates the mounted timeline and scrolls before any worker response', () => {
  const content = read('src/content/github.js');
  const start = content.indexOf('  function refreshMountedTimelineAtRightEdge(startedAt)');
  const end = content.indexOf('\n\n  function beginTimelineQueueAcceptance()', start);
  assert.ok(start >= 0 && end > start);
  const run = Function(`
    let pageState = { active: null };
    let timelineWindow = { historyStart: 0, now: Date.now() - 1000 };
    let timelineView = { start: Date.now() - 86_400_000, end: Date.now() - 1000, focusedAt: Date.now() - 1000 };
    let timelineGraphicViewMode = 'timeline';
    let timelineAcceptedActive = null;
    let descriptionDraft = null;
    let timelineScrollToRightPending = false;
    let recentLoadId = 0;
    let recentLoad = Promise.resolve();
    let loadingRecent = true;
    const timelineOptimisticCompletions = new Map();
    const updates = [];
    let scrolls = 0;
    const timelineInstance = {
      update(payload) { updates.push(payload); },
      scrollToEnd() { scrolls += 1; },
    };
    const taskUrlOf = value => value.taskUrl;
    const taskTitleOf = value => value.taskTitle;
    const popupTimelineItems = () => ({ items: pageState.active ? [pageState.active] : [], rows: [], byId: new Map() });
    const beginTimelineQueueAcceptance = () => 'local:1';
    const finishTimelineQueueAcceptance = () => {};
    const refreshTimelineQueueIndicator = () => {};
    const refreshCompactSurface = () => {};
    const localDateValue = date => date.toISOString().slice(0, 10);
    const refreshMountedTimeline = () => true;
    const renderUi = () => { throw new Error('mounted timeline must not be remounted'); };
    ${content.slice(start, end)}
    const context = acceptTimelineStartImmediately({ taskUrl: 'https://example.com/new', taskTitle: 'New task' });
    return { context, pageState, timelineAcceptedActive, updates, scrolls, timelineView };
  `);

  const result = run();
  assert.equal(result.pageState.active, result.context.acceptedActive);
  assert.equal(result.timelineAcceptedActive, result.context.acceptedActive);
  assert.equal(result.updates.length, 1);
  assert.equal(result.updates[0].items[0], result.context.acceptedActive);
  assert.equal(result.scrolls, 1);
  assert.equal(result.timelineView.end >= new Date(result.context.startedAt).getTime(), true);
});

test('accepted start invalidates older recent loads before rendering and can mount without history', () => {
  const content = read('src/content/github.js');
  const helperStart = content.indexOf('  function acceptTimelineStartImmediately(');
  const helperEnd = content.indexOf('\n\n  function rollbackTimelineStart', helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart);
  const helper = content.slice(helperStart, helperEnd);
  const invalidate = helper.indexOf('recentLoadId += 1;');
  const render = helper.indexOf('refreshMountedTimelineAtRightEdge');

  assert.ok(invalidate >= 0, 'accepted Start must invalidate every older LOAD_RECENT response');
  assert.ok(render > invalidate, 'stale history must be invalidated before the optimistic render');
  assert.match(helper, /recentLoad = null;\s*loadingRecent = false;/);
  assert.match(content, /if \(!recentLoaded && !timelineAcceptedActive\)/);
});

test('same-task starts and STOP during start acceptance are blocked defensively', () => {
  const content = read('src/content/github.js');
  assert.match(content, /isStartDisabled: !taskUrlOf\(entry\) \|\| timelineStartInFlight \|\| timelineStopInFlight \|\| timelineDeleteInFlight \|\| sameTask\(entry, pageState\.active\)/);
  assert.match(content, /isStopDisabled: Boolean\(entry\._active && \(timelineStartInFlight \|\| timelineStopInFlight \|\| timelineDeleteInFlight/);
  assert.match(content, /if \(!entry \|\| !taskUrlOf\(entry\) \|\| entry\._active \|\| timelineStartInFlight \|\| timelineStopInFlight \|\| timelineDeleteInFlight \|\| sameTask\(entry, pageState\.active\)\) return/);
  assert.match(content, /if \(timelineAcceptedActive && sameTask\(timelineAcceptedActive, activeEntry\)\) timelineAcceptedActive = null;[\s\S]*?pageState = \{ \.\.\.pageState, active: null \}/);
  const panelStopStart = content.indexOf("const stop = button(switchToCurrent ? 'Save and switch to this task' : 'Stop and save'");
  const panelStopEnd = content.indexOf('\n        stop.disabled', panelStopStart);
  assert.ok(panelStopStart >= 0 && panelStopEnd > panelStopStart);
  const panelStop = content.slice(panelStopStart, panelStopEnd);
  assert.match(panelStop, /if \(timelineStartInFlight \|\| timelineDeleteInFlight \|\| !beginTimelineStop\(\)\) return/);
  assert.match(panelStop, /finally \{ finishTimelineStop\(\); \}/);
  assert.match(panelStop, /if \(timelineAcceptedActive && sameTask\(timelineAcceptedActive, active\)\) timelineAcceptedActive = null/);
  assert.match(content.slice(panelStopEnd, panelStopEnd + 300), /stop\.disabled = timelineStartInFlight \|\| timelineStopInFlight \|\| timelineDeleteInFlight/);
});

test('timeline and panel STOP share one single-flight acceptance across a deferred request', async () => {
  const content = read('src/content/github.js');
  const helperStart = content.indexOf('  function beginTimelineStop()');
  const helperEnd = content.indexOf('\n\n  function refreshMountedTimelineAtRightEdge', helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart);
  const helpers = content.slice(helperStart, helperEnd);
  const timelineHandlerStart = content.indexOf('  async function stopTimelineEntry(activeEntry)');
  const timelineHandlerEnd = content.indexOf('\n  async function restartTimelineEntry', timelineHandlerStart);
  const timelineHandler = content.slice(timelineHandlerStart, timelineHandlerEnd);
  assert.match(timelineHandler, /!beginTimelineStop\(\)/);
  assert.match(timelineHandler, /finally \{ finishTimelineStop\(\); \}/);

  const run = Function(`
    let timelineStopInFlight = false;
    let sends = 0;
    let release = null;
    let refreshes = 0;
    const refreshMountedTimeline = () => { refreshes += 1; };
    ${helpers}
    const stopSurface = async () => {
      if (!beginTimelineStop()) return false;
      try {
        sends += 1;
        await new Promise(resolve => { release = resolve; });
        return true;
      } finally { finishTimelineStop(); }
    };
    return (async () => {
      const first = stopSurface();
      await Promise.resolve();
      const second = stopSurface();
      await Promise.resolve();
      const whileDeferred = { sends, secondResult: await second, timelineStopInFlight };
      release();
      await first;
      const third = stopSurface();
      await Promise.resolve();
      release();
      await third;
      return { whileDeferred, sends, timelineStopInFlight, refreshes };
    })();
  `);
  const result = await run();

  assert.deepEqual(result.whileDeferred, { sends: 1, secondResult: false, timelineStopInFlight: true });
  assert.equal(result.sends, 2, 'a new Stop is accepted only after the deferred request finishes');
  assert.equal(result.timelineStopInFlight, false);
  assert.equal(result.refreshes, 4, 'both accepted Stops disable and re-enable every Stop surface');
});

test('optimistic start acceptance rolls back internal state if rendering throws', () => {
  const content = read('src/content/github.js');
  const start = content.indexOf('  function refreshMountedTimelineAtRightEdge(startedAt)');
  const end = content.indexOf('\n\n  function rollbackTimelineStart', start);
  assert.ok(start >= 0 && end > start);
  const run = Function(`
    const previousActive = { id: 'old', taskUrl: 'https://example.com/old', startedAt: '2026-09-03T09:00:00.000Z' };
    let pageState = { active: previousActive };
    let timelineWindow = { historyStart: 0, now: Date.now() - 1000 };
    let timelineView = { start: Date.now() - 86_400_000, end: Date.now() - 1000, focusedAt: Date.now() - 1000 };
    let timelineGraphicViewMode = 'timeline';
    let timelineAcceptedActive = null;
    let descriptionDraft = null;
    let timelineScrollToRightPending = false;
    let recentLoadId = 0, recentLoad = Promise.resolve(), loadingRecent = true, finished = 0;
    const timelineOptimisticCompletions = new Map();
    const timelineInstance = { update() { throw new Error('render failed'); }, scrollToEnd() {} };
    const taskUrlOf = value => value.taskUrl;
    const taskTitleOf = value => value.taskTitle || '';
    const popupTimelineItems = () => ({ items: [], rows: [], byId: new Map() });
    const beginTimelineQueueAcceptance = () => 'local:1';
    const finishTimelineQueueAcceptance = () => { finished += 1; };
    const refreshTimelineQueueIndicator = () => {};
    const refreshCompactSurface = () => {};
    const localDateValue = date => date.toISOString().slice(0, 10);
    const renderUi = () => {};
    ${content.slice(start, end)}
    try { acceptTimelineStartImmediately({ taskUrl: 'https://example.com/new' }, { completePrevious: true }); }
    catch (error) { return { error: error.message, pageState, timelineAcceptedActive, optimistic: timelineOptimisticCompletions.size, finished }; }
    throw new Error('expected rendering failure');
  `);
  const result = run();
  assert.equal(result.error, 'render failed');
  assert.equal(result.pageState.active.id, 'old');
  assert.equal(result.timelineAcceptedActive, null);
  assert.equal(result.optimistic, 0);
  assert.equal(result.finished, 1);
});

test('stale recent snapshots cannot erase a locally accepted running task', () => {
  const content = read('src/content/github.js');
  const start = content.indexOf('  function reconcileTimelineAcceptedActive(incomingState)');
  const end = content.indexOf('\n\n  function applyMenuData', start);
  assert.ok(start >= 0 && end > start);
  const reconcile = Function('accepted', `
    let timelineAcceptedActive = accepted;
    const taskUrlOf = value => value?.taskUrl || '';
    ${content.slice(start, end)}
    return incoming => ({ state: reconcileTimelineAcceptedActive(incoming), accepted: timelineAcceptedActive });
  `)({ taskUrl: 'https://example.com/new', startedAt: '2026-09-03T10:00:00.000Z', _pending: true });

  const stale = reconcile({ active: null, recent: [] });
  assert.equal(stale.state.active.taskUrl, 'https://example.com/new');
  assert.equal(stale.accepted, stale.state.active);

  const confirmed = reconcile({ active: { id: 'saved', taskUrl: 'https://example.com/new', startedAt: '2026-09-03T10:00:01.000Z' } });
  assert.equal(confirmed.state.active.id, 'saved');
  assert.equal(confirmed.accepted, null);
  assert.match(content, /function applyMenuData[\s\S]*?pageState = reconcileTimelineAcceptedActive\(/);
  assert.match(content, /function applyPageState[\s\S]*?pageState = reconcileTimelineAcceptedActive\(data\)/);
});

test('timeline block identity stays stable when edits change chronological order', () => {
  const content = read('src/content/github.js');

  assert.match(content, /const stableId = entry\.id \|\| `\$\{entry\._path\}:\$\{entry\._index\}`/);
  assert.match(content, /const id = `\$\{entry\._active \? 'active' : 'entry'\}:\$\{stableId\}`/);
  assert.doesNotMatch(content, /`\$\{entry\._path\}:\$\{entry\._index\}:\$\{index\}`/);
});


test('tracking timeline renders named rows and the configurable main project for unmatched tasks', () => {
  const content = read('src/content/github.js');
  assert.match(content, /function popupTimelineRows\(entries\)/);
  assert.match(content, /projectNameForUrl\(storedTaskIdentityOf\(entry\), pageState\.projects, pageState\.otherProjectName\)/);
  assert.match(content, /rowId: projectRowId\(projectName\)/);
  assert.match(content, /const otherProjectName = String\(pageState\.otherProjectName \|\| 'Other'\)/);
  assert.match(content, /timelineInstance\.update\(\{ items, rows, now: timelineWindow.now \}\)/);
  assert.match(content, /createTimeline\(host, \{\s*items,\s*rows,/);
  assert.match(content, /otherProjectName/);
  assert.match(read('src/background/service-worker.js'), /projects: preferences\.projects,[\s\S]*otherProjectName: preferences\.otherProjectName/);
});


test('optimistic completion replaces the same completed timer instead of adding a duplicate block', () => {
  const content = read('src/content/github.js');
  const start = content.indexOf('function mergeTimelineCompletedEntries');
  const end = content.indexOf('\n\n  function popupTimelineEntries', start);
  assert.ok(start >= 0 && end > start);
  const helper = Function(`${content.slice(start, end)}; return mergeTimelineCompletedEntries;`)();
  const remote = { id: 'timer-1', endedAt: '2026-09-02T10:00:00.000Z', _pending: true };
  const optimistic = { id: 'timer-1', endedAt: '2026-09-02T10:01:00.000Z', _optimisticCompletion: true };

  const merged = helper([remote], [optimistic]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0], optimistic);
});

test('routine full-width UI updates never destroy the mounted timeline', () => {
  const content = read('src/content/github.js');

  assert.match(content, /const preserveFullWidthTimeline = Boolean\(fullWidthPopupOpen && pageState\.configured && timelineInstance && timelineWindow\)/);
  assert.match(content, /if \(!preserveFullWidthTimeline\) \{\s*timelineInstance\?\.destroy\(\)/);
  assert.match(content, /if \(fullWidthPopupOpen\) \{\s*if \(preserveFullWidthTimeline\) refreshMountedTimeline\(\);\s*else renderFullWidthPopup\(style\);/);
  assert.doesNotMatch(content, /if \(fullWidthPopupOpen\) renderFullWidthPopup\(style\)/);
});

test('timeline STOP keeps the completed block and its connectors visible through queue sync', () => {
  const content = read('src/content/github.js');
  const start = content.indexOf('async function stopTimelineEntry(activeEntry)');
  const end = content.indexOf('\n  async function restartTimelineEntry', start);
  assert.ok(start >= 0 && end > start);
  const handler = content.slice(start, end);

  assert.match(handler, /const result = await send\(\{ type: 'STOP'/);
  assert.match(handler, /timelineOptimisticCompletions\.set\(result\.entry\.id/);
  assert.match(handler, /pageState = \{ \.\.\.pageState, active: null \}/);
  assert.match(handler, /refreshMountedTimeline\(\)/);
  assert.doesNotMatch(handler, /recentLoaded = false/);
});

test('full-width timeline places branded navigation above the editor and Stop inside running task details', () => {
  const content = read('src/content/github.js');
  const worker = read('src/background/service-worker.js');
  const timeline = read('src/content/task-timeline-component.js');

  assert.match(content, /timeline-brand/);
  assert.match(content, /timeline-view-modes/);
  assert.match(content, /modeButton\('timeline', 'Timeline'\)/);
  assert.match(content, /modeButton\('calendar', 'Calendar'\)/);
  assert.match(content, /modeButton\('list', 'List'\)/);
  assert.match(content, /timelineInstance\?\.setViewMode\(mode\)/);
  assert.match(content, /compactSurface\.today\.hidden = !list/);
  assert.doesNotMatch(content, /'Not tracking', 'strip-idle'/);
  assert.match(content, /timelineQueueIndicator\.hidden = false/);
  assert.match(content, /timelineQueueIndicator\.classList\.toggle\('empty', empty\)/);
  assert.match(content, /popup-timeline-track/);
  assert.match(content, /button\('Track this task', 'primary popup-timeline-track'/);
  assert.match(content, /\.timeline-toolbar-end \{ justify-self:end; display:flex; align-items:center; gap:12px \}/);
  assert.match(content, /strip\.append\(track\)/);
  assert.match(content, /header\.append\(brand, headerActions, timelineToolbarEnd\)/);
  assert.doesNotMatch(content, /summaryActionLabel: 'Track this task'/);
  assert.match(worker, /message\.timelineTask\s*\?\s*taskUrlForTimelineSwitch/);
  assert.match(content, /onStop: item => stopTimelineEntry/);
  assert.match(content, /type: 'STOP', description: activeDescriptionValue\(activeEntry\)/);
  assert.match(timeline, /Stop \$\{formatClockDuration/);
  assert.doesNotMatch(timeline, /STOP /);
  assert.doesNotMatch(content, /button\('STOP', 'danger timeline-stop'/);
  assert.doesNotMatch(content, /\.timeline-stop \{/);
  assert.match(content, /timeline-queue-spinner[\s\S]*?section\.append\(spinner\)/);
  assert.match(content, /timelineInstance = createTimeline[\s\S]*?timelineInstance\.scrollToEnd\(\)/);
  assert.match(content, /\.timeline-queue-spinner \{ min-height:25px; padding:0 0 10px/);
  assert.match(content, /\.timeline-queue-spinner\.empty \{ visibility:hidden \}/);
  assert.doesNotMatch(content, /trailingActionGutterPx/);
  assert.doesNotMatch(content, /renderItemTrailingAction/);
});

test('timeline exposes Delete and current-page tracking through durable handlers', () => {
  const content = read('src/content/github.js');
  const worker = read('src/background/service-worker.js');
  const timeline = read('src/content/task-timeline-component.js');

  assert.match(timeline, /clockoli-timeline-action danger/);
  assert.match(content, /popup-timeline-track/);
  assert.match(content, /await trackCurrentTimelineTask\(\)/);
  assert.doesNotMatch(content, /summaryActionLabel: 'Track this task'/);
  assert.match(content, /onDelete: async item =>/);
  assert.match(content, /return queueTimelineEntryDelete\(entry\)/);
  assert.match(content, /if \(!confirm\(`Delete this[\s\S]*?\) return false/);
  assert.match(content, /onStart: item => restartTimelineEntry/);
  assert.match(content, /if \(!confirmLongEntry\(\)\) return false/);
  assert.match(content, /type: 'DISCARD_ACTIVE'/);
  assert.match(content, /return queueTimelineEntryDelete\(entry\)/);
  assert.match(content, /popupMode && task \? \{ taskUrl: task\.taskUrl, taskTitle: task\.taskTitle \} : \{\}/,
    'content-panel timeline refreshes must not submit a page-bound task URL after editing another task');
  assert.match(content, /recent = recent\.filter[\s\S]*?beginTimelineQueueAcceptance\(\)[\s\S]*?type: 'QUEUE_ENTRY_DELETE'/,
    'completed time disappears before durable deletion is sent to the worker');
  assert.match(content, /if \(result\?\.operationId\) timelineQueuedOperationIds\.set\(result\.operationId, entry\.id\)/);
  assert.match(timeline, /Delete.*Backspace|Backspace.*Delete/);
  assert.match(worker, /case 'DISCARD_ACTIVE'/);
  assert.match(worker, /tracker\.discardActive\(\{ background: true \}\)/);
  assert.match(worker, /case 'QUEUE_ENTRY_DELETE'/);
  assert.match(worker, /trackerForDestination\(destinationId\)[\s\S]*\.queueEntryDelete\(payload\)/);
  assert.doesNotMatch(content, /The previous version remains in Git history/);
  assert.match(content, /\} else if \(!compact\) \{\s*const startButton = button\(current \? 'Start tracking this task'/,
    'the legacy bottom start button is absent from the full-width compact panel');
  assert.doesNotMatch(content, /if \(!items\.length\).*No tracked time in the last 24 hours/);
  assert.match(content, /Timeline cannot display invalid overlapping entries\. Fix them in Activity/);
});

test('tracking panel exposes a safe, bounded queue diagnostics log', () => {
  const content = read('src/content/github.js');
  const worker = read('src/background/service-worker.js');

  assert.match(content, /const queueDiagnostics = \[\]/);
  assert.match(content, /function recordQueueDiagnostics\(previous, next\)/);
  assert.match(content, /Queue diagnostics/);
  assert.match(content, /data-testid', 'queue-diagnostics'/);
  assert.match(content, /lastError/);
  assert.match(content, /slice\(-40\)/);
  assert.match(content, /Queued start needs attention/);
  assert.match(content, /Retry queued write/);
  assert.match(worker, /queuedAt, retryCount, lastError/);
});

test('daily panel consumes the bundle palette and overlap flags without remounting on refresh', () => {
  const content = read('src/content/github.js');
  assert.match(content, /ClockoliTaskTimeline\?\.createColorResolver/);
  assert.match(content, /data-overlap="true"/);
  assert.match(content, /Fix in Activity/);
  const start = content.indexOf('  function refreshMountedTimeline()');
  const end = content.indexOf('\n\n  function beginTimelineStop', start);
  const refresh = content.slice(start, end);
  assert.match(refresh, /now/);
  assert.match(refresh, /refreshCompactSurface/);
  assert.doesNotMatch(refresh, /destroy|createTimeline/);
  assert.match(content, /describeSaveStatus/);
  assert.match(content, /describeConnectionError/);
  assert.match(content, /diagnostics\.open = false/);
});
