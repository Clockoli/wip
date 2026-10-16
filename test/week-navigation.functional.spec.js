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
  taskTitle: 'Running task', startedAt: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 11, 59).toISOString() };
const mondayStart = new Date(monday); mondayStart.setHours(0, 0, 0, 0);
const saturday = new Date(mondayStart); saturday.setDate(saturday.getDate() - 2); saturday.setHours(23, 0, 0, 0);
const mondayEnd = new Date(monday); mondayEnd.setHours(1, 0, 0, 0);
const crossing = { id: 'cross-week', taskUrl: 'https://github.com/acme/app/issues/42', taskTitle: 'Cross-week entry',
  entryDate: day(saturday), timezone: 'UTC', startedAt: saturday.toISOString(), endedAt: mondayEnd.toISOString(),
  durationSeconds: (mondayEnd.getTime() - saturday.getTime()) / 1000,
  _path: 'times/' + day(saturday).slice(0, 7) + '/alice.jsonl', _sha: 'fixture', _index: 3 };
globalThis.weekReads = [];
globalThis.includeCrossWeek = false;
globalThis.holdNextWeekRead = false;
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.type === 'LOAD_WEEK' || message.type === 'LOAD_TIMES') {
    globalThis.weekReads.push({ type: message.type, ...message.payload });
    const finish = () => respond({ ok: true, data: { configured: true, recent: [record, current, ...(globalThis.includeCrossWeek ? [crossing] : [])].filter(entry =>
      (message.payload.startDate <= entry.entryDate && message.payload.endDate >= entry.entryDate)
      || entry === crossing && message.payload.startDate === day(monday) && entry.endedAt > mondayStart.toISOString()) } });
    if (globalThis.holdNextWeekRead) { globalThis.holdNextWeekRead = false; globalThis.finishHeldWeekRead = finish; return true; }
    finish();
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

async function expectRunningCardFits(root) {
  const card = root.locator('.active-task-strip.is-active');
  await expect(card.locator('.running-status-live')).toHaveText('Tracking now');
  await expect(card.locator('.running-status-elapsed')).toBeVisible();
  await expect(card.locator('.running-status-today')).toBeVisible();
  await expect(card.getByRole('button', { name: 'Stop and save' })).toBeVisible();
  const appearance = await card.evaluate(element => {
    const style = getComputedStyle(element);
    const badge = getComputedStyle(element.querySelector('.running-status-live'));
    return { borderWidth: style.borderLeftWidth, borderColor: style.borderLeftColor,
      background: style.backgroundImage, radius: style.borderRadius,
      badgeBackground: badge.backgroundColor, badgeColor: badge.color };
  });
  expect(appearance.borderWidth).toBe('4px');
  expect(appearance.borderColor).not.toBe('rgba(0, 0, 0, 0)');
  expect(appearance.background).toContain('gradient');
  expect(appearance.radius).not.toBe('0px');
  expect(appearance.badgeBackground).not.toBe('rgba(0, 0, 0, 0)');
  const layout = await card.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return { viewport: innerWidth, left: bounds.left, right: bounds.right,
      children: [...element.querySelectorAll('.strip-task-copy,.running-status-metrics,button')].map(child => {
        const rect = child.getBoundingClientRect();
        return { name: child.className, left: rect.left, right: rect.right, visible: rect.width > 0 && rect.height > 0 };
      }).filter(child => child.visible) };
  });
  expect(layout.left >= 0 && layout.right <= layout.viewport
    && layout.children.every(child => child.left >= layout.left - 1 && child.right <= layout.right + 1), JSON.stringify(layout)).toBe(true);
}

async function expectViewTabsBelowTracking(root, selected = 'Timeline') {
  const card = root.locator('.active-task-strip');
  const tabs = root.locator('.timeline-view-modes');
  await expect(tabs.getByRole('button')).toHaveText(['Timeline', 'Calendar', 'List']);
  await expect(tabs.getByRole('button', { name: selected })).toHaveAttribute('aria-pressed', 'true');
  const [cardBox, tabsBox, weekBox, underline] = await Promise.all([
    card.boundingBox(), tabs.boundingBox(), root.locator('.week-navigation').first().boundingBox(),
    tabs.getByRole('button', { name: selected }).evaluate(element => getComputedStyle(element).borderBottomWidth),
  ]);
  expect(cardBox && tabsBox && weekBox).toBeTruthy();
  expect(tabsBox.y).toBeGreaterThanOrEqual(cardBox.y + cardBox.height - 1);
  expect(tabsBox.y - (cardBox.y + cardBox.height)).toBeLessThanOrEqual(2);
  expect(weekBox.y).toBeGreaterThanOrEqual(tabsBox.y + tabsBox.height - 1);
  expect(tabsBox.x).toBeGreaterThanOrEqual(cardBox.x - 1);
  expect(tabsBox.x + tabsBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 1);
  expect(underline).toBe('3px');
  const centerOffset = await tabs.evaluate(element => {
    const row = element.getBoundingClientRect();
    const buttons = element.querySelectorAll('button');
    const first = buttons[0].getBoundingClientRect();
    const last = buttons[buttons.length - 1].getBoundingClientRect();
    return Math.abs((first.left + last.right) / 2 - (row.left + row.right) / 2);
  });
  expect(centerOffset).toBeLessThan(2);
}

