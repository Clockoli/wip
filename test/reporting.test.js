import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAnalytics, buildFacets, buildPrintableTimesheet, exportTimesheet, filterReportRecords, formatClockDuration,
  periodRange, reportFilename, reportPdfTitle, todayTrackedSeconds, validateDateRange,
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
  assert.deepEqual(filterReportRecords(records, { people: [], repositories: [], emptyMeansNone: true }), []);
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

test('analytics independently selects total-time horizontal and stack dimensions', () => {
  const analytics = buildAnalytics(records, { metric: 'total-time', horizontalAxis: 'day', stackBy: 'person' });
  assert.equal(analytics.metric, 'total-time');
  assert.equal(analytics.horizontalAxis, 'day');
  assert.equal(analytics.stackBy, 'person');
  assert.deepEqual(analytics.series.map(item => item.label), ['alice', 'bob']);
  assert.deepEqual(analytics.buckets.map(item => [item.key, item.totalValue]), [['2026-08-17', 10800], ['2026-08-18', 10800]]);
  assert.equal(analytics.buckets[0].segments.find(item => item.label === 'bob').value, 7200);
  assert.equal(analytics.maxValue, 10800);
});

test('analytics supports average time and task count for every requested axis', () => {
  const axes = ['day', 'week', 'month', 'person', 'repository', 'task'];
  for (const metric of ['total-time', 'avg-time', 'task-count']) {
    for (const horizontalAxis of axes) {
      for (const stackBy of axes) {
        const analytics = buildAnalytics(records, { metric, horizontalAxis, stackBy });
        assert.ok(analytics.buckets.every(bucket => Math.abs(bucket.segments.reduce((sum, segment) => sum + segment.value, 0) - bucket.totalValue) < 1e-9), `${metric}/${horizontalAxis}/${stackBy}`);
        assert.ok(analytics.buckets.every(bucket => bucket.segments.every(segment => segment.count >= 1)));
        if (metric === 'task-count') assert.equal(analytics.buckets.reduce((sum, bucket) => sum + bucket.totalValue, 0), 3, `${horizontalAxis}/${stackBy}`);
        if (metric === 'total-time') assert.equal(analytics.buckets.reduce((sum, bucket) => sum + bucket.totalValue, 0), 21600, `${horizontalAxis}/${stackBy}`);
      }
    }
  }
  const average = buildAnalytics(records, { metric: 'avg-time', horizontalAxis: 'repository', stackBy: 'person' });
  const app = average.buckets.find(bucket => bucket.key === 'acme/app');
  assert.equal(app.segments.find(segment => segment.label === 'alice').value, 1800);
  assert.equal(app.segments.find(segment => segment.label === 'alice').averageValue, 3600);
  assert.equal(app.segments.find(segment => segment.label === 'bob').value, 3600);
  assert.equal(app.totalValue, 5400);
  assert.equal(average.buckets.find(bucket => bucket.key === 'acme/api').totalValue, 10800);
});

test('task count and average time aggregate repeated sessions by distinct task', () => {
  const repeated = [
    record('alice', '2026-08-17T09:00:00+00:00', '2026-08-17T10:00:00+00:00'),
    record('alice', '2026-08-17T11:00:00+00:00', '2026-08-17T13:00:00+00:00'),
  ];
  const count = buildAnalytics(repeated, { metric: 'task-count', horizontalAxis: 'day', stackBy: 'person' });
  assert.equal(count.buckets[0].totalValue, 1);
  assert.equal(count.buckets[0].segments[0].taskCount, 1);
  assert.equal(count.buckets[0].segments[0].count, 2);
  const average = buildAnalytics(repeated, { metric: 'avg-time', horizontalAxis: 'day', stackBy: 'person' });
  assert.equal(average.buckets[0].totalValue, 10800);
  assert.equal(average.buckets[0].segments[0].averageValue, 10800);
});

test('analytics rejects unknown metrics and axes', () => {
  assert.throws(() => buildAnalytics(records, { metric: 'median', horizontalAxis: 'day', stackBy: 'person' }), /metric/i);
  assert.throws(() => buildAnalytics(records, { metric: 'total-time', horizontalAxis: 'year', stackBy: 'person' }), /horizontal axis/i);
  assert.throws(() => buildAnalytics(records, { metric: 'total-time', horizontalAxis: 'day', stackBy: 'owner' }), /stack/i);
});

