# Activity

Review a week of tracked time in Timeline, Calendar, or List, move and resize entries, and search your whole history.

Activity shows your completed and running time one Monday–Sunday week at a time, in three views: **Timeline**, **Calendar**, and **List**. The same views appear in the toolbar panel and the GitHub panel.

## Open Activity

Open **Activity** from the toolbar panel navigation or the GitHub split-menu arrow. The toolbar also opens Activity on pages that cannot be tracked, such as `chrome://` pages.

Activity loads the current user's completed entries from the selected time repositories. Each edit or delete is sent back to the record's original time repository.

## Browse weeks

Activity, the toolbar panel, and the GitHub panel show one Monday–Sunday week. In Timeline and Calendar, week arrows sit at the left and right edges of the chart header, on a subtle gradient backing instead of a separate empty row; the selected week's short label and Total are in the summary card. List places the short range between its arrows beside Refresh. The left and right arrows move one week; Next is disabled on the current week, so future weeks cannot be opened. There is no period selector.

Switching between Timeline, Calendar, and List resets the displayed week to the current week; navigating within one view retains its selected week. Activity and the toolbar panel share the selected view in local extension storage and restore it when reopened. Live timer updates do not navigate away from an explicitly selected historical week.

Browsing loads records for the displayed week, including work started earlier that continues into it, instead of silently showing only the panel's recent-record window. Weekly reads scan earlier monthly files within bounded file, byte, and record budgets; exceeding a budget reports an error instead of silently showing an incomplete total. A failed week read restores the previous week and its recoverable records. Opening the toolbar popup starts a full current-week read, so its Timeline can show the same entries as Calendar and Activity.

## Weekly summary

Activity shows three compact metrics in a summary panel headed by the selected week's short date range. On wide screens it sits beside the tracking-status strip (approximately one-eighth of the row for statistics, seven-eighths for tracking); on narrow screens the two panels stack.

- **Today** shows tracked time for the current local day, regardless of the selected week. On Activity and both popup surfaces, Today appears here instead of in the running-timer strip.
- **Total tracked** and **Tasks worked on** cover the selected Monday–Sunday week. Running time counts only on the current week; totals update when browsing weeks. List search filters entries without changing this week-wide total.

Statistics reflect locally accepted records, including edits still waiting to sync to GitHub. No comparison with the previous week is implied. Calendar days without any entries show **No time entries** on weekdays and weekends alike.

In Activity and both popup surfaces, the summary panel replaces a duplicate Total above List, Timeline, and Calendar. The Timeline, Calendar, and List icon switcher sits beside the light/dark theme button in the page navigation; each icon has an accessible name.

## Timeline and Calendar

Activity and both popup surfaces mount the same interactive Timeline and Calendar component. Both visual views show loaded entries; the active timer appears only when viewing the current week. In Activity, the toolbar popup, and the full-width GitHub panel, a gutter separates Timeline and Calendar from the summary and tracking panels.

- Timeline and Calendar show tracked time for each local calendar day, including zero days. Intervals spanning midnight contribute to each affected day.
- A completed zero-duration entry remains visible as a minimum-size block with its original equal Start and End times; it does not add tracked time.
- When only one project is shown, Timeline and Calendar omit its redundant label (including in task details); multiple projects retain their labels.
- Timeline and Calendar times, elapsed clocks, and displayed durations omit seconds; sub-minute durations display as 0m. Stored timestamps and durations retain their exact precision.

### Scrolling and zoom

Horizontal scrolling stays within the selected week, and narrow screens scroll within the week. The shared component leaves vertical Timeline wheel gestures to the containing Activity page or panel. Horizontal gestures scroll the Timeline, while Ctrl/⌘+wheel zooms it. Calendar has a height-limited grid on both surfaces: vertical wheel scrolls the grid, then continues through the containing page or panel at its edges.

On opening the current week's Timeline, Activity and the toolbar panel show the end of the week, including Saturday and Sunday when they fit in the viewport; earlier days remain scrollable. Loading the complete week after cached records does not progressively zoom the toolbar panel; the selected zoom level is preserved across refreshes. If cached records appear before the complete week arrives, Activity refocuses after the full read. A manual wheel, pointer, or keyboard interaction before that read cancels the automatic refocus; later refreshes preserve the user's chosen position.

On opening Calendar and on each week change, it scrolls to the start of the largest group of nearby record starts, ignoring a few isolated overnight entries; if there is no group, it starts at the first record. An empty period starts near 08:00. When the week's records arrive later, Calendar refocuses if it remains at the automatic position, even if some records were already cached; manual scroll and subsequent ordinary updates retain their position.

### Loading

On both Activity and the toolbar panel, Calendar displays a large in-place loading indicator while a selected week's records are being read. It starts when navigating to another week and disappears after the read completes or fails; an incomplete read reports its warning instead of spinning indefinitely. Refreshing data preserves the mounted timeline and its position.

## Select an entry

Hovering over or focusing a Timeline or Calendar block shows its details in a compact floating card; clicking selects it without keeping the card open after the mouse leaves. A touchscreen tap also reveals the card. Neither single nor double click starts or stops a timer; use **Track time** or **Stop and save** in the details to change tracking. The selected entry's Start and End details show only the local time (HH:MM), without a date.

Activity, the toolbar popup, and the GitHub panel use the same card: a task icon, single-line truncated title, inline local start–end range and duration, description when available, icon-only **Delete** and **Edit** actions, and a pastel **Track time** button. It opens immediately on hover and stays open while the pointer crosses the gap to the card, even slowly; moving away closes it without pinning. In Calendar, the card opens to the right of the record when space allows, or to the left near the right edge; narrow panels fall back to above or below. The card stays within the GitHub panel when space is limited. Start/End/Duration badges appear only while dragging an entry.

