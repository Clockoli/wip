# Troubleshooting

Fixes for common problems with installation, GitHub connection, tracking, sync, editing, reports, billing, and Clockify migration.

## Installation

### I cannot select the ZIP in Chrome

Extract the ZIP first. In `chrome://extensions`, choose **Load unpacked** and select the extracted directory that contains `manifest.json`.

### My unpacked extension did not update

Unpacked extensions have no automatic update channel.

1. Pull or replace the extension files.
2. Open `chrome://extensions`.
3. Select **Reload** on Clockoli.
4. Refresh open GitHub tabs.

### The GitHub stopwatch is missing

- Confirm Clockoli is enabled in `chrome://extensions`.
- Refresh the GitHub tab after installation or update.
- The injected control appears only on `https://github.com`.
- On any other HTTP(S) site, use the pinned toolbar popup.
- Internal browser pages such as `chrome://` pages cannot be tracked.

## GitHub connection

### Device activation completed, but setup did not advance

GitHub user authorization and GitHub App installation are separate.

1. Return to Clockoli Settings.
2. Use **Done on GitHub—check now** if automatic checking has not completed.
3. After sign-in, type a repository name in **Connect time repositories** to choose an App-granted suggestion, or paste a GitHub URL or `owner/name` and select **Check** (or press Enter).
4. Grant App access only if Clockoli reports that the target is missing or needs **Contents: Read and write**. Check a ready repository, then choose **Connect repository** and confirm separately. A replacement authorization is also confirmed automatically after Clockoli read-validates every configured destination; failures appear once at account level.

### My repository does not appear in suggestions

Suggestions show only repositories the Clockoli GitHub App can already access, and only after you type at least two characters. Enter the GitHub URL or `owner/name` in **Repository URL or owner/name** instead, then select **Check** (or press Enter). Use the same **Check** button to retry.

A missing private repository is not necessarily nonexistent: GitHub hides it when your account or the App lacks access. Before creating a replacement, check that:

- the name is spelled correctly;
- the repository is private;
- it is not archived or disabled;
- your user has write access;
- the Clockoli App installation includes it, with **Contents: Read and write**;
- an organization approval is not still pending.

Network errors are reported separately from missing App access, and Clockoli never silently substitutes another repository.

### Clockoli asks me to grant access

The checked repository is missing from the Clockoli GitHub App installation, or the App lacks Contents-write permission.

1. Select **Grant access**. If Clockoli knows the owner's existing App installation, this opens its settings; there is no need to install the App again.
2. Choose **Only select repositories** and add the intended repository. Ask its owner or organization administrator if you cannot change the grant.
3. Return to Settings. Clockoli checks the remembered repository after about one second, even if you closed the access dialog or reloaded Settings.
4. If GitHub has not exposed the grant yet, finish it on GitHub and return again, or select **Check** to retry manually.

### I do not have a time repository yet

Use **Create a new time repository** at the beginning of the repository section. After creating it on GitHub, copy its URL into the **New repository URL** dialog in Settings and select **Check repository**. Creating it does not grant App access, and checking does not connect or initialize it; review and confirm the offered action separately.

### A checked repository is ready but not connected

Discovery and inspection never write to GitHub or connect new repositories locally. After a ready check, choose **Connect repository** and confirm; Clockoli revalidates and registers it locally without changing repository files.

If Clockoli offers **Set up storage branch**, **Join repository**, or **Initialize repository** instead, read the privacy disclosure and **Repository writes**, then explicitly confirm the offered action. Even **Set up storage branch** may create or verify your personal storage branch. Invalid branch ownership or task-index data must be repaired before use.

### Check an edited repository target before connecting

Editing **Repository URL or owner/name** invalidates the previous selection and confirmation. Select **Check** (or press Enter) to inspect the edited target; leaving the field does not trigger a check. Resolve any displayed availability reason, then review and confirm the newly selected repository. Background discovery does not confirm writes for you.

### Finish setup is unavailable

**Finish setup** stays unavailable while authorization or the default repository is unresolved.

- Choose a usable connected repository in the separate **Default time repository** selector.
- If an account-level message says a new GitHub authorization is blocked, follow it. New or replacement authorization is accepted automatically only for the same GitHub identity after every configured repository passes read-only validation and no active or queued work could be stranded. There is no per-repository confirmation action.

Finishing stops background checks and clears the remembered target without writing to GitHub.

### Repository validation fails

Clockoli rejects unsafe destinations. Common causes are:

- public repository;
- missing user write permission;
- missing App Contents-write permission;
- incompatible `.clockoli`, `active`, or `times` content;
- a marker created by an unsupported format;
- branch rules or a ruleset that rejects direct writes;
- repository renamed/transferred or branch removed while setup was open.

