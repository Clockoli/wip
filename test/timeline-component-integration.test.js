import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../', import.meta.url);
const read = relative => fs.readFileSync(new URL(relative, root), 'utf8');

test('GitHub panel uses the standalone Elastic Timeline Editor and has no legacy timeline experiment', () => {
  const manifest = JSON.parse(read('manifest.json'));
  const content = read('src/content/github.js');

  assert.deepEqual(manifest.content_scripts[0].js, [
    'src/domain/recovery-actions.js',
    'src/content/elastic-timeline-editor.js',
    'src/content/github.js',
  ]);
  assert.ok(manifest.web_accessible_resources[0].resources.includes('src/content/elastic-timeline-editor.css'));
  assert.match(content, /globalThis\.ElasticTimelineEditor\?\.createElasticTimeline/);
  assert.match(content, /items,\s*now,\s*[\s\S]*?snapMs: 1_000,\s*view: timelineView/);
  assert.match(read('src/content/elastic-timeline-editor.js'), /var ElasticTimelineEditor/);
  assert.doesNotMatch(read('src/content/elastic-timeline-editor.js'), /\bexport\s*\{/);
  assert.doesNotMatch(content, /ClockoliElasticTimeline/);
  assert.doesNotMatch(content, /elastic-timeline-core/);
  assert.doesNotMatch(content, /onMove: async/);
  assert.doesNotMatch(content, /onResize: async/);
  assert.doesNotMatch(content, /async function saveCalendarEntry/);
  assert.doesNotMatch(content, /type: 'EDIT_ACTIVE_START'/);
  assert.match(content, /type: 'QUEUE_ENTRY_EDIT'/);
  assert.match(content, /type: 'QUEUE_ACTIVE_START_EDIT'/);
  assert.match(content, /timeline-queue-spinner/);
  assert.match(content, /timeline-queue-count/);
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
  assert.match(content, /function refreshTimelineQueueIndicator\(\) \{[\s\S]*?timelineQueueIndicator\.hidden = count === 0[\s\S]*?label\.textContent = count > 0 \? String\(count\) : ''/);
  assert.match(content, /\.timeline-queue-spinner\[hidden\] \{ display:none !important \}/);
  assert.match(content, /recordTimelineQueueDiagnostic\('Edit time entry: accepted locally and queued for GitHub\.'/);
  assert.match(content, /recent\.filter\(entry => entry\._path && \(entry\._sha \|\| entry\._pending\)/);
  assert.match(content, /applyTimelineOptimisticEntry\(entry, \{ startedAt: entry\.startedAt, endedAt: entry\.endedAt \}\)/);
  assert.match(content, /function timelineQueueSize\(\) \{ return Math\.max\(Number\(pageState\.pendingCount\) \|\| 0, timelineQueuedOperationIds\.size \+ timelineQueueAcceptances\.size\); \}/);
  assert.match(content, /finishTimelineQueueAcceptance\(acceptanceId\);\s*refreshTimelineQueueIndicator\(\);\s*if \(!refreshMountedTimeline\(\)\) renderUi\(\);/);
  assert.match(content, /type: 'QUEUE_ENTRY_EDIT'/);
  assert.match(content, /timelineQueuedOperationIds\.set/);
  assert.match(content, /timeline-queue-spinner/);
  assert.match(content, /timeline-queue-count/);
  assert.doesNotMatch(content, /async function saveCalendarEntry/);
  assert.doesNotMatch(content, /timelineSaving = true; suppressRecentRender = true/);
});

test('timeline task switching is optimistic and keeps the queued completion visible', () => {
  const content = read('src/content/github.js');

  assert.match(content, /isPending: Boolean\(entry\._pending\)/);
  assert.match(content, /const acceptedActive = \{[\s\S]*?_pending: true/);
  assert.match(content, /function refreshMountedTimelineAtRightEdge\(startedAt\)/);
  assert.match(content, /pageState = \{ \.\.\.pageState, active: acceptedActive \};\s*refreshTimelineQueueIndicator\(\);\s*if \(!refreshMountedTimelineAtRightEdge\(startedAt\)\) renderUi\(\);/);
  assert.match(content, /function refreshMountedTimelineAtRightEdge[\s\S]*?timelineWindow = \{ \.\.\.timelineWindow, now \};[\s\S]*?timelineView = \{ start: now - span, end: now, focusedAt: now \};[\s\S]*?timelineInstance\.update\(\{ items, now, view: timelineView \}\)/);
  assert.match(content, /type: 'SWITCH_TASK', timelineTask: true/);
  assert.match(content, /const timelineOptimisticCompletions = new Map\(\)/);
  assert.match(content, /function mergeTimelineCompletedEntries\(completed, optimisticCompletions\)/);
  assert.match(content, /mergeTimelineCompletedEntries\(completed, timelineOptimisticCompletions\.values\(\)\)/);
  assert.match(content, /timelineStartInFlight/);
  assert.match(content, /isStartDisabled: timelineStartInFlight \|\|/);
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

test('timeline block identity stays stable when edits change chronological order', () => {
  const content = read('src/content/github.js');

  assert.match(content, /const stableId = entry\.id \|\| `\$\{entry\._path\}:\$\{entry\._index\}`/);
  assert.match(content, /const id = `\$\{entry\._active \? 'active' : 'entry'\}:\$\{stableId\}`/);
  assert.doesNotMatch(content, /`\$\{entry\._path\}:\$\{entry\._index\}:\$\{index\}`/);
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

  assert.match(content, /const preserveFullWidthTimeline = Boolean\(fullWidthPopupOpen && timelineInstance && timelineWindow\)/);
  assert.match(content, /if \(!preserveFullWidthTimeline\) \{\s*timelineInstance\?\.destroy\(\)/);
  assert.match(content, /if \(fullWidthPopupOpen\) \{\s*if \(preserveFullWidthTimeline\) refreshMountedTimeline\(\);\s*else renderFullWidthPopup\(style\);/);
  assert.doesNotMatch(content, /if \(fullWidthPopupOpen\) renderFullWidthPopup\(style\)/);
});

test('timeline STOP keeps the completed block and its connectors visible through queue sync', () => {
  const content = read('src/content/github.js');
  const start = content.indexOf('onStop: async item =>');
  const end = content.indexOf('\n        onStart:', start);
  assert.ok(start >= 0 && end > start);
  const handler = content.slice(start, end);

  assert.match(handler, /const result = await send\(\{ type: 'STOP'/);
  assert.match(handler, /timelineOptimisticCompletions\.set\(result\.entry\.id/);
  assert.match(handler, /pageState = \{ \.\.\.pageState, active: null \}/);
  assert.match(handler, /refreshMountedTimeline\(\)/);
  assert.doesNotMatch(handler, /recentLoaded = false/);
});

test('full-width timeline places branded navigation above the editor and STOP inside running task details', () => {
  const content = read('src/content/github.js');
  const worker = read('src/background/service-worker.js');

  assert.match(content, /timeline-brand/);
  assert.match(content, /header\.append\(brand, headerActions, close\)/);
  assert.match(worker, /message\.timelineTask\s*\?\s*taskUrlForTimelineSwitch/);
  assert.match(content, /onStop: async item =>/);
  assert.match(content, /type: 'STOP', description: activeEntry\?\.description \|\| ''/);
  assert.doesNotMatch(content, /button\('STOP', 'danger timeline-stop'/);
  assert.doesNotMatch(content, /\.timeline-stop \{/);
  assert.match(content, /timeline-queue-spinner[\s\S]*?section\.append\(spinner\)/);
  assert.match(content, /\.popup-timeline-section > \.timeline-queue-spinner \{ position:absolute; top:8px; right:16px/);
  assert.doesNotMatch(content, /trailingActionGutterPx/);
  assert.doesNotMatch(content, /renderItemTrailingAction/);
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
