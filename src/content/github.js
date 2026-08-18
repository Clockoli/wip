(() => {
  const ROOT_ID = 'github-private-time-tracker-root';
  let lastRoute = null;
  let tick = null;
  let panelRoot = null;
  let panelShadow = null;

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
      if (!response?.ok) return reject(new Error(response?.error?.message || 'Extension request failed'));
      resolve(response.data);
    }));
  }

  function el(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function formatElapsed(startedAt) {
    const seconds = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
    const h = String(Math.floor(seconds / 3600)).padStart(2, '0');
    const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
    const s = String(seconds % 60).padStart(2, '0');
    return `${h}:${m}:${s}`;
  }

  function titleFromPage() {
    const node = document.querySelector('[data-testid="issue-title"], .js-issue-title, bdi.js-issue-title');
    return (node?.textContent || '').trim().slice(0, 300);
  }

  async function render(refresh = false) {
    const issue = issueFromLocation();
    const old = document.getElementById(ROOT_ID);
    clearInterval(tick); tick = null;
    if (!issue) { old?.remove(); panelRoot = null; panelShadow = null; return; }
    if (!panelRoot || old !== panelRoot || !panelRoot.isConnected) {
      old?.remove();
      panelRoot = el('div'); panelRoot.id = ROOT_ID;
      panelShadow = panelRoot.attachShadow({ mode: 'closed' });
      document.documentElement.append(panelRoot);
    }
    const shadow = panelShadow;
    shadow.replaceChildren();
    const style = el('style', `
      :host { all: initial } .card { position:fixed; right:20px; bottom:20px; z-index:2147483647; width:260px; padding:14px; border:1px solid #d0d7de; border-radius:10px; background:#fff; color:#1f2328; box-shadow:0 8px 28px rgba(31,35,40,.18); font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif }
      .title { font-weight:600; margin-bottom:8px } .muted { color:#636c76; font-size:12px; margin:6px 0 } .time { font:600 24px ui-monospace,SFMono-Regular,monospace; margin:8px 0 }
      button,a { box-sizing:border-box; display:inline-block; border:1px solid rgba(31,35,40,.15); border-radius:6px; padding:6px 12px; background:#f6f8fa; color:#1f2328; text-decoration:none; font:600 13px inherit; cursor:pointer } button.primary { width:100%; background:#1f883d; color:#fff } button.stop { width:100%; background:#cf222e; color:#fff } .error { color:#cf222e; margin-top:8px; white-space:pre-wrap }
    `);
    const card = el('section', undefined, 'card');
    const status = el('div', '', 'error');
    shadow.append(style, card);
    try {
      const state = await send({ type: 'GET_PAGE_STATE', refresh });
      card.append(el('div', 'Private Time Tracker', 'title'));
      if (!state.configured) {
        card.append(el('div', 'Set up your private time-data repository.', 'muted'));
        const setup = el('button', 'Open Settings', 'primary');
        setup.addEventListener('click', event => { if (!event.isTrusted) return; send({ type: 'OPEN_OPTIONS' }); });
        card.append(setup);
      } else if (!state.active) {
        card.append(el('div', `${issue.owner}/${issue.repo}#${issue.number}`, 'muted'));
        const start = el('button', '▶ Start timer', 'primary');
        start.addEventListener('click', async event => {
          if (!event.isTrusted) return;
          start.disabled = true;
          try { await send({ type: 'START', issue, issueTitle: titleFromPage() }); await render(false); }
          catch (error) { status.textContent = error.message; start.disabled = false; }
        });
        card.append(start);
      } else {
        const active = state.active;
        const same = active.issue.type === issue.type && active.issue.owner === issue.owner && active.issue.repo === issue.repo && active.issue.number === issue.number;
        const itemLabel = active.issue.type === 'pull_request' ? 'pull request' : 'issue';
        card.append(el('div', same ? `Timer running on this ${itemLabel}` : `Timer running on another ${itemLabel}`, 'muted'));
        card.append(el('div', `${active.issue.owner}/${active.issue.repo}#${active.issue.number}`, 'title'));
        const time = el('div', formatElapsed(active.startedAt), 'time'); card.append(time);
        clearInterval(tick); tick = setInterval(() => { time.textContent = formatElapsed(active.startedAt); }, 1000);
        if (!same) { const link = el('a', `Go to ${itemLabel}`); link.href = active.issue.url; card.append(link, document.createTextNode(' ')); }
        const stop = el('button', '■ Stop', 'stop');
        stop.addEventListener('click', async event => {
          if (!event.isTrusted) return;
          const hours = (Date.now() - new Date(active.startedAt).getTime()) / 3600000;
          if (hours > 12 && !confirm(`This entry is ${Math.floor(hours)} hours long. Save anyway?`)) return;
          const description = prompt('Description (optional)', active.description || '');
          if (description === null) return;
          stop.disabled = true;
          try { const result = await send({ type: 'STOP', description }); if (result.pending) alert('Saved locally. The entry is waiting to sync with GitHub.'); await render(false); }
          catch (error) { status.textContent = error.message; stop.disabled = false; }
        });
        card.append(stop);
      }
      if (state.pendingCount) card.append(el('div', `${state.pendingCount} entry waiting to sync`, 'muted'));
    } catch (error) { status.textContent = error.message; card.append(el('div', 'Private Time Tracker', 'title')); }
    card.append(status);
  }

  function navigationCheck() {
    const route = issueFromLocation()?.url ?? '';
    if (route !== lastRoute) {
      const firstRender = lastRoute === null;
      lastRoute = route;
      render(firstRender);
    }
  }
  navigationCheck();
  setInterval(navigationCheck, 750);
})();
