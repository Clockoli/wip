import { normalizeTaskUrl } from '../domain/values.js';
import { dateValue, timeValue, parseTime, localTimestamp } from './local-time.js';

/** One extension-page time-entry form for creating and editing records. */
export function mountAddTime(button, { send, onAdded = () => location.reload(), container = document.body }) {
  const dialog = document.createElement('dialog'); dialog.className = 'add-time-dialog';
  dialog.setAttribute('aria-labelledby', 'add-time-title');
  const heading = document.createElement('h2'); heading.id = 'add-time-title'; heading.textContent = 'Add new time';
  const close = document.createElement('button'); close.type = 'button'; close.className = 'add-time-close';
  close.textContent = '×'; close.setAttribute('aria-label', 'Close Add time');
  const intro = document.createElement('p'); intro.className = 'add-time-hint'; intro.textContent = 'Find a task in your activity history or paste a task URL.';
  const taskLabel = document.createElement('label'); taskLabel.textContent = 'Task'; taskLabel.htmlFor = 'add-time-task';
  const search = document.createElement('input'); search.id = 'add-time-task'; search.type = 'search'; search.autocomplete = 'off';
  search.placeholder = 'Search title or URL, or paste a URL'; search.setAttribute('role', 'combobox');
  search.setAttribute('aria-controls', 'add-time-suggestions'); search.setAttribute('aria-expanded', 'false');
  const suggestions = document.createElement('div'); suggestions.id = 'add-time-suggestions'; suggestions.className = 'add-time-suggestions';
  suggestions.setAttribute('aria-label', 'Matching tasks');
  const times = document.createElement('div'); times.className = 'add-time-times';
  times.setAttribute('role', 'group'); times.setAttribute('aria-label', 'Time range');
  const makeField = (text, id, type) => {
    const label = document.createElement('label'); label.textContent = text;
    const input = document.createElement('input'); input.type = type; input.id = id;
    label.htmlFor = id; label.append(input); times.append(label); return input;
  };
  const start = makeField('Start', 'add-time-start', 'text');
  const end = makeField('End (optional)', 'add-time-end', 'text');
  const date = makeField('Date', 'add-time-date', 'date');
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
  const preview = document.createElement('div'); preview.className = 'add-time-preview'; preview.setAttribute('aria-live', 'polite'); preview.hidden = true;
  const error = document.createElement('p'); error.className = 'add-time-error'; error.setAttribute('role', 'alert'); error.hidden = true;
  const actions = document.createElement('div'); actions.className = 'add-time-actions';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel';
  const add = document.createElement('button'); add.type = 'button'; add.className = 'add-time-submit'; add.textContent = 'Add';
  actions.append(cancel, add);
  dialog.append(close, heading, intro, taskLabel, search, suggestions, times, hint, descriptionLabel, description, moreDescription, preview, error, actions);
  container.append(dialog);
  const saved = document.createElement('span');
  saved.className = 'add-time-success'; saved.textContent = '✓ Saved'; saved.setAttribute('role', 'status'); saved.hidden = true;
  button.insertAdjacentElement('afterend', saved);
  let savedTimer = null;

  let tasks = [], selected = null, generation = 0, busy = false, searched = false, editing = null;
  const setError = text => { error.textContent = text; error.hidden = !text; };
  const taskIdentity = () => {
    if (selected && search.value.trim() === (selected.title || selected.taskUrl)) return selected;
    try {
      const url = normalizeTaskUrl(search.value.trim());
      if (editing?.entry.taskUrl === url) return { taskUrl: url, title: editing.entry.taskTitle || '' };
      return tasks.find(task => task.taskUrl === url) || { taskUrl: url, title: '' };
    } catch { return null; }
  };
  const update = () => {
    const query = search.value.trim().toLowerCase();
    suggestions.replaceChildren();
    if (query && !selected) {
      for (const task of tasks.filter(item => `${item.title || ''} ${item.taskUrl}`.toLowerCase().includes(query)).slice(0, 8)) {
        const option = document.createElement('button'); option.type = 'button'; option.className = 'add-time-option';
        const optionTitle = document.createElement('strong'); optionTitle.textContent = task.title || task.taskUrl;
        const url = document.createElement('span'); url.textContent = task.taskUrl;
        option.append(optionTitle, url);
        option.addEventListener('click', () => { selected = task; search.value = task.title || task.taskUrl; update(); search.focus(); });
        suggestions.append(option);
      }
    }
    search.setAttribute('aria-expanded', String(suggestions.childElementCount > 0));
    preview.replaceChildren();
    const task = taskIdentity();
    preview.hidden = !task || Boolean(editing?.running);
    if (task) {
      const title = document.createElement('strong'); title.textContent = task.title || 'New URL task';
      const url = document.createElement('span'); url.textContent = task.taskUrl;
      preview.append(title, url);
    }
  };
  search.addEventListener('input', async () => {
    selected = null; setError(''); update();
    if (!search.value.trim() || searched) return;
    searched = true; const request = generation;
    try {
      const data = await send({ type: 'SEARCH_ACTIVITY' });
      if (request !== generation || !dialog.open) return;
      if (!data?.configured) { setError('Set up Clockoli before adding time.'); return; }
      const byUrl = new Map();
      for (const record of data.recent ?? []) {
        const taskUrl = record.taskUrl ?? record.issue?.url;
        if (typeof taskUrl !== 'string' || !taskUrl || byUrl.has(taskUrl)) continue;
        byUrl.set(taskUrl, { taskUrl, title: record.taskTitle ?? record.issueTitle ?? '', destinationId: record.destinationId });
      }
      tasks = [...byUrl.values()];
      if (data.partial || data.conflicts?.length) setError('Some activity could not be searched. Results may be incomplete.');
      update();
    } catch (cause) { if (request === generation && dialog.open) setError(`${cause.message || 'Activity search failed.'} You can still paste a URL.`); }
  });
  cancel.addEventListener('click', () => { if (!busy) dialog.close(); });
  close.addEventListener('click', () => { if (!busy) dialog.close(); });
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  dialog.addEventListener('close', () => {
    if (dialog.open) return; // A later edit may already have reopened the dialog.
    generation++; editing?.trigger?.focus?.(); editing = null;
  });
  const open = (entry = null, onEdit = null, trigger = button) => {
    saved.hidden = true;
    clearTimeout(savedTimer);
    generation++;
    const runningEdit = Boolean(entry && (entry._active || entry.endedAt == null));
    editing = entry ? { entry, onEdit, trigger, running: runningEdit } : null;
    const now = new Date();
    tasks = []; selected = null; searched = false; busy = false; search.value = '';
    heading.textContent = runningEdit ? 'Edit timer start' : entry ? 'Edit time' : 'Add new time';
    close.setAttribute('aria-label', runningEdit ? 'Close Edit timer start' : entry ? 'Close Edit time' : 'Close Add time');
    add.textContent = entry ? 'Save' : 'Add';
    hint.hidden = Boolean(entry);
    times.dataset.runningEdit = String(runningEdit);
    times.setAttribute('aria-label', runningEdit ? 'Timer start' : 'Time range');
    intro.hidden = runningEdit; taskLabel.hidden = runningEdit; search.hidden = runningEdit;
    suggestions.hidden = runningEdit; end.parentElement.hidden = runningEdit;
    descriptionLabel.hidden = runningEdit; description.hidden = runningEdit;
    refreshDateMax();
    date.value = dateValue(entry ? new Date(entry.startedAt) : now);
    start.value = timeValue(entry ? new Date(entry.startedAt) : now);
    end.value = entry && !runningEdit ? timeValue(new Date(entry.endedAt)) : '';
    description.value = entry?.description || '';
    if (entry) {
      selected = { taskUrl: entry.taskUrl, title: entry.taskTitle || '', destinationId: entry.destinationId };
      tasks = [selected]; search.value = selected.title || selected.taskUrl;
    }
    resizeDescription();
    if (runningEdit) moreDescription.hidden = true;
    setError('');
    update(); dialog.showModal(); (runningEdit ? start : search).focus();
  };
  button.addEventListener('click', () => open());
  const submit = async () => {
    if (busy) return;
    const runningEdit = Boolean(editing?.running);
    const task = runningEdit ? null : taskIdentity();
    if (!runningEdit && !task) { setError('Select a task or enter an HTTP(S) URL.'); return; }
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
    const unchangedTimes = editing && date.value === dateValue(initialStart)
      && startTime === timeValue(initialStart) && (runningEdit || endTime === timeValue(initialEnd));
    const startedAt = unchangedTimes ? editing.entry.startedAt : startDate ? startDate.toISOString() : now.toISOString();
    let endDate = null;
    if (endTime && startDate) {
      const day = new Date(`${date.value}T12:00:00`);
      if (endTime < startTime) day.setDate(day.getDate() + 1);
      endDate = localTimestamp(dateValue(day), endTime);
    }
    const keepOriginalEnd = editing && !runningEdit && startDate && date.value === dateValue(initialStart)
      && endTime === timeValue(initialEnd) && initialEnd >= startDate;
    const endedAt = unchangedTimes || keepOriginalEnd ? editing.entry.endedAt : endDate?.toISOString() ?? null;
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
          description: description.value.trim() };
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
      setError(editing && /overlap/i.test(message)
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
  return dialog;
}
