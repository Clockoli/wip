export type TimestampMs = number
export type TimelineEditKind = 'move' | 'resize-left' | 'resize-right'

export interface TimelineItem {
  id: string
  startedAt: TimestampMs
  endedAt: TimestampMs | null
  title: string
  url?: string
  color?: string
  rowId?: string
  isRunning?: boolean
  isEditable?: boolean
  isPending?: boolean
  isStartDisabled?: boolean
  isStopDisabled?: boolean
  isDeleteDisabled?: boolean
}

export interface TimelineRow {
  id: string
  title?: string
}

export interface TimelineView {
  start: TimestampMs
  end: TimestampMs
  focusedAt: TimestampMs
}

export interface TimelineEdit {
  id: string
  startedAt: TimestampMs
  endedAt: TimestampMs
  kind: TimelineEditKind
}

export interface TimelineEditDebug {
  phase: 'start' | 'preview' | 'finish'
  id: string
  kind: TimelineEditKind
  bounds: { previousEnd: TimestampMs | null; nextStart: TimestampMs | null }
  snapMs: number
  rawTimestamp?: TimestampMs
  proposedTimestamp?: TimestampMs
  edit: Pick<TimelineEdit, 'startedAt' | 'endedAt'> | null
  committed?: boolean
}

export interface ElasticTimelineProps {
  items: TimelineItem[]
  now: TimestampMs
  rows?: TimelineRow[]
  view?: TimelineView
  minViewSpanMs?: number
  maxViewSpanMs?: number
  defaultViewSpanMs?: number
  snapMs?: number
  minimumDurationMs?: number
  onViewChange?(view: TimelineView): void
  onSelect?(item: TimelineItem): void
  onStart?(item: TimelineItem): void | Promise<void>
  onStop?(item: TimelineItem): void | Promise<void>
  onDelete?(item: TimelineItem): void | Promise<void>
  summaryActionLabel?: string
  isSummaryActionDisabled?: boolean
  onSummaryAction?(): void | Promise<void>
  onEditPreview?(edit: TimelineEdit): void
  onEditCommit?(edit: TimelineEdit): void | Promise<void>
  onEditCancel?(item: TimelineItem): void
  onEditDebug?(detail: TimelineEditDebug): void
}

export interface ElasticTimelineInstance {
  update(props?: Partial<ElasticTimelineProps>): void
  destroy(): void
  getView(): TimelineView
  scrollToEnd(): void
}

export interface ElasticScaleCell {
  kind: 'hour' | 'day'
  start: TimestampMs
  end: TimestampMs
  x: number
  width: number
  endX: number
  count: number
  occupiedDuration: number
  footprint: number
  minimumWidth: number
  nominalDuration: number
}

export interface ElasticScale {
  viewStart: TimestampMs
  viewEnd: TimestampMs
  width: number
  cells: ElasticScaleCell[]
  toX(timestamp: TimestampMs): number
  toTime(displayX: number): TimestampMs
}

export interface TimelineLayoutBlock extends TimelineItem {
  row: number
  rowId: string
  x: number
  width: number
  endX: number
  visualEndedAt: TimestampMs
}

export interface TimelineConnection {
  fromId: string
  toId: string
  rowId: string
}

export const MINIMUM_ITEM_WIDTH: 30
export const MINIMUM_ITEM_GAP: 4
export const DEFAULT_MINIMUM_DURATION_MS: 60000
export const DEFAULT_SNAP_MS: 60000
export const HOUR_MS: number
export const DAY_MS: number

export function createElasticTimeline(
  container: Element,
  props: ElasticTimelineProps,
): ElasticTimelineInstance

export function createElasticScale(options: {
  viewStart: TimestampMs
  viewEnd: TimestampMs
  items?: TimelineItem[]
  viewportWidth: number
}): ElasticScale

export function layoutTimelineItems(options: {
  items: TimelineItem[]
  rows?: TimelineRow[]
  scale: ElasticScale
  now: TimestampMs
  minimumWidth?: number
  gap?: number
}): TimelineLayoutBlock[]

export function resolveTimelineRows(items: TimelineItem[], rows?: TimelineRow[]): TimelineRow[]
export function sortTimelineItems(items: TimelineItem[]): TimelineItem[]
export function sortCompletedItems(items: TimelineItem[]): Array<TimelineItem & { endedAt: number }>
export function calculateTrackedDuration(options: {
  items: TimelineItem[]
  viewStart: TimestampMs
  viewEnd: TimestampMs
  now: TimestampMs
}): number
export function findAdjacentItemConnections(items: TimelineItem[], gapMs?: number): TimelineConnection[]
export function createColorResolver(palette?: readonly string[]): (item: TimelineItem) => string

export function snapTimestamp(timestamp: TimestampMs, snapMs?: number): TimestampMs
export function getCompletedNeighbourBounds(
  items: TimelineItem[],
  targetId: string,
  bounds: { earliestAllowed: TimestampMs; now: TimestampMs },
): {
  previous: TimelineItem | null
  next: TimelineItem | null
  previousEnd: TimestampMs
  nextStart: TimestampMs
}
export function constrainMove(options: {
  item: TimelineItem & { endedAt: number }
  proposedStartedAt: TimestampMs
  previousEnd: TimestampMs
  nextStart: TimestampMs
  snapMs?: number
  isFinalGesture?: boolean
}): { startedAt: TimestampMs; endedAt: TimestampMs }
export function constrainResizeLeft(options: {
  item: TimelineItem & { endedAt: number }
  proposedStartedAt: TimestampMs
  previousEnd: TimestampMs
  minimumDurationMs?: number
  snapMs?: number
  isFinalGesture?: boolean
}): { startedAt: TimestampMs; endedAt: TimestampMs }
export function constrainResizeRight(options: {
  item: TimelineItem & { endedAt: number }
  proposedEndedAt: TimestampMs
  nextStart: TimestampMs
  now: TimestampMs
  minimumDurationMs?: number
  snapMs?: number
  isFinalGesture?: boolean
}): { startedAt: TimestampMs; endedAt: TimestampMs }

export function createInitialView(options: {
  now: TimestampMs
  defaultViewSpanMs?: number
  minViewSpanMs?: number
  maxViewSpanMs?: number
}): TimelineView
export function normalizeTimelineView(options: {
  view: TimelineView
  now: TimestampMs
  minViewSpanMs?: number
  maxViewSpanMs?: number
}): TimelineView
export function zoomTimelineView(options: {
  view: TimelineView
  now: TimestampMs
  factor: number
  anchor?: TimestampMs
  minViewSpanMs?: number
  maxViewSpanMs?: number
}): TimelineView
export function panTimelineView(options: {
  view: TimelineView
  now: TimestampMs
  deltaMs: number
  minViewSpanMs?: number
  maxViewSpanMs?: number
}): TimelineView
export function resistZoomSpan(options: {
  currentSpan: number
  proposedSpan: number
  boundaries?: readonly number[]
  resistance?: number
}): number
