import { mountRunningStatus } from '../ui/running-status.js';
import {
  buildAnalytics, buildFacets, buildPrintableTimesheet, exportTimesheet, filterReportRecords, formatClockDuration,
  periodRange, recordDate, reportFilename, reportPdfTitle, taskSource, timeRepository,
} from '../domain/reporting.js';
import { buildInvoice, invoiceExchangeRequest } from '../domain/invoicing.js';
import { billableTotalsByCurrency, clientForProject, exchangeCurrencyCode, invoicingSettings, projectNameForUrl, rateForUser, rateMajorToMinor } from '../domain/local-settings.js';
import { taskUrlOf } from '../domain/values.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const FACET_KEYS = ['people', 'projects', 'repositories', 'timeRepositories'];
const $ = id => document.getElementById(id);
const state = {
  records: [], range: null, pendingRange: null, sourceRepository: '', branch: '', sourceRepositories: [], billing: { rates: {}, invoicing: invoicingSettings() }, loading: false, requestId: 0, analytics: null, partial: false, readStatus: [],
  people: new Set(), projects: new Set(), repositories: new Set(), timeRepositories: new Set(), projectDefinitions: [], peopleSearch: '', projectsSearch: '', repositoriesSearch: '', timeRepositoriesSearch: '',
  allSelected: { people: false, projects: true, repositories: true, timeRepositories: true }, otherProjectName: 'Other', otherProjectClient: '',
  exchangeRates: null, exchangeKey: '', analyticsRequestId: 0, progressRequestId: null, progressValue: 0,
  invoice: null, invoiceExchangeRates: null, invoiceRequestId: 0, invoiceReservedSequence: null, invoiceCompositionKey: '', invoiceControlsReady: false, invoiceClientChosen: false,
  preset: 'last-week', reportingUtc: false, calendarMonth: '', focusedDay: '', savingBasis: false,
  invoiceExtraLines: [], invoiceProjects: new Set(), invoiceProjectOptions: [],
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
const AXIS_LABELS = { day: 'Day', week: 'Week', month: 'Month', person: 'Person', repository: 'Source', 'time-repository': 'Time repository', task: 'Task URL / title' };

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

function formatInvoiceDate(value) {
  const text = String(value || '');
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return text;
  const date = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? text : new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function invoiceTaskCell(line) {
  const cell = invoiceNode('td', 'invoice-task-cell');
  const label = String(line.taskTitle || line.taskUrl || '').trim();
  if (line.taskUrl) {
    const link = invoiceNode('a', '', label || line.taskUrl); link.href = line.taskUrl; link.target = '_blank'; link.rel = 'noreferrer'; cell.append(link);
  } else cell.textContent = label;
  return cell;
}

function renderInvoiceDocument(container, invoice) {
  container.replaceChildren();
  const documentRoot = invoiceNode('article', 'invoice-document');
  const heading = invoiceNode('header', 'invoice-document-heading');
  const seller = invoiceParty('From', invoice.seller);
  if (seller) {
    seller.className += ' invoice-seller';
    const name = seller.children[0], parts = String(invoice.seller.name || 'From').trim().split(/\s+/).filter(Boolean);
    name.replaceChildren(...parts.map(part => invoiceNode('span', 'invoice-seller-name-part', part)));
    heading.append(seller);
  }
  const identity = invoiceNode('div', 'invoice-identity'); identity.append(invoiceNode('h1', '', `INVOICE  ${invoice.number}`));
  const dates = invoiceNode('dl', 'invoice-dates');
  for (const [label, value] of [['Issued', invoice.issueDate], ['Due', invoice.dueDate]]) {
    const row = invoiceNode('div'); row.append(invoiceNode('dt', '', label), invoiceNode('dd', '', formatInvoiceDate(value))); dates.append(row);
  }
  identity.append(dates); heading.append(identity); documentRoot.append(heading);
  const parties = invoiceNode('div', 'invoice-parties'), client = invoiceParty('Bill to', invoice.client);
  if (client) parties.append(client);
  if (parties.children.length) documentRoot.append(parties);
  documentRoot.append(invoiceNode('p', 'invoice-period', `Period: ${formatInvoiceDate(invoice.period.startDate)} — ${formatInvoiceDate(invoice.period.endDate)}`));
  const byDay = invoice.groupBy === 'day';
  const table = invoiceNode('table', `invoice-table invoice-table-${byDay ? 'by-day' : 'by-task'}`), head = invoiceNode('thead'), headRow = invoiceNode('tr');
  for (const label of [...(byDay ? ['Date'] : []), 'Task', 'Description', 'Hours', 'Amount']) {
    const className = ['Date', 'Task', 'Description'].includes(label) ? 'invoice-text-cell' : 'invoice-numeric-cell';
    headRow.append(invoiceNode('th', className, label));
  }
  head.append(headRow); table.append(head);
  const body = invoiceNode('tbody');
  for (const line of invoice.lines) {
    const row = invoiceNode('tr');
    if (byDay) row.append(invoiceNode('td', 'invoice-date-cell', formatInvoiceDate(line.date || '')));
    row.append(
      invoiceTaskCell(line), invoiceNode('td', 'invoice-text-cell', line.description || ''), invoiceNode('td', 'invoice-numeric-cell', line.hours === undefined ? '' : line.hours.toFixed(2)),
      invoiceNode('td', 'invoice-numeric-cell', formatMoney(line.amountMinor, invoice.currency, invoice.currencyPosition)),
    );
    body.append(row);
  }
  table.append(body);
  const foot = invoiceNode('tfoot');
  const totalRow = (label, value) => {
    const row = invoiceNode('tr', 'invoice-total-row'), labelCell = invoiceNode('th', '', label);
    labelCell.colSpan = byDay ? 4 : 3; row.append(labelCell, invoiceNode('td', 'invoice-numeric-cell', formatMoney(value, invoice.currency, invoice.currencyPosition))); return row;
  };
  foot.append(totalRow('Subtotal', invoice.subtotalMinor));
  if (invoice.taxPercent !== 0) foot.append(totalRow(`VAT ${invoice.taxPercent}%`, invoice.taxMinor));
  foot.append(totalRow('Total', invoice.totalMinor)); table.append(foot); documentRoot.append(table);
  for (const item of invoice.unbilled) documentRoot.append(invoiceNode('p', 'invoice-unbilled', `Not billed: ${item.person} ${formatClockDuration(item.seconds)} (no hourly rate covers this time)`));
  if (invoice.converted) documentRoot.append(invoiceNode('p', 'invoice-footnote', "Exchange rates are from Frankfurter; each entry uses the exchange rate for that entry's own date."));
  documentRoot.append(invoiceNode('p', 'invoice-terms', `Payment terms: ${invoice.paymentTermsDays === 0 ? 'Due on receipt' : `Net ${invoice.paymentTermsDays}`}`));
  if (invoice.notes) documentRoot.append(invoiceNode('p', 'invoice-notes', invoice.notes));
  container.append(documentRoot);
}

async function saveInvoicePdf(invoice) {
  const source = $('invoice-preview').children[0];
  if (!source || typeof globalThis.html2pdf !== 'function') throw new Error('PDF export is unavailable. Reload Clockoli and try again.');
  source.classList.add('invoice-pdf-export');
  try {
    await globalThis.html2pdf().set({
      margin: [10, 10, 10, 10],
      filename: invoicePdfFilename(invoice),
      image: { type: 'jpeg', quality: 0.98 },
      enableLinks: true,
      html2canvas: { backgroundColor: '#ffffff', scale: 2, useCORS: true, logging: false },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['css', 'legacy'], avoid: ['tr', '.invoice-document-heading', '.invoice-parties', '.invoice-total-row', '.invoice-unbilled', '.invoice-footnote', '.invoice-terms', '.invoice-notes'] },
    }).from(source).save();
  } finally {
    source.classList.remove('invoice-pdf-export');
  }
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
  available = available && !state.loading && !state.partial;
  for (const id of ['download-csv', 'download-json', 'download-pdf']) {
    $(id).classList.toggle('disabled', !available);
    $(id).setAttribute('aria-disabled', String(!available));
  }
}

function selectedFilters() {
  return { people: [...state.people], projects: [...state.projects], repositories: [...state.repositories], timeRepositories: [...state.timeRepositories], projectDefinitions: state.projectDefinitions, otherProjectName: state.otherProjectName, emptyMeansNone: true };
}

function currentFilteredRecords() { return filterReportRecords(state.records, selectedFilters()); }

function invoiceCompositionKey(filtered) {
  const records = filtered.map(record => [record.id || record.taskUrl || record.issue?.url || record.url, record.user, recordDate(record), record.durationSeconds]);
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
  else if (!filtered.some(record => rateForUser(record.user, state.billing.rates, recordDate(record)))) reason = 'No hourly rate covers these entries. Add rates in Settings.';
  else if (state.loading) reason = 'Report is loading';
  control.classList.toggle('disabled', Boolean(reason)); control.setAttribute('aria-disabled', String(Boolean(reason)));
  if (reason) control.setAttribute('title', reason); else control.removeAttribute('title');
}

function setInvoiceActionsAvailable(available) {
  for (const id of ['invoice-print', 'invoice-save-pdf']) $(id).disabled = !available || state.loading;
}

function invoiceCurrencies(filtered) {
  return [...new Set(filtered.map(record => rateForUser(record.user, state.billing.rates, recordDate(record))?.currency).filter(Boolean))].sort();
}

function selectedInvoiceClient() {
  return state.billing.invoicing.clients.find(client => client.id === $('invoice-client').value) || null;
}

function invoiceProjectName(record) { return projectNameForUrl(taskUrlOf(record), state.projectDefinitions, state.otherProjectName); }

function invoiceFilteredRecords() { return currentFilteredRecords().filter(record => state.invoiceProjects.has(invoiceProjectName(record))); }

function renderInvoiceProjectWarnings() {
  const client = selectedInvoiceClient(), notices = [];
  if (client) {
    const foreign = new Map();
    for (const project of state.invoiceProjects) {
      const owner = clientForProject(project, state.billing.invoicing, { projects: state.projectDefinitions, otherProjectName: state.otherProjectName, otherProjectClient: state.otherProjectClient });
      if (owner && owner.id !== client.id) {
        if (!foreign.has(owner)) foreign.set(owner, []);
        foreign.get(owner).push(project);
      }
    }
    for (const [owner, projects] of foreign) notices.push(`This invoice includes work from projects assigned to ${owner.name || owner.id}: ${projects.join(', ')}.`);
  }
  const warning = $('invoice-project-warning'); warning.textContent = notices.join(' '); warning.hidden = !notices.length;
}

function renderInvoiceProjects() {
  const container = $('invoice-projects'); container.replaceChildren();
  for (const option of state.invoiceProjectOptions) {
    const label = document.createElement('label'); label.className = 'facet-option';
    const input = document.createElement('input'); input.type = 'checkbox'; input.value = option.value; input.checked = state.invoiceProjects.has(option.value);
    input.addEventListener('change', () => {
      if (input.checked) state.invoiceProjects.add(option.value); else state.invoiceProjects.delete(option.value);
      resetInvoiceReservation(); renderInvoiceProjects(); populateInvoiceCurrencies(invoiceFilteredRecords()); void rebuildInvoicePreview();
    });
    const name = document.createElement('span'); name.className = 'facet-name'; name.textContent = option.value;
    const count = document.createElement('span'); count.className = 'facet-count'; count.textContent = `${formatClockDuration(option.seconds)} · ${option.count}`;
    label.append(input, name, count); container.append(label);
  }
  $('invoice-project-count').textContent = `Billing ${state.invoiceProjects.size} of ${state.invoiceProjectOptions.length} projects`;
  renderInvoiceProjectWarnings();
}

function resetInvoiceProjects(filtered) {
  state.invoiceProjectOptions = buildFacets(filtered, { projectDefinitions: state.projectDefinitions, otherProjectName: state.otherProjectName }).projects;
  const client = selectedInvoiceClient();
  state.invoiceProjects = new Set(state.invoiceProjectOptions.filter(option => !client || clientForProject(option.value, state.billing.invoicing, { projects: state.projectDefinitions, otherProjectName: state.otherProjectName, otherProjectClient: state.otherProjectClient })?.id === client.id).map(option => option.value));
  renderInvoiceProjects();
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
  const extraLines = state.invoiceExtraLines.map(({ description, amount }) => {
    const text = amount.trim(), negative = text.startsWith('-');
    return { description, amountMinor: rateMajorToMinor(negative ? text.slice(1) : text) * (negative ? -1 : 1) };
  });
  return {
    rates: state.billing.rates, invoicing: state.billing.invoicing, clientId: $('invoice-client').value,
    currency: $('invoice-currency').value, exchangeRates, groupBy: $('invoice-group-by').value,
    startDate: state.range.startDate, endDate: state.range.endDate, issueDate: $('invoice-issue-date').value,
    extraLines, sequence,
  };
}

function renderInvoiceExtraLines() {
  const container = $('invoice-extra-lines'); container.replaceChildren();
  for (const line of state.invoiceExtraLines) {
    const row = invoiceNode('div', 'invoice-extra-row'), descriptionLabel = invoiceNode('label', '', 'Description'), amountLabel = invoiceNode('label', '', 'Amount');
    const description = invoiceNode('input'), amount = invoiceNode('input'), remove = invoiceNode('button', 'button secondary', '✕');
    description.type = 'text'; description.maxLength = 200; description.required = true; description.value = line.description;
    amount.type = 'number'; amount.step = '0.01'; amount.required = true; amount.value = line.amount;
    remove.type = 'button'; remove.setAttribute('aria-label', 'Remove additional line');
    for (const [input, key] of [[description, 'description'], [amount, 'amount']]) input.addEventListener('change', () => {
      line[key] = input.value; resetInvoiceReservation(); void rebuildInvoicePreview();
    });
    remove.addEventListener('click', () => {
      state.invoiceExtraLines = state.invoiceExtraLines.filter(item => item !== line);
      renderInvoiceExtraLines(); $('invoice-add-line').focus(); resetInvoiceReservation(); void rebuildInvoicePreview();
    });
    descriptionLabel.append(description); amountLabel.append(amount); row.append(descriptionLabel, amountLabel, remove); container.append(row);
  }
  $('invoice-add-line').disabled = state.invoiceExtraLines.length >= 20;
}

function prospectiveInvoiceSequence() { return state.invoiceReservedSequence ?? state.billing.invoicing.nextNumber; }

function showInvoiceEmpty() {
  $('invoice-preview').replaceChildren(invoiceNode('p', 'invoice-preview-empty', 'Choose a client and currency to preview the invoice.'));
}

function showInvoiceLoading() {
  $('invoice-feedback').textContent = ''; $('invoice-preview').replaceChildren(invoiceNode('p', 'invoice-loading', 'Loading exchange rates…')); setInvoiceActionsAvailable(false);
}

function showInvoiceError(error) {
  state.invoice = null; state.invoiceExchangeRates = null; showInvoiceEmpty();
  $('invoice-feedback').textContent = error?.message || String(error || 'Could not build invoice.'); setInvoiceActionsAvailable(false);
}

async function rebuildInvoicePreview() {
  if (!state.range || state.loading) return;
  $('invoice-billing-period').textContent = `Billing ${state.range.startDate} to ${state.range.endDate}`;
  const requestId = ++state.invoiceRequestId, filtered = invoiceFilteredRecords();
  $('invoice-feedback').textContent = ''; setInvoiceActionsAvailable(false); state.invoice = null; showInvoiceEmpty();
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
  populateInvoiceClients(); resetInvoiceProjects(filtered); populateInvoiceCurrencies(invoiceFilteredRecords());
  if (!state.invoiceControlsReady) {
    $('invoice-group-by').value = 'task'; $('invoice-issue-date').value = localDateValue(); state.invoiceControlsReady = true;
  }
}

async function ensureReservedInvoice() {
  if (!state.invoice || state.loading) throw new Error('Invoice preview is not ready.');
  if (state.invoiceReservedSequence === null) {
    const requestId = state.invoiceRequestId, compositionKey = state.invoiceCompositionKey;
    const result = await send({ type: 'RESERVE_INVOICE_NUMBER' });
    // Keep successful reservations for retries. A worker crash between commit and response can still leave a gap in v1, never a duplicate.
    state.invoiceReservedSequence = result.sequence;
    if (requestId !== state.invoiceRequestId || compositionKey !== state.invoiceCompositionKey) throw new Error('Invoice changed while its number was being reserved. Try again.');
  }
  state.invoice = buildInvoice(invoiceFilteredRecords(), invoiceBuildOptions(state.invoiceReservedSequence, state.invoiceExchangeRates));
  renderInvoiceDocument($('invoice-preview'), state.invoice);
  return state.invoice;
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
  const missingRates = [...new Set(filtered.filter(record => !rateForUser(record.user, state.billing.rates, recordDate(record))).map(record => record.user))];
  $('summary-money').textContent = `${billableSummary(totals)}${missingRates.length ? ` · No rate for ${missingRates.join(', ')}` : ''}`;
  const people = new Set(filtered.map(record => record.user)).size;
  const sources = new Set(filtered.map(record => taskSource(record))).size;
  $('summary-counts').textContent = `${filtered.length} ${filtered.length === 1 ? 'entry' : 'entries'} · ${people} ${people === 1 ? 'person' : 'people'} · ${sources} ${sources === 1 ? 'source' : 'sources'}`;
}

function rangeLabel(range) { return `${range.startDate} — ${range.endDate}`; }

const PERIOD_PRESETS = ['today', 'yesterday', 'last-7-days', 'last-30-days', 'this-week', 'last-week', 'this-month', 'last-month', 'this-quarter', 'last-quarter', 'this-year', 'last-year'];
const RANGE_FORMATTER = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const CALENDAR_FORMATTER = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });

