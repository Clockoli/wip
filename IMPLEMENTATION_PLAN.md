# GitHub Time Tracker — MVP implementation plan

## Decisions

- Chrome/Chromium Manifest V3; WebExtensions-friendly APIs where practical.
- GitHub issues (`/{owner}/{repo}/issues/{number}`) and pull requests (`/{owner}/{repo}/pull/{number}`); manual entries are deferred.
- Fine-grained PAT stored only in extension-origin IndexedDB; never sent to content scripts.
- One configured private data repository and canonical branch (`main` by default).
- Authenticated GitHub login is the canonical user and sanitized/validated before path creation.
- Active timer: `active/{login}.txt`; completed entries: blank-line-separated records in `times/{local YYYY-MM-DD}/{login}.txt`.
- Every stored timestamp includes an explicit timezone; the Start timestamp’s local calendar date selects the daily file.
- One active timer per user. A new timer is blocked while a Stop operation is pending/conflicted.
- Offline Stop writes a stable-ID operation to an extension-origin IndexedDB queue before network I/O. Retries first ensure the same entry exists, then conditionally clear the matching active timer.
- Recent view scans only the authenticated user’s configured local-date directories, rejects more than 200 candidates before per-file reads, validates the bounded set, globally sorts by editable `startedAt`, and returns at most 50 entries.
- Edits preserve the original file path and require the SHA seen when editing; durations are recomputed. Dragging an adjacent-entry boundary preflights both SHAs and rolls back the first write if the second races.
- Deletes require explicit UI confirmation and the latest known SHA.
- Issue owners default to the configured data-repository owner and can be expanded in Settings.

## Components

- `src/domain/*`: issue parsing/validation, timestamps, durations, ULIDs, paths, records.
- `src/api/github-client.js`: authenticated GitHub REST Contents API with typed errors.
- `src/storage/chrome-store.js`: configuration/cache/queue persistence.
- `src/services/tracker.js`: timer state machine, recent entries, complete today total, edits/deletes, queue retry.
- `src/services/reports.js`: immutable tree/blob reads for every user's canonical daily file in an inclusive Start-date range.
- `src/background/service-worker.js`: message boundary; token and API calls remain isolated.
- `src/content/github.js`: GitHub SPA issue/pull-request detection plus a native-style before-avatar stopwatch control and closed-Shadow management dropdown.
- `src/popup/*`: active/recent/sync UI and edit/delete controls.
- `src/reports/*`: weekly/monthly/quarterly/yearly/custom periods, person/repository facets, local stacked-bar aggregation, and plain-text/CSV downloads.
- `src/options/*`: least-privilege PAT/repository setup and validation.

## Acceptance checks

1. Two users create independent active and daily text paths.
2. No source issue is modified; only configured private data repository is written.
3. Edit recomputes duration and rejects stale SHA.
4. Browser restart restores GitHub-backed active timer.
5. Failed Stop remains queued under a stable entry ID and retry cannot duplicate it.
6. A created entry plus failed active deletion resumes at active deletion.
7. Content script never receives token/config secrets and renders untrusted text with text nodes.
8. Invalid owner/repo/login/path/date/issue data is rejected before an API write.
9. Repository-wide reports load matching immutable blobs without exposing credentials or storage SHAs, and all facet/chart changes rerender locally.
10. Automated Node tests, real-Chromium UI/export checks, and packaged-extension validation pass.
