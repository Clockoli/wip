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
  assert.equal(actions.children.at(-2)?.id, 'repoclock-root');
  assert.equal(actions.children.at(-1), avatarSlot);
  await trigger.onclick({ isTrusted: true });
  await new Promise(resolve => setTimeout(resolve, 0));
  const start = createdNodes.filter(node => node.tag === 'button' && node.textContent === 'Start timer on task #2').at(-1);
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
  assert.equal(pageStateMessages.length, 1);
  assert.deepEqual(messages.findLast(message => message.type === 'LOAD_RECENT'), { type: 'LOAD_RECENT', menuData: true, issue: active.issue, issueTitle: '' });
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
  assert.equal(document.getElementById('repoclock-root'), null);
  assert.equal(messages.length, 0);

  headerReady = true;
  intervals.at(-1)();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(actions.children.at(-2)?.id, 'repoclock-root');
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
  const start = createdNodes.filter(node => node.tag === 'button' && node.textContent === 'Start timer on task #7').at(-1);
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
  assert.equal(right.children.at(-2)?.id, 'repoclock-root');
  assert.equal(right.children.at(-1), avatarSlot);
  assert.deepEqual(messages, [{ type: 'GET_PAGE_STATE', refresh: true }]);
});


test('recent rows show durable titles and Edit uses large scrollable offset-preserving time controls', async () => {
  documentNodes.clear(); createdNodes.length = 0;
  const messages = [];
  const location = { protocol: 'https:', hostname: 'github.com', pathname: '/acme/app/issues/7', href: 'https://github.com/acme/app/issues/7' };
  const { actions } = makeHeader();
  const entry = {
    schemaVersion: 1, id: '20260818000000000000000000', user: 'alice',
    issue: { type: 'issue', owner: 'acme', repo: 'app', number: 7, url: 'https://github.com/acme/app/issues/7' },
    issueTitle: 'Make ranking deterministic', entryDate: '2026-08-18',
    startedAt: '2026-08-18T08:00:11.321-07:00', endedAt: '2026-08-18T23:58:27.123-07:00', durationSeconds: 57500,
    description: '', createdAt: '2026-08-18T23:58:27.123-07:00', updatedAt: '2026-08-18T23:58:27.123-07:00',
    _path: 'times/2026-08/alice.txt', _sha: 'one', _index: 0,
  };
  const issueTitleNode = new FakeNode('bdi'); issueTitleNode.textContent = 'Make ranking deterministic';
  const document = {
    documentElement: new FakeNode('html'), activeElement: null,
    createElement: tag => new FakeNode(tag), createElementNS: (namespace, tag) => new FakeNode(tag),
    createTextNode: text => ({ textContent: text }), getElementById: id => documentNodes.get(id) ?? null,
    querySelector: selector => selector === '.AppHeader-actions' ? actions : selector.includes('issue-title') ? issueTitleNode : null, addEventListener() {},
  };
  let editAttempts = 0;
  const context = vm.createContext({
    location, document, chrome: { runtime: { lastError: null, sendMessage(message, callback) {
      messages.push(structuredClone(message));
      if (message.type === 'GET_PAGE_STATE') callback({ ok: true, data: { configured: true, active: null, pendingCount: 0, pendingWrites: [] } });
      else if (message.type === 'LOAD_RECENT') callback({ ok: true, data: [entry] });
      else if (message.type === 'EDIT_ENTRY') {
        editAttempts += 1;
        assert.equal(createdNodes.filter(node => node.className.includes('time-value') && !node.className.includes('inline-time-value')).slice(-4).every(node => node.disabled), true,
          'all detailed time fields are locked while Save is in flight');
        assert.equal(createdNodes.filter(node => node.tag === 'input' && (node.required || node.maxLength === 300)).slice(-2).every(node => node.disabled), true,
          'issue and title fields are locked while Save is in flight');
        assert.equal(createdNodes.filter(node => node.tag === 'textarea').at(-1).disabled, true);
        callback(editAttempts === 1 ? { ok: false, error: { code: 'conflict', message: 'The monthly file changed.' } }
          : { ok: true, data: { ...entry, ...message.payload.edits } });
      }
      else callback({ ok: true, data: {} });
    } } },
    setInterval() { return 1; }, clearInterval() {}, setTimeout, Promise, Date, console, confirm: () => true, alert() {},
  });
  new vm.Script(recoverySource, { filename: 'src/domain/recovery-actions.js' }).runInContext(context);
  new vm.Script(source, { filename: 'src/content/github.js' }).runInContext(context);
  await new Promise(resolve => setTimeout(resolve, 0));
  const trigger = createdNodes.filter(node => node.tag === 'button' && node.getAttribute('aria-haspopup') === 'dialog').at(-1);
  await trigger.onclick({ isTrusted: true }); await new Promise(resolve => setTimeout(resolve, 0));

  const recentLink = createdNodes.filter(node => node.tag === 'a' && node.href === entry.issue.url).at(-1);
  assert.equal(recentLink.textContent, 'app#7 · Make ranking deterministic');
  const inlineTimeValues = createdNodes.filter(node => node.className.includes('inline-time-value'));
  assert.deepEqual(inlineTimeValues.slice(-4).map(node => node.value), ['08', '00', '23', '58'],
    'the list exposes Start and Stop in their stored offset wall time');
  assert.equal(messages.findLast(message => message.type === 'LOAD_RECENT').issueTitle, 'Make ranking deterministic');
  assert.equal(createdNodes.some(node => node.className.includes('time-boundary')), false, 'no between-entry drag control remains');

  const edit = createdNodes.filter(node => node.tag === 'button' && node.textContent === 'Edit details').at(-1);
  await edit.onclick({ isTrusted: true }); await new Promise(resolve => setTimeout(resolve, 0));
  const timeValues = createdNodes.filter(node => node.className.includes('time-value') && !node.className.includes('inline-time-value'));
  assert.equal(timeValues.length, 4, 'Start and Stop each expose large hour and minute values');
  assert.deepEqual(timeValues.map(node => node.getAttribute('aria-label')), ['Start hour', 'Start minute', 'Stop hour', 'Stop minute']);
  assert.deepEqual(timeValues.map(node => node.getAttribute('role')), ['spinbutton', 'spinbutton', 'spinbutton', 'spinbutton']);
  assert.deepEqual(timeValues.map(node => node.getAttribute('aria-valuemin')), ['0', '0', '0', '0']);
  assert.deepEqual(timeValues.map(node => node.getAttribute('aria-valuemax')), ['23', '59', '23', '59']);
  assert.deepEqual(timeValues.map(node => node.getAttribute('aria-valuenow')), ['8', '0', '23', '58']);
  assert.equal(createdNodes.some(node => node.className.includes('time-drag')), false, 'Edit no longer uses a drag slider');

  const stopMinute = timeValues.at(-1); document.activeElement = stopMinute;
  stopMinute.value = ''; stopMinute.oninput({});
  let invalidPrevented = false;
  stopMinute.onwheel({ deltaY: -1, preventDefault() { invalidPrevented = true; } });
  assert.equal(invalidPrevented, false, 'a partial direct-input draft does not capture page scrolling');
  assert.equal(stopMinute.value, '', 'a partial direct-input draft is preserved instead of throwing or resetting');
  assert.equal(stopMinute.getAttribute('aria-invalid'), 'true');
  stopMinute.value = '58'; stopMinute.oninput({});
  assert.equal(stopMinute.getAttribute('aria-valuenow'), '58');
  const shadowHost = new FakeNode('div');
  document.activeElement = shadowHost;
  stopMinute.getRootNode = () => ({ activeElement: stopMinute });
  let prevented = false;
  stopMinute.onwheel({ deltaY: -1, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(stopMinute.value, '03', 'wheel stepping rolls minutes across midnight');
  const stopDate = createdNodes.filter(node => node.className.includes('time-date')).at(-1);
  assert.equal(stopDate.value, '2026-08-19', 'cross-midnight scrolling advances the Stop date');

  const titleDraft = createdNodes.filter(node => node.tag === 'input' && node.maxLength === 300).at(-1);
  const descriptionDraft = createdNodes.filter(node => node.tag === 'textarea').at(-1);
  titleDraft.value = 'Edited deterministic ranking'; titleDraft.oninput({}); descriptionDraft.value = 'Preserve this draft';
  const form = createdNodes.filter(node => node.tag === 'form').at(-1);
  await form.onsubmit({ isTrusted: true, preventDefault() {} }); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(createdNodes.filter(node => node.tag === 'input' && node.maxLength === 300).at(-1).value, 'Edited deterministic ranking');
  assert.equal(createdNodes.filter(node => node.tag === 'textarea').at(-1).value, 'Preserve this draft');
  assert.deepEqual(createdNodes.filter(node => node.className.includes('time-value') && !node.className.includes('inline-time-value')).slice(-4).map(node => node.value), ['08', '00', '00', '03'],
    'a conflict rerender preserves the complete typed and scrolled draft');
  const retryForm = createdNodes.filter(node => node.tag === 'form').at(-1);
  await retryForm.onsubmit({ isTrusted: true, preventDefault() {} }); await new Promise(resolve => setTimeout(resolve, 0));
  const editMessage = messages.findLast(message => message.type === 'EDIT_ENTRY');
  assert.equal(editMessage.payload.edits.startedAt, entry.startedAt, 'unchanged Start keeps its original wall time, seconds, milliseconds, and offset');
  assert.equal(editMessage.payload.edits.endedAt, '2026-08-19T00:03:27.123-07:00');
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
  assert.deepEqual(taskLinks.map(node => node.textContent), ['app#7 · Issue 7', 'app#8 · Issue 8', 'app#7 · Issue 7'],
    'the same task receives a new header after a different task interrupts the sequence');
  assert.equal(createdNodes.filter(node => node.className.includes('entry-record')).slice(-4).length, 4,
    'each record retains a separate time-detail row');
  assert.equal(createdNodes.filter(node => node.className.includes('entry-meta')).slice(-4).length, 4);
  assert.equal(createdNodes.filter(node => node.className.includes('entry-edit')).slice(-4).length, 4,
    'each time record remains independently editable');
  assert.equal(createdNodes.filter(node => node.className.includes('entry-delete')).slice(-4).length, 4,
    'each time record remains independently deletable');
});

test('main-panel times are directly scrollable, relative-day labeled, and overlapping records are highlighted', async () => {
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
      else if (message.type === 'EDIT_ENTRY') {
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

  const firstStopMinute = inlineValues[3];
  document.activeElement = new FakeNode('div');
  firstStopMinute.getRootNode = () => ({ activeElement: firstStopMinute });
  let prevented = false;
  firstStopMinute.onwheel({ deltaY: -1, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(firstStopMinute.value, '05');
  const save = createdNodes.filter(node => node.className.includes('inline-save')).at(-4);
  assert.equal(save.hidden, false, 'scrolling a main-panel value reveals an explicit Save action');
  await save.onclick({ isTrusted: true }); await new Promise(resolve => setTimeout(resolve, 0));
  const edit = messages.findLast(message => message.type === 'EDIT_ENTRY');
  assert.equal(edit.payload.index, 1);
  assert.equal(edit.payload.originalSha, 'same');
  assert.equal(edit.payload.edits.endedAt, '2026-08-21T16:05:00+00:00');
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
    schemaVersion: 1, id, user: 'alice', issue: { type: 'issue', owner: 'acme', repo: 'app', number, url: `https://github.com/acme/app/issues/${number}` },
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
    issueUrl: newer.issue.url, issueTitle: newer.issueTitle, startedAt: newer.startedAt, endedAt: newer.endedAt, description: '',
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

test('split header navigation works on a non-issue GitHub page without loading tracker entries', async () => {
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
  assert.equal(actions.children.at(-2)?.id, 'repoclock-root');
  assert.equal(actions.children.at(-1), avatarSlot);
  const main = createdNodes.findLast(node => node.tag === 'button' && node.className.includes('trigger-main'));
  const arrow = createdNodes.findLast(node => node.tag === 'button' && node.className.includes('trigger-menu'));
  assert.ok(main?.onclick); assert.ok(arrow?.onclick);
  assert.equal(main.getAttribute('aria-haspopup'), 'menu');
  assert.equal(arrow.getAttribute('aria-haspopup'), 'menu');
  await arrow.onclick({ isTrusted: true });
  const tasks = createdNodes.findLast(node => node.tag === 'button' && node.textContent === 'Tasks');
  assert.ok(tasks?.onclick);
  await tasks.onclick({ isTrusted: true });
  assert.deepEqual(messages.findLast(message => message.type === 'OPEN_TASKS'), { type: 'OPEN_TASKS' });
  assert.equal(messages.some(message => message.type === 'LOAD_RECENT'), false);
  await main.onclick({ isTrusted: true });
  assert.ok(createdNodes.findLast(node => node.tag === 'button' && node.textContent === 'Reports'));
});

test('split main segment resolves non-issue to issue SPA navigation at activation time', async () => {
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
  assert.ok(createdNodes.findLast(node => node.tag === 'button' && node.textContent === 'Start timer on task #7'));
});

test('split main segment resolves issue to non-issue SPA navigation at activation time', async () => {
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
  assert.equal(messages.some(message => message.type === 'LOAD_RECENT'), false);
  assert.ok(createdNodes.findLast(node => node.tag === 'button' && node.textContent === 'Tasks'));
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
  assert.equal(actions.children.at(-2)?.id, 'repoclock-root');
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
  const start = createdNodes.filter(node => node.tag === 'button' && node.textContent === 'Start timer on task #7').at(-1);
  await start.onclick({ isTrusted: true }); await new Promise(resolve => setTimeout(resolve, 0));
  const retry = createdNodes.filter(node => node.tag === 'button' && node.textContent === 'Retry').at(-1);
  assert.ok(retry?.onclick, 'transient error exposes Retry');
  const before = loadCalls;
  await retry.onclick({ isTrusted: true }); await new Promise(resolve => setTimeout(resolve, 0));
  assert.ok(loadCalls > before, 'Retry performs a safe tracker refresh');
  assert.equal(messages.some(message => message.type === 'OPEN_OPTIONS'), false);
});
