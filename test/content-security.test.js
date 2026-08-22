import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/content/github.js', import.meta.url), 'utf8');

test('GitHub page cannot reach or synthesize privileged panel controls', () => {
  assert.match(source, /attachShadow\(\{ mode: 'closed' \}\)/);
  assert.doesNotMatch(source, /attachShadow\(\{ mode: 'open' \}\)/);
  assert.ok((source.match(/event\.isTrusted/g) || []).length >= 3, 'shared button, form, and menu trigger gates require trusted interaction');
  assert.doesNotMatch(source, /addEventListener\(['"](?:turbo:load|pjax:end)/, 'page-synthesizable navigation events must not trigger authenticated refreshes');
  assert.doesNotMatch(source, /location\.href\s*!==/, 'query/hash churn must not count as issue navigation');
  assert.match(source, /GET_PAGE_STATE', refresh \}/, 'navigation refresh policy must be explicit rather than always remote');
});

test('time tracker uses a native-style GitHub header menu instead of a floating corner card', () => {
  assert.match(source, /\.AppHeader-actions/);
  assert.match(source, /img\.avatar/);
  assert.match(source, /octicon-stopwatch/);
  assert.match(source, /icon\('triangle-down'/);
  assert.match(source, /aria-expanded/);
  assert.doesNotMatch(source, /position:\s*fixed;\s*right:20px;\s*bottom:20px/);
});

test('header menu exposes recent-entry management without exposing the token', () => {
  for (const type of ['LOAD_RECENT', 'EDIT_ENTRY', 'DELETE_ENTRY', 'RESOLVE_PENDING', 'SYNC', 'OPEN_REPORTS', 'OPEN_OPTIONS']) assert.match(source, new RegExp(type));
  assert.doesNotMatch(source, /MOVE_BOUNDARY|time-boundary/, 'the main panel no longer exposes between-row drag mutations');
  assert.doesNotMatch(source, /type:\s*['"]GET_STATE['"]/);
  assert.doesNotMatch(source, /token/i);
});


test('time adjustment controls use focused wheel and keyboard input without page-level drag handlers', () => {
  assert.match(source, /addEventListener\('wheel'/);
  assert.match(source, /passive: false/);
  assert.match(source, /field\.getRootNode\?\.\(\)/);
  assert.match(source, /root\?\.activeElement \?\? document\.activeElement/);
  assert.match(source, /ArrowUp/);
  assert.match(source, /ArrowDown/);
  assert.match(source, /PageUp/);
  assert.match(source, /PageDown/);
  assert.match(source, /event\.preventDefault\(\)[\s\S]*wheelRemainder \+=/, 'a focused valid time field contains sub-threshold wheel movement');
  assert.doesNotMatch(source, /pointerdown|pointermove|pointerup|time-drag/);
});

test('successful Sync and refresh clears a stale boundary conflict message', () => {
  assert.match(source, /errorText = ''; renderUi\(\); await send\(\{ type: 'SYNC' \}\)[\s\S]*refreshState\(true, true\)/);
});


test('grouped recent records reveal contextual actions and large accessible time controls without boundary elements', () => {
  assert.match(source, /entry-actions/);
  assert.match(source, /entry-delete/);
  assert.match(source, /\.entry-actions\s*\{[^}]*opacity:0[^}]*pointer-events:none/);
  assert.match(source, /\.entry-record:hover \.entry-actions,\.entry-record:focus-within \.entry-actions,\.entry-actions\.dirty\s*\{[^}]*opacity:1[^}]*pointer-events:auto/);
  assert.match(source, /\.time-value\s*\{[^}]*font:700 26px/);
  assert.match(source, /\.time-step\s*\{[^}]*opacity:0[^}]*pointer-events:none/);
  assert.match(source, /\.time-unit:focus-within \.time-step\s*\{[^}]*opacity:1[^}]*pointer-events:auto/);
  assert.match(source, /aria-label', `\$\{label\} hour`/);
  assert.match(source, /aria-label', `\$\{label\} minute`/);
  assert.doesNotMatch(source, /time-boundary|bindBoundaryVisibility|drag-line|drag-grip/);
});
