import { test, expect, chromium } from '@playwright/test';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url);
const pages = ['tasks/tasks.html', 'reports/reports.html', 'times/times.html', 'options/options.html'];

// Only the test worker owns the synthetic queue. The page must use GET_STATE.
const workerSource = `
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.type === 'GET_STATE') {
    chrome.storage.local.get('queue').then(({ queue = [] }) => respond({ ok: true, data: {
      configured: true, pendingWrites: queue, pendingCount: queue.length,
      credential: 'never render this',
    } }));
    return true;
  }
  const data = {
    GET_PAGE_STATE: { configured: false, active: null, pendingWrites: [], recent: [], pendingCount: 0 },
    GET_ONBOARDING_STATE: { ready: false },
    GET_LOCAL_PREFERENCES: { rates: {}, invoicing: { clients: [] }, projects: [], recentDays: 7, revision: 0 },
    GET_ADDON_SETTINGS: {},
    LOAD_TASKS: { configured: false, tasks: [] },
    LOAD_REPORT: { configured: false, records: [] },
    LOAD_TIMES: { configured: false, recent: [] },
  }[message.type];
  respond({ ok: data !== undefined, data, error: data === undefined ? { message: 'Unsupported fixture request' } : undefined });
});
`;

test('Activity tab shows the queue only while a conflict needs review across standalone pages', async () => {
  test.setTimeout(120000);
  const extension = await mkdtemp(join(tmpdir(), 'clockoli-pending-nav-extension-'));
  const profile = await mkdtemp(join(tmpdir(), 'clockoli-pending-nav-profile-'));
  let context;
  try {
    await cp(new URL('src/', ROOT), join(extension, 'src'), { recursive: true });
    const manifest = JSON.parse(await readFile(new URL('manifest.json', ROOT), 'utf8'));
    manifest.background = { service_worker: 'test-worker.js' };
    manifest.permissions = [...manifest.permissions, 'storage']; // Test-only durable queue fixture.
    await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
    await writeFile(join(extension, 'test-worker.js'), workerSource);
    context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    const errors = [];
    context.on('serviceworker', worker => {
      worker.on('console', message => { if (message.type() === 'error') errors.push(`worker: ${message.text()}`); });
      worker.on('pageerror', error => errors.push(`worker: ${error.message}`));
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    worker.on('console', message => { if (message.type() === 'error') errors.push(`worker: ${message.text()}`); });
    worker.on('pageerror', error => errors.push(`worker: ${error.message}`));
    const origin = `chrome-extension://${new URL(worker.url()).host}`;
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(`page: ${error.message}`));
    page.on('console', message => { if (message.type() === 'error') errors.push(`page: ${message.text()}`); });
    const queue = [{ status: 'pending' }, { status: 'conflict' }];
    await worker.evaluate(queue => chrome.storage.local.set({ queue }), queue);
    for (const path of pages) {
      await page.goto(`${origin}/src/${path}`);
      const activity = page.locator('.page-tab[href="../times/times.html"]');
      const badge = activity.locator('.pending-navigation-badge');
      await expect(badge).toBeVisible();
      await expect(badge).toContainText('2');
      await expect(badge).toContainText('!');
      await expect(activity).toHaveAttribute('aria-label', /Activity.*2 pending operations.*1 conflict/);
      await expect(page.locator('.page-tab:not([href="../times/times.html"]) .pending-navigation-badge')).toHaveCount(0);
      expect(await page.locator('body').innerText()).not.toContain('never render this');
      expect(await activity.getAttribute('href')).toBe('../times/times.html');
      expect(await badge.evaluate(node => getComputedStyle(node).display)).not.toBe('none');
    }
    // Terminate the worker target; a fresh GET_STATE starts it from durable storage.
    await worker.evaluate(() => chrome.storage.local.set({ queue: [{ status: 'pending' }] }));
    const cdp = await context.newCDPSession(page);
    const targets = await cdp.send('Target.getTargets');
    const target = targets.targetInfos.find(item => item.type === 'service_worker' && item.url === worker.url());
    expect(target).toBeTruthy();
    await cdp.send('Target.closeTarget', { targetId: target.targetId });
    await cdp.detach();
    await page.reload();
    const activity = page.locator('.page-tab[href="../times/times.html"]');
    await expect(activity.locator('.pending-navigation-badge')).toHaveCount(0);
    await expect(activity).not.toHaveAttribute('aria-label', /pending|conflict/);
    const freshWorker = context.serviceWorkers().find(item => item.url() === worker.url()) || await context.waitForEvent('serviceworker');
    await freshWorker.evaluate(() => chrome.storage.local.set({ queue: [{ status: 'pending' }, { status: 'conflict' }] }));
    await expect(activity.locator('.pending-navigation-badge')).toHaveText('2 !', { timeout: 12000 });
    await freshWorker.evaluate(() => chrome.storage.local.set({ queue: [] }));
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(activity.locator('.pending-navigation-badge')).toHaveCount(0);
    await expect(activity).not.toHaveAttribute('aria-label', /pending|conflict/);
    expect(errors).toEqual([]);
  } finally {
    await context?.close();
    await rm(extension, { recursive: true, force: true });
    await rm(profile, { recursive: true, force: true });
  }
});
