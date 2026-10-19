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

async function testExtensionDirectory(workerSource = testWorker) {
  const directory = await mkdtemp(join(tmpdir(), 'clockoli-clockify-functional-'));
  await cp(new URL('src/', ROOT), join(directory, 'src'), { recursive: true });
  const manifest = JSON.parse(await readFile(new URL('manifest.json', ROOT), 'utf8'));
  manifest.host_permissions = [...manifest.host_permissions, ...manifest.optional_host_permissions];
  delete manifest.optional_host_permissions;
  manifest.background = { service_worker: 'test-worker.js' };
  await Promise.all([
    writeFile(join(directory, 'manifest.json'), `${JSON.stringify(manifest)}\n`),
    writeFile(join(directory, 'test-worker.js'), workerSource),
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
      headless: true,
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

test('migration preview recovers a pending job and shows its final outcome without exposing report entries', async () => {
  const workerSource = `
    let checks = 0;
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'GET_CLOCKIFY_MIGRATION_PREVIEW') {
        checks++;
        const users = [{ userId: 'mock-user-1', displayName: 'Mock User', entryCount: 1 }];
        const id = '01234567-89ab-4cde-8f01-23456789abcd';
        const outcomes = [{ sourceUserId: 'mock-user-1', status: 'imported', githubUser: { id: 42, login: 'mock-user' } }];
        const data = checks < 3
          ? { pending: { id, users, outcomes: [], completedUsers: 0, totalUsers: 1, blocked: false } }
          : { outcome: { id, users, outcomes } };
        sendResponse({ ok: true, data }); return;
      }
      sendResponse({ ok: true, data: { users: [], destinationId: null } });
    });`;
  const extensionDirectory = await testExtensionDirectory(workerSource);
  const profileDirectory = await mkdtemp(join(tmpdir(), 'clockoli-clockify-resume-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(profileDirectory, {
      channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${extensionDirectory}`, `--load-extension=${extensionDirectory}`],
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/src/clockify-migration/preview.html`);
    await expect(page.getByText('The saved migration is continuing.', { exact: false })).toBeVisible();
    await expect(page.getByText('Migration completed for 1 user.')).toBeVisible({ timeout: 12000 });
    expect(await page.locator('body').innerText()).not.toContain('Mock migration entry');
    expect(errors).toEqual([]);
  } finally {
    await context?.close();
    await rm(extensionDirectory, { recursive: true, force: true });
    await rm(profileDirectory, { recursive: true, force: true });
  }
});

test('a live partial result keeps the error heading after completed progress renders', async () => {
  const workerSource = `
    let checks = 0;
    chrome.runtime.onMessage.addListener((message, sender, respond) => {
      if (message.type === 'GET_CLOCKIFY_MIGRATION_PREVIEW') {
        checks++;
        const id = '01234567-89ab-4cde-8f01-23456789abcd';
        const users = [{ userId: 'person', displayName: 'Person', entryCount: 1 }];
        respond({ ok: true, data: checks === 1 ? { pending: {
          id, users, outcomes: [], completedUsers: 0, totalUsers: 1, blocked: false,
        } } : { outcome: {
          id, users,
          outcomes: [{ sourceUserId: 'person', status: 'failed', failureReason: 'record_write_failed' }],
        } } }); return;
      }
      respond({ ok: true, data: { users: [], destinationId: null } });
    });`;
  const extensionDirectory = await testExtensionDirectory(workerSource);
  const profileDirectory = await mkdtemp(join(tmpdir(), 'clockoli-clockify-partial-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(profileDirectory, {
      channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${extensionDirectory}`, `--load-extension=${extensionDirectory}`],
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const page = await context.newPage();
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/src/clockify-migration/preview.html`);
    await expect(page.locator('#message')).toContainText('Migration finished with errors:', { timeout: 12000 });
    await expect(page.locator('#import-status-title')).toHaveText('Migration finished with errors');
  } finally {
    await context?.close();
    await rm(extensionDirectory, { recursive: true, force: true });
    await rm(profileDirectory, { recursive: true, force: true });
  }
});

test('real extension IndexedDB atomically claims and checkpoints a migration across page reload', async () => {
  const extensionDirectory = await testExtensionDirectory();
  const profileDirectory = await mkdtemp(join(tmpdir(), 'clockoli-clockify-indexeddb-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(profileDirectory, {
      channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${extensionDirectory}`, `--load-extension=${extensionDirectory}`],
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const page = await context.newPage();
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/src/clockify-migration/preview.html`);
    const claimed = await page.evaluate(async () => {
      const { IndexedDbBackend } = await import('../storage/chrome-store.js');
      const { createClockifyMigrationSessionService, CLOCKIFY_MIGRATION_PREVIEW_KEY } = await import('../services/clockify-migration-session.js');
      const { createClockifyMigrationJobService, CLOCKIFY_MIGRATION_JOB_KEY } = await import('../services/clockify-migration-job.js');
      const databaseName = `clockoli-migration-atomic-test-${crypto.randomUUID()}`;
      const backend = new IndexedDbBackend(indexedDB, databaseName);
      const session = createClockifyMigrationSessionService({ storageSession: {
        get: async key => (await backend.getMany([key]))[key],
        set: async (key, value) => backend.setMany({ [key]: value }),
        remove: async key => backend.deleteMany([key]),
      } });
      const id = (await session.create({ users: [{ userId: 'test-person', displayName: 'Test', entryCount: 1 }], entries: [{
        provider: 'clockify', entryId: 'test-entry', userId: 'test-person', startedAt: '2026-09-01T08:00:00.000Z',
        endedAt: '2026-09-01T09:00:00.000Z', timezone: 'UTC', duration: 3600,
        projectId: 'test-project', project: 'Project', task: 'Task', description: '', tags: [], billable: false,
      }] })).id;
      await createClockifyMigrationJobService({ backend }).claim(id, [{ sourceUserId: 'test-person', githubLogin: 'tester' }], {
        destinationId: 'github:18', repoId: 18, owner: 'test-owner', repo: 'times', branch: 'clockoli/users/42',
        defaultBranch: 'main', actorId: 42, login: 'tester', authGeneration: 0,
      });
      const stored = await backend.getMany([CLOCKIFY_MIGRATION_PREVIEW_KEY, CLOCKIFY_MIGRATION_JOB_KEY]);
      return { id, databaseName, previewGone: !stored[CLOCKIFY_MIGRATION_PREVIEW_KEY], jobPresent: Boolean(stored[CLOCKIFY_MIGRATION_JOB_KEY]) };
    });
    expect(claimed).toMatchObject({ previewGone: true, jobPresent: true });
    await page.reload();
    const result = await page.evaluate(async ({ id, databaseName }) => {
      const { IndexedDbBackend } = await import('../storage/chrome-store.js');
      const { createClockifyMigrationJobService, CLOCKIFY_MIGRATION_JOB_KEY } = await import('../services/clockify-migration-job.js');
      const backend = new IndexedDbBackend(indexedDB, databaseName);
      const jobs = createClockifyMigrationJobService({ backend });
      const restored = await jobs.load();
      await jobs.checkpoint(id, { sourceUserId: 'test-person', status: 'imported', added: 1, alreadyPresent: 0,
        githubUser: { id: 42, login: 'tester' } });
      await jobs.finish(id);
      const stored = await backend.getMany([CLOCKIFY_MIGRATION_JOB_KEY, 'clockify-migration-import-outcome-v1']);
      return { restored: restored?.id === id, removed: !stored[CLOCKIFY_MIGRATION_JOB_KEY],
        outcome: stored['clockify-migration-import-outcome-v1']?.outcomes?.[0]?.status };
    }, claimed);
    expect(result).toEqual({ restored: true, removed: true, outcome: 'imported' });
  } finally {
    await context?.close();
    await rm(extensionDirectory, { recursive: true, force: true });
    await rm(profileDirectory, { recursive: true, force: true });
  }
});

for (const reason of ['mapping_unresolved', 'connection_changed']) {
test(`blocked migration (${reason}) offers explicit repair and reloads the restored preview`, async () => {
  const workerSource = `
    let repaired = false;
    chrome.runtime.onMessage.addListener((message, sender, respond) => {
      const id = '01234567-89ab-4cde-8f01-23456789abcd';
      if (message.type === 'GET_CLOCKIFY_MIGRATION_PREVIEW') {
        respond({ ok: true, data: repaired
          ? { id: '123e4567-e89b-42d3-a456-426614174000', users: [{ userId: 'person', displayName: 'Person', entryCount: 1 }], entries: 1 }
          : { pending: { id, users: [{ userId: 'person', displayName: 'Person', entryCount: 1 }], outcomes: [],
              completedUsers: 0, totalUsers: 1, blocked: true, blockedReason: '${reason}' } } }); return;
      }
      if (message.type === 'RESTORE_CLOCKIFY_MIGRATION_PREVIEW' && sender.url.endsWith('/src/clockify-migration/preview.html') && message.id === id) {
        repaired = true; respond({ ok: true, data: { id: '123e4567-e89b-42d3-a456-426614174000' } }); return;
      }
      respond({ ok: true, data: { users: [], destinationId: null } });
    });`;
  const extensionDirectory = await testExtensionDirectory(workerSource);
  const profileDirectory = await mkdtemp(join(tmpdir(), 'clockoli-clockify-repair-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(profileDirectory, {
      channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${extensionDirectory}`, `--load-extension=${extensionDirectory}`],
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/src/clockify-migration/preview.html`);
    await expect(page.getByRole('button', { name: 'Edit GitHub mappings' })).toBeVisible();
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Edit GitHub mappings' }).click();
    await expect(page.getByRole('button', { name: 'Import completed time' })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await context?.close();
    await rm(extensionDirectory, { recursive: true, force: true });
    await rm(profileDirectory, { recursive: true, force: true });
  }
});
}
