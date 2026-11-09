import { test, expect, chromium } from '@playwright/test';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url);
const workerSource = `
globalThis.opens = [];
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.type === 'OPEN_PREFERRED_SURFACE') {
    globalThis.opens.push({ senderUrl: sender.url, sourceUrl: sender.tab?.url, sourceTitle: sender.tab?.title });
    void (async () => {
      const url = chrome.runtime.getURL('src/times/times.html');
      const existing = (await chrome.tabs.query({ url }))[0];
      if (existing) await chrome.tabs.update(existing.id, { active: true });
      else await chrome.tabs.create({ url });
      respond({ ok: true, data: { opened: true } });
    })().catch(error => respond({ ok: false, error: { message: error.message } }));
    return true;
  }
  if (message.type === 'GET_PAGE_STATE' || message.type === 'GET_STATE') {
    respond({ ok: true, data: { configured: true, active: null, recent: [], pendingWrites: [], pendingCount: 0 } });
    return;
  }
  if (message.type === 'GET_ACTIVITY_VIEW_MODE') {
    respond({ ok: true, data: { mode: 'timeline' } }); return;
  }
  if (message.type === 'CONSUME_TOOLBAR_TASK_CONTEXT') {
    respond({ ok: true, data: { present: false, value: null } }); return;
  }
  respond({ ok: true, data: {} });
});
`;

test('GitHub Clockoli icon uses the tab-mode launcher without an overlay', async () => {
  const extension = await mkdtemp(join(tmpdir(), 'clockoli-github-launch-extension-'));
  const profile = await mkdtemp(join(tmpdir(), 'clockoli-github-launch-profile-'));
  let context;
  try {
    await cp(new URL('src/', root), join(extension, 'src'), { recursive: true });
    // Read controls inside the extension-owned Shadow DOM in this browser test.
    const rendererPath = join(extension, 'src/content/github.js');
    await writeFile(rendererPath, (await readFile(rendererPath, 'utf8')).replaceAll("mode: 'closed'", "mode: 'open'"));
    const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
    manifest.background = { service_worker: 'test-worker.js' };
    await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
    await writeFile(join(extension, 'test-worker.js'), workerSource);
    context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://github.com/acme/app/issues/42', route => route.fulfill({ status: 200,
      contentType: 'text/html',
      body: '<!doctype html><html><body><header><div class="AppHeader-actions"><img class="avatar" alt="User"></div></header><main><h1>Issue 42</h1></main></body></html>' }));
    await page.goto('https://github.com/acme/app/issues/42');
    const trigger = page.locator('#clockoli-root .trigger-main');
    await expect(trigger).toBeVisible();
    await trigger.click();
    const activityUrl = `chrome-extension://${new URL(worker.url()).host}/src/times/times.html`;
    await expect.poll(() => context.pages().filter(tab => tab.url() === activityUrl).length).toBe(1);
    await expect(page.getByRole('heading', { name: 'Issue 42' })).toBeVisible();
    await expect(page.locator('#clockoli-full-width-popup-root')).toHaveCount(0);
    const first = context.pages().find(tab => tab.url() === activityUrl);
    await trigger.click();
    await expect.poll(() => worker.evaluate(() => globalThis.opens.length)).toBe(2);
    expect(context.pages().filter(tab => tab.url() === activityUrl)).toEqual([first]);
    const opens = await worker.evaluate(() => globalThis.opens);
    expect(opens).toEqual([0, 1].map(() => ({
      senderUrl: 'https://github.com/acme/app/issues/42',
      sourceUrl: 'https://github.com/acme/app/issues/42',
      sourceTitle: expect.any(String),
    })));
    expect(errors).toEqual([]);
  } finally {
    await context?.close();
    await rm(extension, { recursive: true, force: true });
    await rm(profile, { recursive: true, force: true });
  }
});
