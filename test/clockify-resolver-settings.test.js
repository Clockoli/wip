import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeClockifyResolverPolicies, resolverPolicyForWorkspace } from '../src/services/clockify-resolver-settings.js';

test('resolver policies are explicitly scoped to a Clockify workspace and contain only canonical GitHub repository allowlist entries', () => {
  const policies = normalizeClockifyResolverPolicies([
    {
      workspaceId: 'workspace-123',
      repositories: ['Manticoresoftware/Clockoli', 'manticoresoftware/manticoresearch', 'manticoresoftware/clockoli'],
    },
  ]);

  assert.deepEqual(policies, [{
    workspaceId: 'workspace-123',
    repositories: [
      { organization: 'manticoresoftware', repository: 'clockoli' },
      { organization: 'manticoresoftware', repository: 'manticoresearch' },
    ],
  }]);
  assert.deepEqual(resolverPolicyForWorkspace(policies, 'workspace-123').repositories, policies[0].repositories);
  assert.equal(resolverPolicyForWorkspace(policies, 'another-workspace'), null);
});

test('resolver policy validation rejects ambiguous workspace scoping and unsafe GitHub coordinates', () => {
  for (const policy of [
    { workspaceId: '', repositories: ['acme/app'] },
    { workspaceId: 'valid', repositories: [] },
    { workspaceId: 'valid', repositories: ['acme/app', 'bad/repo/path'] },
    [{ workspaceId: 'same', repositories: ['acme/app'] }, { workspaceId: 'same', repositories: ['acme/other'] }],
  ]) {
    assert.throws(() => normalizeClockifyResolverPolicies(Array.isArray(policy) ? policy : [policy]));
  }
});
