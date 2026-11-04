import test from 'node:test';
import assert from 'node:assert/strict';
import {
  billableTotalsByCurrency, formatRateInput, normalizeBillingSettings, parseRateFields, rateForUser,
  settingsExportText, parseSettingsImport,
} from '../src/domain/local-settings.js';
import { buildAnalytics, exportTimesheet } from '../src/domain/reporting.js';

const record = (user, hours, date = '2026-08-17') => ({
  user, entryDate: date, startedAt: `${date}T09:00:00+00:00`, endedAt: `${date}T10:00:00+00:00`,
  durationSeconds: hours * 3600, taskUrl: `https://example.com/${user}`,
});

test('separate amount and currency fields report the field that is invalid', () => {
  assert.deepEqual(parseRateFields('15.50', 'USD'), { amountMinorPerHour: 1550, currency: 'USD', currencyPosition: 'suffix' });
  assert.deepEqual(parseRateFields('15.50', '$'), { amountMinorPerHour: 1550, currency: '$', currencyPosition: 'prefix' });
  assert.throws(() => parseRateFields('', 'USD'), /non-negative amount/i);
  assert.throws(() => parseRateFields('15.50', ''), /currency/i);
});

test('currency and effective dates belong to each client rate card', () => {
  const billing = normalizeBillingSettings({
    invoicing: { clients: [{ id: 'acme', name: 'Acme' }] },
    clientRates: { acme: { alice: [
      { ...parseRateFields('20.15', '$'), startDate: '2026-01-01', endDate: '2026-06-30' },
      { ...parseRateFields('30', 'EUR'), startDate: '2026-07-01', endDate: '' },
    ] } },
  });
  assert.equal(rateForUser('ALICE', billing.clientRates.acme, '2026-06-30').currency, '$');
  assert.equal(rateForUser('alice', billing.clientRates.acme, '2026-07-01').currency, 'EUR');
  assert.equal(rateForUser('alice', billing.clientRates.acme, '2099-12-31').currency, 'EUR');
  assert.equal(Object.hasOwn(billing, 'rates'), false);
});

test('a later client rate implicitly supersedes an open-ended period', () => {
  const base = { invoicing: { clients: [{ id: 'acme' }] } };
  const normalized = card => normalizeBillingSettings({ ...base, clientRates: { acme: card } });
  const billing = normalized({ alice: [
    { ...parseRateFields('20', 'USD'), startDate: '2026-01-01', endDate: '' },
    { ...parseRateFields('30', 'EUR'), startDate: '2026-09-01', endDate: '' },
  ] });
  assert.deepEqual(billing.clientRates.acme.alice.map(rate => [rate.startDate, rate.endDate, rate.currency]), [
    ['2026-01-01', '2026-08-31', 'USD'],
    ['2026-09-01', '', 'EUR'],
  ]);
  assert.equal(rateForUser('alice', billing.clientRates.acme, '2026-08-31').currency, 'USD');
  assert.equal(rateForUser('alice', billing.clientRates.acme, '2026-09-01').currency, 'EUR');
  assert.throws(() => normalized({ alice: [
    { ...parseRateFields('20', 'USD'), startDate: '2026-01-01', endDate: '2026-09-15' },
    { ...parseRateFields('30', 'EUR'), startDate: '2026-09-01', endDate: '' },
  ] }), /overlap/i);
  assert.throws(() => normalized({ alice: [
    { ...parseRateFields('20', 'USD'), startDate: '2026-09-01', endDate: '' },
    { ...parseRateFields('30', 'EUR'), startDate: '2026-09-01', endDate: '' },
  ] }), /overlap/i);
});

test('mixed-currency totals remain separate and billable analytics selects one currency', () => {
  const rates = {
    alice: [{ ...parseRateFields('20.15', '$'), startDate: '', endDate: '' }],
    bob: [{ ...parseRateFields('750', 'RUB'), startDate: '', endDate: '' }],
  };
  const records = [record('alice', 1), record('bob', 2)];
  assert.deepEqual(billableTotalsByCurrency(records, rates), [
    { currency: '$', currencyPosition: 'prefix', amountMinor: 2015 },
    { currency: 'RUB', currencyPosition: 'suffix', amountMinor: 150000 },
  ]);
  const dollars = buildAnalytics(records, {
    metric: 'billable-amount', horizontalAxis: 'person', stackBy: 'person', clientRates: { c: rates }, invoicing: { clients: [{ id: 'c' }] }, rateClientId: 'c', currency: '$',
    exchangeRates: { '2026-08-17': { RUB: 0.0125, USD: 1 } },
  });
  assert.deepEqual(dollars.buckets.map(bucket => [bucket.key, bucket.totalValue]), [['alice', 2015], ['bob', 1875]]);
  const rubles = buildAnalytics(records, {
    metric: 'billable-amount', horizontalAxis: 'person', stackBy: 'person', clientRates: { c: rates }, invoicing: { clients: [{ id: 'c' }] }, rateClientId: 'c', currency: 'RUB',
    exchangeRates: { '2026-08-17': { RUB: 1, USD: 80 } },
  });
  assert.deepEqual(rubles.buckets.map(bucket => [bucket.key, bucket.totalValue]), [['alice', 161200], ['bob', 150000]]);
  assert.throws(() => buildAnalytics(records, {
    metric: 'billable-amount', horizontalAxis: 'person', stackBy: 'person', clientRates: { c: rates }, invoicing: { clients: [{ id: 'c' }] }, rateClientId: 'c', currency: '$',
  }), /load RUB to USD exchange rates/i);
});

test('timesheet exports local client rates and backup contains only client-owned rates', () => {
  const rates = {
    alice: [{ ...parseRateFields('20.15', '$'), startDate: '', endDate: '' }],
    bob: [{ ...parseRateFields('750', 'RUB'), startDate: '', endDate: '' }],
  };
  const records = [record('alice', 1), record('bob', 2)];
  const json = JSON.parse(exportTimesheet(records, { format: 'json', startDate: '2026-08-17', endDate: '2026-08-17', clientRates: { c: rates }, invoicing: { clients: [{ id: 'c' }] }, rateClientId: 'c' }));
  assert.deepEqual(json.entries.map(entry => [entry.hourlyRate, entry.billableAmount, entry.currency]), [
    ['20.15', '20.15', '$'], ['750.00', '1500.00', 'RUB'],
  ]);
  const csv = exportTimesheet(records, { format: 'csv', startDate: '2026-08-17', endDate: '2026-08-17', clientRates: { c: rates }, invoicing: { clients: [{ id: 'c' }] }, rateClientId: 'c' });
  assert.match(csv, /20\.15,20\.15,\$/);
  assert.match(csv, /750\.00,1500\.00,RUB/);

  const text = settingsExportText({ billing: { clientRates: { c: rates }, invoicing: { clients: [{ id: 'c' }] } }, config: { recentDays: 7 }, exportedAt: '2026-08-23T12:00:00.000Z' });
  const saved = JSON.parse(text);
  assert.equal(saved.version, 8);
  assert.deepEqual(Object.keys(saved.billing).sort(), ['clientRates', 'invoicing']);
  assert.deepEqual(parseSettingsImport(text).billing, normalizeBillingSettings({ clientRates: { c: rates }, invoicing: { clients: [{ id: 'c' }] } }));
  assert.equal(Object.hasOwn(saved.billing, 'rates'), false);
});
