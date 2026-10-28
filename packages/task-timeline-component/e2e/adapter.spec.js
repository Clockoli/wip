import { test, expect } from '@playwright/test';

const HOUR = 60 * 60 * 1000;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__errors = [];
    window.addEventListener('error', event => window.__errors.push(event.message));
    window.addEventListener('unhandledrejection', event => window.__errors.push(String(event.reason)));
  });
});

test.afterEach(async ({ page }) => {
  expect(await page.evaluate(() => window.__errors || [])).toEqual([]);
});

async function mount(page, overrides = {}) {
  await page.goto('/packages/task-timeline-component/e2e/fixture.html');
  return page.evaluate(({ hour, overrides }) => {
    const now = Date.now();
    const host = document.querySelector('#timeline');
    if (overrides.closedOuter) {
      const wrapper = document.createElement('div');
      document.body.append(wrapper);
      wrapper.attachShadow({ mode: 'closed' }).append(host);
    }
    const items = overrides.scenario === 'future-after-running' ? [
      { id: 'active:c', url: 'https://example.com/c', title: 'Task C', startedAt: now - 10_000, endedAt: null, rowId: 'one', isRunning: true, isEditable: false },
      { id: 'future:d', url: 'https://example.com/d', title: 'Task D', startedAt: now + 5_000, endedAt: now + 10_000, rowId: 'two', isEditable: true },
    ] : overrides.items || [
      { id: 'entry:a', url: 'https://example.com/a', title: 'Task A', startedAt: now - 3 * hour, endedAt: now - 2 * hour, rowId: 'one', isEditable: true },
      { id: 'entry:b', url: 'https://example.com/b', title: 'Task B', startedAt: now - 2 * hour, endedAt: now - hour, rowId: 'two', isEditable: true, isPending: true },
      { id: 'active:c', url: 'https://example.com/c', title: 'Task C', startedAt: now - 120_000, endedAt: null, rowId: 'one', isRunning: true, isEditable: false },
    ];
    window.__calls = [];
    window.__descriptionResolves = [];
    window.__edits = [];
    window.__editSettlers = [];
    window.__items = items;
    window.__timeline = ClockoliTaskTimeline.createTimeline(host, {
      items,
      rows: overrides.rows || [{ id: 'one', title: 'One' }, { id: 'two', title: 'Two' }],
      now,
      view: overrides.view || { start: now - 4 * hour, end: now, focusedAt: now - 2 * hour },
      totalRange: overrides.totalRange,
      weeklyCalendar: overrides.weeklyCalendar,
      activityDashboard: overrides.activityDashboard,
      toolbarPopup: overrides.toolbarPopup,
      onWeekEdgeNavigate: overrides.edgeNavigation
        ? direction => { window.__calls.push(['edge', direction]); return true; } : undefined,
      onCalendarNavigate: overrides.trackCalendarNavigation ? range => window.__calls.push(['navigate', range.start, range.end]) : undefined,
      onStart(item) {
        window.__lastStartedTitle = item.title;
        window.__calls.push(['start', item.id]);
        return overrides.startResult !== false;
      },
      onStop(item) { window.__calls.push(['stop', item.id]); return overrides.stopResult !== false; },
      onEntryEdit: overrides.entryForm ? item => { window.__calls.push(['edit-form', item.id]); return true; } : undefined,
      onDelete(item) {
        window.__calls.push(['delete', item.id]);
        if (overrides.deleteReject) return Promise.reject(new Error('delete failed'));
        return overrides.deleteResult !== false;
      },
      onEditCommit(edit) {
        window.__calls.push(['edit', edit.id, edit.kind]);
        window.__edits.push(edit);
        if (overrides.deferEdit) return new Promise((resolve, reject) => window.__editSettlers.push({ resolve, reject }));
        if (overrides.persistPending) {
          window.__items = window.__items.map(item => item.id === edit.id ? { ...item, isPending: true } : item);
          queueMicrotask(() => window.__timeline.update({ items: window.__items, now: Date.now() }));
          return Promise.resolve(true);
        }
        return true;
      },
      onDescriptionInput(item, value) { window.__descriptionInput = [item.id, value]; },
      onDescriptionCommit(item, value) {
        window.__calls.push(['description', item.id, value]);
        if (overrides.descriptionReject) return Promise.reject(new Error('description failed'));
        if (overrides.deferDescription) return new Promise(resolve => window.__descriptionResolves.push(resolve));
        return true;
      },
      onError(error, context) { window.__calls.push(['error', context.action, error.message]); },
    });
    return now;
  }, { hour: HOUR, overrides });
}

test('Activity Calendar shows a compact inline details card with accessible actions', async ({ page }) => {
  const now = Date.now();
  await mount(page, { activityDashboard: true, entryForm: true, rows: [{ id: 'one', title: 'One' }],
    items: [{ id: 'entry:a', url: 'https://example.com/task', title: 'Resolve issues reported by the team and review the remaining work',
      faviconUrl: null, startedAt: now - 3 * HOUR, endedAt: now - HOUR, rowId: 'one', isEditable: true }] });
  await page.evaluate(() => window.__timeline.setViewMode('calendar'));
  await page.locator('#timeline .calendar-task[data-task-key="entry:a"]').first().hover();
  const details = page.locator('#timeline .details');
  await expect(details).toBeVisible();
  const visual = await details.evaluate(card => {
    const title = card.querySelector('.details-title');
    const actions = [...card.querySelectorAll('.clockoli-timeline-action')];
    const time = card.querySelector('.clockoli-details-time');
    return {
      width: card.getBoundingClientRect().width,
      background: getComputedStyle(card).backgroundColor,
      shadow: getComputedStyle(card).boxShadow,
      icon: card.querySelector('.clockoli-details-task-icon')?.textContent,
      iconRadius: card.querySelector('.clockoli-details-task-icon') && getComputedStyle(card.querySelector('.clockoli-details-task-icon')).borderRadius,
      titleOverflow: title.scrollWidth > title.clientWidth,
      titleLines: Math.round(title.getBoundingClientRect().height / parseFloat(getComputedStyle(title).lineHeight)),
      time: time?.textContent,
      timeLines: time && Math.round(time.getBoundingClientRect().height / parseFloat(getComputedStyle(time).lineHeight)),
      oldValuesHidden: [...card.querySelectorAll('.details-value')].every(node => getComputedStyle(node).display === 'none'),
      buttons: actions.map(button => ({ name: button.textContent, fontSize: getComputedStyle(button).fontSize,
        icon: Boolean(button.querySelector('svg')), top: button.getBoundingClientRect().top })),
      primaryBackground: getComputedStyle(card.querySelector('.clockoli-timeline-action.primary')).backgroundColor,
    };
  });
  expect(visual.width).toBeLessThanOrEqual(360);
  expect(visual.background).toBe('rgb(255, 255, 255)');
  expect(visual.shadow).not.toBe('none');
  expect(visual.icon).toBe('E');
  expect(visual.iconRadius).toBe('50%');
  expect(visual.titleOverflow).toBe(true);
  expect(visual.titleLines).toBe(1);
  expect(visual.time).toMatch(/^\d{2}:\d{2} – \d{2}:\d{2} · 2h$/);
  expect(visual.timeLines).toBe(1);
  expect(visual.oldValuesHidden).toBe(true);
  expect(visual.buttons.map(button => button.name)).toEqual(['Delete', 'Edit', 'Track time']);
  expect(visual.buttons.slice(0, 2).every(button => button.fontSize === '0px' && button.icon)).toBe(true);
  expect(new Set(visual.buttons.map(button => button.top)).size).toBe(1);
  expect(visual.primaryBackground).not.toBe('rgb(31, 136, 61)');
  if (process.env.CLOCKOLI_COMPACT_POPOVER_SCREENSHOT) await details.screenshot({ path: process.env.CLOCKOLI_COMPACT_POPOVER_SCREENSHOT });
  await details.getByRole('button', { name: 'Edit' }).click();
  await details.getByRole('button', { name: 'Track time' }).click();
  await details.getByRole('button', { name: 'Delete' }).click();
  await expect.poll(() => page.evaluate(() => window.__calls)).toEqual([
    ['edit-form', 'entry:a'], ['start', 'entry:a'], ['delete', 'entry:a'],
  ]);
  await page.setViewportSize({ width: 420, height: 900 });
  await page.locator('#timeline').evaluate(host => { host.style.width = '404px'; });
  await page.locator('#timeline .calendar-task[data-task-key="entry:a"]').first().hover();
  await expect.poll(() => details.evaluate(card => card.getBoundingClientRect().right)).toBeLessThanOrEqual(420);
  if (process.env.CLOCKOLI_COMPACT_POPOVER_SCREENSHOT) {
    await page.screenshot({ path: process.env.CLOCKOLI_COMPACT_POPOVER_SCREENSHOT.replace(/\.png$/, '-narrow.png') });
  }
});

test('Activity Timeline and Calendar share the compact card layout', async ({ page }) => {
  const now = Date.now();
  await mount(page, { activityDashboard: true, entryForm: true, rows: [{ id: 'one', title: 'One' }],
    items: [{ id: 'entry:a', url: 'https://example.com/task', title: 'A very long issue title that must be truncated in both views',
      startedAt: now - 3 * HOUR, endedAt: now - HOUR, rowId: 'one', isEditable: true }] });
  const details = page.locator('#timeline .details');
  const cardState = () => details.evaluate(card => ({
    width: card.getBoundingClientRect().width,
    background: getComputedStyle(card).backgroundColor,
    shadow: getComputedStyle(card).boxShadow,
    iconVisible: Boolean(card.querySelector('.clockoli-details-task-icon')?.getBoundingClientRect().width),
    time: card.querySelector('.clockoli-details-time')?.textContent,
    titleTruncated: card.querySelector('.details-title').scrollWidth > card.querySelector('.details-title').clientWidth,
    valuesHidden: [...card.querySelectorAll('.details-value')].every(value => getComputedStyle(value).display === 'none'),
    actions: [...card.querySelectorAll('.clockoli-timeline-action')].map(button => ({
      name: button.textContent, fontSize: getComputedStyle(button).fontSize,
      background: getComputedStyle(button).backgroundColor,
    })),
  }));
  await page.locator('#timeline .task[data-task-key="entry:a"]').first().hover();
  await expect(details).toBeVisible();
  const timelineCard = await cardState();
  expect(timelineCard.width).toBeLessThanOrEqual(360);
  expect(timelineCard.iconVisible).toBe(true);
  expect(timelineCard.time).toMatch(/^\d{2}:\d{2} – \d{2}:\d{2} · 2h$/);
  expect(timelineCard.titleTruncated).toBe(true);
  expect(timelineCard.valuesHidden).toBe(true);
  expect(timelineCard.actions.map(button => button.name)).toEqual(['Delete', 'Edit', 'Track time']);
  expect(timelineCard.actions.slice(0, 2).map(button => button.fontSize)).toEqual(['0px', '0px']);
  if (process.env.CLOCKOLI_COMPACT_POPOVER_SCREENSHOT) {
    await details.screenshot({ path: process.env.CLOCKOLI_COMPACT_POPOVER_SCREENSHOT.replace(/\.png$/, '-timeline.png') });
  }
  await page.evaluate(() => window.__timeline.setViewMode('calendar'));
  await page.locator('#timeline .calendar-task[data-task-key="entry:a"]').first().hover();
  await expect(details).toBeVisible();
  expect(await cardState()).toEqual(timelineCard);
});

test('popup Calendar uses the same compact details layout as Activity', async ({ page }) => {
  await mount(page, { activityDashboard: true, toolbarPopup: true, entryForm: true });
  await page.evaluate(() => window.__timeline.setViewMode('calendar'));
  await page.locator('#timeline .calendar-task[data-task-key="entry:a"]').first().hover();
  await expect(page.locator('#timeline .details')).toHaveClass(/clockoli-compact-entry-details/);
  await expect(page.locator('#timeline .details-value').first()).toBeHidden();
  await expect(page.locator('#timeline .clockoli-details-task-icon')).toBeVisible();
});

test('narrow popup Calendar falls back vertically and keeps the upper card actionable', async ({ page }) => {
  const now = Date.now();
  await mount(page, { activityDashboard: true, toolbarPopup: true, entryForm: true, weeklyCalendar: true,
    rows: [{ id: 'one', title: 'One' }],
    items: [
      { id: 'entry:a', url: 'https://example.com/a', title: 'Upper', startedAt: now - 3 * HOUR,
        endedAt: now - 2.5 * HOUR, rowId: 'one', isEditable: true },
      { id: 'entry:b', url: 'https://example.com/b', title: 'Lower', startedAt: now - 2 * HOUR,
        endedAt: now - 1.5 * HOUR, rowId: 'one', isEditable: true },
    ] });
  await page.evaluate(() => window.__timeline.setViewMode('calendar'));
  const upper = page.locator('#timeline .calendar-task[data-task-key="entry:a"]').first();
  await upper.evaluate(node => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await upper.hover();
  const details = page.locator('#timeline .details');
  await expect(details).toBeVisible();
  const geometry = await details.evaluate(card => {
    const lower = card.getRootNode().querySelector('.calendar-task[data-task-key="entry:b"]').getBoundingClientRect();
    return { card: card.getBoundingClientRect().toJSON(), lower: lower.toJSON() };
  });
  expect(geometry.card.top, JSON.stringify(geometry)).toBeLessThan(geometry.lower.bottom);
  expect(geometry.card.bottom, JSON.stringify(geometry)).toBeGreaterThan(geometry.lower.top);
  const edit = details.getByRole('button', { name: 'Edit' });
  await edit.hover();
  await expect(details).toContainText('Upper');
  await edit.click();
  await expect.poll(() => page.evaluate(() => window.__calls)).toContainEqual(['edit-form', 'entry:a']);
});

test('popup Calendar keeps a short running entry card while moving down over the next entry', async ({ page }) => {
  const now = Date.now();
  await page.setViewportSize({ width: 1100, height: 720 });
  await mount(page, { activityDashboard: true, toolbarPopup: true, entryForm: true, weeklyCalendar: true,
    rows: [{ id: 'one', title: 'One' }],
    items: [
      { id: 'active:a', url: 'https://example.com/a', title: 'Running upper task', startedAt: now - 23 * 60_000,
        endedAt: null, rowId: 'one', isRunning: true, isEditable: true },
      { id: 'entry:b', url: 'https://example.com/b', title: 'Lower task', startedAt: now + 5 * 60_000,
        endedAt: now + HOUR, rowId: 'one', isEditable: true },
    ] });
  await page.evaluate(() => window.__timeline.setViewMode('calendar'));
  const upper = page.locator('#timeline .calendar-task[data-task-key="active:a"]').first();
  await upper.evaluate(node => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await upper.hover();
  const details = page.locator('#timeline .details');
  const stop = details.getByRole('button', { name: 'Stop and save' });
  await expect(stop).toBeVisible();
  const button = await stop.boundingBox();
  const placement = await details.evaluate(card => {
    const upper = card.getRootNode().querySelector('.calendar-task[data-task-key="active:a"]').getBoundingClientRect();
    const lower = card.getRootNode().querySelector('.calendar-task[data-task-key="entry:b"]').getBoundingClientRect();
    const rect = card.getBoundingClientRect();
    return { rect: rect.toJSON(), upper: upper.toJSON(), beside: rect.left >= upper.right + 8 || rect.right <= upper.left - 8,
      overlappingLower: rect.top < lower.bottom && rect.bottom > lower.top && rect.left < lower.right && rect.right > lower.left };
  });
  expect(placement.beside, JSON.stringify(placement)).toBe(true);
  expect(placement.overlappingLower).toBe(false);
  await page.mouse.move(button.x + button.width / 2, button.y + button.height / 2, { steps: 25 });
  await expect(details).toContainText('Running upper task');
  await stop.click();
  await expect.poll(() => page.evaluate(() => window.__calls)).toContainEqual(['stop', 'active:a']);
  await page.mouse.move(2, 2);
  await page.locator('#timeline .calendar-task[data-task-key="entry:b"]').first().hover();
  await expect(details).toContainText('Lower task');
});

test('popup Calendar places a right-edge entry card on its left', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 720 });
  const sunday = new Date();
  sunday.setDate(sunday.getDate() + (7 - sunday.getDay()) % 7);
  sunday.setHours(10, 0, 0, 0);
  await mount(page, { activityDashboard: true, toolbarPopup: true, weeklyCalendar: true,
    rows: [{ id: 'one', title: 'One' }],
    items: [{ id: 'entry:a', url: 'https://example.com/a', title: 'Sunday task',
      startedAt: sunday.getTime(), endedAt: sunday.getTime() + 30 * 60_000, rowId: 'one', isEditable: true }] });
  await page.evaluate(() => window.__timeline.setViewMode('calendar'));
  const task = page.locator('#timeline .calendar-task[data-task-key="entry:a"]').first();
  await task.evaluate(node => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await task.hover();
  const details = page.locator('#timeline .details');
  await expect(details).toBeVisible();
  const placement = await details.evaluate(card => {
    const task = card.getRootNode().querySelector('.calendar-task[data-task-key="entry:a"]').getBoundingClientRect();
    const rect = card.getBoundingClientRect();
    return { leftOfTask: rect.right <= task.left - 8, inside: rect.left >= 0 && rect.right <= innerWidth };
  });
  expect(placement).toEqual({ leftOfTask: true, inside: true });
  await details.getByRole('button', { name: 'Track time' }).hover();
  await expect(details).toContainText('Sunday task');
});

