# Getting started with Clockoli

Clockoli is a browser extension for Chrome and other Chromium browsers, Firefox, and Safari on macOS. It uses one GitHub account for sign-in and can store time records in several dedicated private GitHub time repositories.

## What you need

- One of these browsers:
  - Chrome or another Chromium browser, version 102 or newer;
  - Firefox 140 or newer;
  - Safari 18 or newer on macOS.
- A GitHub account.
- Read/write access to a suitable private time repository, or permission to create one. It may belong to you, another person, or an organization. Initializing an organization repository requires GitHub repository-admin permission.

A time repository is separate from the source repositories, documents, tickets, and pages you track. Clockoli does not need write access to a source repository just because one of its issues or pull requests is a task. Your GitHub account supplies identity and access; it is not itself either kind of repository.

## 1. Install Clockoli

### Chrome and other Chromium browsers

Add Clockoli from the [Chrome Web Store](https://chromewebstore.google.com/detail/clockoli/omkikhlcnbjpfbiicogjekhjgmbajmnl), then pin it to the toolbar so it is available on non-GitHub pages. Store installations update automatically. Store review can make the listed version trail the latest GitHub release.

### Firefox

Download `Clockoli-X.Y.Z-firefox-signed.xpi` from a [GitHub release](https://github.com/clockoli/clockoli/releases). Open `about:addons`, choose the gear menu → **Install Add-on From File**, and select it.

The unsigned `Clockoli-X.Y.Z-firefox.xpi` is for store submission and temporary testing. To load it, open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select the XPI. Temporary installations last until Firefox restarts.

### Safari

1. Download `Clockoli-X.Y.Z-safari-unsigned.zip` from a [GitHub release](https://github.com/clockoli/clockoli/releases) and extract it.
2. Move `Clockoli.app` to Applications and open it. If macOS blocks it, choose **Open Anyway** in System Settings → Privacy & Security.
3. In Safari Settings → Advanced, enable features for web developers. Then, in Settings → Developer, enable **Allow unsigned extensions**.
4. Enable Clockoli in Settings → Extensions.

Safari can turn off **Allow unsigned extensions** when it restarts; enable it again if Clockoli disappears. When a release includes `Clockoli-X.Y.Z-safari.zip`, it contains the signed, notarized app and does not need unsigned extensions.

### Development checkout (Chromium)

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

To use a release `Clockoli-X.Y.Z.zip` unpacked, extract it into a permanent folder first and select that folder. Do not select the ZIP itself.

### Updating a file installation

Unpacked and file installations do not update automatically:

1. Pull the latest trusted source, or install the newer release file.
2. For an unpacked installation, open `chrome://extensions` and select **Reload** on the Clockoli card.
3. Refresh any already-open GitHub tabs so they receive the current content script.

Before you replace an installation or switch browser, sync pending changes, stop the timer, and export settings. Credentials and local state do not move between browsers, browser profiles, or a store and an unpacked installation.

## 2. Set up Clockoli

Clockoli Settings opens after the first installation. You can reopen it from the gear button in the Clockoli panel or from the extension details page.

Normal setup has two guided steps: sign in with GitHub, then check a time repository and confirm **Connect repository** if ready (or the offered setup action). A usable first connection becomes the default and completes initial setup; for later additions, choose a default if needed and select **Finish setup**. Before connecting, Settings focuses on the connection card. Open **More settings** for Billable rates, Backup & restore (including **Import settings**), and **Advanced**.

### Step 1: activate the device

1. Select **Sign in with GitHub**. If your browser asks to allow Clockoli access to GitHub, allow it; sign-in cannot continue without that access. Clockoli tries to copy the one-time code, reveals it character by character over about two seconds, then keeps it visible for another four seconds before opening GitHub. If copying is blocked, GitHub still opens; return to Settings and select **Copy**, or copy the visible code manually, before entering it on GitHub.
2. On GitHub, verify that you reached **github.com** for the Clockoli authorization you initiated in Settings.
3. Paste the one-time code and approve the request.
4. Return to Clockoli. It checks the result automatically; **Done on GitHub—check now** is also available.

Device activation signs this browser in without asking you to create or paste a personal access token. GitHub authorization and GitHub App repository access are separate steps.

### Step 2: connect time repositories

After sign-in, paste a GitHub repository URL (for example, `https://github.com/acme/time-data`) or `owner/name` into the repository field and leave the field or press Enter to check it. Alternatively, type at least two characters of a repository name to see up to eight matching GitHub App-granted repositories in an autocomplete dropdown. Choosing a suggestion checks that repository; merely typing or seeing a suggestion does not check or connect it. The refresh icon retries the current check and rotates while a manual or return-triggered check is in progress. No repository catalog is loaded when you first open setup without a remembered target; suggestions fetch the granted catalog on demand, not by querying GitHub for each keystroke. There is no separate existing/new or personal/organization choice: Clockoli inspects the selected repository's state and your permissions, regardless of its name.

If you need a repository, use the green **Create a new time repository** link at the beginning of the repository section. It opens GitHub and leaves a dialog in Settings: after creating the private repository, copy its URL from the GitHub address bar, return to Settings, paste it into the dialog, and select **Check repository**. This checks the target without connecting or initializing it. Creating a repository does not grant the Clockoli GitHub App access to it. After you grant access for a checked target, Clockoli rechecks it when the grant becomes available (usually within a few seconds); review the offered setup action without pressing the field's refresh icon. If checking fails, that icon remains available for a manual retry.

A suitable repository must be:

- private;
- not archived or disabled;
- writable by your GitHub user;
- granted to the Clockoli GitHub App with **Contents: Read and write**;
- compatible with direct writes under its branch rules.

Clockoli asks for **Grant access** only when the checked target is missing from the accessible list or needs App Contents-write permission. If Clockoli knows the owner's existing App installation, the link opens that installation's settings rather than starting another installation. Use **Only select repositories** and grant access only to the intended time repository or repositories. If you cannot change access, ask the repository owner or organization administrator; approval may be required.

The access dialog opens when a checked target is missing App access. **Grant access** closes the dialog and opens the known installation settings or the App install page. Returning to Settings checks an unresolved remembered target after a one-second settling delay, even if the access dialog was closed or Settings was reloaded. If the grant is not visible yet, finish it on GitHub and return again to recheck; the pending grant handoff does not poll in the background. If the target needs initialization, the review dialog opens once; nothing is written until you confirm there. Clockoli does not replace a missing target with another available repository. A missing private repository does not prove it does not exist: check its name, your GitHub access, the App grant, and any pending approval.

#### Review and confirm

**Check repository** verifies the current GitHub grant, permissions, membership, personal branch ownership, and task index. A grant or a previously checked Ready label alone cannot authorize writes. Checking changes neither repository files nor the list of connected destinations. A ready target offers **Connect repository** beside the field; select it and confirm to make the repository available locally, without writing repository files. The connection action validates again. Already-connected destinations are also checked when validating a replacement authorization. Checking a manual target or suggestion opens the relevant access or setup dialog when needed. The first confirmed connection, initialization, or join completes initial setup if it registers a usable default and no authorization is pending. For later additions, choose **Default time repository** separately and use **Finish setup** when ready; later additions do not change the existing default. You can add more from Settings later.

Discovery only reads GitHub. It runs on demand for autocomplete and explicit checks, and polls every 3 seconds during active setup only when a target is remembered or an authorization is pending. It never connects a repository by itself. Unchanged results preserve focus, scroll, drafts, messages, and open dialogs, except that a newly granted remembered target needing initialization opens its review dialog once. Background errors keep the last good suggestions without a notification; explicit checks report errors. Polling never reopens a dismissed review or performs remote writes. It may automatically confirm a same-account candidate authorization only after read-validating every configured destination and passing atomic active/queued-work guards.

New or replacement GitHub authorization is confirmed automatically when it belongs to the same GitHub identity, can read every configured time repository, and cannot strand active or queued work. If any check fails, the current credentials remain in use and Clockoli shows one account-level recovery message. There is no per-repository **Confirm authorization** button.

The access dialog’s **Create one on GitHub** link prefills the checked repository name and owner while retaining the private Clockoli template. GitHub may ignore the owner if you lack creation permission; verify the owner before creating. The top **Create a new time repository** link still suggests `clockoli-data`.

Discovery and inspection never write to GitHub or connect new repositories locally. Checked ready repositories appear in **Default time repository** only after you confirm **Connect repository**. Checking a pasted URL or autocomplete suggestion opens an action-specific setup dialog when needed. Read the privacy disclosure and, for actions that write remotely, **Repository writes**, then explicitly confirm the offered action:

- **Connect repository** adds an already-ready repository to this browser after another read-only validation; it does not change repository files.
- **Set up storage branch** explicitly creates or verifies a missing personal storage branch for an existing member. Invalid branch ownership or task-index data is unavailable until repaired; discovery never overwrites it.

- **Join repository** registers your GitHub identity in the initialized repository's Clockoli user list and creates or verifies your personal storage branch.
- **Initialize repository** creates the Clockoli marker and personal storage branch; for an empty repository, it also creates the first commit and default branch.

Clockoli rechecks repository state and permissions before applying the confirmed action. Initializing an organization repository requires fresh GitHub repository-admin permission; an ordinary teammate can join a valid initialized repository but cannot initialize an unmarked one. Editing the repository input invalidates selection and confirmation: finish the new target and review it before confirming.

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

1. A repository administrator signs in, chooses a suitable private repository from autocomplete or enters its URL, and grants the Clockoli GitHub App access only if needed. After checking the target, they explicitly confirm **Initialize repository** and copy the teammate instructions. Shared repositories may belong to a person or an organization; organization initialization requires fresh GitHub repository-admin permission.
2. Give each teammate the GitHub rights needed to read and write that repository.
3. Each teammate installs Clockoli, signs in with their own GitHub account, chooses the repository from autocomplete or enters its URL or `owner/name` and leaves the field to check it. If access is missing, follow the target-specific access instructions and return. Check the target and review the disclosure. If storage is already ready, explicitly confirm **Connect repository** to add it to this browser; otherwise confirm **Join repository** (or **Set up storage branch** if already a member with a missing branch).
4. Clockoli provisions a marked personal branch for each stable GitHub user ID.
5. Teammates can add that shared repository alongside other personal or organization time repositories and route projects to it.
6. Reports combines the selected visible repositories and branches.

Repository readers can see every stored URL, title, timestamp, and description included in shared reporting. Use separate data repositories for groups with different access boundaries.

Next: [Feature guide](features.md) or [Troubleshooting](troubleshooting.md).
