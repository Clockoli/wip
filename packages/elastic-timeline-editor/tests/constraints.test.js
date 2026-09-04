import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_MINIMUM_DURATION_MS,
  DEFAULT_SNAP_MS,
  constrainMove,
  constrainResizeLeft,
  constrainResizeRight,
  getCompletedNeighbourBounds,
  snapTimestamp,
  sortCompletedItems,
} from '../src/timeline/constraints.js'

const minute = 60_000

test('sortCompletedItems uses startedAt, endedAt, then id without mutating input', () => {
  const running = { id: 'running', startedAt: 500, endedAt: null }
  const laterEnd = { id: 'z', startedAt: 1_000, endedAt: 3_123 }
  const idB = { id: 'b', startedAt: 1_000, endedAt: 2_123 }
  const idA = { id: 'a', startedAt: 1_000, endedAt: 2_123 }
  const first = { id: 'first', startedAt: 999, endedAt: 1_234 }
  const input = [laterEnd, running, idB, first, idA]

  assert.deepEqual(
    sortCompletedItems(input).map(({ id }) => id),
    ['first', 'a', 'b', 'z'],
  )
  assert.deepEqual(input, [laterEnd, running, idB, first, idA])
  assert.equal(first.endedAt, 1_234, 'seconds-precision timestamps stay untouched')
})

test('getCompletedNeighbourBounds finds immediate completed neighbours in chronological order', () => {
  const previous = { id: 'previous', startedAt: 1_000, endedAt: 4_321 }
  const target = { id: 'target', startedAt: 5_123, endedAt: 7_987 }
  const next = { id: 'next', startedAt: 9_876, endedAt: 11_111 }
  const running = { id: 'running', startedAt: 8_000, endedAt: null }

  const bounds = getCompletedNeighbourBounds(
    [next, running, target, previous],
    'target',
    { earliestAllowed: 0, now: 20_000 },
  )

  assert.equal(bounds.previous, previous)
  assert.equal(bounds.next, next)
  assert.equal(bounds.previousEnd, 4_321)
  assert.equal(bounds.nextStart, 9_876)
})

test('getCompletedNeighbourBounds respects a longer earlier interval across nested neighbours', () => {
  const longerPrevious = { id: 'longer-previous', startedAt: 1_000, endedAt: 4_900 }
  const nestedPrevious = { id: 'nested-previous', startedAt: 2_000, endedAt: 3_000 }
  const target = { id: 'target', startedAt: 5_000, endedAt: 6_000 }
  const next = { id: 'next', startedAt: 7_000, endedAt: 8_000 }

  const bounds = getCompletedNeighbourBounds(
    [nestedPrevious, target, next, longerPrevious],
    'target',
    { earliestAllowed: 0, now: 10_000 },
  )

  assert.equal(bounds.previous, longerPrevious)
  assert.equal(bounds.previousEnd, 4_900)
  assert.equal(bounds.next, next)
  assert.equal(bounds.nextStart, 7_000)
})

test('getCompletedNeighbourBounds falls back to earliestAllowed and now', () => {
  const target = { id: 'target', startedAt: 5_123, endedAt: 7_987 }

  assert.deepEqual(
    getCompletedNeighbourBounds([target], 'target', {
      earliestAllowed: 1_234,
      now: 9_999,
    }),
    {
      previous: null,
      next: null,
      previousEnd: 1_234,
      nextStart: 9_999,
    },
  )
})

test('move preserves duration, previews exact time, and snaps only the final gesture', () => {
  const item = { id: 'target', startedAt: 125_000, endedAt: 245_000 }
  const input = {
    item,
    proposedStartedAt: 154_000,
    previousEnd: 61_000,
    nextStart: 400_000,
  }

  assert.deepEqual(constrainMove(input), {
    startedAt: 154_000,
    endedAt: 274_000,
  })
  assert.deepEqual(constrainMove({ ...input, isFinalGesture: true }), {
    startedAt: 180_000,
    endedAt: 300_000,
  })
  assert.deepEqual(item, { id: 'target', startedAt: 125_000, endedAt: 245_000 })
})

test('an unchanged move does not round seconds-precision timestamps', () => {
  const item = { id: 'target', startedAt: 125_123, endedAt: 245_987 }

  assert.deepEqual(
    constrainMove({
      item,
      proposedStartedAt: item.startedAt,
      previousEnd: 60_001,
      nextStart: 400_999,
      isFinalGesture: true,
    }),
    { startedAt: 125_123, endedAt: 245_987 },
  )
})

test('move clamps snapped results to neighbour boundaries and cannot cross them', () => {
  const item = { id: 'target', startedAt: 160_000, endedAt: 280_000 }
  const common = {
    item,
    previousEnd: 130_123,
    nextStart: 410_987,
    isFinalGesture: true,
  }

  assert.deepEqual(constrainMove({ ...common, proposedStartedAt: 119_000 }), {
    startedAt: 130_123,
    endedAt: 250_123,
  })
  assert.deepEqual(constrainMove({ ...common, proposedStartedAt: 319_000 }), {
    startedAt: 290_987,
    endedAt: 410_987,
  })
})

