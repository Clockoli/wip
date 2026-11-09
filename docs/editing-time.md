# Add and edit time

Add time you forgot to track, correct or delete completed entries, and change when a running timer started.

Every change is saved locally first and synchronized with GitHub in the background, so edits appear immediately.

## Add a single entry

The **Add time** button in the upper right of **Top tasks** and **Activity** adds one entry or entries for multiple selected days.

1. Search tracked tasks with HTTP(S) URL identities from joined people in the connected time repositories by title or URL, or paste a new HTTP(S) task URL.
2. Choose the Start date and time, and optionally an End date and time. Each has its own native date picker and keyboard-editable `HH:MM` time field. Clicking a time field selects its current value, and entering `1000` formats it as `10:00`. The End date is disabled until an End time is entered.
3. Add an optional description. The form previews the duration for a completed interval; choose **Add time** to record it, or leave End empty and choose **Start timer**. The **Multiple days** checkbox retains its separate calendar-based flow and **Add** button.

Rules for the interval:

- End date initially matches Start date. If End time is earlier than Start time, End date automatically advances to the next day; otherwise it follows Start date. An explicitly chosen End date is respected instead, and the final interval is validated without silently changing that choice.
- Start displays the current local minute each time the dialog opens; End starts empty. With End empty and the displayed Start time and date untouched, **Start timer** starts at the actual submission time, including seconds. An empty Start also uses now when End is empty. An explicitly edited Start uses the selected minute (at `:00` seconds), even if it matches the displayed minute.
- A single Add time interval may be at most 24 hours (exactly 24 is allowed); split longer work into separate entries.
- Running timers started through Add time must be no more than 24 hours old at creation; a timer that continues beyond 24 hours is not automatically stopped.
- Future timestamps are rejected.

Imported identities must already exist in a verified person's task index in the selected time repository; arbitrary new imported identities are rejected. URL tasks use [project routing](projects-and-routing.md); selected imported tasks remain bound to their chosen time repository. Adding time never silently stops a running timer in another repository.

### Multiple days (for time off)

1. Choose the tracked task (for example, **Time off**) in the Task search.
2. Select **Multiple days**. The calendar appears on the left, with **Hours per day** and **Description** on the right; on narrow screens these controls stack below the calendar. Use the month arrows and click the days you want, including nonconsecutive days; click a selected day again to remove it. No Start or End time is needed. Selected days must fit within a 500-calendar-day span and cannot be in the future.
3. Enter **Hours per day** from 0 to 24 (for example, 8). Enter 0 explicitly to add a zero-hour record for each selected day; these records do not increase tracked-hour totals or invoices. The field cannot be left empty. Choose **Add**.

Each selected day becomes a separate completed record with its own identity and date, starting at 09:00 local time. For example, 8 hours runs from 09:00 to 17:00; 24 hours extends into the following day. If that interval overlaps existing time or the running timer, the error names the selected date and no part of the batch is accepted locally. A current-day interval must already be over. The complete batch is accepted into the durable local queue together and later checked against GitHub history, the running timer, and other writes before one atomic commit across the affected monthly files and task index. A remote overlap remains recoverable as a sync conflict rather than losing any accepted entries. Zero-hour records start at 09:00 but add no tracked duration.

### Search for a task

Clockoli builds an extension-local IndexedDB catalog from each person's Git-backed task index. After a completed record (including a Stop) synchronizes, it refreshes the other personal indexes and rebuilds the catalog without writing to their branches. A catalog hit needs no GitHub request. A miss against a complete catalog refreshed in the last minute also returns locally; older misses recheck GitHub before reporting no match. The first search on a new device builds the catalog. A repository-wide REST branch listing provides each personal branch's commit SHA: unchanged branches reuse their verified index without additional GitHub requests, while changed branches read their index pinned to the discovered commit. The IndexedDB report cache survives service-worker restarts. A task index without a title snapshot does not cause a monthly-history scan during search. Search is bounded and may show partial results when a repository cannot be read; it does not silently claim that an incomplete catalog is exhaustive.

Only tasks with a valid HTTP(S) URL identity and a nonempty title appear in ordinary search suggestions, including when a cached index or pending write contains an imported identity. Untitled tasks and time records stay in their personal indexes and Activity, and a pasted HTTP(S) URL can still create a task without a title. Existing imported non-URL records remain editable and usable from their original entry or unfiltered Top tasks row; they are not offered as normal search results. While the Task field searches, it shows a spinner and **Searching tasks…**; a pasted URL remains usable if lookup fails.

After Add, the dialog closes as soon as the change has been durably accepted in local extension storage, without a GitHub-saving spinner or page reload. GitHub synchronization is silent and is scheduled after 15 seconds without local changes. Known local intervals and the current timer are checked for overlap immediately.

