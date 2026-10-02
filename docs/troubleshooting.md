# Troubleshooting Clockoli

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
3. After sign-in, Clockoli lists accessible repositories in **Connect time repositories**. Select a row’s **Check repository** action, or enter a GitHub URL or `owner/name` and leave the field or press Enter to check the manual target.
4. Grant App access only if Clockoli reports that the target is missing or needs **Contents: Read and write**. Check a ready repository, then choose **Connect repository** and confirm separately. A replacement authorization is also confirmed automatically after Clockoli read-validates every configured destination; failures appear once at account level.

### My repository is not listed

Enter its GitHub URL or `owner/name` in **Repository URL or owner/name**, then leave the field or press Enter to check it. Use the refresh icon beside the field to retry. A missing private repository is not necessarily nonexistent: GitHub may hide it when your account or the App lacks access. Check the spelling and your GitHub access before creating a replacement.

Check that:

- the repository is private;
- it is not archived or disabled;
- your user has write access;
- the Clockoli App installation includes it;
- **Contents: Read and write** is granted;
- an organization approval is not still pending.

When the checked target is missing or needs App Contents-write permission, use **Grant access**. If Clockoli knows the owner's existing App installation, this opens its settings. Choose **Only select repositories** and add the intended repository; ask its owner or organization administrator if you cannot change the grant. There is no need to repeat installation when the repository is already accessible.

The access dialog appears only after checking a manual target or selecting a row’s **Check repository** action. **Grant access** closes it and opens GitHub. Return to Settings and recheck the row or manual target; the list refreshes silently every 3 seconds while setup is active. Clockoli remembers the repository you selected or explicitly checked across the GitHub visit and Settings reload. It does not silently substitute another repository if your target remains unavailable. Network errors are reported separately from missing App access.

If you really need a repository, use **Create a new time repository** at the beginning of the repository section, then return and enter its URL. Creating it does not grant App access.

Discovery and inspection never write to GitHub or connect new repositories locally. After a ready check, choose **Connect repository** and confirm; Clockoli revalidates and registers it locally without changing repository files. A missing branch needs explicit setup; invalid ownership or index data must be repaired before use. Select the repository row’s action, read the privacy disclosure and **Repository writes** when present, then explicitly confirm **Set up storage branch**, **Join repository**, or **Initialize repository**, as offered. Even **Set up storage branch** may create or verify your personal storage branch. Anyone with repository read access can see stored task URLs, titles, timestamps, and descriptions.

### Check an edited repository target before connecting

Editing **Repository URL or owner/name** invalidates the previous selection and confirmation. Leave the field or press Enter to inspect the edited target, resolve any displayed availability reason, then review and confirm the newly selected repository. Background discovery does not confirm writes for you.

### The list does not visibly refresh, or Finish setup is unavailable

The compact icon-and-link list checks silently every 3 seconds while repository setup is active; there is no **Refresh repositories** or **Review connection** button and no radio-list selection. Unchanged results preserve the list DOM, focus, scroll, drafts, messages, and dialogs. Background errors retain the last good view without a spinner or notification. Use **Check repository** for an explicit result; it opens the appropriate access or setup dialog when needed, but writes still require the disclosed action-specific confirmation.

Choose a usable connected repository in the separate **Default time repository** selector. New or replacement GitHub authorization is promoted automatically only for the same GitHub identity after every configured destination passes read-only validation and active/queued-work safety checks. If promotion is blocked, follow the single account-level message; there is no per-repository confirmation action. **Finish setup** remains unavailable while authorization or the default is unresolved. Finishing stops polling, discards late replies, and clears the remembered target without remote writes.

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

An organization owner may need to approve the GitHub App installation or repository grant. Clockoli cannot bypass that policy. After approval, return to Settings; the list updates silently while setup is active. Select **Check repository** to explicitly recheck the target.

### I cannot initialize an organization repository

Organization-owned repository initialization requires GitHub repository-admin permission, rechecked from fresh repository permissions before the confirmed write. A previously available initialization action does not preserve permission after it is revoked. If you are an ordinary teammate, ask a repository administrator to initialize the dedicated repository and send the generated setup instructions. Then use the listed repository's **Check repository** action or enter its URL or `owner/name` and leave the field or press Enter to check it. Review the offered action and explicitly confirm **Join repository**; joining works only when the repository already has a valid Clockoli marker.

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

