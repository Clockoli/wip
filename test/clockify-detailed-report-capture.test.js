import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { normalizeClockifyDetailedReport } from '../src/addons/clockify/report-normalizer.js';

const scriptUrl = new URL('../src/addons/clockify/detailed-report-capture.js', import.meta.url);
const ARM_EVENT = 'clockoli:clockify-detailed-report-arm';
const CAPTURE_MESSAGE = 'clockoli:clockify-detailed-report-captured';
const CSV_CAPTURE_MESSAGE = 'clockoli:clockify-detailed-report-csv-captured';
const CSV_CAPTURE_INTENT_EVENT = 'clockoli:clockify-detailed-report-csv-capture-intent';
const PROGRESS_EVENT = 'clockoli:clockify-detailed-report-progress';
const YEAR_REQUEST_EVENT = 'clockoli:clockify-detailed-report-request-year';

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
  let fetchResponse = async url => new Response(url, JSON.stringify(report));
  let performanceNow = 0;
  let performanceEntries = [{ startTime: 1 }];
  const documentElement = {
    attributes: new Map(),
    getAttribute(name) { return this.attributes.get(name) || null; },
    hasAttribute(name) { return this.attributes.has(name); },
    setAttribute(name, value) { this.attributes.set(name, value); },
  };
  const window = {
    documentElement,
    addEventListener(type, listener) { listeners.set(type, listener); },
    dispatchEvent(event) { events.push(event); return true; },
    postMessage(data) { events.push({ type: data.type, detail: data.entryCount ?? data.text ?? data.code, year: data.year }); return true; },
  };
  class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } }
  class XMLHttpRequest {
    constructor() { this._responseText = ''; }
    get responseText() { return this._responseText; }
    set responseText(value) { this._responseText = value; }
    get response() { return this._response; }
    set response(value) { this._response = value; }
    addEventListener(type, listener) { this.listeners ??= new Map(); this.listeners.set(type, listener); }
    open(method, url) { this.responseURL = url; }
    send() { this.sent = true; }
    finish(text, status = 200) { this.status = status; this.responseText = text; this.listeners?.get('loadend')?.call(this); }
  }
  class Response {
    constructor(url, text, blob = null) { this.ok = true; this.url = url; this.textValue = text; this.blobValue = blob; }
    clone() { return new Response(this.url, this.textValue, this.blobValue); }
    text() { return Promise.resolve(this.textValue); }
    json() { return Promise.resolve(JSON.parse(this.textValue)); }
    blob() { return Promise.resolve(this.blobValue); }
  }
  class ClockifyUrl extends URL {}
  let blobSequence = 0;
  ClockifyUrl.createObjectURL = () => `blob:clockify-test-${++blobSequence}`;
  class EventTarget {
    dispatchEvent(event) { this.dispatchedEvents = [...(this.dispatchedEvents || []), event]; return !event.defaultPrevented; }
  }
  class HTMLAnchorElement extends EventTarget {
    constructor(href) { super(); this.href = href; this.tagName = 'A'; this.clicks = 0; }
    click() { this.clicks += 1; }
  }
  const openedUrls = [];
  const open = url => { openedUrls.push(url); return { url }; };
  const location = { href: 'https://app.clockify.me/reports/detailed?start=2026-01-01T00:00:00.000Z&end=2026-12-31T23:59:59.999Z&page=1&pageSize=200' };
  const history = {
    pushState(_state, _title, url) { location.href = new URL(url, location.href).href; },
  };
  class PopStateEvent { constructor(type, init = {}) { this.type = type; this.state = init.state; } }
  const context = vm.createContext({
    window, document: window, CustomEvent, XMLHttpRequest, Response, URL: ClockifyUrl, EventTarget, HTMLAnchorElement, open, TextEncoder, JSON, Object, Array, String, Number, Boolean,
    location, history, PopStateEvent,
    performance: { now: () => performanceNow, getEntriesByName: () => performanceEntries },
    fetch: (...args) => fetchResponse(...args),
  });
  vm.runInContext(source, context, { filename: 'detailed-report-capture.js' });
  const ready = () => listeners.get('clockoli:clockify-detailed-report-receiver-ready')({});
  return {
    context, events, arm: () => { listeners.get(ARM_EVENT)({}); ready(); }, armDiscover: (year = 2026) => { listeners.get(ARM_EVENT)({ detail: { mode: 'discover', year } }); ready(); }, armReport: (year = 2026) => { listeners.get(ARM_EVENT)({ detail: { mode: 'report', year } }); ready(); }, armCsv: () => { listeners.get(ARM_EVENT)({ detail: { mode: 'csv' } }); ready(); }, armWithoutReceiver: () => listeners.get(ARM_EVENT)({}),
    ready, requestYear: (year, mode = 'discover') => listeners.get(YEAR_REQUEST_EVENT)({ detail: { year, mode } }), requestCsvCapture: () => listeners.get(CSV_CAPTURE_INTENT_EVENT)({}), dispatchClick: event => listeners.get('click')(event), setFetch: callback => { fetchResponse = callback; }, setPerformance: ({ now, entries }) => { performanceNow = now; performanceEntries = entries; }, XMLHttpRequest, HTMLAnchorElement, location, openedUrls,
  };
}

