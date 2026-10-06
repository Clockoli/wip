import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubClient, createGitHubRateLimitGate } from '../src/api/github-client.js';
import { emitClockifyMigrationProgress } from '../src/background/clockify-migration-progress.js';
import { formatRateLimitWait, renderProgress } from '../src/clockify-migration/preview.js';

function response(status, headers = {}) {
  return { ok: status === 200, status, headers: new Headers(headers), json: async () => ({ ok: true }) };
}

test('migration GitHub clients wait for reset and retry the rejected operation', async () => {
  let now = Date.parse('2026-09-05T10:00:00Z');
  const calls = [], waits = [], progress = [];
  const gate = createGitHubRateLimitGate({ now: () => now, sleep: async ms => { waits.push(ms); now += ms; },
    onWait: retryAt => progress.push(retryAt) });
  const client = new GitHubClient({ token: 'test', owner: 'acme', repo: 'time', rateLimitGate: gate,
    now: () => new Date(now), fetchImpl: async (_url, options) => {
      calls.push([options.method || 'GET', now]);
      return calls.length === 1 ? response(429, { 'retry-after': '40' }) : response(200);
    } });
  assert.deepEqual(await client.request('/first'), { ok: true });
  assert.deepEqual(waits, [20_000, 20_000]);
  assert.deepEqual(progress, ['2026-09-05T10:00:40.000Z']);
  assert.deepEqual(calls.map(call => call[1]), [Date.parse('2026-09-05T10:00:00Z'), Date.parse('2026-09-05T10:00:40Z')]);
  assert.equal(client.forBranch('clockoli/users/42').rateLimitGate, gate);
});

test('migration rate-limit retry is bounded and normal clients still fail immediately', async () => {
  let attempts = 0, now = Date.parse('2026-09-05T10:00:00Z');
  const fetchImpl = async () => { attempts++; return response(429, { 'retry-after': '1' }); };
  const plain = new GitHubClient({ token: 'test', fetchImpl });
  await assert.rejects(plain.request('/user'), error => error.code === 'rate_limit');
  assert.equal(attempts, 1);
  const gate = createGitHubRateLimitGate({ now: () => now, sleep: async ms => { now += ms; } });
  const migration = new GitHubClient({ token: 'test', fetchImpl, now: () => new Date(now), rateLimitGate: gate });
  await assert.rejects(migration.request('/user'), error => error.code === 'rate_limit');
  assert.equal(attempts, 4, 'one initial request and at most two retry requests');
});

test('an atomic-write request is retried with its original method and body only after GitHub rejects it', async () => {
  let now = Date.parse('2026-09-05T10:00:00Z');
  const calls = [];
  const client = new GitHubClient({ token: 'test', owner: 'acme', repo: 'time', now: () => new Date(now),
    rateLimitGate: createGitHubRateLimitGate({ now: () => now, sleep: async ms => { now += ms; } }),
    fetchImpl: async (_url, options) => { calls.push([options.method, options.body, now]);
      return calls.length === 1 ? response(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String((now + 10_000) / 1000) }) : response(200);
    } });
  assert.deepEqual(await client.request('/repos/acme/time/git/refs/heads/main', { method: 'PATCH', body: '{"sha":"abc","force":false}' }), { ok: true });
  assert.deepEqual(calls, [
    ['PATCH', '{"sha":"abc","force":false}', Date.parse('2026-09-05T10:00:00Z')],
    ['PATCH', '{"sha":"abc","force":false}', Date.parse('2026-09-05T10:00:10Z')],
  ]);
});

