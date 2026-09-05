# Getting started with Clockoli

Clockoli is a Chrome/Chromium extension. It uses GitHub for sign-in and stores time records in a dedicated private GitHub repository.

## What you need

- Chrome or another Chromium browser, version 102 or newer.
- A GitHub account.
- Access to the current Clockoli source checkout or a trusted current extracted package.
- Permission to create a private GitHub repository, or write access to a private repository already used by your team for Clockoli data.

The data repository is separate from the repositories, documents, tickets, and pages you track. Clockoli does not need write access to a source repository just because one of its issues or pull requests is a task.

## 1. Install the current beta

The current trusted checkout and its locally built package identify as `v0.1.30`. The published `v0.1.11` package predates the product described in this documentation.

1. Clone or update the repository:

   ```bash
   git clone git@github.com:clockoli/clockoli.git
   cd clockoli
   git switch main
   git pull --ff-only
   ```

2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Select **Load unpacked**.
5. Choose the directory containing Clockoli's `manifest.json`.
6. Pin Clockoli to the toolbar so it is available on non-GitHub pages.

If you received a trusted ZIP, extract it first and select the extracted directory. Do not select the ZIP itself.

### Updating an unpacked installation

An unpacked extension does not update automatically:

1. Pull the latest trusted source or replace the extracted package directory.
2. Open `chrome://extensions`.
3. Select **Reload** on the Clockoli card.
4. Refresh any already-open GitHub tabs so they receive the current content script.

## 2. Connect GitHub

Clockoli Settings opens after the first installation. You can reopen it from the gear button in the Clockoli panel or from the extension details page.

Normal setup has three guided steps. Before connecting, Settings focuses on the connection card. Open **More settings** for Billable rates, Backup & restore (including **Import settings**), and **Advanced**.

### Step 1: activate the device

1. Select **Connect GitHub**. Clockoli copies the one-time code before opening GitHub so you can paste it.
2. On GitHub, verify that you reached **github.com** for the Clockoli authorization you initiated in Settings.
3. Paste the one-time code and approve the request.
4. Return to Clockoli. It checks the result automatically; **Done on GitHub—check now** is also available.

Device activation signs this browser in without asking you to create or paste a personal access token. GitHub authorization and GitHub App repository access are separate steps.

### Step 2: choose private data storage

For a new setup, use **Create private repository**. GitHub opens a prefilled private-repository form for **clockoli-data** based on Clockoli's template.

If you already have a suitable repository, select **Use existing repository**.

A suitable repository must be:

- private;
- not archived or disabled;
- writable by your GitHub user;
- granted to the Clockoli GitHub App with **Contents: Read and write**;
- compatible with direct writes under its branch rules.

Select **Grant repository access**. Use **Only select repositories** and grant access only to the data repository.

Creating a repository does not grant the GitHub App access to it. Clockoli monitors access when you return from GitHub.

### Step 3: choose and validate the data repository

When there is only one eligible repository, Clockoli automatically validates and connects it. If several are available, select the repository and choose **Validate and connect**. Clockoli checks privacy, permissions, repository identity, branch routing, and storage compatibility before enabling tracking.

Clockoli creates or verifies its repository marker and provisions a personal branch named from your stable GitHub user ID. Routine timer writes go to that personal branch.

The connection card confirms: “Setup complete. Open a task page, then click the Clockoli icon to start tracking.” Open **Repository verification details** below it to review the account, repository, branch and verification status, **Check access**, or **Change repository**.

## Advanced PAT setup

Open **More settings**, then **Advanced** → **Use a personal access token** in Settings if your environment cannot install the App or already uses the compatibility flow. After connecting, **Advanced** is available directly on the page.

Create a fine-grained personal access token restricted to the one private data repository with **Contents: Read and write**, then enter:

- repository owner;
- repository name;
- branch;
- token.

Select **Validate and use PAT**. Clockoli validates the GitHub identity, private repository, branch, and write route before saving the configuration. A stored token is never displayed again.

