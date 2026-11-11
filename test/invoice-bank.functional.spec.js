import { test, expect, chromium } from '@playwright/test';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url);
const fixtureWorker = `
let invoicing = { seller: { name: 'Example Studio' }, clients: [{ id: 'acme', name: 'Acme', defaultCurrency: 'EUR' }],
  nextNumber: 7, numberFormat: 'INV-{YYYY}-{NNNN}', paymentTermsDays: 30, taxPercent: 0, notes: '' };
let clientRates = { acme: { alice: [{ amountMinorPerHour: 12000, currency: 'EUR', currencyPosition: 'suffix', startDate: '', endDate: '' }] } };
let revision = 0;
const date = new Date(); date.setDate(date.getDate() - ((date.getDay() + 6) % 7) - 7);
const day = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
const record = { id: 'fixture', taskUrl: 'https://example.com/task', taskTitle: 'Fixture task', entryDate: day,
  startedAt: day + 'T09:00:00Z', endedAt: day + 'T10:00:00Z', durationSeconds: 3600, user: 'alice',
  destinationId: 'github:1', timeRepository: 'acme/time' };
const preferences = () => ({ invoicing, clientRates,
  projects: [{ id: 'project-1', name: 'Work', substrings: ['example.com/'], client: 'acme', destinationId: 'github:1' }],
  otherProjectClient: '', recentDays: 7, revision });
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (['LOCAL_PREFERENCES_CHANGED', 'REPORT_PROGRESS'].includes(message.type)) return;
  if (message.type === 'GET_ONBOARDING_STATE') respond({ ok: true, data: { ready: true, appConfigured: true,
    auth: { mode: 'github_app', githubLogin: 'alice', accessTokenExpiresAt: new Date(Date.now() + 3600000).toISOString() },
    config: { owner: 'acme', repo: 'time', branch: 'main' }, verificationStatus: 'write_verified',
    defaultDestinationId: 'github:1', destinations: [
      { id: 'github:1', owner: 'acme', repo: 'time', label: 'acme/time', branch: 'main', defaultBranch: 'main', initialized: true },
      { id: 'github:2', owner: 'acme', repo: 'other', label: 'acme/other', branch: 'main', defaultBranch: 'main', initialized: true },
    ] } });
  else if (message.type === 'GET_LOCAL_PREFERENCES') respond({ ok: true, data: preferences() });
  else if (message.type === 'LOAD_REPOSITORY_COLLABORATORS') {
    const logins = message.destinationId === 'github:1' ? ['alice', 'bob', 'carol', 'dave', 'fifth'] : ['other'];
    respond({ ok: true, data: { users: logins.slice(0, 4).map(login => ({ login })),
      moreUsers: logins.slice(4).map(login => ({ login })), avatarUsers: logins.map(login => ({ login })), hasMore: logins.length > 4 } });
  }
  else if (message.type === 'SAVE_BILLING_SETTINGS') {
    if (message.expectedRevision !== revision) respond({ ok: false, error: { message: 'Settings revision changed' } });
    else { if (message.payload.invoicing) invoicing = message.payload.invoicing;
      if (message.payload.clientRates) clientRates = message.payload.clientRates;
      revision++;
      respond({ ok: true, data: { ...preferences(), exportRecommended: true } }); }
  }
  else if (message.type === 'LOAD_REPORT') respond({ ok: true, data: { configured: true, records: [record], billing: preferences(), pendingWrites: [], pendingCount: 0,
    remoteWriteConfirmed: true, sourceRepositories: ['acme/time'], currentUser: 'alice', currentUsers: { 'github:1': 'alice' }, partial: false, conflicts: [] } });
  else if (message.type === 'GET_STATE') respond({ ok: true, data: { configured: true, active: null, pendingWrites: [], pendingCount: 0 } });
  else if (message.type === 'GET_ADDON_SETTINGS') respond({ ok: true, data: {} });
  else respond({ ok: true, data: {} });
});
`;

