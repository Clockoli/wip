import test from 'node:test'
import assert from 'node:assert/strict'
import * as layout from '../src/timeline/layout.js'

test('overlaps are symmetric, row-local, and exclude touching or empty intervals', () => {
  const items = [
    { id: 'outer', startedAt: 0, endedAt: 10 },
    { id: 'inner', startedAt: 2, endedAt: 4, rowId: '__default' },
    { id: 'partial', startedAt: 3, endedAt: 12 },
    { id: 'touching', startedAt: 12, endedAt: 14 },
    { id: 'empty', startedAt: 3, endedAt: 3 },
    { id: 'other-row', startedAt: 0, endedAt: 10, rowId: 'other' },
  ].map(Object.freeze)
  assert.deepEqual(Object.fromEntries(layout.findItemOverlaps(items, 20)), {
    outer: ['inner', 'partial'],
    inner: ['outer', 'partial'],
    partial: ['outer', 'inner'],
    touching: [],
    empty: [],
    'other-row': [],
  })
})

test('running overlaps end at now and are recalculated as now advances', () => {
  const items = [
    { id: 'running', startedAt: 5, endedAt: null },
    { id: 'completed', startedAt: 8, endedAt: 12 },
  ]
  assert.deepEqual(Object.fromEntries(layout.findItemOverlaps(items, 8)), { running: [], completed: [] })
  assert.deepEqual(Object.fromEntries(layout.findItemOverlaps(items, 9)), {
    running: ['completed'], completed: ['running'],
  })
})
