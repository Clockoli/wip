import assert from 'node:assert/strict';
import test from 'node:test';
import {
  billableMinorForRecord, billableMinorTotal, normalizeBillingSettings, parseSettingsImport,
  rateMajorToMinor, rateMinorToMajor, settingsExportText,
} from '../src/domain/local-settings.js';

test('billable settings normalize stable GitHub logins and integer minor-unit rates', () => {
  assert.deepEqual(normalizeBillingSettings({ currency: 'usd', rates: { bob: 1250, Alice: 10000 } }), {
    currency: 'USD', rates: { Alice: 10000, bob: 1250 },
  });
  assert.equal(rateMajorToMinor('125.50'), 12550);
  assert.equal(rateMinorToMajor(12550), '125.50');
  assert.throws(() => rateMajorToMinor('1.234'), /decimal places/);
  assert.throws(() => normalizeBillingSettings({ rates: { 'bad/login': 10 } }), /login/);
  assert.throws(() => normalizeBillingSettings({ rates: { Alice: 10, alice: 20 } }), /Duplicate/);
});

test('billable totals multiply each user rate by tracked time without rounding records early', () => {
  const records = [
    { user: 'alice', durationSeconds: 1800 },
    { user: 'alice', durationSeconds: 900 },
    { user: 'bob', durationSeconds: 3600 },
    { user: 'unknown', durationSeconds: 3600 },
  ];
  assert.equal(billableMinorForRecord(records[0], { alice: 10000 }), 5000);
  assert.equal(billableMinorTotal(records, { Alice: 10000, BOB: 2500 }), 10000);
});

test('plain-text settings export excludes credentials and imports display plus billing', () => {
  const text = settingsExportText({
    config: { owner: 'acme', repo: 'time-data', branch: 'repoclock/users/1', repoId: 42, recentDays: 9 },
    billing: { currency: 'EUR', rates: { alice: 12345 } },
    exportedAt: '2026-08-22T12:00:00.000Z',
  });
  const value = JSON.parse(text);
  assert.deepEqual(value.repository, { owner: 'acme', repo: 'time-data', branch: 'repoclock/users/1', repoId: 42 });
  assert.equal(JSON.parse(settingsExportText({ config: { recentDays: 7 } })).repository, null);
  assert.deepEqual(value.security, { credentialsIncluded: false });
  assert.doesNotMatch(text, /accessToken|refreshToken|personal access token/i);
  assert.deepEqual(parseSettingsImport(text), { recentDays: 9, billing: { currency: 'EUR', rates: { alice: 12345 } } });
  assert.throws(() => parseSettingsImport('{'), /valid JSON/);
  assert.throws(() => parseSettingsImport(JSON.stringify({ ...value, accessToken: 'must-not-be-accepted' })), /unexpected fields/);
  assert.throws(() => parseSettingsImport(JSON.stringify({ ...value, security: { credentialsIncluded: true } })), /credentials/);

});
