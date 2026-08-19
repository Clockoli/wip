import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAnalytics, buildFacets, exportTimesheet, filterReportRecords, formatClockDuration,
  periodRange, reportFilename, todayTrackedSeconds, validateDateRange,
} from '../src/domain/reporting.js';

const issue = (owner, repo, number, type = 'issue') => ({
  type, owner, repo, number,
  url: `https://github.com/${owner}/${repo}/${type === 'pull_request' ? 'pull' : 'issues'}/${number}`,
});
const record = (user, startedAt, endedAt, options = {}) => ({
  user, issue: options.issue ?? issue('acme', 'app', 1), startedAt, endedAt,
  durationSeconds: (new Date(endedAt) - new Date(startedAt)) / 1000,
  description: options.description ?? '', entryDate: startedAt.slice(0, 10),
});

const records = [
  record('alice', '2026-08-17T09:00:00+00:00', '2026-08-17T10:00:00+00:00', { description: 'one' }),
  record('bob', '2026-08-17T10:00:00+00:00', '2026-08-17T12:00:00+00:00', { issue: issue('acme', 'app', 2, 'pull_request') }),
  record('alice', '2026-08-18T09:00:00+00:00', '2026-08-18T12:00:00+00:00', { issue: issue('acme', 'api', 3), description: 'comma, quote " value' }),
];

test('report period presets use inclusive local calendar ranges', () => {
  const today = '2026-08-19';
  assert.deepEqual(periodRange('this-week', today), { startDate: '2026-08-17', endDate: '2026-08-23', label: 'This week' });
  assert.deepEqual(periodRange('last-week', today), { startDate: '2026-08-10', endDate: '2026-08-16', label: 'Last week' });
  assert.deepEqual(periodRange('this-month', today), { startDate: '2026-08-01', endDate: '2026-08-31', label: 'This month' });
  assert.deepEqual(periodRange('last-month', today), { startDate: '2026-07-01', endDate: '2026-07-31', label: 'Last month' });
  assert.deepEqual(periodRange('this-quarter', today), { startDate: '2026-07-01', endDate: '2026-09-30', label: 'This quarter' });
  assert.deepEqual(periodRange('last-quarter', today), { startDate: '2026-04-01', endDate: '2026-06-30', label: 'Last quarter' });
  assert.deepEqual(periodRange('this-year', today), { startDate: '2026-01-01', endDate: '2026-12-31', label: 'This year' });
  assert.deepEqual(periodRange('last-year', today), { startDate: '2025-01-01', endDate: '2025-12-31', label: 'Last year' });
  assert.deepEqual(periodRange('custom', today, { startDate: '2026-02-03', endDate: '2026-04-05' }), { startDate: '2026-02-03', endDate: '2026-04-05', label: 'Custom period' });
  assert.throws(() => validateDateRange('2026-08-20', '2026-08-19'), /end date/i);
});

test('today total includes completed and running entries whose Start date is today', () => {
  const today = [record('alice', '2026-08-19T01:00:00+00:00', '2026-08-19T02:30:00+00:00'), ...records];
  const active = { user: 'alice', startedAt: '2026-08-19T10:00:00+00:00' };
  assert.equal(todayTrackedSeconds(today, active, new Date('2026-08-19T11:15:00+00:00'), '2026-08-19'), 9900);
  assert.equal(formatClockDuration(9900), '2h 45m');
  assert.equal(todayTrackedSeconds(today, { ...active, startedAt: '2026-08-18T23:00:00+00:00' }, new Date('2026-08-19T11:15:00+00:00'), '2026-08-19'), 5400);
});

test('person and repository facets cross-filter and expose duration counts', () => {
  assert.deepEqual(filterReportRecords(records, { people: ['alice'], repositories: [] }).map(item => item.user), ['alice', 'alice']);
  assert.deepEqual(filterReportRecords(records, { people: [], repositories: ['acme/api'] }).map(item => item.user), ['alice']);
  const facets = buildFacets(records, { people: ['alice'], repositories: ['acme/app'] });
  assert.deepEqual(facets.people, [
    { value: 'alice', count: 1, seconds: 3600 },
    { value: 'bob', count: 1, seconds: 7200 },
  ]);
  assert.deepEqual(facets.repositories, [
    { value: 'acme/api', count: 1, seconds: 10800 },
    { value: 'acme/app', count: 1, seconds: 3600 },
  ]);
});

test('analytics builds interval buckets and stacked series from checked dimensions', () => {
  const analytics = buildAnalytics(records, { dimensions: ['person', 'repository'], interval: 'day' });
  assert.deepEqual(analytics.series.map(item => item.label), ['alice · acme/api', 'alice · acme/app', 'bob · acme/app']);
  assert.deepEqual(analytics.buckets.map(item => [item.key, item.totalSeconds]), [['2026-08-17', 10800], ['2026-08-18', 10800]]);
  assert.equal(analytics.buckets[0].segments.find(item => item.label === 'bob · acme/app').seconds, 7200);
  const total = buildAnalytics(records, { dimensions: [], interval: null });
  assert.deepEqual(total.buckets.map(item => [item.key, item.totalSeconds]), [['total', 21600]]);
  assert.deepEqual(total.series.map(item => item.label), ['Total']);
});

test('analytics can stack by issue or PR without a time interval', () => {
  const analytics = buildAnalytics(records, { dimensions: ['issue'], interval: null });
  assert.equal(analytics.buckets.length, 1);
  assert.equal(analytics.buckets[0].key, 'total');
  assert.equal(analytics.series.length, 3);
  assert.ok(analytics.series.some(series => series.label === 'acme/app#2 (PR)'));
  assert.equal(analytics.buckets[0].totalSeconds, 6 * 3600);
});

test('timesheet exports stable plain text and correctly escaped CSV', () => {
  const text = exportTimesheet(records, { format: 'text', startDate: '2026-08-17', endDate: '2026-08-18' });
  assert.match(text, /Timesheet: 2026-08-17 to 2026-08-18/);
  assert.match(text, /Total: 6h 00m/);
  assert.match(text, /Person: alice/);
  assert.match(text, /Item: Pull request #2/);
  const csv = exportTimesheet(records, { format: 'csv', startDate: '2026-08-17', endDate: '2026-08-18' });
  assert.match(csv, /^Person,Repository,Type,Number,URL,Start,End,Duration,Duration seconds,Description\r\n/);
  assert.match(csv, /"comma, quote "" value"/);
  assert.equal(csv.split('\r\n').length, 5);
  const formulaCsv = exportTimesheet([record('alice', '2026-08-18T01:00:00+00:00', '2026-08-18T02:00:00+00:00', { description: '=HYPERLINK("https://example.com")' })], { format: 'csv', startDate: '2026-08-18', endDate: '2026-08-18' });
  assert.match(formulaCsv, /"'=HYPERLINK\(""https:\/\/example\.com""\)"/);
  assert.equal(reportFilename('csv', '2026-08-17', '2026-08-18'), 'timesheet-2026-08-17-to-2026-08-18.csv');
  assert.equal(reportFilename('text', '2026-08-17', '2026-08-18'), 'timesheet-2026-08-17-to-2026-08-18.txt');
});
