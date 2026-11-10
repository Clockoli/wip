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
globalThis.deviceAttempt = null;
globalThis.authorizedAgain = false;
globalThis.rejectNextPoll = false;
globalThis.failNextOnboardingRead = false;
globalThis.expired = false;
globalThis.reauthorizedExternally = false;
globalThis.accessStillRejected = false;
globalThis.silentPromotion = false;
globalThis.removalMode = 'denied';
globalThis.removedCollaborator = false;
globalThis.blockSignout = false;
globalThis.blockDiscovery = false;
globalThis.savedWidth = 'contained';
globalThis.rateLimited = false;
globalThis.mockConfigured = false;
const originalAccessExpiry = Date.now() - 60_000;
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  globalThis.requests.push(message.type);
  if (message.type === 'START_DEVICE_FLOW') globalThis.deviceAttempt = {
    attemptId: 'reconnect-attempt', userCode: 'ABCD-1234',
    verificationUri: 'https://github.com/login/device', expiresAt: Date.now() + 900000,
    nextPollAt: Date.now() + 900000, status: 'pending',
  };
  if (message.type === 'POLL_DEVICE_FLOW' && globalThis.authorizedAgain) {
    globalThis.deviceAttempt = null;
    globalThis.expired = false;
  }
  if (message.type === 'POLL_DEVICE_FLOW' && globalThis.rejectNextPoll) {
    globalThis.deviceAttempt = null;
    sendResponse({ ok: false, error: { code: 'invalid_device_flow', message: 'GitHub rejected this Clockoli authorization attempt. Start again.' } });
    return;
  }
  if (message.type === 'REMOVE_REPOSITORY_USER') {
    if (globalThis.removalMode === 'denied') {
      sendResponse({ ok: false, error: { message: 'GitHub denied removing this collaborator' } });
    } else {
      globalThis.removedCollaborator = globalThis.removalMode === 'removed';
      sendResponse({ ok: true, data: { status: 'removed', login: 'Member' } });
    }
    return;
  }
  if (message.type === 'GET_ONBOARDING_STATE' && globalThis.failNextOnboardingRead) {
    globalThis.failNextOnboardingRead = false;
    sendResponse({ ok: false, error: { code: 'temporary_failure', message: 'Temporary onboarding read failure' } });
    return;
  }
  if (message.type === 'DISCONNECT_GITHUB_APP' && globalThis.blockSignout) {
    sendResponse({ ok: false, error: { message: 'Stop the active timer before changing GitHub authentication.' } });
    return;
  }
  if (message.type === 'DISCOVER_REPOSITORIES' && globalThis.blockDiscovery) {
    sendResponse({ ok: true, data: { blocked: {
      code: 'migration_blocked', message: 'Stop the active timer before changing GitHub authentication.',
    } } });
    return;
  }
  if (message.type === 'SET_INTERFACE_WIDTH') {
    globalThis.savedWidth = message.width;
    sendResponse({ ok: true, data: { preferences: { interfaceWidth: globalThis.savedWidth } } });
    return;
  }
  if (message.type === 'GET_PAGE_STATE' && message.refresh && globalThis.expired
      && (!globalThis.reauthorizedExternally || globalThis.accessStillRejected)) {
    sendResponse({ ok: false, error: { code: 'auth_expired', message: 'Clockoli could not renew GitHub access.' } });
    return;
  }
  if (message.type === 'GET_PAGE_STATE' && message.refresh && globalThis.rateLimited) {
    sendResponse({ ok: false, error: { code: 'rate_limit', retryAt: '2026-11-09T16:35:15.000Z',
      message: 'GitHub API rate limit exceeded.' } });
    return;
  }
  const onboardingState = {
    ready: true, appConfigured: true, auth: { mode: 'github_app', githubLogin: 'octocat',
      accessTokenExpiresAt: globalThis.reauthorizedExternally ? originalAccessExpiry + 28_800_000 : originalAccessExpiry },
    candidateAuth: globalThis.authorizedAgain && !globalThis.silentPromotion ? { mode: 'github_app', githubLogin: 'octocat' } : null,
    config: { owner: 'acme', repo: 'time-data', branch: 'main', recentDays: 7 },
    verificationStatus: 'write_verified', destinations,
  };
  const responses = {
    GET_ONBOARDING_STATE: onboardingState,
    RESUME_DEVICE_FLOW: globalThis.deviceAttempt,
    START_DEVICE_FLOW: globalThis.deviceAttempt,
    POLL_DEVICE_FLOW: globalThis.authorizedAgain
      ? { status: 'authorized', githubUserId: 42, githubLogin: 'octocat' } : globalThis.deviceAttempt,
    OPEN_DEVICE_FLOW_PAGE: { opened: true },
    GET_STATE: { configured: true, active: null, pendingWrites: [] },
    GET_PAGE_STATE: { configured: globalThis.expired || globalThis.authorizedAgain || globalThis.mockConfigured,
      active: null, pendingWrites: [] },
    GET_LOCAL_PREFERENCES: { rates: {}, invoicing: { clients: [] }, projects: [], recentDays: 7,
      revision: 0, interfaceWidth: globalThis.savedWidth },
    GET_ADDON_SETTINGS: {},
    DISCOVER_REPOSITORIES: { ...(globalThis.silentPromotion ? { onboardingState } : {}), repositories: [{
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
    CHECK_REPOSITORY_INVITE_ACCESS: { canInvite: true },
    LOAD_REPOSITORY_COLLABORATORS: {
      users: globalThis.removedCollaborator ? [] : [{ id: 42, login: 'Member', avatarUrl: null }],
      hasMore: !globalThis.removedCollaborator,
      moreUsers: globalThis.removedCollaborator ? [] : [{ id: 44, login: 'OtherMember', avatarUrl: null }],
      avatarUsers: [{ login: 'Member', avatarUrl: null },
        { login: 'octocat', avatarUrl: 'https://avatars.githubusercontent.com/u/43?v=4' }],
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
      channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${extensionDirectory}`, `--load-extension=${extensionDirectory}`],
    });
    const browserErrors = [];
    context.on('console', entry => { if (entry.type() === 'error') browserErrors.push(entry.text()); });
    context.on('pageerror', error => browserErrors.push(error.message));
    await context.route('https://avatars.githubusercontent.com/u/43?v=4', route => route.fulfill({
      status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="12" fill="#88aaff"/></svg>',
    }));
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const page = await context.newPage();
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/src/options/options.html`);
    await expect(page.locator('.time-repository')).toHaveCount(2);
    return { page, worker, context, extensionDirectory, profileDirectory, browserErrors };
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

// The real GitHub tab is not opened by this synthetic worker. Simulate the user
// opening it and returning to Settings, which triggers the automatic check.
async function returnFromGitHub(page) {
  await page.evaluate(() => document.getElementById('open-device-page').addEventListener('click', event => event.preventDefault()));
  await page.locator('#open-device-page').click();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
}

test('Add time repository scrolls to the repository setup heading', async () => {
  const fixture = await openOptions();
  try {
    const { page, browserErrors } = fixture;
    await page.setViewportSize({ width: 1280, height: 720 });
    await expect(page.locator('#repository-step')).toBeHidden();
    await page.locator('#add-time-repository').click();
    await expect(page.locator('#repository-step-title')).toBeVisible();
    const top = await page.locator('#repository-step-title').evaluate(node => node.getBoundingClientRect().top);
    expect(top).toBeGreaterThanOrEqual(-1);
    expect(top).toBeLessThan(12);
    expect(browserErrors).toEqual([]);
  } finally { await closeOptions(fixture); }
});

test('Settings stays centered when Interface width is full', async () => {
  const fixture = await openOptions();
  try {
    const { page, worker, browserErrors } = fixture;
    const control = page.locator('#interface-width');
    await expect(control).toHaveValue('contained');
    await control.selectOption('full');
    await expect(page.locator('#interface-width-feedback')).toHaveText('Interface width saved.');
    expect(await page.evaluate(() => localStorage.getItem('clockoli-interface-width'))).toBe('full');
    for (const width of [2200, 1440, 390]) {
      await page.setViewportSize({ width, height: 850 });
      await page.reload();
      await expect(control).toHaveValue('full');
      expect(await page.evaluate(() => ({ mode: document.documentElement.dataset.clockoliWidth,
        main: document.querySelector('main.settings-main').getBoundingClientRect().width,
        mainLeft: document.querySelector('main.settings-main').getBoundingClientRect().left,
        status: document.querySelector('#running-status .running-status-row').getBoundingClientRect().width,
        statusLeft: document.querySelector('#running-status .running-status-row').getBoundingClientRect().left,
        overflow: document.documentElement.scrollWidth > innerWidth })))
        .toEqual({ mode: undefined, main: Math.min(1280, width - (width <= 700 ? 24 : 48)),
          mainLeft: (width - Math.min(1280, width - (width <= 700 ? 24 : 48))) / 2,
          status: Math.min(1440, width), statusLeft: (width - Math.min(1440, width)) / 2,
          overflow: false });
    }
    expect(await worker.evaluate(() => globalThis.savedWidth)).toBe('full');
    await page.setViewportSize({ width: 2200, height: 850 });
    await page.goto(new URL('../tasks/tasks.html', page.url()).href);
    await expect(page.locator('html')).toHaveAttribute('data-clockoli-width', 'full');
    expect(await page.locator('main').evaluate(node => node.getBoundingClientRect().width)).toBe(2152);
    await page.goto(new URL('../options/options.html', page.url()).href);
    await expect(page.locator('#interface-width')).toHaveValue('full');
    expect(await page.locator('main.settings-main').evaluate(node => node.getBoundingClientRect().width)).toBe(1280);
    expect(browserErrors).toEqual([]);
  } finally { await closeOptions(fixture); }
});

test('rate-limited GitHub refresh retains local status and explains the retry', async () => {
  const fixture = await openOptions();
  try {
    const { page, worker, browserErrors } = fixture;
    await worker.evaluate(() => { globalThis.mockConfigured = true; globalThis.rateLimited = true; });
    await page.reload();
    await expect(page.locator('.running-status-error')).toContainText('GitHub rate limit reached');
    await expect(page.locator('.running-status-error')).not.toContainText('Could not load tracking status');
    await expect(page.locator('.running-status-error')).toContainText('retry after');
    await page.waitForTimeout(5_200);
    await expect(page.locator('.running-status-error')).toContainText('GitHub rate limit reached');
    await worker.evaluate(() => { globalThis.rateLimited = false; });
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(page.locator('.running-status-error')).toBeHidden();
    expect(browserErrors).toEqual([]);
  } finally { await closeOptions(fixture); }
});

test('connected account shows one status badge opposite GitHub account', async () => {
  const fixture = await openOptions();
  try {
    const { page, worker, browserErrors } = fixture;
    for (const width of [1280, 390, 320]) {
      await page.setViewportSize({ width, height: 800 });
      await expect(page.locator('#connection-status')).toBeVisible();
      await expect(page.locator('#connection-status')).toHaveText('Connected');
      await expect(page.locator('#connected-status')).toHaveCount(0);
      const layout = await page.evaluate(() => {
        const rect = selector => document.querySelector(selector).getBoundingClientRect();
        const heading = rect('#connection-title'), badge = rect('#connection-status'), card = rect('.connection-card');
        return { width: innerWidth, direction: getComputedStyle(document.querySelector('.connection-card .card-heading')).flexDirection,
          headingRight: heading.right, headingTop: heading.top, badgeLeft: badge.left,
          badgeTop: badge.top, badgeRight: badge.right, cardRight: card.right,
          badgeInHeading: document.querySelector('#connection-status').parentElement.classList.contains('card-heading'),
          accountBadges: document.querySelectorAll('.account-summary .badge').length };
      });
      expect(layout.badgeInHeading).toBe(true);
      expect(layout.accountBadges).toBe(0);
      expect(layout.badgeLeft, JSON.stringify(layout)).toBeGreaterThanOrEqual(layout.headingRight);
      expect(Math.abs(layout.badgeTop - layout.headingTop)).toBeLessThan(12);
      expect(layout.badgeRight).toBeLessThanOrEqual(layout.cardRight);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await worker.evaluate(() => { globalThis.expired = true; });
    await page.reload();
    await expect(page.locator('#connection-status')).toBeVisible();
    await expect(page.locator('#connection-status')).toHaveText('Sign-in required');
    await expect(page.locator('#connected')).toBeHidden();
    expect(browserErrors).toEqual([]);
  } finally { await closeOptions(fixture); }
});

test('active-timer authentication warning stays inside the GitHub account section', async () => {
  const fixture = await openOptions();
  try {
    const { page, worker, browserErrors } = fixture;
    await worker.evaluate(() => { globalThis.blockSignout = true; });
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#disconnect').click();
    await expect(page.locator('#message')).toHaveText('Stop the active timer before changing GitHub authentication.');
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 800 });
      const layout = await page.evaluate(() => {
        const box = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
        const notice = document.querySelector('#message');
        return { position: getComputedStyle(notice).position, notice: box('#message'),
          account: box('.account-summary'), actions: box('.account-actions'),
          section: box('.connection-card'), repositories: box('#time-repositories'),
          scrollWidth: document.documentElement.scrollWidth };
      });
      expect(layout.position).not.toBe('fixed');
      expect(layout.notice.y).toBeGreaterThanOrEqual(layout.account.bottom);
      expect(layout.notice.bottom).toBeLessThanOrEqual(layout.actions.y);
      expect(layout.notice.x).toBeGreaterThanOrEqual(layout.section.x);
      expect(layout.notice.right).toBeLessThanOrEqual(layout.section.right);
      expect(layout.notice.bottom).toBeLessThanOrEqual(layout.repositories.y);
      expect(layout.scrollWidth).toBeLessThanOrEqual(width);
    }
    await expect(page.locator('#connected-account')).toHaveText('@octocat');
    await worker.evaluate(() => { globalThis.blockSignout = false; });
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#disconnect').click();
    await expect(page.locator('#message')).toHaveText('Unexpected test request');
    expect(await page.locator('#message').evaluate(node => getComputedStyle(node).position)).toBe('fixed');
    expect(browserErrors).toEqual([]);
  } finally { await closeOptions(fixture); }
});

test('blocked authorization has one compact account warning, not a duplicate repository message', async () => {
  const fixture = await openOptions();
  try {
    const { page, worker, browserErrors } = fixture;
    await worker.evaluate(() => { globalThis.authorizedAgain = true; globalThis.blockDiscovery = true; });
    await page.reload();
    await expect(page.locator('#message')).toHaveText('Stop the active timer before changing GitHub authentication.');
    await expect(page.locator('#setup-ready-summary')).not.toContainText('Stop the active timer');
    await expect(page.locator('#finish-setup')).toBeDisabled();
    expect(await page.locator('#message').evaluate(node =>
      node.previousElementSibling?.id === 'connected' && node.nextElementSibling?.id === 'connected-actions')).toBe(true);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 800 });
      const style = await page.locator('#message').evaluate(node => {
        const css = getComputedStyle(node);
        const swatch = document.createElement('span');
        swatch.style.backgroundColor = 'var(--bgColor-danger-muted)';
        swatch.style.color = 'var(--fgColor-danger)';
        document.body.append(swatch);
        const dangerBackground = getComputedStyle(swatch).backgroundColor;
        const dangerAccent = getComputedStyle(swatch).color;
        swatch.remove();
        return { width: node.getBoundingClientRect().width, position: css.position,
          background: css.backgroundColor, gradient: css.backgroundImage,
          leftBorder: css.borderLeftWidth, rightBorder: css.borderRightWidth,
          leftBorderColor: css.borderLeftColor, iconColor: getComputedStyle(node, '::before').color,
          opacity: css.opacity, mask: css.maskImage, dangerBackground, dangerAccent,
          overflow: document.documentElement.scrollWidth > innerWidth };
      });
      expect(style.width).toBeLessThanOrEqual(Math.min(640, width));
      expect(style.position).toBe('static');
      expect(style.gradient).toContain(style.dangerBackground);
      expect(style.gradient).toMatch(/linear-gradient\(.*rgba\(0, 0, 0, 0\) 100%\)/);
      expect(style.background).toBe('rgba(0, 0, 0, 0)');
      expect(style.leftBorder).toBe('3px');
      expect(style.rightBorder).toBe('0px');
      expect(style.leftBorderColor).toBe(style.dangerAccent);
      expect(style.iconColor).toBe(style.dangerAccent);
      expect(style.opacity).toBe('1');
      expect(style.mask).toBe('none');
      expect(style.overflow).toBe(false);
    }
    await worker.evaluate(() => { globalThis.blockDiscovery = false; });
    await page.locator('#add-time-repository').click();
    await expect(page.locator('#message')).toBeEmpty();
    await expect(page.locator('#setup-ready-summary')).not.toContainText('Stop the active timer');
    expect(browserErrors).toEqual([]);
  } finally { await closeOptions(fixture); }
});

