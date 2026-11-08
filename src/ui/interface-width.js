// The service worker owns the Interface width setting, but its answer arrives after the
// first paint. A page-local copy of the presentation value ("full" or "contained", no work
// data) lets every page open at its final width instead of widening once the worker replies.
(() => {
  const CACHE_KEY = 'clockoli-interface-width';
  const root = document.documentElement;

  function applyWidth(width) {
    root.dataset.clockoliWidth = width === 'full' ? 'full' : 'contained';
  }

  async function refreshWidth() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_LOCAL_PREFERENCES' });
      if (response?.ok) applyWidth(response.data?.interfaceWidth);
    } catch { /* Retain the cached layout while the service worker is unavailable. */ }
  }

  applyWidth(localStorage.getItem(CACHE_KEY));
  // Settings also sets the attribute directly, so cache every change, whatever its source.
  new MutationObserver(() => localStorage.setItem(CACHE_KEY, root.dataset.clockoliWidth))
    .observe(root, { attributes: true, attributeFilter: ['data-clockoli-width'] });
  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === 'LOCAL_PREFERENCES_CHANGED') void refreshWidth();
  });
  void refreshWidth();
})();
