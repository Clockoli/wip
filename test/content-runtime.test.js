import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/content/github.js', import.meta.url), 'utf8');
const recoverySource = await readFile(new URL('../src/domain/recovery-actions.js', import.meta.url), 'utf8');

const createdNodes = [];

class FakeNode {
  constructor(tag = '') {
    createdNodes.push(this);
    this.tag = tag;
    this.id = '';
    this.textContent = '';
    this.className = '';
    this.isConnected = false;
    this.shadowRoot = null;
    this.children = [];
    this.parentElement = null;
    this.attributes = new Map();
    this.style = {};
    this.classList = {
      add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(' '); },
      remove: (...names) => { const removed = new Set(names); this.className = this.className.split(/\s+/).filter(name => name && !removed.has(name)).join(' '); },
      contains: name => this.className.split(/\s+/).includes(name),
    };
  }
  get nextElementSibling() {
    if (!this.parentElement) return null;
    const index = this.parentElement.children.indexOf(this);
    return this.parentElement.children[index + 1] ?? null;
  }
  append(...nodes) {
    for (const node of nodes) {
      if (node && typeof node === 'object') {
        this.children.push(node); node.parentElement = this; node.isConnected = true;
        if (node.id) documentNodes.set(node.id, node);
      }
    }
  }
  prepend(...nodes) {
    for (const node of [...nodes].reverse()) {
      if (node && typeof node === 'object') { this.children.unshift(node); node.parentElement = this; node.isConnected = true; }
    }
  }
  insertBefore(node, anchor) {
    const index = this.children.indexOf(anchor); if (index < 0) throw new Error('anchor not found');
    if (node.parentElement) node.parentElement.children = node.parentElement.children.filter(child => child !== node);
    this.children.splice(index, 0, node); node.parentElement = this; node.isConnected = true;
    if (node.id) documentNodes.set(node.id, node);
  }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  remove() {
    if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this);
    this.parentElement = null; this.isConnected = false; if (this.id) documentNodes.delete(this.id);
  }
  addEventListener(type, listener, options) { this[`on${type}`] = listener; this[`${type}Options`] = options; }
  setPointerCapture(pointerId) { this.capturedPointer = pointerId; }
  releasePointerCapture(pointerId) { if (this.capturedPointer === pointerId) this.capturedPointer = null; }
  getBoundingClientRect() { return { left: 0, right: 300, width: 300, top: 0, bottom: 32, height: 32 }; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); if (name === 'class') this.className = String(value); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  querySelector(selector) {
    if (selector === 'img.avatar') return this.walk().find(node => node.tag === 'img' && node.className.split(/\s+/).includes('avatar')) ?? null;
    if (selector === 'img[data-testid="github-avatar"]') return this.walk().find(node => node.tag === 'img' && node.getAttribute('data-testid') === 'github-avatar') ?? null;
    return null;
  }
  walk() { return [this, ...this.children.flatMap(child => typeof child.walk === 'function' ? child.walk() : [])]; }
  contains(node) { return this.walk().includes(node); }
  attachShadow({ mode }) {
    const shadow = new FakeNode('shadow');
    if (mode === 'open') this.shadowRoot = shadow;
    return shadow;
  }
}

function makeHeader() {
  const actions = new FakeNode('div'); actions.className = 'AppHeader-actions'; actions.isConnected = true;
  const avatarSlot = new FakeNode('div'); const avatar = new FakeNode('img'); avatar.className = 'avatar';
  avatarSlot.append(avatar); actions.append(avatarSlot);
  return { actions, avatarSlot };
}

function makeModernHeader() {
  const right = new FakeNode('div'); right.setAttribute('data-testid', 'top-nav-right'); right.isConnected = true;
  const topBarActions = new FakeNode('div'); topBarActions.setAttribute('data-testid', 'top-bar-actions');
  const avatarSlot = new FakeNode('div');
  const avatarButton = new FakeNode('button'); avatarButton.setAttribute('data-login', 'alice');
  const avatar = new FakeNode('img'); avatar.setAttribute('data-testid', 'github-avatar');
  avatarButton.append(avatar); avatarSlot.append(avatarButton); right.append(topBarActions, avatarSlot);
  return { right, topBarActions, avatarSlot };
}


const documentNodes = new Map();

test('GitHub SPA route changes reset saved panel scroll before the next reopen', () => {
  assert.match(source, /lastRoute = route; recent = \[\]; recentLoaded = false; recentFresh = false; cancelActiveInlineDraft\(\); menuOpen = false; menuScrollTop = 0; navigationOpen = false/);
});

test('tracking-panel rerenders preserve the current user scroll position', () => {
  assert.match(source, /if \(event\?\.isTrusted\) menuScrollTop = menu\.scrollTop/);
  assert.match(source, /const preservedMenuScrollTop = menuScrollTop/);
  assert.match(source, /restoreMenuScroll\(preservedMenuScrollTop\)/);
});

test('task result rendering clamps maximum untitled URLs and titles without losing their full values', async () => {
  const exposedSource = source.replace("function taskResult(value, className = '') {", "globalThis.__taskResult = function taskResult(value, className = '') {");
  assert.notEqual(exposedSource, source, 'taskResult is exposed only inside this renderer contract test');
  const location = { protocol: 'https:', hostname: 'github.com', pathname: '/acme/app/issues/1', href: 'https://github.com/acme/app/issues/1' };
  const { actions } = makeHeader();
  const document = {
    documentElement: new FakeNode('html'), activeElement: null,
    createElement: tag => new FakeNode(tag), createElementNS: (namespace, tag) => new FakeNode(tag),
    createTextNode: value => ({ textContent: value }), getElementById: id => documentNodes.get(id) ?? null,
    querySelector: selector => selector === '.AppHeader-actions' ? actions : null, addEventListener() {},
  };
  const context = vm.createContext({
    location, document, URL,
    chrome: { runtime: { lastError: null, sendMessage(message, callback) {
      callback({ ok: true, data: message.type === 'GET_PAGE_STATE' ? { configured: true, active: null, pendingCount: 0, pendingWrites: [] } : {} });
    } } },
    setInterval() { return 1; }, clearInterval() {}, setTimeout, Promise, Date, console,
  });
  new vm.Script(recoverySource, { filename: 'src/domain/recovery-actions.js' }).runInContext(context);
  new vm.Script(exposedSource, { filename: 'src/content/github.js' }).runInContext(context);

  const maximumUrl = `https://example.com/${'a'.repeat(2028)}`;
  assert.equal(maximumUrl.length, 2048);
  const untitled = context.__taskResult({ taskUrl: maximumUrl, taskTitle: '' });
  assert.equal(untitled.classList.contains('task-result-untitled'), true);
  assert.equal(untitled.children.length, 1);
  assert.equal(untitled.children[0].tag, 'a');
  assert.equal(untitled.children[0].textContent, maximumUrl);
  assert.equal(untitled.children[0].title, maximumUrl);
  assert.equal(untitled.children[0].href, maximumUrl);

  const maximumTitle = 'T'.repeat(300);
  const titled = context.__taskResult({ taskUrl: 'https://example.com/task', taskTitle: maximumTitle });
  assert.equal(titled.children.length, 2);
  assert.equal(titled.children[1].textContent, maximumTitle);
  assert.equal(titled.children[1].title, maximumTitle);
  await new Promise(resolve => setTimeout(resolve, 0));
});

test('query/hash churn cannot trigger authenticated GitHub refreshes', async () => {
  const intervals = [];
  const messages = [];
  const location = {
    protocol: 'https:', hostname: 'github.com', pathname: '/acme/app/issues/1', href: 'https://github.com/acme/app/issues/1',
  };
  const { actions, avatarSlot } = makeHeader();
  const document = {
    documentElement: new FakeNode('html'),
    createElement: tag => new FakeNode(tag),
    createElementNS: (namespace, tag) => new FakeNode(tag),
    createTextNode: text => ({ textContent: text }),
    getElementById: id => documentNodes.get(id) ?? null,
    querySelector: selector => selector === '.AppHeader-actions' ? actions : null,
    addEventListener() {},
  };
  const context = vm.createContext({
    location,
    document,
    chrome: {
      runtime: {
        lastError: null,
        sendMessage(message, callback) {
          messages.push(structuredClone(message));
          callback({ ok: true, data: message.type === 'GET_PAGE_STATE'
            ? { configured: true, active: null, pendingCount: 0 }
            : {} });
        },
      },
    },
    setInterval(callback) { intervals.push(callback); return intervals.length; },
    clearInterval() {},
    setTimeout,
    Promise,
    Date,
    console,
  });
  new vm.Script(recoverySource, { filename: 'src/domain/recovery-actions.js' }).runInContext(context);
  new vm.Script(source, { filename: 'src/content/github.js' }).runInContext(context);
  await new Promise(resolve => setTimeout(resolve, 0));
  const navigationCheck = intervals.at(-1);
  assert.deepEqual(messages, [
    { type: 'GET_PAGE_STATE', refresh: false },
    { type: 'GET_PAGE_STATE', refresh: true },
  ]);

  for (let index = 0; index < 100; index += 1) {
    location.href = `https://github.com/acme/app/issues/1?noise=${index}#${index}`;
    navigationCheck();
  }
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(messages.length, 2);

  location.pathname = '/acme/app/issues/2';
  location.href = 'https://github.com/acme/app/issues/2';
  navigationCheck();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(messages.length, 3);
  assert.equal(messages[2].refresh, false);

  location.pathname = '/acme/app/pull/2';
  location.href = 'https://github.com/acme/app/pull/2';
  navigationCheck();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(messages.length, 4);
  const trigger = createdNodes.filter(node => node.tag === 'button' && node.getAttribute('aria-haspopup') === 'dialog').at(-1);
  assert.equal(actions.children.at(-2)?.id, 'clockoli-root');
  assert.equal(actions.children.at(-1), avatarSlot);
  await trigger.onclick({ isTrusted: true });
  await new Promise(resolve => setTimeout(resolve, 0));
  const start = createdNodes.filter(node => node.tag === 'button' && node.textContent === 'Start tracking this task').at(-1);
  assert.ok(start?.onclick, 'Start handler was rendered in the pull-request menu');
  await start.onclick({ isTrusted: true });
  await new Promise(resolve => setTimeout(resolve, 0));
  const startMessage = messages.findLast(message => message.type === 'START');
  assert.equal(startMessage.taskUrl, 'https://github.com/acme/app/pull/2');
  assert.equal(startMessage.taskTitle, '');
});


