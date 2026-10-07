# Time-data repository setup

Clockoli can use several dedicated private GitHub repositories as durable destinations for active timers and completed work records. Each destination is a **time repository**. A repository whose issue or pull request you track is a **source repository**; it is not automatically a time repository and Clockoli does not need write access to it.

## Connect time repositories

Sign in with GitHub, then paste a GitHub repository URL or `owner/name` and leave the field or press Enter to check it. Or type at least two characters of a repository name and choose one of up to eight matching GitHub App-granted suggestions from the dropdown; choosing checks the target but does not connect it. The catalog is fetched on demand rather than displayed in full when setup opens. Use the refresh icon beside the field to recheck the target. There is no separate existing/new or owner-type selection. If you need a repository, use **Create a new time repository**, then return and paste its URL into the **New repository URL** dialog to check it.

Clockoli requests missing App access only for the checked target and remembers that target across the GitHub visit and Settings reload. The access dialog appears only after an explicit target check. **Grant access** closes it immediately. When an installation is already known, its settings are used. Returning to Settings checks an unresolved remembered target after a one-second settling delay, even if the access dialog was closed or Settings was reloaded. If the grant is not visible yet, return again after completing it on GitHub to recheck. If it needs initialization, the **Initialize repository** review dialog opens after inspection; review the writes and confirm there. Dismissing the review leaves **Initialize repository** beside the status so you can reopen it. Other available actions appear beneath the check status. Discovery refreshes silently every 3 seconds during active setup only when a target is remembered or authorization is pending; polling pauses during the pending grant handoff and does not reopen a dismissed initialization review. A missing private repository does not prove it does not exist; check its name, your access, and the App grant. Checking is necessary because an App grant alone does not prove the repository is private, writable, compatible with Clockoli storage, or that your personal branch and task index belong to you. It does not connect the repository. Review **Connect repository**, **Set up storage branch**, **Join repository**, or **Initialize repository** and explicitly confirm the offered action.

Discovery reads GitHub but never connects newly granted repositories. Unchanged results preserve focus, scroll, drafts, messages, and dialogs, except that a newly granted remembered target needing initialization opens its read-only review dialog once. Background errors retain the last good suggestions. There is no **Refresh repositories** or **Review connection** button; discovery never performs remote writes. A checked ready repository remains **Ready — not connected** until you choose **Connect repository** and confirm. That action revalidates the repository and registers it locally, without changing repository files; only then does it appear in **Default time repository**. An explicit check opens the appropriate access or initialization/join/branch-setup dialog when needed; read the privacy disclosure and exact writes before confirming. Even **Set up storage branch** can create or verify your personal storage branch.

Connections are additive: the first becomes the default and later additions preserve it. The first confirmed repository action completes initial setup when a usable default is registered and authorization is not blocked; there is no separate Finish click or page reload. For later additions, use the separate **Default time repository** selector, then **Finish setup** once that default is usable. A new or replacement GitHub authorization is confirmed automatically after Clockoli read-validates every configured destination under the same GitHub identity and atomically verifies that no active or queued work can be stranded. This authorization check performs no repository writes. If it is blocked, Clockoli reports one account-level action instead of showing a button on every repository. Finish stops polling, invalidates late discovery replies, and clears the remembered target without remote writes.

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
3. In the connected repository card, open **Invite teammates** with the + circle beside collaborator avatars. A repository administrator can search by GitHub username and review each result's login, public display name (if set), and avatar. Choose the account and confirm **Check access and invite**. Clockoli rechecks the selected GitHub user ID, repository coordinates, accepted collaborator access, and pending invitations, then requests GitHub repository **write** access only if neither exists. **About access and invitations** explains the permission scope; **What your teammate does next** contains shareable setup steps and a copy action. The administrator may also grant access through GitHub directly.
4. Each teammate signs in separately, chooses the existing marked repository, reviews the disclosure, and explicitly confirms **Join repository**.
5. Clockoli creates and verifies each user's personal storage branch.
6. Give reporting-only users read access only if they may inspect all stored work data in that repository.

An ordinary employee cannot use the join flow to initialize an unmarked organization repository. Repository discovery and inspection never write a marker, branch, membership, or work record.

Settings shows up to four current GitHub collaborator avatars and four pending GitHub account invitations beside each connected time repository, with separate ellipses when more verified accounts exist. Pending invitations have a dashed accent ring and a dot; hovering an avatar shows the GitHub login and, for pending invitees, the invitation state. Email-only invitations have no GitHub account avatar and are not shown; the pending lookup scans up to five pages so an email-only page does not imply more account avatars. The adjacent + circle has an **Add teammate** hover title and opens that repository's invitation form; it does not send an invitation. These are repository access states, not Clockoli-joined users or task assignees. The read-only lookup is scoped to that configured repository; a failed or inconclusive invitation read silently omits unavailable status and preserves known collaborators. A failed collaborator read shows “Collaborators unavailable”. Avatars come only from GitHub's avatar host, with an initial as fallback.

To revoke access, select a verified collaborator avatar beside the connected repository in Settings and choose **Remove @user** from its dropdown; a pending GitHub account invitation avatar instead offers **Cancel invitation for @user**. Your own account avatar is not a removal control. Confirm the repository and account before Clockoli verifies repository identity, admin permissions, account ID, and current access and asks GitHub to remove the collaborator or cancel the invitation. Removing access does not delete existing time records or Git history. A failure retains the action for retry; confirmed success refreshes the displayed avatars. Only the first four accounts in each category appear here; use **Manage GitHub access** for others or email-only invitations. Avatar actions require a connected GitHub App installation with Administration write permission and repository-admin rights; PAT connections show noninteractive avatars.

Inviting requires both the signed-in user's repository-admin rights and **Administration: Read and write** on the Clockoli GitHub App installation. The App owner must enable that permission in the App settings and installations must accept the updated permission request before inviting works. Choose **Only select repositories** and grant the App access to the intended time repository; App permissions apply to every repository selected for that installation, **not** automatically to all repositories in your GitHub account. Organization and enterprise policies may forbid outside collaborators. A GitHub invitation is not a Clockoli join: the recipient accepts on GitHub, grants the App access to the same repository if needed, and confirms their own join/branch setup in Clockoli. Search and membership checks do not write to the time repository.

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

Use **Time repositories** in Settings to add eligible personal or organization destinations. Use **Projects and routing** to order URL rules, assign each project to a destination, and select the explicit default for unmatched URLs. Adding or changing routing does not delete or transfer existing records.

The GitHub App flow supports several destinations under one GitHub account. PAT compatibility mode remains limited to one destination.

### Disconnect a browser

**Disconnect this browser** removes local sign-in but leaves GitHub authorization, App installation, repository data, and local configuration as described in Settings.

### Revoke or uninstall

Revoking Clockoli user authorization and uninstalling the GitHub App are separate GitHub operations. Neither deletes repository data. Delete or archive data only through an explicit repository administration process.
