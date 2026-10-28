import { test, expect, chromium } from '@playwright/test';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url);
const workerSource = `
globalThis.messages = [];
globalThis.searchRequests = 0;
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  globalThis.messages.push(message);
  if (message.type === 'LOAD_TASKS') respond({ ok: true, data: { configured: true, tasks: globalThis.ownTasks || [
    { taskUrl: 'https://example.org/own', title: 'My task', totalSeconds: 3600, sessionCount: 1, destinationIds: ['github:1'] }
  ], active: globalThis.active || null, pendingWrites: [] } });
  else if (message.type === 'SEARCH_TASKS') {
    globalThis.searchRequests++;
    const tasks = globalThis.searchTasks || [
    { taskUrl: 'https://example.org/own', title: 'My task', destinationIds: ['github:1'] },
    { taskUrl: 'https://example.org/colleague', title: 'Colleague task', destinationIds: ['github:2'] },
    { taskUrl: 'acme/project/imported', title: 'Other imported task', destinationId: 'github:2', timeRepository: 'team/time' }
    ];
    const data = { configured: true, tasks, readStatus: (globalThis.searchRepositories || []).map(() => ({ status: 'ok' })) };
    if (globalThis.holdSearch) globalThis.releaseSearch = () => respond({ ok: true, data });
    else respond({ ok: true, data });
  }
  else if (message.type === 'GET_PAGE_STATE') respond({ ok: true, data: { configured: true, active: globalThis.active || null, pendingWrites: [] } });
  else if (message.type === 'START') respond({ ok: true, data: { taskUrl: message.taskUrl, startedAt: new Date().toISOString(), destinationId: message.destinationId || 'github:1' } });
  else if (message.type === 'SWITCH_TASK') respond({ ok: true, data: { active: { taskUrl: message.taskUrl, startedAt: new Date().toISOString(), destinationId: message.destinationId }, pending: false } });
  else respond({ ok: false, error: { message: 'Unexpected request ' + message.type } });
  return true;
});
`;

test('Top tasks searches teammates without replacing personal period totals', async () => {
  const extension = await mkdtemp(join(tmpdir(), 'clockoli-catalog-extension-'));
  const profile = await mkdtemp(join(tmpdir(), 'clockoli-catalog-profile-'));
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
    const page = await context.newPage(), errors = [];
    worker.on('pageerror', error => errors.push(`worker: ${error.message}`));
    worker.on('console', message => { if (message.type() === 'error') errors.push(`worker: ${message.text()}`); });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/src/tasks/tasks.html`);
    await expect(page.locator('.task-row')).toHaveCount(1);
    await expect(page.locator('.task-row')).toContainText('My task');
    await page.locator('#task-filter').fill('Colleague');
    await expect(page.locator('.task-row')).toHaveCount(1);
    await expect(page.locator('.task-row')).toContainText('Colleague task');
    await expect(page.locator('.task-row .tracked-time')).toHaveText('—');
    await page.locator('#task-filter').press('Escape');
    await expect(page.locator('.task-row')).toContainText('My task');
    await expect(page.locator('.task-row .tracked-time')).not.toHaveText('—');
    await page.locator('#task-filter').fill('Other imported');
    await expect(page.locator('.task-row')).toContainText('Other imported task');
    await page.locator('.task-row .timer-button').click({ timeout: 5000 });
    await expect.poll(async () => (await worker.evaluate(() => globalThis.messages)).some(message =>
      message.type === 'START' && message.taskUrl === 'acme/project/imported' && message.destinationId === 'github:2')).toBe(true);
    expect((await worker.evaluate(() => globalThis.messages)).filter(message => message.type === 'SEARCH_TASKS')).toHaveLength(1);
    await page.reload();
    await page.locator('#task-filter').fill('Colleague');
    await expect(page.locator('.task-row')).toContainText('Colleague task');
    await worker.evaluate(() => { globalThis.active = { taskUrl: 'acme/project/imported',
      destinationId: 'github:1', startedAt: new Date().toISOString() }; });
    await page.reload();
    await page.locator('#task-filter').fill('Other imported');
    await expect(page.locator('.task-row .timer-button')).toHaveText('Start');
    await page.locator('.task-row .timer-button').click();
    await expect.poll(async () => (await worker.evaluate(() => globalThis.messages)).some(message =>
      message.type === 'SWITCH_TASK' && message.destinationId === 'github:2')).toBe(true);
    await worker.evaluate(() => {
      globalThis.active.destinationId = 'github:2';
      globalThis.ownTasks = [{ taskUrl: 'acme/project/imported', title: 'First imported task',
        totalSeconds: 600, sessionCount: 1, destinationIds: ['github:1'] }];
    });
    await page.reload();
    await page.locator('#task-filter').fill('imported');
    await expect(page.locator('.task-row')).toHaveCount(2);
    const own = page.locator('.task-row').filter({ hasText: 'First imported task' });
    const teammate = page.locator('.task-row').filter({ hasText: 'Other imported task' });
    await expect(own.locator('.tracked-time')).toHaveText('10m');
    await expect(own.locator('.timer-button')).toHaveText('Start');
    await expect(teammate.locator('.tracked-time')).toHaveText('—');
    await expect(teammate.locator('.timer-button')).toContainText('Stop:');
    await worker.evaluate(() => {
      globalThis.active = null; globalThis.ownTasks = [];
      globalThis.searchRepositories = ['team/one', 'team/two'];
      globalThis.searchTasks = ['one', 'two'].map(id => ({ taskUrl: 'acme/project/imported', title: 'Same imported task',
        destinationId: `github:${id}`, timeRepository: `team/${id}` }));
    });
    await page.reload();
    await page.locator('#task-filter').fill('Same imported');
    await expect(page.locator('.task-row')).toHaveCount(2);
    await expect(page.locator('.task-row .task-repository')).toHaveText(['team/one', 'team/two']);
    await page.locator('.task-row').nth(1).locator('.timer-button').click();
    await expect.poll(async () => (await worker.evaluate(() => globalThis.messages))
      .filter(message => message.type === 'START').at(-1)?.destinationId).toBe('github:two');
    expect(errors).toEqual([]);
  } finally {
    await context?.close();
    await rm(extension, { recursive: true, force: true });
    await rm(profile, { recursive: true, force: true });
  }
});

test('refresh during a pending task search retries the catalog after the older result settles', async () => {
  const extension = await mkdtemp(join(tmpdir(), 'clockoli-catalog-extension-'));
  const profile = await mkdtemp(join(tmpdir(), 'clockoli-catalog-profile-'));
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
    const page = await context.newPage();
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/src/tasks/tasks.html`);
    await expect(page.locator('.task-row')).toHaveCount(1);
    await worker.evaluate(() => { globalThis.holdSearch = true; });
    await page.locator('#task-filter').fill('Colleague');
    await expect.poll(() => worker.evaluate(() => globalThis.searchRequests)).toBe(1);
    await page.locator('#refresh-tasks').click();
    await expect(page.locator('#refresh-tasks')).toBeEnabled();
    await worker.evaluate(() => {
      globalThis.searchTasks = [{ taskUrl: 'https://example.org/new', title: 'New colleague', destinationIds: ['github:2'] }];
      globalThis.holdSearch = false;
      globalThis.releaseSearch();
    });
    await expect.poll(() => worker.evaluate(() => globalThis.searchRequests)).toBe(2);
    await expect(page.locator('.task-row')).toContainText('New colleague');
  } finally {
    await context?.close();
    await rm(extension, { recursive: true, force: true });
    await rm(profile, { recursive: true, force: true });
  }
});
