import {
  buildAnalytics, buildFacets, exportTimesheet, filterReportRecords, formatClockDuration,
  periodRange, reportFilename,
} from '../domain/reporting.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const $ = id => document.getElementById(id);
const state = {
  records: [], range: null, sourceRepository: '', branch: '', loading: false, requestId: 0,
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
  $('error').textContent = error?.message || String(error || '');
  $('error').hidden = !$('error').textContent;
}

function svg(tag, attributes = {}, text = '') {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  if (text) node.textContent = text;
  return node;
}

function dimensions() {
  return [
    ['dimension-person', 'person'], ['dimension-repository', 'repository'], ['dimension-issue', 'issue'],
  ].filter(([id]) => $(id).checked).map(([, value]) => value);
}

function selectedFilters() {
  return { people: [...state.people], repositories: [...state.repositories] };
}

function colorMap(series) {
  const dark = globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches;
  const lightness = dark ? 67 : 38;
  return new Map(series.map((item, index) => [item.key, `hsl(${Math.round(index * 137.508) % 360} 68% ${lightness}%)`]));
}

function renderFacet(container, options, selected, query, rerender) {
  const focusedValue = container.contains(document.activeElement) ? document.activeElement.value : null;
  let restoreFocus = null;
  container.replaceChildren();
  const visible = options.filter(option => option.value.toLowerCase().includes(query.toLowerCase()));
  if (!visible.length) { const empty = document.createElement('div'); empty.className = 'empty-facet'; empty.textContent = 'No matching values'; container.append(empty); return; }
  for (const option of visible) {
    const label = document.createElement('label'); label.className = 'facet-option'; label.title = option.value;
    const input = document.createElement('input'); input.type = 'checkbox'; input.value = option.value; input.checked = selected.has(option.value);
    if (option.value === focusedValue) restoreFocus = input;
    input.addEventListener('change', () => {
      if (input.checked) selected.add(option.value);
      else if (selected.size > 1) selected.delete(option.value);
      else input.checked = true;
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
  $('summary-entries').textContent = String(filtered.length);
  $('summary-people').textContent = String(new Set(filtered.map(record => record.user)).size);
  $('summary-repositories').textContent = String(new Set(filtered.map(record => `${record.issue.owner}/${record.issue.repo}`)).size);
  $('filtered-summary').textContent = `${filtered.length} ${filtered.length === 1 ? 'entry' : 'entries'} · ${formatClockDuration(total)}`;
}

function renderChart(analytics) {
  const container = $('analytics-chart'), legend = $('chart-legend'), table = $('analytics-table');
  container.replaceChildren(); legend.replaceChildren(); table.replaceChildren();
  if (!analytics.buckets.length) {
    const empty = document.createElement('div'); empty.className = 'chart-empty'; empty.textContent = 'No tracked time matches these filters.'; container.append(empty); return;
  }
  const width = Math.max(720, analytics.buckets.length * 92 + 100), height = 400;
  const margin = { top: 24, right: 20, bottom: 104, left: 66 }, plotWidth = width - margin.left - margin.right, plotHeight = height - margin.top - margin.bottom;
  const chart = svg('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': 'Stacked tracked-time bar chart' });
  const colors = colorMap(analytics.series), maximum = analytics.maxSeconds || 1;
  for (let step = 0; step <= 4; step += 1) {
    const y = margin.top + plotHeight - plotHeight * step / 4, seconds = maximum * step / 4;
    chart.append(svg('line', { x1: margin.left, y1: y, x2: width - margin.right, y2: y, class: 'grid-line' }));
    chart.append(svg('text', { x: margin.left - 10, y: y + 4, 'text-anchor': 'end', class: 'grid-label' }, formatClockDuration(seconds)));
  }
  const slot = plotWidth / analytics.buckets.length, barWidth = Math.min(58, slot * .68);
  analytics.buckets.forEach((bucket, index) => {
    const x = margin.left + slot * index + (slot - barWidth) / 2; let yBottom = margin.top + plotHeight;
    for (const segment of bucket.segments) {
      const segmentHeight = plotHeight * segment.seconds / maximum; yBottom -= segmentHeight;
      const rect = svg('rect', { x, y: yBottom, width: barWidth, height: Math.max(0, segmentHeight), fill: colors.get(segment.key), class: 'bar-segment', tabindex: '0', 'aria-label': `${bucket.label}, ${segment.label}: ${formatClockDuration(segment.seconds)}` });
      rect.append(svg('title', {}, `${bucket.label}\n${segment.label}\n${formatClockDuration(segment.seconds)}`)); chart.append(rect);
    }
    const labelY = height - margin.bottom + 24;
    const label = svg('text', { x: x + barWidth / 2, y: labelY, 'text-anchor': 'end', transform: `rotate(-28 ${x + barWidth / 2} ${labelY})`, class: 'axis-label' }, bucket.label);
    chart.append(label);
  });
  container.append(chart);
  for (const item of analytics.series) {
    const node = document.createElement('span'); node.className = 'legend-item';
    const swatch = document.createElement('span'); swatch.className = 'legend-swatch'; swatch.style.backgroundColor = colors.get(item.key);
    const label = document.createElement('span'); label.textContent = item.label; node.append(swatch, label); legend.append(node);
  }
  const head = document.createElement('thead'), headRow = document.createElement('tr');
  for (const label of ['Interval', ...analytics.series.map(item => item.label), 'Total']) { const th = document.createElement('th'); th.scope = 'col'; th.textContent = label; headRow.append(th); }
  head.append(headRow); table.append(head);
  const body = document.createElement('tbody');
  for (const bucket of analytics.buckets) {
    const row = document.createElement('tr'), values = new Map(bucket.segments.map(segment => [segment.key, segment.seconds]));
    for (const value of [bucket.label, ...analytics.series.map(item => formatClockDuration(values.get(item.key) || 0)), formatClockDuration(bucket.totalSeconds)]) { const td = document.createElement('td'); td.textContent = value; row.append(td); }
    body.append(row);
  }
  table.append(body);
}

function render() {
  if (!state.range) return;
  const facets = buildFacets(state.records, selectedFilters());
  renderFacet($('people-facet'), facets.people, state.people, state.peopleSearch, render);
  renderFacet($('repositories-facet'), facets.repositories, state.repositories, state.repositoriesSearch, render);
  const filtered = filterReportRecords(state.records, selectedFilters());
  renderSummary(filtered);
  const interval = $('dimension-interval').checked ? $('interval').value : null;
  $('interval').disabled = interval === null;
  renderChart(buildAnalytics(filtered, { dimensions: dimensions(), interval }));
  $('download-timesheet').disabled = !filtered.length;
}

async function loadRange(range) {
  const requestId = ++state.requestId;
  state.range = range; state.loading = true; setError();
  $('loading').hidden = false; $('setup').hidden = true; $('report-content').hidden = true;
  try {
    const result = await send({ type: 'LOAD_REPORT', payload: { startDate: range.startDate, endDate: range.endDate } });
    if (requestId !== state.requestId) return;
    if (!result.configured) { $('setup').hidden = false; $('source').textContent = 'No time-data repository configured'; return; }
    state.records = result.records; state.sourceRepository = result.sourceRepository; state.branch = result.branch;
    state.people = new Set(result.records.map(record => record.user));
    state.repositories = new Set(result.records.map(record => `${record.issue.owner}/${record.issue.repo}`));
    $('source').textContent = `${result.sourceRepository} · ${result.branch} · ${range.startDate} to ${range.endDate}`;
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
    $('loading').hidden = true; $('report-content').hidden = true; $('download-timesheet').disabled = true;
    $('source').textContent = 'Choose a custom date range and apply it.';
  } else void applyPeriod();
});
$('apply-period').addEventListener('click', () => void applyPeriod());
for (const id of ['dimension-person', 'dimension-repository', 'dimension-issue', 'dimension-interval', 'interval']) $(id).addEventListener('change', render);
$('people-search').addEventListener('input', event => { state.peopleSearch = event.target.value; render(); });
$('repositories-search').addEventListener('input', event => { state.repositoriesSearch = event.target.value; render(); });
$('people-all').addEventListener('click', () => { state.people = new Set(state.records.map(record => record.user)); render(); });
$('repositories-all').addEventListener('click', () => { state.repositories = new Set(state.records.map(record => `${record.issue.owner}/${record.issue.repo}`)); render(); });
$('settings').addEventListener('click', () => send({ type: 'OPEN_OPTIONS' }));
$('setup-settings').addEventListener('click', () => send({ type: 'OPEN_OPTIONS' }));
$('download-timesheet').addEventListener('click', () => {
  const filtered = filterReportRecords(state.records, selectedFilters()), format = $('export-format').value;
  const content = exportTimesheet(filtered, { format, startDate: state.range.startDate, endDate: state.range.endDate });
  const blob = new Blob([content], { type: format === 'csv' ? 'text/csv;charset=utf-8' : 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url; anchor.download = reportFilename(format, state.range.startDate, state.range.endDate); anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
});

const initial = periodRange('this-week', localDateValue());
$('start-date').value = initial.startDate; $('end-date').value = initial.endDate;
void loadRange(initial);