Use a dedicated private repository with direct authenticated writes. Do not delete an existing marker or reserved content merely to bypass validation; inspect the reported incompatibility first.

### Organization approval is pending

An organization owner may need to approve the GitHub App installation or repository grant. Clockoli cannot bypass that policy. After approval, return to Settings; Clockoli rechecks a remembered target when its grant becomes available. Use the field's **Check** button to retry explicitly if needed.

### I cannot initialize an organization repository

Organization-owned repository initialization requires GitHub repository-admin permission, rechecked from fresh repository permissions before the confirmed write. A previously available initialization action does not preserve permission after it is revoked. If you are an ordinary teammate, ask a repository administrator to initialize the dedicated repository and send the generated setup instructions. Then choose it from autocomplete or enter its URL or `owner/name` and select **Check** (or press Enter). Review the offered action and explicitly confirm **Join repository**; joining works only when the repository already has a valid Clockoli marker.

### Fine-grained PAT setup fails

Confirm that the token:

- belongs to the same GitHub account you intend to use;
- is restricted to the configured private data repository;
- has **Contents: Read and write**;
- can read the exact owner/repository and branch;
- is permitted by organization SSO and policy.

Do not paste the token into issues, screenshots, logs, or documentation.

## Tracking

### Start is disabled

Start is unavailable when:

- setup is incomplete;
- the active tab is not HTTP(S);
- the requested Start cannot be safely ordered behind active or conflicted work.

Open the panel for details. Choose **Switch to this task** when another task is running. If the panel says a stopped entry is still waiting to sync, restore GitHub access and wait for the automatic retry, or resolve the conflict it shows.

### The panel says “Tracking another task”

The active timer's canonical URL differs from the page currently open. Select the active URL to return to it, or choose **Switch to this task**. Clockoli queues completion in the active timer's time repository before starting in the destination selected for the current URL.

### Start works on GitHub but not another site

The GitHub stopwatch is an injected convenience. For another site, pin and open Clockoli from the browser toolbar. The active page must use `http:` or `https:`.

### A GitHub notification link created unexpected task behavior

Clockoli canonicalizes GitHub issue/PR URLs by removing query strings and fragments. The stored task should be the base issue or pull-request URL. Generic non-GitHub query strings are preserved because they may identify different work.

### Start says the requested task URL does not match the current page

Clockoli checks the current tab URL, including after GitHub navigates between issues or pull requests without reloading the page. If the page changed again while you clicked Start, open the intended task and retry. After updating an unpacked extension, reload both Clockoli and the open GitHub tab to use the new code.

### A long timer asks for confirmation

Clockoli warns before saving an entry longer than 12 hours. This catches forgotten timers but does not reject them. Verify the duration, choose to save, or edit the time first.

## Synchronization and conflicts

### A stopped entry is still waiting to sync

Clockoli has preserved the Stop operation in extension-local storage but could not finish the GitHub write yet. Until it does, a new Start can report that the previous timer was saved locally but must sync first.

- Keep the extension installed and do not clear its data.
- Restore network/repository access.
- Wait: queued writes are pushed after 15 seconds without new changes, and Clockoli also retries at startup and approximately once per minute. There is no manual Sync button.
- If the panel shows **Retry** or another recovery action, follow it.
- In **Activity → List**, pending local changes are identified separately from queued conflicts. If a conflict appears, review its recovery action there; never discard an unsaved completion until you have verified the time is recorded elsewhere.

See [Sync and offline work](sync.md) for the full model.

A conflicted source completion can pause a dependent cross-repository Start until the conflict is resolved. Do not clear local data while either operation is queued.

### Sync keeps failing

Check:

- network access to GitHub;
- GitHub API/rate-limit status;
- current user authorization;
- GitHub App repository grant;
- repository visibility and archived/disabled state;
- user write permission and branch rules;
- whether the repository was renamed or transferred;
- whether another person manually changed the relevant active/monthly file.

Clockoli classifies authentication, access, destination, rate-limit, network, validation, and conflict failures differently. Follow the action shown in the panel rather than repeatedly reconnecting for a transient error.

### Clockoli preserved a newer timer

Another browser or device changed the remote active timer before this completion finished. Clockoli does not delete a newer timer from a stale Stop. Inspect the pending conflict and repository history before choosing a recovery action.

### The active timer is missing and no completion exists

Clockoli could not prove that the timer was completed. It reports the missing-active state rather than inventing a record. Inspect `active/`, the represented monthly file, and Git history before resolving the pending operation.

## Editing time

### Scrolling does not change a time value

This is intentional. Wheel and trackpad gestures scroll the panel normally and never mutate Start or Stop. Type the hour or minute directly in the always-visible fields of the unified inline draft. Clockoli does not show `−`/`+` step controls. Choose **Save time** to persist the draft.

