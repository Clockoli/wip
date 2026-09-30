import { test, expect, chromium } from '@playwright/test';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url);
const CLOCKIFY_REPORT_URL = 'https://app.clockify.me/reports/detailed?start=2026-01-01T00:00:00.000Z&end=2026-12-31T23:59:59.999Z&page=1&pageSize=200';
const REPORT_PATH = '/report/workspaces/mock-workspace/reports/detailed';

const rawReport = {
  timeentries: [{
    _id: 'mock-entry-1',
    userId: 'mock-user-1',
    userName: 'Mock User',
    userEmail: 'must-not-reach-extension@example.test',
    description: 'Mock migration entry',
    projectId: 'mock-project-1',
    projectName: 'Mock Project',
    taskId: 'mock-task-1',
    taskName: 'Mock Task',
    tags: [{ _id: 'mock-tag-1', name: 'Mock tag', privateValue: 'must-not-reach-extension' }],
    timeInterval: {
      start: '2026-06-15T09:00:00.000Z', end: '2026-06-15T10:00:00.000Z', duration: 3600, timeZone: 'UTC', privateValue: 'must-not-reach-extension',
    },
    privateValue: 'must-not-reach-extension',
  }],
  totals: [{ entriesCount: 1, totalTime: 3600, privateValue: 'must-not-reach-extension' }],
  privateValue: 'must-not-reach-extension',
};

const mockPage = `<!doctype html>
<html><body>
  <main><div id="toolbar" style="width: 900px; height: 48px"><button type="button">EXPORT</button></div></main>
  <script>
    const requestReport = () => fetch('${REPORT_PATH}')
      .catch(error => { document.body.dataset.fetchError = String(error); });
    new MutationObserver(() => {
      if (document.documentElement.getAttribute('data-clockoli-clockify-capture-arm') === 'armed') setTimeout(requestReport, 25);
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-clockoli-clockify-capture-arm'] });
  </script>
</body></html>`;

const testWorker = `
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return;
  const save = value => { globalThis.clockifyFunctionalMessage = value; return Promise.resolve(); };
  if (message.type === 'CLOCKIFY_IS_CAPTURE_ARMED') {
    sendResponse({ ok: true, data: { armed: false } });
    return;
  }
  if (message.type === 'CLOCKIFY_ARM_CAPTURE') {
    save({ type: message.type, senderUrl: sender.url }).then(() => sendResponse({
      ok: true,
      data: { capturing: true, nextYear: 2026, history: { yearsWithEntries: [2026], completedYears: 0, totalYears: 1 } },
    }));
    return true;
  }
  if (message.type === 'CLOCKIFY_CAPTURED_REPORT') {
    save({ type: message.type, senderUrl: sender.url, text: message.text }).then(() => sendResponse({
      ok: true,
      data: { captured: true, history: { completedYears: 1, totalYears: 1 } },
    }));
    return true;
  }
  sendResponse({ ok: true, data: {} });
});
`;

async function testExtensionDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'clockoli-clockify-functional-'));
  await cp(new URL('src/', ROOT), join(directory, 'src'), { recursive: true });
  const manifest = JSON.parse(await readFile(new URL('manifest.json', ROOT), 'utf8'));
  manifest.host_permissions = [...manifest.host_permissions, ...manifest.optional_host_permissions];
  delete manifest.optional_host_permissions;
  manifest.background = { service_worker: 'test-worker.js' };
  await Promise.all([
    writeFile(join(directory, 'manifest.json'), `${JSON.stringify(manifest)}\n`),
    writeFile(join(directory, 'test-worker.js'), testWorker),
  ]);
  return directory;
}

test('mock Clockify report injects the real migration controls and arms capture through the runtime boundary', async () => {
  const extensionDirectory = await testExtensionDirectory();
  const profileDirectory = await mkdtemp(join(tmpdir(), 'clockoli-clockify-profile-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(profileDirectory, {
      channel: 'chromium',
      headless: false,
      args: [`--disable-extensions-except=${extensionDirectory}`, `--load-extension=${extensionDirectory}`],
    });
    const page = await context.newPage();
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== 'https://app.clockify.me') return route.abort();
      if (url.pathname === '/reports/detailed') {
        return route.fulfill({ contentType: 'text/html', body: mockPage });
      }
      if (url.pathname === REPORT_PATH) {
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(rawReport) });
      }
      return route.fulfill({ status: 404, contentType: 'text/plain', body: 'mock route not found' });
    });

    await page.goto(CLOCKIFY_REPORT_URL);
    await expect(page.locator('#clockoli-clockify-capture-banner')).toBeVisible();
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await page.getByRole('button', { name: 'Migrate Clockify history page by page into Clockoli' }).click();

    await expect.poll(async () => worker.evaluate(() => ({ clockifyFunctionalMessage: globalThis.clockifyFunctionalMessage })))
      .toMatchObject({
        clockifyFunctionalMessage: {
          type: 'CLOCKIFY_ARM_CAPTURE',
          senderUrl: CLOCKIFY_REPORT_URL,
        },
      });
  } finally {
    await context?.close();
    await rm(extensionDirectory, { recursive: true, force: true });
    await rm(profileDirectory, { recursive: true, force: true });
  }
});
