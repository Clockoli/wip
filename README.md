# Clockoli

Developer setup, architecture rules, testing, browser verification, and release packaging are documented in [CONTRIBUTING.md](CONTRIBUTING.md).

Clockoli is a Chrome/Chromium time tracker that stores your records in a private GitHub repository you control. It has no Clockoli application server and no separate time-tracking database.

Track a GitHub issue, a pull request, a document, a support ticket, or any other HTTP(S) URL. Clockoli captures the URL as the task identity; a title and description are optional.

## Why Clockoli

Most time trackers put your records in a vendor database. Clockoli writes readable text files to Git instead:

- **You own the data.** Access, retention, backup, and deletion follow the rules of your GitHub repository.
- **The history is inspectable.** Time files are readable without Clockoli, and edits remain visible in Git history.
- **There is no Clockoli backend.** The extension talks directly to GitHub.
- **It works beyond one issue tracker.** Any valid HTTP(S) URL can be a task.
- **It still feels native on GitHub.** A stopwatch appears in the GitHub header, while the browser toolbar popup works on other sites.
- **Team reporting does not require a second data silo.** Team members can write to isolated personal branches in one shared private repository; Reports reads them together.

Clockoli is a good fit when data ownership and auditability matter more than one-click SaaS onboarding. See [Why Clockoli](docs/why-clockoli.md) for a detailed comparison and the tradeoffs.

## Current beta installation

Clockoli currently runs as a trusted unpacked extension. This checkout and its locally built package identify as `v0.1.30`; the published `v0.1.11` GitHub release predates the features documented here.

1. Clone or update this repository:

   ```bash
   git clone git@github.com:clockoli/clockoli.git
   cd clockoli
   git switch main
   git pull --ff-only
   ```

2. Open `chrome://extensions` in Chrome or another Chromium browser.
3. Enable **Developer mode**.
4. Select **Load unpacked** and choose the repository root, the directory that contains `manifest.json`.
5. Pin Clockoli to the browser toolbar.
6. Open **Settings** and complete the four GitHub connection steps.

If a trusted maintainer gives you a current package, extract the ZIP first and load the extracted directory. Chrome cannot load the ZIP directly. Unpacked extensions do not update automatically; pull or replace the files and select **Reload** on `chrome://extensions` after an update.

Full setup instructions: [Getting started](docs/getting-started.md).

## Start tracking

1. Open the page you want to track.
2. Select the Clockoli toolbar icon.
3. Choose **Start tracking this task**.
4. When you finish, open Clockoli and choose **Stop and save**. Add a description if it will help later.

On GitHub, the same controls are available from the stopwatch beside your avatar. The arrow next to it opens **Tasks**, **Times**, and **Reports**.

Clockoli permits one running timer per connected GitHub account. If the panel says **Tracking another task**, stop the active timer before starting the current page.

## Features

### Tracking and correction

- Track any canonical HTTP(S) URL; task titles are optional.
- GitHub-header integration plus a toolbar popup for other sites.
- One GitHub-backed active timer per user, visible across connected browsers.
- Optional descriptions, up to 2,000 characters.
- Live elapsed time and rotating totals for Today, This week, Last week, and This month.
- Recent entries labeled Today, Yesterday, or by weekday.
- Direct one-line `HH : MM - HH : MM` time correction in the main panel.
- Start and Stop remain directly editable inline; wheel/trackpad gestures scroll normally and never change a time value.
- Automatic adjacent-boundary repair: moving Start into the previous interval moves the previous Stop; moving Stop into the next interval moves the next Start. The linked records are saved atomically.
- One unified inline draft for URL, optional title, Start, Stop, and description; Enter or **Save time** saves the complete draft.
- Conflict-safe **Delete**, with the prior version retained in Git history.
- Overlap warnings and a confirmation before saving entries longer than 12 hours.

### Tasks

- A **Recently tracked work** page for the current user.
- Deduplication by canonical task URL.
- Search by URL or optional title.
- Period filters from two weeks to one year.
- Totals include completed sessions and the currently running session.
- Aggregated completed and running time per task.

### Times

- A dedicated history page with day, week, month, and custom inclusive periods.
- Filter tracked entries by URL or optional title while preserving active linked drafts.
- Add multiple dated URL tasks in one all-or-nothing bulk import.
- Edit and delete historical rows with the same inline controls as the main tracker.

### Reports and billing

- Repository-wide reporting across marker-backed `clockoli/users/` personal branches; the default branch remains metadata-only.
- Preset weekly, monthly, quarterly, and yearly periods, plus a custom date range.
- People and Source facets. A Source is a GitHub owner/repository for GitHub tasks or a hostname for another URL.
- Total time, average time per distinct task, distinct task count, and billable amount.
- Independent Day, Week, Month, Person, Source, and Task chart dimensions.
- CSV and JSON timesheet downloads.
- Native print/save-to-PDF.
- Mixed-currency billable charts converted by day with locally cached rates from [Frankfurter](https://github.com/lineofflight/frankfurter).
- Browser-local effective-dated hourly rates with a currency sign or description stored in each rate. Rates and calculated money are never written to the data repository.

### Storage, sync, and privacy

- Backend-free GitHub App Device Flow with an advanced fine-grained PAT option.
- Dedicated private GitHub data repository, with one marked personal branch per user.
- Human-readable monthly JSONL files with UTC timestamps plus explicit local dates and IANA timezones.
- Exact per-task indexes for fast all-time participant totals without scanning monthly history.
- SHA-protected edits and deletes; multi-file corrections use one atomic Git commit.
- Locally queued Stop operations with automatic retry when GitHub is temporarily unavailable.
- Settings backup in readable JSON without credentials, active timers, pending writes, or tracked time.
- Credentials and local settings remain in extension-origin IndexedDB and are not exposed to GitHub pages.

See [Features](docs/features.md) for complete behavior and [Data, privacy, and security](docs/data-and-privacy.md) for the storage model.

## Documentation

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
- Current beta installation is unpacked and has no automatic updates.
- Start, Stop, and task switches are accepted durably in the local queue, then reconciled with GitHub asynchronously; unresolved conflicts can still require user action.
- One active timer per connected GitHub account.
- Manual time entry is available through the Times bulk importer; reminders, a mobile app, and an advanced side-by-side conflict editor are not included.
- The GitHub header control appears only on `github.com`; use the toolbar popup for other sites.
- Billable rates are local to each browser and are not shared with teammates.
- Anyone who can read the data repository can read stored URLs, titles, timestamps, and descriptions.

## Development

Requires Node.js 20+. There are no runtime or test dependencies.

```bash
npm test
npm run check
```

`npm run check` validates the Manifest V3 package inventory, referenced files, security invariants, and JavaScript syntax.

### Repository map

```text
src/api/          GitHub API client
src/auth/         GitHub App Device Flow and credential rotation
src/background/   Manifest V3 service worker and message boundary
src/content/      GitHub header control and shared tracking panel
src/domain/       records, task URLs, reports, settings, and text format
src/options/      onboarding and settings
src/popup/        browser toolbar popup
src/reports/      analytics and export page
src/services/     tracking, sync, repository, and reporting services
src/storage/      extension-origin IndexedDB adapter
src/tasks/        recently tracked work page
test/             dependency-free Node tests
```
