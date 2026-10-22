(() => {
  const ROOT_ID = 'clockoli-root';
  const POPUP_ROOT_ID = 'clockoli-popup-root';
  const TIMES_ROOT_ID = 'clockoli-times-root';
  const extensionPageMode = location.href.startsWith(chrome.runtime.getURL(''));
  const timesMode = extensionPageMode && location.pathname.endsWith('/src/times/times.html');
  const popupMode = extensionPageMode && !timesMode;
  const actionSurfaceMode = globalThis.__CLOCKOLI_ACTION_SURFACE__ === true;
  const STOPWATCH_PATH = 'M5.75.75A.75.75 0 0 1 6.5 0h3a.75.75 0 0 1 0 1.5h-.75v1l-.001.041a6.724 6.724 0 0 1 3.464 1.435l.007-.006.75-.75a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734l-.75.75-.006.007a6.75 6.75 0 1 1-10.548 0L2.72 5.03l-.75-.75a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018l.75.75.007.006A6.72 6.72 0 0 1 7.25 2.541V1.5H6.5a.75.75 0 0 1-.75-.75ZM8 14.5a5.25 5.25 0 1 0-.001-10.501A5.25 5.25 0 0 0 8 14.5Zm.389-6.7 1.33-1.33a.75.75 0 1 1 1.061 1.06L9.45 8.861A1.503 1.503 0 0 1 8 10.75a1.499 1.499 0 1 1 .389-2.95Z';

  const SYNC_PATH = 'M1.705 8.005a.75.75 0 0 1 .834.656 5.5 5.5 0 0 0 9.592 2.97l-1.204-1.204a.25.25 0 0 1 .177-.427h3.646a.25.25 0 0 1 .25.25v3.646a.25.25 0 0 1-.427.177l-1.38-1.38A7.002 7.002 0 0 1 1.05 8.84a.75.75 0 0 1 .656-.834ZM8 2.5a5.487 5.487 0 0 0-4.131 1.869l1.204 1.204A.25.25 0 0 1 4.896 6H1.25A.25.25 0 0 1 1 5.75V2.104a.25.25 0 0 1 .427-.177l1.38 1.38A7.002 7.002 0 0 1 14.95 7.16a.75.75 0 0 1-1.49.178A5.5 5.5 0 0 0 8 2.5Z';
  const TASKS_PATH = 'M2 2.75A.75.75 0 0 1 2.75 2h1.5a.75.75 0 0 1 0 1.5h-1.5A.75.75 0 0 1 2 2.75Zm4 0A.75.75 0 0 1 6.75 2h6.5a.75.75 0 0 1 0 1.5h-6.5A.75.75 0 0 1 6 2.75ZM2 8a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 0 1.5h-1.5A.75.75 0 0 1 2 8Zm4 0a.75.75 0 0 1 .75-.75h6.5a.75.75 0 0 1 0 1.5h-6.5A.75.75 0 0 1 6 8Zm-4 5.25a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 0 1.5h-1.5a.75.75 0 0 1-.75-.75Zm4 0a.75.75 0 0 1 .75-.75h6.5a.75.75 0 0 1 0 1.5h-6.5a.75.75 0 0 1-.75-.75Z';
  const ACTIVITY_PATH = 'M8 1.5A6.5 6.5 0 1 1 1.5 8a.75.75 0 0 1 1.5 0A5 5 0 1 0 8 3a4.96 4.96 0 0 0-3.535 1.465L5.53 5.53A.75.75 0 0 1 4.47 6.59L2.14 4.26a.75.75 0 0 1 0-1.06L4.47.87A.75.75 0 1 1 5.53 1.93l-.79.79A6.46 6.46 0 0 1 8 1.5Zm.75 3.25v2.94l1.78 1.78a.75.75 0 1 1-1.06 1.06l-2-2A.75.75 0 0 1 7.25 8V4.75a.75.75 0 0 1 1.5 0Z';
  const REPORTS_PATH = 'M1.75 1.5a.75.75 0 0 0-.75.75v11.5c0 .414.336.75.75.75h12.5a.75.75 0 0 0 0-1.5H2.5V2.25a.75.75 0 0 0-.75-.75Zm3.5 8a.75.75 0 0 0-.75.75v1.5a.75.75 0 0 0 1.5 0v-1.5a.75.75 0 0 0-.75-.75Zm3-3a.75.75 0 0 0-.75.75v4.5a.75.75 0 0 0 1.5 0v-4.5a.75.75 0 0 0-.75-.75Zm3-3a.75.75 0 0 0-.75.75v7.5a.75.75 0 0 0 1.5 0v-7.5a.75.75 0 0 0-.75-.75Z';
  const GEAR_PATH = 'M8 0a8.2 8.2 0 0 1 .701.031C9.444.095 9.99.645 10.16 1.29l.288 1.107c.018.066.079.158.212.224.231.114.454.243.668.386.123.082.233.09.299.071l1.103-.303c.644-.176 1.392.021 1.82.63.27.385.506.792.704 1.218.315.675.111 1.422-.364 1.891l-.814.806c-.049.048-.098.147-.088.294.016.257.016.515 0 .772-.01.147.038.246.088.294l.814.806c.475.469.679 1.216.364 1.891a7.977 7.977 0 0 1-.704 1.217c-.428.61-1.176.807-1.82.63l-1.102-.302c-.067-.019-.177-.011-.3.071a5.909 5.909 0 0 1-.668.386c-.133.066-.194.158-.211.224l-.29 1.106c-.168.646-.715 1.196-1.458 1.26a8.006 8.006 0 0 1-1.402 0c-.743-.064-1.289-.614-1.458-1.26l-.289-1.106c-.018-.066-.079-.158-.212-.224a5.738 5.738 0 0 1-.668-.386c-.123-.082-.233-.09-.299-.071l-1.103.303c-.644.176-1.392-.021-1.82-.63a8.12 8.12 0 0 1-.704-1.218c-.315-.675-.111-1.422.363-1.891l.815-.806c.05-.048.098-.147.088-.294a6.214 6.214 0 0 1 0-.772c.01-.147-.038-.246-.088-.294l-.815-.806C.635 6.045.431 5.298.746 4.623a7.92 7.92 0 0 1 .704-1.217c.428-.61 1.176-.807 1.82-.63l1.102.302c.067.019.177.011.3-.071.214-.143.437-.272.668-.386.133-.066.194-.158.211-.224l.29-1.106C6.009.645 6.556.095 7.299.03 7.53.01 7.764 0 8 0Zm3 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM9.5 8a1.5 1.5 0 1 0-3.001.001A1.5 1.5 0 0 0 9.5 8Z';
  let lastRoute = null;
  let tick = null;
  let actionAnimationTimer = null;
  let actionAnimationRunning = null;
  let actionAnimationFrame = 0;
  let actionAnimationReady = false;
  let timelineObserver = null;
  let participantAugmentationScheduled = false;
  let participantLoadId = 0;
  let participantData = null;
  let participantRetryTimer = null;
  const PARTICIPANT_RETRY_MS = 60_000;
  let pendingRefreshTimer = null;
  let navigationTimer = null;
  let extensionContextActive = true;
  let root = null;
  let shadow = null;
  let fullWidthPopupRoot = null;
  let fullWidthPopupShadow = null;
  let fullWidthPopupOpen = false;
  let timelineWindowTimer = null;
  let timelineView = null;
  let activityTimelineView = null;
  let activityInitialFocusPending = false;
  let activityInitialFocusMounted = false;
  let activityViewMode = 'timeline';
  const ACTIVITY_VIEW_KEY = 'clockoli:activity-view';
  if (timesMode) {
    try {
      const savedView = globalThis.localStorage?.getItem(ACTIVITY_VIEW_KEY);
      if (['timeline', 'calendar', 'list'].includes(savedView)) activityViewMode = savedView;
    } catch { /* unavailable storage keeps the default view */ }
  }
  let timelineViewMode = 'timeline';
  let timelineGraphicViewMode = 'timeline';
  let activityViewSelection = 0;
  let activityViewSave = null;
  async function restoreActivityViewMode() {
    const selection = activityViewSelection;
    try {
      const { mode } = await send({ type: 'GET_ACTIVITY_VIEW_MODE' });
      if (selection !== activityViewSelection) return;
      if (mode === null && timesMode && activityViewMode !== 'timeline') {
        await saveActivityViewMode(activityViewMode);
        return;
      }
      if (!['timeline', 'calendar', 'list'].includes(mode)) return;
      activityViewMode = mode;
      timelineViewMode = mode;
      if (mode !== 'list') timelineGraphicViewMode = mode;
      if (timesMode) {
        try { globalThis.localStorage?.setItem(ACTIVITY_VIEW_KEY, mode); } catch { /* storage may be unavailable */ }
      }
      applyCompactViewMode();
      if (timelineInstance && mode !== 'list') timelineInstance.setViewMode(mode);
      renderUi();
    } catch { /* keep the available local or default selection if the worker is offline */ }
  }
  function saveActivityViewMode(mode) {
    const selection = ++activityViewSelection;
    const save = () => send({ type: 'SET_ACTIVITY_VIEW_MODE', mode });
    activityViewSave = activityViewSave ? activityViewSave.catch(() => {}).then(save) : save();
    void activityViewSave.catch(error => { if (selection === activityViewSelection) setError(error); });
    return activityViewSave;
  }
  let timelineInstance = null;
  let timelineWindow = null;
  let timelineEntriesById = new Map();
  let timelineQueueIndicator = null;

  let timelineOptimisticEdits = new Map();
  const timelineOptimisticEditGenerations = new Map();
  const timelineOptimisticEditStates = new WeakMap();
  const timelineAcceptedEditOrders = new Map();
  const timelineQueuedOperationIds = new Map();
  const timelineQueueAcceptances = new Set();
  let timelineQueueAcceptanceSequence = 0;
  let timelineAcceptedActive = null;
  const timelineOptimisticCompletions = new Map();
  let timelineStartInFlight = false;
  let timelineStopInFlight = false;
  let timelineDeleteInFlight = false;
  let timelineScrollToRightPending = false;
  const inlineQueuedOperationIds = new Set();
  const inlineSavedNotices = new Map();
  function markInlineSaved(key) {
    const stamp = Date.now();
    inlineSavedNotices.set(key, stamp);
    setTimeout(() => {
      if (inlineSavedNotices.get(key) === stamp) {
        inlineSavedNotices.delete(key);
        if (extensionContextActive) renderUi();
      }
    }, 3000);
  }
  const queueDiagnostics = [];

  let menuOpen = false, menuScrollTop = 0;
  let descriptionDraft = null;
  const timelineDescriptionDrafts = new Map();
  let pageState = { configured: null, active: null, pendingCount: 0, pendingWrites: [], projects: [] };
  let recent = [];
  let quickStartRecent = [];
  let recentLoaded = false;
  let recentFresh = false;
  let recentFreshAfterPendingId = null;
  let loadingRecent = false;
  let suppressRecentRender = false;
  let recentLoad = null;
  let recentLoadId = 0;
  let timesLoadId = 0;
  let activityStateLoadId = 0;
  let activityCalendarLoadId = 0;
  let activityCalendarStatusText = '';
  let calendarWeekLoadingId = null, selectedTimesCalendarLoadingId = null;
  let completeVisualWeekStart = null;
  let selectedWeekStart = null;
  let suppressCalendarNavigate = false;
  let activeInlineKey = null;
  let timesFilter = '';
  let panelListFilter = '';
  const ACTIVITY_SEARCH_PAGE_SIZE = 20;
  let activitySearchPage = 0;
  let timesHasTrackedTime = null;
  let activitySearchEntries = null;
  let activitySearchLoading = false;
  let activitySearchError = '';
  let activitySearchPartial = false;
  let activitySearchTimer = null;
  let activitySearchGeneration = 0;
  let renderActivitySearch = null;
  let bulkDraft = '';
  let bulkMutation = false;
  let bulkOpen = false;
  let bulkFeedback = null;
  const ACTIVITY_HISTORY_RANGE = { startDate: '0001-01-01', endDate: '9999-12-31' };
  const inlineDrafts = new Map();
  const inlineEditors = new Map();
  const inlineBoundaryLinks = new Map();
  const inlineGroupSaves = new Map();
  let errorText = '';
  let errorCode = '';
  let todayReportDate = '';
  let summaryUpdatedAt = 0;
  let summaryActive = null;
  let connectionError = null;
  let compactSurface = null;
  let popupReturnFocus = null;
  let popupFocusPending = false;
  let popupOpening = false;
  let timeEntryFormLoad = null;
  let timeEntryFormHost = null;
  let timeEntryFormDialog = null;

  const LONG_ENTRY_HOURS = 12;
  const HOUR_MS = 3_600_000;
  const PANEL_TICK_MS = 1_000;
  const resolveTaskColor = globalThis.ClockoliTaskTimeline?.createColorResolver?.();
  const motionPreference = globalThis.matchMedia?.('(prefers-reduced-motion: no-preference)');
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
  function storedTaskIdentityOf(value) {
    const candidate = typeof value === 'string' ? value : value?.taskUrl ?? value?.issue?.url ?? value?.url;
    const url = normalizeTaskUrl(candidate);
    if (url) return url;
    if (typeof candidate !== 'string' || candidate.length > 2048) return null;
    const parts = candidate.split('/');
    return parts.length === 3 && /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(parts[0])
      && !parts[0].includes('--') && parts[1].length <= 100 && parts[1] !== '.' && parts[1] !== '..'
      && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(parts[1])
      && /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(parts[2]) ? candidate : null;
  }
  function trackableTaskIdentityOf(value) { return storedTaskIdentityOf(value); }
  function taskTitleOf(value) { return String(value?.taskTitle ?? value?.issueTitle ?? value?.title ?? '').trim().slice(0, 300); }
  function taskResult(value, className = '') {
    const taskUrl = taskUrlOf(value), identity = storedTaskIdentityOf(value), taskTitle = taskTitleOf(value);
    const result = el('div', undefined, `task-result${taskTitle ? '' : ' task-result-untitled'}${className ? ` ${className}` : ''}`);
    const url = el(taskTitle || !taskUrl ? 'div' : 'a', identity, 'task-url'); url.title = identity;
    if (!taskTitle && taskUrl) { url.href = taskUrl; url.target = '_blank'; url.rel = 'noreferrer'; }
    result.append(url);
    if (taskTitle) {
      const title = el(taskUrl ? 'a' : 'span', taskTitle, 'task-title');
      if (taskUrl) { title.href = taskUrl; title.target = '_blank'; title.rel = 'noreferrer'; }
      title.title = taskTitle; result.append(title);
    }
    return result;
  }

  function siteFavicon(value, className = '') {
    const image = el('img');
    image.className = `site-favicon${className ? ` ${className}` : ''}`;
    image.alt = '';
    image.width = 20;
    image.height = 20;
    image.referrerPolicy = 'no-referrer';
    try {
      const faviconUrl = siteFaviconUrl(value);
      if (faviconUrl === null) {
        const monogram = el('span', new URL(taskUrlOf(value)).hostname.replace(/^www\./, '').charAt(0).toUpperCase(), `${image.className} site-monogram`);
        monogram.setAttribute('aria-hidden', 'true');
        return monogram;
      }
      if (faviconUrl) image.src = faviconUrl;
      else image.hidden = true;
    }
    catch { image.hidden = true; }
    image.addEventListener('error', () => { image.hidden = true; }, { once: true });
    return image;
  }

  function siteFaviconUrl(value) {
    const pageUrl = taskUrlOf(value);
    if (!pageUrl) return '';
    if (!extensionContextActive) return '';
    try {
      if (!globalThis.chrome?.runtime?.getManifest?.()?.permissions?.includes('favicon')) return null;
    } catch (error) {
      if (!isExtensionContextInvalidated(error)) throw error;
      deactivateExtensionContext();
      return '';
    }
    const base = extensionResourceUrl('/_favicon/');
    if (!base) return '';
    try {
      const favicon = new URL(base);
      favicon.searchParams.set('pageUrl', pageUrl);
      favicon.searchParams.set('size', '32');
      return favicon.href;
    } catch { return ''; }
  }
  function taskFromUrl(value, title = '') {
    const taskUrl = normalizeTaskUrl(value);
    return taskUrl ? { taskUrl, taskTitle: String(title || '').trim().slice(0, 300) } : null;
  }
  function projectPaneIssueUrl(value) {
    try {
      const url = new URL(value);
      if (typeof value !== 'string' || value.length > 2048 || url.protocol !== 'https:'
          || url.hostname !== 'github.com' || url.username || url.password
          || !/^\/orgs\/[^/]+\/projects\/[1-9]\d*\/views\/[1-9]\d*\/?$/.test(url.pathname)
          || url.searchParams.getAll('pane').length !== 1 || url.searchParams.get('pane') !== 'issue'
          || url.searchParams.getAll('issue').length !== 1) return null;
      const parts = url.searchParams.get('issue').split('|');
      if (parts.length !== 3 || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(parts[0])
          || parts[0].includes('--') || !/^[A-Za-z0-9_.-]{1,100}$/.test(parts[1])
          || parts[1] === '.' || parts[1] === '..' || !/^[1-9]\d*$/.test(parts[2])
          || !Number.isSafeInteger(Number(parts[2]))) return null;
      return `https://github.com/${parts[0]}/${parts[1]}/issues/${Number(parts[2])}`;
    } catch { return null; }
  }
  function taskFromLocation() { return timesMode ? null : popupMode ? popupTask : taskFromUrl(projectPaneIssueUrl(location.href) || location.href, titleFromPage()); }
  function sameTask(left, right) { const a = storedTaskIdentityOf(left), b = storedTaskIdentityOf(right); return Boolean(a && b && a === b); }
  function activeDescriptionValue(active = pageState.active) {
    if (!active) return '';
    const id = active.id || active.startedAt;
    return descriptionDraft && descriptionDraft.id === id && descriptionDraft.taskUrl === taskUrlOf(active)
      ? descriptionDraft.value
      : timelineOptimisticEdits.get(id)?.description ?? active.description ?? '';
  }

  function savedActiveDescriptionValue(active = pageState.active) {
    if (!active) return '';
    return timelineOptimisticEdits.get(active.id || active.startedAt)?.description ?? active.description ?? '';
  }
  function normalizedDescription(value) {
    return String(value || '').replace(/\r\n?/g, '\n').replace(/\t/g, ' ')
      .replace(/ {2,}/g, ' ').trim().slice(0, 2000);
  }
  function fitDescriptionTextarea(field, { minRows = 1, maxRows = 8, maxHeight = 200, more = null } = {}) {
    const count = String(field.value || '').split('\n').length;
    // Rows work before a detached editor has any measurable scrollHeight.
    field.rows = Math.min(maxRows, Math.max(minRows, count));
    const measure = () => {
      field.style.height = 'auto';
      const height = Number(field.scrollHeight) || 0;
      const clipped = count > maxRows || height > maxHeight + 1;
      if (height) field.style.height = `${Math.min(maxHeight, Math.max(30, height))}px`;
      field.style.overflowY = clipped ? 'auto' : 'hidden';
      if (more) more.hidden = !clipped;
    };
    measure();
    // Refresh after mounting: wrapping depends on the actual available width.
    globalThis.requestAnimationFrame?.(() => { if (field.isConnected !== false) measure(); });
  }
  function retireActiveDescriptionDraft(active, value) {
    const id = active?.id || active?.startedAt;
    if (descriptionDraft?.id === id && descriptionDraft.taskUrl === taskUrlOf(active)
        && normalizedDescription(descriptionDraft.value) === value) descriptionDraft = null;
  }
  function projectNameForUrl(url, projects = [], otherProjectName = 'Other') {
    const candidate = String(url || '').toLowerCase();
    for (const project of projects || []) {
      if ((project.substrings || []).some(substring => candidate.includes(String(substring).toLowerCase()))) return project.name;
    }
    return String(otherProjectName || 'Other');
  }
  function projectRowId(name) { return `project:${String(name).toLowerCase()}`; }

  function trackedDurationSeconds(value) {
    const match = String(value || '').match(/^(?:(\d+)h )?(?:(\d+)m )?(\d+)s$/);
    if (!match) return null;
    const hours = Number(match[1] || 0), minutes = Number(match[2] || 0), seconds = Number(match[3]);
    return minutes < 60 && seconds < 60 ? hours * 3600 + minutes * 60 + seconds : null;
  }

  function formatTrackedDuration(totalSeconds) {
    const total = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    const hours = Math.floor(total / 3600), minutes = Math.floor((total % 3600) / 60), seconds = total % 60;
    return `${hours ? `${hours}h ` : ''}${minutes ? `${minutes}m ` : ''}${seconds}s`;
  }

  function formatCompactTrackedDuration(totalSeconds) {
    const total = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    const hours = Math.floor(total / 3600), minutes = Math.floor((total % 3600) / 60), seconds = total % 60;
    return [hours && `${hours}h`, minutes && `${minutes}m`, seconds && `${seconds}s`].filter(Boolean).join(' ') || '0s';
  }

  function clockoliTimelineRecord(value) {
    const login = '[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?';
    const match = String(value || '').replace(/\s+/g, ' ').trim().match(new RegExp(
      `^time: (${login}) tracked ((?:(?:\\d+h )?(?:\\d+m )?\\d+s)|<1m|(?:\\d+h(?: \\d+m)?|\\d+m)) on (${login})/([A-Za-z0-9_.-]{1,100})#([1-9]\\d*|…)(?: [0-9a-f]{7,40})?$`, 'i',
    ));
    return match ? {
      actor: match[1], duration: match[2], durationSeconds: trackedDurationSeconds(match[2]),
      owner: match[3], repo: match[4], number: match[5] === '…' ? null : Number(match[5]),
    } : null;
  }

  function mergePreviousClockoliTimelineItems(item, body, record, duration) {
    if (!item || record.durationSeconds === null) return null;
    let total = record.durationSeconds, previous = item.previousElementSibling;
    let firstTimestamp = null;
    while (previous) {
      const previousBody = previous.matches?.('[data-clockoli-time-summary]')
        ? previous : previous.querySelector?.('[data-clockoli-time-summary]');
      const previousActor = previousBody?.getAttribute('data-clockoli-time-actor');
      const previousSecondsValue = previousBody?.getAttribute('data-clockoli-time-seconds');
      if (!previousBody || previousSecondsValue === null
          || previousActor?.toLowerCase() !== record.actor.toLowerCase()) break;
      const previousSeconds = Number(previousSecondsValue);
      if (!Number.isSafeInteger(previousSeconds) || previousSeconds < 0) break;
      const beforePrevious = previous.previousElementSibling;
      const previousTimestamp = previousBody.querySelector?.('.clockoli-timeline-range-start')
        || previousBody.querySelector?.('.clockoli-commit-timestamp') || previousBody.querySelector?.('relative-time, time-ago');
      if (previousTimestamp) firstTimestamp = previousTimestamp;
      total += previousSeconds;
      previous.remove();
      previous = beforePrevious;
    }
    body.setAttribute('data-clockoli-time-seconds', String(total));
    duration.textContent = formatTrackedDuration(total);
    return firstTimestamp;
  }

  function beautifyClockoliTimeline(root = document) {
    const route = location.pathname.match(/^\/([^/]+)\/([^/]+)\/(?:issues|pull)\/([1-9]\d*)\/?$/i);
    if (!route || !root?.querySelectorAll) return;
    const candidates = root.matches?.('a[href*="/commit/"]') ? [root] : [];
    candidates.push(...root.querySelectorAll('a[href*="/commit/"]'));
    for (const commit of candidates) {
      if (commit.closest?.('[data-clockoli-time-summary]')) continue;
      const record = clockoliTimelineRecord(commit.title || commit.textContent);
      // GitHub may truncate the final issue number to `#…`. In that case the
      // ReferencedEvent's placement in the current issue timeline supplies the identity.
      if (!record || record.owner.toLowerCase() !== route[1].toLowerCase()
          || record.repo.toLowerCase() !== route[2].toLowerCase()
          || (record.number !== null && record.number !== Number(route[3]))) continue;
      let commitUrl;
      try { commitUrl = new URL(commit.href, location.href); } catch { continue; }
      if (commitUrl.protocol !== 'https:' || commitUrl.hostname !== 'github.com'
          || !/^\/[^/]+\/[^/]+\/commit\/[0-9a-f]{7,40}$/i.test(commitUrl.pathname)) continue;
      const body = commit.closest?.('.TimelineItem-body, .TimelineBody');
      if (!body) continue;
      const item = body.closest?.('.TimelineItem, .Timeline-Item')
        || body.closest?.('.js-timeline-item, [data-testid="timeline-item"]') || body;
      const originalTimestamp = body.querySelector?.('relative-time, time-ago');
      const timestamp = originalTimestamp ? el('a', undefined, 'clockoli-commit-timestamp') : null;
      if (timestamp) { timestamp.href = commitUrl.href; timestamp.append(originalTimestamp); }
      const summary = el('span', undefined, 'clockoli-timeline-summary');
      Object.assign(summary.style, {
        display: 'inline-flex', alignItems: 'center', gap: '4px', minHeight: '24px',
        color: 'var(--fgColor-muted,#59636e)',
      });
      const markUrl = extensionResourceUrl('src/assets/clockoli-32.png');
      if (!markUrl) return;
      const mark = el('img', undefined, 'clockoli-timeline-mark');
      mark.src = markUrl; mark.alt = ''; mark.setAttribute('aria-hidden', 'true');
      Object.assign(mark.style, { width: '16px', height: '16px', flexShrink: '0' });
      const legacyBadge = item.querySelector?.('.TimelineItem-badge');
      const reactBadgeWrapper = item.querySelector?.('[class*="TimelineBadgeWrapper"]');
      const badge = legacyBadge || reactBadgeWrapper?.firstElementChild
        || reactBadgeWrapper?.children?.[0] || reactBadgeWrapper;
      badge?.replaceChildren(mark);
      const avatarLink = el('a', undefined, 'd-inline-block');
      avatarLink.href = `https://github.com/${record.actor}`;
      avatarLink.setAttribute('data-hovercard-type', 'user');
      avatarLink.setAttribute('data-hovercard-url', `/users/${record.actor}/hovercard`);
      const avatar = el('img', undefined, 'avatar avatar-user');
      avatar.src = `https://github.com/${record.actor}.png?size=40`;
      avatar.width = 20; avatar.height = 20; avatar.alt = `@${record.actor}`;
      avatarLink.append(avatar);
      const actor = el('a', record.actor, 'author Link--primary text-bold');
      actor.href = `https://github.com/${record.actor}`;
      actor.setAttribute('data-hovercard-type', 'user');
      actor.setAttribute('data-hovercard-url', `/users/${record.actor}/hovercard`);
      const duration = el('span', record.duration, 'clockoli-timeline-duration'); duration.style.fontWeight = '600';
      summary.append(avatarLink, actor, document.createTextNode(' tracked '), duration);
      body.setAttribute('data-clockoli-time-summary', 'true');
      body.setAttribute('data-clockoli-time-actor', record.actor);
      if (record.durationSeconds !== null) body.setAttribute('data-clockoli-time-seconds', String(record.durationSeconds));
      body.replaceChildren(summary);
      const firstTimestamp = mergePreviousClockoliTimelineItems(item, body, record, duration);
      if (timestamp && firstTimestamp) {
        const rangeStartLabel = 'fr' + 'om';
        firstTimestamp.classList.add('clockoli-timeline-range-start');
        summary.append(document.createTextNode(` ${rangeStartLabel} `), firstTimestamp, document.createTextNode(' to '), timestamp);
      } else if (timestamp) summary.append(document.createTextNode(' '), timestamp);
    }
  }

  function participantLogin(node) {
    return String(node?.getAttribute?.('data-hovercard-url') || '')
      .match(/^\/users\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)\/hovercard$/i)?.[1] || '';
  }

  function createClockoliParticipant(login) {
    const participant = el('a', undefined, 'participant-avatar');
    participant.href = `https://github.com/${login}`;
    participant.setAttribute('data-hovercard-type', 'user');
    participant.setAttribute('data-hovercard-url', `/users/${login}/hovercard`);
    participant.setAttribute('data-clockoli-created-participant', 'true');
    const avatar = el('img', undefined, 'avatar avatar-user');
    avatar.src = `https://github.com/${login}.png?size=52`;
    avatar.width = 26; avatar.height = 26; avatar.alt = `@${login}`;
    participant.append(avatar);
    return participant;
  }

  function effectiveParticipantSeconds(value) {
    const completed = Number(value?.totalSeconds);
    if (!Number.isSafeInteger(completed) || completed < 0) return null;
    if (!value.activeStartedAt) return completed;
    const startedAt = new Date(value.activeStartedAt).getTime();
    if (!Number.isFinite(startedAt)) return null;
    return completed + Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  }

  function findNativeParticipantsSection() {
    const stale = document.querySelector?.('[data-clockoli-participants-section="true"]');
    stale?.remove();
    return document.querySelector?.('#partial-users-participants')
      || document.querySelector?.('[data-testid="sidebar-participants-section"]') || null;
  }

  function augmentClockoliParticipants() {
    const taskUrl = taskUrlOf(taskFromLocation());
    const source = participantData?.complete && participantData.taskUrl === taskUrl
      ? participantData.participants : [];
    const totals = new Map();
    for (const value of source ?? []) {
      const login = String(value?.login || '');
      if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(login)) continue;
      const seconds = effectiveParticipantSeconds(value);
      if (seconds === null) continue;
      totals.set(login.toLowerCase(), { ...value, login, seconds });
    }
    const participants = findNativeParticipantsSection();
    if (!participants?.querySelectorAll) return;
    const existingParticipants = [...participants.querySelectorAll(
      '.participant-avatar, a[data-hovercard-type="user"][data-hovercard-url^="/users/"]',
    )];
    const byLogin = new Map(existingParticipants.map(participant => [participantLogin(participant).toLowerCase(), participant])
      .filter(([login]) => login));
    const container = existingParticipants[0]?.parentElement
      || participants.querySelector?.('.participation-avatars')
      || participants.querySelector?.('[class*="participantsListContainer"]') || participants;
    for (const participant of existingParticipants) {
      const login = participantLogin(participant).toLowerCase();
      if (participant.getAttribute?.('data-clockoli-created-participant') === 'true' && !totals.has(login)) {
        participant.remove(); byLogin.delete(login); continue;
      }
      const existing = participant.querySelector?.('.clockoli-participant-time');
      if (!login || !totals.has(login)) {
        existing?.remove();
        if (existing) { participant.style.display = ''; participant.style.alignItems = ''; }
        continue;
      }
    }
    for (const [key, value] of totals) {
      let participant = byLogin.get(key);
      if (!participant) {
        participant = createClockoliParticipant(value.login);
        container.append(participant); byLogin.set(key, participant);
      }
      const existing = participant.querySelector?.('.clockoli-participant-time');
      const duration = formatCompactTrackedDuration(value.seconds);
      const label = existing || el('span', undefined, 'clockoli-participant-time');
      if (label.textContent !== duration) label.textContent = duration;
      const tooltip = `${value.login} tracked ${duration}${value.activeStartedAt ? ', including the active timer' : ''}`;
      label.setAttribute('data-clockoli-tooltip', tooltip);
      label.setAttribute('aria-label', tooltip);
      Object.assign(label.style, {
        display: 'inline-block', marginLeft: '4px', padding: '0 4px', borderRadius: '6px',
        color: 'var(--fgColor-accent,#0969da)', background: 'var(--bgColor-accent-muted,#ddf4ff)',
        fontSize: '11px', fontWeight: '600', lineHeight: '18px', whiteSpace: 'nowrap',
      });
      participant.style.display = 'inline-flex'; participant.style.alignItems = 'center';
      if (!existing) participant.append(label);
    }
  }

  function clearClockoliParticipantRetry() {
    if (participantRetryTimer === null) return;
    if (typeof clearTimeout === 'function') clearTimeout(participantRetryTimer);
    participantRetryTimer = null;
  }

  function isExtensionContextInterruption(error) {
    if (error?.code === 'extension_context_interrupted') return true;
    const message = String(error?.message || '');
    return message === 'Extension context invalidated.'
      || message.includes('message port closed before a response was received')
      || message.includes('message channel closed before a response was received');
  }

  function isExtensionContextInvalidated(error) {
    return String(error?.message || '') === 'Extension context invalidated.';
  }

  function extensionResourceUrl(path) {
    if (!extensionContextActive) return null;
    try { return globalThis.chrome?.runtime?.getURL?.(path) || null; }
    catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      if (isExtensionContextInvalidated(error)) deactivateExtensionContext();
      return null;
    }
  }

  function deactivateExtensionContext() {
    if (!extensionContextActive) return;
    extensionContextActive = false;
    clearInterval(tick); tick = null;
    clearInterval(actionAnimationTimer); actionAnimationTimer = null;
    clearInterval(navigationTimer); navigationTimer = null;
    clearInterval(timelineWindowTimer); timelineWindowTimer = null;
    if (typeof clearTimeout === 'function') clearTimeout(pendingRefreshTimer); pendingRefreshTimer = null;
    clearClockoliParticipantRetry();
    timelineObserver?.disconnect?.(); timelineObserver = null;
  }

  function scheduleClockoliParticipantRetry(taskUrl, error) {
    clearClockoliParticipantRetry();
    if (error?.name === 'AbortError' || error?.code === 'aborted'
        || error?.code === 'incomplete_participant_totals'
        || isExtensionContextInterruption(error)) return;
    console.warn('Clockoli participant totals are temporarily unavailable.', error);
    if (error?.code === 'task_scan_budget') return;
    participantRetryTimer = setTimeout(() => {
      participantRetryTimer = null;
      if (taskUrlOf(taskFromLocation()) === taskUrl) void refreshClockoliParticipants();
    }, PARTICIPANT_RETRY_MS);
  }

  async function refreshClockoliParticipants() {
    const task = taskFromLocation(), taskUrl = taskUrlOf(task);
    clearClockoliParticipantRetry();
    if (!taskUrl || !/^\/[^/]+\/[^/]+\/(?:issues|pull)\/[1-9]\d*\/?$/i.test(location.pathname)) {
      participantLoadId += 1; clearClockoliParticipantRetry(); participantData = null; scheduleClockoliParticipantAugmentation(); return;
    }
    const loadId = ++participantLoadId;
    try {
      const result = await send({ type: 'LOAD_TASK_PARTICIPANTS', taskUrl });
      if (loadId !== participantLoadId || taskUrlOf(taskFromLocation()) !== taskUrl) return;
      if (result?.configured === false) {
        participantData = null;
        scheduleClockoliParticipantAugmentation();
        return;
      }
      if (!result?.complete || result.taskUrl !== taskUrl || !Array.isArray(result.participants)) {
        const error = new Error(result?.error?.message || 'Clockoli participant totals did not load completely.');
        error.code = result?.error?.code || 'incomplete_participant_totals';
        throw error;
      }
      participantData = result;
      scheduleClockoliParticipantAugmentation();
    } catch (error) {
      if (loadId !== participantLoadId || taskUrlOf(taskFromLocation()) !== taskUrl) return;
      scheduleClockoliParticipantRetry(taskUrl, error);
    }
  }

  function scheduleClockoliParticipantAugmentation() {
    if (participantAugmentationScheduled) return;
    participantAugmentationScheduled = true;
    const run = () => { participantAugmentationScheduled = false; augmentClockoliParticipants(); };
    if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 500 });
    else setTimeout(run, 0);
  }

  function watchClockoliTimeline() {
    beautifyClockoliTimeline();
    scheduleClockoliParticipantAugmentation();
    if (timelineObserver || typeof MutationObserver !== 'function') return;
    timelineObserver = new MutationObserver(mutations => {
      for (const mutation of mutations) beautifyClockoliTimeline(mutation.target);
      scheduleClockoliParticipantAugmentation();
    });
    timelineObserver.observe(document.body || document.documentElement, { childList: true, subtree: true });
  }

  async function refreshPopupTask() {
    if (!popupMode) return taskFromLocation();
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    popupTask = taskFromUrl(projectPaneIssueUrl(tab?.url) || tab?.url, tab?.title || '');
    return popupTask;
  }

  function send(message) {
    const runtime = globalThis.chrome?.runtime;
    if (typeof runtime?.sendMessage !== 'function') {
      const error = new Error('Extension context interrupted');
      error.code = 'extension_context_interrupted';
      return Promise.reject(error);
    }
    return new Promise((resolve, reject) => {
      if (!extensionContextActive) {
        const error = new Error('Extension context invalidated.'); error.code = 'extension_context_interrupted'; reject(error); return;
      }
      try {
        chrome.runtime.sendMessage(message, response => {
          if (chrome.runtime.lastError) {
            const error = new Error(chrome.runtime.lastError.message);
            if (isExtensionContextInterruption(error)) error.code = 'extension_context_interrupted';
            if (isExtensionContextInvalidated(error)) deactivateExtensionContext();
            return reject(error);
          }
          if (!response?.ok) return reject(Object.assign(new Error(response?.error?.message || 'Extension request failed'), response?.error));
          resolve(response.data);
        });
      } catch (cause) {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        if (isExtensionContextInterruption(error)) error.code = 'extension_context_interrupted';
        if (isExtensionContextInvalidated(error)) deactivateExtensionContext();
        reject(error);
      }
    });
  }

  function updateTaskAnimation() {
    if (popupMode || timesMode) return;
    if (!actionAnimationReady) return;
    const running = motionPreference?.matches !== false && document.hidden !== true && sameTask(taskFromLocation(), pageState.active);
    if (running === actionAnimationRunning) return;
    actionAnimationRunning = running;
    clearInterval(actionAnimationTimer); actionAnimationTimer = null;
    if (!running) {
      void send({ type: 'SET_ACTION_ICON_FRAME', frame: null }).catch(() => {});
      return;
    }
    actionAnimationFrame = 0;
    const advance = () => {
      void send({ type: 'SET_ACTION_ICON_FRAME', frame: actionAnimationFrame }).catch(() => {});
      actionAnimationFrame = (actionAnimationFrame + 1) % 8;
    };
    advance();
    actionAnimationTimer = setInterval(advance, 125);
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

  function clockoliMark(size = 22) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '65 78 296 310'); svg.setAttribute('width', String(size)); svg.setAttribute('height', String(size));
    svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', 'clockoli-mark');
    const shape = (tag, attributes) => {
      const node = document.createElementNS(ns, tag);
      for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
      svg.append(node); return node;
    };
    shape('path', {
      d: 'M136 257C142 269 148 281 149 301L149 350C149 368 161 379 178 380L244 380C262 380 274 370 275 352L275 303C276 283 282 271 289 259C274 251 256 247 236 246L188 246C168 247 151 250 136 257Z',
      fill: '#b9e477', stroke: '#16834f', 'stroke-width': '7', 'stroke-linejoin': 'round',
    });
    shape('path', {
      d: 'M136 263C126 271 111 275 98 270C81 264 72 246 74 226C76 204 87 187 103 180C101 162 109 146 123 135C132 128 142 124 154 124C165 102 186 89 210 89C237 89 259 102 271 123C290 121 307 129 318 142C327 152 331 165 329 178C344 184 352 200 353 219C354 241 344 260 327 269C313 277 297 274 287 266C280 272 270 276 259 275C248 274 240 268 235 258C230 266 222 270 211 270C201 270 192 266 186 257C181 266 171 271 160 271C150 271 142 268 136 263Z',
      fill: '#69c647', stroke: '#16834f', 'stroke-width': '7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    });
    shape('path', { d: 'M211 220L164 178M211 220L280 150', fill: 'none', stroke: '#fff', 'stroke-width': '11', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
    shape('circle', { cx: '211', cy: '220', r: '13', fill: '#fff' });
    shape('circle', { cx: '211', cy: '220', r: '6', fill: '#69c647' });
    return svg;
  }

  function clockoliWordmark() {
    const image = el('img');
    image.className = 'clockoli-wordmark';
    image.src = extensionResourceUrl('src/assets/clockoli-with-text.svg') || '';
    image.alt = 'Clockoli';
    return image;
  }

  function formatElapsed(startedAt) {
    const minutes = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 60_000));
    return [Math.floor(minutes / 60), minutes % 60].map(value => String(value).padStart(2, '0')).join(':');
  }
  function formatElapsedCard(startedAt) {
    return formatDuration(Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 60_000)) * 60);
  }

  function formatDuration(seconds) {
    const minutes = Math.round(seconds / 60), hours = Math.floor(minutes / 60), rest = minutes % 60;
    return hours ? `${hours}h ${rest}m` : `${rest}m`;
  }

  function localDateValue(date = new Date()) {
    const pad = value => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function timesRange() {
    const start = new Date(weekWindow().start), end = new Date(start);
    end.setDate(end.getDate() + 6);
    return { startDate: localDateValue(start), endDate: localDateValue(end) };
  }

  function weekWindow(value = selectedWeekStart ?? Date.now()) {
    const day = new Date(value);
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() - (day.getDay() + 6) % 7);
    const end = new Date(day);
    end.setDate(end.getDate() + 7);
    return { start: day.getTime(), end: end.getTime() };
  }

  function resetWeekForViewSwitch() {
    selectedWeekStart = null;
    activityTimelineView = null;
    activityInitialFocusPending = false;
    activityInitialFocusMounted = false;
    timelineView = null;
    ++activityCalendarLoadId;
    calendarWeekLoadingId = null;
    selectedTimesCalendarLoadingId = null;
    updateCalendarWeekLoading();
    if (timelineInstance?.setCalendarRange) {
      suppressCalendarNavigate = true;
      try { timelineInstance.setCalendarRange(weekWindow()); }
      finally { suppressCalendarNavigate = false; }
    }
    const navigation = (fullWidthPopupShadow || shadow)?.querySelector('.week-navigation');
    const { startDate, endDate } = timesRange();
    const label = navigation?.querySelector('.week-navigation-label');
    if (label) label.textContent = `${startDate} – ${endDate}`;
    const next = navigation?.querySelector('[aria-label="Next week"]');
    if (next) next.disabled = true;
  }

  function weekNavigation() {
    const navigation = el('div', undefined, 'week-navigation');
    navigation.setAttribute('role', 'group');
    navigation.setAttribute('aria-label', 'Browse weeks');
    const label = el('span', undefined, 'week-navigation-label');
    let nextControl;
    const updateNavigation = () => {
      const { startDate, endDate } = timesRange();
      label.textContent = (timesMode && activityViewMode === 'list') || ((popupMode || fullWidthPopupOpen) && timelineViewMode === 'list')
        ? activityWeekRangeLabel({ startDate, endDate }) : `${startDate} – ${endDate}`;
      nextControl.disabled = weekWindow().start >= weekWindow(Date.now()).start;
    };
    for (const [direction, name, glyph] of [[-1, 'Previous week', '‹'], [1, 'Next week', '›']]) {
      const control = button(glyph, 'secondary week-navigation-button', async () => {
        try { await shiftWeek(direction); }
        finally { updateNavigation(); }
      });
      control.setAttribute('aria-label', name);
      if (direction < 0) navigation.append(control, label);
      else { nextControl = control; navigation.append(control); }
    }
    updateNavigation();
    return navigation;
  }

  function updateWeekNavigationLabel() {
    const { startDate, endDate } = timesRange();
    for (const scope of [shadow, fullWidthPopupShadow]) {
      const navigation = scope?.querySelector('.week-navigation');
      const label = navigation?.querySelector('.week-navigation-label');
      if (label) label.textContent = (timesMode && activityViewMode === 'list') || ((popupMode || fullWidthPopupOpen) && timelineViewMode === 'list')
        ? activityWeekRangeLabel({ startDate, endDate }) : `${startDate} – ${endDate}`;
      const next = navigation?.querySelector('[aria-label="Next week"]');
      if (next) next.disabled = weekWindow().start >= weekWindow(Date.now()).start;
    }
  }

  function updateCalendarWeekLoading() {
    const active = calendarWeekLoadingId !== null || selectedTimesCalendarLoadingId !== null;
    for (const scope of [shadow, fullWidthPopupShadow]) {
      const overlay = scope?.querySelector('.calendar-week-loading');
      if (overlay) overlay.hidden = !active || (timesMode ? activityViewMode !== 'calendar' : timelineViewMode !== 'calendar');
    }
  }

  function placeCalendarWeekNavigation(root, mode) {
    const host = root.querySelector('.task-timeline-host');
    if (!host) return;
    const navigation = [...root.querySelectorAll('.week-navigation')].find(node => node.parentElement !== host)
      || host.querySelector('.week-navigation');
    if (!navigation) return;
    const oldNavigation = host.querySelector('.week-navigation');
    if (oldNavigation && oldNavigation !== navigation) oldNavigation.remove();
    const activityChart = timesMode || popupMode || fullWidthPopupOpen ? root.querySelector('.timeline-shell') : null;
    const oldChartNavigation = activityChart?.querySelector('.week-navigation');
    if (oldChartNavigation && oldChartNavigation !== navigation) oldChartNavigation.remove();
    activityChart?.classList.toggle('calendar-week-navigation', mode === 'calendar');
    if (activityChart && mode !== 'list') {
      navigation.removeAttribute('slot');
      activityChart.append(navigation);
    } else if ((popupMode || fullWidthPopupOpen) && mode === 'list') {
      navigation.removeAttribute('slot');
      const toolbar = root.querySelector('.popup-list-toolbar');
      if (toolbar) toolbar.insertBefore(navigation, toolbar.querySelector('.times-refresh'));
    } else if (mode === 'calendar') {
      navigation.slot = 'week-navigation';
      host.append(navigation);
    } else if (navigation.parentElement === host) {
      navigation.removeAttribute('slot');
      root.insertBefore(navigation, root.querySelector(timesMode ? '.times-list-total' : '.timeline-shell'));
    }
  }

  function shiftWeek(direction) {
    const current = new Date(weekWindow().start);
    current.setDate(current.getDate() + 7 * direction);
    if (current.getTime() > weekWindow(Date.now()).start) return;
    const previousWeek = selectedWeekStart;
    const previousActivityView = activityTimelineView, previousTimelineView = timelineView;
    const previousInitialFocusPending = activityInitialFocusPending;
    const previousInitialFocusMounted = activityInitialFocusMounted;
    selectedWeekStart = current.getTime();
    activityTimelineView = null;
    activityInitialFocusPending = false;
    activityInitialFocusMounted = false;
    timelineView = null;
    const range = weekWindow();
    if (timelineInstance?.setCalendarRange) {
      suppressCalendarNavigate = true;
      try { timelineInstance.setCalendarRange(range); }
      finally { suppressCalendarNavigate = false; }
    }
    if (timesMode) return loadSelectedTimes(previousLoaded => {
      if (selectedWeekStart !== current.getTime()) return;
      selectedWeekStart = previousWeek;
      activityTimelineView = previousActivityView;
      activityInitialFocusPending = previousInitialFocusPending;
      activityInitialFocusMounted = previousInitialFocusMounted;
      timelineView = previousTimelineView;
      recentLoaded = previousLoaded;
      suppressCalendarNavigate = true;
      try { timelineInstance?.setCalendarRange?.(weekWindow()); }
      finally { suppressCalendarNavigate = false; }
    });
    return loadActivityCalendarWeek(range).then(loaded => {
      if (loaded === false && selectedWeekStart === current.getTime()) {
        selectedWeekStart = previousWeek;
        timelineView = null;
        suppressCalendarNavigate = true;
        try { timelineInstance?.setCalendarRange?.(weekWindow()); }
        finally { suppressCalendarNavigate = false; }
        refreshMountedTimeline();
      }
    });
  }

  function activityPeriodTimelineView(now) {
    const { start, end } = weekWindow();
    return { start, end, focusedAt: Math.min(now, end - 1) };
  }

  function activityTotalRange() {
    return weekWindow();
  }

  function listWeekTotalText() {
    if (!recentLoaded) return 'Total: …';
    const { start, end } = weekWindow();
    const now = Math.min(timelineNow(), end - 1);
    const { items } = popupTimelineItems(start, now);
    const total = items.reduce((sum, item) => {
      const stop = item.isRunning ? now : item.endedAt;
      return sum + Math.max(0, Math.min(stop, end, Date.now()) - Math.max(item.startedAt, start));
    }, 0);
    const minutes = Math.floor(total / 60_000);
    return `Total: ${minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ''}`}`;
  }

  function activityWeekRangeLabel(range) {
    const month = date => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
    return `${month(range.startDate)} ${Number(range.startDate.slice(-2))}–${range.startDate.slice(0, 7) === range.endDate.slice(0, 7) ? '' : `${month(range.endDate)} `}${Number(range.endDate.slice(-2))}`;
  }

  function updateActivityWeekSummary() {
    const sections = [document.getElementById?.('activity-summary')?.querySelector('.activity-weekly-summary'),
      compactSurface?.summary].filter(section => section?.isConnected);
    if (!sections.length) return;
    const range = timesRange();
    const week = weekWindow(), now = Math.min(timelineNow(), week.end - 1);
    const summary = recentLoaded && !loadingRecent && (timesMode || (recentFresh && completeVisualWeekStart === week.start))
      ? globalThis.ClockoliWeeklySummary?.summarize(popupTimelineItems(week.start, now).items, week.start, week.end, now)
      : null;
    for (const section of sections) {
      const span = section.querySelector('.activity-weekly-range');
      if (span) {
        span.textContent = timesMode || popupMode || fullWidthPopupOpen
          ? activityWeekRangeLabel(range)
          : `${range.startDate} – ${range.endDate}`;
      }
      for (const element of section.querySelectorAll('[data-stat]')) {
        element.textContent = summary ? String(summary[element.getAttribute('data-stat')]) : '—';
      }
    }
  }

  function updateListWeekTotal() {
    for (const scope of [shadow, fullWidthPopupShadow]) {
      const total = scope?.querySelector('.times-list-total,.popup-list-total');
      if (total) total.textContent = listWeekTotalText();
    }
    updateActivityWeekSummary();
  }

  function focusActivityCalendarPeriod() {
    if (activityViewMode !== 'calendar' || !timelineInstance?.setCalendarRange) return;
    const window = weekWindow();
    const current = timelineInstance.getCalendarRange?.();
    if (current?.start === window.start && current?.end === window.end) return;
    suppressCalendarNavigate = true;
    try { timelineInstance.setCalendarRange(window); }
    finally { suppressCalendarNavigate = false; }
  }

  function activityRecordDate(entry) {
    return entry.entryDate || localDateValue(new Date(entry.startedAt));
  }

  function overlapsSelectedWeek(entry) {
    const { start, end } = weekWindow();
    const started = new Date(entry.startedAt).getTime(), ended = new Date(entry.endedAt).getTime();
    return Number.isFinite(started) && Number.isFinite(ended) && started < end && ended > start;
  }

  function activityRecordKey(entry) {
    return `${entry.destinationId || ''}\n${entry._path}\n${entry.id}`;
  }

  function mergeActivityRecords(incoming, range, partial = false) {
    const start = new Date(`${range.startDate}T00:00:00`).getTime();
    const inRange = entry => {
      const date = activityRecordDate(entry);
      return date <= range.endDate && (date >= range.startDate || new Date(entry.endedAt).getTime() > start);
    };
    const records = new Map(recent.filter(entry => partial || !inRange(entry)).map(entry => [activityRecordKey(entry), entry]));
    for (const entry of incoming) records.set(activityRecordKey(entry), entry);
    return [...records.values()].sort((left, right) => new Date(right.startedAt) - new Date(left.startedAt));
  }

  async function loadActivityCalendarWeek(range, { showLoading = true } = {}) {
    if (!range || !Number.isFinite(range.start) || !Number.isFinite(range.end) || range.end <= range.start) return;
    if (timesMode && (loadingRecent || selectedTimesCalendarLoadingId !== null)) {
      ++timesLoadId;
      ++recentLoadId;
      recentLoad = null;
      loadingRecent = false;
      selectedTimesCalendarLoadingId = null;
    }
    const nextWeek = weekWindow(range.start).start;
    (timesMode ? shadow : fullWidthPopupShadow || shadow)?.querySelector('.timeline-edit-error')?.remove();
    const previousWeek = selectedWeekStart;
    const previousActivityView = activityTimelineView, previousTimelineView = timelineView;
    if (selectedWeekStart !== nextWeek) {
      selectedWeekStart = nextWeek;
      activityTimelineView = null;
      timelineView = null;
    }
    const loadId = ++activityCalendarLoadId;
    if (!timesMode) {
      completeVisualWeekStart = null;
      refreshMountedTimeline();
    }
    const payload = { startDate: localDateValue(new Date(range.start)), endDate: localDateValue(new Date(range.end - 1)) };
    if (showLoading) calendarWeekLoadingId = loadId;
    updateCalendarWeekLoading();
    const setStatus = text => {
      activityCalendarStatusText = text;
      const status = shadow?.querySelector('.times-calendar-status');
      if (status) status.textContent = text;
    };
    setStatus('Loading week…');
    try {
      const data = await send({ type: timesMode ? 'LOAD_TIMES' : 'LOAD_WEEK', payload });
      if (loadId !== activityCalendarLoadId) return;
      if (!data?.configured || !Array.isArray(data.recent)) throw new Error('Calendar week could not be loaded.');
      recent = mergeActivityRecords(data.recent, payload, Boolean(data.partial));
      if (!timesMode && !data.partial) completeVisualWeekStart = nextWeek;
      recentLoaded = true; recentFresh = !data.partial;
      const refreshed = refreshMountedTimeline();
      if (!refreshed || (timesMode && activityViewMode === 'list')) renderUi();
      setStatus(data.partial ? 'Some records could not be loaded.' : '');
      if (data.partial) setError(new Error('Some Calendar records could not be loaded. Retry by navigating away and back.'));
      return !data.partial;
    } catch (error) {
      if (loadId === activityCalendarLoadId) {
        selectedWeekStart = previousWeek;
        activityTimelineView = previousActivityView;
        timelineView = previousTimelineView;
        if (timelineInstance?.setCalendarRange) {
          suppressCalendarNavigate = true;
          try { timelineInstance.setCalendarRange(weekWindow()); }
          finally { suppressCalendarNavigate = false; }
        }
        refreshMountedTimeline();
        if (error?.name === 'AbortError' || error?.code === 'aborted') setStatus('');
        else { setStatus('Could not load this week.'); setError(error); }
        return false;
      }
    } finally {
      if (calendarWeekLoadingId === loadId) {
        calendarWeekLoadingId = null;
        updateCalendarWeekLoading();
      }
    }
  }

  function applyTrackedTotals(data) {
    pageState = { ...pageState, todayTrackedMs: data?.todayTrackedMs ?? null, weekTrackedMs: data?.weekTrackedMs ?? null,
      remoteWriteConfirmed: data?.remoteWriteConfirmed === true, summaryError: data?.summaryError ?? null };
    summaryUpdatedAt = Date.now(); summaryActive = pageState.active;
    todayReportDate = data?.reportDate || localDateValue();
  }

  function trackedTotalText(key) {
    const value = pageState[key];
    if (value == null || pageState.summaryError || todayReportDate !== localDateValue()) return '…';
    const today = localDateValue(), monday = new Date(`${today}T12:00:00`);
    monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7);
    const startDate = key === 'todayTrackedMs' ? today : localDateValue(monday);
    const activeDate = summaryActive?.entryDate;
    const ticking = activeDate && activeDate >= startDate && activeDate <= today
      && summaryActive?.startedAt === pageState.active?.startedAt && sameTask(summaryActive, pageState.active);
    return formatDuration((value + (ticking ? Math.max(0, Date.now() - summaryUpdatedAt) : 0)) / 1000);
  }

  function confirmLongEntry(active = pageState.active) {
    const hours = active ? (Date.now() - new Date(active.startedAt).getTime()) / HOUR_MS : 0;
    return hours <= LONG_ENTRY_HOURS || confirm(`This entry is ${Math.floor(hours)} hours long. Save anyway?`);
  }


  function reconcileQueuedInlineOperations(pendingIds) {
    let completed = false;
    for (const id of inlineQueuedOperationIds) if (!pendingIds.has(id)) { inlineQueuedOperationIds.delete(id); completed = true; }
    if (completed) void refreshRecent(true).catch(setError);
  }

  function trackTimelineQueuedOperation(operationId, entryId, generation = null) {
    if (!operationId) return;
    const tracked = timelineQueuedOperationIds.get(operationId);
    if (generation && tracked && typeof tracked !== 'string' && tracked.entryId === entryId) {
      tracked.generations.add(generation);
      return;
    }
    timelineQueuedOperationIds.set(operationId, generation
      ? { entryId, generations: new Set([generation]) }
      : entryId);
  }

  function reconcileTimelineQueuedOperations(pendingIds) {
    for (const [id, tracked] of timelineQueuedOperationIds) {
      if (pendingIds.has(id)) continue;
      timelineQueuedOperationIds.delete(id);
      const entryId = typeof tracked === 'string' ? tracked : tracked.entryId;
      const generations = typeof tracked === 'string' ? null : tracked.generations;
      for (const generation of generations || []) {
        const generationState = timelineOptimisticEditStates.get(generation);
        if (generationState) generationState.settled = true;
      }
      const currentGeneration = timelineOptimisticEditGenerations.get(entryId);
      if (!generations || generations.has(currentGeneration)) {
        timelineOptimisticEdits.delete(entryId);
        timelineOptimisticEditGenerations.delete(entryId);
      }
    }
  }


  function reconcileTimelineAcceptedActive(incomingState) {
    const accepted = timelineAcceptedActive;
    const incoming = incomingState?.active ?? null;
    const incomingConfirmsAccepted = accepted && incoming
      && taskUrlOf(incoming) === taskUrlOf(accepted)
      && new Date(incoming.startedAt).getTime() >= new Date(accepted.startedAt).getTime();
    if (incomingConfirmsAccepted) timelineAcceptedActive = null;
    return accepted && !incomingConfirmsAccepted
      ? { ...incomingState, active: accepted }
      : incomingState;
  }

  function applyMenuData(data, fresh = true) {
    const incoming = Array.isArray(data) ? data : data?.recent ?? [];
    if (!timesMode && Array.isArray(data?.recent)) quickStartRecent = data.recent;
    recent = recentLoaded && (timesMode || selectedWeekStart !== null)
      ? mergeActivityRecords(incoming, timesRange(), Boolean(data?.partial) || !timesMode) : incoming;
    if (!Array.isArray(data)) {
      pageState = reconcileTimelineAcceptedActive({
        ...pageState, configured: data?.configured !== false,
        active: timesMode && data?.active === undefined && data?.configured !== false ? pageState.active : data?.active ?? null,
        pendingCount: Math.max(0, Number(data?.pendingCount) || 0), pendingWrites: data?.pendingWrites ?? [],
        partial: Boolean(data?.partial), readStatus: data?.readStatus ?? [], readConflicts: data?.conflicts ?? [],
      });
      // Range reads contain records, not the local daily/weekly summary.
      // Keep the last authoritative totals (and their report date) intact.
      if (data && Object.hasOwn(data, 'todayTrackedMs') && Object.hasOwn(data, 'weekTrackedMs')) applyTrackedTotals(data);
      const pendingIds = new Set(pageState.pendingWrites.map(item => item.id));
      reconcileQueuedInlineOperations(pendingIds);
      reconcileTimelineQueuedOperations(pendingIds);
    }
    for (const [entryId] of timelineOptimisticCompletions) {
      if (recent.some(entry => entry.id === entryId && entry._sha && !entry._pending)) timelineOptimisticCompletions.delete(entryId);
    }
    refreshTimelineQueueIndicator();
    recentLoaded = true;
    recentFresh = fresh;
  }

  function mergeLocalPendingActivity(entries) {
    if (!timesMode || !Array.isArray(entries)) return;
    // GET_PAGE_STATE reads IndexedDB, unlike LOAD_TIMES which also reads GitHub.
    // A Stop accepted by another component/tab must appear in Activity without
    // waiting for the remote weekly history to finish loading.
    const pending = entries.filter(entry => entry?._pending && entry?.id && entry?._path && entry?.endedAt);
    if (!pending.length) return;
    const identity = entry => `${entry.destinationId || ''}\u0000${entry.id}`;
    const keys = new Set(pending.map(identity));
    recent = [...recent.filter(entry => !keys.has(identity(entry))), ...pending]
      .sort((left, right) => new Date(right.startedAt) - new Date(left.startedAt));
    recentLoaded = true;
  }

  function applyPageState(data) {
    if (pageState.configured == null) { errorText = ''; errorCode = ''; connectionError = null; }
    const previousParticipantState = `${taskUrlOf(pageState.active) || ''}:${pageState.active?.startedAt || ''}:${pageState.pendingCount || 0}`;
    recordQueueDiagnostics(pageState.pendingWrites, data?.pendingWrites ?? []);
    pageState = reconcileTimelineAcceptedActive(data);
    if (!timesMode && Array.isArray(data?.recent)) quickStartRecent = data.recent;
    mergeLocalPendingActivity(data?.recent);
    root?.setAttribute('data-clockoli-width', pageState.interfaceWidth === 'full' ? 'full' : 'contained');
    fullWidthPopupRoot?.setAttribute('data-clockoli-width', pageState.interfaceWidth === 'full' ? 'full' : 'contained');
    applyTrackedTotals(data);
    const pendingIds = new Set(pageState.pendingWrites?.map(item => item.id) ?? []);
    reconcileQueuedInlineOperations(pendingIds);
    reconcileTimelineQueuedOperations(pendingIds);
    if (!timesMode && Array.isArray(data?.recent)) applyMenuData(data.recent, recentFresh);
    if (recentFreshAfterPendingId && pageState.pendingCount === 0 && Array.isArray(data?.recent)
        && data.recent.some(entry => entry.id === recentFreshAfterPendingId && !entry._pending && entry._sha)) {
      recentFresh = true;
      recentFreshAfterPendingId = null;
    }
    schedulePendingRefresh();
    refreshTimelineQueueIndicator();
    const nextParticipantState = `${taskUrlOf(pageState.active) || ''}:${pageState.active?.startedAt || ''}:${pageState.pendingCount || 0}`;
    if (!popupMode && previousParticipantState !== nextParticipantState) void refreshClockoliParticipants();
  }

  function safeQueueDetail(value) {
    return String(value || '').slice(0, 300);
  }

  function queueOperationLabel(item) {
    const operation = item.operation ?? item.stage;
    return ({ editEntry: 'Edit time entry', editEntries: 'Edit linked time entries', editActiveStart: 'Adjust timer start',
      completeTimer: 'Save stopped timer', completeTimerAndStart: 'Save and switch task', startTimer: 'Start timer',
    })[operation] || operation || 'Queued operation';
  }

  function queueOperationSignature(item) {
    return [item.operation, item.stage, item.status, item.retryCount, item.conflictReason, item.lastError].join('\u0001');
  }

  function queueElapsedText(queuedAt) {
    const elapsedMs = Date.now() - new Date(queuedAt).getTime();
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return '';
    return elapsedMs < 1_000 ? ` in ${Math.round(elapsedMs)}ms` : ` in ${(elapsedMs / 1_000).toFixed(1)}s`;
  }

  function recordQueueDiagnostics(previous, next) {
    const before = new Map((previous ?? []).map(item => [item.id, item]));
    const after = new Map((next ?? []).map(item => [item.id, item]));
    const append = message => queueDiagnostics.push({ at: new Date().toISOString(), message: safeQueueDetail(message) });
    for (const item of next ?? []) {
      const prior = before.get(item.id), label = queueOperationLabel(item);
      if (!prior) append(`${label}: queued${item.queuedAt ? ` at ${item.queuedAt}` : ''}.`);
      const previousDiagnostics = prior?.diagnostics?.length || 0;
      for (const event of (item.diagnostics ?? []).slice(previousDiagnostics)) {
        append(`${label}: ${safeQueueDetail(event.message)}`);
      }
      if (prior && queueOperationSignature(prior) !== queueOperationSignature(item)) {
        const attempt = Number(item.retryCount) ? ` Attempt ${item.retryCount}.` : '';
        const detail = item.lastError ? ` ${safeQueueDetail(item.lastError)}` : '';
        append(`${label}: ${item.status || 'pending'} at ${item.stage || item.operation || 'queued'}.${attempt}${detail}`);
      }
    }
    for (const item of previous ?? []) if (!after.has(item.id)) append(`${queueOperationLabel(item)}: synced${queueElapsedText(item.queuedAt)}.`);
    if (queueDiagnostics.length > 40) queueDiagnostics.splice(0, queueDiagnostics.length - 40);
  }

  function recordTimelineQueueDiagnostic(message) {
    queueDiagnostics.push({ at: new Date().toISOString(), message: safeQueueDetail(message) });
    if (queueDiagnostics.length > 40) queueDiagnostics.splice(0, queueDiagnostics.length - 40);
  }

  function recordTimelineGestureDiagnostic(event) {
    const detail = event && typeof event === 'object' ? event : {};
    const kind = String(detail.kind || 'gesture').slice(0, 32);
    const phase = String(detail.phase || 'event').slice(0, 32);
    const id = String(detail.id || 'unknown').slice(0, 120);
    const stamp = value => Number.isFinite(value) ? new Date(value).toISOString() : 'none';
    const bounds = detail.bounds || {};
    const proposed = detail.edit || {};
    const message = [
      `Timeline ${phase}: ${kind} ${id}.`,
      `previous=${stamp(bounds.previousEnd)} next=${stamp(bounds.nextStart)} gap=${Number(detail.snapMs) || 0}ms.`,
      `raw=${stamp(detail.rawTimestamp)} proposed=${stamp(detail.proposedTimestamp)}.`,
      `result=${stamp(proposed.startedAt)}→${stamp(proposed.endedAt)}${detail.committed === false ? ' (no-op).' : '.'}`,
    ].join(' ');
    queueDiagnostics.push({ at: new Date().toISOString(), message: safeQueueDetail(message) });
    if (queueDiagnostics.length > 40) queueDiagnostics.splice(0, queueDiagnostics.length - 40);
  }

  function hasRunnablePending(queue = pageState.pendingWrites) {
    const first = queue?.[0];
    if (!first) return false;
    if (first.status !== 'conflict') return true;
    const operation = first.operation ?? first.stage;
    const retryableConflict = first.conflictReason !== 'add_time_overlap_changed'
      && !String(first.conflictReason || '').startsWith('queued_write_');
    return retryableConflict && ((first.stage === 'startNext' && first.nextActive)
      || (['editEntry', 'editEntries', 'deleteEntry'].includes(operation) && first.conflictReason !== 'queued_entry_missing'));
  }

  function visiblePanelStateKey(state = pageState) {
    const active = state?.active;
    const pending = (state?.pendingWrites ?? []).map(item => [
      item.id, item.status, item.stage, item.operation, item.conflictReason,
    ]);
    return JSON.stringify({
      configured: state?.configured ?? null,
      active: active ? [active.id, active.taskUrl, active.taskTitle, active.startedAt, active.description] : null,
      pendingCount: state?.pendingCount ?? 0,
      pending,
      projects: state?.projects ?? [],
      showQueueDiagnostics: state?.showQueueDiagnostics === true,
      remoteWriteConfirmed: state?.remoteWriteConfirmed, summaryError: state?.summaryError,
    });
  }

  function visibleRecentKey() {
    return recent.map(entry => [
      entry.id, entry._path, entry._sha, entry._index, entry.startedAt, entry.endedAt, entry._pending,
    ]).join('\n');
  }

  function schedulePendingRefresh() {
    globalThis.clearTimeout?.(pendingRefreshTimer); pendingRefreshTimer = null;
    if (!hasRunnablePending()) return;
    pendingRefreshTimer = setTimeout(async () => {
      try {
        const before = visiblePanelStateKey();
        const beforeRecent = visibleRecentKey();
        const pendingIds = new Set(pageState.pendingWrites?.map(item => item.id) ?? []);
        const data = await send({ type: 'GET_PAGE_STATE' });
        applyPageState(data);
        // The page-state cache is bounded and cannot replace a complete Activity week.
        if (timesMode) {
          const remainingIds = new Set(pageState.pendingWrites?.map(item => item.id) ?? []);
          if ([...pendingIds].some(id => !remainingIds.has(id))) await refreshRecent(true);
        } else if (Array.isArray(data?.recent)) applyMenuData(data.recent, recentFresh);
        if (before !== visiblePanelStateKey() || beforeRecent !== visibleRecentKey()) renderUi();
        else updatePanelClocks();
      } catch { schedulePendingRefresh(); }
    }, 500);
    pendingRefreshTimer?.unref?.();
  }

  function timestampParts(value, timezone = '') {
    const match = String(value).match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/);
    if (!match) throw new Error('Invalid timestamp offset.');
    if (!timezone) return { date: match[1], hour: match[2], minute: match[3], second: match[4], fraction: match[5] || '', zone: match[6] };
    let formatted;
    try {
      formatted = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
      }).formatToParts(new Date(value));
    } catch { throw new Error('Invalid record timezone.'); }
    const parts = Object.fromEntries(formatted.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
    return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: parts.hour, minute: parts.minute, second: parts.second, fraction: match[5] || '', zone: 'Z' };
  }

  function timestampFromTimeParts(original, date, hour, minute, timezone = '') {
    const parts = timestampParts(original, timezone), numericHour = Number(hour), numericMinute = Number(minute);
    if (!validEntryDate(date) || !Number.isInteger(numericHour) || numericHour < 0 || numericHour > 23
        || !Number.isInteger(numericMinute) || numericMinute < 0 || numericMinute > 59) throw new Error('Enter a valid date and time.');
    if (!timezone) {
      const value = `${date}T${String(numericHour).padStart(2, '0')}:${String(numericMinute).padStart(2, '0')}:${parts.second}${parts.fraction}${parts.zone}`;
      if (!validTimestamp(value)) throw new Error('Enter a valid date and time.');
      return value;
    }
    const [year, month, day] = date.split('-').map(Number), milliseconds = Number((parts.fraction || '.000').slice(1).padEnd(3, '0'));
    const desired = Date.UTC(year, month - 1, day, numericHour, numericMinute, Number(parts.second), milliseconds);
    const [originalYear, originalMonth, originalDay] = parts.date.split('-').map(Number);
    const originalWall = Date.UTC(originalYear, originalMonth - 1, originalDay, Number(parts.hour), Number(parts.minute), Number(parts.second), milliseconds);
    let instant = new Date(original).getTime() + desired - originalWall;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const wall = timestampParts(new Date(instant).toISOString(), timezone), [wallYear, wallMonth, wallDay] = wall.date.split('-').map(Number);
      const represented = Date.UTC(wallYear, wallMonth - 1, wallDay, Number(wall.hour), Number(wall.minute), Number(wall.second), milliseconds);
      instant += desired - represented;
    }
    const result = new Date(instant).toISOString(), verified = timestampParts(result, timezone);
    if (verified.date !== date || Number(verified.hour) !== numericHour || Number(verified.minute) !== numericMinute || verified.second !== parts.second) {
      throw new Error('This local time does not exist in the record timezone.');
    }
    return result;
  }

  function timePicker(label, original, draft = null, { compact = false, timezone = '', onChange = () => {}, onFocus = () => {} } = {}) {
    let template = validTimestamp(draft?.timestamp) ? draft.timestamp : original;
    const initial = timestampParts(template, timezone), group = el('fieldset', undefined, `time-picker${compact ? ' compact-time-picker' : ''}`), controls = [];
    group.append(el('legend', label));
    const dateField = el('input'); controls.push(dateField); dateField.type = 'date'; dateField.required = true; dateField.value = draft?.date ?? initial.date; dateField.className = 'time-date'; dateField.setAttribute('aria-label', `${label} date`);
    const values = el('div', undefined, 'time-picker-values');
    const fieldClass = compact ? 'time-value inline-time-value' : 'time-value';
    const hourField = el('input'); controls.push(hourField); hourField.type = 'text'; hourField.inputMode = 'numeric'; hourField.maxLength = 2; hourField.value = draft?.hour ?? initial.hour; hourField.className = `${fieldClass} time-hour`; hourField.setAttribute('aria-label', `${label} hour`);
    const minuteField = el('input'); controls.push(minuteField); minuteField.type = 'text'; minuteField.inputMode = 'numeric'; minuteField.maxLength = 2; minuteField.value = draft?.minute ?? initial.minute; minuteField.className = `${fieldClass} time-minute`; minuteField.setAttribute('aria-label', `${label} minute`);
    const currentDraft = () => ({ date: dateField.value, hour: hourField.value, minute: minuteField.value, timestamp: template });
    const validNumber = (field, maximum) => {
      const value = Number(field.value), valid = /^\d{1,2}$/.test(String(field.value)) && Number.isInteger(value) && value >= 0 && value <= maximum;
      field.setAttribute('aria-invalid', String(!valid)); return valid;
    };
    const refreshValidity = () => validNumber(hourField, 23) && validNumber(minuteField, 59);
    const value = () => { if (!refreshValidity()) throw new Error('Enter a valid date and time.'); return timestampFromTimeParts(template, dateField.value, hourField.value, minuteField.value, timezone); };
    const changed = () => { refreshValidity(); onChange(currentDraft()); };
    const applyTimestamp = (timestamp, notify = false) => {
      const parts = timestampParts(timestamp, timezone); template = timestamp; dateField.value = parts.date; hourField.value = parts.hour; minuteField.value = parts.minute; refreshValidity();
      if (notify) changed();
    };
    dateField.addEventListener('input', changed); hourField.addEventListener('input', changed); minuteField.addEventListener('input', changed);
    hourField.addEventListener('focus', () => onFocus('hour')); minuteField.addEventListener('focus', () => onFocus('minute'));
    refreshValidity(); values.append(hourField, el('span', ':', 'time-colon'), minuteField); group.append(dateField, values);
    return { node: group, value, draft: currentDraft, controls, focus: part => (part === 'minute' ? minuteField : hourField).focus(), reset: () => applyTimestamp(original), setValue: applyTimestamp, setDisabled: disabled => { for (const control of controls) control.disabled = disabled; } };
  }

  function timestampAtOriginalOffset(original, instant, timezone = '') {
    if (timezone) {
      if (!Number.isFinite(instant)) throw new Error('Invalid timestamp offset.');
      return new Date(instant).toISOString();
    }
    const match = String(original).match(/(Z|([+-])(\d{2}):(\d{2}))$/);
    if (!match || !Number.isFinite(instant)) throw new Error('Invalid timestamp offset.');
    const offset = match[1] === 'Z' ? 0 : (match[2] === '+' ? 1 : -1) * (Number(match[3]) * 60 + Number(match[4]));
    const date = new Date(instant + offset * 60_000), pad = (number, width = 2) => String(number).padStart(width, '0');
    const milliseconds = date.getUTCMilliseconds(), fraction = milliseconds || timestampParts(original).fraction ? `.${pad(milliseconds, 3)}` : '';
    return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}${fraction}${match[1]}`;
  }

  function titleFromPage() {
    if (popupMode) return taskTitleOf(popupTask);
    if (timesMode) return '';
    const node = document.querySelector('[data-testid="issue-title"], .js-issue-title, bdi.js-issue-title');
    const title = (node?.textContent || document.title || '').replace(/ · GitHub$/, '').trim();
    return title.slice(0, 300);
  }

  function recentRequest() {
    if (timesMode) return { type: 'LOAD_TIMES', payload: timesRange() };
    const task = taskFromLocation();
    return { type: 'LOAD_RECENT', menuData: true, ...(popupMode && task ? { taskUrl: task.taskUrl, taskTitle: task.taskTitle } : {}) };
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

  function isolateShadowHost(node, { fullWidth = false, wide = false } = {}) {
    const set = (property, value) => node.style?.setProperty?.(property, value, 'important');
    set('all', 'initial');
    set('box-sizing', 'border-box');
    set('position', fullWidth ? 'fixed' : 'relative');
    set('display', fullWidth || wide ? 'block' : 'inline-flex');
    if (wide) { set('width', '100%'); set('color-scheme', 'inherit'); }
    if (fullWidth) {
      set('z-index', '2147483647'); set('top', '0'); set('right', '0'); set('left', '0');
      set('width', '100vw'); set('pointer-events', 'none');
    } else set('align-items', 'center');
  }

  function mountInHeader() {
    if (popupMode || timesMode) {
      root = root || document.getElementById(timesMode ? TIMES_ROOT_ID : POPUP_ROOT_ID);
      if (!root) return false;
      isolateShadowHost(root, { wide: true });
      root.classList.add(timesMode ? 'times-surface' : 'popup-surface');
      shadow = shadow || root.attachShadow({ mode: 'closed' });
      globalThis.ClockoliInstantTooltips?.attach(shadow);
      return true;
    }
    const target = headerTarget();
    if (!target) return false;
    if (!root) {
      root = el('div'); root.id = ROOT_ID;
      isolateShadowHost(root);
      shadow = root.attachShadow({ mode: 'closed' });
      globalThis.ClockoliInstantTooltips?.attach(shadow);
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

  function saveCheckButton(label, handler) {
    const save = button('✓', 'save-check', async (_event, node) => {
      node.disabled = true;
      try { await handler(); }
      catch (error) { setError(error); }
      finally { node.disabled = false; }
    });
    save.title = label; save.setAttribute('aria-label', label);
    save.addEventListener('mousedown', event => event.preventDefault());
    return save;
  }

  function setError(error = '') { if (isExtensionContextInvalidated(error)) { deactivateExtensionContext(); return; } if (error?.name === 'AbortError' || error?.code === 'aborted') return; errorText = error?.message || String(error || ''); errorCode = error?.code || ''; connectionError = errorText ? { ...error, message: errorText, code: errorCode } : null; renderUi(); }

  function closeMenu() { menuOpen = false; menuScrollTop = 0; cancelActiveInlineDraft(); if (pageState.configured != null) { errorText = ''; errorCode = ''; } renderUi(); }

  function originalRecord(entry) { return { id: entry.id, taskUrl: storedTaskIdentityOf(entry), taskTitle: taskTitleOf(entry), issueUrl: storedTaskIdentityOf(entry), issueTitle: taskTitleOf(entry), startedAt: entry.startedAt, endedAt: entry.endedAt, description: entry.description || '' }; }

  function validEntryDate(value) {
    const match = typeof value === 'string' ? value.match(/^(?!0000)(\d{4})-(\d{2})-(\d{2})$/) : null;
    if (!match) return false;
    const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
    return month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
  }

  function validTimestamp(value) {
    const match = typeof value === 'string' ? value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/) : null;
    if (!match) return false;
    const [, year, month, day, hour, minute, second, millis = '000', zone, sign, offsetHour = '00', offsetMinute = '00'] = match;
    const y = Number(year), mo = Number(month), d = Number(day), h = Number(hour), mi = Number(minute), sec = Number(second);
    if (mo < 1 || mo > 12 || d < 1 || d > new Date(Date.UTC(y, mo, 0)).getUTCDate() || h > 23 || mi > 59 || sec > 59
        || Number(offsetHour) > 23 || Number(offsetMinute) > 59) return false;
    const offset = zone === 'Z' ? 0 : (sign === '+' ? 1 : -1) * (Number(offsetHour) * 60 + Number(offsetMinute));
    const expected = Date.UTC(y, mo - 1, d, h, mi, sec, Number(millis.padEnd(3, '0'))) - offset * 60000;
    return new Date(value).getTime() === expected;
  }

  function refreshRecent(force = false) {
    if (recentLoad && !force) return recentLoad;
    if (timesMode && force && timesFilter.trim()) {
      clearTimeout(activitySearchTimer); activitySearchTimer = null;
      activitySearchGeneration++;
      activitySearchEntries = null; activitySearchLoading = false;
      activitySearchError = ''; activitySearchPartial = false;
    }
    const loadId = ++recentLoadId, request = recentRequest();
    recentFresh = false; loadingRecent = true; if (!suppressRecentRender) renderUi();
    let load;
    load = send(request).then(async data => {
      if (timesMode && loadId === recentLoadId && data?.configured) {
        let hasTrackedTime = Boolean(data.recent?.length || data.remoteWriteConfirmed || data.pendingCount);
        if (!hasTrackedTime) {
          try {
            const history = await send({ type: 'LOAD_TIMES', payload: ACTIVITY_HISTORY_RANGE });
            hasTrackedTime = history?.configured && Array.isArray(history.recent)
              ? Boolean(history.recent.length || history.remoteWriteConfirmed || history.pendingCount) : null;
          } catch { hasTrackedTime = null; }
        }
        if (loadId === recentLoadId) timesHasTrackedTime = hasTrackedTime;
      }
      if (loadId === recentLoadId) {
        applyMenuData(data, true);
        if (timesMode && activityViewMode === 'calendar') focusActivityCalendarPeriod();
      }
      return data;
    }).finally(() => {
      if (loadId === recentLoadId && recentLoad === load) {
        recentLoad = null; loadingRecent = false; if (!suppressRecentRender) renderUi();
      }
    });
    recentLoad = load;
    return load;
  }

  async function refreshMountedTimelineState() {
    applyPageState(await send({ type: 'GET_PAGE_STATE', refresh: true }));
    if (!refreshMountedTimeline()) renderUi();
  }

  async function refreshState(refresh = false, loadEntries = false) {
    if (loadEntries) return refreshRecent();
    applyPageState(await send({ type: 'GET_PAGE_STATE', refresh }));
    renderUi();
  }


  function relativeDayLabel(date) {
    const today = localDateValue(), marker = new Date(`${today}T12:00:00`);
    marker.setDate(marker.getDate() - 1);
    if (date === today) return 'Today';
    if (date === localDateValue(marker)) return 'Yesterday';
    return new Date(`${date}T12:00:00Z`).toLocaleDateString([], { weekday: 'short', timeZone: 'UTC' });
  }

  function wallTime(parts) {
    return new Date(`${parts.date}T${parts.hour}:${parts.minute}:00Z`).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
  }

  function recentMeta(entry, startedAt = entry.startedAt, endedAt = entry.endedAt) {
    const start = timestampParts(startedAt, entry.timezone), end = timestampParts(endedAt, entry.timezone);
    const duration = Math.max(0, Math.floor((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000));
    const endDay = end.date === start.date ? '' : `${relativeDayLabel(end.date)} `;
    return `${relativeDayLabel(start.date)} ${wallTime(start)} - ${endDay}${wallTime(end)} ${formatDuration(duration)}`;
  }

  function entryKey(entry) {
    return `${entry.destinationId || ''}\n${entry._path}\n${entry._sha || 'pending'}\n${entry._index}\n${entry.id}`;
  }

  function clearInlineGroup(key) {
    const group = inlineDrafts.get(key)?.group || key;
    const keys = new Set([...inlineDrafts].filter(([, value]) => value.group === group).map(([draftKey]) => draftKey));
    if (key) keys.add(key);
    clearBoundaryLinks(keys);
    for (const draftKey of keys) inlineDrafts.delete(draftKey);
    return keys.size > 0;
  }

  function cancelActiveInlineDraft(nextKey = null) {
    const previous = activeInlineKey;
    const changed = previous ? clearInlineGroup(previous) : false;
    activeInlineKey = nextKey;
    return changed;
  }

  function activateTimeInput(key) {
    activeInlineKey = key;
  }

  function overlappingEntries(entries) {
    const overlaps = new Set();
    for (let left = 0; left < entries.length; left += 1) {
      const leftStart = new Date(entries[left].startedAt).getTime(), leftEnd = new Date(entries[left].endedAt).getTime();
      for (let right = left + 1; right < entries.length; right += 1) {
        if (entries[left].destinationId !== entries[right].destinationId) continue;
        const rightStart = new Date(entries[right].startedAt).getTime(), rightEnd = new Date(entries[right].endedAt).getTime();
        if (leftStart < rightEnd && rightStart < leftEnd) {
          overlaps.add(entryKey(entries[left])); overlaps.add(entryKey(entries[right]));
        }
      }
    }
    return overlaps;
  }

  function entryWithInlineDraft(entry) {
    const draft = inlineDrafts.get(entryKey(entry));
    if (!draft) return entry;
    try {
      return {
        ...entry,
        startedAt: timestampFromTimeParts(draft.start.timestamp || entry.startedAt, draft.start.date, draft.start.hour, draft.start.minute, entry.timezone),
        endedAt: timestampFromTimeParts(draft.stop.timestamp || entry.endedAt, draft.stop.date, draft.stop.hour, draft.stop.minute, entry.timezone),
      };
    } catch { return entry; }
  }

  function recordsWithDrafts() {
    const drafts = [...inlineDrafts.values()].map(draft => draft.entry);
    return [...recent.filter(entry => !drafts.some(draft => draft.id === entry.id && draft._path === entry._path && draft.destinationId === entry.destinationId)), ...drafts];
  }

  function refreshOverlapWarnings() {
    const overlaps = overlappingEntries(recordsWithDrafts().map(entryWithInlineDraft));
    for (const [key, editor] of inlineEditors) editor.setOverlap?.(overlaps.has(key));
  }

  function mergeDraftGroup(group, previousGroup) {
    if (!previousGroup || previousGroup === group) return;
    for (const [key, draft] of inlineDrafts) if (draft.group === previousGroup) inlineDrafts.set(key, { ...draft, group });
  }

  function boundaryId(key, boundary) { return `${key}\u0000${boundary}`; }

  function rememberBoundaryLink(source, target, baseline, relation) {
    if (!inlineBoundaryLinks.has(source)) inlineBoundaryLinks.set(source, new Map());
    inlineBoundaryLinks.get(source).set(target, { baseline, relation });
  }

  function detachIncomingBoundaryLinks(target) {
    for (const [source, links] of [...inlineBoundaryLinks]) {
      links.delete(target); if (!links.size) inlineBoundaryLinks.delete(source);
    }
  }

  function clearBoundaryLinks(keys) {
    for (const [source, links] of [...inlineBoundaryLinks]) {
      if (keys.has(source.split('\u0000')[0])) { inlineBoundaryLinks.delete(source); continue; }
      for (const target of [...links.keys()]) if (keys.has(target.split('\u0000')[0])) links.delete(target);
      if (!links.size) inlineBoundaryLinks.delete(source);
    }
  }

  function linkCrossedTimeBoundaries(entry, boundary, group) {
    const sequence = [...inlineEditors.entries()]
      .filter(([, editor]) => editor.entry.destinationId === entry.destinationId)
      .sort((left, right) => new Date(left[1].entry.startedAt) - new Date(right[1].entry.startedAt))
      .flatMap(([key, editor]) => [
        { id: boundaryId(key, 'start'), key, boundary: 'start', picker: editor.startPicker, original: editor.entry.startedAt, timezone: editor.entry.timezone, editor },
        { id: boundaryId(key, 'stop'), key, boundary: 'stop', picker: editor.stopPicker, original: editor.entry.endedAt, timezone: editor.entry.timezone, editor },
      ]);
    const position = sequence.findIndex(item => item.key === entryKey(entry) && item.boundary === boundary);
    if (position < 0) return;
    let instant;
    try { instant = new Date(sequence[position].picker.value()).getTime(); } catch { return; }
    const source = sequence[position], touched = new Set([source.key]);
    const apply = (item, timestamp) => {
      const previousGroup = inlineDrafts.get(item.key)?.group;
      mergeDraftGroup(group, previousGroup);
      item.picker.setValue(timestampAtOriginalOffset(item.original, new Date(timestamp).getTime(), item.timezone));
      touched.add(item.key);
    };
    detachIncomingBoundaryLinks(source.id);
    const existing = inlineBoundaryLinks.get(source.id);
    if (existing?.size) {
      for (const [targetId, link] of [...existing]) {
        const item = sequence.find(candidate => candidate.id === targetId);
        if (!item) { existing.delete(targetId); continue; }
        const baselineInstant = new Date(link.baseline).getTime();
        const stillCrossed = link.relation === 'previous' ? baselineInstant > instant : baselineInstant < instant;
        apply(item, stillCrossed ? timestampAtOriginalOffset(item.original, instant) : link.baseline);
        if (!stillCrossed) existing.delete(targetId);
      }
      if (!existing.size) inlineBoundaryLinks.delete(source.id);
    }
    const linkedTargets = new Set(inlineBoundaryLinks.get(source.id)?.keys() || []);
    const register = (item, relation) => {
      const baseline = item.picker.value();
      apply(item, timestampAtOriginalOffset(item.original, instant));
      rememberBoundaryLink(source.id, item.id, baseline, relation); linkedTargets.add(item.id);
    };
    for (let index = position - 1; index >= 0; index -= 1) {
      if (linkedTargets.has(sequence[index].id)) continue;
      let value;
      try { value = new Date(sequence[index].picker.value()).getTime(); } catch { break; }
      if (value <= instant) break;
      register(sequence[index], 'previous');
    }
    for (let index = position + 1; index < sequence.length; index += 1) {
      if (linkedTargets.has(sequence[index].id)) continue;
      let value;
      try { value = new Date(sequence[index].picker.value()).getTime(); } catch { break; }
      if (value >= instant) break;
      register(sequence[index], 'next');
    }
    for (const key of touched) inlineEditors.get(key)?.updateDraft(group);
  }

  function recentTimeText(entry) {
    const start = timestampParts(entry.startedAt, entry.timezone), stop = timestampParts(entry.endedAt, entry.timezone);
    const stopDay = stop.date === start.date ? '' : `${relativeDayLabel(stop.date)} `;
    return `${start.hour}:${start.minute} - ${stopDay}${stop.hour}:${stop.minute}`;
  }

  function applyQueuedInlineEntries(entries) {
    const changes = new Map(entries.map(request => [`${request.destinationId}\u0000${request.path}\u0000${request.original.id}`, request.edits]));
    recent = recent.map(entry => {
      const edits = changes.get(`${entry.destinationId}\u0000${entry._path}\u0000${entry.id}`);
      if (!edits) return entry;
      const startedAt = edits.startedAt ?? entry.startedAt, endedAt = edits.endedAt ?? entry.endedAt;
      return {
        ...entry, ...edits, startedAt, endedAt,
        entryDate: timestampParts(startedAt, entry.timezone).date,
        durationSeconds: Math.max(0, Math.floor((new Date(endedAt) - new Date(startedAt)) / 1000)),
      };
    });
  }

  function inlineTimeEditor(entry) {
    const key = entryKey(entry), draft = inlineDrafts.get(key);
    const range = el('div', undefined, 'inline-time-range entry-meta');
    const day = el('div', relativeDayLabel((draft?.start?.date || timestampParts(entry.startedAt, entry.timezone).date)), 'entry-day');
    const duration = el('span', formatDuration(entry.durationSeconds), 'inline-duration'); duration.title = duration.textContent;
    const unsaved = el('span', 'Unsaved', 'inline-unsaved'); unsaved.hidden = !draft;
    let startPicker, stopPicker, save, cancel;
    const updateDraft = group => {
      if (!startPicker || !stopPicker) return;
      const previous = inlineDrafts.get(key) || {};
      const value = { ...previous, entry, start: startPicker.draft(), stop: stopPicker.draft(), group: group || previous.group || key };
      inlineDrafts.set(key, value); activeInlineKey ||= key;
      unsaved.hidden = false;
      if (save && cancel) { save.hidden = false; cancel.hidden = false; save.parentElement?.classList.add('dirty'); }
      day.textContent = relativeDayLabel(value.start.date);
      try {
        const startedAt = startPicker.value(), endedAt = stopPicker.value();
        duration.textContent = formatDuration(Math.max(0, Math.floor((new Date(endedAt) - new Date(startedAt)) / 1000)));
      } catch { duration.textContent = '—'; }
      duration.title = duration.textContent;
    };
    const remember = boundary => {
      const group = inlineDrafts.get(key)?.group || key;
      updateDraft(group); linkCrossedTimeBoundaries(entry, boundary, group); refreshOverlapWarnings();
    };
    startPicker = timePicker('Start', entry.startedAt, draft?.start, {
      compact: true, timezone: entry.timezone, onChange: () => remember('start'), onFocus: () => activateTimeInput(key),
    });
    stopPicker = timePicker('Stop', entry.endedAt, draft?.stop, {
      compact: true, timezone: entry.timezone, onChange: () => remember('stop'), onFocus: () => activateTimeInput(key),
    });
    const saveGroupOnce = async group => {
      try {
        const submittedDrafts = new Map([...inlineDrafts.entries()].filter(([, value]) => value.group === group)
          .map(([draftKey, value]) => [draftKey, JSON.parse(JSON.stringify(value))]));
        const entries = [...submittedDrafts.entries()].map(([draftKey, value]) => {
          const editor = inlineEditors.get(draftKey), target = editor?.entry;
          if (!editor || !target) throw new Error('A linked time entry is no longer visible. Reload before saving.');
          const originalIdentity = storedTaskIdentityOf(target);
          const task = value.metadataActive && value.taskUrl !== originalIdentity
            ? taskFromUrl(value.taskUrl, value.taskTitle)
            : { taskUrl: originalIdentity, taskTitle: value.metadataActive ? value.taskTitle : taskTitleOf(target) };
          if (!task?.taskUrl) throw new Error('Enter a valid HTTP(S) task URL.');
          const description = normalizedDescription(value.metadataActive ? value.description : target.description);
          const edits = { ...(task.taskUrl === originalIdentity && !taskUrlOf(target) ? {} : { taskUrl: task.taskUrl }),
            taskTitle: task.taskTitle, startedAt: editor.startPicker.value(), endedAt: editor.stopPicker.value(), description };
          const changed = task.taskUrl !== originalIdentity || edits.taskTitle !== taskTitleOf(target) || edits.startedAt !== target.startedAt || edits.endedAt !== target.endedAt || edits.description !== (target.description || '');
          return changed ? { destinationId: target.destinationId, path: target._path, originalSha: target._sha, index: target._index, original: originalRecord(target), edits } : null;
        }).filter(Boolean);
        const savedKeys = new Set(submittedDrafts.keys());
        if (!entries.length) {
          clearBoundaryLinks(savedKeys); for (const draftKey of savedKeys) inlineDrafts.delete(draftKey); activeInlineKey = null; renderUi(); return;
        }
        const destinationIds = [...new Set(entries.map(item => item.destinationId))];
        if (destinationIds.length !== 1) throw new Error('Linked edits must stay within one time repository.');
        const queued = await send({ type: 'QUEUE_ENTRIES_EDIT', payload: { destinationId: destinationIds[0], entries: entries.map(({ destinationId: _destinationId, ...entry }) => entry) } });
        if (queued?.operationId) inlineQueuedOperationIds.add(queued.operationId);
        applyQueuedInlineEntries(entries);
        const acceptedKeys = new Set();
        for (const draftKey of savedKeys) {
          const current = inlineDrafts.get(draftKey), submitted = submittedDrafts.get(draftKey);
          if (current && JSON.stringify(current) === JSON.stringify(submitted)) { inlineDrafts.delete(draftKey); acceptedKeys.add(draftKey); }
        }
        clearBoundaryLinks(acceptedKeys);
        for (const draftKey of acceptedKeys) markInlineSaved(draftKey);
        activeInlineKey = inlineDrafts.has(key) ? key : null; renderUi();
        void refreshState(false, false).catch(setError);
      } catch (error) { setError(error); }
    };
    const saveGroup = () => {
      const group = inlineDrafts.get(key)?.group || key;
      const pending = inlineGroupSaves.get(group);
      if (pending) return pending;
      let operation;
      operation = saveGroupOnce(group).finally(() => {
        if (inlineGroupSaves.get(group) === operation) {
          inlineGroupSaves.delete(group);
          renderUi();
        }
      });
      inlineGroupSaves.set(group, operation);
      return operation;
    };
    const cancelGroup = async () => { clearInlineGroup(key); activeInlineKey = null; renderUi(); };
    save = button('Save time', 'link-button inline-save', saveGroup);
    cancel = button('Cancel', 'link-button inline-cancel', cancelGroup);
    save.hidden = !draft; cancel.hidden = !draft;
    save.disabled = inlineGroupSaves.has(draft?.group || key);
    const onEnter = event => {
      if (event.key !== 'Enter' || !event.isTrusted) return;
      event.preventDefault(); void saveGroup();
    };
    for (const control of [...startPicker.controls, ...stopPicker.controls]) control.addEventListener('keydown', onEnter);
    const separator = el('span', '-', 'inline-time-separator'), timeLine = el('div', undefined, 'inline-time-line');
    timeLine.append(startPicker.node, separator, stopPicker.node); range.append(timeLine);
    inlineEditors.set(key, { entry, startPicker, stopPicker, updateDraft, saveGroup, cancelGroup });
    return { node: range, day, duration, unsaved, save, cancel, saveGroup, cancelGroup, draft, setDisabled: disabled => { startPicker.setDisabled(disabled); stopPicker.setDisabled(disabled); } };
  }

  function beginMetadataEdit(entry, { focusTime = false } = {}) {
    const key = entryKey(entry);
    inlineSavedNotices.delete(key);
    activeInlineKey = key;
    const existing = inlineDrafts.get(key);
    inlineDrafts.set(key, {
      ...(existing || {
        entry,
        start: { ...timestampParts(entry.startedAt, entry.timezone), timestamp: entry.startedAt },
        stop: { ...timestampParts(entry.endedAt, entry.timezone), timestamp: entry.endedAt },
        group: key,
      }),
      metadataActive: true, taskUrl: storedTaskIdentityOf(entry), taskTitle: taskTitleOf(entry), description: entry.description || '',
    });
    renderUi(); globalThis.requestAnimationFrame?.(() => {
      const editor = inlineEditors.get(key);
      (focusTime ? editor?.startPicker?.controls?.[0] : editor?.descriptionField)?.focus();
    });
  }

  function beginRecordEdit(entry) { beginMetadataEdit(entry, { focusTime: true }); }

  async function openTimeEntryForm(entry, trigger) {
    let form = globalThis.ClockoliTimeEntryForm;
    if (!form?.openEdit && !extensionPageMode) {
      timeEntryFormLoad ||= (async () => {
        const { mountAddTime } = await import(chrome.runtime.getURL('src/ui/add-time.js'));
        const host = document.createElement('div');
        host.style.position = 'fixed'; host.style.zIndex = '2147483647';
        const container = host.attachShadow({ mode: 'closed' });
        const stylesheet = document.createElement('link');
        stylesheet.rel = 'stylesheet'; stylesheet.href = chrome.runtime.getURL('src/ui/add-time.css');
        const anchor = document.createElement('button'); anchor.hidden = true;
        container.append(stylesheet, anchor);
        document.body.append(host);
        timeEntryFormHost = host;
        const dialog = mountAddTime(anchor, { container, send: async () => ({ configured: true, recent: [] }) });
        timeEntryFormDialog = dialog;
        return dialog;
      })().catch(error => { timeEntryFormLoad = null; timeEntryFormHost?.remove(); timeEntryFormHost = null; timeEntryFormDialog = null; throw error; });
      form = await timeEntryFormLoad;
    }
    if (!form?.openEdit) {
      if (entry._active) throw new Error('Edit timer start is unavailable. Reload the page and try again.');
      beginRecordEdit(entry); return;
    }
    if (entry._active) {
      if (pageState.active?.id !== entry.id) throw new Error('The running timer changed. Reload before editing it.');
      form.openEdit({ ...entry, taskUrl: storedTaskIdentityOf(entry), taskTitle: taskTitleOf(entry) }, async value => {
        if (value.startedAt !== entry.startedAt) await queueActiveStartEdit(entry, value.startedAt);
      }, trigger);
      return;
    }
    const current = recent.find(item => item.id === entry.id && item._path === entry._path && item.destinationId === entry.destinationId) || entry;
    form.openEdit({ taskUrl: storedTaskIdentityOf(current), taskTitle: taskTitleOf(current),
      destinationId: current.destinationId, startedAt: current.startedAt,
      endedAt: current.endedAt, description: current.description || '' }, async value => {
        const identity = value.taskUrl === storedTaskIdentityOf(current)
          ? value.taskUrl : taskFromUrl(value.taskUrl, value.taskTitle)?.taskUrl;
        if (!identity) throw new Error('Enter a valid HTTP(S) task URL.');
        const edits = { ...(identity === storedTaskIdentityOf(current) && !taskUrlOf(current) ? {} : { taskUrl: identity }),
          taskTitle: value.taskTitle, startedAt: value.startedAt,
          endedAt: value.endedAt, description: value.description };
        if (identity === storedTaskIdentityOf(current) && value.taskTitle === taskTitleOf(current)
            && value.startedAt === current.startedAt && value.endedAt === current.endedAt
            && value.description === (current.description || '')) return;
        await queueCalendarEntry(current, edits);
        renderUi();
      }, trigger);
  }

  function recentRecord(entry, overlaps) {
    const key = entryKey(entry), overlapping = overlaps.has(key), draft = inlineDrafts.get(key);
    const record = el('div', undefined, 'entry-record');
    if (draft?.metadataActive) record.classList.add('entry-editing');
    const warning = el('div', 'Overlaps another entry', 'overlap-warning');
    const setOverlap = active => {
      record.classList[active ? 'add' : 'remove']('entry-overlap');
      if (active && !warning.parentElement) record.prepend(warning); else if (!active) warning.remove();
    };
    setOverlap(overlapping);
    const identity = el('div', undefined, 'entry-record-task-identity');
    const taskIdentity = taskResult(entry, 'entry-record-task-result');
    taskIdentity.classList.add('activity-task-result');
    identity.append(siteFavicon(entry, 'entry-record-favicon'), taskIdentity);
    record.append(identity);
    const title = record.querySelector('.task-title');
    if (title && resolveTaskColor) title.style.color = resolveTaskColor({ url: taskUrlOf(entry), id: entry.id });
    const timeRow = el('div', undefined, 'entry-time-row');
    const inline = inlineTimeEditor(entry), actions = el('div', undefined, 'entry-actions'), day = inline.day;
      const editor = inlineEditors.get(key); if (editor) editor.setOverlap = setOverlap;
      const revealTimeEditor = trigger => openTimeEntryForm(entry, trigger).catch(setError);
      const edit = button('Edit time', 'link-button entry-edit', async (_event, node) => revealTimeEditor(node));
      const remove = button('Delete', 'danger-outline entry-delete', async () => { try { await queueTimelineEntryDelete(entry); } catch (error) { setError(error); } });
      const disabled = Boolean((loadingRecent || !recentFresh) && !entry._pending);
      inline.save.disabled = disabled || inlineGroupSaves.has(draft?.group || key);
      for (const control of [edit, inline.cancel, remove]) control.disabled = disabled;
      inline.setDisabled(disabled);
      if ((timesMode || popupMode || fullWidthPopupOpen) && trackableTaskIdentityOf(entry)) {
        const running = sameTask(entry, pageState.active);
        const label = `${running ? 'Stop' : 'Start'} tracking ${taskTitleOf(entry) || storedTaskIdentityOf(entry)}`;
        const track = button(label, `entry-track-control ${running ? 'entry-stop' : 'entry-track'}`, async (_event, node) => {
          if (node.disabled || running !== sameTask(entry, pageState.active)) return;
          node.disabled = true;
          try {
            if (running) await stopTimelineEntry(pageState.active);
            else await restartTimelineEntry(entry);
          } catch (error) { setError(error); }
        });
        track.title = label; track.setAttribute('aria-label', label);
        track.disabled = timelineStartInFlight || timelineStopInFlight || timelineDeleteInFlight || Boolean(pageState.pendingWrites?.some(item => item.status === 'conflict'));
        actions.append(track);
      }
      actions.append(edit, inline.cancel, inline.save, remove);
      if (!inline.save.hidden) actions.classList.add('dirty');
      const time = el('span', recentTimeText(entry), 'entry-time-range entry-time-display');
      timeRow.append(time, inline.node, inline.duration, actions);
      timeRow.append(inline.unsaved);
      if (draft?.metadataActive) {
        const metadata = el('div', undefined, 'inline-metadata-editor');
        const urlField = el('input'); urlField.className = 'inline-task-url'; urlField.type = taskUrlOf(entry) ? 'url' : 'text'; urlField.required = true; urlField.value = draft.taskUrl;
        const titleField = el('input'); titleField.className = 'inline-task-title'; titleField.maxLength = 300; titleField.placeholder = 'Optional title'; titleField.value = draft.taskTitle;
        const descriptionField = el('textarea'); descriptionField.className = 'inline-description'; descriptionField.rows = 2; descriptionField.maxLength = 2000; descriptionField.placeholder = 'Optional description'; descriptionField.value = draft.description;
        const descriptionMore = el('span', '↓ More lines — scroll', 'description-overflow-hint'); descriptionMore.hidden = true;
        fitDescriptionTextarea(descriptionField, { minRows: 2, more: descriptionMore });
        descriptionField.addEventListener('input', () => fitDescriptionTextarea(descriptionField, { minRows: 2, more: descriptionMore }));
        const updateMetadata = () => { const value = inlineDrafts.get(key); if (value) inlineDrafts.set(key, { ...value, taskUrl: urlField.value, taskTitle: titleField.value, description: descriptionField.value }); };
        const field = (labelText, input, saveLabel) => {
          const label = el('label', labelText), control = el('span', undefined, 'save-field');
          const save = saveCheckButton(saveLabel, async () => { updateMetadata(); await inline.saveGroup(); });
          save.disabled = disabled || inlineGroupSaves.has(draft.group || key);
          control.append(input, save);
          if (input === descriptionField) control.append(descriptionMore);
          label.append(control); return label;
        };
        metadata.append(
          field(taskUrlOf(entry) ? 'Task URL' : 'Imported task identity (replace with an HTTP(S) URL)', urlField, 'Save task URL'),
          field('Task title (optional)', titleField, 'Save task title'),
          field('Description', descriptionField, 'Save description'),
        );
        for (const input of [urlField, titleField, descriptionField]) {
          input.disabled = disabled; input.addEventListener('input', updateMetadata);
          input.addEventListener('keydown', event => {
            if (event.key !== 'Enter' || !event.isTrusted || event.isComposing || event.keyCode === 229
                || (input === descriptionField && event.shiftKey)) return;
            event.preventDefault(); updateMetadata(); void inline.saveGroup();
          });
        }
        record.append(metadata); Object.assign(editor, { urlField, titleField, descriptionField });
      } else {
        const description = button(entry.description || '+ Add description', 'entry-description entry-description-editable entry-description-link', async (_event, node) => revealTimeEditor(node));
        description.title = 'Edit time'; description.setAttribute('aria-label', 'Edit time');
        record.append(description);
      }
    if (inlineSavedNotices.has(key)) record.append(el('span', '✓ Saved', 'description-saved entry-description-saved'));
    if (timesMode || popupMode || fullWidthPopupOpen) record.prepend(timeRow); else record.prepend(day, timeRow);
    return record;
  }

  function recentGroup(entries, overlaps) {
    const group = el('article', undefined, 'entry');
    const date = entries[0].entryDate || timestampParts(entries[0].startedAt, entries[0].timezone).date;
    const relative = relativeDayLabel(date);
    const marker = new Date(`${date}T12:00:00Z`);
    const label = ['Today', 'Yesterday'].includes(relative) ? relative
      : `${marker.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' })}, ${marker.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' })}`;
    const header = el('div', undefined, 'entry-date-header');
    header.append(el('h2', label), el('span', formatDuration(entries.reduce((sum, entry) => sum + entry.durationSeconds, 0)), 'entry-day-total'));
    group.append(header);
    for (const entry of entries) group.append(recentRecord(entry, overlaps));
    return group;
  }

  function recentRefreshButton() {
    const refresh = button('', 'icon-button', async (event, node) => {
      node.disabled = true;
      try { errorText = ''; renderUi(); recentLoaded = false; await refreshState(true, true); }
      catch (error) { node.disabled = false; setError(error); }
    });
    refresh.disabled = loadingRecent; // GitHub sync runs silently and must not disable Refresh.
    refresh.title = 'Refresh'; refresh.setAttribute('aria-label', 'Refresh'); refresh.append(icon('sync', SYNC_PATH));
    return refresh;
  }

  function renderRecent(container, sourceEntries = recent, emptyState = null, allowCached = false, hideHeader = false) {
    inlineEditors.clear();
    if (!timesMode && !hideHeader) {
      const header = el('div', undefined, 'section-head');
      header.append(el('strong', popupMode || fullWidthPopupOpen ? 'Tracked time' : 'Recent entries'), recentRefreshButton());
      container.append(header);
    }
    if (!recentLoaded && !allowCached) { container.append(el('div', 'Loading recent entries…', 'muted')); return; }
    if (emptyState) container.append(emptyState);
    if (!sourceEntries.length) { if (!emptyState) container.append(el('div', 'No entries in the configured display window.', 'muted')); return; }
    const entries = [...sourceEntries].sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
    const overlaps = overlappingEntries(entries.map(entryWithInlineDraft));
    const groups = new Map();
    for (const entry of entries) {
      const date = entry.entryDate || timestampParts(entry.startedAt, entry.timezone).date;
      if (!groups.has(date)) groups.set(date, []);
      groups.get(date).push(entry);
    }
    for (const [, group] of [...groups].sort(([left], [right]) => right.localeCompare(left))) container.append(recentGroup(group, overlaps));
  }

  function renderPendingConflicts(container) {
    const conflicts = (pageState.pendingWrites ?? []).filter(item => item.status === 'conflict');
    for (const item of conflicts) {
      const unsaved = item.conflictReason === 'active_missing_no_completion' || item.conflictReason === 'active_changed_no_completion';
      const savedWithNewerTimer = item.stage === 'clearActive' && item.conflictReason === 'completion_saved_newer_timer';
      const changedAddTime = item.stage === 'startNext' && item.conflictReason === 'add_time_overlap_changed';
      // Queues persisted before operation was projected to the page expose only
      // their stage. Keep their recovery actionable after an extension upgrade.
      const queuedEdit = ['editEntry', 'editEntries'].includes(item.operation ?? item.stage);
      const queuedAddition = ['addTime', 'bulkAddTimes'].includes(item.operation ?? item.stage);
      const rejectedWrite = item.conflictReason?.startsWith('queued_write_');
      const rejectedStart = rejectedWrite && item.stage === 'startNext';
      const box = el('div', undefined, 'conflict');
      const title = unsaved ? 'Completion was not saved' : savedWithNewerTimer ? 'Newer GitHub timer preserved'
        : changedAddTime ? 'Add time needs review'
        : rejectedStart ? 'Queued start needs attention' : rejectedWrite ? 'Queued write needs attention'
          : queuedAddition ? 'Added time needs review'
            : queuedEdit ? 'Saved edit needs review' : 'Entry path conflict';
      const detail = item.conflictReason === 'active_missing_no_completion'
        ? 'The active timer is gone and no matching completion exists. Discarding removes this unsaved completion.'
        : item.conflictReason === 'active_changed_no_completion'
          ? 'The active timer changed before this completion was saved. Discarding removes this unsaved completion.'
          : savedWithNewerTimer ? 'The completed entry was saved; the newer active timer was preserved.'
            : changedAddTime ? 'Completed time changed before this timer synced. Recheck for overlap or, while online, verify GitHub and discard the unsaved start.'
            : rejectedStart ? 'GitHub rejected this timer start. Check the configured repository and access, then retry.'
              : rejectedWrite ? 'GitHub rejected this queued write. Check the configured repository and access, then retry.'
                : queuedAddition ? 'GitHub could not safely save the locally added time. Retry after reviewing Activity, or discard this addition after verifying it was not already saved.'
                  : queuedEdit ? 'Activity changed after this edit was queued. Retry safely reloads the affected entry and reapplies your saved change.'
                    : 'Repair or remove the conflicting entry in GitHub, then retry.';
      const label = unsaved ? 'Discard unsaved completion' : savedWithNewerTimer ? 'Keep newer timer'
        : changedAddTime ? 'Recheck and retry start'
        : rejectedWrite ? 'Retry queued write' : queuedAddition ? 'Retry added time'
          : queuedEdit ? 'Retry saved edit' : 'Retry entry sync';
      box.append(el('strong', title), el('div', detail, 'muted'));
      box.append(button(label, 'secondary wide', async () => {
        if (unsaved && !confirm('Discard this unsaved completion? This cannot be recovered from the time-data repository.')) return;
        await send({ type: 'RESOLVE_PENDING', id: item.id, ...(unsaved ? { action: 'discard_unsaved_completion' } : {}) });
        recentLoaded = false;
        await refreshState(true, true);
      }));
      if (queuedAddition) box.append(button('Discard unsynced addition', 'link-button', async () => {
        if (!confirm('Discard this locally added time? Clockoli will verify that GitHub does not already contain it.')) return;
        await send({ type: 'RESOLVE_PENDING', id: item.id, action: 'discard_queued_addition' });
        recentLoaded = false;
        await refreshState(false, true);
      }));
      if (queuedEdit) box.append(button('Discard queued edit', 'link-button', async () => {
        if (!confirm('Discard this queued edit? The current Activity data will not be changed.')) return;
        await send({ type: 'RESOLVE_PENDING', id: item.id, action: 'discard_queued_edit' });
        recentLoaded = false;
        await refreshState(true, true);
      }));
      if (changedAddTime) box.append(button('Discard queued start', 'link-button', async () => {
        if (!confirm('Discard this queued start? GitHub must confirm the timer is not already running before the local start can be removed.')) return;
        try {
          await send({ type: 'RESOLVE_PENDING', id: item.id, action: 'discard_queued_start' });
          recentLoaded = false;
          await refreshState(true, true);
        } catch (error) { setError(error); }
      }));
      container.append(box);
    }
  }

  async function loadSelectedTimes(onFailure = null) {
    const loadId = ++timesLoadId;
    selectedTimesCalendarLoadingId = loadId;
    updateCalendarWeekLoading();
    const previousLoaded = recentLoaded;
    recentLoaded = false; errorText = ''; renderUi();
    try {
      // Hydrate durable local edits before the remote week read. Page state is
      // bounded, so it must not replace records already loaded for this week.
      const cached = await send({ type: 'GET_PAGE_STATE', refresh: false });
      if (loadId !== timesLoadId) return;
      if (cached?.configured && Array.isArray(cached.recent)) {
        applyPageState(cached);
        recent = mergeActivityRecords(cached.recent, timesRange(), true);
        recentLoaded = true; recentFresh = false;
        renderUi();
      }
      await refreshRecent(true);
      if (loadId === timesLoadId) await refreshActivityState();
    }
    catch (error) {
      if (loadId !== timesLoadId) return;
      onFailure?.(previousLoaded);
      if (error?.name !== 'AbortError' && error?.code !== 'aborted') setError(error);
      else renderUi();
    } finally {
      if (selectedTimesCalendarLoadingId === loadId) {
        selectedTimesCalendarLoadingId = null;
        updateCalendarWeekLoading();
      }
    }
  }

  function scheduleActivitySearch() {
    if (activitySearchEntries || activitySearchLoading || activitySearchTimer || !timesFilter.trim()) return;
    activitySearchTimer = setTimeout(async () => {
      activitySearchTimer = null;
      if (!timesFilter.trim()) return;
      const generation = ++activitySearchGeneration;
      activitySearchLoading = true; activitySearchError = '';
      renderActivitySearch?.();
      try {
        const data = await send({ type: 'SEARCH_ACTIVITY' });
        if (generation !== activitySearchGeneration) return;
        if (!data?.configured || !Array.isArray(data.recent)) throw new Error('Activity history could not be loaded.');
        activitySearchEntries = data.recent;
        activitySearchPartial = Boolean(data.partial || data.conflicts?.length);
      } catch (error) {
        if (generation !== activitySearchGeneration) return;
        activitySearchError = error.message || 'Activity search failed.';
      } finally {
        if (generation === activitySearchGeneration) {
          activitySearchLoading = false;
          renderActivitySearch?.();
        }
      }
    }, 250);
  }

  async function refreshActivityState() {
    const loadId = ++activityStateLoadId;
    const state = await send({ type: 'GET_PAGE_STATE', refresh: false });
    if (loadId !== activityStateLoadId) return;
    const previous = pageState.active;
    applyPageState(state);
    if (!refreshMountedTimeline()) renderUi();
    if (previous && (previous.id !== pageState.active?.id || previous.startedAt !== pageState.active?.startedAt)) {
      await refreshRecent(true);
    }
  }

  function createWeeklySummary() {
    const weeklySummary = el('section', undefined, 'activity-weekly-summary');
    weeklySummary.setAttribute('aria-label', 'Weekly summary');
    const heading = el('div', undefined, 'activity-weekly-heading');
    heading.append(el('span', 'Statistic', 'activity-weekly-label'), el('span', undefined, 'activity-weekly-range'));
    weeklySummary.append(heading);
    const cards = el('div', undefined, 'activity-weekly-cards');
    for (const [key, label, shape] of [
      ['todayTrackedMs', 'Today', STOPWATCH_PATH],
      ['total', 'Total tracked', STOPWATCH_PATH],
      ['tasks', 'Tasks worked on', 'M2 2h12v12H2V2Zm1.5 1.5v9h9v-9h-9Zm2 2h5V7h-5V5.5Zm0 3h5V10h-5V8.5Z'],
    ]) {
      const card = el('div', undefined, 'activity-weekly-card');
      const badge = el('span', undefined, 'activity-weekly-icon');
      badge.append(icon(key, shape, 19));
      const copy = el('div', undefined, 'activity-weekly-copy');
      const value = el('strong', key === 'todayTrackedMs' ? trackedTotalText(key) : '—', 'activity-weekly-value');
      value.setAttribute(key === 'todayTrackedMs' ? 'data-tracked-total' : 'data-stat', key);
      copy.append(value, el('span', label, 'activity-weekly-name'));
      card.append(badge, copy); cards.append(card);
    }
    weeklySummary.append(cards);
    return weeklySummary;
  }

  function createActivityListRenderer(result, filter, onEmpty = null) {
    const renderFiltered = () => {
      result.replaceChildren(); const query = timesFilter.trim().toLowerCase();
      const drafts = [...inlineDrafts.values()].map(draft => draft.entry);
      const draftKeys = new Set(drafts.map(activityRecordKey));
      const range = timesRange();
      // Keep locally accepted completions visible while GitHub sync is pending.
      const entries = mergeTimelineCompletedEntries(query
        ? [...(activitySearchEntries || []).filter(entry => !draftKeys.has(activityRecordKey(entry))),
          ...recent.filter(entry => entry._pending && !draftKeys.has(activityRecordKey(entry))), ...drafts]
        : recordsWithDrafts(), timelineOptimisticCompletions.values())
        .filter(entry => query || (activityRecordDate(entry) >= range.startDate && activityRecordDate(entry) <= range.endDate)
          || overlapsSelectedWeek(entry) || draftKeys.has(activityRecordKey(entry)));
      const matches = query ? entries.filter(entry => (storedTaskIdentityOf(entry) || '').toLowerCase().includes(query) || taskTitleOf(entry).toLowerCase().includes(query)) : [...entries];
      if (query) {
        result.append(el('p', 'Search results across all weeks', 'muted'));
        if (activitySearchPartial) result.append(el('p', 'Some time repositories or conflicting records could not be searched. Results may be incomplete.', 'notice partial-read-warning'));
      }
      let empty = null;
      if (query && !activitySearchEntries) {
        empty = el('div', undefined, 'activity-empty');
        empty.setAttribute('role', 'status');
        empty.append(el('p', activitySearchError || 'Searching all activity…', activitySearchError ? 'error' : 'muted'));
        if (activitySearchError) empty.append(button('Retry search', 'secondary', () => {
          activitySearchError = ''; scheduleActivitySearch(); renderFiltered();
        }));
      } else if (!matches.length) {
        empty = el('div', undefined, 'activity-empty');
        const firstUse = !entries.length && timesHasTrackedTime === false;
        empty.append(el('p', query ? 'No entries match across all weeks.' : entries.length ? 'No entries match.' : firstUse ? 'Nothing tracked yet. Open a task page and click Clockoli to start.' : 'No time in this range.', 'muted'));
        if (query || entries.length) empty.append(button('Clear filter', 'secondary', () => { timesFilter = ''; filter.value = ''; renderFiltered(); filter.focus(); }));
        else if (!firstUse && onEmpty) empty.append(button('Add time', 'secondary', onEmpty));
      }
      const pageCount = Math.ceil(matches.length / ACTIVITY_SEARCH_PAGE_SIZE);
      if (query && activitySearchEntries) activitySearchPage = Math.min(activitySearchPage, Math.max(0, pageCount - 1));
      const sortedMatches = query && activitySearchEntries
        ? [...matches].sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()) : matches;
      const visibleMatches = query && activitySearchEntries
        ? sortedMatches.slice(activitySearchPage * ACTIVITY_SEARCH_PAGE_SIZE, (activitySearchPage + 1) * ACTIVITY_SEARCH_PAGE_SIZE) : sortedMatches;
      if (query && inlineDrafts.size) {
        const visible = new Set(visibleMatches.map(entryKey));
        for (const entry of drafts) if (!visible.has(entryKey(entry))) visibleMatches.push(entry);
      }
      renderRecent(result, visibleMatches, empty, false, popupMode);
      if (query && activitySearchEntries && pageCount > 1) {
        const pagination = el('nav', undefined, 'times-search-pagination');
        pagination.setAttribute('aria-label', 'Search results pages');
        const previous = button('Previous page', 'secondary', () => { activitySearchPage--; renderFiltered(); });
        const next = button('Next page', 'secondary', () => { activitySearchPage++; renderFiltered(); });
        previous.disabled = activitySearchPage === 0;
        next.disabled = activitySearchPage === pageCount - 1;
        const start = activitySearchPage * ACTIVITY_SEARCH_PAGE_SIZE + 1;
        pagination.append(previous, el('span', `${start}–${Math.min(start + ACTIVITY_SEARCH_PAGE_SIZE - 1, matches.length)} of ${matches.length} · Page ${activitySearchPage + 1} of ${pageCount}`), next);
        result.append(pagination);
      }
    };
    renderActivitySearch = renderFiltered;
    filter.addEventListener('input', () => {
      timesFilter = filter.value;
      activitySearchPage = 0;
      if (timesFilter.trim()) scheduleActivitySearch();
      else { clearTimeout(activitySearchTimer); activitySearchTimer = null; activitySearchGeneration++; activitySearchLoading = false; }
      renderFiltered();
    });
    if (timesFilter.trim() && !activitySearchError) scheduleActivitySearch();
    renderFiltered();
    return renderFiltered;
  }

  function renderTimesPage(preservedTimeline = null) {
    const page = el('main', undefined, 'times-page');
    const body = el('div', undefined, 'times-body');
    if (!pageState.configured && recentLoaded) {
      body.append(el('p', 'Choose where Clockoli should save your time before viewing time.', 'muted'), button('Set up Clockoli', 'primary', async () => send({ type: 'OPEN_OPTIONS' })));
      page.append(body); return page;
    }
    if (pageState.partial) {
      const failed = (pageState.readStatus ?? []).filter(item => item.status === 'error').length;
      const conflicts = pageState.readConflicts?.length || 0;
      const warning = el('p', [
        failed ? `${failed} time ${failed === 1 ? 'repository' : 'repositories'} could not be loaded.` : '',
        conflicts ? `${conflicts} conflicting ${conflicts === 1 ? 'record was' : 'records were'} omitted.` : '',
        'Showing available activity.',
      ].filter(Boolean).join(' '), 'notice partial-read-warning');
      body.append(warning);
    }
    const toolbar = el('section', undefined, 'times-toolbar');
    const filterLabel = el('label'), filter = el('input'); filter.type = 'search'; filter.placeholder = 'Search entries'; filter.setAttribute('aria-label', 'Search activity'); filter.value = timesFilter; filterLabel.className = 'times-filter';
    filterLabel.append(icon('search', 'M7 1a6 6 0 1 0 3.708 10.72l3.286 3.286a.75.75 0 0 0 1.06-1.06l-3.286-3.286A6 6 0 0 0 7 1Zm-4.5 6a4.5 4.5 0 1 1 9 0 4.5 4.5 0 0 1-9 0Z', 18), filter);
    toolbar.append(filterLabel);
    const result = el('section', undefined, 'times-results activity-list');
    const renderFiltered = createActivityListRenderer(result, filter, () => { bulkOpen = true; bulk.open = true; input.focus(); });
    const weeklySummary = createWeeklySummary();
    const summaryHost = document.getElementById?.('activity-summary');
    const views = el('div', undefined, 'times-view-modes');
    views.setAttribute('role', 'group'); views.setAttribute('aria-label', 'Activity view');
    for (const mode of ['timeline', 'calendar', 'list']) {
      const control = button(mode[0].toUpperCase() + mode.slice(1), 'times-view-button', () => {
        const switched = activityViewMode !== mode;
        activityViewMode = mode;
        try { globalThis.localStorage?.setItem(ACTIVITY_VIEW_KEY, mode); } catch { /* keep this tab's selection */ }
        saveActivityViewMode(mode);
        if (switched) {
          resetWeekForViewSwitch();
          if (mode === 'timeline') activityInitialFocusPending = true;
          body.querySelector('.timeline-shell')?.classList.toggle('calendar-week-navigation', mode === 'calendar');
          if (mode !== 'list') timelineInstance?.setViewMode?.(mode);
          return loadSelectedTimes();
        }
        if (mode === 'list') renderFiltered();
        for (const choice of views.children) choice.setAttribute('aria-pressed', String(choice === control));
        timeline.hidden = mode === 'list'; result.hidden = mode !== 'list';
        listTotal.hidden = mode !== 'list';
        calendarStatus.hidden = mode !== 'calendar';
        filterLabel.hidden = mode !== 'list'; refresh.hidden = mode !== 'list'; toolbar.classList.toggle('times-visual', mode !== 'list');
        if (mode !== 'list') timelineInstance?.setViewMode?.(mode);
        if (mode === 'timeline' && !activityTimelineView) refreshMountedTimeline();
        if (mode === 'calendar') focusActivityCalendarPeriod();
        if (mode === 'calendar') return loadActivityCalendarWeek(timelineInstance?.getCalendarRange?.());
      });
      control.setAttribute('aria-label', mode[0].toUpperCase() + mode.slice(1));
      control.setAttribute('title', mode[0].toUpperCase() + mode.slice(1));
      const shapes = {
        timeline: 'M1 12h14v1.5H1V12Zm2-3h2v2H3V9Zm3-4h2v6H6V5Zm3 2h2v4H9V7Zm3-5h2v9h-2V2Z',
        calendar: 'M4 0a.75.75 0 0 1 .75.75V2h6V.75a.75.75 0 0 1 1.5 0V2h1A2.75 2.75 0 0 1 16 4.75v8.5A2.75 2.75 0 0 1 13.25 16H2.75A2.75 2.75 0 0 1 0 13.25v-8.5A2.75 2.75 0 0 1 2.75 2h1V.75A.75.75 0 0 1 4 0ZM1.5 6.5v6.75c0 .69.56 1.25 1.25 1.25h10.5c.69 0 1.25-.56 1.25-1.25V6.5h-13ZM3 9h3v1.5H3V9Zm5 0h3v1.5H8V9Z',
        list: 'M1 2h2v2H1V2Zm4 0h10v2H5V2ZM1 7h2v2H1V7Zm4 0h10v2H5V7Zm-4 5h2v2H1v-2Zm4 0h10v2H5v-2Z',
      };
      control.prepend(icon(mode, shapes[mode], 18));
      control.setAttribute('aria-pressed', String(mode === activityViewMode)); views.append(control);
    }
    if (summaryHost) summaryHost.replaceChildren(weeklySummary);
    else body.append(weeklySummary);
    const viewHost = document.getElementById?.('activity-view-switcher');
    if (viewHost) viewHost.replaceChildren(views);
    else body.append(views);
    const listTotal = el('div', listWeekTotalText(), 'times-list-total');
    listTotal.hidden = activityViewMode !== 'list';
    const refresh = recentRefreshButton(); refresh.classList.add('times-refresh');
    refresh.hidden = activityViewMode !== 'list';
    toolbar.append(weekNavigation(), refresh);
    body.append(toolbar, listTotal);
    const calendarStatus = el('div', activityCalendarStatusText, 'times-calendar-status muted');
    calendarStatus.setAttribute('role', 'status'); calendarStatus.setAttribute('aria-live', 'polite');
    calendarStatus.hidden = activityViewMode !== 'calendar';
    const timeline = renderPopupTimeline(preservedTimeline);
    timeline.hidden = activityViewMode === 'list'; result.hidden = activityViewMode !== 'list';
    filterLabel.hidden = activityViewMode !== 'list'; toolbar.classList.toggle('times-visual', activityViewMode !== 'list');
    body.append(timeline, result, calendarStatus);
    placeCalendarWeekNavigation(body, activityViewMode);
    const bulk = el('details', undefined, 'bulk-time');
    bulk.open = bulkOpen; bulk.addEventListener('toggle', () => { bulkOpen = bulk.open; });
    const summary = el('summary', 'Bulk time adding'); bulk.append(summary);
    const help = el('p', 'One entry per line: date, URL, optional description, then hours. Imports are all-or-nothing and are appended after existing time on each day.', 'muted');
    const examples = el('div', undefined, 'bulk-time-examples');
    examples.append(el('strong', 'Examples'), el('pre', `2026/08/21 https://example.com/task Search relevance 6:00
2026-08-22 https://github.com/acme/app/issues/42 Fix ranking 6.5
23.08.2026 https://example.com/call Customer call 1:30
24/08/2026 https://example.com/release Release preparation 0.25`));
    const input = el('textarea'); input.rows = 8; input.className = 'bulk-time-input'; input.setAttribute('aria-label', 'Bulk time entries'); input.value = bulkDraft; input.disabled = bulkMutation;
    input.placeholder = 'Enter one entry per line';
    input.addEventListener('input', () => { bulkDraft = input.value; bulkFeedback = null; shadow?.querySelector('.bulk-time-feedback')?.remove(); });
    const add = button('Add time', 'primary', async () => {
      if (bulkMutation) return;
      bulkDraft = input.value; bulkOpen = true; bulkMutation = true; bulkFeedback = null; errorText = ''; renderUi();
      let added = null;
      try {
        const result = await send({ type: 'BULK_ADD_TIMES', text: bulkDraft });
        added = result.added;
        bulkDraft = ''; bulkMutation = false;
        // Accepted records are already durable in IndexedDB. Show them now,
        // without waiting for a GitHub history read or the 15-second flush.
        if (Array.isArray(result.entries)) {
          const accepted = result.entries.map(entry => ({ ...entry, destinationId: result.destinationId }));
          recent = mergeActivityRecords(accepted, timesRange(), true);
          recentLoaded = true;
          recentFresh = true;
        }
        void refreshActivityState().catch(setError);
        bulkFeedback = { kind: 'success', message: `${added} ${added === 1 ? 'entry was' : 'entries were'} added.` };
      } catch (error) {
        bulkMutation = false;
        if (isExtensionContextInvalidated(error)) { deactivateExtensionContext(); return; }
        const message = error?.message || 'Could not add time.';
        bulkFeedback = { kind: 'error', message };
      }
      renderUi();
    }); add.disabled = bulkMutation;
    bulk.append(help, examples, input, add); body.append(bulk);
    if (bulkFeedback) {
      const feedback = el('div', undefined, `bulk-time-feedback bulk-time-feedback-${bulkFeedback.kind}`);
      feedback.setAttribute('role', bulkFeedback.kind === 'error' ? 'alert' : 'status');
      const dismiss = button('×', 'bulk-time-feedback-dismiss', () => { bulkFeedback = null; feedback.remove(); });
      dismiss.setAttribute('aria-label', 'Dismiss bulk time message');
      feedback.append(el('span', bulkFeedback.message), dismiss);
      body.append(feedback);
    }
    if (errorText) body.prepend(el('div', errorText, errorCode ? 'error' : 'notice'));
    page.append(body); return page;
  }

  function mergeTimelineCompletedEntries(completed, optimisticCompletions) {
    const byId = new Map();
    const anonymous = [];
    for (const entry of completed) {
      if (entry?.id) byId.set(entry.id, entry);
      else anonymous.push(entry);
    }
    for (const entry of optimisticCompletions) {
      if (!entry?.id) { anonymous.push(entry); continue; }
      const local = byId.get(entry.id);
      const localUpdated = Date.parse(local?.updatedAt), optimisticUpdated = Date.parse(entry.updatedAt);
      // Stop can be followed immediately by another edit. Once its newer
      // IndexedDB projection has arrived, never reapply an older Stop snapshot.
      if (local?._pending && Number.isFinite(localUpdated) && Number.isFinite(optimisticUpdated)
          && localUpdated >= optimisticUpdated) continue;
      byId.set(entry.id, entry);
    }
    return [...byId.values(), ...anonymous];
  }

  function popupTimelineEntries(windowStart, now) {
    const week = weekWindow();
    windowStart = Math.max(windowStart, week.start);
    const completed = recent.filter(entry => entry._path && (entry._sha || entry._pending)
      && Number.isFinite(new Date(entry.startedAt).getTime()) && Number.isFinite(new Date(entry.endedAt).getTime())
      && new Date(entry.startedAt).getTime() < Math.min(now, week.end) && new Date(entry.endedAt).getTime() > windowStart)
      .sort((left, right) => new Date(left.startedAt) - new Date(right.startedAt));
    const entries = mergeTimelineCompletedEntries(completed, timelineOptimisticCompletions.values());
    if (weekWindow().start === weekWindow(Date.now()).start
      && pageState.active && new Date(pageState.active.startedAt).getTime() <= now) {
      entries.push({ ...pageState.active, endedAt: new Date(now).toISOString(), _active: true });
    }
    return entries.map(entry => {
      const optimistic = timelineOptimisticEdits.get(entry.id);
      return { ...entry, isPending: Boolean(entry._pending || optimistic), ...(optimistic || {}) };
    })
      .filter(entry => Number.isFinite(new Date(entry.startedAt).getTime())
        && Number.isFinite(new Date(entry.endedAt).getTime())
        && (entry._active ? new Date(entry.startedAt).getTime() <= now : new Date(entry.startedAt).getTime() < Math.min(now, week.end))
        && new Date(entry.endedAt).getTime() > windowStart)
      .sort((left, right) => new Date(left.startedAt) - new Date(right.startedAt));
  }

  function popupTimelineItems(historyStart, now) {
    const byId = new Map();
    const entries = popupTimelineEntries(historyStart, now);
    const completedDisplayEnd = weekWindow().end <= Date.now() ? weekWindow().end : now;
    const rows = popupTimelineRows(entries);
    const items = entries.map((entry) => {
      const stableId = entry.id || `${entry._path}:${entry._index}`;
      const id = `${entry._active ? 'active' : 'entry'}:${stableId}`;
      const projectName = projectNameForUrl(storedTaskIdentityOf(entry), pageState.projects, pageState.otherProjectName);
      byId.set(id, entry);
      return {
        id,
        rowId: projectRowId(projectName),
        url: taskUrlOf(entry),
        taskIdentity: storedTaskIdentityOf(entry),
        title: taskTitleOf(entry) || storedTaskIdentityOf(entry) || 'Untitled task',
        faviconUrl: siteFaviconUrl(entry),
        description: entry._active ? activeDescriptionValue(entry) : (timelineDescriptionDrafts.get(entry.id) ?? entry.description ?? ''),
        savedDescription: entry.description || '',
        originalStartedAt: new Date(entry.startedAt).getTime(),
        originalEndedAt: entry._active ? null : new Date(entry.endedAt).getTime(),
        startedAt: Math.max(historyStart, weekWindow().start, new Date(entry.startedAt).getTime()),
        endedAt: entry._active ? null : Math.min(completedDisplayEnd, new Date(entry.endedAt).getTime()),
        isRunning: Boolean(entry._active),
        isCurrentTask: Boolean(!entry._active && sameTask(entry, pageState.active)),
        isEditable: !entry._active && (timesMode || completeVisualWeekStart === weekWindow().start),
        isPending: Boolean(entry.isPending),
        isStartDisabled: !trackableTaskIdentityOf(entry) || timelineStartInFlight || timelineStopInFlight || timelineDeleteInFlight || sameTask(entry, pageState.active)
          || Boolean(pageState.pendingWrites?.some(item => item.status === 'conflict')),
        isStopDisabled: Boolean((entry._active || sameTask(entry, pageState.active)) && (timelineStartInFlight || timelineStopInFlight || timelineDeleteInFlight
          || pageState.pendingWrites?.some(item => item.status === 'conflict'))),
        isDeleteDisabled: timelineDeleteInFlight || timelineStartInFlight || timelineStopInFlight
          || Boolean(pageState.pendingWrites?.some(item => item.status === 'conflict')),
      };
    });
    return { items, rows, byId };
  }

  function rememberTimelineDescription(entry, value) {
    if (entry._active) {
      descriptionDraft = { id: entry.id || entry.startedAt, taskUrl: taskUrlOf(entry), value };
      return;
    }
    if (normalizedDescription(value) === normalizedDescription(entry.description)) timelineDescriptionDrafts.delete(entry.id);
    else timelineDescriptionDrafts.set(entry.id, value);
  }

  function popupTimelineRows(entries) {
    const names = new Set(entries.map(entry => projectNameForUrl(storedTaskIdentityOf(entry), pageState.projects, pageState.otherProjectName)));
    const rows = (pageState.projects || []).filter(project => names.has(project.name))
      .map(project => ({ id: projectRowId(project.name), title: project.name }));
    const otherProjectName = String(pageState.otherProjectName || 'Other');
    if (names.has(otherProjectName) && !rows.some(row => row.id === projectRowId(otherProjectName))) {
      rows.push({ id: projectRowId(otherProjectName), title: otherProjectName });
    }
    return rows.length ? rows : [{ id: projectRowId(otherProjectName), title: otherProjectName }];
  }

  function timelineTrackActionDisabled() {
    const current = taskFromLocation();
    return !current || sameTask(current, pageState.active) || timelineStartInFlight || timelineStopInFlight
      || timelineDeleteInFlight || Boolean(pageState.pendingWrites?.some(item => item.status === 'conflict'));
  }

  function timelineNow() {
    const activeStart = new Date(pageState.active?.startedAt).getTime();
    return Number.isFinite(activeStart) ? Math.max(Date.now(), activeStart) : Date.now();
  }

  function activityHistoryStart(fallback) {
    if (timesMode && activityViewMode !== 'calendar') return fallback;
    return recent.reduce((start, entry) => {
      const timestamp = new Date(entry.startedAt).getTime();
      return Number.isFinite(timestamp) ? Math.min(start, timestamp) : start;
    }, fallback);
  }

  function openTimelineList() {
    if (timesMode) { activityViewMode = 'list'; saveActivityViewMode('list'); renderUi(); }
    else { timelineViewMode = 'list'; saveActivityViewMode('list'); applyCompactViewMode(); refreshCompactSurface(); }
  }

  function timelineWeekError(error) {
    if (!(error instanceof RangeError) || !/overlap/i.test(error.message)) return null;
    const warning = el('div', undefined, 'timeline-week-error error');
    warning.setAttribute('role', 'alert');
    warning.append(el('strong', 'Overlapping entries prevent this week from being displayed.'),
      el('div', 'Go to List for this week and resolve the overlapping time entries manually.'));
    warning.append(button('Go to List', 'secondary', openTimelineList));
    return warning;
  }

  function showTimelineEditConflict(error) {
    if (!/overlap/i.test(error?.message || '')) return false;
    const section = (timesMode ? shadow : fullWidthPopupShadow || shadow)?.querySelector('.popup-timeline-section');
    if (!section) return false;
    section.querySelector('.timeline-edit-error')?.remove();
    const warning = el('div', undefined, 'timeline-edit-error error');
    warning.setAttribute('role', 'alert');
    warning.append(el('strong', 'Time entry was not moved.'),
      el('div', `${error.message} Go to List for this week and resolve the overlapping entries manually.`),
      button('Go to List', 'secondary', openTimelineList));
    section.insertBefore(warning, section.querySelector('.timeline-shell'));
    return true;
  }

  function showTimelineWeekError(error) {
    const warning = timelineWeekError(error);
    if (!warning) return false;
    timelineInstance?.destroy(); timelineInstance = null; timelineWindow = null;
    const shell = (timesMode ? shadow : fullWidthPopupShadow || shadow)?.querySelector('.popup-timeline-section .timeline-shell');
    shell?.replaceChildren(warning);
    return Boolean(shell);
  }

  function refreshMountedTimeline() {
    if (!pageState.configured || !timelineInstance || !timelineWindow) return false;
    const periodStart = weekWindow().start;
    timelineWindow = { ...timelineWindow, now: Math.min(timelineNow(), weekWindow().end - 1),
      historyStart: activityHistoryStart(periodStart) };
    const { items, rows, byId } = popupTimelineItems(timelineWindow.historyStart, timelineWindow.now);
    timelineEntriesById = byId;
    const refocus = !(timesMode ? activityTimelineView : timelineView);
    if (refocus) {
      if (timesMode) activityTimelineView = activityPeriodTimelineView(timelineWindow.now);
      else timelineView = activityPeriodTimelineView(timelineWindow.now);
    }
    try {
      timelineInstance.update({ items, rows, now: timelineWindow.now,
        domainStart: periodStart, totalRange: activityTotalRange(),
        ...(refocus && timelineInstance.getViewMode?.() !== 'calendar'
          ? { view: timesMode ? activityTimelineView : timelineView } : {}) });
    } catch (error) {
      if (showTimelineWeekError(error)) return true;
      throw error;
    }
    if (timesMode && activityInitialFocusPending && recentFresh
        && periodStart === weekWindow(Date.now()).start && timelineInstance.getViewMode?.() === 'timeline') {
      timelineInstance.scrollToEnd();
      activityInitialFocusPending = false;
      activityInitialFocusMounted = true;
    }
    updateListWeekTotal();
    refreshCompactSurface();
    refreshTimelineQueueIndicator();
    return true;
  }

  function beginTimelineStop() {
    if (timelineStopInFlight) return false;
    timelineStopInFlight = true;
    refreshMountedTimeline();
    return true;
  }

  function finishTimelineStop() {
    timelineStopInFlight = false;
    refreshMountedTimeline();
    if (timesMode && activityViewMode === 'list') renderUi();
  }

  function refreshMountedTimelineAtRightEdge(startedAt) {
    const startedAtMs = new Date(startedAt).getTime();
    if (!Number.isFinite(startedAtMs)) return false;
    if (weekWindow().start !== weekWindow(Date.now()).start) return refreshMountedTimeline();
    timelineScrollToRightPending = true;
    if (!timelineInstance || !timelineWindow || !timelineView) return false;
    const now = Math.max(Date.now(), startedAtMs);
    timelineWindow = { ...timelineWindow, now };
    const { items, rows, byId } = popupTimelineItems(timelineWindow.historyStart, now);
    timelineEntriesById = byId;
    if (timelineGraphicViewMode === 'calendar') {
      timelineInstance.update({ items, rows, now });
    } else {
      const span = Math.max(1, timelineView.end - timelineView.start);
      timelineView = { start: now - span, end: now, focusedAt: now };
      timelineInstance.update({ items, rows, now, view: timelineView });
    }
    timelineInstance.scrollToEnd();
    refreshCompactSurface();
    timelineScrollToRightPending = false;
    return true;
  }

  function rememberCompletedLocally(completion, destinationId) {
    if (!completion?.entry?.id) return;
    const local = completion.localEntry ?? completion.entry;
    timelineOptimisticCompletions.set(completion.entry.id, {
      ...completion.entry, ...local,
      destinationId: local.destinationId ?? completion.entry.destinationId ?? destinationId,
      _pending: Boolean(completion.pending), _optimisticCompletion: true,
    });
  }

  function acceptTimelineStartImmediately(task, { completePrevious = false, identity = '', previousDescription } = {}) {
    const startedAt = new Date().toISOString();
    const previousActive = pageState.active;
    const acceptanceId = beginTimelineQueueAcceptance();
    const previousDescriptionDraft = descriptionDraft ? { ...descriptionDraft } : null;
    const context = { acceptanceId, acceptedActive: null, previousActive, previousDescriptionDraft, startedAt };
    try {
      if (completePrevious && previousActive?.id && Number.isFinite(new Date(previousActive.startedAt).getTime())) {
        timelineOptimisticCompletions.set(previousActive.id, {
          ...previousActive, description: previousDescription ?? previousActive.description ?? '', endedAt: startedAt,
          durationSeconds: Math.max(0, Math.floor((new Date(startedAt) - new Date(previousActive.startedAt)) / 1_000)),
          _pending: true, _optimisticCompletion: true,
        });
      }
      const acceptedActive = {
        id: `timeline-local:${identity || trackableTaskIdentityOf(task)}:${acceptanceId}`,
        taskUrl: trackableTaskIdentityOf(task), taskTitle: taskTitleOf(task) || '',
        startedAt, entryDate: localDateValue(new Date(startedAt)), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, _pending: true,
      };
      context.acceptedActive = acceptedActive;
      timelineAcceptedActive = acceptedActive;
      pageState = { ...pageState, active: acceptedActive };
      recentLoadId += 1; recentLoad = null; loadingRecent = false;
      refreshTimelineQueueIndicator();
      if (!refreshMountedTimelineAtRightEdge(startedAt)) renderUi();
      return context;
    } catch (error) {
      timelineAcceptedActive = null;
      if (previousActive?.id) timelineOptimisticCompletions.delete(previousActive.id);
      pageState = { ...pageState, active: previousActive };
      descriptionDraft = previousDescriptionDraft;
      finishTimelineQueueAcceptance(acceptanceId);
      throw error;
    }
  }

  function rollbackTimelineStart(context) {
    timelineAcceptedActive = null;
    if (context.previousActive?.id) timelineOptimisticCompletions.delete(context.previousActive.id);
    pageState = { ...pageState, active: context.previousActive };
    descriptionDraft = context.previousDescriptionDraft;
    if (!refreshMountedTimeline()) renderUi();
  }

  async function trackCurrentTimelineTask({ preserveSavedDescription = false } = {}) {
    if (timelineStartInFlight || timelineStopInFlight || timelineDeleteInFlight) return;
    timelineStartInFlight = true;
    refreshMountedTimeline();
    let startContext = null;
    try {
      const task = popupMode ? await refreshPopupTask() : taskFromLocation();
      if (!task) throw new Error('Open an HTTP(S) page to start tracking.');
      if (sameTask(task, pageState.active)) return;
      const switching = Boolean(pageState.active);
      if (switching && !confirmLongEntry()) return;
      const previousDescription = activeDescriptionValue();
      const hasDraft = Boolean(descriptionDraft && pageState.active
        && descriptionDraft.id === (pageState.active.id || pageState.active.startedAt)
        && descriptionDraft.taskUrl === taskUrlOf(pageState.active));
      startContext = acceptTimelineStartImmediately(task, { completePrevious: switching, identity: 'current-task', previousDescription });
      const result = await send(switching
        ? { type: 'SWITCH_TASK', taskUrl: task.taskUrl, taskTitle: task.taskTitle || '',
          ...(preserveSavedDescription && !hasDraft ? {} : { description: previousDescription }) }
        : { type: 'START', taskUrl: task.taskUrl, taskTitle: task.taskTitle || '' });
      if (switching) rememberCompletedLocally(result?.stopped, result?.destinationId);
      const active = switching ? result?.active : result;
      if (active?.id) {
        timelineAcceptedActive = { ...active, _pending: Boolean(active._pending) };
        pageState = { ...pageState, active: timelineAcceptedActive };
        if (!refreshMountedTimeline() || (timesMode && activityViewMode === 'list')) renderUi();
      }
      void refreshMountedTimelineState().catch(setError);
    } catch (error) {
      if (startContext) rollbackTimelineStart(startContext);
      setError(error);
      throw error;
    } finally {
      if (startContext) finishTimelineQueueAcceptance(startContext.acceptanceId);
      refreshTimelineQueueIndicator();
      timelineStartInFlight = false;
      refreshMountedTimeline();
    }
  }

  function beginTimelineQueueAcceptance() {
    const id = `local:${++timelineQueueAcceptanceSequence}`;
    timelineQueueAcceptances.add(id);
    return id;
  }

  function finishTimelineQueueAcceptance(id) { timelineQueueAcceptances.delete(id); }

  function timelineQueueSize() { return Math.max(Number(pageState.pendingCount) || 0, timelineQueuedOperationIds.size + timelineQueueAcceptances.size); }

  function refreshTimelineQueueIndicator() {
    if (!timelineQueueIndicator) return;
    const status = globalThis.ClockoliRecovery.describeSaveStatus({ ...pageState, pendingCount: timelineQueueSize(),
      saving: timelineQueueAcceptances.size > 0 || timelineStartInFlight || timelineStopInFlight });
    // Ordinary local writes never show a saving/waiting status. Only an
    // actionable synchronization failure belongs in the visible feedback.
    const hidden = !status.conflict && !status.action;
    timelineQueueIndicator.hidden = hidden;
    timelineQueueIndicator.setAttribute('aria-hidden', String(hidden));
    timelineQueueIndicator.textContent = status.label;
  }

  function applyTimelineOptimisticEntry(entry, edits) {
    recent = recent.map(item => {
      if (item.id !== entry.id || item._path !== entry._path) return item;
      const startedAt = edits.startedAt ?? item.startedAt, endedAt = edits.endedAt ?? item.endedAt;
      return {
        ...item, ...edits, startedAt, endedAt,
        entryDate: timestampParts(startedAt, item.timezone).date,
        durationSeconds: Math.max(0, Math.floor((new Date(endedAt) - new Date(startedAt)) / 1000)),
      };
    });
  }

  function rollbackTimelineOptimisticEdit(entry, generation, restoreRecent) {
    const state = timelineOptimisticEditStates.get(generation);
    if (!state) return;
    state.rejected = true;
    if (timelineOptimisticEditGenerations.get(entry.id) !== generation) return;
    let restore = state;
    while (restore.previousGeneration) {
      const previousState = timelineOptimisticEditStates.get(restore.previousGeneration);
      if (previousState?.settled) {
        if (restoreRecent && restore.previousEntry) {
          recent = recent.map(item => item.id === entry.id && item._path === entry._path && item.destinationId === entry.destinationId ? restore.previousEntry : item);
        }
        timelineOptimisticEdits.delete(entry.id);
        timelineOptimisticEditGenerations.delete(entry.id);
        return;
      }
      if (!previousState?.rejected) break;
      restore = previousState;
    }
    if (restoreRecent && restore.previousEntry) {
      recent = recent.map(item => item.id === entry.id && item._path === entry._path && item.destinationId === entry.destinationId ? restore.previousEntry : item);
    }
    if (restore.hadPreviousOptimisticEdit) timelineOptimisticEdits.set(entry.id, restore.previousOptimisticEdit);
    else timelineOptimisticEdits.delete(entry.id);
    if (restore.previousGeneration) timelineOptimisticEditGenerations.set(entry.id, restore.previousGeneration);
    else timelineOptimisticEditGenerations.delete(entry.id);
  }

  async function queueCalendarEntry(entry, edits) {
    const acceptanceId = beginTimelineQueueAcceptance();
    const requestOrder = timelineQueueAcceptanceSequence;
    refreshTimelineQueueIndicator();
    try {
      const result = await send({ type: 'QUEUE_ENTRY_EDIT', payload: {
        destinationId: entry.destinationId,
        path: entry._path, originalSha: entry._sha, index: entry._index,
        original: originalRecord(entry), edits,
      } });
      // A slower earlier acceptance must not replace a newer accepted edit.
      if (requestOrder < (timelineAcceptedEditOrders.get(entry.id) || 0)) return;
      timelineAcceptedEditOrders.set(entry.id, requestOrder);
      const previousEntry = recent.find(item => item.id === entry.id && item._path === entry._path && item.destinationId === entry.destinationId);
      const previousOptimisticEditGeneration = timelineOptimisticEditGenerations.get(entry.id);
      const optimisticEditGeneration = {};
      timelineOptimisticEditStates.set(optimisticEditGeneration, {
        previousEntry, hadPreviousOptimisticEdit: timelineOptimisticEdits.has(entry.id),
        previousOptimisticEdit: timelineOptimisticEdits.get(entry.id),
        previousGeneration: previousOptimisticEditGeneration, rejected: false, settled: false,
      });
      timelineOptimisticEditGenerations.set(entry.id, optimisticEditGeneration);
      timelineOptimisticEdits.set(entry.id, edits);
      applyTimelineOptimisticEntry(entry, edits);
      trackTimelineQueuedOperation(result?.operationId, entry.id, optimisticEditGeneration);
      (timesMode ? shadow : fullWidthPopupShadow || shadow)?.querySelector('.timeline-edit-error')?.remove();
      recordTimelineQueueDiagnostic('Edit time entry: accepted locally and queued for GitHub.');
    } catch (error) {
      recordTimelineQueueDiagnostic('Edit time entry: local queue rejected the change.');
      throw error;
    } finally {
      finishTimelineQueueAcceptance(acceptanceId);
      refreshTimelineQueueIndicator();
      if (!refreshMountedTimeline()) renderUi();
    }
    void refreshMountedTimelineState().catch(setError);
  }

  async function queueActiveEdit(entry, requestedEdits, diagnostic = 'Edit running timer') {
    const hadPreviousOptimisticEdit = timelineOptimisticEdits.has(entry.id);
    const previousOptimisticEdit = timelineOptimisticEdits.get(entry.id);
    const previousOptimisticEditGeneration = timelineOptimisticEditGenerations.get(entry.id);
    const optimisticEditGeneration = {};
    const edits = { ...(previousOptimisticEdit || {}), ...requestedEdits };
    if (requestedEdits.startedAt !== undefined && requestedEdits.description === undefined) delete edits.description;
    const acceptVisualEdit = () => {
      timelineOptimisticEditStates.set(optimisticEditGeneration, {
        previousEntry: null, hadPreviousOptimisticEdit, previousOptimisticEdit,
        previousGeneration: previousOptimisticEditGeneration, rejected: false, settled: false,
      });
      timelineOptimisticEditGenerations.set(entry.id, optimisticEditGeneration);
      timelineOptimisticEdits.set(entry.id, edits);
      refreshMountedTimeline();
    };
    const waitForAcceptance = requestedEdits.startedAt !== undefined;
    if (!waitForAcceptance) acceptVisualEdit();
    const acceptanceId = beginTimelineQueueAcceptance();
    const requestOrder = timelineQueueAcceptanceSequence;
    refreshTimelineQueueIndicator();
    if (!timelineInstance) renderUi();
    try {
      const result = await send({ type: 'QUEUE_ACTIVE_START_EDIT', payload: {
        original: { id: entry.id, startedAt: entry.startedAt },
        ...(requestedEdits.startedAt !== undefined ? { startedAt: requestedEdits.startedAt } : {}),
        ...(requestedEdits.description !== undefined ? { description: requestedEdits.description } : {}),
      } });
      if (waitForAcceptance) {
        if (requestOrder < (timelineAcceptedEditOrders.get(entry.id) || 0)) return;
        timelineAcceptedEditOrders.set(entry.id, requestOrder);
        acceptVisualEdit();
      }
      trackTimelineQueuedOperation(result?.operationId, entry.id, optimisticEditGeneration);
      recordTimelineQueueDiagnostic(`${diagnostic}: accepted locally and queued for GitHub.`);
    } catch (error) {
      if (!waitForAcceptance) rollbackTimelineOptimisticEdit(entry, optimisticEditGeneration, false);
      recordTimelineQueueDiagnostic(`${diagnostic}: local queue rejected the change.`);
      throw error;
    } finally {
      finishTimelineQueueAcceptance(acceptanceId);
      refreshTimelineQueueIndicator();
      if (!refreshMountedTimeline()) renderUi();
    }
    void refreshMountedTimelineState().catch(setError);
  }

  function queueActiveStartEdit(entry, startedAt) {
    return queueActiveEdit(entry, { startedAt: new Date(startedAt).toISOString() }, 'Adjust timer start');
  }

  async function queueActiveDescriptionEdit(entry, description) {
    await queueActiveEdit(entry, { description }, 'Edit running timer description');
    retireActiveDescriptionDraft(entry, description);
  }

  async function queueTimelineEntryDelete(entry) {
    if (!entry || timelineDeleteInFlight || timelineStartInFlight || timelineStopInFlight) return false;
    if (!confirm(`Delete this ${formatDuration(entry.durationSeconds)} entry?`)) return false;
    timelineDeleteInFlight = true;
    const previousRecent = recent, previousCompletion = timelineOptimisticCompletions.get(entry.id);
    const previousTotals = { todayTrackedMs: pageState.todayTrackedMs, weekTrackedMs: pageState.weekTrackedMs };
    recent = recent.filter(item => !(item.id === entry.id && item._path === entry._path && item.destinationId === entry.destinationId));
    timelineOptimisticCompletions.delete(entry.id);
    pageState = { ...pageState, todayTrackedMs: null, weekTrackedMs: null };
    const acceptanceId = beginTimelineQueueAcceptance();
    refreshTimelineQueueIndicator();
    refreshMountedTimeline();
    recordTimelineQueueDiagnostic('Delete time entry: accepted locally and queued for GitHub.');
    if (timesMode && activityViewMode === 'list') renderUi();
    try {
      const result = await send({ type: 'QUEUE_ENTRY_DELETE', payload: {
        destinationId: entry.destinationId,
        path: entry._path, originalSha: entry._sha, index: entry._index, original: originalRecord(entry),
      } });
      if (result?.operationId) timelineQueuedOperationIds.set(result.operationId, entry.id);
    } catch (error) {
      recent = previousRecent;
      if (previousCompletion) timelineOptimisticCompletions.set(entry.id, previousCompletion);
      pageState = { ...pageState, ...previousTotals };
      recordTimelineQueueDiagnostic('Delete time entry: local queue rejected the change.');
      throw error;
    } finally {
      finishTimelineQueueAcceptance(acceptanceId);
      timelineDeleteInFlight = false;
      refreshTimelineQueueIndicator();
      if (!refreshMountedTimeline() || (timesMode && activityViewMode === 'list')) renderUi();
    }
    void refreshMountedTimelineState().catch(setError);
    return true;
  }

  async function stopTimelineEntry(activeEntry, { preserveSavedDescription = false } = {}) {
    if (!activeEntry || timelineStartInFlight || timelineDeleteInFlight || !beginTimelineStop()) return false;
    try {
      if (!confirmLongEntry(activeEntry)) return false;
      const result = await send(preserveSavedDescription ? { type: 'STOP' } : { type: 'STOP', description: activeDescriptionValue(activeEntry) });
      if (!result?.entry?.id) throw new Error('The locally accepted Stop did not return its completed time entry.');
      if (timelineAcceptedActive && sameTask(timelineAcceptedActive, activeEntry)) timelineAcceptedActive = null;
      rememberCompletedLocally(result, result.destinationId);
      pageState = { ...pageState, active: null };
      refreshMountedTimeline();
      if (timesMode && activityViewMode === 'list') renderUi();
      await refreshState(false, false);
      return true;
    } catch (error) { setError(error); throw error; }
    finally { finishTimelineStop(); }
  }

  async function restartTimelineEntry(entry) {
    if (!entry || !trackableTaskIdentityOf(entry) || entry._active || timelineStartInFlight || timelineStopInFlight || timelineDeleteInFlight || sameTask(entry, pageState.active)) return false;
    if (!confirmLongEntry()) return false;
    timelineStartInFlight = true;
    refreshMountedTimeline();
    try {
    const previousDescription = activeDescriptionValue();
    const startContext = acceptTimelineStartImmediately(entry, { completePrevious: true, identity: entry.id, previousDescription });
    try {
      const result = await send({ type: 'SWITCH_TASK', timelineTask: true, taskUrl: trackableTaskIdentityOf(entry), taskTitle: taskTitleOf(entry) || '', description: previousDescription,
        sourceEntry: { id: entry.id, destinationId: entry.destinationId, entryDate: entry.entryDate } });
      rememberCompletedLocally(result?.stopped, result?.destinationId);
      if (result?.active) {
        timelineAcceptedActive = { ...result.active, _pending: Boolean(result.active._pending) };
        pageState = { ...pageState, active: timelineAcceptedActive };
        if (!refreshMountedTimeline() || (timesMode && activityViewMode === 'list')) renderUi();
      }
    } catch (error) {
      rollbackTimelineStart(startContext);
      setError(error); throw error;
    } finally {
      finishTimelineQueueAcceptance(startContext.acceptanceId);
      refreshTimelineQueueIndicator();
      if (!refreshMountedTimeline()) renderUi();
    }
    void refreshMountedTimelineState().catch(setError);
    } finally {
      timelineStartInFlight = false;
      refreshMountedTimeline();
      if (timesMode && activityViewMode === 'list') renderUi();
    }
    return true;
  }

  function renderPopupTimeline(preservedSection = null) {
    if (preservedSection) return preservedSection;
    const section = el('section', undefined, 'popup-timeline-section');
    if (!timesMode) {
      const listTotal = el('div', listWeekTotalText(), 'popup-list-total');
      listTotal.hidden = timelineViewMode !== 'list';
      section.append(weekNavigation(), listTotal);
    }
    timelineQueueIndicator = el('div', undefined, 'timeline-queue-status muted');
    timelineQueueIndicator.setAttribute('role', 'status');
    timelineQueueIndicator.setAttribute('aria-live', 'polite');
    timelineQueueIndicator.hidden = true;
    const createTimeline = globalThis.ClockoliTaskTimeline?.createTimeline;
    if (!createTimeline) {
      section.append(timelineQueueIndicator, el('div', 'Timeline component is unavailable. Reload the extension.', 'error'));
      return section;
    }
    const timelineShell = el('div', undefined, 'timeline-shell');
    const loading = el('div', undefined, 'calendar-week-loading');
    loading.setAttribute('role', 'status'); loading.setAttribute('aria-live', 'polite');
    const spinner = el('span', undefined, 'calendar-week-spinner'); spinner.setAttribute('aria-hidden', 'true');
    loading.append(spinner, el('span', 'Loading week…', 'calendar-week-loading-label'));
    loading.hidden = !(calendarWeekLoadingId !== null || selectedTimesCalendarLoadingId !== null)
      || (timesMode ? activityViewMode !== 'calendar' : timelineViewMode !== 'calendar');
    timelineShell.append(loading);
    if (!recentLoaded && !timelineAcceptedActive) {
      if (!loading.hidden) section.append(timelineShell, timelineQueueIndicator);
      else section.append(timelineQueueIndicator, el('div', 'Loading timeline…', 'muted'));
      return section;
    }
    const now = Math.min(timelineNow(), weekWindow().end - 1), periodStart = weekWindow().start;
    const focusCurrentActivityWeek = timesMode && activityViewMode === 'timeline'
      && periodStart === weekWindow(Date.now()).start
      && (!activityInitialFocusMounted || (activityInitialFocusPending && recentFresh));
    if (focusCurrentActivityWeek && !recentFresh) activityInitialFocusPending = true;
    const historyStart = activityHistoryStart(periodStart);
    timelineWindow = { historyStart, now };
    if (timesMode) activityTimelineView ||= activityPeriodTimelineView(now);
    else timelineView ||= activityPeriodTimelineView(now);
    const initialView = timesMode ? activityTimelineView : timelineView;
    const { items, rows, byId } = popupTimelineItems(historyStart, now);
    timelineEntriesById = byId;
    const host = el('div', undefined, 'task-timeline-host'); timelineShell.prepend(host);
    if (timesMode && activityInitialFocusPending) {
      const cancelInitialFocus = () => { activityInitialFocusPending = false; activityInitialFocusMounted = true; };
      host.addEventListener('wheel', cancelInitialFocus, { passive: true });
      host.addEventListener('pointerdown', cancelInitialFocus);
      host.addEventListener('keydown', cancelInitialFocus);
    }
    if (compactSurface) compactSurface.host = host;
    section.append(timelineShell, timelineQueueIndicator);
    placeCalendarWeekNavigation(section, timelineViewMode);
    globalThis.requestAnimationFrame(() => {
      if (!host.isConnected) return;
      try {
        timelineInstance = createTimeline(host, {
        items,
        rows,
        now,
        domainStart: periodStart,
        totalRange: activityTotalRange(),
        view: initialView,
        viewMode: timesMode ? (activityViewMode === 'list' ? 'timeline' : activityViewMode) : timelineGraphicViewMode,
        weeklyCalendar: true,
        activityDashboard: timesMode || popupMode || fullWidthPopupOpen,
        activityPage: timesMode || popupMode || fullWidthPopupOpen,
        toolbarPopup: popupMode,
        onCalendarNavigate: range => suppressCalendarNavigate ? undefined : loadActivityCalendarWeek(range),
        onViewModeChange: mode => {
          if (timesMode) {
            activityViewMode = mode;
            for (const control of shadow?.querySelectorAll('.times-view-button') ?? []) {
              control.setAttribute('aria-pressed', String(control.textContent.toLowerCase() === mode));
            }
          } else { timelineGraphicViewMode = mode; if (timelineViewMode !== 'list') timelineViewMode = mode; }
        },
        onViewChange: view => { if (timesMode) activityTimelineView = view; else timelineView = view; globalThis.requestAnimationFrame?.(refreshTimelineOverlaps); },
        onEditDebug: detail => recordTimelineGestureDiagnostic(detail),
        onError: (error, context) => {
          if (!host.isConnected) return;
          if (context?.action === 'edit' && showTimelineEditConflict(error)) return;
          if (!showTimelineWeekError(error)) setError(error);
        },
        onStop: item => {
          const entry = timelineEntriesById.get(item.id);
          return stopTimelineEntry(entry && !entry._active && sameTask(entry, pageState.active) ? pageState.active : entry);
        },
        onDelete: async item => {
          const entry = timelineEntriesById.get(item.id);
          if (!entry || timelineDeleteInFlight || timelineStartInFlight || timelineStopInFlight) return false;
          if (!entry._active) return queueTimelineEntryDelete(entry);
          if (!confirm('Delete this running timer without saving its tracked time?')) return false;
          timelineDeleteInFlight = true;
          const acceptanceId = beginTimelineQueueAcceptance();
          refreshTimelineQueueIndicator();
          refreshMountedTimeline();
          try {
            const result = await send({ type: 'DISCARD_ACTIVE' });
            if (result?.operationId) timelineQueuedOperationIds.set(result.operationId, entry.id);
            if (timelineAcceptedActive && sameTask(timelineAcceptedActive, entry)) timelineAcceptedActive = null;
            pageState = { ...pageState, active: null };
            refreshMountedTimeline();
            void refreshMountedTimelineState().catch(setError);
          } catch (error) { setError(error); throw error; }
          finally {
            finishTimelineQueueAcceptance(acceptanceId);
            refreshTimelineQueueIndicator();
            timelineDeleteInFlight = false;
            refreshMountedTimeline();
          }
          return true;
        },
        onStart: item => restartTimelineEntry(timelineEntriesById.get(item.id)),
        onEntryEdit: async (item, trigger) => {
          const entry = timelineEntriesById.get(item.id);
          if (!entry) return false;
          await openTimeEntryForm(entry, trigger);
          return true;
        },
        onDescriptionInput: (item, value) => {
          const entry = timelineEntriesById.get(item.id);
          if (!entry) return;
          rememberTimelineDescription(entry, value);
        },
        onDescriptionCommit: async (item, value) => {
          const entry = timelineEntriesById.get(item.id);
          if (!entry) return false;
          const description = normalizedDescription(value);
          if (description === String(entry._active ? savedActiveDescriptionValue(entry) : entry.description || '').trim()) {
            if (entry._active && description === normalizedDescription(entry.description)) retireActiveDescriptionDraft(entry, description);
            return true;
          }
          if (entry._active) await queueActiveDescriptionEdit(entry, description);
          else await queueCalendarEntry(entry, { description });
          if (normalizedDescription(timelineDescriptionDrafts.get(entry.id)) === description) timelineDescriptionDrafts.delete(entry.id);
          return true;
        },
        onEditCommit: async edit => {
          if (!timesMode && completeVisualWeekStart !== weekWindow().start) return false;
          const entry = timelineEntriesById.get(edit.id)
            || recent.find(item => !item._active && `entry:${item.id}` === edit.id);
          if (!entry) return false;
          if (entry._active) {
            if (edit.kind !== 'resize-left') return;
            try {
              await queueActiveStartEdit(entry, edit.startedAt);
            } catch (error) { setError(error); throw error; }
            return;
          }
          const edits = edit.kind === 'move'
            ? { startedAt: new Date(edit.startedAt).toISOString(), endedAt: new Date(edit.endedAt).toISOString() }
            : edit.kind === 'resize-left'
              ? { startedAt: new Date(edit.startedAt).toISOString() }
              : { endedAt: new Date(edit.endedAt).toISOString() };
          try { await queueCalendarEntry(entry, edits); }
          catch (error) { setError(error); throw error; }
        },
        });
        if ((!timesMode || focusCurrentActivityWeek) && periodStart === weekWindow(Date.now()).start) timelineInstance.scrollToEnd();
        if (focusCurrentActivityWeek && timelineInstance.getViewMode?.() === 'timeline') {
          activityInitialFocusMounted = true;
          if (recentFresh) activityInitialFocusPending = false;
        }
        if (timesMode && activityViewMode === 'calendar') {
          focusActivityCalendarPeriod();
          void loadActivityCalendarWeek(timelineInstance.getCalendarRange());
        }
      } catch (error) {
        timelineInstance = null;
        const message = error instanceof Error ? error.message : String(error || 'Invalid timeline data');
        timelineShell.replaceChildren(timelineWeekError(error)
          || el('div', `Timeline could not be displayed. ${message}`, 'error'));
        return;
      }
      refreshTimelineOverlaps();
      if (timelineScrollToRightPending) {
        timelineInstance.scrollToEnd();
        timelineScrollToRightPending = false;
      }
    });
    return section;
  }

  function renderQueueDiagnostics() {
    if (pageState.showQueueDiagnostics !== true) return null;
    if (!queueDiagnostics.length && !pageState.pendingWrites?.length) return null;
    const diagnostics = el('details', undefined, 'queue-diagnostics');
    diagnostics.open = false;
    diagnostics.setAttribute('data-testid', 'queue-diagnostics');
    diagnostics.append(el('summary', `Queue diagnostics${pageState.pendingCount ? ` (${pageState.pendingCount})` : ''}`));
    const explanation = el('div', 'Local diagnostic log. Safe operation details only.', 'muted');
    const entries = el('ol', undefined, 'queue-diagnostics-list');
    for (const event of queueDiagnostics.slice(-40).reverse()) {
      const row = el('li', undefined, 'queue-diagnostic-event');
      row.append(el('time', new Date(event.at).toLocaleTimeString(), 'queue-diagnostic-time'), document.createTextNode(event.message));
      entries.append(row);
    }
    if (!queueDiagnostics.length) entries.append(el('li', 'Waiting for the first queue update.', 'queue-diagnostic-event'));
    diagnostics.append(explanation, entries);
    return diagnostics;
  }

  function taskTrackedText() {
    if (!participantData?.complete || participantData.taskUrl !== taskUrlOf(taskFromLocation()) || !Array.isArray(participantData.participants)) return '';
    const totals = participantData.participants.map(effectiveParticipantSeconds);
    if (totals.some(value => value === null)) return '';
    return `Tracked on this issue/PR: ${formatDuration(totals.reduce((sum, value) => sum + value, 0))}${participantData.participants.some(value => value.activeStartedAt) ? ' (includes running time)' : ''}`;
  }

  function appendTrackedTotals(parent, compact = false) {
    for (const [key, label] of [['todayTrackedMs', 'Today'], ['weekTrackedMs', 'This week']]) {
      const row = el('div', undefined, 'today-total');
      const value = el('strong', trackedTotalText(key), 'today-total-value'); value.setAttribute('data-tracked-total', key);
      row.append(el('span', `${label}${compact ? ' ·' : ':'}`), value); parent.append(row);
    }
  }

  function updatePanelClocks() {
    if ((timesMode && activityViewMode === 'list') || (!timesMode && timelineViewMode === 'list')) updateListWeekTotal();
    else updateActivityWeekSummary();
    for (const scope of [shadow, fullWidthPopupShadow, timesMode ? document.getElementById?.('activity-summary') : null]) {
      for (const value of scope?.querySelectorAll?.('[data-tracked-total]') ?? []) value.textContent = trackedTotalText(value.getAttribute('data-tracked-total'));
      for (const value of scope?.querySelectorAll?.('.running-elapsed') ?? []) if (pageState.active) {
        value.textContent = value.classList?.contains?.('running-status-metric-value') || value.className?.includes?.('running-status-metric-value')
          ? formatElapsedCard(pageState.active.startedAt) : formatElapsed(pageState.active.startedAt);
      }
      for (const value of scope?.querySelectorAll?.('.task-tracked-total') ?? []) value.textContent = taskTrackedText();
    }
  }

  function startPanelClock() {
    clearInterval(tick);
    tick = setInterval(() => {
      if (!extensionContextActive) return;
      updatePanelClocks();
      if (timelineInstance && timelineWindow) {
        timelineWindow = { ...timelineWindow, now: timelineNow() };
        timelineInstance.update({ now: timelineWindow.now });
        refreshTimelineOverlaps();
      }
      if (todayReportDate && todayReportDate !== localDateValue()) {
        todayReportDate = ''; pageState = { ...pageState, todayTrackedMs: null, weekTrackedMs: null };
        void refreshState(true).catch(setError);
      }
    }, PANEL_TICK_MS);
  }

  function renderPanelFeedback(parent, { conflicts = true } = {}) {
    if (conflicts) renderPendingConflicts(parent);
    const diagnostics = renderQueueDiagnostics();
    if (diagnostics) parent.append(diagnostics);
    const failure = errorText ? { ...connectionError, message: errorText, code: errorCode } : pageState.summaryError;
    if (!failure) return;
    const description = globalThis.ClockoliRecovery.describeConnectionError(failure);
    const error = el('div', undefined, 'error');
    error.append(el('strong', description.headline), el('div', description.detail));
    const recovery = globalThis.ClockoliRecovery.actionFor(description.action === 'choose' ? 'repository_access_required' : failure.code || 'error');
    if (recovery?.label) error.append(button(recovery.label, 'secondary wide', async () => {
      if (recovery.kind === 'retry') {
        if (pageState.configured != null) { errorText = ''; errorCode = ''; connectionError = null; }
        renderUi();
        try { await refreshState(true); await refreshRecent(true); }
        catch (retryError) { setError(retryError); }
        return;
      }
      await send({ type: 'OPEN_OPTIONS' }); closeMenu();
    }));
    parent.prepend(error);
  }

  function focusPopupAction() {
    if (!popupFocusPending || popupOpening) return;
    globalThis.requestAnimationFrame?.(() => {
      const description = fullWidthPopupShadow?.querySelector?.('.active-task-strip.is-active .strip-description');
      const action = description || fullWidthPopupShadow?.querySelector?.('[data-strip-primary]');
      if (!popupFocusPending || !action || action.disabled) return;
      action.focus({ preventScroll: true }); popupFocusPending = false;
    });
  }

  function applyCompactViewMode() {
    if (!compactSurface) return;
    const list = timelineViewMode === 'list';
    placeCalendarWeekNavigation(popupMode || fullWidthPopupOpen ? compactSurface.body : compactSurface.timeline, timelineViewMode);
    updateWeekNavigationLabel();
    compactSurface.timeline.hidden = (popupMode || fullWidthPopupOpen) && list;
    const toolbar = compactSurface.body.querySelector('.popup-list-toolbar');
    if (toolbar) toolbar.hidden = !list;
    const shell = compactSurface.timeline.querySelector('.timeline-shell');
    if (shell) shell.hidden = list;
    const total = compactSurface.timeline.querySelector('.popup-list-total');
    if (total) { total.hidden = popupMode || fullWidthPopupOpen || !list; total.textContent = listWeekTotalText(); }
    compactSurface.overlaps.hidden = list;
    compactSurface.today.hidden = !list;
    for (const control of (fullWidthPopupShadow || shadow)?.querySelectorAll?.('[data-timeline-view-mode]') ?? []) {
      control.setAttribute('aria-pressed', String(control.getAttribute('data-timeline-view-mode') === timelineViewMode));
    }
  }

  function setTimelineViewMode(mode) {
    if (!['timeline', 'calendar', 'list'].includes(mode)) return;
    const switched = timelineViewMode !== mode;
    timelineViewMode = mode;
    saveActivityViewMode(mode);
    if (switched) resetWeekForViewSwitch();
    if (mode !== 'list') {
      timelineGraphicViewMode = mode;
      timelineInstance?.setViewMode(mode);
    }
    applyCompactViewMode();
    if (switched) void loadActivityCalendarWeek(weekWindow()).catch(setError);
  }

  function refreshCompactSurface() {
    if (!compactSurface) return;
    const { strip, switchAction, today, feedback } = compactSurface;
    const activeElement = fullWidthPopupShadow?.activeElement || shadow?.activeElement;
    const actionKey = activeElement?.getAttribute?.('data-panel-action');
    const scroll = fullWidthPopupShadow?.querySelector?.('.full-width-popup');
    const scrollTop = scroll?.scrollTop;
    const diagnosticsOpen = feedback.querySelector?.('details')?.open;
    const active = pageState.active, current = taskFromLocation();
    strip.classList.toggle('is-active', Boolean(active));
    const activeIdentity = active ? String(active.id || active.startedAt) : '';
    const preserveActiveDescription = Boolean(active && (strip.contains(activeElement)
      || strip.getAttribute('data-moving-focus-to-stop') !== null)
      && strip.getAttribute('data-active-id') === activeIdentity && strip.getAttribute('data-active-url') === taskUrlOf(active));
    if (!preserveActiveDescription) {
      strip.replaceChildren();
      strip.setAttribute('data-active-id', activeIdentity); strip.setAttribute('data-active-url', active ? taskUrlOf(active) : '');
    }
    if (active && !preserveActiveDescription) {
      const copy = el('div', undefined, 'strip-task-copy');
      copy.append(taskResult(active, 'strip-task'));
      const description = el('textarea');
      description.rows = 1;
      description.className = 'strip-description';
      description.maxLength = 2000;
      description.placeholder = 'Description (optional)';
      description.value = activeDescriptionValue(active);
      const descriptionMore = el('span', '↓ More lines — scroll', 'description-overflow-hint'); descriptionMore.hidden = true;
      const resizeDescription = () => fitDescriptionTextarea(description, { maxHeight: 180, more: descriptionMore });
      resizeDescription();
      const descriptionField = el('div', undefined, 'save-field strip-description-field');
      const savedIndicator = el('span', '✓ Saved', 'description-saved');
      savedIndicator.setAttribute('role', 'status');
      savedIndicator.hidden = true;
      let savingDescription = null, saveAgain = false, submittedDescription = null, hideSavedTimer = null;
      const showSaved = () => {
        clearTimeout(hideSavedTimer);
        savedIndicator.hidden = false;
        hideSavedTimer = setTimeout(() => { savedIndicator.hidden = true; }, 3000);
      };
      const currentActive = () => active.id
        ? (pageState.active?.id === active.id ? pageState.active : null)
        : (pageState.active?.startedAt === active.startedAt ? pageState.active : null);
      const saveActiveDescription = () => {
        if (savingDescription) {
          if (normalizedDescription(description.value) !== submittedDescription) saveAgain = true;
          return savingDescription;
        }
        savingDescription = (async () => {
          do {
            saveAgain = false;
            const current = currentActive();
            if (!current) return; // The timer was stopped or switched while this field was focused.
            const value = normalizedDescription(description.value);
            submittedDescription = value;
            if (value === normalizedDescription(savedActiveDescriptionValue(current))) {
              if (value === normalizedDescription(current.description)) retireActiveDescriptionDraft(current, value);
            } else {
              await queueActiveDescriptionEdit(current, value);
            }
            if (!saveAgain && normalizedDescription(description.value) === value) showSaved();
          } while (saveAgain);
        })().finally(() => {
          savingDescription = null;
          submittedDescription = null;
          updateDescriptionSave();
        });
        return savingDescription;
      };
      const saveDescription = saveCheckButton('Save description', saveActiveDescription);
      const updateDescriptionSave = () => { saveDescription.hidden = normalizedDescription(description.value) === normalizedDescription(savedActiveDescriptionValue(currentActive() ?? active)); };
      updateDescriptionSave();
      description.addEventListener('input', () => {
        descriptionDraft = { id: active.id || active.startedAt, taskUrl: taskUrlOf(active), value: description.value };
        resizeDescription();
        savedIndicator.hidden = true;
        updateDescriptionSave();
      });
      description.addEventListener('keydown', event => {
        if (event.key === 'Tab' && !event.shiftKey && event.isTrusted && !event.isComposing && event.keyCode !== 229 && !stop.disabled) {
          event.preventDefault();
          // Blur may trigger an immediate timeline render before focus reaches Stop.
          strip.setAttribute('data-moving-focus-to-stop', '');
          try { stop.focus({ preventScroll: true }); }
          finally { strip.removeAttribute('data-moving-focus-to-stop'); }
          return;
        }
        if (event.key !== 'Enter' || event.shiftKey || !event.isTrusted || event.isComposing || event.keyCode === 229) return;
        event.preventDefault();
        return saveActiveDescription().catch(setError);
      });
      description.addEventListener('blur', () => saveActiveDescription().catch(setError));
      descriptionField.append(description, saveDescription, savedIndicator, descriptionMore);
      const elapsed = el('span', undefined, 'running-status-elapsed');
      elapsed.setAttribute('role', 'timer'); elapsed.setAttribute('aria-label', 'Elapsed time');
      elapsed.append(el('span', 'Duration', 'running-status-metric-label'),
        el('span', formatElapsedCard(active.startedAt), 'running-status-metric-value running-elapsed'));
      const startField = el('div', undefined, 'running-status-start-field');
      const startLabel = el('label', undefined, 'running-status-start-label');
      startLabel.append(el('span', 'Started', 'running-status-start-caption'));
      const startValue = el('span', undefined, 'running-status-start-value');
      const start = el('input', undefined, 'running-status-start');
      start.type = 'text'; start.inputMode = 'numeric'; start.maxLength = 5;
      start.autocomplete = 'off'; start.setAttribute('aria-label', 'Started');
      start.title = 'Edit started time; press Enter to save';
      start.value = new Date(active.startedAt).toTimeString().slice(0, 5);
      let displayedStartAt = active.startedAt;
      startValue.append(start); startLabel.append(startValue);
      const saveStart = el('button', '✓', 'running-status-start-save');
      saveStart.type = 'button'; saveStart.title = 'Save start'; saveStart.setAttribute('aria-label', 'Save start');
      saveStart.hidden = true;
      const startSaved = el('span', '✓ Saved', 'running-status-start-saved');
      startSaved.setAttribute('role', 'status'); startSaved.hidden = true;
      startField.append(startLabel, saveStart, startSaved);
      const updateStartDraft = async () => {
        const { parseTime, timeValue } = await import(chrome.runtime.getURL('src/ui/local-time.js'));
        const current = currentActive();
        if (!start.isConnected || !current) return;
        saveStart.hidden = parseTime(start.value) === timeValue(new Date(current.startedAt));
      };
      start.addEventListener('click', () => start.select());
      start.addEventListener('input', () => { startSaved.hidden = true; void updateStartDraft().catch(setError); });
      start.addEventListener('blur', async () => {
        const { parseTime } = await import(chrome.runtime.getURL('src/ui/local-time.js'));
        const normalized = parseTime(start.value);
        if (start.isConnected && normalized) start.value = normalized;
        await updateStartDraft();
      });
      let savingStart = false;
      const commitStart = async () => {
        const current = currentActive();
        if (savingStart || !current) return;
        const { parseTime, timeValue, localTimestamp } = await import(chrome.runtime.getURL('src/ui/local-time.js'));
        if (!start.isConnected) return;
        const clock = parseTime(start.value);
        const timestamp = clock && localTimestamp(localDateValue(new Date(current.startedAt)), clock);
        if (!timestamp) { setError(new Error('Enter a valid Started time (HH:MM or 1000).')); return; }
        if (clock === timeValue(new Date(current.startedAt)) && current.startedAt === displayedStartAt) return;
        if (timestamp.getTime() > Date.now()) { setError(new Error('Started time cannot be in the future.')); return; }
        savingStart = true; start.disabled = true;
        try {
          const latest = await send({ type: 'GET_PAGE_STATE', refresh: true });
          if (!start.isConnected || !currentActive()) return;
          if (!latest.active || latest.active.id !== current.id || taskUrlOf(latest.active) !== taskUrlOf(current)
            || latest.active.startedAt !== displayedStartAt || currentActive().startedAt !== displayedStartAt) {
            applyPageState(latest);
            setError(new Error('Start changed elsewhere. Reopen the panel before editing it.'));
            return;
          }
          await queueActiveStartEdit(current, timestamp);
          if (!currentActive() || !start.isConnected) return;
          const confirmed = await send({ type: 'GET_PAGE_STATE', refresh: true });
          if (!start.isConnected || !currentActive()) return;
          if (!confirmed.active || confirmed.active.id !== current.id || confirmed.active.startedAt !== timestamp.toISOString()
            || (pageState.active.startedAt !== displayedStartAt && pageState.active.startedAt !== timestamp.toISOString())) {
            applyPageState(confirmed);
            setError(new Error('Start changed elsewhere. Reopen the panel before editing it.'));
            return;
          }
          applyPageState(confirmed);
          active.startedAt = timestamp.toISOString();
          displayedStartAt = timestamp.toISOString();
          start.value = clock; saveStart.hidden = true; startSaved.hidden = false;
          setTimeout(() => { if (startSaved.isConnected) startSaved.hidden = true; }, 3000);
        } catch (error) { setError(error); }
        finally { savingStart = false; start.disabled = false; }
      };
      start.addEventListener('keydown', event => {
        if (event.key === 'Tab' && !event.shiftKey && event.isTrusted && !event.isComposing && event.keyCode !== 229 && !stop.disabled) {
          event.preventDefault();
          strip.setAttribute('data-moving-focus-to-stop', '');
          try { stop.focus({ preventScroll: true }); }
          finally { strip.removeAttribute('data-moving-focus-to-stop'); }
          return;
        }
        if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229) return;
        event.preventDefault(); void commitStart();
      });
      saveStart.addEventListener('click', () => void commitStart());
      const stop = button('Stop and save', 'danger', async () => {
        const current = pageState.active;
        if (!current) return;
        const hasDraft = descriptionDraft?.id === (current?.id || current?.startedAt)
          && descriptionDraft.taskUrl === taskUrlOf(current);
        try { await stopTimelineEntry({ ...current, description: description.value }, { preserveSavedDescription: !hasDraft }); } catch {}
      });
      stop.setAttribute('data-strip-primary', 'true'); stop.setAttribute('data-panel-action', 'stop');
      stop.disabled = timelineStartInFlight || timelineStopInFlight || timelineDeleteInFlight || Boolean(pageState.pendingWrites?.some(item => item.status === 'conflict'));
      const { metrics } = globalThis.ClockoliTrackingCard.createTrackingCard(document, { root: strip, task: copy, description: descriptionField, elapsed, today: null, stop });
      const stats = el('div', undefined, 'running-status-stats'); stats.append(startField, metrics);
      strip.insertBefore(stats, stop);
    }
    if (!preserveActiveDescription && (!active || (current && !sameTask(current, active)))) {
      const track = button('Track this task', 'primary popup-timeline-track', async () => {
        if (timelineTrackActionDisabled()) return;
        try { await trackCurrentTimelineTask({ preserveSavedDescription: true }); } catch {}
      });
      if (active) track.textContent = 'Switch to this task';
      else track.setAttribute('data-strip-primary', 'true');
      track.setAttribute('data-testid', 'popup-timeline-track'); track.setAttribute('data-panel-action', 'track');
      track.disabled = timelineTrackActionDisabled();
      switchAction.replaceChildren(track);
      if (!active) {
        const quickStart = el('div', undefined, 'running-status-quick-start');
        quickStart.append(el('span', 'Quick start from recent tasks:', 'running-status-quick-label'));
        const choices = el('div', undefined, 'running-status-recent');
        const seen = new Set();
        for (const entry of [...quickStartRecent].sort((left, right) =>
          Date.parse(right.endedAt || right.startedAt) - Date.parse(left.endedAt || left.startedAt))) {
          const identity = trackableTaskIdentityOf(entry);
          if (!identity || seen.has(identity)) continue;
          seen.add(identity);
          const label = taskTitleOf(entry) || identity;
          const choice = button('', 'running-status-recent-task', async () => {
            try { await restartTimelineEntry(entry); } catch {}
          });
          choice.title = identity; choice.setAttribute('aria-label', `Start tracking ${label}`);
          choice.disabled = timelineStartInFlight || timelineStopInFlight || timelineDeleteInFlight
            || sameTask(entry, pageState.active) || Boolean(pageState.pendingWrites?.some(item => item.status === 'conflict'));
          const play = el('span', undefined, 'running-status-recent-play'); play.setAttribute('aria-hidden', 'true');
          choice.append(play, el('span', label, 'running-status-recent-name'));
          choices.append(choice);
          if (seen.size === 3) break;
        }
        if (!seen.size) choices.append(el('span', 'No recent tasks yet', 'running-status-recent-empty'));
        quickStart.append(choices);
        const idle = el('div', undefined, 'strip-idle-status');
        idle.append(el('span', 'Not tracking', 'strip-idle'), el('span', 'Start a task to begin', 'strip-idle-caption'));
        strip.append(idle, quickStart);
      }
    } else if (!preserveActiveDescription) {
      switchAction.replaceChildren();
    }
    if (preserveActiveDescription) {
      const elapsed = strip.querySelector('.running-elapsed'); if (elapsed) elapsed.textContent = formatElapsedCard(active.startedAt);
      const stop = strip.querySelector('[data-panel-action="stop"]');
      if (stop) stop.disabled = timelineStartInFlight || timelineStopInFlight || timelineDeleteInFlight || Boolean(pageState.pendingWrites?.some(item => item.status === 'conflict'));
      const track = switchAction.querySelector('[data-panel-action="track"]'); if (track) track.disabled = timelineTrackActionDisabled();
    }
    // Queue reconciliation may refresh the panel while an unsaved List editor is
    // focused. Keep that input mounted; the next normal render can show updates.
    const preserveTodayEditor = today.contains?.(activeElement) && activeElement?.matches?.('input,textarea');
    if (!preserveTodayEditor) {
    today.replaceChildren();
    const { startDate, endDate } = timesRange();
    const entries = mergeTimelineCompletedEntries(recent, timelineOptimisticCompletions.values()).map(entry => ({ ...entry, ...timelineOptimisticEdits.get(entry.id) }))
      .filter(entry => entry.endedAt && ((activityRecordDate(entry) >= startDate && activityRecordDate(entry) <= endDate)
        || overlapsSelectedWeek(entry)))
      .sort((left, right) => new Date(right.startedAt) - new Date(left.startedAt));
    compactSurface.listEntries = entries;
    if (compactSurface.renderList) compactSurface.renderList(entries);
    else renderRecent(today, entries, null, true);
    }
    feedback.replaceChildren(); renderPanelFeedback(feedback);
    const diagnostics = feedback.querySelector?.('details'); if (diagnostics && diagnosticsOpen) diagnostics.open = true;
    refreshTimelineQueueIndicator(); refreshTimelineOverlaps(); applyCompactViewMode();
    if (actionKey) {
      const replacement = [...strip.querySelectorAll?.('[data-panel-action]') ?? [], ...switchAction.querySelectorAll?.('[data-panel-action]') ?? [], ...today.querySelectorAll?.('[data-panel-action]') ?? []]
        .find(node => node.getAttribute('data-panel-action') === actionKey);
      replacement?.focus?.({ preventScroll: true });
    }
    if (scroll && scrollTop !== undefined) scroll.scrollTop = scrollTop;
    focusPopupAction();
  }

  function refreshTimelineOverlaps() {
    if (!compactSurface) return;
    const { host, overlaps } = compactSurface;
    const blocks = host?.querySelectorAll?.('[data-overlap="true"]') ?? [];
    const entries = [...blocks].map(block => timelineEntriesById.get(block.getAttribute('data-item-id'))).filter(Boolean);
    overlaps.replaceChildren();
    if (!entries.length) return;
    const warning = el('div', undefined, 'overlap-warning');
    warning.append(el('span', `Overlapping entries: ${entries.map(entry => `${taskTitleOf(entry) || storedTaskIdentityOf(entry)} (${wallTime(timestampParts(entry.startedAt, entry.timezone))}–${entry._active ? 'now' : wallTime(timestampParts(entry.endedAt, entry.timezone))})`).join('; ')}. `));
    const link = el('a', 'Fix in Activity'); link.href = extensionResourceUrl('src/times/times.html');
    link.addEventListener('click', event => { if (!event.isTrusted) return; event.preventDefault(); void send({ type: 'OPEN_TIMES' }).catch(setError); });
    warning.append(link); overlaps.append(warning);
  }

  function renderMenu({ compact = popupMode, onClose = null } = {}) {
    const menu = el('section', undefined, 'menu'); menu.setAttribute('role', 'dialog'); menu.setAttribute('aria-label', 'Time tracker panel. Scroll for more content.'); menu.tabIndex = 0;
    const updateScrollState = event => {
      if (event?.isTrusted) menuScrollTop = menu.scrollTop;
      menu.classList.toggle('has-more', menu.scrollHeight > menu.clientHeight + menu.scrollTop + 1);
    };
    menu.addEventListener('scroll', updateScrollState, { passive: true });
    globalThis.requestAnimationFrame?.(updateScrollState);
    const header = el('header', undefined, 'tracker-toolbar');
    const headerActions = el('div', undefined, 'header-actions');
    const timelineToolbarEnd = el('div', undefined, 'timeline-toolbar-end');
    const pageNavigation = el('nav', undefined, 'header-navigation');
    pageNavigation.setAttribute('aria-label', 'Clockoli pages');
    const brand = el('div', undefined, 'timeline-brand'); brand.append(clockoliWordmark());
    const tasks = button('Top tasks', 'reports-button', async () => { await send({ type: 'OPEN_TASKS' }); closeMenu(); }); tasks.title = 'Open top tasks'; tasks.prepend(icon('checklist', TASKS_PATH));
    const reports = button('Reports', 'reports-button', async () => { await send({ type: 'OPEN_REPORTS' }); closeMenu(); }); reports.title = 'Open reports'; reports.prepend(icon('graph', REPORTS_PATH));
    const activity = button('Activity', 'reports-button', async () => { await send({ type: 'OPEN_TIMES' }); closeMenu(); }); activity.title = 'Open activity'; activity.prepend(icon('history', ACTIVITY_PATH));
    const settings = button('Settings', 'reports-button settings-button', async () => { await send({ type: 'OPEN_OPTIONS' }); closeMenu(); }); settings.title = 'Open settings'; settings.prepend(icon('gear', GEAR_PATH));
    pageNavigation.append(tasks, reports, ...(compact ? [activity] : []), settings);
    headerActions.append(pageNavigation);
    if (compact) {
      if (onClose) {
        const close = button('×', 'icon-button popup-timeline-close', onClose);
        close.title = 'Close Clockoli'; close.setAttribute('aria-label', 'Close Clockoli');
        timelineToolbarEnd.append(close);
        header.append(brand, headerActions, timelineToolbarEnd);
      } else header.append(brand, headerActions, timelineToolbarEnd);
      menu.append(header);
    } else {
      header.append(headerActions); menu.append(header);
    }
    const body = el('div', undefined, 'menu-body');
    if (pageState.configured == null) {
      if (!errorText) body.append(el('p', 'Loading…', 'muted'));
    } else if (!pageState.configured) {
      body.append(el('p', 'Choose where Clockoli should save your time before tracking.', 'muted'));
      body.append(button('Set up Clockoli', 'primary wide', async () => { await send({ type: 'OPEN_OPTIONS' }); closeMenu(); }));
    } else {
      if (compact) {
        const strip = el('div', undefined, 'active-task-strip'), today = el('section', undefined, 'today-list activity-list');
        const feedback = el('div', undefined, 'panel-feedback'), overlaps = el('div', undefined, 'timeline-overlaps');
        const switchAction = el('div', undefined, 'popup-switch-action');
        const overview = el('div', undefined, 'popup-overview-layout');
        const summary = createWeeklySummary();
        overview.append(summary, strip);
        compactSurface = { strip, summary, switchAction, today, feedback, overlaps, timeline: null, body, host: null };
        const listToolbar = el('section', undefined, 'popup-list-toolbar');
        const filterLabel = el('label', undefined, 'times-filter'), filter = el('input');
        filter.type = 'search'; filter.placeholder = popupMode ? 'Search entries' : 'Search this week';
        filter.setAttribute('aria-label', popupMode ? 'Search activity' : 'Search current week');
        filter.value = popupMode ? timesFilter : panelListFilter;
        filterLabel.append(icon('search', 'M7 1a6 6 0 1 0 3.708 10.72l3.286 3.286a.75.75 0 0 0 1.06-1.06l-3.286-3.286A6 6 0 0 0 7 1Zm-4.5 6a4.5 4.5 0 1 1 9 0 4.5 4.5 0 0 1-9 0Z', 18), filter);
        listToolbar.append(filterLabel);
        const refresh = recentRefreshButton(); refresh.classList.add('times-refresh');
        listToolbar.append(refresh);
        if (popupMode) compactSurface.renderList = createActivityListRenderer(today, filter);
        else {
          compactSurface.renderList = (entries = compactSurface.listEntries || []) => {
            today.replaceChildren();
            const query = panelListFilter.trim().toLowerCase();
            const matches = query ? entries.filter(entry => (storedTaskIdentityOf(entry) || '').toLowerCase().includes(query)
              || taskTitleOf(entry).toLowerCase().includes(query)) : entries;
            const empty = query && !matches.length ? el('p', 'No entries match this week.', 'muted') : null;
            renderRecent(today, matches, empty, true, true);
          };
          filter.addEventListener('input', () => { panelListFilter = filter.value; compactSurface.renderList(); });
        }
        const timeline = renderPopupTimeline();
        compactSurface.timeline = timeline;
        const modeButton = (mode, label) => {
          const control = button(label, 'timeline-view-button', () => setTimelineViewMode(mode));
          control.setAttribute('aria-label', label); control.title = label;
          const shapes = {
            timeline: 'M1 12h14v1.5H1V12Zm2-3h2v2H3V9Zm3-4h2v6H6V5Zm3 2h2v4H9V7Zm3-5h2v9h-2V2Z',
            calendar: 'M4 0a.75.75 0 0 1 .75.75V2h6V.75a.75.75 0 0 1 1.5 0V2h1A2.75 2.75 0 0 1 16 4.75v8.5A2.75 2.75 0 0 1 13.25 16H2.75A2.75 2.75 0 0 1 0 13.25v-8.5A2.75 2.75 0 0 1 2.75 2h1V.75A.75.75 0 0 1 4 0ZM1.5 6.5v6.75c0 .69.56 1.25 1.25 1.25h10.5c.69 0 1.25-.56 1.25-1.25V6.5h-13ZM3 9h3v1.5H3V9Zm5 0h3v1.5H8V9Z',
            list: 'M1 2h2v2H1V2Zm4 0h10v2H5V2ZM1 7h2v2H1V7Zm4 0h10v2H5V7Zm-4 5h2v2H1v-2Zm4 0h10v2H5v-2Z',
          };
          control.replaceChildren(icon(mode, shapes[mode], 18));
          control.setAttribute('data-timeline-view-mode', mode);
          control.setAttribute('aria-pressed', String(timelineViewMode === mode));
          return control;
        };
        const viewModes = el('div', undefined, 'timeline-view-modes');
        viewModes.setAttribute('role', 'group');
        viewModes.setAttribute('aria-label', 'Timeline view');
        viewModes.append(modeButton('timeline', 'Timeline'), modeButton('calendar', 'Calendar'), modeButton('list', 'List'));
        timelineToolbarEnd.prepend(viewModes);
        const closeButton = timelineToolbarEnd.querySelector('.popup-timeline-close');
        if (closeButton) timelineToolbarEnd.insertBefore(switchAction, closeButton);
        else timelineToolbarEnd.append(switchAction);
        body.append(overview);
        body.append(listToolbar);
        body.append(timeline, overlaps, today, feedback);
        refreshCompactSurface();
      }
      const current = taskFromLocation();
      if (pageState.active) {
        if (!compact) {
        const active = pageState.active, same = current && sameTask(active, current);
        const tracking = el('div', undefined, `eyebrow tracking-status${same ? '' : ' tracking-another'}`);
        tracking.append(document.createTextNode('Tracking '), el('strong', same ? 'this' : 'another'), document.createTextNode(' task'));
        body.append(tracking);
        body.append(taskResult(active, 'active-task-result'));
        body.append(el('div', formatElapsed(active.startedAt), 'elapsed running-elapsed'));
        const label = el('label', 'Description'), description = el('textarea');
        description.rows = 2; description.maxLength = 2000; description.placeholder = 'Optional'; description.value = activeDescriptionValue(active);
        const descriptionMore = el('span', '↓ More lines — scroll', 'description-overflow-hint'); descriptionMore.hidden = true;
        const resizeDescription = () => fitDescriptionTextarea(description, { minRows: 2, more: descriptionMore });
        resizeDescription();
        const saved = el('span', '✓ Saved', 'description-saved dialog-description-saved'); saved.setAttribute('role', 'status'); saved.hidden = true;
        label.append(description, saved, descriptionMore); body.append(label);
        let savingDescription = null, saveAgain = false, submittedDescription = null;
        const saveDescription = () => {
          if (savingDescription) {
            if (normalizedDescription(description.value) !== submittedDescription) saveAgain = true;
            return savingDescription;
          }
          savingDescription = (async () => {
            do {
              saveAgain = false;
              const current = pageState.active;
              if (!current || (active.id ? current.id !== active.id : current.startedAt !== active.startedAt)) return;
              const value = normalizedDescription(description.value);
              submittedDescription = value;
              if (value !== normalizedDescription(savedActiveDescriptionValue(current))) {
                await queueActiveDescriptionEdit(current, value);
              } else if (value === normalizedDescription(current.description)) {
                retireActiveDescriptionDraft(current, value);
              }
              if (!saveAgain && normalizedDescription(description.value) === value) saved.hidden = false;
            } while (saveAgain);
          })().catch(setError).finally(() => { savingDescription = null; submittedDescription = null; });
          return savingDescription;
        };
        description.addEventListener('input', () => {
          descriptionDraft = { id: active.id || active.startedAt, taskUrl: taskUrlOf(active), value: description.value };
          resizeDescription();
          saved.hidden = true;
        });
        description.addEventListener('keydown', event => {
          if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229 || !event.isTrusted) return;
          event.preventDefault();
          void saveDescription();
        });
        const switchToCurrent = Boolean(!same && current);
        const makeStop = switchToCurrent => {
        const stop = button(switchToCurrent ? 'Save and switch to this task' : 'Stop and save', switchToCurrent ? 'primary wide' : 'danger wide', async (event, node) => {
          if (timelineStartInFlight || timelineDeleteInFlight || !beginTimelineStop()) return;
          try {
            if (!confirmLongEntry(active)) return;
            node.disabled = true;
            const actionRoute = popupMode ? null : `${location.protocol}//${location.hostname}${location.pathname}`;
            const recentWasFresh = !switchToCurrent && recentFresh;
            const result = await send(switchToCurrent
              ? { type: 'SWITCH_TASK', taskUrl: current.taskUrl, taskTitle: current.taskTitle || '', description: description.value }
              : { type: 'STOP', description: description.value });
            if (timelineAcceptedActive && sameTask(timelineAcceptedActive, active)) timelineAcceptedActive = null;
            if (actionRoute && actionRoute !== `${location.protocol}//${location.hostname}${location.pathname}`) return;
            if (!switchToCurrent) {
              if (recentWasFresh && result?.entry?.id) recentFreshAfterPendingId = result.entry.id;
              recentLoadId += 1; recentLoad = null; loadingRecent = false;
            }
            recentLoaded = false; await refreshState(false, false);
          } catch (error) { node.disabled = false; setError(error); }
          finally { finishTimelineStop(); }
        });
        stop.disabled = timelineStartInFlight || timelineStopInFlight || timelineDeleteInFlight
          || pageState.pendingWrites?.some(item => item.status === 'conflict'); body.append(stop);
        };
        makeStop(false);
        if (switchToCurrent) makeStop(true);
        }
      } else if (!compact) {
        const startButton = button(current ? 'Start tracking this task' : 'Open an HTTP(S) page to start tracking', 'primary wide', async (event, node) => {
          if (timelineStartInFlight || timelineStopInFlight || timelineDeleteInFlight) return;
          timelineStartInFlight = true;
          node.disabled = true;
          refreshMountedTimeline();
          try {
            const activatedTask = popupMode ? await refreshPopupTask() : taskFromLocation();
            if (!activatedTask) throw new Error('Open an HTTP(S) page to start tracking.');
            const startContext = acceptTimelineStartImmediately(activatedTask, { identity: 'current-task' });
            let active;
            try {
              active = await send({ type: 'START', taskUrl: activatedTask.taskUrl, taskTitle: activatedTask.taskTitle || '' });
            } catch (error) {
              rollbackTimelineStart(startContext);
              throw error;
            } finally {
              finishTimelineQueueAcceptance(startContext.acceptanceId);
              refreshTimelineQueueIndicator();
            }
            if (active?.id) {
              timelineAcceptedActive = { ...active, _pending: Boolean(active._pending) };
              pageState = { ...pageState, active: timelineAcceptedActive };
              if (!refreshMountedTimeline()) renderUi();
            }
            await refreshState(false, false);
          } catch (error) { node.disabled = false; setError(error); }
          finally {
            timelineStartInFlight = false;
            refreshMountedTimeline();
          }
        });
        startButton.disabled = !current || timelineStopInFlight || timelineDeleteInFlight
          || pageState.pendingWrites?.some(item => item.status === 'conflict');
        body.append(startButton);
        if (!current) body.append(el('div', 'Clockoli tracks any HTTP(S) task URL; a title is optional.', 'muted'));
      }
      if (!compact) {
      renderPendingConflicts(body);
      appendTrackedTotals(body);
      const taskTotal = el('div', taskTrackedText(), 'task-tracked-total muted'); body.append(taskTotal);
      renderRecent(body);
      const more = el('div', undefined, 'more-times'); more.append(button('View activity', 'secondary', async () => { await send({ type: 'OPEN_TIMES' }); closeMenu(); })); body.append(more);
      }
    }
    if (!compact || !pageState.configured) renderPanelFeedback(body, { conflicts: false });
    menu.append(body); startPanelClock(); return menu;
  }


  function restoreMenuScroll(scrollTop) {
    const menu = shadow?.querySelector('.menu');
    if (!menu || !Number.isFinite(scrollTop)) return;
    menu.scrollTop = scrollTop;
    globalThis.requestAnimationFrame?.(() => { if (menu.isConnected) menu.scrollTop = scrollTop; });
  }

  function mountFullWidthPopup() {
    if (fullWidthPopupRoot?.isConnected) return;
    fullWidthPopupRoot = el('div'); fullWidthPopupRoot.id = 'clockoli-full-width-popup-root';
    fullWidthPopupRoot.className = 'full-width-popup-surface';
    fullWidthPopupRoot.setAttribute('data-clockoli-width', pageState.interfaceWidth === 'full' ? 'full' : 'contained');
    isolateShadowHost(fullWidthPopupRoot, { fullWidth: true });
    fullWidthPopupShadow = fullWidthPopupRoot.attachShadow({ mode: 'closed' });
    globalThis.ClockoliInstantTooltips?.attach(fullWidthPopupShadow);
    (document.body || document.documentElement).append(fullWidthPopupRoot);
  }

  function closeFullWidthPopup({ restoreFocus = true } = {}) {
    fullWidthPopupOpen = false;
    compactSurface = null; popupFocusPending = false;
    clearInterval(tick); tick = null;
    clearInterval(timelineWindowTimer); timelineWindowTimer = null;
    timelineInstance?.destroy(); timelineInstance = null; timelineWindow = null; timelineEntriesById = new Map(); timelineQueueIndicator = null;
    timelineView = null;
    fullWidthPopupRoot?.remove(); fullWidthPopupRoot = null; fullWidthPopupShadow = null;
    renderUi();
    const target = popupReturnFocus?.isConnected ? popupReturnFocus : shadow?.querySelector?.('.trigger-main');
    if (restoreFocus) target?.focus?.({ preventScroll: true });
    popupReturnFocus = null;
  }

  function renderFullWidthPopup(style) {
    if (!fullWidthPopupOpen || !fullWidthPopupShadow || !fullWidthPopupRoot?.isConnected) return;
    const focused = fullWidthPopupShadow.activeElement;
    const restoreDescriptionFocus = focused?.classList?.contains('strip-description');
    const restoreStopFocus = focused?.getAttribute?.('data-panel-action') === 'stop';
    compactSurface = null;
    timelineInstance?.destroy(); timelineInstance = null; timelineWindow = null; timelineEntriesById = new Map(); timelineQueueIndicator = null;
    const surface = el('section', undefined, 'full-width-popup');
    surface.append(renderMenu({ compact: true, onClose: closeFullWidthPopup }));
    fullWidthPopupShadow.replaceChildren(style.cloneNode(true), surface);
    updateActivityWeekSummary();
    if (restoreDescriptionFocus) fullWidthPopupShadow.querySelector('.strip-description')?.focus({ preventScroll: true });
    else if (restoreStopFocus) fullWidthPopupShadow.querySelector('[data-panel-action="stop"]')?.focus({ preventScroll: true });
    focusPopupAction();
  }

  async function toggleFullWidthPopup() {
    fullWidthPopupOpen = !fullWidthPopupOpen;
    if (!fullWidthPopupOpen) { closeFullWidthPopup(); return false; }
    popupReturnFocus = shadow?.activeElement || document.activeElement; popupFocusPending = true;
    popupOpening = true;
    mountFullWidthPopup(); renderUi();
    clearInterval(timelineWindowTimer);
    timelineWindowTimer = setInterval(() => { if (fullWidthPopupOpen) renderUi(); }, 60_000);
    timelineWindowTimer?.unref?.();
    try {
      applyPageState(await send({ type: 'GET_PAGE_STATE', refresh: false }));
      if (!fullWidthPopupOpen) return false;
      renderUi();
      const refreshedState = send({ type: 'GET_PAGE_STATE', refresh: true });
      const restoredMode = restoreActivityViewMode();
      applyPageState(await refreshedState);
      await restoredMode;
      if (!fullWidthPopupOpen) return false;
      if (pageState.configured) {
        if (timelineViewMode === 'calendar') await loadActivityCalendarWeek(weekWindow(), { showLoading: false });
        else {
          await refreshRecent(true);
          if (fullWidthPopupOpen) await loadActivityCalendarWeek(weekWindow());
        }
      }
      else renderUi();
    } catch (error) { setError(error); }
    finally { popupOpening = false; focusPopupAction(); }
    return true;
  }

  function renderUi() {
    if ((!shadow || !root?.isConnected) && (!fullWidthPopupShadow || !fullWidthPopupRoot?.isConnected)) return;
    if (descriptionDraft && (!pageState.active || descriptionDraft.id !== (pageState.active.id || pageState.active.startedAt)
        || descriptionDraft.taskUrl !== taskUrlOf(pageState.active))) descriptionDraft = null;
    updateTaskAnimation();
    const preservedMenuScrollTop = menuScrollTop;
    const preserveFullWidthTimeline = Boolean(fullWidthPopupOpen && pageState.configured && timelineInstance && timelineWindow);
    const preservedActivityTimeline = timesMode && pageState.configured && timelineInstance && timelineWindow
      ? shadow?.querySelector('.popup-timeline-section') : null;
    const preservedActivityCalendarScroll = preservedActivityTimeline && timelineInstance.captureCalendarScroll?.();
    preservedActivityTimeline?.remove();
    clearInterval(tick); tick = null;
    if (!preserveFullWidthTimeline && !preservedActivityTimeline) {
      timelineInstance?.destroy(); timelineInstance = null; timelineWindow = null; timelineEntriesById = new Map(); timelineQueueIndicator = null;
    }
    if (shadow && root?.isConnected) shadow.replaceChildren();
    if (timesMode) {
      document.getElementById?.('activity-summary')?.replaceChildren();
      document.getElementById?.('activity-view-switcher')?.replaceChildren();
    }
    const style = el('style', `
      :host, :where(:host > :not(style)) {
        /* One side gutter for every full-width panel row, so they stay aligned as the viewport grows. */
        --clockoli-gutter: clamp(16px, 2.5vw, 32px);
        --ck-fg: var(--fgColor-default,#1f2328);
        --ck-border: var(--borderColor-default,#d1d9e0);
        --ck-button-default-bg-rest: var(--button-default-bgColor-rest,#f6f8fa);
        --ck-fg-muted: var(--fgColor-muted,#59636e);
        --ck-button-default-bg-hover: var(--button-default-bgColor-hover,#eff2f5);
        --ck-button-default-bg-active: var(--button-default-bgColor-active,#e6eaef);
        --ck-button-default-bg-selected: var(--button-default-bgColor-selected,#e6eaef);
        --ck-focus: var(--focus-outlineColor,#0969da);
        --ck-bg: var(--bgColor-default,#fff);
        --ck-shadow: var(--shadow-floating-small,0 0 0 1px #d1d9e040,0 6px 12px -3px #25292e0a,0 6px 18px 0 #25292e1f);
        --ck-border-muted: var(--borderColor-muted,#d1d9e0b3);
        --ck-control-border-rest: var(--control-borderColor-rest,#d1d9e0);
        --ck-control-bg-rest: var(--control-bgColor-rest,#f6f8fa);
        --ck-control-fg-rest: var(--control-fgColor-rest,#25292e);
        --ck-bg-muted: var(--bgColor-muted,#f6f8fa);
        --ck-bg-attention: var(--bgColor-attention-muted,#fff8c5);
        --ck-accent: var(--fgColor-accent,#0969da);
        --ck-success: var(--fgColor-success,#1f883d);
        --ck-button-default-border-rest: var(--button-default-borderColor-rest,#d1d9e0);
        --ck-button-default-fg-rest: var(--button-default-fgColor-rest,#25292e);
        --ck-button-default-border-disabled: var(--button-default-borderColor-disabled,#818b981a);
        --ck-button-default-bg-disabled: var(--button-default-bgColor-disabled,#eff2f5);
        --ck-button-default-fg-disabled: var(--button-default-fgColor-disabled,#818b98);
        --ck-button-primary-border-rest: var(--button-primary-borderColor-rest,#1f232826);
        --ck-button-primary-bg-rest: var(--button-primary-bgColor-rest,#1f883d);
        --ck-button-primary-fg-rest: var(--button-primary-fgColor-rest,#fff);
        --ck-button-primary-bg-hover: var(--button-primary-bgColor-hover,#1c8139);
        --ck-button-primary-bg-active: var(--button-primary-bgColor-active,#197935);
        --ck-button-primary-border-disabled: var(--button-primary-borderColor-disabled,#95d8a6);
        --ck-button-primary-bg-disabled: var(--button-primary-bgColor-disabled,#95d8a6);
        --ck-button-primary-fg-disabled: var(--button-primary-fgColor-disabled,#fffc);
        --ck-button-danger-border-rest: var(--button-danger-borderColor-rest,#d1d9e0);
        --ck-button-danger-bg-rest: var(--button-danger-bgColor-rest,#f6f8fa);
        --ck-button-danger-fg-rest: var(--button-danger-fgColor-rest,#d1242f);
        --ck-button-danger-border-hover: var(--button-danger-borderColor-hover,#1f232826);
        --ck-button-danger-bg-hover: var(--button-danger-bgColor-hover,#cf222e);
        --ck-button-danger-fg-hover: var(--button-danger-fgColor-hover,#fff);
        --ck-button-danger-border-active: var(--button-danger-borderColor-active,#1f232826);
        --ck-button-danger-bg-active: var(--button-danger-bgColor-active,#a40e26);
        --ck-button-danger-fg-active: var(--button-danger-fgColor-active,#fff);
        --ck-button-danger-bg-disabled: var(--button-danger-bgColor-disabled,#eff2f5);
        --ck-button-danger-fg-disabled: var(--button-danger-fgColor-disabled,#d1242f80);
        --ck-button-invisible-border-rest: var(--button-invisible-borderColor-rest,#fff0);
        --ck-button-invisible-bg-rest: var(--button-invisible-bgColor-rest,#fff0);
        --ck-button-invisible-icon-rest: var(--button-invisible-iconColor-rest,#59636e);
        --ck-button-invisible-border-hover: var(--button-invisible-borderColor-hover,#fff0);
        --ck-button-invisible-bg-hover: var(--button-invisible-bgColor-hover,#818b981a);
        --ck-button-invisible-icon-hover: var(--button-invisible-iconColor-hover,#59636e);
        --ck-button-invisible-bg-active: var(--button-invisible-bgColor-active,#818b9826);
        --ck-button-invisible-border-disabled: var(--button-invisible-borderColor-disabled,#fff0);
        --ck-button-invisible-bg-disabled: var(--button-invisible-bgColor-disabled,#fff0);
        --ck-button-invisible-fg-disabled: var(--button-invisible-fgColor-disabled,#818b98);
        --ck-border-danger: var(--borderColor-danger-muted,#ff818266);
        --ck-bg-danger: var(--bgColor-danger-muted,#ffebe9);
        --ck-danger: var(--fgColor-danger,#d1242f);
        --ck-bg-editable: var(--bgColor-default,#fff0);
        --ck-control-fg-placeholder: var(--control-fgColor-placeholder,#59636e);
        --ck-control-bg-hover: var(--control-bgColor-hover,#eff2f5);
        --ck-control-bg-active: var(--control-bgColor-active,#e6eaef);
        --ck-control-border-disabled: var(--control-borderColor-disabled,#818b981a);
        --ck-control-bg-disabled: var(--control-bgColor-disabled,#eff2f5);
        --ck-control-fg-disabled: var(--control-fgColor-disabled,#818b98);
        --ck-shadow-overlay: var(--shadow-floating-small,0 12px 30px #1f23284d);
        --ck-transparent: var(--button-invisible-bgColor-rest,#fff0);
        /* Shadow DOM blocks selectors, but inherited custom properties still cross
           the host boundary. Pin every Primer-compatible style value locally so a site
           such as vc.ru cannot restyle Clockoli. */
        --fgColor-default:#1f2328; --fgColor-muted:#59636e; --fgColor-accent:#0969da; --fgColor-danger:#d1242f;
        --bgColor-default:#fff; --bgColor-muted:#f6f8fa; --bgColor-inset:#f6f8fa; --bgColor-attention-muted:#fff8c5; --bgColor-danger-muted:#ffebe9;
        --borderColor-default:#d1d9e0; --borderColor-muted:#d1d9e0b3; --borderColor-danger-muted:#ff818266; --focus-outlineColor:#0969da;
        --button-default-borderColor-rest:#d1d9e0; --button-default-bgColor-rest:#f6f8fa; --button-default-fgColor-rest:#25292e;
        --button-default-bgColor-hover:#eff2f5; --button-default-bgColor-active:#e6eaef; --button-default-bgColor-selected:#e6eaef;
        --button-default-borderColor-disabled:#818b981a; --button-default-bgColor-disabled:#eff2f5; --button-default-fgColor-disabled:#818b98;
        --button-primary-borderColor-rest:#1f232826; --button-primary-bgColor-rest:#1f883d; --button-primary-fgColor-rest:#fff;
        --button-primary-bgColor-hover:#1c8139; --button-primary-bgColor-active:#197935; --button-primary-borderColor-disabled:#95d8a6; --button-primary-bgColor-disabled:#95d8a6; --button-primary-fgColor-disabled:#fffc;
        --button-danger-borderColor-rest:#d1d9e0; --button-danger-bgColor-rest:#f6f8fa; --button-danger-fgColor-rest:#d1242f;
        --button-danger-borderColor-hover:#1f232826; --button-danger-bgColor-hover:#cf222e; --button-danger-fgColor-hover:#fff;
        --button-danger-borderColor-active:#1f232826; --button-danger-bgColor-active:#a40e26; --button-danger-fgColor-active:#fff; --button-danger-bgColor-disabled:#eff2f5; --button-danger-fgColor-disabled:#d1242f80;
        --button-invisible-borderColor-rest:#fff0; --button-invisible-bgColor-rest:#fff0; --button-invisible-iconColor-rest:#59636e; --button-invisible-fgColor-rest:#25292e;
        --button-invisible-borderColor-hover:#fff0; --button-invisible-bgColor-hover:#818b981a; --button-invisible-iconColor-hover:#59636e; --button-invisible-bgColor-active:#818b9826;
        --button-invisible-borderColor-disabled:#fff0; --button-invisible-bgColor-disabled:#fff0; --button-invisible-fgColor-disabled:#818b98;
        --control-borderColor-rest:#d1d9e0; --control-bgColor-rest:#f6f8fa; --control-fgColor-rest:#25292e; --control-fgColor-placeholder:#59636e;
        --control-bgColor-hover:#eff2f5; --control-bgColor-active:#e6eaef; --control-borderColor-disabled:#818b981a; --control-bgColor-disabled:#eff2f5; --control-fgColor-disabled:#818b98;
        --shadow-floating-small:0 0 0 1px #d1d9e040,0 6px 12px -3px #25292e0a,0 6px 18px 0 #25292e1f;
        --fontStack-sansSerif:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;
        --fontStack-monospace:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;
        --text-body-shorthand-medium:400 14px/1.5 var(--fontStack-sansSerif);
        --text-caption-shorthand:400 12px/1.25 var(--fontStack-sansSerif);
      }
      @media (prefers-color-scheme: dark) {
        :host, :where(:host > :not(style)) {
          --ck-fg: var(--fgColor-default,#f0f6fc);
          --ck-border: var(--borderColor-default,#3d444d);
          --ck-button-default-bg-rest: var(--button-default-bgColor-rest,#212830);
          --ck-fg-muted: var(--fgColor-muted,#9198a1);
          --ck-button-default-bg-hover: var(--button-default-bgColor-hover,#262c36);
          --ck-button-default-bg-active: var(--button-default-bgColor-active,#2a313c);
          --ck-button-default-bg-selected: var(--button-default-bgColor-selected,#2a313c);
          --ck-focus: var(--focus-outlineColor,#1f6feb);
          --ck-bg: var(--bgColor-default,#0d1117);
          --ck-shadow: var(--shadow-floating-small,0 0 0 1px #3d444d,0 6px 12px -3px #01040966,0 6px 18px 0 #01040966);
          --ck-border-muted: var(--borderColor-muted,#3d444db3);
          --ck-control-border-rest: var(--control-borderColor-rest,#3d444d);
          --ck-control-bg-rest: var(--control-bgColor-rest,#212830);
          --ck-control-fg-rest: var(--control-fgColor-rest,#f0f6fc);
          --ck-bg-muted: var(--bgColor-muted,#151b23);
          --ck-bg-attention: var(--bgColor-attention-muted,#bb800926);
          --ck-accent: var(--fgColor-accent,#4493f8);
          --ck-success: var(--fgColor-success,#3fb950);
          --ck-button-default-border-rest: var(--button-default-borderColor-rest,#3d444d);
          --ck-button-default-fg-rest: var(--button-default-fgColor-rest,#f0f6fc);
          --ck-button-default-border-disabled: var(--button-default-borderColor-disabled,#656c761a);
          --ck-button-default-bg-disabled: var(--button-default-bgColor-disabled,#212830);
          --ck-button-default-fg-disabled: var(--button-default-fgColor-disabled,#656c76);
          --ck-button-primary-border-rest: var(--button-primary-borderColor-rest,#ffffff26);
          --ck-button-primary-bg-rest: var(--button-primary-bgColor-rest,#238636);
          --ck-button-primary-fg-rest: var(--button-primary-fgColor-rest,#fff);
          --ck-button-primary-bg-hover: var(--button-primary-bgColor-hover,#29903b);
          --ck-button-primary-bg-active: var(--button-primary-bgColor-active,#2e9a40);
          --ck-button-primary-border-disabled: var(--button-primary-borderColor-disabled,#105823);
          --ck-button-primary-bg-disabled: var(--button-primary-bgColor-disabled,#105823);
          --ck-button-primary-fg-disabled: var(--button-primary-fgColor-disabled,#fff6);
          --ck-button-danger-border-rest: var(--button-danger-borderColor-rest,#3d444d);
          --ck-button-danger-bg-rest: var(--button-danger-bgColor-rest,#212830);
          --ck-button-danger-fg-rest: var(--button-danger-fgColor-rest,#fa5e55);
          --ck-button-danger-border-hover: var(--button-danger-borderColor-hover,#ffffff26);
          --ck-button-danger-bg-hover: var(--button-danger-bgColor-hover,#b62324);
          --ck-button-danger-fg-hover: var(--button-danger-fgColor-hover,#fff);
          --ck-button-danger-border-active: var(--button-danger-borderColor-active,#ffffff26);
          --ck-button-danger-bg-active: var(--button-danger-bgColor-active,#da3633);
          --ck-button-danger-fg-active: var(--button-danger-fgColor-active,#fff);
          --ck-button-danger-bg-disabled: var(--button-danger-bgColor-disabled,#212830);
          --ck-button-danger-fg-disabled: var(--button-danger-fgColor-disabled,#f8514980);
          --ck-button-invisible-border-rest: var(--button-invisible-borderColor-rest,#0000);
          --ck-button-invisible-bg-rest: var(--button-invisible-bgColor-rest,#0000);
          --ck-button-invisible-icon-rest: var(--button-invisible-iconColor-rest,#9198a1);
          --ck-button-invisible-border-hover: var(--button-invisible-borderColor-hover,#0000);
          --ck-button-invisible-bg-hover: var(--button-invisible-bgColor-hover,#656c7633);
          --ck-button-invisible-icon-hover: var(--button-invisible-iconColor-hover,#9198a1);
          --ck-button-invisible-bg-active: var(--button-invisible-bgColor-active,#656c7640);
          --ck-button-invisible-border-disabled: var(--button-invisible-borderColor-disabled,#0000);
          --ck-button-invisible-bg-disabled: var(--button-invisible-bgColor-disabled,#0000);
          --ck-button-invisible-fg-disabled: var(--button-invisible-fgColor-disabled,#656c76);
          --ck-border-danger: var(--borderColor-danger-muted,#f8514966);
          --ck-bg-danger: var(--bgColor-danger-muted,#f851491a);
          --ck-danger: var(--fgColor-danger,#f85149);
          --ck-bg-editable: var(--bgColor-default,#0000);
          --ck-control-fg-placeholder: var(--control-fgColor-placeholder,#9198a1);
          --ck-control-bg-hover: var(--control-bgColor-hover,#262c36);
          --ck-control-bg-active: var(--control-bgColor-active,#2a313c);
          --ck-control-border-disabled: var(--control-borderColor-disabled,#656c761a);
          --ck-control-bg-disabled: var(--control-bgColor-disabled,#212830);
          --ck-control-fg-disabled: var(--control-fgColor-disabled,#656c76);
          --ck-shadow-overlay: var(--shadow-floating-small,0 0 0 1px #3d444d,0 6px 12px -3px #01040966,0 6px 18px 0 #01040966);
          --ck-transparent: var(--button-invisible-bgColor-rest,#0000);
          --fgColor-default:#f0f6fc; --fgColor-muted:#9198a1; --fgColor-accent:#4493f8; --fgColor-danger:#f85149;
          --bgColor-default:#0d1117; --bgColor-muted:#151b23; --bgColor-inset:#010409; --bgColor-attention-muted:#bb800926; --bgColor-danger-muted:#f851491a;
          --borderColor-default:#3d444d; --borderColor-muted:#3d444db3; --borderColor-danger-muted:#f8514966; --focus-outlineColor:#1f6feb;
          --button-default-borderColor-rest:#3d444d; --button-default-bgColor-rest:#212830; --button-default-fgColor-rest:#f0f6fc;
          --button-default-bgColor-hover:#262c36; --button-default-bgColor-active:#2a313c; --button-default-bgColor-selected:#2a313c;
          --button-default-borderColor-disabled:#656c761a; --button-default-bgColor-disabled:#212830; --button-default-fgColor-disabled:#656c76;
          --button-primary-borderColor-rest:#ffffff26; --button-primary-bgColor-rest:#238636; --button-primary-fgColor-rest:#fff;
          --button-primary-bgColor-hover:#29903b; --button-primary-bgColor-active:#2e9a40; --button-primary-borderColor-disabled:#105823; --button-primary-bgColor-disabled:#105823; --button-primary-fgColor-disabled:#fff6;
          --button-danger-borderColor-rest:#3d444d; --button-danger-bgColor-rest:#212830; --button-danger-fgColor-rest:#fa5e55;
          --button-danger-borderColor-hover:#ffffff26; --button-danger-bgColor-hover:#b62324; --button-danger-fgColor-hover:#fff;
          --button-danger-borderColor-active:#ffffff26; --button-danger-bgColor-active:#da3633; --button-danger-fgColor-active:#fff; --button-danger-bgColor-disabled:#212830; --button-danger-fgColor-disabled:#f8514980;
          --button-invisible-borderColor-rest:#0000; --button-invisible-bgColor-rest:#0000; --button-invisible-iconColor-rest:#9198a1; --button-invisible-fgColor-rest:#f0f6fc;
          --button-invisible-borderColor-hover:#0000; --button-invisible-bgColor-hover:#656c7633; --button-invisible-iconColor-hover:#9198a1; --button-invisible-bgColor-active:#656c7640;
          --button-invisible-borderColor-disabled:#0000; --button-invisible-bgColor-disabled:#0000; --button-invisible-fgColor-disabled:#656c76;
          --control-borderColor-rest:#3d444d; --control-bgColor-rest:#212830; --control-fgColor-rest:#f0f6fc; --control-fgColor-placeholder:#9198a1;
          --control-bgColor-hover:#262c36; --control-bgColor-active:#2a313c; --control-borderColor-disabled:#656c761a; --control-bgColor-disabled:#212830; --control-fgColor-disabled:#656c76;
          --shadow-floating-small:0 0 0 1px #3d444d,0 6px 12px -3px #01040966,0 6px 18px 0 #01040966;
        }
        :host(.full-width-popup-surface) .clockoli-wordmark { filter:saturate(1.4) brightness(2.1) }
      }
      :host { all:initial; position:relative; display:inline-flex; align-items:center; color:var(--fgColor-default,var(--ck-fg)); color-scheme:light dark; font:var(--text-body-shorthand-medium,400 14px/1.5 "Mona Sans VF",-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans Backtick Fix","Noto Sans",Helvetica,Arial,sans-serif,"Apple Color Emoji","Segoe UI Emoji") }
      :where(:host > :not(style)) { all:revert; color:var(--fgColor-default,var(--ck-fg)); color-scheme:light dark; font:var(--text-body-shorthand-medium,400 14px/1.5 "Mona Sans VF",-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans Backtick Fix","Noto Sans",Helvetica,Arial,sans-serif,"Apple Color Emoji","Segoe UI Emoji") }
      * { box-sizing:border-box } button,input,textarea,select { font:inherit } .trigger { display:inline-flex; align-items:center; justify-content:center; gap:3px; width:46px; height:32px; margin:0 8px 0 0; padding:0 6px; border:1px solid var(--borderColor-default,var(--ck-border)); border-radius:6px; background:var(--button-default-bgColor-rest,var(--ck-button-default-bg-rest)); color:var(--fgColor-muted,var(--ck-fg-muted)); cursor:pointer }
      .trigger:hover { background:var(--button-default-bgColor-hover,var(--ck-button-default-bg-hover)) } .trigger:active:not(:disabled) { background:var(--button-default-bgColor-active,var(--ck-button-default-bg-active)) } .trigger[aria-expanded="true"] { background:var(--button-default-bgColor-selected,var(--ck-button-default-bg-selected)) } .clockoli-mark { display:block; width:22px; height:22px; flex:none; transform-origin:center } @media(prefers-reduced-motion: no-preference) { .trigger.running-current .clockoli-mark { animation:clockoli-task-spin 1s linear infinite } } @keyframes clockoli-task-spin { to { transform:rotate(360deg) } } .trigger:focus-visible,button:focus-visible,a:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible,.time-value:focus-visible,.time-date:focus-visible { outline:2px solid var(--focus-outlineColor,var(--ck-focus)); outline-offset:2px }
      .menu { position:absolute; z-index:2147483647; top:calc(100% + 8px); right:-24px; width:min(420px,calc(100vw - 24px)); max-height:calc(100vh - 76px); overflow-y:scroll; overflow-x:hidden; scrollbar-gutter:stable; overscroll-behavior:contain; border:1px solid var(--borderColor-default,var(--ck-border)); border-radius:12px; background:var(--bgColor-default,var(--ck-bg)); color:var(--fgColor-default,var(--ck-fg)); box-shadow:var(--shadow-floating-small,var(--ck-shadow)) } .menu.has-more { box-shadow:inset 0 -18px 14px -18px var(--fgColor-muted,var(--ck-fg-muted)),var(--shadow-floating-small,var(--ck-shadow)) } :host(.popup-surface) { display:block; width:100%; min-width:0; min-height:220px } :host(.popup-surface) .menu { position:relative; inset:auto; width:100%; max-height:600px; border-radius:0 } :host(.times-surface) { display:block; width:100%; min-width:0 } :host(.times-surface) .times-page { width:min(920px,calc(100% - 32px)); min-height:calc(100vh - 48px); margin:0 auto; background:var(--bgColor-default,var(--ck-bg)); border-inline:1px solid var(--borderColor-muted,var(--ck-border-muted)) } .times-header h1 { margin:2px 0 0; font-size:24px; line-height:1.2 } .times-body { padding:20px 24px 40px } .times-toolbar { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:end; gap:12px; margin-bottom:16px } .times-toolbar label { margin:0 } .times-toolbar select { width:100%; min-height:34px; margin-top:4px; padding:7px 32px 7px 8px; border:1px solid var(--control-borderColor-rest,var(--ck-control-border-rest)); border-radius:6px; background-color:var(--control-bgColor-rest,var(--ck-control-bg-rest)); color:var(--control-fgColor-rest,var(--ck-control-fg-rest)); appearance:none; background-image:linear-gradient(45deg,transparent 50%,var(--fgColor-muted,var(--ck-fg-muted)) 50%),linear-gradient(135deg,var(--fgColor-muted,var(--ck-fg-muted)) 50%,transparent 50%); background-position:right 17px center,right 12px center; background-size:5px 5px; background-repeat:no-repeat } .times-filter { grid-column:auto } .times-custom { display:grid; grid-column:1/-1; grid-template-columns:1fr 1fr auto; align-items:end; gap:12px } .times-apply { align-self:end; min-height:34px } .times-results { min-height:120px } .bulk-time { margin-top:24px; padding:14px; border:1px solid var(--borderColor-muted,var(--ck-border-muted)); border-radius:8px; background:var(--bgColor-muted,var(--ck-bg-muted)) } .bulk-time summary { font-weight:650; cursor:pointer } .bulk-time-input { min-height:160px; resize:vertical } .bulk-time-input::placeholder { color:var(--fgColor-muted,var(--ck-fg-muted)); opacity:.42 } .more-times { display:flex; justify-content:center; padding:12px 0 2px }
      header,.header-actions,.section-head,.entry-row,.form-actions,.today-total { display:flex; align-items:center; justify-content:space-between; gap:12px } header { padding:12px 16px; border-bottom:1px solid var(--borderColor-muted,var(--ck-border-muted)) } .menu-body { padding:14px 16px } .muted { color:var(--fgColor-muted,var(--ck-fg-muted)); font:var(--text-caption-shorthand,400 12px/1.25 "Mona Sans VF",-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans Backtick Fix","Noto Sans",Helvetica,Arial,sans-serif,"Apple Color Emoji","Segoe UI Emoji"); margin-top:3px } .eyebrow { color:var(--fgColor-muted,var(--ck-fg-muted)); font:600 12px/1.5 var(--fontStack-sansSerif,"Mona Sans VF",-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans Backtick Fix","Noto Sans",Helvetica,Arial,sans-serif,"Apple Color Emoji","Segoe UI Emoji"); letter-spacing:normal; margin-bottom:5px } .tracking-status strong { font-weight:900 } .tracking-another strong { display:inline-block; padding:1px 5px; border-radius:999px; background:var(--bgColor-attention-muted,var(--ck-bg-attention)); color:var(--fgColor-muted,var(--ck-fg-muted)) }
      a { color:var(--fgColor-accent,var(--ck-accent)); font-weight:600; text-decoration:none } a:hover { text-decoration:underline } .task-result { min-width:0 } .task-url { display:block; overflow:hidden; color:var(--fgColor-muted,var(--ck-fg-muted)); font-size:12px; font-weight:400; line-height:1.35; text-overflow:ellipsis; white-space:nowrap } .task-title { display:-webkit-box; overflow:hidden; margin-top:2px; color:var(--fgColor-accent,var(--ck-accent)); font-size:16px; font-weight:600; line-height:1.35; overflow-wrap:anywhere; -webkit-box-orient:vertical; -webkit-line-clamp:2 } .task-result-untitled .task-url { overflow:hidden; color:var(--fgColor-accent,var(--ck-accent)); font-size:16px; font-weight:600; text-overflow:ellipsis; white-space:nowrap } .active-task-result { margin-bottom:2px } .elapsed { margin:8px 0 10px; font:600 2rem/1.5 var(--fontStack-monospace,ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace) }
      button { border:1px solid var(--button-default-borderColor-rest,var(--ck-button-default-border-rest)); border-radius:6px; padding:7px 12px; background:var(--button-default-bgColor-rest,var(--ck-button-default-bg-rest)); color:var(--button-default-fgColor-rest,var(--ck-button-default-fg-rest)); font-weight:600; cursor:pointer } button:hover { background:var(--button-default-bgColor-hover,var(--ck-button-default-bg-hover)) } button:active:not(:disabled) { background:var(--button-default-bgColor-active,var(--ck-button-default-bg-active)) } button:disabled { border-color:var(--button-default-borderColor-disabled,var(--ck-button-default-border-disabled)); background:var(--button-default-bgColor-disabled,var(--ck-button-default-bg-disabled)); color:var(--button-default-fgColor-disabled,var(--ck-button-default-fg-disabled)); cursor:default } .wide { width:100%; margin-top:10px } .primary { border-color:var(--button-primary-borderColor-rest,var(--ck-button-primary-border-rest)); background:var(--button-primary-bgColor-rest,var(--ck-button-primary-bg-rest)); color:var(--button-primary-fgColor-rest,var(--ck-button-primary-fg-rest)) } .primary:hover { background:var(--button-primary-bgColor-hover,var(--ck-button-primary-bg-hover)) } .primary:active:not(:disabled) { background:var(--button-primary-bgColor-active,var(--ck-button-primary-bg-active)) } .primary:disabled { border-color:var(--button-primary-borderColor-disabled,var(--ck-button-primary-border-disabled)); background:var(--button-primary-bgColor-disabled,var(--ck-button-primary-bg-disabled)); color:var(--button-primary-fgColor-disabled,var(--ck-button-primary-fg-disabled)) } .danger,.danger-outline { border-color:var(--button-danger-borderColor-rest,var(--ck-button-danger-border-rest)); background:var(--button-danger-bgColor-rest,var(--ck-button-danger-bg-rest)); color:var(--button-danger-fgColor-rest,var(--ck-button-danger-fg-rest)) } .danger:hover,.danger-outline:hover { border-color:var(--button-danger-borderColor-hover,var(--ck-button-danger-border-hover)); background:var(--button-danger-bgColor-hover,var(--ck-button-danger-bg-hover)); color:var(--button-danger-fgColor-hover,var(--ck-button-danger-fg-hover)) } .danger:active:not(:disabled),.danger-outline:active:not(:disabled) { border-color:var(--button-danger-borderColor-active,var(--ck-button-danger-border-active)); background:var(--button-danger-bgColor-active,var(--ck-button-danger-bg-active)); color:var(--button-danger-fgColor-active,var(--ck-button-danger-fg-active)) } .danger:disabled,.danger-outline:disabled { border-color:var(--button-danger-borderColor-rest,var(--ck-button-danger-border-rest)); background:var(--button-danger-bgColor-disabled,var(--ck-button-danger-bg-disabled)); color:var(--button-danger-fgColor-disabled,var(--ck-button-danger-fg-disabled)) }
      .tracker-toolbar { justify-content:flex-end } .header-actions { justify-content:flex-end; gap:4px } .header-navigation { display:flex; align-items:center; gap:4px } .reports-button { display:inline-flex; align-items:center; gap:6px; padding:5px 7px }
      .save-field { position:relative; display:block; width:100% } .save-field input,.save-field textarea { padding-right:34px }
      .description-saved { color:var(--ck-success); font:700 11px/1.4 var(--fontStack-sansSerif); white-space:nowrap }
      .description-saved[hidden] { display:none }
      .description-overflow-hint { display:block; margin-top:3px; color:var(--fgColor-muted,var(--ck-fg-muted)); font-size:11px; font-weight:500 }
      .description-overflow-hint[hidden] { display:none }
      .strip-description-field .description-saved { position:absolute; right:38px; top:50%; transform:translateY(-50%); padding:2px 4px; background:var(--bgColor-default,var(--ck-bg)); border-radius:3px }
      .dialog-description-saved { display:inline-block; margin:4px 0 0 6px }
      .entry-description-saved { display:inline-block; margin:4px 0 0 27px }
      .save-check { position:absolute; z-index:1; top:50%; right:4px; display:inline-flex; align-items:center; justify-content:center; width:26px; height:26px; margin:0; padding:0; transform:translateY(-50%); border:0; border-radius:5px; background:transparent; color:var(--ck-success); font:800 18px/1 var(--fontStack-sansSerif); cursor:pointer }
      .save-check:hover:not(:disabled) { border:0; background:color-mix(in srgb,var(--ck-success) 12%,transparent); color:var(--ck-success) } .save-check:disabled { border:0; background:transparent; color:color-mix(in srgb,var(--ck-success) 50%,transparent) } .save-check[hidden] { display:none } .reports-button,.icon-button,.link-button,.navigation-item { border:1px solid var(--button-invisible-borderColor-rest,var(--ck-button-invisible-border-rest)); background:var(--button-invisible-bgColor-rest,var(--ck-button-invisible-bg-rest)) } .reports-button,.icon-button { color:var(--button-invisible-iconColor-rest,var(--ck-button-invisible-icon-rest)) } .reports-button:hover,.icon-button:hover,.link-button:hover,.navigation-item:hover { border-color:var(--button-invisible-borderColor-hover,var(--ck-button-invisible-border-hover)); background:var(--button-invisible-bgColor-hover,var(--ck-button-invisible-bg-hover)) } .reports-button:hover,.icon-button:hover { color:var(--button-invisible-iconColor-hover,var(--ck-button-invisible-icon-hover)) } .reports-button:active:not(:disabled),.icon-button:active:not(:disabled),.link-button:active:not(:disabled),.navigation-item:active:not(:disabled) { background:var(--button-invisible-bgColor-active,var(--ck-button-invisible-bg-active)) } .reports-button:disabled,.icon-button:disabled,.link-button:disabled,.navigation-item:disabled { border-color:var(--button-invisible-borderColor-disabled,var(--ck-button-invisible-border-disabled)); background:var(--button-invisible-bgColor-disabled,var(--ck-button-invisible-bg-disabled)); color:var(--button-invisible-fgColor-disabled,var(--ck-button-invisible-fg-disabled)) } @media(prefers-reduced-motion: no-preference) { .icon-button.syncing svg { animation:clockoli-sync-spin .8s linear infinite; transform-origin:center } } @keyframes clockoli-sync-spin { to { transform:rotate(360deg) } } .today-total { margin-top:14px; padding:10px 12px; border:1px solid var(--borderColor-muted,var(--ck-border-muted)); border-radius:8px; background:var(--bgColor-muted,var(--ck-bg-muted)) }
      .timeline-queue-status { margin:0 0 8px; font-size:12px; font-weight:600 }
      .timeline-queue-status[hidden] { display:none } .today-total-value { font-size:16px } .icon-button,.link-button { padding:5px } .link-button { color:var(--fgColor-accent,var(--ck-accent)) } .section-head { margin-bottom:7px }
      .time-range-editor { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:12px } .time-picker { min-width:0; margin:0; padding:10px; border:1px solid var(--borderColor-muted,var(--ck-border-muted)); border-radius:10px; background:var(--bgColor-muted,var(--ck-bg-muted)) } .time-picker legend { padding:0 5px; color:var(--fgColor-muted,var(--ck-fg-muted)); font-weight:700 } .time-date { margin:0 0 8px; padding:5px 6px; background:var(--bgColor-default,var(--ck-bg)); font-size:12px } .time-picker-values { display:flex; align-items:center; justify-content:center; gap:6px } .time-value { width:62px; height:48px; margin:0; padding:4px; border-color:var(--control-borderColor-rest,var(--ck-control-border-rest)); background:var(--bgColor-default,var(--ck-bg)); font:700 26px/1 var(--fontStack-monospace,ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace); text-align:center; font-variant-numeric:tabular-nums } .time-colon { font:700 24px/1 var(--fontStack-monospace,ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace) }
      .trigger-main { width:34px; margin-right:8px }
      .entry-date-header { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:8px } .entry-date-header h2 { margin:0; font-size:14px; font-weight:650 } .entry-day-total,.inline-unsaved { color:var(--ck-fg-muted); font-size:12px; white-space:nowrap } .entry-record-task-identity { display:flex; align-items:flex-start; gap:10px; min-width:0 } .entry-record-task-result { flex:1; min-width:0 } .entry-record-favicon { margin-top:2px }
      .entry { padding:8px 0 } .entry + .entry { margin-top:6px } .entry-record-task-result { margin-bottom:7px } .entry-record { padding:10px 12px; border:1px solid var(--borderColor-default,var(--ck-border)); border-radius:8px; background:var(--bgColor-muted,var(--ck-bg-muted)) } .entry-record + .entry-record { margin-top:8px } .entry-record.entry-overlap { padding:10px 12px; border-color:var(--borderColor-danger-muted,var(--ck-border-danger)); background:var(--bgColor-danger-muted,var(--ck-bg-danger)) } .overlap-warning { margin-bottom:5px; color:var(--fgColor-danger,var(--ck-danger)); font-size:12px; font-weight:700 } .entry-day { margin-bottom:2px; color:var(--fgColor-muted,var(--ck-fg-muted)); font-size:13px; font-weight:650; white-space:nowrap } .entry-time-row { display:flex; flex-wrap:wrap; align-items:center; justify-content:flex-start; gap:8px; min-width:0; white-space:nowrap } .entry-time-range,.inline-time-range { flex:0 0 auto } .inline-time-line { display:flex; flex-wrap:nowrap; align-items:center; justify-content:flex-start; gap:4px; min-width:0; white-space:nowrap } .compact-time-picker { display:inline-flex; align-items:center; min-width:0; margin:0; padding:0; border:0; background:var(--button-invisible-bgColor-rest,var(--ck-transparent)) } .compact-time-picker legend { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap } .compact-time-picker .time-date { display:none } .compact-time-picker .time-picker-values { display:inline-flex; justify-content:flex-start; gap:2px; white-space:nowrap } .compact-time-picker .time-value { width:34px; height:32px; margin:0; padding:2px; border-radius:5px; font-size:17px } .compact-time-picker .time-colon { font-size:17px } .inline-time-separator { color:var(--fgColor-muted,var(--ck-fg-muted)); font-weight:650 } .entry-time-range { color:var(--fgColor-default,var(--ck-fg)); font:600 13px/1.5 var(--fontStack-monospace,ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace); font-variant-numeric:tabular-nums } .inline-duration { flex:0 1 auto; min-width:0; overflow:hidden; color:var(--fgColor-muted,var(--ck-fg-muted)); font-size:13px; font-weight:650; text-overflow:ellipsis; white-space:nowrap } .entry-description { margin-top:4px; color:var(--fgColor-muted,var(--ck-fg-muted)); overflow-wrap:anywhere } .entry-description-editable { display:block; width:100%; padding:5px 7px; border:1px dashed var(--borderColor-default,var(--ck-border)); background:var(--bgColor-default,var(--ck-bg-editable)); color:var(--fgColor-muted,var(--ck-fg-muted)); font-size:inherit; font-weight:400; line-height:inherit; text-align:left } .entry-description-editable:hover { border-style:solid; background:var(--button-invisible-bgColor-hover,var(--ck-button-invisible-bg-hover)); color:var(--fgColor-default,var(--ck-fg)) } .inline-metadata-editor { margin:6px 0 2px; padding:9px; border:1px solid var(--borderColor-muted,var(--ck-border-muted)); border-radius:7px; background:var(--bgColor-muted,var(--ck-bg-muted)) } .inline-metadata-editor label { margin:6px 0 0 } .inline-metadata-editor label:first-child { margin-top:0 } .inline-metadata-editor input,.inline-metadata-editor textarea { font-size:14px } .inline-metadata-editor textarea { width:100%; min-height:54px; max-height:200px; resize:vertical; padding-right:34px; overflow-y:auto; white-space:pre-wrap } .entry-actions { display:flex; flex:0 0 auto; align-items:center; gap:4px; opacity:0; pointer-events:none } .entry-actions.dirty { opacity:1; pointer-events:auto } .entry-actions.dirty .entry-edit,.entry-actions.dirty .entry-delete { display:none } .entry-actions button { padding:3px 5px; font-size:12px } .entry-record:hover .entry-actions,.entry-record:focus-within .entry-actions,.entry-actions-visible { opacity:1; pointer-events:auto }
 .queue-diagnostics { margin-top:18px; padding:10px 12px; border:1px solid var(--borderColor-muted,var(--ck-border-muted)); border-radius:8px; background:var(--bgColor-muted,var(--ck-bg-muted)) } .queue-diagnostics summary { cursor:pointer; color:var(--fgColor-default,var(--ck-fg)); font-weight:700 } .queue-diagnostics-list { max-height:220px; margin:8px 0 0; padding:0 0 0 20px; overflow:auto; font:12px/1.45 var(--fontStack-monospace,ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace) } .queue-diagnostic-event { overflow-wrap:anywhere } .queue-diagnostic-event + .queue-diagnostic-event { margin-top:5px } .queue-diagnostic-time { margin-right:7px; color:var(--fgColor-muted,var(--ck-fg-muted)); font-variant-numeric:tabular-nums }
 label { display:block; margin:10px 0 4px; font:600 12px/1.5 var(--fontStack-sansSerif,"Mona Sans VF",-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans Backtick Fix","Noto Sans",Helvetica,Arial,sans-serif,"Apple Color Emoji","Segoe UI Emoji") } input,textarea { display:block; width:100%; margin-top:4px; padding:7px 8px; border:1px solid var(--control-borderColor-rest,var(--ck-control-border-rest)); border-radius:6px; background:var(--control-bgColor-rest,var(--ck-control-bg-rest)); color:var(--control-fgColor-rest,var(--ck-control-fg-rest)) } input::placeholder,textarea::placeholder { color:var(--control-fgColor-placeholder,var(--ck-control-fg-placeholder)) } input:hover:not(:disabled),textarea:hover:not(:disabled) { background:var(--control-bgColor-hover,var(--ck-control-bg-hover)) } input:active:not(:disabled),textarea:active:not(:disabled) { background:var(--control-bgColor-active,var(--ck-control-bg-active)) } input:disabled,textarea:disabled { border-color:var(--control-borderColor-disabled,var(--ck-control-border-disabled)); background:var(--control-bgColor-disabled,var(--ck-control-bg-disabled)); color:var(--control-fgColor-disabled,var(--ck-control-fg-disabled)) } .form-actions { margin-top:12px } .error { margin-bottom:10px; color:var(--fgColor-danger,var(--ck-danger)); white-space:pre-wrap } @media(hover:none) { .entry-actions { opacity:1; pointer-events:auto } } @media(max-width:340px) { .entry-time-row { gap:3px } .inline-time-line { gap:1px } .compact-time-picker .time-picker-values { gap:1px } .compact-time-picker .time-value { width:27px; font-size:15px } .inline-duration { font-size:12px } .entry-actions { gap:1px } .entry-actions button { padding:2px; font-size:10px } } @media(max-width:700px) { :host(.times-surface) .times-page { width:100%; border:0 } .times-header { align-items:flex-start; flex-direction:column } .times-body { padding:16px } .times-toolbar { grid-template-columns:1fr } .times-filter { grid-column:auto } .times-custom { grid-column:auto; grid-template-columns:1fr } } @media(max-width:380px) { .time-range-editor { grid-template-columns:1fr } }
      /* Activity redesign: compact, scan-first list rows. */
      :host(.times-surface) .times-page { width:min(920px,calc(100% - 32px)); min-height:calc(100vh - 48px); background:var(--bgColor-default,var(--ck-bg)); border-inline:1px solid var(--borderColor-muted,var(--ck-border-muted)) }
      :host(.times-surface[data-clockoli-width="full"]) .times-page { width:100%; border-inline:0 }
      :host(.times-surface) .times-body { padding:24px }
      :host(.times-surface) .times-view-modes { display:flex; justify-content:center; gap:0; margin-bottom:16px; border-bottom:1px solid var(--borderColor-muted,var(--ck-border-muted)) }
      :host(.times-surface) .times-view-button { min-height:40px; margin-bottom:-1px; padding:8px 18px; border:0; border-bottom:3px solid transparent; border-radius:0; background:transparent; color:var(--fgColor-muted,var(--ck-fg-muted)); font-weight:600 }
      :host(.times-surface) .times-view-button:hover { background:var(--button-invisible-bgColor-hover,var(--ck-button-invisible-bg-hover)); color:var(--fgColor-default,var(--ck-fg)) }
      :host(.times-surface) .times-view-button[aria-pressed="true"] { border-bottom-color:var(--ck-success); background:var(--bgColor-default,var(--ck-bg)); color:var(--fgColor-default,var(--ck-fg)); font-weight:700 }
      :host(.times-surface) .popup-timeline-section { min-width:0; margin-bottom:20px }
      :host(.times-surface) .popup-timeline-section[hidden],:host(.times-surface) .times-results[hidden] { display:none }
      :host(.times-surface) .times-toolbar { grid-template-columns:minmax(0,1fr); margin-bottom:22px }
      :host(.times-surface) .times-toolbar.times-visual { grid-template-columns:1fr; justify-items:end }
      .timeline-shell { position:relative }
      .timeline-week-error,.timeline-edit-error { display:grid; justify-items:start; gap:8px; padding:12px 14px; border:1px solid var(--borderColor-danger-muted,var(--ck-border-danger)); border-radius:8px; background:var(--bgColor-danger-muted,var(--ck-bg-danger)) }
      .timeline-shell:has(>.calendar-week-loading:not([hidden])) { min-height:240px }
      .calendar-week-loading { position:absolute; z-index:5; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:16px; min-height:240px; background:color-mix(in srgb,var(--bgColor-default,var(--ck-bg)) 90%,transparent); color:var(--fgColor-default,var(--ck-fg)); font-size:14px; font-weight:600; pointer-events:none }
      .calendar-week-loading[hidden] { display:none }
      .calendar-week-spinner { width:64px; height:64px; border:6px solid var(--borderColor-muted,var(--ck-border-muted)); border-top-color:var(--ck-success); border-radius:50%; animation:calendar-week-spin .8s linear infinite }
      @keyframes calendar-week-spin { to { transform:rotate(360deg) } }
      @media(prefers-reduced-motion:reduce) { .calendar-week-spinner { animation:none; border-top-color:var(--ck-success); border-right-color:var(--ck-success) } }
      .week-navigation { box-sizing:border-box; display:grid; grid-template-columns:minmax(30px,1fr) auto minmax(30px,1fr); align-items:center; gap:8px; width:100%; margin:0; padding-inline:14px; white-space:nowrap }
      .week-navigation-label { font-size:12px; font-weight:600; color:var(--fgColor-muted,var(--ck-fg-muted)); font-variant-numeric:tabular-nums }
      .week-navigation-button { min-width:30px; min-height:30px; padding:2px 7px; font-size:20px; line-height:1 }
      .week-navigation-button:first-child { justify-self:start }
      .week-navigation-button:last-child { justify-self:end }
      :host(.times-surface) .times-list-total { margin:0 0 8px; color:var(--fgColor-muted,var(--ck-fg-muted)); font-size:12px; font-weight:600; text-align:center }
      :host(.times-surface) .times-list-total[hidden] { display:none }
      :host(.times-surface) .times-filter[hidden] { display:none }
      :host(.times-surface) .times-search-pagination { display:flex; flex-wrap:wrap; justify-content:center; align-items:center; gap:8px; margin:18px 0 4px; color:var(--fgColor-muted,var(--ck-fg-muted)); font-size:12px; font-variant-numeric:tabular-nums; text-align:center }
      :host(.times-surface) .times-toolbar label { color:var(--fgColor-muted,var(--ck-fg-muted)); font-size:12px; font-weight:600 }
      :host(.times-surface) .times-toolbar input,:host(.times-surface) .times-toolbar select { min-height:38px; background-color:var(--bgColor-muted,var(--ck-bg-muted)) }
      .activity-list .section-head { margin-bottom:14px }
      .activity-list .section-head strong { font-size:20px; font-weight:600 }
      .activity-list .entry { padding:0; margin:0 0 16px; border:1px solid var(--borderColor-default,var(--ck-border)); border-radius:10px; background:var(--bgColor-default,var(--ck-bg)) }
      .activity-list .entry-date-header { margin:0; padding:11px 14px; border-bottom:1px solid var(--borderColor-muted,var(--ck-border-muted)); border-radius:9px 9px 0 0; background:var(--bgColor-muted,var(--ck-bg-muted)) }
      .activity-list { border-top:0 }
      .activity-list .entry-record { position:relative; padding:14px 110px 14px 14px; border:0; border-bottom:1px solid var(--borderColor-muted,var(--ck-border-muted)); border-radius:0; background:var(--bgColor-default,var(--ck-bg)); transition:background .12s ease }
      .activity-list .entry-record:last-child { border-bottom:0; border-radius:0 0 9px 9px }
      .activity-list .entry-record + .entry-record { margin-top:0 }
      .activity-list .entry-record:hover { background:linear-gradient(90deg,var(--bgColor-default,var(--ck-bg)) 0,color-mix(in srgb,var(--bgColor-muted,var(--ck-bg-muted)) 45%,var(--bgColor-default,var(--ck-bg))) 100%) }
      .activity-list .entry-record.entry-overlap { padding:14px 110px 14px 14px; border-bottom-color:var(--borderColor-danger-muted,var(--ck-border-danger)); background:var(--bgColor-danger-muted,var(--ck-bg-danger)) }
      .activity-list .entry-time-row { gap:8px; min-height:18px; margin:0 0 8px; font:600 13px/1.35 var(--fontStack-monospace,ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace); letter-spacing:-.15px }
      .activity-list .entry-time-display { color:var(--fgColor-default,var(--ck-fg)) }
      .activity-list .inline-duration { margin:0; color:var(--fgColor-muted,var(--ck-fg-muted)); font-family:var(--fontStack-sansSerif,"Mona Sans VF",sans-serif); font-weight:500 }
      .activity-list .inline-time-range { display:none }
      .activity-list .entry-editing .entry-time-display { display:none }
      .activity-list .entry-editing .inline-time-range { display:block }
      .activity-list .entry-record-task-result.activity-task-result { display:flex; flex:1; flex-direction:column }
      .activity-list .activity-task-result .task-title { order:-1; max-width:720px; margin:0; font-size:15px }
      .activity-list .activity-task-result .task-url { width:max-content; max-width:100%; margin-top:2px; line-height:1.35 }
      .activity-list .entry-record-task-identity { gap:9px }
      .activity-list .entry-record-favicon { width:18px; height:18px; margin-top:1px; border-radius:4px }
      .activity-list .entry-record-task-result { margin:0 }
      .entry-description-link { white-space:pre-wrap; overflow-wrap:anywhere }
      .activity-list .entry-description-link { margin:5px 0 0 27px; padding:0; border:0; border-radius:0; background:transparent; color:var(--fgColor-muted,var(--ck-fg-muted)); font-size:12px; font-weight:400; text-align:left }
      .activity-list .entry-description-link:hover { background:transparent; color:var(--fgColor-accent,var(--ck-accent)); text-decoration:underline }
      .activity-list .entry-actions { position:absolute; top:12px; right:14px; gap:4px; opacity:0; transform:translateY(2px); transition:opacity .12s ease,transform .12s ease }
      .activity-list .entry-record:hover .entry-actions,.activity-list .entry-record:focus-within .entry-actions,.activity-list .entry-actions-visible { opacity:1; transform:translateY(0); pointer-events:auto }
      .activity-list .entry-actions .entry-edit,.activity-list .entry-actions .entry-delete,.activity-list .entry-actions .entry-track-control { width:30px; height:30px; padding:0; overflow:hidden; border:1px solid var(--borderColor-default,var(--ck-border)); border-radius:6px; background:var(--bgColor-default,var(--ck-bg)); color:var(--fgColor-muted,var(--ck-fg-muted)); font-size:0 }
      .activity-list .entry-actions .entry-track-control::after { content:'▶'; font-size:13px }
      .activity-list .entry-actions .entry-stop::after { content:'■'; font-size:15px }
      .activity-list .entry-actions .entry-track-control:hover { border-color:var(--fgColor-accent,var(--ck-accent)); color:var(--fgColor-accent,var(--ck-accent)) }
      .activity-list .entry-actions .entry-stop { border-color:var(--borderColor-danger-muted,var(--ck-border-danger)); color:var(--fgColor-danger,var(--ck-danger)) }
      .activity-list .entry-actions .entry-edit::after { content:'✎'; font-size:16px }
      .activity-list .entry-actions .entry-delete::after { content:'×'; font-size:20px; font-weight:400; line-height:1 }
      .activity-list .entry-actions .entry-edit:hover { background:var(--bgColor-muted,var(--ck-bg-muted)); color:var(--fgColor-default,var(--ck-fg)) }
      .activity-list .entry-actions .entry-delete:hover { border-color:var(--borderColor-danger-muted,var(--ck-border-danger)); background:var(--bgColor-danger-muted,var(--ck-bg-danger)); color:var(--fgColor-danger,var(--ck-danger)) }
      .activity-list .entry-actions.dirty .entry-edit,.activity-list .entry-actions.dirty .entry-delete,.activity-list .entry-actions.dirty .entry-track-control { display:none }
      :host(.times-surface) .bulk-time { margin-top:18px; padding:0; border:1px solid var(--borderColor-default,var(--ck-border)); border-radius:8px; background:var(--bgColor-muted,var(--ck-bg-muted)) }
      :host(.times-surface) .bulk-time summary { padding:10px 12px; font-weight:650 }
      :host(.times-surface) .bulk-time-examples { margin:8px 0 12px; padding:10px 12px; border:1px solid var(--borderColor-muted,var(--ck-border-muted)); border-radius:6px; background:var(--bgColor-default,var(--ck-bg)) }
      :host(.times-surface) .bulk-time-examples strong { display:block; font-size:12px }
      :host(.times-surface) .bulk-time-examples pre { margin:4px 0 0; color:var(--fgColor-muted,var(--ck-fg-muted)); font:12px/1.6 var(--fontStack-monospace,ui-monospace,monospace); white-space:pre-wrap; overflow-wrap:anywhere }
      :host(.times-surface) .bulk-time-feedback { position:fixed; z-index:1000; right:24px; bottom:24px; display:flex; align-items:center; gap:12px; box-sizing:border-box; width:max-content; max-width:calc(100vw - 32px); padding:12px 14px; border:1px solid var(--borderColor-default,var(--ck-border)); border-left:4px solid var(--ck-success); border-radius:8px; background:var(--bgColor-default,var(--ck-bg)); color:var(--fgColor-default,var(--ck-fg)); box-shadow:var(--shadow-floating-small,var(--ck-shadow)); font-weight:600; overflow-wrap:anywhere }
      :host(.times-surface) .bulk-time-feedback-error { border-left-color:var(--ck-danger) }
      :host(.times-surface) .bulk-time-feedback-dismiss { flex:none; min-width:28px; min-height:28px; margin-left:auto; padding:0 6px; border:0; border-radius:5px; background:transparent; color:var(--fgColor-muted,var(--ck-fg-muted)); font-size:20px; line-height:1; cursor:pointer }
      :host(.times-surface) .bulk-time-feedback-dismiss:hover { background:var(--bgColor-muted,var(--ck-bg-muted)) }
      @media(max-width:480px) { :host(.times-surface) .bulk-time-feedback { right:16px; bottom:16px; left:16px; width:auto } }
      @media(hover:none) { .activity-list .entry-actions { position:static; margin:10px 0 0 27px; opacity:1; transform:none; pointer-events:auto } .activity-list .entry-record { padding-right:14px } }
      @media(max-width:700px) { :host(.times-surface) .times-page { width:100%; border:0 } :host(.times-surface) .times-body { padding:16px 12px 40px } :host(.times-surface) .times-toolbar { grid-template-columns:1fr } .activity-list .entry-record { padding-right:14px } .activity-list .entry-actions { position:static; margin:10px 0 0 27px; opacity:1; transform:none; pointer-events:auto } }
      @media(max-width:400px) { .activity-list .inline-duration { display:block; width:100%; margin:3px 0 0 } }
    `);

    // On trusted extension pages, inherit Primer colors from the document instead
    // of pinning the light/dark values used to isolate the widget on GitHub.
    // Custom properties inherit across both shadow boundaries into Calendar.
    if (extensionPageMode) style.textContent += `
      :host(.times-surface), :host(.popup-surface),
      :host(.times-surface) > :not(style), :host(.popup-surface) > :not(style),
      :host(.times-surface) .times-page, :host(.popup-surface) .menu {
        --fgColor-default:inherit; --fgColor-muted:inherit; --fgColor-accent:inherit; --fgColor-danger:inherit; --bgColor-default:inherit; --bgColor-muted:inherit; --bgColor-inset:inherit; --bgColor-attention-muted:inherit; --bgColor-danger-muted:inherit; --borderColor-default:inherit; --borderColor-muted:inherit; --borderColor-danger-muted:inherit; --focus-outlineColor:inherit; --button-default-borderColor-rest:inherit; --button-default-bgColor-rest:inherit; --button-default-fgColor-rest:inherit; --button-default-bgColor-hover:inherit; --button-default-bgColor-active:inherit; --button-default-bgColor-selected:inherit; --button-default-borderColor-disabled:inherit; --button-default-bgColor-disabled:inherit; --button-default-fgColor-disabled:inherit; --button-primary-borderColor-rest:inherit; --button-primary-bgColor-rest:inherit; --button-primary-fgColor-rest:inherit; --button-primary-bgColor-hover:inherit; --button-primary-bgColor-active:inherit; --button-primary-borderColor-disabled:inherit; --button-primary-bgColor-disabled:inherit; --button-primary-fgColor-disabled:inherit; --button-danger-borderColor-rest:inherit; --button-danger-bgColor-rest:inherit; --button-danger-fgColor-rest:inherit; --button-danger-borderColor-hover:inherit; --button-danger-bgColor-hover:inherit; --button-danger-fgColor-hover:inherit; --button-danger-borderColor-active:inherit; --button-danger-bgColor-active:inherit; --button-danger-fgColor-active:inherit; --button-danger-bgColor-disabled:inherit; --button-danger-fgColor-disabled:inherit; --button-invisible-borderColor-rest:inherit; --button-invisible-bgColor-rest:inherit; --button-invisible-iconColor-rest:inherit; --button-invisible-fgColor-rest:inherit; --button-invisible-borderColor-hover:inherit; --button-invisible-bgColor-hover:inherit; --button-invisible-iconColor-hover:inherit; --button-invisible-bgColor-active:inherit; --button-invisible-borderColor-disabled:inherit; --button-invisible-bgColor-disabled:inherit; --button-invisible-fgColor-disabled:inherit; --control-borderColor-rest:inherit; --control-bgColor-rest:inherit; --control-fgColor-rest:inherit; --control-fgColor-placeholder:inherit; --control-bgColor-hover:inherit; --control-bgColor-active:inherit; --control-borderColor-disabled:inherit; --control-bgColor-disabled:inherit; --control-fgColor-disabled:inherit; --shadow-floating-small:inherit;
        color-scheme:inherit;
      }
    `;
    if (timesMode) style.textContent += `
      /* Activity dashboard: one compact information hierarchy above the calendar. */
      :host(.times-surface) { color-scheme:inherit }
      :host(.times-surface) .times-page {width:min(1800px,calc(100% - 80px));min-height:calc(100vh - 116px);margin:0 auto 24px;border:0;border-radius:0;background:var(--bgColor-default,var(--ck-bg));box-shadow:none}
      :host(.times-surface[data-clockoli-width="full"]) .times-page {width:calc(100% - 80px);margin:0 auto}
      :host(.times-surface) .times-body {padding:0 0 30px}
      :host(.times-surface) .times-toolbar:not(.times-visual) {display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:16px;margin:24px 0 20px}
      :host(.times-surface) .times-filter {position:relative;width:100%;margin:0}
      :host(.times-surface) .times-filter svg {position:absolute;top:50%;left:16px;transform:translateY(-50%);color:var(--fgColor-muted,var(--ck-fg-muted));pointer-events:none}
      :host(.times-surface) .times-filter input {box-sizing:border-box;min-height:50px;margin-top:0;padding-left:44px;border-radius:8px}
      :host(.times-surface) .times-toolbar:not(.times-visual) .week-navigation {display:grid;grid-template-columns:auto auto auto;gap:12px;width:auto;min-height:0;margin:0;padding:0}
      :host(.times-surface) .times-toolbar .week-navigation-label {display:block;padding:11px 14px;border:1px solid var(--borderColor-muted,var(--ck-border-muted));border-radius:8px;color:var(--fgColor-muted,var(--ck-fg-muted));font-size:14px}
      :host(.times-surface) .times-toolbar .week-navigation-button {min-width:46px;min-height:50px}
      :host(.times-surface) .times-refresh {width:50px;height:50px;border:1px solid var(--borderColor-default,var(--ck-border));border-radius:8px;background:var(--bgColor-muted,var(--ck-bg-muted))}
      :host(.times-surface) .times-refresh:hover {background:var(--button-default-bgColor-hover,var(--ck-button-default-bg-hover))}
      :host(.times-surface) .times-refresh[hidden] {display:none}
      :host(.times-surface) .activity-list .entry {padding-bottom:12px}
      :host(.times-surface) .activity-list .entry-record {margin:10px 12px 0;padding:12px 110px 12px 14px;border:1px solid var(--borderColor-muted,var(--ck-border-muted));border-radius:10px;background:var(--bgColor-muted,var(--ck-bg-muted))}
      :host(.times-surface) .activity-list .entry-record + .entry-record {margin-top:10px}
      :host(.times-surface) .activity-list .entry-record:last-child {border-bottom:1px solid var(--borderColor-muted,var(--ck-border-muted));border-radius:10px}
      :host(.times-surface) .times-toolbar.times-visual {min-height:0;margin:0;padding:0}
      :host(.times-surface) .popup-timeline-section {padding-top:24px;margin-bottom:16px}
      :host(.times-surface) .week-navigation {min-height:50px;margin:0 0 4px;border-bottom:0}
      :host(.times-surface) .week-navigation {grid-template-columns:1fr 1fr}
      :host(.times-surface) .week-navigation-label,:host(.times-surface) .times-list-total {display:none}
      :host(.times-surface) .activity-list .section-head {justify-content:flex-end;margin-bottom:0}
      :host(.times-surface) .week-navigation-button {border-radius:8px}
      :host(.times-surface) .timeline-shell > .week-navigation {position:absolute;z-index:30;inset:0 0 auto;height:84px;min-height:0;margin:0;pointer-events:none}
      :host(.times-surface) .timeline-shell.calendar-week-navigation > .week-navigation {height:44px}
      :host(.times-surface) .timeline-shell > .week-navigation::before,
      :host(.times-surface) .timeline-shell > .week-navigation::after {content:"";position:absolute;inset-block:0;width:90px;pointer-events:none}
      :host(.times-surface) .timeline-shell > .week-navigation::before {left:0;background:linear-gradient(90deg,color-mix(in srgb,var(--bgColor-muted,var(--ck-bg-muted)) 90%,var(--fgColor-muted,var(--ck-fg-muted))),transparent)}
      :host(.times-surface) .timeline-shell > .week-navigation::after {right:0;background:linear-gradient(270deg,color-mix(in srgb,var(--bgColor-muted,var(--ck-bg-muted)) 90%,var(--fgColor-muted,var(--ck-fg-muted))),transparent)}
      :host(.times-surface) .timeline-shell > .week-navigation .week-navigation-button {position:relative;z-index:1;pointer-events:auto}
      @media(max-width:1000px){:host(.times-surface) .activity-weekly-copy{flex-direction:column;gap:0}:host(.times-surface) .activity-weekly-cards{gap:8px}}
      @media(max-width:700px){:host(.times-surface) .times-page,:host(.times-surface[data-clockoli-width="full"]) .times-page{width:100%;margin:0}:host(.times-surface) .times-body{padding:0 12px 24px}}
      @media(max-width:700px){:host(.times-surface) .times-toolbar:not(.times-visual){grid-template-columns:minmax(0,1fr) auto;gap:10px}:host(.times-surface) .times-filter{grid-column:1/-1}:host(.times-surface) .times-toolbar:not(.times-visual) .week-navigation{grid-column:1;justify-self:start;gap:8px}:host(.times-surface) .times-refresh{grid-column:2}}
      @media(max-width:700px){:host(.times-surface) .popup-timeline-section{padding-top:16px}}
      @media(max-width:460px){:host(.times-surface) .activity-weekly-cards{grid-template-columns:repeat(2,minmax(0,1fr))}}
    `;
    if (popupMode || fullWidthPopupOpen) style.textContent += `
      :host(.popup-surface) .menu { max-height:min(720px,calc(100vh - 16px)); overflow-y:auto }
      :host(.popup-surface) .tracker-toolbar { display:grid; grid-template-columns:minmax(0,1fr) auto; grid-template-areas:"brand end" "actions actions"; align-items:center; gap:8px; margin:0; padding:10px 12px 8px; border-top:0; border-bottom:1px solid var(--borderColor-muted,var(--ck-border-muted)) }
      :host(.popup-surface) .timeline-brand { grid-area:brand; display:flex; justify-content:flex-start; min-width:0 }
      :host(.popup-surface) .clockoli-wordmark { display:block; width:auto; max-width:160px; height:28px; object-fit:contain }
      :host(.popup-surface) .timeline-toolbar-end { grid-area:end; display:flex; align-items:center }
      :host(.popup-surface) .header-actions { grid-area:actions; width:100%; justify-content:space-between; gap:0 }
      :host(.popup-surface) .header-navigation { width:100%; justify-content:space-between; gap:0 }
      :host(.popup-surface) .reports-button { padding:5px 4px; font-size:12px }
      :host(.popup-surface) .reports-button svg { width:14px; height:14px }
      :host(.full-width-popup-surface) { position:fixed; z-index:2147483647; top:0; right:0; left:0; display:block; width:100vw; pointer-events:none }
      :host(.full-width-popup-surface) .full-width-popup { width:100vw; max-width:none; max-height:min(720px,70vh); margin:0; overflow:auto; pointer-events:auto; border:1px solid var(--borderColor-default,var(--ck-border)); border-top:0; border-radius:0 0 12px 12px; background:var(--bgColor-default,var(--ck-bg)); color:var(--fgColor-default,var(--ck-fg)); box-shadow:var(--shadow-floating-small,var(--ck-shadow-overlay)) }
      :host(.full-width-popup-surface[data-clockoli-width="contained"]) .tracker-toolbar,:host(.full-width-popup-surface[data-clockoli-width="contained"]) .menu-body { max-width:1100px; margin-inline:auto }
      :host(.full-width-popup-surface) .menu { position:relative; inset:auto; width:100%; max-height:none; margin:0; overflow:visible; border:0; border-radius:0; box-shadow:none }
      :host(.full-width-popup-surface) .menu-body { padding:0 }
      :host(.full-width-popup-surface) .tracker-toolbar { display:grid; grid-template-columns:auto minmax(0,1fr) auto; align-items:center; min-height:48px; padding:8px var(--clockoli-gutter); border-bottom:1px solid var(--borderColor-muted,var(--ck-border-muted)) }
      :host(.full-width-popup-surface) .timeline-brand { display:inline-flex; align-items:center; color:var(--fgColor-default,var(--ck-fg)) }
      :host(.full-width-popup-surface) .clockoli-wordmark { display:block; width:auto; height:32px; object-fit:contain }
      :host(.full-width-popup-surface) .header-actions { justify-self:center; display:flex; align-items:center; gap:2px }
      :host(.full-width-popup-surface) .header-navigation { width:auto; justify-content:flex-start; gap:2px }
      .timeline-view-modes { display:flex; gap:2px; padding:3px; border:1px solid var(--borderColor-muted,var(--ck-border-muted)); border-radius:10px }
      .popup-switch-action:not(:empty) { display:flex; align-self:center }
      .popup-switch-action .popup-timeline-track { padding:6px 10px; font-size:12px }
      .timeline-view-button { display:flex; align-items:center; justify-content:center; width:36px; height:36px; margin:0; padding:0; border:0; border-radius:8px; background:transparent; color:var(--fgColor-muted,var(--ck-fg-muted)); cursor:pointer }
      .timeline-view-button svg { width:18px; height:18px; fill:currentColor }
      .timeline-view-button:hover { background:var(--button-invisible-bgColor-hover,var(--ck-button-invisible-bg-hover)); color:var(--fgColor-default,var(--ck-fg)) }
      .timeline-view-button[aria-pressed="true"] { background:var(--bgColor-success-muted,color-mix(in srgb,var(--ck-success) 14%,transparent)); color:var(--ck-success) }
      .timeline-view-button:focus-visible { outline:2px solid var(--focus-outlineColor,var(--ck-accent)); outline-offset:2px }
      :host(.full-width-popup-surface) .timeline-toolbar-end { justify-self:end; display:flex; align-items:center; gap:12px }
      :host(.full-width-popup-surface) .popup-timeline-track { white-space:nowrap }
      :host(.full-width-popup-surface) .popup-timeline-close { width:30px; height:30px; padding:0; border:0; border-radius:0; background:var(--button-invisible-bgColor-rest,var(--ck-transparent)); font-size:24px; font-weight:400; line-height:1 }
      @media(max-width:520px) {
        :host(.full-width-popup-surface) .tracker-toolbar { grid-template-columns:minmax(0,1fr) auto; grid-template-areas:"brand end" "actions actions"; row-gap:4px }
        :host(.full-width-popup-surface) .timeline-brand { grid-area:brand }
        :host(.full-width-popup-surface) .clockoli-wordmark { height:24px }
        :host(.full-width-popup-surface) .timeline-toolbar-end { grid-area:end }
        :host(.full-width-popup-surface) .header-actions { grid-area:actions; justify-self:stretch; width:100%; flex-wrap:wrap }
        :host(.full-width-popup-surface) .header-navigation { display:grid; flex:1 1 100%; width:100%; max-width:100%; grid-template-columns:repeat(4,minmax(0,1fr)); gap:2px; overflow:visible }
        :host(.full-width-popup-surface) .header-navigation .reports-button { min-width:0; justify-content:center; gap:3px; padding:5px 2px; font-size:10px; white-space:nowrap }
        :host(.full-width-popup-surface) .header-navigation .reports-button svg { width:12px; height:12px }
      }
      :host(.full-width-popup-surface) .popup-timeline-section { box-sizing:border-box; position:relative; width:100%; margin:0; padding:16px var(--clockoli-gutter); border:0; border-radius:0; background:var(--button-invisible-bgColor-rest,var(--ck-transparent)) }
      :host(.full-width-popup-surface) .popup-list-total { margin:0 0 8px; color:var(--fgColor-muted,var(--ck-fg-muted)); font-size:12px; font-weight:600; text-align:center }
      :host(.full-width-popup-surface) .popup-list-total[hidden] { display:none }
      :host(.full-width-popup-surface) .timeline-shell { position:relative; width:100%; min-width:0 }
      :host(.full-width-popup-surface) .task-timeline-host { width:100%; min-height:108px }
      .active-task-strip { display:flex; align-items:center; gap:12px; padding:14px var(--clockoli-gutter); border-bottom:1px solid var(--borderColor-muted,var(--ck-border-muted)) }
      .active-task-strip.is-active { box-sizing:border-box; width:min(1600px,calc(100% - 2 * var(--clockoli-gutter))); gap:14px; margin:10px auto 0; padding:10px 16px; border:1px solid var(--borderColor-muted,var(--ck-border-muted)); border-radius:12px; background:linear-gradient(100deg,color-mix(in srgb,var(--ck-success) 5%,var(--ck-bg)),var(--bgColor-default,var(--ck-bg)) 45%); box-shadow:0 2px 10px color-mix(in srgb,var(--ck-fg) 5%,transparent) }
      .popup-overview-layout { box-sizing:border-box; display:grid; grid-template-columns:minmax(190px,1fr) minmax(0,3fr); align-items:stretch; gap:12px; width:calc(100% - 2 * var(--clockoli-gutter)); margin:14px auto 0 }
      :host(.full-width-popup-surface[data-clockoli-width="full"]) .popup-overview-layout { grid-template-columns:minmax(0,1fr) minmax(0,7fr) }
      .popup-overview-layout .activity-weekly-summary { box-sizing:border-box; min-width:0; padding:12px 14px; border:1px solid var(--borderColor-muted,var(--ck-border-muted)); border-radius:12px; background:var(--bgColor-muted,var(--ck-bg-muted)); font:400 14px/1.5 var(--fontStack-sansSerif) }
      .popup-overview-layout .activity-weekly-heading { margin:0 0 6px; color:var(--fgColor-default,var(--ck-fg)); font-size:13px; font-weight:700 }
      .popup-overview-layout .activity-weekly-range,.popup-overview-layout .activity-weekly-icon { display:none }
      .popup-overview-layout .activity-weekly-cards { display:grid; grid-template-columns:1fr }
      .popup-overview-layout .activity-weekly-card { min-width:0; padding:5px 0; border-bottom:1px solid var(--borderColor-muted,var(--ck-border-muted)) }
      .popup-overview-layout .activity-weekly-card:last-child { border-bottom:0 }
      .popup-overview-layout .activity-weekly-copy { display:flex; flex-direction:row-reverse; justify-content:space-between; align-items:baseline; gap:4px; min-width:0 }
      .popup-overview-layout .activity-weekly-value { color:var(--fgColor-default,var(--ck-fg)); font-size:13px; font-weight:700; font-variant-numeric:tabular-nums; white-space:nowrap }
      .popup-overview-layout .activity-weekly-card:first-child .activity-weekly-value { color:var(--fgColor-success,var(--ck-success)) }
      .popup-overview-layout .activity-weekly-name { min-width:0; color:var(--fgColor-muted,var(--ck-fg-muted)); font-size:11px }
      .popup-overview-layout .active-task-strip,.popup-overview-layout .active-task-strip.is-active { box-sizing:border-box; width:100%; height:100%; min-height:84px; margin:0; padding:12px 24px; border:1px solid var(--borderColor-muted,var(--ck-border-muted)); border-radius:12px; background:linear-gradient(100deg,color-mix(in srgb,var(--ck-success) 6%,var(--ck-bg)),var(--ck-bg) 65%,color-mix(in srgb,var(--ck-success) 5%,var(--ck-bg))); box-shadow:none }
      .popup-overview-layout .active-task-strip.is-active { display:grid; grid-template-columns:minmax(0,1fr) max-content; grid-template-rows:auto auto 1fr; align-items:start; gap:8px 22px }
      .popup-overview-layout .active-task-strip .running-status-live { grid-column:1; grid-row:1; justify-self:start }
      .popup-overview-layout .active-task-strip .strip-task-copy { grid-column:1; grid-row:2; max-width:100% }
      .popup-overview-layout .active-task-strip .strip-description-field { grid-column:1; grid-row:3; width:min(100%,560px); max-width:none; min-width:0 }
      .popup-overview-layout .active-task-strip .running-status-stats { grid-column:2; grid-row:1/span 2; justify-self:end; margin:0 }
      .popup-overview-layout .active-task-strip > .danger { grid-column:2; grid-row:3; justify-self:end; align-self:start; min-height:36px }
      .popup-overview-layout .active-task-strip .strip-idle { color:var(--fgColor-muted,var(--ck-fg-muted)); font-size:13px; font-weight:700 }
      @media(max-width:1299px) { :host(.full-width-popup-surface[data-clockoli-width="full"]) .popup-overview-layout { grid-template-columns:minmax(190px,1fr) minmax(0,3fr) } }
      @media(max-width:900px) { .popup-overview-layout,:host(.full-width-popup-surface[data-clockoli-width="full"]) .popup-overview-layout { grid-template-columns:1fr } }
      :host(.popup-surface) .popup-overview-layout { grid-template-columns:1fr }
      @media(max-width:640px) { .popup-overview-layout .active-task-strip.is-active { grid-template-columns:minmax(0,1fr); grid-template-rows:none; padding:12px; gap:10px } .popup-overview-layout .active-task-strip .running-status-live,.popup-overview-layout .active-task-strip .strip-task-copy,.popup-overview-layout .active-task-strip .strip-description-field,.popup-overview-layout .active-task-strip .running-status-stats,.popup-overview-layout .active-task-strip > .danger { grid-column:1; grid-row:auto; justify-self:start } .popup-overview-layout .active-task-strip .running-status-stats,.popup-overview-layout .active-task-strip > .danger { justify-self:end } }
      .active-task-strip .running-status-live { flex:none; display:inline-flex; align-items:center; gap:8px; padding:5px 10px; border-radius:999px; background:color-mix(in srgb,var(--ck-success) 13%,transparent); color:var(--ck-success); font-size:11px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; white-space:nowrap }
      .active-task-strip .running-status-live::before { content:""; width:8px; height:8px; border-radius:50%; background:currentColor; box-shadow:0 0 0 3px color-mix(in srgb,var(--ck-success) 16%,transparent) }
      .site-favicon { display:block; width:20px; height:20px; flex:none; border-radius:4px; object-fit:contain; background:var(--bgColor-default,var(--ck-bg)) }
      .site-monogram { display:grid; place-items:center; color:var(--fgColor-default,var(--ck-fg)); font-size:12px; font-weight:600; line-height:1 }
      .strip-task-copy { display:block; flex:0 1 auto; min-width:0; max-width:340px } .strip-task,.strip-idle { min-width:0 } .strip-task .task-url { display:none } .strip-task.task-result-untitled .task-url { display:block }
      .strip-task .task-title,.strip-task.task-result-untitled .task-url { display:block; overflow:hidden; margin:0; color:var(--fgColor-default,var(--ck-fg)); font-size:15px; font-weight:650; text-overflow:ellipsis; white-space:nowrap }
      .strip-description-field { flex:0 1 230px; min-width:160px; max-width:250px }
      .strip-description,.today-description { width:100%; min-height:0; margin:2px 0 0; padding:1px 96px 1px 0; border:0; border-radius:0; background:transparent; color:var(--fgColor-muted,var(--ck-fg-muted)); font-size:12px; font-weight:400; line-height:1.3 }
      .strip-description { box-sizing:border-box; min-height:36px; margin:0; padding:6px 78px 6px 10px; border:1px solid var(--control-borderColor-rest,var(--ck-border)); border-radius:8px; background:var(--control-bgColor-rest,var(--ck-bg)); resize:none; max-height:180px; overflow-y:auto; white-space:pre-wrap }
      .strip-description:hover { background:var(--control-bgColor-hover,var(--ck-bg-muted)) }
      .strip-description:focus-visible { outline:2px solid var(--focus-outlineColor,var(--ck-accent)); outline-offset:2px }
      .today-description:hover,.today-description:focus { background:transparent; box-shadow:inset 0 -1px var(--borderColor-default,var(--ck-border)) }
      .active-task-strip button,.running-elapsed { flex:none; white-space:nowrap } .running-elapsed { font-variant-numeric:tabular-nums }
      .active-task-strip .running-status-stats { display:flex; flex:none; max-width:100%; margin-left:auto; border:1px solid var(--borderColor-muted,var(--ck-border-muted)); border-radius:9px; background:var(--bgColor-muted,var(--ck-bg-muted)) }
      .active-task-strip .running-status-start-field { box-sizing:border-box; position:relative; display:flex; align-items:center; flex:none; min-width:100px; padding:5px 8px 5px 11px; border-right:1px solid var(--borderColor-muted,var(--ck-border-muted)) }
      .active-task-strip .running-status-start-field:focus-within { box-shadow:inset 0 0 0 2px var(--fgColor-accent,var(--ck-accent)) }
      .active-task-strip .running-status-start-label { display:flex; flex-direction:column; gap:2px; margin:0; color:var(--fgColor-muted,var(--ck-fg-muted)); font-size:11px; font-weight:600; line-height:1.2; white-space:nowrap }
      .active-task-strip .running-status-start-value { display:inline-flex; align-items:center; gap:4px; height:24px }
      .active-task-strip .running-status-start { box-sizing:border-box; width:55px; height:24px; margin:0; padding:2px 0; border:0; border-bottom:1px dashed var(--fgColor-accent,var(--ck-accent)); border-radius:0; background:transparent; color:var(--fgColor-default,var(--ck-fg)); font:650 14px/20px var(--fontStack-sansSerif); font-variant-numeric:tabular-nums; cursor:text }
      .active-task-strip .running-status-start:hover { border-bottom-style:solid }
      .active-task-strip .running-status-start:focus-visible { outline:none }
      .active-task-strip .running-status-start-save,.active-task-strip .running-status-start-saved { position:absolute; right:3px; bottom:4px; display:grid; width:24px; height:26px; place-items:center }
      .active-task-strip .running-status-start-save { padding:0; border:0; border-radius:5px; background:transparent; color:var(--fgColor-success,var(--ck-success)); font:800 18px/1 var(--fontStack-sansSerif); cursor:pointer }
      .active-task-strip .running-status-start-saved { color:var(--fgColor-success,var(--ck-success)); font-size:0 }
      .active-task-strip .running-status-start-saved::before { content:'✓'; font-size:17px; font-weight:800 }
      .active-task-strip .running-status-start-save[hidden],.active-task-strip .running-status-start-saved[hidden] { display:none }
      .active-task-strip .running-status-metrics { display:flex; align-items:stretch; flex:none; white-space:nowrap; font-variant-numeric:tabular-nums }
      .active-task-strip .running-status-elapsed,.active-task-strip .running-status-today { display:flex; flex-direction:column; gap:2px; min-width:0; padding:5px 11px; color:var(--fgColor-default,var(--ck-fg)); font-size:14px; font-weight:650; line-height:1.2 }
      .active-task-strip .running-status-today { border-left:1px solid var(--borderColor-muted,var(--ck-border-muted)) }
      .active-task-strip .running-status-metric-label { color:var(--fgColor-muted,var(--ck-fg-muted)); font-size:11px; font-weight:600; line-height:1.2 }
      .active-task-strip .running-status-metric-value { min-height:24px; line-height:24px }
      @media(max-width:900px) { .active-task-strip.is-active { flex-wrap:wrap; gap:10px 14px } .active-task-strip .strip-task-copy { flex-basis:calc(100% - 150px) } }
      @media(max-width:640px) { .active-task-strip.is-active { padding:12px; gap:10px } .active-task-strip .strip-task-copy { order:1; flex-basis:100% } .active-task-strip .strip-description-field { order:2; flex-basis:100%; max-width:none; min-width:0 } .active-task-strip .running-status-stats { order:3; margin-left:0 } .active-task-strip > .danger { order:4; margin-left:auto; padding:6px 10px; font-size:12px } .active-task-strip > .popup-timeline-track { order:5; flex-basis:100% } }
      @media(prefers-color-scheme:dark) { .active-task-strip.is-active { box-shadow:0 2px 10px color-mix(in srgb,var(--ck-fg) 15%,transparent) } }
      .today-list,.panel-feedback,.timeline-overlaps,.page-tracking-hint { padding:0 var(--clockoli-gutter) 16px } .panel-feedback:empty,.timeline-overlaps:empty { display:none }
      .today-list-totals { display:flex; gap:24px; margin-bottom:10px } .today-list-totals .today-total { margin:0; padding:0; border:0; background:none; gap:6px }
      @media(max-width:520px) { .active-task-strip { flex-wrap:wrap } .strip-task-copy,.strip-idle { flex-basis:70% } }

      :host(.full-width-popup-surface) .task-timeline-host { width:100%; min-height:108px }
      /* Keep popup chrome compact so the week view owns the available height. */
      :host(.full-width-popup-surface) .tracker-toolbar { grid-template-columns:auto auto minmax(0,1fr) auto; gap:12px; padding-block:6px }
      :host(.full-width-popup-surface) .header-actions { justify-self:center }
      :host(.full-width-popup-surface) .timeline-toolbar-end { gap:8px }
      .tracker-toolbar .activity-weekly-summary { display:flex; align-items:center; gap:10px; min-width:0; padding:4px 8px; border:1px solid var(--borderColor-muted,var(--ck-border-muted)); border-radius:8px; background:var(--bgColor-muted,var(--ck-bg-muted)) }
      .tracker-toolbar .activity-weekly-heading { flex:none; margin:0; font-size:10px }
      .tracker-toolbar .activity-weekly-range,.tracker-toolbar .activity-weekly-icon { display:none }
      .tracker-toolbar .activity-weekly-cards { display:flex; align-items:center; gap:8px; min-width:0 }
      .tracker-toolbar .activity-weekly-card { min-width:0; padding:0 0 0 8px; border-left:1px solid var(--borderColor-muted,var(--ck-border-muted)) }
      .tracker-toolbar .activity-weekly-copy { display:flex; flex-direction:column; gap:0; min-width:0; white-space:nowrap }
      .tracker-toolbar .activity-weekly-name { color:var(--fgColor-muted,var(--ck-fg-muted)); font-size:9px; line-height:1.2 }
      .tracker-toolbar .activity-weekly-value { color:var(--fgColor-default,var(--ck-fg)); font-size:11px; line-height:1.3; font-weight:700; font-variant-numeric:tabular-nums }
      .tracker-toolbar .activity-weekly-card:first-child .activity-weekly-value { color:var(--fgColor-success,var(--ck-success)) }
      .popup-switch-action .popup-timeline-track { padding:6px 10px; border-color:var(--button-primary-borderColor-rest,var(--ck-button-primary-border-rest)); background:var(--button-primary-bgColor-rest,var(--ck-button-primary-bg-rest)); color:var(--button-primary-fgColor-rest,var(--ck-button-primary-fg-rest)); white-space:nowrap }
      .popup-switch-action .popup-timeline-track:hover:not(:disabled) { background:var(--button-primary-bgColor-hover,var(--ck-button-primary-bg-hover)) }
      .popup-overview-layout { display:block; margin:8px auto 0 }
      .popup-overview-layout .active-task-strip,.popup-overview-layout .active-task-strip.is-active { display:flex; align-items:center; gap:12px; width:100%; height:auto; min-height:56px; margin:0; padding:7px 12px }
      .popup-overview-layout .active-task-strip.is-active .running-status-live,
      .popup-overview-layout .active-task-strip.is-active .strip-task-copy,
      .popup-overview-layout .active-task-strip.is-active .strip-description-field,
      .popup-overview-layout .active-task-strip.is-active .running-status-stats,
      .popup-overview-layout .active-task-strip.is-active > .danger { grid-column:auto; grid-row:auto; justify-self:auto; align-self:center }
      .popup-overview-layout .active-task-strip.is-active .running-status-live { padding:4px 7px; font-size:10px }
      .popup-overview-layout .active-task-strip.is-active .strip-task-copy { flex:0 1 26%; max-width:420px }
      .popup-overview-layout .active-task-strip.is-active .strip-description-field { flex:1 1 180px; width:auto; max-width:none; min-width:120px }
      .popup-overview-layout .active-task-strip.is-active .strip-description:not(:focus) { max-height:36px }
      .popup-overview-layout .active-task-strip.is-active .strip-description-field:not(:focus-within) .description-overflow-hint { display:none }
      .popup-overview-layout .active-task-strip.is-active .running-status-stats { flex:none; margin-left:auto }
      .popup-overview-layout .active-task-strip.is-active > .danger { flex:none; min-height:36px; padding:6px 10px }
      .popup-overview-layout .active-task-strip .running-status-quick-start { display:flex; flex:1; align-items:center; gap:12px; min-width:0 }
      .popup-overview-layout .active-task-strip .running-status-quick-label { flex:none; color:var(--fgColor-muted,var(--ck-fg-muted)); font-size:11px; white-space:nowrap }
      .popup-overview-layout .active-task-strip .running-status-recent { display:flex; flex:1; gap:8px; min-width:0; overflow-x:auto }
      .popup-overview-layout .active-task-strip .running-status-recent-task { display:inline-flex; flex:1 1 0; align-items:center; gap:8px; min-width:0; max-width:300px; min-height:36px; padding:5px 8px; border:1px solid var(--borderColor-muted,var(--ck-border-muted)); border-radius:8px; background:var(--bgColor-muted,var(--ck-bg-muted)); text-align:left }
      .popup-overview-layout .active-task-strip .running-status-recent-task:nth-child(3n+1) { border-color:color-mix(in srgb,var(--ck-success) 40%,var(--ck-border)); background:color-mix(in srgb,var(--ck-success) 10%,var(--ck-bg)) }
      .popup-overview-layout .active-task-strip .running-status-recent-task:nth-child(3n+2) { border-color:color-mix(in srgb,var(--ck-danger) 40%,var(--ck-border)); background:color-mix(in srgb,var(--ck-danger) 10%,var(--ck-bg)) }
      .popup-overview-layout .active-task-strip .running-status-recent-task:nth-child(3n+3) { border-color:color-mix(in srgb,var(--ck-accent) 40%,var(--ck-border)); background:color-mix(in srgb,var(--ck-accent) 9%,var(--ck-bg)) }
      .popup-overview-layout .active-task-strip .running-status-recent-task:hover:not(:disabled) { border-color:var(--fgColor-accent,var(--ck-accent)) }
      .popup-overview-layout .active-task-strip .running-status-recent-play::before { content:'▶'; color:var(--ck-success); font-size:11px }
      .popup-overview-layout .active-task-strip .running-status-recent-name { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:11px }
      .popup-overview-layout .active-task-strip .running-status-recent-empty { color:var(--fgColor-muted,var(--ck-fg-muted)); font-size:11px }
      @media(max-width:1450px) { :host(.full-width-popup-surface) .tracker-toolbar { grid-template-columns:auto minmax(0,1fr) auto; grid-template-areas:"brand stats end" "nav nav nav"; row-gap:3px } :host(.full-width-popup-surface) .timeline-brand { grid-area:brand } :host(.full-width-popup-surface) .tracker-toolbar .activity-weekly-summary { grid-area:stats; justify-self:start } :host(.full-width-popup-surface) .header-actions { grid-area:nav } :host(.full-width-popup-surface) .timeline-toolbar-end { grid-area:end } }
      @media(max-width:900px) { .popup-overview-layout .active-task-strip.is-active { flex-wrap:wrap } .popup-overview-layout .active-task-strip.is-active .strip-task-copy { flex:1 1 40%; max-width:none } .popup-overview-layout .active-task-strip.is-active .strip-description-field { flex:1 1 40% } .popup-overview-layout .active-task-strip.is-active .running-status-stats { margin-left:auto } }
      @media(min-width:901px) {
        :host(.full-width-popup-surface) .popup-overview-layout .active-task-strip.is-active { display:grid; grid-template-columns:minmax(0,1fr) max-content; grid-template-rows:auto auto 1fr; align-items:start; gap:8px 22px }
        :host(.full-width-popup-surface) .popup-overview-layout .active-task-strip .running-status-live { grid-column:1; grid-row:1; justify-self:start }
        :host(.full-width-popup-surface) .popup-overview-layout .active-task-strip .strip-task-copy { grid-column:1; grid-row:2; max-width:100% }
        :host(.full-width-popup-surface) .popup-overview-layout .active-task-strip .strip-description-field { grid-column:1; grid-row:3; width:100%; max-width:none; min-width:0 }
        :host(.full-width-popup-surface) .popup-overview-layout .active-task-strip .running-status-stats { grid-column:2; grid-row:1/span 2; justify-self:end; margin-left:0 }
        :host(.full-width-popup-surface) .popup-overview-layout .active-task-strip > .danger { grid-column:2; grid-row:3; justify-self:stretch; align-self:start; width:100% }
      }
      :host(.popup-surface) .tracker-toolbar { grid-template-columns:minmax(0,1fr) auto; grid-template-areas:"brand end" "stats stats" "actions actions"; gap:4px; padding:8px 12px }
      :host(.popup-surface) .tracker-toolbar .activity-weekly-summary { grid-area:stats; width:100%; justify-content:space-between }
      :host(.popup-surface) .tracker-toolbar .activity-weekly-cards { justify-content:space-between; flex:1 }
      :host(.popup-surface) .timeline-toolbar-end { grid-area:end; gap:4px }
      :host(.popup-surface) .header-actions { grid-area:actions }
      :host(.popup-surface) .popup-overview-layout .active-task-strip.is-active { display:grid; grid-template-columns:minmax(0,1fr) max-content; grid-template-rows:auto auto auto; align-items:start; gap:8px 12px }
      :host(.popup-surface) .popup-overview-layout .active-task-strip.is-active .running-status-live { grid-column:1; grid-row:1; justify-self:start; align-self:start }
      :host(.popup-surface) .popup-overview-layout .active-task-strip.is-active .strip-task-copy { grid-column:1; grid-row:2; max-width:100%; min-width:0; align-self:start }
      :host(.popup-surface) .popup-overview-layout .active-task-strip.is-active .strip-description-field { grid-column:1; grid-row:3; width:100%; min-width:0; max-width:none; align-self:start }
      :host(.popup-surface) .popup-overview-layout .active-task-strip.is-active .running-status-stats { grid-column:2; grid-row:1/span 2; justify-self:end; align-self:start; margin:0 }
      :host(.popup-surface) .popup-overview-layout .active-task-strip.is-active > .danger { box-sizing:border-box; grid-column:2; grid-row:3; justify-self:stretch; align-self:start; width:100% }
      @media(max-width:520px) { :host(.popup-surface) .popup-overview-layout .active-task-strip.is-active .strip-description { min-height:44px } :host(.popup-surface) .popup-overview-layout .active-task-strip.is-active > .danger { min-height:44px } }
      @media(max-width:359px) { :host(.popup-surface) .popup-overview-layout .active-task-strip.is-active .strip-task-copy { grid-column:1/span 2 } :host(.popup-surface) .popup-overview-layout .active-task-strip.is-active .strip-description-field { grid-column:1/span 2 } :host(.popup-surface) .popup-overview-layout .active-task-strip.is-active .running-status-stats { grid-row:4 } :host(.popup-surface) .popup-overview-layout .active-task-strip.is-active > .danger { grid-row:5 } }
      :host(.popup-surface) .popup-overview-layout .active-task-strip .running-status-quick-start { flex-wrap:wrap; gap:6px }
      :host(.popup-surface) .popup-overview-layout .active-task-strip .running-status-recent-task { flex:0 0 145px }
      :host(.popup-surface) .popup-overview-layout .active-task-strip:not(.is-active) { display:grid; grid-template-columns:minmax(0,1fr); gap:8px; align-items:start }
      :host(.popup-surface) .strip-idle-status { display:flex; flex-direction:column; align-items:flex-start; gap:4px }
      :host(.popup-surface) .strip-idle { padding:4px 8px; border-radius:999px; background:var(--bgColor-muted,var(--ck-bg-muted)); text-transform:uppercase }
      :host(.popup-surface) .strip-idle-caption { color:var(--fgColor-muted,var(--ck-fg-muted)); font-size:11px }
      :host(.popup-surface) .popup-overview-layout .active-task-strip:not(.is-active) .running-status-quick-start { display:grid; grid-template-columns:minmax(0,1fr); width:100% }
      :host(.popup-surface) .popup-overview-layout .active-task-strip:not(.is-active) .running-status-recent { width:100% }
      /* Keep the toolbar popup's Activity hierarchy within its scrollable width. */
      :host(.popup-surface) .popup-overview-layout .activity-weekly-summary { margin-bottom:10px; padding:12px }
      :host(.popup-surface) .popup-overview-layout .activity-weekly-label { display:none }
      :host(.popup-surface) .popup-overview-layout .activity-weekly-range { display:block; font-size:14px }
      :host(.popup-surface) .popup-overview-layout .activity-weekly-cards { grid-template-columns:repeat(3,minmax(0,1fr)); gap:4px }
      :host(.popup-surface) .popup-overview-layout .activity-weekly-card { padding:0 4px; border:0; border-right:1px solid var(--borderColor-muted,var(--ck-border-muted)) }
      :host(.popup-surface) .popup-overview-layout .activity-weekly-card:last-child { border-right:0 }
      :host(.popup-surface) .popup-overview-layout .activity-weekly-copy { flex-direction:column; align-items:flex-start; gap:0 }
      :host(.popup-surface) .popup-overview-layout .activity-weekly-value { font-size:16px }
      :host(.popup-surface) .popup-overview-layout .activity-weekly-name { font-size:10px }
      :host(.popup-surface) .popup-timeline-section { padding-top:16px }
      :host(.popup-surface) .popup-timeline-section[hidden],:host(.popup-surface) .popup-list-toolbar[hidden] { display:none }
      :host(.popup-surface) .timeline-shell > .week-navigation { position:absolute; z-index:30; inset:0 0 auto; grid-template-columns:1fr 1fr; height:84px; min-height:0; margin:0; padding:0 6px; border:0; pointer-events:none }
      :host(.popup-surface) .timeline-shell.calendar-week-navigation > .week-navigation { height:44px }
      :host(.popup-surface) .timeline-shell > .week-navigation .week-navigation-label { display:none }
      :host(.popup-surface) .timeline-shell > .week-navigation::before,:host(.popup-surface) .timeline-shell > .week-navigation::after { content:""; position:absolute; inset-block:0; width:55px; pointer-events:none }
      :host(.popup-surface) .timeline-shell > .week-navigation::before { left:0; background:linear-gradient(90deg,color-mix(in srgb,var(--bgColor-muted,var(--ck-bg-muted)) 90%,var(--fgColor-muted,var(--ck-fg-muted))),transparent) }
      :host(.popup-surface) .timeline-shell > .week-navigation::after { right:0; background:linear-gradient(270deg,color-mix(in srgb,var(--bgColor-muted,var(--ck-bg-muted)) 90%,var(--fgColor-muted,var(--ck-fg-muted))),transparent) }
      :host(.popup-surface) .timeline-shell > .week-navigation .week-navigation-button { position:relative; z-index:1; pointer-events:auto }
      :host(.popup-surface) .popup-list-toolbar { display:grid; grid-template-columns:minmax(0,1fr) 40px; align-items:center; gap:8px; min-width:0; margin:16px 12px 12px }
      :host(.popup-surface) .popup-list-toolbar .times-filter { position:relative; grid-column:1/-1; min-width:0; margin:0 }
      :host(.popup-surface) .popup-list-toolbar .times-filter svg { position:absolute; top:50%; left:12px; transform:translateY(-50%); color:var(--fgColor-muted,var(--ck-fg-muted)); pointer-events:none }
      :host(.popup-surface) .popup-list-toolbar .times-filter input { box-sizing:border-box; min-height:44px; margin:0; padding-left:38px; border-radius:8px; background:var(--bgColor-muted,var(--ck-bg-muted)) }
      :host(.popup-surface) .popup-list-toolbar .week-navigation { grid-column:1; grid-row:2; grid-template-columns:40px auto 40px; justify-self:end; width:max-content; max-width:100%; min-width:0; min-height:0; margin:0; padding:0; border:0; gap:8px }
      :host(.popup-surface) .popup-list-toolbar .week-navigation-label { box-sizing:border-box; display:flex; align-items:center; justify-content:center; overflow:hidden; height:40px; padding:0 8px; border:1px solid var(--borderColor-muted,var(--ck-border-muted)); border-radius:8px; color:var(--fgColor-muted,var(--ck-fg-muted)); text-align:center; text-overflow:ellipsis }
      :host(.popup-surface) .popup-list-toolbar .week-navigation-button { width:40px; height:40px; border-radius:8px }
      :host(.popup-surface) .popup-list-toolbar .times-refresh { grid-column:2; grid-row:2; width:40px; height:40px; border:1px solid var(--borderColor-default,var(--ck-border)); border-radius:8px; background:var(--bgColor-muted,var(--ck-bg-muted)) }
      :host(.popup-surface) .today-list { margin:0 12px 16px }
      :host(.popup-surface) .activity-list .entry { margin:0 0 12px; border:0; background:transparent }
      :host(.popup-surface) .activity-list .entry-record,:host(.popup-surface) .activity-list .entry-record.entry-overlap { margin:8px 0 0; padding:12px 14px; border:1px solid var(--borderColor-muted,var(--ck-border-muted)); border-radius:10px; background:var(--bgColor-muted,var(--ck-bg-muted)) }
      :host(.popup-surface) .activity-list .entry-record + .entry-record { margin-top:8px }
      :host(.popup-surface) .activity-list .entry-record:last-child { border-bottom:1px solid var(--borderColor-muted,var(--ck-border-muted)); border-radius:10px }
      :host(.popup-surface) .activity-list .entry-actions { position:static; margin:10px 0 0 27px; opacity:1; transform:none; pointer-events:auto }
      :host(.popup-surface) .times-search-pagination { display:flex; flex-wrap:wrap; justify-content:center; gap:8px; margin:16px 0; font-size:12px }
      @media(max-width:520px) { :host(.full-width-popup-surface) .tracker-toolbar { grid-template-columns:minmax(0,1fr) auto; grid-template-areas:"brand end" "stats stats" "nav nav" } :host(.full-width-popup-surface) .tracker-toolbar .activity-weekly-summary { width:100%; justify-content:space-between } :host(.full-width-popup-surface) .tracker-toolbar .activity-weekly-cards { justify-content:space-between; flex:1 } :host(.full-width-popup-surface) .popup-overview-layout .active-task-strip .running-status-quick-start { flex-wrap:wrap; gap:6px } :host(.full-width-popup-surface) .popup-overview-layout .active-task-strip .running-status-recent-task { flex:0 0 145px } }
      /* The injected page panel uses the same Activity hierarchy, not toolbar chrome. */
      :host(.full-width-popup-surface) .tracker-toolbar { grid-template-areas:none; grid-template-columns:auto minmax(0,1fr) auto; gap:12px; padding-block:10px }
      :host(.full-width-popup-surface) .timeline-brand,:host(.full-width-popup-surface) .header-actions,:host(.full-width-popup-surface) .timeline-toolbar-end { grid-area:auto }
      :host(.full-width-popup-surface) .header-actions { justify-self:center }
      :host(.full-width-popup-surface) .timeline-toolbar-end { justify-self:end }
      :host(.full-width-popup-surface) .popup-overview-layout,:host(.full-width-popup-surface[data-clockoli-width="full"]) .popup-overview-layout { display:grid; grid-template-columns:minmax(190px,1fr) minmax(0,7fr); align-items:stretch; gap:12px; margin:14px auto 0 }
      :host(.full-width-popup-surface) .popup-overview-layout .activity-weekly-summary { padding:12px 14px; background:var(--bgColor-muted,var(--ck-bg-muted)) }
      :host(.full-width-popup-surface) .popup-overview-layout .activity-weekly-heading { margin:0 0 6px; font-size:13px }
      :host(.full-width-popup-surface) .popup-overview-layout .activity-weekly-label { display:none }
      :host(.full-width-popup-surface) .popup-overview-layout .activity-weekly-range { display:block }
      :host(.full-width-popup-surface) .popup-overview-layout .activity-weekly-card { padding:5px 0; border-bottom:1px solid var(--borderColor-muted,var(--ck-border-muted)) }
      :host(.full-width-popup-surface) .popup-overview-layout .activity-weekly-card:last-child { border-bottom:0 }
      :host(.full-width-popup-surface) .popup-overview-layout .activity-weekly-copy { flex-direction:row-reverse; justify-content:space-between; font-size:14px }
      :host(.full-width-popup-surface) .popup-overview-layout .activity-weekly-value { font-size:13px }
      :host(.full-width-popup-surface) .popup-overview-layout .activity-weekly-name { font-size:11px }
      :host(.full-width-popup-surface) .popup-overview-layout .active-task-strip:not(.is-active) { min-height:84px; padding:12px 24px; gap:14px }
      :host(.full-width-popup-surface) .strip-idle-status { display:flex; flex-direction:column; flex:none; gap:4px; min-width:150px; padding-right:20px; border-right:1px solid var(--borderColor-muted,var(--ck-border-muted)) }
      :host(.full-width-popup-surface) .strip-idle { align-self:flex-start; padding:4px 8px; border-radius:999px; background:var(--bgColor-muted,var(--ck-bg-muted)); text-transform:uppercase }
      :host(.full-width-popup-surface) .strip-idle-caption { color:var(--fgColor-muted,var(--ck-fg-muted)); font-size:12px }
      :host(.full-width-popup-surface) .popup-timeline-section { padding-top:24px }
      :host(.full-width-popup-surface) .popup-timeline-section[hidden],:host(.full-width-popup-surface) .popup-list-toolbar[hidden] { display:none }
      :host(.full-width-popup-surface) .timeline-shell > .week-navigation { position:absolute; z-index:30; inset:0 0 auto; grid-template-columns:1fr 1fr; height:84px; min-height:0; margin:0; padding:0 12px; border:0; pointer-events:none }
      :host(.full-width-popup-surface) .timeline-shell.calendar-week-navigation > .week-navigation { height:44px }
      :host(.full-width-popup-surface) .timeline-shell > .week-navigation .week-navigation-label { display:none }
      :host(.full-width-popup-surface) .timeline-shell > .week-navigation::before,:host(.full-width-popup-surface) .timeline-shell > .week-navigation::after { content:""; position:absolute; inset-block:0; width:90px; pointer-events:none }
      :host(.full-width-popup-surface) .timeline-shell > .week-navigation::before { left:0; background:linear-gradient(90deg,color-mix(in srgb,var(--bgColor-muted,var(--ck-bg-muted)) 90%,var(--fgColor-muted,var(--ck-fg-muted))),transparent) }
      :host(.full-width-popup-surface) .timeline-shell > .week-navigation::after { right:0; background:linear-gradient(270deg,color-mix(in srgb,var(--bgColor-muted,var(--ck-bg-muted)) 90%,var(--fgColor-muted,var(--ck-fg-muted))),transparent) }
      :host(.full-width-popup-surface) .timeline-shell > .week-navigation .week-navigation-button { position:relative; z-index:1; min-width:44px; min-height:40px; border-radius:8px; pointer-events:auto }
      :host(.full-width-popup-surface) .timeline-shell.calendar-week-navigation > .week-navigation .week-navigation-button { min-width:30px; min-height:30px }
      :host(.full-width-popup-surface) .popup-list-toolbar { box-sizing:border-box; display:grid; grid-template-columns:minmax(0,1fr) auto auto; align-items:center; gap:16px; width:calc(100% - 2 * var(--clockoli-gutter)); margin:24px auto 20px }
      :host(.full-width-popup-surface) .popup-list-toolbar .times-filter { position:relative; min-width:0; margin:0 }
      :host(.full-width-popup-surface) .popup-list-toolbar .times-filter svg { position:absolute; top:50%; left:16px; transform:translateY(-50%); color:var(--fgColor-muted,var(--ck-fg-muted)); pointer-events:none }
      :host(.full-width-popup-surface) .popup-list-toolbar .times-filter input { box-sizing:border-box; min-height:50px; margin:0; padding-left:44px; border-radius:8px; background:var(--bgColor-muted,var(--ck-bg-muted)) }
      :host(.full-width-popup-surface) .popup-list-toolbar .week-navigation { grid-template-columns:46px auto 46px; gap:12px; width:auto; min-height:0; margin:0; padding:0; border:0 }
      :host(.full-width-popup-surface) .popup-list-toolbar .week-navigation-label { padding:11px 14px; border:1px solid var(--borderColor-muted,var(--ck-border-muted)); border-radius:8px; font-size:14px }
      :host(.full-width-popup-surface) .popup-list-toolbar .week-navigation-button { width:46px; height:50px; border-radius:8px }
      :host(.full-width-popup-surface) .popup-list-toolbar .times-refresh { width:50px; height:50px; border:1px solid var(--borderColor-default,var(--ck-border)); border-radius:8px; background:var(--bgColor-muted,var(--ck-bg-muted)) }
      :host(.full-width-popup-surface) .today-list { padding-bottom:16px }
      :host(.full-width-popup-surface) .activity-list .entry { margin-bottom:12px; border:0; background:transparent }
      :host(.full-width-popup-surface) .activity-list .entry-record,:host(.full-width-popup-surface) .activity-list .entry-record.entry-overlap { margin:10px 12px 0; padding:12px 110px 12px 14px; border:1px solid var(--borderColor-muted,var(--ck-border-muted)); border-radius:10px; background:var(--bgColor-muted,var(--ck-bg-muted)) }
      :host(.full-width-popup-surface) .activity-list .entry-record + .entry-record { margin-top:10px }
      :host(.full-width-popup-surface) .activity-list .entry-record:last-child { border-bottom:1px solid var(--borderColor-muted,var(--ck-border-muted)); border-radius:10px }
      @media(max-width:900px) { :host(.full-width-popup-surface) .popup-overview-layout,:host(.full-width-popup-surface[data-clockoli-width="full"]) .popup-overview-layout { grid-template-columns:minmax(0,1fr) } :host(.full-width-popup-surface) .popup-overview-layout .active-task-strip:not(.is-active) { min-height:110px } :host(.full-width-popup-surface) .tracker-toolbar { grid-template-areas:"brand end" "nav nav"; grid-template-columns:minmax(0,1fr) auto } :host(.full-width-popup-surface) .timeline-brand { grid-area:brand } :host(.full-width-popup-surface) .header-actions { grid-area:nav; justify-self:stretch } :host(.full-width-popup-surface) .timeline-toolbar-end { grid-area:end } }
      @media(max-width:700px) { :host(.full-width-popup-surface) .popup-list-toolbar { grid-template-columns:minmax(0,1fr) auto; gap:10px } :host(.full-width-popup-surface) .popup-list-toolbar .times-filter { grid-column:1/-1 } :host(.full-width-popup-surface) .popup-list-toolbar .week-navigation { grid-column:1; justify-self:start; gap:8px } :host(.full-width-popup-surface) .popup-list-toolbar .times-refresh { grid-column:2 } :host(.full-width-popup-surface) .activity-list .entry-record,:host(.full-width-popup-surface) .activity-list .entry-record.entry-overlap { padding-right:14px } :host(.full-width-popup-surface) .activity-list .entry-actions { position:static; margin:10px 0 0 27px; opacity:1; transform:none; pointer-events:auto } }
    `;
    if (fullWidthPopupOpen) {
      if (preserveFullWidthTimeline) refreshMountedTimeline();
      else renderFullWidthPopup(style);
    }
    if (fullWidthPopupOpen) startPanelClock();
    if (!shadow || !root?.isConnected) return;
    if (timesMode) {
      shadow.append(style, renderTimesPage(preservedActivityTimeline));
      updateActivityWeekSummary();
      if (preservedActivityTimeline) {
        refreshMountedTimeline();
        timelineInstance.restoreCalendarScroll?.(preservedActivityCalendarScroll);
      }
      return;
    }
    if (popupMode) { shadow.append(style, renderMenu()); updateActivityWeekSummary(); restoreMenuScroll(preservedMenuScrollTop); return; }
    const current = taskFromLocation();
    const currentRunning = sameTask(taskFromLocation(), pageState.active);
    const main = el('button', undefined, `trigger trigger-main${pageState.active ? ' running' : ''}${currentRunning ? ' running-current' : ''}`); main.type = 'button';
    main.setAttribute('aria-label', pageState.active ? `Time tracker running: ${formatElapsed(pageState.active.startedAt)}` : 'Time tracker');
    main.setAttribute('aria-haspopup', 'dialog'); main.setAttribute('aria-expanded', String(fullWidthPopupOpen));
    main.title = pageState.active ? 'Time tracker is running' : 'Open time tracker'; main.append(clockoliMark(22));
    main.addEventListener('click', async event => {
      if (!event.isTrusted) return;
      await toggleFullWidthPopup();
    });
    shadow.append(style, main);
    restoreMenuScroll(preservedMenuScrollTop);
  }

  async function render(refresh = false) {
    if (location.protocol !== 'https:' || location.hostname !== 'github.com') { root?.remove(); root = null; shadow = null; menuOpen = false; return; }
    if (!mountInHeader()) return;
    renderUi();
    try { applyPageState(await send({ type: 'GET_PAGE_STATE', refresh: false })); errorText = ''; }
    catch (error) { errorText = error.message; errorCode = error.code || 'error'; }
    actionAnimationReady = true;
    renderUi();
    if ((menuOpen || fullWidthPopupOpen) && pageState.configured) {
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
    const route = projectPaneIssueUrl(location.href) || `https://github.com${location.pathname}`;
    if (route !== lastRoute) {
      const firstRender = lastRoute === null;
      lastRoute = route; recent = []; recentLoaded = false; recentFresh = false; recentFreshAfterPendingId = null; cancelActiveInlineDraft(); menuOpen = false; menuScrollTop = 0;
      participantLoadId += 1; clearClockoliParticipantRetry(); participantData = null; scheduleClockoliParticipantAugmentation();
      void render(firstRender);
      void refreshClockoliParticipants();
    } else if (route) {
      const target = headerTarget();
      if (!root?.isConnected || !target || root.parentElement !== target.actions || root.nextElementSibling !== target.anchor) void render(false);
      if (participantData?.participants?.some(value => value.activeStartedAt)) scheduleClockoliParticipantAugmentation();
    }
  }

  function handleLocalPreferencesChanged(message) {
    if (message?.type !== 'LOCAL_PREFERENCES_CHANGED') return false;
    void send({ type: 'GET_PAGE_STATE', refresh: false }).then(data => {
      applyPageState(data);
      if (Array.isArray(data?.recent)) applyMenuData(data.recent, recentFresh);
      renderUi();
    }).catch(setError);
    return true;
  }

  function handleDocumentClick(event) {
    const path = event.composedPath();
    if (fullWidthPopupOpen && !path.includes(fullWidthPopupRoot) && !path.includes(root) && !path.includes(timeEntryFormHost)) {
      closeFullWidthPopup({ restoreFocus: false });
    }
    if (menuOpen && !path.includes(root)) closeMenu();
  }

  if (!extensionPageMode) globalThis.ClockoliInstantTooltips?.attach(document, { selector: '.clockoli-participant-time' });
  if (!popupMode && !timesMode) document.addEventListener('visibilitychange', () => {
    if (document.hidden && fullWidthPopupOpen) closeFullWidthPopup({ restoreFocus: false });
    if (!actionSurfaceMode) updateTaskAnimation();
  });
  if (!popupMode && !timesMode) globalThis.addEventListener?.('blur', () => {
    if (fullWidthPopupOpen) closeFullWidthPopup({ restoreFocus: false });
  });

  if (timesMode) {
    document.addEventListener('clockoli:local-tracking-changed', event => {
      const detail = event.detail ?? {};
      if (detail.type === 'STOP' && detail.completion?.entry?.id) {
        rememberCompletedLocally(detail.completion, detail.completion.destinationId);
        mergeLocalPendingActivity([{
          ...detail.completion.entry, ...(detail.completion.localEntry ?? {}),
          destinationId: detail.completion.destinationId,
          _pending: Boolean(detail.completion.pending),
        }]);
        pageState = { ...pageState, active: null };
      } else if (['START', 'EDIT_ACTIVE_START'].includes(detail.type) && detail.active?.id) {
        pageState = { ...pageState, active: detail.active };
      } else return;
      if (!refreshMountedTimeline() || activityViewMode === 'list') renderUi();
      void refreshActivityState().catch(setError);
    });
    document.addEventListener('clockoli:local-time-added', event => {
      const result = event.detail ?? {};
      if (result.entry?.id) {
        recent = mergeActivityRecords([{ ...result.entry, destinationId: result.destinationId }], timesRange(), true);
        recentLoaded = true;
      }
      if (result.active?.id) {
        pageState = { ...pageState, active: { ...result.active, destinationId: result.destinationId } };
      }
      renderUi();
      void refreshActivityState().catch(setError);
    });
    mountInHeader();
    void restoreActivityViewMode();
    void loadSelectedTimes();
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) void refreshRecent(true).then(refreshActivityState).catch(setError);
    });
    setInterval(() => {
      if (!document.hidden) void refreshActivityState().catch(setError);
    }, 5_000);
  } else if (popupMode) {
    menuOpen = true;
    mountInHeader();
    renderUi();
    void restoreActivityViewMode();
    refreshPopupTask().then(async () => {
      applyPageState(await send({ type: 'GET_PAGE_STATE', refresh: false }));
      renderUi();
      let recentReady = false;
      if (pageState.configured) {
        try { recentReady = (await refreshRecent())?.configured === true; }
        catch (error) { setError(error); }
      }
      // LOAD_RECENT already refreshes the records, active timer and pending writes.
      // Do not block the editable full-week view on a second remote state refresh.
      if (!recentReady) {
        try { applyPageState(await send({ type: 'GET_PAGE_STATE', refresh: true })); }
        catch (error) { setError(error); return; }
        renderUi();
      }
      if (pageState.configured) await loadActivityCalendarWeek(weekWindow());
    }).catch(setError);
  } else if (actionSurfaceMode) {
    if (chrome.runtime.onMessage?.addListener) chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (handleLocalPreferencesChanged(message)) return undefined;
      if (message?.type === 'DISMISS_FULL_WIDTH_POPUP') {
        if (fullWidthPopupOpen) closeFullWidthPopup({ restoreFocus: false });
        return undefined;
      }
      if (message?.type !== 'TOGGLE_FULL_WIDTH_POPUP') return undefined;
      void toggleFullWidthPopup().then(opened => sendResponse({ ok: true, opened })).catch(error => sendResponse({ ok: false, error: error.message }));
      return true;
    });
    document.addEventListener('click', handleDocumentClick);
    document.addEventListener('keydown', event => {
      if (fullWidthPopupOpen && event.key === 'Escape' && !event.defaultPrevented && !timeEntryFormDialog?.open) closeFullWidthPopup();
    });
    void toggleFullWidthPopup();
  } else {
    if (chrome.runtime.onMessage?.addListener) chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (handleLocalPreferencesChanged(message)) return undefined;
      if (message?.type === 'DISMISS_FULL_WIDTH_POPUP') {
        if (fullWidthPopupOpen) closeFullWidthPopup({ restoreFocus: false });
        return undefined;
      }
      if (message?.type !== 'TOGGLE_FULL_WIDTH_POPUP') return undefined;
      void toggleFullWidthPopup().then(opened => sendResponse({ ok: true, opened })).catch(error => sendResponse({ ok: false, error: error.message }));
      return true;
    });
    document.addEventListener('click', handleDocumentClick);
    document.addEventListener('keydown', event => {
      if (fullWidthPopupOpen && event.key === 'Escape' && !event.defaultPrevented && !timeEntryFormDialog?.open) { closeFullWidthPopup(); return; }
      if (menuOpen && event.key === 'Escape' && !event.defaultPrevented) closeMenu();
    });
    motionPreference?.addEventListener?.('change', updateTaskAnimation);
    watchClockoliTimeline();
    navigationCheck();
    navigationTimer = setInterval(() => { if (extensionContextActive) navigationCheck(); }, 750);
  }
})();
