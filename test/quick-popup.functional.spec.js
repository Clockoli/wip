import { test, expect, chromium } from '@playwright/test';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url);
const workerSource = `
const recent = [
  { id: 'older', taskUrl: 'https://github.com/acme/project/issues/42', taskTitle: 'Review PR #42',
    startedAt: '2026-11-09T08:00:00Z', endedAt: '2026-11-09T08:45:00Z', durationSeconds: 2700,
    entryDate: '2026-11-09', destinationId: 'github:1' },
  { id: 'older2', taskUrl: 'https://example.com/work/1', taskTitle: 'Fix CI failures',
    startedAt: '2026-11-09T07:00:00Z', endedAt: '2026-11-09T07:30:00Z', durationSeconds: 1800,
    entryDate: '2026-11-09', destinationId: 'github:1' },
];
let active = null;
const calls = [];
globalThis.quickCalls = calls;
globalThis.setQuickActive = value => { active = value; };
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  calls.push(message);
  const state = () => ({ configured: true, active, recent, pendingWrites: [] });
  if (message.type === 'GET_PAGE_STATE' || message.type === 'LOAD_RECENT') {
    respond({ ok: true, data: state() });
  } else if (message.type === 'START') {
    active = { id: 'started', taskUrl: message.taskUrl, taskTitle: message.taskTitle,
      startedAt: new Date(Date.now() - 61_000).toISOString(), description: '' };
    respond({ ok: true, data: active });
  } else if (message.type === 'SWITCH_TASK') {
    active = { id: 'restarted', taskUrl: message.taskUrl, taskTitle: message.taskTitle,
      startedAt: new Date(Date.now() - 61_000).toISOString(), description: '' };
    respond({ ok: true, data: { active } });
  } else if (message.type === 'QUEUE_ACTIVE_START_EDIT') {
    if (!active || active.id !== message.payload?.original?.id || active.startedAt !== message.payload.original.startedAt) {
      respond({ ok: false, error: { message: 'Timer changed before description save.' } });
    } else {
      active = { ...active, description: message.payload.description };
      respond({ ok: true, data: { operationId: 'description-edit', pending: true } });
    }
  } else if (message.type === 'STOP') {
    const entry = { ...active, description: message.description ?? active.description, endedAt: new Date().toISOString(), durationSeconds: 62 };
    active = null;
    recent.unshift(entry);
    respond({ ok: true, data: { entry, destinationId: 'github:1' } });
  } else if (message.type === 'OPEN_TIMES' || message.type === 'OPEN_OPTIONS') {
    respond({ ok: true, data: {} });
  } else respond({ ok: false, error: { message: 'Unexpected request: ' + message.type } });
});
`;