test('stopping renders local stopped state without a stale remote refresh', async () => {
  documentNodes.clear(); createdNodes.length = 0;
  const messages = [];
  const startedAt = new Date(Date.now() - 60_000).toISOString();
  const location = {
    protocol: 'https:', hostname: 'github.com', pathname: '/acme/app/issues/1', href: 'https://github.com/acme/app/issues/1',
  };
  const { actions, avatarSlot } = makeHeader();
  const document = {
    documentElement: new FakeNode('html'),
    createElement: tag => new FakeNode(tag),
    createElementNS: (namespace, tag) => new FakeNode(tag),
    createTextNode: text => ({ textContent: text }),
    getElementById: id => documentNodes.get(id) ?? null,
    querySelector: selector => selector === '.AppHeader-actions' ? actions : null,
    addEventListener() {},
  };
  const active = {
    issue: { type: 'issue', owner: 'acme', repo: 'app', number: 1, url: 'https://github.com/acme/app/issues/1' },
    startedAt, description: '',
  };
  let pageRequests = 0;
  const context = vm.createContext({
    location, document,
    chrome: { runtime: { lastError: null, sendMessage(message, callback) {
      messages.push(structuredClone(message));
      if (message.type === 'GET_PAGE_STATE') {
        pageRequests += 1;
        callback({ ok: true, data: { configured: true, active: pageRequests <= 2 ? active : null, pendingCount: 0 } });
      } else if (message.type === 'STOP') callback({ ok: true, data: { pending: false } });
      else callback({ ok: true, data: {} });
    } } },
    setInterval() { return 1; }, clearInterval() {}, setTimeout, Promise, Date, console,
    prompt: () => 'done', confirm: () => true, alert() {},
  });
  new vm.Script(recoverySource, { filename: 'src/domain/recovery-actions.js' }).runInContext(context);
  new vm.Script(source, { filename: 'src/content/github.js' }).runInContext(context);
  await new Promise(resolve => setTimeout(resolve, 0));
  const activeTrigger = createdNodes.filter(node => node.tag === 'button' && node.getAttribute('aria-haspopup') === 'dialog').at(-1);
  assert.match(activeTrigger.className, /running/, 'active timer colors the header icon');
  const trigger = activeTrigger;
  await trigger.onclick({ isTrusted: true });
  await new Promise(resolve => setTimeout(resolve, 0));
  const stop = createdNodes.find(node => node.tag === 'button' && node.textContent === 'Stop and save');
  assert.ok(stop?.onclick, 'Stop handler was rendered in the header menu');
  await stop.onclick({ isTrusted: true });
  await new Promise(resolve => setTimeout(resolve, 0));
  const pageStateMessages = messages.filter(message => message.type === 'GET_PAGE_STATE');
  assert.equal(pageStateMessages.length, 2, 'only the initial cached and remote active reads occur');
  assert.deepEqual(messages.findLast(message => message.type === 'LOAD_RECENT'), { type: 'LOAD_RECENT', menuData: true, taskUrl: active.issue.url, taskTitle: '' });
});


test('header control mounts when GitHub renders the authenticated header after the content script', async () => {
  documentNodes.clear(); createdNodes.length = 0;
  const intervals = [];
  const messages = [];
  const location = {
    protocol: 'https:', hostname: 'github.com', pathname: '/acme/app/issues/7', href: 'https://github.com/acme/app/issues/7',
  };
  const { actions, avatarSlot } = makeHeader();
  let headerReady = false;
  const document = {
    documentElement: new FakeNode('html'),
    createElement: tag => new FakeNode(tag),
    createElementNS: (namespace, tag) => new FakeNode(tag),
    createTextNode: text => ({ textContent: text }),
    getElementById: id => documentNodes.get(id) ?? null,
    querySelector: selector => selector === '.AppHeader-actions' && headerReady ? actions : null,
    addEventListener() {},
  };
  const context = vm.createContext({
    location, document,
    chrome: { runtime: { lastError: null, sendMessage(message, callback) {
      messages.push(structuredClone(message));
      callback({ ok: true, data: { configured: true, active: null, pendingCount: 0 } });
    } } },
    setInterval(fn) { intervals.push(fn); return intervals.length; }, clearInterval() {}, setTimeout, Promise, Date, console,
    confirm: () => true, alert() {},
  });
  new vm.Script(recoverySource, { filename: 'src/domain/recovery-actions.js' }).runInContext(context);
  new vm.Script(source, { filename: 'src/content/github.js' }).runInContext(context);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(document.getElementById('clockoli-root'), null);
  assert.equal(messages.length, 0);

  headerReady = true;
  intervals.at(-1)();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(actions.children.at(-2)?.id, 'clockoli-root');
  assert.equal(actions.children.at(-1), avatarSlot);
  assert.deepEqual(messages, [{ type: 'GET_PAGE_STATE', refresh: false }]);
});


test('header menu blocks Start and resolves a pending entry conflict', async () => {
  documentNodes.clear(); createdNodes.length = 0;
  const messages = [];
  const location = {
    protocol: 'https:', hostname: 'github.com', pathname: '/acme/app/issues/7', href: 'https://github.com/acme/app/issues/7',
  };
  const { actions } = makeHeader();
  let resolved = false;
  const document = {
    documentElement: new FakeNode('html'),
    createElement: tag => new FakeNode(tag),
    createElementNS: (namespace, tag) => new FakeNode(tag),
    createTextNode: text => ({ textContent: text }),
    getElementById: id => documentNodes.get(id) ?? null,
    querySelector: selector => selector === '.AppHeader-actions' ? actions : null,
    addEventListener() {},
  };
  const pending = { id: 'pending-1', status: 'conflict', stage: 'createEntry' };
  const context = vm.createContext({
    location, document,
    chrome: { runtime: { lastError: null, sendMessage(message, callback) {
      messages.push(structuredClone(message));
      if (message.type === 'GET_PAGE_STATE') callback({ ok: true, data: { configured: true, active: null, pendingCount: resolved ? 0 : 1, pendingWrites: resolved ? [] : [pending] } });
      else if (message.type === 'LOAD_RECENT') callback({ ok: true, data: [] });
      else if (message.type === 'RESOLVE_PENDING') { resolved = true; callback({ ok: true, data: true }); }
      else callback({ ok: true, data: {} });
    } } },
    setInterval() { return 1; }, clearInterval() {}, setTimeout, Promise, Date, console,
    confirm: () => true, alert() {},
  });
  new vm.Script(recoverySource, { filename: 'src/domain/recovery-actions.js' }).runInContext(context);
  new vm.Script(source, { filename: 'src/content/github.js' }).runInContext(context);
  await new Promise(resolve => setTimeout(resolve, 0));
  const trigger = createdNodes.filter(node => node.tag === 'button' && node.getAttribute('aria-haspopup') === 'dialog').at(-1);
  await trigger.onclick({ isTrusted: true });
  await new Promise(resolve => setTimeout(resolve, 0));
  const start = createdNodes.filter(node => node.tag === 'button' && node.textContent === 'Start tracking this task').at(-1);
  const retry = createdNodes.filter(node => node.tag === 'button' && node.textContent === 'Retry entry sync').at(-1);
  assert.equal(start.disabled, true, 'pending entry prevents another timer');
  assert.ok(retry?.onclick, 'entry conflict exposes its recovery action');
  await retry.onclick({ isTrusted: true });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(messages.find(message => message.type === 'RESOLVE_PENDING'), { type: 'RESOLVE_PENDING', id: 'pending-1' });
  assert.equal(resolved, true);
});


test('missing-active conflicts explicitly warn before discarding an unsaved completion', async () => {
  documentNodes.clear(); createdNodes.length = 0;
  const messages = []; let confirmed = false;
  const location = { protocol: 'https:', hostname: 'github.com', pathname: '/acme/app/issues/7', href: 'https://github.com/acme/app/issues/7' };
  const { actions } = makeHeader();
  const pending = { id: 'pending-1', status: 'conflict', stage: 'verifyActive', conflictReason: 'active_missing_no_completion' };
  const document = {
    documentElement: new FakeNode('html'), createElement: tag => new FakeNode(tag), createElementNS: (namespace, tag) => new FakeNode(tag),
    createTextNode: text => ({ textContent: text }), getElementById: id => documentNodes.get(id) ?? null,
    querySelector: selector => selector === '.AppHeader-actions' ? actions : null, addEventListener() {},
  };
  const context = vm.createContext({
    location, document, chrome: { runtime: { lastError: null, sendMessage(message, callback) {
      messages.push(structuredClone(message));
      if (message.type === 'GET_PAGE_STATE') callback({ ok: true, data: { configured: true, active: null, pendingCount: 1, pendingWrites: [pending] } });
      else if (message.type === 'LOAD_RECENT') callback({ ok: true, data: [] });
      else callback({ ok: true, data: {} });
    } } },
    setInterval() { return 1; }, clearInterval() {}, setTimeout, Promise, Date, console,
    confirm(message) { confirmed = /discard this unsaved completion/i.test(message); return true; }, alert() {},
  });
  new vm.Script(recoverySource, { filename: 'src/domain/recovery-actions.js' }).runInContext(context);
  new vm.Script(source, { filename: 'src/content/github.js' }).runInContext(context);
  await new Promise(resolve => setTimeout(resolve, 0));
  const trigger = createdNodes.filter(node => node.tag === 'button' && node.getAttribute('aria-haspopup') === 'dialog').at(-1);
  await trigger.onclick({ isTrusted: true }); await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok(createdNodes.some(node => node.textContent === 'Completion was not saved'));
  assert.ok(createdNodes.some(node => /no matching completion exists/i.test(node.textContent)));
  const discard = createdNodes.filter(node => node.tag === 'button' && node.textContent === 'Discard unsaved completion').at(-1);
  await discard.onclick({ isTrusted: true }); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(confirmed, true);
  assert.deepEqual(messages.find(message => message.type === 'RESOLVE_PENDING'),
    { type: 'RESOLVE_PENDING', id: 'pending-1', action: 'discard_unsaved_completion' });
});

test('header control mounts before the avatar in GitHub current top-nav-right header', async () => {
  documentNodes.clear(); createdNodes.length = 0;
  const messages = [];
  const location = {
    protocol: 'https:', hostname: 'github.com', pathname: '/acme/app/issues/4822', href: 'https://github.com/acme/app/issues/4822',
  };
  const { right, topBarActions, avatarSlot } = makeModernHeader();
  const document = {
    documentElement: new FakeNode('html'),
    createElement: tag => new FakeNode(tag),
    createElementNS: (namespace, tag) => new FakeNode(tag),
    createTextNode: text => ({ textContent: text }),
    getElementById: id => documentNodes.get(id) ?? null,
    querySelector: selector => selector === '[data-testid="top-nav-right"]' ? right : null,
    addEventListener() {},
  };
  const context = vm.createContext({
    location, document,
    chrome: { runtime: { lastError: null, sendMessage(message, callback) {
      messages.push(structuredClone(message));
      callback({ ok: true, data: { configured: true, active: null, pendingCount: 0, pendingWrites: [] } });
    } } },
    setInterval() { return 1; }, clearInterval() {}, setTimeout, Promise, Date, console,
    confirm: () => true, alert() {},
  });
  new vm.Script(recoverySource, { filename: 'src/domain/recovery-actions.js' }).runInContext(context);
  new vm.Script(source, { filename: 'src/content/github.js' }).runInContext(context);
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(right.children[0], topBarActions);
  assert.equal(right.children.at(-2)?.id, 'clockoli-root');
  assert.equal(right.children.at(-1), avatarSlot);
  assert.deepEqual(messages, [
    { type: 'GET_PAGE_STATE', refresh: false },
    { type: 'GET_PAGE_STATE', refresh: true },
  ]);
});


