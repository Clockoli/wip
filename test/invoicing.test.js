import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInvoice, invoiceCsv, invoiceJson, invoiceFilename } from '../src/domain/invoicing.js';
import { billableTotalsByCurrency, formatInvoiceNumber, invoicingSettings } from '../src/domain/local-settings.js';

const record = { user: 'alice', taskUrl: 'https://example.com/task', taskTitle: 'Task', entryDate: '2026-08-14', durationSeconds: 3600 };
const options = { rates: { alice: 12345 }, startDate: '2026-08-01', endDate: '2026-08-31', issueDate: '2026-09-01' };

test('invoice assembles seller, selected client, period, whole-cent tax, terms and UTC due date without mutation', () => {
  const invoicing = invoicingSettings({ invoicing: { seller: { name: 'Seller' }, clients: [{ id: 'c', name: 'Client', defaultCurrency: 'USD' }], taxPercent: 7.25, paymentTerms: 'Net 14', notes: 'Thanks' } });
  const input = structuredClone(invoicing), records = [structuredClone(record)];
  const invoice = buildInvoice(records, { ...options, invoicing, clientId: 'c', dueDays: 14, sequence: 7 });
  assert.deepEqual(invoice, {
    number: 'INV-2026-0007', sequence: 7, issueDate: '2026-09-01', dueDate: '2026-09-15', seller: invoicing.seller, client: invoicing.clients[0],
    period: { startDate: '2026-08-01', endDate: '2026-08-31' }, groupBy: 'task',
    lines: [{ key: JSON.stringify([record.taskUrl, 'alice', 12345, 'USD']), taskUrl: record.taskUrl, taskTitle: 'Task', person: 'alice', description: 'Task', seconds: 3600, hours: 1, rateMinorPerHour: 12345, effectiveRateMinorPerHour: 12345, rateCurrency: 'USD', amountMinor: 12345 }],
    unbilled: [], subtotalMinor: 12345, taxMinor: 895, totalMinor: 13240, taxPercent: 7.25, currency: 'USD', currencyPosition: 'suffix', paymentTerms: 'Net 14', notes: 'Thanks', converted: false,
  });
  assert.deepEqual(invoicing, input);
  assert.deepEqual(records, [record]);
  assert.equal(buildInvoice(records, { ...options, issueDate: '2028-02-28', dueDays: 2 }).dueDate, '2028-03-01');
  assert.equal(buildInvoice(records, { ...options, issueDate: '2026-12-31', dueDays: 1 }).dueDate, '2027-01-01');
});

test('uncovered records remain visible but only billed people determine description suffixes', () => {
  const records = [record, { ...record, user: 'zoe', durationSeconds: 600 }, { ...record, user: 'bob', durationSeconds: 300 }, { ...record, user: 'zoe', durationSeconds: 120 }];
  const invoice = buildInvoice(records, options);
  assert.deepEqual(invoice.unbilled, [{ person: 'bob', seconds: 300 }, { person: 'zoe', seconds: 720 }]);
  assert.equal(invoice.lines[0].description, 'Task');
  assert.equal(invoice.totalMinor, 12345);
  assert.equal(invoice.number, '');
  assert.equal(invoice.sequence, null);
  assert.equal(invoice.client, null);
  assert.deepEqual(buildInvoice(records, { ...options, rates: {}, currency: '$' }).unbilled, [{ person: 'alice', seconds: 3600 }, { person: 'bob', seconds: 300 }, { person: 'zoe', seconds: 720 }]);
  const multiple = buildInvoice(records, { ...options, rates: { ...options.rates, bob: 10000 } });
  assert.deepEqual(multiple.lines.map(line => line.description), ['Task — alice', 'Task — bob']);
  assert.deepEqual(multiple.unbilled, [{ person: 'zoe', seconds: 720 }]);
});

