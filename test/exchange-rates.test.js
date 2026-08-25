import test from 'node:test';
import assert from 'node:assert/strict';
import { ExchangeRateService } from '../src/services/exchange-rates.js';
import { exchangeCurrencyCode } from '../src/domain/local-settings.js';

const response = value => ({ ok: true, json: async () => value });

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
