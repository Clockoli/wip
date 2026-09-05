import { mountRunningStatus } from '../ui/running-status.js';
import {
  buildAnalytics, buildFacets, buildPrintableTimesheet, exportTimesheet, filterReportRecords, formatClockDuration,
  periodRange, reportFilename, reportPdfTitle, taskSource,
} from '../domain/reporting.js';
import { billableTotalsByCurrency, exchangeCurrencyCode, rateForUser } from '../domain/local-settings.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const FACET_KEYS = ['people', 'projects', 'repositories'];
const $ = id => document.getElementById(id);
const state = {
  records: [], range: null, pendingRange: null, sourceRepository: '', branch: '', billing: { rates: {} }, loading: false, requestId: 0, analytics: null,
  people: new Set(), projects: new Set(), repositories: new Set(), projectDefinitions: [], peopleSearch: '', projectsSearch: '', repositoriesSearch: '',
  allSelected: { people: false, projects: true, repositories: true },
  exchangeRates: null, exchangeKey: '', analyticsRequestId: 0, progressRequestId: null, progressValue: 0,
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

function showProgress(label, value = null, detail = 'This can take a moment for larger repositories.') {
  $('loading-label').textContent = label;
  $('loading-detail').textContent = detail;
  if (value === null && state.progressValue === 0) $('loading-progress').removeAttribute('value');
  else if (value !== null) {
    state.progressValue = Math.max(state.progressValue, Math.max(0, Math.min(100, Number(value) || 0)));
    $('loading-progress').value = state.progressValue;
  }
  $('loading').hidden = false;
}

function hideProgress() { $('loading').hidden = true; }

function setError(error = '') {
  const root = $('error'), text = error?.message || String(error || '');
  root.replaceChildren(document.createTextNode(text));
  const recovery = globalThis.ClockoliRecovery.actionFor(error?.code), label = recovery?.label || '';
  if (label) {
    const action = document.createElement('button'); action.type = 'button'; action.className = 'button secondary'; action.textContent = label;
    action.addEventListener('click', () => { if (recovery.kind === 'retry') void applyPeriod(); else void send({ type: 'OPEN_OPTIONS' }); });
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
const AXIS_LABELS = { day: 'Day', week: 'Week', month: 'Month', person: 'Person', repository: 'Source', task: 'Task URL / title' };

function currencyPosition(currency) {
  return $('billable-currency').selectedOptions[0]?.dataset.position
    || (String(currency).length === 1 ? 'prefix' : 'suffix');
}

function formatMoney(minor, currency = $('billable-currency').value, position = currencyPosition(currency)) {
  const amount = (Math.round(Number(minor) || 0) / 100).toFixed(2);
  if (!currency) return amount;
  const separator = String(currency).length === 1 ? '' : ' ';
  return position === 'prefix' ? `${currency}${separator}${amount}` : `${amount}${separator}${currency}`;
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
  available = available && !state.loading;
  for (const id of ['download-csv', 'download-json', 'download-pdf']) {
    $(id).classList.toggle('disabled', !available);
    $(id).setAttribute('aria-disabled', String(!available));
  }
}

function selectedFilters() {
  return { people: [...state.people], projects: [...state.projects], repositories: [...state.repositories], projectDefinitions: state.projectDefinitions, emptyMeansNone: true };
}

function updateSelectionIntent(key) {
  const values = buildFacets(state.records, { projectDefinitions: state.projectDefinitions })[key];
  state.allSelected[key] = values.length > 0 && values.every(option => state[key].has(option.value));
  render();
}

function reconcileSelections(available, keys = FACET_KEYS) {
  // Empty periods carry no information about the user's selection intent.
  if (!state.records.length) return;
  for (const key of keys) {
    const values = new Set(available[key].map(option => option.value));
    state[key] = state.allSelected[key] ? values : new Set([...state[key]].filter(value => values.has(value)));
  }
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

function billableSummary(totals) {
  return totals.length ? totals.map(item => formatMoney(item.amountMinor, item.currency, item.currencyPosition)).join(' + ') : 'Unrated';
}

function renderCurrencySelector(filtered) {
  const select = $('billable-currency'), selected = select.value;
  const totals = billableTotalsByCurrency(filtered, state.billing.rates);
  select.replaceChildren();
  for (const item of totals) {
    const option = document.createElement('option'); option.value = item.currency; option.textContent = item.currency;
    option.dataset.position = item.currencyPosition; select.append(option);
  }
  if (totals.some(item => item.currency === selected)) select.value = selected;
  $('billable-currency-control').hidden = $('metric').value !== 'billable-amount' || totals.length < 2;
  return totals;
}

function renderSummary(filtered, totals) {
  const total = filtered.reduce((sum, record) => sum + (Number(record.durationSeconds) || 0), 0);
  $('summary-time').textContent = formatClockDuration(total);
  $('summary-billable').hidden = !Object.keys(state.billing.rates).some(user => rateForUser(user, state.billing.rates));
  const missingRates = [...new Set(filtered.filter(record => !rateForUser(record.user, state.billing.rates, record.entryDate || record.startedAt.slice(0, 10))).map(record => record.user))];
  $('summary-money').textContent = `${billableSummary(totals)}${missingRates.length ? ` · No rate for ${missingRates.join(', ')}` : ''}`;
  const people = new Set(filtered.map(record => record.user)).size;
  const sources = new Set(filtered.map(record => taskSource(record))).size;
  $('summary-counts').textContent = `${filtered.length} ${filtered.length === 1 ? 'entry' : 'entries'} · ${people} ${people === 1 ? 'person' : 'people'} · ${sources} ${sources === 1 ? 'source' : 'sources'}`;
}

function rangeLabel(range) { return `${range.startDate} — ${range.endDate}`; }

function renderRangeContext() {
  $('report-range').textContent = state.range
    ? `Showing ${rangeLabel(state.range)}${state.pendingRange ? ` · loading ${rangeLabel(state.pendingRange)}…` : ''}` : '';
}

function renderEmptyState(filtered) {
  const emptyPeriod = !state.records.length;
  $('report-empty').hidden = Boolean(filtered.length);
  $('empty-message').textContent = emptyPeriod ? `No time in ${rangeLabel(state.range)}.` : 'Filters hide all entries.';
  $('add-time').hidden = !emptyPeriod;
  $('reset-filters').hidden = emptyPeriod;
  $('reports-layout').hidden = emptyPeriod;
  $('analytics-card').hidden = !filtered.length;
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

function renderPrintTable(id, columns, rows) {
  const table = $(id); table.replaceChildren();
  const head = document.createElement('thead'), headRow = document.createElement('tr');
  for (const [label] of columns) { const th = document.createElement('th'); th.scope = 'col'; th.textContent = label; headRow.append(th); }
  head.append(headRow); table.append(head);
  const body = document.createElement('tbody');
  for (const item of rows) {
    const row = document.createElement('tr');
    for (const [, value] of columns) { const cell = document.createElement('td'); cell.textContent = value(item); row.append(cell); }
    body.append(row);
  }
  table.append(body);
}

function renderPrintableTimesheet(filtered) {
  const printable = buildPrintableTimesheet(filtered);
  $('print-period').textContent = `${state.range.startDate} — ${state.range.endDate}`;
  $('print-filters').textContent = `People: ${[...state.people].sort().join(', ')} · Projects: ${[...state.projects].sort().join(', ')}`;
  renderPrintTable('print-detail-table', [
    ['Date', row => row.date], ['Person', row => row.person], ['Task URL', row => row.taskUrl],
    ['Task title', row => row.taskTitle], ['Time', row => formatClockDuration(row.seconds)],
  ], printable.byDate);
  renderPrintTable('print-task-table', [
    ['Task URL', row => row.taskUrl], ['Task title', row => row.taskTitle], ['Total time', row => formatClockDuration(row.seconds)],
  ], printable.byTask);
}

function exchangeRequest(filtered, targetCurrency) {
  const datedRates = filtered.map(record => ({
    date: record.entryDate || String(record.startedAt || '').slice(0, 10),
    rate: rateForUser(record.user, state.billing.rates, record.entryDate || String(record.startedAt || '').slice(0, 10)),
  })).filter(item => item.rate);
  const dates = [...new Set(datedRates.map(item => item.date))].sort();
  const sourceCurrencies = [...new Set(datedRates.map(item => item.rate.currency))].sort();
  return { targetCurrency, sourceCurrencies, dates };
}

async function loadBillableAnalytics(filtered, request, key) {
  const analyticsRequestId = ++state.analyticsRequestId;
  const progressRequestId = `fx-${state.requestId}-${analyticsRequestId}`;
  state.progressRequestId = progressRequestId;
  showProgress('Loading exchange rates from Frankfurter…', 85, 'Historical rates are fetched in one bulk date-range request and cached locally.');
  try {
    const result = await send({ type: 'GET_EXCHANGE_RATES', payload: { ...request, requestId: progressRequestId } });
    if (analyticsRequestId !== state.analyticsRequestId || key !== JSON.stringify(exchangeRequest(filtered, $('billable-currency').value))) return;
    state.exchangeRates = result.rates; state.exchangeKey = key;
    render();
  } catch (error) {
    if (analyticsRequestId === state.analyticsRequestId) { state.exchangeRates = null; state.exchangeKey = ''; $('analytics-chart').replaceChildren(); setError(error); hideProgress(); }
  }
}

function render() {
  if (!state.range) return;
  const facets = buildFacets(state.records, selectedFilters());
  for (const key of FACET_KEYS) {
    renderFacet($(`${key}-facet`), facets[key], state[key], state[`${key}Search`], () => updateSelectionIntent(key));
  }
  const allPeople = [...new Set(state.records.map(record => record.user))];
  const allProjects = facets.projects.map(project => project.value);
  const allRepositories = [...new Set(state.records.map(record => taskSource(record)))];
  $('people-all').textContent = allPeople.length && allPeople.every(value => state.people.has(value)) ? 'Unselect all' : 'Select all';
  $('projects-all').textContent = allProjects.length && allProjects.every(value => state.projects.has(value)) ? 'Unselect all' : 'Select all';
  $('repositories-all').textContent = allRepositories.length && allRepositories.every(value => state.repositories.has(value)) ? 'Unselect all' : 'Select all';
  const filtered = filterReportRecords(state.records, selectedFilters());
  const billableTotals = renderCurrencySelector(filtered);
  renderSummary(filtered, billableTotals);
  renderEmptyState(filtered);
  renderPrintableTimesheet(filtered);
  setDownloadsAvailable(Boolean(filtered.length));
  if (!filtered.length) {
    state.analyticsRequestId += 1; state.analytics = null;
    $('analytics-chart').replaceChildren(); $('chart-legend').replaceChildren(); $('analytics-table').replaceChildren();
    if (!state.loading) hideProgress();
    return;
  }
  const metric = $('metric').value, targetCurrency = $('billable-currency').value;
  let exchangeRates = null;
  if (metric === 'billable-amount' && targetCurrency) {
    const request = exchangeRequest(filtered, targetCurrency), key = JSON.stringify(request);
    if (state.exchangeKey !== key) {
      if (state.loading) return;
      state.analytics = null; $('analytics-chart').replaceChildren(); void loadBillableAnalytics(filtered, request, key); return;
    }
    exchangeRates = state.exchangeRates;
  } else { state.analyticsRequestId += 1; state.exchangeRates = null; state.exchangeKey = ''; }
  state.analytics = buildAnalytics(filtered, {
    metric, horizontalAxis: $('horizontal-axis').value, stackBy: $('stack-by').value,
    rates: state.billing.rates, currency: targetCurrency, exchangeRates,
  });
  renderChart(state.analytics); setError();
  if (!state.loading) hideProgress();
}

async function loadRange(range) {
  const requestId = ++state.requestId;
  state.progressRequestId = requestId; state.progressValue = 0; state.pendingRange = range; state.loading = true; state.analyticsRequestId += 1; setError();
  setDownloadsAvailable(false); renderRangeContext();
  showProgress('Connecting to GitHub…', 10); $('setup').hidden = true;
  try {
    const result = await send({ type: 'LOAD_REPORT', payload: { startDate: range.startDate, endDate: range.endDate, requestId } });
    if (requestId !== state.requestId) return;
    if (!result.configured) {
      $('setup').hidden = false; $('period-card').hidden = true; $('report-content').hidden = true;
      state.range = null; state.records = []; return;
    }
    showProgress('Preparing report…', 80);
    const firstLoad = !state.range;
    state.range = range; state.pendingRange = null; state.loading = false; state.exchangeRates = null; state.exchangeKey = '';
    state.records = result.records; state.sourceRepository = result.sourceRepository; state.branch = result.branch;
    state.billing = { rates: result.billing?.rates || {} };
    state.projectDefinitions = result.billing?.projects || [];
    const available = buildFacets(result.records, { projectDefinitions: state.projectDefinitions });
    if (firstLoad) {
      state.allSelected = { people: false, projects: true, repositories: true };
      state.people = new Set(result.currentUser ? [result.currentUser] : []);
      state.projects = new Set(available.projects.map(project => project.value));
      state.repositories = new Set(available.repositories.map(repository => repository.value));
    } else {
      reconcileSelections(available);
    }
    $('period-card').hidden = false;
    $('report-content').hidden = false; render();
  } catch (error) { if (requestId === state.requestId) setError(error); }
  finally {
    if (requestId === state.requestId) {
      state.loading = false; state.pendingRange = null; renderRangeContext();
      setDownloadsAvailable(Boolean(state.range && filterReportRecords(state.records, selectedFilters()).length));
      if (state.progressRequestId === requestId) hideProgress();
    }
  }
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
    state.requestId += 1; state.analyticsRequestId += 1; state.loading = false; state.pendingRange = null; state.progressRequestId = null;
    void send({ type: 'CANCEL_REPORT' }).catch(() => {});
    hideProgress(); renderRangeContext();
    setDownloadsAvailable(Boolean(state.range && filterReportRecords(state.records, selectedFilters()).length));
  } else void applyPeriod();
});
$('apply-period').addEventListener('click', () => void applyPeriod());
for (const id of ['metric', 'billable-currency', 'horizontal-axis', 'stack-by']) $(id).addEventListener('change', render);
$('analytics-details').addEventListener('toggle', () => { if (state.analytics) renderAnalyticsTable(state.analytics); });
$('people-search').addEventListener('input', event => { state.peopleSearch = event.target.value; render(); });
$('projects-search').addEventListener('input', event => { state.projectsSearch = event.target.value; render(); });
$('repositories-search').addEventListener('input', event => { state.repositoriesSearch = event.target.value; render(); });
$('people-all').addEventListener('click', () => {
  const values = [...new Set(state.records.map(record => record.user))];
  state.people = values.length && values.every(value => state.people.has(value)) ? new Set() : new Set(values); updateSelectionIntent('people');
});
$('projects-all').addEventListener('click', () => {
  const values = buildFacets(state.records, { projectDefinitions: state.projectDefinitions }).projects.map(project => project.value);
  state.projects = values.length && values.every(value => state.projects.has(value)) ? new Set() : new Set(values); updateSelectionIntent('projects');
});
$('repositories-all').addEventListener('click', () => {
  const values = [...new Set(state.records.map(record => taskSource(record)))];
  state.repositories = values.length && values.every(value => state.repositories.has(value)) ? new Set() : new Set(values); updateSelectionIntent('repositories');
});
$('reset-filters').addEventListener('click', () => {
  const facets = buildFacets(state.records, { projectDefinitions: state.projectDefinitions });
  for (const key of FACET_KEYS) {
    state.allSelected[key] = true;
    state[key] = new Set(facets[key].map(option => option.value));
    state[`${key}Search`] = ''; $(`${key}-search`).value = '';
  }
  render();
});
$('setup-settings').addEventListener('click', () => send({ type: 'OPEN_OPTIONS' }));
function downloadTimesheet(format, event) {
  event.preventDefault();
  const filtered = filterReportRecords(state.records, selectedFilters());
  if (state.loading || !state.range || !filtered.length) return;
  const content = exportTimesheet(filtered, {
    format, startDate: state.range.startDate, endDate: state.range.endDate,
    rates: state.billing.rates,
  });
  const type = format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8';
  const url = URL.createObjectURL(new Blob([content], { type })), anchor = document.createElement('a');
  anchor.href = url; anchor.download = reportFilename(format, state.range.startDate, state.range.endDate); anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
$('download-csv').addEventListener('click', event => downloadTimesheet('csv', event));
$('download-json').addEventListener('click', event => downloadTimesheet('json', event));
function pdfDocumentTitle() { return reportPdfTitle(state.range, state.people); }

$('download-pdf').addEventListener('click', event => {
  event.preventDefault();
  if (state.loading || $('download-pdf').classList.contains('disabled')) return;
  const previousTitle = document.title;
  document.title = pdfDocumentTitle();
  addEventListener('afterprint', () => { document.title = previousTitle; }, { once: true });
  window.print();
});

async function refreshProjectDefinitions() {
  const preferences = await send({ type: 'GET_LOCAL_PREFERENCES' });
  state.projectDefinitions = preferences.projects || [];
  reconcileSelections(buildFacets(state.records, { projectDefinitions: state.projectDefinitions }), ['projects']);
  render();
}

chrome.runtime.onMessage.addListener(message => {
  if (message?.type === 'LOCAL_PREFERENCES_CHANGED') {
    void refreshProjectDefinitions().catch(setError);
    return;
  }
  if (message?.type !== 'REPORT_PROGRESS' || message.requestId !== state.progressRequestId) return;
  showProgress(message.label || 'Working…', message.value ?? null);
});

const colorScheme = matchMedia('(prefers-color-scheme: dark)');
colorScheme.addEventListener('change', () => {
  if (state.range && !state.loading && !$('report-content').hidden) render();
});

const initial = periodRange('last-week', localDateValue());
$('start-date').value = initial.startDate; $('end-date').value = initial.endDate;
void loadRange(initial);

mountRunningStatus($('running-status'), { send });