### How a queued addition is checked at sync

During background synchronization, completed additions validate the original start date's monthly file, the preceding day's partition and, if the interval crosses a month boundary, the end date's monthly file, plus the active timer; the monthly JSONL and task index update atomically. A queued addition remains valid for synchronization after midnight or a timezone change: its accepted entryDate and timezone are preserved. Running timers validate and guard the start and preceding day's files at sync.

Remote overlap and concurrent repository changes are rejected or retained as actionable conflicts; accepted local work is never discarded silently. A conflicted running timer remains visible at the top of Activity, but its unsaved start is not a completed entry in the list. When that timer has since been stopped locally, **Review sync issues** shows two List-style records: the earlier entry and the stopped entry marked **Pending**. The overlap and both records display browser-local dates and **HH:MM**, not seconds; the original stored instants still determine whether they overlap. Any still-pending edit of the earlier entry is labeled separately, so Activity's optimistic time is not mistaken for the saved time.

The icon-only **Edit** controls open a minute-based form with only one editable field: the previous entry's End or the stopped entry's Start. The unchanged boundary and date are not displayed as inactive inputs. A changed Start uses `:01.000` and a changed End uses `:00.000`; the unchanged boundary keeps its exact stored timestamp. When the earlier record has not yet been checked on GitHub, the editor opens, but Save still requires a fresh privileged GitHub check and leaves pending work intact on failure. A queued full-form edit that repeats the original task and description is treated as an end-only edit when those fields are unchanged. For the supported Start → Stop → pending previous-end edit queue, recovery checks fresh GitHub data before saving, retains the local start and stop, and refuses unsupported queue shapes or competing remote changes.
Unlike ordinary Add time, resolving this overlap immediately synchronizes the repaired queue with GitHub after the guarded checks. Save displays an indeterminate progress bar and disables repeated submission while this remote work is in flight. The form closes after the worker confirms the repaired queue has drained; the Activity history refresh continues separately. An error keeps the form open for review and preserves recoverable local work.
**All queued changes** expands below the two overlap records, including the dependent stop and any other pending edits. Select one to inspect its own queued details; the overlap remains available in the list.

The same record actions as List also offer icon-only **Delete** with an explicit confirmation. Deleting **Pending** removes its queued Start and Stop together, including their tracked time; a fresh remote check must find neither a matching timer nor a completed record, and the independent earlier edit stays queued. Deleting the earlier GitHub record first queues a guarded remote deletion; only after GitHub confirms it are its dependent queued edit removed and the pending timer retried. If that edit changed during deletion, its newer version remains visible as a separate conflict while the timer can still sync. Failed checks and remote conflicts retain recoverable work for review instead of silently discarding it. Keep extension data until Activity confirms the result.

When the start is the last queued change and the timer is still running, **Start after previous entry** checks GitHub and aligns it to the exact end of the one completed entry already running at its start, preserving the timer ID and time since that end; the overlapping seconds are excluded. If a later change is queued, there is another completed interval or remote timer, a read is unavailable, or GitHub changes meanwhile, the queued data remains for review rather than being silently rewritten. Recheck can adopt a timer already running remotely. **Discard queued start** is destructive: it removes the local timer and its unsaved tracked time, only after an online GitHub check confirms that timer is not running there. The dialog does not offer discard while later local changes depend on that start.

## Add many entries at once

The expandable **Bulk time adding** section on Activity is separate from the single-entry **Add time** button. It accepts one dated URL task per line with an optional description and a duration. Example lines remain visible above the editor as you type.

A valid batch is accepted **atomically into local IndexedDB** and its entries appear in Activity immediately; GitHub receives the entire batch through the same shared queue after 15 seconds of inactivity. The local preview places intervals after the available cached activity, while the delayed GitHub commit validates the complete repository history, including intervals that cross in from older monthly files and a concurrently started active timer, and may adjust the exact start times if older intervals were not in the local cache. Stable IDs are retained, and every affected monthly file and the task index are committed atomically.

If the batch cannot fit or overlaps another device's work, it stays locally stored and an actionable error offers retry or a verified discard, never a partial remote import. A failed request writes nothing remotely and keeps the draft available for correction. On success or failure, a dismissible notification stays visible in the viewport even when the page is scrolled. Editing a new draft clears the previous notification; a failed submission preserves the entered text.

## Edit a completed entry

**Edit time** opens the same task/date/time/optional-description form used by **Add time**, prefilled with the selected completed record, without a duplicate task-title field. It is available from Activity List and from **Edit** in Activity's Timeline or Calendar details.

