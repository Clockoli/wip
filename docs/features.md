# Clockoli feature guide

## URL-first task tracking

Clockoli treats the canonical HTTP(S) URL as the task identity. A task can be:

- a GitHub issue or pull request;
- a ticket in another system;
- a document, dashboard, customer record, or design;
- any other HTTP(S) page.

A title is optional. GitHub titles are metadata, not part of the durable identity. For GitHub issue and pull-request URLs, Clockoli removes navigation-only query and fragment data so opening the same task through a notification link does not create another task. Tracking an issue from a GitHub Projects issue pane uses its direct `owner/repo/issues/number` URL, not the project view URL. Previously saved project-view records retain their original identity; they are not automatically merged.

The toolbar popup supports any HTTP(S) active tab. The injected stopwatch and native-looking split control are limited to `github.com`.

## Active timer

Clockoli maintains one global GitHub-backed active timer per user across all configured time repositories.

- Start records the canonical URL, optional title, and timezone-bearing Start timestamp.
- Stop saves an optional description with the completed record.
- Elapsed time is calculated from the stored Start timestamp, not from an in-page tick counter.
- A connected browser can read the active timer written by another connected browser.
- **Tracking this task** confirms that the current page matches the timer.
- **Tracking another task** makes a mismatched active URL obvious.
- Starting a different task performs a switch. Across repositories, Clockoli durably queues the source completion before the target Start and resumes that ordering after restart.
- The active timer and accepted queued writes retain their destination even if routing later changes.

Stopping an entry longer than 12 hours asks for confirmation. The warning does not impose a duration limit.

## Main tracking panel and popup

### Daily panel

The browser toolbar opens a partial-height daily panel on HTTP(S) pages, or falls back to an Activity tab on restricted pages. Above the timeline, the active-task strip shows **Not tracking** and **Track this task**, or a **Tracking now** card with the running task link, elapsed time to the minute, today's tracked total, editable Stop description, and **Stop and save**. An unavailable daily total displays **…**. The centered **Timeline**, **Calendar**, and **List** tabs sit beneath the tracking status in Activity, the toolbar popup, and the GitHub panel; Activity's List search appears below the tabs. When another task is open, **Switch to this task** saves the active timer and starts the current page. The timeline's block Start and Stop actions remain available. Every Stop or switch asks for confirmation when the active entry exceeds 12 hours.

Settings → Interface width controls the horizontal layout of Activity, Reports, Top tasks, and the content inside the toolbar panel: a centered column (default) or the available screen width. Settings itself always uses a centered 820px column. The panel shell always spans the page width; it remains at most 70% of the viewport height (and at most 720px) in either width mode, scrolling internally when needed. This device-local preference is not included in repository data or settings exports.

Entries retain their default appearance. Hovering over or selecting an entry reveals colored resize grips with paired marks: left and right in Timeline, top and bottom in Calendar, where the center remains draggable. The selected entry's Start and End details show only the local time (HH:MM), without a date. Timeline and Calendar times, elapsed clocks, and displayed durations omit seconds; sub-minute durations display as 0m. Stored timestamps and duration retain their exact precision. Drag an edge to change the start or end time. Moving or resizing an entry shows a non-blocking **Saving…** spinner inside the left side of that entry through local acceptance and pending GitHub synchronization. You can keep moving or resizing it while a write is pending; successive edits enter the durable queue and are reconciled in order. Deletion of a pending entry remains unavailable. There is no separate save-status row above the timeline; actionable conflicts remain visible in panel feedback.

In the toolbar panel's List view, completed entries from the selected Monday–Sunday week are grouped by date, with task colors matching the timeline, start–stop times, durations, pending status, and **Continue**. The week arrows and selected-week Total remain visible in List. Continue saves any running task before restarting the selected task. Stationary **Today** and **This week** totals include applicable running time; unavailable totals display **…**, including when GitHub summary reads fail. Older entries remain available in **Activity**.

