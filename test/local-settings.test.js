import assert from 'node:assert/strict';
import test from 'node:test';
import {
  billableMinorForRecord, billableMinorTotal, normalizeBillingSettings, parseSettingsImport,
  normalizeProjects, projectNameForUrl, rateMajorToMinor, rateMinorToMajor, settingsExportText,
  clientForProject, normalizeInvoicingSettings, invoicingSettings,
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
  assert.equal(projectNameForUrl('https://elsewhere.test/task', projects, 'General'), 'General');
  assert.deepEqual(normalizeProjects([{ name: 'Other', substrings: ['example.com'] }]), [{ name: 'Other', substrings: ['example.com'] }]);
  assert.throws(() => normalizeProjects([{ name: 'work', substrings: [] }]), /substring/i);
  assert.throws(() => normalizeProjects([{ name: 'work', substrings: ['same'] }, { name: 'Work', substrings: ['other'] }]), /duplicate/i);
  assert.throws(() => normalizeProjects(['work', 'personal', 'client'].map(name => ({ name, substrings: Array.from({ length: 100 }, (_, index) => `${name}-${index}`) }))), /too large/i);
  assert.throws(() => normalizeProjects(['work', 'personal'].map(name => ({ name, substrings: Array.from({ length: 100 }, (_, index) => `${index}-${'😀'.repeat(245)}`) }))), /too large/i);
  assert.throws(() => settingsExportText({ config: { recentDays: 7 }, projects: [{ name: 'General', substrings: ['example.com'] }], otherProjectName: 'general' }), /must differ/i);
  assert.doesNotThrow(() => settingsExportText({ config: { recentDays: 7 }, projects: [{ name: 'Other', substrings: ['example.com'] }], otherProjectName: 'General' }));
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
    otherProjectName: 'General',
    showQueueDiagnostics: true,
    exportedAt: '2026-08-22T12:00:00.000Z',
  });
  const value = JSON.parse(text);
  assert.deepEqual(value.repository, { owner: 'acme', repo: 'time-data', branch: 'clockoli/users/1', repoId: 42 });
  assert.equal(JSON.parse(settingsExportText({ config: { recentDays: 7 } })).repository, null);
  assert.deepEqual(value.security, { credentialsIncluded: false });
  assert.doesNotMatch(text, /accessToken|refreshToken|personal access token/i);
  assert.equal(value.version, 6);
  assert.equal(value.display.otherProjectName, 'General');
  assert.equal(value.display.showQueueDiagnostics, true);
  assert.deepEqual(value.projects, [{ name: 'work', substrings: ['github.com/acme/'] }]);
  assert.deepEqual(parseSettingsImport(text), { recentDays: 9, projects: [{ name: 'work', substrings: ['github.com/acme/'] }], otherProjectName: 'General', showQueueDiagnostics: true, billing: { invoicing: invoicingSettings(), rates: { alice: [{ amountMinorPerHour: 12345, currency: 'EUR', currencyPosition: 'suffix', startDate: '', endDate: '' }] } } });
  const legacy = JSON.parse(text);
  legacy.version = 1;
  delete legacy.projects;
  delete legacy.display.otherProjectName;
  delete legacy.display.showQueueDiagnostics;
  legacy.billing = { currency: 'gel', rates: { alice: [{ amountMinorPerHour: 88800, startDate: '', endDate: '' }] } };
  assert.deepEqual(parseSettingsImport(JSON.stringify(legacy)).billing, {
    invoicing: invoicingSettings(),
    rates: { alice: [{ amountMinorPerHour: 88800, currency: 'GEL', currencyPosition: 'suffix', startDate: '', endDate: '' }] },
  });
  assert.deepEqual(parseSettingsImport(JSON.stringify(legacy)).projects, []);
  const version2 = JSON.parse(text); version2.version = 2; delete version2.projects; delete version2.display.otherProjectName; delete version2.display.showQueueDiagnostics;
  delete version2.billing.invoicing;
  assert.deepEqual(parseSettingsImport(JSON.stringify(version2)).projects, []);
  const version4 = JSON.parse(text); version4.version = 4; delete version4.display.showQueueDiagnostics;
  delete version4.billing.invoicing;
  assert.equal(parseSettingsImport(JSON.stringify(version4)).showQueueDiagnostics, false);
  assert.throws(() => parseSettingsImport(JSON.stringify({ ...value, display: { ...value.display, showQueueDiagnostics: 'yes' } })), /true or false/);
  assert.ok(new TextEncoder().encode(text).byteLength <= 262_144);
  assert.deepEqual(parseSettingsImport(settingsExportText({ config: { recentDays: 7 }, projects: value.projects })).projects, value.projects);
  assert.throws(() => parseSettingsImport('{'), /valid JSON/);
  assert.throws(() => parseSettingsImport(JSON.stringify({ ...value, accessToken: 'must-not-be-accepted' })), /unexpected fields/);
  assert.throws(() => parseSettingsImport(JSON.stringify({ ...value, security: { credentialsIncluded: true } })), /credentials/);

});

