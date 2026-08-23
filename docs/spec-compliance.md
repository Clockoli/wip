# Draft 2 specification compliance

Source analyzed: RepoClock GitHub onboarding specification, Draft 2 dated 2026-08-20, plus the subsequently delivered URL-first task, personal-branch, Tasks, Reports, and local-billing requirements.

## Selected defaults

The specification leaves several Version 1 choices open. This implementation selects its recommended defaults:

| Decision | Implementation |
|---|---|
| Browser | Chrome/Chromium Manifest V3; Chrome 102+ |
| Tasks | Any canonical HTTP(S) URL; title optional; GitHub issue/PR metadata retained as enrichment |
| Descriptions | Optional, maximum 2,000 characters |
| Manual entries | Deferred to MVP 1.1 |
| Offline behavior | Start requires GitHub connectivity; Stop is queued locally and retried |
| Recent entries | Seven browser-local calendar days by default, configurable from 1–31; one direct monthly-file read per represented month; globally sorted by editable start timestamp; maximum 50 returned |
| Issue owners | Any canonical GitHub issue or pull request may be tracked |
| Storage | One configured private GitHub repository; shared marker on the source branch and routine writes on a marked `repoclock/users/{stable-user-id}` personal branch |
| Deletion | Allowed after explicit confirmation, with Git history retained |
| Long entries | Warning above 12 hours |
| Issue title | Captured when available and persisted as a bounded optional `Title` field |
| Active state | `active/{login}.txt` is deleted after a successful Stop |
| Authentication | Backend-free GitHub App Device Flow; fine-grained PAT retained as an advanced compatibility/migration path |

## Architecture mapping

- `src/content/github.js` survives dynamic GitHub navigation and inserts a closed-Shadow split stopwatch control immediately before the avatar on every GitHub page. The shared toolbar-popup renderer derives a task from any active HTTP(S) tab, refreshes that tab at Start, and uses the same timer, recent-entry, Edit/Delete, Tasks, and Reports controls.
- `src/background/service-worker.js` owns privileged messages, resumable Device Flow, rotating credentials, GitHub API access, stable-ID repository recovery, synchronization, and timer mutations.
- `src/api/github-client.js` implements authenticated user lookup, GitHub Contents API text reads/writes/deletes, atomic multi-file commits through Git Data APIs, and bounded GraphQL hydration of tracked task titles/status.
- `src/services/tracker.js` implements one active timer per authenticated user, globally ordered recent entries across monthly text files, stable-fingerprint/SHA-safe edits and deletes, and atomic cross-month entry/boundary moves, pending Stop retries, and idempotent partial-failure recovery.
- `src/storage/chrome-store.js` atomically stores background-owned Device Flow attempts, GitHub App access/refresh credentials, PAT compatibility credentials, configuration generations, recent/pending state, and repository-scoped report snapshot/blob caches in extension-origin IndexedDB. The extension requests no `chrome.storage` permission, so GitHub content scripts cannot access this database.
- `src/popup/*` provides the toolbar-popup version of the active timer, optional Stop description, recent records, edit/delete UI, sync status, and conflict acknowledgement.
- `src/reports/*` discovers valid marked personal branches, merges compatible legacy default-branch data, and loads an inclusive Start-date range with branch ETag validation and immutable-SHA cache reuse. It provides Person/Source facets, selectable metric/axis stacked analytics (task metrics deduplicate by canonical task URL), local-rate billing, CSV/JSON export, and native print/save-to-PDF entirely in the extension page.
- `src/tasks/*` preselects only the authenticated user's monthly paths, aggregates repeated sessions and any active-only task by canonical task URL, sorts by completed plus running time, filters immediately while typing, and uses the serialized tracker Start/Stop messages. GitHub metadata is optional; generic URL tasks remain usable without a provider object.
- `src/options/*` provides resumable Device Flow, installation/private-repository selection, initialization and recovery status, guarded local disconnect/reset, and an advanced PAT compatibility path.

## Data and concurrency invariants

- Canonical identity is the stable numeric GitHub user ID; `.repoclock/config.json` maps it to the validated storage login used in canonical file names.
- The shared default branch owns `.repoclock/config.json`. Each current user writes active and completed data to a fail-closed, ownership-marked `repoclock/users/{stable-user-id}` branch; compatible legacy default-branch records remain readable.
- Active state is plain text at `active/{login}.txt`; completed entries are blank-line-separated blocks at `times/{start-local YYYY-MM}/{login}.txt`.
- Each persisted block contains canonical `URL`, an optional one-line `Title`, timezone-bearing `Start`, timezone-bearing `End`, and optional one-line `Description`; active files omit `End`.
- Duration is recomputed from `End - Start` and is never persisted or based on render ticks.
- A parsed record's array index is only a hint. Edits/deletes also carry the original persisted fields and locate the unique matching block, so manual reordering does not retarget an operation.
- Changing Start to another local month moves the block between monthly files. Multi-file edits and boundary moves verify the branch tree and publish one atomic Git commit.
- Stop verifies that a reachable remote active timer still matches the cache before queueing; retry accepts exact intended content; if another device already cleared the active timer, one unique same-URL/same-Start completion with the same durable title is treated as that concurrent Stop.
- The active file is deleted with its known SHA and conflicts are re-read before any retry, preserving newer timers.
- Same-destination settings changes preserve pending writes; repository/user changes are blocked while a write or active timer exists.
- Repository coordinates, branch ownership, task URLs, optional GitHub metadata, dates, timestamps, paths, and manually maintained text fields are validated before use.

## Privacy and permissions

- The extension writes only to the configured private time-data repository.
- It never posts time data or descriptions to the tracked URL or source system.
- Device codes, GitHub App access/refresh tokens, and PAT compatibility credentials are used only in extension-controlled contexts and are never returned to the content script or page.
- Runtime host access is restricted to `https://api.github.com/*` and GitHub Device Flow endpoints under `https://github.com/login/*`.
- Extension pages use `script-src 'self'; object-src 'none'`; runtime JavaScript, CSS, and fonts are local.
- The configured data repository must be private and accessible on the configured branch.
- Commit messages contain stable identifiers and durations, never free-text descriptions.

## MVP acceptance coverage

Automated tests cover resumable Device Flow, token rotation/single-flight refresh, cancellation and restart races, installation/repository pagination budgets, private-write eligibility, marker initialization conflicts, PAT migration, stable-ID repository recovery, guarded disconnect/reset, arbitrary HTTP(S) task URLs, optional titles, backward-compatible GitHub issue/PR parsing, monthly path/Start-month validation, strict plain-text parsing, private-repository enforcement, sender trust boundaries, timer accuracy, SHA conflicts, pending Stop recovery, exact/concurrent completion identity, one-read-per-month loading, stable record lookup after reordering, same-month and atomic cross-month edit services, direct offset-preserving time input, static recent-row time rendering, persistent SHA/ETag report caching, stale-load cancellation, personal-branch discovery, popup behavior, GitHub shortcut isolation, SPA/header recovery, complete rotating period totals beyond the recent-row cap, locale-aware panel timestamps, repository-wide range loading, Source/Person faceting, local-rate billing, analytics aggregation across every requested axis combination, task deduplication, active-time re-sorting, user-only blob selection, load budgets, bounded cached metadata hydration, CSV/JSON exports, and print/save-to-PDF wiring.

Manual entry creation, reminders, mobile applications, automatic unpacked-extension updates, and Firefox packaging remain outside this release scope.