function reportToday() { return state.reportingUtc ? new Date().toISOString().slice(0, 10) : localDateValue(); }
function renderRangeContext() {
  const range = state.range;
  // The resolved dates are the question the button answers; a preset name alone hides them.
  if (range) $('period-label').textContent = `${RANGE_FORMATTER.format(new Date(`${range.startDate}T00:00:00Z`))} – ${RANGE_FORMATTER.format(new Date(`${range.endDate}T00:00:00Z`))}`;
  $('period-trigger').setAttribute('aria-busy', String(state.loading));
  for (const preset of PERIOD_PRESETS) {
    if (range?.preset === preset) $(`preset-${preset}`).setAttribute('aria-current', 'true');
    else $(`preset-${preset}`).removeAttribute('aria-current');
  }
}

function renderReportingBasis() {
  const zone = new Intl.DateTimeFormat(undefined, { timeZoneName: 'long' }).formatToParts(new Date()).find(part => part.type === 'timeZoneName')?.value || Intl.DateTimeFormat().resolvedOptions().timeZone;
  $('period-timezone').textContent = `Showing ${state.reportingUtc ? 'UTC' : zone}`;
  $('reporting-utc').checked = state.reportingUtc;
}

function closePeriod() {
  $('period-popover').hidden = true; $('period-trigger').setAttribute('aria-expanded', 'false'); $('period-trigger').focus();
}

