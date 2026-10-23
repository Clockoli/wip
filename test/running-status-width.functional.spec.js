import { test, expect, chromium } from '@playwright/test';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url);

test('Reports, Top tasks and Settings stretch the running description without overflowing', async () => {
  test.setTimeout(90000);
  const extension = await mkdtemp(join(tmpdir(), 'clockoli-wide-description-extension-'));
  const profile = await mkdtemp(join(tmpdir(), 'clockoli-wide-description-profile-'));
  let context;
  try {
    await cp(new URL('src/', ROOT), join(extension, 'src'), { recursive: true });
    const manifest = JSON.parse(await readFile(new URL('manifest.json', ROOT), 'utf8'));
    manifest.background = { service_worker: 'test-worker.js' };
    await writeFile(join(extension, 'manifest.json'), `${JSON.stringify(manifest)}\n`);
    await writeFile(join(extension, 'test-worker.js'), `
      const startedAt = new Date(Date.now() - 120000).toISOString();
      chrome.runtime.onMessage.addListener((message, sender, respond) => {
        if (message.type === 'GET_PAGE_STATE') respond({ ok: true, data: {
          configured: true, active: { id: 'running', taskUrl: 'https://example.com/task',
            taskTitle: 'Misc communication', startedAt, description: '',
            entryDate: new Date().toISOString().slice(0, 10), timezone: 'UTC' },
          recent: [], pendingWrites: [], pendingCount: 0, todayTrackedMs: 0,
        } });
        else respond({ ok: false, error: { message: 'Unsupported fixture request' } });
      });
    `);
    context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const errors = [];
    worker.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    for (const path of ['reports/reports.html', 'tasks/tasks.html', 'options/options.html']) {
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 850 });
        await page.goto(`chrome-extension://${new URL(worker.url()).host}/src/${path}`);
        // Settings' unsupported fixture-only requests show a fixed error toast over the header.
        if (path.startsWith('options')) await page.locator('#message').evaluate(node => { node.style.display = 'none'; });
        const row = page.locator('#running-status.is-active .running-status-row');
        await expect(row.getByRole('textbox', { name: 'Description' })).toBeVisible();
        const geometry = await row.evaluate(node => {
          const description = node.querySelector('.running-status-description-field').getBoundingClientRect();
          const stats = node.querySelector('.running-status-stats').getBoundingClientRect();
          const bounds = node.getBoundingClientRect();
          return { width: description.width, rowWidth: bounds.width,
            gap: stats.left - description.right, above: description.bottom <= stats.top,
            overflow: document.documentElement.scrollWidth - innerWidth };
        });
        if (width === 1440) {
          expect(geometry.width).toBeGreaterThan(geometry.rowWidth * .35);
          expect(geometry.gap).toBeGreaterThanOrEqual(0);
          expect(geometry.gap).toBeLessThan(24);
        } else {
          expect(geometry.width).toBeGreaterThan(geometry.rowWidth * .85);
          expect(geometry.above).toBe(true);
        }
        expect(geometry.overflow).toBeLessThanOrEqual(1);
        const nav = await page.locator('.page-tabs').evaluate(node => {
          const brand = node.querySelector('.page-brand').getBoundingClientRect();
          const toggle = node.querySelector('.page-theme-toggle').getBoundingClientRect();
          return { brandRight: brand.right, toggleLeft: toggle.left, toggleRight: toggle.right,
            brandTop: brand.top, toggleTop: toggle.top, overflow: document.documentElement.scrollWidth - innerWidth };
        });
        expect(nav.toggleLeft).toBeGreaterThanOrEqual(nav.brandRight);
        expect(nav.toggleLeft - nav.brandRight).toBeLessThan(24);
        expect(Math.abs(nav.toggleTop - nav.brandTop)).toBeLessThan(12);
        expect(nav.overflow).toBeLessThanOrEqual(1);
        await expect(page.locator('.page-brand-controls > .page-brand')).toHaveCount(1);
        await page.locator('.page-brand').focus();
        await page.keyboard.press('Tab');
        await expect(page.locator('.page-theme-toggle')).toBeFocused();
        await expect(page.locator('.page-theme-toggle')).toHaveAttribute('aria-label', 'Switch to dark theme');
        await page.locator('.page-theme-toggle').click({ timeout: 5000 });
        await expect(page.locator('html')).toHaveAttribute('data-clockoli-theme', 'dark');
        await expect(page.locator('.page-theme-toggle')).toHaveAttribute('aria-label', 'Switch to light theme');
        await page.locator('.page-theme-toggle').click({ timeout: 5000 });
      }
    }
    expect(errors).toEqual([]);
  } finally {
    await context?.close();
    await rm(extension, { recursive: true, force: true });
    await rm(profile, { recursive: true, force: true });
  }
});
