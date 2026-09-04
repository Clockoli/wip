import { expect, test } from '@playwright/test'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

async function view(page) {
  return page.locator('[data-testid="timeline-canvas"]').evaluate((element) => ({
    start: Number(element.dataset.viewStart),
    end: Number(element.dataset.viewEnd),
    width: element.getBoundingClientRect().width,
  }))
}

async function emitted(page) {
  return page.evaluate(() => window.__DEMO_EVENTS__.slice())
}

async function geometry(locator) {
  return locator.evaluate((element) => ({
    left: element.offsetLeft,
    width: element.getBoundingClientRect().width,
    right: element.offsetLeft + element.getBoundingClientRect().width,
  }))
}

const observedErrors = new WeakMap()

test.beforeEach(async ({ page }) => {
  const errors = []
  observedErrors.set(page, errors)
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => errors.push(`page: ${error.message}`))
  await page.goto('/')
  await expect(page.locator('[data-testid="timeline-viewport"]')).toBeVisible()
})

test.afterEach(async ({ page }) => {
  expect(observedErrors.get(page)).toEqual([])
})

test('demo is a full-width timeline without promotional chrome or zoom buttons', async ({ page }) => {
  const timeline = page.locator('#timeline')
  const box = await timeline.boundingBox()
  const viewport = page.viewportSize()

  expect(box.x).toBe(0)
  expect(box.width).toBe(viewport.width)
  await expect(page.getByText('Standalone UI component')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Elastic Timeline Editor' })).toHaveCount(0)
  await expect(page.getByText('последние 24 часа')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Уменьшить масштаб' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Увеличить масштаб' })).toHaveCount(0)
})

test('empty range renders no explanatory copy', async ({ page }) => {
  await page.evaluate(() => window.__TIMELINE__.update({ items: [] }))
  await expect(page.getByText('Нет интервалов в выбранном диапазоне')).toHaveCount(0)
})

test('local midnight is marked by a strong full-height day boundary', async ({ page }) => {
  const boundary = page.locator('[data-testid="timeline-day-boundary"]')
  await expect(boundary).toHaveCount(1)
  expect(await boundary.evaluate((element) => new Date(element.dataset.boundaryAt).getHours())).toBe(0)
  expect(await boundary.evaluate((element) => getComputedStyle(element).borderLeftWidth)).toBe('2px')
})

test('every shown header label is fully visible in the viewport', async ({ page }) => {
  const viewport = page.locator('[data-testid="timeline-viewport"]')
  const assertLabelsFit = async () => {
    const clipped = await viewport.evaluate((element) => {
      const viewportRect = element.getBoundingClientRect()
      return [...element.querySelectorAll('.elastic-timeline__cell-label')]
        .filter((label) => !label.hidden && getComputedStyle(label).visibility !== 'hidden')
        .filter((label) => {
          const labelRect = label.getBoundingClientRect()
          return labelRect.left < viewportRect.left || labelRect.right > viewportRect.right
        }).map((label) => label.textContent)
    })
    expect(clipped).toEqual([])
  }

  await assertLabelsFit()
  await viewport.evaluate((element) => { element.scrollLeft = Math.max(0, element.scrollWidth / 3) })
  await page.waitForTimeout(50)
  await assertLabelsFit()
})

test('every tracked hour cell receives a readable smaller label', async ({ page }) => {
  const now = await page.evaluate(() => window.__DEMO_NOW__)
  await page.evaluate(({ now, hour }) => {
    const start = now - 48 * hour
    window.__TIMELINE__.update({
      items: Array.from({ length: 48 }, (_, index) => ({
        id: `tracked-hour-${index}`,
        title: `Tracked hour ${index}`,
        startedAt: start + index * hour,
        endedAt: start + (index + 1) * hour,
        isEditable: false,
      })),
      now,
      view: { start, end: now, focusedAt: now },
    })
  }, { now, hour: 60 * 60_000 })

  const result = await page.locator('[data-testid="timeline-viewport"]').evaluate(async (viewport) => {
    const cells = [...viewport.querySelectorAll('.elastic-timeline__cell')]
    const hiddenWhileVisible = []
    const observed = new Set()
    for (let index = 0; index < cells.length; index += 1) {
      viewport.scrollLeft = Math.min(cells[index].offsetLeft, viewport.scrollWidth - viewport.clientWidth)
      viewport.dispatchEvent(new Event('scroll'))
      await new Promise(resolve => requestAnimationFrame(resolve))
      const viewportRect = viewport.getBoundingClientRect()
      for (let candidate = 0; candidate < cells.length; candidate += 1) {
        const cellRect = cells[candidate].getBoundingClientRect()
        if (cellRect.right <= viewportRect.left || cellRect.left >= viewportRect.right) continue
        if (getComputedStyle(cells[candidate]).visibility === 'hidden') continue
        observed.add(candidate)
        if (cells[candidate].querySelector('.elastic-timeline__cell-label')?.hidden) hiddenWhileVisible.push(candidate)
      }
    }
    return {
      count: cells.length,
      observed: observed.size,
      hiddenWhileVisible: [...new Set(hiddenWhileVisible)],
      missing: cells.filter(cell => !cell.querySelector('.elastic-timeline__cell-label')?.textContent?.trim()).length,
      fontSizes: [...new Set(cells.map(cell => getComputedStyle(cell.querySelector('.elastic-timeline__cell-label')).fontSize))],
      labels: cells.map(cell => cell.querySelector('.elastic-timeline__cell-label').textContent),
    }
  })

  expect(result.count).toBeGreaterThanOrEqual(48)
  expect(result.observed).toBe(result.count)
  expect(result.hiddenWhileVisible).toEqual([])
  expect(result.missing).toBe(0)
  expect(result.fontSizes).toEqual(['9px'])
  expect(result.labels.every(label => /^\d{2}:\d{2}$/.test(label))).toBe(true)
})

test('hour labels never leave their own cell boundaries', async ({ page }) => {
  const now = await page.evaluate(() => window.__DEMO_NOW__)
  await page.evaluate(({ now, hour }) => window.__TIMELINE__.update({
    items: [],
    now,
    view: { start: now - 48 * hour, end: now, focusedAt: now },
  }), { now, hour: 60 * 60_000 })

  const escaped = await page.locator('[data-testid="timeline-viewport"]').evaluate(async (viewport) => {
    const failures = []
    const maximum = viewport.scrollWidth - viewport.clientWidth
    for (const requested of [0, 1, maximum * 0.13, maximum * 0.37, maximum * 0.71, maximum - 1, maximum]) {
      viewport.scrollLeft = requested
      viewport.dispatchEvent(new Event('scroll'))
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const viewportRect = viewport.getBoundingClientRect()
      for (const cell of viewport.querySelectorAll('[data-cell-kind="hour"]')) {
        const cellRect = cell.getBoundingClientRect()
        if (cellRect.right <= viewportRect.left || cellRect.left >= viewportRect.right) continue
        const label = cell.querySelector('.elastic-timeline__cell-label')
        const labelRect = label.getBoundingClientRect()
        const shown = getComputedStyle(cell).visibility !== 'hidden'
        const visibleWidth = Math.min(cellRect.right, viewportRect.right) - Math.max(cellRect.left, viewportRect.left)
        if (!shown) {
          if (visibleWidth + 0.5 >= labelRect.width + 2) failures.push({ requested, hiddenWithRoom: label.textContent })
          continue
        }
        if (label.hidden || !/^\d{2}:\d{2}( - \d{2}:\d{2})?$/.test(label.textContent) ||
          label.scrollWidth > label.clientWidth ||
          labelRect.left < cellRect.left - 0.5 || labelRect.right > cellRect.right + 0.5 ||
          labelRect.left < viewportRect.left - 0.5 || labelRect.right > viewportRect.right + 0.5) {
          failures.push({
            requested,
            actual: viewport.scrollLeft,
            label: label.textContent,
            hidden: label.hidden,
            scrollWidth: label.scrollWidth,
            clientWidth: label.clientWidth,
            cell: [cellRect.left, cellRect.right],
            labelRect: [labelRect.left, labelRect.right],
            viewport: [viewportRect.left, viewportRect.right],
          })
        }
      }
    }
    return failures
  })

  expect(escaped).toEqual([])
})

test('day-scale cells never render hour labels', async ({ page }) => {
  const now = await page.evaluate(() => window.__DEMO_NOW__)
  await page.evaluate(({ now, day }) => window.__TIMELINE__.update({
    items: [],
    now,
    view: { start: now - 7 * day, end: now, focusedAt: now },
  }), { now, day: DAY })

  await expect(page.locator('[data-cell-kind="hour"]')).toHaveCount(0)
  const labels = await page.locator('[data-cell-kind="day"] .elastic-timeline__cell-label').allTextContents()
  expect(labels.length).toBeGreaterThan(0)
  expect(labels.some(label => /^\d{2}:\d{2}$/.test(label))).toBe(false)
})

test('empty hour labels use ranges only for gaps longer than one hour', async ({ page }) => {
  const now = await page.evaluate(() => window.__DEMO_NOW__)
  const start = await page.evaluate((timestamp) => {
    const value = new Date(timestamp)
    value.setHours(10, 0, 0, 0)
    return value.getTime()
  }, now)
  const labelsFor = async (items) => {
    await page.evaluate(({ start, hour, items }) => window.__TIMELINE__.update({
      items,
      now: start + 3 * hour,
      view: { start, end: start + 3 * hour, focusedAt: start + 3 * hour },
    }), { start, hour: HOUR, items })
    return page.locator('[data-cell-kind="hour"] .elastic-timeline__cell-label:visible').allTextContents()
  }

  expect(await labelsFor([{
    id: 'tracked-at-twelve',
    title: 'Tracked at twelve',
    startedAt: start + 2 * HOUR,
    endedAt: start + 3 * HOUR,
    isEditable: false,
  }])).toEqual(['10:00 - 12:00', '12:00'])

  expect(await labelsFor([
    {
      id: 'tracked-at-ten',
      title: 'Tracked at ten',
      startedAt: start,
      endedAt: start + HOUR,
      isEditable: false,
    },
    {
      id: 'tracked-at-twelve-again',
      title: 'Tracked at twelve again',
      startedAt: start + 2 * HOUR,
      endedAt: start + 3 * HOUR,
      isEditable: false,
    },
  ])).toEqual(['10:00', '11:00', '12:00'])

  await page.evaluate(({ start, hour }) => window.__TIMELINE__.update({
    items: [],
    now: start + 1.5 * hour,
    view: { start: start + 0.5 * hour, end: start + 1.5 * hour, focusedAt: start + hour },
  }), { start, hour: HOUR })
  expect(await page.locator('[data-cell-kind="hour"] .elastic-timeline__cell-label:visible').allTextContents())
    .toEqual(['10:30'])
})