- Completed entries offer **Edit** beside their other detail actions; it opens the same prefilled form as List in Activity, the extension toolbar popup, and the GitHub-page panel. The GitHub-page panel keeps the dialog in an extension-owned closed Shadow DOM.
- The details card omits the empty **Add description** field. Existing descriptions remain editable there; completed entries with no description can add one through **Edit**.
- Both the running interval and completed intervals of the task currently being tracked show **Stop and save**. It stops and saves the current timer and never changes the selected completed interval. The running duration remains visible in the task details and header. Once stopped, a completed interval offers **Track time** again.
- A completed imported task without an HTTP(S) URL can be restarted from either view in both surfaces; in the GitHub panel, the background verifies the source record before switching timers. Arbitrary page-originated task identities remain disallowed.

## Move and resize entries

Entries retain their default appearance. Hovering over or selecting an entry reveals colored resize grips with paired marks: left and right in Timeline, top and bottom in Calendar, where the center remains draggable. Drag an edge to change the start or end time.

A drag previews its position, but a completed time edit appears in the local view only after the overlap check and durable queue acceptance; a rejected edit restores the original entry and displays an actionable error above the visual view.

- **Reorder.** Drag a completed entry past another entry into free time before or after it to change their order. The moved entry keeps its duration; other entries stay in place. During the drag, it snaps to a free interval and never overlaps another entry.
- **No future time.** A move or end resize that would place the end in the future is rejected and restored without saving.
- **Snapping.** Timeline block moves, edge resizing, and keyboard arrow edits snap to five-minute increments (:00, :05, :10, etc.) at any zoom level; neighbor-boundary magnets still apply. Calendar keeps one-minute precision, and direct List time inputs accept exact minutes.
- **Stay in the week.** Moving a completed entry stays within the selected Monday–Sunday week. Holding it at a chart edge never changes weeks; moves outside the week are rejected. An entry that crosses the displayed week's boundary cannot be moved from its clipped visual block, so its full duration is preserved. Use the normal week arrows to browse separately from dragging.
- **Full week first.** In the toolbar popup and GitHub panel, moving and resizing completed entries become available only after the selected week loads completely; a partial or failed week read leaves those controls unavailable, so records outside the recent window cannot be overlooked. Short blocks in the narrow toolbar panel leave a wider draggable center between the resize grips; dragging the edges still resizes them.

Timeline keeps the positions of other entries, its horizontal scroll, and future day bands steady while moving an entry, including when another timer is running. The selected week's days also remain available after a viewport refresh or remount, even if the visible window ends before Sunday. Calendar keeps its hour grid fixed during the drag and recalculates it after the gesture. The moved entry's timestamp edit enters the durable queue. Deleting an entry updates the local view immediately.

Every time change is checked for overlaps before it is accepted; see [Overlap checks](editing-time.md#overlap-checks).

## Overlaps and unreadable weeks

Overlapping visible timeline blocks produce one warning naming the entries and intervals, with **Fix in Activity**. If an overlapping week cannot be rendered in Timeline or Calendar, a visible error replaces the misleading empty view and **Go to List** opens the same week for manual repair. A rejected Edit time form keeps its values and points to List.

## List

List shows the selected week's completed entries in inset cards grouped by date, without a separate Tracked time heading. In Activity, each completed task has a start-tracking icon; the icon becomes stop when that task is running. Starting another task stops the current timer first. Locally stored entries use the same tracking actions as entries already on GitHub. Invalid task identities have no tracking action.

### Search all history

In Activity and toolbar-popup List views, entering a URL or title searches completed activity across all available weeks and selected time repositories, independently of the displayed week. Search fills the toolbar beside week navigation and Refresh on desktop; in the compact popup and on narrow screens it takes its own row above them. The field keeps its accessible Search activity name without a visible caption. The GitHub panel's List searches only the selected week.

- The first search loads history on demand; a loading message appears until results are ready.
- Matching records appear in pages of up to 20, newest first, with Previous/Next page controls and the matching-record range; changing the query returns to page one. Pagination is over the loaded history, not a separate repository request for each page.
- Clear the search to return to the selected week's entries.
- Unreadable repositories or conflicting records are flagged as incomplete; a failed history load shows an error and Retry rather than claiming no matches.

### List in the toolbar panel

In the toolbar panel's List view, completed entries from the selected week are grouped by date in separate inset cards, with task colors matching the timeline, start–stop times, durations, pending status, and **Continue**. Search entries above them works as in Activity, with the same loading, incomplete-history, retry, and pagination behavior. The week arrows surround a short range beside Refresh; the summary card holds today's total and the selected week's Total tracked and Tasks worked on. Continue saves any running task before restarting the selected task. Unavailable values display **…** or **—** instead of a misleading number. Older entries remain available in Activity.

## Task icons

Imported tasks without a web URL show an inverted Clockoli broccoli-clock silhouette inside a circular mark in Activity List, Calendar, record details, and Top tasks. The circle follows the selected light or dark theme. GitHub task favicons switch to a light silhouette in the dark theme; other URL tasks retain their site favicon or monogram.

## Changes waiting to sync

Activity hydrates durable local edits before waiting for the GitHub week read, so an edit queued during a previous session is not temporarily replaced by the older remote interval. Ordinary background synchronization has no visible status or spinner; unsynced entries look and behave like synced entries. See [Sync and offline work](sync.md).
