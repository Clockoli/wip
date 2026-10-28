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

test('Add and Edit time accept four-digit keyboard times with one date and an overnight End', async () => {
  const extension = await mkdtemp(join(tmpdir(), 'clockoli-time-fields-extension-'));
  const profile = await mkdtemp(join(tmpdir(), 'clockoli-time-fields-profile-'));
  let context;
  try {
    await cp(new URL('src/', ROOT), join(extension, 'src'), { recursive: true });
    const manifest = JSON.parse(await readFile(new URL('manifest.json', ROOT), 'utf8'));
    manifest.background = { service_worker: 'test-worker.js' };
    await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
    await writeFile(join(extension, 'test-worker.js'), workerSource);
    context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, timezoneId: 'UTC',
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.clock.install({ time: new Date('2026-10-19T15:00:00Z') });
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/src/times/times.html`);
    await page.getByRole('button', { name: 'Add time', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Add new time' });
    const hint = dialog.locator('.add-time-times + .add-time-hint');
    await expect(hint).not.toContainText('Type 1000 for 10:00. An End earlier than Start is on the next day.');
    const form = page.locator('.add-time-dialog');
    const start = form.getByLabel('Start', { exact: true }), end = form.getByLabel('End (optional)');
    const date = form.getByLabel('Date', { exact: true });
    await expect(dialog.locator('.add-time-times input')).toHaveCount(3);
    await expect(date).toHaveAttribute('type', 'date');
    expect(await dialog.locator('.add-time-times input').evaluateAll(inputs => inputs.map(input => input.id)))
      .toEqual(['add-time-start', 'add-time-end', 'add-time-date']);
    await dialog.getByRole('combobox', { name: 'Task' }).fill(taskUrl);
    await date.fill('2026-10-18');
    await start.click();
    expect(await start.evaluate(input => [input.selectionStart, input.selectionEnd]))
      .toEqual([0, (await start.inputValue()).length]);
    await page.keyboard.type('1000');
    await start.press('Tab');
    await expect(start).toHaveValue('10:00');
    await expect(end).toBeFocused();
    await end.pressSequentially('1200');
    await end.press('Tab');
    await expect(end).toHaveValue('12:00');
    await expect(date).toBeFocused();
    await dialog.getByRole('button', { name: 'Add', exact: true }).click();
    let payload = (await worker.evaluate(() => globalThis.messages)).filter(message => message.type === 'ADD_TIME').at(-1);
    expect([payload.startedAt, payload.endedAt]).toEqual(['2026-10-18T10:00:00.000Z', '2026-10-18T12:00:00.000Z']);
    await page.getByRole('button', { name: 'Add time', exact: true }).click();
    await dialog.getByRole('combobox', { name: 'Task' }).fill(taskUrl);
    await date.fill('2026-10-18');
    await start.fill('2300');
    await end.fill('2300');
    await dialog.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('after start');
    expect((await worker.evaluate(() => globalThis.messages)).filter(message => message.type === 'ADD_TIME')).toHaveLength(1);
    await end.fill('0100');
    await dialog.getByRole('button', { name: 'Add', exact: true }).click();
    payload = (await worker.evaluate(() => globalThis.messages)).filter(message => message.type === 'ADD_TIME').at(-1);
    expect([payload.startedAt, payload.endedAt]).toEqual(['2026-10-18T23:00:00.000Z', '2026-10-19T01:00:00.000Z']);

    await page.evaluate(url => {
      const entry = { id: 'synthetic', taskUrl: url, taskTitle: 'Existing task', destinationId: 'github:1',
        startedAt: '2026-10-18T23:00:45.000Z', endedAt: '2026-10-19T01:00:30.000Z', description: '' };
      globalThis.ClockoliTimeEntryForm.openEdit(entry, value => { globalThis.testEditPayload = value; });
    }, taskUrl);
    const editing = page.getByRole('dialog', { name: 'Edit time' });
    await expect(hint).toBeHidden();
    await expect(date).toHaveValue('2026-10-18');
    await expect(start).toHaveValue('23:00');
    await expect(end).toHaveValue('01:00');
    await end.click();
    expect(await end.evaluate(input => [input.selectionStart, input.selectionEnd])).toEqual([0, 5]);
    await editing.getByRole('button', { name: 'Save' }).click();
    expect(await page.evaluate(() => [globalThis.testEditPayload.startedAt, globalThis.testEditPayload.endedAt]))
      .toEqual(['2026-10-18T23:00:45.000Z', '2026-10-19T01:00:30.000Z']);
    await page.evaluate(url => {
      const entry = { id: 'synthetic', taskUrl: url, taskTitle: 'Existing task', destinationId: 'github:1',
        startedAt: '2026-10-18T23:00:45.000Z', endedAt: '2026-10-19T01:00:30.000Z', description: '' };
      globalThis.ClockoliTimeEntryForm.openEdit(entry, value => { globalThis.testEditPayload = value; });
    }, taskUrl);
    await end.click();
    await page.keyboard.type('0200');
    await end.press('Tab');
    await expect(end).toHaveValue('02:00');
    await date.fill('2026-10-17');
    await editing.getByRole('button', { name: 'Save' }).click();
    expect(await page.evaluate(() => [globalThis.testEditPayload.startedAt, globalThis.testEditPayload.endedAt]))
      .toEqual(['2026-10-17T23:00:00.000Z', '2026-10-18T02:00:00.000Z']);
    await page.evaluate(url => {
      globalThis.ClockoliTimeEntryForm.openEdit({ id: 'synthetic', taskUrl: url, taskTitle: 'Existing task',
        startedAt: '2026-10-18T08:00:00.000Z', endedAt: '2026-10-18T09:00:00.000Z', description: '' },
      async () => { throw new Error('This edit would overlap the running timer (Start: 2026-10-18T08:30:00.000Z).'); });
    }, taskUrl);
    await end.fill('10:00');
    await editing.getByRole('button', { name: 'Save' }).click();
    await expect(editing.getByRole('alert')).toContainText('2026-10-18T08:30:00.000Z');
    await expect(editing.getByRole('alert')).not.toContainText('Go to List');
    await expect(editing).toBeVisible();
    await editing.getByRole('button', { name: 'Cancel' }).click();
    await page.evaluate(url => {
      const running = { id: 'running', taskUrl: url, taskTitle: 'Running task',
        startedAt: '2026-10-19T14:00:45.000Z', endedAt: null, _active: true, description: 'Keep this' };
      globalThis.activeEdits = [];
      globalThis.rejectActiveEdit = true;
      globalThis.ClockoliTimeEntryForm.openEdit(running, async value => {
        globalThis.activeEdits.push(value);
        if (globalThis.rejectActiveEdit) throw new Error('Timer start would overlap another entry.');
      });
    }, taskUrl);
    const runningDialog = page.getByRole('dialog', { name: 'Edit timer start' });
    await expect(runningDialog).toBeVisible();
    await expect(date).toBeVisible();
    await expect(start).toBeVisible();
    await expect(end).toBeHidden();
    await expect(runningDialog.getByRole('combobox', { name: 'Task' })).toBeHidden();
    await expect(runningDialog.getByLabel('Description (optional)', { exact: true })).toBeHidden();
    await date.fill('2026-10-18');
    await start.fill('1300');
    await runningDialog.getByRole('button', { name: 'Save' }).click();
    await expect(runningDialog.getByRole('alert')).toContainText('overlap');
    await expect(runningDialog).toBeVisible();
    await page.evaluate(() => { globalThis.rejectActiveEdit = false; });
    await runningDialog.getByRole('button', { name: 'Save' }).click();
    await expect(runningDialog).toBeHidden();
    expect(await page.evaluate(() => globalThis.activeEdits))
      .toEqual([{ startedAt: '2026-10-18T13:00:00.000Z' }, { startedAt: '2026-10-18T13:00:00.000Z' }]);
    expect(errors).toEqual([]);
  } finally {
    await context?.close();
    await rm(extension, { recursive: true, force: true });
    await rm(profile, { recursive: true, force: true });
  }
});

test('editing Start keeps the original End date and rejects a changed interval over 24 hours', async () => {
  const extension = await mkdtemp(join(tmpdir(), 'clockoli-edit-end-date-extension-'));
  const profile = await mkdtemp(join(tmpdir(), 'clockoli-edit-end-date-profile-'));
  let context;
  try {
    await cp(new URL('src/', ROOT), join(extension, 'src'), { recursive: true });
    const manifest = JSON.parse(await readFile(new URL('manifest.json', ROOT), 'utf8'));
    manifest.background = { service_worker: 'test-worker.js' };
    await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
    await writeFile(join(extension, 'test-worker.js'), workerSource);
    context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, timezoneId: 'UTC',
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const page = await context.newPage();
    await page.clock.install({ time: new Date('2026-10-19T15:00:00Z') });
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/src/times/times.html`);
    const openEdit = async (startedAt, endedAt) => page.evaluate(({ taskUrl, startedAt, endedAt }) => {
      globalThis.testEditPayload = null;
      globalThis.ClockoliTimeEntryForm.openEdit({ id: 'synthetic', taskUrl, taskTitle: 'Existing task',
        destinationId: 'github:1', startedAt, endedAt, description: '' },
      value => { globalThis.testEditPayload = value; });
    }, { taskUrl, startedAt, endedAt });
    const dialog = page.getByRole('dialog', { name: 'Edit time' });
    const start = dialog.getByLabel('Start', { exact: true });
    const end = dialog.getByLabel('End (optional)');

    await openEdit('2026-10-17T10:00:00.000Z', '2026-10-18T10:00:30.000Z');
    await expect(end).toHaveValue('10:00');
    await start.fill('11:00');
    await dialog.getByRole('button', { name: 'Save' }).click();
    expect(await page.evaluate(() => globalThis.testEditPayload &&
      [globalThis.testEditPayload.startedAt, globalThis.testEditPayload.endedAt]))
      .toEqual(['2026-10-17T11:00:00.000Z', '2026-10-18T10:00:30.000Z']);

    await openEdit('2026-10-16T08:00:00.000Z', '2026-10-18T10:00:00.000Z');
    await start.fill('09:00');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog.getByRole('alert')).toContainText('cannot exceed 24 hours');
    expect(await page.evaluate(() => globalThis.testEditPayload)).toBeNull();
  } finally {
    await context?.close();
    await rm(extension, { recursive: true, force: true });
    await rm(profile, { recursive: true, force: true });
  }
});

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
    context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, timezoneId: 'UTC',
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
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      });
      const beforeOpen = await localTime();
      await add.click();
      const dialog = page.getByRole('dialog', { name: 'Add new time' });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByLabel('Description (optional)', { exact: true })).toBeVisible();
      await expect(dialog.locator('.add-time-preview')).toBeHidden();
      await expect(dialog).not.toContainText('Select a task to preview it here.');
      await expect(dialog.getByRole('group', { name: 'Time range' })).toBeVisible();
      await expect(dialog.locator('input[type="datetime-local"]')).toHaveCount(0);
      await expect(dialog.locator('input[type="date"]')).toHaveCount(1);
      await expect(dialog.locator('.add-time-times input[type="text"]')).toHaveCount(2);
      await expect(dialog.locator('.add-time-progress, .add-time-status')).toHaveCount(0);
      const startTime = dialog.getByLabel('Start', { exact: true });
      const endTime = dialog.getByLabel('End (optional)');
      const day = dialog.getByLabel('Date', { exact: true });
      expect([beforeOpen, await localTime()].map(value => value.slice(0, 10))).toContain(await day.inputValue());
      expect([beforeOpen, await localTime()].map(value => value.slice(11))).toContain(await startTime.inputValue());
      await expect(endTime).toHaveValue('');
      const startTimestamp = () => page.evaluate(() => {
        return new Date(`${document.getElementById('add-time-date').value}T${document.getElementById('add-time-start').value}`).toISOString();
      });
      const search = dialog.getByRole('combobox', { name: 'Task' });
      await search.fill('Existing');
      await expect(dialog.getByRole('button', { name: /Existing task/ })).toBeVisible();
      await dialog.getByRole('button', { name: /Existing task/ }).click();
      await expect(dialog.locator('.add-time-preview')).toContainText(taskUrl);
      expect((await worker.evaluate(() => globalThis.messages)).some(message => message.type === 'SEARCH_ACTIVITY')).toBe(true);
      await startTime.fill('09:15');
      await expect(endTime).toHaveValue('', 'changing Start in Add time must not create an End');
      await endTime.fill('10:45');
      await dialog.getByLabel('Description').fill('Focused work');
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await expect(dialog).not.toBeVisible();
      let messages = await worker.evaluate(() => globalThis.messages);
      expect(messages.filter(message => message.type === 'ADD_TIME')).toHaveLength(before);
      await add.click();
      expect((await localTime()).slice(11)).toBe(await startTime.inputValue());
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
      await expect(dialog.locator('.add-time-preview')).toBeHidden();
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
      const yesterday = await page.evaluate(() => {
        const date = new Date(); date.setDate(date.getDate() - 1);
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      });
      await day.fill(yesterday);
      await startTime.fill('09:15');
      await endTime.fill('10:45');
      const multiline = dialog.getByLabel('Description');
      await multiline.fill(['A', 'B', 'C', 'D', 'E', 'F'].join('\n'));
      await expect.poll(() => multiline.evaluate(el => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(2);
      await multiline.fill('Focused work');
      await multiline.press('Shift+Enter');
      await multiline.pressSequentially('Reviewed results');
      await expect(multiline).toHaveValue('Focused work\nReviewed results');
      const expectedTimes = await page.evaluate(() => {
        const day = document.getElementById('add-time-date').value;
        return ['add-time-start', 'add-time-end'].map(id =>
          new Date(`${day}T${document.getElementById(id).value}`).toISOString());
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
      await add.click();
      await search.fill('Existing');
      await dialog.getByRole('button', { name: /Existing task/ }).click();
      await day.fill('2026-08-18');
      await startTime.fill('23:00');
      await endTime.fill('22:59');
      const count = (await worker.evaluate(() => globalThis.messages)).filter(message => message.type === 'ADD_TIME').length;
      await dialog.getByRole('button', { name: 'Add', exact: true }).click();
      await expect(dialog).not.toBeVisible();
      const historical = (await worker.evaluate(() => globalThis.messages)).filter(message => message.type === 'ADD_TIME').at(-1);
      expect((await worker.evaluate(() => globalThis.messages)).filter(message => message.type === 'ADD_TIME')).toHaveLength(count + 1);
      expect(historical.startedAt).toBe('2026-08-18T23:00:00.000Z');
      expect(historical.endedAt).toBe('2026-08-19T22:59:00.000Z');
      await add.click();
      await search.fill('https://example.org/new-task');
      const tomorrow = await page.evaluate(() => {
        const day = new Date(); day.setDate(day.getDate() + 1);
        return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
      });
      await day.fill(tomorrow);
      await startTime.fill('08:00');
      const beforeInvalid = (await worker.evaluate(() => globalThis.messages)).filter(message => message.type === 'ADD_TIME').length;
      await dialog.getByRole('button', { name: 'Add', exact: true }).click();
      await expect(dialog.getByRole('alert')).toContainText('future');
      expect((await worker.evaluate(() => globalThis.messages)).filter(message => message.type === 'ADD_TIME')).toHaveLength(beforeInvalid);
      await day.fill('2026-08-18');
      await startTime.fill('08:00');
      await endTime.fill('25:59');
      await dialog.getByRole('button', { name: 'Add', exact: true }).click();
      await expect(dialog.getByRole('alert')).toContainText('valid date and start/end time');
      expect((await worker.evaluate(() => globalThis.messages)).filter(message => message.type === 'ADD_TIME')).toHaveLength(beforeInvalid);
      if (path === 'tasks/tasks.html') {
        await page.clock.install({ time: new Date('2026-10-19T10:00:00Z') });
        await endTime.focus();
        await day.focus();
        await expect(day).toHaveAttribute('max', '2026-10-19');
        await page.clock.fastForward(2 * 60 * 1000);
        await startTime.focus();
        await day.focus();
        await expect(day).toHaveAttribute('max', '2026-10-19');
      }
      await page.setViewportSize({ width: 375, height: 700 });
      await expect.poll(() => dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      await expect(startTime).toBeVisible();
      await expect(endTime).toBeVisible();
      await page.close();
    }
    expect(errors).toEqual([]);
  } finally {
    await context?.close();
    await rm(extension, { recursive: true, force: true });
    await rm(profile, { recursive: true, force: true });
  }
});
