import { test, expect, chromium } from '@playwright/test';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url);
const workerSource = `
const today = new Date();
today.setHours(12, 0, 0, 0);
const monday = new Date(today);
monday.setDate(today.getDate() - (today.getDay() + 6) % 7);
const previous = new Date(monday);
previous.setDate(monday.getDate() - 7);
const day = value => [value.getFullYear(), String(value.getMonth() + 1).padStart(2, '0'), String(value.getDate()).padStart(2, '0')].join('-');
const record = { id: 'previous-week', taskUrl: 'https://github.com/acme/app/issues/42', taskTitle: 'Previous week entry',
  entryDate: day(previous), timezone: 'UTC', startedAt: day(previous) + 'T08:00:00Z',
  endedAt: day(previous) + 'T09:00:00Z', durationSeconds: 3600,
  _path: 'times/' + day(previous).slice(0, 7) + '/alice.jsonl', _sha: 'fixture', _index: 0 };
const current = { id: 'current-week', taskUrl: 'https://github.com/acme/app/issues/42', taskTitle: 'Current week entry',
  entryDate: day(today), timezone: 'UTC',
  startedAt: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0).toISOString(),
  endedAt: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 1).toISOString(),
  durationSeconds: 3600, _path: 'times/' + day(today).slice(0, 7) + '/alice.jsonl', _sha: 'fixture', _index: 1 };
const active = { id: 'running', taskUrl: 'https://github.com/acme/app/issues/42',
  taskTitle: 'Running task', startedAt: new Date(Date.now() - 60000).toISOString() };
const mondayStart = new Date(monday); mondayStart.setHours(0, 0, 0, 0);
const saturday = new Date(mondayStart); saturday.setDate(saturday.getDate() - 2); saturday.setHours(23, 0, 0, 0);
const mondayEnd = new Date(monday); mondayEnd.setHours(1, 0, 0, 0);
const crossing = { id: 'cross-week', taskUrl: 'https://github.com/acme/app/issues/42', taskTitle: 'Cross-week entry',
  entryDate: day(saturday), timezone: 'UTC', startedAt: saturday.toISOString(), endedAt: mondayEnd.toISOString(),
  durationSeconds: (mondayEnd.getTime() - saturday.getTime()) / 1000,
  _path: 'times/' + day(saturday).slice(0, 7) + '/alice.jsonl', _sha: 'fixture', _index: 3 };
globalThis.weekReads = [];
globalThis.includeCrossWeek = false;
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.type === 'LOAD_WEEK' || message.type === 'LOAD_TIMES') {
    globalThis.weekReads.push({ type: message.type, ...message.payload });
    respond({ ok: true, data: { configured: true, recent: [record, current, ...(globalThis.includeCrossWeek ? [crossing] : [])].filter(entry =>
      (message.payload.startDate <= entry.entryDate && message.payload.endDate >= entry.entryDate)
      || entry === crossing && message.payload.startDate === day(monday) && entry.endedAt > mondayStart.toISOString()) } });
  } else if (message.type === 'LOAD_RECENT') respond({ ok: true, data: { configured: true, active, recent: [current] } });
  else if (message.type === 'GET_PAGE_STATE' || message.type === 'GET_STATE') {
    respond({ ok: true, data: { configured: true, active, pendingWrites: [], pendingCount: 0,
      projects: [{ name: 'Issue work', substrings: ['/acme/app/issues/42'] }, { name: 'Unused', substrings: ['/other/repo/'] }] } });
  } else respond({ ok: true, data: {} });
});
`;

async function expectWeekHeaderLayout(root) {
  const section = root.locator('.popup-timeline-section');
  const navigation = root.locator('.week-navigation');
  const [bounds, left, label, right, total] = await Promise.all([
    section.locator('.timeline-shell').boundingBox(),
    navigation.getByRole('button', { name: 'Previous week' }).boundingBox(),
    navigation.locator('.week-navigation-label').boundingBox(),
    navigation.getByRole('button', { name: 'Next week' }).boundingBox(),
    section.locator('.tracked').boundingBox(),
  ]);
  expect(bounds && left && label && right && total).toBeTruthy();
  expect(Math.abs(left.x - bounds.x)).toBeLessThan(20);
  expect(Math.abs(right.x + right.width - bounds.x - bounds.width)).toBeLessThan(20);
  expect(Math.abs(label.x + label.width / 2 - bounds.x - bounds.width / 2)).toBeLessThan(12);
  expect(total.y).toBeGreaterThan(label.y + label.height - 1);
  expect(total.y - label.y - label.height).toBeLessThanOrEqual(10);
  await expect(section.locator('.domain-start')).toBeHidden();
  await expect(section.locator('.domain-end')).toBeHidden();
}

