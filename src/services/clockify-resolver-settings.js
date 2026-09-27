const WORKSPACE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPOSITORY = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
const MAX_POLICIES = 20;
const MAX_REPOSITORIES = 30;

function canonicalRepository(value) {
  const fullName = typeof value === 'string'
    ? value.trim()
    : value && typeof value === 'object' && typeof value.organization === 'string' && typeof value.repository === 'string'
      ? `${value.organization}/${value.repository}`
      : '';
  const match = fullName.match(/^([^/]+)\/([^/]+)$/);
  if (!match || !OWNER.test(match[1]) || !REPOSITORY.test(match[2])) throw new Error('Resolver repository must be a valid GitHub owner/repository');
  return { organization: match[1].toLowerCase(), repository: match[2].toLowerCase() };
}

export function normalizeClockifyResolverPolicies(value) {
  if (!Array.isArray(value) || value.length > MAX_POLICIES) throw new Error('Resolver policies must be a bounded list');
  const workspaceIds = new Set();
  return value.map(policy => {
    if (!policy || typeof policy !== 'object' || !WORKSPACE_ID.test(policy.workspaceId || '')) throw new Error('Resolver policy must name a Clockify workspace ID');
    if (workspaceIds.has(policy.workspaceId)) throw new Error('Resolver policy workspace IDs must be unique');
    workspaceIds.add(policy.workspaceId);
    if (!Array.isArray(policy.repositories) || !policy.repositories.length || policy.repositories.length > MAX_REPOSITORIES) throw new Error('Resolver policy must include a bounded GitHub repository allowlist');
    const repositories = [...new Map(policy.repositories.map(repository => {
      const canonical = canonicalRepository(repository);
      return [`${canonical.organization}/${canonical.repository}`, canonical];
    })).values()].sort((left, right) => (
      `${left.organization}/${left.repository}`.localeCompare(`${right.organization}/${right.repository}`)
    ));
    return { workspaceId: policy.workspaceId, repositories };
  }).sort((left, right) => left.workspaceId.localeCompare(right.workspaceId));
}

export function resolverPolicyForWorkspace(policies, workspaceId) {
  if (typeof workspaceId !== 'string') return null;
  return normalizeClockifyResolverPolicies(policies).find(policy => policy.workspaceId === workspaceId) || null;
}