test('hour-scale header covers time contiguously and groups empty gaps', async ({ page }) => {
  const now = await page.evaluate(() => window.__DEMO_NOW__)
  await page.evaluate(({ now, hour }) => window.__TIMELINE__.update({
    items: [{
      id: 'tracked-hour',
      title: 'Tracked hour',
      startedAt: now - 4 * hour,
      endedAt: now - 3 * hour,
      isEditable: false,
    }],
    now,
    view: { start: now - 8 * hour, end: now, focusedAt: now },
  }), { now, hour: HOUR })

  const segments = await page.locator('[data-label-start]').evaluateAll((elements) => elements.map(element => ({
    start: Number(element.dataset.labelStart),
    end: Number(element.dataset.labelEnd),
    empty: element.dataset.empty === 'true',
    label: element.querySelector('.elastic-timeline__cell-label').textContent,
  })))

  expect(segments[0].start).toBe(now - 8 * HOUR)
  expect(segments.at(-1).end).toBe(now)
  expect(segments.every((segment, index) => index === 0 || segments[index - 1].end === segment.start)).toBe(true)
  expect(segments.filter(segment => segment.empty).some(segment => segment.label.includes(' - '))).toBe(true)
  expect(segments.filter(segment => segment.label.includes(' - ')).every(segment => {
    const [start, end] = segment.label.split(' - ')
    return start !== end
  })).toBe(true)
  expect(segments.filter(segment => !segment.empty).every(segment => /^\d{2}:\d{2}$/.test(segment.label))).toBe(true)
})

test('one wheel tick changes zoom gradually', async ({ page }) => {
  const initial = await view(page)
  const viewport = page.locator('[data-testid="timeline-viewport"]')
  const box = await viewport.boundingBox()
  await page.keyboard.down('Alt')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.wheel(0, -100)
  await page.keyboard.up('Alt')
  const zoomed = await view(page)
  const ratio = (initial.end - initial.start) / (zoomed.end - zoomed.start)

  expect(ratio).toBeGreaterThan(1)
  expect(ratio).toBeLessThanOrEqual(1.05)
})

test('zoom has magnetic resistance at one-day and three-day spans', async ({ page }) => {
  const now = await page.evaluate(() => window.__DEMO_NOW__)
  const viewport = page.locator('[data-testid="timeline-viewport"]')
  const box = await viewport.boundingBox()
  const wheelOut = async () => {
    await page.keyboard.down('Alt')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.wheel(0, 100)
    await page.keyboard.up('Alt')
  }

  await page.evaluate(({ now, day }) => window.__TIMELINE__.update({
    view: { start: now - 0.99 * day, end: now, focusedAt: now },
  }), { now, day: DAY })
  await wheelOut()
  let current = await view(page)
  expect(current.end - current.start).toBe(DAY)
  await wheelOut()
  current = await view(page)
  expect(current.end - current.start).toBeCloseTo(1.01 * DAY, -2)

  await page.evaluate(({ now, day }) => window.__TIMELINE__.update({
    view: { start: now - 2.99 * day, end: now, focusedAt: now },
  }), { now, day: DAY })
  await wheelOut()
  current = await view(page)
  expect(current.end - current.start).toBe(3 * DAY)
})

test('first render is exactly 24 hours ending at now with both edges visible', async ({ page }) => {
  const current = await view(page)
  const now = await page.evaluate(() => window.__DEMO_NOW__)
  const viewport = page.locator('[data-testid="timeline-viewport"]')

  expect(current.end - current.start).toBe(DAY)
  expect(current.end).toBe(now)
  expect(await viewport.evaluate((element) => element.scrollLeft)).toBe(0)
  expect(current.width).toBeLessThanOrEqual((await viewport.boundingBox()).width + 1)
  expect(Date.parse(await page.locator('[data-testid="timeline-end"]').getAttribute('datetime'))).toBe(now)
})

test('a strongly zoomed-out running task remains reachable at the right scroll edge', async ({ page }) => {
  const now = await page.evaluate(() => window.__DEMO_NOW__)
  const viewport = page.locator('[data-testid="timeline-viewport"]')

  await page.evaluate(({ now, day }) => window.__TIMELINE__.update({
    view: { start: now - 7 * day, end: now, focusedAt: now },
    items: [{
      id: 'running-right-edge',
      title: 'Running at the right edge',
      url: 'https://example.test/tasks/running-right-edge',
      startedAt: now - 5 * 60_000,
      endedAt: null,
      isRunning: true,
      isEditable: true,
    }],
  }), { now, day: DAY })

  expect(await viewport.evaluate((element) => element.scrollWidth)).toBeGreaterThan(await viewport.evaluate((element) => element.clientWidth))
  await page.evaluate(() => window.__TIMELINE__.scrollToEnd())
  const scroll = await viewport.evaluate((element) => ({
    left: element.scrollLeft,
    maximum: element.scrollWidth - element.clientWidth,
  }))
  expect(scroll.left).toBeGreaterThan(0)
  expect(Math.abs(scroll.left - scroll.maximum)).toBeLessThanOrEqual(1)
  await expect(page.locator('[data-item-id="running-right-edge"]')).toBeInViewport()
})

test('horizontal wheel reaches elastic overflow at the maximum zoom right boundary', async ({ page }) => {
  const viewport = page.locator('[data-testid="timeline-viewport"]')
  const now = await page.evaluate(() => window.__DEMO_NOW__)
  await page.evaluate(({ now, day }) => {
    const start = now - 7 * day
    const items = Array.from({ length: 28 }, (_, index) => ({
      id: `max-zoom-${index}`,
      title: `Maximum zoom ${index}`,
      rowId: index % 2 ? 'work' : 'personal',
      startedAt: start + index * 10_000,
      endedAt: start + index * 10_000 + 5_000,
    }))
    items.push({ id: 'max-zoom-running', title: 'Maximum zoom running', rowId: 'personal', startedAt: now, endedAt: null, isRunning: true })
    window.__TIMELINE__.update({
      items,
      rows: [{ id: 'personal', title: 'personal' }, { id: 'work', title: 'work' }],
      now,
      view: { start, end: now, focusedAt: now },
    })
  }, { now, day: DAY })

  const initial = await viewport.evaluate(element => ({ left: element.scrollLeft, maximum: element.scrollWidth - element.clientWidth }))
  expect(initial.maximum).toBeGreaterThan(0)
  for (let index = 0; index < 8; index += 1) {
    await viewport.dispatchEvent('wheel', { deltaY: 500, shiftKey: true, bubbles: true, cancelable: true })
  }

  const final = await viewport.evaluate(element => ({ left: element.scrollLeft, maximum: element.scrollWidth - element.clientWidth }))
  expect(Math.abs(final.left - final.maximum)).toBeLessThanOrEqual(1)
  await expect(page.locator('[data-item-id="max-zoom-running"]')).toBeInViewport()
})

test('zooming out from the right edge keeps the rightmost blocks visible', async ({ page }) => {
  const viewport = page.locator('[data-testid="timeline-viewport"]')
  const now = await page.evaluate(() => window.__DEMO_NOW__)
  await page.evaluate(({ now, hour }) => {
    window.__TIMELINE__.update({
      items: [{
        id: 'right-running',
        title: 'Right running',
        rowId: 'main',
        startedAt: now - 1_000,
        endedAt: null,
        isRunning: true,
      }],
      view: { start: now - 47 * hour, end: now, focusedAt: now },
    })
    window.__TIMELINE__.scrollToEnd()
  }, { now, hour: 60 * 60_000 })

  const before = await viewport.evaluate((element) => ({
    left: element.scrollLeft,
    maximum: element.scrollWidth - element.clientWidth,
  }))
  expect(Math.abs(before.left - before.maximum)).toBeLessThanOrEqual(1)
  await expect(page.locator('[data-item-id="right-running"]')).toBeInViewport()

  const box = await viewport.boundingBox()
  await page.keyboard.down('Alt')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.wheel(0, 100)
  await page.keyboard.up('Alt')

  const scroll = await viewport.evaluate((element) => ({
    left: element.scrollLeft,
    maximum: element.scrollWidth - element.clientWidth,
  }))
  expect(scroll.maximum).toBeGreaterThan(0)
  expect(Math.abs(scroll.left - scroll.maximum)).toBeLessThanOrEqual(1)
  await expect(page.locator('[data-item-id="right-running"]')).toBeInViewport()
})

