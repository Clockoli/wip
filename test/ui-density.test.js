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
  assert.match(content, /\.entry-record \{ position:relative; padding:8px 110px 8px 16px; border:0; border-bottom:1px solid var\(--borderColor-muted/);
  assert.match(content, /\.entry-record \+ \.entry-record \{ margin-top:0/);
  assert.match(content, /\.entry-actions \{ position:absolute; top:8px; right:8px;[^}]*opacity:0/);
  assert.match(content, /\.entry-editing \.inline-time-range \{ display:block/,
    'direct time fields remain available only after the explicit edit action');
});

test('tracker panel omits the redundant Clockoli Time tracker Synced heading', () => {
  const menu = renderer('renderMenu()', 'renderUi()');
  assert.doesNotMatch(menu, /el\('strong', 'Clockoli'\)|'Time tracker', 'muted'|const syncText/);
  assert.doesNotMatch(menu, /heading\.append/);
  assert.doesNotMatch(content, /full-width-popup/);
});

test('Activity groups List search, week navigation, and Refresh below view controls without a period selector', () => {
  const page = renderer('renderTimesPage(preservedTimeline = null)', 'renderMenu()');
  assert.match(page, /filterLabel\.className = 'times-filter'/);
  assert.match(page, /toolbar\.append\(filterLabel\);[\s\S]*summaryHost\.replaceChildren\(weeklySummary\);[\s\S]*viewHost\.replaceChildren\(views\);[\s\S]*toolbar\.append\(weekNavigation\(\), refresh\);[\s\S]*body\.append\(toolbar, listTotal\)/);
  assert.doesNotMatch(page.split('function mergeTimelineCompletedEntries')[0], /Time period|times-custom|periodLabel/);
  assert.match(content, /\.times-toolbar\s*\{[^}]*grid-template-columns:minmax\(0,1fr\) auto/s);
  assert.match(content, /\.times-filter\s*\{[^}]*grid-column:auto/s);
});

test('GitHub header has no separate navigation dropdown', () => {
  assert.doesNotMatch(content, /renderNavigationMenu|navigation-menu|trigger-menu|TRIANGLE_PATH/);
  assert.match(content, /main\.addEventListener\('click', async event => \{[\s\S]*?await send\(\{ type: 'OPEN_PREFERRED_SURFACE' \}\)/);
});

test('GitHub launcher delegates to the selected toolbar surface', () => {
  assert.match(content, /main\.addEventListener\('click', async event => \{[\s\S]*?await send\(\{ type: 'OPEN_PREFERRED_SURFACE' \}\)/);
  assert.doesNotMatch(content, /fullWidthPopupOpen|renderFullWidthPopup|toggleFullWidthPopup/);
});
