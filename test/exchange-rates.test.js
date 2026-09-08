import test from 'node:test';
import assert from 'node:assert/strict';
import { ExchangeRateService } from '../src/services/exchange-rates.js';
import { exchangeCurrencyCode } from '../src/domain/local-settings.js';
import { buildInvoice, invoiceExchangeRequest } from '../src/domain/invoicing.js';

const response = value => ({ ok: true, json: async () => value });

test('invoice conversion uses each record date and requests only needed currencies and dates', () => {
  const records = ['2026-08-14', '2026-08-15'].map(entryDate => ({ user: 'alice', taskUrl: 'https://example.com/task', entryDate, durationSeconds: 1800 }));
  const rates = { alice: { amountMinorPerHour: 10000, currency: '€' }, bob: { amountMinorPerHour: 20000, currency: 'USD' } };
  const options = { rates, currency: 'USD', startDate: '2026-08-01', endDate: '2026-08-31', issueDate: '2026-09-01', exchangeRates: { '2026-08-14': { EUR: 1.1 }, '2026-08-15': { EUR: 1.2 } } };
  const invoice = buildInvoice(records, options);
  // A line never blends two exchange factors, so one task across two dates bills as two lines.
  assert.equal(invoice.lines.length, 2);
  assert.deepEqual(invoice.lines.map(line => line.amountMinor), [5500, 6000]);
  assert.equal(invoice.subtotalMinor, 11500);
  assert.equal(invoice.converted, true);
  assert.deepEqual(invoiceExchangeRequest([...records, records[0], { ...records[0], user: 'bob', entryDate: '2026-08-16' }, { ...records[0], user: 'unrated', entryDate: '2026-08-17' }], rates, 'usd'), { targetCurrency: 'USD', sourceCurrencies: ['EUR'], dates: ['2026-08-14', '2026-08-15'] });
  for (const factor of [undefined, 0, -1, NaN, Infinity]) {
    assert.throws(() => buildInvoice(records, { ...options, exchangeRates: { '2026-08-15': { EUR: factor }, '2026-08-14': { EUR: 1.1 } } }), /No EUR to USD exchange rate for 2026-08-15\./);
  }
  assert.deepEqual(invoiceExchangeRequest(records, rates, 'EUR'), { targetCurrency: 'EUR', sourceCurrencies: [], dates: [] });
  assert.equal(buildInvoice(records, { ...options, currency: 'EUR', exchangeRates: null }).converted, false);
});

test('currency signs map to Frankfurter ISO codes', () => {
  assert.equal(exchangeCurrencyCode('$'), 'USD');
  assert.equal(exchangeCurrencyCode('€'), 'EUR');
  assert.equal(exchangeCurrencyCode('£'), 'GBP');
  assert.equal(exchangeCurrencyCode('JPY'), 'JPY');
  assert.throws(() => exchangeCurrencyCode('credits'), /not supported for exchange-rate conversion/i);
});

test('one Frankfurter range request converts all sources and forward-fills non-business days', async () => {
  const requests = [], saved = [];
  const service = new ExchangeRateService({
    cache: { getExchangeRateCache: async () => null, saveExchangeRateCache: async value => saved.push(structuredClone(value)) },
    fetchImpl: async url => {
      requests.push(url);
      return response({ base: 'EUR', start_date: '2024-01-05', end_date: '2024-01-08', rates: {
        '2024-01-05': { USD: 1.10, GBP: 0.86 },
        '2024-01-08': { USD: 1.12, GBP: 0.87 },
      } });
    },
    now: () => new Date('2024-02-01T00:00:00Z'),
  });
  const result = await service.ratesForDates({ targetCurrency: 'EUR', sourceCurrencies: ['$', 'GBP', 'EUR'], dates: ['2024-01-06', '2024-01-07', '2024-01-08'] });
  assert.equal(requests.length, 1);
  assert.match(requests[0], /\/v1\/2024-01-06\.\.2024-01-08\?base=EUR&symbols=GBP%2CUSD$/);
  assert.deepEqual(result, {
    targetCurrency: 'EUR', targetCode: 'EUR',
    rates: {
      '2024-01-06': { EUR: 1, GBP: 1 / 0.86, USD: 1 / 1.10 },
      '2024-01-07': { EUR: 1, GBP: 1 / 0.86, USD: 1 / 1.10 },
      '2024-01-08': { EUR: 1, GBP: 1 / 0.87, USD: 1 / 1.12 },
    },
  });
  assert.equal(saved.length, 1);
});