test('connected account can reauthorize without signing out or losing its repositories', async () => {
  const fixture = await openOptions();
  try {
    const { page, worker } = fixture;
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(page.locator('#reconnect-github')).toBeVisible();
    await expect(page.locator('#connected-account')).toHaveText('@octocat');
    await page.locator('#reconnect-github').click();
    await expect(page.locator('#device-panel')).toBeVisible();
    await expect(page.locator('#device-step')).toBeVisible();
    await expect(page.locator('#device-code')).toHaveValue('ABCD-1234');
    await expect(page.locator('.time-repository')).toHaveCount(2);
    expect(await worker.evaluate(() => globalThis.requests)).not.toContain('DISCONNECT_GITHUB_APP');
    await page.reload();
    await expect(page.locator('#device-panel')).toBeVisible();
    await expect(page.locator('#device-step')).toBeVisible();
    await worker.evaluate(() => { globalThis.authorizedAgain = true; });
    await returnFromGitHub(page);
    await expect(page.locator('#device-panel')).toBeHidden();
    await expect(page.locator('#connected-account')).toHaveText('@octocat');
    await expect(page.locator('.time-repository')).toHaveCount(2);
    expect(await worker.evaluate(() => globalThis.requests)).not.toContain('DISCONNECT_GITHUB_APP');
  } finally { await closeOptions(fixture); }
});

