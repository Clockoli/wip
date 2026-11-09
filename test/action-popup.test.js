import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { ChromeStore } from '../src/storage/chrome-store.js';
import { normalizeTaskUrl, parseGitHubProjectPaneIssueUrl } from '../src/domain/values.js';
import { assertMessageAllowed } from '../src/background/message-policy.js';

const read = path => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('manifest.json'));
const worker = read('src/background/service-worker.js');
const content = read('src/content/github.js');
const policy = read('src/background/message-policy.js');

test('toolbar opens Activity in its own tab and hands off only the clicked URL', () => {
  assert.equal(manifest.action?.default_popup, undefined);
  for (const permission of ['activeTab', 'tabs']) assert.ok(manifest.permissions.includes(permission));
  assert.equal(manifest.permissions.includes('storage'), false);
  assert.match(worker, /chrome\.action\.onClicked\.addListener\(tab => \{[\s\S]*toggleActionSurface\(tab\)/);
  assert.match(worker, /actionContextBackend\.setMany\(\{ \[ACTION_CONTEXT_KEY\]: toolbarTaskContext\(tab\) \}\)/);
  const handler = worker.slice(worker.indexOf('async function openActivityFromTab('), worker.indexOf("async function applyToolbarClickMode(mode)"));
  assert.doesNotMatch(handler, /chrome\.scripting|chrome\.tabs\.sendMessage|TOGGLE_FULL_WIDTH_POPUP/);
  assert.match(content, /renderActionSourceContext\(\)/);
  const times = read('src/times/times.html');
  assert.match(times, /id="activity-source-context"/);
  assert.match(times, /id="activity-source-track"/);
  assert.match(times, /id="activity-source-dismiss"/);
});

test('Activity consumes toolbar context from private one-use IndexedDB, never from the extension URL', () => {
  assert.match(content, /chrome\.runtime\.onMessage\?\.addListener\?\./);
  assert.match(content, /send\(\{ type: 'CONSUME_TOOLBAR_TASK_CONTEXT' \}\)/);
  assert.match(worker, /actionContextBackend\.mutateMany\(\[ACTION_CONTEXT_KEY\]/);
  assert.match(worker, /delete: present \? \[ACTION_CONTEXT_KEY\] : \[\]/);
  const origin = 'chrome-extension://clockoli/';
  assert.doesNotThrow(() => assertMessageAllowed('CONSUME_TOOLBAR_TASK_CONTEXT',
    { url: origin + 'src/times/times.html' }, origin));
  assert.throws(() => assertMessageAllowed('CONSUME_TOOLBAR_TASK_CONTEXT',
    { url: 'https://github.com/org/repo/issues/1', tab: { id: 1 } }, origin), /not allowed/i);
  assert.match(content, /age >= -10_000 && age <= 120_000/);
  assert.match(content, /actionSourceTask = task\?\.taskUrl === value\?\.taskUrl \? task : null/);
  assert.match(content, /trackCurrentTimelineTask\(\{ sourceTask: task, preserveSavedDescription: true \}\)/);
  assert.match(content, /link\.textContent = githubTabTitle\(task\.taskTitle\) \|\| task\.taskUrl/);
  assert.doesNotMatch(read('src/times/times.html'), /src\/times\/times\.html\?task=|location\.hash/);
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

test('worker restores the saved toolbar behavior after restart', async () => {
  const apply = worker.match(/async function applyToolbarClickMode\(mode\) \{[\s\S]*?\n\}/)?.[0];
  const init = worker.match(/void store\.getToolbarClickMode\(\)\.then\(applyToolbarClickMode\)\.catch\([^\n]+;/)?.[0];
  assert.ok(apply);
  assert.ok(init);
  for (const [mode, expected] of [['tab', ''], ['popup', 'src/popup/quick.html']]) {
    const calls = [];
    const context = vm.createContext({
      store: { getToolbarClickMode: async () => mode },
      chrome: { action: { setPopup: async value => { calls.push(value.popup); } } }, console,
    });
    vm.runInContext(`const TOOLBAR_POPUP_PATH = 'src/popup/popup.html';\n${apply}\n${init}`, context);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, [expected]);
  }
});

test('toolbar click mode is local, defaults to Activity, and validates changes', async () => {
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
  assert.equal(await store.getToolbarClickMode(), 'tab');
  assert.equal((await store.getLocalPreferences()).toolbarClickMode, 'tab');
  await assert.rejects(() => store.setToolbarClickMode('unknown'), /toolbar click mode/i);
  assert.equal(values.size, 0);
  await store.setToolbarClickMode('popup');
  assert.equal(await new ChromeStore(backend).getToolbarClickMode(), 'popup');
  assert.equal((await store.getLocalPreferences()).toolbarClickMode, 'popup');
  await store.setToolbarClickMode('tab');
  assert.equal(await store.getToolbarClickMode(), 'tab');
  const origin = 'chrome-extension://clockoli/';
  assert.doesNotThrow(() => assertMessageAllowed('SET_TOOLBAR_CLICK_MODE', { url: origin + 'src/options/options.html' }, origin));
  assert.throws(() => assertMessageAllowed('SET_TOOLBAR_CLICK_MODE',
    { url: 'https://github.com/acme/app/issues/1', tab: { id: 3 } }, origin), /not allowed/i);
  assert.match(worker, /sender\?\.url !== chrome\.runtime\.getURL\('src\/options\/options\.html'\)[\s\S]*?Invalid toolbar click mode request/);
  assert.match(worker, /Object\.keys\(message\)\.sort\(\)\.join\(','\) !== 'mode,type'/);
  const options = read('src/options/options.html');
  const controller = read('src/options/options.js');
  assert.match(options, /id="toolbar-click-mode"/);
  assert.match(options, /value="tab">Open Activity in a new tab/);
  assert.match(options, /value="popup">Open quick popup/);
  assert.match(controller, /type: 'SET_TOOLBAR_CLICK_MODE', mode: control\.value/);
});

test('quick popup does not load Activity, Timeline or Calendar controllers', () => {
  const quick = read('src/popup/quick.html');
  const js = read('src/popup/quick.js');
  assert.match(quick, /src="quick\.js"/);
  assert.doesNotMatch(quick, /github\.js|task-timeline-component|weekly-summary|timeline|calendar/i);
  assert.doesNotMatch(js, /renderMenu|renderPopupTimeline|activity-view-switcher|calendar-week-navigation/);
  assert.match(js, /type: 'GET_PAGE_STATE'/);
  assert.match(js, /type: 'LOAD_RECENT', menuData: true/);
  assert.match(js, /type: 'START'/);
  assert.match(js, /type: 'STOP'/);
  assert.match(js, /type: 'SWITCH_TASK'/);
  assert.match(js, /type: 'OPEN_TIMES'/);
});

test('legacy compact popup loads the shared timeline component before its tracking controller', () => {
  const popup = read('src/popup/popup.html');
  assert.match(popup, /<script src="\.\.\/content\/task-timeline-component\.js"><\/script>/);
  assert.ok(popup.indexOf('task-timeline-component.js') < popup.indexOf('github.js'));
});

async function actionHarness({ delivered = false, failure = 0, existingTabs = [], queryGate = null, closeOnActivate = false, moveOnActivate = null, navigateOnActivate = null,
  setup = { auth: { mode: 'github_app' }, registry: { defaultDestinationId: 'github:20' } } } = {}) {
  const { default: vm } = await import('node:vm');
  const calls = [], setupReads = [];
  let currentSetup = setup;
  const context = vm.createContext({ URL, normalizeTaskUrl, parseGitHubProjectPaneIssueUrl,
    actionContextBackend: { setMany: async values => { calls.push(['context', values]); } },
    configuredSnapshot: async options => { setupReads.push(options); if (currentSetup instanceof Error) throw currentSetup; return currentSetup; },
    chrome: {
    runtime: { getURL: path => `chrome-extension://clockoli/${path}`,
      openOptionsPage: async () => { calls.push(['settings']); },
      sendMessage: async message => { calls.push(['signal', message]); } },
    tabs: {
      sendMessage: async (...args) => { calls.push(['message', ...args]); if (!delivered) throw new Error('No receiver'); },
      query: async options => {
        calls.push(['query', options]);
        if (queryGate) await queryGate;
        return existingTabs.filter(tab => !options.url || tab.url === options.url).map(tab => ({ ...tab }));
      },
      update: async (id, options) => {
        calls.push(['activate', id, options]);
        if (closeOnActivate) { existingTabs.splice(existingTabs.findIndex(tab => tab.id === id), 1); throw new Error('No tab with id'); }
        const tab = existingTabs.find(item => item.id === id);
        if (moveOnActivate) tab.windowId = moveOnActivate;
        if (navigateOnActivate) tab.pendingUrl = navigateOnActivate;
        return { ...tab };
      },
      get: async id => {
        const tab = existingTabs.find(item => item.id === id);
        if (!tab) throw new Error('No tab with id');
        return tab;
      },
      create: async options => { calls.push(['tab', options]); existingTabs.push({ id: 100, windowId: 1, pendingUrl: options.url }); },
    },
    windows: { update: async (id, options) => { calls.push(['focus', id, options]); } },
    scripting: { executeScript: async options => {
      calls.push(['inject', options]);
      if (calls.filter(([kind]) => kind === 'inject').length === failure) throw new Error('Cannot access this page');
    } },
  } });
  const helper = worker.match(/async function openTimesPage\(\) \{[\s\S]*?\n\}/)?.[0] || '';
  vm.runInContext(`const ACTION_CONTEXT_KEY = 'clockoli-toolbar-task-context';\nlet openingTimesPage = null;\n${helper}\n${worker.slice(worker.indexOf('async function shouldOpenOnboarding('), worker.indexOf("async function applyToolbarClickMode(mode)"))}`, context);
  return { calls, setupReads, setSetup: next => { currentSetup = next; },
    toggle: tab => context.toggleActionSurface(tab), openActivity: () => context.openTimesPage() };
}

test('toolbar returns to onboarding until GitHub authorization and a default time repository exist', async () => {
  const incomplete = [
    { auth: null, registry: { defaultDestinationId: null } },
    { auth: { mode: 'github_app' }, registry: { defaultDestinationId: null } },
    { auth: null, registry: { defaultDestinationId: 'github:20' } },
  ];
  for (const setup of incomplete) {
    const harness = await actionHarness({ setup });
    for (const tab of [
      { id: 1, url: 'chrome://extensions' },
      { id: 2, url: 'https://example.com/task' },
      {},
    ]) await harness.toggle(tab);
    assert.deepEqual(harness.calls, [['settings'], ['settings'], ['settings']]);
    assert.equal(harness.setupReads.length, 3, 'each click checks durable setup state');
    assert.ok(harness.setupReads.every(read => read.localOnly === true));
    assert.equal(harness.calls.some(([kind]) => ['tab', 'inject', 'message'].includes(kind)), false);
  }
});

test('Activity navigation also returns to onboarding when setup is incomplete', async () => {
  const harness = await actionHarness({ setup: { auth: { mode: 'github_app' }, registry: { defaultDestinationId: null } } });
  await harness.openActivity();
  assert.deepEqual(harness.calls, [['settings']]);
  harness.setSetup({ auth: { mode: 'pat' }, registry: { defaultDestinationId: 'github:5' } });
  await harness.openActivity();
  assert.deepEqual(harness.calls.filter(([kind]) => kind === 'tab').map(([, tab]) => tab.url),
    ['chrome-extension://clockoli/src/times/times.html']);
});

test('toolbar opens Settings as recovery when local setup cannot be read', async () => {
  const harness = await actionHarness({ setup: new Error('local storage unavailable') });
  await harness.toggle({ id: 1, url: 'chrome://settings' });
  assert.deepEqual(harness.calls, [['settings']]);
});

test('toolbar opens Activity again immediately after first setup without restarting the worker', async () => {
  const harness = await actionHarness({ setup: { auth: { mode: 'github_app' }, registry: { defaultDestinationId: null } } });
  await harness.toggle({ id: 1, url: 'chrome://extensions' });
  harness.setSetup({ auth: { mode: 'github_app' }, registry: { defaultDestinationId: 'github:20' } });
  await harness.toggle({ id: 1, url: 'chrome://extensions' });
  assert.deepEqual(harness.calls.filter(([kind]) => kind === 'settings'), [['settings']]);
  assert.deepEqual(harness.calls.filter(([kind]) => kind === 'tab').map(([, tab]) => tab.url),
    ['chrome-extension://clockoli/src/times/times.html']);
});

test('toolbar falls back to Activity for restricted, missing, and invalid tab URLs', async () => {
  for (const url of ['chrome://settings', 'file:///tmp/example.pdf', 'chrome-extension://pdf-viewer/index.html', 'about:blank', '', 'invalid']) {
    const harness = await actionHarness();
    await harness.toggle({ id: 1, url });
    assert.equal(harness.calls.filter(([kind]) => kind === 'inject').length, 0);
    assert.equal(harness.calls.filter(([kind]) => kind === 'tab').at(-1)[1].url, 'chrome-extension://clockoli/src/times/times.html');
  }
  const harness = await actionHarness();
  await harness.toggle({});
  assert.equal(harness.calls.filter(([kind]) => kind === 'tab').at(-1)[0], 'tab');
});

test('toolbar reuses an existing Activity tab across windows without navigating it', async () => {
  const activityUrl = 'chrome-extension://clockoli/src/times/times.html';
  const harness = await actionHarness({ existingTabs: [
    { id: 8, windowId: 2, url: 'chrome-extension://clockoli/src/options/options.html' },
    { id: 9, windowId: 3, url: activityUrl },
  ] });
  await harness.toggle({ id: 1, url: 'chrome://extensions' });
  await harness.toggle({ id: 1, url: 'chrome://newtab/' });
  assert.deepEqual(JSON.parse(JSON.stringify(harness.calls.filter(([kind]) => ['query', 'activate', 'focus', 'tab'].includes(kind)))), [
    ['query', { url: activityUrl }], ['activate', 9, { active: true }], ['focus', 3, { focused: true }],
    ['query', { url: activityUrl }], ['activate', 9, { active: true }], ['focus', 3, { focused: true }],
  ]);
});

test('toolbar focuses the new window if Activity moves there during activation', async () => {
  const harness = await actionHarness({
    existingTabs: [{ id: 9, windowId: 3, url: 'chrome-extension://clockoli/src/times/times.html' }],
    moveOnActivate: 4,
  });
  await harness.toggle({ id: 1, url: 'chrome://extensions' });
  assert.deepEqual(JSON.parse(JSON.stringify(harness.calls.filter(([kind]) => kind === 'focus').at(-1))), ['focus', 4, { focused: true }]);
});

test('toolbar rediscovers Activity after the service worker restarts', async () => {
  const activityUrl = 'chrome-extension://clockoli/src/times/times.html';
  const restarted = await actionHarness({ existingTabs: [{ id: 21, windowId: 4, url: activityUrl }] });
  await restarted.toggle({ id: 7, url: 'about:blank' });
  assert.deepEqual(restarted.calls.map(([kind]) => kind), ['context', 'query', 'activate', 'focus', 'signal']);
  assert.equal(restarted.calls.some(([kind]) => kind === 'tab'), false);
});

test('concurrent toolbar clicks create only one Activity tab', async () => {
  let release;
  const queryGate = new Promise(resolve => { release = resolve; });
  const harness = await actionHarness({ queryGate });
  const first = harness.toggle({ id: 1, url: 'chrome://settings' });
  const second = harness.toggle({ id: 1, url: 'chrome://extensions' });
  release();
  await Promise.all([first, second]);
  assert.equal(harness.calls.filter(([kind]) => kind === 'tab').length, 1);
});

test('a closed Activity tab falls back to creating a new one', async () => {
  const harness = await actionHarness({
    existingTabs: [{ id: 9, windowId: 3, url: 'chrome-extension://clockoli/src/times/times.html' }],
    closeOnActivate: true,
  });
  await harness.toggle({ id: 1, url: 'chrome://extensions' });
  assert.deepEqual(harness.calls.map(([kind]) => kind), ['context', 'query', 'activate', 'tab', 'signal']);
});

test('a still-loading Activity tab is reused on the next click', async () => {
  const harness = await actionHarness({ existingTabs: [
    { id: 9, windowId: 3, pendingUrl: 'chrome-extension://clockoli/src/times/times.html' },
  ] });
  await harness.toggle({ id: 1, url: 'chrome://extensions' });
  assert.equal(harness.calls.filter(([kind]) => kind === 'tab').length, 0);
  assert.equal(harness.calls.filter(([kind]) => kind === 'activate')[0][1], 9);
});

test('a tab navigating to Activity is reused despite its old committed URL', async () => {
  const activityUrl = 'chrome-extension://clockoli/src/times/times.html';
  const harness = await actionHarness({ existingTabs: [
    { id: 9, windowId: 3, url: 'chrome-extension://clockoli/src/options/options.html', pendingUrl: activityUrl },
  ] });
  await harness.toggle({ id: 1, url: 'chrome://settings' });
  assert.equal(harness.calls.filter(([kind]) => kind === 'tab').length, 0);
  assert.equal(harness.calls.filter(([kind]) => kind === 'activate')[0][1], 9);
});

test('a tab navigating away from Activity is not reused', async () => {
  const activityUrl = 'chrome-extension://clockoli/src/times/times.html';
  const harness = await actionHarness({ existingTabs: [
    { id: 9, windowId: 3, url: activityUrl, pendingUrl: 'chrome-extension://clockoli/src/options/options.html' },
  ] });
  await harness.toggle({ id: 1, url: 'chrome://settings' });
  assert.equal(harness.calls.filter(([kind]) => kind === 'tab').length, 1);
  assert.equal(harness.calls.filter(([kind]) => kind === 'activate').length, 0);
});

test('a tab beginning to navigate away during activation is not reused', async () => {
  const activityUrl = 'chrome-extension://clockoli/src/times/times.html';
  const harness = await actionHarness({
    existingTabs: [{ id: 9, windowId: 3, url: activityUrl }],
    navigateOnActivate: 'chrome-extension://clockoli/src/options/options.html',
  });
  await harness.toggle({ id: 1, url: 'chrome://settings' });
  assert.equal(harness.calls.filter(([kind]) => kind === 'tab').length, 1);
});

test('toolbar preserves canonical URL and title without injecting into the source page', async () => {
  const harness = await actionHarness();
  await harness.toggle({
    id: 1, url: 'https://github.com/acme/app/issues/7?foo=bar#discussion_r1',
    title: 'Fix UI by alice · Issue #7 · acme/app',
  });
  const value = harness.calls.find(([kind]) => kind === 'context')[1]['clockoli-toolbar-task-context'];
  assert.equal(value.taskUrl, 'https://github.com/acme/app/issues/7');
  assert.equal(value.taskTitle, 'Fix UI by alice · Issue #7 · acme/app');
  assert.ok(Date.now() - value.openedAt < 60_000);
  assert.equal(harness.calls.filter(([kind]) => kind === 'inject').length, 0);
  assert.equal(harness.calls.filter(([kind]) => kind === 'message').length, 0);
  assert.equal(harness.calls.filter(([kind]) => kind === 'tab').length, 1);
});

test('toolbar normalizes Projects issue links and clears context on restricted pages', async () => {
  const harness = await actionHarness();
  await harness.toggle({ id: 4, url: 'https://github.com/orgs/acme/projects/1/views/2?pane=issue&issue=acme%7Capp%7C9' });
  assert.equal(harness.calls.find(([kind]) => kind === 'context')[1]['clockoli-toolbar-task-context'].taskUrl,
    'https://github.com/acme/app/issues/9');
  await harness.toggle({ id: 5, url: 'chrome://extensions' });
  assert.equal(harness.calls.filter(([kind]) => kind === 'context').at(-1)[1]['clockoli-toolbar-task-context'], null);
});

test('GitHub page icon opens Activity through the same source-context handoff, never an overlay', () => {
  assert.match(content, /main\.addEventListener\('click',[\s\S]*?send\(\{ type: 'OPEN_TIMES' \}\)/);
  assert.match(worker, /if \(githubPage\) await openActivityFromTab\(sender\.tab\)/);
  assert.doesNotMatch(content, /toggleFullWidthPopup|renderFullWidthPopup|fullWidthPopupOpen|full-width-popup-surface/);
  assert.doesNotMatch(worker, /DISMISS_FULL_WIDTH_POPUP|TOGGLE_FULL_WIDTH_POPUP/);
  const origin = 'chrome-extension://clockoli/';
  assert.doesNotThrow(() => assertMessageAllowed('OPEN_TIMES', { url: 'https://github.com/acme/repo/issues/7', tab: { id: 9 } }, origin));
  assert.throws(() => assertMessageAllowed('CONSUME_TOOLBAR_TASK_CONTEXT', { url: 'https://github.com/acme/repo/issues/7', tab: { id: 9 } }, origin));
});

test('shadow chrome defines local light and dark tokens without bare theme colors in selectors', () => {
  const start = content.indexOf("    const style = el('style', `", content.indexOf('  function renderUi()'));
  const end = content.indexOf('    if (popupMode) style.textContent +=', start);
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
