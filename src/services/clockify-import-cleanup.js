import { applyTaskIndexChanges, emptyTaskIndex, parseTaskIndex, serializeTaskIndex, TASK_INDEX_PATH } from '../domain/task-index.js';
import { parseMonthlyRecords, parseMonthlyRecordsPath, serializeMonthlyRecords } from '../domain/work-records.js';
import { USER_METADATA_PATH, discoverUserStorageBranches, parseUserBranchMetadata } from './user-storage-branch.js';

const IMPORT_PROVENANCE = /^[a-f0-9]{64}$/;
const IMPORT_URL = 'https://clockoli.invalid/imported-work';

function isImportedTestRecord(record) {
  const provenance = record?.metadata?.clockoli_import?.provenance_sha256 || '';
  return record?.producer?.kind === 'importer' && record.producer?.name === 'clockoli' && record.producer?.version === '1'
    && IMPORT_PROVENANCE.test(provenance) && record.taskUrl === `${IMPORT_URL}/${provenance}`;
}

/** Removes only records created by the defective Clockify placeholder importer. */
export async function removeClockifyImportedTestRecords({ github } = {}) {
  if (!github || typeof github.listTextFilesSnapshot !== 'function') throw new Error('Invalid Clockify cleanup request');
  const users = await discoverUserStorageBranches(github);
  let recordsDeleted = 0;
  let usersCleaned = 0;
  for (const user of users) {
    const snapshot = await user.github.listTextFilesSnapshot('times/');
    const paths = (snapshot.files ?? []).map(file => file.path).filter(path => {
      try { return parseMonthlyRecordsPath(path).user === user.login; } catch { return false; }
    }).sort();
    const files = [];
    for (const path of paths) {
      const file = await user.github.getText(path);
      const parsed = parseMonthlyRecordsPath(path);
      const entries = parseMonthlyRecords(file.text, { user: user.login, month: parsed.month, path, sha: file.sha });
      const removed = entries.filter(isImportedTestRecord);
      if (removed.length) files.push({ path, sha: file.sha, entries: entries.filter(record => !isImportedTestRecord(record)), removed });
    }
    if (!files.length) continue;
    const metadataFile = await user.github.getText(USER_METADATA_PATH);
    const metadata = parseUserBranchMetadata(metadataFile.text);
    if (metadata.id !== user.id || metadata.login.toLowerCase() !== user.login.toLowerCase()) throw new Error('Clockoli storage ownership changed during cleanup');
    const indexFile = await user.github.getText(TASK_INDEX_PATH);
    const index = parseTaskIndex(indexFile.text, { user: user.login });
    const removed = files.flatMap(file => file.removed);
    const nextIndex = applyTaskIndexChanges(index, { remove: removed });
    const changes = files.map(file => ({ path: file.path, sha: file.sha, text: serializeMonthlyRecords(file.entries) || null }));
    changes.push({ path: TASK_INDEX_PATH, sha: indexFile.sha, text: serializeTaskIndex(nextIndex) });
    await user.github.updateTextsAtomic(changes, 'Remove Clockify test import records', {
      guards: [{ path: USER_METADATA_PATH, sha: metadataFile.sha }],
      expectedHeadSha: snapshot.headSha || null,
    });
    usersCleaned += 1;
    recordsDeleted += removed.length;
  }
  return { usersScanned: users.length, usersCleaned, recordsDeleted };
}

/** Removes every completed work record from the configured personal branch. */
export async function removeAllClockoliRecords({ github } = {}) {
  if (!github || typeof github.listTextFilesSnapshot !== 'function') throw new Error('Invalid Clockoli record deletion request');
  const metadataFile = await github.getText(USER_METADATA_PATH);
  const user = parseUserBranchMetadata(metadataFile.text);
  const snapshot = await github.listTextFilesSnapshot('times/');
  const paths = (snapshot.files ?? []).map(file => file.path).filter(path => {
    try { return parseMonthlyRecordsPath(path).user === user.login; } catch { return false; }
  }).sort();
  const files = [];
  for (const path of paths) {
    const file = await github.getText(path);
    const parsed = parseMonthlyRecordsPath(path);
    const entries = parseMonthlyRecords(file.text, { user: user.login, month: parsed.month, path, sha: file.sha });
    files.push({ path, sha: file.sha, entries });
  }
  const indexFile = await github.getText(TASK_INDEX_PATH);
  parseTaskIndex(indexFile.text, { user: user.login });
  const recordsDeleted = files.reduce((total, file) => total + file.entries.length, 0);
  if (!files.length) return { recordsDeleted: 0 };
  const changes = files.map(file => ({ path: file.path, sha: file.sha, text: null }));
  changes.push({ path: TASK_INDEX_PATH, sha: indexFile.sha, text: serializeTaskIndex(emptyTaskIndex(user.login)) });
  await github.updateTextsAtomic(changes, 'Delete all Clockoli work records', {
    guards: [{ path: USER_METADATA_PATH, sha: metadataFile.sha }], expectedHeadSha: snapshot.headSha || null,
  });
  return { recordsDeleted };
}
