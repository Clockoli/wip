import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/content/github.js', import.meta.url), 'utf8');

test('GitHub page cannot reach or synthesize privileged panel controls', () => {
  assert.match(source, /attachShadow\(\{ mode: 'closed' \}\)/);
  assert.doesNotMatch(source, /attachShadow\(\{ mode: 'open' \}\)/);
  assert.ok((source.match(/event\.isTrusted/g) || []).length >= 3, 'all three privileged page controls require trusted clicks');
  assert.doesNotMatch(source, /addEventListener\(['"](?:turbo:load|pjax:end)/, 'page-synthesizable navigation events must not trigger authenticated refreshes');
  assert.doesNotMatch(source, /location\.href\s*!==/, 'query/hash churn must not count as issue navigation');
  assert.match(source, /GET_PAGE_STATE', refresh \}/, 'navigation refresh policy must be explicit rather than always remote');
});
