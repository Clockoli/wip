# Getting started with Clockoli

Clockoli is a Chrome/Chromium extension. It uses one GitHub account for sign-in and can store time records in several dedicated private GitHub time repositories.

## What you need

- Chrome or another Chromium browser, version 102 or newer.
- A GitHub account.
- Access to the current Clockoli source checkout or a trusted current extracted package.
- Read/write access to a suitable private time repository, or permission to create one. It may belong to you, another person, or an organization. Initializing an organization repository requires GitHub repository-admin permission.

A time repository is separate from the source repositories, documents, tickets, and pages you track. Clockoli does not need write access to a source repository just because one of its issues or pull requests is a task. Your GitHub account supplies identity and access; it is not itself either kind of repository.

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

## 2. Set up Clockoli

Clockoli Settings opens after the first installation. You can reopen it from the gear button in the Clockoli panel or from the extension details page.

Normal setup has two guided steps: sign in with GitHub, then discover ready time repositories, choose a default, and finish setup. Before connecting, Settings focuses on the connection card. Open **More settings** for Billable rates, Backup & restore (including **Import settings**), and **Advanced**.

### Step 1: activate the device

1. Select **Sign in with GitHub**. Clockoli copies the one-time code before opening GitHub so you can paste it.
2. On GitHub, verify that you reached **github.com** for the Clockoli authorization you initiated in Settings.
3. Paste the one-time code and approve the request.
4. Return to Clockoli. It checks the result automatically; **Done on GitHub—check now** is also available.

Device activation signs this browser in without asking you to create or paste a personal access token. GitHub authorization and GitHub App repository access are separate steps.

### Step 2: connect time repositories

After sign-in, Clockoli shows accessible repositories as a compact list with repository icons, owner/name links, status, and independent row actions—not radio choices. Use a row’s action, or enter its GitHub URL (for example, `https://github.com/acme/time-data`) or `owner/name` in **Repository URL or owner/name**, then select **Check repository**. Unavailable repositories show why they cannot be used. There is no separate existing/new or personal/organization choice: Clockoli inspects the selected repository's state and your permissions.

If you need a repository, use **Create a new time repository** at the beginning of the repository section. Create it on GitHub, then return and enter its URL. Creating a repository does not grant the Clockoli GitHub App access to it.

A suitable repository must be:

- private;
- not archived or disabled;
- writable by your GitHub user;
- granted to the Clockoli GitHub App with **Contents: Read and write**;
- compatible with direct writes under its branch rules.

Clockoli asks for **Grant access** only when the checked target is missing from the accessible list or needs App Contents-write permission. If Clockoli knows the owner's existing App installation, the link opens that installation's settings rather than starting another installation. Use **Only select repositories** and grant access only to the intended time repository or repositories. If you cannot change access, ask the repository owner or organization administrator; approval may be required.

The access dialog opens only after an explicit **Check repository** finds missing App access. **Grant access** closes the dialog and opens the known installation settings or the App install page. Return to Settings and select **Check repository** again; the list also refreshes silently while setup is active. Clockoli remembers the checked target across the GitHub visit and Settings reload; it does not replace a missing target with another available repository. A missing private repository does not prove it does not exist: check its name, your GitHub access, the App grant, and any pending approval.

#### Review and confirm

Ready repositories become available automatically after Clockoli verifies membership, personal branch ownership, and the task index; they need no Add action or remote write. **Check repository** or a row’s action opens the relevant access or setup dialog when needed. Choose **Default time repository**, then **Finish setup** once the default is usable and no authorization confirmation is pending. The first connection becomes the default; later additions preserve it. You can add more from Settings later.

Discovery is read-only on GitHub and never opens a dialog or writes repository data. Initialization and joining require your explicit confirmation. New or replacement GitHub authorization is accepted automatically only for the same identity after every configured destination can be read and active or queued work is safe; otherwise the current credentials remain in use and Settings shows recovery guidance. See [Time repository storage](time-data-repository.md) for discovery, authorization, and branch details.

