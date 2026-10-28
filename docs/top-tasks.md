# Top tasks

See the tasks you tracked recently with their total time, and pick any of them up again with one click.

Open **Top tasks** from the toolbar panel navigation or the GitHub split-menu arrow.

## What the list shows

Top tasks aggregates the current user's completed and running sessions by canonical task identity across selected time repositories.

- Without a filter, the list and tracked-time totals show only your own work. Typing a title or URL also finds completed tasks tracked by people in the connected time repositories, even outside the selected period. A teammate-only result shows **—** instead of attributing their hours to you.
- Periods: last 2 weeks, month, 3 months, 6 months, or year. The list includes entries whose Start date falls in the selected period.
- Completed and running time participate in ordering.
- The task identity appears as a compact source line, with the optional title as the prominent link below it. Untitled URL tasks show the URL as the primary link without duplication. Imported tasks without a navigable URL show a non-link identity and title.
- URL tasks aggregate across destinations with sorted time-repository provenance. Imported non-URL identities remain separate per destination, even if their text matches; when multiple repositories are connected, their rows show the time repository so identical identities can be distinguished.

Cross-user suggestions require a nonempty task title. Untitled tasks remain in personal records and the unfiltered list. Search uses a local catalog built from each person's Git-backed task index; a match does not contact GitHub, while a miss refreshes those indexes before reporting no match. See [Search for a task](editing-time.md#search-for-a-task) for refresh and partial-result behavior.

## Start a task again

Each task, including unresolved Clockify imports with a bare `owner/project/task-slug` identity, shows accumulated time and a Start/Stop control. Starting another task stops the running timer first and keeps the imported identity unchanged. Page-originated starts and manually entered new tasks still require HTTP(S) URLs.

Use **Add time** next to the page tabs to add a completed entry or start a timer for any task; see [Add a single entry](editing-time.md#add-a-single-entry).

## Loading and titles

The page reads the current user's monthly paths from the selected destinations before hydrating optional GitHub issue/PR titles. Destinations load independently, so available tasks may remain visible with partial-read status. Metadata is bounded and cached; inaccessible metadata falls back to the stored URL/title rather than hiding tracked time.

If your own task is missing from the unfiltered list, check the selected period. Search can find older and teammate tasks, but Top tasks shows only your own time; use [Reports](reports.md) for teammates' time.
