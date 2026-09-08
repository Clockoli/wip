import { mountRunningStatus } from '../ui/running-status.js';
import {
  buildAnalytics, buildFacets, buildPrintableTimesheet, exportTimesheet, filterReportRecords, formatClockDuration,
  periodRange, reportFilename, reportPdfTitle, taskSource,
} from '../domain/reporting.js';
import { buildInvoice, invoiceCsv, invoiceExchangeRequest, invoiceFilename, invoiceJson } from '../domain/invoicing.js';
import { billableTotalsByCurrency, exchangeCurrencyCode, invoicingSettings, rateForUser } from '../domain/local-settings.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const FACET_KEYS = ['people', 'projects', 'repositories'];
const $ = id => document.getElementById(id);
const state = {
  records: [], range: null, pendingRange: null, sourceRepository: '', branch: '', billing: { rates: {}, invoicing: invoicingSettings() }, loading: false, requestId: 0, analytics: null,
  people: new Set(), projects: new Set(), repositories: new Set(), projectDefinitions: [], peopleSearch: '', projectsSearch: '', repositoriesSearch: '',
  allSelected: { people: false, projects: true, repositories: true }, otherProjectName: 'Other',
  exchangeRates: null, exchangeKey: '', analyticsRequestId: 0, progressRequestId: null, progressValue: 0,
  invoice: null, invoiceExchangeRates: null, invoiceRequestId: 0, invoiceReservedSequence: null, invoiceCompositionKey: '', invoiceControlsReady: false, invoiceClientChosen: false,
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

function invoiceNode(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function invoiceParty(label, party) {
  const values = party ? [party.name, party.address, party.email, party.taxId].filter(Boolean) : [];
  if (!values.length) return null;
  const section = invoiceNode('section', 'invoice-party');
  section.append(invoiceNode('h2', '', `${label}${party.name ? `: ${party.name}` : ''}`));
  if (party.address) section.append(invoiceNode('p', '', party.address));
  if (party.email) section.append(invoiceNode('p', '', party.email));
  if (party.taxId) section.append(invoiceNode('p', '', `Tax ID: ${party.taxId}`));
  return section;
}

function renderInvoiceDocument(container, invoice) {
  container.replaceChildren();
  const documentRoot = invoiceNode('article', 'invoice-document');
  const heading = invoiceNode('header', 'invoice-document-heading');
  const mark = invoiceNode('img', 'invoice-mark'); mark.src = '../assets/clockoli-with-text.svg'; mark.alt = 'Clockoli';
  const identity = invoiceNode('div', 'invoice-identity'); identity.append(invoiceNode('h1', '', `INVOICE  ${invoice.number}`));
  const dates = invoiceNode('dl', 'invoice-dates');
  for (const [label, value] of [['Issued', invoice.issueDate], ['Due', invoice.dueDate]]) {
    const row = invoiceNode('div'); row.append(invoiceNode('dt', '', label), invoiceNode('dd', '', value)); dates.append(row);
  }
  identity.append(dates); heading.append(mark, identity); documentRoot.append(heading);
  const parties = invoiceNode('div', 'invoice-parties'), seller = invoiceParty('From', invoice.seller), client = invoiceParty('Bill to', invoice.client);
  if (seller) parties.append(seller);
  if (client) parties.append(client);
  if (parties.children.length) documentRoot.append(parties);
  documentRoot.append(invoiceNode('p', 'invoice-period', `Period: ${invoice.period.startDate} — ${invoice.period.endDate}`));
  const table = invoiceNode('table', 'invoice-table'), head = invoiceNode('thead'), headRow = invoiceNode('tr');
  const byDay = invoice.groupBy === 'day';
  for (const label of [...(byDay ? ['Date'] : []), 'Description', 'Hours', 'Rate', 'Amount']) headRow.append(invoiceNode('th', ['Date', 'Description'].includes(label) ? 'invoice-text-cell' : '', label));
  head.append(headRow); table.append(head);
  const body = invoiceNode('tbody');
  for (const line of invoice.lines) {
    const row = invoiceNode('tr');
    if (byDay) row.append(invoiceNode('td', '', line.date));
    row.append(
      invoiceNode('td', 'invoice-text-cell', line.description), invoiceNode('td', '', line.hours.toFixed(2)),
      invoiceNode('td', '', formatMoney(line.effectiveRateMinorPerHour, invoice.currency, invoice.currencyPosition)),
      invoiceNode('td', '', formatMoney(line.amountMinor, invoice.currency, invoice.currencyPosition)),
    );
    body.append(row);
  }
  table.append(body);
  const foot = invoiceNode('tfoot');
  const totalRow = (label, value) => {
    const row = invoiceNode('tr', 'invoice-total-row'), labelCell = invoiceNode('th', '', label);
    labelCell.colSpan = byDay ? 4 : 3; row.append(labelCell, invoiceNode('td', '', formatMoney(value, invoice.currency, invoice.currencyPosition))); return row;
  };
  foot.append(totalRow('Subtotal', invoice.subtotalMinor));
  if (invoice.taxPercent !== 0) foot.append(totalRow(`VAT ${invoice.taxPercent}%`, invoice.taxMinor));
  foot.append(totalRow('Total', invoice.totalMinor)); table.append(foot); documentRoot.append(table);
  for (const item of invoice.unbilled) documentRoot.append(invoiceNode('p', 'invoice-unbilled', `Not billed: ${item.person} ${formatClockDuration(item.seconds)} (no hourly rate covers this time)`));
  if (invoice.converted) documentRoot.append(invoiceNode('p', 'invoice-footnote', "Exchange rates are from Frankfurter; each entry uses the exchange rate for that entry's own date."));
  if (invoice.paymentTerms) documentRoot.append(invoiceNode('p', 'invoice-terms', `Payment terms: ${invoice.paymentTerms}`));
  if (invoice.notes) documentRoot.append(invoiceNode('p', 'invoice-notes', invoice.notes));
  container.append(documentRoot);
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
  return { people: [...state.people], projects: [...state.projects], repositories: [...state.repositories], projectDefinitions: state.projectDefinitions, otherProjectName: state.otherProjectName, emptyMeansNone: true };
}

function currentFilteredRecords() { return filterReportRecords(state.records, selectedFilters()); }

function invoiceCompositionKey(filtered) {
  const records = filtered.map(record => [record.id || record.taskUrl || record.issue?.url || record.url, record.user, String(record.entryDate || record.startedAt || '').slice(0, 10), record.durationSeconds]);
  return JSON.stringify({ range: state.range, filters: selectedFilters(), records, rates: state.billing.rates, invoicing: state.billing.invoicing });
}

function resetInvoiceReservation() {
  state.invoiceReservedSequence = null; state.invoice = null; state.invoiceExchangeRates = null; state.invoiceRequestId += 1;
}

function syncInvoiceComposition(filtered) {
  const key = invoiceCompositionKey(filtered);
  if (key === state.invoiceCompositionKey) return;
  state.invoiceCompositionKey = key; resetInvoiceReservation();
  if ($('invoice-dialog').open) void rebuildInvoicePreview();
}

function setInvoiceAvailable(filtered) {
  const control = $('create-invoice');
  let reason = '';
  if (!filtered.length) reason = 'No entries in this period to invoice';
  else if (!filtered.some(record => rateForUser(record.user, state.billing.rates, record.entryDate || String(record.startedAt || '').slice(0, 10)))) reason = 'No hourly rate covers these entries. Add rates in Settings.';
  else if (state.loading) reason = 'Report is loading';
  control.classList.toggle('disabled', Boolean(reason)); control.setAttribute('aria-disabled', String(Boolean(reason)));
  if (reason) control.setAttribute('title', reason); else control.removeAttribute('title');
}

function setInvoiceActionsAvailable(available) {
  for (const id of ['invoice-print', 'invoice-download-csv', 'invoice-download-json']) $(id).disabled = !available;
}

function invoiceCurrencies(filtered) {
  return [...new Set(filtered.map(record => rateForUser(record.user, state.billing.rates, record.entryDate || String(record.startedAt || '').slice(0, 10))?.currency).filter(Boolean))].sort();
}

function selectedInvoiceClient() {
  return state.billing.invoicing.clients.find(client => client.id === $('invoice-client').value) || null;
}

function populateInvoiceClients() {
  const select = $('invoice-client'), previous = state.invoiceControlsReady ? select.value : '';
  select.replaceChildren();
  const empty = document.createElement('option'); empty.value = ''; empty.textContent = 'No client'; select.append(empty);
  for (const client of state.billing.invoicing.clients) {
    const option = document.createElement('option'); option.value = client.id; option.textContent = client.name || client.id; select.append(option);
  }
  select.value = state.billing.invoicing.clients.some(client => client.id === previous) ? previous : '';
  if (!state.invoiceClientChosen && !select.value && state.billing.invoicing.clients.length === 1) select.value = state.billing.invoicing.clients[0].id;
}

function populateInvoiceCurrencies(filtered, preferClient = false) {
  const select = $('invoice-currency'), previous = select.value, clientCurrency = selectedInvoiceClient()?.defaultCurrency || '';
  const currencies = invoiceCurrencies(filtered);
  if (clientCurrency && !currencies.includes(clientCurrency)) currencies.push(clientCurrency);
  currencies.sort(); select.replaceChildren();
  if (currencies.length !== 1 && !clientCurrency) {
    const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = 'Choose currency'; select.append(placeholder);
  }
  for (const currency of currencies) { const option = document.createElement('option'); option.value = currency; option.textContent = currency; select.append(option); }
  if (clientCurrency && (preferClient || !currencies.includes(previous))) select.value = clientCurrency;
  else if (currencies.length === 1) select.value = currencies[0];
  else if (currencies.includes(previous)) select.value = previous;
  else select.value = '';
}

function invoiceBuildOptions(sequence, exchangeRates) {
  const dueDays = Number($('invoice-due-days').value);
  if (dueDays > 365) throw new Error('Invoice due days must be between 0 and 365');
  return {
    rates: state.billing.rates, invoicing: state.billing.invoicing, clientId: $('invoice-client').value,
    currency: $('invoice-currency').value, exchangeRates, groupBy: $('invoice-group-by').value,
    startDate: state.range.startDate, endDate: state.range.endDate, issueDate: $('invoice-issue-date').value,
    dueDays, sequence,
  };
}

function prospectiveInvoiceSequence() { return state.invoiceReservedSequence ?? state.billing.invoicing.nextNumber; }

function showInvoiceLoading() {
  $('invoice-feedback').textContent = ''; $('invoice-preview').replaceChildren(invoiceNode('p', 'invoice-loading', 'Loading exchange rates…')); setInvoiceActionsAvailable(false);
}

function showInvoiceError(error) {
  state.invoice = null; state.invoiceExchangeRates = null; $('invoice-preview').replaceChildren();
  $('invoice-feedback').textContent = error?.message || String(error || 'Could not build invoice.'); setInvoiceActionsAvailable(false);
}

async function rebuildInvoicePreview() {
  if (!state.range) return;
  const requestId = ++state.invoiceRequestId, filtered = currentFilteredRecords();
  $('invoice-feedback').textContent = ''; setInvoiceActionsAvailable(false); state.invoice = null;
  try {
    let exchangeRates = null;
    const targetCurrency = $('invoice-currency').value;
    if (targetCurrency) {
      const payload = invoiceExchangeRequest(filtered, state.billing.rates, targetCurrency);
      if (payload.sourceCurrencies.length) {
        showInvoiceLoading();
        const result = await send({ type: 'GET_EXCHANGE_RATES', payload: { ...payload, requestId: `invoice-${state.requestId}-${requestId}` } });
        if (requestId !== state.invoiceRequestId) return;
        exchangeRates = result.rates;
      }
    }
    const invoice = buildInvoice(filtered, invoiceBuildOptions(prospectiveInvoiceSequence(), exchangeRates));
    if (requestId !== state.invoiceRequestId) return;
    state.invoice = invoice; state.invoiceExchangeRates = exchangeRates; renderInvoiceDocument($('invoice-preview'), invoice); setInvoiceActionsAvailable(true);
  } catch (error) { if (requestId === state.invoiceRequestId) showInvoiceError(error); }
}

function prepareInvoiceControls(filtered) {
  populateInvoiceClients(); populateInvoiceCurrencies(filtered);
  if (!state.invoiceControlsReady) {
    $('invoice-group-by').value = 'task'; $('invoice-issue-date').value = localDateValue(); $('invoice-due-days').value = '30'; state.invoiceControlsReady = true;
  }
}

async function ensureReservedInvoice() {
  if (!state.invoice) throw new Error('Invoice preview is not ready.');
  if (state.invoiceReservedSequence === null) {
    const requestId = state.invoiceRequestId, compositionKey = state.invoiceCompositionKey;
    const result = await send({ type: 'RESERVE_INVOICE_NUMBER' });
    // Keep successful reservations for retries. A worker crash between commit and response can still leave a gap in v1, never a duplicate.
    state.invoiceReservedSequence = result.sequence;
    if (requestId !== state.invoiceRequestId || compositionKey !== state.invoiceCompositionKey) throw new Error('Invoice changed while its number was being reserved. Try again.');
  }
  state.invoice = buildInvoice(currentFilteredRecords(), invoiceBuildOptions(state.invoiceReservedSequence, state.invoiceExchangeRates));
  renderInvoiceDocument($('invoice-preview'), state.invoice);
  return state.invoice;
}

function downloadInvoiceFile(format, invoice) {
  const content = format === 'csv' ? invoiceCsv(invoice) : invoiceJson(invoice);
  const type = format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8';
  const url = URL.createObjectURL(new Blob([content], { type })), anchor = document.createElement('a');
  anchor.href = url; anchor.download = invoiceFilename(format, invoice); anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function exportInvoice(format) {
  setInvoiceActionsAvailable(false); $('invoice-feedback').textContent = '';
  try { const invoice = await ensureReservedInvoice(); downloadInvoiceFile(format, invoice); setInvoiceActionsAvailable(true); }
  catch (error) { $('invoice-feedback').textContent = error?.message || `Could not download invoice ${format.toUpperCase()}.`; setInvoiceActionsAvailable(Boolean(state.invoice)); }
}

function updateSelectionIntent(key) {
  const values = buildFacets(state.records, { projectDefinitions: state.projectDefinitions, otherProjectName: state.otherProjectName })[key];
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
  syncInvoiceComposition(filtered); setInvoiceAvailable(filtered);
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
  resetInvoiceReservation(); state.invoiceCompositionKey = '';
  state.progressRequestId = requestId; state.progressValue = 0; state.pendingRange = range; state.loading = true; state.analyticsRequestId += 1; setError();
  setDownloadsAvailable(false); setInvoiceAvailable(currentFilteredRecords()); renderRangeContext();
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
    state.billing = { rates: result.billing?.rates || {}, invoicing: invoicingSettings(result.billing) };
    state.projectDefinitions = result.billing?.projects || [];
    state.otherProjectName = result.billing?.otherProjectName || 'Other';
    const available = buildFacets(result.records, { projectDefinitions: state.projectDefinitions, otherProjectName: state.otherProjectName });
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
      setInvoiceAvailable(state.range ? currentFilteredRecords() : []);
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
  resetInvoiceReservation(); state.invoiceCompositionKey = '';
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
  const values = buildFacets(state.records, { projectDefinitions: state.projectDefinitions, otherProjectName: state.otherProjectName }).projects.map(project => project.value);
  state.projects = values.length && values.every(value => state.projects.has(value)) ? new Set() : new Set(values); updateSelectionIntent('projects');
});
$('repositories-all').addEventListener('click', () => {
  const values = [...new Set(state.records.map(record => taskSource(record)))];
  state.repositories = values.length && values.every(value => state.repositories.has(value)) ? new Set() : new Set(values); updateSelectionIntent('repositories');
});
$('reset-filters').addEventListener('click', () => {
  const facets = buildFacets(state.records, { projectDefinitions: state.projectDefinitions, otherProjectName: state.otherProjectName });
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

$('create-invoice').addEventListener('click', event => {
  event.preventDefault();
  if (state.loading || $('create-invoice').classList.contains('disabled')) return;
  const filtered = currentFilteredRecords(); prepareInvoiceControls(filtered); $('invoice-dialog').showModal(); void rebuildInvoicePreview();
});
$('invoice-close').addEventListener('click', () => $('invoice-dialog').close());
$('invoice-dialog').addEventListener('close', () => { state.invoiceRequestId += 1; $('create-invoice').focus(); });
for (const id of ['invoice-currency', 'invoice-group-by', 'invoice-issue-date', 'invoice-due-days']) {
  $(id).addEventListener('change', () => { resetInvoiceReservation(); void rebuildInvoicePreview(); });
}
$('invoice-client').addEventListener('change', () => {
  state.invoiceClientChosen = true; resetInvoiceReservation(); populateInvoiceCurrencies(currentFilteredRecords(), true); void rebuildInvoicePreview();
});
$('invoice-download-csv').addEventListener('click', () => void exportInvoice('csv'));
$('invoice-download-json').addEventListener('click', () => void exportInvoice('json'));
$('invoice-print').addEventListener('click', async () => {
  setInvoiceActionsAvailable(false); $('invoice-feedback').textContent = '';
  try {
    const invoice = await ensureReservedInvoice(), previousTitle = document.title;
    renderInvoiceDocument($('print-invoice'), invoice); document.body.classList.add('printing-invoice');
    document.title = invoiceFilename('pdf', invoice).replace(/\.pdf$/, ''); $('invoice-dialog').close();
    addEventListener('afterprint', () => { document.body.classList.remove('printing-invoice'); document.title = previousTitle; }, { once: true });
    window.print();
  } catch (error) { $('invoice-feedback').textContent = error?.message || 'Could not print invoice.'; setInvoiceActionsAvailable(Boolean(state.invoice)); }
});

async function refreshProjectDefinitions() {
  const preferences = await send({ type: 'GET_LOCAL_PREFERENCES' });
  state.billing = { rates: preferences.rates || {}, invoicing: invoicingSettings(preferences) };
  state.projectDefinitions = preferences.projects || [];
  state.otherProjectName = preferences.otherProjectName || 'Other';
  reconcileSelections(buildFacets(state.records, { projectDefinitions: state.projectDefinitions, otherProjectName: state.otherProjectName }), ['projects']);
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