function captures(events) { return events.filter(event => event.type === CAPTURE_MESSAGE); }
function csvCaptures(events) { return events.filter(event => event.type === CSV_CAPTURE_MESSAGE); }
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
      taskId: 'task-1', taskName: 'Example task',
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

test('reports the source annual entry count when discovery is armed', async () => {
  const { context, events, armDiscover } = await loadBridge();
  const path = 'https://app.clockify.me/report/workspaces/workspace-1/reports/detailed?page=1';

  armDiscover();
  await context.fetch(path);
  await flushAsyncCapture();

  assert.deepEqual(events.filter(event => event.type === 'clockoli:clockify-detailed-report-year-observed'), [
    { type: 'clockoli:clockify-detailed-report-year-observed', detail: 1, year: 2026 },
  ]);
  assert.equal(captures(events).length, 0, 'discovery must not hand a report page to the import capture path');
});

test('discovery rejects a stale result and a result whose entries belong to another annual route', async () => {
  const { context, events, armDiscover, setFetch, setPerformance } = await loadBridge();
  const path = 'https://app.clockify.me/report/workspaces/workspace-1/async/reports/detailed/result-1';

  setPerformance({ now: 10, entries: [{ startTime: 9 }] });
  armDiscover(2026);
  await context.fetch(path);
  await flushAsyncCapture();
  assert.equal(events.some(event => event.type === 'clockoli:clockify-detailed-report-year-observed'), false);
  assert.ok(progress(events).includes('report_response_precedes_arm'));

  setPerformance({ now: 10, entries: [{ startTime: 11 }] });
  armDiscover(2025);
  setFetch(async url => new context.Response(url, JSON.stringify(report)));
  await context.fetch(path);
  await flushAsyncCapture();
  assert.equal(events.some(event => event.type === 'clockoli:clockify-detailed-report-year-observed'), false);
  assert.ok(progress(events).includes('report_task_mismatch'));
});

test('annual page capture rejects a report whose entries do not overlap the requested year', async () => {
  const { context, events, armReport, setFetch } = await loadBridge();
  const path = 'https://app.clockify.me/report/workspaces/workspace-1/reports/detailed?page=1';
  const stale = structuredClone(report);
  stale.timeentries[0].timeInterval.start = '2025-01-01T00:00:00Z';
  stale.timeentries[0].timeInterval.end = '2025-01-01T01:00:00Z';
  setFetch(async url => new context.Response(url, JSON.stringify(stale)));

  armReport(2026);
  await context.fetch(path);
  await flushAsyncCapture();

  assert.equal(captures(events).length, 0);
  assert.ok(progress(events).includes('report_year_mismatch'));
});

test('annual page capture ignores an earlier page response arriving after the next page is armed', async () => {
  const { events, armReport, setPerformance, XMLHttpRequest } = await loadBridge();
  const path = 'https://app.clockify.me/report/workspaces/workspace-1/reports/detailed';
  setPerformance({ now: 10, entries: [] });
  armReport(2026);
  const earlier = new XMLHttpRequest();
  earlier.open('GET', path);
  earlier.send();

  setPerformance({ now: 20, entries: [] });
  armReport(2026);
  earlier.finish(JSON.stringify(report));
  assert.equal(captures(events).length, 0, 'the late response must not replace page two');

  setPerformance({ now: 21, entries: [] });
  const next = new XMLHttpRequest();
  next.open('GET', path);
  next.send();
  next.finish(JSON.stringify(report));
  assert.equal(captures(events).length, 1);
});