async function expectCalendarDetailsAboveWeek(root) {
  const host = root.locator('.task-timeline-host');
  const [details, navigation, total, chart] = await Promise.all([
    host.locator('.details').boundingBox(),
    root.locator('.week-navigation').boundingBox(),
    host.locator('.tracked').boundingBox(),
    host.locator('.calendar-view').boundingBox(),
  ]);
  expect(details && navigation && total && chart).toBeTruthy();
  expect(details.y + details.height).toBeLessThanOrEqual(navigation.y);
  expect(navigation.y + navigation.height).toBeLessThanOrEqual(total.y);
  expect(total.y + total.height).toBeLessThanOrEqual(chart.y);
}

function textBounds(locator) {
  return locator.evaluate(element => {
    const range = document.createRange(); range.selectNodeContents(element);
    const { x, y, width, height } = range.getBoundingClientRect();
    return { x, y, width, height };
  });
}

async function expectVisibleTimelineInsideSelectedWeek(root) {
  await expect.poll(async () => {
    const label = await root.locator('.week-navigation-label').textContent() || '';
    const [start, end] = label.split(' – ');
    return root.locator('.task-timeline-host').evaluate((element, [start, end]) => {
      const timeline = element.shadowRoot;
      const viewport = timeline?.querySelector('.viewport');
      if (!viewport) return false;
      const bounds = viewport.getBoundingClientRect();
      const visible = [...timeline.querySelectorAll('.ruler-cell')].filter(cell => {
        const rect = cell.getBoundingClientRect();
        return rect.right > bounds.left + 2 && rect.left < bounds.right - 2;
      });
      const localDate = timestamp => {
        const date = new Date(Number(timestamp));
        return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
      };
      return visible.length > 0 && visible.every(cell => localDate(cell.dataset.start) >= start
        && localDate(cell.dataset.start) <= end);
    }, [start, end]);
  }).toBe(true);
}