function calendarDate(value, days = 0) {
  const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10);
}

function renderCalendar(focus = false) {
  const start = $('start-date').value, end = $('end-date').value;
  const month = state.calendarMonth || (start || reportToday()).slice(0, 7), first = `${month}-01`;
  state.calendarMonth = month;
  $('calendar-month').textContent = CALENDAR_FORMATTER.format(new Date(`${first}T00:00:00Z`));
  const offset = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
  const dates = Array.from({ length: 42 }, (_, index) => calendarDate(first, index - offset));
  if (!dates.includes(state.focusedDay)) state.focusedDay = dates.includes(start) ? start : first;
  const grid = $('calendar-grid'); grid.replaceChildren();
  for (let week = 0; week < 6; week++) {
    const row = document.createElement('div'); row.className = 'calendar-row'; row.setAttribute('role', 'row');
    for (const date of dates.slice(week * 7, week * 7 + 7)) {
      const cell = document.createElement('div'), day = document.createElement('button');
      cell.setAttribute('role', 'gridcell'); cell.setAttribute('aria-selected', String(date === start || date === end || Boolean(start && end && date > start && date < end)));
      day.type = 'button'; day.className = 'calendar-day'; day.dataset.date = date; day.textContent = String(Number(date.slice(8)));
      day.tabIndex = date === state.focusedDay ? 0 : -1; day.setAttribute('aria-label', RANGE_FORMATTER.format(new Date(`${date}T00:00:00Z`)));
      day.classList.toggle('adjacent', date.slice(0, 7) !== month); day.classList.toggle('endpoint', date === start || date === end);
      day.classList.toggle('in-range', Boolean(start && end && date > start && date < end));
      day.addEventListener('click', () => selectCalendarDay(date));
      day.addEventListener('keydown', event => {
        const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
        if (offset) {
          event.preventDefault(); state.focusedDay = calendarDate(date, offset); state.calendarMonth = state.focusedDay.slice(0, 7); renderCalendar(true);
        } else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectCalendarDay(date); }
      });
      cell.append(day); row.append(cell);
    }
    grid.append(row);
  }
  if (focus) for (const row of grid.children) for (const cell of row.children) if (cell.children[0].tabIndex === 0) cell.children[0].focus();
}

