import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTaskIndex, TASK_INDEX_PATH } from '../src/domain/task-index.js';
import { parseMonthlyRecords, parseMonthlyRecordsPath } from '../src/domain/work-records.js';
import { parseUserBranchMetadata, userStorageBranch, USER_METADATA_PATH } from '../src/services/user-storage-branch.js';
import { previewTaskIndexBackfill } from '../src/services/task-index-backfill.js';

const SHA = /^[a-f0-9]{40}$/i;
const REPOSITORY = /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const DEFAULT_LIMITS = Object.freeze({ maxFiles: 500, maxBytes: 30 * 1024 * 1024, maxRecords: 100000 });

function blobFromTree(tree, path) {
  const matches = tree.filter(item => item.path === path && item.type === 'blob');
  if (matches.length !== 1 || !SHA.test(matches[0].sha)
      || !Number.isSafeInteger(matches[0].size) || matches[0].size < 0) {
    throw new Error(`Missing or invalid Clockoli file: ${path}`);
  }
  return matches[0];
}

async function readBlob(repository, file, read) {
  const blob = await read(`repos/${repository}/git/blobs/${file.sha}`);
  if (blob?.encoding !== 'base64' || typeof blob.content !== 'string' || blob.size !== file.size) {
    throw new Error(`Clockoli file size or encoding mismatch: ${file.path}`);
  }
  const bytes = Buffer.from(blob.content.replace(/\s/g, ''), 'base64');
  if (bytes.length !== file.size) throw new Error(`Clockoli file size mismatch: ${file.path}`);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new Error(`Clockoli file is not valid UTF-8: ${file.path}`); }
}

export async function previewGithubTaskIndex(repository, read, limits = {}) {
  if (!REPOSITORY.test(repository)) throw new Error('Specify one owner/repository time repository');
  const budget = { ...DEFAULT_LIMITS, ...limits };
  if (Object.values(budget).some(value => !Number.isSafeInteger(value) || value < 0)) {
    throw new Error('Invalid preview budget');
  }
  const account = await read('user');
  const branch = userStorageBranch(account?.id);
  const branchPath = `repos/${repository}/branches/${branch}`;
  const head = await read(branchPath);
  const commitSha = head?.commit?.sha, treeSha = head?.commit?.commit?.tree?.sha;
  if (!SHA.test(commitSha) || !SHA.test(treeSha)) throw new Error('Invalid personal-branch snapshot');
  const snapshot = await read(`repos/${repository}/git/trees/${treeSha}?recursive=1`);
  if (snapshot?.truncated !== false || !Array.isArray(snapshot.tree)) throw new Error('Personal-branch tree is truncated or invalid');
  const markerFile = blobFromTree(snapshot.tree, USER_METADATA_PATH);
  const indexFile = blobFromTree(snapshot.tree, TASK_INDEX_PATH);
  const marker = parseUserBranchMetadata(await readBlob(repository, markerFile, read));
  if (marker.id !== account.id || marker.login.toLowerCase() !== account.login?.toLowerCase()) {
    throw new Error('Personal branch does not belong to the signed-in GitHub account');
  }
  const monthlyFiles = snapshot.tree.filter(file => file.path?.startsWith('times/')
    && file.path !== 'times/.gitkeep' && file.type !== 'tree').map(file => {
    const parsed = parseMonthlyRecordsPath(file.path);
    if (file.type !== 'blob' || parsed.user !== marker.login || !SHA.test(file.sha)
        || !Number.isSafeInteger(file.size) || file.size < 0) {
      throw new Error('Personal branch contains an invalid monthly file');
    }
    return file;
  });
  if (monthlyFiles.length > budget.maxFiles) throw new Error('Monthly file budget exceeded; preview is incomplete');
  const allFiles = [markerFile, indexFile, ...monthlyFiles];
  if (allFiles.reduce((sum, file) => sum + file.size, 0) > budget.maxBytes) {
    throw new Error('Byte budget exceeded; preview is incomplete');
  }
  const index = parseTaskIndex(await readBlob(repository, indexFile, read), { user: marker.login });
  const records = [];
  for (const file of monthlyFiles) {
    const text = await readBlob(repository, file, read);
    records.push(...parseMonthlyRecords(text, { path: file.path, user: marker.login }));
    if (records.length > budget.maxRecords) throw new Error('Record budget exceeded; preview is incomplete');
  }
  const preview = previewTaskIndexBackfill(index, records);
  const after = await read(branchPath);
  if (after?.commit?.sha !== commitSha) throw new Error('Personal branch changed during preview; rerun it');
  return { repository, branch, commitSha, indexSha: indexFile.sha, fileCount: monthlyFiles.length,
    ...preview };
}

function ghRead(endpoint) {
  try {
    return JSON.parse(execFileSync('gh', ['api', '--method', 'GET', endpoint], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024,
    }));
  } catch {
    throw new Error(`GitHub read failed at ${endpoint}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log('Read-only preview: node scripts/preview-task-index-backfill.mjs --repo owner/repository');
  } else if (args.length !== 2 || args[0] !== '--repo') {
    console.error('Usage: node scripts/preview-task-index-backfill.mjs --repo owner/repository');
    process.exitCode = 2;
  } else {
    previewGithubTaskIndex(args[1], ghRead).then(({ repository, branch, commitSha, indexSha, fileCount, counts }) => {
      console.log(JSON.stringify({ repository, branch, commitSha, indexSha, monthlyFiles: fileCount, ...counts }, null, 2));
    }).catch(error => { console.error(`Preview failed: ${error.message}`); process.exitCode = 1; });
  }
}