test('migration gate delays another branch request while first is throttled', async () => {
  let now = Date.parse('2026-09-05T10:00:00Z'), release;
  const calls = [];
  const gate = createGitHubRateLimitGate({ now: () => now, sleep: ms => new Promise(resolve => { release = () => { now += ms; resolve(); }; }) });
  const client = new GitHubClient({ token: 'test', owner: 'acme', repo: 'time', now: () => new Date(now), rateLimitGate: gate,
    fetchImpl: async url => { calls.push(url); return calls.length === 1 ? response(429, { 'retry-after': '1' }) : response(200); } });
  const first = client.request('/first');
  while (!release) await new Promise(resolve => setImmediate(resolve));
  const second = client.forBranch('clockoli/users/42').request('/second');
  await Promise.resolve();
  assert.equal(calls.length, 1, 'no new GitHub request while the shared gate is closed');
  release();
  await Promise.all([first, second]);
  assert.equal(calls.length, 3);
});

test('retry deadline is recorded before waiting or sending another GitHub request', async () => {
  let now = Date.parse('2026-09-05T10:00:00Z'), release, calls = 0;
  const gate = createGitHubRateLimitGate({ now: () => now,
    onWait: () => new Promise(resolve => { release = resolve; }),
    sleep: async ms => { now += ms; } });
  const client = new GitHubClient({ token: 'test', now: () => new Date(now), rateLimitGate: gate,
    fetchImpl: async () => { calls++; return calls === 1 ? response(429, { 'retry-after': '30' }) : response(200); } });
  const request = client.request('/first');
  while (!release) await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1, 'a retry must not race ahead of its persisted deadline');
  release();
  await request;
  assert.equal(calls, 2);
});

test('a later concurrent throttle is durably recorded before the shared gate resumes', async () => {
  let now = Date.parse('2026-09-05T10:00:00Z'), release;
  const saved = [];
  const gate = createGitHubRateLimitGate({ now: () => now,
    sleep: ms => new Promise(resolve => { release = () => { release = null; now += ms; resolve(); }; }),
    onWait: async retryAt => { saved.push(retryAt); } });
  const first = gate.pause({ retryAt: new Date(now + 10_000).toISOString() });
  while (!release) await new Promise(resolve => setImmediate(resolve));
  // An already in-flight request may be rejected after the first throttle.
  const second = gate.pause({ retryAt: new Date(now + 30_000).toISOString() });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(saved, [new Date(now + 10_000).toISOString(), new Date(now + 30_000).toISOString()]);
  while (now < Date.parse(saved.at(-1))) {
    while (!release) await new Promise(resolve => setImmediate(resolve));
    release();
  }
  await Promise.all([first, second]);
});

test('a throttle arriving during onResume is saved after the older resume completes', async () => {
  let now = Date.parse('2026-09-05T10:00:00Z'), releaseResume, releaseSleep;
  const saved = [], gate = createGitHubRateLimitGate({ now: () => now,
    sleep: ms => ms === 1000 ? (now += ms, Promise.resolve())
      : new Promise(resolve => { releaseSleep = () => { now += ms; resolve(); }; }),
    onWait: async retryAt => { saved.push(retryAt); },
    onResume: async () => { saved.push(null); if (!releaseResume) await new Promise(resolve => { releaseResume = resolve; }); } });
  const first = gate.pause({ retryAt: new Date(now + 1000).toISOString() });
  while (!releaseResume) await new Promise(resolve => setImmediate(resolve));
  const later = new Date(now + 30_000).toISOString();
  const second = gate.pause({ retryAt: later });
  releaseResume();
  while (saved.at(-1) !== later) await new Promise(resolve => setImmediate(resolve));
  assert.equal(saved.at(-1), later, 'the old onResume must not leave the new deadline cleared');
  while (now < Date.parse(later)) {
    while (!releaseSleep) await new Promise(resolve => setImmediate(resolve));
    const release = releaseSleep; releaseSleep = null; release();
  }
  await Promise.all([first, second]);
});