- Editing the same task preserves its title; selecting another task uses its title, while a newly pasted URL has no title.
- Regular task search excludes imported non-URL identities. An existing imported task can still be retained when editing its own entry; the specialized GitHub entry editor can resolve a verified imported replacement from the same time repository, and Clockoli checks that identity before queuing and synchronizing. Imported identities cannot silently move an entry between repositories.
- Start date/time and End date/time are shown separately. The End date initially reflects the existing record (including overnight entries). Changing the End date explicitly allows choosing a different day; the 24-hour limit still applies when changing a completed interval.
- Editing Start date or time moves End by the same amount, preserving the interval's exact duration (including seconds and overnight dates). Editing End time or its date alone keeps Start unchanged.
- An unchanged range preserves the original timestamps, including seconds.
- Existing zero-duration or longer-than-24-hour records remain editable without changing their times; an interval changed to exceed 24 hours is rejected rather than shortened.
- Cancel does not mutate the record.
- Escape closes the form on the first press, including when the Task search field is focused; it does not save the draft or close Activity.

You can also drag and resize entries in Timeline and Calendar; see [Move and resize entries](activity.md#move-and-resize-entries).

## Correct times inline

Each completed row in Activity List has one compact `HH : MM - HH : MM` range. The four hour/minute values stay on one line; their accessible Start and Stop labels remain available to assistive technology. The underlying Start and Stop fields preserve each timestamp's stored timezone offset.

- Type an hour or minute directly in the always-visible Start/Stop inputs. Changing Start moves Stop by the same amount and preserves the duration; changing Stop alone leaves Start fixed.
- Wheel and trackpad gestures never mutate time values or trap page scrolling, and there are no `−`/`+` step controls.
- A direct correction remains a local draft until **Save time** is selected; **Cancel** discards it.
- All relevant row controls are disabled while a mutation is in flight.
- Validation or network errors keep the draft available for correction or retry.

### Adjacent entries move together

If the edited Start moves before the previous interval's Stop, the previous Stop moves to the new Start. If the edited Stop moves after the next interval's Start, the next Start moves to the new Stop. All touched records are preflighted and saved together. Cross-month changes use one atomic Git commit.

Strict intersections that still remain are highlighted as **Overlaps another entry**. Entries that only touch at one endpoint are not overlaps.

### Edit the URL, title, or description

Selecting the displayed URL, title, or description expands those fields in the same inline draft as Start and Stop. Press Enter or select **Save time** to save:

- task URL;
- optional title, up to 300 characters;
- Start and Stop date/time;
- description, up to 2,000 characters.

Only one draft is active at a time. Starting another edit cancels the previous unsaved draft. A linked adjacent-boundary group remains available while the Activity URL/title filter changes. Changing the URL clears an unchanged old title so metadata from one task is not silently carried to another.

## Delete an entry

**Delete** requires confirmation and uses the loaded file version and original record content to avoid deleting the wrong entry after another edit. The local view updates immediately. Git history retains the previous file version unless a repository administrator rewrites history.

## Edit a running timer's start

The **Edit** action on a running timer in Timeline or Calendar opens **Edit timer start**. Only its Start time and Date can be changed in this form; End, task, and description are not editable there. A running timer is not capped at 24 hours by this edit. An unchanged time retains its original seconds.

Moving the start or date checks completed records, including locally queued changes and older intervals that cross a month boundary, before accepting the edit. An overlap or unreadable history leaves the timer unchanged and keeps the form open. At synchronization, remote intervals are checked again and the active file is written with guards against concurrent monthly-file changes; a race remains an actionable conflict rather than silently overwriting time.

For a quick time-only change, use the inline **Start** in the running-status strip; see [Change the running start](tracking.md#change-the-running-start).

## Overlap checks

Changing a completed entry's time checks the destination against completed records across weeks and monthly files, pending local edits, and the current running timer on GitHub as well as any locally pending timer before accepting the edit. Overlapping intervals are rejected immediately; the original entry stays in place. Endpoints that only touch are allowed. If the destination or timer cannot be checked, the edit is not queued. Changes made concurrently in GitHub remain subject to the repository's conflict checks during synchronization.

## Merge duplicate tasks

When the same work was tracked under two identities, such as an imported Clockify task and its GitHub issue URL, use **Merge tasks** in Settings. See [Merge tasks](settings.md#merge-tasks).

## Quick description editing in Calendar and Timeline

Hover a time entry in Activity's Calendar or Timeline to open its compact details card. The description field is always available, even when empty (with the **Add description...** placeholder). Enter saves, Shift+Enter inserts a newline, Escape cancels an unsaved edit, and leaving the field saves it. The details card stays open while the description is being edited.

**Track again** is the main action; **Edit** and **Delete** are separate visible icon buttons with tooltips.
