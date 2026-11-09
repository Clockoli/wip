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
const runningStart = new Date(Date.now() - 10 * 60_000);
runningStart.setSeconds(0, 0);
const active = { id: 'running', taskUrl: 'https://github.com/acme/app/issues/42',
  taskTitle: 'Running task', startedAt: runningStart.toISOString() };
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
  if (await navigation.locator('.week-navigation-label').isHidden()) {
    await expect(section.locator('.calendar-view:visible,.viewport:visible')).toBeVisible();
    await expect(section.locator('.calendar-sticky-header:visible,.day-row:visible')).toBeVisible();
    // ResizeObserver may reflow the shared timeline after the browser viewport
    // changes. Wait for a complete header snapshot, not a half-updated layout.
    let geometry;
    await expect.poll(async () => {
      // Query the *visible* timeline/calendar view, not the first matching
      // hidden view. Read its header geometry in one browser frame: querying
      // an absent opposite-mode marker with locator.boundingBox() can wait
      // for the full Playwright timeout instead of returning null.
      const [bounds, left, right, view] = await Promise.all([
        section.locator('.timeline-shell').boundingBox(),
        navigation.getByRole('button', { name: 'Previous week' }).boundingBox(),
        navigation.getByRole('button', { name: 'Next week' }).boundingBox(),
        section.locator('.calendar-view:visible,.viewport:visible').first().evaluate(activeView => {
          const rect = node => {
            if (!node) return null;
            const box = node.getBoundingClientRect();
            return box.width && box.height
              ? { x: box.x, y: box.y, width: box.width, height: box.height } : null;
          };
          return {
            chart: rect(activeView),
            header: rect(activeView.querySelector('.calendar-sticky-header,.day-row')),
            ruler: rect(activeView.querySelector('.ruler-row')),
            firstDay: rect(activeView.querySelector('.calendar-day-header')),
          };
        }),
      ]);
      const { chart, header, ruler, firstDay } = view;
      geometry = { bounds, left, right, chart, header, ruler, firstDay };
      return { shell: Boolean(bounds), previous: Boolean(left), next: Boolean(right),
        chart: Boolean(chart), header: Boolean(header),
        dayHeaderOrRuler: Boolean(ruler || firstDay) };
    }, { message: 'Week navigation and calendar header settle after resizing' }).toEqual({
      shell: true, previous: true, next: true, chart: true, header: true, dayHeaderOrRuler: true,
    });
    const { bounds, left, right, chart, header, ruler } = geometry;
    expect(await navigation.evaluate(element => element.parentElement?.classList.contains('timeline-shell'))).toBe(true);
    if (!ruler) expect(Math.abs((await navigation.boundingBox()).height - header.height)).toBeLessThan(2);
    if (ruler) {
      expect(left.x - bounds.x).toBeGreaterThanOrEqual(12);
      expect(bounds.x + bounds.width - right.x - right.width).toBeGreaterThanOrEqual(12);
    } else {
      expect(right.x + right.width).toBeLessThanOrEqual(geometry.firstDay.x);
      expect(right.x - left.x).toBe(left.width - 1);
    }
    await expect(navigation.locator('.week-navigation-label')).toBeHidden();
    await expect(section.locator('.meta')).toBeHidden();
    for (const arrow of [left, right]) {
      expect(arrow.y + arrow.height / 2).toBeGreaterThanOrEqual(header.y);
      expect(arrow.y + arrow.height / 2).toBeLessThanOrEqual(ruler ? ruler.y + ruler.height : header.y + header.height);
      expect(Math.abs(arrow.y + arrow.height / 2
        - (header.y + (ruler ? ruler.y + ruler.height - header.y : header.height) / 2))).toBeLessThan(2);
    }
    const backdrop = await navigation.evaluate(element => ({
      surface: getComputedStyle(element).pointerEvents,
      arrow: getComputedStyle(element.querySelector('button')).pointerEvents,
      left: getComputedStyle(element, '::before').backgroundImage,
      right: getComputedStyle(element, '::after').backgroundImage,
    }));
    expect(backdrop.surface).toBe('none');
    expect(backdrop.arrow).toBe('auto');
    if (ruler) {
      expect(backdrop.left).toContain('gradient');
      expect(backdrop.right).toContain('gradient');
    }
    expect(await navigation.evaluate(element => [...element.querySelectorAll('.week-navigation-button')].map(button => {
      const rect = button.getBoundingClientRect();
      return button.contains(element.getRootNode().elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
    }))).toEqual([true, true]);
    return;
  }
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
    if (await root.locator('.week-navigation').evaluate(element => element.parentElement?.classList.contains('timeline-shell'))) {
      expect(Math.abs(navigation.y - chart.y)).toBeLessThan(2);
    } else {
      expect(navigation.y + navigation.height).toBeLessThanOrEqual(chart.y);
    }
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

async function expectActivityChartGap(page, root, expected) {
  const [overview, chart] = await Promise.all([
    page.locator('.activity-overview-layout').boundingBox(),
    root.locator('.popup-timeline-section .timeline-shell').boundingBox(),
  ]);
  expect(overview && chart).toBeTruthy();
  expect(Math.abs(chart.y - overview.y - overview.height - expected)).toBeLessThan(2);
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

test('Activity preserves Monday–Sunday Timeline and Calendar week navigation', async () => {
  // This browser scenario exercises multiple views, screen sizes, and week transitions.
  test.setTimeout(180000);
  // Keep the fixture in the browser's current week; pin all test clocks to the
  // same instant so a running block cannot disappear into a past week.
  const fixedNow = new Date();
  fixedNow.setSeconds(0, 0);
  const clockOffset = fixedNow.getTime() - Date.now();
  const extension = await mkdtemp(join(tmpdir(), 'clockoli-week-extension-'));
  const profile = await mkdtemp(join(tmpdir(), 'clockoli-week-profile-'));
  let context;
  try {
    await cp(new URL('src/', ROOT), join(extension, 'src'), { recursive: true });
    const rendererPath = join(extension, 'src/content/github.js');
    // The isolated content-script world does not follow page.clock.
    // Pin it too so the running timer cannot overlap the completed fixture.
    await writeFile(rendererPath, `const RealDate = Date;
    globalThis.Date = class extends RealDate {
      constructor(...args) { super(...(args.length ? args : [RealDate.now() + ${clockOffset}])); }
      static now() { return RealDate.now() + ${clockOffset}; }
    };
    ` + (await readFile(rendererPath, 'utf8')).replaceAll("mode: 'closed'", "mode: 'open'"));
    const manifest = JSON.parse(await readFile(new URL('manifest.json', ROOT), 'utf8'));
    manifest.background = { service_worker: 'test-worker.js' };
    await writeFile(join(extension, 'manifest.json'), `${JSON.stringify(manifest)}\n`);
    const fixtureWorker = workerSource
      .replace('const today = new Date();', `const today = new Date('${fixedNow.toISOString()}');`)
      .replace('const runningStart = new Date(Date.now() - 10 * 60_000);',
        `const runningStart = new Date('${new Date(fixedNow.getTime() - 10 * 60_000).toISOString()}');`)
      .replaceAll('configured: true, active,', "configured: true, interfaceWidth: 'full', active,");
    await writeFile(join(extension, 'test-worker.js'), fixtureWorker);
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    // Content scripts use the real clock even when Playwright freezes the page clock.
    // Keep start edits in the past and calculate expectations from the fixture.
    const initialStartedAt = new Date(await worker.evaluate(() => active.startedAt));
    const shiftedStart = minutes => new Date(initialStartedAt.getTime() - minutes * 60_000);
    const startClock = minutes => shiftedStart(minutes).toTimeString().slice(0, 5);
    const startDigits = minutes => startClock(minutes).replace(':', '');
    const errors = [];
    worker.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const id = new URL(worker.url()).host;
    let activity = await context.newPage();
    await activity.clock.setFixedTime(fixedNow);
    activity.on('pageerror', error => errors.push(error.message));
    await activity.goto(`chrome-extension://${id}/src/times/times.html`);
    let activityRoot = activity.locator('#clockoli-times-root').locator('> *');
    await expect(activityRoot.getByRole('button', { name: 'Previous week' })).toBeVisible();
    await expect(activity.locator('.running-status-description')).toBeFocused();
    await activity.setViewportSize({ width: 1920, height: 900 });
    const runningLayout = await activity.locator('#activity-running-status.is-active').evaluate(card => {
      const box = selector => card.querySelector(selector).getBoundingClientRect();
      const description = box('.running-status-description');
      const stats = box('.running-status-stats');
      const stop = box('.running-status-stop');
      return { descriptionRight: description.right, statsLeft: stats.left,
        statsWidth: stats.width, stopWidth: stop.width, statsRight: stats.right, stopRight: stop.right };
    });
    expect(runningLayout.statsLeft - runningLayout.descriptionRight).toBeGreaterThanOrEqual(20);
    expect(runningLayout.statsLeft - runningLayout.descriptionRight).toBeLessThanOrEqual(24);
    expect(Math.abs(runningLayout.statsWidth - runningLayout.stopWidth)).toBeLessThan(2);
    expect(Math.abs(runningLayout.statsRight - runningLayout.stopRight)).toBeLessThan(2);
    await expectWeekHeaderLayout(activityRoot);
    await expectActivityChartGap(activity, activityRoot, 24);
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
    const listToolbar = activityRoot.locator('.times-toolbar');
    const listNavigation = listToolbar.locator('.week-navigation');
    const listRefresh = listToolbar.getByRole('button', { name: 'Refresh' });
    await expect(listNavigation).toBeVisible();
    await expect(listRefresh).toBeVisible();
    await expect(listRefresh).toHaveCSS('border-top-width', '1px');
    await expect(listRefresh).toHaveCSS('border-top-color',
      await listNavigation.getByRole('button', { name: 'Previous week' }).evaluate(node => getComputedStyle(node).borderTopColor));
    await expect(activityRoot.locator('.activity-list .section-head button')).toHaveCount(0);
    await expect(listToolbar.getByRole('searchbox', { name: 'Search activity' })).toHaveAttribute('placeholder', 'Search entries');
    await expect(listNavigation.locator('.week-navigation-label')).toHaveText(await activity.locator('#activity-summary .activity-weekly-range').innerText());
    const weekLabel = listNavigation.locator('.week-navigation-label');
    await expect(weekLabel).toHaveAttribute('data-clockoli-tooltip', 'Pick a week');
    const weekPicker = listNavigation.locator('.week-navigation-picker');
    const currentWeekLabel = await weekLabel.innerText();
    await weekLabel.click();
    await expect.poll(() => weekPicker.evaluate(input => input.matches(':open'))).toBe(true);
    await activity.keyboard.press('Escape');
    const currentWeek = await weekPicker.inputValue();
    expect(currentWeek).toMatch(/^\d{4}-W\d{2}$/);
    expect(await weekPicker.getAttribute('max')).toBe(currentWeek);
    await weekPicker.evaluate(input => {
      input.stepDown();
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(weekLabel).not.toHaveText(currentWeekLabel);
    await expect(listNavigation.getByRole('button', { name: 'Next week' })).toBeEnabled();
    await listNavigation.getByRole('button', { name: 'Next week' }).click();
    await expect(weekLabel).toHaveText(currentWeekLabel);
    const [searchBox, navBox, refreshBox, overviewBox, toolbarBox, listBox, groupBox, cardBox] = await Promise.all([
      listToolbar.getByRole('searchbox', { name: 'Search activity' }).boundingBox(), listNavigation.boundingBox(),
      listRefresh.boundingBox(), activity.locator('.activity-overview-layout').boundingBox(),
      listToolbar.boundingBox(), activityRoot.locator('.activity-list').boundingBox(),
      activityRoot.locator('.activity-list .entry').first().boundingBox(),
      activityRoot.locator('.activity-list .entry-record').first().boundingBox(),
    ]);
    expect(searchBox.x + searchBox.width).toBeLessThan(navBox.x);
    expect(navBox.x + navBox.width).toBeLessThan(refreshBox.x);
    expect(Math.abs(searchBox.y - navBox.y)).toBeLessThan(8);
    expect(Math.abs(navBox.y - refreshBox.y)).toBeLessThan(8);
    expect(toolbarBox.y - overviewBox.y - overviewBox.height).toBeGreaterThanOrEqual(16);
    expect(listBox.y - toolbarBox.y - toolbarBox.height).toBeGreaterThanOrEqual(16);
    expect(cardBox.x - groupBox.x).toBeGreaterThanOrEqual(8);
    const readsBeforeListRefresh = await worker.evaluate(() => globalThis.weekReads.length);
    await listRefresh.click();
    await expect.poll(() => worker.evaluate(() => globalThis.weekReads.length)).toBeGreaterThan(readsBeforeListRefresh);
    await expect(listToolbar.getByRole('button', { name: 'Refresh' })).toBeEnabled();
    await activityRoot.getByRole('button', { name: 'Previous week' }).click();
    await expect(activityRoot.getByText('Previous week entry', { exact: true })).toBeVisible();
    await expect(activityRoot.locator('.times-list-total')).toHaveText('Total: 1h');
    await expect(activityRoot.locator('.times-list-total')).toBeHidden();
    await expect(activityRoot.getByText('Tracked time', { exact: true })).toHaveCount(0);
    await expect(activity.locator('#activity-summary .activity-weekly-range')).toBeVisible();
    await activity.setViewportSize({ width: 390, height: 800 });
    await expect(activity.locator('#activity-summary .activity-weekly-range')).toBeVisible();
    const [narrowSearch, narrowNav, narrowRefresh] = await Promise.all([
      listToolbar.getByRole('searchbox', { name: 'Search activity' }).boundingBox(),
      listNavigation.boundingBox(), listRefresh.boundingBox(),
    ]);
    expect(narrowNav.y).toBeGreaterThan(narrowSearch.y + narrowSearch.height);
    expect(narrowNav.x + narrowNav.width).toBeLessThan(narrowRefresh.x);
    expect(await activity.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
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
    await expect(activityRoot.locator('.timeline-shell > .week-navigation')).toHaveCSS('height', '44px');
    await expectActivityChartGap(activity, activityRoot, 24);
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
    const emptyDay = activityRoot.locator('.task-timeline-host .clockoli-calendar-empty').first();
    await expect(emptyDay).toBeVisible();
    const emptyDayTop = await emptyDay.evaluate(element => element.style.top);
    const calendarBounds = await calendarViewport.boundingBox();
    expect(calendarBounds.y).toBeLessThan(520);
    await activity.mouse.move(calendarBounds.x + calendarBounds.width / 2, (Math.max(0, calendarBounds.y) + Math.min(520, calendarBounds.y + calendarBounds.height)) / 2);
    await activity.mouse.wheel(0, 120);
    await expect.poll(() => calendarViewport.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    expect(await activity.evaluate(() => window.scrollY)).toBe(0);
    await activity.waitForTimeout(1200);
    expect(await calendarViewport.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    expect(await emptyDay.evaluate(element => element.style.top)).toBe(emptyDayTop);
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
    await expectActivityChartGap(activity, activityRoot, 16);
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
    const currentWeekMinutes = 60 + Math.max(0, Math.floor((fixedNow.getTime() - initialStartedAt.getTime()) / 60_000));
    const currentWeekTotal = Math.floor(currentWeekMinutes / 60) + 'h'
      + (currentWeekMinutes % 60 ? ' ' + currentWeekMinutes % 60 + 'm' : '');
    await expect(activityRoot.locator('.times-list-total')).toHaveText('Total: ' + currentWeekTotal);
    await activityRoot.getByRole('button', { name: 'Previous week' }).click();
    await activity.locator('#activity-view-switcher').getByRole('button', { name: 'Calendar', exact: true }).click();
    await expect(activityRoot.locator('.week-navigation')).toHaveCount(1);
    const activityCalendarArrow = await activityRoot.getByRole('button', { name: 'Previous week' }).evaluate(node => {
      const style = getComputedStyle(node);
      const box = node.getBoundingClientRect();
      return { width: box.width, height: box.height, background: style.backgroundColor,
        border: style.borderTop, radius: style.borderRadius, color: style.color, fontSize: style.fontSize };
    });
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
    await expect(switcher.locator('.page-theme-moon')).toBeVisible();
    await expect(switcher.locator('.page-theme-sun')).toBeHidden();
    await expect(switcher).toHaveCSS('color', 'rgb(31, 35, 40)');
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
    await expect(switcher.locator('.page-theme-sun')).toBeVisible();
    await expect(switcher.locator('.page-theme-moon')).toBeHidden();
    await expect(switcher).toHaveCSS('color', 'rgb(240, 246, 252)');
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
    await expect(switcher.locator('.page-theme-moon')).toBeVisible();
    await expect(switcher.locator('.page-theme-sun')).toBeHidden();
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
