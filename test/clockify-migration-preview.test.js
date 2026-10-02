import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const htmlPath = new URL('../src/clockify-migration/preview.html', import.meta.url);
const cssPath = new URL('../src/clockify-migration/preview.css', import.meta.url);
const scriptPath = new URL('../src/clockify-migration/preview.js', import.meta.url);

const [html, css, source] = await Promise.all([
  readFile(htmlPath, 'utf8'), readFile(cssPath, 'utf8'), readFile(scriptPath, 'utf8'),
]);
const { mappingState, renderUsers } = await import('../src/clockify-migration/preview.js');

// Minimal DOM for the row picker; exercises event handlers without a browser dependency.
class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.events = new Map(); this.attrs = {}; this.value = ''; this.hidden = false; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; }
  get childElementCount() { return this.children.filter(child => child instanceof Element).length; }
  setAttribute(name, value) { this.attrs[name] = value; }
  addEventListener(name, fn) { this.events.set(name, fn); }
  dispatch(name, event = {}) { return this.events.get(name)?.(event); }
  focus() { this.dispatch('focus'); }
  contains(node) { return node === this || this.children.some(child => child instanceof Element && child.contains(node)); }
  remove() { this.removed = true; }
}
const descendants = (root, className) => root.children.flatMap(child => child instanceof Element
  ? [...(child.className?.split(' ').includes(className) ? [child] : []), ...descendants(child, className)] : []);

async function withPicker(run) {
  const previousDocument = globalThis.document;
  const previousChrome = globalThis.chrome;
  const root = new Element('div');
  const requests = [];
  globalThis.document = { getElementById: () => root, createElement: tag => new Element(tag) };
  globalThis.chrome = { runtime: { lastError: null, sendMessage(request, callback) { requests.push({ request, callback }); } } };
  try { await run(root, requests); } finally { globalThis.document = previousDocument; globalThis.chrome = previousChrome; }
}

