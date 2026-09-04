import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const scriptUrl = new URL('../src/addons/clockify/detailed-report-capture.js', import.meta.url);
const ARM_EVENT = 'clockoli:clockify-detailed-report-arm';
const CAPTURE_PAYLOAD_EVENT = 'capture_payload';
const PROGRESS_EVENT = 'clockoli:clockify-detailed-report-progress';

const report = {
  timeentries: [{
    _id: 'entry-1', userId: 'person-1', userName: 'Example Person', userEmail: 'person@example.test',
    description: 'Example work', billable: true, projectId: 'project-1', projectName: 'Example project',
    taskId: 'task-1', taskName: 'Example task', tagIds: ['tag-1'],
    tags: [{ _id: 'tag-1', name: 'Example tag', ignored: 'never copied' }],
    timeInterval: { start: '2026-01-01T00:00:00Z', end: '2026-01-01T01:00:00Z', duration: 3600, timeZone: 'UTC', privateValue: 'never copied' },
    ignored: 'never copied',
  }],
  totals: [{ entriesCount: 1, totalTime: 3600, amounts: [], ignored: 'never copied' }],
  ignored: 'never copied',
};

async function loadBridge() {
  const source = await readFile(scriptUrl, 'utf8');
  const events = [];
  const listeners = new Map();
  let fetchResponse = async url => ({ ok: true, url, clone() { return this; }, text: async () => JSON.stringify(report) });
  const documentElement = {
    attributes: new Map(),
    getAttribute(name) { return this.attributes.get(name) || null; },
    hasAttribute(name) { return this.attributes.has(name); },
    setAttribute(name, value) { this.attributes.set(name, value); events.push({ type: CAPTURE_PAYLOAD_EVENT, detail: value }); },
  };
  const window = {
    documentElement,
    addEventListener(type, listener) { listeners.set(type, listener); },
    dispatchEvent(event) { events.push(event); return true; },
    postMessage(data) { events.push({ type: data.type, detail: data.text || data.code }); return true; },
  };
  class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } }
  class XMLHttpRequest {
    addEventListener(type, listener) { this.listeners ??= new Map(); this.listeners.set(type, listener); }
    open(method, url) { this.responseURL = url; }
    send() { this.sent = true; }
    finish(text, status = 200) { this.status = status; this.responseText = text; this.listeners?.get('loadend')?.call(this); }
  }
  const context = vm.createContext({
    window, document: window, CustomEvent, XMLHttpRequest, URL, TextEncoder, JSON, Object, Array, String, Number, Boolean,
    location: { href: 'https://app.clockify.me/reports/detailed' },
    fetch: (...args) => fetchResponse(...args),
  });
  vm.runInContext(source, context, { filename: 'detailed-report-capture.js' });
  const ready = () => listeners.get('clockoli:clockify-detailed-report-receiver-ready')({});
  return {
    context, events, arm: () => { listeners.get(ARM_EVENT)({}); ready(); }, armWithoutReceiver: () => listeners.get(ARM_EVENT)({}),
    ready, setFetch: callback => { fetchResponse = callback; }, XMLHttpRequest,
  };
}

function captures(events) { return events.filter(event => event.type === CAPTURE_PAYLOAD_EVENT); }
function progress(events) { return events.filter(event => event.type === PROGRESS_EVENT).map(event => event.detail); }
const flushAsyncCapture = () => new Promise(resolve => setImmediate(resolve));

test('captures only an armed completed exact Detailed Report endpoint and disarms after one result', async () => {
  const { context, events, arm, XMLHttpRequest } = await loadBridge();
  const path = 'https://app.clockify.me/report/workspaces/workspace-1/reports/detailed';

  await context.fetch(path);
  assert.equal(captures(events).length, 0, 'nothing is observed before an isolated-world arm gesture');

  arm();
  await context.fetch(`${path}?page=1`);
  await flushAsyncCapture();
  assert.equal(captures(events).length, 1);
  assert.deepEqual(progress(events).slice(0, 3), ['bridge_armed', 'report_response_observed', 'captured_sanitized']);
  assert.equal(typeof captures(events)[0].detail, 'string');
  const captured = JSON.parse(captures(events)[0].detail);
  assert.deepEqual(captured, {
    timeentries: [{
      _id: 'entry-1', userId: 'person-1', userName: 'Example Person', userEmail: 'person@example.test',
      description: 'Example work', billable: true, projectId: 'project-1', projectName: 'Example project',
      taskId: 'task-1', taskName: 'Example task', tagIds: ['tag-1'],
      tags: [{ _id: 'tag-1', name: 'Example tag' }],
      timeInterval: { start: '2026-01-01T00:00:00Z', end: '2026-01-01T01:00:00Z', duration: 3600, timeZone: 'UTC' },
    }],
    totals: [{ entriesCount: 1, totalTime: 3600, amounts: [] }],
  });

  await context.fetch(path);
  assert.equal(captures(events).length, 1, 'a successful capture disarms the bridge');

  arm();
  const xhr = new XMLHttpRequest();
  xhr.open('GET', 'https://app.clockify.me/report/workspaces/workspace-1/async/reports/detailed/result-1');
  xhr.send();
  xhr.finish(JSON.stringify(report));
  assert.equal(captures(events).length, 2, 'the completed async-result endpoint is also allowlisted');
});