test('a running item starting exactly at now is visible with a clock label at the right edge', async ({ page }) => {
  const now = new Date(2026, 7, 31, 17, 37, 42).getTime()
  await page.evaluate(({ now, day }) => window.__TIMELINE__.update({
    now,
    view: { start: now - day, end: now, focusedAt: now },
    items: [{
      id: 'running-with-edge-label',
      title: 'Running with edge label',
      rowId: 'main',
      startedAt: now,
      endedAt: null,
      isRunning: true,
    }],
  }), { now, day: DAY })

  const running = page.locator('[data-item-id="running-with-edge-label"]')
  await expect(running).toBeVisible()
  await expect(running).toBeInViewport()
  expect((await running.boundingBox()).width).toBeGreaterThanOrEqual(30)
  const edge = page.locator('[data-testid="timeline-current-time"]')
  await expect(edge).toBeVisible()
  await expect(edge).toHaveAttribute('datetime', new Date(now).toISOString())
  const expectedLabel = await page.evaluate((timestamp) => new Intl.DateTimeFormat(undefined, {
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(timestamp)), now)
  await expect(edge).toHaveText(expectedLabel)
  const viewportBox = await page.locator('[data-testid="timeline-viewport"]').boundingBox()
  const edgeBox = await edge.boundingBox()
  expect(edgeBox.x).toBeGreaterThanOrEqual(viewportBox.x - 1)
  expect(edgeBox.x + edgeBox.width).toBeLessThanOrEqual(viewportBox.x + viewportBox.width + 1)
  const overlaps = await page.locator('.elastic-timeline__cell-label:not([hidden])').evaluateAll((labels, edgeElement) => {
    const edgeRect = edgeElement.getBoundingClientRect()
    return labels.filter((label) => {
      const rect = label.getBoundingClientRect()
      return rect.right > edgeRect.left && rect.left < edgeRect.right && rect.bottom > edgeRect.top && rect.top < edgeRect.bottom
    }).map((label) => label.textContent)
  }, await edge.elementHandle())
  expect(overlaps).toEqual([])

  await page.evaluate(({ now, day }) => {
    window.__TIMELINE__.update({ view: { start: now - 7 * day, end: now, focusedAt: now } })
    window.__TIMELINE__.scrollToEnd()
  }, { now, day: DAY })
  await expect(edge).toBeVisible()
  await page.locator('[data-testid="timeline-viewport"]').evaluate((element) => {
    element.scrollLeft = 0
    element.dispatchEvent(new Event('scroll'))
  })
  await expect(edge).toBeHidden()
})

test('dense cross-cell history keeps the current label above a right-edge running block', async ({ page }) => {
  const completedRanges = [
    ['2026-09-03T03:59:15Z', '2026-09-03T03:59:59Z'],
    ['2026-09-03T04:00:00Z', '2026-09-03T04:11:25Z'],
    ['2026-09-03T04:12:44Z', '2026-09-03T04:17:01Z'],
    ['2026-09-03T04:17:02Z', '2026-09-03T04:31:18Z'],
    ['2026-09-03T04:31:19Z', '2026-09-03T04:35:48Z'],
    ['2026-09-03T04:35:49Z', '2026-09-03T04:36:49Z'],
    ['2026-09-03T04:36:50Z', '2026-09-03T04:41:13Z'],
    ['2026-09-03T04:41:14Z', '2026-09-03T04:45:50Z'],
    ['2026-09-03T04:45:51Z', '2026-09-03T04:49:38Z'],
    ['2026-09-03T04:49:39Z', '2026-09-03T04:49:41Z'],
    ['2026-09-03T04:49:42Z', '2026-09-03T04:49:44Z'],
    ['2026-09-03T04:56:14Z', '2026-09-03T04:56:15Z'],
    ['2026-09-03T04:56:15Z', '2026-09-03T04:58:10Z'],
    ['2026-09-03T04:58:11Z', '2026-09-03T04:58:53Z'],
    ['2026-09-03T05:28:09Z', '2026-09-03T06:30:59Z'],
    ['2026-09-03T07:29:22Z', '2026-09-03T07:29:37Z'],
    ['2026-09-03T11:28:01Z', '2026-09-03T11:28:18Z'],
    ['2026-09-03T16:30:39Z', '2026-09-03T16:30:57Z'],
    ['2026-09-04T01:05:03Z', '2026-09-04T01:05:10Z'],
    ['2026-09-04T01:05:10Z', '2026-09-04T01:05:12Z'],
    ['2026-09-04T01:05:12Z', '2026-09-04T01:05:16Z'],
    ['2026-09-04T01:05:16Z', '2026-09-04T01:05:19Z'],
    ['2026-09-04T01:05:19Z', '2026-09-04T03:00:57Z'],
  ]
  const now = Date.parse('2026-09-04T03:01:01Z')
  await page.evaluate(({ completedRanges, now, day }) => {
    const items = completedRanges.map(([startedAt, endedAt], index) => ({
      id: `reported-${index}`,
      title: `Reported ${index}`,
      rowId: index % 3 === 0 ? 'personal' : index % 3 === 1 ? 'work' : 'other',
      startedAt: Date.parse(startedAt),
      endedAt: Date.parse(endedAt),
    }))
    items.push({ id: 'reported-running', title: 'Reported running', rowId: 'personal', startedAt: now, endedAt: null, isRunning: true })
    window.__TIMELINE__.update({
      items,
      rows: [{ id: 'personal', title: 'personal' }, { id: 'work', title: 'work' }, { id: 'other', title: 'Other' }],
      now,
      view: { start: now - day, end: now, focusedAt: now },
    })
    window.__TIMELINE__.scrollToEnd()
  }, { completedRanges, now, day: DAY })

  const running = page.locator('[data-item-id="reported-running"]')
  const current = page.locator('[data-testid="timeline-current-time"]')
  const geometry = await page.evaluate(() => {
    const box = element => element.getBoundingClientRect()
    const viewport = document.querySelector('[data-testid="timeline-viewport"]')
    const canvas = document.querySelector('[data-testid="timeline-canvas"]')
    const running = document.querySelector('[data-item-id="reported-running"]')
    const current = document.querySelector('[data-testid="timeline-current-time"]')
    return { viewport: box(viewport), canvas: box(canvas), running: box(running), current: box(current) }
  })

  await expect(running).toBeInViewport()
  await expect(current).toBeVisible()
  expect(geometry.canvas.right).toBeGreaterThanOrEqual(geometry.running.right - 1)
  expect(geometry.current.right).toBeGreaterThanOrEqual(geometry.running.right - 6)
  expect(geometry.current.left).toBeLessThanOrEqual(geometry.running.right + 1)
  expect(geometry.current.left).toBeGreaterThanOrEqual(geometry.viewport.left - 1)
  expect(geometry.current.right).toBeLessThanOrEqual(geometry.viewport.right + 1)
})

test('button and double-click cannot submit the same pending start twice', async ({ page }) => {
  await page.evaluate(() => {
    window.__DEMO_EVENTS__.length = 0
    window.__TIMELINE__.update({
      onStart(item) {
        window.__DEMO_EVENTS__.push(`pending-start:${item.id}`)
        return new Promise(() => {})
      },
    })
  })

  const item = page.locator('[data-item-id="editable-main"]')
  await item.hover()
  await page.locator('[data-testid="timeline-start-tracking"]').click()
  await item.dispatchEvent('dblclick')

  expect((await emitted(page)).filter((entry) => entry === 'pending-start:editable-main')).toHaveLength(1)
})

test('two ordinary clicks on an unselected block reliably start it', async ({ page }) => {
  await page.evaluate(() => { window.__DEMO_EVENTS__.length = 0 })
  const item = page.locator('[data-item-id="editable-main"]')
  await item.click()
  await page.waitForTimeout(40)
  await item.click()
  expect((await emitted(page)).filter(entry => entry === 'start:editable-main')).toHaveLength(1)
})

test('double-click starts a short task even when the pointer lands on either resize edge', async ({ page }) => {
  await page.evaluate(() => {
    window.__DEMO_EVENTS__.length = 0
    window.__TIMELINE__.update({
      onStart(item) { window.__DEMO_EVENTS__.push(`edge-start:${item.id}`) },
    })
  })
  await page.locator('[data-item-id="editable-main"] [data-testid="resize-left"]').dblclick()
  await page.locator('[data-item-id="editable-next"] [data-testid="resize-right"]').dblclick()
  expect((await emitted(page)).filter(entry => entry.startsWith('edge-start:')))
    .toEqual(['edge-start:editable-main', 'edge-start:editable-next'])
})

test('a pending start disables every task and cannot silently accept a second task', async ({ page }) => {
  await page.evaluate(() => {
    window.__DEMO_EVENTS__.length = 0
    window.__TIMELINE__.update({
      onStart(item) {
        window.__DEMO_EVENTS__.push(`pending-global-start:${item.id}`)
        window.__TIMELINE__.update({
          items: window.__DEMO_ITEMS__.map((candidate) => ({ ...candidate, isStartDisabled: true })),
        })
        return new Promise(() => {})
      },
    })
  })

  const first = page.locator('[data-item-id="editable-main"]')
  await first.hover()
  await page.locator('[data-testid="timeline-start-tracking"]').click()
  await page.locator('[data-item-id="editable-next"]').dispatchEvent('dblclick')

  expect((await emitted(page)).filter((entry) => entry.startsWith('pending-global-start:')))
    .toEqual(['pending-global-start:editable-main'])
})

test('disabled double-click does not start and rejected double-click is handled', async ({ page }) => {
  await page.evaluate(() => {
    window.__DEMO_EVENTS__.length = 0
    window.__TIMELINE__.update({
      items: window.__DEMO_ITEMS__.map((item) => item.id === 'editable-main'
        ? { ...item, isStartDisabled: true }
        : item),
      onStart(item) {
        window.__DEMO_EVENTS__.push(`disabled-start:${item.id}`)
      },
    })
  })
  const item = page.locator('[data-item-id="editable-main"]')
  await item.dispatchEvent('dblclick')
  expect(await emitted(page)).toEqual([])

  await page.evaluate(() => window.__TIMELINE__.update({
    items: window.__DEMO_ITEMS__,
    onStart(item) {
      window.__DEMO_EVENTS__.push(`rejected-start:${item.id}`)
      return Promise.reject(new Error('start rejected'))
    },
  }))
  await item.dispatchEvent('dblclick')
  await page.waitForTimeout(25)
  expect(await emitted(page)).toEqual(['rejected-start:editable-main'])
})

test('resizing exposes only the resize cursor, never a floating guide', async ({ page }) => {
  const item = page.locator('[data-item-id="editable-main"]')
  const handle = item.locator('[data-testid="resize-right"]')
  const box = await handle.boundingBox()

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await expect(handle).toHaveCSS('cursor', 'ew-resize')
  await page.mouse.down()
  await page.mouse.move(box.x + 24, box.y + box.height / 2)
  await expect(page.locator('[data-role="guide"]')).toHaveCount(0)
  await page.mouse.up()
})

test('dense and actual-overlapping fixtures remain single-row within their named row', async ({ page }) => {
  const blocks = await page.locator('[data-testid="timeline-item"]').evaluateAll((elements) =>
    elements.map((element) => ({
      id: element.dataset.itemId,
      left: element.offsetLeft,
      top: element.offsetTop,
      width: element.getBoundingClientRect().width,
    })),
  )
  const dense = blocks.filter(({ id }) => id.startsWith('dense-'))
  const overlap = blocks.filter(({ id }) => id.startsWith('overlap-'))

  expect(dense).toHaveLength(12)
  for (const group of [dense, overlap]) {
    expect(new Set(group.map(({ top }) => top)).size).toBe(1)
    for (const block of group) expect(block.width).toBeGreaterThanOrEqual(30)
    for (let index = 1; index < group.length; index += 1) {
      expect(group[index].left - (group[index - 1].left + group[index - 1].width)).toBeGreaterThanOrEqual(3.5)
    }
  }
})

test('Start tracking and double-click immediately activate the task at the timeline right edge', async ({ page }) => {
  const item = page.locator('[data-item-id="editable-main"]')
  const details = page.locator('[data-testid="timeline-details"]')

  await expect(details).toBeHidden()
  await item.hover()
  await expect(details).toBeVisible()
  await expect(details).toContainText('Редактируемая задача')
  await expect(details).toContainText('Duration:')
  await expect(details).toContainText('Double-click to start this task')
  const start = details.getByRole('button', { name: 'Start tracking' })
  await expect(start).toBeVisible()
  await expect(start).toHaveClass(/elastic-timeline__details-start/)
  const detailsBox = await details.boundingBox()
  const startBox = await start.boundingBox()
  expect(startBox.x + startBox.width).toBeGreaterThan(detailsBox.x + detailsBox.width - 24)
  expect(startBox.y).toBeLessThan(detailsBox.y + detailsBox.height / 2)
  const link = details.getByRole('link')
  await expect(link).toHaveAttribute('href', 'https://example.test/tasks/editable-main?full=true')
  await expect(link).toHaveText('https://example.test/tasks/editable-main?full=true')

  await page.evaluate(() => { window.__DEMO_EVENTS__.length = 0 })
  await start.click()
  expect((await emitted(page)).filter((entry) => entry === 'start:editable-main')).toHaveLength(1)
  const activeFromButton = page.locator('[data-item-id="editable-main"]')
  await expect(activeFromButton).toHaveAttribute('data-running', 'true')
  const canvasBox = await page.locator('.elastic-timeline__canvas').boundingBox()
  const buttonActiveBox = await activeFromButton.boundingBox()
  expect(Math.abs(buttonActiveBox.x + buttonActiveBox.width - (canvasBox.x + canvasBox.width))).toBeLessThanOrEqual(1)

  const next = page.locator('[data-item-id="editable-next"]')
  await next.dblclick()
  expect((await emitted(page)).filter((entry) => entry === 'start:editable-next')).toHaveLength(1)
  await expect(page.locator('[data-item-id="editable-next"]')).toHaveAttribute('data-running', 'true')
  const doubleClickActiveBox = await page.locator('[data-item-id="editable-next"]').boundingBox()
  expect(Math.abs(doubleClickActiveBox.x + doubleClickActiveBox.width - (canvasBox.x + canvasBox.width))).toBeLessThanOrEqual(1)
})

test('a newly accepted running task is immediately visible at minimum width at every scale', async ({ page }) => {
  const result = await page.evaluate(async ({ day }) => {
    const now = window.__DEMO_NOW__
    const target = {
      id: 'instant-start-target',
      title: 'Instant start target',
      url: 'https://example.test/tasks/instant-start-target',
      rowId: 'main',
      startedAt: now - 60_000,
      endedAt: now - 30_000,
      isEditable: true,
    }
    window.__DEMO_ITEMS__ = [target]
    window.__TIMELINE__.update({
      items: window.__DEMO_ITEMS__,
      view: { start: now - 7 * day, end: now, focusedAt: now },
      onStart(item) {
        window.__DEMO_ITEMS__ = [{
          ...item,
          startedAt: now - 1,
          endedAt: null,
          isRunning: true,
          isPending: true,
        }]
        window.__TIMELINE__.update({ items: window.__DEMO_ITEMS__ })
        return new Promise(() => {})
      },
    })
    const item = document.querySelector('[data-item-id="instant-start-target"]')
    item.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
    const running = document.querySelector('[data-item-id="instant-start-target"]')
    const viewport = document.querySelector('[data-testid="timeline-viewport"]')
    const block = running.getBoundingClientRect()
    const visible = viewport.getBoundingClientRect()
    return {
      running: running.dataset.running,
      pending: running.dataset.pending,
      width: block.width,
      left: block.left,
      right: block.right,
      viewportLeft: visible.left,
      viewportRight: visible.right,
      scrollLeft: viewport.scrollLeft,
      maximumScrollLeft: viewport.scrollWidth - viewport.clientWidth,
    }
  }, { day: DAY })

  expect(result.running).toBe('true')
  expect(result.pending).toBe('true')
  expect(result.width).toBeGreaterThanOrEqual(30)
  expect(result.left).toBeGreaterThanOrEqual(result.viewportLeft - 1)
  expect(result.right).toBeLessThanOrEqual(result.viewportRight + 1)
  expect(Math.abs(result.scrollLeft - result.maximumScrollLeft)).toBeLessThanOrEqual(1)
})

test('running task details show a live primary Stop duration action in the top-right', async ({ page }) => {
  const running = page.locator('[data-item-id="running"]')
  const details = page.locator('[data-testid="timeline-details"]')
  await running.hover()
  const stop = details.getByRole('button', { name: /^Stop \d{2,}:\d{2}:\d{2}$/ })
  await expect(stop).toBeVisible()
  await expect(stop).toHaveClass(/elastic-timeline__details-stop/)
  const detailsBox = await details.boundingBox()
  const stopBox = await stop.boundingBox()
  expect(stopBox.x + stopBox.width).toBeGreaterThan(detailsBox.x + detailsBox.width - 24)
  expect(stopBox.y).toBeLessThan(detailsBox.y + detailsBox.height / 2)
  const before = await stop.textContent()
  await expect.poll(() => stop.textContent(), { timeout: 6000 }).not.toBe(before)
  await stop.click()
  expect((await emitted(page)).filter((entry) => entry === 'stop:running')).toHaveLength(1)
})

test('double-clicking a running item stops it exactly once', async ({ page }) => {
  await page.evaluate(() => { window.__DEMO_EVENTS__.length = 0 })
  const running = page.locator('[data-item-id="running"]')
  await running.hover()
  await expect(page.locator('[data-testid="timeline-details"]')).toContainText('Double-click to stop')
  await running.dblclick()
  expect((await emitted(page)).filter((entry) => entry === 'stop:running')).toHaveLength(1)
})

test('task details update live during move and both resize gestures', async ({ page }) => {
  const details = page.locator('[data-testid="timeline-details"]')
  const itemSelector = '[data-item-id="editable-main"]'

  const previewChangesDetails = async (handleSelector, startAt, endAt) => {
    const item = page.locator(itemSelector)
    await item.hover()
    const before = await details.locator('.elastic-timeline__details-time').textContent()
    const target = handleSelector ? item.locator(handleSelector) : item
    const box = await target.boundingBox()
    const y = box.y + box.height / 2
    await page.mouse.move(startAt(box), y)
    await page.mouse.down()
    await page.mouse.move(endAt(box), y, { steps: 3 })
    await expect.poll(() => details.locator('.elastic-timeline__details-time').textContent()).not.toBe(before)
    await page.keyboard.press('Escape')
    await page.mouse.up()
    await expect(details.locator('.elastic-timeline__details-time')).toHaveText(before)
  }

  await previewChangesDetails(null, (box) => box.x + box.width / 2, (box) => box.x + box.width / 2 + 8)
  await previewChangesDetails('[data-testid="resize-left"]', (box) => box.x + box.width / 2, (box) => box.x - 8)
  await previewChangesDetails('[data-testid="resize-right"]', (box) => box.x + box.width / 2, (box) => box.x + box.width + 8)
})

test('details persist after leaving an interval and switch only on a different interval', async ({ page }) => {
  const first = page.locator('[data-item-id="editable-main"]')
  const second = page.locator('[data-item-id="editable-next"]')
  const details = page.locator('[data-testid="timeline-details"]')

  await first.hover()
  await expect(details).toContainText('Редактируемая задача')
  await page.mouse.move(1400, 650)
  await expect(details).toBeVisible()
  await expect(details).toContainText('Редактируемая задача')

  await second.hover()
  await expect(details).toContainText('Следующая задача')
})

test('all completed demo tasks expose move and both resize handles', async ({ page }) => {
  const completed = page.locator('[data-testid="timeline-item"]:not([data-item-id="running"])')
  const count = await completed.count()
  for (let index = 0; index < count; index += 1) {
    const item = completed.nth(index)
    await expect(item).toHaveAttribute('aria-disabled', 'false')
    await expect(item.locator('[data-testid="resize-left"]')).toHaveCount(1)
    await expect(item.locator('[data-testid="resize-right"]')).toHaveCount(1)
  }
})

test('wheel modifiers and keyboard pan change actual view', async ({ page }) => {
  const initial = await view(page)
  const viewport = page.locator('[data-testid="timeline-viewport"]')
  const initialBox = await viewport.boundingBox()
  await page.keyboard.down('Alt')
  await page.mouse.move(initialBox.x + initialBox.width / 2, initialBox.y + initialBox.height / 2)
  await page.mouse.wheel(0, -100)
  await page.keyboard.up('Alt')
  const zoomed = await view(page)
  expect(zoomed.end - zoomed.start).toBeLessThan(initial.end - initial.start)

  await viewport.focus()
  await page.keyboard.press('Alt+ArrowLeft')
  const panned = await view(page)
  expect(panned.start).toBeLessThan(zoomed.start)

  const box = await viewport.boundingBox()
  await page.keyboard.down('Alt')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.wheel(0, 240)
  await page.keyboard.up('Alt')
  const wheelZoomed = await view(page)
  expect(wheelZoomed.end - wheelZoomed.start).toBeGreaterThan(panned.end - panned.start)
})

test('dragged move and resize edges map to the same timestamps as the scale', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { createElasticScale } = await import('/src/timeline/scale.js')
    const canvas = document.querySelector('[data-testid="timeline-canvas"]')
    const viewport = document.querySelector('[data-testid="timeline-viewport"]')
    const scale = createElasticScale({
      viewStart: Number(canvas.dataset.viewStart),
      viewEnd: Number(canvas.dataset.viewEnd),
      items: window.__DEMO_ITEMS__,
      viewportWidth: viewport.clientWidth,
    })
    const target = document.querySelector('[data-item-id="editable-next"]')
    const baseLeft = target.offsetLeft
    const baseRight = baseLeft + target.getBoundingClientRect().width
    const delta = 6
    return {
      delta,
      moveExpected: scale.toTime(baseLeft + delta),
      leftExpected: scale.toTime(baseLeft - delta),
      rightExpected: scale.toTime(baseRight + delta),
    }
  })

  const preview = async (selector, fromX, toX) => {
    await page.evaluate(() => { window.__DEMO_EVENTS__.length = 0 })
    const target = page.locator(selector)
    const box = await target.boundingBox()
    await page.mouse.move(fromX(box), box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(toX(box), box.y + box.height / 2)
    const event = (await emitted(page)).filter((entry) => entry.startsWith('preview:')).at(-1)
    await page.keyboard.press('Escape')
    await page.mouse.up()
    return event.split(':').map(Number)
  }

  const itemSelector = '[data-item-id="editable-next"]'
  const move = await preview(itemSelector, (box) => box.x + box.width / 2, (box) => box.x + box.width / 2 + result.delta)
  const left = await preview(`${itemSelector} [data-testid="resize-left"]`, (box) => box.x + box.width / 2, (box) => box.x + box.width / 2 - result.delta)
  const right = await preview(`${itemSelector} [data-testid="resize-right"]`, (box) => box.x + box.width / 2, (box) => box.x + box.width / 2 + result.delta)

  expect(move[3]).toBeCloseTo(result.moveExpected, 0)
  expect(left[3]).toBeCloseTo(result.leftExpected, 0)
  expect(right[4]).toBeCloseTo(result.rightExpected, 0)
})

