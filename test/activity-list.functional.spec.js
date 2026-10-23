import { test, expect, chromium } from '@playwright/test';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url);
const workerSource = `
const day = new Date(); day.setDate(day.getDate() - ((day.getDay() + 6) % 7) - 3);
const date = [day.getFullYear(), String(day.getMonth() + 1).padStart(2, '0'), String(day.getDate()).padStart(2, '0')].join('-');
const earlier = new Date(day); earlier.setDate(earlier.getDate() - 1);
const earlierDate = [earlier.getFullYear(), String(earlier.getMonth() + 1).padStart(2, '0'), String(earlier.getDate()).padStart(2, '0')].join('-');
const archived = new Date(day); archived.setDate(archived.getDate() - 21);
const archivedDate = [archived.getFullYear(), String(archived.getMonth() + 1).padStart(2, '0'), String(archived.getDate()).padStart(2, '0')].join('-');
const taskUrl = 'https://example.com/activity-test';
const recent = [{ id: 'record', taskUrl, taskTitle: 'Activity test task', entryDate: date,
  timezone: 'UTC', startedAt: date + 'T08:00:00Z', endedAt: date + 'T08:30:00Z',
  durationSeconds: 1800, description: '', _path: 'times/' + date.slice(0, 7) + '/alice.jsonl', _sha: 'fixture', _index: 0 },
  { id: 'same-day', taskUrl: 'https://example.com/same-day', taskTitle: 'Same day task', entryDate: date,
    timezone: 'UTC', startedAt: date + 'T07:00:00Z', endedAt: date + 'T07:30:00Z',
    durationSeconds: 1800, description: '', _path: 'times/' + date.slice(0, 7) + '/alice.jsonl', _sha: 'fixture', _index: 1 },
  { id: 'earlier', taskUrl: 'https://example.com/earlier', taskTitle: 'Earlier day task', entryDate: earlierDate,
    timezone: 'UTC', startedAt: earlierDate + 'T09:00:00Z', endedAt: earlierDate + 'T09:30:00Z',
    durationSeconds: 1800, description: '', _path: 'times/' + earlierDate.slice(0, 7) + '/alice.jsonl', _sha: 'fixture', _index: 2 }];
for (const entry of recent) entry.destinationId = 'github:1';
const history = [...recent, { id: 'archived', taskUrl: 'https://example.com/archived', taskTitle: 'Archived task', entryDate: archivedDate,
  timezone: 'UTC', startedAt: archivedDate + 'T09:00:00Z', endedAt: archivedDate + 'T10:00:00Z',
  durationSeconds: 3600, description: '', _path: 'times/' + archivedDate.slice(0, 7) + '/alice.jsonl', _sha: 'fixture', _index: 0 },
  ...Array.from({ length: 25 }, (_, index) => ({ id: 'paged-' + index, taskUrl: 'https://example.com/paged/' + index,
    taskTitle: 'Paged task ' + index, entryDate: archivedDate, timezone: 'UTC',
    startedAt: archivedDate + 'T08:00:00Z', endedAt: archivedDate + 'T08:30:00Z',
    durationSeconds: 1800, description: '', _path: 'times/' + archivedDate.slice(0, 7) + '/alice.jsonl', _sha: 'fixture', _index: index + 1 }))];
let active = null;
let pendingWrites = [];
let locallyStopped = [];
globalThis.trackingMessages = [];
globalThis.editPayloads = [];
globalThis.failEdit = false;
globalThis.activeEditPayloads = [];
globalThis.deferActiveEdit = false;
globalThis.pendingActiveEditRespond = null;
globalThis.includeOverlap = false;
globalThis.searchMode = 'ok';
let viewMode = 'timeline';
globalThis.bulkAddFailure = false;
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  globalThis.trackingMessages.push(message.type);
  const state = () => ({ configured: true, active, recent: [...locallyStopped, ...recent,
    ...(globalThis.includeOverlap ? [
      { ...recent[0], id: 'overlap-a', taskTitle: 'Conflicting task A',
        startedAt: date + 'T12:15:00Z', endedAt: date + 'T12:45:00Z' },
      { ...recent[0], id: 'overlap-b', taskTitle: 'Conflicting task B',
        startedAt: date + 'T12:30:00Z', endedAt: date + 'T13:00:00Z' },
    ] : [])],
    pendingWrites, pendingCount: pendingWrites.length });
  if (message.type === 'LOAD_TIMES' || message.type === 'LOAD_WEEK' || message.type === 'LOAD_RECENT') respond({ ok: true, data: state() });
  else if (message.type === 'SEARCH_ACTIVITY') {
    if (globalThis.searchMode === 'error') respond({ ok: false, error: { message: 'History unavailable' } });
    else respond({ ok: true, data: { ...state(), recent: history, partial: globalThis.searchMode === 'partial' } });
  }
  else if (message.type === 'GET_PAGE_STATE') respond({ ok: true, data: state() });
  else if (message.type === 'GET_ACTIVITY_VIEW_MODE') respond({ ok: true, data: { mode: viewMode } });
  else if (message.type === 'SET_ACTIVITY_VIEW_MODE') { viewMode = message.mode; respond({ ok: true, data: { mode: viewMode } }); }
  else if (message.type === 'QUEUE_ENTRY_EDIT') {
    globalThis.editPayloads.push(message.payload);
    if (globalThis.failEdit) { respond({ ok: false, error: { message: 'This edit would overlap another entry. Choose a free time range before moving it.' } }); return; }
    for (const entry of recent) if (entry.id === message.payload.original.id) Object.assign(entry, message.payload.edits);
    respond({ ok: true, data: { operationId: 'edit-' + globalThis.editPayloads.length, pending: true } });
  }
  else if (message.type === 'BULK_ADD_TIMES') respond(globalThis.bulkAddFailure
    ? { ok: false, error: { message: 'Line 1: Invalid time entry' } }
    : { ok: true, data: { added: 4 } });
  else if (message.type === 'QUEUE_ENTRIES_EDIT') {
    for (const edit of message.payload.entries) {
      const target = recent.find(item => item.id === edit.original.id);
      if (target) Object.assign(target, edit.edits);
    }
    respond({ ok: true, data: { operationId: 'local-description-edit' } });
  }
  else if (message.type === 'QUEUE_ACTIVE_START_EDIT') {
    globalThis.activeEditPayloads.push(message.payload);
    if (!active || active.id !== message.payload.original.id) {
      respond({ ok: false, error: { message: 'No matching running timer' } });
    } else if (globalThis.deferActiveEdit) {
      globalThis.pendingActiveEditRespond = respond;
      return true;
    } else {
      active = { ...active, ...('startedAt' in message.payload ? { startedAt: message.payload.startedAt } : {}),
        ...('description' in message.payload ? { description: message.payload.description } : {}) };
      respond({ ok: true, data: { operationId: 'local-running-description' } });
    }
  }
  else if (message.type === 'START') {
    active = { id: 'quick-running', taskUrl: message.taskUrl, taskTitle: message.taskTitle,
      startedAt: new Date(Date.now() - 120000).toISOString(),
      entryDate: new Date().toISOString().slice(0, 10), timezone: 'UTC' };
    respond({ ok: true, data: { ...active, _pending: true, destinationId: 'github:1' } });
  }
  else if (message.type === 'SWITCH_TASK') {
    active = { id: 'running', taskUrl: message.taskUrl, taskTitle: message.taskTitle,
      startedAt: new Date().toISOString(), entryDate: new Date().toISOString().slice(0, 10), timezone: 'UTC' };
    respond({ ok: true, data: { active, pending: false } });
  } else if (message.type === 'STOP') {
    const completed = { ...active, description: message.description ?? active.description ?? '',
      endedAt: new Date().toISOString(), durationSeconds: 120 };
    active = null;
    const localEntry = { ...completed, _path: 'times/' + completed.entryDate.slice(0, 7) + '/alice.jsonl',
      _sha: null, _index: -1, _pending: true, destinationId: 'github:1' };
    locallyStopped = [localEntry, ...locallyStopped];
    pendingWrites = [{ operation: 'completeTimer', id: completed.id, stage: 'verifyActive', status: 'pending', queuedAt: new Date().toISOString() }];
    respond({ ok: true, data: { entry: completed, localEntry, pending: true, destinationId: 'github:1' } });
  } else respond({ ok: false, error: { message: 'Unexpected test request: ' + message.type } });
});
`;