### Editing one row changed a neighboring row

Clockoli maintains the chronological boundary between adjacent records:

- moving Start into the previous interval moves the previous Stop;
- moving Stop into the next interval moves the next Start.

The panel updates both rows immediately and saves them as one atomic operation. Choose **Cancel** before saving if that is not the intended correction.

### “Overlaps another entry” remains visible

The represented intervals still intersect after correction. Endpoint-touching records are allowed, but time shared by two intervals is highlighted. Adjust the boundaries in the unified inline draft.

### Timeline says a completed entry overlaps the running timer

This can happen even when both records track the same task: they are separate time intervals. The error shows the running timer's **Start** in its recorded timezone and as an exact UTC timestamp. An edit whose completed **End** is later than that Start is rejected before it is queued or saved; an End exactly at Start is allowed. A running timer is not a completed entry in List, so List alone may not reveal the overlap. If Activity says **Not tracking** while this error appears, check **Activity → List** for pending local changes or a queued conflict and follow the offered recovery action. A locally accepted Stop may still be waiting to remove the remote active timer; queued writes retry automatically when access is restored. Do not clear local data or discard a pending write to make the edit pass; first verify what the remote active record and pending operation represent. After synchronization, refresh Activity and retry. Existing overlaps are not silently shortened or deleted.

### Inline edit or Delete reports a stale or changed record

The monthly file changed after the panel loaded. Reload recent entries, review the latest record, and repeat the intended action. Clockoli refuses to retarget an edit or delete by array position alone.

### A manually edited file cannot be read

Clockoli parses the entire monthly file and does not silently skip malformed lines. Check that:

- each non-empty line is one valid JSON work record with `schema_version` equal to `1`;
- record IDs are unique and unchanged;
- work-item URLs are canonical HTTP(S) URLs without embedded credentials;
- timestamps are UTC ISO 8601 values ending in `Z`, with a valid IANA `timezone`;
- `local_date` falls in the monthly path's `times/YYYY-MM/` partition;
- no record is duplicated across branches or monthly files;
- `.clockoli/tasks.json` matches the completed records.