test('an authorized attempt survives a transient onboarding read failure without polling it again', async () => {
  const fixture = await openOptions();
  try {
    const { page, worker } = fixture;
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await worker.evaluate(() => { globalThis.expired = true; });
    await page.reload();
    await expect(page.locator('#reauth-required')).toBeVisible();
    await page.locator('#authorize').click();
    await expect(page.locator('#device-panel')).toBeVisible();
    await worker.evaluate(() => {
      globalThis.authorizedAgain = true;
      globalThis.failNextOnboardingRead = true;
    });
    await returnFromGitHub(page);
    // A completed authorization can already clear the sign-in warning while
    // the repository step remains open; both states are valid after recovery.
    await expect(page.locator('#connection-status')).toHaveText(/^(Checking repository access|Connected)$/);
    await expect(page.locator('#repository-step')).toBeVisible();
    await expect(page.locator('.time-repository')).toHaveCount(2);
    await page.waitForTimeout(5_200);
    expect(await worker.evaluate(() => globalThis.requests.filter(type => type === 'POLL_DEVICE_FLOW').length)).toBe(1);
    await page.reload();
    await expect(page.locator('#repository-step')).toBeVisible();
    await expect(page.locator('.time-repository')).toHaveCount(2);
  } finally { await closeOptions(fixture); }
});

