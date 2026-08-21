import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activeTextPath, monthlyTextPath, parseActiveText, parseMonthlyText,
  parseMonthlyTextPath, serializeActiveText, serializeMonthlyText, timestampWithTimezone,
} from '../src/domain/monthly-text.js';

const issue = { type: 'issue', owner: 'acme', repo: 'frontend', number: 123, url: 'https://github.com/acme/frontend/issues/123' };
const entry = {
  schemaVersion: 1, id: '20260818000000000000000000', user: 'alice', issue, entryDate: '2026-08-18',
  startedAt: '2026-08-18T08:00:00-07:00', endedAt: '2026-08-18T09:15:30-07:00', durationSeconds: 4530,
  description: 'Investigated ranking', issueTitle: 'Ranking regression',
  createdAt: '2026-08-18T09:15:30-07:00', updatedAt: '2026-08-18T09:15:30-07:00',
};

test('monthly path identifies month and GitHub user without storing user in content', () => {
  assert.equal(monthlyTextPath('alice', '2026-08-18'), 'times/2026-08/alice.txt');
  assert.deepEqual(parseMonthlyTextPath('times/2026-08/alice.txt'), { path: 'times/2026-08/alice.txt', month: '2026-08', user: 'alice' });
  assert.equal(activeTextPath('alice'), 'active/alice.txt');
  assert.throws(() => monthlyTextPath('../alice', '2026-08-18'), /user/i);
  assert.throws(() => parseMonthlyTextPath('times/2026-08-18/alice.txt'), /monthly/i);
});

test('monthly text round-trips records from different days in the same month', () => {
  const second = { ...entry, issue: { type: 'pull_request', owner: 'acme', repo: 'frontend', number: 44, url: 'https://github.com/acme/frontend/pull/44' }, startedAt: '2026-08-19T10:00:00Z', endedAt: '2026-08-19T10:30:00Z', durationSeconds: 1800, description: '' };
  const text = serializeMonthlyText([entry, second]);
  assert.doesNotMatch(text, /schemaVersion|durationSeconds|user|\"/);
  const parsed = parseMonthlyText(text, { user: 'alice', month: '2026-08', path: 'times/2026-08/alice.txt', sha: 'monthly-sha' });
  assert.deepEqual(parsed.map(record => record.entryDate), ['2026-08-18', '2026-08-19']);
  assert.equal(parsed[0]._index, 0);
  assert.equal(parsed[0]._sha, 'monthly-sha');
  assert.equal(parsed[0].durationSeconds, 4530);
  assert.equal(parsed[0].issueTitle, 'Ranking regression');
  assert.match(text, /Title: Ranking regression/);
  assert.equal(parsed[1].issue.type, 'pull_request');
  assert.equal(parsed[1].issueTitle, 'Ranking regression');
});

test('monthly text rejects malformed, duplicate, unknown, and timezone-free fields', () => {
  const base = 'URL: https://github.com/acme/frontend/issues/123\nStart: 2026-08-18T08:00:00-07:00\nEnd: 2026-08-18T09:00:00-07:00\n';
  assert.throws(() => parseMonthlyText(base.replace('-07:00', ''), { user: 'alice', month: '2026-08' }), /timezone|timestamp/i);
  assert.throws(() => parseMonthlyText(base + 'End: 2026-08-18T10:00:00-07:00\n', { user: 'alice', month: '2026-08' }), /duplicate/i);
  assert.throws(() => parseMonthlyText(base + 'User: alice\n', { user: 'alice', month: '2026-08' }), /unknown/i);
  assert.throws(() => parseMonthlyText(base.replace('09:00:00', '07:00:00'), { user: 'alice', month: '2026-08' }), /end/i);
  assert.throws(() => timestampWithTimezone('2026-02-31T08:00:00+03:00'), /timestamp/i);
});

test('monthly text rejects a record stored under a different Start month', () => {
  const text = 'URL: https://github.com/acme/frontend/issues/123\nStart: 2026-08-31T23:00:00+00:00\nEnd: 2026-09-01T00:00:00+00:00\n';
  assert.throws(() => parseMonthlyText(text, { user: 'alice', month: '2026-09', path: 'times/2026-09/alice.txt' }), /Start month must match monthly file month/i);
});

test('monthly text derives its month from the path rather than trusting context', () => {
  const text = 'URL: https://github.com/acme/frontend/issues/123\nStart: 2026-08-18T23:00:00+00:00\nEnd: 2026-08-19T00:00:00+00:00\n';
  assert.throws(() => parseMonthlyText(text, { user: 'alice', month: '2026-08', path: 'times/2026-09/alice.txt' }), /path month.*context month|monthly file month/i);
});

test('active text is readable and retains the issue title without generated metadata', () => {
  const active = { schemaVersion: 1, user: 'alice', issue, issueTitle: 'Ranking regression', startedAt: '2026-08-18T08:00:00-07:00', description: 'Working', createdAt: '2026-08-18T08:00:00-07:00' };
  const text = serializeActiveText(active);
  assert.equal(text, 'URL: https://github.com/acme/frontend/issues/123\nTitle: Ranking regression\nStart: 2026-08-18T08:00:00-07:00\nDescription: Working\n');
  const parsed = parseActiveText(text, { user: 'alice', path: 'active/alice.txt', sha: 'active-sha' });
  assert.equal(parsed.entryDate, '2026-08-18');
  assert.equal(parsed.issueTitle, 'Ranking regression');
  assert.equal(parsed._sha, 'active-sha');
});

test('legacy text without Title remains readable and titles are normalized to one bounded line', () => {
  const legacy = 'URL: https://github.com/acme/frontend/issues/123\nStart: 2026-08-18T08:00:00-07:00\nEnd: 2026-08-18T09:00:00-07:00\n';
  assert.equal(parseMonthlyText(legacy, { user: 'alice', month: '2026-08' })[0].issueTitle, '');
  const text = serializeMonthlyText([{ ...entry, issueTitle: `  line one\nline two ${'x'.repeat(400)}  ` }]);
  const parsed = parseMonthlyText(text, { user: 'alice', month: '2026-08' })[0];
  assert.equal(parsed.issueTitle, `line one line two ${'x'.repeat(282)}`);
  assert.equal(parsed.issueTitle.length, 300);
});

test('descriptions are normalized to one manually editable line', () => {
  const text = serializeMonthlyText([{ ...entry, description: 'line one\nline two\tTabbed' }]);
  assert.match(text, /Description: line one line two Tabbed/);
  assert.equal(parseMonthlyText(text, { user: 'alice', month: '2026-08' })[0].description, 'line one line two Tabbed');
});