test('mapping picker shows repository profiles on focus, searches by login, ignores stale replies and preserves manual entry/skip', async () => {
  await withPicker(async (root, requests) => {
    const defaults = { destinationId: 'github:42', users: [
      { id: 1, login: 'octocat', name: 'The Octocat', avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4' },
      { login: 'evil', avatarUrl: 'https://attacker.example/avatar' },
    ] };
    let changed = 0;
    const refresh = renderUsers([{ id: 'person', displayName: 'Avery', entryCount: 1 }], () => defaults, () => { changed++; });
    const [input] = descendants(root, 'mapping-login-input');
    const [menu] = descendants(root, 'mapping-choices');
    const [skip] = descendants(root, 'mapping-skip-input');
    input.focus();
    assert.equal(menu.hidden, false);
    assert.equal(input.value, '');
    assert.equal(descendants(menu, 'mapping-choice').length, 2);
    assert.equal(descendants(menu, 'mapping-avatar').length, 1);
    assert.equal(descendants(menu, 'mapping-profile-login')[0].textContent, '@octocat');
    assert.equal(descendants(menu, 'mapping-name')[0].textContent, 'The Octocat');
    input.value = 'a'; input.dispatch('input');
    assert.equal(requests.length, 0);
    input.value = 'al'; input.dispatch('input');
    await new Promise(resolve => setTimeout(resolve, 280));
    assert.deepEqual(requests[0].request, { type: 'SEARCH_CLOCKIFY_GITHUB_USERS', payload: { destinationId: 'github:42', query: 'al' } });
    input.value = 'ali'; input.dispatch('input');
    await new Promise(resolve => setTimeout(resolve, 280));
    requests[1].callback({ ok: true, data: { users: [{ id: 3, login: 'alice', name: null, avatarUrl: null }] } });
    await Promise.resolve();
    requests[0].callback({ ok: true, data: { users: [{ login: 'stale' }] } });
    await Promise.resolve();
    assert.equal(descendants(menu, 'mapping-profile-login')[0].textContent, '@alice');
    assert.equal(descendants(menu, 'mapping-avatar').length, 0, 'searched users do not load avatars');
    assert.equal(descendants(menu, 'mapping-name').length, 0, 'search does not fetch public names');
    descendants(menu, 'mapping-choice')[0].dispatch('click');
    assert.equal(input.value, 'alice'); assert.equal(menu.hidden, true); assert.equal(changed, 1);
    input.value = 'manual-login'; input.dispatch('input');
    assert.equal(input.value, 'manual-login');
    input.value = ''; input.dispatch('input');
    assert.equal(descendants(menu, 'mapping-avatar').length, 1, 'repository suggestions retain avatars');
    skip.checked = true; skip.dispatch('change');
    assert.equal(input.disabled, true); assert.equal(input.value, ''); assert.equal(menu.hidden, true);
    assert.equal(changed, 2);
    refresh();
  });
});

test('Clockify migration preview is an extension page with Clockoli navigation and a safe-only roster', () => {
  assert.match(html, /<link rel="stylesheet" href="\.\.\/styles\/page-tabs\.css">/);
  assert.match(html, /href="\.\.\/times\/times\.html"/);
  assert.match(html, /href="\.\.\/options\/options\.html"/);
  assert.match(html, /aria-current="page"[^>]*>Migration</);
  assert.match(html, /id="entry-count"/);
  assert.match(html, /id="source-users"/);
  assert.match(html, /id="mapping-form"/);
  assert.match(html, /<section id="mapping-view" aria-labelledby="mapping-title">/);
  assert.match(html, /<section id="migration-view" aria-labelledby="migration-title" hidden>/);
  assert.match(html, /<h2 id="mapping-title">Map Clockify people<\/h2>/);
  assert.match(html, /<h2 id="migration-title">Migration<\/h2>/);
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

test('confirmation switches from the mapping view to a dedicated migration progress and result view', () => {
  assert.match(source, /const mappingView = \$\('mapping-view'\);/);
  assert.match(source, /const migrationView = \$\('migration-view'\);/);
  assert.match(source, /mappingView\.hidden = true; migrationView\.hidden = false;/);
  assert.match(source, /migrationView\.scrollIntoView\(\{ block: 'start' \}\)/);
  assert.doesNotMatch(html.slice(html.indexOf('id="mapping-view"'), html.indexOf('</section>', html.indexOf('id="mapping-view"'))), /id="import-status"/);
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

test('preview uses a custom profile dropdown, not a native datalist, with destination-scoped login search', () => {
  assert.doesNotMatch(html, /<datalist/);
  assert.doesNotMatch(source, /setAttribute\('list'/);
  assert.match(source, /type: 'GET_CLOCKIFY_MIGRATION_SUGGESTIONS'/);
  assert.match(source, /type: 'SEARCH_CLOCKIFY_GITHUB_USERS'/);
  assert.match(source, /destinationId, query/);
  assert.match(source, /className = 'mapping-choices'/);
  assert.match(css, /\.mapping-choices/);
  assert.match(css, /\.mapping-avatar/);
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
  assert.match(source, /isCompleted \? `Processed \$\{completed\} of \$\{total\} people`/);

});

test('preview renders the safe incoming-versus-existing comparison for an import ID collision', () => {
  assert.match(source, /const collision = diagnostic\?\.collision/);
  assert.match(source, /collision\.incoming\.provenanceSha256/);
  assert.match(source, /collision\.existing\.path/);
  assert.match(source, /collision\.comparison\.sameTimeRange/);
  assert.match(source, /collision\?\.recordId && collision\?\.path/);
  assert.doesNotMatch(source, /entryId/);
});

test('preview does not tell users to manually resolve an automatic import overlap', () => {
  assert.match(source, /could not resolve the imported intervals safely/);
  assert.doesNotMatch(source, /resolve the overlap/);
});