test('Activity Calendar places the upper entry card beside its block without covering the next entry', async ({ page }) => {
  const now = Date.now();
  await page.setViewportSize({ width: 1100, height: 720 });
  await mount(page, { activityDashboard: true, entryForm: true, weeklyCalendar: true,
    rows: [{ id: 'one', title: 'One' }],
    items: [
      { id: 'entry:a', url: 'https://example.com/a', title: 'Upper task', startedAt: now - 3 * HOUR,
        endedAt: now - 2.5 * HOUR, rowId: 'one', isEditable: true },
      { id: 'entry:b', url: 'https://example.com/b', title: 'Lower task', startedAt: now - 2 * HOUR,
        endedAt: now - 1.5 * HOUR, rowId: 'one', isEditable: true },
    ] });
  await page.evaluate(() => window.__timeline.setViewMode('calendar'));
  const upper = page.locator('#timeline .calendar-task[data-task-key="entry:a"]').first();
  await upper.evaluate(node => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
  const center = await page.evaluate(() => {
    const rect = window.__timeline.__timeline.calendarCanvas
      .querySelector('.calendar-task[data-task-key="entry:a"]').getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  await page.mouse.move(center.x, center.y);
  const details = page.locator('#timeline .details');
  await expect(details).toBeVisible();
  const placement = await details.evaluate(card => {
    const root = card.getRootNode();
    const upper = root.querySelector('.calendar-task[data-task-key="entry:a"]').getBoundingClientRect();
    const lower = root.querySelector('.calendar-task[data-task-key="entry:b"]').getBoundingClientRect();
    const rect = card.getBoundingClientRect();
    return { beside: rect.left >= upper.right + 8 || rect.right <= upper.left - 8,
      coversNext: rect.top < lower.bottom && rect.bottom > lower.top && rect.left < lower.right && rect.right > lower.left };
  });
  expect(placement).toEqual({ beside: true, coversNext: false });
  await details.getByRole('button', { name: 'Edit' }).hover();
  await expect(details).toContainText('Upper task');
  await details.getByRole('button', { name: 'Edit' }).click();
  await expect.poll(() => page.evaluate(() => window.__calls)).toContainEqual(['edit-form', 'entry:a']);
});

test('Activity Calendar chooses the clear left side when the right card would cover an adjacent project', async ({ page }) => {
  await page.clock.install({ time: new Date(2026, 9, 21, 18) });
  await page.setViewportSize({ width: 1100, height: 720 });
  const start = new Date(2026, 9, 21, 10);
  await mount(page, { activityDashboard: true, entryForm: true, weeklyCalendar: true,
    rows: [{ id: 'one', title: 'Project A' }, { id: 'two', title: 'Project B' }],
    items: [
      { id: 'entry:a', url: 'https://example.com/a', title: 'Project A task',
        startedAt: start.getTime(), endedAt: start.getTime() + 30 * 60_000, rowId: 'one', isEditable: true },
      { id: 'entry:b', url: 'https://example.com/b', title: 'Project B task',
        startedAt: start.getTime() + 30 * 60_000, endedAt: start.getTime() + HOUR, rowId: 'two', isEditable: true },
    ] });
  await page.evaluate(() => window.__timeline.setViewMode('calendar'));
  const first = page.locator('#timeline .calendar-task[data-task-key="entry:a"]').first();
  await first.evaluate(node => node.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await first.hover();
  const details = page.locator('#timeline .details');
  await expect(details).toBeVisible();
  const placement = await details.evaluate(card => {
    const root = card.getRootNode();
    const a = root.querySelector('.calendar-task[data-task-key="entry:a"]').getBoundingClientRect();
    const b = root.querySelector('.calendar-task[data-task-key="entry:b"]').getBoundingClientRect();
    const rect = card.getBoundingClientRect();
    return {
      leftFits: a.left - rect.width - 8 >= 8,
      rightFits: a.right + 8 + rect.width <= innerWidth - 8,
      rightWouldCoverB: a.right + 8 < b.right && a.right + 8 + rect.width > b.left
        && rect.top < b.bottom && rect.bottom > b.top,
      leftOfA: rect.right <= a.left - 8,
      coversB: rect.left < b.right && rect.right > b.left && rect.top < b.bottom && rect.bottom > b.top,
    };
  });
  expect(placement).toEqual({ leftFits: true, rightFits: true, rightWouldCoverB: true,
    leftOfA: true, coversB: false });
  await details.getByRole('button', { name: 'Edit' }).hover();
  await expect(details).toContainText('Project A task');
  await details.getByRole('button', { name: 'Edit' }).click();
  await expect.poll(() => page.evaluate(() => window.__calls)).toContainEqual(['edit-form', 'entry:a']);
});

test('Activity Calendar card stays reachable while the pointer crosses the gap slowly', async ({ page }) => {
  await mount(page, { activityDashboard: true, entryForm: true });
  await page.evaluate(() => window.__timeline.setViewMode('calendar'));
  await page.evaluate(() => {
    const timeline = window.__timeline.__timeline;
    timeline.calendarCanvas.addEventListener('pointerover', event => {
      if (!(event.target instanceof Element) || !event.target.closest('.calendar-task[data-task-key="entry:a"]')) return;
      window.__onEnter = {
        visible: !timeline.details.hidden,
        actionsReady: Boolean(timeline.details.querySelector('.clockoli-entry-edit')),
      };
    });
  });
  const task = page.locator('#timeline .calendar-task[data-task-key="entry:a"]').first();
  await task.hover();
  expect(await page.evaluate(() => window.__onEnter)).toEqual({ visible: true, actionsReady: true });
  const details = page.locator('#timeline .details');
  await expect(details).toBeVisible();
  const { x, y, button } = await page.evaluate(() => {
    const root = document.querySelector('#timeline').shadowRoot;
    const task = root.querySelector('.calendar-task[data-task-key="entry:a"]');
    const details = root.querySelector('.details');
    const card = details.getBoundingClientRect();
    const anchor = task.getBoundingClientRect();
    const button = details.querySelector('.clockoli-entry-edit').getBoundingClientRect();
    return {
      x: Math.max(card.left + 12, Math.min(anchor.left + anchor.width / 2, card.right - 12)),
      y: (card.top + anchor.bottom) / 2,
      button: { x: button.left + button.width / 2, y: button.top + button.height / 2 },
    };
  });
  await page.mouse.move(x, y);
  await page.waitForTimeout(350);
  await expect(details).toBeVisible();
  await page.mouse.move(button.x, button.y, { steps: 6 });
  await expect(details.getByRole('button', { name: 'Edit' })).toBeVisible();
  await page.mouse.move(x, y);
  await page.waitForTimeout(350);
  await expect(details).toBeVisible();
  await page.mouse.move(button.x, button.y, { steps: 6 });
  await details.getByRole('button', { name: 'Edit' }).click();
  await expect.poll(() => page.evaluate(() => window.__calls)).toContainEqual(['edit-form', 'entry:a']);
  await page.mouse.move(2, 2);
  await expect(details).toBeHidden();
});

test('Activity Calendar card stays visible while moving within a tall event before approaching its actions', async ({ page }) => {
  const now = Date.now();
  await mount(page, { activityDashboard: true, entryForm: true, weeklyCalendar: true,
    rows: [{ id: 'one', title: 'One' }],
    items: [{ id: 'entry:a', url: 'https://example.com/task', title: 'Long task', rowId: 'one',
      startedAt: now - 5 * HOUR, endedAt: now - HOUR, isEditable: true }] });
  await page.evaluate(() => window.__timeline.setViewMode('calendar'));
  const task = page.locator('#timeline .calendar-task[data-task-key="entry:a"]').first();
  const details = page.locator('#timeline .details');
  const { x, left, right, top, bottom } = await task.evaluate(element => {
    element.scrollIntoView({ block: 'center', behavior: 'instant' });
    const rect = element.getBoundingClientRect();
    const viewport = element.getRootNode().querySelector('.calendar-viewport').getBoundingClientRect();
    return { x: rect.left + rect.width / 2, left: rect.left + 8, right: rect.right - 8,
      top: Math.max(rect.top, viewport.top) + 8,
      bottom: Math.min(rect.bottom, viewport.bottom) - 8 };
  });
  expect(bottom - top).toBeGreaterThan(60);
  const states = [];
  for (let step = 0; step <= 12; step++) {
    await page.mouse.move(x, top + (bottom - top) * step / 12);
    states.push(await page.evaluate(({ x, y }) => {
      const timeline = window.__timeline.__timeline;
      const hit = document.querySelector('#timeline').shadowRoot.elementFromPoint(x, y);
      return { visible: !timeline.details.hidden, key: timeline.hoveredKey,
        hit: hit?.className?.baseVal || hit?.className || hit?.tagName };
    }, { x, y: top + (bottom - top) * step / 12 }));
  }
  for (let step = 0; step <= 12; step++) {
    const cursorX = left + (right - left) * step / 12;
    const cursorY = top + 16;
    await page.mouse.move(cursorX, cursorY);
    states.push(await page.evaluate(({ x, y }) => {
      const timeline = window.__timeline.__timeline;
      const hit = document.querySelector('#timeline').shadowRoot.elementFromPoint(x, y);
      return { visible: !timeline.details.hidden, key: timeline.hoveredKey,
        hit: hit?.className?.baseVal || hit?.className || hit?.tagName };
    }, { x: cursorX, y: cursorY }));
  }
  expect(states.every(state => state.visible && state.key === 'entry:a'), JSON.stringify(states)).toBe(true);
  const edit = details.getByRole('button', { name: 'Edit' });
  await edit.hover();
  await expect(details).toBeVisible();
  await edit.click();
  await expect.poll(() => page.evaluate(() => window.__calls)).toContainEqual(['edit-form', 'entry:a']);
});

test('Activity Calendar late-day event keeps its side card reachable', async ({ page }) => {
  await page.clock.install({ time: new Date(2026, 9, 21, 22, 30) });
  const start = new Date(2026, 9, 21, 17, 34).getTime();
  const end = new Date(2026, 9, 21, 22, 21).getTime();
  await page.setViewportSize({ width: 900, height: 560 });
  await mount(page, { activityDashboard: true, entryForm: true, weeklyCalendar: true,
    rows: [{ id: 'one', title: 'One' }],
    items: [{ id: 'entry:a', url: 'https://example.com/task', title: 'Late work', rowId: 'one',
      startedAt: start, endedAt: end, isEditable: true }] });
  await page.evaluate(() => window.__timeline.setViewMode('calendar'));
  const task = page.locator('#timeline .calendar-task[data-task-key="entry:a"]').first();
  await task.evaluate(element => element.scrollIntoView({ block: 'end', behavior: 'instant' }));
  await task.hover({ position: { x: 15, y: 15 } });
  const details = page.locator('#timeline .details');
  await expect(details).toBeVisible();
  const initial = await page.evaluate(() => {
    const root = document.querySelector('#timeline').shadowRoot;
    const task = root.querySelector('.calendar-task[data-task-key="entry:a"]').getBoundingClientRect();
    const card = root.querySelector('.details').getBoundingClientRect();
    return { task: { left: task.left, right: task.right, top: task.top, bottom: task.bottom },
      card: { left: card.left, right: card.right, top: card.top, bottom: card.bottom } };
  });
  expect(initial.card.left >= initial.task.right + 8 || initial.card.right <= initial.task.left - 8,
    JSON.stringify(initial)).toBe(true);
  const history = [];
  const x = initial.task.left + 20;
  for (let step = 0; step <= 12; step++) {
    const y = initial.task.top + 15 + (initial.task.bottom - initial.task.top - 30) * step / 12;
    await page.mouse.move(x, y);
    history.push(await page.evaluate(({ x, y }) => {
      const root = document.querySelector('#timeline').shadowRoot;
      const timeline = window.__timeline.__timeline;
      return { visible: !timeline.details.hidden, key: timeline.hoveredKey,
        hit: root.elementFromPoint(x, y)?.className || '' };
    }, { x, y }));
  }
  expect(history.every(state => state.visible && state.key === 'entry:a'), JSON.stringify(history)).toBe(true);
  await details.getByRole('button', { name: 'Edit' }).hover();
  await expect(details).toBeVisible();
  await details.getByRole('button', { name: 'Edit' }).click();
  await expect.poll(() => page.evaluate(() => window.__calls)).toContainEqual(['edit-form', 'entry:a']);
});

test('Activity Calendar hover survives movement inside the real closed-shadow page', async ({ page }) => {
  await mount(page, { activityDashboard: true, entryForm: true, closedOuter: true });
  await page.evaluate(() => window.__timeline.setViewMode('calendar'));
  const { x, y } = await page.evaluate(() => {
    const timeline = window.__timeline.__timeline;
    const task = timeline.calendarCanvas.querySelector('.calendar-task[data-task-key="entry:a"]');
    task.scrollIntoView({ block: 'center', behavior: 'instant' });
    const rect = task.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  await page.mouse.move(x, y);
  await expect.poll(() => page.evaluate(() => !window.__timeline.__timeline.details.hidden)).toBe(true);
  await page.mouse.move(x + 4, y + 4);
  await page.waitForTimeout(50);
  expect(await page.evaluate(() => !window.__timeline.__timeline.details.hidden)).toBe(true);
  const card = await page.evaluate(() => {
    const rect = window.__timeline.__timeline.details.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  await page.mouse.move(card.x, card.y, { steps: 20 });
  await expect.poll(() => page.evaluate(() => !window.__timeline.__timeline.details.hidden)).toBe(true);
  const edit = await page.evaluate(() => {
    const rect = window.__timeline.__timeline.details.querySelector('.clockoli-entry-edit').getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  await page.mouse.click(edit.x, edit.y);
  await expect.poll(() => page.evaluate(() => window.__calls)).toContainEqual(['edit-form', 'entry:a']);
  await page.mouse.move(2, 2);
  await expect.poll(() => page.evaluate(() => window.__timeline.__timeline.details.hidden)).toBe(true);
});

test('Activity Timeline card opens immediately and stays reachable across the gap in a closed shadow root', async ({ page }) => {
  await mount(page, { activityDashboard: true, entryForm: true, closedOuter: true });
  await page.evaluate(() => {
    const timeline = window.__timeline.__timeline;
    timeline.taskRow.addEventListener('pointerover', event => {
      if (!(event.target instanceof Element) || !event.target.closest('.task[data-task-key="entry:a"]')) return;
      window.__timelineEnter = { visible: !timeline.details.hidden,
        actionsReady: Boolean(timeline.details.querySelector('.clockoli-entry-edit')) };
    });
  });
  const { x, y } = await page.evaluate(() => {
    const timeline = window.__timeline.__timeline;
    const task = timeline.taskRow.querySelector('.task[data-task-key="entry:a"]');
    task.scrollIntoView({ block: 'center', behavior: 'instant' });
    const rect = task.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  await page.mouse.move(x, y);
  expect(await page.evaluate(() => window.__timelineEnter)).toEqual({ visible: true, actionsReady: true });
  const gap = await page.evaluate(() => {
    const timeline = window.__timeline.__timeline;
    const anchor = timeline.taskRow.querySelector('.task[data-task-key="entry:a"]').getBoundingClientRect();
    const card = timeline.details.getBoundingClientRect();
    return { x: Math.max(card.left + 12, Math.min(anchor.left + anchor.width / 2, card.right - 12)),
      y: (card.top + anchor.bottom) / 2 };
  });
  await page.mouse.move(gap.x, gap.y, { steps: 20 });
  await page.waitForTimeout(350);
  expect(await page.evaluate(() => !window.__timeline.__timeline.details.hidden)).toBe(true);
  const edit = await page.evaluate(() => {
    const rect = window.__timeline.__timeline.details.querySelector('.clockoli-entry-edit').getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  await page.mouse.move(edit.x, edit.y, { steps: 10 });
  expect(await page.evaluate(() => !window.__timeline.__timeline.details.hidden)).toBe(true);
  await page.mouse.click(edit.x, edit.y);
  await expect.poll(() => page.evaluate(() => window.__calls)).toContainEqual(['edit-form', 'entry:a']);
  await page.mouse.move(2, 2);
  await expect.poll(() => page.evaluate(() => window.__timeline.__timeline.details.hidden)).toBe(true);
});

test('Timeline hover also survives movement when the widget is nested in a closed shadow root', async ({ page }) => {
  await mount(page, { closedOuter: true });
  const { x, y } = await page.evaluate(() => {
    const timeline = window.__timeline.__timeline;
    const task = timeline.taskRow.querySelector('.task[data-task-key="entry:a"]');
    task.scrollIntoView({ block: 'center', behavior: 'instant' });
    const rect = task.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  await page.mouse.move(x, y);
  await expect.poll(() => page.evaluate(() => !window.__timeline.__timeline.details.hidden)).toBe(true);
  await page.mouse.move(x + 4, y);
  await page.waitForTimeout(50);
  expect(await page.evaluate(() => !window.__timeline.__timeline.details.hidden)).toBe(true);
  await page.mouse.move(2, 2);
  await expect.poll(() => page.evaluate(() => window.__timeline.__timeline.details.hidden)).toBe(true);
});

async function dragGeometry(page, sourceSelector, viewportSelector) {
  let geometry;
  await expect.poll(async () => {
    geometry = await page.locator(sourceSelector).first().evaluate(async (element, [sourceSelector, viewportSelector]) => {
      const root = element.getRootNode();
      element.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
      await new Promise(resolve => requestAnimationFrame(resolve));
      const source = root.querySelector(sourceSelector.replace('#timeline ', ''))?.getBoundingClientRect();
      const viewport = root.querySelector(viewportSelector.replace('#timeline ', ''))?.getBoundingClientRect();
      if (!source || !viewport) return null;
      const left = Math.max(source.left, viewport.left, 0);
      const right = Math.min(source.right, viewport.right, innerWidth);
      const top = Math.max(source.top, viewport.top, 0);
      const bottom = Math.min(source.bottom, viewport.bottom, innerHeight);
      if (right <= left || bottom <= top) return null;
      return { box: { x: left, y: top, width: right - left, height: bottom - top },
        viewport: { x: viewport.x, y: viewport.y, width: viewport.width, height: viewport.height } };
    }, [sourceSelector, viewportSelector]);
    return geometry !== null;
  }, { timeout: 5000 }).toBe(true);
  return geometry;
}

for (const mode of ['timeline', 'calendar']) {
  test(`${mode} holds a move at the edge without navigating to another week`, async ({ page }) => {
    const monday = new Date(2026, 9, 12).getTime();
    const start = new Date(2026, 9, 14, 10).getTime();
    await page.clock.install({ time: new Date(2026, 9, 16, 16) });
    await mount(page, { weeklyCalendar: true, edgeNavigation: true,
      items: [{ id: 'entry:a', title: 'Source', startedAt: start, endedAt: start + HOUR, isEditable: true }],
      view: { start: monday, end: new Date(2026, 9, 19).getTime(), focusedAt: start, visibleDays: 2 },
      totalRange: { start: monday, end: new Date(2026, 9, 19).getTime() } });
    if (mode === 'calendar') await page.evaluate(() => window.__timeline.setViewMode('calendar'));
    const selector = `#timeline .${mode === 'calendar' ? 'calendar-task' : 'task'}[data-task-key="entry:a"]`;
    const { box } = await dragGeometry(page, selector,
      `#timeline .${mode === 'calendar' ? 'calendar-viewport' : 'viewport'}`);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(1, box.y + box.height / 2, { steps: 6 });
    await page.waitForTimeout(850);
    expect(await page.evaluate(() => window.__calls.filter(call => call[0] === 'edge'))).toEqual([]);
    await page.mouse.up();
    expect(await page.evaluate(() => window.__timeline.getCalendarRange().start)).toBe(monday);
    expect(await page.evaluate(() => window.__timeline.__timeline.getVisibleDays())).toBe(2);
    for (const edit of await page.evaluate(() => window.__edits)) {
      expect(edit.startedAt).toBeGreaterThanOrEqual(monday);
      expect(edit.endedAt).toBeLessThanOrEqual(new Date(2026, 9, 19).getTime());
    }
  });
}

test('move validation rejects a different week but accepts free time in the selected week', async ({ page }) => {
  const monday = new Date(2026, 9, 12).getTime();
  const nextMonday = new Date(2026, 9, 19).getTime();
  const start = new Date(2026, 9, 14, 10).getTime();
  await page.clock.install({ time: new Date(2026, 9, 16, 16) });
  await mount(page, { weeklyCalendar: true,
    items: [{ id: 'entry:a', title: 'Source', startedAt: start, endedAt: start + HOUR, isEditable: true }],
    totalRange: { start: monday, end: nextMonday },
    view: { start: monday, end: nextMonday, focusedAt: start } });
  expect(await page.evaluate(({ monday, nextMonday, start, hour }) => {
    const timeline = window.__timeline.__timeline;
    const allowed = (from, to) => timeline.canChange({ action: 'move', instanceId: 'entry:a',
      task: timeline._findTask('entry:a'),
      after: { start: from, end: to } });
    return [allowed(monday - hour, monday), allowed(nextMonday - hour / 2, nextMonday + hour / 2),
      allowed(start + hour, start + 2 * hour)];
  }, { monday, nextMonday, start, hour: HOUR })).toEqual([false, false, true]);
});

test('a block clipped at Monday cannot be moved with a shortened duration', async ({ page }) => {
  const monday = new Date(2026, 9, 12).getTime();
  await page.clock.install({ time: new Date(2026, 9, 16, 16) });
  await mount(page, { weeklyCalendar: true,
    items: [{ id: 'entry:a', title: 'Overnight', originalStartedAt: monday - HOUR,
      startedAt: monday, endedAt: monday + HOUR, originalEndedAt: monday + HOUR, isEditable: true }],
    totalRange: { start: monday, end: new Date(2026, 9, 19).getTime() },
    view: { start: monday, end: new Date(2026, 9, 19).getTime(), focusedAt: monday } });
  const result = await page.evaluate(hour => {
    const timeline = window.__timeline.__timeline;
    const after = { start: timeline._findTask('entry:a').start + hour, end: timeline._findTask('entry:a').end + hour };
    return { allowed: timeline.canChange({ action: 'move', instanceId: 'entry:a',
      task: timeline._findTask('entry:a'), after }),
      times: [timeline._findTask('entry:a').start, timeline._findTask('entry:a').end] };
  }, HOUR);
  expect(result).toEqual({ allowed: false, times: [monday, monday + HOUR] });
  expect(await page.evaluate(() => window.__edits)).toEqual([]);
});

for (const mode of ['timeline', 'calendar']) {
  test(`restores a completed entry after dragging it into the future in ${mode}`, async ({ page }) => {
    await page.clock.install({ time: new Date('2026-10-16T16:00:00Z') });
    const now = await page.evaluate(() => Date.now());
    const start = now - 2 * HOUR;
    const neighborStart = now - 4 * HOUR;
    await mount(page, { items: [
      { id: 'entry:neighbor', url: 'https://example.com/neighbor', title: 'Neighbor', startedAt: neighborStart, endedAt: neighborStart + 30 * 60_000, isEditable: true },
      { id: 'entry:a', url: 'https://example.com/a', title: 'Past', startedAt: start, endedAt: start + HOUR, isEditable: true },
    ], view: { start: now - 5 * HOUR, end: now + 4 * HOUR, focusedAt: now } });
    await page.clock.pauseAt(new Date('2026-10-16T16:00:01Z'));
    if (mode === 'calendar') await page.evaluate(() => {
      const timeline = window.__timeline.__timeline;
      timeline.setViewMode('calendar');
      const day = new Date(Date.now());
      day.setHours(0, 0, 0, 0);
      const nextDay = new Date(day);
      nextDay.setDate(nextDay.getDate() + 1);
      timeline.setCalendarRange({ start: day.getTime(), end: nextDay.getTime() });
    });
    const source = page.locator(`#timeline .${mode === 'calendar' ? 'calendar-task' : 'task'}[data-task-key="entry:a"]`).first();
    await expect(source).toBeVisible();
    await source.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'center' }));
    const target = await source.evaluate((element, { mode, hour }) => {
      const timeline = window.__timeline.__timeline;
      const rect = element.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      if (mode === 'calendar') return { x, y, targetX: x, targetY: y + 4 * timeline.options.calendarHourHeight };
      return { x, y, targetX: x + 3 * hour * timeline.scalePxPerMs, targetY: y };
    }, { mode, hour: HOUR });
    expect(target.targetX).toBeLessThan(await page.evaluate(() => innerWidth));
    expect(target.targetY).toBeLessThan(await page.evaluate(() => innerHeight));
    await page.mouse.move(target.x, target.y);
    await page.mouse.down();
    await page.mouse.move(target.targetX, target.targetY, { steps: 8 });
    const duringDrag = await page.evaluate(() => {
      const timeline = window.__timeline.__timeline;
      return { mutated: Boolean(timeline.editState?.didMutate || timeline.calendarEditState?.didMutate),
        end: timeline._findTask('entry:a').end };
    });
    expect(duringDrag.mutated).toBe(true);
    expect(duringDrag.end).toBeGreaterThan(now);
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => {
      const timeline = window.__timeline.__timeline;
      return { start: timeline._findTask('entry:a').start, end: timeline._findTask('entry:a').end,
        neighborStart: timeline._findTask('entry:neighbor').start, edits: window.__calls.filter(call => call[0] === 'edit').length,
        errors: window.__calls.filter(call => call[0] === 'error').map(call => call[2]), undo: timeline.undoStack.length };
    })).toEqual({ start, end: start + HOUR, neighborStart, edits: 0,
      errors: ['Time entries cannot end in the future.'], undo: 0 });
  });

  test(`rejects a move into the future in ${mode} without sending an edit`, async ({ page }) => {
    await page.clock.install({ time: new Date('2026-10-16T16:00:00Z') });
    const now = await page.evaluate(() => Date.now());
    const start = now - 2 * HOUR;
    await mount(page, { items: [
      { id: 'entry:a', url: 'https://example.com/a', title: 'Past', startedAt: start, endedAt: start + HOUR, isEditable: true },
    ], view: { start: now - 4 * HOUR, end: now + 4 * HOUR, focusedAt: now } });
    const result = await page.evaluate(mode => {
      const timeline = window.__timeline.__timeline;
      if (mode === 'calendar') timeline.setViewMode('calendar');
      timeline._selectTask(timeline._findTask('entry:a'), false);
      timeline._keyboardEditSelected('move', 4 * 60 * 60_000);
      return { start: timeline._findTask('entry:a').start, end: timeline._findTask('entry:a').end,
        calls: window.__calls.filter(call => call[0] === 'edit'),
        errors: window.__calls.filter(call => call[0] === 'error') };
    }, mode);
    expect(result.start).toBe(start);
    expect(result.end).toBe(start + HOUR);
    expect(result.calls).toEqual([]);
    expect(result.errors).toEqual([['error', undefined, 'Time entries cannot end in the future.']]);
  });

  test(`rejects extending an entry into the future but permits a past move in ${mode}`, async ({ page }) => {
    await page.clock.install({ time: new Date('2026-10-16T16:00:00Z') });
    const now = await page.evaluate(() => Date.now());
    const start = now - 3 * HOUR;
    await mount(page, { items: [
      { id: 'entry:a', url: 'https://example.com/a', title: 'Past', startedAt: start, endedAt: start + HOUR, isEditable: true },
    ], view: { start: now - 4 * HOUR, end: now + 4 * HOUR, focusedAt: now } });
    const result = await page.evaluate(mode => {
      const timeline = window.__timeline.__timeline;
      if (mode === 'calendar') timeline.setViewMode('calendar');
      timeline._selectTask(timeline._findTask('entry:a'), false);
      timeline._keyboardEditSelected('resize-end', 4 * 60 * 60_000);
      const afterRejectedEnd = timeline._findTask('entry:a').end;
      timeline._keyboardEditSelected('move', 60 * 60_000);
      return { afterRejectedEnd, start: timeline._findTask('entry:a').start,
        end: timeline._findTask('entry:a').end };
    }, mode);
    expect(result.afterRejectedEnd).toBe(start + HOUR);
    expect(result.start).toBeGreaterThanOrEqual(start);
    expect(result.end).toBeLessThan(now);
    await expect.poll(() => page.evaluate(() => window.__calls.filter(call => call[0] === 'edit')))
      .toEqual([['edit', 'entry:a', 'move']]);
  });

  test(`drags a completed entry through its neighbor into free space in ${mode}`, async ({ page }) => {
    await page.clock.install({ time: new Date('2026-10-16T16:00:00Z') });
    const now = await page.evaluate(() => Date.now());
    const first = now - 6 * HOUR;
    const second = first + 2 * HOUR;
    await mount(page, { items: [
      { id: 'entry:a', url: 'https://example.com/a', title: 'First', startedAt: first, endedAt: first + HOUR, isEditable: true, destinationId: 'repo' },
      { id: 'entry:b', url: 'https://example.com/b', title: 'Second', startedAt: second, endedAt: second + 30 * 60_000, isEditable: true, destinationId: 'repo' },
    ], view: { start: first - HOUR, end: now, focusedAt: first } });
    if (mode === 'timeline') await page.locator('#timeline').evaluate(element => { element.style.width = '985px'; });
    if (mode === 'calendar') await page.evaluate(firstTime => {
      const timeline = window.__timeline.__timeline;
      timeline.setViewMode('calendar');
      const start = new Date(firstTime);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 2);
      timeline.setCalendarRange({ start: start.getTime(), end: end.getTime() });
    }, first);
    const block = key => page.locator(`#timeline .${mode === 'calendar' ? 'calendar-task' : 'task'}[data-task-key="entry:${key}"]`).first();
    if (mode === 'calendar') {
      await expect(block('a')).toBeVisible();
      await expect(block('b')).toBeVisible();
      await block('a').evaluate(element => element.scrollIntoView({ block: 'center' }));
    }
    const { source, target } = { source: await block('b').boundingBox(), target: await block('a').boundingBox() };
    expect(source, 'drag source must be visible in the selected Calendar range').toBeTruthy();
    expect(target, 'drag target must be visible in the selected Calendar range').toBeTruthy();
    expect(source.width).toBeGreaterThan(0);
    expect(target.width).toBeGreaterThan(0);
    const destination = mode === 'calendar'
      ? { x: target.x + target.width / 2, y: target.y - 20 }
      : await page.evaluate(time => {
        const timeline = window.__timeline.__timeline;
        const rect = timeline.viewport.getBoundingClientRect();
        return { x: rect.left + timeline.timeToX(time) - timeline._scrollLeftNow(), y: rect.top + 30 };
      }, first - 20 * 60_000);
    if (mode === 'timeline') await expect.poll(() => page.evaluate(hour => {
      const timeline = window.__timeline.__timeline;
      return Math.abs(timeline.scalePxPerMs * 7 * hour - timeline.viewport.clientWidth);
    }, HOUR)).toBeLessThan(0.1);
    const beforeGeometry = mode === 'timeline' ? await page.evaluate(() => {
      const timeline = window.__timeline.__timeline;
      return { width: timeline.totalWidth, scroll: timeline._scrollLeftNow(), scale: timeline.scalePxPerMs };
    }) : null;
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
    await page.mouse.down();
    await page.mouse.move(destination.x, destination.y, { steps: 8 });
    const duringDrag = await page.evaluate(() => window.__timeline.__timeline.tasks.map(task => ({ id: task.instanceId, start: task.start, end: task.end })));
    expect(duringDrag.find(item => item.id === 'entry:b').end).toBeLessThanOrEqual(duringDrag.find(item => item.id === 'entry:a').start);
    expect(duringDrag.map(item => item.id)).toEqual(['entry:b', 'entry:a']);
    if (mode === 'timeline') {
      const geometry = await page.evaluate(() => {
        const timeline = window.__timeline.__timeline;
        return { width: timeline.totalWidth, scroll: timeline._scrollLeftNow(), scale: timeline.scalePxPerMs };
      });
      expect(Math.abs(geometry.width - beforeGeometry.width)).toBeLessThan(5);
      expect(geometry.scale).toBe(beforeGeometry.scale);
    }
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => window.__calls[0]?.[0])).toBe('edit');
    expect(await page.evaluate(() => window.__calls)).toEqual([['edit', 'entry:b', 'move']]);
    const positions = await page.evaluate(() => window.__timeline.__timeline.tasks.map(task => ({ id: task.instanceId, start: task.start, end: task.end })));
    expect(positions.find(item => item.id === 'entry:a')).toEqual({ id: 'entry:a', start: first, end: first + HOUR });
    expect(positions.find(item => item.id === 'entry:b').end).toBeLessThan(first);
    expect(await page.evaluate(() => window.__timeline.__timeline.tasks.map(task => task.instanceId))).toEqual(['entry:b', 'entry:a']);
  });
}

test('dragging a short Timeline entry does not push stationary entries or the viewport right', async ({ page }) => {
  const now = Date.now();
  const first = now - 8 * HOUR;
  const second = now - 6 * HOUR;
  await mount(page, { items: [
    { id: 'entry:a', title: 'First', startedAt: first, endedAt: first + HOUR, isEditable: true },
    { id: 'entry:b', title: 'Second', startedAt: second, endedAt: second + 30 * 60_000, isEditable: true },
  ], view: { start: now - 7 * 24 * HOUR, end: now, focusedAt: second } });
  const source = page.locator('#timeline .task[data-task-key="entry:b"]');
  await source.evaluate(element => element.scrollIntoView({ inline: 'center' }));
  const before = await page.evaluate(targetStart => {
    const timeline = window.__timeline.__timeline;
    const viewport = timeline.viewport.getBoundingClientRect();
    const source = timeline._taskElementByKey('entry:b').getBoundingClientRect();
    const task = timeline.tasks.find(item => item._key === 'entry:b');
    const x = source.left + source.width / 2;
    const pointerOffset = timeline.xToTime(timeline._scrollLeftNow() + x - viewport.left) - task.start;
    return { x, y: source.top + source.height / 2,
      targetX: viewport.left + timeline.timeToX(targetStart + pointerOffset) - timeline._scrollLeftNow(),
      firstX: timeline._taskElementByKey('entry:a').getBoundingClientRect().left,
      scroll: timeline._scrollLeftNow() };
  }, first - 6 * HOUR);
  await page.mouse.move(before.x, before.y);
  await page.mouse.down();
  await page.mouse.move(before.targetX, before.y, { steps: 8 });
  const during = await page.evaluate(() => {
    const timeline = window.__timeline.__timeline;
    return { firstX: timeline._taskElementByKey('entry:a').getBoundingClientRect().left,
      scroll: timeline._scrollLeftNow(),
      movedRight: timeline._taskElementByKey('entry:b').getBoundingClientRect().right,
      movedBefore: timeline.tasks[0]._key === 'entry:b' };
  });
  expect(during.movedBefore).toBe(true);
  expect(during.movedRight).toBeLessThanOrEqual(during.firstX + 1);
  expect(Math.abs(during.firstX - before.firstX)).toBeLessThan(2);
  expect(Math.abs(during.scroll - before.scroll)).toBeLessThan(2);
  await page.mouse.up();
  const afterScroll = await page.evaluate(() => {
    const timeline = window.__timeline.__timeline;
    return { scroll: timeline._scrollLeftNow(), max: Math.max(0, timeline.totalWidth - timeline._viewportWidthNow()) };
  });
  expect(Math.abs(afterScroll.scroll - before.scroll)).toBeLessThan(2);
  const afterWidths = await page.evaluate(() => ['entry:a', 'entry:b'].map(key =>
    window.__timeline.__timeline._taskElementByKey(key).getBoundingClientRect().width));
  expect(afterWidths.every(width => width >= 30)).toBe(true);
});

test('Timeline keeps a moved entry at its full visual width just before the entry it crossed', async ({ page }) => {
  const now = Date.now();
  const first = now - 8 * HOUR;
  await mount(page, { items: [
    { id: 'entry:a', title: 'First', startedAt: first, endedAt: first + HOUR, isEditable: true },
    { id: 'entry:b', title: 'Second', startedAt: first + 2 * HOUR, endedAt: first + 2.5 * HOUR, isEditable: true },
  ], view: { start: now - 7 * 24 * HOUR, end: now, focusedAt: first } });
  const source = page.locator('#timeline .task[data-task-key="entry:b"]');
  await source.evaluate(element => element.scrollIntoView({ inline: 'center' }));
  const gesture = await page.evaluate(targetStart => {
    const timeline = window.__timeline.__timeline;
    const viewport = timeline.viewport.getBoundingClientRect();
    const block = timeline._taskElementByKey('entry:b').getBoundingClientRect();
    const task = timeline._findTask('entry:b');
    const x = block.left + block.width / 2;
    const pointerOffset = timeline.xToTime(timeline._scrollLeftNow() + x - viewport.left) - task.start;
    return { x, y: block.top + block.height / 2,
      targetX: viewport.left + timeline.timeToX(targetStart + pointerOffset) - timeline._scrollLeftNow() };
  }, first - 31 * 60_000);
  await page.mouse.move(gesture.x, gesture.y);
  await page.mouse.down();
  await page.mouse.move(gesture.targetX, gesture.y, { steps: 8 });
  const during = await page.evaluate(() => {
    const timeline = window.__timeline.__timeline;
    const moved = timeline._findTask('entry:b');
    return { beforeFirst: moved.end <= timeline._findTask('entry:a').start,
      start: moved.start,
      duration: moved.end - moved.start,
      left: timeline._taskElementByKey('entry:b').getBoundingClientRect().left,
      width: timeline._taskElementByKey('entry:b').getBoundingClientRect().width,
      expectedWidth: moved.displayWidth };
  });
  expect(during.beforeFirst).toBe(true);
  expect(Math.abs(during.start - (first - 31 * 60_000))).toBeLessThan(15 * 60_000);
  expect(during.duration).toBe(30 * 60_000);
  expect(during.width).toBeGreaterThanOrEqual(during.expectedWidth - 1);
  await page.mouse.move(gesture.targetX - 1, gesture.y);
  const nextStep = await page.evaluate(() => {
    const timeline = window.__timeline.__timeline;
    return { start: timeline._findTask('entry:b').start,
      left: timeline._taskElementByKey('entry:b').getBoundingClientRect().left };
  });
  expect(Math.abs(nextStep.start - during.start)).toBeLessThan(20 * 60_000);
  expect(Math.abs(nextStep.left - during.left)).toBeLessThan(2);
  await page.mouse.up();
  expect(await page.evaluate(() => {
    const moved = window.__timeline.__timeline._findTask('entry:b');
    return moved.end - moved.start;
  })).toBe(30 * 60_000);
});

test('Timeline keeps a moved entry clear of the entry it crossed to the right', async ({ page }) => {
  const now = Date.now();
  const first = now - 8 * HOUR;
  const second = first + 2 * HOUR;
  await mount(page, { items: [
    { id: 'entry:a', title: 'First', startedAt: first, endedAt: first + 30 * 60_000, isEditable: true },
    { id: 'entry:b', title: 'Second', startedAt: second, endedAt: second + 30 * 60_000, isEditable: true },
  ], view: { start: now - 7 * 24 * HOUR, end: now, focusedAt: first } });
  const source = page.locator('#timeline .task[data-task-key="entry:a"]');
  await source.evaluate(element => element.scrollIntoView({ inline: 'center' }));
  const gesture = await page.evaluate(targetStart => {
    const timeline = window.__timeline.__timeline;
    const viewport = timeline.viewport.getBoundingClientRect();
    const block = timeline._taskElementByKey('entry:a').getBoundingClientRect();
    const task = timeline._findTask('entry:a');
    const x = block.left + block.width / 2;
    const pointerOffset = timeline.xToTime(timeline._scrollLeftNow() + x - viewport.left) - task.start;
    return { x, y: block.top + block.height / 2,
      targetX: viewport.left + timeline.timeToX(targetStart + pointerOffset) - timeline._scrollLeftNow() };
  }, second + 31 * 60_000);
  await page.mouse.move(gesture.x, gesture.y);
  await page.mouse.down();
  await page.mouse.move(gesture.targetX, gesture.y, { steps: 8 });
  const during = await page.evaluate(() => {
    const timeline = window.__timeline.__timeline;
    const moved = timeline._findTask('entry:a');
    const firstBox = timeline._taskElementByKey('entry:a').getBoundingClientRect();
    const secondBox = timeline._taskElementByKey('entry:b').getBoundingClientRect();
    return { afterSecond: moved.start >= timeline._findTask('entry:b').end,
      start: moved.start,
      duration: moved.end - moved.start, movedLeft: firstBox.left, secondRight: secondBox.right };
  });
  expect(during.afterSecond).toBe(true);
  expect(Math.abs(during.start - (second + 31 * 60_000))).toBeLessThan(15 * 60_000);
  expect(during.duration).toBe(30 * 60_000);
  expect(during.movedLeft).toBeGreaterThanOrEqual(during.secondRight);
  await page.mouse.up();
});

test('Timeline keeps the current time at the right edge after moving an older entry', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-16T16:00:00Z') });
  const now = await page.evaluate(() => Date.now());
  const first = now - 8 * HOUR;
  await mount(page, { items: [
    { id: 'entry:a', title: 'First', startedAt: first, endedAt: first + HOUR, isEditable: true },
    { id: 'entry:b', title: 'Second', startedAt: first + 2 * HOUR, endedAt: first + 2.5 * HOUR, isEditable: true },
    { id: 'active:c', title: 'Current', startedAt: now - HOUR, endedAt: null, isRunning: true, isEditable: false },
  ], view: { start: now - 24 * HOUR, end: now, focusedAt: now } });
  await page.evaluate(() => window.__timeline.scrollToEnd());
  const source = page.locator('#timeline .task[data-task-key="entry:b"]');
  await expect(source).toBeVisible();
  await source.hover();
  const box = await source.boundingBox();
  const viewport = await page.locator('#timeline .viewport').boundingBox();
  expect(box).not.toBeNull();
  expect(box.width).toBeGreaterThan(0);
  expect(box.x + box.width / 2).toBeGreaterThan(viewport.x);
  expect(box.x + box.width / 2).toBeLessThan(viewport.x + viewport.width);
  const before = await page.evaluate(() => {
    const timeline = window.__timeline.__timeline;
    return { position: (timeline.timeToX(timeline.currentTime) - timeline._scrollLeftNow()) / timeline._viewportWidthNow(),
      width: timeline.totalWidth };
  });
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 35, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.__calls.filter(call => call[0] === 'edit')))
    .toEqual([['edit', 'entry:b', 'move']]);
  const after = await page.evaluate(() => {
    const timeline = window.__timeline.__timeline;
    return { position: (timeline.timeToX(timeline.currentTime) - timeline._scrollLeftNow()) / timeline._viewportWidthNow(),
      width: timeline.totalWidth };
  });
  expect(before.position).toBeCloseTo(1, 1);
  expect(after.position).toBeCloseTo(before.position, 2);
  expect(Math.abs(after.width - before.width)).toBeLessThan(3);
});

test('moving an entry with a running timer keeps future day bands visible throughout the gesture', async ({ page }) => {
  const now = new Date(2026, 9, 16, 12).getTime();
  await page.clock.install({ time: new Date(now) });
  const tomorrow = new Date(now);
  tomorrow.setHours(0, 0, 0, 0);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const futureEnd = new Date(tomorrow);
  futureEnd.setDate(futureEnd.getDate() + 2);
  await mount(page, { items: [
    { id: 'entry:a', title: 'Completed', startedAt: now - 3 * HOUR, endedAt: now - 2 * HOUR, isEditable: true },
    { id: 'active:b', title: 'Running', startedAt: now - 30 * 60_000, endedAt: null, isRunning: true, isEditable: false },
  ], view: { start: now - 24 * HOUR, end: futureEnd.getTime(), focusedAt: now } });
  const futureBand = page.locator(`#timeline .day-band[data-start="${tomorrow.getTime()}"]`);
  const source = page.locator('#timeline .task[data-task-key="entry:a"]');
  await source.evaluate(element => element.scrollIntoView({ inline: 'center' }));
  const box = await source.boundingBox();
  await expect(futureBand).toHaveCount(1);
  await page.clock.pauseAt(new Date((await page.evaluate(() => Date.now())) + 2000));
  const bandGeometry = () => page.evaluate(() => {
    const timeline = window.__timeline.__timeline;
    const viewport = timeline.viewport.getBoundingClientRect();
    return [...timeline.dayRow.querySelectorAll('.day-band')].map(band => {
      const bounds = band.getBoundingClientRect();
      return { start: band.dataset.start, left: bounds.left - viewport.left, width: bounds.width };
    });
  });
  const before = await bandGeometry();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 18, box.y + box.height / 2);
  expect(await page.evaluate(() => window.__timeline.__timeline.editState?.didMutate)).toBe(true);
  await expect(futureBand).toHaveCount(1);
  const during = await bandGeometry();
  expect(during.map(band => band.start)).toEqual(before.map(band => band.start));
  for (const [index, band] of during.entries()) {
    expect(Math.abs(band.left - before[index].left), JSON.stringify({ before: before[index], during: band, index })).toBeLessThan(3);
    expect(Math.abs(band.width - before[index].width)).toBeLessThan(3);
  }
  await page.evaluate(() => window.__timeline.__timeline._tickRunningTask());
  await page.mouse.move(box.x + box.width / 2 - 28, box.y + box.height / 2);
  await expect(futureBand).toHaveCount(1);
  await page.mouse.up();
  await expect(futureBand).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => window.__timeline.__timeline._runningTask()?.running)).toBe(true);
});

test('stopping a timer does not discard future days in the selected Timeline range', async ({ page }) => {
  const now = Date.now();
  const tomorrow = new Date(now);
  tomorrow.setHours(0, 0, 0, 0);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const futureEnd = new Date(tomorrow);
  futureEnd.setDate(futureEnd.getDate() + 2);
  await mount(page, { items: [
    { id: 'active:b', title: 'Running', startedAt: now - HOUR, endedAt: null, isRunning: true, isEditable: false },
  ], view: { start: now - 24 * HOUR, end: futureEnd.getTime(), focusedAt: now } });
  const futureBand = page.locator(`#timeline .day-band[data-start="${tomorrow.getTime()}"]`);
  await expect(futureBand).toHaveCount(1);
  const duringStop = await page.evaluate(() => {
    const timeline = window.__timeline.__timeline;
    timeline.stop();
    return { end: timeline.domainEnd, baseEnd: timeline.baseDomainEnd,
      futureBands: [...timeline.dayRow.querySelectorAll('.day-band')].filter(band => Number(band.dataset.start) > Date.now()).length };
  });
  expect(duringStop.end).toBeGreaterThanOrEqual(duringStop.baseEnd);
  expect(duringStop.futureBands).toBeGreaterThan(0);
  await expect(futureBand).toHaveCount(1);
});

test('a viewport refresh keeps the selected week’s future days after panning to today', async ({ page }) => {
  const now = new Date(2026, 9, 16, 12).getTime();
  await page.clock.install({ time: new Date(now) });
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const weekEnd = new Date(monday);
  weekEnd.setDate(weekEnd.getDate() + 7);
  const futureDay = new Date(now);
  futureDay.setHours(0, 0, 0, 0);
  futureDay.setDate(futureDay.getDate() + 1);
  const items = [
    { id: 'entry:a', title: 'Completed', startedAt: now - 3 * HOUR, endedAt: now - 2 * HOUR, isEditable: true },
    { id: 'active:b', title: 'Running', startedAt: now - 30 * 60_000, endedAt: null, isRunning: true, isEditable: false },
  ];
  const range = { start: monday.getTime(), end: weekEnd.getTime() };
  await mount(page, { items, totalRange: range, view: { ...range, focusedAt: now } });
  const futureBand = page.locator(`#timeline .day-band[data-start="${futureDay.getTime()}"]`);
  await expect(futureBand).toHaveCount(1);
  await page.evaluate(now => {
    const timeline = window.__timeline.__timeline;
    timeline.setVisibleDays(1);
    timeline._setScrollLeft(timeline.timeToX(now) - timeline._viewportWidthNow() / 2);
  }, now);
  await expect.poll(() => page.evaluate(() => window.__timeline.getView().end)).toBeLessThan(range.end);
  await page.evaluate(() => window.__timeline.update({ items: window.__items }));
  await expect(futureBand).toHaveCount(1);
  expect(await page.evaluate(() => window.__timeline.__timeline.domainEnd)).toBeGreaterThanOrEqual(range.end);
  await page.evaluate(() => {
    const timeline = window.__timeline.__timeline;
    timeline.setVisibleDays(2);
    timeline.scrollToEnd();
  });
  expect(await page.evaluate(start => {
    const timeline = window.__timeline.__timeline;
    const viewport = timeline.viewport.getBoundingClientRect();
    const bounds = timeline.dayRow.querySelector(`.day-band[data-start="${start}"]`).getBoundingClientRect();
    return bounds.right > viewport.left && bounds.left < viewport.right;
  }, futureDay.getTime())).toBe(true);
});

test('remounting a cropped Timeline viewport retains all days in the selected week', async ({ page }) => {
  const now = new Date(2026, 9, 16, 12).getTime();
  await page.clock.install({ time: new Date(now) });
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const weekEnd = new Date(monday);
  weekEnd.setDate(weekEnd.getDate() + 7);
  const saturday = new Date(monday);
  saturday.setDate(saturday.getDate() + 5);
  await mount(page, {
    items: [{ id: 'active:b', title: 'Running', startedAt: now - 30 * 60_000,
      endedAt: null, isRunning: true, isEditable: false }],
    totalRange: { start: monday.getTime(), end: weekEnd.getTime() },
    view: { start: now - 24 * HOUR, end: now, focusedAt: now },
  });
  await expect(page.locator(`#timeline .day-band[data-start="${saturday.getTime()}"]`)).toHaveCount(1);
  expect(await page.evaluate(() => window.__timeline.__timeline.domainEnd)).toBeGreaterThanOrEqual(weekEnd.getTime());
});

test('Timeline keeps the original minimum widths and task spacing in a weekly view', async ({ page }) => {
  const now = Date.now();
  const first = now - 8 * HOUR;
  await mount(page, { items: [
    { id: 'entry:a', title: 'First', startedAt: first, endedAt: first + HOUR, isEditable: true },
    { id: 'entry:b', title: 'Second', startedAt: first + 2 * HOUR, endedAt: first + 2.5 * HOUR, isEditable: true },
  ], view: { start: now - 7 * 24 * HOUR, end: now, focusedAt: first } });
  const geometry = await page.evaluate(() => {
    const timeline = window.__timeline.__timeline;
    return timeline.tasks.map(task => ({ width: timeline._taskElementByKey(task._key).getBoundingClientRect().width,
      axisWidth: task.x1 - task.x0 }));
  });
  expect(geometry[0].width).toBeGreaterThanOrEqual(30);
  expect(geometry[1].width).toBeGreaterThanOrEqual(30);
  expect(geometry[0].axisWidth).toBeCloseTo(geometry[0].width, 1);
  expect(geometry[1].axisWidth).toBeCloseTo(geometry[1].width, 1);
});

test('Calendar keeps its hour grid and stationary entries fixed while moving a short entry', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-16T16:00:00Z') });
  const base = await page.evaluate(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today.getTime();
  });
  await mount(page, { items: [
    { id: 'entry:a', url: 'https://example.com/a', startedAt: base + 10 * HOUR, endedAt: base + 11 * HOUR, isEditable: true },
    { id: 'entry:b', url: 'https://example.com/b', startedAt: base + 13 * HOUR, endedAt: base + 13 * HOUR + 5 * 60_000, isEditable: true },
    { id: 'entry:c', url: 'https://example.com/c', startedAt: base + 11 * HOUR + 40 * 60_000, endedAt: base + 12 * HOUR, isEditable: true },
  ], view: { start: base, end: base + 24 * HOUR, focusedAt: base + 11 * HOUR } });
  await page.evaluate(base => {
    window.__timeline.setViewMode('calendar');
    window.__timeline.setCalendarRange({ start: base, end: base + 24 * 60 * 60_000 });
  }, base);
  const source = page.locator('#timeline .calendar-task[data-task-key="entry:b"]').first();
  await expect(source).toBeVisible();
  const initial = await page.evaluate(() => {
    const timeline = window.__timeline.__timeline;
    const moving = timeline.calendarCanvas.querySelector('.calendar-task[data-task-key="entry:b"]');
    moving.scrollIntoView({ block: 'center' });
    const from = moving.getBoundingClientRect().toJSON();
    const sourceX = from.x + from.width / 2, sourceY = from.y + from.height / 2;
    const fixed = timeline.calendarCanvas.querySelector('.calendar-task[data-task-key="entry:a"]');
    const rect = timeline.calendarCanvas.getBoundingClientRect();
    const day = timeline._calendarDayIndexForTime(timeline._findTask('entry:b').start);
    return {
      from,
      hitKey: timeline.shadow.elementFromPoint(sourceX, sourceY)?.closest('.calendar-task')?.dataset.taskKey,
      viewport: { width: innerWidth, height: innerHeight },
      before: { hour: timeline._calendarMetrics.verticalMap.toY(12 * 60), fixedTop: Number.parseFloat(fixed.style.top) },
      destination: { x: rect.left + timeline._calendarMetrics.timeAxisWidth + (day + 0.5) * timeline._calendarMetrics.dayWidth,
        y: rect.top + timeline._calendarMetrics.headerHeight + timeline._calendarMetrics.verticalMap.toY(11 * 60 + 30) },
    };
  });
  const { from, before, destination, viewport, hitKey } = initial;
  expect(from.width).toBeGreaterThan(0);
  expect(from.height).toBeGreaterThan(0);
  expect(hitKey).toBe('entry:b');
  expect(from.x + from.width / 2).toBeGreaterThan(0);
  expect(from.x + from.width / 2).toBeLessThan(viewport.width);
  expect(from.y + from.height / 2).toBeGreaterThan(0);
  expect(from.y + from.height / 2).toBeLessThan(viewport.height);
  expect(destination.x).toBeGreaterThan(0);
  expect(destination.x).toBeLessThan(viewport.width);
  expect(destination.y).toBeGreaterThan(0);
  expect(destination.y).toBeLessThan(viewport.height);
  const geometry = () => page.evaluate(() => {
    const timeline = window.__timeline.__timeline;
    const fixed = timeline.calendarCanvas.querySelector('.calendar-task[data-task-key="entry:a"]');
    return { hour: timeline._calendarMetrics.verticalMap.toY(12 * 60), fixedTop: Number.parseFloat(fixed.style.top) };
  });
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(destination.x, destination.y, { steps: 8 });
  expect(await geometry()).toEqual(before);
  expect(await page.evaluate(() => window.__timeline.__timeline._findTask('entry:b').start)).toBeLessThan(base + 13 * HOUR);
  const boxes = await page.evaluate(() => {
    const canvas = window.__timeline.__timeline.calendarCanvas;
    return ['b', 'c'].map(key => canvas.querySelector(`.calendar-task[data-task-key="entry:${key}"]`)
      .getBoundingClientRect().toJSON());
  });
  expect(boxes[0].bottom).toBeLessThanOrEqual(boxes[1].top);
  await page.mouse.up();
  expect((await geometry()).fixedTop).toBe(before.fixedTop);
});

