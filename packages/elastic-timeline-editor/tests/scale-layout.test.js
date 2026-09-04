import test from 'node:test'
import assert from 'node:assert/strict'

import {
  MINIMUM_ITEM_GAP,
  MINIMUM_ITEM_MOBILITY_GAP,
  MINIMUM_ITEM_WIDTH,
  createElasticScale,
} from '../src/timeline/scale.js'
import {
  COLOR_PALETTE,
  calculateTrackedDuration,
  createColorResolver,
  findAdjacentItemConnections,
  layoutTimelineItems,
  sortTimelineItems,
} from '../src/timeline/layout.js'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

function item(id, startedAt, endedAt, url) {
  return { id, startedAt, endedAt, ...(url ? { url } : {}) }
}

test('createElasticScale uses local calendar hours through 48h and preserves exact view edges', () => {
  const viewStart = new Date(2026, 0, 2, 10, 17, 23, 456).getTime()
  const viewEnd = viewStart + 24 * HOUR
  const scale = createElasticScale({
    viewStart,
    viewEnd,
    items: [],
    viewportWidth: 960,
  })

  assert.equal(scale.width, 960)
  assert.equal(scale.cells[0].start, viewStart)
  assert.equal(scale.cells.at(-1).end, viewEnd)
  assert.ok(scale.cells.every((cell) => cell.kind === 'hour'))
  assert.ok(scale.cells.every((cell, index) => index === 0 || cell.start === scale.cells[index - 1].end))
  assert.equal(scale.toX(viewStart), 0)
  assert.equal(scale.toX(viewEnd), scale.width)
})

test('empty hour groups reserve enough width for complete range labels', () => {
  const viewStart = new Date(2026, 0, 2, 10, 17).getTime()
  const scale = createElasticScale({ viewStart, viewEnd: viewStart + 48 * HOUR, items: [], viewportWidth: 320 })

  for (let index = 0; index < scale.cells.length; index += 6) {
    const cells = scale.cells.slice(index, index + 6)
    const width = cells.reduce((total, cell) => total + cell.width, 0)
    assert.ok(width >= (cells.length === 1 ? 27 : 54) - 1e-9)
  }
})

test('createElasticScale switches to local calendar days above 48h', () => {
  const viewStart = new Date(2026, 0, 2, 10, 17).getTime()
  const viewEnd = viewStart + 49 * HOUR
  const scale = createElasticScale({ viewStart, viewEnd, items: [], viewportWidth: 700 })

  assert.ok(scale.cells.length >= 3)
  assert.ok(scale.cells.every((cell) => cell.kind === 'day'))
  assert.equal(scale.cells[0].start, viewStart)
  assert.equal(scale.cells.at(-1).end, viewEnd)
})

test('piecewise actual/display mapping is strictly monotonic and invertible', () => {
  const viewStart = new Date(2026, 2, 5, 8, 13).getTime()
  const viewEnd = viewStart + 6 * HOUR
  const items = [
    item('dense-1', viewStart + 2 * HOUR, viewStart + 2 * HOUR + 5_000),
    item('dense-2', viewStart + 2 * HOUR + 6_000, viewStart + 2 * HOUR + 11_000),
    item('dense-3', viewStart + 2 * HOUR + 12_000, viewStart + 2 * HOUR + 17_000),
  ]
  const scale = createElasticScale({ viewStart, viewEnd, items, viewportWidth: 500 })
  const samples = Array.from({ length: 121 }, (_, index) => viewStart + ((viewEnd - viewStart) * index) / 120)
  const xs = samples.map(scale.toX)

  for (let index = 1; index < xs.length; index += 1) {
    assert.ok(xs[index] > xs[index - 1], `mapping must increase at sample ${index}`)
  }
  for (const timestamp of samples) {
    assert.ok(Math.abs(scale.toTime(scale.toX(timestamp)) - timestamp) < 0.01)
  }
})

test('elastic allocation compresses empty cells before low-occupancy and dense cells', () => {
  const viewStart = new Date(2026, 0, 2, 0, 0).getTime()
  const viewEnd = viewStart + 3 * HOUR
  const items = [
    item('low', viewStart + HOUR + 10 * 60_000, viewStart + HOUR + 20 * 60_000),
    ...Array.from({ length: 6 }, (_, index) =>
      item(
        `dense-${index}`,
        viewStart + 2 * HOUR + index * 10_000,
        viewStart + 2 * HOUR + index * 10_000 + 5_000,
      ),
    ),
  ]
  const scale = createElasticScale({ viewStart, viewEnd, items, viewportWidth: 420 })
  const [empty, low, dense] = scale.cells

  assert.equal(scale.width, 420)
  assert.ok(empty.width < low.width, `${empty.width} should be less than ${low.width}`)
  assert.ok(low.width < dense.width, `${low.width} should be less than ${dense.width}`)
  assert.ok(dense.width >= 6 * 30 + 5 * 4)
})

