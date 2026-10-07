import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/content/github.js', import.meta.url), 'utf8');
const worker = await readFile(new URL('../src/background/service-worker.js', import.meta.url), 'utf8');
const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));

test('content-script favicon URLs are exposed as extension resources', () => {
  assert.ok(manifest.permissions.includes('favicon'));
  assert.ok(manifest.web_accessible_resources.some(entry => entry.matches.includes('<all_urls>') && entry.resources.includes('_favicon/*')));
});

test('GitHub page cannot reach or synthesize privileged panel controls', () => {
  assert.match(source, /attachShadow\(\{ mode: 'closed' \}\)/);
  assert.doesNotMatch(source, /attachShadow\(\{ mode: 'open' \}\)/);
  assert.ok((source.match(/event\.isTrusted/g) || []).length >= 3, 'shared button, form, and menu trigger gates require trusted interaction');
  assert.doesNotMatch(source, /addEventListener\(['"](?:turbo:load|pjax:end)/, 'page-synthesizable navigation events must not trigger authenticated refreshes');
  assert.doesNotMatch(source, /location\.href\s*!==/, 'query/hash churn must not count as issue navigation');
  assert.match(source, /GET_PAGE_STATE', refresh \}/, 'navigation refresh policy must be explicit rather than always remote');
});

test('persistent storage stays behind IndexedDB without a chrome.storage surface', () => {
  assert.equal(manifest.permissions.includes('storage'), false);
  assert.doesNotMatch(worker, /chrome\.storage/);
  assert.doesNotMatch(source, /chrome\.storage/);
});

test('time tracker uses one native-style GitHub header button without a floating corner card or dropdown', () => {
  assert.match(source, /\.AppHeader-actions/);
  assert.match(source, /img\.avatar/);
  assert.match(source, /clockoli-mark/);
  assert.doesNotMatch(source, /icon\('triangle-down'|trigger-menu|navigation-menu/);
  assert.match(source, /await toggleFullWidthPopup\(\)/);
  assert.match(source, /aria-expanded/);
  assert.doesNotMatch(source, /position:\s*fixed;\s*right:20px;\s*bottom:20px/);
});

test('header menu exposes queued recent-entry management without exposing the token', () => {
  for (const type of ['LOAD_RECENT', 'QUEUE_ENTRIES_EDIT', 'DELETE_ENTRY', 'RESOLVE_PENDING', 'SYNC', 'OPEN_REPORTS', 'OPEN_TIMES', 'OPEN_OPTIONS']) assert.match(source, new RegExp(type));
  assert.doesNotMatch(source, /MOVE_BOUNDARY|time-boundary/, 'the main panel no longer exposes between-row drag mutations');
  assert.doesNotMatch(source, /type:\s*['"]GET_STATE['"]/);
  assert.doesNotMatch(source, /token/i);
});


test('time inputs are direct text controls without wheel, keyboard stepping, or drag handlers', () => {
  const timePicker = source.slice(source.indexOf('  function timePicker('), source.indexOf('  function timestampAtOriginalOffset('));
  assert.match(source, /hourField\.addEventListener\('input', changed\)/);
  assert.match(source, /minuteField\.addEventListener\('input', changed\)/);
  assert.doesNotMatch(timePicker, /addEventListener\('wheel'|passive: false|wheelRemainder|WHEEL_THRESHOLD/);
  assert.doesNotMatch(timePicker, /ArrowUp|ArrowDown|PageUp|PageDown|time-step|time-unit/);
  assert.doesNotMatch(timePicker, /pointerdown|pointermove|pointerup|time-drag/);
});

test('successful Sync and refresh clears a stale boundary conflict message', () => {
  assert.match(source, /errorText = ''; renderUi\(\); await send\(\{ type: 'SYNC' \}\)[\s\S]*refreshState\(true, true\)/);
});


test('grouped recent records reveal contextual actions and accessible direct time fields without boundary elements', () => {
  assert.match(source, /entry-actions/);
  assert.match(source, /entry-delete/);
  assert.match(source, /\.entry-actions\s*\{[^}]*opacity:0[^}]*pointer-events:none/);
  assert.match(source, /\.entry-record:hover \.entry-actions,\.entry-record:focus-within \.entry-actions,\.entry-actions-visible\s*\{[^}]*opacity:1[^}]*pointer-events:auto/);
  assert.match(source, /\.compact-time-picker \.time-value\s*\{[^}]*width:34px[^}]*height:32px/);
  assert.match(source, /aria-label', `\$\{label\} hour`/);
  assert.match(source, /aria-label', `\$\{label\} minute`/);
  assert.doesNotMatch(source, /time-step|time-unit|time-boundary|bindBoundaryVisibility|drag-line|drag-grip/);
});