test('holds a sanitized capture in memory until the isolated receiver is ready', async () => {
  const { context, events, armWithoutReceiver, ready } = await loadBridge();
  const path = 'https://app.clockify.me/report/workspaces/workspace-1/reports/detailed';

  armWithoutReceiver();
  await context.fetch(path);
  await flushAsyncCapture();
  assert.equal(captures(events).length, 0, 'the bridge must not dispatch before the receiver is installed');
  ready();
  assert.equal(captures(events).length, 1, 'the completed sanitized payload is forwarded once the receiver is ready');
});

test('rejects non-report endpoints, async task-id-only bodies, malformed data, and oversized source/results', async () => {
  const { context, events, arm, XMLHttpRequest } = await loadBridge();
  const taskId = 'https://app.clockify.me/report/workspaces/workspace-1/async/reports/detailed';
  const invalidPaths = [
    'https://app.clockify.me/report/workspaces//reports/detailed',
    'https://app.clockify.me/report/workspaces/workspace-1/reports/detailed/extra',
    'https://app.clockify.me/report/workspaces/workspace-1/reports/summary',
  ];
  for (const path of invalidPaths) { arm(); await context.fetch(path); }
  assert.equal(captures(events).length, 0);

  arm();
  await context.fetch(taskId);
  assert.equal(captures(events).length, 0, 'async-start task identifiers are not report results');

  const completed = 'https://app.clockify.me/report/workspaces/workspace-1/reports/detailed';
  arm();
  const malformed = new XMLHttpRequest();
  malformed.open('GET', completed);
  malformed.send();
  malformed.finish('{not JSON');
  assert.equal(captures(events).length, 0, 'malformed response text is rejected without dispatch');
  assert.ok(progress(events).includes('response_not_json'));

  arm();
  const oversized = new XMLHttpRequest();
  oversized.open('GET', completed);
  oversized.send();
  oversized.finish(' '.repeat((16 * 1024 * 1024) + 1));
  assert.equal(captures(events).length, 0, 'source text over 16 MiB is not serialized');
});

test('does not report an unrelated failed request as a Clockify report failure', async () => {
  const { context, events, arm, setFetch } = await loadBridge();
  arm();
  setFetch(async () => { throw new Error('unrelated request failure'); });

  await assert.rejects(context.fetch('https://app.clockify.me/api/unrelated'));
  assert.equal(progress(events).includes('report_request_failed'), false);
});

test('aggregates allowlisted report pages until their total reports a complete bounded result', async () => {
  const { context, events, arm, setFetch } = await loadBridge();
  const path = 'https://app.clockify.me/report/workspaces/workspace-1/reports/detailed';
  const secondEntry = {
    ...report.timeentries[0], _id: 'entry-2',
    timeInterval: { ...report.timeentries[0].timeInterval, start: '2026-01-01T01:00:00Z', end: '2026-01-01T02:00:00Z' },
  };
  const firstPage = { ...report, totals: [{ ...report.totals[0], entriesCount: 2 }] };
  const secondPage = { timeentries: [secondEntry], totals: [{ ...report.totals[0], entriesCount: 2 }] };

  arm();
  setFetch(async url => ({ ok: true, url, clone() { return this; }, text: async () => JSON.stringify(firstPage) }));
  await context.fetch(path);
  await flushAsyncCapture();
  assert.equal(captures(events).length, 0, 'a partial page must not open an import preview');
  assert.ok(progress(events).includes('page_captured'));

  setFetch(async url => ({ ok: true, url, clone() { return this; }, text: async () => JSON.stringify(secondPage) }));
  await context.fetch(path);
  await flushAsyncCapture();
  assert.equal(captures(events).length, 1);
  assert.equal(JSON.parse(captures(events)[0].detail).timeentries.length, 2);
});

test('source has no sensitive API access or request-data identifiers and only constructs allowlisted output', async () => {
  const source = await readFile(scriptUrl, 'utf8');
  for (const forbidden of [
    /localStorage/, /sessionStorage/, /indexedDB/i, /document\.cookie/, /requestHeaders/i,
    /authorization/i, /credentials/i, /\.body\b/, /reportTaskId/i, /XMLHttpRequest\.prototype\.setRequestHeader/,
  ]) assert.doesNotMatch(source, forbidden);
  assert.doesNotMatch(source, /fetch\s*\(/, 'the bridge must wrap, never initiate, fetches');
  assert.match(source, /MAX_BYTES\s*=\s*16\s*\*\s*1024\s*\*\s*1024/);
  assert.match(source, /timeentries/);
  assert.match(source, /totals/);
});
