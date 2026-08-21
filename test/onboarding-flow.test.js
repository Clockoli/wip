import test from 'node:test';
import assert from 'node:assert/strict';
import { onboardingStep, selectOnlyEligibleRepository, settleBeforeDeadline } from '../src/options/onboarding-flow.js';

test('progressive onboarding exposes only the next incomplete step', () => {
  assert.equal(onboardingStep({ authorized: false, discoveryStatus: 'idle', repositories: [] }), 1);
  assert.equal(onboardingStep({ authorized: false, deviceAttempt: true, discoveryStatus: 'idle', repositories: [] }), 1);
  assert.equal(onboardingStep({ authorized: true, repositoryChoiceMade: false, discoveryStatus: 'idle', repositories: [] }), 2);
  assert.equal(onboardingStep({ authorized: true, repositoryChoiceMade: false, discoveryStatus: 'ready', repositories: [] }), 2);
  assert.equal(onboardingStep({ authorized: true, repositoryChoiceMade: true, discoveryStatus: 'idle', repositories: [] }), 3);
  assert.equal(onboardingStep({ authorized: true, repositoryChoiceMade: true, discoveryStatus: 'ready', repositories: [] }), 3);
  assert.equal(onboardingStep({ authorized: true, discoveryStatus: 'ready', repositories: [{ repoId: 6, eligible: false, reasons: ['private_required'] }] }), 3);
  assert.equal(onboardingStep({ authorized: true, discoveryStatus: 'ready', repositories: [{ repoId: 7, eligible: true }] }), 3);
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
