import test from 'node:test';
import assert from 'node:assert/strict';
import { onboardingStep, parseRepositoryTarget, selectOnlyEligibleRepository, settleBeforeDeadline } from '../src/options/onboarding-flow.js';

test('repository targets accept only validated GitHub repository coordinates', () => {
  for (const input of ['acme/time-data', 'https://github.com/acme/time-data', 'https://github.com/acme/time-data/']) {
    assert.equal(parseRepositoryTarget(input), 'acme/time-data');
  }
  assert.equal(parseRepositoryTarget('Acme/Time-Data.git'), 'Acme/Time-Data.git', 'preserve repository spelling, including literal suffixes');
  for (const input of ['', 'https://github.com.evil.example/acme/time-data', 'http://github.com/acme/time-data',
    'https://github.com/acme/time-data/issues/1', 'https://github.com/acme/time-data?x=1',
    'https://github.com/acme/time-data#readme', 'https://user:password@github.com/acme/time-data',
    'acme/../time-data', 'https://github.com/acme/%2e%2e', '//github.com/acme/time-data']) {
    assert.throws(() => parseRepositoryTarget(input), undefined, input);
  }
});

test('progressive onboarding exposes only the next incomplete step', () => {
  assert.equal(onboardingStep({ authorized: false }), 1);
  assert.equal(onboardingStep({ authorized: false, deviceAttempt: true }), 1);
  assert.equal(onboardingStep({ authorized: true, repositoryAccessDetected: false, repositories: [] }), 2);
  assert.equal(onboardingStep({ authorized: true, repositoryAccessDetected: false, repositories: [{ repoId: 8, eligible: true }] }), 2);
  assert.equal(onboardingStep({ authorized: true, repositoryAccessDetected: true, repositories: [{ repoId: 8, eligible: false }] }), 2);
  assert.equal(onboardingStep({ authorized: true, repositories: [{ repoId: 7, eligible: true }] }), 2);
});

test('one eligible repository is selected automatically but multiple choices remain explicit', () => {
  const eligible = { installationId: 8, repoId: 7, eligible: true };
  const unavailable = { installationId: 8, repoId: 9, eligible: false };
  assert.equal(selectOnlyEligibleRepository([unavailable, eligible]), eligible);
  assert.equal(selectOnlyEligibleRepository([eligible, { ...eligible, repoId: 10 }]), null);
  assert.equal(selectOnlyEligibleRepository([unavailable]), null);
});


test('repository discovery deadline rejects a permanently pending request', async () => {
  const pending = new Promise(() => {});
  await assert.rejects(
    () => settleBeforeDeadline(pending, 5, () => Object.assign(new Error('monitor timed out'), { code: 'repository_monitor_timeout' })),
    error => error.code === 'repository_monitor_timeout',
  );
});
