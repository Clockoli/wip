# Specification analysis and MVP compliance

Source analyzed: `github_time_tracking_extension_spec.md`, draft dated 2026-08-18.

## Selected defaults

The specification leaves several Version 1 choices open. This implementation selects its recommended defaults:

| Decision | Implementation |
|---|---|
| Browser | Chrome/Chromium Manifest V3; Chrome 102+ |
| Work items | Canonical GitHub issue and pull-request pages |
| Descriptions | Optional, maximum 2,000 characters |
| Manual entries | Deferred to MVP 1.1 |
| Offline behavior | Start requires GitHub connectivity; Stop is queued locally and retried |
| Recent entries | Seven browser-local calendar days by default, configurable from 1–31; globally sorted by editable start timestamp; maximum 50 returned; 200-candidate API safety limit |
| External issue owners | Configurable allowlist; defaults to the time-data repository owner |
| Storage | One configured private GitHub repository and canonical branch |
| Deletion | Allowed after explicit confirmation, with Git history retained |
| Long entries | Warning above 12 hours |
| Issue title | Captured from the GitHub issue page when available |
| Active state | `active/{login}.json` is deleted after a successful Stop |
| Authentication | Fine-grained PAT; GitHub App deferred |

## Architecture mapping

- `src/content/github.js` detects canonical `/{owner}/{repo}/issues/{number}` and `/{owner}/{repo}/pull/{number}` pages, survives dynamic GitHub navigation, and inserts a native-style stopwatch control immediately before the avatar. Its closed-Shadow dropdown provides numbered Start actions, Stop, sync status/retry, recent entries, edit/delete, draggable ±12-hour time adjustment, adjacent-entry boundary movement, and Settings; the icon is gray while idle and green while any timer is active.
- `src/background/service-worker.js` owns privileged messages, GitHub API access, synchronization, and timer mutations.
- `src/api/github-client.js` implements authenticated user lookup plus GitHub Contents API read/list/create/update/delete operations.
- `src/services/tracker.js` implements one active timer per authenticated user, globally ordered recent entries across all configured date directories, SHA-safe edits/deletes and rollback-protected two-entry boundary movement, pending Stop retries, and idempotent partial-failure recovery.
- `src/storage/chrome-store.js` stores configuration, the PAT, cache, and pending writes in extension-origin IndexedDB. The extension requests no `chrome.storage` permission, so GitHub content scripts cannot access this database.
- `src/popup/*` provides the toolbar-popup version of the active timer, optional Stop description, recent records, edit/delete UI, sync status, and conflict acknowledgement.
- `src/options/*` validates the authenticated user, private repository, branch, write access, owner policy, and recent-entry window.

## Data and concurrency invariants

- Canonical identity is the login returned by GitHub's authenticated-user endpoint.
- Active state is stored at `active/{login}.json`.
- Completed entries are stored at `entries/{login}/{local YYYY}/{MM}/{DD}/{ULID}.json`.
- Timestamps are UTC; `entryDate` captures the browser-local date at Start and is persisted in both active and completed records, so cross-time-zone Stops converge on one path. Legacy active records without `entryDate` use the UTC start date deterministically.
- Duration is recomputed from `endedAt - startedAt` and is never based on render ticks.
- A stable entry ULID is reserved at Start. Legacy active records without one derive a deterministic ID.
- Stop is placed in local storage before network writes. Retry checks the exact expected entry content before treating an existing path as idempotent success.
- The active file is deleted only if the latest GitHub value still represents the stopped timer.
- Entry edits and deletes require the exact latest SHA and never silently overwrite concurrent changes.
- GitHub-backed records, repository coordinates, branch, issue data, dates, IDs, timestamps, and paths are validated before use.

## Privacy and permissions

- The extension writes only to the configured private time-data repository.
- It never posts time data or descriptions to source issues.
- The PAT is used only in extension-controlled contexts and is never returned to the content script or page.
- API host access is restricted to `https://api.github.com/*`.
- The configured data repository must be private and accessible on the configured branch.
- Commit messages contain stable identifiers and durations, never free-text descriptions.

## MVP acceptance coverage

Automated tests cover canonical issue/pull-request detection, path/date validation, record validation, UTF-8 GitHub content handling, private-repository enforcement, sender trust boundaries, timer accuracy, SHA conflicts, restart recovery, offline Stop retries, duplicate prevention, partial Stop recovery, globally ordered recent-entry limits, oversized-directory API-budget rejection, stable malformed-entry conflicts with explicit retry, URL-churn refresh isolation, delayed GitHub-header recovery, before-avatar placement, idle/running icon state, numbered Start labels, draggable time bounds, boundary preflight/rollback, popup Stop-state reset, cross-device Stop convergence, legacy records, and concurrent Stop serialization.

Manual entry, older-entry search, reminders, GitHub App authentication, reporting, and Firefox packaging remain intentionally outside MVP 1, consistent with the specification's suggested scope.