test('recent rows show durable titles and unified offset-preserving inline editing saves on Enter', async () => {
  documentNodes.clear(); createdNodes.length = 0;
  const messages = [];
  const location = { protocol: 'https:', hostname: 'github.com', pathname: '/acme/app/issues/7', href: 'https://github.com/acme/app/issues/7' };
  const { actions } = makeHeader();
  const entry = {
    schemaVersion: 1, id: '20260818000000000000000000', user: 'alice',
    issue: { type: 'issue', owner: 'acme', repo: 'app', number: 7, url: 'https://github.com/acme/app/issues/7' },
    issueTitle: 'Make ranking deterministic', entryDate: '2026-08-18',
    startedAt: '2026-08-18T08:00:11.321-07:00', endedAt: '2026-08-18T23:58:27.123-07:00', durationSeconds: 57500,
    description: 'Original note', createdAt: '2026-08-18T23:58:27.123-07:00', updatedAt: '2026-08-18T23:58:27.123-07:00',
    _path: 'times/2026-08/alice.txt', _sha: 'one', _index: 0,
  };
  const issueTitleNode = new FakeNode('bdi'); issueTitleNode.textContent = 'Make ranking deterministic';
  const document = {
    documentElement: new FakeNode('html'), activeElement: null,
    createElement: tag => new FakeNode(tag), createElementNS: (_namespace, tag) => new FakeNode(tag),
    createTextNode: text => ({ textContent: text }), getElementById: id => documentNodes.get(id) ?? null,
    querySelector: selector => selector === '.AppHeader-actions' ? actions : selector.includes('issue-title') ? issueTitleNode : null, addEventListener() {},
  };
  let editAttempts = 0;
  const context = vm.createContext({
    location, document, chrome: { runtime: { lastError: null, sendMessage(message, callback) {
      messages.push(structuredClone(message));
      if (message.type === 'GET_PAGE_STATE') callback({ ok: true, data: { configured: true, active: null, pendingCount: 0, pendingWrites: [] } });
      else if (message.type === 'LOAD_RECENT') callback({ ok: true, data: [entry] });
      else if (message.type === 'EDIT_ENTRIES') {
        editAttempts += 1;
        assert.equal(createdNodes.filter(node => node.className.includes('inline-time-value')).slice(-4).every(node => node.disabled), true);
        assert.equal(createdNodes.filter(node => ['inline-task-url', 'inline-task-title', 'inline-description'].some(name => node.className.includes(name))).slice(-3).every(node => node.disabled), true);
        callback(editAttempts === 1 ? { ok: false, error: { code: 'conflict', message: 'The monthly file changed.' } } : { ok: true, data: [] });
      } else callback({ ok: true, data: {} });
    } } },
    setInterval() { return 1; }, clearInterval() {}, setTimeout, Promise, Date, console, confirm: () => true, alert() {},
  });
  new vm.Script(recoverySource, { filename: 'src/domain/recovery-actions.js' }).runInContext(context);
  new vm.Script(source, { filename: 'src/content/github.js' }).runInContext(context);
  await new Promise(resolve => setTimeout(resolve, 0));
  const trigger = createdNodes.filter(node => node.tag === 'button' && node.getAttribute('aria-haspopup') === 'dialog').at(-1);
  await trigger.onclick({ isTrusted: true }); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(createdNodes.findLast(node => node.className.includes('task-title')).textContent, 'Make ranking deterministic');
  const descriptionControl = createdNodes.findLast(node => node.className.includes('entry-description-editable'));
  assert.equal(descriptionControl.textContent, 'Original note');
  await descriptionControl.onclick({ isTrusted: true });
  const urlDraft = createdNodes.findLast(node => node.className.includes('inline-task-url'));
  const titleDraft = createdNodes.findLast(node => node.className.includes('inline-task-title'));
  const descriptionDraft = createdNodes.findLast(node => node.className.includes('inline-description'));
  assert.equal(urlDraft.value, entry.issue.url); assert.equal(titleDraft.value, entry.issueTitle); assert.equal(descriptionDraft.value, 'Original note');
  titleDraft.value = 'Edited deterministic ranking'; titleDraft.oninput({});
  descriptionDraft.value = 'Preserve this draft'; descriptionDraft.oninput({});
  let values = createdNodes.filter(node => node.className.includes('inline-time-value')).slice(-4);
  assert.deepEqual(values.map(node => node.value), ['08', '00', '23', '58']);
  const stopMinute = values.at(-1), stopHour = values.at(-2), stopDate = createdNodes.filter(node => node.className.includes('time-date')).at(-1);
  stopDate.value = '2026-08-19'; stopDate.oninput({}); stopHour.value = '00'; stopHour.oninput({}); stopMinute.value = '00'; stopMinute.oninput({});
  await descriptionDraft.onkeydown({ key: 'Enter', isTrusted: true, preventDefault() {} }); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(createdNodes.findLast(node => node.className.includes('inline-task-title')).value, 'Edited deterministic ranking');
  assert.equal(createdNodes.findLast(node => node.className.includes('inline-description')).value, 'Preserve this draft');
  await createdNodes.findLast(node => node.className.includes('inline-description')).onkeydown({ key: 'Enter', isTrusted: true, preventDefault() {} });
  await new Promise(resolve => setTimeout(resolve, 0));
  const editMessage = messages.findLast(message => message.type === 'EDIT_ENTRIES');
  assert.equal(editMessage.payload.entries.length, 1);
  assert.equal(editMessage.payload.entries[0].edits.taskTitle, 'Edited deterministic ranking');
  assert.equal(editMessage.payload.entries[0].edits.description, 'Preserve this draft');
  assert.equal(editMessage.payload.entries[0].edits.startedAt, entry.startedAt);
  assert.equal(editMessage.payload.entries[0].edits.endedAt, '2026-08-19T00:00:27.123-07:00');
  assert.equal(createdNodes.some(node => node.textContent === 'Edit'), false, 'the separate Edit panel trigger is gone');
});

test('opening before remote state refresh renders cache immediately and keeps stale rows locked until retry succeeds', async () => {
  documentNodes.clear(); createdNodes.length = 0;
  const messages = [];
  const location = { protocol: 'https:', hostname: 'github.com', pathname: '/acme/app/issues/7', href: 'https://github.com/acme/app/issues/7' };
  const { actions } = makeHeader();
  const cached = {
    schemaVersion: 1, id: '20260818000000000000000000', user: 'alice',
    taskUrl: 'https://github.com/acme/app/issues/7', taskTitle: 'Cached entry',
    issue: { type: 'issue', owner: 'acme', repo: 'app', number: 7, url: 'https://github.com/acme/app/issues/7' }, issueTitle: 'Cached entry',
    entryDate: '2026-08-18', startedAt: '2026-08-18T08:00:00+00:00', endedAt: '2026-08-18T09:00:00+00:00',
    durationSeconds: 3600, description: '', createdAt: '2026-08-18T09:00:00+00:00', updatedAt: '2026-08-18T09:00:00+00:00',
    _path: 'times/2026-08/alice.txt', _sha: 'cached', _index: 0,
  };
  const refreshed = { ...cached, taskTitle: 'Refreshed entry', issueTitle: 'Refreshed entry', _sha: 'fresh' };
  let replyCachedState, replyRemoteState, replyRecent;
  const document = {
    documentElement: new FakeNode('html'), createElement: tag => new FakeNode(tag), createElementNS: (_namespace, tag) => new FakeNode(tag),
    createTextNode: text => ({ textContent: text }), getElementById: id => documentNodes.get(id) ?? null,
    querySelector: selector => selector === '.AppHeader-actions' ? actions : null, addEventListener() {},
  };
  const context = vm.createContext({
    location, document, chrome: { runtime: { lastError: null, sendMessage(message, callback) {
      messages.push(structuredClone(message));
      if (message.type === 'GET_PAGE_STATE') {
        if (message.refresh) replyRemoteState = callback;
        else replyCachedState = callback;
      } else if (message.type === 'LOAD_RECENT') replyRecent = callback;
      else callback({ ok: true, data: {} });
    } } },
    setInterval() { return 1; }, clearInterval() {}, setTimeout, Promise, Date, console, confirm: () => true, alert() {},
  });
  new vm.Script(recoverySource, { filename: 'src/domain/recovery-actions.js' }).runInContext(context);
  new vm.Script(source, { filename: 'src/content/github.js' }).runInContext(context);

  assert.deepEqual(messages[0], { type: 'GET_PAGE_STATE', refresh: false }, 'initial rendering reads local cache before remote active state');
  const trigger = createdNodes.filter(node => node.tag === 'button' && node.getAttribute('aria-haspopup') === 'dialog').at(-1);
  await trigger.onclick({ isTrusted: true });
  assert.equal(messages.some(message => message.type === 'LOAD_RECENT'), false, 'the panel waits only for the local configured snapshot');

  replyCachedState({ ok: true, data: { configured: true, active: null, pendingCount: 0, pendingWrites: [], recent: [cached] } });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(messages.filter(message => message.type === 'LOAD_RECENT').length, 1, 'the open panel automatically starts one recent refresh');
  assert.equal(messages.some(message => message.type === 'GET_PAGE_STATE' && message.refresh), false,
    'fresh entries are requested before the slower remote active refresh');
  assert.ok(createdNodes.findLast(node => node.tag === 'a' && node.textContent.includes('Cached entry')),
    'cached entries are visible before either remote request finishes');
  assert.equal(createdNodes.findLast(node => node.className.includes('entry-delete')).disabled, true,
    'cached mutation controls stay locked until their current SHA is refreshed');
  assert.equal(createdNodes.some(node => node.textContent === 'Open the menu again to load entries.'), false);

  replyRecent({ ok: false, error: { message: 'GitHub is offline', code: 'network' } });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(createdNodes.findLast(node => node.className.includes('entry-delete')).disabled, true,
    'a failed automatic refresh keeps stale cached mutation controls locked');
  assert.equal(messages.filter(message => message.type === 'GET_PAGE_STATE' && message.refresh).length, 1,
    'remote active refresh continues after the cached-first menu attempt');
  replyRemoteState({ ok: true, data: { configured: true, active: null, pendingCount: 0, pendingWrites: [], recent: [cached] } });
  await new Promise(resolve => setTimeout(resolve, 0));

  const retry = createdNodes.filter(node => node.getAttribute('aria-label') === 'Sync and refresh').at(-1);
  const retrying = retry.onclick({ isTrusted: true });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(messages.filter(message => message.type === 'LOAD_RECENT').length, 2, 'Retry starts one new fresh load');
  replyRecent({ ok: true, data: { recent: [refreshed], reportDate: '2026-08-18', todaySeconds: 3600, active: null, pendingCount: 0, pendingWrites: [] } });
  await retrying;
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok(createdNodes.findLast(node => node.tag === 'a' && node.textContent.includes('Refreshed entry')));
  assert.equal(createdNodes.findLast(node => node.className.includes('entry-delete')).disabled, false,
    'fresh entries become editable only after a successful retry');
});


