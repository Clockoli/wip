import test from 'node:test';
import assert from 'node:assert/strict';
import { withRepositoryRecovery } from '../src/services/repository-operation-recovery.js';

function missing() { const error = new Error('missing'); error.status = 404; error.code = 'not_found'; return error; }

test('repository operation recovers one 404 and retries exactly once', async () => {
  let operations = 0, recoveries = 0;
  const result = await withRepositoryRecovery(async () => {
    operations += 1;
    if (operations === 1) throw missing();
    return 'ok';
  }, {
    shouldRecover: async () => true,
    recover: async () => { recoveries += 1; },
  });
  assert.equal(result, 'ok');
  assert.equal(operations, 2);
  assert.equal(recoveries, 1);
});

test('repository operation does not recover auth, permission, validation, or rate-limit failures', async () => {
  for (const error of [
    Object.assign(new Error('auth'), { status: 401, code: 'authentication_failed' }),
    Object.assign(new Error('permission'), { status: 403, code: 'permission_denied' }),
    Object.assign(new Error('validation'), { status: 422, code: 'validation' }),
    Object.assign(new Error('rate'), { status: 429, code: 'rate_limited' }),
  ]) {
    let recoveries = 0;
    await assert.rejects(() => withRepositoryRecovery(async () => { throw error; }, {
      shouldRecover: async () => true,
      recover: async () => { recoveries += 1; },
    }), value => value === error);
    assert.equal(recoveries, 0);
  }
});

test('repository operation propagates recovery failure and never loops after retry', async () => {
  let operations = 0;
  const recoveryError = Object.assign(new Error('grant access'), { code: 'repository_access_required' });
  await assert.rejects(() => withRepositoryRecovery(async () => { operations += 1; throw missing(); }, {
    shouldRecover: async () => true,
    recover: async () => { throw recoveryError; },
  }), value => value === recoveryError);
  assert.equal(operations, 1);

  operations = 0;
  let recoveries = 0;
  await assert.rejects(() => withRepositoryRecovery(async () => { operations += 1; throw missing(); }, {
    shouldRecover: async () => true,
    recover: async () => { recoveries += 1; },
  }), error => error.code === 'not_found');
  assert.equal(operations, 2);
  assert.equal(recoveries, 1);
});

test('repository operation honors the active-auth recovery predicate', async () => {
  let recoveries = 0;
  await assert.rejects(() => withRepositoryRecovery(async () => { throw missing(); }, {
    shouldRecover: async () => false,
    recover: async () => { recoveries += 1; },
  }), error => error.code === 'not_found');
  assert.equal(recoveries, 0);
});


test('repository operation does not retry when rediscovery finds unchanged coordinates', async () => {
  let operations = 0, recoveries = 0;
  await assert.rejects(() => withRepositoryRecovery(async () => { operations += 1; throw missing(); }, {
    shouldRecover: async () => true,
    recover: async () => { recoveries += 1; return false; },
  }), error => error.code === 'not_found');
  assert.equal(operations, 1);
  assert.equal(recoveries, 1);
});
