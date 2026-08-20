import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../src/tasks/tasks.html', import.meta.url), 'utf8');
const js = fs.readFileSync(new URL('../src/tasks/tasks.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/tasks/tasks.css', import.meta.url), 'utf8');
const worker = fs.readFileSync(new URL('../src/background/service-worker.js', import.meta.url), 'utf8');
const content = fs.readFileSync(new URL('../src/content/github.js', import.meta.url), 'utf8');

test('tasks page is a recent tracked-work list without GitHub issue-list clutter', () => {
  assert.match(html, /<h1>Recently tracked work<\/h1>/);
  for (const id of ['period', 'task-filter', 'status', 'result-count', 'task-list']) assert.match(html, new RegExp(`id="${id}"`));
  for (const value of ['two-weeks', 'one-month', 'three-months', 'six-months', 'one-year']) assert.match(html, new RegExp(`value="${value}"`));
  assert.match(html, /value="open" selected/);
  assert.doesNotMatch(html, /magnif|octicon-search|pagination|Sort|Assigned to me/i);
  assert.doesNotMatch(html, /labels|comments|assignee/i);
  assert.match(js, /localStorage\.getItem\(PERIOD_KEY\)/);
  assert.match(js, /localStorage\.setItem\(PERIOD_KEY/);
  assert.match(js, /addEventListener\('input'/);
  assert.match(js, /type:\s*'LOAD_TASKS'/);
  assert.match(js, /type:\s*'START'/);
  assert.match(js, /type:\s*'STOP'/);
  assert.doesNotMatch(js, /innerHTML|outerHTML|eval\s*\(|new Function/);
  assert.match(css, /\.task-row/);
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