test('renewal failure opens sign-in immediately without a duplicate status error', async () => {
  const fixture = await openOptions();
  try {
    const { page, worker } = fixture;
    await expect(page.locator('#reauth-required')).toBeHidden();
    await worker.evaluate(() => { globalThis.expired = true; });
    await page.reload();
    await expect(page.locator('#reauth-required')).toBeVisible();
    await expect(page.locator('#setup-progress')).toHaveCount(1);
    await expect(page.locator('#setup-progress')).toBeHidden();
    await expect(page.locator('#device-step')).toBeVisible();
    await expect(page.locator('#authorize')).toBeVisible();
    await expect(page.locator('#authorize')).toHaveText('Sign in again with GitHub');
    await expect(page.locator('#connection-status')).toHaveText('Sign-in required');
    await expect(page.locator('#connected')).toBeHidden();
    await expect(page.locator('#connected-actions')).toBeHidden();
    await expect(page.locator('.running-status-error')).toBeHidden();
    expect(await worker.evaluate(() => globalThis.requests)).not.toContain('START_DEVICE_FLOW');
    await page.waitForTimeout(5_200);
    await expect(page.locator('#reauth-required')).toBeVisible();
    await page.locator('#authorize').click();
    await expect(page.locator('#device-step')).toBeVisible();
    await expect(page.locator('#device-code')).toHaveValue('ABCD-1234');
    await expect(page.locator('.time-repository')).toHaveCount(2);
    await worker.evaluate(() => { globalThis.authorizedAgain = true; });
    await returnFromGitHub(page);
    await expect(page.locator('#reauth-required')).toBeHidden();
    await expect(page.locator('#connected')).toBeVisible();
    await expect(page.locator('#connected-actions')).toBeVisible();
    await expect(page.locator('#connection-status')).toHaveText('Connected');
    expect(await worker.evaluate(() => globalThis.requests)).not.toContain('DISCONNECT_GITHUB_APP');
  } finally { await closeOptions(fixture); }
});