Open the panel for details. Choose **Switch to this task** when another task is running. Choose **Sync now** or resolve the pending state when a queued dependency is blocked.

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

### “Saved locally and waiting to sync with GitHub”

Clockoli has preserved the Stop operation in extension-local storage but could not finish the GitHub write.

- Keep the extension installed and do not clear its data.
- Restore network/repository access.
- Choose **Sync now**.
- Clockoli also retries at startup and approximately once per minute.

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

### Inline edit or Delete reports a stale or changed record

The monthly file changed after the panel loaded. Reload recent entries, review the latest record, and repeat the intended action. Clockoli refuses to retarget an edit or delete by array position alone.

### A manually edited file cannot be read

Clockoli parses the entire monthly file and does not silently skip malformed blocks. Check:

- recognized `URL`, optional `Title`, `Start`, `End`, and optional `Description` fields;
- a valid HTTP(S) URL without embedded credentials;
- explicit timezone offsets;
- Start month matching `times/YYYY-MM/`;
- one-line bounded Title/Description values;
- one blank line between records;
- no duplicate default-branch and personal-branch copies.

Use Git history to compare with the last valid version.

## Tasks

### A tracked task is not listed

Check the selected period and URL/title filter. **Recently tracked work** is current-user-only and reads entries whose Start date is in the selected period. Clear the filter when looking for a task whose optional GitHub title is unavailable.

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

Clockoli uses Clockify's native **Save as CSV** export after scanning report years. If Clockify offers email delivery instead of a CSV download, the banner reports `CSV_EMAIL_EXPORT_UNAVAILABLE`; no CSV was captured. Return to the report and try **Page to page migration**, which captures the displayed pages without requesting a CSV download. If the banner cannot find Export or its CSV option, check that the Detailed Report finished loading and retry from that tab. No separate file upload is available.

### The preview is missing or an import was not completed

Wait for the year capture to finish, then review each person and entry count. Map only the Clockify person whose time belongs to the currently signed-in Clockoli GitHub user; explicitly **Skip this person** for all others. Confirm the mapping and select **Import completed time**. A preview expires after one hour, so recapture from Clockify if it is unavailable. Review the per-person outcome: **Already present** means no new write was needed; a failure or conflict is not an import. Follow the displayed recovery message and retry only after resolving it. Reopening a completed preview can show its retained outcome without rerunning the import.

## Configuration and data safety

### I cannot change repository or authentication mode

Clockoli blocks transitions that could strand active or pending work. Stop active timers and synchronize or resolve every pending entry first.

### Signing out did not revoke GitHub access

**Sign out on this browser** removes local sign-in. **Revoke GitHub sign-in** opens GitHub's authorization settings, where you can remove Clockoli's sign-in approval. Changing the GitHub App installation and deleting repository data are separate GitHub/administrative actions.

**Clear all local Clockoli data** removes local settings, credentials and unsynced local state. Stop running timers and finish synchronization before clearing. Repository data and GitHub sign-in approval are not deleted.

### Settings import did not reconnect GitHub

This is intentional. A version 6 JSON backup excludes credentials. It can carry destination references, the exported default destination, and project routes, but import restores project routes only for destinations already configured in this browser. References remain unverified, and the imported default does not replace this browser's current default. Add any missing repository first. Import does not inspect repositories or reconnect GitHub.

### A task went to the wrong time repository

Projects are checked top to bottom with case-insensitive URL-substring matching; the first match wins. Unmatched URLs use the explicit default. Reorder or correct the rules for future Starts. A running timer or queued write remains pinned to the destination chosen when Clockoli accepted it.

Before connecting, open **More settings** → **Backup & restore** to reach **Import settings**.

## Collecting a useful bug report

Include:

- Clockoli commit or package identity;
- Chrome/Chromium version;
- the visible error text and recovery action;
- whether the surface was GitHub, popup, Tasks, Reports, or Settings;
- whether a timer or pending write existed;
- redacted repository owner/name if needed;
- relevant Git path and commit SHA when safe.

Never include Device Flow codes, access tokens, refresh tokens, PATs, authorization headers, or exported local rate settings unless you deliberately intend to share them.