The panel first reads local state and shows **Loading…** until configuration is known. On other websites, an idle panel explains that the page can be tracked and that time is saved to the private GitHub repository. State refreshes update controls, totals, errors, and the timeline clock while preserving the mounted editor, its viewport, focused block, and panel scroll position. A vertical wheel gesture over the timeline scrolls the panel when it has more content; a horizontal gesture still moves the timeline. Opening focuses the strip's main action; closing with the panel control or Escape restores the previous focus. Switching tabs or moving focus away from the page closes the panel without moving focus; reopening reads the latest state. Clicking the underlying page closes the panel without taking focus back from the clicked page element. Escape first cancels a timeline edit or selection, then closes the panel when the editor leaves it unhandled.

Overlapping visible timeline blocks produce one warning naming the entries and intervals, with **Fix in Activity**. Queue diagnostics are hidden unless enabled in Advanced settings; when shown, they start collapsed. Actionable conflicts remain visible. Connection errors show a headline, detail, and recovery action; Retry refreshes reads without repeating a tracking mutation. Reduced-motion users see static stopwatch and toolbar icons.

### GitHub stopwatch dialog

The smaller GitHub stopwatch dialog includes an optional Stop description, separate **Stop and save** and **Save and switch to this task** actions when viewing another task, stationary Today and This week totals, and recent entries with inline correction and Delete. When complete route-matched participant totals are available, it also shows **Tracked on this issue/PR**, noting included running time. Beautified tracking commit events retain their original commit links on the timestamps.

### Navigation

Both surfaces provide Top tasks, Activity, Reports, and Settings navigation.

The GitHub split control survives GitHub's client-side navigation and mounts next to the authenticated user's avatar. Its arrow always opens Top tasks/Activity/Reports navigation.

## Recent entries

The main panel shows cached entries immediately when available and refreshes them automatically. It loads up to 50 recent entries from the configured display window. The display window defaults to seven local calendar days and can be set from 1 to 31 days.

In the compact GitHub stopwatch dialog, recent entries label their dates **Today**, **Yesterday**, or with a short weekday name.

Changing this setting does not alter stored data or limit reports. Recent data is read by monthly file rather than one API request per record.

### Direct time correction

Each completed row has one compact `HH : MM - HH : MM` range. The four hour/minute values stay on one line; their accessible Start and Stop labels remain available to assistive technology.

- Type an hour or minute directly in the always-visible Start/Stop inputs.
- Wheel and trackpad gestures never mutate time values or trap panel scrolling, and there are no `−`/`+` step controls.
- A direct correction remains a local draft until **Save time** is selected.
- All relevant row controls are disabled while a mutation is in flight.
- Validation or network errors keep the draft available for correction or retry.

If the edited Start moves before the previous interval's Stop, the previous Stop moves to the new Start. If the edited Stop moves after the next interval's Start, the next Start moves to the new Stop. All touched records are preflighted and saved together. Cross-month changes use one atomic Git commit.

Strict intersections are highlighted as **Overlaps another entry**. Entries that only touch at one endpoint are not overlaps.

### Unified inline editing and deletion

Selecting the displayed URL, title, or description expands those fields in the same inline draft as Start and Stop. Press Enter or select **Save time** to save:

- task URL;
- optional title, up to 300 characters;
- Start and Stop date/time;
- description, up to 2,000 characters.

Only one draft is active at a time. Starting another edit cancels the previous unsaved draft. A linked adjacent-boundary group remains available while the Activity URL/title filter changes.

Changing the URL clears an unchanged old title so metadata from one task is not silently carried to another.

**Delete** requires confirmation and uses the loaded file version and original record content to avoid deleting the wrong entry after another edit. Git history retains the previous file version unless a repository administrator rewrites history.

## Top tasks page

**Recently tracked work** aggregates the current user's completed and running sessions by canonical task identity across selected time repositories.

