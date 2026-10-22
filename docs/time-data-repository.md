# Time repositories

A time repository is a private GitHub repository where Clockoli stores your timers and completed time. You can connect several and choose a default.

A repository whose issue or pull request you track is a **source repository**. It is not automatically a time repository, and Clockoli does not need write access to it. See [Key concepts](concepts.md).

## Requirements

- private visibility;
- repository not archived or disabled;
- the signed-in user can read and write;
- Clockoli App **Contents: Read and write** access;
- a default branch or an empty repository Clockoli can safely initialize;
- branch policy permits Clockoli's direct marker and personal-branch writes.

Use **Only select repositories** when granting App access.

## Connect a repository

[Getting started](getting-started.md#step-2-connect-a-time-repository) walks through the first connection. This section describes each part of the flow.

### Check a repository

After sign-in, the primary action is **Connect an existing repository**. Paste its URL or `owner/name` and select **Check** (or press Enter). Simply leaving the field does not check it. The **Check** button also retries a check and shows **Checking…** while a check is in progress.

Or type at least two characters of a repository name and choose one of up to eight matching GitHub App-granted suggestions from the dropdown. Choosing a suggestion checks the target but does not connect it; merely typing or seeing a suggestion does neither. The granted catalog is fetched on demand rather than displayed in full when setup opens, and not once per keystroke.

There is no separate existing/new or personal/organization choice: Clockoli inspects the selected repository's state and your permissions, regardless of its name or owner.

Checking is necessary because an App grant alone does not prove the repository is private, writable, compatible with Clockoli storage, or that your personal branch and task index belong to you. **Check repository** verifies the current GitHub grant, permissions, membership, personal branch ownership, and task index. A grant or a previously checked Ready label alone cannot authorize writes. Checking changes neither repository files nor the list of connected repositories.

Editing the repository field invalidates the previous selection and confirmation: check the new target and review it before confirming.

### Create a repository

If you do not have a repository, choose the secondary **Create a new time repository** action below the existing-repository field; it suggests `clockoli-data`. After creating the private repository on GitHub, return and paste its URL into the **New repository URL** dialog to check it. This checks the target without connecting or initializing it, and creating a repository does not grant the Clockoli GitHub App access to it.

The access dialog's **Create one on GitHub** link prefills the checked repository name and owner while retaining the private Clockoli template. GitHub may ignore the owner if you lack creation permission; verify the owner before creating.

### Grant App access

Clockoli asks for **Grant access** only when the checked target is missing from the accessible list or needs App Contents-write permission. The access dialog appears only after an explicit check, and **Grant access** closes it immediately. If Clockoli knows the owner's existing App installation, the link opens that installation's settings rather than starting another installation. Use **Only select repositories** and grant access only to the intended time repository or repositories. If you cannot change access, ask the repository owner or organization administrator; approval may be required.

Clockoli remembers the target across the GitHub visit and a Settings reload. Returning to Settings checks an unresolved remembered target after a one-second settling delay, even if the access dialog was closed or Settings was reloaded. If the grant is not visible yet, return again after completing it on GitHub to recheck; the pending grant handoff does not poll in the background.

A missing private repository does not prove it does not exist; check its name, your access, the App grant, and any pending approval. Clockoli never replaces a missing target with another available repository.

### Confirm a setup action

An explicit check opens the appropriate access, initialization, join, or branch-setup dialog when needed. Read the privacy disclosure and, for actions that write remotely, the exact **Repository writes** before confirming:

- **Connect repository** adds an already-ready repository to this browser after another read-only validation; it does not change repository files.
- **Set up storage branch** explicitly creates or verifies a missing personal storage branch for an existing member. Invalid branch ownership or task-index data is unavailable until repaired; discovery never overwrites it.
- **Join repository** registers your GitHub identity in the initialized repository's Clockoli user list and creates or verifies your personal storage branch.
- **Initialize repository** creates the Clockoli marker and personal storage branch; for an empty repository, it also creates the first commit and default branch.

A checked ready repository remains **Ready — not connected** until you choose **Connect repository** and confirm; only then does it appear in **Default time repository**. If a target needs initialization, the **Initialize repository** review dialog opens once after inspection. Dismissing the review leaves **Initialize repository** beside the status so you can reopen it; other available actions appear beneath the check status.

Clockoli rechecks repository state and permissions before applying the confirmed action. Initializing an organization repository requires fresh GitHub repository-admin permission; an ordinary teammate can join a valid initialized repository but cannot initialize an unmarked one.

After confirmation succeeds, the repository appears under **Time repositories**. Shared repositories provide copyable instructions for other people who should join them.

### Default repository and finishing setup

Connections are additive: the first becomes the default and later additions preserve it. The first confirmed repository action completes initial setup when a usable default is registered and authorization is not blocked; there is no separate Finish click or page reload. For later additions, use the separate **Default time repository** selector, then **Finish setup** once that default is usable. Finish stops polling, invalidates late discovery replies, and clears the remembered target without remote writes.

### Background discovery

Discovery only reads GitHub and never connects newly granted repositories. It runs on demand for autocomplete and explicit checks, and refreshes silently every 3 seconds during active setup only when a target is remembered or an authorization is pending. Polling pauses during the pending grant handoff and never reopens a dismissed review.

Unchanged results preserve focus, scroll, drafts, messages, and open dialogs, except that a newly granted remembered target needing initialization opens its read-only review dialog once. Background errors keep the last good suggestions without a notification; explicit checks report errors. There is no **Refresh repositories** or **Review connection** button.

### Authorization changes

A new or replacement GitHub authorization is confirmed automatically when it belongs to the same GitHub identity, can read every configured time repository, and cannot strand active or queued work. This check performs no repository writes. If any check fails, the current credentials remain in use and Clockoli shows one account-level recovery message; there is no per-repository **Confirm authorization** button.

## Share a repository with teammates

A time repository can be shared: each teammate joins it and writes to their own personal branch. See [Work as a team](teams.md) for initialization, invitations, collaborator avatars, and removing access. Use separate time repositories for different privacy boundaries.

## Manage connected repositories

Each connected repository has a card in **Time repositories** with **Check access**, **Open repository**, **Manage GitHub access**, **Make default**, and **Remove from Clockoli**. Removing a repository from Clockoli affects only this browser; repository data, GitHub App access, and Git history are not deleted. See [Settings](settings.md#time-repositories).

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

Personal branches keep each user's routine timer commits off the default branch and reduce write conflicts between team members. An existing configuration can temporarily retain its prior storage branch while active or pending work prevents a safe transition to the personal branch.

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
  "producer": { "kind": "browser_extension", "name": "clockoli-chrome", "version": "0.2.0" },
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
- keep only canonical HTTP(S) work-item URLs without credentials, or the narrowly validated `owner/project/task-slug` identity for unresolved imported work (not a clickable URL);
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

Top tasks, Activity, participant totals, and Reports can read selected or all configured time repositories. Each destination is loaded independently. If one fails, Clockoli can show records from the repositories that succeeded together with a partial-data warning. Conflicting copies of the same record ID are omitted and reported. Reports disables export until the selected result is complete and conflict-free.

Reports lists valid personal branches in each selected time repository, reads represented monthly JSONL files for the selected local-date range, and downloads immutable blobs as needed. It keeps **Task source** (the tracked URL's host or GitHub repository) separate from **Time repository** (the storage destination).

On GitHub issue and pull-request pages, participant all-time totals read one `.clockoli/tasks.json` file from each relevant personal branch. The sidebar does not scan monthly history. Top tasks aggregate the same canonical URL across selected destinations and preserve destination provenance.

Repository readers can see stored actor identities, work-item URLs and titles, timestamps, descriptions, metadata, metrics, and execution details. Local hourly rates and billable calculations are not stored in work records.

## Administrative operations

### Add repositories and change routing

Use **Time repositories** in Settings to add eligible personal or organization destinations. Use **Projects and routing** to order URL rules, assign each project to a destination, and select the explicit default for unmatched URLs. Adding or changing routing does not delete or transfer existing records. See [Projects and routing](projects-and-routing.md).

The GitHub App flow supports several destinations under one GitHub account. PAT compatibility mode remains limited to one destination.

### Sign out of a browser

**Sign out on this browser** removes local sign-in but leaves GitHub authorization, App installation, repository data, and local configuration in place.

### Revoke or uninstall

Revoking Clockoli user authorization (**Revoke GitHub sign-in** in Settings) and uninstalling the GitHub App are separate GitHub operations. Neither deletes repository data. Delete or archive data only through an explicit repository administration process.
