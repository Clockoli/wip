import { normalizeTaskUrl, normalizeStoredTaskIdentity, parseGitHubProjectPaneIssueUrl } from '../domain/values.js';

const root = document.getElementById('quick-popup');
let state = { configured: null, active: null, recent: [], pendingWrites: [] };
let currentPage = null;
let message = '';
let busy = false;
let loadVersion = 0;
let setupOpened = false;
let descriptionDraft = null;
let descriptionSaving = null;
let descriptionStatus = '';
let rendering = false;

function el(tag, text, className) {
  const element = document.createElement(tag);
  if (text != null) element.textContent = text;
  if (className) element.className = className;
  return element;
}
function button(text, className, onClick) {
  const node = el('button', text, className);
  node.type = 'button';
  node.addEventListener('click', () => { void onClick(); });
  return node;
}
function send(request) {
  return new Promise((resolve, reject) => chrome.runtime.sendMessage(request, response => {
    if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
    if (!response?.ok) return reject(new Error(response?.error?.message || 'Clockoli request failed.'));
    resolve(response.data);
  }));
}
function identity(record) {
  try { return normalizeStoredTaskIdentity(record?.taskUrl || record?.issueUrl || record?.issue?.url); }
  catch { return null; }
}
function title(record) {
  return String(record?.taskTitle || record?.issueTitle || identity(record) || 'Untitled task').trim();
}
function descriptionFor(record) {
  const url = identity(record);
  if (!url) return '';
  if (!url.startsWith('http')) return 'Imported task';
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'github.com' && parsed.pathname.split('/').length >= 3)
      return parsed.pathname.split('/').slice(1, 3).join('/');
    return parsed.hostname;
  } catch { return ''; }
}
function elapsed(startedAt) {
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(startedAt)) / 1000)) || 0;
  const hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds % 3600 / 60);
  return [hours, minutes, seconds % 60].map(value => String(value).padStart(2, '0')).join(':');
}
function duration(entry) {
  const minutes = Math.max(0, Math.round(Number(entry.durationSeconds) / 60) || 0);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}