test('sign-in required closes itself when another tab restores GitHub access', async () => {
  const fixture = await openOptions();
  try {
    const { page, worker, browserErrors } = fixture;
    await worker.evaluate(() => { globalThis.expired = true; });
    await page.reload();
    await expect(page.locator('#reauth-required')).toBeVisible();
    await worker.evaluate(() => { globalThis.reauthorizedExternally = true; });
    await expect(page.locator('#reauth-required')).toBeHidden({ timeout: 12_000 });
    await expect(page.locator('#connected')).toBeVisible();
    await expect(page.locator('#connection-status')).toHaveText('Connected');
    await expect(page.locator('.time-repository')).toHaveCount(2);
    const requests = await worker.evaluate(() => globalThis.requests);
    expect(requests).not.toContain('START_DEVICE_FLOW');
    expect(requests).not.toContain('DISCONNECT_GITHUB_APP');
    expect(browserErrors).toEqual([]);
  } finally { await closeOptions(fixture); }
});

test('new local authorization does not dismiss sign-in before GitHub access works', async () => {
  const fixture = await openOptions();
  try {
    const { page, worker } = fixture;
    await worker.evaluate(() => { globalThis.expired = true; });
    await page.reload();
    await expect(page.locator('#reauth-required')).toBeVisible();
    await worker.evaluate(() => {
      globalThis.reauthorizedExternally = true;
      globalThis.accessStillRejected = true;
    });
    await page.waitForTimeout(5_500);
    await expect(page.locator('#reauth-required')).toBeVisible();
    await expect(page.locator('#connection-status')).toHaveText('Sign-in required');
    const requests = await worker.evaluate(() => globalThis.requests);
    expect(requests).not.toContain('DISCONNECT_GITHUB_APP');
  } finally { await closeOptions(fixture); }
});

