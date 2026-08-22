import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const optionsHtml = await readFile(new URL('src/options/options.html', root), 'utf8');
const optionsJs = await readFile(new URL('src/options/options.js', root), 'utf8');
const optionsCss = await readFile(new URL('src/options/options.css', root), 'utf8');
const popupHtml = await readFile(new URL('src/popup/popup.html', root), 'utf8');
const content = await readFile(new URL('src/content/github.js', root), 'utf8');

test('repository access step has one GitHub action and mode-specific instructions', () => {
  assert.doesNotMatch(optionsHtml, /Check for repository access now/i);
  assert.doesNotMatch(optionsHtml, /id="refresh-repositories"/i);
  assert.doesNotMatch(optionsJs, /refresh-repositories/);
  assert.match(optionsHtml, /id="repository-access-instruction"/);
  assert.match(optionsJs, /repository-access-instruction'[\s\S]*repositoryChoiceMode === 'create'/);
  assert.match(optionsJs, /repoclock-data/);
  assert.match(optionsJs, /existing private data repository/);
  assert.match(optionsHtml, /id="install-app"[^>]*>Choose repository access on GitHub<\/a>/);
});

test('repository choice consistently explains data storage and adapts to one eligible repository', () => {
  assert.match(optionsHtml, /id="repository-step-instruction"/);
  assert.match(optionsHtml, /This repository stores RepoClock time data/);
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
  assert.match(reportsJs, /billableMinorTotal/);
  assert.match(reportsJs, /No rate for/);
});


test('popup and GitHub use one tracker renderer with task terminology and one scroll owner', () => {
  assert.match(popupHtml, /src="\.\.\/content\/github\.js"/);
  assert.doesNotMatch(popupHtml, /popup\.js/);
  assert.match(content, /popupMode[\s\S]*renderMenu\(\)/);
  assert.match(content, /Task \(issue or pull request\)/);
  assert.match(content, /Task title/);
  assert.doesNotMatch(content, /fieldLabel\('Issue or pull request'/);
  assert.match(content, /overflow-y:scroll/);
  assert.match(content, /scrollbar-gutter:stable/);
  assert.match(content, /Time tracker panel\. Scroll for more content/);
  assert.match(content, /menu\.classList\.toggle\('has-more'/);
  assert.ok(content.includes("shadow?.querySelector?.('.time-value')?.focus?.()"));
  assert.match(content, /compact-time-picker \.time-unit \{ display:grid; grid-template-columns:24px 38px 24px/);
});