test('annual page capture binds the result to the matching native pagination request', async () => {
  const { events, armReport, location, XMLHttpRequest } = await loadBridge();
  location.href = location.href.replace('page=1', 'page=2');
  armReport(2026);
  const creation = 'https://app.clockify.me/report/workspaces/workspace-1/async/reports/detailed';
  for (const [page, task] of [[1, 'old-task'], [2, 'current-task']]) {
    const request = new XMLHttpRequest();
    request.open('POST', creation);
    request.send(JSON.stringify({ dateRangeStart: '2026-01-01T00:00:00.000Z', dateRangeEnd: '2026-12-31T23:59:59.999Z', detailedFilter: { page, pageSize: 200 } }));
    request.finish(JSON.stringify({ reportTaskId: task }));
  }
  const old = new XMLHttpRequest();
  old.open('GET', `${creation}/old-task`);
  old.send();
  old.finish(JSON.stringify(report));
  assert.equal(captures(events).length, 0, 'a completed result for another page is not page two');

  const current = new XMLHttpRequest();
  current.open('GET', `${creation}/current-task`);
  current.send();
  current.finish(JSON.stringify(report));
  assert.equal(captures(events).length, 1);
});

test('discovers the armed annual result when Clockify does not expose its creation request to the bridge', async () => {
  const { context, events, armDiscover, setPerformance } = await loadBridge();
  const path = 'https://app.clockify.me/report/workspaces/workspace-1/async/reports/detailed/result-1';

  setPerformance({ now: 10, entries: [{ startTime: 11 }] });
  armDiscover(2026);
  await context.fetch(path);
  await flushAsyncCapture();

  assert.deepEqual(events.filter(event => event.type === 'clockoli:clockify-detailed-report-year-observed'), [
    { type: 'clockoli:clockify-detailed-report-year-observed', detail: 1, year: 2026 },
  ]);
});

test('accepts an annual report interval that overlaps an annual boundary', async () => {
  const { context, events, armDiscover } = await loadBridge();
  const path = 'https://app.clockify.me/report/workspaces/workspace-1/reports/detailed';
  const crossing = structuredClone(report);
  crossing.timeentries[0].timeInterval.end = '2027-01-01T05:24:13.000Z';

  armDiscover(2026);
  await context.fetch(path, { method: 'GET' });
  // The bridge reads its response from the test fetch fixture; use XHR for the crossing interval.
  const xhr = new context.XMLHttpRequest();
  xhr.open('GET', path);
  xhr.send();
  xhr.finish(JSON.stringify(crossing));

  assert.deepEqual(events.filter(event => event.type === 'clockoli:clockify-detailed-report-year-observed'), [
    { type: 'clockoli:clockify-detailed-report-year-observed', detail: 1, year: 2026 },
  ]);
});


test('discovery accepts only the result job created for its armed annual request', async () => {
  const { events, armDiscover, XMLHttpRequest } = await loadBridge();
  const createUrl = 'https://app.clockify.me/report/workspaces/workspace-1/async/reports/detailed';
  const resultUrl = taskId => `${createUrl}/${taskId}`;
  const requestBody = JSON.stringify({
    dateRangeStart: '2026-01-01T00:00:00.000Z',
    dateRangeEnd: '2026-12-31T23:59:59.999Z',
  });

  armDiscover(2026);
  const create = new XMLHttpRequest();
  create.open('POST', createUrl);
  create.send(requestBody);
  create.finish(JSON.stringify({ reportTaskId: 'year-2026' }), 202);

  const stale = new XMLHttpRequest();
  stale.open('GET', resultUrl('year-2025'));
  stale.send();
  stale.finish(JSON.stringify(report));
  assert.equal(events.some(event => event.type === 'clockoli:clockify-detailed-report-year-observed'), false);

  const expected = new XMLHttpRequest();
  expected.open('GET', resultUrl('year-2026'));
  expected.send();
  expected.finish(JSON.stringify(report));
  assert.deepEqual(events.filter(event => event.type === 'clockoli:clockify-detailed-report-year-observed'), [
    { type: 'clockoli:clockify-detailed-report-year-observed', detail: 1, year: 2026 },
  ]);
});

