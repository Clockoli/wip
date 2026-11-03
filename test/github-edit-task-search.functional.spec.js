import { test, expect, chromium } from '@playwright/test';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url);
const workerSource = `
const now = new Date();
const ended = new Date(now.getTime() - 15 * 60_000);
const started = new Date(now.getTime() - 45 * 60_000);
const entryDate = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
const record = { id: '01K3X7Q8N8F4J7R2JQZ5AKP1MD', taskUrl: 'https://github.com/acme/app/issues/42',
  taskTitle: 'Original task', entryDate, timezone: 'UTC', startedAt: started.toISOString(),
  endedAt: ended.toISOString(), durationSeconds: 1800, destinationId: 'github:1',
  _path: 'times/' + entryDate.slice(0, 7) + '/alice.jsonl', _sha: 'fixture', _index: 0 };
globalThis.searches = []; globalThis.edits = [];
globalThis.holdSearch = false;
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (['GET_PAGE_STATE', 'GET_STATE', 'LOAD_RECENT', 'LOAD_WEEK'].includes(message.type)) {
    respond({ ok: true, data: { configured: true, active: null, recent: [record], pendingWrites: [], pendingCount: 0 } });
  } else if (message.type === 'SEARCH_ENTRY_TASKS') {
    globalThis.searches.push({ ...message, senderUrl: sender.url });
    const data = { configured: true, tasks: [
      { taskUrl: 'acme/Routines/1-dev-call', title: 'Routines — #1 dev call', destinationId: 'github:1' },
      ...(message.query === 'call' ? [{ taskUrl: 'acme/Routines/2-support-call', title: 'Routines — #2 support call', destinationId: 'github:1' }] : [])
    ], partial: false };
    if (globalThis.holdSearch) { globalThis.holdSearch = false; globalThis.releaseSearch = () => respond({ ok: true, data }); }
    else respond({ ok: true, data });
  } else if (message.type === 'QUEUE_ENTRY_EDIT') {
    globalThis.edits.push(message.payload);
    respond({ ok: true, data: { operationId: 'fixture-edit' } });
  } else respond({ ok: true, data: {} });
  return true;
});
`;

test('GitHub panel finds an imported task and queues its selected identity for a completed entry', async () => {
  const extension = await mkdtemp(join(tmpdir(), 'clockoli-github-search-extension-'));
  const profile = await mkdtemp(join(tmpdir(), 'clockoli-github-search-profile-'));
  let context;
  try {
    await cp(new URL('src/', root), join(extension, 'src'), { recursive: true });
    const contentPath = join(extension, 'src/content/github.js');
    await writeFile(contentPath, (await readFile(contentPath, 'utf8')).replaceAll("mode: 'closed'", "mode: 'open'"));
    const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
    manifest.background = { service_worker: 'test-worker.js' };
    await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
    await writeFile(join(extension, 'test-worker.js'), workerSource);
    context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const errors = [];
    worker.on('pageerror', error => errors.push(`worker: ${error.message}`));
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(`page: ${error.message}`));
    await page.route('https://github.com/acme/app/issues/42', route => route.fulfill({ status: 200,
      contentType: 'text/html', body: '<!doctype html><html><body><header><div class="AppHeader-actions"><img class="avatar" alt="User"></div></header><main><h1>Issue</h1></main></body></html>' }));
    await page.goto('https://github.com/acme/app/issues/42');

    const trigger = page.locator('#clockoli-root .trigger-main');
    await expect(trigger).toBeVisible();
    await trigger.click();
    const panel = page.locator('#clockoli-full-width-popup-root');
    await panel.getByRole('button', { name: 'List', exact: true }).click();
    const row = panel.locator('.entry-record').filter({ hasText: 'Original task' });
    await expect(row).toBeVisible();
    await row.hover();
    await row.locator('.entry-edit').click();
    const form = page.locator('.add-time-dialog');
    await expect(form).toBeVisible();
    await form.locator('input[type="search"]').fill('dev');
    await expect(form.getByText('Routines — #1 dev call')).toBeVisible();
    await expect.poll(async () => worker.evaluate(() => globalThis.searches.length)).toBe(1);
    await form.locator('input[type="search"]').fill('call');
    await expect(form.getByText('Routines — #2 support call')).toBeVisible();
    await expect.poll(async () => worker.evaluate(() => globalThis.searches.length)).toBe(2);
    const searches = await worker.evaluate(() => globalThis.searches);
    expect(searches[0]).toMatchObject({ type: 'SEARCH_ENTRY_TASKS', destinationId: 'github:1',
      recordId: '01K3X7Q8N8F4J7R2JQZ5AKP1MD', query: 'dev', senderUrl: 'https://github.com/acme/app/issues/42' });
    expect(searches[1].query).toBe('call');
    expect(searches[0].path).toMatch(/^times\/\d{4}-\d{2}\/alice\.jsonl$/);
    await worker.evaluate(() => { globalThis.holdSearch = true; });
    await form.locator('input[type="search"]').fill('dev');
    await expect.poll(async () => worker.evaluate(() => globalThis.searches.length)).toBe(3);
    await form.locator('input[type="search"]').fill('call');
    await worker.evaluate(() => { globalThis.releaseSearch(); });
    await expect.poll(async () => worker.evaluate(() => globalThis.searches.length)).toBe(4);
    await expect(form.getByText('Routines — #2 support call')).toBeVisible();
    await form.locator('.add-time-option').filter({ hasText: 'Routines — #1 dev call' }).click();
    await form.locator('.add-time-submit').click();
    await expect.poll(async () => worker.evaluate(() => globalThis.edits.length)).toBe(1);
    expect((await worker.evaluate(() => globalThis.edits))[0]).toMatchObject({ destinationId: 'github:1',
      edits: { taskUrl: 'acme/Routines/1-dev-call', taskTitle: 'Routines — #1 dev call' } });
    expect(errors).toEqual([]);
  } finally {
    await context?.close();
    await rm(extension, { recursive: true, force: true });
    await rm(profile, { recursive: true, force: true });
  }
});
