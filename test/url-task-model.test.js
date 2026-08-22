import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTaskUrl, parseGitHubTaskUrl, taskUrlOf } from '../src/domain/values.js';
import { parseActiveText, parseMonthlyText, serializeActiveText, serializeMonthlyText } from '../src/domain/monthly-text.js';
import { buildActiveTimer, buildEntry } from '../src/domain/records.js';

const arbitraryUrl = 'https://example.com/docs/search?q=repo+clock#result';

test('task identity is an arbitrary canonical HTTP(S) URL with optional GitHub metadata', () => {
  assert.equal(normalizeTaskUrl(arbitraryUrl), arbitraryUrl);
  assert.equal(normalizeTaskUrl('https://github.com/acme/app/issues/9?notification_referrer_id=1#issuecomment-1'), 'https://github.com/acme/app/issues/9');
  assert.equal(normalizeTaskUrl('http://localhost:8080/work/42'), 'http://localhost:8080/work/42');
  assert.equal(taskUrlOf({ issue: { url: 'https://github.com/acme/app/issues/7' } }), 'https://github.com/acme/app/issues/7');
  assert.deepEqual(parseGitHubTaskUrl('https://github.com/acme/app/pull/9'), {
    type: 'pull_request', owner: 'acme', repo: 'app', number: 9, url: 'https://github.com/acme/app/pull/9',
  });
  assert.equal(parseGitHubTaskUrl(arbitraryUrl), null);
  for (const invalid of ['javascript:alert(1)', 'file:///tmp/task', 'https://user:secret@example.com/', 'not a URL']) {
    assert.throws(() => normalizeTaskUrl(invalid), /task URL/i);
  }
});

test('new timers and monthly records store only task URL plus an optional task title', () => {
  const active = buildActiveTimer({ user: 'alice', taskUrl: arbitraryUrl, taskTitle: '', startedAt: '2026-08-22T08:00:00Z' });
  assert.equal(active.taskUrl, arbitraryUrl);
  assert.equal(active.taskTitle, '');
  assert.equal('issue' in active, false);
  const entry = buildEntry({ active, id: '01K2ABCDEF0123456789ABCDEF', endedAt: '2026-08-22T09:00:00Z' });
  assert.equal(entry.taskUrl, arbitraryUrl);
  assert.equal('issue' in entry, false);

  const activeText = serializeActiveText(active);
  assert.equal(activeText, `URL: ${arbitraryUrl}\nStart: 2026-08-22T08:00:00Z\n`);
  const parsedActive = parseActiveText(activeText, { user: 'alice' });
  assert.equal(parsedActive.taskUrl, arbitraryUrl);
  assert.equal(parsedActive.taskTitle, '');
  assert.equal('issue' in parsedActive, false);

  const monthlyText = serializeMonthlyText([{ ...entry, taskTitle: 'Optional documentation task' }]);
  const parsed = parseMonthlyText(monthlyText, { user: 'alice', month: '2026-08' })[0];
  assert.equal(parsed.taskUrl, arbitraryUrl);
  assert.equal(parsed.taskTitle, 'Optional documentation task');
  assert.equal('issue' in parsed, false);
});

test('legacy GitHub-shaped runtime records remain serializable without rewriting URL data', () => {
  const issue = { type: 'issue', owner: 'acme', repo: 'app', number: 7, url: 'https://github.com/acme/app/issues/7' };
  const text = serializeMonthlyText([{
    schemaVersion: 1, id: '01K2ABCDEF0123456789ABCDEF', user: 'alice', issue, issueTitle: 'Legacy title',
    startedAt: '2026-08-22T08:00:00Z', endedAt: '2026-08-22T09:00:00Z', durationSeconds: 3600,
    description: '', createdAt: '2026-08-22T09:00:00Z', updatedAt: '2026-08-22T09:00:00Z',
  }]);
  assert.match(text, /^URL: https:\/\/github\.com\/acme\/app\/issues\/7\nTitle: Legacy title/m);
  const parsed = parseMonthlyText(text, { user: 'alice', month: '2026-08' })[0];
  assert.equal(parsed.taskUrl, issue.url);
  assert.equal(parsed.taskTitle, 'Legacy title');
});
