# Troubleshooting

If Clockoli cannot load or save your time, **do not clear extension data or uninstall it while changes are waiting to sync**. Those changes may exist only in your browser.

## Installation

### The extension or GitHub stopwatch is missing

Check that Clockoli is enabled, then refresh the GitHub page. The in-page stopwatch appears on `github.com`; on other HTTP(S) sites, use the browser toolbar icon. Internal browser pages such as `chrome://` cannot be tracked.

For an unpacked extension, update the files, open `chrome://extensions`, select **Reload**, and refresh existing GitHub tabs. To install from a ZIP, extract it first and select the folder containing `manifest.json`.

See [Install Clockoli](install.md) for Firefox and Safari instructions.

## GitHub connection

### GitHub sign-in expired

In Settings, select **Sign in again with GitHub** and complete the new one-time code. Signing in to the GitHub website alone does not renew Clockoli's authorization.

Use the **same GitHub account**. Do not clear browser data or sign out to fix a temporary authorization failure; that can put queued work at risk.

### My repository is missing or cannot be checked

Enter its full GitHub URL or `owner/name` and select **Check**. Autocomplete shows only repositories already granted to the Clockoli App, after you type at least two characters.

Check that the repository is private, not archived, and writable by your account. The Clockoli App also needs **Contents: Read and write** access. Organization approval or branch rules may prevent access.

If Clockoli offers **Grant access**, select it, choose **Only select repositories** on GitHub, grant the intended repository, and return to Settings. Select **Check** again if the new permission has not appeared.

A repository labeled **Ready — not connected** still requires **Connect repository**. Other offered actions, such as **Initialize repository** or **Join repository**, require your confirmation and may write setup files. See [Time repositories](time-data-repository.md#connect-a-repository).

### I cannot initialize an organization repository

Ask an administrator to initialize it and give you write access. Then use **Join a team**, check the repository, and confirm the offered join action. Organization initialization requires GitHub repository-admin permission.

### Finish setup is disabled

Complete any pending GitHub authorization and select a usable connected default time repository. If authorization replacement is blocked, follow the account-level error before trying again.

### PAT setup fails

Use a fine-grained token for the correct private repository with **Contents: Read and write**. Check the repository and branch name, account, and organization policy. Never share a token in an issue or screenshot.

## Tracking

### I cannot start a timer

Finish setup first. The page must use HTTP(S), and another unresolved tracking operation can block a new Start. If a task is already running, select **Switch to this task**.

### A timer ran for too long

Clockoli asks for confirmation before saving time over 12 hours. Check the duration, correct the start if needed, then save.

### A task is missing or has no title

In **Top tasks**, check the period and search. Titles are optional; GitHub metadata may be unavailable even when the URL can still be tracked.

## Synchronization and conflicts

### Activity cannot reach GitHub

Check connectivity and GitHub access, then select **Retry**. The local timer and queued edits remain available while GitHub reads fail. Rate limits and request timeouts are reported separately.

### A stopped entry is waiting to sync

Clockoli has saved the Stop locally, but GitHub has not accepted it yet.

1. Keep the extension installed and its browser data intact.
2. Restore connectivity or repository access.
3. Allow the automatic background retry. There is no manual Sync button.
4. If Activity reports a conflict, select **Review sync issues**.

A cross-repository task switch may wait for the earlier Stop to finish before the new Start reaches GitHub.

### Sync keeps failing or an entry overlaps another

Open **Activity → Review sync issues**. Check the saved GitHub entry or active timer against the pending change. Use the offered **Retry** or edit action; discard only after confirming that you no longer need the queued time.

Common causes include changed GitHub permissions, branch rules, a renamed repository, a file changed on another device, or overlapping time.

Overlaps are real intersections in time; intervals that only touch at one endpoint are allowed. A running timer can overlap a completed entry even when the two track the same task.

For complex pending Start/Stop conflicts and exact recovery actions, see [Advanced sync recovery](sync-recovery.md). For the general model, see [Sync and offline work](sync.md).

## Editing time

### Changing one row changed a neighboring row

In Activity List, moving a Start into the previous entry or an End into the next entry can move that neighboring boundary too. Review the preview before selecting **Save time**, or select **Cancel**.

### An edit or deletion says the record changed

Refresh Activity and review the latest entry. Clockoli refuses to apply an edit or delete to a stale GitHub record.

### Timeline or Calendar cannot display a week

Existing overlapping entries may make the view unreadable. Select **Go to List**, correct the intervals, and refresh. Do not assume the entries are missing.

### A manually changed GitHub file cannot be read

Check that its JSONL records are valid, IDs are unique, timestamps and monthly paths agree, and `.clockoli/tasks.json` matches the completed records. Use [Data format v1](data-format-v1.md) and Git history to repair it.

## Reports and billing

### A report is empty or incomplete

Check the date range, People, Projects, Sources, and Time repositories filters. Reports includes entries by their **Start date**. If a repository could not be read, the result is partial and exports are disabled. Try a shorter period if Clockoli reports a read limit.

### Billable amount is missing

In **Settings → Billable rates**, select the correct client, add rates for the relevant GitHub users, and check each rate's effective dates. In Reports, check **Calculate amounts using**. Rates belong to clients and are stored only in this browser.

### Exports or invoice output are disabled

Reload Reports after data or settings change, and resolve pending writes or incomplete repository reads. Clockoli blocks final output when it cannot verify that the selected data is complete.

## Clockify migration

### Import controls are missing

Enable Clockify migration under **Settings → Add-ons**, approve the optional permission, and refresh an open authenticated Clockify **Detailed Report** tab.

### CSV capture cannot finish

Clockify may offer email delivery instead of a direct CSV export. After repeated email-only responses, Clockoli suggests **Page to page migration**. Start that option from the Detailed Report tab rather than trying to upload a separate CSV.

### The preview expired or an import was interrupted

Previews expire after an hour. Re-capture the report if a preview was never confirmed. If an import was already started, reopen its preview to review saved progress and per-person outcomes before attempting another import.

**Already present** means no duplicate write was needed. An import paused by a GitHub rate limit retries automatically. If your GitHub identity or repository changed, restore the original connection or use **Edit GitHub mappings** from the saved job when offered. Do not clear extension data while an import is pending.

See [Clockify migration](add-ons.md#clockify-migration).

## Settings and data safety

### A settings import did not reconnect GitHub

This is expected. Backups exclude tokens, running timers, pending writes, and tracked time. Import restores supported preferences and routes only for repositories already connected in this browser. Reconnect GitHub separately if needed.

### I want to disconnect or clear data

**Disconnect repository** removes the local connection, not its GitHub records. **Sign out on this browser** does not revoke the GitHub authorization. **Clear all local Clockoli data** removes unsynced work as well as local settings and credentials; use it only after confirming everything has synchronized.

## Report a bug

Include the browser and Clockoli version, where the problem happened, the exact error, and whether any time was still pending. You may include a redacted repository path or Git commit SHA.

**Never include** access tokens, device codes, authorization headers, or private settings backups.
