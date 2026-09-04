export const HOUR_MS = 60 * 60 * 1000
export const DAY_MS = 24 * HOUR_MS
export const DEFAULT_MIN_VIEW_SPAN_MS = HOUR_MS
export const DEFAULT_VIEW_SPAN_MS = DAY_MS
export const DEFAULT_MAX_VIEW_SPAN_MS = 7 * DAY_MS
export const DEFAULT_ZOOM_BOUNDARIES_MS = Object.freeze([DAY_MS, 3 * DAY_MS])

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value))
}

function validateBounds(now, minViewSpanMs, maxViewSpanMs) {
  if (!Number.isFinite(now)) throw new TypeError('now must be a finite timestamp')
  if (!Number.isFinite(minViewSpanMs) || minViewSpanMs <= 0) {
    throw new RangeError('minViewSpanMs must be greater than zero')
  }
  if (!Number.isFinite(maxViewSpanMs) || maxViewSpanMs < minViewSpanMs) {
    throw new RangeError('maxViewSpanMs must be at least minViewSpanMs')
  }
}

export function resistZoomSpan({
  currentSpan,
  proposedSpan,
  boundaries = DEFAULT_ZOOM_BOUNDARIES_MS,
  resistance = 0.25,
}) {
  if (!Number.isFinite(currentSpan) || !Number.isFinite(proposedSpan)) {
    throw new TypeError('zoom spans must be finite')
  }
  const direction = Math.sign(proposedSpan - currentSpan)
  if (direction === 0) return proposedSpan
  for (const boundary of boundaries) {
    const crossed = direction > 0
      ? currentSpan < boundary && proposedSpan >= boundary
      : currentSpan > boundary && proposedSpan <= boundary
    if (crossed) return boundary
    if (Math.abs(currentSpan - boundary) < 1) {
      return boundary + (proposedSpan - boundary) * resistance
    }
  }
  return proposedSpan
}

export function normalizeTimelineView({
  view,
  now,
  minViewSpanMs = DEFAULT_MIN_VIEW_SPAN_MS,
  maxViewSpanMs = DEFAULT_MAX_VIEW_SPAN_MS,
}) {
  validateBounds(now, minViewSpanMs, maxViewSpanMs)
  if (!view || !Number.isFinite(view.start) || !Number.isFinite(view.end) || view.end <= view.start) {
    throw new TypeError('view must have finite increasing start and end timestamps')
  }

  const requestedSpan = view.end - view.start
  const span = clamp(requestedSpan, minViewSpanMs, maxViewSpanMs)
  const earliest = now - maxViewSpanMs
  const requestedFocus = Number.isFinite(view.focusedAt) ? view.focusedAt : view.start + requestedSpan / 2
  const focusRatio = clamp((requestedFocus - view.start) / requestedSpan, 0, 1)
  let start = requestedFocus - focusRatio * span
  let end = start + span

  if (end > now) {
    start -= end - now
    end = now
  }
  if (start < earliest) {
    end += earliest - start
    start = earliest
  }

  return {
    start,
    end,
    focusedAt: clamp(requestedFocus, start, end),
  }
}

export function createInitialView({
  now,
  defaultViewSpanMs = DEFAULT_VIEW_SPAN_MS,
  minViewSpanMs = DEFAULT_MIN_VIEW_SPAN_MS,
  maxViewSpanMs = DEFAULT_MAX_VIEW_SPAN_MS,
} = {}) {
  validateBounds(now, minViewSpanMs, maxViewSpanMs)
  const span = clamp(defaultViewSpanMs, minViewSpanMs, maxViewSpanMs)
  return { start: now - span, end: now, focusedAt: now }
}

export function zoomTimelineView({
  view,
  now,
  factor,
  anchor = view.focusedAt,
  minViewSpanMs = DEFAULT_MIN_VIEW_SPAN_MS,
  maxViewSpanMs = DEFAULT_MAX_VIEW_SPAN_MS,
}) {
  if (!Number.isFinite(factor) || factor <= 0) throw new RangeError('zoom factor must be greater than zero')
  const current = normalizeTimelineView({ view, now, minViewSpanMs, maxViewSpanMs })
  const currentSpan = current.end - current.start
  const span = clamp(currentSpan * factor, minViewSpanMs, maxViewSpanMs)
  const safeAnchor = clamp(Number.isFinite(anchor) ? anchor : current.focusedAt, current.start, current.end)
  const ratio = (safeAnchor - current.start) / currentSpan
  return normalizeTimelineView({
    view: {
      start: safeAnchor - ratio * span,
      end: safeAnchor + (1 - ratio) * span,
      focusedAt: safeAnchor,
    },
    now,
    minViewSpanMs,
    maxViewSpanMs,
  })
}

export function panTimelineView({
  view,
  now,
  deltaMs,
  minViewSpanMs = DEFAULT_MIN_VIEW_SPAN_MS,
  maxViewSpanMs = DEFAULT_MAX_VIEW_SPAN_MS,
}) {
  if (!Number.isFinite(deltaMs)) throw new TypeError('deltaMs must be finite')
  const current = normalizeTimelineView({ view, now, minViewSpanMs, maxViewSpanMs })
  return normalizeTimelineView({
    view: {
      start: current.start + deltaMs,
      end: current.end + deltaMs,
      focusedAt: current.focusedAt + deltaMs,
    },
    now,
    minViewSpanMs,
    maxViewSpanMs,
  })
}
