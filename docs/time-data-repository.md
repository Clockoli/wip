# Time-data repository setup

Clockoli can use several dedicated private GitHub repositories as durable destinations for active timers and completed work records. Each destination is a **time repository**. A repository whose issue or pull request you track is a **source repository**; it is not automatically a time repository and Clockoli does not need write access to it.

## Connect time repositories

Sign in with GitHub, then use an action in the compact repository list or enter a GitHub URL or `owner/name` and select **Check repository**. Rows show repository icons, owner/name links, and status rather than radio choices. There is no separate existing/new or owner-type selection. If you need a repository, use **Create a new time repository**, then return and enter its URL.

Clockoli requests missing App access only for the checked target and remembers that target across the GitHub visit and Settings reload. The dialog appears only after **Check repository**, not on reload or background discovery. **Grant access** closes it immediately. When an installation is already known, its settings are used. Return and press **Check repository** again; the list refreshes silently every 3 seconds while setup is active. A missing private repository does not prove it does not exist; check its name, your access, and the App grant. Review the offered **Set up storage branch**, **Join repository**, or **Initialize repository** action and explicitly confirm before any writes.

The list refresh reads GitHub and registers already-ready destinations locally, silently every 3 seconds only while setup is active. Only meaningful list changes rerender; unchanged results preserve focus, scroll, drafts, messages, and dialogs. Background errors retain the last good list. There is no **Refresh repositories** or **Review connection** button, and discovery never opens a modal or performs remote writes. Ready repositories automatically appear in **Default time repository** after membership, branch ownership, and task-index validation. An explicit check or row action opens the appropriate access or initialization/join/branch-setup dialog; read the privacy disclosure and exact writes before confirming. Even **Set up storage branch** can create or verify your personal storage branch.

Connections are additive: the first becomes the default and later additions preserve it. Use the separate **Default time repository** selector, then **Finish setup** once that default is usable. A new or replacement GitHub authorization is confirmed automatically after Clockoli read-validates every configured destination under the same GitHub identity and atomically verifies that no active or queued work can be stranded. This authorization check performs no repository writes. If it is blocked, Clockoli reports one account-level action instead of showing a button on every repository. Finish stops polling, invalidates late discovery replies, and clears the remembered target without remote writes.

Required conditions:

- private visibility;
- repository not archived or disabled;
- the signed-in user can read and write;
- Clockoli App **Contents: Read and write** access;
- a default branch or an empty repository Clockoli can safely initialize;
- branch policy permits Clockoli's direct marker and personal-branch writes.

Use **Only select repositories** when granting App access.

## Shared repository setup

1. Choose a dedicated private time repository, whether owned by a person or an organization. Create one only if needed, and grant the Clockoli GitHub App access if it is missing.
2. If the repository is not initialized, a user with the required permissions reviews the privacy disclosure and explicitly confirms **Initialize repository**. Organization initialization requires GitHub repository-admin permission; Clockoli does not create a permanent Clockoli admin role.
3. The administrator shares Clockoli's generated teammate instructions and grants each tracker sufficient GitHub read/write rights.
4. Each teammate signs in separately, chooses the existing marked repository, reviews the disclosure, and explicitly confirms **Join repository**.
5. Clockoli creates and verifies each user's personal storage branch.
6. Give reporting-only users read access only if they may inspect all stored work data in that repository.

An ordinary employee cannot use the join flow to initialize an unmarked organization repository. Repository discovery and inspection never write a marker, branch, membership, or work record.

Use separate time repositories for different privacy boundaries.

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
.clockoli/tasks.json
active/{storage-login}.json
times/{YYYY-MM}/{storage-login}.jsonl
```

Routine work-record writes occur only on the personal branch. Completed-record changes update monthly JSONL and `.clockoli/tasks.json` atomically. Reports discovers marked personal branches and reads their canonical monthly JSONL files. The default branch is repository metadata, not an alternate work-record source.

Do not manually create a branch under `clockoli/users/`. Existing branches must have ownership metadata matching the branch's stable user ID; unknown ownership fails closed.

## Data format v1

Clockoli has one supported persistent work-record format: schema `1`. There is no older supported data format, compatibility reader, dual-write mode, or migration path.

- An active file is one formatted JSON object with `activity.state: "running"`.
- A monthly file is JSON Lines: one compact completed work-record object per non-empty line.
- `.clockoli/tasks.json` is the mandatory exact per-task projection used for cross-user GitHub sidebar totals.
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
  "producer": { "kind": "browser_extension", "name": "clockoli-chrome", "version": "0.1.30" },
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
- update `.clockoli/tasks.json` to match every completed-record change and make both changes in one reviewed Git commit.

Malformed files are rejected as a whole rather than partially ignored. Repair the complete file before retrying.

Edits and deletions remain in Git history unless an administrator rewrites history. Use normal Git backup procedures such as `git clone --mirror` for an independent backup.

## Repository marker

`.clockoli/config.json` records:

- repository format version;
- creation timestamp and creator;
- stable GitHub user ID to immutable storage-login mappings.

The marker is an ownership boundary. Clockoli rejects an unknown future format, malformed mapping, or incompatible reserved tree.

Clockoli can adopt an existing private repository only when its reserved namespace is empty or already contains a valid Clockoli marker. It does not interpret arbitrary `active/`, `times/`, or `.clockoli/` content as Clockoli data.

Routing changes do not move a running timer or queued mutation: accepted work remains pinned to the destination selected at acceptance. Authentication or destination removal is blocked when it would strand active or pending work.

## Branch and ruleset guidance

Clockoli writes directly through the GitHub API. The default branch must allow shared marker initialization and updates, and each `clockoli/users/{id}` branch must permit the user's routine writes.

A ruleset requiring a pull request for every change can prevent normal timer operations. Use a dedicated repository designed for direct authenticated work-data writes rather than weakening source-repository rules.

## Reads and reports access

Tasks, Times, participant totals, and Reports can read selected or all configured time repositories. Each destination is loaded independently. If one fails, Clockoli can show records from the repositories that succeeded together with a partial-data warning. Conflicting copies of the same record ID are omitted and reported. Reports disables export until the selected result is complete and conflict-free.

Reports lists valid personal branches in each selected time repository, reads represented monthly JSONL files for the selected local-date range, and downloads immutable blobs as needed. It keeps **Task source** (the tracked URL's host or GitHub repository) separate from **Time repository** (the storage destination).

On GitHub issue and pull-request pages, participant all-time totals read one `.clockoli/tasks.json` file from each relevant personal branch. The sidebar does not scan monthly history. Top tasks aggregate the same canonical URL across selected destinations and preserve destination provenance.

Repository readers can see stored actor identities, work-item URLs and titles, timestamps, descriptions, metadata, metrics, and execution details. Local hourly rates and billable calculations are not stored in work records.

## Administrative operations

### Add repositories and change routing

Use **Time repositories** in Settings to add eligible personal or organization destinations. Use **Projects and routing** to order URL rules, assign each project to a destination, and select the explicit default for unmatched URLs. Adding or changing routing does not delete or transfer existing records.

The GitHub App flow supports several destinations under one GitHub account. PAT compatibility mode remains limited to one destination.

### Disconnect a browser

**Disconnect this browser** removes local sign-in but leaves GitHub authorization, App installation, repository data, and local configuration as described in Settings.

### Revoke or uninstall

Revoking Clockoli user authorization and uninstalling the GitHub App are separate GitHub operations. Neither deletes repository data. Delete or archive data only through an explicit repository administration process.
