(() => {
  const ROOT_ID = 'repoclock-root';
  const POPUP_ROOT_ID = 'repoclock-popup-root';
  const popupMode = location.protocol === 'chrome-extension:';
  const STOPWATCH_PATH = 'M5.75.75A.75.75 0 0 1 6.5 0h3a.75.75 0 0 1 0 1.5h-.75v1l-.001.041a6.724 6.724 0 0 1 3.464 1.435l.007-.006.75-.75a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734l-.75.75-.006.007a6.75 6.75 0 1 1-10.548 0L2.72 5.03l-.75-.75a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018l.75.75.007.006A6.72 6.72 0 0 1 7.25 2.541V1.5H6.5a.75.75 0 0 1-.75-.75ZM8 14.5a5.25 5.25 0 1 0-.001-10.501A5.25 5.25 0 0 0 8 14.5Zm.389-6.7 1.33-1.33a.75.75 0 1 1 1.061 1.06L9.45 8.861A1.503 1.503 0 0 1 8 10.75a1.499 1.499 0 1 1 .389-2.95Z';
  const TRIANGLE_PATH = 'm4.427 7.427 3.396 3.396a.25.25 0 0 0 .354 0l3.396-3.396A.25.25 0 0 0 11.396 7H4.604a.25.25 0 0 0-.177.427Z';
  const SYNC_PATH = 'M1.705 8.005a.75.75 0 0 1 .834.656 5.5 5.5 0 0 0 9.592 2.97l-1.204-1.204a.25.25 0 0 1 .177-.427h3.646a.25.25 0 0 1 .25.25v3.646a.25.25 0 0 1-.427.177l-1.38-1.38A7.002 7.002 0 0 1 1.05 8.84a.75.75 0 0 1 .656-.834ZM8 2.5a5.487 5.487 0 0 0-4.131 1.869l1.204 1.204A.25.25 0 0 1 4.896 6H1.25A.25.25 0 0 1 1 5.75V2.104a.25.25 0 0 1 .427-.177l1.38 1.38A7.002 7.002 0 0 1 14.95 7.16a.75.75 0 0 1-1.49.178A5.5 5.5 0 0 0 8 2.5Z';
  const REPORTS_PATH = 'M1.75 1.5a.75.75 0 0 0-.75.75v11.5c0 .414.336.75.75.75h12.5a.75.75 0 0 0 0-1.5H2.5V2.25a.75.75 0 0 0-.75-.75Zm3.5 8a.75.75 0 0 0-.75.75v1.5a.75.75 0 0 0 1.5 0v-1.5a.75.75 0 0 0-.75-.75Zm3-3a.75.75 0 0 0-.75.75v4.5a.75.75 0 0 0 1.5 0v-4.5a.75.75 0 0 0-.75-.75Zm3-3a.75.75 0 0 0-.75.75v7.5a.75.75 0 0 0 1.5 0v-7.5a.75.75 0 0 0-.75-.75Z';
  const GEAR_PATH = 'M8 0a8.2 8.2 0 0 1 .701.031C9.444.095 9.99.645 10.16 1.29l.288 1.107c.018.066.079.158.212.224.231.114.454.243.668.386.123.082.233.09.299.071l1.103-.303c.644-.176 1.392.021 1.82.63.27.385.506.792.704 1.218.315.675.111 1.422-.364 1.891l-.814.806c-.049.048-.098.147-.088.294.016.257.016.515 0 .772-.01.147.038.246.088.294l.814.806c.475.469.679 1.216.364 1.891a7.977 7.977 0 0 1-.704 1.217c-.428.61-1.176.807-1.82.63l-1.102-.302c-.067-.019-.177-.011-.3.071a5.909 5.909 0 0 1-.668.386c-.133.066-.194.158-.211.224l-.29 1.106c-.168.646-.715 1.196-1.458 1.26a8.006 8.006 0 0 1-1.402 0c-.743-.064-1.289-.614-1.458-1.26l-.289-1.106c-.018-.066-.079-.158-.212-.224a5.738 5.738 0 0 1-.668-.386c-.123-.082-.233-.09-.299-.071l-1.103.303c-.644.176-1.392-.021-1.82-.63a8.12 8.12 0 0 1-.704-1.218c-.315-.675-.111-1.422.363-1.891l.815-.806c.05-.048.098-.147.088-.294a6.214 6.214 0 0 1 0-.772c.01-.147-.038-.246-.088-.294l-.815-.806C.635 6.045.431 5.298.746 4.623a7.92 7.92 0 0 1 .704-1.217c.428-.61 1.176-.807 1.82-.63l1.102.302c.067.019.177.011.3-.071.214-.143.437-.272.668-.386.133-.066.194-.158.211-.224l.29-1.106C6.009.645 6.556.095 7.299.03 7.53.01 7.764 0 8 0Zm3 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM9.5 8a1.5 1.5 0 1 0-3.001.001A1.5 1.5 0 0 0 9.5 8Z';
  let lastRoute = null;
  let tick = null;
  let root = null;
  let shadow = null;
  let menuOpen = false;
  let navigationOpen = false;
  let pageState = { configured: false, active: null, pendingCount: 0, pendingWrites: [] };
  let recent = [];
  let recentLoaded = false;
  let recentFresh = false;
  let loadingRecent = false;
  let recentLoad = null;
  let editing = null;
  let editingDraft = null;
  let errorText = '';
  let errorCode = '';
  let todayReportDate = '';
  let summaryFrames = [];
  let summaryLabel = null;
  let summaryTotalValue = null;
  let summaryIndex = 0;
  let summaryElapsedMs = 0;
  let popupTask = null;

  function normalizeTaskUrl(value) {
    const candidate = String(value || '');
    if (typeof URL !== 'function') {
      const match = candidate.match(/^https?:\/\/([^/?#]+)(?:[/?#]|$)/i);
      if (!match || match[1].includes('@')) return null;
      let normalized = candidate;
      normalized = normalized.replace(/^(https:\/\/github\.com\/[^/?#]+\/[^/?#]+\/(?:issues|pull)\/[1-9]\d*)\/?(?:[?#].*)?$/i, '$1');
      return normalized.length <= 2048 ? normalized : null;
    }
    try {
      const url = new URL(candidate);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
      if (url.protocol === 'https:' && url.hostname === 'github.com'
          && /^\/[^/]+\/[^/]+\/(?:issues|pull)\/[1-9]\d*\/?$/.test(url.pathname)) {
        url.search = ''; url.hash = '';
      }
      return url.href.length <= 2048 ? url.href : null;
    } catch { return null; }
  }

  function taskUrlOf(value) { return normalizeTaskUrl(typeof value === 'string' ? value : value?.taskUrl ?? value?.issue?.url ?? value?.url); }
  function taskTitleOf(value) { return String(value?.taskTitle ?? value?.issueTitle ?? value?.title ?? '').trim().slice(0, 300); }
  function taskResult(value, className = '') {
    const taskUrl = taskUrlOf(value), taskTitle = taskTitleOf(value);
    const result = el('div', undefined, `task-result${taskTitle ? '' : ' task-result-untitled'}${className ? ` ${className}` : ''}`);
    const url = el(taskTitle ? 'div' : 'a', taskUrl, 'task-url'); url.title = taskUrl;
    if (!taskTitle) { url.href = taskUrl; url.target = '_blank'; url.rel = 'noreferrer'; }
    result.append(url);
    if (taskTitle) {
      const title = el('a', taskTitle, 'task-title'); title.href = taskUrl; title.target = '_blank'; title.rel = 'noreferrer'; title.title = taskTitle; result.append(title);
    }
    return result;
  }
  function taskFromUrl(value, title = '') {
    const taskUrl = normalizeTaskUrl(value);
    return taskUrl ? { taskUrl, taskTitle: String(title || '').trim().slice(0, 300) } : null;
  }
  function taskFromLocation() { return popupMode ? popupTask : taskFromUrl(location.href, titleFromPage()); }
  function sameTask(left, right) { const a = taskUrlOf(left), b = taskUrlOf(right); return Boolean(a && b && a === b); }
  async function refreshPopupTask() {
    if (!popupMode) return taskFromLocation();
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    popupTask = taskFromUrl(tab?.url, tab?.title || '');
    return popupTask;
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
    if (tag === 'input' || tag === 'textarea') {
      for (const type of ['keydown', 'keypress', 'keyup']) node.addEventListener(type, event => event.stopPropagation());
    }
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

  function localDateValue(date = new Date()) {
    const pad = value => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function summarySeconds(frame) {
    let seconds = Math.max(0, Number(frame?.seconds) || 0);
    const activeDate = pageState.active?.startedAt?.slice(0, 10);
    if (activeDate && activeDate >= frame.startDate && activeDate <= frame.endDate) seconds += Math.max(0, Math.floor((Date.now() - new Date(pageState.active.startedAt).getTime()) / 1000));
    return seconds;
  }

  function applyMenuData(data, fresh = true) {
    recent = Array.isArray(data) ? data : data?.recent ?? [];
    todayReportDate = Array.isArray(data) ? localDateValue() : data?.reportDate || '';
    const fallbackTodaySeconds = Array.isArray(data)
      ? recent.filter(entry => (entry.entryDate || entry.startedAt?.slice(0, 10)) === todayReportDate).reduce((sum, entry) => sum + (Number(entry.durationSeconds) || 0), 0)
      : Math.max(0, Number(data?.todaySeconds) || 0);
    summaryFrames = Array.isArray(data?.summaries) && data.summaries.length ? data.summaries : [
      { key: 'today', label: 'Today', seconds: fallbackTodaySeconds, startDate: todayReportDate, endDate: todayReportDate, displayMs: 2000 },
    ];
    if (!Array.isArray(data)) pageState = {
      ...pageState, configured: true, active: data?.active ?? null,
      pendingCount: Math.max(0, Number(data?.pendingCount) || 0), pendingWrites: data?.pendingWrites ?? [],
    };
    recentLoaded = true;
    recentFresh = fresh;
  }

  function applyPageState(data) {
    pageState = data;
    if (!recentLoaded && Array.isArray(data?.recent) && data.recent.length) applyMenuData(data.recent, false);
  }

  function timestampParts(value) {
    const match = String(value).match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{3})?(Z|[+-]\d{2}:\d{2})$/);
    if (!match) throw new Error('Invalid timestamp offset.');
    return { date: match[1], hour: match[2], minute: match[3], second: match[4], fraction: match[5] || '', zone: match[6] };
  }

  function timestampFromTimeParts(original, date, hour, minute) {
    const parts = timestampParts(original), numericHour = Number(hour), numericMinute = Number(minute);
    if (!validEntryDate(date) || !Number.isInteger(numericHour) || numericHour < 0 || numericHour > 23
        || !Number.isInteger(numericMinute) || numericMinute < 0 || numericMinute > 59) throw new Error('Enter a valid date and time.');
    const value = `${date}T${String(numericHour).padStart(2, '0')}:${String(numericMinute).padStart(2, '0')}:${parts.second}${parts.fraction}${parts.zone}`;
    if (!validTimestamp(value)) throw new Error('Enter a valid date and time.');
    return value;
  }

  function timePicker(label, original, draft = null, { onChange = () => {} } = {}) {
    let template = validTimestamp(draft?.timestamp) ? draft.timestamp : original;
    const initial = timestampParts(template), group = el('fieldset', undefined, 'time-picker'), controls = [];
    group.append(el('legend', label));
    const dateField = el('input'); controls.push(dateField); dateField.type = 'date'; dateField.required = true; dateField.value = draft?.date ?? initial.date; dateField.className = 'time-date'; dateField.setAttribute('aria-label', `${label} date`);
    const values = el('div', undefined, 'time-picker-values');
    const hourField = el('input'); controls.push(hourField); hourField.type = 'text'; hourField.inputMode = 'numeric'; hourField.maxLength = 2; hourField.value = draft?.hour ?? initial.hour; hourField.className = 'time-value time-hour'; hourField.setAttribute('aria-label', `${label} hour`);
    const minuteField = el('input'); controls.push(minuteField); minuteField.type = 'text'; minuteField.inputMode = 'numeric'; minuteField.maxLength = 2; minuteField.value = draft?.minute ?? initial.minute; minuteField.className = 'time-value time-minute'; minuteField.setAttribute('aria-label', `${label} minute`);
    const currentDraft = () => ({ date: dateField.value, hour: hourField.value, minute: minuteField.value, timestamp: template });
    const validNumber = (field, maximum) => {
      const text = String(field.value), numeric = Number(text), valid = /^\d{1,2}$/.test(text) && Number.isInteger(numeric) && numeric >= 0 && numeric <= maximum;
      field.setAttribute('aria-invalid', String(!valid));
      return valid;
    };
    const refreshValidity = () => validNumber(hourField, 23) && validNumber(minuteField, 59);
    const value = () => { if (!refreshValidity()) throw new Error('Enter a valid date and time.'); return timestampFromTimeParts(template, dateField.value, hourField.value, minuteField.value); };
    const changed = () => { refreshValidity(); onChange(currentDraft()); };
    const applyTimestamp = timestamp => {
      const parts = timestampParts(timestamp); template = timestamp; dateField.value = parts.date; hourField.value = parts.hour; minuteField.value = parts.minute; refreshValidity();
    };
    dateField.addEventListener('input', changed); hourField.addEventListener('input', changed); minuteField.addEventListener('input', changed);
    refreshValidity();
    values.append(hourField, el('span', ':', 'time-colon'), minuteField);
    group.append(dateField, values);
    return { node: group, value, draft: currentDraft, setValue: applyTimestamp, setDisabled: disabled => { for (const control of controls) control.disabled = disabled; } };
  }

  function timestampAtOriginalOffset(original, instant) {
    const match = String(original).match(/(Z|([+-])(\d{2}):(\d{2}))$/);
    if (!match || !Number.isFinite(instant)) throw new Error('Invalid timestamp offset.');
    const offset = match[1] === 'Z' ? 0 : (match[2] === '+' ? 1 : -1) * (Number(match[3]) * 60 + Number(match[4]));
    const date = new Date(instant + offset * 60_000), pad = (number, width = 2) => String(number).padStart(width, '0');
    const milliseconds = date.getUTCMilliseconds(), fraction = milliseconds || timestampParts(original).fraction ? `.${pad(milliseconds, 3)}` : '';
    return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}${fraction}${match[1]}`;
  }

  function titleFromPage() {
    if (popupMode) return taskTitleOf(popupTask);
    const node = document.querySelector('[data-testid="issue-title"], .js-issue-title, bdi.js-issue-title');
    const title = (node?.textContent || document.title || '').replace(/ · GitHub$/, '').trim();
    return title.slice(0, 300);
  }

  function recentRequest() {
    const task = taskFromLocation();
    return { type: 'LOAD_RECENT', menuData: true, ...(task ? { taskUrl: task.taskUrl, taskTitle: task.taskTitle } : {}) };
  }

  function directChild(node, ancestor) {
    let current = node;
    while (current?.parentElement && current.parentElement !== ancestor) current = current.parentElement;
    return current?.parentElement === ancestor ? current : null;
  }

  function headerTarget() {
    for (const selector of ['[data-testid="top-nav-right"]', '.AppHeader-actions']) {
      const actions = document.querySelector(selector);
      const avatar = actions?.querySelector('img[data-testid="github-avatar"]') || actions?.querySelector('img.avatar');
      const anchor = avatar && directChild(avatar, actions);
      if (actions && anchor) return { actions, anchor };
    }
    return null;
  }

  function mountInHeader() {
    if (popupMode) {
      root = root || document.getElementById(POPUP_ROOT_ID);
      if (!root) return false;
      root.classList.add('popup-surface');
      shadow = shadow || root.attachShadow({ mode: 'closed' });
      return true;
    }
    const target = headerTarget();
    if (!target) return false;
    if (!root) {
      root = el('div'); root.id = ROOT_ID;
      shadow = root.attachShadow({ mode: 'closed' });
    }
    if (root.parentElement !== target.actions || root.nextElementSibling !== target.anchor) target.actions.insertBefore(root, target.anchor);
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

  function setError(error = '') { errorText = error?.message || String(error || ''); errorCode = error?.code || ''; renderUi(); }

  function closeMenu() { menuOpen = false; navigationOpen = false; editing = null; editingDraft = null; errorText = ''; errorCode = ''; renderUi(); }

  function originalRecord(entry) { return { taskUrl: taskUrlOf(entry), taskTitle: taskTitleOf(entry), issueUrl: taskUrlOf(entry), issueTitle: taskTitleOf(entry), startedAt: entry.startedAt, endedAt: entry.endedAt, description: entry.description || '' }; }

  function sameRecord(left, right) {
    const a = originalRecord(left), b = originalRecord(right);
    return a.issueUrl === b.issueUrl && a.issueTitle === b.issueTitle && a.startedAt === b.startedAt && a.endedAt === b.endedAt && a.description === b.description;
  }

  function validEntryDate(value) {
    const match = typeof value === 'string' ? value.match(/^(?!0000)(\d{4})-(\d{2})-(\d{2})$/) : null;
    if (!match) return false;
    const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
    return month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
  }

  function validTimestamp(value) {
    const match = typeof value === 'string' ? value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?(Z|([+-])(\d{2}):(\d{2}))$/) : null;
    if (!match) return false;
    const [, year, month, day, hour, minute, second, millis = '000', zone, sign, offsetHour = '00', offsetMinute = '00'] = match;
    const y = Number(year), mo = Number(month), d = Number(day), h = Number(hour), mi = Number(minute), sec = Number(second);
    if (mo < 1 || mo > 12 || d < 1 || d > new Date(Date.UTC(y, mo, 0)).getUTCDate() || h > 23 || mi > 59 || sec > 59
        || Number(offsetHour) > 23 || Number(offsetMinute) > 59) return false;
    const offset = zone === 'Z' ? 0 : (sign === '+' ? 1 : -1) * (Number(offsetHour) * 60 + Number(offsetMinute));
    const expected = Date.UTC(y, mo - 1, d, h, mi, sec, Number(millis)) - offset * 60000;
    return new Date(value).getTime() === expected;
  }

  function validIssue(issue) {
    if (!issue || typeof issue !== 'object' || Object.keys(issue).sort().join(',') !== 'number,owner,repo,type,url') return false;
    const ownerOk = typeof issue.owner === 'string' && /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(issue.owner) && !issue.owner.includes('--');
    const repoOk = typeof issue.repo === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(issue.repo) && issue.repo !== '.' && issue.repo !== '..';
    const numberOk = Number.isSafeInteger(issue.number) && issue.number > 0;
    if (!ownerOk || !repoOk || !numberOk || !['issue', 'pull_request'].includes(issue.type)) return false;
    const route = issue.type === 'pull_request' ? 'pull' : 'issues';
    return issue.url === `https://github.com/${issue.owner}/${issue.repo}/${route}/${issue.number}`;
  }

  function validRewrittenEntry(item, position, path, sha) {
    const required = ['_index', '_path', '_sha', 'createdAt', 'description', 'durationSeconds', 'endedAt', 'entryDate', 'id', 'issueTitle', 'schemaVersion', 'startedAt', 'taskTitle', 'taskUrl', 'updatedAt', 'user'];
    const allowed = new Set([...required, 'issue']);
    if (!item || typeof item !== 'object' || Object.keys(item).some(key => !allowed.has(key)) || required.some(key => !(key in item)) || item.schemaVersion !== 1
        || item._index !== position || item._path !== path || typeof item._sha !== 'string' || !item._sha || (sha && item._sha !== sha)
        || typeof item.user !== 'string' || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(item.user)
        || !taskUrlOf(item) || (item.issue && (!validIssue(item.issue) || item.issue.url !== item.taskUrl))
        || !validEntryDate(item.entryDate) || !validTimestamp(item.startedAt) || !validTimestamp(item.endedAt)
        || item.entryDate !== item.startedAt.slice(0, 10) || item.createdAt !== item.endedAt || item.updatedAt !== item.endedAt
        || typeof item.taskTitle !== 'string' || item.taskTitle.length > 300 || item.issueTitle !== item.taskTitle
        || item.taskTitle !== item.taskTitle.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim()
        || typeof item.description !== 'string' || item.description.length > 2000
        || item.description !== item.description.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim()) return false;
    const pathMatch = path.match(/^times\/(\d{4}-\d{2})\/([A-Za-z0-9-]+)\.txt$/);
    if (!pathMatch || pathMatch[1] !== item.entryDate.slice(0, 7) || pathMatch[2] !== item.user
        || item.id !== `${item.entryDate.replaceAll('-', '')}${String(position).padStart(18, '0')}`) return false;
    const duration = Math.floor((new Date(item.endedAt).getTime() - new Date(item.startedAt).getTime()) / 1000);
    return Number.isInteger(item.durationSeconds) && duration >= 0 && item.durationSeconds === duration;
  }

  function reconcileDeletedFile(deleted, rewritten) {
    if (!Array.isArray(rewritten)) return null;
    const byIndex = new Map();
    let rewrittenSha = null;
    for (const [position, item] of rewritten.entries()) {
      if (!validRewrittenEntry(item, position, deleted._path, rewrittenSha)) return null;
      rewrittenSha ||= item._sha;
      byIndex.set(position, item);
    }
    const next = [];
    for (const item of recent) {
      if (item._path !== deleted._path || item._pending) { next.push(item); continue; }
      if (item._index === deleted._index) {
        if (!sameRecord(item, deleted)) return null;
        continue;
      }
      const index = item._index > deleted._index ? item._index - 1 : item._index;
      const replacement = byIndex.get(index);
      if (!replacement || replacement._path !== deleted._path || !sameRecord(replacement, item)) return null;
      next.push(replacement);
    }
    return next;
  }

  function refreshRecent() {
    if (recentLoad) return recentLoad;
    recentFresh = false; loadingRecent = true; renderUi();
    let load;
    load = send(recentRequest()).then(data => applyMenuData(data, true)).finally(() => {
      if (recentLoad === load) {
        recentLoad = null; loadingRecent = false; renderUi();
      }
    });
    recentLoad = load;
    return load;
  }

  async function refreshState(refresh = false, loadEntries = false) {
    if (loadEntries) return refreshRecent();
    applyPageState(await send({ type: 'GET_PAGE_STATE', refresh }));
    renderUi();
  }

  function renderEditor(container) {
    const header = el('div', undefined, 'section-head'); header.append(el('strong', 'Edit entry'));
    const cancelEdit = button('Cancel', 'link-button', async () => { editing = null; editingDraft = null; renderUi(); }); header.append(cancelEdit);
    const draft = editingDraft?.id === editing.id ? editingDraft : null;
    const form = el('form');
    const urlField = el('input'); urlField.required = true; urlField.type = 'url'; urlField.value = draft?.taskUrl ?? taskUrlOf(editing);
    const titleField = el('input'); titleField.maxLength = 300; titleField.value = draft?.taskTitle ?? taskTitleOf(editing);
    let titleEdited = Boolean(draft?.titleEdited), adjusting = false, startPicker, stopPicker;
    titleField.addEventListener('input', () => { titleEdited = true; });
    urlField.addEventListener('input', () => {
      if (!titleEdited && normalizeTaskUrl(urlField.value) !== taskUrlOf(editing)) titleField.value = '';
    });
    const reconcile = changed => {
      if (adjusting || !startPicker || !stopPicker) return;
      try {
        adjusting = true;
        const startedAt = startPicker.value(), endedAt = stopPicker.value();
        if (new Date(startedAt) > new Date(endedAt)) {
          if (changed === 'start') stopPicker.setValue(timestampAtOriginalOffset(editing.endedAt, new Date(startedAt).getTime()));
          else startPicker.setValue(timestampAtOriginalOffset(editing.startedAt, new Date(endedAt).getTime()));
        }
      } catch { /* preserve incomplete direct-input drafts until submit */ }
      finally { adjusting = false; }
    };
    startPicker = timePicker('Start', editing.startedAt, draft?.start, { onChange: () => reconcile('start') });
    stopPicker = timePicker('Stop', editing.endedAt, draft?.stop, { onChange: () => reconcile('stop') });
    const description = el('textarea'); description.maxLength = 2000; description.rows = 3; description.value = draft?.description ?? editing.description ?? '';
    const fieldLabel = (text, field) => { const label = el('label', text); label.append(field); return label; };
    form.append(fieldLabel('Task URL', urlField), fieldLabel('Task title (optional)', titleField));
    const timeRange = el('div', undefined, 'time-range-editor'); timeRange.append(startPicker.node, stopPicker.node); form.append(timeRange);
    form.append(fieldLabel('Description', description));
    const actions = el('div', undefined, 'form-actions');
    const remove = button('Delete', 'danger-outline', async (event, node) => {
      if (!confirm(`Delete this ${formatDuration(editing.durationSeconds)} entry?

The previous version remains in Git history.`)) return;
      node.disabled = true;
      try { await send({ type: 'DELETE_ENTRY', payload: { path: editing._path, originalSha: editing._sha, index: editing._index, original: originalRecord(editing) } }); editing = null; editingDraft = null; recentLoaded = false; await refreshState(false, true); }
      catch (error) { node.disabled = false; setError(error); }
    });
    const save = el('button', 'Save', 'primary'); save.type = 'submit';
    const setEditorDisabled = disabled => {
      for (const control of [cancelEdit, urlField, titleField, description, remove, save]) control.disabled = disabled;
      startPicker.setDisabled(disabled); stopPicker.setDisabled(disabled);
    };
    actions.append(remove, save); form.append(actions);
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (!event.isTrusted) return;
      editingDraft = { id: editing.id, taskUrl: urlField.value, taskTitle: titleField.value, titleEdited, start: startPicker.draft(), stop: stopPicker.draft(), description: description.value };
      setEditorDisabled(true);
      try {
        const task = taskFromUrl(urlField.value, titleField.value);
        if (!task) throw new Error('Enter a valid HTTP(S) task URL.');
        const startedAt = startPicker.value(), endedAt = stopPicker.value();
        await send({ type: 'EDIT_ENTRY', payload: { path: editing._path, originalSha: editing._sha, index: editing._index, original: originalRecord(editing), edits: { taskUrl: task.taskUrl, taskTitle: task.taskTitle, startedAt, endedAt, description: description.value } } });
        editing = null; editingDraft = null; recentLoaded = false; await refreshState(false, true);
      } catch (error) { setEditorDisabled(false); setError(error); }
    });
    container.append(header, form);
  }

  function relativeDayLabel(date) {
    const today = localDateValue(), marker = new Date(`${today}T12:00:00`);
    marker.setDate(marker.getDate() - 1);
    if (date === today) return 'Today';
    if (date === localDateValue(marker)) return 'Yesterday';
    return new Date(`${date}T12:00:00Z`).toLocaleDateString([], { weekday: 'short', timeZone: 'UTC' });
  }


  async function deleteRecentEntry(entry, node) {
    if (!confirm(`Delete this ${formatDuration(entry.durationSeconds)} entry?

The previous version remains in Git history.`)) return;
    const controls = Array.from(node.parentElement?.children ?? [node]);
    for (const control of controls) control.disabled = true;
    try {
      const result = await send({ type: 'DELETE_ENTRY', payload: { path: entry._path, originalSha: entry._sha, index: entry._index, original: originalRecord(entry) } });
      editing = null; editingDraft = null;
      const entryDate = entry.entryDate || entry.startedAt.slice(0, 10);
      summaryFrames = summaryFrames.map(frame => entryDate >= frame.startDate && entryDate <= frame.endDate
        ? { ...frame, seconds: Math.max(0, frame.seconds - entry.durationSeconds) } : frame);
      const reconciled = reconcileDeletedFile(entry, result?.entries);
      if (reconciled) {
        recent = reconciled;
        renderUi();
      } else {
        recentLoaded = false;
        await refreshState(false, true);
      }
    } catch (error) {
      for (const control of controls) control.disabled = false;
      setError(error);
    }
  }

  function entryKey(entry) {
    return `${entry._path}\n${entry._sha || 'pending'}\n${entry._index}\n${entry.id}`;
  }

  function overlappingEntries(entries) {
    const overlaps = new Set();
    for (let left = 0; left < entries.length; left += 1) {
      const leftStart = new Date(entries[left].startedAt).getTime(), leftEnd = new Date(entries[left].endedAt).getTime();
      for (let right = left + 1; right < entries.length; right += 1) {
        const rightStart = new Date(entries[right].startedAt).getTime(), rightEnd = new Date(entries[right].endedAt).getTime();
        if (leftStart < rightEnd && rightStart < leftEnd) {
          overlaps.add(entryKey(entries[left])); overlaps.add(entryKey(entries[right]));
        }
      }
    }
    return overlaps;
  }

  function recentTimeText(entry) {
    const start = timestampParts(entry.startedAt), stop = timestampParts(entry.endedAt);
    const stopDay = stop.date === start.date ? '' : `${relativeDayLabel(stop.date)} `;
    return `${start.hour}:${start.minute} - ${stopDay}${stop.hour}:${stop.minute}`;
  }

  function recentRecord(entry, overlaps) {
    const overlapping = overlaps.has(entryKey(entry));
    const record = el('div', undefined, `entry-record${overlapping ? ' entry-overlap' : ''}`);
    if (overlapping) record.append(el('div', 'Overlaps another entry', 'overlap-warning'));
    const day = el('div', relativeDayLabel(entry.startedAt.slice(0, 10)), 'entry-day');
    const time = el('span', recentTimeText(entry), 'entry-time-range');
    const durationText = formatDuration(entry.durationSeconds);
    const duration = el('span', durationText, 'inline-duration'); duration.title = durationText;
    const timeRow = el('div', undefined, 'entry-time-row');
    const actions = el('div', undefined, `entry-actions${entry._pending ? ' entry-actions-visible' : ''}`);
    if (entry._pending) {
      const pending = button('Pending', 'link-button entry-pending', async () => {}); pending.disabled = true; actions.append(pending);
    } else {
      const edit = button('Edit', 'entry-edit', async () => { editing = entry; editingDraft = null; renderUi(); shadow?.querySelector?.('.time-value')?.focus?.(); });
      const remove = button('Delete', 'danger-outline entry-delete', async (event, node) => deleteRecentEntry(entry, node));
      const disabled = Boolean(loadingRecent || !recentFresh);
      edit.disabled = disabled; remove.disabled = disabled;
      actions.append(edit, remove);
    }
    timeRow.append(time, duration, actions);
    record.append(day, timeRow);
    if (entry.description) record.append(el('div', entry.description, 'entry-description'));
    return record;
  }

  function recentGroup(entries, overlaps) {
    const group = el('article', undefined, 'entry');
    const first = entries[0];
    group.append(taskResult(first, 'entry-task-result'));
    for (const entry of entries) group.append(recentRecord(entry, overlaps));
    return group;
  }

  function renderRecent(container) {
    const header = el('div', undefined, 'section-head'); header.append(el('strong', 'Recent entries'));
    const refresh = button('', 'icon-button', async (event, node) => {
      node.disabled = true;
      try { errorText = ''; renderUi(); await send({ type: 'SYNC' }); recentLoaded = false; await refreshState(true, true); }
      catch (error) { node.disabled = false; setError(error); }
    });
    refresh.title = 'Sync and refresh'; refresh.setAttribute('aria-label', 'Sync and refresh'); refresh.append(icon('sync', SYNC_PATH)); header.append(refresh); container.append(header);
    if (loadingRecent && !recentLoaded) { container.append(el('div', 'Loading recent entries…', 'muted')); return; }
    if (!recentLoaded) { container.append(el('div', 'Loading recent entries…', 'muted')); return; }
    if (!recent.length) { container.append(el('div', 'No entries in the configured display window.', 'muted')); return; }
    const entries = [...recent].sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
    const overlaps = overlappingEntries(entries);
    let group = [];
    for (const entry of entries) {
      if (group.length && !sameTask(group[0], entry)) { container.append(recentGroup(group, overlaps)); group = []; }
      group.push(entry);
    }
    if (group.length) container.append(recentGroup(group, overlaps));
  }

  function renderPendingConflicts(container) {
    const conflicts = (pageState.pendingWrites ?? []).filter(item => item.status === 'conflict');
    for (const item of conflicts) {
      const unsaved = item.conflictReason === 'active_missing_no_completion' || item.conflictReason === 'active_changed_no_completion';
      const savedWithNewerTimer = item.stage === 'clearActive' && item.conflictReason === 'completion_saved_newer_timer';
      const box = el('div', undefined, 'conflict');
      const title = unsaved ? 'Completion was not saved' : savedWithNewerTimer ? 'Newer GitHub timer preserved' : 'Entry path conflict';
      const detail = item.conflictReason === 'active_missing_no_completion'
        ? 'The active timer is gone and no matching completion exists. Discarding removes this unsaved completion.'
        : item.conflictReason === 'active_changed_no_completion'
          ? 'The active timer changed before this completion was saved. Discarding removes this unsaved completion.'
          : savedWithNewerTimer ? 'The completed entry was saved; the newer active timer was preserved.'
            : 'Repair or remove the conflicting entry in GitHub, then retry.';
      const label = unsaved ? 'Discard unsaved completion' : savedWithNewerTimer ? 'Keep newer timer' : 'Retry entry sync';
      box.append(el('strong', title), el('div', detail, 'muted'));
      box.append(button(label, 'secondary wide', async () => {
        if (unsaved && !confirm('Discard this unsaved completion? This cannot be recovered from the time-data repository.')) return;
        await send({ type: 'RESOLVE_PENDING', id: item.id, ...(unsaved ? { action: 'discard_unsaved_completion' } : {}) });
        recentLoaded = false;
        await refreshState(true, true);
      }));
      container.append(box);
    }
  }

  function renderMenu() {
    let elapsedValue = null;
    const menu = el('section', undefined, 'menu'); menu.setAttribute('role', 'dialog'); menu.setAttribute('aria-label', 'Time tracker panel. Scroll for more content.'); menu.tabIndex = 0;
    const updateScrollState = () => menu.classList.toggle('has-more', menu.scrollHeight > menu.clientHeight + menu.scrollTop + 1);
    menu.addEventListener('scroll', updateScrollState, { passive: true });
    globalThis.requestAnimationFrame?.(updateScrollState);
    const header = el('header');
    const heading = el('div'); heading.append(el('strong', 'RepoClock'), el('div', 'Time tracker', 'muted'));
    const syncText = pageState.pendingCount ? `${pageState.pendingCount} waiting to sync` : 'Synced'; heading.append(el('div', syncText, 'muted'));
    const headerActions = el('div', undefined, 'header-actions');
    const tasks = button('Tasks', 'reports-button', async () => { await send({ type: 'OPEN_TASKS' }); closeMenu(); }); tasks.title = 'Open tasks';
    const reports = button('Reports', 'reports-button', async () => { await send({ type: 'OPEN_REPORTS' }); closeMenu(); }); reports.title = 'Open reports'; reports.prepend(icon('graph', REPORTS_PATH));
    const settings = button('', 'icon-button', async () => { await send({ type: 'OPEN_OPTIONS' }); closeMenu(); }); settings.title = 'Settings'; settings.setAttribute('aria-label', 'Time tracker settings'); settings.append(icon('gear', GEAR_PATH));
    headerActions.append(tasks, reports, settings); header.append(heading, headerActions); menu.append(header);
    const body = el('div', undefined, 'menu-body');
    if (editing) renderEditor(body);
    else if (!pageState.configured) {
      body.append(el('p', 'Configure a private GitHub repository before tracking time.', 'muted'));
      body.append(button('Connect GitHub', 'primary wide', async () => { await send({ type: 'OPEN_OPTIONS' }); closeMenu(); }));
    } else {
      const current = taskFromLocation();
      if (pageState.active) {
        const active = pageState.active, same = current && sameTask(active, current);
        const tracking = el('div', undefined, `eyebrow tracking-status${same ? '' : ' tracking-another'}`);
        tracking.append(document.createTextNode('Tracking '), el('strong', same ? 'this' : 'another'), document.createTextNode(' task'));
        body.append(tracking);
        body.append(taskResult(active, 'active-task-result'));
        elapsedValue = el('div', formatElapsed(active.startedAt), 'elapsed'); body.append(elapsedValue);
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
        const startButton = button(current ? 'Start tracking this task' : 'Open an HTTP(S) page to start tracking', 'primary wide', async (event, node) => {
          node.disabled = true;
          try {
            const activatedTask = popupMode ? await refreshPopupTask() : taskFromLocation();
            if (!activatedTask) throw new Error('Open an HTTP(S) page to start tracking.');
            await send({ type: 'START', taskUrl: activatedTask.taskUrl, taskTitle: activatedTask.taskTitle || '' });
            await refreshState(false, false);
          } catch (error) { node.disabled = false; setError(error); }
        });
        startButton.disabled = !current || pageState.pendingCount > 0;
        body.append(startButton);
        if (pageState.pendingCount) body.append(el('div', 'Sync or resolve the pending entry before starting.', 'muted'));
        else if (!current) body.append(el('div', 'RepoClock tracks any HTTP(S) task URL; a title is optional.', 'muted'));
      }
      if (pageState.pendingCount) body.append(button('Sync now', 'secondary wide', async (event, node) => {
        node.disabled = true;
        try { await send({ type: 'SYNC' }); recentLoaded = false; await refreshState(true, true); }
        catch (error) { node.disabled = false; setError(error); }
      }));
      renderPendingConflicts(body);
      const today = el('div', undefined, 'today-total');
      summaryIndex = 0; summaryElapsedMs = 0;
      const currentSummary = () => summaryFrames[summaryIndex] ?? { label: 'Today', seconds: 0, startDate: todayReportDate, endDate: todayReportDate, displayMs: 2000 };
      const updateSummary = () => {
        const frame = currentSummary();
        if (summaryLabel) summaryLabel.textContent = `${frame.label}:`;
        if (summaryTotalValue) summaryTotalValue.textContent = recentLoaded && todayReportDate === localDateValue() ? formatDuration(summarySeconds(frame)) : '…';
      };
      today.append(summaryLabel = el('span'), summaryTotalValue = el('strong', undefined, 'today-total-value'));
      updateSummary(); body.append(today);
      clearInterval(tick); tick = setInterval(() => {
        const todayDate = localDateValue();
        if (elapsedValue && pageState.active) elapsedValue.textContent = formatElapsed(pageState.active.startedAt);
        if (todayReportDate && todayReportDate !== todayDate) {
          clearInterval(tick); tick = null; recentLoaded = false; summaryTotalValue.textContent = '…';
          void refreshState(false, true).catch(setError); return;
        }
        summaryElapsedMs += 1000;
        if (summaryElapsedMs >= currentSummary().displayMs) {
          summaryIndex = (summaryIndex + 1) % summaryFrames.length; summaryElapsedMs = 0;
        }
        updateSummary();
      }, 1000);
      const divider = el('div', undefined, 'divider'); body.append(divider); renderRecent(body);
    }
    if (errorText) {
      const error = el('div', errorText, 'error'), recovery = globalThis.RepoClockRecovery.actionFor(errorCode), label = recovery?.label || '';
      if (label) error.append(button(label, 'secondary wide', async () => {
        if (recovery.kind === 'retry') {
          errorText = ''; errorCode = ''; renderUi();
          try { await refreshState(true, true); }
          catch (retryError) { setError(retryError); }
          return;
        }
        await send({ type: 'OPEN_OPTIONS' }); closeMenu();
      }));
      body.prepend(error);
    }
    menu.append(body); return menu;
  }

  function renderNavigationMenu() {
    const menu = el('section', undefined, 'navigation-menu'); menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', 'Time tracker pages');
    const reports = button('Reports', 'navigation-item', async () => { await send({ type: 'OPEN_REPORTS' }); closeMenu(); });
    reports.setAttribute('role', 'menuitem'); reports.prepend(icon('graph', REPORTS_PATH));
    const tasks = button('Tasks', 'navigation-item', async () => { await send({ type: 'OPEN_TASKS' }); closeMenu(); });
    tasks.setAttribute('role', 'menuitem'); tasks.prepend(icon('issue-opened', STOPWATCH_PATH));
    menu.append(reports, tasks); return menu;
  }

  function renderUi() {
    if (!shadow || !root?.isConnected) return;
    clearInterval(tick); tick = null; summaryLabel = null; summaryTotalValue = null;
    shadow.replaceChildren();
    const style = el('style', `
      :host { all:initial; position:relative; display:inline-flex; align-items:center; color:var(--fgColor-default,#1f2328); color-scheme:light dark; font:var(--text-body-shorthand-medium,400 14px/1.5 "Mona Sans VF",-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans Backtick Fix","Noto Sans",Helvetica,Arial,sans-serif,"Apple Color Emoji","Segoe UI Emoji") }
      * { box-sizing:border-box } button,input,textarea { font:inherit } .trigger { display:inline-flex; align-items:center; justify-content:center; gap:3px; width:46px; height:32px; margin:0 8px 0 0; padding:0 6px; border:1px solid var(--borderColor-default,#d1d9e0); border-radius:6px; background:var(--button-default-bgColor-rest,#f6f8fa); color:var(--fgColor-muted,#59636e); cursor:pointer }
      .trigger:hover { background:var(--button-default-bgColor-hover,#eff2f5) } .trigger:active:not(:disabled) { background:var(--button-default-bgColor-active,#e6eaef) } .trigger[aria-expanded="true"] { background:var(--button-default-bgColor-selected,#e6eaef) } .trigger.running .octicon-stopwatch { color:var(--fgColor-open,#1a7f37) } .trigger:focus-visible,button:focus-visible,a:focus-visible,input:focus-visible,textarea:focus-visible,.time-value:focus-visible,.time-date:focus-visible { outline:2px solid var(--focus-outlineColor,#0969da); outline-offset:2px }
      .menu { position:absolute; z-index:2147483647; top:calc(100% + 8px); right:8px; width:min(420px,calc(100vw - 24px)); max-height:calc(100vh - 76px); overflow-y:scroll; overflow-x:hidden; scrollbar-gutter:stable; overscroll-behavior:contain; border:1px solid var(--borderColor-default,#d1d9e0); border-radius:12px; background:var(--bgColor-default,#fff); color:var(--fgColor-default,#1f2328); box-shadow:var(--shadow-floating-small,0 0 0 1px #d1d9e040,0 6px 12px -3px #25292e0a,0 6px 18px 0 #25292e1f) } .menu.has-more { box-shadow:inset 0 -18px 14px -18px var(--fgColor-muted,#59636e),var(--shadow-floating-small,0 0 0 1px #d1d9e040,0 6px 12px -3px #25292e0a,0 6px 18px 0 #25292e1f) } :host(.popup-surface) { display:block; width:100%; min-width:0; min-height:220px } :host(.popup-surface) .menu { position:relative; inset:auto; width:100%; max-height:600px; border-radius:0 }
      header,.header-actions,.section-head,.entry-row,.form-actions,.today-total { display:flex; align-items:center; justify-content:space-between; gap:12px } header { padding:12px 16px; border-bottom:1px solid var(--borderColor-muted,#d1d9e0b3) } .menu-body { padding:14px 16px } .muted { color:var(--fgColor-muted,#59636e); font:var(--text-caption-shorthand,400 12px/1.25 "Mona Sans VF",-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans Backtick Fix","Noto Sans",Helvetica,Arial,sans-serif,"Apple Color Emoji","Segoe UI Emoji"); margin-top:3px } .eyebrow { color:var(--fgColor-muted,#59636e); font:600 12px/1.5 var(--fontStack-sansSerif,"Mona Sans VF",-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans Backtick Fix","Noto Sans",Helvetica,Arial,sans-serif,"Apple Color Emoji","Segoe UI Emoji"); text-transform:uppercase; letter-spacing:normal; margin-bottom:5px } .tracking-status strong { font-weight:900 } .tracking-another strong { display:inline-block; padding:1px 5px; border-radius:999px; background:#ff2d55; color:#fff; box-shadow:0 0 0 2px #ff2d5533 }
      a { color:var(--fgColor-accent,#0969da); font-weight:600; text-decoration:none } a:hover { text-decoration:underline } .task-result { min-width:0 } .task-url { display:block; overflow:hidden; color:var(--fgColor-muted,#59636e); font-size:12px; font-weight:400; line-height:1.35; text-overflow:ellipsis; white-space:nowrap } .task-title { display:-webkit-box; overflow:hidden; margin-top:2px; color:var(--fgColor-accent,#0969da); font-size:16px; font-weight:600; line-height:1.35; overflow-wrap:anywhere; -webkit-box-orient:vertical; -webkit-line-clamp:2 } .task-result-untitled .task-url { overflow:hidden; color:var(--fgColor-accent,#0969da); font-size:16px; font-weight:600; text-overflow:ellipsis; white-space:nowrap } .active-task-result { margin-bottom:2px } .elapsed { margin:8px 0 10px; font:600 2rem/1.5 var(--fontStack-monospace,ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace) }
      button { border:1px solid var(--button-default-borderColor-rest,#d1d9e0); border-radius:6px; padding:7px 12px; background:var(--button-default-bgColor-rest,#f6f8fa); color:var(--button-default-fgColor-rest,#25292e); font-weight:600; cursor:pointer } button:hover { background:var(--button-default-bgColor-hover,#eff2f5) } button:active:not(:disabled) { background:var(--button-default-bgColor-active,#e6eaef) } button:disabled { border-color:var(--button-default-borderColor-disabled,#818b981a); background:var(--button-default-bgColor-disabled,#eff2f5); color:var(--button-default-fgColor-disabled,#818b98); cursor:default } .wide { width:100%; margin-top:10px } .primary { border-color:var(--button-primary-borderColor-rest,#1f232826); background:var(--button-primary-bgColor-rest,#1f883d); color:var(--button-primary-fgColor-rest,#fff) } .primary:hover { background:var(--button-primary-bgColor-hover,#1c8139) } .primary:active:not(:disabled) { background:var(--button-primary-bgColor-active,#197935) } .primary:disabled { border-color:var(--button-primary-borderColor-disabled,#95d8a6); background:var(--button-primary-bgColor-disabled,#95d8a6); color:var(--button-primary-fgColor-disabled,#fffc) } .danger,.danger-outline { border-color:var(--button-danger-borderColor-rest,#d1d9e0); background:var(--button-danger-bgColor-rest,#f6f8fa); color:var(--button-danger-fgColor-rest,#d1242f) } .danger:hover,.danger-outline:hover { border-color:var(--button-danger-borderColor-hover,#1f232826); background:var(--button-danger-bgColor-hover,#cf222e); color:var(--button-danger-fgColor-hover,#fff) } .danger:active:not(:disabled),.danger-outline:active:not(:disabled) { border-color:var(--button-danger-borderColor-active,#1f232826); background:var(--button-danger-bgColor-active,#a40e26); color:var(--button-danger-fgColor-active,#fff) } .danger:disabled,.danger-outline:disabled { border-color:var(--button-danger-borderColor-rest,#d1d9e0); background:var(--button-danger-bgColor-disabled,#eff2f5); color:var(--button-danger-fgColor-disabled,#d1242f80) }
      .header-actions { justify-content:flex-end; gap:4px } .reports-button { display:inline-flex; align-items:center; gap:6px; padding:5px 7px } .reports-button,.icon-button,.link-button,.navigation-item { border:1px solid var(--button-invisible-borderColor-rest,#fff0); background:var(--button-invisible-bgColor-rest,#fff0) } .reports-button,.icon-button { color:var(--button-invisible-iconColor-rest,#59636e) } .reports-button:hover,.icon-button:hover,.link-button:hover,.navigation-item:hover { border-color:var(--button-invisible-borderColor-hover,#fff0); background:var(--button-invisible-bgColor-hover,#818b981a) } .reports-button:hover,.icon-button:hover { color:var(--button-invisible-iconColor-hover,#59636e) } .reports-button:active:not(:disabled),.icon-button:active:not(:disabled),.link-button:active:not(:disabled),.navigation-item:active:not(:disabled) { background:var(--button-invisible-bgColor-active,#818b9826) } .reports-button:disabled,.icon-button:disabled,.link-button:disabled,.navigation-item:disabled { border-color:var(--button-invisible-borderColor-disabled,#fff0); background:var(--button-invisible-bgColor-disabled,#fff0); color:var(--button-invisible-fgColor-disabled,#818b98) } .today-total { margin-top:14px; padding:10px 12px; border:1px solid var(--borderColor-muted,#d1d9e0b3); border-radius:8px; background:var(--bgColor-muted,#f6f8fa) } .today-total-value { font-size:16px } .icon-button,.link-button { padding:5px } .link-button { color:var(--fgColor-accent,#0969da) } .divider { height:1px; margin:16px -16px 12px; background:var(--borderColor-muted,#d1d9e0b3) } .section-head { margin-bottom:7px }
      .time-range-editor { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:12px } .time-picker { min-width:0; margin:0; padding:10px; border:1px solid var(--borderColor-muted,#d1d9e0b3); border-radius:10px; background:var(--bgColor-muted,#f6f8fa) } .time-picker legend { padding:0 5px; color:var(--fgColor-muted,#59636e); font-weight:700 } .time-date { margin:0 0 8px; padding:5px 6px; background:var(--bgColor-default,#fff); font-size:12px } .time-picker-values { display:flex; align-items:center; justify-content:center; gap:6px } .time-value { width:62px; height:48px; margin:0; padding:4px; border-color:var(--control-borderColor-rest,#d1d9e0); background:var(--bgColor-default,#fff); font:700 26px/1 var(--fontStack-monospace,ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace); text-align:center; font-variant-numeric:tabular-nums } .time-colon { font:700 24px/1 var(--fontStack-monospace,ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace) }
      .trigger-group { display:inline-flex; align-items:center; margin:0 8px 0 0 } .trigger-group .trigger { margin:0; border-radius:0 } .trigger-main { width:34px; border-radius:6px 0 0 6px!important } .trigger-menu { width:24px; border-left:0; border-radius:0 6px 6px 0!important }
      .navigation-menu { position:absolute; z-index:2147483647; top:calc(100% + 8px); right:8px; width:180px; padding:6px; border:1px solid var(--borderColor-default,#d1d9e0); border-radius:8px; background:var(--bgColor-default,#fff); color:var(--fgColor-default,#1f2328); box-shadow:var(--shadow-floating-small,0 0 0 1px #d1d9e040,0 6px 12px -3px #25292e0a,0 6px 18px 0 #25292e1f) } .menu.has-more { box-shadow:inset 0 -18px 14px -18px var(--fgColor-muted,#59636e),var(--shadow-floating-small,0 0 0 1px #d1d9e040,0 6px 12px -3px #25292e0a,0 6px 18px 0 #25292e1f) } :host(.popup-surface) { display:block; width:100%; min-width:0; min-height:220px } :host(.popup-surface) .menu { position:relative; inset:auto; width:100%; max-height:600px; border-radius:0 } .navigation-item { display:flex; align-items:center; gap:8px; width:100%; padding:7px 8px; color:var(--button-invisible-fgColor-rest,#25292e); text-align:left }
      .entry { padding:12px 0; border-bottom:1px solid var(--borderColor-muted,#d1d9e0b3) } .entry:last-child { border-bottom:0 } .entry-task-result { margin-bottom:5px } .entry-record { padding:7px 0; border-radius:7px } .entry-record + .entry-record { border-top:1px solid var(--borderColor-muted,#d1d9e0b3) } .entry-record.entry-overlap { margin:4px -8px; padding:8px; border:1px solid var(--borderColor-danger-muted,#ff818266); background:var(--bgColor-danger-muted,#ffebe9) } .overlap-warning { margin-bottom:5px; color:var(--fgColor-danger,#d1242f); font-size:12px; font-weight:700 } .entry-day { margin-bottom:2px; color:var(--fgColor-muted,#59636e); font-size:13px; font-weight:650; white-space:nowrap } .entry-time-row { display:flex; align-items:center; justify-content:flex-start; gap:8px; min-width:0; white-space:nowrap } .entry-time-range { flex:0 0 auto; color:var(--fgColor-default,#1f2328); font:600 13px/1.5 var(--fontStack-monospace,ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace); font-variant-numeric:tabular-nums } .inline-duration { flex:0 1 auto; min-width:0; overflow:hidden; color:var(--fgColor-muted,#59636e); font-size:13px; font-weight:650; text-overflow:ellipsis; white-space:nowrap } .entry-description { margin-top:4px; color:var(--fgColor-muted,#59636e); overflow-wrap:anywhere } .entry-actions { display:flex; flex:0 0 auto; align-items:center; gap:4px; opacity:0; pointer-events:none } .entry-actions button { padding:3px 5px; font-size:12px } .entry-record:hover .entry-actions,.entry-record:focus-within .entry-actions,.entry-actions-visible { opacity:1; pointer-events:auto }
 label { display:block; margin:10px 0 4px; font:600 12px/1.5 var(--fontStack-sansSerif,"Mona Sans VF",-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans Backtick Fix","Noto Sans",Helvetica,Arial,sans-serif,"Apple Color Emoji","Segoe UI Emoji") } input,textarea { display:block; width:100%; margin-top:4px; padding:7px 8px; border:1px solid var(--control-borderColor-rest,#d1d9e0); border-radius:6px; background:var(--control-bgColor-rest,#f6f8fa); color:var(--control-fgColor-rest,#25292e) } input::placeholder,textarea::placeholder { color:var(--control-fgColor-placeholder,#59636e) } input:hover:not(:disabled),textarea:hover:not(:disabled) { background:var(--control-bgColor-hover,#eff2f5) } input:active:not(:disabled),textarea:active:not(:disabled) { background:var(--control-bgColor-active,#e6eaef) } input:disabled,textarea:disabled { border-color:var(--control-borderColor-disabled,#818b981a); background:var(--control-bgColor-disabled,#eff2f5); color:var(--control-fgColor-disabled,#818b98) } .form-actions { margin-top:12px } .error { margin-bottom:10px; color:var(--fgColor-danger,#d1242f); white-space:pre-wrap } @media(hover:none) { .entry-actions { opacity:1; pointer-events:auto } } @media(max-width:340px) { .entry-time-row { gap:5px } .entry-actions { gap:1px } .entry-actions button { padding:3px } } @media(max-width:380px) { .time-range-editor { grid-template-columns:1fr } }
    `);
    if (popupMode) {
      shadow.append(style, renderMenu());
      return;
    }
    const current = taskFromLocation(), group = el('div', undefined, 'trigger-group');
    const main = el('button', undefined, `trigger trigger-main${pageState.active ? ' running' : ''}`); main.type = 'button';
    main.setAttribute('aria-label', pageState.active ? `Time tracker running: ${formatElapsed(pageState.active.startedAt)}` : 'Time tracker');
    main.setAttribute('aria-haspopup', 'dialog'); main.setAttribute('aria-expanded', String(menuOpen));
    main.title = pageState.active ? 'Time tracker is running' : 'Open time tracker'; main.append(icon('stopwatch', STOPWATCH_PATH));
    main.addEventListener('click', async event => {
      if (!event.isTrusted) return;
      const activatedTask = taskFromLocation();
      if (!activatedTask) return;
      navigationOpen = false; menuOpen = !menuOpen; editing = null; editingDraft = null; errorText = ''; renderUi();
      if (menuOpen && pageState.configured) {
        try { await refreshRecent(); }
        catch (error) { setError(error); }
      }
    });
    const arrow = el('button', undefined, 'trigger trigger-menu'); arrow.type = 'button'; arrow.setAttribute('aria-label', 'Open time tracker pages');
    arrow.setAttribute('aria-haspopup', 'menu'); arrow.setAttribute('aria-expanded', String(navigationOpen)); arrow.title = 'Reports and tasks'; arrow.append(icon('triangle-down', TRIANGLE_PATH, 12));
    arrow.addEventListener('click', event => {
      if (!event.isTrusted) return;
      menuOpen = false; navigationOpen = !navigationOpen; editing = null; editingDraft = null; errorText = ''; renderUi();
    });
    group.append(main, arrow); shadow.append(style, group);
    if (navigationOpen) shadow.append(renderNavigationMenu());
    else if (menuOpen) shadow.append(renderMenu());
  }

  async function render(refresh = false) {
    if (location.protocol !== 'https:' || location.hostname !== 'github.com') { root?.remove(); root = null; shadow = null; menuOpen = false; navigationOpen = false; return; }
    if (!mountInHeader()) return;
    renderUi();
    try { applyPageState(await send({ type: 'GET_PAGE_STATE', refresh: false })); errorText = ''; }
    catch (error) { errorText = error.message; errorCode = error.code || 'error'; }
    renderUi();
    if (menuOpen && pageState.configured) {
      try { await refreshRecent(); }
      catch (error) { setError(error); }
    }
    if (refresh) {
      try { applyPageState(await send({ type: 'GET_PAGE_STATE', refresh: true })); }
      catch (error) { setError(error); return; }
      renderUi();
    }
  }

  function navigationCheck() {
    const route = `https://github.com${location.pathname}`;
    if (route !== lastRoute) {
      const firstRender = lastRoute === null;
      lastRoute = route; recent = []; recentLoaded = false; recentFresh = false; editing = null; editingDraft = null; menuOpen = false; navigationOpen = false;
      void render(firstRender);
    } else if (route) {
      const target = headerTarget();
      if (!root?.isConnected || !target || root.parentElement !== target.actions || root.nextElementSibling !== target.anchor) void render(false);
    }
  }

  if (popupMode) {
    menuOpen = true;
    mountInHeader();
    renderUi();
    refreshPopupTask().then(async () => {
      applyPageState(await send({ type: 'GET_PAGE_STATE', refresh: false }));
      renderUi();
      if (pageState.configured) {
        try { await refreshRecent(); }
        catch (error) { setError(error); }
      }
      try { applyPageState(await send({ type: 'GET_PAGE_STATE', refresh: true })); }
      catch (error) { setError(error); return; }
      renderUi();
    }).catch(setError);
  } else {
    document.addEventListener('click', event => {
      if ((menuOpen || navigationOpen) && !event.composedPath().includes(root)) closeMenu();
    });
    document.addEventListener('keydown', event => { if ((menuOpen || navigationOpen) && event.key === 'Escape') closeMenu(); });
    navigationCheck();
    setInterval(navigationCheck, 750);
  }
})();
