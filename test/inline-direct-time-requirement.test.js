import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assertMessageAllowed } from '../src/background/message-policy.js';

const source = await readFile(new URL('../src/content/github.js', import.meta.url), 'utf8');
const serviceWorker = await readFile(new URL('../src/background/service-worker.js', import.meta.url), 'utf8');
const origin = 'chrome-extension://abc/';
const contentSender = { url: 'https://github.com/acme/app/issues/7', tab: { id: 7 } };
const extensionSender = { url: `${origin}src/popup/popup.html` };

test('recent rows keep direct Start/Stop editing without wheel or step controls', () => {
  assert.match(source, /function inlineTimeEditor\(/);
  assert.match(source, /inline-time-value/);
  assert.match(source, /startPicker = timePicker\('Start'[\s\S]*compact: true/);
  assert.match(source, /stopPicker = timePicker\('Stop'[\s\S]*compact: true/);
  assert.doesNotMatch(source, /addEventListener\('wheel'|WHEEL_THRESHOLD|wheelRemainder|time-step/);
  assert.doesNotMatch(source, /ArrowUp|ArrowDown|PageUp|PageDown/);
});

test('inline range, duration, and contextual actions share the left-aligned row', () => {
  assert.match(source, /timeRow\.append\(inline\.node, inline\.duration, actions\)/);
  assert.match(source, /\.entry-time-row \{[^}]*justify-content:flex-start[^}]*white-space:nowrap/);
  assert.doesNotMatch(source, /\.entry-actions \{[^}]*margin-left:auto/);
  assert.match(source, /actions\.append\(inline\.cancel, inline\.save, edit, remove\)/);
});

test('grouped inline save is exposed only through the needed message route', () => {
  assert.equal(assertMessageAllowed('EDIT_ENTRIES', contentSender, origin), 'content');
  assert.equal(assertMessageAllowed('EDIT_ENTRIES', extensionSender, origin), 'extension');
  assert.throws(() => assertMessageAllowed('MOVE_BOUNDARY', contentSender, origin), /not allowed/i);
  assert.throws(() => assertMessageAllowed('MOVE_BOUNDARY', extensionSender, origin), /not allowed/i);
  assert.match(serviceWorker, /case 'EDIT_ENTRIES': return tracker\.editEntries\(message\.payload\)/);
  assert.doesNotMatch(serviceWorker, /case 'MOVE_BOUNDARY'/);
});
