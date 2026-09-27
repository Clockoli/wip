import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const htmlPath = new URL('../src/clockify-migration/preview.html', import.meta.url);
const cssPath = new URL('../src/clockify-migration/preview.css', import.meta.url);
const scriptPath = new URL('../src/clockify-migration/preview.js', import.meta.url);

const [html, css, source] = await Promise.all([
  readFile(htmlPath, 'utf8'), readFile(cssPath, 'utf8'), readFile(scriptPath, 'utf8'),
]);
const { mappingState } = await import('../src/clockify-migration/preview.js');

test('Clockify migration preview is an extension page with Clockoli navigation and a safe-only roster', () => {
  assert.match(html, /<link rel="stylesheet" href="\.\.\/styles\/page-tabs\.css">/);
  assert.match(html, /href="\.\.\/times\/times\.html"/);
  assert.match(html, /href="\.\.\/options\/options\.html"/);
  assert.match(html, /aria-current="page"[^>]*>Migration</);
  assert.match(html, /id="entry-count"/);
  assert.match(html, /id="source-users"/);
  assert.match(html, /id="mapping-form"/);
  assert.match(html, /id="confirmation" type="checkbox" required/);
  assert.match(html, /id="import"[^>]*disabled/);
  assert.match(html, /id="outcomes"[^>]*hidden/);
  assert.match(html, /id="import-status"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html, /id="progress-current-step"/);
  assert.match(html, /id="import-progress"[^>]*max="11"/);
  assert.doesNotMatch(html, /class="migration-stages"/);
  assert.match(html, /id="message"[^>]*role="alert"[^>]*aria-live="assertive"/);
  assert.match(html, /<script type="module" src="preview\.js"><\/script>/);
  const previewCard = html.slice(html.indexOf('<main>'), html.indexOf('</main>'));
  assert.doesNotMatch(previewCard, /email|range|duration|month|project|task|description/i);
});

test('preview uses only the narrow callback message contract and neither storage nor provider lookup', () => {
  for (const type of ['GET_CLOCKIFY_MIGRATION_PREVIEW', 'GET_CLOCKIFY_MIGRATION_SUGGESTIONS', 'CONFIRM_CLOCKIFY_MIGRATION']) assert.match(source, new RegExp(`type: '${type}'`));
  assert.match(source, /chrome\.runtime\.sendMessage\(request, response =>/);
  assert.match(source, /CLOCKIFY_MIGRATION_PROGRESS/);
  assert.match(source, /Preparing Clockoli storage/);
  assert.match(source, /Reading destination records/);
  assert.match(source, /Writing completed records/);
  assert.match(source, /Step \$\{activeIndex \+ 1\} of \$\{phases.length\}/);
  assert.doesNotMatch(source, /toFixed\(1\).*s/);
  assert.doesNotMatch(source, /migration-stages/);
  assert.doesNotMatch(source, /Migrate click to mapping window ready/);
  assert.match(source, /chrome\.runtime\.lastError/);
  assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|localStorage|sessionStorage|chrome\.storage|github\.com|clockify\.me)\b/i);
});

test('preview offers repository-collaborator logins as suggestions without assigning a mapping', () => {
  assert.match(html, /id="github-login-suggestions"/);
  assert.match(source, /input\.setAttribute\('list', 'github-login-suggestions'\)/);
  assert.match(source, /function renderSuggestions\(logins\)/);
  assert.doesNotMatch(source, /input\.value\s*=\s*logins/);
});

test('mapping state requires every manual GitHub login, makes target logins one-to-one, and requires explicit confirmation', () => {
  const users = [
    { id: 'clockify-1', displayName: 'Avery', entryCount: 3 },
    { id: 'clockify-2', displayName: 'Blair', entryCount: 1 },
  ];
  assert.deepEqual(mappingState(users, ['', 'blair'], [false, false], true), { valid: false, mappings: [] });
  assert.deepEqual(mappingState(users, ['not a login', 'blair'], [false, false], true), { valid: false, mappings: [] });
  assert.deepEqual(mappingState(users, ['octocat', 'octocat'], [false, false], true), { valid: false, mappings: [] });
  assert.deepEqual(mappingState(users, ['octocat', 'blair'], [false, false], false), { valid: false, mappings: [] });
  assert.deepEqual(mappingState(users, [' Octocat ', 'BLAIR'], [false, false], true), {
    valid: true,
    mappings: [
      { sourceUserId: 'clockify-1', githubLogin: 'Octocat' },
      { sourceUserId: 'clockify-2', githubLogin: 'BLAIR' },
    ],
  });
  assert.deepEqual(mappingState(users, ['octocat', ''], [false, true], true), {
    valid: true,
    mappings: [
      { sourceUserId: 'clockify-1', githubLogin: 'octocat' },
      { sourceUserId: 'clockify-2', skipped: true },
    ],
  });
  assert.deepEqual(mappingState(users, ['octocat'], [false], true), { valid: false, mappings: [] });
  assert.deepEqual(mappingState([], [], [], true), { valid: false, mappings: [] });
});

test('preview styling keeps errors inline, shows current import progress, and supports manual mapping rows', () => {
  assert.match(css, /\.card-header-message\.error/);
  assert.match(css, /\.mapping-row/);
  assert.doesNotMatch(css, /\.migration-stages/);
  assert.match(css, /\.migration-progress progress/);
  assert.doesNotMatch(css, /data-elapsed/);
  assert.match(css, /@media\(max-width:700px\)/);
  assert.doesNotMatch(css, /position\s*:\s*(?:fixed|absolute)/i);
});

test('completed migration state is presented as a finished success, not an active step', () => {
  assert.match(source, /isCompleted \? 'Migration complete' : 'Saving migration'/);
  assert.match(source, /isCompleted \? `Imported \$\{completed\} of \$\{total\} people`/);

});

test('preview does not tell users to manually resolve an automatic import overlap', () => {
  assert.match(source, /could not resolve the imported intervals safely/);
  assert.doesNotMatch(source, /resolve the overlap/);
});
