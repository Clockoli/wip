import { test, expect, chromium } from '@playwright/test';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('..', import.meta.url);
const workerSource = `
const pad = value => String(value).padStart(2, '0');
const day = new Date(); day.setDate(day.getDate() - (day.getDay() + 6) % 7 - 3);
const date = [day.getFullYear(), pad(day.getMonth() + 1), pad(day.getDate())].join('-');
const startedAt = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9).toISOString();
const endedAt = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 10).toISOString();
const record = { id: 'one', taskUrl: 'https://example.org/one', taskTitle: 'Cached report work',
  entryDate: date, startedAt, endedAt, durationSeconds: 3600, user: 'alice',
  destinationId: 'github:1', timeRepository: 'acme/time' };
const task = { taskUrl: record.taskUrl, title: 'Cached task', totalSeconds: 3600, sessionCount: 1, destinationId: 'github:1' };
const scope = value => JSON.stringify(value);
globalThis.views = {};
globalThis.hold = '';
globalThis.release = () => {};
globalThis.started = [];
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  const ok = data => respond({ ok: true, data });
  if (message.type === 'GET_CACHED_VIEW') {
    ok(globalThis.views[message.kind]?.scope === scope(message.range) ? globalThis.views[message.kind].data : null);
  } else if (message.type === 'GET_LOCAL_PREFERENCES') ok({ reportingUtc: false, revision: 0, invoicing: { clients: [] }, projects: [] });
  else if (message.type === 'GET_PAGE_STATE' || message.type === 'GET_STATE') ok({ configured: true, active: null, recent: [], pendingWrites: [], pendingCount: 0 });
  else if (message.type === 'LOAD_REPORT' || message.type === 'LOAD_TASKS') {
    const kind = message.type === 'LOAD_REPORT' ? 'reports' : 'tasks';
    const range = { startDate: message.payload.startDate, endDate: message.payload.endDate,
      ...(kind === 'reports' ? { reportingUtc: message.payload.reportingUtc } : {}) };
    const data = { configured: true, records: [record], tasks: [task], currentUser: 'alice',
      currentUsers: { 'github:1': 'alice' }, pendingWrites: [], partial: false,
      readStatus: [{ status: 'ok' }], sourceRepositories: ['acme/time'], billing: { invoicing: { clients: [] } } };
    const finish = () => { globalThis.views[kind] = { scope: scope(range), data }; ok(data); };
    if (globalThis.hold === kind) globalThis.release = finish;
    else finish();
  } else if (message.type === 'START') { globalThis.started.push(message.taskUrl); ok({ taskUrl: message.taskUrl, startedAt: new Date().toISOString() }); }
  else ok({ configured: true, active: null, recent: [], pendingWrites: [] });
  return true;
});
`;

