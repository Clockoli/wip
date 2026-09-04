export const DEFAULT_SNAP_MS = 60_000
export const DEFAULT_MINIMUM_DURATION_MS = 60_000

function assertFinite(value, name) {
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be a finite number`)
}

function compareItems(a, b) {
  return a.startedAt - b.startedAt || a.endedAt - b.endedAt || String(a.id).localeCompare(String(b.id))
}

export function sortCompletedItems(items) {
  return items.filter((item) => item.endedAt != null).slice().sort(compareItems)
}

export function snapTimestamp(timestamp, snapMs = DEFAULT_SNAP_MS) {
  assertFinite(timestamp, 'timestamp')
  if (!Number.isFinite(snapMs) || snapMs <= 0) throw new RangeError('snapMs must be greater than zero')
  return Math.round(timestamp / snapMs) * snapMs
}

export function getCompletedNeighbourBounds(items, targetId, { earliestAllowed, now }) {
  assertFinite(earliestAllowed, 'earliestAllowed')
  assertFinite(now, 'now')
  const completed = sortCompletedItems(items)
  const index = completed.findIndex((item) => item.id === targetId)
  if (index < 0) throw new Error(`Target completed item ${targetId} was not found`)
  const earlier = completed.slice(0, index)
  const later = completed.slice(index + 1)
  // Chronological blockers may overlap or nest across rows. The immediate
  // predecessor by start time is not necessarily the one whose end is closest
  // to the target, so use the strongest boundary from every earlier item.
  const previous = earlier.reduce((closest, candidate) => (
    closest == null || candidate.endedAt > closest.endedAt ? candidate : closest
  ), null)
  const next = later[0] ?? null
  return {
    previous,
    next,
    previousEnd: previous?.endedAt ?? earliestAllowed,
    nextStart: next?.startedAt ?? now,
  }
}

function completedDuration(item) {
  if (!item || item.endedAt == null) throw new TypeError('A completed item is required')
  const duration = item.endedAt - item.startedAt
  if (!Number.isFinite(duration) || duration <= 0) throw new RangeError('Item duration must be greater than zero')
  return duration
}

function finalValue(proposed, original, isFinalGesture, snapMs, minimum = -Infinity, maximum = Infinity) {
  if (!isFinalGesture || proposed === original) return proposed
  // A pointer that has reached a model neighbour boundary must stay precisely
  // there. Snapping a non-minute-aligned boundary first would pull it away.
  if (proposed <= minimum || proposed >= maximum) return clamp(proposed, minimum, maximum)
  return clamp(snapTimestamp(proposed, snapMs), minimum, maximum)
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value))
}

export function constrainMove({
  item,
  proposedStartedAt,
  previousEnd,
  nextStart,
  neighbourGapMs = 0,
  snapMs = DEFAULT_SNAP_MS,
  isFinalGesture = false,
}) {
  const duration = completedDuration(item)
  assertFinite(proposedStartedAt, 'proposedStartedAt')
  assertFinite(previousEnd, 'previousEnd')
  assertFinite(nextStart, 'nextStart')
  if (!Number.isFinite(neighbourGapMs) || neighbourGapMs < 0) throw new RangeError('neighbour gap must be zero or greater')
  const latestStart = nextStart - duration - neighbourGapMs
  const earliestStart = previousEnd + neighbourGapMs
  if (latestStart < earliestStart) throw new RangeError('Neighbour bounds cannot contain the item duration and gap')

  const proposed = finalValue(proposedStartedAt, item.startedAt, isFinalGesture, snapMs, earliestStart, latestStart)
  const startedAt = clamp(proposed, earliestStart, latestStart)
  return { startedAt, endedAt: startedAt + duration }
}

export function constrainResizeLeft({
  item,
  proposedStartedAt,
  previousEnd,
  neighbourGapMs = 0,
  minimumDurationMs = DEFAULT_MINIMUM_DURATION_MS,
  snapMs = DEFAULT_SNAP_MS,
  isFinalGesture = false,
}) {
  completedDuration(item)
  assertFinite(proposedStartedAt, 'proposedStartedAt')
  assertFinite(previousEnd, 'previousEnd')
  if (!Number.isFinite(minimumDurationMs) || minimumDurationMs <= 0) {
    throw new RangeError('minimum duration must be greater than zero')
  }
  if (!Number.isFinite(neighbourGapMs) || neighbourGapMs < 0) throw new RangeError('neighbour gap must be zero or greater')
  const earliestStart = previousEnd + neighbourGapMs
  const latestStart = item.endedAt - minimumDurationMs
  if (latestStart < earliestStart) throw new RangeError('Neighbour bounds cannot contain the minimum duration and gap')

  const proposed = finalValue(proposedStartedAt, item.startedAt, isFinalGesture, snapMs, earliestStart, latestStart)
  return { startedAt: clamp(proposed, earliestStart, latestStart), endedAt: item.endedAt }
}

export function constrainResizeRight({
  item,
  proposedEndedAt,
  nextStart,
  now,
  neighbourGapMs = 0,
  minimumDurationMs = DEFAULT_MINIMUM_DURATION_MS,
  snapMs = DEFAULT_SNAP_MS,
  isFinalGesture = false,
}) {
  completedDuration(item)
  assertFinite(proposedEndedAt, 'proposedEndedAt')
  assertFinite(nextStart, 'nextStart')
  assertFinite(now, 'now')
  if (!Number.isFinite(minimumDurationMs) || minimumDurationMs <= 0) {
    throw new RangeError('minimum duration must be greater than zero')
  }
  if (!Number.isFinite(neighbourGapMs) || neighbourGapMs < 0) throw new RangeError('neighbour gap must be zero or greater')
  const earliestEnd = item.startedAt + minimumDurationMs
  const latestEnd = Math.min(nextStart - neighbourGapMs, now)
  if (latestEnd < earliestEnd) throw new RangeError('Neighbour bounds cannot contain the minimum duration and gap')

  const proposed = finalValue(proposedEndedAt, item.endedAt, isFinalGesture, snapMs, earliestEnd, latestEnd)
  return { startedAt: item.startedAt, endedAt: clamp(proposed, earliestEnd, latestEnd) }
}
