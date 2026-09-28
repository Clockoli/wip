import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeClockifyDetailedCsv } from '../src/addons/clockify/csv-normalizer.js';

const header = 'Project,Client,Description,Task,User,Group,Email,Tags,Billable,Start Date,Start Time,End Date,End Time,Duration (h),Duration (decimal),Billable Rate (0),Billable Amount (0),Date of creation';
const row = 'clockoli,,"CSV, migration",#42 Import,Ada,,ada@example.test,"backend, migration",Yes,01/02/2026,9:00 AM,01/02/2026,10:30 AM,1:30,1.50,0,0,01/02/2026';

test('normalizes the native Clockify Detailed Report CSV with deterministic export provenance', async () => {
  const csv = `${header}\n${row}\n`;
  const result = await normalizeClockifyDetailedCsv(csv);
  assert.deepEqual(result.users.map(({ displayName, entryCount }) => ({ displayName, entryCount })), [{ displayName: 'Ada', entryCount: 1 }]);
  assert.equal(result.entries.length, 1);
  assert.match(result.entries[0].entryId, /^csv-v2:[a-f0-9]{64}:1$/);
  assert.match(result.entries[0].userId, /^csv-user:[a-f0-9]{64}$/);
  assert.match(result.entries[0].projectId, /^csv-project:[a-f0-9]{64}$/);
  assert.equal(result.entries[0].duration, 5400);
  assert.equal(result.entries[0].description, 'CSV, migration');
  assert.deepEqual(result.entries[0].tags, ['backend', 'migration']);
});

test('accepts an empty native annual export so history discovery can continue', async () => {
  const result = await normalizeClockifyDetailedCsv(`${header}\n`);
  assert.deepEqual(result, { users: [], entries: [] });
});

test('omits a zero-length CSV row while reporting the completed parse safely', async () => {
  const progress = [];
  const zeroLength = row.replace('10:30 AM,1:30', '9:00 AM,0:00');

  const result = await normalizeClockifyDetailedCsv(`${header}\n${zeroLength}\n`, {
    onProgress: update => progress.push(update),
  });

  assert.deepEqual(result, { users: [], entries: [] });
  assert.deepEqual(progress, [{ completedRows: 0, totalRows: 1 }, { completedRows: 1, totalRows: 1 }]);
});

test('returns aggregate-only timing when profiling CSV normalization', async () => {
  const csv = `${header}\n${row}\n`;
  const result = await normalizeClockifyDetailedCsv(csv, { profile: true });
  assert.equal(result.data.entries.length, 1);
  assert.deepEqual(Object.keys(result.profile).sort(), ['byteCount', 'normalizeRowsMs', 'parseMs', 'rowCount', 'sourceDigestMs', 'totalMs']);
  assert.equal(result.profile.byteCount, Buffer.byteLength(csv));
  assert.equal(result.profile.rowCount, 1);
  for (const value of Object.values(result.profile)) assert.ok(Number.isFinite(value) && value >= 0);
  assert.doesNotMatch(JSON.stringify(result.profile), /ada@example|CSV, migration/);
});

test('reports bounded aggregate parsing progress without exposing CSV rows', async () => {
  const progress = [];
  const result = await normalizeClockifyDetailedCsv(`${header}\n${row}\n${row}\n`, {
    onProgress: update => progress.push(update),
  });
  assert.equal(result.entries.length, 2);
  assert.deepEqual(progress[0], { completedRows: 0, totalRows: 2 });
  assert.deepEqual(progress.at(-1), { completedRows: 2, totalRows: 2 });
  for (const update of progress) {
    assert.deepEqual(Object.keys(update).sort(), ['completedRows', 'totalRows']);
    assert.ok(Number.isSafeInteger(update.completedRows) && update.completedRows >= 0 && update.completedRows <= update.totalRows);
    assert.equal(JSON.stringify(update).includes('Ada'), false);
  }
});

test('rejects malformed schemas and source intervals instead of guessing', async () => {
  await assert.rejects(normalizeClockifyDetailedCsv('Project,Description\nclockoli,nope\n'), /header/i);
  await assert.rejects(normalizeClockifyDetailedCsv(`${header}\n${row.replace('10:30 AM,1:30', '10:29 AM,1:30')}\n`), /inconsistent interval/i);
});

test('rejects invalid 12-hour clock values and unknown billable markers', async () => {
  for (const invalidTime of ['00:30 AM', '13:30 PM', '9:60 AM']) {
    await assert.rejects(
      normalizeClockifyDetailedCsv(`${header}\n${row.replace('9:00 AM', invalidTime)}\n`),
      /invalid local timestamp/i,
    );
  }
  await assert.rejects(normalizeClockifyDetailedCsv(`${header}\n${row.replace(',Yes,', ',Maybe,')}\n`), /invalid billable/i);
});

test('uses row-order-independent provenance IDs for equivalent CSV exports', async () => {
  const later = row.replace('9:00 AM,01/02/2026,10:30 AM,1:30', '11:00 AM,01/02/2026,12:30 PM,1:30');
  const first = await normalizeClockifyDetailedCsv(`${header}\n${row}\n${later}\n`);
  const reordered = await normalizeClockifyDetailedCsv(`${header}\n${later}\n${row}\n`);
  assert.deepEqual(first.entries.map(entry => entry.entryId).sort(), reordered.entries.map(entry => entry.entryId).sort());
});
