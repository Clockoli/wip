import { test, expect, chromium } from '@playwright/test';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url);
const testWorker = `
globalThis.openedAt = null;
globalThis.startedAt = null;
globalThis.rejectOpen = false;
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.type === 'START_DEVICE_FLOW') globalThis.startedAt = Date.now();
  const responses = {
    GET_ONBOARDING_STATE: { ready: false, appConfigured: true, auth: null, destinations: [] },
    RESUME_DEVICE_FLOW: null,
    GET_PAGE_STATE: { configured: false, active: null, pendingWrites: [] },
    GET_LOCAL_PREFERENCES: { rates: {}, invoicing: { clients: [] }, projects: [], recentDays: 7, revision: 0 },
    GET_ADDON_SETTINGS: {},
    START_DEVICE_FLOW: { attemptId: 'synthetic-attempt', userCode: 'ABCD-1234', verificationUri: 'https://github.com/login/device', expiresAt: Date.now() + 900000, nextPollAt: Date.now() + 900000, status: 'pending' },
    OPEN_DEVICE_FLOW_PAGE: { opened: true },
  };
  if (message.type === 'OPEN_DEVICE_FLOW_PAGE' && globalThis.rejectOpen) {
    respond({ ok: false, error: { message: 'Tab could not open' } });
    return;
  }
  if (message.type === 'OPEN_DEVICE_FLOW_PAGE') globalThis.openedAt = Date.now();
  if (Object.hasOwn(responses, message.type)) respond({ ok: true, data: responses[message.type] });
  else respond({ ok: false, error: { message: 'Unexpected test request' } });
});
`;

