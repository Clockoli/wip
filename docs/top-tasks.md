# Top tasks

See the tasks you tracked recently with their total time, and pick any of them up again with one click.

Open **Top tasks** from the toolbar panel navigation or the GitHub split-menu arrow.

## What the list shows

Top tasks aggregates the current user's completed and running sessions by canonical task identity across selected time repositories.

- Search by URL or optional title.
- Periods: last 2 weeks, month, 3 months, 6 months, or year. The list includes entries whose Start date falls in the selected period.
- Completed and running time participate in ordering.
- The task identity appears as a compact source line, with the optional title as the prominent link below it. Untitled URL tasks show the URL as the primary link without duplication. Imported tasks without a navigable URL show a non-link identity and title.
- Each aggregate retains sorted time-repository provenance so identical URLs from different destinations are not misattributed.

## Start a task again

Each task, including unresolved Clockify imports with a bare `owner/project/task-slug` identity, shows accumulated time and a Start/Stop control. Starting another task stops the running timer first and keeps the imported identity unchanged. Page-originated starts and manually entered new tasks still require HTTP(S) URLs.

Use **Add time** next to the page tabs to add a completed entry or start a timer for any task; see [Add a single entry](editing-time.md#add-a-single-entry).

## Loading and titles

The page reads the current user's monthly paths from the selected destinations before hydrating optional GitHub issue/PR titles. Destinations load independently, so available tasks may remain visible with partial-read status. Metadata is bounded and cached; inaccessible metadata falls back to the stored URL/title rather than hiding tracked time.

If a task is missing, check the selected period and the URL/title filter. Top tasks shows only your own time; use [Reports](reports.md) for teammates.