function cancelPendingPeriod() {
  if (!state.loading) return;
  state.requestId += 1; state.analyticsRequestId += 1; state.loading = false; state.pendingRange = null; state.progressRequestId = null;
  void send({ type: 'CANCEL_REPORT' }).catch(() => {});
  hideProgress(); renderRangeContext();
  setDownloadsAvailable(Boolean(state.range && filterReportRecords(state.records, selectedFilters()).length));
  setInvoiceAvailable(state.range ? currentFilteredRecords() : []);
}

function selectCalendarDay(date) {
  cancelPendingPeriod(); state.preset = 'custom'; state.focusedDay = date;
  const start = $('start-date').value, end = $('end-date').value;
  if (!start || end || date < start) { $('start-date').value = date; $('end-date').value = ''; }
  else $('end-date').value = date;
  renderCalendar(true);
  if ($('end-date').value) void applyPeriod();
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
    date: recordDate(record),
    rate: rateForUser(record.user, state.billing.rates, recordDate(record)),
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
  const allTimeRepositories = [...new Set(state.records.map(record => timeRepository(record)))];
  $('people-all').textContent = allPeople.length && allPeople.every(value => state.people.has(value)) ? 'Unselect all' : 'Select all';
  $('projects-all').textContent = allProjects.length && allProjects.every(value => state.projects.has(value)) ? 'Unselect all' : 'Select all';
  $('repositories-all').textContent = allRepositories.length && allRepositories.every(value => state.repositories.has(value)) ? 'Unselect all' : 'Select all';
  $('timeRepositories-all').textContent = allTimeRepositories.length && allTimeRepositories.every(value => state.timeRepositories.has(value)) ? 'Unselect all' : 'Select all';
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
  const requestId = ++state.requestId, reportingUtc = state.reportingUtc;
  resetInvoiceReservation(); state.invoiceCompositionKey = '';
  state.progressRequestId = requestId; state.progressValue = 0; state.pendingRange = range; state.loading = true; state.analyticsRequestId += 1; setError();
  setDownloadsAvailable(false); setInvoiceActionsAvailable(false); setInvoiceAvailable(currentFilteredRecords()); renderRangeContext();
  showProgress('Loading time data…', 10); $('setup').hidden = true;
  try {
    const result = await send({ type: 'LOAD_REPORT', payload: { startDate: range.startDate, endDate: range.endDate, reportingUtc, requestId } });
    if (requestId !== state.requestId) return;
    if (!result.configured) {
      $('setup').hidden = false; $('period-card').hidden = true; $('report-content').hidden = true;
      state.range = null; state.records = []; return;
    }
    showProgress('Preparing report…', 80);
    const firstLoad = !state.range;
    state.range = range; state.pendingRange = null; state.loading = false; state.exchangeRates = null; state.exchangeKey = '';
    // Project the reporting date once so billing and invoice consumers share the report basis.
    state.records = result.records.map(record => ({ ...record, entryDate: recordDate(record, reportingUtc) }));
    state.sourceRepository = result.sourceRepository; state.branch = result.branch;
    state.sourceRepositories = result.sourceRepositories || (result.sourceRepository ? [result.sourceRepository] : []);
    state.partial = Boolean(result.partial); state.readStatus = result.readStatus || [];
    const failed = state.readStatus.filter(item => item.status === 'error');
    const conflictCount = result.conflicts?.length || 0;
    $('partial-status').hidden = !state.partial;
    $('partial-status').textContent = !state.partial ? '' : [failed.length ? `${failed.length} time ${failed.length === 1 ? 'repository' : 'repositories'} could not be loaded.` : '', conflictCount ? `${conflictCount} conflicting ${conflictCount === 1 ? 'record was' : 'records were'} omitted.` : '', 'Exports are disabled until the report is complete.'].filter(Boolean).join(' ');
    state.billing = { rates: result.billing?.rates || {}, invoicing: invoicingSettings(result.billing) };
    state.projectDefinitions = result.billing?.projects || [];
    state.otherProjectName = result.billing?.otherProjectName || 'Other';
    state.otherProjectClient = result.billing?.otherProjectClient || '';
    const available = buildFacets(result.records, { projectDefinitions: state.projectDefinitions, otherProjectName: state.otherProjectName });
    if (firstLoad) {
      state.allSelected = { people: false, projects: true, repositories: true, timeRepositories: true };
      const currentUsers = result.currentUsers ? Object.values(result.currentUsers) : (result.currentUser ? [result.currentUser] : []);
      state.people = new Set(currentUsers.filter(Boolean));
      state.projects = new Set(available.projects.map(project => project.value));
      state.repositories = new Set(available.repositories.map(repository => repository.value));
      state.timeRepositories = new Set(available.timeRepositories.map(repository => repository.value));
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
  return { ...periodRange(state.preset, reportToday(), { startDate: $('start-date').value, endDate: $('end-date').value }), preset: state.preset };
}

async function applyPeriod(preserveDraft = false) {
  try {
    if (preserveDraft && state.range && state.preset === 'custom' && (!$('start-date').value || !$('end-date').value || $('end-date').value < $('start-date').value)) {
      const preset = state.range.preset;
      await loadRange(preset && preset !== 'custom' ? { ...periodRange(preset, reportToday()), preset } : state.range); return;
    }
    const range = currentRange();
    $('start-date').value = range.startDate; $('end-date').value = range.endDate;
    closePeriod(); await loadRange(range);
  } catch (error) { setError(error); }
}

$('period-trigger').addEventListener('click', () => {
  if (!$('period-popover').hidden) { closePeriod(); return; }
  if (state.range) { $('start-date').value = state.range.startDate; $('end-date').value = state.range.endDate; state.preset = state.range.preset || 'custom'; }
  state.calendarMonth = ($('start-date').value || reportToday()).slice(0, 7); state.focusedDay = $('start-date').value;
  $('period-popover').hidden = false; $('period-trigger').setAttribute('aria-expanded', 'true'); renderReportingBasis(); renderCalendar(true);
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !$('period-popover').hidden) { event.preventDefault(); closePeriod(); }
});
document.addEventListener('click', event => {
  if (!$('period-popover').hidden && !$('period-popover').contains(event.target) && !event.composedPath?.().includes($('period-popover')) && !$('period-trigger').contains(event.target)) closePeriod();
});
for (const [id, offset] of [['calendar-previous', -1], ['calendar-next', 1]]) $(id).addEventListener('click', () => {
  const month = new Date(`${state.calendarMonth}-01T00:00:00Z`); month.setUTCMonth(month.getUTCMonth() + offset);
  state.calendarMonth = month.toISOString().slice(0, 7); renderCalendar();
});
for (const id of ['start-date', 'end-date']) $(id).addEventListener('change', () => {
  cancelPendingPeriod(); state.preset = 'custom';
  if ($(id).value) { state.calendarMonth = $(id).value.slice(0, 7); state.focusedDay = $(id).value; }
  renderCalendar();
  if ($('start-date').value && $('end-date').value) void applyPeriod();
});
for (const preset of PERIOD_PRESETS) $(`preset-${preset}`).addEventListener('click', () => { state.preset = preset; void applyPeriod(); });
$('reporting-utc').addEventListener('change', async () => {
  const reportingUtc = $('reporting-utc').checked;
  state.savingBasis = true; $('reporting-utc').disabled = true; cancelPendingPeriod();
  try {
    await send({ type: 'UPDATE_DISPLAY_PREFERENCES', payload: { reportingUtc } });
    state.reportingUtc = reportingUtc; renderReportingBasis(); await applyPeriod(true);
  } catch (error) { renderReportingBasis(); setError(error); }
  finally { state.savingBasis = false; $('reporting-utc').disabled = false; }
});
for (const id of ['metric', 'billable-currency', 'horizontal-axis', 'stack-by']) $(id).addEventListener('change', render);
$('analytics-details').addEventListener('toggle', () => { if (state.analytics) renderAnalyticsTable(state.analytics); });
$('people-search').addEventListener('input', event => { state.peopleSearch = event.target.value; render(); });
$('projects-search').addEventListener('input', event => { state.projectsSearch = event.target.value; render(); });
$('repositories-search').addEventListener('input', event => { state.repositoriesSearch = event.target.value; render(); });
$('timeRepositories-search').addEventListener('input', event => { state.timeRepositoriesSearch = event.target.value; render(); });
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
$('timeRepositories-all').addEventListener('click', () => {
  const values = [...new Set(state.records.map(record => timeRepository(record)))];
  state.timeRepositories = values.length && values.every(value => state.timeRepositories.has(value)) ? new Set() : new Set(values); updateSelectionIntent('timeRepositories');
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
  if (state.loading || state.partial || !state.range || !filtered.length) return;
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
  if (state.loading || state.partial || $('download-pdf').classList.contains('disabled')) return;
  const previousTitle = document.title;
  document.title = pdfDocumentTitle();
  addEventListener('afterprint', () => { document.title = previousTitle; }, { once: true });
  window.print();
});

$('create-invoice').addEventListener('click', event => {
  event.preventDefault();
  if (state.loading || $('create-invoice').classList.contains('disabled')) return;
  const filtered = currentFilteredRecords(); prepareInvoiceControls(filtered); $('print-invoice').replaceChildren(); $('invoice-dialog').showModal(); void rebuildInvoicePreview();
});
$('invoice-add-line').addEventListener('click', () => {
  if (state.invoiceExtraLines.length >= 20) return;
  state.invoiceExtraLines.push({ description: '', amount: '' }); renderInvoiceExtraLines();
  const rows = $('invoice-extra-lines').children; rows[rows.length - 1].children[0].children[0].focus();
  resetInvoiceReservation(); void rebuildInvoicePreview();
});
$('invoice-close').addEventListener('click', () => $('invoice-dialog').close());
$('invoice-dialog').addEventListener('close', () => { state.invoiceRequestId += 1; $('create-invoice').focus(); });
for (const id of ['invoice-currency', 'invoice-group-by', 'invoice-issue-date']) {
  $(id).addEventListener('change', () => { resetInvoiceReservation(); void rebuildInvoicePreview(); });
}
$('invoice-client').addEventListener('change', () => {
  state.invoiceClientChosen = true; resetInvoiceReservation(); resetInvoiceProjects(currentFilteredRecords()); populateInvoiceCurrencies(invoiceFilteredRecords(), true); void rebuildInvoicePreview();
});
function invoicePdfFilename(invoice) {
  const words = String(invoice.seller?.name || 'Seller').trim().split(/\s+/).filter(Boolean);
  const first = words.shift() || 'Seller', last = words.pop() || first;
  const safe = value => String(value).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
  return `${safe(first)}-${safe(last)}-${safe(invoice.number || 'invoice')}.pdf`;
}

async function printInvoice({ saveAsPdf = false } = {}) {
  setInvoiceActionsAvailable(false); $('invoice-feedback').textContent = '';
  try {
    const invoice = await ensureReservedInvoice();
    if (saveAsPdf) {
      await saveInvoicePdf(invoice);
      setInvoiceActionsAvailable(Boolean(state.invoice));
      return;
    }
    const previousTitle = document.title;
    renderInvoiceDocument($('print-invoice'), invoice); document.body.classList.add('printing-invoice');
    document.title = `invoice-${invoice.number.replace(/[^A-Za-z0-9._-]/g, '_')}`;
    addEventListener('afterprint', () => { document.body.classList.remove('printing-invoice'); document.title = previousTitle; }, { once: true });
    window.print();
  } catch (error) { $('invoice-feedback').textContent = error?.message || 'Could not process invoice.'; setInvoiceActionsAvailable(Boolean(state.invoice)); }
}

$('invoice-print').addEventListener('click', () => void printInvoice());
$('invoice-save-pdf').addEventListener('click', () => void printInvoice({ saveAsPdf: true }));

async function refreshProjectDefinitions() {
  const preferences = await send({ type: 'GET_LOCAL_PREFERENCES' });
  state.billing = { rates: preferences.rates || {}, invoicing: invoicingSettings(preferences) };
  state.projectDefinitions = preferences.projects || [];
  state.otherProjectName = preferences.otherProjectName || 'Other';
  state.otherProjectClient = preferences.otherProjectClient || '';
  if (!state.savingBasis && state.reportingUtc !== (preferences.reportingUtc === true)) {
    state.reportingUtc = preferences.reportingUtc === true; renderReportingBasis(); await applyPeriod(true); return;
  }
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

async function initializePeriod() {
  try {
    const preferences = await send({ type: 'GET_LOCAL_PREFERENCES' });
    state.reportingUtc = preferences.reportingUtc === true; renderReportingBasis();
    const initial = { ...periodRange('last-week', reportToday()), preset: 'last-week' };
    $('start-date').value = initial.startDate; $('end-date').value = initial.endDate;
    await loadRange(initial);
  } catch (error) { setError(error); }
}
void initializePeriod();

mountRunningStatus($('running-status'), { send });