test('Calendar recomputes short-entry spacing after pointer release and a same-week refresh', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-16T16:00:00Z') });
  const day = new Date('2026-10-16T16:00:00Z'); day.setHours(0, 0, 0, 0);
  const base = day.getTime();
  const original = { id: 'entry:a', url: 'https://example.com/a', startedAt: base + 15 * HOUR,
    endedAt: base + 15 * HOUR + 60_000, isEditable: true };
  await mount(page, { items: [original], view: { start: base, end: base + 24 * HOUR, focusedAt: original.startedAt } });
  await page.evaluate(base => {
    window.__timeline.setViewMode('calendar');
    window.__timeline.__timeline.setCalendarRange({ start: base, end: base + 24 * 60 * 60_000 });
  }, base);
  const a = page.locator('#timeline .calendar-task[data-task-key="entry:a"]').first();
  await expect(a).toBeVisible();
  await a.hover();
  await page.mouse.down();
  expect(await page.evaluate(() => Boolean(window.__timeline.__timeline._calendarPinnedVerticalMap))).toBe(true);
  await page.mouse.up();
  await page.evaluate(base => window.__timeline.update({ items: [{
    id: 'entry:a', url: 'https://example.com/a', startedAt: base + 10 * 60 * 60_000,
    endedAt: base + 10 * 60 * 60_000 + 60_000, isEditable: true,
  }, {
    id: 'entry:b', url: 'https://example.com/b', startedAt: base + 10 * 60 * 60_000 + 2 * 60_000,
    endedAt: base + 10 * 60 * 60_000 + 3 * 60_000, isEditable: true,
  }], now: Date.now() }), base);
  const bounds = await page.evaluate(() => {
    const canvas = window.__timeline.__timeline.calendarCanvas;
    const first = canvas.querySelector('.calendar-task[data-task-key="entry:a"]');
    const second = canvas.querySelector('.calendar-task[data-task-key="entry:b"]');
    return { firstBottom: first.getBoundingClientRect().bottom, secondTop: second.getBoundingClientRect().top };
  });
  expect(bounds.firstBottom).toBeLessThanOrEqual(bounds.secondTop);
});

test('hydrates running and pending entries with Clockoli block styling', async ({ page }) => {
  await mount(page);
  const state = await page.evaluate(() => ({
    running: window.__timeline.__timeline.getRunningTask()?.instanceId,
    pending: window.__timeline.__timeline.getInteractionState().pendingInstanceIds,
    blocks: [...document.querySelector('#timeline').shadowRoot.querySelectorAll('.task')].map(element => ({
      key: element.dataset.taskKey,
      height: getComputedStyle(element).height,
      radius: getComputedStyle(element).borderRadius,
      leftBorder: getComputedStyle(element).borderLeftWidth,
      pending: element.classList.contains('pending'),
    })),
  }));
  expect(state.running).toBe('active:c');
  expect(state.pending).toEqual(['entry:b']);
  expect(state.blocks.every(block => block.height === '40px')).toBeTruthy();
  expect(state.blocks.every(block => block.radius === '7px')).toBeTruthy();
  expect(state.blocks.every(block => block.leftBorder === '3px')).toBeTruthy();
  expect(state.blocks.find(block => block.key === 'entry:b').pending).toBeTruthy();
});

test('a completed record of the running task offers Stop and save rather than disabled Start', async ({ page }) => {
  const now = Date.now();
  await mount(page, { items: [
    { id: 'entry:old', url: 'https://example.com/c', title: 'Task C', startedAt: now - 3 * HOUR, endedAt: now - 2 * HOUR, rowId: 'one', isEditable: true, isCurrentTask: true, isStartDisabled: true },
    { id: 'active:now', url: 'https://example.com/c', title: 'Task C', startedAt: now - 120_000, endedAt: null, rowId: 'one', isRunning: true, isEditable: false },
  ] });
  await page.locator('#timeline .task[data-task-key="entry:old"]').click();
  const action = page.locator('#timeline .clockoli-timeline-action.primary');
  await expect(action).toHaveText('Stop and save');
  await expect(action).toBeEnabled();
  await page.locator('#timeline .task[data-task-key="active:now"]').click();
  await expect(action).toHaveText('Stop and save');
  await expect(action).toBeEnabled();
  await page.locator('#timeline .task[data-task-key="entry:old"]').click();
  await action.click();
  expect(await page.evaluate(() => window.__calls)).toContainEqual(['stop', 'entry:old']);
  expect(await page.evaluate(() => window.__calls)).not.toContainEqual(['start', 'entry:old']);
  await page.evaluate(() => {
    window.__items = window.__items.filter(item => item.id !== 'active:now').map(item => ({ ...item, isCurrentTask: false, isStartDisabled: false }));
    window.__timeline.update({ items: window.__items });
  });
  await expect(action).toHaveText('Track time');
  await expect(action).toBeEnabled();
});

test('completed details expose Edit even when the task is currently running', async ({ page }) => {
  const now = Date.now();
  await mount(page, { entryForm: true, items: [
    { id: 'entry:old', url: 'https://example.com/c', title: 'Task C', startedAt: now - 3 * HOUR, endedAt: now - 2 * HOUR, rowId: 'one', isEditable: true, isCurrentTask: true },
    { id: 'active:now', url: 'https://example.com/c', title: 'Task C', startedAt: now - 120_000, endedAt: null, rowId: 'one', isRunning: true, isEditable: false },
  ] });
  await page.locator('#timeline .task[data-task-key="entry:old"]').click();
  await expect(page.locator('#timeline .clockoli-timeline-description')).toHaveCount(0);
  const edit = page.locator('#timeline .clockoli-entry-edit');
  await expect(edit).toBeEnabled();
  await expect(edit).toHaveText('Edit');
  const icon = edit.locator('svg.clockoli-timeline-icon[data-action="edit"]');
  await expect(icon).toBeVisible();
  await expect(icon).toHaveAttribute('aria-hidden', 'true');
  await edit.click();
  expect(await page.evaluate(() => window.__calls)).toContainEqual(['edit-form', 'entry:old']);
  await page.locator('#timeline .task[data-task-key="active:now"]').click();
  await expect(page.locator('#timeline .clockoli-timeline-description')).toHaveCount(0);
  await expect(edit).toBeEnabled();
  await expect(edit.locator('svg.clockoli-timeline-icon[data-action="edit"]')).toBeVisible();
  await edit.click();
  expect(await page.evaluate(() => window.__calls)).toContainEqual(['edit-form', 'active:now']);
});

for (const mode of ['timeline', 'calendar']) {
  test(`${mode} opens details on hover without keeping a mouse selection open`, async ({ page }) => {
    await mount(page, { entryForm: true });
    if (mode === 'calendar') await page.evaluate(() => window.__timeline.setViewMode('calendar'));
    const record = page.locator(`#timeline ${mode === 'calendar' ? '.calendar-task' : '.task'}[data-task-key="entry:a"]`).first();
    const details = page.locator('#timeline .details');
    await page.locator('body').hover({ position: { x: 1, y: 1 } });
    await record.hover();
    await expect(details).toBeVisible();
    expect(await page.evaluate(() => window.__timeline.__timeline.selectedKey)).toBeNull();
    await record.click();
    await expect(details).toBeVisible();
    await page.locator('body').hover({ position: { x: 1, y: 1 } });
    await expect(details).toBeHidden();
  });

  test(`${mode} keeps details available for keyboard focus and its actions`, async ({ page }) => {
    await mount(page, { entryForm: true });
    if (mode === 'calendar') await page.evaluate(() => window.__timeline.setViewMode('calendar'));
    const record = page.locator(`#timeline ${mode === 'calendar' ? '.calendar-task' : '.task'}[data-task-key="entry:a"]`).first();
    const details = page.locator('#timeline .details');
    await record.focus();
    await expect(details).toBeVisible();
    await page.evaluate(() => window.__timeline.__timeline._renderAll({ invalidateRulerScales: false }));
    await expect(record).toBeFocused();
    await expect(details).toBeVisible();
    if (mode === 'calendar') {
      await page.evaluate(() => window.__timeline.__timeline._renderCalendarTasks());
      await expect(record).toBeFocused();
      await expect(details).toBeVisible();
    }
    await details.getByRole('button', { name: 'Edit' }).focus();
    await expect(details).toBeVisible();
    await details.getByRole('button', { name: 'Edit' }).evaluate(button => button.blur());
    await expect(details).toBeHidden();
  });

  test(`${mode} reveals the details card on a touchscreen tap`, async ({ browser }) => {
    const context = await browser.newContext({ hasTouch: true, viewport: { width: 420, height: 900 } });
    try {
      const page = await context.newPage();
      await mount(page, { entryForm: true });
      if (mode === 'calendar') await page.evaluate(() => window.__timeline.setViewMode('calendar'));
      const record = page.locator(`#timeline ${mode === 'calendar' ? '.calendar-task' : '.task'}[data-task-key="entry:a"]`).first();
      await record.tap();
      const details = page.locator('#timeline .details');
      await expect(details).toBeVisible();
      await expect(details.getByRole('button', { name: 'Edit' })).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test(`${mode} uses the details card instead of black start and end hover badges`, async ({ page }) => {
    await mount(page);
    if (mode === 'calendar') await page.evaluate(() => window.__timeline.setViewMode('calendar'));
    const record = page.locator(`#timeline ${mode === 'calendar' ? '.calendar-task' : '.task'}[data-task-key="entry:a"]`).first();
    await record.hover();
    await expect(page.locator('#timeline .details')).toBeVisible();
    const clock = mode === 'calendar' ? '.calendar-edit-clock' : '.edit-clock';
    for (const edge of mode === 'calendar' ? ['start', 'end'] : ['start', 'end', 'duration']) {
      await expect(record.locator(`${clock}.${edge}`)).toHaveCSS('visibility', 'hidden');
    }
    const handle = mode === 'calendar' ? '.calendar-resize-handle' : '.resize-handle';
    for (const [edge, label] of mode === 'calendar' ? [['start', 'Change start time'], ['end', 'Change end time']]
      : [['left', 'Change start time'], ['right', 'Change end time']]) {
      await expect(record.locator(`${handle}.${edge}`)).not.toHaveAttribute('title');
      await expect(record.locator(`${handle}.${edge}`)).not.toHaveAttribute('data-clockoli-tooltip');
      await expect(record.locator(`${handle}.${edge}`)).toHaveAttribute('aria-label', label);
    }
  });

  test(`${mode} shows interactive details beside the hovered record without a permanent details row`, async ({ page }) => {
    await mount(page, { entryForm: true });
    if (mode === 'calendar') await page.evaluate(() => window.__timeline.setViewMode('calendar'));
    const record = page.locator(`#timeline ${mode === 'calendar' ? '.calendar-task' : '.task'}[data-task-key="entry:a"]`).first();
    const details = page.locator('#timeline .details');
    await expect(details).toBeHidden();
    await record.hover();
    await expect(details).toBeVisible();
    const finish = await details.evaluate(node => ({
      background: getComputedStyle(node).backgroundColor,
      blur: getComputedStyle(node).backdropFilter,
      radius: getComputedStyle(node).borderRadius,
      primary: getComputedStyle(node.querySelector('.clockoli-timeline-action.primary')).backgroundColor,
    }));
    expect(finish.background).toMatch(/\/ 0\.9\d+\)|0\.9\d+\)$/);
    expect(finish.blur).toContain('blur(');
    expect(finish.radius).toBe('12px');
    expect(finish.primary).not.toBe('rgb(31, 136, 61)');
    await expect(details.locator('.details-title')).toBeVisible();
    await expect(details.locator('.details-value')).toHaveCount(3);
    await expect(details.getByRole('button', { name: 'Edit' })).toBeVisible();
    const position = await details.evaluate(node => {
      const rect = node.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right,
        viewportWidth: innerWidth, viewportHeight: innerHeight };
    });
    expect(position.left).toBeGreaterThanOrEqual(0);
    expect(position.right).toBeLessThanOrEqual(position.viewportWidth);
    expect(position.top).toBeGreaterThanOrEqual(0);
    expect(position.bottom).toBeLessThanOrEqual(position.viewportHeight);
    if (process.env.CLOCKOLI_TOOLTIP_SCREENSHOT && mode === 'calendar') {
      await page.screenshot({ path: process.env.CLOCKOLI_TOOLTIP_SCREENSHOT });
    }
    await details.getByRole('button', { name: 'Edit' }).click();
    expect(await page.evaluate(() => window.__calls)).toContainEqual(['edit-form', 'entry:a']);
    await page.locator('body').hover({ position: { x: 1, y: 1 } });
    await expect(details).toBeHidden();
    await record.click();
    await expect(details).toBeVisible();
    await page.setViewportSize({ width: 420, height: 900 });
    await page.locator('#timeline').evaluate(host => { host.style.width = '404px'; });
    await expect(details).toBeVisible();
    await expect.poll(() => details.evaluate(node => node.getBoundingClientRect().right)).toBeLessThanOrEqual(420);
    const narrow = await details.boundingBox();
    expect(narrow.x).toBeGreaterThanOrEqual(0);
    expect(narrow.x + narrow.width).toBeLessThanOrEqual(420);
  });

  test(`details without a description keep action buttons at the right edge in ${mode}`, async ({ page }) => {
    const now = Date.now();
    await mount(page, { entryForm: true, items: [
      { id: 'entry:old', url: 'https://example.com/old', title: 'Old', startedAt: now - 3 * HOUR, endedAt: now - 2 * HOUR, rowId: 'one', isEditable: true },
      { id: 'active:now', url: 'https://example.com/now', title: 'Now', startedAt: now - HOUR, endedAt: null, rowId: 'one', isRunning: true, isEditable: false },
    ] });
    if (mode === 'calendar') await page.evaluate(() => window.__timeline.setViewMode('calendar'));
    for (const width of [1600, 420]) {
      await page.setViewportSize({ width, height: 900 });
      await page.locator('#timeline').evaluate((host, width) => { host.style.width = `${width - 16}px`; }, width);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      for (const id of ['entry:old', 'active:now']) {
        await page.locator('body').hover({ position: { x: 1, y: 1 } });
        await expect(page.locator('#timeline .details')).toBeHidden();
        await page.locator(`#timeline ${mode === 'calendar' ? '.calendar-task' : '.task'}[data-task-key="${id}"]`).first().click();
        await expect(page.locator('#timeline .details')).toBeVisible();
        const gap = await page.locator('#timeline .clockoli-timeline-actions').evaluate(actions => {
          const details = actions.closest('.details');
          const last = actions.querySelector('.clockoli-timeline-action:last-child');
          return details.getBoundingClientRect().right - parseFloat(getComputedStyle(details).paddingRight) - last.getBoundingClientRect().right;
        });
        expect(Math.abs(gap)).toBeLessThanOrEqual(2);
      }
    }
  });
}

test('Calendar keeps keyboard details visible when the focused day segment disappears', async ({ page }) => {
  await page.clock.install({ time: new Date(2026, 9, 28, 12) });
  const start = new Date(2026, 9, 26, 23).getTime();
  const end = new Date(2026, 9, 31, 1).getTime();
  await page.setViewportSize({ width: 320, height: 640 });
  await mount(page, { weeklyCalendar: true, entryForm: true, rows: [{ id: 'one', title: 'One' }],
    items: [{ id: 'entry:a', url: 'https://example.com/a', title: 'Long task',
      startedAt: start, endedAt: end, rowId: 'one', isEditable: true }] });
  await page.locator('#timeline').evaluate(host => { host.style.width = '304px'; });
  await page.evaluate(() => window.__timeline.setViewMode('calendar'));
  const segments = page.locator('#timeline .calendar-task[data-task-key="entry:a"]');
  await expect(segments).toHaveCount(6);
  await segments.last().evaluate(element => element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }));
  await segments.last().focus();
  const details = page.locator('#timeline .details');
  await expect(details).toBeVisible();
  const before = await page.evaluate(() => window.__timeline.__timeline.calendarViewport.scrollLeft);
  expect(before).toBeGreaterThan(0);
  await page.evaluate(end => {
    const timeline = window.__timeline.__timeline;
    timeline._findTask('entry:a').end = end;
    timeline._renderCalendarTasks();
  }, new Date(2026, 9, 26, 23, 45).getTime());
  await expect(segments).toHaveCount(1);
  await expect(segments.first()).toBeFocused();
  const after = await page.evaluate(() => window.__timeline.__timeline.calendarViewport.scrollLeft);
  expect(after).toBeLessThan(before);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(details).toBeVisible();
});

