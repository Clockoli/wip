import test from 'node:test';
import assert from 'node:assert/strict';
import { createClockifyHistoryScanService } from '../src/services/clockify-history-scan.js';

const CURRENT_YEAR = 2026;

function entry(id, userId = 'person-1', date = '2026-02-03') {
  return {
    provider: 'clockify', entryId: id, userId,
    startedAt: `${date}T08:00:00.000Z`, endedAt: `${date}T09:00:00.000Z`, timezone: 'UTC', duration: 3600,
    projectId: 'project-1', project: 'Migration', task: '', description: '', tags: [], billable: false,
  };
}

function report(entries, displayName = 'Example Person') {
  return {
    users: entries.length ? [{ userId: entries[0].userId, displayName, entryCount: entries.length }] : [],
    entries,
  };
}

function sessionStorage() {
  const values = new Map();
  return {
    values,
    async get(key) { return structuredClone(values.get(key)); },
    async set(key, value) { values.set(key, structuredClone(value)); },
    async remove(key) { values.delete(key); },
  };
}

test('uses Clockify’s 2016 launch year as the default historical safety floor', async () => {
  const scan = createClockifyHistoryScanService({ storageSession: sessionStorage(), currentYear: () => 2016 });

  assert.deepEqual(await scan.start(), { discovering: true, nextYear: 2016 });
});

test('persists the selected capture transport across a service-worker restart', async () => {
  const storage = sessionStorage();
  const scan = createClockifyHistoryScanService({ storageSession: storage, currentYear: () => CURRENT_YEAR, earliestYear: 2024 });

  await scan.start('report');
  assert.equal((await scan.status()).transport, 'report');
  const restarted = createClockifyHistoryScanService({ storageSession: storage, currentYear: () => CURRENT_YEAR, earliestYear: 2024 });
  assert.equal((await restarted.status()).transport, 'report');
});

test('counts email-only CSV offers for the active annual range across worker restarts and resets for the next year', async () => {
  const storage = sessionStorage();
  const create = () => createClockifyHistoryScanService({ storageSession: storage, currentYear: () => CURRENT_YEAR, earliestYear: 2025 });
  const scan = create();
  await scan.start('csv');
  await scan.observeYear(2026, 1);
  await scan.observeYear(2025, 1);
  assert.equal(await scan.recordCsvEmailOffer(2026), 1);
  assert.equal(await create().recordCsvEmailOffer(2026), 2);
  assert.equal(await create().recordCsvEmailOffer(2026), 3);
  await assert.rejects(() => create().recordCsvEmailOffer(2025), /expected.*year/i);
  await scan.append(2026, report([entry('current')]));
  assert.equal(await create().recordCsvEmailOffer(2025), 1);
  await scan.reset();
  await assert.rejects(() => create().recordCsvEmailOffer(2025), /expected.*year|unavailable/i);
});

test('email-only CSV offers cannot count during discovery, page capture, or beyond three attempts', async () => {
  const storage = sessionStorage();
  const scan = createClockifyHistoryScanService({ storageSession: storage, currentYear: () => CURRENT_YEAR, earliestYear: 2026 });
  await scan.start('csv');
  await assert.rejects(() => scan.recordCsvEmailOffer(2026), /capturing/i);
  await scan.observeYear(2026, 1);
  await scan.recordCsvEmailOffer(2026);
  await scan.recordCsvEmailOffer(2026);
  await scan.recordCsvEmailOffer(2026);
  await assert.rejects(() => scan.recordCsvEmailOffer(2026), /limit/i);
  await scan.reset();
  await scan.start('report');
  await scan.observeYear(2026, 1);
  await assert.rejects(() => scan.recordCsvEmailOffer(2026), /CSV/i);
});

test('discovers contiguous Clockify history before capture and exposes a determinate annual plan', async () => {
  const storage = sessionStorage();
  const scan = createClockifyHistoryScanService({ storageSession: storage, currentYear: () => CURRENT_YEAR, earliestYear: 2024 });

  assert.deepEqual(await scan.start(), { discovering: true, nextYear: 2026 });
  assert.deepEqual(await scan.observeYear(2026, 11), { discovering: true, nextYear: 2025, yearsChecked: 1, yearsWithEntries: [2026] });
  assert.deepEqual(await scan.status(), {
    phase: 'discovering', currentYear: 2026, nextYear: 2025, yearsChecked: 1, yearsWithEntries: [2026], transport: 'csv',
  });
  assert.deepEqual(await scan.observeYear(2025, 4), { discovering: true, nextYear: 2024, yearsChecked: 2, yearsWithEntries: [2026, 2025] });
  assert.deepEqual(await scan.observeYear(2024, 4), {
    capturing: true,
    nextYear: 2026,
    history: { totalYears: 3, completedYears: 0, yearsWithEntries: [2026, 2025, 2024] },
  });
  assert.deepEqual(await scan.status(), {
    phase: 'capturing',
    history: { totalYears: 3, completedYears: 0, yearsWithEntries: [2026, 2025, 2024] },
    transport: 'csv',
  });
});

test('stops at the first empty year before already-discovered Clockify history', async () => {
  const storage = sessionStorage();
  const scan = createClockifyHistoryScanService({ storageSession: storage, currentYear: () => CURRENT_YEAR, earliestYear: 2023 });

  await scan.start();
  assert.deepEqual(await scan.observeYear(2026, 0), {
    discovering: true, nextYear: 2025, yearsChecked: 1, yearsWithEntries: [],
  });
  assert.deepEqual(await scan.observeYear(2025, 8), {
    discovering: true, nextYear: 2024, yearsChecked: 2, yearsWithEntries: [2025],
  });
  assert.deepEqual(await scan.observeYear(2024, 0), {
    capturing: true,
    nextYear: 2025,
    history: { totalYears: 1, completedYears: 0, yearsWithEntries: [2025] },
  });
});