test('body drag and both resize handles work without preselection and stay bounded', async ({ page }) => {
  await page.evaluate(() => { window.__DEMO_EVENTS__.length = 0 })
  let item = page.locator('[data-item-id="editable-main"]')
  let box = await item.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 8, box.y + box.height / 2, { steps: 4 })
  await page.mouse.up()
  await expect.poll(async () => (await emitted(page)).some((entry) => entry.startsWith('commit:move:editable-main'))).toBe(true)

  item = page.locator('[data-item-id="editable-main"]')
  const left = item.locator('[data-testid="resize-left"]')
  box = await left.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x - 8, box.y + box.height / 2, { steps: 3 })
  await page.mouse.up()
  await expect.poll(async () => (await emitted(page)).some((entry) => entry.startsWith('commit:resize-left:editable-main'))).toBe(true)

  item = page.locator('[data-item-id="editable-main"]')
  const right = item.locator('[data-testid="resize-right"]')
  box = await right.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + 8, box.y + box.height / 2, { steps: 3 })
  await page.mouse.up()
  await expect.poll(async () => (await emitted(page)).some((entry) => entry.startsWith('commit:resize-right:editable-main'))).toBe(true)

  const state = await page.evaluate(() => window.__DEMO_ITEMS__.find((entry) => entry.id === 'editable-main'))
  const previous = await page.evaluate(() => window.__DEMO_ITEMS__.find((entry) => entry.id === 'editable-previous'))
  const next = await page.evaluate(() => window.__DEMO_ITEMS__.find((entry) => entry.id === 'editable-next'))
  expect(state.startedAt).toBeGreaterThanOrEqual(previous.endedAt)
  expect(state.endedAt).toBeLessThanOrEqual(next.startedAt)
})

