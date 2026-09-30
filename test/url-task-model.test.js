import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTaskUrl, parseGitHubTaskUrl, taskUrlOf } from '../src/domain/values.js';
import { parseActiveRecord, parseMonthlyRecords, serializeActiveRecord, serializeMonthlyRecords } from '../src/domain/work-records.js';
import { buildActiveTimer, buildEntry } from '../src/domain/records.js';

const arbitraryUrl = 'https://example.com/docs/search?q=repo+clock#result';
const ID = '01K2ABCDEF0123456789ABCDEF';

test('task identity is an arbitrary canonical HTTP(S) URL with optional GitHub metadata', () => {
  assert.equal(normalizeTaskUrl(arbitraryUrl), arbitraryUrl);
  assert.equal(normalizeTaskUrl('https://github.com/acme/app/issues/9?notification_referrer_id=1#issuecomment-1'), 'https://github.com/acme/app/issues/9');
  assert.equal(normalizeTaskUrl('http://localhost:8080/work/42'), 'http://localhost:8080/work/42');
  assert.equal(taskUrlOf({ issue: { url: 'https://github.com/acme/app/issues/7' } }), 'https://github.com/acme/app/issues/7');
  assert.deepEqual(parseGitHubTaskUrl('https://github.com/acme/app/pull/9'), {
    type: 'pull_request', owner: 'acme', repo: 'app', number: 9, url: 'https://github.com/acme/app/pull/9',
  });
  assert.equal(parseGitHubTaskUrl(arbitraryUrl), null);
  for (const invalid of ['javascript:alert(1)', 'file:///tmp/task', 'https://user:secret@example.com/', 'not a URL', 'acme/project/imported-task']) {
    assert.throws(() => normalizeTaskUrl(invalid), /task URL/i);
  }
  assert.equal(taskUrlOf({ taskUrl: 'acme/project/imported-task' }), 'acme/project/imported-task');
  assert.throws(() => buildActiveTimer({ user: 'alice', id: ID, taskUrl: 'acme/project/imported-task', startedAt: '2026-08-22T08:00:00Z', timezone: 'UTC' }), /task URL/i);
});

test('new timers and monthly records persist canonical work-item identity and title', () => {
  const active = buildActiveTimer({
    user: 'alice', id: ID, taskUrl: arbitraryUrl, taskTitle: '', startedAt: '2026-08-22T08:00:00Z',
    entryDate: '2026-08-22', timezone: 'UTC',
  });
  const entry = buildEntry({ active, endedAt: '2026-08-22T09:00:00Z' });
  const activeJson = serializeActiveRecord(active);
  const storedActive = JSON.parse(activeJson);
  assert.deepEqual(storedActive.work_item, { kind: 'url', id: `url:${arbitraryUrl}`, url: arbitraryUrl, title: '' });
  const parsedActive = parseActiveRecord(activeJson, { user: 'alice' });
  assert.equal(parsedActive.taskUrl, arbitraryUrl);
  assert.equal(parsedActive.id, ID);
  assert.equal('issue' in parsedActive, false);

  const monthlyJsonl = serializeMonthlyRecords([{ ...entry, taskTitle: 'Optional documentation task' }]);
  const parsed = parseMonthlyRecords(monthlyJsonl, { user: 'alice', month: '2026-08' })[0];
  assert.equal(parsed.taskUrl, arbitraryUrl);
  assert.equal(parsed.taskTitle, 'Optional documentation task');
  assert.equal(parsed.id, ID);
  assert.equal('issue' in parsed, false);
});

test('old text blocks are not accepted by the sole v1 reader', () => {
  assert.throws(() => parseMonthlyRecords(
    'URL: https://github.com/acme/app/issues/7\nStart: 2026-08-22T08:00:00Z\nEnd: 2026-08-22T09:00:00Z\n',
    { user: 'alice', month: '2026-08' },
  ), /JSON/i);
});