test('forwards a payload the privileged report normalizer accepts', async () => {
  const { context, events, arm } = await loadBridge();
  const path = 'https://app.clockify.me/report/workspaces/workspace-1/reports/detailed';

  arm();
  await context.fetch(path);
  await flushAsyncCapture();

  assert.doesNotThrow(() => normalizeClockifyDetailedReport(captures(events)[0].detail));
});

test('canonicalizes Clockify empty report variants without totals', async () => {
  const { context, events, arm, setFetch } = await loadBridge();
  const path = 'https://app.clockify.me/report/workspaces/workspace-1/reports/detailed';
  setFetch(async url => ({ ok: true, url, clone() { return this; }, text: async () => JSON.stringify({ timeentries: null, totals: null }) }));

  arm();
  await context.fetch(path);
  await flushAsyncCapture();

  assert.deepEqual(JSON.parse(captures(events)[0].detail), { timeentries: [], totals: [{ entriesCount: 0 }] });
  assert.doesNotThrow(() => normalizeClockifyDetailedReport(captures(events)[0].detail));
});

test('only wraps Clockify transport APIs while armed and restores them after one report page', async () => {
  const { context, arm } = await loadBridge();
  const path = 'https://app.clockify.me/report/workspaces/workspace-1/reports/detailed';
  const originalFetch = context.fetch;
  const originalOpen = context.XMLHttpRequest.prototype.open;
  const originalSend = context.XMLHttpRequest.prototype.send;

  arm();
  assert.notEqual(context.fetch, originalFetch);
  assert.notEqual(context.XMLHttpRequest.prototype.open, originalOpen);
  assert.notEqual(context.XMLHttpRequest.prototype.send, originalSend);
  await context.fetch(path);
  await flushAsyncCapture();
  assert.equal(context.fetch, originalFetch);
  assert.equal(context.XMLHttpRequest.prototype.open, originalOpen);
  assert.equal(context.XMLHttpRequest.prototype.send, originalSend);
});

test('captures an exact report consumed through a pre-arm saved fetch reference', async () => {
  const { context, events, arm } = await loadBridge();
  const savedFetch = context.fetch;
  const path = 'https://app.clockify.me/report/workspaces/workspace-1/async/reports/detailed/result-1';

  arm();
  const response = await savedFetch(path);
  await response.json();
  await flushAsyncCapture();

  assert.equal(captures(events).length, 1, 'Clockify may retain fetch before the bridge is armed');
});

test('observes a discovery XHR whose send method was retained before the bridge was armed', async () => {
  const { events, armDiscover, XMLHttpRequest } = await loadBridge();
  const savedSend = XMLHttpRequest.prototype.send;
  const createPath = 'https://app.clockify.me/report/workspaces/workspace-1/async/reports/detailed';
  const path = `${createPath}/result-1`;

  armDiscover(2026);
  const create = new XMLHttpRequest();
  create.open('POST', createPath);
  create.send(JSON.stringify({ dateRangeStart: '2026-01-01T00:00:00.000Z', dateRangeEnd: '2026-12-31T23:59:59.999Z' }));
  create.finish(JSON.stringify({ reportTaskId: 'result-1' }), 202);
  const xhr = new XMLHttpRequest();
  xhr.open('GET', path);
  savedSend.call(xhr);
  xhr.finish(JSON.stringify(report));

  assert.deepEqual(events.filter(event => event.type === 'clockoli:clockify-detailed-report-year-observed'), [
    { type: 'clockoli:clockify-detailed-report-year-observed', detail: 1, year: 2026 },
  ]);
});

test('observes discovery XHR responses whose open method was retained before the bridge armed', async () => {
  const { events, armDiscover, XMLHttpRequest } = await loadBridge();
  const savedOpen = XMLHttpRequest.prototype.open;
  const createPath = 'https://app.clockify.me/report/workspaces/workspace-1/async/reports/detailed';
  const path = `${createPath}/result-1`;

  armDiscover(2026);
  const create = new XMLHttpRequest();
  savedOpen.call(create, 'POST', createPath);
  create.status = 202;
  create.response = { reportTaskId: 'result-1' };
  void create.response;

  const xhr = new XMLHttpRequest();
  savedOpen.call(xhr, 'GET', path);
  xhr.status = 200;
  xhr.response = report;
  void xhr.response;
  await flushAsyncCapture();

  assert.deepEqual(events.filter(event => event.type === 'clockoli:clockify-detailed-report-year-observed'), [
    { type: 'clockoli:clockify-detailed-report-year-observed', detail: 1, year: 2026 },
  ]);
});

