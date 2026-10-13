# Clockoli

**Own your time data without handing it to another SaaS.** Clockoli is a browser time tracker that writes readable records directly to private GitHub time repositories you control, with no application server or separate time-tracking database.

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
3. Open **Settings** and sign in with GitHub. Paste a time repository URL or `owner/name` and leave the field or press Enter to check it; you can also choose a matching App-granted suggestion. Explicitly confirm **Connect repository** if ready, or the offered setup action if not. The first confirmed connection completes initial setup when it becomes the usable default. For later additions, choose **Default time repository** if needed, then select **Finish setup**.
4. Open a page, select the Clockoli toolbar icon, and choose **Track this task** in the full-width panel. When finished, choose **Stop and save**.

Your **GitHub account** authenticates you; a **source repository** may own a tracked issue or pull request; a **time repository** stores your records. These can be different repositories. The [setup guide](docs/getting-started.md) explains repository access and confirmation.

On GitHub, you can also open the tracker from the stopwatch beside your avatar. Its smaller dialog says **Start tracking this task**; the arrow next to it opens **Top tasks**, **Activity**, and **Reports**.

## Install from a file

Download the files for your browser from a trusted GitHub release. Each browser uses the same extension source, with a generated manifest; store submissions remain manual.

- **Chrome/Chromium:** extract `Clockoli-X.Y.Z.zip` into a permanent folder. Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select that folder. The repository root remains the Chrome development extension.
- **Firefox 140+:** open `about:addons`, choose the gear menu → **Install Add-on From File**, and select `Clockoli-X.Y.Z-firefox-signed.xpi`, or the signed listed XPI downloaded from AMO. The unsigned `Clockoli-X.Y.Z-firefox.xpi` is for store submission and temporary testing: open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select it (or its extracted `manifest.json`). Temporary installs last until Firefox restarts.
- **Safari 18+ on macOS:** extract `Clockoli-X.Y.Z-safari-unsigned.zip`, move `Clockoli.app` to Applications, and open it. In Safari Settings → Advanced, enable features for web developers; use the **Develop** menu and Settings → Developer to enable **Allow unsigned extensions**, then enable Clockoli in Settings → Extensions. The option may need enabling again after Safari restarts. When available, `Clockoli-X.Y.Z-safari.zip` contains the signed, notarized app and does not need Allow Unsigned Extensions. The `.pkg` is the Mac App Store upload artifact.

For downloaded unsigned apps, macOS may require **Open Anyway** in System Settings → Privacy & Security. File installations do not include an automatic updater. Before replacing an installation or changing browser, sync pending writes, stop the timer, and export settings; credentials and local state do not transfer between browser profiles.

## What you can do

- Track any HTTP(S) task URL from the toolbar, or use the stopwatch built into GitHub.
- Keep one active timer across connected browsers and configured time repositories; switch tasks without running two timers at once.
- Correct or delete time entries, with previous versions retained in Git history; add completed entries in bulk on the Activity page.
- Find recently tracked work by task URL or title and see completed and running totals.
- Report across selected personal and organization time repositories, filter by person or task source, and export CSV or JSON timesheets.
- Apply browser-local hourly rates for billable reporting without writing rates to time repositories.
- Keep readable time records in private GitHub repositories you control; accepted timer actions are queued locally and synchronized automatically on a one-minute alarm when GitHub is available. Tracked-time completion commits remain individually linked to their GitHub issues.
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

- Firefox requires 140+ for built-in data consent; Safari requires 18+ on macOS. Chrome retains its existing manifest baseline.
- Unpacked installations have no automatic updates.
- Start, Stop, and task switches are accepted durably in the local queue, then reconciled with GitHub asynchronously; unresolved conflicts can still require user action.
- Manual time entry is available through the Activity bulk importer; reminders, a mobile app, and an advanced side-by-side conflict editor are not included.
- Anyone who can read a time repository can read the URLs, titles, timestamps, and descriptions stored in that repository.

## Development

Developer setup, architecture rules, testing, browser verification, and release packaging are documented in [CONTRIBUTING.md](CONTRIBUTING.md).

Requires Node.js 20.19+ (CI uses Node.js 22). The extension has no runtime package dependencies. Its timeline source and test tooling are included in the repository as an npm workspace.

```bash
npm ci
npm test
npm run check
```
