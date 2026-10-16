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
const history = [...recent, { id: 'archived', taskUrl: 'https://example.com/archived', taskTitle: 'Archived task', entryDate: archivedDate,
  timezone: 'UTC', startedAt: archivedDate + 'T09:00:00Z', endedAt: archivedDate + 'T10:00:00Z',
  durationSeconds: 3600, description: '', _path: 'times/' + archivedDate.slice(0, 7) + '/alice.jsonl', _sha: 'fixture', _index: 0 },
  ...Array.from({ length: 25 }, (_, index) => ({ id: 'paged-' + index, taskUrl: 'https://example.com/paged/' + index,
    taskTitle: 'Paged task ' + index, entryDate: archivedDate, timezone: 'UTC',
    startedAt: archivedDate + 'T08:00:00Z', endedAt: archivedDate + 'T08:30:00Z',
    durationSeconds: 1800, description: '', _path: 'times/' + archivedDate.slice(0, 7) + '/alice.jsonl', _sha: 'fixture', _index: index + 1 }))];
let active = null;
globalThis.trackingMessages = [];
globalThis.searchMode = 'ok';
globalThis.bulkAddFailure = false;
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  globalThis.trackingMessages.push(message.type);
  const state = () => ({ configured: true, active, pendingWrites: [], pendingCount: 0 });
  if (message.type === 'LOAD_TIMES') respond({ ok: true, data: { ...state(), recent } });
  else if (message.type === 'SEARCH_ACTIVITY') {
    if (globalThis.searchMode === 'error') respond({ ok: false, error: { message: 'History unavailable' } });
    else respond({ ok: true, data: { ...state(), recent: history, partial: globalThis.searchMode === 'partial' } });
  }
  else if (message.type === 'GET_PAGE_STATE') respond({ ok: true, data: state() });
  else if (message.type === 'BULK_ADD_TIMES') respond(globalThis.bulkAddFailure
    ? { ok: false, error: { message: 'Line 1: Invalid time entry' } }
    : { ok: true, data: { added: 4 } });
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
    await start.locator('xpath=ancestor::*[contains(@class,"entry-record")][1]').hover();
    await expect.poll(() => start.evaluate(node => getComputedStyle(node.closest('.entry-actions')).opacity)).toBe('1');
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
