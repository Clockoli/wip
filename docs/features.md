# RepoClock feature guide

## URL-first task tracking

RepoClock treats the canonical HTTP(S) URL as the task identity. A task can be:

- a GitHub issue or pull request;
- a ticket in another system;
- a document, dashboard, customer record, or design;
- any other HTTP(S) page.

A title is optional. GitHub titles and status are metadata, not part of the durable identity. For GitHub issue and pull-request URLs, RepoClock removes navigation-only query and fragment data so opening the same task through a notification link does not create another task.

The toolbar popup supports any HTTP(S) active tab. The injected stopwatch and native-looking split control are limited to `github.com`.

## Active timer

RepoClock maintains one GitHub-backed active timer per user.

- Start records the canonical URL, optional title, and timezone-bearing Start timestamp.
- Stop saves an optional description with the completed record.
- Elapsed time is calculated from the stored Start timestamp, not from an in-page tick counter.
- A connected browser can read the active timer written by another connected browser.
- **Tracking this task** confirms that the current page matches the timer.
- **Tracking another task** makes a mismatched active URL obvious.
- A pending completion blocks another Start until it is synchronized or resolved.

Stopping an entry longer than 12 hours asks for confirmation. The warning does not impose a duration limit.

## Main tracking panel and popup

The GitHub panel and browser toolbar popup use the same tracking component. They include:

- active URL, optional title, live elapsed time, and optional Stop description;
- Start, Stop, Sync, Tasks, Reports, and Settings actions;
- pending-write and conflict status;
- rotating totals for Today, This week, Last week, and This month;
- recent entries grouped by task URL;
- relative day labels and stored wall time;
- direct time correction, Edit, and Delete.

The GitHub split control survives GitHub's client-side navigation and mounts next to the authenticated user's avatar. Its arrow always opens Tasks/Reports navigation.

## Recent entries

The main panel shows cached entries immediately when available and refreshes them automatically. It loads up to 50 recent entries from the configured display window. The display window defaults to seven local calendar days and can be set from 1 to 31 days.

Changing this setting does not alter stored data or limit reports. Recent data is read by monthly file rather than one API request per record.

### Direct time correction

Each completed row has one compact `HH : MM - HH : MM` range. The four hour/minute values stay on one line; their accessible Start and Stop labels remain available to assistive technology.

- Type an hour or minute directly in the always-visible Start/Stop inputs; opening the full **Edit** form is not required.
- Wheel and trackpad gestures never mutate time values or trap panel scrolling, and there are no `−`/`+` step controls.
- A direct correction remains a local draft until **Save time** is selected.
- All relevant row controls are disabled while a mutation is in flight.
- Validation or network errors keep the draft available for correction or retry.

If the edited Start moves before the previous interval's Stop, the previous Stop moves to the new Start. If the edited Stop moves after the next interval's Start, the next Start moves to the new Stop. All touched records are preflighted and saved together. Cross-month changes use one atomic Git commit.

Strict intersections are highlighted as **Overlaps another entry**. Entries that only touch at one endpoint are not overlaps.

### Full Edit and Delete

**Edit** supports:

- task URL;
- optional title, up to 300 characters;
- Start and Stop date/time;
- description, up to 2,000 characters.

Changing the URL clears an unchanged old title so metadata from one task is not silently carried to another.

**Delete** requires confirmation and uses the loaded file version and original record content to avoid deleting the wrong entry after another edit. Git history retains the previous file version unless a repository administrator rewrites history.

## Tasks page

**Recently tracked work** aggregates the current user's completed and running sessions by canonical URL.

- Search by URL or optional title.
- Periods: last 2 weeks, month, 3 months, 6 months, or year.
- Status filters: Open, Closed, and All.
- GitHub issue/PR status and state reason are shown when metadata is available.
- Generic URL tasks appear under Open and All as `Tracked URL`; they are not presented as confirmed GitHub Open issues.
- Completed and running time participate in ordering.
- The task URL appears as a compact source line, with the optional title as the prominent link below it. Untitled tasks show the URL as the primary link without duplication.
- Inline direct-input time-range controls use the same serialized timer state as the popup.

