(function installClockoliTaskTimeline(global) {
  'use strict';

  const DAY_MS = 24 * 60 * 60 * 1000;
  const MINIMUM_ITEM_WIDTH = 30;
  const COLOR_PALETTE = Object.freeze([
    '#e76f51', '#2a9d8f', '#e9c46a', '#8ab17d', '#f4a261',
    '#6d9dc5', '#c77dff', '#ff7096', '#43aa8b', '#f8961e',
    '#90be6d', '#577590', '#f94144', '#00b4d8', '#b8a1cf',
    '#ffbe0b', '#70d6ff', '#b56576', '#84a59d', '#ff9770',
  ]);

  function stableColorHash(value) {
    let hash = 2166136261;
    const text = String(value || '');
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function createColorResolver(palette = COLOR_PALETTE) {
    if (!Array.isArray(palette) || palette.length === 0) throw new TypeError('palette must not be empty');
    return item => palette[stableColorHash(item?.url || item?.id || '') % palette.length];
  }

  const resolveColor = createColorResolver();

  const CLOCKOLI_STYLE = `
    :host {
      --tt-panel: var(--bgColor-default, var(--ck-bg, #fff));
      --tt-text: var(--fgColor-default, var(--ck-fg, #1f2328));
      --tt-muted: var(--fgColor-muted, var(--ck-fg-muted, #59636e));
      --tt-border: var(--borderColor-default, var(--ck-border, #d1d9e0));
      --tt-grid: var(--borderColor-muted, var(--ck-border-muted, #d1d9e0b3));
      --tt-grid-major: var(--control-borderColor-emphasis, #818b98);
      --tt-empty: var(--bgColor-muted, var(--ck-bg-muted, #f6f8fa));
      --tt-shadow: none;
      --tt-radius: 0;
      color-scheme: light dark;
      font: var(--text-body-shorthand-medium, 400 14px/1.5 "Mona Sans VF", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
    }
    .shell { border: 0; border-radius: 0; box-shadow: none; background: var(--tt-panel); }
    .meta { min-height: 42px; padding-inline: 12px; background: var(--tt-panel); color: var(--tt-muted); }
    .viewport, .calendar-view, .calendar-viewport, .calendar-canvas,
    .calendar-hour-label, .calendar-project-header, .details { background: var(--tt-panel); }
    .viewport { border-block: 1px solid var(--tt-border); }
    .day-row, .calendar-toolbar, .calendar-sticky-header, .calendar-corner,
    .calendar-day-header { background: var(--bgColor-muted, var(--ck-bg-muted, #f6f8fa)); color: var(--tt-text); }
    @media (prefers-color-scheme: dark) {
      .content, .ruler-row, .task-row, .calendar-time-label, .calendar-row-name,
      .calendar-nav button { background: var(--tt-panel); }
      .ruler-cell, .day-band, .calendar-row-name { color: var(--tt-muted); }
      .row-label { background: var(--tt-panel); color: var(--tt-muted); }
      .calendar-day-header.today { background: var(--tt-empty); color: var(--tt-text); }
    }
    .task {
      --clockoli-task-background: color-mix(in srgb, var(--clockoli-task-color, #64748b) 34%, var(--tt-panel));
      --clockoli-task-accent: color-mix(in srgb, var(--clockoli-task-background) 78%, black);
      height: 40px !important;
      border: 1px solid color-mix(in srgb, var(--clockoli-task-color, #64748b) 44%, transparent);
      border-left: 3px solid var(--clockoli-task-color, #64748b);
      border-radius: 7px !important;
      background: var(--clockoli-task-background) !important;
      color: var(--tt-text) !important;
      box-shadow: none;
    }
    .task:hover:not(.editing), .task.hovered:not(.editing), .task.editing { box-shadow: none; }
    .task:hover, .task.hovered:not(.selected), .task.editing { z-index: 10; }
    .task.selected { outline: 2px solid var(--focus-outlineColor, var(--ck-focus, #0969da)); outline-offset: 1px; }
    .task.focused:not(.selected) { outline: 2px solid var(--focus-outlineColor, var(--ck-focus, #0969da)); outline-offset: 1px; }
    .task.pending { opacity: .72; }
    .task.pending::after { display: none; }
    .clockoli-entry-saving { position: absolute; left: 6px; top: 50%; z-index: 2; display: flex; align-items: center; gap: 6px; max-width: calc(100% - 12px); overflow: hidden; transform: translateY(-50%); color: var(--tt-text); font-size: 12px; font-weight: 600; line-height: 1.2; white-space: nowrap; pointer-events: none; }
    .task .clockoli-entry-saving { left: 14px; max-width: calc(100% - 20px); }
    .task.clockoli-saving .task-main { padding-left: 88px; }
    .task.clockoli-saving.clockoli-compact-saving .task-main { padding-left: 32px; }
    .task.clockoli-compact-saving .clockoli-entry-saving { max-width: none; overflow: visible; }
    .task.clockoli-compact-saving .clockoli-entry-saving-label { display: none; }
    .task.clockoli-minimum-width.clockoli-compact-saving .clockoli-entry-saving { left: 50%; width: 18px; justify-content: center; transform: translate(-50%, -50%); }
    .task.clockoli-minimum-width.clockoli-compact-saving .task-main { padding-left: 0; }
    .calendar-task.clockoli-saving .calendar-task-name { padding-left: 80px; }
    .clockoli-entry-saving-spinner { width: 12px; height: 12px; flex: none; border: 2px solid var(--tt-border); border-top-color: var(--focus-outlineColor, var(--ck-focus, #0969da)); border-radius: 50%; animation: clockoli-entry-spin .8s linear infinite; }
    @keyframes clockoli-entry-spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .clockoli-entry-saving-spinner { animation: none; } }
    .task.running { border-style: dashed; }
    .task.clockoli-minimum-width .edit-clock.start { left:auto; right:calc(100% + 4px); top:50%; bottom:auto; transform:translateY(-50%); }
    .task.clockoli-minimum-width .edit-clock.end { left:calc(100% + 4px); right:auto; top:50%; bottom:auto; transform:translateY(-50%); }
    .task.clockoli-minimum-width.clockoli-start-edge .edit-clock.start { left:0; right:auto; top:-20px; bottom:auto; transform:translateX(var(--clockoli-start-edge-shift, 0px)); }
    .task.clockoli-minimum-width.clockoli-end-edge .edit-clock.end { left:auto; right:0; top:-20px; bottom:auto; transform:translateX(calc(-1 * var(--clockoli-end-edge-shift, 0px))); }
    .task-main { padding-inline: 9px; }
    .task-name { overflow: hidden; text-overflow: ellipsis; }
    .resize-handle { width: min(14px, 40%); }
    .resize-handle::after {
      top: 0; bottom: 0; width: 11px;
      background-color: var(--clockoli-task-accent);
      background-image: linear-gradient(#000, #000),
                        linear-gradient(#000, #000);
      background-size: 2px 16px, 2px 16px;
      background-position: calc(50% - 2px) center, calc(50% + 2px) center;
      background-repeat: no-repeat;
    }
    .resize-handle.left::after { left: 0; border-radius: 4px 0 0 4px; }
    .resize-handle.right::after { right: 0; border-radius: 0 4px 4px 0; }
    .calendar-task .calendar-resize-handle { left: 0; right: 0; }
    .calendar-task .calendar-resize-handle::after {
      left: 0; width: 100%; height: 6px;
      transform: none;
      background-color: color-mix(in srgb, var(--clockoli-task-color) 70%, var(--tt-panel));
      background-image: linear-gradient(var(--tt-text), var(--tt-text)),
                        linear-gradient(var(--tt-text), var(--tt-text));
      background-size: 16px 1px, 16px 1px;
      background-position: center 2px, center 4px;
      background-repeat: no-repeat;
    }
    .calendar-task .calendar-resize-handle.start::after { top: 0; border-radius: 6px 6px 0 0; }
    .calendar-task .calendar-resize-handle.end::after { bottom: 0; border-radius: 0 0 6px 6px; }
    .task.editing.resize-left .resize-handle.left::after,
    .task.editing.resize-right .resize-handle.right::after {
      background-color: var(--clockoli-task-accent);
      background-image: linear-gradient(#000, #000), linear-gradient(#000, #000);
      box-shadow: none;
    }
    .calendar-task.editing.resize-left .calendar-resize-handle.start::after,
    .calendar-task.editing.resize-right .calendar-resize-handle.end::after {
      background-color: color-mix(in srgb, var(--clockoli-task-color) 70%, var(--tt-panel));
      box-shadow: none;
    }
    .calendar-task.editing.resize-left .calendar-resize-handle.start::after,
    .calendar-task.editing.resize-right .calendar-resize-handle.end::after { height: 6px; }
    .task:hover .resize-handle::after, .task.hovered .resize-handle::after,
    .task.selected .resize-handle::after, .task.focused .resize-handle::after,
    .task.editing .resize-handle::after { opacity: 1; transform: none; }
    .calendar-task:hover .calendar-resize-handle::after,
    .calendar-task.editing .calendar-resize-handle::after,
    .calendar-task.selected .calendar-resize-handle::after,
    .calendar-task.focused .calendar-resize-handle::after { opacity: 1; transform: none; }
    .connector-dot { background: var(--tt-text); box-shadow: 0 0 0 1px var(--tt-panel); }
    .row-label { color: var(--tt-muted); background: color-mix(in srgb, var(--tt-panel) 88%, transparent); }
    .calendar-task {
      border: 1px solid color-mix(in srgb, var(--clockoli-task-color, #64748b) 44%, transparent) !important;
      border-left: 3px solid var(--clockoli-task-color, #64748b) !important;
      border-radius: 7px !important;
      background: color-mix(in srgb, var(--clockoli-task-color, #64748b) 34%, var(--tt-panel)) !important;
      color: var(--tt-text) !important;
      box-shadow: none !important;
    }
    .calendar-task.selected, .calendar-task.focused { outline-color: var(--focus-outlineColor, var(--ck-focus, #0969da)); }
    .clockoli-calendar-favicon { width: 16px; height: 16px; margin: 0 5px 2px 0; border-radius: 3px; object-fit: contain; vertical-align: middle; }
    .clockoli-calendar-description { margin-top:2px; overflow:hidden; color:var(--tt-muted); font-size:9px; line-height:12px; text-overflow:ellipsis; white-space:nowrap; }
    .history-controls { display: none; }
    .clockoli-timeline-actions { margin-left: auto; display: flex; align-items: center; gap: 8px; }
    .clockoli-description-field { position: relative; flex: 1 1 260px; min-width: 160px; max-width: 420px; }
    .clockoli-timeline-description { width: 100%; margin: 0; padding: 6px 34px 6px 8px; border: 1px solid var(--control-borderColor-rest, var(--tt-border)); border-radius: 6px; background: var(--control-bgColor-rest, var(--tt-panel)); color: var(--control-fgColor-rest, var(--tt-text)); font: inherit; }
    .clockoli-description-save { position: absolute; top: 50%; right: 4px; display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; padding: 0; transform: translateY(-50%); border: 0; border-radius: 5px; background: transparent; color: #1f883d; font: 800 18px/1 sans-serif; cursor: pointer; }
    .clockoli-description-save:hover:not(:disabled) { background: color-mix(in srgb, #1f883d 12%, transparent); }
    .clockoli-description-save[hidden] { display: none; }
    .clockoli-timeline-action {
      min-height: 30px; padding: 5px 10px; border: 1px solid var(--button-default-borderColor-rest, var(--tt-border));
      border-radius: 6px; background: var(--button-default-bgColor-rest, var(--tt-panel));
      color: var(--button-default-fgColor-rest, var(--tt-text)); font: inherit; font-weight: 600; cursor: pointer;
    }
    .clockoli-timeline-action:hover:not(:disabled) { background: var(--button-default-bgColor-hover, var(--tt-empty)); }
    .clockoli-timeline-action.primary { border-color: var(--button-primary-borderColor-rest, #1f232826); background: var(--button-primary-bgColor-rest, #1f883d); color: var(--button-primary-fgColor-rest, #fff); }
    .clockoli-timeline-action.danger { color: var(--button-danger-fgColor-rest, #d1242f); }
    .clockoli-timeline-action:disabled { opacity: .5; cursor: default; }
    :host(.clockoli-activity-timeline) .details { align-items: stretch; gap: 10px; padding: 14px 12px 10px; }
    :host(.clockoli-activity-timeline) .details-info { flex: 1 1 100%; grid-template-columns: minmax(0, 1fr) repeat(3, auto); gap: 12px 20px; }
    :host(.clockoli-activity-timeline) .clockoli-timeline-actions { flex: 1 1 100%; flex-wrap: wrap; justify-content: flex-end; margin: 0; padding-top: 10px; border-top: 1px solid var(--tt-grid); }
    :host(.clockoli-activity-timeline) .clockoli-description-field { flex: 1 1 240px; max-width: none; }
    :host(.clockoli-activity-timeline) .clockoli-timeline-action { white-space: nowrap; }
    @media (max-width: 720px) {
      :host(.clockoli-activity-timeline) .details-info { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      :host(.clockoli-activity-timeline) .clockoli-timeline-actions { justify-content: flex-start; }
      :host(.clockoli-activity-timeline) .clockoli-description-field { flex-basis: 100%; }
    }
  `;

  function permissionsFor(item) {
    const pending = Boolean(item?.isPending);
    const editable = item?.isEditable !== false;
    const running = Boolean(item?.isRunning || item?.endedAt == null);
    return {
      move: editable && !running,
      resizeStart: editable || running,
      resizeEnd: editable && !running,
      start: !item?.isStartDisabled,
      stop: running && !item?.isStopDisabled,
      delete: running ? !item?.isDeleteDisabled : !pending && !item?.isDeleteDisabled,
    };
  }

  function normalizedRows(rows) {
    return (rows || []).map(row => ({ id: row.id, name: row.title ?? row.name ?? String(row.id) }));
  }

  function validateNoOverlap(tasks) {
    const ordered = tasks.slice().sort((left, right) => left.start - right.start || left.end - right.end || String(left.instanceId).localeCompare(String(right.instanceId)));
    let latest = null;
    for (const task of ordered) {
      if (latest && task.start < latest.end) {
        throw new RangeError(`Clockoli timeline entries overlap: "${latest.instanceId}" and "${task.instanceId}"`);
      }
      if (!latest || task.end > latest.end) latest = task;
    }
  }

  function createTimeline(host, initialProps = {}) {
    if (typeof global.TaskTimeline !== 'function') throw new Error('TaskTimeline component is unavailable');
    if (initialProps.surface === 'activity') host.classList.add('clockoli-activity-timeline');

    let props = { ...initialProps };
    let destroyed = false;
    let historyScrollPending = false;
    let lastHistoryScrollStart = null;
    const expectedRejections = new Map();
    const savingKeys = new Set();
    const pendingEdits = new Map();
    const editStates = new Map();

    let originalItems = new Map();
    let styleObserver = null;
    let detailsObserver = null;
    let actionClock = null;

    const style = document.createElement('style');
    style.dataset.clockoliTaskTimeline = 'true';
    style.textContent = CLOCKOLI_STYLE;

    function sourceItem(instanceId) {
      return originalItems.get(String(instanceId)) || null;
    }

    function mapItems(items, now) {
      const sources = new Map();
      const mapped = (items || []).map(item => {
        const instanceId = String(item.id);
        sources.set(instanceId, item);
        const start = Number(item.startedAt);
        const running = Boolean(item.isRunning || item.endedAt == null);
        const end = running ? Math.max(start, Number(now) || Date.now()) : Number(item.endedAt);
        return {
          instanceId,
          id: item.url || item.id,
          name: item.title || item.url || 'Untitled task',
          url: item.url || '',
          start,
          end,
          row: item.rowId ?? 0,
          running,
          data: { clockoliItemId: instanceId, permissions: permissionsFor(item) },
        };
      });
      const running = mapped.filter(item => item.running);
      if (running.length > 1) throw new RangeError('Clockoli timeline accepts at most one running entry');
      validateNoOverlap(mapped);
      return { mapped, sources };
    }

    function callbackItem(task) {
      return sourceItem(task?.data?.clockoliItemId ?? task?.instanceId);
    }

    function viewFromComponent() {
      if (timeline.getViewMode() === 'calendar') {
        const start = props.weeklyCalendar ? visibleCalendarWeekStart() : timeline.getCalendarRange().start;
        const end = props.weeklyCalendar ? timeline._addDaysLocal(start, 7) : timeline.getCalendarRange().end;
        return { start, end, focusedAt: start + (end - start) / 2 };
      }
      const start = timeline._visibleStartTime?.() ?? timeline.domainStart;
      const end = timeline._visibleEndTime?.() ?? timeline.domainEnd;
      return { start, end, focusedAt: start + (end - start) / 2 };
    }

    function notifyView() {
      if (destroyed) return;
      const view = viewFromComponent();
      props = { ...props, view };
      if (typeof props.onViewChange === 'function') props.onViewChange(view);
    }

    function canRun(event) {
      const item = callbackItem(event.task || event.after || event.before);
      const permissions = permissionsFor(item);
      let allowed = true;
      if (event.action === 'move') allowed = permissions.move;
      else if (event.action === 'resize-start') allowed = permissions.resizeStart;
      else if (event.action === 'resize-end') allowed = permissions.resizeEnd;
      else if (event.action === 'delete') return permissions.delete;
      if (!allowed) return false;
      if (event.action !== 'move' && event.after && event.before && event.after.end - event.after.start < 60_000) return false;
      if (event.after) {
        const proposed = timeline.tasks.map(task => task._key === String(event.instanceId)
          ? { ...task, start: event.after.start, end: event.after.end }
          : task);
        try { validateNoOverlap(proposed); } catch (_) { return false; }
      }
      return true;
    }

    function restoreExternalRunning() {
      if (destroyed) return;
      const item = [...originalItems.values()].find(candidate => candidate.isRunning || candidate.endedAt == null);
      const task = item ? timeline._findTask(String(item.id)) : null;
      timeline._clearRunningTimer?.();
      for (const candidate of timeline.tasks) candidate.running = Boolean(task && candidate._key === task._key);
      timeline.runningKey = task?._key ?? null;
      timeline.interactionPausedRunning = false;
      if (task) timeline.runningTimer = setInterval(() => timeline._tickRunningTask?.(), 1_000);
      timeline._renderAll?.({ invalidateRulerScales: false });
      styleTasks();
      renderActions();
    }

    function retainExternalState(result, rejectionMessage) {
      const restore = () => setTimeout(() => {
        if (!destroyed) hydrateExternalState();
      }, 0);
      const finish = value => {
        if (value === false && rejectionMessage) {
          expectedRejections.set(rejectionMessage, (expectedRejections.get(rejectionMessage) || 0) + 1);
        }
        restore();
        return value;
      };
      if (result && typeof result.then === 'function') {
        return Promise.resolve(result).then(
          finish,
          error => { restore(); throw error; },
        );
      }
      return finish(result);
    }

    function editHistoryIndex(event) {
      return timeline.undoStack.findLastIndex(entry => entry.action === event.action
        && entry.afterTask?.instanceId === event.instanceId
        && entry.afterTask?.start === event.after.start && entry.afterTask?.end === event.after.end);
    }

    function rejectEdit(state) {
      const { event } = state;
      state.rejected = true;
      const states = editStates.get(String(event.instanceId)) || [];
      if (state.historyEntry) {
        const destination = event.action === 'undo' ? timeline.redoStack : timeline.undoStack;
        const source = event.action === 'undo' ? timeline.undoStack : timeline.redoStack;
        if (destination.at(-1) === state.historyEntry) {
          destination.pop();
          source.push(state.historyEntry);
          timeline._updateHistoryButtons();
        }
      } else {
        const historyIndex = editHistoryIndex(event);
        if (historyIndex !== -1) timeline.undoStack.splice(historyIndex, 1);
        timeline._updateHistoryButtons();
      }
      // A later edit may already have been accepted or may still be saving.
      // Bridge its undo/rollback baseline across this rejected interval.
      const next = states[states.indexOf(state) + 1];
      if (next && next.event.before.start === event.after.start && next.event.before.end === event.after.end) {
        next.rollbackBefore = state.rollbackBefore;
        const nextHistoryIndex = editHistoryIndex(next.event);
        const history = timeline.undoStack[nextHistoryIndex];
        if (history) {
          Object.assign(history.beforeTask, { start: state.rollbackBefore.start, end: state.rollbackBefore.end });
          const prior = history.beforeState.tasks.find(task => task.instanceId === event.instanceId);
          if (prior) Object.assign(prior, { start: state.rollbackBefore.start, end: state.rollbackBefore.end });
        }
      }
      const task = timeline._findTask(event.instanceId);
      if (!states.slice(states.indexOf(state) + 1).every(later => later.rejected)
        || !task || task.start !== event.after.start || task.end !== event.after.end) return;
      task.start = state.rollbackBefore.start;
      task.end = state.rollbackBefore.end;
      timeline.tasks.sort((left, right) => left.start - right.start || left.end - right.end);
      timeline._renderAll();
      styleTasks();
    }

    const now = Number(initialProps.now) || Date.now();
    const initialMapping = mapItems(initialProps.items, now);
    const tasks = initialMapping.mapped;
    originalItems = initialMapping.sources;
    const domainStart = Math.min(Number(initialProps.historyStart) || now - 7 * DAY_MS,
      Number(initialProps.view?.start) || now - DAY_MS, now - 7 * DAY_MS, ...tasks.map(task => task.start));
    const domainEnd = Math.max(now, domainStart + 1_000, ...tasks.map(task => task.end));
    const timeline = new global.TaskTimeline(host, {
      tasks,
      rows: normalizedRows(initialProps.rows),
      domainStart,
      domainEnd,
      visibleDays: Math.max(1 / 24, Math.min(7, ((initialProps.view?.end ?? now) - (initialProps.view?.start ?? now - DAY_MS)) / DAY_MS)),
      minVisibleDays: 1 / 24,
      maxVisibleDays: 7,
      minTaskWidth: MINIMUM_ITEM_WIDTH,
      trailingGutterRatio: 0,
      currentTime: now,
      nominalTaskHeight: 40,
      maxTaskHeightFactor: 1,
      rowHeight: 84,
      rowPaddingBottom: 20,
      locale: global.navigator?.language || 'en-GB',
      viewMode: initialProps.viewMode === 'calendar' ? 'calendar' : 'timeline',
      calendarWeekStartMonday: initialProps.weeklyCalendar === true,
      ...(initialProps.weeklyCalendar === true ? { calendarDayMinWidth: 145 } : {}),
      magneticSnap: true,
      magnetStepsMinutes: [1 / 60],
      magnetScaleThresholdDays: [7],
      canChange: canRun,
      onStart(task, event) {
        const item = callbackItem(task);
        if (!item || !permissionsFor(item).start || typeof props.onStart !== 'function') return false;
        return retainExternalState(props.onStart(item, event), 'start callback rejected operation');
      },
      onStop(task, event) {
        if (event?.source === 'replaced' || event?.source === 'edit') {
          if (event.source === 'edit') queueMicrotask(restoreExternalRunning);
          return true;
        }
        const item = callbackItem(task);
        if (!item || !permissionsFor(item).stop || typeof props.onStop !== 'function') return false;
        return retainExternalState(props.onStop(item, event), 'stop callback rejected operation');
      },
      onDelete(task, event) {
        const item = callbackItem(task);
        if (!item || !permissionsFor(item).delete || typeof props.onDelete !== 'function') return false;
        return retainExternalState(props.onDelete(item, event), 'delete callback rejected delete');
      },
      onChange(task, event) {
        const item = callbackItem(task);
        if (!item || typeof props.onEditCommit !== 'function') return false;
        const kind = event.action === 'resize-start' ? 'resize-left' : event.action === 'resize-end' ? 'resize-right' : 'move';
        const edit = {
          id: String(event.instanceId),
          startedAt: event.after?.start,
          endedAt: event.after?.end,
          kind,
        };
        savingKeys.add(edit.id);
        pendingEdits.set(edit.id, (pendingEdits.get(edit.id) || 0) + 1);
        const states = editStates.get(edit.id) || [];
        const historyEntry = event.action === 'undo' ? timeline.undoStack.at(-1)
          : event.action === 'redo' ? timeline.redoStack.at(-1) : null;
        const state = { event, rollbackBefore: event.before, rejected: false, historyEntry };
        states.push(state);
        editStates.set(edit.id, states);
        styleTasks();
        void Promise.resolve().then(() => props.onEditCommit(edit))
          .then(value => {
            if (value === false) throw new Error('edit callback rejected operation');
          })
          .catch(error => {
            if (!destroyed) rejectEdit(state);
            props.onError?.(error, { action: 'edit', source: 'clockoli-adapter' });
          })
          .finally(() => {
            const remaining = (pendingEdits.get(edit.id) || 1) - 1;
            if (!remaining) {
              pendingEdits.delete(edit.id);
              savingKeys.delete(edit.id);
              editStates.delete(edit.id);
            } else pendingEdits.set(edit.id, remaining);
            if (!destroyed) styleTasks();
          });
        return true;
      },
      onSelect() { queueMicrotask(renderActions); },
      onError(error, info) {
        queueMicrotask(restoreExternalRunning);
        const message = error?.message;
        const expected = expectedRejections.get(message) || 0;
        if (expected > 0) {
          if (expected === 1) expectedRejections.delete(message);
          else expectedRejections.set(message, expected - 1);
          return;
        }
        props.onError?.(error, info);
      },
    });

    timeline.shadow.append(style);

    function hydrateExternalState() {
      const running = timeline.tasks.filter(task => task.running);
      timeline._clearRunningTimer?.();
      timeline.runningKey = running[0]?._key ?? null;
      if (timeline.runningKey !== null) timeline.runningTimer = setInterval(() => timeline._tickRunningTask?.(), 1_000);
      timeline.pendingKeys = new Set([...originalItems.values()].filter(item => item.isPending).map(item => String(item.id)));
      timeline._renderAll?.({ invalidateRulerScales: false });
    }

    function applyView(view) {
      if (!view || !(view.end > view.start)) return;
      if (timeline.getViewMode() === 'calendar') {
        timeline.setCalendarDate(Number(view.focusedAt) || Math.max(view.start, view.end - 1));
        const running = timeline._runningTask?.();
        if (running) timeline._scrollCalendarTaskIntoView?.(running);
        return;
      }
      timeline.setVisibleDays(Math.max(1 / 24, Math.min(7, (view.end - view.start) / DAY_MS)));
      timeline._setScrollLeft?.(timeline.timeToX(view.start));
      timeline._updateTimelineMeta?.();
      timeline._updateRowLabelPositions?.();
    }

    function styleTasks() {
      if (destroyed) return;
      for (const element of timeline.shadow.querySelectorAll('.task[data-task-key], .calendar-task[data-task-key]')) {
        const saving = savingKeys.has(element.dataset.taskKey) || Boolean(sourceItem(element.dataset.taskKey)?.isPending);
        element.classList.toggle('clockoli-saving', saving);
        if (saving) element.setAttribute('aria-busy', 'true');
        else element.removeAttribute('aria-busy');
        const indicator = element.querySelector('.clockoli-entry-saving');
        if (saving && !indicator) {
          const overlay = document.createElement('span');
          overlay.className = 'clockoli-entry-saving';
          const spinner = document.createElement('span');
          spinner.className = 'clockoli-entry-saving-spinner';
          spinner.setAttribute('aria-hidden', 'true');
          const label = document.createElement('span');
          label.className = 'clockoli-entry-saving-label';
          label.textContent = 'Saving…';
          overlay.append(spinner, label);
          element.append(overlay);
        } else if (!saving) indicator?.remove();
        const label = element.getAttribute('aria-label') || '';
        if (saving && !label.endsWith(' · Saving…')) element.setAttribute('aria-label', `${label} · Saving…`);
        else if (!saving && label.endsWith(' · Saving…')) element.setAttribute('aria-label', label.slice(0, -' · Saving…'.length));
        const item = sourceItem(element.dataset.taskKey);
        element.style.setProperty('--clockoli-task-color', resolveColor(item || { id: element.dataset.taskKey }));
        if (element.classList.contains('task')) {
          const viewportRect = timeline.viewport.getBoundingClientRect();
          const viewport = { left: viewportRect.left, right: viewportRect.left + timeline.viewport.clientWidth };
          const task = element.getBoundingClientRect();
          const displayWidth = timeline._findTask?.(element.dataset.taskKey)?.displayWidth ?? task.width;
          const minimum = displayWidth <= MINIMUM_ITEM_WIDTH + 1;
          element.classList.toggle('clockoli-minimum-width', minimum);
          element.classList.toggle('clockoli-compact-saving', saving && task.width < 110);
          if (minimum) {
            const start = element.querySelector('.edit-clock.start');
            const end = element.querySelector('.edit-clock.end');
            const startWidth = start?.scrollWidth || 96;
            const endWidth = end?.scrollWidth || 96;
            element.style.setProperty('--clockoli-start-edge-shift', `${Math.max(0, viewport.left - task.left)}px`);
            element.style.setProperty('--clockoli-end-edge-shift', `${Math.max(0, task.right - viewport.right)}px`);
            element.classList.toggle('clockoli-start-edge', task.left - viewport.left < startWidth + 4);
            element.classList.toggle('clockoli-end-edge', viewport.right - task.right < endWidth + 4);
          } else {
            element.classList.remove('clockoli-start-edge', 'clockoli-end-edge');
            element.style.removeProperty('--clockoli-start-edge-shift');
            element.style.removeProperty('--clockoli-end-edge-shift');
          }
        }
        if (element.classList.contains('calendar-task') && item?.faviconUrl && !element.querySelector('.clockoli-calendar-favicon')) {
          const image = document.createElement('img');
          image.className = 'clockoli-calendar-favicon'; image.alt = ''; image.src = item.faviconUrl;
          image.addEventListener('error', () => { image.hidden = true; }, { once: true });
          element.querySelector('.calendar-task-name')?.prepend(image);
        }
        if (element.classList.contains('calendar-task')) {
          const text = String(item?.description || '').trim();
          const hasRoom = element.clientWidth >= 90 && element.clientHeight >= 48;
          let description = element.querySelector('.clockoli-calendar-description');
          if (!text || !hasRoom) description?.remove();
          else {
            if (!description) { description = document.createElement('div'); description.className = 'clockoli-calendar-description'; element.append(description); }
            if (description.textContent !== text) description.textContent = text;
          }
        }
      }
    }

    function renderActions() {
      if (destroyed || !timeline.details) return;
      const key = timeline.detailsKey;
      const item = sourceItem(key);
      const existing = timeline.details.querySelector('.clockoli-timeline-actions');
      if (!item) { existing?.remove(); return; }
      const permissions = permissionsFor(item);
      const mode = item.isRunning || item.endedAt == null ? 'running' : 'completed';
      const savedDescription = item.savedDescription ?? item.description ?? '';
      if (existing?.dataset.itemId === String(key) && existing.dataset.mode === mode) {
        const description = existing.querySelector('.clockoli-timeline-description');
        if (description && timeline.shadow.activeElement !== description) {
          description.value = item.description || '';
          description.dataset.savedDescription = savedDescription;
          const save = existing.querySelector('.clockoli-description-save');
          if (save) save.hidden = description.value.trim() === String(savedDescription).trim();
        }
        const deletion = existing.querySelector('.danger');
        const primary = existing.querySelector('.primary');
        if (deletion) deletion.disabled = !permissions.delete;
        if (primary) primary.disabled = mode === 'running' ? !permissions.stop : !permissions.start;
        updateActionClock();
        return;
      }
      existing?.remove();
      const actions = document.createElement('div');
      actions.className = 'clockoli-timeline-actions';
      actions.dataset.itemId = String(key);
      actions.dataset.mode = mode;
      if (typeof props.onDescriptionCommit === 'function') {
        const field = document.createElement('div');
        field.className = 'clockoli-description-field';
        const description = document.createElement('input');
        description.type = 'text'; description.maxLength = 2000; description.className = 'clockoli-timeline-description';
        description.placeholder = 'Add description'; description.value = item.description || '';
        description.dataset.savedDescription = savedDescription;
        description.setAttribute('aria-label', 'Task description');
        for (const type of ['keydown', 'keypress', 'keyup']) description.addEventListener(type, event => event.stopPropagation());
        const save = document.createElement('button');
        save.type = 'button'; save.className = 'clockoli-description-save'; save.textContent = '✓';
        save.hidden = description.value.trim() === String(savedDescription).trim();
        save.title = 'Save description'; save.setAttribute('aria-label', 'Save description');
        let saving = null;
        const updateDirty = () => { save.hidden = description.value.trim() === String(description.dataset.savedDescription || '').trim(); };
        const commit = async () => {
          if (description.value.trim() === String(description.dataset.savedDescription || '').trim()) return;
          if (saving) {
            try { await saving; } catch {}
            return commit();
          }
          const requested = description.value;
          save.disabled = true;
          saving = Promise.resolve().then(() => props.onDescriptionCommit(sourceItem(key), requested));
          try { await saving; description.dataset.savedDescription = requested; save.hidden = true; }
          catch (error) { props.onError?.(error, { action: 'description', source: 'clockoli-details' }); }
          finally { saving = null; save.disabled = false; updateDirty(); }
        };
        description.addEventListener('input', () => { props.onDescriptionInput?.(sourceItem(key), description.value); updateDirty(); });
        description.addEventListener('blur', commit);
        save.addEventListener('pointerdown', event => event.preventDefault());
        save.addEventListener('click', commit);
        field.append(description, save); actions.append(field);
      }
      if (typeof props.onDelete === 'function') {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'clockoli-timeline-action danger'; button.textContent = 'Delete';
        button.disabled = !permissions.delete;
        button.addEventListener('click', () => runAction(button, 'delete', () => props.onDelete(sourceItem(key))));
        actions.append(button);
      }
      if ((item.isRunning || item.endedAt == null) && typeof props.onStop === 'function') {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'clockoli-timeline-action primary';
        button.dataset.startedAt = String(item.startedAt);
        button.textContent = `Stop ${formatClockDuration((Number(props.now) || Date.now()) - Number(item.startedAt))}`;
        button.disabled = !permissions.stop;
        button.addEventListener('click', () => runAction(button, 'stop', () => props.onStop(sourceItem(key))));
        actions.append(button);
      } else if (typeof props.onStart === 'function') {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'clockoli-timeline-action primary'; button.textContent = 'Start tracking';
        button.disabled = !permissions.start;
        button.addEventListener('click', () => runAction(button, 'start', () => props.onStart(sourceItem(key))));
        actions.append(button);
      }
      if (actions.childElementCount) timeline.details.append(actions);
    }

    async function runAction(button, action, callback) {
      if (button.disabled) return;
      button.disabled = true;
      try {
        await callback();
      } catch (error) {
        props.onError?.(error, { action, source: 'clockoli-details' });
      } finally {
        if (!destroyed) renderActions();
      }
    }

    function formatClockDuration(milliseconds) {
      const total = Math.max(0, Math.floor(milliseconds / 1_000));
      const hours = Math.floor(total / 3_600);
      const minutes = Math.floor((total % 3_600) / 60);
      const seconds = total % 60;
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    function updateActionClock() {
      const button = timeline.details?.querySelector('.clockoli-timeline-action[data-started-at]');
      if (!button) return;
      button.textContent = `Stop ${formatClockDuration((Number(props.now) || Date.now()) - Number(button.dataset.startedAt))}`;
    }

    function permissionEvent(event) {
      const path = event.composedPath();
      const interactive = path.some(node => node instanceof Element && node.matches?.('input, textarea, select, button, a, [contenteditable]:not([contenteditable="false"])'));
      if (interactive) return;
      const target = path.find(node => node instanceof Element && node.matches?.('[data-task-key]'));
      if ((event.type === 'pointerdown' || event.type === 'dblclick') && !target) return;
      const key = target?.dataset?.taskKey ?? timeline.selectedKey;
      const item = sourceItem(key);
      if (!item) return;
      const permissions = permissionsFor(item);
      let allowed = true;
      if (event.type === 'dblclick') allowed = item.isRunning ? permissions.stop : permissions.start;
      else if (event.type === 'pointerdown') {
        const handle = event.composedPath().find(node => node instanceof Element && (node.classList?.contains('resize-handle') || node.classList?.contains('calendar-resize-handle')));
        if (handle?.classList?.contains('left') || handle?.dataset?.resizeMode === 'resize-left') allowed = permissions.resizeStart;
        else if (handle?.classList?.contains('right') || handle?.dataset?.resizeMode === 'resize-right') allowed = permissions.resizeEnd;
        else allowed = permissions.move;
      } else if (event.type === 'keydown') {
        if (event.key === 'Delete' || event.key === 'Backspace') allowed = permissions.delete;
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          allowed = event.altKey ? permissions.resizeStart : (event.ctrlKey || event.metaKey) ? permissions.resizeEnd : permissions.move;
        }
      }
      if (!allowed) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }

    timeline.shadow.addEventListener('pointerdown', permissionEvent, true);
    timeline.shadow.addEventListener('dblclick', permissionEvent, true);
    timeline.shadow.addEventListener('keydown', permissionEvent, true);
    function requestEarlierOnScroll() {
      if (destroyed || timeline.getViewMode() !== 'timeline' || !Number.isFinite(Number(props.historyStart))) return;
      const left = timeline._scrollLeftNow();
      if (left > 36) { lastHistoryScrollStart = null; return; }
      const start = timeline.domainStart - 7 * DAY_MS;
      if (historyScrollPending || lastHistoryScrollStart === start) return;
      historyScrollPending = true; lastHistoryScrollStart = start;
      Promise.resolve().then(() => props.onRangeRequest?.({ start, end: timeline.domainStart }))
        .catch(error => props.onError?.(error, { action: 'load-range', source: 'clockoli-adapter' }))
        .finally(() => { historyScrollPending = false; });
    }
    let lastTimelineScrollLeft = timeline._scrollLeftNow();
    timeline.viewport.addEventListener('scroll', () => {
      const left = timeline._scrollLeftNow();
      if (left < lastTimelineScrollLeft) requestEarlierOnScroll();
      lastTimelineScrollLeft = left;
      styleTasks(); notifyView();
    }, { passive: true });
    timeline.viewport.addEventListener('wheel', event => {
      if (!(event.ctrlKey || event.metaKey) && (Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY) < 0) requestEarlierOnScroll();
    }, { passive: true });
    let calendarScrollNavigation = null;
    let lastCalendarLeft = timeline.calendarViewport.scrollLeft;
    function visibleCalendarWeekStart() {
      return timeline._visibleCalendarWeekStart(timeline._calendarMetrics || timeline._calendarMetricsForRender());
    }
    function positionCalendarTimeRail() {
      timeline.calendarCanvas.style.setProperty('--clockoli-calendar-scroll-left', `${timeline.calendarViewport.scrollLeft}px`);
      if (props.weeklyCalendar && timeline.getViewMode() === 'calendar') {
        timeline.calendarTitle.textContent = timeline._formatCalendarRangeTitle(visibleCalendarWeekStart(), 7);
      }
    }
    function focusCalendarToday() {
      const viewport = timeline.calendarViewport;
      const today = timeline._floorDay(Date.now());
      const dayIndex = Math.round((today - timeline.calendarStartDay) / DAY_MS);
      const dayWidth = timeline._calendarMetricsForRender().dayWidth;
      viewport.scrollLeft = Math.max(0, Math.min(viewport.scrollWidth - viewport.clientWidth,
        timeline.options.calendarTimeAxisWidth + (dayIndex + 0.5) * dayWidth - viewport.clientWidth / 2));
      lastCalendarLeft = viewport.scrollLeft;
      positionCalendarTimeRail();
    }
    positionCalendarTimeRail();
    function requestEarlierCalendar(delta = 0) {
      if (destroyed || !props.weeklyCalendar || timeline.getViewMode() !== 'calendar' || !props.onRangeRequest) return;
      if (calendarScrollNavigation) {
        calendarScrollNavigation.delta += delta;
        return;
      }
      const viewport = timeline.calendarViewport;
      const width = timeline._calendarMetricsForRender().dayWidth;
      const start = timeline._addDaysLocal(timeline.calendarStartDay, -7);
      const navigation = { start, left: viewport.scrollLeft, width, top: viewport.scrollTop, delta };
      calendarScrollNavigation = navigation;
      Promise.resolve().then(() => props.onRangeRequest({ start, end: timeline.calendarStartDay })).then(() => {
        if (destroyed || timeline.getViewMode() !== 'calendar' || timeline.calendarStartDay !== timeline._addDaysLocal(start, 7)) return;
        timeline.extendCalendarEarlier();
        const newWidth = timeline._calendarMetricsForRender().dayWidth;
        viewport.scrollLeft = Math.max(0, navigation.left * newWidth / navigation.width + newWidth * 7 + navigation.delta);
        viewport.scrollTop = navigation.top;
        lastCalendarLeft = viewport.scrollLeft;
        positionCalendarTimeRail();
        notifyView();
      }).catch(error => props.onError?.(error, { action: 'load-range', source: 'clockoli-adapter' }))
        .finally(() => { if (calendarScrollNavigation === navigation) calendarScrollNavigation = null; });
    }
    for (const [button, direction] of [[timeline.calendarPrevButton, -1], [timeline.calendarNextButton, 1]]) {
      button.addEventListener('click', event => {
        if (!props.weeklyCalendar) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const viewport = timeline.calendarViewport;
        if (direction < 0 && viewport.scrollLeft <= 1) requestEarlierCalendar(-viewport.clientWidth);
        else viewport.scrollBy({ left: direction * viewport.clientWidth, behavior: 'smooth' });
      }, true);
    }
    timeline.calendarTodayButton.addEventListener('click', event => {
      if (!props.weeklyCalendar) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      focusCalendarToday();
    }, true);
    timeline.calendarViewport.addEventListener('scroll', () => {
      const viewport = timeline.calendarViewport;
      const left = viewport.scrollLeft;
      if (calendarScrollNavigation && left < lastCalendarLeft) calendarScrollNavigation.left = left;
      if (left < lastCalendarLeft && left <= timeline._calendarMetricsForRender().dayWidth * 1.5) requestEarlierCalendar();
      lastCalendarLeft = left;
      positionCalendarTimeRail();
    }, { passive: true });
    timeline.calendarViewport.addEventListener('wheel', event => {
      if (!props.weeklyCalendar || timeline.getViewMode() !== 'calendar') return;
      if (event.ctrlKey || event.metaKey || event.deltaX >= 0 || Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
      if (timeline.calendarViewport.scrollLeft > 0) return;
      event.preventDefault();
      requestEarlierCalendar(event.deltaX);
    }, { passive: false });
    host.addEventListener('timelinezoom', notifyView);
    host.addEventListener('timeline:calendarnavigate', event => {
      if (destroyed) return;
      const { start, end } = event.detail;
      const scrollNavigation = calendarScrollNavigation;
      Promise.resolve(props.onRangeRequest?.({ start, end })).then(() => {
        if (destroyed) return;
        timeline.setCalendarDate(start);
        if (scrollNavigation) {
          const viewport = timeline.calendarViewport;
          viewport.scrollTop = scrollNavigation.top;
          viewport.scrollLeft = scrollNavigation.direction < 0 ? viewport.scrollWidth - viewport.clientWidth : 0;
          lastCalendarLeft = viewport.scrollLeft;
          positionCalendarTimeRail();
        }
        notifyView();
      }).catch(error => props.onError?.(error, { action: 'load-range', source: 'clockoli-adapter' }))
        .finally(() => { if (calendarScrollNavigation === scrollNavigation) calendarScrollNavigation = null; });
    });
    host.addEventListener('timeline:viewmodechange', () => props.onViewModeChange?.(timeline.getViewMode()));
    styleObserver = new MutationObserver(styleTasks);
    styleObserver.observe(timeline.shadow, { childList: true, subtree: true });
    detailsObserver = new MutationObserver(renderActions);
    detailsObserver.observe(timeline.detailsInfo, { childList: true, subtree: true });
    actionClock = setInterval(updateActionClock, 1_000);
    hydrateExternalState();
    applyView(initialProps.view);
    styleTasks();

    function reconcile(nextProps, { applyExternalView = false } = {}) {
      const previousSelection = timeline.selectedKey;
      const previousFocus = timeline.focusedKey;
      const previousMode = timeline.getViewMode();
      const previousScroll = timeline._scrollLeftNow?.() ?? 0;
      const previousVisibleCenter = previousMode === 'timeline'
        ? timeline.xToTime(previousScroll + timeline._viewportWidthNow() / 2) : null;
      const previousDomainStart = timeline.domainStart;
      const previousMaxScroll = Math.max(0, timeline.totalWidth - timeline._viewportWidthNow());
      const wasRightPinned = previousMode === 'timeline' && previousMaxScroll - previousScroll <= 1;
      const mapping = mapItems(nextProps.items, nextProps.now);
      const mapped = mapping.mapped;
      const nextDomainStart = Math.min(Number(nextProps.historyStart) || Number(nextProps.now) - 7 * DAY_MS,
        Number(nextProps.view?.start) || Number(nextProps.now) - DAY_MS, Number(nextProps.now) - 7 * DAY_MS, ...mapped.map(task => task.start));
      const nextDomainEnd = Math.max(Number(nextProps.now), nextDomainStart + 1_000, ...mapped.map(task => task.end));
      timeline.currentTime = Number(nextProps.now);
      timeline.setRows(normalizedRows(nextProps.rows), { render: false });
      timeline.setTasks(mapped, { domainStart: nextDomainStart, domainEnd: nextDomainEnd, preserveScroll: true, preserveHistory: true });
      originalItems = mapping.sources;
      timeline.selectedKey = previousSelection != null && timeline._findTask(previousSelection) ? previousSelection : null;
      timeline.focusedKey = previousFocus != null && timeline._findTask(previousFocus) ? previousFocus : null;
      timeline.setViewMode(previousMode, { emit: false });
      hydrateExternalState();
      if (applyExternalView && nextProps.view) applyView(nextProps.view);
      else if (wasRightPinned) timeline.scrollToEnd();
      else if (previousMode === 'timeline' && nextDomainStart < previousDomainStart) {
        timeline._setScrollLeft(timeline.timeToX(previousVisibleCenter) - timeline._viewportWidthNow() / 2);
      }
      styleTasks();
    }

    return {
      update(next = {}) {
        if (destroyed) return;
        const onlyNow = Object.keys(next).every(key => key === 'now');
        const candidateProps = { ...props, ...next };
        try {
          if (onlyNow) {
            timeline.currentTime = Number(candidateProps.now) || Date.now();
            if (timeline.runningKey !== null) {
              const nextNow = Number(candidateProps.now) || Date.now();
              validateNoOverlap(timeline.tasks.map(task => task._key === timeline.runningKey
                ? { ...task, end: Math.max(task.start, nextNow) }
                : task));
              timeline._updateRunningTaskIncremental?.(nextNow);
            }
            else timeline._renderTimelineNowLine?.();
            props = candidateProps;
            updateActionClock();
            return true;
          }
          reconcile(candidateProps, { applyExternalView: Object.hasOwn(next, 'view') });
          props = candidateProps;
          updateActionClock();
          return true;
        } catch (error) {
          queueMicrotask(() => {
            if (!destroyed) props.onError?.(error, { action: 'update', source: 'clockoli-adapter' });
          });
          return false;
        }
      },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        styleObserver?.disconnect();
        detailsObserver?.disconnect();
        clearInterval(actionClock);
        timeline.destroy();
      },
      getView: viewFromComponent,
      scrollToEnd() {
        if (timeline.getViewMode() === 'calendar') {
          const running = timeline._runningTask?.();
          if (!props.weeklyCalendar) timeline.setCalendarDate(running?.start ?? timeline.domainEnd);
          else focusCalendarToday();
          if (running) timeline._scrollCalendarTaskIntoView?.(running);
        } else timeline.scrollToEnd();
        notifyView();
      },
      setViewMode(mode) {
        const previous = timeline.getViewMode();
        timeline.setViewMode(mode);
        if (mode === 'calendar' && previous !== 'calendar' && props.weeklyCalendar) {
          focusCalendarToday();
        }
        styleTasks();
      },
      getViewMode() { return timeline.getViewMode(); },
      setCalendarDate(value) { timeline.setCalendarDate(value); },
      shiftCalendar(direction) { if (props.weeklyCalendar) scrollCalendarWeek(direction < 0 ? -1 : 1); else timeline.shiftCalendar(direction); },
      getCalendarRange() { return timeline.getCalendarRange(); },
      __timeline: timeline,
    };
  }

  global.ClockoliTaskTimeline = Object.freeze({
    COLOR_PALETTE,
    MINIMUM_ITEM_WIDTH,
    createColorResolver,
    createTimeline,
  });
})(globalThis);
