const USER_BRANCH_PREFIX = 'repoclock/users/';
const USER_METADATA_PATH = '.repoclock/user.json';
const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

function notFound(error) { return error?.status === 404 || error?.code === 'not_found'; }
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
  const ensured = await github.ensureBranch(branch, sourceBranch);
  const branchGithub = github.forBranch(branch, 'custom');
  const expected = userBranchMetadataText(user);
  try {
    const file = await branchGithub.getText(USER_METADATA_PATH);
    const actual = parseUserBranchMetadata(file.text);
    if (actual.id !== user.id || actual.login.toLowerCase() !== user.login.toLowerCase()) {
      throw new Error('Clockoli user branch belongs to a different GitHub account');
    }
  } catch (error) {
    if (!notFound(error)) throw error;
    if (!ensured.created) throw new Error('Existing Clockoli user branch is missing ownership metadata');
    await branchGithub.putText(USER_METADATA_PATH, expected, 'Initialize Clockoli user storage branch');
  }
  return { branch, github: branchGithub };
}

export async function discoverUserStorageBranches(github, { signal } = {}) {
  const branches = await github.listBranches(USER_BRANCH_PREFIX, { signal });
  const users = [];
  for (const branch of branches) {
    signal?.throwIfAborted();
    const branchGithub = github.forBranch(branch, 'custom');
    try {
      const file = await branchGithub.getText(USER_METADATA_PATH, { signal });
      const user = parseUserBranchMetadata(file.text);
      if (branch !== userStorageBranch(user.id)) throw new Error('Clockoli user branch name does not match its stable GitHub identity');
      if (users.some(item => item.id === user.id || item.login.toLowerCase() === user.login.toLowerCase())) throw new Error('Clockoli user branch metadata is duplicated');
      users.push({ ...user, branch, github: branchGithub });
    } catch (error) {
      if (!notFound(error)) throw error;
      // Ignore branch names from pre-release experiments that do not carry the
      // fail-closed Clockoli ownership marker.
    }
  }
  return users.sort((a, b) => a.id - b.id);
}

export { USER_BRANCH_PREFIX, USER_METADATA_PATH };
