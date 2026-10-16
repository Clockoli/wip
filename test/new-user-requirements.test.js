import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const optionsHtml = await readFile(new URL('src/options/options.html', root), 'utf8');
const optionsJs = await readFile(new URL('src/options/options.js', root), 'utf8');
const optionsCss = await readFile(new URL('src/options/options.css', root), 'utf8');
const popupHtml = await readFile(new URL('src/popup/popup.html', root), 'utf8');
const content = await readFile(new URL('src/content/github.js', root), 'utf8');
const timePicker = content.slice(content.indexOf('function timePicker('), content.indexOf('function timestampAtOriginalOffset('));
const serviceWorker = await readFile(new URL('src/background/service-worker.js', root), 'utf8');

test('repository-first setup requests App access only for the concrete target', () => {
  assert.doesNotMatch(optionsHtml, /id="repository-setup-step"|id="repository-access-step"|id="choose-existing-repository"|id="choose-empty-repository"/);
  assert.match(optionsHtml, /id="repository-access-panel"[^>]*hidden/);
  assert.equal((optionsHtml.match(/id="install-app"/g) || []).length, 1);
  assert.match(optionsHtml, /id="install-app"[^>]*>Grant access<\/a>/);
  const access = optionsJs.slice(optionsJs.indexOf('function renderRepositoryAccess()'), optionsJs.indexOf('function repositoryActionKey('));
  assert.match(access, /Boolean\(repositoryTarget\)[\s\S]*discoveryStatus === 'ready'[\s\S]*&& !selectedRepository/);
  assert.match(access, /app_contents_write_required/);
  assert.match(access, /if \(!\(missing \|\| needsAppWrite\)\) closeRepositoryAccess\(\)/);
  assert.doesNotMatch(access, /showModal/);
  assert.match(access, /installation\?\.settingsUrl \|\| state\?\.installationUrl/);
  assert.match(access, /Its existence is not confirmed/);
  assert.doesNotMatch(optionsJs, /repositoryChoiceMode|function isCreationMode/);
});

