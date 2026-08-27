import test from 'node:test';
import assert from 'node:assert/strict';
import { buildActiveTimer, buildEntry, applyEntryEdits, validateActiveTimer, validateEntry } from '../src/domain/records.js';

const ID = '01K2ABCDEF0123456789ABCDEF';
const issue = { type: 'issue', owner: 'acme', repo: 'frontend', number: 123, url: 'https://github.com/acme/frontend/issues/123' };
const actor = { kind: 'human', id: 'github:123', name: 'alice' };
const producer = { kind: 'browser_extension', name: 'clockoli-chrome', version: '0.1.29' };

function active(overrides = {}) {
  return buildActiveTimer({
    user: 'alice', id: ID, actor, producer, issue, startedAt: '2026-08-18T08:00:00.000Z',
    entryDate: '2026-08-18', timezone: 'UTC', description: '', ...overrides,
  });
}

function completed(overrides = {}) {
  return buildEntry({ active: active(), endedAt: '2026-08-18T09:00:00.000Z', now: '2026-08-18T09:00:01.000Z', ...overrides });
}

test('computes duration from timestamps rather than render ticks and preserves the active ID', () => {
  const timer = active();
  const entry = buildEntry({ active: timer, endedAt: '2026-08-18T09:42:27.000Z', now: '2026-08-18T09:42:30.000Z', description: 'OAuth' });
  assert.equal(entry.id, timer.id);
  assert.equal(entry.durationSeconds, 6147);
  assert.equal(entry.description, 'OAuth');
  assert.equal(entry.createdAt, timer.createdAt);
  assert.equal(entry.updatedAt, '2026-08-18T09:42:30.000Z');
  assert.throws(() => buildEntry({ active: timer, id: '01K2ABCDEF0123456789ABCDEG', endedAt: entry.endedAt }), /must match/i);
});

test('entry edits preserve identity and recompute duration and calendar partition', () => {
  const entry = completed();
  const edited = applyEntryEdits(entry, {
    issue: { ...issue, number: 124, url: 'https://github.com/acme/frontend/issues/124' },
    startedAt: '2026-08-19T08:00:00.000Z', endedAt: '2026-08-19T09:15:00.000Z',
    description: '<img onerror=alert(1)>', issueTitle: '  New   issue\ttitle  ',
  }, '2026-08-19T10:00:00.000Z');
  assert.equal(edited.id, entry.id);
  assert.equal(edited.user, entry.user);
  assert.equal(edited.entryDate, '2026-08-19');
  assert.equal(edited.durationSeconds, 4500);
  assert.equal(edited.description, '<img onerror=alert(1)>');
  assert.equal(edited.issueTitle, 'New issue title');
  assert.throws(() => applyEntryEdits(entry, { endedAt: '2026-08-18T07:00:00.000Z' }), /end/i);
});

test('rejects malformed active timer records', () => {
  assert.throws(() => validateActiveTimer({ schemaVersion: 999, user: 'alice' }), /schema/i);
});

test('stored runtime projections require full fields, timestamps, and bounded descriptions', () => {
  const base = completed();
  assert.throws(() => validateEntry({ ...base, startedAt: '2026-08-18' }), /timestamp/i);
  assert.throws(() => validateEntry({ ...base, description: 'x'.repeat(2001) }), /description/i);
  assert.throws(() => validateEntry({ ...base, startedAt: '2026-02-31T08:00:00.000Z' }), /timestamp/i);
  assert.throws(() => validateActiveTimer({ ...active(), startedAt: '2026-02-31T08:00:00Z' }), /timestamp/i);
  assert.throws(() => validateActiveTimer({ ...active(), timezone: '' }), /timezone/i);
  assert.throws(() => validateEntry({ ...base, timezone: '   ' }), /timezone/i);
  assert.throws(() => buildActiveTimer({ ...active(), timezone: '' }), /timezone/i);
  assert.throws(() => validateEntry({ ...base, actor: null }), /actor/i);
  assert.throws(() => validateEntry({ ...base, producer: null }), /producer/i);
});

test('new active timers and entries retain local date and IANA timezone captured at Start', () => {
  const timer = active({
    startedAt: '2026-08-18T00:30:00.000Z', entryDate: '2026-08-17', timezone: 'America/Los_Angeles',
  });
  const entry = buildEntry({ active: timer, endedAt: '2026-08-18T01:30:00.000Z' });
  assert.equal(timer.entryDate, '2026-08-17');
  assert.equal(entry.entryDate, '2026-08-17');
  assert.equal(entry.timezone, 'America/Los_Angeles');
});
