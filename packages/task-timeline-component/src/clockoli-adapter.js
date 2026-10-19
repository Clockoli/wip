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
      --tt-inverse-bg: var(--fgColor-default, var(--ck-fg, #172033));
      --tt-inverse-fg: var(--bgColor-default, var(--ck-bg, #fff));
      color-scheme: light dark;
      font: var(--text-body-shorthand-medium, 400 14px/1.5 "Mona Sans VF", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
    }
    .shell { border: 0; border-radius: 0; box-shadow: none; background: var(--tt-panel); }
    .meta { min-height: 42px; padding-inline: 12px; background: var(--tt-panel); color: var(--tt-muted); }
    .viewport, .content, .ruler-row, .task-row, .ruler-cell:not(.empty),
    .calendar-view, .calendar-viewport, .calendar-canvas,
    .calendar-time-label, .calendar-row-name, .calendar-nav button, .history-button,
    .details { background: var(--tt-panel); }
    .viewport { border-block: 1px solid var(--tt-border); }
    .day-row, .calendar-toolbar, .calendar-sticky-header, .calendar-corner,
    .calendar-day-header { background: var(--bgColor-muted, var(--ck-bg-muted, #f6f8fa)); color: var(--tt-text); }
    .day-band, .ruler-cell { color: var(--tt-text); }
    .ruler-cell.empty, .calendar-row-name { color: var(--tt-muted); }
    .calendar-day-header.today {
      background: var(--bgColor-accent-muted, var(--ck-bg-accent, #eef3ff));
      color: var(--fgColor-accent, var(--ck-accent, #2449a8));
    }
    .calendar-sticky-header { box-shadow: var(--shadow-floating-small, var(--ck-shadow, 0 2px 7px rgba(16,24,40,.06))); }
    .calendar-row-line { background: var(--tt-grid); }
    .calendar-row-name { border-right-color: var(--tt-grid); }
    .edit-guide { background: color-mix(in srgb, var(--tt-inverse-bg) 68%, transparent); }
    .edit-guide.active { background: var(--tt-inverse-bg); }
    .edit-guide-label, .edit-clock, .calendar-edit-clock { background: var(--tt-inverse-bg); color: var(--tt-inverse-fg); }
    .edit-clock, .calendar-edit-clock { box-shadow: var(--shadow-floating-small, var(--ck-shadow, 0 2px 7px rgba(23,32,51,.28))); }
    .edit-guide.magnet, .calendar-magnet-guide { background: var(--fgColor-accent, var(--ck-accent, #315ecf)); }
    .edit-guide.magnet { box-shadow: 0 0 0 1px var(--bgColor-accent-muted, var(--ck-bg-accent, rgba(49,94,207,.14))); }
    .calendar-magnet-guide { box-shadow: 0 0 0 1px var(--bgColor-accent-muted, var(--ck-bg-accent, rgba(49,94,207,.12))); }
    .edit-guide.magnet.snapped, .calendar-magnet-guide.snapped { background: var(--fgColor-accent, var(--ck-accent, #1f49b6)); }
    .calendar-now-line, .calendar-now-dot, .timeline-now-line, .timeline-now-line::before { background: var(--fgColor-danger, var(--ck-danger, #d92d20)); }
    .details a { color: var(--fgColor-accent, var(--ck-accent, #315ecf)); }
    .details-pointer { background: var(--fgColor-accent, var(--ck-accent, #0969da)); }
    .details-pointer::after { border-right-color: var(--fgColor-accent, var(--ck-accent, #0969da)); border-bottom-color: var(--fgColor-accent, var(--ck-accent, #0969da)); }
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
    .viewport.zooming .task { box-shadow: none; }
    @keyframes running-task-pulse {
      0%, 100% {
        filter: brightness(1);
        box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--tt-panel) 62%, transparent), 0 6px 14px color-mix(in srgb, var(--fgColor-accent, var(--ck-accent, #193d96)) 24%, transparent);
      }
      50% {
        filter: brightness(1.13);
        box-shadow: inset 0 0 0 3px color-mix(in srgb, var(--tt-panel) 82%, transparent), 0 8px 22px color-mix(in srgb, var(--fgColor-accent, var(--ck-accent, #193d96)) 42%, transparent);
      }
    }
    .task:hover, .task.hovered:not(.selected), .task.editing { z-index: 10; }
    .task.selected { outline: 2px solid var(--focus-outlineColor, var(--ck-focus, #0969da)); outline-offset: 1px; }
    .task.focused:not(.selected) { outline: 2px solid var(--focus-outlineColor, var(--ck-focus, #0969da)); outline-offset: 1px; }
    .task.pending, .calendar-task.pending { opacity: 1; }
    .task.pending::after { display: none; }
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
    .calendar-resize-handle::after {
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
    .row-label { color: var(--tt-muted); background: color-mix(in srgb, var(--tt-panel) 88%, transparent); border-color: var(--tt-grid); }
    .calendar-connector-dot { background: var(--tt-text); box-shadow: 0 0 0 1.5px var(--tt-panel), 0 1px 3px color-mix(in srgb, var(--tt-text) 26%, transparent); }
    .calendar-task {
      border: 1px solid color-mix(in srgb, var(--clockoli-task-color, #64748b) 44%, transparent) !important;
      border-left: 3px solid var(--clockoli-task-color, #64748b) !important;
      border-radius: 7px !important;
      background: color-mix(in srgb, var(--clockoli-task-color, #64748b) 34%, var(--tt-panel)) !important;
      color: var(--tt-text) !important;
      box-shadow: none !important;
    }
    .calendar-task.selected, .calendar-task.focused:not(.selected) { outline-color: var(--focus-outlineColor, var(--ck-focus, #0969da)); }
    .clockoli-calendar-favicon { width: 16px; height: 16px; margin: 0 5px 2px 0; border-radius: 3px; object-fit: contain; vertical-align: middle; }
    .clockoli-calendar-monogram { display: inline-grid; place-items: center; background: var(--tt-panel); color: var(--tt-text); font-size: 12px; font-weight: 600; line-height: 1; }
    .clockoli-calendar-description { margin-top:2px; overflow:hidden; color:var(--tt-muted); font-size:9px; line-height:12px; text-overflow:ellipsis; white-space:nowrap; }
    .history-controls { display: none; }
    .clockoli-timeline-actions { margin-left: auto; display: flex; flex: 1 1 340px; min-width: 0; align-items: center; gap: 8px; }
    .clockoli-description-field { position: relative; flex: 1 1 0; min-width: 0; }
    .clockoli-timeline-description { box-sizing: border-box; width: 100%; min-width: 0; margin: 0; padding: 6px 34px 6px 8px; border: 1px solid var(--control-borderColor-rest, var(--tt-border)); border-radius: 6px; background: var(--control-bgColor-rest, var(--tt-panel)); color: var(--control-fgColor-rest, var(--tt-text)); font: inherit; }
    .clockoli-description-save { position: absolute; top: 50%; right: 4px; display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; padding: 0; transform: translateY(-50%); border: 0; border-radius: 5px; background: transparent; color: #1f883d; font: 800 18px/1 sans-serif; cursor: pointer; }
    .clockoli-description-save:hover:not(:disabled) { background: color-mix(in srgb, #1f883d 12%, transparent); }
    .clockoli-description-save[hidden] { display: none; }
    .clockoli-timeline-action {
      flex: 0 0 auto; white-space: nowrap;
      min-height: 30px; padding: 5px 10px; border: 1px solid var(--button-default-borderColor-rest, var(--tt-border));
      border-radius: 6px; background: var(--button-default-bgColor-rest, var(--tt-panel));
      color: var(--button-default-fgColor-rest, var(--tt-text)); font: inherit; font-weight: 600; cursor: pointer;
    }
    .clockoli-timeline-action:hover:not(:disabled):not(.primary) { background: var(--button-default-bgColor-hover, var(--tt-empty)); }
    .clockoli-timeline-action.primary { border-color: var(--button-primary-borderColor-rest, #1f232826); background: var(--button-primary-bgColor-rest, #1f883d); color: var(--button-primary-fgColor-rest, #fff); }
    .clockoli-timeline-action.danger { color: var(--button-danger-fgColor-rest, #d1242f); }
    .clockoli-timeline-action:disabled { opacity: .5; cursor: default; }
  `;

  function permissionsFor(item) {
    const editable = item?.isEditable !== false;
    const running = Boolean(item?.isRunning || item?.endedAt == null);
    return {
      move: editable && !running,
      resizeStart: editable || running,
      resizeEnd: editable && !running,
      start: !item?.isStartDisabled,
      stop: (running || item?.isCurrentTask) && !item?.isStopDisabled,
      delete: !item?.isDeleteDisabled,
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

    let props = { ...initialProps };
    let destroyed = false;
    const expectedRejections = new Map();
    const savingKeys = new Set();
    const pendingEdits = new Map();
    const editStates = new Map();

    let originalItems = new Map();
    let styleObserver = null;
    let detailsObserver = null;
    let suppressViewportScroll = true;
    let deferredUpdate = null;
    let deferredFlushTimer = null;
    let timelineApi = null;

    const style = document.createElement('style');
    style.dataset.clockoliTaskTimeline = 'true';
    style.textContent = CLOCKOLI_STYLE + (initialProps.weeklyCalendar
      ? '\n.calendar-toolbar { display:none } .domain-start,.domain-end { visibility:hidden } .meta { min-height:0; padding-block:0; border-bottom:0 }' : '');

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
    const domainStart = Math.min(Number(initialProps.view?.start) || now - DAY_MS, Number(initialProps.domainStart ?? now - 7 * DAY_MS), ...tasks.map(task => task.start));
    const domainEnd = Math.max(now, Number(initialProps.view?.end) || now, domainStart + 1_000, ...tasks.map(task => task.end));
    const timeline = new global.TaskTimeline(host, {
      tasks,
      rows: normalizedRows(initialProps.rows),
      domainStart,
      domainEnd,
      totalRange: initialProps.totalRange ?? initialProps.view,
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
      onCalendarRangeChange: range => props.onCalendarNavigate?.(range),
      ...(initialProps.weeklyCalendar === true ? { calendarDayMinWidth: 96 } : {}),
      magneticSnap: true,
      magnetStepsMinutes: [5],
      calendarMagnetStepMinutes: 1,
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
            if (!destroyed) {
              styleTasks();
              scheduleDeferredFlush();
            }
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
        const item = sourceItem(element.dataset.taskKey);
        element.style.setProperty('--clockoli-task-color', resolveColor(item || { id: element.dataset.taskKey }));
        if (element.classList.contains('task')) {
          const viewportRect = timeline.viewport.getBoundingClientRect();
          const viewport = { left: viewportRect.left, right: viewportRect.left + timeline.viewport.clientWidth };
          const task = element.getBoundingClientRect();
          const displayWidth = timeline._findTask?.(element.dataset.taskKey)?.displayWidth ?? task.width;
          const minimum = displayWidth <= MINIMUM_ITEM_WIDTH + 1;
          element.classList.toggle('clockoli-minimum-width', minimum);
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
        if (element.classList.contains('calendar-task') && (item?.faviconUrl || item?.faviconUrl === null) && !element.querySelector('.clockoli-calendar-favicon')) {
          const icon = document.createElement(item.faviconUrl === null ? 'span' : 'img');
          icon.className = 'clockoli-calendar-favicon';
          if (item.faviconUrl === null) {
            icon.classList.add('clockoli-calendar-monogram');
            icon.textContent = new URL(item.url).hostname.replace(/^www\./, '').charAt(0).toUpperCase();
            icon.setAttribute('aria-hidden', 'true');
          } else {
            icon.alt = ''; icon.src = item.faviconUrl;
            icon.addEventListener('error', () => { icon.hidden = true; }, { once: true });
          }
          element.querySelector('.calendar-task-name')?.prepend(icon);
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
      const mode = item.isCurrentTask ? 'current' : item.isRunning || item.endedAt == null ? 'running' : 'completed';
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
        if (primary) primary.disabled = mode === 'completed' ? !permissions.start : !permissions.stop;
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
      if ((item.isRunning || item.endedAt == null || item.isCurrentTask) && typeof props.onStop === 'function') {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'clockoli-timeline-action primary';
        button.textContent = 'Stop and save';
        button.disabled = !permissions.stop;
        button.addEventListener('click', () => runAction(button, 'stop', () => props.onStop(sourceItem(key))));
        actions.append(button);
      } else if (typeof props.onStart === 'function') {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'clockoli-timeline-action primary'; button.textContent = 'Track time';
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

    function permissionEvent(event) {
      const path = event.composedPath();
      const interactive = path.some(node => node instanceof Element && node.matches?.('input, textarea, select, button, a, [contenteditable]:not([contenteditable="false"])'));
      if (interactive) return;
      const target = path.find(node => node instanceof Element && node.matches?.('[data-task-key]'));
      if (event.type === 'pointerdown' && !target) return;
      const key = target?.dataset?.taskKey ?? timeline.selectedKey;
      const item = sourceItem(key);
      if (!item) return;
      const permissions = permissionsFor(item);
      let allowed = true;
      if (event.type === 'pointerdown') {
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
    timeline.shadow.addEventListener('keydown', permissionEvent, true);
    timeline.viewport.addEventListener('scroll', () => {
      styleTasks();
      if (!suppressViewportScroll) notifyView();
    }, { passive: true });
    if (props.weeklyCalendar) {
      const viewport = timeline.calendarViewport;
      const positionTimeRail = () => timeline.calendarCanvas.style.setProperty('--clockoli-calendar-scroll-left', `${viewport.scrollLeft}px`);
      viewport.addEventListener('scroll', positionTimeRail, { passive: true });
      positionTimeRail();
    }
    host.addEventListener('timelinezoom', notifyView);
    host.addEventListener('timeline:viewmodechange', () => props.onViewModeChange?.(timeline.getViewMode()));
    styleObserver = new MutationObserver(styleTasks);
    styleObserver.observe(timeline.shadow, { childList: true, subtree: true });
    detailsObserver = new MutationObserver(renderActions);
    detailsObserver.observe(timeline.detailsInfo, { childList: true, subtree: true });
    hydrateExternalState();
    applyView(initialProps.view);
    styleTasks();
    requestAnimationFrame(() => { suppressViewportScroll = false; });

    function hasActiveInteraction() {
      return Boolean(timeline.editState || timeline.calendarEditState || timeline.dragState || pendingEdits.size);
    }

    function scheduleDeferredFlush() {
      if (destroyed || !deferredUpdate || deferredFlushTimer !== null) return;
      // The component processes pointerup before us; commit callbacks then
      // start the durable local save in a microtask. Flush only after those
      // callbacks have settled, not while a new drag is under way.
      deferredFlushTimer = setTimeout(() => {
        deferredFlushTimer = null;
        if (!destroyed && !hasActiveInteraction() && deferredUpdate) {
          const queued = deferredUpdate;
          deferredUpdate = null;
          timelineApi?.update(queued);
        }
      }, 0);
    }

    const onGestureEnd = () => scheduleDeferredFlush();
    global.addEventListener('pointerup', onGestureEnd);
    global.addEventListener('pointercancel', onGestureEnd);

    function reconcile(nextProps, { applyExternalView = false } = {}) {
      suppressViewportScroll = true;
      const previousSelection = timeline.selectedKey;
      const previousFocus = timeline.focusedKey;
      const previousMode = timeline.getViewMode();
      const previousScroll = timeline._scrollLeftNow?.() ?? 0;
      const previousWidth = timeline._viewportWidthNow();
      const previousMaxScroll = Math.max(0, timeline.totalWidth - previousWidth);
      const wasRightPinned = previousMode === 'timeline' && previousMaxScroll - previousScroll <= 1;
      const rememberedCenter = Number(props.view?.focusedAt);
      const anchorTime = previousMode === 'timeline'
        ? previousScroll > 1 && timeline.segments.length
          ? timeline.xToTime(previousScroll + previousWidth / 2)
          : Number.isFinite(rememberedCenter) && rememberedCenter > 0
            ? rememberedCenter
            : (timeline.segments.length ? timeline.xToTime(previousScroll + previousWidth / 2) : null)
        : null;
      const mapping = mapItems(nextProps.items, nextProps.now);
      const mapped = mapping.mapped;
      const nextDomainStart = Math.min(Number(nextProps.view?.start) || Number(nextProps.now) - DAY_MS, Number(nextProps.domainStart ?? Number(nextProps.now) - 7 * DAY_MS), ...mapped.map(task => task.start));
      const nextDomainEnd = Math.max(Number(nextProps.now), Number(nextProps.view?.end) || 0, nextDomainStart + 1_000, ...mapped.map(task => task.end));
      timeline.currentTime = Number(nextProps.now);
      if (applyExternalView && nextProps.view) {
        timeline.options.totalRange = nextProps.totalRange ?? nextProps.view;
      }
      timeline.setRows(normalizedRows(nextProps.rows), { render: false });
      timeline.setTasks(mapped, { domainStart: nextDomainStart, domainEnd: nextDomainEnd, preserveScroll: true, preserveHistory: true });
      originalItems = mapping.sources;
      timeline.selectedKey = previousSelection != null && timeline._findTask(previousSelection) ? previousSelection : null;
      timeline.focusedKey = previousFocus != null && timeline._findTask(previousFocus) ? previousFocus : null;
      timeline.setViewMode(previousMode, { emit: false });
      hydrateExternalState();
      if (applyExternalView && nextProps.view) applyView(nextProps.view);
      else if (wasRightPinned) timeline.scrollToEnd();
      else if (anchorTime != null && Number.isFinite(anchorTime)) {
        // setTasks rebuilds the scrollable geometry and Chrome can clamp the
        // viewport to zero during that DOM replacement. Restore the time
        // the user was actually viewing, not the clamped pixel scroll value.
        timeline._setScrollLeft(timeline.timeToX(anchorTime) - previousWidth / 2);
      }
      styleTasks();
      requestAnimationFrame(() => { suppressViewportScroll = false; });
    }

    timelineApi = {
      update(next = {}) {
        if (destroyed) return;
        if (hasActiveInteraction()) {
          // setTasks() clears editState and replaces the dragged DOM node.
          // Retain the latest incoming snapshot until pointerup AND the local
          // edit acceptance finish; background sync must not cancel a gesture.
          deferredUpdate = { ...(deferredUpdate ?? {}), ...next };
          return true;
        }
        if (deferredUpdate) {
          next = { ...deferredUpdate, ...next };
          deferredUpdate = null;
        }
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
            return true;
          }
          reconcile(candidateProps, { applyExternalView: Object.hasOwn(next, 'view') });
          props = candidateProps;
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
        if (deferredFlushTimer !== null) clearTimeout(deferredFlushTimer);
        global.removeEventListener('pointerup', onGestureEnd);
        global.removeEventListener('pointercancel', onGestureEnd);
        deferredUpdate = null;
        timeline.destroy();
      },
      getView: viewFromComponent,
      scrollToEnd() {
        if (timeline.getViewMode() === 'calendar') {
          const running = timeline._runningTask?.();
          timeline.setCalendarDate(running?.start ?? timeline.domainEnd);
          if (running) timeline._scrollCalendarTaskIntoView?.(running);
        } else timeline.scrollToEnd();
        notifyView();
      },
      setViewMode(mode) {
        const firstCalendar = props.weeklyCalendar && mode === 'calendar' && !timeline.calendarWindowInitialized;
        timeline.setViewMode(mode);
        if (firstCalendar) {
          const viewport = timeline.calendarViewport;
          const metrics = timeline._calendarMetricsForRender();
          const today = timeline._floorDay(Number(props.now));
          const dayIndex = Math.round((today - timeline.calendarStartDay) / DAY_MS);
          viewport.scrollLeft = Math.max(0, metrics.timeAxisWidth + (dayIndex + 0.5) * metrics.dayWidth - viewport.clientWidth / 2);
          timeline.calendarCanvas.style.setProperty('--clockoli-calendar-scroll-left', `${viewport.scrollLeft}px`);
        }
        styleTasks();
      },
      getViewMode() { return timeline.getViewMode(); },
      captureCalendarScroll() {
        return timeline.getViewMode() === 'calendar'
          ? { top: timeline.calendarViewport.scrollTop, manual: timeline.calendarManualScroll } : null;
      },
      restoreCalendarScroll(position) {
        if (!position || timeline.getViewMode() !== 'calendar') return;
        timeline.calendarViewport.scrollTop = position.manual ? position.top : timeline.calendarAutoScrollTop;
      },
      setCalendarDate(value) { timeline.setCalendarDate(value); },
      setCalendarRange(range) { timeline.setCalendarRange(range); },
      shiftCalendar(direction) { timeline.shiftCalendar(direction); },
      getCalendarRange() { return timeline.getCalendarRange(); },
      __timeline: timeline,
    };
    return timelineApi;
  }

  global.ClockoliTaskTimeline = Object.freeze({
    COLOR_PALETTE,
    MINIMUM_ITEM_WIDTH,
    createColorResolver,
    createTimeline,
  });
})(globalThis);