test('day grouping sorts by date then description and task grouping preserves canonical URL identity', () => {
  const records = [{ ...record, taskTitle: 'Z', entryDate: '2026-08-15' }, { ...record, taskTitle: '', taskUrl: 'https://github.com/acme/app/issues/7?x=1#comment' }, { ...record, taskTitle: '', taskUrl: 'https://github.com/acme/app/issues/7' }];
  const invoice = buildInvoice(records, { ...options, groupBy: 'day' });
  assert.deepEqual(invoice.lines.map(line => [line.date, line.description, line.hours]), [['2026-08-14', 'https://github.com/acme/app/issues/7', 2], ['2026-08-15', 'Z', 1]]);
  const byTask = buildInvoice([record, { ...record, entryDate: '2026-08-15' }], options);
  assert.equal(byTask.lines.length, 1);
  assert.equal(Object.hasOwn(byTask.lines[0], 'date'), false);
  assert.equal(byTask.lines[0].seconds, 7200);
});

test('invoice target currency follows explicit, client, then covered-rate precedence', () => {
  const mixed = { ...options, rates: { alice: { amountMinorPerHour: 10000, currency: 'EUR' }, bob: 10000 } };
  const records = [record, { ...record, user: 'bob' }];
  assert.throws(() => buildInvoice(records, mixed), /target currency/i);
  assert.throws(() => buildInvoice([], options), /target currency/i);
  const invoicing = { clients: [{ id: 'c', defaultCurrency: 'EUR' }] };
  const exchangeRates = { '2026-08-14': { EUR: 2, USD: 0.5 } };
  assert.equal(buildInvoice(records, { ...mixed, invoicing, clientId: 'c', exchangeRates }).currency, 'EUR');
  assert.equal(buildInvoice(records, { ...mixed, invoicing, clientId: 'c', exchangeRates, currency: 'usd' }).currency, 'USD');
  assert.equal(buildInvoice([record], { ...options, currency: '$' }).currencyPosition, 'prefix');
  assert.throws(() => buildInvoice([record], { ...options, clientId: 'missing' }), /client/i);
  for (const override of [{ groupBy: 'person' }, { issueDate: '2026-02-30' }, { endDate: '2026-07-01' }, { dueDays: -1 }, { dueDays: 1.5 }]) assert.throws(() => buildInvoice([record], { ...options, ...override }));
});

test('invoice numbers validate dates and formats, pad short sequences and retain long ones', () => {
  assert.equal(formatInvoiceNumber('{YYYY}-{MM}-{NNNN}-{NNNN}', 7, '2026-08-14'), '2026-08-0007-0007');
  assert.equal(formatInvoiceNumber('INV-{NNNN}', 12345, '2026-08-14'), 'INV-12345');
  for (const date of ['', '2026-02-29', '2026-13-01', '2026-8-14']) assert.throws(() => formatInvoiceNumber('INV-{NNNN}', 1, date));
  for (const sequence of [0, -1, 1.1, '7', NaN, 1e9 + 1]) assert.throws(() => formatInvoiceNumber('INV-{NNNN}', sequence, '2026-08-14'));
  assert.throws(() => formatInvoiceNumber('{DD}-{NNNN}', 1, '2026-08-14'));
});

test('short entries accumulate exact contributions then round once per completed line', () => {
  const records = Array.from({ length: 7 }, () => ({ ...record, durationSeconds: 7 * 60 }));
  const invoice = buildInvoice(records, options), expected = billableTotalsByCurrency(records, options.rates)[0].amountMinor;
  assert.equal(invoice.totalMinor, Math.round(expected));
  assert.equal(Math.round(invoice.totalMinor), Math.round(expected));
  assert.notEqual(Math.round(invoice.totalMinor), records.reduce((sum, entry) => sum + Math.round(12345 * entry.durationSeconds / 3600), 0));
  assert.equal(invoice.subtotalMinor, invoice.lines.reduce((sum, line) => sum + line.amountMinor, 0));
  assert.equal(invoiceCsv(invoice), [
    'Description,Person,Task URL,Hours,Hourly rate,Amount,Currency',
    'Task,alice,https://example.com/task,0.82,123.45,100.82,USD',
    '', 'Subtotal,100.82,USD', 'Total,100.82,USD', '',
  ].join('\r\n'));
});

