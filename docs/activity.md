# Activity

Review a week of tracked time in Timeline, Calendar, or List, move and resize entries, and search your whole history.

Activity shows your completed and running time one Monday–Sunday week at a time in **Timeline**, **Calendar**, and **List**. Both the browser toolbar icon and the Clockoli icon on GitHub open this standalone page.

## Open Activity

Click the Clockoli toolbar icon from any page, or the Clockoli stopwatch icon before your avatar on GitHub. Activity opens in a browser tab, or the existing Activity tab is focused. On an HTTP(S) page, its validated URL and title appear in the **From current page** banner. No tracking panel appears over the source page.

Activity loads the current user's completed entries from the selected time repositories. Each edit or delete is sent back to the record's original time repository.

## Browse weeks

Activity shows one Monday–Sunday week. In Timeline and Calendar, week arrows sit at the left and right edges of the chart header, on a subtle gradient backing instead of a separate empty row; the selected week's short label and Total are in the summary card. List places the short range between its arrows beside Refresh. The left and right arrows move one week; Next is disabled on the current week, so future weeks cannot be opened. There is no period selector.

Switching between Timeline, Calendar, and List resets the displayed week to the current week; navigating within one view retains its selected week. Activity remembers your selected view and restores it when reopened. Live timer updates do not navigate away from an explicitly selected historical week.

Browsing loads records for the displayed week, including work started earlier that continues into it, instead of silently showing only the panel's recent-record window. Weekly reads scan earlier monthly files within bounded file, byte, and record budgets; exceeding a budget reports an error instead of silently showing an incomplete total. A failed week read restores the previous week and its recoverable records. Opening Activity starts a full current-week read.

## Weekly summary

Activity shows three compact metrics in a summary panel headed by the selected week's short date range. On wide screens it sits beside the tracking-status strip (approximately one-eighth of the row for statistics, seven-eighths for tracking); on narrow screens the two panels stack.

- **Today** shows tracked time for the current local day, regardless of the selected week.
- **Total tracked** and **Tasks worked on** cover the selected Monday–Sunday week. Running time counts only on the current week; totals update when browsing weeks. List search filters entries without changing this week-wide total.

Statistics reflect locally accepted records, including edits still waiting to sync to GitHub. No comparison with the previous week is implied. Calendar days without any entries show **No time entries** on weekdays and weekends alike. The label stays at a fixed point in the day's grid rather than following the vertical scroll.

The summary panel replaces a duplicate Total above List, Timeline, and Calendar. The view switcher sits beside the light/dark theme button in page navigation; each icon has an accessible name.

## Timeline and Calendar

Activity mounts the interactive Timeline and Calendar component. Both views show loaded entries; the active timer appears only when viewing the current week. A gutter separates the chart from the summary and tracking panels.

- Timeline and Calendar show tracked time for each local calendar day, including zero days. Intervals spanning midnight contribute to each affected day.
- A completed zero-duration entry remains visible as a minimum-size block with its original equal Start and End times; it does not add tracked time.
- When only one project is shown, Timeline and Calendar omit its redundant label (including in task details); multiple projects retain their labels.
- Timeline and Calendar times, elapsed clocks, and displayed durations omit seconds; sub-minute durations display as 0m. Stored timestamps and durations retain their exact precision.

### Scrolling and zoom

Horizontal scrolling stays within the selected week, and narrow screens scroll within the week. Vertical Timeline wheel gestures scroll the containing Activity page; horizontal gestures scroll the Timeline, while Ctrl/⌘+wheel zooms it. Calendar has a height-limited grid that scrolls vertically.

On opening the current week's Timeline, Activity shows the end of the week, including Saturday and Sunday when they fit in the viewport; earlier days remain scrollable. If cached records appear before the complete week arrives, Activity refocuses after the full read. A manual wheel, pointer, or keyboard interaction cancels that automatic refocus; later refreshes preserve the chosen position.

On opening Calendar and on each week change, it scrolls to the start of the largest group of nearby record starts, ignoring a few isolated overnight entries; if there is no group, it starts at the first record. An empty period starts near 08:00. When the week's records arrive later, Calendar refocuses if it remains at the automatic position, even if some records were already cached; manual scroll and subsequent ordinary updates retain their position.

### Loading

Calendar displays a large in-place loading indicator while a selected week's records are read. It disappears when the read completes or fails; an incomplete read reports its warning instead of spinning indefinitely. Refreshing data preserves the mounted timeline and its position.

If a GitHub read fails, Activity shows a compact notice with Retry. A connection failure says GitHub cannot be reached; a request that times out says GitHub did not respond in time, with technical details visible immediately. Other load failures show **Could not load Activity** followed directly by the actual error reason, without a generic retry sentence or a false network diagnosis. A local timer and queued work remain available while a read fails.

## Select an entry

