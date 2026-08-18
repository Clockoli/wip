import { ChromeStore } from '../storage/chrome-store.js';

const store = new ChromeStore();
const $ = id => document.getElementById(id);

function message(text, kind = '') { $('message').textContent = text; $('message').className = kind; }
function send(message) {
  return new Promise((resolve, reject) => chrome.runtime.sendMessage(message, response => {
    if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
    if (!response?.ok) return reject(Object.assign(new Error(response?.error?.message || 'Extension request failed'), response?.error));
    resolve(response.data);
  }));
}
function allowedOwners(value) { return [...new Set(String(value || '').split(',').map(item => item.trim()).filter(Boolean))]; }


async function load() {
  const { config, token } = await store.getConfig();
  if (!config) return;
  $('owner').value = config.owner || '';
  $('repo').value = config.repo || '';
  $('branch').value = config.branch || 'main';
  $('token').value = token || '';
  $('recent-days').value = config.recentDays || 7;
  $('allowed-owners').value = (config.allowedIssueOwners || []).join(', ');
}

$('settings-form').addEventListener('submit', async event => {
  event.preventDefault(); message('Validating with GitHub…'); $('save').disabled = true;
  try {
    const payload = {
      owner: $('owner').value.trim(), repo: $('repo').value.trim(), branch: $('branch').value.trim(),
      recentDays: Number($('recent-days').value), token: $('token').value.trim(),
      allowedIssueOwners: allowedOwners($('allowed-owners').value),
    };
    const { user, config } = await send({ type: 'SAVE_CONFIG', payload });
    message(`Saved. Authenticated as ${user}; writes target ${config.owner}/${config.repo}@${config.branch}.`, 'success');
  } catch (error) { message(error.message || 'Could not save settings.', 'error'); }
  finally { $('save').disabled = false; }
});

load().catch(error => message(error.message, 'error'));