test('separate fractional-cent lines foot to their rounded sum before tax', () => {
  const records = Array.from({ length: 3 }, (_, index) => ({ ...record, taskUrl: `${record.taskUrl}/${index}`, durationSeconds: 60 }));
  const invoice = buildInvoice(records, { ...options, rates: { alice: 10000 }, invoicing: { taxPercent: 7.25 } });
  assert.deepEqual(invoice.lines.map(line => line.amountMinor), [167, 167, 167]);
  assert.equal(invoice.subtotalMinor, 501);
  assert.equal(invoice.taxMinor, 36);
  assert.equal(invoice.totalMinor, 537);
  assert.ok([...invoice.lines.map(line => line.amountMinor), invoice.subtotalMinor, invoice.taxMinor, invoice.totalMinor].every(Number.isInteger));
  assert.match(invoiceCsv(invoice), /Subtotal,5.01,USD\r\nTax 7.25%,0.36,USD\r\nTotal,5.37,USD/);
});

test('converted lines split by exchange factor and expose the effective rate used by CSV', () => {
  const records = [record, { ...record, entryDate: '2026-08-15' }, { ...record, entryDate: '2026-08-16' }];
  const invoice = buildInvoice(records, { ...options, rates: { alice: 10000 }, currency: 'EUR', exchangeRates: {
    '2026-08-14': { USD: 0.9 }, '2026-08-15': { USD: 0.8 }, '2026-08-16': { USD: 0.9 },
  } });
  assert.equal(invoice.lines.length, 2);
  assert.deepEqual(invoice.lines.map(line => [line.hours, line.rateMinorPerHour, line.effectiveRateMinorPerHour, line.amountMinor]), [[2, 10000, 9000, 18000], [1, 10000, 8000, 8000]]);
  assert.equal(invoice.subtotalMinor, 26000);
  assert.match(invoiceCsv(invoice), /,2.00,90.00,180.00,EUR\r\n/);
  assert.match(invoiceCsv(invoice), /,1.00,80.00,80.00,EUR\r\n/);
  const short = buildInvoice([{ ...record, durationSeconds: 60 }], { ...options, rates: { alice: 10000 } });
  assert.equal(short.lines[0].effectiveRateMinorPerHour, short.lines[0].amountMinor / short.lines[0].hours);
  const zero = buildInvoice([{ ...record, durationSeconds: 0 }], options);
  assert.equal(zero.lines[0].effectiveRateMinorPerHour, 0);
});

test('invoice CSV reuses safe quoting, JSON preserves the document and filenames sanitize numbers', () => {
  const invoice = buildInvoice([{ ...record, taskTitle: '=SUM(1,2)"' }], { ...options, sequence: 7 });
  const csv = invoiceCsv(invoice);
  assert.ok(csv.startsWith('Description,Person,Task URL,Hours,Hourly rate,Amount,Currency\r\n'));
  assert.ok(csv.includes('"\'=SUM(1,2)"""'));
  assert.ok(csv.includes(',1.00,123.45,123.45,USD\r\n'));
  assert.deepEqual(JSON.parse(invoiceJson(invoice)), invoice);
  assert.equal(invoiceFilename('csv', invoice), 'invoice-INV-2026-0007.csv');
  assert.equal(invoiceFilename('json', { ...invoice, number: '../../bad / number' }), 'invoice-.._.._bad___number.json');
  assert.equal(invoiceFilename('json', { ...invoice, number: '' }), 'invoice-preview.json');
  assert.throws(() => invoiceFilename('../csv', invoice), /format/i);
});

test('day invoice CSV formats major amounts, tax and unbilled hours for the recipient', () => {
  const invoice = buildInvoice([record, { ...record, user: 'bob', durationSeconds: 420 }], { ...options, groupBy: 'day', invoicing: { taxPercent: 7.25 } });
  const before = structuredClone(invoice);
  assert.equal(invoiceCsv(invoice), [
    'Date,Description,Person,Task URL,Hours,Hourly rate,Amount,Currency',
    '2026-08-14,Task,alice,https://example.com/task,1.00,123.45,123.45,USD',
    '', 'Subtotal,123.45,USD', 'Tax 7.25%,8.95,USD', 'Total,132.40,USD', 'Not billed,bob,0.12', '',
  ].join('\r\n'));
  assert.deepEqual(invoice, before);
});
