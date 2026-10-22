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
                                   private GitHub time repositories
```

There is no Clockoli application server between the extension and GitHub.

## What each time repository stores

Each durable time repository can contain:

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
- the selected GitHub account, configured destination registry, explicit default destination, ordered project routing, and generation counters;
- pending mutation stages and conflict state;
- recent-entry and report caches;
- task metadata cache;
- recent-entry display preference;
- per-person hourly rates and each rate's currency sign or description;
- settings-backup revision state.

GitHub page JavaScript and content scripts do not receive credentials or raw local billing settings. Durable local data remains in extension-origin IndexedDB, and the extension does not request the `storage` permission.

## Time-repository and branch layout

Each time repository's default branch owns its shared marker:

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

`.clockoli/tasks.json` maps each canonical task identity to exact `totalSeconds`, `sessionCount`, and sorted `recordIds` values for that personal branch. Index keys are canonical HTTP(S) task URLs or bare unresolved Clockify identities in the form `owner/project/task-slug` (for example, `manticoresoftware/NexusRepo/Fixed-last-block-encoding`). The bare identity is not a guessed URL; ordinary browser tracking still requires HTTP(S). The IDs let a queued completion be deduplicated exactly across an atomic-commit retry. GitHub sidebar totals read this small index from every user branch instead of scanning all monthly files. Missing, malformed, or inconsistent indexes fail closed; Clockoli does not report them as zero.

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

Each time repository must grant **Contents: Read and write** to the Clockoli App. The signed-in user also needs appropriate repository and branch rights. Initializing a personal repository is an individual action. Initializing an organization repository requires GitHub repository-admin permission; teammates with ordinary write access join only after an administrator has created the valid marker. Clockoli has no separate permanent administrator role.

Discovery, inspection, classification, and preselection never write to GitHub or connect new destinations locally. An explicit confirmed **Connect repository** revalidates a ready repository and registers it locally without changing repository files, an existing default, or accepted work. Clockoli writes a marker or personal branch only after an explicit **Initialize repository**, **Join repository**, or **Set up storage branch** confirmation.

Tracking a URL does not post time data back to that page or source system. A GitHub issue/PR can be tracked without giving Clockoli write access to its source repository. Metadata enrichment is available only when the authenticated user can read the relevant GitHub task.

The advanced PAT path should use a fine-grained token restricted to one private time repository with **Contents: Read and write**. PAT compatibility mode supports one destination; multi-repository routing requires GitHub App authentication.

## Security boundaries

### Page versus extension

GitHub pages are untrusted input. Clockoli's privileged GitHub credentials remain in extension-controlled contexts. Content-script requests are allowlisted and bound to a validated canonical sender URL; extension-only pages have their own message policy.

The GitHub control uses a closed Shadow DOM and rejects synthetic privileged activation. This reduces the page's ability to inspect or programmatically trigger extension controls.

### Clockify and add-on boundary

The Clockify migration add-on is a first-party packaged provider adapter, not a privileged integration. It accepts either page-to-page Detailed Report capture from a user-opened authenticated Clockify tab or a user-selected native CSV export; both sources are untrusted and validated by the core. Clockify tokens, cookies, and headers are never collected or retained. The core retains all GitHub/storage privileges, credentials, and record-writing authority; provider adapters do not receive them.

### Repository verification

Before writing, Clockoli verifies the destination's stable GitHub ID, canonical owner/name, private visibility, branch route, and accessibility. Repository rename/transfer recovery is bounded and identity-based; Clockoli does not silently write to a different repository that happens to occupy old coordinates.

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

- Start, Stop, and task switches are persisted in destination-scoped extension-local queues and retried.
- One global active timer is shared across destinations. A cross-repository switch durably queues source completion before target Start.
- Every accepted timer and queued mutation stays pinned to its acceptance-time destination when routing changes.
- A locally accepted mutation is not fully synchronized until its GitHub write completes.
- Locally accepted queued writes are scheduled after 15 seconds of inactivity following the **latest** IndexedDB-accepted mutation, including coalesced changes to an existing queue entry. The queued timestamps survive worker restarts. A normal service-worker timer handles the fast path; an MV3 alarm (minimum 30 seconds in installed Chrome) and a recurring one-minute retry alarm handle worker suspension, browser restarts, and missed/deferred timers. Writes never start before the persisted quiet-period deadline. Consecutive independent edits can share one atomic commit, but tracked-time completions keep individual issue-reference commit messages.
- Clockoli also checks each configured personal branch for remote changes at startup and about once per minute. Unchanged branch ETags skip file downloads; changed snapshots hydrate only the current user's active record and the recent/summary monthly files into IndexedDB.
- This passive pull never displays a spinner, replaces UI elements, or waits on the local mutation queue. Any pending local work or concurrent local change defers applying the snapshot until a later pass. Oversized, malformed, or unavailable remote data leaves the previous local cache untouched.
- The open tracker keeps its current editor and view; pulled data is picked up on the next local-state read or user-requested refresh. Team-wide Reports and other-user branches continue to load on demand.
- The visible Refresh controls reload data only; they never push queued writes.
- A conflicted dependency can pause a queued cross-repository Start until its source completion is resolved.

Do not clear browser data or Clockoli local configuration while a Stop is waiting to synchronize.

## Aggregated reads and reports cache

Top tasks, Activity, participant totals, and Reports can load selected or all configured destinations. Each destination is independent: successful records remain visible when another destination fails, with explicit partial status. Reports distinguishes **Task source** from **Time repository** and disables exports while selected data is partial. Top tasks aggregate canonical URLs while retaining destination provenance.

For each repository, Reports first checks the configured branch using an ETag. An unchanged branch can reuse the extension-local snapshot. When a branch changes, Clockoli downloads only monthly blobs whose immutable Git SHA is not already cached.

Cache entries are scoped to repository, branch, user, and configuration generation as appropriate. Configuration changes cancel stale loads and prevent old results from being committed into a new context.

The cache is an optimization, not the authoritative time store.

## Billing privacy

Hourly rates and their currency signs or descriptions stay in extension-local IndexedDB. They are not written to GitHub and are not included in shared time records.

Billable money uses integer minor units and tracked seconds. Clockoli aggregates before final rounding to avoid accumulating per-record rounding errors.

The settings JSON backup can include rates and invoicing details, so protect that user-requested download according to the sensitivity of your rate card and customer data.

## Invoice privacy

Invoices are generated locally in the browser from time records read from the repository and invoicing settings held in extension-local IndexedDB. Hourly rates, computed amounts, seller details, and client details never leave the browser.

An invoice exists only as the on-screen preview and as a file the user prints or downloads. Clockoli does not archive invoices, and no invoice or invoice number is ever written to the time-data repository.

## Settings backup exclusions

A version 6 settings export includes local display and billing preferences plus credential-free destination references, the exported default destination, and project routing. It excludes:

- access and refresh tokens;
- personal access tokens;
- Device Flow codes;
- active timers;
- pending writes;
- tracked records;
- report and metadata caches.

Import validates the entire file and applies supported local preferences atomically. It restores project routes to destinations already configured in this browser and reports missing repositories and their routes as not restored; other eligible routes can still be restored. Destination references remain unverified, and the imported default does not replace this browser's current default. Import does not inspect repositories, verify access, add destinations, or reconnect GitHub.

## Access and privacy consequences

Anyone with read access to a time repository can inspect the task URLs, titles, timestamps, descriptions, and user branches stored there. URLs and descriptions can reveal sensitive customer or project information.

Use separate time repositories when groups have different access boundaries. Grant the Clockoli App access only to the intended repositories and use **Only select repositories** during installation.

Git history helps recovery and review, but a GitHub repository administrator can rewrite or delete history. Use repository policy and optional `git clone --mirror` backups when stronger retention is required.

## Exchange rates for reports

When **Billable amount** is selected for a report that contains more than one currency, Clockoli requests historical daily exchange rates from the public [Frankfurter API](https://frankfurter.dev/), an open-source project maintained at [lineofflight/frankfurter](https://github.com/lineofflight/frankfurter).

Clockoli sends only the selected target currency, the source currency codes, and the required date range. It does not send GitHub identities, task URLs, descriptions, hourly-rate amounts, or tracked durations. A whole date range is requested in one bulk call, and the resulting per-day conversion factors are cached in extension-local storage. Dates without a published institutional rate, such as weekends, use the latest rate available on or before that date. A recent weekday fallback is rechecked for a bounded publication window so a rate requested before that day's quote is published does not become permanently stale.

If Frankfurter does not provide one of the currencies, Clockoli reports that limitation instead of silently excluding billable records.
