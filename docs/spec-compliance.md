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
| Storage | Multiple private personal or organization time repositories; one explicit default destination plus ordered project URL routing; each repository keeps its shared marker on the default branch and work records on marked `clockoli/users/{stable-user-id}` branches |
| Deletion | Allowed after explicit confirmation, with Git history retained |
| Long entries | Warning above 12 hours |
| Active state | `active/{login}.json` is deleted after the completed record is atomically persisted |
| Completed state | `times/{local YYYY-MM}/{login}.jsonl`, one JSON object per line |
| Repository access handoff | Only explicit Check repository may open the access dialog; Grant access closes it, preserves the target, and requires manual Check repository on return (read-only list polling every 3 seconds while setup is active; polling never opens dialogs) |
| Setup completion | App-granted repositories list without deep inspection; Check validates membership, personal branch ownership, and task index without connecting. A separate confirmed Connect action revalidates and registers a ready destination locally. Remote setup/join/branch creation remains explicitly confirmed; setup stays open with a compact informational list and a separate Default time repository selector. A same-account candidate authorization is promoted automatically only after read-only validation of every configured destination and atomic accepted-work checks. Finish requires a usable default and no blocked candidate authorization, stops polling, and clears the remembered target without remote writes. Later additions preserve the default; only an explicit default action changes it. |
| Authentication | Backend-free GitHub App Device Flow for multi-repository use; fine-grained PAT is a single-destination compatibility option |

## Architecture mapping

- `src/content/github.js` inserts the tracking UI and sends only validated page-safe work-item data.
- `src/background/service-worker.js` owns credentials, GitHub API access, bounded multi-destination reads, durable local acceptance, synchronization, routing dispatch, and all mutations.
- `src/api/github-client.js` provides SHA-guarded reads/writes/deletes, atomic multi-file commits, immutable blob reads, and bounded metadata hydration.
- `src/domain/records.js` owns runtime work-record construction, stable ID invariants, timezone-aware local dates, edits, and validation.
- `src/domain/work-records.js` is the sole persistent v1 codec and path contract. It accepts JSON/JSONL only and preserves unknown fields when rewriting supported records.
- `src/services/tracker.js` implements destination-bound timer operations, ID-safe edits/deletes, atomic cross-month changes, queued reconciliation, and idempotent concurrent Stop handling.
- `src/storage/chrome-store.js` atomically stores credentials, the destination registry, one global active timer, destination-pinned pending mutations, routing settings, recent state, and repository-scoped report caches in extension-origin IndexedDB.
- `src/background/destination-runtime.js` resolves new Starts through ordered project rules and the explicit default, while accepted timers and queued mutations remain pinned to their original destination.
- `src/reports/*`, `src/tasks/*`, and `src/times/*` merge the same runtime projection of v1 work records across selected destinations while retaining provenance and reporting partial/conflicting data.

## Persistent data invariants

- `schema_version` is exactly `1`; no other persistent work-record schema is supported.
- The canonical paths are `active/{storage-login}.json` and `times/{local YYYY-MM}/{storage-login}.jsonl`.
- Active storage contains one formatted JSON object. Monthly storage contains one compact JSON object per non-empty line.
- Every record has a stable ULID. Stop completes the active record without changing its ID.
- `actor` identifies who performed work. `producer` identifies the software that wrote it. Optional `execution` identifies an agent run or session.
- `activity.started_at`, `activity.ended_at`, `created_at`, and `updated_at` are UTC. `activity.local_date` and an IANA timezone define calendar reporting and partitioning.
- `metrics` are namespaced measurements with value, unit, aggregation, and provenance; no AI-specific fields are required at the root.
- Unknown root and nested fields survive supported read-modify-write operations.
- Work-item identity (canonical HTTP(S) URL or narrowly validated unresolved imported `owner/project/task-slug`), title, timestamps, local date, timezone, identities, paths, metadata, metrics, and record type are validated before use. Browser-created tasks remain HTTP(S)-only.
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
- Authentication changes and destination removal are blocked while accepted work could be stranded. Routing changes affect only future Starts.
- Automatic 404 recovery is remote-read-only: revalidate stable repository identity, shared membership, branch ownership and task index before atomically repairing local coordinates under unchanged current auth, no pending auth, and unchanged configuration/default target. Preserve the configured custom branch (including configurations without storage-branch verification), destination identity, routing and accepted work. Missing personal storage requires Settings → Check repository → explicit setup confirmation; recovery never initializes, joins, provisions or writes markers.
- One active timer is global across destinations. A cross-destination switch durably queues source completion before its dependent target Start.

