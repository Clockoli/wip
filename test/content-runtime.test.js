import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/content/github.js', import.meta.url), 'utf8');

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
  querySelector(selector) {
    if (selector === 'img.avatar') return this.walk().find(node => node.tag === 'img' && node.className.split(/\s+/).includes('avatar')) ?? null;
    if (selector === 'img[data-testid="github-avatar"]') return this.walk().find(node => node.tag === 'img' && node.getAttribute('data-testid') === 'github-avatar') ?? null;
    return null;
  }
  walk() { return [this, ...this.children.flatMap(child => typeof child.walk === 'function' ? child.walk() : [])]; }
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
  new vm.Script(source, { filename: 'src/content/github.js' }).runInContext(context);
  await new Promise(resolve => setTimeout(resolve, 0));
  const navigationCheck = intervals.at(-1);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].refresh, true);

  for (let index = 0; index < 100; index += 1) {
    location.href = `https://github.com/acme/app/issues/1?noise=${index}#${index}`;
    navigationCheck();
  }
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(messages.length, 1);

  location.pathname = '/acme/app/issues/2';
  location.href = 'https://github.com/acme/app/issues/2';
  navigationCheck();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(messages.length, 2);
  assert.equal(messages[1].refresh, false);

  location.pathname = '/acme/app/pull/2';
  location.href = 'https://github.com/acme/app/pull/2';
  navigationCheck();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(messages.length, 3);
  const trigger = createdNodes.filter(node => node.tag === 'button' && node.getAttribute('aria-haspopup') === 'dialog').at(-1);
  assert.equal(actions.children.at(-2)?.id, 'github-private-time-tracker-root');
  assert.equal(actions.children.at(-1), avatarSlot);
  await trigger.onclick({ isTrusted: true });
  await new Promise(resolve => setTimeout(resolve, 0));
  const start = createdNodes.filter(node => node.tag === 'button' && node.textContent === 'Start timer on #2').at(-1);
  assert.ok(start?.onclick, 'Start handler was rendered in the pull-request menu');
  await start.onclick({ isTrusted: true });
  await new Promise(resolve => setTimeout(resolve, 0));
  const startMessage = messages.findLast(message => message.type === 'START');
  assert.deepEqual(startMessage.issue, {
    type: 'pull_request', owner: 'acme', repo: 'app', number: 2, url: 'https://github.com/acme/app/pull/2',
  });
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
        callback({ ok: true, data: { configured: true, active: pageRequests === 1 ? active : null, pendingCount: 0 } });
      } else if (message.type === 'STOP') callback({ ok: true, data: { pending: false } });
      else callback({ ok: true, data: {} });
    } } },
    setInterval() { return 1; }, clearInterval() {}, setTimeout, Promise, Date, console,
    prompt: () => 'done', confirm: () => true, alert() {},
  });
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
  assert.equal(pageStateMessages.length, 1);
  assert.deepEqual(messages.findLast(message => message.type === 'LOAD_RECENT'), { type: 'LOAD_RECENT', menuData: true });
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
  new vm.Script(source, { filename: 'src/content/github.js' }).runInContext(context);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(document.getElementById('github-private-time-tracker-root'), null);
  assert.equal(messages.length, 0);

  headerReady = true;
  intervals.at(-1)();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(actions.children.at(-2)?.id, 'github-private-time-tracker-root');
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
  new vm.Script(source, { filename: 'src/content/github.js' }).runInContext(context);
  await new Promise(resolve => setTimeout(resolve, 0));
  const trigger = createdNodes.filter(node => node.tag === 'button' && node.getAttribute('aria-haspopup') === 'dialog').at(-1);
  await trigger.onclick({ isTrusted: true });
  await new Promise(resolve => setTimeout(resolve, 0));
  const start = createdNodes.filter(node => node.tag === 'button' && node.textContent === 'Start timer on #7').at(-1);
  const retry = createdNodes.filter(node => node.tag === 'button' && node.textContent === 'Retry entry sync').at(-1);
  assert.equal(start.disabled, true, 'pending entry prevents another timer');
  assert.ok(retry?.onclick, 'entry conflict exposes its recovery action');
  await retry.onclick({ isTrusted: true });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(messages.find(message => message.type === 'RESOLVE_PENDING'), { type: 'RESOLVE_PENDING', id: 'pending-1' });
  assert.equal(resolved, true);
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
  new vm.Script(source, { filename: 'src/content/github.js' }).runInContext(context);
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(right.children[0], topBarActions);
  assert.equal(right.children.at(-2)?.id, 'github-private-time-tracker-root');
  assert.equal(right.children.at(-1), avatarSlot);
  assert.deepEqual(messages, [{ type: 'GET_PAGE_STATE', refresh: true }]);
});