test('Activity calendar metrics and view switcher fit the desktop and mobile layouts', async () => {
  test.setTimeout(30000);
  const extension = await mkdtemp(join(tmpdir(), 'clockoli-activity-layout-extension-'));
  const profile = await mkdtemp(join(tmpdir(), 'clockoli-activity-layout-profile-'));
  let context;
  try {
    await cp(new URL('src/', ROOT), join(extension, 'src'), { recursive: true });
    const rendererPath = join(extension, 'src/content/github.js');
    await writeFile(rendererPath, (await readFile(rendererPath, 'utf8')).replaceAll("mode: 'closed'", "mode: 'open'"));
    const manifest = JSON.parse(await readFile(new URL('manifest.json', ROOT), 'utf8'));
    manifest.background = { service_worker: 'test-worker.js' };
    await writeFile(join(extension, 'manifest.json'), `${JSON.stringify(manifest)}\n`);
    await writeFile(join(extension, 'test-worker.js'), workerSource
      .replace(' - 3);', ' + 1);')
      .replace("let viewMode = 'timeline';", "let viewMode = 'calendar';")
      .replace("respond({ ok: true, data: state() });\n  else if (message.type === 'SEARCH_ACTIVITY')",
        "respond({ ok: true, data: message.type === 'LOAD_TIMES' ? { configured: true, recent: state().recent } : state() });\n  else if (message.type === 'SEARCH_ACTIVITY')")
      .replace('pendingWrites, pendingCount: pendingWrites.length });',
        'pendingWrites, pendingCount: pendingWrites.length, todayTrackedMs: 7 * 3600000 + 11 * 60000 });'));
    context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    worker.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.setViewportSize({ width: 1774, height: 900 });
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/src/times/times.html`);
    const root = page.locator('#clockoli-times-root');
    const summary = page.locator('#activity-summary');
    const switcher = page.locator('#activity-view-switcher');
    await expect(root.locator('.calendar-day-header')).toHaveCount(7);
    await expect(summary.locator('.activity-weekly-card')).toHaveCount(3);
    await expect(summary).not.toContainText('Daily average');
    await expect(summary.locator('.activity-weekly-heading')).toContainText(/\w+ \d+–\d+/);
    await expect(summary.locator('.activity-weekly-label')).toBeHidden();
    await expect(root.locator('.week-navigation-label')).toBeHidden();
    await expect(root.locator('.times-list-total')).toBeHidden();
    await expect(switcher.getByRole('group', { name: 'Activity view' })).toBeVisible();
    await expect(summary.locator('.activity-weekly-card').first()).toContainText('Today');
    await expect(summary.locator('[data-tracked-total="todayTrackedMs"]')).toHaveText('7h 11m');
    await page.reload();
    await expect(summary.locator('[data-tracked-total="todayTrackedMs"]')).toHaveText('7h 11m');
    await root.getByRole('button', { name: 'Previous week' }).click();
    await root.getByRole('button', { name: 'Next week' }).click();
    await expect(summary.locator('[data-tracked-total="todayTrackedMs"]')).toHaveText('7h 11m');
    await switcher.getByRole('button', { name: 'List' }).click();
    const search = root.getByRole('searchbox', { name: 'Search activity' });
    await expect(search).toBeVisible();
    await expect(root.getByText('Search activity', { exact: true })).toHaveCount(0);
    await expect(search).toHaveCSS('margin-top', '0px');
    await expect(root.getByText('Tracked time', { exact: true })).toHaveCount(0);
    await expect(root.locator('.week-navigation-label')).toHaveText(await summary.locator('.activity-weekly-range').innerText());
    await expect(root.locator('.times-list-total')).toBeHidden();
    await search.fill('Activity test task');
    await expect(search).toHaveValue('Activity test task');
    await search.fill('');
    await switcher.getByRole('button', { name: 'Calendar' }).click();
    const github = await context.newPage();
    github.on('pageerror', error => errors.push(error.message));
    await github.setViewportSize({ width: 1774, height: 900 });
    await github.route('https://github.com/acme/app/issues/42', route => route.fulfill({
      status: 200, contentType: 'text/html',
      body: '<!doctype html><html><body><header><div class="AppHeader-actions"><img class="avatar" alt="User"></div></header><main><h1>Test issue</h1></main></body></html>',
    }));
    await github.goto('https://github.com/acme/app/issues/42');
    await github.locator('#clockoli-root .trigger-main').click();
    const panel = github.locator('#clockoli-full-width-popup-root');
    await expect(panel.locator('.popup-overview-layout .activity-weekly-card')).toHaveCount(3);
    await expect(panel.locator('.popup-overview-layout .strip-idle')).toHaveText('Not tracking');
    await expect(panel.locator('.active-task-strip .running-status-recent-task')).toHaveCount(3);
    await expect(panel.locator('.tracker-toolbar .popup-switch-action .popup-timeline-track')).toHaveText('Track this task');
    await expect(panel.locator('.timeline-toolbar-end .timeline-view-button')).toHaveCount(3);
    await expect(panel.locator('.menu-body > .timeline-view-modes')).toHaveCount(0);
    const idleOverview = await panel.locator('.full-width-popup').evaluate(popup => {
      const summary = popup.querySelector('.popup-overview-layout .activity-weekly-summary').getBoundingClientRect();
      const card = popup.querySelector('.active-task-strip').getBoundingClientRect();
      return { summaryTop: summary.top, summaryRight: summary.right, summaryHeight: summary.height,
        cardTop: card.top, cardLeft: card.left, cardHeight: card.height, cardWidth: card.width,
        scrollWidth: popup.scrollWidth, clientWidth: popup.clientWidth };
    });
    const activitySummary = await summary.boundingBox();
    const activityCard = await page.locator('#activity-running-status .running-status-row').boundingBox();
    expect(Math.abs(idleOverview.summaryTop - idleOverview.cardTop)).toBeLessThan(2);
    expect(idleOverview.summaryRight).toBeLessThan(idleOverview.cardLeft);
    expect(idleOverview.cardHeight).toBeGreaterThanOrEqual(idleOverview.summaryHeight - 2);
    expect(idleOverview.cardWidth).toBeGreaterThan(600);
    expect(idleOverview.summaryHeight).toBeLessThanOrEqual(activitySummary.height + 20);
    expect(idleOverview.cardHeight).toBeLessThanOrEqual(activityCard.height + 20);
    expect(idleOverview.scrollWidth).toBeLessThanOrEqual(idleOverview.clientWidth);
    const quickStartLabels = await panel.locator('.running-status-recent-task').allTextContents();
    await panel.getByRole('button', { name: 'Previous week' }).click();
    await panel.getByRole('button', { name: 'Next week' }).click();
    await expect(panel.locator('.running-status-recent-task')).toHaveText(quickStartLabels);
    if (process.env.CLOCKOLI_PANEL_SCREENSHOT) await github.screenshot({ path: process.env.CLOCKOLI_PANEL_SCREENSHOT });
    const panelEntry = panel.locator('.calendar-task[data-task-key="entry:record"]');
    await panelEntry.hover();
    const panelDetails = panel.locator('.task-timeline-host .details');
    await expect(panelDetails).toBeVisible();
    await expect(panelDetails).toHaveClass(/clockoli-compact-entry-details/);
    await expect(panelDetails.locator('.clockoli-details-task-icon')).toBeVisible();
    await expect(panelDetails.locator('.details-value').first()).toBeHidden();
    const panelSkin = await panelDetails.evaluate(node => ({
      background: getComputedStyle(node).backgroundColor,
      radius: getComputedStyle(node).borderRadius,
      width: node.getBoundingClientRect().width,
    }));
    const panelBounds = await panelDetails.evaluate(card => ({
      card: card.getBoundingClientRect().toJSON(),
      popup: card.getRootNode().host.getRootNode().querySelector('.full-width-popup').getBoundingClientRect().toJSON(),
    }));
    expect(panelBounds.card.top).toBeGreaterThanOrEqual(panelBounds.popup.top);
    expect(panelBounds.card.bottom).toBeLessThanOrEqual(panelBounds.popup.bottom);
    await panel.locator('.calendar-task[data-task-key="entry:same-day"]').hover();
    await expect(panelDetails).toContainText('Same day task');
    const sidePlacement = await panelDetails.evaluate(card => {
      const anchor = card.getRootNode().querySelector('.calendar-task[data-task-key="entry:same-day"]').getBoundingClientRect();
      const below = card.getRootNode().querySelector('.calendar-task[data-task-key="entry:record"]').getBoundingClientRect();
      const rect = card.getBoundingClientRect();
      return { beside: rect.left >= anchor.right + 8 || rect.right <= anchor.left - 8,
        coversNext: rect.top < below.bottom && rect.bottom > below.top && rect.left < below.right && rect.right > below.left };
    });
    expect(sidePlacement).toEqual({ beside: true, coversNext: false });
    await panelDetails.getByRole('button', { name: 'Edit' }).hover();
    await expect(panelDetails).toContainText('Same day task');
    await panelDetails.getByRole('button', { name: 'Edit' }).click();
    const editDialog = github.locator('.add-time-dialog');
    await expect(editDialog).toBeVisible();
    await expect(editDialog.locator('#add-time-task')).toHaveValue('Same day task');
    await editDialog.getByRole('button', { name: 'Close Edit time' }).click();
    await expect(editDialog).toBeHidden();
    await expect(panel.locator('.full-width-popup')).toBeVisible();
    await panelEntry.hover();
    await panelDetails.getByRole('button', { name: 'Edit' }).click();
    await expect(editDialog).toBeVisible();
    await expect(editDialog.locator('#add-time-task')).toBeFocused();
    await github.keyboard.press('Escape');
    await expect(editDialog).toBeHidden();
    await expect(panel.locator('.full-width-popup')).toBeVisible();
    await panelEntry.hover();
    await panelDetails.getByRole('button', { name: 'Edit' }).click();
    await expect(editDialog).toBeVisible();
    await editDialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(editDialog).toBeHidden();
    await expect(panel.locator('.full-width-popup')).toBeVisible();
    await github.setViewportSize({ width: 600, height: 500 });
    await panelEntry.hover();
    const constrained = await panelDetails.evaluate(card => ({
      card: card.getBoundingClientRect().toJSON(),
      popup: card.getRootNode().host.getRootNode().querySelector('.full-width-popup').getBoundingClientRect().toJSON(),
    }));
    expect(constrained.card.left).toBeGreaterThanOrEqual(constrained.popup.left);
    expect(constrained.card.right).toBeLessThanOrEqual(constrained.popup.right);
    expect(constrained.card.top).toBeGreaterThanOrEqual(constrained.popup.top);
    expect(constrained.card.bottom).toBeLessThanOrEqual(constrained.popup.bottom);
    await github.close();
    await expect(root.locator('.calendar-task[data-task-key="entry:record"]')).toBeVisible();
    const calendarRecord = root.locator('.calendar-task[data-task-key="entry:record"]');
    await calendarRecord.hover();
    const details = root.locator('.task-timeline-host .details');
    await expect(details).toBeVisible();
    await expect(details).toHaveClass(/clockoli-compact-entry-details/);
    const activitySkin = await details.evaluate(node => ({
      background: getComputedStyle(node).backgroundColor,
      radius: getComputedStyle(node).borderRadius,
      width: node.getBoundingClientRect().width,
    }));
    expect(panelSkin).toEqual(activitySkin);
    await expect(details.locator('.clockoli-details-task-icon')).toBeVisible();
    await expect(details.locator('.clockoli-details-time')).toContainText(/\d{2}:\d{2} – \d{2}:\d{2} · 30m/);
    await expect(details.locator('.details-value')).toHaveCount(3);
    await expect(details.locator('.details-value').first()).toBeHidden();
    await expect(details.getByRole('button', { name: 'Delete' })).toBeVisible();
    await expect(details.getByRole('button', { name: 'Edit' })).toBeVisible();
    const activityPlacement = await details.evaluate(card => {
      const rect = card.getBoundingClientRect();
      const anchor = card.getRootNode().querySelector('.calendar-task[data-task-key="entry:record"]').getBoundingClientRect();
      return rect.left >= anchor.right + 8 || rect.right <= anchor.left - 8;
    });
    expect(activityPlacement).toBe(true);
    const approach = await details.evaluate(card => {
      const anchor = card.getRootNode().querySelector('.calendar-task[data-task-key="entry:record"]').getBoundingClientRect();
      const panel = card.getBoundingClientRect();
      if (panel.left >= anchor.right || panel.right <= anchor.left) {
        return { x: panel.left >= anchor.right ? (anchor.right + panel.left) / 2 : (anchor.left + panel.right) / 2,
          y: Math.max(panel.top + 8, Math.min(anchor.top + anchor.height / 2, panel.bottom - 8)) };
      }
      return { x: Math.max(panel.left + 8, Math.min(anchor.left + anchor.width / 2, panel.right - 8)),
        y: panel.top >= anchor.bottom ? (anchor.bottom + panel.top) / 2 : (panel.bottom + anchor.top) / 2 };
    });
    await page.mouse.move(approach.x, approach.y);
    await page.waitForTimeout(350);
    await expect(details).toBeVisible();
    await details.getByRole('button', { name: 'Edit' }).hover();
    await expect(details).toBeVisible();
    await calendarRecord.hover();
    if (process.env.CLOCKOLI_ACTIVITY_TOOLTIP_SCREENSHOT) {
      await page.screenshot({ path: process.env.CLOCKOLI_ACTIVITY_TOOLTIP_SCREENSHOT });
    }
    await switcher.getByRole('button', { name: 'Timeline', exact: true }).click();
    const timelineRecord = root.locator('.task[data-task-key="entry:record"]').first();
    await timelineRecord.hover();
    await expect(details).toBeVisible();
    await expect(details).toHaveClass(/clockoli-compact-entry-details/);
    await expect(details.locator('.clockoli-details-task-icon')).toBeVisible();
    await expect(details.locator('.clockoli-details-time')).toContainText(/\d{2}:\d{2} – \d{2}:\d{2} · 30m/);
    await expect(details.locator('.details-value').first()).toBeHidden();
    await expect(details.getByRole('button', { name: 'Delete' })).toBeVisible();
    await expect(details.getByRole('button', { name: 'Edit' })).toBeVisible();
    await expect(details.getByRole('button', { name: 'Track time' })).toBeVisible();
    if (process.env.CLOCKOLI_ACTIVITY_TIMELINE_TOOLTIP_SCREENSHOT) {
      await page.screenshot({ path: process.env.CLOCKOLI_ACTIVITY_TIMELINE_TOOLTIP_SCREENSHOT });
    }
    await switcher.getByRole('button', { name: 'Calendar', exact: true }).click();
    await expect(switcher.getByRole('button', { name: 'Calendar', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(summary.locator('[data-stat="total"]')).not.toHaveText('—');
    expect(await page.locator('#activity-running-status .running-status-row').evaluate(row => row.getBoundingClientRect().height)).toBeGreaterThanOrEqual(84);
    const geometry = () => page.evaluate(() => {
      const section = document.querySelector('#activity-summary');
      const cards = [...section.querySelectorAll('.activity-weekly-card')].map(el => el.getBoundingClientRect());
      const tracking = document.querySelector('#activity-running-status .running-status-row').getBoundingClientRect();
      const stats = section.getBoundingClientRect();
      const theme = document.querySelector('.page-theme-toggle').getBoundingClientRect();
      const tabs = document.querySelector('#activity-view-switcher').getBoundingClientRect();
      return { stackedCards: cards.every((rect, index) => !index || rect.top > cards[index - 1].top),
        stats: { top: stats.top, right: stats.right, width: stats.width },
        tracking: { top: tracking.top, left: tracking.left, width: tracking.width },
        tabs: { top: tabs.top, height: tabs.height, right: tabs.right }, theme: { top: theme.top, height: theme.height, left: theme.left },
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth };
    });
    const desktop = await geometry();
    expect(desktop.stackedCards).toBe(true);
    expect(desktop.stats.top).toBe(desktop.tracking.top);
    expect(desktop.stats.right).toBeLessThan(desktop.tracking.left);
    expect(desktop.tracking.width / desktop.stats.width).toBeCloseTo(7, 0);
    expect(Math.abs(desktop.tabs.top + desktop.tabs.height / 2 - desktop.theme.top - desktop.theme.height / 2)).toBeLessThanOrEqual(1);
    expect(desktop.tabs.right).toBeLessThan(desktop.theme.left);
    expect(desktop.horizontalOverflow).toBe(false);
    if (process.env.CLOCKOLI_ACTIVITY_SCREENSHOT) await page.screenshot({ path: process.env.CLOCKOLI_ACTIVITY_SCREENSHOT });
    const lightPanel = await details.evaluate(node => getComputedStyle(node).backgroundColor);
    await page.locator('.page-theme-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-clockoli-theme', 'dark');
    await calendarRecord.hover();
    await expect(details).toBeVisible();
    const darkPanel = await details.evaluate(node => getComputedStyle(node).backgroundColor);
    expect(darkPanel).not.toBe(lightPanel);
    await expect(details.getByRole('button', { name: 'Track time' })).toBeVisible();
    if (process.env.CLOCKOLI_ACTIVITY_DARK_TOOLTIP_SCREENSHOT) {
      await page.screenshot({ path: process.env.CLOCKOLI_ACTIVITY_DARK_TOOLTIP_SCREENSHOT });
    }
    await switcher.getByRole('button', { name: 'Timeline', exact: true }).click();
    await timelineRecord.hover();
    await expect(details).toBeVisible();
    expect(await details.evaluate(node => getComputedStyle(node).backgroundColor)).toBe(darkPanel);
    await switcher.getByRole('button', { name: 'Calendar', exact: true }).click();
    for (const width of [1280, 1024, 901]) {
      await page.setViewportSize({ width, height: 900 });
      const intermediate = await geometry();
      expect(intermediate.stats.right).toBeLessThan(intermediate.tracking.left);
      expect(intermediate.stats.width).toBeGreaterThanOrEqual(190);
      expect(intermediate.horizontalOverflow).toBe(false);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(summary.locator('.activity-weekly-card')).toHaveCount(3);
    const mobileCards = await summary.locator('.activity-weekly-card').evaluateAll(cards => cards.map(card => {
      const rect = card.getBoundingClientRect();
      return { top: rect.top, right: rect.right };
    }));
    expect(new Set(mobileCards.map(card => card.top)).size).toBe(3);
    const mobile = await geometry();
    expect(mobile.stats.top).toBeLessThan(mobile.tracking.top);
    expect(mobile.tabs.right).toBeLessThan(mobile.theme.left);
    expect(mobile.horizontalOverflow).toBe(false);
    if (process.env.CLOCKOLI_ACTIVITY_MOBILE_SCREENSHOT) await page.screenshot({ path: process.env.CLOCKOLI_ACTIVITY_MOBILE_SCREENSHOT });
    await switcher.getByRole('button', { name: 'Timeline', exact: true }).click();
    await timelineRecord.hover();
    await expect(details).toBeVisible();
    const mobilePopover = await details.evaluate(node => {
      const rect = node.getBoundingClientRect();
      return { left: rect.left, right: rect.right };
    });
    expect(mobilePopover.left).toBeGreaterThanOrEqual(0);
    expect(mobilePopover.right).toBeLessThanOrEqual(390);
    await expect(details.getByRole('button', { name: 'Track time' })).toBeVisible();
    await expect(summary.locator('.activity-weekly-card')).toHaveCount(3);
    await expect(summary.locator('[data-tracked-total="todayTrackedMs"]')).toHaveText('7h 11m');
    await switcher.getByRole('button', { name: 'List', exact: true }).click();
    await expect(summary.locator('.activity-weekly-card')).toHaveCount(3);
    await expect(summary.locator('[data-tracked-total="todayTrackedMs"]')).toHaveCount(1);
    await expect(root.locator('.today-list-totals')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const quickStartPage = await context.newPage();
    quickStartPage.on('pageerror', error => errors.push(error.message));
    await quickStartPage.route('https://github.com/acme/app/issues/42', route => route.fulfill({
      status: 200, contentType: 'text/html',
      body: '<!doctype html><html><body><header><div class="AppHeader-actions"><img class="avatar" alt="User"></div></header><main><h1>Test issue</h1></main></body></html>',
    }));
    await quickStartPage.goto('https://github.com/acme/app/issues/42');
    await quickStartPage.locator('#clockoli-root .trigger-main').click();
    const githubPanel = quickStartPage.locator('#clockoli-full-width-popup-root');
    const panelSummary = githubPanel.locator('.popup-overview-layout .activity-weekly-summary');
    await expect(panelSummary.locator('.activity-weekly-range')).toHaveText(await summary.locator('.activity-weekly-range').innerText());
    await expect(githubPanel.locator('.tracker-toolbar .activity-weekly-summary')).toHaveCount(0);
    await expect(githubPanel.locator('.strip-idle-caption')).toHaveText('Start a task to begin');
    for (const mode of ['Timeline', 'Calendar']) {
      await githubPanel.getByRole('button', { name: mode, exact: true }).click();
      const shell = githubPanel.locator('.popup-timeline-section .timeline-shell');
      const nav = shell.locator(':scope > .week-navigation');
      await expect(nav).toBeVisible();
      await expect(nav.locator('.week-navigation-label')).toBeHidden();
      const [shellBox, navBox] = await Promise.all([shell.boundingBox(), nav.boundingBox()]);
      expect(Math.abs(shellBox.y - navBox.y)).toBeLessThan(2);
      expect(await nav.evaluate(node => getComputedStyle(node, '::before').backgroundImage)).toContain('gradient');
      await nav.getByRole('button', { name: 'Previous week' }).click();
      await nav.getByRole('button', { name: 'Next week' }).click();
    }
    await githubPanel.getByRole('button', { name: 'List', exact: true }).click();
    const panelToolbar = githubPanel.locator('.popup-list-toolbar');
    const localSearch = panelToolbar.getByRole('searchbox', { name: 'Search current week' });
    await expect(panelToolbar.locator('.week-navigation-label')).toHaveText(await panelSummary.locator('.activity-weekly-range').innerText());
    await expect(panelToolbar.getByRole('button', { name: 'Refresh' })).toBeVisible();
    const listControls = await panelToolbar.evaluate(toolbar => {
      const bounds = selector => toolbar.querySelector(selector).getBoundingClientRect();
      const previous = bounds('.week-navigation-button:first-child');
      const label = bounds('.week-navigation-label');
      const next = bounds('.week-navigation-button:last-child');
      return { searchRight: bounds('.times-filter').right, navigationLeft: bounds('.week-navigation').left,
        navigationRight: bounds('.week-navigation').right, refreshLeft: bounds('.times-refresh').left,
        previousWidth: previous.width, previousHeight: previous.height,
        previousGap: label.left - previous.right, nextGap: next.left - label.right,
        nextWidth: next.width, nextHeight: next.height };
    });
    expect(listControls.searchRight).toBeLessThan(listControls.navigationLeft);
    expect(listControls.navigationRight).toBeLessThan(listControls.refreshLeft);
    expect(listControls.previousWidth).toBe(46);
    expect(listControls.previousHeight).toBe(50);
    expect(listControls.nextWidth).toBe(46);
    expect(listControls.nextHeight).toBe(50);
    expect(listControls.previousGap).toBe(12);
    expect(listControls.nextGap).toBe(12);
    await quickStartPage.setViewportSize({ width: 420, height: 720 });
    const narrowControls = await panelToolbar.evaluate(toolbar => {
      const nav = toolbar.querySelector('.week-navigation').getBoundingClientRect();
      const refresh = toolbar.querySelector('.times-refresh').getBoundingClientRect();
      return { navRight: nav.right, refreshLeft: refresh.left, refreshRight: refresh.right,
        navMid: nav.top + nav.height / 2, refreshMid: refresh.top + refresh.height / 2,
        overflow: toolbar.closest('.full-width-popup').scrollWidth - toolbar.closest('.full-width-popup').clientWidth };
    });
    expect(narrowControls.navRight).toBeLessThan(narrowControls.refreshLeft);
    expect(narrowControls.refreshRight).toBeLessThanOrEqual(420);
    expect(Math.abs(narrowControls.navMid - narrowControls.refreshMid)).toBeLessThan(2);
    expect(narrowControls.overflow).toBeLessThanOrEqual(1);
    await quickStartPage.setViewportSize({ width: 1774, height: 900 });
    await expect(githubPanel.locator('.popup-list-total')).toBeHidden();
    await expect(githubPanel.locator('.today-list .section-head')).toHaveCount(0);
    await expect(githubPanel.locator('.today-list .entry-record').first()).toHaveCSS('border-top-left-radius', '10px');
    await localSearch.fill('Earlier day task');
    await expect(githubPanel.locator('.today-list .entry-record')).toHaveCount(1);
    await localSearch.fill('Archived task');
    await expect(githubPanel.locator('.today-list')).toContainText('No entries match this week.');
    expect(await worker.evaluate(() => globalThis.trackingMessages.includes('SEARCH_ACTIVITY'))).toBe(false);
    await localSearch.fill('');
    await githubPanel.getByRole('button', { name: 'Timeline', exact: true }).click();
    const recentTask = quickStartPage.locator('#clockoli-full-width-popup-root .running-status-recent-task');
    await expect(recentTask).toHaveCount(3);
    const toolbar = await context.newPage();
    toolbar.on('pageerror', error => errors.push(error.message));
    await toolbar.goto(`chrome-extension://${new URL(worker.url()).host}/src/popup/popup.html`);
    const toolbarRoot = toolbar.locator('#clockoli-popup-root');
    await expect(toolbarRoot.locator('.popup-overview-layout .activity-weekly-card')).toHaveCount(3);
    await expect(toolbarRoot.locator('.tracker-toolbar .popup-switch-action .popup-timeline-track')).toBeVisible();
    await expect(toolbarRoot.locator('.running-status-recent-task')).toHaveCount(3);
    await toolbarRoot.locator('.running-status-recent-task').first().click();
    await expect.poll(() => worker.evaluate(() => globalThis.trackingMessages.filter(type => type === 'SWITCH_TASK').length)).toBe(1);
    await expect(toolbarRoot.locator('.active-task-strip.is-active')).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await context?.close();
    await rm(extension, { recursive: true, force: true });
    await rm(profile, { recursive: true, force: true });
  }
});