test('authorized device flow waiting for repository validation is not called sign-in required', async () => {
  const fixture = await openOptions();
  try {
    const { page, worker } = fixture;
    await worker.evaluate(() => { globalThis.expired = true; globalThis.authorizedAgain = true; });
    await page.reload();
    await expect(page.locator('#reauth-required')).toBeHidden();
    await expect(page.locator('#connection-status')).toHaveText('Checking repository access');
    await expect(page.locator('#connection-status')).toBeVisible();
    await expect(page.locator('#repository-step')).toBeVisible();
    await expect(page.locator('.time-repository')).toHaveCount(2);
  } finally { await closeOptions(fixture); }
});

test('silent repository promotion closes a stale sign-in state', async () => {
  const fixture = await openOptions();
  try {
    const { page, worker } = fixture;
    await worker.evaluate(() => { globalThis.expired = true; globalThis.authorizedAgain = true; });
    await page.reload();
    await expect(page.locator('#connection-status')).toHaveText('Checking repository access');
    const priorDiscovery = await worker.evaluate(() => globalThis.requests.filter(type => type === 'DISCOVER_REPOSITORIES').length);
    await worker.evaluate(() => { globalThis.reauthorizedExternally = true; globalThis.silentPromotion = true; });
    await expect.poll(() => worker.evaluate(() => globalThis.requests.filter(type => type === 'DISCOVER_REPOSITORIES').length),
      { timeout: 8_000 }).toBeGreaterThan(priorDiscovery);
    await expect(page.locator('#connection-status')).toHaveText('Connected', { timeout: 10_000 });
    await expect(page.locator('#onboarding')).toBeHidden();
    await expect(page.locator('.time-repository')).toHaveCount(2);
  } finally { await closeOptions(fixture); }
});

test('rejected reconnect attempt offers a new code without signing out or endless polling', async () => {
  const fixture = await openOptions();
  try {
    const { page, worker } = fixture;
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('#reconnect-github').click();
    await expect(page.locator('#device-panel')).toBeVisible();
    await worker.evaluate(() => { globalThis.rejectNextPoll = true; });
    await returnFromGitHub(page);
    await expect(page.locator('#message')).toContainText('Start again.');
    await expect(page.locator('#device-panel')).toBeHidden();
    await expect(page.locator('#reconnect-github')).toBeEnabled();
    await expect(page.locator('#connected-account')).toHaveText('@octocat');
    expect(await worker.evaluate(() => globalThis.requests)).not.toContain('DISCONNECT_GITHUB_APP');
  } finally { await closeOptions(fixture); }
});

async function expectReadOnlyRequests(worker) {
  const requests = await worker.evaluate(() => globalThis.requests);
  expect(requests.length).toBeGreaterThan(0);
  expect(requests.every(type => [
    'GET_STATE', 'GET_ONBOARDING_STATE', 'RESUME_DEVICE_FLOW', 'GET_PAGE_STATE', 'GET_LOCAL_PREFERENCES',
    'GET_ADDON_SETTINGS', 'LOAD_TASKS', 'LOAD_REPOSITORY_COLLABORATORS',
  ].includes(type)), `Unexpected request types: ${requests.join(', ')}`).toBe(true);
}

