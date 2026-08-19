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
  for (const type of ['LOAD_RECENT', 'EDIT_ENTRY', 'MOVE_BOUNDARY', 'DELETE_ENTRY', 'RESOLVE_PENDING', 'SYNC', 'OPEN_OPTIONS']) assert.match(source, new RegExp(type));
  assert.doesNotMatch(source, /type:\s*['"]GET_STATE['"]/);
  assert.doesNotMatch(source, /token/i);
});


test('time adjustment controls require trusted pointer input and keyboard support', () => {
  assert.match(source, /pointerdown/);
  assert.match(source, /pointermove/);
  assert.match(source, /pointerup/);
  assert.match(source, /ArrowLeft/);
  assert.match(source, /ArrowRight/);
  assert.match(source, /12 \* 60/);
});
