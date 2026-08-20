# GitHub Private Time Tracker

Chrome/Chromium extension for tracking time on GitHub issues and pull requests while keeping all records in a dedicated **private GitHub repository**. There is no application server or third-party time-tracking service.

## What is implemented

- Native-style split GitHub header control on every GitHub page. Its left stopwatch opens the full Start/Stop/recent/edit/delete/sync panel on issue and pull-request pages; elsewhere it opens navigation. The separately clickable arrow always opens Reports/Tasks navigation and survives GitHub SPA navigation.
- Main panel rotates the authenticated user's complete Today, This week, Last week, and This month totals; includes an unsynced completion exactly once and live running time; and formats recent timestamps with the browser's locale.
- Dedicated Reports page with repository-wide person/repository facets; selectable total time, average time per distinct task, or distinct task count; independent day/week/month/person/repository/task horizontal and stack dimensions; direct CSV/JSON timesheet downloads; and native print/save-to-PDF for weekly, monthly, quarterly, yearly, and custom periods.
- Dedicated **Recently tracked work** page: current-user issues and pull requests are deduplicated, hydrated with cached GitHub titles/status, sorted by completed plus currently running time, filtered as you type, and controlled with inline Start/Stop buttons. Its rolling period defaults to two weeks and persists locally; unavailable status appears only under All.
- Toolbar popup with running timer, recent 7-day entries, editing, and deletion.
- Fine-grained PAT setup and validation against the configured repository.
- Authenticated GitHub login as the canonical user ID.
- One GitHub-backed active timer per user.
- One human-editable plain-text file per GitHub user per local month.
- SHA-protected edits/deletes and safe conflict errors.
- Local cache and an idempotent offline Stop queue.
- Stop retries match the full intended record; concurrent Stops converge only when the active file is already gone and exactly one same-URL/same-Start completion exists.
- 12-hour long-entry warning.
- Configurable allowed issue owners and recent-entry window.
- Recent entries are sorted by their editable start timestamp across the selected window. Loading requires at most one direct GitHub read per represented month rather than one read per record.

Deferred by the specification: manual entries, GitHub App auth, Firefox packaging, reminders, and advanced conflict-diff UI.

## Install for development

1. Clone this repository.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and choose this repository root.
5. Open the extension’s **Settings**.
6. Configure a private time-data repository and a [fine-grained GitHub token](https://github.com/settings/personal-access-tokens) restricted to it with **Contents: Read and write**.

The data repository must already exist and allow direct commits to its configured branch. See [docs/time-data-repository.md](docs/time-data-repository.md). The selected Version 1 defaults and requirement mapping are documented in [docs/spec-compliance.md](docs/spec-compliance.md).

## Usage

1. Open GitHub. The split stopwatch control is immediately before your avatar on every page.
2. On an issue or pull request, use the left stopwatch for tracking. On other GitHub pages, either segment opens Reports/Tasks navigation. The arrow always opens that navigation menu.
3. Open the stopwatch dropdown to Start, Stop with an optional description, check sync status, or retry pending synchronization.
4. The dropdown rotates complete totals for today, this week, last week, and this month; edit or delete recent records directly there or in the toolbar popup.
5. Choose **Reports** for repository-wide analytics, or **Tasks** for your recently tracked issues and pull requests. The stopwatch is gray while idle and green while any timer is running.

A running timer is authoritative from its Start timestamp; elapsed time is always `now - Start`, not a browser tick counter. Its local calendar month selects the eventual monthly file.

## Storage layout

```text
active/{github-login}.txt
times/{local YYYY-MM}/{github-login}.txt
```

The login is derived from the file name, not repeated inside the file. Completed records are blank-line-separated blocks:

```text
URL: https://github.com/acme/frontend/issues/123
Start: 2026-08-19T09:00:00+03:00
End: 2026-08-19T10:15:00+03:00
Description: optional single-line text
```

`Description` is omitted when empty. Every timestamp includes a timezone. The active file uses the same format without `End`. Files can be maintained manually as long as field names, canonical GitHub URLs, timestamp timezones, Start months matching their `times/YYYY-MM/` directory, and blank-line record separators are preserved.

A normal recent-entry refresh performs one direct file read per represented month (normally one or two). Editing or deleting rewrites one monthly file. Same-month edits and boundary changes perform one SHA-guarded write; cross-month changes update every affected monthly file in one atomic Git commit. Reports persist raw immutable blobs by Git SHA in extension-origin IndexedDB and conditionally validate the branch ref with an ETag. The Tasks page selects only the authenticated user's monthly paths before blob reads, applies explicit file/byte/record/metadata-request budgets, and caches issue/PR metadata for 15 minutes. An unchanged branch is served from the cache after a `304 Not Modified`; a changed branch downloads only missing blob SHAs. Obsolete report loads are aborted before a newer range begins.

Every operation uses predictable commit messages without descriptions.


## Failure and conflict behavior

Stop first verifies that the cached timer still matches GitHub when the repository is reachable; a changed timer is shown instead of completing stale data. If GitHub is temporarily unreachable, the cached completion remains offline-capable. The extension then queues the completion in extension-origin IndexedDB and synchronization:

1. reads the target monthly text file once;
2. adopts the exact intended record, recognizes a concurrent Stop only when the active file is gone and one matching timer completion exists, or appends with SHA protection;
3. persists the queue stage;
4. clears the active file with its known SHA, re-reading only to reconcile a conflict;
5. preserves any newer active timer.

A network failure leaves the queue retryable. A changed active timer or stale monthly-file SHA is never silently overwritten. Manually malformed monthly files produce a visible error so they can be repaired directly in GitHub.

Changing the target data repository is blocked while writes are pending.

## Security model

- PAT and persistent state are stored in extension-origin IndexedDB and used by extension pages/service worker. The extension requests no `chrome.storage` permission, so GitHub content scripts cannot read that database.
- PAT is never sent to content scripts, page JavaScript, URLs, logs, analytics, commit messages, or data files.
- API host access is limited to `https://api.github.com/*`.
- Page integration is limited to `https://github.com/*` and validates exact issue and pull-request URL forms.
- Owner, repository, login, issue number, and generated paths are validated before writes.
- Untrusted issue titles/descriptions are rendered via `textContent`; remote content is never executed.
- Tokens should be fine-grained, repository-restricted, and granted only **Contents: Read and write**.

Browser extension storage does not provide OS-keychain encryption semantics for arbitrary values. A malicious local process, browser compromise, or sufficiently privileged malicious extension remains outside this extension’s protection boundary.

## Development

Requires Node.js 20+; there are no runtime or test dependencies.

```bash
npm test
npm run check
```

`npm run check` validates the manifest, referenced files, extension security invariants, and JavaScript syntax.

## Repository map

```text
src/api/          GitHub Contents API client
src/background/   MV3 service worker and message boundary
src/content/      GitHub issue/pull-request header control and dropdown
src/domain/       validation, monthly text format, records, paths, timestamps
src/options/      secure setup and validation
src/reports/      repository-wide facets, analytics chart, and timesheet export
src/tasks/        recent tracked-work list, live filtering, and Start/Stop controls
src/popup/        active/recent/edit/delete UI
src/services/     timer and synchronization state machine
src/storage/      extension-origin IndexedDB adapter
test/             dependency-free Node tests
```