## Privacy and permissions

- The extension writes only to validated private time repositories in the local destination registry and routes each new Start to one validated destination.
- It never posts work data to the tracked URL or source system.
- GitHub credentials and local billing settings remain in extension-controlled contexts.
- Runtime host access is restricted to GitHub API and Device Flow endpoints.
- Commit messages contain stable identifiers and durations, never descriptions.
- Repository readers can inspect actors, work items, timestamps, descriptions, metadata, metrics, and execution information. Hourly rates remain local.

## Acceptance coverage

Automated tests cover strict v1 JSON/JSONL parsing, stable Start-to-Stop identity, unsupported-schema rejection, unknown-field preservation, actor/producer separation, metric validation, local-date/month partitioning, arbitrary HTTP(S) work items, lossless destination migration, explicit repository actions, organization permissions, ordered routing, one global timer, destination-pinned queues, cross-destination restart recovery, bounded and abortable multi-destination reads, conflict-safe deduplication and provenance, durable local mutations, MV3 restarts, concurrent Stops, stale-title races, pending projections, SHA conflicts, ID-safe edits/deletes after reordering, atomic linked and cross-month edits, bulk import, personal-branch discovery, report caching, sender trust boundaries, Tasks/Activity/Reports views, partial export guards, billing, credentials-free settings exports, and release-package validation.

The complete normative persistent format is [Data Format v1](data-format-v1.md).

## Repository-step live discovery contract

- Poll the App-granted repository list every 3 seconds only during active repository setup. Polling revalidates configured destinations for pending authorization promotion, but never deep-inspects unrelated rows or registers them merely because they appear in the list. It is single-flight, silent on success and failure, and never opens confirmation/access dialogs or restores a target/selection. An explicit Check inspects the selected repository without registering it; confirmed Connect rechecks its App grant, stable identity, permissions, personal branch and task index before local registration.
- Sort rows and compare their displayed semantic state before replacing list DOM; ignore API ordering and irrelevant metadata. Unchanged results preserve DOM nodes, input drafts, focus, scroll, messages and open dialogs; errors retain the last good list without a spinner or notification. Changed availability invalidates Finish for a missing or ineligible default.
- Pause polling updates during confirmation. Stop polling and invalidate in-flight replies on Finish, cancel, disconnect, page unload and authorization changes, including Finish followed by reopening.
- Each compact linked repository row has a local icon and a Not checked/ready/setup status; unverified rows offer Check repository, inspected ready rows offer Connect repository, and other inspected rows offer setup actions, not an exclusive radio. Do not provide Refresh repositories, Review connection, or per-repository authorization-confirmation buttons. Explicit Check repository opens a native action-specific initialization/branch-setup/join dialog when needed, but never connects a ready repository. Privacy, writes and required administrator confirmation precede all writes.
- Choose Default time repository separately through the existing safe default save. Finish setup requires a ready connected default and completed authorization promotion. Discovery may promote a same-account candidate authorization only after all configured destinations pass read-only validation and both preflight and atomic accepted-work guards; it never performs remote writes. A blocked promotion remains one account-level problem rather than repeated row actions. Finish is blocked during confirmation, clears the remembered target, and does not write remotely.