test('elastic allocation counts one global sequence while simultaneous rows reuse horizontal space', () => {
  const viewStart = new Date(2026, 0, 2, 0, 0).getTime()
  const viewEnd = viewStart + HOUR
  const items = ['a', 'b'].flatMap((rowId) => Array.from({ length: 6 }, (_, index) => ({
    ...item(`${rowId}-${index}`, viewStart + index * 10_000, viewStart + index * 10_000 + 5_000),
    rowId,
  })))
  const scale = createElasticScale({ viewStart, viewEnd, items, viewportWidth: 320 })

  assert.equal(scale.width, 320)
  assert.equal(scale.cells[0].count, 6)
})

test('elastic allocation reserves one global sequence across alternating rows', () => {
  const viewStart = new Date(2026, 0, 2, 0, 0).getTime()
  const viewEnd = viewStart + HOUR
  const items = Array.from({ length: 12 }, (_, index) => ({
    ...item(`i-${index}`, viewStart + index * 6_000, viewStart + index * 6_000 + 5_000),
    rowId: index % 2 ? 'b' : 'a',
  }))
  const scale = createElasticScale({ viewStart, viewEnd, items, viewportWidth: 320 })

  assert.equal(scale.cells[0].count, 12)
  assert.ok(scale.width >= 12 * MINIMUM_ITEM_WIDTH + 11 * MINIMUM_ITEM_GAP)
})

test('canvas reserves enough dense-row space for minimum widths and pointer movement', () => {
  const viewStart = new Date(2026, 0, 2, 0, 0).getTime()
  const viewEnd = viewStart + HOUR
  const items = Array.from({ length: 12 }, (_, index) =>
    item(`i-${index}`, viewStart + index * 6_000, viewStart + index * 6_000 + 5_000),
  )

  const medium = createElasticScale({ viewStart, viewEnd, items, viewportWidth: 500 })
  const narrow = createElasticScale({ viewStart, viewEnd, items, viewportWidth: 320 })
  const required = 12 * (MINIMUM_ITEM_WIDTH + MINIMUM_ITEM_GAP) + 11 * MINIMUM_ITEM_MOBILITY_GAP

  assert.equal(medium.width, required)
  assert.equal(narrow.width, required)
  assert.ok(narrow.width > 320)
})

test('sortTimelineItems uses startedAt, endedAt, then stable id without mutating input', () => {
  const input = [
    item('z', 20, 30),
    item('b', 10, 30),
    item('a', 10, 30),
    item('c', 10, 20),
    item('running', 10, null),
  ]
  const snapshot = [...input]
  const sorted = sortTimelineItems(input)

  assert.deepEqual(sorted.map(({ id }) => id), ['c', 'a', 'b', 'running', 'z'])
  assert.deepEqual(input, snapshot)
  assert.notEqual(sorted, input)
})

test('short blocks stay inside their actual hour while retaining minimum hit width', () => {
  const viewStart = new Date(2026, 0, 2, 12, 0).getTime()
  const viewEnd = viewStart + 3 * HOUR
  const emptyScale = createElasticScale({ viewStart, viewEnd, items: [], viewportWidth: 320 })
  const items = [
    item('first', emptyScale.cells[1].start + 5_000, emptyScale.cells[1].start + 6_000),
    item('second', emptyScale.cells[2].start + 5_000, emptyScale.cells[2].start + 6_000),
  ]
  const scale = createElasticScale({ viewStart, viewEnd, items, viewportWidth: 320 })
  const blocks = layoutTimelineItems({ items, scale, now: viewEnd })
  const byId = new Map(blocks.map(block => [block.id, block]))

  for (const itemValue of items) {
    const block = byId.get(itemValue.id)
    const cell = scale.cells.find(candidate => itemValue.startedAt >= candidate.start && itemValue.startedAt < candidate.end)
    assert.ok(block.width >= MINIMUM_ITEM_WIDTH)
    assert.ok(block.x >= cell.x - 1e-9, `${itemValue.id} starts before its hour`)
    assert.ok(block.endX <= cell.endX + 1e-9, `${itemValue.id} ends after its hour`)
  }
})

