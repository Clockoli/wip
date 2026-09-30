# Clockoli

**Own your time data without handing it to another SaaS.** Clockoli is a Chrome/Chromium time tracker that writes readable records directly to private GitHub time repositories you control, with no application server or separate time-tracking database.

Track a GitHub issue, a pull request, a document, a support ticket, or any other HTTP(S) URL. Clockoli captures the URL as the task identity; a title and description are optional.

## Why Clockoli

Most time trackers put your records in a vendor database. Clockoli writes readable text files to Git instead:

- **You own the data.** Access, retention, backup, and deletion follow the rules of your GitHub repository.
- **The history is inspectable.** Time files are readable without Clockoli, and edits remain visible in Git history.
- **There is no Clockoli backend.** The extension talks directly to GitHub.

Clockoli is a good fit when data ownership and auditability matter more than one-click SaaS onboarding. See [Why Clockoli](docs/why-clockoli.md) for a detailed comparison and the tradeoffs.

## Quick start

Clockoli currently runs as a trusted unpacked extension. Use the current checkout or a trusted current package; see [Getting started](docs/getting-started.md) for version guidance, package installation, and update instructions.

1. Clone this repository:

   ```bash
   git clone git@github.com:clockoli/clockoli.git
   cd clockoli
   ```

2. In Chrome or another Chromium browser, open `chrome://extensions`, enable **Developer mode**, and select **Load unpacked**. Choose the repository root containing `manifest.json`, then pin Clockoli to the toolbar.
3. Open **Settings** and sign in with GitHub. Use **Check repository** to inspect a time repository, then explicitly confirm **Connect repository** if ready, or the offered setup action if not. Choose **Default time repository**, then select **Finish setup**.
4. Open a page, select the Clockoli toolbar icon, and choose **Start tracking this task**. When finished, choose **Stop and save**.

Your **GitHub account** authenticates you; a **source repository** may own a tracked issue or pull request; a **time repository** stores your records. These can be different repositories. The [setup guide](docs/getting-started.md) explains repository access and confirmation.

On GitHub, you can also open the tracker from the stopwatch beside your avatar. The arrow next to it opens **Tasks**, **Times**, and **Reports**.

## What you can do

- Track any HTTP(S) task URL from the toolbar, or use the stopwatch built into GitHub.
- Keep one active timer across connected browsers and configured time repositories; switch tasks without running two timers at once.
- Correct or delete time entries, with previous versions retained in Git history; add completed entries in bulk on the Times page.
- Find recently tracked work by task URL or title and see completed and running totals.
- Report across selected personal and organization time repositories, filter by person or task source, and export CSV or JSON timesheets.
- Apply browser-local hourly rates for billable reporting without writing rates to time repositories.
- Keep readable time records in private GitHub repositories you control; accepted timer actions are queued locally and synchronized when GitHub is available.
- Migrate user-supplied Clockify annual Detailed Reports via in-page capture or CSV export, with a preview and explicit mapped-user import. See [Add-ons](docs/add-ons.md).

See [Features](docs/features.md) for complete behavior and [Data, privacy, and security](docs/data-and-privacy.md) for the storage model.

## More documentation

- [Documentation index](docs/README.md)
- [Getting started](docs/getting-started.md)
- [Feature guide](docs/features.md)
- [Why Clockoli](docs/why-clockoli.md)
- [Data, privacy, and security](docs/data-and-privacy.md)
- [Add-ons](docs/add-ons.md): first-party packaged add-on architecture and provider boundaries.
- [Time-data repository setup](docs/time-data-repository.md)
- [Troubleshooting](docs/troubleshooting.md)

## Current limitations

- Chrome/Chromium 102 or newer; no Firefox package.
- Unpacked installations have no automatic updates.
- Start, Stop, and task switches are accepted durably in the local queue, then reconciled with GitHub asynchronously; unresolved conflicts can still require user action.
- Manual time entry is available through the Times bulk importer; reminders, a mobile app, and an advanced side-by-side conflict editor are not included.
- Anyone who can read a time repository can read the URLs, titles, timestamps, and descriptions stored in that repository.

## Development

Developer setup, architecture rules, testing, browser verification, and release packaging are documented in [CONTRIBUTING.md](CONTRIBUTING.md).

Requires Node.js 20.19+ (CI uses Node.js 22). The extension has no runtime package dependencies. Its timeline source and test tooling are included in the repository as an npm workspace.

```bash
npm ci
npm test
npm run check
```