test('keyboard edit shortcuts commit', async ({ page }) => {
  await page.evaluate(() => { window.__DEMO_EVENTS__.length = 0 })
  const editable = page.locator('[data-item-id="editable-main"]')
  await editable.focus()
  await page.keyboard.press('Alt+ArrowRight')
  await expect.poll(async () => (await emitted(page)).some((entry) => entry.startsWith('commit:move:editable-main'))).toBe(true)
})

test('right resize changes only the target block geometry', async ({ page }) => {
  await page.evaluate(() => { window.__DEMO_EVENTS__.length = 0 })
  const target = page.locator('[data-item-id="editable-main"]')
  const neighbour = page.locator('[data-item-id="editable-next"]')
  const neighbourBefore = await geometry(neighbour)
  const handle = target.locator('[data-testid="resize-right"]')
  const box = await handle.boundingBox()

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 8, box.y + box.height / 2, { steps: 3 })

  expect(await geometry(neighbour)).toEqual(neighbourBefore)
  await page.mouse.up()
  await expect.poll(async () => (await emitted(page)).some((entry) => entry.startsWith('commit:resize-right:editable-main'))).toBe(true)
  expect(await geometry(neighbour)).toEqual(neighbourBefore)
})

test('editable task can shrink to exactly one minute while retaining a 30px hit target', async ({ page }) => {
  await page.evaluate(() => { window.__DEMO_EVENTS__.length = 0 })
  const target = page.locator('[data-item-id="editable-main"]')
  const left = target.locator('[data-testid="resize-left"]')
  const targetBox = await target.boundingBox()
  const handleBox = await left.boundingBox()

  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(targetBox.x + targetBox.width + 500, handleBox.y + handleBox.height / 2, { steps: 7 })
  await page.mouse.up()

  const item = await page.evaluate(() => window.__DEMO_ITEMS__.find((entry) => entry.id === 'editable-main'))
  expect(item.endedAt - item.startedAt).toBeGreaterThanOrEqual(60_000)
  const targetGeometry = await geometry(target)
  const nextGeometry = await geometry(page.locator('[data-item-id="editable-next"]'))
  expect(targetGeometry.width).toBeGreaterThanOrEqual(30)
  expect(nextGeometry.left).toBeGreaterThanOrEqual(targetGeometry.right + 3.5)
})

test('historically overlapping block shrunk to one minute uses only the 30px minimum width', async ({ page }) => {
  await page.evaluate(() => { window.__DEMO_EVENTS__.length = 0 })
  const target = page.locator('[data-item-id="overlap-02"]')
  const left = target.locator('[data-testid="resize-left"]')
  const targetBox = await target.boundingBox()
  const handleBox = await left.boundingBox()

  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(targetBox.x + targetBox.width + 500, handleBox.y + handleBox.height / 2, { steps: 7 })
  await page.mouse.up()

  const item = await page.evaluate(() => window.__DEMO_ITEMS__.find((entry) => entry.id === 'overlap-02'))
  expect(item.endedAt - item.startedAt).toBe(60_000)
  expect((await geometry(target)).width).toBeCloseTo(30, 0)
})

test('left edge freezes at one minute when pointer continues past the minimum', async ({ page }) => {
  await page.evaluate(() => { window.__DEMO_EVENTS__.length = 0 })
  const target = page.locator('[data-item-id="overlap-01"]')
  const otherItems = page.locator('[data-testid="timeline-item"]:not([data-item-id="overlap-01"])')
  const otherGeometry = () => otherItems.evaluateAll((elements) => elements.map((element) => ({
    id: element.dataset.itemId,
    left: element.offsetLeft,
    width: element.getBoundingClientRect().width,
  })))
  const otherBefore = await otherGeometry()
  const handle = target.locator('[data-testid="resize-left"]')
  const targetBox = await target.boundingBox()
  const handleBox = await handle.boundingBox()
  const y = handleBox.y + handleBox.height / 2

  await page.mouse.move(handleBox.x + handleBox.width / 2, y)
  await page.mouse.down()
  await page.mouse.move(targetBox.x + targetBox.width + 300, y, { steps: 6 })
  const atMinimum = await geometry(target)
  const previewAtMinimum = (await emitted(page)).filter((entry) => entry.startsWith('preview:resize-left:overlap-01')).at(-1)

  await page.mouse.move(targetBox.x + targetBox.width + 700, y, { steps: 6 })
  expect(await geometry(target)).toEqual(atMinimum)
  expect((await emitted(page)).filter((entry) => entry.startsWith('preview:resize-left:overlap-01')).at(-1)).toBe(previewAtMinimum)
  expect(await otherGeometry()).toEqual(otherBefore)
  await page.keyboard.press('Escape')
  await page.mouse.up()
})

test('right edge freezes at one minute when pointer continues past the minimum', async ({ page }) => {
  await page.evaluate(() => { window.__DEMO_EVENTS__.length = 0 })
  const target = page.locator('[data-item-id="editable-main"]')
  const otherItems = page.locator('[data-testid="timeline-item"]:not([data-item-id="editable-main"])')
  const otherGeometry = () => otherItems.evaluateAll((elements) => elements.map((element) => ({
    id: element.dataset.itemId,
    left: element.offsetLeft,
    width: element.getBoundingClientRect().width,
  })))
  const otherBefore = await otherGeometry()
  const handle = target.locator('[data-testid="resize-right"]')
  const targetBox = await target.boundingBox()
  const handleBox = await handle.boundingBox()
  const y = handleBox.y + handleBox.height / 2

  await page.mouse.move(handleBox.x + handleBox.width / 2, y)
  await page.mouse.down()
  await page.mouse.move(targetBox.x - 300, y, { steps: 6 })
  const atMinimum = await geometry(target)
  const previewAtMinimum = (await emitted(page)).filter((entry) => entry.startsWith('preview:resize-right:editable-main')).at(-1)

  await page.mouse.move(targetBox.x - 700, y, { steps: 6 })
  expect(await geometry(target)).toEqual(atMinimum)
  expect((await emitted(page)).filter((entry) => entry.startsWith('preview:resize-right:editable-main')).at(-1)).toBe(previewAtMinimum)
  expect(await otherGeometry()).toEqual(otherBefore)
  await page.keyboard.press('Escape')
  await page.mouse.up()
})

test('summary shows start left, tracked total centered, and end right', async ({ page }) => {
  const summary = page.locator('[data-testid="timeline-summary"]')
  const start = summary.locator('[data-testid="timeline-start"]')
  const total = summary.locator('[data-testid="timeline-total"]')
  const end = summary.locator('[data-testid="timeline-end"]')
  const [summaryBox, startBox, totalBox, endBox] = await Promise.all([
    summary.boundingBox(), start.boundingBox(), total.boundingBox(), end.boundingBox(),
  ])

  expect(startBox.x).toBeLessThan(totalBox.x)
  expect(totalBox.x + totalBox.width / 2).toBeCloseTo(summaryBox.x + summaryBox.width / 2, 0)
  expect(endBox.x).toBeGreaterThan(totalBox.x)
  await expect(total).toContainText('Tracked:')
  expect(parseFloat(await total.evaluate((element) => getComputedStyle(element).fontSize)))
    .toBeGreaterThan(parseFloat(await start.evaluate((element) => getComputedStyle(element).fontSize)))
})

test('summary action sits between tracked total and the right boundary and fires once', async ({ page }) => {
  await page.evaluate(() => window.__TIMELINE__.update({
    summaryActionLabel: 'Track this task',
    onSummaryAction() { window.__DEMO_EVENTS__.push('track-current') },
  }))
  const total = page.locator('[data-testid="timeline-total"]')
  const action = page.locator('[data-testid="timeline-summary-action"]')
  const end = page.locator('[data-testid="timeline-end"]')
  const [totalBox, actionBox, endBox] = await Promise.all([total.boundingBox(), action.boundingBox(), end.boundingBox()])

  await expect(action).toHaveText('Track this task')
  expect(actionBox.x).toBeGreaterThan(totalBox.x + totalBox.width)
  expect(actionBox.x + actionBox.width).toBeLessThan(endBox.x)
  const expectedCenter = (totalBox.x + totalBox.width + endBox.x) / 2
  expect(actionBox.x + actionBox.width / 2).toBeCloseTo(expectedCenter, 0)
  const beforeHover = await action.evaluate((element) => {
    const style = getComputedStyle(element)
    return { backgroundColor: style.backgroundColor, borderColor: style.borderColor, color: style.color }
  })
  await action.hover()
  expect(await action.evaluate((element) => {
    const style = getComputedStyle(element)
    return { backgroundColor: style.backgroundColor, borderColor: style.borderColor, color: style.color }
  })).toEqual(beforeHover)
  await action.click()
  expect((await emitted(page)).filter(event => event === 'track-current')).toEqual(['track-current'])
})

test('summary action waits for its stylesheet before becoming visible in the correct position', async ({ page }) => {
  await page.evaluate(() => {
    const root = document.querySelector('.elastic-timeline')
    const action = document.querySelector('[data-testid="timeline-summary-action"]')
    root.style.setProperty('--et-summary-layout-ready', '0')
    action.style.visibility = 'hidden'
    window.__TIMELINE__.update({
      summaryActionLabel: 'Track this task',
      onSummaryAction() {},
    })
  })
  const action = page.locator('[data-testid="timeline-summary-action"]')
  await expect(action).toBeHidden()

  await page.locator('.elastic-timeline').evaluate((root) => root.style.removeProperty('--et-summary-layout-ready'))
  await expect(action).toBeVisible()
  const total = page.locator('[data-testid="timeline-total"]')
  const end = page.locator('[data-testid="timeline-end"]')
  const [totalBox, actionBox, endBox] = await Promise.all([total.boundingBox(), action.boundingBox(), end.boundingBox()])
  expect(actionBox.x + actionBox.width / 2).toBeCloseTo((totalBox.x + totalBox.width + endBox.x) / 2, 0)
})

test('summary action remains contained at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 })
  await page.evaluate(() => {
    window.__summaryActions = []
    window.__TIMELINE__.update({
      summaryActionLabel: 'Track this task',
      onSummaryAction: () => window.__summaryActions.push('track'),
    })
  })

  const summary = page.locator('[data-testid="timeline-summary"]')
  const metrics = await summary.evaluate((node) => ({ clientWidth: node.clientWidth, scrollWidth: node.scrollWidth }))
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth)
  await expect(summary.locator('[data-testid="timeline-summary-action"]')).toBeVisible()
})

