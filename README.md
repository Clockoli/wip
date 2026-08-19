# GitHub Private Time Tracker

Chrome/Chromium extension for tracking time on GitHub issues and pull requests while keeping all records in a dedicated **private GitHub repository**. There is no application server or third-party time-tracking service.

## What is implemented

- Native-style GitHub header control on issue and pull-request pages: a gray idle stopwatch, green running stopwatch, dropdown arrow, and full Start/Stop/recent/edit/delete/sync menu that survives GitHub SPA navigation. Edit an entry end time by dragging up to ±12 hours, and drag a boundary between adjacent entries across its full valid range to move both timestamps together.
- Toolbar popup with running timer, recent 7-day entries, editing, and deletion.
- Fine-grained PAT setup and validation against the configured repository.
- Authenticated GitHub login as the canonical user ID.
- One GitHub-backed active timer per user.
- One human-editable plain-text file per GitHub user per local day.
- SHA-protected edits/deletes and safe conflict errors.
- Local cache and an idempotent offline Stop queue.
- Stop retries match the full intended record; concurrent Stops converge only when the active file is already gone and exactly one same-URL/same-Start completion exists.
- 12-hour long-entry warning.
- Configurable allowed issue owners and recent-entry window.
- Recent entries are sorted by their editable start timestamp across the selected window. Loading requires at most one direct GitHub read per day rather than one read per record.

Deferred by the specification: manual entries, GitHub App auth, reporting, Firefox packaging, reminders, and advanced conflict-diff UI.

## Install for development

1. Clone this repository.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and choose this repository root.
5. Open the extension’s **Settings**.
6. Configure a private time-data repository and a [fine-grained GitHub token](https://github.com/settings/personal-access-tokens) restricted to it with **Contents: Read and write**.

The data repository must already exist and allow direct commits to its configured branch. See [docs/time-data-repository.md](docs/time-data-repository.md). The selected Version 1 defaults and requirement mapping are documented in [docs/spec-compliance.md](docs/spec-compliance.md).

## Usage

1. Open `https://github.com/{owner}/{repo}/issues/{number}` or `https://github.com/{owner}/{repo}/pull/{number}`.
2. Use the stopwatch control immediately before your GitHub avatar, or use the extension toolbar popup.
3. Open the stopwatch dropdown to Start, Stop with an optional description, check sync status, or retry pending synchronization.
4. Edit or delete recent records directly in the dropdown or toolbar popup. The stopwatch is gray while idle and green while any timer is running.

A running timer is authoritative from its Start timestamp; elapsed time is always `now - Start`, not a browser tick counter. Its local calendar date selects the eventual daily file.

## Storage layout

```text
active/{github-login}.txt
times/{local YYYY-MM-DD}/{github-login}.txt
```

The login is derived from the file name, not repeated inside the file. Completed records are blank-line-separated blocks:

```text
URL: https://github.com/acme/frontend/issues/123
Start: 2026-08-19T09:00:00+03:00
End: 2026-08-19T10:15:00+03:00
Description: optional single-line text
```

`Description` is omitted when empty. Every timestamp includes a timezone. The active file uses the same format without `End`. Files can be maintained manually as long as field names, canonical GitHub URLs, timestamp timezones, Start dates matching their `times/YYYY-MM-DD/` directory, and blank-line record separators are preserved.

A normal recent-entry refresh performs one direct file read per configured day. Editing or deleting rewrites one daily file. Moving a boundary between two records in the same daily file performs one write; cross-day edits and boundaries update every affected daily file in one atomic Git commit.

Every operation uses predictable commit messages without descriptions.


## Failure and conflict behavior

Stop first verifies that the cached timer still matches GitHub when the repository is reachable; a changed timer is shown instead of completing stale data. If GitHub is temporarily unreachable, the cached completion remains offline-capable. The extension then queues the completion in extension-origin IndexedDB and synchronization:

1. reads the target daily text file once;
2. adopts the exact intended record, recognizes a concurrent Stop only when the active file is gone and one matching timer completion exists, or appends with SHA protection;
3. persists the queue stage;
4. clears the active file with its known SHA, re-reading only to reconcile a conflict;
5. preserves any newer active timer.

A network failure leaves the queue retryable. A changed active timer or stale daily-file SHA is never silently overwritten. Manually malformed daily files produce a visible error so they can be repaired directly in GitHub.

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
src/domain/       validation, daily text format, records, paths, timestamps
src/options/      secure setup and validation
src/popup/        active/recent/edit/delete UI
src/services/     timer and synchronization state machine
src/storage/      extension-origin IndexedDB adapter
test/             dependency-free Node tests
```
