import { test, expect, chromium } from '@playwright/test';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url);
const workerSource = `
const now = new Date();
const monday = new Date(now); monday.setHours(0, 0, 0, 0);
monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7);
const source = new Date(monday); source.setHours(10);
const target = new Date(monday); target.setDate(target.getDate() - 4); target.setHours(14);
const boundary = new Date(monday); boundary.setDate(boundary.getDate() - 1); boundary.setHours(23);
const day = value => [value.getFullYear(), String(value.getMonth() + 1).padStart(2, '0'), String(value.getDate()).padStart(2, '0')].join('-');
const record = (id, start, title) => ({ id, taskUrl: 'https://github.com/acme/app/issues/42', taskTitle: title,
  entryDate: day(start), timezone: 'UTC', startedAt: start.toISOString(), endedAt: new Date(start.getTime() + 3600000).toISOString(),
  durationSeconds: 3600, _path: 'times/' + day(start).slice(0, 7) + '/alice.jsonl', _sha: 'fixture', _index: 0, destinationId: 'fixture' });
const entries = [record('source', source, 'Drag me'), record('neighbor', target, 'Leave me'),
  record('boundary', boundary, 'Ends at Monday')];
globalThis.edits = [];
globalThis.reads = [];
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.type === 'LOAD_TIMES' || message.type === 'LOAD_WEEK') {
    globalThis.reads.push(message.payload);
    respond({ ok: true, data: { configured: true, recent: entries.filter(entry =>
      entry.entryDate >= message.payload.startDate && entry.entryDate <= message.payload.endDate) } });
  } else if (message.type === 'GET_PAGE_STATE' || message.type === 'GET_STATE' || message.type === 'LOAD_RECENT') {
    respond({ ok: true, data: { configured: true, active: null, recent: entries,
      pendingWrites: [], pendingCount: 0, projects: [] } });
  } else if (message.type === 'QUEUE_ENTRY_EDIT') {
    globalThis.edits.push(message.payload);
    respond({ ok: true, data: { operationId: 'accepted' } });
  } else respond({ ok: true, data: {} });
});
`;

for (const view of ['Calendar', 'Timeline']) test(`Activity ${view} does not navigate weeks when dragging to the screen edge`, async () => {
  test.setTimeout(45000);
  const extension = await mkdtemp(join(tmpdir(), 'clockoli-edge-extension-'));
  const profile = await mkdtemp(join(tmpdir(), 'clockoli-edge-profile-'));
  let context;
  try {
    await cp(new URL('src/', ROOT), join(extension, 'src'), { recursive: true });
    const path = join(extension, 'src/content/github.js');
    await writeFile(path, (await readFile(path, 'utf8')).replaceAll("mode: 'closed'", "mode: 'open'"));
    const manifest = JSON.parse(await readFile(new URL('manifest.json', ROOT), 'utf8'));
    manifest.background = { service_worker: 'test-worker.js' };
    await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
    await writeFile(join(extension, 'test-worker.js'), workerSource);
    context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const errors = [];
    worker.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 1100 });
    page.on('pageerror', error => errors.push(error.message));
    const id = new URL(worker.url()).host;
    await page.goto(`chrome-extension://${id}/src/times/times.html`);
    const root = page.locator('#clockoli-times-root');
    await page.locator('#activity-view-switcher').getByRole('button', { name: view, exact: true }).click();
    await expect.poll(() => worker.evaluate(() => globalThis.reads.length)).toBeGreaterThan(0);
    await expect(root.locator('.calendar-week-loading')).toBeHidden();
    await page.waitForTimeout(700);
    const taskClass = view === 'Calendar' ? 'calendar-task' : 'task';
    const viewportClass = view === 'Calendar' ? 'calendar-viewport' : 'viewport';
    const source = root.locator(`.${taskClass}[data-task-key="entry:source"]`).first();
    await expect(source).toBeVisible();
    await source.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'center' }));
    if (view === 'Timeline') {
      const initial = await source.boundingBox();
      await page.mouse.move(initial.x + initial.width / 2, initial.y + initial.height / 2);
      await page.keyboard.down('Control');
      await page.mouse.wheel(0, -500);
      await page.keyboard.up('Control');
      await source.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'center' }));
    }
    const box = await source.boundingBox();
    const viewport = await root.locator(`.${viewportClass}`).boundingBox();
    expect(box && viewport).toBeTruthy();
    const before = await root.locator('.week-navigation-label').textContent();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const hovered = await source.boundingBox();
    await page.mouse.move(hovered.x + hovered.width / 2, hovered.y + hovered.height / 2);
    await page.mouse.down();
    const edgeViewport = await root.locator(`.${viewportClass}`).boundingBox();
    const edgeY = edgeViewport.y + edgeViewport.height / 2;
    await page.mouse.move(1, edgeY, { steps: 8 });
    await page.waitForTimeout(850);
    await expect(root.locator('.week-navigation-label')).toHaveText(before);
    await expect(root.locator(`.${taskClass}[data-task-key="entry:neighbor"]`)).toHaveCount(0);
    await page.mouse.up();
    await expect(root.locator('.week-navigation-label')).toHaveText(before);
    const outcome = await worker.evaluate(() => ({ edits: globalThis.edits, weekStart: monday.getTime() }));
    const nextWeek = new Date(outcome.weekStart);
    nextWeek.setDate(nextWeek.getDate() + 7);
    for (const edit of outcome.edits) {
      expect(new Date(edit.edits.startedAt).getTime()).toBeGreaterThanOrEqual(outcome.weekStart);
      expect(new Date(edit.edits.endedAt).getTime()).toBeLessThanOrEqual(nextWeek.getTime());
    }
    await root.getByRole('button', { name: 'Previous week' }).click();
    await expect(root.locator('.week-navigation-label')).not.toHaveText(before);
    await expect(root.locator(`.${taskClass}[data-task-key="entry:neighbor"]`)).toBeVisible();
    if (view === 'Timeline') {
      const lastHour = root.locator('.task[data-task-key="entry:boundary"]');
      await lastHour.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'center' }));
      await lastHour.click();
      await page.keyboard.press('ArrowLeft');
      await expect.poll(() => worker.evaluate(() => globalThis.edits.filter(edit => edit.original.id === 'boundary').length))
        .toBe(1);
      const edit = await worker.evaluate(() => globalThis.edits.find(edit => edit.original.id === 'boundary'));
      expect(new Date(edit.edits.endedAt) - new Date(edit.edits.startedAt)).toBe(3600000);
    }
    expect(errors).toEqual([]);
  } finally {
    await context?.close();
    await rm(extension, { recursive: true, force: true });
    await rm(profile, { recursive: true, force: true });
  }
});
