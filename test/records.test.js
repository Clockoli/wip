import test from 'node:test';
import assert from 'node:assert/strict';
import { buildActiveTimer, buildEntry, applyEntryEdits, validateActiveTimer, validateEntry } from '../src/domain/records.js';

const issue = { type: 'issue', owner: 'acme', repo: 'frontend', number: 123, url: 'https://github.com/acme/frontend/issues/123' };

test('computes duration from timestamps rather than render ticks', () => {
  const active = buildActiveTimer({ user: 'alice', issue, startedAt: '2026-08-18T08:00:00.000Z', description: '' });
  const entry = buildEntry({ active, id: '01K2ABCDEF0123456789ABCDEF', endedAt: '2026-08-18T09:42:27.000Z', now: '2026-08-18T09:42:30.000Z', description: 'OAuth' });
  assert.equal(entry.durationSeconds, 6147);
  assert.equal(entry.description, 'OAuth');
});

test('entry edits preserve identity and recompute duration', () => {
  const entry = {
    schemaVersion: 1, id: '01K2ABCDEF0123456789ABCDEF', user: 'alice', issue,
    startedAt: '2026-08-18T08:00:00.000Z', endedAt: '2026-08-18T09:00:00.000Z',
    durationSeconds: 3600, description: '', createdAt: '2026-08-18T09:00:01.000Z', updatedAt: '2026-08-18T09:00:01.000Z',
  };
  const edited = applyEntryEdits(entry, {
    issue: { ...issue, number: 124, url: 'https://github.com/acme/frontend/issues/124' },
    startedAt: '2026-08-18T08:00:00.000Z', endedAt: '2026-08-18T09:15:00.000Z', description: '<img onerror=alert(1)>',
  }, '2026-08-18T10:00:00.000Z');
  assert.equal(edited.id, entry.id);
  assert.equal(edited.user, entry.user);
  assert.equal(edited.entryDate, '2026-08-18');
  assert.equal(edited.durationSeconds, 4500);
  assert.equal(edited.description, '<img onerror=alert(1)>');
  assert.throws(() => applyEntryEdits(entry, { ...edited, endedAt: '2026-08-18T07:00:00.000Z' }), /end/i);
});


test('rejects malformed GitHub-backed active timer records', () => {
  assert.throws(() => validateActiveTimer({ schemaVersion: 999, user: 'alice', issue: { ...issue, url: 'javascript:alert(1)' }, startedAt: 'not-a-date', createdAt: 'not-a-date', description: '' }), /schema/i);
});


test('stored records require full UTC timestamps and bounded descriptions', () => {
  const base = { schemaVersion: 1, id: '01K2ABCDEF0123456789ABCDEF', user: 'alice', issue, startedAt: '2026-08-18T08:00:00.000Z', endedAt: '2026-08-18T09:00:00.000Z', durationSeconds: 3600, description: '', createdAt: '2026-08-18T09:00:00.000Z', updatedAt: '2026-08-18T09:00:00.000Z' };
  assert.throws(() => validateEntry({ ...base, startedAt: '2026-08-18' }), /timestamp/i);
  assert.throws(() => validateEntry({ ...base, description: 'x'.repeat(2001) }), /description/i);
  assert.throws(() => validateEntry({ ...base, startedAt: '2026-02-31T08:00:00.000Z' }), /timestamp/i);
  assert.throws(() => validateActiveTimer({ schemaVersion: 1, user: 'alice', issue, startedAt: '2026-02-31T08:00:00Z', createdAt: '2026-02-31T08:00:00Z', description: '' }), /timestamp/i);
});


test('new active timers and entries retain the local date captured at Start', () => {
  const originalTimezone = process.env.TZ;
  try {
    process.env.TZ = 'America/Los_Angeles';
    const active = buildActiveTimer({ user: 'alice', issue, startedAt: '2026-08-18T00:30:00.000Z', entryId: '01K2ABCDEF0123456789ABCDEF' });
    assert.equal(active.entryDate, '2026-08-17');
    process.env.TZ = 'Asia/Tokyo';
    const entry = buildEntry({ active, id: active.entryId, endedAt: '2026-08-18T01:30:00.000Z' });
    assert.equal(entry.entryDate, '2026-08-17');
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
});