test('neighbour contact always leaves exactly one snap interval', () => {
  const item = { id: 'target', startedAt: 120_000, endedAt: 180_000 }
  const previousEnd = 60_000
  const nextStart = 240_000
  const common = { item, previousEnd, nextStart, now: 300_000, neighbourGapMs: 1_000, snapMs: 1_000, isFinalGesture: true }

  assert.deepEqual(constrainMove({ ...common, proposedStartedAt: 0 }), {
    startedAt: previousEnd + 1_000,
    endedAt: previousEnd + 61_000,
  })
  assert.deepEqual(constrainMove({ ...common, proposedStartedAt: 999_999 }), {
    startedAt: nextStart - 61_000,
    endedAt: nextStart - 1_000,
  })
  assert.deepEqual(constrainResizeLeft({ ...common, proposedStartedAt: 0, minimumDurationMs: 60_000 }), {
    startedAt: previousEnd + 1_000,
    endedAt: item.endedAt,
  })
  assert.deepEqual(constrainResizeRight({ ...common, proposedEndedAt: 999_999, minimumDurationMs: 60_000 }), {
    startedAt: item.startedAt,
    endedAt: nextStart - 1_000,
  })
})

test('final neighbour contact keeps a non-snapped boundary exact', () => {
  const item = { id: 'target', startedAt: 1_000, endedAt: 90_714 }
  const nextStart = 149_745.965
  const gap = 60_000
  const latestStart = nextStart - (item.endedAt - item.startedAt) - gap

  assert.deepEqual(constrainMove({
    item,
    proposedStartedAt: latestStart,
    previousEnd: -60_000,
    nextStart,
    neighbourGapMs: gap,
    snapMs: gap,
    isFinalGesture: true,
  }), {
    startedAt: latestStart,
    endedAt: nextStart - gap,
  })

  assert.deepEqual(constrainResizeRight({
    item,
    proposedEndedAt: nextStart - gap,
    nextStart,
    now: 200_000,
    neighbourGapMs: gap,
    minimumDurationMs: 60_000,
    snapMs: gap,
    isFinalGesture: true,
  }), {
    startedAt: item.startedAt,
    endedAt: nextStart - gap,
  })
})

test('resize-left changes only start and respects previousEnd and minimumDuration', () => {
  const item = { id: 'target', startedAt: 125_123, endedAt: 245_987 }
  const common = { item, previousEnd: 61_234, isFinalGesture: true }

  assert.deepEqual(
    constrainResizeLeft({ ...common, proposedStartedAt: 121_000 }),
    { startedAt: 120_000, endedAt: 245_987 },
  )
  assert.deepEqual(
    constrainResizeLeft({ ...common, proposedStartedAt: 59_000 }),
    { startedAt: 61_234, endedAt: 245_987 },
  )
  assert.deepEqual(
    constrainResizeLeft({ ...common, proposedStartedAt: 220_000 }),
    { startedAt: 185_987, endedAt: 245_987 },
  )
  assert.deepEqual(
    constrainResizeLeft({ ...common, proposedStartedAt: item.startedAt }),
    { startedAt: 125_123, endedAt: 245_987 },
  )
})

test('resize-right changes only end and clamps to minimumDuration, nextStart, and now', () => {
  const item = { id: 'target', startedAt: 125_123, endedAt: 245_987 }
  const common = {
    item,
    nextStart: 301_234,
    now: 290_987,
    isFinalGesture: true,
  }

  assert.deepEqual(
    constrainResizeRight({ ...common, proposedEndedAt: 150_000 }),
    { startedAt: 125_123, endedAt: 185_123 },
  )
  assert.deepEqual(
    constrainResizeRight({ ...common, proposedEndedAt: 273_000 }),
    { startedAt: 125_123, endedAt: 290_987 },
  )
  assert.deepEqual(
    constrainResizeRight({ ...common, proposedEndedAt: item.endedAt }),
    { startedAt: 125_123, endedAt: 245_987 },
  )
})

test('snap and minimum duration default to one minute and snap is configurable', () => {
  assert.equal(DEFAULT_SNAP_MS, minute)
  assert.equal(DEFAULT_MINIMUM_DURATION_MS, minute)
  assert.equal(snapTimestamp(124_999), 120_000)
  assert.equal(snapTimestamp(125_001, 10_000), 130_000)

  const item = { id: 'target', startedAt: 100_000, endedAt: 200_000 }
  assert.deepEqual(
    constrainResizeRight({
      item,
      proposedEndedAt: 226_000,
      nextStart: 500_000,
      now: 500_000,
      minimumDurationMs: 10_000,
      snapMs: 10_000,
      isFinalGesture: true,
    }),
    { startedAt: 100_000, endedAt: 230_000 },
  )
})

test('resize always enforces the configured one-minute minimum', () => {
  const item = { id: 'short', startedAt: 100_000, endedAt: 105_000 }

  assert.deepEqual(
    constrainResizeRight({
      item,
      proposedEndedAt: 106_000,
      nextStart: 500_000,
      now: 500_000,
      snapMs: 1_000,
      minimumDurationMs: 60_000,
    }),
    { startedAt: 100_000, endedAt: 160_000 },
  )
  assert.deepEqual(
    constrainResizeLeft({
      item,
      proposedStartedAt: 99_000,
      previousEnd: 0,
      snapMs: 1_000,
      minimumDurationMs: 60_000,
    }),
    { startedAt: 45_000, endedAt: 105_000 },
  )
})

test('invalid targets, intervals, and infeasible bounds fail explicitly', () => {
  const item = { id: 'target', startedAt: 100_000, endedAt: 200_000 }

  assert.throws(
    () => getCompletedNeighbourBounds([item], 'missing', { earliestAllowed: 0, now: 300_000 }),
    /target completed item/i,
  )
  assert.throws(
    () => constrainMove({ item, proposedStartedAt: 100_000, previousEnd: 150_000, nextStart: 200_000 }),
    /duration/i,
  )
  assert.throws(() => snapTimestamp(100_000, 0), /snapMs/i)
  assert.throws(
    () => constrainResizeRight({
      item,
      proposedEndedAt: 180_000,
      nextStart: 150_000,
      now: 150_000,
    }),
    /minimum duration/i,
  )
})
