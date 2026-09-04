export const MINIMUM_ITEM_WIDTH = 30
export const MINIMUM_ITEM_GAP = 5
export const MINIMUM_ITEM_MOBILITY_GAP = 20

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const EMPTY_CELL_MIN_WIDTH = 2
const EMPTY_HOUR_RANGE_MAX_CELLS = 6
const EMPTY_HOUR_LABEL_MIN_WIDTH = 54
const SINGLE_HOUR_LABEL_MIN_WIDTH = 27

function nextLocalBoundary(timestamp, kind) {
  const date = new Date(timestamp)
  if (kind === 'hour') {
    date.setMinutes(0, 0, 0)
    date.setHours(date.getHours() + 1)
  } else {
    date.setHours(0, 0, 0, 0)
    date.setDate(date.getDate() + 1)
  }
  return date.getTime()
}

function makeCells(viewStart, viewEnd, kind) {
  const cells = []
  let start = viewStart
  while (start < viewEnd) {
    const boundary = nextLocalBoundary(start, kind)
    const end = Math.min(viewEnd, Math.max(start + 1, boundary))
    cells.push({ kind, start, end })
    start = end
  }
  return cells
}

function itemVisualEnd(item, viewEnd) {
  return item.endedAt == null ? viewEnd : item.endedAt
}

function cellStats(cell, items, viewStart, viewEnd) {
  const intervals = []
  for (const item of items) {
    const start = Math.max(viewStart, item.startedAt)
    const end = Math.min(viewEnd, itemVisualEnd(item, viewEnd))
    if (end <= cell.start || start >= cell.end) continue
    intervals.push({
      id: String(item.id),
      rowId: String(item.rowId ?? '__default'),
      start: Math.max(cell.start, start),
      end: Math.min(cell.end, end),
    })
  }
  intervals.sort((left, right) => left.start - right.start || left.end - right.end || left.id.localeCompare(right.id))
  const chains = []
  for (let index = 0; index < intervals.length; index += 1) {
    const interval = intervals[index]
    let count = 1
    let occupiedDuration = interval.end - interval.start
    for (let previous = 0; previous < index; previous += 1) {
      const before = intervals[previous]
      if (before.end > interval.start) continue
      const candidateCount = chains[previous].count + 1
      const candidateDuration = chains[previous].occupiedDuration + interval.end - interval.start
      if (candidateCount > count || (candidateCount === count && candidateDuration > occupiedDuration)) {
        count = candidateCount
        occupiedDuration = candidateDuration
      }
    }
    chains.push({ count, occupiedDuration })
  }
  const count = chains.reduce((maximum, chain) => Math.max(maximum, chain.count), 0)
  const occupiedDuration = chains.reduce((maximum, chain) => Math.max(maximum, chain.occupiedDuration), 0)
  const footprint = count > 0
    ? count * (MINIMUM_ITEM_WIDTH + MINIMUM_ITEM_GAP)
      + Math.max(0, count - 1) * MINIMUM_ITEM_MOBILITY_GAP
    : EMPTY_CELL_MIN_WIDTH
  return { count, occupiedDuration, footprint }
}

function allocateWidths(cells, viewportWidth) {
  const minimumTotal = cells.reduce((total, cell) => total + cell.minimumWidth, 0)
  const width = Math.max(viewportWidth, minimumTotal)
  let extra = width - minimumTotal
  if (extra <= 0) return { width, widths: cells.map((cell) => cell.minimumWidth) }

  const weights = cells.map((cell) => {
    const durationWeight = (cell.end - cell.start) / Math.max(1, cell.nominalDuration)
    if (cell.count === 0) return Math.max(0.05, durationWeight)
    const occupancy = Math.min(1, cell.occupiedDuration / Math.max(1, cell.end - cell.start))
    return Math.max(0.1, durationWeight) * (2 + Math.min(4, cell.count - 1) + occupancy)
  })
  const totalWeight = weights.reduce((total, weight) => total + weight, 0)
  const widths = cells.map((cell, index) => cell.minimumWidth + extra * (weights[index] / totalWeight))

  // Keep floating-point accumulation from moving the exact right edge.
  const allocated = widths.reduce((total, cellWidth) => total + cellWidth, 0)
  widths[widths.length - 1] += width - allocated
  return { width, widths }
}

