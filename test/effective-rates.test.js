import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInvoice } from '../src/domain/invoicing.js';
import {
  billableMinorForRecord, normalizeBillingSettings, rateMinorForUser,
} from '../src/domain/local-settings.js';

const effectiveRates = {
  alice: [
    { amountMinorPerHour: 10000, currency: 'USD', currencyPosition: 'suffix', startDate: '2026-01-01', endDate: '2026-06-30' },
    { amountMinorPerHour: 12500, currency: 'USD', currencyPosition: 'suffix', startDate: '2026-07-01', endDate: '' },
  ],
};

test('an invoice splits one task and person at a mid-period rate change', () => {
  const records = ['2026-06-30', '2026-07-01'].map(entryDate => ({ user: 'alice', taskUrl: 'https://example.com/task', taskTitle: 'Task', entryDate, durationSeconds: 1800 }));
  const invoice = buildInvoice(records, { clientId: 'acme', clientRates: { acme: effectiveRates }, invoicing: { clients: [{ id: 'acme' }] }, startDate: '2026-06-01', endDate: '2026-07-31', issueDate: '2026-08-01' });
  assert.deepEqual(invoice.lines.map(line => [line.rateMinorPerHour, line.rateCurrency, line.seconds, line.amountMinor]), [[10000, 'USD', 1800, 5000], [12500, 'USD', 1800, 6250]]);
  assert.equal(new Set(invoice.lines.map(line => line.key)).size, 2);
  assert.equal(invoice.totalMinor, 11250);
});

test('effective-dated rates select the inclusive period by record date', () => {
  assert.equal(rateMinorForUser('ALICE', effectiveRates, '2026-06-30'), 10000);
  assert.equal(rateMinorForUser('alice', effectiveRates, '2026-07-01'), 12500);
  assert.equal(rateMinorForUser('alice', effectiveRates, '2025-12-31'), null);
  assert.equal(billableMinorForRecord({ user: 'alice', entryDate: '2026-06-15', durationSeconds: 1800 }, effectiveRates), 5000);
  assert.equal(billableMinorForRecord({ user: 'alice', startedAt: '2026-07-15T10:00:00+00:00', durationSeconds: 1800 }, effectiveRates), 6250);
});

test('client rate periods reject overlaps and reversed dates', () => {
  const normalize = card => normalizeBillingSettings({ invoicing: { clients: [{ id: 'acme' }] }, clientRates: { acme: card } });
  assert.deepEqual(normalize(effectiveRates).clientRates.acme, effectiveRates);
  assert.throws(() => normalize({ alice: [
    { amountMinorPerHour: 10000, currency: 'USD', startDate: '2026-01-01', endDate: '2026-07-01' },
    { amountMinorPerHour: 12000, currency: 'USD', startDate: '2026-07-01', endDate: '' },
  ] }), /overlap/i);
  assert.throws(() => normalize({ alice: [
    { amountMinorPerHour: 10000, currency: 'USD', startDate: '2026-08-01', endDate: '2026-07-01' },
  ] }), /end date/i);
});