The access dialog’s **Create one on GitHub** link prefills the checked repository name and owner while retaining the private Clockoli template. GitHub may ignore the owner if you lack creation permission; verify the owner before creating. The top **Create a new time repository** link still suggests `clockoli-data`.

Discovery and inspection never write to GitHub. Already-ready repositories are registered locally under the current authorization and appear in **Default time repository** automatically. **Check repository** or a row’s action opens an action-specific setup dialog when needed. Read the privacy disclosure and **Repository writes**, then explicitly confirm the offered action:

- **Set up storage branch** explicitly creates or verifies a missing personal storage branch for an existing member. Invalid branch ownership or task-index data is unavailable until repaired; discovery never overwrites it.

- **Join repository** registers your GitHub identity in the initialized repository's Clockoli user list and creates or verifies your personal storage branch.
- **Initialize repository** creates the Clockoli marker and personal storage branch; for an empty repository, it also creates the first commit and default branch.

Clockoli rechecks repository state and permissions before applying the confirmed action. Initializing an organization repository requires fresh GitHub repository-admin permission; an ordinary teammate can join a valid initialized repository but cannot initialize an unmarked one. Editing the repository input invalidates selection and confirmation: select **Check repository** and review the new target before confirming.

Anyone with read access to the selected repository can see stored task URLs, titles, timestamps, and descriptions. Use a separate repository for each privacy boundary. Routine timer writes go to your personal `clockoli/users/{github-user-id}` branch.

After confirmation succeeds, the repository appears under **Time repositories**. Shared repositories provide copyable instructions for other people who should join them, whether owned by a person or an organization. In Settings, keep the **GitHub account**, **Time repositories**, and **Projects and routing** concepts distinct. Use **Add time repository** to add more destinations later regardless of who owns them, and choose an explicit default destination.

## Advanced PAT setup

Open **More settings**, then **Advanced** → **Use a personal access token** in Settings if your environment cannot install the App or already uses the compatibility flow. After connecting, **Advanced** is available directly on the page.

PAT compatibility mode supports one destination only. Create a fine-grained personal access token restricted to that private time repository with **Contents: Read and write**, then enter:

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
3. In the full-width panel, choose **Track this task**.
4. Work normally.
5. Open Clockoli again and add an optional description if useful.
6. Choose **Stop and save**.

The panel uses the active tab's current URL and title when you start. Internal browser pages such as `chrome://extensions` cannot be tasks because they are not HTTP(S) pages; the toolbar opens **Activity** instead.

### From GitHub

Clockoli adds a split stopwatch control before your GitHub avatar:

- the stopwatch opens the tracking panel for the current GitHub URL;
- the arrow opens navigation to **Top tasks**, **Activity**, and **Reports**.

GitHub issue and pull-request titles can be used as optional metadata when GitHub makes them available. The URL remains the task identity.

### One timer at a time

Clockoli permits one global active timer across every configured time repository. The smaller GitHub stopwatch dialog says:

- **Tracking this task** when the active timer matches the current page;
- **Tracking another task** when a different URL is active.

Choose **Switch to this task** in the full-width panel (or **Save and switch to this task** in the smaller GitHub stopwatch dialog) to finish the running task and start the current one. For a cross-repository switch, Clockoli first durably queues the source completion, then queues the target Start behind it. This preserves one timer even though the two repositories cannot be updated in one Git commit.

### Route new Starts

Projects are ordered, case-insensitive URL-substring rules. The first matching project chooses the time repository for a new Start. An explicit default time repository receives unmatched URLs. A running timer and every accepted queued write remain pinned to their original destination if you later reorder rules or change the default.

## 4. Correct a record

Open **Activity** for older entries and overlaps, or correct a recent entry in the tracking panel.

Recent rows contain one-line `HH : MM - HH : MM` controls. The underlying Start and Stop fields preserve each timestamp's stored timezone offset.

- Type the Start or Stop hour/minute directly in the unified inline draft.
- Wheel/trackpad gestures scroll the panel normally and do not change time; no `−`/`+` controls are shown.
- Choose **Save time** to persist the correction, or **Cancel** to discard the draft.
- Select the displayed URL, title, or description to edit those fields in the same draft; Enter also saves it.
- Choose **Delete** to remove an entry. The previous repository version remains in Git history.

