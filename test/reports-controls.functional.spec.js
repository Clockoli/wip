import { test, expect, chromium } from '@playwright/test';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url);
const fixtureWorker = `
const record = { id: 'sample', taskUrl: 'https://example.com/task', taskTitle: 'Sample task',
  entryDate: '2026-10-08', timezone: 'UTC', startedAt: '2026-10-08T09:00:00Z', endedAt: '2026-10-08T10:00:00Z',
  durationSeconds: 3600, user: 'alice', destinationId: 'github:1', timeRepository: 'acme/time' };
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.type === 'GET_ONBOARDING_STATE') respond({ ok: true, data: { ready: true, config: { owner: 'acme', repo: 'time', branch: 'main' }, destinations: [] } });
  else if (message.type === 'GET_LOCAL_PREFERENCES') respond({ ok: true, data: { rates: {}, invoicing: { clients: [] }, projects: [], recentDays: 7, revision: 0 } });
  else if (message.type === 'GET_ADDON_SETTINGS') respond({ ok: true, data: {} });
  else if (message.type === 'LOAD_REPORT') respond({ ok: true, data: { configured: true, records: [record], pendingWrites: [], pendingCount: 0,
    remoteWriteConfirmed: true, sourceRepositories: ['acme/time'], currentUser: 'alice', currentUsers: { 'github:1': 'alice' }, partial: false, conflicts: [] } });
  else respond({ ok: true, data: { configured: true, active: null, pendingWrites: [], pendingCount: 0 } });
});
`;

test('Reports chart controls stay together above the chart and preserve selections', async () => {
  const extension = await mkdtemp(join(tmpdir(), 'clockoli-report-controls-'));
  const profile = await mkdtemp(join(tmpdir(), 'clockoli-report-controls-profile-'));
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
    worker.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    worker.on('pageerror', error => errors.push(error.message));
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/src/reports/reports.html`);
    await expect(page.locator('#report-content')).toBeVisible();
    const group = page.getByRole('combobox', { name: 'Group by' });
    const aggregate = page.getByRole('combobox', { name: 'Aggregate by' });
    const stack = page.getByRole('combobox', { name: 'Stack by' });
    await expect(group).toHaveValue('day');
    await expect(aggregate).toHaveValue('total-time');
    await expect(stack).toHaveValue('person');
    for (const width of [1280, 800, 400]) {
      await page.setViewportSize({ width, height: 900 });
      const layout = await page.evaluate(() => {
        const bounds = id => document.querySelector(id).getBoundingClientRect();
        const fields = ['#horizontal-axis', '#metric', '#stack-by'].map(bounds);
        const chart = bounds('#analytics-chart');
        return { fields: fields.map(rect => ({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom })),
          chartTop: chart.top, cardRight: bounds('#analytics-card').right, overflow: document.documentElement.scrollWidth > innerWidth };
      });
      expect(layout.overflow, `overflow at ${width}px`).toBe(false);
      expect(layout.fields.every(field => field.bottom < layout.chartTop), `controls above chart at ${width}px`).toBe(true);
      expect(layout.fields.every(field => field.right <= layout.cardRight), `controls inside card at ${width}px`).toBe(true);
      if (width > 640) {
        expect(layout.fields[0].top).toBe(layout.fields[1].top);
        expect(layout.fields[1].top).toBe(layout.fields[2].top);
        expect(layout.fields[0].left).toBeLessThan(layout.fields[1].left);
        expect(layout.fields[1].left).toBeLessThan(layout.fields[2].left);
      } else {
        expect(layout.fields[0].bottom).toBeLessThan(layout.fields[1].top);
        expect(layout.fields[1].bottom).toBeLessThan(layout.fields[2].top);
      }
      if (process.env.REPORT_SHOTS && (width === 1280 || width === 400)) {
        await mkdir(process.env.REPORT_SHOTS, { recursive: true });
        await page.locator('#analytics-card').screenshot({ path: join(process.env.REPORT_SHOTS, `reports-controls-${width}.png`) });
      }
    }
    await group.selectOption('week');
    await aggregate.selectOption('task-count');
    await stack.selectOption('repository');
    await expect(group).toHaveValue('week');
    await expect(aggregate).toHaveValue('task-count');
    await expect(stack).toHaveValue('repository');
    await expect(page.locator('#analytics-chart svg')).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await context?.close();
    await rm(extension, { recursive: true, force: true });
    await rm(profile, { recursive: true, force: true });
  }
});
