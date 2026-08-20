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
| Recent entries | Seven browser-local calendar days by default, configurable from 1–31; one direct monthly-file read per represented month; globally sorted by editable start timestamp; maximum 50 returned |
| External issue owners | Configurable allowlist; defaults to the time-data repository owner |
| Storage | One configured private GitHub repository and canonical branch |
| Deletion | Allowed after explicit confirmation, with Git history retained |
| Long entries | Warning above 12 hours |
| Issue title | Captured from the GitHub issue page when available |
| Active state | `active/{login}.txt` is deleted after a successful Stop |
| Authentication | Fine-grained PAT; GitHub App deferred |

## Architecture mapping

- `src/content/github.js` survives dynamic GitHub navigation and inserts a closed-Shadow split stopwatch control immediately before the avatar on every GitHub page. The left segment opens full timer management only on canonical issue/PR pages and otherwise opens the same Reports/Tasks navigation as the separately clickable arrow.
- `src/background/service-worker.js` owns privileged messages, GitHub API access, synchronization, and timer mutations.
- `src/api/github-client.js` implements authenticated user lookup, GitHub Contents API text reads/writes/deletes, atomic multi-file commits through Git Data APIs, and bounded GraphQL hydration of tracked task titles/status.
- `src/services/tracker.js` implements one active timer per authenticated user, globally ordered recent entries across monthly text files, stable-fingerprint/SHA-safe edits and deletes, and atomic cross-month entry/boundary moves, pending Stop retries, and idempotent partial-failure recovery.
- `src/storage/chrome-store.js` stores configuration, the PAT, recent/pending state, and repository-scoped report snapshot/blob caches in extension-origin IndexedDB. The extension requests no `chrome.storage` permission, so GitHub content scripts cannot access this database.
- `src/popup/*` provides the toolbar-popup version of the active timer, optional Stop description, recent records, edit/delete UI, sync status, and conflict acknowledgement.
- `src/reports/*` loads an inclusive Start-date range from canonical monthly user files with branch ETag validation and immutable-SHA cache reuse, then performs person/repository faceting, selectable metric/axis stacked analytics (task metrics deduplicate repeated sessions by canonical issue/PR URL), CSV/JSON export, and native print/save-to-PDF entirely in the extension page.
- `src/tasks/*` preselects only the authenticated user's monthly paths, aggregates repeated sessions and any active-only task by canonical issue/PR URL, sorts by completed plus running time, defaults to confirmed-open work over the last two weeks, filters immediately while typing, and uses the serialized tracker Start/Stop messages. Unknown metadata remains available under All rather than being mislabeled Open.
- `src/options/*` validates the authenticated user, private repository, branch, write access, owner policy, and recent-entry window.

## Data and concurrency invariants

- Canonical identity is the login returned by GitHub's authenticated-user endpoint and encoded in each file name.
- Active state is plain text at `active/{login}.txt`; completed entries are blank-line-separated blocks at `times/{start-local YYYY-MM}/{login}.txt`.
- Each persisted block contains only canonical `URL`, timezone-bearing `Start`, timezone-bearing `End`, and optional one-line `Description`; active files omit `End`.
- Duration is recomputed from `End - Start` and is never persisted or based on render ticks.
- A parsed record's array index is only a hint. Edits/deletes also carry the original persisted fields and locate the unique matching block, so manual reordering does not retarget an operation.
- Changing Start to another local month moves the block between monthly files. Multi-file edits and boundary moves verify the branch tree and publish one atomic Git commit.
- Stop verifies that a reachable remote active timer still matches the cache before queueing; retry accepts exact intended content; if another device already cleared the active timer, one unique same-URL/same-Start completion is treated as that concurrent Stop.
- The active file is deleted with its known SHA and conflicts are re-read before any retry, preserving newer timers.
- Same-destination settings changes preserve pending writes; repository/user changes are blocked while a write or active timer exists.
- Repository coordinates, branch, issue data, dates, timestamps, paths, and manually maintained text fields are validated before use.

## Privacy and permissions

- The extension writes only to the configured private time-data repository.
- It never posts time data or descriptions to source issues.
- The PAT is used only in extension-controlled contexts and is never returned to the content script or page.
- API host access is restricted to `https://api.github.com/*`.
- The configured data repository must be private and accessible on the configured branch.
- Commit messages contain stable identifiers and durations, never free-text descriptions.

## MVP acceptance coverage

Automated tests cover canonical issue/PR detection, monthly path/Start-month validation, strict plain-text parsing, UTF-8 GitHub handling, private-repository enforcement, sender trust boundaries, timer accuracy, SHA conflicts, pending Stop recovery, exact/concurrent completion identity, one-read-per-month loading, stable record lookup after reordering, same-month and atomic cross-month edits, uncapped boundary movement, persistent SHA/ETag report caching, stale-load cancellation, cache eviction, popup behavior, GitHub shortcut isolation, SPA/header recovery, split navigation on non-issue pages, complete rotating period totals beyond the recent-row cap, locale-aware panel timestamps, repository-wide range loading, period boundaries, faceting, analytics aggregation across every requested axis combination, task deduplication, active-time re-sorting, user-only blob selection, load budgets, bounded cached metadata hydration, CSV/JSON exports, and print/save-to-PDF wiring.

Manual entry, older-entry search, reminders, GitHub App authentication, and Firefox packaging remain intentionally outside MVP 1, consistent with the specification's suggested scope.