test('Edit entry drag handle previews End changes within twelve hours', async () => {
  documentNodes.clear(); createdNodes.length = 0;
  const location = { protocol: 'https:', hostname: 'github.com', pathname: '/acme/app/issues/7', href: 'https://github.com/acme/app/issues/7' };
  const { actions } = makeHeader();
  const entry = {
    schemaVersion: 1, id: '01K2ABCDEF0123456789ABCDEF', user: 'alice',
    issue: { type: 'issue', owner: 'acme', repo: 'app', number: 7, url: 'https://github.com/acme/app/issues/7' },
    startedAt: '2026-08-18T08:00:00.000Z', endedAt: '2026-08-18T09:00:00.000Z', durationSeconds: 3600,
    description: '', createdAt: '2026-08-18T09:00:00.000Z', updatedAt: '2026-08-18T09:00:00.000Z',
    _path: 'times/2026-08/alice.txt', _sha: 'one', _index: 0,
  };
  const document = {
    documentElement: new FakeNode('html'), createElement: tag => new FakeNode(tag), createElementNS: (namespace, tag) => new FakeNode(tag),
    createTextNode: text => ({ textContent: text }), getElementById: id => documentNodes.get(id) ?? null,
    querySelector: selector => selector === '.AppHeader-actions' ? actions : null, addEventListener() {},
  };
  const context = vm.createContext({
    location, document, chrome: { runtime: { lastError: null, sendMessage(message, callback) {
      if (message.type === 'GET_PAGE_STATE') callback({ ok: true, data: { configured: true, active: null, pendingCount: 0, pendingWrites: [] } });
      else if (message.type === 'LOAD_RECENT') callback({ ok: true, data: [entry] });
      else callback({ ok: true, data: {} });
    } } },
    setInterval() { return 1; }, clearInterval() {}, setTimeout, Promise, Date, console, confirm: () => true, alert() {},
  });
  new vm.Script(source, { filename: 'src/content/github.js' }).runInContext(context);
  await new Promise(resolve => setTimeout(resolve, 0));
  const trigger = createdNodes.filter(node => node.tag === 'button' && node.getAttribute('aria-haspopup') === 'dialog').at(-1);
  await trigger.onclick({ isTrusted: true }); await new Promise(resolve => setTimeout(resolve, 0));
  const edit = createdNodes.filter(node => node.tag === 'button' && node.textContent === 'Edit').at(-1);
  await edit.onclick({ isTrusted: true }); await new Promise(resolve => setTimeout(resolve, 0));
  const handle = createdNodes.filter(node => node.className.includes('time-drag')).at(-1);
  assert.equal(handle.getAttribute('role'), 'slider');
  assert.match(handle.getAttribute('aria-label'), /adjust end time/i);
  handle.onpointerdown({ isTrusted: true, pointerId: 1, clientX: 35, preventDefault() {} });
  handle.onpointermove({ isTrusted: true, pointerId: 1, clientX: 286, preventDefault() {} });
  assert.equal(handle.children[1].style.left, '100%', 'the grip reaches the far right of the track');
  assert.equal(handle.children[1].style.transform, 'translateX(-28px)', 'the grip remains inside the track at the right edge');
  assert.doesNotMatch(handle.walk().map(node => node.textContent).join(''), /Drag.*12h/i, 'the control has no instructional text');
  const endLabel = createdNodes.findLast(node => node.tag === 'label' && node.textContent === 'End');
  assert.equal(new Date(endLabel.children[0].value).getTime(), new Date(entry.endedAt).getTime() + 12 * 60 * 60000, 'the right edge previews the maximum End');
  handle.onpointermove({ isTrusted: true, pointerId: 1, clientX: 10_000, preventDefault() {} });
  assert.equal(new Date(endLabel.children[0].value).getTime(), new Date(entry.endedAt).getTime() + 12 * 60 * 60000, 'dragging is capped at 12 hours after the original End');
  handle.onkeydown({ isTrusted: true, key: 'Escape', preventDefault() {} });
  assert.equal(new Date(endLabel.children[0].value).getTime(), new Date(entry.endedAt).getTime(), 'Escape cancels the drag preview');
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
  new vm.Script(source, { filename: 'src/content/github.js' }).runInContext(context); await new Promise(resolve => setTimeout(resolve, 0));
  const trigger = createdNodes.filter(node => node.tag === 'button' && node.getAttribute('aria-haspopup') === 'dialog').at(-1);
  await trigger.onclick({ isTrusted: true }); await new Promise(resolve => setTimeout(resolve, 0));
  const description = createdNodes.findLast(node => node.tag === 'input' && node.placeholder === 'Optional');
  let stopped = false;
  description.onkeydown({ target: description, key: 'a', stopPropagation() { stopped = true; } });
  assert.equal(stopped, true);
});

