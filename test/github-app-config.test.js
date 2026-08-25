import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GITHUB_APP_CLIENT_ID,
  GITHUB_APP_SLUG,
  githubAppInstallationUrl,
  GITHUB_NEW_REPOSITORY_URL,
} from '../src/config/github-app.js';

test('release build contains the public organization-owned Clockoli GitHub App identity', () => {
  assert.equal(GITHUB_APP_CLIENT_ID, 'Iv23likdAVTSplt9U2oW');
  assert.equal(GITHUB_APP_SLUG, 'clockoli');
  assert.equal(githubAppInstallationUrl(), 'https://github.com/apps/clockoli/installations/new');
});


test('new data repository handoff is prefilled without expanding App permissions', () => {
  const url = new URL(GITHUB_NEW_REPOSITORY_URL);
  assert.equal(url.origin, 'https://github.com');
  assert.equal(url.pathname, '/new');
  assert.equal(url.searchParams.get('name'), 'clockoli-data');
  assert.equal(url.searchParams.get('visibility'), 'private');
  assert.equal(url.searchParams.get('owner'), '@me');
  assert.equal(url.searchParams.get('template_owner'), 'Clockoli');
  assert.equal(url.searchParams.get('template_name'), 'data-template');
  assert.match(url.searchParams.get('description') || '', /Clockoli/i);
});
