import test from 'node:test';
import assert from 'node:assert/strict';
import { onboardingStep, selectOnlyEligibleRepository, settleBeforeDeadline } from '../src/options/onboarding-flow.js';

test('progressive onboarding exposes only the next incomplete step', () => {
  assert.equal(onboardingStep({ authorized: false }), 1);
  assert.equal(onboardingStep({ authorized: false, deviceAttempt: true }), 1);
  assert.equal(onboardingStep({ authorized: true, repositoryAccessDetected: false, repositories: [] }), 2);
  assert.equal(onboardingStep({ authorized: true, repositoryAccessDetected: false, repositories: [{ repoId: 8, eligible: true }] }), 2);
  assert.equal(onboardingStep({ authorized: true, repositoryAccessDetected: true, repositories: [{ repoId: 8, eligible: false }] }), 3);
  assert.equal(onboardingStep({ authorized: true, repositories: [{ repoId: 7, eligible: true }] }), 3);
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
