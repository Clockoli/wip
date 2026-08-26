import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = relative => fs.readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
const pages = {
  Activity: 'src/times/times.html',
  'Top tasks': 'src/tasks/tasks.html',
  Reports: 'src/reports/reports.html',
  Settings: 'src/options/options.html',
};
const hrefs = {
  Activity: '../times/times.html',
  'Top tasks': '../tasks/tasks.html',
  Reports: '../reports/reports.html',
  Settings: '../options/options.html',
};

test('every standalone page exposes one shared branded same-window navigation row', () => {
  for (const [current, file] of Object.entries(pages)) {
    const html = read(file);
    const nav = html.match(/<nav class="page-tabs"[\s\S]*?<\/nav>/)?.[0] || '';
    assert.ok(nav, `${current} must render page tabs`);
    assert.match(nav, /aria-label="Clockoli pages"/);
    assert.match(nav, /class="page-brand"[^>]*>[\s\S]*clockoli-with-text\.svg/, `${current} must use the combined Clockoli logo and product name asset`);
    assert.doesNotMatch(nav, /<span>CLOCKOLI<\/span>|clockoli\.svg/, `${current} must not reconstruct the combined brand from separate mark and text elements`);
    for (const [label, href] of Object.entries(hrefs)) {
      assert.match(nav, new RegExp(`<a class="page-tab" href="${href.replaceAll('.', '\\.') }"${label === current ? ' aria-current="page"' : ''}>${label}<\\/a>`), `${current} must link to ${label}`);
    }
    assert.equal((nav.match(/aria-current="page"/g) || []).length, 1, `${current} must have one active tab`);
    assert.doesNotMatch(nav, /target\s*=/i, `${current} navigation must open in the same window`);
    assert.doesNotMatch(html, /class="hero"|class="app-header"|class="brand-logo"|class="mark"/, `${current} must not duplicate page branding below the navigation`);
  }
});

test('shared navigation styles distinguish the brand from page tabs and remain responsive', () => {
  for (const [label, file] of Object.entries(pages)) {
    assert.match(read(file), /<link rel="stylesheet" href="\.\.\/styles\/page-tabs\.css">/, `${label} must load shared navigation styles`);
  }
  const css = read('src/styles/page-tabs.css');
  assert.match(css, /\.page-brand/);
  assert.match(css, /\.page-brand img/);
  assert.match(css, /\.page-tab\[aria-current="page"\]/);
  assert.match(css, /overflow-x:auto/);
  assert.match(css, /@media\(max-width:640px\)\{\.page-tabs\{padding:0 4px\}\.page-brand\{margin-right:4px\}\.page-brand img\{width:auto;height:20px\}\.page-tab\{padding-inline:4px;font-size:12px\}\}/);
});

test('Activity does not duplicate standalone navigation inside its renderer', () => {
  const content = read('src/content/github.js');
  const start = content.indexOf('function renderTimesPage()');
  const end = content.indexOf('function renderMenu()', start);
  const renderer = content.slice(start, end);
  assert.doesNotMatch(renderer, /Clockoli|el\('h1'|button\('(Top tasks|Reports|Settings)'/);
});
