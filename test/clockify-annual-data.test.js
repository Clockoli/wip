import test from 'node:test';
import assert from 'node:assert/strict';
import { assertClockifyAnnualDataYear } from '../src/services/clockify-annual-data.js';

const entry = (startedAt, endedAt) => ({ startedAt, endedAt });

test('accepts only non-empty Clockify data whose every interval overlaps the requested annual scan', () => {
  assert.doesNotThrow(() => assertClockifyAnnualDataYear({
    entries: [
      entry('2025-12-31T23:30:00.000Z', '2026-01-01T00:30:00.000Z'),
      entry('2026-12-31T23:30:00.000Z', '2027-01-01T00:30:00.000Z'),
    ],
  }, 2026));
});

test('accepts an empty normalized annual result but fails closed for malformed or wrong-year data', () => {
  assert.doesNotThrow(() => assertClockifyAnnualDataYear({ entries: [] }, 2026));
  for (const data of [
    { entries: [entry('2025-01-01T00:00:00.000Z', '2025-01-01T01:00:00.000Z')] },
    { entries: [entry('2026-01-01T00:00:00.000Z', 'not-a-date')] },
    { entries: [{ startedAt: '2026-01-01T00:00:00.000Z' }] },
    { entries: 'not-an-array' },
  ]) assert.throws(() => assertClockifyAnnualDataYear(data, 2026), /annual capture data/i);
  assert.throws(() => assertClockifyAnnualDataYear({ entries: [entry('2026-01-01T00:00:00.000Z', '2026-01-01T01:00:00.000Z')] }, Number.NaN), /year/i);
});
