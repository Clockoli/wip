import { validateClockifyUserMapping } from '../addons/clockify/user-mapping.js';
import { validateBranch } from '../domain/values.js';
import { ensureUserStorageBranch, userStorageBranch } from './user-storage-branch.js';

const FAILURE_MESSAGE = 'Could not prepare this user\'s Clockoli storage branch.';

function failureReason(error) {
  if (error?.code === 'github_rate_limited' || error?.status === 429) return 'github_rate_limited';
  if (error?.status === 401) return 'github_authentication';
  if (error?.status === 403) return 'github_permission';
  if (error?.status === 404) return 'repository_or_branch_not_found';
  if (error?.status === 409) return 'github_conflict';
  if (error?.status === 422) return 'github_validation';
  return 'storage_branch_unavailable';
}

function failureOutcome(mapping, error) {
  return {
    sourceUserId: mapping.sourceUserId,
    githubUser: mapping.githubUser,
    status: 'failed',
    error: { message: FAILURE_MESSAGE, reason: failureReason(error) },
  };
}

/**
 * Provision a deterministic, isolated Clockoli storage branch for every
 * confirmed Clockify-to-GitHub mapping. Results deliberately retain individual
 * failures because remote branch creation cannot be made atomic across users.
 */
export async function provisionClockifyUserBranches({
  sourceUsers,
  mappings,
  github,
  sourceBranch,
  provisioner = ensureUserStorageBranch,
  onProgress,
} = {}) {
  const verifiedMappings = validateClockifyUserMapping(sourceUsers, mappings);
  const validSourceBranch = validateBranch(sourceBranch);
  const outcomes = [];

  // Intentionally sequential: each remote outcome is visible and later users
  // are attempted even when an earlier branch cannot be prepared.
  for (const mapping of verifiedMappings) {
    try {
      const result = await provisioner(github, mapping.githubUser, validSourceBranch);
      const branch = result?.branch;
      if (branch !== userStorageBranch(mapping.githubUser.id)) throw new Error('Unexpected user storage branch');
      outcomes.push({
        sourceUserId: mapping.sourceUserId,
        githubUser: mapping.githubUser,
        status: 'provisioned',
        branch,
      });
    } catch (error) {
      outcomes.push(failureOutcome(mapping, error));
    }
    if (typeof onProgress === 'function') {
      try { onProgress({ completed: outcomes.length, total: verifiedMappings.length }); } catch { /* observers cannot interrupt writes */ }
    }
  }

  return outcomes;
}
