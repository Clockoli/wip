import {
  DEFAULT_MINIMUM_DURATION_MS,
  DEFAULT_SNAP_MS,
  constrainMove,
  constrainResizeLeft,
  constrainResizeRight,
  getCompletedNeighbourBounds,
} from './constraints.js'
import {
  createInitialView,
  DAY_MS,
  HOUR_MS,
  normalizeTimelineView,
  panTimelineView,
  resistZoomSpan,
  zoomTimelineView,
} from './interaction.js'
import {
  calculateTrackedDuration,
  createColorResolver,
  findAdjacentItemConnections,
  itemRowId,
  layoutTimelineItems,
  resolveTimelineRows,
  sortTimelineItems,
} from './layout.js'
import { createElasticScale, MINIMUM_ITEM_GAP, MINIMUM_ITEM_WIDTH } from './scale.js'

const DEFAULTS = Object.freeze({
  items: [],
  rows: [],
  minViewSpanMs: HOUR_MS,
  maxViewSpanMs: 7 * DAY_MS,
  defaultViewSpanMs: DAY_MS,
  snapMs: DEFAULT_SNAP_MS,
  minimumDurationMs: DEFAULT_MINIMUM_DURATION_MS,
})

const HEADER_HEIGHT = 36
const ROW_HEIGHT = 68
const ROW_ITEM_TOP = 24

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'medium',
})
const hourFormatter = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})
const dayFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
})

function formatDateTime(timestamp) {
  return dateTimeFormatter.format(new Date(timestamp))
}

function formatDuration(durationMs) {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const parts = []
  if (hours) parts.push(`${hours}h`)
  if (minutes) parts.push(`${minutes}m`)
  if (seconds || parts.length === 0) parts.push(`${seconds}s`)
  return parts.join(' ')
}

function formatClockDuration(durationMs) {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':')
}

function isRunning(item) {
  return item.endedAt == null || item.isRunning === true
}

function canEdit(item) {
  return item.isEditable !== false
}

function canMove(item) {
  return canEdit(item) && !isRunning(item)
}

function canResizeLeft(item) {
  return canEdit(item)
}

function canResizeRight(item) {
  return canEdit(item) && !isRunning(item)
}

function createElement(tag, className, attributes = {}) {
  const element = document.createElement(tag)
  if (className) element.className = className
  for (const [name, value] of Object.entries(attributes)) {
    if (value != null) element.setAttribute(name, String(value))
  }
  return element
}

function sameEdit(edit, item) {
  return edit.startedAt === item.startedAt && (isRunning(item) || edit.endedAt === item.endedAt)
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value))
}