test('layout keeps twelve short sequential items in one row with minimum width and gap', () => {
  const viewStart = new Date(2026, 0, 2, 12, 0).getTime()
  const viewEnd = viewStart + HOUR
  const items = Array.from({ length: 12 }, (_, index) =>
    item(`i-${String(index).padStart(2, '0')}`, viewStart + index * 6_000, viewStart + index * 6_000 + 5_000),
  )
  const scale = createElasticScale({ viewStart, viewEnd, items, viewportWidth: 500 })
  const blocks = layoutTimelineItems({ items, scale, now: viewEnd })

  assert.equal(blocks.length, 12)
  assert.ok(blocks.every((block) => block.row === 0))
  assert.ok(blocks.every((block) => block.width >= 30))
  for (let index = 1; index < blocks.length; index += 1) {
    assert.ok(blocks[index].x >= blocks[index - 1].x + blocks[index - 1].width + 4 - 1e-9)
  }
  assert.ok(blocks.at(-1).x + blocks.at(-1).width <= scale.width + 1e-9)
})

test('layout assigns independent visual rows by rowId', () => {
  const viewStart = 1_000_000
  const viewEnd = viewStart + HOUR
  const items = [
    { ...item('a-1', viewStart + 10_000, viewStart + 20_000), rowId: 'a' },
    { ...item('b-1', viewStart + 10_000, viewStart + 20_000), rowId: 'b' },
    { ...item('a-2', viewStart + 21_000, viewStart + 30_000), rowId: 'a' },
  ]
  const scale = createElasticScale({ viewStart, viewEnd, items, viewportWidth: 500 })
  const blocks = layoutTimelineItems({
    items,
    rows: [{ id: 'a', title: 'Alpha' }, { id: 'b', title: 'Beta' }],
    scale,
    now: viewEnd,
  })

  assert.deepEqual(blocks.map(({ id, row }) => [id, row]), [
    ['a-1', 0],
    ['a-2', 0],
    ['b-1', 1],
  ])
})

test('layout shares one horizontal sequence across rows but allows real time overlap', () => {
  const viewStart = 1_000_000
  const viewEnd = viewStart + HOUR
  const items = [
    { ...item('a', viewStart + 10_000, viewStart + 15_000), rowId: 'one' },
    { ...item('overlap', viewStart + 12_000, viewStart + 14_000), rowId: 'two' },
    { ...item('b', viewStart + 16_000, viewStart + 21_000), rowId: 'two' },
    { ...item('c', viewStart + 22_000, viewStart + 27_000), rowId: 'one' },
  ]
  const scale = createElasticScale({ viewStart, viewEnd, items, viewportWidth: 320 })
  const blocks = layoutTimelineItems({ items, rows: [{ id: 'one' }, { id: 'two' }], scale, now: viewEnd })
  const byId = new Map(blocks.map(block => [block.id, block]))

  assert.ok(byId.get('b').x >= byId.get('a').endX + MINIMUM_ITEM_GAP)
  assert.ok(byId.get('c').x >= byId.get('b').endX + MINIMUM_ITEM_GAP)
  assert.ok(byId.get('overlap').x < byId.get('a').endX && byId.get('overlap').endX > byId.get('a').x)
  assert.equal(byId.get('a').row, 0)
  assert.equal(byId.get('b').row, 1)
})

test('tracked duration sums clipped completed and running intervals across rows', () => {
  const viewStart = 1_000_000
  const viewEnd = viewStart + HOUR
  const now = viewStart + 30 * 60_000
  const items = [
    { ...item('a', viewStart - 10_000, viewStart + 60_000), rowId: 'one' },
    { ...item('b', viewStart + 120_000, viewStart + 180_000), rowId: 'two' },
    { ...item('running', viewStart + 20 * 60_000, null), rowId: 'two' },
  ]

  assert.equal(calculateTrackedDuration({ items, viewStart, viewEnd, now }), 60_000 + 60_000 + 10 * 60_000)
})

test('running intervals keep the minimum visual width at one-hour, one-day, and seven-day scales', () => {
  const now = new Date(2026, 8, 3, 12, 0, 0).getTime()
  const running = { ...item('running-minimum', now - 1, null), isRunning: true }

  for (const span of [HOUR, DAY, 7 * DAY]) {
    const scale = createElasticScale({
      viewStart: now - span,
      viewEnd: now,
      items: [running],
      viewportWidth: 960,
    })
    const [block] = layoutTimelineItems({ items: [running], scale, now })
    assert.ok(block.width >= MINIMUM_ITEM_WIDTH, `minimum width at ${span}ms scale`)
  }
})

