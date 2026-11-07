import { test, expect, chromium } from '@playwright/test';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Walks every rendered surface and checks computed styles against the Primer scale.
// Colors are Clockoli's own, so only type, control size, icon size and shape are audited.
const ROOT = new URL('..', import.meta.url);
const SHOTS = process.env.DESIGN_SHOTS;
const PAGES = ['times/times', 'tasks/tasks', 'reports/reports', 'options/options', 'popup/popup'];
const VIEWPORTS = [{ width: 1280, height: 800 }, { width: 800, height: 800 }, { width: 400, height: 800 }];

const workerSource = `
const pad = value => String(value).padStart(2, '0');
const dateOf = day => [day.getFullYear(), pad(day.getMonth() + 1), pad(day.getDate())].join('-');
const monday = new Date(); monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7);
const entry = (id, offset, hour, title, url, description = '') => {
  const day = new Date(monday); day.setDate(day.getDate() + offset);
  const date = dateOf(day), start = new Date(day); start.setHours(hour, 0, 0, 0);
  const end = new Date(start); end.setMinutes(50);
  return { id, taskUrl: url, taskTitle: title, entryDate: date, timezone: 'UTC', startedAt: start.toISOString(), endedAt: end.toISOString(),
    durationSeconds: 3000, description, user: 'alice', _path: 'times/' + date.slice(0, 7) + '/alice.jsonl', _sha: 'fixture', _index: 0, destinationId: 'github:1', timeRepository: 'acme/time' };
};
const recent = [
  entry('a', 0, 9, 'Fix replication failure', 'https://github.com/acme/foo/issues/123', 'Traced the lag to the writer queue'),
  entry('b', 0, 11, 'Review pull request', 'https://github.com/acme/foo/pull/481'),
  entry('c', 1, 10, 'Pricing rewrite spec', 'https://docs.example.com/spec'),
  entry('d', 2, 14, 'Support ticket 2291', 'https://support.example.com/2291', 'Answered the follow-up'),
];
globalThis.demoActive = null;
const state = () => ({ configured: true, active: globalThis.demoActive, recent, pendingWrites: [], pendingCount: 0, todayTrackedMs: 3000000, weekTrackedMs: 12000000,
  remoteWriteConfirmed: true, projects: [], otherProjectName: 'Other', readStatus: [{ destinationId: 'github:1', timeRepository: 'acme/time', status: 'ok' }], partial: false, conflicts: [] });
const tasks = recent.map(item => ({ taskUrl: item.taskUrl, taskTitle: item.taskTitle, totalSeconds: 3000, sessionCount: 1, lastWorkedAt: item.endedAt, users: ['alice'], destinationId: 'github:1' }));
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (['LOCAL_PREFERENCES_CHANGED', 'REPORT_PROGRESS'].includes(message?.type)) return undefined;
  if (message.type === 'GET_ACTIVITY_VIEW_MODE') respond({ ok: true, data: { mode: globalThis.demoMode ?? 'list' } });
  else if (message.type === 'SET_ACTIVITY_VIEW_MODE') { globalThis.demoMode = message.mode; respond({ ok: true, data: { mode: message.mode } }); }
  else if (message.type === 'GET_ONBOARDING_STATE') respond({ ok: true, data: { ready: true, appConfigured: true, auth: { mode: 'github_app', githubLogin: 'octocat', accessTokenExpiresAt: new Date(Date.now() + 3600000).toISOString() },
    candidateAuth: null, config: { owner: 'acme', repo: 'time', branch: 'main', recentDays: 7 }, verificationStatus: 'write_verified',
    destinations: [{ id: 'github:1', owner: 'acme', repo: 'time', label: 'acme/time', branch: 'main', defaultBranch: 'main', installationId: 7, initialized: true }] } });
  else if (message.type === 'GET_LOCAL_PREFERENCES') respond({ ok: true, data: { rates: {}, invoicing: { clients: [] }, projects: [], recentDays: 7, revision: 0 } });
  else if (message.type === 'GET_ADDON_SETTINGS') respond({ ok: true, data: {} });
  else if (message.type === 'LOAD_TASKS') respond({ ok: true, data: { ...state(), tasks, sourceRepositories: ['acme/time'], availableUsers: ['alice'], currentUsers: { 'github:1': 'alice' } } });
  else if (message.type === 'LOAD_REPORT') respond({ ok: true, data: { ...state(), records: recent, sourceRepositories: ['acme/time'], currentUser: 'alice', currentUsers: { 'github:1': 'alice' } } });
  else respond({ ok: true, data: state() });
  return undefined;
});
globalThis.demoOpenPanel = async pattern => {
  const [tab] = await chrome.tabs.query({ url: pattern });
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => { globalThis.__CLOCKOLI_ACTION_SURFACE__ = true; } });
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/domain/recovery-actions.js', 'src/ui/tracking-card.js', 'src/ui/task-search.js', 'src/content/task-timeline-component.js', 'src/content/github.js'] });
};
`;