test('toolbar quick popup stays minimal and uses the shared tracker commands', async ({}, testInfo) => {
  const extension = await mkdtemp(join(tmpdir(), 'clockoli-quick-popup-extension-'));
  const profile = await mkdtemp(join(tmpdir(), 'clockoli-quick-popup-profile-'));
  let context;
  try {
    await cp(new URL('src/', ROOT), join(extension, 'src'), { recursive: true });
    const manifest = JSON.parse(await readFile(new URL('manifest.json', ROOT), 'utf8'));
    manifest.background = { service_worker: 'test-worker.js' };
    await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
    await writeFile(join(extension, 'test-worker.js'), workerSource);
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    worker.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/src/popup/quick.html`);
    const root = page.locator('#quick-popup');

    await expect(root.locator('.quick-logo')).toBeVisible();
    const initialSize = await root.evaluate(node => node.getBoundingClientRect().height);
    expect(initialSize).toBeGreaterThanOrEqual(500);
    await expect(root.getByRole('button', { name: 'Open Activity in a new tab' })).toBeInViewport();
    await expect(root.getByText('Quick tracker', { exact: true })).toHaveCount(0);
    await expect(root.getByText('Not tracking', { exact: true })).toHaveCount(0);
    await expect(root.getByRole('button', { name: 'Start tracking this page' })).toBeDisabled();
    await expect(root.locator('.quick-entry')).toHaveCount(2);
    await expect(root.getByRole('button', { name: 'Track again: Review PR #42' })).toBeVisible();
    await expect(root.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
    await expect(root.getByRole('button', { name: 'Open Activity in a new tab' })).toBeVisible();
    await expect(root.locator('.timeline-shell, .calendar-task, .activity-list, .menu, .header-navigation, .timeline-view-modes')).toHaveCount(0);
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 700 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      expect(overflow).toBeLessThanOrEqual(0);
    }

    await root.getByRole('button', { name: 'Track again: Review PR #42' }).click();
    await expect(root.getByText('Tracking', { exact: true })).toHaveCount(0);
    await expect(root.getByRole('timer', { name: 'Elapsed time' })).toHaveText(/\d\d:\d\d:\d\d/);
    await expect(root.locator('.quick-description-actions')).toHaveCount(0);
    const description = root.getByRole('textbox', { name: 'Description' });
    await expect(description).toHaveAttribute('placeholder', 'Add description…');
    await description.fill('Reviewed code');
    await expect(root.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
    await description.press('Shift+Enter');
    await description.type('and tests');
    await expect(description).toHaveValue('Reviewed code\nand tests');
    await description.press('Enter');
    await expect.poll(() => worker.evaluate(() => active?.description)).toBe('Reviewed code\nand tests');
    const edit = (await worker.evaluate(() => globalThis.quickCalls)).find(call => call.type === 'QUEUE_ACTIVE_START_EDIT');
    expect(edit.payload).toMatchObject({ description: 'Reviewed code\nand tests',
      original: { id: 'restarted' } });
    await description.fill('Updated on blur');
    await description.blur();
    await expect.poll(async () => (await worker.evaluate(() => globalThis.quickCalls))
      .filter(call => call.type === 'QUEUE_ACTIVE_START_EDIT').length).toBe(2);
    await expect.poll(() => worker.evaluate(() => active?.description)).toBe('Updated on blur');
    await description.fill('Final description via Stop');
    await expect(root.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
    await expect(root.getByRole('button', { name: 'Stop and save' })).toBeEnabled();
    await expect(root.getByRole('button', { name: 'Track again: Review PR #42' })).toBeDisabled();
    const calls = await worker.evaluate(() => globalThis.quickCalls);
    expect(calls.find(call => call.type === 'SWITCH_TASK')).toMatchObject({
      taskUrl: 'https://github.com/acme/project/issues/42', timelineTask: true,
    });
    await root.getByRole('button', { name: 'Stop and save' }).click();
    await expect(root.getByText('Not tracking', { exact: true })).toHaveCount(0);
    await expect(root.locator('.quick-entry')).toHaveCount(3);
    const stop = (await worker.evaluate(() => globalThis.quickCalls)).find(call => call.type === 'STOP');
    expect(stop).toEqual({ type: 'STOP', description: 'Final description via Stop' });
    expect(await worker.evaluate(() => recent[0].description)).toBe('Final description via Stop');
    // Simulate a shorter container while keeping the real popup's explicit height
    // (Chrome's action popup auto-sizes to that height at first open).
    await page.setViewportSize({ width: 390, height: 320 });
    await page.addStyleTag({ content: '#quick-popup { height: 320px !important; }' });
    const listScroll = root.locator('.quick-body');
    await expect(root.getByRole('button', { name: 'Open Activity in a new tab' })).toBeInViewport();
    await expect.poll(() => listScroll.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
    await listScroll.evaluate(node => { node.scrollTop = node.scrollHeight; });
    await expect(root.getByRole('button', { name: 'Open Activity in a new tab' })).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath('quick-popup.png') });

    await root.getByRole('button', { name: 'Open Activity in a new tab' }).click();
    await expect.poll(() => worker.evaluate(() => globalThis.quickCalls.some(call => call.type === 'OPEN_TIMES'))).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await context?.close();
    await rm(extension, { recursive: true, force: true });
    await rm(profile, { recursive: true, force: true });
  }
});