test('Delete is immediately left of Start tracking and Stop and invokes the selected item action', async ({ page }) => {
  await page.evaluate(() => window.__TIMELINE__.update({
    onDelete(item) { window.__DEMO_EVENTS__.push(`delete:${item.id}`) },
  }))
  const details = page.locator('[data-testid="timeline-details"]')
  await page.locator('[data-item-id="editable-main"]').hover()
  const deleteCompleted = details.getByRole('button', { name: 'Delete' })
  const start = details.getByRole('button', { name: 'Start tracking' })
  let [deleteBox, primaryBox] = await Promise.all([deleteCompleted.boundingBox(), start.boundingBox()])
  expect(deleteBox.x + deleteBox.width).toBeLessThan(primaryBox.x)
  await deleteCompleted.click()
  expect(await emitted(page)).toContain('delete:editable-main')

  await page.locator('[data-item-id="running"]').hover()
  const deleteRunning = details.getByRole('button', { name: 'Delete' })
  const stop = details.getByRole('button', { name: /^Stop \d{2,}:\d{2}:\d{2}$/ })
  ;[deleteBox, primaryBox] = await Promise.all([deleteRunning.boundingBox(), stop.boundingBox()])
  expect(deleteBox.x + deleteBox.width).toBeLessThan(primaryBox.x)
  await deleteRunning.click()
  expect(await emitted(page)).toContain('delete:running')
})

test('Delete and Backspace keys invoke the same action as the selected item Delete button', async ({ page }) => {
  await page.evaluate(() => window.__TIMELINE__.update({
    onDelete(item) { window.__DEMO_EVENTS__.push(`delete:${item.id}`) },
  }))
  const target = page.locator('[data-item-id="editable-main"]')
  await target.click()
  await target.press('Delete')
  await target.press('Backspace')
  expect((await emitted(page)).filter(event => event === 'delete:editable-main')).toHaveLength(2)
})

test('named rows render separately and editing stays within its row', async ({ page }) => {
  const labels = page.locator('[data-testid="timeline-row-label"]')
  await expect(labels).toHaveText(['Короткие задачи', 'Основные задачи'])
  const dense = page.locator('[data-item-id="dense-01"]')
  const main = page.locator('[data-item-id="editable-main"]')
  expect((await dense.boundingBox()).y).not.toBe((await main.boundingBox()).y)

  await page.evaluate(() => { window.__DEMO_EVENTS__.length = 0 })
  const mainBefore = await geometry(main)
  const denseBox = await dense.boundingBox()
  const mainBox = await main.boundingBox()
  await page.mouse.move(denseBox.x + denseBox.width / 2, denseBox.y + denseBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(denseBox.x + denseBox.width / 2 + 10, mainBox.y + 10, { steps: 4 })
  await page.mouse.up()
  expect(await geometry(main)).toEqual(mainBefore)
  const denseAfter = await page.evaluate(() => window.__DEMO_ITEMS__.find((entry) => entry.id === 'dense-01'))
  expect(denseAfter.rowId).toBe('short')
})

test('different rows share one horizontal layout and overlap only when time overlaps', async ({ page }) => {
  await page.evaluate(() => {
    const now = window.__DEMO_NOW__
    window.__DEMO_ITEMS__ = [
      { id: 'row-a', title: 'A', rowId: 'a', startedAt: now - 60_000, endedAt: now - 55_000 },
      { id: 'row-overlap', title: 'Overlap', rowId: 'b', startedAt: now - 59_000, endedAt: now - 56_000 },
      { id: 'row-b', title: 'B', rowId: 'b', startedAt: now - 54_000, endedAt: now - 49_000 },
      { id: 'row-c', title: 'C', rowId: 'a', startedAt: now - 48_000, endedAt: now - 43_000 },
    ]
    window.__TIMELINE__.update({
      items: window.__DEMO_ITEMS__,
      rows: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }],
      view: { start: now - 60 * 60_000, end: now, focusedAt: now },
    })
  })
  const boxes = await page.locator('[data-testid="timeline-item"]').evaluateAll(elements => Object.fromEntries(elements.map(element => {
    const box = element.getBoundingClientRect()
    return [element.dataset.itemId, { left: box.left, right: box.right, top: box.top }]
  })))

  expect(boxes['row-b'].left).toBeGreaterThanOrEqual(boxes['row-a'].right + 3.5)
  expect(boxes['row-c'].left).toBeGreaterThanOrEqual(boxes['row-b'].right + 3.5)
  expect(boxes['row-overlap'].left).toBeLessThan(boxes['row-a'].right)
  expect(boxes['row-overlap'].right).toBeGreaterThan(boxes['row-a'].left)
  expect(boxes['row-a'].top).not.toBe(boxes['row-overlap'].top)
})

test('move and resize treat blocks in every row as chronological neighbours', async ({ page }) => {
  const reset = async () => page.evaluate(() => {
    const now = window.__DEMO_NOW__
    window.__DEMO_ITEMS__ = [
      { id: 'cross-row-previous', title: 'Previous', rowId: 'other-a', startedAt: now - 40 * 60_000, endedAt: now - 35 * 60_000, isEditable: false },
      { id: 'cross-row-target', title: 'Target', rowId: 'target', startedAt: now - 30 * 60_000, endedAt: now - 25 * 60_000, isEditable: true },
      { id: 'cross-row-next', title: 'Next', rowId: 'other-b', startedAt: now - 20 * 60_000, endedAt: now - 15 * 60_000, isEditable: false },
    ]
    window.__TIMELINE__.update({
      items: window.__DEMO_ITEMS__,
      rows: [
        { id: 'other-a', title: 'Other A' },
        { id: 'target', title: 'Target' },
        { id: 'other-b', title: 'Other B' },
      ],
      view: { start: now - 60 * 60_000, end: now, focusedAt: now },
      onEditCommit(edit) {
        window.__DEMO_ITEMS__ = window.__DEMO_ITEMS__.map(item => item.id === edit.id
          ? { ...item, startedAt: edit.startedAt, endedAt: edit.endedAt }
          : item)
        window.__TIMELINE__.update({ items: window.__DEMO_ITEMS__ })
      },
    })
  })
  const drag = async (handle, deltaX) => {
    const box = await handle.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + deltaX, box.y + box.height / 2, { steps: 8 })
    await page.mouse.up()
  }
  const current = () => page.evaluate(() => ({
    target: window.__DEMO_ITEMS__.find(item => item.id === 'cross-row-target'),
    previous: window.__DEMO_ITEMS__.find(item => item.id === 'cross-row-previous'),
    next: window.__DEMO_ITEMS__.find(item => item.id === 'cross-row-next'),
  }))

  await reset()
  const target = page.locator('[data-item-id="cross-row-target"]')
  const next = page.locator('[data-item-id="cross-row-next"]')
  const targetBox = await target.boundingBox()
  const nextBefore = await geometry(next)
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(targetBox.x + targetBox.width / 2 + 10_000, targetBox.y + targetBox.height / 2, { steps: 8 })
  const atCrossRowBoundary = await geometry(target)
  expect(atCrossRowBoundary.right).toBeLessThanOrEqual(nextBefore.left - 3.5)
  await page.mouse.move(targetBox.x + targetBox.width / 2 + 15_000, targetBox.y + targetBox.height / 2, { steps: 4 })
  expect(await geometry(target)).toEqual(atCrossRowBoundary)
  await page.mouse.up()
  let items = await current()
  expect(items.target.endedAt).toBeLessThan(items.next.startedAt)

  await reset()
  await drag(page.locator('[data-item-id="cross-row-target"]'), -10_000)
  items = await current()
  expect(items.target.startedAt).toBeGreaterThan(items.previous.endedAt)

  await reset()
  await drag(page.locator('[data-item-id="cross-row-target"] [data-testid="resize-right"]'), 10_000)
  items = await current()
  expect(items.target.endedAt).toBeLessThan(items.next.startedAt)

  await reset()
  await drag(page.locator('[data-item-id="cross-row-target"] [data-testid="resize-left"]'), -10_000)
  items = await current()
  expect(items.target.startedAt).toBeGreaterThan(items.previous.endedAt)
})

test('project names stay small in the top-left of each row without overlapping time blocks', async ({ page }) => {
  const result = await page.locator('[data-testid="timeline-row-label"]').evaluateAll((labels) => labels.map((label) => {
    const row = label.closest('.elastic-timeline__row')
    const item = document.querySelector(`[data-testid="timeline-item"][data-row-id="${CSS.escape(row.dataset.rowId)}"]`)
    const rowBox = row.getBoundingClientRect()
    const labelBox = label.getBoundingClientRect()
    const itemBox = item?.getBoundingClientRect() ?? null
    return {
      rowLeft: rowBox.left,
      rowTop: rowBox.top,
      labelLeft: labelBox.left,
      labelTop: labelBox.top,
      labelBottom: labelBox.bottom,
      itemTop: itemBox?.top ?? null,
      fontSize: parseFloat(getComputedStyle(label).fontSize),
    }
  }))

  expect(result).toHaveLength(2)
  for (const row of result) {
    expect(row.labelLeft).toBeGreaterThanOrEqual(row.rowLeft)
    expect(row.labelLeft - row.rowLeft).toBeLessThanOrEqual(10)
    expect(row.labelTop - row.rowTop).toBeLessThanOrEqual(4)
    expect(row.fontSize).toBeLessThanOrEqual(10)
    expect(row.itemTop).not.toBeNull()
    expect(row.labelBottom).toBeLessThanOrEqual(row.itemTop - 2)
  }
})

test('connector stays visually above selected and dragged blocks', async ({ page }) => {
  const connector = page.locator('[data-testid="timeline-connector"][data-from-id="overlap-01"][data-to-id="overlap-02"]')
  const target = page.locator('[data-item-id="overlap-01"]')
  await target.click()
  const selectedLayers = await Promise.all([
    connector.evaluate((element) => Number(getComputedStyle(element).zIndex)),
    target.evaluate((element) => Number(getComputedStyle(element).zIndex)),
  ])
  expect(selectedLayers[0]).toBeGreaterThan(selectedLayers[1])

  const box = await target.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 8, box.y + box.height / 2)
  const draggedLayers = await Promise.all([
    connector.evaluate((element) => Number(getComputedStyle(element).zIndex)),
    target.evaluate((element) => Number(getComputedStyle(element).zIndex)),
  ])
  expect(draggedLayers[0]).toBeGreaterThan(draggedLayers[1])
  await page.keyboard.press('Escape')
  await page.mouse.up()
})