test('hides the sole project label across Timeline, Calendar and details, restoring it for multiple projects', async ({ page }) => {
  const now = Date.now();
  const items = [{ id: 'entry:a', url: 'https://example.com/a', title: 'Task A', startedAt: now - HOUR, endedAt: now - HOUR / 2, rowId: 'other', isEditable: true }];
  await mount(page, { items, rows: [{ id: 'other', title: 'Other' }] });
  const root = page.locator('#timeline .shell');
  expect(await root.locator('.row-label').count()).toBe(0);
  await root.locator('.task').first().click();
  expect(await root.locator('.details-project').count()).toBe(0);
  await page.evaluate(() => window.__timeline.setViewMode('calendar'));
  expect(await root.locator('.calendar-row-name').count()).toBe(0);
  await expect(root.locator('.calendar-sticky-header').first()).toBeVisible();
  await expect(root.locator('.calendar-sticky-header').first()).toHaveCSS('height', '44px');

  await page.evaluate(() => window.__timeline.update({ rows: [{ id: 'other', title: 'Other' }, { id: 'second', title: 'Second' }] }));
  expect(await root.locator('.calendar-row-name').first().textContent()).toBe('Other');
  await expect(root.locator('.calendar-sticky-header').first()).toHaveCSS('height', '68px');
  await page.evaluate(() => window.__timeline.setViewMode('timeline'));
  expect(await root.locator('.row-label').allTextContents()).toEqual(['Other', 'Second']);
  await root.locator('.task').first().click();
  expect(await root.locator('.details-project').first().textContent()).toBe('Other');

  await page.evaluate(() => window.__timeline.update({ rows: [{ id: 'other', title: 'Other' }] }));
  expect(await root.locator('.row-label').count()).toBe(0);
  expect(await root.locator('.details-project').count()).toBe(0);
});

test('Timeline shows no seconds in times, durations, or selected Start and End', async ({ page }) => {
  const start = new Date(2026, 9, 12, 9, 0, 49).getTime();
  const end = new Date(2026, 9, 12, 10, 0, 25).getTime();
  await mount(page, {
    items: [{ id: 'entry:precise', url: 'https://example.com/precise', title: 'Precise', startedAt: start, endedAt: end, rowId: 'one', isEditable: true }],
    view: { start: start - HOUR, end: end + HOUR, focusedAt: start },
  });
  const card = page.locator('#timeline .task[data-task-key="entry:precise"]');
  await expect(page.locator('#timeline .domain-start')).toHaveText(/\d{2}\.\d{2}\.2026 \d{2}:\d{2}$/);
  await expect(page.locator('#timeline .domain-end')).toHaveText(/\d{2}\.\d{2}\.2026 \d{2}:\d{2}$/);
  await expect(page.locator('#timeline .tracked')).not.toContainText('s');
  await expect(card).toHaveAttribute('aria-label', 'Precise: 12.10.2026 09:00 — 12.10.2026 10:00');
  await expect(card.locator('.task-time')).toHaveText('09:00–10:00 · 59m');
  await card.hover();
  await expect(card.locator('.edit-clock.start')).toHaveText('Start09:00');
  await expect(card.locator('.edit-clock.end')).toHaveText('End10:00');
  await expect(card.locator('.edit-clock.duration')).toHaveText('Duration59m');
  await card.click();
  const details = await page.locator('#timeline .details-value').allTextContents();
  expect(details).toEqual(['Start09:00', 'End10:00', 'Duration59m']);
  expect(await page.evaluate(() => {
    const task = window.__timeline.__timeline._findTask('entry:precise');
    return [task.start, task.end];
  })).toEqual([start, end]);
});

test('Timeline labels each local day with its tracked time, splitting midnight and updating after changes', async ({ page }) => {
  await page.clock.setFixedTime(new Date(2026, 9, 12, 12));
  const day = new Date(2026, 9, 10);
  const next = new Date(2026, 9, 11);
  const third = new Date(2026, 9, 12);
  const end = new Date(2026, 9, 13);
  const startAt = new Date(2026, 9, 10, 23).getTime();
  const endAt = new Date(2026, 9, 11, 1).getTime();
  await mount(page, {
    items: [{ id: 'entry:overnight', url: 'https://example.com/overnight', title: 'Overnight', startedAt: startAt, endedAt: endAt, rowId: 'one', isEditable: true }],
    view: { start: day.getTime(), end: end.getTime(), focusedAt: next.getTime() },
  });
  await expect(page.locator(`#timeline .day-band[data-start="${day.getTime()}"] .day-tracked`)).toHaveText('Tracked: 1h');
  await expect(page.locator(`#timeline .day-band[data-start="${next.getTime()}"] .day-tracked`)).toHaveText('Tracked: 1h');
  await expect(page.locator(`#timeline .day-band[data-start="${third.getTime()}"] .day-tracked`)).toHaveText('Tracked: 0m');
  await expect(page.locator('#timeline .tracked')).toBeHidden();
  await page.evaluate(({ endAt, hour }) => window.__timeline.update({ items: [{ ...window.__items[0], endedAt: endAt + hour }] }), { endAt, hour: HOUR });
  await expect(page.locator(`#timeline .day-band[data-start="${next.getTime()}"] .day-tracked`)).toHaveText('Tracked: 2h');
});

test('Timeline shows daily tracked time without a separate Today summary above the ruler', async ({ page }) => {
  await page.clock.setFixedTime(new Date(2026, 9, 12, 12));
  const day = new Date(2026, 9, 12).getTime();
  await mount(page, {
    items: [{ id: 'active:today', url: 'https://example.com/today', title: 'Today', startedAt: day + 11 * HOUR, endedAt: null, rowId: 'one', isRunning: true }],
    view: { start: day, end: day + 12 * HOUR, focusedAt: day + 12 * HOUR },
  });
  await expect(page.locator(`#timeline .day-band[data-start="${day}"] .day-tracked`)).toHaveText('Tracked: 1h');
  await expect(page.locator('#timeline .meta .tracked')).toBeHidden();
  await expect(page.locator('#timeline .meta .domain-start')).toBeVisible();
  await expect(page.locator('#timeline .meta .domain-end')).toBeVisible();
  await page.evaluate(() => window.__timeline.setViewMode('calendar'));
  await expect(page.locator('#timeline .meta .tracked')).toBeHidden();
});

test('Timeline shows Total for a week without replacing individual day totals', async ({ page }) => {
  await page.clock.setFixedTime(new Date(2026, 9, 12, 12));
  const start = new Date(2026, 9, 5).getTime();
  const end = new Date(2026, 9, 12).getTime();
  await mount(page, {
    items: [
      { id: 'first', url: 'https://example.com/first', title: 'First', startedAt: start + 9 * HOUR, endedAt: start + 10 * HOUR, rowId: 'one' },
      { id: 'last', url: 'https://example.com/last', title: 'Last', startedAt: end - 2 * HOUR, endedAt: end - HOUR, rowId: 'one' },
    ],
    view: { start, end, focusedAt: start },
  });
  await expect(page.locator('#timeline .meta .tracked')).toHaveText('Total: 2h');
  await expect(page.locator(`#timeline .day-band[data-start="${start}"] .day-tracked`)).toHaveText('Tracked: 1h');
  await expect(page.locator(`#timeline .day-band[data-start="${end - 24 * HOUR}"] .day-tracked`)).toHaveText('Tracked: 1h');
});

test('Timeline keeps daily completed and running time correct when panning', async ({ page }) => {
  const now = new Date(2026, 9, 12, 12);
  const yesterday = new Date(2026, 9, 11).getTime();
  await page.clock.install({ time: now });
  await mount(page, {
    items: [
      { id: 'completed:today', url: 'https://example.com/done', title: 'Done', startedAt: new Date(2026, 9, 12, 9).getTime(), endedAt: new Date(2026, 9, 12, 10).getTime(), rowId: 'one' },
      { id: 'active:today', url: 'https://example.com/active', title: 'Active', startedAt: new Date(2026, 9, 12, 11, 30).getTime(), endedAt: null, rowId: 'one', isRunning: true },
    ],
    view: { start: yesterday, end: now.getTime(), focusedAt: yesterday },
  });
  const summary = page.locator(`#timeline .day-band[data-start="${new Date(2026, 9, 12).getTime()}"] .day-tracked`);
  await expect(summary).toHaveText('Tracked: 1h 30m');
  await page.locator('#timeline .viewport').evaluate(element => { element.scrollLeft = element.scrollWidth; });
  await expect(summary).toHaveText('Tracked: 1h 30m');
  await page.clock.runFor(60_000);
  await expect(summary).toHaveText('Tracked: 1h 31m');
  await page.evaluate(() => window.__timeline.update({ items: [{ ...window.__items[0], endedAt: new Date(2026, 9, 12, 10, 30).getTime() }, window.__items[1]] }));
  await expect(summary).toHaveText('Tracked: 2h 1m');
  await page.setViewportSize({ width: 420, height: 800 });
  expect(await summary.evaluate(element => {
    const label = element.getBoundingClientRect();
    const shell = element.closest('.shell').getBoundingClientRect();
    return label.left >= shell.left && label.right <= shell.right;
  })).toBe(true);
});

test('Timeline does not call a historical period today', async ({ page }) => {
  await page.clock.setFixedTime(new Date(2026, 9, 12, 12));
  await mount(page, {
    items: [{ id: 'yesterday', url: 'https://example.com/yesterday', title: 'Yesterday', startedAt: new Date(2026, 9, 11, 9).getTime(), endedAt: new Date(2026, 9, 11, 10).getTime(), rowId: 'one' }],
    view: { start: new Date(2026, 9, 11).getTime(), end: new Date(2026, 9, 12).getTime(), focusedAt: new Date(2026, 9, 11).getTime() },
  });
  await expect(page.locator('#timeline .tracked')).toBeHidden();
});

test('Timeline daily total follows a running timer across the next minute', async ({ page }) => {
  const now = new Date(2026, 9, 12, 12);
  const day = new Date(2026, 9, 12).getTime();
  await page.clock.install({ time: now });
  await mount(page, {
    items: [{ id: 'active:today', url: 'https://example.com/today', title: 'Today', startedAt: now.getTime() - 2 * 60_000, endedAt: null, rowId: 'one', isRunning: true }],
    view: { start: day, end: now.getTime(), focusedAt: now.getTime() },
  });
  const total = page.locator(`#timeline .day-band[data-start="${day}"] .day-tracked`);
  await expect(total).toHaveText('Tracked: 2m');
  await page.clock.runFor(61_000);
  await expect(total).toHaveText('Tracked: 3m');
});

test('Timeline updates todays total when elapsed time crosses a minute inside the same clock minute', async ({ page }) => {
  const now = new Date(2026, 9, 12, 12, 0, 5);
  const day = new Date(2026, 9, 12).getTime();
  await page.clock.install({ time: now });
  await mount(page, {
    items: [{ id: 'active:seconds', url: 'https://example.com/today', title: 'Today', startedAt: now.getTime() - 50_000, endedAt: null, rowId: 'one', isRunning: true }],
    view: { start: day, end: now.getTime(), focusedAt: now.getTime() },
  });
  const total = page.locator(`#timeline .day-band[data-start="${day}"] .day-tracked`);
  await expect(total).toHaveText('Tracked: 0m');
  await page.clock.runFor(11_000);
  await expect(total).toHaveText('Tracked: 1m');
});

test('Timeline creates a new daily total when a running timer crosses local midnight', async ({ page }) => {
  const now = new Date(2026, 9, 12, 23, 59);
  const today = new Date(2026, 9, 12).getTime();
  const tomorrow = new Date(2026, 9, 13).getTime();
  await page.clock.install({ time: now });
  await mount(page, {
    items: [{ id: 'active:midnight', url: 'https://example.com/midnight', title: 'Midnight', startedAt: now.getTime() - 2 * 60_000, endedAt: null, rowId: 'one', isRunning: true }],
    view: { start: today, end: now.getTime(), focusedAt: now.getTime() },
  });
  await page.clock.runFor(120_000);
  await expect(page.locator(`#timeline .day-band[data-start="${today}"] .day-tracked`)).toHaveText('Tracked: 3m');
  await expect(page.locator(`#timeline .day-band[data-start="${tomorrow}"] .day-tracked`)).toHaveText('Tracked: 1m');
  await expect(page.locator('#timeline .tracked')).toBeHidden();
});

test('Calendar shows minute-only times on the card, hover badges, and selected details', async ({ page }) => {
  await page.clock.setFixedTime(new Date(2026, 9, 12, 11));
  const start = new Date(2026, 9, 12, 9, 0, 49).getTime();
  const end = new Date(2026, 9, 12, 10, 0, 25).getTime();
  await mount(page, {
    items: [{ id: 'entry:precise', url: 'https://example.com/precise', title: 'Precise', startedAt: start, endedAt: end, rowId: 'one', isEditable: true }],
    view: { start: start - HOUR, end: end + HOUR, focusedAt: start },
  });
  await page.evaluate(() => window.__timeline.setViewMode('calendar'));
  const card = page.locator('#timeline .calendar-task[data-task-key="entry:precise"]').first();
  await expect(page.locator('#timeline .domain-start')).toHaveText(/\d{2}\.\d{2}\.2026 \d{2}:\d{2}$/);
  await expect(page.locator('#timeline .domain-end')).toHaveText(/\d{2}\.\d{2}\.2026 \d{2}:\d{2}$/);
  await expect(card.locator('.calendar-task-time')).toHaveText('09:00–10:00');
  await card.hover();
  await expect(card.locator('.calendar-edit-clock.start')).toHaveText('Start09:00');
  await expect(card.locator('.calendar-edit-clock.end')).toHaveText('End10:00');
  await card.click();
  expect(await page.locator('#timeline .details-value').allTextContents()).toEqual([
    'Start09:00', 'End10:00', 'Duration59m',
  ]);
  expect(await page.evaluate(() => {
    const task = window.__timeline.__timeline._findTask('entry:precise');
    return [task.start, task.end];
  })).toEqual([start, end]);
});

test('Timeline running action and sub-minute durations show no seconds', async ({ page }) => {
  await page.clock.setFixedTime(new Date(2026, 9, 12, 11, 0, 16));
  const now = new Date(2026, 9, 12, 11, 0, 16).getTime();
  await mount(page, {
    items: [
      { id: 'entry:short', title: 'Short', startedAt: now - 60_000, endedAt: now - 45_000, rowId: 'one', isEditable: true },
      { id: 'active:now', title: 'Running', startedAt: now - 16_000, endedAt: null, rowId: 'two', isRunning: true, isEditable: false },
    ],
  });
  await page.locator('#timeline .task[data-task-key="entry:short"]').click();
  await expect(page.locator('#timeline .details-value').last()).toHaveText('Duration0m');
  await page.locator('#timeline .task[data-task-key="active:now"]').click();
  await expect(page.locator('#timeline .clockoli-timeline-action.primary')).toHaveText('Stop and save');
  await expect(page.locator('#timeline .tracked')).not.toContainText('s');
});

test('direct-connection tooltips do not mention seconds in Timeline or Calendar', async ({ page }) => {
  const previousDay = new Date();
  previousDay.setDate(previousDay.getDate() - 1);
  previousDay.setHours(9, 0, 0, 0);
  const start = previousDay.getTime();
  await mount(page, {
    view: { start: start - HOUR, end: start + 7_200_000, focusedAt: start },
    items: [
      { id: 'entry:first', title: 'First', startedAt: start, endedAt: start + 3_600_000, rowId: 'one', isEditable: true },
      { id: 'entry:next', title: 'Next', startedAt: start + 3_601_000, endedAt: start + 5_400_000, rowId: 'one', isEditable: true },
    ],
  });
  await expect(page.locator('#timeline .connector-dot')).toHaveAttribute('data-clockoli-tooltip', 'First → Next: connected');
  await page.evaluate(() => window.__timeline.setViewMode('calendar'));
  await expect(page.locator('#timeline .calendar-connector-dot').first()).toHaveAttribute('data-clockoli-tooltip', 'First → Next: connected');
});

test('switches Timeline and Calendar without losing running state', async ({ page }) => {
  await mount(page);
  await page.evaluate(() => window.__timeline.setViewMode('calendar'));
  expect(await page.evaluate(() => window.__timeline.getViewMode())).toBe('calendar');
  expect(await page.evaluate(() => window.__timeline.__timeline.getRunningTask()?.instanceId)).toBe('active:c');
  const calendarVisible = await page.evaluate(() => !document.querySelector('#timeline').shadowRoot.querySelector('.calendar-view').hidden);
  expect(calendarVisible).toBeTruthy();
  const calendarStyle = await page.evaluate(() => {
    const block = document.querySelector('#timeline').shadowRoot.querySelector('.calendar-task');
    const style = getComputedStyle(block);
    return { leftBorder: style.borderLeftWidth, radius: style.borderRadius, shadow: style.boxShadow };
  });
  expect(calendarStyle).toEqual({ leftBorder: '3px', radius: '7px', shadow: 'none' });
  await page.evaluate(() => window.__timeline.setViewMode('timeline'));
  expect(await page.evaluate(() => window.__timeline.getViewMode())).toBe('timeline');
});

test('Activity Calendar defaults to a Monday–Sunday week while the popup retains its compact range', async ({ page }) => {
  const now = Date.now();
  await mount(page, {
    weeklyCalendar: true,
    rows: [{ id: 'one', title: 'One' }],
    items: [{ id: 'entry:a', url: 'https://example.com/a', title: 'Task A', startedAt: now - HOUR, endedAt: now, rowId: 'one', isEditable: true }],
  });
  await page.evaluate(() => {
    document.querySelector('#timeline').style.width = '770px';
    window.__timeline.setViewMode('calendar');
  });
  const week = await page.evaluate(() => {
    const range = window.__timeline.getCalendarRange();
    const root = document.querySelector('#timeline').shadowRoot;
    return { ...range, headers: root.querySelectorAll('.calendar-day-header').length };
  });
  expect(week.days).toBe(7);
  expect(new Date(week.start).getDay()).toBe(1);
  expect(new Date(week.end).getDay()).toBe(1);
  expect(week.headers).toBe(7);
  expect(await page.evaluate(() => {
    const viewport = document.querySelector('#timeline').shadowRoot.querySelector('.calendar-viewport');
    return viewport.scrollWidth <= viewport.clientWidth;
  })).toBe(true);
  await page.evaluate(() => window.__timeline.shiftCalendar(-1));
  const previous = await page.evaluate(() => window.__timeline.getCalendarRange());
  expect(new Date(previous.start).getDay()).toBe(1);
  expect(previous.start).toBeLessThan(week.start);

  await mount(page);
  await page.evaluate(() => window.__timeline.setViewMode('calendar'));
  expect((await page.evaluate(() => window.__timeline.getCalendarRange())).days).toBeLessThan(7);
});

test('weekly Timeline and Calendar show Total alongside separate local day totals', async ({ page }) => {
  const monday = new Date(2026, 9, 12).getTime();
  const tuesday = new Date(2026, 9, 13).getTime();
  const wednesday = new Date(2026, 9, 14).getTime();
  const thursday = new Date(2026, 9, 15).getTime();
  const now = wednesday + 12 * HOUR;
  await page.clock.install({ time: new Date(now) });
  await mount(page, {
    weeklyCalendar: true,
    rows: [{ id: 'one', title: 'One' }],
    items: [
      { id: 'entry:overnight', url: 'https://example.com/overnight', title: 'Overnight', startedAt: monday + 23 * HOUR, endedAt: tuesday + HOUR, rowId: 'one', isEditable: true },
      { id: 'entry:wednesday', url: 'https://example.com/wednesday', title: 'Wednesday', startedAt: wednesday + 9 * HOUR, endedAt: wednesday + 10 * HOUR, rowId: 'one', isEditable: true },
      { id: 'active:wednesday', url: 'https://example.com/active', title: 'Active', startedAt: wednesday + 11 * HOUR, endedAt: null, rowId: 'one', isRunning: true },
    ],
    view: { start: monday, end: now, focusedAt: now },
    totalRange: { start: monday, end: new Date(2026, 9, 19).getTime() },
  });
  for (const [day, duration] of [[monday, '1h'], [tuesday, '1h'], [wednesday, '2h']]) {
    await expect(page.locator(`#timeline .day-band[data-start="${day}"] .day-tracked`)).toHaveText(`Tracked: ${duration}`);
  }
  await expect(page.locator('#timeline .tracked')).toHaveText('Total: 4h');
  await page.evaluate(() => window.__timeline.setViewMode('calendar'));
  const calendarDay = day => page.locator(`#timeline .calendar-day-header[data-start="${day}"]`);
  for (const [day, duration] of [[monday, '1h'], [tuesday, '1h'], [wednesday, '2h'], [thursday, '0m']]) {
    await expect(calendarDay(day).locator('.calendar-day-tracked')).toHaveText(`Tracked: ${duration}`);
  }
  await expect(page.locator('#timeline .tracked')).toHaveText('Total: 4h');
  await expect(page.locator('#timeline .tracked')).toBeVisible();
  await page.evaluate(end => window.__timeline.update({ items: window.__items.map(item => item.id === 'entry:wednesday' ? { ...item, endedAt: end } : item) }), wednesday + 10.5 * HOUR);
  await expect(calendarDay(wednesday).locator('.calendar-day-tracked')).toHaveText('Tracked: 2h 30m');
  await expect(calendarDay(tuesday).locator('.calendar-day-tracked')).toHaveText('Tracked: 1h');
  await expect(page.locator('#timeline .tracked')).toHaveText('Total: 4h 30m');
  await page.evaluate(({ start, end }) => {
    window.__timeline.update({ totalRange: { start, end }, view: { start, end, focusedAt: start } });
    window.__timeline.setCalendarRange({ start, end });
  }, { start: wednesday, end: thursday });
  await expect(page.locator('#timeline .tracked')).toBeHidden();
});

test('Calendar Total follows the displayed week when browsing away from the selected period', async ({ page }) => {
  const previousMonday = new Date(2026, 9, 5).getTime();
  const monday = new Date(2026, 9, 12).getTime();
  await page.clock.setFixedTime(new Date(2026, 9, 14, 12));
  await mount(page, {
    weeklyCalendar: true,
    items: [
      { id: 'previous', url: 'https://example.com/previous', title: 'Previous', startedAt: previousMonday + HOUR, endedAt: previousMonday + 3 * HOUR, rowId: 'one' },
      { id: 'current', url: 'https://example.com/current', title: 'Current', startedAt: monday + HOUR, endedAt: monday + 2 * HOUR, rowId: 'one' },
    ],
    view: { start: monday, end: new Date(2026, 9, 14, 12).getTime(), focusedAt: monday },
    totalRange: { start: monday, end: new Date(2026, 9, 19).getTime() },
  });
  await page.evaluate(() => window.__timeline.setViewMode('calendar'));
  await expect(page.locator('#timeline .tracked')).toHaveText('Total: 1h');
  await page.evaluate(() => window.__timeline.shiftCalendar(-1));
  await expect(page.locator('#timeline .tracked')).toHaveText('Total: 2h');
});

test('Calendar opens at the busiest start-time group rather than a lone overnight entry', async ({ page }) => {
  await page.clock.setFixedTime(new Date(2026, 9, 14, 18));
  const day = new Date(2026, 9, 14).getTime();
  const items = [2, 10, 11, 12].map((hour, index) => ({
    id: `entry:${index}`, url: `https://example.com/${index}`, title: `Task ${index}`,
    startedAt: day + hour * HOUR, endedAt: day + (hour + 1) * HOUR, rowId: 'one', isEditable: true,
  }));
  await mount(page, { weeklyCalendar: true, items, rows: [{ id: 'one', title: 'One' }] });
  const position = await page.evaluate(() => {
    window.__timeline.setViewMode('calendar');
    const root = document.querySelector('#timeline').shadowRoot;
    const viewport = root.querySelector('.calendar-viewport');
    const main = root.querySelector('.calendar-task[data-task-key="entry:1"]');
    return { scrollTop: viewport.scrollTop, mainTop: main.getBoundingClientRect().top - viewport.getBoundingClientRect().top,
      headerHeight: window.__timeline.__timeline._calendarMetrics.headerHeight };
  });
  expect(position.scrollTop).toBeGreaterThan(0);
  expect(position.mainTop).toBeGreaterThan(position.headerHeight);
  expect(position.mainTop).toBeLessThan(180);
});

test('Calendar skips a lone early entry near the main work block', async ({ page }) => {
  await page.clock.setFixedTime(new Date(2026, 9, 14, 18));
  const day = new Date(2026, 9, 14).getTime();
  await mount(page, { weeklyCalendar: true, items: [7, 10, 11, 12, 13].map((hour, index) => ({
    id: `entry:${index}`, url: `https://example.com/${index}`, title: `Task ${index}`,
    startedAt: day + hour * HOUR, endedAt: day + (hour + 0.5) * HOUR, rowId: 'one',
  })) });
  const position = await page.evaluate(() => {
    window.__timeline.setViewMode('calendar');
    const root = document.querySelector('#timeline').shadowRoot;
    const viewport = root.querySelector('.calendar-viewport');
    const main = root.querySelector('.calendar-task[data-task-key="entry:1"]');
    return { top: main.getBoundingClientRect().top - viewport.getBoundingClientRect().top,
      headerHeight: window.__timeline.__timeline._calendarMetrics.headerHeight };
  });
  expect(position.top).toBeGreaterThan(position.headerHeight);
  expect(position.top).toBeLessThan(180);
});

test('Calendar favors a dominant group spread across the day over two overnight records', async ({ page }) => {
  await page.clock.setFixedTime(new Date(2026, 9, 14, 18));
  const day = new Date(2026, 9, 12).getTime();
  const hours = [1, 2, 9, 12, 15, 18, 21];
  await mount(page, { weeklyCalendar: true, items: hours.map((hour, index) => ({
    id: `entry:${index}`, url: `https://example.com/${index}`, title: `Entry ${index}`,
    startedAt: day + hour * HOUR, endedAt: day + (hour + 1) * HOUR, rowId: 'one',
  })) });
  const position = await page.evaluate(() => {
    window.__timeline.setViewMode('calendar');
    return document.querySelector('#timeline').shadowRoot.querySelector('.calendar-viewport').scrollTop;
  });
  expect(position).toBeGreaterThan(300);
});

test('Calendar keeps a workday together despite multi-hour pauses within the dominant distribution', async ({ page }) => {
  await page.clock.setFixedTime(new Date(2026, 9, 14, 18));
  const monday = new Date(2026, 8, 28).getTime();
  const starts = [10, 10.75, 15.5, 16.5, 21.2, 11.1, 18.9, 10.9, 10, 10.96,
    14.85, 18.75, 19.18, 19.98, 20.01, 20.43, 20.78, 20.8];
  await mount(page, { weeklyCalendar: true, items: starts.map((hour, index) => ({
    id: `work:${index}`, url: `https://example.com/work/${index}`, title: `Work ${index}`,
    startedAt: monday + index % 5 * 24 * HOUR + hour * HOUR,
    endedAt: monday + index % 5 * 24 * HOUR + (hour + 0.01) * HOUR, rowId: 'one',
  })), view: { start: monday, end: monday + 7 * 24 * HOUR, focusedAt: monday } });
  const position = await page.evaluate(() => {
    window.__timeline.setViewMode('calendar');
    const root = document.querySelector('#timeline').shadowRoot;
    const viewport = root.querySelector('.calendar-viewport');
    const morning = root.querySelector('.calendar-task[data-task-key="work:0"]');
    return morning.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
  });
  expect(position).toBeGreaterThan(0);
  expect(position).toBeLessThan(180);
});

test('Calendar opens at the first record when there is no group, including before 08:00', async ({ page }) => {
  await page.clock.setFixedTime(new Date(2026, 9, 14, 18));
  const day = new Date(2026, 9, 14).getTime();
  await mount(page, { weeklyCalendar: true, items: [{ id: 'early', url: 'https://example.com/early',
    title: 'Early', startedAt: day + 4 * HOUR, endedAt: day + 5 * HOUR, rowId: 'one' }] });
  const position = await page.evaluate(() => {
    window.__timeline.setViewMode('calendar');
    const root = document.querySelector('#timeline').shadowRoot;
    const viewport = root.querySelector('.calendar-viewport');
    return { top: root.querySelector('.calendar-task[data-task-key="early"]').getBoundingClientRect().top - viewport.getBoundingClientRect().top,
      headerHeight: window.__timeline.__timeline._calendarMetrics.headerHeight };
  });
  expect(position.top).toBeGreaterThan(position.headerHeight);
  expect(position.top).toBeLessThan(180);
});

test('Calendar refocuses when a previously empty week loads, but keeps manual scroll on later updates', async ({ page }) => {
  await page.clock.setFixedTime(new Date(2026, 9, 14, 18));
  const day = new Date(2026, 9, 14).getTime();
  await mount(page, { weeklyCalendar: true, items: [] });
  const positions = await page.evaluate(({ day, hour }) => {
    const calendar = window.__timeline;
    calendar.setViewMode('calendar');
    const viewport = document.querySelector('#timeline').shadowRoot.querySelector('.calendar-viewport');
    const initial = viewport.scrollTop;
    const items = [{ id: 'loaded', url: 'https://example.com/loaded', title: 'Loaded',
      startedAt: day + 15 * hour, endedAt: day + 16 * hour, rowId: 'one' }];
    calendar.update({ items });
    const loaded = viewport.scrollTop;
    viewport.scrollTop = 0;
    calendar.update({ items: [...items] });
    return { initial, loaded, preserved: viewport.scrollTop };
  }, { day, hour: HOUR });
  expect(positions.loaded).toBeGreaterThan(positions.initial);
  expect(positions.preserved).toBe(0);
});

