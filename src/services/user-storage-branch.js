import { emptyTaskIndex, parseTaskIndex, serializeTaskIndex, TASK_INDEX_PATH } from '../domain/task-index.js';

const USER_BRANCH_PREFIX = 'clockoli/users/';
const USER_METADATA_PATH = '.clockoli/user.json';
const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

function notFound(error) { return error?.status === 404 || error?.code === 'not_found'; }
async function readUserMetadata(github, options) {
  return github.getText(USER_METADATA_PATH, options);
}
function validIdentity(user) {
  return Number.isSafeInteger(user?.id) && user.id > 0 && typeof user.login === 'string' && LOGIN_RE.test(user.login);
}

export function userStorageBranch(userId) {
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error('Invalid GitHub user ID for storage branch');
  return `${USER_BRANCH_PREFIX}${userId}`;
}

export function userBranchMetadataText(user) {
  if (!validIdentity(user)) throw new Error('Invalid GitHub user identity for storage branch');
  return `${JSON.stringify({ version: 1, githubUserId: user.id, storageLogin: user.login }, null, 2)}\n`;
}

export function parseUserBranchMetadata(text) {
  let value;
  try { value = JSON.parse(String(text)); } catch { throw new Error('Clockoli user branch metadata is not valid JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).sort().join(',') !== 'githubUserId,storageLogin,version'
      || value.version !== 1 || !validIdentity({ id: value.githubUserId, login: value.storageLogin })) {
    throw new Error('Clockoli user branch metadata is invalid');
  }
  return { id: value.githubUserId, login: value.storageLogin };
}

export async function ensureUserStorageBranch(github, user, sourceBranch) {
  if (!validIdentity(user)) throw new Error('Invalid GitHub user identity for storage branch');
  const branch = userStorageBranch(user.id);
  const expected = userBranchMetadataText(user);
  const initialChanges = [
    { path: USER_METADATA_PATH, sha: null, text: expected },
    { path: TASK_INDEX_PATH, sha: null, text: serializeTaskIndex(emptyTaskIndex(user.login)) },
  ];
  const ensured = await github.ensureBranchWithTexts(branch, sourceBranch, initialChanges, 'Initialize Clockoli user storage branch');
  const branchGithub = github.forBranch(branch, 'custom');
  try {
    const file = await readUserMetadata(branchGithub);
    const actual = parseUserBranchMetadata(file.text);
    if (actual.id !== user.id || actual.login.toLowerCase() !== user.login.toLowerCase()) {
      throw new Error('Clockoli user branch belongs to a different GitHub account');
    }
    let indexFile;
    try { indexFile = await branchGithub.getText(TASK_INDEX_PATH); }
    catch (error) {
      if (notFound(error)) throw new Error('Existing Clockoli user branch is missing its task index');
      throw error;
    }
    parseTaskIndex(indexFile.text, { user: actual.login });
  } catch (error) {
    if (!notFound(error)) throw error;
    throw new Error(ensured.created
      ? 'New Clockoli user branch was published without ownership metadata'
      : 'Existing Clockoli user branch is missing ownership metadata');
  }
  return { branch, github: branchGithub };
}

export async function discoverUserStorageBranches(github, { signal, concurrency = 6 } = {}) {
  const branches = await github.listBranches(USER_BRANCH_PREFIX, { signal });
  const limit = Math.min(12, Math.max(1, Number(concurrency) || 6));
  const users = [];
  for (let offset = 0; offset < branches.length; offset += limit) {
    signal?.throwIfAborted();
    const controller = new AbortController();
    const abortFromParent = () => controller.abort(signal.reason);
    signal?.addEventListener('abort', abortFromParent, { once: true });
    let firstError = null;
    const settled = await Promise.allSettled(branches.slice(offset, offset + limit).map(async branch => {
      const branchGithub = github.forBranch(branch, 'custom');
      try {
        const file = await readUserMetadata(branchGithub, { signal: controller.signal });
        const user = parseUserBranchMetadata(file.text);
        if (branch !== userStorageBranch(user.id)) throw new Error('Clockoli user branch name does not match its stable GitHub identity');
        return { ...user, branch, github: branchGithub };
      } catch (error) {
        if (!notFound(error)) throw error;
        // Ignore branch names from pre-release experiments that do not carry the
        // fail-closed Clockoli ownership marker.
        return null;
      }
    }).map(promise => promise.catch(error => {
      if (!firstError) {
        firstError = error;
        controller.abort(error);
      }
      throw error;
    })));
    signal?.removeEventListener('abort', abortFromParent);
    if (firstError) throw firstError;
    const chunk = settled.map(result => result.value);
    for (const user of chunk.filter(Boolean)) {
      if (users.some(item => item.id === user.id || item.login.toLowerCase() === user.login.toLowerCase())) throw new Error('Clockoli user branch metadata is duplicated');
      users.push(user);
    }
  }
  return users.sort((a, b) => a.id - b.id);
}

export { USER_BRANCH_PREFIX, USER_METADATA_PATH };
