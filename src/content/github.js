(() => {
  const ROOT_ID = 'github-private-time-tracker-root';
  const STOPWATCH_PATH = 'M5.75.75A.75.75 0 0 1 6.5 0h3a.75.75 0 0 1 0 1.5h-.75v1l-.001.041a6.724 6.724 0 0 1 3.464 1.435l.007-.006.75-.75a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734l-.75.75-.006.007a6.75 6.75 0 1 1-10.548 0L2.72 5.03l-.75-.75a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018l.75.75.007.006A6.72 6.72 0 0 1 7.25 2.541V1.5H6.5a.75.75 0 0 1-.75-.75ZM8 14.5a5.25 5.25 0 1 0-.001-10.501A5.25 5.25 0 0 0 8 14.5Zm.389-6.7 1.33-1.33a.75.75 0 1 1 1.061 1.06L9.45 8.861A1.503 1.503 0 0 1 8 10.75a1.499 1.499 0 1 1 .389-2.95Z';
  const TRIANGLE_PATH = 'm4.427 7.427 3.396 3.396a.25.25 0 0 0 .354 0l3.396-3.396A.25.25 0 0 0 11.396 7H4.604a.25.25 0 0 0-.177.427Z';
  const SYNC_PATH = 'M1.705 8.005a.75.75 0 0 1 .834.656 5.5 5.5 0 0 0 9.592 2.97l-1.204-1.204a.25.25 0 0 1 .177-.427h3.646a.25.25 0 0 1 .25.25v3.646a.25.25 0 0 1-.427.177l-1.38-1.38A7.002 7.002 0 0 1 1.05 8.84a.75.75 0 0 1 .656-.834ZM8 2.5a5.487 5.487 0 0 0-4.131 1.869l1.204 1.204A.25.25 0 0 1 4.896 6H1.25A.25.25 0 0 1 1 5.75V2.104a.25.25 0 0 1 .427-.177l1.38 1.38A7.002 7.002 0 0 1 14.95 7.16a.75.75 0 0 1-1.49.178A5.5 5.5 0 0 0 8 2.5Z';
  const GEAR_PATH = 'M8 0a8.2 8.2 0 0 1 .701.031C9.444.095 9.99.645 10.16 1.29l.288 1.107c.018.066.079.158.212.224.231.114.454.243.668.386.123.082.233.09.299.071l1.103-.303c.644-.176 1.392.021 1.82.63.27.385.506.792.704 1.218.315.675.111 1.422-.364 1.891l-.814.806c-.049.048-.098.147-.088.294.016.257.016.515 0 .772-.01.147.038.246.088.294l.814.806c.475.469.679 1.216.364 1.891a7.977 7.977 0 0 1-.704 1.217c-.428.61-1.176.807-1.82.63l-1.102-.302c-.067-.019-.177-.011-.3.071a5.909 5.909 0 0 1-.668.386c-.133.066-.194.158-.211.224l-.29 1.106c-.168.646-.715 1.196-1.458 1.26a8.006 8.006 0 0 1-1.402 0c-.743-.064-1.289-.614-1.458-1.26l-.289-1.106c-.018-.066-.079-.158-.212-.224a5.738 5.738 0 0 1-.668-.386c-.123-.082-.233-.09-.299-.071l-1.103.303c-.644.176-1.392-.021-1.82-.63a8.12 8.12 0 0 1-.704-1.218c-.315-.675-.111-1.422.363-1.891l.815-.806c.05-.048.098-.147.088-.294a6.214 6.214 0 0 1 0-.772c.01-.147-.038-.246-.088-.294l-.815-.806C.635 6.045.431 5.298.746 4.623a7.92 7.92 0 0 1 .704-1.217c.428-.61 1.176-.807 1.82-.63l1.102.302c.067.019.177.011.3-.071.214-.143.437-.272.668-.386.133-.066.194-.158.211-.224l.29-1.106C6.009.645 6.556.095 7.299.03 7.53.01 7.764 0 8 0Zm3 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM9.5 8a1.5 1.5 0 1 0-3.001.001A1.5 1.5 0 0 0 9.5 8Z';
  let lastRoute = null;
  let tick = null;
  let root = null;
  let shadow = null;
  let menuOpen = false;
  let pageState = { configured: false, active: null, pendingCount: 0, pendingWrites: [] };
  let recent = [];
  let recentLoaded = false;
  let loadingRecent = false;
  let editing = null;
  let errorText = '';

  function issueFromLocation() {
    if (location.protocol !== 'https:' || location.hostname !== 'github.com') return null;
    const match = location.pathname.match(/^\/([^/]+)\/([^/]+)\/(issues|pull)\/([1-9]\d*)\/?$/);
    if (!match) return null;
    const type = match[3] === 'pull' ? 'pull_request' : 'issue';
    return { type, owner: match[1], repo: match[2], number: Number(match[4]), url: `https://github.com/${match[1]}/${match[2]}/${match[3]}/${match[4]}` };
  }

  function send(message) {
    return new Promise((resolve, reject) => chrome.runtime.sendMessage(message, response => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!response?.ok) return reject(Object.assign(new Error(response?.error?.message || 'Extension request failed'), response?.error));
      resolve(response.data);
    }));
  }

  function el(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function icon(name, path, size = 16) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16'); svg.setAttribute('width', String(size)); svg.setAttribute('height', String(size));
    svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', `octicon octicon-${name}`); svg.setAttribute('fill', 'currentColor');
    const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path'); shape.setAttribute('d', path); svg.append(shape); return svg;
  }

  function formatElapsed(startedAt) {
    const seconds = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
    return [Math.floor(seconds / 3600), Math.floor(seconds % 3600 / 60), seconds % 60].map(value => String(value).padStart(2, '0')).join(':');
  }

  function formatDuration(seconds) {
    const minutes = Math.round(seconds / 60), hours = Math.floor(minutes / 60), rest = minutes % 60;
    return hours ? `${hours}h ${rest}m` : `${rest}m`;
  }

  function localInput(iso) {
    const date = new Date(iso), pad = value => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  function issueLabel(issue) { return `${issue.owner}/${issue.repo}#${issue.number}`; }

  function titleFromPage() {
    const node = document.querySelector('[data-testid="issue-title"], .js-issue-title, bdi.js-issue-title');
    return (node?.textContent || '').trim().slice(0, 300);
  }

  function directChild(node, ancestor) {
    let current = node;
    while (current?.parentElement && current.parentElement !== ancestor) current = current.parentElement;
    return current?.parentElement === ancestor ? current : null;
  }

  function mountInHeader() {
    const actions = document.querySelector('.AppHeader-actions');
    const avatar = actions?.querySelector('img.avatar');
    const anchor = avatar && directChild(avatar, actions);
    if (!actions || !anchor) return false;
    if (!root) {
      root = el('div'); root.id = ROOT_ID;
      shadow = root.attachShadow({ mode: 'closed' });
    }
    if (root.parentElement !== actions || root.nextElementSibling !== anchor) actions.insertBefore(root, anchor);
    return true;
  }

  function button(text, className, handler) {
    const node = el('button', text, className);
    node.type = 'button';
    node.addEventListener('click', async event => {
      if (!event.isTrusted) return;
      await handler(event, node);
    });
    return node;
  }

  function setError(error = '') { errorText = error?.message || String(error || ''); renderUi(); }

  function closeMenu() { menuOpen = false; editing = null; errorText = ''; renderUi(); }

  async function refreshState(refresh = false, loadEntries = false) {
    pageState = await send({ type: 'GET_PAGE_STATE', refresh });
    if (loadEntries && pageState.configured) {
      loadingRecent = true; renderUi();
      try { recent = await send({ type: 'LOAD_RECENT' }); recentLoaded = true; }
      finally { loadingRecent = false; }
    }
    renderUi();
  }

  function renderEditor(container) {
    const header = el('div', undefined, 'section-head'); header.append(el('strong', 'Edit entry'));
    header.append(button('Cancel', 'link-button', async () => { editing = null; renderUi(); }));
    const form = el('form');
    const issueField = el('input'); issueField.required = true; issueField.value = issueLabel(editing.issue);
    const startField = el('input'); startField.type = 'datetime-local'; startField.step = '1'; startField.required = true; startField.value = localInput(editing.startedAt);
    const endField = el('input'); endField.type = 'datetime-local'; endField.step = '1'; endField.required = true; endField.value = localInput(editing.endedAt);
    const description = el('textarea'); description.maxLength = 2000; description.rows = 3; description.value = editing.description || '';
    for (const [labelText, field] of [['Issue or pull request', issueField], ['Start', startField], ['End', endField], ['Description', description]]) {
      const label = el('label', labelText); label.append(field); form.append(label);
    }
    const actions = el('div', undefined, 'form-actions');
    const remove = button('Delete', 'danger-outline', async (event, node) => {
      if (!confirm(`Delete this ${formatDuration(editing.durationSeconds)} entry?\n\nThe previous version remains in Git history.`)) return;
      node.disabled = true;
      try { await send({ type: 'DELETE_ENTRY', payload: { path: editing._path, originalSha: editing._sha } }); editing = null; recentLoaded = false; await refreshState(false, true); }
      catch (error) { node.disabled = false; setError(error); }
    });
    const save = el('button', 'Save', 'primary'); save.type = 'submit';
    actions.append(remove, save); form.append(actions);
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (!event.isTrusted) return;
      save.disabled = true;
      try {
        const match = issueField.value.trim().match(/^([^/# ]+)\/([^/# ]+)#([1-9]\d*)$/);
        if (!match) throw new Error('Use owner/repository#number.');
        const type = editing.issue.type;
        const segment = type === 'pull_request' ? 'pull' : 'issues';
        const issue = { type, owner: match[1], repo: match[2], number: Number(match[3]), url: `https://github.com/${match[1]}/${match[2]}/${segment}/${match[3]}` };
        await send({ type: 'EDIT_ENTRY', payload: { path: editing._path, originalSha: editing._sha, edits: { issue, startedAt: new Date(startField.value).toISOString(), endedAt: new Date(endField.value).toISOString(), description: description.value } } });
        editing = null; recentLoaded = false; await refreshState(false, true);
      } catch (error) { save.disabled = false; setError(error); }
    });
    container.append(header, form);
  }

  function renderRecent(container) {
    const header = el('div', undefined, 'section-head'); header.append(el('strong', 'Recent entries'));
    const refresh = button('', 'icon-button', async (event, node) => {
      node.disabled = true;
      try { await send({ type: 'SYNC' }); recentLoaded = false; await refreshState(true, true); }
      catch (error) { node.disabled = false; setError(error); }
    });
    refresh.title = 'Sync and refresh'; refresh.setAttribute('aria-label', 'Sync and refresh'); refresh.append(icon('sync', SYNC_PATH)); header.append(refresh); container.append(header);
    if (loadingRecent) { container.append(el('div', 'Loading recent entries…', 'muted')); return; }
    if (!recentLoaded) { container.append(el('div', 'Open the menu again to load entries.', 'muted')); return; }
    if (!recent.length) { container.append(el('div', 'No entries in the configured window.', 'muted')); return; }
    for (const entry of recent) {
      const row = el('article', undefined, 'entry');
      const top = el('div', undefined, 'entry-row');
      const copy = el('div', undefined, 'entry-copy');
      const link = el('a', `${entry.issue.repo}#${entry.issue.number}`); link.title = issueLabel(entry.issue); link.href = entry.issue.url; link.target = '_blank'; link.rel = 'noreferrer';
      const start = new Date(entry.startedAt), end = new Date(entry.endedAt);
      const meta = el('div', `${entry.issue.owner} · ${start.toLocaleDateString()} ${start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}–${end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${formatDuration(entry.durationSeconds)}`, 'muted');
      copy.append(link, meta);
      const edit = button(entry._pending ? 'Pending' : 'Edit', 'link-button', async () => { if (!entry._pending) { editing = entry; renderUi(); } }); edit.disabled = Boolean(entry._pending);
      top.append(copy, edit); row.append(top);
      if (entry.description) row.append(el('div', entry.description, 'entry-description'));
      container.append(row);
    }
  }

  function renderPendingConflicts(container) {
    const conflicts = (pageState.pendingWrites ?? []).filter(item => item.status === 'conflict');
    for (const item of conflicts) {
      const activeConflict = item.stage === 'clearActive';
      const box = el('div', undefined, 'conflict');
      box.append(el('strong', activeConflict ? 'Newer GitHub timer preserved' : 'Entry path conflict'));
      box.append(el('div', activeConflict ? 'The active timer changed on another device.' : 'Repair or remove the conflicting entry in GitHub, then retry.', 'muted'));
      box.append(button(activeConflict ? 'Keep newer timer' : 'Retry entry sync', 'secondary wide', async () => {
        await send({ type: 'RESOLVE_PENDING', id: item.id });
        recentLoaded = false;
        await refreshState(true, true);
      }));
      container.append(box);
    }
  }

  function renderMenu() {
    const menu = el('section', undefined, 'menu'); menu.setAttribute('role', 'dialog'); menu.setAttribute('aria-label', 'Time tracker');
    const header = el('header');
    const heading = el('div'); heading.append(el('strong', 'Time tracker'));
    const syncText = pageState.pendingCount ? `${pageState.pendingCount} waiting to sync` : 'Synced'; heading.append(el('div', syncText, 'muted'));
    const settings = button('', 'icon-button', async () => { await send({ type: 'OPEN_OPTIONS' }); closeMenu(); }); settings.title = 'Settings'; settings.setAttribute('aria-label', 'Time tracker settings'); settings.append(icon('gear', GEAR_PATH));
    header.append(heading, settings); menu.append(header);
    const body = el('div', undefined, 'menu-body');
    if (editing) renderEditor(body);
    else if (!pageState.configured) {
      body.append(el('p', 'Configure a private GitHub repository before tracking time.', 'muted'));
      body.append(button('Open Settings', 'primary wide', async () => { await send({ type: 'OPEN_OPTIONS' }); closeMenu(); }));
    } else {
      const current = issueFromLocation();
      if (pageState.active) {
        const active = pageState.active;
        const same = current && active.issue.type === current.type && active.issue.owner === current.owner && active.issue.repo === current.repo && active.issue.number === current.number;
        body.append(el('div', same ? 'Running on this item' : 'Running on another item', 'eyebrow'));
        const activeLink = el('a', issueLabel(active.issue), 'active-link'); activeLink.href = active.issue.url; body.append(activeLink);
        const elapsed = el('div', formatElapsed(active.startedAt), 'elapsed'); body.append(elapsed);
        clearInterval(tick); tick = setInterval(() => { elapsed.textContent = formatElapsed(active.startedAt); }, 1000);
        const label = el('label', 'Description'); const description = el('input'); description.maxLength = 2000; description.placeholder = 'Optional'; description.value = active.description || ''; label.append(description); body.append(label);
        body.append(button('Stop and save', 'danger wide', async (event, node) => {
          const hours = (Date.now() - new Date(active.startedAt).getTime()) / 3600000;
          if (hours > 12 && !confirm(`This entry is ${Math.floor(hours)} hours long. Save anyway?`)) return;
          node.disabled = true;
          try { const result = await send({ type: 'STOP', description: description.value }); recentLoaded = false; await refreshState(false, menuOpen); if (result.pending) setError('Saved locally and waiting to sync with GitHub.'); }
          catch (error) { node.disabled = false; setError(error); }
        }));
      } else {
        body.append(el('div', 'No timer running', 'eyebrow'));
        const startButton = button('Start timer on this item', 'primary wide', async (event, node) => {
          node.disabled = true;
          try { await send({ type: 'START', issue: current, issueTitle: titleFromPage() }); await refreshState(false, false); }
          catch (error) { node.disabled = false; setError(error); }
        });
        startButton.disabled = pageState.pendingCount > 0;
        body.append(startButton);
        body.append(el('div', pageState.pendingCount ? 'Sync or resolve the pending entry before starting.' : issueLabel(current), 'muted'));
      }
      if (pageState.pendingCount) body.append(button('Sync now', 'secondary wide', async (event, node) => {
        node.disabled = true;
        try { await send({ type: 'SYNC' }); recentLoaded = false; await refreshState(true, true); }
        catch (error) { node.disabled = false; setError(error); }
      }));
      renderPendingConflicts(body);
      const divider = el('div', undefined, 'divider'); body.append(divider); renderRecent(body);
    }
    if (errorText) body.prepend(el('div', errorText, 'error'));
    menu.append(body); return menu;
  }

  function renderUi() {
    if (!shadow || !root?.isConnected) return;
    clearInterval(tick); tick = null;
    shadow.replaceChildren();
    const style = el('style', `
      :host { all:initial; position:relative; display:inline-flex; align-items:center; font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; color:var(--fgColor-default,#1f2328); color-scheme:light dark }
      * { box-sizing:border-box } button,input,textarea { font:inherit } .trigger { display:inline-flex; align-items:center; justify-content:center; gap:3px; width:46px; height:32px; margin:0 8px 0 0; padding:0 6px; border:1px solid var(--borderColor-default,#d1d9e0); border-radius:6px; background:var(--button-default-bgColor-rest,#f6f8fa); color:var(--fgColor-muted,#59636e); cursor:pointer }
      .trigger:hover,.trigger[aria-expanded="true"] { background:var(--button-default-bgColor-hover,#eff2f5) } .trigger.running .octicon-stopwatch { color:var(--fgColor-open,#1f883d) } .trigger:focus-visible,button:focus-visible,a:focus-visible,input:focus-visible,textarea:focus-visible { outline:2px solid var(--focus-outlineColor,#0969da); outline-offset:2px }
      .menu { position:absolute; z-index:2147483647; top:calc(100% + 8px); right:8px; width:min(360px,calc(100vw - 24px)); max-height:calc(100vh - 76px); overflow:auto; border:1px solid var(--borderColor-default,#d1d9e0); border-radius:12px; background:var(--bgColor-default,#fff); color:var(--fgColor-default,#1f2328); box-shadow:0 8px 24px rgba(140,149,159,.22) }
      header,.section-head,.entry-row,.form-actions { display:flex; align-items:center; justify-content:space-between; gap:12px } header { padding:12px 16px; border-bottom:1px solid var(--borderColor-muted,#d8dee4) } .menu-body { padding:14px 16px } .muted { color:var(--fgColor-muted,#59636e); font-size:12px; margin-top:3px } .eyebrow { color:var(--fgColor-muted,#59636e); font-size:12px; font-weight:600; text-transform:uppercase; letter-spacing:.04em; margin-bottom:5px }
      a { color:var(--fgColor-accent,#0969da); font-weight:600; text-decoration:none } a:hover { text-decoration:underline } .active-link { display:inline-block } .elapsed { margin:8px 0 10px; font:600 28px ui-monospace,SFMono-Regular,monospace }
      button { border:1px solid var(--button-default-borderColor-rest,rgba(31,35,40,.15)); border-radius:6px; padding:7px 12px; background:var(--button-default-bgColor-rest,#f6f8fa); color:var(--button-default-fgColor-rest,#1f2328); font-weight:600; cursor:pointer } button:hover { background:var(--button-default-bgColor-hover,#eff2f5) } button:disabled { opacity:.55; cursor:default } .wide { width:100%; margin-top:10px } .primary { background:var(--button-primary-bgColor-rest,#1f883d); color:#fff } .primary:hover { background:var(--button-primary-bgColor-hover,#1a7f37) } .danger { background:#cf222e; border-color:rgba(27,31,36,.15); color:#fff } .danger:hover { background:#a40e26 } .danger-outline { color:var(--fgColor-danger,#cf222e) }
      .icon-button,.link-button { border:0; padding:5px; background:transparent; color:var(--fgColor-muted,#59636e) } .link-button { color:var(--fgColor-accent,#0969da) } .divider { height:1px; margin:16px -16px 12px; background:var(--borderColor-muted,#d8dee4) } .section-head { margin-bottom:7px }
      .entry { padding:10px 0; border-top:1px solid var(--borderColor-muted,#d8dee4) } .entry:first-of-type { border-top:0 } .entry-copy { flex:1; min-width:0 } .entry-copy a { overflow-wrap:anywhere } .entry-description { margin-top:4px; overflow-wrap:anywhere } label { display:block; margin:10px 0 4px; font-size:12px; font-weight:600 } input,textarea { display:block; width:100%; margin-top:4px; padding:7px 8px; border:1px solid var(--borderColor-default,#d1d9e0); border-radius:6px; background:var(--bgColor-default,#fff); color:var(--fgColor-default,#1f2328) } .form-actions { margin-top:12px } .error { margin-bottom:10px; color:var(--fgColor-danger,#cf222e); white-space:pre-wrap }
      @media (prefers-color-scheme:dark) { .trigger { background:#21262d; border-color:#30363d; color:#8b949e } .menu { background:#0d1117; color:#e6edf3; border-color:#30363d; box-shadow:0 8px 24px #010409 } input,textarea { background:#0d1117; color:#e6edf3; border-color:#30363d } }
    `);
    const trigger = el('button', undefined, `trigger${pageState.active ? ' running' : ''}`); trigger.type = 'button'; trigger.setAttribute('aria-label', pageState.active ? `Time tracker running: ${formatElapsed(pageState.active.startedAt)}` : 'Time tracker'); trigger.setAttribute('aria-haspopup', 'dialog'); trigger.setAttribute('aria-expanded', String(menuOpen)); trigger.title = pageState.active ? 'Time tracker is running' : 'Time tracker';
    trigger.append(icon('stopwatch', STOPWATCH_PATH), icon('triangle-down', TRIANGLE_PATH, 12));
    trigger.addEventListener('click', async event => {
      if (!event.isTrusted) return;
      menuOpen = !menuOpen; editing = null; errorText = ''; renderUi();
      if (menuOpen && pageState.configured && !recentLoaded) {
        loadingRecent = true; renderUi();
        try { recent = await send({ type: 'LOAD_RECENT' }); recentLoaded = true; }
        catch (error) { errorText = error.message; }
        finally { loadingRecent = false; renderUi(); }
      }
    });
    shadow.append(style, trigger);
    if (menuOpen) shadow.append(renderMenu());
  }

  async function render(refresh = false) {
    const issue = issueFromLocation();
    if (!issue) { root?.remove(); root = null; shadow = null; menuOpen = false; return; }
    if (!mountInHeader()) return;
    renderUi();
    try { pageState = await send({ type: 'GET_PAGE_STATE', refresh }); errorText = ''; }
    catch (error) { errorText = error.message; }
    renderUi();
  }

  function navigationCheck() {
    const route = issueFromLocation()?.url ?? '';
    if (route !== lastRoute) {
      const firstRender = lastRoute === null;
      lastRoute = route; recent = []; recentLoaded = false; editing = null; menuOpen = false;
      void render(firstRender);
    } else if (route && (!root?.isConnected || root.parentElement !== document.querySelector('.AppHeader-actions'))) void render(false);
  }

  document.addEventListener('click', event => {
    if (menuOpen && !event.composedPath().includes(root)) closeMenu();
  });
  document.addEventListener('keydown', event => { if (menuOpen && event.key === 'Escape') closeMenu(); });
  navigationCheck();
  setInterval(navigationCheck, 750);
})();