export function createElasticTimeline(container, initialProps) {
  if (!(container instanceof Element)) throw new TypeError('container must be a DOM Element')
  if (!initialProps || !Number.isFinite(initialProps.now)) throw new TypeError('props.now must be a finite timestamp')

  let props = { ...DEFAULTS, ...initialProps }
  let destroyed = false
  let selectedId = null
  let hoveredId = null
  let scale = null
  let scaleDirty = true
  let gesture = null
  let previewEdit = null
  let committedPreview = null
  let geometryCache = null
  let suppressClickUntil = 0
  let lastItemClick = { id: null, at: Number.NEGATIVE_INFINITY }
  let handledClickPair = { id: null, at: Number.NEGATIVE_INFINITY }
  let resizeFrame = 0
  let summaryPositionFrame = 0
  let renderedContainerWidth = 0
  let applyingAuthoritativeUpdate = false
  const pendingStartIds = new Set()
  const pendingStopIds = new Set()
  const pendingDeleteIds = new Set()
  let summaryActionPending = false
  const resolveColor = createColorResolver()
  const abortController = new AbortController()
  const signal = abortController.signal

  let view = props.view
    ? normalizeTimelineView({
        view: props.view,
        now: props.now,
        minViewSpanMs: props.minViewSpanMs,
        maxViewSpanMs: props.maxViewSpanMs,
      })
    : createInitialView(props)

  container.replaceChildren()
  const root = createElement('section', 'elastic-timeline', {
    'aria-label': 'Time interval editor',
  })
  root.innerHTML = `
    <div class="elastic-timeline__summary" data-testid="timeline-summary">
      <time class="elastic-timeline__summary-edge" data-testid="timeline-start"></time>
      <strong class="elastic-timeline__summary-total" data-testid="timeline-total"></strong>
      <button class="elastic-timeline__details-action elastic-timeline__summary-action" data-testid="timeline-summary-action" type="button" style="visibility:hidden" hidden></button>
      <time class="elastic-timeline__summary-edge elastic-timeline__summary-edge--end" data-testid="timeline-end"></time>
    </div>
    <div class="elastic-timeline__viewport" data-testid="timeline-viewport" tabindex="0" aria-label="Timeline. Arrow keys pan; Alt with the wheel zooms.">
      <div class="elastic-timeline__canvas" data-testid="timeline-canvas">
        <div class="elastic-timeline__header" data-role="header" aria-hidden="true"></div>
        <div class="elastic-timeline__day-boundaries" data-role="day-boundaries" aria-hidden="true"></div>
        <div class="elastic-timeline__track" data-role="track"></div>
      </div>
    </div>
    <div class="elastic-timeline__details-pointer" data-testid="timeline-details-pointer" aria-hidden="true" hidden></div>
    <section class="elastic-timeline__details" data-testid="timeline-details" aria-live="polite" hidden></section>
  `
  container.append(root)

  const viewport = root.querySelector('[data-testid="timeline-viewport"]')
  const canvas = root.querySelector('[data-testid="timeline-canvas"]')
  const header = root.querySelector('[data-role="header"]')
  const dayBoundaries = root.querySelector('[data-role="day-boundaries"]')
  const track = root.querySelector('[data-role="track"]')

  const detailsPointer = root.querySelector('[data-testid="timeline-details-pointer"]')
  const details = root.querySelector('[data-testid="timeline-details"]')
  const summaryStart = root.querySelector('[data-testid="timeline-start"]')
  const summaryTotal = root.querySelector('[data-testid="timeline-total"]')
  const summaryAction = root.querySelector('[data-testid="timeline-summary-action"]')
  const summaryEnd = root.querySelector('[data-testid="timeline-end"]')

  summaryAction.addEventListener('click', async () => {
    if (summaryActionPending || typeof props.onSummaryAction !== 'function' || props.isSummaryActionDisabled === true) return
    summaryActionPending = true
    summaryAction.disabled = true
    try { await props.onSummaryAction() }
    finally {
      summaryActionPending = false
      if (!destroyed) renderSummaryAction()
    }
  }, { signal })

  function viewOptions() {
    return {
      now: props.now,
      minViewSpanMs: props.minViewSpanMs,
      maxViewSpanMs: props.maxViewSpanMs,
    }
  }

  function effectiveItems() {
    const active = previewEdit || committedPreview
    if (!active) return props.items
    return props.items.map((item) => item.id === active.id
      ? { ...item, startedAt: active.startedAt, endedAt: active.endedAt }
      : item)
  }

  async function requestStart(item) {
    const current = props.items.find((candidate) => candidate.id === item.id) ?? item
    if (typeof props.onStart !== 'function' || current.isStartDisabled === true || pendingStartIds.has(item.id)) return
    pendingStartIds.add(item.id)
    renderDetails()
    try {
      await props.onStart(current)
    } finally {
      pendingStartIds.delete(item.id)
      if (!destroyed) renderDetails()
    }
  }

  async function requestStop(item) {
    const current = props.items.find((candidate) => candidate.id === item.id) ?? item
    if (typeof props.onStop !== 'function' || current.isStopDisabled === true || pendingStopIds.has(item.id)) return
    pendingStopIds.add(item.id)
    renderDetails()
    try {
      await props.onStop(current)
    } finally {
      pendingStopIds.delete(item.id)
      if (!destroyed) renderDetails()
    }
  }

  async function requestDelete(item) {
    const current = props.items.find((candidate) => candidate.id === item.id) ?? item
    if (typeof props.onDelete !== 'function' || current.isDeleteDisabled === true || pendingDeleteIds.has(item.id)) return
    pendingDeleteIds.add(item.id)
    renderDetails()
    try {
      await props.onDelete(current)
    } finally {
      pendingDeleteIds.delete(item.id)
      if (!destroyed) renderDetails()
    }
  }

  function renderSummaryAction() {
    const visible = Boolean(props.summaryActionLabel && typeof props.onSummaryAction === 'function')
    summaryAction.hidden = !visible
    summaryAction.parentElement.dataset.hasAction = String(visible)
    if (!visible) return
    summaryAction.textContent = props.summaryActionLabel
    summaryAction.disabled = summaryActionPending || props.isSummaryActionDisabled === true
    scheduleSummaryActionPosition()
  }

  function scheduleSummaryActionPosition() {
    cancelAnimationFrame(summaryPositionFrame)
    summaryPositionFrame = requestAnimationFrame(() => {
      summaryPositionFrame = 0
      positionSummaryAction()
    })
  }

  function positionSummaryAction() {
    if (destroyed || summaryAction.hidden) return
    if (getComputedStyle(root).getPropertyValue('--et-summary-layout-ready').trim() !== '1') {
      summaryAction.style.visibility = 'hidden'
      scheduleSummaryActionPosition()
      return
    }
    if (getComputedStyle(summaryAction).position !== 'absolute') {
      summaryAction.style.left = ''
      summaryAction.style.visibility = 'visible'
      return
    }
    const summaryBox = summaryAction.parentElement.getBoundingClientRect()
    const totalBox = summaryTotal.getBoundingClientRect()
    const endBox = summaryEnd.getBoundingClientRect()
    const actionBox = summaryAction.getBoundingClientRect()
    const midpoint = (totalBox.right + endBox.left) / 2
    summaryAction.style.left = `${midpoint - summaryBox.left - actionBox.width / 2}px`
    summaryAction.style.visibility = 'visible'
  }

  function timelineRows() {
    return resolveTimelineRows(props.items, props.rows)
  }

  function setView(nextView, { preserveRightEdge = false } = {}) {
    const normalized = normalizeTimelineView({ view: nextView, ...viewOptions() })
    if (
      normalized.start === view.start && normalized.end === view.end &&
      normalized.focusedAt === view.focusedAt
    ) return
    view = normalized
    scaleDirty = true
    geometryCache = null
    props.onViewChange?.({ ...view })
    render()
    if (preserveRightEdge) {
      viewport.scrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth)
      updateHeaderLabelVisibility()
    }
  }

  function zoom(factor, anchor = view.focusedAt) {
    const currentSpan = view.end - view.start
    const proposedSpan = currentSpan * factor
    const resistedSpan = resistZoomSpan({ currentSpan, proposedSpan })
    const preserveRightEdge = factor > 1 && view.end === props.now
      && Math.abs(viewport.scrollLeft - Math.max(0, viewport.scrollWidth - viewport.clientWidth)) <= 1
    setView(zoomTimelineView({
      view,
      factor: resistedSpan / currentSpan,
      anchor,
      ...viewOptions(),
    }), { preserveRightEdge })
  }

  function pan(deltaMs) {
    setView(panTimelineView({ view, deltaMs, ...viewOptions() }))
  }

  function scrollElasticOverflow(pixels) {
    const maximum = Math.max(0, viewport.scrollWidth - viewport.clientWidth)
    if (maximum <= 0 || pixels === 0) return false
    const next = clamp(viewport.scrollLeft + pixels, 0, maximum)
    if (Math.abs(next - viewport.scrollLeft) <= 0.5) return false
    viewport.scrollLeft = next
    updateHeaderLabelVisibility()
    return true
  }

  function hoveredItem() {
    return effectiveItems().find((item) => item.id === hoveredId) ?? null
  }

  function select(item) {
    selectedId = item.id
    props.onSelect?.(item)
    for (const element of track.querySelectorAll('[data-testid="timeline-item"]')) {
      element.dataset.selected = String(element.dataset.itemId === selectedId)
    }
  }

  function renderDetails() {
    const item = hoveredItem()
    details.replaceChildren()
    if (!item) {
      details.hidden = true
      return
    }
    details.hidden = false
    const content = createElement('div')
    const title = createElement('h3', 'elastic-timeline__details-title')
    title.textContent = item.title
    content.append(title)
    if (item.url) {
      const link = createElement('a', 'elastic-timeline__link', {
        href: item.url,
        target: '_blank',
        rel: 'noreferrer noopener',
      })
      link.textContent = item.url
      content.append(link)
    }
    const visualEnd = item.endedAt == null ? props.now : item.endedAt
    const times = createElement('div', 'elastic-timeline__details-time')
    times.textContent = `${formatDateTime(item.startedAt)} — ${item.endedAt == null ? `now (${formatDateTime(props.now)})` : formatDateTime(item.endedAt)}`
    const duration = createElement('div', 'elastic-timeline__details-duration')
    duration.textContent = `Duration: ${formatDuration(visualEnd - item.startedAt)}`
    const hint = createElement('div', 'elastic-timeline__details-hint')
    hint.textContent = item.endedAt == null || item.isRunning
      ? 'Currently running · Double-click to stop'
      : 'Double-click to start this task'
    content.append(times, duration, hint)
    details.append(content)
    const actions = createElement('div', 'elastic-timeline__details-actions')
    if (typeof props.onDelete === 'function') {
      const remove = createElement('button', 'elastic-timeline__details-action elastic-timeline__details-delete', {
        type: 'button',
        'data-testid': 'timeline-delete',
      })
      remove.disabled = item.isDeleteDisabled === true || pendingDeleteIds.has(item.id)
      remove.textContent = 'Delete'
      remove.addEventListener('click', async (event) => {
        event.stopPropagation()
        remove.disabled = true
        try { await requestDelete(item) }
        catch { remove.disabled = item.isDeleteDisabled === true }
      }, { signal })
      actions.append(remove)
    }
    if (isRunning(item) && typeof props.onStop === 'function') {
      const stop = createElement('button', 'elastic-timeline__details-action elastic-timeline__details-stop', {
        type: 'button',
        'data-testid': 'timeline-stop',
        'data-started-at': item.startedAt,
      })
      stop.disabled = item.isStopDisabled === true || pendingStopIds.has(item.id)
      stop.textContent = `Stop ${formatClockDuration(Date.now() - item.startedAt)}`
      stop.addEventListener('click', async (event) => {
        event.stopPropagation()
        stop.disabled = true
        try { await requestStop(item) }
        catch { stop.disabled = item.isStopDisabled === true }
      }, { signal })
      actions.append(stop)
    } else if (typeof props.onStart === 'function') {
      const start = createElement('button', 'elastic-timeline__details-action elastic-timeline__details-start', {
        type: 'button',
        'data-testid': 'timeline-start-tracking',
      })
      start.disabled = item.isStartDisabled === true || pendingStartIds.has(item.id)
      start.textContent = 'Start tracking'
      start.addEventListener('click', async (event) => {
        event.stopPropagation()
        start.disabled = true
        try { await requestStart(item) }
        catch { start.disabled = item.isStartDisabled === true }
      }, { signal })
      actions.append(start)
    }
    if (actions.childElementCount) details.append(actions)
  }

  function updateRunningDetailsClock() {
    const stop = details.querySelector('[data-testid="timeline-stop"]')
    if (!stop) return
    const startedAt = Number(stop.dataset.startedAt)
    if (!Number.isFinite(startedAt)) return
    stop.textContent = `Stop ${formatClockDuration(Date.now() - startedAt)}`
  }

  function renderDetailsPointer() {
    const itemElement = hoveredId === null ? null : track.querySelector(`[data-item-id="${CSS.escape(hoveredId)}"]`)
    for (const element of track.querySelectorAll('[data-testid="timeline-item"]')) {
      element.dataset.detailsActive = String(element === itemElement)
    }
    if (!itemElement || details.hidden) { detailsPointer.hidden = true; return }
    const rootRect = root.getBoundingClientRect(), itemRect = itemElement.getBoundingClientRect(), detailsRect = details.getBoundingClientRect()
    const height = Math.max(8, detailsRect.top - itemRect.bottom)
    detailsPointer.style.left = `${itemRect.left - rootRect.left + itemRect.width / 2}px`
    detailsPointer.style.top = `${itemRect.bottom - rootRect.top}px`
    detailsPointer.style.height = `${height}px`
    detailsPointer.hidden = false
  }

  function isLocalDayStart(timestamp) {
    const date = new Date(timestamp)
    return date.getHours() === 0 && date.getMinutes() === 0 && date.getSeconds() === 0 && date.getMilliseconds() === 0
  }

  function renderDayBoundaries() {
    dayBoundaries.replaceChildren()
    for (const cell of scale.cells) {
      if (cell.start <= view.start || !isLocalDayStart(cell.start)) continue
      const boundary = createElement('span', 'elastic-timeline__day-boundary', {
        'data-testid': 'timeline-day-boundary',
        'data-boundary-at': new Date(cell.start).toISOString(),
      })
      boundary.style.left = `${cell.x}px`
      dayBoundaries.append(boundary)
    }
  }

  function headerSegments() {
    if (scale.cells[0]?.kind !== 'hour') return scale.cells.map(cell => ({ ...cell, empty: cell.count === 0 }))
    const segments = []
    for (const cell of scale.cells) {
      const empty = cell.count === 0
      const previous = segments.at(-1)
      if (empty && previous?.empty && previous.cellCount < 6) {
        previous.end = cell.end
        previous.endX = cell.endX
        previous.width = previous.endX - previous.x
        previous.cellCount += 1
      } else {
        segments.push({ ...cell, empty, cellCount: 1 })
      }
    }
    return segments
  }

  function renderHeader() {
    header.replaceChildren()
    headerSegments().forEach((cell, index) => {
      const cellElement = createElement('div', 'elastic-timeline__cell')
      cellElement.dataset.cellIndex = String(index)
      cellElement.dataset.cellKind = cell.kind
      cellElement.dataset.labelStart = String(cell.start)
      cellElement.dataset.labelEnd = String(cell.end)
      cellElement.dataset.empty = String(cell.empty)
      cellElement.style.left = `${cell.x}px`
      cellElement.style.width = `${cell.width}px`
      const label = createElement('span', 'elastic-timeline__cell-label')
      label.textContent = cell.kind === 'hour'
        ? (cell.empty && cell.end > cell.start
            ? `${hourFormatter.format(new Date(cell.start))} - ${hourFormatter.format(new Date(cell.end))}`
            : hourFormatter.format(new Date(cell.start)))
        : dayFormatter.format(new Date(cell.start))
      cellElement.append(label)
      header.append(cellElement)
    })
    if (view.end === props.now && props.items.some((item) => isRunning(item) && item.startedAt <= view.end)) {
      const currentTime = createElement('time', 'elastic-timeline__current-time', {
        'data-testid': 'timeline-current-time',
        datetime: new Date(view.end).toISOString(),
      })
      currentTime.textContent = hourFormatter.format(new Date(view.end))
      header.append(currentTime)
    }
    requestAnimationFrame(updateHeaderLabelVisibility)
  }

  function updateHeaderLabelVisibility() {
    if (destroyed) return
    const visibleStart = viewport.scrollLeft
    const visibleEnd = visibleStart + viewport.clientWidth
    const currentTime = header.querySelector('[data-testid="timeline-current-time"]')
    if (currentTime) {
      const maximumScrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth)
      currentTime.hidden = Math.abs(viewport.scrollLeft - maximumScrollLeft) > 1
    }
    for (const cellElement of header.querySelectorAll('.elastic-timeline__cell')) {
      const label = cellElement.querySelector('.elastic-timeline__cell-label')
      cellElement.style.visibility = 'visible'
      label.hidden = false
      const cellStart = cellElement.offsetLeft
      const cellEnd = cellStart + cellElement.offsetWidth
      const visibleWidth = Math.min(cellEnd, visibleEnd) - Math.max(cellStart, visibleStart)
      if (visibleWidth <= 0) {
        cellElement.style.visibility = 'hidden'
        continue
      }
      const labelWidth = label.getBoundingClientRect().width
      if (cellElement.dataset.cellKind === 'hour' && visibleWidth + 0.5 < labelWidth + 2) {
        cellElement.style.visibility = 'hidden'
        continue
      }
      const minimumStart = Math.max(cellStart + 1, visibleStart + 1)
      const maximumStart = Math.min(cellEnd - labelWidth - 1, visibleEnd - labelWidth - 1)
      label.style.left = `${Math.max(cellStart + 1, Math.min(minimumStart, maximumStart)) - cellStart}px`
    }
  }

  function itemAccessibleName(item) {
    const visualEnd = item.endedAt == null ? props.now : item.endedAt
    let actions = 'Read-only.'
    if (canMove(item)) actions = 'Movable and resizable from either edge.'
    else if (canResizeLeft(item)) actions = 'Start time can be resized.'
    return `${item.title}. ${formatDateTime(item.startedAt)} — ${formatDateTime(visualEnd)}. ${actions}`
  }

  function snapshotGeometry() {
    return new Map([...track.querySelectorAll('[data-testid="timeline-item"]')].map((element) => [
      element.dataset.itemId,
      {
        x: element.offsetLeft,
        width: element.getBoundingClientRect().width,
      },
    ]))
  }

  function restoreGeometry(snapshot) {
    if (!snapshot) return
    for (const element of track.querySelectorAll('[data-testid="timeline-item"]')) {
      const geometry = snapshot.get(element.dataset.itemId)
      if (!geometry) continue
      element.style.left = `${geometry.x}px`
      element.style.width = `${geometry.width}px`
    }
  }

  function renderConnectors(items = effectiveItems()) {
    const connections = new Map(
      findAdjacentItemConnections(items).map((connection) => [
        `${connection.rowId}\u0000${connection.fromId}\u0000${connection.toId}`,
        connection,
      ]),
    )

    const rendered = new Map()
    for (const connector of track.querySelectorAll('[data-testid="timeline-connector"]')) {
      const key = connector.dataset.connectionKey
      if (!key || rendered.has(key) || !connections.has(key)) {
        connector.remove()
        continue
      }
      rendered.set(key, connector)
    }

    for (const [key, connection] of connections) {
      const from = track.querySelector(`[data-item-id="${CSS.escape(connection.fromId)}"]`)
      const to = track.querySelector(`[data-item-id="${CSS.escape(connection.toId)}"]`)
      if (!from || !to) {
        rendered.get(key)?.remove()
        continue
      }
      const centerX = (from.offsetLeft + from.getBoundingClientRect().width + to.offsetLeft) / 2
      const centerY = from.offsetTop + from.getBoundingClientRect().height / 2
      const connector = rendered.get(key) ?? createElement('span', 'elastic-timeline__connector', {
          'data-testid': 'timeline-connector',
          'data-from-id': connection.fromId,
          'data-to-id': connection.toId,
          'data-connection-key': key,
          'aria-hidden': 'true',
        })
      connector.style.left = `${centerX}px`
      connector.style.top = `${centerY}px`
      if (!connector.isConnected) track.append(connector)
    }
  }

  function gestureConstraintContext(item) {
    const constraintItem = isRunning(item) ? { ...item, endedAt: props.now } : item
    const constraintItems = props.items
      .map((candidate) => candidate.id === item.id ? constraintItem : candidate)
    const completedBounds = getCompletedNeighbourBounds(constraintItems, item.id, {
      earliestAllowed: props.now - props.maxViewSpanMs,
      now: props.now,
    })
    const runningNextStart = constraintItems
      .filter((candidate) => candidate.id !== item.id && isRunning(candidate) && candidate.startedAt >= constraintItem.endedAt)
      .reduce((earliest, candidate) => Math.min(earliest, candidate.startedAt), Infinity)
    const bounds = Number.isFinite(runningNextStart)
      ? { ...completedBounds, nextStart: Math.min(completedBounds.nextStart, runningNextStart) }
      : completedBounds
    return { constraintItem, bounds }
  }

  function applyGestureGeometry(edit) {
    if (!gesture || !edit) return
    const base = gesture.baseGeometry.get(gesture.item.id)
    if (!base) return
    const element = gesture.element
    if (gesture.kind === 'move') {
      const x = Math.min(
        gesture.visualMaxRight - base.width,
        Math.max(gesture.visualMinLeft, scale.toX(edit.startedAt)),
      )
      element.style.left = `${x}px`
      element.style.width = `${base.width}px`
      return
    }
    if (gesture.kind === 'resize-left') {
      const right = base.x + base.width
      const x = clamp(scale.toX(edit.startedAt), gesture.visualMinLeft, right - MINIMUM_ITEM_WIDTH)
      element.style.left = `${x}px`
      element.style.width = `${Math.max(MINIMUM_ITEM_WIDTH, right - x)}px`
      return
    }
    const end = clamp(scale.toX(edit.endedAt), base.x + MINIMUM_ITEM_WIDTH, gesture.visualMaxRight)
    element.style.left = `${base.x}px`
    element.style.width = `${Math.max(MINIMUM_ITEM_WIDTH, end - base.x)}px`
  }

  function emitGestureDebug(phase, detail = {}) {
    const current = gesture
    if (!current || typeof props.onEditDebug !== 'function') return
    const edit = detail.edit || null
    const signature = [phase, current.kind, current.item.id, detail.rawTimestamp, detail.proposedTimestamp,
      edit?.startedAt, edit?.endedAt, detail.committed].join('|')
    if (phase === 'preview' && current.debugSignature === signature) return
    current.debugSignature = signature
    props.onEditDebug({
      phase,
      id: current.item.id,
      kind: current.kind,
      bounds: { previousEnd: current.bounds.previousEnd, nextStart: current.bounds.nextStart },
      snapMs: props.snapMs,
      rawTimestamp: detail.rawTimestamp,
      proposedTimestamp: detail.proposedTimestamp,
      edit: edit ? { startedAt: edit.startedAt, endedAt: edit.endedAt } : null,
      ...(Object.hasOwn(detail, 'committed') ? { committed: detail.committed } : {}),
    })
  }

  function pointerDown(event, item, kind, element) {
    const permitted = kind === 'move'
      ? canMove(item)
      : kind === 'resize-left'
        ? canResizeLeft(item)
        : canResizeRight(item)
    if (event.button !== 0 || !permitted) return
    let constraintItem
    let bounds
    try {
      ({ constraintItem, bounds } = gestureConstraintContext(item))
    } catch {
      return
    }
    event.preventDefault()
    element.focus({ preventScroll: true })
    element.setPointerCapture(event.pointerId)
    const baseGeometry = snapshotGeometry()
    const renderedElements = new Map(
      [...track.querySelectorAll('[data-testid="timeline-item"]')]
        .map((candidate) => [candidate.dataset.itemId, candidate]),
    )
    const elements = sortTimelineItems(effectiveItems())
      .map((candidate) => renderedElements.get(String(candidate.id)))
      .filter(Boolean)
    const index = elements.indexOf(element)
    const previousGeometry = index > 0 ? baseGeometry.get(elements[index - 1].dataset.itemId) : null
    const nextGeometry = index >= 0 && index < elements.length - 1
      ? baseGeometry.get(elements[index + 1].dataset.itemId)
      : null
    const base = baseGeometry.get(item.id)
    const visualMinLeft = previousGeometry
      ? previousGeometry.x + previousGeometry.width + MINIMUM_ITEM_GAP
      : 0
    const visualMaxRight = nextGeometry ? nextGeometry.x - MINIMUM_ITEM_GAP : scale.width
    const rightResizeLimit = Math.min(bounds.nextStart, props.now)
    gesture = {
      pointerId: event.pointerId,
      item,
      constraintItem,
      kind,
      element,
      bounds,
      baseGeometry,
      visualMinLeft,
      visualMaxRight,
      visualMinStartedAt: scale.toTime(visualMinLeft),
      visualMaxStartedAt: scale.toTime(visualMaxRight - base.width),
      visualResizeLeftMaxStartedAt: Math.min(
        constraintItem.endedAt - props.minimumDurationMs,
        scale.toTime(Math.max(visualMinLeft, visualMaxRight - MINIMUM_ITEM_WIDTH)),
      ),
      visualResizeRightMinEndedAt: constraintItem.startedAt + props.minimumDurationMs,
      rightResizeLimit,
      visualMaxEndedAt: rightResizeLimit,
      originClientX: event.clientX,

      moved: false,
      lastProposal: kind === 'resize-right' ? constraintItem.endedAt : constraintItem.startedAt,
    }
    element.dataset.dragging = 'true'
    emitGestureDebug('start', {
      rawTimestamp: gesture.lastProposal,
      proposedTimestamp: gesture.lastProposal,
      edit: { startedAt: constraintItem.startedAt, endedAt: constraintItem.endedAt },
    })
  }

  function proposalForGesture(event, isFinalGesture = false) {
    if (!gesture) return null
    const { item, constraintItem, kind, bounds } = gesture
    const deltaX = event.clientX - gesture.originClientX
    const base = gesture.baseGeometry.get(item.id)
    const baseEdgeX = kind === 'resize-right' ? base.x + base.width : base.x
    const rawEdgeX = baseEdgeX + deltaX
    const rawProposedTimestamp = scale.toTime(clamp(rawEdgeX, 0, scale.width))
    if (kind === 'move') {
      const proposedTimestamp = rawEdgeX <= gesture.visualMinLeft
        ? bounds.previousEnd + props.snapMs
        : rawEdgeX >= gesture.visualMaxRight - base.width
          ? bounds.nextStart - (constraintItem.endedAt - constraintItem.startedAt) - props.snapMs
          : rawProposedTimestamp
      gesture.lastProposal = proposedTimestamp
      return {
        id: item.id,
        ...constrainMove({
          item: constraintItem,
          proposedStartedAt: proposedTimestamp,
          previousEnd: bounds.previousEnd,
          nextStart: bounds.nextStart,
          neighbourGapMs: props.snapMs,
          snapMs: props.snapMs,
          isFinalGesture,
        }),
        kind,
      }
    }
    if (kind === 'resize-left') {
      const proposedTimestamp = rawEdgeX <= gesture.visualMinLeft
        ? bounds.previousEnd + props.snapMs
        : rawEdgeX >= gesture.visualMaxRight - MINIMUM_ITEM_WIDTH
          ? constraintItem.endedAt - props.minimumDurationMs
          : rawProposedTimestamp
      gesture.lastProposal = proposedTimestamp
      return {
        id: item.id,
        ...constrainResizeLeft({
          item: constraintItem,
          proposedStartedAt: proposedTimestamp,
          previousEnd: bounds.previousEnd,
          neighbourGapMs: props.snapMs,
          minimumDurationMs: props.minimumDurationMs,
          snapMs: props.snapMs,
          isFinalGesture,
        }),
        kind,
      }
    }
    const proposedTimestamp = rawEdgeX >= gesture.visualMaxRight
      ? bounds.nextStart - props.snapMs
      : rawEdgeX <= base.x + MINIMUM_ITEM_WIDTH
        ? constraintItem.startedAt + props.minimumDurationMs
        : rawProposedTimestamp
    gesture.lastProposal = proposedTimestamp
    return {
      id: item.id,
      ...constrainResizeRight({
        item: constraintItem,
        proposedEndedAt: proposedTimestamp,
        nextStart: gesture.rightResizeLimit,
        now: props.now,
        neighbourGapMs: props.snapMs,
        minimumDurationMs: props.minimumDurationMs,
        snapMs: props.snapMs,
        isFinalGesture,
      }),
      kind,
    }
  }

  function finalProposal() {
    if (!gesture) return null
    const { item, constraintItem, kind, bounds, lastProposal } = gesture
    if (kind === 'move') {
      return {
        id: item.id,
        ...constrainMove({
          item: constraintItem,
          proposedStartedAt: lastProposal,
          previousEnd: bounds.previousEnd,
          nextStart: bounds.nextStart,
          neighbourGapMs: props.snapMs,
          snapMs: props.snapMs,
          isFinalGesture: true,
        }),
        kind,
      }
    }
    if (kind === 'resize-left') {
      return {
        id: item.id,
        ...constrainResizeLeft({
          item: constraintItem,
          proposedStartedAt: lastProposal,
          previousEnd: bounds.previousEnd,
          neighbourGapMs: props.snapMs,
          minimumDurationMs: props.minimumDurationMs,
          snapMs: props.snapMs,
          isFinalGesture: true,
        }),
        kind,
      }
    }
    return {
      id: item.id,
      ...constrainResizeRight({
        item: constraintItem,
        proposedEndedAt: lastProposal,
        nextStart: gesture.rightResizeLimit,
        now: props.now,
        neighbourGapMs: props.snapMs,
        minimumDurationMs: props.minimumDurationMs,
        snapMs: props.snapMs,
        isFinalGesture: true,
      }),
      kind,
    }
  }


  function clearGesture({ notify = false, preserveGeometry = false } = {}) {
    if (!gesture) return
    const currentGesture = gesture
    const { element, pointerId, item } = currentGesture
    if (currentGesture.moved) {
      // A completed or cancelled direct-manipulation gesture can still produce
      // a browser click on pointerup. It must never count toward double-click.
      suppressClickUntil = Date.now() + 120
      lastItemClick = { id: null, at: Number.NEGATIVE_INFINITY }
      handledClickPair = { id: null, at: Number.NEGATIVE_INFINITY }
    }
    if (element.hasPointerCapture?.(pointerId)) element.releasePointerCapture(pointerId)
    delete element.dataset.dragging
    if (!preserveGeometry) restoreGeometry(currentGesture.baseGeometry)
    gesture = null
    previewEdit = null

    renderConnectors()
    renderDetails()
    renderDetailsPointer()
    if (notify) props.onEditCancel?.(item)
  }

  function authoritativeAccepts(edit, items) {
    const item = items.find((candidate) => candidate.id === edit.id)
    if (!item || item.isPending === true || item.startedAt !== edit.startedAt) return false
    return isRunning(item) ? item.endedAt == null : item.endedAt === edit.endedAt
  }

  function setCachedGeometry(element, geometry) {
    geometryCache.set(element.dataset.itemId, geometry)
    element.style.left = `${geometry.x}px`
    element.style.width = `${geometry.width}px`
  }

  function commitEdit(edit, item) {
    if (!edit || sameEdit(edit, item)) {
      committedPreview = null
      geometryCache = null
      render()
      return
    }
    committedPreview = edit
    renderConnectors()
    renderDetails()
    renderDetailsPointer()
    if (!geometryCache) render()
    let result
    try {
      result = props.onEditCommit?.({ ...edit })
    } catch (error) {
      committedPreview = null
      geometryCache = null
      render()
      props.onEditCancel?.(item)
      throw error
    }
    if (result && typeof result.then === 'function') {
      result.catch(() => {
        if (destroyed) return
        committedPreview = null
        geometryCache = null
        render()
        props.onEditCancel?.(item)
      })
    }
  }

  function renderTrack(items, rows, blocks) {
    track.replaceChildren()

    rows.forEach((row, index) => {
      const rowElement = createElement('div', 'elastic-timeline__row', {
        'data-row-id': row.id,
      })
      rowElement.style.top = `${index * ROW_HEIGHT}px`
      if (row.title) {
        const label = createElement('span', 'elastic-timeline__row-label', {
          'data-testid': 'timeline-row-label',
        })
        label.textContent = row.title
        rowElement.append(label)
      }
      track.append(rowElement)
    })

    for (const block of blocks) {
      const authoritative = props.items.find((item) => item.id === block.id) ?? block
      const cachedGeometry = geometryCache?.get(block.id)
      const itemElement = createElement('div', 'elastic-timeline__item', {
        tabindex: '0',
        role: 'button',
        'aria-label': itemAccessibleName(authoritative),
        'aria-disabled': canResizeLeft(authoritative) ? 'false' : 'true',
        'data-testid': 'timeline-item',
        'data-item-id': block.id,
        'data-row-id': block.rowId,
      })
      itemElement.style.left = `${cachedGeometry?.x ?? block.x}px`
      itemElement.style.top = `${block.row * ROW_HEIGHT + ROW_ITEM_TOP}px`
      itemElement.style.width = `${Math.max(MINIMUM_ITEM_WIDTH, cachedGeometry?.width ?? block.width)}px`
      itemElement.style.setProperty('--item-color', resolveColor(authoritative))
      itemElement.dataset.selected = String(block.id === selectedId)
      itemElement.dataset.running = String(authoritative.endedAt == null || authoritative.isRunning === true)
      itemElement.dataset.pending = String(authoritative.isPending === true)

      const label = createElement('span', 'elastic-timeline__item-label')
      label.textContent = authoritative.title
      itemElement.append(label)

      if (canResizeLeft(authoritative)) {
        const leftHandle = createElement('button', 'elastic-timeline__handle elastic-timeline__handle--left', {
          type: 'button',
          tabindex: '-1',
          'aria-label': `Resize start: ${authoritative.title}`,
          'data-testid': 'resize-left',
        })
        leftHandle.addEventListener('pointerdown', (event) => {
          event.stopPropagation()
          pointerDown(event, authoritative, 'resize-left', itemElement)
        }, { signal })
        itemElement.append(leftHandle)
      }
      if (canResizeRight(authoritative)) {
        const rightHandle = createElement('button', 'elastic-timeline__handle elastic-timeline__handle--right', {
          type: 'button',
          tabindex: '-1',
          'aria-label': `Resize end: ${authoritative.title}`,
          'data-testid': 'resize-right',
        })
        rightHandle.addEventListener('pointerdown', (event) => {
          event.stopPropagation()
          pointerDown(event, authoritative, 'resize-right', itemElement)
        }, { signal })
        itemElement.append(rightHandle)
      }

      itemElement.addEventListener('pointerdown', (event) => {
        if (event.target.closest('.elastic-timeline__handle')) return
        pointerDown(event, authoritative, 'move', itemElement)
      }, { signal })
      itemElement.addEventListener('click', (event) => {
        if (Date.now() < suppressClickUntil || event.target.closest('.elastic-timeline__handle')) return
        const isSecondClick = lastItemClick.id === authoritative.id && event.timeStamp - lastItemClick.at <= 500
        lastItemClick = isSecondClick
          ? { id: null, at: Number.NEGATIVE_INFINITY }
          : { id: authoritative.id, at: event.timeStamp }
        select(authoritative)
        if (isSecondClick) {
          handledClickPair = { id: authoritative.id, at: event.timeStamp }
          if (isRunning(authoritative)) void requestStop(authoritative).catch(() => {})
          else void requestStart(authoritative).catch(() => {})
        }
      }, { signal })
      itemElement.addEventListener('pointerenter', () => {
        hoveredId = authoritative.id
        renderDetails()
        renderDetailsPointer()
      }, { signal })
      itemElement.addEventListener('focus', () => {
        hoveredId = authoritative.id
        renderDetails()
        renderDetailsPointer()
      }, { signal })
      itemElement.addEventListener('dblclick', (event) => {
        event.preventDefault()
        const alreadyHandled = handledClickPair.id === authoritative.id
          && Math.abs(event.timeStamp - handledClickPair.at) <= 100
        handledClickPair = { id: null, at: Number.NEGATIVE_INFINITY }
        // A dblclick aimed at a resize edge has no item click pair because the
        // handle consumes pointerdown. Treat it as the same block action.
        if (!alreadyHandled) {
          if (isRunning(authoritative)) void requestStop(authoritative).catch(() => {})
          else void requestStart(authoritative).catch(() => {})
        }
      }, { signal })
      itemElement.addEventListener('keydown', (event) => itemKeyDown(event, authoritative), { signal })
      track.append(itemElement)
    }

    renderConnectors(items)

  }

  function render() {
    if (destroyed) return
    const viewportWidth = Math.max(1, viewport.clientWidth || container.clientWidth || 320)
    const needsRightScrollGutter = view.end === props.now && view.end - view.start > 48 * HOUR_MS
      && props.items.some((item) => isRunning(item) && item.startedAt <= view.end)
    renderedContainerWidth = container.clientWidth
    if (scaleDirty || !scale) {
      scale = createElasticScale({
        viewStart: view.start,
        viewEnd: view.end,
        items: props.items,
        // Keep a running item at "now" reachable by real horizontal scroll even
        // when an elastic multi-day view would otherwise fill the viewport exactly.
        viewportWidth: viewportWidth + (needsRightScrollGutter ? MINIMUM_ITEM_WIDTH : 0),
      })
      scaleDirty = false
    }
    const items = effectiveItems()
    const rows = timelineRows()
    const blocks = layoutTimelineItems({ items, rows, scale, now: props.now })
    const contentWidth = Math.max(scale.width, ...blocks.map((block) => block.endX))
    canvas.style.width = `${contentWidth}px`
    canvas.style.height = `${HEADER_HEIGHT + rows.length * ROW_HEIGHT}px`
    track.style.height = `${rows.length * ROW_HEIGHT}px`
    canvas.dataset.viewStart = String(view.start)
    canvas.dataset.viewEnd = String(view.end)
    renderDayBoundaries()
    renderHeader()
    renderTrack(items, rows, blocks)
    renderDetails()
    renderDetailsPointer()
    summaryStart.dateTime = new Date(view.start).toISOString()
    summaryStart.textContent = formatDateTime(view.start)
    summaryEnd.dateTime = new Date(view.end).toISOString()
    summaryEnd.textContent = formatDateTime(view.end)
    summaryTotal.textContent = `Tracked: ${formatDuration(calculateTrackedDuration({
      items: props.items,
      viewStart: view.start,
      viewEnd: view.end,
      now: props.now,
    }))}`
    renderSummaryAction()
  }

  function itemKeyDown(event, item) {
    if (['Delete', 'Backspace'].includes(event.key) && selectedId === item.id) {
      event.preventDefault()
      event.stopPropagation()
      void requestDelete(item).catch(() => {})
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      select(item)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      if (gesture) clearGesture({ notify: true })
      else {
        selectedId = null
        render()
      }
      return
    }
    if (!event.altKey || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return
    const requestedKind = event.ctrlKey ? 'resize-left' : event.shiftKey ? 'resize-right' : 'move'
    const permitted = requestedKind === 'move'
      ? canMove(item)
      : requestedKind === 'resize-left'
        ? canResizeLeft(item)
        : canResizeRight(item)
    if (!permitted) return
    event.preventDefault()
    event.stopPropagation()
    const direction = event.key === 'ArrowLeft' ? -1 : 1
    const { constraintItem, bounds } = gestureConstraintContext(item)
    let edit
    if (event.ctrlKey) {
      edit = {
        id: item.id,
        ...constrainResizeLeft({
          item: constraintItem,
          proposedStartedAt: constraintItem.startedAt + direction * props.snapMs,
          previousEnd: bounds.previousEnd,
          minimumDurationMs: props.minimumDurationMs,
          snapMs: props.snapMs,
          isFinalGesture: true,
        }),
        kind: 'resize-left',
      }
    } else if (event.shiftKey) {
      edit = {
        id: item.id,
        ...constrainResizeRight({
          item: constraintItem,
          proposedEndedAt: constraintItem.endedAt + direction * props.snapMs,
          nextStart: bounds.nextStart,
          now: props.now,
          minimumDurationMs: props.minimumDurationMs,
          snapMs: props.snapMs,
          isFinalGesture: true,
        }),
        kind: 'resize-right',
      }
    } else {
      edit = {
        id: item.id,
        ...constrainMove({
          item: constraintItem,
          proposedStartedAt: constraintItem.startedAt + direction * props.snapMs,
          previousEnd: bounds.previousEnd,
          nextStart: bounds.nextStart,
          snapMs: props.snapMs,
          isFinalGesture: true,
        }),
        kind: 'move',
      }
    }
    commitEdit(edit, item)
  }

  viewport.addEventListener('wheel', (event) => {
    const span = view.end - view.start
    const zoomGesture = event.altKey || event.ctrlKey || event.metaKey
    if (zoomGesture) {
      event.preventDefault()
      const rect = viewport.getBoundingClientRect()
      const displayX = Math.min(scale.width, Math.max(0, event.clientX - rect.left + viewport.scrollLeft))
      const factor = event.deltaY > 0 ? 1.04 : 1 / 1.04
      zoom(factor, scale.toTime(displayX))
      return
    }
    if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
      event.preventDefault()
      const pixels = event.shiftKey && event.deltaX === 0 ? event.deltaY : event.deltaX
      if (scrollElasticOverflow(pixels)) return
      pan((pixels / Math.max(1, viewport.clientWidth)) * span)
    }
  }, { signal, passive: false })

  viewport.addEventListener('scroll', updateHeaderLabelVisibility, { signal, passive: true })

  viewport.addEventListener('keydown', (event) => {
    if (event.target !== viewport) return
    if (event.key === '+' || event.key === '=') {
      event.preventDefault()
      zoom(0.5)
      return
    }
    if (event.key === '-' || event.key === '_') {
      event.preventDefault()
      zoom(2)
      return
    }
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return
    event.preventDefault()
    const direction = event.key === 'ArrowLeft' ? -1 : 1
    const span = view.end - view.start
    const step = event.altKey ? span * 0.2 : span <= 48 * HOUR_MS ? HOUR_MS : DAY_MS
    pan(direction * step)
  }, { signal })

  viewport.addEventListener('pointermove', (event) => {
    if (!gesture || event.pointerId !== gesture.pointerId) return
    if (!gesture.moved && Math.abs(event.clientX - gesture.originClientX) < 3) return
    gesture.moved = true
    event.preventDefault()
    try {
      previewEdit = proposalForGesture(event)
    } catch {
      return
    }
    applyGestureGeometry(previewEdit)
    renderConnectors()
    renderDetails()
    renderDetailsPointer()
    emitGestureDebug('preview', {
      rawTimestamp: scale.toTime(clamp(event.clientX - viewport.getBoundingClientRect().left, 0, scale.width)),
      proposedTimestamp: gesture.lastProposal,
      edit: previewEdit,
    })

    props.onEditPreview?.({ ...previewEdit })
  }, { signal })

  viewport.addEventListener('pointerup', (event) => {
    if (!gesture || event.pointerId !== gesture.pointerId) return
    const currentGesture = gesture
    const moved = gesture.moved
    let edit = null
    if (moved) {
      try { edit = finalProposal() } catch { edit = null }
      suppressClickUntil = Date.now() + 120
    }
    if (edit) {
      applyGestureGeometry(edit)
      geometryCache = snapshotGeometry()
    }
    if (moved) emitGestureDebug('finish', {
      rawTimestamp: scale.toTime(clamp(event.clientX - viewport.getBoundingClientRect().left, 0, scale.width)),
      proposedTimestamp: currentGesture.lastProposal,
      edit,
      committed: Boolean(edit) && !sameEdit(edit, currentGesture.item),
    })
    clearGesture({ preserveGeometry: Boolean(edit) })
    if (moved && edit) commitEdit(edit, currentGesture.item)
    renderDetails()
    renderDetailsPointer()
  }, { signal })

  viewport.addEventListener('pointercancel', () => clearGesture({ notify: true }), { signal })
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && gesture) {
      event.preventDefault()
      clearGesture({ notify: true })
    }
  }, { signal })

  const resizeObserver = new ResizeObserver(() => {
    if (applyingAuthoritativeUpdate) return
    if (container.clientWidth === renderedContainerWidth) return
    scaleDirty = true
    cancelAnimationFrame(resizeFrame)
    resizeFrame = requestAnimationFrame(render)
  })
  resizeObserver.observe(container)

  let connectorRepairQueued = false
  const connectorObserver = new MutationObserver(() => {
    if (destroyed || connectorRepairQueued) return
    connectorRepairQueued = true
    queueMicrotask(() => {
      connectorRepairQueued = false
      if (!destroyed) renderConnectors()
    })
  })
  connectorObserver.observe(track, { childList: true })

  render()
  const detailsClockTimer = setInterval(updateRunningDetailsClock, 1000)
  detailsClockTimer.unref?.()

  return {
    update(nextProps = {}) {
      if (destroyed) return
      applyingAuthoritativeUpdate = true
      const hadNow = props.now
      const previousRunningIds = new Set(props.items.filter(isRunning).map((item) => item.id))
      const pendingEdit = committedPreview
      const hasAuthoritativeItems = Object.hasOwn(nextProps, 'items')
      props = { ...props, ...nextProps }
      if (!Number.isFinite(props.now)) throw new TypeError('props.now must be a finite timestamp')
      if (hasAuthoritativeItems) {
        if (pendingEdit) {
          if (authoritativeAccepts(pendingEdit, props.items)) committedPreview = null
        } else {
          scaleDirty = true
          geometryCache = null
        }
      }
      previewEdit = null
      if (nextProps.view) {
        scaleDirty = true
        geometryCache = null
        view = normalizeTimelineView({ view: nextProps.view, ...viewOptions() })
      } else if (props.now !== hadNow) {
        scaleDirty = true
        geometryCache = null
        view = normalizeTimelineView({ view, ...viewOptions() })
      }
      if (selectedId && !props.items.some((item) => item.id === selectedId)) selectedId = null
      render()
      if (props.items.some((item) => isRunning(item) && !previousRunningIds.has(item.id))) {
        viewport.scrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth)
        updateHeaderLabelVisibility()
      }
      queueMicrotask(() => { applyingAuthoritativeUpdate = false })
    },
    destroy() {
      if (destroyed) return
      clearGesture()
      destroyed = true
      resizeObserver.disconnect()
      connectorObserver.disconnect()
      cancelAnimationFrame(resizeFrame)
      cancelAnimationFrame(summaryPositionFrame)
      clearInterval(detailsClockTimer)
      abortController.abort()
      container.replaceChildren()
    },
    getView() {
      return { ...view }
    },
    scrollToEnd() {
      if (destroyed) return
      viewport.scrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth)
      updateHeaderLabelVisibility()
    },
  }
}