function taskLabel(record, className) {
  const url = identity(record);
  let navigable = false;
  try { if (url) { normalizeTaskUrl(url); navigable = true; } } catch { /* imported task */ }
  const node = el(navigable ? 'a' : 'span', title(record), className);
  if (navigable) { node.href = url; node.target = '_blank'; node.rel = 'noreferrer'; }
  node.title = title(record);
  return node;
}
function activeKey(active) {
  return active ? `${active.id || ''}:${active.startedAt || ''}:${identity(active) || ''}` : '';
}
function normalizedDescription(value) {
  return String(value || '').replace(/\r\n?/g, '\n').replace(/\t/g, ' ')
    .replace(/ {2,}/g, ' ').trim().slice(0, 2000);
}
function draftDescription(active = state.active) {
  return descriptionDraft?.key === activeKey(active)
    ? normalizedDescription(descriptionDraft.value) : normalizedDescription(active?.description);
}
function updateDescriptionControls() {
  const save = root.querySelector('.quick-description-save');
  const status = root.querySelector('.quick-description-status');
  if (!save || !status) return;
  const dirty = draftDescription() !== normalizedDescription(state.active?.description);
  save.hidden = !dirty && !descriptionSaving;
  save.disabled = Boolean(descriptionSaving) || busy || !dirty;
  status.textContent = descriptionSaving ? 'Saving…' : descriptionStatus;
  status.parentElement.hidden = save.hidden && !status.textContent;
}
function saveDescription() {
  if (descriptionSaving) return descriptionSaving;
  const active = state.active;
  const key = activeKey(active);
  if (!active || busy || !descriptionDraft || descriptionDraft.key !== key
      || draftDescription(active) === normalizedDescription(active.description)) return Promise.resolve();
  descriptionStatus = '';
  descriptionSaving = (async () => {
    // A later keystroke while saving must not be lost.
    while (state.active && activeKey(state.active) === key) {
      const description = draftDescription();
      if (description === normalizedDescription(state.active.description)) break;
      await send({ type: 'QUEUE_ACTIVE_START_EDIT', payload: {
        original: { id: state.active.id, startedAt: state.active.startedAt }, description,
      } });
      if (activeKey(state.active) !== key) break;
      state.active = { ...state.active, description };
    }
    descriptionStatus = 'Saved';
  })().catch(error => {
    message = error?.message || 'Could not save description.';
  }).finally(() => {
    descriptionSaving = null;
    updateDescriptionControls();
    if (message) render();
  });
  updateDescriptionControls();
  return descriptionSaving;
}
function blocked() {
  return busy || state.pendingWrites?.some(write => write.status === 'conflict');
}
async function readCurrentPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    const url = parseGitHubProjectPaneIssueUrl(tab?.url) || tab?.url;
    return { taskUrl: normalizeTaskUrl(url), taskTitle: String(tab?.title || '').trim().slice(0, 300) };
  } catch { return null; }
}
function applyState(data, { replaceRecent = true } = {}) {
  if (!data) return;
  state = {
    ...state, ...data,
    recent: replaceRecent && Array.isArray(data.recent) ? data.recent : state.recent,
    pendingWrites: data.pendingWrites || state.pendingWrites || [],
  };
}
function render() {
  const oldDescription = root.querySelector('.quick-description');
  const refocusDescription = document.activeElement === oldDescription;
  const selection = refocusDescription ? [oldDescription.selectionStart, oldDescription.selectionEnd] : null;
  rendering = true;
  root.replaceChildren();

  const header = el('header', null, 'quick-header');
  const logo = el('img', null, 'quick-logo');
  logo.src = chrome.runtime.getURL('src/assets/clockoli-with-text.svg');
  logo.alt = 'Clockoli';
  header.append(logo);
  root.append(header);

  if (state.configured === null) {
    root.append(el('p', 'Loading tracker…', 'quick-muted'));
  } else if (!state.configured) {
    root.append(el('div', 'Connect a time repository to start tracking.', 'quick-muted'),
      button('Set up Clockoli', 'quick-button quick-button-primary quick-button-wide', () => send({ type: 'OPEN_OPTIONS' }).catch(showError)));
  } else {
    const active = state.active;
    const card = el('section', null, 'quick-card');
    if (active) {
      const summary = el('div', null, 'quick-active-summary');
      const copy = el('div', null, 'quick-current-name');
      copy.append(taskLabel(active, 'quick-title'), el('div', descriptionFor(active), 'quick-subtitle'));
      const time = el('span', elapsed(active.startedAt), 'quick-elapsed');
      time.setAttribute('role', 'timer');
      time.setAttribute('aria-label', 'Elapsed time');
      summary.append(copy, time);
      card.append(summary);

      const key = activeKey(active);
      if (descriptionDraft?.key !== key) {
        descriptionDraft = { key, value: active.description || '' };
        descriptionStatus = '';
      }
      const descriptionWrap = el('div', null, 'quick-description-wrap');
      const description = el('textarea', null, 'quick-description');
      description.rows = 2;
      description.maxLength = 2000;
      description.placeholder = 'Add description…';
      description.setAttribute('aria-label', 'Description');
      description.value = descriptionDraft.value;
      description.addEventListener('input', () => {
        if (descriptionDraft?.key !== key) return;
        descriptionDraft.value = description.value;
        descriptionStatus = '';
        updateDescriptionControls();
      });
      description.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
          event.preventDefault();
          void saveDescription();
        }
      });
      description.addEventListener('blur', () => {
        if (!rendering) void saveDescription();
      });
      const descriptionActions = el('div', null, 'quick-description-actions');
      const descriptionFeedback = el('span', null, 'quick-description-status');
      descriptionFeedback.setAttribute('role', 'status');
      descriptionFeedback.setAttribute('aria-live', 'polite');
      const descriptionSave = button('Save', 'quick-button quick-description-save', () => saveDescription());
      descriptionSave.addEventListener('mousedown', event => event.preventDefault());
      descriptionActions.append(descriptionFeedback, descriptionSave);
      descriptionWrap.append(description, descriptionActions);
      card.append(descriptionWrap);
      const stop = button(busy ? 'Saving…' : 'Stop and save', 'quick-button quick-button-primary quick-button-wide', async () => {
        await mutate({ type: 'STOP', description: draftDescription() }, 'stop');
      });
      stop.disabled = blocked();
      card.append(stop);
      if (currentPage?.taskUrl && currentPage.taskUrl !== identity(active)) {
        const switchToPage = button('Switch to this page', 'quick-button quick-switch', async () => {
          const page = await readCurrentPage();
          if (page) await mutate({ type: 'SWITCH_TASK', ...page, description: draftDescription() }, 'switch');
        });
        switchToPage.disabled = blocked();
        card.append(switchToPage);
      }
    } else {
      if (currentPage) {
        const copy = el('div', null, 'quick-current-name');
        copy.append(taskLabel(currentPage, 'quick-title'), el('div', descriptionFor(currentPage), 'quick-subtitle'));
        card.append(copy);
      } else card.append(el('p', 'Open a webpage to start tracking, or choose a recent task below.', 'quick-muted'));
      const start = button(busy ? 'Starting…' : 'Start tracking this page', 'quick-button quick-button-primary quick-button-wide', async () => {
        const page = await readCurrentPage();
        if (page) await mutate({ type: 'START', ...page }, 'start');
      });
      start.disabled = blocked() || !currentPage;
      card.append(start);
    }
    root.append(card);
    updateDescriptionControls();

    const section = el('section');
    section.append(el('div', 'Recent entries', 'quick-section-heading'));
    const list = el('div', null, 'quick-recent');
    const entries = [...state.recent].filter(entry => entry?.endedAt)
      .sort((a, b) => Date.parse(b.endedAt) - Date.parse(a.endedAt)).slice(0, 4);
    if (!entries.length) list.append(el('p', 'No recent entries yet.', 'quick-muted'));
    for (const entry of entries) {
      const row = el('div', null, 'quick-entry');
      const copy = el('div', null, 'quick-entry-copy');
      copy.append(taskLabel(entry, 'quick-entry-title'), el('div', descriptionFor(entry), 'quick-subtitle'));
      const play = button('▶', 'quick-play', () => mutate({
        type: 'SWITCH_TASK', timelineTask: true,
        taskUrl: identity(entry), taskTitle: title(entry),
        ...(state.active ? { description: draftDescription() } : {}),
        ...(!identity(entry)?.startsWith('http') && entry.destinationId ? { destinationId: entry.destinationId } : {}),
        ...(entry.id && entry.destinationId && entry.entryDate
          ? { sourceEntry: { id: entry.id, destinationId: entry.destinationId, entryDate: entry.entryDate } } : {}),
      }, 'switch'));
      play.setAttribute('aria-label', `Track again: ${title(entry)}`);
      play.title = 'Track again';
      play.disabled = blocked() || !identity(entry) || identity(entry) === identity(active);
      row.append(copy, el('span', duration(entry), 'quick-entry-duration'), play);
      list.append(row);
    }
    section.append(list);
    root.append(section);
  }

  if (message) {
    const notice = el('div', message, 'quick-error');
    notice.setAttribute('role', 'alert');
    root.append(notice);
  }
  const footer = el('footer', null, 'quick-footer');
  footer.append(button('Open Activity in a new tab ↗', 'quick-button', () => send({ type: 'OPEN_TIMES' }).catch(showError)));
  root.append(footer);
  rendering = false;
  if (refocusDescription && selection && state.active) {
    const field = root.querySelector('.quick-description');
    if (field) {
      field.focus({ preventScroll: true });
      field.setSelectionRange(...selection);
    }
  }
}
function showError(error) {
  message = error?.message || String(error);
  render();
}
async function loadCached() {
  const version = ++loadVersion;
  const result = await send({ type: 'GET_PAGE_STATE', refresh: false });
  if (version !== loadVersion || busy) return;
  applyState(result);
  render();
  if (!state.configured && !setupOpened) {
    setupOpened = true;
    void send({ type: 'OPEN_OPTIONS' }).catch(showError);
  }
}
async function loadRecent() {
  const version = loadVersion;
  try {
    const result = await send({ type: 'LOAD_RECENT', menuData: true });
    if (version !== loadVersion || busy) return;
    if (result?.configured) {
      applyState(result);
      render();
    }
  } catch (error) {
    // Local cached entries remain usable when GitHub cannot be reached.
    if (version === loadVersion && !state.recent.length) showError(error);
  }
}
async function mutate(request, kind) {
  if (blocked()) return;
  busy = true;
  ++loadVersion; // Discard stale background reads after a local write.
  message = '';
  render();
  try {
    const result = await send(request);
    if (kind === 'start') state.active = result;
    else if (kind === 'switch') state.active = result?.active || null;
    else if (kind === 'stop') {
      state.active = null;
      descriptionDraft = null;
      descriptionStatus = '';
      if (result?.entry) state.recent = [{ ...result.entry, destinationId: result.destinationId }, ...state.recent];
    }
    render();
    const fresh = await send({ type: 'GET_PAGE_STATE', refresh: false });
    applyState(fresh);
  } catch (error) {
    message = error?.message || String(error);
    try { applyState(await send({ type: 'GET_PAGE_STATE', refresh: false })); } catch { /* show the original failure */ }
  } finally {
    busy = false;
    render();
    void loadRecent();
  }
}

async function init() {
  try {
    currentPage = await readCurrentPage();
    render();
    await loadCached();
    void loadRecent();
  } catch (error) { showError(error); }
}
setInterval(() => {
  const timer = root.querySelector('.quick-elapsed');
  if (timer && state.active && !document.hidden) timer.textContent = elapsed(state.active.startedAt);
}, 1000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !busy) void loadCached().catch(showError);
});
void init();
