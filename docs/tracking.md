# Track a task

Clockoli tracks time against a task URL. Start a timer from the toolbar panel on any HTTP(S) page, or from the stopwatch Clockoli adds to GitHub.

## What counts as a task

Clockoli treats the canonical HTTP(S) URL as the task identity. A task can be:

- a GitHub issue or pull request;
- a ticket in another system;
- a document, dashboard, customer record, or design;
- any other HTTP(S) page.

A title is optional. GitHub titles are metadata, not part of the durable identity. For GitHub issue and pull-request URLs, Clockoli removes navigation-only query and fragment data so opening the same task through a notification link does not create another task. Tracking an issue from a GitHub Projects issue pane uses its direct `owner/repo/issues/number` URL, not the project view URL. Previously saved project-view records retain their original identity; they are not automatically merged. Query strings on other sites are preserved because they may identify different work.

The toolbar popup supports any HTTP(S) active tab. The injected stopwatch and native-looking split control are limited to `github.com`. Internal browser pages such as `chrome://extensions` cannot be tasks.

## Start and stop from the toolbar panel

1. Open the page you want to track.
2. Select the Clockoli toolbar icon. On HTTP(S) pages it opens a partial-height daily panel; on restricted pages it opens an Activity tab instead.
3. Choose **Track this task**.
4. When you finish, open the panel again, add an optional description, and choose **Stop and save**.

The panel uses the active tab's current URL and title when you start.

Above the timeline, the active-task strip shows **Not tracking** and **Track this task**, or a **Tracking now** card with the running task link, elapsed time to the minute, today's tracked total, editable Stop description, and **Stop and save**. The panel keeps Description narrow and groups **Start**, **Duration**, and **Today** in the same compact style as Activity; on wide screens its card is centered. An unavailable daily total displays **…**.

The centered **Timeline**, **Calendar**, and **List** tabs sit beneath the tracking status in Activity, the toolbar popup, and the GitHub panel. The timeline's block Start and Stop actions remain available. See [Activity](activity.md) for the views themselves.

## Start and stop on GitHub

Clockoli adds a split stopwatch control before your GitHub avatar:

- the stopwatch opens the tracking panel for the current GitHub URL;
- the arrow always opens navigation to **Top tasks**, **Activity**, and **Reports**.

The split control survives GitHub's client-side navigation and mounts next to the authenticated user's avatar. On GitHub, the stopwatch animates only when the active timer belongs to the task open in that tab.

The smaller GitHub stopwatch dialog includes an optional Stop description, separate **Stop and save** and **Save and switch to this task** actions when viewing another task, stationary Today and This week totals, and recent entries with inline correction and Delete. Recent entries label their dates **Today**, **Yesterday**, or with a short weekday name. When complete route-matched participant totals are available, it also shows **Tracked on this issue/PR**, noting included running time. Beautified tracking commit events retain their original commit links on the timestamps.

## One timer at a time

Clockoli maintains one global GitHub-backed active timer per user across all configured time repositories.

- Start records the canonical URL, optional title, and timezone-bearing Start timestamp.
- Stop saves an optional description with the completed record.
- Elapsed time is calculated from the stored Start timestamp, not from an in-page tick counter.
- A connected browser can read the active timer written by another connected browser.
- The GitHub stopwatch dialog says **Tracking this task** when the active timer matches the current page, and **Tracking another task** when a different URL is active.

## Switch to another task

When another task is open, **Switch to this task** sits beside the view tabs, outside the running card. It saves the active timer and starts the current page. The smaller GitHub stopwatch dialog offers **Save and switch to this task** for the same action.

For a cross-repository switch, Clockoli first durably queues the source completion, then queues the target Start behind it, and resumes that ordering after a restart. This preserves one timer even though the two repositories cannot be updated in one Git commit. The active timer and accepted queued writes retain their destination even if [routing](projects-and-routing.md) later changes.

Starting a task from [Top tasks](top-tasks.md), an Activity List row, or **Track time** in Timeline or Calendar details also stops the running timer first.

## Long timers

Every Stop or switch asks for confirmation when the active entry exceeds 12 hours. This catches forgotten timers; the warning does not impose a duration limit.

## Change the running start

The running-status strip on Activity, Top tasks, Reports, Settings, and the panel provides inline **Start**: click to select the time, type `1000` for `10:00`, then press Enter or the checkmark to save without changing the timer's date. Only the running start timestamp is sent; an overlap rejection leaves the draft and original timer in place, and a green **✓ Saved** appears after local acceptance.

To change the start date as well, use **Edit** on the running block in Timeline or Calendar; see [Edit a running timer's start](editing-time.md#edit-a-running-timers-start).

## Descriptions

All editable time **Description** fields in the running tracker, GitHub panel, Activity List, Timeline, Calendar, and Add time support multiple lines:

- **Enter** saves locally (or submits Add time);
- **Shift+Enter** inserts a new line;
- a visible green **✓ Saved** confirms acceptance without waiting for GitHub.

A description-only Enter never stops the running timer. Description editors expand when opened and as you type, showing up to eight or nine lines. Longer text has a visible **↓ More lines — scroll** hint and remains accessible within the scrollable editor. Both the local queue and GitHub JSON/JSONL preserve embedded newlines. Descriptions are optional and limited to 2,000 characters.

## Recent entries in the panel

The main panel shows cached entries immediately when available and refreshes them automatically. It loads up to 50 recent entries from the configured display window. The display window defaults to seven local calendar days and can be set from 1 to 31 days in [Settings](settings.md#activity-display). Changing this setting does not alter stored data or limit reports. Recent data is read by monthly file rather than one API request per record.

## How the panel behaves

The panel first reads local state and shows **Loading…** until configuration is known. On other websites, an idle panel explains that the page can be tracked and that time is saved to the private GitHub repository.

State refreshes update controls, totals, errors, and the timeline clock while preserving the mounted editor, its viewport, focused block, and panel scroll position. A vertical wheel gesture over the timeline scrolls the panel when it has more content; a horizontal gesture still moves the timeline.

Opening focuses the strip's main action; closing with the panel control or Escape restores the previous focus. Switching tabs or moving focus away from the page closes the panel without moving focus; reopening reads the latest state. Clicking the underlying page closes the panel without taking focus back from the clicked page element. Escape first cancels a timeline edit or selection, then closes the panel when the editor leaves it unhandled.

Connection errors show a headline, detail, and recovery action; Retry refreshes reads without repeating a tracking mutation. Queue diagnostics are hidden unless enabled in [Advanced settings](settings.md#diagnostics); when shown, they start collapsed. Actionable conflicts remain visible. Reduced-motion users see static stopwatch and toolbar icons.

## Navigation

Both the toolbar panel and the GitHub control provide **Top tasks**, **Activity**, **Reports**, and **Settings** navigation.
