import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as reporting from '../src/domain/reporting.js';
import * as billing from '../src/domain/local-settings.js';
import * as invoicing from '../src/domain/invoicing.js';
import * as values from '../src/domain/values.js';

const html = fs.readFileSync(new URL('../src/reports/reports.html', import.meta.url), 'utf8');
const source = fs.readFileSync(new URL('../src/reports/reports.js', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../src/reports/reports.css', import.meta.url), 'utf8');
const oldRange = { startDate: '2026-08-17', endDate: '2026-08-23' };
const newRange = { startDate: '2026-08-24', endDate: '2026-08-30' };
const record = (user, host = 'example.com', date = oldRange.startDate) => ({
  user, taskUrl: `https://${host}/task`, taskTitle: 'Review', entryDate: date,
  startedAt: `${date}T09:00:00Z`, endedAt: `${date}T10:00:00Z`, durationSeconds: 3600,
  destinationId: 'github:1', timeRepository: 'alice/time',
});
const invoiceSettings = {
  seller: { name: 'Acme Studio', address: '1 Main Street', email: 'hello@example.com', taxId: 'VAT-1' },
  clients: [{ id: 'client-1', name: 'Client One', address: '2 Client Road', email: 'billing@example.com', taxId: 'VAT-2', defaultCurrency: 'EUR' }],
  nextNumber: 7, numberFormat: 'INV-{YYYY}-{NNNN}', paymentTerms: 'Net 30', taxPercent: 20, notes: 'Thank you.',
};
const result = (records = [record('alice'), record('bob', 'other.com')], rates = {}, invoicingSettings = invoiceSettings) => ({
  configured: true, currentUser: 'alice', records,
  billing: { rates, invoicing: invoicingSettings, otherProjectName: 'General', projects: [{ name: 'Main', substrings: ['https://example.com/'], client: 'client-1' }, { name: 'Other', substrings: ['https://other.com/'], client: 'client-1' }] },
});

function harness(preferences = {}, { delayInitialPreferences = false } = {}) {
  const classList = owner => ({
    toggle(name, force) { const classes = new Set(owner.className.split(' ').filter(Boolean)); if (force) classes.add(name); else classes.delete(name); owner.className = [...classes].join(' '); },
    contains: name => owner.className.split(' ').includes(name),
    add(name) { this.toggle(name, true); }, remove(name) { this.toggle(name, false); },
  });
  const document = { activeElement: null, title: 'Reports' };
  const nodes = new Map();
  class Node {
    constructor(tag = 'div') {
      this.tagName = tag; this.children = []; this.listeners = {}; this.attributes = {}; this.dataset = {}; this.style = {};
      this.hidden = false; this.open = false; this.disabled = false; this.value = ''; this.textContent = ''; this.className = '';
      this.classList = classList(this);
    }
    append(...children) { this.children.push(...children); }
    insertBefore(child, reference) { const index = this.children.indexOf(reference); if (index < 0) this.children.push(child); else this.children.splice(index, 0, child); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(name, value) { this.attributes[name] = value; if (name === 'id') nodes.set(value, this); }
    removeAttribute(name) { delete this.attributes[name]; }
    contains(node) { return this === node || this.children.some(child => child.contains?.(node)); }
    getBoundingClientRect() { return { width: this.rectWidth || 180 }; }
    querySelectorAll(selector) {
      const className = selector.startsWith('.') ? selector.slice(1) : '';
      const matches = child => className && child.className.split(' ').includes(className);
      return this.children.flatMap(child => [...(matches(child) ? [child] : []), ...child.querySelectorAll(selector)]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    addEventListener(type, handler) { this.listeners[type] = handler; }
    getContext() {
      if (this.tagName !== 'canvas') return null;
      this.context ||= {
        font: '', fillStyle: '', textBaseline: '',
        measureText: text => ({ width: text.length * 10, actualBoundingBoxAscent: 20, actualBoundingBoxDescent: 5 }),
        scale() {}, fillText: text => { this.drawnText = text; (this.drawnLines ||= []).push(text); },
      };
      return this.context;
    }
    toDataURL() { return 'data:image/png;base64,dGVzdA=='; }
    focus() { document.activeElement = this; }
    click() { downloads.push(this); }
    showModal() { this.open = true; }
    close() { this.open = false; this.listeners.close?.(); }
    get selectedOptions() { return this.children.filter(node => node.value === this.value); }
  }
  for (const [id, node] of [...html.matchAll(/<([\w-]+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)].map(([, tag, attrs, id]) => {
    const node = new Node(tag); node.hidden = /\bhidden\b/.test(attrs); node.className = attrs.match(/\bclass="([^"]*)"/)?.[1] || ''; return [id, node];
  })) nodes.set(id, node);
  for (const [id, value] of Object.entries({ metric: 'total-time', 'horizontal-axis': 'day', 'stack-by': 'person' })) nodes.get(id).value = value;
  document.body = new Node('body'); document.listeners = {}; document.addEventListener = (type, handler) => { document.listeners[type] = handler; };
  const createdCanvases = [];
  document.getElementById = id => nodes.get(id); document.querySelector = selector => [...nodes.values()].find(node => node.className.split(' ').includes(selector.slice(1))); document.createElement = tag => { const node = new Node(tag); if (tag === 'canvas') createdCanvases.push(node); return node; };
  document.createElementNS = (_, tag) => new Node(tag); document.createTextNode = text => ({ textContent: text });
  const requests = [], downloads = [], prints = [], listeners = [], blobs = [], pdfExports = [], windowListeners = {};
  const html2pdf = () => {
    const job = {};
    const worker = {
      set(options) { job.options = options; return worker; },
      from(sourceNode) { job.source = sourceNode; job.sellerNameRaster = sourceNode.querySelector('.invoice-seller-name-raster'); return worker; },
      async save() { pdfExports.push(job); },
    };
    return worker;
  };
  const context = vm.createContext({
    ...reporting, ...billing, ...invoicing, ...values, document, Blob, TextEncoder, html2pdf, URL: { createObjectURL: blob => { blobs.push(blob); return 'blob:test'; }, revokeObjectURL() {} },
    setTimeout: () => 1, addEventListener(type, handler) { windowListeners[type] = handler; }, window: { print: () => prints.push(document.title) },
    matchMedia: () => ({ addEventListener() {} }), getComputedStyle: () => ({ fontStyle: 'normal', fontVariant: 'normal', fontWeight: '700', fontSize: '28px', fontFamily: 'sans-serif', lineHeight: '35px', color: '#000' }), mountRunningStatus() {}, ClockoliRecovery: { actionFor: () => null },
    chrome: { runtime: { onMessage: { addListener: handler => listeners.push(handler) }, sendMessage(message, callback) { if (message.type === 'GET_LOCAL_PREFERENCES' && !requests.length && !delayInitialPreferences) { callback({ ok: true, data: preferences }); return; } requests.push({ message, callback }); } } },
  });
  vm.runInContext(source.replace(/^import[\s\S]*?from '[^']+';\n/gm, ''), context);
  const settle = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };
  const reply = async (data, request = requests.at(-1)) => { request.callback(data instanceof Error ? { ok: false, error: { message: data.message } } : { ok: true, data }); await settle(); };
  const fire = (id, type = 'click') => nodes.get(id).listeners[type]({ preventDefault() {}, target: nodes.get(id) });
  const textOf = node => `${node?.textContent || ''}${(node?.children || []).map(textOf).join('')}`;
  return { nodes, document, context, requests, downloads, prints, listeners, blobs, pdfExports, createdCanvases, reply, settle, fire, textOf,
    select: (key, value, checked) => {
      const input = nodes.get(`${key}-facet`).children.flatMap(label => label.children).find(node => node.value === value);
      assert.ok(input, `visible ${key} checkbox ${value}`);
      input.checked = checked; input.listeners.change();
    },
    load: range => context.loadRange(range),
    selection: key => vm.runInContext(`[...state.${key}].sort().join(',')`, context),
    invoiceSelection: () => nodes.get('invoice-projects').children.flatMap(label => label.children).filter(node => node.checked).map(node => node.value).sort().join(','),
  };
}

async function loaded(data = result()) {
  const page = harness();
  await page.settle(); await page.reply(data);
  const load = page.load({ ...oldRange }); await page.reply(data); await load;
  return page;
}

test('period, exports, and chart controls use the compact always-visible layout', () => {
  const period = html.match(/<section\b[^>]*class="card period-card"[\s\S]*?<\/section>/)?.[0] || '';
  for (const id of ['download-csv', 'download-json', 'download-pdf']) assert.ok(period.includes(`id="${id}"`), id);
  assert.doesNotMatch(html, /export-card|summary-grid|summary-card/);
  assert.doesNotMatch(html, /<h2[^>]*>Analytics<\/h2>|<summary>Chart options<\/summary>|Tracked time/);
  assert.match(html, /id="period-trigger"/);
  assert.ok(period.indexOf('id="period-trigger"') < period.indexOf('class="export-controls"'));
  const chart = html.match(/<section id="analytics-card"[\s\S]*?<\/section>/)?.[0] || '';
  assert.ok(chart.indexOf('id="metric"') < chart.indexOf('id="analytics-chart"'));
  assert.ok(chart.indexOf('id="stack-by"') < chart.indexOf('id="analytics-chart"'));
  assert.ok(chart.indexOf('id="horizontal-axis"') > chart.indexOf('id="analytics-chart"'));
  assert.match(styles, /@media\(max-width:640px\)[\s\S]*\.chart-top-controls\{display:grid;grid-template-columns:minmax\(0,1fr\)/);
});

test('initial progress is visible before preferences resolve and while reports load', async () => {
  const loadingTag = html.match(/<div id="loading"[^>]*>/)?.[0] || '';
  const progressTag = html.match(/<progress id="loading-progress"[^>]*>/)?.[0] || '';
  assert.ok(loadingTag);
  assert.doesNotMatch(loadingTag, /\bhidden\b/);
  assert.doesNotMatch(progressTag, /\bvalue=/);
  const page = harness({}, { delayInitialPreferences: true });
  assert.equal(page.requests[0].message.type, 'GET_LOCAL_PREFERENCES');
  assert.equal(page.nodes.get('loading').hidden, false);
  await page.reply({}, page.requests[0]);
  assert.equal(page.requests.at(-1).message.type, 'LOAD_REPORT');
  assert.equal(page.nodes.get('loading').hidden, false);
  assert.equal(page.nodes.get('loading-progress').value, 10);
  await page.reply(result());
  assert.equal(page.nodes.get('loading').hidden, true);
});

test('initial preference failures hide the loading indicator and show the error', async () => {
  const page = harness({}, { delayInitialPreferences: true });
  assert.equal(page.nodes.get('loading').hidden, false);
  await page.reply(new Error('Unable to read preferences'), page.requests[0]);
  assert.equal(page.nodes.get('loading').hidden, true);
  assert.equal(page.nodes.get('error').hidden, false);
  assert.match(page.textOf(page.nodes.get('error')), /Unable to read preferences/);
});

test('first load defaults to current user, shows one time figure and hides unconfigured billing', async () => {
  const page = await loaded();
  assert.equal(page.selection('people'), 'alice');
  assert.equal(page.nodes.get('summary-time').textContent, '1h 0m');
  assert.equal(page.nodes.get('summary-billable')?.hidden, true);
  assert.equal(page.nodes.get('summary-counts')?.textContent, '1 entry · 1 person · 1 source');
  assert.ok(page.nodes.get('chart-options'));
  const chart = page.nodes.get('analytics-chart').children[0];
  assert.ok(chart.children.some(node => node.tagName === 'rect' && node.attributes.tabindex === '0'));
  assert.ok(page.nodes.get('print-detail-table').children[1].children.length);
});

test('partial multi-repository reports stay visible with exports disabled', async () => {
  const page = await loaded({
    ...result(), partial: true,
    readStatus: [
      { destinationId: 'github:1', timeRepository: 'alice/time', status: 'ok' },
      { destinationId: 'github:2', timeRepository: 'team/time', status: 'error', error: { code: 'unavailable' } },
    ],
  });
  assert.equal(page.nodes.get('report-content').hidden, false);
  assert.equal(page.nodes.get('partial-status').hidden, false);
  assert.match(page.nodes.get('partial-status').textContent, /Exports are disabled/);
  assert.equal(page.selection('timeRepositories'), 'alice/time');
  for (const id of ['download-csv', 'download-json', 'download-pdf']) assert.equal(page.nodes.get(id).attributes['aria-disabled'], 'true');
});

test('conflict-only partial reports identify omitted conflicts without claiming a read failure', async () => {
  const page = await loaded({
    ...result(), partial: true,
    readStatus: [
      { destinationId: 'github:1', timeRepository: 'alice/time', status: 'ok' },
      { destinationId: 'github:2', timeRepository: 'team/time', status: 'ok' },
    ],
    conflicts: [{ code: 'record_id_conflict', id: '01K2ABCDEF0123456789ABCDE0' }],
  });
  assert.match(page.nodes.get('partial-status').textContent, /1 conflicting record was omitted/i);
  assert.doesNotMatch(page.nodes.get('partial-status').textContent, /could not be loaded/i);
  for (const id of ['download-csv', 'download-json', 'download-pdf']) assert.equal(page.nodes.get(id).attributes['aria-disabled'], 'true');
});

test('billing stays visible when a configured rate belongs to someone outside the selection', async () => {
  const page = await loaded(result(undefined, { bob: [{ amountMinorPerHour: 0, currency: 'USD', startDate: '', endDate: '' }] }));
  assert.equal(page.nodes.get('summary-billable')?.hidden, false);
  assert.equal(page.nodes.get('summary-money').textContent, 'Unrated · No rate for alice');
});

test('pending period keeps the actual report and filters visible while every export is blocked', async () => {
  const page = await loaded();
  const chart = page.nodes.get('analytics-chart').children[0];
  const pending = page.load(newRange);
  assert.equal(page.nodes.get('report-content').hidden, false);
  assert.equal(page.nodes.get('analytics-chart').children[0], chart);
  assert.equal(page.nodes.get('period-label')?.textContent, 'Aug 17, 2026 – Aug 23, 2026');
  assert.equal(page.nodes.get('print-period').textContent, '2026-08-17 — 2026-08-23');
  for (const id of ['download-csv', 'download-json', 'download-pdf']) {
    assert.equal(page.nodes.get(id).attributes['aria-disabled'], 'true'); page.fire(id);
  }
  assert.equal(page.downloads.length, 0); assert.equal(page.prints.length, 0);
  page.context.render();
  assert.equal(page.nodes.get('loading').hidden, false);
  assert.equal(page.nodes.get('download-csv').attributes['aria-disabled'], 'true');
  await page.reply(result([record('alice', 'example.com', newRange.startDate)])); await pending;
  assert.equal(page.nodes.get('download-csv').attributes['aria-disabled'], 'false');
  assert.equal(page.nodes.get('period-label').textContent, 'Aug 24, 2026 – Aug 30, 2026');
  page.fire('download-json'); assert.equal(page.downloads.length, 1);
  assert.match(page.downloads[0].download, /2026-08-24.*2026-08-30/);
});

test('widening a period expands all-selected facets in totals and exports', async () => {
  const page = await loaded(result([record('alice')]));
  const month = { startDate: '2026-08-01', endDate: '2026-08-31' };
  const pending = page.load(month);
  await page.reply(result([record('alice'), record('alice', 'other.com')])); await pending;
  assert.equal(page.selection('projects'), 'Main,Other');
  assert.equal(page.selection('repositories'), 'example.com,other.com');
  assert.equal(page.nodes.get('summary-time').textContent, '2h 0m');
  page.fire('download-json');
  const exported = await page.blobs.at(-1).text();
  assert.match(exported, /https:\/\/example.com\/task/);
  assert.match(exported, /https:\/\/other.com\/task/);
  assert.equal(page.nodes.get('print-detail-table').children[1].children.length, 2);
});

test('renamed main project survives Projects all and Reset filters', async () => {
  const data = {
    ...result(),
    billing: { rates: {}, projects: [{ name: 'Main', substrings: ['https://example.com/'] }], otherProjectName: 'General' },
  };
  const page = await loaded(data);
  assert.equal(page.selection('projects'), 'General,Main');
  page.fire('reset-filters');
  assert.equal(page.selection('projects'), 'General,Main');
  page.fire('projects-all');
  assert.equal(page.selection('projects'), '');
  page.fire('projects-all');
  assert.equal(page.selection('projects'), 'General,Main');
  page.select('projects', 'General', false);
  assert.equal(page.nodes.get('summary-time').textContent, '1h 0m');
  page.fire('reset-filters');
  assert.equal(page.selection('projects'), 'General,Main');
  assert.equal(page.nodes.get('summary-time').textContent, '2h 0m');
});

for (const [key, excluded, retained] of [
  ['people', 'bob', 'alice'], ['projects', 'Other', 'Main'], ['repositories', 'other.com', 'example.com'],
]) test(`${key} preserves subset intent through empty and narrower periods`, async () => {
  const page = await loaded();
  page.fire('reset-filters'); page.select(key, excluded, false);
  const empty = page.load(newRange); await page.reply(result([])); await empty;
  assert.equal(page.selection(key), retained, 'an empty period must not erase selections');
  const narrow = page.load(oldRange); await page.reply(result([record('alice')])); await narrow;
  assert.equal(page.selection(key), retained);
  const wide = page.load(newRange); await page.reply(result()); await wide;
  assert.equal(page.selection(key), retained, 'a narrowed subset must not become select-all');
  assert.equal(page.nodes.get('summary-time').textContent, '1h 0m');
  const missing = page.load(oldRange); await page.reply(result([record('bob', 'other.com')])); await missing;
  assert.equal(page.selection(key), '', 'explicit subsets intersect nonempty periods');
});

test('all-selected intent survives empty periods and explicit checkbox selections expand people', async () => {
  const page = await loaded();
  page.select('people', 'bob', true);
  const empty = page.load(newRange); await page.reply(result([])); await empty;
  assert.equal(page.selection('people'), 'alice,bob');
  assert.equal(page.selection('projects'), 'Main,Other');
  assert.equal(page.selection('repositories'), 'example.com,other.com');
  const wide = page.load(oldRange);
  await page.reply(result([record('alice'), record('bob', 'other.com'), record('charlie', 'new.com')])); await wide;
  assert.equal(page.selection('people'), 'alice,bob,charlie');
  assert.equal(page.selection('repositories'), 'example.com,new.com,other.com');
  assert.equal(page.nodes.get('summary-time').textContent, '3h 0m');
});

test('explicitly unselecting all stays empty across empty and populated periods', async () => {
  const page = await loaded();
  page.fire('reset-filters'); page.fire('people-all');
  const empty = page.load(newRange); await page.reply(result([])); await empty;
  const wide = page.load(oldRange); await page.reply(result()); await wide;
  assert.equal(page.selection('people'), '');
  assert.equal(page.nodes.get('summary-time').textContent, '0m');
});

test('empty periods and excluded records each offer exactly their relevant action', async () => {
  const page = await loaded(result([]));
  assert.equal(page.nodes.get('report-empty')?.hidden, false);
  assert.equal(page.nodes.get('empty-message')?.textContent, 'No time in 2026-08-17 — 2026-08-23.');
  assert.equal(page.nodes.get('add-time')?.hidden, false); assert.equal(page.nodes.get('reset-filters')?.hidden, true);
  assert.match(html, /id="add-time"[^>]*href="\.\.\/times\/times.html"[^>]*>Add time<\/a>/);
  const pending = page.load(newRange); await page.reply(result()); await pending;
  assert.equal(page.selection('people'), 'alice', 'first empty load retains the current-user default');
  assert.equal(page.nodes.get('report-empty').hidden, true);
  assert.equal(page.nodes.get('summary-time').textContent, '1h 0m');
  page.fire('people-all'); page.fire('people-all');
  assert.equal(page.nodes.get('empty-message').textContent, 'Filters hide all entries.');
  assert.equal(page.nodes.get('add-time').hidden, true); assert.equal(page.nodes.get('reset-filters').hidden, false);
  page.fire('reset-filters');
  assert.equal(page.nodes.get('report-empty').hidden, true);
  assert.equal(page.nodes.get('summary-time').textContent, '2h 0m');
});

test('unconfigured reports hide the period card and keep the existing setup action', async () => {
  const page = harness(); await page.settle(); await page.reply({ configured: false });
  assert.equal(page.nodes.get('period-card')?.hidden, true);
  assert.equal(page.nodes.get('setup').hidden, false);
  assert.equal(page.nodes.get('report-content').hidden, true);
  page.fire('setup-settings'); assert.equal(page.requests.at(-1).message.type, 'OPEN_OPTIONS');
});

test('failed and out-of-order requests preserve the last successful report', async () => {
  const page = await loaded();
  const first = page.load(newRange), stale = page.requests.at(-1);
  const second = page.load({ startDate: '2026-09-01', endDate: '2026-09-05' });
  await page.reply(new Error('Offline')); await second;
  await page.reply(result([record('alice', 'example.com', newRange.startDate)]), stale); await first;
  assert.equal(page.nodes.get('report-content').hidden, false);
  assert.equal(page.nodes.get('period-label')?.textContent, 'Aug 17, 2026 – Aug 23, 2026');
  assert.equal(page.nodes.get('print-period').textContent, '2026-08-17 — 2026-08-23');
  assert.equal(page.nodes.get('error').children[0].textContent, 'Offline');
});

test('custom-period editing cancels pending work without clearing the displayed report', async () => {
  const page = await loaded();
  const pending = page.load(newRange), stale = page.requests.at(-1);
  page.fire('period-trigger'); page.context.selectCalendarDay('2026-08-18');
  assert.equal(page.requests.at(-1).message.type, 'CANCEL_REPORT');
  assert.equal(page.nodes.get('report-content').hidden, false);
  assert.equal(page.nodes.get('period-label')?.textContent, 'Aug 17, 2026 – Aug 23, 2026');
  await page.reply(result(), stale); await pending;
  assert.equal(page.nodes.get('print-period').textContent, '2026-08-17 — 2026-08-23');
});

test('invoice entry point explains empty and unrated filtered sets', async () => {
  const empty = await loaded(result([]));
  assert.equal(empty.nodes.get('create-invoice').attributes['aria-disabled'], 'true');
  assert.equal(empty.nodes.get('create-invoice').attributes.title, 'No entries in this period to invoice');
  const unrated = await loaded(result([record('alice')]));
  assert.equal(unrated.nodes.get('create-invoice').attributes['aria-disabled'], 'true');
  assert.equal(unrated.nodes.get('create-invoice').attributes.title, 'No hourly rate covers these entries. Add rates in Settings.');
});

test('invoice dialog renders the filtered records and reserves one number across repeated prints', async () => {
  const rates = { alice: [{ amountMinorPerHour: 12000, currency: 'EUR', startDate: '', endDate: '' }] };
  const page = await loaded(result([record('alice')], rates));
  await page.fire('create-invoice'); await page.settle();
  assert.equal(page.nodes.get('invoice-dialog').open, true);
  assert.match(page.textOf(page.nodes.get('invoice-preview')), /Review/);
  assert.match(page.textOf(page.nodes.get('invoice-preview')), /INV-2026-0007/);
  const print = page.fire('invoice-print');
  const reserve = page.requests.at(-1);
  assert.equal(reserve.message.type, 'RESERVE_INVOICE_NUMBER');
  await page.reply({ sequence: 7, revision: 1 }, reserve); await print;
  assert.equal(vm.runInContext('state.settingsRevision', page.context), 1);
  assert.equal(page.nodes.get('invoice-dialog').open, true);
  const before = page.requests.filter(request => request.message.type === 'RESERVE_INVOICE_NUMBER').length;
  await page.fire('create-invoice'); await page.settle();
  await page.fire('invoice-print'); await page.settle();
  assert.equal(page.requests.filter(request => request.message.type === 'RESERVE_INVOICE_NUMBER').length, before);
  assert.deepEqual(page.prints, ['invoice-INV-2026-0007', 'invoice-INV-2026-0007']);
  assert.equal(page.downloads.length, 0);
});

test('changing an invoice control invalidates its reserved sequence', async () => {
  const rates = { alice: [{ amountMinorPerHour: 12000, currency: 'EUR', startDate: '', endDate: '' }] };
  const page = await loaded(result([record('alice')], rates));
  await page.fire('create-invoice'); await page.settle();
  const first = page.fire('invoice-print'); await page.reply({ sequence: 7 }); await first;
  await page.fire('create-invoice'); await page.settle();
  page.nodes.get('invoice-group-by').value = 'day'; await page.fire('invoice-group-by', 'change'); await page.settle();
  const second = page.fire('invoice-print');
  assert.equal(page.requests.at(-1).message.type, 'RESERVE_INVOICE_NUMBER');
  await page.reply({ sequence: 8 }); await second;
  assert.equal(page.requests.filter(request => request.message.type === 'RESERVE_INVOICE_NUMBER').length, 2);
});

test('invoice client projects select independently from the report project facet', async () => {
  const records = [record('alice'), record('alice', 'other.com')];
  const rates = { alice: [{ amountMinorPerHour: 12000, currency: 'EUR', startDate: '', endDate: '' }] };
  const response = result(records, rates); response.billing.projects[1].client = '';
  const page = await loaded(response);
  assert.equal(page.selection('projects'), 'Main,Other');
  await page.fire('create-invoice'); await page.settle();
  page.nodes.get('invoice-client').value = 'client-1'; await page.fire('invoice-client', 'change'); await page.settle();
  assert.equal(page.invoiceSelection(), 'Main');
  assert.equal(page.nodes.get('invoice-project-count').textContent, 'Billing 1 of 2 projects');
  assert.equal(page.selection('projects'), 'Main,Other');
});

test('invoice project changes rebuild the preview and reset the reserved number', async () => {
  const records = [
    { ...record('alice'), taskTitle: 'Main work' },
    { ...record('alice', 'other.com'), taskTitle: 'Other work' },
  ];
  const rates = { alice: [{ amountMinorPerHour: 12000, currency: 'EUR', startDate: '', endDate: '' }] };
  const page = await loaded(result(records, rates));
  await page.fire('create-invoice'); await page.settle();
  assert.match(page.textOf(page.nodes.get('invoice-preview')), /Main work/);
  assert.match(page.textOf(page.nodes.get('invoice-preview')), /Other work/);
  const first = page.fire('invoice-print'); await page.reply({ sequence: 7 }); await first;
  await page.fire('create-invoice'); await page.settle();
  const other = page.nodes.get('invoice-projects').children.flatMap(label => label.children).find(node => node.value === 'Other');
  other.checked = false; await other.listeners.change(); await page.settle();
  assert.match(page.textOf(page.nodes.get('invoice-preview')), /Main work/);
  assert.doesNotMatch(page.textOf(page.nodes.get('invoice-preview')), /Other work/);
  assert.equal(page.nodes.get('invoice-project-count').textContent, 'Billing 1 of 2 projects');
  const second = page.fire('invoice-print');
  assert.equal(page.requests.at(-1).message.type, 'RESERVE_INVOICE_NUMBER');
  await page.reply({ sequence: 8 }); await second;
  assert.equal(page.requests.filter(request => request.message.type === 'RESERVE_INVOICE_NUMBER').length, 2);
});

test('foreign project warnings are non-blocking and clear with the selection', async () => {
  const records = [record('alice'), record('alice', 'other.com')];
  const rates = { alice: [{ amountMinorPerHour: 12000, currency: 'EUR', startDate: '', endDate: '' }] };
  const settings = { ...invoiceSettings, clients: [
    { ...invoiceSettings.clients[0], name: 'Acme Inc' },
    { ...invoiceSettings.clients[0], id: 'globex', name: 'Globex GmbH' },
  ] };
  const response = result(records, rates, settings); response.billing.projects[0].client = 'client-1'; response.billing.projects[1].client = 'globex';
  const page = await loaded(response);
  await page.fire('create-invoice'); await page.settle();
  page.nodes.get('invoice-client').value = 'client-1'; await page.fire('invoice-client', 'change'); await page.settle();
  const other = page.nodes.get('invoice-projects').children.flatMap(label => label.children).find(node => node.value === 'Other');
  other.checked = true; await other.listeners.change(); await page.settle();
  assert.equal(page.nodes.get('invoice-project-warning').textContent, 'This invoice includes work from projects assigned to Globex GmbH: Other.');
  assert.equal(page.nodes.get('invoice-feedback').textContent, '');
  for (const id of ['invoice-print']) assert.equal(page.nodes.get(id).disabled, false);
  other.checked = false; await other.listeners.change(); await page.settle();
  assert.equal(page.nodes.get('invoice-project-warning').textContent, '');
});

test('unassigned and missing client projects stay unchecked and do not warn', async () => {
  const rates = { alice: [{ amountMinorPerHour: 12000, currency: 'EUR', startDate: '', endDate: '' }] };
  const response = result([record('alice'), record('alice', 'other.com')], rates); response.billing.projects[0].client = ''; response.billing.projects[1].client = 'missing';
  const page = await loaded(response); await page.fire('create-invoice'); await page.settle();
  page.nodes.get('invoice-client').value = 'client-1'; await page.fire('invoice-client', 'change'); await page.settle();
  assert.equal(page.invoiceSelection(), '');
  assert.equal(page.nodes.get('invoice-project-count').textContent, 'Billing 0 of 2 projects');
  for (const input of page.nodes.get('invoice-projects').children.flatMap(label => label.children).filter(node => node.type === 'checkbox')) {
    input.checked = true; await input.listeners.change(); await page.settle();
  }
  assert.equal(page.nodes.get('invoice-project-warning').textContent, '');
});

test('a renamed catch-all is selected for its client', async () => {
  const rates = { alice: [{ amountMinorPerHour: 12000, currency: 'EUR', startDate: '', endDate: '' }] };
  const response = result([record('alice')], rates); response.billing.projects = []; response.billing.otherProjectName = 'Work'; response.billing.otherProjectClient = 'client-1';
  const page = await loaded(response); await page.fire('create-invoice'); await page.settle();
  page.nodes.get('invoice-client').value = 'client-1'; await page.fire('invoice-client', 'change'); await page.settle();
  assert.equal(page.invoiceSelection(), 'Work');
  assert.equal(page.nodes.get('invoice-project-count').textContent, 'Billing 1 of 1 projects');
  assert.equal(page.nodes.get('invoice-project-warning').textContent, '');
  page.nodes.get('invoice-dialog').close();
  const refresh = page.context.refreshProjectDefinitions();
  await page.reply({ ...response.billing, otherProjectClient: '' }); await refresh;
  await page.fire('create-invoice'); await page.settle();
  assert.equal(page.invoiceSelection(), '');
  assert.equal(page.nodes.get('invoice-project-count').textContent, 'Billing 0 of 1 projects');
});

test('invoice exchange failure is blocking and never leaves a partial preview', async () => {
  const records = [record('alice'), record('bob', 'other.com')];
  const rates = {
    alice: [{ amountMinorPerHour: 12000, currency: 'EUR', startDate: '', endDate: '' }],
    bob: [{ amountMinorPerHour: 10000, currency: 'USD', startDate: '', endDate: '' }],
  };
  const page = await loaded(result(records, rates)); page.fire('reset-filters');
  page.fire('create-invoice'); await page.settle();
  page.nodes.get('invoice-client').value = 'client-1'; const opening = page.fire('invoice-client', 'change'); await page.settle();
  assert.match(page.textOf(page.nodes.get('invoice-preview')), /Loading exchange rates/);
  assert.equal(page.requests.at(-1).message.type, 'GET_EXCHANGE_RATES');
  await page.reply(new Error('Exchange service unavailable')); await opening;
  assert.equal(page.nodes.get('invoice-feedback').textContent, 'Exchange service unavailable');
  assert.equal(page.textOf(page.nodes.get('invoice-preview')), 'Choose a client and currency to preview the invoice.');
  for (const id of ['invoice-print']) assert.equal(page.nodes.get(id).disabled, true);
});

test('a sole invoice client defaults once and an explicit No client survives reopening', async () => {
  const page = await loaded(result([record('alice')], { alice: { amountMinorPerHour: 12000, currency: 'EUR' } }));
  await page.fire('create-invoice'); await page.settle();
  assert.equal(page.nodes.get('invoice-client').value, 'client-1');
  assert.match(page.textOf(page.nodes.get('invoice-preview')), /Bill to: Client One/);
  page.nodes.get('invoice-client').value = ''; await page.fire('invoice-client', 'change'); await page.settle();
  await page.fire('invoice-close'); await page.fire('create-invoice'); await page.settle();
  assert.equal(page.nodes.get('invoice-client').value, '');
  assert.doesNotMatch(page.textOf(page.nodes.get('invoice-preview')), /Bill to:/);
  assert.equal(page.requests.filter(request => request.message.type === 'GET_EXCHANGE_RATES').length, 0);
});

test('a single source currency fetches exchange rates for the selected client currency', async () => {
  const page = await loaded(result([record('alice')], { alice: 10000 }));
  await page.fire('create-invoice'); await page.settle();
  page.nodes.get('invoice-client').value = 'client-1'; await page.fire('invoice-client', 'change'); await page.settle();
  const request = page.requests.at(-1);
  assert.equal(request.message.type, 'GET_EXCHANGE_RATES');
  assert.equal(request.message.payload.targetCurrency, 'EUR');
  assert.equal(request.message.payload.sourceCurrencies.join(','), 'USD');
  assert.equal(request.message.payload.dates.join(','), oldRange.startDate);
  await page.reply({ rates: { [oldRange.startDate]: { USD: 0.9 } } }, request);
  assert.equal(page.nodes.get('invoice-feedback').textContent, '');
  assert.match(page.textOf(page.nodes.get('invoice-preview')), /90.00 EUR/);
  assert.doesNotMatch(page.textOf(page.nodes.get('invoice-preview')), /90.00 EUR90.00 EUR/);
  for (const id of ['invoice-print']) assert.equal(page.nodes.get(id).disabled, false);
});

for (const change of ['close', 'composition']) test(`a reservation response after ${change} survives the failed print and is reused`, async () => {
  const page = await loaded(result([record('alice')], { alice: { amountMinorPerHour: 12000, currency: 'EUR' } }));
  await page.fire('create-invoice'); await page.settle();
  const first = page.fire('invoice-print');
  const reserve = page.requests.at(-1);
  if (change === 'close') await page.fire('invoice-close');
  else { page.nodes.get('invoice-group-by').value = 'day'; await page.fire('invoice-group-by', 'change'); }
  await page.reply({ sequence: 9 }, reserve); await first;
  assert.equal(page.prints.length, 0);
  assert.match(page.nodes.get('invoice-feedback').textContent, /Invoice changed/);
  if (change === 'close') await page.fire('create-invoice');
  await page.settle(); await page.fire('invoice-print'); await page.settle();
  assert.equal(page.requests.filter(request => request.message.type === 'RESERVE_INVOICE_NUMBER').length, 1);
  assert.deepEqual(page.prints, ['invoice-INV-2026-0009']);
  await page.fire('create-invoice'); await page.settle();
  page.nodes.get('invoice-issue-date').value = '2026-09-14'; await page.fire('invoice-issue-date', 'change'); await page.settle();
  const next = page.fire('invoice-print'); await page.reply({ sequence: 10 }); await next;
  assert.equal(page.requests.filter(request => request.message.type === 'RESERVE_INVOICE_NUMBER').length, 2);
});

test('invoice composition projects billing inputs without serializing record metadata on facet searches', async () => {
  const entry = { ...record('alice'), id: 'record-1', metadata: { toJSON() { assert.fail('invoice composition must not serialize metadata'); } } };
  const page = await loaded(result([entry], { alice: { amountMinorPerHour: 12000, currency: 'EUR' } }));
  await page.fire('create-invoice'); await page.settle();
  const first = page.fire('invoice-print'); await page.reply({ sequence: 7 }); await first;
  await page.fire('create-invoice'); await page.settle();
  page.nodes.get('people-search').value = 'ali'; await page.fire('people-search', 'input'); await page.settle();
  await page.fire('invoice-print'); await page.settle();
  assert.equal(page.requests.filter(request => request.message.type === 'RESERVE_INVOICE_NUMBER').length, 1);
  const original = page.context.invoiceCompositionKey([entry]);
  for (const patch of [{ id: 'record-2' }, { user: 'bob' }, { entryDate: '2026-08-18' }, { durationSeconds: 60 }]) {
    assert.notEqual(page.context.invoiceCompositionKey([{ ...entry, ...patch }]), original);
  }
  assert.notEqual(page.context.invoiceCompositionKey([{ ...entry, id: null }]), page.context.invoiceCompositionKey([{ ...entry, id: null, taskUrl: 'https://other.com/task' }]));
  for (const update of ["state.range.endDate = '2026-08-24'", "state.people.clear()", 'state.billing.rates.alice = 13000', "state.billing.invoicing.notes = 'Changed'"]) {
    const before = page.context.invoiceCompositionKey([entry]); vm.runInContext(update, page.context);
    assert.notEqual(page.context.invoiceCompositionKey([entry]), before);
  }
});

test('Save as PDF uses the seller first-last and invoice number filename', async () => {
  const settings = { ...invoiceSettings, seller: { ...invoiceSettings.seller, name: 'Sergey Nikolaev' } };
  const page = await loaded(result([record('alice')], { alice: { amountMinorPerHour: 12000, currency: 'EUR' } }, settings));
  await page.fire('create-invoice'); await page.settle();
  const saving = page.fire('invoice-save-pdf');
  await page.reply({ sequence: 7 }); await saving;
  assert.equal(page.nodes.get('invoice-feedback').textContent, '');
  assert.equal(page.prints.length, 0);
  assert.equal(page.blobs.length, 0);
  assert.equal(page.downloads.length, 0);
  assert.equal(page.pdfExports.length, 1);
  const [job] = page.pdfExports;
  assert.equal(job.source, page.nodes.get('invoice-preview').children[0]);
  assert.equal(page.createdCanvases.at(-1)?.drawnText, 'Sergey Nikolaev');
  assert.equal(job.sellerNameRaster?.attributes['aria-label'], 'Sergey Nikolaev');
  assert.equal(job.sellerNameRaster?.alt, 'Sergey Nikolaev');
  const sellerName = job.source.children[0].children[0].children[0];
  assert.deepEqual(sellerName.children.map(part => [part.className, part.textContent]), [
    ['invoice-seller-name-part', 'Sergey'],
    ['invoice-seller-name-part', 'Nikolaev'],
  ]);
  assert.equal(job.source.classList.contains('invoice-pdf-export'), false);
  assert.equal(job.options.filename, 'Sergey-Nikolaev-INV-2026-0007.pdf');
  assert.equal(job.options.image.type, 'jpeg');
  assert.equal(job.options.image.quality, 0.98);
  assert.equal(job.options.html2canvas.scale, 3);
  assert.equal(job.options.jsPDF.format, 'a4');
  assert.equal(job.options.pagebreak.avoid.includes('tr'), true);
  assert.equal(page.nodes.get('invoice-dialog').open, true);
});

test('PDF seller raster wraps long names at 3x without changing layout and restores the preview DOM', async () => {
  const page = await loaded(result([record('alice')], { alice: { amountMinorPerHour: 12000, currency: 'EUR' } }));
  await page.fire('create-invoice'); await page.settle();
  const source = page.nodes.get('invoice-preview').children[0], heading = source.querySelector('.invoice-seller').children[0];
  heading.rectWidth = 180;
  const original = [...heading.children], longName = `Alpha ${'X'.repeat(40)} Omega Company`;
  const restore = page.context.replaceSellerNameWithRasterImage(source, longName), image = heading.querySelector('.invoice-seller-name-raster');
  const canvas = page.createdCanvases.at(-1);
  assert.ok(image);
  assert.ok(canvas.drawnLines.length > 2);
  assert.ok(canvas.drawnLines.every(line => line.length * 10 <= 180));
  assert.ok(image.width <= 180);
  assert.equal(image.height, canvas.drawnLines.length * 35);
  assert.equal(canvas.width, image.width * 3);
  assert.equal(canvas.height, image.height * 3);
  restore();
  assert.deepEqual(heading.children, original);
});

test('failed HTML-to-PDF export restores preview state and reports the error', async () => {
  const page = await loaded(result([record('alice')], { alice: { amountMinorPerHour: 12000, currency: 'EUR' } }));
  await page.fire('create-invoice'); await page.settle();
  let source;
  page.context.html2pdf = () => {
    const worker = { set() { return worker; }, from(value) { source = value; return worker; }, async save() { throw new Error('PDF render failed'); } };
    return worker;
  };
  const saving = page.fire('invoice-save-pdf');
  await page.reply({ sequence: 7 }); await saving;
  assert.equal(source.classList.contains('invoice-pdf-export'), false);
  assert.equal(page.nodes.get('invoice-dialog').open, true);
  assert.equal(page.nodes.get('invoice-save-pdf').disabled, false);
  assert.equal(page.nodes.get('invoice-feedback').textContent, 'PDF render failed');
});


test('invoice names the billed range and uses refreshed payment days on the next preview', async () => {
  const response = result([record('alice')], { alice: { amountMinorPerHour: 12000, currency: 'EUR' } });
  const page = await loaded(response); await page.fire('create-invoice'); await page.settle();
  assert.equal(page.nodes.get('invoice-billing-period').textContent, 'Billing 2026-08-17 to 2026-08-23');
  page.nodes.get('invoice-issue-date').value = '2026-09-01'; await page.fire('invoice-issue-date', 'change'); await page.settle();
  const refresh = page.context.refreshProjectDefinitions(); await page.reply({ ...response.billing, invoicing: { ...invoiceSettings, paymentTermsDays: 45 } }); await refresh; await page.settle();
  assert.match(page.textOf(page.nodes.get('invoice-preview')), /DueOct 16, 2026/);
  assert.match(page.textOf(page.nodes.get('invoice-preview')), /Payment terms: Net 45/);
  const pending = page.load(newRange); await page.reply(response); await pending; await page.settle();
  assert.equal(page.nodes.get('invoice-billing-period').textContent, 'Billing 2026-08-24 to 2026-08-30');
});

test('date presets use local calendar boundaries and reload like manual date changes', async () => {
  const page = await loaded();
  vm.runInContext(`const NativeDate = Date; Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [2028, 2, 1, 0, 30])); } };`, page.context);
  for (const [preset, startDate, endDate] of [['this-month', '2028-03-01', '2028-03-31'], ['last-month', '2028-02-01', '2028-02-29'], ['last-7-days', '2028-02-24', '2028-03-01'], ['last-30-days', '2028-02-01', '2028-03-01']]) {
    page.fire(`preset-${preset}`); await page.settle();
    assert.equal(page.nodes.get('start-date').value, startDate); assert.equal(page.nodes.get('end-date').value, endDate);
    assert.equal(page.nodes.get('period-popover').hidden, true);
    const request = page.requests.at(-1).message; assert.equal(request.type, 'LOAD_REPORT');
    assert.equal(request.payload.startDate, startDate); assert.equal(request.payload.endDate, endDate);
    await page.reply(result());
  }
  page.nodes.get('start-date').value = '2028-02-02'; page.fire('start-date', 'change'); await page.settle();
  assert.equal(page.requests.at(-1).message.payload.startDate, '2028-02-02');
  await page.reply(result());
});

test('additional line controls rebuild totals, reject invalid amounts, remove rows and enforce the limit', async () => {
  const page = await loaded(result([record('alice')], { alice: { amountMinorPerHour: 12000, currency: 'EUR' } }));
  await page.fire('create-invoice'); await page.settle(); await page.fire('invoice-add-line'); await page.settle();
  const rows = page.nodes.get('invoice-extra-lines');
  const [descriptionLabel, amountLabel, remove] = rows.children[0].children, description = descriptionLabel.children[0], amount = amountLabel.children[0];
  assert.equal(page.nodes.get('invoice-print').disabled, true);
  description.value = ' Materials '; await description.listeners.change(); amount.value = '25.50'; await amount.listeners.change(); await page.settle();
  const document = page.nodes.get('invoice-preview').children[0], table = document.children.find(node => node.tagName === 'table');
  assert.equal(page.textOf(table.children[1].children[1]), 'Materials25.50 EUR');
  const extraRow = table.children[1].children[1];
  assert.equal(extraRow.children[0].textContent, '');
  assert.equal(extraRow.children[1].textContent, 'Materials');
  assert.equal(extraRow.children[2].textContent, '');
  assert.match(page.textOf(table), /Subtotal145.50 EURVAT 20%29.10 EURTotal174.60 EUR/);
  amount.value = '-5.25'; await amount.listeners.change(); await page.settle();
  assert.match(page.textOf(page.nodes.get('invoice-preview')), /Subtotal114.75 EURVAT 20%22.95 EURTotal137.70 EUR/);
  amount.value = '1.001'; await amount.listeners.change(); await page.settle();
  assert.equal(page.nodes.get('invoice-print').disabled, true);
  assert.equal(page.textOf(page.nodes.get('invoice-preview')), 'Choose a client and currency to preview the invoice.');
  await remove.listeners.click(); await page.settle();
  assert.equal(rows.children.length, 0); assert.equal(page.nodes.get('invoice-print').disabled, false);
  for (let index = 0; index < 21; index++) await page.fire('invoice-add-line');
  assert.equal(rows.children.length, 20); assert.equal(page.nodes.get('invoice-add-line').disabled, true);
});

test('invoice extra description uses Enter to apply multiline text while Shift+Enter remains a newline', async () => {
  const page = await loaded(result([record('alice')], { alice: { amountMinorPerHour: 12000, currency: 'EUR' } }));
  await page.fire('create-invoice'); await page.settle(); await page.fire('invoice-add-line');
  const row = page.nodes.get('invoice-extra-lines').children[0];
  const [description, applied] = row.children[0].children;
  const amount = row.children[1].children[0];
  assert.equal(description.tagName, 'textarea');
  assert.equal(applied.hidden, true);
  amount.value = '5.00'; await amount.listeners.change(); await page.settle();
  description.value = 'One\nTwo\nThree\nFour';
  description.listeners.input();
  assert.ok(description.rows >= 4, 'invoice description displays the stored line breaks, not only its first line');
  description.value = 'Additional work\nResearch';
  let prevented = false;
  description.listeners.keydown({ key: 'Enter', shiftKey: true, preventDefault() { prevented = true; } });
  assert.equal(prevented, false);
  description.listeners.keydown({ key: 'Enter', shiftKey: false, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  await page.settle();
  assert.equal(applied.hidden, false);
  assert.equal(applied.textContent, '✓ Applied');
  amount.value = '5.00'; await amount.listeners.change(); await page.settle();
  const table = page.nodes.get('invoice-preview').children[0].children.find(node => node.tagName === 'table');
  assert.ok(page.textOf(table).includes('Additional work\nResearch'));
  await description.listeners.change(); await page.settle();
  assert.equal(applied.hidden, false, 'blur does not clear confirmation for unchanged description');

  description.value = '   ';
  description.listeners.input();
  description.listeners.keydown({ key: 'Enter', shiftKey: false, preventDefault() {} });
  await page.settle();
  assert.equal(applied.hidden, true, 'a rejected invoice description must not show Applied');
  assert.match(page.nodes.get('invoice-feedback').textContent, /extra line description/i);
  assert.equal(page.nodes.get('invoice-print').disabled, true);

  description.value = 'Recovered work';
  description.listeners.input();
  description.listeners.keydown({ key: 'Enter', shiftKey: false, preventDefault() {} });
  await page.settle();
  assert.equal(applied.hidden, false, 'Applied appears only after preview recovery');
  assert.equal(page.nodes.get('invoice-print').disabled, false);
});

test('extra lines stay in the target currency when time is converted and survive reopening', async () => {
  const page = await loaded(result([record('alice')], { alice: { amountMinorPerHour: 12000, currency: 'EUR' } }));
  await page.fire('create-invoice'); await page.settle(); await page.fire('invoice-add-line');
  const row = page.nodes.get('invoice-extra-lines').children[0], description = row.children[0].children[0], amount = row.children[1].children[0];
  description.value = 'Charge'; description.listeners.change(); amount.value = '25.50'; amount.listeners.change(); await page.settle();
  page.nodes.get('invoice-currency').value = 'USD'; await page.fire('invoice-currency', 'change'); await page.settle();
  assert.equal(page.requests.at(-1).message.type, 'GET_EXCHANGE_RATES');
  await page.reply({ rates: { [oldRange.startDate]: { EUR: 2 } } });
  assert.match(page.textOf(page.nodes.get('invoice-preview')), /Charge25.50 USDSubtotal265.50 USDVAT 20%53.10 USDTotal318.60 USD/);
  await page.fire('invoice-close'); await page.fire('create-invoice'); await page.settle();
  assert.equal(page.nodes.get('invoice-extra-lines').children[0].children[1].children[0].value, '25.50');
});

test('an open invoice blocks printing during a period reload and ignores stale reservations', async () => {
  const response = result([record('alice')], { alice: { amountMinorPerHour: 12000, currency: 'EUR' } });
  const page = await loaded(response); await page.fire('create-invoice'); await page.settle();
  const printing = page.fire('invoice-print'), reserve = page.requests.at(-1), loading = page.load(newRange), load = page.requests.at(-1);
  assert.equal(page.nodes.get('invoice-print').disabled, true);
  await page.reply({ sequence: 7 }, reserve); await printing;
  assert.equal(page.prints.length, 0); assert.equal(page.nodes.get('invoice-print').disabled, true);
  await page.reply(response, load); await loading; await page.settle();
  assert.equal(page.nodes.get('invoice-print').disabled, false);
  assert.equal(page.nodes.get('invoice-billing-period').textContent, 'Billing 2026-08-24 to 2026-08-30');
});


test('calendar range uses inputs, rolls earlier ends into starts and applies only a complete range', async () => {
  const page = await loaded(); page.fire('period-trigger');
  assert.equal(page.nodes.get('period-trigger').attributes['aria-expanded'], 'true');
  const pendingCount = page.requests.length;
  page.context.selectCalendarDay('2026-08-20');
  assert.equal(page.nodes.get('start-date').value, '2026-08-20'); assert.equal(page.nodes.get('end-date').value, '');
  assert.equal(page.requests.slice(pendingCount).some(request => request.message.type === 'LOAD_REPORT'), false);
  page.context.selectCalendarDay('2026-08-18');
  assert.equal(page.nodes.get('start-date').value, '2026-08-18'); assert.equal(page.nodes.get('end-date').value, '');
  page.context.selectCalendarDay('2026-08-22'); await page.settle();
  assert.equal(page.nodes.get('end-date').value, '2026-08-22'); assert.equal(page.nodes.get('period-popover').hidden, true);
  assert.equal(page.requests.at(-1).message.payload.endDate, '2026-08-22'); await page.reply(result());
  assert.equal(page.nodes.get('period-label').textContent, 'Aug 18, 2026 – Aug 22, 2026');
  page.fire('period-trigger');
  const days = () => page.nodes.get('calendar-grid').children.flatMap(row => row.children).map(cell => cell.children[0]);
  assert.equal(days().filter(day => day.tabIndex === 0).length, 1);
  assert.equal(days().find(day => day.dataset.date === '2026-08-19').classList.contains('in-range'), true);
  const start = page.nodes.get('start-date').value, end = page.nodes.get('end-date').value;
  page.fire('calendar-next'); assert.equal(page.nodes.get('calendar-month').textContent, 'September 2026');
  assert.equal(page.nodes.get('start-date').value, start); assert.equal(page.nodes.get('end-date').value, end);
  const last = days().find(day => day.dataset.date === '2026-09-30');
  last.listeners.keydown({ key: 'ArrowRight', preventDefault() {} });
  assert.equal(page.document.activeElement.dataset.date, '2026-10-01');
  assert.equal(days().filter(day => day.tabIndex === 0).length, 1);
  page.document.activeElement.listeners.keydown({ key: ' ', preventDefault() {} });
  assert.equal(page.nodes.get('start-date').value, '2026-10-01'); assert.equal(page.nodes.get('end-date').value, '');
  page.nodes.get('end-date').value = '2026-10-04'; page.fire('end-date', 'change'); await page.settle();
  assert.equal(page.requests.at(-1).message.payload.endDate, '2026-10-04');
});

test('picker closes on Escape and outside clicks, retains inside clicks and marks every preset', async () => {
  const page = await loaded(); page.fire('period-trigger');
  page.document.listeners.click({ target: page.nodes.get('period-popover') }); assert.equal(page.nodes.get('period-popover').hidden, false);
  page.document.listeners.keydown({ key: 'Escape', preventDefault() {} });
  assert.equal(page.nodes.get('period-popover').hidden, true); assert.equal(page.document.activeElement, page.nodes.get('period-trigger'));
  page.fire('period-trigger'); page.document.listeners.click({ target: page.document.body });
  assert.equal(page.nodes.get('period-trigger').attributes['aria-expanded'], 'false');
  for (const preset of ['today', 'yesterday', 'last-7-days', 'last-30-days', 'this-week', 'last-week', 'this-month', 'last-month', 'this-quarter', 'last-quarter', 'this-year', 'last-year']) {
    page.fire('period-trigger'); page.fire(`preset-${preset}`); await page.settle(); await page.reply(result());
    assert.equal(page.nodes.get('period-popover').hidden, true);
    assert.equal(page.nodes.get(`preset-${preset}`).attributes['aria-current'], 'true');
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const range = reporting.periodRange(preset, today);
    const format = value => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));
    assert.equal(page.nodes.get('period-label').textContent, `${format(range.startDate)} – ${format(range.endDate)}`);
  }
});

test('UTC preference loads before reports, projects dates for billing and persists switch changes', async () => {
  const page = harness({ reportingUtc: true, revision: 5 }); await page.settle();
  assert.equal(page.requests.at(-1).message.payload.reportingUtc, true);
  const data = result([{ ...record('alice'), entryDate: '2026-09-01', startedAt: '2026-08-31T22:30:00Z' }]);
  await page.reply(data);
  assert.equal(page.nodes.get('reporting-utc').checked, true);
  assert.match(page.textOf(page.nodes.get('print-detail-table')), /2026-08-31/);
  page.nodes.get('reporting-utc').checked = false; page.fire('reporting-utc', 'change'); await page.settle();
  assert.equal(page.requests.at(-1).message.type, 'UPDATE_DISPLAY_PREFERENCES');
  assert.equal(page.requests.at(-1).message.payload.reportingUtc, false);
  assert.equal(page.requests.at(-1).message.expectedRevision, 5);
  await page.reply({ revision: 6, preferences: { reportingUtc: false, revision: 6 } });
  assert.equal(vm.runInContext('state.settingsRevision', page.context), 6);
  assert.equal(page.requests.at(-1).message.type, 'LOAD_REPORT'); assert.equal(page.requests.at(-1).message.payload.reportingUtc, false);
});


test('failed UTC persistence preserves the current report and restores the switch', async () => {
  const page = await loaded(); page.fire('period-trigger');
  page.nodes.get('reporting-utc').checked = true; page.fire('reporting-utc', 'change'); await page.settle();
  const requestCount = page.requests.length; await page.reply(new Error('Storage unavailable'));
  assert.equal(page.nodes.get('reporting-utc').checked, false); assert.equal(page.nodes.get('reporting-utc').disabled, false);
  assert.equal(page.nodes.get('summary-time').textContent, '1h 0m'); assert.equal(page.requests.length, requestCount);
  assert.equal(page.nodes.get('error').children[0].textContent, 'Storage unavailable');
});

test('UTC changes reload the applied report while an incomplete calendar range remains editable', async () => {
  const page = await loaded(); page.fire('period-trigger'); page.context.selectCalendarDay('2026-08-20');
  page.nodes.get('reporting-utc').checked = true; page.fire('reporting-utc', 'change'); await page.settle();
  await page.reply({ preferences: { reportingUtc: true } });
  assert.equal(page.requests.at(-1).message.type, 'LOAD_REPORT');
  assert.equal(page.requests.at(-1).message.payload.startDate, oldRange.startDate);
  assert.equal(page.requests.at(-1).message.payload.reportingUtc, true);
  await page.reply(result());
  assert.equal(page.nodes.get('period-popover').hidden, false);
  assert.equal(page.nodes.get('start-date').value, '2026-08-20'); assert.equal(page.nodes.get('end-date').value, '');
});