## 3. Track your first task

A task is a canonical HTTP(S) URL. The title is optional.

### From any website

1. Open the page you want to track.
2. Select the Clockoli toolbar icon.
3. Choose **Start tracking this task**.
4. Work normally.
5. Open Clockoli again and choose **Stop and save**.
6. Add an optional description before stopping if useful.

The popup reads the active tab's current URL and title when you start. Internal browser pages such as `chrome://extensions` cannot be tasks because they are not HTTP(S) pages.

### From GitHub

Clockoli adds a split stopwatch control before your GitHub avatar:

- the stopwatch opens the tracking panel for the current GitHub URL;
- the arrow opens navigation to **Tasks**, **Times**, and **Reports**.

GitHub issue and pull-request titles can be used as optional metadata when GitHub makes them available. The URL remains the task identity.

### One timer at a time

Clockoli permits one active timer per connected GitHub account. The panel says:

- **Tracking this task** when the active timer matches the current page;
- **Tracking another task** when a different URL is active.

Stop the current timer before starting another one. Pending completions must be synchronized or resolved before a new timer can start.

## 4. Correct a record

Recent rows contain one-line `HH : MM - HH : MM` controls. The underlying Start and Stop fields preserve each timestamp's stored timezone offset.

- Type the Start or Stop hour/minute directly in the unified inline draft.
- Wheel/trackpad gestures scroll the panel normally and do not change time; no `−`/`+` controls are shown.
- Choose **Save time** to persist the correction, or **Cancel** to discard the draft.
- Select the displayed URL, title, or description to edit those fields in the same draft; Enter also saves it.
- Choose **Delete** to remove an entry. The previous repository version remains in Git history.

If moving a boundary crosses the adjacent record, Clockoli changes the matching neighboring boundary immediately and saves all affected records atomically. Intersections that still remain are highlighted.

## 5. Open Tasks, Times, and Reports

Use the buttons in the panel header, the GitHub split-menu arrow, or the popup:

- **Tasks** groups your sessions by task URL, displays URL and optional title as a search-style result, adds the running session, and provides URL/title search, periods, and inline Start/Stop actions.
- **Times** shows completed entries for preset or custom periods, supports URL/title filtering and inline correction, and accepts all-or-nothing bulk manual entries.
- **Reports** reads the selected period across the data repository and provides facets, configurable charts, billable amounts, CSV/JSON download, and print/save-to-PDF.

## 6. Optional settings

**Save display settings** and **Save billable rates** each show success or an error beside their own button. The backup reminder appears once per page load; after exporting, further saves do not show it again until you reopen or reload Settings.

### Recent entries

Choose from 1 to 31 days of recent entries in the main panel. This changes display only; it does not limit tracking, Tasks, or Reports.

### Billable rates

Add hourly rates by GitHub login and include the currency directly in each rate, for example `$15.50`, `20.15$`, `€55.50`, `750 RUB`, or `888 GEL`. Rates stay in this browser's extension-local storage. Other team members do not receive them, and the repository never stores rates or calculated money.

### Local settings backup

Export a readable JSON backup after changing display or billing settings. It contains:

- recent-entry display setting;
- hourly rates with their currency signs or descriptions;
- repository coordinates as a reference.

It does not contain credentials, device codes, active timers, pending writes, or tracked time. Import restores display and billing settings only; it does not reconnect GitHub or switch the current data repository.

## Team setup

For shared reporting:

1. Use one dedicated private Clockoli data repository.
2. Grant the Clockoli GitHub App access only to that repository.
3. Give each team member the GitHub rights needed to read and write it.
4. Have every person install Clockoli, activate their own GitHub account, and select the same data repository.
5. Clockoli provisions a marked personal branch for each stable GitHub user ID.
6. Reports discovers those branches and combines the visible records.

Repository readers can see every stored URL, title, timestamp, and description included in shared reporting. Use separate data repositories for groups with different access boundaries.

Next: [Feature guide](features.md) or [Troubleshooting](troubleshooting.md).
