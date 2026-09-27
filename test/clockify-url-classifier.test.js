import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveClockifyUrlSuggestions } from '../src/services/clockify-url-classifier.js';

const model = {
  version: 2,
  modelType: 'multinomial-naive-bayes-url-classifier',
  textSchemaVersion: 1,
  organizations: ['manticoresoftware'],
  vocabularySize: 6,
  exactReferences: [
    { project: 'clockoli-issues', issueNumber: 13, url: 'https://github.com/manticoresoftware/clockoli-issues/issues/13' },
  ],
  classes: [
    {
      url: 'https://github.com/manticoresoftware/manticoresearch/issues/4851', documentCount: 4,
      tokenCounts: { optimize: 8, clt: 4, balancing: 4 },
    },
    {
      url: 'https://github.com/manticoresoftware/manticoresearch/issues/4826', documentCount: 1,
      tokenCounts: { release: 3, notes: 2 },
    },
  ],
  training: { datasetVersion: `sha256:${'a'.repeat(64)}`, exactReferences: 1, positiveSamples: 5, urlClasses: 2 },
};

const repositories = [
  { owner: 'manticoresoftware', repo: 'clockoli-issues' },
  { owner: 'manticoresoftware', repo: 'manticoresearch' },
];

function entry(overrides = {}) {
  return {
    provider: 'clockify', entryId: 'entry-1', userId: 'user-1', project: 'manticoresearch',
    task: '', description: 'Optimize CLT balancing', tags: [], ...overrides,
  };
}

test('suggests a catalog-scoped URL from the local classifier without a GitHub entity lookup', () => {
  const [result] = resolveClockifyUrlSuggestions({ entries: [entry()], repositories, modelArtifact: model });
  assert.deepEqual(result.resolvedIssue, {
    url: 'https://github.com/manticoresoftware/manticoresearch/issues/4851',
    title: 'Optimize CLT balancing',
  });
});

test('uses an exact model reference even when discovery omitted its repository', () => {
  const [result] = resolveClockifyUrlSuggestions({
    entries: [entry({ project: 'clockoli-issues', task: '#13 Create a migration plugin for Clockify', description: '' })],
    repositories, modelArtifact: model,
  });
  assert.equal(result.resolvedIssue.url, 'https://github.com/manticoresoftware/clockoli-issues/issues/13');

  const [missingFromCatalog] = resolveClockifyUrlSuggestions({
    entries: [entry({ project: 'clockoli-issues', task: '#13 Create a migration plugin for Clockify', description: '' })],
    repositories: [{ owner: 'manticoresoftware', repo: 'manticoresearch' }], modelArtifact: model,
  });
  assert.deepEqual(missingFromCatalog.resolvedIssue, {
    url: 'https://github.com/manticoresoftware/clockoli-issues/issues/13',
    title: '#13 Create a migration plugin for Clockify',
  });
});

test('memoizes identical resolver inputs within one read-only migration run', () => {
  const profiles = [];
  const results = resolveClockifyUrlSuggestions({
    entries: [entry({ entryId: 'entry-1' }), entry({ entryId: 'entry-2' })], repositories, modelArtifact: model,
    onProfile: profile => profiles.push(profile),
  });
  assert.equal(results[0].resolvedIssue.url, results[1].resolvedIssue.url);
  assert.deepEqual(profiles, [{ entryCount: 2, uniqueInputs: 1, cacheHits: 1 }]);
});

test('does not use Clockify tags as classifier input or cache identity', () => {
  const profiles = [];
  const results = resolveClockifyUrlSuggestions({
    entries: [
      entry({ entryId: 'entry-1', tags: ['release', 'notes'] }),
      entry({ entryId: 'entry-2', tags: ['unrelated', 'private-label'] }),
    ],
    repositories,
    modelArtifact: model,
    onProfile: profile => profiles.push(profile),
  });
  assert.equal(results[0].resolvedIssue.url, results[1].resolvedIssue.url);
  assert.deepEqual(profiles, [{ entryCount: 2, uniqueInputs: 1, cacheHits: 1 }]);
});
