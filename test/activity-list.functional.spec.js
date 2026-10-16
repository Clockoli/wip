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
globalThis.trackingMessages = [];
globalThis.editPayloads = [];
globalThis.searchMode = 'ok';
let viewMode = 'timeline';
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  globalThis.trackingMessages.push(message.type);
  const state = () => ({ configured: true, active, pendingWrites: [], pendingCount: 0 });
  if (message.type === 'LOAD_TIMES' || message.type === 'LOAD_WEEK' || message.type === 'LOAD_RECENT') respond({ ok: true, data: { ...state(), recent } });
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
  else if (message.type === 'SWITCH_TASK') {
    active = { id: 'running', taskUrl: message.taskUrl, taskTitle: message.taskTitle,
      startedAt: new Date().toISOString(), entryDate: date, timezone: 'UTC' };
    respond({ ok: true, data: { active, pending: false } });
  } else if (message.type === 'STOP') {
    const completed = { ...active, endedAt: new Date().toISOString(), durationSeconds: 1 };
    active = null;
    respond({ ok: true, data: { entry: completed, pending: false } });
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
      .replace("if (message.type === 'LOAD_TIMES' || message.type === 'LOAD_WEEK' || message.type === 'LOAD_RECENT') respond({ ok: true, data: { ...state(), recent } });",
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
    await expect(timelineNeighborItem).toBeVisible();
    const timelineNeighbor = await timelineNeighborItem.boundingBox();
    await drag(page.locator('.task-timeline-host .task[data-task-key="entry:record"]'),
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
      .replace("if (message.type === 'LOAD_TIMES' || message.type === 'LOAD_WEEK') respond({ ok: true, data: { ...state(), recent } });",
        "if (message.type === 'LOAD_WEEK') { (globalThis.weekReplies ||= []).push(respond); return true; }\n  if (message.type === 'LOAD_TIMES') respond({ ok: true, data: { ...state(), recent } });")
      .replace("else if (message.type === 'SEARCH_ACTIVITY')", "else if (message.type === 'LOAD_RECENT') respond({ ok: true, data: { ...state(), recent: recent.filter(entry => entry.id === 'record') } });\n  else if (message.type === 'SEARCH_ACTIVITY')");
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
    await expect.poll(() => worker.evaluate(() => globalThis.weekReplies?.length ?? 0)).toBe(1);
    await expect(source).toBeVisible();
    const preliminary = await source.evaluate(element => element.getBoundingClientRect().toJSON());
    await page.mouse.move(preliminary.x + preliminary.width / 2, preliminary.y + preliminary.height / 2);
    await page.mouse.down();
    await page.mouse.move(preliminary.x - 40, preliminary.y + preliminary.height / 2, { steps: 8 });
    await page.mouse.up();
    expect(await worker.evaluate(() => globalThis.editPayloads.length)).toBe(0);
    await worker.evaluate(() => {
      for (const respond of globalThis.weekReplies.splice(0)) respond({ ok: true, data: { configured: true, active, recent, pendingWrites: [], pendingCount: 0 } });
    });
    await expect(neighbor).toBeVisible();
    await source.evaluate(element => element.scrollIntoView({ inline: 'center' }));
    await expect(source).toBeVisible();
    const from = await source.boundingBox();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
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
    await expect.poll(() => worker.evaluate(() => globalThis.weekReplies?.length ?? 0)).toBeGreaterThan(0);
    await worker.evaluate(() => {
      for (const respond of globalThis.weekReplies.splice(0)) respond({ ok: true, data: { configured: true, active, recent, pendingWrites: [], pendingCount: 0 } });
    });
    const calendarSource = root.locator('.task-timeline-host .calendar-task[data-task-key="entry:same-day"]').first();
    const calendarNeighbor = root.locator('.task-timeline-host .calendar-task[data-task-key="entry:record"]').first();
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
    await expect.poll(() => worker.evaluate(() => globalThis.weekReplies?.length ?? 0)).toBeGreaterThan(0);
    await worker.evaluate(() => {
      for (const respond of globalThis.weekReplies.splice(0)) respond({ ok: true, data: { configured: true, active, recent, pendingWrites: [], pendingCount: 0 } });
    });
    const panelSource = panel.locator('.task-timeline-host .task[data-task-key="entry:record"]');
    const panelNeighbor = panel.locator('.task-timeline-host .task[data-task-key="entry:same-day"]');
    await expect(panelSource).toBeVisible();
    await expect(panelNeighbor).toBeVisible();
    await panelSource.evaluate(element => element.scrollIntoView({ inline: 'center' }));
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
    expect(errors).toEqual([]);
  } finally {
    await context?.close();
    await rm(extension, { recursive: true, force: true });
    await rm(profile, { recursive: true, force: true });
  }
});

test('Activity List icon switches from Start to Stop and back in the extension page', async () => {
  test.setTimeout(25000);
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
    const tabs = page.locator('.times-view-modes');
    expect(await tabs.evaluate(element => element.nextElementSibling?.classList.contains('times-toolbar'))).toBe(true);
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
    expect(tabAppearance.firstRadius).toBe('0px');
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
    const start = page.getByRole('button', { name: 'Start tracking Activity test task' });
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
    await page.screenshot({ path: join(tmpdir(), 'clockoli-running-status-desktop.png') });
    await page.setViewportSize({ width: 390, height: 740 });
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
    await stop.click({ timeout: 5000 });
    await expect(start).toBeVisible();
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
