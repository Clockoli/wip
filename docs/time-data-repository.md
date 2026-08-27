# Time-data repository setup

Clockoli uses one dedicated private GitHub repository as the durable store for active timers and completed work records. Do not use a source-code repository unless its access and branch policy are intentionally suitable for work data.

## Individual setup

Create a private repository such as `your-login/clockoli-data`. The normal onboarding flow opens GitHub's repository-creation form and asks you to grant the Clockoli GitHub App access to that repository.

Required conditions:

- private visibility;
- repository not archived or disabled;
- the signed-in user can read and write;
- Clockoli App **Contents: Read and write** access;
- a default branch or an empty repository Clockoli can safely initialize;
- branch policy permits Clockoli's direct marker and personal-branch writes.

Use **Only select repositories** when granting App access.

## Shared team setup

1. Create one dedicated private data repository.
2. Install the Clockoli GitHub App for only that repository.
3. Give each tracker user sufficient GitHub read/write rights.
4. Have each user authorize Clockoli separately and select the same repository.
5. Let Clockoli create and verify each user's personal storage branch.
6. Give reporting-only users read access only if they may inspect all stored work data.

Use separate data repositories for different privacy boundaries.

## Branch and storage layout

The default branch contains the shared repository marker:

```text
.clockoli/config.json
```

Clockoli creates one branch for each stable numeric GitHub identity:

```text
clockoli/users/{github-user-id}
```

Each personal branch contains:

```text
.clockoli/user.json
active/{storage-login}.json
times/{YYYY-MM}/{storage-login}.jsonl
```

Routine work-record writes occur only on the personal branch. Reports discovers marked personal branches and reads their canonical monthly JSONL files. The default branch is repository metadata, not an alternate work-record source.

Do not manually create a branch under `clockoli/users/`. Existing branches must have ownership metadata matching the branch's stable user ID; unknown ownership fails closed.

## Data format v1

Clockoli has one supported persistent work-record format: schema `1`. There is no older supported data format, compatibility reader, dual-write mode, or migration path.

- An active file is one formatted JSON object with `activity.state: "running"`.
- A monthly file is JSON Lines: one compact completed work-record object per non-empty line.
- Every record has a stable ULID assigned at Start. Stop completes that same record ID.
- Timestamps are stored in UTC, while `activity.local_date` and an IANA `activity.timezone` preserve calendar reporting semantics.
- `actor` identifies who performed the work; `producer` identifies what wrote the record.
- Optional `execution` identifies an agent run or session without changing actor identity.
- Namespaced `metrics` support time, token, request, cost, and future measurements.
- Readers that rewrite a record preserve unknown root and nested fields.

The complete normative schema and storage contract is in [Data Format v1](data-format-v1.md).

### Active record example

```json
{
  "schema_version": 1,
  "id": "01K3X7Q8N8F4J7R2JQZ5AKP1MD",
  "record_type": "work",
  "actor": { "kind": "human", "id": "github:12345678", "name": "alice" },
  "work_item": {
    "kind": "github_issue",
    "id": "url:https://github.com/acme/frontend/issues/123",
    "url": "https://github.com/acme/frontend/issues/123",
    "title": "Ranking regression"
  },
  "activity": {
    "state": "running",
    "started_at": "2026-08-22T06:00:00.000Z",
    "ended_at": null,
    "local_date": "2026-08-22",
    "timezone": "Europe/Moscow"
  },
  "producer": { "kind": "browser_extension", "name": "clockoli-chrome", "version": "0.1.29" },
  "description": "",
  "metadata": {},
  "metrics": {},
  "created_at": "2026-08-22T06:00:00.000Z",
  "updated_at": "2026-08-22T06:00:00.000Z"
}
```

A completed record keeps the same `id`, changes the state to `completed`, and sets `ended_at` and `updated_at`.

## Validation and manual editing

Repository files remain inspectable, but editing them outside Clockoli bypasses UI validation and concurrency checks. If you edit manually:

- keep `schema_version` equal to `1`;
- keep record IDs unique and unchanged;
- use one valid JSON object per JSONL line, with no blank lines;
- keep only canonical HTTP(S) work-item URLs without credentials;
- keep timestamps as UTC ISO 8601 values ending in `Z`;
- keep `local_date` in the monthly path's `YYYY-MM` partition;
- use a valid IANA timezone;
- keep a running record's `ended_at` as `null`;
- do not duplicate a record across branches or monthly files;
- make related changes as one reviewed Git commit.

Malformed files are rejected as a whole rather than partially ignored. Repair the complete file before retrying.

Edits and deletions remain in Git history unless an administrator rewrites history. Use normal Git backup procedures such as `git clone --mirror` for an independent backup.

## Repository marker

`.clockoli/config.json` records:

- repository format version;
- creation timestamp and creator;
- stable GitHub user ID to immutable storage-login mappings.

The marker is an ownership boundary. Clockoli rejects an unknown future format, malformed mapping, or incompatible reserved tree.

Clockoli can adopt an existing private repository only when its reserved namespace is empty or already contains a valid Clockoli marker. It does not interpret arbitrary `active/`, `times/`, or `.clockoli/` content as Clockoli data.

Configuration, authentication, repository, and branch transitions are blocked while an active timer or pending write could be stranded. Finish and synchronize work first.

## Branch and ruleset guidance

Clockoli writes directly through the GitHub API. The default branch must allow shared marker initialization and updates, and each `clockoli/users/{id}` branch must permit the user's routine writes.

A ruleset requiring a pull request for every change can prevent normal timer operations. Use a dedicated repository designed for direct authenticated work-data writes rather than weakening source-repository rules.

## Reports access

Reports lists valid personal branches, reads represented monthly JSONL files for the selected local-date range, and downloads immutable blobs as needed.

Repository readers can see stored actor identities, work-item URLs and titles, timestamps, descriptions, metadata, metrics, and execution details. Local hourly rates and billable calculations are not stored in work records.

## Administrative operations

### Change repository

Use **Change data repository** in Settings. Clockoli validates the new stable repository identity and storage before switching. It does not delete or transfer data from the old repository.

### Disconnect a browser

**Disconnect this browser** removes local sign-in but leaves GitHub authorization, App installation, repository data, and local configuration as described in Settings.

### Revoke or uninstall

Revoking Clockoli user authorization and uninstalling the GitHub App are separate GitHub operations. Neither deletes repository data. Delete or archive data only through an explicit repository administration process.
