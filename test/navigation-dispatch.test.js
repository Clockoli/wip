import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { assertMessageAllowed } from '../src/background/message-policy.js';

const worker = await readFile(new URL('../src/background/service-worker.js', import.meta.url), 'utf8');
const origin = 'chrome-extension://clockoli/';
const contentSender = { url: 'https://github.com/Clockoli/clockoli/pull/10', tab: { id: 1 } };

function makeDispatcher() {
  const calls = [], responses = new Map();
  let releaseQueue;
  const blocked = new Promise(resolve => { releaseQueue = resolve; });
  const chrome = {
    runtime: {
      getURL: path => `${origin}${path}`,
      openOptionsPage: async () => { calls.push('settings'); },
      onMessage: { addListener: callback => { chrome.dispatch = callback; } },
    },
    tabs: { create: async ({ url }) => { calls.push(url); } },
  };
  const context = vm.createContext({
    chrome, assertMessageAllowed,
    executor: { run: async operation => { await blocked; return operation(); } },
    acceptanceExecutor: { run: operation => operation() },
    withCurrentRepositoryRecovery: (_message, operation) => operation(),
    DIRECT_DEVICE_FLOW_MESSAGES: new Set(),
    openTimesPage: async () => { calls.push('activity'); },
    serializeError: error => ({ message: error.message }),
  });
  vm.runInContext(worker.slice(worker.indexOf('async function handle('), worker.indexOf('let pendingSync = null;')), context);
  const send = (request, sender = contentSender) => new Promise(resolve => {
    const message = typeof request === 'string' ? { type: request } : request;
    chrome.dispatch(message, sender, response => { responses.set(message.type, response); resolve(response); });
  });
  return { send, calls, responses, releaseQueue };
}

test('tab navigation opens while a serial data operation is still blocked', async () => {
  const { send, calls, responses, releaseQueue } = makeDispatcher();
  const pendingData = send({ type: 'GET_PAGE_STATE', refresh: true });
  const navigationPromise = Promise.all(['OPEN_OPTIONS', 'OPEN_REPORTS', 'OPEN_TASKS', 'OPEN_TIMES'].map(type => send(type)));
  let navigation;
  try {
    navigation = await Promise.race([
      navigationPromise,
      new Promise(resolve => setTimeout(() => resolve('blocked'), 100)),
    ]);
    assert.notEqual(navigation, 'blocked', 'tab navigation waited for the serial data queue');
  } finally {
    releaseQueue();
  }
  assert.deepEqual(navigation.map(result => result.ok), [true, true, true, true]);
  assert.deepEqual(calls, [
    'settings',
    `${origin}src/reports/reports.html`,
    `${origin}src/tasks/tasks.html`,
    'activity',
  ]);
  assert.equal(responses.has('GET_PAGE_STATE'), false);
  await pendingData;
});

test('fast tab navigation still rejects an untrusted sender before opening a tab', async () => {
  const { send, calls } = makeDispatcher();
  for (const type of ['OPEN_OPTIONS', 'OPEN_REPORTS', 'OPEN_TASKS', 'OPEN_TIMES']) {
    const result = await send(type, { url: 'https://app.clockify.me/reports/detailed', tab: { id: 2 } });
    assert.equal(result.ok, false);
    assert.match(result.error.message, /not allowed from this sender/);
  }
  assert.deepEqual(calls, []);
});