async function withActivityWorker(source, run) {
  const extension = await mkdtemp(join(tmpdir(), 'clockoli-review-extension-'));
  const profile = await mkdtemp(join(tmpdir(), 'clockoli-review-profile-'));
  let context;
  try {
    await cp(new URL('src/', ROOT), join(extension, 'src'), { recursive: true });
    const rendererPath = join(extension, 'src/content/github.js');
    await writeFile(rendererPath, (await readFile(rendererPath, 'utf8')).replaceAll("mode: 'closed'", "mode: 'open'"));
    const manifest = JSON.parse(await readFile(new URL('manifest.json', ROOT), 'utf8'));
    manifest.background = { service_worker: 'test-worker.js' };
    await writeFile(join(extension, 'manifest.json'), `${JSON.stringify(manifest)}\n`);
    await writeFile(join(extension, 'test-worker.js'), source);
    context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    await run({ context, worker, extensionId: new URL(worker.url()).host });
  } finally {
    await context?.close();
    await rm(extension, { recursive: true, force: true });
    await rm(profile, { recursive: true, force: true });
  }
}

test('Activity removes view controls when its configuration disappears', async () => {
  const source = workerSource.replace('let active = null;', 'globalThis.configured = true;\nlet active = null;')
    .replace('const state = () => ({ configured: true, active, recent:', 'const state = () => ({ configured: globalThis.configured, active, recent:');
  await withActivityWorker(source, async ({ context, worker, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/src/times/times.html`);
    const switcher = page.locator('#activity-view-switcher');
    await expect(switcher.getByRole('button', { name: 'Calendar' })).toBeVisible();
    await worker.evaluate(() => { globalThis.configured = false; });
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(page.locator('#clockoli-times-root').getByText('Choose where Clockoli should save your time before viewing time.')).toBeVisible();
    await expect(switcher.getByRole('button')).toHaveCount(0);
  });
});

test('popup Quick start uses the fresh recent response rather than the older page-state snapshot', async () => {
  const source = workerSource.replace("else if (message.type === 'GET_PAGE_STATE') respond({ ok: true, data: state() });",
    "else if (message.type === 'GET_PAGE_STATE') respond({ ok: true, data: { ...state(), recent: [] } });");
  await withActivityWorker(source, async ({ context }) => {
    const page = await context.newPage();
    await page.route('https://github.com/acme/app/issues/42', route => route.fulfill({ status: 200, contentType: 'text/html',
      body: '<!doctype html><html><body><header><div class="AppHeader-actions"><img class="avatar" alt="User"></div></header><main><h1>Test issue</h1></main></body></html>' }));
    await page.goto('https://github.com/acme/app/issues/42');
    await page.locator('#clockoli-root .trigger-main').click();
    const panel = page.locator('#clockoli-full-width-popup-root');
    await expect(panel.locator('.popup-overview-layout .activity-weekly-card')).toHaveCount(3);
    await expect(panel.locator('.running-status-recent-task')).toHaveCount(3);
  });
});

for (const view of ['Timeline', 'Calendar']) test(`popup weekly total advances with a running timer in ${view}`, async () => {
  const source = workerSource.replace('let active = null;', `let active = { id: 'running', taskUrl,
  taskTitle: 'Running task', startedAt: new Date(Date.now() - 50000).toISOString(),
  entryDate: new Date().toLocaleDateString('en-CA'), timezone: 'UTC' };`);
  await withActivityWorker(source, async ({ context }) => {
    const page = await context.newPage();
    await page.route('https://github.com/acme/app/issues/42', route => route.fulfill({ status: 200, contentType: 'text/html',
      body: '<!doctype html><html><body><header><div class="AppHeader-actions"><img class="avatar" alt="User"></div></header><main><h1>Test issue</h1></main></body></html>' }));
    await page.goto('https://github.com/acme/app/issues/42');
    await page.locator('#clockoli-root .trigger-main').click();
    const panel = page.locator('#clockoli-full-width-popup-root');
    await panel.getByRole('button', { name: view }).click();
    const total = panel.locator('.popup-overview-layout [data-stat="total"]');
    await expect(total).not.toHaveText('—');
    const before = await total.textContent();
    await expect.poll(() => panel.locator('.running-status-elapsed').textContent(), { timeout: 20_000 })
      .not.toContain('Duration0m');
    await expect(total).not.toHaveText(before);
  });
});

test('Activity focuses the current Timeline after loading without overriding manual scroll', async () => {
  test.setTimeout(30000);
  const extension = await mkdtemp(join(tmpdir(), 'clockoli-timeline-focus-extension-'));
  const profile = await mkdtemp(join(tmpdir(), 'clockoli-timeline-focus-profile-'));
  let context;
  try {
    await cp(new URL('src/', ROOT), join(extension, 'src'), { recursive: true });
    const rendererPath = join(extension, 'src/content/github.js');
    await writeFile(rendererPath, (await readFile(rendererPath, 'utf8')).replaceAll("mode: 'closed'", "mode: 'open'"));
    const manifest = JSON.parse(await readFile(new URL('manifest.json', ROOT), 'utf8'));
    manifest.background = { service_worker: 'test-worker.js' };
    await writeFile(join(extension, 'manifest.json'), `${JSON.stringify(manifest)}\n`);
    const denseWeek = workerSource.replace('let active = null;', `
recent.splice(0);
for (let dayOffset = 0; dayOffset < 5; dayOffset++) {
  for (let index = 0; index < 10; index++) {
    const start = new Date(2026, 9, 12 + dayOffset, 9, index * 5);
    const end = new Date(start.getTime() + 5 * 60_000);
    const localDate = [start.getFullYear(), String(start.getMonth() + 1).padStart(2, '0'), String(start.getDate()).padStart(2, '0')].join('-');
    recent.push({ id: 'dense-' + dayOffset + '-' + index, taskUrl: 'https://example.com/dense-' + dayOffset,
      taskTitle: 'Synthetic task', entryDate: localDate, timezone: 'UTC', startedAt: start.toISOString(),
      endedAt: end.toISOString(), durationSeconds: 300, destinationId: 'github:1',
      _path: 'times/2026-10/alice.jsonl', _sha: 'fixture', _index: dayOffset * 10 + index });
  }
}
let active = { id: 'running', taskUrl: 'https://example.com/running', taskTitle: 'Synthetic running task',
  startedAt: new Date(2026, 9, 16, 11, 30).toISOString(), entryDate: '2026-10-16', timezone: 'UTC',
  destinationId: 'github:1' };`)
      .replace("if (message.type === 'LOAD_TIMES' || message.type === 'LOAD_WEEK' || message.type === 'LOAD_RECENT') respond({ ok: true, data: state() });",
        "if (message.type === 'LOAD_TIMES') { setTimeout(() => respond({ ok: true, data: { ...state(), recent } }), 500); return true; }\n  if (message.type === 'LOAD_WEEK' || message.type === 'LOAD_RECENT') respond({ ok: true, data: { ...state(), recent } });")
      .replace("else if (message.type === 'GET_PAGE_STATE') respond({ ok: true, data: state() });",
        "else if (message.type === 'GET_PAGE_STATE') respond({ ok: true, data: { ...state(), recent: recent.slice(0, 4) } });");
    await writeFile(join(extension, 'test-worker.js'), denseWeek);
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const page = await context.newPage();
    await page.clock.install({ time: new Date(2026, 9, 16, 12) });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/src/times/times.html`);
    await expect(page.locator('.task-timeline-host .task.running')).toBeVisible();
    await expect(page.locator('.task-timeline-host .task')).toHaveCount(51);
    await expect.poll(() => page.locator('.task-timeline-host .viewport').evaluate(el => {
      const viewport = el.getBoundingClientRect();
      const line = el.querySelector('.timeline-now-line').getBoundingClientRect();
      return (line.left - viewport.left) / viewport.width;
    })).toBeLessThan(1.1);
    const geometry = await page.locator('.task-timeline-host .viewport').evaluate(el => {
      const viewport = el.getBoundingClientRect();
      const line = el.querySelector('.timeline-now-line').getBoundingClientRect();
      return { nowPosition: (line.left - viewport.left) / viewport.width,
        scroll: el.scrollLeft, maxScroll: el.scrollWidth - el.clientWidth };
    });

    expect(geometry.maxScroll).toBeGreaterThan(100);
    expect(geometry.scroll).toBeGreaterThan(geometry.maxScroll * 0.75);
    expect(geometry.nowPosition).toBeGreaterThan(0.4);
    expect(geometry.nowPosition).toBeLessThan(0.8);

    await page.reload();
    await expect(page.locator('.task-timeline-host .task')).toHaveCount(5);
    const viewport = page.locator('.task-timeline-host .viewport');
    const box = await viewport.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(-100, 0);
    await expect(page.locator('.task-timeline-host .task')).toHaveCount(51);
    const afterManualScroll = await viewport.evaluate(el => ({ scroll: el.scrollLeft,
      maxScroll: el.scrollWidth - el.clientWidth }));
    expect(afterManualScroll.maxScroll).toBeGreaterThan(100);
    expect(afterManualScroll.scroll).toBeLessThan(afterManualScroll.maxScroll * 0.75);
  } finally {
    await context?.close();
    await rm(extension, { recursive: true, force: true });
    await rm(profile, { recursive: true, force: true });
  }
});

test('toolbar popup gives Description the remaining width and aligns Stop with Started and Duration', async ({}, testInfo) => {
  const extension = await mkdtemp(join(tmpdir(), 'clockoli-popup-running-layout-'));
  const profile = await mkdtemp(join(tmpdir(), 'clockoli-popup-running-profile-'));
  let context;
  try {
    await cp(new URL('src/', ROOT), join(extension, 'src'), { recursive: true });
    const rendererPath = join(extension, 'src/content/github.js');
    await writeFile(rendererPath, (await readFile(rendererPath, 'utf8')).replaceAll("mode: 'closed'", "mode: 'open'"));
    const manifest = JSON.parse(await readFile(new URL('manifest.json', ROOT), 'utf8'));
    manifest.background = { service_worker: 'test-worker.js' };
    await writeFile(join(extension, 'manifest.json'), `${JSON.stringify(manifest)}\n`);
    await writeFile(join(extension, 'test-worker.js'), workerSource.replace('let active = null;', `let active = {
      id: 'running', taskUrl, taskTitle: 'Running task', startedAt: date + 'T12:00:17Z',
      entryDate: date, timezone: 'UTC', description: '' };`));
    context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    worker.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/src/popup/popup.html`);
    const root = page.locator('#clockoli-popup-root');
    const card = root.locator('.active-task-strip.is-active');
    await expect(card.getByRole('textbox', { name: 'Started' })).toBeVisible();
    await expect(card.getByRole('textbox', { name: 'Description (optional)' })).toHaveValue('');
    for (const width of [420, 390, 800, 320]) {
      await page.setViewportSize({ width, height: 720 });
      await page.evaluate(full => { document.documentElement.dataset.clockoliWidth = full ? 'full' : 'contained'; }, width === 800);
      const layout = await card.evaluate(node => {
        const b = selector => node.querySelector(selector).getBoundingClientRect();
        const cardBox = node.getBoundingClientRect();
        const title = b('.strip-task-copy');
        const field = b('.strip-description-field');
        const input = b('.strip-description');
        const stats = b('.running-status-stats');
        const stop = b('[data-panel-action="stop"]');
        return { card: cardBox.toJSON(), title: title.toJSON(), field: field.toJSON(),
          input: input.toJSON(), stats: stats.toJSON(), stop: stop.toJSON(),
          overflow: document.documentElement.scrollWidth - innerWidth };
      });
      expect(layout.title.bottom).toBeLessThanOrEqual(layout.field.top);
      if (width > 359) {
        expect(layout.stats.left - layout.input.right).toBeGreaterThanOrEqual(8);
        expect(layout.stats.left - layout.input.right).toBeLessThanOrEqual(24);
      } else {
        expect(layout.input.right).toBeGreaterThan(layout.stats.left);
        expect(layout.input.bottom).toBeLessThanOrEqual(layout.stats.top);
      }
      expect(Math.abs(layout.input.right - layout.field.right)).toBeLessThan(2);
      expect(Math.abs(layout.stop.width - layout.stats.width)).toBeLessThan(2);
      expect(Math.abs(layout.stop.right - layout.stats.right)).toBeLessThan(2);
      expect(layout.stop.top).toBeGreaterThanOrEqual(layout.stats.bottom);
      if (width <= 420) {
        expect(layout.input.height).toBeGreaterThanOrEqual(44);
        expect(layout.stop.height).toBeGreaterThanOrEqual(44);
      }
      expect(layout.overflow).toBeLessThanOrEqual(0);
      if (width === 420 || width === 800) {
        await page.screenshot({ path: testInfo.outputPath(`popup-running-${width}.png`) });
      }
    }
    await card.locator('.strip-description').focus();
    await page.keyboard.press('Tab');
    await expect(card.getByRole('button', { name: 'Stop and save' })).toBeFocused();
    await expect(card.getByRole('button', { name: 'Stop and save' })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await context?.close();
    await rm(extension, { recursive: true, force: true });
    await rm(profile, { recursive: true, force: true });
  }
});

test('toolbar popup shares Activity summary, chart navigation, and List controls', async ({}, testInfo) => {
  const extension = await mkdtemp(join(tmpdir(), 'clockoli-popup-visual-parity-'));
  const profile = await mkdtemp(join(tmpdir(), 'clockoli-popup-visual-profile-'));
  let context;
  try {
    await cp(new URL('src/', ROOT), join(extension, 'src'), { recursive: true });
    const rendererPath = join(extension, 'src/content/github.js');
    await writeFile(rendererPath, (await readFile(rendererPath, 'utf8')).replaceAll("mode: 'closed'", "mode: 'open'"));
    const manifest = JSON.parse(await readFile(new URL('manifest.json', ROOT), 'utf8'));
    manifest.background = { service_worker: 'test-worker.js' };
    await writeFile(join(extension, 'manifest.json'), `${JSON.stringify(manifest)}\n`);
    await writeFile(join(extension, 'test-worker.js'), workerSource.replace(' - 3);', ' + 1);'));
    context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    worker.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.setViewportSize({ width: 420, height: 720 });
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/src/popup/popup.html`);
    const root = page.locator('#clockoli-popup-root');
    const summary = root.locator('.popup-overview-layout .activity-weekly-summary');
    await expect(summary.locator('.activity-weekly-range')).toBeVisible();
    await expect(summary.locator('.activity-weekly-range')).not.toBeEmpty();
    await expect(root.locator('.tracker-toolbar .activity-weekly-summary')).toHaveCount(0);
    await expect(root.locator('.active-task-strip .strip-idle-caption')).toHaveText('Start a task to begin');
    await expect(root.locator('.running-status-recent-task').first()).toBeVisible();
    const quickStartBounds = await root.locator('.active-task-strip').evaluate(card => {
      const label = card.querySelector('.running-status-quick-label').getBoundingClientRect();
      const choice = card.querySelector('.running-status-recent-task').getBoundingClientRect();
      const bounds = card.getBoundingClientRect();
      return { labelRight: label.right, choiceLeft: choice.left, choiceRight: choice.right, cardLeft: bounds.left, cardRight: bounds.right };
    });
    expect(quickStartBounds.labelRight).toBeLessThan(quickStartBounds.cardRight);
    expect(quickStartBounds.choiceLeft).toBeGreaterThan(quickStartBounds.cardLeft);
    expect(quickStartBounds.choiceRight).toBeLessThan(quickStartBounds.cardRight);
    for (const mode of ['Timeline', 'Calendar']) {
      await root.getByRole('button', { name: mode, exact: true }).click();
      const shell = root.locator('.popup-timeline-section .timeline-shell');
      const navigation = shell.locator(':scope > .week-navigation');
      await expect(navigation).toBeVisible();
      await expect(navigation.locator('.week-navigation-label')).toBeHidden();
      const [shellBox, navBox] = await Promise.all([shell.boundingBox(), navigation.boundingBox()]);
      expect(Math.abs(shellBox.y - navBox.y)).toBeLessThan(2);
      expect(await navigation.evaluate(node => getComputedStyle(node, '::before').backgroundImage)).toContain('gradient');
      if (mode === 'Calendar') {
        const activity = await context.newPage();
        await activity.setViewportSize({ width: 420, height: 720 });
        await activity.goto(`chrome-extension://${new URL(worker.url()).host}/src/times/times.html`);
        await activity.locator('#activity-view-switcher').getByRole('button', { name: 'Calendar' }).click();
        const popupArrow = await navigation.getByRole('button', { name: 'Previous week' }).boundingBox();
        const activityArrow = await activity.getByRole('button', { name: 'Previous week' }).boundingBox();
        expect({ width: popupArrow.width, height: popupArrow.height })
          .toEqual({ width: activityArrow.width, height: activityArrow.height });
        await activity.close();
      }
      await navigation.getByRole('button', { name: 'Previous week' }).click();
      await expect(navigation.getByRole('button', { name: 'Next week' })).toBeEnabled();
      await navigation.getByRole('button', { name: 'Next week' }).click();
    }
    await root.getByRole('button', { name: 'List', exact: true }).click();
    const toolbar = root.locator('.popup-list-toolbar');
    const search = toolbar.getByRole('searchbox', { name: 'Search activity' });
    const navigation = toolbar.locator('.week-navigation');
    const refresh = toolbar.getByRole('button', { name: 'Refresh' });
    await expect(search).toHaveAttribute('placeholder', 'Search entries');
    await expect(navigation.locator('.week-navigation-label')).toHaveText(await summary.locator('.activity-weekly-range').innerText());
    await expect(refresh).toBeVisible();
    const listControls = await toolbar.evaluate(node => {
      const box = selector => node.querySelector(selector).getBoundingClientRect();
      const nav = box('.week-navigation'), previous = box('.week-navigation-button:first-child');
      const label = box('.week-navigation-label'), next = box('.week-navigation-button:last-child');
      const refresh = box('.times-refresh');
      return { navWidth: nav.width, labelWidth: label.width, previousRight: previous.right,
        labelLeft: label.left, labelRight: label.right, nextLeft: next.left,
        nextRight: next.right, refreshLeft: refresh.left,
        nextMid: next.top + next.height / 2, refreshMid: refresh.top + refresh.height / 2 };
    });
    expect(listControls.navWidth).toBeLessThan(240);
    expect(listControls.labelWidth).toBeLessThan(140);
    expect(listControls.labelLeft - listControls.previousRight).toBeLessThanOrEqual(8);
    expect(listControls.nextLeft - listControls.labelRight).toBeLessThanOrEqual(8);
    expect(listControls.refreshLeft - listControls.nextRight).toBeLessThanOrEqual(16);
    expect(Math.abs(listControls.nextMid - listControls.refreshMid)).toBeLessThan(2);
    const currentRange = await summary.locator('.activity-weekly-range').innerText();
    await navigation.getByRole('button', { name: 'Previous week' }).click();
    await expect(summary.locator('.activity-weekly-range')).not.toHaveText(currentRange);
    await navigation.getByRole('button', { name: 'Next week' }).click();
    await expect(summary.locator('.activity-weekly-range')).toHaveText(currentRange);
    await expect(root.locator('.today-list .section-head')).toHaveCount(0);
    await expect(root.locator('.popup-list-total')).toBeHidden();
    await expect(root.locator('.today-list .entry-record').first()).toHaveCSS('border-top-width', '1px');
    await expect(root.locator('.today-list .entry-record').first()).toHaveCSS('border-top-left-radius', '10px');
    const reads = await worker.evaluate(() => globalThis.trackingMessages.length);
    await refresh.click();
    await expect.poll(() => worker.evaluate(() => globalThis.trackingMessages.length)).toBeGreaterThan(reads);
    await expect(refresh).toBeEnabled();
    await search.fill('Archived task');
    await expect.poll(() => worker.evaluate(() => globalThis.trackingMessages.includes('SEARCH_ACTIVITY'))).toBe(true);
    await expect(root.locator('.today-list').getByRole('link', { name: 'Archived task' })).toBeVisible();
    await search.fill('');
    await expect(root.locator('.today-list').getByRole('link', { name: 'Archived task' })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('popup-list-420.png') });
    for (const width of [320, 390, 800]) {
      await page.setViewportSize({ width, height: 720 });
      const controls = await toolbar.evaluate(node => {
        const nav = node.querySelector('.week-navigation').getBoundingClientRect();
        const refresh = node.querySelector('.times-refresh').getBoundingClientRect();
        const label = node.querySelector('.week-navigation-label').getBoundingClientRect();
        return { navRight: nav.right, refreshLeft: refresh.left, refreshRight: refresh.right,
          navMid: nav.top + nav.height / 2, refreshMid: refresh.top + refresh.height / 2,
          labelWidth: label.width, overflow: document.documentElement.scrollWidth - innerWidth };
      });
      expect(controls.navRight).toBeLessThan(controls.refreshLeft);
      expect(controls.refreshRight).toBeLessThanOrEqual(width);
      expect(controls.labelWidth).toBeLessThan(140);
      expect(Math.abs(controls.navMid - controls.refreshMid)).toBeLessThan(2);
      expect(controls.overflow).toBeLessThanOrEqual(1);
    }
    await page.screenshot({ path: testInfo.outputPath('popup-list-800.png') });
    expect(await toolbar.evaluate(node => document.documentElement.scrollWidth <= innerWidth && node.scrollWidth <= node.clientWidth)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await context?.close();
    await rm(extension, { recursive: true, force: true });
    await rm(profile, { recursive: true, force: true });
  }
});

