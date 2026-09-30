import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { githubNewRepositoryUrl } from '../src/config/github-app.js';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const [optionsHtml, optionsJs, contentJs, tasksHtml, reportsHtml, reportsJs, readme] = await Promise.all([
  read('../src/options/options.html'), read('../src/options/options.js'), read('../src/content/github.js'),
  read('../src/tasks/tasks.html'), read('../src/reports/reports.html'), read('../src/reports/reports.js'), read('../README.md'),
]);

test('first run presents sign-in then an owner-neutral repository list and manual target', () => {
  assert.match(optionsHtml, /id="connection-title"[^>]*>Set up Clockoli</);
  assert.match(optionsHtml, /id="authorize"[^>]*>Sign in with GitHub<\/button>/);
  assert.match(optionsHtml, /Step <span id="current-step">1<\/span> of 2/);
  assert.match(optionsHtml, /for="repository-target">Enter a repository URL or owner\/name<\/label>[\s\S]*<input id="repository-target"/);
  assert.match(optionsHtml, /id="repository-target-form"[\s\S]*id="repository-target"/);
  assert.match(optionsHtml, /id="repository-list"/);
  assert.match(optionsHtml, /explicitly connect a ready repository, regardless of who owns it/);
  assert.doesNotMatch(optionsHtml, /Use an existing Clockoli repository|Set up a new time repository|data-repository-choice/);
});

test('repository selection is owner-neutral, classified, and explicitly confirmed before any write', () => {
  const list = optionsJs.slice(optionsJs.indexOf('function renderRepositoryList('), optionsJs.indexOf('function renderRepositories('));
  assert.match(list, /className = 'repository-option'/);
  assert.match(list, /className = 'repository-icon'/);
  assert.doesNotMatch(list, /ownerType|ownership|Personal|Organization/);
  assert.doesNotMatch(list, /radio/);
  assert.match(list, /action\.disabled = repositoryActionApplying/);
  assert.match(optionsJs, /function repositoryInspectionStatus/);
  assert.match(optionsJs, /initialized_member/);
  assert.match(optionsHtml, /id="repository-confirmation"/);
  assert.match(optionsHtml, /<dialog id="repository-confirmation"/);
  assert.match(optionsHtml, /id="finish-setup"[^>]*>Finish setup/);
  assert.doesNotMatch(optionsHtml, /id="connect-repository"|id="refresh-repositories"/);
  assert.match(optionsHtml, /Anyone with read access[\s\S]*URLs[\s\S]*titles[\s\S]*timestamps[\s\S]*descriptions/i);
  assert.match(optionsJs, /Set up storage branch/);
  assert.match(optionsJs, /Initialize repository/);
  assert.match(optionsJs, /Join repository/);
  const review = optionsJs.slice(optionsJs.indexOf('function reviewSelectedRepository('), optionsJs.indexOf('async function confirmRepositoryAction('));
  assert.match(review, /intent === 'add'[\s\S]*Create or verify branch clockoli\/users\//);
  assert.match(review, /intent === 'join'[\s\S]*Update \.clockoli\/config\.json/);
  assert.match(review, /Create \.clockoli\/config\.json[\s\S]*Create the first commit and default branch/);
  assert.doesNotMatch(list + review, /send\(|SELECT_REPOSITORY/);
  assert.doesNotMatch(optionsJs, /connectSelectedRepository\(\{ automatic: true \}\)/);
});

test('repository creation remains a secondary handoff without a required owner scenario', () => {
  const personal = new URL(githubNewRepositoryUrl('@me'));
  const organization = new URL(githubNewRepositoryUrl());
  assert.equal(personal.searchParams.get('owner'), '@me');
  assert.equal(organization.searchParams.has('owner'), false);
  assert.notEqual(personal.href, organization.href);
  assert.match(optionsHtml, /<a id="new-time-repository"[^>]*>Create a new time repository<\/a>/);
  const create = optionsJs.slice(optionsJs.indexOf("for (const id of ['new-time-repository', 'modal-new-time-repository'])"), optionsJs.indexOf("$('add-time-repository').addEventListener"));
  assert.match(create, /Nothing is initialized automatically/);
  assert.doesNotMatch(create, /SELECT_REPOSITORY|confirmRepositoryAction\(|discoverRepositories\(/);
});

test('every initialized shared repository can expose teammate instructions regardless of owner type', () => {
  assert.match(optionsJs, /function renderTeammateInstructions/);
  assert.match(optionsJs, /destination\.initialized !== false/);
  assert.match(optionsJs, /Copy instructions/);
});

test('all setup gates and initial report loading use the shared product language', () => {
  for (const source of [contentJs, tasksHtml, reportsHtml]) {
    assert.match(source, /Choose where Clockoli should save your time/);
    assert.match(source, /Set up Clockoli/);
  }
  assert.match(reportsHtml, /Loading time data…/);
  assert.match(reportsJs, /showProgress\('Loading time data…'/);
});

test('README directs installation to Settings and the full getting-started guide', () => {
  assert.match(readme, /Open \*\*Settings\*\*/);
  assert.match(readme, /Full setup instructions: \[Getting started\]\(docs\/getting-started\.md\)/);
});
