import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activeTextPath, dailyTextPath, parseActiveText, parseDailyText,
  serializeActiveText, serializeDailyText, timestampWithTimezone,
} from '../src/domain/daily-text.js';

const issue = { type: 'issue', owner: 'acme', repo: 'frontend', number: 123, url: 'https://github.com/acme/frontend/issues/123' };

const entry = {
  schemaVersion: 1, id: '20260818000000000000000000', user: 'alice', issue, entryDate: '2026-08-18',
  startedAt: '2026-08-18T08:00:00-07:00', endedAt: '2026-08-18T09:15:30-07:00', durationSeconds: 4530,
  description: 'Investigated ranking', createdAt: '2026-08-18T09:15:30-07:00', updatedAt: '2026-08-18T09:15:30-07:00',
};

test('daily path identifies date and GitHub user without storing user in content', () => {
  assert.equal(dailyTextPath('alice', '2026-08-18'), 'times/2026-08-18/alice.txt');
  assert.equal(activeTextPath('alice'), 'active/alice.txt');
  assert.throws(() => dailyTextPath('../alice', '2026-08-18'), /user/i);
});

test('daily text round-trips only URL, timezone timestamps, and optional description', () => {
  const text = serializeDailyText([entry, { ...entry, id: '20260818000000000000000001', issue: { type: 'pull_request', owner: 'acme', repo: 'frontend', number: 44, url: 'https://github.com/acme/frontend/pull/44' }, startedAt: '2026-08-18T10:00:00Z', endedAt: '2026-08-18T10:30:00Z', durationSeconds: 1800, description: '' }]);
  assert.equal(text, `URL: https://github.com/acme/frontend/issues/123\nStart: 2026-08-18T08:00:00-07:00\nEnd: 2026-08-18T09:15:30-07:00\nDescription: Investigated ranking\n\nURL: https://github.com/acme/frontend/pull/44\nStart: 2026-08-18T10:00:00Z\nEnd: 2026-08-18T10:30:00Z\n`);
  assert.doesNotMatch(text, /schemaVersion|durationSeconds|user|\"/);
  const parsed = parseDailyText(text, { user: 'alice', date: '2026-08-18', path: 'times/2026-08-18/alice.txt', sha: 'daily-sha' });
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].user, 'alice');
  assert.equal(parsed[0]._index, 0);
  assert.equal(parsed[0]._sha, 'daily-sha');
  assert.equal(parsed[0].durationSeconds, 4530);
  assert.equal(parsed[1].issue.type, 'pull_request');
  assert.equal(parsed[1].description, '');
});

test('daily text rejects malformed, duplicate, unknown, and timezone-free fields', () => {
  const base = 'URL: https://github.com/acme/frontend/issues/123\nStart: 2026-08-18T08:00:00-07:00\nEnd: 2026-08-18T09:00:00-07:00\n';
  assert.throws(() => parseDailyText(base.replace('-07:00', ''), { user: 'alice', date: '2026-08-18' }), /timezone|timestamp/i);
  assert.throws(() => parseDailyText(base + 'End: 2026-08-18T10:00:00-07:00\n', { user: 'alice', date: '2026-08-18' }), /duplicate/i);
  assert.throws(() => parseDailyText(base + 'User: alice\n', { user: 'alice', date: '2026-08-18' }), /unknown/i);
  assert.throws(() => parseDailyText(base.replace('09:00:00', '07:00:00'), { user: 'alice', date: '2026-08-18' }), /end/i);
  assert.throws(() => timestampWithTimezone('2026-02-31T08:00:00+03:00'), /timestamp/i);
});

test('daily text rejects a record stored under a different Start date', () => {
  const text = 'URL: https://github.com/acme/frontend/issues/123\nStart: 2026-08-18T23:00:00+00:00\nEnd: 2026-08-19T00:00:00+00:00\n';
  assert.throws(() => parseDailyText(text, {
    user: 'alice', date: '2026-08-19', path: 'times/2026-08-19/alice.txt',
  }), /Start date must match daily file date/i);
});

test('daily text derives its date from the path rather than trusting a mismatched context date', () => {
  const text = 'URL: https://github.com/acme/frontend/issues/123\nStart: 2026-08-18T23:00:00+00:00\nEnd: 2026-08-19T00:00:00+00:00\n';
  assert.throws(() => parseDailyText(text, {
    user: 'alice', date: '2026-08-18', path: 'times/2026-08-19/alice.txt',
  }), /path date.*context date|daily file date/i);
});

test('active text is readable and omits user and generated metadata', () => {
  const active = { schemaVersion: 1, user: 'alice', issue, startedAt: '2026-08-18T08:00:00-07:00', description: 'Working', createdAt: '2026-08-18T08:00:00-07:00' };
  const text = serializeActiveText(active);
  assert.equal(text, 'URL: https://github.com/acme/frontend/issues/123\nStart: 2026-08-18T08:00:00-07:00\nDescription: Working\n');
  const parsed = parseActiveText(text, { user: 'alice', path: 'active/alice.txt', sha: 'active-sha' });
  assert.equal(parsed.user, 'alice');
  assert.equal(parsed.entryDate, '2026-08-18');
  assert.equal(parsed._sha, 'active-sha');
  assert.equal(parsed.description, 'Working');
});

test('descriptions are normalized to one manually editable line', () => {
  const text = serializeDailyText([{ ...entry, description: 'line one\nline two\tTabbed' }]);
  assert.match(text, /Description: line one line two Tabbed/);
  assert.equal(parseDailyText(text, { user: 'alice', date: '2026-08-18' })[0].description, 'line one line two Tabbed');
});
