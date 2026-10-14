import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { ChromeStore } from '../src/storage/chrome-store.js';
import { assertMessageAllowed } from '../src/background/message-policy.js';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('manifest.json'));
const worker = read('src/background/service-worker.js');
const content = read('src/content/github.js');
const policy = read('src/background/message-policy.js');

test('toolbar opens the same full-width tracking surface on GitHub and other HTTP(S) pages', () => {
  assert.equal(manifest.action?.default_popup, undefined);
  assert.ok(manifest.permissions.includes('activeTab'));
  assert.ok(manifest.permissions.includes('scripting'));

  assert.match(worker, /async function toggleActionSurface\(tab\)/);
  assert.match(worker, /chrome\.scripting\.executeScript\(\{[\s\S]*target: \{ tabId: tab\.id \}[\s\S]*globalThis\.__CLOCKOLI_ACTION_SURFACE__ = true/);
  assert.match(worker, /files: \['src\/domain\/recovery-actions\.js', 'src\/ui\/tracking-card\.js', 'src\/content\/task-timeline-component\.js', 'src\/content\/github\.js'\]/);
  assert.match(worker, /chrome\.action\.onClicked\.addListener\(tab => \{[\s\S]*toggleActionSurface\(tab\)/);
  assert.doesNotMatch(worker, /restoreActionPopup|REGISTER_GITHUB_ACTION_SURFACE/);

  assert.match(content, /const actionSurfaceMode = globalThis\.__CLOCKOLI_ACTION_SURFACE__ === true/);
  assert.match(content, /else if \(actionSurfaceMode\) \{[\s\S]*toggleFullWidthPopup\(\)/);
  assert.match(content, /renderMenu\(\{ compact: true, onClose: closeFullWidthPopup \}\)/);
  assert.match(content, /:host\(\.full-width-popup-surface\) \.full-width-popup \{ width:100vw; max-width:none/);
  assert.doesNotMatch(policy, /REGISTER_GITHUB_ACTION_SURFACE/);
});

test('toolbar always opens a partial-height panel with independently selected width', () => {
  assert.doesNotMatch(read('src/options/options.html'), /id="toolbar-display-mode"/);
  assert.doesNotMatch(policy, /SET_TOOLBAR_DISPLAY_MODE/);
  assert.match(worker, /chrome\.action\.setPopup\(\{ popup: '' \}\)/);
  assert.match(content, /:host\(\.full-width-popup-surface\) \.full-width-popup \{[^}]*max-height:min\(720px,70vh\)/);
  assert.match(content, /:host\(\.full-width-popup-surface\[data-clockoli-width="contained"\]\) \.tracker-toolbar,:host\(\.full-width-popup-surface\[data-clockoli-width="contained"\]\) \.menu-body \{ max-width:1100px; margin-inline:auto \}/);
  assert.doesNotMatch(content, /:host\(\.full-width-popup-surface\[data-clockoli-width="contained"\]\) \.full-width-popup \{ width:min\(/);
});

test('interface width persists and only options may write it', async () => {
  const values = new Map();
  const backend = {
    async getMany(keys) { return Object.fromEntries(keys.map(key => [key, values.get(key)])); },
    async mutateMany(keys, update) {
      const { set, result } = update(await this.getMany(keys));
      for (const [key, value] of Object.entries(set)) values.set(key, value);
      return result;
    },
  };
  const store = new ChromeStore(backend);
  assert.equal((await store.getLocalPreferences()).interfaceWidth, 'contained');
  await assert.rejects(() => store.setInterfaceWidth('gigantic'), /width/i);
  assert.equal(values.size, 0);
  await store.setInterfaceWidth('full');
  assert.equal((await new ChromeStore(backend).getLocalPreferences()).interfaceWidth, 'full');
  const origin = 'chrome-extension://clockoli/';
  assert.doesNotThrow(() => assertMessageAllowed('SET_INTERFACE_WIDTH', { url: `${origin}src/options/options.html` }, origin));
  assert.throws(() => assertMessageAllowed('SET_INTERFACE_WIDTH', { url: 'https://github.com/acme/app/issues/1', tab: { id: 3 } }, origin), /not allowed/);
  assert.throws(() => assertMessageAllowed('SET_TOOLBAR_DISPLAY_MODE', { url: `${origin}src/options/options.html` }, origin), /not allowed/);
});

test('worker clears any previously configured action popup on startup', async () => {
  const calls = [];
  const context = vm.createContext({ chrome: { action: { setPopup: async value => { calls.push(value); } } }, console });
  const init = worker.match(/void chrome\.action\.setPopup\(\{ popup: '' \}\)\.catch\([^\n]+;/)?.[0];
  assert.ok(init);
  vm.runInContext(init, context);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ popup: '' }]);
});

test('compact popup loads the shared timeline component before its tracking controller', () => {
  const popup = read('src/popup/popup.html');
  assert.match(popup, /<script src="\.\.\/content\/task-timeline-component\.js"><\/script>/);
  assert.ok(popup.indexOf('task-timeline-component.js') < popup.indexOf('github.js'));
});

async function actionHarness({ delivered = false, failure = 0 } = {}) {
  const { default: vm } = await import('node:vm');
  const calls = [];
  const context = vm.createContext({ URL, chrome: {
    runtime: { getURL: path => `chrome-extension://clockoli/${path}` },
    tabs: {
      sendMessage: async (...args) => { calls.push(['message', ...args]); if (!delivered) throw new Error('No receiver'); },
      create: async options => { calls.push(['tab', options]); },
    },
    scripting: { executeScript: async options => {
      calls.push(['inject', options]);
      if (calls.filter(([kind]) => kind === 'inject').length === failure) throw new Error('Cannot access this page');
    } },
  } });
  const helper = worker.match(/async function openTimesPage\(\) \{[\s\S]*?\n\}/)?.[0] || '';
  vm.runInContext(`${helper}\n${worker.slice(worker.indexOf('async function toggleActionSurface('), worker.indexOf("void chrome.action.setPopup({ popup: '' })"))}`, context);
  return { calls, toggle: tab => context.toggleActionSurface(tab) };
}

test('toolbar falls back to Activity for restricted, missing, and invalid tab URLs', async () => {
  for (const url of ['chrome://settings', 'file:///tmp/example.pdf', 'chrome-extension://pdf-viewer/index.html', 'about:blank', '', 'invalid']) {
    const harness = await actionHarness();
    await harness.toggle({ id: 1, url });
    assert.equal(harness.calls.filter(([kind]) => kind === 'inject').length, 0);
    assert.equal(harness.calls.at(-1)[0], 'tab');
    assert.equal(harness.calls.at(-1)[1].url, 'chrome-extension://clockoli/src/times/times.html');
  }
  const harness = await actionHarness();
  await harness.toggle({});
  assert.equal(harness.calls.at(-1)[0], 'tab');
});

test('toolbar preserves delivery and HTTP injection order and falls back on either injection failure', async () => {
  const delivered = await actionHarness({ delivered: true });
  await delivered.toggle({ id: 1, url: 'https://github.com/acme/app/issues/1' });
  assert.deepEqual(delivered.calls.map(([kind]) => kind), ['message']);
  const injected = await actionHarness();
  await injected.toggle({ id: 1, url: 'https://example.org' });
  assert.deepEqual(injected.calls.map(([kind]) => kind), ['message', 'inject', 'inject']);
  for (const url of ['https://chromewebstore.google.com/detail/example', 'https://example.org/file.pdf']) {
    for (const failure of [1, 2]) {
      const harness = await actionHarness({ failure });
      await harness.toggle({ id: 1, url });
      assert.equal(harness.calls.filter(([kind]) => kind === 'tab').length, 1);
    }
  }
});

test('activating another tab dismisses panels in inactive tabs even without page visibility events', async () => {
  assert.match(worker, /chrome\.tabs\.onActivated\.addListener\(/);
  const calls = [];
  const { default: vm } = await import('node:vm');
  const context = vm.createContext({ chrome: { tabs: {
    query: async () => [{ id: 11, active: false }, { id: 12, active: true }, { id: 13, active: false }],
    sendMessage: async (id, message) => { calls.push({ id, message }); if (id === 13) throw new Error('No receiver'); },
  } } });
  const helper = worker.match(/async function dismissInactivePanels\([^]*?\n\}/)?.[0];
  assert.ok(helper);
  vm.runInContext(helper, context);
  await context.dismissInactivePanels({ tabId: 12, windowId: 4 });
  assert.deepEqual(calls.map(({ id, message }) => [id, message.type]), [[11, 'DISMISS_FULL_WIDTH_POPUP'], [13, 'DISMISS_FULL_WIDTH_POPUP']]);
});

test('action panel opens from local state and lets handled Escape stay inside the editor', () => {
  const start = content.indexOf('  async function toggleFullWidthPopup()');
  const end = content.indexOf('\n  function renderUi()', start);
  const open = content.slice(start, end);
  assert.ok(open.indexOf('refresh: false') >= 0);
  assert.ok(open.indexOf('refresh: true') > open.indexOf('refresh: false'));
  assert.match(content, /event\.defaultPrevented/);
  assert.match(content, /prefers-reduced-motion: no-preference/);
  assert.doesNotMatch(content, /#ff2d55|summaryFrames|summaryIndex|displayMs/);
});

test('shadow chrome defines local light and dark tokens without bare theme colors in selectors', () => {
  const start = content.indexOf("    const style = el('style', `", content.indexOf('  function renderUi()'));
  const end = content.indexOf('    if (fullWidthPopupOpen) {', start);
  const stylesheet = content.slice(start, end);
  assert.match(stylesheet, /@media \(prefers-color-scheme: dark\) \{\s*:host, :where\(:host > :not\(style\)\) \{/);
  const definitions = [...stylesheet.matchAll(/--ck-[\w-]+:\s*var\(--[^;]+;/g)].map(match => match[0]);
  assert.ok(definitions.includes('--ck-bg: var(--bgColor-default,#fff);'));
  assert.ok(definitions.includes('--ck-bg: var(--bgColor-default,#0d1117);'));
  assert.ok(definitions.includes('--ck-fg: var(--fgColor-default,#1f2328);'));
  assert.ok(definitions.includes('--ck-fg: var(--fgColor-default,#f0f6fc);'));
  const uses = stylesheet.replace(/--[\w-]+:\s*[^;]+;/g, '');
  assert.doesNotMatch(uses, /#[\da-f]{3,8}\b/i, 'all theme colors belong to token definitions');
  for (const name of new Set([...uses.matchAll(/var\((--ck-[\w-]+)\)/g)].map(match => match[1]))) {
    assert.equal(definitions.filter(value => value.startsWith(`${name}:`)).length, 2, `${name} has both light and dark host-first definitions`);
  }
});
