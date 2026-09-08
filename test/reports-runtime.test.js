import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as reporting from '../src/domain/reporting.js';
import * as billing from '../src/domain/local-settings.js';

const html = fs.readFileSync(new URL('../src/reports/reports.html', import.meta.url), 'utf8');
const source = fs.readFileSync(new URL('../src/reports/reports.js', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../src/reports/reports.css', import.meta.url), 'utf8');
const oldRange = { startDate: '2026-08-17', endDate: '2026-08-23' };
const newRange = { startDate: '2026-08-24', endDate: '2026-08-30' };
const record = (user, host = 'example.com', date = oldRange.startDate) => ({
  user, taskUrl: `https://${host}/task`, taskTitle: 'Review', entryDate: date,
  startedAt: `${date}T09:00:00Z`, endedAt: `${date}T10:00:00Z`, durationSeconds: 3600,
});
const result = (records = [record('alice'), record('bob', 'other.com')], rates = {}) => ({
  configured: true, currentUser: 'alice', records,
  billing: { rates, projects: [{ name: 'Main', substrings: ['https://example.com/'] }, { name: 'Other', substrings: ['https://other.com/'] }] },
});

function harness() {
  const document = { activeElement: null, title: 'Reports' };
  class Node {
    constructor(tag = 'div') {
      this.tagName = tag; this.children = []; this.listeners = {}; this.attributes = {}; this.dataset = {}; this.style = {};
      this.hidden = false; this.open = false; this.value = ''; this.textContent = ''; this.className = '';
      this.classList = {
        toggle: (name, force) => { const classes = new Set(this.className.split(' ').filter(Boolean)); if (force) classes.add(name); else classes.delete(name); this.className = [...classes].join(' '); },
        contains: name => this.className.split(' ').includes(name),
      };
    }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(name, value) { this.attributes[name] = value; }
    removeAttribute(name) { delete this.attributes[name]; }
    contains(node) { return this === node || this.children.some(child => child.contains?.(node)); }
    addEventListener(type, handler) { this.listeners[type] = handler; }
    focus() { document.activeElement = this; }
    click() { downloads.push(this); }
    get selectedOptions() { return this.children.filter(node => node.value === this.value); }
  }
  const nodes = new Map([...html.matchAll(/<([\w-]+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)].map(([, tag, attrs, id]) => {
    const node = new Node(tag); node.hidden = /\bhidden\b/.test(attrs); return [id, node];
  }));
  for (const [id, value] of Object.entries({ period: 'last-week', metric: 'total-time', 'horizontal-axis': 'day', 'stack-by': 'person' })) nodes.get(id).value = value;
  document.getElementById = id => nodes.get(id); document.createElement = tag => new Node(tag);
  document.createElementNS = (_, tag) => new Node(tag); document.createTextNode = text => ({ textContent: text });
  const requests = [], downloads = [], prints = [], listeners = [], blobs = [];
  const context = vm.createContext({
    ...reporting, ...billing, document, Blob, URL: { createObjectURL: blob => { blobs.push(blob); return 'blob:test'; }, revokeObjectURL() {} },
    setTimeout: () => 1, addEventListener() {}, window: { print: () => prints.push(document.title) },
    matchMedia: () => ({ addEventListener() {} }), mountRunningStatus() {}, ClockoliRecovery: { actionFor: () => null },
    chrome: { runtime: { onMessage: { addListener: handler => listeners.push(handler) }, sendMessage(message, callback) { requests.push({ message, callback }); } } },
  });
  vm.runInContext(source.replace(/^import[\s\S]*?from '[^']+';\n/gm, ''), context);
  const settle = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };
  const reply = async (data, request = requests.at(-1)) => { request.callback(data instanceof Error ? { ok: false, error: { message: data.message } } : { ok: true, data }); await settle(); };
  const fire = (id, type = 'click') => nodes.get(id).listeners[type]({ preventDefault() {}, target: nodes.get(id) });
  return { nodes, context, requests, downloads, prints, listeners, blobs, reply, settle, fire,
    select: (key, value, checked) => {
      const input = nodes.get(`${key}-facet`).children.flatMap(label => label.children).find(node => node.value === value);
      assert.ok(input, `visible ${key} checkbox ${value}`);
      input.checked = checked; input.listeners.change();
    },
    load: range => context.loadRange(range),
    selection: key => vm.runInContext(`[...state.${key}].sort().join(',')`, context),
  };
}

async function loaded(data = result()) {
  const page = harness();
  await page.reply(data);
  const load = page.load(oldRange); await page.reply(data); await load;
  return page;
}

test('period, exports, and chart controls use the compact always-visible layout', () => {
  const period = html.match(/<section\b[^>]*class="card period-card"[\s\S]*?<\/section>/)?.[0] || '';
  for (const id of ['download-csv', 'download-json', 'download-pdf']) assert.ok(period.includes(`id="${id}"`), id);
  assert.doesNotMatch(html, /export-card|summary-grid|summary-card/);
  assert.doesNotMatch(html, /<h2[^>]*>Analytics<\/h2>|<summary>Chart options<\/summary>|Tracked time/);
  assert.match(html, /class="period-select"[\s\S]*?<span>Period<\/span>[\s\S]*?id="period"/);
  assert.ok(period.indexOf('id="period"') < period.indexOf('id="report-range"'));
  const chart = html.match(/<section id="analytics-card"[\s\S]*?<\/section>/)?.[0] || '';
  assert.ok(chart.indexOf('id="metric"') < chart.indexOf('id="analytics-chart"'));
  assert.ok(chart.indexOf('id="stack-by"') < chart.indexOf('id="analytics-chart"'));
  assert.ok(chart.indexOf('id="horizontal-axis"') > chart.indexOf('id="analytics-chart"'));
  assert.match(styles, /@media\(max-width:640px\)[\s\S]*\.chart-top-controls\{display:grid;grid-template-columns:minmax\(0,1fr\)/);
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
  assert.equal(page.nodes.get('report-range')?.textContent, 'Showing 2026-08-17 — 2026-08-23 · loading 2026-08-24 — 2026-08-30…');
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
  assert.equal(page.nodes.get('report-range').textContent, 'Showing 2026-08-24 — 2026-08-30');
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
  const page = harness(); await page.reply({ configured: false });
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
  assert.equal(page.nodes.get('report-range')?.textContent, 'Showing 2026-08-17 — 2026-08-23');
  assert.equal(page.nodes.get('print-period').textContent, '2026-08-17 — 2026-08-23');
  assert.equal(page.nodes.get('error').children[0].textContent, 'Offline');
});

test('custom-period editing cancels pending work without clearing the displayed report', async () => {
  const page = await loaded();
  const pending = page.load(newRange), stale = page.requests.at(-1);
  page.nodes.get('period').value = 'custom'; page.fire('period', 'change');
  assert.equal(page.requests.at(-1).message.type, 'CANCEL_REPORT');
  assert.equal(page.nodes.get('report-content').hidden, false);
  assert.equal(page.nodes.get('report-range')?.textContent, 'Showing 2026-08-17 — 2026-08-23');
  await page.reply(result(), stale); await pending;
  assert.equal(page.nodes.get('print-period').textContent, '2026-08-17 — 2026-08-23');
});
