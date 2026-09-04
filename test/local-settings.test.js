import assert from 'node:assert/strict';
import test from 'node:test';
import {
  billableMinorForRecord, billableMinorTotal, normalizeBillingSettings, parseSettingsImport,
  normalizeProjects, projectNameForUrl, rateMajorToMinor, rateMinorToMajor, settingsExportText,
} from '../src/domain/local-settings.js';

test('projects normalize ordered names and URL substrings with a safe Other fallback', () => {
  const projects = normalizeProjects([
    { name: 'work', substrings: [' github.com/ManticoreSoftware/ ', 'github.com/clockoli/'] },
    { name: 'personal', substrings: ['example.com/personal/'] },
  ]);
  assert.deepEqual(projects, [
    { name: 'work', substrings: ['github.com/manticoresoftware/', 'github.com/clockoli/'] },
    { name: 'personal', substrings: ['example.com/personal/'] },
  ]);
  assert.equal(projectNameForUrl('https://github.com/Clockoli/clockoli/issues/1', projects), 'work');
  assert.equal(projectNameForUrl('https://example.com/PERSONAL/todo', projects), 'personal');
  assert.equal(projectNameForUrl('https://elsewhere.test/task', projects), 'Other');
  assert.throws(() => normalizeProjects([{ name: 'Other', substrings: ['example.com'] }]), /reserved/i);
  assert.throws(() => normalizeProjects([{ name: 'work', substrings: [] }]), /substring/i);
  assert.throws(() => normalizeProjects([{ name: 'work', substrings: ['same'] }, { name: 'Work', substrings: ['other'] }]), /duplicate/i);
  assert.throws(() => normalizeProjects(['work', 'personal', 'client'].map(name => ({ name, substrings: Array.from({ length: 100 }, (_, index) => `${name}-${index}`) }))), /too large/i);
  assert.throws(() => normalizeProjects(['work', 'personal'].map(name => ({ name, substrings: Array.from({ length: 100 }, (_, index) => `${index}-${'😀'.repeat(245)}`) }))), /too large/i);
});

test('billable settings normalize stable GitHub logins and integer minor-unit rates', () => {
  assert.deepEqual(normalizeBillingSettings({ currency: 'usd', rates: { bob: 1250, Alice: 10000 } }), {
    rates: { Alice: [{ amountMinorPerHour: 10000, currency: 'USD', currencyPosition: 'suffix', startDate: '', endDate: '' }], bob: [{ amountMinorPerHour: 1250, currency: 'USD', currencyPosition: 'suffix', startDate: '', endDate: '' }] },
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
    config: { owner: 'acme', repo: 'time-data', branch: 'clockoli/users/1', repoId: 42, recentDays: 9 },
    billing: { currency: 'EUR', rates: { alice: 12345 } },
    projects: [{ name: 'work', substrings: ['github.com/acme/'] }],
    exportedAt: '2026-08-22T12:00:00.000Z',
  });
  const value = JSON.parse(text);
  assert.deepEqual(value.repository, { owner: 'acme', repo: 'time-data', branch: 'clockoli/users/1', repoId: 42 });
  assert.equal(JSON.parse(settingsExportText({ config: { recentDays: 7 } })).repository, null);
  assert.deepEqual(value.security, { credentialsIncluded: false });
  assert.doesNotMatch(text, /accessToken|refreshToken|personal access token/i);
  assert.equal(value.version, 3);
  assert.deepEqual(value.projects, [{ name: 'work', substrings: ['github.com/acme/'] }]);
  assert.deepEqual(parseSettingsImport(text), { recentDays: 9, projects: [{ name: 'work', substrings: ['github.com/acme/'] }], billing: { rates: { alice: [{ amountMinorPerHour: 12345, currency: 'EUR', currencyPosition: 'suffix', startDate: '', endDate: '' }] } } });
  const legacy = JSON.parse(text);
  legacy.version = 1;
  delete legacy.projects;
  legacy.billing = { currency: 'gel', rates: { alice: [{ amountMinorPerHour: 88800, startDate: '', endDate: '' }] } };
  assert.deepEqual(parseSettingsImport(JSON.stringify(legacy)).billing, {
    rates: { alice: [{ amountMinorPerHour: 88800, currency: 'GEL', currencyPosition: 'suffix', startDate: '', endDate: '' }] },
  });
  assert.deepEqual(parseSettingsImport(JSON.stringify(legacy)).projects, []);
  const version2 = JSON.parse(text); version2.version = 2; delete version2.projects;
  assert.deepEqual(parseSettingsImport(JSON.stringify(version2)).projects, []);
  assert.ok(new TextEncoder().encode(text).byteLength <= 262_144);
  assert.deepEqual(parseSettingsImport(settingsExportText({ config: { recentDays: 7 }, projects: value.projects })).projects, value.projects);
  assert.throws(() => parseSettingsImport('{'), /valid JSON/);
  assert.throws(() => parseSettingsImport(JSON.stringify({ ...value, accessToken: 'must-not-be-accepted' })), /unexpected fields/);
  assert.throws(() => parseSettingsImport(JSON.stringify({ ...value, security: { credentialsIncluded: true } })), /credentials/);

});