test('one-second neighbours are joined by a non-interactive connector dot', async ({ page }) => {
  const from = page.locator('[data-item-id="overlap-01"]')
  const to = page.locator('[data-item-id="overlap-02"]')
  const connector = page.locator('[data-testid="timeline-connector"][data-from-id="overlap-01"][data-to-id="overlap-02"]')
  const [fromBox, toBox, connectorBox] = await Promise.all([
    from.boundingBox(), to.boundingBox(), connector.boundingBox(),
  ])

  await expect(connector).toHaveCSS('pointer-events', 'none')
  expect(connectorBox.x + connectorBox.width / 2)
    .toBeCloseTo((fromBox.x + fromBox.width + toBox.x) / 2, 0)
  expect(connectorBox.y + connectorBox.height / 2)
    .toBeCloseTo(fromBox.y + fromBox.height / 2, 0)
})

test('zero-gap neighbours are joined by a non-interactive connector dot', async ({ page }) => {
  await page.evaluate(() => {
    const startedAt = window.__DEMO_NOW__ - 5 * 60_000
    const touchingAt = startedAt + 2 * 60_000
    window.__DEMO_ITEMS__ = [
      { id: 'zero-gap-first', title: 'First', url: 'https://example.test/first', rowId: 'main', startedAt, endedAt: touchingAt },
      { id: 'zero-gap-second', title: 'Second', url: 'https://example.test/second', rowId: 'main', startedAt: touchingAt, endedAt: touchingAt + 2 * 60_000 },
    ]
    window.__TIMELINE__.update({ items: window.__DEMO_ITEMS__ })
  })

  const connector = page.locator('[data-testid="timeline-connector"][data-from-id="zero-gap-first"][data-to-id="zero-gap-second"]')
  await expect(connector).toBeVisible()
  await expect(connector).toHaveCSS('pointer-events', 'none')
})

test('visually adjacent blocks with a real timestamp gap have no connector dot', async ({ page }) => {
  const connector = page.locator('[data-testid="timeline-connector"][data-from-id="dense-10"][data-to-id="dense-11"]')
  await expect(connector).toHaveCount(0)
})

test('retained details show a downward pointer from the selected interval', async ({ page }) => {
  const item = page.locator('[data-item-id="editable-main"]')
  await item.hover()
  await expect(item).toHaveAttribute('data-details-active', 'true')
  await expect(page.locator('[data-testid="timeline-details-pointer"]')).toHaveCount(1)
})

test('connector disappears during a resize that breaks one-second adjacency and returns on cancel', async ({ page }) => {
  const connector = page.locator('[data-testid="timeline-connector"][data-from-id="overlap-01"][data-to-id="overlap-02"]')
  await expect(connector).toHaveCount(1)
  const handle = page.locator('[data-item-id="overlap-01"] [data-testid="resize-right"]')
  const box = await handle.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 - 12, box.y + box.height / 2, { steps: 4 })
  await expect(connector).toHaveCount(0)
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect(connector).toHaveCount(1)
})

test('connector appears when resize reaches the one-second neighbour boundary', async ({ page }) => {
  const connector = page.locator('[data-testid="timeline-connector"][data-from-id="dense-10"][data-to-id="dense-11"]')
  await expect(connector).toHaveCount(0)
  const handle = page.locator('[data-item-id="dense-10"] [data-testid="resize-right"]')
  const box = await handle.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(10_000, box.y + box.height / 2, { steps: 8 })
  await expect(connector).toHaveCount(1)
  await page.mouse.up()
  await expect(connector).toHaveCount(1)
})

test('connector survives matching pending acceptance followed by a stale parent update', async ({ page }) => {
  await page.evaluate(() => {
    window.__LAST_PENDING_EDIT__ = null
    window.__TIMELINE__.update({
      onEditCommit: (edit) => {
        window.__LAST_PENDING_EDIT__ = edit
        const accepted = window.__DEMO_ITEMS__.map((item) => item.id === edit.id
          ? { ...item, startedAt: edit.startedAt, endedAt: edit.endedAt, isPending: true }
          : item)
        window.__TIMELINE__.update({ items: accepted })
        return new Promise(() => {})
      },
    })
  })
  const connector = page.locator('[data-testid="timeline-connector"][data-from-id="editable-previous"][data-to-id="editable-main"]')
  const target = page.locator('[data-item-id="editable-main"]')
  const box = await target.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(-10_000, box.y + box.height / 2, { steps: 8 })
  await page.mouse.up()
  await expect(connector).toHaveCount(1)

  await page.evaluate(() => window.__TIMELINE__.update({ items: window.__DEMO_ITEMS__ }))
  await expect(connector).toHaveCount(1)
})

test('a locally queued pending block remains editable for a second correction', async ({ page }) => {
  await page.evaluate(() => {
    window.__PENDING_CORRECTIONS__ = []
    const item = window.__DEMO_ITEMS__.find((candidate) => candidate.id === 'editable-main')
    window.__TIMELINE__.update({
      items: window.__DEMO_ITEMS__.map((candidate) => candidate.id === item.id
        ? { ...candidate, isPending: true }
        : candidate),
      onEditCommit(edit) {
        window.__PENDING_CORRECTIONS__.push(edit)
        window.__DEMO_ITEMS__ = window.__DEMO_ITEMS__.map((candidate) => candidate.id === edit.id
          ? { ...candidate, startedAt: edit.startedAt, endedAt: edit.endedAt, isPending: true }
          : candidate)
        window.__TIMELINE__.update({ items: window.__DEMO_ITEMS__ })
      },
    })
  })

  const target = page.locator('[data-item-id="editable-main"]')
  await expect(target.locator('[data-testid="resize-left"]')).toHaveCount(1)
  for (const delta of [24, -24]) {
    const box = await target.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + delta, box.y + box.height / 2, { steps: 4 })
    await page.mouse.up()
  }

  expect(await page.evaluate(() => window.__PENDING_CORRECTIONS__.length)).toBe(2)
  await expect(target).toHaveAttribute('data-pending', 'true')
})

test('connector self-heals while both connected blocks remain rendered', async ({ page }) => {
  const connector = page.locator('[data-testid="timeline-connector"][data-from-id="overlap-01"][data-to-id="overlap-02"]')
  await expect(connector).toBeVisible()
  await connector.evaluate((element) => element.remove())
  await expect(connector).toBeVisible()
})

test('connected rendered blocks retain exactly one visible connector through repeated updates', async ({ page }) => {
  const missing = await page.evaluate(async () => {
    const now = window.__DEMO_NOW__
    const first = {
      id: 'invariant-first', title: 'Invariant first', rowId: 'main',
      startedAt: now - 20 * 60_000, endedAt: now - 10 * 60_000 - 1_000, isEditable: true,
    }
    const second = {
      id: 'invariant-second', title: 'Invariant second', rowId: 'main',
      startedAt: now - 10 * 60_000, endedAt: now - 5 * 60_000, isEditable: true,
    }
    const failures = []
    for (let iteration = 0; iteration < 40; iteration += 1) {
      window.__TIMELINE__.update({
        items: [
          { ...first, title: `Invariant first ${iteration}` },
          { ...second, isPending: iteration % 2 === 0 },
        ],
      })
      await new Promise(requestAnimationFrame)
      const blocks = document.querySelectorAll('[data-item-id="invariant-first"], [data-item-id="invariant-second"]')
      const connectors = document.querySelectorAll('[data-testid="timeline-connector"][data-from-id="invariant-first"][data-to-id="invariant-second"]')
      const connector = connectors[0]
      if (blocks.length !== 2 || connectors.length !== 1 || !connector || connector.getClientRects().length !== 1
          || getComputedStyle(connector).display === 'none' || getComputedStyle(connector).visibility === 'hidden') {
        failures.push(iteration)
      }
    }
    return failures
  })

  expect(missing).toEqual([])
})

test('connector survives a synchronous optimistic parent acceptance during move commit', async ({ page }) => {
  await page.evaluate(() => {
    window.__TIMELINE__.update({
      onEditCommit: (edit) => {
        window.__DEMO_ITEMS__ = window.__DEMO_ITEMS__.map((item) => item.id === edit.id
          ? { ...item, startedAt: edit.startedAt, endedAt: edit.endedAt, isPending: true }
          : item)
        window.__TIMELINE__.update({ items: window.__DEMO_ITEMS__ })
        return new Promise(() => {})
      },
    })
  })
  const connector = page.locator('[data-testid="timeline-connector"][data-from-id="editable-previous"][data-to-id="editable-main"]')
  const target = page.locator('[data-item-id="editable-main"]')
  const box = await target.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(-10_000, box.y + box.height / 2, { steps: 8 })
  await expect(connector).toHaveCount(1)
  await page.mouse.up()
  await expect(connector).toHaveCount(1)
})

test('connector survives pointerup and stale parent updates while a glued edit is pending', async ({ page }) => {
  await page.evaluate(() => {
    window.__LAST_DELAYED_EDIT__ = null
    window.__TIMELINE__.update({
      onEditCommit: (edit) => {
        window.__LAST_DELAYED_EDIT__ = edit
        return new Promise(() => {})
      },
    })
  })
  const connector = page.locator('[data-testid="timeline-connector"][data-from-id="dense-10"][data-to-id="dense-11"]')
  const handle = page.locator('[data-item-id="dense-10"] [data-testid="resize-right"]')
  const box = await handle.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(10_000, box.y + box.height / 2, { steps: 8 })
  await expect(connector).toHaveCount(1)
  await page.mouse.up()

  await expect(connector).toHaveCount(1)
  await page.evaluate(() => window.__TIMELINE__.update({ items: window.__DEMO_ITEMS__ }))
  await expect(connector).toHaveCount(1)

  await page.evaluate(() => {
    const edit = window.__LAST_DELAYED_EDIT__
    const items = window.__DEMO_ITEMS__.map((item) => item.id === edit.id
      ? { ...item, startedAt: edit.startedAt, endedAt: edit.endedAt }
      : item)
    window.__TIMELINE__.update({ items })
  })
  await expect(connector).toHaveCount(1)
})

test('connector appears when moving reaches the one-second neighbour boundary', async ({ page }) => {
  const connector = page.locator('[data-testid="timeline-connector"][data-from-id="dense-10"][data-to-id="dense-11"]')
  await expect(connector).toHaveCount(0)
  const target = page.locator('[data-item-id="dense-10"]')
  const box = await target.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(10_000, box.y + box.height / 2, { steps: 8 })
  await expect(connector).toHaveCount(1)
  await page.mouse.up()
  await expect(connector).toHaveCount(1)
})

test('STOP keeps a one-second connector while the completed item is accepted locally', async ({ page }) => {
  await page.evaluate(() => {
    const now = window.__DEMO_NOW__
    const previous = {
      id: 'stop-previous', title: 'Previous before stop', rowId: 'main',
      startedAt: now - 20 * 60_000, endedAt: now - 5 * 60_000 - 1_000, isEditable: true,
    }
    const running = {
      id: 'stop-running', title: 'Running to stop', rowId: 'main',
      startedAt: now - 5 * 60_000, endedAt: null, isRunning: true, isEditable: true,
    }
    window.__TIMELINE__.update({
      items: [previous, running],
      onStop(item) {
        window.__TIMELINE__.update({
          items: [previous, { ...item, endedAt: now, isRunning: false, isPending: true }],
        })
        return new Promise(() => {})
      },
    })
  })

  const connector = page.locator('[data-testid="timeline-connector"][data-from-id="stop-previous"][data-to-id="stop-running"]')
  await expect(connector).toHaveCount(1)
  await page.locator('[data-item-id="stop-running"]').hover()
  await page.locator('[data-testid="timeline-stop"]').click()
  await expect(connector).toHaveCount(1)
})