test('consecutive records for one task share one task header and keep separate time rows', async () => {
  documentNodes.clear(); createdNodes.length = 0;
  const location = { protocol: 'https:', hostname: 'github.com', pathname: '/acme/app/issues/7', href: 'https://github.com/acme/app/issues/7' };
  const { actions } = makeHeader();
  const issue = number => ({ type: 'issue', owner: 'acme', repo: 'app', number, url: `https://github.com/acme/app/issues/${number}` });
  const entry = (id, number, start, end, description) => ({
    schemaVersion: 1, id, user: 'alice', issue: issue(number), issueTitle: `Issue ${number}`,
    entryDate: '2026-08-18', startedAt: start, endedAt: end,
    durationSeconds: (new Date(end) - new Date(start)) / 1000, description,
    createdAt: end, updatedAt: end, _path: 'times/2026-08/alice.txt', _sha: 'same', _index: Number(id.at(-1)),
  });
  const entries = [
    entry('record0', 7, '2026-08-18T12:00:00+00:00', '2026-08-18T12:30:00+00:00', 'Newest pass'),
    entry('record1', 7, '2026-08-18T11:00:00+00:00', '2026-08-18T11:20:00+00:00', 'Earlier pass'),
    entry('record2', 8, '2026-08-18T10:00:00+00:00', '2026-08-18T10:15:00+00:00', 'Other task'),
    entry('record3', 7, '2026-08-18T09:00:00+00:00', '2026-08-18T09:10:00+00:00', 'Nonconsecutive pass'),
  ];
  const document = {
    documentElement: new FakeNode('html'), activeElement: null,
    createElement: tag => new FakeNode(tag), createElementNS: (namespace, tag) => new FakeNode(tag),
    createTextNode: text => ({ textContent: text }), getElementById: id => documentNodes.get(id) ?? null,
    querySelector: selector => selector === '.AppHeader-actions' ? actions : null, addEventListener() {},
  };
  const context = vm.createContext({
    location, document, chrome: { runtime: { lastError: null, sendMessage(message, callback) {
      if (message.type === 'GET_PAGE_STATE') callback({ ok: true, data: { configured: true, active: null, pendingCount: 0, pendingWrites: [] } });
      else if (message.type === 'LOAD_RECENT') callback({ ok: true, data: entries });
      else callback({ ok: true, data: {} });
    } } },
    setInterval() { return 1; }, clearInterval() {}, setTimeout, Promise, Date, console, confirm: () => true, alert() {},
  });
  new vm.Script(recoverySource, { filename: 'src/domain/recovery-actions.js' }).runInContext(context);
  new vm.Script(source, { filename: 'src/content/github.js' }).runInContext(context);
  await new Promise(resolve => setTimeout(resolve, 0));
  const trigger = createdNodes.filter(node => node.tag === 'button' && node.getAttribute('aria-haspopup') === 'dialog').at(-1);
  await trigger.onclick({ isTrusted: true }); await new Promise(resolve => setTimeout(resolve, 0));

  const taskLinks = createdNodes.filter(node => node.tag === 'a' && [issue(7).url, issue(8).url].includes(node.href));
  assert.equal(taskLinks.length, 3, 'two adjacent records for issue 7 render one shared task header');
  assert.deepEqual(taskLinks.map(node => node.textContent), ['Issue 7', 'Issue 8', 'Issue 7'],
    'the same task receives a new title link after a different task interrupts the sequence');
  assert.deepEqual(createdNodes.filter(node => node.className.includes('task-url') && [issue(7).url, issue(8).url].includes(node.textContent)).map(node => node.textContent),
    [issue(7).url, issue(8).url, issue(7).url], 'each grouped title retains its canonical URL source line');
  assert.equal(createdNodes.filter(node => node.className.includes('entry-record')).slice(-4).length, 4,
    'each record retains a separate time-detail row');
  assert.equal(createdNodes.filter(node => node.className.includes('entry-meta')).slice(-4).length, 4);
  assert.equal(createdNodes.filter(node => node.className.includes('entry-description-editable')).slice(-4).length, 4,
    'each time record exposes its inline metadata editor affordance');
  assert.equal(createdNodes.filter(node => node.className.includes('entry-delete')).slice(-4).length, 4,
    'each time record remains independently deletable');
});

test('main-panel times are directly editable, relative-day labeled, and overlapping records are highlighted', async () => {
  documentNodes.clear(); createdNodes.length = 0;
  const messages = [];
  const location = { protocol: 'https:', hostname: 'github.com', pathname: '/acme/app/issues/7', href: 'https://github.com/acme/app/issues/7' };
  const { actions } = makeHeader();
  const issue = number => ({ type: 'issue', owner: 'acme', repo: 'app', number, url: `https://github.com/acme/app/issues/${number}` });
  const entry = (id, number, start, end, index) => ({
    schemaVersion: 1, id, user: 'alice', issue: issue(number), issueTitle: `Issue ${number}`,
    entryDate: start.slice(0, 10), startedAt: start, endedAt: end,
    durationSeconds: (new Date(end) - new Date(start)) / 1000, description: '',
    createdAt: end, updatedAt: end, _path: 'times/2026-08/alice.txt', _sha: 'same', _index: index,
  });
  const entries = [
    entry('today-a', 7, '2026-08-21T14:00:00+00:00', '2026-08-21T15:00:00+00:00', 0),
    entry('today-b', 8, '2026-08-21T14:30:00+00:00', '2026-08-21T16:00:00+00:00', 1),
    entry('yesterday', 9, '2026-08-20T12:00:00+00:00', '2026-08-20T12:30:00+00:00', 2),
    entry('weekday', 10, '2026-08-19T09:00:00+00:00', '2026-08-19T09:15:00+00:00', 3),
  ];
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-08-21T12:00:00'])); }
    static now() { return new Date('2026-08-21T12:00:00').getTime(); }
  }
  const document = {
    documentElement: new FakeNode('html'), activeElement: null,
    createElement: tag => new FakeNode(tag), createElementNS: (namespace, tag) => new FakeNode(tag),
    createTextNode: text => ({ textContent: text }), getElementById: id => documentNodes.get(id) ?? null,
    querySelector: selector => selector === '.AppHeader-actions' ? actions : null, addEventListener() {},
  };
  const context = vm.createContext({
    location, document, chrome: { runtime: { lastError: null, sendMessage(message, callback) {
      messages.push(structuredClone(message));
      if (message.type === 'GET_PAGE_STATE') callback({ ok: true, data: { configured: true, active: null, pendingCount: 0, pendingWrites: [] } });
      else if (message.type === 'LOAD_RECENT') callback({ ok: true, data: entries });
      else if (message.type === 'EDIT_ENTRIES') {
        assert.equal(createdNodes.filter(node => node.className.includes('inline-time-value')).slice(-16).every(node => node.disabled), true,
          'the complete current and sibling inline editors are locked while Save time is in flight');
        callback({ ok: true, data: {} });
      }
      else callback({ ok: true, data: {} });
    } } },
    setInterval() { return 1; }, clearInterval() {}, setTimeout, Promise, Date: FixedDate, console, confirm: () => true, alert() {},
  });
  new vm.Script(recoverySource, { filename: 'src/domain/recovery-actions.js' }).runInContext(context);
  new vm.Script(source, { filename: 'src/content/github.js' }).runInContext(context);
  await new Promise(resolve => setTimeout(resolve, 0));
  const trigger = createdNodes.filter(node => node.tag === 'button' && node.getAttribute('aria-haspopup') === 'dialog').at(-1);
  await trigger.onclick({ isTrusted: true }); await new Promise(resolve => setTimeout(resolve, 0));

  assert.deepEqual(createdNodes.filter(node => node.className.includes('entry-day')).slice(-4).map(node => node.textContent),
    ['Today', 'Today', 'Yesterday', 'Wed']);
  assert.equal(createdNodes.filter(node => node.className.includes('entry-overlap')).slice(-2).length, 2);
  assert.equal(createdNodes.filter(node => node.className.includes('overlap-warning')).slice(-2).length, 2);
  const inlineValues = createdNodes.filter(node => node.className.includes('inline-time-value'));
  assert.equal(inlineValues.length, 16, 'every main-panel record exposes Start and Stop hour/minute spinbuttons');
  assert.equal(createdNodes.filter(node => node.className.includes('inline-save')).slice(-4).every(node => node.hidden), true);

  let firstStopMinute = inlineValues[7];
  assert.equal(firstStopMinute.onwheel, undefined, 'inline time fields leave wheel scrolling untouched');
  firstStopMinute.value = ''; firstStopMinute.oninput({});
  let save = createdNodes.filter(node => node.className.includes('inline-save')).at(-3);
  await save.onclick({ isTrusted: true }); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(messages.some(message => message.type === 'EDIT_ENTRIES'), false, 'an incomplete direct-input draft is never sent');
  assert.ok(createdNodes.findLast(node => node.className.includes('error') && node.textContent.includes('valid date and time')));
  const preservedValues = createdNodes.filter(node => node.className.includes('inline-time-value')).slice(-16);
  assert.equal(preservedValues[7].value, '', 'validation rerender preserves the incomplete direct-input draft');
  firstStopMinute = preservedValues[7]; firstStopMinute.value = '01'; firstStopMinute.oninput({});
  save = createdNodes.filter(node => node.className.includes('inline-save')).at(-3);
  assert.equal(save.hidden, false, 'typing a main-panel value reveals an explicit Save action');
  await save.onclick({ isTrusted: true }); await new Promise(resolve => setTimeout(resolve, 0));
  const edit = messages.findLast(message => message.type === 'EDIT_ENTRIES');
  assert.equal(edit.payload.entries.length, 2, 'the crossed neighboring Start is saved in the same atomic group');
  assert.equal(edit.payload.entries[0].originalSha, 'same');
  assert.equal(edit.payload.entries[0].edits.endedAt, '2026-08-21T15:01:00+00:00');
  assert.equal(edit.payload.entries[1].edits.startedAt, '2026-08-21T15:01:00+00:00');

  const refreshedInlineValues = createdNodes.filter(node => node.className.includes('inline-time-value')).slice(-16);
  const secondStartMinute = refreshedInlineValues[1];
  assert.equal(secondStartMinute.onwheel, undefined);
  secondStartMinute.value = '29'; secondStartMinute.oninput({});
  const mirroredSave = createdNodes.filter(node => node.className.includes('inline-save')).slice(-4)[0];
  assert.equal(mirroredSave.hidden, false, 'crossing Start reveals Save on the edited record');
  await mirroredSave.onclick({ isTrusted: true }); await new Promise(resolve => setTimeout(resolve, 0));
  const mirroredEdit = messages.findLast(message => message.type === 'EDIT_ENTRIES');
  assert.equal(mirroredEdit.payload.entries.length, 2, 'the crossed previous Stop is saved in the same atomic group');
  assert.equal(mirroredEdit.payload.entries[0].edits.startedAt, '2026-08-21T14:29:00+00:00');
  assert.equal(mirroredEdit.payload.entries[1].edits.endedAt, '2026-08-21T14:29:00+00:00');
});

