function applyWidth(width) {
  document.documentElement.dataset.clockoliWidth = width === 'full' ? 'full' : 'contained';
}

async function refreshWidth() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_LOCAL_PREFERENCES' });
    if (response?.ok) applyWidth(response.data?.interfaceWidth);
  } catch { /* Retain the contained layout while the service worker is unavailable. */ }
}

chrome.runtime.onMessage.addListener(message => {
  if (message?.type === 'LOCAL_PREFERENCES_CHANGED') void refreshWidth();
});

void refreshWidth();
