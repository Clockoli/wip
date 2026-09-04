import { expect, test } from '@playwright/test'

const COMPLETED_IDS = [
  ...Array.from({ length: 12 }, (_, index) => `dense-${String(index + 1).padStart(2, '0')}`),
  'overlap-01',
  'overlap-02',
  'editable-previous',
  'editable-main',
  'editable-next',
]
const SNAP = 1_000
const MINIMUM_DURATION = 60_000
const observedErrors = new WeakMap()

test.beforeEach(async ({ page }) => {
  const errors = []
  observedErrors.set(page, errors)
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`)
  })
  page.on('pageerror', (error) => errors.push(`page: ${error.message}`))
})

test.afterEach(async ({ page }) => {
  expect(observedErrors.get(page)).toEqual([])
})

function byTime(a, b) {
  return a.startedAt - b.startedAt || a.endedAt - b.endedAt || a.id.localeCompare(b.id)
}

async function demoItems(page) {
  return page.evaluate(() => structuredClone(window.__DEMO_ITEMS__))
}

async function geometry(page) {
  return page.locator('[data-testid="timeline-item"]').evaluateAll((elements) => Object.fromEntries(
    elements.map((element) => [element.dataset.itemId, {
      left: element.offsetLeft,
      top: element.offsetTop,
      width: element.getBoundingClientRect().width,
      right: element.offsetLeft + element.getBoundingClientRect().width,
      rowId: element.dataset.rowId,
    }]),
  ))
}

async function events(page) {
  return page.evaluate(() => window.__DEMO_EVENTS__.slice())
}

function neighbours(items, id) {
  const target = items.find((item) => item.id === id)
  const row = items.filter((item) => item.rowId === target.rowId && item.endedAt != null).sort(byTime)
  const index = row.findIndex((item) => item.id === id)
  return { target, previous: row[index - 1] ?? null, next: row[index + 1] ?? null }
}

function assertValidEdit(before, after, id, kind) {
  const oldItem = before.find((item) => item.id === id)
  const item = after.find((candidate) => candidate.id === id)
  const { previous, next } = neighbours(after, id)
  expect(item.rowId).toBe(oldItem.rowId)
  expect(item.endedAt - item.startedAt).toBeGreaterThanOrEqual(kind === 'move' ? 1 : MINIMUM_DURATION)
  if (kind === 'move') expect(item.endedAt - item.startedAt).toBe(oldItem.endedAt - oldItem.startedAt)
  if (kind === 'resize-left') expect(item.endedAt).toBe(oldItem.endedAt)
  if (kind === 'resize-right') expect(item.startedAt).toBe(oldItem.startedAt)
  if (kind === 'move') {
    if (previous) expect(item.startedAt).toBeGreaterThanOrEqual(previous.endedAt)
    if (next) expect(item.endedAt).toBeLessThanOrEqual(next.startedAt)
  } else if (kind === 'resize-left') {
    if (previous) expect(item.startedAt).toBeGreaterThanOrEqual(previous.endedAt)
  } else if (next) {
    expect(item.endedAt).toBeLessThanOrEqual(next.startedAt - SNAP)
  }
  for (const candidate of after) {
    if (candidate.id === id) continue
    expect(candidate).toEqual(before.find((item) => item.id === candidate.id))
  }
}

async function gesture(page, id, kind, deltaX) {
  await page.evaluate(() => { window.__DEMO_EVENTS__.length = 0 })
  const before = await demoItems(page)
  const beforeGeometry = await geometry(page)
  const item = page.locator(`[data-item-id="${id}"]`)
  const target = kind === 'move' ? item : item.locator(`[data-testid="${kind}"]`)
  const box = await target.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + deltaX, box.y + box.height / 2, { steps: 4 })
  await page.mouse.up()
  const after = await demoItems(page)
  const afterGeometry = await geometry(page)
  return { before, after, beforeGeometry, afterGeometry, emitted: await events(page) }
}

async function dragEdgeTo(page, id, kind, clientX) {
  await page.evaluate(() => { window.__DEMO_EVENTS__.length = 0 })
  const target = page.locator(`[data-item-id="${id}"] [data-testid="${kind}"]`)
  const box = await target.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(clientX, box.y + box.height / 2, { steps: 8 })
  await page.mouse.up()
  return { items: await demoItems(page), geometry: await geometry(page), emitted: await events(page) }
}

function assertNoVisualOverlap(items, allGeometry, rowId) {
  const row = items.filter((item) => item.rowId === rowId).sort(byTime)
  for (let index = 1; index < row.length; index += 1) {
    const previous = allGeometry[row[index - 1].id]
    const current = allGeometry[row[index].id]
    expect(current.left, `${row[index - 1].id} overlaps ${row[index].id}`)
      .toBeGreaterThanOrEqual(previous.right + 3.5)
  }
}

test.describe('exhaustive completed-item editing', () => {
  for (const id of COMPLETED_IDS) {
    for (const [kind, delta] of [
      ['move', -12],
      ['move', 12],
      ['resize-left', -12],
      ['resize-left', 12],
      ['resize-right', -12],
      ['resize-right', 12],
    ]) {
      test(`${id}: ${kind} ${delta < 0 ? 'left' : 'right'}`, async ({ page }) => {
        await page.goto('/')
        const result = await gesture(page, id, kind, delta)
        const commit = result.emitted.find((entry) => entry.startsWith(`commit:${kind}:${id}:`))
        if (commit) {
          assertValidEdit(result.before, result.after, id, kind)
        } else {
          expect(result.after, `${id} ${kind} no-op changed data`).toEqual(result.before)
          expect(result.afterGeometry[id], `${id} ${kind} no-op changed geometry`)
            .toEqual(result.beforeGeometry[id])
        }
        for (const [otherId, before] of Object.entries(result.beforeGeometry)) {
          if (otherId === id) continue
          expect(result.afterGeometry[otherId], `${id} ${kind} moved ${otherId}`).toEqual(before)
        }
        const edited = result.after.find((item) => item.id === id)
        const visible = result.afterGeometry[id]
        expect(visible.width).toBeGreaterThanOrEqual(30)
        expect(visible.top).toBe(result.beforeGeometry[id].top)
        expect(edited.rowId).toBe(result.before.find((item) => item.id === id).rowId)
      })
    }
  }
})

test('visual neighbour contact commits exactly one second of model-space separation', async ({ page }) => {
  await page.goto('/')
  let result = await dragEdgeTo(page, 'editable-main', 'resize-right', 10_000)
  let target = result.items.find((item) => item.id === 'editable-main')
  let next = result.items.find((item) => item.id === 'editable-next')
  expect(next.startedAt - target.endedAt).toBe(SNAP)

  await page.goto('/')
  result = await gesture(page, 'editable-main', 'move', 10_000)
  target = result.after.find((item) => item.id === 'editable-main')
  next = result.after.find((item) => item.id === 'editable-next')
  expect(next.startedAt - target.endedAt).toBe(SNAP)

  await page.goto('/')
  result = await gesture(page, 'editable-main', 'move', -10_000)
  target = result.after.find((item) => item.id === 'editable-main')
  const movedPrevious = result.after.find((item) => item.id === 'editable-previous')
  expect(target.startedAt - movedPrevious.endedAt).toBe(SNAP)

  await page.goto('/')
  result = await dragEdgeTo(page, 'editable-main', 'resize-left', -10_000)
  target = result.items.find((item) => item.id === 'editable-main')
  const previous = result.items.find((item) => item.id === 'editable-previous')
  expect(target.startedAt - previous.endedAt).toBe(SNAP)
})

test('dense-10: right edge to maximum then left edge to maximum never overlaps dense-11', async ({ page }) => {
  await page.goto('/')
  await dragEdgeTo(page, 'dense-10', 'resize-right', 10_000)
  const result = await dragEdgeTo(page, 'dense-10', 'resize-left', 10_000)
  const target = result.items.find((item) => item.id === 'dense-10')
  expect(target.endedAt - target.startedAt).toBeGreaterThanOrEqual(MINIMUM_DURATION)
  assertNoVisualOverlap(result.items, result.geometry, 'short')
})

test.describe('opposite edges dragged to extremes', () => {
  for (const id of COMPLETED_IDS) {
    test(`${id}: right→left and left→right extremes never overlap`, async ({ page }) => {
      await page.goto('/')
      await dragEdgeTo(page, id, 'resize-right', 10_000)
      let result = await dragEdgeTo(page, id, 'resize-left', 10_000)
      let target = result.items.find((item) => item.id === id)
      expect(target.endedAt - target.startedAt).toBeGreaterThanOrEqual(MINIMUM_DURATION)
      assertNoVisualOverlap(result.items, result.geometry, target.rowId)

      await page.goto('/')
      await dragEdgeTo(page, id, 'resize-left', -10_000)
      result = await dragEdgeTo(page, id, 'resize-right', 10_000)
      target = result.items.find((item) => item.id === id)
      expect(target.endedAt - target.startedAt).toBeGreaterThanOrEqual(MINIMUM_DURATION)
      assertNoVisualOverlap(result.items, result.geometry, target.rowId)
    })
  }
})

test.describe('repeated extreme-edge stress', () => {
  for (const id of COMPLETED_IDS) {
    test(`${id}: repeated right→left cycles stay isolated`, async ({ page }) => {
      await page.goto('/')
      for (let cycle = 0; cycle < 3; cycle += 1) {
        let result = await dragEdgeTo(page, id, 'resize-right', 10_000)
        let target = result.items.find((item) => item.id === id)
        assertNoVisualOverlap(result.items, result.geometry, target.rowId)
        result = await dragEdgeTo(page, id, 'resize-left', 10_000)
        target = result.items.find((item) => item.id === id)
        expect(target.endedAt - target.startedAt).toBeGreaterThanOrEqual(MINIMUM_DURATION)
        assertNoVisualOverlap(result.items, result.geometry, target.rowId)
      }
    })
  }
})

test.describe('sequential editing on the same mounted component', () => {
  for (const id of COMPLETED_IDS) {
    test(`${id}: move then expand both edges`, async ({ page }) => {
      await page.goto('/')
      for (const [kind, delta] of [
        ['move', 8],
        ['resize-left', -8],
        ['resize-right', 8],
      ]) {
        const result = await gesture(page, id, kind, delta)
        const committed = result.emitted.some((entry) => entry.startsWith(`commit:${kind}:${id}:`))
        if (committed) {
          assertValidEdit(result.before, result.after, id, kind)
        } else {
          expect(result.after, `${id} sequential ${kind} no-op changed data`).toEqual(result.before)
        }
        for (const [otherId, before] of Object.entries(result.beforeGeometry)) {
          if (otherId === id) continue
          expect(result.afterGeometry[otherId], `${id} sequential ${kind} moved ${otherId}`).toEqual(before)
        }
      }
    })
  }
})

test('running item supports only left resize and preserves running state', async ({ page }) => {
  await page.goto('/')
  const running = page.locator('[data-item-id="running"]')
  await expect(running.locator('[data-testid="resize-left"]')).toHaveCount(1)
  await expect(running.locator('[data-testid="resize-right"]')).toHaveCount(0)
  const result = await gesture(page, 'running', 'resize-left', -12)
  expect(result.emitted.some((entry) => entry.startsWith('commit:resize-left:running:'))).toBe(true)
  const after = result.after.find((item) => item.id === 'running')
  expect(after.endedAt).toBeNull()
  expect(after.isRunning).toBe(true)
  expect(after.rowId).toBe('main')
})
