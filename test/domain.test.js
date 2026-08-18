import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseIssueUrl,
  parseIssueReference,
  validatePathSegment,
  entryPath,
  localDateParts,
} from '../src/domain/values.js';

const localDate = new Date(2026, 7, 18, 23, 30, 0);

test('parses only canonical GitHub issue URLs', () => {
  assert.deepEqual(parseIssueUrl('https://github.com/acme/front-end/issues/123?x=1'), {
    type: 'issue', owner: 'acme', repo: 'front-end', number: 123,
    url: 'https://github.com/acme/front-end/issues/123',
  });
  assert.equal(parseIssueUrl('https://evil.example/acme/repo/issues/1'), null);
  assert.equal(parseIssueUrl('https://github.com/acme/repo/pull/1'), null);
  assert.equal(parseIssueUrl('https://github.com/acme/repo/issues/0'), null);
});

test('parses an editable issue reference', () => {
  assert.deepEqual(parseIssueReference('acme/frontend#42'), {
    type: 'issue', owner: 'acme', repo: 'frontend', number: 42,
    url: 'https://github.com/acme/frontend/issues/42',
  });
  assert.throws(() => parseIssueReference('../escape/repo#1'), /valid issue/i);
});

test('validates path segments and builds user-local entry paths', () => {
  assert.equal(validatePathSegment('alice-1', 'user'), 'alice-1');
  assert.throws(() => validatePathSegment('../alice', 'user'), /invalid user/i);
  const parts = localDateParts(localDate);
  assert.deepEqual(parts, { year: '2026', month: '08', day: '18' });
  assert.equal(entryPath('alice', parts, '01K2ABCDEF0123456789ABCDEF'),
    'entries/alice/2026/08/18/01K2ABCDEF0123456789ABCDEF.json');
});


test('rejects impossible calendar dates in generated and user-supplied entry paths', () => {
  assert.throws(() => entryPath('alice', { year: '2026', month: '02', day: '31' }, '01K2ABCDEF0123456789ABCDEF'), /date/i);
});
