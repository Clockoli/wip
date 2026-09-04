import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const worker = await readFile(new URL('../src/background/service-worker.js', import.meta.url), 'utf8');
const preview = await readFile(new URL('../src/clockify-migration/preview.js', import.meta.url), 'utf8');

test('Clockify migration progress uses a preview-only Port rather than a runtime broadcast', () => {
  assert.match(worker, /CLOCKIFY_MIGRATION_PROGRESS_V1/);
  assert.match(worker, /chrome\.runtime\.onConnect\.addListener/);
  assert.match(worker, /const previewUrl = chrome\.runtime\.getURL\('src\/clockify-migration\/preview\.html'\)/);
  assert.match(worker, /port\.sender\?\.url !== previewUrl/);
  assert.match(worker, /port\.postMessage\(\{/);
  assert.doesNotMatch(worker, /chrome\.runtime\.sendMessage\(\{\s*type: 'CLOCKIFY_MIGRATION_PROGRESS'/);
  assert.match(preview, /chrome\.runtime\.connect\(\{ name: 'CLOCKIFY_MIGRATION_PROGRESS_V1' \}\)/);
  assert.match(preview, /crypto\.randomUUID\(\)/);
});
