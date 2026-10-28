# Settings

Every Settings section, in the order Settings shows it: account, repositories, display, routing, merging, add-ons, billing, backups, and advanced.

Settings opens after the first installation. Reopen it from the gear button in the Clockoli panel, the **Settings** navigation link, or the extension details page.

**Save projects and routing**, **Save billable rates**, and **Save invoicing settings** each show success or an error beside their own button. After a settings change, a reminder suggests exporting an updated backup; it appears once per page load and, after exporting, does not show again until you reopen or reload Settings.

## GitHub account

The connection card handles GitHub sign-in and the first time repository; see [Getting started](getting-started.md#step-1-sign-in-with-github). Before setup is complete, Settings focuses on this card.

**Sign out on this browser** removes local sign-in while preserving local tracking data and the repository configuration. It does not revoke GitHub sign-in, change the GitHub App installation, or delete repository data.

## Time repositories

Each connected repository has a card with its status, a **Default** badge for the default destination, collaborator avatars, and these actions:

- **Check access** rechecks the repository's access and storage.
- **Open repository** opens it on GitHub.
- **Manage GitHub access** opens the App installation or repository access settings.
- **Make default** makes it the destination for tasks that match no project.
- **Remove from Clockoli** removes the repository from this browser. Repository data, GitHub App access, and Git history are not deleted. Removal is blocked while it would strand active or pending work.

**Add time repository** adds another destination regardless of who owns it; adding never deletes records in existing repositories. See [Time repositories](time-data-repository.md) for requirements and [Work as a team](teams.md) for invitations and avatars.

## Interface width

Choose whether Activity, Reports, Top tasks, and the content inside the toolbar panel use a centered column (default) or the available screen width. Settings itself always uses a centered 820px column. The panel shell always spans the page width; it remains at most 70% of the viewport height (and at most 720px) in either width mode, scrolling internally when needed. This device-local preference is not included in repository data or settings exports.

## Projects and routing

Ordered URL rules choose the time repository for each new Start. See [Projects and routing](projects-and-routing.md).

### Activity display

**Recent entries shown in the main panel (days)** accepts 1 to 31 days; the default is 7. This changes display only; it does not limit tracking, Top tasks, Activity, or Reports. It is saved with **Save projects and routing**.

## Merge tasks

Merge tasks replaces one task identity with another in one time repository, for example an imported Clockify task with its real GitHub issue URL.

1. Choose the **Period** (Last 30 days, Last 3 months, or **All time**), the **Time repository**, and the people whose records to include. Use **All time** if the imported entry falls outside the default last 30 days. The People control shows selected accounts with their repository collaborator avatars when available, or initials otherwise; open it to filter or change the selection.
2. In **Task to replace**, search by title or identity and select the task. An imported `owner/project/task-slug` identity can be selected.
3. In **Replace with**, select the replacement. It must be an already-tracked HTTP(S) URL in that selection.
4. Repeat to build the **Merge list**, review it, and select **Merge**.

The merge rewrites matching records in the selected period and preserves their prior identities in record history. The full merge list is saved in one atomic commit. Merge tasks is an explicit GitHub operation, not part of the background sync queue.

## Add-ons

Enable packaged integrations, such as Clockify migration, after reviewing their requested access. See [Add-ons and Clockify migration](add-ons.md).

## More settings

Open **More settings** for billing, invoicing, backups, and advanced options.

### Billable rates

Hourly rates per GitHub login, with effective dates. See [Billable rates](billable-rates.md).

### Invoicing

Seller and client details, numbering, payment terms, tax, and notes. See [Invoicing](invoicing.md).

### Backup & restore

**Export settings** downloads a readable JSON backup of your local settings; **Import settings** restores one. Export a new backup after changing local settings. It can contain sensitive rate and customer information, so protect the downloaded file. It includes:

- recent-entry and reporting preferences;
- project rules and client assignments;
- hourly rates with their currency signs or descriptions;
- invoicing details such as seller, clients, and payment terms;
- credential-free repository references and, for routed installations, the default destination.

For configured multi-repository routing, the export uses settings format version 6; the single-repository/PAT path can use version 7. Neither contains credentials, device codes, active timers, pending writes, or tracked time. The Activity view and interface width preferences stay on this browser and are not included. See [Settings backup exclusions](data-and-privacy.md#settings-backup-exclusions).

Import validates the entire file and restores routes to destinations already configured in this browser. It reports missing repositories and their routes as not restored; other eligible routes can still be restored. A reference in the backup does not verify current access, and the imported default does not replace this browser's current default. Import does not test access, add a repository, or reconnect GitHub, so add any missing repository first. Before connecting, **Import settings** is reachable through **More settings** → **Backup & restore**.

### Advanced

#### Diagnostics

**Show queue diagnostics in the tracking panel** shows a local, sanitized operation log for troubleshooting save problems. Diagnostics are hidden by default and start collapsed when shown.

#### Use a personal access token

A single-repository compatibility option for existing PAT setups or environments where the GitHub App cannot be installed. See [Advanced PAT setup](getting-started.md#use-a-personal-access-token-instead).

#### Recovery and access

- **Clear all local Clockoli data** removes local settings, credentials, and unsynced local state from this browser. Stop any running timer and let pending changes synchronize before clearing. Repository data and GitHub sign-in approval are not deleted.
- **Revoke GitHub sign-in** opens GitHub's authorization settings, where you can remove Clockoli's sign-in approval. It does not uninstall the App or delete repository data.

## Appearance

Use the appearance control beside the Clockoli logo on Clockoli pages to switch between light and dark themes. The moon switches to dark; the sun switches to light. The choice is saved locally and shared with other extension pages and the toolbar popup. Before choosing, Clockoli follows the browser's color scheme. Appearance preferences are not written to GitHub.