test('Tracking now stacks task details and places Start, Duration and Stop on the right', async () => {
  test.setTimeout(45000);
  const extension = await mkdtemp(join(tmpdir(), 'clockoli-status-start-extension-'));
  const profile = await mkdtemp(join(tmpdir(), 'clockoli-status-start-profile-'));
  let context;
  try {
    await cp(new URL('src/', ROOT), join(extension, 'src'), { recursive: true });
    const rendererPath = join(extension, 'src/content/github.js');
    await writeFile(rendererPath, (await readFile(rendererPath, 'utf8')).replaceAll("mode: 'closed'", "mode: 'open'"));
    const manifest = JSON.parse(await readFile(new URL('manifest.json', ROOT), 'utf8'));
    manifest.background = { service_worker: 'test-worker.js' };
    await writeFile(join(extension, 'manifest.json'), `${JSON.stringify(manifest)}\n`);
    await writeFile(join(extension, 'test-worker.js'), workerSource.replace('let active = null;', `let active = {
      id: 'running', taskUrl, taskTitle: 'Running task', startedAt: date + 'T12:00:17Z',
      entryDate: date, timezone: 'UTC', description: 'Existing description' };`)
      .replace('pendingWrites, pendingCount: pendingWrites.length });',
        'pendingWrites, pendingCount: pendingWrites.length, todayTrackedMs: 7 * 3600000 + 11 * 60000 });'));
    context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, timezoneId: 'UTC',
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const errors = [];
    worker.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    const day = await worker.evaluate(() => date);
    await page.clock.install({ time: new Date(`${day}T15:00:00Z`) });
    await page.setViewportSize({ width: 1440, height: 800 });
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/src/times/times.html`);
    const strip = page.locator('.running-status.is-active .running-status-row');
    const description = strip.getByRole('textbox', { name: 'Description' });
    const start = strip.getByRole('textbox', { name: 'Started' });
    await expect(start).toHaveValue('12:00');
    await expect(strip.locator('.running-status-start-caption')).toHaveText('Started');
    await expect(strip.locator('.running-status-start-edit-icon')).toHaveCount(0);
    await expect(start).toHaveCSS('cursor', 'text');
    await expect(start).toHaveCSS('border-bottom-style', 'dashed');
    await expect(strip.getByLabel('Date')).toHaveCount(0);
    const stats = strip.locator('.running-status-stats');
    await expect(stats).toBeVisible();
    await expect(stats.locator('.running-status-metric-label')).toHaveText(['Duration']);
    await expect(stats.locator('.running-status-metric-value')).toHaveText(['2h 59m']);
    await expect(page.locator('#activity-summary .activity-weekly-card').first()).toContainText('7h 11m');
    const widths = await strip.evaluate(row => ({ row: row.getBoundingClientRect().width,
      description: row.querySelector('.running-status-description-field').getBoundingClientRect().width }));
    expect(widths.description).toBeGreaterThan(290);
    expect(widths.description).toBeGreaterThan(widths.row * .55);
    const measureControls = () => strip.evaluate(row => {
      const rect = selector => row.querySelector(selector).getBoundingClientRect();
      const startField = rect('.running-status-start-field');
      const metrics = rect('.running-status-metrics');
      const stop = rect('.running-status-stop');
      const live = rect('.running-status-live');
      const title = rect('.running-status-task');
      const description = rect('.running-status-description-field');
      const stats = rect('.running-status-stats');
      const values = [...row.querySelectorAll('.running-status-start,.running-status-metric-value')]
        .map(node => node.getBoundingClientRect().top);
      return { rightInset: row.getBoundingClientRect().right - stop.right,
        leftColumn: [live.left, title.left, description.left],
        verticalOrder: [live.top, title.top, description.top],
        statsRightOfTitle: stats.left > title.right,
        stopBelowStats: stop.top >= stats.bottom,
        descriptionBeforeStop: description.right < stop.left,
        descriptionFillsColumn: Math.abs(description.right - stats.left) < 30,
        startToMetrics: metrics.left - startField.right,
        valueOffset: Math.max(...values) - Math.min(...values),
        statsBackground: getComputedStyle(row.querySelector('.running-status-stats')).backgroundColor,
        resize: getComputedStyle(row.querySelector('.running-status-description')).resize };
    });
    const desktop = await measureControls();
    expect(Math.max(...desktop.leftColumn) - Math.min(...desktop.leftColumn)).toBeLessThan(4);
    expect(desktop.verticalOrder[0]).toBeLessThan(desktop.verticalOrder[1]);
    expect(desktop.verticalOrder[1]).toBeLessThan(desktop.verticalOrder[2]);
    expect(desktop.statsRightOfTitle).toBe(true);
    expect(desktop.stopBelowStats).toBe(true);
    expect(desktop.descriptionBeforeStop).toBe(true);
    expect(desktop.descriptionFillsColumn).toBe(true);
    expect(desktop.rightInset).toBeLessThan(30);
    expect(desktop.startToMetrics).toBeGreaterThanOrEqual(0);
    expect(desktop.startToMetrics).toBeLessThan(3);

    expect(desktop.valueOffset).toBeLessThan(6);
    expect(desktop.statsBackground).not.toBe('rgba(0, 0, 0, 0)');
    expect(desktop.resize).toBe('none');
    const github = await context.newPage();
    github.on('pageerror', error => errors.push(error.message));
    await github.setViewportSize({ width: 1440, height: 800 });
    await github.route('https://github.com/acme/app/issues/42', route => route.fulfill({
      status: 200, contentType: 'text/html',
      body: '<!doctype html><html><body><header><div class="AppHeader-actions"><img class="avatar" alt="User"></div></header><main><h1>Test issue</h1></main></body></html>',
    }));
    await github.goto('https://github.com/acme/app/issues/42');
    await github.locator('#clockoli-root .trigger-main').click();
    const panel = github.locator('#clockoli-full-width-popup-root');
    await expect(panel.locator('.popup-overview-layout .activity-weekly-card')).toHaveCount(3);
    await expect(panel.locator('.activity-weekly-label')).toHaveText('Statistic');
    await expect(panel.locator('.activity-weekly-card').first()).toContainText('7h 11m');
    await expect(panel.locator('.active-task-strip .running-status-live')).toHaveText('Tracking now');
    await expect(panel.locator('.active-task-strip .running-status-metric-label')).toHaveText(['Duration']);
    await expect(panel.locator('.active-task-strip .running-status-start')).toHaveValue('12:00');
    const panelStart = panel.locator('.active-task-strip .running-status-start');
    await expect(panel.locator('.running-status-start-caption')).toHaveText('Started');
    await expect(panel.locator('.running-status-start-edit-icon')).toHaveCount(0);
    await expect(panelStart).toHaveCSS('cursor', 'text');
    await expect(panelStart).toHaveCSS('border-bottom-style', 'dashed');
    await panelStart.click();
    await expect(panelStart).toBeFocused();
    expect(await panelStart.evaluate(node => [node.selectionStart, node.selectionEnd])).toEqual([0, 5]);
    await expect(panel.locator('.timeline-toolbar-end .timeline-view-button')).toHaveCount(3);
    await expect(panel.locator('.menu-body > .timeline-view-modes')).toHaveCount(0);
    const overview = await panel.locator('.full-width-popup').evaluate(popup => {
      const summary = popup.querySelector('.popup-overview-layout .activity-weekly-summary').getBoundingClientRect();
      const card = popup.querySelector('.active-task-strip').getBoundingClientRect();
      return { summaryTop: summary.top, summaryRight: summary.right, summaryHeight: summary.height,
        cardTop: card.top, cardLeft: card.left, cardHeight: card.height, cardWidth: card.width };
    });
    expect(Math.abs(overview.summaryTop - overview.cardTop)).toBeLessThan(2);
    expect(overview.summaryRight).toBeLessThan(overview.cardLeft);
    expect(overview.cardHeight).toBeGreaterThanOrEqual(overview.summaryHeight - 2);
    expect(overview.cardWidth).toBeGreaterThan(600);
    for (const width of [800, 420, 320]) {
      await github.setViewportSize({ width, height: 720 });
      const controls = await panel.locator('.active-task-strip.is-active').evaluate(card => {
        const box = selector => card.querySelector(selector).getBoundingClientRect();
        const stats = box('.running-status-stats'), stop = box('[data-panel-action="stop"]');
        const description = box('.strip-description'), live = box('.running-status-live');
        const bounds = card.getBoundingClientRect();
        return { stats: stats.toJSON(), stop: stop.toJSON(), description: description.toJSON(),
          live: live.toJSON(), bounds: bounds.toJSON(),
          overflow: card.closest('.full-width-popup').scrollWidth - card.closest('.full-width-popup').clientWidth };
      });
      expect(controls.live.width).toBeLessThan(170);
      expect(Math.abs(controls.stop.left - controls.stats.left)).toBeLessThan(2);
      expect(Math.abs(controls.stop.right - controls.stats.right)).toBeLessThan(2);
      expect(controls.stop.top).toBeGreaterThanOrEqual(controls.stats.bottom);
      expect(controls.stop.right).toBeLessThanOrEqual(controls.bounds.right);
      expect(controls.overflow).toBeLessThanOrEqual(0);
      if (width > 359) expect(Math.abs(controls.stop.top - controls.description.top)).toBeLessThan(2);
      else expect(controls.stop.top).toBeGreaterThanOrEqual(controls.description.bottom);
    }
    await github.close();
    await page.setViewportSize({ width: 1280, height: 800 });
    const narrowDesktop = await measureControls();
    expect(narrowDesktop.startToMetrics).toBeLessThan(26);
    expect(narrowDesktop.rightInset).toBeLessThan(30);
    expect(narrowDesktop.stopBelowStats).toBe(true);
    await start.click();
    expect(await start.evaluate(node => [node.selectionStart, node.selectionEnd])).toEqual([0, 5]);
    const focusedStyle = await start.evaluate(node => ({ outline: getComputedStyle(node).outlineStyle,
      ring: getComputedStyle(node.closest('.running-status-start-field')).boxShadow }));
    expect(focusedStyle.outline).toBe('none');
    expect(focusedStyle.ring).not.toBe('none');
    await page.screenshot({ path: join(tmpdir(), 'clockoli-start-focused.png') });
    await start.evaluate(node => node.blur());
    await page.setViewportSize({ width: 390, height: 740 });
    await expect(stats.locator('.running-status-metric-value')).toHaveText(['2h 59m']);
    const narrow = await strip.evaluate(row => {
      const bounds = row.getBoundingClientRect();
      const stats = row.querySelector('.running-status-stats').getBoundingClientRect();
      const stop = row.querySelector('.running-status-stop').getBoundingClientRect();
      const description = row.querySelector('.running-status-description-field').getBoundingClientRect();
      return { contained: [stats, stop].every(rect => rect.right <= bounds.right),
        stacked: description.bottom <= stats.top && stats.bottom <= stop.top,
        rightEdges: Math.abs(stats.right - stop.right) };
    });
    expect(narrow.contained).toBe(true);
    expect(narrow.stacked).toBe(true);
    expect(narrow.rightEdges).toBeLessThan(4);
    await page.screenshot({ path: join(tmpdir(), 'clockoli-stats-realistic-mobile.png') });
    await page.setViewportSize({ width: 1440, height: 800 });
    await start.fill('1000');
    await page.clock.runFor(5000);
    await expect(start).toHaveValue('1000');
    await start.press('Tab');
    await expect(start).toHaveValue('10:00');
    await expect(strip.getByRole('button', { name: 'Save start' })).toBeFocused();
    await worker.evaluate(() => { globalThis.deferActiveEdit = true; });
    await strip.getByRole('button', { name: 'Save start' }).click();
    await expect.poll(() => worker.evaluate(() => globalThis.activeEditPayloads.length)).toBe(1);
    expect(await worker.evaluate(() => active.startedAt)).toBe(`${day}T12:00:17Z`);
    await expect(start).toHaveValue('10:00');
    await worker.evaluate(() => {
      globalThis.deferActiveEdit = false;
      globalThis.pendingActiveEditRespond({ ok: false, error: { message: 'Timer start would overlap another time entry.' } });
      globalThis.pendingActiveEditRespond = null;
    });
    await expect(page.locator('.running-status-error')).toContainText('overlap another time entry');
    await expect(start).toHaveValue('10:00');
    expect(await worker.evaluate(() => active.startedAt)).toBe(`${day}T12:00:17Z`);
    await strip.getByRole('button', { name: 'Save start' }).click();
    await expect.poll(() => worker.evaluate(() => active.startedAt)).toBe(`${day}T10:00:00.000Z`);
    await expect(strip.locator('.running-status-start-saved')).toHaveText('✓ Saved');
    const payloads = await worker.evaluate(() => globalThis.activeEditPayloads);
    expect(payloads.at(-1)).toEqual({ original: { id: 'running', startedAt: `${day}T12:00:17Z` }, startedAt: `${day}T10:00:00.000Z` });
    await start.fill('0900');
    await strip.getByRole('button', { name: 'Save start' }).click();
    await expect.poll(() => worker.evaluate(() => globalThis.activeEditPayloads.length)).toBe(3);
    expect((await worker.evaluate(() => globalThis.activeEditPayloads.at(-1)))).toEqual({
      original: { id: 'running', startedAt: `${day}T10:00:00.000Z` },
      startedAt: `${day}T09:00:00.000Z`,
    });
    expect(await worker.evaluate(() => active.entryDate)).toBe(day);
    await start.fill('2500');
    await strip.getByRole('button', { name: 'Save start' }).click();
    await expect(page.locator('.running-status-error')).toContainText('valid Started time');
    expect(await worker.evaluate(() => globalThis.activeEditPayloads.length)).toBe(3);
    await start.fill('0900');
    await expect(strip.getByRole('button', { name: 'Save start' })).toBeHidden();
    await page.setViewportSize({ width: 390, height: 740 });
    const mobile = await strip.evaluate(row => ({ row: row.getBoundingClientRect().right,
      fields: [...row.querySelectorAll('input,textarea,button')].filter(node => !node.hidden)
        .every(node => node.getBoundingClientRect().right <= window.innerWidth) }));
    expect(mobile.row).toBeLessThanOrEqual(390);
    expect(mobile.fields).toBe(true);
    expect(errors).toEqual([]);
    await expect(description).toBeVisible();
    await page.setViewportSize({ width: 1440, height: 800 });
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/src/options/options.html`);
    const settingsStrip = page.locator('#running-status.is-active .running-status-row');
    await expect(settingsStrip.locator('.running-status-start')).toBeVisible();
    const settingsStart = await settingsStrip.locator('.running-status-start').evaluate(node => ({
      marginTop: getComputedStyle(node).marginTop,
      startTop: node.getBoundingClientRect().top,
      durationTop: node.closest('.running-status-stats').querySelector('.running-status-metric-value').getBoundingClientRect().top,
    }));
    expect(settingsStart.marginTop).toBe('0px');
    expect(Math.abs(settingsStart.startTop - settingsStart.durationTop)).toBeLessThan(6);
  } finally {
    await context?.close();
    await rm(extension, { recursive: true, force: true });
    await rm(profile, { recursive: true, force: true });
  }
});

