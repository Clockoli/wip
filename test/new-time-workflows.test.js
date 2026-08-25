import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = relative => fs.readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
const content = read('src/content/github.js');
const policy = read('src/background/message-policy.js');
const worker = read('src/background/service-worker.js');
const tasksHtml = read('src/tasks/tasks.html');
const tasksJs = read('src/tasks/tasks.js');
const popupCss = read('src/popup/popup.css');
const validator = read('scripts/validate-extension.js');
const manifest = JSON.parse(read('manifest.json'));
const packageJson = JSON.parse(read('package.json'));
const plan = read('IMPLEMENTATION_PLAN.md');

test('main tracker uses one inline editor with Enter-save and no legacy Edit panel', () => {
  assert.match(content, /event\.key === 'Enter'[\s\S]*saveGroup\(\)/);
  assert.match(content, /entry-description-editable/);
  assert.match(content, /inline-task-url/);
  assert.match(content, /inline-task-title/);
  assert.match(content, /inline-description/);
  assert.match(content, /cancelActiveInlineDraft/);
  assert.doesNotMatch(content, /function renderEditor\b|button\('Edit'|\beditingDraft\b|\bediting =/);
  assert.doesNotMatch(policy, /'EDIT_ENTRY'/);
  assert.doesNotMatch(worker, /message\.type === 'EDIT_ENTRY'/);
});

test('Times page is a packaged shared-renderer surface with requested periods, filtering, bulk input, and navigation', () => {
  for (const file of ['src/times/times.html', 'src/times/times.css']) assert.equal(fs.existsSync(new URL(`../${file}`, import.meta.url)), true, `${file} must exist`);
  const html = read('src/times/times.html');
  assert.match(html, /clockoli-times-root/);
  assert.match(content, /const timesMode/);
  for (const value of ['today', 'yesterday', 'this-week', 'last-week', 'this-month', 'last-month', 'custom']) {
    assert.match(content, new RegExp(`['\"]${value}['\"]`));
  }
  assert.match(content, /Filter by URL or optional title/);
  assert.match(content, /View activity/);
  assert.match(content, /button\('Activity'/);
  assert.match(content, /BULK_ADD_TIMES/);
  assert.match(policy, /'OPEN_TIMES'/);
  assert.match(policy, /'LOAD_TIMES'/);
  assert.match(policy, /'BULK_ADD_TIMES'/);
  assert.match(worker, /src\/times\/times\.html/);
  assert.match(worker, /message\.type === 'LOAD_TIMES'/);
  assert.match(worker, /case 'BULK_ADD_TIMES'/);
  assert.match(worker, /async function loadTimes[\s\S]*new AbortController\(\)[\s\S]*includeStorageMetadata: true, signal: controller\.signal/);
  assert.match(worker, /async function loadTimes\(message, sender\)[\s\S]*sender\?\.documentId \?\? sender\?\.tab\?\.id[\s\S]*:times:\$\{requestOwner\}/);
  assert.match(worker, /message\.type === 'LOAD_TIMES'\) return loadTimes\(message, sender\)/);
  assert.match(content, /function refreshRecent\(force = false\)[\s\S]*loadId === recentLoadId/);
  assert.match(content, /loadSelectedTimes[\s\S]*refreshRecent\(true\)/);
});

test('status filtering and status-shaped task DTOs are removed while URL/title filtering remains', () => {
  assert.match(tasksHtml, /Filter by URL or optional title/);
  assert.doesNotMatch(tasksHtml, /id="status"|<label>Status|value="open"|value="closed"/i);
  assert.doesNotMatch(tasksJs, /statusMatches|statusLabel|taskVisualStatus|task\.status|stateReason/);
  assert.doesNotMatch(read('src/services/task-metadata.js'), /details\.status|details\.stateReason/);
  assert.doesNotMatch(read('src/api/github-client.js'), /title state stateReason url|metadata\.set\([^\n]+status/);
});

test('browser action popup has a stable width without the self-shrinking viewport media query', () => {
  assert.match(popupCss, /width:420px/);
  assert.doesNotMatch(popupCss, /width:100vw/);
  assert.doesNotMatch(popupCss, /@media\(max-width:380px\)/);
});


test('Times is covered by extension-page validation and candidate versions are distinct and aligned', () => {
  assert.equal(manifest.version, '0.1.24');
  assert.equal(packageJson.version, manifest.version);
  assert.match(validator, /manifest\.version !== packageJson\.version/);
  assert.ok((validator.match(/'src\/times\/times\.html'/g) || []).length >= 2,
    'Times must be checked for existence and extension-page HTML security');
});

test('acceptance plan matches URL-first tracking and Top tasks Activity Reports navigation', () => {
  assert.match(plan, /any GitHub HTTP\(S\) task URL/);
  assert.match(plan, /Top tasks\/Activity\/Reports navigation/);
  assert.doesNotMatch(plan, /timer management only on issue\/PR pages|Reports\/Tasks navigation everywhere/);
});
