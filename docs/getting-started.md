# Getting started with Clockoli

Clockoli uses one GitHub account for sign-in and can store time records in several dedicated private GitHub time repositories. This guide takes you from a fresh installation to your first tracked task.

## What you need

- Clockoli installed in a [supported browser](install.md#supported-browsers).
- A GitHub account.
- Read/write access to a suitable private time repository, or permission to create one. It may belong to you, another person, or an organization. Initializing an organization repository requires GitHub repository-admin permission.

A time repository is separate from the source repositories, documents, tickets, and pages you track. Clockoli does not need write access to a source repository just because one of its issues or pull requests is a task. Your GitHub account supplies identity and access; it is not itself either kind of repository.

## 1. Install Clockoli

Add Clockoli from the [Chrome Web Store](https://chromewebstore.google.com/detail/clockoli/omkikhlcnbjpfbiicogjekhjgmbajmnl) and pin it to the toolbar. For Firefox, Safari, a development checkout, or updating a file installation, see [Install Clockoli](install.md).

## 2. Set up Clockoli

Clockoli Settings opens after the first installation. You can reopen it from the gear button in the Clockoli panel or from the extension details page.

Normal setup has two guided steps: sign in with GitHub, then check a time repository and confirm **Connect repository** if ready (or the offered setup action). A usable first connection becomes the default and completes initial setup; for later additions, choose a default if needed and select **Finish setup**. Before connecting, Settings focuses on the connection card. Open **More settings** for Billable rates, Backup & restore (including **Import settings**), and **Advanced**.

### Step 1: activate the device

1. Select **Sign in with GitHub**. If the browser requests permission to contact GitHub, allow it. Clockoli requests a one-time code and **tries to copy it to the clipboard**. Settings shows either **Code copied to your clipboard** or a clear copying error; it never assumes a copy succeeded.
2. If copying succeeded, GitHub opens automatically after the code is shown. When GitHub asks for a code, **press ⌘V on macOS or Ctrl+V on Windows/Linux** to paste it; you do not need to retype the code. Confirm that you are on **github.com** and authorizing **Clockoli**, then approve.
3. If automatic copying failed, **GitHub does not open automatically**. Stay in Settings, choose **Copy**, then **Open GitHub to enter code**. If browser clipboard access is blocked, select the displayed code and copy it with ⌘C (macOS) or Ctrl+C (Windows/Linux), then open GitHub and paste it.
4. Return to Clockoli. It checks the authorization result automatically; **Done on GitHub—check now** can retry immediately. If a tab failed to open, use **Open GitHub to enter code** instead.

Device activation uses GitHub's [device flow](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow). It signs this browser in without asking you to create or paste a personal access token. GitHub authorization and GitHub App repository access are separate steps.

### Step 2: connect time repositories

After sign-in, the primary action is **Connect an existing repository**. Paste its GitHub URL (for example, `https://github.com/acme/time-data`) or `owner/name` into the repository field and click **Check** (or press Enter) to inspect it. Leaving the field does not start a check. Alternatively, type at least two characters of a repository name to see up to eight matching GitHub App-granted repositories in an autocomplete dropdown. Choosing a suggestion checks that repository; merely typing or seeing a suggestion does not check or connect it. The **Check** button also retries a check and displays **Checking…** while a manual or return-triggered check is in progress. No repository catalog is loaded when you first open setup without a remembered target; suggestions fetch the granted catalog on demand, not by querying GitHub for each keystroke. There is no separate existing/new or personal/organization choice: Clockoli inspects the selected repository's state and your permissions, regardless of its name.

If you do not have a time repository yet, use the secondary **Create a new time repository** link below the existing-repository field. It opens GitHub and leaves a dialog in Settings: after creating the private repository, copy its URL from the GitHub address bar, return to Settings, paste it into the dialog, and select **Check repository**. This checks the target without connecting or initializing it. Creating a repository does not grant the Clockoli GitHub App access to it. After you grant access for a checked target, Clockoli rechecks it when the grant becomes available (usually within a few seconds); review the offered setup action without pressing **Check** again. If checking fails, **Check** remains available for a manual retry.

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

Clockoli runs one timer at a time. Starting another task saves the running one first; see [Track a task](tracking.md#one-timer-at-a-time).

## Next steps

- [Track a task](tracking.md) covers the panel, the GitHub stopwatch, switching, and descriptions.
- [Activity](activity.md) and [Add and edit time](editing-time.md) show how to review and correct entries.
- [Reports](reports.md), [Billable rates](billable-rates.md), and [Invoicing](invoicing.md) turn tracked time into timesheets and invoices.
- [Projects and routing](projects-and-routing.md) sends work to different time repositories.
- [Work as a team](teams.md) explains shared repositories and teammate invitations.
- [Settings](settings.md) describes every remaining option, including backups.
- [Troubleshooting](troubleshooting.md) helps when something does not work.
