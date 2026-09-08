import { exchangeCurrencyCode, formatInvoiceNumber, invoicingSettings, parseRateFields, rateForUser } from './local-settings.js';
import { csvCell, validateDateRange } from './reporting.js';
import { taskUrlOf } from './values.js';

function recordDate(record) { return String(record?.entryDate || record?.startedAt || '').slice(0, 10); }
function currencyCode(currency, target) { return currency === target ? currency : exchangeCurrencyCode(currency); }

export function invoiceExchangeRequest(records, rates, targetCurrency) {
  const target = parseRateFields('0', targetCurrency).currency, sourceCurrencies = new Set(), dates = new Set();
  for (const record of records ?? []) {
    const date = recordDate(record), rate = rateForUser(record.user, rates, date);
    if (!rate || rate.currency === target) continue;
    const source = exchangeCurrencyCode(rate.currency);
    if (source === exchangeCurrencyCode(target)) continue;
    validateDateRange(date, date);
    sourceCurrencies.add(source); dates.add(date);
  }
  return { targetCurrency: target, sourceCurrencies: [...sourceCurrencies].sort(), dates: [...dates].sort() };
}

export function buildInvoice(records, {
  rates = {}, invoicing, clientId = '', currency = '', exchangeRates = null,
  groupBy = 'task', startDate, endDate, issueDate, dueDays = 30, sequence = null,
}) {
  const settings = invoicingSettings({ invoicing }), period = validateDateRange(startDate, endDate);
  validateDateRange(issueDate, issueDate);
  if (!['task', 'day'].includes(groupBy)) throw new Error('Invoice grouping must be task or day');
  if (!Number.isSafeInteger(dueDays) || dueDays < 0) throw new Error('Invoice due days must be a non-negative safe integer');
  const due = new Date(`${issueDate}T00:00:00Z`);
  due.setUTCDate(due.getUTCDate() + dueDays);
  if (!Number.isFinite(due.getTime()) || due.getUTCFullYear() > 9999) throw new Error('Invoice due date is out of range');
  const client = settings.clients.find(item => item.id === clientId) ?? null;
  if (clientId && !client) throw new Error('Invoice client was not found');
  const entries = (records ?? []).map(record => ({ record, rate: rateForUser(record.user, rates, recordDate(record)) }));
  const currencies = [...new Set(entries.filter(entry => entry.rate).map(entry => entry.rate.currency))];
  const target = currency || client?.defaultCurrency || (currencies.length === 1 ? currencies[0] : '');
  if (!target) throw new Error('Choose a target currency for the invoice; the records do not have a single rate currency');
  const { currency: targetCurrency, currencyPosition } = parseRateFields('0', target);
  const people = new Set(entries.filter(entry => entry.rate).map(({ record }) => String(record.user || ''))), groups = new Map(), uncovered = new Map();
  let converted = false;
  for (const { record, rate } of entries) {
    const date = recordDate(record), taskUrl = taskUrlOf(record), taskTitle = String(record.taskTitle ?? record.issueTitle ?? '').trim();
    const person = String(record.user || ''), seconds = Math.max(0, Number(record.durationSeconds) || 0);
    validateDateRange(date, date);
    if (!rate) { uncovered.set(person, (uncovered.get(person) ?? 0) + seconds); continue; }
    const sourceCode = currencyCode(rate.currency, targetCurrency), targetCode = currencyCode(targetCurrency, rate.currency);
    const factor = sourceCode === targetCode ? 1 : Number(exchangeRates?.[date]?.[sourceCode]);
    if (!Number.isFinite(factor) || !(factor > 0)) throw new Error(`No ${sourceCode} to ${targetCode} exchange rate for ${date}.`);
    if (sourceCode !== targetCode) converted = true;
    const key = JSON.stringify([...(groupBy === 'day' ? [date] : []), taskUrl, person, rate.amountMinorPerHour, rate.currency, ...(sourceCode !== targetCode ? [factor] : [])]);
    const line = groups.get(key) ?? {
      key, ...(groupBy === 'day' ? { date } : {}), taskUrl, taskTitle, person,
      description: `${taskTitle || taskUrl}${people.size > 1 ? ` — ${person}` : ''}`, seconds: 0, hours: 0,
      rateMinorPerHour: rate.amountMinorPerHour, rateCurrency: rate.currency, amountMinor: 0,
    };
    line.seconds += seconds; line.hours = line.seconds / 3600;
    // Round once at the completed line, then sum integer minors; never sum rounded majors.
    line.amountMinor += rate.amountMinorPerHour * seconds / 3600 * factor;
    groups.set(key, line);
  }
  const lines = [...groups.values()].sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.description.localeCompare(b.description));
  for (const line of lines) {
    line.amountMinor = Math.round(line.amountMinor);
    line.effectiveRateMinorPerHour = line.hours ? line.amountMinor / line.hours : 0;
  }
  const subtotalMinor = lines.reduce((sum, line) => sum + line.amountMinor, 0), taxMinor = Math.round(subtotalMinor * settings.taxPercent / 100);
  return {
    number: sequence === null ? '' : formatInvoiceNumber(settings.numberFormat, sequence, issueDate), sequence,
    issueDate, dueDate: due.toISOString().slice(0, 10), seller: settings.seller, client, period, groupBy, lines,
    unbilled: [...uncovered].map(([person, seconds]) => ({ person, seconds })).sort((a, b) => a.person.localeCompare(b.person)),
    subtotalMinor, taxMinor, totalMinor: subtotalMinor + taxMinor, taxPercent: settings.taxPercent,
    currency: targetCurrency, currencyPosition, paymentTerms: settings.paymentTerms, notes: settings.notes, converted,
  };
}

// Invoices and rates are browser-only exports; nothing invoice-related is written to the Git time-data repository.
export function invoiceCsv(invoice) {
  const byDay = invoice.groupBy === 'day', rows = [[...(byDay ? ['Date'] : []), 'Description', 'Person', 'Task URL', 'Hours', 'Hourly rate', 'Amount', 'Currency']];
  for (const line of invoice.lines) rows.push([...(byDay ? [line.date ?? ''] : []), line.description, line.person, line.taskUrl, line.hours.toFixed(2), (line.effectiveRateMinorPerHour / 100).toFixed(2), (line.amountMinor / 100).toFixed(2), invoice.currency]);
  rows.push([], ['Subtotal', (invoice.subtotalMinor / 100).toFixed(2), invoice.currency]);
  if (invoice.taxPercent !== 0) rows.push([`Tax ${invoice.taxPercent}%`, (invoice.taxMinor / 100).toFixed(2), invoice.currency]);
  rows.push(['Total', (invoice.totalMinor / 100).toFixed(2), invoice.currency]);
  for (const item of invoice.unbilled) rows.push(['Not billed', item.person, (item.seconds / 3600).toFixed(2)]);
  return `${rows.map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

export function invoiceJson(invoice) { return `${JSON.stringify(invoice, null, 2)}\n`; }

export function invoiceFilename(format, invoice) {
  if (!['csv', 'json', 'pdf'].includes(format)) throw new Error('Unknown invoice format');
  const number = String(invoice.number || 'preview').replace(/[^A-Za-z0-9._-]/g, '_');
  return `invoice-${number}.${format}`;
}
