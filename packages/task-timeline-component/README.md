# TaskTimeline for Clockoli

This workspace contains the **Clockoli-owned**, dependency-free `TaskTimeline` component and its integration adapter. The historical `vendor/` directory name refers to an imported standalone Clockoli prototype, not a third-party library.

## Layout

- `vendor/timeline-component.js` — Clockoli-owned component, maintained here with local-midnight day-band and Calendar selection behavior.
- `src/clockoli-adapter.js` — Clockoli data/callback/state/theme adapter.
- `scripts/build.mjs` — deterministically creates `src/content/task-timeline-component.js`.
- `tests/` — source/API contract tests.
- `e2e/` — Chromium tests for running/pending hydration, styling, reconcile, Timeline/Calendar mode, atomic switching, and overlap rejection.

The initial Clockoli prototype was imported from a local working copy. Its SHA-256 at import was:

```text
53ada0a8efff547af3009d8ddbf56d73ed1fd6da40f1520f8ef6bc4571d1727f
```

Clockoli patches `_renderDays()` so each band starts at local `00:00` instead of inheriting the arbitrary domain-start clock time. The reviewed patched SHA-256 is:

```text
babd006be2f7c47768ba6b8aea960d650815af10eb50b1a867d8bee38ae1c8fe
```

The Clockoli patch also keeps Calendar tasks below sticky labels, preserves focused tasks across Timeline renders so keyboard edits remain available, and adds a non-temporal trailing pixel gutter so `now` remains the final time while a running block stays visible.

## Commands

```bash
npm run build:timeline
npm run test:timeline
```

Chrome loads the generated `src/content/task-timeline-component.js` directly. Do not edit that artifact manually.
