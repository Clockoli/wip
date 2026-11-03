# Getting started

Sign in with GitHub, connect a private time repository, and track your first task. Setup takes two guided steps in Settings.

## Before you begin

You need:

- Clockoli installed in a [supported browser](install.md#supported-browsers);
- a GitHub account;
- read/write access to a private GitHub repository for your time records, or permission to create one. It may belong to you, another person, or an organization.

The repository that stores your time is your **time repository**. It is separate from the repositories, documents, and tickets you track, and Clockoli never needs write access to those. See [Key concepts](concepts.md).

Settings opens by itself after installation. To reopen it, select the gear button in the Clockoli panel, or open the extension's details page. Until setup is complete, Settings focuses on the connection card; **More settings** holds Billable rates, Backup & restore (including **Import settings**), and **Advanced**.

## Step 1: Sign in with GitHub

1. Select **Sign in with GitHub**. If the browser asks for permission to contact GitHub, allow it. Clockoli requests a one-time code and **tries to copy it to the clipboard**. Settings shows either **Code copied to your clipboard** or a clear copying error; it never assumes a copy succeeded.
2. If copying succeeded, GitHub opens automatically after the code is shown. When GitHub asks for a code, **press ⌘V on macOS or Ctrl+V on Windows/Linux** to paste it; you do not need to retype the code. Confirm that you are on **github.com** and authorizing **Clockoli**, then approve.
3. If automatic copying failed, **GitHub does not open automatically**. Stay in Settings, choose **Copy**, then **Open GitHub to enter code**. If browser clipboard access is blocked, select the displayed code and copy it with ⌘C (macOS) or Ctrl+C (Windows/Linux), then open GitHub and paste it.
4. Return to Clockoli. It checks the authorization result automatically; **Done on GitHub—check now** retries immediately. If a tab failed to open, use **Open GitHub to enter code** instead.

Sign-in uses GitHub's [device flow](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow), so you never create or paste a personal access token. Signing in and giving the Clockoli GitHub App access to a repository are separate steps.

## Step 2: Connect a time repository

1. Paste the repository's GitHub URL (for example, `https://github.com/acme/time-data`) or `owner/name` into the repository field and click **Check** (or press Enter). You can also type at least two characters of a repository name and choose one of the suggestions.
2. If Clockoli shows **Grant access**, select it. On GitHub, choose **Only select repositories**, add the time repository, and save. Return to Settings: Clockoli checks the repository again by itself.
3. Read the privacy disclosure and, for actions that write to GitHub, **Repository writes**, then explicitly confirm the offered action:
   - **Connect repository** adds a repository that is already set up for Clockoli. It changes no repository files.
   - **Initialize repository** prepares a new repository: it creates the Clockoli marker and your personal storage branch, and for an empty repository also the first commit and default branch.
   - **Join repository** adds you to a repository a teammate already initialized and creates your personal storage branch.
   - **Set up storage branch** creates or verifies a missing personal storage branch when you are already a member.

The first repository you connect becomes your default and completes setup. When you add more later, choose the **Default time repository** and select **Finish setup**.

### No time repository yet?

Select **Create a new time repository** below the repository field. GitHub opens with the private Clockoli template, suggested as `clockoli-data`. After creating the repository, copy its URL from the GitHub address bar, return to Settings, paste it into the **New repository URL** dialog, and select **Check repository**. Then continue with step 2 above: creating a repository does not grant the Clockoli GitHub App access to it.

### Which repositories work

A time repository must be:

- private;
- not archived or disabled;
- writable by your GitHub user;
- granted to the Clockoli GitHub App with **Contents: Read and write**;
- compatible with direct writes under its branch rules.

Initializing an organization repository requires fresh GitHub repository-admin permission. An ordinary teammate can join a repository an administrator already initialized; see [Work as a team](teams.md).

### What Clockoli checks before writing

Discovery and inspection never write to GitHub or connect new repositories locally. Nothing is written until you confirm an action, and Clockoli rechecks the repository and your permissions just before applying it. Clockoli does not replace a missing target with another available repository: if a private repository cannot be found, check its name, your GitHub access, the App grant, and any pending organization approval.

Anyone with read access to the time repository can see the task URLs, titles, timestamps, and descriptions stored there. Use a separate repository for each group of people who should see different data.

[Time repositories](time-data-repository.md#connect-a-repository) explains every check, dialog, and setup action in detail.

## Track your first task

A task is any HTTP(S) page; its URL is the task's identity and the title is optional.

### On any website

1. Open the page you want to track.
2. Select the Clockoli toolbar icon.
3. In the panel, choose **Track this task**.
4. Work normally.
5. Open Clockoli again, add a description if useful, and choose **Stop and save**.

The panel uses the current tab's URL and title. Internal browser pages such as `chrome://extensions` are not HTTP(S) pages and cannot be tasks; on them, the toolbar opens **Activity** instead.

### On GitHub

Clockoli adds a split stopwatch control before your GitHub avatar. The stopwatch opens the tracking panel for the current issue or pull request; the arrow opens **Top tasks**, **Activity**, and **Reports**. GitHub titles are used when GitHub provides them.

Clockoli runs one timer at a time: starting another task saves the running one first. See [Track a task](tracking.md).

## Use a personal access token instead

If your environment cannot install the Clockoli GitHub App, or you already use the compatibility flow, open **More settings** → **Advanced** → **Use a personal access token**. After connecting, **Advanced** is available directly on the page.

PAT compatibility mode supports one time repository only. Create a fine-grained personal access token restricted to that private repository with **Contents: Read and write**, then enter the repository owner, repository name, branch, and token. Select **Validate and use PAT**. Clockoli validates the GitHub identity, private repository, branch, and write route before saving the configuration, and never displays a stored token again.

## Next steps

- [Track a task](tracking.md): the panel, the GitHub stopwatch, switching tasks, and descriptions.
- [Add and edit time](editing-time.md): fix forgotten timers and add missed work.
- [Reports](reports.md) and [Invoicing](invoicing.md): turn tracked time into timesheets and invoices.
- [Projects and routing](projects-and-routing.md): send different work to different time repositories.
- [Work as a team](teams.md): share a time repository with teammates.
- [Settings](settings.md): every other option, including backups. Keep the **GitHub account**, **Time repositories**, and **Projects and routing** sections apart: they control sign-in, storage, and where new time goes.
