import test from 'node:test';
import assert from 'node:assert/strict';
import { removeAllClockoliRecords, removeClockifyImportedTestRecords } from '../src/services/clockify-import-cleanup.js';
import { emptyTaskIndex, applyTaskIndexChanges, parseTaskIndex, serializeTaskIndex, TASK_INDEX_PATH } from '../src/domain/task-index.js';
import { buildActiveTimer, buildEntry } from '../src/domain/records.js';
import { serializeMonthlyRecords, parseMonthlyRecords } from '../src/domain/work-records.js';
import { USER_METADATA_PATH, userBranchMetadataText, userStorageBranch } from '../src/services/user-storage-branch.js';

const user = { id: 42, login: 'ada' };
const branch = userStorageBranch(user.id);
function record(id, taskUrl, imported) {
  const active = buildActiveTimer({ user: user.login, id, actor: { kind: 'human', id: 'github:42', name: 'ada' },
    producer: imported ? { kind: 'importer', name: 'clockoli', version: '1' } : { kind: 'browser_extension', name: 'clockoli-chrome', version: '1' },
    taskUrl, startedAt: '2026-09-01T08:00:00.000Z', entryDate: '2026-09-01', timezone: 'UTC',
    metadata: imported ? { clockoli_import: { provenance_sha256: 'a'.repeat(64) } } : {}, });
  return buildEntry({ active, endedAt: '2026-09-01T09:00:00.000Z', now: '2026-09-01T09:00:00.000Z' });
}

function fakeGitHub() {
  const files = new Map(); const writes = [];
  const client = {
    repositoryKey: 'test',
    async listTextFilesSnapshot() { return { files: [...files].filter(([path]) => path.startsWith('times/')).map(([path, value]) => ({ path, sha: value.sha })), headSha: 'head' }; },
    async listBranches(prefix) { assert.equal(prefix, 'clockoli/users/'); return [branch]; },
    forBranch(value) { assert.equal(value, branch); return client; },
    async getText(path) { const file = files.get(path); if (!file) { const error = new Error('missing'); error.status = 404; error.code = 'not_found'; throw error; } return { path, ...file }; },
    async updateTextsAtomic(changes, message, options) {
      writes.push({ changes, message, options });
      for (const item of [...changes, ...options.guards]) assert.equal(files.get(item.path)?.sha ?? null, item.sha ?? null);
      for (const change of changes) change.text === null ? files.delete(change.path) : files.set(change.path, { sha: `next-${change.path}`, text: change.text });
    },
  };
  return { files, writes, client };
}

test('removes only marked Clockify placeholder records and updates the task index atomically', async () => {
  const { files, writes, client } = fakeGitHub();
  const imported = record('01K2ABCDEF0123456789ABCDEF', `https://clockoli.invalid/imported-work/${'a'.repeat(64)}`, true);
  const normal = record('01K2ABCDEF0123456789ABCDEE', 'https://example.com/work', false);
  files.set(USER_METADATA_PATH, { sha: 'user', text: userBranchMetadataText(user) });
  files.set('times/2026-09/ada.jsonl', { sha: 'times', text: serializeMonthlyRecords([imported, normal]) });
  files.set(TASK_INDEX_PATH, { sha: 'index', text: serializeTaskIndex(applyTaskIndexChanges(emptyTaskIndex(user.login), { add: [imported, normal] })) });

  assert.deepEqual(await removeClockifyImportedTestRecords({ github: client }), { usersScanned: 1, usersCleaned: 1, recordsDeleted: 1 });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].message, 'Remove Clockify test import records');
  assert.deepEqual(writes[0].changes.map(item => item.path).sort(), [TASK_INDEX_PATH, 'times/2026-09/ada.jsonl']);
  assert.deepEqual(parseMonthlyRecords(files.get('times/2026-09/ada.jsonl').text, { user: user.login, month: '2026-09', path: 'times/2026-09/ada.jsonl' }).map(item => item.id), [normal.id]);
});

test('removes every completed record on the configured personal branch and clears its task index atomically', async () => {
  const { files, writes, client } = fakeGitHub();
  const first = record('01K2ABCDEF0123456789ABCDEF', 'https://example.com/first', false);
  const second = record('01K2ABCDEF0123456789ABCDEE', 'https://example.com/second', true);
  files.set(USER_METADATA_PATH, { sha: 'user', text: userBranchMetadataText(user) });
  files.set('times/2026-09/ada.jsonl', { sha: 'times', text: serializeMonthlyRecords([first, second]) });
  files.set(TASK_INDEX_PATH, { sha: 'index', text: serializeTaskIndex(applyTaskIndexChanges(emptyTaskIndex(user.login), { add: [first, second] })) });

  assert.deepEqual(await removeAllClockoliRecords({ github: client }), { recordsDeleted: 2 });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].message, 'Delete all Clockoli work records');
  assert.deepEqual(writes[0].changes.map(item => item.path).sort(), [TASK_INDEX_PATH, 'times/2026-09/ada.jsonl']);
  assert.equal(writes[0].changes.find(item => item.path === 'times/2026-09/ada.jsonl').text, null);
  assert.deepEqual(parseTaskIndex(files.get(TASK_INDEX_PATH).text, { user: user.login }), emptyTaskIndex(user.login));
});
