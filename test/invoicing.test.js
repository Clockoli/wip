import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInvoice } from '../src/domain/invoicing.js';
import { billableTotalsByCurrency, formatInvoiceNumber, invoicingSettings } from '../src/domain/local-settings.js';

const record = { user: 'alice', taskUrl: 'https://example.com/task', taskTitle: 'Task', description: 'Work description', entryDate: '2026-08-14', durationSeconds: 3600 };
const options = { rates: { alice: 12345 }, startDate: '2026-08-01', endDate: '2026-08-31', issueDate: '2026-09-01' };

test('invoice assembles seller, selected client, period, whole-cent tax, terms and UTC due date without mutation', () => {
  const invoicing = invoicingSettings({ invoicing: { seller: { name: 'Seller' }, clients: [{ id: 'c', name: 'Client', defaultCurrency: 'USD' }], taxPercent: 7.25, paymentTermsDays: 14, notes: 'Thanks' } });
  const input = structuredClone(invoicing), records = [structuredClone(record)];
  const invoice = buildInvoice(records, { ...options, invoicing, clientId: 'c', sequence: 7 });
  assert.deepEqual(invoice, {
    number: 'INV-2026-0007', sequence: 7, issueDate: '2026-09-01', dueDate: '2026-09-15', seller: invoicing.seller, client: invoicing.clients[0],
    period: { startDate: '2026-08-01', endDate: '2026-08-31' }, groupBy: 'task',
    lines: [{ key: JSON.stringify([record.taskUrl, 'alice', 'Work description', 12345, 'USD']), taskUrl: record.taskUrl, taskTitle: 'Task', person: 'alice', description: 'Work description', seconds: 3600, hours: 1, rateMinorPerHour: 12345, effectiveRateMinorPerHour: 12345, rateCurrency: 'USD', amountMinor: 12345 }],
    unbilled: [], subtotalMinor: 12345, taxMinor: 895, totalMinor: 13240, taxPercent: 7.25, currency: 'USD', currencyPosition: 'suffix', paymentTermsDays: 14, notes: 'Thanks', converted: false,
  });
  assert.deepEqual(invoicing, input);
  assert.deepEqual(records, [record]);
  assert.equal(buildInvoice(records, { ...options, issueDate: '2028-02-28', invoicing: { paymentTermsDays: 2 } }).dueDate, '2028-03-01');
  assert.equal(buildInvoice(records, { ...options, issueDate: '2026-12-31', invoicing: { paymentTermsDays: 1 } }).dueDate, '2027-01-01');
});

test('uncovered records remain visible but only billed people determine description suffixes', () => {
  const records = [record, { ...record, user: 'zoe', durationSeconds: 600 }, { ...record, user: 'bob', durationSeconds: 300 }, { ...record, user: 'zoe', durationSeconds: 120 }];
  const invoice = buildInvoice(records, options);
  assert.deepEqual(invoice.unbilled, [{ person: 'bob', seconds: 300 }, { person: 'zoe', seconds: 720 }]);
  assert.equal(invoice.lines[0].description, 'Work description');
  assert.equal(invoice.totalMinor, 12345);
  assert.equal(invoice.number, '');
  assert.equal(invoice.sequence, null);
  assert.equal(invoice.client, null);
  assert.deepEqual(buildInvoice(records, { ...options, rates: {}, currency: '$' }).unbilled, [{ person: 'alice', seconds: 3600 }, { person: 'bob', seconds: 300 }, { person: 'zoe', seconds: 720 }]);
  const multiple = buildInvoice(records, { ...options, rates: { ...options.rates, bob: 10000 } });
  assert.deepEqual(multiple.lines.map(line => line.description), ['Work description', 'Work description']);
  assert.deepEqual(multiple.unbilled, [{ person: 'zoe', seconds: 720 }]);
});

test('day grouping sorts by date then description and task grouping preserves canonical URL identity', () => {
  const records = [{ ...record, taskTitle: 'Z', entryDate: '2026-08-15' }, { ...record, taskTitle: '', taskUrl: 'https://github.com/acme/app/issues/7?x=1#comment' }, { ...record, taskTitle: '', taskUrl: 'https://github.com/acme/app/issues/7' }];
  const invoice = buildInvoice(records, { ...options, groupBy: 'day' });
  assert.deepEqual(invoice.lines.map(line => [line.date, line.description, line.hours]), [['2026-08-14', 'Work description', 2], ['2026-08-15', 'Work description', 1]]);
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
  for (const override of [{ groupBy: 'person' }, { issueDate: '2026-02-30' }, { endDate: '2026-07-01' }, { invoicing: { paymentTermsDays: -1 } }, { invoicing: { paymentTermsDays: 1.5 } }]) assert.throws(() => buildInvoice([record], { ...options, ...override }));
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
});

