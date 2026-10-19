import { normalizeTaskUrl } from '../domain/values.js';

const dateValue = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** Mount the extension-page-only Add time control. Reads task suggestions on open; writes only on Add. */
export function mountAddTime(button, { send, onAdded = () => location.reload() }) {
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
  const makeTime = (text, id) => {
    const label = document.createElement('label'); label.textContent = text;
    const input = document.createElement('input'); input.type = 'time'; input.id = id;
    label.htmlFor = id; label.append(input); times.append(label); return input;
  };
  const start = makeTime('Start time', 'add-time-start'), end = makeTime('End time', 'add-time-end');
  const hint = document.createElement('p'); hint.className = 'add-time-hint'; hint.textContent = 'Start time defaults to now. Leave End time empty to start a running timer. Times use today’s date.';
  const descriptionLabel = document.createElement('label'); descriptionLabel.textContent = 'Description'; descriptionLabel.htmlFor = 'add-time-description';
  const description = document.createElement('textarea'); description.id = 'add-time-description'; description.rows = 3; description.maxLength = 2000;
  const preview = document.createElement('div'); preview.className = 'add-time-preview'; preview.setAttribute('aria-live', 'polite');
  const error = document.createElement('p'); error.className = 'add-time-error'; error.setAttribute('role', 'alert'); error.hidden = true;
  const actions = document.createElement('div'); actions.className = 'add-time-actions';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel';
  const add = document.createElement('button'); add.type = 'button'; add.className = 'add-time-submit'; add.textContent = 'Add';
  actions.append(cancel, add);
  dialog.append(close, heading, intro, taskLabel, search, suggestions, times, hint, descriptionLabel, description, preview, error, actions);
  document.body.append(dialog);

  let tasks = [], selected = null, generation = 0, busy = false, searched = false;
  const setError = text => { error.textContent = text; error.hidden = !text; };
  const taskIdentity = () => {
    if (selected && search.value.trim() === (selected.title || selected.taskUrl)) return selected;
    try {
      const url = normalizeTaskUrl(search.value.trim());
      return tasks.find(task => task.taskUrl === url) || { taskUrl: url, title: '' };
    } catch { return null; }
  };
  const update = () => {
    const query = search.value.trim().toLowerCase();
    suggestions.replaceChildren();
    if (query && !selected) {
      for (const task of tasks.filter(item => `${item.title || ''} ${item.taskUrl}`.toLowerCase().includes(query)).slice(0, 8)) {
        const option = document.createElement('button'); option.type = 'button'; option.className = 'add-time-option';
        const title = document.createElement('strong'); title.textContent = task.title || task.taskUrl;
        const url = document.createElement('span'); url.textContent = task.taskUrl;
        option.append(title, url);
        option.addEventListener('click', () => { selected = task; search.value = task.title || task.taskUrl; update(); search.focus(); });
        suggestions.append(option);
      }
    }
    search.setAttribute('aria-expanded', String(suggestions.childElementCount > 0));
    preview.replaceChildren();
    const task = taskIdentity();
    if (task) {
      const title = document.createElement('strong'); title.textContent = task.title || 'New URL task';
      const url = document.createElement('span'); url.textContent = task.taskUrl;
      preview.append(title, url);
    } else preview.textContent = 'Select a task to preview it here.';
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
  dialog.addEventListener('close', () => { generation++; button.focus(); });
  button.addEventListener('click', () => {
    generation++;
    const now = new Date();
    tasks = []; selected = null; searched = false; busy = false; search.value = '';
    start.value = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    end.value = ''; description.value = '';
    setError('');
    update(); dialog.showModal(); search.focus();
  });
  add.addEventListener('click', async () => {
    if (busy) return;
    const task = taskIdentity();
    if (!task) { setError('Select a task or enter an HTTP(S) URL.'); return; }
    if (end.value && !start.value) { setError('Enter a start time before an end time.'); return; }
    const today = dateValue(new Date());
    const timestamp = value => value ? new Date(`${today}T${value}:00`).toISOString() : null;
    const startedAt = timestamp(start.value), endedAt = timestamp(end.value);
    if (startedAt && endedAt && endedAt <= startedAt) { setError('End time must be after start time.'); return; }
    // Only the short local IndexedDB acceptance is in flight. Never show a
    // GitHub saving status: the shared 15-second sync happens silently later.
    busy = true; add.disabled = true; cancel.disabled = true; setError('');
    try {
      const result = await send({ type: 'ADD_TIME', taskUrl: task.taskUrl, taskTitle: task.title || '',
        ...(!/^https?:\/\//i.test(task.taskUrl) ? { destinationId: task.destinationId } : {}),
        startedAt, endedAt, description: description.value.trim() });
      dialog.close(); await onAdded(result);
    } catch (cause) { setError(cause.message || 'Could not add time.'); }
    finally {
      busy = false; add.disabled = false; cancel.disabled = false;
    }
  });
  return dialog;
}
