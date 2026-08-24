import test from 'node:test';
import assert from 'node:assert/strict';
import {
  billableTotalsByCurrency, formatRateInput, normalizeBillingSettings, parseRateInput, rateForUser,
  settingsExportText, parseSettingsImport,
} from '../src/domain/local-settings.js';
import { buildAnalytics, exportTimesheet } from '../src/domain/reporting.js';

const record = (user, hours, date = '2026-08-17') => ({
  user, entryDate: date, startedAt: `${date}T09:00:00+00:00`, endedAt: `${date}T10:00:00+00:00`,
  durationSeconds: hours * 3600, taskUrl: `https://example.com/${user}`,
});

test('hourly rates accept and preserve currency signs or descriptions on either side', () => {
  assert.deepEqual(parseRateInput('20.15$'), { amountMinorPerHour: 2015, currency: '$', currencyPosition: 'suffix' });
  assert.deepEqual(parseRateInput('$15.5'), { amountMinorPerHour: 1550, currency: '$', currencyPosition: 'prefix' });
  assert.deepEqual(parseRateInput('€55.5'), { amountMinorPerHour: 5550, currency: '€', currencyPosition: 'prefix' });
  assert.deepEqual(parseRateInput('750 RUB'), { amountMinorPerHour: 75000, currency: 'RUB', currencyPosition: 'suffix' });
  assert.deepEqual(parseRateInput('888GEL'), { amountMinorPerHour: 88800, currency: 'GEL', currencyPosition: 'suffix' });
  assert.equal(formatRateInput(parseRateInput('$15.5')), '$15.50');
  assert.equal(formatRateInput(parseRateInput('750 RUB')), '750.00 RUB');
  for (const invalid of ['20.15', '$', 'USD', '$1.234', '1 USD extra', '-5 EUR', '1e3 USD']) {
    assert.throws(() => parseRateInput(invalid), /rate|currency/i, invalid);
  }
});

test('currency belongs to each effective-dated rate and legacy global currency migrates safely', () => {
  assert.deepEqual(normalizeBillingSettings({ currency: 'usd', rates: { alice: 10000 } }), {
    rates: { alice: [{ amountMinorPerHour: 10000, currency: 'USD', currencyPosition: 'suffix', startDate: '', endDate: '' }] },
  });
  const billing = normalizeBillingSettings({ rates: {
    alice: [
      { ...parseRateInput('$20.15'), startDate: '2026-01-01', endDate: '2026-06-30' },
      { ...parseRateInput('30 EUR'), startDate: '2026-07-01', endDate: '' },
    ],
  } });
  assert.equal(rateForUser('ALICE', billing.rates, '2026-06-30').currency, '$');
  assert.equal(rateForUser('alice', billing.rates, '2026-07-01').currency, 'EUR');
  assert.equal(Object.hasOwn(billing, 'currency'), false);
});

test('mixed-currency totals remain separate and billable analytics selects one currency', () => {
  const rates = {
    alice: [{ ...parseRateInput('$20.15'), startDate: '', endDate: '' }],
    bob: [{ ...parseRateInput('750 RUB'), startDate: '', endDate: '' }],
  };
  const records = [record('alice', 1), record('bob', 2)];
  assert.deepEqual(billableTotalsByCurrency(records, rates), [
    { currency: '$', currencyPosition: 'prefix', amountMinor: 2015 },
    { currency: 'RUB', currencyPosition: 'suffix', amountMinor: 150000 },
  ]);
  const dollars = buildAnalytics(records, { metric: 'billable-amount', horizontalAxis: 'person', stackBy: 'person', rates, currency: '$' });
  assert.deepEqual(dollars.buckets.map(bucket => [bucket.key, bucket.totalValue]), [['alice', 2015]]);
  const rubles = buildAnalytics(records, { metric: 'billable-amount', horizontalAxis: 'person', stackBy: 'person', rates, currency: 'RUB' });
  assert.deepEqual(rubles.buckets.map(bucket => [bucket.key, bucket.totalValue]), [['bob', 150000]]);
  assert.throws(() => buildAnalytics(records, {
    metric: 'billable-amount', horizontalAxis: 'person', stackBy: 'person', rates,
  }), /select one currency/i);
});

test('timesheet exports each record rate currency and settings v2 has no global currency', () => {
  const rates = {
    alice: [{ ...parseRateInput('$20.15'), startDate: '', endDate: '' }],
    bob: [{ ...parseRateInput('750 RUB'), startDate: '', endDate: '' }],
  };
  const records = [record('alice', 1), record('bob', 2)];
  const json = JSON.parse(exportTimesheet(records, { format: 'json', startDate: '2026-08-17', endDate: '2026-08-17', rates }));
  assert.deepEqual(json.entries.map(entry => [entry.hourlyRate, entry.billableAmount, entry.currency]), [
    ['20.15', '20.15', '$'], ['750.00', '1500.00', 'RUB'],
  ]);
  const csv = exportTimesheet(records, { format: 'csv', startDate: '2026-08-17', endDate: '2026-08-17', rates });
  assert.match(csv, /20\.15,20\.15,\$/);
  assert.match(csv, /750\.00,1500\.00,RUB/);

  const text = settingsExportText({ billing: { rates }, config: { recentDays: 7 }, exportedAt: '2026-08-23T12:00:00.000Z' });
  const saved = JSON.parse(text);
  assert.equal(saved.version, 2);
  assert.deepEqual(Object.keys(saved.billing), ['rates']);
  assert.deepEqual(parseSettingsImport(text).billing, { rates });
});