function reserveHourLabelWidths(cells) {
  for (let index = 0; index < cells.length;) {
    if (cells[index].count > 0) {
      cells[index].minimumWidth = Math.max(cells[index].minimumWidth, SINGLE_HOUR_LABEL_MIN_WIDTH)
      index += 1
      continue
    }
    const run = []
    while (index < cells.length && cells[index].count === 0 && run.length < EMPTY_HOUR_RANGE_MAX_CELLS) {
      run.push(cells[index])
      index += 1
    }
    const required = run.length === 1 ? SINGLE_HOUR_LABEL_MIN_WIDTH : EMPTY_HOUR_LABEL_MIN_WIDTH
    const current = run.reduce((total, cell) => total + cell.minimumWidth, 0)
    const addition = Math.max(0, required - current) / run.length
    run.forEach((cell) => { cell.minimumWidth += addition })
  }
}

export function createElasticScale({ viewStart, viewEnd, items = [], viewportWidth }) {
  if (!Number.isFinite(viewStart) || !Number.isFinite(viewEnd) || viewEnd <= viewStart) {
    throw new RangeError('viewEnd must be greater than viewStart')
  }
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) {
    throw new RangeError('viewportWidth must be greater than zero')
  }

  const kind = viewEnd - viewStart <= 48 * HOUR_MS ? 'hour' : 'day'
  const nominalDuration = kind === 'hour' ? HOUR_MS : DAY_MS
  const rawCells = makeCells(viewStart, viewEnd, kind).map((cell) => {
    const stats = cellStats(cell, items, viewStart, viewEnd)
    return { ...cell, ...stats, nominalDuration, minimumWidth: stats.footprint }
  })
  if (kind === 'hour') reserveHourLabelWidths(rawCells)
  const allocation = allocateWidths(rawCells, viewportWidth)
  let x = 0
  const cells = rawCells.map((cell, index) => {
    const width = allocation.widths[index]
    const result = { ...cell, x, width, endX: x + width }
    x += width
    return result
  })

  function cellForTime(timestamp) {
    if (timestamp <= viewStart) return cells[0]
    if (timestamp >= viewEnd) return cells[cells.length - 1]
    let low = 0
    let high = cells.length - 1
    while (low <= high) {
      const middle = (low + high) >> 1
      const cell = cells[middle]
      if (timestamp < cell.start) high = middle - 1
      else if (timestamp >= cell.end) low = middle + 1
      else return cell
    }
    return cells[Math.min(cells.length - 1, low)]
  }

  function cellForX(displayX) {
    if (displayX <= 0) return cells[0]
    if (displayX >= allocation.width) return cells[cells.length - 1]
    let low = 0
    let high = cells.length - 1
    while (low <= high) {
      const middle = (low + high) >> 1
      const cell = cells[middle]
      if (displayX < cell.x) high = middle - 1
      else if (displayX >= cell.endX) low = middle + 1
      else return cell
    }
    return cells[Math.min(cells.length - 1, low)]
  }

  function toX(timestamp) {
    if (timestamp <= viewStart) return 0
    if (timestamp >= viewEnd) return allocation.width
    const cell = cellForTime(timestamp)
    return cell.x + ((timestamp - cell.start) / (cell.end - cell.start)) * cell.width
  }

  function toTime(displayX) {
    if (displayX <= 0) return viewStart
    if (displayX >= allocation.width) return viewEnd
    const cell = cellForX(displayX)
    return cell.start + ((displayX - cell.x) / cell.width) * (cell.end - cell.start)
  }

  return {
    viewStart,
    viewEnd,
    width: allocation.width,
    cells,
    toX,
    toTime,
  }
}
