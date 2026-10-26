# Add and edit time

Add time you forgot to track, correct or delete completed entries, and change when a running timer started.

Every change is saved locally first and synchronized with GitHub in the background, so edits appear immediately.

## Add a single entry

The **Add time** button next to the page tabs on **Top tasks** and **Activity** adds a **single** time entry; it is not available in the toolbar panel.

1. Search completed history by task title or identity, including imported tasks without an HTTP(S) URL, or paste a new HTTP(S) task URL.
2. Choose Start and optional End as keyboard-editable local times, followed by one native Date picker for the start day. Clicking either time field selects its entire current value for immediate replacement. Enter `1000`, Tab, `1200` for 10:00–12:00; leaving either field formats four digits as `HH:MM`.
3. Add an optional description and choose **Add**.

Rules for the interval:

- If End is earlier than Start, it falls on the next calendar day.
- Start defaults to the current local minute each time the dialog opens; End starts empty. An empty Start uses now when End is also empty; an empty End starts a running timer.
- A single Add time interval may be at most 24 hours (exactly 24 is allowed); split longer work into separate entries.
- Running timers started through Add time must be no more than 24 hours old at creation; a timer that continues beyond 24 hours is not automatically stopped.
- Future timestamps are rejected.

Search loads history on demand without writing. Imported identities must already exist in the selected time repository's task index; arbitrary new imported identities are rejected. URL tasks use [project routing](projects-and-routing.md); selected imported tasks use their existing time repository. Adding time never silently stops a running timer in another repository.

After Add, the dialog closes as soon as the change has been durably accepted in local extension storage, without a GitHub-saving spinner or page reload. GitHub synchronization is silent and is scheduled after 15 seconds without local changes. Known local intervals and the current timer are checked for overlap immediately.

### How a queued addition is checked at sync

During background synchronization, completed additions validate the original start date's monthly file, the preceding day's partition and, if the interval crosses a month boundary, the end date's monthly file, plus the active timer; the monthly JSONL and task index update atomically. A queued addition remains valid for synchronization after midnight or a timezone change: its accepted entryDate and timezone are preserved. Running timers validate and guard the start and preceding day's files at sync.

Remote overlap and concurrent repository changes are rejected or retained as actionable conflicts; accepted local work is never discarded silently. If those files change before a queued start syncs, the conflict offers rechecking for overlap and retrying, or explicitly discarding the unsaved start; retries never silently bypass changed files. Discard requires an online GitHub check and refuses to remove a start already running remotely; retry adopts that running timer instead. An unavailable check leaves the conflict in place and shows an error.

## Add many entries at once

The expandable **Bulk time adding** section on Activity is separate from the single-entry **Add time** button. It accepts one dated URL task per line with an optional description and a duration. Example lines remain visible above the editor as you type.

A valid batch is accepted **atomically into local IndexedDB** and its entries appear in Activity immediately; GitHub receives the entire batch through the same shared queue after 15 seconds of inactivity. The local preview places intervals after the available cached activity, while the delayed GitHub commit validates the complete repository history, including intervals that cross in from older monthly files and a concurrently started active timer, and may adjust the exact start times if older intervals were not in the local cache. Stable IDs are retained, and every affected monthly file and the task index are committed atomically.

If the batch cannot fit or overlaps another device's work, it stays locally stored and an actionable error offers retry or a verified discard, never a partial remote import. A failed request writes nothing remotely and keeps the draft available for correction. On success or failure, a dismissible notification stays visible in the viewport even when the page is scrolled. Editing a new draft clears the previous notification; a failed submission preserves the entered text.

## Edit a completed entry

**Edit time** opens the same task/date/time/optional-description form used by **Add time**, prefilled with the selected completed record, without a duplicate task-title field. It is available from Activity List and from **Edit** in Timeline or Calendar details in Activity, the toolbar popup, and the GitHub-page panel.

- Editing the same task preserves its title; selecting another task uses its title, while a newly pasted URL has no title.
- The one Date picker shows the entry's start day; changing it retains the two time-of-day fields. End is on that day unless its time is earlier than Start, in which case it is on the following day.
- Editing only Start keeps the original End date, time, and seconds while Start remains before End.
- An unchanged range preserves the original timestamps, including seconds.
- Existing zero-duration or longer-than-24-hour records remain editable without changing their times; an interval changed to exceed 24 hours is rejected rather than shortened.
- Cancel does not mutate the record.
- Escape closes the form on the first press, including when the Task search field is focused; it does not save the draft or close the underlying panel.

You can also drag and resize entries in Timeline and Calendar; see [Move and resize entries](activity.md#move-and-resize-entries).

## Correct times inline

Each completed row in the panel and in Activity List has one compact `HH : MM - HH : MM` range. The four hour/minute values stay on one line; their accessible Start and Stop labels remain available to assistive technology. The underlying Start and Stop fields preserve each timestamp's stored timezone offset.

- Type an hour or minute directly in the always-visible Start/Stop inputs.
- Wheel and trackpad gestures never mutate time values or trap panel scrolling, and there are no `−`/`+` step controls.
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
