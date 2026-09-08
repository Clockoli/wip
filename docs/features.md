# Clockoli feature guide

## URL-first task tracking

Clockoli treats the canonical HTTP(S) URL as the task identity. A task can be:

- a GitHub issue or pull request;
- a ticket in another system;
- a document, dashboard, customer record, or design;
- any other HTTP(S) page.

A title is optional. GitHub titles are metadata, not part of the durable identity. For GitHub issue and pull-request URLs, Clockoli removes navigation-only query and fragment data so opening the same task through a notification link does not create another task.

The toolbar popup supports any HTTP(S) active tab. The injected stopwatch and native-looking split control are limited to `github.com`.

## Active timer

Clockoli maintains one GitHub-backed active timer per user.

- Start records the canonical URL, optional title, and timezone-bearing Start timestamp.
- Stop saves an optional description with the completed record.
- Elapsed time is calculated from the stored Start timestamp, not from an in-page tick counter.
- A connected browser can read the active timer written by another connected browser.
- **Tracking this task** confirms that the current page matches the timer.
- **Tracking another task** makes a mismatched active URL obvious.
- A pending completion blocks another Start until it is synchronized or resolved.

Stopping an entry longer than 12 hours asks for confirmation. The warning does not impose a duration limit.

## Main tracking panel and popup

The browser toolbar opens a full-width daily panel on HTTP(S) pages. Above the timeline, the active-task strip shows **Not tracking** and **Track this task**, or the running task link, a ticking elapsed clock, and **Stop and save**. When another task is open, **Switch to this task** saves the active timer and starts the current page. The timeline's block Start and Stop actions remain available. Every Stop or switch asks for confirmation when the active entry exceeds 12 hours.

Below the timeline, **Today** lists completed entries by their stored local date, with task colors matching the timeline, start–stop times, durations, pending status, and **Continue**. Continue saves any running task before restarting the selected task. Stationary **Today** and **This week** totals include applicable running time; unavailable totals display **…**, including when GitHub summary reads fail. Older entries remain available in **Activity**.

The panel first reads local state and shows **Loading…** until configuration is known. On other websites, an idle panel explains that the page can be tracked and that time is saved to the private GitHub repository. State refreshes update controls, totals, save status, errors, and the timeline clock while preserving the mounted editor, its viewport, focused block, and panel scroll position. Opening focuses the strip's main action; closing restores the previous focus. Escape first cancels a timeline edit or selection, then closes the panel when the editor leaves it unhandled.

Overlapping visible timeline blocks produce one warning naming the entries and intervals, with **Fix in Activity**. Save status distinguishes local acceptance, work waiting for GitHub, confirmed GitHub saves, and conflicts. Queue diagnostics stay collapsed until opened, while actionable conflicts remain visible. Connection errors show a headline, detail, and recovery action; Retry refreshes reads without repeating a tracking mutation. Reduced-motion users see static stopwatch and toolbar icons.

The smaller GitHub stopwatch dialog includes an optional Stop description, separate **Stop and save** and **Save and switch to this task** actions when viewing another task, stationary Today and This week totals, and recent entries with inline correction and Delete. When complete route-matched participant totals are available, it also shows **Tracked on this issue/PR**, noting included running time. Beautified tracking commit events retain their original commit links on the timestamps.

Both surfaces provide Top tasks, Activity, Reports, and Settings navigation.

The GitHub split control survives GitHub's client-side navigation and mounts next to the authenticated user's avatar. Its arrow always opens Top tasks/Activity/Reports navigation.

## Recent entries

The main panel shows cached entries immediately when available and refreshes them automatically. It loads up to 50 recent entries from the configured display window. The display window defaults to seven local calendar days and can be set from 1 to 31 days.

Changing this setting does not alter stored data or limit reports. Recent data is read by monthly file rather than one API request per record.

### Direct time correction

Each completed row has one compact `HH : MM - HH : MM` range. The four hour/minute values stay on one line; their accessible Start and Stop labels remain available to assistive technology.

- Type an hour or minute directly in the always-visible Start/Stop inputs.
- Wheel and trackpad gestures never mutate time values or trap panel scrolling, and there are no `−`/`+` step controls.
- A direct correction remains a local draft until **Save time** is selected.
- All relevant row controls are disabled while a mutation is in flight.
- Validation or network errors keep the draft available for correction or retry.

If the edited Start moves before the previous interval's Stop, the previous Stop moves to the new Start. If the edited Stop moves after the next interval's Start, the next Start moves to the new Stop. All touched records are preflighted and saved together. Cross-month changes use one atomic Git commit.

Strict intersections are highlighted as **Overlaps another entry**. Entries that only touch at one endpoint are not overlaps.

### Unified inline editing and deletion

Selecting the displayed URL, title, or description expands those fields in the same inline draft as Start and Stop. Press Enter or select **Save time** to save:

- task URL;
- optional title, up to 300 characters;
- Start and Stop date/time;
- description, up to 2,000 characters.