test('Activity and GitHub popup share Monday–Sunday Timeline and Calendar week navigation', async () => {
  test.setTimeout(45000);
  const extension = await mkdtemp(join(tmpdir(), 'clockoli-week-extension-'));
  const profile = await mkdtemp(join(tmpdir(), 'clockoli-week-profile-'));
  let context;
  try {
    await cp(new URL('src/', ROOT), join(extension, 'src'), { recursive: true });
    const rendererPath = join(extension, 'src/content/github.js');
    await writeFile(rendererPath, (await readFile(rendererPath, 'utf8')).replaceAll("mode: 'closed'", "mode: 'open'"));
    const manifest = JSON.parse(await readFile(new URL('manifest.json', ROOT), 'utf8'));
    manifest.background = { service_worker: 'test-worker.js' };
    await writeFile(join(extension, 'manifest.json'), `${JSON.stringify(manifest)}\n`);
    await writeFile(join(extension, 'test-worker.js'), workerSource);
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium', headless: false,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const errors = [];
    worker.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const id = new URL(worker.url()).host;
    let activity = await context.newPage();
    activity.on('pageerror', error => errors.push(error.message));
    await activity.goto(`chrome-extension://${id}/src/times/times.html`);
    let activityRoot = activity.locator('#clockoli-times-root').locator('> *');
    await expect(activityRoot.getByRole('button', { name: 'Previous week' })).toBeVisible();
    await expectWeekHeaderLayout(activityRoot);
    await expect(activityRoot.getByRole('combobox', { name: 'Time period' })).toHaveCount(0);
    await expect(activityRoot.getByRole('button', { name: 'Next week' })).toBeDisabled();
    await expect(activityRoot.locator('.task-timeline-host .task.running')).toHaveCount(1);
    await expect(activityRoot.locator('.task-timeline-host .row-label')).toHaveCount(0);
    await activityRoot.getByRole('button', { name: 'Previous week' }).click();
    await expect(activityRoot.getByRole('button', { name: 'Next week' })).toBeEnabled();
    await expect(activityRoot.locator('.task-timeline-host .task.running')).toHaveCount(0);
    await expect(activityRoot.locator('.task-timeline-host .tracked')).toHaveText('Total: 1h');
    await activityRoot.locator('.task-timeline-host .viewport').evaluate(element => { element.scrollLeft = element.scrollWidth; });
    await expectVisibleTimelineInsideSelectedWeek(activityRoot);
    await activityRoot.getByRole('button', { name: 'Previous week' }).click();
    await expect(activityRoot.locator('.task-timeline-host .task.running')).toHaveCount(0);
    await expect(activityRoot.locator('.task-timeline-host .tracked')).toHaveText('Total: 0m');
    await expectVisibleTimelineInsideSelectedWeek(activityRoot);
    await activityRoot.getByRole('button', { name: 'Next week' }).click();
    await activityRoot.getByRole('button', { name: 'List', exact: true }).click();
    await expect(activityRoot.getByRole('button', { name: 'Next week' })).toBeDisabled();
    await expect(activityRoot.getByText('Current week entry', { exact: true })).toBeVisible();
    await activityRoot.getByRole('button', { name: 'Previous week' }).click();
    await expect(activityRoot.getByText('Previous week entry', { exact: true })).toBeVisible();
    await expect(activityRoot.locator('.times-list-total')).toHaveText('Total: 1h');
    const [weekLabel, listTotal, listHeading] = await Promise.all([
      activityRoot.locator('.week-navigation-label').boundingBox(),
      textBounds(activityRoot.locator('.times-list-total')),
      activityRoot.getByText('Tracked time', { exact: true }).boundingBox(),
    ]);
    expect(listTotal.y).toBeGreaterThan(weekLabel.y);
    expect(listHeading.y).toBeGreaterThan(listTotal.y);
    expect(Math.abs(listTotal.x + listTotal.width / 2 - weekLabel.x - weekLabel.width / 2)).toBeLessThan(8);
    await activity.screenshot({ path: join(tmpdir(), 'clockoli-list-week-total.png') });
    await activity.setViewportSize({ width: 390, height: 800 });
    const [mobileLabel, mobileTotal] = await Promise.all([
      activityRoot.locator('.week-navigation-label').boundingBox(),
      textBounds(activityRoot.locator('.times-list-total')),
    ]);
    expect(Math.abs(mobileTotal.x + mobileTotal.width / 2 - mobileLabel.x - mobileLabel.width / 2)).toBeLessThan(8);
    await activity.setViewportSize({ width: 1280, height: 900 });
    await activityRoot.getByRole('button', { name: 'Previous week', exact: true }).click();
    await expect(activityRoot.locator('.times-list-total')).toHaveText('Total: 0m');
    await activityRoot.getByRole('button', { name: 'Next week' }).click();
    await expect(activityRoot.locator('.times-list-total')).toHaveText('Total: 1h');
    await activityRoot.getByRole('searchbox', { name: 'Search activity' }).fill('nothing matches');
    await expect(activityRoot.locator('.times-list-total')).toHaveText('Total: 1h');
    await activityRoot.getByRole('searchbox', { name: 'Search activity' }).fill('');
    await expect(activityRoot.getByRole('button', { name: 'Previous week', exact: true })).toBeVisible();
    await activityRoot.getByRole('button', { name: 'Calendar', exact: true }).click();
    await expect(activityRoot.getByRole('button', { name: 'Next week' })).toBeDisabled();
    await expect(activityRoot.locator('.times-list-total')).toBeHidden();
    await expect(activityRoot.getByRole('button', { name: 'Previous week' })).toBeVisible();
    await expect(activityRoot.locator('.task-timeline-host')).toBeVisible();
    await expect(activityRoot.locator('.task-timeline-host .calendar-day-header')).toHaveCount(7);
    await expect(activityRoot.locator('.task-timeline-host .calendar-task.running')).toHaveCount(1);
    await expect(activityRoot.locator('.task-timeline-host .calendar-row-name')).toHaveCount(0);
    await activityRoot.locator('.calendar-task.running').click();
    await expect(activityRoot.locator('.task-timeline-host .details-title')).toBeVisible();
    await expectWeekHeaderLayout(activityRoot);
    await expectCalendarDetailsAboveWeek(activityRoot);
    await activity.setViewportSize({ width: 480, height: 900 });
    await expectWeekHeaderLayout(activityRoot);
    await expectCalendarDetailsAboveWeek(activityRoot);
    await activity.setViewportSize({ width: 1280, height: 900 });
    await activityRoot.getByRole('button', { name: 'Previous week' }).click();
    await expect(activityRoot.locator('.task-timeline-host .calendar-task.running')).toHaveCount(0);
    await expect(activityRoot.locator('.task-timeline-host .calendar-day-header')).toHaveCount(7);
    await activityRoot.getByRole('button', { name: 'List', exact: true }).click();
    await expect(activityRoot.locator('.times-list-total')).toHaveText(/Total: 1h [1-9]\d*m/);
    await activityRoot.getByRole('button', { name: 'Previous week' }).click();
    await activityRoot.getByRole('button', { name: 'Calendar', exact: true }).click();
    await expect(activityRoot.locator('.week-navigation')).toHaveCount(1);
    await activity.close();
    activity = await context.newPage();
    activity.on('pageerror', error => errors.push(error.message));
    await activity.goto(`chrome-extension://${id}/src/times/times.html`);
    activityRoot = activity.locator('#clockoli-times-root').locator('> *');
    await expect(activityRoot.getByRole('button', { name: 'Calendar', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(activityRoot.locator('.week-navigation')).toHaveCount(1);
    await activityRoot.getByRole('button', { name: 'Timeline', exact: true }).click();
    await expect(activityRoot.locator('.week-navigation')).toHaveCount(1);
    await expect(activityRoot.getByRole('button', { name: 'Previous week' })).toHaveCount(1);
    await expect(activityRoot.getByRole('button', { name: 'Next week' })).toHaveCount(1);
    await activityRoot.getByRole('button', { name: 'Previous week' }).click();
    await expect(activityRoot.locator('.week-navigation')).toHaveCount(1);
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://github.com/acme/app/issues/42', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body><header><div class="AppHeader-actions"><img class="avatar" alt="User"></div></header><main><h1>Test issue</h1></main></body></html>' }));
    await page.goto('https://github.com/acme/app/issues/42');
    const githubRoot = page.locator('#clockoli-root');
    await expect(githubRoot).toBeVisible();
    await githubRoot.locator('.trigger-main').click();
    const popupRoot = page.locator('#clockoli-full-width-popup-root');
    await expect(popupRoot.getByRole('button', { name: 'Previous week' })).toBeVisible();
    await expectWeekHeaderLayout(popupRoot);
    await expect(popupRoot.getByRole('button', { name: 'Next week' })).toBeDisabled();
    await expect(popupRoot.locator('.task-timeline-host .task.running')).toHaveCount(1);
    await expect.poll(() => worker.evaluate(() => globalThis.weekReads.some(read => read.type === 'LOAD_WEEK'))).toBe(true);
    await popupRoot.getByRole('button', { name: 'Previous week' }).click();
    await expect(popupRoot.getByRole('button', { name: 'Next week' })).toBeEnabled();
    await expect(popupRoot.locator('.task-timeline-host .task.running')).toHaveCount(0);
    await expect(popupRoot.locator('.task-timeline-host .tracked')).toHaveText('Total: 1h');
    await popupRoot.locator('.task-timeline-host .viewport').evaluate(element => { element.scrollLeft = element.scrollWidth; });
    await expectVisibleTimelineInsideSelectedWeek(popupRoot);
    await popupRoot.getByRole('button', { name: 'Previous week' }).click();
    await expect(popupRoot.locator('.task-timeline-host .task.running')).toHaveCount(0);
    await expect(popupRoot.locator('.task-timeline-host .tracked')).toHaveText('Total: 0m');
    await expectVisibleTimelineInsideSelectedWeek(popupRoot);
    await popupRoot.getByRole('button', { name: 'Next week' }).click();
    await expect(popupRoot.getByRole('option', { name: /Previous week entry/ })).toBeVisible();
    await popupRoot.getByRole('button', { name: 'Calendar', exact: true }).click();
    await expect(popupRoot.getByRole('button', { name: 'Next week' })).toBeDisabled();
    await expect(popupRoot.getByRole('button', { name: 'Previous week' })).toBeVisible();
    await expect(popupRoot.locator('.task-timeline-host .calendar-day-header')).toHaveCount(7);
    await expect(popupRoot.locator('.task-timeline-host .calendar-task.running')).toHaveCount(1);
    await popupRoot.locator('.calendar-task.running').click();
    await expect(popupRoot.locator('.task-timeline-host .details-title')).toBeVisible();
    await expectCalendarDetailsAboveWeek(popupRoot);
    await expectWeekHeaderLayout(popupRoot);
    await page.setViewportSize({ width: 480, height: 900 });
    await expectWeekHeaderLayout(popupRoot);
    await expectCalendarDetailsAboveWeek(popupRoot);
    await page.setViewportSize({ width: 1280, height: 900 });
    await popupRoot.getByRole('button', { name: 'Previous week' }).click();
    await expect(popupRoot.locator('.calendar-task').filter({ hasText: 'Previous week entry' })).toBeVisible();
    await popupRoot.getByRole('button', { name: 'List', exact: true }).click();
    await expect(popupRoot.getByRole('link', { name: 'Current week entry' })).toBeVisible();
    await expect(popupRoot.getByRole('button', { name: 'Previous week' })).toBeVisible({ timeout: 5000 });
    await popupRoot.getByRole('button', { name: 'Previous week' }).click();
    await expect(popupRoot.getByRole('link', { name: 'Previous week entry' })).toBeVisible();
    await expect(popupRoot.getByRole('link', { name: 'Current week entry' })).toHaveCount(0);
    await expect(popupRoot.locator('.popup-list-total')).toHaveText('Total: 1h');
    await popupRoot.getByRole('button', { name: 'Next week' }).click();
    await expect(popupRoot.getByRole('link', { name: 'Current week entry' })).toBeVisible();
    await popupRoot.getByRole('button', { name: 'Close Clockoli' }).click();
    await page.getByRole('button', { name: /Time tracker/ }).click();
    await popupRoot.getByRole('button', { name: 'Calendar', exact: true }).click();
    await expect(popupRoot.getByRole('button', { name: 'Next week' })).toBeDisabled();
    await expect(popupRoot.locator('.calendar-task.running')).toHaveCount(1);
    await popupRoot.getByRole('button', { name: 'Previous week' }).click();
    await expect(popupRoot.locator('.calendar-task').filter({ hasText: 'Previous week entry' })).toBeVisible();
    await popupRoot.getByRole('button', { name: 'Timeline', exact: true }).click();
    await expect(popupRoot.getByRole('button', { name: 'Next week' })).toBeDisabled();
    await expect(popupRoot.locator('.task-timeline-host .task.running')).toHaveCount(1);
    await worker.evaluate(() => { globalThis.includeCrossWeek = true; });
    await popupRoot.getByRole('button', { name: 'Calendar', exact: true }).click();
    await expect(popupRoot.locator('.calendar-task').filter({ hasText: 'Cross-week entry' })).toBeVisible();
    await popupRoot.getByRole('button', { name: 'List', exact: true }).click();
    await expect(popupRoot.getByRole('link', { name: 'Cross-week entry' })).toBeVisible();
    await activityRoot.getByRole('button', { name: 'Calendar', exact: true }).click();
    await expect(activityRoot.locator('.calendar-task').filter({ hasText: 'Cross-week entry' })).toBeVisible();
    await expect(activityRoot.locator('.calendar-day-header').first()).toContainText(new Date().getDay() === 1 ? 'Tracked: 2h' : 'Tracked: 1h');
    await activityRoot.getByRole('button', { name: 'List', exact: true }).click();
    await expect(activityRoot.locator('.times-results').getByRole('link', { name: 'Cross-week entry' })).toBeVisible();
    const reads = await worker.evaluate(() => globalThis.weekReads);
    expect(reads.some(read => read.type === 'LOAD_TIMES')).toBe(true);
    expect(reads.some(read => read.type === 'LOAD_WEEK')).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await context?.close();
    await rm(extension, { recursive: true, force: true });
    await rm(profile, { recursive: true, force: true });
  }
});
