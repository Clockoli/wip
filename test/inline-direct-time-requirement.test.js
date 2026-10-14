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
  const timePicker = source.slice(source.indexOf('function timePicker('), source.indexOf('function timestampAtOriginalOffset('));
  assert.doesNotMatch(timePicker, /addEventListener\('wheel'/);
  assert.doesNotMatch(source, /WHEEL_THRESHOLD|wheelRemainder|time-step/);
  assert.doesNotMatch(source, /ArrowUp|ArrowDown|PageUp|PageDown/);
});

test('Activity begins with a compact range and reveals direct time editing on demand', () => {
  assert.match(source, /const time = el\('span', recentTimeText\(entry\), 'entry-time-range entry-time-display'\)/);
  assert.match(source, /record\.classList\.add\('entry-editing'\)/);
  assert.match(source, /timeRow\.append\(time, inline\.node, inline\.duration, actions\)/);
  assert.match(source, /actions\.append\(edit, inline\.cancel, inline\.save, remove\)/);
  assert.match(source, /\.entry-time-row \{[^}]*justify-content:flex-start[^}]*white-space:nowrap/);
});

test('grouped inline save uses the durable queue route', () => {
  assert.equal(assertMessageAllowed('QUEUE_ENTRIES_EDIT', contentSender, origin), 'content');
  assert.equal(assertMessageAllowed('QUEUE_ENTRIES_EDIT', extensionSender, origin), 'extension');
  assert.match(source, /type: 'QUEUE_ENTRIES_EDIT'/);
  assert.doesNotMatch(source, /type: 'EDIT_ENTRIES'/);
  assert.throws(() => assertMessageAllowed('MOVE_BOUNDARY', contentSender, origin), /not allowed/i);
  assert.throws(() => assertMessageAllowed('MOVE_BOUNDARY', extensionSender, origin), /not allowed/i);
  assert.match(serviceWorker, /case 'QUEUE_ENTRIES_EDIT': \{[\s\S]*destinationIdForCompletedMutation\(message\.type, message\.payload, sender, extensionOrigin\)[\s\S]*const \{ destinationId: _destinationId, \.\.\.payload \} = message\.payload;[\s\S]*trackerForDestination\(destinationId, \{ localOnly: true \}\)\)\.queueEntriesEdit\(payload\)[\s\S]*requestPendingSync\(\)[\s\S]*return \{ \.\.\.result, destinationId \}/);
  assert.doesNotMatch(serviceWorker, /case 'MOVE_BOUNDARY'/);
});

test('legacy queued-edit conflicts remain recoverable when the page projection has only a stage', () => {
  assert.match(source, /\['editEntry', 'editEntries'\]\.includes\(item\.operation \?\? item\.stage\)/);
  assert.match(source, /Saved edit needs review/);
  assert.match(source, /Retry saved edit/);
  assert.match(source, /Discard queued edit/);
});
