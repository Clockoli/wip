(() => {
  const ROOT_ID = 'clockoli-root';
  const POPUP_ROOT_ID = 'clockoli-popup-root';
  const TIMES_ROOT_ID = 'clockoli-times-root';
  const timesMode = location.protocol === 'chrome-extension:' && location.pathname.endsWith('/src/times/times.html');
  const popupMode = location.protocol === 'chrome-extension:' && !timesMode;
  const actionSurfaceMode = globalThis.__CLOCKOLI_ACTION_SURFACE__ === true;
  const STOPWATCH_PATH = 'M5.75.75A.75.75 0 0 1 6.5 0h3a.75.75 0 0 1 0 1.5h-.75v1l-.001.041a6.724 6.724 0 0 1 3.464 1.435l.007-.006.75-.75a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734l-.75.75-.006.007a6.75 6.75 0 1 1-10.548 0L2.72 5.03l-.75-.75a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018l.75.75.007.006A6.72 6.72 0 0 1 7.25 2.541V1.5H6.5a.75.75 0 0 1-.75-.75ZM8 14.5a5.25 5.25 0 1 0-.001-10.501A5.25 5.25 0 0 0 8 14.5Zm.389-6.7 1.33-1.33a.75.75 0 1 1 1.061 1.06L9.45 8.861A1.503 1.503 0 0 1 8 10.75a1.499 1.499 0 1 1 .389-2.95Z';
  const TRIANGLE_PATH = 'm4.427 7.427 3.396 3.396a.25.25 0 0 0 .354 0l3.396-3.396A.25.25 0 0 0 11.396 7H4.604a.25.25 0 0 0-.177.427Z';
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
  let timelineInstance = null;
  let timelineWindow = null;
  let timelineEntriesById = new Map();
  let timelineQueueIndicator = null;
  let timelineSaving = false;
  let timelineOptimisticEdits = new Map();
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
  const queueDiagnostics = [];

  let menuOpen = false, menuScrollTop = 0;
  let navigationOpen = false;
  let descriptionDraft = null;
  let pageState = { configured: null, active: null, pendingCount: 0, pendingWrites: [], projects: [] };
  let recent = [];
  let recentLoaded = false;
  let recentFresh = false;
  let recentFreshAfterPendingId = null;
  let loadingRecent = false;
  let suppressRecentRender = false;
  let recentLoad = null;
  let recentLoadId = 0;
  let timesLoadId = 0;
  let activeInlineKey = null;
  let timesPeriod = 'last-three-days';
  let timesStartDate = '';
  let timesEndDate = '';
  let timesFilter = '';
  let timesHasTrackedTime = null;
  let bulkDraft = '';
  let bulkMutation = false;
  let bulkOpen = false;
  const ACTIVITY_HISTORY_RANGE = { startDate: '0001-01-01', endDate: '9999-12-31' };
  const inlineDrafts = new Map();
  const inlineEditors = new Map();
  const inlineBoundaryLinks = new Map();
  let errorText = '';
  let errorCode = '';
  let todayReportDate = '';
  let summaryUpdatedAt = 0;
  let summaryActive = null;
  let connectionError = null;
  let compactSurface = null;
  let popupReturnFocus = null;
  let popupFocusPending = false;
  let popupPageHint = false;
  const LONG_ENTRY_HOURS = 12;
  const HOUR_MS = 3_600_000;
  const PANEL_TICK_MS = 1_000;
  const resolveTaskColor = globalThis.ElasticTimelineEditor?.createColorResolver?.();
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
  function taskFromLocation() { return timesMode ? null : popupMode ? popupTask : taskFromUrl(location.href, titleFromPage()); }
  function sameTask(left, right) { const a = taskUrlOf(left), b = taskUrlOf(right); return Boolean(a && b && a === b); }
  function projectNameForUrl(url, projects = []) {
    const candidate = String(url || '').toLowerCase();
    for (const project of projects || []) {
      if ((project.substrings || []).some(substring => candidate.includes(String(substring).toLowerCase()))) return project.name;
    }
    return 'Other';
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
      label.title = `${value.login} tracked ${duration}${value.activeStartedAt ? ', including the active timer' : ''}`;
      label.setAttribute('aria-label', label.title);
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
    popupTask = taskFromUrl(tab?.url, tab?.title || '');
    return popupTask;
  }

  function send(message) {
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

  function timesRange() {
    const today = new Date(), endToday = localDateValue(today), start = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12);
    const date = value => localDateValue(value), move = days => { const value = new Date(start); value.setDate(value.getDate() + days); return value; };
    if (timesPeriod === 'last-three-days') return { startDate: date(move(-2)), endDate: endToday };
    if (timesPeriod === 'today') return { startDate: endToday, endDate: endToday };
    if (timesPeriod === 'yesterday') { const value = date(move(-1)); return { startDate: value, endDate: value }; }
    const mondayOffset = (today.getDay() + 6) % 7;
    if (timesPeriod === 'this-week') return { startDate: date(move(-mondayOffset)), endDate: endToday };
    if (timesPeriod === 'last-week') return { startDate: date(move(-mondayOffset - 7)), endDate: date(move(-mondayOffset - 1)) };
    if (timesPeriod === 'this-month') return { startDate: `${endToday.slice(0, 7)}-01`, endDate: endToday };
    if (timesPeriod === 'last-month') {
      const last = new Date(today.getFullYear(), today.getMonth(), 0, 12), first = new Date(last.getFullYear(), last.getMonth(), 1, 12);
      return { startDate: date(first), endDate: date(last) };
    }
    if (timesPeriod === 'custom' && validEntryDate(timesStartDate) && validEntryDate(timesEndDate) && timesStartDate <= timesEndDate) return { startDate: timesStartDate, endDate: timesEndDate };
    throw new Error('Choose a valid custom date range.');
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
    recent = Array.isArray(data) ? data : data?.recent ?? [];
    todayReportDate = Array.isArray(data) ? localDateValue() : data?.reportDate || '';
    if (!Array.isArray(data)) {
      pageState = reconcileTimelineAcceptedActive({
        ...pageState, configured: data?.configured !== false, active: data?.active ?? null,
        pendingCount: Math.max(0, Number(data?.pendingCount) || 0), pendingWrites: data?.pendingWrites ?? [],
      });
      applyTrackedTotals(data);
      const pendingIds = new Set(pageState.pendingWrites.map(item => item.id));
      reconcileQueuedInlineOperations(pendingIds);
      for (const [id, entryId] of timelineQueuedOperationIds) if (!pendingIds.has(id)) {
        timelineQueuedOperationIds.delete(id);
        timelineOptimisticEdits.delete(entryId);
      }
    }
    for (const [entryId] of timelineOptimisticCompletions) {
      if (recent.some(entry => entry.id === entryId && entry._sha && !entry._pending)) timelineOptimisticCompletions.delete(entryId);
    }
    refreshTimelineQueueIndicator();
    recentLoaded = true;
    recentFresh = fresh;
  }

  function applyPageState(data) {
    if (pageState.configured == null) { errorText = ''; errorCode = ''; connectionError = null; }
    const previousParticipantState = `${taskUrlOf(pageState.active) || ''}:${pageState.active?.startedAt || ''}:${pageState.pendingCount || 0}`;
    recordQueueDiagnostics(pageState.pendingWrites, data?.pendingWrites ?? []);
    pageState = reconcileTimelineAcceptedActive(data);
    applyTrackedTotals(data);
    const pendingIds = new Set(pageState.pendingWrites?.map(item => item.id) ?? []);
    reconcileQueuedInlineOperations(pendingIds);
    for (const [id, entryId] of timelineQueuedOperationIds) if (!pendingIds.has(id)) {
      timelineQueuedOperationIds.delete(id);
      timelineOptimisticEdits.delete(entryId);
    }
    if (Array.isArray(data?.recent)) applyMenuData(data.recent, recentFresh);
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

  function recordQueueDiagnostics(previous, next) {
    const before = new Map((previous ?? []).map(item => [item.id, item]));
    const after = new Map((next ?? []).map(item => [item.id, item]));
    const append = message => queueDiagnostics.push({ at: new Date().toISOString(), message: safeQueueDetail(message) });
    for (const item of next ?? []) {
      const prior = before.get(item.id), label = queueOperationLabel(item);
      if (!prior) append(`${label}: queued${item.queuedAt ? ` at ${item.queuedAt}` : ''}.`);
      else if (queueOperationSignature(prior) !== queueOperationSignature(item)) {
        const attempt = Number(item.retryCount) ? ` Attempt ${item.retryCount}.` : '';
        const detail = item.lastError ? ` ${safeQueueDetail(item.lastError)}` : '';
        append(`${label}: ${item.status || 'pending'} at ${item.stage || item.operation || 'queued'}.${attempt}${detail}`);
      }
    }
    for (const item of previous ?? []) if (!after.has(item.id)) append(`${queueOperationLabel(item)}: synced.`);
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
    const retryableConflict = !String(first.conflictReason || '').startsWith('queued_write_');
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
        const data = await send({ type: 'GET_PAGE_STATE' });
        applyPageState(data);
        if (Array.isArray(data?.recent)) applyMenuData(data.recent, recentFresh);
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

  function mountInHeader() {
    if (popupMode || timesMode) {
      root = root || document.getElementById(timesMode ? TIMES_ROOT_ID : POPUP_ROOT_ID);
      if (!root) return false;
      root.classList.add(timesMode ? 'times-surface' : 'popup-surface');
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

  function setError(error = '') { if (isExtensionContextInvalidated(error)) { deactivateExtensionContext(); return; } errorText = error?.message || String(error || ''); errorCode = error?.code || ''; connectionError = errorText ? { ...error, message: errorText, code: errorCode } : null; renderUi(); }

  function closeMenu() { menuOpen = false; menuScrollTop = 0; navigationOpen = false; cancelActiveInlineDraft(); if (pageState.configured != null) { errorText = ''; errorCode = ''; } renderUi(); }

  function originalRecord(entry) { return { id: entry.id, taskUrl: taskUrlOf(entry), taskTitle: taskTitleOf(entry), issueUrl: taskUrlOf(entry), issueTitle: taskTitleOf(entry), startedAt: entry.startedAt, endedAt: entry.endedAt, description: entry.description || '' }; }

  function sameRecord(left, right) {
    const a = originalRecord(left), b = originalRecord(right);
    return a.id === b.id && a.issueUrl === b.issueUrl && a.issueTitle === b.issueTitle && a.startedAt === b.startedAt && a.endedAt === b.endedAt && a.description === b.description;
  }

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
    const required = [
      '_index', '_path', '_sha', 'actor', 'createdAt', 'description', 'durationSeconds', 'endedAt', 'entryDate',
      'id', 'issueTitle', 'metadata', 'metrics', 'producer', 'schemaVersion', 'startedAt', 'taskTitle', 'taskUrl',
      'timezone', 'updatedAt', 'user',
    ];
    const allowed = new Set([...required, '_record', 'entryId', 'execution', 'issue']);
    const identity = value => value && typeof value === 'object' && !Array.isArray(value)
      && ['kind', 'id', 'name'].every(key => typeof value[key] === 'string' && value[key].trim());
    const producer = value => value && typeof value === 'object' && !Array.isArray(value)
      && ['kind', 'name', 'version'].every(key => typeof value[key] === 'string' && value[key].trim());
    const object = value => value && typeof value === 'object' && !Array.isArray(value);
    const validId = value => typeof value === 'string' && /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(value);
    let timezoneOk = false;
    try { new Intl.DateTimeFormat('en-US', { timeZone: item?.timezone }).format(new Date(0)); timezoneOk = true; } catch {}
    if (!item || typeof item !== 'object' || Object.keys(item).some(key => !allowed.has(key)) || required.some(key => !(key in item)) || item.schemaVersion !== 1
        || !validId(item.id) || (item.entryId !== undefined && item.entryId !== item.id)
        || item._index !== position || item._path !== path || typeof item._sha !== 'string' || !item._sha || (sha && item._sha !== sha)
        || typeof item.user !== 'string' || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(item.user)
        || !identity(item.actor) || !producer(item.producer) || !object(item.metadata) || !object(item.metrics) || !timezoneOk
        || !taskUrlOf(item) || (item.issue && (!validIssue(item.issue) || item.issue.url !== item.taskUrl))
        || !validEntryDate(item.entryDate) || !validTimestamp(item.startedAt) || !validTimestamp(item.endedAt)
        || !validTimestamp(item.createdAt) || !validTimestamp(item.updatedAt) || new Date(item.updatedAt) < new Date(item.createdAt)
        || typeof item.taskTitle !== 'string' || item.taskTitle.length > 300 || item.issueTitle !== item.taskTitle
        || item.taskTitle !== item.taskTitle.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim()
        || typeof item.description !== 'string' || item.description.length > 2000
        || (item._record !== undefined && (!object(item._record) || item._record.schema_version !== 1 || item._record.id !== item.id))) return false;
    const pathMatch = path.match(/^times\/(\d{4}-(?:0[1-9]|1[0-2]))\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)\.jsonl$/);
    if (!pathMatch || pathMatch[1] !== item.entryDate.slice(0, 7) || pathMatch[2] !== item.user
        || timestampParts(item.startedAt, item.timezone).date !== item.entryDate) return false;
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

  function refreshRecent(force = false) {
    if (recentLoad && !force) return recentLoad;
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
      if (loadId === recentLoadId) applyMenuData(data, true);
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

  async function deleteRecentEntry(entry, node) {
    if (!confirm(`Delete this ${formatDuration(entry.durationSeconds)} entry?`)) return;
    const controls = node ? Array.from(node.parentElement?.children ?? [node]) : [];
    for (const control of controls) control.disabled = true;
    try {
      const result = await send({ type: 'DELETE_ENTRY', payload: { path: entry._path, originalSha: entry._sha, index: entry._index, original: originalRecord(entry) } });
      activeInlineKey = null;
      pageState = { ...pageState, todayTrackedMs: null, weekTrackedMs: null };
      const reconciled = reconcileDeletedFile(entry, result?.entries);
      if (reconciled) {
        recent = reconciled;
        renderUi();
        void send({ type: 'GET_PAGE_STATE', refresh: true }).then(data => { applyTrackedTotals(data); updatePanelClocks(); }).catch(setError);
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
    return [...recent.filter(entry => !drafts.some(draft => draft.id === entry.id && draft._path === entry._path)), ...drafts];
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
    const changes = new Map(entries.map(request => [`${request.path}\u0000${request.original.id}`, request.edits]));
    recent = recent.map(entry => {
      const edits = changes.get(`${entry._path}\u0000${entry.id}`);
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
    const saveGroup = async () => {
      const group = inlineDrafts.get(key)?.group || key;
      try {
        const entries = [...inlineDrafts.entries()].filter(([, value]) => value.group === group).map(([draftKey, value]) => {
          const editor = inlineEditors.get(draftKey), target = editor?.entry;
          if (!editor || !target) throw new Error('A linked time entry is no longer visible. Reload before saving.');
          const task = value.metadataActive ? taskFromUrl(value.taskUrl, value.taskTitle) : taskFromUrl(taskUrlOf(target), taskTitleOf(target));
          if (!task) throw new Error('Enter a valid HTTP(S) task URL.');
          const description = String(value.metadataActive ? value.description : target.description || '').replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, 2000);
          const edits = { taskUrl: task.taskUrl, taskTitle: task.taskTitle, startedAt: editor.startPicker.value(), endedAt: editor.stopPicker.value(), description };
          const changed = edits.taskUrl !== taskUrlOf(target) || edits.taskTitle !== taskTitleOf(target) || edits.startedAt !== target.startedAt || edits.endedAt !== target.endedAt || edits.description !== (target.description || '');
          return changed ? { path: target._path, originalSha: target._sha, index: target._index, original: originalRecord(target), edits } : null;
        }).filter(Boolean);
        const savedKeys = new Set([...inlineDrafts].filter(([, value]) => value.group === group).map(([draftKey]) => draftKey));
        if (!entries.length) {
          clearBoundaryLinks(savedKeys); for (const draftKey of savedKeys) inlineDrafts.delete(draftKey); activeInlineKey = null; renderUi(); return;
        }
        const queued = await send({ type: 'QUEUE_ENTRIES_EDIT', payload: { entries } });
        if (queued?.operationId) inlineQueuedOperationIds.add(queued.operationId);
        applyQueuedInlineEntries(entries);
        clearBoundaryLinks(savedKeys); for (const draftKey of savedKeys) inlineDrafts.delete(draftKey);
        activeInlineKey = null; renderUi();
        void refreshState(false, false).catch(setError);
      } catch (error) { setError(error); }
    };
    const cancelGroup = async () => { clearInlineGroup(key); activeInlineKey = null; renderUi(); };
    save = button('Save time', 'link-button inline-save', saveGroup);
    cancel = button('Cancel', 'link-button inline-cancel', cancelGroup);
    save.hidden = !draft; cancel.hidden = !draft;
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

  function beginMetadataEdit(entry) {
    const key = entryKey(entry);
    activeInlineKey = key;
    const existing = inlineDrafts.get(key);
    inlineDrafts.set(key, {
      ...(existing || {
        entry,
        start: { ...timestampParts(entry.startedAt, entry.timezone), timestamp: entry.startedAt },
        stop: { ...timestampParts(entry.endedAt, entry.timezone), timestamp: entry.endedAt },
        group: key,
      }),
      metadataActive: true, taskUrl: taskUrlOf(entry), taskTitle: taskTitleOf(entry), description: entry.description || '',
    });
    renderUi(); globalThis.requestAnimationFrame?.(() => inlineEditors.get(key)?.descriptionField?.focus());
  }

  function recentRecord(entry, overlaps) {
    const key = entryKey(entry), overlapping = overlaps.has(key), draft = inlineDrafts.get(key);
    const record = el('div', undefined, 'entry-record');
    const warning = el('div', 'Overlaps another entry', 'overlap-warning');
    const setOverlap = active => {
      record.classList[active ? 'add' : 'remove']('entry-overlap');
      if (active && !warning.parentElement) record.prepend(warning); else if (!active) warning.remove();
    };
    setOverlap(overlapping);
    record.append(taskResult(entry, 'entry-record-task-result'));
    const title = record.querySelector('.task-title');
    if (title && resolveTaskColor) title.style.color = resolveTaskColor({ url: taskUrlOf(entry), id: entry.id });
    const timeRow = el('div', undefined, 'entry-time-row'); let day;
    if (entry._pending) {
      day = el('div', relativeDayLabel(timestampParts(entry.startedAt, entry.timezone).date), 'entry-day');
      const time = el('span', recentTimeText(entry), 'entry-time-range');
      const durationText = formatDuration(entry.durationSeconds), duration = el('span', durationText, 'inline-duration'); duration.title = durationText;
      const actions = el('div', undefined, 'entry-actions entry-actions-visible');
      const pending = button('Pending', 'link-button entry-pending', async () => {}); pending.disabled = true; actions.append(pending); timeRow.append(time, duration, actions);
    } else {
      const inline = inlineTimeEditor(entry), actions = el('div', undefined, 'entry-actions'); day = inline.day;
      const editor = inlineEditors.get(key); if (editor) editor.setOverlap = setOverlap;
      const remove = button('Delete', 'danger-outline entry-delete', async (event, node) => deleteRecentEntry(entry, node));
      const disabled = Boolean(loadingRecent || !recentFresh);
      for (const control of [inline.save, inline.cancel, remove]) control.disabled = disabled;
      inline.setDisabled(disabled); actions.append(inline.cancel, inline.save, remove);
      if (!inline.save.hidden) actions.classList.add('dirty'); timeRow.append(inline.node, inline.duration, actions);
      timeRow.append(inline.unsaved);
      if (draft?.metadataActive) {
        const metadata = el('div', undefined, 'inline-metadata-editor');
        const urlField = el('input'); urlField.className = 'inline-task-url'; urlField.type = 'url'; urlField.required = true; urlField.value = draft.taskUrl;
        const titleField = el('input'); titleField.className = 'inline-task-title'; titleField.maxLength = 300; titleField.placeholder = 'Optional title'; titleField.value = draft.taskTitle;
        const descriptionField = el('input'); descriptionField.className = 'inline-description'; descriptionField.maxLength = 2000; descriptionField.placeholder = 'Optional description'; descriptionField.value = draft.description;
        const field = (labelText, input) => { const label = el('label', labelText); label.append(input); return label; };
        metadata.append(field('Task URL', urlField), field('Task title (optional)', titleField), field('Description', descriptionField));
        const updateMetadata = () => { const value = inlineDrafts.get(key); if (value) inlineDrafts.set(key, { ...value, taskUrl: urlField.value, taskTitle: titleField.value, description: descriptionField.value }); };
        for (const input of [urlField, titleField, descriptionField]) {
          input.disabled = disabled; input.addEventListener('input', updateMetadata);
          input.addEventListener('keydown', event => { if (event.key === 'Enter' && event.isTrusted) { event.preventDefault(); updateMetadata(); void inline.saveGroup(); } });
        }
        record.append(metadata); Object.assign(editor, { urlField, titleField, descriptionField });
      } else {
        const description = button(entry.description || 'Add description', 'entry-description entry-description-editable', async () => beginMetadataEdit(entry));
        description.title = 'Edit URL, title, and description'; description.setAttribute('aria-label', entry.description ? `Edit description: ${entry.description}` : 'Add description and edit task details');
        record.append(description);
      }
    }
    if (timesMode) record.prepend(timeRow); else record.prepend(day, timeRow);
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

  function renderRecent(container, sourceEntries = recent, emptyState = null) {
    inlineEditors.clear();
    const header = el('div', undefined, 'section-head'); header.append(el('strong', timesMode ? 'Tracked time' : 'Recent entries'));
    const refresh = button('', 'icon-button', async (event, node) => {
      node.disabled = true;
      try { errorText = ''; renderUi(); await send({ type: 'SYNC' }); recentLoaded = false; await refreshState(true, true); }
      catch (error) { node.disabled = false; setError(error); }
    });
    const syncing = hasRunnablePending();
    refresh.disabled = syncing; refresh.classList.toggle('syncing', syncing);
    refresh.title = 'Sync and refresh'; refresh.setAttribute('aria-label', 'Sync and refresh'); refresh.append(icon('sync', SYNC_PATH)); header.append(refresh); container.append(header);
    if (loadingRecent && !recentLoaded) { container.append(el('div', 'Loading recent entries…', 'muted')); return; }
    if (!recentLoaded) { container.append(el('div', 'Loading recent entries…', 'muted')); return; }
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
      // Queues persisted before operation was projected to the page expose only
      // their stage. Keep their recovery actionable after an extension upgrade.
      const queuedEdit = ['editEntry', 'editEntries'].includes(item.operation ?? item.stage);
      const rejectedWrite = item.conflictReason?.startsWith('queued_write_');
      const rejectedStart = rejectedWrite && item.stage === 'startNext';
      const box = el('div', undefined, 'conflict');
      const title = unsaved ? 'Completion was not saved' : savedWithNewerTimer ? 'Newer GitHub timer preserved'
        : rejectedStart ? 'Queued start needs attention' : rejectedWrite ? 'Queued write needs attention'
          : queuedEdit ? 'Saved edit needs review' : 'Entry path conflict';
      const detail = item.conflictReason === 'active_missing_no_completion'
        ? 'The active timer is gone and no matching completion exists. Discarding removes this unsaved completion.'
        : item.conflictReason === 'active_changed_no_completion'
          ? 'The active timer changed before this completion was saved. Discarding removes this unsaved completion.'
          : savedWithNewerTimer ? 'The completed entry was saved; the newer active timer was preserved.'
            : rejectedStart ? 'GitHub rejected this timer start. Check the configured repository and access, then retry.'
              : rejectedWrite ? 'GitHub rejected this queued write. Check the configured repository and access, then retry.'
                : queuedEdit ? 'Activity changed after this edit was queued. Retry safely reloads the affected entry and reapplies your saved change.'
                  : 'Repair or remove the conflicting entry in GitHub, then retry.';
      const label = unsaved ? 'Discard unsaved completion' : savedWithNewerTimer ? 'Keep newer timer'
        : rejectedWrite ? 'Retry queued write' : queuedEdit ? 'Retry saved edit' : 'Retry entry sync';
      box.append(el('strong', title), el('div', detail, 'muted'));
      box.append(button(label, 'secondary wide', async () => {
        if (unsaved && !confirm('Discard this unsaved completion? This cannot be recovered from the time-data repository.')) return;
        await send({ type: 'RESOLVE_PENDING', id: item.id, ...(unsaved ? { action: 'discard_unsaved_completion' } : {}) });
        recentLoaded = false;
        await refreshState(true, true);
      }));
      if (queuedEdit) box.append(button('Discard queued edit', 'link-button', async () => {
        if (!confirm('Discard this queued edit? The current Activity data will not be changed.')) return;
        await send({ type: 'RESOLVE_PENDING', id: item.id, action: 'discard_queued_edit' });
        recentLoaded = false;
        await refreshState(true, true);
      }));
      container.append(box);
    }
  }

  async function loadSelectedTimes() {
    const loadId = ++timesLoadId;
    recentLoaded = false; errorText = ''; renderUi();
    try { await refreshRecent(true); }
    catch (error) { if (loadId === timesLoadId && error?.name !== 'AbortError') setError(error); }
  }

  function renderTimesPage() {
    const page = el('main', undefined, 'times-page');
    const body = el('div', undefined, 'times-body');
    if (!pageState.configured && recentLoaded) {
      body.append(el('p', 'Connect a GitHub repository before viewing time.', 'muted'), button('Connect GitHub', 'primary', async () => send({ type: 'OPEN_OPTIONS' })));
      page.append(body); return page;
    }
    const toolbar = el('section', undefined, 'times-toolbar');
    const filterLabel = el('label', 'Filter by URL or optional title'), filter = el('input'); filter.type = 'search'; filter.placeholder = 'Filter by URL or optional title'; filter.value = timesFilter; filterLabel.className = 'times-filter'; filterLabel.append(filter); toolbar.append(filterLabel);
    const periodLabel = el('label', 'Period'), period = el('select'); period.setAttribute('aria-label', 'Time period');
    for (const [value, label] of [['last-three-days', 'Last 3 days'], ['today', 'Today'], ['yesterday', 'Yesterday'], ['this-week', 'This week'], ['last-week', 'Last week'], ['this-month', 'This month'], ['last-month', 'Last month'], ['custom', 'Custom period']]) {
      const option = el('option', label); option.value = value; option.selected = timesPeriod === value; period.append(option);
    }
    period.addEventListener('change', () => {
      timesPeriod = period.value;
      if (timesPeriod === 'custom') { const current = localDateValue(); timesStartDate ||= current; timesEndDate ||= current; renderUi(); }
      else void loadSelectedTimes();
    }); periodLabel.append(period); toolbar.append(periodLabel);
    if (timesPeriod === 'custom') {
      const startLabel = el('label', 'From'), start = el('input'); start.type = 'date'; start.value = timesStartDate; start.addEventListener('input', () => { timesStartDate = start.value; }); startLabel.append(start);
      const endLabel = el('label', 'Through'), end = el('input'); end.type = 'date'; end.value = timesEndDate; end.addEventListener('input', () => { timesEndDate = end.value; }); endLabel.append(end);
      const custom = el('div', undefined, 'times-custom'); custom.append(startLabel, endLabel, button('Apply', 'secondary times-apply', async () => loadSelectedTimes())); toolbar.append(custom);
    }
    body.append(toolbar);
    const result = el('section', undefined, 'times-results');
    const renderFiltered = () => {
      result.replaceChildren(); const query = timesFilter.trim().toLowerCase();
      const drafts = [...inlineDrafts.values()].map(draft => draft.entry);
      const entries = recordsWithDrafts();
      const matches = query ? entries.filter(entry => taskUrlOf(entry).toLowerCase().includes(query) || taskTitleOf(entry).toLowerCase().includes(query)) : [...entries];
      let empty = null;
      if (!matches.length) {
        empty = el('div', undefined, 'activity-empty');
        const firstUse = !recent.length && timesHasTrackedTime === false;
        empty.append(el('p', recent.length ? 'No entries match.' : firstUse ? 'Nothing tracked yet. Open a task page and click Clockoli to start.' : 'No time in this range.', 'muted'));
        if (recent.length) empty.append(button('Clear filter', 'secondary', async () => { timesFilter = ''; filter.value = ''; renderFiltered(); filter.focus(); }));
        else if (!firstUse) empty.append(button('Add time', 'secondary', async () => { bulkOpen = true; bulk.open = true; input.focus(); }));
      }
      if (query && inlineDrafts.size) {
        const visible = new Set(matches.map(entryKey));
        for (const entry of drafts) if (!visible.has(entryKey(entry))) matches.push(entry);
      }
      renderRecent(result, matches, empty);
    };
    filter.addEventListener('input', () => { timesFilter = filter.value; renderFiltered(); }); renderFiltered(); body.append(result);
    const bulk = el('details', undefined, 'bulk-time');
    bulk.open = bulkOpen; bulk.addEventListener('toggle', () => { bulkOpen = bulk.open; });
    const summary = el('summary', 'Add time'); bulk.append(summary);
    const help = el('p', 'One entry per line: date, URL, optional description, then hours. Imports are all-or-nothing and are appended after existing time on each day.', 'muted');
    const input = el('textarea'); input.rows = 8; input.className = 'bulk-time-input'; input.setAttribute('aria-label', 'Bulk time entries'); input.value = bulkDraft; input.disabled = bulkMutation;
    input.placeholder = `2026/08/21 https://example.com/task Search relevance 6:00
2026-08-22 https://github.com/acme/app/issues/42 Fix ranking 6.5
23.08.2026 https://example.com/call Customer call 1:30
24/08/2026 https://example.com/release Release preparation 0.25`;
    input.addEventListener('input', () => { bulkDraft = input.value; });
    const add = button('Add time', 'primary', async () => {
      if (bulkMutation) return;
      bulkDraft = input.value; bulkMutation = true; errorText = ''; renderUi();
      try {
        const result = await send({ type: 'BULK_ADD_TIMES', text: bulkDraft });
        bulkDraft = ''; bulkMutation = false; recentLoaded = false; await refreshRecent(true); setError(`${result.added} ${result.added === 1 ? 'entry was' : 'entries were'} added.`);
      } catch (error) { bulkMutation = false; setError(error); }
    }); add.disabled = bulkMutation;
    bulk.append(help, input, add); body.append(bulk);
    if (errorText) body.prepend(el('div', errorText, errorCode ? 'error' : 'notice'));
    page.append(body); return page;
  }

  const POPUP_WINDOW_MS = 24 * 60 * 60 * 1000;
  const POPUP_HISTORY_MS = 7 * 24 * 60 * 60 * 1000;

  function mergeTimelineCompletedEntries(completed, optimisticCompletions) {
    const byId = new Map();
    const anonymous = [];
    for (const entry of completed) {
      if (entry?.id) byId.set(entry.id, entry);
      else anonymous.push(entry);
    }
    for (const entry of optimisticCompletions) {
      if (entry?.id) byId.set(entry.id, entry);
      else anonymous.push(entry);
    }
    return [...byId.values(), ...anonymous];
  }

  function popupTimelineEntries(windowStart, now) {
    const completed = recent.filter(entry => entry._path && (entry._sha || entry._pending)
      && Number.isFinite(new Date(entry.startedAt).getTime()) && Number.isFinite(new Date(entry.endedAt).getTime())
      && new Date(entry.startedAt).getTime() < now && new Date(entry.endedAt).getTime() > windowStart)
      .sort((left, right) => new Date(left.startedAt) - new Date(right.startedAt));
    const entries = mergeTimelineCompletedEntries(completed, timelineOptimisticCompletions.values());
    if (pageState.active && new Date(pageState.active.startedAt).getTime() < now) {
      entries.push({ ...pageState.active, endedAt: new Date(now).toISOString(), _active: true });
    }
    return entries.map(entry => {
      const optimistic = timelineOptimisticEdits.get(entry.id);
      return { ...entry, isPending: Boolean(entry._pending || optimistic), ...(optimistic || {}) };
    })
      .sort((left, right) => new Date(left.startedAt) - new Date(right.startedAt));
  }

  function popupTimelineItems(historyStart, now) {
    const byId = new Map();
    const entries = popupTimelineEntries(historyStart, now);
    const rows = popupTimelineRows(entries);
    const items = entries.map((entry) => {
      const stableId = entry.id || `${entry._path}:${entry._index}`;
      const id = `${entry._active ? 'active' : 'entry'}:${stableId}`;
      const projectName = pageState.projects?.length ? projectNameForUrl(taskUrlOf(entry), pageState.projects) : '';
      byId.set(id, entry);
      return {
        id,
        rowId: pageState.projects?.length ? projectRowId(projectName) : 'tracked',
        url: taskUrlOf(entry),
        title: taskTitleOf(entry) || taskUrlOf(entry) || 'Untitled task',
        startedAt: Math.max(historyStart, new Date(entry.startedAt).getTime()),
        endedAt: entry._active ? null : Math.min(now, new Date(entry.endedAt).getTime()),
        isRunning: Boolean(entry._active),
        isEditable: !entry._active,
        isPending: Boolean(entry._pending),
        isStartDisabled: timelineStartInFlight || timelineStopInFlight || timelineDeleteInFlight || sameTask(entry, pageState.active)
          || Boolean(pageState.pendingWrites?.some(item => item.status === 'conflict')),
        isStopDisabled: Boolean(entry._active && (timelineStartInFlight || timelineStopInFlight || timelineDeleteInFlight
          || pageState.pendingWrites?.some(item => item.status === 'conflict'))),
        isDeleteDisabled: timelineDeleteInFlight || timelineStartInFlight || timelineStopInFlight
          || Boolean(!entry._active && entry._pending)
          || Boolean(pageState.pendingWrites?.some(item => item.status === 'conflict')),
      };
    });
    return { items, rows, byId };
  }

  function popupTimelineRows(entries) {
    if (!pageState.projects?.length) return [{ id: 'tracked', title: '' }];
    const rows = pageState.projects.map(project => ({ id: projectRowId(project.name), title: project.name }));
    if (entries.some(entry => projectNameForUrl(taskUrlOf(entry), pageState.projects) === 'Other')) {
      rows.push({ id: projectRowId('Other'), title: 'Other' });
    }
    return rows;
  }

  function timelineTrackActionDisabled() {
    const current = taskFromLocation();
    return !current || sameTask(current, pageState.active) || timelineStartInFlight || timelineStopInFlight
      || timelineDeleteInFlight || Boolean(pageState.pendingWrites?.some(item => item.status === 'conflict'));
  }

  function timelineNow() {
    const activeStart = new Date(pageState.active?.startedAt).getTime();
    return Number.isFinite(activeStart) ? Math.max(Date.now(), activeStart + 1) : Date.now();
  }

  function refreshMountedTimeline() {
    if (!pageState.configured || !timelineInstance || !timelineWindow) return false;
    timelineWindow = { ...timelineWindow, now: timelineNow() };
    const { items, rows, byId } = popupTimelineItems(timelineWindow.historyStart, timelineWindow.now);
    timelineEntriesById = byId;
    timelineInstance.update({ items, rows, now: timelineWindow.now });
    refreshCompactSurface();
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
  }

  function refreshMountedTimelineAtRightEdge(startedAt) {
    const startedAtMs = new Date(startedAt).getTime();
    if (!Number.isFinite(startedAtMs)) return false;
    timelineScrollToRightPending = true;
    if (!timelineInstance || !timelineWindow || !timelineView) return false;
    const now = Math.max(Date.now(), startedAtMs + 1);
    const span = Math.max(1, timelineView.end - timelineView.start);
    timelineWindow = { ...timelineWindow, now };
    timelineView = { start: now - span, end: now, focusedAt: now };
    const { items, rows, byId } = popupTimelineItems(timelineWindow.historyStart, now);
    timelineEntriesById = byId;
    timelineInstance.update({ items, rows, now, view: timelineView });
    timelineInstance.scrollToEnd();
    refreshCompactSurface();
    timelineScrollToRightPending = false;
    return true;
  }

  function acceptTimelineStartImmediately(task, { completePrevious = false, identity = '' } = {}) {
    const startedAt = new Date().toISOString();
    const previousActive = pageState.active;
    const acceptanceId = beginTimelineQueueAcceptance();
    const context = { acceptanceId, acceptedActive: null, previousActive, startedAt };
    try {
      if (completePrevious && previousActive?.id && Number.isFinite(new Date(previousActive.startedAt).getTime())) {
        timelineOptimisticCompletions.set(previousActive.id, {
          ...previousActive, endedAt: startedAt, _pending: true, _optimisticCompletion: true,
        });
      }
      const acceptedActive = {
        id: `timeline-local:${identity || taskUrlOf(task)}:${acceptanceId}`,
        taskUrl: taskUrlOf(task), taskTitle: taskTitleOf(task) || '',
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
      finishTimelineQueueAcceptance(acceptanceId);
      throw error;
    }
  }

  function rollbackTimelineStart(context) {
    timelineAcceptedActive = null;
    if (context.previousActive?.id) timelineOptimisticCompletions.delete(context.previousActive.id);
    pageState = { ...pageState, active: context.previousActive };
    if (!refreshMountedTimeline()) renderUi();
  }

  async function trackCurrentTimelineTask() {
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
      startContext = acceptTimelineStartImmediately(task, { completePrevious: switching, identity: 'current-task' });
      const result = await send(switching
        ? { type: 'SWITCH_TASK', taskUrl: task.taskUrl, taskTitle: task.taskTitle || '' }
        : { type: 'START', taskUrl: task.taskUrl, taskTitle: task.taskTitle || '' });
      const active = switching ? result?.active : result;
      if (active?.id) {
        timelineAcceptedActive = { ...active, _pending: Boolean(active._pending) };
        pageState = { ...pageState, active: timelineAcceptedActive };
        refreshMountedTimelineAtRightEdge(active.startedAt || startContext.startedAt);
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
      saving: timelineQueueAcceptances.size > 0 || timelineStartInFlight || timelineStopInFlight || timelineSaving });
    timelineQueueIndicator.hidden = false;
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

  async function queueCalendarEntry(entry, edits) {
    timelineOptimisticEdits.set(entry.id, edits);
    applyTimelineOptimisticEntry(entry, edits);
    refreshMountedTimeline();
    const acceptanceId = beginTimelineQueueAcceptance();
    refreshTimelineQueueIndicator();
    recordTimelineQueueDiagnostic('Edit time entry: accepted locally and queued for GitHub.');
    if (!timelineInstance) renderUi();
    try {
      const result = await send({ type: 'QUEUE_ENTRY_EDIT', payload: {
        path: entry._path, originalSha: entry._sha, index: entry._index,
        original: originalRecord(entry), edits,
      } });
      if (result?.operationId) timelineQueuedOperationIds.set(result.operationId, entry.id);
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

  async function queueTimelineEntryDelete(entry) {
    if (!confirm(`Delete this ${formatDuration(entry.durationSeconds)} entry?`)) return;
    const previousRecent = recent;
    const previousTotals = { todayTrackedMs: pageState.todayTrackedMs, weekTrackedMs: pageState.weekTrackedMs };
    recent = recent.filter(item => !(item.id === entry.id && item._path === entry._path));
    timelineOptimisticCompletions.delete(entry.id);
    pageState = { ...pageState, todayTrackedMs: null, weekTrackedMs: null };
    const acceptanceId = beginTimelineQueueAcceptance();
    refreshTimelineQueueIndicator();
    refreshMountedTimeline();
    recordTimelineQueueDiagnostic('Delete time entry: accepted locally and queued for GitHub.');
    try {
      const result = await send({ type: 'QUEUE_ENTRY_DELETE', payload: {
        path: entry._path, originalSha: entry._sha, index: entry._index, original: originalRecord(entry),
      } });
      if (result?.operationId) timelineQueuedOperationIds.set(result.operationId, entry.id);
    } catch (error) {
      recent = previousRecent;
      pageState = { ...pageState, ...previousTotals };
      recordTimelineQueueDiagnostic('Delete time entry: local queue rejected the change.');
      throw error;
    } finally {
      finishTimelineQueueAcceptance(acceptanceId);
      refreshTimelineQueueIndicator();
      if (!refreshMountedTimeline()) renderUi();
    }
    void refreshMountedTimelineState().catch(setError);
  }

  async function stopTimelineEntry(activeEntry) {
    if (!activeEntry || timelineStartInFlight || timelineDeleteInFlight || !beginTimelineStop()) return;
    try {
      if (!confirmLongEntry(activeEntry)) return;
      const result = await send({ type: 'STOP', description: activeEntry?.description || '' });
      if (!result?.entry?.id) throw new Error('The locally accepted Stop did not return its completed time entry.');
      if (timelineAcceptedActive && sameTask(timelineAcceptedActive, activeEntry)) timelineAcceptedActive = null;
      timelineOptimisticCompletions.set(result.entry.id, {
        ...result.entry,
        _pending: Boolean(result.pending),
        _optimisticCompletion: true,
      });
      pageState = { ...pageState, active: null };
      refreshMountedTimeline();
      await refreshState(false, false);
    } catch (error) { setError(error); throw error; }
    finally { finishTimelineStop(); }
  }

  async function restartTimelineEntry(entry) {
    if (!entry || entry._active || timelineStartInFlight || timelineStopInFlight || timelineDeleteInFlight || sameTask(entry, pageState.active)) return;
    if (!confirmLongEntry()) return;
    timelineStartInFlight = true;
    refreshMountedTimeline();
    try {
    const startContext = acceptTimelineStartImmediately(entry, { completePrevious: true, identity: entry.id });
    try {
      const result = await send({ type: 'SWITCH_TASK', timelineTask: true, taskUrl: taskUrlOf(entry), taskTitle: taskTitleOf(entry) || '' });
      if (result?.active) {
        timelineAcceptedActive = { ...result.active, _pending: Boolean(result.active._pending) };
        pageState = { ...pageState, active: timelineAcceptedActive };
        refreshMountedTimelineAtRightEdge(result.active.startedAt || startContext.startedAt);
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
    }
  }

  function renderPopupTimeline() {
    const section = el('section', undefined, 'popup-timeline-section');
    const spinner = el('div', undefined, 'timeline-queue-spinner');
    spinner.setAttribute('role', 'status');
    timelineQueueIndicator = spinner;
    section.append(spinner);
    refreshTimelineQueueIndicator();
    const createTimeline = globalThis.ElasticTimelineEditor?.createElasticTimeline;
    if (!createTimeline) {
      section.append(el('div', 'Timeline component is unavailable. Reload the extension.', 'error'));
      return section;
    }
    if (!recentLoaded && !timelineAcceptedActive) { section.append(el('div', 'Loading timeline…', 'muted')); return section; }
    const now = timelineNow(), defaultStart = now - POPUP_WINDOW_MS, historyStart = now - POPUP_HISTORY_MS;
    timelineWindow = { historyStart, now };
    timelineView ||= { start: defaultStart, end: now, focusedAt: now };
    const { items, rows, byId } = popupTimelineItems(historyStart, now);
    timelineEntriesById = byId;
    const timelineShell = el('div', undefined, `timeline-shell${timelineSaving ? ' is-saving' : ''}`);
    timelineShell.setAttribute('aria-busy', String(timelineSaving));
    timelineShell.inert = timelineSaving;
    const host = el('div', undefined, 'elastic-timeline-host'); timelineShell.append(host);
    if (compactSurface) compactSurface.host = host;
    if (timelineSaving) {
      const spinner = el('div', undefined, 'timeline-saving-spinner');
      spinner.setAttribute('role', 'status'); spinner.setAttribute('aria-label', 'Saving timeline changes');
      spinner.append(el('span', undefined, 'timeline-saving-wheel'));
      timelineShell.append(spinner);
    }
    section.append(timelineShell);
    globalThis.requestAnimationFrame(() => {
      if (!host.isConnected) return;
      timelineInstance = createTimeline(host, {
        items,
        rows,
        now,
        // Clockoli records timestamps to the second. A one-second snap also
        // defines the exact gap retained when neighbouring blocks touch.
        snapMs: 1_000,
        view: timelineView,
        onViewChange: view => { timelineView = view; globalThis.requestAnimationFrame?.(refreshTimelineOverlaps); },
        onEditDebug: detail => recordTimelineGestureDiagnostic(detail),
        onStop: async item => { await stopTimelineEntry(timelineEntriesById.get(item.id)); },
        onDelete: async item => {
          const entry = timelineEntriesById.get(item.id);
          if (!entry || timelineDeleteInFlight || timelineStartInFlight || timelineStopInFlight) return;
          if (!entry._active) {
            if (entry._pending) return;
            await queueTimelineEntryDelete(entry);
            return;
          }
          if (!confirm('Delete this running timer without saving its tracked time?')) return;
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
        },
        onStart: async item => { await restartTimelineEntry(timelineEntriesById.get(item.id)); },
        onEditCommit: async edit => {
          const entry = timelineEntriesById.get(edit.id);
          if (!entry) return;
          if (entry._active) {
            if (edit.kind !== 'resize-left') return;
            try {
              timelineOptimisticEdits.set(entry.id, { startedAt: new Date(edit.startedAt).toISOString() });
              refreshMountedTimeline();
              const acceptanceId = beginTimelineQueueAcceptance();
              refreshTimelineQueueIndicator();
              recordTimelineQueueDiagnostic('Adjust timer start: accepted locally and queued for GitHub.');
              if (!timelineInstance) renderUi();
              try {
                const result = await send({ type: 'QUEUE_ACTIVE_START_EDIT', payload: {
                  original: { id: entry.id, startedAt: entry.startedAt },
                  startedAt: new Date(edit.startedAt).toISOString(),
                } });
                if (result?.operationId) timelineQueuedOperationIds.set(result.operationId, entry.id);
              } catch (error) {
                recordTimelineQueueDiagnostic('Adjust timer start: local queue rejected the change.');
                throw error;
              } finally {
                finishTimelineQueueAcceptance(acceptanceId);
                refreshTimelineQueueIndicator();
                if (!refreshMountedTimeline()) renderUi();
              }
              void refreshMountedTimelineState().catch(setError);
            } catch (error) { setError(error); throw error; }
            return;
          }
          const edits = edit.kind === 'move'
            ? { startedAt: new Date(edit.startedAt).toISOString(), endedAt: new Date(edit.endedAt).toISOString() }
            : edit.kind === 'resize-left'
              ? { startedAt: new Date(edit.startedAt).toISOString() }
              : { endedAt: new Date(edit.endedAt).toISOString() };
          try { await queueCalendarEntry(entry, edits); }
          catch (error) {
            timelineOptimisticEdits.delete(entry.id);
            applyTimelineOptimisticEntry(entry, { startedAt: entry.startedAt, endedAt: entry.endedAt });
            renderUi(); setError(error); throw error;
          }
        },
      });
      refreshTimelineOverlaps();
      if (timelineScrollToRightPending) {
        timelineInstance.scrollToEnd();
        timelineScrollToRightPending = false;
      }
    });
    return section;
  }

  function renderQueueDiagnostics() {
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
    for (const scope of [shadow, fullWidthPopupShadow]) {
      for (const value of scope?.querySelectorAll?.('[data-tracked-total]') ?? []) value.textContent = trackedTotalText(value.getAttribute('data-tracked-total'));
      for (const value of scope?.querySelectorAll?.('.running-elapsed') ?? []) if (pageState.active) value.textContent = formatElapsed(pageState.active.startedAt);
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
    if (!popupFocusPending) return;
    globalThis.requestAnimationFrame?.(() => {
      const action = fullWidthPopupShadow?.querySelector?.('[data-strip-primary]');
      if (!popupFocusPending || !action || action.disabled) return;
      action.focus({ preventScroll: true }); popupFocusPending = false;
    });
  }

  function refreshCompactSurface() {
    if (!compactSurface) return;
    const { strip, today, feedback } = compactSurface;
    const activeElement = fullWidthPopupShadow?.activeElement || shadow?.activeElement;
    const actionKey = activeElement?.getAttribute?.('data-panel-action');
    const scroll = fullWidthPopupShadow?.querySelector?.('.full-width-popup');
    const scrollTop = scroll?.scrollTop;
    const diagnosticsOpen = feedback.querySelector?.('details')?.open;
    strip.replaceChildren(clockoliMark(22));
    const active = pageState.active, current = taskFromLocation();
    if (active) {
      strip.append(taskResult(active, 'strip-task'), el('span', formatElapsed(active.startedAt), 'running-elapsed'));
      const stop = button('Stop and save', 'danger', async () => { try { await stopTimelineEntry(pageState.active); } catch {} });
      stop.setAttribute('data-strip-primary', 'true'); stop.setAttribute('data-panel-action', 'stop');
      stop.disabled = timelineStartInFlight || timelineStopInFlight || timelineDeleteInFlight || Boolean(pageState.pendingWrites?.some(item => item.status === 'conflict'));
      strip.append(stop);
    } else strip.append(el('span', 'Not tracking', 'strip-idle'));
    if (!active || (current && !sameTask(current, active))) {
      const track = button('Track this task', 'primary popup-timeline-track', async () => {
        if (timelineTrackActionDisabled()) return;
        try { await trackCurrentTimelineTask(); } catch {}
      });
      if (active) { track.textContent = 'Switch to this task'; track.className = 'secondary popup-timeline-track'; }
      else track.setAttribute('data-strip-primary', 'true');
      track.setAttribute('data-testid', 'popup-timeline-track'); track.setAttribute('data-panel-action', 'track');
      track.disabled = timelineTrackActionDisabled(); strip.append(track);
    }
    today.replaceChildren();
    const totals = el('div', undefined, 'today-list-totals'); appendTrackedTotals(totals, true); today.append(totals);
    const entries = mergeTimelineCompletedEntries(recent, timelineOptimisticCompletions.values()).map(entry => ({ ...entry, ...timelineOptimisticEdits.get(entry.id) }))
      .filter(entry => entry.entryDate === localDateValue() && entry.endedAt)
      .sort((left, right) => new Date(right.startedAt) - new Date(left.startedAt));
    for (const entry of entries) {
      const row = el('div', undefined, 'entry-record today-record');
      const task = taskResult(entry, 'today-task');
      const title = task.querySelector?.('a') || task.children[task.children.length - 1];
      if (title && resolveTaskColor) title.style.color = resolveTaskColor({ url: taskUrlOf(entry), id: entry.id });
      const range = el('span', `${wallTime(timestampParts(entry.startedAt, entry.timezone))}–${wallTime(timestampParts(entry.endedAt, entry.timezone))}`, 'entry-time-range');
      const duration = el('span', formatDuration(Math.max(0, new Date(entry.endedAt) - new Date(entry.startedAt)) / 1000), 'inline-duration');
      const resume = button('▶ Continue', 'secondary', async () => { try { await restartTimelineEntry(entry); } catch {} });
      resume.setAttribute('data-panel-action', `continue:${entry.id}`);
      resume.disabled = timelineStartInFlight || timelineStopInFlight || timelineDeleteInFlight || sameTask(entry, active) || Boolean(pageState.pendingWrites?.some(item => item.status === 'conflict'));
      row.append(task, range, duration);
      if (entry._pending || timelineOptimisticEdits.has(entry.id)) {
        const pending = button('Pending', 'link-button entry-pending', async () => {}); pending.disabled = true; row.append(pending);
      }
      row.append(resume); today.append(row);
    }
    if (!entries.length) today.append(el('div', recentLoaded ? 'No completed entries today.' : 'Loading today’s entries…', 'muted'));
    feedback.replaceChildren(); renderPanelFeedback(feedback);
    const diagnostics = feedback.querySelector?.('details'); if (diagnostics && diagnosticsOpen) diagnostics.open = true;
    refreshTimelineQueueIndicator(); refreshTimelineOverlaps();
    if (actionKey) {
      const replacement = [...strip.querySelectorAll?.('[data-panel-action]') ?? [], ...today.querySelectorAll?.('[data-panel-action]') ?? []]
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
    warning.append(el('span', `Overlapping entries: ${entries.map(entry => `${taskTitleOf(entry) || taskUrlOf(entry)} (${wallTime(timestampParts(entry.startedAt, entry.timezone))}–${entry._active ? 'now' : wallTime(timestampParts(entry.endedAt, entry.timezone))})`).join('; ')}. `));
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
    const brand = el('div', undefined, 'timeline-brand'); brand.append(clockoliMark(22), el('strong', 'Clockoli'));
    const tasks = button('Top tasks', 'reports-button', async () => { await send({ type: 'OPEN_TASKS' }); closeMenu(); }); tasks.title = 'Open top tasks'; tasks.prepend(icon('checklist', TASKS_PATH));
    const reports = button('Reports', 'reports-button', async () => { await send({ type: 'OPEN_REPORTS' }); closeMenu(); }); reports.title = 'Open reports'; reports.prepend(icon('graph', REPORTS_PATH));
    const activity = button('Activity', 'reports-button', async () => { await send({ type: 'OPEN_TIMES' }); closeMenu(); }); activity.title = 'Open activity'; activity.prepend(icon('history', ACTIVITY_PATH));
    const settings = button('', 'icon-button', async () => { await send({ type: 'OPEN_OPTIONS' }); closeMenu(); }); settings.title = 'Settings'; settings.setAttribute('aria-label', 'Time tracker settings'); settings.append(icon('gear', GEAR_PATH));
    headerActions.append(tasks, reports, ...(compact ? [activity] : []), settings);
    if (compact) {
      if (onClose) {
        const close = button('×', 'icon-button popup-timeline-close', onClose);
        close.title = 'Close Clockoli'; close.setAttribute('aria-label', 'Close Clockoli');
        const timelineToolbarEnd = el('div', undefined, 'timeline-toolbar-end');
        timelineToolbarEnd.append(close);
        header.append(brand, headerActions, timelineToolbarEnd);
      } else header.append(brand, headerActions);
      menu.append(header);
    } else {
      header.append(headerActions); menu.append(header);
    }
    const body = el('div', undefined, 'menu-body');
    if (pageState.configured == null) {
      if (!errorText) body.append(el('p', 'Loading…', 'muted'));
    } else if (!pageState.configured) {
      body.append(el('p', 'Configure a private GitHub repository before tracking time.', 'muted'));
      body.append(button('Connect GitHub', 'primary wide', async () => { await send({ type: 'OPEN_OPTIONS' }); closeMenu(); }));
    } else {
      if (compact) {
        const strip = el('div', undefined, 'active-task-strip'), today = el('section', undefined, 'today-list');
        const feedback = el('div', undefined, 'panel-feedback'), overlaps = el('div', undefined, 'timeline-overlaps');
        compactSurface = { strip, today, feedback, overlaps, body, host: null };
        body.append(strip);
        if (popupPageHint) body.append(el('p', 'Clockoli can track this page. Time is saved to your private GitHub repository.', 'page-tracking-hint muted'));
        body.append(renderPopupTimeline(), overlaps, today, feedback);
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
        const label = el('label', 'Description'); const description = el('input'); description.maxLength = 2000; description.placeholder = 'Optional'; description.value = descriptionDraft?.value ?? active.description ?? ''; label.append(description); body.append(label);
        description.addEventListener('input', () => { descriptionDraft = { id: active.id || active.startedAt, taskUrl: taskUrlOf(active), value: description.value }; });
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
              refreshMountedTimelineAtRightEdge(active.startedAt || startContext.startedAt);
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

  function renderNavigationMenu() {
    const menu = el('section', undefined, 'navigation-menu'); menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', 'Time tracker pages');
    const reports = button('Reports', 'navigation-item', async () => { await send({ type: 'OPEN_REPORTS' }); closeMenu(); });
    reports.setAttribute('role', 'menuitem'); reports.prepend(icon('graph', REPORTS_PATH));
    const tasks = button('Top tasks', 'navigation-item', async () => { await send({ type: 'OPEN_TASKS' }); closeMenu(); });
    tasks.setAttribute('role', 'menuitem'); tasks.prepend(icon('checklist', TASKS_PATH));
    const activity = button('Activity', 'navigation-item', async () => { await send({ type: 'OPEN_TIMES' }); closeMenu(); });
    activity.setAttribute('role', 'menuitem'); activity.prepend(icon('history', ACTIVITY_PATH));
    menu.append(reports, tasks, activity); return menu;
  }

  function restoreMenuScroll(scrollTop) {
    const menu = shadow?.querySelector('.menu');
    if (!menu || !Number.isFinite(scrollTop)) return;
    menu.scrollTop = scrollTop;
    globalThis.requestAnimationFrame?.(() => { if (menu.isConnected) menu.scrollTop = scrollTop; });
  }

  function timelineEditorStylesheet() {
    const href = extensionResourceUrl('src/content/elastic-timeline-editor.css');
    if (!href) return null;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    return link;
  }

  function mountFullWidthPopup() {
    if (fullWidthPopupRoot?.isConnected) return;
    fullWidthPopupRoot = el('div'); fullWidthPopupRoot.id = 'clockoli-full-width-popup-root';
    fullWidthPopupRoot.className = 'full-width-popup-surface';
    fullWidthPopupShadow = fullWidthPopupRoot.attachShadow({ mode: 'closed' });
    (document.body || document.documentElement).append(fullWidthPopupRoot);
  }

  function closeFullWidthPopup() {
    fullWidthPopupOpen = false;
    compactSurface = null; popupFocusPending = false;
    clearInterval(tick); tick = null;
    clearInterval(timelineWindowTimer); timelineWindowTimer = null;
    timelineInstance?.destroy(); timelineInstance = null; timelineWindow = null; timelineEntriesById = new Map(); timelineQueueIndicator = null;
    timelineView = null;
    fullWidthPopupRoot?.remove(); fullWidthPopupRoot = null; fullWidthPopupShadow = null;
    renderUi();
    const target = popupReturnFocus?.isConnected ? popupReturnFocus : shadow?.querySelector?.('.trigger-main');
    target?.focus?.({ preventScroll: true }); popupReturnFocus = null;
  }

  function renderFullWidthPopup(style) {
    if (!fullWidthPopupOpen || !fullWidthPopupShadow || !fullWidthPopupRoot?.isConnected) return;
    compactSurface = null;
    timelineInstance?.destroy(); timelineInstance = null; timelineWindow = null; timelineEntriesById = new Map(); timelineQueueIndicator = null;
    const surface = el('section', undefined, 'full-width-popup');
    const timelineStylesheet = timelineEditorStylesheet();
    if (!timelineStylesheet) return;
    surface.append(renderMenu({ compact: true, onClose: () => closeFullWidthPopup() }));
    fullWidthPopupShadow.replaceChildren(style.cloneNode(true), timelineStylesheet, surface);
    focusPopupAction();
  }

  async function toggleFullWidthPopup() {
    fullWidthPopupOpen = !fullWidthPopupOpen;
    if (!fullWidthPopupOpen) { closeFullWidthPopup(); return false; }
    popupReturnFocus = shadow?.activeElement || document.activeElement; popupFocusPending = true;
    popupPageHint = false;
    mountFullWidthPopup(); renderUi();
    clearInterval(timelineWindowTimer);
    timelineWindowTimer = setInterval(() => { if (fullWidthPopupOpen) renderUi(); }, 60_000);
    timelineWindowTimer?.unref?.();
    try {
      applyPageState(await send({ type: 'GET_PAGE_STATE', refresh: false }));
      if (!fullWidthPopupOpen) return false;
      popupPageHint = location.hostname !== 'github.com' && !pageState.active;
      renderUi();
      applyPageState(await send({ type: 'GET_PAGE_STATE', refresh: true }));
      if (!fullWidthPopupOpen) return false;
      if (pageState.configured) await refreshRecent(true);
      else renderUi();
    } catch (error) { setError(error); }
    return true;
  }

  function renderUi() {
    if ((!shadow || !root?.isConnected) && (!fullWidthPopupShadow || !fullWidthPopupRoot?.isConnected)) return;
    if (descriptionDraft && (!pageState.active || descriptionDraft.id !== (pageState.active.id || pageState.active.startedAt)
        || descriptionDraft.taskUrl !== taskUrlOf(pageState.active))) descriptionDraft = null;
    updateTaskAnimation();
    const preservedMenuScrollTop = menuScrollTop;
    const preserveFullWidthTimeline = Boolean(fullWidthPopupOpen && pageState.configured && timelineInstance && timelineWindow);
    clearInterval(tick); tick = null;
    if (!preserveFullWidthTimeline) {
      timelineInstance?.destroy(); timelineInstance = null; timelineWindow = null; timelineEntriesById = new Map(); timelineQueueIndicator = null;
    }
    if (shadow && root?.isConnected) shadow.replaceChildren();
    const style = el('style', `
      :host {
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
        --ck-button-invisible-fg-rest: var(--button-invisible-fgColor-rest,#25292e);
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
      }
      @media (prefers-color-scheme: dark) {
        :host {
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
          --ck-bg-attention: var(--bgColor-attention-muted,#151b23);
          --ck-accent: var(--fgColor-accent,#4493f8);
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
          --ck-button-invisible-fg-rest: var(--button-invisible-fgColor-rest,#f0f6fc);
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
        }
      }
      :host { all:initial; position:relative; display:inline-flex; align-items:center; color:var(--fgColor-default,var(--ck-fg)); color-scheme:light dark; font:var(--text-body-shorthand-medium,400 14px/1.5 "Mona Sans VF",-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans Backtick Fix","Noto Sans",Helvetica,Arial,sans-serif,"Apple Color Emoji","Segoe UI Emoji") }
      * { box-sizing:border-box } button,input,textarea,select { font:inherit } .trigger { display:inline-flex; align-items:center; justify-content:center; gap:3px; width:46px; height:32px; margin:0 8px 0 0; padding:0 6px; border:1px solid var(--borderColor-default,var(--ck-border)); border-radius:6px; background:var(--button-default-bgColor-rest,var(--ck-button-default-bg-rest)); color:var(--fgColor-muted,var(--ck-fg-muted)); cursor:pointer }
      .trigger:hover { background:var(--button-default-bgColor-hover,var(--ck-button-default-bg-hover)) } .trigger:active:not(:disabled) { background:var(--button-default-bgColor-active,var(--ck-button-default-bg-active)) } .trigger[aria-expanded="true"] { background:var(--button-default-bgColor-selected,var(--ck-button-default-bg-selected)) } .clockoli-mark { display:block; width:22px; height:22px; flex:none; transform-origin:center } @media(prefers-reduced-motion: no-preference) { .trigger.running-current .clockoli-mark { animation:clockoli-task-spin 1s linear infinite } } @keyframes clockoli-task-spin { to { transform:rotate(360deg) } } .trigger:focus-visible,button:focus-visible,a:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible,.time-value:focus-visible,.time-date:focus-visible { outline:2px solid var(--focus-outlineColor,var(--ck-focus)); outline-offset:2px }
      .menu { position:absolute; z-index:2147483647; top:calc(100% + 8px); right:-24px; width:min(420px,calc(100vw - 24px)); max-height:calc(100vh - 76px); overflow-y:scroll; overflow-x:hidden; scrollbar-gutter:stable; overscroll-behavior:contain; border:1px solid var(--borderColor-default,var(--ck-border)); border-radius:12px; background:var(--bgColor-default,var(--ck-bg)); color:var(--fgColor-default,var(--ck-fg)); box-shadow:var(--shadow-floating-small,var(--ck-shadow)) } .menu.has-more { box-shadow:inset 0 -18px 14px -18px var(--fgColor-muted,var(--ck-fg-muted)),var(--shadow-floating-small,var(--ck-shadow)) } :host(.popup-surface) { display:block; width:100%; min-width:0; min-height:220px } :host(.popup-surface) .menu { position:relative; inset:auto; width:100%; max-height:600px; border-radius:0 } :host(.times-surface) { display:block; width:100%; min-width:0 } :host(.times-surface) .times-page { width:min(920px,calc(100% - 32px)); min-height:calc(100vh - 48px); margin:0 auto; background:var(--bgColor-default,var(--ck-bg)); border-inline:1px solid var(--borderColor-muted,var(--ck-border-muted)) } .times-header h1 { margin:2px 0 0; font-size:24px; line-height:1.2 } .times-body { padding:20px 24px 40px } .times-toolbar { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:end; gap:12px; margin-bottom:16px } .times-toolbar label { margin:0 } .times-toolbar select { width:100%; min-height:34px; margin-top:4px; padding:7px 8px; border:1px solid var(--control-borderColor-rest,var(--ck-control-border-rest)); border-radius:6px; background:var(--control-bgColor-rest,var(--ck-control-bg-rest)); color:var(--control-fgColor-rest,var(--ck-control-fg-rest)) } .times-filter { grid-column:auto } .times-custom { display:grid; grid-column:1/-1; grid-template-columns:1fr 1fr auto; align-items:end; gap:12px } .times-apply { align-self:end; min-height:34px } .times-results { min-height:120px } .bulk-time { margin-top:24px; padding:14px; border:1px solid var(--borderColor-muted,var(--ck-border-muted)); border-radius:8px; background:var(--bgColor-muted,var(--ck-bg-muted)) } .bulk-time summary { font-weight:650; cursor:pointer } .bulk-time-input { min-height:160px; resize:vertical } .bulk-time-input::placeholder { color:var(--fgColor-muted,var(--ck-fg-muted)); opacity:.42 } .more-times { display:flex; justify-content:center; padding:12px 0 2px }
      header,.header-actions,.section-head,.entry-row,.form-actions,.today-total { display:flex; align-items:center; justify-content:space-between; gap:12px } header { padding:12px 16px; border-bottom:1px solid var(--borderColor-muted,var(--ck-border-muted)) } .menu-body { padding:14px 16px } .muted { color:var(--fgColor-muted,var(--ck-fg-muted)); font:var(--text-caption-shorthand,400 12px/1.25 "Mona Sans VF",-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans Backtick Fix","Noto Sans",Helvetica,Arial,sans-serif,"Apple Color Emoji","Segoe UI Emoji"); margin-top:3px } .eyebrow { color:var(--fgColor-muted,var(--ck-fg-muted)); font:600 12px/1.5 var(--fontStack-sansSerif,"Mona Sans VF",-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans Backtick Fix","Noto Sans",Helvetica,Arial,sans-serif,"Apple Color Emoji","Segoe UI Emoji"); letter-spacing:normal; margin-bottom:5px } .tracking-status strong { font-weight:900 } .tracking-another strong { display:inline-block; padding:1px 5px; border-radius:999px; background:var(--bgColor-attention-muted,var(--ck-bg-attention)); color:var(--fgColor-muted,var(--ck-fg-muted)) }
      a { color:var(--fgColor-accent,var(--ck-accent)); font-weight:600; text-decoration:none } a:hover { text-decoration:underline } .task-result { min-width:0 } .task-url { display:block; overflow:hidden; color:var(--fgColor-muted,var(--ck-fg-muted)); font-size:12px; font-weight:400; line-height:1.35; text-overflow:ellipsis; white-space:nowrap } .task-title { display:-webkit-box; overflow:hidden; margin-top:2px; color:var(--fgColor-accent,var(--ck-accent)); font-size:16px; font-weight:600; line-height:1.35; overflow-wrap:anywhere; -webkit-box-orient:vertical; -webkit-line-clamp:2 } .task-result-untitled .task-url { overflow:hidden; color:var(--fgColor-accent,var(--ck-accent)); font-size:16px; font-weight:600; text-overflow:ellipsis; white-space:nowrap } .active-task-result { margin-bottom:2px } .elapsed { margin:8px 0 10px; font:600 2rem/1.5 var(--fontStack-monospace,ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace) }
      button { border:1px solid var(--button-default-borderColor-rest,var(--ck-button-default-border-rest)); border-radius:6px; padding:7px 12px; background:var(--button-default-bgColor-rest,var(--ck-button-default-bg-rest)); color:var(--button-default-fgColor-rest,var(--ck-button-default-fg-rest)); font-weight:600; cursor:pointer } button:hover { background:var(--button-default-bgColor-hover,var(--ck-button-default-bg-hover)) } button:active:not(:disabled) { background:var(--button-default-bgColor-active,var(--ck-button-default-bg-active)) } button:disabled { border-color:var(--button-default-borderColor-disabled,var(--ck-button-default-border-disabled)); background:var(--button-default-bgColor-disabled,var(--ck-button-default-bg-disabled)); color:var(--button-default-fgColor-disabled,var(--ck-button-default-fg-disabled)); cursor:default } .wide { width:100%; margin-top:10px } .primary { border-color:var(--button-primary-borderColor-rest,var(--ck-button-primary-border-rest)); background:var(--button-primary-bgColor-rest,var(--ck-button-primary-bg-rest)); color:var(--button-primary-fgColor-rest,var(--ck-button-primary-fg-rest)) } .primary:hover { background:var(--button-primary-bgColor-hover,var(--ck-button-primary-bg-hover)) } .primary:active:not(:disabled) { background:var(--button-primary-bgColor-active,var(--ck-button-primary-bg-active)) } .primary:disabled { border-color:var(--button-primary-borderColor-disabled,var(--ck-button-primary-border-disabled)); background:var(--button-primary-bgColor-disabled,var(--ck-button-primary-bg-disabled)); color:var(--button-primary-fgColor-disabled,var(--ck-button-primary-fg-disabled)) } .danger,.danger-outline { border-color:var(--button-danger-borderColor-rest,var(--ck-button-danger-border-rest)); background:var(--button-danger-bgColor-rest,var(--ck-button-danger-bg-rest)); color:var(--button-danger-fgColor-rest,var(--ck-button-danger-fg-rest)) } .danger:hover,.danger-outline:hover { border-color:var(--button-danger-borderColor-hover,var(--ck-button-danger-border-hover)); background:var(--button-danger-bgColor-hover,var(--ck-button-danger-bg-hover)); color:var(--button-danger-fgColor-hover,var(--ck-button-danger-fg-hover)) } .danger:active:not(:disabled),.danger-outline:active:not(:disabled) { border-color:var(--button-danger-borderColor-active,var(--ck-button-danger-border-active)); background:var(--button-danger-bgColor-active,var(--ck-button-danger-bg-active)); color:var(--button-danger-fgColor-active,var(--ck-button-danger-fg-active)) } .danger:disabled,.danger-outline:disabled { border-color:var(--button-danger-borderColor-rest,var(--ck-button-danger-border-rest)); background:var(--button-danger-bgColor-disabled,var(--ck-button-danger-bg-disabled)); color:var(--button-danger-fgColor-disabled,var(--ck-button-danger-fg-disabled)) }
      .tracker-toolbar { justify-content:flex-end } .header-actions { justify-content:flex-end; gap:4px } .reports-button { display:inline-flex; align-items:center; gap:6px; padding:5px 7px } .reports-button,.icon-button,.link-button,.navigation-item { border:1px solid var(--button-invisible-borderColor-rest,var(--ck-button-invisible-border-rest)); background:var(--button-invisible-bgColor-rest,var(--ck-button-invisible-bg-rest)) } .reports-button,.icon-button { color:var(--button-invisible-iconColor-rest,var(--ck-button-invisible-icon-rest)) } .reports-button:hover,.icon-button:hover,.link-button:hover,.navigation-item:hover { border-color:var(--button-invisible-borderColor-hover,var(--ck-button-invisible-border-hover)); background:var(--button-invisible-bgColor-hover,var(--ck-button-invisible-bg-hover)) } .reports-button:hover,.icon-button:hover { color:var(--button-invisible-iconColor-hover,var(--ck-button-invisible-icon-hover)) } .reports-button:active:not(:disabled),.icon-button:active:not(:disabled),.link-button:active:not(:disabled),.navigation-item:active:not(:disabled) { background:var(--button-invisible-bgColor-active,var(--ck-button-invisible-bg-active)) } .reports-button:disabled,.icon-button:disabled,.link-button:disabled,.navigation-item:disabled { border-color:var(--button-invisible-borderColor-disabled,var(--ck-button-invisible-border-disabled)); background:var(--button-invisible-bgColor-disabled,var(--ck-button-invisible-bg-disabled)); color:var(--button-invisible-fgColor-disabled,var(--ck-button-invisible-fg-disabled)) } @media(prefers-reduced-motion: no-preference) { .icon-button.syncing svg { animation:clockoli-sync-spin .8s linear infinite; transform-origin:center } } @keyframes clockoli-sync-spin { to { transform:rotate(360deg) } } .today-total { margin-top:14px; padding:10px 12px; border:1px solid var(--borderColor-muted,var(--ck-border-muted)); border-radius:8px; background:var(--bgColor-muted,var(--ck-bg-muted)) } .today-total-value { font-size:16px } .icon-button,.link-button { padding:5px } .link-button { color:var(--fgColor-accent,var(--ck-accent)) } .section-head { margin-bottom:7px }
      .time-range-editor { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:12px } .time-picker { min-width:0; margin:0; padding:10px; border:1px solid var(--borderColor-muted,var(--ck-border-muted)); border-radius:10px; background:var(--bgColor-muted,var(--ck-bg-muted)) } .time-picker legend { padding:0 5px; color:var(--fgColor-muted,var(--ck-fg-muted)); font-weight:700 } .time-date { margin:0 0 8px; padding:5px 6px; background:var(--bgColor-default,var(--ck-bg)); font-size:12px } .time-picker-values { display:flex; align-items:center; justify-content:center; gap:6px } .time-value { width:62px; height:48px; margin:0; padding:4px; border-color:var(--control-borderColor-rest,var(--ck-control-border-rest)); background:var(--bgColor-default,var(--ck-bg)); font:700 26px/1 var(--fontStack-monospace,ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace); text-align:center; font-variant-numeric:tabular-nums } .time-colon { font:700 24px/1 var(--fontStack-monospace,ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace) }
      .trigger-group { display:inline-flex; align-items:center; margin:0 8px 0 0 } .trigger-group .trigger { margin:0; border-radius:0 } .trigger-main { width:34px; border-radius:6px 0 0 6px!important } .trigger-menu { width:24px; border-left:0; border-radius:0 6px 6px 0!important }
      .navigation-menu { position:absolute; z-index:2147483647; top:calc(100% + 8px); right:-24px; width:180px; padding:6px; border:1px solid var(--borderColor-default,var(--ck-border)); border-radius:8px; background:var(--bgColor-default,var(--ck-bg)); color:var(--fgColor-default,var(--ck-fg)); box-shadow:var(--shadow-floating-small,var(--ck-shadow)) } .navigation-item { display:flex; align-items:center; gap:8px; width:100%; padding:7px 8px; color:var(--button-invisible-fgColor-rest,var(--ck-button-invisible-fg-rest)); text-align:left }
      .entry-date-header { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:8px } .entry-date-header h2 { margin:0; font-size:14px; font-weight:650 } .entry-day-total,.inline-unsaved { color:var(--ck-fg-muted); font-size:12px; white-space:nowrap }
      .entry { padding:8px 0 } .entry + .entry { margin-top:6px } .entry-record-task-result { margin-bottom:7px } .entry-record { padding:10px 12px; border:1px solid var(--borderColor-default,var(--ck-border)); border-radius:8px; background:var(--bgColor-muted,var(--ck-bg-muted)) } .entry-record + .entry-record { margin-top:8px } .entry-record.entry-overlap { padding:10px 12px; border-color:var(--borderColor-danger-muted,var(--ck-border-danger)); background:var(--bgColor-danger-muted,var(--ck-bg-danger)) } .overlap-warning { margin-bottom:5px; color:var(--fgColor-danger,var(--ck-danger)); font-size:12px; font-weight:700 } .entry-day { margin-bottom:2px; color:var(--fgColor-muted,var(--ck-fg-muted)); font-size:13px; font-weight:650; white-space:nowrap } .entry-time-row { display:flex; flex-wrap:wrap; align-items:center; justify-content:flex-start; gap:8px; min-width:0; white-space:nowrap } .entry-time-range,.inline-time-range { flex:0 0 auto } .inline-time-line { display:flex; flex-wrap:nowrap; align-items:center; justify-content:flex-start; gap:4px; min-width:0; white-space:nowrap } .compact-time-picker { display:inline-flex; align-items:center; min-width:0; margin:0; padding:0; border:0; background:var(--button-invisible-bgColor-rest,var(--ck-transparent)) } .compact-time-picker legend { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap } .compact-time-picker .time-date { display:none } .compact-time-picker .time-picker-values { display:inline-flex; justify-content:flex-start; gap:2px; white-space:nowrap } .compact-time-picker .time-value { width:34px; height:32px; margin:0; padding:2px; border-radius:5px; font-size:17px } .compact-time-picker .time-colon { font-size:17px } .inline-time-separator { color:var(--fgColor-muted,var(--ck-fg-muted)); font-weight:650 } .entry-time-range { color:var(--fgColor-default,var(--ck-fg)); font:600 13px/1.5 var(--fontStack-monospace,ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace); font-variant-numeric:tabular-nums } .inline-duration { flex:0 1 auto; min-width:0; overflow:hidden; color:var(--fgColor-muted,var(--ck-fg-muted)); font-size:13px; font-weight:650; text-overflow:ellipsis; white-space:nowrap } .entry-description { margin-top:4px; color:var(--fgColor-muted,var(--ck-fg-muted)); overflow-wrap:anywhere } .entry-description-editable { display:block; width:100%; padding:5px 7px; border:1px dashed var(--borderColor-default,var(--ck-border)); background:var(--bgColor-default,var(--ck-bg-editable)); color:var(--fgColor-muted,var(--ck-fg-muted)); font-size:inherit; font-weight:400; line-height:inherit; text-align:left } .entry-description-editable:hover { border-style:solid; background:var(--button-invisible-bgColor-hover,var(--ck-button-invisible-bg-hover)); color:var(--fgColor-default,var(--ck-fg)) } .inline-metadata-editor { margin:6px 0 2px; padding:9px; border:1px solid var(--borderColor-muted,var(--ck-border-muted)); border-radius:7px; background:var(--bgColor-muted,var(--ck-bg-muted)) } .inline-metadata-editor label { margin:6px 0 0 } .inline-metadata-editor label:first-child { margin-top:0 } .inline-metadata-editor input { font-size:14px } .entry-actions { display:flex; flex:0 0 auto; align-items:center; gap:4px; opacity:0; pointer-events:none } .entry-actions.dirty { opacity:1; pointer-events:auto } .entry-actions.dirty .entry-edit,.entry-actions.dirty .entry-delete { display:none } .entry-actions button { padding:3px 5px; font-size:12px } .entry-record:hover .entry-actions,.entry-record:focus-within .entry-actions,.entry-actions-visible { opacity:1; pointer-events:auto }
 .queue-diagnostics { margin-top:18px; padding:10px 12px; border:1px solid var(--borderColor-muted,var(--ck-border-muted)); border-radius:8px; background:var(--bgColor-muted,var(--ck-bg-muted)) } .queue-diagnostics summary { cursor:pointer; color:var(--fgColor-default,var(--ck-fg)); font-weight:700 } .queue-diagnostics-list { max-height:220px; margin:8px 0 0; padding:0 0 0 20px; overflow:auto; font:12px/1.45 var(--fontStack-monospace,ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace) } .queue-diagnostic-event { overflow-wrap:anywhere } .queue-diagnostic-event + .queue-diagnostic-event { margin-top:5px } .queue-diagnostic-time { margin-right:7px; color:var(--fgColor-muted,var(--ck-fg-muted)); font-variant-numeric:tabular-nums }
 label { display:block; margin:10px 0 4px; font:600 12px/1.5 var(--fontStack-sansSerif,"Mona Sans VF",-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans Backtick Fix","Noto Sans",Helvetica,Arial,sans-serif,"Apple Color Emoji","Segoe UI Emoji") } input,textarea { display:block; width:100%; margin-top:4px; padding:7px 8px; border:1px solid var(--control-borderColor-rest,var(--ck-control-border-rest)); border-radius:6px; background:var(--control-bgColor-rest,var(--ck-control-bg-rest)); color:var(--control-fgColor-rest,var(--ck-control-fg-rest)) } input::placeholder,textarea::placeholder { color:var(--control-fgColor-placeholder,var(--ck-control-fg-placeholder)) } input:hover:not(:disabled),textarea:hover:not(:disabled) { background:var(--control-bgColor-hover,var(--ck-control-bg-hover)) } input:active:not(:disabled),textarea:active:not(:disabled) { background:var(--control-bgColor-active,var(--ck-control-bg-active)) } input:disabled,textarea:disabled { border-color:var(--control-borderColor-disabled,var(--ck-control-border-disabled)); background:var(--control-bgColor-disabled,var(--ck-control-bg-disabled)); color:var(--control-fgColor-disabled,var(--ck-control-fg-disabled)) } .form-actions { margin-top:12px } .error { margin-bottom:10px; color:var(--fgColor-danger,var(--ck-danger)); white-space:pre-wrap } @media(hover:none) { .entry-actions { opacity:1; pointer-events:auto } } @media(max-width:340px) { .entry-time-row { gap:3px } .inline-time-line { gap:1px } .compact-time-picker .time-picker-values { gap:1px } .compact-time-picker .time-value { width:27px; font-size:15px } .inline-duration { font-size:12px } .entry-actions { gap:1px } .entry-actions button { padding:2px; font-size:10px } } @media(max-width:700px) { :host(.times-surface) .times-page { width:100%; border:0 } .times-header { align-items:flex-start; flex-direction:column } .times-body { padding:16px } .times-toolbar { grid-template-columns:1fr } .times-filter { grid-column:auto } .times-custom { grid-column:auto; grid-template-columns:1fr } } @media(max-width:380px) { .time-range-editor { grid-template-columns:1fr } }
    `);
    if (popupMode || fullWidthPopupOpen) style.textContent += `
      :host(.popup-surface) .menu { max-height:min(720px,calc(100vh - 16px)); overflow-y:auto }
      :host(.popup-surface) .tracker-toolbar { justify-content:flex-start; margin:16px -16px -14px; padding:10px 12px; border-top:1px solid var(--borderColor-muted,var(--ck-border-muted)); border-bottom:0 }
      :host(.popup-surface) .header-actions { width:100%; justify-content:space-between; gap:0 }
      :host(.popup-surface) .reports-button { padding:5px 4px; font-size:12px }
      :host(.popup-surface) .reports-button svg { width:14px; height:14px }
      :host(.full-width-popup-surface) { position:fixed; z-index:2147483647; top:0; right:0; left:0; display:block; width:100vw; pointer-events:none }
      :host(.full-width-popup-surface) .full-width-popup { width:100vw; max-width:none; max-height:calc(100vh - 8px); margin:0; overflow:auto; pointer-events:auto; border:1px solid var(--borderColor-default,var(--ck-border)); border-top:0; border-radius:0 0 12px 12px; background:var(--bgColor-default,var(--ck-bg)); color:var(--fgColor-default,var(--ck-fg)); box-shadow:var(--shadow-floating-small,var(--ck-shadow-overlay)) }
      :host(.full-width-popup-surface) .menu { position:relative; inset:auto; width:100%; max-height:none; margin:0; overflow:visible; border:0; border-radius:0; box-shadow:none }
      :host(.full-width-popup-surface) .menu-body { padding:0 }
      :host(.full-width-popup-surface) .tracker-toolbar { display:grid; grid-template-columns:auto minmax(0,1fr) auto; align-items:center; min-height:48px; padding:8px var(--clockoli-gutter); border-bottom:1px solid var(--borderColor-muted,var(--ck-border-muted)) }
      :host(.full-width-popup-surface) .timeline-brand { display:inline-flex; align-items:center; gap:8px; color:var(--fgColor-default,var(--ck-fg)); font-size:14px }
      :host(.full-width-popup-surface) .header-actions { justify-self:center; display:flex; align-items:center; gap:2px }
      :host(.full-width-popup-surface) .timeline-toolbar-end { justify-self:end; display:flex; align-items:center; gap:12px }
      :host(.full-width-popup-surface) .popup-timeline-track { white-space:nowrap }
      :host(.full-width-popup-surface) .popup-timeline-close { width:30px; height:30px; padding:0; border:0; border-radius:0; background:var(--button-invisible-bgColor-rest,var(--ck-transparent)); font-size:24px; font-weight:400; line-height:1 }
      @media(max-width:520px) {
        :host(.full-width-popup-surface) .tracker-toolbar { grid-template-columns:minmax(0,1fr) auto; grid-template-areas:"brand end" "actions actions"; row-gap:4px }
        :host(.full-width-popup-surface) .timeline-brand { grid-area:brand }
        :host(.full-width-popup-surface) .timeline-toolbar-end { grid-area:end }
        :host(.full-width-popup-surface) .header-actions { grid-area:actions; justify-self:start; flex-wrap:wrap }
      }
      :host(.full-width-popup-surface) .popup-timeline-section { position:relative; width:100vw; margin:0; padding:16px var(--clockoli-gutter); border:0; border-radius:0; background:var(--button-invisible-bgColor-rest,var(--ck-transparent)) }
      :host(.full-width-popup-surface) .timeline-shell { position:relative; width:100%; min-width:0 }
      :host(.full-width-popup-surface) .elastic-timeline-host { width:100%; min-height:108px }
      .timeline-queue-spinner { padding:0 0 10px; color:var(--fgColor-muted,var(--ck-fg-muted)); font-size:12px }
      .active-task-strip { display:flex; align-items:center; gap:12px; padding:14px var(--clockoli-gutter); border-bottom:1px solid var(--borderColor-muted,var(--ck-border-muted)) }
      .strip-task,.strip-idle { flex:1; min-width:0 } .strip-task .task-url { display:none } .strip-task.task-result-untitled .task-url { display:block }
      .active-task-strip button,.running-elapsed { flex:none; white-space:nowrap } .running-elapsed { font-variant-numeric:tabular-nums }
      .today-list,.panel-feedback,.timeline-overlaps,.page-tracking-hint { padding:0 var(--clockoli-gutter) 16px } .panel-feedback:empty,.timeline-overlaps:empty { display:none }
      .today-list-totals { display:flex; gap:24px; margin-bottom:10px } .today-list-totals .today-total { margin:0; padding:0; border:0; background:none; gap:6px }
      .today-record { display:flex; align-items:center; gap:12px; margin-top:8px }
      .today-task { flex:1; min-width:0 } .today-task .task-url { display:none } .today-task.task-result-untitled .task-url { display:block }
      @media(max-width:520px) { .active-task-strip,.today-record { flex-wrap:wrap } .strip-task,.strip-idle,.today-task { flex-basis:70% } }
      :host(.full-width-popup-surface) .timeline-shell.is-saving .elastic-timeline-host { opacity:.56 }
      :host(.full-width-popup-surface) .timeline-saving-spinner { position:absolute; inset:0; z-index:2; display:grid; place-items:center; pointer-events:auto; background:color-mix(in srgb,var(--bgColor-default,var(--ck-bg)) 24%,var(--button-invisible-bgColor-rest,var(--ck-transparent))) }
      :host(.full-width-popup-surface) .timeline-saving-wheel { width:28px; height:28px; border:3px solid var(--borderColor-default,var(--ck-border)); border-top-color:var(--fgColor-accent,var(--ck-accent)); border-radius:50% }
      @keyframes clockoli-timeline-spin { to { transform:rotate(360deg) } }
      @media(prefers-reduced-motion: no-preference) { :host(.full-width-popup-surface) .timeline-saving-wheel { animation:clockoli-timeline-spin .75s linear infinite } }
      :host(.full-width-popup-surface) .elastic-timeline-host { width:100%; min-height:108px }
    `;
    if (fullWidthPopupOpen) {
      if (preserveFullWidthTimeline) refreshMountedTimeline();
      else renderFullWidthPopup(style);
    }
    if (fullWidthPopupOpen) startPanelClock();
    if (!shadow || !root?.isConnected) return;
    if (timesMode) { shadow.append(style, renderTimesPage()); return; }
    if (popupMode) { shadow.append(style, timelineEditorStylesheet(), renderMenu()); restoreMenuScroll(preservedMenuScrollTop); return; }
    const current = taskFromLocation(), group = el('div', undefined, 'trigger-group');
    const currentRunning = sameTask(taskFromLocation(), pageState.active);
    const main = el('button', undefined, `trigger trigger-main${pageState.active ? ' running' : ''}${currentRunning ? ' running-current' : ''}`); main.type = 'button';
    main.setAttribute('aria-label', pageState.active ? `Time tracker running: ${formatElapsed(pageState.active.startedAt)}` : 'Time tracker');
    main.setAttribute('aria-haspopup', 'dialog'); main.setAttribute('aria-expanded', String(menuOpen));
    main.title = pageState.active ? 'Time tracker is running' : 'Open time tracker'; main.append(clockoliMark(22));
    main.addEventListener('click', async event => {
      if (!event.isTrusted) return;
      const activatedTask = taskFromLocation();
      if (!activatedTask) return;
      navigationOpen = false; menuOpen = !menuOpen; if (!menuOpen) menuScrollTop = 0; cancelActiveInlineDraft();
      if (pageState.configured != null) errorText = '';
      renderUi();
      if (menuOpen) {
        try {
          if (pageState.configured == null) await refreshState(false);
          if (menuOpen && pageState.configured) await refreshRecent();
        }
        catch (error) { setError(error); }
      }
    });
    const arrow = el('button', undefined, 'trigger trigger-menu'); arrow.type = 'button'; arrow.setAttribute('aria-label', 'Open time tracker pages');
    arrow.setAttribute('aria-haspopup', 'menu'); arrow.setAttribute('aria-expanded', String(navigationOpen)); arrow.title = 'Reports, top tasks, and activity'; arrow.append(icon('triangle-down', TRIANGLE_PATH, 12));
    arrow.addEventListener('click', event => {
      if (!event.isTrusted) return;
      menuOpen = false; menuScrollTop = 0; navigationOpen = !navigationOpen; cancelActiveInlineDraft(); if (pageState.configured != null) errorText = ''; renderUi();
    });
    group.append(main, arrow); shadow.append(style, group);
    if (navigationOpen) shadow.append(renderNavigationMenu());
    else if (menuOpen) shadow.append(renderMenu());
    restoreMenuScroll(preservedMenuScrollTop);
  }

  async function render(refresh = false) {
    if (location.protocol !== 'https:' || location.hostname !== 'github.com') { root?.remove(); root = null; shadow = null; menuOpen = false; navigationOpen = false; return; }
    if (!mountInHeader()) return;
    renderUi();
    try { applyPageState(await send({ type: 'GET_PAGE_STATE', refresh: false })); errorText = ''; }
    catch (error) { errorText = error.message; errorCode = error.code || 'error'; }
    actionAnimationReady = true;
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
      lastRoute = route; recent = []; recentLoaded = false; recentFresh = false; recentFreshAfterPendingId = null; cancelActiveInlineDraft(); menuOpen = false; menuScrollTop = 0; navigationOpen = false;
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

  if (timesMode) {
    mountInHeader(); renderUi();
    void loadSelectedTimes();
  } else if (popupMode) {
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
  } else if (actionSurfaceMode) {
    if (chrome.runtime.onMessage?.addListener) chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (handleLocalPreferencesChanged(message)) return undefined;
      if (message?.type !== 'TOGGLE_FULL_WIDTH_POPUP') return undefined;
      void toggleFullWidthPopup().then(opened => sendResponse({ ok: true, opened })).catch(error => sendResponse({ ok: false, error: error.message }));
      return true;
    });
    document.addEventListener('keydown', event => {
      if (fullWidthPopupOpen && event.key === 'Escape' && !event.defaultPrevented) closeFullWidthPopup();
    });
    void toggleFullWidthPopup();
  } else {
    if (chrome.runtime.onMessage?.addListener) chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (handleLocalPreferencesChanged(message)) return undefined;
      if (message?.type !== 'TOGGLE_FULL_WIDTH_POPUP') return undefined;
      void toggleFullWidthPopup().then(opened => sendResponse({ ok: true, opened })).catch(error => sendResponse({ ok: false, error: error.message }));
      return true;
    });
    document.addEventListener('click', event => {
      if ((menuOpen || navigationOpen) && !event.composedPath().includes(root)) closeMenu();
    });
    document.addEventListener('keydown', event => {
      if (fullWidthPopupOpen && event.key === 'Escape' && !event.defaultPrevented) { closeFullWidthPopup(); return; }
      if ((menuOpen || navigationOpen) && event.key === 'Escape' && !event.defaultPrevented) closeMenu();
    });
    document.addEventListener('visibilitychange', updateTaskAnimation);
    motionPreference?.addEventListener?.('change', updateTaskAnimation);
    watchClockoliTimeline();
    navigationCheck();
    navigationTimer = setInterval(() => { if (extensionContextActive) navigationCheck(); }, 750);
  }
})();
