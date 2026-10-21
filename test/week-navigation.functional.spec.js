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
  // Keep Monday's current-week fixture away from the cross-week entry
  // (which ends at 01:00 Monday), so this test is independent of run date.
  startedAt: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 2).toISOString(),
  endedAt: new Date(today.getFullYear(), today.getMonth(), today.getDate(), 3).toISOString(),
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
globalThis.stateReads = 0;
globalThis.activeDescriptionEdits = [];
globalThis.activeStartEdits = [];
globalThis.rejectStartEdit = false;
globalThis.holdNextStartEdit = false;
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
  else if (message.type === 'QUEUE_ACTIVE_START_EDIT') {
    if (message.payload.startedAt && globalThis.rejectStartEdit) {
      respond({ ok: false, error: { message: 'Start would overlap another entry.' } }); return;
    }
    if (message.payload.startedAt && globalThis.holdNextStartEdit) {
      globalThis.holdNextStartEdit = false;
      const original = active.startedAt;
      globalThis.finishHeldStartEdit = () => {
        if (active.startedAt === original) active.startedAt = message.payload.startedAt;
        respond({ ok: true, data: { operationId: 'held-start-edit' } });
      };
      return true;
    }
    // Acknowledged edits are durable locally: page-state reads must see them
    // immediately, even while the GitHub push remains pending.
    if ('description' in message.payload) active.description = message.payload.description;
    if (message.payload.startedAt) active.startedAt = message.payload.startedAt;
    if (message.payload.startedAt) globalThis.activeStartEdits.push(message.payload);
    else globalThis.activeDescriptionEdits.push(message.payload);
    respond({ ok: true, data: { operationId: 'active-description-edit' } });
  } else if (message.type === 'GET_PAGE_STATE' || message.type === 'GET_STATE') {
    globalThis.stateReads += 1;
    respond({ ok: true, data: { configured: true, active, pendingWrites: [], pendingCount: 0,
      projects: [{ name: 'Issue work', substrings: ['/acme/app/issues/42'] }, { name: 'Unused', substrings: ['/other/repo/'] }] } });
  } else respond({ ok: true, data: {} });
});
`;

async function expectWeekHeaderLayout(root) {
  const section = root.locator('.popup-timeline-section');
  const navigation = root.locator('.week-navigation');
  if (await section.locator('.meta').isHidden() && await section.locator('.calendar-view').isVisible()) {
    const [bounds, left, label, right, chart] = await Promise.all([
      section.locator('.timeline-shell').boundingBox(),
      navigation.getByRole('button', { name: 'Previous week' }).boundingBox(),
      navigation.locator('.week-navigation-label').boundingBox(),
      navigation.getByRole('button', { name: 'Next week' }).boundingBox(),
      section.locator('.calendar-view').boundingBox(),
    ]);
    expect(left.x - bounds.x).toBeGreaterThanOrEqual(12);
    expect(left.x - bounds.x).toBeLessThanOrEqual(16);
    expect(bounds.x + bounds.width - right.x - right.width).toBeGreaterThanOrEqual(12);
    expect(bounds.x + bounds.width - right.x - right.width).toBeLessThanOrEqual(16);
    expect(Math.abs(label.x + label.width / 2 - bounds.x - bounds.width / 2)).toBeLessThan(12);
    expect(chart.y).toBeGreaterThan(label.y + label.height - 1);
    await expect(section.locator('.meta')).toBeHidden();
    return;
  }
  const [bounds, left, label, right, total] = await Promise.all([
    section.locator('.timeline-shell').boundingBox(),
    navigation.getByRole('button', { name: 'Previous week' }).boundingBox(),
    navigation.locator('.week-navigation-label').boundingBox(),
    navigation.getByRole('button', { name: 'Next week' }).boundingBox(),
    section.locator('.tracked').boundingBox(),
  ]);
  expect(bounds && left && label && right && total).toBeTruthy();
  expect(left.x - bounds.x).toBeGreaterThanOrEqual(12);
  expect(left.x - bounds.x).toBeLessThanOrEqual(16);
  expect(bounds.x + bounds.width - right.x - right.width).toBeGreaterThanOrEqual(12);
  expect(bounds.x + bounds.width - right.x - right.width).toBeLessThanOrEqual(16);
  expect(Math.abs(label.x + label.width / 2 - bounds.x - bounds.width / 2)).toBeLessThan(12);
  expect(total.y).toBeGreaterThan(label.y + label.height - 1);
  expect(total.y - label.y - label.height).toBeLessThanOrEqual(20);
  await expect(section.locator('.domain-start')).toBeHidden();
  await expect(section.locator('.domain-end')).toBeHidden();
}

async function expectCalendarWeekLayout(root) {
  const host = root.locator('.task-timeline-host');
  if (await host.locator('.meta').isHidden()) {
    const [navigation, chart] = await Promise.all([
      root.locator('.week-navigation').boundingBox(), host.locator('.calendar-view').boundingBox(),
    ]);
    expect(navigation.y + navigation.height).toBeLessThanOrEqual(chart.y);
    await expect(host.locator('.details')).toHaveCSS('position', 'fixed');
    await expect(host.locator('.meta')).toBeHidden();
    return;
  }
  const [navigation, total, chart] = await Promise.all([
    root.locator('.week-navigation').boundingBox(),
    host.locator('.tracked').boundingBox(),
    host.locator('.calendar-view').boundingBox(),
  ]);
  expect(navigation && total && chart).toBeTruthy();
  expect(navigation.y + navigation.height).toBeLessThanOrEqual(total.y);
  expect(total.y + total.height).toBeLessThanOrEqual(chart.y);
  await expect(host.locator('.details')).toHaveCSS('position', 'fixed');
}

async function expectRunningCardFits(root) {
  const card = root.locator('.active-task-strip.is-active');
  await expect(card.locator('.running-status-live')).toHaveText('Tracking now');
  await expect(card.locator('.running-status-elapsed')).toBeVisible();
  await expect(card.locator('.running-status-today')).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Stop and save' })).toBeVisible();
  const appearance = await card.evaluate(element => {
    const style = getComputedStyle(element);
    const badge = getComputedStyle(element.querySelector('.running-status-live'));
    return { borderWidth: style.borderLeftWidth, borderColor: style.borderLeftColor,
      background: style.backgroundImage, radius: style.borderRadius,
      badgeBackground: badge.backgroundColor, badgeColor: badge.color };
  });
  expect(appearance.borderWidth).toBe('1px');
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

async function expectViewTabsInHeader(root, selected = 'Timeline') {
  const card = root.locator('.active-task-strip');
  const tabs = root.locator('.tracker-toolbar .timeline-view-modes');
  await expect(tabs.getByRole('button')).toHaveCount(3);
  await expect(tabs.locator('svg')).toHaveCount(3);
  await expect(tabs.getByRole('button', { name: selected })).toHaveAttribute('aria-pressed', 'true');
  const [cardBox, tabsBox, weekBox] = await Promise.all([
    card.boundingBox(), tabs.boundingBox(), root.locator('.week-navigation').first().boundingBox(),
  ]);
  expect(cardBox && tabsBox && weekBox).toBeTruthy();
  expect(tabsBox.y + tabsBox.height).toBeLessThanOrEqual(cardBox.y + 1);
  expect(weekBox.y).toBeGreaterThanOrEqual(cardBox.y + cardBox.height - 1);
}

async function expectPanelScroll(page, root, selector) {
  const scroller = root.locator(selector);
  await expect.poll(() => scroller.evaluate(element => element.scrollHeight - element.clientHeight)).toBeGreaterThan(30);
  const bounds = await scroller.boundingBox();
  await page.mouse.move(bounds.x + bounds.width - 8, bounds.y + bounds.height / 2);
  await page.mouse.wheel(0, 320);
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  const surface = await scroller.boundingBox();
  await page.mouse.move(surface.x + 8, surface.y + surface.height / 2);
  await page.mouse.wheel(0, -320);
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBe(0);
  await page.mouse.wheel(0, 45);
  await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await scroller.evaluate(element => { element.scrollTop = 0; });
  await root.locator('.task-timeline-host .viewport').evaluate(element => element.scrollIntoView({ block: 'center' }));
  const beforeViewportWheel = await scroller.evaluate(element => element.scrollTop);
  const viewport = await root.locator('.task-timeline-host .viewport').boundingBox();
  const visibleTop = Math.max(viewport.y, surface.y);
  const visibleBottom = Math.min(viewport.y + viewport.height, surface.y + surface.height);
  expect(visibleBottom - visibleTop).toBeGreaterThan(8);
  await page.mouse.move(viewport.x + viewport.width / 2, (visibleTop + visibleBottom) / 2);
  const atBottom = await scroller.evaluate(element => element.scrollTop >= element.scrollHeight - element.clientHeight - 1);
  await page.mouse.wheel(0, atBottom ? -45 : 45);
  if (atBottom) await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeLessThan(beforeViewportWheel);
  else await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(beforeViewportWheel);
  const afterViewportWheel = await scroller.evaluate(element => element.scrollTop);
  const moved = await root.locator('.task-timeline-host .viewport').boundingBox();
  await page.mouse.move(moved.x + moved.width / 2, Math.max(surface.y + 5, moved.y + 5));
  await page.mouse.wheel(0, atBottom ? 45 : -45);
  if (atBottom) await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(afterViewportWheel);
  else await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeLessThan(afterViewportWheel);
  const horizontalViewport = root.locator('.task-timeline-host .viewport');
  const horizontal = await horizontalViewport.evaluate(element => ({ left: element.scrollLeft,
    available: element.scrollWidth - element.clientWidth }));
  expect(horizontal.available).toBeGreaterThan(1); // Scroll width varies with viewport and font metrics.
  // The page was scrolled vertically above; reuse neither its old viewport
  // bounding box nor a pointer position that may now sit outside the timeline.
  const currentViewport = await horizontalViewport.boundingBox();
  const currentSurface = await scroller.boundingBox();
  const centerY = (Math.max(currentViewport.y, currentSurface.y)
    + Math.min(currentViewport.y + currentViewport.height, currentSurface.y + currentSurface.height)) / 2;
  if (horizontal.available > 80) {
    await page.mouse.move(currentViewport.x + currentViewport.width / 2, centerY);
    await page.mouse.wheel(horizontal.left > horizontal.available / 2 ? -80 : 80, 0);
    await expect.poll(() => horizontalViewport.evaluate((element, left) =>
      Math.abs(element.scrollLeft - left), horizontal.left)).toBeGreaterThan(1);
  } else {
    // At wide desktop widths the content can exceed the viewport by only
    // the scrollbar gutter (~40px). Check that it is actually scrollable,
    // without asserting a full-size wheel gesture is delivered to that sliver.
    const scrollLeft = await horizontalViewport.evaluate(element => {
      element.scrollLeft = element.scrollWidth - element.clientWidth;
      return element.scrollLeft;
    });
    expect(scrollLeft).toBeGreaterThan(1);
  }
  await scroller.evaluate(element => { element.scrollTop = 0; });
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
    await writeFile(join(extension, 'test-worker.js'), workerSource.replaceAll('configured: true, active,', "configured: true, interfaceWidth: 'full', active,"));
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium', headless: true,
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
    await activity.locator('#activity-view-switcher').getByRole('button', { name: 'List', exact: true }).click();
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
    await activity.locator('#activity-view-switcher').getByRole('button', { name: 'Calendar', exact: true }).click();
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
    await expectCalendarWeekLayout(activityRoot);
    await activity.setViewportSize({ width: 480, height: 900 });
    await expectWeekHeaderLayout(activityRoot);
    await expectCalendarWeekLayout(activityRoot);
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
    await activity.locator('#activity-view-switcher').getByRole('button', { name: 'List', exact: true }).click();
    await expect(activityRoot.locator('.times-list-total')).toHaveText(/Total: 1h [1-9]\d*m/);
    await activityRoot.getByRole('button', { name: 'Previous week' }).click();
    await activity.locator('#activity-view-switcher').getByRole('button', { name: 'Calendar', exact: true }).click();
    await expect(activityRoot.locator('.week-navigation')).toHaveCount(1);
    await activity.close();
    activity = await context.newPage();
    await activity.clock.setFixedTime(fixedNow);
    activity.on('pageerror', error => errors.push(error.message));
    await activity.goto(`chrome-extension://${id}/src/times/times.html`);
    activityRoot = activity.locator('#clockoli-times-root').locator('> *');
    await expect(activity.locator('#activity-view-switcher').getByRole('button', { name: 'Calendar', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(activityRoot.locator('.week-navigation')).toHaveCount(1);
    await activity.locator('#activity-view-switcher').getByRole('button', { name: 'Timeline', exact: true }).click();
    await expect(activityRoot.locator('.week-navigation')).toHaveCount(1);
    await expect(activityRoot.getByRole('button', { name: 'Previous week' })).toHaveCount(1);
    await expect(activityRoot.getByRole('button', { name: 'Next week' })).toHaveCount(1);
    await activityRoot.getByRole('button', { name: 'Previous week' }).click();
    await expect(activityRoot.locator('.week-navigation')).toHaveCount(1);
    const editHour = await worker.evaluate(() => {
      const start = new Date(); start.setHours(start.getHours() - 1, 59, 0, 0);
      active.startedAt = start.toISOString();
      return start.getHours();
    });
    const editClock = minute => `${String(editHour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    const editDigits = minute => `${String(editHour).padStart(2, '0')}${String(minute).padStart(2, '0')}`;
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date());
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://github.com/acme/app/issues/42', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body><header><div class="AppHeader-actions"><img class="avatar" alt="User"></div></header><main><h1>Test issue</h1></main></body></html>' }));
    await page.goto('https://github.com/acme/app/issues/42');
    const githubRoot = page.locator('#clockoli-root');
    await expect(githubRoot).toBeVisible();
    await worker.evaluate(() => { active.description = ['First line', 'Second line', 'Third line', 'Fourth line'].join('\n'); });
    await githubRoot.locator('.trigger-main').click();
    const popupRoot = page.locator('#clockoli-full-width-popup-root');
    await expectRunningCardFits(popupRoot);
    const popupCard = popupRoot.locator('.active-task-strip.is-active');
    const startField = popupCard.locator('.running-status-start-field');
    await expect(startField.locator('.running-status-start-caption')).toHaveText('Start');
    await expect(startField.locator('.running-status-start')).toHaveValue(editClock(59));
    await expect(popupCard.locator('.strip-favicon')).toHaveCount(0);
    await expect(popupCard.locator('.strip-task .task-title')).toHaveCSS('max-width', 'none');
    await expect(popupCard.locator('.running-elapsed')).toHaveText(/^\d+(?:h \d+)?m$/);
    await expect(popupCard.getByRole('button', { name: 'Switch to this task' })).toHaveCount(0);
    const rail = await popupCard.evaluate(node => getComputedStyle(node).borderLeftWidth);
    expect(rail).toBe('1px');
    await startField.locator('.running-status-start').fill(editDigits(58));
    await startField.getByRole('button', { name: 'Save start' }).click();
    await expect.poll(() => worker.evaluate(() => globalThis.activeStartEdits.length)).toBe(1);
    await expect.poll(() => worker.evaluate(() => [new Date(active.startedAt).getHours(), new Date(active.startedAt).getMinutes()])).toEqual([editHour, 58]);
    await expect(startField.locator('.running-status-start')).toHaveValue(editClock(58));
    await worker.evaluate(() => { globalThis.rejectStartEdit = true; });
    await startField.locator('.running-status-start').fill(editDigits(57));
    await startField.getByRole('button', { name: 'Save start' }).click();
    await expect(popupRoot.locator('.panel-feedback')).toContainText('Start would overlap another entry.');
    await expect(startField.locator('.running-status-start')).toHaveValue(editClock(57));
    expect(await worker.evaluate(() => [new Date(active.startedAt).getHours(), new Date(active.startedAt).getMinutes()])).toEqual([editHour, 58]);
    await worker.evaluate(() => {
      globalThis.rejectStartEdit = false;
      const start = new Date(active.startedAt); start.setMinutes(56); active.startedAt = start.toISOString();
    });
    const readsBeforeExternalEdit = await worker.evaluate(() => globalThis.stateReads);
    await startField.locator('.running-status-start').press('Enter');
    await expect.poll(() => worker.evaluate(() => globalThis.stateReads)).toBeGreaterThan(readsBeforeExternalEdit);
    await expect(popupRoot.locator('.panel-feedback')).toContainText('Start changed elsewhere');
    expect(await worker.evaluate(() => globalThis.activeStartEdits.length)).toBe(1);
    expect(await worker.evaluate(() => new Date(active.startedAt).getMinutes())).toBe(56);
    await popupRoot.getByRole('button', { name: 'Close Clockoli' }).click();
    await githubRoot.locator('.trigger-main').click();
    await expect(startField.locator('.running-status-start')).toHaveValue(editClock(56));
    await worker.evaluate(() => { globalThis.holdNextStartEdit = true; });
    await startField.locator('.running-status-start').fill(editDigits(55));
    await startField.getByRole('button', { name: 'Save start' }).click();
    await expect.poll(() => worker.evaluate(() => typeof globalThis.finishHeldStartEdit)).toBe('function');
    await worker.evaluate(() => { const start = new Date(active.startedAt); start.setMinutes(54); active.startedAt = start.toISOString(); });
    const readsBeforeLateEdit = await worker.evaluate(() => globalThis.stateReads);
    await worker.evaluate(() => { globalThis.finishHeldStartEdit(); globalThis.finishHeldStartEdit = null; });
    await expect.poll(() => worker.evaluate(() => globalThis.stateReads)).toBeGreaterThan(readsBeforeLateEdit);
    await expect(popupRoot.locator('.panel-feedback')).toContainText('Start changed elsewhere');
    await expect(startField.locator('.running-status-start')).toHaveValue(editClock(55));
    expect(await worker.evaluate(() => new Date(active.startedAt).getMinutes())).toBe(54);
    await popupRoot.getByRole('button', { name: 'Close Clockoli' }).click();
    await githubRoot.locator('.trigger-main').click();
    await expect(startField.locator('.running-status-start')).toHaveValue(editClock(54));
    const popupStats = popupRoot.locator('.active-task-strip .running-status-stats');
    await expect(popupStats.locator('.running-status-metric-label')).toHaveText(['Duration']);
    const popupOverview = popupRoot.locator('.popup-overview-layout');
    const popupSummary = popupRoot.locator('.tracker-toolbar .activity-weekly-summary');
    await expect(popupSummary.locator('.activity-weekly-label')).toHaveText('Statistic');
    await expect(popupSummary.locator('.activity-weekly-name')).toHaveText(['Today', 'Total tracked', 'Tasks worked on']);
    await expect(popupOverview.locator('.active-task-strip')).toBeVisible();
    await expect(popupSummary.locator('[data-stat="total"]')).toHaveText(/^\d+(?:h \d+)?m$/);
    const popupMetrics = await popupStats.evaluate(node => ({
      background: getComputedStyle(node).backgroundColor,
      aligned: [...node.querySelectorAll('.running-status-metric-value')]
        .map(value => value.getBoundingClientRect().top),
    }));
    expect(popupMetrics.background).not.toBe('rgba(0, 0, 0, 0)');
    expect(Math.max(...popupMetrics.aligned) - Math.min(...popupMetrics.aligned)).toBeLessThan(6);
    await page.setViewportSize({ width: 1920, height: 900 });
    const wideCard = await popupRoot.locator('.active-task-strip.is-active').boundingBox();
    const wideSummary = await popupSummary.boundingBox();
    const brandBox = await popupRoot.locator('.tracker-toolbar .timeline-brand').boundingBox();
    expect(wideSummary.x).toBeGreaterThan(brandBox.x + brandBox.width);
    expect(wideSummary.width).toBeLessThan(420);
    expect(wideCard.y).toBeGreaterThanOrEqual(wideSummary.y + wideSummary.height);
    expect(wideCard.height).toBeLessThan(86);
    expect(wideCard.width).toBeGreaterThan(1500);
    const descriptionLayout = await popupRoot.locator('.strip-description-field').evaluate(node => ({
      directChild: node.parentElement.classList.contains('active-task-strip'),
      width: node.getBoundingClientRect().width,
    }));
    expect(descriptionLayout.directChild).toBe(true);
    expect(descriptionLayout.width).toBeGreaterThan(100);
    await page.setViewportSize({ width: 1280, height: 900 });
    const runningDescription = popupRoot.locator('.strip-description');
    await expect(runningDescription).toHaveJSProperty('tagName', 'TEXTAREA');
    await expect(runningDescription).toHaveValue('First line\nSecond line\nThird line\nFourth line');
    await runningDescription.focus();
    await expect.poll(() => runningDescription.evaluate(el => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(2);
    await runningDescription.fill('First line');
    await runningDescription.press('Shift+Enter');
    await runningDescription.pressSequentially('Second line');
    await expect(runningDescription).toHaveValue('First line\nSecond line');
    await runningDescription.press('Enter');
    await expect.poll(() => worker.evaluate(() => globalThis.activeDescriptionEdits.length)).toBe(1);
    expect(await worker.evaluate(() => globalThis.activeDescriptionEdits[0].description)).toBe('First line\nSecond line');
    await expect(popupRoot.locator('.description-saved')).toHaveText('✓ Saved');
    await expect(popupRoot.locator('.active-task-strip.is-active')).toBeVisible();
    await worker.evaluate(() => { active.description = 'Newer description from Activity'; });
    await startField.locator('.running-status-start').fill(editDigits(53));
    await startField.getByRole('button', { name: 'Save start' }).click();
    await expect.poll(() => worker.evaluate(() => new Date(active.startedAt).getMinutes())).toBe(53);
    const startOnlyPayload = await worker.evaluate(() => globalThis.activeStartEdits.at(-1));
    expect(startOnlyPayload).not.toHaveProperty('description');
    expect(await worker.evaluate(() => active.description)).toBe('Newer description from Activity');
    await runningDescription.fill('Finished work\nReviewed changes');
    await runningDescription.press('Tab');
    await expect(startField.locator('.running-status-start')).toBeFocused();
    await startField.locator('.running-status-start').press('Tab');
    const stopAndSave = popupRoot.getByRole('button', { name: 'Stop and save' });
    await expect(stopAndSave).toBeFocused();
    await expect.poll(() => worker.evaluate(() => globalThis.activeDescriptionEdits.length)).toBe(2);
    await expect(stopAndSave).toBeFocused();
    expect(await worker.evaluate(() => globalThis.activeDescriptionEdits[1].description)).toBe('Finished work\nReviewed changes');
    await page.screenshot({ path: join(tmpdir(), 'clockoli-popup-active-before.png') });
    await expectViewTabsInHeader(popupRoot);
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
    await expect(popupSummary.locator('[data-stat="total"]')).toHaveText('1h 0m');
    await popupRoot.locator('.task-timeline-host .viewport').evaluate(element => { element.scrollLeft = element.scrollWidth; });
    await expectVisibleTimelineInsideSelectedWeek(popupRoot);
    await popupRoot.getByRole('button', { name: 'Previous week' }).click();
    await expect(popupRoot.locator('.task-timeline-host .task.running')).toHaveCount(0);
    await expect(popupRoot.locator('.task-timeline-host .tracked')).toHaveText('Total: 0m');
    await expect(popupSummary.locator('[data-stat="total"]')).toHaveText('0m');
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
    await popupRoot.locator('.full-width-popup').evaluate(node => { node.scrollTop = 0; });
    const calendarSpace = await popupRoot.locator('.full-width-popup').evaluate(popup => {
      const grid = popup.querySelector('.task-timeline-host').shadowRoot.querySelector('.calendar-viewport').getBoundingClientRect();
      const bounds = popup.getBoundingClientRect();
      return Math.max(0, Math.min(grid.bottom, bounds.bottom) - Math.max(grid.top, bounds.top));
    });
    expect(calendarSpace).toBeGreaterThan(350);
    await expectCalendarWeekLayout(popupRoot);
    await expectWeekHeaderLayout(popupRoot);
    await page.setViewportSize({ width: 480, height: 900 });
    await expectRunningCardFits(popupRoot);
    const [narrowSummary, narrowCard] = await Promise.all([popupSummary.boundingBox(), popupCard.boundingBox()]);
    expect(narrowCard.y).toBeGreaterThan(narrowSummary.y + narrowSummary.height);
    await expectViewTabsInHeader(popupRoot, 'Calendar');
    await expectWeekHeaderLayout(popupRoot);
    await expectCalendarWeekLayout(popupRoot);
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
    const beforeCrossRead = await worker.evaluate(() => globalThis.weekReads.length);
    await worker.evaluate(() => { globalThis.includeCrossWeek = true; });
    await popupRoot.getByRole('button', { name: 'Calendar', exact: true }).click();
    await expect.poll(() => worker.evaluate((before) => globalThis.weekReads.length > before, beforeCrossRead)).toBe(true);
    // Cross-week block ends at 01:00 Monday; Calendar starts near 08:00 and
    // virtualizes off-screen blocks, so reveal the start of the day first.
    await popupRoot.locator('.calendar-viewport').evaluate(element => { element.scrollTop = 0; });
    await expect(popupRoot.locator('.calendar-task').filter({ hasText: 'Cross-week entry' })).toBeVisible();
    await popupRoot.getByRole('button', { name: 'List', exact: true }).click();
    await expect(popupRoot.getByRole('link', { name: 'Cross-week entry' })).toBeVisible();
    await activity.locator('#activity-view-switcher').getByRole('button', { name: 'Calendar', exact: true }).click();
    await activityRoot.locator('.calendar-viewport').evaluate(element => { element.scrollTop = 0; });
    await expect(activityRoot.locator('.calendar-task').filter({ hasText: 'Cross-week entry' })).toBeVisible();
    await expect(activityRoot.locator('.calendar-day-header').first()).toContainText(new Date().getDay() === 1 ? 'Tracked: 2h' : 'Tracked: 1h');
    await activity.locator('#activity-view-switcher').getByRole('button', { name: 'List', exact: true }).click();
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
    const toolbarControls = await toolbarRoot.locator('.active-task-strip.is-active').evaluate(strip => {
      const stats = strip.querySelector('.running-status-stats').getBoundingClientRect();
      const stop = strip.querySelector(':scope > .danger').getBoundingClientRect();
      const bounds = strip.getBoundingClientRect();
      return { statsRight: stats.right, stopLeft: stop.left, stopRight: stop.right, stripRight: bounds.right };
    });
    expect(toolbarControls.statsRight).toBeLessThanOrEqual(toolbarControls.stopLeft);
    expect(toolbarControls.stopRight).toBeLessThanOrEqual(toolbarControls.stripRight);
    await expect(toolbarRoot.locator('.tracker-toolbar .activity-weekly-name')).toHaveText(['Today', 'Total tracked', 'Tasks worked on']);
    await expect(toolbarRoot.locator('.tracker-toolbar .activity-weekly-value').first()).toBeVisible();
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
    await expectViewTabsInHeader(toolbarRoot);
    await toolbarRoot.getByRole('button', { name: 'List', exact: true }).click();
    await expectViewTabsInHeader(toolbarRoot, 'List');
    await expect(toolbarRoot.locator('.today-list.activity-list .entry-record')).not.toHaveCount(0);
    expect(await toolbarRoot.locator('.today-list').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await toolbarRoot.getByRole('button', { name: 'Timeline', exact: true }).click();
    await toolbarRoot.locator('.task-timeline-host .task').first().hover();
    const toolbarDetails = toolbarRoot.locator('.task-timeline-host .details');
    await expect(toolbarDetails).toHaveClass(/clockoli-compact-entry-details/);
    await expect(toolbarDetails.locator('.clockoli-details-task-icon')).toBeVisible();
    await expect(toolbarDetails.locator('.details-value').first()).toBeHidden();
    await toolbar.setViewportSize({ width: 420, height: 520 });
    await expectPanelScroll(toolbar, toolbarRoot, '.menu');
    await toolbar.close();
    const other = await context.newPage();
    other.on('pageerror', error => errors.push(error.message));
    await other.route('https://github.com/acme/app/issues/43', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body><header><div class="AppHeader-actions"><img class="avatar" alt="User"></div></header><main><h1>Another issue</h1></main></body></html>' }));
    await other.goto('https://github.com/acme/app/issues/43');
    await other.locator('#clockoli-root .trigger-main').click();
    const otherPopup = other.locator('#clockoli-full-width-popup-root');
    await expect(otherPopup.locator('.active-task-strip').getByRole('button', { name: 'Switch to this task' })).toHaveCount(0);
    const switchButton = otherPopup.locator('.timeline-toolbar-end .popup-switch-action').getByRole('button', { name: 'Switch to this task' });
    await expect(switchButton).toBeVisible();
    await expect(switchButton).toHaveClass(/primary/);
    const switchPosition = await otherPopup.locator('.timeline-toolbar-end').evaluate(row => {
      const modes = row.querySelector('.timeline-view-modes').getBoundingClientRect();
      const action = row.querySelector('.popup-switch-action').getBoundingClientRect();
      return { modesRight: modes.right, actionLeft: action.left };
    });
    expect(switchPosition.actionLeft).toBeGreaterThan(switchPosition.modesRight);
    await other.screenshot({ path: join(tmpdir(), 'clockoli-different-task-card.png') });
    await other.close();
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
      .replace('today.getDate(), 2).toISOString()', 'today.getDate(), 10).toISOString()')
      .replace('today.getDate(), 3).toISOString()', 'today.getDate(), 11).toISOString()')
      .replace('active, recent: [current]', 'active: null, recent: [current]')
      .replace('active, pendingWrites: []', 'active: null, pendingWrites: []');
    await writeFile(join(extension, 'test-worker.js'), daytimeWorker);
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium', headless: true,
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


test('Activity follows the theme switch in every shadow-root surface without a reload', async () => {
  test.setTimeout(45000);
  const extension = await mkdtemp(join(tmpdir(), 'clockoli-theme-extension-'));
  const profile = await mkdtemp(join(tmpdir(), 'clockoli-theme-profile-'));
  let context;
  try {
    await cp(new URL('src/', ROOT), join(extension, 'src'), { recursive: true });
    const rendererPath = join(extension, 'src/content/github.js');
    await writeFile(rendererPath, (await readFile(rendererPath, 'utf8')).replaceAll("mode: 'closed'", "mode: 'open'"));
    const manifest = JSON.parse(await readFile(new URL('manifest.json', ROOT), 'utf8'));
    manifest.background = { service_worker: 'test-worker.js' };
    await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest) + '\n');
    await writeFile(join(extension, 'test-worker.js'), workerSource.replaceAll(
      'configured: true, active, ', 'configured: true, active: null, '));
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium', headless: true,
      args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension],
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const errors = [];
    worker.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const id = new URL(worker.url()).host;
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('chrome-extension://' + id + '/src/times/times.html');
    const switcher = page.locator('.page-theme-toggle');
    await expect(switcher).toHaveAttribute('aria-label', 'Switch to dark theme');
    await expect(page.locator('.running-status.is-idle .running-status-row')).toBeVisible();
    await page.getByRole('button', { name: 'Calendar', exact: true }).click();
    const activity = page.locator('#clockoli-times-root');
    const panel = page.locator('.running-status.is-idle .running-status-row');
    const card = page.locator('#activity-summary');
    const calendar = activity.locator('.calendar-viewport');
    await expect(calendar).toBeVisible();
    await expect(card).toHaveCSS('background-color', 'rgb(246, 248, 250)');
    await expect(calendar).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(panel).toHaveCSS('background-color', 'rgb(255, 255, 255)');

    await switcher.click();
    await expect(page.locator('html')).toHaveAttribute('data-clockoli-theme', 'dark');
    await expect(activity).toHaveAttribute('data-clockoli-theme', 'dark');
    await expect(card).toHaveCSS('background-color', 'rgb(21, 27, 35)');
    await expect(calendar).toHaveCSS('background-color', 'rgb(13, 17, 23)');
    await expect(panel).toHaveCSS('background-color', 'rgb(13, 17, 23)');
    await expect(activity.locator('.times-page')).toHaveCSS('background-color', 'rgb(13, 17, 23)');
    await expect(activity.locator('.calendar-day-header:not(.today)').first()).toHaveCSS('background-color', 'rgb(21, 27, 35)');
    await expect(page.locator('.running-status-quick-label')).toBeVisible();
    await expect(page.locator('.running-status-idle')).toHaveText('Not tracking');

    // A manual light selection must override a dark OS preference as well.
    await page.emulateMedia({ colorScheme: 'dark' });
    await switcher.click();
    await expect(card).toHaveCSS('background-color', 'rgb(246, 248, 250)');
    await expect(calendar).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(panel).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await page.emulateMedia({ colorScheme: 'light' });
    await switcher.click();
    await page.reload();
    await expect(switcher).toHaveAttribute('aria-label', 'Switch to light theme');
    await expect(page.locator('#clockoli-times-root .times-page')).toHaveCSS('background-color', 'rgb(13, 17, 23)');
    expect(errors).toEqual([]);
  } finally {
    await context?.close();
    await rm(extension, { recursive: true, force: true });
    await rm(profile, { recursive: true, force: true });
  }
});