If moving a boundary crosses the adjacent record, Clockoli changes the matching neighboring boundary immediately and saves all affected records atomically. Intersections that still remain are highlighted.

## 5. Open Top tasks, Activity, and Reports

Use the panel navigation or the GitHub split-menu arrow:

- **Top tasks** groups the current user's sessions by canonical task URL across selected time repositories. Search or choose a period, then start or stop a task from its row.
- **Activity** combines completed entries from selected time repositories for preset or custom periods. Filter by URL or title, correct an entry, or add completed time with the all-or-nothing bulk importer.
- **Reports** reads selected or all time repositories and provides facets, configurable charts, billable amounts, CSV/JSON download, and print/save-to-PDF. It labels the tracked URL's **Task source** separately from the **Time repository** that stores the record.

Reads can succeed partially. Clockoli keeps records from repositories that loaded and identifies unavailable destinations. Reports disables CSV, JSON, and report print/PDF exports while the selected data is partial. Invoice creation may still be available for the filtered records: confirm that every intended repository loaded before printing an invoice.

## 6. Optional settings

**Save projects and routing**, **Save billable rates**, and **Save invoicing settings** each show success or an error beside their own button. The backup reminder appears once per page load; after exporting, further saves do not show it again until you reopen or reload Settings.

### Recent entries

Choose from 1 to 31 days of recent entries in the main panel. This changes display only; it does not limit tracking, Top tasks, Activity, or Reports.

### Billable rates

Add hourly rates by GitHub login and include the currency directly in each rate, for example `$15.50`, `20.15$`, `€55.50`, `750 RUB`, or `888 GEL`. Rates stay in this browser's extension-local storage. Other team members do not receive them, and the repository never stores rates or calculated money.

### Invoicing

In **Invoicing**, save seller and client details, invoice numbering, payment terms, and tax defaults for local invoice previews. These details stay in this browser and are not written to the time repository. See the [feature guide](features.md#invoicing) for invoice creation and limits.

### Local settings backup

Export a readable JSON backup after changing local settings. It can contain sensitive rate and customer information, so protect the downloaded file. It includes:

- recent-entry and reporting preferences;
- project rules and client assignments;
- hourly rates with their currency signs or descriptions;
- invoicing details such as seller, clients, and payment terms;
- credential-free repository references and, for routed installations, the default destination.

The routed export uses settings format version 6; the single-repository/PAT path can use version 7. Neither contains credentials, device codes, active timers, pending writes, or tracked time. Import restores routes to destinations already configured in this browser and reports missing repositories and their routes as not restored; other eligible routes can still be restored. A reference in the backup does not verify current access, and the imported default does not replace this browser's current default. Import does not test access, add a repository, or reconnect GitHub.

## Team setup

For shared reporting:

1. A repository administrator signs in, selects a suitable private repository or enters its URL, and grants the Clockoli GitHub App access only if needed. After the repository row’s action, they explicitly confirm **Initialize repository** and copy the teammate instructions. Shared repositories may belong to a person or an organization; organization initialization requires fresh GitHub repository-admin permission.
2. Give each teammate the GitHub rights needed to read and write that repository.
3. Each teammate installs Clockoli, signs in with their own GitHub account, selects the repository from the accessible list or enters its URL or `owner/name`, and selects **Check repository** for an entered target. If access is missing, follow the target-specific access instructions and return. Select the repository row’s action, read the disclosure and writes, and explicitly confirm **Join repository** (or **Set up storage branch** if already a member with a missing branch; ready members need no Add action).
4. Clockoli provisions a marked personal branch for each stable GitHub user ID.
5. Teammates can add that shared repository alongside other personal or organization time repositories and route projects to it.
6. Reports combines the selected visible repositories and branches.

Repository readers can see every stored URL, title, timestamp, and description included in shared reporting. Use separate data repositories for groups with different access boundaries.

Next: [Feature guide](features.md) or [Troubleshooting](troubleshooting.md).
