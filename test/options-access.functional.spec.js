import { test, expect, chromium } from '@playwright/test';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url);
const testWorker = `
const destinations = [
  { id: 'github:20', owner: 'acme', repo: 'time-data', installationId: 10 },
  { id: 'github:21', owner: 'acme', repo: 'a-very-long-repository-name-for-narrow-screens', installationId: 10 },
];
globalThis.requests = [];
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  globalThis.requests.push(message.type);
  const responses = {
    GET_ONBOARDING_STATE: {
      ready: true, appConfigured: true, auth: { mode: 'github_app', githubLogin: 'octocat' },
      config: { owner: 'acme', repo: 'time-data', branch: 'main', recentDays: 7 },
      verificationStatus: 'write_verified', destinations,
    },
    RESUME_DEVICE_FLOW: null,
    GET_PAGE_STATE: { configured: false, active: null, pendingWrites: [] },
    GET_LOCAL_PREFERENCES: { rates: {}, invoicing: { clients: [] }, projects: [], recentDays: 7, revision: 0 },
    GET_ADDON_SETTINGS: {},
    DISCOVER_REPOSITORIES: { repositories: [{
      installationId: 10, repoId: 22, owner: 'acme', repo: 'check-example',
      fullName: 'acme/check-example', eligible: true,
    }], installations: [] },
    INSPECT_REPOSITORY: { repository: {
      installationId: 10, repoId: 22, owner: 'acme', repo: 'check-example',
      fullName: 'acme/check-example', eligible: true, ready: true,
      state: 'initialized_member', canAdd: true,
    } },
    LOAD_TASKS: {
      tasks: [
        { taskUrl: 'KlimTodrik/clockoli-issues/6-Polish-the-Clockoli-GitHub-project-page-for-Launch-1', title: 'clockoli-issues — #6 Polish the Clockoli GitHub project page for Launch 1', destinationIds: ['github:20'] },
        { taskUrl: 'https://github.com/acme/app/issues/6', title: 'Tracked issue', destinationIds: ['github:20'] },
      ], currentUsers: { 'github:20': 'octocat' }, availableUsers: ['octocat'],
    },
    LOAD_REPOSITORY_COLLABORATORS: {
      users: [{ id: 42, login: 'Member', avatarUrl: null }], hasMore: false,
      pendingUsers: [], pendingHasMore: false,
    },
  };
  if (!Object.hasOwn(responses, message.type)) {
    sendResponse({ ok: false, error: { message: 'Unexpected test request' } });
    return;
  }
  sendResponse({ ok: true, data: responses[message.type] });
});
`;