test('invoicing settings populate defaults and normalize browser-local seller and clients', () => {
  const defaults = { seller: { name: '', address: '', email: '', taxId: '' }, clients: [], nextNumber: 1, numberFormat: 'INV-{YYYY}-{NNNN}', paymentTerms: 'Net 30', taxPercent: 0, notes: '' };
  assert.deepEqual(normalizeInvoicingSettings(), defaults);
  assert.deepEqual(invoicingSettings(null), defaults);
  assert.deepEqual(normalizeBillingSettings({ rates: {} }), { rates: {} });
  const normalized = normalizeInvoicingSettings({ seller: { name: ' Seller ' }, clients: [{ id: ' client-1 ', name: ' Client ', defaultCurrency: ' eur ' }, { id: 'unset' }], notes: ' Thanks ', taxPercent: 7.25 });
  assert.equal(normalized.seller.name, 'Seller');
  assert.deepEqual(normalized.clients[0], { id: 'client-1', name: 'Client', address: '', email: '', taxId: '', defaultCurrency: 'EUR', projects: [] });
  assert.equal(normalized.clients[1].defaultCurrency, '');
  assert.equal(normalized.notes, 'Thanks');
  assert.equal(normalized.taxPercent, 7.25);
  assert.deepEqual(normalizeBillingSettings({ invoicing: normalized }).invoicing, normalized);
});

test('client project ownership normalizes, caps, de-duplicates and resolves case-insensitively', () => {
  const invoicing = normalizeInvoicingSettings({ clients: [
    { id: 'acme', name: 'Acme Inc', projects: [' Acme web ', 'ACME WEB', 'Acme API'] },
    { id: 'globex', name: 'Globex GmbH', projects: ['Globex API'] },
  ] });
  assert.deepEqual(invoicing.clients[0].projects, ['Acme web', 'Acme API']);
  assert.equal(clientForProject(' acme WEB ', invoicing), invoicing.clients[0]);
  assert.equal(clientForProject('GLOBEX api', invoicing), invoicing.clients[1]);
  assert.equal(clientForProject('Unknown', invoicing), null);
  assert.equal(normalizeInvoicingSettings({ clients: [{ id: 'cap', projects: Array.from({ length: 50 }, (_, index) => `Project ${index}`) }] }).clients[0].projects.length, 50);
  assert.throws(() => normalizeInvoicingSettings({ clients: [{ id: 'cap', projects: Array.from({ length: 51 }, (_, index) => `Project ${index}`) }] }), /at most 50/);
  for (const project of ['', ' '.repeat(2), 'a'.repeat(81), 'bad\nproject']) {
    assert.throws(() => normalizeInvoicingSettings({ clients: [{ id: 'invalid', projects: [project] }] }));
  }
});

test('two clients cannot claim the same project', () => {
  assert.throws(() => normalizeInvoicingSettings({ clients: [
    { id: 'acme', projects: ['Shared'] }, { id: 'globex', projects: [' shared '] },
  ] }), { message: 'Project shared is already assigned to another client.' });
});

