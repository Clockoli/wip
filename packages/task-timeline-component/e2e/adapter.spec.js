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
    window.__editSettlers = [];
    window.__items = items;
    window.__timeline = ClockoliTaskTimeline.createTimeline(document.querySelector('#timeline'), {
      items,
      rows: overrides.rows || [{ id: 'one', title: 'One' }, { id: 'two', title: 'Two' }],
      now,
      view: overrides.view || { start: now - 4 * hour, end: now, focusedAt: now - 2 * hour },
      weeklyCalendar: overrides.weeklyCalendar,
      onCalendarNavigate: overrides.trackCalendarNavigation ? range => window.__calls.push(['navigate', range.start, range.end]) : undefined,
      onStart(item) {
        window.__lastStartedTitle = item.title;
        window.__calls.push(['start', item.id]);
        return overrides.startResult !== false;
      },
      onStop(item) { window.__calls.push(['stop', item.id]); return overrides.stopResult !== false; },
      onDelete(item) {
        window.__calls.push(['delete', item.id]);
        if (overrides.deleteReject) return Promise.reject(new Error('delete failed'));
        return overrides.deleteResult !== false;
      },
      onEditCommit(edit) {
        window.__calls.push(['edit', edit.id, edit.kind]);
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

test('double-click switch invokes one Start and suppresses the component auto-Stop callback', async ({ page }) => {
  await mount(page);
  await page.evaluate(() => {
    const block = document.querySelector('#timeline').shadowRoot.querySelector('.task[data-task-key="entry:a"]');
    block.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true }));
  });
  await expect.poll(() => page.evaluate(() => window.__calls)).toEqual([['start', 'entry:a']]);
});

test('cancelled double-click Start restores the external running timer', async ({ page }) => {
  await mount(page, { startResult: false });
  await page.evaluate(() => {
    const block = document.querySelector('#timeline').shadowRoot.querySelector('.task[data-task-key="entry:a"]');
    block.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true }));
  });
  await expect.poll(() => page.evaluate(() => window.__timeline.__timeline.getRunningTask()?.instanceId)).toBe('active:c');
  expect(await page.evaluate(() => window.__calls)).toEqual([['start', 'entry:a']]);
});

test('cancelled Stop restores the running timer', async ({ page }) => {
  await mount(page, { stopResult: false });
  await page.evaluate(() => {
    const block = document.querySelector('#timeline').shadowRoot.querySelector('.task[data-task-key="active:c"]');
    block.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, composed: true }));
  });
  await expect.poll(() => page.evaluate(() => window.__timeline.__timeline.getRunningTask()?.instanceId)).toBe('active:c');
  expect(await page.evaluate(() => window.__calls)).toEqual([['stop', 'active:c']]);
});

test('keyboard edit keeps the Clockoli instance ID and pending deletion stays blocked', async ({ page }) => {
  await mount(page);
  await page.evaluate(() => document.querySelector('#timeline').shadowRoot.querySelector('.task[data-task-key="entry:a"]').click());
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => page.evaluate(() => window.__calls)).toEqual([['edit', 'entry:a', 'move']]);
  expect(await page.evaluate(() => window.__timeline.__timeline.getRunningTask()?.instanceId)).toBe('active:c');

  await page.evaluate(() => document.querySelector('#timeline').shadowRoot.querySelector('.task[data-task-key="entry:b"]').click());
  await page.keyboard.press('Delete');
  expect(await page.evaluate(() => window.__calls)).toEqual([['edit', 'entry:a', 'move']]);
  expect(await page.evaluate(() => Boolean(document.querySelector('#timeline').shadowRoot.querySelector('.task[data-task-key="entry:b"]')))).toBeTruthy();
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
  await page.evaluate(() => window.__timeline.__timeline._keyboardEditSelected('move', -120_000));
  await page.evaluate(() => window.__timeline.__timeline._keyboardEditSelected('move', -60_000));
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
  await page.evaluate(() => window.__timeline.__timeline._keyboardEditSelected('move', -60_000));
  await expect.poll(() => page.evaluate(() => window.__editSettlers.length)).toBe(1);
  await page.evaluate(() => window.__editSettlers.shift().resolve(false));
  await expect.poll(() => page.evaluate(() => window.__timeline.__timeline._findTask('entry:a').start)).toBe(original);
  expect(await page.evaluate(() => window.__timeline.__timeline.canUndo())).toBe(false);
  await page.evaluate(() => window.__timeline.__timeline._keyboardEditSelected('move', -60_000));
  await expect.poll(() => page.evaluate(() => window.__editSettlers.length)).toBe(1);
  await page.evaluate(() => window.__editSettlers.shift().reject(new Error('save failed')));
  await expect.poll(() => page.evaluate(() => window.__timeline.__timeline._findTask('entry:a').start)).toBe(original);
  expect(await page.evaluate(() => window.__timeline.__timeline.canUndo())).toBe(false);
});