test('Calendar does not override a manual scroll while waiting for week records', async ({ page }) => {
  await page.clock.setFixedTime(new Date(2026, 9, 14, 18));
  const day = new Date(2026, 9, 14).getTime();
  await mount(page, { weeklyCalendar: true, items: [] });
  const position = await page.evaluate(({ day, hour }) => {
    const calendar = window.__timeline;
    calendar.setViewMode('calendar');
    const viewport = document.querySelector('#timeline').shadowRoot.querySelector('.calendar-viewport');
    viewport.scrollTop = 0;
    viewport.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -150 }));
    calendar.update({ items: [{ id: 'loaded', url: 'https://example.com/loaded', title: 'Loaded',
      startedAt: day + 15 * hour, endedAt: day + 16 * hour, rowId: 'one' }] });
    return viewport.scrollTop;
  }, { day, hour: HOUR });
  expect(position).toBe(0);
});

test('Calendar refocuses on every week change, including a week loaded after navigation', async ({ page }) => {
  await page.clock.setFixedTime(new Date(2026, 9, 14, 18));
  const monday = new Date(2026, 9, 12).getTime();
  const previousMonday = new Date(2026, 9, 5).getTime();
  const entry = (id, day, hour) => ({ id, url: `https://example.com/${id}`, title: id,
    startedAt: day + hour * HOUR, endedAt: day + (hour + 1) * HOUR, rowId: 'one' });
  const current = [entry('current', monday, 10)];
  const previous = [entry('previous', previousMonday, 15)];
  await mount(page, { weeklyCalendar: true, items: current });
  const positions = await page.evaluate(({ monday, previousMonday, current, previous }) => {
    const calendar = window.__timeline;
    calendar.setViewMode('calendar');
    const viewport = document.querySelector('#timeline').shadowRoot.querySelector('.calendar-viewport');
    const currentTop = viewport.scrollTop;
    calendar.setCalendarRange({ start: previousMonday, end: monday });
    const emptyTop = viewport.scrollTop;
    calendar.update({ items: [...current, ...previous] });
    const previousTop = viewport.scrollTop;
    calendar.setCalendarRange({ start: monday, end: new Date(2026, 9, 19).getTime() });
    const againTop = viewport.scrollTop;
    return { currentTop, emptyTop, previousTop, againTop };
  }, { monday, previousMonday, current, previous });
  expect(positions.previousTop).toBeGreaterThan(positions.currentTop);
  expect(positions.previousTop).toBeGreaterThan(positions.emptyTop);
  expect(positions.againTop).toBe(positions.currentTop);
});

test('Calendar refocuses after week load even if cached overnight entries were already present', async ({ page }) => {
  await page.clock.setFixedTime(new Date(2026, 9, 14, 18));
  const monday = new Date(2026, 9, 12).getTime();
  const previousMonday = new Date(2026, 9, 5).getTime();
  const entry = (id, day, hour) => ({ id, url: `https://example.com/${id}`, title: id,
    startedAt: day + hour * HOUR, endedAt: day + (hour + 1) * HOUR, rowId: 'one' });
  const cached = [entry('night:a', previousMonday, 0), entry('night:b', previousMonday, 1)];
  const loaded = [entry('day:a', previousMonday, 10), entry('day:b', previousMonday, 11),
    entry('day:c', previousMonday, 12), entry('day:d', previousMonday, 13)];
  await mount(page, { weeklyCalendar: true, items: [entry('current', monday, 10), ...cached] });
  const position = await page.evaluate(({ previousMonday, monday, loaded }) => {
    const calendar = window.__timeline;
    calendar.setViewMode('calendar');
    calendar.setCalendarRange({ start: previousMonday, end: monday });
    const viewport = document.querySelector('#timeline').shadowRoot.querySelector('.calendar-viewport');
    const before = viewport.scrollTop;
    calendar.update({ items: [...window.__items, ...loaded] });
    return { before, after: viewport.scrollTop };
  }, { previousMonday, monday, loaded });
  expect(position.after).toBeGreaterThan(position.before);
});

test('Calendar refocuses early records when a cached partial week is completed', async ({ page }) => {
  await page.clock.setFixedTime(new Date(2026, 9, 14, 18));
  const monday = new Date(2026, 9, 5).getTime();
  const entry = (id, day, hour) => ({ id, url: `https://example.com/${id}`, title: id,
    startedAt: monday + day * 24 * HOUR + hour * HOUR,
    endedAt: monday + day * 24 * HOUR + (hour + 1) * HOUR, rowId: 'one' });
  const cached = [entry('late:one', 3, 18), entry('late:two', 4, 19), entry('late:three', 4, 20)];
  const early = [entry('monday', 0, 9 + 40 / 60), entry('tuesday', 1, 10),
    entry('wednesday:one', 2, 11), entry('wednesday:two', 2, 12)];
  await mount(page, { weeklyCalendar: true, items: [] });
  const position = await page.evaluate(({ monday, cached, early }) => {
    const calendar = window.__timeline;
    calendar.setViewMode('calendar');
    calendar.setCalendarRange({ start: monday, end: monday + 7 * 24 * 60 * 60 * 1000 });
    calendar.update({ items: cached });
    const root = document.querySelector('#timeline').shadowRoot;
    const viewport = root.querySelector('.calendar-viewport');
    const cachedScroll = viewport.scrollTop;
    calendar.update({ items: [...cached, ...early] });
    const mondayCard = root.querySelector('.calendar-task[data-task-key="monday"]');
    return { cachedScroll, finalScroll: viewport.scrollTop, count: root.querySelectorAll('.calendar-task').length,
      top: mondayCard.getBoundingClientRect().top - viewport.getBoundingClientRect().top,
      headerHeight: calendar.__timeline._calendarMetrics.headerHeight,
      height: viewport.clientHeight };
  }, { monday, cached, early });
  expect(position.count).toBe(7);
  expect(position.top).toBeGreaterThan(position.headerHeight);
  expect(position.top).toBeLessThan(position.height);
  const manualTop = await page.evaluate(({ cached, early, earlier }) => {
    const viewport = document.querySelector('#timeline').shadowRoot.querySelector('.calendar-viewport');
    viewport.scrollTop = 0;
    viewport.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -120 }));
    window.__timeline.update({ items: [...cached, ...early, earlier] });
    return viewport.scrollTop;
  }, { cached, early, earlier: entry('earlier', 0, 8) });
  expect(manualTop).toBe(0);
  const dragTop = await page.evaluate(({ monday, cached, early, earlier }) => {
    const viewport = document.querySelector('#timeline').shadowRoot.querySelector('.calendar-viewport');
    window.__timeline.setCalendarRange({ start: monday, end: monday + 7 * 24 * 60 * 60 * 1000 });
    window.__timeline.update({ items: cached });
    viewport.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: viewport.getBoundingClientRect().right - 2 }));
    viewport.scrollTop = 0;
    window.__timeline.update({ items: [...cached, ...early, earlier] });
    return viewport.scrollTop;
  }, { monday, cached, early, earlier: entry('earlier', 0, 8) });
  expect(dragTop).toBe(0);
});

test('Calendar focuses loaded work after its Activity host is reattached', async ({ page }) => {
  await page.clock.setFixedTime(new Date(2026, 9, 14, 18));
  const monday = new Date(2026, 9, 12).getTime();
  await mount(page, { weeklyCalendar: true, items: [] });
  const detached = await page.evaluate(monday => {
    const host = document.querySelector('#timeline');
    const calendar = window.__timeline;
    calendar.setViewMode('calendar');
    calendar.setCalendarRange({ start: monday, end: monday + 7 * 24 * 60 * 60 * 1000 });
    host.remove();
    calendar.update({ items: [{ id: 'work', url: 'https://example.com/work', title: 'Work',
      startedAt: monday + 10 * 60 * 60 * 1000, endedAt: monday + 11 * 60 * 60 * 1000, rowId: 'one' }] });
    const viewport = host.shadowRoot.querySelector('.calendar-viewport');
    const top = viewport.scrollTop;
    document.body.append(host);
    return top;
  }, monday);
  expect(detached).toBe(0);
  await expect.poll(() => page.locator('#timeline .calendar-viewport').evaluate(element => element.scrollTop)).toBeGreaterThan(100);
});

test('Calendar current-day total follows an active timer within the same wall-clock minute', async ({ page }) => {
  const now = new Date(2026, 9, 14, 12, 0, 5);
  const day = new Date(2026, 9, 14).getTime();
  await page.clock.install({ time: now });
  await mount(page, {
    weeklyCalendar: true,
    items: [{ id: 'active:day', url: 'https://example.com/day', title: 'Day', startedAt: now.getTime() - 50_000, endedAt: null, rowId: 'one', isRunning: true }],
    view: { start: day, end: now.getTime(), focusedAt: now.getTime() },
  });
  await page.evaluate(() => window.__timeline.setViewMode('calendar'));
  const total = page.locator(`#timeline .calendar-day-header[data-start="${day}"] .calendar-day-tracked`);
  await expect(total).toHaveText('Tracked: 0m');
  await page.clock.runFor(11_000);
  await expect(total).toHaveText('Tracked: 1m');
});

test('narrow weekly Calendar starts at today with a pinned hour rail', async ({ page }) => {
  for (const [day, date, expectedScroll] of [
    ['Monday', new Date(2026, 9, 12, 12), 0],
    ['Wednesday', new Date(2026, 9, 14, 12), 'positive'],
  ]) {
    await page.clock.setFixedTime(date);
    await mount(page, { weeklyCalendar: true });
    const layout = await page.evaluate(() => {
      document.querySelector('#timeline').style.width = '358px';
      window.__timeline.setViewMode('calendar');
      const root = document.querySelector('#timeline').shadowRoot;
      const viewport = root.querySelector('.calendar-viewport');
      const today = root.querySelector('.calendar-day-header.today');
      const rail = root.querySelector('.calendar-time-label');
      return { left: viewport.getBoundingClientRect().left, right: viewport.getBoundingClientRect().right,
        todayLeft: today.getBoundingClientRect().left, todayRight: today.getBoundingClientRect().right,
        railLeft: rail.getBoundingClientRect().left, scrollLeft: viewport.scrollLeft };
    });
    if (expectedScroll === 0) expect(layout.scrollLeft, day).toBe(0);
    else expect(layout.scrollLeft, day).toBeGreaterThan(0);
    expect(layout.todayLeft, day).toBeGreaterThanOrEqual(layout.left);
    expect(layout.todayRight, day).toBeLessThanOrEqual(layout.right);
    expect(layout.railLeft, day).toBeGreaterThanOrEqual(layout.left);
  }
});

test('weekly Calendar navigates before the loaded timeline domain', async ({ page }) => {
  await mount(page, { weeklyCalendar: true });
  const windows = await page.evaluate(() => {
    const instance = window.__timeline;
    instance.setViewMode('calendar');
    const current = instance.getCalendarRange().start;
    instance.shiftCalendar(-1);
    const previous = instance.getCalendarRange().start;
    instance.shiftCalendar(-1);
    return { current, previous, earlier: instance.getCalendarRange().start };
  });
  const previousWeek = date => { const value = new Date(date); value.setDate(value.getDate() - 7); return value.getTime(); };
  expect(windows.previous).toBe(previousWeek(windows.current));
  expect(windows.earlier).toBe(previousWeek(windows.previous));
});

test('Activity Calendar displays exact selected month and custom ranges, then returns to weekly navigation', async ({ page }) => {
  await mount(page, { weeklyCalendar: true });
  const ranges = await page.evaluate(() => {
    const calendar = window.__timeline;
    calendar.setViewMode('calendar');
    const selected = (year, month, day) => new Date(year, month, day).getTime();
    calendar.setCalendarRange({ start: selected(2026, 9, 1), end: selected(2026, 9, 9) });
    const thisMonth = calendar.getCalendarRange();
    calendar.setCalendarRange({ start: selected(2026, 8, 1), end: selected(2026, 9, 1) });
    const lastMonth = calendar.getCalendarRange();
    calendar.setCalendarRange({ start: selected(2026, 8, 28), end: selected(2026, 9, 7) });
    const custom = calendar.getCalendarRange();
    const headers = document.querySelector('#timeline').shadowRoot.querySelectorAll('.calendar-day-header').length;
    calendar.setCalendarDate(selected(2026, 9, 8));
    return { thisMonth, lastMonth, custom, headers, reset: calendar.getCalendarRange() };
  });
  expect(ranges.thisMonth).toEqual({ start: new Date(2026, 9, 1).getTime(), end: new Date(2026, 9, 9).getTime(), days: 8 });
  expect(ranges.lastMonth).toEqual({ start: new Date(2026, 8, 1).getTime(), end: new Date(2026, 9, 1).getTime(), days: 30 });
  expect(ranges.custom).toEqual({ start: new Date(2026, 8, 28).getTime(), end: new Date(2026, 9, 7).getTime(), days: 9 });
  expect(ranges.headers).toBe(9);
  expect(ranges.reset.days).toBe(7);
  expect(new Date(ranges.reset.start).getDay()).toBe(1);
});

test('Today after a one-day period refetches the expanded week even when its first day is unchanged', async ({ page }) => {
  await mount(page, { weeklyCalendar: true, trackCalendarNavigation: true });
  const result = await page.evaluate(() => {
    const calendar = window.__timeline;
    calendar.setViewMode('calendar');
    const monday = new Date(2026, 9, 5).getTime(), tuesday = new Date(2026, 9, 6).getTime();
    calendar.setCalendarRange({ start: monday, end: tuesday });
    calendar.setCalendarDate(monday);
    return { days: calendar.getCalendarRange().days, calls: window.__calls.filter(call => call[0] === 'navigate') };
  });
  expect(result.days).toBe(7);
  expect(result.calls).toHaveLength(2);
  expect(result.calls[1][2]).toBe(new Date(2026, 9, 12).getTime());
});

test('reconciliation keeps the viewport anchored even when virtual segments are temporarily empty', async ({ page }) => {
  await mount(page);
  const result = await page.evaluate(async () => {
    await new Promise(resolve => requestAnimationFrame(resolve));
    const timeline = window.__timeline.__timeline;
    const viewport = timeline.viewport;
    timeline._setScrollLeft(Math.max(0, timeline.totalWidth - viewport.clientWidth) / 2);
    viewport.dispatchEvent(new Event('scroll'));
    const before = timeline.xToTime(timeline._scrollLeftNow() + viewport.clientWidth / 2);
    timeline.segments = [];
    window.__timeline.update({ items: window.__items, now: Date.now() });
    const after = timeline.xToTime(timeline._scrollLeftNow() + viewport.clientWidth / 2);
    return { before, after, scroll: timeline._scrollLeftNow() };
  });
  expect(Math.abs(result.after - result.before)).toBeLessThan(2 * 60_000);
  expect(result.scroll).toBeGreaterThan(0);
});

test('repeated background reconciliation never resets manually scrolled Timeline to the far left', async ({ page }) => {
  await mount(page);
  const before = await page.evaluate(() => {
    const timeline = window.__timeline.__timeline;
    timeline._setScrollLeft(Math.max(0, timeline.totalWidth - timeline._viewportWidthNow()) * 0.65);
    const scroll = timeline._scrollLeftNow();
    const time = timeline.xToTime(scroll + timeline._viewportWidthNow() / 2);
    return { scroll, time };
  });
  expect(before.scroll).toBeGreaterThan(1);
  for (let attempt = 0; attempt < 8; attempt++) {
    const state = await page.evaluate(() => {
      const timeline = window.__timeline.__timeline;
      window.__timeline.update({ items: window.__items, now: Date.now() });
      return {
        scroll: timeline._scrollLeftNow(),
        time: timeline.xToTime(timeline._scrollLeftNow() + timeline._viewportWidthNow() / 2),
      };
    });
    expect(state.scroll).toBeGreaterThan(1);
    expect(Math.abs(state.time - before.time)).toBeLessThan(120_000);
  }
});

test('Timeline restores remembered viewport after Chromium temporarily clamps scrollLeft to zero', async ({ page }) => {
  await mount(page);
  const before = await page.evaluate(async () => {
    await new Promise(resolve => requestAnimationFrame(resolve));
    const timeline = window.__timeline.__timeline;
    const desired = Math.max(0, timeline.totalWidth - timeline._viewportWidthNow()) * 0.65;
    timeline._setScrollLeft(desired);
    timeline.viewport.dispatchEvent(new Event('scroll'));
    return timeline.xToTime(timeline._scrollLeftNow() + timeline._viewportWidthNow() / 2);
  });
  const after = await page.evaluate(() => {
    const timeline = window.__timeline.__timeline;
    // Simulate Chrome temporarily resetting scroll during a virtual layout pass.
    timeline.viewport.scrollLeft = 0;
    timeline._scrollLeft = 0;
    window.__timeline.update({ items: window.__items, now: Date.now() });
    return {
      scroll: timeline._scrollLeftNow(),
      centeredAt: timeline.xToTime(timeline._scrollLeftNow() + timeline._viewportWidthNow() / 2),
    };
  });
  expect(after.scroll).toBeGreaterThan(0);
  expect(Math.abs(after.centeredAt - before)).toBeLessThan(120_000);
});

test('reconcile preserves selection, mode, pending, and running identity', async ({ page }) => {
  const now = await mount(page);
  await page.evaluate(() => {
    const root = document.querySelector('#timeline').shadowRoot;
    root.querySelector('.task[data-task-key="entry:a"]').click();
    window.__timeline.setViewMode('calendar');
    window.__timeline.update({ items: window.__items, now: Date.now() });
  });
  const state = await page.evaluate(() => window.__timeline.__timeline.getInteractionState());
  expect(state.selectedInstanceId).toBe('entry:a');
  expect(state.runningInstanceId).toBe('active:c');
  expect(state.pendingInstanceIds).toEqual(['entry:b']);
  expect(await page.evaluate(() => window.__timeline.getViewMode())).toBe('calendar');
  expect(now).toBeGreaterThan(0);
});

for (const mode of ['timeline', 'calendar']) {
  const blockSelector = mode === 'calendar' ? '.calendar-task' : '.task';

  test('double-clicking a completed entry in ' + mode + ' only selects it', async ({ page }) => {
    await mount(page, { weeklyCalendar: true });
    if (mode === 'calendar') await page.evaluate(() => window.__timeline.setViewMode('calendar'));
    const block = page.locator('#timeline ' + blockSelector + '[data-task-key="entry:a"]').first();
    await block.dblclick();
    const state = await page.evaluate(() => ({
      interaction: window.__timeline.__timeline.getInteractionState(),
      calls: window.__calls,
    }));
    expect(state.interaction.selectedInstanceId).toBe('entry:a');
    expect(state.interaction.runningInstanceId).toBe('active:c');
    expect(state.calls).toEqual([]);
    const action = page.locator('#timeline .clockoli-timeline-action.primary');
    await expect(action).toHaveText('Track time');
    await action.click();
    await expect.poll(() => page.evaluate(() => window.__calls)).toEqual([['start', 'entry:a']]);
  });

  test('double-clicking the running entry in ' + mode + ' does not stop it', async ({ page }) => {
    await mount(page, { weeklyCalendar: true });
    if (mode === 'calendar') await page.evaluate(() => window.__timeline.setViewMode('calendar'));
    const block = page.locator('#timeline ' + blockSelector + '[data-task-key="active:c"]').first();
    await block.dblclick();
    const state = await page.evaluate(() => ({
      interaction: window.__timeline.__timeline.getInteractionState(),
      calls: window.__calls,
    }));
    expect(state.interaction.selectedInstanceId).toBe('active:c');
    expect(state.interaction.runningInstanceId).toBe('active:c');
    expect(state.calls).toEqual([]);
    const action = page.locator('#timeline .clockoli-timeline-action.primary');
    await expect(action).toHaveText('Stop and save');
    await action.click();
    await expect.poll(() => page.evaluate(() => window.__calls)).toEqual([['stop', 'active:c']]);
  });

  test('Track time stays on one line below the full-width description in ' + mode, async ({ page }) => {
    await mount(page, { weeklyCalendar: true });
    await page.evaluate(() => {
      window.__items[0].description = 'Existing note';
      window.__timeline.update({ items: window.__items });
    });
    if (mode === 'calendar') await page.evaluate(() => window.__timeline.setViewMode('calendar'));
    await page.locator('#timeline ' + blockSelector + '[data-task-key="entry:a"]').first().click();

    const action = page.locator('#timeline .clockoli-timeline-action.primary');
    await expect(action).toHaveText('Track time');
    await expect(action).toHaveCSS('white-space', 'nowrap');

    for (const width of [1600, 420]) {
      await page.setViewportSize({ width, height: 900 });
      // The fixture's 1000px inline width is fixed unless updated explicitly.
      await page.locator('#timeline').evaluate((host, width) => { host.style.width = `${width - 16}px`; }, width);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.locator('#timeline ' + blockSelector + '[data-task-key="entry:a"]').first().hover();
      await expect(action).toBeVisible();
      const bounds = await action.evaluate(button => {
        const actions = button.closest('.clockoli-timeline-actions');
        const details = actions.closest('.details');
        const input = actions.querySelector('.clockoli-timeline-description').getBoundingClientRect();
        const field = actions.querySelector('.clockoli-description-field').getBoundingClientRect();
        const deletion = actions.querySelector('.clockoli-timeline-action.danger').getBoundingClientRect();
        const group = actions.getBoundingClientRect();
        const container = details.getBoundingClientRect();
        const primary = button.getBoundingClientRect();
        return {
          inputWidth: input.width,
          fieldWidth: field.width,
          fieldBottom: field.bottom,
          deleteTop: deletion.top,
          freeRight: container.right - parseFloat(getComputedStyle(details).paddingRight) - group.right,
          primaryHeight: primary.height,
          primaryScrollWidth: button.scrollWidth,
          primaryClientWidth: button.clientWidth,
          belowDescription: primary.top >= field.bottom - 1,
        };
      });
      expect(Math.abs(bounds.freeRight), JSON.stringify({ width, bounds })).toBeLessThanOrEqual(2);
      expect(Math.abs(bounds.fieldWidth - bounds.inputWidth)).toBeLessThanOrEqual(2);
      expect(bounds.deleteTop).toBeGreaterThanOrEqual(bounds.fieldBottom - 1);
      expect(bounds.primaryScrollWidth).toBeLessThanOrEqual(bounds.primaryClientWidth);
      expect(bounds.primaryHeight).toBeLessThan(40);
      expect(bounds.belowDescription).toBe(true);
      expect(bounds.fieldWidth).toBeGreaterThan(300);
    }
  });

  test('Track time keeps its background on hover in ' + mode, async ({ page }) => {
    await mount(page, { weeklyCalendar: true });
    if (mode === 'calendar') await page.evaluate(() => window.__timeline.setViewMode('calendar'));
    const block = page.locator('#timeline ' + blockSelector + '[data-task-key="entry:a"]').first();
    await block.dblclick();

    const action = page.locator('#timeline .clockoli-timeline-action.primary');
    await expect(action).toHaveText('Track time');
    const restingBackground = await action.evaluate(button => getComputedStyle(button).backgroundColor);
    await action.hover();
    await expect(action).toHaveCSS('background-color', restingBackground);
  });

}

test('Timeline drags and arrow edits snap to five minutes at every zoom level', async ({ page }) => {
  await mount(page);
  const grid = await page.evaluate(() => {
    const timeline = window.__timeline.__timeline;
    const midnight = new Date(2026, 9, 13, 0, 0, 0).getTime();
    const minute = 60_000;
    const samples = () => [7, 8, 12, 13].map(value =>
      (timeline._magnetizeTime(midnight + value * minute, midnight, midnight + 60 * minute, null) - midnight) / minute);
    const normal = { step: timeline._magnetStepMs(), snapped: samples() };
    timeline.setVisibleDays(1 / 24);
    const zoomedIn = { step: timeline._magnetStepMs(), snapped: samples() };
    timeline.setVisibleDays(7);
    const zoomedOut = { step: timeline._magnetStepMs(), snapped: samples() };
    return { normal, zoomedIn, zoomedOut };
  });
  for (const view of Object.values(grid)) {
    expect(view.step).toBe(5 * 60_000);
    expect(view.snapped).toEqual([5, 10, 10, 15]);
  }

  const block = page.locator('#timeline .task[data-task-key="entry:a"]');
  await block.click();
  await page.keyboard.press('ArrowLeft');
  const afterFirst = await page.evaluate(() => window.__timeline.__timeline._findTask('entry:a').start);
  await page.keyboard.press('ArrowLeft');
  const afterSecond = await page.evaluate(() => window.__timeline.__timeline._findTask('entry:a').start);
  expect(afterFirst - afterSecond).toBe(5 * 60_000);

  await page.keyboard.press('Alt+ArrowLeft');
  const afterStartResize = await page.evaluate(() => window.__timeline.__timeline._findTask('entry:a').start);
  expect(afterSecond - afterStartResize).toBe(5 * 60_000);
});

test('dragging a Timeline start edge advances on the five-minute grid', async ({ page }) => {
  await mount(page);
  const result = await page.evaluate(() => {
    const timeline = window.__timeline.__timeline;
    timeline.setVisibleDays(1 / 24);
    const task = timeline._findTask('entry:a');
    const viewport = timeline.viewport.getBoundingClientRect();
    const clientY = viewport.top + 30;
    const clientX = viewport.left + timeline.timeToX(task.start) - timeline._scrollLeftNow();
    const pointerId = 451;
    timeline._beginTaskEdit({ button: 0, pointerId, clientX, clientY, stopPropagation() {} }, task, 'resize-left');
    const state = timeline.editState;
    const dragEarlier = minutes => {
      const contentX = timeline._timeToXFromSnapshot(
        state.pointerTime - minutes * 60_000, state.snapshot, state.snapshotWidth);
      const x = viewport.left + contentX - timeline._scrollLeftNow();
      timeline._onWindowPointerMove({ pointerId, clientX: x, clientY, preventDefault() {} });
      return timeline._findTask('entry:a').start;
    };
    const first = dragEarlier(8);
    const second = dragEarlier(13);
    const wasDragging = state.didMutate;
    timeline._onWindowPointerUp({ pointerId });
    return { first, second, wasDragging, completed: !timeline.editState };
  });
  expect(result.wasDragging).toBe(true);
  expect(result.completed).toBe(true);
  expect(new Date(result.first).getMinutes() % 5).toBe(0);
  expect(new Date(result.first).getSeconds()).toBe(0);
  expect(new Date(result.second).getMinutes() % 5).toBe(0);
  expect(result.first - result.second).toBe(5 * 60_000);
});

test('Calendar keeps one-minute edit precision when Timeline changes to five minutes', async ({ page }) => {
  await mount(page);
  const steps = await page.evaluate(() => {
    const timeline = window.__timeline.__timeline;
    window.__timeline.setViewMode('calendar');
    return { calendar: timeline._calendarMagnetStepMs(Date.now()), timeline: timeline._magnetStepMs() };
  });
  expect(steps).toEqual({ calendar: 60_000, timeline: 5 * 60_000 });
});

test('keyboard edit keeps the Clockoli instance ID and locally pending deletion works', async ({ page }) => {
  await mount(page);
  await page.evaluate(() => document.querySelector('#timeline').shadowRoot.querySelector('.task[data-task-key="entry:a"]').click());
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => page.evaluate(() => window.__calls)).toEqual([['edit', 'entry:a', 'move']]);
  expect(await page.evaluate(() => window.__timeline.__timeline.getRunningTask()?.instanceId)).toBe('active:c');

  await page.evaluate(() => document.querySelector('#timeline').shadowRoot.querySelector('.task[data-task-key="entry:b"]').click());
  await page.keyboard.press('Delete');
  await expect.poll(() => page.evaluate(() => window.__calls)).toEqual([['edit', 'entry:a', 'move'], ['delete', 'entry:b']]);
});

test('active start resize edits without dispatching Stop and stays running', async ({ page }) => {
  await mount(page);
  await page.evaluate(() => document.querySelector('#timeline').shadowRoot.querySelector('.task[data-task-key="active:c"]').click());
  await page.keyboard.press('Alt+ArrowLeft');
  await expect.poll(() => page.evaluate(() => window.__calls)).toEqual([['edit', 'active:c', 'resize-left']]);
  await expect.poll(() => page.evaluate(() => window.__timeline.__timeline.getRunningTask()?.instanceId)).toBe('active:c');
});

