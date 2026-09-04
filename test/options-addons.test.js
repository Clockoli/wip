import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/options/options.html', import.meta.url), 'utf8');
const script = await readFile(new URL('../src/options/options.js', import.meta.url), 'utf8');
const descriptor = await readFile(new URL('../src/addons/clockify/descriptor.js', import.meta.url), 'utf8');

test('Settings renders descriptor-driven Clockify migration enablement controls and explicit messages', () => {
  assert.match(source, /id="addons-settings"/);
  assert.match(source, /id="clockify-addon-enabled"/);

  assert.match(descriptor, /https:\/\/app\.clockify\.me\/\*/);
  assert.match(descriptor, /import_completed_records/);
  for (const type of ['GET_ADDON_SETTINGS', 'SET_ADDON_ENABLED']) assert.match(script, new RegExp(type));
  assert.doesNotMatch(source, /project mapping|synthetic tasks/i);
  assert.doesNotMatch(script, /CLOCKIFY_MAPPING_SETTINGS|clockify-project|synthetic.tasks/i);
});

test('Clockify settings never offer provider credential or raw report inputs', () => {
  const addons = source.slice(source.indexOf('id="addons-settings"'), source.indexOf('<details id="advanced-settings"'));
  assert.doesNotMatch(addons, /type="password"|api[ -]?key|Clockify token|access token|session|raw report/i);
});

test('Clockify optional-host access is requested from its Enable button gesture', () => {
  const handler = script.slice(script.indexOf("$('clockify-addon-enabled').addEventListener"));
  assert.match(handler, /chrome\.permissions\.request\(\{ origins: \['https:\/\/app\.clockify\.me\/\*'\] \}\)/);
  assert.ok(handler.indexOf('chrome.permissions.request') < handler.indexOf("type: 'SET_ADDON_ENABLED'"));
});

test('Clockify settings link to the Detailed Report only after enablement and host grant', () => {
  assert.match(source, /id="clockify-migration"/);
  assert.match(source, /id="clockify-detailed-report-link"[^>]*hidden/);
  assert.match(source, /href="https:\/\/app\.clockify\.me\/reports\/detailed"/);
  assert.match(source, /target="_blank" rel="noreferrer"/);
  assert.match(script, /clockify-detailed-report-link'\)\.hidden = !\(enabled && hasClockifyAccess\)/);
  assert.match(script, /chrome\.permissions\.contains\(\{ origins: \['https:\/\/app\.clockify\.me\/\*'\] \}\)/);
});
