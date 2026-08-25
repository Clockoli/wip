# Time-data repository setup

Clockoli uses one dedicated private GitHub repository as the durable store for active timers and completed records. Do not use a source-code repository unless its access and branch policy are intentionally suitable for time data.

## Individual setup

Create a private repository such as `your-login/clockoli-data`. The normal onboarding flow opens GitHub's repository-creation form from the Clockoli template and then asks you to grant the Clockoli GitHub App access to that repository.

Required conditions:

- private visibility;
- repository not archived or disabled;
- the signed-in user can read and write;
- Clockoli App **Contents: Read and write** for this repository;
- a default branch or an empty repository Clockoli can safely initialize;
- branch policy permits Clockoli's direct marker and personal-branch writes.

Use **Only select repositories** when granting App access.

## Shared team setup

For shared reporting:

1. Create one dedicated private data repository.
2. Install the Clockoli GitHub App for only that repository.
3. Give each tracker user sufficient GitHub read/write rights.
4. Have each user authorize Clockoli separately and select the same repository.
5. Let Clockoli create and verify the user's personal storage branch.
6. Give reporting-only users read access if they are allowed to see all stored task references and descriptions.

Use separate data repositories when teams have different privacy boundaries. App installation access is not enough by itself: each signed-in user still needs suitable GitHub permissions and must be able to use the repository's branch/ruleset policy.

> **Storage namespace:** Clockoli uses `.clockoli/` control paths and `clockoli/users/` personal branches exclusively.

## Default branch and personal branches

The default branch contains the shared repository marker:

```text
.clockoli/config.json
```

Clockoli creates one user branch for each stable numeric GitHub identity:

```text
clockoli/users/{github-user-id}
```

The branch contains:

```text
.clockoli/user.json
active/{storage-login}.txt
times/{YYYY-MM}/{storage-login}.txt
```

Routine timer writes occur on the personal branch, not the default branch. This isolates users' writes and reduces shared-ref conflicts. Reports reads all valid marked personal branches and any valid records on the default branch.

Do not manually create a branch under `clockoli/users/` and expect Clockoli to adopt it. Existing branches must have valid ownership metadata matching the branch's stable user ID; unknown ownership fails closed.

## Repository marker

`.clockoli/config.json` records:

- repository format version;
- creation timestamp and creator;
- stable GitHub user ID to immutable storage-login mappings.

The marker is a compatibility and ownership boundary. Clockoli validates its exact structure and refuses to write over an unknown future format, malformed mapping, or incompatible reserved tree.

## Time files

An active timer is plain text:

```text
URL: https://github.com/acme/frontend/issues/123
Title: Ranking regression
Start: 2026-08-22T09:00:00+03:00
Description: optional single-line text
```

A completed record is plain text:

```text
URL: https://github.com/acme/frontend/issues/123
Title: Ranking regression
Start: 2026-08-22T09:00:00+03:00
End: 2026-08-22T10:15:00+03:00
Description: optional single-line text
```

`Title` and `Description` are optional. Records in a monthly file are separated by a blank line.

The canonical URL can point to any HTTP(S) task. Legacy GitHub issue/PR blocks remain readable.

## Manual inspection and editing

Files are deliberately readable, but editing them outside Clockoli bypasses its UI validation and concurrency checks. If you edit manually:

- keep only valid HTTP(S) URLs without embedded credentials;
- keep one-line Title and Description fields within their limits;
- keep explicit timezone offsets on Start and End;
- keep the file's `times/YYYY-MM/` month consistent with the represented Start date;
- keep recognized field names and blank-line separators;
- do not duplicate a record across the default and personal branches;
- make changes as one reviewed Git commit.

A malformed monthly file is reported rather than partially ignored. Repair the complete file before retrying the operation or report.

Edits and deletions remain visible in Git history unless an administrator rewrites history. For independent backup, use normal Git backup procedures such as `git clone --mirror`.

## Existing repositories and migration safety

Clockoli can use an existing private repository only after it validates the reserved tree and `.clockoli/config.json` marker. It will not guess that arbitrary existing `active/`, `times/`, or `.clockoli/` content belongs to Clockoli.

Configuration, authentication-mode, repository, and branch transitions are blocked while an active timer or pending write could be stranded. Finish and synchronize work first.

Valid records on the selected default/custom branch remain readable while personal branches are introduced. Clockoli deduplicates equivalent records when Reports combines the sources.

### Migration from obsolete daily files

Do not keep daily and monthly representations of the same records together; reports can duplicate them, and older clients may continue writing obsolete paths.

Migrate all validated records in one Git commit, preserve active files byte-for-byte, verify every output block, and keep the pre-migration commit as a rollback point. Use a migration process that supports a read-only dry run and validates the complete result before the commit.

## Branch and ruleset guidance

Clockoli writes directly through the GitHub API. The selected default branch must allow the shared marker to be initialized or updated when users are registered, and each `clockoli/users/{id}` branch must permit the user's routine writes.

A ruleset that requires pull requests for every change can prevent normal timer operations. Use a dedicated repository with a policy designed for direct, authenticated time-data writes rather than weakening rules on a source repository.

## Reports access

Reports lists valid personal branches, reads represented monthly files for the selected Start-date range, and downloads immutable blobs as needed.

Repository readers can therefore see all stored URLs, optional titles, timestamps, and descriptions across users. Local hourly rates and billable calculations are not stored in the repository.

## Administrative operations

### Change repository

Use **Change data repository** in Settings. Clockoli validates the new stable repository identity and storage before switching. It does not delete or transfer the old data.

### Disconnect a browser

**Disconnect this browser** removes local sign-in but leaves GitHub authorization, App installation, repository data, and local configuration as described in Settings. It is not remote revocation.

### Revoke or uninstall

Revoking Clockoli user authorization and uninstalling the Clockoli GitHub App are separate GitHub operations. Neither deletes time data. Delete or archive repository data only through an explicit repository administration process.