test('directly typed newer Start and previous Stop save as touching intervals without an overlap warning', async () => {
  documentNodes.clear(); createdNodes.length = 0;
  const messages = [];
  const location = { protocol: 'https:', hostname: 'github.com', pathname: '/acme/app/issues/7', href: 'https://github.com/acme/app/issues/7' };
  const { actions } = makeHeader();
  const issue = number => ({ type: 'issue', owner: 'acme', repo: 'app', number, url: `https://github.com/acme/app/issues/${number}` });
  const makeEntry = (id, number, start, end, index) => ({
    schemaVersion: 1, id, user: 'alice', issue: issue(number), issueTitle: `Issue ${number}`,
    entryDate: start.slice(0, 10), startedAt: start, endedAt: end,
    durationSeconds: (new Date(end) - new Date(start)) / 1000, description: '',
    createdAt: end, updatedAt: end, _path: 'times/2026-08/alice.txt', _sha: 'same', _index: index,
  });
  let entries = [
    makeEntry('older', 7, '2026-08-21T14:00:00.111+00:00', '2026-08-21T15:00:43.324+00:00', 0),
    makeEntry('newer', 8, '2026-08-21T15:00:06.768+00:00', '2026-08-21T16:00:00.999+00:00', 1),
    makeEntry('oldest', 6, '2026-08-21T13:00:00.222+00:00', '2026-08-21T14:00:00.000+00:00', 2),
  ];
  const document = {
    documentElement: new FakeNode('html'), activeElement: null,
    createElement: tag => new FakeNode(tag), createElementNS: (namespace, tag) => new FakeNode(tag),
    createTextNode: value => ({ textContent: value }), getElementById: id => documentNodes.get(id) ?? null,
    querySelector: selector => selector === '.AppHeader-actions' ? actions : null, addEventListener() {},
  };
  const context = vm.createContext({
    location, document, chrome: { runtime: { lastError: null, sendMessage(message, callback) {
      messages.push(structuredClone(message));
      if (message.type === 'GET_PAGE_STATE') callback({ ok: true, data: { configured: true, active: null, pendingCount: 0, pendingWrites: [] } });
      else if (message.type === 'LOAD_RECENT') callback({ ok: true, data: entries });
      else if (message.type === 'EDIT_ENTRIES') {
        for (const request of message.payload.entries) {
          const position = entries.findIndex(entry => entry._index === request.index);
          entries[position] = { ...entries[position], ...request.edits,
            entryDate: request.edits.startedAt.slice(0, 10),
            durationSeconds: (new Date(request.edits.endedAt) - new Date(request.edits.startedAt)) / 1000,
            _sha: 'saved' };
        }
        callback({ ok: true, data: entries });
      } else callback({ ok: true, data: {} });
    } } },
    setInterval() { return 1; }, clearInterval() {}, setTimeout, Promise, Date, console, confirm: () => true, alert() {},
  });
  new vm.Script(recoverySource, { filename: 'src/domain/recovery-actions.js' }).runInContext(context);
  new vm.Script(source, { filename: 'src/content/github.js' }).runInContext(context);
  await new Promise(resolve => setTimeout(resolve, 0));
  const trigger = createdNodes.filter(node => node.tag === 'button' && node.getAttribute('aria-haspopup') === 'dialog').at(-1);
  await trigger.onclick({ isTrusted: true }); await new Promise(resolve => setTimeout(resolve, 0));
  const visibleOverlapWarnings = () => createdNodes.filter(node => node.className.includes('overlap-warning') && node.isConnected);
  assert.equal(visibleOverlapWarnings().length, 2, 'a seconds-only overlap is initially visible even though both boundaries display 15:00');

  const values = createdNodes.filter(node => node.className.includes('inline-time-value')).slice(-12);
  const newerStartHour = values[0], newerStartMinute = values[1];
  assert.equal(newerStartMinute.onwheel, undefined);
  newerStartHour.value = '14'; newerStartHour.oninput({});
  newerStartMinute.value = '59'; newerStartMinute.oninput({});
  assert.equal(values[6].value, '14');
  assert.equal(values[7].value, '59', 'the older Stop mirrors the newer Start immediately');
  assert.equal(visibleOverlapWarnings().length, 0, 'linked direct-input drafts clear the stale overlap warning before Save');

  newerStartHour.value = '15'; newerStartHour.oninput({});
  newerStartMinute.value = '01'; newerStartMinute.oninput({});
  assert.deepEqual([values[6].value, values[7].value], ['15', '00'],
    'backing out of the crossing restores the older Stop baseline');
  let save = createdNodes.filter(node => node.className.includes('inline-save')).slice(-2)[0];
  await save.onclick({ isTrusted: true }); await new Promise(resolve => setTimeout(resolve, 0));
  let request = messages.findLast(message => message.type === 'EDIT_ENTRIES');
  assert.equal(request.payload.entries.length, 1, 'a restored no-op neighbor is excluded from the grouped mutation');
  assert.equal(request.payload.entries[0].edits.startedAt, '2026-08-21T15:01:06.768+00:00');
  assert.equal(entries[0].endedAt, '2026-08-21T15:00:43.324+00:00', 'the older Stop remains exact after the non-crossing save');

  const refreshedValues = createdNodes.filter(node => node.className.includes('inline-time-value')).slice(-12);
  const refreshedStartHour = refreshedValues[0], refreshedStartMinute = refreshedValues[1];
  refreshedStartHour.value = '14'; refreshedStartHour.oninput({});
  refreshedStartMinute.value = '59'; refreshedStartMinute.oninput({});
  assert.deepEqual([refreshedValues[6].value, refreshedValues[7].value], ['14', '59']);
  save = createdNodes.filter(node => node.className.includes('inline-save')).slice(-2)[0];
  await save.onclick({ isTrusted: true }); await new Promise(resolve => setTimeout(resolve, 0));
  request = messages.findLast(message => message.type === 'EDIT_ENTRIES');
  assert.deepEqual(request.payload.entries.map(item => [item.edits.startedAt, item.edits.endedAt]), [
    ['2026-08-21T14:59:06.768+00:00', '2026-08-21T16:00:00.999+00:00'],
    ['2026-08-21T14:00:00.111+00:00', '2026-08-21T14:59:06.768+00:00'],
  ]);
  assert.equal(visibleOverlapWarnings().length, 0,
    'the refreshed linked result remains endpoint-touching, not overlapping');

  const cascadeValues = createdNodes.filter(node => node.className.includes('inline-time-value')).slice(-12);
  cascadeValues[0].value = '13'; cascadeValues[0].oninput({});
  cascadeValues[1].value = '30'; cascadeValues[1].oninput({});
  assert.deepEqual(cascadeValues.slice(4, 12).map(node => node.value),
    ['13', '30', '13', '30', '13', '00', '13', '30'],
    'continuing past an existing link discovers and updates every newly crossed boundary');
  save = createdNodes.filter(node => node.className.includes('inline-save')).slice(-3)[0];
  await save.onclick({ isTrusted: true }); await new Promise(resolve => setTimeout(resolve, 0));
  request = messages.findLast(message => message.type === 'EDIT_ENTRIES');
  assert.deepEqual(request.payload.entries.map(item => [item.edits.startedAt, item.edits.endedAt]), [
    ['2026-08-21T13:30:06.768+00:00', '2026-08-21T16:00:00.999+00:00'],
    ['2026-08-21T13:30:06.768+00:00', '2026-08-21T13:30:06.768+00:00'],
    ['2026-08-21T13:00:00.222+00:00', '2026-08-21T13:30:06.768+00:00'],
  ]);
  assert.equal(visibleOverlapWarnings().length, 0, 'the cascaded linked save remains non-overlapping');
});

test('typing in the main-panel description cannot reach GitHub keyboard shortcuts', async () => {
  documentNodes.clear(); createdNodes.length = 0;
  const location = { protocol: 'https:', hostname: 'github.com', pathname: '/acme/app/issues/7', href: 'https://github.com/acme/app/issues/7' };
  const { actions } = makeHeader();
  const document = { documentElement: new FakeNode('html'), createElement: tag => new FakeNode(tag), createElementNS: (namespace, tag) => new FakeNode(tag),
    createTextNode: text => ({ textContent: text }), getElementById: id => documentNodes.get(id) ?? null,
    querySelector: selector => selector === '.AppHeader-actions' ? actions : null, addEventListener() {} };
  const active = { issue: { type: 'issue', owner: 'acme', repo: 'app', number: 7, url: 'https://github.com/acme/app/issues/7' }, startedAt: '2026-08-18T08:00:00.000Z', description: '' };
  const context = vm.createContext({ location, document, chrome: { runtime: { lastError: null, sendMessage(message, callback) {
    callback({ ok: true, data: message.type === 'GET_PAGE_STATE' ? { configured: true, active, pendingCount: 0, pendingWrites: [] } : [] });
  } } }, setInterval() { return 1; }, clearInterval() {}, setTimeout, Promise, Date, console, confirm: () => true, alert() {} });
  new vm.Script(recoverySource, { filename: 'src/domain/recovery-actions.js' }).runInContext(context);
  new vm.Script(source, { filename: 'src/content/github.js' }).runInContext(context); await new Promise(resolve => setTimeout(resolve, 0));
  const trigger = createdNodes.filter(node => node.tag === 'button' && node.getAttribute('aria-haspopup') === 'dialog').at(-1);
  await trigger.onclick({ isTrusted: true }); await new Promise(resolve => setTimeout(resolve, 0));
  const description = createdNodes.findLast(node => node.tag === 'input' && node.placeholder === 'Optional');
  let stopped = false;
  description.onkeydown({ target: description, key: 'a', stopPropagation() { stopped = true; } });
  assert.equal(stopped, true);
});

test('recent entry deletion remains conflict-safe without between-row drag controls', async () => {
  documentNodes.clear(); createdNodes.length = 0;
  const messages = [];
  const location = { protocol: 'https:', hostname: 'github.com', pathname: '/acme/app/issues/7', href: 'https://github.com/acme/app/issues/7' };
  const { actions } = makeHeader();
  const entry = (id, number, startedAt, endedAt, sha, index = number - 1) => ({
    schemaVersion: 1, id, user: 'alice', taskUrl: `https://github.com/acme/app/issues/${number}`, taskTitle: `Issue ${number}`,
    issue: { type: 'issue', owner: 'acme', repo: 'app', number, url: `https://github.com/acme/app/issues/${number}` },
    issueTitle: `Issue ${number}`, entryDate: startedAt.slice(0, 10), startedAt, endedAt, durationSeconds: (new Date(endedAt) - new Date(startedAt)) / 1000, description: '',
    createdAt: endedAt, updatedAt: endedAt, _path: 'times/2026-08/alice.txt', _sha: sha, _index: index,
  });
  const older = entry('20260818000000000000000001', 1, '2026-08-18T09:00:00+03:00', '2026-08-18T10:00:00+03:00', 'daily', 1);
  const newer = entry('20260818000000000000000000', 2, '2026-08-18T10:00:00+03:00', '2026-08-18T11:00:00+03:00', 'daily', 0);
  const hidden = entry(older.id, 3, '2026-08-18T11:00:00+03:00', '2026-08-18T12:00:00+03:00', 'post-delete', 1);
  const rewrittenOlder = { ...older, id: '20260818000000000000000000', _sha: 'post-delete', _index: 0 };
  const now = new Date(), reportDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  let loadedRecent = [newer, older], releaseDelete, deleteCalls = 0;
  const document = {
    documentElement: new FakeNode('html'), createElement: tag => new FakeNode(tag), createElementNS: (namespace, tag) => new FakeNode(tag),
    createTextNode: text => ({ textContent: text }), getElementById: id => documentNodes.get(id) ?? null,
    querySelector: selector => selector === '.AppHeader-actions' ? actions : null, addEventListener() {},
  };
  const context = vm.createContext({
    location, document, chrome: { runtime: { lastError: null, sendMessage(message, callback) {
      messages.push(structuredClone(message));
      if (message.type === 'GET_PAGE_STATE') callback({ ok: true, data: { configured: true, active: null, pendingCount: 0, pendingWrites: [] } });
      else if (message.type === 'LOAD_RECENT') callback({ ok: true, data: {
        recent: loadedRecent, reportDate, todaySeconds: 7200,
        summaries: [{ key: 'review-window', label: 'Review window', seconds: 7200, startDate: '2026-08-01', endDate: '2026-08-31', displayMs: 2000 }],
        active: null, pendingCount: 0, pendingWrites: [],
      } });
      else if (message.type === 'DELETE_ENTRY') {
        deleteCalls += 1;
        const respond = () => callback({ ok: true, data: { deleted: true, entries: deleteCalls === 1 ? [rewrittenOlder, hidden] : [hidden] } });
        if (deleteCalls === 1) releaseDelete = respond; else respond();
      } else callback({ ok: true, data: {} });
    } } },
    setInterval() { return 1; }, clearInterval() {}, setTimeout, Promise, Date, console, confirm: () => confirmDelete, alert() {},
  });
  let confirmDelete = true;
  new vm.Script(recoverySource, { filename: 'src/domain/recovery-actions.js' }).runInContext(context);
  new vm.Script(source, { filename: 'src/content/github.js' }).runInContext(context);
  await new Promise(resolve => setTimeout(resolve, 0));
  const trigger = createdNodes.filter(node => node.tag === 'button' && node.getAttribute('aria-haspopup') === 'dialog').at(-1);
  await trigger.onclick({ isTrusted: true }); await new Promise(resolve => setTimeout(resolve, 0));
  const recentLinks = createdNodes.filter(node => node.tag === 'a' && [newer.issue.url, older.issue.url].includes(node.href));
  assert.deepEqual(recentLinks.slice(-2).map(node => node.href), [newer.issue.url, older.issue.url], 'recent entries render by Start descending');
  assert.equal(createdNodes.some(node => node.className.includes('time-boundary')), false, 'between-row drag controls are removed');
  const rowDeletes = createdNodes.filter(node => node.tag === 'button' && node.className.includes('entry-delete')).slice(-2);
  assert.equal(rowDeletes.length, 2, 'each editable recent entry has a direct Delete action');
  confirmDelete = false;
  await rowDeletes[0].onclick({ isTrusted: true }); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(messages.some(message => message.type === 'DELETE_ENTRY'), false, 'cancelling the confirmation preserves the entry');
  confirmDelete = true;
  const deletePromise = rowDeletes[0].onclick({ isTrusted: true }); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(rowDeletes[0].disabled, true); assert.equal(rowDeletes[0].parentElement.children[0].disabled, true,
    'an in-flight direct deletion disables its sibling Edit action');
  const deleteRenderStart = createdNodes.length;
  releaseDelete(); await deletePromise; await new Promise(resolve => setTimeout(resolve, 0));
  const postDeleteLinks = createdNodes.slice(deleteRenderStart).filter(node => node.tag === 'a' && [older.issue.url, hidden.issue.url].includes(node.href));
  assert.deepEqual(postDeleteLinks.map(node => node.href), [older.issue.url], 'deletion keeps only the previously visible survivor when indexes and derived IDs shift');
  assert.equal(createdNodes.slice(deleteRenderStart).filter(node => node.className === 'today-total-value').at(-1)?.textContent, '1h 0m',
    'confirmed direct deletion immediately subtracts its duration from matching summary frames');
  const deletion = messages.find(message => message.type === 'DELETE_ENTRY');
  assert.equal(deletion.payload.path, newer._path);
  assert.equal(deletion.payload.index, newer._index);
  assert.deepEqual(deletion.payload.original, {
    taskUrl: newer.taskUrl, taskTitle: newer.taskTitle, issueUrl: newer.issue.url, issueTitle: newer.issueTitle,
    startedAt: newer.startedAt, endedAt: newer.endedAt, description: '',
  });
  const survivingDelete = createdNodes.filter(node => node.tag === 'button' && node.className.includes('entry-delete')).at(-1);
  await survivingDelete.onclick({ isTrusted: true }); await new Promise(resolve => setTimeout(resolve, 0));
  const secondDeletion = messages.filter(message => message.type === 'DELETE_ENTRY')[1];
  assert.equal(secondDeletion.payload.path, older._path);
  assert.equal(secondDeletion.payload.originalSha, 'post-delete', 'surviving rows use the rewritten monthly-file SHA');
  assert.equal(secondDeletion.payload.index, 0, 'surviving rows use their rewritten monthly-file index');
  loadedRecent = [{ ...newer, _pending: true }, older];
  const sync = createdNodes.filter(node => node.getAttribute('aria-label') === 'Sync and refresh').at(-1);
  await sync.onclick({ isTrusted: true }); await new Promise(resolve => setTimeout(resolve, 0));
  const pending = createdNodes.filter(node => node.tag === 'button' && node.textContent === 'Pending').at(-1);
  assert.equal(pending.disabled, true, 'a queued row renders a visible disabled Pending indicator');
  const pendingRow = pending.parentElement.parentElement;
  assert.equal(pendingRow.walk().some(node => node.className.includes('entry-edit') || node.className.includes('entry-delete')), false,
    'a queued row exposes neither Edit nor Delete');
  assert.equal(createdNodes.some(node => node.className.includes('time-boundary')), false);
});


