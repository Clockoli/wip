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
const day = value => [value.getFullYear(), String(value.getMonth() + 1).padStart(2, '0'), String(value.getDate()).padStart(2, '0')].join('-');
const record = (id, start, title) => ({ id, taskUrl: 'https://github.com/acme/app/issues/42', taskTitle: title,
  entryDate: day(start), timezone: 'UTC', startedAt: start.toISOString(), endedAt: new Date(start.getTime() + 3600000).toISOString(),
  durationSeconds: 3600, _path: 'times/' + day(start).slice(0, 7) + '/alice.jsonl', _sha: 'fixture', _index: 0, destinationId: 'fixture' });
const entries = [record('source', source, 'Drag me'), record('neighbor', target, 'Leave me')];
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

for (const view of ['Calendar', 'Timeline']) test(`Activity ${view} drags to the screen edge, loads the adjacent week, and queues one move`, async () => {
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
    await root.getByRole('button', { name: view, exact: true }).click();
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
    await expect(root.locator('.week-navigation-label')).not.toHaveText(before, { timeout: 7000 });
    await expect(root.locator(`.${taskClass}[data-task-key="entry:neighbor"]`)).toBeVisible();
    if (view === 'Timeline') {
      const days = await root.locator('.day-band').evaluateAll(bands => {
        const viewport = bands[0]?.closest('.viewport')?.getBoundingClientRect();
        return bands.filter(band => { const rect = band.getBoundingClientRect();
          return viewport && rect.width > 0 && rect.left >= viewport.left - 2 && rect.right <= viewport.right + 2;
        }).length;
      });
      expect(days, 'the destination Monday–Sunday week should fit in the viewport while dragging').toBeGreaterThanOrEqual(7);
    }
    const destination = await root.locator(`.${viewportClass}`).boundingBox();
    await page.mouse.move(destination.x + destination.width * 0.75, destination.y + destination.height / 2, { steps: 8 });
    const preview = root.locator(`.${taskClass}[data-task-key="entry:source"]`).first();
    await expect(preview, 'the dragged record should appear in the destination grid before release').toBeVisible();
    await expect(preview).toHaveClass(/clockoli-week-preview/);
    expect(await worker.evaluate(() => globalThis.edits.length)).toBe(0);
    const previewStart = Number(await preview.getAttribute('data-preview-start'));
    await page.mouse.up();
    await expect.poll(() => worker.evaluate(() => globalThis.edits.length)).toBe(1);
    await expect(preview, 'the accepted move should stay visible without reloading').toBeVisible();
    if (view === 'Timeline') {
      const width = await root.locator('.day-band').first().evaluate(band => band.getBoundingClientRect().width);
      const viewportWidth = (await root.locator('.viewport').boundingBox()).width;
      expect(width, 'releasing should restore the original, closer Timeline zoom').toBeGreaterThan(viewportWidth / 7);
    }
    const outcome = await worker.evaluate(() => ({ edit: globalThis.edits[0], neighbor: entries[1], reads: globalThis.reads.length }));
    expect(outcome.edit.original.id).toBe('source');
    expect(new Date(outcome.edit.edits.startedAt).getTime()).toBe(previewStart);
    expect(new Date(outcome.edit.edits.endedAt) - new Date(outcome.edit.edits.startedAt)).toBe(3600000);
    expect(new Date(outcome.edit.edits.endedAt) <= new Date(outcome.neighbor.startedAt)
      || new Date(outcome.edit.edits.startedAt) >= new Date(outcome.neighbor.endedAt)).toBe(true);
    expect(outcome.reads).toBeGreaterThan(1);
    expect(errors).toEqual([]);
  } finally {
    await context?.close();
    await rm(extension, { recursive: true, force: true });
    await rm(profile, { recursive: true, force: true });
  }
});