test('Activity Timeline and Calendar edit a running timer start without exposing other fields or moving on rejection', async () => {
  test.setTimeout(45000);
  const extension = await mkdtemp(join(tmpdir(), 'clockoli-running-edit-extension-'));
  const profile = await mkdtemp(join(tmpdir(), 'clockoli-running-edit-profile-'));
  let context;
  try {
    await cp(new URL('src/', ROOT), join(extension, 'src'), { recursive: true });
    const rendererPath = join(extension, 'src/content/github.js');
    await writeFile(rendererPath, (await readFile(rendererPath, 'utf8')).replaceAll("mode: 'closed'", "mode: 'open'"));
    const manifest = JSON.parse(await readFile(new URL('manifest.json', ROOT), 'utf8'));
    manifest.background = { service_worker: 'test-worker.js' };
    await writeFile(join(extension, 'manifest.json'), `${JSON.stringify(manifest)}\n`);
    await writeFile(join(extension, 'test-worker.js'), workerSource.replace('let active = null;', `let active = {
  id: 'running', taskUrl, taskTitle: 'Running task', startedAt: date + 'T12:00:00Z',
  entryDate: date, timezone: 'UTC', destinationId: 'github:1', description: 'Existing description' };`));
    context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, timezoneId: 'UTC',
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    worker.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const fixtureDate = await worker.evaluate(() => date);
    await page.clock.install({ time: new Date(`${fixtureDate}T15:00:00Z`) });
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/src/times/times.html`);
    await page.getByRole('button', { name: 'Timeline', exact: true }).click();
    const running = page.locator('.task-timeline-host .task[data-task-key="active:running"]');
    await expect(running).toBeVisible();
    await running.click();
    await page.locator('.task-timeline-host .clockoli-entry-edit').click();
    const dialog = page.getByRole('dialog', { name: 'Edit timer start' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Start', { exact: true })).toBeVisible();
    await expect(dialog.getByLabel('Date', { exact: true })).toBeVisible();
    await expect(dialog.getByLabel('End (optional)')).toBeHidden();
    await expect(dialog.getByLabel('Description (optional)')).toBeHidden();
    await worker.evaluate(() => { globalThis.deferActiveEdit = true; });
    await dialog.getByLabel('Start', { exact: true }).fill('1100');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => worker.evaluate(() => globalThis.activeEditPayloads.length)).toBe(1);
    expect(await worker.evaluate(() => active.startedAt)).toBe(`${fixtureDate}T12:00:00Z`);
    await expect(running).toHaveAttribute('data-task-key', 'active:running');
    await worker.evaluate(() => {
      globalThis.deferActiveEdit = false;
      globalThis.pendingActiveEditRespond({ ok: false, error: { message: 'Timer start would overlap another time entry.' } });
      globalThis.pendingActiveEditRespond = null;
    });
    await expect(dialog.getByRole('alert')).toContainText('overlap');
    await expect(running).toBeVisible();
    expect(await worker.evaluate(() => active.startedAt)).toBe(`${fixtureDate}T12:00:00Z`);
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
    expect(await worker.evaluate(() => ({ active, payloads: globalThis.activeEditPayloads })))
      .toMatchObject({ active: { startedAt: `${fixtureDate}T11:00:00.000Z`, description: 'Existing description' },
        payloads: [{ startedAt: `${fixtureDate}T11:00:00.000Z` }, { startedAt: `${fixtureDate}T11:00:00.000Z` }] });
    await page.getByRole('button', { name: 'Calendar', exact: true }).click();
    const calendarRunning = page.locator('.task-timeline-host .calendar-task[data-task-key="active:running"]').first();
    await expect(calendarRunning).toBeVisible();
    await calendarRunning.click();
    await page.locator('.task-timeline-host .clockoli-entry-edit').click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Start', { exact: true })).toHaveValue('11:00');
    await dialog.getByLabel('Start', { exact: true }).fill('1000');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
    expect(await worker.evaluate(() => active.startedAt)).toBe(`${fixtureDate}T10:00:00.000Z`);
    const popup = await context.newPage();
    popup.on('pageerror', error => errors.push(error.message));
    await popup.clock.install({ time: new Date(`${fixtureDate}T15:00:00Z`) });
    await popup.goto(`chrome-extension://${new URL(worker.url()).host}/src/popup/popup.html`);
    await popup.getByRole('button', { name: 'Timeline', exact: true }).click();
    const popupRunning = popup.locator('.task-timeline-host .task[data-task-key="active:running"]');
    await expect(popupRunning).toBeVisible();
    await popupRunning.click();
    await popup.locator('.task-timeline-host .clockoli-entry-edit').click();
    const popupDialog = popup.getByRole('dialog', { name: 'Edit timer start' });
    await expect(popupDialog).toBeVisible();
    await expect(popupDialog.getByLabel('End (optional)')).toBeHidden();
    await popupDialog.getByLabel('Start', { exact: true }).fill('0930');
    await popupDialog.getByRole('button', { name: 'Save' }).click();
    await expect(popupDialog).toBeHidden();
    expect(await worker.evaluate(() => active.startedAt)).toBe(`${fixtureDate}T09:30:00.000Z`);
    expect(errors).toEqual([]);
  } finally {
    await context?.close();
    await rm(extension, { recursive: true, force: true });
    await rm(profile, { recursive: true, force: true });
  }
});

test('Activity displays a persisted zero-duration entry in List, Timeline and Calendar', async () => {
  const extension = await mkdtemp(join(tmpdir(), 'clockoli-zero-duration-extension-'));
  const profile = await mkdtemp(join(tmpdir(), 'clockoli-zero-duration-profile-'));
  let context;
  try {
    await cp(new URL('src/', ROOT), join(extension, 'src'), { recursive: true });
    const rendererPath = join(extension, 'src/content/github.js');
    await writeFile(rendererPath, (await readFile(rendererPath, 'utf8')).replaceAll("mode: 'closed'", "mode: 'open'"));
    const manifest = JSON.parse(await readFile(new URL('manifest.json', ROOT), 'utf8'));
    manifest.background = { service_worker: 'test-worker.js' };
    await writeFile(join(extension, 'manifest.json'), `${JSON.stringify(manifest)}\n`);
    await writeFile(join(extension, 'test-worker.js'), workerSource.replace('let active = null;', `
recent.push({ id: 'zero', taskUrl: 'https://example.com/zero', taskTitle: 'Zero-duration task', entryDate: date,
  timezone: 'UTC', startedAt: date + 'T08:45:00Z', endedAt: date + 'T08:45:00Z',
  durationSeconds: 0, destinationId: 'github:1', description: '',
  _path: 'times/' + date.slice(0, 7) + '/alice.jsonl', _sha: 'fixture', _index: 3 });
let active = null;`));
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    worker.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/src/times/times.html`);
    for (const mode of ['List', 'Timeline', 'Calendar']) {
      await page.getByRole('button', { name: mode, exact: true }).click();
      await page.getByRole('button', { name: 'Previous week' }).click();
      if (mode === 'List') {
        await expect(page.locator('#clockoli-times-root')).toContainText('Zero-duration task');
        await expect(page.locator('#clockoli-times-root')).toContainText('0m');
      } else {
        const selector = mode === 'Timeline' ? '.task' : '.calendar-task';
        await expect(page.locator(`.task-timeline-host ${selector}[data-task-key="entry:zero"]`)).toBeVisible();
        await expect(page.locator('.task-timeline-host')).not.toContainText('Timeline cannot display');
      }
    }
    expect(errors).toEqual([]);
    expect(await worker.evaluate(() => globalThis.editPayloads.length)).toBe(0);
  } finally {
    await context?.close();
    await rm(extension, { recursive: true, force: true });
    await rm(profile, { recursive: true, force: true });
  }
});

test('Activity moves completed entries before a neighbor in Timeline and Calendar', async () => {
  test.setTimeout(60000);
  const extension = await mkdtemp(join(tmpdir(), 'clockoli-reorder-extension-'));
  const profile = await mkdtemp(join(tmpdir(), 'clockoli-reorder-profile-'));
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
      channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    worker.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/src/times/times.html`);
    await page.getByRole('button', { name: 'List', exact: true }).click();
    await page.getByRole('button', { name: 'Timeline', exact: true }).click();
    await page.getByRole('button', { name: 'Previous week' }).click();
    const drag = async (source, destination) => {
      const from = await source.boundingBox();
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(destination.x, destination.y, { steps: 8 });
      await page.mouse.up();
    };
    const timelineNeighborItem = page.locator('.task-timeline-host .task[data-task-key="entry:same-day"]');
    const timelineSource = page.locator('.task-timeline-host .task[data-task-key="entry:record"]');
    await expect(timelineNeighborItem).toBeVisible();
    await timelineSource.evaluate(element => element.scrollIntoView({ inline: 'center' }));
    await timelineNeighborItem.evaluate(element => element.scrollIntoView({ inline: 'nearest' }));
    const timelineNeighbor = await timelineNeighborItem.boundingBox();
    await drag(timelineSource,
      { x: timelineNeighbor.x - timelineNeighbor.width, y: timelineNeighbor.y + timelineNeighbor.height / 2 });
    await expect.poll(() => worker.evaluate(() => globalThis.editPayloads.length)).toBe(1);
    expect(await worker.evaluate(() => globalThis.editPayloads[0].original.id)).toBe('record');
    expect(await worker.evaluate(() => globalThis.editPayloads[0].edits.endedAt <= recent[1].startedAt)).toBe(true);
    expect(await worker.evaluate(() => {
      const edit = globalThis.editPayloads[0].edits;
      return Date.parse(edit.endedAt) - Date.parse(edit.startedAt);
    })).toBe(30 * 60_000);
    await page.getByRole('button', { name: 'Calendar', exact: true }).click();
    await page.getByRole('button', { name: 'Previous week' }).click();
    const calendarRecord = page.locator('.task-timeline-host .calendar-task[data-task-key="entry:same-day"]').first();
    const calendarNeighbor = page.locator('.task-timeline-host .calendar-task[data-task-key="entry:record"]').first();
    await calendarRecord.evaluate(element => element.scrollIntoView({ block: 'center' }));
    await calendarRecord.evaluate(element => {
      const viewport = element.getRootNode().querySelector('.calendar-viewport');
      const target = element.getRootNode().querySelector('.calendar-task[data-task-key="entry:record"]');
      const from = element.getBoundingClientRect(), to = target.getBoundingClientRect(), bounds = viewport.getBoundingClientRect();
      viewport.scrollTop += (from.bottom + to.top) / 2 - (bounds.top + bounds.bottom) / 2;
    });
    await expect.poll(async () => {
      const from = await calendarRecord.boundingBox(), to = await calendarNeighbor.boundingBox();
      const bounds = await page.locator('.task-timeline-host .calendar-viewport').boundingBox();
      return Boolean(from && to && bounds && from.y >= bounds.y && to.y >= bounds.y
        && from.y + from.height <= bounds.y + bounds.height && to.y + to.height <= bounds.y + bounds.height);
    }).toBe(true);
    const neighbor = await calendarNeighbor.boundingBox();
    await worker.evaluate(() => { globalThis.failEdit = true; });
    await drag(calendarRecord, { x: neighbor.x + neighbor.width / 2, y: neighbor.y - 20 });
    await expect(page.locator('.timeline-edit-error')).toContainText('Go to List');
    await expect(calendarRecord).toBeVisible();
    expect(await worker.evaluate(() => globalThis.editPayloads.length)).toBe(2);
    await worker.evaluate(() => { globalThis.failEdit = false; });
    const retryNeighbor = await calendarNeighbor.boundingBox();
    await drag(calendarRecord, { x: retryNeighbor.x + retryNeighbor.width / 2, y: retryNeighbor.y - 20 });
    await expect.poll(() => worker.evaluate(() => globalThis.editPayloads.length)).toBe(3);
    expect(await worker.evaluate(() => globalThis.editPayloads[2].original.id)).toBe('same-day');
    expect(await worker.evaluate(() => globalThis.editPayloads[2].edits.endedAt <= recent[0].startedAt)).toBe(true);
    await page.getByRole('button', { name: 'List', exact: true }).click();
    for (const mode of ['Timeline', 'Calendar']) {
      await worker.evaluate(() => { globalThis.includeOverlap = false; });
      await page.getByRole('button', { name: mode, exact: true }).click();
      await expect(page.locator('.task-timeline-host')).toBeVisible();
      await worker.evaluate(() => { globalThis.includeOverlap = true; });
      await page.getByRole('button', { name: 'Previous week' }).click();
      const warning = page.locator('.timeline-week-error');
      await expect(warning).toContainText('Overlapping entries');
      await expect(warning).toContainText('List');
      await warning.getByRole('button', { name: 'Go to List' }).click();
      await expect(page.locator('.activity-list .entry-record.entry-overlap')).toHaveCount(2);
    }
    const popup = await context.newPage();
    popup.on('pageerror', error => errors.push(error.message));
    await popup.setViewportSize({ width: 450, height: 700 });
    await popup.goto(`chrome-extension://${new URL(worker.url()).host}/src/popup/popup.html`);
    await popup.getByRole('button', { name: 'Timeline', exact: true }).click();
    await popup.getByRole('button', { name: 'Previous week' }).click();
    const popupWarning = popup.locator('.timeline-week-error');
    await expect(popupWarning).toContainText('Overlapping entries');
    await popupWarning.getByRole('button', { name: 'Go to List' }).click();
    await expect(popup.locator('.today-list .entry-record.entry-overlap')).toHaveCount(2);
    const initiallyConflicted = await context.newPage();
    initiallyConflicted.on('pageerror', error => errors.push(error.message));
    const fixedDay = await worker.evaluate(() => recent[0].entryDate);
    await initiallyConflicted.clock.install({ time: new Date(`${fixedDay}T15:00:00Z`) });
    await worker.evaluate(() => { viewMode = 'timeline'; });
    await initiallyConflicted.goto(`chrome-extension://${new URL(worker.url()).host}/src/times/times.html`);
    await initiallyConflicted.getByRole('button', { name: 'Timeline', exact: true }).click();
    await expect(initiallyConflicted.locator('.timeline-week-error')).toContainText('Overlapping entries');
    expect(errors).toEqual([]);
  } finally {
    await context?.close();
    await rm(extension, { recursive: true, force: true });
    await rm(profile, { recursive: true, force: true });
  }
});