test('previous Reports and Top tasks remain usable during a delayed refresh', async () => {
  const scratch = process.env.TMPDIR || '/tmp';
  const extension = await mkdtemp(join(scratch, 'clockoli-cached-extension-'));
  const profile = await mkdtemp(join(scratch, 'clockoli-cached-profile-'));
  let context;
  try {
    await cp(new URL('src/', root), join(extension, 'src'), { recursive: true });
    const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
    manifest.background = { service_worker: 'test-worker.js' };
    await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
    await writeFile(join(extension, 'test-worker.js'), workerSource);
    context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const errors = [];
    worker.on('console', message => { if (message.type() === 'error') errors.push(`worker: ${message.text()}`); });
    worker.on('pageerror', error => errors.push(`worker: ${error.message}`));
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(`page: ${error.message}`));
    const base = `chrome-extension://${new URL(worker.url()).host}/src/`;
    await worker.evaluate(() => { globalThis.hold = 'reports'; });
    await page.goto(`${base}reports/reports.html`);
    await expect(page.locator('#loading')).toBeVisible();
    const [firstLoadBox, firstTabsBox, firstNavBox] = await Promise.all([
      page.locator('#loading').boundingBox(), page.locator('.page-tabs-shell').boundingBox(),
      page.locator('.page-tab-list').boundingBox(),
    ]);
    expect(firstLoadBox.y).toBeGreaterThanOrEqual(firstTabsBox.y);
    expect(firstLoadBox.y + firstLoadBox.height).toBeLessThanOrEqual(firstTabsBox.y + firstTabsBox.height);
    expect(firstLoadBox.x).toBeGreaterThanOrEqual(firstNavBox.x + firstNavBox.width);
    await worker.evaluate(() => { globalThis.hold = ''; globalThis.release(); });
    await expect(page.locator('#summary-time')).toHaveText('1h 0m');
    await page.goto(`${base}tasks/tasks.html`);
    await expect(page.locator('.task-row')).toContainText('Cached task');

    await worker.evaluate(() => { globalThis.hold = 'reports'; });
    await page.goto(`${base}reports/reports.html`);
    await expect(page.locator('#summary-time')).toHaveText('1h 0m');
    await expect(page.locator('#loading')).toBeVisible();
    await expect(page.locator('#loading-progress')).toBeVisible();
    await expect(page.locator('#partial-status')).toContainText('Previously loaded report');
    const [progressBox, tabsBox, navBox, reportBox] = await Promise.all([
      page.locator('#loading').boundingBox(), page.locator('.page-tabs-shell').boundingBox(),
      page.locator('.page-tab-list').boundingBox(),
      page.locator('#report-content').boundingBox(),
    ]);
    expect(progressBox.y).toBeGreaterThanOrEqual(tabsBox.y);
    expect(progressBox.y + progressBox.height).toBeLessThanOrEqual(tabsBox.y + tabsBox.height);
    expect(progressBox.x).toBeGreaterThanOrEqual(navBox.x + navBox.width);
    expect(progressBox.y + progressBox.height).toBeLessThanOrEqual(reportBox.y);
    await page.setViewportSize({ width: 390, height: 800 });
    const compactProgress = await page.locator('#loading').boundingBox();
    const compactTabs = await page.locator('.page-tabs-shell').boundingBox();
    const compactBrand = await page.locator('.page-brand-controls').boundingBox();
    const compactNav = await page.locator('.page-tab-list').boundingBox();
    expect(compactProgress.y).toBeGreaterThanOrEqual(compactTabs.y);
    expect(compactProgress.y + compactProgress.height).toBeLessThanOrEqual(compactTabs.y + compactTabs.height);
    expect(compactProgress.y).toBeLessThan(compactBrand.y + compactBrand.height);
    expect(compactProgress.x).toBeGreaterThanOrEqual(compactBrand.x + compactBrand.width);
    expect(compactProgress.y + compactProgress.height).toBeLessThanOrEqual(compactNav.y);
    expect(compactProgress.x + compactProgress.width).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await expect(page.locator('#download-csv')).toHaveAttribute('aria-disabled', 'true');
    await worker.evaluate(() => { globalThis.hold = ''; globalThis.release(); });
    await expect(page.locator('#loading')).toBeHidden();
    await expect(page.locator('#partial-status')).toBeHidden();
    await expect(page.locator('#download-csv')).toHaveAttribute('aria-disabled', 'false');

    await worker.evaluate(() => { globalThis.hold = 'tasks'; });
    await page.goto(`${base}tasks/tasks.html`);
    await expect(page.locator('.task-row')).toContainText('Cached task');
    await expect(page.locator('#refresh-tasks')).toHaveClass(/syncing/);
    await page.locator('.task-row .timer-button').click();
    expect(await worker.evaluate(() => globalThis.started)).toEqual(['https://example.org/one']);
    await worker.evaluate(() => { globalThis.hold = ''; globalThis.release(); });
    await expect(page.locator('#refresh-tasks')).not.toHaveClass(/syncing/);
    expect(errors).toEqual([]);
  } finally {
    await context?.close();
    await rm(extension, { recursive: true, force: true });
    await rm(profile, { recursive: true, force: true });
  }
});

test('the actual service worker accepts only scoped cached-view requests', async () => {
  const scratch = process.env.TMPDIR || '/tmp';
  const extension = await mkdtemp(join(scratch, 'clockoli-live-worker-extension-'));
  const profile = await mkdtemp(join(scratch, 'clockoli-live-worker-profile-'));
  let context;
  try {
    await cp(new URL('src/', root), join(extension, 'src'), { recursive: true });
    await cp(new URL('manifest.json', root), join(extension, 'manifest.json'));
    context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const errors = [];
    worker.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    worker.on('pageerror', error => errors.push(error.message));
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    const base = `chrome-extension://${new URL(worker.url()).host}/src/`;
    await page.goto(`${base}reports/reports.html`);
    const response = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'GET_CACHED_VIEW', kind: 'reports',
      range: { startDate: '2026-09-01', endDate: '2026-09-07', reportingUtc: false } }));
    expect(response).toEqual({ ok: true, data: null });
    const rejected = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'GET_CACHED_VIEW', kind: 'tasks',
      range: { startDate: '2026-09-01', endDate: '2026-09-07' } }));
    expect(rejected.ok).toBe(false);
    expect(errors).toEqual([]);
  } finally {
    await context?.close();
    await rm(extension, { recursive: true, force: true });
    await rm(profile, { recursive: true, force: true });
  }
});
