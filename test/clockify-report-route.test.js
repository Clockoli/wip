import test from 'node:test';
import assert from 'node:assert/strict';
import { clockifyDetailedReportYear } from '../src/services/clockify-report-route.js';

test('reads the exact annual range from the current Clockify Detailed Report tab URL', () => {
  assert.equal(clockifyDetailedReportYear('https://app.clockify.me/reports/detailed?start=2026-01-01T00:00:00.000Z&end=2026-12-31T23:59:59.999Z&page=1&pageSize=200'), 2026);
});

test('rejects stale, non-annual, or non-Clockify report routes', () => {
  for (const url of [
    'https://app.clockify.me/reports/detailed?start=2026-01-01T00:00:00.000Z&end=2025-12-31T23:59:59.999Z',
    'https://app.clockify.me/reports/summary?start=2026-01-01T00:00:00.000Z&end=2026-12-31T23:59:59.999Z',
    'https://example.test/reports/detailed?start=2026-01-01T00:00:00.000Z&end=2026-12-31T23:59:59.999Z',
  ]) assert.throws(() => clockifyDetailedReportYear(url), /Clockify report/i);
});