test('toolbar popup loads the full week before moving an entry past its neighbor', async () => {
  test.setTimeout(30000);
  const extension = await mkdtemp(join(tmpdir(), 'clockoli-popup-reorder-extension-'));
  const profile = await mkdtemp(join(tmpdir(), 'clockoli-popup-reorder-profile-'));
  let context;
  try {
    await cp(new URL('src/', ROOT), join(extension, 'src'), { recursive: true });
    const rendererPath = join(extension, 'src/content/github.js');
    await writeFile(rendererPath, (await readFile(rendererPath, 'utf8')).replaceAll("mode: 'closed'", "mode: 'open'"));
    const manifest = JSON.parse(await readFile(new URL('manifest.json', ROOT), 'utf8'));
    manifest.background = { service_worker: 'test-worker.js' };
    await writeFile(join(extension, 'manifest.json'), `${JSON.stringify(manifest)}\n`);
    const popupWorkerSource = workerSource
      .replace('day.setDate(day.getDate() - ((day.getDay() + 6) % 7) - 3);',
        'day.setDate(day.getDate() - ((day.getDay() + 6) % 7));')
      .replace("message.type === 'LOAD_WEEK' || message.type === 'LOAD_RECENT'", "message.type === 'LOAD_WEEK'")
      .replace("if (message.type === 'LOAD_TIMES' || message.type === 'LOAD_WEEK') respond({ ok: true, data: state() });",
        "if (message.type === 'LOAD_WEEK') { if (globalThis.autoReplyWeeks) respond({ ok: true, data: { ...state(), recent } }); else (globalThis.weekReplies ||= []).push(respond); return true; }\n  if (message.type === 'LOAD_TIMES') respond({ ok: true, data: { ...state(), recent } });")
      .replace("else if (message.type === 'SEARCH_ACTIVITY')", "else if (message.type === 'LOAD_RECENT') respond({ ok: true, data: { ...state(), recent } });\n  else if (message.type === 'SEARCH_ACTIVITY')")
      .replace("else if (message.type === 'GET_PAGE_STATE') respond({ ok: true, data: state() });",
        "else if (message.type === 'GET_PAGE_STATE') { if (message.refresh) (globalThis.pageRefreshReplies ||= []).push(respond); else respond({ ok: true, data: state() }); return true; }");
    await writeFile(join(extension, 'test-worker.js'), popupWorkerSource);
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    worker.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.setViewportSize({ width: 420, height: 650 });
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/src/popup/popup.html`);
    const root = page.locator('#clockoli-popup-root');
    const source = root.locator('.task-timeline-host .task[data-task-key="entry:record"]');
    const neighbor = root.locator('.task-timeline-host .task[data-task-key="entry:same-day"]');
    const visibleWeekend = () => root.locator('.task-timeline-host .viewport').evaluate(viewport => {
      const bounds = viewport.getBoundingClientRect();
      const bands = [...viewport.querySelectorAll('.day-band')].slice(-2);
      const line = viewport.querySelector('.timeline-now-line').getBoundingClientRect();
      return { days: bands.map(band => {
        const rect = band.getBoundingClientRect();
        return rect.left < bounds.right && rect.right > bounds.left;
      }), nowVisible: line.left >= bounds.left && line.left <= bounds.right };
    });
    await expect.poll(() => worker.evaluate(() => globalThis.weekReplies?.length ?? 0)).toBe(1);
    expect(await worker.evaluate(() => globalThis.pageRefreshReplies?.length ?? 0)).toBe(0);
    await expect(source).toBeVisible();
    let initialDayWidth;
    await expect.poll(async () => { initialDayWidth = await root.locator('.task-timeline-host .day-band').first().evaluate(band => band.getBoundingClientRect().width); return initialDayWidth; }).toBeGreaterThan(100);
    expect(await visibleWeekend()).toEqual({ days: [true, true], nowVisible: true });
    await expect.poll(() => root.locator('.task-timeline-host .day-band').first().evaluate(band => band.getBoundingClientRect().width)).toBeGreaterThan(100);
    const pendingDayWidth = await root.locator('.task-timeline-host .day-band').first().evaluate(band => band.getBoundingClientRect().width);
    expect(pendingDayWidth).toBeLessThan(initialDayWidth * 1.02);
    expect(await visibleWeekend()).toEqual({ days: [true, true], nowVisible: true });
    const preliminary = await source.evaluate(element => element.getBoundingClientRect().toJSON());
    await page.mouse.move(preliminary.x + preliminary.width / 2, preliminary.y + preliminary.height / 2);
    await page.mouse.down();
    await page.mouse.move(preliminary.x - 40, preliminary.y + preliminary.height / 2, { steps: 8 });
    await page.mouse.up();
    expect(await worker.evaluate(() => globalThis.editPayloads.length)).toBe(0);
    await worker.evaluate(() => {
      globalThis.autoReplyWeeks = true;
      for (const respond of globalThis.weekReplies.splice(0)) respond({ ok: true, data: { configured: true, active, recent, pendingWrites: [], pendingCount: 0 } });
    });
    await expect(neighbor).toBeVisible();
    const loadedDayWidth = await root.locator('.task-timeline-host .day-band').first().evaluate(band => band.getBoundingClientRect().width);
    expect(loadedDayWidth).toBeLessThan(initialDayWidth * 1.02);
    expect(await visibleWeekend()).toEqual({ days: [true, true], nowVisible: true });
    const popupViewport = await root.locator('.task-timeline-host .viewport').evaluate(viewport => {
      const bounds = viewport.getBoundingClientRect();
      const line = viewport.querySelector('.timeline-now-line').getBoundingClientRect();
      return { nowPosition: (line.left - bounds.left) / bounds.width,
        availableScroll: viewport.scrollWidth - viewport.clientWidth };
    });
    expect(popupViewport.nowPosition).toBeGreaterThan(0);
    expect(popupViewport.nowPosition).toBeLessThan(1.05);
    expect(popupViewport.availableScroll).toBeGreaterThan(0);
    await source.evaluate(element => element.scrollIntoView({ inline: 'center' }));
    await expect(source).toBeVisible();
    // A short task can be partially clipped by Timeline's horizontal scroller.
    // Locator hover scrolls to a genuinely hit-testable point before pointerdown.
    await source.hover();
    const from = await source.boundingBox();
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 - 90, from.y + from.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => worker.evaluate(() => globalThis.editPayloads.length)).toBe(1);
    expect(await worker.evaluate(() => globalThis.editPayloads[0].original.id)).toBe('record');
    expect(await worker.evaluate(() => globalThis.editPayloads[0].edits.endedAt <= recent[1].startedAt)).toBe(true);
    expect(await worker.evaluate(() => {
      const edit = globalThis.editPayloads[0].edits;
      return Date.parse(edit.endedAt) - Date.parse(edit.startedAt);
    })).toBe(30 * 60_000);
    await root.getByRole('button', { name: 'Calendar', exact: true }).click();
    const calendarSource = root.locator('.task-timeline-host .calendar-task[data-task-key="entry:same-day"]').first();
    await expect(calendarSource).toBeVisible();
    let calendarGeometry;
    await expect.poll(async () => {
      calendarGeometry = await calendarSource.evaluate(async element => {
        if (!element.isConnected) return null;
        const shadow = element.getRootNode();
        const neighbor = shadow.querySelector('.calendar-task[data-task-key="entry:record"]');
        const viewport = shadow.querySelector('.calendar-viewport');
        if (!neighbor || !viewport) return null;
        element.scrollIntoView({ block: 'center', inline: 'nearest' });
        const from = element.getBoundingClientRect(), to = neighbor.getBoundingClientRect();
        const bounds = viewport.getBoundingClientRect();
        viewport.scrollTop += (from.bottom + to.top) / 2 - (bounds.top + bounds.bottom) / 2;
        await new Promise(requestAnimationFrame);
        const source = shadow.querySelector('.calendar-task[data-task-key="entry:same-day"]');
        const target = shadow.querySelector('.calendar-task[data-task-key="entry:record"]');
        if (!source || !target) return null;
        return { from: source.getBoundingClientRect().toJSON(), to: target.getBoundingClientRect().toJSON(),
          bounds: viewport.getBoundingClientRect().toJSON(), pageWidth: innerWidth, pageHeight: innerHeight };
      });
      if (!calendarGeometry) return false;
      const { from, to, bounds, pageWidth, pageHeight } = calendarGeometry;
      return from.width > 0 && from.height > 0 && to.width > 0 && to.height > 0
        && from.y >= bounds.y && to.y >= bounds.y
        && from.y + from.height <= bounds.y + bounds.height
        && to.y + to.height <= bounds.y + bounds.height
        && to.y - 20 >= bounds.y + 4 && to.y - 20 < bounds.y + bounds.height
        && from.x + from.width / 2 >= 0 && from.x + from.width / 2 < pageWidth
        && from.y + from.height / 2 >= 0 && from.y + from.height / 2 < pageHeight;
    }).toBe(true);
    const { from: calendarFrom, to: calendarBefore } = calendarGeometry;
    await page.mouse.move(calendarFrom.x + calendarFrom.width / 2, calendarFrom.y + calendarFrom.height / 2);
    await page.mouse.down();
    await page.mouse.move(calendarBefore.x + calendarBefore.width / 2, calendarBefore.y - 20, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => worker.evaluate(() => globalThis.editPayloads.length)).toBe(2);
    expect(await worker.evaluate(() => globalThis.editPayloads[1].original.id)).toBe('same-day');
    expect(await worker.evaluate(() => globalThis.editPayloads[1].edits.startedAt
      !== globalThis.editPayloads[1].original.startedAt)).toBe(true);
    await page.close();
    await worker.evaluate(() => {
      const first = recent.find(entry => entry.id === 'record');
      first.startedAt = date + 'T08:00:00Z'; first.endedAt = date + 'T08:30:00Z';
      globalThis.editPayloads = [];
    });
    const github = await context.newPage();
    github.on('pageerror', error => errors.push(error.message));
    await github.setViewportSize({ width: 600, height: 650 });
    await github.route('https://github.com/acme/app/issues/42', route => route.fulfill({
      status: 200, contentType: 'text/html',
      body: '<!doctype html><html><body><header><div class="AppHeader-actions"><img class="avatar" alt="User"></div></header><main><h1>Test issue</h1></main></body></html>',
    }));
    await github.goto('https://github.com/acme/app/issues/42');
    await github.locator('#clockoli-root .trigger-main').click();
    const panel = github.locator('#clockoli-full-width-popup-root');
    await panel.getByRole('button', { name: 'Timeline', exact: true }).click();
    const panelSource = panel.locator('.task-timeline-host .task[data-task-key="entry:record"]');
    const panelNeighbor = panel.locator('.task-timeline-host .task[data-task-key="entry:same-day"]');
    await expect(panelSource).toBeVisible();
    await expect(panelNeighbor).toBeVisible();
    const panelNowPosition = await panel.locator('.task-timeline-host .viewport').evaluate(viewport => {
      const bounds = viewport.getBoundingClientRect();
      const line = viewport.querySelector('.timeline-now-line').getBoundingClientRect();
      return (line.left - bounds.left) / bounds.width;
    });
    expect(panelNowPosition).toBeGreaterThan(0);
    expect(panelNowPosition).toBeLessThan(1.05);
    await panelSource.evaluate(element => element.scrollIntoView({ inline: 'center' }));
    await panelNeighbor.evaluate(element => element.scrollIntoView({ inline: 'nearest' }));
    const { panelFrom, panelTo, panelViewport } = await panelSource.evaluate(element => {
      const root = element.getRootNode();
      const neighbor = root.querySelector('.task[data-task-key="entry:same-day"]');
      return { panelFrom: element.getBoundingClientRect().toJSON(),
        panelTo: neighbor.getBoundingClientRect().toJSON(),
        panelViewport: root.querySelector('.viewport').getBoundingClientRect().toJSON() };
    });
    const destinationX = Math.max(panelViewport.x + 8, panelTo.x + 6);
    expect(destinationX).toBeLessThan(panelTo.x + panelTo.width / 2);
    await github.mouse.move(panelFrom.x + panelFrom.width / 2, panelFrom.y + panelFrom.height / 2);
    await github.mouse.down();
    await github.mouse.move(destinationX, panelFrom.y + panelFrom.height / 2, { steps: 8 });
    await github.mouse.up();
    await expect.poll(() => worker.evaluate(() => globalThis.editPayloads.length)).toBe(1);
    expect(await worker.evaluate(() => globalThis.editPayloads[0].original.id)).toBe('record');
    await panelSource.click();
    await panel.locator('.clockoli-entry-edit').click();
    const panelDialog = github.getByRole('dialog', { name: 'Edit time' });
    await expect(panelDialog).toBeVisible();
    await expect(panelDialog.getByLabel('Description')).toHaveValue('');
    await panelDialog.getByRole('button', { name: 'Cancel' }).click();
    await github.close();
    await worker.evaluate(() => {
      globalThis.editPayloads = [];
      const first = Date.now() - 3 * 60 * 60_000;
      recent.splice(0, recent.length, ...Array.from({ length: 28 }, (_, index) => {
        const start = new Date(first + index * 6 * 60_000);
        return { id: `dense-${index}`, taskUrl: `https://example.com/dense-${index}`,
          taskTitle: 'Synthetic task', entryDate: start.toISOString().slice(0, 10), timezone: 'UTC',
          startedAt: start.toISOString(), endedAt: new Date(start.getTime() + 5 * 60_000).toISOString(),
          durationSeconds: 300, destinationId: 'github:1',
          _path: `times/${start.toISOString().slice(0, 7)}/alice.jsonl`, _sha: 'fixture', _index: index };
      }));
    });
    const priorWeekLoads = await worker.evaluate(() => globalThis.trackingMessages.filter(type => type === 'LOAD_WEEK').length);
    const densePopup = await context.newPage();
    await densePopup.addInitScript(() => {
      globalThis.fullWeekReady = false;
      const send = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = (message, callback) => send(message, response => {
        callback?.(response);
        if (message?.type === 'LOAD_WEEK' && response?.ok && !response?.data?.partial) {
          requestAnimationFrame(() => requestAnimationFrame(() => { globalThis.fullWeekReady = true; }));
        }
      });
    });
    await densePopup.setViewportSize({ width: 420, height: 650 });
    await densePopup.goto(`chrome-extension://${new URL(worker.url()).host}/src/popup/popup.html`);
    const denseRoot = densePopup.locator('#clockoli-popup-root');
    const denseSource = denseRoot.locator('.task-timeline-host .task[data-task-key="entry:dense-22"]');
    await expect(denseSource).toBeVisible();
    await expect.poll(() => denseRoot.locator('.task-timeline-host .task').count()).toBe(28);
    await expect.poll(() => worker.evaluate(() => globalThis.trackingMessages.filter(type => type === 'LOAD_WEEK').length)).toBeGreaterThan(priorWeekLoads);
    await expect.poll(() => densePopup.evaluate(() => globalThis.fullWeekReady)).toBe(true);
    await denseSource.evaluate(element => element.scrollIntoView({ inline: 'center' }));
    await expect.poll(() => denseSource.evaluate(element => {
      if (!element.isConnected) return false;
      const viewport = element.getRootNode().querySelector('.viewport');
      if (!viewport) return false;
      viewport.scrollLeft += element.getBoundingClientRect().left - viewport.getBoundingClientRect().left - viewport.clientWidth / 2;
      return true;
    })).toBe(true);
    let grip;
    await expect.poll(async () => { grip = await denseSource.evaluate(element => {
      if (!element.isConnected) return null;
      const bounds = element.getBoundingClientRect();
      const left = element.querySelector('.resize-handle.left').getBoundingClientRect();
      const right = element.querySelector('.resize-handle.right').getBoundingClientRect();
      return { moveTarget: bounds.left + 11 >= left.right && bounds.left + 11 < right.left,
        resizeTarget: bounds.left + 4 >= left.left && bounds.left + 4 < left.right,
        bounds: bounds.toJSON() };
    }).catch(() => null); return grip?.bounds.width ?? 0; }).toBeGreaterThan(0);
    expect(grip.bounds.width).toBeLessThan(46);
    expect({ moveTarget: grip.moveTarget, resizeTarget: grip.resizeTarget }).toEqual({ moveTarget: true, resizeTarget: true });
    const denseFrom = grip.bounds;
    await densePopup.mouse.move(denseFrom.x + 11, denseFrom.y + denseFrom.height / 2);
    await densePopup.mouse.down();
    await densePopup.mouse.move(denseFrom.x + 11 - 75, denseFrom.y + denseFrom.height / 2, { steps: 8 });
    await densePopup.mouse.up();
    await expect.poll(() => worker.evaluate(() => globalThis.editPayloads.length)).toBe(1);
    expect(await worker.evaluate(() => globalThis.editPayloads[0].original.id)).toBe('dense-22');
    expect(await worker.evaluate(() => 'endedAt' in globalThis.editPayloads[0].edits)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await context?.close();
    await rm(extension, { recursive: true, force: true });
    await rm(profile, { recursive: true, force: true });
  }
});

