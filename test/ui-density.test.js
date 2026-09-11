import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = relative => fs.readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
const content = read('src/content/github.js');

function renderer(name, nextName) {
  const start = content.indexOf(`function ${name}`);
  const end = content.indexOf(`function ${nextName}`, start);
  return content.slice(start, end);
}

test('main tracker renders recent time as separate inset cards without divider lines', () => {
  const menu = renderer('renderMenu()', 'renderUi()');
  assert.doesNotMatch(menu, /className = 'divider'|el\('div', undefined, 'divider'\)/);
  assert.doesNotMatch(content, /\.divider\s*\{/);
  assert.match(content, /\.entry-record\s*\{[^}]*border:1px solid var\(--borderColor-default[^}]*border-radius:8px[^}]*background:var\(--bgColor-muted/s);
  assert.match(content, /\.entry-record \+ \.entry-record\s*\{[^}]*margin-top:/s);
  assert.doesNotMatch(content, /\.entry-record \+ \.entry-record\s*\{[^}]*border-top:/s);
});

test('tracker panel omits the redundant Clockoli Time tracker Synced heading', () => {
  const menu = renderer('renderMenu()', 'renderUi()');
  assert.doesNotMatch(menu, /el\('strong', 'Clockoli'\)|'Time tracker', 'muted'|const syncText/);
  assert.doesNotMatch(menu, /heading\.append/);
  assert.match(content, /:host\(\.full-width-popup-surface\) \.full-width-popup \{[^}]*width:100vw[^}]*max-width:none/s);
});

test('Activity defaults to Last 3 days and puts filter before period on one row', () => {
  assert.match(content, /let timesPeriod = 'last-three-days'/);
  assert.match(content, /timesPeriod === 'last-three-days'[\s\S]*move\(-2\)/);
  const page = renderer('renderTimesPage()', 'renderMenu()');
  assert.match(page, /\['last-three-days', 'Last 3 days'\]/);
  assert.ok(page.indexOf("filterLabel.className = 'times-filter'") < page.indexOf('periodLabel.append(period)'), 'filter must be created before period');
  assert.match(content, /\.times-toolbar\s*\{[^}]*grid-template-columns:minmax\(0,1fr\) auto/s);
  assert.match(content, /\.times-filter\s*\{[^}]*grid-column:auto/s);
});

test('GitHub header has no separate navigation dropdown', () => {
  assert.doesNotMatch(content, /renderNavigationMenu|navigation-menu|trigger-menu|TRIANGLE_PATH/);
  assert.match(content, /main\.addEventListener\('click', async event => \{[\s\S]*?await toggleFullWidthPopup\(\)/);
});

test('shared tracking navigation fits all actions at 320px without a hidden horizontal scroller', () => {
  assert.match(content, /@media\(max-width:520px\)[\s\S]*?\.header-navigation \{[^}]*display:grid[^}]*grid-template-columns:repeat\(4,minmax\(0,1fr\)\)[^}]*overflow:visible/s);
  assert.match(content, /@media\(max-width:520px\)[\s\S]*?\.header-navigation \.reports-button \{[^}]*min-width:0[^}]*justify-content:center[^}]*font-size:10px[^}]*white-space:nowrap/s);
});
