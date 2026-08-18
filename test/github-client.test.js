import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubClient, GitHubConflictError, GitHubNotFoundError, GitHubValidationError } from '../src/api/github-client.js';

function response(status, body = null) {
  return { ok: status >= 200 && status < 300, status, headers: new Headers(), json: async () => body };
}

test('GitHub client encodes unicode JSON and uses SHA for update/delete', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (!options.method) return response(200, { type: 'file', sha: 'oldsha', content: btoa(unescape(encodeURIComponent('{"description":"✓"}'))) });
    return response(200, { content: { sha: 'newsha' }, commit: { sha: 'commitsha' } });
  };
  const client = new GitHubClient({ token: 'secret', owner: 'acme', repo: 'time-data', branch: 'main', fetchImpl });
  const file = await client.getFile('active/alice.json');
  assert.equal(file.data.description, '✓');
  await client.putJson('active/alice.json', { description: 'Привет' }, 'update', 'oldsha');
  await client.deleteFile('active/alice.json', 'delete', 'newsha');
  assert.equal(JSON.parse(calls[1].options.body).sha, 'oldsha');
  assert.equal(JSON.parse(calls[2].options.body).sha, 'newsha');
  assert.equal(client.token, 'secret');
});

test('GitHub client classifies not found and conflicts without exposing credentials', async () => {
  const missing = new GitHubClient({ token: 'do-not-leak', owner: 'a', repo: 'b', fetchImpl: async () => response(404, { message: 'Not Found' }) });
  await assert.rejects(() => missing.getFile('x.json'), error => error instanceof GitHubNotFoundError && !error.message.includes('do-not-leak'));
  const conflict = new GitHubClient({ token: 'x', owner: 'a', repo: 'b', fetchImpl: async () => response(409, { message: 'Conflict' }) });
  await assert.rejects(() => conflict.putJson('x.json', {}, 'm', 'stale'), GitHubConflictError);
});


test('setup rejects public repositories and 422 is validation, not a concurrency conflict', async () => {
  const publicRepo = new GitHubClient({ token: 'x', owner: 'a', repo: 'b', fetchImpl: async () => response(200, { private: false, permissions: { push: true } }) });
  await assert.rejects(() => publicRepo.validateRepository(), /private/i);
  const invalid = new GitHubClient({ token: 'x', owner: 'a', repo: 'b', fetchImpl: async () => response(422, { message: 'Invalid request' }) });
  await assert.rejects(() => invalid.putJson('x.json', {}, 'm'), GitHubValidationError);
  await assert.rejects(() => invalid.putJson('x.json', {}, 'm'), error => !(error instanceof GitHubConflictError));
});