test('successful Delete responses accept exact empty output and reject malformed parser-shaped entries safely', async t => {
  const recentEntry = {
    schemaVersion: 1, id: '20260818000000000000000000', user: 'alice',
    issue: { type: 'issue', owner: 'acme', repo: 'app', number: 7, url: 'https://github.com/acme/app/issues/7' }, issueTitle: 'Ranking regression',
    entryDate: '2026-08-18', startedAt: '2026-08-18T08:00:00+00:00', endedAt: '2026-08-18T09:00:00+00:00',
    durationSeconds: 3600, description: '', createdAt: '2026-08-18T09:00:00+00:00', updatedAt: '2026-08-18T09:00:00+00:00',
    _path: 'times/2026-08/alice.txt', _sha: 'rewritten', _index: 0,
  };
  const secondEntry = {
    ...recentEntry, id: '20260818000000000000000001', issue: { ...recentEntry.issue, number: 8, url: 'https://github.com/acme/app/issues/8' },
    startedAt: '2026-08-18T10:00:00+00:00', endedAt: '2026-08-18T11:00:00+00:00',
    createdAt: '2026-08-18T11:00:00+00:00', updatedAt: '2026-08-18T11:00:00+00:00', _index: 1,
  };
  const omit = (entry, key) => { const copy = structuredClone(entry); delete copy[key]; return copy; };
  const malformed = [
    ['null member', [null]],
    ['primitive member', [7]],
    ['wrong index', [{ ...recentEntry, _index: 1 }]],
    ['wrong path', [{ ...recentEntry, _path: 'times/2026-08/bob.txt' }]],
    ['empty SHA', [{ ...recentEntry, _sha: '' }]],
    ['inconsistent SHA', [recentEntry, { ...secondEntry, _sha: 'other' }]],
    ['missing ID', [omit(recentEntry, 'id')]],
    ['empty ID', [{ ...recentEntry, id: '' }]],
    ['extra metadata', [{ ...recentEntry, unexpected: true }]],
    ['wrong schema', [{ ...recentEntry, schemaVersion: 2 }]],
    ['wrong user', [{ ...recentEntry, user: 'bob' }]],
    ['missing issue', [omit(recentEntry, 'issue')]],
    ['missing issue title', [omit(recentEntry, 'issueTitle')]],
    ['unnormalized issue title', [{ ...recentEntry, issueTitle: ' two  spaces ' }]],
    ['empty issue URL', [{ ...recentEntry, issue: { ...recentEntry.issue, url: '' } }]],
    ['noncanonical issue URL', [{ ...recentEntry, issue: { ...recentEntry.issue, url: 'not-a-github-url' } }]],
    ['malformed issue identity', [{ ...recentEntry, issue: { ...recentEntry.issue, owner: 'bad--owner' } }]],
    ['empty Start', [{ ...recentEntry, startedAt: '' }]],
    ['malformed Start', [{ ...recentEntry, startedAt: 'not-a-time' }]],
    ['empty End', [{ ...recentEntry, endedAt: '' }]],
    ['malformed End', [{ ...recentEntry, endedAt: 'not-a-time' }]],
    ['wrong entry date', [{ ...recentEntry, entryDate: '2026-02-31' }]],
    ['wrong derived ID', [{ ...recentEntry, id: '20260818000000000000000001' }]],
    ['wrong duration', [{ ...recentEntry, durationSeconds: 1 }]],
    ['wrong createdAt', [{ ...recentEntry, createdAt: recentEntry.startedAt }]],
    ['wrong updatedAt', [{ ...recentEntry, updatedAt: recentEntry.startedAt }]],
    ['unnormalized description', [{ ...recentEntry, description: ' two  spaces ' }]],
  ];

  async function exercise(entries, expectFallback) {
    documentNodes.clear(); createdNodes.length = 0;
    const location = { protocol: 'https:', hostname: 'github.com', pathname: '/acme/app/issues/7', href: 'https://github.com/acme/app/issues/7' };
    const { actions } = makeHeader();
    let deleted = false, loadCalls = 0;
    const document = {
      documentElement: new FakeNode('html'), createElement: tag => new FakeNode(tag), createElementNS: (_namespace, tag) => new FakeNode(tag),
      createTextNode: text => ({ textContent: text }), getElementById: id => documentNodes.get(id) ?? null,
      querySelector: selector => selector === '.AppHeader-actions' ? actions : null, addEventListener() {},
    };
    const context = vm.createContext({
      location, document, chrome: { runtime: { lastError: null, sendMessage(message, callback) {
        if (message.type === 'GET_PAGE_STATE') callback({ ok: true, data: { configured: true, active: null, pendingCount: 0, pendingWrites: [] } });
        else if (message.type === 'LOAD_RECENT') {
          loadCalls += 1;
          callback(deleted ? { ok: false, error: { code: 'error', message: 'Refresh failed' } } : { ok: true, data: [recentEntry] });
        } else if (message.type === 'DELETE_ENTRY') { deleted = true; callback({ ok: true, data: { deleted: true, entries } }); }
        else callback({ ok: true, data: {} });
      } } },
      setInterval() { return 1; }, clearInterval() {}, setTimeout, Promise, Date, console, confirm: () => true, alert() {},
    });
    new vm.Script(recoverySource, { filename: 'src/domain/recovery-actions.js' }).runInContext(context);
    new vm.Script(source, { filename: 'src/content/github.js' }).runInContext(context);
    await new Promise(resolve => setTimeout(resolve, 0));
    const trigger = createdNodes.filter(node => node.tag === 'button' && node.getAttribute('aria-haspopup') === 'dialog').at(-1);
    await trigger.onclick({ isTrusted: true }); await new Promise(resolve => setTimeout(resolve, 0));
    const remove = createdNodes.filter(node => node.tag === 'button' && node.className.includes('entry-delete')).at(-1);
    const rerenderStart = createdNodes.length;
    await remove.onclick({ isTrusted: true }); await new Promise(resolve => setTimeout(resolve, 0));
    const rerendered = createdNodes.slice(rerenderStart);
    assert.equal(loadCalls, expectFallback ? 2 : 1, expectFallback ? 'malformed response triggers one compatibility reload' : 'empty exact response needs no compatibility reload');
    assert.equal(rerendered.some(node => node.className.includes('entry-edit') || node.className.includes('entry-delete')), false,
      'successful deletion never restores actionable stale row controls');
    assert.equal(rerendered.some(node => node.className === 'error' && node.textContent === 'Refresh failed'), expectFallback);
  }

  await t.test('empty exact response after deleting the last record', () => exercise([], false));
  for (const [label, entries] of malformed) await t.test(label, () => exercise(entries, true));
});



