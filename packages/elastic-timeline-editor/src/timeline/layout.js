import { MINIMUM_ITEM_GAP, MINIMUM_ITEM_WIDTH } from './scale.js'

export const DEFAULT_ROW_ID = '__default'

export const COLOR_PALETTE = Object.freeze([
  '#e76f51', '#2a9d8f', '#e9c46a', '#8ab17d', '#f4a261',
  '#6d9dc5', '#c77dff', '#ff7096', '#43aa8b', '#f8961e',
  '#90be6d', '#577590', '#f94144', '#00b4d8', '#b8a1cf',
  '#ffbe0b', '#70d6ff', '#b56576', '#84a59d', '#ff9770',
])

function compareTimelineItems(a, b) {
  const aEnd = a.endedAt == null ? Number.POSITIVE_INFINITY : a.endedAt
  const bEnd = b.endedAt == null ? Number.POSITIVE_INFINITY : b.endedAt
  return a.startedAt - b.startedAt || aEnd - bEnd || String(a.id).localeCompare(String(b.id))
}

export function sortTimelineItems(items) {
  return items.slice().sort(compareTimelineItems)
}

export function itemRowId(item) {
  return item.rowId ?? DEFAULT_ROW_ID
}

export function resolveTimelineRows(items, rows = []) {
  const resolved = []
  const seen = new Set()
  for (const row of rows) {
    const id = String(row.id)
    if (seen.has(id)) continue
    seen.add(id)
    resolved.push({ id, title: row.title ?? '' })
  }
  for (const item of items) {
    const id = String(itemRowId(item))
    if (seen.has(id)) continue
    seen.add(id)
    resolved.push({ id, title: '' })
  }
  if (resolved.length === 0) resolved.push({ id: DEFAULT_ROW_ID, title: '' })
  return resolved
}

export function calculateTrackedDuration({ items, viewStart, viewEnd, now }) {
  return items.reduce((total, item) => {
    const end = item.endedAt == null ? now : item.endedAt
    return total + Math.max(0, Math.min(viewEnd, end) - Math.max(viewStart, item.startedAt))
  }, 0)
}

export function findAdjacentItemConnections(items, gapMs = 1_000) {
  const rows = new Map()
  for (const item of items) {
    const rowId = String(itemRowId(item))
    const row = rows.get(rowId) ?? []
    row.push(item)
    rows.set(rowId, row)
  }
  const connections = []
  for (const [rowId, rowItems] of rows) {
    const sorted = sortTimelineItems(rowItems)
    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1]
      const current = sorted[index]
      const gap = previous.endedAt == null ? null : current.startedAt - previous.endedAt
      if (gap === 0 || gap === gapMs) {
        connections.push({ fromId: previous.id, toId: current.id, rowId })
      }
    }
  }
  return connections
}

function stableColorHash(value) {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export function createColorResolver(palette = COLOR_PALETTE) {
  if (!Array.isArray(palette) || palette.length === 0) throw new TypeError('palette must not be empty')

  return function resolveColor(item) {
    // A task's URL is its durable visual identity. Rendering order, title, and
    // activity timestamps must never influence its color.
    const identity = String(item.url || item.id || '')
    return palette[stableColorHash(identity) % palette.length]
  }
}

function visibleTimelineItems(items, scale, now) {
  return sortTimelineItems(items).filter((item) => {
    const running = item.endedAt == null || item.isRunning === true
    const visualEnd = item.endedAt == null ? now : item.endedAt
    const startsInsideView = item.startedAt < scale.viewEnd
      || (running && item.startedAt === scale.viewEnd && now === scale.viewEnd)
    return visualEnd > scale.viewStart && startsInsideView
  })
}

function globallyPositionBlocks(blocks, scale, gap) {
  const ordered = sortTimelineItems(blocks)
  const predecessors = ordered.map(() => [])
  const successors = ordered.map(() => [])
  for (let current = 0; current < ordered.length; current += 1) {
    for (let previous = 0; previous < current; previous += 1) {
      const before = ordered[previous]
      const after = ordered[current]
      if (before.visualEndedAt > after.startedAt) continue
      predecessors[current].push(previous)
      successors[previous].push(current)
    }
  }

  const latest = ordered.map(block => scale.width - block.width)
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    for (const successor of successors[index]) {
      latest[index] = Math.min(latest[index], latest[successor] - gap - ordered[index].width)
    }
  }

  ordered.forEach((block, index) => {
    const required = predecessors[index].reduce(
      (left, predecessor) => Math.max(left, ordered[predecessor].endX + gap),
      0,
    )
    block.x = Math.max(required, Math.min(block.desiredX, latest[index]))
    block.endX = block.x + block.width
    delete block.desiredX
  })
  return ordered
}

function createBlocks({ items, rows, scale, now, minimumWidth }) {
  const rowIndexes = new Map(rows.map((row, index) => [row.id, index]))
  return visibleTimelineItems(items, scale, now).map((item) => {
    const visualEndedAt = item.endedAt == null ? now : item.endedAt
    const clampedStart = Math.max(scale.viewStart, Math.min(scale.viewEnd, item.startedAt))
    const clampedEnd = Math.max(clampedStart, Math.min(scale.viewEnd, visualEndedAt))
    const desiredX = scale.toX(clampedStart)
    const cell = scale.cells.find((candidate) => clampedStart >= candidate.start && clampedStart < candidate.end)
      ?? scale.cells.at(-1)
    const width = Math.max(minimumWidth, scale.toX(clampedEnd) - desiredX)
    const rowId = String(itemRowId(item))
    return {
      ...item,
      row: rowIndexes.get(rowId) ?? 0,
      rowId,
      desiredX,
      cellStartX: cell.x,
      cellEndX: cell.endX,
      x: desiredX,
      width,
      endX: desiredX + width,
      visualEndedAt,
    }
  })
}

export function layoutTimelineItems({
  items,
  rows,
  scale,
  now,
  minimumWidth = MINIMUM_ITEM_WIDTH,
  gap = MINIMUM_ITEM_GAP,
}) {
  const resolvedRows = resolveTimelineRows(items, rows)
  const positioned = globallyPositionBlocks(
    createBlocks({ items, rows: resolvedRows, scale, now, minimumWidth }),
    scale,
    gap,
  )
  return resolvedRows.flatMap((row) => positioned.filter(block => block.rowId === row.id))
}