// Runs inside the page, so it must stay self-contained.
function auditSurface() {
  const FONT_SIZES = new Set([12, 14, 16, 20, 24, 32]);
  const FONT_WEIGHTS = new Set([300, 400, 500, 600]);
  const CONTROL_HEIGHTS = new Set([20, 24, 28, 32, 40]);
  const RADII = new Set([0, 1, 2, 3, 5, 6, 12]);
  const RADIUS_ROUND = 32;
  const TOUCH_WIDTH = 520, TOUCH_HEIGHT = 44;
  const ICON_SIZE = 16;
  const violations = new Map();
  const report = (rule, node, value) => {
    const name = `${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ''}${typeof node.className === 'string' && node.className ? `.${node.className.trim().split(/\s+/).join('.')}` : ''}`;
    violations.set(`${rule} ${name} ${value}`, true);
  };
  const isPrintedDocument = node => Boolean(node.closest('.invoice-document,.invoice-preview,.print-timesheet,.print-invoice'));
  const visit = root => {
    for (const node of root.querySelectorAll('*')) {
      if (node.shadowRoot) visit(node.shadowRoot);
      const css = getComputedStyle(node), rect = node.getBoundingClientRect();
      if (css.display === 'none' || css.visibility === 'hidden' || rect.width === 0 || rect.height === 0) continue;
      if (node.closest('style,script') || isPrintedDocument(node)) continue;
      const ownText = [...node.childNodes].some(child => child.nodeType === Node.TEXT_NODE && child.textContent.trim());
      // The vendored ruler's dense labels must fit 26px-wide hour cells on the narrowest panel.
      if (ownText && !node.closest('svg') && !node.matches('.ruler-cell.dense')) {
        const size = Number.parseFloat(css.fontSize);
        if (size > 0 && !FONT_SIZES.has(size)) report('font-size', node, size);
        if (size > 0 && !FONT_WEIGHTS.has(Number(css.fontWeight))) report('font-weight', node, css.fontWeight);
        if (css.textTransform === 'uppercase') report('uppercase', node, '');
        if (css.letterSpacing !== 'normal') report('letter-spacing', node, css.letterSpacing);
      }
      const type = node.getAttribute('type');
      const isField = node.tagName === 'SELECT' || (node.tagName === 'INPUT' && !['checkbox', 'radio', 'file', 'hidden', 'range'].includes(type));
      const isButton = node.tagName === 'BUTTON' && !node.closest('.calendar-task,.task,.repository-collaborators,.merge-task-list,.teammate-choices')
        && !node.matches('.link-button,.entry-description-link,.add-time-option,.sync-issue-item,.setup-footer button,.calendar-day');
      const height = Math.round(rect.height), touchTarget = innerWidth <= TOUCH_WIDTH && height === TOUCH_HEIGHT;
      if (isField && !node.classList.contains('week-navigation-picker') && Number(css.fontWeight) !== 400 && !node.closest('.device-row,.running-status-start-value')) report('field-weight', node, css.fontWeight);
      if (isField && !node.classList.contains('week-navigation-picker') && css.fontSize !== '14px' && !node.closest('.device-row,.running-status-start-value')) report('field-size', node, css.fontSize);
      if ((isField || isButton) && !node.classList.contains('week-navigation-picker') && !node.closest('.running-status-start-value') && !touchTarget && !CONTROL_HEIGHTS.has(height)) report('control-height', node, Math.round(rect.height));
      if (node.tagName === 'svg' && !node.matches('.clockoli-mark') && !node.closest('.chart') && node.parentElement?.closest('button,a,.running-status-recent-play,label,.task-main,.activity-weekly-icon,.description-saved,.running-status-description-saved,.running-status-start-saved')) {
        if (Math.round(rect.width) !== ICON_SIZE || Math.round(rect.height) !== ICON_SIZE) report('icon-size', node, `${Math.round(rect.width)}x${Math.round(rect.height)}`);
      }
      for (const corner of ['borderTopLeftRadius', 'borderBottomRightRadius']) {
        const value = css[corner];
        if (!value.endsWith('px')) continue;
        const radius = Number.parseFloat(value);
        if (!RADII.has(radius) && radius < RADIUS_ROUND) report('radius', node, radius);
      }
    }
  };
  // A test page's own markup is not ours: audit only the panel when one is mounted.
  const panel = location.protocol === 'https:' ? document.getElementById('clockoli-full-width-popup-root')?.shadowRoot : null;
  visit(panel ?? document);
  return [...violations.keys()].sort();
}

