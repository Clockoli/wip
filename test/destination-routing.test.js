import assert from 'node:assert/strict';
import test from 'node:test';
import {
  destinationIdForRepoId,
  normalizeDefaultDestinationId,
  normalizeDestinationReferences,
  normalizeDestinationRegistry,
  normalizeProjectDefinitions,
  parseSettingsImport,
  resolveDestinationIdForUrl,
  settingsExportText,
} from '../src/domain/local-settings.js';

const destinations = {
  'github:42': { repoId: 42, owner: 'acme', repo: 'team-time', branch: 'clockoli/users/7' },
  'github:99': { repoId: 99, owner: 'alice', repo: 'personal-time', branch: 'clockoli/users/7' },
};

const projects = [
  { id: 'acme-special', name: 'Acme special', substrings: ['github.com/acme/special/'], destinationId: 'github:99' },
  { id: 'acme', name: 'Acme', substrings: ['github.com/acme/'], destinationId: 'github:42' },
];

test('destination IDs are derived only from positive stable GitHub repository IDs', () => {
  assert.equal(destinationIdForRepoId(42), 'github:42');
  for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '42', null]) {
    assert.throws(() => destinationIdForRepoId(value), /repository ID.*positive/i);
  }
  assert.throws(() => normalizeDestinationRegistry({
    'github:0042': { repoId: 42, owner: 'acme', repo: 'time', branch: 'main' },
  }), /destination ID/i);
  assert.throws(() => normalizeDestinationRegistry({
    'github:43': { repoId: 42, owner: 'acme', repo: 'time', branch: 'main' },
  }), /destination ID/i);
});

test('destination registry and default destination references normalize strictly', () => {
  assert.deepEqual(normalizeDestinationRegistry(destinations), destinations);
  assert.equal(normalizeDefaultDestinationId('github:42', destinations), 'github:42');
  assert.equal(normalizeDefaultDestinationId(null, {}), null);
  assert.throws(() => normalizeDefaultDestinationId('github:404', destinations), /default destination/i);
  assert.throws(() => normalizeDefaultDestinationId(null, destinations), /default destination/i);
  assert.throws(() => normalizeDestinationRegistry({
    'github:42': { ...destinations['github:42'], token: 'secret' },
  }), /unexpected/i);
});

test('runtime destinations retain operational fields while export references stay credential-free', () => {
  const runtime = {
    'github:42': {
      ...destinations['github:42'], ownerType: 'Organization', defaultBranch: 'main', branchMode: 'custom',
      storageBranchVersion: 1, installationId: 88, visibility: 'private', repositoryFormatVersion: 1,
      storageLogin: 'alice', authMode: 'github_app',
    },
  };
  assert.deepEqual(normalizeDestinationRegistry(runtime), runtime);
  assert.deepEqual(normalizeDestinationReferences(runtime), { 'github:42': destinations['github:42'] });
  assert.throws(() => normalizeDestinationRegistry({
    'github:42': { ...runtime['github:42'], token: 'secret' },
  }), /unexpected/i);
});

test('project definitions require stable unique IDs and names and valid destinations', () => {
  assert.deepEqual(normalizeProjectDefinitions(projects, destinations), projects);
  assert.throws(() => normalizeProjectDefinitions([
    projects[0], { ...projects[1], id: projects[0].id },
  ], destinations), /duplicate project ID/i);
  assert.throws(() => normalizeProjectDefinitions([
    projects[0], { ...projects[1], name: projects[0].name.toUpperCase() },
  ], destinations), /duplicate project name/i);
  assert.throws(() => normalizeProjectDefinitions([
    { ...projects[0], id: 'not valid' },
  ], destinations), /project ID/i);
  assert.throws(() => normalizeProjectDefinitions([
    { ...projects[0], destinationId: 'github:404' },
  ], destinations), /destination/i);
});

