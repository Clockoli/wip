# Time-data repository setup

Create a separate private GitHub repository, for example `acme/time-data`, with direct commits permitted on `main`. No initial files or directories are required; the extension creates them through GitHub's Contents API.

## Access

- Trackers: repository **write** access.
- Reporting/managers: repository **read** access if they are permitted to see all issue references and descriptions.
- Administrators: maintain/admin.

Time data may reveal private issue references and sensitive descriptions. Use separate data repositories when team access boundaries differ.

## Token

Each user should create a fine-grained PAT with repository access limited to the private time-data repository and **Contents: Read and write**. No write access is required on source issue repositories.

## Files

```text
active/{github-login}.txt
times/{YYYY-MM-DD}/{github-login}.txt
```

A completed record is plain text:

```text
URL: https://github.com/acme/frontend/issues/123
Start: 2026-08-19T09:00:00+03:00
End: 2026-08-19T10:15:00+03:00
Description: optional single-line text
```

Records in a daily file are separated by a blank line. `Description` may be omitted. The GitHub login comes from the file name. Active files use `URL`, `Start`, and optional `Description`; Stop appends the matching completed record to the daily file and removes the active file.

Files may be edited manually. Keep canonical GitHub issue/PR URLs, explicit timestamp timezones, Start dates matching the `times/YYYY-MM-DD/` directory, recognized field names, and blank-line separators. A malformed daily file is reported rather than partially ignored.

Edits and deletes remain visible in Git history, but Git history is not tamper-proof against repository administrators. Optional backups can use `git clone --mirror`.