test('Timeline resize bars appear on hover and remain visible after selecting an entry', async ({ page }) => {
  await mount(page);
  const block = page.locator('#timeline .task[data-task-key="entry:a"]');
  const borders = () => block.evaluate(element => {
    const style = getComputedStyle(element);
    return { leftWidth: style.borderLeftWidth, leftColor: style.borderLeftColor };
  });
  const bars = () => block.evaluate(element => [...element.querySelectorAll('.resize-handle')].map(handle => ({
    opacity: Number(getComputedStyle(handle, '::after').opacity),
    cursor: getComputedStyle(handle).cursor,
    fill: getComputedStyle(handle, '::after').backgroundColor,
    marks: getComputedStyle(handle, '::after').backgroundImage,
  })));
  await page.mouse.move(0, 0);
  expect(await page.evaluate(() => {
    const element = document.querySelector('#timeline').shadowRoot.querySelector('.task[data-task-key="entry:a"]');
    return {
      shadow: getComputedStyle(element).boxShadow,
      padding: getComputedStyle(element.querySelector('.task-main')).paddingLeft,
    };
  })).toEqual({ shadow: 'none', padding: '9px' });
  expect((await bars()).map(bar => bar.opacity)).toEqual([0, 0]);
  let idleBorders;
  await expect.poll(async () => {
    const current = await borders();
    if (current.leftWidth === '3px' && current.leftColor) idleBorders = current;
    return Boolean(idleBorders);
  }).toBe(true);
  await block.hover();
  await expect.poll(async () => (await bars()).map(bar => bar.opacity)).toEqual([1, 1]);
  const accent = await block.evaluate(element => {
    const sample = document.createElement('span');
    sample.style.backgroundColor = 'color-mix(in srgb, var(--clockoli-task-background) 78%, black)';
    element.append(sample);
    const color = getComputedStyle(sample).backgroundColor;
    sample.remove();
    return color;
  });
  expect((await bars()).map(bar => bar.fill)).toEqual([accent, accent]);
  expect((await bars())[0].fill).toBe((await bars())[1].fill);
  expect((await bars()).every(bar => bar.marks.includes('linear-gradient'))).toBe(true);
  expect((await bars())[0].marks).toBe((await bars())[1].marks);
  expect(await borders()).toEqual(idleBorders);
  await block.click();
  await page.mouse.move(0, 0);
  await expect.poll(async () => (await bars()).map(bar => bar.opacity)).toEqual([1, 1]);
  expect((await bars()).map(bar => bar.fill)).toEqual([accent, accent]);
  expect((await bars())[0].fill).toBe((await bars())[1].fill);
  expect(await borders()).toEqual(idleBorders);
  expect((await bars()).map(bar => bar.cursor)).toEqual(['ew-resize', 'ew-resize']);
});

test('Timeline hover and selection reveal controls without moving or restyling the entry', async ({ page }) => {
  await mount(page);
  const block = page.locator('#timeline .task[data-task-key="entry:a"]');
  await page.mouse.move(0, 0);
  const appearance = () => block.evaluate(element => {
    // Reconcile once while the locator still holds the old node: a real timer
    // update can replace the task between resolution and computed-style reads.
    if (!window.__appearanceReconciled) {
      window.__appearanceReconciled = true;
      window.__timeline.update({ items: window.__items, now: Date.now() });
    }
    const style = getComputedStyle(element);
    const label = element.querySelector('.task-name').getBoundingClientRect();
    return {
      connected: element.isConnected,
      labelX: label.x - element.getBoundingClientRect().x,
      labelWidth: label.width,
      padding: getComputedStyle(element.querySelector('.task-main')).paddingLeft,
      shadow: style.boxShadow,
      background: style.backgroundColor,
      borders: [style.borderTopColor, style.borderRightColor, style.borderBottomColor, style.borderLeftColor],
    };
  });
  let idle;
  await expect.poll(async () => {
    const current = await appearance();
    if (current.connected && current.labelWidth > 0 && current.padding && current.shadow
      && current.background && current.borders.every(Boolean)) idle = current;
    return Boolean(idle);
  }).toBe(true);
  await block.hover();
  await expect.poll(() => block.evaluate(element => [...element.querySelectorAll('.resize-handle')]
    .map(handle => getComputedStyle(handle, '::after').opacity))).toEqual(['1', '1']);
  expect(await appearance()).toEqual(idle);
  await block.click();
  await page.mouse.move(0, 0);
  expect(await appearance()).toEqual(idle);
});

test('Calendar resize bars stay visible on selection after the pointer leaves', async ({ page }) => {
  // Keep entry:a within one local day; near midnight it spans two segments.
  await page.clock.setFixedTime(new Date(2026, 9, 15, 12));
  await mount(page);
  await page.evaluate(() => window.__timeline.setViewMode('calendar'));
  const block = page.locator('#timeline .calendar-task[data-task-key="entry:a"]').first();
  const opacities = () => block.evaluate(element => [...element.querySelectorAll('.calendar-resize-handle')]
    .map(handle => Number(getComputedStyle(handle, '::after').opacity)));
  // Resolve and measure in one evaluate: the host ResizeObserver re-renders the
  // calendar after the view switch and can replace the block between a locator
  // lookup and its evaluate, which reads a detached node as empty styles.
  const idle = () => page.evaluate(() => {
    const element = document.querySelector('#timeline').shadowRoot.querySelector('.calendar-task[data-task-key="entry:a"]');
    return {
      opacities: [...element.querySelectorAll('.calendar-resize-handle')].map(handle => Number(getComputedStyle(handle, '::after').opacity)),
      boxShadow: getComputedStyle(element).boxShadow,
    };
  });
  await page.mouse.move(0, 0);
  expect(await idle()).toEqual({ opacities: [0, 0], boxShadow: 'none' });
  await block.hover();
  await expect.poll(opacities).toEqual([1, 1]);
  await block.click();
  await expect(block).toHaveClass(/selected/);
  await page.mouse.move(0, 0);
  await expect(block).toHaveClass(/selected/);
  await expect.poll(opacities).toEqual([1, 1]);
});

test('Timeline shows darker end grips without top or bottom bands', async ({ page }) => {
  await mount(page);
  const block = page.locator('#timeline .task[data-task-key="entry:a"]');
  await page.mouse.move(0, 0);
  let idleBorders;
  await expect.poll(async () => {
    const borders = await block.evaluate(element => {
      if (!window.__gripBaselineRerendered) {
        window.__gripBaselineRerendered = true;
        window.__timeline.update({ items: window.__items });
      }
      if (!element.isConnected) return null;
      const style = getComputedStyle(element);
      return [style.borderTopColor, style.borderRightColor, style.borderBottomColor, style.borderLeftColor];
    });
    if (borders?.every(Boolean)) idleBorders = borders;
    return Boolean(idleBorders);
  }).toBe(true);
  await block.hover();
  await expect.poll(() => block.evaluate(element => [...element.querySelectorAll('.resize-handle')]
    .map(handle => handle.getBoundingClientRect().width))).toEqual([14, 14]);
  await expect.poll(() => block.evaluate(element => [...element.querySelectorAll('.resize-handle')]
    .map(handle => getComputedStyle(handle, '::after').opacity))).toEqual(['1', '1']);
  const grips = await block.evaluate(element => [...element.querySelectorAll('.resize-handle')].map(handle => {
    const grip = getComputedStyle(handle, '::after');
    const entry = element.getBoundingClientRect();
    const taskStyle = getComputedStyle(element);
    return { targetWidth: handle.getBoundingClientRect().width, width: parseFloat(grip.width), height: parseFloat(grip.height), top: grip.top, bottom: grip.bottom, radius: grip.borderRadius, background: grip.backgroundColor, marks: grip.backgroundImage, markSize: grip.backgroundSize, frame: taskStyle.boxShadow, topBorder: taskStyle.borderTopColor, bottomBorder: taskStyle.borderBottomColor, leftBorder: taskStyle.borderLeftColor, rightBorder: taskStyle.borderRightColor, padding: getComputedStyle(element.querySelector('.task-main')).paddingLeft, entryHeight: entry.height, opacity: grip.opacity };
  }));
  const expected = await block.evaluate(element => {
    const sample = document.createElement('span');
    sample.style.backgroundColor = 'color-mix(in srgb, var(--clockoli-task-background) 78%, black)';
    element.append(sample);
    const color = getComputedStyle(sample).backgroundColor;
    sample.remove();
    return color;
  });
  expect(grips).toHaveLength(2);
  for (const grip of grips) {
    expect(grip.targetWidth).toBeGreaterThanOrEqual(12);
    expect(grip.width).toBeGreaterThanOrEqual(9);
    expect(grip.height).toBeGreaterThanOrEqual(grip.entryHeight - 2);
    expect(grip.top).toBe('0px');
    expect(grip.bottom).toBe('0px');
    expect(grip.background).toBe(expected);
    expect(grip.marks).toContain('linear-gradient');
    expect(grip.marks).toContain('rgb(0, 0, 0)');
    expect(grip.markSize).toBe('2px 16px, 2px 16px');
    expect(grip.frame).not.toContain('inset');
    expect([grip.topBorder, grip.rightBorder, grip.bottomBorder, grip.leftBorder]).toEqual(idleBorders);
    expect(grip.padding).toBe('9px');
    expect(grip.opacity).toBe('1');
  }
  expect(grips[0].marks).toBe(grips[1].marks);
  expect(grips[0].background).toBe(grips[1].background);
  expect(grips.map(grip => grip.radius)).toEqual(['4px 0px 0px 4px', '0px 4px 4px 0px']);
  await block.click();
  await page.mouse.move(0, 0);
  const selectedStyle = await block.evaluate(element => {
    const style = getComputedStyle(element);
    return { shadow: style.boxShadow, top: style.borderTopColor, bottom: style.borderBottomColor };
  });
  expect(selectedStyle).toEqual({ shadow: 'none', top: idleBorders[0], bottom: idleBorders[2] });
  const other = page.locator('#timeline .task[data-task-key="entry:b"]');
  await other.hover();
  const colors = await Promise.all([block, other].map(item => item.evaluate(element => ({
    background: getComputedStyle(element).backgroundColor,
    accent: getComputedStyle(element.querySelector('.resize-handle'), '::after').backgroundColor,
  }))));
  expect(colors[0].background).not.toBe(colors[1].background);
  expect(colors[0].accent).not.toBe(colors[1].accent);
  for (const { background, accent } of colors) {
    const rgb = color => color.match(/[\d.]+/g).slice(0, 3).map(Number);
    expect(rgb(accent).every((channel, index) => channel < rgb(background)[index])).toBe(true);
  }
  await block.hover();
  for (const edge of ['left', 'right']) {
    await block.evaluate((element, side) => {
      element.classList.add('editing', `resize-${side}`);
    }, edge);
    const active = await block.evaluate(element => [...element.querySelectorAll('.resize-handle')]
      .map(handle => {
        const style = getComputedStyle(handle, '::after');
        return { fill: style.backgroundColor, marks: style.backgroundImage, height: style.height };
      }));
    expect(active.map(handle => handle.fill)).toEqual([grips[0].background, grips[1].background]);
    expect(active.map(handle => handle.marks)).toEqual([grips[0].marks, grips[1].marks]);
    expect(active.map(handle => handle.height)).toEqual([`${grips[0].height}px`, `${grips[1].height}px`]);
    await block.evaluate((element, side) => element.classList.remove('editing', `resize-${side}`), edge);
  }
});

test('Calendar edges show full-width colored grips with paired grip marks', async ({ page }) => {
  // Keep entry:a within one local day; near midnight it spans two segments.
  await page.clock.setFixedTime(new Date(2026, 9, 15, 12));
  await mount(page);
  await page.evaluate(() => window.__timeline.setViewMode('calendar'));
  const block = page.locator('#timeline .calendar-task[data-task-key="entry:a"]').first();
  await block.hover();
  await expect.poll(() => block.evaluate(element => [...element.querySelectorAll('.calendar-resize-handle')]
    .map(handle => getComputedStyle(handle, '::after').opacity))).toEqual(['1', '1']);
  const grips = await block.evaluate(element => [...element.querySelectorAll('.calendar-resize-handle')].map(handle => {
    const target = getComputedStyle(handle);
    const grip = getComputedStyle(handle, '::after');
    const expected = document.createElement('span');
    expected.style.backgroundColor = 'color-mix(in srgb, var(--clockoli-task-color) 70%, var(--tt-panel))';
    element.append(expected);
    const color = getComputedStyle(expected).backgroundColor;
    expected.remove();
    return { targetHeight: parseFloat(target.height), entryWidth: element.clientWidth, width: parseFloat(grip.width), height: parseFloat(grip.height), radius: grip.borderRadius, background: grip.backgroundColor, color, marks: grip.backgroundImage, markSize: grip.backgroundSize, transform: grip.transform, opacity: grip.opacity };
  }));
  expect(grips).toHaveLength(2);
  for (const grip of grips) {
    expect(grip.targetHeight).toBeGreaterThanOrEqual(2);
    expect(grip.width).toBeGreaterThanOrEqual(grip.entryWidth - 2);
    expect(grip.height).toBeGreaterThanOrEqual(6);
    expect(grip.background).toBe(grip.color);
    expect(grip.marks).toContain('linear-gradient');
    expect(grip.markSize).toBe('16px 1px, 16px 1px');
    expect(grip.transform).toBe('none');
    expect(grip.opacity).toBe('1');
  }
  expect(grips.map(grip => grip.radius)).toEqual(['6px 6px 0px 0px', '0px 0px 6px 6px']);
});

test('background updates cannot cancel a Timeline resize while pointer is held', async ({ page }) => {
  await mount(page);
  const start = await page.evaluate(() => {
    const timeline = window.__timeline.__timeline;
    const task = timeline._findTask('entry:a');
    timeline._beginTaskEdit({ button: 0, pointerId: 451, clientX: 250, clientY: 100, stopPropagation() {} }, task, 'resize-right');
    timeline._onWindowPointerMove({ pointerId: 451, clientX: 268, clientY: 100, preventDefault() {} });
    return { state: timeline.editState, end: task.end };
  });
  expect(start.state).toBeTruthy();
  await page.evaluate(() => window.__timeline.update({ items: window.__items, now: Date.now() }));
  const inProgress = await page.evaluate(() => ({
    state: Boolean(window.__timeline.__timeline.editState),
    end: window.__timeline.__timeline._findTask('entry:a').end,
  }));
  expect(inProgress.state).toBe(true);
  expect(inProgress.end).toBe(start.end);
  await page.evaluate(() => window.__timeline.__timeline._onWindowPointerUp({ pointerId: 451 }));
  await expect.poll(() => page.evaluate(() => Boolean(window.__timeline.__timeline.editState))).toBe(false);
});

test('pending edits remain editable without saving indicators', async ({ page }) => {
  await mount(page, { persistPending: true });
  const block = page.locator('#timeline .task[data-task-key="entry:a"]');
  await block.click();
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => page.evaluate(() => window.__timeline.__timeline.getInteractionState().pendingInstanceIds)).toContain('entry:a');
  await expect(block.locator('.clockoli-entry-saving')).toHaveCount(0);
  await expect(block).not.toHaveAttribute('aria-busy', 'true');
  await block.click();
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => page.evaluate(() => window.__calls.filter(call => call[0] === 'edit'))).toHaveLength(2);
});

test('late rejected edit preserves newer edits without a saving overlay', async ({ page }) => {
  await mount(page, { deferEdit: true });
  const block = page.locator('#timeline .task[data-task-key="entry:a"]');
  await block.click();
  await page.evaluate(() => window.__timeline.__timeline._keyboardEditSelected('move', -600_000));
  await page.evaluate(() => window.__timeline.__timeline._keyboardEditSelected('move', -300_000));
  await expect.poll(() => page.evaluate(() => window.__editSettlers.length)).toBe(2);
  const newestStart = await page.evaluate(() => window.__timeline.__timeline._findTask('entry:a').start);
  await page.evaluate(() => window.__editSettlers[0].reject(new Error('older save failed')));
  await expect.poll(() => page.evaluate(() => window.__calls.some(call => call[0] === 'error'))).toBeTruthy();
  expect(await page.evaluate(() => window.__timeline.__timeline._findTask('entry:a').start)).toBe(newestStart);
  await expect(block.locator('.clockoli-entry-saving')).toHaveCount(0);
  await page.evaluate(() => window.__editSettlers[1].resolve(true));
});

test('rejected edits restore the prior interval without leaving a false undo entry', async ({ page }) => {
  await mount(page, { deferEdit: true });
  const block = page.locator('#timeline .task[data-task-key="entry:a"]');
  await block.click();
  const original = await page.evaluate(() => window.__timeline.__timeline._findTask('entry:a').start);
  await page.evaluate(() => window.__timeline.__timeline._keyboardEditSelected('move', -300_000));
  await expect.poll(() => page.evaluate(() => window.__editSettlers.length)).toBe(1);
  await page.evaluate(() => window.__editSettlers.shift().resolve(false));
  await expect.poll(() => page.evaluate(() => window.__timeline.__timeline._findTask('entry:a').start)).toBe(original);
  expect(await page.evaluate(() => window.__timeline.__timeline.canUndo())).toBe(false);
  await page.evaluate(() => window.__timeline.__timeline._keyboardEditSelected('move', -300_000));
  await expect.poll(() => page.evaluate(() => window.__editSettlers.length)).toBe(1);
  await page.evaluate(() => window.__editSettlers.shift().reject(new Error('save failed')));
  await expect.poll(() => page.evaluate(() => window.__timeline.__timeline._findTask('entry:a').start)).toBe(original);
  expect(await page.evaluate(() => window.__timeline.__timeline.canUndo())).toBe(false);
});

test('consecutive rejected edits restore the last accepted interval', async ({ page }) => {
  await mount(page, { deferEdit: true });
  await page.locator('#timeline .task[data-task-key="entry:a"]').click();
  const original = await page.evaluate(() => window.__timeline.__timeline._findTask('entry:a').start);
  await page.evaluate(() => window.__timeline.__timeline._keyboardEditSelected('move', -600_000));
  await page.evaluate(() => window.__timeline.__timeline._keyboardEditSelected('move', -300_000));
  await expect.poll(() => page.evaluate(() => window.__editSettlers.length)).toBe(2);
  await page.evaluate(() => window.__editSettlers[0].reject(new Error('first failed')));
  await page.evaluate(() => window.__editSettlers[1].resolve(false));
  await expect.poll(() => page.evaluate(() => window.__timeline.__timeline._findTask('entry:a').start)).toBe(original);
  expect(await page.evaluate(() => window.__timeline.__timeline.canUndo())).toBe(false);
});

test('undo after a late rejected edit does not resurrect the failed interval', async ({ page }) => {
  const now = Date.now();
  await mount(page, { deferEdit: true, items: [
    { id: 'entry:a', url: 'https://example.com/a', title: 'Task A', startedAt: now - 3 * HOUR, endedAt: now - 2 * HOUR, rowId: 'one', isEditable: true },
  ] });
  await page.locator('#timeline .task[data-task-key="entry:a"]').click();
  const original = await page.evaluate(() => window.__timeline.__timeline._findTask('entry:a').start);
  await page.evaluate(() => window.__timeline.__timeline._keyboardEditSelected('move', -600_000));
  await page.evaluate(() => window.__timeline.__timeline._keyboardEditSelected('move', -300_000));
  await expect.poll(() => page.evaluate(() => window.__editSettlers.length)).toBe(2);
  await page.evaluate(() => window.__editSettlers[1].resolve(true));
  await page.evaluate(() => window.__editSettlers[0].reject(new Error('first failed')));
  await expect.poll(() => page.evaluate(() => window.__timeline.__timeline.getInteractionState().pendingInstanceIds.includes('entry:a'))).toBe(false);
  await page.evaluate(() => window.__timeline.__timeline.undo());
  await expect.poll(() => page.evaluate(() => window.__timeline.__timeline._findTask('entry:a').start)).toBe(original);
});

test('rejected undo restores the accepted interval and preserves undo history', async ({ page }) => {
  const now = Date.now();
  await mount(page, { deferEdit: true, items: [
    { id: 'entry:a', url: 'https://example.com/a', title: 'Task A', startedAt: now - 3 * HOUR, endedAt: now - 2 * HOUR, rowId: 'one', isEditable: true },
  ] });
  const timeline = () => page.evaluate(() => {
    const instance = window.__timeline.__timeline;
    return { start: instance._findTask('entry:a').start, undo: instance.canUndo(), redo: instance.canRedo() };
  });
  const original = (await timeline()).start;
  await page.locator('#timeline .task[data-task-key="entry:a"]').click();
  await page.evaluate(() => window.__timeline.__timeline._keyboardEditSelected('move', -300_000));
  await expect.poll(() => page.evaluate(() => window.__editSettlers.length)).toBe(1);
  await page.evaluate(() => window.__editSettlers.shift().resolve(true));
  await expect.poll(() => timeline()).toMatchObject({ undo: true, redo: false });
  const accepted = (await timeline()).start;
  expect(accepted).not.toBe(original);
  await page.evaluate(() => window.__timeline.__timeline.undo());
  await expect.poll(() => page.evaluate(() => window.__editSettlers.length)).toBe(1);
  await page.evaluate(() => window.__editSettlers.shift().reject(new Error('undo save failed')));
  await expect.poll(() => timeline()).toEqual({ start: accepted, undo: true, redo: false });
  await page.evaluate(() => window.__timeline.__timeline.undo());
  await expect.poll(() => page.evaluate(() => window.__editSettlers.length)).toBe(1);
  await page.evaluate(() => window.__editSettlers.shift().resolve(true));
  await expect.poll(() => timeline()).toEqual({ start: original, undo: false, redo: true });
});

test('rejected redo restores the undone interval and preserves redo history', async ({ page }) => {
  const now = Date.now();
  await mount(page, { deferEdit: true, items: [
    { id: 'entry:a', url: 'https://example.com/a', title: 'Task A', startedAt: now - 3 * HOUR, endedAt: now - 2 * HOUR, rowId: 'one', isEditable: true },
  ] });
  const timeline = () => page.evaluate(() => {
    const instance = window.__timeline.__timeline;
    return { start: instance._findTask('entry:a').start, undo: instance.canUndo(), redo: instance.canRedo() };
  });
  const original = (await timeline()).start;
  await page.locator('#timeline .task[data-task-key="entry:a"]').click();
  await page.evaluate(() => window.__timeline.__timeline._keyboardEditSelected('move', -300_000));
  await expect.poll(() => page.evaluate(() => window.__editSettlers.length)).toBe(1);
  await page.evaluate(() => window.__editSettlers.shift().resolve(true));
  await expect.poll(() => timeline()).toMatchObject({ undo: true });
  await page.evaluate(() => window.__timeline.__timeline.undo());
  await expect.poll(() => page.evaluate(() => window.__editSettlers.length)).toBe(1);
  await page.evaluate(() => window.__editSettlers.shift().resolve(true));
  await expect.poll(() => timeline()).toEqual({ start: original, undo: false, redo: true });
  await page.evaluate(() => window.__timeline.__timeline.redo());
  await expect.poll(() => page.evaluate(() => window.__editSettlers.length)).toBe(1);
  await page.evaluate(() => window.__editSettlers.shift().reject(new Error('redo save failed')));
  await expect.poll(() => timeline()).toEqual({ start: original, undo: false, redo: true });
  await page.evaluate(() => window.__timeline.__timeline.redo());
  await expect.poll(() => page.evaluate(() => window.__editSettlers.length)).toBe(1);
  await page.evaluate(() => window.__editSettlers.shift().resolve(true));
  await expect.poll(() => timeline()).toMatchObject({ undo: true, redo: false });
  expect((await timeline()).start).not.toBe(original);
});

test('pending blocks have no saving overlay in Timeline or Calendar', async ({ page }) => {
  await mount(page, { deferEdit: true });
  const block = page.locator('#timeline .task[data-task-key="entry:a"]');
  const pending = page.locator('#timeline .task[data-task-key="entry:b"]');
  await expect(pending).toHaveCSS('opacity', '1');
  await expect(pending.locator('.clockoli-entry-saving')).toHaveCount(0);
  await block.click();
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => page.evaluate(() => window.__editSettlers.length)).toBe(1);
  await expect(block.locator('.clockoli-entry-saving')).toHaveCount(0);
  await expect(block).not.toHaveAttribute('aria-busy', 'true');
  await page.evaluate(() => window.__timeline.setViewMode('calendar'));
  const calendar = page.locator('#timeline .calendar-task[data-task-key="entry:a"]').first();
  await expect(calendar.locator('.clockoli-entry-saving')).toHaveCount(0);
  await expect(calendar).not.toHaveAttribute('aria-busy', 'true');
  await page.evaluate(() => window.__editSettlers.shift().resolve(true));
});

test('locally accepted entries stay editable and deletable without saving indicators', async ({ page }) => {
  await mount(page);
  const block = page.locator('#timeline .task[data-task-key="entry:b"]');
  await block.click();
  await expect(block).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.evaluate(() => window.__calls)).toEqual([['edit', 'entry:b', 'move']]);
  await page.keyboard.press('Delete');
  await expect.poll(() => page.evaluate(() => window.__calls)).toEqual([['edit', 'entry:b', 'move'], ['delete', 'entry:b']]);
  await expect(page.locator('#timeline .clockoli-entry-saving')).toHaveCount(0);
});

test('focused task keeps keyboard focus when timeline items render again', async ({ page }) => {
  await mount(page);
  const block = page.locator('#timeline .task[data-task-key="entry:b"]');
  await block.click();
  await expect(block).toBeFocused();
  await page.evaluate(() => window.__timeline.update({ items: window.__items }));
  await expect(block).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.evaluate(() => window.__calls)).toEqual([['edit', 'entry:b', 'move']]);
});

test('details descriptions expose a green check and save when it is clicked', async ({ page }) => {
  const now = Date.now();
  await mount(page, { items: [
    { id: 'entry:old', url: 'https://example.com/old', title: 'Old', description: 'Old note', startedAt: now - 3 * HOUR, endedAt: now - 2 * HOUR, rowId: 'one', isEditable: true },
    { id: 'active:now', url: 'https://example.com/now', title: 'Now', description: 'Now note', startedAt: now - HOUR, endedAt: null, rowId: 'one', isRunning: true, isEditable: false },
  ] });
  for (const [id, value] of [['entry:old', 'Edited old note'], ['active:now', 'Edited running note']]) {
    await page.locator(`#timeline .task[data-task-key="${id}"]`).click();
    const input = page.locator('#timeline .clockoli-timeline-description');
    await input.fill(value);
    const save = page.locator('#timeline .clockoli-description-save');
    await expect(save).toBeVisible();
    await expect(save).toHaveCSS('color', 'rgb(31, 136, 61)');
    const geometry = await page.evaluate(() => {
      const root = document.querySelector('#timeline').shadowRoot;
      const input = root.querySelector('.clockoli-timeline-description').getBoundingClientRect();
      const check = root.querySelector('.clockoli-description-save').getBoundingClientRect();
      return { inputLeft: input.left, inputRight: input.right, checkLeft: check.left, checkRight: check.right };
    });
    expect(geometry.checkLeft).toBeGreaterThan(geometry.inputLeft);
    expect(geometry.checkRight).toBeLessThanOrEqual(geometry.inputRight);
    await save.click();
  }
  await expect.poll(() => page.evaluate(() => window.__calls.filter(call => call[0] === 'description'))).toEqual([
    ['description', 'entry:old', 'Edited old note'],
    ['description', 'active:now', 'Edited running note'],
  ]);
});