test('URL routing is ordered first-match and falls back to the default destination', () => {
  const normalized = normalizeProjectDefinitions(projects, destinations);
  assert.equal(resolveDestinationIdForUrl('https://github.com/acme/special/issues/1', normalized, 'github:42'), 'github:99');
  assert.equal(resolveDestinationIdForUrl('https://github.com/acme/elsewhere/issues/2', normalized, 'github:99'), 'github:42');
  assert.equal(resolveDestinationIdForUrl('https://example.test/task', normalized, 'github:99'), 'github:99');
});

test('settings v5 retains its legacy shape and exposes additive unverified routing references', () => {
  const legacy = {
    format: 'clockoli-settings', version: 5, exportedAt: '2026-08-22T12:00:00.000Z',
    display: { recentDays: 9, otherProjectName: 'General', showQueueDiagnostics: true },
    projects: [{ name: 'Work', substrings: ['github.com/acme/'] }],
    billing: { rates: {} },
    repository: { repoId: 42, owner: 'acme', repo: 'team-time', branch: 'clockoli/users/7' },
    security: { credentialsIncluded: false },
  };
  const imported = parseSettingsImport(JSON.stringify(legacy));
  assert.deepEqual(imported, {
    recentDays: 9,
    projects: [{ name: 'Work', substrings: ['github.com/acme/'] }],
    otherProjectName: 'General',
    showQueueDiagnostics: true,
    billing: { rates: {}, invoicing: { seller: { name: '', address: '', email: '', taxId: '' }, clients: [], nextNumber: 1, numberFormat: 'INV-{YYYY}-{NNNN}', paymentTermsDays: 30, taxPercent: 0, notes: '' } },
  });
  assert.deepEqual(imported.repository, legacy.repository);
  assert.deepEqual(imported.destinations, { 'github:42': destinations['github:42'] });
  assert.equal(imported.defaultDestinationId, 'github:42');
  assert.deepEqual(imported.projectDefinitions, [
    { id: 'legacy-project-1', name: 'Work', substrings: ['github.com/acme/'], destinationId: 'github:42' },
  ]);
  assert.equal(imported.repositoryReferencesVerified, false);
});

test('settings v6 exports exact credential-free routing fields and parses references as unverified data', () => {
  const runtimeDestinations = {
    ...destinations,
    'github:42': { ...destinations['github:42'], installationId: 88, defaultBranch: 'main', storageLogin: 'alice' },
  };
  const text = settingsExportText({
    config: { recentDays: 9 }, destinations: runtimeDestinations, defaultDestinationId: 'github:42', projects,
    billing: { rates: {} }, otherProjectName: 'General', showQueueDiagnostics: true,
    exportedAt: '2026-08-22T12:00:00.000Z',
  });
  const saved = JSON.parse(text);
  assert.deepEqual(Object.keys(saved).sort(), [
    'billing', 'defaultDestinationId', 'destinations', 'display', 'exportedAt', 'format', 'projects', 'security', 'version',
  ]);
  assert.equal(saved.version, 6);
  assert.deepEqual(saved.destinations, destinations);
  assert.equal(saved.defaultDestinationId, 'github:42');
  assert.deepEqual(saved.projects, projects);
  assert.deepEqual(saved.security, { credentialsIncluded: false });
  assert.doesNotMatch(text, /token|password|authorization|installationId/i);
  assert.deepEqual(parseSettingsImport(text), {
    recentDays: 9, projects, otherProjectName: 'General', otherProjectClient: '', reportingUtc: false, showQueueDiagnostics: true,
    billing: { rates: {} }, destinations, defaultDestinationId: 'github:42',
    repositoryReferencesVerified: false,
  });

  const withCredential = { ...saved, destinations: {
    ...saved.destinations,
    'github:42': { ...saved.destinations['github:42'], token: 'must-not-be-accepted' },
  } };
  assert.throws(() => parseSettingsImport(JSON.stringify(withCredential)), /unexpected/i);
  assert.throws(() => parseSettingsImport(JSON.stringify({
    ...saved,
    destinations: { ...saved.destinations, 'github:42': { ...saved.destinations['github:42'], installationId: 88 } },
  })), /unexpected/i);
  assert.throws(() => parseSettingsImport(JSON.stringify({ ...saved, defaultDestinationId: 'github:404' })), /default destination/i);
});