See [Validation and manual editing](time-data-repository.md#validation-and-manual-editing) and the [data format reference](data-format-v1.md). Use Git history to compare with the last valid version.

## Tasks

### A tracked task is not listed

Check the selected period and URL/title filter. **Top tasks** is current-user-only and reads entries whose Start date is in the selected period. Clear the filter when looking for a task whose optional GitHub title is unavailable.

### A GitHub task has no title

Title enrichment can be unavailable because of repository visibility, permission, API budget, or a temporary request failure. The stored URL and existing title remain usable.

## Reports and billing

### A report is empty

- Confirm the inclusive Start/End date range.
- Reports includes a record according to its Start date.
- Clear People, Project, Task source, or Time repository facets that exclude the data.
- Confirm the intended time repositories are selected and team members have valid personal branches.
- Check whether each selected repository can list and read those branches.

### A report says some time repositories could not be loaded

Clockoli keeps records from destinations that loaded successfully and marks the result partial. Review the per-repository status and restore access or retry. Conflicting copies of the same record ID are omitted and also make the result partial. CSV, JSON, and print/PDF exports remain disabled until the selected result is complete and conflict-free.

### Reports says to choose a shorter period

Clockoli enforces bounded file, byte, and record budgets so one report cannot make unbounded authenticated requests. Choose a shorter period and load again.

### Billable amount is zero or incomplete

Open Settings and:

- include a currency sign or 2–12 letter description in every hourly rate, such as `$15.50` or `750 RUB`;
- add a non-negative hourly rate for each GitHub login (matching is case-insensitive);
- save rates;
- export an updated local settings backup.

Rates are local to the current browser. They are not read from the shared repository or synchronized from a colleague's browser.

### CSV/JSON and the screen differ

Downloads use the currently loaded report, date range, facets, and local rates. Reload after changing settings or repository data, then download again.

## Clockify migration

### Migration controls are missing from the Detailed Report

Enable the Clockify add-on in Clockoli Settings and grant its optional `https://app.clockify.me/*` permission. Open Clockify's Detailed Report page in an authenticated tab and reload it after changing add-on permissions or reloading the extension. The banner should offer **CSV migration** and **Page to page migration**. See [Clockify migration](add-ons.md#clockify-migration) for the capture and mapping steps.

### The CSV capture cannot finish

Clockoli uses Clockify's native **Save as CSV** export after scanning report years. If Clockify offers email delivery instead of a CSV download, Clockoli re-requests the same annual report and tries again. If the email-only screen appears three times for that year, CSV migration stops with `CSV_EMAIL_EXPORT_UNAVAILABLE` and suggests **Page to page migration**, which captures displayed pages without requesting a CSV download. Previously captured years are not imported from an incomplete capture. If the email prompt cannot be closed or a retry cannot be recorded, Clockoli stops rather than retrying without a bound. If the banner cannot find Export or its CSV option, check that the Detailed Report finished loading and retry from that tab. No separate file upload is available.

### The preview is missing or an import was not completed

Wait for the year capture to finish, then review each person and entry count.

- Map each included Clockify person to a verified GitHub account, even if that account is not yet a collaborator on the default time repository. Leave **Skip this person** selected for everyone you do not want to import.
- Confirm the mappings and select **Import completed time**.
- A preview expires after one hour, so recapture from Clockify if it is unavailable.
- Review the per-person outcome: **Already present** means no new write was needed; a failure or conflict is not an import. Follow the displayed recovery message and retry only after resolving it.

Reopening a completed preview can show its retained outcome without rerunning the import. Invitations to the default repository are optional and require a separate confirmation after successful migration.

### An import is still running

After confirmation, Clockoli saves the source report and mappings as a local pending job before removing the one-hour preview. Confirmation returns as soon as the job is saved, so tracking and synchronization remain available while the import runs separately. It checkpoints each person's outcome, then atomically replaces the job with the final result.

If the extension worker stops, an extension alarm resumes unchecked people; a person interrupted during an uncertain GitHub write is re-read from the destination before importing again. You can close and reopen the preview to see saved progress. This local job contains the report's time records and mappings, but no credentials; do not clear extension data while an import is pending. Keep the extension installed and enabled for its alarms to run. Do not recapture and re-import a pending job; review its retained outcome when it completes.

### The import paused

If GitHub returns a rate limit during repository preflight or an active import, the migration saves the retry deadline, pauses GitHub requests, and retries after the reset (or a one-minute fallback when no valid reset is provided). Repeated throttling leaves the current person unchecked and retries on a later alarm rather than recording a failed import.

If you change the connected repository, GitHub identity, or authorization, the job remains paused; a routine GitHub App token refresh under the same authorization does not pause it. When the original connection cannot be restored, or a mapped GitHub login cannot be verified:

1. Wait for any request still in flight to settle.
2. Reopen the preview and choose **Edit GitHub mappings**. Clockoli atomically restores the saved report to a new, time-limited preview.
3. Review all mappings before importing again: records already written to GitHub remain there.

### DevTools shows 404 for monthly files

A `404 Not Found` for a monthly `times/YYYY-MM/<login>.jsonl` file is not a rate limit: it can mean that person has no Clockoli records for that month yet. DevTools' **Name** column hides the `YYYY-MM` directory, so requests for different months may look identical; inspect each request's full URL to distinguish them. Clockoli checks the branch file tree before reading affected months and skips Contents requests for months that are absent. Existing files are still read and checked before a conflict-safe write.

## Configuration and data safety

### I cannot change repository or authentication mode

Clockoli blocks transitions that could strand active or pending work. Stop active timers and synchronize or resolve every pending entry first.

### Signing out did not revoke GitHub access

**Sign out on this browser** removes local sign-in. **Revoke GitHub sign-in** opens GitHub's authorization settings, where you can remove Clockoli's sign-in approval. Changing the GitHub App installation and deleting repository data are separate GitHub/administrative actions.

**Clear all local Clockoli data** removes local settings, credentials and unsynced local state. Stop running timers and finish synchronization before clearing. Repository data and GitHub sign-in approval are not deleted.

### Settings import did not reconnect GitHub

This is intentional. A version 6 JSON backup excludes credentials. It can carry destination references, the exported default destination, and project routes, but import restores project routes only for destinations already configured in this browser. References remain unverified, and the imported default does not replace this browser's current default. Add any missing repository first. Import does not inspect repositories or reconnect GitHub. Before connecting, open **More settings** → **Backup & restore** to reach **Import settings**.

### A task went to the wrong time repository

Projects are checked top to bottom with case-insensitive URL-substring matching; the first match wins. Unmatched URLs use the explicit default. Reorder or correct the rules for future Starts. A running timer or queued write remains pinned to the destination chosen when Clockoli accepted it. See [Projects and routing](projects-and-routing.md).

## Collecting a useful bug report

Include:

- Clockoli commit or package identity;
- browser name and version;
- the visible error text and recovery action;
- whether the surface was the GitHub panel, toolbar panel, Top tasks, Activity, Reports, or Settings;
- whether a timer or pending write existed;
- redacted repository owner/name if needed;
- relevant Git path and commit SHA when safe.

Never include Device Flow codes, access tokens, refresh tokens, PATs, authorization headers, or exported local rate settings unless you deliberately intend to share them.
