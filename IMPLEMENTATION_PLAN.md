# GitHub Time Tracker — MVP implementation plan

## Decisions

- Chrome/Chromium Manifest V3; WebExtensions-friendly APIs where practical.
- Any canonical HTTP(S) URL can be tracked. Completed manual entries can be created atomically through the Times bulk importer.
- Backend-free GitHub App Device Flow is primary; rotating credentials and attempts remain background-owned in extension-origin IndexedDB. Fine-grained PAT is an advanced compatibility path; no credentials are sent to content scripts.
- One configured private data repository and canonical branch (`main` by default).
- Stable numeric GitHub user ID is canonical and `.repoclock/config.json` maps it to a validated storage login before path creation.
- Active timer: `active/{login}.txt`; completed entries: blank-line-separated records in `times/{local YYYY-MM}/{login}.txt`.
- Every stored timestamp includes an explicit timezone; the Start timestamp’s local calendar month selects the monthly file.
- One active timer per user. A new timer is blocked while a Stop operation is pending/conflicted.
- Offline Stop writes a stable-ID operation to an extension-origin IndexedDB queue before network I/O. Retries first ensure the same entry exists, then conditionally clear the matching active timer.
- Recent view reads the authenticated user’s one or two represented monthly files, filters the configured local-date window, validates the records, globally sorts by editable `startedAt`, and returns at most 50 entries.
- Inline edits preserve the original file path and require the SHA seen when editing; durations are recomputed. Directly typing across an adjacent boundary links the records, preflights every involved SHA, and publishes cross-month changes in one atomic Git Data commit.
- Deletes require explicit UI confirmation and the latest known SHA.
- Issue owners default to the configured data-repository owner and can be expanded in Settings.

## Components

- `src/domain/*`: issue parsing/validation, timestamps, durations, ULIDs, paths, records.
- `src/api/github-client.js`: authenticated GitHub REST Contents API with typed errors.
- `src/storage/chrome-store.js`: configuration/queue persistence plus repository-scoped branch-ETag and immutable-blob report caches.
- `src/services/tracker.js`: timer state machine, recent entries, complete today total, edits/deletes, queue retry.
- `src/services/reports.js`: immutable tree/blob reads for every user's reports, plus budgeted authenticated-user-only reads for Tasks, in an inclusive Start-date range.
- `src/background/service-worker.js`: trusted message boundary, resumable authorization, rotating credential broker, repository recovery, and isolated API calls.
- `src/content/github.js`: GitHub SPA issue/pull-request detection plus a native-style before-avatar stopwatch control and closed-Shadow management dropdown.
- `src/popup/*`: active/recent/sync UI and edit/delete controls.
- `src/reports/*`: weekly/monthly/quarterly/yearly/custom periods, person/repository facets, selectable metric/axis local stacked-bar aggregation, direct CSV/JSON downloads, and print/save-to-PDF.
- `src/tasks/*`: authenticated-user rolling-period task aggregation, immediate URL/title filtering, bounded cached GitHub title hydration, active-only task inclusion, elapsed-time ordering, and inline Start/Stop controls.
- `src/times/*`: authenticated-user range history, URL/title filtering, shared inline correction controls, and all-or-nothing bulk time entry.
- `src/options/*`: GitHub App authorization/install/repository onboarding, recovery/disconnect/reset, plus advanced PAT compatibility.

## Acceptance checks

1. Two users create independent active and monthly text paths.
2. No source issue is modified; only configured private data repository is written.
3. Edit recomputes duration and rejects stale SHA.
4. Browser restart restores GitHub-backed active timer.
5. Failed Stop remains queued under a stable entry ID and retry cannot duplicate it.
6. A created entry plus failed active deletion resumes at active deletion.
7. Content script never receives token/config secrets and renders untrusted text with text nodes.
8. Invalid owner/repo/login/path/date/issue data is rejected before an API write.
9. Repository-wide reports load matching immutable blobs without exposing credentials or storage SHAs, and all facet/chart changes rerender locally.
10. The split GitHub header opens timer management for any GitHub HTTP(S) task URL and exposes Top tasks/Activity/Reports navigation without exposing privileged time, task, or report data to content scripts.
11. Automated Node tests, network-disabled Node 22 tests, real-Chromium UI checks, static extension validation, and exact-snapshot review pass before packaging.
