import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GITHUB_APP_CLIENT_ID,
  GITHUB_APP_SLUG,
  githubAppInstallationUrl,
} from '../src/config/github-app.js';

test('release build contains the public organization-owned RepoClock GitHub App identity', () => {
  assert.equal(GITHUB_APP_CLIENT_ID, 'Iv23likdAVTSplt9U2oW');
  assert.equal(GITHUB_APP_SLUG, 'repoclock');
  assert.equal(githubAppInstallationUrl(), 'https://github.com/apps/repoclock/installations/new');
});
