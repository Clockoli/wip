# Why Clockoli

Clockoli is not a hosted time-tracking service with GitHub added as an integration. GitHub is the durable data layer, and the browser extension is the application.

That design changes who controls the records, how they can be inspected, and what happens if you stop using the product.

## The short version

Choose Clockoli when you want:

- time data in private personal and organization repositories you control;
- a readable, portable format instead of a vendor-only database;
- direct Git history for review, backup, and recovery;
- no Clockoli server or second SaaS account;
- one task model that works with GitHub and arbitrary HTTP(S) pages;
- reports across selected time repositories without writing private rates to them.

Choose a conventional hosted tracker when your priority is turnkey installation, automatic updates, native mobile applications, reminders, mature invoicing workflows such as retainers and payment reminders, or support for people who should not need GitHub access.

## How the model differs

| Question | Clockoli | Conventional hosted tracker | Browser-local timer | Spreadsheet/manual notes |
|---|---|---|---|---|
| Where are records stored? | Readable files in your private GitHub time repositories | Vendor-managed database | One browser profile or vendor sync | A file you maintain |
| Who controls retention and access? | Your repository administrators | Vendor and workspace administrators | The local profile owner | File owner |
| Can you read the data without the product? | Yes, as text and Git history | Usually through the product or an export | Product-dependent | Yes |
| Is a separate application server required? | No Clockoli server | Yes | Not always | No |
| Is task identity tied to one issue tracker? | No; any HTTP(S) URL | Product-dependent | Product-dependent | No |
| Team reporting | Selected private repositories and marked personal branches | Hosted workspace | Usually limited | Manual aggregation |
| Billing privacy | Rates stay in each browser | Commonly stored in the workspace | Product-dependent | File-dependent |
| Automatic updates/mobile/reminders | Not in the current beta | Common | Product-dependent | No |

This is a design comparison, not a claim that one category is universally better. Clockoli deliberately trades some SaaS convenience for control and transparency.

## Advantages of the Git-backed approach

### 1. Data ownership is structural

Clockoli does not promise that you can export later; it writes directly to destinations you already control. Repository access rules, organization policy, backup, retention, and deletion apply from the first tracked entry.

If Clockoli is unavailable, the time records still exist as ordinary text in GitHub and in any repository backup.

### 2. The format is portable

A completed v1 work record contains its actor, work item, activity, producer, metadata, metrics, UTC timestamps, local date, IANA timezone, and optional description. Records are grouped into monthly JSONL files.

This can be read by a person, cloned with Git, parsed by a small script, or transformed into another system. You do not need a proprietary database dump just to recover task-level time.

### 3. Auditability is built in

Edits and deletes change Git files, so prior versions remain in normal Git history. You can inspect who changed a file, compare versions, or restore an earlier commit.

Git history is not tamper-proof against repository administrators; they can rewrite it. Clockoli therefore provides strong inspectability and practical recovery, not immutable compliance logging.

### 4. There is no Clockoli data server

The extension communicates directly with GitHub. Clockoli does not operate a second server that receives tracked URLs, descriptions, or billing settings.

This reduces the number of systems that must be trusted and operated. GitHub is still a dependency, and GitHub availability and API limits still matter.

### 5. Tasks are URL-first

Issue-only trackers work well until work starts in a document, support console, customer portal, design tool, or another repository host. Clockoli uses a canonical HTTP(S) URL as the identity, so the same timer can follow the work wherever it lives.

GitHub issues and pull requests receive richer metadata when available, but provider metadata never becomes a requirement for tracking.

### 6. Team writes are isolated

Each authenticated user writes routine timer data to a branch named from their stable GitHub user ID. This reduces shared-branch write contention and avoids filling the default branch with every Start/Stop commit.

Reports discovers marked personal branches across selected destinations and presents one aggregated view. A fail-closed ownership marker prevents an unrelated pre-existing branch from being silently adopted as a user's storage branch.

### 7. Billing data can remain private

A manager can read shared time records and apply local hourly rates without committing those rates or calculated amounts to the team repository. Each browser can maintain a different rate card for the same data.

This is useful when time should be shared but commercial terms should not. The tradeoff is that rate settings must be backed up and moved separately.

### 8. Routing stays explicit

One GitHub account can use several personal and organization time repositories. Ordered URL rules route each new Start, and an explicit default catches unmatched work. Clockoli pins active and queued work to the chosen destination, so changing a rule cannot silently relocate an accepted record.

### 9. Safety is visible rather than implicit

Clockoli validates repository identity, privacy, branch routing, storage ownership, record shape, and file versions before writing. It uses Git SHAs and atomic commits for linked or cross-month corrections.

Discovery and inspection never write to GitHub or connect repositories locally; checked ready time repositories become available only after you confirm Connect repository. Joining or initializing also requires explicit confirmation, and an ordinary employee cannot initialize an unmarked organization repository. Incompatible files and unknown ownership fail closed instead of being guessed around.

## Compared with an issue-tracker timer

Clockoli keeps the useful contextual behavior—a stopwatch inside GitHub and metadata for issues/PRs—without making those coordinates the durable model.

That gives you:

- the same task identity in the toolbar panel, Top tasks, Activity, Reports, and storage;
- arbitrary URLs without a separate manual project hierarchy;
- one durable URL identity for GitHub issues, pull requests, and other HTTP(S) tasks;
- separate Task source grouping by GitHub repository or generic hostname and Time repository provenance.

Generic URLs do not need provider metadata. Clockoli tracks, groups, searches, and reports them by URL and optional title.

## Compared with a spreadsheet

A spreadsheet gives strong control but depends on consistent manual entry. Clockoli adds:

- a live one-click timer;
- contextual URL capture;
- one active timer state across connected browsers;
- guarded editing and deletion;
- automatic duration calculation;
- structured Top tasks, Activity, and Reports;
- recoverable offline Stop operations.

A spreadsheet remains better for unconstrained custom modeling. Clockoli can add completed entries one at a time with **Add time** or in bulk on the Activity page while retaining its validated monthly storage format.

## Compared with a local-only browser timer

Local-only storage is simple and private but can disappear with a browser profile, remain unavailable on another machine, and provide no natural team audit trail.

Clockoli uses the browser for credentials, preferences, retry state, and private billing rates, but treats GitHub as the durable source for timers and completed records. That enables multi-browser state, repository backup, and team reporting while keeping sensitive commercial settings local.

## Tradeoffs to consider

Clockoli is intentionally opinionated:

- GitHub is required for authentication and durable storage.
- Everyone who tracks into a shared repository needs appropriate GitHub access.
- Readers of each time repository can see the URLs, titles, timestamps, and descriptions stored there.
- Branch protection or rulesets that prevent direct writes can make a repository unsuitable.
- Start, Stop, and switches are accepted into durable local queues and then reconciled with GitHub; cross-repository switches depend on source completion before target Start.
- Chrome and other Chromium browsers install from the Chrome Web Store. Firefox and Safari builds are not yet in their stores, so those file installations update manually.
- There is no mobile app or reminder system; forgotten time is added afterwards with **Add time** or **Bulk time adding**.
- Local rates are not synchronized with teammates.

These are not hidden implementation gaps; they follow from the current product scope and should be part of the adoption decision.
