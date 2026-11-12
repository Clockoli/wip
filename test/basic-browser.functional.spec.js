import { test, expect, chromium } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('../', import.meta.url);

test('a clean Chromium profile opens the extension Settings and Activity pages', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'clockoli-public-smoke-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${root.pathname}`, `--load-extension=${root.pathname}`],
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const errors = [];
    worker.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    worker.on('close', () => errors.push('Service worker closed during smoke test'));
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    const origin = `chrome-extension://${new URL(worker.url()).host}`;
    await page.goto(`${origin}/src/options/options.html`);
    await expect(page.locator('#authorize')).toBeVisible();
    await page.goto(`${origin}/src/times/times.html`);
    await expect(page.locator('body')).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await context?.close();
    await rm(profile, { recursive: true, force: true });
  }
});