- Search by URL or optional title.
- Periods: last 2 weeks, month, 3 months, 6 months, or year.
- Completed and running time participate in ordering.
- The task identity appears as a compact source line, with the optional title as the prominent link below it. Untitled URL tasks show the URL as the primary link without duplication. Imported tasks without a navigable URL show a non-link identity and title.
- Each task, including unresolved Clockify imports with a bare `owner/project/task-slug` identity, shows accumulated time and a Start/Stop control. Starting another task stops the running timer first and keeps the imported identity unchanged. Page-originated starts and manually entered new tasks still require HTTP(S) URLs.
- Each aggregate retains sorted time-repository provenance so identical URLs from different destinations are not misattributed.

The page reads the current user's monthly paths from the selected destinations before hydrating optional GitHub issue/PR titles. Destinations load independently, so available tasks may remain visible with partial-read status. Metadata is bounded and cached; inaccessible metadata falls back to the stored URL/title rather than hiding tracked time.

## Activity page

Activity loads the current user's completed entries from selected time repositories for one Monday–Sunday week at a time. The left and right arrows move one week; Next is disabled on the current week, so future weeks cannot be opened. There is no period selector. In List, entering a URL or title searches completed activity across all available weeks and selected time repositories, independently of the displayed week. The first search loads history on demand; a loading message appears until results are ready. Matching records appear in pages of up to 20, newest first, with Previous/Next page controls and the matching-record range; changing the query returns to page one. Pagination is over the loaded history, not a separate repository request for each page. Clear the search to return to the selected week's entries. Unreadable repositories or conflicting records are flagged as incomplete; a failed history load shows an error and Retry rather than claiming no matches. The shared inline editor is available on results. Each edit or delete is sent back to the record's original time repository. In List, each completed task has a start-tracking icon; the icon becomes stop when that task is running. Starting another task stops the current timer first. Pending entries and invalid task identities have no tracking action.

Activity and the toolbar panel mount the same interactive Timeline and Calendar component. Both show one Monday–Sunday week with navigation arrows at the left and right edges, the week label centered between them, and Total beneath it. Switching between Timeline, Calendar, and List resets the displayed week to the current week; navigating within one view retains its selected week. Activity and the toolbar panel share the selected view in local extension storage and restore it when reopened. Browsing loads records for the displayed week, including work started earlier that continues into it, instead of silently showing only the panel's recent-record window. Weekly reads scan earlier monthly files within bounded file, byte, and record budgets; exceeding a budget reports an error instead of silently showing an incomplete total. A failed week read restores the previous week and its recoverable records. Horizontal scrolling stays within the selected week. Narrow screens scroll within the week. On opening Calendar and on each week change, it scrolls to the start of the largest group of nearby record starts, ignoring a few isolated overnight entries; if there is no group, it starts at the first record. An empty period starts near 08:00. When the week's records arrive later, Calendar refocuses if it remains at the automatic position, even if some records were already cached; manual scroll and subsequent ordinary updates retain their position. Live timer updates do not navigate away from an explicitly selected historical week. Both visual views show loaded entries; the active timer appears only when viewing the current week. A completed imported task without an HTTP(S) URL can be restarted from either view in both surfaces; in the GitHub panel, the background verifies the source record before switching timers. Arbitrary page-originated task identities remain disallowed. URL/title search and the inline editor apply to Activity List. Refreshing data preserves the mounted timeline and its position.

On both Activity and the toolbar panel, Calendar displays a large in-place loading indicator while a selected week's records are being read. It starts when navigating to another week and disappears after the read completes or fails; an incomplete read reports its warning instead of spinning indefinitely.

The shared Timeline/Calendar component leaves vertical Timeline wheel gestures to the containing Activity page or panel. Horizontal gestures scroll the Timeline, while Ctrl/⌘+wheel zooms it. Calendar has a height-limited grid on both surfaces: vertical wheel scrolls the grid, then continues through the containing page or panel at its edges. Horizontal scrolling across the week stays available on narrow screens.

Timeline and Calendar show tracked time for each local calendar day, including zero days. Intervals spanning midnight contribute to each affected day. When only one project is shown, Timeline and Calendar omit its redundant label (including in task details); multiple projects retain their labels. Selected task details appear above the week navigation in Calendar, and below the chart in Timeline. Timeline, Calendar, and List show the selected week's **Total** above the view, including running time only on the current week; it updates when browsing weeks. List search filters entries without changing this week-wide total.

