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

test('Clockify capture control messages bypass unrelated serialized work', () => {
  assert.match(worker, /const direct = readOnly \|\| DIRECT_DEVICE_FLOW_MESSAGES\.has\(message\?\.type\)\n\s*\|\| \['CLOCKIFY_ARM_CAPTURE', 'CLOCKIFY_ARM_CSV_CAPTURE', 'CLOCKIFY_IS_CAPTURE_ARMED', 'CLOCKIFY_DISARM_CAPTURE', 'CLOCKIFY_YEAR_OBSERVED', 'CLOCKIFY_CAPTURED_CSV', 'CLOCKIFY_CAPTURED_REPORT'\]\.includes\(message\?\.type\)/);
});

test('CSV and final DOM report pages enter the same annual history-to-preview pipeline after validating annual data', () => {
  assert.match(worker, /if \(scan\?\.phase !== 'capturing'\) throw new Error\('Clockify CSV history capture plan is unavailable'\);\n\s*assertClockifyAnnualDataYear\(normalized, year\);\n\s*return completeClockifyCapture\(\{ tabId: sender\.tab\.id, year, data: normalized \}\);/);
  assert.match(worker, /if \(scan\?\.phase !== 'capturing'\) throw new Error\('Clockify history capture plan is unavailable'\);\n\s*assertClockifyAnnualDataYear\(normalized, year\);[\s\S]*if \(!report\.complete\) return \{ nextPage: true \};\n\s*stage = 'collecting_history';\n\s*console\.info\('\[Clockoli Clockify capture background\]', stage\);\n\s*return completeClockifyCapture\(\{ tabId: sender\.tab\.id, year, data: report\.data \}\);/);
});