test('Settings bank accounts save and Reports selects only one for the invoice at wide and narrow widths', async () => {
  const extension = await mkdtemp(join(tmpdir(), 'clockoli-invoice-bank-'));
  const profile = await mkdtemp(join(tmpdir(), 'clockoli-invoice-bank-profile-'));
  let context;
  try {
    await cp(new URL('src/', root), join(extension, 'src'), { recursive: true });
    const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
    manifest.background = { service_worker: 'fixture-worker.js', type: 'module' };
    await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
    await writeFile(join(extension, 'fixture-worker.js'), fixtureWorker);
    context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const errors = [];
    worker.on('pageerror', error => errors.push(error.message));
    worker.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const base = `chrome-extension://${new URL(worker.url()).host}/src`;
    await page.goto(`${base}/options/options.html`);
    await expect(page.locator('#more-settings')).toHaveAttribute('open', '');
    await expect(page.locator('#invoicing-settings legend').first()).toHaveText('Your business details');
    await expect(page.locator('#clients-title')).toHaveText('Clients (invoice recipients)');
    await expect(page.locator('#rates-destination')).toHaveValue('github:1');
    await page.locator('#seller-address').fill('Suite\u007f1');
    await page.locator('#save-invoicing').click();
    await expect(page.locator('#invoicing-feedback')).toHaveText('Your business details → Address: control character (U+007F) at line 1, column 6 is not allowed. Remove it.');
    await page.locator('#seller-name').fill('Example\tStudio');
    await page.locator('#seller-address').fill('Suite\t\t1\nMain Street');
    await page.locator('#save-invoicing').click();
    await expect(page.locator('#invoicing-feedback')).toHaveText('Your business details → Name: tab (U+0009) at character 8 is not allowed. Replace it with a space.');
    await expect(page.locator('#seller-name')).toHaveValue('Example\tStudio');
    await page.locator('#seller-name').fill('Example Studio');
    await page.locator('#save-invoicing').click();
    await expect(page.locator('#invoicing-feedback')).toHaveText('Your business details → Address: tab (U+0009) at line 1, column 6 is not allowed. Replace it with a space.');
    await expect(page.locator('#seller-address')).toHaveValue('Suite\t\t1\nMain Street');
    await page.locator('#seller-address').fill('Suite  1\nMain Street');
    await page.locator('#save-invoicing').click();
    await expect(page.locator('#save-invoicing')).toHaveText('Saved');
    await expect(page.locator('#seller-name')).toHaveValue('Example Studio');
    await expect(page.locator('#seller-address')).toHaveValue('Suite  1\nMain Street');
    const login = page.locator('.rate-row .rate-login').first();
    await login.fill('');
    await expect(page.locator('.rate-row').first().locator('.rate-user-choice')).toHaveCount(5);
    await expect(page.locator('.rate-row').first().locator('.rate-user-choices')).toBeVisible();
    await page.locator('#rates-destination').focus();
    await page.locator('#rates-destination').selectOption('github:2');
    await login.focus();
    await expect(page.locator('.rate-row').first().locator('.rate-user-choice')).toHaveCount(1);
    await expect(page.locator('.rate-row').first().locator('.rate-user-choice')).toHaveText('other');
    await page.locator('#rates-destination').selectOption('github:1');
    await login.fill('alice');
    await page.locator('#add-rate').click();
    const newRate = page.locator('.rate-row').last();
    await newRate.locator('.rate-login').focus();
    await expect(newRate.locator('.rate-user-choice')).toHaveCount(5);
    await newRate.locator('.rate-login').fill('fi');
    await expect(newRate.locator('.rate-user-choice')).toHaveCount(1);
    await expect(newRate.locator('.rate-user-choices')).toBeVisible();
    if (process.env.INVOICE_BANK_SHOTS) {
      await mkdir(process.env.INVOICE_BANK_SHOTS, { recursive: true });
      for (const width of [1280, 400]) {
        await page.setViewportSize({ width, height: 800 });
        await page.locator('#billing-settings').screenshot({ path: join(process.env.INVOICE_BANK_SHOTS, `rate-picker-${width}.png`) });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Rate picker overflow at ${width}px`).toBe(true);
      }
      await page.setViewportSize({ width: 1280, height: 800 });
    }
    await newRate.locator('.rate-login').press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(newRate.locator('.rate-login')).toHaveValue('fifth');
    await newRate.locator('.rate-value').fill('40');
    await newRate.locator('.rate-currency').fill('EUR');
    await page.locator('#save-billing').click();
    await expect(page.locator('#billing-feedback')).toHaveText('');
    await expect(page.locator('#save-billing')).toHaveText('Saved');
    for (const [label, details] of [['EUR account', 'IBAN: XX01'], ['USD account', 'Routing: 02']]) {
      await page.locator('#add-bank-account').click();
      const row = page.locator('.bank-account-row').last();
      await row.locator('.bank-account-label').fill(label);
      await row.locator('.bank-account-details').fill(details);
    }
    const secondDetails = page.locator('.bank-account-row').last().locator('.bank-account-details');
    await secondDetails.fill('Routing:\t02');
    await page.locator('#save-invoicing').click();
    await expect(page.locator('#invoicing-feedback')).toHaveText('Bank details → account 2 → Payment instructions: tab (U+0009) at line 1, column 9 is not allowed. Replace it with a space.');
    await expect(secondDetails).toHaveValue('Routing:\t02');
    await secondDetails.fill('Routing: 02');
    const secondId = await page.locator('.bank-account-row').last().getAttribute('data-bank-account-id');
    await page.locator('#default-bank-account').selectOption(secondId);
    await page.locator('#save-invoicing').click();
    await expect(page.locator('#save-invoicing')).toHaveText('Saved');
    await page.reload();
    await expect(page.locator('#more-settings')).toHaveAttribute('open', '');
    await expect(page.locator('.bank-account-row')).toHaveCount(2);
    await expect(page.locator('#default-bank-account')).toHaveValue(secondId);
    await expect(page.locator('.rate-row .rate-login')).toHaveCount(2);
    await expect(page.locator('.rate-row').last().locator('.rate-login')).toHaveValue('fifth');
    await expect(page.locator('#add-client')).toBeVisible();
    if (process.env.INVOICE_BANK_SHOTS) {
      await mkdir(process.env.INVOICE_BANK_SHOTS, { recursive: true });
      for (const width of [1280, 400]) {
        await page.setViewportSize({ width, height: 800 });
        await page.locator('#billing-settings').screenshot({ path: join(process.env.INVOICE_BANK_SHOTS, `rates-${width}.png`) });
        await page.locator('#invoicing-settings').screenshot({ path: join(process.env.INVOICE_BANK_SHOTS, `settings-${width}.png`) });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Settings overflow at ${width}px`).toBe(true);
      }
    }
    await page.goto(`${base}/reports/reports.html`);
    await expect(page.locator('#report-content')).toBeVisible();
    expect(await page.locator('#create-invoice').getAttribute('data-clockoli-tooltip')).toBeNull();
    await page.locator('#create-invoice').click();
    await expect(page.locator('#invoice-bank-account')).toHaveValue(secondId);
    await expect(page.locator('#invoice-preview')).toContainText('Routing: 02');
    await expect(page.locator('#invoice-preview')).not.toContainText('IBAN: XX01');
    for (const width of [1280, 400]) {
      await page.setViewportSize({ width, height: 800 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      expect(overflow, `invoice horizontal overflow at ${width}px`).toBe(false);
      await expect(page.locator('#invoice-bank-account')).toBeVisible();
      if (process.env.INVOICE_BANK_SHOTS && width === 400) await page.locator('#invoice-dialog').screenshot({ path: join(process.env.INVOICE_BANK_SHOTS, 'invoice-400.png') });
    }
    await page.locator('#invoice-bank-account').selectOption('bank-1');
    await expect(page.locator('#invoice-preview')).toContainText('IBAN: XX01');
    await expect(page.locator('#invoice-preview')).not.toContainText('Routing: 02');
    expect(errors).toEqual([]);
  } finally {
    await context?.close();
    await rm(extension, { recursive: true, force: true });
    await rm(profile, { recursive: true, force: true });
  }
});
