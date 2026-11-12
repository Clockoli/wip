# Track a task

Track tasks by URL in Activity. Both the browser toolbar icon and the Clockoli icon in GitHub open Activity in a separate tab.

## What counts as a task

Clockoli treats the canonical HTTP(S) URL as the task identity. A task can be:

- a GitHub issue or pull request;
- a ticket in another system;
- a document, dashboard, customer record, or design;
- any other HTTP(S) page.

A title is optional. GitHub titles are metadata, not part of the durable identity. For GitHub issue and pull-request URLs, Clockoli removes navigation-only query and fragment data so opening the same task through a notification link does not create another task. Tracking an issue from a GitHub Projects issue pane uses its direct `owner/repo/issues/number` URL, not the project view URL. Previously saved project-view records retain their original identity; they are not automatically merged. Query strings on other sites are preserved because they may identify different work.

The toolbar icon works from any HTTP(S) page. The Clockoli icon added to GitHub works the same way. Internal browser pages such as `chrome://extensions` cannot be tasks.

## Start and stop from the toolbar button

1. Open the page you want to track.
2. Select the Clockoli toolbar icon. Activity opens in a separate browser tab, or focuses an already open Activity tab.
3. In the **From current page** banner, choose **Track this task** (or **Switch to this task** when another timer is running).
4. When you finish, choose **Stop and save** in Activity.

![Activity after a toolbar click on a support ticket: the From current page banner offers Switch to this task above the running timer](images/activity-from-current-page.png)

The toolbar icon and the GitHub icon hand off only the validated source-page URL and title. It uses one-use privileged IndexedDB (cleared when Activity reads it), not query parameters. Opening Activity directly does not reuse an old task. Dismiss the source URL with **×** without affecting your timer.

Activity shows the same weekly statistics, running status, quick-start tasks and calendar/timeline controls regardless of how it was opened. The original GitHub page is unaffected.

Quick start also appears on Activity, Top tasks, Reports, and Settings. Each recent task shows the description from its latest time entry, if present. Starting it reuses that description and focuses the running Description with its text selected: leave it to continue the same work, press Backspace to clear it, or type to replace it. Tasks without a saved description start with an empty focused field.

If GitHub rate-limits a tracking-status refresh, the locally stored timer remains visible. The tracking strip reports the rate limit and its retry time instead of claiming that local tracking status could not load; the warning clears after a successful GitHub refresh.

The accessible **Timeline**, **Calendar**, and **List** icon switcher sits beside the theme control in Activity. The timeline's block Start and Stop actions remain available. See [Activity](activity.md) for the views themselves.

## Tracking strip layout

When a timer is running, Activity stacks **Tracking now**, the task title, and its editable description on the left. The description fills the space to the metrics column, including when empty. **Started** and **Duration** sit on the right, with **Stop and save** below them at the same width as the metrics above. On narrow screens, these controls stack beneath the description, with the time controls and Stop button aligned to the right.

Top tasks, Reports, and Settings keep their compact tracking card, which still shows **Today**. There the running description expands across the available space between the task title and time controls; on narrow screens it occupies its own row.

## Open Activity from GitHub

Clockoli adds a stopwatch icon before your GitHub avatar. Click it to open or focus the standalone Activity tab, with the current issue, pull request, or GitHub page shown in the **From current page** banner. The GitHub page remains intact. Clockoli does not insert a tracking panel on top of it.

The icon stays available during GitHub's client-side navigation. It animates when the task open in that tab is currently being tracked.

## One timer at a time

Clockoli maintains one global GitHub-backed active timer per user across all configured time repositories.

- Start records the canonical URL, optional title, and timezone-bearing Start timestamp.
- Stop saves an optional description with the completed record.
- Elapsed time is calculated from the stored Start timestamp, not from an in-page tick counter.
- A connected browser can read the active timer written by another connected browser.

## Switch to another task

When another task is running, the **From current page** banner in Activity offers **Switch to this task**. It saves the active timer and starts the selected page.

For a cross-repository switch, Clockoli first durably queues the source completion, then queues the target Start behind it, and resumes that ordering after a restart. This preserves one timer even though the two repositories cannot be updated in one Git commit. The active timer and accepted queued writes retain their destination even if [routing](projects-and-routing.md) later changes.

Starting a different task from [Top tasks](top-tasks.md), an Activity List row, or **Track again** in Timeline or Calendar details also stops the running timer first. A past entry of the *currently* tracked task cannot stop the active timer; only the actual running entry has **Stop and save**.

## Long timers

Every Stop or switch asks for confirmation when the active entry exceeds 12 hours. This catches forgotten timers; the warning does not impose a duration limit.

## Change the running start

The running-status strip on Activity, Top tasks, Reports, and Settings provides inline **Started**. The time is an underlined text field, not a separate pencil button: click it to select the time, type `1000` for `10:00`, then press Enter or the checkmark to save without changing the timer's date. Only the running start timestamp is sent; an overlap rejection leaves the draft and original timer in place with an error, and a green **✓ Saved** appears after local acceptance.

To change the start date as well, use **Edit** on the running block in Timeline or Calendar; see [Edit a running timer's start](editing-time.md#edit-a-running-timers-start).

## Descriptions

All editable time **Description** fields in the running tracker, Activity List, Timeline, Calendar, and Add time support multiple lines:

- **Enter** saves locally (or submits Add time);
- **Shift+Enter** inserts a new line;
- a visible green **✓ Saved** confirms acceptance without waiting for GitHub.

A description-only Enter never stops the running timer. Description editors expand when opened and as you type, showing up to eight or nine lines. Longer text has a visible **↓ More lines — scroll** hint and remains accessible within the scrollable editor. Both the local queue and GitHub JSON/JSONL preserve embedded newlines. Descriptions are optional and limited to 2,000 characters.

When Activity opens with a running timer, the running description receives focus once the view is ready. Type a description, press Tab to focus **Stop and save** (skipping Started), then press Enter to stop and save the timer. Shift+Tab and direct editing of Started remain available. If Stop is disabled, Tab does not force focus onto it.

## Loading and errors

Activity can display locally cached entries immediately while refreshing data. Connection errors show a headline, detail, and recovery action; Retry refreshes reads without repeating tracking mutations. Queue diagnostics remain hidden unless enabled in [Advanced settings](settings.md#diagnostics); actionable conflicts remain visible.

## Navigation

The dedicated Activity tab provides **Top tasks**, **Activity**, **Reports**, and **Settings** navigation. Both Clockoli icons open or focus Activity.
