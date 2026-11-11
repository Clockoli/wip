// The Activity navigation badge reads only the worker's durable, page-safe projection.
// It does not depend on any page's report/timeline loading lifecycle.
const activityTab = document.querySelector('.page-tab[href="../times/times.html"]');

if (activityTab && globalThis.chrome?.runtime?.sendMessage) {
  let requestVersion = 0;
  let badge = null;

  function render(pending, conflicts) {
    if (!conflicts) {
      badge?.remove();
      badge = null;
      activityTab.removeAttribute('aria-label');
      return;
    }
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'pending-navigation-badge';
      badge.setAttribute('role', 'status');
      badge.setAttribute('aria-live', 'polite');
      activityTab.append(badge);
    }
    const detail = `${pending} pending ${pending === 1 ? 'operation' : 'operations'}`
      + (conflicts ? `, ${conflicts} ${conflicts === 1 ? 'conflict needs' : 'conflicts need'} review` : '');
    badge.textContent = `${pending}${conflicts ? ' !' : ''}`;
    badge.setAttribute('aria-label', detail);
    badge.classList.toggle('has-conflict', conflicts > 0);
    activityTab.setAttribute('aria-label', `Activity, ${detail}`);
  }

  async function refresh() {
    if (document.hidden) return;
    const version = ++requestVersion;
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_STATE' });
      if (version !== requestVersion || document.hidden || !response?.ok
          || !Array.isArray(response.data?.pendingWrites)) return;
      const writes = response.data.pendingWrites;
      render(writes.length, writes.filter(write => write?.status === 'conflict').length);
    } catch {
      // A suspended/restarting worker is not evidence that queued work disappeared.
      // Keep the last known badge and try again on visibility or the next poll.
    }
  }

  document.addEventListener('visibilitychange', refresh);
  window.addEventListener('focus', refresh);
  window.setInterval(refresh, 5000);
  refresh();
}
