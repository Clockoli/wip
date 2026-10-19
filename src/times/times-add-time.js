import { mountAddTime } from '../ui/add-time.js';

function send(message) {
  return new Promise((resolve, reject) => chrome.runtime.sendMessage(message, response => {
    if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
    if (!response?.ok) return reject(new Error(response?.error?.message || 'Extension request failed'));
    resolve(response.data);
  }));
}

mountAddTime(document.getElementById('add-time-button'), {
  send,
  onAdded: result => {
    // The background worker already committed to IndexedDB; notify Activity
    // directly, without a page reload or waiting for a GitHub history read.
    document.dispatchEvent(new CustomEvent('clockoli:local-time-added', { detail: result }));
  },
});
