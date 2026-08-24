import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = relative => fs.readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
const pages = {
  Times: 'src/times/times.html',
  Tasks: 'src/tasks/tasks.html',
  Reports: 'src/reports/reports.html',
  Settings: 'src/options/options.html',
};
const hrefs = {
  Times: '../times/times.html',
  Tasks: '../tasks/tasks.html',
  Reports: '../reports/reports.html',
  Settings: '../options/options.html',
};

test('every standalone page exposes the same same-window page tabs', () => {
  for (const [current, file] of Object.entries(pages)) {
    const html = read(file);
    const nav = html.match(/<nav class="page-tabs"[\s\S]*?<\/nav>/)?.[0] || '';
    assert.ok(nav, `${current} must render page tabs`);
    assert.match(nav, /aria-label="RepoClock pages"/);
    for (const [label, href] of Object.entries(hrefs)) {
      assert.match(nav, new RegExp(`<a href="${href.replaceAll('.', '\\.') }"${label === current ? ' aria-current="page"' : ''}>${label}<\\/a>`), `${current} must link to ${label}`);
    }
    assert.equal((nav.match(/aria-current="page"/g) || []).length, 1, `${current} must have one active tab`);
    assert.doesNotMatch(nav, /target\s*=/i, `${current} page tabs must open in the same window`);
  }
});

test('page tabs use one packaged shared stylesheet', () => {
  for (const [label, file] of Object.entries(pages)) {
    assert.match(read(file), /<link rel="stylesheet" href="\.\.\/styles\/page-tabs\.css">/, `${label} must load shared tab styles`);
  }
  const css = read('src/styles/page-tabs.css');
  assert.match(css, /\.page-tabs a\[aria-current="page"\]/);
  assert.match(css, /overflow-x:auto/);
});


test('Times does not duplicate the page tabs inside its content header', () => {
  const content = read('src/content/github.js');
  const start = content.indexOf('function renderTimesPage()');
  const end = content.indexOf('function renderMenu()', start);
  const renderer = content.slice(start, end);
  assert.doesNotMatch(renderer, /button\('(Tasks|Reports|Settings)'/);
});