Single- and double-clicking a Timeline or Calendar block both select it and show its details. Neither gesture starts or stops a timer; use **Start tracking** or **Stop and save** in the details to change tracking.

Both the running interval and completed intervals of the task currently being tracked show **Stop and save** in Timeline/Calendar details. It stops and saves the current timer, never changes the selected completed interval. The running duration remains visible in the task details and header. Once stopped, a completed interval offers **Start tracking** again.
Activity hydrates durable local edits before waiting for the GitHub week read, so an edit queued during a previous session is not temporarily replaced by the older remote interval. **Timeline** block moves, edge resizing, and keyboard arrow edits snap to five-minute increments (:00, :05, :10, etc.) at any zoom level; neighbor-boundary magnets still apply. **Calendar** keeps its existing one-minute precision, while direct List time inputs continue to accept exact minutes.

The bulk importer accepts one dated URL task per line with an optional description and a duration. It validates the complete request and existing history before one atomic Git commit, including intervals that cross in from older monthly files and a concurrently started active timer. A failed request writes nothing and keeps the draft available for correction.

## Reports

Reports includes records whose Start date falls in the selected inclusive range.

### Periods

Open the date-range button beneath Reporting period to choose a preset or custom dates. The button shows the selected date range, including when a preset is selected.

- Today and Yesterday
- Last 7 days and Last 30 days
- This week and Last week
- This month and Last month
- This quarter and Last quarter
- This year and Last year
- Custom Start and End dates

Presets apply immediately. In the calendar, select a Start day and then an End day; choosing an earlier second day starts a new range. You can also edit the native Start and End date fields. Month navigation leaves the selection unchanged. Arrow keys move between days, Enter or Space selects, and Escape closes the picker and returns focus to the button. Clicking outside also closes it.

The footer names the local time zone. Turn on UTC to include and group entries by their UTC Start date, using that same date for effective rates, exchange rates, exports, and invoices. With UTC off, reporting uses each entry's recorded local date. UTC reporting also reads the adjacent monthly files so records near a month boundary are included correctly. The switch is saved locally across reloads and is included in settings exports; settings files without it use the local basis. Reporting preferences and invoices are never written to the time-data repository.

### Summary and facets

The summary shows:

- tracked time;
- billable amount;
- entry count;
- people count;
- source count.

Filter by People, Projects, Task sources, and Time repositories. For a GitHub issue or pull request, the Task source is `owner/repository`; for another URL it is the hostname. The Time repository is the destination that stores the record.

### Analytics

Choose one vertical metric:

- Total time
- Avg time per distinct task
- Billable amount
- Task count, deduplicated by canonical URL

Choose independent horizontal and stack dimensions:

- Day
- Week
- Month
- Person
- Task source
- Time repository
- Task

The analytics are calculated for the chart; the data table's rows are rendered only when expanded, which keeps large reports responsive.

### Export

- CSV timesheet
- JSON timesheet
- Native browser print or save-to-PDF

CSV and JSON include task URL and title, Start, End, duration, person, and description. They do not include the time repository or additional GitHub issue/PR metadata. When local rates are configured, each exported row also includes its effective hourly rate, per-entry billable amount, and that rate's currency. If any selected time repository fails to load or conflicting copies of a record are omitted, Clockoli shows the partial report but disables CSV, JSON, and print/PDF timesheet exports.

## Local billable rates

Settings accepts non-negative hourly rates keyed by GitHub login, with a currency sign or 2–12 letter description included in every rate value.

