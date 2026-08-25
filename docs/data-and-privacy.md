# Data, privacy, and security

Clockoli separates durable shared time data from browser-local secrets and preferences.

## Architecture at a glance

```text
GitHub page / active browser tab
              │ page-safe task URL and title
              ▼
Chrome extension UI ── trusted messages ── Manifest V3 service worker
                                                   │
                       extension-local IndexedDB ◄──┤
                       credentials, preferences,    │ direct GitHub API
                       pending retry state, caches  ▼
                                      private GitHub data repository
```

There is no Clockoli application server between the extension and GitHub.

## What the GitHub repository stores

The durable repository can contain:

- a Clockoli format and user mapping marker;
- a personal-branch ownership marker;
- one active timer per user;
- completed monthly time records;
- Git commits and history created by changes to those files.

A completed record stores:

- canonical task URL;
- optional task title;
- Start timestamp with timezone offset;
- End timestamp with timezone offset;
- optional description;
- the user identity derived from its storage path.

Duration and billable amount are calculated. They are not persisted in time records.

## What remains local to the extension

Clockoli uses extension-origin IndexedDB for:

- GitHub App access/refresh credentials or PAT compatibility credentials;
- resumable Device Flow state;
- selected configuration and generation counters;
- pending Stop stages and conflict state;
- recent-entry and report caches;
- task metadata cache;
- recent-entry display preference;
- per-person hourly rates and each rate's currency sign or description;
- settings-backup revision state.

GitHub page JavaScript and content scripts do not receive credentials or raw local billing settings. The extension requests no `chrome.storage` permission; its data store is scoped to the extension origin.

## Repository and branch layout

The repository's default branch owns the shared marker:

```text
.clockoli/config.json
```

Clockoli provisions a personal branch for each GitHub user:

```text
repoclock/users/{stable-github-user-id}
```

That branch contains an ownership marker and the user's normal timer data:

```text
.clockoli/user.json
active/{storage-login}.txt
times/{YYYY-MM}/{storage-login}.txt
```

The stable numeric GitHub user ID is used in the branch name. The shared marker maps that stable ID to an immutable storage login used in file paths.

Routine Start, Stop, Edit, and Delete operations use the personal branch. Reports discovers only branches with valid ownership metadata, reads the represented users, and merges compatible legacy default-branch data without duplicating equivalent records.

## Text format

### Active timer

```text
URL: https://example.com/work/42?view=full
Title: Optional task title
Start: 2026-08-22T09:00:00+03:00
Description: optional single-line text
```

### Completed record

```text
URL: https://example.com/work/42?view=full
Title: Optional task title
Start: 2026-08-22T09:00:00+03:00
End: 2026-08-22T10:15:00+03:00
Description: optional single-line text
```

`Title` and `Description` may be omitted. Completed records in one monthly file are separated by a blank line.

The month in `times/YYYY-MM/` is derived from the stored Start timestamp's represented calendar date. Every timestamp includes an explicit offset so edits do not silently reinterpret the original wall time.

### URL normalization

- Only `http:` and `https:` URLs are accepted.
- Credentials in URLs are rejected.
- GitHub issue/PR query strings and fragments are removed because notification and navigation parameters do not change the underlying task.
- Query strings for other sites are preserved because they may be meaningful task identity.
- Task titles are optional and bounded to 300 characters.
- Descriptions are optional and bounded to 2,000 characters.

Older GitHub issue/PR blocks remain readable and are projected into the URL-first model when possible.

## GitHub permissions

Normal Device Flow setup has two separate grants:

1. **User authorization** identifies the signed-in GitHub user and gives the browser a user access token.
2. **GitHub App installation access** limits which repositories Clockoli can access.

The data repository must grant **Contents: Read and write** to the Clockoli App. The signed-in user also needs appropriate repository and branch rights. Clockoli does not request repository Administration permission just to create a data repository; setup opens GitHub's repository-creation form instead.

Tracking a URL does not post time data back to that page or source system. A GitHub issue/PR can be tracked without giving Clockoli write access to its source repository. Metadata enrichment is available only when the authenticated user can read the relevant GitHub task.

The advanced PAT path should use a fine-grained token restricted to the one private data repository with **Contents: Read and write**.

## Security boundaries

### Page versus extension

GitHub pages are untrusted input. Clockoli's privileged GitHub credentials remain in extension-controlled contexts. Content-script requests are allowlisted and bound to a validated canonical sender URL; extension-only pages have their own message policy.

The GitHub control uses a closed Shadow DOM and rejects synthetic privileged activation. This reduces the page's ability to inspect or programmatically trigger extension controls.

### Repository verification

Before writing, Clockoli verifies the configured repository's stable GitHub ID, canonical owner/name, private visibility, branch route, and accessibility. Repository rename/transfer recovery is bounded and identity-based; Clockoli does not silently write to a different repository that happens to occupy old coordinates.

### Storage ownership

Repository adoption fails closed:

- unknown or future marker formats are rejected;
- malformed reserved paths are rejected;
- a personal branch without valid ownership metadata is ignored or rejected rather than claimed;
- one storage login cannot be assigned to two stable users;
- active or pending work blocks unsafe account/repository transitions.

### Concurrent mutations

- Git blob SHAs and original record content protect Edit and Delete from stale views.
- A record is located by canonical content, not only by its mutable array index.
- Linked time corrections and cross-month moves preflight every affected file and publish one Git commit.
- Stop uses a stable operation identity and exact-content checks so retries can converge without duplicate records.
- A stale completion never clears a newer active timer.

## Offline behavior

Clockoli is not fully offline-first:

- Start requires a reachable GitHub repository.
- Stop can be persisted locally and retried.
- Pending writes are attempted at extension startup and on a one-minute alarm.
- **Sync now** requests an immediate retry.
- A new Start is blocked while a completion is pending or conflicted.

Do not clear browser data or Clockoli local configuration while a Stop is waiting to synchronize.

## Reports cache

Reports first checks the configured branch using an ETag. An unchanged branch can reuse the extension-local snapshot. When a branch changes, Clockoli downloads only monthly blobs whose immutable Git SHA is not already cached.

Cache entries are scoped to repository, branch, user, and configuration generation as appropriate. Configuration changes cancel stale loads and prevent old results from being committed into a new context.

The cache is an optimization, not the authoritative time store.

## Billing privacy

Hourly rates and their currency signs or descriptions stay in extension-local IndexedDB. They are not written to GitHub and are not included in shared time records.

Billable money uses integer minor units and tracked seconds. Clockoli aggregates before final rounding to avoid accumulating per-record rounding errors.

The settings JSON backup can include rates, so protect that backup according to the sensitivity of your rate card.

## Settings backup exclusions

A settings export includes local display and billing preferences plus reference-only repository coordinates. It excludes:

- access and refresh tokens;
- personal access tokens;
- Device Flow codes;
- active timers;
- pending writes;
- tracked records;
- report and metadata caches.

Import validates the entire file and applies supported local preferences atomically. It does not reconnect GitHub or switch repositories.

## Access and privacy consequences

Anyone with read access to the data repository can inspect stored task URLs, titles, timestamps, descriptions, and user branches. URLs and descriptions can reveal sensitive customer or project information.

Use separate data repositories when groups have different access boundaries. Grant the Clockoli App access only to the intended repository and use **Only select repositories** during installation.

Git history helps recovery and review, but a GitHub repository administrator can rewrite or delete history. Use repository policy and optional `git clone --mirror` backups when stronger retention is required.