test('fills the known annual plan only after each complete annual report and rejects out-of-order years', async () => {
  const storage = sessionStorage();
  const scan = createClockifyHistoryScanService({ storageSession: storage, currentYear: () => CURRENT_YEAR, earliestYear: 2024 });
  await scan.start();
  await scan.observeYear(2026, 1);
  await scan.observeYear(2025, 1);
  await scan.observeYear(2024, 1);

  await assert.rejects(() => scan.append(2024, report([entry('prior', 'person-1', '2024-02-03')])), /expected/i);
  assert.deepEqual(await scan.append(2026, report([entry('current')])), {
    complete: false,
    nextYear: 2025,
    history: { totalYears: 3, completedYears: 1, yearsWithEntries: [2026, 2025, 2024] },
  });
  assert.deepEqual(await scan.append(2025, report([entry('middle', 'person-1', '2025-02-03')])), {
    complete: false,
    nextYear: 2024,
    history: { totalYears: 3, completedYears: 2, yearsWithEntries: [2026, 2025, 2024] },
  });
  const result = await scan.append(2024, report([entry('prior', 'person-1', '2024-02-03')]));
  assert.deepEqual(result, {
    complete: true,
    history: { totalYears: 3, completedYears: 3, yearsWithEntries: [2026, 2025, 2024] },
    data: report([entry('current'), entry('middle', 'person-1', '2025-02-03'), entry('prior', 'person-1', '2024-02-03')]),
  });
  assert.equal(storage.values.size, 0);
});

test('fails closed and removes all annual shards when final aggregation finds a malformed prior shard', async () => {
  const storage = sessionStorage();
  const scan = createClockifyHistoryScanService({ storageSession: storage, currentYear: () => CURRENT_YEAR, earliestYear: 2025 });
  await scan.start();
  await scan.observeYear(2026, 1);
  await scan.observeYear(2025, 1);
  await scan.append(2026, report([entry('current')]));
  const priorShardKey = [...storage.values.entries()].find(([, value]) => value?.entries?.[0]?.entryId === 'current')?.[0];
  storage.values.set(priorShardKey, { invalid: true });

  await assert.rejects(
    () => scan.append(2025, report([entry('prior', 'person-1', '2025-02-03')])),
    /source users|stored|entries|invalid/i,
  );
  assert.equal(storage.values.size, 0);
});

test('removes known annual shards when persisted scan metadata is malformed', async () => {
  const storage = sessionStorage();
  const scan = createClockifyHistoryScanService({ storageSession: storage, currentYear: () => CURRENT_YEAR, earliestYear: 2025 });
  await scan.start();
  await scan.observeYear(2026, 1);
  await scan.observeYear(2025, 1);
  await scan.append(2026, report([entry('current')]));
  const checkpoint = storage.values.get('clockify-migration-history-scan');
  storage.values.set('clockify-migration-history-scan', { ...checkpoint, version: 0 });

  await assert.rejects(() => scan.status(), /expired or is malformed/i);
  assert.equal(storage.values.size, 0);
});

test('persists each captured year once instead of rewriting cumulative history after every annual export', async () => {
  const storage = sessionStorage();
  const scan = createClockifyHistoryScanService({ storageSession: storage, currentYear: () => CURRENT_YEAR, earliestYear: 2024 });
  await scan.start();
  await scan.observeYear(2026, 1);
  await scan.observeYear(2025, 1);
  await scan.observeYear(2024, 1);

  await scan.append(2026, report([entry('current')]));
  const firstCheckpoint = storage.values.get('clockify-migration-history-scan');
  assert.equal(Object.hasOwn(firstCheckpoint, 'data'), false, 'scan metadata must not serialize captured annual entries');
  assert.equal([...storage.values.values()].some(value => value?.entries?.some?.(candidate => candidate.entryId === 'current')), true);

  await scan.append(2025, report([entry('middle', 'person-1', '2025-02-03')]));
  const secondCheckpoint = storage.values.get('clockify-migration-history-scan');
  assert.equal(Object.hasOwn(secondCheckpoint, 'data'), false, 'later captures must not rewrite earlier annual entries into metadata');
  assert.equal([...storage.values.values()].filter(value => value?.entries?.length === 1).length, 2, 'each year is stored as one bounded shard');
});

test('rebuilds and validates the final aggregate from bounded annual shards after a service-worker restart', async () => {
  const storage = sessionStorage();
  const first = createClockifyHistoryScanService({ storageSession: storage, currentYear: () => CURRENT_YEAR, earliestYear: 2025 });
  await first.start();
  await first.observeYear(2026, 1);
  await first.observeYear(2025, 1);
  await first.append(2026, report([entry('current')]));

  const restarted = createClockifyHistoryScanService({ storageSession: storage, currentYear: () => CURRENT_YEAR, earliestYear: 2025 });
  const result = await restarted.append(2025, report([entry('prior', 'person-1', '2025-02-03')]));

  assert.deepEqual(result.data, report([entry('current'), entry('prior', 'person-1', '2025-02-03')]));
  assert.equal(storage.values.size, 0, 'all checkpoint shards are removed only after final aggregation succeeds');
});
