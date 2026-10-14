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

test('Activity groups scan-first rows in bordered days with contextual controls', () => {
  assert.match(content, /\.activity-list \.entry \{[^}]*border:1px solid var\(--borderColor-default/);
  assert.match(content, /\.activity-list \.entry-date-header \{[^}]*border-bottom:1px solid var\(--borderColor-muted/);
  assert.match(content, /\.entry-record \{ position:relative; padding:14px 110px 14px 14px; border:0; border-bottom:1px solid var\(--borderColor-muted/);
  assert.match(content, /\.entry-record \+ \.entry-record \{ margin-top:0/);
  assert.match(content, /\.entry-actions \{ position:absolute; top:12px; right:14px;[^}]*opacity:0/);
  assert.match(content, /\.entry-editing \.inline-time-range \{ display:block/,
    'direct time fields remain available only after the explicit edit action');
});

test('tracker panel omits the redundant Clockoli Time tracker Synced heading', () => {
  const menu = renderer('renderMenu()', 'renderUi()');
  assert.doesNotMatch(menu, /el\('strong', 'Clockoli'\)|'Time tracker', 'muted'|const syncText/);
  assert.doesNotMatch(menu, /heading\.append/);
  assert.match(content, /:host\(\.full-width-popup-surface\) \.full-width-popup \{[^}]*width:100vw[^}]*max-width:none/s);
});

test('Activity places week navigation below view controls without a period selector', () => {
  const page = renderer('renderTimesPage(preservedTimeline = null)', 'renderMenu()');
  assert.match(page, /filterLabel\.className = 'times-filter'/);
  assert.match(page, /toolbar\.append\(filterLabel\);[\s\S]*body\.append\(views, toolbar, weekNavigation\(\), listTotal\)/);
  assert.doesNotMatch(page.split('function mergeTimelineCompletedEntries')[0], /Time period|times-custom|periodLabel/);
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