test('device handoff explains the countdown, handles manual opening and clipboard failure', async () => {
  test.setTimeout(80000);
  const extension = await mkdtemp(join(tmpdir(), 'clockoli-device-extension-'));
  const profile = await mkdtemp(join(tmpdir(), 'clockoli-device-profile-'));
  let context;
  try {
    await cp(new URL('src/', ROOT), join(extension, 'src'), { recursive: true });
    const manifest = JSON.parse(await readFile(new URL('manifest.json', ROOT), 'utf8'));
    manifest.background = { service_worker: 'test-worker.js' };
    await writeFile(join(extension, 'manifest.json'), `${JSON.stringify(manifest)}\n`);
    await writeFile(join(extension, 'test-worker.js'), testWorker);
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await context.addInitScript(() => {
      navigator.clipboard.writeText = async text => { window.testCopiedCode = text; };
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    worker.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/src/options/options.html`);
    await page.setViewportSize({ width: 320, height: 700 });
    await expect(page.locator('#authorize')).toBeVisible();
    const isMac = await page.evaluate(() => /mac|iphone|ipad|ipod/i.test(navigator.userAgentData?.platform || navigator.platform));
    const pasteShortcut = isMac ? '⌘V' : 'Ctrl+V';
    const copyShortcut = isMac ? '⌘C' : 'Ctrl+C';
    await expect(page.locator('#device-initial-paste-shortcut')).toHaveText(pasteShortcut);
    await page.locator('#authorize').click();
    await expect(page.locator('#device-copy-status')).toHaveText('✓ Code copied to your clipboard.');
    const instruction = page.locator('#device-handoff-status');
    const countdown = page.locator('#device-handoff-countdown');
    const code = page.locator('#device-code');
    await expect(code).toHaveValue('ABCD-1234');
    await expect(instruction).toHaveText('When GitHub opens, paste the code with ' + pasteShortcut + ' and authorize Clockoli.');
    await expect(countdown).toBeVisible();
    await expect(countdown).toContainText('Opening GitHub automatically in 3 seconds');
    await expect(page.locator('#open-device-page')).toHaveText('Open GitHub now');
    await expect(page.locator('#device-done')).toHaveCount(0);
    const style = await instruction.evaluate(node => {
      const css = getComputedStyle(node);
      return { fontWeight: Number(css.fontWeight), leftBorder: parseFloat(css.borderLeftWidth),
        background: css.backgroundColor, color: css.color };
    });
    expect(style.fontWeight).toBeGreaterThanOrEqual(700);
    expect(style.leftBorder).toBeGreaterThanOrEqual(3);
    expect(style.background).not.toBe('rgba(0, 0, 0, 0)');
    expect(await page.evaluate(() => window.testCopiedCode)).toBe('ABCD-1234');
    expect(await code.evaluate(el => { const box = el.getBoundingClientRect(); return box.top >= 0 && box.bottom <= window.innerHeight; })).toBe(true);
    expect(await page.locator('.device-handoff-track span').evaluate(el => getComputedStyle(el).animationName)).toBe('device-handoff-shrink');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await worker.evaluate(() => globalThis.openedAt)).toBeNull();
    await expect.poll(() => worker.evaluate(() => globalThis.openedAt), { timeout: 6500 }).toBeGreaterThan(0);
    expect((await worker.evaluate(() => globalThis.openedAt)) - (await worker.evaluate(() => globalThis.startedAt))).toBeGreaterThanOrEqual(2800);
    await expect(countdown).toBeHidden();
    await expect(instruction).toHaveText('On GitHub, paste the code with ' + pasteShortcut + ' and authorize Clockoli.');
    await expect(page.locator('#device-wait')).toContainText('Waiting for GitHub authorization');
    await expect(page.locator('#open-device-page')).toHaveText('Reopen GitHub');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await worker.evaluate(() => { globalThis.openedAt = null; globalThis.startedAt = null; });
    await page.reload();
    await page.locator('#authorize').click();
    await expect(countdown).toBeVisible();
    expect(await page.locator('.device-handoff-track span').evaluate(el => getComputedStyle(el).animationName)).toBe('none');
    await expect(code).toHaveValue('ABCD-1234');
    await expect.poll(() => worker.evaluate(() => globalThis.openedAt), { timeout: 6500 }).toBeGreaterThan(0);

    // Using the link during the countdown must cancel the scheduled automatic tab.
    await worker.evaluate(() => { globalThis.openedAt = null; globalThis.startedAt = null; });
    await page.reload();
    await page.evaluate(() => document.getElementById('open-device-page').addEventListener('click', event => event.preventDefault()));
    await page.locator('#authorize').click();
    await expect(countdown).toBeVisible();
    await page.locator('#open-device-page').click();
    await expect(countdown).toBeHidden();
    await expect(page.locator('#open-device-page')).toHaveText('Reopen GitHub');
    await expect(page.locator('#device-wait')).toContainText('Waiting for GitHub authorization');
    await page.waitForTimeout(3300);
    expect(await worker.evaluate(() => globalThis.openedAt)).toBeNull();

    // If the user opens GitHub while copying is still pending, do not open a duplicate tab.
    await worker.evaluate(() => { globalThis.openedAt = null; globalThis.startedAt = null; });
    await page.reload();
    await page.evaluate(() => {
      navigator.clipboard.writeText = () => new Promise(resolve => { window.finishDeviceCopy = resolve; });
      document.getElementById('open-device-page').addEventListener('click', event => event.preventDefault());
    });
    await page.locator('#authorize').click();
    await expect(code).toHaveValue('ABCD-1234');
    await page.waitForFunction(() => typeof window.finishDeviceCopy === 'function');
    await page.locator('#open-device-page').click();
    await page.evaluate(() => window.finishDeviceCopy());
    await expect(page.locator('#device-copy-status')).toHaveText('✓ Code copied to your clipboard.');
    await expect(countdown).toBeHidden();
    await page.waitForTimeout(3300);
    expect(await worker.evaluate(() => globalThis.openedAt)).toBeNull();

    await worker.evaluate(() => { globalThis.openedAt = null; globalThis.startedAt = null; });
    await page.reload();
    await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error('Clipboard denied'); }; });
    await page.locator('#authorize').click();
    await expect(page.locator('#device-code')).toHaveValue('ABCD-1234');
    await expect(page.locator('#device-copy-status')).toContainText('Code not copied yet');
    await expect(page.locator('#device-handoff-status')).toHaveText('Copy the code, then open GitHub.');
    await page.waitForTimeout(3300);
    expect(await worker.evaluate(() => globalThis.openedAt)).toBeNull();
    await expect(page.locator('#open-device-page')).toBeVisible();
    await page.locator('#copy-code').click();
    await expect(page.locator('#device-copy-status')).toContainText(copyShortcut);
    await expect(page.locator('#device-handoff-status')).toHaveText('Copy the selected code, then open GitHub.');
    const selection = await page.locator('#device-code').evaluate(node => ({ value: node.value, start: node.selectionStart, end: node.selectionEnd }));
    expect(selection.end - selection.start).toBe(selection.value.length);
    await page.evaluate(() => { navigator.clipboard.writeText = async text => { window.testCopiedCode = text; }; });
    await page.locator('#copy-code').click();
    await expect(page.locator('#device-copy-status')).toHaveText('✓ Code copied to your clipboard.');
    await expect(page.locator('#device-handoff-status')).toHaveText('Open GitHub below, then paste the code with ' + pasteShortcut + ' and authorize Clockoli.');
    expect(await worker.evaluate(() => globalThis.openedAt)).toBeNull();

    await worker.evaluate(() => { globalThis.openedAt = null; globalThis.rejectOpen = true; });
    await page.reload();
    await page.locator('#authorize').click();
    await expect(page.locator('#device-handoff-status')).toContainText('GitHub could not open automatically', { timeout: 7000 });
    await expect(countdown).toBeHidden();
    await expect(page.locator('#open-device-page')).toHaveText('Open GitHub to enter code');
    await expect(page.locator('#device-wait')).not.toContainText('Waiting for GitHub authorization');
    await expect(page.locator('#open-device-page')).toBeVisible();
    expect(await worker.evaluate(() => globalThis.openedAt)).toBeNull();

    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true });
      Object.defineProperty(navigator, 'userAgentData', { value: { platform: 'macOS' }, configurable: true });
    });
    await worker.evaluate(() => { globalThis.rejectOpen = false; });
    await page.reload();
    await expect(page.locator('#device-initial-paste-shortcut')).toHaveText('⌘V');
    await page.locator('#authorize').click();
    await expect(page.locator('#device-copy-status')).toHaveText('✓ Code copied to your clipboard.');
    await expect(page.locator('#device-handoff-status')).toHaveText('When GitHub opens, paste the code with ⌘V and authorize Clockoli.');
    expect(errors).toEqual([]);
  } finally {
    await context?.close();
    await rm(extension, { recursive: true, force: true });
    await rm(profile, { recursive: true, force: true });
  }
});
