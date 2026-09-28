import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Settings edits ordered Projects with one URL substring per line', () => {
  const html = read('src/options/options.html');
  const script = read('src/options/options.js');
  const css = read('src/options/options.css');
  assert.match(html, /<legend>Projects and routing<\/legend>/);
  assert.match(html, /id="projects-list"/);
  assert.match(html, /id="add-project"/);
  assert.match(html, /id="other-project-name"/);
  assert.match(html, /Tasks that do not match a named project/);
  assert.match(script, /function addProjectRow\(/);
  assert.match(script, /function projectsPayload\(\)/);
  assert.match(script, /function moveProjectRow\(row, direction\)/);
  assert.match(script, /Move project .* up/);
  assert.match(script, /Move project .* down/);
  assert.match(script, /projects: projectsPayload\(\)/);
  assert.match(script, /defaultDestinationId: \$\('default-destination'\)\.value/);
  assert.match(script, /destinationId: rows\[index\]\.querySelector\('\.project-destination'\)\.value/);
  assert.match(script, /otherProjectName: \$\('other-project-name'\)\.value/);
  assert.match(script, /name\.placeholder = 'work'/);
  assert.match(script, /linear\.app\/my-team\/\\ngithub\.com\/my-company\//);
  assert.match(css, /\.project-row/);
  assert.match(css, /\.project-row textarea/);
  assert.match(css, /\.project-row input::placeholder,.project-row textarea::placeholder\{[^}]*opacity:\.55/);
  assert.match(css, /\.project-row\{[^}]*align-items:start/);
  assert.match(css, /\.projects-fieldset\{[^}]*min-width:0/);
  assert.match(css, /\.project-row\{[^}]*min-width:0/);
  assert.match(css, /\.project-row>\*\{min-width:0/);
  assert.match(css, /@media\(max-width:700px\)\{\.project-row\{grid-template-columns:1fr\}\}/);
  assert.match(css, /\.project-row textarea\{[^}]*overflow-y:auto;resize:none/);
  assert.match(css, /\.remove-client\{position:absolute/);
  assert.match(script, /actions\.append\(up, down, remove\)/);
  assert.match(script, /substrings\.rows = Math\.max\(1, /);
  assert.match(css, /\.project-actions\{position:absolute;top:8px;right:8px/);
});

test('saving or importing Projects refreshes already-open tracking and Reports surfaces', () => {
  const worker = read('src/background/service-worker.js');
  const content = read('src/content/github.js');
  const reports = read('src/reports/reports.js');
  assert.match(worker, /function broadcastLocalPreferencesChanged\(revision\)/);
  assert.match(worker, /chrome\.runtime\.sendMessage\(\{ type: 'LOCAL_PREFERENCES_CHANGED'/);
  assert.match(worker, /chrome\.tabs\.query\(\{\}\)[\s\S]*chrome\.tabs\.sendMessage\(tab\.id, \{ type: 'LOCAL_PREFERENCES_CHANGED'/);
  assert.match(worker, /UPDATE_DISPLAY_PREFERENCES[\s\S]*broadcastLocalPreferencesChanged/);
  assert.match(worker, /IMPORT_SETTINGS[\s\S]*broadcastLocalPreferencesChanged/);
  assert.match(content, /function handleLocalPreferencesChanged[\s\S]*LOCAL_PREFERENCES_CHANGED[\s\S]*GET_PAGE_STATE/);
  assert.match(reports, /message\?\.type === 'LOCAL_PREFERENCES_CHANGED'[\s\S]*refreshProjectDefinitions/);
});
