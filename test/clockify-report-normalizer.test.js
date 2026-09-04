import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeClockifyDetailedReport } from '../src/addons/clockify/report-normalizer.js';

const entry = {
  _id: 'entry-9', description: 'Investigated\nreport parsing', userId: 'user-42',
  timeInterval: {
    start: '2026-08-26T08:15:00.123Z', offStart: 7200, offEnd: 7200,
    end: '2026-08-26T09:42:00.000Z', duration: 5220, timeZone: 'Europe/Berlin',
    zonedStart: '2026-08-26T10:15:00', zonedEnd: '2026-08-26T11:42:00',
  },
  billable: true, projectId: 'project-17', taskId: 'task-5', approvalRequestId: null,
  type: 'REGULAR', isLocked: false, currency: '0', projectName: 'Frontend', projectColor: '#123456',
  clientName: '', clientId: '', userName: 'Ada', userEmail: 'ada@example.test',
  tags: [{ _id: 'tag-1', name: 'billing' }, { _id: 'tag-2', name: 'migration' }], taskName: 'Fix timer import',
};
const report = {
  totals: [{ totalTime: 5220, totalBillableTime: 5220, entriesCount: 1, amounts: [], numOfCurrencies: 1, _id: '', totalAmount: 0, totalAmountByCurrency: {} }],
  timeentries: [entry],
};

function normalize(value) {
  return normalizeClockifyDetailedReport(JSON.stringify(value));
}

test('normalizes inert lower-case Clockify Detailed Report JSON into a credential-free organization roster', () => {
  assert.deepEqual(normalize(report), {
    users: [{ userId: 'user-42', displayName: 'Ada', entryCount: 1 }],
    entries: [{
      provider: 'clockify', entryId: 'entry-9', userId: 'user-42',
      startedAt: '2026-08-26T08:15:00.123Z', endedAt: '2026-08-26T09:42:00.000Z', timezone: 'Europe/Berlin', duration: 5220,
      projectId: 'project-17', project: 'Frontend', task: 'Fix timer import',
      description: 'Investigated report parsing', tags: ['billing', 'migration'], billable: true,
    }],
  });
});

test('accepts observed nullable task/tag variants and separates multiple source users for later explicit mapping', () => {
  const withoutTask = { ...entry, taskId: null, taskName: null, tags: undefined, tagIds: null };
  assert.deepEqual(normalize({ ...report, timeentries: [withoutTask] }).entries[0].tags, []);
  assert.deepEqual(normalize({ ...report, timeentries: [entry, { ...entry, _id: 'entry-10', userId: 'user-else', userName: 'Lin' }], totals: [{ ...report.totals[0], entriesCount: 2 }] }), {
    users: [
      { userId: 'user-42', displayName: 'Ada', entryCount: 1 },
      { userId: 'user-else', displayName: 'Lin', entryCount: 1 },
    ],
    entries: [
      { provider: 'clockify', entryId: 'entry-9', userId: 'user-42', startedAt: '2026-08-26T08:15:00.123Z', endedAt: '2026-08-26T09:42:00.000Z', timezone: 'Europe/Berlin', duration: 5220, projectId: 'project-17', project: 'Frontend', task: 'Fix timer import', description: 'Investigated report parsing', tags: ['billing', 'migration'], billable: true },
      { provider: 'clockify', entryId: 'entry-10', userId: 'user-else', startedAt: '2026-08-26T08:15:00.123Z', endedAt: '2026-08-26T09:42:00.000Z', timezone: 'Europe/Berlin', duration: 5220, projectId: 'project-17', project: 'Frontend', task: 'Fix timer import', description: 'Investigated report parsing', tags: ['billing', 'migration'], billable: true },
    ],
  });
});

test('accepts a bounded complete Detailed Report larger than the initial preview-sized limit', () => {
  const entries = Array.from({ length: 10_001 }, (_, index) => ({
    ...entry,
    _id: `entry-${index}`,
  }));
  const result = normalizeClockifyDetailedReport(JSON.stringify({
    timeentries: entries,
    totals: [{ ...report.totals[0], entriesCount: entries.length }],
  }));
  assert.equal(result.entries.length, 10_001);
  assert.equal(result.users[0].entryCount, 10_001);
});

test('rejects a source user whose provider ID has conflicting display names', () => {
  assert.throws(() => normalize({ ...report, timeentries: [entry, { ...entry, _id: 'entry-10', userName: 'Different Ada' }], totals: [{ ...report.totals[0], entriesCount: 2 }] }), /conflicting.*display name/i);
});

test('rejects malformed timestamps, timezone, duration, credentials, unsupported fields, and camel-case response keys', () => {
  for (const [change, expected] of [
    [{ timeentries: [{ ...entry, timeInterval: { ...entry.timeInterval, start: '2026-02-30T08:15:00Z' } }] }, /start timestamp/i],
    [{ timeentries: [{ ...entry, timeInterval: { ...entry.timeInterval, start: '2026-08-26T08:15:00.123456Z' } }] }, /start timestamp/i],
    [{ timeentries: [{ ...entry, timeInterval: { ...entry.timeInterval, timeZone: 'Not/A_Timezone' } }] }, /timezone/i],
    [{ timeentries: [{ ...entry, timeInterval: { ...entry.timeInterval, duration: 1 } }] }, /duration/i],
    [{ timeentries: [{ ...entry, authorization: 'fake' }] }, /credential/i],
    [{ timeentries: [{ ...entry, unknown: true }] }, /unknown/i],
    [{ timeentries: [{ ...entry, tags: undefined, tagIds: ['tag-without-name'] }] }, /tag IDs/i],
    [{ timeEntries: [entry] }, /unknown/i],
  ]) assert.throws(() => normalize({ ...report, ...change }), expected);
});

test('accepts only inert JSON text and rejects object, accessor, sparse, symbol, and proxy report data without executing code', () => {
  let calls = 0;
  const accessorEntries = [];
  Object.defineProperty(accessorEntries, '0', { enumerable: true, get() { calls += 1; return entry; } });
  assert.throws(() => normalizeClockifyDetailedReport({ ...report, timeentries: accessorEntries }), /JSON text/i);

  const accessorEntry = { ...entry };
  Object.defineProperty(accessorEntry, 'description', { enumerable: true, get() { calls += 1; return entry.description; } });
  assert.throws(() => normalizeClockifyDetailedReport({ ...report, timeentries: [accessorEntry] }), /JSON text/i);

  const accessorTag = { ...entry.tags[0] };
  Object.defineProperty(accessorTag, 'name', { enumerable: true, get() { calls += 1; return 'billing'; } });
  assert.throws(() => normalizeClockifyDetailedReport({ ...report, timeentries: [{ ...entry, tags: [accessorTag] }] }), /JSON text/i);

  assert.throws(() => normalizeClockifyDetailedReport({ ...report, timeentries: new Array(1) }), /JSON text/i);
  assert.throws(() => normalizeClockifyDetailedReport({ ...report, [Symbol('untrusted')]: true }), /JSON text/i);
  const hiddenProperty = { ...report };
  Object.defineProperty(hiddenProperty, 'ignored', { value: true });
  assert.throws(() => normalizeClockifyDetailedReport(hiddenProperty), /JSON text/i);
  assert.throws(() => normalizeClockifyDetailedReport(Object.assign(Object.create({}), report)), /JSON text/i);
  const proxied = new Proxy(report, { ownKeys() { calls += 1; return Reflect.ownKeys(report); } });
  assert.throws(() => normalizeClockifyDetailedReport(proxied), /JSON text/i);
  assert.equal(calls, 0);
});