The page reads only the current user's monthly paths before hydrating GitHub issue/PR metadata. Metadata is bounded and cached; inaccessible metadata falls back to the stored URL/title rather than hiding tracked time.

## Reports

Reports includes records whose Start date falls in the selected inclusive range.

### Periods

- This week and Last week
- This month and Last month
- This quarter and Last quarter
- This year and Last year
- Custom Start and End dates

### Summary and facets

The summary shows:

- tracked time;
- billable amount;
- entry count;
- people count;
- source count.

Filter by People and Sources. For a GitHub issue or pull request, the Source is `owner/repository`; for another URL it is the hostname.

### Analytics

Choose one vertical metric:

- Total time
- Avg time per distinct task
- Billable amount
- Task count, deduplicated by canonical URL

Choose independent horizontal and stack dimensions:

- Day
- Week
- Month
- Person
- Source
- Task

The data table under the chart is loaded only when expanded, which keeps large reports responsive.

### Export

- CSV timesheet
- JSON timesheet
- Native browser print or save-to-PDF

CSV and JSON include URL, Start, End, duration, person, description, and available GitHub task fields. When local rates are configured, exports also include hourly rate, billable amount, and currency.

## Local billable rates

Settings accepts one three-letter currency code and non-negative hourly rates keyed by GitHub login.

- Rates are stored as integer minor units.
- Billable totals are calculated from each person's tracked seconds and rounded after aggregation rather than rounding every record early.
- Rates and calculated amounts stay in extension-local storage.
- A teammate's browser can use different rates for the same shared repository.
- Missing rates contribute zero and are identified in the report summary.

## Data repository and personal branches

RepoClock validates one dedicated private GitHub repository. Each user writes routine timer data to a marked branch named:

```text
repoclock/users/{stable-github-user-id}
```

This keeps users' normal timer commits off the repository's default branch and reduces write conflicts between team members. Reports discovers the marked personal branches and merges them with compatible legacy records on the default branch.

See [Data, privacy, and security](data-and-privacy.md) for file formats and permissions.

## Synchronization and offline Stop

Starting requires a reachable GitHub destination. Stopping is designed to survive a temporary network failure:

1. RepoClock records a stable pending completion in extension-local IndexedDB.
2. It appends or verifies the intended monthly record with SHA protection.
3. It advances the retry stage locally.
4. It removes only the matching active file.
5. It preserves a newer timer written by another browser or device.

Pending writes are retried at startup and approximately once per minute. **Sync now** triggers an immediate attempt.

If GitHub is temporarily unreachable, the panel can show that the completion is saved locally and waiting to sync. Do not clear local configuration while work is pending.

## Conflict handling

RepoClock checks repository identity, branch routing, file SHA, and original record content before mutation.

- A stale monthly file is not silently overwritten.
- Concurrent Stops converge only when RepoClock can prove the existing completion matches the timer.
- A changed active timer is preserved.
- A missing active timer with no matching completion is reported separately from a saved completion/newer-timer conflict.
- Multi-file edits publish one Git commit after all files pass preflight.
- Malformed remote text produces a visible error instead of being partially ignored.

## Settings backup and connection controls

### Backup

Exported settings contain display preferences, local billing, and reference-only repository coordinates. They exclude all secrets and time data. Import never reconnects GitHub or changes the active destination.

### Connection actions

- **Change data repository** validates a new destination and does not delete the old repository.
- **Disconnect this browser** removes local sign-in while leaving GitHub authorization and repository data unchanged.
- **Revoke RepoClock authorization on GitHub** opens GitHub's authorization settings. It does not uninstall the App or delete data.
- **Clear local configuration** removes local RepoClock credentials and settings. Stop active work and synchronize pending writes first.

## Deliberate limits

The current beta does not include manual entry creation, reminders, mobile applications, Firefox packaging, or a side-by-side conflict diff editor. Data-repository administrators can rewrite Git history, so Git history is inspectable and recoverable but not tamper-proof against administrators.
