import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../src/tasks/tasks.html', import.meta.url), 'utf8');
const js = fs.readFileSync(new URL('../src/tasks/tasks.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/tasks/tasks.css', import.meta.url), 'utf8');
const worker = fs.readFileSync(new URL('../src/background/service-worker.js', import.meta.url), 'utf8');
const content = fs.readFileSync(new URL('../src/content/github.js', import.meta.url), 'utf8');
const manifest = fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8');
const popup = fs.readFileSync(new URL('../src/popup/popup.html', import.meta.url), 'utf8');

test('tasks page is a recent tracked-work list without GitHub issue-list clutter', () => {
  assert.match(html, /<h1>Recently tracked work<\/h1>/);
  assert.match(html, /class="brand-name">RepoClock<\/div>/);
  assert.match(html, /<header class="app-header">[\s\S]*RepoClock[\s\S]*<h1>Recently tracked work<\/h1>[\s\S]*<\/header>/);
  assert.doesNotMatch(html, /id="source"/);
  assert.doesNotMatch(js, /result\.sourceRepository|result\.branch/);
  assert.doesNotMatch(html, /class="eyebrow"/);
  for (const id of ['period', 'task-filter', 'result-count', 'task-list']) assert.match(html, new RegExp(`id="${id}"`));
  for (const value of ['two-weeks', 'one-month', 'three-months', 'six-months', 'one-year']) assert.match(html, new RegExp(`value="${value}"`));
  assert.doesNotMatch(html, /id="status"|<label>Status/i);
  assert.doesNotMatch(html, /magnif|octicon-search|pagination|Sort|Assigned to me/i);
  assert.doesNotMatch(html, /labels|comments|assignee/i);
  assert.doesNotMatch(html, /id="settings"/);
  assert.match(js, /const PERIOD_KEY = 'repoclock\.tasks\.period'/);
  assert.match(js, /const LEGACY_PERIOD_KEY = 'github-private-time-tracker\.tasks\.period'/);
  assert.match(js, /localStorage\.getItem\(PERIOD_KEY\) \|\| localStorage\.getItem\(LEGACY_PERIOD_KEY\)/);
  assert.match(js, /localStorage\.setItem\(PERIOD_KEY/);
  assert.match(js, /addEventListener\('input'/);
  assert.match(js, /type:\s*'LOAD_TASKS'/);
  assert.match(js, /type:\s*'START'/);
  assert.match(js, /type:\s*'STOP'/);
  assert.doesNotMatch(js, /innerHTML|outerHTML|eval\s*\(|new Function/);
  assert.match(css, /\.task-row/);
  assert.match(js, /className = 'task-url'/);
  assert.match(js, /className = 'task-title'/);
  assert.match(css, /\.task-url\{[^}]*text-overflow:ellipsis[^}]*white-space:nowrap/);
  assert.match(css, /\.task-title\{[^}]*color:var\(--fgColor-accent\)/);
  assert.match(css, /\.task-copy\.untitled \.task-url\{[^}]*overflow:hidden[^}]*text-overflow:ellipsis[^}]*white-space:nowrap/,
    'an untitled maximum-length URL remains a single clamped primary link');
  assert.match(js, /url\.title = task\.taskUrl/,
    'the full untitled URL remains available without expanding the row');
  assert.match(css, /\.task-title\{[^}]*-webkit-line-clamp:2/,
    'maximum-length task titles are limited to two result lines');
  assert.match(js, /title\.title = task\.title/,
    'the full clamped task title remains available without expanding the row');
});

test('visible extension branding is RepoClock and Tasks uses neutral GitHub buttons', () => {
  for (const surface of [manifest, popup, html, content]) {
    assert.doesNotMatch(surface, /GitHub Private Time Tracker|Private Time Tracker/);
  }
  assert.match(manifest, /"name":\s*"RepoClock"/);
  assert.match(manifest, /"default_title":\s*"RepoClock"/);
  assert.match(content, /heading\.append\(el\('strong', 'RepoClock'\)/);
  assert.match(content, /const ROOT_ID = 'repoclock-root'/);
  assert.match(css, /\.timer-button\{[^}]*border:1px solid var\(--button-default-borderColor-rest\)[^}]*background:var\(--button-default-bgColor-rest\)[^}]*color:var\(--button-default-fgColor-rest\)/);
  assert.match(css, /\.timer-button:hover\{[^}]*background:var\(--button-default-bgColor-hover\)/);
  assert.doesNotMatch(css, /\.timer-button\{[^}]*button-primary/);
  assert.doesNotMatch(html, /class="button primary"/);
  assert.doesNotMatch(css, /\.button\.primary/);
  assert.doesNotMatch(js, /task\.status|statusMatches|statusLabel/);
});

test('standalone selects use an inset custom caret while the GitHub header caret remains untouched', () => {
  const reportsCss = fs.readFileSync(new URL('../src/reports/reports.css', import.meta.url), 'utf8');
  for (const pageCss of [css, reportsCss]) {
    assert.match(pageCss, /select\{[^}]*appearance:none[^}]*padding-right:32px[^}]*background-position:right 12px center/);
  }
  assert.doesNotMatch(content, /trigger-menu[^}]*translateX/);
});

test('GitHub header uses a separately clickable split trigger and a Reports/Tasks navigation menu', () => {
  assert.match(content, /trigger-main/);
  assert.match(content, /trigger-menu/);
  assert.match(content, /renderNavigationMenu/);
  assert.match(content, /button\('Reports'/);
  assert.match(content, /button\('Tasks'/);
  assert.match(content, /type:\s*'OPEN_TASKS'/);
  assert.match(worker, /src\/tasks\/tasks\.html/);
});