test('consecutive rejected edits restore the last accepted interval', async ({ page }) => {
  await mount(page, { deferEdit: true });
  await page.locator('#timeline .task[data-task-key="entry:a"]').click();
  const original = await page.evaluate(() => window.__timeline.__timeline._findTask('entry:a').start);
  await page.evaluate(() => window.__timeline.__timeline._keyboardEditSelected('move', -120_000));
  await page.evaluate(() => window.__timeline.__timeline._keyboardEditSelected('move', -60_000));
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
  await page.evaluate(() => window.__timeline.__timeline._keyboardEditSelected('move', -120_000));
  await page.evaluate(() => window.__timeline.__timeline._keyboardEditSelected('move', -60_000));
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
  await page.evaluate(() => window.__timeline.__timeline._keyboardEditSelected('move', -60_000));
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
  await page.evaluate(() => window.__timeline.__timeline._keyboardEditSelected('move', -60_000));
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

test('pending entries stay editable and deletion remains blocked', async ({ page }) => {
  await mount(page);
  const block = page.locator('#timeline .task[data-task-key="entry:b"]');
  await block.click();
  await expect(block).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.evaluate(() => window.__calls)).toEqual([['edit', 'entry:b', 'move']]);
  await page.keyboard.press('Delete');
  await expect.poll(() => page.evaluate(() => window.__calls)).toEqual([['edit', 'entry:b', 'move']]);
  await expect(block.locator('.clockoli-entry-saving')).toHaveCount(0);
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
  const now = Date.now();
  await mount(page, { rows: [{ id: 'one', title: 'One' }], items: [
    { id: 'entry:tall-description', url: 'https://example.com/tall', title: 'Tall task', description: 'Calendar description', startedAt: now - 4 * HOUR, endedAt: now - 2 * HOUR, rowId: 'one', isEditable: true },
    { id: 'entry:short-description', url: 'https://example.com/short', title: 'Short task', description: 'Must not overflow', startedAt: now - HOUR, endedAt: now - HOUR + 5 * 60_000, rowId: 'one', isEditable: true },
  ] });
  await page.evaluate(() => window.__timeline.setViewMode('calendar'));
  // A task crossing local midnight has one Calendar segment per day; geometry
  // below is defined for its initial card, not the continuation card.
  const tall = page.locator('#timeline .calendar-task[data-task-key="entry:tall-description"]:not(.segment-continuation)');
  const short = page.locator('#timeline .calendar-task[data-task-key="entry:short-description"]:not(.segment-continuation)');
  await expect(tall.locator('.clockoli-calendar-description')).toHaveText('Calendar description');
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

test('running action updates in place without dropping keyboard focus', async ({ page }) => {
  await mount(page);
  await page.evaluate(() => {
    const root = document.querySelector('#timeline').shadowRoot;
    root.querySelector('.task[data-task-key="active:c"]').click();
  });
  const before = await page.evaluate(() => {
    const root = document.querySelector('#timeline').shadowRoot;
    const button = root.querySelector('.clockoli-timeline-action[data-started-at]');
    button.focus();
    window.__stopButton = button;
    return button.textContent;
  });
  await page.evaluate(() => window.__timeline.update({ now: Date.now() + 2_000 }));
  const after = await page.evaluate(() => ({
    same: window.__stopButton === document.querySelector('#timeline').shadowRoot.querySelector('.clockoli-timeline-action[data-started-at]'),
    focused: document.querySelector('#timeline').shadowRoot.activeElement === window.__stopButton,
    text: window.__stopButton.textContent,
  }));
  expect(after.same).toBeTruthy();
  expect(after.focused).toBeTruthy();
  expect(after.text).not.toBe(before);
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

test('Timeline hover and drag show only Start, End, and Duration badges in the requested positions', async ({ page }) => {
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
  const hoveredZ = await middle.evaluate(element => getComputedStyle(element).zIndex);
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

test('the Timeline details pointer connects the hovered block to the details panel', async ({ page }) => {
  await mount(page);
  const task = page.locator('#timeline .task[data-task-key="entry:a"]');
  await task.hover();
  await expect.poll(() => page.evaluate(() => {
    const root = document.querySelector('#timeline').shadowRoot;
    const task = root.querySelector('.task[data-task-key="entry:a"]').getBoundingClientRect();
    const pointer = root.querySelector('.details-pointer');
    const details = root.querySelector('.details').getBoundingClientRect();
    const rect = pointer.getBoundingClientRect();
    return { hidden: pointer.hidden, task, rect, details,
      aligned: rect.width === 1 && Math.abs((rect.left + rect.width / 2) - (task.left + task.width / 2)) < 1,
      startsAtTask: Math.abs(rect.top - task.bottom) < 1,
      reachesDetails: Math.abs(rect.bottom - details.top) < 1 };
  })).toMatchObject({ hidden: false, aligned: true, startsAtTask: true, reachesDetails: true });
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

test('task details stay visible after the pointer leaves and omit internal identifiers', async ({ page }) => {
  await mount(page);
  const task = page.locator('#timeline .task').first();
  await task.hover();
  const before = await page.evaluate(() => window.__timeline.__timeline.detailsInfo.textContent.trim());
  await page.locator('body').hover({ position: { x: 1, y: 1 } });
  const after = await page.evaluate(() => window.__timeline.__timeline.detailsInfo.textContent.trim());
  expect(after).toBe(before);
  expect(after).toContain('Start');
  expect(after).toContain('End');
  expect(after).toContain('Duration');
  expect(after).not.toContain('Instance:');
  expect(after).not.toContain('ID:');
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
