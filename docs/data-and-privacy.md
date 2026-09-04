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

- a Clockoli repository-format and user-mapping marker;
- a personal-branch ownership marker;
- one active JSON work record per actor;
- completed monthly JSONL work records;
- Git commits and history created by changes to those files.

Every work record uses schema `1` and stores a stable ID, actor, work item, activity timestamps and local calendar context, producer, description, metadata, metrics, and optional execution identity. This model represents human and agent work without changing the root schema.

Duration and billable amount are calculated. Wall-clock duration is derived from activity timestamps; hourly rates remain local.

## What remains local to the extension

Clockoli uses extension-origin IndexedDB for:

- GitHub App access/refresh credentials or PAT compatibility credentials;
- resumable Device Flow state;
- selected configuration and generation counters;
- pending mutation stages and conflict state;
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
clockoli/users/{stable-github-user-id}
```

That branch contains the ownership marker and canonical v1 work data:

```text
.clockoli/user.json
.clockoli/tasks.json
active/{storage-login}.json
times/{YYYY-MM}/{storage-login}.jsonl
```

The stable numeric GitHub user ID is used in the branch name. The shared marker maps it to an immutable storage login used in file paths.

Routine Start, Stop, Edit, and Delete operations use the personal branch. Completed-record changes update the monthly JSONL and exact task-total index in one Git commit. Reports discovers only marked personal branches with valid ownership metadata. The default branch stores shared repository metadata, not a second copy of work records.

## Data format v1

Clockoli supports one persistent data format. It does not read or migrate any earlier pre-release representation.

An active file is one JSON object. A monthly file is JSON Lines with one compact completed record per non-empty line. Each record includes:

- `schema_version: 1`, a stable ULID, and `record_type: "work"`;
- `actor`, independent from the writing `producer`;
- a canonical `work_item` identity, URL, and title;
- UTC activity timestamps plus `local_date` and an IANA timezone;
- description, metadata, namespaced metrics, and optional agent execution identity;
- UTC creation and update timestamps.

The same ID is retained when a running record becomes completed. Rewriters preserve unknown root and nested fields, allowing additive evolution without erasing data from other producers. See [Data Format v1](data-format-v1.md) for the normative contract.

`.clockoli/tasks.json` maps each canonical task URL to exact `totalSeconds`, `sessionCount`, and sorted `recordIds` values for that personal branch. The IDs let a queued completion be deduplicated exactly across an atomic-commit retry. GitHub sidebar totals read this small index from every user branch instead of scanning all monthly files. Missing, malformed, or inconsistent indexes fail closed; Clockoli does not report them as zero.

### URL normalization

- Only `http:` and `https:` URLs are accepted.
- Credentials in URLs are rejected.
- GitHub issue/PR query strings and fragments are removed because navigation parameters do not change the work item.
- Query strings for other sites are preserved because they may be meaningful identity.
- Work-item titles are optional and bounded to 300 characters.
- Descriptions are optional and bounded to 2,000 characters.

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

### Clockify and add-on boundary

The planned Clockify migration add-on will be a first-party packaged provider adapter, not a privileged integration. It will read detailed-report data only from a user-opened authenticated Clockify tab; its page data will be untrusted and validated by the core. Clockify tokens, cookies, and headers will never be collected or retained. The core retains all GitHub/storage privileges, credentials, and record-writing authority; provider adapters do not receive them.

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

- Git blob SHAs and stable record IDs protect Edit and Delete from stale views.
- A record is located by its persistent ID; its mutable array index is only a UI/storage hint.
- Linked time corrections and cross-month moves preflight every affected file and publish one Git commit.
- Every completed-record add, edit, move, or delete updates `.clockoli/tasks.json` in that same commit.
- Stop preserves the active record ID and uses stable operation identity so retries and concurrent devices converge without duplicate records.
- A stale completion never clears a newer active timer.

## Offline behavior

Clockoli accepts timer mutations locally during temporary connectivity loss, but GitHub remains the canonical destination:

- Start, Stop, and task switches are persisted in the extension-local queue and retried.
- A locally accepted mutation is not fully synchronized until its GitHub write completes.
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

## Exchange rates for reports

When **Billable amount** is selected for a report that contains more than one currency, Clockoli requests historical daily exchange rates from the public [Frankfurter API](https://frankfurter.dev/), an open-source project maintained at [lineofflight/frankfurter](https://github.com/lineofflight/frankfurter).

Clockoli sends only the selected target currency, the source currency codes, and the required date range. It does not send GitHub identities, task URLs, descriptions, hourly-rate amounts, or tracked durations. A whole date range is requested in one bulk call, and the resulting per-day conversion factors are cached in extension-local storage. Dates without a published institutional rate, such as weekends, use the latest rate available on or before that date. A recent weekday fallback is rechecked for a bounded publication window so a rate requested before that day's quote is published does not become permanently stale.

If Frankfurter does not provide one of the currencies, Clockoli reports that limitation instead of silently excluding billable records.
