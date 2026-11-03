import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/ui/add-time.js', import.meta.url), 'utf8');

test('Add time does not memoize failed, incomplete, or cleared search text', () => {
  const start = source.indexOf('const onSearchInput = () => {');
  const onInput = source.slice(start, source.indexOf('const taskSearch =', start));
  assert.match(onInput, /if \(!query\) lastSearch = ''/);
  assert.match(onInput, /!searchIncomplete && taskSearch\.matches/);
  assert.match(onInput, /searchIncomplete = Boolean\(data\.partial \|\| data\.conflicts\?\.length\)/);
  assert.match(onInput, /if \(searchIncomplete\)[\s\S]*?lastSearch = ''/);
  assert.match(onInput, /catch \(cause\)[\s\S]*?lastSearch = ''; searchIncomplete = true/);
});