test('invoicing rejects unknown fields, invalid strings, clients, numbering and tax', () => {
  for (const value of [null, [], { unknown: true }, { seller: { unknown: '' } }, { clients: [{ id: 'a', unknown: '' }] },
    { seller: { name: 12 } }, { notes: '\nunsafe' }, { seller: { email: 'bad\u007fmail' } },
    { clients: [{ id: '' }] }, { clients: [{ id: 'bad/id' }] }, { clients: [{ id: 'a' }, { id: 'a' }] },
    { clients: [{ id: 'a', defaultCurrency: 'US1' }] }, { clients: Array.from({ length: 51 }, (_, index) => ({ id: `c${index}` })) },
    ...[0, -1, 1.5, 1e9 + 1, Number.MAX_SAFE_INTEGER, '1'].map(nextNumber => ({ nextNumber })),
    ...[-1, 100.01, 1.001, NaN, Infinity, '5'].map(taxPercent => ({ taxPercent })),
    ...['INV', 'INV-{DD}-{NNNN}', '{yyyy}-{NNNN}', '{NNNN}-{OTHER}'].map(numberFormat => ({ numberFormat }))]) {
    assert.throws(() => normalizeInvoicingSettings(value));
  }
  for (const [field, limit] of [['name', 200], ['email', 200], ['taxId', 200], ['address', 1000]]) {
    assert.equal(normalizeInvoicingSettings({ seller: { [field]: 'a'.repeat(limit) } }).seller[field].length, limit);
    assert.throws(() => normalizeInvoicingSettings({ seller: { [field]: 'a'.repeat(limit + 1) } }));
    assert.throws(() => normalizeInvoicingSettings({ clients: [{ id: 'a', [field]: 'a'.repeat(limit + 1) }] }));
  }
  for (const field of ['notes', 'paymentTerms']) assert.throws(() => normalizeInvoicingSettings({ [field]: 'a'.repeat(1001) }));
  assert.throws(() => normalizeInvoicingSettings({ numberFormat: 'a'.repeat(59) + '{NNNN}' }));
  assert.throws(() => normalizeInvoicingSettings({ clients: [{ id: 'a'.repeat(65) }] }));
  assert.equal(normalizeInvoicingSettings({ nextNumber: 1e9, taxPercent: 100 }).nextNumber, 1e9);
  assert.equal(normalizeInvoicingSettings({ taxPercent: 0.29 }).taxPercent, 0.29);
});

test('settings v6 round-trip invoicing and older files import explicit defaults with strict billing keys', () => {
  const invoicing = normalizeInvoicingSettings({ seller: { name: 'Seller' }, clients: [{ id: 'client', defaultCurrency: '$' }], nextNumber: 7, numberFormat: '{YYYY}/{MM}/{NNNN}', paymentTerms: 'Net 14', taxPercent: 12.34, notes: 'Thank you' });
  const value = JSON.parse(settingsExportText({ billing: { invoicing } }));
  assert.equal(value.version, 6);
  assert.deepEqual(Object.keys(value.billing).sort(), ['invoicing', 'rates']);
  assert.deepEqual(parseSettingsImport(JSON.stringify(value)).billing, { invoicing, rates: {} });
  assert.throws(() => parseSettingsImport(JSON.stringify({ ...value, billing: { rates: {} } })), /billing fields/);
  assert.throws(() => parseSettingsImport(JSON.stringify({ ...value, display: { ...value.display, extra: true } })), /display/);
  for (const version of [2, 3, 4, 5]) {
    const older = structuredClone(value); older.version = version;
    if (version < 3) delete older.projects;
    if (version < 4) delete older.display.otherProjectName;
    if (version < 5) delete older.display.showQueueDiagnostics;
    assert.throws(() => parseSettingsImport(JSON.stringify(older)), /billing fields/);
    delete older.billing.invoicing;
    assert.deepEqual(parseSettingsImport(JSON.stringify(older)).billing.invoicing, invoicingSettings());
  }
});
