// Shared, presentation-only tracking card for extension pages and content-script panels.
// Data loading and mutation handlers stay with each surface.
(() => {
  function createTrackingCard(document, { root, task, description, elapsed, today, stop }) {
    const live = document.createElement('span');
    live.className = 'running-status-live';
    live.textContent = 'Tracking now';
    const metrics = document.createElement('div');
    metrics.className = 'running-status-metrics';
    metrics.append(elapsed, ...(today ? [today] : []));
    root.classList.add('tracking-card');
    root.append(live, task, ...(description ? [description] : []), metrics, stop);
    return { live, metrics };
  }

  globalThis.ClockoliTrackingCard = { createTrackingCard };
})();