test('Disconnect repository clearly explains browser-local effects and Cancel leaves the connection intact', async () => {
  const fixture = await openOptions();
  try {
    const { page, worker } = fixture;
    const repository = page.locator('.time-repository').first();
    await repository.locator(':scope > summary').click();
    const repositoryName = await repository.locator('.repository-card-heading h3').textContent();
    await repository.locator('.remove-destination').click();
    const confirmation = repository.locator('.repository-removal');
    await expect(confirmation).toBeVisible();
    await expect(confirmation.locator('h4')).toHaveText('Disconnect time repository?');
    await expect(confirmation.locator('.repository-removal-name strong')).toHaveText(repositoryName);
    await expect(confirmation).toContainText('This will remove the repository from Clockoli in this browser.');
    await expect(confirmation).toContainText("Your tracked time and GitHub repository will not be deleted. Other team members won't be affected.");
    await expect(confirmation).toContainText('You can reconnect this repository later.');
    await expect(confirmation.getByRole('button', { name: 'Disconnect repository' })).toBeVisible();
    await confirmation.getByRole('button', { name: 'Cancel' }).click();
    await expect(confirmation).toBeHidden();
    await expect(repository).toHaveAttribute('open', '');
    expect(await worker.evaluate(() => globalThis.requests)).not.toContain('REMOVE_DESTINATION');
  } finally { await closeOptions(fixture); }
});

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
    const existing = page.locator('.existing-repository-option');
    const create = page.locator('.new-repository-option');
    await expect(page.locator('#choose-create-repository')).toBeVisible();
    await expect(page.locator('#choose-join-team')).toBeVisible();
    await expect(existing).toBeHidden();
    await page.locator('#choose-create-repository').click();
    await expect(create.getByRole('link', { name: 'Create a new time repository' })).toBeVisible();
    await expect(existing).toBeHidden();
    expect(await create.locator('.new-repository-action').evaluate(node => getComputedStyle(node).animationName)).toBe('none');
    await page.locator('#change-repository-path').click();
    await page.locator('#choose-join-team').click();
    await expect(existing).toBeVisible();
    await expect(create).toBeHidden();
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
    expect(await page.locator('#join-invitation-panel').isVisible()).toBe(false);
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
    await expect(status).toContainText('Enter a valid Clockoli invitation link, GitHub repository URL, or owner/name.');
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(await worker.evaluate(() => globalThis.requests.filter(type => type === 'INSPECT_REPOSITORY').length)).toBe(1);
    await input.fill('acme/check-example');
    await input.press('Enter');
    await expect(status).toHaveText('Checked. Ready, but not connected yet. Select "Connect repository" below to start using it.');
    expect(await worker.evaluate(() => globalThis.requests.filter(type => type === 'INSPECT_REPOSITORY').length)).toBe(2);
    expect(errors).toEqual([]);
  } finally { await closeOptions(fixture); }
});

test('Copy invitation link and switching browser tabs preserve the expanded repository and teammate controls', async () => {
  const fixture = await openOptions();
  try {
    const { page, context } = fixture;
    const repository = page.locator('.time-repository').first();
    await repository.locator(':scope > summary').click();
    await repository.locator('.repository-add-teammate').click();
    const invitation = repository.locator('.teammate-instructions');
    await expect(invitation.getByRole('button', { name: 'Send invitation to the repository' })).toBeVisible();
    await expect(invitation).toBeVisible();
    await expect(invitation).toHaveAttribute('open', '');
    await invitation.locator('.teammate-setup > summary').click();
    const copy = invitation.getByRole('button', { name: 'Copy Clockoli invitation message' });
    await expect(copy).toBeVisible();
    await expect(invitation.getByRole('button', { name: 'Copy instructions' })).toHaveCount(0);
    await copy.click();
    await expect(invitation.locator('.teammate-invitation-link .form-feedback')).not.toBeEmpty();
    await expect(repository).toHaveAttribute('open', '');
    await expect(invitation).toHaveAttribute('open', '');
    const other = await context.newPage();
    await other.goto('about:blank');
    await page.bringToFront();
    await expect(repository).toHaveAttribute('open', '');
    await expect(invitation).toBeVisible();
    await expect(invitation.locator('.teammate-setup')).toHaveAttribute('open', '');
    await other.close();
  } finally { await closeOptions(fixture); }
});