test('exhausted retries persist their final deadline before reporting rate_limit without waiting for it', async () => {
  let now = Date.parse('2026-09-05T10:00:00Z'), attempts = 0, releaseSave;
  const saved = [];
  const gate = createGitHubRateLimitGate({ now: () => now,
    sleep: async ms => { now += ms; }, onWait: async retryAt => {
      if (saved.length === 2) await new Promise(resolve => { releaseSave = resolve; });
      saved.push(retryAt);
    } });
  const client = new GitHubClient({ token: 'test', rateLimitGate: gate, now: () => new Date(now),
    fetchImpl: async () => { attempts++; return response(429, { 'retry-after': '30' }); } });
  let settled = false;
  const request = assert.rejects(client.request('/user'), error => error.code === 'rate_limit' && error.retryAt === saved.at(-1))
    .finally(() => { settled = true; });
  while (!releaseSave) await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false, 'the final error cannot escape before its deadline is saved');
  releaseSave();
  await request;
  assert.equal(attempts, 3);
  assert.equal(saved.length, 3, 'the terminal rate-limit response must be durably recorded');
});

test('every request rechecks the pinned connection after a throttle wait before sending', async () => {
  let now = Date.parse('2026-09-05T10:00:00Z'), valid = true, calls = 0;
  const gate = createGitHubRateLimitGate({ now: () => now, sleep: async ms => { now += ms; valid = false; },
    onReady: () => { if (!valid) throw new Error('migration destination changed'); } });
  const client = new GitHubClient({ token: 'test', rateLimitGate: gate, now: () => new Date(now),
    fetchImpl: async () => { calls++; return response(429, { 'retry-after': '10' }); } });
  await assert.rejects(client.request('/path'), /destination changed/);
  assert.equal(calls, 1, 'no request may use an old snapshot after waiting');
});

test('preview-only progress forwards only a bounded retry deadline, not provider details', () => {
  const messages = [];
  const ports = new Map([['request', { postMessage: message => messages.push(message) }]]);
  const retryAt = new Date(Date.now() + 40_000).toISOString();
  emitClockifyMigrationProgress(ports, 'request', { stage: 'waiting_for_github', completed: 4, total: 8,
    retryAt, providerDetail: 'secret' });
  emitClockifyMigrationProgress(ports, 'request', { stage: 'waiting_for_github', completed: 4, total: 8,
    retryAt: 'javascript:alert(1)' });
  assert.deepEqual(messages, [{ type: 'CLOCKIFY_MIGRATION_PROGRESS', phase: 'waiting_for_github',
    completedUsers: 4, totalUsers: 8, retryAt }]);
});

test('wait text counts down to zero without displaying a made-up ETA', () => {
  const reset = '2026-09-05T10:00:40.000Z';
  assert.equal(formatRateLimitWait(reset, Date.parse('2026-09-05T10:00:00Z')), 'GitHub rate limit reached. Resuming automatically in 40 seconds.');
  assert.equal(formatRateLimitWait(reset, Date.parse('2026-09-05T10:00:40Z')), 'GitHub rate limit reset. Resuming migration…');
  assert.equal(formatRateLimitWait('bad', Date.now()), null);
});

test('migration preview shows a live wait and restores the previous progress stage on resume', async () => {
  const oldDocument = globalThis.document;
  const elements = new Map(['import-status', 'import-status-title', 'progress-current-step', 'progress-summary', 'import-progress']
    .map(id => [id, { hidden: true, textContent: '', value: 0 }]));
  globalThis.document = { getElementById: id => elements.get(id) };
  try {
    renderProgress({ phase: 'writing_records', completedUsers: 6, totalUsers: 8 });
    const priorValue = elements.get('import-progress').value;
    renderProgress({ phase: 'waiting_for_github', completedUsers: 6, totalUsers: 8,
      retryAt: new Date(Date.now() + 70_000).toISOString() });
    assert.equal(elements.get('import-status').hidden, false);
    assert.match(elements.get('progress-summary').textContent, /1 minute (?:9|10) seconds/);
    assert.equal(elements.get('import-progress').value, priorValue, 'a wait does not advance import steps');
    renderProgress({ phase: 'writing_records', completedUsers: 6, totalUsers: 8 });
    assert.match(elements.get('progress-current-step').textContent, /Writing completed records/);
  } finally {
    renderProgress({ phase: 'completed', completedUsers: 8, totalUsers: 8 });
    globalThis.document = oldDocument;
  }
});
