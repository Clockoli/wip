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
    { name: 'personal', substrings: ['example.com/personal/'], client: '' },
  ]);
  assert.deepEqual(projects, [
    { name: 'work', substrings: ['github.com/manticoresoftware/', 'github.com/clockoli/'], client: '' },
    { name: 'personal', substrings: ['example.com/personal/'], client: '' },
  ]);
  assert.equal(projectNameForUrl('https://github.com/Clockoli/clockoli/issues/1', projects), 'work');
  assert.equal(projectNameForUrl('https://example.com/PERSONAL/todo', projects), 'personal');
  assert.equal(projectNameForUrl('https://elsewhere.test/task', projects), 'Other');
  assert.equal(projectNameForUrl('https://elsewhere.test/task', projects, 'General'), 'General');
  assert.deepEqual(normalizeProjects([{ name: 'Other', substrings: ['example.com'] }]), [{ name: 'Other', substrings: ['example.com'], client: '' }]);
  assert.throws(() => normalizeProjects([{ name: 'work', substrings: [] }]), /substring/i);
  assert.throws(() => normalizeProjects([{ name: 'work', substrings: ['same'] }, { name: 'Work', substrings: ['other'] }]), /duplicate/i);
  assert.throws(() => normalizeProjects(['work', 'personal', 'client'].map(name => ({ name, substrings: Array.from({ length: 100 }, (_, index) => `${name}-${index}`) }))), /too large/i);
  assert.throws(() => normalizeProjects(['work', 'personal'].map(name => ({ name, substrings: Array.from({ length: 100 }, (_, index) => `${index}-${'😀'.repeat(245)}`) }))), /too large/i);
  assert.throws(() => settingsExportText({ config: { recentDays: 7 }, projects: [{ name: 'General', substrings: ['example.com'] }], otherProjectName: 'general' }), /must differ/i);
  assert.doesNotThrow(() => settingsExportText({ config: { recentDays: 7 }, projects: [{ name: 'Other', substrings: ['example.com'] }], otherProjectName: 'General' }));
});

test('billable settings normalize client rate cards and stable GitHub logins', () => {
  const normalized = normalizeBillingSettings({ invoicing: { clients: [{ id: 'acme' }] }, clientRates: { acme: { bob: 1250, Alice: 10000 } } });
  assert.deepEqual(normalized.clientRates.acme, {
    Alice: [{ amountMinorPerHour: 10000, currency: 'USD', currencyPosition: 'suffix', startDate: '', endDate: '' }],
    bob: [{ amountMinorPerHour: 1250, currency: 'USD', currencyPosition: 'suffix', startDate: '', endDate: '' }],
  });
  assert.deepEqual(normalized.invoicing.clients.map(client => client.id), ['acme']);
  assert.equal(rateMajorToMinor('125.50'), 12550);
  assert.equal(rateMinorToMajor(12550), '125.50');
  assert.throws(() => rateMajorToMinor('1.234'), /decimal places/);
  assert.throws(() => normalizeBillingSettings({ invoicing: { clients: [{ id: 'acme' }] }, clientRates: { acme: { 'bad/login': 10 } } }), /login/);
  assert.throws(() => normalizeBillingSettings({ invoicing: { clients: [{ id: 'acme' }] }, clientRates: { acme: { Alice: 10, alice: 20 } } }), /Duplicate/);
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
    billing: { invoicing: { clients: [{ id: 'acme', name: 'Acme' }] }, clientRates: { acme: { alice: 12345 } } },
    projects: [{ name: 'work', substrings: ['github.com/acme/'], client: '' }],
    otherProjectName: 'General',
    showQueueDiagnostics: true,
    exportedAt: '2026-08-22T12:00:00.000Z',
  });
  const value = JSON.parse(text);
  assert.deepEqual(value.repository, { owner: 'acme', repo: 'time-data', branch: 'clockoli/users/1', repoId: 42 });
  assert.equal(JSON.parse(settingsExportText({ config: { recentDays: 7 } })).repository, null);
  assert.deepEqual(value.security, { credentialsIncluded: false });
  assert.doesNotMatch(text, /accessToken|refreshToken|personal access token/i);
  assert.equal(value.version, 8);
  assert.equal(value.display.otherProjectName, 'General');
  assert.equal(value.display.showQueueDiagnostics, true);
  assert.deepEqual(value.projects, [{ name: 'work', substrings: ['github.com/acme/'], client: '' }]);
  assert.deepEqual(parseSettingsImport(text).billing, normalizeBillingSettings({ invoicing: { clients: [{ id: 'acme', name: 'Acme' }] }, clientRates: { acme: { alice: 12345 } } }));
  assert.throws(() => parseSettingsImport(JSON.stringify({ ...value, billing: { rates: { alice: 12345 } } })), /billing fields/);
  assert.throws(() => parseSettingsImport(JSON.stringify({ ...value, version: 7 })), /unsupported/i);
  assert.throws(() => parseSettingsImport(JSON.stringify({ ...value, display: { ...value.display, showQueueDiagnostics: 'yes' } })), /true or false/);
  assert.ok(new TextEncoder().encode(text).byteLength <= 262_144);
  assert.deepEqual(parseSettingsImport(settingsExportText({ config: { recentDays: 7 }, projects: value.projects })).projects, value.projects);
  assert.throws(() => parseSettingsImport('{'), /valid JSON/);
  assert.throws(() => parseSettingsImport(JSON.stringify({ ...value, accessToken: 'must-not-be-accepted' })), /unexpected fields/);
  assert.throws(() => parseSettingsImport(JSON.stringify({ ...value, security: { credentialsIncluded: true } })), /credentials/);

});