test('printable timesheet groups date-person-task detail and sorts task totals by time', () => {
  const printable = buildPrintableTimesheet([
    record('alice', '2026-08-18T09:00:00+00:00', '2026-08-18T10:00:00+00:00', { issue: issue('acme', 'api', 3) }),
    record('alice', '2026-08-17T09:00:00+00:00', '2026-08-17T10:00:00+00:00', { issue: issue('acme', 'app', 1) }),
    record('bob', '2026-08-17T10:00:00+00:00', '2026-08-17T12:00:00+00:00', { issue: issue('acme', 'app', 1) }),
  ]);
  assert.deepEqual(printable.byDate.map(row => [row.date, row.person, row.url, row.seconds]), [
    ['2026-08-17', 'alice', 'https://github.com/acme/app/issues/1', 3600],
    ['2026-08-17', 'bob', 'https://github.com/acme/app/issues/1', 7200],
    ['2026-08-18', 'alice', 'https://github.com/acme/api/issues/3', 3600],
  ]);
  assert.deepEqual(printable.byTask.map(row => [row.task, row.url, row.seconds]), [
    ['#1', 'https://github.com/acme/app/issues/1', 10800],
    ['#3', 'https://github.com/acme/api/issues/3', 3600],
  ]);
  assert.equal(printable.totalSeconds, 14400);
});

test('printable timesheet keeps equal non-GitHub titles unambiguous', () => {
  const printable = buildPrintableTimesheet([
    { user: 'alice', taskUrl: 'https://example.com/tasks/1', taskTitle: 'Customer follow-up', issue: null, startedAt: '2026-08-17T09:00:00Z', entryDate: '2026-08-17', durationSeconds: 600 },
    { user: 'alice', taskUrl: 'https://example.com/tasks/2', taskTitle: 'Customer follow-up', issue: null, startedAt: '2026-08-17T10:00:00Z', entryDate: '2026-08-17', durationSeconds: 900 },
  ]);
  assert.deepEqual(printable.byTask.map(row => [row.task, row.url, row.seconds]), [
    ['Customer follow-up — https://example.com/tasks/2', 'https://example.com/tasks/2', 900],
    ['Customer follow-up — https://example.com/tasks/1', 'https://example.com/tasks/1', 600],
  ]);
});

test('PDF title includes period and only a single selected person', () => {
  const range = { startDate: '2026-08-01', endDate: '2026-08-31' };
  assert.equal(reportPdfTitle(range, ['alice']), 'Clockoli-timesheet_2026-08-01_2026-08-31_alice');
  assert.equal(reportPdfTitle(range, ['alice', 'bob']), 'Clockoli-timesheet_2026-08-01_2026-08-31');
  assert.equal(reportPdfTitle(range, []), 'Clockoli-timesheet_2026-08-01_2026-08-31');
});

test('timesheet exports correctly escaped CSV and structured JSON', () => {
  const csv = exportTimesheet(records, { format: 'csv', startDate: '2026-08-17', endDate: '2026-08-18' });
  assert.match(csv, /^Person,Repository,Type,Number,URL,Start,End,Duration,Duration seconds,Description\r\n/);
  assert.match(csv, /"comma, quote "" value"/);
  assert.equal(csv.split('\r\n').length, 5);
  const formulaCsv = exportTimesheet([record('alice', '2026-08-18T01:00:00+00:00', '2026-08-18T02:00:00+00:00', { description: '=HYPERLINK("https://example.com")' })], { format: 'csv', startDate: '2026-08-18', endDate: '2026-08-18' });
  assert.match(formulaCsv, /"'=HYPERLINK\(""https:\/\/example\.com""\)"/);
  const json = JSON.parse(exportTimesheet(records, { format: 'json', startDate: '2026-08-17', endDate: '2026-08-18' }));
  assert.deepEqual(json.period, { startDate: '2026-08-17', endDate: '2026-08-18' });
  assert.equal(json.totalSeconds, 21600);
  assert.equal(json.entries.length, 3);
  assert.deepEqual(Object.keys(json.entries[0]), ['person', 'repository', 'type', 'number', 'url', 'start', 'end', 'duration', 'durationSeconds', 'description']);
  assert.equal(reportFilename('csv', '2026-08-17', '2026-08-18'), 'timesheet-2026-08-17-to-2026-08-18.csv');
  assert.equal(reportFilename('json', '2026-08-17', '2026-08-18'), 'timesheet-2026-08-17-to-2026-08-18.json');
  assert.throws(() => exportTimesheet(records, { format: 'text', startDate: '2026-08-17', endDate: '2026-08-18' }), /format/i);
});


test('billable analytics and exports use local per-person rates', () => {
  const rates = { alice: 10000, bob: 5000 };
  const analytics = buildAnalytics(records, { metric: 'billable-amount', horizontalAxis: 'day', stackBy: 'person', rates });
  assert.equal(analytics.metric, 'billable-amount');
  assert.equal(analytics.buckets.reduce((sum, bucket) => sum + bucket.totalValue, 0), 50000);
  const csv = exportTimesheet(records, { format: 'csv', startDate: '2026-08-17', endDate: '2026-08-18', rates });
  assert.match(csv, /Hourly rate,Billable amount,Currency/);
  assert.match(csv, /100\.00/);
  const json = JSON.parse(exportTimesheet(records, { format: 'json', startDate: '2026-08-17', endDate: '2026-08-18', rates }));
  assert.equal(json.entries[0].currency, 'USD');
  assert.ok(Object.hasOwn(json.entries[0], 'billableAmount'));
});