test('cached exact historical factors avoid another Frankfurter request', async () => {
  const cached = { version: 2, entries: { 'EUR|2024-01-08|USD': { factor: 0.9, effectiveDate: '2024-01-08', fetchedAt: '2024-02-01T00:00:00.000Z' } } };
  const service = new ExchangeRateService({ cache: { getExchangeRateCache: async () => cached, saveExchangeRateCache: async () => assert.fail('must not save') }, fetchImpl: async () => assert.fail('must not fetch'), now: () => new Date('2024-02-02T00:00:00Z') });
  const result = await service.ratesForDates({ targetCurrency: 'EUR', sourceCurrencies: ['$'], dates: ['2024-01-08'] });
  assert.equal(result.rates['2024-01-08'].USD, 0.9);
});

test('a weekday fallback is refreshed after that date receives its own published rate', async () => {
  let cache = null, now = new Date('2024-01-08T08:00:00Z'), fetches = 0;
  const service = new ExchangeRateService({
    cache: {
      getExchangeRateCache: async () => structuredClone(cache),
      saveExchangeRateCache: async value => { cache = structuredClone(value); },
    },
    fetchImpl: async () => {
      fetches += 1;
      return response({ base: 'EUR', rates: fetches === 1
        ? { '2024-01-05': { USD: 1.10 } }
        : { '2024-01-05': { USD: 1.10 }, '2024-01-08': { USD: 1.20 } } });
    },
    now: () => now,
  });
  const request = { targetCurrency: 'EUR', sourceCurrencies: ['USD'], dates: ['2024-01-08'] };
  assert.equal((await service.ratesForDates(request)).rates['2024-01-08'].USD, 1 / 1.10);
  now = new Date('2024-01-09T08:00:00Z');
  assert.equal((await service.ratesForDates(request)).rates['2024-01-08'].USD, 1 / 1.20);
  assert.equal(fetches, 2);
  assert.equal(cache.entries['EUR|2024-01-08|USD'].effectiveDate, '2024-01-08');
});

test('a weekend carry-forward remains reusable after its publication window', async () => {
  const cached = { version: 2, entries: {
    'EUR|2024-01-06|USD': { factor: 0.9, effectiveDate: '2024-01-05', fetchedAt: '2024-01-06T08:00:00.000Z' },
  } };
  const service = new ExchangeRateService({
    cache: { getExchangeRateCache: async () => cached, saveExchangeRateCache: async () => assert.fail('must not save') },
    fetchImpl: async () => assert.fail('must not fetch'), now: () => new Date('2024-02-01T00:00:00Z'),
  });
  const result = await service.ratesForDates({ targetCurrency: 'EUR', sourceCurrencies: ['USD'], dates: ['2024-01-06'] });
  assert.equal(result.rates['2024-01-06'].USD, 0.9);
});

test('an old weekday holiday fallback stops rechecking after a bounded publication window', async () => {
  const cached = { version: 2, entries: {
    'EUR|2024-01-01|USD': { factor: 0.9, effectiveDate: '2023-12-29', fetchedAt: '2024-01-01T08:00:00.000Z' },
  } };
  const service = new ExchangeRateService({
    cache: { getExchangeRateCache: async () => cached, saveExchangeRateCache: async () => assert.fail('must not save') },
    fetchImpl: async () => assert.fail('must not fetch'), now: () => new Date('2024-01-09T00:00:00Z'),
  });
  const result = await service.ratesForDates({ targetCurrency: 'EUR', sourceCurrencies: ['USD'], dates: ['2024-01-01'] });
  assert.equal(result.rates['2024-01-01'].USD, 0.9);
});

test('missing Frankfurter currency fails instead of silently dropping billable records', async () => {
  const service = new ExchangeRateService({
    cache: { getExchangeRateCache: async () => null, saveExchangeRateCache: async () => {} },
    fetchImpl: async () => response({ base: 'EUR', rates: { '2024-01-08': { USD: 1.1 } } }),
  });
  await assert.rejects(service.ratesForDates({ targetCurrency: 'EUR', sourceCurrencies: ['USD', 'RUB'], dates: ['2024-01-08'] }), /RUB.*not available from Frankfurter/i);
});