test('routed settings backup preserves selected clients and invoicing', () => {
  const destinations = {
    'github:42': { repoId: 42, owner: 'acme', repo: 'time-data', branch: 'clockoli/users/1' },
    'github:84': { repoId: 84, owner: 'acme', repo: 'shared-time', branch: 'clockoli/users/1' },
  };
  const billing = {
    clientRates: { 'client-1': { alice: [{ amountMinorPerHour: 12345, currency: 'EUR', currencyPosition: 'suffix', startDate: '', endDate: '' }] } },
    invoicing: normalizeInvoicingSettings({ seller: { name: 'Alice Example' }, clients: [{ id: 'client-1', name: 'Client One' }] }),
  };
  const text = settingsExportText({
    config: { recentDays: 9 }, billing, destinations, defaultDestinationId: 'github:42',
    otherProjectName: 'General', otherProjectClient: 'client-1', reportingUtc: true,
    projects: [{ id: 'project-1', name: 'Work', substrings: ['github.com/acme/'], destinationId: 'github:42', client: 'client-1' }],
    exportedAt: '2026-09-14T12:00:00.000Z',
  });
  const exported = JSON.parse(text);
  assert.equal(exported.version, 8);
  assert.deepEqual(Object.keys(exported.billing).sort(), ['clientRates', 'invoicing']);
  assert.equal(exported.display.otherProjectClient, 'client-1');
  assert.equal(exported.display.reportingUtc, true);
  const imported = parseSettingsImport(text);
  assert.equal(imported.billing.invoicing.seller.name, 'Alice Example');
  assert.equal(imported.projects[0].client, 'client-1');
  assert.equal(imported.otherProjectClient, 'client-1');
  assert.equal(imported.reportingUtc, true);
  assert.equal(imported.repositoryReferencesVerified, false);

  assert.deepEqual(imported.billing.clientRates['client-1'], billing.clientRates['client-1']);
});

test('invoicing settings populate defaults and normalize browser-local seller and clients', () => {
  const defaults = { seller: { name: '', address: '', email: '', taxId: '' }, clients: [], nextNumber: 1, numberFormat: 'INV-{YYYY}-{NNNN}', paymentTermsDays: 30, taxPercent: 0, notes: '' };
  assert.deepEqual(normalizeInvoicingSettings(), defaults);
  assert.deepEqual(invoicingSettings(null), defaults);
  assert.deepEqual(normalizeBillingSettings(), { clientRates: {}, invoicing: invoicingSettings() });
  assert.throws(() => normalizeBillingSettings({ rates: {} }), /unexpected fields/i);
  const normalized = normalizeInvoicingSettings({ seller: { name: ' Seller ' }, clients: [{ id: ' client-1 ', name: ' Client ', defaultCurrency: ' eur ' }, { id: 'unset' }], notes: ' Thanks ', taxPercent: 7.25 });
  assert.equal(normalized.seller.name, 'Seller');
  assert.deepEqual(normalized.clients[0], { id: 'client-1', name: 'Client', address: '', email: '', taxId: '', defaultCurrency: 'EUR' });
  assert.equal(normalized.clients[1].defaultCurrency, '');
  assert.equal(normalized.notes, 'Thanks');
  assert.equal(normalized.taxPercent, 7.25);
  assert.deepEqual(normalizeBillingSettings({ invoicing: normalized }).invoicing, normalized);
});

