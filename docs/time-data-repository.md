# Time-data repository setup

Create a separate private GitHub repository, for example `acme/time-data`, with direct commits permitted on `main`. No initial files or directories are required; the extension creates them through GitHub's Contents API.

## Access

- Trackers: repository **write** access.
- Reporting/managers: repository **read** access if they are permitted to see all issue references and descriptions. The Reports page scans canonical `times/` paths for the selected Start-date range and reads immutable Git blobs.
- Administrators: maintain/admin.

Time data may reveal private issue references and sensitive descriptions. Use separate data repositories when team access boundaries differ.

## GitHub access

The normal setup authorizes RepoClock through backend-free GitHub App Device Flow, installs the App on selected private repositories, and requires **Contents: Read and write**. Effective writes still require both the signed-in user's push rights and branch/ruleset permission. No write access is required on source issue repositories.

A fine-grained PAT restricted to the private time-data repository remains available under **Personal access token compatibility** for legacy setup and migration.

## Files

```text
.repoclock/config.json
active/{storage-login}.txt
times/{YYYY-MM}/{storage-login}.txt
```

A completed record is plain text:

```text
URL: https://github.com/acme/frontend/issues/123
Title: Ranking regression
Start: 2026-08-19T09:00:00+03:00
End: 2026-08-19T10:15:00+03:00
Description: optional single-line text
```

Records in a monthly file are separated by a blank line. `Title` and `Description` may be omitted. The storage login comes from the file name. `.repoclock/config.json` records the repository format version and stable GitHub-user-ID-to-storage-login mapping. Active files use `URL`, optional `Title`, `Start`, and optional `Description`; Stop appends the matching completed record to the monthly file and removes the active file.

Files may be edited manually. Keep canonical GitHub issue/PR URLs, explicit timestamp timezones, Start months matching the `times/YYYY-MM/` directory, recognized field names, and blank-line separators. A malformed monthly file is reported rather than partially ignored. Legacy blocks without `Title` remain readable. When RepoClock can obtain a missing title from the current GitHub page or the metadata API, it rewrites the represented monthly file with its current SHA; persisted titles are then reused without a display-time lookup.

Edits and deletes remain visible in Git history, but Git history is not tamper-proof against repository administrators. Optional backups can use `git clone --mirror`.

## Reports cache

Reports first conditionally request the configured branch ref using the saved ETag. A `304 Not Modified` reuses the extension-origin IndexedDB snapshot without consuming primary GitHub API quota. When the branch changes, the extension reads the new commit/tree and downloads only monthly blobs whose immutable Git SHA is absent locally. Cache entries are scoped to `owner/repository@branch`, cleared when the destination or authenticated user changes, and never exposed to GitHub page scripts.

## Migration from daily files

Do not leave daily and monthly representations of the same records together: that can duplicate reports or make older extension versions write to obsolete paths. Migrate in one Git commit, preserving `active/` byte-for-byte, and verify every block before deleting `times/YYYY-MM-DD/*.txt`. The live demo repository includes `scripts/migrate_daily_to_monthly.py` for a dry-run/check/apply workflow. Keep the pre-migration commit as the rollback point.