async function extensionCopy() {
  const directory = await mkdtemp(join(tmpdir(), 'clockoli-design-'));
  await cp(new URL('src/', ROOT), join(directory, 'src'), { recursive: true });
  const manifest = JSON.parse(await readFile(new URL('manifest.json', ROOT), 'utf8'));
  manifest.background = { service_worker: 'demo-worker.js', type: 'module' };
  manifest.host_permissions = [...manifest.host_permissions, '<all_urls>'];
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest));
  await writeFile(join(directory, 'demo-worker.js'), workerSource);
  // Closed shadow roots hide the panel from the audit, so the test copy opens them.
  for (const script of ['src/content/github.js', 'src/content/task-timeline-component.js']) {
    const source = await readFile(join(directory, script), 'utf8');
    await writeFile(join(directory, script), source.replaceAll("mode: 'closed'", "mode: 'open'"));
  }
  return directory;
}

async function launch(colorScheme) {
  const extension = await extensionCopy();
  const profile = await mkdtemp(join(tmpdir(), 'clockoli-design-profile-'));
  const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, colorScheme,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.protocol === 'chrome-extension:' || url.protocol === 'data:') return route.continue();
    if (url.origin === 'https://docs.example.com') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Spec</title><h1>Spec</h1>' });
    return route.abort();
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const base = `chrome-extension://${new URL(worker.url()).host}/src`;
  return { context, worker, base, close: async () => { await context.close(); await rm(extension, { recursive: true, force: true }); await rm(profile, { recursive: true, force: true }); } };
}

async function check(page, label, found) {
  const violations = await page.evaluate(auditSurface);
  for (const item of violations) found.add(`${label}: ${item}`);
  if (SHOTS) {
    await mkdir(SHOTS, { recursive: true });
    await page.screenshot({ path: join(SHOTS, `${label.replaceAll(/[^a-z0-9-]+/gi, '-')}.png`) });
  }
}

const running = () => {
  const startedAt = new Date(Date.now() - 5_400_000).toISOString();
  globalThis.demoActive = { id: 'live', taskUrl: 'https://github.com/acme/foo/issues/123', taskTitle: 'Fix replication failure', description: '',
    startedAt, entryDate: startedAt.slice(0, 10), timezone: 'UTC', destinationId: 'github:1' };
};
const settle = async page => { await page.waitForLoadState('load'); await page.waitForTimeout(700); };

for (const colorScheme of ['light', 'dark']) {
  test(`every surface stays on the Primer scale in ${colorScheme}`, async () => {
    test.setTimeout(240_000);
    const app = await launch(colorScheme), found = new Set();
    try {
      const page = await app.context.newPage();
      for (const activeState of ['idle', 'running']) {
        if (activeState === 'running') await app.worker.evaluate(running);
        for (const viewport of VIEWPORTS) {
          await page.setViewportSize(viewport);
          for (const path of PAGES) {
            await page.goto(`${app.base}/${path}.html`);
            await settle(page);
            await check(page, `${colorScheme}-${activeState}-${viewport.width}-${path.split('/')[0]}`, found);
          }
          for (const mode of ['timeline', 'calendar']) {
            await app.worker.evaluate(value => { globalThis.demoMode = value; }, mode);
            await page.goto(`${app.base}/times/times.html`);
            await settle(page);
            await check(page, `${colorScheme}-${activeState}-${viewport.width}-times-${mode}`, found);
          }
          await app.worker.evaluate(() => { globalThis.demoMode = 'list'; });
          await page.goto('https://docs.example.com/spec');
          await app.worker.evaluate(url => globalThis.demoOpenPanel(url), 'https://docs.example.com/*');
          await page.waitForFunction(() => document.getElementById('clockoli-full-width-popup-root')?.shadowRoot?.querySelector('.popup-overview-layout'), null, { timeout: 8000 });
          await settle(page);
          await check(page, `${colorScheme}-${activeState}-${viewport.width}-panel`, found);
        }
      }
      await page.setViewportSize(VIEWPORTS[0]);
      await page.goto(`${app.base}/tasks/tasks.html`);
      await settle(page);
      await page.locator('#add-time-button').click();
      await check(page, `${colorScheme}-add-time-dialog`, found);
    } finally { await app.close(); }
    expect([...found]).toEqual([]);
  });
}
