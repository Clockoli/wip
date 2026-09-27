import test from 'node:test';
import assert from 'node:assert/strict';
import { createClockifyGitHubResolver } from '../src/services/clockify-github-resolver.js';

function entry(overrides = {}) {
  return {
    provider: 'clockify', entryId: 'entry-1', userId: 'source-user-1',
    startedAt: '2026-09-01T08:00:00.000Z', endedAt: '2026-09-01T09:00:00.000Z', timezone: 'UTC', duration: 3600,
    projectId: 'project-1', project: 'clockoli', task: '#13 Create a migration plugin for Clockify',
    description: '', tags: [], billable: false,
    ...overrides,
  };
}

const repositories = [
  'manticoresoftware/manticoresearch',
  'manticoresoftware/clockoli',
];

const titleRanker = {
  version: 3,
  modelType: 'catboost-oblivious-trees',
  featureSchemaVersion: 3,
  features: ['issue_id_exact_match', 'repository_exact_match', 'title_token_jaccard', 'title_prefix_similarity', 'title_edit_similarity', 'pattern_type_code', 'repository_validation_frequency', 'user_repository_frequency'],
  bias: 0,
  trees: [{ splits: [{ featureIndex: 2, threshold: 0.1 }], leafValues: [-2, 2] }],
  training: { catBoostVersion: '1.2.8', datasetVersion: `sha256:${'a'.repeat(64)}` },
  evaluation: { heldOutPrecision: 1, heldOutRecall: 1, groups: 'source_file_sha256+user' },
};

function validatedCandidate() {
  return {
    provider: 'github', organization: 'manticoresoftware', repository: 'clockoli',
    entityType: 'issue', externalId: '13',
    title: 'Create a migration plugin for Clockify',
    externalUrl: 'https://github.com/manticoresoftware/clockoli/issues/13',
  };
}

test('auto-applies an exact allowlisted GitHub issue only after canonical validation', async () => {
  const calls = [];
  const resolver = createClockifyGitHubResolver({
    repositories,
    validate: async candidate => { calls.push(candidate); return validatedCandidate(); },
  });

  const result = await resolver.resolve(entry());

  assert.deepEqual(calls, [{ organization: 'manticoresoftware', repository: 'clockoli', number: 13, title: 'Create a migration plugin for Clockify' }]);
  assert.deepEqual(result, {
    status: 'auto_applied',
    resolution: {
      ...validatedCandidate(), confidence: 1, resolutionMethod: 'deterministic',
      evidence: [
        { type: 'issue_number_exact', value: '13' },
        { type: 'repository_exact', value: 'manticoresoftware/clockoli' },
        { type: 'github_validation', value: 'canonical_entity' },
      ],
    },
  });
});

test('does not generate or validate a repository outside the explicit allowlist', async () => {
  const resolver = createClockifyGitHubResolver({
    repositories,
    validate: async () => { throw new Error('must not validate'); },
  });

  assert.deepEqual(await resolver.resolve(entry({ project: 'unapproved-repository' })), {
    status: 'unresolved',
    resolution: {
      provider: 'unknown', confidence: 0, resolutionMethod: 'unresolved',
      evidence: [{ type: 'issue_number_exact', value: '13' }],
    },
  });
});

test('keeps number-only and title-only matches unresolved instead of guessing a GitHub target', async () => {
  const resolver = createClockifyGitHubResolver({
    repositories,
    validate: async () => { throw new Error('must not validate'); },
  });

  assert.deepEqual(await resolver.resolve(entry({ project: '', task: '#13 Create a migration plugin for Clockify' })), {
    status: 'unresolved',
    resolution: { provider: 'unknown', confidence: 0, resolutionMethod: 'unresolved', evidence: [{ type: 'issue_number_exact', value: '13' }] },
  });
  assert.deepEqual(await resolver.resolve(entry({ project: '', task: '', description: 'Correspondence and analyzing results' })), {
    status: 'unresolved',
    resolution: { provider: 'unknown', confidence: 0, resolutionMethod: 'unresolved', evidence: [] },
  });
});

test('does not auto-apply when GitHub validation is absent or disagrees with the candidate', async () => {
  const resolver = createClockifyGitHubResolver({
    repositories,
    validate: async () => ({ ...validatedCandidate(), externalId: '14' }),
  });

  assert.deepEqual(await resolver.resolve(entry()), {
    status: 'unresolved',
    resolution: {
      provider: 'unknown', confidence: 0, resolutionMethod: 'unresolved',
      evidence: [
        { type: 'issue_number_exact', value: '13' },
        { type: 'repository_exact', value: 'manticoresoftware/clockoli' },
      ],
    },
  });
});

test('ranks bounded canonical GitHub candidates into a preview-only URL suggestion', async () => {
  const discovered = [];
  const validated = [];
  const resolver = createClockifyGitHubResolver({
    repositories,
    modelArtifact: titleRanker,
    discover: async request => {
      discovered.push(request);
      return [
        { ...validatedCandidate(), externalId: '12', title: 'Update the release notes', externalUrl: 'https://github.com/manticoresoftware/clockoli/issues/12' },
        validatedCandidate(),
      ];
    },
    validate: async candidate => { validated.push(candidate); return validatedCandidate(); },
  });

  const result = await resolver.resolve(entry({ task: 'Create a migration plugin for Clockify', description: '', tags: [] }));

  assert.deepEqual(discovered, [{
    repositories: [{ organization: 'manticoresoftware', repository: 'clockoli', fullName: 'manticoresoftware/clockoli', key: 'manticoresoftware/clockoli' }],
    query: 'Create a migration plugin for Clockify', limit: 20,
  }]);
  assert.deepEqual(validated, [{ organization: 'manticoresoftware', repository: 'clockoli', number: 13, title: 'Create a migration plugin for Clockify' }]);
  assert.deepEqual(result, {
    status: 'suggestion',
    resolution: {
      ...validatedCandidate(), confidence: 0.8807970779778823, resolutionMethod: 'catboost_suggestion',
      evidence: [
        { type: 'repository_exact', value: 'manticoresoftware/clockoli' },
        { type: 'github_candidate_discovery', value: '2' },
        { type: 'github_validation', value: 'canonical_entity' },
      ],
    },
  });
});