Only one draft is active at a time. Starting another edit cancels the previous unsaved draft. A linked adjacent-boundary group remains available while the Times URL/title filter changes.

Changing the URL clears an unchanged old title so metadata from one task is not silently carried to another.

**Delete** requires confirmation and uses the loaded file version and original record content to avoid deleting the wrong entry after another edit. Git history retains the previous file version unless a repository administrator rewrites history.

## Top tasks page

**Recently tracked work** aggregates the current user's completed and running sessions by canonical URL.

- Search by URL or optional title.
- Periods: last 2 weeks, month, 3 months, 6 months, or year.
- Completed and running time participate in ordering.
- The task URL appears as a compact source line, with the optional title as the prominent link below it. Untitled tasks show the URL as the primary link without duplication.
- Inline direct-input time-range controls use the same serialized timer state as the popup.

The page reads only the current user's monthly paths before hydrating optional GitHub issue/PR titles. Metadata is bounded and cached; inaccessible metadata falls back to the stored URL/title rather than hiding tracked time.

## Activity page

Times loads the current user's completed entries for Today, Yesterday, this or last week, this or last month, or an inclusive custom range. URL/title filtering and the shared inline editor operate locally on the loaded range.

The bulk importer accepts one dated URL task per line with an optional description and a duration. It validates the complete request and existing history before one atomic Git commit, including intervals that cross in from older monthly files and a concurrently started active timer. A failed request writes nothing and keeps the draft available for correction.

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

CSV and JSON include URL, Start, End, duration, person, description, and available GitHub task fields. When local rates are configured, each exported row also includes its effective hourly rate, billable amount, and that rate's currency.

## Local billable rates

Settings accepts non-negative hourly rates keyed by GitHub login, with a currency sign or 2–12 letter description included in every rate value.

- Rates are stored as integer minor units.
- Billable totals are calculated from each person's tracked seconds and rounded after aggregation rather than rounding every record early. Different currencies remain separate; Reports exposes a currency selector for billable charts when needed.
- Rates and calculated amounts stay in extension-local storage.
- A teammate's browser can use different rates for the same shared repository.
- Missing rates contribute zero and are identified in the report summary.

## Invoicing

Create an invoice from the current filtered report, so the selected period, people, projects, and sources define what is billed. Each invoice uses one target currency. When effective-dated rates change within the period, Clockoli keeps the corresponding invoice lines separate; when the covered records use multiple currencies, it converts each entry using the exchange rate for that entry's date.

Clients can own projects, and picking a client narrows the invoice to that client's work without changing the report filters. Clockoli warns when an invoice also includes projects owned by another client.

The invoice is generated locally as a preview and can be printed or saved as PDF, downloaded as CSV, or downloaded as JSON. Unrated time remains visible as not billed. Invoice numbers are reserved only on the first export of a preview and are never committed to the time-data repository. The counter only ever moves forward: neither a settings save nor restoring an older settings backup can lower it below a number that has already been issued.

Version 1 does not support retainers, recurring invoices, reminders, payment links, per-line editing, sent or paid status, an invoice archive, or emailing invoices.

## Data repository and personal branches

Clockoli validates one dedicated private GitHub repository. Each user writes routine timer data to a marked branch named:

```text
clockoli/users/{stable-github-user-id}
```

This keeps users' normal timer commits off the repository's default branch and reduces write conflicts between team members. Reports discovers work records only from marked `clockoli/users/` personal branches; the default branch stores shared repository metadata.

See [Data, privacy, and security](data-and-privacy.md) for file formats and permissions.

## Synchronization and offline mutations

Start, Stop, and task switches are accepted durably in the extension-local queue, then synchronized with GitHub asynchronously:

1. Clockoli records a stable pending completion in extension-local IndexedDB.
2. It appends or verifies the intended monthly record with SHA protection.
3. It advances the retry stage locally.
4. It removes only the matching active file.
5. It preserves a newer timer written by another browser or device.

Pending writes are retried at startup and approximately once per minute. **Sync now** triggers an immediate attempt.

If GitHub is temporarily unreachable, the panel can show that the completion is saved locally and waiting to sync. Do not clear local configuration while work is pending.

## Conflict handling

Clockoli checks repository identity, branch routing, file SHA, and original record content before mutation.

- A stale monthly file is not silently overwritten.
- Concurrent Stops converge only when Clockoli can prove the existing completion matches the timer.
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
- **Revoke Clockoli authorization on GitHub** opens GitHub's authorization settings. It does not uninstall the App or delete data.
- **Clear local configuration** removes local Clockoli credentials and settings. Stop active work and synchronize pending writes first.

## Deliberate limits

The current beta includes manual completed-entry creation through the Times bulk importer. It does not include reminders, mobile applications, Firefox packaging, or a side-by-side conflict diff editor. Data-repository administrators can rewrite Git history, so Git history is inspectable and recoverable but not tamper-proof against administrators.
