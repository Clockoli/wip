import { parseMarker } from './github-app-onboarding.js';
import { parseUserBranchMetadata, userStorageBranch, USER_METADATA_PATH } from './user-storage-branch.js';
import { parseTaskIndex, TASK_INDEX_PATH } from '../domain/task-index.js';

// Advisory UI status only. Missing or unverifiable storage is never reported as ready.
export async function readyRepositoryMemberIds(github, defaultBranch, users) {
  if (!defaultBranch || !Array.isArray(users) || !users.length) return [];
  try {
    const marker = parseMarker((await github.forBranch(defaultBranch, 'default').getText('.clockoli/config.json')).text);
    const branches = new Set(await github.listBranches('clockoli/users/'));
    const candidates = users.filter(user => Number.isSafeInteger(user.id) && user.id > 0
      && typeof user.login === 'string'
      && marker.users[String(user.id)]?.toLowerCase() === user.login.toLowerCase()
      && branches.has(userStorageBranch(user.id)));
    const checks = await Promise.all(candidates.map(async user => {
      try {
        const personal = github.forBranch(userStorageBranch(user.id), 'custom');
        const metadata = parseUserBranchMetadata((await personal.getText(USER_METADATA_PATH)).text);
        if (metadata.id !== user.id || metadata.login.toLowerCase() !== user.login.toLowerCase()) return null;
        parseTaskIndex((await personal.getText(TASK_INDEX_PATH)).text, { user: metadata.login });
        return user.id;
      } catch { return null; }
    }));
    return checks.filter(id => id !== null);
  } catch { return []; }
}