async function expectPanelScroll(page, root, selector) {
  const scroller = root.locator(selector);
  await expect.poll(() => scroller.evaluate(element => element.scrollHeight - element.clientHeight)).toBeGreaterThan(30);
  const bounds = await root.locator('.week-navigation').boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.wheel(0, 320);
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  const surface = await scroller.boundingBox();
  await page.mouse.move(surface.x + 8, surface.y + surface.height / 2);
  await page.mouse.wheel(0, -320);
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(0);
  await page.mouse.wheel(0, 45);
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await scroller.evaluate(element => { element.scrollTop = 0; });
  const viewport = await root.locator('.task-timeline-host .viewport').boundingBox();
  const visibleTop = Math.max(viewport.y, surface.y);
  const visibleBottom = Math.min(viewport.y + viewport.height, surface.y + surface.height);
  expect(visibleBottom - visibleTop).toBeGreaterThan(8);
  await page.mouse.move(viewport.x + viewport.width / 2, (visibleTop + visibleBottom) / 2);
  await page.mouse.wheel(0, 45);
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  const moved = await root.locator('.task-timeline-host .viewport').boundingBox();
  await page.mouse.move(moved.x + moved.width / 2, Math.max(surface.y + 5, moved.y + 5));
  await page.mouse.wheel(0, -45);
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(0);
  const horizontal = await root.locator('.task-timeline-host .viewport').evaluate(element => ({ left: element.scrollLeft,
    available: element.scrollWidth - element.clientWidth }));
  expect(horizontal.available).toBeGreaterThan(80);
  await page.mouse.move(viewport.x + viewport.width / 2, (visibleTop + visibleBottom) / 2);
  await page.mouse.wheel(horizontal.left > horizontal.available / 2 ? -80 : 80, 0);
  await expect.poll(() => root.locator('.task-timeline-host .viewport').evaluate((element, left) => Math.abs(element.scrollLeft - left), horizontal.left)).toBeGreaterThan(1);
  expect(await scroller.evaluate(element => element.scrollTop)).toBe(0);
  await scroller.evaluate(element => { element.scrollTop = 45; });
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
  const fixedNow = new Date(); fixedNow.setHours(12, 0, 0, 0);
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
    await activity.clock.setFixedTime(fixedNow);
    activity.on('pageerror', error => errors.push(error.message));
    await activity.goto(`chrome-extension://${id}/src/times/times.html`);
    let activityRoot = activity.locator('#clockoli-times-root').locator('> *');
    await expect(activityRoot.getByRole('button', { name: 'Previous week' })).toBeVisible();
    await expectWeekHeaderLayout(activityRoot);
    await expect(activityRoot.getByRole('combobox', { name: 'Time period' })).toHaveCount(0);
    await expect(activityRoot.getByRole('button', { name: 'Next week' })).toBeDisabled();
    await expect(activityRoot.locator('.task-timeline-host .task.running')).toHaveCount(1);
    await expect(activityRoot.locator('.task-timeline-host .row-label')).toHaveCount(0);
    await activity.setViewportSize({ width: 1280, height: 520 });
    await expect.poll(() => activity.evaluate(() => document.scrollingElement.scrollHeight - innerHeight)).toBeGreaterThan(30);
    const timelineViewport = activityRoot.locator('.task-timeline-host .viewport');
    await expect(timelineViewport).toBeVisible();
    const timelineBounds = await timelineViewport.boundingBox();
    expect(timelineBounds.y).toBeLessThan(520);
    await activity.mouse.move(timelineBounds.x + timelineBounds.width / 2, (Math.max(0, timelineBounds.y) + Math.min(520, timelineBounds.y + timelineBounds.height)) / 2);
    // A freshly rendered Timeline can consume the first wheel gesture while the
    // horizontal viewport settles. Require an actual page scroll, not a mock.
    await expect(async () => {
      await activity.mouse.wheel(0, 120);
      await expect.poll(() => activity.evaluate(() => window.scrollY), { timeout: 900 }).toBeGreaterThan(0);
    }).toPass({ timeout: 7000, intervals: [250, 500, 1000] });
    await activity.evaluate(() => window.scrollTo(0, 0));
    await activity.setViewportSize({ width: 1280, height: 900 });
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
    await activity.setViewportSize({ width: 1280, height: 520 });
    const calendarViewport = activityRoot.locator('.task-timeline-host .calendar-viewport');
    await expect.poll(() => calendarViewport.evaluate(element => element.scrollHeight - element.clientHeight)).toBeGreaterThan(100);
    expect(await calendarViewport.evaluate(element => element.clientHeight)).toBeLessThanOrEqual(650);
    await expect.poll(() => activity.evaluate(() => document.scrollingElement.scrollHeight - innerHeight)).toBeGreaterThan(30);
    await activity.evaluate(() => window.scrollTo(0, 0));
    await calendarViewport.evaluate(element => { element.scrollTop = 0; });
    const calendarBounds = await calendarViewport.boundingBox();
    expect(calendarBounds.y).toBeLessThan(520);
    await activity.mouse.move(calendarBounds.x + calendarBounds.width / 2, (Math.max(0, calendarBounds.y) + Math.min(520, calendarBounds.y + calendarBounds.height)) / 2);
    await activity.mouse.wheel(0, 120);
    await expect.poll(() => calendarViewport.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    expect(await activity.evaluate(() => window.scrollY)).toBe(0);
    await activity.waitForTimeout(1200);
    expect(await calendarViewport.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    await activity.mouse.wheel(0, -120);
    await expect.poll(() => calendarViewport.evaluate(element => element.scrollTop)).toBe(0);
    await calendarViewport.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await activity.mouse.wheel(0, 120);
    await expect.poll(() => activity.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    const pageAtBottom = await activity.evaluate(() => window.scrollY);
    const calendarAtBottom = await calendarViewport.evaluate(element => element.scrollTop);
    await activity.mouse.wheel(0, -120);
    await expect.poll(() => calendarViewport.evaluate(element => element.scrollTop)).toBeLessThan(calendarAtBottom - 1);
    expect(await activity.evaluate(() => window.scrollY)).toBe(pageAtBottom);
    await calendarViewport.evaluate(element => { element.scrollTop = 0; });
    await activity.mouse.wheel(0, -120);
    await expect.poll(() => activity.evaluate((before) => window.scrollY < before, pageAtBottom)).toBe(true);
    await activity.setViewportSize({ width: 390, height: 520 });
    // Keep the wheel target fully in view instead of relying on the page's
    // previous vertical scroll position at this responsive breakpoint.
    await calendarViewport.scrollIntoViewIfNeeded();
    await expect.poll(() => calendarViewport.evaluate(element => element.scrollWidth - element.clientWidth)).toBeGreaterThan(0);
    await calendarViewport.evaluate(element => { element.scrollLeft = 0; });
    const narrowCalendar = await calendarViewport.boundingBox();
    await activity.mouse.move(narrowCalendar.x + narrowCalendar.width / 2,
      narrowCalendar.y + Math.min(80, narrowCalendar.height / 2));
    await activity.mouse.wheel(120, 0);
    await expect.poll(() => calendarViewport.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
    expect(await activity.evaluate(() => window.scrollX)).toBe(0);
    await activity.setViewportSize({ width: 1280, height: 900 });
    await activityRoot.locator('.calendar-task.running').click();
    await expect(activityRoot.locator('.task-timeline-host .details-title')).toBeVisible();
    await expectWeekHeaderLayout(activityRoot);
    await expectCalendarDetailsAboveWeek(activityRoot);
    await activity.setViewportSize({ width: 480, height: 900 });
    await expectWeekHeaderLayout(activityRoot);
    await expectCalendarDetailsAboveWeek(activityRoot);
    await activity.setViewportSize({ width: 1280, height: 900 });
    await worker.evaluate(() => { globalThis.holdNextWeekRead = true; });
    await activityRoot.getByRole('button', { name: 'Previous week' }).click();
    await expect(activityRoot.locator('.calendar-week-loading')).toBeVisible();
    expect(await activityRoot.locator('.calendar-week-spinner').evaluate(element => getComputedStyle(element).width)).toBe('64px');
    await worker.evaluate(() => { globalThis.finishHeldWeekRead(); globalThis.finishHeldWeekRead = null; });
    await expect(activityRoot.locator('.calendar-week-loading')).toBeHidden();
    await expect(activityRoot.locator('.task-timeline-host .calendar-task.running')).toHaveCount(0);
    await expect(activityRoot.locator('.task-timeline-host .calendar-day-header')).toHaveCount(7);
    await expect(activityRoot.locator('.task-timeline-host .calendar-task')).toHaveCount(1);
    await expect.poll(() => calendarViewport.evaluate(element => element.scrollTop)).toBeGreaterThan(150);
    const readsBeforeRefresh = await worker.evaluate(() => globalThis.weekReads.length);
    await activity.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect.poll(() => worker.evaluate(() => globalThis.weekReads.length)).toBeGreaterThan(readsBeforeRefresh);
    await expect(activityRoot.locator('.times-calendar-status')).toHaveText('');
    expect(await calendarViewport.evaluate(element => element.scrollTop)).toBeGreaterThan(150);
    const morningBounds = await calendarViewport.boundingBox();
    await activity.mouse.move(morningBounds.x + morningBounds.width / 2, morningBounds.y + 100);
    await activity.mouse.wheel(0, 120);
    const manualScroll = await calendarViewport.evaluate(element => element.scrollTop);
    expect(manualScroll).toBeGreaterThan(150);
    const readsBeforeManualRefresh = await worker.evaluate(() => globalThis.weekReads.length);
    await activity.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect.poll(() => worker.evaluate(() => globalThis.weekReads.length)).toBeGreaterThan(readsBeforeManualRefresh);
    await expect(activityRoot.locator('.times-calendar-status')).toHaveText('');
    expect(await calendarViewport.evaluate(element => element.scrollTop)).toBeCloseTo(manualScroll, 0);
    await activityRoot.getByRole('button', { name: 'List', exact: true }).click();
    await expect(activityRoot.locator('.times-list-total')).toHaveText(/Total: 1h [1-9]\d*m/);
    await activityRoot.getByRole('button', { name: 'Previous week' }).click();
    await activityRoot.getByRole('button', { name: 'Calendar', exact: true }).click();
    await expect(activityRoot.locator('.week-navigation')).toHaveCount(1);
    await activity.close();
    activity = await context.newPage();
    await activity.clock.setFixedTime(fixedNow);
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
    await page.clock.setFixedTime(fixedNow);
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://github.com/acme/app/issues/42', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body><header><div class="AppHeader-actions"><img class="avatar" alt="User"></div></header><main><h1>Test issue</h1></main></body></html>' }));
    await page.goto('https://github.com/acme/app/issues/42');
    const githubRoot = page.locator('#clockoli-root');
    await expect(githubRoot).toBeVisible();
    await githubRoot.locator('.trigger-main').click();
    const popupRoot = page.locator('#clockoli-full-width-popup-root');
    await expectRunningCardFits(popupRoot);
    await page.screenshot({ path: join(tmpdir(), 'clockoli-popup-active-before.png') });
    await expectViewTabsBelowTracking(popupRoot);
    await page.setViewportSize({ width: 1280, height: 600 });
    await expectPanelScroll(page, popupRoot, '.full-width-popup');
    await popupRoot.getByRole('button', { name: 'Previous week' }).click();
    await expect.poll(() => popupRoot.locator('.full-width-popup').evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    await popupRoot.getByRole('button', { name: 'Next week' }).click();
    await page.setViewportSize({ width: 1280, height: 900 });
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
    await page.setViewportSize({ width: 1280, height: 520 });
    const popupCalendar = popupRoot.locator('.task-timeline-host .calendar-viewport');
    const popupSurface = popupRoot.locator('.full-width-popup');
    expect(await popupCalendar.evaluate(element => getComputedStyle(element).overscrollBehaviorY)).toBe('auto');
    await expect.poll(() => popupCalendar.evaluate(element => element.scrollHeight - element.clientHeight)).toBeGreaterThan(100);
    await expect.poll(() => popupSurface.evaluate(element => element.scrollHeight - element.clientHeight)).toBeGreaterThan(100);
    await popupSurface.evaluate(element => {
      const viewport = element.querySelector('.task-timeline-host').shadowRoot.querySelector('.calendar-viewport');
      element.scrollTop = Math.max(0, viewport.getBoundingClientRect().top - element.getBoundingClientRect().top - 30);
    });
    const popupCalendarBounds = await popupCalendar.boundingBox();
    const popupSurfaceBounds = await popupSurface.boundingBox();
    const visibleTop = Math.max(popupCalendarBounds.y, popupSurfaceBounds.y);
    const visibleBottom = Math.min(popupCalendarBounds.y + popupCalendarBounds.height, popupSurfaceBounds.y + popupSurfaceBounds.height);
    expect(visibleBottom - visibleTop).toBeGreaterThan(5);
    await page.mouse.move(popupCalendarBounds.x + popupCalendarBounds.width / 2, (visibleTop + visibleBottom) / 2);
    await popupCalendar.evaluate(element => { element.scrollTop = element.scrollHeight; });
    const panelScrollBefore = await popupSurface.evaluate(element => element.scrollTop);
    await page.mouse.wheel(0, 120);
    await expect.poll(() => popupSurface.evaluate((element, before) => element.scrollTop - before, panelScrollBefore)).toBeGreaterThan(0);
    const panelAtBottom = await popupSurface.evaluate(element => element.scrollTop);
    const popupCalendarAtBottom = await popupCalendar.evaluate(element => element.scrollTop);
    await page.mouse.wheel(0, -120);
    await expect.poll(() => popupCalendar.evaluate(element => element.scrollTop)).toBeLessThan(popupCalendarAtBottom - 1);
    expect(await popupSurface.evaluate(element => element.scrollTop)).toBe(panelAtBottom);
    await popupCalendar.evaluate(element => { element.scrollTop = 0; });
    await page.mouse.wheel(0, -120);
    await expect.poll(() => popupSurface.evaluate((element, before) => element.scrollTop < before, panelAtBottom)).toBe(true);
    await page.setViewportSize({ width: 1280, height: 900 });
    await popupRoot.locator('.calendar-task.running').click();
    await expect(popupRoot.locator('.task-timeline-host .details-title')).toBeVisible();
    await expectCalendarDetailsAboveWeek(popupRoot);
    await expectWeekHeaderLayout(popupRoot);
    await page.setViewportSize({ width: 480, height: 900 });
    await expectRunningCardFits(popupRoot);
    await expectViewTabsBelowTracking(popupRoot, 'Calendar');
    await expectWeekHeaderLayout(popupRoot);
    await expectCalendarDetailsAboveWeek(popupRoot);
    await page.setViewportSize({ width: 1280, height: 900 });
    await worker.evaluate(() => { globalThis.holdNextWeekRead = true; });
    await popupRoot.getByRole('button', { name: 'Previous week' }).click();
    await expect(popupRoot.locator('.calendar-week-loading')).toBeVisible();
    await worker.evaluate(() => { globalThis.finishHeldWeekRead(); globalThis.finishHeldWeekRead = null; });
    await expect(popupRoot.locator('.calendar-week-loading')).toBeHidden();
    await expect(popupRoot.locator('.calendar-task').filter({ hasText: 'Previous week entry' })).toBeVisible();
    await popupRoot.getByRole('button', { name: 'List', exact: true }).click();
    await expect(popupRoot.getByRole('link', { name: 'Current week entry' })).toBeVisible();
    await expect(popupRoot.locator('.today-list.activity-list .entry-record')).not.toHaveCount(0);
    await expect(popupRoot.locator('.today-list.activity-list .entry-date-header')).not.toHaveCount(0);
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
    const listRow = root => root.locator('.activity-list .entry-record').first().evaluate(node => {
      const css = getComputedStyle(node);
      return { children: [...node.children].map(child => child.className), padding: css.padding,
        border: css.borderBottomWidth, background: css.backgroundColor, radius: css.borderRadius };
    });
    expect(await listRow(popupRoot)).toEqual(await listRow(activityRoot));
    const toolbar = await context.newPage();
    await toolbar.clock.setFixedTime(fixedNow);
    toolbar.on('pageerror', error => errors.push(error.message));
    await toolbar.setViewportSize({ width: 420, height: 650 });
    await toolbar.goto(`chrome-extension://${id}/src/popup/popup.html`);
    const toolbarRoot = toolbar.locator('#clockoli-popup-root');
    await expectRunningCardFits(toolbarRoot);
    const toolbarLayout = await toolbarRoot.evaluate(element => {
      const root = element.shadowRoot;
      const logo = root.querySelector('.clockoli-wordmark').getBoundingClientRect();
      const card = root.querySelector('.active-task-strip').getBoundingClientRect();
      const tabs = root.querySelector('.timeline-view-modes').getBoundingClientRect();
      const menu = root.querySelector('.menu').getBoundingClientRect();
      return { logoHeight: logo.height, cardBottom: card.bottom, tabsBottom: tabs.bottom, menuBottom: menu.bottom };
    });
    expect(toolbarLayout.logoHeight).toBeLessThanOrEqual(32);
    expect(toolbarLayout.cardBottom).toBeLessThanOrEqual(toolbarLayout.menuBottom);
    expect(toolbarLayout.tabsBottom).toBeLessThanOrEqual(toolbarLayout.menuBottom);
    await toolbar.screenshot({ path: join(tmpdir(), 'clockoli-toolbar-active-before.png') });
    await expectViewTabsBelowTracking(toolbarRoot);
    await toolbarRoot.getByRole('button', { name: 'List', exact: true }).click();
    await expectViewTabsBelowTracking(toolbarRoot, 'List');
    await expect(toolbarRoot.locator('.today-list.activity-list .entry-record')).not.toHaveCount(0);
    expect(await toolbarRoot.locator('.today-list').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await toolbarRoot.getByRole('button', { name: 'Timeline', exact: true }).click();
    await toolbar.setViewportSize({ width: 420, height: 520 });
    await expectPanelScroll(toolbar, toolbarRoot, '.menu');
    await toolbar.close();
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

test('Activity Calendar focuses daytime records after disabling and re-enabling the extension', async () => {
  test.setTimeout(45000);
  const extension = await mkdtemp(join(tmpdir(), 'clockoli-calendar-extension-'));
  const profile = await mkdtemp(join(tmpdir(), 'clockoli-calendar-profile-'));
  let context;
  try {
    await cp(new URL('src/', ROOT), join(extension, 'src'), { recursive: true });
    const rendererPath = join(extension, 'src/content/github.js');
    await writeFile(rendererPath, (await readFile(rendererPath, 'utf8')).replaceAll("mode: 'closed'", "mode: 'open'"));
    const manifest = JSON.parse(await readFile(new URL('manifest.json', ROOT), 'utf8'));
    manifest.background = { service_worker: 'test-worker.js' };
    await writeFile(join(extension, 'manifest.json'), `${JSON.stringify(manifest)}\n`);
    const daytimeWorker = workerSource
      .replace('today.getDate(), 0).toISOString()', 'today.getDate(), 10).toISOString()')
      .replace('today.getDate(), 1).toISOString()', 'today.getDate(), 11).toISOString()')
      .replace('active, recent: [current]', 'active: null, recent: [current]')
      .replace('active, pendingWrites: []', 'active: null, pendingWrites: []');
    await writeFile(join(extension, 'test-worker.js'), daytimeWorker);
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium', headless: false,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const id = new URL(worker.url()).host;
    const errors = [];
    const watchWorker = observed => observed.on('console', message => {
      if (message.type() === 'error') errors.push(message.text());
    });
    watchWorker(worker);
    context.on('serviceworker', watchWorker);
    const activity = await context.newPage();
    activity.on('pageerror', error => errors.push(error.message));
    await activity.goto(`chrome-extension://${id}/src/times/times.html`);
    await activity.getByRole('button', { name: 'Calendar', exact: true }).click();
    const calendar = activity.locator('#clockoli-times-root .calendar-viewport');
    await expect.poll(() => calendar.evaluate(element => element.scrollTop)).toBeGreaterThan(100);
    await activity.close();

    const extensions = await context.newPage();
    await extensions.goto(`chrome://extensions/?id=${id}`);
    const toggle = extensions.locator('extensions-detail-view #enableToggle');
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');

    const reopened = await context.newPage();
    reopened.on('pageerror', error => errors.push(error.message));
    await reopened.goto(`chrome-extension://${id}/src/times/times.html`);
    await expect(reopened.getByRole('button', { name: 'Calendar', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const reopenedCalendar = reopened.locator('#clockoli-times-root .calendar-viewport');
    await expect.poll(() => reopenedCalendar.evaluate(element => element.scrollTop)).toBeGreaterThan(100);
    expect(errors).toEqual([]);
  } finally {
    await context?.close();
    await rm(extension, { recursive: true, force: true });
    await rm(profile, { recursive: true, force: true });
  }
});
