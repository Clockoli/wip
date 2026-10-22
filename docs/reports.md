# Reports

Reports combines tracked time from selected or all time repositories, including teammates' personal branches you can read. Filter it, chart it, export timesheets, and start invoices from it. Open it from the toolbar panel navigation or the GitHub split-menu arrow.

Reports includes records whose Start date falls in the selected inclusive range.

## Choose a period

Open the date-range button beneath Reporting period to choose a preset or custom dates. The button shows the selected date range, including when a preset is selected.

- Today and Yesterday
- Last 7 days and Last 30 days
- This week and Last week
- This month and Last month
- This quarter and Last quarter
- This year and Last year
- Custom Start and End dates

Presets apply immediately. In the calendar, select a Start day and then an End day; choosing an earlier second day starts a new range. You can also edit the native Start and End date fields. Month navigation leaves the selection unchanged. Arrow keys move between days, Enter or Space selects, and Escape closes the picker and returns focus to the button. Clicking outside also closes it.

Clockoli enforces bounded file, byte, and record budgets so one report cannot make unbounded authenticated requests. If Reports asks for a shorter period, choose one and load again.

## Local time or UTC

The footer names the local time zone. Turn on UTC to include and group entries by their UTC Start date, using that same date for effective rates, exchange rates, exports, and invoices. With UTC off, reporting uses each entry's recorded local date. UTC reporting also reads the adjacent monthly files so records near a month boundary are included correctly.

The switch is saved locally across reloads and is included in settings exports; settings files without it use the local basis. Reporting preferences and invoices are never written to the time-data repository.

## Summary and filters

The summary shows:

- tracked time;
- billable amount;
- entry count;
- people count;
- source count.

Filter by People, Projects, Task sources, and Time repositories. For a GitHub issue or pull request, the **Task source** is `owner/repository`; for another URL it is the hostname. The **Time repository** is the destination that stores the record.

## Charts

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
- Task source
- Time repository
- Task

The analytics are calculated for the chart; the data table's rows are rendered only when expanded, which keeps large reports responsive.

Billable amounts need [billable rates](billable-rates.md). When a report contains more than one currency, Reports offers a currency selector for billable charts and converts amounts by day.

## Export a timesheet

- CSV timesheet
- JSON timesheet
- Native browser print or save-to-PDF

CSV and JSON include task URL and title, Start, End, duration, person, and description. They do not include the time repository or additional GitHub issue/PR metadata. When local rates are configured, each exported row also includes its effective hourly rate, per-entry billable amount, and that rate's currency.

Downloads use the currently loaded report, date range, filters, and local rates. Reload after changing settings or repository data, then download again.

To bill a client, use **Create invoice**; see [Invoicing](invoicing.md).

## Partial reports

Each destination is loaded independently. If one fails, Clockoli keeps records from the repositories that loaded, marks the result partial, and identifies the unavailable destinations. Conflicting copies of the same record ID are omitted and also make the result partial.

While the selected data is partial, Clockoli disables CSV, JSON, and print/PDF timesheet exports. Invoice creation may still be available for the filtered records: confirm that every intended repository loaded before printing an invoice.

## How Reports reads repositories

Reports lists valid personal branches in each selected time repository, reads represented monthly JSONL files for the selected date range, and downloads immutable blobs as needed. For each repository, it first checks the configured branch using an ETag; an unchanged branch can reuse the extension-local snapshot, and a changed branch downloads only monthly blobs whose Git SHA is not already cached. The cache is an optimization, not the authoritative time store.
