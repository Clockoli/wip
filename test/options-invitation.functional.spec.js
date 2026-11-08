import { test, expect, chromium } from '@playwright/test';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url);
const testWorker = `
globalThis.authorized = false;
globalThis.requests = [];
const repository = {
  fullName: 'acme/time-data', owner: 'acme', repo: 'time-data',
  installationId: 10, repoId: 20, ownerType: 'Organization',
  state: 'initialized_joinable', eligible: true, canJoin: true, defaultBranch: 'main',
  private: true,
};
chrome.runtime.onMessage.addListener((request, _sender, respond) => {
  globalThis.requests.push(request.type);
  const state = {
    ready: false, appConfigured: true, config: null, destinations: [],
    auth: globalThis.authorized ? { mode: 'github_app', githubLogin: 'alex', githubUserId: 42 } : null,
    candidateAuth: null, destinationRegistry: { defaultDestinationId: null },
  };
  const replies = {
    GET_ONBOARDING_STATE: state,
    RESUME_DEVICE_FLOW: null,
    GET_PAGE_STATE: { configured: false, active: null, pendingWrites: [] },
    GET_STATE: { configured: false, active: null, pendingWrites: [] },
    GET_LOCAL_PREFERENCES: { clientRates: {}, invoicing: { clients: [] }, projects: [], recentDays: 7, revision: 0 },
    GET_ADDON_SETTINGS: {},
    DISCOVER_REPOSITORIES: { repositories: [repository], installations: [] },
    INSPECT_REPOSITORY: { repository },
  };
  if (Object.hasOwn(replies, request.type)) respond({ ok: true, data: replies[request.type] });
  else respond({ ok: false, error: { message: 'Unexpected request: ' + request.type } });
});
`;

test('a published /join tab survives extension onboarding and selects Join without writing to GitHub', async () => {
  test.setTimeout(45000);
  const extension = await mkdtemp(join(tmpdir(), 'clockoli-invite-extension-'));
  const profile = await mkdtemp(join(tmpdir(), 'clockoli-invite-profile-'));
  let context;
  try {
    await cp(new URL('src/', ROOT), join(extension, 'src'), { recursive: true });
    const manifest = JSON.parse(await readFile(new URL('manifest.json', ROOT), 'utf8'));
    manifest.background = { service_worker: 'test-worker.js' };
    await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
    await writeFile(join(extension, 'test-worker.js'), testWorker);
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await context.route('https://clockoli.com/join/**', route =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Clockoli join</title>' }));
    const invitationTab = await context.newPage();
    await invitationTab.goto('https://clockoli.com/join/?repo=acme%2Ftime-data');

    const options = await context.newPage();
    const errors = [];
    options.on('pageerror', error => errors.push(error.message));
    await options.goto(`chrome-extension://${new URL(worker.url()).host}/src/options/options.html`);
    await expect(options.locator('#connection-title')).toHaveText('Join your team on Clockoli');
    await expect(options.locator('#connection-description')).toContainText('acme/time-data');
    await expect(options.locator('#authorize')).toBeVisible();

    // Closing the website tab after pickup does not lose the local hint.
    await invitationTab.close();
    await options.reload();
    await expect(options.locator('#connection-description')).toContainText('acme/time-data');

    await worker.evaluate(() => { globalThis.authorized = true; globalThis.requests = []; });
    await options.reload();
    await expect(options.locator('#repository-step')).toBeVisible();
    await expect(options.locator('#existing-repository-option')).toBeVisible();
    await expect(options.locator('#repository-target')).toHaveValue('acme/time-data');
    await expect(options.locator('#repository-confirmation')).toHaveAttribute('open', '');
    await expect(options.locator('#confirm-repository-action')).toHaveText('Join repository');
    const requests = await worker.evaluate(() => globalThis.requests);
    expect(requests).toContain('INSPECT_REPOSITORY');
    expect(requests).not.toContain('SELECT_REPOSITORY');
    expect(errors).toEqual([]);
  } finally {
    await context?.close();
    await rm(extension, { recursive: true, force: true });
    await rm(profile, { recursive: true, force: true });
  }
});
