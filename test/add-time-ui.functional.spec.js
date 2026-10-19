import { test, expect, chromium } from '@playwright/test';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url);
const taskUrl = 'https://example.com/work/1';
const workerSource = `
globalThis.messages = [];
globalThis.failAdd = false;
globalThis.deferAdd = false;
globalThis.pendingAddRespond = null;
globalThis.deferTasks = false;
globalThis.pendingTasksRespond = null;
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  globalThis.messages.push(message);
  if (message.type === 'SEARCH_ACTIVITY') respond({ ok: true, data: { configured: true, recent: [
    { taskUrl: '${taskUrl}', taskTitle: 'Existing task', destinationId: 'github:1', entryDate: '2026-01-01' },
    { taskUrl: 'acme/project/imported', taskTitle: 'Imported conversational task', destinationId: 'github:2', entryDate: '2025-01-01' }
  ] } });
  else if (message.type === 'LOAD_TIMES') respond({ ok: true, data: { configured: true, recent: [], active: null, pendingWrites: [] } });
  else if (message.type === 'GET_PAGE_STATE') respond({ ok: true, data: { configured: true, active: null, pendingWrites: [] } });
  else if (message.type === 'ADD_TIME') {
    if (globalThis.deferAdd) { globalThis.pendingAddRespond = respond; return true; }
    respond(globalThis.failAdd
      ? { ok: false, error: { message: 'Cannot add time' } }
      : { ok: true, data: { accepted: true } });
  }
  else if (message.type === 'LOAD_TASKS' && globalThis.deferTasks) {
    globalThis.pendingTasksRespond = respond;
    return true;
  }
  else respond({ ok: false, error: { message: 'Unexpected request: ' + message.type } });
});
`;

