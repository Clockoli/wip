# GitHub Private Time Tracker

Chrome/Chromium extension for tracking time on GitHub issues while keeping all records in a dedicated **private GitHub repository**. There is no application server or third-party time-tracking service.

## What is implemented

- GitHub issue-page Start/Stop panel that survives GitHub SPA navigation.
- Toolbar popup with running timer, recent 7-day entries, editing, and deletion.
- Fine-grained PAT setup and validation against the configured repository.
- Authenticated GitHub login as the canonical user ID.
- One GitHub-backed active timer per user.
- One JSON file per completed entry.
- SHA-protected edits/deletes and safe conflict errors.
- Local cache and an idempotent offline Stop queue.
- A stable entry ULID reserved at Start, making retries and cross-device Stop races converge on one file.
- 12-hour long-entry warning.
- Configurable allowed issue owners and recent-entry window.
- Recent entries are sorted by their editable start timestamp across the selected window. A 200-candidate safety limit fails before per-file reads rather than exhausting GitHub API quota on an unexpectedly large or hostile directory.

Deferred by the specification: pull requests, manual entries, GitHub App auth, reporting, Firefox packaging, reminders, and advanced conflict-diff UI.

## Install for development

1. Clone this repository.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked** and choose this repository root.
5. Open the extension’s **Settings**.
6. Configure a private time-data repository and a fine-grained GitHub token restricted to it with **Contents: Read and write**.

The data repository must already exist and allow direct commits to its configured branch. See [docs/time-data-repository.md](docs/time-data-repository.md). The selected Version 1 defaults and requirement mapping are documented in [docs/spec-compliance.md](docs/spec-compliance.md).

## Usage

1. Open `https://github.com/{owner}/{repo}/issues/{number}`.
2. Start from the injected panel or toolbar popup.
3. Stop and optionally enter a description.
4. Edit or delete recent records in the popup.

A running timer is authoritative from `startedAt`; elapsed time is always `now - startedAt`, not a browser tick counter. Start also stores `entryDate` (the browser-local calendar date at Start), so every device writes the eventual entry to the same directory.

## Storage layout

```text
active/{github-login}.json
entries/{github-login}/{local YYYY}/{MM}/{DD}/{ULID}.json
```

Timestamps are stored in UTC. Entry directories use the browser-local calendar date at the timer’s start. Editing a start time does not relocate the original file, preserving the entry’s path and Git history.

Every operation uses predictable commit messages without descriptions:

```text
timer: start alice on acme/frontend#123
time: add alice 1h42m on acme/frontend#123
time: edit 01K2ABCDEF...
time: delete 01K2ABCDEF...
timer: clear alice
```

## Failure and conflict behavior

Start reserves the eventual entry ULID in the GitHub-backed active timer. Stop first persists that stable-ID operation in extension-origin IndexedDB. Synchronization then:

1. checks whether the entry path already exists;
2. creates it only if absent;
3. persists the queue stage;
4. fetches the latest active-timer SHA;
5. clears it only when it still matches the stopped timer.

A network failure at any point leaves the queue retryable. A changed active timer or stale entry SHA is never silently overwritten. When the active timer changed on another device after the entry was saved, the popup preserves the newer GitHub timer and lets the user acknowledge that safe resolution. Entry-path conflicts also remain visible: after repairing or removing the conflicting GitHub file, the popup can retry the queued completion. No conflict is overwritten silently.

Changing the target data repository is blocked while writes are pending.

## Security model

- PAT and persistent state are stored in extension-origin IndexedDB and used by extension pages/service worker. The extension requests no `chrome.storage` permission, so GitHub content scripts cannot read that database.
- PAT is never sent to content scripts, page JavaScript, URLs, logs, analytics, commit messages, or data files.
- API host access is limited to `https://api.github.com/*`.
- Page integration is limited to `https://github.com/*` and validates exact issue URL forms.
- Owner, repository, login, issue number, IDs, and generated paths are validated before writes.
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
src/content/      GitHub issue-page panel
src/domain/       validation, records, paths, timestamps, ULIDs
src/options/      secure setup and validation
src/popup/        active/recent/edit/delete UI
src/services/     timer and synchronization state machine
src/storage/      chrome.storage adapter
schema/           JSON schemas
test/             dependency-free Node tests
```