test('pre-existing multiline descriptions open expanded and long descriptions clearly offer scrolling', async ({ page }) => {
  const now = Date.now();
  const fourLines = ['First finding', 'Second finding', '', 'Final finding'].join('\n');
  const longLines = Array.from({ length: 18 }, (_, i) => `Detail ${i + 1}`).join('\n');
  await mount(page, { items: [
    { id: 'entry:old', url: 'https://example.com/old', title: 'Old', description: fourLines,
      startedAt: now - 3 * HOUR, endedAt: now - 2 * HOUR, rowId: 'one', isEditable: true },
  ] });
  for (const mode of ['timeline', 'calendar']) {
    await page.evaluate(value => window.__timeline.setViewMode(value), mode);
    await page.locator(`#timeline .${mode === 'timeline' ? 'task' : 'calendar-task'}[data-task-key="entry:old"]`).first().click();
    const description = page.locator('#timeline .clockoli-timeline-description');
    await expect(description).toHaveValue(fourLines);
    const initial = await description.evaluate(el => ({ height: el.clientHeight, content: el.scrollHeight, rows: el.rows }));
    expect(initial.rows).toBeGreaterThanOrEqual(4);
    expect(initial.content).toBeLessThanOrEqual(initial.height + 2);
    await description.fill(longLines);
    await expect(page.locator('#timeline .clockoli-description-more')).toBeVisible();
    const clipped = await description.evaluate(el => ({ height: el.clientHeight, content: el.scrollHeight }));
    expect(clipped.content).toBeGreaterThan(clipped.height + 2);
    await description.fill(fourLines);
    await expect(page.locator('#timeline .clockoli-description-more')).toBeHidden();
    await expect.poll(() => description.evaluate(el => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(2);
  }
});

test('Timeline and Calendar descriptions save multiline text on Enter with visible feedback', async ({ page }) => {
  const now = Date.now();
  await mount(page, { items: [
    { id: 'entry:old', url: 'https://example.com/old', title: 'Old', description: 'Original',
      startedAt: now - 3 * HOUR, endedAt: now - 2 * HOUR, rowId: 'one', isEditable: true },
  ] });
  for (const mode of ['timeline', 'calendar']) {
    await page.evaluate(value => window.__timeline.setViewMode(value), mode);
    await page.locator(`#timeline .${mode === 'timeline' ? 'task' : 'calendar-task'}[data-task-key="entry:old"]`).first().click();
    const input = page.locator('#timeline .clockoli-timeline-description');
    await expect(input).toHaveJSProperty('tagName', 'TEXTAREA');
    await input.fill('First line');
    await input.press('Shift+Enter');
    await input.pressSequentially('Second line');
    await expect(input).toHaveValue('First line\nSecond line');
    const before = await page.evaluate(() => window.__calls.filter(call => call[0] === 'description').length);
    await input.press('Enter');
    await expect.poll(() => page.evaluate(() => window.__calls.filter(call => call[0] === 'description').length)).toBe(before + 1);
    expect(await page.evaluate(() => window.__calls.filter(call => call[0] === 'description').at(-1)[2])).toBe('First line\nSecond line');
    await expect(page.locator('#timeline .clockoli-description-saved')).toHaveText('✓ Saved');
    await input.press('Tab');
    expect(await page.evaluate(() => window.__calls.filter(call => call[0] === 'description').length)).toBe(before + 1);
    await page.locator('#timeline .clockoli-description-saved').waitFor({ state: 'visible' });
  }
});

test('details description remains clickable and editable for a non-movable task in Timeline and Calendar', async ({ page }) => {
  const now = Date.now();
  await mount(page, { items: [
    { id: 'active:locked', url: 'https://example.com/locked', title: 'Locked', description: 'Edit me', startedAt: now - HOUR, endedAt: null, rowId: 'one', isRunning: true, isEditable: false },
  ] });
  await page.evaluate(() => {
    window.__siteKeys = [];
    for (const type of ['keydown', 'keypress', 'keyup']) {
      document.addEventListener(type, event => window.__siteKeys.push([type, event.key]));
    }
  });
  for (const mode of ['timeline', 'calendar']) {
    await page.evaluate(nextMode => window.__timeline.setViewMode(nextMode), mode);
    await page.locator(`#timeline .${mode === 'timeline' ? 'task' : 'calendar-task'}[data-task-key="active:locked"]`).first().click();
    const input = page.locator('#timeline .clockoli-timeline-description');
    await input.click();
    expect(await input.evaluate(element => element.getRootNode().activeElement === element)).toBe(true);
    await input.fill('');
    await input.pressSequentially('ac');
    await expect(input).toHaveValue('ac');
    expect(await page.evaluate(() => window.__siteKeys)).toEqual([]);
    await input.press('End');
    await input.press('ArrowLeft');
    expect(await input.evaluate(element => element.selectionStart)).toBe(1);
  }
});

test('a newer description entered during an earlier save is not falsely marked saved', async ({ page }) => {
  const now = Date.now();
  await mount(page, { deferDescription: true, items: [
    { id: 'entry:old', url: 'https://example.com/old', title: 'Old', description: 'Original', startedAt: now - 3 * HOUR, endedAt: now - 2 * HOUR, rowId: 'one', isEditable: true },
  ] });
  await page.locator('#timeline .task[data-task-key="entry:old"]').click();
  const input = page.locator('#timeline .clockoli-timeline-description');
  await input.fill('First');
  await input.blur();
  await expect.poll(() => page.evaluate(() => window.__calls.filter(call => call[0] === 'description'))).toEqual([
    ['description', 'entry:old', 'First'],
  ]);
  await input.fill('Second');
  const save = page.locator('#timeline .clockoli-description-save');
  const secondSave = save.click();
  await page.evaluate(() => window.__descriptionResolves.shift()(true));
  await expect.poll(() => page.evaluate(() => window.__calls.filter(call => call[0] === 'description'))).toEqual([
    ['description', 'entry:old', 'First'],
    ['description', 'entry:old', 'Second'],
  ]);
  await page.evaluate(() => window.__descriptionResolves.shift()(true));
  await secondSave;
  await expect(save).toBeHidden();
});

test('a blurred newer description survives a stale parent update while the older save is pending', async ({ page }) => {
  const now = Date.now();
  await mount(page, { deferDescription: true, items: [
    { id: 'entry:old', url: 'https://example.com/old', title: 'Old', description: 'Old note', savedDescription: 'Old note', startedAt: now - 3 * HOUR, endedAt: now - 2 * HOUR, rowId: 'one', isEditable: true },
  ] });
  await page.locator('#timeline .task[data-task-key="entry:old"]').click();
  const input = page.locator('#timeline .clockoli-timeline-description');
  const save = page.locator('#timeline .clockoli-description-save');
  await input.fill('First');
  await save.click();
  await input.fill('Second');
  await input.evaluate(element => element.blur());
  await page.evaluate(() => {
    window.__items = window.__items.map(item => item.id === 'entry:old'
      ? { ...item, description: 'Second', savedDescription: 'First' }
      : item);
    window.__timeline.update({ items: window.__items, now: Date.now() });
  });
  await expect(input).toHaveValue('Second');
  await expect(save).toBeVisible();
  expect(await input.getAttribute('data-saved-description')).toBe('First');
  await page.evaluate(() => window.__descriptionResolves.shift()(true));
  await expect.poll(() => page.evaluate(() => window.__calls.filter(call => call[0] === 'description').map(call => call[2]))).toEqual(['First', 'Second']);
  await page.evaluate(() => window.__descriptionResolves.shift()(true));
});

test('a rejected description save remains visibly dirty and reports the error', async ({ page }) => {
  const now = Date.now();
  await mount(page, { descriptionReject: true, items: [
    { id: 'entry:old', url: 'https://example.com/old', title: 'Old', description: 'Original', startedAt: now - 3 * HOUR, endedAt: now - 2 * HOUR, rowId: 'one', isEditable: true },
  ] });
  await page.locator('#timeline .task[data-task-key="entry:old"]').click();
  const input = page.locator('#timeline .clockoli-timeline-description');
  await input.fill('Not saved');
  const save = page.locator('#timeline .clockoli-description-save');
  await save.click();
  await expect.poll(() => page.evaluate(() => window.__calls)).toEqual([
    ['description', 'entry:old', 'Not saved'],
    ['error', 'description', 'description failed'],
  ]);
  await expect(input).toHaveValue('Not saved');
  await expect(save).toBeVisible();
  await expect(save).toBeEnabled();
});

test('Calendar task cards show their site favicons', async ({ page }) => {
  const favicon = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="red"/></svg>';
  const now = Date.now();
  await mount(page, { items: [{ id: 'entry:icon', url: 'https://example.com/icon', title: 'Icon task', faviconUrl: favicon, startedAt: now - HOUR, endedAt: now - 30 * 60_000, rowId: 'one', isEditable: true }] });
  await page.evaluate(() => window.__timeline.setViewMode('calendar'));
  const image = page.locator('#timeline .calendar-task:not(.segment-continuation) .clockoli-calendar-favicon');
  await expect(image).toHaveCount(1);
  await expect(image).toHaveAttribute('src', favicon);
});

for (const colorScheme of ['light', 'dark']) {
  test(`Calendar task cards show monograms without favicon permission in ${colorScheme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    const now = Date.now();
    const requests = [];
    page.on('request', request => requests.push(request.url()));
    await mount(page, { items: [
      { id: 'entry:monogram', url: 'https://www.example.com/icon', title: 'Letter task', faviconUrl: null, startedAt: now - HOUR, endedAt: now - 30 * 60_000, rowId: 'one', isEditable: true },
      { id: 'entry:unavailable', url: 'https://example.com/unavailable', title: 'Unavailable resource', faviconUrl: '', startedAt: now - 2 * HOUR, endedAt: now - HOUR, rowId: 'one', isEditable: true },
      { id: 'entry:imported', url: null, title: 'owner/repo/slug', faviconUrl: '', startedAt: now - 3 * HOUR, endedAt: now - 2 * HOUR, rowId: 'one', isEditable: true },
    ] });
    await page.evaluate(colorScheme => {
      const host = document.querySelector('#timeline');
      host.style.setProperty('--fgColor-default', colorScheme === 'dark' ? '#e6edf3' : '#1f2328');
      host.style.setProperty('--bgColor-default', colorScheme === 'dark' ? '#0d1117' : '#ffffff');
      host.style.setProperty('--fgColor-muted', colorScheme === 'dark' ? '#9198a1' : '#59636e');
      host.style.setProperty('--bgColor-muted', colorScheme === 'dark' ? '#151b23' : '#f6f8fa');
      host.style.setProperty('--borderColor-muted', colorScheme === 'dark' ? '#3d444db3' : '#d1d9e0b3');
      host.style.setProperty('--bgColor-accent-muted', colorScheme === 'dark' ? '#388bfd1a' : '#ddf4ff');
      host.style.setProperty('--fgColor-accent', colorScheme === 'dark' ? '#4493f8' : '#0969da');
    }, colorScheme);
    const panel = colorScheme === 'dark' ? 'rgb(13, 17, 23)' : 'rgb(255, 255, 255)';
    // Resize observers can replace cells between Playwright's query and the style read; detached cells report empty styles.
    const computedStyles = (selector, property) => page.locator(`#timeline ${selector}`)
      .evaluateAll((elements, property) => elements.map(element => getComputedStyle(element)[property]), property);
    const assertPanelBackgrounds = async selectors => {
      for (const selector of selectors) {
        await expect.poll(async () => {
          const backgrounds = await computedStyles(selector, 'backgroundColor');
          return backgrounds.length > 0 && backgrounds.every(background => background === panel);
        }, { message: selector }).toBe(true);
      }
    };
    await assertPanelBackgrounds(['.content', '.ruler-row', '.task-row', '.ruler-cell:not(.empty)']);
    if (colorScheme === 'dark') {
      for (const selector of ['.day-band', '.ruler-cell']) {
        await expect.poll(async () => {
          const colors = await computedStyles(selector, 'color');
          return colors.length > 0 && colors.every(color => color && color !== 'rgb(52, 64, 84)');
        }, { message: selector }).toBe(true);
      }
    }
    await page.evaluate(() => window.__timeline.setViewMode('calendar'));
    await assertPanelBackgrounds(['.calendar-time-label', '.calendar-row-name']);
    const editBadge = page.locator('#timeline .calendar-edit-clock').first();
    const text = colorScheme === 'dark' ? 'rgb(230, 237, 243)' : 'rgb(31, 35, 40)';
    await expect(editBadge).toHaveCSS('color', panel);
    await expect(editBadge).toHaveCSS('background-color', text);
    const tile = page.locator('#timeline .calendar-task[data-task-key="entry:monogram"]:not(.segment-continuation) .clockoli-calendar-favicon');
    await expect(tile).toHaveText('E');
    await expect(tile).toHaveAttribute('aria-hidden', 'true');
    await expect(tile).toHaveJSProperty('tagName', 'SPAN');
    await expect(tile).toHaveCSS('width', '16px');
    await expect(tile).toHaveCSS('height', '16px');
    await expect(tile).toHaveCSS('border-radius', '3px');
    await expect(tile).toHaveCSS('color', text);
    await expect(tile).toHaveCSS('background-color', panel);
    await expect(page.locator('#timeline .calendar-task[data-task-key="entry:unavailable"] .clockoli-calendar-favicon')).toHaveCount(0);
    await expect(page.locator('#timeline .calendar-task[data-task-key="entry:imported"] .clockoli-calendar-favicon')).toHaveCount(0);
    expect(requests.some(url => url.includes('/_favicon/'))).toBe(false);
  });
}

test('Calendar task cards show description only when the card has room', async ({ page }) => {
  // Keep the tasks within one local day, and well above/below the card's 48px
  // description-height threshold (the rendered height excludes borders).
  const noon = new Date();
  noon.setHours(12, 0, 0, 0);
  const midday = noon.getTime();
  await mount(page, { rows: [{ id: 'one', title: 'One' }], items: [
    { id: 'entry:tall-description', url: 'https://example.com/tall', title: 'Tall task', description: 'Calendar\nDescription\nMore detail', startedAt: midday - 4 * HOUR, endedAt: midday, rowId: 'one', isEditable: true },
    { id: 'entry:short-description', url: 'https://example.com/short', title: 'Short task', description: 'Must not overflow', startedAt: midday + HOUR, endedAt: midday + HOUR + 5 * 60_000, rowId: 'one', isEditable: true },
  ] });
  await page.evaluate(() => window.__timeline.setViewMode('calendar'));
  const tall = page.locator('#timeline .calendar-task[data-task-key="entry:tall-description"]');
  const short = page.locator('#timeline .calendar-task[data-task-key="entry:short-description"]');
  await expect(tall.locator('.clockoli-calendar-description')).toHaveText('Calendar\nDescription\nMore detail');
  await expect(tall.locator('.clockoli-calendar-description')).toHaveAttribute('data-clockoli-tooltip', 'Calendar\nDescription\nMore detail');
  await expect(tall.locator('.clockoli-calendar-description')).toHaveCSS('-webkit-line-clamp', '2');
  await expect(tall.locator('.clockoli-calendar-description')).toHaveCSS('white-space', 'pre-line');
  await expect(short.locator('.clockoli-calendar-description')).toHaveCount(0);
  const geometry = await tall.evaluate(element => {
    const card = element.getBoundingClientRect();
    const description = element.querySelector('.clockoli-calendar-description').getBoundingClientRect();
    return { cardBottom: card.bottom, descriptionBottom: description.bottom };
  });
  expect(geometry.descriptionBottom).toBeLessThanOrEqual(geometry.cardBottom);
});

test('a failed Calendar favicon stays failed without an observer recreate loop', async ({ page }) => {
  const now = Date.now();
  await mount(page, { items: [{ id: 'entry:broken-icon', url: 'https://example.com/broken', title: 'Broken icon', faviconUrl: 'data:image/png;base64,broken', startedAt: now - HOUR, endedAt: now - 30 * 60_000, rowId: 'one', isEditable: true }] });
  await page.evaluate(() => window.__timeline.setViewMode('calendar'));
  const image = page.locator('#timeline .calendar-task:not(.segment-continuation) .clockoli-calendar-favicon');
  await expect(image).toHaveCount(1);
  await expect(image).toBeHidden();
  await page.waitForTimeout(50);
  await expect(image).toHaveCount(1);
});

test('running action keeps its save label and keyboard focus as time advances', async ({ page }) => {
  await mount(page);
  await page.evaluate(() => {
    const root = document.querySelector('#timeline').shadowRoot;
    root.querySelector('.task[data-task-key="active:c"]').click();
  });
  const before = await page.evaluate(() => {
    const root = document.querySelector('#timeline').shadowRoot;
    const button = root.querySelector('.clockoli-timeline-action.primary');
    button.focus();
    window.__stopButton = button;
    return button.textContent;
  });
  await page.evaluate(() => window.__timeline.update({ now: Date.now() + 60_000 }));
  const after = await page.evaluate(() => ({
    same: window.__stopButton === document.querySelector('#timeline').shadowRoot.querySelector('.clockoli-timeline-action.primary'),
    focused: document.querySelector('#timeline').shadowRoot.activeElement === window.__stopButton,
    text: window.__stopButton.textContent,
  }));
  expect(after.same).toBeTruthy();
  expect(after.focused).toBeTruthy();
  expect(after.text).toBe(before);
  expect(after.text).toBe('Stop and save');
});

test('rejected Delete restores the exact selected block', async ({ page }) => {
  await mount(page, { deleteResult: false });
  await page.evaluate(() => document.querySelector('#timeline').shadowRoot.querySelector('.task[data-task-key="entry:a"]').click());
  await page.keyboard.press('Delete');
  await expect.poll(() => page.evaluate(() => window.__calls)).toEqual([['delete', 'entry:a']]);
  await expect.poll(() => page.evaluate(() => Boolean(document.querySelector('#timeline').shadowRoot.querySelector('.task[data-task-key="entry:a"]')))).toBeTruthy();
});

test('rejected details action is reported without an unhandled rejection', async ({ page }) => {
  await mount(page, { deleteReject: true });
  await page.locator('#timeline .task[data-task-key="entry:a"]').click();
  await page.locator('#timeline .clockoli-timeline-action.danger').click();
  await expect.poll(() => page.evaluate(() => window.__calls)).toEqual([
    ['delete', 'entry:a'],
    ['error', 'delete', 'delete failed'],
  ]);
});

test('Calendar scrollToEnd opens the running entry day', async ({ page }) => {
  await mount(page);
  await page.evaluate(() => {
    window.__timeline.setViewMode('calendar');
    window.__timeline.setCalendarDate(Date.now() - 4 * 24 * 60 * 60 * 1000);
    window.__timeline.scrollToEnd();
  });
  const state = await page.evaluate(() => ({
    range: window.__timeline.getCalendarRange(),
    start: window.__timeline.__timeline.getRunningTask().start,
  }));
  expect(state.start).toBeGreaterThanOrEqual(state.range.start);
  expect(state.start).toBeLessThan(state.range.end);
});

test('Calendar keeps its scale when a running task is added and focused', async ({ page }) => {
  const now = await mount(page);
  const state = await page.evaluate(now => {
    window.__timeline.setViewMode('calendar');
    window.__timeline.__timeline.setVisibleDays(4);
    const before = window.__timeline.__timeline.visibleDays;
    const items = window.__items.filter(item => !item.isRunning).concat({
      id: 'active:new', url: 'https://example.com/new', title: 'New task',
      startedAt: now - 1_000, endedAt: null, rowId: 'one', isRunning: true, isEditable: false,
    });
    window.__timeline.update({ items, now, view: { start: now - 86_400_000, end: now, focusedAt: now } });
    window.__timeline.scrollToEnd();
    return { before, after: window.__timeline.__timeline.visibleDays, mode: window.__timeline.getViewMode() };
  }, now);
  expect(state).toEqual({ before: 4, after: 4, mode: 'calendar' });
});

test('Timeline day bands and major grid lines use local midnight', async ({ page }) => {
  await mount(page);
  const geometry = await page.evaluate(() => {
    const root = document.querySelector('#timeline').shadowRoot;
    const dayStarts = [...root.querySelectorAll('.day-band')].map(node => Number(node.dataset.start));
    const majorStarts = [...root.querySelectorAll('.grid-line.major')].map(node => Number(node.dataset.time));
    return { dayStarts, majorStarts };
  });
  expect(geometry.dayStarts.length).toBeGreaterThan(1);
  for (const timestamp of geometry.dayStarts) {
    const date = new Date(timestamp);
    expect([date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds()]).toEqual([0, 0, 0, 0]);
  }
  expect(geometry.majorStarts.every(timestamp => geometry.dayStarts.includes(timestamp))).toBeTruthy();
});

test('Timeline local-midnight bands preserve the short day across DST', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTimezoneOverride', { timezoneId: 'America/New_York' });
  await page.goto('/packages/task-timeline-component/e2e/fixture.html');
  const geometry = await page.evaluate(() => {
    const start = new Date(2026, 2, 7, 0, 0, 0, 0).getTime();
    const end = new Date(2026, 2, 10, 0, 0, 0, 0).getTime();
    ClockoliTaskTimeline.createTimeline(document.querySelector('#timeline'), {
      now: end,
      view: { start, end, focusedAt: end },
      rows: [{ id: 'one', title: 'One' }],
      items: [{ id: 'entry:dst', url: 'https://example.com/dst', title: 'DST', startedAt: start + 3_600_000, endedAt: end - 3_600_000, rowId: 'one' }],
    });
    const dayStarts = [...document.querySelector('#timeline').shadowRoot.querySelectorAll('.day-band')].map(node => Number(node.dataset.start));
    return {
      clocks: dayStarts.map(timestamp => { const value = new Date(timestamp); return [value.getHours(), value.getMinutes(), value.getSeconds(), value.getMilliseconds()]; }),
      deltas: dayStarts.slice(1).map((timestamp, index) => timestamp - dayStarts[index]),
    };
  });
  expect(geometry.clocks.every(clock => clock.every(part => part === 0))).toBeTruthy();
  expect(geometry.deltas).toContain(23 * HOUR);
});

test('Timeline keeps current time at the right edge without future time', async ({ page }) => {
  const now = await mount(page);
  const state = await page.evaluate(now => {
    const span = 86_400_000;
    const items = window.__items.filter(item => !item.isRunning).concat({
      id: 'active:new', url: 'https://example.com/new', title: 'New task',
      startedAt: now - 1_000, endedAt: null, rowId: 'one', isRunning: true, isEditable: false,
    });
    window.__timeline.update({ items, now, view: { start: now - span, end: now, focusedAt: now } });
    window.__timeline.scrollToEnd();
    const beforeTick = window.__timeline.__timeline._scrollLeftNow();
    window.__timeline.update({ now: now + 2_000 });
    const timeline = window.__timeline.__timeline;
    const task = timeline._runningTask();
    return {
      position: (timeline.timeToX(timeline.currentTime) - timeline._scrollLeftNow()) / timeline._viewportWidthNow(),
      domainEnd: timeline.domainEnd,
      visibleEnd: window.__timeline.getView().end,
      rulerEnds: [...timeline.rulerRow.querySelectorAll('.ruler-cell')].map(node => Number(node.dataset.end)),
      beforeTick,
      afterTick: timeline._scrollLeftNow(),
      maxScroll: Math.max(0, timeline.totalWidth - timeline._viewportWidthNow()),
      gutter: timeline.totalWidth - task.x1,
    };
  }, now);
  const tickEnd = now + 2_000;
  expect(state.position).toBeCloseTo(1, 2);
  expect(state.domainEnd).toBe(tickEnd);
  expect(state.visibleEnd).toBe(tickEnd);
  expect(Math.max(...state.rulerEnds)).toBe(tickEnd);
  expect(state.afterTick).toBeCloseTo(state.maxScroll, 1);
  expect(state.gutter).toBeCloseTo(0, 1);
});

test('Timeline renders and advances the supplied current time as a vertical line', async ({ page }) => {
  const now = await mount(page);
  const state = await page.evaluate(now => {
    const timeline = window.__timeline.__timeline;
    const before = timeline.nowLineLayer.querySelector('.timeline-now-line');
    const initial = {
      count: timeline.nowLineLayer.querySelectorAll('.timeline-now-line').length,
      timestamp: Number(before?.dataset.time),
      left: Number.parseFloat(before?.style.left || 'NaN'),
      parentClass: before?.parentElement?.className,
      height: before?.getBoundingClientRect().height,
      taskAreaHeight: timeline.taskRow.getBoundingClientRect().height,
      lineZ: Number(getComputedStyle(before).zIndex),
      layerZ: Number(getComputedStyle(timeline.nowLineLayer).zIndex),
      taskLayerZ: Number(getComputedStyle(timeline.taskRow).zIndex),
    };
    window.__timeline.update({ now: now + 2_000 });
    timeline._renderEditGuides();
    const after = timeline.nowLineLayer.querySelector('.timeline-now-line');
    return {
      initial,
      countAfterGuideRender: timeline.nowLineLayer.querySelectorAll('.timeline-now-line').length,
      timestamp: Number(after?.dataset.time),
      left: Number.parseFloat(after?.style.left || 'NaN'),
      expectedLeft: timeline.timeToX(now + 2_000),
    };
  }, now);
  expect(state.initial.count).toBe(1);
  expect(state.initial.timestamp).toBe(now);
  expect(state.initial.parentClass).toContain('now-line-layer');
  expect(state.initial.height).toBeCloseTo(state.initial.taskAreaHeight, 0);
  expect(state.initial.lineZ).toBeGreaterThan(state.initial.taskLayerZ);
  expect(state.initial.layerZ).toBeGreaterThan(state.initial.taskLayerZ);
  expect(state.countAfterGuideRender).toBe(1);
  expect(state.timestamp).toBe(now + 2_000);
  expect(state.left).toBeCloseTo(state.expectedLeft, 1);
});

test('a one-day Timeline shows boundaries at least every two hours without clipped labels', async ({ page }) => {
  await mount(page);
  const state = await page.evaluate(async () => {
    const timeline = window.__timeline.__timeline;
    timeline.host.style.width = '320px';
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const start = timeline._floorDay(Date.now());
    const end = timeline._addDaysLocal(start, 1);
    timeline.tasks = [];
    timeline._rebuildRows();
    timeline.domainStart = start;
    timeline.domainEnd = end;
    timeline.baseDomainEnd = end;
    timeline.currentTime = start + 12 * 60 * 60 * 1000;
    timeline.setVisibleDays(1);
    timeline._renderAll();
    const cells = [...timeline.rulerRow.querySelectorAll('.ruler-cell')];
    return {
      viewportWidth: timeline.viewport.getBoundingClientRect().width,
      cachedViewportWidth: timeline._viewportWidth,
      tickHours: timeline.getTickHours(),
      boundaries: [...timeline.gridLayer.querySelectorAll('.grid-line')].map(line => Number(line.dataset.time)),
      labels: cells.map(cell => ({
        text: cell.textContent,
        start: Number(cell.dataset.start),
        end: Number(cell.dataset.end),
        width: cell.getBoundingClientRect().width,
        scrollWidth: cell.scrollWidth,
      })),
    };
  });
  expect(state.viewportWidth).toBeCloseTo(320, 0);
  expect(state.cachedViewportWidth).toBeCloseTo(320, 0);
  expect(state.tickHours).toBeLessThanOrEqual(2);
  expect(state.boundaries.length).toBeGreaterThanOrEqual(12);
  expect(state.labels.length).toBeGreaterThanOrEqual(12);
  expect(Math.max(...state.labels.map(label => label.end - label.start))).toBeLessThanOrEqual(2 * HOUR);
  expect(state.labels.every(label => label.text && label.scrollWidth <= label.width + 1)).toBeTruthy();
});

test('a 25-hour fall-back day keeps the one-day ruler at two-hour granularity', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTimezoneOverride', { timezoneId: 'America/New_York' });
  await page.goto('/packages/task-timeline-component/e2e/fixture.html');
  const state = await page.evaluate(() => {
    const host = document.querySelector('#timeline');
    host.style.width = '320px';
    const start = new Date(2026, 10, 1, 0, 0, 0, 0).getTime();
    const end = new Date(2026, 10, 2, 0, 0, 0, 0).getTime();
    const adapter = ClockoliTaskTimeline.createTimeline(host, {
      now: end,
      view: { start, end, focusedAt: end },
      rows: [{ id: 'one', title: 'One' }],
      items: [{ id: 'entry:fall-back', url: 'https://example.com/fall-back', title: 'Fall back', startedAt: start, endedAt: end, rowId: 'one' }],
    });
    const timeline = adapter.__timeline;
    const labels = [...timeline.rulerRow.querySelectorAll('.ruler-cell')]
      .filter(cell => Number(cell.dataset.start) >= start && Number(cell.dataset.start) < end);
    return {
      elapsedHours: (end - start) / (60 * 60 * 1000),
      visibleDays: timeline.getVisibleDays(),
      tickHours: timeline.getTickHours(),
      dayLabels: labels.map(cell => cell.textContent),
      clipped: labels.some(cell => cell.scrollWidth > cell.getBoundingClientRect().width + 1),
    };
  });
  expect(state.elapsedHours).toBe(25);
  expect(state.visibleDays).toBeCloseTo(25 / 24, 6);
  expect(state.tickHours).toBe(2);
  expect(state.dayLabels.length).toBeGreaterThanOrEqual(12);
  expect(state.clipped).toBeFalsy();
});

test('Calendar positions its current-time line from supplied now, not a later domain end', async ({ page }) => {
  const now = await mount(page);
  const state = await page.evaluate(({ now, hour }) => {
    window.__timeline.setViewMode('calendar');
    const timeline = window.__timeline.__timeline;
    timeline.domainEnd = now + hour;
    timeline._renderCalendarNowLine();
    const line = timeline.calendarCanvas.querySelector('.calendar-now-line');
    const dayIndex = timeline._calendarDayIndexForTime(now);
    let day = timeline.calendarStartDay;
    for (let index = 0; index < dayIndex; index++) day = timeline._addDaysLocal(day, 1);
    const next = timeline._addDaysLocal(day, 1);
    const expectedTop = timeline._calendarMetrics.headerHeight
      + timeline._calendarMetrics.verticalMap.toY(timeline._calendarMinutesOfDay(now, day, next));
    return {
      timestamp: Number(line?.dataset.time),
      top: Number.parseFloat(line?.style.top || 'NaN'),
      expectedTop,
      domainEnd: timeline.domainEnd,
    };
  }, { now, hour: HOUR });
  expect(state.domainEnd).toBe(now + HOUR);
  expect(state.timestamp).toBe(now);
  // Inline CSS pixel serialization rounds more aggressively than the floating-point map.
  expect(Math.abs(state.top - state.expectedTop)).toBeLessThan(0.01);
});

test('a newly started running task is visible without extending past supplied now', async ({ page }) => {
  await page.goto('/packages/task-timeline-component/e2e/fixture.html');
  const state = await page.evaluate(() => {
    const now = Date.now();
    const startedAt = now;
    const timeline = ClockoliTaskTimeline.createTimeline(document.querySelector('#timeline'), {
      now,
      view: { start: now - 86_400_000, end: now, focusedAt: now },
      items: [{ id: 'active:new', url: 'https://example.com/new', title: 'New', startedAt, endedAt: null, rowId: 'one', isRunning: true }],
      rows: [{ id: 'one', title: 'One' }],
    });
    timeline.scrollToEnd();
    timeline.setViewMode('calendar');
    return {
      now,
      taskEnd: timeline.__timeline._runningTask().end,
      domainEnd: timeline.__timeline.domainEnd,
      visibleEnd: timeline.getView().end,
      calendarTasks: timeline.__timeline.calendarCanvas.querySelectorAll('.calendar-task').length,
    };
  });
  expect(state.taskEnd).toBe(state.now);
  expect(state.domainEnd).toBe(state.now);
  expect(state.visibleEnd).toBe(state.now);
  expect(state.calendarTasks).toBe(1);
});