test('separate fractional-cent lines foot to their rounded sum before tax', () => {
  const records = Array.from({ length: 3 }, (_, index) => ({ ...record, taskUrl: `${record.taskUrl}/${index}`, durationSeconds: 60 }));
  const invoice = buildInvoice(records, { ...options, rates: { alice: 10000 }, invoicing: { taxPercent: 7.25 } });
  assert.deepEqual(invoice.lines.map(line => line.amountMinor), [167, 167, 167]);
  assert.equal(invoice.subtotalMinor, 501);
  assert.equal(invoice.taxMinor, 36);
  assert.equal(invoice.totalMinor, 537);
  assert.ok([...invoice.lines.map(line => line.amountMinor), invoice.subtotalMinor, invoice.taxMinor, invoice.totalMinor].every(Number.isInteger));
});

test('converted lines split by exchange factor and expose the effective target-currency rate', () => {
  const records = [record, { ...record, entryDate: '2026-08-15' }, { ...record, entryDate: '2026-08-16' }];
  const invoice = buildInvoice(records, { ...options, rates: { alice: 10000 }, currency: 'EUR', exchangeRates: {
    '2026-08-14': { USD: 0.9 }, '2026-08-15': { USD: 0.8 }, '2026-08-16': { USD: 0.9 },
  } });
  assert.equal(invoice.lines.length, 2);
  assert.deepEqual(invoice.lines.map(line => [line.hours, line.rateMinorPerHour, line.effectiveRateMinorPerHour, line.amountMinor]), [[2, 10000, 9000, 18000], [1, 10000, 8000, 8000]]);
  assert.equal(invoice.subtotalMinor, 26000);
  const short = buildInvoice([{ ...record, durationSeconds: 60 }], { ...options, rates: { alice: 10000 } });
  assert.equal(short.lines[0].effectiveRateMinorPerHour, short.lines[0].amountMinor / short.lines[0].hours);
  const zero = buildInvoice([{ ...record, durationSeconds: 0 }], options);
  assert.equal(zero.lines[0].effectiveRateMinorPerHour, 0);
});

test('extra lines append after time, remain in target currency, and affect tax without mutating input', () => {
  const extraLines = [{ description: '  Materials  ', amountMinor: 2500 }, { description: 'Discount', amountMinor: -500 }], before = structuredClone(extraLines);
  const invoice = buildInvoice([record], { ...options, currency: 'EUR', exchangeRates: { '2026-08-14': { USD: 2 } }, invoicing: { taxPercent: 20 }, extraLines });
  assert.deepEqual(invoice.lines.slice(1), [{ description: 'Materials', amountMinor: 2500 }, { description: 'Discount', amountMinor: -500 }]);
  assert.equal(invoice.subtotalMinor, 26690); assert.equal(invoice.taxMinor, 5338); assert.equal(invoice.totalMinor, 32028);
  assert.deepEqual(extraLines, before);
  assert.equal(buildInvoice([], { ...options, currency: 'EUR', extraLines }).totalMinor, 2000);
});

test('extra lines validate descriptions, signed safe integer amounts and the twenty-line limit', () => {
  assert.deepEqual(buildInvoice([], { ...options, currency: 'EUR', extraLines: [{ description: 'Weekend\nResearch', amountMinor: 500 }] }).lines,
    [{ description: 'Weekend\nResearch', amountMinor: 500 }]);
  const line = { description: 'x'.repeat(200), amountMinor: 0 };
  assert.equal(buildInvoice([record], { ...options, extraLines: Array(20).fill(line) }).lines.length, 21);
  for (const extraLines of [null, {}, Array(21).fill(line), [null], [{ ...line, description: ' ' }], [{ ...line, description: 'x'.repeat(201) }],
    ...['x\r', '\tx', 'x\u007f', 'x\u0085', 12].map(description => [{ ...line, description }]),
    ...[1.1, NaN, Infinity, '100', Number.MAX_SAFE_INTEGER + 1, -Number.MAX_SAFE_INTEGER - 1].map(amountMinor => [{ ...line, amountMinor }])]) {
    assert.throws(() => buildInvoice([record], { ...options, extraLines }), /extra line/i);
  }
  assert.throws(() => buildInvoice([record], { ...options, extraLines: [{ ...line, amountMinor: Number.MAX_SAFE_INTEGER }] }), /safe integer/i);
});

test('payment terms are the sole due-date source, including receipt, legacy text and rollover', () => {
  for (const [invoicing, dueDate, paymentTermsDays] of [[{ paymentTermsDays: 45 }, '2026-10-16', 45], [{ paymentTermsDays: 0 }, '2026-09-01', 0], [{ paymentTerms: 'Net 45' }, '2026-10-16', 45], [{}, '2026-10-01', 30]]) {
    const invoice = buildInvoice([record], { ...options, invoicing });
    assert.equal(invoice.dueDate, dueDate); assert.equal(invoice.paymentTermsDays, paymentTermsDays);
  }
});

test('signed extra lines cannot hide unsafe intermediate money sums through cancellation', () => {
  const extraLines = [Number.MAX_SAFE_INTEGER, 2, -2].map(amountMinor => ({ description: 'Adjustment', amountMinor }));
  assert.throws(() => buildInvoice([], { ...options, currency: 'EUR', extraLines }), /safe integer/i);
});
