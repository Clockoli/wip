import { createClockifyGitHubResolver } from './clockify-github-resolver.js';

function repositoriesForPolicy(policy) {
  if (!policy || typeof policy !== 'object' || !Array.isArray(policy.repositories)) return [];
  return policy.repositories.map(repository => `${repository?.organization || ''}/${repository?.repository || ''}`);
}

/**
 * Adds only deterministic, remotely validated GitHub task identity to the
 * credential-free migration handoff. Suggestions and raw resolver signals are
 * intentionally not persisted in the handoff.
 */
export async function resolveClockifyMigrationEntries({ entries, policy, validate, discover = null, modelArtifact = null, onResolution = null } = {}) {
  if (!Array.isArray(entries)) throw new TypeError('Clockify migration entries must be an array.');
  if (typeof validate !== 'function') throw new TypeError('Clockify resolver validation function is required.');
  if (onResolution !== null && typeof onResolution !== 'function') throw new TypeError('Clockify resolver observation function is invalid.');
  const resolver = createClockifyGitHubResolver({ repositories: repositoriesForPolicy(policy), validate, discover, modelArtifact });
  const result = [];
  for (const entry of entries) {
    const resolved = await resolver.resolve(entry);
    if (onResolution) onResolution({ entryId: entry?.entryId, status: resolved.status });
    result.push(resolved.status === 'auto_applied'
      ? { ...entry, resolvedIssue: { url: resolved.resolution.externalUrl, title: resolved.resolution.title } }
      : entry);
  }
  return result;
}