async function openOptions() {
  const extensionDirectory = await mkdtemp(join(tmpdir(), 'clockoli-options-functional-'));
  const profileDirectory = await mkdtemp(join(tmpdir(), 'clockoli-options-profile-'));
  let context;
  try {
    await cp(new URL('src/', ROOT), join(extensionDirectory, 'src'), { recursive: true });
    const manifest = JSON.parse(await readFile(new URL('manifest.json', ROOT), 'utf8'));
    manifest.background = { service_worker: 'test-worker.js' };
    await Promise.all([
      writeFile(join(extensionDirectory, 'manifest.json'), `${JSON.stringify(manifest)}\n`),
      writeFile(join(extensionDirectory, 'test-worker.js'), testWorker),
    ]);
    context = await chromium.launchPersistentContext(profileDirectory, {
      channel: 'chromium', headless: false,
      args: [`--disable-extensions-except=${extensionDirectory}`, `--load-extension=${extensionDirectory}`],
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const page = await context.newPage();
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/src/options/options.html`);
    await expect(page.locator('.time-repository')).toHaveCount(2);
    return { page, worker, context, extensionDirectory, profileDirectory };
  } catch (error) {
    await context?.close();
    await rm(extensionDirectory, { recursive: true, force: true });
    await rm(profileDirectory, { recursive: true, force: true });
    throw error;
  }
}

async function closeOptions(fixture) {
  await fixture.context.close();
  await rm(fixture.extensionDirectory, { recursive: true, force: true });
  await rm(fixture.profileDirectory, { recursive: true, force: true });
}

async function expectReadOnlyRequests(worker) {
  const requests = await worker.evaluate(() => globalThis.requests);
  expect(requests.length).toBeGreaterThan(0);
  expect(requests.every(type => [
    'GET_ONBOARDING_STATE', 'RESUME_DEVICE_FLOW', 'GET_PAGE_STATE', 'GET_LOCAL_PREFERENCES',
    'GET_ADDON_SETTINGS', 'LOAD_TASKS', 'LOAD_REPOSITORY_COLLABORATORS',
  ].includes(type)), `Unexpected request types: ${requests.join(', ')}`).toBe(true);
}

test('repository disclosures rotate in Chromium and remain usable at narrow widths', async () => {
  const fixture = await openOptions();
  try {
    const { page } = fixture;
    await page.setViewportSize({ width: 320, height: 700 });
    const rows = page.locator('.time-repository');
    for (const row of await rows.all()) {
      const icon = row.locator('.repository-disclosure-icon');
      await expect(icon).toHaveAttribute('aria-hidden', 'true');
      await expect.poll(() => icon.evaluate(element => getComputedStyle(element).transform)).toBe('none');
      await row.locator(':scope > summary').click();
      await expect(row).toHaveAttribute('open', '');
      await expect.poll(() => icon.evaluate(element => getComputedStyle(element).transform)).toBe('matrix(-1, 0, 0, -1, 0, 0)');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await row.locator(':scope > summary').focus();
      await page.keyboard.press('Enter');
      await expect(row).not.toHaveAttribute('open', '');
      await expect.poll(() => icon.evaluate(element => getComputedStyle(element).transform)).toBe('none');
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expectReadOnlyRequests(fixture.worker);
  } finally { await closeOptions(fixture); }
});

test('repository field checks only on explicit Check or Enter, with visible action on narrow screens', async () => {
  const fixture = await openOptions();
  try {
    const { page, worker } = fixture;
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width: 320, height: 700 });
    await page.locator('#add-time-repository').click();
    const input = page.locator('#repository-target');
    const check = page.getByRole('button', { name: 'Check repository', exact: true });
    const status = page.locator('#repository-target-status');
    await expect(check).toBeVisible();
    await expect(check).toHaveText('Check');
    await expect(check).toBeDisabled();
    await input.fill('acme/check-example');
    await expect(check).toBeEnabled();
    await page.locator('#repository-step-title').click();
    await expect(status).toBeHidden();
    expect(await worker.evaluate(() => globalThis.requests.filter(type => type === 'DISCOVER_REPOSITORIES' || type === 'INSPECT_REPOSITORY'))).toEqual([]);
    const bounds = await page.evaluate(() => {
      const field = document.getElementById('repository-target').getBoundingClientRect();
      const action = document.getElementById('check-repository-target').getBoundingClientRect();
      return { fieldRight: field.right, buttonRight: action.right, buttonLeft: action.left,
        fieldLeft: field.left, documentWidth: document.documentElement.scrollWidth, viewportWidth: window.innerWidth };
    });
    expect(bounds.buttonRight).toBeLessThanOrEqual(bounds.fieldRight + 1);
    expect(bounds.buttonLeft).toBeGreaterThan(bounds.fieldLeft + 30);
    expect(bounds.documentWidth).toBeLessThanOrEqual(bounds.viewportWidth);
    await check.click();
    await expect(status).toHaveText('Checked. Ready, but not connected yet. Select "Connect repository" below to start using it.');
    const connect = page.locator('#connect-checked-repository');
    await expect(connect).toBeVisible();
    const appearance = locator => locator.evaluate(button => {
      const style = getComputedStyle(button);
      return { background: style.backgroundColor, color: style.color, border: style.borderTopColor };
    });
    await page.mouse.move(0, 0);
    expect(await appearance(check)).toEqual(await appearance(connect));
    await check.hover();
    const checkHover = await appearance(check);
    await connect.hover();
    expect(checkHover).toEqual(await appearance(connect));
    expect(await worker.evaluate(() => globalThis.requests.filter(type => type === 'INSPECT_REPOSITORY').length)).toBe(1);
    await input.fill('acme/');
    await page.locator('#repository-step-title').click();
    await expect(status).toBeHidden();
    await check.click();
    await expect(status).toContainText('Enter a valid GitHub repository URL or owner/name.');
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(await worker.evaluate(() => globalThis.requests.filter(type => type === 'INSPECT_REPOSITORY').length)).toBe(1);
    await input.fill('acme/check-example');
    await input.press('Enter');
    await expect(status).toHaveText('Checked. Ready, but not connected yet. Select "Connect repository" below to start using it.');
    expect(await worker.evaluate(() => globalThis.requests.filter(type => type === 'INSPECT_REPOSITORY').length)).toBe(2);
    expect(errors).toEqual([]);
  } finally { await closeOptions(fixture); }
});

test('repository avatar menu closes on outside click without requesting access removal', async () => {
  const fixture = await openOptions();
  try {
    const { page } = fixture;
    const row = page.locator('.time-repository').first();
    const avatar = row.locator('.repository-collaborator').first();
    const menu = row.locator('.repository-avatar-actions');
    await avatar.click();
    await expect(avatar).toHaveAttribute('aria-expanded', 'true');
    await expect(menu).toBeVisible();
    await page.locator('#connection-title').click();
    await expect(menu).toBeHidden();
    await expect(avatar).toHaveAttribute('aria-expanded', 'false');
    await expect(row).not.toHaveAttribute('open', '');
    await expectReadOnlyRequests(fixture.worker);
  } finally { await closeOptions(fixture); }
});

test('Merge tasks offers an imported identity only on the source side in Chromium', async () => {
  const fixture = await openOptions();
  try {
    const { page } = fixture;
    const errors = [];
    page.on('pageerror', error => errors.push(`page: ${error.message}`));
    fixture.worker.on('console', message => { if (message.type() === 'error') errors.push(`worker: ${message.text()}`); });
    await expect(page.locator('#merge-tasks')).toBeVisible();
    await page.locator('#merge-task-destination').selectOption('github:20');
    await expect(page.locator('#merge-source-list .merge-task-row')).toHaveCount(2);
    await expect(page.locator('#merge-target-list .merge-task-row')).toHaveCount(1);
    await page.locator('#merge-source-filter').fill('6-Polish-the-Clockoli');
    await page.locator('#merge-source-list .merge-task-row').click();
    await page.locator('#merge-target-list .merge-task-row').click();
    await expect(page.locator('#merge-queue-list .merge-queue-row')).toHaveCount(1);
    await expect(page.locator('#merge-tasks-submit')).toBeEnabled();
    await expectReadOnlyRequests(fixture.worker);
    expect(errors).toEqual([]);
  } finally { await closeOptions(fixture); }
});
