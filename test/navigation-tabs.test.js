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
    assert.match(nav, /<a class="page-brand" href="https:\/\/clockoli\.com\/" target="_blank" rel="noreferrer" aria-label="Clockoli website">[\s\S]*clockoli-with-text\.svg/, `${current} must link the combined Clockoli logo and product name asset to the product website`);
    assert.match(nav, /<div class="page-tab-list">[\s\S]*<\/div>/, `${current} must keep page actions in one centered group`);
    assert.doesNotMatch(nav, /<span>CLOCKOLI<\/span>|clockoli\.svg/, `${current} must not reconstruct the combined brand from separate mark and text elements`);
    for (const [label, href] of Object.entries(hrefs)) {
      assert.match(nav, new RegExp(`<a class="page-tab" href="${href.replaceAll('.', '\\.') }"${label === current ? ' aria-current="page"' : ''}>[\\s\\S]*?${label}<\\/a>`), `${current} must link to ${label}`);
    }
    assert.equal((nav.match(/aria-current="page"/g) || []).length, 1, `${current} must have one active tab`);
    assert.equal((nav.match(/<svg viewBox="0 0 16 16" aria-hidden="true">/g) || []).length, 4, `${current} must reuse the four tracking-panel navigation icons`);
    assert.match(nav, /Top tasks<\/a>[\s\S]*Reports<\/a>[\s\S]*Activity<\/a>[\s\S]*Settings<\/a>/, `${current} must match the tracking-panel action order`);
    assert.doesNotMatch(nav.match(/<div class="page-tab-list">[\s\S]*<\/div>/)?.[0] || '', /target\s*=/i, `${current} page navigation must open in the same window`);
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
  assert.match(css, /\.page-tabs\{display:grid;grid-template-columns:minmax\(0,1fr\) auto minmax\(0,1fr\);align-items:center;width:100%;min-height:48px/);
  assert.match(css, /\.page-tab-list\{display:flex;grid-column:2;align-items:center;gap:2px;margin:0\}/);
  assert.match(css, /@media\(max-width:640px\)\{\.page-tabs\{display:flex;flex-wrap:wrap;padding:8px 12px;gap:6px\}/);
  assert.match(css, /\.page-brand img\{height:24px\}/);
  assert.match(css, /@media\(max-width:400px\)\{\.page-tab-list\{gap:0\}\.page-tab\{gap:2px;padding-inline:2px;font-size:11px\}\.page-tab svg\{width:13px;height:13px\}\}/);
});

test('Activity does not duplicate standalone navigation inside its renderer', () => {
  const content = read('src/content/github.js');
  const start = content.indexOf('function renderTimesPage()');
  const end = content.indexOf('const POPUP_WINDOW_MS', start);
  const renderer = content.slice(start, end);
  assert.doesNotMatch(renderer, /el\('h1'|el\('[^']+', 'Clockoli'|button\('(Top tasks|Reports|Settings)'/);
});

test('Activity mounts one shared running status outside its content renderer', () => {
  const html = read('src/times/times.html');
  assert.match(html, /<\/nav>\s*<\/div>\s*<div id="activity-running-status"><\/div>/);
  assert.equal((html.match(/src="\.\.\/ui\/running-status\.js"/g) || []).length, 1);
  assert.match(html, /href="\.\.\/styles\/running-status\.css"/);
  const content = read('src/content/github.js');
  const renderer = content.slice(content.indexOf('function renderTimesPage()'), content.indexOf('const POPUP_WINDOW_MS'));
  assert.doesNotMatch(renderer, /active-task-strip|refreshCompactSurface/);
});