Hovering over or focusing a Timeline or Calendar block shows its details in a compact floating card; clicking selects it without keeping the card open after the mouse leaves. A touchscreen tap also reveals the card. Neither single nor double click starts or stops a timer; use **Track again** or **Stop and save** in the details to change tracking. The selected entry's Start and End details show only the local time (HH:MM), without a date.

Activity uses a compact details card with a task icon, truncated title, local start–end range, duration, an always-available inline description editor, separate icon-only **Delete** and **Edit**, and a prominent **Track again** action for completed entries. The card stays open while moving the pointer to its actions or editing the description. It fits within the available viewport.

- Completed entries offer **Edit** to open the same prefilled form as List. The field **Add description...** is always available, even for an empty description.
- Description edits save with Enter or blur; Shift+Enter inserts a line and Escape cancels an unsaved edit.
- Only the *running interval itself* shows **Stop and save**. Earlier completed intervals of the same task show **Track again**, disabled while that task is already running. They cannot stop the current timer. After the timer stops, **Track again** becomes available.
- A completed imported task without an HTTP(S) URL can be restarted from either view, subject to verifying the saved task identity.

## Move and resize entries

Entries retain their default appearance. Hovering over or selecting an entry reveals colored resize grips with paired marks: left and right in Timeline, top and bottom in Calendar, where the center remains draggable. Drag an edge to change the start or end time.

A drag previews its position, but a completed time edit appears in the local view only after the overlap check and durable queue acceptance; a rejected edit restores the original entry and displays an actionable error above the visual view.

- **Reorder.** Drag a completed entry past another entry into free time before or after it to change their order. The moved entry keeps its duration; other entries stay in place. During the drag, it snaps to a free interval and never overlaps another entry.
- **No future time.** While moving or extending a completed entry, its end stops at the current time; dragging farther cannot preview or save future time. A drag that cannot change the entry does not queue an edit. Keyboard edits and edits rejected by validation still leave the stored interval unchanged and show the reason without offering a data-loading retry.
- **Snapping.** Timeline block moves, edge resizing, and keyboard arrow edits snap to five-minute increments (:00, :05, :10, etc.) at any zoom level; neighbor-boundary magnets still apply. Calendar keeps one-minute precision, and direct List time inputs accept exact minutes.
- **Stay in the week.** Moving a completed entry stays within the selected Monday–Sunday week. Holding it at a chart edge never changes weeks; moves outside the week are rejected. An entry that crosses the displayed week's boundary cannot be moved from its clipped visual block, so its full duration is preserved. Use the normal week arrows to browse separately from dragging.
- **Full week first.** Moving and resizing completed entries become available only after the selected week loads completely; a partial or failed week read leaves those controls unavailable to prevent overlooked overlaps.

Timeline keeps the positions of other entries, its horizontal scroll, and future day bands steady while moving an entry, including when another timer is running. The selected week's days also remain available after a viewport refresh or remount, even if the visible window ends before Sunday. Calendar keeps its hour grid fixed during the drag and recalculates it after the gesture. The moved entry's timestamp edit enters the durable queue. Deleting an entry updates the local view immediately.

Every time change is checked for overlaps before it is accepted; see [Overlap checks](editing-time.md#overlap-checks).

## Overlaps and unreadable weeks

Overlapping visible timeline blocks produce one warning naming the entries and intervals, with **Fix in Activity**. If an overlapping week cannot be rendered in Timeline or Calendar, a visible error replaces the misleading empty view and **Go to List** opens the same week for manual repair. A rejected Edit time form keeps its values and points to List.

## List

List shows the selected week's completed entries in inset cards grouped by date, without a separate Tracked time heading. In Activity, each completed task has a start-tracking icon; the icon becomes stop when that task is running. Starting another task stops the current timer first. Locally stored entries use the same tracking actions as entries already on GitHub. Invalid task identities have no tracking action.

### Search all history

In Activity List, entering a URL or title searches completed activity across all available weeks and selected time repositories, independently of the displayed week. Search appears beside week navigation and Refresh on desktop and on its own row on narrow screens. The field keeps the accessible **Search activity** name.

- The first search loads history on demand; a loading message appears until results are ready.
- Matching records appear in pages of up to 20, newest first, with Previous/Next page controls and the matching-record range; changing the query returns to page one. Pagination is over the loaded history, not a separate repository request for each page.
- Clear the search to return to the selected week's entries.
- Unreadable repositories or conflicting records are flagged as incomplete; a failed history load shows an error and Retry rather than claiming no matches.

## Task icons

Imported tasks without a web URL show an inverted Clockoli broccoli-clock silhouette inside a circular mark in Activity List, Calendar, record details, and Top tasks. The circle follows the selected light or dark theme. GitHub task favicons switch to a light silhouette in the dark theme; other URL tasks retain their site favicon or monogram.

## Changes waiting to sync

Activity hydrates durable local edits before waiting for the GitHub week read, so an edit queued during a previous session is not temporarily replaced by the older remote interval. Ordinary background synchronization has no visible status or spinner; unsynced entries look and behave like synced entries. See [Sync and offline work](sync.md).
