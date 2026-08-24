import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const optionsHtml = await readFile(new URL('src/options/options.html', root), 'utf8');
const optionsJs = await readFile(new URL('src/options/options.js', root), 'utf8');
const optionsCss = await readFile(new URL('src/options/options.css', root), 'utf8');
const popupHtml = await readFile(new URL('src/popup/popup.html', root), 'utf8');
const content = await readFile(new URL('src/content/github.js', root), 'utf8');
const serviceWorker = await readFile(new URL('src/background/service-worker.js', root), 'utf8');

test('repository access step has one GitHub action and mode-specific instructions', () => {
  assert.doesNotMatch(optionsHtml, /Check for repository access now/i);
  assert.doesNotMatch(optionsHtml, /id="refresh-repositories"/i);
  assert.doesNotMatch(optionsJs, /refresh-repositories/);
  assert.match(optionsHtml, /id="repository-access-instruction"/);
  assert.match(optionsJs, /repository-access-instruction'[\s\S]*repositoryChoiceMode === 'create'/);
  assert.match(optionsJs, /clockoli-data/);
  assert.match(optionsJs, /existing private data repository/);
  assert.match(optionsHtml, /id="install-app"[^>]*>Choose repository access on GitHub<\/a>/);
});

test('repository choice consistently explains data storage and adapts to one eligible repository', () => {
  assert.match(optionsHtml, /id="repository-step-instruction"/);
  assert.match(optionsHtml, /This repository stores Clockoli time data/);
  assert.match(optionsHtml, /separate from the repositories whose tasks you track/);
  assert.doesNotMatch(optionsHtml, /issues or pull requests you track/);
  assert.match(optionsJs, /singleEligibleRepository/);
  assert.match(optionsJs, /radio\.hidden = singleEligibleRepository/);
  assert.match(optionsJs, /repository-step-instruction/);
  assert.match(optionsJs, /repository-choice-legend/);
});

test('repository controls align and change access is a regular secondary button', () => {
  assert.match(optionsHtml, /id="change-repository-access"[^>]*class="secondary"[^>]*>Change repository access<\/button>/);
  assert.match(optionsCss, /\.repository-option input\[type=radio\]\{[^}]*margin-top:/);
  assert.match(optionsCss, /\.repository-option\.single/);
});


test('billable rates and complete local settings backup are explicit extension-local features', async () => {
  const reportsHtml = await readFile(new URL('src/reports/reports.html', root), 'utf8');
  const reportsJs = await readFile(new URL('src/reports/reports.js', root), 'utf8');
  assert.match(optionsHtml, /id="billing-settings"/);
  assert.match(optionsHtml, /hourly rate for yourself or any other GitHub user/i);
  assert.match(optionsHtml, /never writes rates or calculated money to the data repository/i);
  assert.match(optionsHtml, /id="export-settings"/);
  assert.match(optionsHtml, /id="import-settings-file"[^>]*type="file"/);
  assert.match(optionsHtml, /GitHub credentials.*never exported/i);
  assert.match(optionsJs, /SAVE_BILLING_SETTINGS/);
  assert.match(optionsJs, /EXPORT_SETTINGS/);
  assert.match(optionsJs, /IMPORT_SETTINGS/);
  assert.match(optionsHtml, /id="settings-export-reminder"/);
  assert.match(reportsHtml, /value="billable-amount">Billable amount/);
  assert.match(reportsHtml, /id="summary-money"/);
  assert.match(reportsJs, /billableTotalsByCurrency/);
  assert.doesNotMatch(optionsHtml, /Currency code|billing-currency/);
  assert.match(optionsHtml, /currency sign or description/i);
  assert.match(reportsJs, /No rate for/);
});


test('popup and GitHub use one tracker renderer with task terminology and one scroll owner', () => {
  assert.match(popupHtml, /src="\.\.\/content\/github\.js"/);
  assert.doesNotMatch(popupHtml, /popup\.js/);
  assert.match(content, /popupMode[\s\S]*renderMenu\(\)/);
  assert.match(content, /Task URL/);
  assert.match(content, /Task title/);
  assert.doesNotMatch(content, /fieldLabel\('Issue or pull request'/);
  assert.match(content, /overflow-y:scroll/);
  assert.match(content, /scrollbar-gutter:stable/);
  assert.match(content, /Time tracker panel\. Scroll for more content/);
  assert.match(content, /menu\.classList\.toggle\('has-more'/);
  assert.match(content, /descriptionField\?\.focus/);
  assert.match(content, /timeLine = el\('div', undefined, 'inline-time-line'\)/);
  assert.match(content, /timeLine\.append\(startPicker\.node, separator, stopPicker\.node\)/);
  assert.match(content, /\.inline-time-line \{[^}]*display:flex[^}]*flex-wrap:nowrap[^}]*white-space:nowrap/);
  assert.match(content, /@media\(max-width:340px\) \{ \.entry-time-row \{ gap:3px \}[^}]*\.inline-time-line \{ gap:1px \}/,
    'the minimum supported panel width tightens spacing without wrapping the time range');
  assert.match(content, /\.entry-time-row \{[^}]*justify-content:flex-start[^}]*white-space:nowrap/);
  assert.match(content, /timeRow\.append\(inline\.node, inline\.duration, actions\)/,
    'Start/Stop, duration, and contextual actions share one left-aligned row');
  assert.match(content, /\.entry-actions\.dirty \.entry-edit,\.entry-actions\.dirty \.entry-delete \{ display:none \}/,
    'Save/Cancel replace full Edit/Delete while a direct time draft is dirty');
  assert.match(content, /\.compact-time-picker legend \{[^}]*position:absolute[^}]*clip-path:inset\(50%\)/);
  assert.doesNotMatch(content, /time-step|time-unit|WHEEL_THRESHOLD|wheelRemainder|addEventListener\('wheel'/);
  assert.match(content, /\.task-result-untitled \.task-url \{[^}]*overflow:hidden[^}]*text-overflow:ellipsis[^}]*white-space:nowrap/,
    'untitled URLs stay clamped even at the 2,048-character identity limit');
  assert.match(content, /url\.title = taskUrl/,
    'the full clamped URL remains exposed as native accessible text');
  assert.match(content, /\.task-title \{[^}]*-webkit-line-clamp:2/,
    'maximum-length optional titles are limited to two result lines');
  assert.match(content, /title\.title = taskTitle/,
    'the full clamped title remains exposed as native accessible text');
});


