# Elastic Timeline Editor API

## Package imports

```js
import { createElasticTimeline } from 'elastic-timeline-editor'
import 'elastic-timeline-editor/style.css'
```

The package has no runtime dependencies and does not require React, Vue, or another framework.

Runtime target: modern desktop browsers with ES modules, Pointer Events/pointer capture, `ResizeObserver`, and CSS custom properties. Package import is SSR-safe; mounting requires a real DOM `Element`.

## `createElasticTimeline(container, props)`

Mounts the editor inside `container` and returns an instance with `update`, `getView`, `scrollToEnd`, and `destroy`. `scrollToEnd()` performs an actual viewport scroll to the maximum horizontal offset after rendering; changing only the model view does not imply DOM scrolling.

```js
const timeline = createElasticTimeline(document.querySelector('#timeline'), {
  items,
  rows,
  now: Date.now(),
  onEditCommit(edit) {
    // Persist the intent, then return authoritative items through update().
  },
})
```

### Required props

| Prop | Type | Meaning |
|---|---|---|
| `items` | `TimelineItem[]` | Authoritative interval model. The component never mutates it. |
| `now` | `number` | Current timestamp in milliseconds. Future time is unavailable. |

### Optional props

| Prop | Default | Meaning |
|---|---:|---|
| `rows` | inferred | Ordered named rows. Unknown `rowId` values are appended. All rows share one horizontal layout: non-overlapping time intervals cannot overlap visually; actual time overlaps may share horizontal space. |
| `view` | last 24h | Controlled initial/current actual-time view. |
| `minViewSpanMs` | 1 hour | Minimum zoom span. |
| `maxViewSpanMs` | 7 days | Maximum history and zoom span. |
| `defaultViewSpanMs` | 24 hours | Initial span when `view` is omitted. |
| `snapMs` | 1 minute | Commit-time rounding step. Preview remains continuous. |
| `minimumDurationMs` | 1 minute | Absolute minimum duration produced by resize. |

### `TimelineItem`

```ts
interface TimelineItem {
  id: string
  startedAt: number
  endedAt: number | null
  title: string
  url?: string
  color?: string
  rowId?: string
  isRunning?: boolean
  isEditable?: boolean
  isPending?: boolean
  isStartDisabled?: boolean
  isStopDisabled?: boolean
}
```

- `endedAt: null` marks a running item; its visual end is `now`. A newly accepted item with `startedAt === now` is rendered immediately at the right edge with the minimum visual width.
- When elastic global placement extends blocks beyond the time-cell allocation, the component expands the canvas/header to the complete rendered extent; the current-time label therefore remains above the rightmost running block after `scrollToEnd()`.
- Completed items are editable unless `isEditable: false`. `isPending` is a visual synchronization state and does not block further corrections.
- A running item supports left resize only.
- `isStartDisabled` blocks both the Start button and double-click start; `isStopDisabled` blocks STOP.
- Double-click is recognized from the two item clicks before the browser's synthesized `dblclick`, so an immediate parent update cannot remove the target between clicks; a `dblclick` landing on a resize edge invokes the same item action.
- Horizontal wheel/trackpad input consumes any elastic canvas overflow before panning the actual-time view, making the full right edge reachable at maximum zoom-out.
- `rowId` is stable: interactions never move an item between rows.
- `color` may be any valid CSS color. Without it, a stable curated palette is used.

### `TimelineRow`

```ts
interface TimelineRow {
  id: string
  title?: string
}
```

Neighbour bounds are calculated only inside the item's row.

## Events and controlled-data contract

| Callback | When it fires |
|---|---|
| `onViewChange(view)` | Pan or zoom produces a new actual-time view. |
| `onSelect(item)` | Single click or keyboard Enter selects an item. |
| `onStart(item)` | Double-click or the Start button requests task start. May return a Promise; repeat starts for that item are blocked until it settles. |
| `onStop(item)` | The STOP action or a double-click on a running item requests it to stop. May return a Promise; duplicate stops for that item are blocked until it settles. |
| `onEditPreview(edit)` | Pointer movement produces a valid continuous proposal. |
| `onEditCommit(edit)` | Pointer release or keyboard edit requests one persisted edit. |
| `onEditCancel(item)` | Escape, pointer cancellation, synchronous failure, or rejected async commit. |
| `onEditDebug(detail)` | Emits bounded move/resize diagnostics for instrumentation. |


`onEditCommit` is an intent, not a mutation. Persist it and call `timeline.update({ items })` with authoritative data. If persistence fails, return the old items; the component removes its optimistic preview.