test('requests an annual report through Clockify\'s SPA route without reloading the document', async () => {
  const { events, context, location, requestYear } = await loadBridge();
  const documentBefore = context.document.documentElement;

  requestYear(2016);

  assert.equal(context.document.documentElement, documentBefore);
  const reportUrl = new URL(location.href);
  assert.equal(reportUrl.searchParams.get('start'), '2016-01-01T00:00:00.000Z');
  assert.equal(reportUrl.searchParams.get('end'), '2016-12-31T23:59:59.999Z');
  assert.equal(reportUrl.searchParams.get('pageSize'), '199');
  assert.ok(events.some(event => event.type === 'popstate'));
});

test('does not synthesize Clockify native date controls before routing to the annual report', async () => {
  const source = await readFile(scriptUrl, 'utf8');
  assert.doesNotMatch(source, /document\.execCommand\(/);
  assert.doesNotMatch(source, /button\.applyBtn/);
  assert.match(source, /history\.pushState\(\{\}, '', url\.href\)/);
});

test('forces a fresh same-year discovery report through Clockify\'s SPA route', async () => {
  const { events, context, location, requestYear } = await loadBridge();
  const documentBefore = context.document.documentElement;

  requestYear(2026);

  assert.equal(context.document.documentElement, documentBefore);
  const reportUrl = new URL(location.href);
  assert.equal(reportUrl.searchParams.get('start'), '2026-01-01T00:00:00.000Z');
  assert.equal(reportUrl.searchParams.get('end'), '2026-12-31T23:59:59.999Z');
  assert.equal(reportUrl.searchParams.get('page'), '1');
  assert.equal(reportUrl.searchParams.get('pageSize'), '199');
  assert.ok(events.some(event => event.type === 'popstate'));
});

test('switches from annual discovery to a distinct 200-row report route before page capture', async () => {
  const { location, requestYear } = await loadBridge();

  requestYear(2026, 'discover');
  assert.equal(new URL(location.href).searchParams.get('pageSize'), '199');

  requestYear(2026, 'report');
  assert.equal(new URL(location.href).searchParams.get('pageSize'), '200');
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

test('forwards each bounded sanitized report page for privileged checkpointing', async () => {
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
  assert.equal(captures(events).length, 1, 'a partial page must be durably checkpointed before navigation');
  assert.equal(JSON.parse(captures(events)[0].detail).timeentries.length, 1);

  arm();
  setFetch(async url => ({ ok: true, url, clone() { return this; }, text: async () => JSON.stringify(secondPage) }));
  await context.fetch(path);
  await flushAsyncCapture();
  assert.equal(captures(events).length, 2);
  assert.equal(JSON.parse(captures(events)[1].detail).timeentries.length, 1);
});

test('source has no sensitive API access or request-data identifiers and only constructs allowlisted output', async () => {
  const source = await readFile(scriptUrl, 'utf8');
  for (const forbidden of [
    /localStorage/, /sessionStorage/, /indexedDB/i, /document\.cookie/, /requestHeaders/i,
    /authorization/i, /credentials/i, /XMLHttpRequest\.prototype\.setRequestHeader/,
  ]) assert.doesNotMatch(source, forbidden);
  assert.match(source, /JSON\.parse\(body\)/);
  assert.match(source, /dateRangeStart/);
  assert.match(source, /dateRangeEnd/);
  assert.match(source, /reportTaskId/);
  assert.doesNotMatch(source, /fetch\s*\(/, 'the bridge must wrap, never initiate, fetches');
  assert.match(source, /MAX_BYTES\s*=\s*16\s*\*\s*1024\s*\*\s*1024/);
  assert.match(source, /CSV_HEADER_PREFIX\s*=\s*'"Project","Client","Description","Task","User",'/);
  assert.match(source, /request\.responseType === 'blob'\) \{\n      captureCsvBlob\(request\.response\);/);
  assert.doesNotMatch(source, /MAX_ENTRIES/);
  assert.match(source, /timeentries/);
  assert.match(source, /totals/);
});

test('leaves manually requested CSV downloads alone and suppresses only Clockoli-requested capture downloads', async () => {
  const { armCsv, requestCsvCapture, context, HTMLAnchorElement, openedUrls, dispatchClick } = await loadBridge();
  armCsv();
  const manualUrl = context.URL.createObjectURL({ type: 'application/octet-stream', text: async () => 'not a CSV' });
  const manualAnchor = new HTMLAnchorElement(manualUrl);
  manualAnchor.click();
  assert.equal(manualAnchor.clicks, 1, 'an ordinary Clockify Save as CSV action must remain a browser download');
  assert.deepEqual(context.open(manualUrl), { url: manualUrl });

  requestCsvCapture();
  const objectUrl = context.URL.createObjectURL({ type: 'application/octet-stream', text: async () => 'not a CSV' });
  const anchor = new HTMLAnchorElement(objectUrl);

  anchor.click();
  assert.equal(anchor.clicks, 0, 'the native click must not open a download or new window');
  const dispatched = anchor.dispatchEvent({ type: 'click', cancelable: true, preventDefault() { this.defaultPrevented = true; } });
  assert.equal(dispatched, false, 'a synthetic anchor dispatch must not reach the browser download handler');
  assert.equal(anchor.dispatchedEvents, undefined);
  assert.equal(context.open(objectUrl), null, 'Clockify can open a Blob URL without using an anchor download attribute');
  assert.deepEqual(openedUrls, [manualUrl]);

  const event = {
    cancelable: true,
    composedPath: () => [anchor],
    preventDefault() { this.defaultPrevented = true; },
    stopImmediatePropagation() { this.propagationStopped = true; },
  };
  dispatchClick(event);
  assert.equal(event.defaultPrevented, true, 'a synthetic native click must not reach the browser download handler');
  assert.equal(event.propagationStopped, true);

  const source = await readFile(scriptUrl, 'utf8');
  assert.match(source, /CSV_CAPTURE_INTENT_EVENT/);
  assert.match(source, /if \(armed && captureMode === 'csv' && csvCaptureRequested && typeof url === 'string'\) csvObjectUrls\.add\(url\);/);
  assert.match(source, /function clockoliAnchorClick\(\.\.\.args\) \{\n    if \(armed && captureMode === 'csv' && csvCaptureRequested && csvObjectUrls\.has\(this\?\.href\)\) return;/);
  assert.match(source, /function clockoliWindowOpen\(url, \.\.\.args\) \{\n    if \(armed && captureMode === 'csv' && csvCaptureRequested && csvObjectUrls\.has\(url\)\) return null;/);
  assert.match(source, /EVENT_TARGET\.addEventListener\('click', suppressCsvNavigation, true\);/);
});

test('captures a Clockoli-requested native Fetch CSV response through Response.blob before object-URL navigation', async () => {
  const { armCsv, requestCsvCapture, context, events, setFetch } = await loadBridge();
  const path = 'https://app.clockify.me/report/workspaces/workspace-1/async/reports/detailed/result-1';
  const csv = '"Project","Client","Description","Task","User",\n"Example","","Work","","Person",\n';
  const blob = { size: csv.length, text: async () => csv };
  setFetch(async url => new context.Response(url, '', blob));
  const savedFetch = context.fetch;

  armCsv();
  requestCsvCapture();
  const response = await savedFetch(path);
  assert.equal(await response.blob(), blob, 'the native page still receives its original CSV Blob');
  await flushAsyncCapture();

  assert.deepEqual(csvCaptures(events).map(event => event.detail), [csv]);
  assert.equal(captures(events).length, 0, 'CSV capture must not enter the JSON report path');
});

test('captures a Clockoli-requested native XHR Blob CSV response without reading response text', async () => {
  const { armCsv, requestCsvCapture, events, XMLHttpRequest } = await loadBridge();
  const path = 'https://app.clockify.me/report/workspaces/workspace-1/async/reports/detailed/result-1';
  const csv = '"Project","Client","Description","Task","User",\n"Example","","Work","","Person",\n';
  const xhr = new XMLHttpRequest();

  armCsv();
  requestCsvCapture();
  xhr.open('GET', path);
  xhr.responseType = 'blob';
  xhr.response = { size: csv.length, text: async () => csv };
  xhr.send();
  xhr.finish('not read as CSV text');
  await flushAsyncCapture();

  assert.deepEqual(csvCaptures(events).map(event => event.detail), [csv]);
});
