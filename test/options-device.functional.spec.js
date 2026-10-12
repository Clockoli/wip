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

test('code animates for two seconds then remains visible four seconds before GitHub opens', async () => {
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
      channel: 'chromium', headless: false,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    worker.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/src/options/options.html`);
    await page.setViewportSize({ width: 320, height: 700 });
    await expect(page.locator('#authorize')).toBeVisible();
    await page.locator('#authorize').click();
    const code = page.locator('#device-code');
    await expect.poll(() => code.inputValue(), { timeout: 1000 }).toMatch(/^A.{0,5}$/);
    expect(await worker.evaluate(() => globalThis.openedAt)).toBeNull();
    const fullCode = await page.waitForFunction(() => {
      if (document.querySelector('#device-code').value === 'ABCD-1234') return Date.now();
      return false;
    }, null, { polling: 'raf' });
    await expect(code).toHaveClass(/code-reveal/);
    const visibleAt = await fullCode.jsonValue();
    expect(visibleAt - await worker.evaluate(() => globalThis.startedAt)).toBeGreaterThanOrEqual(1800);
    expect(await code.evaluate(el => { const box = el.getBoundingClientRect(); return box.top >= 0 && box.bottom <= window.innerHeight; })).toBe(true);
    expect(await code.evaluate(el => getComputedStyle(el).animationName)).toBe('device-code-reveal');
    expect(await worker.evaluate(() => globalThis.openedAt)).toBeNull();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect.poll(() => worker.evaluate(() => globalThis.openedAt), { timeout: 6000 }).toBeGreaterThan(0);
    expect((await worker.evaluate(() => globalThis.openedAt)) - visibleAt).toBeGreaterThanOrEqual(3900);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await code.evaluate(el => getComputedStyle(el).animationName)).toBe('none');
    await worker.evaluate(() => { globalThis.openedAt = null; globalThis.startedAt = null; });
    await page.reload();
    await page.locator('#authorize').click();
    await expect(page.locator('#device-code')).toHaveValue('ABCD-1234');
    expect(await worker.evaluate(() => globalThis.openedAt)).toBeNull();
    await expect.poll(() => worker.evaluate(() => globalThis.openedAt), { timeout: 6000 }).toBeGreaterThan(0);
    expect((await worker.evaluate(() => globalThis.openedAt)) - (await worker.evaluate(() => globalThis.startedAt))).toBeGreaterThanOrEqual(3900);
    await worker.evaluate(() => { globalThis.openedAt = null; globalThis.startedAt = null; });
    await page.reload();
    await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error('Clipboard denied'); }; });
    await page.locator('#authorize').click();
    await expect(page.locator('#device-code')).toHaveValue('ABCD-1234');
    await expect(page.locator('#device-handoff-status')).toContainText('Copy the code');
    await expect.poll(() => worker.evaluate(() => globalThis.openedAt), { timeout: 6000 }).toBeGreaterThan(0);
    expect((await worker.evaluate(() => globalThis.openedAt)) - (await worker.evaluate(() => globalThis.startedAt))).toBeGreaterThanOrEqual(3900);
    await worker.evaluate(() => { globalThis.openedAt = null; globalThis.rejectOpen = true; });
    await page.reload();
    await page.locator('#authorize').click();
    await expect(page.locator('#device-handoff-status')).toContainText('Could not open GitHub automatically', { timeout: 7000 });
    await expect(page.locator('#open-device-page')).toBeVisible();
    expect(await worker.evaluate(() => globalThis.openedAt)).toBeNull();
    expect(errors).toEqual([]);
  } finally {
    await context?.close();
    await rm(extension, { recursive: true, force: true });
    await rm(profile, { recursive: true, force: true });
  }
});