test('layout includes a zero-duration running item starting exactly at the current right edge', () => {
  const now = new Date(2026, 8, 4, 9, 0, 0).getTime()
  const running = { ...item('running-at-now', now, null), isRunning: true }
  const scale = createElasticScale({
    viewStart: now - DAY,
    viewEnd: now,
    items: [running],
    viewportWidth: 960,
  })
  const blocks = layoutTimelineItems({ items: [running], scale, now })

  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].id, 'running-at-now')
  assert.equal(blocks[0].visualEndedAt, now)
  assert.ok(blocks[0].width >= MINIMUM_ITEM_WIDTH)
  assert.ok(blocks[0].endX <= scale.width + 1e-9)
})

test('connections join chronological neighbours in the same row with zero or one-second gaps', () => {
  const items = [
    { ...item('a', 0, 10_000), rowId: 'one' },
    { ...item('b', 11_000, 20_000), rowId: 'one' },
    { ...item('touching', 20_000, 21_000), rowId: 'one' },
    { ...item('c', 21_001, 30_000), rowId: 'one' },
    { ...item('other-row', 11_000, 20_000), rowId: 'two' },
    { ...item('running', 31_000, null), rowId: 'one' },
  ]

  assert.deepEqual(findAdjacentItemConnections(items), [
    { fromId: 'a', toId: 'b', rowId: 'one' },
    { fromId: 'b', toId: 'touching', rowId: 'one' },
    { fromId: 'c', toId: 'running', rowId: 'one' },
  ])
})

test('layout allows actual-overlapping items to overlap visually without changing timestamps', () => {
  const viewStart = 1_000_000
  const viewEnd = viewStart + HOUR
  const items = [
    item('third', viewStart + 20_000, viewStart + 50 * 60_000),
    item('first', viewStart + 10_000, viewStart + 40 * 60_000),
    item('second', viewStart + 10_000, viewStart + 45 * 60_000),
  ]
  const scale = createElasticScale({ viewStart, viewEnd, items, viewportWidth: 320 })
  const blocks = layoutTimelineItems({ items, scale, now: viewEnd })

  assert.deepEqual(blocks.map(({ id }) => id), ['first', 'second', 'third'])
  assert.ok(blocks.every((block) => block.row === 0 && block.width >= 30))
  assert.ok(blocks[1].x < blocks[0].endX)
  assert.ok(blocks[2].x < blocks[1].endX)
  assert.ok(blocks.at(-1).endX <= scale.width + 1e-9)
  assert.deepEqual(
    blocks.map(({ startedAt, endedAt }) => [startedAt, endedAt]),
    [
      [items[1].startedAt, items[1].endedAt],
      [items[2].startedAt, items[2].endedAt],
      [items[0].startedAt, items[0].endedAt],
    ],
  )
})

test('layout uses now as the visual end of a running item without changing actual end', () => {
  const viewStart = 2_000_000
  const viewEnd = viewStart + HOUR
  const now = viewStart + 30 * 60_000
  const running = item('running', viewStart + 10 * 60_000, null)
  const scale = createElasticScale({ viewStart, viewEnd, items: [running], viewportWidth: 400 })
  const [block] = layoutTimelineItems({ items: [running], scale, now })

  assert.equal(block.endedAt, null)
  assert.equal(block.visualEndedAt, now)
  assert.ok(block.width >= 30)
})

test('createColorResolver keeps each task identity stable across repeated calls', () => {
  const resolveColor = createColorResolver()
  const identities = Array.from({ length: 20 }, (_, index) => item(`id-${index}`, index, index + 1))
  const colors = identities.map(resolveColor)

  assert.ok(colors.every((color) => COLOR_PALETTE.includes(color)))
  assert.equal(resolveColor(identities[7]), colors[7])

  const sameUrlA = item('url-a', 100, 101, 'https://example.test/task')
  const sameUrlB = item('url-b', 102, 103, 'https://example.test/task')
  assert.equal(resolveColor(sameUrlA), resolveColor(sameUrlB))
})

test('createColorResolver derives a task color from its URL independently of render order', () => {
  const task = item('task-a', 100, 101, 'https://example.test/tasks/a')
  const other = item('task-b', 102, 103, 'https://example.test/tasks/b')
  const firstRender = createColorResolver()
  const secondRender = createColorResolver()

  const firstColor = firstRender(task)
  secondRender(other)

  assert.equal(secondRender(task), firstColor)
})

test('createColorResolver reuses the finite palette deterministically after any number of identities', () => {
  const resolveColor = createColorResolver()
  const identities = Array.from({ length: 25 }, (_, index) => item(`identity-${index}`, index, index + 1))
  const colors = identities.map(resolveColor)

  assert.ok(colors.every((color) => COLOR_PALETTE.includes(color)))
  for (let index = 0; index < identities.length; index += 1) {
    assert.equal(resolveColor(identities[index]), colors[index])
  }
})
