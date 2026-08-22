import {
  buildAnalytics, buildFacets, exportTimesheet, filterReportRecords, formatClockDuration,
  periodRange, reportFilename, taskSource,
} from '../domain/reporting.js';
import { billableMinorTotal, rateMinorForUser } from '../domain/local-settings.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const $ = id => document.getElementById(id);
const state = {
  records: [], range: null, sourceRepository: '', branch: '', billing: { currency: 'USD', rates: {} }, loading: false, requestId: 0, analytics: null,
  people: new Set(), repositories: new Set(), peopleSearch: '', repositoriesSearch: '',
};

function send(message) {
  return new Promise((resolve, reject) => chrome.runtime.sendMessage(message, response => {
    if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
    if (!response?.ok) return reject(Object.assign(new Error(response?.error?.message || 'Extension request failed'), response?.error));
    resolve(response.data);
  }));
}

function localDateValue(date = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function setError(error = '') {
  const root = $('error'), text = error?.message || String(error || '');
  root.replaceChildren(document.createTextNode(text));
  const recovery = globalThis.RepoClockRecovery.actionFor(error?.code), label = recovery?.label || '';
  if (label) {
    const action = document.createElement('button'); action.type = 'button'; action.className = 'button secondary'; action.textContent = label;
    action.addEventListener('click', () => { if (recovery.kind === 'retry') void loadRange(state.range || currentRange()); else void send({ type: 'OPEN_OPTIONS' }); });
    root.append(document.createTextNode(' '), action);
  }
  root.hidden = !text;
}

function svg(tag, attributes = {}, text = '') {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  if (text) node.textContent = text;
  return node;
}

const METRIC_LABELS = { 'total-time': 'Total time', 'avg-time': 'Avg time', 'task-count': 'Task count', 'billable-amount': 'Billable amount' };
const AXIS_LABELS = { day: 'Day', week: 'Week', month: 'Month', person: 'Person', repository: 'Repository', task: 'Task' };

function formatMoney(minor, currency = state.billing.currency) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format((Number(minor) || 0) / 100);
}

function formatMetricValue(value, metric, { tooltip = false } = {}) {
  if (metric === 'billable-amount') return formatMoney(value);
  if (metric === 'task-count') {
    const count = Math.round(value);
    return tooltip ? `${count} ${count === 1 ? 'task' : 'tasks'}` : String(count);
  }
  return formatClockDuration(value);
}

function setDownloadsAvailable(available) {
  for (const id of ['download-csv', 'download-json', 'download-pdf']) {
    $(id).classList.toggle('disabled', !available);
    $(id).setAttribute('aria-disabled', String(!available));
  }
}

function selectedFilters() {
  return { people: [...state.people], repositories: [...state.repositories], emptyMeansNone: true };
}

const DATA_COLOR_TOKENS = [
  '--data-blue-color-emphasis', '--data-green-color-emphasis', '--data-purple-color-emphasis',
  '--data-orange-color-emphasis', '--data-pink-color-emphasis', '--data-teal-color-emphasis',
  '--data-red-color-emphasis', '--data-yellow-color-emphasis', '--data-coral-color-emphasis',
  '--data-lime-color-emphasis', '--data-auburn-color-emphasis', '--data-gray-color-emphasis',
];

function colorMap(series) {
  return new Map(series.map((item, index) => [
    item.key,
    `var(${DATA_COLOR_TOKENS[index % DATA_COLOR_TOKENS.length]})`,
  ]));
}

function renderFacet(container, options, selected, query, rerender) {
  const focusedValue = container.contains(document.activeElement) ? document.activeElement.value : null;
  let restoreFocus = null;
  container.replaceChildren();
  const visible = options.filter(option => option.value.toLowerCase().includes(query.toLowerCase()));
  if (!visible.length) { const empty = document.createElement('div'); empty.className = 'empty-facet'; empty.textContent = 'No matching values'; container.append(empty); return; }
  for (const option of visible) {
    const label = document.createElement('label'); label.className = 'facet-option'; label.title = `${option.value} — ${formatClockDuration(option.seconds)} tracked · ${option.count} ${option.count === 1 ? 'entry' : 'entries'}`;
    const input = document.createElement('input'); input.type = 'checkbox'; input.value = option.value; input.checked = selected.has(option.value);
    if (option.value === focusedValue) restoreFocus = input;
    input.addEventListener('change', () => {
      if (input.checked) selected.add(option.value);
      else selected.delete(option.value);
      rerender();
    });
    const name = document.createElement('span'); name.className = 'facet-name'; name.textContent = option.value;
    const count = document.createElement('span'); count.className = 'facet-count'; count.textContent = `${formatClockDuration(option.seconds)} · ${option.count}`;
    label.append(input, name, count); container.append(label);
  }
  restoreFocus?.focus({ preventScroll: true });
}

