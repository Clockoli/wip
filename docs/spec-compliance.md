# Version 1 specification compliance

Source analyzed: Clockoli's GitHub onboarding requirements plus the delivered URL-first task, personal-branch, Tasks, Reports, local-billing, durable-mutation, and work-record v1 requirements.

## Selected defaults

| Decision | Implementation |
|---|---|
| Browser | Chrome/Chromium Manifest V3; Chrome 102+ |
| Tasks | Any canonical HTTP(S) URL; title optional; GitHub issue/PR metadata retained as enrichment |
| Work actors | Human and agent identities use the same work-record schema |
| Descriptions | Optional, maximum 2,000 characters |
| Manual entries | All-or-nothing bulk creation of completed dated URL tasks on the Activity page |
| Offline behavior | Start is accepted durably in extension-local storage and reconciled to GitHub; Stop is queued and retried |
| Recent entries | Seven browser-local calendar days by default, configurable from 1–31; one direct monthly JSONL read per represented month; globally sorted; maximum 50 returned |
| Storage | One private GitHub repository; shared marker on the default branch and work records on marked `clockoli/users/{stable-user-id}` branches |
| Deletion | Allowed after explicit confirmation, with Git history retained |
| Long entries | Warning above 12 hours |
| Active state | `active/{login}.json` is deleted after the completed record is atomically persisted |
| Completed state | `times/{local YYYY-MM}/{login}.jsonl`, one JSON object per line |
| Authentication | Backend-free GitHub App Device Flow; fine-grained PAT is an advanced authentication option |

## Architecture mapping

- `src/content/github.js` inserts the tracking UI and sends only validated page-safe work-item data.
- `src/background/service-worker.js` owns credentials, GitHub API access, durable local acceptance, synchronization, and all mutations.
- `src/api/github-client.js` provides SHA-guarded reads/writes/deletes, atomic multi-file commits, immutable blob reads, and bounded metadata hydration.
- `src/domain/records.js` owns runtime work-record construction, stable ID invariants, timezone-aware local dates, edits, and validation.
- `src/domain/work-records.js` is the sole persistent v1 codec and path contract. It accepts JSON/JSONL only and preserves unknown fields when rewriting supported records.
- `src/services/tracker.js` implements one active timer per user, ID-safe edits/deletes, atomic cross-month changes, queued reconciliation, and idempotent concurrent Stop handling.
- `src/storage/chrome-store.js` atomically stores credentials, configuration generations, accepted pending mutations, recent state, and repository-scoped report caches in extension-origin IndexedDB.
- `src/reports/*`, `src/tasks/*`, and `src/times/*` consume the same runtime projection of v1 work records.

## Persistent data invariants

- `schema_version` is exactly `1`; no other persistent work-record schema is supported.
- The canonical paths are `active/{storage-login}.json` and `times/{local YYYY-MM}/{storage-login}.jsonl`.
- Active storage contains one formatted JSON object. Monthly storage contains one compact JSON object per non-empty line.
- Every record has a stable ULID. Stop completes the active record without changing its ID.
- `actor` identifies who performed work. `producer` identifies the software that wrote it. Optional `execution` identifies an agent run or session.
- `activity.started_at`, `activity.ended_at`, `created_at`, and `updated_at` are UTC. `activity.local_date` and an IANA timezone define calendar reporting and partitioning.
- `metrics` are namespaced measurements with value, unit, aggregation, and provenance; no AI-specific fields are required at the root.
- Unknown root and nested fields survive supported read-modify-write operations.
- Work-item URL, title, timestamps, local date, timezone, identities, paths, metadata, metrics, and record type are validated before use.
- A malformed active JSON or monthly JSONL file is rejected as a whole.
- Duplicate record IDs within one monthly file are rejected.
- Duration is derived from `ended_at - started_at` and not persisted as authoritative data.

## Concurrency invariants

- Git blob SHAs guard file rewrites; stable record IDs locate records independently of ordering or mutable content.
- Start, Stop, and switch acceptance is persisted locally before asynchronous GitHub reconciliation.
- Pending operations are FIFO and operation-ID-aware.
- A matching concurrent completion is adopted by stable record ID instead of appended again.
- A stale Stop never clears or resurrects a newer active timer.
- Multi-file edits, boundary moves, and bulk imports preflight affected files and publish one atomic Git commit.
- Repository or identity changes are blocked while accepted work could be stranded.

## Privacy and permissions

- The extension writes only to the configured private data repository.
- It never posts work data to the tracked URL or source system.
- GitHub credentials and local billing settings remain in extension-controlled contexts.
- Runtime host access is restricted to GitHub API and Device Flow endpoints.
- Commit messages contain stable identifiers and durations, never descriptions.
- Repository readers can inspect actors, work items, timestamps, descriptions, metadata, metrics, and execution information. Hourly rates remain local.

## Acceptance coverage

Automated tests cover strict v1 JSON/JSONL parsing, stable Start-to-Stop identity, unsupported-schema rejection, unknown-field preservation, actor/producer separation, metric validation, local-date/month partitioning, arbitrary HTTP(S) work items, durable local timer mutations, MV3 restarts, concurrent Stops, stale-title races, pending projections, SHA conflicts, ID-safe edits/deletes after reordering, atomic linked and cross-month edits, bulk import, personal-branch discovery, report caching, sender trust boundaries, Tasks/Activity/Reports views, billing, exports, and release-package validation.

The complete normative persistent format is [Data Format v1](data-format-v1.md).
