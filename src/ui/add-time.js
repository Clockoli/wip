import { normalizeTaskUrl } from '../domain/values.js';
import { dateValue, timeValue, parseTime, localTimestamp } from './local-time.js';

/** One extension-page time-entry form for creating and editing records. */
const CHECK_PATH = 'M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z';
const X_PATH = 'M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z';
const CHEVRON_LEFT_PATH = 'M9.78 12.78a.75.75 0 0 1-1.06 0L4.47 8.53a.75.75 0 0 1 0-1.06l4.25-4.25a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042L6.06 8l3.72 3.72a.75.75 0 0 1 0 1.06Z';
const CHEVRON_RIGHT_PATH = 'M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z';
const OCTICON_NS = 'http://www.w3.org/2000/svg';
function octicon(path) {
  const svg = document.createElementNS(OCTICON_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16'); svg.setAttribute('width', '16'); svg.setAttribute('height', '16');
  svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('fill', 'currentColor');
  const shape = document.createElementNS(OCTICON_NS, 'path'); shape.setAttribute('d', path); svg.append(shape);
  return svg;
}

export function mountAddTime(button, { send, onAdded = () => location.reload(), container = document.body,
  searchIsCompleteCatalog = true }) {
  const dialog = document.createElement('dialog'); dialog.className = 'add-time-dialog';
  dialog.setAttribute('aria-labelledby', 'add-time-title');
  const heading = document.createElement('h2'); heading.id = 'add-time-title'; heading.textContent = 'Add new time';
  const close = document.createElement('button'); close.type = 'button'; close.className = 'add-time-close';
  close.append(octicon(X_PATH)); close.setAttribute('aria-label', 'Close Add time');
  const intro = document.createElement('p'); intro.className = 'add-time-hint'; intro.textContent = searchIsCompleteCatalog
    ? 'Find a tracked task from any person in your time repositories or paste a task URL.'
    : 'Find a tracked imported task in this entry’s time repository or paste a task URL.';
  const taskLabel = document.createElement('label'); taskLabel.textContent = 'Task'; taskLabel.htmlFor = 'add-time-task';
  const search = document.createElement('input'); search.id = 'add-time-task'; search.type = 'search'; search.autocomplete = 'off';
  search.placeholder = 'Search title or URL, or paste a URL'; search.setAttribute('role', 'combobox');
  search.setAttribute('aria-controls', 'add-time-suggestions'); search.setAttribute('aria-expanded', 'false');
  search.setAttribute('aria-busy', 'false');
  const searchStatus = document.createElement('div'); searchStatus.className = 'add-time-search-status';
  searchStatus.setAttribute('role', 'status'); searchStatus.setAttribute('aria-label', 'Searching tasks'); searchStatus.hidden = true;
  const searchSpinner = document.createElement('span'); searchSpinner.className = 'add-time-search-spinner';
  searchSpinner.setAttribute('aria-hidden', 'true');
  searchStatus.append(searchSpinner, document.createTextNode('Searching tasks…'));
  const suggestions = document.createElement('div'); suggestions.id = 'add-time-suggestions'; suggestions.className = 'add-time-suggestions';
  suggestions.setAttribute('aria-label', 'Matching tasks');
  const searchPopup = document.createElement('div'); searchPopup.className = 'add-time-search-popup'; searchPopup.hidden = true;
  searchPopup.append(searchStatus, suggestions);
  const searchContainer = document.createElement('div'); searchContainer.className = 'add-time-task-search';
  searchContainer.append(search, searchPopup);
  const dayRangeLabel = document.createElement('label'); dayRangeLabel.className = 'add-time-day-range-toggle';
  const dayRange = document.createElement('input'); dayRange.type = 'checkbox'; dayRange.id = 'add-time-day-range';
  dayRangeLabel.append(dayRange, document.createTextNode('Multiple days'));
  const times = document.createElement('div'); times.className = 'add-time-times';
  times.setAttribute('role', 'group'); times.setAttribute('aria-label', 'Time range');
  const makeField = (text, id, type) => {
    const label = document.createElement('label');
    const caption = document.createElement('span'); caption.textContent = text;
    const input = document.createElement('input'); input.type = type; input.id = id;
    label.htmlFor = id; label.append(caption, input); times.append(label); return input;
  };
  const start = makeField('Start', 'add-time-start', 'text');
  const end = makeField('End (optional)', 'add-time-end', 'text');
  const date = makeField('Date', 'add-time-date', 'date');
  const rangeFields = document.createElement('div'); rangeFields.className = 'add-time-range-fields'; rangeFields.hidden = true;
  const calendar = document.createElement('div'); calendar.className = 'add-time-calendar';
  calendar.setAttribute('role', 'group'); calendar.setAttribute('aria-label', 'Select days');
  const calendarHeader = document.createElement('div'); calendarHeader.className = 'add-time-calendar-header';
  const previousMonth = document.createElement('button'); previousMonth.type = 'button';
  previousMonth.append(octicon(CHEVRON_LEFT_PATH)); previousMonth.setAttribute('aria-label', 'Previous month');
  const monthTitle = document.createElement('strong'); monthTitle.setAttribute('aria-live', 'polite');
  const nextMonth = document.createElement('button'); nextMonth.type = 'button';
  nextMonth.append(octicon(CHEVRON_RIGHT_PATH)); nextMonth.setAttribute('aria-label', 'Next month');
  calendarHeader.append(previousMonth, monthTitle, nextMonth);
  const days = document.createElement('div'); days.className = 'add-time-calendar-days';
  const selectedCount = document.createElement('p'); selectedCount.className = 'add-time-selected-count';
  selectedCount.setAttribute('role', 'status');
  calendar.append(calendarHeader, days, selectedCount);
  const hoursLabel = document.createElement('label'); hoursLabel.textContent = 'Hours per day';
  const hours = document.createElement('input'); hours.type = 'number'; hours.id = 'add-time-daily-hours';
  hours.min = '0'; hours.max = '24'; hours.step = 'any'; hours.required = true; hours.placeholder = 'e.g. 8';
  hoursLabel.htmlFor = hours.id; hoursLabel.append(hours);
  const rangeDetails = document.createElement('div'); rangeDetails.className = 'add-time-range-details';
  rangeDetails.append(hoursLabel); rangeFields.append(calendar, rangeDetails);
  for (const input of [start, end]) {
    input.inputMode = 'numeric'; input.placeholder = 'HH:MM'; input.autocomplete = 'off'; input.maxLength = 5;
    input.addEventListener('click', () => input.select());
    input.addEventListener('blur', () => {
      const normalized = parseTime(input.value);
      if (normalized) input.value = normalized;
    });
  }
  const refreshDateMax = () => { date.max = dateValue(new Date()); };
  date.addEventListener('focus', refreshDateMax);
  const hint = document.createElement('p'); hint.className = 'add-time-hint'; hint.textContent = 'Leave End empty to start a timer. One entry can be at most 24 hours.';
  const rangeHint = document.createElement('p'); rangeHint.className = 'add-time-hint'; rangeHint.hidden = true;
  rangeHint.textContent = 'Choose days in the calendar, including nonconsecutive days. Click a selected day to remove it. Up to a 500-day span. Enter 0 hours to record a day without tracked time.';
  const selectedDays = new Set();
  let calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const renderCalendar = () => {
    const today = dateValue(new Date());
    monthTitle.textContent = calendarMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    nextMonth.disabled = calendarMonth.getFullYear() === new Date().getFullYear()
      && calendarMonth.getMonth() === new Date().getMonth();
    days.replaceChildren();
    for (const name of ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']) {
      const heading = document.createElement('span'); heading.textContent = name;
      heading.setAttribute('aria-hidden', 'true'); days.append(heading);
    }
    const firstWeekday = calendarMonth.getDay();
    for (let index = 0; index < firstWeekday; index++) days.append(document.createElement('span'));
    const count = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 0).getDate();
    for (let day = 1; day <= count; day++) {
      const current = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), day);
      const key = dateValue(current);
      const cell = document.createElement('button'); cell.type = 'button'; cell.textContent = String(day);
      cell.setAttribute('aria-label', current.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }));
      cell.setAttribute('aria-pressed', String(selectedDays.has(key)));
      cell.disabled = key > today;
      cell.addEventListener('click', () => {
        if (selectedDays.has(key)) selectedDays.delete(key);
        else {
          const all = [...selectedDays, key].sort();
          const span = (Date.parse(`${all.at(-1)}T00:00:00Z`) - Date.parse(`${all[0]}T00:00:00Z`)) / 86400000;
          if (all.length > 500 || span >= 500) { setError('Select days within a 500-day span.'); return; }
          selectedDays.add(key);
        }
        cell.setAttribute('aria-pressed', String(selectedDays.has(key)));
        selectedCount.textContent = `${selectedDays.size} ${selectedDays.size === 1 ? 'day' : 'days'} selected`;
        setError('');
      });
      days.append(cell);
    }
  };
  previousMonth.addEventListener('click', () => { calendarMonth.setMonth(calendarMonth.getMonth() - 1); renderCalendar(); });
  nextMonth.addEventListener('click', () => { calendarMonth.setMonth(calendarMonth.getMonth() + 1); renderCalendar(); });
  const showDayRange = () => {
    const enabled = dayRange.checked;
    start.parentElement.hidden = enabled; end.parentElement.hidden = enabled;
    date.parentElement.hidden = enabled;
    rangeFields.hidden = !enabled; rangeHint.hidden = !enabled; hint.hidden = enabled;
    if (enabled) rangeDetails.append(descriptionFields);
    else boundaryHint.after(descriptionFields);
    if (enabled) renderCalendar();
  };
  dayRange.addEventListener('change', showDayRange);
  const boundaryHint = document.createElement('p'); boundaryHint.className = 'add-time-hint'; boundaryHint.hidden = true;
  const overlapProgress = document.createElement('progress'); overlapProgress.className = 'add-time-progress';
  overlapProgress.setAttribute('aria-label', 'Resolving overlap and syncing time'); overlapProgress.hidden = true;
  const overlapStatus = document.createElement('p'); overlapStatus.className = 'add-time-status';
  overlapStatus.setAttribute('role', 'status'); overlapStatus.textContent = 'Checking overlap and syncing queued time with GitHub…';
  overlapStatus.hidden = true;
  const descriptionLabel = document.createElement('label'); descriptionLabel.textContent = 'Description (optional)'; descriptionLabel.htmlFor = 'add-time-description';
  const description = document.createElement('textarea'); description.id = 'add-time-description'; description.rows = 3; description.maxLength = 2000;
  const moreDescription = document.createElement('small');
  moreDescription.className = 'add-time-description-more'; moreDescription.textContent = '↓ More lines — scroll'; moreDescription.hidden = true;
  const resizeDescription = () => {
    const count = description.value.split('\n').length;
    description.rows = Math.min(9, Math.max(3, count));
    description.style.height = 'auto';
    const height = Number(description.scrollHeight) || 0;
    const clipped = count > 9 || height > 240 + 1;
    if (height) description.style.height = `${Math.min(240, Math.max(36, height))}px`;
    description.style.overflowY = clipped ? 'auto' : 'hidden';
    moreDescription.hidden = !clipped;
  };
  description.addEventListener('input', resizeDescription);
  const descriptionFields = document.createElement('div'); descriptionFields.className = 'add-time-description-fields';
  descriptionFields.append(descriptionLabel, description, moreDescription);
  const preview = document.createElement('div'); preview.className = 'add-time-preview'; preview.setAttribute('aria-live', 'polite'); preview.hidden = true;
  const error = document.createElement('p'); error.className = 'add-time-error'; error.setAttribute('role', 'alert'); error.hidden = true;
  const actions = document.createElement('div'); actions.className = 'add-time-actions';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel';
  const add = document.createElement('button'); add.type = 'button'; add.className = 'add-time-submit'; add.textContent = 'Add';
  actions.append(cancel, add);
  dialog.append(close, heading, intro, taskLabel, searchContainer, dayRangeLabel, times, rangeFields,
    hint, rangeHint, boundaryHint, descriptionFields, preview, error, actions);
  container.append(dialog);
  const saved = document.createElement('span');
  saved.className = 'add-time-success'; saved.textContent = 'Saved'; saved.prepend(octicon(CHECK_PATH)); saved.setAttribute('role', 'status'); saved.hidden = true;
  button.insertAdjacentElement('afterend', saved);
  let savedTimer = null;

  let tasks = [], selected = null, generation = 0, busy = false, searching = false, searchTimer = null;
  let returnTrigger = null, returnFallback = null;
  let lastSearch = '', searchIncomplete = false, catalogLoaded = false, editing = null, showRepository = false;
  let defaultStart = '', defaultDate = '', startEdited = false, dateEdited = false;
  let editStartInstant = null, editEndInstant = null, endShifted = false;
  const moveEditedRange = () => {
    if (!editing || editing.running || editing.boundary) return;
    const nextStart = localTimestamp(date.value, parseTime(start.value));
    if (!nextStart || !editStartInstant || !editEndInstant) return;
    if (!parseTime(end.value)) { editStartInstant = nextStart; return; }
    editEndInstant = new Date(editEndInstant.getTime() + nextStart.getTime() - editStartInstant.getTime());
    editStartInstant = nextStart;
    end.value = timeValue(editEndInstant);
    endShifted = true;
  };
  start.addEventListener('input', () => { startEdited = true; moveEditedRange(); });
  date.addEventListener('input', () => { dateEdited = true; moveEditedRange(); });
  end.addEventListener('input', () => {
    endShifted = false;
    if (!editing || editing.running || editing.boundary) return;
    const startTime = parseTime(start.value), endTime = parseTime(end.value);
    if (!endTime) return;
    const day = localTimestamp(date.value, '12:00') && new Date(`${date.value}T12:00:00`);
    if (day && startTime && endTime < startTime) day.setDate(day.getDate() + 1);
    editEndInstant = localTimestamp(day && startTime ? dateValue(day) : dateValue(editEndInstant), endTime) || editEndInstant;
  });
  const setError = text => { error.textContent = text; error.hidden = !text; };
  const updateSearchPopup = () => { searchPopup.hidden = searchStatus.hidden && !suggestions.childElementCount; };
  const setSearchBusy = value => {
    searchStatus.hidden = !value; search.setAttribute('aria-busy', String(value)); updateSearchPopup();
  };
  const taskIdentity = () => {
    if (selected && search.value.trim() === (selected.title || selected.taskUrl)) return selected;
    try {
      const url = normalizeTaskUrl(search.value.trim());
      if (editing?.entry.taskUrl === url) return { taskUrl: url, title: editing.entry.taskTitle || '' };
      return tasks.find(task => task.taskUrl === url) || { taskUrl: url, title: '' };
    } catch { return null; }
  };
  const update = () => {
    suggestions.replaceChildren();
    if (taskSearch.query && !selected) {
      for (const task of taskSearch.matches(tasks, () => true, 8)) {
        const option = document.createElement('button'); option.type = 'button'; option.className = 'add-time-option';
        const optionTitle = document.createElement('strong'); optionTitle.textContent = task.title || task.taskUrl;
        const url = document.createElement('span'); url.textContent = task.taskUrl;
        option.append(optionTitle, url);
        if (showRepository && task.destinationId && task.timeRepository) {
          const repository = document.createElement('span'); repository.textContent = task.timeRepository;
          option.append(repository);
        }
        option.addEventListener('click', () => { selected = task; search.value = task.title || task.taskUrl; update(); search.focus(); });
        suggestions.append(option);
      }
    }
    search.setAttribute('aria-expanded', String(suggestions.childElementCount > 0));
    updateSearchPopup();
    preview.replaceChildren();
    const task = taskIdentity();
    preview.hidden = !task || Boolean(editing?.running);
    if (task) {
      const title = document.createElement('strong'); title.textContent = task.title || 'New URL task';
      const url = document.createElement('span'); url.textContent = task.taskUrl;
      preview.append(title, url);
    }
  };
  const onSearchInput = () => {
    selected = null; setError(''); update();
    clearTimeout(searchTimer);
    const query = search.value.trim();
    if (!query || (searchIsCompleteCatalog && catalogLoaded && !searchIncomplete && taskSearch.matches(tasks, () => true, 1).length)) {
      if (!query) lastSearch = '';
      setSearchBusy(false); return;
    }
    if (searching) { setSearchBusy(true); return; }
    if (query === lastSearch) { setSearchBusy(false); return; }
    setSearchBusy(true);
    searchTimer = setTimeout(async () => {
      searching = true; lastSearch = query; const request = generation;
      try {
        const data = await send({ type: 'SEARCH_TASKS', query });
        if (request !== generation || !dialog.open) return;
        if (!data?.configured) { lastSearch = ''; searchIncomplete = true; catalogLoaded = false; setError('Set up Clockoli before adding time.'); return; }
        tasks = Array.isArray(data.tasks) ? data.tasks : [];
        showRepository = Array.isArray(data.readStatus) ? data.readStatus.length > 1
          : new Set(tasks.map(task => task.timeRepository).filter(Boolean)).size > 1;
        searchIncomplete = Boolean(data.partial || data.conflicts?.length);
        catalogLoaded = searchIsCompleteCatalog && !searchIncomplete;
        if (searchIncomplete) {
          lastSearch = '';
          setError('Some tracked tasks could not be searched. Results may be incomplete.');
        }
        update();
      } catch (cause) { if (request === generation && dialog.open) { lastSearch = ''; searchIncomplete = true; setError(`${cause.message || 'Task search failed.'} You can still paste a URL.`); } }
      finally {
        if (request === generation) {
          searching = false; setSearchBusy(false);
          if (query !== search.value.trim() && search.value.trim()
              && (searchIncomplete || !searchIsCompleteCatalog || !taskSearch.matches(tasks, () => true, 1).length)) onSearchInput();
        }
      }
    }, 180);
  };
  const taskSearch = globalThis.ClockoliTaskSearch.mount(search, { onInput: onSearchInput });
  cancel.addEventListener('click', () => { if (!busy) dialog.close(); });
  close.addEventListener('click', () => { if (!busy) dialog.close(); });
  dialog.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    // A focused search input consumes Escape to clear its value before the
    // dialog receives a native cancel event. Dismiss the form on the first press.
    event.preventDefault(); event.stopPropagation();
    if (!busy) dialog.close();
  }, true);
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  dialog.addEventListener('close', () => {
    if (dialog.open) return; // A later edit may already have reopened the dialog.
    generation++; clearTimeout(searchTimer); setSearchBusy(false);
    const target = editing?.trigger || returnTrigger;
    const replacement = target?.isConnected === false ? returnFallback?.() : target;
    replacement?.focus?.({ preventScroll: true });
    editing = null; returnTrigger = null; returnFallback = null;
  });
  const open = (entry = null, onEdit = null, trigger = button, prefilledTask = null, focusFallback = null) => {
    saved.hidden = true;
    clearTimeout(savedTimer);
    generation++;
    const boundary = entry?._overlapBoundary === 'end' || entry?._overlapBoundary === 'start'
      ? entry._overlapBoundary : null;
    if (boundary) boundaryHint.after(overlapProgress, overlapStatus);
    else { overlapProgress.remove(); overlapStatus.remove(); }
    const runningEdit = Boolean(entry && !boundary && (entry._active || entry.endedAt == null));
    editing = entry ? { entry, onEdit, trigger, running: runningEdit, boundary } : null;
    returnTrigger = prefilledTask ? trigger : null; returnFallback = focusFallback;
    const now = new Date();
    tasks = []; selected = null; lastSearch = ''; searchIncomplete = false; catalogLoaded = false; searching = false; showRepository = false;
    busy = false; search.value = ''; setSearchBusy(false);
    overlapProgress.hidden = true; overlapStatus.hidden = true;
    heading.textContent = runningEdit ? 'Edit timer start' : boundary ? 'Resolve time overlap' : entry ? 'Edit time' : 'Add new time';
    close.setAttribute('aria-label', runningEdit ? 'Close Edit timer start' : entry ? 'Close Edit time' : 'Close Add time');
    add.textContent = entry ? 'Save' : 'Add';
    dayRange.checked = false; dayRangeLabel.hidden = Boolean(entry);
    selectedDays.clear(); selectedCount.textContent = '0 days selected';
    calendarMonth = new Date(now.getFullYear(), now.getMonth(), 1); hours.value = '';
    showDayRange();
    hint.hidden = Boolean(entry);
    boundaryHint.hidden = !boundary;
    boundaryHint.textContent = boundary === 'end'
      ? 'Change the End time. The Start time stays unchanged.'
      : 'Change the Start time. The End time stays unchanged.';
    times.dataset.runningEdit = String(runningEdit);
    if (boundary) { times.dataset.overlapBoundary = boundary; dialog.dataset.overlapBoundary = boundary; }
    else { delete times.dataset.overlapBoundary; delete dialog.dataset.overlapBoundary; }
    times.setAttribute('aria-label', runningEdit ? 'Timer start' : 'Time range');
    intro.hidden = runningEdit || Boolean(boundary); taskLabel.hidden = runningEdit || Boolean(boundary);
    searchContainer.hidden = runningEdit || Boolean(boundary);
    search.hidden = runningEdit || Boolean(boundary);
    suggestions.hidden = runningEdit || Boolean(boundary);
    start.parentElement.hidden = boundary === 'end';
    end.parentElement.hidden = runningEdit || boundary === 'start';
    date.parentElement.hidden = Boolean(boundary);
    end.parentElement.children[0].textContent = boundary ? 'End' : 'End (optional)';
    descriptionLabel.hidden = runningEdit || Boolean(boundary); description.hidden = runningEdit || Boolean(boundary);
    date.disabled = Boolean(boundary);
    start.disabled = boundary === 'end'; end.disabled = boundary === 'start';
    for (const input of [start, end]) {
      input.placeholder = 'HH:MM';
      input.maxLength = 5;
    }
    refreshDateMax();
    date.value = dateValue(entry ? new Date(entry.startedAt) : now);
    start.value = timeValue(entry ? new Date(entry.startedAt) : now);
    defaultDate = date.value; defaultStart = start.value;
    startEdited = false; dateEdited = false;
    end.value = entry && !runningEdit ? timeValue(new Date(entry.endedAt)) : '';
    editStartInstant = entry && !runningEdit ? new Date(entry.startedAt) : null;
    editEndInstant = entry && !runningEdit ? new Date(entry.endedAt) : null;
    endShifted = false;
    description.value = entry?.description || '';
    if (entry || prefilledTask) {
      selected = entry ? { taskUrl: entry.taskUrl, title: entry.taskTitle || '', destinationId: entry.destinationId }
        : { taskUrl: prefilledTask.taskUrl, title: prefilledTask.title || '',
          destinationId: prefilledTask.destinationId || prefilledTask.destinationIds?.[0] };
      tasks = [selected]; search.value = selected.title || selected.taskUrl;
    }
    resizeDescription();
    if (runningEdit || boundary) moreDescription.hidden = true;
    setError('');
    update(); preview.hidden = Boolean(boundary) || preview.hidden;
    dialog.showModal(); (boundary === 'end' ? end : runningEdit || boundary || prefilledTask ? start : search).focus();
  };
  button.addEventListener('click', () => open());
  const submit = async () => {
    if (busy) return;
    if (editing?.boundary) {
      const { entry, boundary } = editing;
      const originalStart = new Date(entry.startedAt), originalEnd = new Date(entry.endedAt);
      const input = boundary === 'start' ? start : end;
      const original = boundary === 'start' ? originalStart : originalEnd;
      const parsed = parseTime(input.value);
      const candidate = parsed && localTimestamp(dateValue(original), parsed);
      if (!candidate) { setError('Enter a valid time (HH:MM).'); return; }
      candidate.setSeconds(boundary === 'start' ? 1 : 0, 0);
      const startedAt = boundary === 'start' && parsed !== timeValue(originalStart)
        ? candidate.toISOString() : entry.startedAt;
      const endedAt = boundary === 'end' && parsed !== timeValue(originalEnd)
        ? candidate.toISOString() : entry.endedAt;
      const now = new Date();
      if (new Date(startedAt) > now || new Date(endedAt) > now) {
        setError('Start and End cannot be in the future.'); return;
      }
      if (new Date(endedAt) <= new Date(startedAt)) { setError('End time must be after start time.'); return; }
      if (new Date(endedAt) - new Date(startedAt) > 24 * 60 * 60 * 1000) {
        setError('One entry cannot exceed 24 hours. Split the time into separate entries.'); return;
      }
      busy = true; add.disabled = true; cancel.disabled = true; close.disabled = true; setError('');
      overlapProgress.hidden = false; overlapStatus.hidden = false;
      try {
        await editing.onEdit({ taskUrl: entry.taskUrl, taskTitle: entry.taskTitle || '', startedAt, endedAt,
          description: entry.description || '' });
        dialog.close();
      } catch (cause) { setError(cause?.message || 'Could not save time.'); }
      finally {
        busy = false; add.disabled = false; cancel.disabled = false; close.disabled = false;
        overlapProgress.hidden = true; overlapStatus.hidden = true;
      }
      return;
    }
    const runningEdit = Boolean(editing?.running);
    const task = runningEdit ? null : taskIdentity();
    if (!runningEdit && !task) { setError('Select a task or enter an HTTP(S) URL.'); return; }
    if (!editing && dayRange.checked) {
      refreshDateMax();
      const dates = [...selectedDays].sort(), daily = hours.value.trim();
      const durationSeconds = Number(daily) * 3600;
      if (!dates.length) { setError('Select at least one day.'); return; }
      if (!daily) { setError('Enter hours per day (0–24). Use 0 for a day without tracked hours.'); hours.focus(); return; }
      if (dates.at(-1) > date.max || !Number.isSafeInteger(durationSeconds)
          || durationSeconds < 0 || durationSeconds > 86400) { setError('Choose past days and 0–24 hours per day.'); return; }
      busy = true; add.disabled = true; cancel.disabled = true; setError('');
      try {
        const result = await send({ type: 'ADD_DAY_RANGE', taskUrl: task.taskUrl, taskTitle: task.title || '',
          description: description.value.trim(), dates, durationSeconds,
          ...(!/^https?:\/\//i.test(task.taskUrl) ? { destinationId: task.destinationId } : {}) });
        dialog.close(); saved.hidden = false;
        clearTimeout(savedTimer); savedTimer = setTimeout(() => { saved.hidden = true; }, 3000);
        await onAdded(result);
      } catch (cause) {
        const message = cause?.message || '';
        setError(/^Message ADD_DAY_RANGE is not allowed from this sender$|^Unknown extension message$/.test(message)
          ? 'Reload Clockoli in your browser’s Extensions page, then reopen Activity or Top tasks and try again. No days were added.'
          : message || 'Could not add the selected days.');
      }
      finally { busy = false; add.disabled = false; cancel.disabled = false; }
      return;
    }
    if (runningEdit && !start.value) { setError('Enter a start time.'); return; }
    if (!runningEdit && end.value && !start.value) { setError('Enter a start time before an end.'); return; }
    const now = new Date();
    const startTime = start.value ? parseTime(start.value) : null;
    const endTime = !runningEdit && end.value ? parseTime(end.value) : null;
    const startDate = localTimestamp(date.value, startTime);
    if (!date.value || (start.value && !startDate) || (!runningEdit && end.value && !endTime)) {
      setError(runningEdit ? 'Enter a valid Date and Start time (HH:MM or 1000).'
        : 'Enter a valid date and start/end time (HH:MM or 1000).'); return;
    }
    const initialStart = editing && new Date(editing.entry.startedAt);
    const initialEnd = editing && !runningEdit && new Date(editing.entry.endedAt);
    const unchangedStart = editing && date.value === dateValue(initialStart) && startTime === timeValue(initialStart)
      && (runningEdit || (!startEdited && !dateEdited));
    const unchangedTimes = unchangedStart && (runningEdit || endTime === timeValue(initialEnd));
    const defaultRunningStart = !editing && !end.value && !startEdited && !dateEdited
      && date.value === defaultDate && start.value === defaultStart;
    const startedAt = unchangedStart ? editing.entry.startedAt
      : defaultRunningStart ? now.toISOString() : startDate ? startDate.toISOString() : now.toISOString();
    let endDate = null;
    if (endTime && startDate) {
      const day = new Date(`${date.value}T12:00:00`);
      if (endTime < startTime) day.setDate(day.getDate() + 1);
      endDate = localTimestamp(dateValue(day), endTime);
    }
    const keepOriginalEnd = editing && !runningEdit && startDate && date.value === dateValue(initialStart)
      && endTime === timeValue(initialEnd) && initialEnd >= startDate;
    const endedAt = unchangedTimes || keepOriginalEnd && !endShifted ? editing.entry.endedAt
      : endShifted ? editEndInstant?.toISOString() : endDate?.toISOString() ?? null;
    if (end.value && !endedAt) { setError('Enter a valid date and start/end time (HH:MM or 1000).'); return; }
    if (new Date(startedAt) > now || (endedAt && new Date(endedAt) > now)) {
      setError(runningEdit ? 'Start cannot be in the future.' : 'Start and End cannot be in the future.'); return;
    }
    if (endedAt && (editing ? endedAt < startedAt : endedAt <= startedAt)) { setError('End time must be after start time.'); return; }
    if (editing && !runningEdit && !endedAt) { setError('An edited entry needs an end date and time.'); return; }
    const unchangedRange = editing && startedAt === editing.entry.startedAt && endedAt === editing.entry.endedAt;
    if (!runningEdit && !unchangedRange && new Date(endedAt ?? now).getTime() - new Date(startedAt).getTime() > 24 * 60 * 60 * 1000) {
      setError('One entry cannot exceed 24 hours. Split the time into separate entries.'); return;
    }
    // Only the short local IndexedDB acceptance is in flight. Never show a
    // GitHub saving status: the shared 15-second sync happens silently later.
    busy = true; add.disabled = true; cancel.disabled = true; setError('');
    try {
      const value = runningEdit ? { startedAt }
        : { taskUrl: task.taskUrl, taskTitle: task.title || '', startedAt, endedAt,
          description: description.value.trim(),
          ...(!/^https?:\/\//i.test(task.taskUrl) ? { destinationId: task.destinationId } : {}) };
      const isEdit = Boolean(editing);
      const result = isEdit ? await editing.onEdit(value)
        : await send({ type: 'ADD_TIME', ...value,
          ...(!/^https?:\/\//i.test(task.taskUrl) ? { destinationId: task.destinationId } : {}) });
      dialog.close();
      if (!isEdit) {
        saved.hidden = false;
        clearTimeout(savedTimer);
        savedTimer = setTimeout(() => { saved.hidden = true; }, 3000);
        await onAdded(result);
      }
    } catch (cause) {
      const message = cause?.message || 'Could not save time.';
      setError(editing && /overlap/i.test(message) && !/running timer/i.test(message)
        ? `${message} Go to List for the affected week and resolve the overlapping entries manually.` : message);
    }
    finally {
      busy = false; add.disabled = false; cancel.disabled = false;
    }
  };
  add.addEventListener('click', submit);
  description.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229 || !event.isTrusted) return;
    event.preventDefault(); void submit();
  });
  dialog.openEdit = (entry, onEdit, trigger) => open(entry, onEdit, trigger);
  dialog.openForTask = (task, trigger, focusFallback) => open(null, null, trigger, task, focusFallback);
  return dialog;
}
