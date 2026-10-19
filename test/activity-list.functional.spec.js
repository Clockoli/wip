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
globalThis.searchMode = 'ok';
let viewMode = 'timeline';
globalThis.bulkAddFailure = false;
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  globalThis.trackingMessages.push(message.type);
  const state = () => ({ configured: true, active, recent: [...locallyStopped, ...recent],
    pendingWrites, pendingCount: pendingWrites.length });
  if (message.type === 'LOAD_TIMES' || message.type === 'LOAD_WEEK' || message.type === 'LOAD_RECENT') respond({ ok: true, data: { ...state(), recent: [...locallyStopped, ...recent] } });
  else if (message.type === 'SEARCH_ACTIVITY') {
    if (globalThis.searchMode === 'error') respond({ ok: false, error: { message: 'History unavailable' } });
    else respond({ ok: true, data: { ...state(), recent: history, partial: globalThis.searchMode === 'partial' } });
  }
  else if (message.type === 'GET_PAGE_STATE') respond({ ok: true, data: state() });
  else if (message.type === 'GET_ACTIVITY_VIEW_MODE') respond({ ok: true, data: { mode: viewMode } });
  else if (message.type === 'SET_ACTIVITY_VIEW_MODE') { viewMode = message.mode; respond({ ok: true, data: { mode: viewMode } }); }
  else if (message.type === 'QUEUE_ENTRY_EDIT') {
    globalThis.editPayloads.push(message.payload);
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
    if (!active || active.id !== message.payload.original.id) {
      respond({ ok: false, error: { message: 'No matching running timer' } });
    } else {
      active = { ...active, description: message.payload.description };
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
      .replace("if (message.type === 'LOAD_TIMES' || message.type === 'LOAD_WEEK' || message.type === 'LOAD_RECENT') respond({ ok: true, data: { ...state(), recent: [...locallyStopped, ...recent] } });",
        "if (message.type === 'LOAD_TIMES') { setTimeout(() => respond({ ok: true, data: { ...state(), recent } }), 500); return true; }\n  if (message.type === 'LOAD_WEEK' || message.type === 'LOAD_RECENT') respond({ ok: true, data: { ...state(), recent } });")
      .replace("else if (message.type === 'GET_PAGE_STATE') respond({ ok: true, data: state() });",
        "else if (message.type === 'GET_PAGE_STATE') respond({ ok: true, data: { ...state(), recent: recent.slice(0, 4) } });");
    await writeFile(join(extension, 'test-worker.js'), denseWeek);
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium', headless: false,
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
      channel: 'chromium', headless: false,
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
    const neighbor = await calendarNeighbor.boundingBox();
    await drag(calendarRecord, { x: neighbor.x + neighbor.width / 2, y: neighbor.y - 20 });
    await expect.poll(() => worker.evaluate(() => globalThis.editPayloads.length)).toBe(2);
    expect(await worker.evaluate(() => globalThis.editPayloads[1].original.id)).toBe('same-day');
    expect(await worker.evaluate(() => globalThis.editPayloads[1].edits.endedAt <= recent[0].startedAt)).toBe(true);
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
      .replace("if (message.type === 'LOAD_TIMES' || message.type === 'LOAD_WEEK') respond({ ok: true, data: { ...state(), recent: [...locallyStopped, ...recent] } });",
        "if (message.type === 'LOAD_WEEK') { if (globalThis.autoReplyWeeks) respond({ ok: true, data: { ...state(), recent } }); else (globalThis.weekReplies ||= []).push(respond); return true; }\n  if (message.type === 'LOAD_TIMES') respond({ ok: true, data: { ...state(), recent } });")
      .replace("else if (message.type === 'SEARCH_ACTIVITY')", "else if (message.type === 'LOAD_RECENT') respond({ ok: true, data: { ...state(), recent } });\n  else if (message.type === 'SEARCH_ACTIVITY')")
      .replace("else if (message.type === 'GET_PAGE_STATE') respond({ ok: true, data: state() });",
        "else if (message.type === 'GET_PAGE_STATE') { if (message.refresh) (globalThis.pageRefreshReplies ||= []).push(respond); else respond({ ok: true, data: state() }); return true; }");
    await writeFile(join(extension, 'test-worker.js'), popupWorkerSource);
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium', headless: false,
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
    const calendarNeighbor = root.locator('.task-timeline-host .calendar-task[data-task-key="entry:record"]').first();
    await expect(calendarSource).toBeVisible();
    await calendarSource.evaluate(element => element.scrollIntoView({ block: 'center' }));
    const calendarFrom = await calendarSource.boundingBox(), calendarBefore = await calendarNeighbor.boundingBox();
    await page.mouse.move(calendarFrom.x + calendarFrom.width / 2, calendarFrom.y + calendarFrom.height / 2);
    await page.mouse.down();
    await page.mouse.move(calendarBefore.x + calendarBefore.width / 2, calendarBefore.y - 20, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => worker.evaluate(() => globalThis.editPayloads.length)).toBe(2);
    expect(await worker.evaluate(() => globalThis.editPayloads[1].original.id)).toBe('same-day');
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

async function expectFullWidthActivitySearch(page) {
  const bounds = await page.getByRole('searchbox', { name: 'Search activity' }).evaluate(input => {
    const field = input.getBoundingClientRect();
    const toolbar = input.closest('.times-toolbar').getBoundingClientRect();
    return { leftGap: field.left - toolbar.left, rightGap: toolbar.right - field.right };
  });
  expect(Math.abs(bounds.leftGap)).toBeLessThan(2);
  expect(Math.abs(bounds.rightGap)).toBeLessThan(2);
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
      channel: 'chromium', headless: false,
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
    expect(await tabs.evaluate(element => element.closest('.activity-heading-row')?.nextElementSibling?.classList.contains('activity-weekly-summary'))).toBe(true);
    await expect(page.locator('.times-toolbar')).toHaveCount(1);
    const status = page.locator('.running-status');
    const [statusBox, tabsBox] = await Promise.all([status.boundingBox(), tabs.boundingBox()]);
    expect(tabsBox.y).toBeGreaterThanOrEqual(statusBox.y + statusBox.height);
    const tabAppearance = await tabs.evaluate(element => {
      const buttons = [...element.querySelectorAll('button')];
      const boxes = buttons.map(button => button.getBoundingClientRect());
      const selected = buttons.find(button => button.getAttribute('aria-pressed') === 'true');
      return { gap: getComputedStyle(element).gap, selectedUnderline: getComputedStyle(selected).borderBottomColor,
        selectedWidth: getComputedStyle(selected).borderBottomWidth,
        firstRadius: getComputedStyle(buttons[0]).borderTopLeftRadius,
        adjacent: boxes.every((box, index) => !index || box.left - boxes[index - 1].right < 2) };
    });
    expect(tabAppearance.gap).toBe('0px');
    expect(tabAppearance.selectedWidth).toBe('3px');
    expect(tabAppearance.selectedUnderline).not.toBe('rgba(0, 0, 0, 0)');
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
    await expectFullWidthActivitySearch(page);
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
    expect(await groups.first().locator('.entry-record').evaluateAll(records => records.map(record => getComputedStyle(record).borderBottomWidth))).toEqual(['1px', '0px']);
    await page.screenshot({ path: join(tmpdir(), 'clockoli-activity-list-days-desktop.png') });
    const edited = page.locator('.activity-list .entry-record').filter({ hasText: 'Activity test task' });
    await edited.hover();
    await edited.locator('.entry-edit').click();
    const description = edited.locator('.inline-description');
    await expect(description).toHaveJSProperty('tagName', 'TEXTAREA');
    await description.fill(['One', 'Two', 'Three', 'Four', 'Five', 'Six'].join('\n'));
    await expect.poll(() => description.evaluate(el => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(2);
    await description.fill(Array.from({ length: 18 }, (_, index) => `Note ${index + 1}`).join('\n'));
    await expect(edited.locator('.description-overflow-hint')).toBeVisible();
    await description.fill('First line');
    await description.press('Shift+Enter');
    await description.pressSequentially('Second line');
    await expect(description).toHaveValue('First line\nSecond line');
    await description.press('Enter');
    await expect(edited.locator('.entry-description-saved')).toHaveText('✓ Saved');
    expect(await edited.locator('.entry-description-link').textContent()).toBe('First line\nSecond line');
    expect(await worker.evaluate(() => globalThis.trackingMessages.filter(type => type === 'QUEUE_ENTRIES_EDIT'))).toEqual(['QUEUE_ENTRIES_EDIT']);
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
    await expectFullWidthActivitySearch(page);
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
      channel: 'chromium', headless: false,
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