- Rates can be effective-dated so reports use the applicable rate for each entry's date.
- Rates are stored as integer minor units.
- Displayed billable totals aggregate tracked seconds before rounding; exported per-entry billable amounts are rounded individually, and invoice amounts are rounded per completed invoice line. Different currencies remain separate; Reports exposes a currency selector for billable charts when needed and converts mixed-currency amounts by day using locally cached [Frankfurter](https://frankfurter.dev/) rates. Conversion requires a three-letter currency code or one of `$`, `€`, `£`, or `¥`; unsupported currency descriptions cannot be converted.
- Rates and calculated amounts stay in extension-local storage.
- A teammate's browser can use different rates for the same shared repository.
- Missing rates contribute zero and are identified in the report summary.

## Invoicing

### Create and preview

Create an invoice from the current filtered report, so the selected period, people, projects, and sources define what is billed. Each invoice uses one target currency. When effective-dated rates change within the period, Clockoli keeps the corresponding invoice lines separate; when the covered records use multiple currencies, it converts each entry using the exchange rate for that entry's date.

A partial report can still produce an invoice preview when rated entries are available, even though timesheet exports are disabled. Check that all intended time repositories loaded before printing or saving an invoice.

Clients can own projects, and picking a client narrows the invoice to that client's work without changing the report filters. Clockoli warns when an invoice also includes projects owned by another client.

The invoice dialog names the billing period from the Reports From/To range. Presets select This month, Last month, Last 7 days, or Last 30 days using the selected reporting date basis (local or UTC). The invoice is generated locally as a preview and can be printed or saved as PDF; CSV and JSON timesheets remain available on Reports when the report is complete. Unrated time remains visible as not billed. Invoice numbers are reserved only on the first Print / Save as PDF action for a preview and are never committed to the time-data repository. The counter only ever moves forward: neither a settings save nor restoring an older settings backup can lower it below a number that has already been issued.

### Invoice settings and payment terms

Saving rates or invoicing keeps stored clients even when their metadata is empty. New client cards are omitted only while empty and untouched, and only if neither a named project nor the main project selects them.

Add up to 20 additional lines for charges or discounts in the invoice currency. These amounts are included in the subtotal and taxed, without exchange-rate conversion. Payment terms (days) in Settings determines the due date from the issue date; zero means due on receipt.

Older text terms recognize “due on receipt” and “on receipt” without regard to case as zero days, then prefer the number following “net” (so “2% 10, Net 30” means 30 days). Otherwise they use a sole number or default to 30, clamped to 0–365. Unless the original text is exactly “Net {N}” for the resulting days or a due-on-receipt phrase, it is preserved as a separate “Payment terms: ” line in Notes without duplicating an existing exact line. If adding it would exceed the 1,000-character notes limit, existing notes remain unchanged. Notes supports line breaks. These settings and invoice details stay in the browser.

Version 1 does not support retainers, recurring invoices, reminders, payment links, tracked-time line editing, sent or paid status, an invoice archive, or emailing invoices.

## Time repositories, projects, and personal branches

Clockoli can validate and add several dedicated private personal or organization repositories. For newly configured destinations, each user writes routine timer data to a marked branch named:

```text
clockoli/users/{stable-github-user-id}
```

This keeps users' normal timer commits off each repository's default branch and reduces write conflicts between team members. Reports discovers work records only from marked `clockoli/users/` personal branches; each default branch stores shared repository metadata.

An existing configuration can temporarily retain its prior storage branch while active or pending work prevents a safe transition to the personal branch.

Projects are ordered case-insensitive URL-substring rules. The first match routes a new Start to that project's chosen destination; an explicit default destination handles unmatched URLs. PAT compatibility mode supports exactly one destination.

See [Data, privacy, and security](data-and-privacy.md#data-format-v1) for file formats and the per-task index used for shared task totals, and [GitHub permissions](data-and-privacy.md#github-permissions) for access details.

## Synchronization and offline mutations

Start, Stop, and task switches are accepted durably in extension-local state, then synchronized with GitHub asynchronously. For a Stop or switch, completion reconciliation proceeds in this order:

1. Clockoli records a stable pending completion in extension-local IndexedDB.
2. It appends or verifies the intended monthly record with SHA protection.
3. It advances the retry stage locally.
4. It removes only the matching active file.
5. It preserves a newer timer written by another browser or device.

Queued writes are pushed automatically after **15 seconds without any new local changes**, with no manual Sync action. A new edit resets the countdown, including successive edits coalesced into an existing queued operation. The deadline is reconstructed from the persisted IndexedDB queue when the service worker restarts. Chrome may terminate the background worker: a durable one-shot alarm and the periodic one-minute alarm provide recovery, but installed Chrome extensions limit alarms to a minimum of about 30 seconds and may delay them further. Thus 15 seconds is the target when the worker remains active, not an exact deadline. Ordinary consecutive completed-record edits are combined into one atomic Git commit per eligible batch. Each completed timer receives its own `time: <user> tracked <duration> on <owner>/<repo>#<number>` commit for GitHub issue/PR history linking. Ordering barriers such as Starts, Stops and cross-repository switches remain distinct for conflict-safe reconciliation.

Independently, a silent background pull checks connected personal branches at startup and about once per minute. Remote active and recent time records are cached locally without opening the panel, showing loading indicators, or rerendering an active editor. Local work waiting to sync is never replaced by an incoming snapshot. An unchanged branch or a failed pull leaves the visible UI alone; the next normal state read observes the newest successfully cached data. Larger history views and other participants' records are still loaded on demand.

If GitHub is temporarily unreachable, the panel can show that the completion is saved locally and waiting to sync. Do not clear local configuration while work is pending.

Activity's Timeline and Calendar also merge the still-pending local IndexedDB operations over the remote history on every load, so a page reload before the minute GitHub push shows the newly edited interval, not the old GitHub version. A queued deletion, Stop, or move across date boundaries is reflected in its correct range. A freshly edited Timeline interval is persisted in IndexedDB before the edit is acknowledged. Reloading the page while GitHub is still catching up shows that local interval, not an older GitHub version. Remote reads that race with a newer local mutation cannot replace the accepted cache. Timeline reconciliation preserves the current time viewport even when virtualized rows are briefly empty.

## Conflict handling

Clockoli checks repository identity, branch routing, file SHA, and original record content before mutation.

- A stale monthly file is not silently overwritten.
- Concurrent Stops converge only when Clockoli can prove the existing completion matches the timer.
- A changed active timer is preserved.
- A missing active timer with no matching completion is reported separately from a saved completion/newer-timer conflict.
- Multi-file edits publish one Git commit after all files pass preflight.
- Malformed remote text produces a visible error instead of being partially ignored.

## Settings backup and connection controls

### Backup

For configured multi-repository routing, the version 6 settings export contains display preferences, local billing, credential-free destination references, the exported default destination, and project routing. The non-routing export path uses version 7. The Activity view and interface width preferences stay on this browser and are not included in the settings backup. Settings exports exclude secrets and time data, including active timers and pending writes; see [Settings backup exclusions](data-and-privacy.md#settings-backup-exclusions). Import restores routes to destinations already configured in this browser and reports missing repositories and their routes as not restored; other eligible routes can still be restored. References remain unverified, and import does not replace this browser's current default, add destinations, or reconnect repositories.

### Connection actions

- **Time repositories** adds validated destinations without deleting records in existing repositories.
- **Projects and routing** changes where future Starts go; it does not redirect active or queued work.
- **Merge tasks** lists tracked tasks from the chosen time repository, people, and period. An imported `owner/project/task-slug` identity can be selected as the task to replace; the replacement must be an already-tracked HTTP(S) URL in that selection. Search by title or identity in the left list, choose the URL task on the right, then review and submit the merge list. Use **All time** if the imported entry falls outside the default last 30 days. The merge rewrites matching records in the selected period and preserves their prior identities in record history.
- **Disconnect this browser** removes local sign-in while leaving GitHub authorization and repository data unchanged.
- **Revoke Clockoli authorization on GitHub** opens GitHub's authorization settings. It does not uninstall the App or delete data.
- **Clear local configuration** removes local Clockoli credentials and settings. Stop active work and synchronize pending writes first.

## Deliberate limits

The current beta includes manual completed-entry creation through the Activity bulk importer. It does not include reminders, mobile applications, or a side-by-side conflict diff editor. Firefox and Safari builds ship as release files and are not yet listed in their browser stores. Data-repository administrators can rewrite Git history, so Git history is inspectable and recoverable but not tamper-proof against administrators.
