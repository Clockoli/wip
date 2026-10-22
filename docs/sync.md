# Sync and offline work

Clockoli saves every change in your browser first and sends it to GitHub in the background, so you can keep working offline.

You can keep tracking and editing while GitHub is slow or unreachable; nothing waits for a spinner. Conflicting changes are never silently overwritten.

## What is saved locally first

Start, Stop, task switches, single completed **Add time**, **Bulk time adding**, and completed-entry edits and deletes are accepted durably in extension-local state, then synchronized with GitHub asynchronously through the same queue. Merge tasks intentionally remains a separate, explicit GitHub operation.

## When changes reach GitHub

Queued writes are pushed automatically after **15 seconds without any new local changes**, with no manual Sync action. A new edit resets the countdown, including successive edits coalesced into an existing queued operation. The deadline is reconstructed from the persisted IndexedDB queue when the service worker restarts.

Chrome may terminate the background worker: a durable one-shot alarm and the periodic one-minute alarm provide recovery, but installed Chrome extensions limit alarms to a minimum of about 30 seconds and may delay them further. Thus 15 seconds is the target when the worker remains active, not an exact deadline.

Ordinary consecutive completed-record edits are combined into one atomic Git commit per eligible batch. Each completed timer receives its own `time: <user> tracked <duration> on <owner>/<repo>#<number>` commit for GitHub issue/PR history linking. Ordering barriers such as Starts, Stops and cross-repository switches remain distinct for conflict-safe reconciliation.

### How a Stop is completed

For a Stop or switch, completion reconciliation proceeds in this order:

1. Clockoli records a stable pending completion in extension-local IndexedDB.
2. It appends or verifies the intended monthly record with SHA protection.
3. It advances the retry stage locally.
4. It removes only the matching active file.
5. It preserves a newer timer written by another browser or device.

## Receiving changes from other browsers

Independently, a silent background pull checks connected personal branches at startup and about once per minute. Remote active and recent time records are cached locally without opening the panel, showing loading indicators, or rerendering an active editor. Local work waiting to sync is never replaced by an incoming snapshot. An unchanged branch or a failed pull leaves the visible UI alone; the next normal state read observes the newest successfully cached data. Larger history views and other participants' records are still loaded on demand.

## Offline and reloads

If GitHub is temporarily unreachable, accepted changes remain visible locally and retry silently. Routine synchronization is not shown in the tracker UI; actionable conflicts and failures still surface so data is not silently lost.

Activity's Timeline and Calendar merge the still-pending local IndexedDB operations over the remote history on every load, so a page reload before the GitHub push shows the newly edited interval, not the old GitHub version. A queued deletion, Stop, or move across date boundaries is reflected in its correct range. A freshly edited Timeline interval is persisted in IndexedDB before the edit is acknowledged. Remote reads that race with a newer local mutation cannot replace the accepted cache. Timeline reconciliation preserves the current time viewport even when virtualized rows are briefly empty.

Do not clear local Clockoli data or uninstall Clockoli while work is waiting to sync.

## Conflict handling

Clockoli checks repository identity, branch routing, file SHA, and original record content before mutation.

- A stale monthly file is not silently overwritten.
- Concurrent Stops converge only when Clockoli can prove the existing completion matches the timer.
- A changed active timer is preserved.
- A missing active timer with no matching completion is reported separately from a saved completion/newer-timer conflict.
- Multi-file edits publish one Git commit after all files pass preflight.
- Malformed remote text produces a visible error instead of being partially ignored.

A conflicted source completion can pause a dependent cross-repository Start until the conflict is resolved. Clockoli does not provide a side-by-side conflict editor; follow the action shown in the panel, and see [Synchronization and conflicts](troubleshooting.md#synchronization-and-conflicts) for recovery steps.
