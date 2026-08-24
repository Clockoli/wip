# Troubleshooting RepoClock

## Installation

### I cannot select the ZIP in Chrome

Extract the ZIP first. In `chrome://extensions`, choose **Load unpacked** and select the extracted directory that contains `manifest.json`.

### My unpacked extension did not update

Unpacked extensions have no automatic update channel.

1. Pull or replace the extension files.
2. Open `chrome://extensions`.
3. Select **Reload** on RepoClock.
4. Refresh open GitHub tabs.

### The GitHub stopwatch is missing

- Confirm RepoClock is enabled in `chrome://extensions`.
- Refresh the GitHub tab after installation or update.
- The injected control appears only on `https://github.com`.
- On any other HTTP(S) site, use the pinned toolbar popup.
- Internal browser pages such as `chrome://` pages cannot be tracked.

## GitHub connection

### Device activation completed, but setup did not advance

GitHub user authorization and GitHub App installation are separate.

1. Return to RepoClock Settings.
2. Use **Done on GitHub—check now** if automatic checking has not completed.
3. Continue to repository creation/access.
4. Grant the RepoClock App access to the intended repository with **Contents: Read and write**.

### No repository is listed

Check that:

- the repository is private;
- it is not archived or disabled;
- your user has write access;
- the RepoClock App installation includes it;
- **Contents: Read and write** is granted;
- an organization approval is not still pending.

Use **Choose repository access on GitHub** to review the App installation, then return to Settings. RepoClock checks again automatically; use the visible Retry action if monitoring times out or reports a transient error.

### Repository validation fails

RepoClock rejects unsafe destinations. Common causes are:

- public repository;
- missing user write permission;
- missing App Contents-write permission;
- incompatible `.repoclock`, `active`, or `times` content;
- a marker created by an unsupported format;
- branch rules or a ruleset that rejects direct writes;
- repository renamed/transferred or branch removed while setup was open.

Use a dedicated private repository with direct authenticated writes. Do not delete an existing marker or reserved content merely to bypass validation; inspect the reported incompatibility first.

### Organization approval is pending

An organization owner may need to approve the GitHub App installation or repository grant. RepoClock cannot bypass that policy. After approval, return to Settings and retry discovery.

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
- a timer is already running;
- a completion is waiting to synchronize or has a conflict.

Open the panel for details. Choose **Sync now**, resolve the pending state, or stop the current timer before starting another task.

### The panel says “Tracking another task”

The active timer's canonical URL differs from the page currently open. Select the active URL in the panel to return to it, or stop and save that timer before starting the current page.

### Start works on GitHub but not another site

The GitHub stopwatch is an injected convenience. For another site, pin and open RepoClock from the browser toolbar. The active page must use `http:` or `https:`.

### A GitHub notification link created unexpected task behavior

RepoClock canonicalizes GitHub issue/PR URLs by removing query strings and fragments. The stored task should be the base issue or pull-request URL. Generic non-GitHub query strings are preserved because they may identify different work.

### A long timer asks for confirmation

RepoClock warns before saving an entry longer than 12 hours. This catches forgotten timers but does not reject them. Verify the duration, choose to save, or edit the time first.

## Synchronization and conflicts

### “Saved locally and waiting to sync with GitHub”

RepoClock has preserved the Stop operation in extension-local storage but could not finish the GitHub write.

- Keep the extension installed and do not clear its data.
- Restore network/repository access.
- Choose **Sync now**.
- RepoClock also retries at startup and approximately once per minute.

A new timer is blocked until the pending completion is synchronized or resolved.

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

RepoClock classifies authentication, access, destination, rate-limit, network, validation, and conflict failures differently. Follow the action shown in the panel rather than repeatedly reconnecting for a transient error.

### RepoClock preserved a newer timer

Another browser or device changed the remote active timer before this completion finished. RepoClock does not delete a newer timer from a stale Stop. Inspect the pending conflict and repository history before choosing a recovery action.

### The active timer is missing and no completion exists

RepoClock could not prove that the timer was completed. It reports the missing-active state rather than inventing a record. Inspect `active/`, the represented monthly file, and Git history before resolving the pending operation.

## Editing time

### Scrolling does not change a time value

This is intentional. Wheel and trackpad gestures scroll the panel normally and never mutate Start or Stop. Type the hour or minute directly in the always-visible fields of the unified inline draft. RepoClock does not show `−`/`+` step controls. Choose **Save time** to persist the draft.

### Editing one row changed a neighboring row

RepoClock maintains the chronological boundary between adjacent records:

- moving Start into the previous interval moves the previous Stop;
- moving Stop into the next interval moves the next Start.

The panel updates both rows immediately and saves them as one atomic operation. Choose **Cancel** before saving if that is not the intended correction.

### “Overlaps another entry” remains visible

The represented intervals still intersect after correction. Endpoint-touching records are allowed, but time shared by two intervals is highlighted. Adjust the boundaries in the unified inline draft.

### Inline edit or Delete reports a stale or changed record

The monthly file changed after the panel loaded. Reload recent entries, review the latest record, and repeat the intended action. RepoClock refuses to retarget an edit or delete by array position alone.

### A manually edited file cannot be read

RepoClock parses the entire monthly file and does not silently skip malformed blocks. Check:

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
- Clear People or Source facets that exclude the data.
- Confirm team members selected the same data repository and have valid personal branches.
- Check whether the repository reader can list and read those branches.

### Reports says to choose a shorter period

RepoClock enforces bounded file, byte, and record budgets so one report cannot make unbounded authenticated requests. Choose a shorter period and load again.

### Billable amount is zero or incomplete

Open Settings and:

- include a currency sign or 2–12 letter description in every hourly rate, such as `$15.50` or `750 RUB`;
- add a non-negative hourly rate for each GitHub login (matching is case-insensitive);
- save rates;
- export an updated local settings backup.

Rates are local to the current browser. They are not read from the shared repository or synchronized from a colleague's browser.

### CSV/JSON and the screen differ

Downloads use the currently loaded report, date range, facets, and local rates. Reload after changing settings or repository data, then download again.

## Configuration and data safety

### I cannot change repository or authentication mode

RepoClock blocks transitions that could strand active or pending work. Stop active timers and synchronize or resolve every pending entry first.

### Disconnect did not revoke GitHub access

**Disconnect this browser** removes local sign-in. Revoking RepoClock user authorization, changing the GitHub App installation, and deleting repository data are separate GitHub/administrative actions.

### Settings import did not reconnect GitHub

This is intentional. The JSON backup excludes credentials and applies only display and billing preferences. Repository coordinates are reference-only and never switch the active destination.

## Collecting a useful bug report

Include:

- RepoClock commit or package identity;
- Chrome/Chromium version;
- the visible error text and recovery action;
- whether the surface was GitHub, popup, Tasks, Reports, or Settings;
- whether a timer or pending write existed;
- redacted repository owner/name if needed;
- relevant Git path and commit SHA when safe.

Never include Device Flow codes, access tokens, refresh tokens, PATs, authorization headers, or exported local rate settings unless you deliberately intend to share them.
