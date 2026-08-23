import test from 'node:test';
import assert from 'node:assert/strict';
import {
  billableMinorForRecord, normalizeBillingSettings, rateMinorForUser,
} from '../src/domain/local-settings.js';

const effectiveRates = {
  alice: [
    { amountMinorPerHour: 10000, startDate: '2026-01-01', endDate: '2026-06-30' },
    { amountMinorPerHour: 12500, startDate: '2026-07-01', endDate: '' },
  ],
};

test('effective-dated rates select the inclusive period by record date', () => {
  assert.equal(rateMinorForUser('ALICE', effectiveRates, '2026-06-30'), 10000);
  assert.equal(rateMinorForUser('alice', effectiveRates, '2026-07-01'), 12500);
  assert.equal(rateMinorForUser('alice', effectiveRates, '2025-12-31'), null);
  assert.equal(billableMinorForRecord({ user: 'alice', entryDate: '2026-06-15', durationSeconds: 1800 }, effectiveRates), 5000);
  assert.equal(billableMinorForRecord({ user: 'alice', startedAt: '2026-07-15T10:00:00+00:00', durationSeconds: 1800 }, effectiveRates), 6250);
});

test('billing normalization upgrades legacy rates and rejects overlapping periods', () => {
  assert.deepEqual(normalizeBillingSettings({ currency: 'usd', rates: { alice: 10000 } }), {
    currency: 'USD', rates: { alice: [{ amountMinorPerHour: 10000, startDate: '', endDate: '' }] },
  });
  assert.deepEqual(normalizeBillingSettings({ rates: effectiveRates }), { currency: 'USD', rates: effectiveRates });
  assert.throws(() => normalizeBillingSettings({ rates: { alice: [
    { amountMinorPerHour: 10000, startDate: '2026-01-01', endDate: '2026-07-01' },
    { amountMinorPerHour: 12000, startDate: '2026-07-01', endDate: '' },
  ] } }), /overlap/i);
  assert.throws(() => normalizeBillingSettings({ rates: { alice: [
    { amountMinorPerHour: 10000, startDate: '2026-08-01', endDate: '2026-07-01' },
  ] } }), /end date/i);
});