test('running task pulses and no now line is rendered', async ({ page }) => {
  const running = page.locator('[data-item-id="running"]')
  await expect(running).not.toHaveCSS('animation-name', 'none')
  await expect(page.locator('[data-testid="now-line"]')).toHaveCount(0)
})

test('blocks use a thin border and running pulse is prominent', async ({ page }) => {
  const regular = page.locator('[data-item-id="editable-main"]')
  const running = page.locator('[data-item-id="running"]')
  await expect(regular).toHaveCSS('border-top-width', '1px')
  await expect(running).toHaveCSS('border-top-width', '1px')
  const pulse = await running.evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      duration: parseFloat(style.animationDuration),
      name: style.animationName,
    }
  })
  expect(pulse.name).toBe('elastic-timeline-pulse')
  expect(pulse.duration).toBeLessThanOrEqual(1.4)
})

test('right resize reaches exactly one snap before the next block', async ({ page }) => {
  await page.evaluate(() => { window.__DEMO_EVENTS__.length = 0 })
  const target = page.locator('[data-item-id="editable-main"]')
  const next = page.locator('[data-item-id="editable-next"]')
  const handle = target.locator('[data-testid="resize-right"]')
  const handleBox = await handle.boundingBox()
  const nextBox = await next.boundingBox()

  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(nextBox.x + 200, handleBox.y + handleBox.height / 2, { steps: 6 })
  await page.mouse.up()

  const targetAfter = await page.evaluate(() => window.__DEMO_ITEMS__.find((item) => item.id === 'editable-main'))
  const nextAfter = await page.evaluate(() => window.__DEMO_ITEMS__.find((item) => item.id === 'editable-next'))
  expect(targetAfter.endedAt).toBeLessThanOrEqual(nextAfter.startedAt - 1_000)
  const targetGeometry = await geometry(target)
  const nextGeometry = await geometry(next)
  expect(nextGeometry.left).toBeGreaterThanOrEqual(targetGeometry.right + 3.5)
})

test('left resize time stops changing after visual contact with the previous block', async ({ page }) => {
  await page.evaluate(() => { window.__DEMO_EVENTS__.length = 0 })
  const target = page.locator('[data-item-id="editable-main"]')
  const previous = page.locator('[data-item-id="editable-previous"]')
  const handle = target.locator('[data-testid="resize-left"]')
  const handleBox = await handle.boundingBox()
  const previousBox = await previous.boundingBox()
  const contactClientX = previousBox.x + previousBox.width + 4

  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(contactClientX, handleBox.y + handleBox.height / 2, { steps: 4 })
  const atContact = (await emitted(page)).filter((entry) => entry.startsWith('preview:resize-left:editable-main')).at(-1)

  await page.mouse.move(contactClientX - 200, handleBox.y + handleBox.height / 2, { steps: 4 })
  const beyondContact = (await emitted(page)).filter((entry) => entry.startsWith('preview:resize-left:editable-main')).at(-1)

  expect(beyondContact).toBe(atContact)
  await page.keyboard.press('Escape')
  await page.mouse.up()
})

test('moving or resizing the first short block leaves every later block fixed', async ({ page }) => {
  await page.evaluate(() => { window.__DEMO_EVENTS__.length = 0 })
  const first = page.locator('[data-item-id="dense-01"]')
  const later = page.locator('[data-item-id^="dense-"]:not([data-item-id="dense-01"])')
  const laterBefore = await later.evaluateAll((elements) => elements.map((element) => ({
    id: element.dataset.itemId,
    left: element.offsetLeft,
    width: element.getBoundingClientRect().width,
  })))
  const handle = first.locator('[data-testid="resize-left"]')
  const box = await handle.boundingBox()

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 - 10, box.y + box.height / 2, { steps: 3 })

  const laterGeometry = () => later.evaluateAll((elements) => elements.map((element) => ({
    id: element.dataset.itemId,
    left: element.offsetLeft,
    width: element.getBoundingClientRect().width,
  })))
  expect(await laterGeometry()).toEqual(laterBefore)
  await page.mouse.up()
  await expect.poll(async () => (await emitted(page)).some((entry) => entry.startsWith('commit:resize-left:dense-01'))).toBe(true)
  expect(await laterGeometry()).toEqual(laterBefore)
})

test('moving the first short block left leaves every later block fixed', async ({ page }) => {
  await page.evaluate(() => { window.__DEMO_EVENTS__.length = 0 })
  const first = page.locator('[data-item-id="dense-01"]')
  const later = page.locator('[data-item-id^="dense-"]:not([data-item-id="dense-01"])')
  const laterGeometry = () => later.evaluateAll((elements) => elements.map((element) => ({
    id: element.dataset.itemId,
    left: element.offsetLeft,
    width: element.getBoundingClientRect().width,
  })))
  const laterBefore = await laterGeometry()
  const box = await first.boundingBox()

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 - 10, box.y + box.height / 2, { steps: 3 })
  expect(await laterGeometry()).toEqual(laterBefore)
  await page.mouse.up()

  await expect.poll(async () => (await emitted(page)).some((entry) => entry.startsWith('commit:move:dense-01'))).toBe(true)
  expect(await laterGeometry()).toEqual(laterBefore)
})

test('resizing a short block follows the scale without moving its neighbour', async ({ page }) => {
  await page.evaluate(() => { window.__DEMO_EVENTS__.length = 0 })
  const target = page.locator('[data-item-id="dense-12"]')
  const neighbour = page.locator('[data-item-id="overlap-01"]')
  const targetBefore = await geometry(target)
  const neighbourBefore = await geometry(neighbour)
  const handle = target.locator('[data-testid="resize-right"]')
  const box = await handle.boundingBox()

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 6, box.y + box.height / 2, { steps: 3 })

  const targetDuring = await geometry(target)
  expect(targetDuring.width).toBeGreaterThan(targetBefore.width)
  expect(targetDuring.right).toBeLessThan(neighbourBefore.left - 4)
  expect(await geometry(neighbour)).toEqual(neighbourBefore)
  await page.mouse.up()

  await expect.poll(async () => (await emitted(page)).some((entry) => entry.startsWith('commit:resize-right:dense-12'))).toBe(true)
  const item = await page.evaluate(() => window.__DEMO_ITEMS__.find((entry) => entry.id === 'dense-12'))
  expect(item.endedAt - item.startedAt).toBeGreaterThanOrEqual(60_000)
  expect(await geometry(neighbour)).toEqual(neighbourBefore)
})

test('running item can be expanded left while remaining running', async ({ page }) => {
  await page.evaluate(() => { window.__DEMO_EVENTS__.length = 0 })
  const running = page.locator('[data-item-id="running"]')
  const handle = running.locator('[data-testid="resize-left"]')
  await expect(handle).toHaveCount(1)
  await expect(running.locator('[data-testid="resize-right"]')).toHaveCount(0)
  const before = await page.evaluate(() => window.__DEMO_ITEMS__.find((item) => item.id === 'running').startedAt)
  const box = await handle.boundingBox()

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 - 10, box.y + box.height / 2, { steps: 3 })
  await page.mouse.up()

  await expect.poll(async () => (await emitted(page)).some((entry) => entry.startsWith('commit:resize-left:running'))).toBe(true)
  const after = await page.evaluate(() => window.__DEMO_ITEMS__.find((item) => item.id === 'running'))
  expect(after.startedAt).toBeLessThan(before)
  expect(after.endedAt).toBeNull()
  expect(after.isRunning).toBe(true)
})

test('last short block can move right without moving its neighbour', async ({ page }) => {
  await page.evaluate(() => { window.__DEMO_EVENTS__.length = 0 })
  const target = page.locator('[data-item-id="dense-12"]')
  const neighbour = page.locator('[data-item-id="overlap-01"]')
  const neighbourBefore = await geometry(neighbour)
  const startedBefore = await page.evaluate(() => window.__DEMO_ITEMS__.find((item) => item.id === 'dense-12').startedAt)
  const box = await target.boundingBox()

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 12, box.y + box.height / 2, { steps: 3 })
  await page.mouse.up()

  await expect.poll(async () => (await emitted(page)).some((entry) => entry.startsWith('commit:move:dense-12'))).toBe(true)
  const startedAfter = await page.evaluate(() => window.__DEMO_ITEMS__.find((item) => item.id === 'dense-12').startedAt)
  expect(startedAfter).toBeGreaterThan(startedBefore)
  expect(await geometry(neighbour)).toEqual(neighbourBefore)
})

test('Escape cancels an active pointer preview without commit', async ({ page }) => {
  await page.evaluate(() => { window.__DEMO_EVENTS__.length = 0 })
  const item = page.locator('[data-item-id="editable-main"]')
  const before = await item.evaluate((element) => ({ left: element.offsetLeft, width: element.offsetWidth }))
  const box = await item.boundingBox()

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2, { steps: 3 })
  await page.keyboard.press('Escape')
  await page.mouse.up()

  const after = await item.evaluate((element) => ({ left: element.offsetLeft, width: element.offsetWidth }))
  expect(after).toEqual(before)
  expect((await emitted(page)).some((entry) => entry === 'cancel:editable-main')).toBe(true)
  expect((await emitted(page)).some((entry) => entry.startsWith('commit:'))).toBe(false)
})

test('attempted neighbour crossing is clamped before the commit callback', async ({ page }) => {
  await page.evaluate(() => { window.__DEMO_EVENTS__.length = 0 })
  const item = page.locator('[data-item-id="editable-main"]')
  const box = await item.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 800, box.y + box.height / 2, { steps: 4 })
  await page.mouse.up()

  const commit = (await emitted(page)).find((entry) => entry.startsWith('commit:move:editable-main'))
  expect(commit).toBeTruthy()
  const [, , , startedAt, endedAt] = commit.split(':')
  const nextStart = await page.evaluate(() => window.__DEMO_ITEMS__.find((entry) => entry.id === 'editable-next').startedAt)
  expect(Number(startedAt)).toBeLessThan(Number(endedAt))
  expect(Number(endedAt)).toBeLessThanOrEqual(nextStart)
})

test('reduced motion disables running animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(page.locator('[data-item-id="running"]')).toHaveCSS('animation-name', 'none')
})

test('destroy removes component DOM from its container', async ({ page }) => {
  await page.evaluate(() => window.__TIMELINE__.destroy())
  await expect(page.locator('#timeline')).toBeEmpty()
})