test('projects own client ids and resolve named and catch-all assignments', () => {
  const invoicing = normalizeInvoicingSettings({ clients: [{ id: 'acme' }, { id: 'globex' }] });
  const projects = normalizeProjects([{ name: 'Acme web', substrings: ['acme/'], client: 'acme' }, { name: 'Unassigned', substrings: ['none/'] }, { name: 'Deleted', substrings: ['deleted/'], client: 'missing' }]);
  const preferences = { projects, otherProjectName: 'Work', otherProjectClient: 'globex' };
  assert.equal(projects[1].client, '');
  assert.equal(clientForProject(' acme WEB ', invoicing, preferences), invoicing.clients[0]);
  assert.equal(clientForProject(' work ', invoicing, preferences), invoicing.clients[1]);
  for (const name of ['Unknown', 'Unassigned', 'Deleted', '']) assert.equal(clientForProject(name, invoicing, preferences), null);
  assert.equal(clientForProject('Other', invoicing, {}), null);
  for (const client of [null, 12, 'bad/id', ' spaced ', 'a'.repeat(65)]) {
    assert.throws(() => normalizeProjects([{ name: 'Work', substrings: ['work/'], client }]), /client/i);
    assert.throws(() => settingsExportText({ otherProjectClient: client }), /client/i);
  }
});

test('legacy client project keys are ignored even when malformed or overlapping', () => {
  for (const projects of [['Shared'], [''], null, 'obsolete', Array(51).fill('Shared')]) {
    const normalized = normalizeInvoicingSettings({ clients: [{ id: 'a', projects }, { id: 'b', projects }] });
    assert.equal(Object.hasOwn(normalized.clients[0], 'projects'), false);
  }
  assert.throws(() => normalizeInvoicingSettings({ seller: { projects: [] } }), /unexpected fields/);
});

test('settings backup preserves explicit project and catch-all client assignments', () => {
  const value = JSON.parse(settingsExportText({
    billing: { invoicing: { clients: [{ id: 'acme', name: 'Acme' }] } },
    projects: [{ name: 'Web', substrings: ['web/'], client: 'acme' }],
    otherProjectName: 'Work', otherProjectClient: 'acme',
  }));
  const imported = parseSettingsImport(JSON.stringify(value));
  assert.equal(imported.projects[0].client, 'acme');
  assert.equal(imported.otherProjectClient, 'acme');
  value.projects[0].client = '';
  assert.equal(parseSettingsImport(JSON.stringify(value)).projects[0].client, '');
  assert.equal(parseSettingsImport(JSON.stringify(value)).otherProjectClient, 'acme');
});