async function expectActivityListBounds(page) {
  const bounds = await page.getByRole('searchbox', { name: 'Search activity' }).evaluate(input => {
    const field = input.getBoundingClientRect();
    const toolbar = input.closest('.times-toolbar').getBoundingClientRect();
    const overview = document.querySelector('.activity-overview-layout').getBoundingClientRect();
    const label = input.closest('label').getBoundingClientRect();
    const root = input.getRootNode();
    const list = root.querySelector('.times-results').getBoundingClientRect();
    const navigation = root.querySelector('.week-navigation').getBoundingClientRect();
    const content = root.querySelector('.times-page').getBoundingClientRect();
    return { field: field.toJSON(), toolbar: toolbar.toJSON(), overview: overview.toJSON(),
      list: list.toJSON(), navigation: navigation.toJSON(), content: content.toJSON(),
      labelLeftGap: label.left - field.left, viewportWidth: innerWidth,
      overflow: document.documentElement.scrollWidth > innerWidth };
  });
  const aligned = bounds.viewportWidth <= 700 ? ['field', 'toolbar', 'list']
    : ['toolbar', 'list', 'content'];
  for (const element of aligned) {
    expect(Math.abs(bounds[element].left - bounds.overview.left), element).toBeLessThan(2);
    expect(Math.abs(bounds[element].right - bounds.overview.right), element).toBeLessThan(2);
  }
  expect(Math.abs(bounds.field.left - bounds.toolbar.left)).toBeLessThan(2);
  expect(bounds.field.right).toBeLessThanOrEqual(bounds.toolbar.right);
  expect(bounds.navigation.left).toBeGreaterThanOrEqual(bounds.toolbar.left);
  expect(bounds.navigation.right).toBeLessThanOrEqual(bounds.toolbar.right);
  if (bounds.viewportWidth <= 700) {
    expect(bounds.content.left).toBe(0);
    expect(bounds.content.right).toBe(bounds.viewportWidth);
  }
  expect(Math.abs(bounds.labelLeftGap)).toBeLessThan(2);
  expect(bounds.field.left).toBeGreaterThanOrEqual(12);
  expect(bounds.field.right).toBeLessThanOrEqual(bounds.viewportWidth - 12);
  expect(bounds.overflow).toBe(false);
}

test('Activity List icon switches from Start to Stop and back in the extension page', async () => {
  test.setTimeout(60000);
  const extension = await mkdtemp(join(tmpdir(), 'clockoli-activity-extension-'));
  const profile = await mkdtemp(join(tmpdir(), 'clockoli-activity-profile-'));
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
      channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    worker.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/src/times/times.html`);
    await expect(page.locator('.times-view-button').first()).toBeVisible({ timeout: 5000 });

    const bulk = page.locator('.bulk-time');
    await expect(bulk.locator('summary')).toHaveText('Bulk time adding');
    await bulk.locator('summary').click();
    const examples = bulk.locator('.bulk-time-examples');
    await expect(examples).toBeVisible();
    await expect(examples).toContainText('2026/08/21 https://example.com/task Search relevance 6:00');
    await expect(examples).toContainText('2026-08-22 https://github.com/acme/app/issues/42 Fix ranking 6.5');
    const bulkInput = bulk.getByRole('textbox', { name: 'Bulk time entries' });
    await bulkInput.fill('2026-08-25 https://example.com/work Work 1:30');
    await expect(bulkInput).toHaveValue('2026-08-25 https://example.com/work Work 1:30');
    await expect(examples).toBeVisible();
    await expect(examples).toContainText('23.08.2026 https://example.com/call Customer call 1:30');
    await expect(examples).toContainText('24/08/2026 https://example.com/release Release preparation 0.25');
    expect(await bulkInput.getAttribute('placeholder')).not.toContain('Search relevance');
    expect((await worker.evaluate(() => globalThis.trackingMessages))).not.toContain('BULK_ADD_TIMES');
    await bulk.getByRole('button', { name: 'Add time', exact: true }).click();
    const feedback = page.locator('.bulk-time-feedback');
    await expect(feedback).toContainText('4 entries were added.');
    await expect(feedback).toHaveAttribute('role', 'status');
    await expect(feedback).toBeInViewport();
    expect(await feedback.evaluate(node => getComputedStyle(node).position)).toBe('fixed');
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(feedback).toBeInViewport();
    await expect(bulkInput).toHaveValue('');
    expect((await page.locator('.times-body > .notice').allTextContents()).join(' ')).not.toContain('entries were added');

    await bulkInput.fill('invalid entry');
    await expect(feedback).toHaveCount(0);
    await worker.evaluate(() => { globalThis.bulkAddFailure = true; });
    await bulk.getByRole('button', { name: 'Add time', exact: true }).click();
    await expect(feedback).toContainText('Line 1: Invalid time entry');
    await expect(feedback).toHaveAttribute('role', 'alert');
    await expect(feedback).toBeInViewport();
    await expect(bulkInput).toHaveValue('invalid entry');
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(feedback).toBeInViewport();
    await feedback.getByRole('button', { name: 'Dismiss bulk time message' }).click();
    await expect(feedback).toHaveCount(0);
    await bulk.locator('summary').click();
    const tabs = page.locator('.times-view-modes');
    await expect(page.locator('.activity-overview-heading')).toHaveCount(0);
    await expect(page.getByText('Track time and manage your work')).toHaveCount(0);
    await expect(page.locator('#activity-view-switcher > .times-view-modes')).toBeVisible();
    await expect(page.locator('#activity-summary .activity-weekly-summary')).toBeVisible();
    await expect(page.locator('.times-toolbar')).toHaveCount(1);
    const status = page.locator('.running-status');
    const [statusBox, tabsBox] = await Promise.all([status.boundingBox(), tabs.boundingBox()]);
    expect(tabsBox.y + tabsBox.height).toBeLessThanOrEqual(statusBox.y);
    const tabAppearance = await tabs.evaluate(element => {
      const buttons = [...element.querySelectorAll('button')];
      const boxes = buttons.map(button => button.getBoundingClientRect());
      const selected = buttons.find(button => button.getAttribute('aria-pressed') === 'true');
      return { gap: getComputedStyle(element).gap, selectedBackground: getComputedStyle(selected).backgroundColor,
        icons: element.querySelectorAll('button svg').length,
        firstRadius: getComputedStyle(buttons[0]).borderTopLeftRadius,
        adjacent: boxes.every((box, index) => !index || box.left - boxes[index - 1].right <= 4) };
    });
    expect(tabAppearance.gap).toBe('2px');
    expect(tabAppearance.icons).toBe(3);
    expect(tabAppearance.selectedBackground).not.toBe('rgba(0, 0, 0, 0)');
    expect(tabAppearance.firstRadius).not.toBe('0px');
    expect(tabAppearance.adjacent).toBe(true);
    const tabCenter = await tabs.evaluate(element => {
      const row = element.getBoundingClientRect();
      const buttons = element.querySelectorAll('button');
      const first = buttons[0].getBoundingClientRect();
      const last = buttons[buttons.length - 1].getBoundingClientRect();
      return Math.abs((first.left + last.right) / 2 - (row.left + row.right) / 2);
    });
    expect(tabCenter).toBeLessThan(2);
    await page.getByRole('button', { name: 'List', exact: true }).click();
    await expectActivityListBounds(page);
    await page.setViewportSize({ width: 1750, height: 900 });
    await page.locator('#clockoli-times-root').evaluate(host => {
      host.dataset.clockoliWidth = 'full'; document.documentElement.dataset.clockoliWidth = 'full';
    });
    await expectActivityListBounds(page);
    await page.setViewportSize({ width: 2200, height: 900 });
    await expectActivityListBounds(page);
    await page.locator('#clockoli-times-root').evaluate(host => {
      host.dataset.clockoliWidth = 'contained'; document.documentElement.dataset.clockoliWidth = 'contained';
    });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.getByRole('button', { name: 'Previous week' }).click();
    const groups = page.locator('.activity-list .entry');
    await expect(groups).toHaveCount(2);
    await expect(groups.nth(0).locator('.entry-record')).toHaveCount(2);
    await expect(groups.nth(1).locator('.entry-record')).toHaveCount(1);
    for (const group of await groups.all()) {
      const appearance = await group.evaluate(element => {
        const style = getComputedStyle(element);
        const header = element.querySelector('.entry-date-header').getBoundingClientRect();
        const record = element.querySelector('.entry-record').getBoundingClientRect();
        const box = element.getBoundingClientRect();
        return { border: style.borderTopWidth, radius: style.borderTopLeftRadius,
          contained: header.top >= box.top && record.bottom <= box.bottom };
      });
      expect(appearance.border).not.toBe('0px');
      expect(appearance.radius).not.toBe('0px');
      expect(appearance.contained).toBe(true);
    }
    expect(await groups.first().locator('.entry-record').evaluateAll(records => records.map(record => getComputedStyle(record).borderBottomWidth))).toEqual(['1px', '1px']);
    await page.screenshot({ path: join(tmpdir(), 'clockoli-activity-list-days-desktop.png') });
    const edited = page.locator('.activity-list .entry-record').filter({ hasText: 'Activity test task' });
    await edited.hover();
    await edited.locator('.entry-edit').click();
    const editDialog = page.getByRole('dialog', { name: 'Edit time' });
    const description = editDialog.getByLabel('Description');
    await expect(description).toHaveJSProperty('tagName', 'TEXTAREA');
    await description.fill(['One', 'Two', 'Three', 'Four', 'Five', 'Six'].join('\n'));
    await expect.poll(() => description.evaluate(el => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(2);
    await description.fill(Array.from({ length: 18 }, (_, index) => `Note ${index + 1}`).join('\n'));
    await expect(editDialog.locator('.add-time-description-more')).toBeVisible();
    await description.fill('First line');
    await description.press('Shift+Enter');
    await description.pressSequentially('Second line');
    await expect(description).toHaveValue('First line\nSecond line');
    await description.press('Enter');
    await expect(editDialog).toBeHidden();
    expect(await edited.locator('.entry-description-link').textContent()).toBe('First line\nSecond line');
    expect(await worker.evaluate(() => globalThis.trackingMessages.filter(type => type === 'QUEUE_ENTRY_EDIT'))).toEqual(['QUEUE_ENTRY_EDIT']);
    const start = page.locator('.activity-list').getByRole('button', { name: 'Start tracking Activity test task' });
    await expect(start).toBeVisible({ timeout: 5000 });
    await expect.poll(async () => {
      await start.locator('xpath=ancestor::*[contains(@class,"entry-record")][1]').hover();
      return start.evaluate(node => getComputedStyle(node.closest('.entry-actions')).opacity);
    }).toBe('1');
    await start.click({ timeout: 5000 });
    const stop = page.getByRole('button', { name: 'Stop tracking Activity test task' });
    await expect(stop).toBeVisible({ timeout: 5000 });
    const strip = page.locator('.running-status.is-active .running-status-row');
    await expect(strip.locator('.running-status-live')).toHaveText('Tracking now');
    await expect(strip.locator('.running-status-task')).toHaveText('Activity test task');
    await expect(strip.locator('.running-status-metrics')).toBeVisible();
    const runningDescription = strip.getByRole('textbox', { name: 'Description' });
    await expect(runningDescription).toBeVisible();
    await runningDescription.fill('First line');
    await runningDescription.press('Shift+Enter');
    await runningDescription.pressSequentially('Second line');
    await expect(runningDescription).toHaveValue('First line\nSecond line');
    await runningDescription.press('Enter');
    await expect(strip.locator('.running-status-description-saved')).toHaveText('✓ Saved');
    await expect.poll(() => worker.evaluate(() => globalThis.trackingMessages.filter(type => type === 'QUEUE_ACTIVE_START_EDIT').length)).toBe(1);
    await runningDescription.fill('Finished work\nReviewed changes');
    await page.screenshot({ path: join(tmpdir(), 'clockoli-running-status-desktop.png') });
    await page.setViewportSize({ width: 390, height: 740 });
    await expectActivityListBounds(page);
    await page.locator('#clockoli-times-root').evaluate(host => {
      host.dataset.clockoliWidth = 'full'; document.documentElement.dataset.clockoliWidth = 'full';
    });
    await expectActivityListBounds(page);
    await page.locator('#clockoli-times-root').evaluate(host => {
      host.dataset.clockoliWidth = 'contained'; document.documentElement.dataset.clockoliWidth = 'contained';
    });
    await expect(stop).toBeVisible();
    const stripBounds = await strip.evaluate(element => ({ left: element.getBoundingClientRect().left,
      right: element.getBoundingClientRect().right,
      childrenFit: [...element.children].every(child => child.hidden || child.getBoundingClientRect().right <= element.getBoundingClientRect().right) }));
    expect(stripBounds.left).toBeGreaterThanOrEqual(0);
    expect(stripBounds.right).toBeLessThanOrEqual(390);
    expect(stripBounds.childrenFit).toBe(true);
    await page.screenshot({ path: join(tmpdir(), 'clockoli-running-status-mobile.png') });
    await page.screenshot({ path: join(tmpdir(), 'clockoli-activity-list-mobile.png') });
    const mobile = await page.evaluate(() => ({ width: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
      groups: [...document.querySelector('#clockoli-times-root').shadowRoot.querySelectorAll('.activity-list .entry')]
        .map(group => ({ right: group.getBoundingClientRect().right, width: group.getBoundingClientRect().width })) }));
    expect(mobile.groups.every(group => group.right <= mobile.viewport)).toBe(true);
    await runningDescription.press('Tab');
    const saveTime = strip.getByRole('button', { name: 'Stop and save' });
    await expect(saveTime).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(start).toBeVisible();
    expect(await worker.evaluate(() => locallyStopped[0]?.description)).toBe('Finished work\nReviewed changes');
    // Stop was accepted locally, but the synthetic worker deliberately keeps
    // the completion pending and never writes it to the remote history.
    await page.getByRole('button', { name: 'Next week' }).click();
    await expect(page.locator('.activity-list .entry-record')).toHaveCount(1);
    await expect(page.locator('.activity-list .entry-record')).toContainText('Activity test task');
    const stoppedRow = page.locator('.activity-list .entry-record');
    await expect(stoppedRow.getByRole('button', { name: 'Start tracking Activity test task' })).toBeVisible();
    await expect(stoppedRow.locator('.entry-edit')).toBeEnabled();
    await expect(stoppedRow.locator('.entry-delete')).toBeEnabled();
    await expect(stoppedRow.getByRole('button', { name: 'Pending' })).toHaveCount(0);
    await expect(page.locator('.timeline-queue-status:visible')).toHaveCount(0);
    await page.getByRole('button', { name: 'Previous week' }).click();
    expect(await worker.evaluate(() => globalThis.trackingMessages.filter(type => ['SWITCH_TASK', 'STOP'].includes(type)))).toEqual(['SWITCH_TASK', 'STOP']);
    const total = await page.locator('.times-list-total').textContent();
    await page.getByRole('searchbox', { name: 'Search activity' }).fill('Archived');
    await expect(page.locator('.activity-list .entry-record')).toHaveCount(1);
    await expect(page.locator('.activity-list .entry-record')).toContainText('Archived task');
    await expect(page.locator('.times-list-total')).toHaveText(total);
    expect(await worker.evaluate(() => globalThis.trackingMessages.includes('SEARCH_ACTIVITY'))).toBe(true);
    await page.getByRole('searchbox', { name: 'Search activity' }).fill('');
    await expect(page.locator('.activity-list .entry-record')).toHaveCount(3);
    await expect(page.locator('.activity-list .entry-record').filter({ hasText: 'Archived task' })).toHaveCount(0);
    await page.getByRole('searchbox', { name: 'Search activity' }).fill('Paged task');
    await expect(page.locator('.activity-list .entry-record')).toHaveCount(20);
    await expect(page.locator('.times-search-pagination')).toContainText('Page 1 of 2');
    await expect(page.locator('.times-search-pagination')).toContainText('1–20 of 25');
    await expect(page.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    const searchLoads = await worker.evaluate(() => globalThis.trackingMessages.filter(type => type === 'SEARCH_ACTIVITY').length);
    await page.getByRole('button', { name: 'Next page' }).click();
    await expect(page.locator('.activity-list .entry-record')).toHaveCount(5);
    await expect(page.locator('.times-search-pagination')).toContainText('Page 2 of 2');
    await expect(page.locator('.times-search-pagination')).toContainText('21–25 of 25');
    await expect(page.getByRole('button', { name: 'Next page' })).toBeDisabled();
    expect(await worker.evaluate(() => globalThis.trackingMessages.filter(type => type === 'SEARCH_ACTIVITY').length)).toBe(searchLoads);
    const paginationBounds = await page.locator('.times-search-pagination').evaluate(element => ({
      left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right,
      childrenFit: [...element.children].every(child => child.getBoundingClientRect().right <= window.innerWidth),
      viewport: window.innerWidth,
    }));
    expect(paginationBounds.left).toBeGreaterThanOrEqual(0);
    expect(paginationBounds.right).toBeLessThanOrEqual(paginationBounds.viewport);
    expect(paginationBounds.childrenFit).toBe(true);
    await expect(page.locator('.times-list-total')).toHaveText(total);
    await page.getByRole('button', { name: 'Previous page' }).click();
    await expect(page.locator('.activity-list .entry-record')).toHaveCount(20);
    await page.getByRole('searchbox', { name: 'Search activity' }).fill('Archived');
    await expect(page.locator('.activity-list .entry-record')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Next page' })).toHaveCount(0);
    await page.getByRole('searchbox', { name: 'Search activity' }).fill('');
    await worker.evaluate(() => { globalThis.searchMode = 'error'; });
    await page.getByRole('searchbox', { name: 'Search activity' }).fill('Archived');
    await page.getByRole('button', { name: 'Next week' }).click();
    await expect(page.getByRole('status')).toContainText('History unavailable');
    await expect(page.locator('.activity-list .entry-record')).toHaveCount(0);
    await worker.evaluate(() => { globalThis.searchMode = 'partial'; });
    await page.getByRole('button', { name: 'Retry search' }).click();
    await expect(page.locator('.activity-list .entry-record')).toContainText('Archived task');
    await expect(page.locator('.activity-list .partial-read-warning')).toContainText('Results may be incomplete');
    expect(errors).toEqual([]);
  } finally {
    await context?.close();
    await rm(extension, { recursive: true, force: true });
    await rm(profile, { recursive: true, force: true });
  }
});

test('Quick start Stop stays visible in Activity Timeline before any GitHub write', async () => {
  test.setTimeout(60000);
  const extension = await mkdtemp(join(tmpdir(), 'clockoli-quick-start-extension-'));
  const profile = await mkdtemp(join(tmpdir(), 'clockoli-quick-start-profile-'));
  let context;
  try {
    await cp(new URL('src/', ROOT), join(extension, 'src'), { recursive: true });
    const rendererPath = join(extension, 'src/content/github.js');
    await writeFile(rendererPath, (await readFile(rendererPath, 'utf8')).replaceAll("mode: 'closed'", "mode: 'open'"));
    const manifest = JSON.parse(await readFile(new URL('manifest.json', ROOT), 'utf8'));
    manifest.background = { service_worker: 'test-worker.js' };
    await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest) + '\n');
    await writeFile(join(extension, 'test-worker.js'), workerSource);
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/src/times/times.html`);
    await page.getByRole('button', { name: 'Timeline', exact: true }).click();

    const quickStart = page.getByRole('button', { name: 'Start tracking Activity test task' })
      .and(page.locator('.running-status-recent-task'));
    await expect(quickStart).toBeVisible();
    await quickStart.click();
    await expect(page.locator('.running-status.is-active')).toBeVisible();
    await expect(page.locator('.task[data-task-key="active:quick-running"]')).toHaveCount(1);

    await page.locator('.running-status-stop').click();
    await expect(page.locator('.running-status.is-idle')).toBeVisible();
    const completed = page.locator('.task[data-task-key="entry:quick-running"]');
    await expect(completed).toHaveCount(1, { timeout: 1200 });
    await expect(page.locator('.task[data-task-key="active:quick-running"]')).toHaveCount(0);
    // Keep the locally saved block visible across the next five-second state
    // poll and remote-history refresh, not just in the immediate Stop callback.
    await page.waitForTimeout(5300);
    await expect(completed).toHaveCount(1);
    // The simulated GitHub history is deliberately stale and never receives
    // the locally accepted completion, even if Activity requests it again.
    expect(await worker.evaluate(() => globalThis.trackingMessages.filter(
      type => type === 'START' || type === 'STOP'))).toEqual(['START', 'STOP']);
    await page.getByRole('button', { name: 'List', exact: true }).click();
    await expect(page.locator('.activity-list .entry-record').filter({ hasText: 'Activity test task' })).toHaveCount(1);
    expect(errors).toEqual([]);
  } finally {
    await context?.close();
    await rm(extension, { recursive: true, force: true });
    await rm(profile, { recursive: true, force: true });
  }
});