test('repository discovery honors an explicit dirty target and never confirms writes automatically', () => {
  assert.doesNotMatch(optionsHtml, /id="repository-step-instruction"/);
  assert.doesNotMatch(optionsHtml, /Checking verifies access and Clockoli storage without connecting or changing files|Connecting, initialization and joining require a separate confirmation/i);
  assert.match(optionsHtml, /Anyone with read access[\s\S]*stored task URLs, titles, timestamps, and descriptions/);
  const render = optionsJs.slice(optionsJs.indexOf('function renderRepositories(result)'), optionsJs.indexOf('function reviewSelectedRepository()'));
  assert.match(render, /selectedRepository = repositoryInputDirty \? null : repositoryTarget/);
  assert.match(render, /repository\.fullName\.toLowerCase\(\) === repositoryTarget\.toLowerCase\(\)\) \|\| null/);
  assert.match(render, /updateRepositoryConfirmation\(\)/);
  assert.doesNotMatch(render, /send\(|SELECT_REPOSITORY|confirmRepositoryAction\(/);
  const confirmation = optionsJs.slice(optionsJs.indexOf('function updateRepositoryConfirmation()'), optionsJs.indexOf('function repositoryInspectionStatus('));
  assert.match(confirmation, /closeRepositoryConfirmation\(\)/);
  const close = optionsJs.slice(optionsJs.indexOf('function closeRepositoryConfirmation()'), optionsJs.indexOf('async function discoverRepositories('));
  assert.match(close, /hidden = true/);
  assert.match(close, /pendingConfirmation = null/);
});

test('repository controls offer autocomplete and explicit Check, default and Finish', () => {
  assert.match(optionsHtml, /id="repository-target-form"/);
  assert.match(optionsHtml, /for="repository-target">Enter a repository URL or owner\/name<\/label>/);
  assert.match(optionsHtml, /id="check-repository-target"[^>]*type="button"[^>]*aria-label="Check repository"[^>]*>Check<\/button>/);
  assert.doesNotMatch(optionsHtml, /id="refresh-repository-target"/);
  assert.doesNotMatch(optionsHtml, /id="refresh-repositories"|id="connect-repository"/);
  assert.doesNotMatch(optionsJs, /radio\.type = 'radio'/);
  assert.match(optionsCss, /\.repository-suggestion/);
  assert.match(optionsJs, /option\.textContent = repository\.fullName/);
  assert.match(optionsJs, /checkRepositoryTarget\(repository\.fullName, false, true\)/);
  assert.match(optionsHtml, /Default time repository<select id="setup-default-destination"/);
  assert.match(optionsHtml, /id="finish-setup"[^>]*disabled[^>]*>Finish setup/);
});


test('billable rates and complete local settings backup are explicit extension-local features', async () => {
  const reportsHtml = await readFile(new URL('src/reports/reports.html', root), 'utf8');
  const reportsJs = await readFile(new URL('src/reports/reports.js', root), 'utf8');
  assert.match(optionsHtml, /id="billing-settings"[\s\S]*Rates are private to this browser/i);
  assert.match(optionsHtml, /never written to your GitHub repository/i);
  assert.ok(optionsHtml.indexOf('id="billing-settings"') < optionsHtml.indexOf('id="advanced-settings"'));
  assert.match(optionsHtml, /id="export-settings"[^>]*>Export settings/);
  assert.match(optionsHtml, /id="import-settings-file"[^>]*type="file"/);
  assert.match(optionsHtml, /GitHub credentials and time entries are never included/i);
  assert.match(optionsJs, /SAVE_BILLING_SETTINGS/);
  assert.match(optionsJs, /EXPORT_SETTINGS/);
  assert.match(optionsJs, /IMPORT_SETTINGS/);
  assert.match(optionsHtml, /id="settings-export-reminder"/);
  assert.match(reportsHtml, /value="billable-amount">Billable amount/);
  assert.match(reportsHtml, /id="summary-money"/);
  assert.match(reportsJs, /billableTotalsByCurrency/);
  assert.match(optionsJs, /currencyLabel\.textContent = 'Currency'/);
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
  assert.match(content, /focusTime \? editor\?\.startPicker\?\.controls\?\.\[0\] : editor\?\.descriptionField/,
    'the unified editor exposes both the time and metadata fields');
  assert.match(content, /timeLine = el\('div', undefined, 'inline-time-line'\)/);
  assert.match(content, /timeLine\.append\(startPicker\.node, separator, stopPicker\.node\)/);
  assert.match(content, /\.inline-time-line \{[^}]*display:flex[^}]*flex-wrap:nowrap[^}]*white-space:nowrap/);
  assert.match(content, /@media\(max-width:340px\) \{ \.entry-time-row \{ gap:3px \}[^}]*\.inline-time-line \{ gap:1px \}/,
    'the minimum supported panel width tightens spacing without wrapping the time range');
  assert.match(content, /\.entry-time-row \{[^}]*justify-content:flex-start[^}]*white-space:nowrap/);
  assert.match(content, /timeRow\.append\(time, inline\.node, inline\.duration, actions\)/,
    'Activity shows a compact range and keeps the direct editor in the same row after Edit time');
  assert.match(content, /record\.classList\.add\('entry-editing'\)/,
    'Edit time explicitly reveals the direct time fields');
  assert.match(content, /\.entry-actions\.dirty \.entry-edit,\.entry-actions\.dirty \.entry-delete \{ display:none \}/,
    'Save/Cancel replace full Edit/Delete while a direct time draft is dirty');
  assert.match(content, /\.compact-time-picker legend \{[^}]*position:absolute[^}]*clip-path:inset\(50%\)/);
  assert.doesNotMatch(content, /time-step|time-unit|WHEEL_THRESHOLD|wheelRemainder/);
  assert.doesNotMatch(timePicker, /addEventListener\('wheel'/);
  assert.match(content, /\.task-result-untitled \.task-url \{[^}]*overflow:hidden[^}]*text-overflow:ellipsis[^}]*white-space:nowrap/,
    'untitled URLs stay clamped even at the 2,048-character identity limit');
  assert.match(content, /url\.title = identity/,
    'the full clamped URL or imported identity remains exposed as native accessible text');
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
  assert.match(serviceWorker, /async function globalTrackerState[\s\S]*const recent = \[\.\.\.states\][\s\S]*const result = \{ configured: true, active, recent, pendingWrites \}/);
  assert.match(serviceWorker, /message\.type === 'GET_PAGE_STATE'[\s\S]*globalTrackerState\(\{ refresh: Boolean\(message\.refresh\), includeSummary: pageState \}\)[\s\S]*return \{\s*\.\.\.state/);
  assert.match(content, /if \(Array\.isArray\(data\?\.recent\)\) applyMenuData\(data\.recent, recentFresh\)/);
  assert.match(content, /GET_PAGE_STATE', refresh: false[\s\S]*refreshRecent\(\)[\s\S]*GET_PAGE_STATE', refresh: true/);
  assert.match(content, /loadingRecent \|\| !recentFresh/);
  assert.match(content, /if \(\(menuOpen \|\| fullWidthPopupOpen\) && pageState\.configured\)[\s\S]*await refreshRecent\(\)/);
  assert.doesNotMatch(content, /Open the menu again to load entries/);
});


test('direct time input preserves editing without wheel or plus/minus controls', () => {
  assert.match(content, /hourField\.addEventListener\('input', changed\)/);
  assert.match(content, /minuteField\.addEventListener\('input', changed\)/);
  assert.doesNotMatch(content, /WHEEL_THRESHOLD|wheelRemainder|time-step/);
  assert.doesNotMatch(timePicker, /addEventListener\('wheel'/);
});

test('main-panel time drafts link crossed neighboring boundaries before save', () => {
  assert.match(content, /linkCrossedTimeBoundaries/);
  assert.match(content, /QUEUE_ENTRIES_EDIT/);
  assert.doesNotMatch(content, /Stop time must not be before Start time\./);
});