function renderSummary(filtered) {
  const total = filtered.reduce((sum, record) => sum + (Number(record.durationSeconds) || 0), 0);
  $('summary-time').textContent = formatClockDuration(total);
  $('summary-money').textContent = formatMoney(billableMinorTotal(filtered, state.billing.rates));
  $('summary-entries').textContent = String(filtered.length);
  $('summary-people').textContent = String(new Set(filtered.map(record => record.user)).size);
  $('summary-repositories').textContent = String(new Set(filtered.map(record => taskSource(record))).size);
  const missingRates = [...new Set(filtered.map(record => record.user).filter(user => rateMinorForUser(user, state.billing.rates) === null))];
  $('filtered-summary').textContent = `${filtered.length} ${filtered.length === 1 ? 'entry' : 'entries'} · ${formatClockDuration(total)} · ${formatMoney(billableMinorTotal(filtered, state.billing.rates))}${missingRates.length ? ` · No rate for ${missingRates.join(', ')}` : ''}`;
}

function renderAnalyticsTable(analytics) {
  const table = $('analytics-table');
  table.replaceChildren();
  if (!$('analytics-details').open) return;
  const metricLabel = analytics.metric === 'avg-time' ? 'Avg time contribution' : METRIC_LABELS[analytics.metric];
  const head = document.createElement('thead'), headRow = document.createElement('tr');
  for (const label of [AXIS_LABELS[analytics.horizontalAxis], AXIS_LABELS[analytics.stackBy], metricLabel, 'Bucket total']) {
    const th = document.createElement('th'); th.scope = 'col'; th.textContent = label; headRow.append(th);
  }
  head.append(headRow); table.append(head);
  const body = document.createElement('tbody');
  for (const bucket of analytics.buckets) {
    for (const segment of bucket.segments) {
      const row = document.createElement('tr');
      for (const value of [bucket.label, segment.label, formatMetricValue(segment.value, analytics.metric), formatMetricValue(bucket.totalValue, analytics.metric)]) {
        const td = document.createElement('td'); td.textContent = value; row.append(td);
      }
      body.append(row);
    }
  }
  table.append(body);
}

function renderChart(analytics) {
  const container = $('analytics-chart'), legend = $('chart-legend');
  container.replaceChildren(); legend.replaceChildren(); renderAnalyticsTable(analytics);
  if (!analytics.buckets.length) {
    const empty = document.createElement('div'); empty.className = 'chart-empty'; empty.textContent = 'No data matches these filters.'; container.append(empty); return;
  }
  const width = Math.max(320, analytics.buckets.length * 92 + 100), height = 400;
  const margin = { top: 24, right: 20, bottom: 104, left: 66 }, plotWidth = width - margin.left - margin.right, plotHeight = height - margin.top - margin.bottom;
  const metricLabel = METRIC_LABELS[analytics.metric];
  const chart = svg('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': `Stacked bar chart of ${metricLabel.toLowerCase()}` });
  const colors = colorMap(analytics.series);
  const countStep = analytics.metric === 'task-count' ? Math.max(1, Math.ceil(analytics.maxValue / 4)) : null;
  const maximum = countStep ? countStep * 4 : analytics.maxValue || 1;
  for (let step = 0; step <= 4; step += 1) {
    const y = margin.top + plotHeight - plotHeight * step / 4, value = maximum * step / 4;
    chart.append(svg('line', { x1: margin.left, y1: y, x2: width - margin.right, y2: y, class: 'grid-line' }));
    chart.append(svg('text', { x: margin.left - 10, y: y + 4, 'text-anchor': 'end', class: 'grid-label' }, formatMetricValue(value, analytics.metric)));
  }
  const slot = plotWidth / analytics.buckets.length, barWidth = Math.min(58, slot * .68);
  analytics.buckets.forEach((bucket, index) => {
    const x = margin.left + slot * index + (slot - barWidth) / 2; let yBottom = margin.top + plotHeight;
    for (const segment of bucket.segments) {
      const segmentHeight = plotHeight * segment.value / maximum; yBottom -= segmentHeight;
      const formatted = formatMetricValue(segment.value, analytics.metric, { tooltip: true });
      const detail = analytics.metric === 'avg-time' ? `${formatted} contribution (${formatClockDuration(segment.averageValue)} stack average)` : formatted;
      const rect = svg('rect', { x, y: yBottom, width: barWidth, height: Math.max(0, segmentHeight), fill: colors.get(segment.key), class: 'bar-segment', tabindex: '0', 'aria-label': `${bucket.label}, ${segment.label}: ${detail}` });
      rect.append(svg('title', {}, `${bucket.label}
${segment.label}
${detail}`)); chart.append(rect);
    }
    const labelY = height - margin.bottom + 24;
    chart.append(svg('text', { x: x + barWidth / 2, y: labelY, 'text-anchor': 'end', transform: `rotate(-28 ${x + barWidth / 2} ${labelY})`, class: 'axis-label' }, bucket.label));
  });
  container.append(chart);
  for (const item of analytics.series) {
    const node = document.createElement('span'); node.className = 'legend-item';
    const swatch = document.createElement('span'); swatch.className = 'legend-swatch'; swatch.style.backgroundColor = colors.get(item.key);
    const label = document.createElement('span'); label.textContent = item.label; node.append(swatch, label); legend.append(node);
  }
}

