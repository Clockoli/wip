import { mountAddTime } from '../ui/add-time.js';

function send(message) {
  return new Promise((resolve, reject) => chrome.runtime.sendMessage(message, response => {
    if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
    if (!response?.ok) return reject(new Error(response?.error?.message || 'Extension request failed'));
    resolve(response.data);
  }));
}

mountAddTime(document.getElementById('add-time-button'), { send });