test('panel boundary drag shifts adjacent End and Start together', async () => {
  documentNodes.clear(); createdNodes.length = 0;
  const messages = [];
  const location = { protocol: 'https:', hostname: 'github.com', pathname: '/acme/app/issues/7', href: 'https://github.com/acme/app/issues/7' };
  const { actions } = makeHeader();
  const entry = (id, number, startedAt, endedAt, sha) => ({
    schemaVersion: 1, id, user: 'alice', issue: { type: 'issue', owner: 'acme', repo: 'app', number, url: `https://github.com/acme/app/issues/${number}` },
    startedAt, endedAt, durationSeconds: (new Date(endedAt) - new Date(startedAt)) / 1000, description: '',
    createdAt: endedAt, updatedAt: endedAt, _path: 'times/2026-08/alice.txt', _sha: sha, _index: number - 1,
  });
  const older = entry('01K2ABCDEF0123456789ABCDEA', 1, '2026-08-18T09:00:00+03:00', '2026-08-18T10:00:00+03:00', 'daily');
  const newer = entry('01K2ABCDEF0123456789ABCDEB', 2, '2026-08-18T07:00:00+00:00', '2026-08-19T08:00:00+00:00', 'daily');
  const document = {
    documentElement: new FakeNode('html'), createElement: tag => new FakeNode(tag), createElementNS: (namespace, tag) => new FakeNode(tag),
    createTextNode: text => ({ textContent: text }), getElementById: id => documentNodes.get(id) ?? null,
    querySelector: selector => selector === '.AppHeader-actions' ? actions : null, addEventListener() {},
  };
  const context = vm.createContext({
    location, document, chrome: { runtime: { lastError: null, sendMessage(message, callback) {
      messages.push(structuredClone(message));
      if (message.type === 'GET_PAGE_STATE') callback({ ok: true, data: { configured: true, active: null, pendingCount: 0, pendingWrites: [] } });
      else if (message.type === 'LOAD_RECENT') callback({ ok: true, data: [newer, older] });
      else if (message.type === 'MOVE_BOUNDARY') callback({ ok: true, data: [
        { ...older, endedAt: message.payload.upper.endedAt, durationSeconds: 4500, _sha: 'older-saved' },
        { ...newer, startedAt: message.payload.lower.startedAt, durationSeconds: 2700, _sha: 'newer-saved' },
      ] });
      else callback({ ok: true, data: {} });
    } } },
    setInterval() { return 1; }, clearInterval() {}, setTimeout, Promise, Date, console, confirm: () => true, alert() {},
  });
  new vm.Script(source, { filename: 'src/content/github.js' }).runInContext(context);
  await new Promise(resolve => setTimeout(resolve, 0));
  const trigger = createdNodes.filter(node => node.tag === 'button' && node.getAttribute('aria-haspopup') === 'dialog').at(-1);
  await trigger.onclick({ isTrusted: true }); await new Promise(resolve => setTimeout(resolve, 0));
  const handle = createdNodes.filter(node => node.className.includes('time-boundary')).at(-1);
  assert.match(handle.getAttribute('aria-label'), /boundary.*#1.*#2/i);
  assert.equal(handle.getAttribute('aria-valuemax'), '1500', 'the main-panel range is derived from the full lower interval, not capped at 12 hours');
  handle.onpointerdown({ isTrusted: true, pointerId: 2, clientX: 150, preventDefault() {} });
  handle.onpointermove({ isTrusted: true, pointerId: 2, clientX: 286, preventDefault() {} });
  assert.equal(handle.children[1].style.left, '100%', 'the boundary grip reaches the far right of the track');
  assert.equal(handle.children[1].style.transform, 'translateX(-28px)', 'the boundary grip stays inside the right edge');
  assert.doesNotMatch(handle.walk().map(node => node.textContent).join(''), /Drag.*12h/i, 'the boundary has no instructional text');
  await handle.onpointerup({ isTrusted: true, pointerId: 2, clientX: 286, preventDefault() {} });
  const batch = messages.find(message => message.type === 'MOVE_BOUNDARY');
  assert.equal(batch.payload.upper.path, older._path);
  assert.equal(batch.payload.upper.endedAt, '2026-08-19T08:00:00.000Z');
  assert.equal(batch.payload.upper.index, 0);
  assert.equal(batch.payload.lower.path, newer._path);
  assert.equal(batch.payload.lower.startedAt, '2026-08-19T08:00:00.000Z');
  assert.equal(batch.payload.lower.index, 1);
  assert.equal(messages.filter(message => message.type === 'LOAD_RECENT').length, 1, 'saved entries stay visible without an immediate stale reload');
  const moveCount = messages.filter(message => message.type === 'MOVE_BOUNDARY').length;
  handle.setAttribute('aria-disabled', 'true');
  handle.onpointerdown({ isTrusted: true, pointerId: 3, clientX: 0, preventDefault() {} });
  handle.onpointermove({ isTrusted: true, pointerId: 3, clientX: 3, preventDefault() {} });
  await handle.onpointerup({ isTrusted: true, pointerId: 3, clientX: 3, preventDefault() {} });
  assert.equal(messages.filter(message => message.type === 'MOVE_BOUNDARY').length, moveCount, 'disabled pending boundaries cannot commit');
});


test('main panel shows today total and opens Reports before Settings', async () => {
  documentNodes.clear(); createdNodes.length = 0;
  const messages = [];
  const location = { protocol: 'https:', hostname: 'github.com', pathname: '/acme/app/issues/7', href: 'https://github.com/acme/app/issues/7' };
  const { actions } = makeHeader();
  const today = new Date(), pad = value => String(value).padStart(2, '0');
  const date = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const recentEntry = { user: 'alice', entryDate: date, durationSeconds: 5400, issue: { type: 'issue', owner: 'acme', repo: 'app', number: 7, url: 'https://github.com/acme/app/issues/7' }, startedAt: `${date}T08:00:00+00:00`, endedAt: `${date}T09:30:00+00:00`, description: '', _path: `times/${date}/alice.txt`, _sha: 'x', _index: 0 };
  const document = { documentElement: new FakeNode('html'), createElement: tag => new FakeNode(tag), createElementNS: (namespace, tag) => new FakeNode(tag), createTextNode: text => ({ textContent: text }), getElementById: id => documentNodes.get(id) ?? null, querySelector: selector => selector === '.AppHeader-actions' ? actions : null, addEventListener() {} };
  const context = vm.createContext({ location, document, chrome: { runtime: { lastError: null, sendMessage(message, callback) {
    messages.push(structuredClone(message));
    if (message.type === 'GET_PAGE_STATE') callback({ ok: true, data: { configured: true, active: { ...recentEntry, endedAt: undefined, startedAt: `${date}T08:00:00+00:00` }, pendingCount: 0, pendingWrites: [] } });
    else if (message.type === 'LOAD_RECENT') callback({ ok: true, data: { recent: [recentEntry], todaySeconds: 5400, reportDate: date, active: null, pendingCount: 0, pendingWrites: [] } });
    else callback({ ok: true, data: {} });
  } } }, setInterval() { return 1; }, clearInterval() {}, setTimeout, Promise, Date, console, confirm: () => true, alert() {} });
  new vm.Script(source, { filename: 'src/content/github.js' }).runInContext(context); await new Promise(resolve => setTimeout(resolve, 0));
  const trigger = createdNodes.filter(node => node.tag === 'button' && node.getAttribute('aria-haspopup') === 'dialog').at(-1);
  await trigger.onclick({ isTrusted: true }); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(createdNodes.findLast(node => node.className === 'today-total-value')?.textContent, '1h 30m');
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