test('shared Add time dialog on Activity and Top tasks searches safely and sends only confirmed entries', async () => {
  test.setTimeout(60000);
  const extension = await mkdtemp(join(tmpdir(), 'clockoli-add-time-extension-'));
  const profile = await mkdtemp(join(tmpdir(), 'clockoli-add-time-profile-'));
  let context;
  try {
    await cp(new URL('src/', ROOT), join(extension, 'src'), { recursive: true });
    const manifest = JSON.parse(await readFile(new URL('manifest.json', ROOT), 'utf8'));
    manifest.background = { service_worker: 'test-worker.js' };
    await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
    await writeFile(join(extension, 'test-worker.js'), workerSource);
    context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const base = `chrome-extension://${new URL(worker.url()).host}/src/`;
    const errors = [];
    for (const path of ['times/times.html', 'tasks/tasks.html']) {
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      const before = (await worker.evaluate(() => globalThis.messages)).filter(message => message.type === 'ADD_TIME').length;
      await page.goto(base + path);
      const add = page.getByRole('button', { name: 'Add time', exact: true });
      await expect(add).toBeVisible();
      const localTime = () => page.evaluate(() => {
        const now = new Date();
        return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      });
      const beforeOpen = await localTime();
      await add.click();
      const dialog = page.getByRole('dialog', { name: 'Add new time' });
      await expect(dialog).toBeVisible();
      await expect(dialog.locator('.add-time-progress, .add-time-status')).toHaveCount(0);
      const startTime = dialog.getByLabel('Start time');
      expect([beforeOpen, await localTime()]).toContain(await startTime.inputValue());
      const startTimestamp = () => page.evaluate(() => {
        const now = new Date(), time = document.getElementById('add-time-start').value;
        const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        return new Date(`${date}T${time}:00`).toISOString();
      });
      const search = dialog.getByRole('combobox', { name: 'Task' });
      await search.fill('Existing');
      await expect(dialog.getByRole('button', { name: /Existing task/ })).toBeVisible();
      await dialog.getByRole('button', { name: /Existing task/ }).click();
      await expect(dialog.locator('.add-time-preview')).toContainText(taskUrl);
      expect((await worker.evaluate(() => globalThis.messages)).some(message => message.type === 'SEARCH_ACTIVITY')).toBe(true);
      await dialog.getByLabel('Start time').fill('09:15');
      await dialog.getByLabel('End time').fill('10:45');
      await dialog.getByLabel('Description').fill('Focused work');
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await expect(dialog).not.toBeVisible();
      let messages = await worker.evaluate(() => globalThis.messages);
      expect(messages.filter(message => message.type === 'ADD_TIME')).toHaveLength(before);
      await add.click();
      expect([await localTime()]).toContain(await startTime.inputValue());
      await search.fill('conversat');
      await dialog.getByRole('button', { name: /Imported conversational task/ }).click();
      await expect(dialog.locator('.add-time-preview')).toContainText('acme/project/imported');
      const importedStart = await startTimestamp();
      await worker.evaluate(() => { globalThis.deferAdd = true; });
      await dialog.getByRole('button', { name: 'Add', exact: true }).click();
      await expect(dialog.locator('.add-time-progress, .add-time-status')).toHaveCount(0);
      await expect(dialog.getByRole('button', { name: 'Add', exact: true })).toBeDisabled();
      await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled();
      await expect(dialog).toBeVisible();
      await worker.evaluate(() => {
        globalThis.deferAdd = false;
        globalThis.pendingAddRespond({ ok: true, data: { accepted: true } });
        globalThis.pendingAddRespond = null;
      });
      await expect(dialog).not.toBeVisible();
      let imported = (await worker.evaluate(() => globalThis.messages)).filter(message => message.type === 'ADD_TIME').at(-1);
      expect(imported).toEqual({ type: 'ADD_TIME', taskUrl: 'acme/project/imported', taskTitle: 'Imported conversational task', destinationId: 'github:2', startedAt: importedStart, endedAt: null, description: '' });
      await add.click();
      await search.fill('javascript:alert(1)');
      await dialog.getByRole('button', { name: 'Add', exact: true }).click();
      await expect(dialog.getByRole('alert')).toContainText('Select a task or enter an HTTP(S) URL');
      await search.fill('https://example.org/new-task');
      await expect(dialog.locator('.add-time-preview')).toContainText('https://example.org/new-task');
      await worker.evaluate(() => { globalThis.failAdd = true; });
      await dialog.getByRole('button', { name: 'Add', exact: true }).click();
      await expect(dialog.getByRole('alert')).toContainText('Cannot add time');
      await expect(dialog.locator('.add-time-progress, .add-time-status')).toHaveCount(0);
      await expect(dialog).toBeVisible();
      await worker.evaluate(() => { globalThis.failAdd = false; });
      const urlStart = await startTimestamp();
      await dialog.getByRole('button', { name: 'Add', exact: true }).click();
      await expect(dialog).not.toBeVisible();
      messages = await worker.evaluate(() => globalThis.messages);
      const submitted = messages.filter(message => message.type === 'ADD_TIME');
      expect(submitted).toHaveLength(before + 3);
      expect(submitted.at(-1)).toEqual({ type: 'ADD_TIME', taskUrl: 'https://example.org/new-task', taskTitle: '', startedAt: urlStart, endedAt: null, description: '' });
      expect(messages.some(message => message.type === 'SEARCH_ACTIVITY')).toBe(true);
      await add.click();
      await search.fill('Existing');
      await dialog.getByRole('button', { name: /Existing task/ }).click();
      await dialog.getByLabel('Start time').fill('09:15');
      await dialog.getByLabel('End time').fill('10:45');
      const multiline = dialog.getByLabel('Description');
      await multiline.fill(['A', 'B', 'C', 'D', 'E', 'F'].join('\n'));
      await expect.poll(() => multiline.evaluate(el => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(2);
      await multiline.fill('Focused work');
      await multiline.press('Shift+Enter');
      await multiline.pressSequentially('Reviewed results');
      await expect(multiline).toHaveValue('Focused work\nReviewed results');
      const expectedTimes = await page.evaluate(() => {
        const today = new Date();
        const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        return ['09:15', '10:45'].map(time => new Date(`${date}T${time}:00`).toISOString());
      });
      await worker.evaluate(() => { globalThis.deferAdd = true; });
      await multiline.press('Enter');
      await expect(dialog.locator('.add-time-progress, .add-time-status')).toHaveCount(0);
      await expect(dialog.getByRole('button', { name: 'Add', exact: true })).toBeDisabled();
      await page.evaluate(() => { globalThis.__addTimeNoReload = 'accepted locally'; });
      if (path === 'tasks/tasks.html') await worker.evaluate(() => { globalThis.deferTasks = true; });
      await worker.evaluate(() => {
        globalThis.deferAdd = false;
        globalThis.pendingAddRespond({ ok: true, data: { accepted: true } });
        globalThis.pendingAddRespond = null;
      });
      await expect(dialog).not.toBeVisible();
      const completed = (await worker.evaluate(() => globalThis.messages)).filter(message => message.type === 'ADD_TIME').at(-1);
      expect(completed).toEqual({ type: 'ADD_TIME', taskUrl, taskTitle: 'Existing task',
        startedAt: expectedTimes[0], endedAt: expectedTimes[1], description: 'Focused work\nReviewed results' });
      await expect(page.locator('.add-time-success')).toBeVisible();
      await expect(page.locator('.add-time-success')).toHaveText('✓ Saved');
      if (path === 'tasks/tasks.html') {
        await expect.poll(() => worker.evaluate(() => Boolean(globalThis.pendingTasksRespond))).toBe(true);
        await worker.evaluate(() => {
          globalThis.deferTasks = false;
          globalThis.pendingTasksRespond({ ok: false, error: { message: 'Fixture refresh unavailable' } });
          globalThis.pendingTasksRespond = null;
        });
      }
      expect(await page.evaluate(() => globalThis.__addTimeNoReload)).toBe('accepted locally');
      await page.close();
    }
    expect(errors).toEqual([]);
  } finally {
    await context?.close();
    await rm(extension, { recursive: true, force: true });
    await rm(profile, { recursive: true, force: true });
  }
});
