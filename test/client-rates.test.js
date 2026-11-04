import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeBillingSettings, rateForClient, rateForRecord, clientIdForRecord,
  parseSettingsImport, settingsExportText,
} from '../src/domain/local-settings.js';
import { buildInvoice, invoiceExchangeRequest } from '../src/domain/invoicing.js';
import { buildAnalytics, filterReportRecords, exportTimesheet } from '../src/domain/reporting.js';

const billing = normalizeBillingSettings({
  invoicing: { clients: [{ id: 'acme', name: 'Acme' }, { id: 'globex', name: 'Globex' }] },
  clientRates: { acme: { alice: 10000 }, globex: { alice: 15000, bob: 8000 } },
});
const record = (user = 'alice', taskUrl = 'https://example.com/acme/task') => ({
  id: 'entry-' + user, user, taskUrl, entryDate: '2026-08-14',
  startedAt: '2026-08-14T09:00:00Z', endedAt: '2026-08-14T10:00:00Z',
  durationSeconds: 3600, description: 'Work', taskTitle: 'Task',
});
const projects = [
  { name: 'Acme project', substrings: ['example.com/acme/'], client: 'acme' },
  { name: 'Globex project', substrings: ['example.com/globex/'], client: 'globex' },
];
const options = { projectDefinitions: projects, otherProjectName: 'Other', otherProjectClient: '' };
const rateOptions = { clientRates: billing.clientRates, invoicing: billing.invoicing, ...options };

test('one employee has independent rates for two local clients and no cross-client fallback', () => {
  assert.equal(rateForClient('acme', billing, 'alice', '2026-08-14').amountMinorPerHour, 10000);
  assert.equal(rateForClient('globex', billing, 'alice', '2026-08-14').amountMinorPerHour, 15000);
  assert.equal(rateForClient('acme', billing, 'bob', '2026-08-14'), null);
  assert.equal(rateForClient('unknown', billing, 'alice', '2026-08-14'), null);
  assert.equal(rateForRecord(record(), billing, { clientId: '__project__', projects }).amountMinorPerHour, 10000);
  assert.equal(rateForRecord(record(), billing, { clientId: 'globex', projects }).amountMinorPerHour, 15000);
  assert.equal(clientIdForRecord(record('bob','https://example.com/unknown'), { projects }), '');
});

test('invoices require a client and use only the selected client rate card', () => {
  const shared = { clientRates: billing.clientRates, invoicing: billing.invoicing,
    currency: 'USD', startDate: '2026-08-01', endDate: '2026-08-31', issueDate: '2026-09-01' };
  assert.throws(() => buildInvoice([record()], shared), /choose a client/i);
  const acme = buildInvoice([record('alice'), record('bob')], { ...shared, clientId: 'acme' });
  assert.equal(acme.totalMinor, 10000);
  assert.deepEqual(acme.unbilled, [{ person: 'bob', seconds: 3600 }]);
  const globex = buildInvoice([record('alice'), record('bob')], { ...shared, clientId: 'globex' });
  assert.equal(globex.totalMinor, 23000);
  assert.deepEqual(globex.unbilled, []);
  assert.deepEqual(invoiceExchangeRequest([record()], billing.clientRates, 'globex', 'USD').sourceCurrencies, []);
});

test('reports support project ownership and a manager selecting a single client to price all work', () => {
  const records = [record('alice'), record('bob', 'https://example.com/globex/task')];
  const auto = buildAnalytics(records, { ...rateOptions, metric: 'billable-amount', rateClientId: '__project__', currency: 'USD', horizontalAxis: 'person', stackBy: 'person' });
  assert.equal(auto.buckets.reduce((sum, item) => sum + item.totalValue, 0), 18000);
  const manager = buildAnalytics(records, { ...rateOptions, metric: 'billable-amount', rateClientId: 'globex', currency: 'USD', horizontalAxis: 'person', stackBy: 'person' });
  assert.equal(manager.buckets.reduce((sum, item) => sum + item.totalValue, 0), 23000);
  assert.deepEqual(filterReportRecords(records, { ...options, clientIdFilter: 'acme' }).map(item => item.user), ['alice']);
  const csv = exportTimesheet(records, { ...rateOptions, rateClientId: 'globex', format: 'csv', startDate: '2026-08-14', endDate: '2026-08-14' });
  assert.match(csv, /150\.00,150\.00,USD/);
});

test('only user-created clients can own rates; global rate cards are invalid', () => {
  assert.deepEqual(normalizeBillingSettings().invoicing.clients, []);
  const provided = { invoicing: { clients: [{ id: 'acme', name: 'Acme' }] }, clientRates: { acme: { alice: 10000 } } };
  const normalized = normalizeBillingSettings(provided);
  assert.deepEqual(normalized.invoicing.clients.map(client => client.id), ['acme']);
  assert.equal(rateForClient('acme', normalized, 'alice', '2026-08-14').amountMinorPerHour, 10000);
  for (const old of [{ rates: { alice: 10000 } }, { rates: {} }, { currency: 'USD' }, { ...provided, rates: {} }]) {
    assert.throws(() => normalizeBillingSettings(old), /unexpected fields/i);
  }
  assert.throws(() => normalizeBillingSettings({
    invoicing: { clients: [{ id: 'acme' }] }, clientRates: { orphan: { alice: 10000 } },
  }), /missing client/i);
  const encoded = settingsExportText({ billing: provided, exportedAt: '2026-08-14T12:00:00.000Z' });
  assert.deepEqual(parseSettingsImport(encoded).billing, normalized);
  assert.equal(JSON.parse(encoded).billing.invoicing.clients.length, 1);
  const invalidBackup = JSON.parse(encoded);
  invalidBackup.billing.rates = { alice: 10000 };
  assert.throws(() => parseSettingsImport(JSON.stringify(invalidBackup)), /billing fields/i);
});
