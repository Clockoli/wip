# Advanced sync recovery

This reference describes how Clockoli checks queued additions against GitHub and how to recover from an overlapping timer or incomplete save. Most users should start with [Troubleshooting](troubleshooting.md#synchronization-and-conflicts).

**Do not clear extension data or discard pending changes until you have verified that the time is saved elsewhere.** Local changes may not yet exist in GitHub.

## How queued additions are checked at sync

During background synchronization, completed additions validate the original start date's monthly file, the preceding day's partition and, if the interval crosses a month boundary, the end date's monthly file, plus the active timer; the monthly JSONL and task index update atomically. A queued addition remains valid for synchronization after midnight or a timezone change: its accepted entryDate and timezone are preserved. Running timers validate and guard the start and preceding day's files at sync.

Remote overlap and concurrent repository changes are rejected or retained as actionable conflicts; accepted local work is never discarded silently. A conflicted running timer remains visible at the top of Activity, but its unsaved start is not a completed entry in the list. When that timer has since been stopped locally, **Review sync issues** shows two List-style records: the earlier entry and the stopped entry marked **Pending · saved in this browser**. The overlap and both records display browser-local dates and **HH:MM**, not seconds; the original stored instants still determine whether they overlap. Any still-pending edit of the earlier entry is labeled separately, so Activity's optimistic time is not mistaken for the saved time.

The icon-only **Edit** controls open a minute-based form with only one editable field: the previous entry's End or the stopped entry's Start. The unchanged boundary and date are not displayed as inactive inputs. A changed Start uses `:01.000` and a changed End uses `:00.000`; the unchanged boundary keeps its exact stored timestamp. When the earlier record has not yet been checked on GitHub, the editor opens, but Save still requires a fresh privileged GitHub check and leaves pending work intact on failure. A queued full-form edit that repeats the original task and description is treated as an end-only edit when those fields are unchanged. For the supported Start → Stop → pending previous-end edit queue, recovery checks fresh GitHub data before saving, retains the local start and stop, and refuses unsupported queue shapes or competing remote changes.
Unlike ordinary Add time, resolving this overlap immediately synchronizes the repaired queue with GitHub after the guarded checks. Save displays an indeterminate progress bar and disables repeated submission while this remote work is in flight. The form closes after the worker confirms the repaired queue has drained; the Activity history refresh continues separately. An error keeps the form open for review and preserves recoverable local work.
**All queued changes** expands below the two overlap records, including the dependent stop and any other pending edits. Select one to inspect its own queued details; the overlap remains available in the list.

The same record actions as List also offer icon-only **Delete** with an explicit confirmation. Deleting the pending entry removes its queued Start and Stop together, including their tracked time; a fresh remote check must find neither a matching timer nor a completed record, and the independent earlier edit stays queued. Deleting the earlier GitHub record first queues a guarded remote deletion; only after GitHub confirms it are its dependent queued edit removed and the pending timer retried. If that edit changed during deletion, its newer version remains visible as a separate conflict while the timer can still sync. Failed checks and remote conflicts retain recoverable work for review instead of silently discarding it. Keep extension data until Activity confirms the result.

When the start is the last queued change and the timer is still running, **Start after previous entry** checks GitHub and aligns it to the exact end of the one completed entry already running at its start, preserving the timer ID and time since that end; the overlapping seconds are excluded. If a later change is queued, there is another completed interval or remote timer, a read is unavailable, or GitHub changes meanwhile, the queued data remains for review rather than being silently rewritten. Recheck can adopt a timer already running remotely. **Discard queued start** is destructive: it removes the local timer and its unsaved tracked time, only after an online GitHub check confirms that timer is not running there. The dialog does not offer discard while later local changes depend on that start.


## Related guides

- [Add and edit time](editing-time.md) — normal editing and adding workflows
- [Sync and offline work](sync.md) — background syncing, retry, and conflict behavior
- [Troubleshooting](troubleshooting.md#synchronization-and-conflicts) — symptoms and first recovery steps