test('More collaborators expands the additional GitHub accounts in Settings', async () => {
  const fixture = await openOptions();
  try {
    const { page } = fixture;
    const repository = page.locator('.time-repository').first();
    await repository.locator(':scope > summary').click();
    const more = repository.locator('.repository-collaborator-more');
    await expect(more.locator('summary')).toContainText('More collaborators');
    await expect(more).not.toHaveAttribute('title');
    await more.locator('summary').click();
    await expect(more).toHaveAttribute('open', '');
    await expect(more.locator('.repository-team-member-identity strong')).toHaveText('@OtherMember');
    await expect(more.locator('.repository-member-actions-button')).toHaveCount(1);
  } finally { await closeOptions(fixture); }
});

test('Team member menu closes on outside click without requesting access removal', async () => {
  const fixture = await openOptions();
  try {
    const { page } = fixture;
    const row = page.locator('.time-repository').first();
    await row.locator('.repository-heading-title').click();
    const trigger = row.locator('.repository-member-actions-button').first();
    const menu = row.locator('.repository-collaborators > .repository-team-member .repository-avatar-actions');
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(menu).toBeVisible();
    await page.locator('#connection-title').click();
    await expect(menu).toBeHidden();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(row).toHaveAttribute('open', '');
    await expectReadOnlyRequests(fixture.worker);
  } finally { await closeOptions(fixture); }
});

test('Remove teammate reports GitHub failures and inherited access next to the team, then updates the roster', async () => {
  const fixture = await openOptions();
  try {
    const { page, worker } = fixture;
    const row = page.locator('.time-repository').first();
    await row.locator(':scope > summary').click();
    const menu = row.locator('.repository-collaborators > .repository-team-member .repository-member-actions-button');
    const feedback = row.locator('.repository-team > .repository-manage-feedback');
    await menu.click();
    page.once('dialog', dialog => dialog.accept());
    await row.getByRole('button', { name: 'Remove @Member' }).click();
    await expect(feedback).toBeVisible();
    await expect(feedback).toContainText('GitHub denied removing this collaborator');
    await expect(row.locator('.repository-collaborators > .repository-team-member')).toHaveCount(1);

    await worker.evaluate(() => { globalThis.removalMode = 'retained'; });
    page.once('dialog', dialog => dialog.accept());
    await row.getByRole('button', { name: 'Remove @Member' }).click();
    await expect(feedback).toContainText('still have repository access');
    await expect(feedback).toHaveClass(/warning/);
    await expect(row.locator('.repository-collaborators > .repository-team-member')).toHaveCount(1);

    await worker.evaluate(() => { globalThis.removalMode = 'removed'; });
    await menu.click();
    page.once('dialog', dialog => dialog.accept());
    await row.getByRole('button', { name: 'Remove @Member' }).click();
    await expect(feedback).toContainText('removed from the repository');
    await expect(feedback).toHaveClass(/success/);
    await expect(row.locator('.repository-collaborators > .repository-team-member')).toHaveCount(0);
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

test('Merge people keeps the selected avatar visible in Chromium without another collaborator read', async () => {
  const fixture = await openOptions();
  try {
    const { page, worker } = fixture;
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    worker.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.locator('#merge-task-destination').selectOption('github:20');
    await expect(page.locator('#merge-people-selected img')).toHaveAttribute('src', 'https://avatars.githubusercontent.com/u/43?v=4');
    await expect(page.locator('#merge-people-selected')).toHaveAttribute('aria-label', 'Selected people: octocat');
    const reads = (await worker.evaluate(() => globalThis.requests)).filter(type => type === 'LOAD_REPOSITORY_COLLABORATORS').length;
    await page.locator('#merge-people-filter').click();
    await expect(page.locator('#merge-people-list input:checked')).toHaveCount(1);
    await page.locator('#merge-people-all').click();
    await expect(page.locator('#merge-people-selected')).toHaveAttribute('aria-label', 'No people selected');
    await page.setViewportSize({ width: 375, height: 780 });
    expect(await page.locator('#merge-people-select').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    expect((await worker.evaluate(() => globalThis.requests)).filter(type => type === 'LOAD_REPOSITORY_COLLABORATORS').length).toBe(reads);
    await page.reload();
    await page.locator('#merge-task-destination').selectOption('github:20');
    await expect(page.locator('#merge-people-selected img')).toHaveAttribute('src', 'https://avatars.githubusercontent.com/u/43?v=4');
    expect(errors).toEqual([]);
  } finally { await closeOptions(fixture); }
});
