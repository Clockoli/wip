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

test('Activity renders compact scan-first rows with contextual controls', () => {
  assert.match(content, /\.activity-list \{ border-top:1px solid var\(--borderColor-muted/);
  assert.match(content, /\.entry-record \{ position:relative; padding:14px 76px 14px 0; border:0; border-bottom:1px solid var\(--borderColor-muted/);
  assert.match(content, /\.entry-record \+ \.entry-record \{ margin-top:0/);
  assert.match(content, /\.entry-actions \{ position:absolute; top:12px; right:0;[^}]*opacity:0/);
  assert.match(content, /\.entry-editing \.inline-time-range \{ display:block/,
    'direct time fields remain available only after the explicit edit action');
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