test('List, Timeline and Calendar Edit open the shared time form', async () => {
  test.setTimeout(60000);
  const extension = await mkdtemp(join(tmpdir(), 'clockoli-edit-form-extension-'));
  const profile = await mkdtemp(join(tmpdir(), 'clockoli-edit-form-profile-'));
  let context;
  try {
    await cp(new URL('src/', ROOT), join(extension, 'src'), { recursive: true });
    const rendererPath = join(extension, 'src/content/github.js');
    await writeFile(rendererPath, (await readFile(rendererPath, 'utf8')).replaceAll("mode: 'closed'", "mode: 'open'"));
    const manifest = JSON.parse(await readFile(new URL('manifest.json', ROOT), 'utf8'));
    manifest.background = { service_worker: 'test-worker.js' };
    await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
    await writeFile(join(extension, 'test-worker.js'), workerSource);
    context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/src/times/times.html`);
    await page.getByRole('button', { name: 'List', exact: true }).click();
    await page.getByRole('button', { name: 'Previous week' }).click();
    const row = page.locator('.activity-list .entry-record').filter({ hasText: 'Activity test task' });
    await row.hover();
    await row.locator('.entry-edit').click();
    const dialog = page.getByRole('dialog', { name: 'Edit time' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('combobox', { name: 'Task' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    expect(await worker.evaluate(() => globalThis.editPayloads.length)).toBe(0);
    await row.locator('.entry-edit').click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Description (optional)', { exact: true })).toBeVisible();
    await expect(dialog.getByLabel('Task title', { exact: true })).toHaveCount(0);
    await expect(dialog.getByRole('combobox', { name: 'Task' })).toHaveValue('Activity test task');
    const originalRange = await worker.evaluate(() => {
      const record = recent.find(entry => entry.id === 'record');
      return [record.startedAt, record.endedAt];
    });
    const visibleRange = await page.evaluate(range => {
      const format = value => {
        const date = new Date(value);
        return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-')
          + ' ' + [date.getHours(), date.getMinutes()].map(value => String(value).padStart(2, '0')).join(':');
      };
      return range.map(format);
    }, originalRange);
    await expect(dialog.getByLabel('Date', { exact: true })).toHaveValue(visibleRange[0].slice(0, 10));
    await expect(dialog.getByLabel('Start', { exact: true })).toHaveValue(visibleRange[0].slice(11));
    await expect(dialog.getByLabel('End (optional)')).toHaveValue(visibleRange[1].slice(11));
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    expect(await worker.evaluate(() => globalThis.editPayloads.length)).toBe(0);
    await row.locator('.entry-edit').click();
    await dialog.getByLabel('Description').fill('Edited from form');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
    await expect.poll(() => worker.evaluate(() => globalThis.editPayloads.length)).toBe(1);
    expect(await worker.evaluate(() => globalThis.editPayloads[0].original.id)).toBe('record');
    expect(await worker.evaluate(() => globalThis.editPayloads[0].edits.description)).toBe('Edited from form');
    await row.hover();
    await row.locator('.entry-edit').click();
    const startInput = dialog.getByLabel('Start', { exact: true });
    const endInput = dialog.getByLabel('End (optional)');
    await startInput.fill('08:00');
    await endInput.fill('25:59');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog.getByRole('alert')).toContainText('valid date and start/end time');
    expect(await worker.evaluate(() => globalThis.editPayloads.length)).toBe(1);
    await startInput.fill('00:00');
    await endInput.fill('23:59');
    await worker.evaluate(() => { globalThis.failEdit = true; });
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog.getByRole('alert')).toContainText('overlap another entry');
    await expect(dialog.getByRole('alert')).toContainText('Go to List');
    await expect(dialog).toBeVisible();
    expect(await worker.evaluate(() => recent.find(entry => entry.id === 'record').description)).toBe('Edited from form');
    await expect(row).toContainText('08:00');
    await worker.evaluate(() => { globalThis.failEdit = false; });
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    for (const mode of ['Timeline', 'Calendar']) {
      await page.getByRole('button', { name: mode, exact: true }).click();
      await page.getByRole('button', { name: 'Previous week' }).click();
      const block = page.locator(`.task-timeline-host ${mode === 'Timeline' ? '.task' : '.calendar-task'}[data-task-key="entry:record"]`).first();
      await block.click();
      await page.locator('.task-timeline-host .clockoli-timeline-action').filter({ hasText: 'Edit' }).click();
      await expect(dialog).toBeVisible();
      await expect(dialog.getByLabel('Description')).toHaveValue('Edited from form');
      await dialog.getByRole('button', { name: 'Cancel' }).click();
    }
    const popup = await context.newPage();
    popup.on('pageerror', error => errors.push(error.message));
    await popup.setViewportSize({ width: 450, height: 700 });
    await popup.goto(`chrome-extension://${new URL(worker.url()).host}/src/popup/popup.html`);
    await popup.getByRole('button', { name: 'List', exact: true }).click();
    await popup.getByRole('button', { name: 'Previous week' }).click();
    const popupRow = popup.locator('.today-list .entry-record').filter({ hasText: 'Activity test task' });
    await popupRow.locator('.entry-edit').click();
    const popupDialog = popup.getByRole('dialog', { name: 'Edit time' });
    await expect(popupDialog).toBeVisible();
    await expect(popupDialog.getByRole('combobox', { name: 'Task' })).toBeFocused();
    await popup.keyboard.press('Escape');
    await expect(popupDialog).toBeHidden();
    await popupRow.locator('.entry-edit').click();
    await expect(popupDialog).toBeVisible();
    await expect(popupDialog.getByLabel('Description')).toHaveValue('Edited from form');
    await popupDialog.getByRole('button', { name: 'Cancel' }).click();
    await page.evaluate(() => {
      window.__editValues = [];
      const end = new Date(); end.setDate(end.getDate() - 1);
      end.setHours(12, 0, 0, 0);
      const start = new Date(end); start.setDate(start.getDate() - 2);
      window.__longEntry = { taskUrl: 'https://example.com/long', taskTitle: 'Long task',
        startedAt: start.toISOString(), endedAt: end.toISOString(), description: 'Before' };
      window.__zeroEntry = { ...window.__longEntry, startedAt: end.toISOString(), taskTitle: 'Zero task' };
      window.__openFixtureEdit = entry => window.ClockoliTimeEntryForm.openEdit(entry, async value => {
        window.__editValues.push(value);
      });
      window.__openFixtureEdit(window.__longEntry);
    });
    await dialog.getByLabel('Description').fill('Long entry updated');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
    expect(await page.evaluate(() => window.__editValues[0])).toMatchObject({
      startedAt: await page.evaluate(() => window.__longEntry.startedAt),
      endedAt: await page.evaluate(() => window.__longEntry.endedAt), description: 'Long entry updated',
    });
    await page.evaluate(() => window.__openFixtureEdit(window.__zeroEntry));
    expect(await startInput.inputValue()).toBe(await endInput.inputValue());
    expect(await startInput.inputValue()).toBe(await page.evaluate(() => {
      const value = new Date(window.__zeroEntry.startedAt);
      return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
    }));
    await dialog.getByLabel('Description').fill('Zero entry updated');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
    expect(await page.evaluate(() => window.__editValues[1])).toMatchObject({
      startedAt: await page.evaluate(() => window.__zeroEntry.startedAt),
      endedAt: await page.evaluate(() => window.__zeroEntry.endedAt), description: 'Zero entry updated', taskTitle: 'Zero task',
    });
    await page.evaluate(() => window.__openFixtureEdit(window.__zeroEntry));
    await dialog.getByRole('combobox', { name: 'Task' }).fill('https://example.com/other');
    expect(await startInput.inputValue()).toBe(await endInput.inputValue());
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
    expect(await page.evaluate(() => window.__editValues[2])).toMatchObject({
      taskUrl: 'https://example.com/other', taskTitle: '',
    });
    await page.evaluate(() => window.__openFixtureEdit(window.__zeroEntry));
    const dateInput = dialog.getByLabel('Date', { exact: true });
    const originalDay = await dateInput.inputValue();
    const previousDay = day => {
      const date = new Date(`${day}T12:00:00Z`);
      date.setUTCDate(date.getUTCDate() - 1);
      return date.toISOString().slice(0, 10);
    };
    const nextDay = previousDay(originalDay), followingDay = originalDay;
    await dateInput.fill(nextDay);
    await expect(endInput).toHaveValue('12:00');
    await startInput.fill('11:00');
    await expect(endInput).toHaveValue('12:00');
    await startInput.fill('13:00');
    await expect(endInput).toHaveValue('12:00', 'changing only Start time must not overwrite End');
    await dateInput.fill(followingDay);
    await expect(endInput).toHaveValue('12:00');
    await endInput.fill('15:00');
    await startInput.fill('14:00');
    await expect(endInput).toHaveValue('15:00', 'manual End remains editable');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
    expect(await page.evaluate(() => window.__editValues[3].endedAt)).toBe(new Date(`${followingDay}T15:00`).toISOString());
    await page.evaluate(() => window.__openFixtureEdit({ taskUrl: 'https://example.com/overnight', taskTitle: 'Overnight',
      startedAt: new Date(2024, 1, 28, 23, 30).toISOString(),
      endedAt: new Date(2024, 1, 29, 0, 15).toISOString(), description: '' }));
    await dateInput.fill('2024-03-31');
    await expect(startInput).toHaveValue('23:30');
    await expect(endInput).toHaveValue('00:15');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
    expect(await page.evaluate(() => window.__editValues[4].endedAt))
      .toBe(await page.evaluate(() => new Date(2024, 3, 1, 0, 15).toISOString()));
    expect(errors).toEqual([]);
  } finally {
    await context?.close();
    await rm(extension, { recursive: true, force: true });
    await rm(profile, { recursive: true, force: true });
  }
});