```js
const timeline = createElasticTimeline(container, {
  items,
  now,
  async onEditCommit(edit) {
    try {
      await api.updateInterval(edit)
      timeline.update({ items: await api.listIntervals() })
    } catch (error) {
      timeline.update({ items }) // authoritative rollback
      showError(error)
    }
  },
})
```

Use `isPending: true` to show that an item still has locally accepted work waiting for synchronization. Set `isEditable: false` separately only when editing must be blocked.

## Instance methods

### `update(partialProps)`

Updates any prop without remounting. Use it for authoritative items, advancing `now`, row changes, or controlled view changes.

```js
timeline.update({ items: nextItems, now: Date.now() })
```

### `getView()`

Returns a copy of the current `{ start, end, focusedAt }` view.

### `scrollToEnd()`

Performs a DOM scroll to the maximum horizontal offset after rendering. This is distinct from changing the model `view`.

### `destroy()`

Cancels active interaction, disconnects `ResizeObserver`, removes listeners, releases pointer capture, and empties the mount container. Call this during framework unmount.

## Interaction reference

| Input | Action |
|---|---|
| Drag block body | Move inside row-local neighbour bounds. |
| Drag left/right grip | Resize one actual edge. |
| Hover/focus | Show truthful actual-time details. |
| Single click / Enter | Select. |
| Double-click completed item | Call `onStart`. |
| Double-click running item | Call `onStop`. |
| Alt/Ctrl/⌘ + wheel | Zoom around the pointer; 1d and 3d are magnetic boundaries. |
| Shift + wheel / horizontal trackpad | Pan. |
| Left/Right on viewport | Pan one calendar cell. |
| Alt + Left/Right on item | Move one snap. |
| Ctrl + Alt + Left/Right | Resize left one snap. |
| Shift + Alt + Left/Right | Resize right one snap. |
| Escape | Cancel preview or clear selection. |

## Visual guarantees

- Minimum interactive block width: 30 CSS px, including a newly created running interval at every zoom level.
- Minimum visual gap: 4 CSS px.
- Actual timestamps remain the source of truth even when minimum footprints expand visual geometry.
- No interaction shifts a non-target block.
- Move and resize constraints use one global chronological neighbour sequence across all rows. `rowId` controls vertical presentation only and never permits an edited interval to overlap a block in another row.
- Same-row neighbours whose actual timestamps touch (`0 ms`) or differ by one second receive a non-interactive connector dot.
- Running pulse respects `prefers-reduced-motion`.
- Zooming out while positioned at `now` preserves the maximum-right scroll position, including the display-only running-item gutter.
- Every tracked hour has a complete compact 9px `HH:mm` label. Consecutive empty hours are represented by contiguous empty ranges labelled `HH:mm - HH:mm` (at most six hours per range), so the hour scale never silently skips time. Labels are never clipped, moved into neighbouring cells, or shown at day-level scale.
- A running item at `now` keeps an explicit visible clock label at the current right edge on a separate header line.

## Framework lifecycle examples

### React

```jsx
import { useEffect, useRef } from 'react'
import { createElasticTimeline } from 'elastic-timeline-editor'
import 'elastic-timeline-editor/style.css'

export function Timeline({ items, rows, now, onCommit }) {
  const host = useRef(null)
  const timeline = useRef(null)

  useEffect(() => {
    timeline.current = createElasticTimeline(host.current, {
      items, rows, now, onEditCommit: onCommit,
    })
    return () => timeline.current.destroy()
  }, [])

  useEffect(() => {
    timeline.current?.update({ items, rows, now, onEditCommit: onCommit })
  }, [items, rows, now, onCommit])

  return <div ref={host} />
}
```

### Vue

Mount in `onMounted`, call `update` from a watcher, and call `destroy` in `onBeforeUnmount`. Do not let the framework reconcile DOM inside the component container.

## Styling

Import the packaged stylesheet. Component classes use the `elastic-timeline__` prefix. Supported CSS custom properties on `.elastic-timeline`:

```css
.elastic-timeline {
  --et-border: #cbd5e1;
  --et-border-strong: #64748b;
  --et-bg: #fff;
  --et-bg-soft: #f8fafc;
  --et-text: #17212b;
  --et-muted: #52606d;
  --et-focus: #0f62fe;
  --et-guide: #111827;
}
```

Dark mode and reduced motion are handled by media queries in the packaged CSS.

## Pure helpers

The root package also exports scale, layout, constraint, view, color, connector, and tracked-duration helpers. Their declarations are in `types/index.d.ts`; application integrations normally need only `createElasticTimeline`.