test('invoicing rejects unknown fields, invalid strings, clients, numbering and tax', () => {
  for (const value of [null, [], { unknown: true }, { seller: { unknown: '' } }, { clients: [{ id: 'a', unknown: '' }] },
    { seller: { name: 12 } }, { notes: '\tunsafe' }, { seller: { email: 'bad\u007fmail' } },
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
  for (const field of ['notes']) assert.throws(() => normalizeInvoicingSettings({ [field]: 'a'.repeat(1001) }));
  assert.throws(() => normalizeInvoicingSettings({ numberFormat: 'a'.repeat(59) + '{NNNN}' }));
  assert.throws(() => normalizeInvoicingSettings({ clients: [{ id: 'a'.repeat(65) }] }));
  assert.equal(normalizeInvoicingSettings({ nextNumber: 1e9, taxPercent: 100 }).nextNumber, 1e9);
  assert.equal(normalizeInvoicingSettings({ taxPercent: 0.29 }).taxPercent, 0.29);
});

test('settings backup round-trips invoicing with strict billing keys', () => {
  const invoicing = normalizeInvoicingSettings({ seller: { name: 'Seller' }, clients: [{ id: 'client', defaultCurrency: '$' }], nextNumber: 7, numberFormat: '{YYYY}/{MM}/{NNNN}', paymentTermsDays: 14, taxPercent: 12.34, notes: 'Thank you' });
  const value = JSON.parse(settingsExportText({ billing: { invoicing } }));
  assert.equal(value.version, 8);
  assert.deepEqual(Object.keys(value.billing).sort(), ['clientRates', 'invoicing']);
  assert.deepEqual(parseSettingsImport(JSON.stringify(value)).billing, { invoicing, clientRates: {} });
  assert.throws(() => parseSettingsImport(JSON.stringify({ ...value, billing: { rates: {} } })), /billing fields/);
  assert.throws(() => parseSettingsImport(JSON.stringify({ ...value, display: { ...value.display, extra: true } })), /display/);
  assert.throws(() => parseSettingsImport(JSON.stringify({ ...value, version: 6 })), /unsupported/i);
});

test('payment days normalize legacy text without throwing and validate the new numeric setting', () => {
  for (const [paymentTerms, expected] of [['Net 45', 45], ['Pay 14 days, 30 maximum', 30], ['Due on receipt', 0], ['Net 0', 0], ['Net 999', 365], ['9'.repeat(1000), 365], [null, 30], [123, 30], [{}, 30], ['\n'.repeat(1001), 30]]) {
    const normalized = normalizeInvoicingSettings({ paymentTerms });
    assert.equal(normalized.paymentTermsDays, expected); assert.equal(Object.hasOwn(normalized, 'paymentTerms'), false);
  }
  assert.equal(normalizeInvoicingSettings({ paymentTerms: 'Net 45', paymentTermsDays: 0 }).paymentTermsDays, 0);
  for (const paymentTermsDays of [-1, 366, 1.5, '45', NaN, Infinity, null]) assert.throws(() => normalizeInvoicingSettings({ paymentTermsDays }), /payment terms/i);
  const exported = JSON.parse(settingsExportText({ billing: { invoicing: { paymentTerms: 'Net 45' } } }));
  assert.equal(exported.version, 8); assert.equal(exported.billing.invoicing.paymentTermsDays, 45);
  assert.equal(Object.hasOwn(exported.billing.invoicing, 'paymentTerms'), false);
  const alternative = structuredClone(exported);
  alternative.billing.invoicing.paymentTerms = 'Net 14';
  delete alternative.billing.invoicing.paymentTermsDays;
  assert.equal(parseSettingsImport(JSON.stringify(alternative)).billing.invoicing.paymentTermsDays, 14);
});

for (const [paymentTerms, days, preserve] of [
  ['Due on receipt', 0, false], ['ON RECEIPT', 0, false], ['dUe On ReCeIpT', 0, false],
  ['2% 10, Net 30', 30, true], ['Net 45', 45, false], ['net45', 45, true], ['NET 30 days', 30, true],
  ['45', 45, true], ['Payment by bank transfer', 30, true], ['Net 999', 365, true], ['Net -5', 0, true],
]) test(`legacy payment terms preserve instructions and derive days: ${paymentTerms}`, () => {
  const normalized = normalizeInvoicingSettings({ paymentTerms, notes: 'Thank you' });
  assert.equal(normalized.paymentTermsDays, days);
  assert.equal(normalized.notes, preserve ? `Thank you\nPayment terms: ${paymentTerms}` : 'Thank you');
  assert.deepEqual(normalizeInvoicingSettings(normalized), normalized);
  assert.deepEqual(parseSettingsImport(settingsExportText({ billing: { invoicing: { paymentTerms, notes: 'Thank you' } } })).billing.invoicing, normalized);
});

test('legacy payment notes append once as an exact line and respect the notes limit', () => {
  const paymentTerms = '2% 10, Net 30', line = `Payment terms: ${paymentTerms}`;
  assert.equal(normalizeInvoicingSettings({ paymentTerms }).notes, line);
  for (const notes of [line, `Thanks\n${line}\nBank transfer`]) assert.equal(normalizeInvoicingSettings({ paymentTerms, notes }).notes, notes);
  const partial = `${line} only`;
  assert.equal(normalizeInvoicingSettings({ paymentTerms, notes: partial }).notes, `${partial}\n${line}`);
  const fits = 'a'.repeat(1000 - line.length - 1), full = `${fits}a`;
  assert.equal(normalizeInvoicingSettings({ paymentTerms, notes: fits }).notes, `${fits}\n${line}`);
  assert.equal(normalizeInvoicingSettings({ paymentTerms, notes: full }).notes, full);
  assert.equal(normalizeInvoicingSettings({ paymentTerms, paymentTermsDays: 14 }).notes, line);
  assert.throws(() => normalizeInvoicingSettings({ notes: 'a\n' + 'b'.repeat(999) }), /notes/);
  assert.throws(() => normalizeInvoicingSettings({ seller: { name: 'a\nb' } }), /name/);
});

test('an invoicing address keeps its line breaks while other party fields reject control characters', () => {
  const address = '12 Karaiskaki\nNicosia, Cyprus';
  const invoicing = normalizeInvoicingSettings({ seller: { name: 'Manticore Software LTD', address } });
  assert.equal(invoicing.seller.address, address);
  assert.throws(() => normalizeInvoicingSettings({ seller: { name: 'Bad\nName' } }), /Invalid invoicing name/);
  assert.throws(() => normalizeInvoicingSettings({ seller: { address: 'Tabbed\taddress' } }), /Invalid invoicing address/);
});


test('v7 UTC basis defaults locally and rejects invalid values without loosening display fields', () => {
  const value = JSON.parse(settingsExportText({ reportingUtc: true }));
  assert.equal(value.version, 8); assert.equal(parseSettingsImport(JSON.stringify(value)).reportingUtc, true);
  delete value.display.reportingUtc; assert.throws(() => parseSettingsImport(JSON.stringify(value)), /display fields/);
  value.display.reportingUtc = false; assert.equal(parseSettingsImport(JSON.stringify(value)).reportingUtc, false);
  for (const invalid of ['true', 1, null, {}]) {
    value.display.reportingUtc = invalid;
    assert.throws(() => parseSettingsImport(JSON.stringify(value)), /true or false/);
    assert.throws(() => settingsExportText({ reportingUtc: invalid }), /true or false/);
  }
});