function render() {
  if (!state.range) return;
  const facets = buildFacets(state.records, selectedFilters());
  renderFacet($('people-facet'), facets.people, state.people, state.peopleSearch, render);
  renderFacet($('repositories-facet'), facets.repositories, state.repositories, state.repositoriesSearch, render);
  const allPeople = [...new Set(state.records.map(record => record.user))];
  const allRepositories = [...new Set(state.records.map(record => taskSource(record)))];
  $('people-all').textContent = allPeople.length && allPeople.every(value => state.people.has(value)) ? 'Unselect all' : 'Select all';
  $('repositories-all').textContent = allRepositories.length && allRepositories.every(value => state.repositories.has(value)) ? 'Unselect all' : 'Select all';
  const filtered = filterReportRecords(state.records, selectedFilters());
  renderSummary(filtered);
  state.analytics = buildAnalytics(filtered, {
    metric: $('metric').value,
    horizontalAxis: $('horizontal-axis').value,
    stackBy: $('stack-by').value,
    rates: state.billing.rates,
  });
  renderChart(state.analytics);
  setDownloadsAvailable(Boolean(filtered.length));
}

async function loadRange(range) {
  const requestId = ++state.requestId;
  state.range = range; state.loading = true; setError();
  $('loading').hidden = false; $('setup').hidden = true; $('report-content').hidden = true;
  try {
    const result = await send({ type: 'LOAD_REPORT', payload: { startDate: range.startDate, endDate: range.endDate } });
    if (requestId !== state.requestId) return;
    if (!result.configured) { $('setup').hidden = false; return; }
    state.records = result.records; state.sourceRepository = result.sourceRepository; state.branch = result.branch;
    state.billing = { currency: result.billing?.currency || 'USD', rates: result.billing?.rates || {} };
    state.people = new Set(result.records.map(record => record.user));
    state.repositories = new Set(result.records.map(record => taskSource(record)));
    $('report-content').hidden = false; render();
  } catch (error) { if (requestId === state.requestId) setError(error); }
  finally { if (requestId === state.requestId) { state.loading = false; $('loading').hidden = true; } }
}

function currentRange() {
  const preset = $('period').value;
  return periodRange(preset, localDateValue(), { startDate: $('start-date').value, endDate: $('end-date').value });
}

async function applyPeriod() {
  try { await loadRange(currentRange()); }
  catch (error) { setError(error); }
}

$('period').addEventListener('change', () => {
  const custom = $('period').value === 'custom'; $('custom-period').hidden = !custom;
  if (custom) {
    state.requestId += 1; state.loading = false; state.range = null;
    void send({ type: 'CANCEL_REPORT' }).catch(() => {});
    $('loading').hidden = true; $('report-content').hidden = true; setDownloadsAvailable(false);
  } else void applyPeriod();
});
$('apply-period').addEventListener('click', () => void applyPeriod());
for (const id of ['metric', 'horizontal-axis', 'stack-by']) $(id).addEventListener('change', render);
$('analytics-details').addEventListener('toggle', () => { if (state.analytics) renderAnalyticsTable(state.analytics); });
$('people-search').addEventListener('input', event => { state.peopleSearch = event.target.value; render(); });
$('repositories-search').addEventListener('input', event => { state.repositoriesSearch = event.target.value; render(); });
$('people-all').addEventListener('click', () => {
  const values = [...new Set(state.records.map(record => record.user))];
  state.people = values.length && values.every(value => state.people.has(value)) ? new Set() : new Set(values); render();
});
$('repositories-all').addEventListener('click', () => {
  const values = [...new Set(state.records.map(record => taskSource(record)))];
  state.repositories = values.length && values.every(value => state.repositories.has(value)) ? new Set() : new Set(values); render();
});
$('setup-settings').addEventListener('click', () => send({ type: 'OPEN_OPTIONS' }));
function downloadTimesheet(format, event) {
  event.preventDefault();
  const filtered = filterReportRecords(state.records, selectedFilters());
  if (!state.range || !filtered.length) return;
  const content = exportTimesheet(filtered, {
    format, startDate: state.range.startDate, endDate: state.range.endDate,
    rates: state.billing.rates, currency: state.billing.currency,
  });
  const type = format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8';
  const url = URL.createObjectURL(new Blob([content], { type })), anchor = document.createElement('a');
  anchor.href = url; anchor.download = reportFilename(format, state.range.startDate, state.range.endDate); anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
$('download-csv').addEventListener('click', event => downloadTimesheet('csv', event));
$('download-json').addEventListener('click', event => downloadTimesheet('json', event));
$('download-pdf').addEventListener('click', event => { event.preventDefault(); if (!$('download-pdf').classList.contains('disabled')) window.print(); });

const colorScheme = matchMedia('(prefers-color-scheme: dark)');
colorScheme.addEventListener('change', () => {
  if (state.range && !state.loading && !$('report-content').hidden) render();
});

const initial = periodRange('this-week', localDateValue());
$('start-date').value = initial.startDate; $('end-date').value = initial.endDate;
void loadRange(initial);