test('a zero-duration running task survives rollback state restoration', async ({ page }) => {
  await page.goto('/packages/task-timeline-component/e2e/fixture.html');
  const state = await page.evaluate(() => {
    const now = Date.now();
    const adapter = ClockoliTaskTimeline.createTimeline(document.querySelector('#timeline'), {
      now,
      view: { start: now - 86_400_000, end: now, focusedAt: now },
      items: [{ id: 'active:new', url: 'https://example.com/new', title: 'New', startedAt: now, endedAt: null, rowId: 'one', isRunning: true }],
      rows: [{ id: 'one', title: 'One' }],
    });
    const timeline = adapter.__timeline;
    const snapshot = timeline._captureState();
    timeline._restoreState(snapshot);
    const running = timeline._runningTask();
    timeline.setViewMode('calendar');
    const calendarTasks = [...timeline.calendarCanvas.querySelectorAll('.calendar-task')];
    const calendarTask = calendarTasks[0];
    const geometry = {
      count: calendarTasks.length,
      height: calendarTask ? Number.parseFloat(getComputedStyle(calendarTask).height) : null,
      minimumHeight: timeline.options.calendarMinTaskHeight,
      segmentStart: calendarTask?.dataset.segmentStart,
      segmentEnd: calendarTask?.dataset.segmentEnd,
    };
    adapter.destroy();
    return { running: Boolean(running), start: running?.start, end: running?.end, geometry, error: null };
  }).catch(error => ({ error: String(error) }));
  expect(state.error).toBeNull();
  expect(state.running).toBeTruthy();
  expect(state.end).toBe(state.start);
  expect(state.geometry.count).toBe(1);
  expect(state.geometry.height).toBe(state.geometry.minimumHeight);
  expect(state.geometry.segmentStart).toBe(String(state.start));
  expect(state.geometry.segmentEnd).toBe(String(state.end));
});

test('completed zero-duration entries remain visible in Timeline and Calendar without changing their times', async ({ page }) => {
  const now = new Date(2026, 9, 20, 10).getTime();
  const zero = new Date(2026, 9, 20, 9, 30).getTime();
  await page.clock.setFixedTime(now);
  await mount(page, {
    items: [
      { id: 'entry:yesterday', url: 'https://example.com/yesterday', title: 'Yesterday', startedAt: new Date(2026, 9, 19, 11).getTime(), endedAt: new Date(2026, 9, 19, 12).getTime(), rowId: 'one' },
      { id: 'entry:earlier', url: 'https://example.com/earlier', title: 'Earlier', startedAt: new Date(2026, 9, 20, 8, 30).getTime(), endedAt: new Date(2026, 9, 20, 9, 10).getTime(), rowId: 'one' },
      { id: 'entry:zero', url: 'https://example.com/zero', title: 'Zero', startedAt: zero, endedAt: zero, rowId: 'one', isEditable: true },
      { id: 'active:later', url: 'https://example.com/later', title: 'Later', startedAt: new Date(2026, 9, 20, 9, 45).getTime(), endedAt: null, rowId: 'one', isRunning: true },
    ],
    view: { start: new Date(2026, 9, 19).getTime(), end: now, focusedAt: zero },
  });
  const card = page.locator('#timeline .task[data-task-key="entry:zero"]');
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute('aria-label', 'Zero: 20.10.2026 09:30 — 20.10.2026 09:30');
  await page.evaluate(() => window.__timeline.setViewMode('calendar'));
  const calendarCard = page.locator('#timeline .calendar-task[data-task-key="entry:zero"]');
  await expect(calendarCard).toBeVisible();
  await expect.poll(() => calendarCard.evaluate(element => Number.parseFloat(getComputedStyle(element).height)))
    .toBeGreaterThan(0);
  const geometry = await calendarCard.evaluate(element => ({
    height: Number.parseFloat(getComputedStyle(element).height),
    minimum: window.__timeline.__timeline.options.calendarMinTaskHeight,
    start: element.dataset.segmentStart,
    end: element.dataset.segmentEnd,
  }));
  expect(geometry).toEqual({ height: geometry.minimum, minimum: geometry.minimum, start: String(zero), end: String(zero) });
  await calendarCard.click();
  await expect(page.locator('#timeline .details-value')).toContainText(['Start09:30', 'End09:30', 'Duration0m']);
  expect(await page.evaluate(() => {
    const task = window.__timeline.__timeline._findTask('entry:zero');
    const updated = window.__timeline.__timeline.updateTask('entry:zero', { name: 'Renamed zero' });
    let rejectedNegative = false;
    try { window.__timeline.__timeline.updateTask('entry:zero', { end: task.start - 1 }); }
    catch (error) { rejectedNegative = error instanceof RangeError; }
    return { times: [updated.start, updated.end], rejectedNegative,
      after: window.__timeline.__timeline._findTask('entry:zero').end };
  })).toEqual({ times: [zero, zero], rejectedNegative: true, after: zero });
  await expect(calendarCard).toBeVisible();
});

test('manual Timeline scroll survives later data refreshes', async ({ page }) => {
  await mount(page);
  const state = await page.evaluate(() => {
    const timeline = window.__timeline.__timeline;
    const target = Math.max(0, timeline.totalWidth * 0.35);
    timeline._setScrollLeft(target);
    timeline.viewport.dispatchEvent(new Event('scroll'));
    const before = timeline.xToTime(timeline._scrollLeftNow() + timeline._viewportWidthNow() / 2);
    window.__timeline.update({ items: window.__items, now: Date.now() });
    const after = timeline.xToTime(timeline._scrollLeftNow() + timeline._viewportWidthNow() / 2);
    return { before, after };
  });
  expect(Math.abs(state.after - state.before)).toBeLessThan(10_000);
});

test('data refresh keeps right-pinned now pinned when older history expands the canvas', async ({ page }) => {
  await mount(page);
  const state = await page.evaluate(() => {
    const adapter = window.__timeline, timeline = adapter.__timeline;
    adapter.scrollToEnd();
    const now = Date.now();
    adapter.update({
      items: [{ id: 'older', title: 'Older', startedAt: now - 14 * 24 * 60 * 60_000, endedAt: now - 14 * 24 * 60 * 60_000 + 60 * 60_000, rowId: 'one', isEditable: true }, ...window.__items],
      now,
    });
    const maxScroll = Math.max(0, timeline.totalWidth - timeline._viewportWidthNow());
    const line = timeline.nowLineLayer.querySelector('.timeline-now-line').getBoundingClientRect(), viewport = timeline.viewport.getBoundingClientRect();
    return { scroll: timeline._scrollLeftNow(), maxScroll, lineRight: line.right, viewportRight: viewport.left + timeline.viewport.clientWidth };
  });
  expect(state.scroll).toBeCloseTo(state.maxScroll, 0);
  expect(state.lineRight).toBeLessThanOrEqual(state.viewportRight + 1);
  expect(state.lineRight).toBeGreaterThanOrEqual(state.viewportRight - 3);
});

test('data refresh preserves the manual center timestamp when older history expands the canvas', async ({ page }) => {
  await mount(page);
  const state = await page.evaluate(() => {
    const adapter = window.__timeline, timeline = adapter.__timeline;
    timeline._setScrollLeft(Math.max(0, timeline.totalWidth * 0.35));
    const centerBefore = timeline.xToTime(timeline._scrollLeftNow() + timeline._viewportWidthNow() / 2);
    const now = Date.now();
    adapter.update({
      items: [{ id: 'older', title: 'Older', startedAt: now - 14 * 24 * 60 * 60_000, endedAt: now - 14 * 24 * 60 * 60_000 + 60 * 60_000, rowId: 'one', isEditable: true }, ...window.__items],
      now,
    });
    const centerAfter = timeline.xToTime(timeline._scrollLeftNow() + timeline._viewportWidthNow() / 2);
    return { centerBefore, centerAfter };
  });
  expect(Math.abs(state.centerAfter - state.centerBefore)).toBeLessThan(10_000);
});

test('Timeline keeps edit badge geometry and reveals it only during a drag', async ({ page }) => {
  await mount(page);
  const task = page.locator('#timeline .task[data-task-key="entry:a"]');
  await task.hover();
  const hover = await page.evaluate(() => {
    const root = document.querySelector('#timeline').shadowRoot;
    const task = root.querySelector('.task[data-task-key="entry:a"]');
    const badges = [...task.querySelectorAll('.edit-clock')];
    const byClass = Object.fromEntries(badges.map(node => [node.classList[1], node.getBoundingClientRect()]));
    return { task: task.getBoundingClientRect(), names: badges.map(node => node.classList[1]), byClass, guideLabels: root.querySelectorAll('.edit-guide-label').length };
  });
  expect(hover.names.sort()).toEqual(['duration', 'end', 'start']);
  expect(hover.guideLabels).toBe(0);
  expect(hover.byClass.start.left).toBeCloseTo(hover.task.left, 0);
  expect(hover.byClass.start.bottom).toBeLessThanOrEqual(hover.task.top + 1);
  expect(hover.byClass.end.right).toBeCloseTo(hover.task.right, 0);
  expect(hover.byClass.end.bottom).toBeLessThanOrEqual(hover.task.top + 1);
  expect(hover.byClass.duration.left).toBeCloseTo(hover.task.left, 0);
  expect(hover.byClass.duration.top).toBeGreaterThanOrEqual(hover.task.bottom - 1);

  const box = hover.task;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2);
  expect(await task.locator('.edit-clock').count()).toBe(3);
  await expect(task.locator('.edit-clock.start')).toHaveCSS('visibility', 'visible');
  await expect(task.locator('.edit-clock.end')).toHaveCSS('visibility', 'visible');
  expect(await page.locator('#timeline .edit-guide-label').count()).toBe(0);
  await page.mouse.up();
});

test('a one-project Timeline keeps the Duration badge inside the viewport', async ({ page }) => {
  const now = Date.now();
  await mount(page, { rows: [{ id: 'one', title: 'One' }], items: [
    { id: 'entry:one-row', url: 'https://example.com/one-row', title: 'One row', startedAt: now - 2 * HOUR, endedAt: now - HOUR, rowId: 'one', isEditable: true },
  ] });
  const task = page.locator('#timeline .task[data-task-key="entry:one-row"]');
  await task.hover();
  const geometry = await page.evaluate(() => {
    const root = document.querySelector('#timeline').shadowRoot;
    const viewport = root.querySelector('.viewport').getBoundingClientRect();
    const duration = root.querySelector('.task[data-task-key="entry:one-row"] .edit-clock.duration').getBoundingClientRect();
    const timeline = window.__timeline.__timeline;
    return { viewportBottom: viewport.bottom, durationBottom: duration.bottom, rowCount: timeline.rowValues.length, rowHeight: timeline.options.rowHeight };
  });
  expect(geometry.rowCount).toBe(1);
  expect(geometry.durationBottom).toBeLessThanOrEqual(geometry.viewportBottom);
  expect(geometry.rowHeight).toBe(84);
});

test('a five-second block can be dragged exactly to 19:30:00', async ({ page }) => {
  await page.goto('/packages/task-timeline-component/e2e/fixture.html');
  await page.evaluate(() => {
    const now = Date.parse('2026-09-07T21:00:00Z');
    window.__calls = [];
    window.__timeline = ClockoliTaskTimeline.createTimeline(document.querySelector('#timeline'), {
      now,
      view: { start: Date.parse('2026-09-07T17:00:00Z'), end: now, focusedAt: now },
      rows: [{ id: 'one', title: 'One' }],
      items: [{ id: 'entry:five', url: 'https://example.com/five', title: 'Five seconds', startedAt: Date.parse('2026-09-07T18:47:58Z'), endedAt: Date.parse('2026-09-07T18:48:03Z'), rowId: 'one', isEditable: true }],
      onEditCommit(edit) { window.__calls.push(edit); return true; },
    });
  });
  const minimumTask = page.locator('#timeline .task[data-task-key="entry:five"]');
  await minimumTask.hover();
  const badgeGeometry = await minimumTask.evaluate(element => {
    const task = element.getBoundingClientRect();
    const start = element.querySelector('.edit-clock.start').getBoundingClientRect();
    const end = element.querySelector('.edit-clock.end').getBoundingClientRect();
    return { task: { left: task.left, right: task.right, width: task.width }, startRight: start.right, endLeft: end.left };
  });
  expect(badgeGeometry.task.width).toBeLessThanOrEqual(31);
  expect(badgeGeometry.startRight).toBeLessThanOrEqual(badgeGeometry.task.left);
  expect(badgeGeometry.endLeft).toBeGreaterThanOrEqual(badgeGeometry.task.right);
  const coordinates = await page.evaluate(() => {
    const timeline = window.__timeline.__timeline;
    const task = timeline.tasks[0];
    const element = timeline._taskElementByKey(task._key);
    const item = element.getBoundingClientRect();
    const viewport = timeline.viewport.getBoundingClientRect();
    const pointerX = item.left + item.width / 2;
    const pointerTime = timeline.xToTime(timeline._scrollLeftNow() + pointerX - viewport.left);
    const targetPointerTime = Date.parse('2026-09-07T19:30:00Z') + (pointerTime - task.start);
    return { x: pointerX, y: item.top + item.height / 2, targetX: viewport.left + timeline.timeToX(targetPointerTime) - timeline._scrollLeftNow() };
  });
  await page.mouse.move(coordinates.x, coordinates.y);
  await page.mouse.down();
  await page.mouse.move(coordinates.targetX, coordinates.y, { steps: 4 });
  await page.mouse.up();
  const edit = await expect.poll(() => page.evaluate(() => window.__calls.at(-1))).not.toBeUndefined();
  const result = await page.evaluate(() => window.__calls.at(-1));
  expect(result.startedAt).toBe(Date.parse('2026-09-07T19:30:00Z'));
  expect(result.endedAt - result.startedAt).toBe(5_000);
});

test('minimum-width boundary badges stay visible at both Timeline viewport edges', async ({ page }) => {
  const now = Date.parse('2026-09-08T21:00:00Z');
  // mount() reads Date.now(); pin it so the fixed items keep the same scale as real days pass.
  await page.clock.setFixedTime(now);
  await mount(page, { view: { start: now - 9 * 24 * HOUR, end: now, focusedAt: now - 4 * 24 * HOUR }, rows: [{ id: 'one', title: 'One' }], items: [
    { id: 'entry:first-edge', url: 'https://example.com/first', title: 'First', startedAt: now - 8 * 24 * HOUR, endedAt: now - 8 * 24 * HOUR + 5_000, rowId: 'one', isEditable: true },
    { id: 'entry:last-edge', url: 'https://example.com/last', title: 'Last', startedAt: now - 24 * HOUR, endedAt: now - 24 * HOUR + 5_000, rowId: 'one', isEditable: true },
  ] });
  const check = async (key, edge) => {
    const hoverPoint = await page.evaluate(({ key, edge }) => {
      const timeline = window.__timeline.__timeline;
      const element = timeline._taskElementByKey(key);
      const viewport = timeline.viewport.getBoundingClientRect();
      const task = element.getBoundingClientRect();
      const scroll = timeline._scrollLeftNow();
      const taskLeft = scroll + task.left - viewport.left;
      const taskRight = scroll + task.right - viewport.left;
      timeline._setScrollLeft(edge === 'start' ? taskLeft + 15 : taskRight - timeline.viewport.clientWidth - 15);
      timeline.viewport.dispatchEvent(new Event('scroll'));
      const visibleTask = timeline._taskElementByKey(key).getBoundingClientRect();
      const visibleViewport = timeline.viewport.getBoundingClientRect();
      return {
        x: Math.max(visibleViewport.left + 1, Math.min(visibleViewport.right - 1, visibleTask.left + visibleTask.width / 2)),
        y: visibleTask.top + visibleTask.height / 2,
      };
    }, { key, edge });
    // Hover at the exposed part of the clipped task: locator.hover() would
    // auto-scroll it and invalidate the edge geometry under test.
    await page.mouse.move(hoverPoint.x, hoverPoint.y);
    return page.evaluate(({ key, edge }) => {
      const timeline = window.__timeline.__timeline;
      const element = timeline._taskElementByKey(key);
      element.classList.add('editing');
      // Task blocks and the scroll viewport are siblings in the component shadow root.
      const viewportElement = element.getRootNode().querySelector('.viewport');
      const viewportRect = viewportElement.getBoundingClientRect();
      const viewport = { left: viewportRect.left, right: viewportRect.left + viewportElement.clientWidth };
      const badge = element.querySelector(`.edit-clock.${edge}`).getBoundingClientRect();
      const task = element.getBoundingClientRect();
      return { viewport: { left: viewport.left, right: viewport.right }, badge: { left: badge.left, right: badge.right, bottom: badge.bottom }, task: { left: task.left, right: task.right, top: task.top } };
    }, { key, edge });
  };
  const first = await check('entry:first-edge', 'start');
  expect(first.task.left).toBeLessThan(first.viewport.left);
  expect(first.task.right).toBeGreaterThan(first.viewport.left);
  expect(first.badge.left).toBeGreaterThanOrEqual(first.viewport.left);
  expect(first.badge.bottom).toBeLessThanOrEqual(first.task.top + 1);
  const last = await check('entry:last-edge', 'end');
  expect(last.task.left).toBeLessThan(last.viewport.right);
  expect(last.task.right).toBeGreaterThan(last.viewport.right);
  expect(last.badge.right).toBeLessThanOrEqual(last.viewport.right);
  expect(last.badge.bottom).toBeLessThanOrEqual(last.task.top + 1);
});

test('minimum-width badges paint above adjacent task blocks', async ({ page }) => {
  const now = Date.parse('2026-09-08T21:00:00Z');
  const start = now - 4 * 24 * HOUR;
  // mount() reads Date.now(); pin it so the four-day scale does not keep shrinking as real days pass.
  await page.clock.setFixedTime(now);
  await mount(page, { rows: [{ id: 'one', title: 'One' }, { id: 'two', title: 'Two' }], items: [
    { id: 'entry:before', url: 'https://example.com/before', title: 'Before', startedAt: start, endedAt: start + 5_000, rowId: 'one', isEditable: true },
    { id: 'entry:middle', url: 'https://example.com/middle', title: 'Middle', startedAt: start + 5_000, endedAt: start + 10_000, rowId: 'one', isEditable: true },
    { id: 'entry:after', url: 'https://example.com/after', title: 'After', startedAt: start + 10_000, endedAt: start + 15_000, rowId: 'one', isEditable: true },
    { id: 'entry:lower', url: 'https://example.com/lower', title: 'Lower', startedAt: start + 15_000, endedAt: start + 20_000, rowId: 'two', isEditable: true },
  ] });
  await page.locator('#timeline .task[data-task-key="entry:after"]').click();
  const middle = page.locator('#timeline .task[data-task-key="entry:middle"]');
  await middle.hover();
  const hoveredZ = await middle.evaluate(element => {
    // Adjacent minimum-width blocks can intercept the pointer at its center.
    // Test the hovered stacking state itself, regardless of hit-testing order.
    element.classList.add('hovered');
    return getComputedStyle(element).zIndex;
  });
  await page.mouse.move(0, 0);
  await middle.evaluate(element => {
    element.classList.add('editing');
    const parentRect = element.parentElement.getBoundingClientRect();
    const after = element.parentElement.querySelector('.task[data-task-key="entry:after"]');
    const lower = element.parentElement.querySelector('.task[data-task-key="entry:lower"]');
    const end = element.querySelector('.edit-clock.end').getBoundingClientRect();
    const duration = element.querySelector('.edit-clock.duration').getBoundingClientRect();
    after.style.transform = 'none';
    after.style.left = `${end.left + end.width / 2 - parentRect.left}px`;
    after.style.top = `${element.getBoundingClientRect().top - parentRect.top}px`;
    lower.style.transform = 'none';
    lower.style.left = `${duration.left + duration.width / 2 - parentRect.left}px`;
    lower.style.top = `${duration.top + duration.height / 2 - parentRect.top}px`;
  });
  const stacking = await middle.evaluate(element => {
    const before = element.parentElement.querySelector('.task[data-task-key="entry:before"]');
    const after = element.parentElement.querySelector('.task[data-task-key="entry:after"]');
    const lower = element.parentElement.querySelector('.task[data-task-key="entry:lower"]');
    const inspect = (selector, sibling) => {
      const badgeRect = element.querySelector(selector).getBoundingClientRect();
      const siblingRect = sibling.getBoundingClientRect();
      const left = Math.max(badgeRect.left, siblingRect.left);
      const right = Math.min(badgeRect.right, siblingRect.right);
      const top = Math.max(badgeRect.top, siblingRect.top);
      const bottom = Math.min(badgeRect.bottom, siblingRect.bottom);
      return { intersects: right > left && bottom > top };
    };
    return {
      start: inspect('.edit-clock.start', before),
      end: inspect('.edit-clock.end', after),
      duration: inspect('.edit-clock.duration', lower),
      middleZ: getComputedStyle(element).zIndex,
      selectedZ: getComputedStyle(after).zIndex,
    };
  });
  expect(stacking.start.intersects).toBe(true);
  expect(stacking.end.intersects).toBe(true);
  expect(stacking.duration.intersects).toBe(true);
  expect(Number(hoveredZ)).toBeGreaterThan(Number(stacking.selectedZ));
  expect(Number(stacking.middleZ)).toBeGreaterThan(Number(stacking.selectedZ));
});

test('Timeline shows a floating details card without the old connector line', async ({ page }) => {
  await mount(page);
  const task = page.locator('#timeline .task[data-task-key="entry:a"]');
  await task.hover();
  await expect(page.locator('#timeline .details')).toBeVisible();
  const result = await page.evaluate(() => {
    const root = document.querySelector('#timeline').shadowRoot;
    const task = root.querySelector('.task[data-task-key="entry:a"]').getBoundingClientRect();
    const pointer = root.querySelector('.details-pointer');
    const details = root.querySelector('.details').getBoundingClientRect();
    const viewport = root.querySelector('.viewport').getBoundingClientRect();
    return { pointerHidden: getComputedStyle(pointer).display === 'none',
      outsideChart: details.top >= viewport.bottom,
      centeredOnTask: Math.abs((details.left + details.right) / 2 - (task.left + task.right) / 2) < 2 };
  });
  expect(result).toEqual({ pointerHidden: true, outsideChart: true, centeredOnTask: true });
});

test('Timeline and Calendar keep week navigation in flow while task details float', async ({ page }) => {
  await mount(page, { weeklyCalendar: true });
  const placement = () => page.evaluate(() => {
    const root = document.querySelector('#timeline').shadowRoot;
    const details = root.querySelector('.details').getBoundingClientRect();
    const navigation = document.querySelector('#timeline .week-navigation').getBoundingClientRect();
    const meta = root.querySelector('.meta').getBoundingClientRect();
    const chart = root.querySelector('.viewport:not([hidden]), .calendar-view:not([hidden])').getBoundingClientRect();
    return { navigationBeforeChart: navigation.bottom <= meta.top && meta.bottom <= chart.top,
      detailsFloating: getComputedStyle(root.querySelector('.details')).position === 'fixed',
      detailsVisible: details.width > 0 && details.height > 0 };
  });
  await page.evaluate(() => {
    const navigation = document.createElement('div');
    navigation.className = 'week-navigation';
    navigation.slot = 'week-navigation';
    navigation.textContent = 'Week';
    document.querySelector('#timeline').append(navigation);
  });
  await page.evaluate(() => window.__timeline.setViewMode('calendar'));
  await page.locator('#timeline .calendar-task').first().click();
  await expect(page.locator('#timeline .details-title')).toBeVisible();
  expect(await placement()).toEqual({ navigationBeforeChart: true, detailsFloating: true, detailsVisible: true });
  await page.evaluate(() => window.__timeline.setViewMode('timeline'));
  await page.locator('#timeline .task').first().hover();
  expect(await placement()).toEqual({ navigationBeforeChart: true, detailsFloating: true, detailsVisible: true });
});

test('Calendar hover stays below day and project labels', async ({ page }) => {
  await mount(page);
  await page.evaluate(() => window.__timeline.setViewMode('calendar'));
  const task = page.locator('#timeline .calendar-task').first();
  await task.click();
  await task.hover();
  const layers = await page.evaluate(() => {
    const root = document.querySelector('#timeline').shadowRoot;
    return {
      task: Number(getComputedStyle(root.querySelector('.calendar-task:hover')).zIndex),
      project: Number(getComputedStyle(root.querySelector('.calendar-row-name')).zIndex),
      header: Number(getComputedStyle(root.querySelector('.calendar-sticky-header')).zIndex),
    };
  });
  expect(layers.task).toBeLessThan(layers.project);
  expect(layers.task).toBeLessThan(layers.header);
});

test('hover details hide after the pointer leaves and omit internal identifiers', async ({ page }) => {
  await mount(page);
  const task = page.locator('#timeline .task').first();
  await task.hover();
  const before = await page.locator('#timeline .details-info').textContent();
  expect(before).toContain('Start');
  expect(before).toContain('End');
  expect(before).toContain('Duration');
  expect(before).not.toContain('Instance:');
  expect(before).not.toContain('ID:');
  await page.locator('body').hover({ position: { x: 1, y: 1 } });
  await expect(page.locator('#timeline .details')).toBeHidden();
});

test('details actions always target the task currently shown', async ({ page }) => {
  await mount(page);
  const first = page.locator('#timeline .task').nth(0);
  const second = page.locator('#timeline .task').nth(1);
  await first.click();
  await second.hover();
  // Background renders (such as the debounced ResizeObserver render after mount) must not move details off the hovered task.
  await page.evaluate(() => window.__timeline.__timeline._renderAll({ invalidateRulerScales: false }));
  const state = await page.evaluate(() => {
    const timeline = window.__timeline.__timeline;
    return {
      detailsKey: timeline.detailsKey,
      actionKey: timeline.details.querySelector('.clockoli-timeline-actions')?.dataset.itemId,
      selectedKey: timeline.selectedKey,
    };
  });
  expect(state.detailsKey).toBe(state.actionKey);
  expect(state.detailsKey).not.toBe(state.selectedKey);
});

test('live tick cannot grow a running entry through the next interval', async ({ page }) => {
  const now = await mount(page, { scenario: 'future-after-running' });
  const before = await page.evaluate(() => window.__timeline.__timeline.getRunningTask().end);
  const accepted = await page.evaluate(nextNow => window.__timeline.update({ now: nextNow }), now + 6_000);
  expect(accepted).toBeFalsy();
  await expect.poll(() => page.evaluate(() => window.__calls)).toEqual([
    ['error', 'update', 'Clockoli timeline entries overlap: "active:c" and "future:d"'],
  ]);
  expect(await page.evaluate(() => window.__timeline.__timeline.getRunningTask().end)).toBe(before);
});

test('component timer itself clamps a running entry at the next interval', async ({ page }) => {
  await mount(page, { scenario: 'future-after-running' });
  const state = await page.evaluate(() => {
    const timeline = window.__timeline.__timeline;
    const running = timeline._runningTask();
    const next = timeline.tasks[timeline.tasks.indexOf(running) + 1];
    const widthBefore = timeline.totalWidth;
    timeline._updateRunningTaskIncremental(next.start + 5_000);
    const rulerEnd = Math.max(...timeline.rulerRow.querySelectorAll('.ruler-cell').values().map(node => Number(node.dataset.end)));
    return {
      runningEnd: running.end,
      nextStart: next.start,
      nextEnd: next.end,
      domainEnd: timeline.domainEnd,
      rulerEnd,
      widthBefore,
      widthAfter: timeline.totalWidth,
    };
  });
  expect(state.runningEnd).toBe(state.nextStart);
  expect(state.domainEnd).toBeGreaterThanOrEqual(state.nextEnd);
  expect(state.rulerEnd).toBe(state.domainEnd);
  expect(state.widthAfter).toBeGreaterThanOrEqual(state.widthBefore);
});

test('running timer does not move an explicitly selected historical Calendar week', async ({ page }) => {
  const now = await mount(page, { weeklyCalendar: true });
  const range = await page.evaluate(now => {
    const timeline = window.__timeline;
    timeline.setViewMode('calendar');
    const start = new Date(now);
    start.setDate(start.getDate() - 7);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    timeline.setCalendarRange({ start: start.getTime(), end: end.getTime() });
    timeline.__timeline._updateRunningTaskIncremental(now + 1_000);
    return { selected: timeline.getCalendarRange(), start: start.getTime(), end: end.getTime() };
  }, now);
  expect(range.selected).toMatchObject({ start: range.start, end: range.end });
});

test('overlapping reconcile preserves the prior tasks and callback source data', async ({ page }) => {
  await mount(page);
  const accepted = await page.evaluate(() => {
    const changed = window.__items.map(item => item.id === 'entry:a'
      ? { ...item, title: 'Corrupted title' }
      : item.id === 'entry:b'
        ? { ...item, startedAt: window.__items[0].startedAt + 1_000, endedAt: window.__items[0].endedAt - 1_000 }
        : item);
    return window.__timeline.update({ items: changed, now: Date.now() });
  });
  expect(accepted).toBeFalsy();
  await expect.poll(() => page.evaluate(() => window.__calls[0]?.[0])).toBe('error');
  await page.locator('#timeline .task[data-task-key="entry:a"]').click();
  await page.locator('#timeline .clockoli-timeline-action.primary').click();
  expect(await page.evaluate(() => window.__lastStartedTitle)).toBe('Task A');
});

test('rejects overlaps globally across rows', async ({ page }) => {
  await page.goto('/packages/task-timeline-component/e2e/fixture.html');
  const message = await page.evaluate(() => {
    const now = Date.now();
    try {
      ClockoliTaskTimeline.createTimeline(document.querySelector('#timeline'), {
        now,
        items: [
          { id: 'a', title: 'A', startedAt: now - 10_000, endedAt: now - 2_000, rowId: 'one' },
          { id: 'b', title: 'B', startedAt: now - 5_000, endedAt: now - 1_000, rowId: 'two' },
        ],
      });
      return '';
    } catch (error) { return error.message; }
  });
  expect(message).toBe('Clockoli timeline entries overlap: "a" and "b"');
});
