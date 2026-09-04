import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DAY_MS,
  HOUR_MS,
  createInitialView,
  resistZoomSpan,
  panTimelineView,
  zoomTimelineView,
} from '../src/timeline/interaction.js'

const now = new Date(2026, 7, 31, 17, 23, 41, 456).getTime()

test('initial view is exactly the last 24 actual hours and ends at now', () => {
  assert.deepEqual(createInitialView({ now }), {
    start: now - DAY_MS,
    end: now,
    focusedAt: now,
  })
})

test('zoom is anchored, limited to one hour and seven days, and never exposes future', () => {
  const initial = createInitialView({ now })
  const anchor = initial.start + 6 * HOUR_MS
  const zoomedIn = zoomTimelineView({ view: initial, now, anchor, factor: 0.5 })

  assert.equal(zoomedIn.end - zoomedIn.start, 12 * HOUR_MS)
  assert.equal((anchor - zoomedIn.start) / (zoomedIn.end - zoomedIn.start), 0.25)

  const minimum = zoomTimelineView({ view: zoomedIn, now, anchor, factor: 0.001 })
  assert.equal(minimum.end - minimum.start, HOUR_MS)

  const maximum = zoomTimelineView({ view: initial, now, anchor: now, factor: 100 })
  assert.equal(maximum.end - maximum.start, 7 * DAY_MS)
  assert.equal(maximum.end, now)
})

test('pan keeps span and clamps between seven-day history and now', () => {
  const initial = createInitialView({ now })
  const future = panTimelineView({ view: initial, now, deltaMs: 10 * DAY_MS })
  const past = panTimelineView({ view: initial, now, deltaMs: -10 * DAY_MS })

  assert.deepEqual(future, initial)
  assert.equal(past.start, now - 7 * DAY_MS)
  assert.equal(past.end - past.start, DAY_MS)
  assert.ok(past.end <= now)
})

test('zoom span snaps to one-day and three-day boundaries when crossing them', () => {
  assert.equal(resistZoomSpan({ currentSpan: 23.5 * HOUR_MS, proposedSpan: 25 * HOUR_MS }), DAY_MS)
  assert.equal(resistZoomSpan({ currentSpan: 71 * HOUR_MS, proposedSpan: 73 * HOUR_MS }), 3 * DAY_MS)
})

test('zoom span moves four times slower immediately beyond magnetic boundaries', () => {
  assert.equal(
    resistZoomSpan({ currentSpan: DAY_MS, proposedSpan: DAY_MS + 4 * HOUR_MS }),
    DAY_MS + HOUR_MS,
  )
  assert.equal(
    resistZoomSpan({ currentSpan: 3 * DAY_MS, proposedSpan: 3 * DAY_MS - 4 * HOUR_MS }),
    3 * DAY_MS - HOUR_MS,
  )
})
