import { parseIssueReference, parseIssueUrl } from '../domain/values.js';
import { popupControlState } from './view-state.js';

const $ = id => document.getElementById(id);
let state = null;
let editing = null;
let tick = null;
let currentIssue = null;

function send(message) {
  return new Promise((resolve, reject) => chrome.runtime.sendMessage(message, response => {
    if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
    if (!response?.ok) return reject(Object.assign(new Error(response?.error?.message || 'Extension request failed'), response?.error));
    resolve(response.data);
  }));
}
function show(id, visible) { $(id).hidden = !visible; }
function setError(error = '') { $('error').textContent = error?.message || String(error || ''); }
function elapsed(startedAt) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
  return [Math.floor(seconds / 3600), Math.floor(seconds % 3600 / 60), seconds % 60].map(v => String(v).padStart(2, '0')).join(':');
}
function duration(seconds) {
  const minutes = Math.round(seconds / 60), hours = Math.floor(minutes / 60), rest = minutes % 60;
  return hours ? `${hours}h ${rest}m` : `${rest}m`;
}
function localInput(iso) {
  const date = new Date(iso), pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
function issueLabel(issue) { return `${issue.owner}/${issue.repo}#${issue.number}`; }
function button(text, handler) { const node = document.createElement('button'); node.textContent = text; node.className = 'link'; node.addEventListener('click', handler); return node; }

function renderRecent(entries) {
  const root = $('recent'); root.replaceChildren();
  if (!entries.length) { const empty = document.createElement('div'); empty.className = 'muted'; empty.textContent = 'No entries in the configured window.'; root.append(empty); return; }
  for (const entry of entries) {
    const card = document.createElement('article'); card.className = 'entry';
    const row = document.createElement('div'); row.className = 'entry-row';
    const text = document.createElement('div');
    const link = document.createElement('a'); link.href = entry.issue.url; link.target = '_blank'; link.rel = 'noreferrer'; link.textContent = issueLabel(entry.issue);
    const meta = document.createElement('div'); meta.className = 'entry-meta';
    const start = new Date(entry.startedAt), end = new Date(entry.endedAt);
    meta.textContent = `${start.toLocaleDateString()} ${start.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}–${end.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})} · ${duration(entry.durationSeconds)}`;
    text.append(link, meta);
    const edit = button(entry._pending ? 'Pending' : 'Edit', () => openEditor(entry));
    edit.disabled = Boolean(entry._pending);
    row.append(text, edit);
    card.append(row);
    if (entry.description) { const desc = document.createElement('div'); desc.className = 'entry-description'; desc.textContent = entry.description; card.append(desc); }
    root.append(card);
  }
}


function renderConflicts(pending) {
  const root = $('conflicts'); root.replaceChildren();
  const conflicts = pending.filter(item => item.status === 'conflict');
  show('conflicts', conflicts.length > 0);
  for (const item of conflicts) {
    const activeConflict = item.stage === 'clearActive';
    const title = document.createElement('strong'); title.textContent = activeConflict ? 'Newer GitHub timer preserved' : 'Entry path conflict';
    const detail = document.createElement('p'); detail.className = 'muted'; detail.textContent = item.lastError || (activeConflict ? 'The active timer changed on another device.' : 'Repair or remove the conflicting entry in GitHub, then retry.');
    const acknowledge = document.createElement('button'); acknowledge.className = 'primary'; acknowledge.textContent = activeConflict ? 'Keep newer timer' : 'Retry entry sync';
    acknowledge.addEventListener('click', async () => { try { await send({ type: 'RESOLVE_PENDING', id: item.id }); await load(true); } catch (error) { setError(error); } });
    root.append(title, detail, acknowledge);
  }
}

function render() {
  show('setup', !state?.configured);
  show('active', Boolean(state?.configured && state.active));
  show('idle', Boolean(state?.configured && !state.active));
  show('recent-section', Boolean(state?.configured && !editing));
  show('editor', Boolean(editing));
  const pending = state?.pendingWrites || [];
  const controls = popupControlState(state, currentIssue);
  renderConflicts(pending);
  $('sync-status').textContent = pending.length ? `${pending.length} pending${pending.some(x => x.status === 'conflict') ? ' · action required' : ''}` : 'Synced';
  clearInterval(tick);
  if (state?.active) {
    const active = state.active;
    $('active-issue').textContent = issueLabel(active.issue); $('active-issue').href = active.issue.url;
    $('active-title').textContent = active.issueTitle || '';
    $('stop-description').value = active.description || '';
    const update = () => { $('elapsed').textContent = elapsed(active.startedAt); }; update(); tick = setInterval(update, 1000);
  }
  $('stop').disabled = controls.stopDisabled;
  renderRecent(state?.recent || []);
  $('start-current').disabled = controls.startDisabled;
  $('current-hint').textContent = currentIssue ? issueLabel(currentIssue) : 'Open a GitHub issue tab first.';
}

async function load(refresh = false) {
  setError(); state = await send({ type: 'GET_STATE', refresh });
  if (state.configured && (!state.recent || !state.recent.length)) state.recent = await send({ type: 'LOAD_RECENT' });
  render();
}

function openEditor(entry) {
  editing = entry;
  $('edit-issue').value = issueLabel(entry.issue);
  $('edit-start').value = localInput(entry.startedAt);
  $('edit-end').value = localInput(entry.endedAt);
  $('edit-description').value = entry.description || '';
  render();
}

$('settings').addEventListener('click', () => send({ type: 'OPEN_OPTIONS' }));
$('setup-button').addEventListener('click', () => send({ type: 'OPEN_OPTIONS' }));
$('refresh').addEventListener('click', async () => { try { setError(); await send({ type:'SYNC' }); const recent = await send({ type:'LOAD_RECENT' }); state.recent = recent; state = { ...state, ...(await send({ type:'GET_STATE', refresh:true })) }; render(); } catch (e) { setError(e); } });
$('start-current').addEventListener('click', async event => { try { event.currentTarget.disabled = true; await send({ type:'START', issue:currentIssue }); await load(true); } catch (e) { setError(e); render(); } });
$('stop').addEventListener('click', async event => {
  try {
    const hours = (Date.now() - new Date(state.active.startedAt).getTime()) / 3600000;
    if (hours > 12 && !confirm(`This entry is ${Math.floor(hours)} hours long. Save anyway?`)) return;
    event.currentTarget.disabled = true;
    const result = await send({ type:'STOP', description:$('stop-description').value });
    await load(false); if (result.pending) setError('GitHub is temporarily unreachable. The entry is saved locally and will be retried.');
  } catch (e) { setError(e); event.currentTarget.disabled = false; }
});
$('close-editor').addEventListener('click', () => { editing = null; render(); });
$('edit-form').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const issue = parseIssueReference($('edit-issue').value);
    const startedAt = new Date($('edit-start').value).toISOString();
    const endedAt = new Date($('edit-end').value).toISOString();
    await send({ type:'EDIT_ENTRY', payload:{ path:editing._path, originalSha:editing._sha, edits:{ issue, startedAt, endedAt, description:$('edit-description').value } } });
    editing = null; await load(false);
  } catch (e) { setError(e); }
});
$('delete').addEventListener('click', async () => {
  if (!confirm(`Delete this ${duration(editing.durationSeconds)} entry?\n\nThe previous version remains in Git history.`)) return;
  try { await send({ type:'DELETE_ENTRY', payload:{ path:editing._path, originalSha:editing._sha } }); editing = null; await load(false); } catch (e) { setError(e); }
});

chrome.tabs.query({ active:true, currentWindow:true }).then(([tab]) => { currentIssue = parseIssueUrl(tab?.url || ''); render(); }).catch(() => {});
load(true).catch(setError);