test('main panel shows today total and opens Reports before Settings', async () => {
  documentNodes.clear(); createdNodes.length = 0;
  const messages = [], intervals = [];
  const location = { protocol: 'https:', hostname: 'github.com', pathname: '/acme/app/issues/7', href: 'https://github.com/acme/app/issues/7' };
  const { actions } = makeHeader();
  const today = new Date(), pad = value => String(value).padStart(2, '0');
  const date = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const recentEntry = { user: 'alice', entryDate: date, durationSeconds: 5400, issue: { type: 'issue', owner: 'acme', repo: 'app', number: 7, url: 'https://github.com/acme/app/issues/7' }, startedAt: `${date}T08:00:00+00:00`, endedAt: `${date}T09:30:00+00:00`, description: '', _path: `times/${date}/alice.txt`, _sha: 'x', _index: 0 };
  const document = { documentElement: new FakeNode('html'), createElement: tag => new FakeNode(tag), createElementNS: (namespace, tag) => new FakeNode(tag), createTextNode: text => ({ textContent: text }), getElementById: id => documentNodes.get(id) ?? null, querySelector: selector => selector === '.AppHeader-actions' ? actions : null, addEventListener() {} };
  const context = vm.createContext({ location, document, chrome: { runtime: { lastError: null, sendMessage(message, callback) {
    messages.push(structuredClone(message));
    if (message.type === 'GET_PAGE_STATE') callback({ ok: true, data: { configured: true, active: { ...recentEntry, endedAt: undefined, startedAt: `${date}T08:00:00+00:00` }, pendingCount: 0, pendingWrites: [] } });
    else if (message.type === 'LOAD_RECENT') callback({ ok: true, data: { recent: [recentEntry], todaySeconds: 5400, reportDate: date,
      summaries: [
        { key: 'today', label: 'Today', seconds: 5400, startDate: date, endDate: date, displayMs: 2000 },
        { key: 'this-week', label: 'This week', seconds: 7200, startDate: date, endDate: date, displayMs: 1000 },
        { key: 'last-week', label: 'Last week', seconds: 3600, startDate: '2026-08-10', endDate: '2026-08-16', displayMs: 1000 },
        { key: 'this-month', label: 'This month', seconds: 10800, startDate: '2026-08-01', endDate: date, displayMs: 1000 },
      ], active: null, pendingCount: 0, pendingWrites: [] } });
    else callback({ ok: true, data: {} });
  } } }, setInterval(callback) { intervals.push(callback); return intervals.length; }, clearInterval() {}, setTimeout, Promise, Date, console, confirm: () => true, alert() {} });
  new vm.Script(recoverySource, { filename: 'src/domain/recovery-actions.js' }).runInContext(context);
  new vm.Script(source, { filename: 'src/content/github.js' }).runInContext(context); await new Promise(resolve => setTimeout(resolve, 0));
  const trigger = createdNodes.filter(node => node.tag === 'button' && node.getAttribute('aria-haspopup') === 'dialog').at(-1);
  await trigger.onclick({ isTrusted: true }); await new Promise(resolve => setTimeout(resolve, 0));
  const total = createdNodes.findLast(node => node.className === 'today-total');
  assert.equal(total.children[0].textContent, 'Today:');
  assert.equal(total.children[1].textContent, '1h 30m');
  const rotate = intervals.at(-1);
  rotate(); assert.equal(total.children[0].textContent, 'Today:', 'Today remains visible for two seconds');
  rotate(); assert.equal(total.children[0].textContent, 'This week:');
  rotate(); assert.equal(total.children[0].textContent, 'Last week:');
  rotate(); assert.equal(total.children[0].textContent, 'This month:');
  const day = createdNodes.findLast(node => node.className === 'entry-day');
  const inlineValues = createdNodes.filter(node => node.className.includes('inline-time-value')).slice(-4);
  const duration = createdNodes.findLast(node => node.className === 'inline-duration');
  assert.equal(day.textContent, 'Today');
  assert.deepEqual(inlineValues.map(node => node.value), ['08', '00', '09', '30']);
  assert.equal(duration.textContent, '1h 30m');
  assert.doesNotMatch(day.textContent, /acme|\d{1,2}\/\d{1,2}\/\d{4}/);
  await trigger.onclick({ isTrusted: true });
  await trigger.onclick({ isTrusted: true }); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(messages.filter(message => message.type === 'LOAD_RECENT').length, 2, 'each menu opening refreshes its atomic today snapshot');
  const reports = createdNodes.findLast(node => node.tag === 'button' && node.textContent === 'Reports');
  const settings = createdNodes.findLast(node => node.getAttribute('aria-label') === 'Time tracker settings');
  assert.ok(reports?.onclick); assert.ok(settings);
  assert.ok(reports.parentElement.children.indexOf(reports) < reports.parentElement.children.indexOf(settings));
  await reports.onclick({ isTrusted: true });
  assert.deepEqual(messages.findLast(message => message.type === 'OPEN_REPORTS'), { type: 'OPEN_REPORTS' });
});

test('split header navigation tracks a generic GitHub URL and still opens Top tasks', async () => {
  documentNodes.clear(); createdNodes.length = 0;
  const messages = [];
  const location = { protocol: 'https:', hostname: 'github.com', pathname: '/issues/assigned', href: 'https://github.com/issues/assigned' };
  const { actions, avatarSlot } = makeHeader();
  const document = {
    documentElement: new FakeNode('html'), createElement: tag => new FakeNode(tag), createElementNS: (namespace, tag) => new FakeNode(tag),
    createTextNode: text => ({ textContent: text }), getElementById: id => documentNodes.get(id) ?? null,
    querySelector: selector => selector === '.AppHeader-actions' ? actions : null, addEventListener() {},
  };
  const context = vm.createContext({
    location, document, chrome: { runtime: { lastError: null, sendMessage(message, callback) {
      messages.push(structuredClone(message));
      callback({ ok: true, data: message.type === 'GET_PAGE_STATE' ? { configured: true, active: null, pendingCount: 0, pendingWrites: [] } : {} });
    } } },
    setInterval() { return 1; }, clearInterval() {}, setTimeout, Promise, Date, console, confirm: () => true, alert() {},
  });
  new vm.Script(recoverySource, { filename: 'src/domain/recovery-actions.js' }).runInContext(context);
  new vm.Script(source, { filename: 'src/content/github.js' }).runInContext(context);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(actions.children.at(-2)?.id, 'clockoli-root');
  assert.equal(actions.children.at(-1), avatarSlot);
  const main = createdNodes.findLast(node => node.tag === 'button' && node.className.includes('trigger-main'));
  const arrow = createdNodes.findLast(node => node.tag === 'button' && node.className.includes('trigger-menu'));
  assert.ok(main?.onclick); assert.ok(arrow?.onclick);
  assert.equal(main.getAttribute('aria-haspopup'), 'dialog');
  assert.equal(arrow.getAttribute('aria-haspopup'), 'menu');
  await arrow.onclick({ isTrusted: true });
  const tasks = createdNodes.findLast(node => node.tag === 'button' && node.textContent === 'Top tasks');
  assert.ok(tasks?.onclick);
  await tasks.onclick({ isTrusted: true });
  assert.deepEqual(messages.findLast(message => message.type === 'OPEN_TASKS'), { type: 'OPEN_TASKS' });
  assert.equal(messages.some(message => message.type === 'LOAD_RECENT'), false);
  await main.onclick({ isTrusted: true }); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(messages.some(message => message.type === 'LOAD_RECENT'), true);
  assert.ok(createdNodes.findLast(node => node.tag === 'button' && node.textContent === 'Start tracking this task'));
});

test('split main segment resolves a generic GitHub URL to an issue URL at activation time', async () => {
  documentNodes.clear(); createdNodes.length = 0;
  const messages = [], location = { protocol: 'https:', hostname: 'github.com', pathname: '/issues/assigned', href: 'https://github.com/issues/assigned' };
  const { actions } = makeHeader();
  const document = { documentElement: new FakeNode('html'), createElement: tag => new FakeNode(tag), createElementNS: (namespace, tag) => new FakeNode(tag), createTextNode: text => ({ textContent: text }), getElementById: id => documentNodes.get(id) ?? null, querySelector: selector => selector === '.AppHeader-actions' ? actions : null, addEventListener() {} };
  const context = vm.createContext({ location, document, chrome: { runtime: { lastError: null, sendMessage(message, callback) {
    messages.push(structuredClone(message));
    if (message.type === 'GET_PAGE_STATE') callback({ ok: true, data: { configured: true, active: null, pendingCount: 0, pendingWrites: [] } });
    else if (message.type === 'LOAD_RECENT') callback({ ok: true, data: { recent: [], todaySeconds: 0, reportDate: '2026-08-20', active: null, pendingCount: 0, pendingWrites: [] } });
    else callback({ ok: true, data: {} });
  } } }, setInterval() { return 1; }, clearInterval() {}, setTimeout, Promise, Date, console, confirm: () => true, alert() {} });
  new vm.Script(recoverySource, { filename: 'src/domain/recovery-actions.js' }).runInContext(context);
  new vm.Script(source, { filename: 'src/content/github.js' }).runInContext(context); await new Promise(resolve => setTimeout(resolve, 0));
  const main = createdNodes.findLast(node => node.tag === 'button' && node.className.includes('trigger-main'));
  location.pathname = '/acme/app/issues/7'; location.href = 'https://github.com/acme/app/issues/7';
  await main.onclick({ isTrusted: true }); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(messages.some(message => message.type === 'LOAD_RECENT'), true);
  assert.ok(createdNodes.findLast(node => node.tag === 'button' && node.textContent === 'Start tracking this task'));
});

test('split main segment resolves an issue URL to another generic GitHub URL at activation time', async () => {
  documentNodes.clear(); createdNodes.length = 0;
  const messages = [], location = { protocol: 'https:', hostname: 'github.com', pathname: '/acme/app/issues/7', href: 'https://github.com/acme/app/issues/7' };
  const { actions } = makeHeader();
  const document = { documentElement: new FakeNode('html'), createElement: tag => new FakeNode(tag), createElementNS: (namespace, tag) => new FakeNode(tag), createTextNode: text => ({ textContent: text }), getElementById: id => documentNodes.get(id) ?? null, querySelector: selector => selector === '.AppHeader-actions' ? actions : null, addEventListener() {} };
  const context = vm.createContext({ location, document, chrome: { runtime: { lastError: null, sendMessage(message, callback) { messages.push(structuredClone(message)); callback({ ok: true, data: message.type === 'GET_PAGE_STATE' ? { configured: true, active: null, pendingCount: 0, pendingWrites: [] } : {} }); } } }, setInterval() { return 1; }, clearInterval() {}, setTimeout, Promise, Date, console, confirm: () => true, alert() {} });
  new vm.Script(recoverySource, { filename: 'src/domain/recovery-actions.js' }).runInContext(context);
  new vm.Script(source, { filename: 'src/content/github.js' }).runInContext(context); await new Promise(resolve => setTimeout(resolve, 0));
  const main = createdNodes.findLast(node => node.tag === 'button' && node.className.includes('trigger-main'));
  location.pathname = '/issues/assigned'; location.href = 'https://github.com/issues/assigned';
  await main.onclick({ isTrusted: true }); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(messages.some(message => message.type === 'LOAD_RECENT'), true);
  assert.ok(createdNodes.findLast(node => node.tag === 'button' && node.textContent === 'Start tracking this task'));
});

test('header mounting falls back to a complete legacy header when the modern container has no avatar', async () => {
  documentNodes.clear(); createdNodes.length = 0;
  const modern = new FakeNode('div'); modern.setAttribute('data-testid', 'top-nav-right'); modern.isConnected = true;
  const { actions, avatarSlot } = makeHeader();
  const location = { protocol: 'https:', hostname: 'github.com', pathname: '/acme/app/issues/1', href: 'https://github.com/acme/app/issues/1' };
  const document = {
    documentElement: new FakeNode('html'), createElement: tag => new FakeNode(tag), createElementNS: (namespace, tag) => new FakeNode(tag),
    createTextNode: text => ({ textContent: text }), getElementById: id => documentNodes.get(id) ?? null,
    querySelector: selector => selector === '[data-testid="top-nav-right"]' ? modern : selector === '.AppHeader-actions' ? actions : null,
    addEventListener() {},
  };
  const context = vm.createContext({
    location, document, chrome: { runtime: { lastError: null, sendMessage(message, callback) {
      callback({ ok: true, data: { configured: true, active: null, pendingCount: 0, pendingWrites: [] } });
    } } }, setInterval() { return 1; }, clearInterval() {}, setTimeout, Promise, Date, console, confirm: () => true, alert() {},
  });
  new vm.Script(recoverySource, { filename: 'src/domain/recovery-actions.js' }).runInContext(context);
  new vm.Script(source, { filename: 'src/content/github.js' }).runInContext(context);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(actions.children.at(-2)?.id, 'clockoli-root');
  assert.equal(actions.children.at(-1), avatarSlot);
  assert.equal(modern.children.length, 0);
});