test('tracker copy and navigation use URL tasks without item terminology', () => {
  assert.doesNotMatch(content, /Edit details|Running on this item|Running on another item|Open any GitHub issue or pull request|Task \(issue or pull request\)/);
  assert.doesNotMatch(content, /button\('Edit', 'entry-edit'/);
  assert.match(content, /entry-description-editable/);
  assert.match(content, /Tracking/);
  assert.match(content, /'this'/);
  assert.match(content, /'another'/);
  assert.match(content, /tracking-another/);
  assert.match(content, /const tasks = button\('Top tasks', 'reports-button'/);
  assert.match(content, /taskUrl/);
  assert.match(content, /Task URL/);
});

test('opening the tracker renders cached entries and refreshes them without a second open', () => {
  assert.match(serviceWorker, /configured: true, active, recent: state\.recent/);
  assert.match(content, /if \(!recentLoaded && Array\.isArray\(data\?\.recent\) && data\.recent\.length\) applyMenuData\(data\.recent, false\)/);
  assert.match(content, /GET_PAGE_STATE', refresh: false[\s\S]*refreshRecent\(\)[\s\S]*GET_PAGE_STATE', refresh: true/);
  assert.match(content, /inlineMutation \|\| loadingRecent \|\| !recentFresh/);
  assert.match(content, /if \(menuOpen && pageState\.configured\)[\s\S]*await refreshRecent\(\)/);
  assert.doesNotMatch(content, /Open the menu again to load entries/);
});


test('direct time input preserves editing without wheel or plus/minus controls', () => {
  assert.match(content, /hourField\.addEventListener\('input', changed\)/);
  assert.match(content, /minuteField\.addEventListener\('input', changed\)/);
  assert.doesNotMatch(content, /WHEEL_THRESHOLD|wheelRemainder|addEventListener\('wheel'|time-step/);
});

test('main-panel time drafts link crossed neighboring boundaries before save', () => {
  assert.match(content, /linkCrossedTimeBoundaries/);
  assert.match(content, /EDIT_ENTRIES/);
  assert.doesNotMatch(content, /Stop time must not be before Start time\./);
});
