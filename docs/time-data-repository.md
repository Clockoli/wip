# Time-data repository setup

Create a separate private GitHub repository, for example `acme/time-data`, with direct commits permitted on `main`.

Recommended initial files:

```text
README.md
schema/time-entry.schema.json
active/.gitkeep
entries/.gitkeep
```

Copy `schema/time-entry.schema.json` from this extension repository. Empty directories are not required—the extension creates file paths through GitHub’s Contents API.

## Access

- Trackers: repository **write** access.
- Reporting/managers: repository **read** access if they are permitted to see all issue references and descriptions.
- Administrators: maintain/admin.

Time data may reveal private issue references and sensitive descriptions. Use separate data repositories when team access boundaries differ.

## Token

Each user should create a fine-grained PAT with:

- repository access: only the private time-data repository;
- repository permission: **Contents: Read and write**;
- no write access required on source issue repositories.

## Recovery

- An active timer can be inspected at `active/{login}.json`.
- Completed entries are immutable-ish files under `entries/{login}/...`; their `entryDate` must match the `YYYY/MM/DD` directory.
- New active records carry the same `entryDate`, pinning the eventual path across devices and time zones. Legacy active records fall back to their UTC start date.
- Edits and deletes remain visible in Git history, but Git history is not tamper-proof against repository administrators.
- Optional backups can use `git clone --mirror`.
