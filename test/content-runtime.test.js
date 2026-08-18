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
  }
  append(...nodes) {
    for (const node of nodes) {
      if (node && typeof node === 'object') {
        node.isConnected = true;
        if (node.id) documentNodes.set(node.id, node);
      }
    }
  }
  replaceChildren() {}
  remove() { this.isConnected = false; if (this.id) documentNodes.delete(this.id); }
  addEventListener(type, listener) { this[`on${type}`] = listener; }
  attachShadow({ mode }) {
    const shadow = new FakeNode('shadow');
    if (mode === 'open') this.shadowRoot = shadow;
    return shadow;
  }
}

const documentNodes = new Map();

test('query/hash churn cannot trigger authenticated GitHub refreshes', async () => {
  const intervals = [];
  const messages = [];
  const location = {
    protocol: 'https:', hostname: 'github.com', pathname: '/acme/app/issues/1', href: 'https://github.com/acme/app/issues/1',
  };
  const document = {
    documentElement: new FakeNode('html'),
    createElement: tag => new FakeNode(tag),
    createTextNode: text => ({ textContent: text }),
    getElementById: id => documentNodes.get(id) ?? null,
    querySelector: () => null,
  };
  document.documentElement.append = node => {
    node.isConnected = true;
    if (node.id) documentNodes.set(node.id, node);
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
  const start = createdNodes.filter(node => node.tag === 'button' && node.textContent === '▶ Start timer').at(-1);
  assert.ok(start?.onclick, 'Start handler was rendered on the pull request');
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
  const document = {
    documentElement: new FakeNode('html'),
    createElement: tag => new FakeNode(tag),
    createTextNode: text => ({ textContent: text }),
    getElementById: id => documentNodes.get(id) ?? null,
    querySelector: () => null,
  };
  document.documentElement.append = node => {
    node.isConnected = true;
    if (node.id) documentNodes.set(node.id, node);
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
  const stop = createdNodes.find(node => node.tag === 'button' && node.textContent === '■ Stop');
  assert.ok(stop?.onclick, 'Stop handler was rendered');
  await stop.onclick({ isTrusted: true });
  await new Promise(resolve => setTimeout(resolve, 0));
  const pageStateMessages = messages.filter(message => message.type === 'GET_PAGE_STATE');
  assert.equal(pageStateMessages.length, 2);
  assert.equal(pageStateMessages[1].refresh, false);
});