test('GitHub tracking menu exposes a safe Retry action for transient operation failures', async () => {
  documentNodes.clear(); createdNodes.length = 0;
  const messages = [];
  const location = { protocol: 'https:', hostname: 'github.com', pathname: '/acme/app/issues/7', href: 'https://github.com/acme/app/issues/7' };
  const { actions } = makeHeader();
  const document = {
    documentElement: new FakeNode('html'), createElement: tag => new FakeNode(tag), createElementNS: (_namespace, tag) => new FakeNode(tag),
    createTextNode: text => ({ textContent: text }), getElementById: id => documentNodes.get(id) ?? null,
    querySelector: selector => selector === '.AppHeader-actions' ? actions : null, addEventListener() {},
  };
  let loadCalls = 0;
  const context = vm.createContext({
    location, document, chrome: { runtime: { lastError: null, sendMessage(message, callback) {
      messages.push(structuredClone(message));
      if (message.type === 'GET_PAGE_STATE') callback({ ok: true, data: { configured: true, active: null, pendingCount: 0, pendingWrites: [] } });
      else if (message.type === 'LOAD_RECENT') { loadCalls += 1; callback({ ok: true, data: [] }); }
      else if (message.type === 'START') callback({ ok: false, error: { code: 'error', message: 'Network unavailable' } });
      else callback({ ok: true, data: {} });
    } } },
    setInterval() { return 1; }, clearInterval() {}, setTimeout, Promise, Date, console, confirm: () => true, alert() {},
  });
  new vm.Script(recoverySource, { filename: 'src/domain/recovery-actions.js' }).runInContext(context);
  new vm.Script(source, { filename: 'src/content/github.js' }).runInContext(context);
  await new Promise(resolve => setTimeout(resolve, 0));
  const trigger = createdNodes.filter(node => node.tag === 'button' && node.getAttribute('aria-haspopup') === 'dialog').at(-1);
  await trigger.onclick({ isTrusted: true }); await new Promise(resolve => setTimeout(resolve, 0));
  const start = createdNodes.filter(node => node.tag === 'button' && node.textContent === 'Start tracking this task').at(-1);
  await start.onclick({ isTrusted: true }); await new Promise(resolve => setTimeout(resolve, 0));
  const retry = createdNodes.filter(node => node.tag === 'button' && node.textContent === 'Retry').at(-1);
  assert.ok(retry?.onclick, 'transient error exposes Retry');
  const before = loadCalls;
  await retry.onclick({ isTrusted: true }); await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok(loadCalls > before, 'Retry performs a safe tracker refresh');
  assert.equal(messages.some(message => message.type === 'OPEN_OPTIONS'), false);
});


test('Times bulk import preserves its draft and remains single-flight across rerenders and failure', async () => {
  documentNodes.clear(); createdNodes.length = 0;
  const root = new FakeNode('div'); root.id = 'clockoli-times-root'; root.isConnected = true; documentNodes.set(root.id, root);
  const location = { protocol: 'chrome-extension:', hostname: 'extension', pathname: '/src/times/times.html', href: 'chrome-extension://extension/src/times/times.html' };
  const document = {
    documentElement: new FakeNode('html'), activeElement: null,
    createElement: tag => new FakeNode(tag), createElementNS: (_namespace, tag) => new FakeNode(tag),
    createTextNode: text => ({ textContent: text }), getElementById: id => documentNodes.get(id) ?? null,
    querySelector: () => null, addEventListener() {},
  };
  let bulkCallback = null, bulkCalls = 0;
  const context = vm.createContext({
    location, document, chrome: { runtime: { lastError: null, sendMessage(message, callback) {
      if (message.type === 'LOAD_TIMES') callback({ ok: true, data: { configured: true, recent: [] } });
      else if (message.type === 'BULK_ADD_TIMES') { bulkCalls += 1; bulkCallback = callback; }
      else callback({ ok: true, data: {} });
    } } },
    setInterval() { return 1; }, clearInterval() {}, setTimeout, Promise, Date, console, confirm: () => true, alert() {},
  });
  new vm.Script(recoverySource, { filename: 'src/domain/recovery-actions.js' }).runInContext(context);
  new vm.Script(source, { filename: 'src/content/github.js' }).runInContext(context);
  await new Promise(resolve => setTimeout(resolve, 0));

  const draft = '2026-08-23 https://example.com/task Preserve this draft 1';
  const input = createdNodes.findLast(node => node.className.includes('bulk-time-input'));
  input.value = draft; input.oninput({});
  const firstAdd = createdNodes.findLast(node => node.tag === 'button' && node.textContent === 'Add time');
  const firstSubmission = firstAdd.onclick({ isTrusted: true });
  await new Promise(resolve => setTimeout(resolve, 0));

  const replacementInput = createdNodes.findLast(node => node.className.includes('bulk-time-input'));
  const replacementAdd = createdNodes.findLast(node => node.tag === 'button' && node.textContent === 'Add time');
  assert.notEqual(replacementInput, input);
  assert.equal(replacementInput.value, draft);
  assert.equal(replacementInput.disabled, true);
  assert.equal(replacementAdd.disabled, true);
  await replacementAdd.onclick({ isTrusted: true });
  assert.equal(bulkCalls, 1);

  bulkCallback({ ok: false, error: { code: 'conflict', message: 'The monthly file changed.' } });
  await firstSubmission; await new Promise(resolve => setTimeout(resolve, 0));
  const failedInput = createdNodes.findLast(node => node.className.includes('bulk-time-input'));
  const failedAdd = createdNodes.findLast(node => node.tag === 'button' && node.textContent === 'Add time');
  assert.equal(failedInput.value, draft);
  assert.equal(failedInput.disabled, false);
  assert.equal(failedAdd.disabled, false);
  assert.equal(createdNodes.some(node => node.textContent === 'The monthly file changed.'), true);
});


test('Times ignores a rejected initial load after a newer period succeeds', async () => {
  documentNodes.clear(); createdNodes.length = 0;
  const root = new FakeNode('div'); root.id = 'clockoli-times-root'; root.isConnected = true; documentNodes.set(root.id, root);
  const location = { protocol: 'chrome-extension:', hostname: 'extension', pathname: '/src/times/times.html', href: 'chrome-extension://extension/src/times/times.html' };
  const document = {
    documentElement: new FakeNode('html'), activeElement: null,
    createElement: tag => new FakeNode(tag), createElementNS: (_namespace, tag) => new FakeNode(tag),
    createTextNode: text => ({ textContent: text }), getElementById: id => documentNodes.get(id) ?? null,
    querySelector: () => null, addEventListener() {},
  };
  const loads = [];
  const context = vm.createContext({
    location, document, chrome: { runtime: { lastError: null, sendMessage(message, callback) {
      if (message.type === 'LOAD_TIMES') loads.push({ message: structuredClone(message), callback });
      else callback({ ok: true, data: {} });
    } } },
    setInterval() { return 1; }, clearInterval() {}, setTimeout, Promise, Date, console, confirm: () => true, alert() {},
  });
  new vm.Script(recoverySource, { filename: 'src/domain/recovery-actions.js' }).runInContext(context);
  new vm.Script(source, { filename: 'src/content/github.js' }).runInContext(context);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(loads.length, 1);

  const period = createdNodes.findLast(node => node.tag === 'select' && node.getAttribute('aria-label') === 'Time period');
  period.value = 'yesterday'; period.onchange({ isTrusted: true });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(loads.length, 2);
  loads[1].callback({ ok: true, data: { configured: true, recent: [] } });
  await new Promise(resolve => setTimeout(resolve, 0));
  loads[0].callback({ ok: false, error: { code: 'superseded', message: 'Time load was superseded by a configuration change.' } });
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(createdNodes.some(node => node.textContent === 'Time load was superseded by a configuration change.'), false);
  const selected = createdNodes.filter(node => node.tag === 'option' && node.selected).at(-1);
  assert.equal(selected.value, 'yesterday');
});


test('Times keeps every linked draft row mounted while filtering and saves the full group', async () => {
  documentNodes.clear(); createdNodes.length = 0;
  const root = new FakeNode('div'); root.id = 'clockoli-times-root'; root.isConnected = true; documentNodes.set(root.id, root);
  const location = { protocol: 'chrome-extension:', hostname: 'extension', pathname: '/src/times/times.html', href: 'chrome-extension://extension/src/times/times.html' };
  const makeEntry = (id, url, title, start, end, index) => ({
    schemaVersion: 1, id, user: 'alice', taskUrl: url, taskTitle: title,
    entryDate: start.slice(0, 10), startedAt: start, endedAt: end,
    durationSeconds: (new Date(end) - new Date(start)) / 1000, description: '',
    createdAt: end, updatedAt: end, _path: 'times/2026-08/alice.txt', _sha: 'same', _index: index,
  });
  const entries = [
    makeEntry('x', 'https://example.com/x', 'X', '2026-08-21T10:00:00+00:00', '2026-08-21T11:00:00+00:00', 0),
    makeEntry('y', 'https://example.com/y', 'Y', '2026-08-21T11:00:00+00:00', '2026-08-21T12:00:00+00:00', 1),
  ];
  const messages = [];
  const document = {
    documentElement: new FakeNode('html'), activeElement: null,
    createElement: tag => new FakeNode(tag), createElementNS: (_namespace, tag) => new FakeNode(tag),
    createTextNode: text => ({ textContent: text }), getElementById: id => documentNodes.get(id) ?? null,
    querySelector: () => null, addEventListener() {},
  };
  const context = vm.createContext({
    location, document, chrome: { runtime: { lastError: null, sendMessage(message, callback) {
      messages.push(structuredClone(message));
      if (message.type === 'LOAD_TIMES') callback({ ok: true, data: { configured: true, recent: entries } });
      else if (message.type === 'EDIT_ENTRIES') callback({ ok: true, data: [] });
      else callback({ ok: true, data: {} });
    } } },
    setInterval() { return 1; }, clearInterval() {}, setTimeout, Promise, Date, console, confirm: () => true, alert() {},
  });
  new vm.Script(recoverySource, { filename: 'src/domain/recovery-actions.js' }).runInContext(context);
  new vm.Script(source, { filename: 'src/content/github.js' }).runInContext(context);
  await new Promise(resolve => setTimeout(resolve, 0));

  const values = createdNodes.filter(node => node.className.includes('inline-time-value')).slice(-8);
  values[7].value = '15'; values[7].oninput({});
  assert.deepEqual(values.slice(0, 2).map(node => node.value), ['11', '15'], 'Y Start mirrors X Stop');
  const filter = createdNodes.findLast(node => node.placeholder === 'Filter by URL or optional title');
  filter.value = '/x'; filter.oninput({});
  const filteredValues = createdNodes.filter(node => node.className.includes('inline-time-value')).slice(-8);
  assert.equal(filteredValues.length, 8, 'the linked Y row remains mounted even though it does not match the filter');
  const save = createdNodes.filter(node => node.className.includes('inline-save')).at(-1);
  await save.onclick({ isTrusted: true }); await new Promise(resolve => setTimeout(resolve, 0));
  const edit = messages.findLast(message => message.type === 'EDIT_ENTRIES');
  assert.equal(edit.payload.entries.length, 2);
  assert.deepEqual(edit.payload.entries.map(item => [item.edits.startedAt, item.edits.endedAt]), [
    ['2026-08-21T10:00:00+00:00', '2026-08-21T11:15:00+00:00'],
    ['2026-08-21T11:15:00+00:00', '2026-08-21T12:00:00+00:00'],
  ]);
});
