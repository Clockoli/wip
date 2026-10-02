import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const buttonSource = await readFile(new URL('../src/addons/clockify/detailed-report-button.js', import.meta.url), 'utf8');
const bridgeSource = await readFile(new URL('../src/addons/clockify/detailed-report-capture.js', import.meta.url), 'utf8');

function functionBlock(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `missing function: ${start}`);
  return source.slice(from, to);
}

test('CSV retry requests a different route for the same annual range without changing capture mode', () => {
  const calls = [];
  const url = 'https://app.clockify.me/reports/detailed?start=2026-01-01T00:00:00.000Z&end=2026-12-31T23:59:59.999Z&page=1&pageSize=199';
  const context = vm.createContext({
    EVENT_TARGET: { dispatchEvent: event => calls.push(event.detail) },
    YEAR_REQUEST_EVENT: 'request-year', CustomEvent: class { constructor(_, options) { this.detail = options.detail; } },
    armBridge: () => {},
    location: { href: url }, URL,
    history: { pushState: (_, __, next) => { context.location.href = next; } },
    window: { dispatchEvent: () => {} }, PopStateEvent: class {},
  });
  vm.runInContext(functionBlock(buttonSource, '  function requestReportYear(year, mode', '  function labelOf('), context);
  vm.runInContext(functionBlock(bridgeSource, '  function requestReportYear(event)', '  EVENT_TARGET.addEventListener(ARM_EVENT')
    .replace('function requestReportYear(event)', 'function requestBridgeReportYear(event)'), context);
  context.requestReportYear(2026, 'csv', 1);
  context.requestBridgeReportYear({ detail: calls.pop() });
  let route = new URL(context.location.href);
  assert.equal(route.searchParams.get('pageSize'), '200');
  assert.equal(route.searchParams.get('start'), '2026-01-01T00:00:00.000Z');
  assert.equal(route.searchParams.get('end'), '2026-12-31T23:59:59.999Z');
  context.requestReportYear(2026, 'csv', 2);
  context.requestBridgeReportYear({ detail: calls.pop() });
  route = new URL(context.location.href);
  assert.equal(route.searchParams.get('pageSize'), '199');
});

test('a refreshed annual report signals CSV readiness but is never forwarded as a page capture', () => {
  const progress = [];
  let captured = 0;
  const context = vm.createContext({
    armed: true, captureMode: 'csv', expectedYear: 2026, armedAt: 1, csvRetryAwaitingReport: true,
    reportEndpoint: () => true, reportTaskId: () => null, reportStartedAfterArm: () => true,
    sanitizeText: () => ({ output: { timeentries: [], totals: [] } }),
    reportMatchesExpectedYear: () => true,
    progress: code => progress.push(code), captureText: () => { captured += 1; },
  });
  vm.runInContext(functionBlock(bridgeSource, '  function observeResponse(url, text,', '  function observeResponseBody('), context);
  context.observeResponse('https://app.clockify.me/report/workspaces/w/reports/detailed', '{}', 2);
  assert.equal(captured, 0);
  assert.ok(progress.includes('csv_report_ready'));
});

test('email-only CSV path records offers in the background, stops on the third, and names the page-by-page fallback', () => {
  assert.match(buttonSource, /CLOCKIFY_CSV_EMAIL_OFFER/);
  assert.match(buttonSource, /requestYearCsv\(button, year, attempts\)/);
  assert.match(buttonSource, /CSV_EMAIL_EXPORT_UNAVAILABLE/);
  assert.match(buttonSource, /Page to page migration/);
  assert.doesNotMatch(buttonSource, /csvEmailExportAttempts/);
});

test('three email-only screens cause two same-year report re-requests, then cancel without a fourth export', () => {
  const queue = [];
  const requests = [];
  const statuses = [];
  let exports = 0;
  let offers = 0;
  let closes = 0;
  let disarms = 0;
  let menuOpen = false;
  const button = {};
  const body = { innerText: '' };
  const csv = { click() { exports += 1; body.innerText = 'The report will be sent to your email'; } };
  const context = vm.createContext({
    armedButton: button, armRequest: 1, csvExportRequest: 0, csvExportYear: null, csvRetryWait: null,
    captureParsingProgress: null, capturePhase: null,
    CAPTURE_PARSING_MESSAGE: 'Parsing Clockify data.', CSV_CAPTURE_INTENT_EVENT: 'capture-csv',
    EVENT_TARGET: { dispatchEvent() {} }, CustomEvent: class {},
    document: { body, querySelectorAll: () => menuOpen ? [csv] : [] },
    chrome: { runtime: { lastError: null, sendMessage(message, reply) {
      assert.deepEqual(JSON.parse(JSON.stringify(message)), { type: 'CLOCKIFY_CSV_EMAIL_OFFER' });
      offers += 1;
      reply({ ok: true, data: { attempts: offers, cancelled: offers === 3 } });
    } } },
    setTimeout: callback => { queue.push(callback); },
    findNativeExport: () => ({ click() { menuOpen = true; } }),
    enabled: () => true,
    labelOf: () => 'SAVE AS CSV',
    pageControl: () => ({ click() { closes += 1; body.innerText = ''; menuOpen = false; } }),
    setCaptureState: (_, armed, text) => { statuses.push({ armed, text }); if (!armed) context.armedButton = null; },
    disarmBridge: () => { disarms += 1; context.armRequest += 1; },
    requestReportYear: (...args) => {
      requests.push(args);
      if (args[2]) queue.push(() => context.retryCsvReportReady());
    },
  });
  vm.runInContext(functionBlock(buttonSource, '  function exportCurrentYearCsv(', '  function requestYearPages('), context);
  context.requestYearCsv(button, 2026);
  for (let tick = 0; queue.length && tick < 20; tick += 1) queue.shift()();
  assert.deepEqual(JSON.parse(JSON.stringify(requests)), [[2026, 'csv', 0], [2026, 'csv', 1], [2026, 'csv', 2]]);
  assert.equal(exports, 3);
  assert.equal(offers, 3);
  assert.equal(closes, 3);
  assert.equal(disarms, 1);
  assert.match(statuses.at(-1).text, /CSV migration cancelled.*Page to page migration/);
  assert.equal(queue.length, 0);
});
